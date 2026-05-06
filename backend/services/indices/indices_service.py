"""
IndicesService — orchestrates constituent fetching + price enrichment.

Pipeline per request:
  1. Get index config from registry
  2. Get constituent list (FMP → hardcoded/Wikipedia fallback)
  3. Optionally batch-download prices via yfinance (one call for all tickers)
  4. Enrich each constituent with price/change data
  5. Aggregate sector stats
  6. Return unified response dict

Two-phase loading:
  Pass include_prices=False to skip price enrichment and return immediately
  (constituents + metadata only). The frontend then makes a second request
  with include_prices=True to get prices in the background.

Caching strategy:
  - Constituents:  24h (FMP in-memory cache / Wikipedia)
  - Prices:        15 min (yfinance batch, in-memory)
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

import yfinance as yf
import pandas as pd

from .indices_registry import INDICES_REGISTRY, get_index
from .wikipedia_provider import WikipediaProvider
from ..fmp_provider import FMPProvider, get_fmp_provider


class IndicesService:

    PRICE_CACHE_TTL = timedelta(minutes=15)

    def __init__(self) -> None:
        self._wiki = WikipediaProvider()
        self._fmp: FMPProvider = get_fmp_provider()
        self._price_cache: Dict[str, tuple] = {}

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    async def list_indices(self) -> List[Dict[str, Any]]:
        """Return a lightweight list of all supported indices (no constituents)."""
        results = []
        for symbol, cfg in INDICES_REGISTRY.items():
            idx_quote = await self._get_index_quote(cfg["yf_ticker"])
            results.append({
                "symbol": symbol,
                "name": cfg["name"],
                "description": cfg["description"],
                "region": cfg["region"],
                "exchange": cfg["exchange"],
                "currency": cfg["currency"],
                "flag": cfg.get("flag", ""),
                "yf_ticker": cfg["yf_ticker"],
                "has_constituents": cfg["source"] != "none",
                **idx_quote,
            })
        return results

    async def get_index(
        self,
        symbol: str,
        include_prices: bool = True,
    ) -> Dict[str, Any]:
        """Return full index data: metadata + constituents (+ prices if requested).

        Args:
            symbol: Index symbol (SP500, NDX, DJI, CAC40, DAX, FTSE100, …)
            include_prices: If False, skip yfinance price enrichment and return
                            constituent list immediately (fast path for two-phase
                            loading on the frontend). Prices will be None.
        """
        cfg = get_index(symbol)
        if cfg is None:
            raise ValueError(f"Unknown index: {symbol}")

        # 1. Get index-level quote (fast — uses fast_info)
        idx_quote = await self._get_index_quote(cfg["yf_ticker"])

        # 2. Get constituents (FMP or hardcoded or Wikipedia)
        constituents = await self._get_constituents(symbol, cfg)

        # 3. Optionally enrich with prices
        if constituents and include_prices:
            constituents = await self._enrich_prices(constituents, symbol)
        elif constituents and not include_prices:
            # Return without prices — frontend will request prices separately
            constituents = [
                {**c, "price": None, "change_pct": None, "volume": None}
                for c in constituents
            ]

        # 4. Aggregate sectors
        sectors = self._aggregate_sectors(constituents)

        return {
            "symbol": symbol,
            "name": cfg["name"],
            "description": cfg["description"],
            "region": cfg["region"],
            "exchange": cfg["exchange"],
            "currency": cfg["currency"],
            "flag": cfg.get("flag", ""),
            "yf_ticker": cfg["yf_ticker"],
            "has_constituents": len(constituents) > 0,
            "constituents_count": len(constituents),
            "prices_included": include_prices,
            "last_updated": datetime.now().isoformat(),
            **idx_quote,
            "constituents": constituents,
            "sectors": sectors,
        }

    # -------------------------------------------------------------------------
    # Internal: constituents
    # -------------------------------------------------------------------------

    async def _get_constituents(
        self,
        symbol: str,
        cfg: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        source = cfg.get("source", "none")

        if source == "fmp":
            fmp_symbol = cfg.get("fmp_symbol", symbol)
            try:
                result = await self._fmp.get_index_constituents(fmp_symbol)
                if result:
                    return result
                print(f"[FMP] Empty result for {fmp_symbol}, trying fallback")
            except Exception as exc:
                print(f"[FMP] Failed for {fmp_symbol}: {exc} — trying fallback")

            # Fallback: hardcoded list
            if "hardcoded" in cfg:
                print(f"[{symbol}] Using hardcoded fallback ({len(cfg['hardcoded'])} stocks)")
                return list(cfg["hardcoded"])

            # Fallback: Wikipedia
            if "wikipedia" in cfg:
                print(f"[{symbol}] Using Wikipedia fallback")
                try:
                    return await self._wiki.get_constituents(cfg["wikipedia"])
                except Exception as exc:
                    print(f"[{symbol}] Wikipedia fallback also failed: {exc}")
            return []

        if source == "hardcoded":
            return list(cfg["hardcoded"])

        if source == "wikipedia":
            try:
                return await self._wiki.get_constituents(cfg["wikipedia"])
            except Exception as exc:
                print(f"[{symbol}] Wikipedia scrape failed: {exc}")
                return []

        return []  # source == "none"

    # -------------------------------------------------------------------------
    # Internal: price enrichment
    # -------------------------------------------------------------------------

    async def _enrich_prices(
        self,
        constituents: List[Dict[str, Any]],
        cache_key: str,
    ) -> List[Dict[str, Any]]:
        """Add price / change_pct to each constituent via yfinance batch download."""
        cached = self._price_cache.get(cache_key)
        if cached:
            prices, ts = cached
            if datetime.now() - ts < self.PRICE_CACHE_TTL:
                return self._apply_prices(constituents, prices)

        tickers = [c["ticker"] for c in constituents]
        prices = await self._fetch_prices_batch(tickers)
        self._price_cache[cache_key] = (prices, datetime.now())
        return self._apply_prices(constituents, prices)

    async def _fetch_prices_batch(
        self, tickers: List[str]
    ) -> Dict[str, Dict[str, Any]]:
        """Batch download latest prices. Returns {ticker: {price, change_pct, volume}}."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._sync_fetch_prices, tickers
        )

    @staticmethod
    def _sync_fetch_prices(tickers: List[str]) -> Dict[str, Dict[str, Any]]:
        """Synchronous price fetch — runs in thread pool."""
        result: Dict[str, Dict[str, Any]] = {}
        if not tickers:
            return result

        try:
            raw = yf.download(
                tickers=" ".join(tickers),
                period="5d",
                auto_adjust=True,
                progress=False,
                threads=True,
            )
        except Exception as exc:
            print(f"yfinance batch download failed: {exc}")
            return result

        if raw.empty:
            return result

        close = raw.get("Close")
        volume = raw.get("Volume")

        if close is None or close.empty:
            return result

        # Single ticker returns a flat Series
        if isinstance(close, pd.Series):
            close = close.to_frame(tickers[0])
        if volume is not None and isinstance(volume, pd.Series):
            volume = volume.to_frame(tickers[0])

        close = close.dropna(how="all")
        if len(close) < 2:
            return result

        last_close = close.iloc[-1]
        prev_close = close.iloc[-2]

        for ticker in close.columns:
            try:
                price = float(last_close[ticker])
                prev = float(prev_close[ticker])
                if pd.isna(price) or pd.isna(prev) or prev == 0:
                    continue
                change_pct = (price - prev) / prev * 100
                vol = None
                if volume is not None and ticker in volume.columns:
                    v = volume.iloc[-1][ticker]
                    vol = int(v) if pd.notna(v) else None

                result[ticker] = {
                    "price": round(price, 4),
                    "change_pct": round(change_pct, 3),
                    "volume": vol,
                }
            except Exception:
                continue

        return result

    @staticmethod
    def _apply_prices(
        constituents: List[Dict[str, Any]],
        prices: Dict[str, Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        enriched = []
        for c in constituents:
            p = prices.get(c["ticker"])
            if p:
                enriched.append({**c, **p})
            else:
                enriched.append({
                    **c,
                    "price": None,
                    "change_pct": None,
                    "volume": None,
                })
        return enriched

    # -------------------------------------------------------------------------
    # Internal: sector aggregation
    # -------------------------------------------------------------------------

    @staticmethod
    def _aggregate_sectors(
        constituents: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        sectors: Dict[str, Dict] = {}
        for c in constituents:
            sector = c.get("sector") or "Other"
            if sector not in sectors:
                sectors[sector] = {"count": 0, "changes": [], "name": sector}
            sectors[sector]["count"] += 1
            chg = c.get("change_pct")
            if chg is not None:
                sectors[sector]["changes"].append(chg)

        total = sum(s["count"] for s in sectors.values()) or 1
        result = []
        for name, data in sorted(sectors.items(), key=lambda x: -x[1]["count"]):
            avg_chg = (
                round(sum(data["changes"]) / len(data["changes"]), 3)
                if data["changes"]
                else None
            )
            result.append({
                "name": name,
                "count": data["count"],
                "weight_pct": round(data["count"] / total * 100, 2),
                "avg_change_pct": avg_chg,
            })
        return result

    # -------------------------------------------------------------------------
    # Internal: index-level quote
    # -------------------------------------------------------------------------

    async def _get_index_quote(self, yf_ticker: str) -> Dict[str, Any]:
        loop = asyncio.get_event_loop()
        try:
            return await loop.run_in_executor(
                None, self._sync_index_quote, yf_ticker
            )
        except Exception:
            return {"index_price": None, "index_change_pct": None}

    @staticmethod
    def _sync_index_quote(yf_ticker: str) -> Dict[str, Any]:
        try:
            fi = yf.Ticker(yf_ticker).fast_info
            price = getattr(fi, "last_price", None)
            prev = getattr(fi, "previous_close", None)
            change_pct = None
            if price and prev and prev != 0:
                change_pct = round((price - prev) / prev * 100, 3)
            return {
                "index_price": round(float(price), 2) if price else None,
                "index_change_pct": change_pct,
            }
        except Exception:
            return {"index_price": None, "index_change_pct": None}
