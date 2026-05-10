from typing import Dict, List, Any, Optional
from datetime import datetime
from .base_provider import BaseInstrumentProvider


class InstrumentsService:
    """Orchestrates instrument data access."""

    def __init__(self, provider: BaseInstrumentProvider):
        self.provider = provider

    async def get_instrument_snapshot(self, ticker: str) -> Dict[str, Any]:
        """Get complete instrument snapshot (quote + fundamentals)."""
        quote = await self.provider.get_quote(ticker)
        fundamentals = await self.provider.get_fundamentals(ticker)

        return {
            "ticker": ticker,
            "quote": quote,
            "fundamentals": fundamentals,
            "snapshot_time": datetime.now().isoformat(),
        }

    async def get_chart_data(
        self,
        ticker: str,
        period: str = "1y",
        interval: str = "1d",
    ) -> Dict[str, Any]:
        """Get chart data (OHLCV)."""
        historical = await self.provider.get_historical(ticker, period, interval)

        return {
            "ticker": ticker,
            "period": period,
            "interval": interval,
            "data": historical,
            "count": len(historical),
            "fetched_at": datetime.now().isoformat(),
        }

    async def get_financials(self, ticker: str, period: str = "annual") -> Dict[str, Any]:
        """Get full financial statements + earnings + analyst data."""
        return await self.provider.get_financials_data(ticker, period)

    async def get_intraday_chart(
        self,
        ticker: str,
        interval: str = "1h"
    ) -> Dict[str, Any]:
        """Get intraday chart data."""
        intraday = await self.provider.get_intraday(ticker, interval)

        return {
            "ticker": ticker,
            "interval": interval,
            "intraday": True,
            "data": intraday,
            "count": len(intraday),
            "fetched_at": datetime.now().isoformat(),
        }

    async def search_instruments(
        self,
        query: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search for instruments."""
        return await self.provider.search(query, limit)

    async def get_price(self, ticker: str) -> float:
        """Get current price only."""
        quote = await self.provider.get_quote(ticker)
        return quote["price"]

    async def get_quote_simple(self, ticker: str) -> Dict[str, Any]:
        """Get simple quote (price, change, volume)."""
        quote = await self.provider.get_quote(ticker)
        return {
            "ticker": quote["ticker"],
            "price": quote["price"],
            "change": quote["change"],
            "change_pct": quote["change_pct"],
            "volume": quote["volume"],
            "timestamp": quote["timestamp"],
        }

    async def batch_get_quotes(self, tickers: List[str]) -> Dict[str, Dict[str, Any]]:
        """Get quotes for multiple tickers."""
        results = {}
        for ticker in tickers:
            try:
                results[ticker] = await self.get_quote_simple(ticker)
            except Exception as e:
                results[ticker] = {"error": str(e)}
        return results
