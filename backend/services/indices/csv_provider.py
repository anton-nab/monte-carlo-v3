"""
CSV-based constituent provider — fetches publicly maintained CSV files.

Sources used:
  SP500: https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv
         Maintained by the "datasets" org on GitHub, updated after each quarterly rebalance.
         Format: Symbol, Name, Sector

No authentication or scraping required — plain CSV over HTTPS, cached 24h.
"""

import asyncio
import httpx
import pandas as pd
from io import StringIO
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

SOURCES: Dict[str, str] = {
    "SP500": (
        "https://raw.githubusercontent.com/datasets/"
        "s-and-p-500-companies/main/data/constituents.csv"
    ),
}

_USER_AGENT = "MonteCarloV3/1.0 (financial-data; python-httpx)"


class CsvProvider:
    """Fetches index constituent lists from public CSV files. 24h in-memory cache."""

    CACHE_TTL = timedelta(hours=24)

    def __init__(self) -> None:
        self._cache: Dict[str, tuple] = {}

    async def get_constituents(self, symbol: str) -> List[Dict[str, Any]]:
        """Return [{ticker, name, sector}] for a supported index symbol."""
        url = SOURCES.get(symbol.upper())
        if not url:
            raise ValueError(f"No CSV source configured for '{symbol}'. Supported: {list(SOURCES)}")

        cached = self._cache.get(symbol)
        if cached:
            data, ts = cached
            if datetime.now() - ts < self.CACHE_TTL:
                return data

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self._fetch_csv, symbol, url)
        self._cache[symbol] = (result, datetime.now())
        return result

    def _fetch_csv(self, symbol: str, url: str) -> List[Dict[str, Any]]:
        try:
            resp = httpx.get(url, headers={"User-Agent": _USER_AGENT}, timeout=20, follow_redirects=True)
            resp.raise_for_status()
            df = pd.read_csv(StringIO(resp.text))

            # Normalise column names (strip whitespace)
            df.columns = [c.strip() for c in df.columns]

            # Find ticker, name, sector columns (flexible naming)
            ticker_col = self._find_col(df, ["Symbol", "Ticker", "symbol", "ticker"])
            name_col   = self._find_col(df, ["Name", "Company", "Security", "name"])
            sector_col = self._find_col(df, ["Sector", "GICS Sector", "sector", "Industry"])

            if not ticker_col:
                raise ValueError(f"Could not find ticker column. Columns: {list(df.columns)}")

            results = []
            for _, row in df.iterrows():
                ticker = str(row.get(ticker_col, "")).strip()
                if not ticker or ticker.lower() == "nan":
                    continue
                name   = str(row.get(name_col,   "")).strip() if name_col   else ""
                sector = str(row.get(sector_col, "")).strip() if sector_col else ""
                if sector.lower() == "nan":
                    sector = ""
                results.append({"ticker": ticker, "name": name, "sector": sector})

            print(f"[CsvProvider] {symbol}: loaded {len(results)} constituents from GitHub CSV")
            return results

        except Exception as exc:
            print(f"[CsvProvider] Failed to fetch {symbol} CSV ({url}): {exc}")
            return []

    @staticmethod
    def _find_col(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
        for c in candidates:
            if c in df.columns:
                return c
        # Case-insensitive fallback
        lower_map = {col.lower(): col for col in df.columns}
        for c in candidates:
            if c.lower() in lower_map:
                return lower_map[c.lower()]
        return None
