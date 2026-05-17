"""
api/calendar.py
---------------
GET /api/calendar?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD

Economic events + earnings calendar.

Sources
-------
Primary   : Finnhub /calendar/economic + /calendar/earnings (if FINNHUB_API_KEY set)
Supplement: Static FOMC / ECB / BOE / BOJ schedule — always shown
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta
from typing import Any, List

from fastapi import APIRouter, Query
from services.finnhub_provider import get_finnhub_provider

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

# ─────────────────────────────────────────────────────────────────────────────
# Static central-bank schedule (2025-2026)
# Dates sourced from Fed / ECB / BOE / BOJ published schedules.
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
) -> List[dict]:
    """
    Merge three lists, dedup static vs Finnhub on (date, title).
    Finnhub events take priority; static fills gaps.
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

    all_events.sort(key=lambda x: (x["date"], x["time"] or "00:00"))
    return all_events


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.get("", summary="Economic & earnings calendar")
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
    Returns a combined economic & earnings calendar for the given date range.

    - **macro** events: central bank decisions, inflation, GDP, NFP, …
    - **earnings** events: quarterly results (EPS estimates)

    Static FOMC / ECB / BOE / BOJ schedule is always included.
    Finnhub data enriches it when `FINNHUB_API_KEY` is set.
    """
    today = date.today()

    fd = from_date.strip() or today.isoformat()
    td = to_date.strip()   or (today + timedelta(days=14)).isoformat()

    finnhub = get_finnhub_provider()

    eco_task  = asyncio.create_task(finnhub.get_economic_calendar(fd, td))
    earn_task = asyncio.create_task(finnhub.get_earnings_calendar(fd, td))

    eco_events  = await eco_task
    earn_events = await earn_task

    static = _static_in_range(fd, td)
    events = _merge(eco_events, earn_events, static)

    has_key = bool(finnhub._key)

    return {
        "from_date":       fd,
        "to_date":         td,
        "n_events":        len(events),
        "has_finnhub_key": has_key,
        "events":          events,
    }
