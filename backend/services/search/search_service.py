from typing import List, Dict, Any, Optional
from .yahoo_finance_search_service import YahooFinanceSearchService
from .twelvedata_search_service import TwelveDataSearchService
from .openfigi_service import OpenFIGIService
from .fuzzy_search_service import FuzzySearchService


class SearchService:
    """Unified search service.

    Strategy (demo project — no commercial restrictions):
    1. Yahoo Finance /finance/search  (primary)   — free, no key, global coverage
       Finds MSTR, AMUN.PA, TTE.PA, 9984.T, etc. out of the box.
    2. Twelve Data /symbol_search     (secondary) — if TWELVE_DATA_API_KEY set
    3. Local fuzzy JSON index         (fallback)  — instant for 1-2 char queries
    4. OpenFIGI                       (ISIN only)
    """

    def __init__(self):
        self.yf_search = YahooFinanceSearchService()  # primary — free, global
        self.td        = TwelveDataSearchService()    # secondary — if key set
        self.fuzzy     = FuzzySearchService()          # instant local fallback
        self.openfigi  = OpenFIGIService()

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

        # 1. Yahoo Finance (primary — free, global, ≥2 chars)
        if len(normalized) >= 2:
            try:
                yf_results = await self.yf_search.search(normalized, limit=limit)
                for r in yf_results:
                    if r["ticker"] not in seen_tickers:
                        results.append(r)
                        seen_tickers.add(r["ticker"])
            except Exception as exc:
                print(f"[search] YF search failed: {exc}")

        # 2. Twelve Data (secondary — adds coverage when key is available, ≥3 chars)
        if len(normalized) >= 3 and len(results) < limit:
            try:
                td_results = await self.td.search(normalized, limit=limit)
                for r in td_results:
                    if r["ticker"] not in seen_tickers:
                        results.append(r)
                        seen_tickers.add(r["ticker"])
            except Exception as exc:
                print(f"[search] TD search failed: {exc}")

        # 3. Local fuzzy (instant, always fills gaps, handles 1-char queries)
        if len(results) < limit:
            try:
                fuzzy_results = self.fuzzy.search(normalized, limit=limit)
                for r in fuzzy_results:
                    if r["ticker"] not in seen_tickers:
                        results.append(r)
                        seen_tickers.add(r["ticker"])
            except Exception as exc:
                print(f"[search] Fuzzy search failed: {exc}")

        return results[:limit]

    async def autocomplete(
        self, query: str, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Autocomplete suggestions.

        1-char  → local fuzzy only (instant, no HTTP call).
        2+ chars → Yahoo Finance search (global) + local fuzzy fallback.
        """
        normalized = query.strip()
        if not normalized:
            return []

        if len(normalized) == 1:
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
        await self.yf_search.close()
        await self.openfigi.close()
        await self.td.close()

    def clear_caches(self):
        self.yf_search.clear_cache()
        self.openfigi.clear_cache()
        self.td.clear_cache()
