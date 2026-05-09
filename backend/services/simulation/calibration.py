"""
calibration.py
--------------
Calibration des paramètres de simulation depuis les données historiques.

Utilise yfinance pour récupérer les prix de clôture, puis calcule :
    mu    : drift annualisé (moyenne des log-rendements × 252)
    sigma : volatilité annualisée (std des log-rendements × sqrt(252))
    S0    : dernier prix de clôture
"""

from __future__ import annotations

import numpy as np
import yfinance as yf

TRADING_DAYS = 252


def calibrate_ticker(ticker: str, period: str = "2y") -> dict:
    """
    Récupère l'historique de `ticker` et calcule les paramètres de simulation.

    Parameters
    ----------
    ticker : str
        Symbole Yahoo Finance (ex. 'AAPL', 'BTC-USD', '^GSPC').
    period : str
        Période historique pour la calibration ('1y', '2y', '5y'…).

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
    ValueError : si ticker invalide ou données insuffisantes.
    """
    ticker = ticker.upper().strip()

    hist = yf.Ticker(ticker).history(period=period)
    if hist.empty:
        raise ValueError(
            f"Aucune donnée trouvée pour '{ticker}'. "
            "Vérifiez le symbole (ex. AAPL, BTC-USD, ^GSPC)."
        )

    closes = hist["Close"].dropna().values.astype(float)
    if len(closes) < 30:
        raise ValueError(
            f"Données insuffisantes pour '{ticker}' : seulement {len(closes)} observations."
        )

    log_returns = np.diff(np.log(closes))

    mu = float(log_returns.mean() * TRADING_DAYS)
    sigma = float(log_returns.std() * np.sqrt(TRADING_DAYS))
    S0 = float(closes[-1])

    # Sécurité : sigma doit être > 0
    if sigma < 0.001:
        sigma = 0.001

    return {
        "S0": round(S0, 4),
        "mu": round(mu, 6),
        "sigma": round(sigma, 6),
        "log_returns": log_returns.tolist(),
        "n_obs": int(len(log_returns)),
        "period": period,
    }
