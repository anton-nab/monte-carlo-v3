"""
risk_metrics.py
---------------
Mesures de risque calculées sur les trajectoires Monte Carlo.

Définitions :
    VaR (Value at Risk) : perte maximale attendue à un seuil de confiance
        donné (ex. 95% : on ne devrait perdre plus que VaR que dans 5% des cas).
    Expected Shortfall (CVaR) : perte moyenne dans les α% pires cas.
    Probability of Loss : probabilité que le prix final < prix initial.
    Max Drawdown : plus forte baisse pic-creux observée sur une trajectoire.
"""

from __future__ import annotations

import numpy as np


def value_at_risk(returns: np.ndarray, alpha: float = 0.05) -> float:
    """
    VaR historique (méthode des percentiles).

    Returns
    -------
    float
        VaR exprimée comme un rendement (négatif si perte).
        Ex : -0.12 signifie 12% de perte au seuil α.
    """
    return float(np.percentile(returns, alpha * 100))


def expected_shortfall(returns: np.ndarray, alpha: float = 0.05) -> float:
    """
    Expected Shortfall (Conditional VaR) : moyenne des rendements
    inférieurs ou égaux au seuil VaR.
    """
    var = value_at_risk(returns, alpha)
    tail = returns[returns <= var]
    if len(tail) == 0:
        return var
    return float(tail.mean())


def probability_of_loss(final_prices: np.ndarray, S0: float) -> float:
    """Probabilité que le prix final soit inférieur au prix initial."""
    return float(np.mean(final_prices < S0))


def max_drawdown_per_path(paths: np.ndarray) -> np.ndarray:
    """
    Calcule le max drawdown de chaque trajectoire (vectorisé).

    Drawdown = (prix_courant - max_atteint) / max_atteint

    Returns
    -------
    np.ndarray, shape (n_sims,)
        Max drawdown par trajectoire (valeur négative ou nulle).
    """
    running_max = np.maximum.accumulate(paths, axis=1)
    drawdowns = (paths - running_max) / running_max
    return drawdowns.min(axis=1)


def percentile_paths(
    paths: np.ndarray, percentiles: tuple = (5, 50, 95)
) -> dict:
    """
    Calcule les courbes de percentiles dans le temps.

    Returns
    -------
    dict {percentile: ndarray of shape (n_steps + 1,)}
    """
    return {p: np.percentile(paths, p, axis=0) for p in percentiles}


def compute_all_metrics(
    paths: np.ndarray, S0: float, alpha: float = 0.05
) -> dict:
    """
    Pipeline : calcule toutes les métriques de risque sur un jeu de trajectoires.

    Returns
    -------
    dict avec :
        - prix : expected, median, std, min, max
        - percentiles : p1, p5, p50, p95, p99
        - rendements : expected_return, return_std
        - risque : var_95, var_99, es_95, es_99, prob_loss
        - drawdown : avg_max_drawdown, worst_drawdown
        - probabilités directionnelles : prob_gain_10pct, prob_loss_10pct
    """
    final_prices = paths[:, -1]
    returns = (final_prices - S0) / S0
    drawdowns = max_drawdown_per_path(paths)

    return {
        # Prix finaux
        "expected_price": float(np.mean(final_prices)),
        "median_price": float(np.median(final_prices)),
        "std_price": float(np.std(final_prices)),
        "min_price": float(np.min(final_prices)),
        "max_price": float(np.max(final_prices)),
        # Percentiles
        "p1": float(np.percentile(final_prices, 1)),
        "p5": float(np.percentile(final_prices, 5)),
        "p50": float(np.percentile(final_prices, 50)),
        "p95": float(np.percentile(final_prices, 95)),
        "p99": float(np.percentile(final_prices, 99)),
        # Rendements
        "expected_return": float(returns.mean()),
        "return_std": float(returns.std()),
        # Risque
        "var_95": float(value_at_risk(returns, 0.05)),
        "var_99": float(value_at_risk(returns, 0.01)),
        "es_95": float(expected_shortfall(returns, 0.05)),
        "es_99": float(expected_shortfall(returns, 0.01)),
        "prob_loss": probability_of_loss(final_prices, S0),
        # Drawdown
        "avg_max_drawdown": float(drawdowns.mean()),
        "worst_drawdown": float(drawdowns.min()),
        "median_max_drawdown": float(np.median(drawdowns)),
        # Probabilités directionnelles
        "prob_gain_10pct": float(np.mean(returns > 0.10)),
        "prob_loss_10pct": float(np.mean(returns < -0.10)),
        "prob_gain_20pct": float(np.mean(returns > 0.20)),
        "prob_loss_20pct": float(np.mean(returns < -0.20)),
    }
