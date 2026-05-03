"""
backtesting.py
---------------
Validation des simulations Monte Carlo sur fenêtres de temps passées.

Méthodologie :
    1. Diviser les données historiques en fenêtres (ex. 252 jours).
    2. Pour chaque fenêtre : calibrer μ, σ sur N jours passés.
    3. Simuler l'horizon suivant (ex. 20 jours).
    4. Comparer la distribution prédite au prix réalisé.
    5. Agréger les statistiques (calibration honnête du modèle).
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def rolling_window_backtesting(
    prices: pd.Series,
    lookback_days: int = 252,
    horizon_days: int = 20,
    n_sims: int = 1000,
    simulation_func=None,
    seed: int | None = None,
) -> dict:
    """
    Backtesting avec fenêtres roulantes.

    Parameters
    ----------
    prices : pd.Series
        Série de prix (indexée par date).
    lookback_days : int
        Nombre de jours passés pour calibrer μ, σ.
    horizon_days : int
        Horizon de simulation (jours à prédire).
    n_sims : int
        Nombre de simulations par fenêtre.
    simulation_func : callable
        Fonction simulation(S0, mu, sigma, horizon, n_sims, seed).
        Par défaut utilise GBM simple.

    Returns
    -------
    dict avec :
        - real_returns : rendements réalisés sur horizon
        - pred_percentiles : percentiles de la distribution prédite
        - pred_var_95, pred_es_95 : VaR et ES prédites
        - coverage_95 : couverture empirique de VaR 95%
    """
    if simulation_func is None:
        from .simulation import gbm_simulation
        simulation_func = gbm_simulation

    prices = prices.dropna()
    if len(prices) < lookback_days + horizon_days:
        raise ValueError("Historique trop court pour backtesting.")

    real_returns = []
    pred_var_95_list = []
    pred_es_95_list = []
    pred_probs_loss = []

    trading_days = 252
    n_windows = (len(prices) - lookback_days - horizon_days) // horizon_days

    for window_idx in range(n_windows):
        start_idx = window_idx * horizon_days
        end_idx = start_idx + lookback_days
        fut_idx = end_idx + horizon_days

        if fut_idx > len(prices):
            break

        # Fenêtre historique pour calibrage
        hist_prices = prices.iloc[start_idx:end_idx]
        log_returns = np.log(hist_prices / hist_prices.shift(1)).dropna()

        mu_daily = log_returns.mean()
        sigma_daily = log_returns.std(ddof=1)
        mu_annual = mu_daily * trading_days
        sigma_annual = sigma_daily * np.sqrt(trading_days)

        # Simulation
        S0 = prices.iloc[end_idx]
        paths = simulation_func(
            S0=S0,
            mu=mu_annual,
            sigma=sigma_annual,
            horizon_days=horizon_days,
            n_sims=n_sims,
            trading_days=trading_days,
            seed=seed + window_idx if seed else None,
        )

        # Rendement réalisé
        real_price = prices.iloc[fut_idx]
        real_return = (real_price - S0) / S0
        real_returns.append(real_return)

        # Métriques prédites
        final_prices = paths[:, -1]
        pred_returns = (final_prices - S0) / S0

        var_95 = np.percentile(pred_returns, 5)
        es_95 = np.mean(pred_returns[pred_returns <= var_95])
        prob_loss = np.mean(pred_returns < 0)

        pred_var_95_list.append(var_95)
        pred_es_95_list.append(es_95)
        pred_probs_loss.append(prob_loss)

    # Agrégation
    real_returns = np.array(real_returns)
    pred_var_95_arr = np.array(pred_var_95_list)

    # Couverture : en combien de cas le rendement réalisé dépasse VaR ?
    coverage_95 = np.mean(real_returns < pred_var_95_arr)

    return {
        "n_windows": len(real_returns),
        "real_returns": real_returns,
        "pred_var_95": pred_var_95_arr,
        "pred_es_95": np.array(pred_es_95_list),
        "pred_prob_loss": np.array(pred_probs_loss),
        "coverage_95": coverage_95,  # Idéal = 0.05 (5%)
        "mean_real_return": np.mean(real_returns),
        "mean_pred_var_95": np.mean(pred_var_95_arr),
        "mean_pred_es_95": np.mean(pred_es_95_list),
        "mean_pred_prob_loss": np.mean(pred_probs_loss),
    }


def compute_backtesting_metrics(backtest_results: dict) -> dict:
    """
    Résume la qualité du modèle de simulation.

    Métriques clés :
    - Biais : le modèle surestime-t-il ou sous-estime-t-il le risque ?
    - Calibration : la couverture de VaR 95% doit être proche de 5%.
    - Queue : le modèle capture-t-il les queues épaisses ?
    """
    coverage = backtest_results["coverage_95"]
    real_returns = backtest_results["real_returns"]
    pred_var_95 = backtest_results["pred_var_95"]

    # Biais : rendement moyen réalisé vs prédit
    mean_real = np.mean(real_returns)
    mean_pred_var = np.mean(pred_var_95)
    bias = mean_real - mean_pred_var

    # Pire cas réalisé vs prédit
    worst_real = np.min(real_returns)
    worst_pred = np.min(pred_var_95)

    # Fréquence réelle de dépassement vs 5%
    miscalibration = abs(coverage - 0.05)

    return {
        "n_windows": backtest_results["n_windows"],
        "coverage_95_empirical": coverage,
        "coverage_95_target": 0.05,
        "miscalibration_error": miscalibration,
        "mean_real_return": mean_real,
        "mean_pred_var_95": mean_pred_var,
        "bias": bias,
        "worst_real_return": worst_real,
        "worst_pred_var_95": worst_pred,
        "is_well_calibrated": miscalibration < 0.02,  # heuristique
    }
