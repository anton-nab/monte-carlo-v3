import httpx
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import asyncio


class OpenFIGIService:
    """Integration with OpenFIGI (Bloomberg's free ISIN/ticker mapping API)."""

    BASE_URL = "https://www.openfigi.com/api/v3"
    CACHE_TTL = 86400  # 24 hours

    def __init__(self, cache: Optional[Dict] = None):
        self.cache = cache or {}
        self.http_client = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create async HTTP client."""
        if self.http_client is None:
            self.http_client = httpx.AsyncClient(timeout=10.0)
        return self.http_client

    async def search_by_isin(self, isin: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search for instruments by ISIN code.

        Example: US0378331005 (Apple Inc.) → AAPL

        Returns:
            List of {
                "ticker": str,
                "name": str,
                "isin": str,
                "figi": str,
                "composite_figi": str,
                "exchange_code": str,
                "currency": str,
                "type": str
            }
        """
        cache_key = f"isin:{isin}"
        if cache_key in self.cache:
            cached, timestamp = self.cache[cache_key]
            if (datetime.now() - timestamp).total_seconds() < self.CACHE_TTL:
                return cached

        try:
            client = await self._get_client()
            response = await client.get(
                f"{self.BASE_URL}/search",
                params={
                    "query": isin,
                    "isinExactMatch": "true",
                }
            )
            response.raise_for_status()
            data = response.json()

            results = []
            for instrument in data.get("data", [])[:limit]:
                results.append(self._format_instrument(instrument))

            # Cache the results
            self.cache[cache_key] = (results, datetime.now())

            return results

        except Exception as e:
            raise ValueError(f"OpenFIGI search failed for ISIN {isin}: {str(e)}")

    async def search_by_ticker(
        self,
        ticker: str,
        exchange_code: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search for instruments by ticker symbol.

        Args:
            ticker: Stock ticker (e.g., AAPL)
            exchange_code: Optional exchange filter (e.g., US)
            limit: Max results

        Returns:
            List of matching instruments
        """
        cache_key = f"ticker:{ticker}:{exchange_code}"
        if cache_key in self.cache:
            cached, timestamp = self.cache[cache_key]
            if (datetime.now() - timestamp).total_seconds() < self.CACHE_TTL:
                return cached

        try:
            client = await self._get_client()
            response = await client.get(
                f"{self.BASE_URL}/search",
                params={
                    "query": ticker,
                    "preferredExch": exchange_code,
                }
            )
            response.raise_for_status()
            data = response.json()

            results = []
            for instrument in data.get("data", [])[:limit]:
                results.append(self._format_instrument(instrument))

            # Cache the results
            self.cache[cache_key] = (results, datetime.now())

            return results

        except Exception as e:
            raise ValueError(f"OpenFIGI search failed for ticker {ticker}: {str(e)}")

    async def search_by_name(self, name: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search for instruments by company name.

        Example: "Apple" → [AAPL, APPL (other exchanges)]

        Returns:
            List of matching instruments
        """
        cache_key = f"name:{name}"
        if cache_key in self.cache:
            cached, timestamp = self.cache[cache_key]
            if (datetime.now() - timestamp).total_seconds() < self.CACHE_TTL:
                return cached

        try:
            client = await self._get_client()
            response = await client.get(
                f"{self.BASE_URL}/search",
                params={
                    "query": name,
                }
            )
            response.raise_for_status()
            data = response.json()

            results = []
            for instrument in data.get("data", [])[:limit]:
                results.append(self._format_instrument(instrument))

            # Cache the results
            self.cache[cache_key] = (results, datetime.now())

            return results

        except Exception as e:
            raise ValueError(f"OpenFIGI search failed for name {name}: {str(e)}")

    async def map_isin_to_ticker(self, isin: str) -> Optional[str]:
        """Quick lookup: ISIN → ticker.

        Example: US0378331005 → AAPL
        """
        results = await self.search_by_isin(isin, limit=1)
        if results:
            return results[0].get("ticker")
        return None

    async def map_ticker_to_isin(self, ticker: str, exchange: Optional[str] = None) -> Optional[str]:
        """Quick lookup: ticker → ISIN.

        Example: AAPL → US0378331005
        """
        results = await self.search_by_ticker(ticker, exchange_code=exchange, limit=1)
        if results:
            return results[0].get("isin")
        return None

    async def universal_search(
        self,
        query: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Universal search: accepts ticker, ISIN, or name.

        This is the main entry point for search functionality.
        """
        query = query.strip().upper()

        if not query:
            return []

        # Try ISIN first (10-12 chars, alphanumeric, starts with country code)
        if len(query) >= 10 and query[0:2].isalpha() and query[2:].isalnum():
            try:
                results = await self.search_by_isin(query, limit)
                if results:
                    return results
            except:
                pass

        # Try ticker (shorter, no spaces)
        if len(query) <= 10 and query.isalnum():
            try:
                results = await self.search_by_ticker(query, limit=limit)
                if results:
                    return results
            except:
                pass

        # Fall back to name search
        try:
            results = await self.search_by_name(query, limit=limit)
            if results:
                return results
        except:
            pass

        return []

    @staticmethod
    def _format_instrument(raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Format raw OpenFIGI response into standard format."""
        return {
            "ticker": raw_data.get("ticker", ""),
            "name": raw_data.get("name", ""),
            "isin": raw_data.get("isin", ""),
            "figi": raw_data.get("figi", ""),
            "composite_figi": raw_data.get("composite_figi", ""),
            "exchange_code": raw_data.get("exchange_code", ""),
            "currency": raw_data.get("currency", ""),
            "type": raw_data.get("security_type", "Equity"),
            "market_sector": raw_data.get("market_sector", ""),
        }

    async def close(self):
        """Close HTTP client."""
        if self.http_client:
            await self.http_client.aclose()

    def clear_cache(self):
        """Clear all cached results."""
        self.cache.clear()
