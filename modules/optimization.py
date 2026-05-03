"""
optimization.py
---------------
Optimisation portefeuille : frontière efficiente Markowitz interactive.

Méthodologie :
    1. Calculer moyenne, variance, corrélation des rendements historiques.
    2. Résoudre le problème min (w.T @ Cov @ w) s.c. E[R_p] = r_target.
    3. Tracer la frontière (ensemble des allocations Pareto-optimales).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize


def efficient_frontier(
    mean_returns: np.ndarray,
    cov_matrix: np.ndarray,
    n_points: int = 50,
    allow_short: bool = False,
) -> dict:
    """
    Calcule la frontière efficiente (risque minimal pour chaque rendement cible).

    Parameters
    ----------
    mean_returns : np.ndarray
        Rendements moyens de chaque actif (annualisés).
    cov_matrix : np.ndarray
        Matrice de covariance (n_assets × n_assets).
    n_points : int
        Nombre de points sur la frontière.
    allow_short : bool
        Si False : contraintes poids >= 0 (long-only).

    Returns
    -------
    dict avec :
        - risks : vecteur des écarts-types du portefeuille
        - returns : vecteur des rendements du portefeuille
        - weights : allocations pour chaque point de la frontière
    """
    n_assets = len(mean_returns)

    # Portefeuille à variance minimale globale (GMV)
    cov_inv = np.linalg.inv(cov_matrix)
    ones = np.ones(n_assets)
    w_gmv = (cov_inv @ ones) / (ones @ cov_inv @ ones)
    r_gmv = w_gmv @ mean_returns
    var_gmv = w_gmv @ cov_matrix @ w_gmv
    std_gmv = np.sqrt(var_gmv)

    # Portefeuille à rendement maximal (long-only)
    if allow_short:
        idx_max_ret = np.argmax(mean_returns)
        r_max = mean_returns[idx_max_ret]
    else:
        r_max = np.max(mean_returns)

    # Points cibles entre GMV et max rendement
    target_returns = np.linspace(r_gmv, r_max, n_points)

    frontier_risks = []
    frontier_returns = []
    frontier_weights = []

    for r_target in target_returns:
        w_opt = _minimize_portfolio_variance(
            mean_returns, cov_matrix, r_target, allow_short
        )
        if w_opt is not None:
            port_var = w_opt @ cov_matrix @ w_opt
            port_std = np.sqrt(port_var)
            frontier_risks.append(port_std)
            frontier_returns.append(r_target)
            frontier_weights.append(w_opt)

    return {
        "risks": np.array(frontier_risks),
        "returns": np.array(frontier_returns),
        "weights": frontier_weights,
        "gmv_weight": w_gmv,
        "gmv_risk": std_gmv,
        "gmv_return": r_gmv,
    }


def _minimize_portfolio_variance(
    mean_returns: np.ndarray,
    cov_matrix: np.ndarray,
    target_return: float,
    allow_short: bool = False,
) -> np.ndarray | None:
    """
    Résout min w.T @ Cov @ w s.c. w.T @ mu = target_return, sum(w) = 1.
    """
    n_assets = len(mean_returns)

    def objective(w):
        return w @ cov_matrix @ w

    constraints = [
        {"type": "eq", "fun": lambda w: w.sum() - 1},  # sum(w) = 1
        {"type": "eq", "fun": lambda w: w @ mean_returns - target_return},  # E[R_p] = target
    ]

    if allow_short:
        bounds = None
    else:
        bounds = tuple((0, 1) for _ in range(n_assets))

    # Initialisation : portefeuille équipondéré
    w0 = np.ones(n_assets) / n_assets

    result = minimize(
        objective,
        w0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"ftol": 1e-9, "maxiter": 1000},
    )

    if result.success:
        return result.x
    else:
        return None


def sharpe_ratio(
    mean_returns: np.ndarray,
    cov_matrix: np.ndarray,
    risk_free_rate: float = 0.02,
    allow_short: bool = False,
) -> dict:
    """
    Calcule le portefeuille de Sharpe maximal.

    Parameters
    ----------
    risk_free_rate : float
        Taux sans risque annualisé (par défaut 2%).

    Returns
    -------
    dict avec poids optimaux et ratio de Sharpe.
    """
    n_assets = len(mean_returns)

    def neg_sharpe(w):
        port_ret = w @ mean_returns
        port_var = w @ cov_matrix @ w
        port_std = np.sqrt(port_var)
        sharpe = (port_ret - risk_free_rate) / port_std
        return -sharpe

    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1}]

    if allow_short:
        bounds = None
    else:
        bounds = tuple((0, 1) for _ in range(n_assets))

    w0 = np.ones(n_assets) / n_assets

    result = minimize(
        neg_sharpe,
        w0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": 1000},
    )

    if result.success:
        w_opt = result.x
        port_ret = w_opt @ mean_returns
        port_var = w_opt @ cov_matrix @ w_opt
        port_std = np.sqrt(port_var)
        sharpe_opt = (port_ret - risk_free_rate) / port_std

        return {
            "weights": w_opt,
            "return": port_ret,
            "risk": port_std,
            "sharpe_ratio": sharpe_opt,
        }
    else:
        return None


def portfolio_metrics(
    weights: np.ndarray,
    mean_returns: np.ndarray,
    cov_matrix: np.ndarray,
    risk_free_rate: float = 0.02,
) -> dict:
    """
    Calcule les métriques d'un portefeuille donné.
    """
    port_ret = weights @ mean_returns
    port_var = weights @ cov_matrix @ weights
    port_std = np.sqrt(port_var)
    sharpe = (port_ret - risk_free_rate) / port_std

    return {
        "return": port_ret,
        "risk": port_std,
        "sharpe_ratio": sharpe,
        "variance": port_var,
    }
