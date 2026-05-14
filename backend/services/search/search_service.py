from typing import List, Dict, Any, Optional
from .twelvedata_search_service import TwelveDataSearchService
from .openfigi_service import OpenFIGIService
from .fuzzy_search_service import FuzzySearchService


class SearchService:
    """Unified search service.

    Strategy:
    1. Twelve Data /symbol_search (primary) — commercial-friendly, async
    2. Fuzzy local search (instant for 1-2 char queries; fills gaps from TD)
    3. OpenFIGI (backup for ISIN lookups)
    """

    def __init__(self):
        self.td     = TwelveDataSearchService()
        self.fuzzy  = FuzzySearchService()
        self.openfigi = OpenFIGIService()

    async def search(
        self,
        query: str,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Search for instruments globally.

        Returns merged, deduplicated results sorted by source priority.
        """
        normalized = query.strip()
        if not normalized:
            return []

        results: List[Dict[str, Any]] = []
        seen_tickers: set = set()

        # 1. Twelve Data global search (3+ chars only — avoids noisy short-query results)
        if len(normalized) >= 3:
            try:
                td_results = await self.td.search(normalized, limit=limit)
                for r in td_results:
                    if r["ticker"] not in seen_tickers:
                        results.append(r)
                        seen_tickers.add(r["ticker"])
            except Exception as exc:
                print(f"Warning: Twelve Data search failed: {exc}")

        # 2. Local fuzzy search — instant, fills gaps and covers 1-2 char queries
        if len(results) < limit:
            try:
                fuzzy_results = self.fuzzy.search(normalized, limit=limit)
                for r in fuzzy_results:
                    if r["ticker"] not in seen_tickers:
                        results.append(r)
                        seen_tickers.add(r["ticker"])
            except Exception as exc:
                print(f"Warning: Fuzzy search failed: {exc}")

        return results[:limit]

    async def autocomplete(
        self, query: str, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Autocomplete suggestions.

        For very short queries (1-2 chars) we use the local fuzzy index only
        to keep responses instant. For 3+ chars we hit Twelve Data for global
        coverage.
        """
        normalized = query.strip()
        if not normalized:
            return []

        if len(normalized) <= 2:
            return self.fuzzy.autocomplete(normalized, limit)

        return await self.search(normalized, limit=limit)

    async def search_by_ticker(
        self, ticker: str, limit: int = 10
    ) -> List[Dict[str, Any]]:
        return await self.search(ticker, limit=limit)

    async def search_by_isin(
        self, isin: str, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search by ISIN — try OpenFIGI first, fall back to general search."""
        try:
            results = await self.openfigi.search_by_isin(isin, limit=limit)
            if results:
                return results
        except Exception:
            pass
        return await self.search(isin, limit=limit)

    async def search_by_name(
        self, name: str, limit: int = 10
    ) -> List[Dict[str, Any]]:
        return await self.search(name, limit=limit)

    async def get_isin_by_ticker(self, ticker: str) -> Optional[str]:
        return await self.openfigi.map_ticker_to_isin(ticker)

    async def get_ticker_by_isin(self, isin: str) -> Optional[str]:
        return await self.openfigi.map_isin_to_ticker(isin)

    async def close(self):
        await self.openfigi.close()
        await self.td.close()

    def clear_caches(self):
        self.openfigi.clear_cache()
        self.td.clear_cache()
