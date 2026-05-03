"""
data_fetcher.py
---------------
Récupération de données historiques via Yahoo Finance et calcul
des statistiques fondamentales (log-rendements, volatilité annualisée).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import yfinance as yf

TRADING_DAYS = 252  # convention standard pour annualiser


def fetch_data(ticker: str, period: str = "2y") -> pd.DataFrame:
    """
    Télécharge les données historiques (OHLCV) d'un actif.

    Parameters
    ----------
    ticker : str
        Symbole boursier (ex. 'AAPL', 'MSFT', 'BTC-USD').
    period : str
        Période historique acceptée par yfinance
        ('1mo', '6mo', '1y', '2y', '5y', '10y', 'max').

    Returns
    -------
    pd.DataFrame
        Données OHLCV indexées par date, ajustées des dividendes/splits.

    Raises
    ------
    ValueError
        Si aucune donnée n'est trouvée pour le ticker fourni.
    """
    data = yf.download(
        ticker,
        period=period,
        progress=False,
        auto_adjust=True,
    )
    if data is None or data.empty:
        raise ValueError(f"Aucune donnée trouvée pour le ticker '{ticker}'.")

    # yfinance peut retourner un MultiIndex de colonnes pour un seul ticker
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    return data


def compute_log_returns(prices: pd.Series) -> pd.Series:
    """
    Calcule les log-rendements quotidiens : r_t = ln(P_t / P_{t-1}).

    Les log-rendements sont privilégiés car additifs dans le temps
    et compatibles avec l'hypothèse log-normale du modèle GBM.
    """
    return np.log(prices / prices.shift(1)).dropna()


def compute_statistics(
    log_returns: pd.Series, trading_days: int = TRADING_DAYS
) -> dict:
    """
    Calcule les statistiques annualisées à partir des log-rendements.

    Returns
    -------
    dict avec :
        mu_daily, sigma_daily   : moyenne et écart-type quotidiens
        mu_annual, sigma_annual : valeurs annualisées (drift et vol)
        skew, kurtosis          : moments d'ordre 3 et 4
    """
    mu_daily = float(log_returns.mean())
    sigma_daily = float(log_returns.std(ddof=1))

    return {
        "mu_daily": mu_daily,
        "sigma_daily": sigma_daily,
        "mu_annual": mu_daily * trading_days,
        "sigma_annual": sigma_daily * np.sqrt(trading_days),
        "skew": float(log_returns.skew()),
        "kurtosis": float(log_returns.kurtosis()),
        "n_obs": int(len(log_returns)),
    }


def get_asset_info(ticker: str, period: str = "2y") -> dict:
    """
    Pipeline complet : récupération + calcul des statistiques.

    Returns
    -------
    dict avec : ticker, prices (Series), log_returns, stats, last_price
    """
    df = fetch_data(ticker, period=period)
    prices = df["Close"]
    log_returns = compute_log_returns(prices)
    stats = compute_statistics(log_returns)

    return {
        "ticker": ticker.upper(),
        "prices": prices,
        "log_returns": log_returns,
        "stats": stats,
        "last_price": float(prices.iloc[-1]),
        "history": df,
    }
