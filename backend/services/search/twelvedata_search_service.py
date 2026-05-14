"""
services/search/twelvedata_search_service.py
--------------------------------------------
Twelve Data /symbol_search replacement for YFinanceSearchService.

Commercial use: Allowed on ALL plans including free tier.
Free tier: 800 credits/day — symbol_search costs 1 credit per call.
Endpoint docs: https://twelvedata.com/docs#symbol-search

Returns the same dict shape as YFinanceSearchService:
  { ticker, name, type, exchange, currency }
"""

import os
import asyncio
import httpx
from typing import List, Dict, Any
from datetime import datetime, timedelta

TD_BASE = "https://api.twelvedata.com"

# TD instrument_type → our normalized type names
_TYPE_MAP: Dict[str, str] = {
    "common stock":      "equity",
    "etf":               "etf",
    "index":             "index",
    "digital currency":  "crypto",
    "physical currency": "forex",
    "futures":           "commodity",
    "mutual fund":       "mutual_fund",
}


class TwelveDataSearchService:
    """
    Search instruments via Twelve Data /symbol_search.

    Coverage: stocks, ETFs, indices, crypto, forex, commodities across all
    major exchanges worldwide (~60 exchanges, ~30k+ symbols).
    Latency: ~300-800ms per query (one HTTP call, async).
    """

    CACHE_TTL = timedelta(hours=1)

    def __init__(self) -> None:
        self._api_key: str = os.environ.get("TWELVE_DATA_API_KEY", "")
        self._cache: Dict[str, tuple[List[Dict[str, Any]], datetime]] = {}
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=TD_BASE,
                timeout=httpx.Timeout(10.0, connect=5.0),
            )
        return self._client

    async def search(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Search instruments via /symbol_search.

        Falls back to empty list (not an error) if:
        - API key is not configured (local dev without key)
        - Network or API error
        """
        if not self._api_key:
            return []

        normalized = query.strip()
        if not normalized:
            return []

        cache_key = f"{normalized.lower()}:{limit}"
        cached = self._cache.get(cache_key)
        if cached:
            results, ts = cached
            if datetime.now() - ts < self.CACHE_TTL:
                return results

        try:
            client = self._get_client()
            resp = await client.get(
                "/symbol_search",
                params={"symbol": normalized, "outputsize": limit, "apikey": self._api_key},
            )
            resp.raise_for_status()
            data = resp.json()

            if isinstance(data, dict) and data.get("status") == "error":
                print(f"[TDSearch] API error: {data.get('message')}")
                return []

            items: list = data.get("data", [])
            results = self._parse(items, limit)
            self._cache[cache_key] = (results, datetime.now())
            return results

        except Exception as exc:
            print(f"[TDSearch] search('{query}') failed: {exc}")
            return []

    def _parse(self, items: list, limit: int) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        for item in items[:limit]:
            symbol = item.get("symbol", "").strip()
            if not symbol:
                continue
            raw_type = item.get("instrument_type", "").lower()
            results.append({
                "ticker":   symbol,
                "name":     item.get("instrument_name", symbol),
                "type":     _TYPE_MAP.get(raw_type, raw_type or "equity"),
                "exchange": item.get("exchange", ""),
                "currency": item.get("currency", ""),
            })
        return results

    def clear_cache(self) -> None:
        self._cache.clear()

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
