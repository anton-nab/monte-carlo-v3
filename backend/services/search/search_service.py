from typing import List, Dict, Any, Optional
from .openfigi_service import OpenFIGIService
from .fuzzy_search_service import FuzzySearchService


class SearchService:
    """Unified search service combining OpenFIGI (cloud) + FuzzySearch (local)."""

    def __init__(self):
        self.openfigi = OpenFIGIService()
        self.fuzzy = FuzzySearchService()

    async def search(
        self,
        query: str,
        limit: int = 10,
        use_openfigi: bool = True,
        use_fuzzy: bool = True
    ) -> List[Dict[str, Any]]:
        """Search for instruments.

        Strategy:
        1. If use_openfigi: Try OpenFIGI first (comprehensive, slow ~1-2s)
        2. If no results or use_fuzzy: Try FuzzySearch (instant, limited to 70 instruments)
        3. Merge results, dedup by ticker

        Args:
            query: Search query (ticker, ISIN, or name)
            limit: Max results
            use_openfigi: Enable OpenFIGI search (comprehensive but slower)
            use_fuzzy: Enable local fuzzy search (fast, limited)

        Returns:
            List of instruments, sorted by relevance
        """
        query = query.strip().upper()

        if not query:
            return []

        results = []

        # Try OpenFIGI first (comprehensive but slower)
        if use_openfigi:
            try:
                openfigi_results = await self.openfigi.universal_search(query, limit=limit)
                if openfigi_results:
                    results.extend(openfigi_results)
            except Exception as e:
                # Silently fail, fall back to fuzzy search
                print(f"Warning: OpenFIGI search failed: {e}")

        # Try local fuzzy search (instant, but limited to ~70 instruments)
        if use_fuzzy:
            fuzzy_results = self.fuzzy.search(query, limit=limit)
            if fuzzy_results:
                # Merge fuzzy results, avoiding duplicates
                existing_tickers = {r["ticker"] for r in results}
                for fuzzy_result in fuzzy_results:
                    if fuzzy_result["ticker"] not in existing_tickers:
                        results.append(fuzzy_result)

        # Limit results
        return results[:limit]

    async def autocomplete(
        self,
        query: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Autocomplete suggestions (fast, uses local fuzzy search)."""
        return self.fuzzy.autocomplete(query, limit)

    async def search_by_ticker(self, ticker: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search by ticker (exact or fuzzy)."""
        return await self.search(ticker, limit=limit)

    async def search_by_isin(self, isin: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search by ISIN code."""
        # ISIN is typically 12 chars, so try exact first
        try:
            results = await self.openfigi.search_by_isin(isin, limit=limit)
            if results:
                return results
        except:
            pass

        # Fall back to general search
        return await self.search(isin, limit=limit)

    async def search_by_name(self, name: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search by company/instrument name."""
        try:
            results = await self.openfigi.search_by_name(name, limit=limit)
            if results:
                return results
        except:
            pass

        # Fall back to fuzzy
        return self.fuzzy.search(name, limit=limit)

    async def get_isin_by_ticker(self, ticker: str) -> Optional[str]:
        """Quick ISIN lookup from ticker."""
        return await self.openfigi.map_ticker_to_isin(ticker)

    async def get_ticker_by_isin(self, isin: str) -> Optional[str]:
        """Quick ticker lookup from ISIN."""
        return await self.openfigi.map_isin_to_ticker(isin)

    async def close(self):
        """Cleanup resources."""
        await self.openfigi.close()

    def clear_caches(self):
        """Clear all caches."""
        self.openfigi.clear_cache()
        # Note: FuzzySearchService doesn't have caching, only initial load
