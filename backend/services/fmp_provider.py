"""
Shared Financial Modeling Prep (FMP) client.

Free tier: 250 calls/day — cache everything 24h to stay within limits.

Endpoints used:
  GET /v3/sp500_constituent         → S&P 500 constituents
  GET /v3/nasdaq_constituent        → Nasdaq 100 constituents
  GET /v3/dowjones_constituent      → Dow Jones 30 constituents
  GET /v3/etf-holder/{symbol}       → ETF holdings with weightPercentage
"""

import os
import asyncio
import httpx
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

BASE_URL = "https://financialmodelingprep.com/api/v3"

INDEX_ENDPOINTS: Dict[str, str] = {
    "SP500": "/sp500_constituent",
    "NDX":   "/nasdaq_constituent",
    "DJI":   "/dowjones_constituent",
}

# Singleton — shared across the app
_instance: Optional["FMPProvider"] = None


def get_fmp_provider() -> "FMPProvider":
    global _instance
    if _instance is None:
        _instance = FMPProvider()
    return _instance


class FMPProvider:
    """Financial Modeling Prep API client with in-memory 24h cache."""

    CACHE_TTL = timedelta(hours=24)

    def __init__(self, api_key: Optional[str] = None) -> None:
        self._api_key = api_key or os.getenv("FMP_API_KEY", "")
        self._cache: Dict[str, tuple] = {}

    # ─────────────────────────────────────────────────────────────────
    # Public: index constituents
    # ─────────────────────────────────────────────────────────────────

    async def get_index_constituents(self, symbol: str) -> List[Dict[str, Any]]:
        """Return [{ticker, name, sector, sub_sector}] for a US index.

        Supported symbols: SP500, NDX, DJI.
        Raises ValueError if symbol is not supported.
        """
        endpoint = INDEX_ENDPOINTS.get(symbol.upper())
        if not endpoint:
            raise ValueError(
                f"FMP has no constituent endpoint for '{symbol}'. "
                f"Supported: {list(INDEX_ENDPOINTS)}"
            )

        cache_key = f"constituents:{symbol.upper()}"
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached

        raw = await self._get(endpoint)
        result = [
            {
                "ticker": (item.get("symbol") or "").strip(),
                "name": item.get("name") or item.get("companyName") or "",
                "sector": item.get("sector") or "",
                "sub_sector": item.get("subSector") or "",
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
        result = [
            {
                "ticker": (item.get("asset") or "").strip(),
                "name": item.get("name") or (item.get("asset") or ""),
                "weight_pct": round(float(item.get("weightPercentage") or 0), 3),
            }
            for item in raw
            if (item.get("asset") or "").strip()
        ]
        result.sort(key=lambda x: x["weight_pct"], reverse=True)
        result = result[:25]

        self._set_cache(cache_key, result)
        return result

    # ─────────────────────────────────────────────────────────────────
    # Internal: HTTP + cache
    # ─────────────────────────────────────────────────────────────────

    async def _get(self, path: str) -> List[Dict]:
        url = f"{BASE_URL}{path}"
        params = {"apikey": self._api_key}
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
                if isinstance(data, dict) and "Error Message" in data:
                    print(f"[FMP] API error: {data['Error Message']}")
                    return []
                return []
        except Exception as exc:
            print(f"[FMP] Request failed ({url}): {exc}")
            return []

    def _get_cache(self, key: str) -> Optional[Any]:
        entry = self._cache.get(key)
        if entry is None:
            return None
        value, ts = entry
        if datetime.now() - ts > self.CACHE_TTL:
            del self._cache[key]
            return None
        return value

    def _set_cache(self, key: str, value: Any) -> None:
        self._cache[key] = (value, datetime.now())
