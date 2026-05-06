from typing import List, Dict, Any, Optional
from .openfigi_service import OpenFIGIService
from .fuzzy_search_service import FuzzySearchService
from .yfinance_search_service import YFinanceSearchService


class SearchService:
    """Unified search service.

    Strategy:
    1. YFinance global search (primary) — covers 100k+ instruments worldwide
    2. Fuzzy local search (instant fallback for popular tickers)
    3. OpenFIGI (backup for ISIN lookups)
    """

    def __init__(self):
        self.yfinance = YFinanceSearchService()
        self.openfigi = OpenFIGIService()
        self.fuzzy = FuzzySearchService()

    async def search(
        self,
        query: str,
        limit: int = 10,
        use_yfinance: bool = True,
        use_fuzzy: bool = True,
    ) -> List[Dict[str, Any]]:
        """Search for instruments globally.

        Returns merged, deduplicated results sorted by source priority.
        """
        normalized = query.strip()
        if not normalized:
            return []

        results: List[Dict[str, Any]] = []
        seen_tickers: set = set()

        # 1. YFinance global search (covers worldwide tickers, names, ISINs)
        if use_yfinance:
            try:
                yf_results = await self.yfinance.search(normalized, limit=limit)
                for r in yf_results:
                    if r["ticker"] not in seen_tickers:
                        results.append(r)
                        seen_tickers.add(r["ticker"])
            except Exception as exc:
                print(f"Warning: YFinance search failed: {exc}")

        # 2. Local fuzzy search — fills in popular tickers if YFinance missed any
        if use_fuzzy and len(results) < limit:
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
        to keep responses instant. For 3+ chars we hit YFinance for global
        coverage.
        """
        normalized = query.strip()
        if not normalized:
            return []

        if len(normalized) <= 2:
            return self.fuzzy.autocomplete(normalized, limit) if hasattr(
                self.fuzzy, "autocomplete"
            ) else self.fuzzy.search(normalized, limit)

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

    def clear_caches(self):
        self.openfigi.clear_cache()
        self.yfinance.clear_cache()
