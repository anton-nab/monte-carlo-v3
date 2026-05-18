"""
api/calendar.py
---------------
GET /api/calendar?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD

Economic events + earnings + dividend calendar.

Sources
-------
Primary   : Finnhub /calendar/economic + /calendar/earnings (if FINNHUB_API_KEY set)
Supplement: Static FOMC / ECB / BOE / BOJ / SNB / RBA / BOC schedule — always shown
Dividends : yfinance Ticker.info (exDividendDate) — cached 12 h
"""

from __future__ import annotations

import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Any, List

from fastapi import APIRouter, Query
from services.finnhub_provider import get_finnhub_provider

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

# ─────────────────────────────────────────────────────────────────────────────
# Static central-bank schedule (2025-2026)
# ─────────────────────────────────────────────────────────────────────────────

_STATIC_EVENTS: List[dict] = [
    # ── FOMC 2025 ────────────────────────────────────────────────────────
    {"date": "2025-01-29", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2025-03-19", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2025-05-07", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2025-06-18", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2025-07-30", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2025-09-17", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2025-10-29", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2025-12-10", "time": "20:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    # ── FOMC 2026 ────────────────────────────────────────────────────────
    {"date": "2026-01-28", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2026-03-18", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2026-04-29", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2026-06-17", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2026-07-29", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2026-09-16", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2026-10-28", "time": "19:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    {"date": "2026-12-09", "time": "20:00", "country": "US", "flag": "🇺🇸", "title": "FOMC Rate Decision", "impact": "high"},
    # ── ECB 2025 ─────────────────────────────────────────────────────────
    {"date": "2025-01-30", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2025-03-06", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2025-04-17", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2025-06-05", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2025-07-24", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2025-09-11", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2025-10-30", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2025-12-18", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    # ── ECB 2026 ─────────────────────────────────────────────────────────
    {"date": "2026-01-22", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2026-03-05", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2026-04-30", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2026-06-04", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2026-07-23", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2026-09-10", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2026-10-29", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    {"date": "2026-12-17", "time": "13:15", "country": "EU", "flag": "🇪🇺", "title": "ECB Rate Decision", "impact": "high"},
    # ── BOE 2025 ─────────────────────────────────────────────────────────
    {"date": "2025-02-06", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2025-03-20", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2025-05-08", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2025-06-19", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2025-08-07", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2025-09-18", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2025-11-06", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2025-12-18", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    # ── BOE 2026 ─────────────────────────────────────────────────────────
    {"date": "2026-02-05", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2026-03-19", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2026-05-07", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2026-06-18", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2026-08-06", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2026-09-17", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2026-11-05", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    {"date": "2026-12-17", "time": "12:00", "country": "GB", "flag": "🇬🇧", "title": "BoE Rate Decision", "impact": "high"},
    # ── BOJ 2026 ─────────────────────────────────────────────────────────
    {"date": "2026-01-24", "time": "03:00", "country": "JP", "flag": "🇯🇵", "title": "BOJ Rate Decision", "impact": "high"},
    {"date": "2026-03-19", "time": "03:00", "country": "JP", "flag": "🇯🇵", "title": "BOJ Rate Decision", "impact": "high"},
    {"date": "2026-04-30", "time": "03:00", "country": "JP", "flag": "🇯🇵", "title": "BOJ Rate Decision", "impact": "high"},
    {"date": "2026-06-18", "time": "03:00", "country": "JP", "flag": "🇯🇵", "title": "BOJ Rate Decision", "impact": "high"},
    {"date": "2026-07-16", "time": "03:00", "country": "JP", "flag": "🇯🇵", "title": "BOJ Rate Decision", "impact": "high"},
    {"date": "2026-09-17", "time": "03:00", "country": "JP", "flag": "🇯🇵", "title": "BOJ Rate Decision", "impact": "high"},
    {"date": "2026-10-29", "time": "03:00", "country": "JP", "flag": "🇯🇵", "title": "BOJ Rate Decision", "impact": "high"},
    {"date": "2026-12-18", "time": "03:00", "country": "JP", "flag": "🇯🇵", "title": "BOJ Rate Decision", "impact": "high"},
    # ── SNB (Swiss National Bank) 2025 ───────────────────────────────────
    {"date": "2025-03-20", "time": "09:30", "country": "CH", "flag": "🇨🇭", "title": "SNB Rate Decision", "impact": "high"},
    {"date": "2025-06-19", "time": "09:30", "country": "CH", "flag": "🇨🇭", "title": "SNB Rate Decision", "impact": "high"},
    {"date": "2025-09-18", "time": "09:30", "country": "CH", "flag": "🇨🇭", "title": "SNB Rate Decision", "impact": "high"},
    {"date": "2025-12-11", "time": "09:30", "country": "CH", "flag": "🇨🇭", "title": "SNB Rate Decision", "impact": "high"},
    # ── SNB 2026 ─────────────────────────────────────────────────────────
    {"date": "2026-03-19", "time": "09:30", "country": "CH", "flag": "🇨🇭", "title": "SNB Rate Decision", "impact": "high"},
    {"date": "2026-06-18", "time": "09:30", "country": "CH", "flag": "🇨🇭", "title": "SNB Rate Decision", "impact": "high"},
    {"date": "2026-09-17", "time": "09:30", "country": "CH", "flag": "🇨🇭", "title": "SNB Rate Decision", "impact": "high"},
    {"date": "2026-12-10", "time": "09:30", "country": "CH", "flag": "🇨🇭", "title": "SNB Rate Decision", "impact": "high"},
    # ── RBA (Reserve Bank of Australia) 2025 ─────────────────────────────
    {"date": "2025-02-18", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2025-04-01", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2025-05-20", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2025-07-08", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2025-08-05", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2025-09-30", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2025-11-04", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2025-12-09", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    # ── RBA 2026 ─────────────────────────────────────────────────────────
    {"date": "2026-02-17", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2026-03-31", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2026-05-19", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2026-07-07", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2026-08-04", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2026-09-29", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2026-11-03", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    {"date": "2026-12-08", "time": "03:30", "country": "AU", "flag": "🇦🇺", "title": "RBA Rate Decision", "impact": "medium"},
    # ── BOC (Bank of Canada) 2025 ─────────────────────────────────────────
    {"date": "2025-01-29", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2025-03-12", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2025-04-16", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2025-06-04", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2025-07-30", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2025-09-17", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2025-10-29", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2025-12-10", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    # ── BOC 2026 ─────────────────────────────────────────────────────────
    {"date": "2026-01-28", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2026-03-04", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2026-04-15", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2026-06-03", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2026-07-15", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2026-09-09", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2026-10-28", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
    {"date": "2026-12-09", "time": "15:00", "country": "CA", "flag": "🇨🇦", "title": "BoC Rate Decision", "impact": "medium"},
]

# Enrich static events with uniform shape
for _e in _STATIC_EVENTS:
    _e.setdefault("type",     "macro")
    _e.setdefault("previous", None)
    _e.setdefault("estimate", None)
    _e.setdefault("actual",   None)
    _e.setdefault("ticker",   None)


def _static_in_range(from_date: str, to_date: str) -> List[dict]:
    return [
        e for e in _STATIC_EVENTS
        if from_date <= e["date"] <= to_date
    ]


def _merge(
    finnhub_eco: List[dict],
    finnhub_earn: List[dict],
    static: List[dict],
    dividends: List[dict],
) -> List[dict]:
    """
    Merge four lists, dedup static vs Finnhub on (date, title).
    Finnhub events take priority; static fills gaps.
    Dividends are appended separately (no dedup needed — different type).
    """
    all_events: List[dict] = list(finnhub_eco) + list(finnhub_earn)

    # Build set of (date, normalised_title) already covered by Finnhub
    covered = {
        (e["date"], e["title"].lower().strip()[:20])
        for e in finnhub_eco
    }

    for s in static:
        key = (s["date"], s["title"].lower().strip()[:20])
        if key not in covered:
            all_events.append(s)

    # Add dividends (unique type, no overlap possible)
    all_events.extend(dividends)

    all_events.sort(key=lambda x: (x["date"], x.get("time") or "00:00"))
    return all_events


# ─────────────────────────────────────────────────────────────────────────────
# Dividend calendar
# Major S&P 500 dividend payers — ex-dividend dates via yfinance
# ─────────────────────────────────────────────────────────────────────────────

_DIVIDEND_TICKERS = [
    # Technology
    "AAPL", "MSFT",
    # Financials
    "JPM", "BAC", "WFC", "GS",
    # Healthcare
    "JNJ", "ABBV", "PFE", "MRK",
    # Consumer Staples
    "PG", "KO", "PEP", "WMT", "CL",
    # Consumer Discretionary
    "MCD", "HD",
    # Energy
    "XOM", "CVX",
    # Communication
    "VZ", "T",
    # Industrials
    "MMM", "CAT", "HON",
    # REIT (monthly payers)
    "O",
]

# Simple TTL cache: {data: [...], expires: float}
_div_cache: dict[str, Any] = {"data": [], "expires": 0.0}
_DIV_CACHE_TTL = 43_200  # 12 hours


def _fetch_one_dividend(ticker_sym: str) -> dict | None:
    """Fetch ex-dividend date for a single ticker. Returns None on failure."""
    try:
        import yfinance as yf
        info = yf.Ticker(ticker_sym).info or {}

        ex_ts = info.get("exDividendDate")
        if not ex_ts:
            return None

        ex_date = datetime.utcfromtimestamp(int(ex_ts)).date()

        # Skip if ex-date is in the past (yfinance sometimes returns stale data)
        if ex_date < date.today():
            return None

        # Dividend amount: prefer lastDividendValue, fall back to dividendRate/4
        div_val: float | None = info.get("lastDividendValue")
        if not div_val:
            annual = info.get("dividendRate") or 0.0
            div_val = float(annual) / 4 if annual else None

        amount_str = f"${div_val:.4f}" if div_val else None

        return {
            "date":     ex_date.isoformat(),
            "time":     "—",
            "type":     "dividend",
            "country":  "US",
            "flag":     "🇺🇸",
            "title":    f"{ticker_sym} Ex-Dividend",
            "impact":   "low",
            "previous": None,
            "estimate": amount_str,
            "actual":   None,
            "ticker":   ticker_sym,
        }
    except Exception:
        return None


def _load_all_dividends() -> List[dict]:
    """Parallel-fetch ex-dividend dates for the full universe."""
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_fetch_one_dividend, _DIVIDEND_TICKERS))
    return [r for r in results if r is not None]


def _get_cached_dividends(from_date: str, to_date: str) -> List[dict]:
    """Return dividend events, refreshing cache if expired (TTL 12 h)."""
    now = time.time()
    if now > _div_cache["expires"] or not _div_cache["data"]:
        _div_cache["data"]    = _load_all_dividends()
        _div_cache["expires"] = now + _DIV_CACHE_TTL

    return [
        e for e in _div_cache["data"]
        if from_date <= e["date"] <= to_date
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.get("", summary="Economic, earnings & dividend calendar")
async def get_calendar(
    from_date: str = Query(
        default="",
        description="Start date YYYY-MM-DD (default: today)",
    ),
    to_date: str = Query(
        default="",
        description="End date YYYY-MM-DD (default: today + 14 days)",
    ),
) -> dict[str, Any]:
    """
    Returns a combined economic, earnings & dividend calendar.

    - **macro** events : FOMC / ECB / BOE / BOJ / SNB / RBA / BOC + Finnhub macro
    - **earnings** events : quarterly results via Finnhub
    - **dividend** events : upcoming ex-dividend dates (yfinance, cached 12 h)
    """
    today = date.today()
    fd = from_date.strip() or today.isoformat()
    td = to_date.strip()   or (today + timedelta(days=14)).isoformat()

    finnhub = get_finnhub_provider()

    # Run Finnhub + dividend fetch concurrently
    eco_task  = asyncio.create_task(finnhub.get_economic_calendar(fd, td))
    earn_task = asyncio.create_task(finnhub.get_earnings_calendar(fd, td))
    div_task  = asyncio.get_event_loop().run_in_executor(
        None, _get_cached_dividends, fd, td
    )

    eco_events, earn_events, div_events = await asyncio.gather(
        eco_task, earn_task, div_task
    )

    static = _static_in_range(fd, td)
    events = _merge(eco_events, earn_events, static, div_events)

    return {
        "from_date":        fd,
        "to_date":          td,
        "n_events":         len(events),
        "has_finnhub_key":  bool(finnhub._key),
        "has_dividends":    len(div_events) > 0,
        "events":           events,
    }
