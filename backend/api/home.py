"""
api/home.py
-----------
Home page data (MSN Finance style).

Phase 8.6: yfinance fully removed.
  - Tape / movers → Twelve Data batch quotes (unchanged)
  - News          → FMP /v4/general_news (replaces yf.Ticker('^GSPC').news)
  - Fallback: if TD unavailable, return empty arrays (no yfinance)
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter
from services.instruments.twelvedata_provider import TwelveDataProvider
from services.fmp_provider import get_fmp_provider

router = APIRouter(prefix="/api/home", tags=["home"])

# ─────────────────────────────────────────────────────────────────────────────
# Providers
# ─────────────────────────────────────────────────────────────────────────────

_td_key = os.getenv("TWELVE_DATA_API_KEY", "")
_td: Optional[TwelveDataProvider] = TwelveDataProvider(_td_key) if _td_key else None
_fmp = get_fmp_provider()

# ─────────────────────────────────────────────────────────────────────────────
# Ticker universe
# ─────────────────────────────────────────────────────────────────────────────

TAPE_TICKERS = [
    "^GSPC", "^NDX", "^DJI", "^VIX", "^RUT", "^FTSE", "^N225",
    "GC=F",  "CL=F", "BTC-USD", "ETH-USD", "EURUSD=X", "^TNX",
    "AAPL",  "NVDA", "MSFT",
]

TAPE_LABELS = {
    "^GSPC":    "S&P 500",
    "^NDX":     "NASDAQ",
    "^DJI":     "DOW",
    "^VIX":     "VIX",
    "^RUT":     "RUSSELL",
    "^FTSE":    "FTSE",
    "^N225":    "NIKKEI",
    "GC=F":     "GOLD",
    "CL=F":     "OIL",
    "BTC-USD":  "BTC",
    "ETH-USD":  "ETH",
    "EURUSD=X": "EUR/USD",
    "^TNX":     "US 10Y",
    "AAPL":     "AAPL",
    "NVDA":     "NVDA",
    "MSFT":     "MSFT",
}

MOVERS_UNIVERSE = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B",
    "JPM",  "V",    "UNH",   "XOM",  "WMT",  "JNJ",  "MA",   "HD",
    "PG",   "CVX",  "MRK",   "ABBV", "COST", "BAC",  "PFE",  "KO",
    "AMD",  "INTC", "CRM",   "NFLX", "DIS",  "UBER",
]

KEY_INDICES = [
    "^GSPC", "^NDX", "^DJI", "^VIX",
    "GC=F",  "CL=F", "BTC-USD", "EURUSD=X", "^TNX",
]

_cache: dict = {"ts": 0.0, "data": None}
_CACHE_TTL   = 300  # 5 minutes


# ─────────────────────────────────────────────────────────────────────────────
# Twelve Data helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _td_fetch_tape(tickers: list[str]) -> list[dict]:
    assert _td is not None
    try:
        quotes = await _td.get_batch_quotes(tickers)
        result = []
        for sym in tickers:
            q = quotes.get(sym, {})
            if "error" in q or not q.get("price"):
                continue
            result.append({
                "ticker":     sym,
                "label":      TAPE_LABELS.get(sym, sym),
                "price":      q["price"],
                "change_pct": round(float(q.get("change_pct", 0)), 2),
            })
        return result
    except Exception as e:
        print(f"[home] TD tape fetch failed: {e}")
        return []


async def _td_fetch_movers(tickers: list[str]) -> tuple[list[dict], list[dict]]:
    assert _td is not None
    try:
        quotes = await _td.get_batch_quotes(tickers)
        rows = []
        for sym in tickers:
            q = quotes.get(sym, {})
            if "error" in q or not q.get("price"):
                continue
            rows.append({
                "ticker":     sym,
                "price":      round(float(q["price"]), 2),
                "change_pct": round(float(q.get("change_pct", 0)), 2),
            })
        rows.sort(key=lambda x: x["change_pct"], reverse=True)
        return rows[:5], rows[-5:][::-1]
    except Exception as e:
        print(f"[home] TD movers fetch failed: {e}")
        return [], []


# ─────────────────────────────────────────────────────────────────────────────
# Market data builder
# ─────────────────────────────────────────────────────────────────────────────

async def _build_market_data_async() -> dict:
    """Build full market payload. TD for tape/movers, FMP for news."""
    if _td:
        tape_task   = asyncio.create_task(_td_fetch_tape(TAPE_TICKERS))
        movers_task = asyncio.create_task(_td_fetch_movers(MOVERS_UNIVERSE))
        news_task   = asyncio.create_task(_fmp.get_general_news(limit=9))

        tape            = await tape_task
        gainers, losers = await movers_task
        news            = await news_task
    else:
        # No TD key — return empty market data (should not happen in production)
        print("[home] No TWELVE_DATA_API_KEY configured — returning empty market data")
        tape, gainers, losers = [], [], []
        news = await _fmp.get_general_news(limit=9)

    tape_map = {t["ticker"]: t for t in tape}
    indices  = [tape_map[s] for s in KEY_INDICES if s in tape_map]

    return {
        "tape":      tape,
        "indices":   indices,
        "gainers":   gainers,
        "losers":    losers,
        "news":      news,
        "source":    "twelvedata+fmp",
        "cached_at": datetime.now(tz=timezone.utc).isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/market", summary="Home page data (tape + indices + movers + news)")
async def get_market_data():
    """
    Returns in one request:
    - tape    : 16 symbols (price + Δ%) for the scrolling ticker
    - indices : key indices grid
    - gainers : top 5 daily gainers (from Twelve Data)
    - losers  : top 5 daily losers
    - news    : latest market news (FMP general_news)

    Cached server-side for 5 minutes.
    Source: Twelve Data (tape/movers) + FMP (news). No yfinance.
    """
    global _cache
    now = time.time()
    if _cache["data"] is None or (now - _cache["ts"]) > _CACHE_TTL:
        data   = await _build_market_data_async()
        _cache = {"ts": now, "data": data}
    return _cache["data"]


@router.get("/tape", summary="Ticker tape only (lightweight)")
async def get_tape():
    global _cache
    now = time.time()
    if _cache["data"] is None or (now - _cache["ts"]) > _CACHE_TTL:
        data   = await _build_market_data_async()
        _cache = {"ts": now, "data": data}
    return {"tape": _cache["data"]["tape"], "cached_at": _cache["data"]["cached_at"]}
