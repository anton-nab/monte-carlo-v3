"""
simulation_engine.py
--------------------
Moteur Monte Carlo — 4 modèles + métriques de risque.

Modèles :
    GBM     — Geometric Brownian Motion (baseline)
    Merton  — Jump-diffusion (sauts de Poisson)
    Heston  — Volatilité stochastique (deux browniens corrélés)
    GARCH   — Bootstrap GARCH(1,1) (rééchantillonnage de résidus)

Sorties :
    compute_metrics()   — VaR, ES, drawdown, probabilités
    compute_fan_chart() — percentile bands pour le graphique
    compute_histogram() — distribution des prix finaux
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import minimize

TRADING_DAYS = 252


# ═════════════════════════════════════════════════════════════════════════════
# 1.  MODÈLES DE SIMULATION
# ═════════════════════════════════════════════════════════════════════════════

def run_gbm(
    S0: float,
    mu: float,
    sigma: float,
    horizon_days: int,
    n_sims: int = 1000,
    seed: int | None = None,
) -> np.ndarray:
    """
    Geometric Brownian Motion — entièrement vectorisé.
    dS = mu*S*dt + sigma*S*dW

    Returns : ndarray (n_sims, horizon_days + 1)
    """
    if seed is not None:
        np.random.seed(seed)

    dt = 1.0 / TRADING_DAYS
    drift = (mu - 0.5 * sigma ** 2) * dt
    diffusion = sigma * np.sqrt(dt)

    Z = np.random.standard_normal((n_sims, horizon_days))
    log_r = drift + diffusion * Z
    cum_lr = np.concatenate([np.zeros((n_sims, 1)), np.cumsum(log_r, axis=1)], axis=1)
    return S0 * np.exp(cum_lr)


def run_merton(
    S0: float,
    mu: float,
    sigma: float,
    horizon_days: int,
    n_sims: int = 1000,
    lambda_poisson: float = 0.5,
    jump_mean: float = -0.05,
    jump_std: float = 0.10,
    seed: int | None = None,
) -> np.ndarray:
    """
    Merton Jump-Diffusion : GBM + sauts poissoniens.
    dS = mu*S*dt + sigma*S*dW + J*dN

    lambda_poisson : intensité (nombre de sauts attendus / an)
    jump_mean      : rendement moyen d'un saut (log-return)
    jump_std       : écart-type du saut
    """
    if seed is not None:
        np.random.seed(seed)

    dt = 1.0 / TRADING_DAYS
    drift = (mu - 0.5 * sigma ** 2) * dt
    diffusion = sigma * np.sqrt(dt)
    lambda_dt = lambda_poisson * dt

    paths = np.full((n_sims, horizon_days + 1), float(S0))

    for step in range(horizon_days):
        Z = np.random.standard_normal(n_sims)
        N = np.random.poisson(lambda_dt, n_sims)  # nb de sauts par simulation

        # Composante sauts vectorisée : évite la double boucle Python
        log_jump = np.zeros(n_sims)
        if N.max() > 0:
            max_j = int(N.max())
            all_j = np.random.normal(jump_mean, jump_std, (n_sims, max_j))
            mask = np.arange(max_j)[None, :] < N[:, None]   # (n_sims, max_j)
            log_jump = (all_j * mask).sum(axis=1)

        log_r = drift + diffusion * Z + log_jump
        paths[:, step + 1] = paths[:, step] * np.exp(log_r)

    return paths


def run_heston(
    S0: float,
    mu: float,
    v0: float,
    kappa: float,
    theta: float,
    sigma_v: float,
    rho: float,
    horizon_days: int,
    n_sims: int = 1000,
    seed: int | None = None,
) -> np.ndarray:
    """
    Heston : volatilité stochastique — deux browniens corrélés.
    dS = mu*S*dt + sqrt(v)*S*dW1
    dv = kappa*(theta - v)*dt + sigma_v*sqrt(v)*dW2
    corr(dW1, dW2) = rho

    v0      : variance initiale (= sigma²)
    kappa   : vitesse de réversion à la moyenne
    theta   : variance long-terme (= sigma²)
    sigma_v : "vol of vol"
    rho     : corrélation S–v (typiquement négatif)
    """
    if seed is not None:
        np.random.seed(seed)

    dt = 1.0 / TRADING_DAYS
    sqrt_rho2 = np.sqrt(max(1.0 - rho ** 2, 0.0))

    paths = np.full((n_sims, horizon_days + 1), float(S0))
    v = np.full(n_sims, float(v0))

    for step in range(horizon_days):
        Z1 = np.random.standard_normal(n_sims)
        Z2 = np.random.standard_normal(n_sims)
        W2 = rho * Z1 + sqrt_rho2 * Z2  # brownien corrélé

        sqrt_v = np.sqrt(np.maximum(v, 1e-8))

        # Mise à jour de la variance (Euler–Maruyama, absorption à 0)
        v = np.maximum(
            v + kappa * (theta - v) * dt + sigma_v * sqrt_v * W2 * np.sqrt(dt),
            1e-8,
        )

        # Mise à jour du prix
        paths[:, step + 1] = np.maximum(
            paths[:, step] * np.exp(
                (mu - 0.5 * v) * dt + np.sqrt(v) * np.sqrt(dt) * Z1
            ),
            1e-6,
        )

    return paths


# ── GARCH helpers ─────────────────────────────────────────────────────────────

def _fit_garch11(residuals: np.ndarray) -> tuple[float, float, float]:
    """
    Calibrage GARCH(1,1) par maximum de vraisemblance (Nelder-Mead).
    Retourne (omega, alpha, beta).
    """
    sigma2_init = float(residuals.var())

    def neg_ll(params: np.ndarray) -> float:
        omega, alpha, beta = np.maximum(params, 1e-8)
        if alpha + beta >= 1.0:
            return 1e10
        s2 = np.empty(len(residuals))
        s2[0] = sigma2_init
        for t in range(1, len(residuals)):
            s2[t] = max(omega + alpha * residuals[t - 1] ** 2 + beta * s2[t - 1], 1e-8)
        return float(0.5 * np.sum(np.log(s2) + residuals ** 2 / s2))

    res = minimize(
        neg_ll,
        np.array([1e-4, 0.10, 0.80]),
        method="Nelder-Mead",
        options={"maxiter": 600, "xatol": 1e-6, "fatol": 1e-6},
    )
    return tuple(float(x) for x in np.maximum(res.x, 1e-8))  # type: ignore[return-value]


def run_garch(
    S0: float,
    log_returns: list | np.ndarray,
    horizon_days: int,
    n_sims: int = 1000,
    seed: int | None = None,
) -> np.ndarray:
    """
    GARCH(1,1) bootstrap : calibre sur les rendements historiques,
    rééchantillonne les résidus normalisés avec dynamique GARCH.

    Vectorisé sur les simulations (seule la boucle temporelle reste Python).
    """
    if seed is not None:
        np.random.seed(seed)

    lr = np.asarray(log_returns, dtype=float).flatten()
    r_mean = float(lr.mean())
    residuals = lr - r_mean
    sigma2_init = float(residuals.var()) or 1e-8

    omega, alpha, beta = _fit_garch11(residuals)
    resid_norm = residuals / np.sqrt(sigma2_init)

    paths = np.full((n_sims, horizon_days + 1), float(S0))
    s2 = np.full(n_sims, sigma2_init)  # variance par simulation (vectorisée)

    for step in range(horizon_days):
        idx = np.random.randint(0, len(resid_norm), n_sims)
        eps = resid_norm[idx]
        # Dynamique GARCH vectorisée
        s2 = np.maximum(omega + alpha * (eps ** 2 * s2) + beta * s2, 1e-8)
        r = r_mean + np.sqrt(s2) * eps
        paths[:, step + 1] = paths[:, step] * np.exp(r)

    return paths


# ═════════════════════════════════════════════════════════════════════════════
# 2.  MÉTRIQUES DE RISQUE
# ═════════════════════════════════════════════════════════════════════════════

def _es(returns: np.ndarray, alpha: float) -> float:
    """Expected Shortfall (CVaR) au seuil alpha."""
    cutoff = float(np.percentile(returns, alpha * 100))
    tail = returns[returns <= cutoff]
    return float(tail.mean()) if len(tail) > 0 else cutoff


def _max_drawdown_vec(paths: np.ndarray) -> np.ndarray:
    """Max drawdown par trajectoire (vectorisé). Valeur négative ou nulle."""
    running_max = np.maximum.accumulate(paths, axis=1)
    dd = (paths - running_max) / np.maximum(running_max, 1e-8)
    return dd.min(axis=1)


def compute_metrics(paths: np.ndarray, S0: float) -> dict:
    """
    Calcule toutes les métriques de risque à partir des trajectoires.

    Returns : dict avec prix, percentiles, rendements, VaR/ES, drawdown, probs.
    """
    final = paths[:, -1]
    returns = (final - S0) / S0
    drawdowns = _max_drawdown_vec(paths)

    def r4(x: float) -> float:
        return round(float(x), 4)

    return {
        # Prix finaux
        "expected_price": r4(np.mean(final)),
        "median_price": r4(np.median(final)),
        "std_price": r4(np.std(final)),
        "min_price": r4(np.min(final)),
        "max_price": r4(np.max(final)),
        # Percentiles de prix
        "p1": r4(np.percentile(final, 1)),
        "p5": r4(np.percentile(final, 5)),
        "p25": r4(np.percentile(final, 25)),
        "p50": r4(np.percentile(final, 50)),
        "p75": r4(np.percentile(final, 75)),
        "p95": r4(np.percentile(final, 95)),
        "p99": r4(np.percentile(final, 99)),
        # Rendements
        "expected_return": r4(returns.mean()),
        "return_std": r4(returns.std()),
        # VaR & ES
        "var_95": r4(np.percentile(returns, 5)),
        "var_99": r4(np.percentile(returns, 1)),
        "es_95": r4(_es(returns, 0.05)),
        "es_99": r4(_es(returns, 0.01)),
        # Probabilités
        "prob_loss": r4(np.mean(final < S0)),
        "prob_gain_10pct": r4(np.mean(returns > 0.10)),
        "prob_loss_10pct": r4(np.mean(returns < -0.10)),
        "prob_gain_20pct": r4(np.mean(returns > 0.20)),
        "prob_loss_20pct": r4(np.mean(returns < -0.20)),
        # Drawdown
        "avg_max_drawdown": r4(drawdowns.mean()),
        "median_max_drawdown": r4(np.median(drawdowns)),
        "worst_drawdown": r4(drawdowns.min()),
    }


# ═════════════════════════════════════════════════════════════════════════════
# 3.  SORTIES GRAPHIQUES
# ═════════════════════════════════════════════════════════════════════════════

def compute_fan_chart(paths: np.ndarray, max_points: int = 100) -> list[dict]:
    """
    Fan chart : percentile bands rééchantillonnés à max_points points.

    Chaque point : { day, p5, p25, p50, p75, p95 }
    """
    n_steps = paths.shape[1]  # horizon_days + 1
    if n_steps <= max_points:
        indices = list(range(n_steps))
    else:
        indices = np.linspace(0, n_steps - 1, max_points, dtype=int).tolist()

    result = []
    for i in indices:
        col = paths[:, i]
        result.append({
            "day": int(i),
            "p5":  round(float(np.percentile(col, 5)),  2),
            "p25": round(float(np.percentile(col, 25)), 2),
            "p50": round(float(np.percentile(col, 50)), 2),
            "p75": round(float(np.percentile(col, 75)), 2),
            "p95": round(float(np.percentile(col, 95)), 2),
        })
    return result


def compute_histogram(final_prices: np.ndarray, n_bins: int = 50) -> list[dict]:
    """
    Distribution des prix finaux.

    Chaque bucket : { price, count }
    """
    counts, edges = np.histogram(final_prices, bins=n_bins)
    centers = 0.5 * (edges[:-1] + edges[1:])
    return [
        {"price": round(float(c), 2), "count": int(cnt)}
        for c, cnt in zip(centers, counts)
    ]
