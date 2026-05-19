"""
api/heatmap.py  — Phase 18 (TradingView-style treemap)
-------------------------------------------------------
GET /api/heatmap?index=sp500

Supported indices:
  sp500       — S&P 500 (~503 stocks, grouped by GICS sector)
  nasdaq100   — Nasdaq 100 (tech-heavy)
  dowjones    — Dow Jones 30 (blue chips)
  cac40       — CAC 40 (French large caps)
  commodities — Commodity ETF proxies (Gold, Oil, Wheat, …)

Each stock is returned with market_cap for proportional tile sizing.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from services.fmp_provider import get_fmp_provider

router = APIRouter(prefix="/api/heatmap", tags=["heatmap"])

# ── Preferred sector order (by economic weight) ────────────────────────────────
_SECTOR_ORDER = [
    "Technology",
    "Healthcare",
    "Financials",
    "Consumer Cyclical",
    "Communication Services",
    "Industrials",
    "Consumer Defensive",
    "Energy",
    "Real Estate",
    "Basic Materials",
    "Utilities",
    # International / commodity extras
    "Precious Metals",
    "Industrial Metals",
    "Agriculture",
    "Diversified",
]

# ── Index metadata ─────────────────────────────────────────────────────────────
_INDEX_META = {
    "sp500":       {"label": "S&P 500",     "flag": "🇺🇸"},
    "nasdaq100":   {"label": "Nasdaq 100",  "flag": "🇺🇸"},
    "dowjones":    {"label": "Dow Jones",   "flag": "🇺🇸"},
    "cac40":       {"label": "CAC 40",      "flag": "🇫🇷"},
    "commodities": {"label": "Commodities", "flag": "🌍"},
}


@router.get("", summary="Market heatmap grouped by sector (treemap-ready)")
async def get_heatmap(
    index: str = Query(default="sp500", description="Index key"),
) -> dict[str, Any]:
    """
    Returns all stocks of the chosen index with:
      - price / change_pct for color
      - market_cap for proportional tile sizing (null → equal weight)

    Data is grouped by sector and sorted by market_cap desc within each sector.
    The frontend uses a squarified treemap algorithm to render proportional tiles.
    """
    idx = index.lower().strip()
    if idx not in _INDEX_META:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown index '{idx}'. Supported: {list(_INDEX_META)}",
        )

    fmp = get_fmp_provider()
    try:
        stocks = await fmp.get_heatmap_data(idx)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    # ── Group by sector ────────────────────────────────────────────────────────
    sectors_dict: dict[str, list[dict]] = {}
    for s in stocks:
        sec = (s.get("sector") or "Other").strip()
        sectors_dict.setdefault(sec, []).append({
            "ticker":     s.get("ticker", ""),
            "name":       s.get("name",   ""),
            "change_pct": s.get("change_pct"),    # float | None
            "price":      s.get("price"),          # float | None
            "market_cap": s.get("market_cap"),     # int   | None  ← for treemap
        })

    # Sort stocks by market_cap desc within each sector (largest tile first)
    for lst in sectors_dict.values():
        lst.sort(
            key=lambda x: x["market_cap"] if x["market_cap"] is not None else 0,
            reverse=True,
        )

    # ── Build ordered sector output ────────────────────────────────────────────
    sectors_out: list[dict] = []

    def _build_sector(name: str, stocks_in_sec: list[dict]) -> dict:
        valid_chg = [s["change_pct"] for s in stocks_in_sec if s["change_pct"] is not None]
        valid_mc  = [s["market_cap"] for s in stocks_in_sec if s["market_cap"]  is not None]
        avg       = round(sum(valid_chg) / len(valid_chg), 2) if valid_chg else None
        total_mc  = sum(valid_mc) if valid_mc else None
        return {
            "name":         name,
            "count":        len(stocks_in_sec),
            "avg_change":   avg,
            "total_mktcap": total_mc,
            "stocks":       stocks_in_sec,
        }

    for sec_name in _SECTOR_ORDER:
        if sec_name in sectors_dict:
            sectors_out.append(_build_sector(sec_name, sectors_dict[sec_name]))

    # Append any unexpected sectors not in the preferred order
    for sec_name, stocks_in_sec in sectors_dict.items():
        if sec_name not in _SECTOR_ORDER:
            sectors_out.append(_build_sector(sec_name, stocks_in_sec))

    meta = _INDEX_META[idx]
    return {
        "index":   idx,
        "label":   meta["label"],
        "flag":    meta["flag"],
        "total":   len(stocks),
        "as_of":   datetime.now(timezone.utc).strftime("%H:%M UTC"),
        "sectors": sectors_out,
    }
