"""
data_fetcher.py
---------------
Récupération et prétraitement des données historiques multi-actifs.
Retourne les rendements, la matrice de covariance et de corrélation
nécessaires à l'analyse de portefeuille.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import yfinance as yf

TRADING_DAYS = 252


def fetch_portfolio_data(tickers: list[str], period: str = "2y") -> dict:
    """
    Télécharge les clôtures ajustées pour plusieurs tickers et calcule
    les statistiques de portefeuille.

    Parameters
    ----------
    tickers : list[str]
        Liste de symboles Yahoo Finance.
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

    # ── Téléchargement ──────────────────────────────────────────────────────
    raw = yf.download(
        tickers,
        period=period,
        auto_adjust=True,
        progress=False,
        threads=True,
    )

    if raw.empty:
        raise ValueError(f"Aucune donnée récupérée pour : {tickers}")

    # ── Extraction des clôtures ─────────────────────────────────────────────
    if isinstance(raw.columns, pd.MultiIndex):
        level0 = raw.columns.get_level_values(0).unique().tolist()
        price_col = next((c for c in ("Close", "Adj Close") if c in level0), None)
        if price_col is None:
            raise ValueError("Colonne 'Close' introuvable dans les données")
        closes = raw[price_col]
        if isinstance(closes, pd.Series):
            closes = closes.to_frame(name=tickers[0])
        # Réordonner selon l'ordre demandé ; ignorer les colonnes absentes
        available = [t for t in tickers if t in closes.columns]
        missing   = [t for t in tickers if t not in closes.columns]
        if missing:
            raise ValueError(f"Aucune donnée pour : {missing}")
        closes = closes[available]
    else:
        # Colonne plate (rare avec yfinance >= 0.2)
        price_col = next((c for c in ("Close", "Adj Close") if c in raw.columns), None)
        if price_col is None:
            raise ValueError("Format de données non reconnu")
        closes = raw[[price_col]].rename(columns={price_col: tickers[0]})

    closes = closes.ffill().dropna()

    if len(closes) < 30:
        raise ValueError(
            f"Données insuffisantes : seulement {len(closes)} observations communes"
        )

    # ── Log-rendements ──────────────────────────────────────────────────────
    log_ret = np.log(closes / closes.shift(1)).dropna()

    mean_r = log_ret.mean().values.astype(float)   # (n,)
    cov    = log_ret.cov().values.astype(float)    # (n, n) — JOURNALIER
    corr   = log_ret.corr().values.astype(float)   # (n, n)
    prices = closes.iloc[-1].values.astype(float)

    # Annualisés (pour info / affichage)
    ann_ret  = mean_r * TRADING_DAYS
    ann_vols = np.sqrt(np.diag(cov) * TRADING_DAYS)

    return {
        "tickers":         list(closes.columns),      # ordre effectif
        "current_prices":  [round(float(p), 4) for p in prices],
        "mean_returns":    mean_r.tolist(),            # daily
        "cov_matrix":      cov.tolist(),               # daily
        "corr_matrix":     corr.tolist(),
        "ann_returns":     ann_ret.tolist(),
        "ann_vols":        ann_vols.tolist(),
        "n_obs":           int(len(log_ret)),
        "period":          period,
    }
