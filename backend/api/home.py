"""
api/home.py
-----------
Home page data (MSN Finance style).

Provider hierarchy:
  Tape / movers → Twelve Data batch quotes  (primary, if key set)
               → yfinance download          (fallback — free, no key)
  News          → Finnhub /news?category=general
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Optional

import pandas as pd
import yfinance as yf
from fastapi import APIRouter
from services.instruments.twelvedata_provider import TwelveDataProvider
from services.finnhub_provider import get_finnhub_provider

router = APIRouter(prefix="/api/home", tags=["home"])

# ─────────────────────────────────────────────────────────────────────────────
# Providers
# ─────────────────────────────────────────────────────────────────────────────

_td_key  = os.getenv("TWELVE_DATA_API_KEY", "")
_td: Optional[TwelveDataProvider] = TwelveDataProvider(_td_key) if _td_key else None
_finnhub = get_finnhub_provider()

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
# Twelve Data helpers (primary when key is available)
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
# yfinance helpers (fallback — no API key needed)
# ─────────────────────────────────────────────────────────────────────────────

def _yf_batch_quotes(tickers: list[str]) -> dict[str, dict]:
    """
    Fetch last 2 days of close prices for a batch of tickers via yfinance.
    Returns {ticker: {price, change_pct}}.
    Works with all ticker formats: ^GSPC, BTC-USD, GC=F, EURUSD=X, etc.
    """
    try:
        symbols = tickers if len(tickers) > 1 else tickers[0]
        raw = yf.download(
            symbols,
            period="5d",       # 5 days to ensure we always get 2 trading days
            interval="1d",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
        if raw is None or raw.empty:
            return {}

        if isinstance(raw.columns, pd.MultiIndex):
            closes = raw["Close"]
        else:
            closes = raw[["Close"]].rename(columns={"Close": tickers[0]})

        result: dict[str, dict] = {}
        for sym in tickers:
            if sym not in closes.columns:
                continue
            prices = closes[sym].dropna()
            if len(prices) < 1:
                continue
            price = float(prices.iloc[-1])
            prev  = float(prices.iloc[-2]) if len(prices) >= 2 else price
            change_pct = round((price - prev) / prev * 100, 2) if prev else 0.0
            result[sym] = {"price": round(price, 6), "change_pct": change_pct}
        return result
    except Exception as e:
        print(f"[home] yfinance batch_quotes failed: {e}")
        return {}


async def _yf_fetch_tape(tickers: list[str]) -> list[dict]:
    loop   = asyncio.get_event_loop()
    quotes = await loop.run_in_executor(None, _yf_batch_quotes, tickers)
    result = []
    for sym in tickers:
        q = quotes.get(sym)
        if q and q.get("price"):
            result.append({
                "ticker":     sym,
                "label":      TAPE_LABELS.get(sym, sym),
                "price":      q["price"],
                "change_pct": q["change_pct"],
            })
    return result


async def _yf_fetch_movers(tickers: list[str]) -> tuple[list[dict], list[dict]]:
    loop   = asyncio.get_event_loop()
    quotes = await loop.run_in_executor(None, _yf_batch_quotes, tickers)
    rows   = [
        {
            "ticker":     sym,
            "price":      round(q["price"], 2),
            "change_pct": q["change_pct"],
        }
        for sym, q in quotes.items() if q.get("price")
    ]
    rows.sort(key=lambda x: x["change_pct"], reverse=True)
    return rows[:5], rows[-5:][::-1]


# ─────────────────────────────────────────────────────────────────────────────
# Market data builder
# ─────────────────────────────────────────────────────────────────────────────

async def _build_market_data_async() -> dict:
    """Build full market payload. TD (primary) or yfinance (fallback) for tape/movers."""
    if _td:
        # Twelve Data primary
        tape_task   = asyncio.create_task(_td_fetch_tape(TAPE_TICKERS))
        movers_task = asyncio.create_task(_td_fetch_movers(MOVERS_UNIVERSE))
        news_task   = asyncio.create_task(_finnhub.get_market_news(limit=9))

        tape            = await tape_task
        gainers, losers = await movers_task
        news            = await news_task
        source = "twelvedata+finnhub"
    else:
        # yfinance fallback — works without any API key
        print("[home] No TWELVE_DATA_API_KEY — using yfinance for tape/movers")
        tape_task   = asyncio.create_task(_yf_fetch_tape(TAPE_TICKERS))
        movers_task = asyncio.create_task(_yf_fetch_movers(MOVERS_UNIVERSE))
        news_task   = asyncio.create_task(_finnhub.get_market_news(limit=9))

        tape            = await tape_task
        gainers, losers = await movers_task
        news            = await news_task
        source = "yfinance+finnhub"

    tape_map = {t["ticker"]: t for t in tape}
    indices  = [tape_map[s] for s in KEY_INDICES if s in tape_map]

    return {
        "tape":      tape,
        "indices":   indices,
        "gainers":   gainers,
        "losers":    losers,
        "news":      news,
        "source":    source,
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
    - gainers : top 5 daily gainers
    - losers  : top 5 daily losers
    - news    : latest market news

    Cached server-side for 5 minutes.
    Source: Twelve Data (if key set) or yfinance — both free for demo use.
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
