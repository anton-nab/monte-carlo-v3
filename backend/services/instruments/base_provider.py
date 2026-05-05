from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any
from datetime import datetime


class BaseInstrumentProvider(ABC):
    """Abstract base class for instrument data providers."""

    @abstractmethod
    async def get_quote(self, ticker: str) -> Dict[str, Any]:
        """Get real-time quote data.

        Returns:
            {
                "ticker": str,
                "price": float,
                "previous_close": float,
                "change": float,
                "change_pct": float,
                "volume": int,
                "market_cap": float (optional),
                "timestamp": datetime
            }
        """
        pass

    @abstractmethod
    async def get_fundamentals(self, ticker: str) -> Dict[str, Any]:
        """Get company fundamentals.

        Returns:
            {
                "ticker": str,
                "name": str,
                "sector": str,
                "industry": str,
                "market_cap": float,
                "pe_ratio": float,
                "pb_ratio": float,
                "dividend_yield": float,
                "roe": float,
                "debt_to_equity": float,
                "revenue_ttm": float,
                "gross_margin": float,
                "eps": float,
                "52_week_high": float,
                "52_week_low": float,
                "beta": float
            }
        """
        pass

    @abstractmethod
    async def get_historical(
        self,
        ticker: str,
        period: str = "1y",
        interval: str = "1d",
    ) -> List[Dict[str, Any]]:
        """Get historical OHLCV data.

        Args:
            ticker: Stock ticker
            period: "1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"
            interval: "1m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "1wk", "1mo", "3mo"

        Returns:
            List of {
                "date": datetime,
                "open": float,
                "high": float,
                "low": float,
                "close": float,
                "volume": int
            }
        """
        pass

    @abstractmethod
    async def search(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search for instruments by name or ticker.

        Returns:
            List of {
                "ticker": str,
                "name": str,
                "type": str ("equity", "etf", "index", "forex", "crypto", "commodity"),
                "exchange": str,
                "currency": str
            }
        """
        pass

    @abstractmethod
    async def get_intraday(
        self,
        ticker: str,
        interval: str = "1h"
    ) -> List[Dict[str, Any]]:
        """Get intraday data for today.

        Args:
            ticker: Stock ticker
            interval: "1m", "5m", "15m", "30m", "60m", "90m", "1h"

        Returns:
            List of OHLCV bars
        """
        pass
