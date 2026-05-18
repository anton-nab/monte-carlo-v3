"""
api/screener.py
---------------
GET /api/screener
GET /api/screener/debug   ← diagnose data sources

Stock screener over the S&P 500 universe.

Universe : S&P 500 constituents from GitHub CSV (~503 stocks, cached 24 h)
Quotes   : yfinance.download() — primary, no API key, same as /simulate
           Twelve Data /quote  — optional enrichment (exchange name)

Filters  : sector (from CSV, instant), exchange (from TD when key is set)
Sort     : change_pct, volume, price, ticker (server-side)
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from services.fmp_provider import get_fmp_provider

router = APIRouter(prefix="/api/screener", tags=["screener"])

VALID_SECTORS = {
    "Technology", "Healthcare", "Financials", "Consumer Cyclical",
    "Consumer Defensive", "Energy", "Industrials", "Basic Materials",
    "Communication Services", "Real Estate", "Utilities",
}

VALID_SORT = {"change_pct", "volume", "price", "ticker"}


@router.get("/debug", summary="Diagnose screener data sources")
async def debug_screener() -> dict[str, Any]:
    """
    Quick health-check for the screener data pipeline.
    Fetches one stock (AAPL) from each quote source and reports what comes back.
    Useful to verify environment variables and connectivity on Railway.
    """
    import yfinance as yf
    import httpx

    result: dict[str, Any] = {
        "env": {
            "TWELVE_DATA_API_KEY": "set" if os.getenv("TWELVE_DATA_API_KEY") else "NOT SET",
        },
        "yfinance": {},
        "twelve_data": {},
    }

    # Test yfinance
    try:
        raw = yf.download("AAPL", period="5d", auto_adjust=True, progress=False)
        if raw is not None and not raw.empty:
            closes = raw["Close"].dropna()
            result["yfinance"] = {
                "ok": True,
                "last_close": float(closes.iloc[-1]) if not closes.empty else None,
                "rows": len(raw),
            }
        else:
            result["yfinance"] = {"ok": False, "error": "empty DataFrame"}
    except Exception as exc:
        result["yfinance"] = {"ok": False, "error": str(exc)}

    # Test Twelve Data (only if key is set)
    td_key = os.getenv("TWELVE_DATA_API_KEY", "")
    if td_key:
        try:
            with httpx.Client(timeout=10) as c:
                resp = c.get(
                    "https://api.twelvedata.com/quote",
                    params={"symbol": "AAPL", "apikey": td_key},
                )
                data = resp.json()
            result["twelve_data"] = {
                "ok": not data.get("code"),
                "status": resp.status_code,
                "close": data.get("close"),
                "exchange": data.get("exchange"),
                "error": data.get("message") if data.get("code") else None,
            }
        except Exception as exc:
            result["twelve_data"] = {"ok": False, "error": str(exc)}
    else:
        result["twelve_data"] = {"ok": False, "skipped": "TWELVE_DATA_API_KEY not set"}

    return result


@router.get("", summary="S&P 500 stock screener")
async def get_screener(
    sector:   str = Query(default="", description="Sector filter"),
    exchange: str = Query(default="", description="Exchange: NASDAQ, NYSE, AMEX"),
    sort_by:  str = Query(default="change_pct", description="Sort field"),
    sort_dir: str = Query(default="desc",       description="asc or desc"),
    limit:    int = Query(default=50, ge=1, le=503, description="Max results"),
) -> dict[str, Any]:
    """
    Screen S&P 500 stocks by sector and exchange.

    Returns price, change %, volume and exchange from Twelve Data
    (cached 12 h). Sector comes from the free GitHub CSV.
    """
    if sector and sector not in VALID_SECTORS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown sector '{sector}'. Valid: {sorted(VALID_SECTORS)}",
        )

    fmp_exchange = ""
    if exchange:
        ex = exchange.upper().strip()
        if ex in ("NASDAQ", "NYSE", "AMEX"):
            fmp_exchange = ex
        else:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown exchange '{exchange}'. Valid: NASDAQ, NYSE, AMEX",
            )

    fmp = get_fmp_provider()

    try:
        stocks = await fmp.get_screener(
            sector=sector,
            exchange=fmp_exchange,
            limit=limit,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    # Server-side sort
    def _key(s: dict) -> float:
        if sort_by == "ticker":
            return 0.0  # ticker sort handled separately
        return float(s.get(sort_by) or 0)

    if sort_by == "ticker":
        stocks.sort(key=lambda s: s.get("ticker", ""), reverse=(sort_dir == "desc"))
    else:
        stocks.sort(key=_key, reverse=(sort_dir.lower() != "asc"))

    return {
        "count":    len(stocks),
        "universe": "S&P 500",
        "filters":  {
            "sector":   sector,
            "exchange": fmp_exchange,
            "sort_by":  sort_by,
            "sort_dir": sort_dir,
            "limit":    limit,
        },
        "stocks": stocks[:limit],
    }
