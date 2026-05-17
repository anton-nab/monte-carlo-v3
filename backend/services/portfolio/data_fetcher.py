"""
data_fetcher.py
---------------
Récupération et prétraitement des données historiques multi-actifs.
Retourne les rendements, la matrice de covariance et de corrélation
nécessaires à l'analyse de portefeuille.

Provider hierarchy (demo project — yfinance primary):
  Primary:   yfinance batch download — free, handles equities/ETFs/indices/crypto
  Secondary: Twelve Data /time_series — if yfinance fails and key available
  Tertiary:  Stooq — no key, global daily OHLCV
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
import numpy as np
import pandas as pd
import yfinance as yf

from services.instruments.twelvedata_provider import SYMBOL_MAP, PERIOD_TO_OUTPUTSIZE
from services import stooq_provider as stooq

TD_BASE      = "https://api.twelvedata.com"
TRADING_DAYS = 252


# ─────────────────────────────────────────────────────────────────────────────
# yfinance batch fetch (primary)
# ─────────────────────────────────────────────────────────────────────────────

def _yf_fetch_all(tickers: list[str], period: str) -> pd.DataFrame:
    """
    yfinance batch download → DataFrame of adjusted close prices, tickers as columns.
    Uses a single HTTP session for all tickers — fast even for 10+ symbols.
    """
    # Pass list for multi-ticker (produces MultiIndex), single string for one ticker
    symbols = tickers if len(tickers) > 1 else tickers[0]
    raw = yf.download(
        symbols,
        period=period,
        auto_adjust=True,
        progress=False,
        threads=True,
    )

    if raw is None or raw.empty:
        raise ValueError(f"yfinance returned no data for {tickers}")

    if isinstance(raw.columns, pd.MultiIndex):
        # Multi-ticker: columns are (metric, ticker) — pick "Close"
        closes = raw["Close"].copy()
        if isinstance(closes, pd.Series):
            # Edge case: single ticker passed as list
            closes = closes.to_frame(name=tickers[0])
    else:
        # Single ticker (string passed): flat columns [Open, High, Low, Close, Volume]
        closes = raw[["Close"]].copy()
        closes.columns = [tickers[0]]

    # Validate all tickers are present
    missing = [t for t in tickers if t not in closes.columns]
    if missing:
        raise ValueError(f"yfinance returned no data for: {missing}")

    return closes


# ─────────────────────────────────────────────────────────────────────────────
# Twelve Data fetch (secondary — one ticker, synchronous)
# ─────────────────────────────────────────────────────────────────────────────

def _td_fetch_series(ticker: str, outputsize: int, api_key: str) -> pd.Series:
    """
    Synchronous Twelve Data /time_series for one ticker.
    Returns a pd.Series of daily close prices indexed by date (ASC order).
    """
    symbol = SYMBOL_MAP.get(ticker, ticker)

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
        raise ValueError(f"Twelve Data error for {ticker}: {data.get('message', 'unknown')}")

    values = data.get("values", [])
    if not values:
        raise ValueError(f"Twelve Data returned no data for '{ticker}'")

    dates  = [v["datetime"][:10] for v in values]
    closes = [float(v["close"])   for v in values]
    return pd.Series(closes, index=pd.to_datetime(dates), name=ticker)


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def fetch_portfolio_data(tickers: list[str], period: str = "2y") -> dict:
    """
    Télécharge les clôtures ajustées pour plusieurs tickers et calcule
    les statistiques de portefeuille.

    Parameters
    ----------
    tickers : list[str]
        Liste de symboles (ex. 'AAPL', 'BTC-USD', '^GSPC'…).
    period : str
        Période historique ('1y', '2y', '5y'…).

    Returns
    -------
    dict :
        tickers        : ordre utilisé
        current_prices : dernier prix de clôture par actif
        mean_returns   : rendement log moyen JOURNALIER (vecteur)
        cov_matrix     : matrice de covariance JOURNALIÈRE (n × n)
        corr_matrix    : matrice de corrélation (n × n)
        ann_returns    : rendement annualisé (× 252)
        ann_vols       : volatilité annualisée (× √252)
        n_obs          : nombre de jours d'historique commun
        period

    Raises
    ------
    ValueError : ticker invalide, données insuffisantes, matrice singulière.
    """
    if len(tickers) < 1:
        raise ValueError("Au moins 1 ticker requis")

    api_key = os.getenv("TWELVE_DATA_API_KEY", "")
    closes: pd.DataFrame | None = None

    # ── Primary: yfinance (batch) ────────────────────────────────────────────
    try:
        closes = _yf_fetch_all(tickers, period)
    except Exception as yf_err:
        print(f"[data_fetcher] yfinance failed: {yf_err} — trying Twelve Data")

    # ── Secondary: Twelve Data (concurrent — max 4 parallel) ─────────────────
    if closes is None and api_key:
        outputsize  = PERIOD_TO_OUTPUTSIZE.get(period, 730)
        series_map: dict[str, pd.Series] = {}
        fetch_errors: list[str]          = []

        workers = min(4, len(tickers))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_td_fetch_series, t, outputsize, api_key): t
                for t in tickers
            }
            for fut in as_completed(futures):
                t = futures[fut]
                try:
                    series_map[t] = fut.result()
                except Exception as exc:
                    fetch_errors.append(f"{t}: {exc}")

        missing = [t for t in tickers if t not in series_map]
        if missing:
            print(
                f"[data_fetcher] TD missing: {missing} errors: {fetch_errors} "
                "— trying Stooq"
            )
        else:
            closes = pd.DataFrame({t: series_map[t] for t in tickers})

    # ── Tertiary: Stooq (concurrent) ─────────────────────────────────────────
    if closes is None:
        stooq_map: dict[str, pd.Series] = {}
        stooq_errors: list[str] = []

        workers = min(4, len(tickers))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            stooq_futures = {
                pool.submit(stooq.fetch_series, t, period): t
                for t in tickers
            }
            for fut in as_completed(stooq_futures):
                t = stooq_futures[fut]
                try:
                    stooq_map[t] = fut.result()
                except Exception as exc:
                    stooq_errors.append(f"{t}: {exc}")

        missing_stooq = [t for t in tickers if t not in stooq_map]
        if missing_stooq:
            raise ValueError(
                f"Impossible de récupérer les données pour : {missing_stooq}. "
                f"Erreurs Stooq : {stooq_errors}"
            )

        closes = pd.DataFrame({t: stooq_map[t] for t in tickers})

    # ── Prétraitement commun ─────────────────────────────────────────────────
    closes = closes.ffill().dropna()

    if len(closes) < 30:
        raise ValueError(
            f"Données insuffisantes : seulement {len(closes)} observations communes"
        )

    # ── Log-rendements ────────────────────────────────────────────────────────
    log_ret = np.log(closes / closes.shift(1)).dropna()

    mean_r   = log_ret.mean().values.astype(float)
    cov      = log_ret.cov().values.astype(float)
    corr     = log_ret.corr().values.astype(float)
    prices   = closes.iloc[-1].values.astype(float)

    ann_ret  = mean_r * TRADING_DAYS
    ann_vols = np.sqrt(np.diag(cov) * TRADING_DAYS)

    return {
        "tickers":         list(closes.columns),
        "current_prices":  [round(float(p), 4) for p in prices],
        "mean_returns":    mean_r.tolist(),
        "cov_matrix":      cov.tolist(),
        "corr_matrix":     corr.tolist(),
        "ann_returns":     ann_ret.tolist(),
        "ann_vols":        ann_vols.tolist(),
        "n_obs":           int(len(log_ret)),
        "period":          period,
    }
