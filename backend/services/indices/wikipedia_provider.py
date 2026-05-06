"""
Wikipedia constituent scraper for global indices.

Uses pandas.read_html() with lxml to parse the tables on Wikipedia index pages.
Results are cached for 24h to avoid hammering Wikipedia.
"""

import asyncio
import pandas as pd
from io import StringIO
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


class WikipediaProvider:
    """Scrapes Wikipedia tables for index constituent lists."""

    CACHE_TTL = timedelta(hours=24)
    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )

    def __init__(self) -> None:
        self._cache: Dict[str, tuple[List[Dict], datetime]] = {}

    async def get_constituents(
        self, wiki_config: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Fetch constituents from Wikipedia.

        Args:
            wiki_config: dict with keys url, table_index, ticker_col, name_col, sector_col

        Returns:
            List of dicts with keys: ticker, name, sector
        """
        url = wiki_config["url"]

        # --- Check cache ---
        cached = self._cache.get(url)
        if cached:
            data, ts = cached
            if datetime.now() - ts < self.CACHE_TTL:
                return data

        # --- Fetch in thread pool (pandas.read_html is synchronous) ---
        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(
                None, self._fetch, wiki_config
            )
            self._cache[url] = (result, datetime.now())
            return result
        except Exception as exc:
            logger.error(f"Wikipedia scrape failed for {url}: {exc}")
            return []

    def _fetch(self, wiki_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Synchronous scrape — runs in thread pool."""
        import httpx

        url = wiki_config["url"]
        table_index = wiki_config.get("table_index", 0)
        ticker_col = wiki_config["ticker_col"]
        name_col = wiki_config["name_col"]
        sector_col = wiki_config.get("sector_col")

        # Fetch HTML
        headers = {"User-Agent": self.USER_AGENT}
        resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=30)
        resp.raise_for_status()
        html = resp.text

        # Try the specified table_index first, then adjacent ones as fallback
        tables = pd.read_html(StringIO(html))

        table: Optional[pd.DataFrame] = None
        for idx in [table_index, table_index + 1, table_index - 1,
                     table_index + 2, 0, 1, 2, 3, 4, 5]:
            if 0 <= idx < len(tables):
                candidate = tables[idx]
                # Check if required columns are present (or similar)
                if self._has_required_cols(candidate, ticker_col, name_col):
                    table = candidate
                    break

        if table is None:
            # Last resort: try all tables and pick the best one
            best = self._find_best_table(tables, ticker_col, name_col)
            if best is None:
                raise ValueError(
                    f"No suitable table found on {url} "
                    f"(looking for '{ticker_col}' and '{name_col}')"
                )
            table = best

        # Normalise column names (strip whitespace + footnote brackets)
        table.columns = [self._clean_col(c) for c in table.columns]
        ticker_col = self._find_col(table, ticker_col)
        name_col = self._find_col(table, name_col)
        s_col = self._find_col(table, sector_col) if sector_col else None

        results: List[Dict[str, Any]] = []
        for _, row in table.iterrows():
            ticker = str(row.get(ticker_col, "")).strip()
            name = str(row.get(name_col, "")).strip()

            if not ticker or ticker.lower() in {"nan", "ticker", "symbol"}:
                continue
            # Strip footnote markers from tickers (e.g. "AAPL[2]" → "AAPL")
            ticker = ticker.split("[")[0].strip()
            if not ticker:
                continue

            sector = ""
            if s_col and s_col in row.index:
                sector = str(row[s_col]).strip()
                if sector.lower() == "nan":
                    sector = ""

            results.append({"ticker": ticker, "name": name, "sector": sector})

        return results

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _clean_col(col: Any) -> str:
        """Strip whitespace and footnote markers from a column name."""
        return str(col).strip().split("[")[0].strip()

    def _has_required_cols(
        self, df: pd.DataFrame, ticker_col: str, name_col: str
    ) -> bool:
        cleaned = [self._clean_col(c) for c in df.columns]
        return (
            self._fuzzy_match(ticker_col, cleaned) is not None
            and self._fuzzy_match(name_col, cleaned) is not None
        )

    def _find_best_table(
        self, tables: List[pd.DataFrame], ticker_col: str, name_col: str
    ) -> Optional[pd.DataFrame]:
        for t in tables:
            if self._has_required_cols(t, ticker_col, name_col):
                return t
        return None

    def _find_col(self, df: pd.DataFrame, col_name: str) -> str:
        """Find the best matching column name in the dataframe."""
        cleaned = {self._clean_col(c): c for c in df.columns}
        # Exact match first
        if col_name in cleaned:
            return cleaned[col_name]
        # Case-insensitive
        for k, v in cleaned.items():
            if k.lower() == col_name.lower():
                return v
        # Substring match
        for k, v in cleaned.items():
            if col_name.lower() in k.lower() or k.lower() in col_name.lower():
                return v
        return col_name

    @staticmethod
    def _fuzzy_match(target: str, options: List[str]) -> Optional[str]:
        """Return the best matching option or None."""
        target_l = target.lower()
        for opt in options:
            if opt.lower() == target_l:
                return opt
        for opt in options:
            if target_l in opt.lower() or opt.lower() in target_l:
                return opt
        return None

    def clear_cache(self) -> None:
        self._cache.clear()
