"""
data_fetcher.py
---------------
Récupération et prétraitement des données historiques multi-actifs.
Retourne les rendements, la matrice de covariance et de corrélation
nécessaires à l'analyse de portefeuille.

Provider hierarchy:
  Primary:   Twelve Data /time_series — commercial-friendly, concurrent per ticker.
  Secondary: FMP /v3/historical-price-full — commercial OK, free tier.
  (yfinance removed — ToS forbids commercial use.)
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
import numpy as np
import pandas as pd

from services.instruments.twelvedata_provider import SYMBOL_MAP, PERIOD_TO_OUTPUTSIZE

TD_BASE      = "https://api.twelvedata.com"
TRADING_DAYS = 252


# ─────────────────────────────────────────────────────────────────────────────
# Twelve Data fetch (one ticker, synchronous)
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

    dates  = [v["datetime"][:10] for v in values]          # "YYYY-MM-DD"
    closes = [float(v["close"])   for v in values]
    return pd.Series(closes, index=pd.to_datetime(dates), name=ticker)


# ─────────────────────────────────────────────────────────────────────────────
# FMP fetch (secondary — one ticker, synchronous)
# ─────────────────────────────────────────────────────────────────────────────

_FMP_BASE = "https://financialmodelingprep.com/api/v3"

_PERIOD_DAYS: dict[str, int] = {
    "1m": 31, "3m": 91, "6m": 182,
    "1y": 365, "2y": 730, "3y": 1095, "5y": 1825,
}


def _fmp_fetch_series(ticker: str, period: str, fmp_key: str) -> pd.Series:
    """Synchronous FMP /v3/historical-price-full → pd.Series of daily closes.

    Commercial use: allowed on all FMP plans including free tier.
    Returns adjClose when available, otherwise close.
    """
    from datetime import date, timedelta

    days      = _PERIOD_DAYS.get(period, 730)
    to_date   = date.today().isoformat()
    from_date = (date.today() - timedelta(days=days)).isoformat()

    resp = httpx.get(
        f"{_FMP_BASE}/historical-price-full/{ticker}",
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
    dates  = [h["date"][:10]                              for h in historical_asc]
    closes = [float(h.get("adjClose") or h["close"])      for h in historical_asc]
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
        Liste de symboles (Yahoo Finance format accepted: '^GSPC', 'BTC-USD'…).
    period : str
        Période historique ('1y', '2y', '5y'…).

    Returns
    -------
    dict :
        tickers        : ordre utilisé (cohérent dans toutes les matrices)
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

    # ── Primary: Twelve Data (concurrent — max 4 parallel) ───────────────────
    if api_key:
        outputsize  = PERIOD_TO_OUTPUTSIZE.get(period, 730)
        series_map: dict[str, pd.Series] = {}
        fetch_errors: list[str]          = []

        workers = min(4, len(tickers))   # stay within 8 req/min on free tier
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
            raise ValueError(
                f"Impossible de récupérer les données pour : {missing}. "
                f"Erreurs Twelve Data : {fetch_errors}"
            )

        # Align tickers on common date index
        closes = pd.DataFrame({t: series_map[t] for t in tickers})

    # ── Secondary: FMP (no TD key, or TD failed) ─────────────────────────────
    if closes is None:
        fmp_key = os.getenv("FMP_API_KEY", "")
        if not fmp_key:
            raise ValueError(
                "Aucune clé API disponible. "
                "Configurez TWELVE_DATA_API_KEY ou FMP_API_KEY."
            )

        fmp_series_map: dict[str, pd.Series] = {}
        fmp_errors: list[str] = []

        workers = min(4, len(tickers))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            fmp_futures = {
                pool.submit(_fmp_fetch_series, t, period, fmp_key): t
                for t in tickers
            }
            for fut in as_completed(fmp_futures):
                t = fmp_futures[fut]
                try:
                    fmp_series_map[t] = fut.result()
                except Exception as exc:
                    fmp_errors.append(f"{t}: {exc}")

        missing_fmp = [t for t in tickers if t not in fmp_series_map]
        if missing_fmp:
            raise ValueError(
                f"Impossible de récupérer les données pour : {missing_fmp}. "
                f"Erreurs FMP : {fmp_errors}"
            )

        closes = pd.DataFrame({t: fmp_series_map[t] for t in tickers})

    # ── Prétraitement commun ─────────────────────────────────────────────────
    closes = closes.ffill().dropna()

    if len(closes) < 30:
        raise ValueError(
            f"Données insuffisantes : seulement {len(closes)} observations communes"
        )

    # ── Log-rendements ────────────────────────────────────────────────────────
    log_ret = np.log(closes / closes.shift(1)).dropna()

    mean_r   = log_ret.mean().values.astype(float)   # (n,)
    cov      = log_ret.cov().values.astype(float)    # (n, n) — daily
    corr     = log_ret.corr().values.astype(float)   # (n, n)
    prices   = closes.iloc[-1].values.astype(float)

    # Annualised (for display)
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
