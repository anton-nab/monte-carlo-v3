"""
services/finnhub_provider.py
----------------------------
Finnhub financial data client.

Free tier : 60 calls/minute, no daily cap.
Commercial use : explicitly allowed on all plans.
API docs : https://finnhub.io/docs/api
Key      : set FINNHUB_API_KEY env variable (free registration at finnhub.io)

Coverage:
  Profile     /stock/profile2             global equities + ETFs
  Metrics     /stock/metric?metric=all    PE, PB, ROE, margins, beta … (global)
  Financials  /stock/financials-reported  IS + BS + CF via SEC XBRL (US + select intl)
  Earnings    /stock/earnings             EPS actual vs estimate
  Analyst     /stock/recommendation       consensus buy/hold/sell
              /stock/price-target         low / mean / high targets
  News        /news?category=general      general market news
              /company-news               per-ticker news
"""

from __future__ import annotations

import os
import asyncio
import httpx
from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Optional

FINNHUB_BASE = "https://finnhub.io/api/v1"

_instance: Optional["FinnhubProvider"] = None


def get_finnhub_provider() -> "FinnhubProvider":
    global _instance
    if _instance is None:
        _instance = FinnhubProvider()
    return _instance


class FinnhubProvider:
    """Finnhub API client — free tier, commercial OK, 60 req/min."""

    PROFILE_TTL    = timedelta(hours=24)
    FINANCIALS_TTL = timedelta(hours=72)
    NEWS_TTL       = timedelta(minutes=30)

    def __init__(self, api_key: Optional[str] = None) -> None:
        self._key   = api_key or os.getenv("FINNHUB_API_KEY", "")
        self._cache: Dict[str, tuple] = {}

    # ─────────────────────────────────────────────────────────────────────
    # Company profile + financial metrics
    # ─────────────────────────────────────────────────────────────────────

    async def get_company_profile(self, ticker: str) -> Dict[str, Any]:
        """
        Company fundamentals from Finnhub — global coverage.

        Two calls (cached 24 h):
          /stock/profile2          → name, industry, country, exchange
          /stock/metric?metric=all → PE, PB, ROE, margins, beta …

        Output shape matches FMPProvider.get_company_profile().
        """
        t  = ticker.upper()
        ck = f"fh_profile:{t}"
        cached = self._get_cache(ck, self.PROFILE_TTL)
        if cached is not None:
            return cached

        profile_raw, metrics_raw = await asyncio.gather(
            self._get("/stock/profile2", {"symbol": t}),
            self._get("/stock/metric",   {"symbol": t, "metric": "all"}),
            return_exceptions=True,
        )

        p = profile_raw if isinstance(profile_raw, dict) else {}
        m = (metrics_raw.get("metric", {}) if isinstance(metrics_raw, dict) else {}) or {}

        def _f(*keys) -> Optional[float]:
            for k in keys:
                v = m.get(k) or p.get(k)
                if v is not None:
                    try:
                        f = float(v)
                        return None if f != f else round(f, 4)
                    except (TypeError, ValueError):
                        pass
            return None

        result = {
            "ticker":         t,
            "type":           "etf" if p.get("type") == "ETP" else "equity",
            "name":           p.get("name") or t,
            "sector":         p.get("finnhubIndustry") or p.get("gicsSector") or "",
            "industry":       p.get("finnhubIndustry") or "",
            "market_cap":     _f("marketCapitalization"),
            "pe_ratio":       _f("peBasicExclExtraTTM", "peTTM"),
            "pb_ratio":       _f("pbAnnual"),
            "roe":            _f("roeAnnual"),
            "dividend_yield": _f("dividendYieldIndicatedAnnual"),
            "debt_to_equity": _f("totalDebt/totalEquityAnnual"),
            "eps":            _f("epsBasicExclExtraItemsAnnual"),
            "beta":           _f("beta"),
            "revenue_ttm":    _f("revenueTTM"),
            "gross_margin":   _f("grossMarginAnnual"),
        }

        self._set_cache(ck, result)
        return result

    # ─────────────────────────────────────────────────────────────────────
    # Financial statements  (IS + BS + CF + earnings + analyst)
    # ─────────────────────────────────────────────────────────────────────

    async def get_financials_data(
        self, ticker: str, period: str = "annual"
    ) -> Dict[str, Any]:
        """
        Full financial statements via Finnhub /stock/financials-reported.
        This endpoint serves SEC XBRL data (US companies) and select
        international filings — identical to SEC EDGAR but pre-parsed.

        Also fetches: earnings EPS, analyst consensus, price targets.

        Output shape matches FMPProvider.get_financials_data().
        """
        t   = ticker.upper()
        ck  = f"fh_financials:{t}:{period}"
        cached = self._get_cache(ck, self.FINANCIALS_TTL)
        if cached is not None:
            return cached

        freq = "quarterly" if period == "quarterly" else "annual"

        # Fetch all sources in parallel
        reported_raw, earnings_raw, recs_raw, pt_raw = await asyncio.gather(
            self._get("/stock/financials-reported", {"symbol": t, "freq": freq}),
            self._get("/stock/earnings",            {"symbol": t}),
            self._get("/stock/recommendation",      {"symbol": t}),
            self._get("/stock/price-target",        {"symbol": t}),
            return_exceptions=True,
        )

        # ── Financial reports (IS / BS / CF) ─────────────────────────────────
        reports: List[Dict] = []
        if isinstance(reported_raw, dict):
            reports = reported_raw.get("data") or []
        reports = sorted(
            [r for r in reports if isinstance(r, dict) and r.get("endDate")],
            key=lambda x: x["endDate"],
        )

        income_statement: List[Dict] = []
        balance_sheet:    List[Dict] = []
        cash_flow:        List[Dict] = []

        def _cv(items: List[Dict], *concepts) -> Optional[float]:
            """First matching concept value from a list of XBRL items."""
            for c in concepts:
                for item in items:
                    if item.get("concept") == c:
                        v = item.get("value")
                        if v is not None:
                            try:
                                return round(float(v), 2)
                            except (TypeError, ValueError):
                                pass
            return None

        for rep in reports[-8:]:
            d   = (rep.get("endDate") or "")[:10]
            ic  = rep.get("report", {}).get("ic", []) or []
            bs  = rep.get("report", {}).get("bs", []) or []
            cf  = rep.get("report", {}).get("cf", []) or []

            # Income statement
            rev = _cv(ic,
                "Revenues",
                "RevenueFromContractWithCustomerExcludingAssessedTax",
                "SalesRevenueNet",
            )
            gp  = _cv(ic, "GrossProfit")
            oi  = _cv(ic, "OperatingIncomeLoss")
            ni  = _cv(ic, "NetIncomeLoss", "ProfitLoss")
            rd  = _cv(ic, "ResearchAndDevelopmentExpense")
            eb  = _cv(ic,
                "EarningsBeforeInterestTaxesDepreciationAndAmortization",
                "Ebitda",
            )
            income_statement.append({
                "date":             d,
                "revenue":          rev,
                "gross_profit":     gp,
                "ebitda":           eb,
                "operating_income": oi,
                "net_income":       ni,
                "rd_expense":       rd,
                "gross_margin":     round(gp / rev, 4) if gp and rev else None,
                "operating_margin": round(oi / rev, 4) if oi and rev else None,
                "net_margin":       round(ni / rev, 4) if ni and rev else None,
            })

            # Balance sheet
            ta  = _cv(bs, "Assets")
            tl  = _cv(bs, "Liabilities")
            eq  = _cv(bs,
                "StockholdersEquity",
                "StockholdersEquityAttributableToParent",
            )
            ca  = _cv(bs,
                "CashAndCashEquivalentsAtCarryingValue",
                "CashCashEquivalentsAndShortTermInvestments",
            )
            ltd = _cv(bs, "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations")
            nd  = round(ltd - ca, 2) if ltd is not None and ca is not None else None
            balance_sheet.append({
                "date":              d,
                "total_assets":      ta,
                "total_liabilities": tl,
                "equity":            eq,
                "cash":              ca,
                "total_debt":        ltd,
                "net_debt":          nd,
            })

            # Cash flow
            op  = _cv(cf, "NetCashProvidedByUsedInOperatingActivities")
            inv = _cv(cf, "NetCashProvidedByUsedInInvestingActivities")
            fin = _cv(cf, "NetCashProvidedByUsedInFinancingActivities")
            cx  = _cv(cf, "PaymentsToAcquirePropertyPlantAndEquipment")
            fc  = round(op + cx, 2) if op is not None and cx is not None else None
            cash_flow.append({
                "date":         d,
                "operating_cf": op,
                "investing_cf": inv,
                "financing_cf": fin,
                "capex":        cx,
                "free_cf":      fc,
            })

        # ── Earnings ─────────────────────────────────────────────────────────
        earnings: List[Dict] = []
        if isinstance(earnings_raw, list):
            for e in sorted(earnings_raw, key=lambda x: x.get("period", ""))[-8:]:
                actual   = e.get("actual")
                estimate = e.get("estimate")
                surprise: Optional[float] = None
                if actual is not None and estimate is not None and estimate != 0:
                    surprise = round((actual - estimate) / abs(estimate) * 100, 2)
                earnings.append({
                    "date":         (e.get("period") or "")[:10],
                    "period":       "",
                    "eps_actual":   actual,
                    "eps_estimate": estimate,
                    "surprise_pct": surprise,
                })

        # ── Analyst recommendations ───────────────────────────────────────────
        recommendations = None
        price_targets   = None

        if isinstance(recs_raw, list) and recs_raw:
            latest = recs_raw[0]
            counts = {
                "strong_buy":  latest.get("strongBuy",  0),
                "buy":         latest.get("buy",         0),
                "hold":        latest.get("hold",        0),
                "sell":        latest.get("sell",        0),
                "strong_sell": latest.get("strongSell",  0),
            }
            if sum(counts.values()) > 0:
                recommendations = counts

        if isinstance(pt_raw, dict) and pt_raw.get("targetMean"):
            price_targets = {
                "low":   pt_raw.get("targetLow"),
                "mean":  pt_raw.get("targetMean"),
                "high":  pt_raw.get("targetHigh"),
                "count": None,
            }

        result: Dict[str, Any] = {
            "ticker":           t,
            "period":           period,
            "income_statement": income_statement,
            "balance_sheet":    balance_sheet,
            "cash_flow":        cash_flow,
            "earnings":         earnings,
            "analyst":          {"recommendations": recommendations, "price_targets": price_targets},
        }

        if income_statement:
            self._set_cache(ck, result)
        return result

    # ─────────────────────────────────────────────────────────────────────
    # News
    # ─────────────────────────────────────────────────────────────────────

    async def get_market_news(self, limit: int = 10) -> List[Dict[str, Any]]:
        """General financial market news — Finnhub /news?category=general."""
        ck = f"fh_market_news:{limit}"
        cached = self._get_cache(ck, self.NEWS_TTL)
        if cached is not None:
            return cached

        rows = await self._get("/news", {"category": "general"})
        if not isinstance(rows, list):
            rows = []

        seen: set = set()
        result: List[Dict[str, Any]] = []
        for item in rows:
            headline = (item.get("headline") or "").strip()
            url      = (item.get("url") or "").strip()
            if not headline or not url or headline in seen:
                continue
            seen.add(headline)
            ts = item.get("datetime", 0)
            published = (
                datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else ""
            )
            result.append({
                "title":     headline,
                "publisher": item.get("source") or "",
                "link":      url,
                "published": published,
            })
            if len(result) >= limit:
                break

        self._set_cache(ck, result)
        return result

    async def get_company_news(
        self, ticker: str, days: int = 7
    ) -> List[Dict[str, Any]]:
        """Recent news for a specific ticker — Finnhub /company-news."""
        t  = ticker.upper()
        ck = f"fh_co_news:{t}:{days}"
        cached = self._get_cache(ck, self.NEWS_TTL)
        if cached is not None:
            return cached

        to_date   = date.today().isoformat()
        from_date = (date.today() - timedelta(days=days)).isoformat()

        rows = await self._get(
            "/company-news",
            {"symbol": t, "from": from_date, "to": to_date},
        )
        if not isinstance(rows, list):
            rows = []

        result: List[Dict[str, Any]] = []
        for item in rows[:15]:
            headline = (item.get("headline") or "").strip()
            url      = (item.get("url") or "").strip()
            if not headline or not url:
                continue
            ts = item.get("datetime", 0)
            published = (
                datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else ""
            )
            result.append({
                "title":     headline,
                "publisher": item.get("source") or "",
                "link":      url,
                "published": published,
            })

        self._set_cache(ck, result)
        return result

    # ─────────────────────────────────────────────────────────────────────
    # Calendar
    # ─────────────────────────────────────────────────────────────────────

    CALENDAR_TTL = timedelta(minutes=30)

    async def get_economic_calendar(
        self, from_date: str, to_date: str
    ) -> List[Dict[str, Any]]:
        """
        Economic event calendar — Finnhub /calendar/economic.
        Returns [] if no API key is set.
        """
        ck = f"fh_eco_cal:{from_date}:{to_date}"
        cached = self._get_cache(ck, self.CALENDAR_TTL)
        if cached is not None:
            return cached

        raw = await self._get("/calendar/economic", {"from": from_date, "to": to_date})
        events = raw.get("economicCalendar", []) if isinstance(raw, dict) else []

        _FLAG = {
            "US": "🇺🇸", "EU": "🇪🇺", "GB": "🇬🇧", "UK": "🇬🇧",
            "JP": "🇯🇵", "CN": "🇨🇳", "DE": "🇩🇪", "CA": "🇨🇦",
            "AU": "🇦🇺", "CH": "🇨🇭", "FR": "🇫🇷",
        }

        result: List[Dict[str, Any]] = []
        for e in events:
            impact = (e.get("impact") or "low").lower()
            if impact not in ("high", "medium", "low"):
                impact = "low"
            country = (e.get("country") or "").upper()
            result.append({
                "date":     (e.get("date") or "")[:10],
                "time":     e.get("time") or "—",
                "type":     "macro",
                "country":  country,
                "flag":     _FLAG.get(country, "🌐"),
                "title":    e.get("event") or "—",
                "impact":   impact,
                "previous": str(e["prev"])  + (e.get("unit") or "") if e.get("prev") is not None else None,
                "estimate": str(e["estimate"]) + (e.get("unit") or "") if e.get("estimate") is not None else None,
                "actual":   str(e["actual"])  + (e.get("unit") or "") if e.get("actual")   is not None else None,
                "ticker":   None,
            })

        result.sort(key=lambda x: (x["date"], x["time"]))
        self._set_cache(ck, result)
        return result

    async def get_earnings_calendar(
        self, from_date: str, to_date: str
    ) -> List[Dict[str, Any]]:
        """
        Earnings calendar — Finnhub /calendar/earnings.
        Returns [] if no API key is set.
        """
        ck = f"fh_earn_cal:{from_date}:{to_date}"
        cached = self._get_cache(ck, self.CALENDAR_TTL)
        if cached is not None:
            return cached

        raw = await self._get("/calendar/earnings", {"from": from_date, "to": to_date})
        events = raw.get("earningsCalendar", []) if isinstance(raw, dict) else []

        _HOUR = {"bmo": "Pre-mkt", "amc": "After-mkt", "dmh": "During mkt"}

        result: List[Dict[str, Any]] = []
        for e in events:
            sym  = (e.get("symbol") or "").upper()
            hour = (e.get("hour") or "").lower()
            est  = e.get("epsEstimate")
            result.append({
                "date":     (e.get("date") or "")[:10],
                "time":     _HOUR.get(hour, "—"),
                "type":     "earnings",
                "country":  "US",
                "flag":     "📊",
                "title":    f"{sym} Earnings",
                "impact":   "medium",
                "previous": None,
                "estimate": f"EPS {est:+.2f}" if est is not None else None,
                "actual":   None,
                "ticker":   sym,
            })

        result.sort(key=lambda x: x["date"])
        self._set_cache(ck, result)
        return result

    # ─────────────────────────────────────────────────────────────────────
    # HTTP helpers
    # ─────────────────────────────────────────────────────────────────────

    async def _get(self, path: str, params: Optional[Dict] = None) -> Any:
        """Async GET — returns parsed JSON; returns [] on any error."""
        if not self._key:
            return []
        p = dict(params or {})
        p["token"] = self._key
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(f"{FINNHUB_BASE}{path}", params=p)
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            print(f"[Finnhub] {path} failed: {exc}")
            return []

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
