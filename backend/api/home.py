"""
api/home.py
-----------
Données pour la page d'accueil (style MSN Finance / Bloomberg terminal).

Endpoints :
    GET /api/home/market   — ticker tape + indices + movers + news
    GET /api/home/tape     — ticker tape seul (léger, pour rafraîchissement fréquent)
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

import numpy as np
import yfinance as yf
from fastapi import APIRouter

router = APIRouter(prefix="/api/home", tags=["home"])

# ─────────────────────────────────────────────────────────────────────────────
# Univers de tickers
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

# Cache simple en mémoire (TTL 5 min)
_cache: dict = {"ts": 0.0, "data": None}
_CACHE_TTL = 300  # secondes


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return None if (f != f) else round(f, 4)   # NaN → None
    except Exception:
        return None


def _fetch_tape(tickers: list[str]) -> list[dict]:
    """Récupère prix + variation journalière pour le ticker tape."""
    try:
        raw = yf.download(
            tickers, period="2d", auto_adjust=True,
            progress=False, threads=True,
        )
        if raw.empty:
            return []

        # Extraction Close
        if hasattr(raw.columns, "levels"):
            closes = raw["Close"]
        else:
            closes = raw[["Close"]].rename(columns={"Close": tickers[0]})

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
            if len(col) >= 2:
                prev = float(col.iloc[-2])
                chg_pct = round((float(col.iloc[-1]) - prev) / prev * 100, 2) if prev else 0.0
            else:
                chg_pct = 0.0
            result.append({
                "ticker":    sym,
                "label":     TAPE_LABELS.get(sym, sym),
                "price":     price,
                "change_pct": chg_pct,
            })
        return result
    except Exception:
        return []


def _fetch_movers(tickers: list[str]) -> tuple[list[dict], list[dict]]:
    """Top 5 gainers + top 5 losers from a universe."""
    try:
        raw = yf.download(
            tickers, period="2d", auto_adjust=True,
            progress=False, threads=True,
        )
        if raw.empty:
            return [], []

        if hasattr(raw.columns, "levels"):
            closes = raw["Close"]
        else:
            closes = raw[["Close"]].rename(columns={"Close": tickers[0]})

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
        gainers = rows[:5]
        losers  = rows[-5:][::-1]   # worst first
        return gainers, losers
    except Exception:
        return [], []


def _fetch_news(ticker: str = "^GSPC", max_items: int = 8) -> list[dict]:
    """Actualités financières via yfinance."""
    try:
        news_raw = yf.Ticker(ticker).news or []
        result = []
        for item in news_raw[:max_items]:
            # yfinance news structure varies by version
            title     = item.get("title") or item.get("content", {}).get("title", "")
            publisher = item.get("publisher") or item.get("content", {}).get("provider", {}).get("displayName", "")
            link      = item.get("link") or item.get("content", {}).get("canonicalUrl", {}).get("url", "#")
            ts        = item.get("providerPublishTime") or item.get("content", {}).get("pubDate", "")

            # Convertir le timestamp en string lisible
            if isinstance(ts, (int, float)) and ts > 0:
                ts_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%d %b, %H:%M")
            elif isinstance(ts, str) and ts:
                ts_str = ts[:16]  # garder "2025-05-10T14:30" → "2025-05-10T14:30"
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


def _build_market_data() -> dict:
    """Construit le payload complet (appelé une fois, mis en cache 5 min)."""
    tape         = _fetch_tape(TAPE_TICKERS)
    gainers, losers = _fetch_movers(MOVERS_UNIVERSE)
    news         = _fetch_news("^GSPC", max_items=9)

    # Indices clés pour la grille (sous-ensemble du tape)
    KEY_INDICES = ["^GSPC", "^NDX", "^DJI", "^VIX", "GC=F", "CL=F",
                   "BTC-USD", "EURUSD=X", "^TNX"]
    tape_map    = {t["ticker"]: t for t in tape}
    indices     = [tape_map[s] for s in KEY_INDICES if s in tape_map]

    return {
        "tape":     tape,
        "indices":  indices,
        "gainers":  gainers,
        "losers":   losers,
        "news":     news,
        "cached_at": datetime.now(tz=timezone.utc).isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/market", summary="Données page d'accueil (tape + indices + movers + news)")
async def get_market_data():
    """
    Retourne en une seule requête :
    - tape    : 16 symboles (prix + Δ%) pour la bande défilante
    - indices : grille des principaux indices
    - gainers : top 5 haussiers du jour
    - losers  : top 5 baissiers du jour
    - news    : dernières actualités financières
    Mis en cache 5 minutes côté serveur pour ne pas surcharger Yahoo Finance.
    """
    import asyncio
    global _cache
    now = time.time()

    if _cache["data"] is None or (now - _cache["ts"]) > _CACHE_TTL:
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _build_market_data)
        _cache = {"ts": now, "data": data}

    return _cache["data"]


@router.get("/tape", summary="Ticker tape seul (léger)")
async def get_tape():
    """Bande défilante uniquement — données fraîches si cache chaud, sinon reuse."""
    import asyncio
    global _cache
    now = time.time()

    if _cache["data"] is None or (now - _cache["ts"]) > _CACHE_TTL:
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _build_market_data)
        _cache = {"ts": now, "data": data}

    return {"tape": _cache["data"]["tape"], "cached_at": _cache["data"]["cached_at"]}
