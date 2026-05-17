"""
services/search/yahoo_finance_search_service.py
-----------------------------------------------
Yahoo Finance search API — free, no key required, global coverage.

Endpoint : https://query1.finance.yahoo.com/v1/finance/search
Coverage : all Yahoo Finance symbols — equities, ETFs, indices, crypto,
           forex, futures, mutual funds — across all major exchanges.
           Finds MSTR, AMUN.PA, TTE.PA, 9984.T, etc. without any API key.

Rate limit : unofficial ~2 000 req/h per IP (well within demo usage).
Cache      : results are cached 1 hour per query string.
"""

from __future__ import annotations

import httpx
from datetime import datetime, timedelta
from typing import Any, Dict, List

_YF_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

_TYPE_MAP: Dict[str, str] = {
    "EQUITY":         "equity",
    "ETF":            "etf",
    "INDEX":          "index",
    "CRYPTOCURRENCY": "crypto",
    "CURRENCY":       "forex",
    "FUTURE":         "commodity",
    "MUTUALFUND":     "mutual_fund",
}


class YahooFinanceSearchService:
    """Yahoo Finance free search — global ticker + name lookup."""

    CACHE_TTL = timedelta(hours=1)

    def __init__(self) -> None:
        self._cache: Dict[str, tuple[List[Dict[str, Any]], datetime]] = {}
        self._client: httpx.AsyncClient | None = None

    # ─────────────────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────────────────

    async def search(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Search for instruments via Yahoo Finance.

        Returns list of {ticker, name, type, exchange, currency}.
        Never raises — returns [] on any network / parse error.
        """
        q = query.strip()
        if not q:
            return []

        cache_key = f"{q.lower()}:{limit}"
        cached = self._cache.get(cache_key)
        if cached:
            results, ts = cached
            if datetime.now() - ts < self.CACHE_TTL:
                return results

        try:
            client = self._get_client()
            resp   = await client.get(
                _YF_SEARCH_URL,
                params={
                    "q":               q,
                    "quotesCount":     limit,
                    "newsCount":       0,
                    "enableFuzzyQuery": "true",
                    "lang":            "en-US",
                },
            )
            resp.raise_for_status()
            quotes  = resp.json().get("quotes", [])
            results = self._parse(quotes, limit)
            self._cache[cache_key] = (results, datetime.now())
            return results

        except Exception as exc:
            print(f"[YFSearch] search('{q}') failed: {exc}")
            return []

    def clear_cache(self) -> None:
        self._cache.clear()

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ─────────────────────────────────────────────────────────────────────────
    # Internal
    # ─────────────────────────────────────────────────────────────────────────

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                headers={"User-Agent": _UA, "Accept": "application/json"},
                timeout=httpx.Timeout(10.0, connect=5.0),
            )
        return self._client

    def _parse(self, quotes: list, limit: int) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        for item in quotes[:limit * 2]:          # over-fetch before filtering
            symbol = (item.get("symbol") or "").strip()
            if not symbol:
                continue
            quote_type = (item.get("quoteType") or "").upper()
            # Skip options — they pollute search results with noisy strikes/expiries
            if quote_type == "OPTION":
                continue
            name = item.get("longname") or item.get("shortname") or symbol
            results.append({
                "ticker":   symbol,
                "name":     name,
                "type":     _TYPE_MAP.get(quote_type, "equity"),
                "exchange": item.get("exchDisp") or item.get("exchange") or "",
                "currency": "",   # not returned by search — filled from quote call
            })
            if len(results) >= limit:
                break
        return results
