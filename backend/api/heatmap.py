"""
api/heatmap.py  — Phase 18
--------------------------
GET /api/heatmap

S&P 500 market heatmap data grouped by sector.
Reuses the FMP provider + its 12 h cache (same pipeline as /api/screener).
No extra API quota consumed when the screener was recently fetched.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException

from services.fmp_provider import get_fmp_provider

router = APIRouter(prefix="/api/heatmap", tags=["heatmap"])

# Preferred display order (largest sectors first)
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
]


@router.get("", summary="S&P 500 heatmap grouped by sector")
async def get_heatmap() -> dict[str, Any]:
    """
    Returns all S&P 500 stocks with price / change_pct / sector,
    grouped by sector and sorted alphabetically within each sector.
    """
    fmp = get_fmp_provider()

    try:
        stocks = await fmp.get_screener(sector="", exchange="", limit=503)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    # ── Group by sector ───────────────────────────────────────────────────────
    sectors_dict: dict[str, list[dict]] = {}
    for s in stocks:
        sec = (s.get("sector") or "Other").strip()
        if sec not in sectors_dict:
            sectors_dict[sec] = []
        sectors_dict[sec].append({
            "ticker":     s.get("ticker", ""),
            "name":       s.get("name", ""),
            "change_pct": s.get("change_pct"),   # float | None
            "price":      s.get("price"),         # float | None
        })

    # Sort stocks alphabetically within each sector
    for stocks_in_sec in sectors_dict.values():
        stocks_in_sec.sort(key=lambda x: x["ticker"])

    # ── Build ordered output ──────────────────────────────────────────────────
    sectors_out: list[dict] = []

    def _build_sector(name: str, stocks_in_sec: list[dict]) -> dict:
        valid = [s["change_pct"] for s in stocks_in_sec if s["change_pct"] is not None]
        avg = round(sum(valid) / len(valid), 2) if valid else None
        return {
            "name":       name,
            "count":      len(stocks_in_sec),
            "avg_change": avg,
            "stocks":     stocks_in_sec,
        }

    for sec_name in _SECTOR_ORDER:
        if sec_name in sectors_dict:
            sectors_out.append(_build_sector(sec_name, sectors_dict[sec_name]))

    # Append any unexpected sectors not in the preferred order
    for sec_name, stocks_in_sec in sectors_dict.items():
        if sec_name not in _SECTOR_ORDER:
            sectors_out.append(_build_sector(sec_name, stocks_in_sec))

    return {
        "total":   len(stocks),
        "source":  "S&P 500",
        "as_of":   datetime.now(timezone.utc).strftime("%H:%M UTC"),
        "sectors": sectors_out,
    }
