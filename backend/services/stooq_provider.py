"""
services/stooq_provider.py
--------------------------
Stooq historical OHLCV data.

Free    : no API key required, no call limit.
Commercial : no explicit ToS restriction — widely used in academic / commercial contexts.
Data    : daily OHLCV, global coverage.
         US stocks (AAPL.US), major world indices (^SPX, ^NDQ …),
         European stocks (BMW.DE, BP.UK …), Forex, some ETFs.
NOT supported : crypto (BTC-USD, ETH-USD) — use TD for those.

HTTP endpoint: https://stooq.com/q/d/l/?s={symbol}&i=d&d1=YYYYMMDD&d2=YYYYMMDD
Response: CSV with columns Date, Open, High, Low, Close, Volume
"""

from __future__ import annotations

import io
from datetime import date, timedelta
from typing import Optional

import httpx
import numpy as np
import pandas as pd

STOOQ_BASE = "https://stooq.com/q/d/l/"

# User-Agent that Stooq accepts
_HEADERS = {"User-Agent": "Mozilla/5.0"}

# yfinance / TD index format → Stooq format
_INDEX_MAP: dict[str, str] = {
    "^GSPC":     "^SPX",   # S&P 500
    "^NDX":      "^NDQ",   # Nasdaq 100
    "^COMP":     "^NDQ",
    "^DJI":      "^DJI",   # Dow Jones Industrial
    "^VIX":      "^VIX",   # CBOE Volatility Index
    "^RUT":      "^RUT",   # Russell 2000
    "^FTSE":     "^FTM",   # FTSE 100
    "^N225":     "^NKX",   # Nikkei 225
    "^GDAXI":    "^DAX",   # DAX 40
    "^FCHI":     "^CAC",   # CAC 40
    "^STOXX50E": "^STX",   # Euro Stoxx 50
    "^HSI":      "^HSI",   # Hang Seng
    "^AXJO":     "^AX",    # ASX 200
    "^BVSP":     "^BVS",   # Bovespa
    "^TNX":      "10US.B", # US 10Y Treasury yield
}

# Approximate trading-day count per period string
_PERIOD_DAYS: dict[str, int] = {
    "1m": 31,   "3m": 92,   "6m": 184,
    "1y": 365,  "2y": 730,  "3y": 1096, "5y": 1826,
}

# Patterns that Stooq cannot serve
_UNSUPPORTED = ("-USD", "-EUR", "-GBP", "-JPY", "=X", "=F", "BTC", "ETH", "XRP")


def _to_stooq(ticker: str) -> str:
    """Convert yfinance / TD ticker format to Stooq symbol format."""
    # Known index mapping
    if ticker in _INDEX_MAP:
        return _INDEX_MAP[ticker]

    # Unsupported asset classes (crypto, forex, futures)
    t_upper = ticker.upper()
    for pat in _UNSUPPORTED:
        if pat in t_upper:
            raise ValueError(
                f"Stooq does not support '{ticker}' (crypto/forex/futures). "
                "Use Twelve Data for these asset classes."
            )

    # Already has an exchange suffix  (e.g. BMW.DE, BP.UK, 7203.JP)
    if "." in ticker and not ticker.startswith("^"):
        return ticker

    # US equities / ETFs — add .US suffix
    if not ticker.startswith("^"):
        return f"{ticker}.US"

    # Unknown index — pass as-is and let Stooq 404
    return ticker


def _fetch_csv(symbol: str, period: str) -> pd.DataFrame:
    """
    Synchronous HTTP fetch from Stooq.
    Returns a DataFrame (Date as index, Close column) in ASC order.
    Raises ValueError on no data / unsupported ticker.
    """
    days  = _PERIOD_DAYS.get(period, 730)
    d1    = (date.today() - timedelta(days=days)).strftime("%Y%m%d")
    d2    = date.today().strftime("%Y%m%d")

    with httpx.Client(headers=_HEADERS, timeout=20.0, follow_redirects=True) as client:
        resp = client.get(STOOQ_BASE, params={"s": symbol, "i": "d", "d1": d1, "d2": d2})
        resp.raise_for_status()
        text = resp.text

    if not text.strip() or text.strip().lower().startswith("no data") or len(text.splitlines()) < 3:
        raise ValueError(f"Stooq returned no data for symbol '{symbol}'")

    df = pd.read_csv(io.StringIO(text), parse_dates=["Date"])
    df = df.sort_values("Date").dropna(subset=["Close"])

    if df.empty:
        raise ValueError(f"Stooq: empty dataset for '{symbol}'")

    return df


def fetch_closes(ticker: str, period: str = "2y") -> np.ndarray:
    """
    Synchronous Stooq fetch → np.ndarray of close prices in ASC order.

    Raises ValueError if ticker is unsupported or Stooq returns no data.
    Called from calibration.py via run_in_executor (thread pool).
    """
    symbol = _to_stooq(ticker)
    df     = _fetch_csv(symbol, period)
    return df["Close"].values.astype(float)


def fetch_series(ticker: str, period: str = "2y") -> pd.Series:
    """
    Synchronous Stooq fetch → pd.Series of daily closes indexed by date (ASC).

    Called from data_fetcher.py via ThreadPoolExecutor.
    """
    symbol = _to_stooq(ticker)
    df     = _fetch_csv(symbol, period)
    return pd.Series(df["Close"].values.astype(float), index=df["Date"], name=ticker)
