"""
IndicesService — orchestrates constituent fetching + price enrichment.

Phase 8.6: replaced yfinance + pandas with:
  - FMP /v3/quote/{tickers}  → constituent prices (batch, 60-min cache)
  - Twelve Data /quote       → index-level quote (price + Δ%)
  - yfinance completely removed

Two-phase loading:
  Pass include_prices=False to skip price enrichment and return immediately.
  Prices are fetched on the second call.

Caching:
  - Constituents:  24h (unchanged)
  - Prices:        60min (was 15min — FMP API budget constraint)
"""

import asyncio
import os
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

import httpx

from .indices_registry import INDICES_REGISTRY, get_index, resolve_symbol
from .wikipedia_provider import WikipediaProvider
from .csv_provider import CsvProvider
from services.fmp_provider import get_fmp_provider

# ── Twelve Data quote (index-level) ──────────────────────────────────────────
from services.instruments.twelvedata_provider import TwelveDataProvider, map_symbol

TD_BASE = "https://api.twelvedata.com"


class IndicesService:

    PRICE_CACHE_TTL = timedelta(minutes=60)   # was 15 — FMP budget

    def __init__(self) -> None:
        self._wiki = WikipediaProvider()
        self._csv  = CsvProvider()
        self._fmp  = get_fmp_provider()
        self._price_cache: Dict[str, tuple] = {}

        _td_key = os.getenv("TWELVE_DATA_API_KEY", "")
        self._td: Optional[TwelveDataProvider] = (
            TwelveDataProvider(_td_key) if _td_key else None
        )

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    async def list_indices(self) -> List[Dict[str, Any]]:
        """Return a lightweight list of all supported indices (no constituents)."""
        results = []
        for symbol, cfg in INDICES_REGISTRY.items():
            idx_quote = await self._get_index_quote(cfg["yf_ticker"])
            results.append({
                "symbol":            symbol,
                "name":              cfg["name"],
                "description":       cfg["description"],
                "region":            cfg["region"],
                "exchange":          cfg["exchange"],
                "currency":          cfg["currency"],
                "flag":              cfg.get("flag", ""),
                "yf_ticker":         cfg["yf_ticker"],
                "has_constituents":  cfg["source"] != "none",
                **idx_quote,
            })
        return results

    async def get_index(
        self,
        symbol: str,
        include_prices: bool = True,
    ) -> Dict[str, Any]:
        """Return full index data: metadata + constituents (+ prices if requested)."""
        symbol = resolve_symbol(symbol)
        cfg = get_index(symbol)
        if cfg is None:
            raise ValueError(f"Unknown index: {symbol}")

        idx_quote    = await self._get_index_quote(cfg["yf_ticker"])
        constituents = await self._get_constituents(symbol, cfg)

        if constituents and include_prices:
            constituents = await self._enrich_prices(constituents, symbol)
        elif constituents and not include_prices:
            constituents = [
                {**c, "price": None, "change_pct": None, "volume": None}
                for c in constituents
            ]

        sectors = self._aggregate_sectors(constituents)

        return {
            "symbol":             symbol,
            "name":               cfg["name"],
            "description":        cfg["description"],
            "region":             cfg["region"],
            "exchange":           cfg["exchange"],
            "currency":           cfg["currency"],
            "flag":               cfg.get("flag", ""),
            "yf_ticker":          cfg["yf_ticker"],
            "has_constituents":   len(constituents) > 0,
            "constituents_count": len(constituents),
            "prices_included":    include_prices,
            "last_updated":       datetime.now().isoformat(),
            **idx_quote,
            "constituents": constituents,
            "sectors":      sectors,
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

        if source == "csv":
            try:
                result = await self._csv.get_constituents(symbol)
                if result:
                    return result
            except Exception as exc:
                print(f"[{symbol}] CSV fetch failed: {exc}")
            if "hardcoded" in cfg:
                return list(cfg["hardcoded"])
            return []

        if source == "wikipedia":
            try:
                result = await self._wiki.get_constituents(cfg["wikipedia"])
                if result:
                    return result
            except Exception as exc:
                print(f"[{symbol}] Wikipedia scrape failed: {exc}")
            if "hardcoded" in cfg:
                return list(cfg["hardcoded"])
            return []

        if source == "hardcoded":
            return list(cfg["hardcoded"])

        return []

    # -------------------------------------------------------------------------
    # Internal: price enrichment — FMP batch quotes
    # -------------------------------------------------------------------------

    async def _enrich_prices(
        self,
        constituents: List[Dict[str, Any]],
        cache_key: str,
    ) -> List[Dict[str, Any]]:
        """Add price / change_pct / volume to each constituent via FMP batch."""
        cached = self._price_cache.get(cache_key)
        if cached:
            prices, ts = cached
            if datetime.now() - ts < self.PRICE_CACHE_TTL:
                return self._apply_prices(constituents, prices)

        tickers = [c["ticker"] for c in constituents]
        prices  = await self._fmp.get_batch_quotes(tickers, cache_key=cache_key)

        self._price_cache[cache_key] = (prices, datetime.now())
        return self._apply_prices(constituents, prices)

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
                    "price":      None,
                    "change_pct": None,
                    "volume":     None,
                })
        return enriched

    # -------------------------------------------------------------------------
    # Internal: sector aggregation (unchanged)
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

        total  = sum(s["count"] for s in sectors.values()) or 1
        result = []
        for name, data in sorted(sectors.items(), key=lambda x: -x[1]["count"]):
            avg_chg = (
                round(sum(data["changes"]) / len(data["changes"]), 3)
                if data["changes"] else None
            )
            result.append({
                "name":            name,
                "count":           data["count"],
                "weight_pct":      round(data["count"] / total * 100, 2),
                "avg_change_pct":  avg_chg,
            })
        return result

    # -------------------------------------------------------------------------
    # Internal: index-level quote — Twelve Data primary, empty fallback
    # -------------------------------------------------------------------------

    async def _get_index_quote(self, yf_ticker: str) -> Dict[str, Any]:
        """Get index price + change_pct via Twelve Data (no yfinance)."""
        if self._td:
            try:
                q = await self._td.get_quote(yf_ticker)
                return {
                    "index_price":      q.get("price"),
                    "index_change_pct": q.get("change_pct"),
                }
            except Exception as exc:
                print(f"[IndicesService] TD quote failed for {yf_ticker}: {exc}")
        return {"index_price": None, "index_change_pct": None}
