from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from rapidfuzz import fuzz, process


# Path to the bundled instruments database (same directory as this file)
_DB_PATH = os.path.join(os.path.dirname(__file__), "instruments_db.json")


def _load_instruments_db() -> List[Dict[str, Any]]:
    """Load the instruments database from JSON, falling back to a minimal list."""
    try:
        with open(_DB_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        # Deduplicate by ticker (keep first occurrence)
        seen: set[str] = set()
        unique: List[Dict[str, Any]] = []
        for entry in data:
            t = entry.get("ticker", "").upper()
            if t and t not in seen:
                seen.add(t)
                unique.append(entry)
        return unique
    except Exception as exc:
        print(f"[FuzzySearchService] Could not load instruments_db.json: {exc}")
        return _FALLBACK_INSTRUMENTS


# Minimal fallback if JSON file is unavailable
_FALLBACK_INSTRUMENTS: List[Dict[str, Any]] = [
    {"ticker": "AAPL",    "name": "Apple Inc.",                      "type": "equity",    "exchange": "NASDAQ", "currency": "USD"},
    {"ticker": "MSFT",    "name": "Microsoft Corporation",           "type": "equity",    "exchange": "NASDAQ", "currency": "USD"},
    {"ticker": "GOOGL",   "name": "Alphabet Inc.",                   "type": "equity",    "exchange": "NASDAQ", "currency": "USD"},
    {"ticker": "AMZN",    "name": "Amazon.com Inc.",                 "type": "equity",    "exchange": "NASDAQ", "currency": "USD"},
    {"ticker": "NVDA",    "name": "NVIDIA Corporation",              "type": "equity",    "exchange": "NASDAQ", "currency": "USD"},
    {"ticker": "META",    "name": "Meta Platforms Inc.",             "type": "equity",    "exchange": "NASDAQ", "currency": "USD"},
    {"ticker": "TSLA",    "name": "Tesla Inc.",                      "type": "equity",    "exchange": "NASDAQ", "currency": "USD"},
    {"ticker": "JPM",     "name": "JPMorgan Chase & Co.",            "type": "equity",    "exchange": "NYSE",   "currency": "USD"},
    {"ticker": "^GSPC",   "name": "S&P 500",                        "type": "index",     "exchange": "NYSE",   "currency": "USD"},
    {"ticker": "^NDX",    "name": "NASDAQ 100",                     "type": "index",     "exchange": "NASDAQ", "currency": "USD"},
    {"ticker": "SPY",     "name": "SPDR S&P 500 ETF Trust",         "type": "etf",       "exchange": "NYSE",   "currency": "USD"},
    {"ticker": "QQQ",     "name": "Invesco QQQ Trust",              "type": "etf",       "exchange": "NASDAQ", "currency": "USD"},
    {"ticker": "BTC-USD", "name": "Bitcoin",                        "type": "crypto",    "exchange": "CRYPTO", "currency": "USD"},
    {"ticker": "ETH-USD", "name": "Ethereum",                       "type": "crypto",    "exchange": "CRYPTO", "currency": "USD"},
    {"ticker": "GC=F",    "name": "Gold Futures",                   "type": "commodity", "exchange": "COMEX",  "currency": "USD"},
    {"ticker": "CL=F",    "name": "Crude Oil WTI Futures",          "type": "commodity", "exchange": "NYMEX",  "currency": "USD"},
    {"ticker": "EURUSD=X","name": "Euro / US Dollar",               "type": "forex",     "exchange": "FOREX",  "currency": "USD"},
]


class FuzzySearchService:
    """
    Local fuzzy search service for instruments.

    Instruments are loaded from ``instruments_db.json`` at startup (~300 entries
    covering US equities, EU/Asian stocks, ETFs, indices, crypto, commodities
    and forex).  Twelve Data /symbol_search is still the primary path for
    arbitrary ticker lookups (≥3 characters); this service handles instant
    autocomplete and the common-ticker fast path.
    """

    def __init__(self) -> None:
        self.instruments: List[Dict[str, Any]] = _load_instruments_db()
        # O(1) exact-match lookup by ticker
        self.ticker_index: Dict[str, Dict[str, Any]] = {
            inst["ticker"]: inst for inst in self.instruments
        }
        # Pre-build search strings once (ticker + name + type)
        self._search_corpus: List[str] = [
            f"{inst['ticker']} {inst['name']} {inst['type']}".upper()
            for inst in self.instruments
        ]
        print(
            f"[FuzzySearchService] Loaded {len(self.instruments)} instruments "
            f"from {'instruments_db.json' if os.path.exists(_DB_PATH) else 'fallback list'}"
        )

    # ─────────────────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────────────────

    def search(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Search instruments by query.

        1. Exact ticker match → returned first.
        2. Prefix match on ticker (e.g. "APPL" → AAPL skipped, but "APP" → AAPL).
        3. Fuzzy token-set ratio on "ticker name type" string.
        """
        q = query.strip().upper()
        if not q:
            return []

        # 1. Exact ticker match
        if q in self.ticker_index:
            exact = [self.ticker_index[q]]
            # Supplement with fuzzy results to fill up to limit
            fuzzy = self._fuzzy(q, limit + 1)
            seen = {q}
            for r in fuzzy:
                if r["ticker"] not in seen and len(exact) < limit:
                    exact.append(r)
                    seen.add(r["ticker"])
            return exact[:limit]

        # 2. Prefix match on ticker
        prefix_hits = [
            inst for inst in self.instruments
            if inst["ticker"].startswith(q)
        ]
        prefix_hits.sort(key=lambda x: len(x["ticker"]))  # shorter = more relevant

        # 3. Fuzzy match to fill remaining slots
        fuzzy_hits = self._fuzzy(q, limit)
        seen: set[str] = {inst["ticker"] for inst in prefix_hits}
        merged = list(prefix_hits)
        for r in fuzzy_hits:
            if r["ticker"] not in seen and len(merged) < limit:
                merged.append(r)
                seen.add(r["ticker"])

        return merged[:limit]

    def autocomplete(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Autocomplete suggestions (alias for search)."""
        return self.search(query, limit)

    def get_by_ticker(self, ticker: str) -> Optional[Dict[str, Any]]:
        """Get instrument by exact ticker."""
        return self.ticker_index.get(ticker.upper())

    def get_all_tickers(self) -> List[str]:
        """Get all available tickers."""
        return [inst["ticker"] for inst in self.instruments]

    def get_by_type(self, instrument_type: str) -> List[Dict[str, Any]]:
        """Get all instruments of a specific type (equity, etf, index, etc.)."""
        return [
            inst for inst in self.instruments
            if inst["type"].lower() == instrument_type.lower()
        ]

    def add_instrument(self, instrument: Dict[str, Any]) -> None:
        """Dynamically add an instrument (e.g. from a TD /symbol_search result)."""
        ticker = instrument.get("ticker", "").upper()
        if not ticker:
            return
        if ticker not in self.ticker_index:
            inst = {**instrument, "ticker": ticker}
            self.instruments.append(inst)
            self.ticker_index[ticker] = inst
            self._search_corpus.append(
                f"{ticker} {inst.get('name', '')} {inst.get('type', '')}".upper()
            )

    # ─────────────────────────────────────────────────────────────────────────
    # Internal
    # ─────────────────────────────────────────────────────────────────────────

    def _fuzzy(self, query: str, limit: int) -> List[Dict[str, Any]]:
        """Run rapidfuzz token_set_ratio and return matched instruments."""
        matches = process.extract(
            query,
            self._search_corpus,
            scorer=fuzz.token_set_ratio,
            limit=limit * 2,  # over-fetch then filter by score
        )
        results: List[Dict[str, Any]] = []
        for _text, score, idx in matches:
            if score >= 55 and len(results) < limit:
                results.append(self.instruments[idx])
        return results
