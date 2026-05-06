"""
Wikipedia constituent scraper — uses the MediaWiki REST API
(not direct HTML scraping, which is blocked by Wikimedia's bot policy).

API endpoint: GET /w/api.php?action=parse&page={title}&prop=text&format=json
This is the official programmatic access method, not rate-limited like direct scraping.

Results are cached 24h.
"""

import asyncio
import re
import pandas as pd
from io import StringIO
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

# MediaWiki API endpoint
_MEDIAWIKI_API = "https://en.wikipedia.org/w/api.php"

# Proper bot User-Agent required by Wikimedia policy
_USER_AGENT = "MonteCarloV3-financial-bot/1.0 (index-constituent-aggregator; https://github.com/monte-carlo-v3) python-httpx/0.27"


def _url_to_page_title(url: str) -> str:
    """Extract page title from a Wikipedia URL."""
    # e.g. https://en.wikipedia.org/wiki/List_of_S%26P_500_companies
    #   → List_of_S%26P_500_companies
    match = re.search(r"/wiki/(.+)$", url)
    return match.group(1) if match else url


class WikipediaProvider:
    """Fetches Wikipedia constituent tables via the official MediaWiki API."""

    CACHE_TTL = timedelta(hours=24)

    def __init__(self) -> None:
        self._cache: Dict[str, tuple] = {}

    async def get_constituents(
        self, wiki_config: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Fetch constituents from Wikipedia via MediaWiki API.

        Args:
            wiki_config: dict with keys:
                url          — Wikipedia page URL
                table_index  — preferred table index (searched with fallbacks)
                ticker_col   — column name containing tickers
                name_col     — column name containing company names
                sector_col   — (optional) column name containing sector
        """
        url = wiki_config["url"]
        cached = self._cache.get(url)
        if cached:
            data, ts = cached
            if datetime.now() - ts < self.CACHE_TTL:
                return data

        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(None, self._fetch, wiki_config)
            self._cache[url] = (result, datetime.now())
            return result
        except Exception as exc:
            logger.error(f"Wikipedia scrape failed for {url}: {exc}")
            return []

    def _fetch(self, wiki_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Synchronous fetch via MediaWiki API — runs in thread pool."""
        import httpx

        url = wiki_config["url"]
        table_index = wiki_config.get("table_index", 0)
        ticker_col = wiki_config["ticker_col"]
        name_col = wiki_config["name_col"]
        sector_col = wiki_config.get("sector_col")

        page_title = _url_to_page_title(url)

        # ── Fetch HTML via MediaWiki API ──────────────────────────────────────
        api_params = {
            "action": "parse",
            "page": page_title,
            "prop": "text",
            "format": "json",
            "disablelimitreport": "1",
            "disableeditsection": "1",
        }
        headers = {"User-Agent": _USER_AGENT}

        resp = httpx.get(
            _MEDIAWIKI_API,
            params=api_params,
            headers=headers,
            follow_redirects=True,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        if "error" in data:
            raise ValueError(f"MediaWiki API error: {data['error']}")

        html = data.get("parse", {}).get("text", {}).get("*", "")
        if not html:
            raise ValueError(f"MediaWiki API returned empty HTML for {page_title}")

        # ── Parse HTML tables ─────────────────────────────────────────────────
        tables = None
        for flavor in ["lxml", "html5lib", "bs4"]:
            try:
                tables = pd.read_html(StringIO(html), flavor=flavor)
                break
            except Exception:
                continue

        if not tables:
            raise ValueError(f"No HTML parser available. Run: pip install lxml html5lib")

        # ── Find the right table ──────────────────────────────────────────────
        table: Optional[pd.DataFrame] = None
        search_order = [
            table_index,
            table_index + 1,
            table_index - 1,
            table_index + 2,
        ] + list(range(min(10, len(tables))))

        for idx in search_order:
            if 0 <= idx < len(tables):
                candidate = tables[idx]
                if self._has_required_cols(candidate, ticker_col, name_col):
                    table = candidate
                    break

        if table is None:
            cols_found = [list(t.columns) for t in tables[:5]]
            raise ValueError(
                f"No table matching columns '{ticker_col}'/'{name_col}' found. "
                f"Tables found: {len(tables)}. First 5 column sets: {cols_found}"
            )

        # ── Normalise + extract ───────────────────────────────────────────────
        table.columns = [self._clean_col(c) for c in table.columns]
        ticker_col_actual = self._find_col(table, ticker_col)
        name_col_actual = self._find_col(table, name_col)
        s_col = self._find_col(table, sector_col) if sector_col else None

        results: List[Dict[str, Any]] = []
        for _, row in table.iterrows():
            ticker = str(row.get(ticker_col_actual, "")).strip()
            name = str(row.get(name_col_actual, "")).strip()

            if not ticker or ticker.lower() in {"nan", "ticker", "symbol"}:
                continue
            ticker = ticker.split("[")[0].strip()  # Remove footnote markers
            if not ticker:
                continue

            sector = ""
            if s_col and s_col in row.index:
                val = str(row[s_col]).strip()
                sector = "" if val.lower() == "nan" else val

            results.append({"ticker": ticker, "name": name, "sector": sector})

        return results

    # ──────────────────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _clean_col(col: Any) -> str:
        return str(col).strip().split("[")[0].strip()

    def _has_required_cols(
        self, df: pd.DataFrame, ticker_col: str, name_col: str
    ) -> bool:
        cleaned = [self._clean_col(c) for c in df.columns]
        return (
            self._fuzzy_match(ticker_col, cleaned) is not None
            and self._fuzzy_match(name_col, cleaned) is not None
        )

    def _find_col(self, df: pd.DataFrame, col_name: str) -> str:
        cleaned = {self._clean_col(c): c for c in df.columns}
        if col_name in cleaned:
            return cleaned[col_name]
        for k, v in cleaned.items():
            if k.lower() == col_name.lower():
                return v
        for k, v in cleaned.items():
            if col_name.lower() in k.lower() or k.lower() in col_name.lower():
                return v
        return col_name

    @staticmethod
    def _fuzzy_match(target: str, options: List[str]) -> Optional[str]:
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
