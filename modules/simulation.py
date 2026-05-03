"""
simulation.py
-------------
Simulation Monte Carlo via plusieurs modèles de pricing d'options.

Modèles implémentés :
    1. GBM classique : dS_t = mu * S_t * dt + sigma * S_t * dW_t
    2. Merton jump-diffusion : ajoute sauts poissoniens
    3. Heston : volatilité stochastique
    4. GARCH bootstrap : rééchantillonnage de résidus GARCH(1,1)
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize

TRADING_DAYS = 252


def gbm_simulation(
    S0: float,
    mu: float,
    sigma: float,
    horizon_days: int,
    n_sims: int = 5000,
    trading_days: int = TRADING_DAYS,
    seed: int | None = None,
) -> np.ndarray:
    """
    Génère n_sims trajectoires GBM sur horizon_days jours de bourse.

    Parameters
    ----------
    S0 : float
        Prix initial.
    mu : float
        Drift annualisé (rendement moyen attendu).
    sigma : float
        Volatilité annualisée.
    horizon_days : int
        Nombre de jours de bourse à simuler.
    n_sims : int
        Nombre de trajectoires.
    trading_days : int
        Jours de bourse par an (252 standard).
    seed : int, optionnel
        Graine pour reproductibilité.

    Returns
    -------
    np.ndarray, shape (n_sims, horizon_days + 1)
        Matrice des prix simulés. Colonne 0 = S0 pour toutes les sims.
    """
    if seed is not None:
        np.random.seed(seed)

    dt = 1.0 / trading_days
    drift = (mu - 0.5 * sigma**2) * dt
    diffusion = sigma * np.sqrt(dt)

    # Matrice de chocs gaussiens (n_sims x horizon_days)
    Z = np.random.standard_normal((n_sims, horizon_days))

    # Log-rendements simulés
    log_returns = drift + diffusion * Z

    # Cumul des log-rendements + colonne 0 pour le prix initial
    cum_log_returns = np.concatenate(
        [np.zeros((n_sims, 1)), np.cumsum(log_returns, axis=1)],
        axis=1,
    )

    # Conversion en prix : S_t = S_0 * exp(cum_log_returns)
    paths = S0 * np.exp(cum_log_returns)
    return paths


def antithetic_gbm_simulation(
    S0: float,
    mu: float,
    sigma: float,
    horizon_days: int,
    n_sims: int = 5000,
    trading_days: int = TRADING_DAYS,
    seed: int | None = None,
) -> np.ndarray:
    """
    Variante avec variables antithétiques : technique de réduction de variance.
    Pour chaque tirage Z, on utilise aussi -Z, ce qui divise approximativement
    par 2 la variance des estimateurs sans coût supplémentaire.

    n_sims doit être pair ; sinon il est arrondi.
    """
    if seed is not None:
        np.random.seed(seed)

    half = n_sims // 2
    dt = 1.0 / trading_days
    drift = (mu - 0.5 * sigma**2) * dt
    diffusion = sigma * np.sqrt(dt)

    Z_half = np.random.standard_normal((half, horizon_days))
    Z = np.concatenate([Z_half, -Z_half], axis=0)

    log_returns = drift + diffusion * Z
    cum_log_returns = np.concatenate(
        [np.zeros((Z.shape[0], 1)), np.cumsum(log_returns, axis=1)],
        axis=1,
    )
    return S0 * np.exp(cum_log_returns)


def merton_jump_diffusion(
    S0: float,
    mu: float,
    sigma: float,
    horizon_days: int,
    n_sims: int = 5000,
    lambda_poisson: float = 0.5,
    jump_mean: float = -0.05,
    jump_std: float = 0.1,
    trading_days: int = TRADING_DAYS,
    seed: int | None = None,
) -> np.ndarray:
    """
    Merton jump-diffusion : dS = mu*S*dt + sigma*S*dW + J*dN

    Parameters
    ----------
    lambda_poisson : float
        Intensité du processus de Poisson (nombre de sauts attendus par an).
    jump_mean : float
        Rendement moyen d'un saut (ex. -5% = -0.05).
    jump_std : float
        Écart-type du rendement de saut.
    """
    if seed is not None:
        np.random.seed(seed)

    dt = 1.0 / trading_days
    drift = (mu - 0.5 * sigma**2) * dt
    diffusion = sigma * np.sqrt(dt)
    lambda_dt = lambda_poisson * dt

    paths = np.full((n_sims, horizon_days + 1), S0)

    for step in range(horizon_days):
        Z = np.random.standard_normal(n_sims)
        # GBM composante
        log_ret_diffusion = drift + diffusion * Z

        # Poisson : nombre de sauts par simulation
        N = np.random.poisson(lambda_dt, n_sims)
        log_ret_jump = np.zeros(n_sims)

        for i in range(n_sims):
            if N[i] > 0:
                jump_returns = np.random.normal(jump_mean, jump_std, N[i])
                log_ret_jump[i] = np.sum(jump_returns)

        paths[:, step + 1] = paths[:, step] * np.exp(log_ret_diffusion + log_ret_jump)

    return paths


def heston_simulation(
    S0: float,
    mu: float,
    v0: float,
    kappa: float,
    theta: float,
    sigma_v: float,
    rho: float,
    horizon_days: int,
    n_sims: int = 5000,
    trading_days: int = TRADING_DAYS,
    seed: int | None = None,
) -> np.ndarray:
    """
    Heston : volatilité stochastique via deux EDS couplées.
    dS = mu*S*dt + sqrt(v)*S*dW1
    dv = kappa*(theta - v)*dt + sigma_v*sqrt(v)*dW2
    avec corr(dW1, dW2) = rho

    Parameters
    ----------
    v0 : float
        Variance initiale (volatilité² initiale).
    kappa : float
        Vitesse de reversion à la moyenne.
    theta : float
        Variance moyenne long-terme.
    sigma_v : float
        Volatilité de la volatilité.
    rho : float
        Corrélation entre les deux mouvements browniens ([-1, 1]).
    """
    if seed is not None:
        np.random.seed(seed)

    dt = 1.0 / trading_days

    paths = np.full((n_sims, horizon_days + 1), S0)
    variances = np.full((n_sims, horizon_days + 1), v0)

    for step in range(horizon_days):
        # Deux mouvements browniens corrélés
        Z1 = np.random.standard_normal(n_sims)
        Z2 = np.random.standard_normal(n_sims)
        Z2_corr = rho * Z1 + np.sqrt(1 - rho**2) * Z2

        # Équation de la variance (Euler avec absorption en 0)
        v = variances[:, step]
        sqrt_v = np.sqrt(np.maximum(v, 1e-6))
        dv = kappa * (theta - v) * dt + sigma_v * sqrt_v * Z2_corr * np.sqrt(dt)
        variances[:, step + 1] = np.maximum(v + dv, 1e-6)

        # Équation du prix
        sqrt_v_new = np.sqrt(variances[:, step + 1])
        dS = mu * paths[:, step] * dt + sqrt_v_new * paths[:, step] * Z1 * np.sqrt(dt)
        paths[:, step + 1] = paths[:, step] + dS
        paths[:, step + 1] = np.maximum(paths[:, step + 1], 1e-6)

    return paths


def fit_garch11(returns: np.ndarray, max_iter: int = 500) -> dict:
    """
    Calibrage GARCH(1,1) via maximum de vraisemblance sur les rendements.
    Retourne les paramètres (omega, alpha, beta).
    """
    returns = np.asarray(returns).flatten()
    r_mean = returns.mean()
    residuals = returns - r_mean

    # Initialisation simple
    sigma2_init = residuals.var()
    params_init = np.array([0.0001, 0.1, 0.8])

    def neg_ll(params):
        omega, alpha, beta = np.maximum(params, 1e-8)
        if alpha + beta >= 1.0:
            return 1e10

        sigma2 = np.zeros(len(residuals))
        sigma2[0] = sigma2_init

        for t in range(1, len(residuals)):
            sigma2[t] = omega + alpha * residuals[t-1]**2 + beta * sigma2[t-1]
            sigma2[t] = np.maximum(sigma2[t], 1e-8)

        ll = -0.5 * np.sum(np.log(sigma2) + residuals**2 / sigma2)
        return -ll

    result = minimize(
        neg_ll, params_init, method='Nelder-Mead',
        options={'maxiter': max_iter, 'xatol': 1e-6, 'fatol': 1e-6}
    )

    omega, alpha, beta = np.maximum(result.x, 1e-8)
    return {"omega": omega, "alpha": alpha, "beta": beta, "success": result.success}


def garch_bootstrap_simulation(
    S0: float,
    returns: np.ndarray,
    horizon_days: int,
    n_sims: int = 5000,
    trading_days: int = TRADING_DAYS,
    seed: int | None = None,
) -> np.ndarray:
    """
    GARCH bootstrap : calibre GARCH(1,1) sur rendements historiques,
    puis rééchantillonne les résidus avec la dynamique GARCH.

    Parameters
    ----------
    returns : np.ndarray
        Rendements historiques (quotidiens).
    """
    if seed is not None:
        np.random.seed(seed)

    returns = np.asarray(returns).flatten()
    r_mean = returns.mean()
    residuals = returns - r_mean

    # Calibrage GARCH
    garch_params = fit_garch11(residuals)
    omega = garch_params["omega"]
    alpha = garch_params["alpha"]
    beta = garch_params["beta"]

    sigma2_init = residuals.var()
    resid_normalized = residuals / np.sqrt(residuals.var() + 1e-8)

    paths = np.full((n_sims, horizon_days + 1), S0)

    for sim in range(n_sims):
        sigma2 = sigma2_init
        S = S0

        for step in range(horizon_days):
            # Rééchantillonnage aléatoire de résidus normalisés
            idx = np.random.randint(0, len(resid_normalized))
            eps = resid_normalized[idx]

            # Dynamique GARCH
            sigma2 = omega + alpha * (eps**2 * sigma2) + beta * sigma2
            sigma2 = np.maximum(sigma2, 1e-8)

            # Nouveau rendement
            r = r_mean + np.sqrt(sigma2) * eps
            S = S * np.exp(r)
            paths[sim, step + 1] = S

    return paths
