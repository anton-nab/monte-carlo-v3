"""YFinance-based search service.

Uses yfinance.Search to query Yahoo Finance's global instrument database
(stocks, ETFs, indices, FX, crypto, commodities — all markets worldwide).
"""

import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import yfinance as yf


class YFinanceSearchService:
    """Search instruments via Yahoo Finance global database.

    Coverage: 100k+ instruments across all major exchanges worldwide.
    Latency: ~500-1500ms per query (synchronous yfinance call wrapped
    in a thread pool).
    """

    CACHE_TTL = timedelta(hours=1)

    # Map yfinance quoteType -> our normalized type names
    TYPE_MAP = {
        "EQUITY": "equity",
        "ETF": "etf",
        "INDEX": "index",
        "MUTUALFUND": "mutual_fund",
        "CURRENCY": "forex",
        "CRYPTOCURRENCY": "crypto",
        "FUTURE": "commodity",
    }

    def __init__(self) -> None:
        self._cache: Dict[str, tuple[List[Dict[str, Any]], datetime]] = {}

    async def search(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search Yahoo Finance for instruments matching the query.

        The query can be a ticker, ISIN, partial ticker, or company name.
        """
        if not query or not query.strip():
            return []

        normalized = query.strip()
        cache_key = f"{normalized.lower()}:{limit}"

        cached = self._cache.get(cache_key)
        if cached:
            results, timestamp = cached
            if datetime.now() - timestamp < self.CACHE_TTL:
                return results

        try:
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None, self._fetch_search, normalized, limit
            )
            self._cache[cache_key] = (results, datetime.now())
            return results
        except Exception as exc:
            print(f"YFinanceSearch error for '{normalized}': {exc}")
            return []

    def _fetch_search(self, query: str, limit: int) -> List[Dict[str, Any]]:
        """Sync helper running in thread pool."""
        search = yf.Search(query, max_results=limit)
        quotes = getattr(search, "quotes", []) or []

        results: List[Dict[str, Any]] = []
        for q in quotes[:limit]:
            symbol = q.get("symbol")
            if not symbol:
                continue

            results.append({
                "ticker": symbol,
                "name": q.get("longname") or q.get("shortname") or symbol,
                "type": self.TYPE_MAP.get(
                    q.get("quoteType", ""), q.get("quoteType", "").lower()
                ),
                "exchange": q.get("exchDisp", "") or q.get("exchange", ""),
                "currency": q.get("currency", ""),
                "sector": q.get("sectorDisp") or q.get("sector"),
                "industry": q.get("industryDisp") or q.get("industry"),
            })

        return results

    def clear_cache(self) -> None:
        self._cache.clear()
