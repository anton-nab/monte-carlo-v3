"""
Shared Financial Modeling Prep (FMP) client.

Free tier: 250 calls/day — cache everything to stay within limits.
  - ETF / index data:       24 h TTL
  - Financial statements:   72 h TTL (quarterly reports only change 4×/year)

Endpoints used:
  GET /v3/sp500_constituent              → S&P 500 constituents
  GET /v3/nasdaq_constituent             → Nasdaq 100 constituents
  GET /v3/dowjones_constituent           → Dow Jones 30 constituents
  GET /v3/etf-holder/{symbol}            → ETF holdings with weightPercentage
  GET /v3/etf-sector-weightings/{symbol} → ETF sector breakdown
  GET /v3/etf-country-weightings/{symbol}→ ETF country breakdown

  Phase 8.5 — Financial Statements (replaces yfinance):
  GET /v3/income-statement/{symbol}          → IS (revenue, GP, EBITDA, NI…)
  GET /v3/balance-sheet-statement/{symbol}   → BS (assets, liabilities, debt…)
  GET /v3/cash-flow-statement/{symbol}       → CF (operating, capex, FCF…)
  GET /v3/earnings-surprises/{symbol}        → EPS actual vs estimate
  GET /v3/analyst-stock-recommendations/{s}  → per-analyst grades + price targets
"""

import os
import asyncio
import httpx
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

BASE_URL    = "https://financialmodelingprep.com/api/v3"
FMP_V4_BASE = "https://financialmodelingprep.com/api/v4"

# Map analyst grade strings → our internal bucket
_GRADE_MAP: Dict[str, str] = {
    "strong buy":           "strong_buy",
    "buy":                  "buy",
    "outperform":           "buy",
    "overweight":           "buy",
    "market outperform":    "buy",
    "positive":             "buy",
    "top pick":             "strong_buy",
    "sector outperform":    "buy",
    "accumulate":           "buy",
    "add":                  "buy",
    "neutral":              "hold",
    "hold":                 "hold",
    "equal-weight":         "hold",
    "equal weight":         "hold",
    "market perform":       "hold",
    "sector perform":       "hold",
    "peer perform":         "hold",
    "market weight":        "hold",
    "in-line":              "hold",
    "sector neutral":       "hold",
    "mixed":                "hold",
    "fair value":           "hold",
    "sell":                 "sell",
    "underperform":         "sell",
    "underweight":          "sell",
    "reduce":               "sell",
    "market underperform":  "sell",
    "negative":             "sell",
    "strong sell":          "strong_sell",
    "strong underperform":  "strong_sell",
}

# Singleton — shared across the app
_instance: Optional["FMPProvider"] = None


def get_fmp_provider() -> "FMPProvider":
    global _instance
    if _instance is None:
        _instance = FMPProvider()
    return _instance


class FMPProvider:
    """Financial Modeling Prep API client with in-memory cache."""

    CACHE_TTL      = timedelta(hours=24)
    FINANCIALS_TTL = timedelta(hours=72)   # IS/BS/CF barely change
    BATCH_QUOTE_TTL = timedelta(hours=1)
    NEWS_TTL        = timedelta(minutes=30)

    def __init__(self, api_key: Optional[str] = None) -> None:
        self._api_key = api_key or os.getenv("FMP_API_KEY", "")
        self._cache: Dict[str, tuple] = {}

    # ─────────────────────────────────────────────────────────────────
    # Public: index constituents
    # ─────────────────────────────────────────────────────────────────

    INDEX_ENDPOINTS: Dict[str, str] = {
        "SP500": "/sp500_constituent",
        "NDX":   "/nasdaq_constituent",
        "DJI":   "/dowjones_constituent",
    }

    async def get_index_constituents(self, symbol: str) -> List[Dict[str, Any]]:
        """Return [{ticker, name, sector, sub_sector}] for a US index."""
        endpoint = self.INDEX_ENDPOINTS.get(symbol.upper())
        if not endpoint:
            raise ValueError(
                f"FMP has no constituent endpoint for '{symbol}'. "
                f"Supported: {list(self.INDEX_ENDPOINTS)}"
            )
        cache_key = f"constituents:{symbol.upper()}"
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached

        raw = await self._get(endpoint)
        result = [
            {
                "ticker":      (item.get("symbol") or "").strip(),
                "name":        item.get("name") or item.get("companyName") or "",
                "sector":      item.get("sector") or "",
                "sub_sector":  item.get("subSector") or "",
            }
            for item in raw
            if (item.get("symbol") or "").strip()
        ]
        self._set_cache(cache_key, result)
        return result

    # ─────────────────────────────────────────────────────────────────
    # Public: ETF holdings
    # ─────────────────────────────────────────────────────────────────

    async def get_etf_holdings(self, ticker: str) -> List[Dict[str, Any]]:
        """Return [{ticker, name, weight_pct}] for an ETF (top 25 by weight)."""
        cache_key = f"etf:{ticker.upper()}"
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached

        raw = await self._get(f"/etf-holder/{ticker.upper()}")
        result = []
        for item in raw:
            sym = (item.get("asset") or "").strip()
            if not sym:
                continue
            raw_pct = float(item.get("weightPercentage") or 0)
            weight_pct = round(raw_pct * 100, 3) if raw_pct <= 1 else round(raw_pct, 3)
            result.append({
                "ticker":     sym,
                "name":       item.get("name") or sym,
                "weight_pct": weight_pct,
            })
        result.sort(key=lambda x: x["weight_pct"], reverse=True)
        result = result[:25]
        self._set_cache(cache_key, result)
        return result

    # ─────────────────────────────────────────────────────────────────
    # Public: ETF breakdown (sectors + countries)
    # ─────────────────────────────────────────────────────────────────

    async def get_etf_sectors(self, ticker: str) -> List[Dict[str, Any]]:
        """Return [{sector, weight_pct}] sorted desc for an ETF."""
        cache_key = f"etf_sectors:{ticker.upper()}"
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached
        raw = await self._get(f"/etf-sector-weightings/{ticker.upper()}")
        result = []
        for item in raw:
            sector  = item.get("sector", "")
            pct_str = str(item.get("weightPercentage", "0")).replace("%", "").strip()
            try:
                pct = round(float(pct_str), 2)
            except (ValueError, TypeError):
                pct = 0.0
            if sector and pct > 0:
                result.append({"sector": sector, "weight_pct": pct})
        result.sort(key=lambda x: x["weight_pct"], reverse=True)
        self._set_cache(cache_key, result)
        return result

    async def get_etf_countries(self, ticker: str) -> List[Dict[str, Any]]:
        """Return [{country, weight_pct}] sorted desc for an ETF."""
        cache_key = f"etf_countries:{ticker.upper()}"
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached
        raw = await self._get(f"/etf-country-weightings/{ticker.upper()}")
        result = []
        for item in raw:
            country = item.get("country", "")
            pct_str = str(item.get("weightPercentage", "0")).replace("%", "").strip()
            try:
                pct = round(float(pct_str), 2)
            except (ValueError, TypeError):
                pct = 0.0
            if country and pct > 0:
                result.append({"country": country, "weight_pct": pct})
        result.sort(key=lambda x: x["weight_pct"], reverse=True)
        self._set_cache(cache_key, result)
        return result

    # ─────────────────────────────────────────────────────────────────
    # Public: Company Profile + Ratios (Phase 8.6 — replaces yfinance fundamentals)
    # ─────────────────────────────────────────────────────────────────

    async def get_company_profile(self, ticker: str) -> Dict[str, Any]:
        """
        Company fundamentals from FMP (commercial-friendly, free tier).

        Two calls (both cached 24 h):
          /v3/profile/{ticker}     → name, sector, industry, mktCap, beta, type
          /v3/ratios-ttm/{ticker}  → pe, pb, roe, div yield, D/E, eps, gross margin

        Output shape matches YFinanceProvider.get_fundamentals().
        """
        t = ticker.upper()

        # ── Profile ──────────────────────────────────────────────────
        profile_key = f"profile:{t}"
        profile_raw = self._get_cache(profile_key)
        if profile_raw is None:
            rows = await self._get(f"/profile/{t}")
            profile_raw = rows[0] if rows else {}
            self._set_cache(profile_key, profile_raw)

        # ── TTM Ratios ───────────────────────────────────────────────
        ratios_key = f"ratios_ttm:{t}"
        ratios_raw = self._get_cache(ratios_key)
        if ratios_raw is None:
            rows = await self._get(f"/ratios-ttm/{t}")
            ratios_raw = rows[0] if rows else {}
            self._set_cache(ratios_key, ratios_raw)

        def _f(*keys) -> Optional[float]:
            """Pull first non-None numeric from profile_raw or ratios_raw."""
            for src in (profile_raw, ratios_raw):
                for k in keys:
                    v = src.get(k)
                    if v is not None:
                        try:
                            f = float(v)
                            return None if f != f else round(f, 4)  # NaN guard
                        except (TypeError, ValueError):
                            pass
            return None

        # Determine instrument type
        if profile_raw.get("isEtf"):
            itype = "etf"
        elif profile_raw.get("isFund"):
            itype = "mutual_fund"
        else:
            itype = "equity"

        return {
            "ticker":         t,
            "type":           itype,
            "name":           profile_raw.get("companyName") or t,
            "sector":         profile_raw.get("sector") or "",
            "industry":       profile_raw.get("industry") or "",
            "market_cap":     _f("mktCap"),
            "pe_ratio":       _f("peRatioTTM"),
            "pb_ratio":       _f("priceToBookRatioTTM"),
            "roe":            _f("returnOnEquityTTM"),
            "dividend_yield": _f("dividendYieldTTM", "dividendYielTTM"),
            "debt_to_equity": _f("debtEquityRatioTTM"),
            "eps":            _f("epsBasicTTM", "netIncomePerShareTTM"),
            "beta":           _f("beta"),
            "revenue_ttm":    None,   # not available in profile/ratios — shows "—" in UI
            "gross_margin":   _f("grossProfitMarginTTM"),
        }

    # ─────────────────────────────────────────────────────────────────
    # Public: Financial Statements (Phase 8.5 — replaces yfinance)
    # ─────────────────────────────────────────────────────────────────

    async def get_financials_data(
        self,
        ticker: str,
        period: str = "annual",
    ) -> Dict[str, Any]:
        """
        Full financial statements: IS + BS + CF + earnings + analyst.
        Output matches YFinanceProvider.get_financials_data() format exactly.

        Uses 5 FMP calls (all cached 72 h):
          income-statement, balance-sheet-statement, cash-flow-statement,
          earnings-surprises, analyst-stock-recommendations
        """
        t         = ticker.upper()
        cache_key = f"financials:{t}:{period}"
        cached    = self._get_cache(cache_key, ttl=self.FINANCIALS_TTL)
        if cached is not None:
            return cached

        period_str = "quarter" if period == "quarterly" else "annual"

        # ── Parallel fetch ──────────────────────────────────────────────────
        results = await asyncio.gather(
            self._get_stmt(f"/income-statement/{t}",       period_str, limit=8),
            self._get_stmt(f"/balance-sheet-statement/{t}", period_str, limit=8),
            self._get_stmt(f"/cash-flow-statement/{t}",    period_str, limit=8),
            self._get_stmt(f"/earnings-surprises/{t}"),
            self._get_stmt(f"/analyst-stock-recommendations/{t}", limit=60),
            return_exceptions=True,
        )

        is_raw    = results[0] if not isinstance(results[0], Exception) else []
        bs_raw    = results[1] if not isinstance(results[1], Exception) else []
        cf_raw    = results[2] if not isinstance(results[2], Exception) else []
        earn_raw  = results[3] if not isinstance(results[3], Exception) else []
        recs_raw  = results[4] if not isinstance(results[4], Exception) else []

        data = {
            "ticker":           t,
            "period":           period,
            "income_statement": self._parse_income(is_raw),
            "balance_sheet":    self._parse_balance(bs_raw),
            "cash_flow":        self._parse_cashflow(cf_raw),
            "earnings":         self._parse_earnings(earn_raw),
            "analyst":          self._parse_analyst(recs_raw),
        }

        if data["income_statement"]:   # only cache successful responses
            self._set_cache(cache_key, data)
        return data

    # ── Parsing helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _sf(val: Any) -> Optional[float]:
        """Safe float — returns None for None / NaN."""
        if val is None:
            return None
        try:
            f = float(val)
            return None if f != f else round(f, 2)
        except (TypeError, ValueError):
            return None

    def _parse_income(self, rows: List[Dict]) -> List[Dict]:
        result = []
        for r in sorted(rows, key=lambda x: x.get("date", "")):
            rev = self._sf(r.get("revenue"))
            gp  = self._sf(r.get("grossProfit"))
            oi  = self._sf(r.get("operatingIncome"))
            ni  = self._sf(r.get("netIncome"))
            result.append({
                "date":             r.get("date", "")[:10],
                "revenue":          rev,
                "gross_profit":     gp,
                "ebitda":           self._sf(r.get("ebitda")),
                "operating_income": oi,
                "net_income":       ni,
                "rd_expense":       self._sf(r.get("researchAndDevelopmentExpenses")),
                # Use pre-computed ratios from FMP when direct calc not possible
                "gross_margin":     round(gp / rev, 4) if gp and rev
                                    else self._sf(r.get("grossProfitRatio")),
                "operating_margin": round(oi / rev, 4) if oi and rev
                                    else self._sf(r.get("operatingIncomeRatio")),
                "net_margin":       round(ni / rev, 4) if ni and rev
                                    else self._sf(r.get("netIncomeRatio")),
            })
        return result

    def _parse_balance(self, rows: List[Dict]) -> List[Dict]:
        result = []
        for r in sorted(rows, key=lambda x: x.get("date", "")):
            td   = self._sf(r.get("totalDebt"))
            cash = self._sf(r.get("cashAndCashEquivalents"))
            nd   = self._sf(r.get("netDebt"))
            if nd is None and td is not None and cash is not None:
                nd = round(td - cash, 2)
            result.append({
                "date":              r.get("date", "")[:10],
                "total_assets":      self._sf(r.get("totalAssets")),
                "total_liabilities": self._sf(r.get("totalLiabilities")),
                "equity":            self._sf(r.get("totalStockholdersEquity")),
                "cash":              cash,
                "total_debt":        td,
                "net_debt":          nd,
            })
        return result

    def _parse_cashflow(self, rows: List[Dict]) -> List[Dict]:
        result = []
        for r in sorted(rows, key=lambda x: x.get("date", "")):
            op = self._sf(r.get("operatingCashFlow"))
            cx = self._sf(r.get("capitalExpenditure"))
            fc = self._sf(r.get("freeCashFlow"))
            if fc is None and op is not None and cx is not None:
                fc = round(op + cx, 2)   # capex is negative in FMP
            result.append({
                "date":         r.get("date", "")[:10],
                "operating_cf": op,
                "investing_cf": self._sf(
                    r.get("investingActivitiesCashFlow")
                    or r.get("netCashUsedForInvestingActivites")
                ),
                "financing_cf": self._sf(
                    r.get("financingActivitiesCashFlow")
                    or r.get("netCashUsedProvidedByFinancingActivities")
                ),
                "capex":   cx,
                "free_cf": fc,
            })
        return result

    def _parse_earnings(self, rows: List[Dict]) -> List[Dict]:
        result = []
        for r in sorted(rows, key=lambda x: x.get("date", ""))[-8:]:
            actual   = self._sf(r.get("actualEarningResult"))
            estimate = self._sf(r.get("estimatedEarning"))
            surprise: Optional[float] = None
            if actual is not None and estimate is not None and estimate != 0:
                surprise = round((actual - estimate) / abs(estimate) * 100, 2)
            result.append({
                "date":         r.get("date", "")[:10],
                "period":       r.get("period", ""),
                "eps_actual":   actual,
                "eps_estimate": estimate,
                "surprise_pct": surprise,
            })
        return result

    def _parse_analyst(self, recs: List[Dict]) -> Dict[str, Any]:
        """
        Aggregate individual analyst recommendations into:
          recommendations: {strong_buy, buy, hold, sell, strong_sell}
          price_targets:   {low, mean, high, count}

        Uses only recommendations from the last 90 days.
        """
        cutoff = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

        counts: Dict[str, int] = {
            "strong_buy": 0, "buy": 0, "hold": 0, "sell": 0, "strong_sell": 0,
        }
        targets: List[float] = []

        for r in recs:
            date = (r.get("date") or r.get("publishedDate") or "")[:10]
            if date < cutoff:
                continue

            # Grade → bucket
            grade = (r.get("newGrade") or r.get("analystRating") or "").strip().lower()
            bucket = _GRADE_MAP.get(grade)
            if bucket:
                counts[bucket] += 1

            # Price target
            pt = self._sf(r.get("priceTarget") or r.get("adjPriceTarget"))
            if pt and pt > 0:
                targets.append(pt)

        total = sum(counts.values())
        recommendations = counts if total > 0 else None

        price_targets: Optional[Dict[str, Any]] = None
        if targets:
            price_targets = {
                "low":   round(min(targets), 2),
                "mean":  round(sum(targets) / len(targets), 2),
                "high":  round(max(targets), 2),
                "count": len(targets),
            }

        return {"recommendations": recommendations, "price_targets": price_targets}

    # ─────────────────────────────────────────────────────────────────
    # Public: Batch price quotes (Phase 8.6)
    # ─────────────────────────────────────────────────────────────────

    async def get_batch_quotes(
        self, tickers: List[str], cache_key: str = ""
    ) -> Dict[str, Dict[str, Any]]:
        """
        Batch price quotes via FMP /v3/quote/{symbols}.
        Returns {ticker: {price, change_pct, volume}}.
        Chunks requests (100 tickers/call) to respect URL limits.
        Cache: 60 min (caller supplies cache_key for namespacing).
        """
        if not tickers:
            return {}
        ck = f"batchq:{cache_key or ','.join(sorted(tickers))}"
        cached = self._get_cache(ck, ttl=self.BATCH_QUOTE_TTL)
        if cached is not None:
            return cached

        result: Dict[str, Dict[str, Any]] = {}
        chunk_size = 100
        for i in range(0, len(tickers), chunk_size):
            chunk = tickers[i : i + chunk_size]
            rows = await self._get(f"/quote/{','.join(chunk)}")
            for row in rows:
                sym = (row.get("symbol") or "").strip()
                if not sym:
                    continue
                try:
                    result[sym] = {
                        "price":      round(float(row["price"]), 4),
                        "change_pct": round(float(row.get("changesPercentage") or 0), 3),
                        "volume":     int(row["volume"]) if row.get("volume") is not None else None,
                    }
                except (KeyError, TypeError, ValueError):
                    continue

        self._set_cache(ck, result)
        return result

    # ─────────────────────────────────────────────────────────────────
    # Public: General market news (Phase 8.6)
    # ─────────────────────────────────────────────────────────────────

    async def get_general_news(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        General financial market news via FMP /v4/general_news.
        Not tied to a specific ticker — suitable for home-page news feed.
        Cache: 30 min.
        """
        ck = f"general_news:{limit}"
        cached = self._get_cache(ck, ttl=self.NEWS_TTL)
        if cached is not None:
            return cached

        url    = f"{FMP_V4_BASE}/general_news"
        params = {"page": 0, "apikey": self._api_key}
        loop   = asyncio.get_event_loop()
        rows   = await loop.run_in_executor(None, self._sync_get, url, params)

        result = []
        for item in rows[:limit]:
            title = item.get("title") or ""
            url_  = item.get("url")   or ""
            if not title or not url_:
                continue
            result.append({
                "title":     title,
                "publisher": item.get("site") or "",
                "link":      url_,
                "published": (item.get("publishedDate") or "")[:16],
            })

        self._set_cache(ck, result)
        return result

    # ─────────────────────────────────────────────────────────────────
    # Internal: HTTP + cache
    # ─────────────────────────────────────────────────────────────────

    async def _get(self, path: str) -> List[Dict]:
        """Simple GET — returns list, apikey only."""
        url    = f"{BASE_URL}{path}"
        params = {"apikey": self._api_key}
        loop   = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._sync_get, url, params)

    async def _get_stmt(
        self,
        path: str,
        period: Optional[str] = None,
        limit: int = 8,
    ) -> List[Dict]:
        """GET for financial statement endpoints — supports period + limit."""
        url    = f"{BASE_URL}{path}"
        params: Dict[str, Any] = {"apikey": self._api_key, "limit": limit}
        if period:
            params["period"] = period
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._sync_get, url, params)

    def _sync_get(self, url: str, params: Dict) -> List[Dict]:
        try:
            with httpx.Client(timeout=30) as client:
                resp = client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    if "Error Message" in data:
                        print(f"[FMP] API error: {data['Error Message']}")
                        return []
                    # Some endpoints return {"symbol": ..., "data": [...]}
                    if "data" in data and isinstance(data["data"], list):
                        return data["data"]
                return []
        except Exception as exc:
            print(f"[FMP] Request failed ({url}): {exc}")
            return []

    def _get_cache(self, key: str, ttl: Optional[timedelta] = None) -> Optional[Any]:
        entry = self._cache.get(key)
        if entry is None:
            return None
        value, ts = entry
        effective_ttl = ttl if ttl is not None else self.CACHE_TTL
        if datetime.now() - ts > effective_ttl:
            del self._cache[key]
            return None
        return value

    def _set_cache(self, key: str, value: Any) -> None:
        self._cache[key] = (value, datetime.now())
