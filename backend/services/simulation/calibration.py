"""
calibration.py
--------------
Calibration des paramètres de simulation depuis les données historiques.

Primary:  Twelve Data REST API — commercial-friendly, no ToS issues.
Fallback: yfinance — used only when TWELVE_DATA_API_KEY is not set (local dev).

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
                "— falling back to yfinance"
            )

    # ── Fallback: yfinance (dev-only) ────────────────────────────────────────
    if closes is None:
        try:
            import yfinance as yf  # noqa: PLC0415 — optional fallback
            hist = yf.Ticker(ticker).history(period=period)
            if hist.empty:
                raise ValueError(
                    f"Aucune donnée trouvée pour '{ticker}'. "
                    "Vérifiez le symbole (ex. AAPL, BTC-USD, ^GSPC)."
                )
            closes = hist["Close"].dropna().values.astype(float)
        except Exception as yf_err:
            raise ValueError(
                f"Impossible de récupérer les données pour '{ticker}': {yf_err}"
            ) from yf_err

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
