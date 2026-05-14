"""
calibration.py
--------------
Calibration des paramètres de simulation depuis les données historiques.

Provider hierarchy:
  Primary:   Twelve Data /time_series — commercial-friendly, async-compatible.
  Secondary: FMP /v3/historical-price-full — commercial OK, free tier.
  (yfinance removed — ToS forbids commercial use.)

Calcule :
    mu    : drift annualisé (moyenne des log-rendements × 252)
    sigma : volatilité annualisée (std des log-rendements × sqrt(252))
    S0    : dernier prix de clôture
"""

from __future__ import annotations

import os

import httpx
import numpy as np

from services.instruments.twelvedata_provider import SYMBOL_MAP, PERIOD_TO_OUTPUTSIZE

TD_BASE      = "https://api.twelvedata.com"
TRADING_DAYS = 252


# ─────────────────────────────────────────────────────────────────────────────
# Twelve Data fetch
# ─────────────────────────────────────────────────────────────────────────────

def _td_fetch_closes(ticker: str, period: str, api_key: str) -> np.ndarray:
    """Synchronous Twelve Data /time_series → close prices array (ASC order)."""
    symbol     = SYMBOL_MAP.get(ticker, ticker)
    outputsize = PERIOD_TO_OUTPUTSIZE.get(period, 730)

    resp = httpx.get(
        f"{TD_BASE}/time_series",
        params={
            "symbol":     symbol,
            "interval":   "1day",
            "outputsize": outputsize,
            "order":      "ASC",
            "dp":         4,
            "apikey":     api_key,
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()

    if isinstance(data, dict) and data.get("status") == "error":
        raise ValueError(f"Twelve Data error: {data.get('message', 'unknown')}")

    values = data.get("values", [])
    if not values:
        raise ValueError(f"Twelve Data returned no data for '{ticker}'")

    return np.array([float(v["close"]) for v in values])


# ─────────────────────────────────────────────────────────────────────────────
# FMP fetch (secondary — when no TD key or TD fails)
# ─────────────────────────────────────────────────────────────────────────────

def _fmp_fetch_closes(ticker: str, period: str) -> np.ndarray:
    """Synchronous FMP /v3/historical-price-full → close prices array (ASC order).

    Commercial use: allowed on all FMP plans including free tier.
    Returns adjClose when available, otherwise close.
    """
    from datetime import date, timedelta

    fmp_key = os.getenv("FMP_API_KEY", "")
    if not fmp_key:
        raise ValueError("FMP_API_KEY not configured")

    _PERIOD_DAYS: dict[str, int] = {
        "1m": 31, "3m": 91, "6m": 182,
        "1y": 365, "2y": 730, "3y": 1095, "5y": 1825,
    }
    days      = _PERIOD_DAYS.get(period, 730)
    to_date   = date.today().isoformat()
    from_date = (date.today() - timedelta(days=days)).isoformat()

    resp = httpx.get(
        f"https://financialmodelingprep.com/api/v3/historical-price-full/{ticker}",
        params={"apikey": fmp_key, "from": from_date, "to": to_date},
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()

    historical = data.get("historical", [])
    if not historical:
        raise ValueError(f"FMP returned no data for '{ticker}'")

    # FMP returns DESC order (newest first) — reverse to ASC
    historical_asc = list(reversed(historical))
    closes = [float(h.get("adjClose") or h["close"]) for h in historical_asc]
    return np.array(closes)


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def calibrate_ticker(ticker: str, period: str = "2y") -> dict:
    """
    Récupère l'historique de `ticker` et calcule les paramètres de simulation.

    Parameters
    ----------
    ticker : str
        Symbole (ex. 'AAPL', 'BTC-USD', '^GSPC').
    period : str
        Période historique ('1y', '2y', '5y'…).

    Returns
    -------
    dict :
        S0           : float  — dernier prix de clôture
        mu           : float  — drift annualisé
        sigma        : float  — volatilité annualisée
        log_returns  : list   — rendements log quotidiens (pour GARCH)
        n_obs        : int    — nombre d'observations
        period       : str

    Raises
    ------
    ValueError : ticker invalide ou données insuffisantes.
    """
    ticker  = ticker.upper().strip()
    api_key = os.getenv("TWELVE_DATA_API_KEY", "")

    # ── Primary: Twelve Data ─────────────────────────────────────────────────
    closes: np.ndarray | None = None
    if api_key:
        try:
            closes = _td_fetch_closes(ticker, period, api_key)
        except Exception as td_err:
            print(
                f"[calibration] TD failed for {ticker}: {td_err} "
                "— falling back to FMP"
            )

    # ── Secondary: FMP (no TD key, or TD failed) ─────────────────────────────
    if closes is None:
        try:
            closes = _fmp_fetch_closes(ticker, period)
        except Exception as fmp_err:
            raise ValueError(
                f"Impossible de récupérer les données pour '{ticker}': {fmp_err}"
            ) from fmp_err

    if len(closes) < 30:
        raise ValueError(
            f"Données insuffisantes pour '{ticker}' : "
            f"seulement {len(closes)} observations."
        )

    log_returns = np.diff(np.log(closes))

    mu    = float(log_returns.mean() * TRADING_DAYS)
    sigma = float(log_returns.std()  * np.sqrt(TRADING_DAYS))
    S0    = float(closes[-1])

    # Safety floor: sigma must be > 0
    if sigma < 0.001:
        sigma = 0.001

    return {
        "S0":          round(S0, 4),
        "mu":          round(mu, 6),
        "sigma":       round(sigma, 6),
        "log_returns": log_returns.tolist(),
        "n_obs":       int(len(log_returns)),
        "period":      period,
    }
