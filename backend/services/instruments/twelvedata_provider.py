"""
services/instruments/twelvedata_provider.py
-------------------------------------------
Commercial-friendly replacement for yfinance.
Uses Twelve Data REST API (https://api.twelvedata.com).

Commercial use: Allowed on ALL plans including free tier.
Free tier: 800 API credits/day, 8 requests/min.
Docs: https://twelvedata.com/docs

Notes on free-tier limitations:
  - /statistics (fundamentals) requires Growth plan+
  - /financials requires paid plan
  - /quote, /time_series, /news, /symbol_search are free
"""

import os
import httpx
from datetime import datetime
from typing import Dict, List, Any, Optional

from .base_provider import BaseInstrumentProvider

TD_BASE = "https://api.twelvedata.com"

# ─────────────────────────────────────────────────────────────────────────────
# Symbol mapping: yfinance format → Twelve Data format
# ─────────────────────────────────────────────────────────────────────────────

SYMBOL_MAP: Dict[str, str] = {
    # ── US Indices ────────────────────────────────────────────────────────────
    "^GSPC":  "SPX",
    "^NDX":   "NDX",
    "^DJI":   "DJI",
    "^VIX":   "VIX",
    "^RUT":   "RUT2000",
    "^IXIC":  "COMP",
    "^TNX":   "US10Y",
    "^TYX":   "US30Y",
    # ── International Indices ─────────────────────────────────────────────────
    "^FTSE":  "FTSE100",
    "^N225":  "N225",
    "^DAX":   "DAX40",
    "^FCHI":  "CAC40",
    "^HSI":   "HSI",
    "^AXJO":  "ASX200",
    # ── Commodities (futures → TD spot proxies) ───────────────────────────────
    "GC=F":   "XAU/USD",
    "CL=F":   "WTI/USD",
    "SI=F":   "XAG/USD",
    "NG=F":   "NATURALGAS/USD",
    "HG=F":   "COPPER/USD",
    "ZC=F":   "CORN/USD",
    "ZW=F":   "WHEAT/USD",
    "PL=F":   "XPT/USD",
    # ── Crypto (yfinance "BTC-USD" → TD "BTC/USD") ────────────────────────────
    "BTC-USD": "BTC/USD",
    "ETH-USD": "ETH/USD",
    "BNB-USD": "BNB/USD",
    "SOL-USD": "SOL/USD",
    "XRP-USD": "XRP/USD",
    "ADA-USD": "ADA/USD",
    "DOGE-USD": "DOGE/USD",
    # ── Forex (yfinance "EURUSD=X" → TD "EUR/USD") ────────────────────────────
    "EURUSD=X": "EUR/USD",
    "GBPUSD=X": "GBP/USD",
    "USDJPY=X": "USD/JPY",
    "USDCHF=X": "USD/CHF",
    "AUDUSD=X": "AUD/USD",
    "USDCAD=X": "USD/CAD",
    "NZDUSD=X": "NZD/USD",
    "EURGBP=X": "EUR/GBP",
    "EURJPY=X": "EUR/JPY",
    "GBPJPY=X": "GBP/JPY",
}

# Reverse: TD symbol → yfinance symbol (for display)
REVERSE_SYMBOL_MAP: Dict[str, str] = {v: k for k, v in SYMBOL_MAP.items()}


def map_symbol(ticker: str) -> str:
    """Convert yfinance ticker format to Twelve Data format."""
    return SYMBOL_MAP.get(ticker, ticker)


# ─────────────────────────────────────────────────────────────────────────────
# Period / interval helpers
# ─────────────────────────────────────────────────────────────────────────────

# Period → number of daily bars
PERIOD_TO_OUTPUTSIZE: Dict[str, int] = {
    "1d":  2,
    "5d":  5,
    "1mo": 31,
    "3mo": 92,
    "6mo": 184,
    "1y":  365,
    "2y":  730,
    "5y":  1825,
    "10y": 3650,
    "ytd": 365,
    "max": 5000,
}

# yfinance interval → Twelve Data interval
INTERVAL_MAP: Dict[str, str] = {
    "1m":  "1min",
    "2m":  "2min",
    "5m":  "5min",
    "15m": "15min",
    "30m": "30min",
    "60m": "1h",
    "90m": "90min",
    "1h":  "1h",
    "1d":  "1day",
    "5d":  "1week",
    "1wk": "1week",
    "1mo": "1month",
    "3mo": "1month",
}

# Number of bars for a single intraday session
INTRADAY_OUTPUTSIZE: Dict[str, int] = {
    "1min":  390,
    "2min":  195,
    "5min":  78,
    "15min": 26,
    "30min": 13,
    "1h":    8,
    "90min": 5,
}


# ─────────────────────────────────────────────────────────────────────────────
# Provider class
# ─────────────────────────────────────────────────────────────────────────────

class TwelveDataProvider(BaseInstrumentProvider):
    """
    Twelve Data REST API provider.

    Commercial use: allowed on all plans (including free).
    Rate limit: 8 req/min, 800 credits/day on free tier.
    """

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=TD_BASE,
                timeout=httpx.Timeout(15.0, connect=5.0),
            )
        return self._client

    async def _get(self, path: str, **params) -> dict:
        """Authenticated GET request to Twelve Data API."""
        params["apikey"] = self.api_key
        client = self._get_client()
        resp = await client.get(path, params=params)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict) and data.get("status") == "error":
            raise ValueError(
                f"Twelve Data API error [{data.get('code', '?')}]: "
                f"{data.get('message', 'unknown')}"
            )
        return data

    async def close(self):
        """Close the underlying HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ─────────────────────────────────────────────────────────────────────────
    # Quote
    # ─────────────────────────────────────────────────────────────────────────

    async def get_quote(self, ticker: str) -> Dict[str, Any]:
        """Get real-time quote from Twelve Data /quote endpoint."""
        symbol = map_symbol(ticker)
        try:
            data = await self._get("/quote", symbol=symbol)
            price      = float(data.get("close") or data.get("price") or 0)
            prev_close = float(data.get("previous_close") or 0)
            change     = float(data.get("change") or (price - prev_close))
            change_pct = float(data.get("percent_change") or (
                (change / prev_close * 100) if prev_close else 0
            ))
            return {
                "ticker":         ticker,
                "price":          round(price, 4),
                "previous_close": round(prev_close, 4),
                "change":         round(change, 4),
                "change_pct":     round(change_pct, 4),
                "volume":         int(data.get("volume") or 0),
                "market_cap":     None,
                "timestamp":      datetime.now().isoformat(),
                "name":           data.get("name", ""),
                "exchange":       data.get("exchange", ""),
                "currency":       data.get("currency", "USD"),
            }
        except Exception as e:
            raise ValueError(f"[TD] get_quote({ticker}): {e}")

    async def get_batch_quotes(
        self,
        tickers: List[str],
    ) -> Dict[str, Dict[str, Any]]:
        """
        Batch quote — single /quote call for multiple symbols.
        TD returns a dict {symbol: quote} when multiple symbols are requested.
        """
        symbols = [map_symbol(t) for t in tickers]
        sym_str = ",".join(symbols)
        try:
            raw = await self._get("/quote", symbol=sym_str)
        except Exception as e:
            raise ValueError(f"[TD] get_batch_quotes: {e}")

        # Single symbol → TD returns the quote dict directly
        # Multiple symbols → TD returns {symbol: quote, ...}
        if isinstance(raw, dict) and raw.get("symbol"):
            quote_map: Dict[str, dict] = {raw["symbol"]: raw}
        else:
            quote_map = raw  # type: ignore[assignment]

        results: Dict[str, Dict[str, Any]] = {}
        for i, ticker in enumerate(tickers):
            sym = symbols[i]
            q   = quote_map.get(sym, {}) if isinstance(quote_map, dict) else {}
            if not q or (isinstance(q, dict) and q.get("status") == "error"):
                results[ticker] = {"error": q.get("message", "not found") if q else "not found"}
                continue
            try:
                price      = float(q.get("close") or q.get("price") or 0)
                prev_close = float(q.get("previous_close") or 0)
                change     = float(q.get("change") or (price - prev_close))
                change_pct = float(q.get("percent_change") or (
                    (change / prev_close * 100) if prev_close else 0
                ))
                results[ticker] = {
                    "ticker":     ticker,
                    "price":      round(price, 4),
                    "change":     round(change, 4),
                    "change_pct": round(change_pct, 4),
                    "volume":     int(q.get("volume") or 0),
                    "name":       q.get("name", ""),
                    "exchange":   q.get("exchange", ""),
                    "currency":   q.get("currency", "USD"),
                    "timestamp":  datetime.now().isoformat(),
                }
            except Exception as ex:
                results[ticker] = {"error": str(ex)}

        return results

    # ─────────────────────────────────────────────────────────────────────────
    # Time Series (historical + intraday)
    # ─────────────────────────────────────────────────────────────────────────

    async def get_historical(
        self,
        ticker: str,
        period: str = "1y",
        interval: str = "1d",
    ) -> List[Dict[str, Any]]:
        """Get historical OHLCV from /time_series."""
        symbol      = map_symbol(ticker)
        td_interval = INTERVAL_MAP.get(interval, "1day")
        outputsize  = PERIOD_TO_OUTPUTSIZE.get(period, 365)
        try:
            data = await self._get(
                "/time_series",
                symbol=symbol,
                interval=td_interval,
                outputsize=outputsize,
                order="ASC",
                dp=4,
            )
            return self._parse_bars(data.get("values", []))
        except Exception as e:
            raise ValueError(f"[TD] get_historical({ticker}): {e}")

    async def get_intraday(
        self,
        ticker: str,
        interval: str = "1h",
    ) -> List[Dict[str, Any]]:
        """Get intraday OHLCV bars from /time_series."""
        symbol      = map_symbol(ticker)
        td_interval = INTERVAL_MAP.get(interval, "1h")
        outputsize  = INTRADAY_OUTPUTSIZE.get(td_interval, 50)
        try:
            data = await self._get(
                "/time_series",
                symbol=symbol,
                interval=td_interval,
                outputsize=outputsize,
                order="ASC",
                dp=4,
            )
            return self._parse_bars(data.get("values", []))
        except Exception as e:
            raise ValueError(f"[TD] get_intraday({ticker}): {e}")

    @staticmethod
    def _parse_bars(values: list) -> List[Dict[str, Any]]:
        """Parse Twelve Data time_series values into standard OHLCV format."""
        result = []
        for bar in values:
            try:
                result.append({
                    "date":   bar["datetime"],
                    "open":   float(bar["open"]),
                    "high":   float(bar["high"]),
                    "low":    float(bar["low"]),
                    "close":  float(bar["close"]),
                    "volume": int(bar.get("volume") or 0),
                })
            except (KeyError, ValueError, TypeError):
                continue
        return result

    # ─────────────────────────────────────────────────────────────────────────
    # Fundamentals (requires Growth plan; raises ValueError on free tier)
    # ─────────────────────────────────────────────────────────────────────────

    async def get_fundamentals(self, ticker: str) -> Dict[str, Any]:
        """
        Get fundamentals via /statistics.

        NOTE: This endpoint requires a paid Twelve Data plan.
        On free tier, raises ValueError → caller should fall back to yfinance.
        """
        symbol = map_symbol(ticker)
        try:
            data = await self._get("/statistics", symbol=symbol)

            stats      = data.get("statistics", {})
            valuations = stats.get("valuations_metrics", {})
            fins       = stats.get("financials", {})
            balance    = stats.get("balance_sheet", {})
            income     = stats.get("income_statement", {})
            price_sum  = stats.get("stock_price_summary", {})
            meta       = data.get("meta", {})

            def _f(d: dict, *keys) -> Optional[float]:
                for k in keys:
                    v = d.get(k)
                    if v is not None:
                        try:
                            f = float(v)
                            return None if f != f else round(f, 4)
                        except (TypeError, ValueError):
                            pass
                return None

            return {
                "ticker":         ticker,
                "type":           meta.get("type", "equity"),
                "name":           meta.get("name", ticker),
                "sector":         data.get("sector", ""),
                "industry":       data.get("industry", ""),
                "market_cap":     _f(valuations, "market_capitalization"),
                "pe_ratio":       _f(valuations, "pe_ratio", "trailing_pe"),
                "pb_ratio":       _f(valuations, "price_to_book_mrq"),
                "dividend_yield": _f(fins,       "dividend_yield"),
                "roe":            _f(fins,        "return_on_equity_ttm"),
                "debt_to_equity": _f(balance,     "total_debt_to_equity_mrq"),
                "revenue_ttm":    _f(income,       "revenue_ttm"),
                "gross_margin":   _f(fins,          "gross_profit_margin_ttm"),
                "eps":            _f(fins,           "diluted_eps_ttm"),
                "52_week_high":   _f(price_sum,     "52_week_high"),
                "52_week_low":    _f(price_sum,     "52_week_low"),
                "beta":           _f(price_sum,     "beta"),
            }
        except Exception as e:
            raise ValueError(f"[TD] get_fundamentals({ticker}): {e}")

    # ─────────────────────────────────────────────────────────────────────────
    # News
    # ─────────────────────────────────────────────────────────────────────────

    async def get_news(self, ticker: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Get latest news articles from Twelve Data /news."""
        symbol = map_symbol(ticker)
        try:
            data     = await self._get("/news", symbol=symbol, outputsize=limit)
            articles = (
                data if isinstance(data, list)
                else data.get("news", data.get("data", []))
            )
            result = []
            for item in articles[:limit]:
                title = item.get("title", "")
                url   = item.get("url", "")
                if not title or not url:
                    continue
                result.append({
                    "title":        title,
                    "summary":      item.get("snippet", item.get("description", "")),
                    "publisher":    item.get("source", item.get("publisher", "")),
                    "url":          url,
                    "published_at": item.get("published_at", item.get("datetime", "")),
                    "thumbnail":    item.get("thumbnail_url", None),
                })
            return result
        except Exception as e:
            print(f"[TD] get_news({ticker}) failed: {e}")
            return []

    # ─────────────────────────────────────────────────────────────────────────
    # Search
    # ─────────────────────────────────────────────────────────────────────────

    async def search(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search instruments via /symbol_search."""
        try:
            data  = await self._get("/symbol_search", symbol=query, outputsize=limit)
            items = data.get("data", [])

            type_map = {
                "common stock":      "equity",
                "etf":               "etf",
                "index":             "index",
                "digital currency":  "crypto",
                "physical currency": "forex",
                "futures":           "commodity",
                "mutual fund":       "mutual_fund",
            }
            return [
                {
                    "ticker":   item.get("symbol", ""),
                    "name":     item.get("instrument_name", ""),
                    "type":     type_map.get(
                        item.get("instrument_type", "").lower(), "equity"
                    ),
                    "exchange": item.get("exchange", ""),
                    "currency": item.get("currency", "USD"),
                }
                for item in items[:limit]
                if item.get("symbol")
            ]
        except Exception as e:
            print(f"[TD] search({query}) failed: {e}")
            return [{
                "ticker":   query.upper(),
                "name":     query.upper(),
                "type":     "equity",
                "exchange": "",
                "currency": "USD",
            }]

    # ─────────────────────────────────────────────────────────────────────────
    # Not supported on free tier — raise to trigger yfinance fallback
    # ─────────────────────────────────────────────────────────────────────────

    async def get_financials_data(
        self,
        ticker: str,
        period: str = "annual",
    ) -> Dict[str, Any]:
        """
        Financial statements — NOT available on Twelve Data free tier.
        Raises NotImplementedError so the caller falls back to yfinance.
        """
        raise NotImplementedError(
            "Financial statements require a paid Twelve Data plan. "
            "Using yfinance fallback."
        )
