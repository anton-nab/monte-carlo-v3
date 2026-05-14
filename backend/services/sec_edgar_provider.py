"""
services/sec_edgar_provider.py
-------------------------------
SEC EDGAR XBRL API — US public companies.

Free    : no API key, no rate limit (respect ~10 req/s courtesy rule).
Commercial : US government open data — no ToS restrictions.
Coverage : all SEC-registered companies (US public equities).
           Does NOT cover non-US companies.

Endpoints:
  https://www.sec.gov/files/company_tickers.json   — ticker → CIK map
  https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json — all XBRL facts

Returns the same shape as FMPProvider.get_financials_data() for IS/BS/CF.
Earnings and analyst are NOT available from SEC EDGAR → left empty (use Finnhub).
"""

from __future__ import annotations

import asyncio
import httpx
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

SEC_TICKERS_URL  = "https://www.sec.gov/files/company_tickers.json"
SEC_FACTS_URL    = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"

# SEC requires a descriptive User-Agent with contact info
_UA = "monte-carlo-v3 antonnabholz44@gmail.com"

_instance: Optional["SECEdgarProvider"] = None


def get_sec_edgar_provider() -> "SECEdgarProvider":
    global _instance
    if _instance is None:
        _instance = SECEdgarProvider()
    return _instance


class SECEdgarProvider:
    """SEC EDGAR XBRL client — US companies only, no API key required."""

    TICKERS_TTL = timedelta(hours=24)
    FACTS_TTL   = timedelta(hours=24)

    def __init__(self) -> None:
        self._cache: Dict[str, Tuple[Any, datetime]] = {}

    # ─────────────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────────────

    async def get_financials_data(
        self, ticker: str, period: str = "annual"
    ) -> Dict[str, Any]:
        """
        US company financials from SEC EDGAR XBRL.

        Returns IS + BS + CF. Earnings and analyst left empty
        (fetch from Finnhub separately).

        Raises ValueError for non-US tickers (no CIK found).
        """
        t   = ticker.upper()
        ck  = f"sec_fin:{t}:{period}"
        cached = self._get_cache(ck, self.FACTS_TTL)
        if cached is not None:
            return cached

        cik_map = await self._get_cik_map()
        cik = cik_map.get(t)
        if not cik:
            raise ValueError(
                f"No SEC EDGAR CIK for '{t}' — non-US company or delisted."
            )

        facts = await self._get_company_facts(cik, t)
        gaap  = facts.get("facts", {}).get("us-gaap", {})

        form = "10-K" if period != "quarterly" else "10-Q"

        is_data = self._build_income_statement(gaap, form)
        bs_data = self._build_balance_sheet(gaap, form)
        cf_data = self._build_cash_flow(gaap, form)

        result: Dict[str, Any] = {
            "ticker":           t,
            "period":           period,
            "income_statement": is_data,
            "balance_sheet":    bs_data,
            "cash_flow":        cf_data,
            "earnings":         [],    # populated by Finnhub in instruments.py
            "analyst":          {"recommendations": None, "price_targets": None},
        }

        if is_data:
            self._set_cache(ck, result)
        return result

    # ─────────────────────────────────────────────────────────────────────
    # CIK lookup
    # ─────────────────────────────────────────────────────────────────────

    async def _get_cik_map(self) -> Dict[str, str]:
        """
        Load SEC ticker→CIK map (cached 24 h).
        Returns {TICKER: "0000320193"} (zero-padded 10-digit CIK).
        """
        ck = "__sec_cik_map__"
        cached = self._get_cache(ck, self.TICKERS_TTL)
        if cached is not None:
            return cached

        try:
            async with httpx.AsyncClient(
                headers={"User-Agent": _UA}, timeout=30.0
            ) as client:
                resp = await client.get(SEC_TICKERS_URL)
                resp.raise_for_status()
                data = resp.json()

            cik_map: Dict[str, str] = {}
            for entry in data.values():
                ticker = (entry.get("ticker") or "").upper()
                cik    = str(entry.get("cik_str") or "").zfill(10)
                if ticker and cik.strip("0"):
                    cik_map[ticker] = cik

            self._set_cache(ck, cik_map)
            return cik_map
        except Exception as exc:
            print(f"[SEC EDGAR] CIK map load failed: {exc}")
            return {}

    # ─────────────────────────────────────────────────────────────────────
    # Company facts (XBRL)
    # ─────────────────────────────────────────────────────────────────────

    async def _get_company_facts(self, cik: str, ticker: str) -> Dict:
        """
        Fetch /api/xbrl/companyfacts/{CIK}.json (cached 24 h).
        Can be large (~2-8 MB) — cached aggressively.
        """
        ck = f"sec_facts:{cik}"
        cached = self._get_cache(ck, self.FACTS_TTL)
        if cached is not None:
            return cached

        url = SEC_FACTS_URL.format(cik=cik)
        try:
            async with httpx.AsyncClient(
                headers={"User-Agent": _UA}, timeout=60.0
            ) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
            self._set_cache(ck, data)
            return data
        except Exception as exc:
            raise ValueError(
                f"SEC EDGAR facts fetch failed for {ticker} (CIK {cik}): {exc}"
            ) from exc

    # ─────────────────────────────────────────────────────────────────────
    # XBRL extraction helpers
    # ─────────────────────────────────────────────────────────────────────

    @staticmethod
    def _duration_series(
        gaap: Dict, form: str, *concepts
    ) -> List[Dict[str, Any]]:
        """
        Extract DURATION (IS/CF) facts from us-gaap for the given form type.

        Annual   (10-K): filters entries where end-start ≈ 340-380 days.
        Quarterly (10-Q): filters entries where end-start ≈ 70-100 days.
        Returns list of {date, val, filed} sorted ASC by date (last 8 entries).
        """
        target_min, target_max = (340, 380) if form == "10-K" else (70, 100)

        for concept in concepts:
            raw = gaap.get(concept, {}).get("units", {}).get("USD", [])
            if not raw:
                continue

            filtered: Dict[str, Dict] = {}
            for entry in raw:
                if entry.get("form") != form:
                    continue
                start = entry.get("start", "")
                end   = entry.get("end", "")
                if not start or not end:
                    continue
                try:
                    days = (
                        datetime.fromisoformat(end) - datetime.fromisoformat(start)
                    ).days
                except ValueError:
                    continue
                if not (target_min <= days <= target_max):
                    continue
                # Deduplicate by end date — keep latest filing
                filed = entry.get("filed", "")
                if end not in filtered or filed > filtered[end].get("filed", ""):
                    filtered[end] = {"date": end, "val": entry["val"], "filed": filed}

            if filtered:
                return sorted(filtered.values(), key=lambda x: x["date"])[-8:]

        return []

    @staticmethod
    def _instant_series(
        gaap: Dict, form: str, *concepts
    ) -> List[Dict[str, Any]]:
        """
        Extract INSTANT (BS) facts — snapshot at period-end date.
        Returns list of {date, val, filed} sorted ASC by date (last 8 entries).
        """
        for concept in concepts:
            raw = gaap.get(concept, {}).get("units", {}).get("USD", [])
            if not raw:
                continue

            filtered: Dict[str, Dict] = {}
            for entry in raw:
                if entry.get("form") != form:
                    continue
                end = entry.get("end", "")
                if not end:
                    continue
                filed = entry.get("filed", "")
                if end not in filtered or filed > filtered[end].get("filed", ""):
                    filtered[end] = {"date": end, "val": entry["val"], "filed": filed}

            if filtered:
                return sorted(filtered.values(), key=lambda x: x["date"])[-8:]

        return []

    @staticmethod
    def _lookup(series: List[Dict], target_date: str) -> Optional[float]:
        for entry in series:
            if entry["date"] == target_date:
                v = entry["val"]
                return round(float(v), 2) if v is not None else None
        return None

    # ─────────────────────────────────────────────────────────────────────
    # Statement builders
    # ─────────────────────────────────────────────────────────────────────

    def _build_income_statement(self, gaap: Dict, form: str) -> List[Dict]:
        revenues = self._duration_series(gaap, form,
            "Revenues",
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            "RevenueFromContractWithCustomerIncludingAssessedTax",
            "SalesRevenueNet",
        )
        gp   = self._duration_series(gaap, form, "GrossProfit")
        oi   = self._duration_series(gaap, form, "OperatingIncomeLoss")
        ni   = self._duration_series(gaap, form, "NetIncomeLoss", "ProfitLoss")
        rd   = self._duration_series(gaap, form, "ResearchAndDevelopmentExpense")
        da   = self._duration_series(gaap, form,
            "DepreciationDepletionAndAmortization",
            "DepreciationAndAmortization",
        )

        result: List[Dict] = []
        for entry in revenues:
            d   = entry["date"]
            rev = self._lookup(revenues, d)
            gp_ = self._lookup(gp, d)
            oi_ = self._lookup(oi, d)
            ni_ = self._lookup(ni, d)
            da_ = self._lookup(da, d)
            # EBITDA = Operating Income + D&A (approximate)
            eb  = round(oi_ + da_, 2) if oi_ is not None and da_ is not None else None
            result.append({
                "date":             d[:10],
                "revenue":          rev,
                "gross_profit":     gp_,
                "ebitda":           eb,
                "operating_income": oi_,
                "net_income":       ni_,
                "rd_expense":       self._lookup(rd, d),
                "gross_margin":     round(gp_ / rev, 4) if gp_ and rev else None,
                "operating_margin": round(oi_ / rev, 4) if oi_ and rev else None,
                "net_margin":       round(ni_ / rev, 4) if ni_ and rev else None,
            })
        return result

    def _build_balance_sheet(self, gaap: Dict, form: str) -> List[Dict]:
        assets = self._instant_series(gaap, form, "Assets")
        liab   = self._instant_series(gaap, form, "Liabilities")
        equity = self._instant_series(gaap, form,
            "StockholdersEquity",
            "StockholdersEquityAttributableToParent",
        )
        cash   = self._instant_series(gaap, form,
            "CashAndCashEquivalentsAtCarryingValue",
            "CashCashEquivalentsAndShortTermInvestments",
        )
        debt   = self._instant_series(gaap, form,
            "LongTermDebt",
            "LongTermDebtAndCapitalLeaseObligations",
            "DebtAndCapitalLeaseObligations",
        )

        result: List[Dict] = []
        for entry in assets:
            d   = entry["date"]
            ta  = self._lookup(assets, d)
            tl  = self._lookup(liab, d)
            eq  = self._lookup(equity, d)
            ca  = self._lookup(cash, d)
            ltd = self._lookup(debt, d)
            nd  = round(ltd - ca, 2) if ltd is not None and ca is not None else None
            result.append({
                "date":              d[:10],
                "total_assets":      ta,
                "total_liabilities": tl,
                "equity":            eq,
                "cash":              ca,
                "total_debt":        ltd,
                "net_debt":          nd,
            })
        return result

    def _build_cash_flow(self, gaap: Dict, form: str) -> List[Dict]:
        op  = self._duration_series(gaap, form,
            "NetCashProvidedByUsedInOperatingActivities",
        )
        inv = self._duration_series(gaap, form,
            "NetCashProvidedByUsedInInvestingActivities",
            "NetCashUsedInInvestingActivities",
        )
        fin = self._duration_series(gaap, form,
            "NetCashProvidedByUsedInFinancingActivities",
            "NetCashUsedInFinancingActivities",
        )
        cx  = self._duration_series(gaap, form,
            "PaymentsToAcquirePropertyPlantAndEquipment",
            "CapitalExpenditure",
        )

        result: List[Dict] = []
        for entry in op:
            d   = entry["date"]
            op_ = self._lookup(op, d)
            cx_ = self._lookup(cx, d)
            fc  = round(op_ + cx_, 2) if op_ is not None and cx_ is not None else None
            result.append({
                "date":         d[:10],
                "operating_cf": op_,
                "investing_cf": self._lookup(inv, d),
                "financing_cf": self._lookup(fin, d),
                "capex":        cx_,
                "free_cf":      fc,
            })
        return result

    # ─────────────────────────────────────────────────────────────────────
    # Cache
    # ─────────────────────────────────────────────────────────────────────

    def _get_cache(self, key: str, ttl: timedelta) -> Optional[Any]:
        entry = self._cache.get(key)
        if entry is None:
            return None
        value, ts = entry
        if datetime.now() - ts > ttl:
            del self._cache[key]
            return None
        return value

    def _set_cache(self, key: str, value: Any) -> None:
        self._cache[key] = (value, datetime.now())
