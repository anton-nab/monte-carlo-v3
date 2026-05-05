from typing import List, Dict, Any
from rapidfuzz import process, fuzz
import json
import os


class FuzzySearchService:
    """Local fuzzy search service for instruments."""

    # Popular tickers (US, EU, JP, etc.)
    # In production, load from database or external source
    POPULAR_INSTRUMENTS = [
        # US Tech
        {"ticker": "AAPL", "name": "Apple Inc.", "type": "equity", "exchange": "NASDAQ", "currency": "USD"},
        {"ticker": "MSFT", "name": "Microsoft Corporation", "type": "equity", "exchange": "NASDAQ", "currency": "USD"},
        {"ticker": "GOOGL", "name": "Alphabet Inc.", "type": "equity", "exchange": "NASDAQ", "currency": "USD"},
        {"ticker": "AMZN", "name": "Amazon.com Inc.", "type": "equity", "exchange": "NASDAQ", "currency": "USD"},
        {"ticker": "NVDA", "name": "NVIDIA Corporation", "type": "equity", "exchange": "NASDAQ", "currency": "USD"},
        {"ticker": "META", "name": "Meta Platforms Inc.", "type": "equity", "exchange": "NASDAQ", "currency": "USD"},
        {"ticker": "TSLA", "name": "Tesla Inc.", "type": "equity", "exchange": "NASDAQ", "currency": "USD"},

        # US Financial
        {"ticker": "JPM", "name": "JPMorgan Chase & Co.", "type": "equity", "exchange": "NYSE", "currency": "USD"},
        {"ticker": "BAC", "name": "Bank of America Corp", "type": "equity", "exchange": "NYSE", "currency": "USD"},
        {"ticker": "WFC", "name": "Wells Fargo & Company", "type": "equity", "exchange": "NYSE", "currency": "USD"},

        # US Indices
        {"ticker": "^GSPC", "name": "S&P 500", "type": "index", "exchange": "NYSE", "currency": "USD"},
        {"ticker": "^IXIC", "name": "NASDAQ Composite", "type": "index", "exchange": "NASDAQ", "currency": "USD"},
        {"ticker": "^DJI", "name": "Dow Jones Industrial Average", "type": "index", "exchange": "NYSE", "currency": "USD"},

        # US ETFs
        {"ticker": "SPY", "name": "SPDR S&P 500 ETF Trust", "type": "etf", "exchange": "NYSE", "currency": "USD"},
        {"ticker": "QQQ", "name": "Invesco QQQ Trust", "type": "etf", "exchange": "NASDAQ", "currency": "USD"},
        {"ticker": "IWM", "name": "iShares Russell 2000 ETF", "type": "etf", "exchange": "NYSE", "currency": "USD"},

        # European
        {"ticker": "SAP", "name": "SAP SE", "type": "equity", "exchange": "XETRA", "currency": "EUR"},
        {"ticker": "SIEMENS", "name": "Siemens AG", "type": "equity", "exchange": "XETRA", "currency": "EUR"},
        {"ticker": "ASML", "name": "ASML Holding N.V.", "type": "equity", "exchange": "XAMS", "currency": "EUR"},

        # European Indices
        {"ticker": "^STOXX50E", "name": "EURO STOXX 50", "type": "index", "exchange": "EUREX", "currency": "EUR"},
        {"ticker": "^GDAXI", "name": "DAX", "type": "index", "exchange": "XETRA", "currency": "EUR"},
        {"ticker": "^FCHI", "name": "CAC 40", "type": "index", "exchange": "XPAR", "currency": "EUR"},

        # UK
        {"ticker": "HSBA", "name": "HSBC Holdings PLC", "type": "equity", "exchange": "XLON", "currency": "GBP"},
        {"ticker": "SHELL", "name": "Shell PLC", "type": "equity", "exchange": "XLON", "currency": "GBP"},
        {"ticker": "^FTSE", "name": "FTSE 100", "type": "index", "exchange": "XLON", "currency": "GBP"},

        # Japan
        {"ticker": "9984.T", "name": "SoftBank Group Corp.", "type": "equity", "exchange": "TSE", "currency": "JPY"},
        {"ticker": "6758.T", "name": "Sony Group Corporation", "type": "equity", "exchange": "TSE", "currency": "JPY"},
        {"ticker": "^N225", "name": "Nikkei 225", "type": "index", "exchange": "TSE", "currency": "JPY"},

        # Crypto
        {"ticker": "BTC-USD", "name": "Bitcoin", "type": "crypto", "exchange": "CRYPTO", "currency": "USD"},
        {"ticker": "ETH-USD", "name": "Ethereum", "type": "crypto", "exchange": "CRYPTO", "currency": "USD"},
        {"ticker": "BNB-USD", "name": "Binance Coin", "type": "crypto", "exchange": "CRYPTO", "currency": "USD"},

        # Commodities
        {"ticker": "GC=F", "name": "Gold Futures", "type": "commodity", "exchange": "COMEX", "currency": "USD"},
        {"ticker": "CL=F", "name": "Crude Oil WTI", "type": "commodity", "exchange": "NYMEX", "currency": "USD"},
        {"ticker": "NG=F", "name": "Natural Gas", "type": "commodity", "exchange": "NYMEX", "currency": "USD"},

        # Forex
        {"ticker": "EURUSD=X", "name": "EUR/USD", "type": "forex", "exchange": "FOREX", "currency": "USD"},
        {"ticker": "GBPUSD=X", "name": "GBP/USD", "type": "forex", "exchange": "FOREX", "currency": "USD"},
        {"ticker": "JPYUSD=X", "name": "JPY/USD", "type": "forex", "exchange": "FOREX", "currency": "USD"},
    ]

    def __init__(self):
        self.instruments = self.POPULAR_INSTRUMENTS
        # Create search index: ticker -> instrument
        self.ticker_index = {inst["ticker"]: inst for inst in self.instruments}

    def search(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search instruments by query (fuzzy match on ticker, name)."""
        query = query.strip().upper()

        if not query:
            return []

        # Exact ticker match first
        if query in self.ticker_index:
            return [self.ticker_index[query]]

        # Build searchable text: "AAPL Apple Inc." for each instrument
        search_data = [
            f"{inst['ticker']} {inst['name']} {inst['type']}".upper()
            for inst in self.instruments
        ]

        # Fuzzy match
        matches = process.extract(
            query,
            search_data,
            scorer=fuzz.token_set_ratio,
            limit=limit,
        )

        results = []
        for match_text, score, idx in matches:
            if score >= 60:  # Threshold
                results.append(self.instruments[idx])

        return results

    def autocomplete(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Autocomplete suggestions."""
        return self.search(query, limit)

    def get_by_ticker(self, ticker: str) -> Dict[str, Any]:
        """Get instrument by exact ticker."""
        return self.ticker_index.get(ticker.upper())

    def get_all_tickers(self) -> List[str]:
        """Get all available tickers."""
        return [inst["ticker"] for inst in self.instruments]

    def get_by_type(self, instrument_type: str) -> List[Dict[str, Any]]:
        """Get all instruments of a specific type (equity, etf, index, etc.)."""
        return [inst for inst in self.instruments if inst["type"].lower() == instrument_type.lower()]

    def add_instrument(self, instrument: Dict[str, Any]) -> None:
        """Add a new instrument to the search index."""
        ticker = instrument["ticker"].upper()
        if ticker not in self.ticker_index:
            self.instruments.append(instrument)
            self.ticker_index[ticker] = instrument
