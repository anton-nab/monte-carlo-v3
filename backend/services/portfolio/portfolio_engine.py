"""
portfolio_engine.py
-------------------
Moteur d'analyse de portefeuille (théorie moderne — Markowitz).

Fonctions principales :
    compute_portfolio_stats()      — rendement, vol, Sharpe pour des poids donnés
    generate_random_portfolios()   — nuage de portefeuilles aléatoires
    find_optimal_sharpe()          — maximisation du ratio de Sharpe
    find_min_volatility()          — minimisation de la variance
    simulate_portfolio_paths()     — Monte Carlo corrélé (Cholesky)
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import minimize

TRADING_DAYS = 252


# ═════════════════════════════════════════════════════════════════════════════
# 1.  STATISTIQUES DE PORTEFEUILLE
# ═════════════════════════════════════════════════════════════════════════════

def compute_portfolio_stats(
    weights: np.ndarray,
    mean_returns: np.ndarray,    # journalier
    cov_matrix: np.ndarray,      # journalier
    risk_free_rate: float = 0.05,
) -> tuple[float, float, float]:
    """
    Calcule (rendement annualisé, volatilité annualisée, Sharpe).

    Parameters
    ----------
    weights       : poids du portefeuille (somme = 1)
    mean_returns  : vecteur des rendements log moyens journaliers
    cov_matrix    : matrice de covariance journalière
    risk_free_rate: taux sans risque annualisé
    """
    w = np.asarray(weights, dtype=float)
    ann_ret = float(np.dot(w, mean_returns) * TRADING_DAYS)
    ann_vol = float(np.sqrt(np.dot(w.T, np.dot(cov_matrix * TRADING_DAYS, w))))
    sharpe  = (ann_ret - risk_free_rate) / ann_vol if ann_vol > 1e-8 else 0.0
    return ann_ret, ann_vol, sharpe


# ═════════════════════════════════════════════════════════════════════════════
# 2.  FRONTIÈRE EFFICIENTE
# ═════════════════════════════════════════════════════════════════════════════

def generate_random_portfolios(
    mean_returns: np.ndarray,
    cov_matrix: np.ndarray,
    n_portfolios: int = 600,
    risk_free_rate: float = 0.05,
) -> list[dict]:
    """
    Génère n_portfolios portefeuilles aléatoires (poids Dirichlet)
    pour visualiser le nuage rendement/risque.
    """
    n = len(mean_returns)
    results = []
    for _ in range(n_portfolios):
        w   = np.random.dirichlet(np.ones(n))
        ret, vol, sharpe = compute_portfolio_stats(
            w, mean_returns, cov_matrix, risk_free_rate
        )
        results.append({
            "return":     round(float(ret), 6),
            "volatility": round(float(vol), 6),
            "sharpe":     round(float(sharpe), 4),
        })
    return results


def find_optimal_sharpe(
    tickers: list[str],
    mean_returns: np.ndarray,
    cov_matrix: np.ndarray,
    risk_free_rate: float = 0.05,
) -> dict:
    """Portefeuille à ratio de Sharpe maximal."""
    n = len(mean_returns)

    def neg_sharpe(w: np.ndarray) -> float:
        ret, vol, _ = compute_portfolio_stats(w, mean_returns, cov_matrix, risk_free_rate)
        return -(ret - risk_free_rate) / vol if vol > 1e-8 else 1e10

    res = minimize(
        neg_sharpe,
        np.ones(n) / n,
        method="SLSQP",
        bounds=[(0.0, 1.0)] * n,
        constraints=[{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}],
        options={"ftol": 1e-9, "maxiter": 1000},
    )
    w = np.maximum(res.x, 0.0)
    w /= w.sum()
    ret, vol, sharpe = compute_portfolio_stats(w, mean_returns, cov_matrix, risk_free_rate)
    return {
        "weights":    {t: round(float(wi), 4) for t, wi in zip(tickers, w)},
        "return":     round(float(ret), 6),
        "volatility": round(float(vol), 6),
        "sharpe":     round(float(sharpe), 4),
    }


def find_min_volatility(
    tickers: list[str],
    mean_returns: np.ndarray,
    cov_matrix: np.ndarray,
    risk_free_rate: float = 0.05,
) -> dict:
    """Portefeuille à variance minimale."""
    n = len(mean_returns)

    def portfolio_vol(w: np.ndarray) -> float:
        _, vol, _ = compute_portfolio_stats(w, mean_returns, cov_matrix)
        return vol

    res = minimize(
        portfolio_vol,
        np.ones(n) / n,
        method="SLSQP",
        bounds=[(0.0, 1.0)] * n,
        constraints=[{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}],
        options={"ftol": 1e-9, "maxiter": 1000},
    )
    w = np.maximum(res.x, 0.0)
    w /= w.sum()
    ret, vol, sharpe = compute_portfolio_stats(w, mean_returns, cov_matrix, risk_free_rate)
    return {
        "weights":    {t: round(float(wi), 4) for t, wi in zip(tickers, w)},
        "return":     round(float(ret), 6),
        "volatility": round(float(vol), 6),
        "sharpe":     round(float(sharpe), 4),
    }


# ═════════════════════════════════════════════════════════════════════════════
# 3.  MONTE CARLO CORRÉLÉ (Cholesky)
# ═════════════════════════════════════════════════════════════════════════════

def simulate_portfolio_paths(
    weights: list[float],
    mean_returns: np.ndarray,    # journalier
    cov_matrix: np.ndarray,      # journalier
    S0: float,
    horizon_days: int,
    n_sims: int,
) -> np.ndarray:
    """
    Monte Carlo corrélé via décomposition de Cholesky.

    Chaque actif suit un GBM ; les chocs sont corrélés selon la matrice
    de covariance historique. La valeur du portefeuille est la somme
    pondérée des valeurs relatives des actifs.

    Parameters
    ----------
    weights      : poids (somme = 1)
    mean_returns : rendements log moyens journaliers (n_assets,)
    cov_matrix   : matrice de covariance journalière (n_assets, n_assets)
    S0           : valeur initiale du portefeuille
    horizon_days : horizon en jours de bourse
    n_sims       : nombre de trajectoires

    Returns
    -------
    np.ndarray (n_sims, horizon_days + 1)
    """
    w        = np.asarray(weights, dtype=float)
    n_assets = len(w)

    # ── Cholesky de la cov journalière ─────────────────────────────────────
    cov = np.asarray(cov_matrix, dtype=float)
    # Régularisation pour éviter une matrice non-définie positive
    cov_reg = cov + 1e-8 * np.eye(n_assets)
    try:
        chol = np.linalg.cholesky(cov_reg)
    except np.linalg.LinAlgError:
        # Projection sur le cône semi-défini positif
        eigvals, eigvecs = np.linalg.eigh(cov_reg)
        eigvals = np.maximum(eigvals, 1e-8)
        cov_reg = eigvecs @ np.diag(eigvals) @ eigvecs.T
        chol = np.linalg.cholesky(cov_reg)

    # mean_returns et cov_matrix sont JOURNALIERS — pas de facteur dt.
    # Z @ chol.T donne directement des chocs corrélés avec la bonne covariance :
    # Var(Z @ chol.T)_i = cov[i,i]  — PAS de double-scaling avec daily_vols.
    drift = mean_returns - 0.5 * np.diag(cov_reg)       # (n_assets,)  journalier

    # ── Simulation ─────────────────────────────────────────────────────────
    # log_prices[i, j] = log(prix relatif actif j, simulation i) — part de 0
    log_prices = np.zeros((n_sims, n_assets))

    paths = np.zeros((n_sims, horizon_days + 1))
    paths[:, 0] = S0

    for step in range(horizon_days):
        Z           = np.random.standard_normal((n_sims, n_assets))
        corr_shocks = Z @ chol.T                         # (n_sims, n_assets) — variance = cov[i,i]
        log_ret     = drift + corr_shocks                # un pas = 1 jour
        log_prices += log_ret

        # Valeur relative de chaque actif (normalisé à 1 en t=0)
        asset_prices = np.exp(log_prices)                         # (n_sims, n_assets)
        # Valeur du portefeuille = S0 × somme(w_i × prix_relatif_i)
        paths[:, step + 1] = S0 * (asset_prices * w).sum(axis=1)

    return paths
