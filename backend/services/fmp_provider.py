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

# ── CAC 40 constituents (hardcoded — FMP free tier has no /cac40_constituent) ──
_CAC40_STOCKS: list = [
    ("AIR.PA",  "Airbus Group",           "Industrials"),
    ("AI.PA",   "Air Liquide",            "Basic Materials"),
    ("ACA.PA",  "Crédit Agricole",        "Financials"),
    ("ALO.PA",  "Alstom",                 "Industrials"),
    ("MT",      "ArcelorMittal",          "Basic Materials"),
    ("CS.PA",   "AXA",                    "Financials"),
    ("BNP.PA",  "BNP Paribas",            "Financials"),
    ("EN.PA",   "Bouygues",               "Industrials"),
    ("CAP.PA",  "Capgemini",              "Technology"),
    ("CA.PA",   "Carrefour",              "Consumer Defensive"),
    ("BN.PA",   "Danone",                 "Consumer Defensive"),
    ("DSY.PA",  "Dassault Systèmes",      "Technology"),
    ("ENGI.PA", "Engie",                  "Utilities"),
    ("EL.PA",   "EssilorLuxottica",       "Healthcare"),
    ("RMS.PA",  "Hermès",                 "Consumer Cyclical"),
    ("KER.PA",  "Kering",                 "Consumer Cyclical"),
    ("OR.PA",   "L'Oréal",               "Consumer Defensive"),
    ("LR.PA",   "Legrand",                "Industrials"),
    ("MC.PA",   "LVMH",                   "Consumer Cyclical"),
    ("ML.PA",   "Michelin",               "Consumer Cyclical"),
    ("ORA.PA",  "Orange",                 "Communication Services"),
    ("RI.PA",   "Pernod Ricard",          "Consumer Defensive"),
    ("PUB.PA",  "Publicis Groupe",        "Communication Services"),
    ("RNO.PA",  "Renault",                "Consumer Cyclical"),
    ("SAF.PA",  "Safran",                 "Industrials"),
    ("SAN.PA",  "Sanofi",                 "Healthcare"),
    ("SGO.PA",  "Saint-Gobain",           "Basic Materials"),
    ("SU.PA",   "Schneider Electric",     "Technology"),
    ("GLE.PA",  "Société Générale",       "Financials"),
    ("STM",     "STMicroelectronics",     "Technology"),
    ("STLA",    "Stellantis",             "Consumer Cyclical"),
    ("TTE.PA",  "TotalEnergies",          "Energy"),
    ("VIE.PA",  "Veolia",                 "Utilities"),
    ("DG.PA",   "Vinci",                  "Industrials"),
    ("HO.PA",   "Thales",                 "Industrials"),
    ("WLN.PA",  "Worldline",              "Technology"),
    ("ERF.PA",  "Eurofins Scientific",    "Healthcare"),
    ("URW.AS",  "Unibail-Rodamco",        "Real Estate"),
    ("SEB.PA",  "SEB",                    "Consumer Cyclical"),
    ("VIV.PA",  "Vivendi",                "Communication Services"),
]

# ── Commodity ETF proxies (hardcoded weights in USD bn for treemap sizing) ──
_COMMODITY_STOCKS: list = [
    # (ticker, name, sector, approx_weight_usd_bn)
    ("GLD",  "Gold",                    "Precious Metals",   70),
    ("GDX",  "Gold Miners",             "Precious Metals",   12),
    ("SLV",  "Silver",                  "Precious Metals",   14),
    ("PALL", "Palladium",               "Precious Metals",    1),
    ("PPLT", "Platinum",                "Precious Metals",    1),
    ("USO",  "Crude Oil (WTI)",         "Energy",            25),
    ("XLE",  "Energy Stocks",           "Energy",            40),
    ("UNG",  "Natural Gas",             "Energy",             5),
    ("BNO",  "Crude Oil (Brent)",       "Energy",             3),
    ("CORN", "Corn",                    "Agriculture",        1),
    ("WEAT", "Wheat",                   "Agriculture",        2),
    ("SOYB", "Soybeans",                "Agriculture",        1),
    ("JO",   "Coffee",                  "Agriculture",        1),
    ("NIB",  "Cocoa",                   "Agriculture",        1),
    ("BAL",  "Cotton",                  "Agriculture",        1),
    ("CPER", "Copper",                  "Industrial Metals",  2),
    ("DBB",  "Base Metals",             "Industrial Metals",  2),
    ("PDBC", "Diversified Commodities", "Diversified",        8),
]

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

    CACHE_TTL       = timedelta(hours=24)
    FINANCIALS_TTL  = timedelta(hours=72)   # IS/BS/CF barely change
    BATCH_QUOTE_TTL = timedelta(hours=1)
    NEWS_TTL        = timedelta(minutes=30)
    SCREENER_TTL    = timedelta(hours=12)   # 503 tickers × 1 TD credit × 2/day ≈ 1006 credits
    HEATMAP_TTL     = timedelta(hours=1)    # Heatmap batch-quotes refresh

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
                    mc_raw = row.get("marketCap")
                    result[sym] = {
                        "price":      round(float(row["price"]), 4),
                        "change_pct": round(float(row.get("changesPercentage") or 0), 3),
                        "volume":     int(row["volume"]) if row.get("volume") is not None else None,
                        "market_cap": int(float(mc_raw)) if mc_raw not in (None, "", 0, "0") else None,
                        "name":       row.get("name") or "",
                        "sector":     row.get("sector") or "",
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
        General financial market news.

        Primary:   FMP /v4/general_news  — requires paid plan (403 on free tier)
        Secondary: FMP /v3/stock_news    — free tier OK, per-ticker news for
                   a basket of major market names; deduplicated by title.
        Cache: 30 min.
        """
        ck = f"general_news:{limit}"
        cached = self._get_cache(ck, ttl=self.NEWS_TTL)
        if cached is not None:
            return cached

        loop = asyncio.get_event_loop()

        # ── Primary: v4 general news (paid plan) ─────────────────────────────
        rows = await loop.run_in_executor(
            None, self._sync_get,
            f"{FMP_V4_BASE}/general_news",
            {"page": 0, "apikey": self._api_key},
        )

        # ── Secondary: v3 stock news for major tickers (free tier OK) ────────
        if not rows:
            rows = await loop.run_in_executor(
                None, self._sync_get,
                f"{BASE_URL}/stock_news",
                {
                    "tickers": "AAPL,MSFT,GOOGL,AMZN,TSLA,NVDA,META,JPM,SPY,QQQ",
                    "limit":   limit * 3,   # fetch more, deduplicate below
                    "apikey":  self._api_key,
                },
            )

        seen_titles: set = set()
        result: List[Dict[str, Any]] = []
        for item in rows:
            title = (item.get("title") or "").strip()
            url_  = (item.get("url") or item.get("link") or "").strip()
            if not title or not url_ or title in seen_titles:
                continue
            seen_titles.add(title)
            result.append({
                "title":     title,
                "publisher": item.get("site") or "",
                "link":      url_,
                "published": (item.get("publishedDate") or "")[:16],
            })
            if len(result) >= limit:
                break

        self._set_cache(ck, result)
        return result

    # ─────────────────────────────────────────────────────────────────
    # Public: Stock Screener (Phase 11)
    # ─────────────────────────────────────────────────────────────────

    # Map GICS sector names (GitHub CSV) → friendly UI names used by the frontend
    _GICS_SECTOR_MAP: Dict[str, str] = {
        "Information Technology": "Technology",
        "Health Care":            "Healthcare",
        "Consumer Discretionary": "Consumer Cyclical",
        "Consumer Staples":       "Consumer Defensive",
        "Materials":              "Basic Materials",
        "Financials":             "Financials",
        "Energy":                 "Energy",
        "Industrials":            "Industrials",
        "Communication Services": "Communication Services",
        "Real Estate":            "Real Estate",
        "Utilities":              "Utilities",
    }

    @staticmethod
    def _yf_bulk_quotes(tickers: List[str]) -> Dict[str, Dict]:
        """
        Bulk quotes via yfinance.download() — no API key, same source as /simulate.

        yfinance uses Yahoo Finance /v8/finance/chart per ticker (parallel threads).
        Returns price, change %, volume.  Exchange is NOT available via this route.
        """
        import yfinance as yf
        import pandas as pd

        if not tickers:
            return {}

        result: Dict[str, Dict] = {}
        chunk_size = 200   # yfinance handles large lists well via threads

        for i in range(0, len(tickers), chunk_size):
            chunk = tickers[i : i + chunk_size]
            chunk_num = i // chunk_size + 1
            try:
                raw = yf.download(
                    tickers=" ".join(chunk),
                    period="5d",
                    auto_adjust=True,
                    progress=False,
                    threads=True,
                )
                if raw is None or raw.empty:
                    print(f"[yf screener] chunk {chunk_num}: empty DataFrame")
                    continue

                if len(chunk) == 1:
                    # Single ticker — flat column names
                    closes = raw["Close"].dropna() if "Close" in raw.columns else pd.Series()
                    vols   = raw["Volume"].dropna() if "Volume" in raw.columns else pd.Series()
                    if len(closes) >= 1:
                        chg = float(((closes.iloc[-1] / closes.iloc[-2]) - 1) * 100) if len(closes) > 1 else 0.0
                        result[chunk[0]] = {
                            "price":      float(closes.iloc[-1]),
                            "change_pct": chg,
                            "volume":     int(vols.iloc[-1]) if not vols.empty else 0,
                            "exchange":   "",
                            "name":       "",
                        }
                else:
                    # Multi-ticker — columns: (Price, Ticker) or (Ticker, Price)
                    # yfinance 0.2.x uses level-0 = price type, level-1 = ticker
                    try:
                        close_df  = raw["Close"]    # DataFrame: date × ticker
                        volume_df = raw.get("Volume") if isinstance(raw.get("Volume"), pd.DataFrame) else None
                    except KeyError:
                        print(f"[yf screener] chunk {chunk_num}: no Close column")
                        continue

                    for ticker in chunk:
                        try:
                            closes = close_df[ticker].dropna() if ticker in close_df.columns else pd.Series()
                            if closes.empty:
                                continue
                            vols = (
                                volume_df[ticker].dropna()
                                if (volume_df is not None and ticker in volume_df.columns)
                                else pd.Series()
                            )
                            chg = float(((closes.iloc[-1] / closes.iloc[-2]) - 1) * 100) if len(closes) > 1 else 0.0
                            result[ticker] = {
                                "price":      float(closes.iloc[-1]),
                                "change_pct": chg,
                                "volume":     int(vols.iloc[-1]) if not vols.empty else 0,
                                "exchange":   "",
                                "name":       "",
                            }
                        except (KeyError, IndexError, TypeError, ValueError):
                            pass

            except Exception as exc:
                print(f"[yf screener] chunk {chunk_num} error: {exc}")

        print(f"[yf screener] {len(result)}/{len(tickers)} quotes fetched")
        return result

    @staticmethod
    def _sync_td_quotes(tickers: List[str]) -> Dict[str, Dict]:
        """
        Bulk quotes via Twelve Data /quote — optional, for exchange name enrichment.

        Each symbol = 1 credit.  Free plan: 800 credits/day.
        Throttled at 0.5 s/chunk to respect the 8 req/min free-tier rate limit.
        Falls back gracefully if key is not set or credits are exhausted.
        """
        import time

        api_key = os.getenv("TWELVE_DATA_API_KEY", "")
        if not api_key:
            return {}   # Not set — silent, yfinance is the primary source

        result: Dict[str, Dict] = {}
        chunk_size = 55

        for i in range(0, len(tickers), chunk_size):
            chunk     = tickers[i : i + chunk_size]
            chunk_num = i // chunk_size + 1
            try:
                with httpx.Client(timeout=30) as c:
                    resp = c.get(
                        "https://api.twelvedata.com/quote",
                        params={"symbol": ",".join(chunk), "apikey": api_key},
                    )
                    resp.raise_for_status()
                    data = resp.json()

                # Top-level API error (e.g. 429 rate-limit, 401 auth)
                if isinstance(data, dict) and data.get("code"):
                    print(f"[TD screener] chunk {chunk_num} error: "
                          f"code={data.get('code')} msg={data.get('message', '')}")
                    break

                if isinstance(data, dict):
                    items = (
                        data.items() if len(chunk) > 1 else [(chunk[0], data)]
                    )
                    for sym, q in items:
                        if not isinstance(q, dict):
                            continue
                        if q.get("code") or q.get("status") == "error":
                            continue
                        try:
                            price = float(q.get("close") or 0)
                            if price <= 0:
                                continue
                            result[sym] = {
                                "price":      price,
                                "change_pct": float(q.get("percent_change") or 0),
                                "volume":     int(float(q.get("volume") or 0)),
                                "exchange":   q.get("exchange") or "",
                                "name":       q.get("name") or "",
                            }
                        except (TypeError, ValueError):
                            pass

                if i + chunk_size < len(tickers):
                    time.sleep(0.5)

            except Exception as exc:
                print(f"[TD screener] chunk {chunk_num} error: {exc}")

        print(f"[TD screener] {len(result)}/{len(tickers)} quotes fetched")
        return result

    async def _get_screener_universe(self) -> List[Dict[str, Any]]:
        """
        Build screener universe: S&P 500 constituents + live quotes.

        Source hierarchy:
          Constituents : GitHub CSV   (free, cached 24 h)
          Quotes (primary): yfinance.download() — no API key, parallel, reliable
          Quotes (secondary): Twelve Data /quote — enriches with exchange name if key set

        Sectors normalised from GICS → friendly UI names via _GICS_SECTOR_MAP.
        Universe cached 12 h ONLY when price data is available (no stale empty cache).
        """
        ck = "screener_universe_sp500"
        cached = self._get_cache(ck, ttl=self.SCREENER_TTL)
        if cached is not None:
            return cached

        # Step 1: S&P 500 tickers + sectors from GitHub CSV (cached 24 h)
        from services.indices.csv_provider import CsvProvider
        constituents = await CsvProvider().get_constituents("SP500")

        sector_map = {c["ticker"]: c.get("sector", "") for c in constituents}
        name_map   = {c["ticker"]: c.get("name",   "") for c in constituents}
        tickers    = [c["ticker"] for c in constituents if c.get("ticker")]

        if not tickers:
            print("[Screener] SP500 CSV empty — cannot build universe")
            return []

        loop = asyncio.get_event_loop()

        # Step 2a: yfinance bulk download — primary (price, change%, volume)
        yf_map: Dict[str, Dict] = await loop.run_in_executor(
            None, self._yf_bulk_quotes, tickers
        )

        # Step 2b: Twelve Data — optional (exchange name enrichment)
        td_map: Dict[str, Dict] = {}
        if os.getenv("TWELVE_DATA_API_KEY"):
            td_map = await loop.run_in_executor(
                None, self._sync_td_quotes, tickers
            )

        # Step 3: Merge — yf provides prices, TD provides exchange when available
        result: List[Dict[str, Any]] = []
        for ticker in tickers:
            yf_q = yf_map.get(ticker)   # price/chg/vol or None
            td_q = td_map.get(ticker)   # exchange/name or None

            gics_sector     = sector_map.get(ticker, "")
            friendly_sector = self._GICS_SECTOR_MAP.get(gics_sector, gics_sector)

            result.append({
                "ticker":     ticker,
                "name":       name_map.get(ticker) or (td_q.get("name") if td_q else "") or ticker,
                "price":      self._sf(yf_q["price"])      if yf_q else (self._sf(td_q["price"])      if td_q else None),
                "change_pct": self._sf(yf_q["change_pct"]) if yf_q else (self._sf(td_q["change_pct"]) if td_q else None),
                "volume":     int(yf_q["volume"])           if yf_q else (int(td_q["volume"])           if td_q else 0),
                "exchange":   (td_q.get("exchange") or "")  if td_q else "",
                "sector":     friendly_sector,
            })

        prices_found = sum(1 for r in result if r["price"] is not None)
        print(f"[Screener] universe ready: {len(result)} stocks, "
              f"{prices_found} with prices, "
              f"{sum(1 for r in result if r['exchange'])} with exchange")

        # Only cache if we have real price data — prevents stale empty cache
        if result and prices_found > 0:
            self._set_cache(ck, result)
        return result

    async def get_screener(
        self,
        sector:   str = "",
        exchange: str = "",
        limit:    int = 50,
    ) -> List[Dict[str, Any]]:
        """
        Screen S&P 500 universe by sector and/or exchange (in-memory filter).
        Universe is built once by _get_screener_universe() and cached 12 h.
        Exchange filter: only applied when a stock has non-empty exchange data.
        """
        universe = await self._get_screener_universe()

        result: List[Dict[str, Any]] = []
        for s in universe:
            if sector and s.get("sector") != sector:
                continue
            # Exchange filter: skip only when we HAVE exchange data AND it doesn't match
            if exchange and s.get("exchange") and s["exchange"].upper() != exchange.upper():
                continue
            result.append(s)

        return result[:limit]

    # ─────────────────────────────────────────────────────────────────
    # Public: Heatmap data (Phase 18)
    # ─────────────────────────────────────────────────────────────────

    async def get_heatmap_data(self, index: str) -> List[Dict[str, Any]]:
        """
        Return [{ticker, name, sector, price, change_pct, market_cap}] for a given index.

        Supported:
          sp500      — S&P 500 (503 stocks via GitHub CSV + FMP batch quotes)
          nasdaq100  — Nasdaq 100 (FMP /nasdaq_constituent + batch quotes)
          dowjones   — Dow Jones 30 (FMP /dowjones_constituent + batch quotes)
          cac40      — CAC 40 (hardcoded ticker list + FMP batch quotes)
          commodities — Commodity ETF proxies (hardcoded weights, live prices)

        Cache: 1 h (HEATMAP_TTL). Falls back gracefully when FMP has no market cap.
        """
        idx = index.lower().strip()
        cache_key = f"heatmap_data:{idx}"
        cached = self._get_cache(cache_key, ttl=self.HEATMAP_TTL)
        if cached is not None:
            return cached

        # ── Build ticker / sector / name maps ─────────────────────────────────
        tickers:      List[str]       = []
        name_map:     Dict[str, str]  = {}
        sector_map:   Dict[str, str]  = {}
        weight_map:   Dict[str, float] = {}  # commodity fallback weights

        if idx == "sp500":
            from services.indices.csv_provider import CsvProvider
            constituents = await CsvProvider().get_constituents("SP500")
            for c in constituents:
                t = c.get("ticker", "").strip()
                if not t:
                    continue
                tickers.append(t)
                name_map[t]   = c.get("name", "")
                gics          = c.get("sector", "")
                sector_map[t] = self._GICS_SECTOR_MAP.get(gics, gics) or "Other"

        elif idx in ("nasdaq100", "dowjones"):
            fmp_key  = {"nasdaq100": "NDX", "dowjones": "DJI"}[idx]
            consts   = await self.get_index_constituents(fmp_key)
            for c in consts:
                t = c.get("ticker", "").strip()
                if not t:
                    continue
                tickers.append(t)
                name_map[t]   = c.get("name", "")
                raw_sec       = c.get("sector", "")
                sector_map[t] = self._GICS_SECTOR_MAP.get(raw_sec, raw_sec) or "Other"

        elif idx == "cac40":
            for t, name, sector in _CAC40_STOCKS:
                tickers.append(t)
                name_map[t]   = name
                sector_map[t] = sector

        elif idx == "commodities":
            for t, name, sector, weight in _COMMODITY_STOCKS:
                tickers.append(t)
                name_map[t]    = name
                sector_map[t]  = sector
                weight_map[t]  = float(weight) * 1e9   # convert bn → units

        else:
            print(f"[Heatmap] Unknown index: {idx!r}")
            return []

        if not tickers:
            return []

        # ── Fetch live quotes (price + change_pct + market_cap) ───────────────
        quotes = await self.get_batch_quotes(
            tickers, cache_key=f"heatmap_{idx}"
        )

        # ── Merge ─────────────────────────────────────────────────────────────
        result: List[Dict[str, Any]] = []
        for ticker in tickers:
            q  = quotes.get(ticker, {})
            mc = q.get("market_cap")
            # Commodity fallback: use hardcoded weight if FMP marketCap unavailable
            if mc is None and idx == "commodities":
                mc = weight_map.get(ticker, 1e9)

            result.append({
                "ticker":     ticker,
                "name":       name_map.get(ticker) or q.get("name", ticker),
                "sector":     sector_map.get(ticker) or q.get("sector") or "Other",
                "price":      q.get("price"),
                "change_pct": q.get("change_pct"),
                "market_cap": mc,
            })

        prices_found = sum(1 for r in result if r["price"] is not None)
        print(f"[Heatmap:{idx}] {len(result)} stocks, {prices_found} with prices")

        if result and prices_found > 0:
            self._set_cache(cache_key, result)
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
                        print(f"[FMP] API error ({url}): {data['Error Message']}")
                        return []
                    if "message" in data:
                        print(f"[FMP] API message ({url}): {data['message']}")
                        return []
                    # Some endpoints return {"symbol": ..., "data": [...]}
                    if "data" in data and isinstance(data["data"], list):
                        return data["data"]
                    # Log unexpected dict so we can debug
                    print(f"[FMP] Unexpected dict response ({url}): {list(data.keys())}")
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
