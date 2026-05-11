"""
api/home.py
-----------
Données pour la page d'accueil (style MSN Finance / Bloomberg terminal).

Phase 7: migrated from yfinance to Twelve Data for tape + movers.
- Tape / movers → Twelve Data batch quotes (commercial-friendly, async)
- News          → yfinance (Twelve Data news is symbol-specific, not market-wide)

Endpoints:
    GET /api/home/market  — tape + indices + movers + news (cached 5 min)
    GET /api/home/tape    — ticker tape only (lightweight)
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Optional

import yfinance as yf
from fastapi import APIRouter

from services.instruments.twelvedata_provider import TwelveDataProvider

router = APIRouter(prefix="/api/home", tags=["home"])

# ─────────────────────────────────────────────────────────────────────────────
# Twelve Data provider (used for tape + movers)
# ─────────────────────────────────────────────────────────────────────────────

_td_key = os.getenv("TWELVE_DATA_API_KEY", "")
_td: Optional[TwelveDataProvider] = TwelveDataProvider(_td_key) if _td_key else None

# ─────────────────────────────────────────────────────────────────────────────
# Ticker universe
# ─────────────────────────────────────────────────────────────────────────────

TAPE_TICKERS = [
    "^GSPC",    # S&P 500
    "^NDX",     # NASDAQ 100
    "^DJI",     # Dow Jones
    "^VIX",     # VIX
    "^RUT",     # Russell 2000
    "^FTSE",    # FTSE 100
    "^N225",    # Nikkei 225
    "GC=F",     # Gold
    "CL=F",     # WTI Crude
    "BTC-USD",  # Bitcoin
    "ETH-USD",  # Ethereum
    "EURUSD=X", # EUR/USD
    "^TNX",     # US 10Y Treasury
    "AAPL",     # Apple
    "NVDA",     # NVIDIA
    "MSFT",     # Microsoft
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

# In-memory cache (5-min TTL)
_cache: dict = {"ts": 0.0, "data": None}
_CACHE_TTL   = 300


# ─────────────────────────────────────────────────────────────────────────────
# Twelve Data async helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _td_fetch_tape(tickers: list[str]) -> list[dict]:
    """Fetch tape data using Twelve Data batch quotes."""
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
    """Fetch movers using Twelve Data batch quotes."""
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
        gainers = rows[:5]
        losers  = rows[-5:][::-1]
        return gainers, losers
    except Exception as e:
        print(f"[home] TD movers fetch failed: {e}")
        return [], []


# ─────────────────────────────────────────────────────────────────────────────
# yfinance fallback helpers (used when TD key not configured, or for news)
# ─────────────────────────────────────────────────────────────────────────────

def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return None if (f != f) else round(f, 4)
    except Exception:
        return None


def _yf_fetch_tape(tickers: list[str]) -> list[dict]:
    """yfinance fallback for tape data."""
    try:
        raw = yf.download(
            tickers, period="2d", auto_adjust=True,
            progress=False, threads=True,
        )
        if raw.empty:
            return []

        closes = raw["Close"] if hasattr(raw.columns, "levels") else (
            raw[["Close"]].rename(columns={"Close": tickers[0]})
        )
        result = []
        for sym in tickers:
            if sym not in closes.columns:
                continue
            col = closes[sym].dropna()
            if len(col) < 1:
                continue
            price = _safe_float(col.iloc[-1])
            if price is None:
                continue
            chg_pct = 0.0
            if len(col) >= 2:
                prev = float(col.iloc[-2])
                chg_pct = round((float(col.iloc[-1]) - prev) / prev * 100, 2) if prev else 0.0
            result.append({
                "ticker":     sym,
                "label":      TAPE_LABELS.get(sym, sym),
                "price":      price,
                "change_pct": chg_pct,
            })
        return result
    except Exception:
        return []


def _yf_fetch_movers(tickers: list[str]) -> tuple[list[dict], list[dict]]:
    """yfinance fallback for movers."""
    try:
        raw = yf.download(
            tickers, period="2d", auto_adjust=True,
            progress=False, threads=True,
        )
        if raw.empty:
            return [], []

        closes = raw["Close"] if hasattr(raw.columns, "levels") else (
            raw[["Close"]].rename(columns={"Close": tickers[0]})
        )
        rows = []
        for sym in tickers:
            if sym not in closes.columns:
                continue
            col = closes[sym].dropna()
            if len(col) < 2:
                continue
            prev  = float(col.iloc[-2])
            curr  = float(col.iloc[-1])
            if prev <= 0:
                continue
            chg_pct = round((curr - prev) / prev * 100, 2)
            rows.append({"ticker": sym, "price": round(curr, 2), "change_pct": chg_pct})

        rows.sort(key=lambda x: x["change_pct"], reverse=True)
        return rows[:5], rows[-5:][::-1]
    except Exception:
        return [], []


def _fetch_news(ticker: str = "^GSPC", max_items: int = 8) -> list[dict]:
    """Market news via yfinance (TD news is symbol-specific, not general)."""
    try:
        news_raw = yf.Ticker(ticker).news or []
        result = []
        for item in news_raw[:max_items]:
            title     = item.get("title") or item.get("content", {}).get("title", "")
            publisher = (
                item.get("publisher")
                or item.get("content", {}).get("provider", {}).get("displayName", "")
            )
            link = (
                item.get("link")
                or item.get("content", {}).get("canonicalUrl", {}).get("url", "#")
            )
            ts = item.get("providerPublishTime") or item.get("content", {}).get("pubDate", "")

            if isinstance(ts, (int, float)) and ts > 0:
                ts_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%d %b, %H:%M")
            elif isinstance(ts, str) and ts:
                ts_str = ts[:16]
            else:
                ts_str = ""

            if title:
                result.append({
                    "title":     title,
                    "publisher": publisher,
                    "link":      link,
                    "published": ts_str,
                })
        return result
    except Exception:
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Async market data builder
# ─────────────────────────────────────────────────────────────────────────────

async def _build_market_data_async() -> dict:
    """Build full market payload asynchronously."""
    import asyncio

    if _td:
        # Twelve Data path (commercial-friendly, async)
        tape_task   = asyncio.create_task(_td_fetch_tape(TAPE_TICKERS))
        movers_task = asyncio.create_task(_td_fetch_movers(MOVERS_UNIVERSE))
        loop = asyncio.get_event_loop()
        news_task   = loop.run_in_executor(None, _fetch_news, "^GSPC", 9)

        tape              = await tape_task
        gainers, losers   = await movers_task
        news              = await news_task

        # If TD tape is empty (market closed / rate limit) fall back to yf
        if not tape:
            print("[home] TD tape empty, falling back to yfinance")
            tape = await loop.run_in_executor(None, _yf_fetch_tape, TAPE_TICKERS)
        if not gainers and not losers:
            gainers, losers = await loop.run_in_executor(
                None, _yf_fetch_movers, MOVERS_UNIVERSE
            )
    else:
        # yfinance fallback path (no TD key configured)
        loop = asyncio.get_event_loop()
        tape            = await loop.run_in_executor(None, _yf_fetch_tape, TAPE_TICKERS)
        gainers, losers = await loop.run_in_executor(None, _yf_fetch_movers, MOVERS_UNIVERSE)
        news            = await loop.run_in_executor(None, _fetch_news, "^GSPC", 9)

    tape_map = {t["ticker"]: t for t in tape}
    indices  = [tape_map[s] for s in KEY_INDICES if s in tape_map]

    return {
        "tape":      tape,
        "indices":   indices,
        "gainers":   gainers,
        "losers":    losers,
        "news":      news,
        "source":    "twelvedata" if _td else "yfinance",
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
    - news    : latest financial news

    Cached server-side for 5 minutes.
    Phase 7: primary source is Twelve Data (commercial OK), yfinance fallback.
    """
    global _cache
    now = time.time()

    if _cache["data"] is None or (now - _cache["ts"]) > _CACHE_TTL:
        data      = await _build_market_data_async()
        _cache    = {"ts": now, "data": data}

    return _cache["data"]


@router.get("/tape", summary="Ticker tape only (lightweight)")
async def get_tape():
    """Tape only — fresh if cache cold, reuse if warm."""
    global _cache
    now = time.time()

    if _cache["data"] is None or (now - _cache["ts"]) > _CACHE_TTL:
        data   = await _build_market_data_async()
        _cache = {"ts": now, "data": data}

    return {"tape": _cache["data"]["tape"], "cached_at": _cache["data"]["cached_at"]}
