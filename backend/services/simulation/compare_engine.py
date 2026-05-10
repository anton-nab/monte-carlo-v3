"""
compare_engine.py
-----------------
Comparaison des 4 modèles Monte Carlo (GBM / Merton / Heston / GARCH)
sur les mêmes chocs aléatoires (même seed numpy) + variables de stress.

Principe "coupled simulation" :
    Chaque modèle est lancé avec seed=42, ce qui force numpy à utiliser
    la même séquence de nombres aléatoires. La corrélation entre les
    prix finaux des modèles mesure alors combien les dynamiques propres
    à chaque modèle (sauts, vol stochastique, clustering GARCH) s'écartent
    du GBM de base étant donné des chocs identiques.

Variables de stress disponibles :
    vol_multiplier    — régime de volatilité (1.0 = normal, 3.0 = crise)
    mu_adjustment     — ajustement annuel du rendement (-0.20 = récession)
    geopolitical_risk — λ Poisson supplémentaire (0–5 sauts/an)
    crash_severity    — sévérité des sauts (0 = léger, 1 = crash extrême)
    correlation_shift — pour portefeuilles : blend vers corrélation = 1
"""

from __future__ import annotations

import numpy as np

from .simulation_engine import (
    run_gbm, run_merton, run_heston, run_garch,
    compute_metrics, compute_fan_chart, compute_histogram,
)

TRADING_DAYS = 252
COUPLED_SEED  = 42     # même seed pour tous les modèles → comparaison couplée


# ─────────────────────────────────────────────────────────────────────────────
# Paramètres de stress
# ─────────────────────────────────────────────────────────────────────────────

class StressParams:
    """
    Paramètres modifiables par l'utilisateur pour simuler différents régimes.

    vol_multiplier    : multiplicateur de σ  (1.0–4.0)
    mu_adjustment     : Δµ annuel décimal    (-0.30 … +0.20)
    geopolitical_risk : sauts Poisson extra  (0–5 / an)
    crash_severity    : intensité des sauts  (0.0–1.0)
    """

    def __init__(
        self,
        vol_multiplier:    float = 1.0,
        mu_adjustment:     float = 0.0,
        geopolitical_risk: float = 0.0,
        crash_severity:    float = 0.0,
    ) -> None:
        self.vol_multiplier    = max(0.5, min(4.0, float(vol_multiplier)))
        self.mu_adjustment     = max(-0.50, min(0.30, float(mu_adjustment)))
        self.geopolitical_risk = max(0.0, min(5.0, float(geopolitical_risk)))
        self.crash_severity    = max(0.0, min(1.0, float(crash_severity)))


# ─────────────────────────────────────────────────────────────────────────────
# Application du stress aux paramètres calibrés
# ─────────────────────────────────────────────────────────────────────────────

def _stressed_params(calib: dict, stress: StressParams) -> dict:
    """
    Retourne un dict de paramètres prêts à l'emploi pour chaque modèle,
    après application du stress.

    calib doit contenir :
        mu       : rendement annualisé (float)
        sigma    : volatilité annualisée (float)
        log_returns : rendements journaliers historiques (list/array)
        S0       : prix initial (float)
    """
    sigma_s = calib["sigma"] * stress.vol_multiplier
    mu_s    = calib["mu"]    + stress.mu_adjustment

    # ── Merton : λ et paramètres de saut ──────────────────────────────────
    lambda_base   = 0.5
    lambda_s      = lambda_base + stress.geopolitical_risk * 0.80   # 0 → 4.5 sauts/an
    jump_mean_s   = -0.03  - stress.crash_severity * 0.17           # -0.03 → -0.20
    jump_std_s    =  0.07  + stress.crash_severity * 0.10           # 0.07 → 0.17

    # ── Heston : variance initiale + vol-of-vol + corrélation S–v ─────────
    sigma_daily = sigma_s / np.sqrt(TRADING_DAYS)
    v0_s        = sigma_daily ** 2
    theta_s     = v0_s                                               # LT variance = v0
    kappa_s     = 2.0                                                # mean-reversion
    sigma_v_s   = 0.25 + stress.vol_multiplier * 0.07               # vol of vol ↑ avec stress
    rho_s       = max(-0.95, -0.65 - stress.crash_severity * 0.25)  # effet levier amplifié

    return {
        "sigma_s":      sigma_s,
        "mu_s":         mu_s,
        "lambda_s":     lambda_s,
        "jump_mean_s":  jump_mean_s,
        "jump_std_s":   jump_std_s,
        "v0_s":         v0_s,
        "theta_s":      theta_s,
        "kappa_s":      kappa_s,
        "sigma_v_s":    sigma_v_s,
        "rho_s":        rho_s,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Consensus : enveloppe percentile sur les 4 × N trajectoires
# ─────────────────────────────────────────────────────────────────────────────

def _consensus_fan(fan_per_model: list[list[dict]]) -> list[dict]:
    """
    Calcule le fan chart consensus (percentiles médians des 4 modèles).
    Prend la médiane de chaque percentile (P5, P25, P50, P75, P95)
    à chaque pas de temps.
    """
    n_points = len(fan_per_model[0])
    result = []
    for i in range(n_points):
        row = {}
        for key in ("day", "p5", "p25", "p50", "p75", "p95"):
            vals = [m[i][key] for m in fan_per_model]
            row[key] = round(float(np.median(vals)), 2) if key != "day" else vals[0]
        result.append(row)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Moteur principal
# ─────────────────────────────────────────────────────────────────────────────

MODEL_NAMES = ("gbm", "merton", "heston", "garch")


def run_comparison(
    calib:         dict,
    stress:        StressParams,
    n_sims:        int,
    horizon_days:  int,
    S0:            float,
) -> dict:
    """
    Exécute les 4 modèles avec le MÊME seed (comparaison couplée).

    Returns
    -------
    dict :
        models          : {gbm, merton, heston, garch} → {fan_chart, histogram, metrics, params_used}
        consensus       : {fan_chart, histogram, metrics}
        model_corr      : matrice de corrélation 4×4 des prix finaux
        stress_applied  : paramètres de stress effectifs
        computation_time_ms
    """
    import time
    t0 = time.perf_counter()

    sp = _stressed_params(calib, stress)

    log_ret_arr = np.asarray(calib["log_returns"], dtype=float).flatten()
    paths: dict[str, np.ndarray] = {}

    # ── GBM ──────────────────────────────────────────────────────────────
    paths["gbm"] = run_gbm(
        S0, sp["mu_s"], sp["sigma_s"],
        horizon_days, n_sims, seed=COUPLED_SEED,
    )

    # ── Merton ────────────────────────────────────────────────────────────
    paths["merton"] = run_merton(
        S0, sp["mu_s"], sp["sigma_s"],
        horizon_days, n_sims,
        lambda_poisson=sp["lambda_s"],
        jump_mean=sp["jump_mean_s"],
        jump_std=sp["jump_std_s"],
        seed=COUPLED_SEED,
    )

    # ── Heston ────────────────────────────────────────────────────────────
    paths["heston"] = run_heston(
        S0, sp["mu_s"],
        v0=sp["v0_s"], kappa=sp["kappa_s"],
        theta=sp["theta_s"], sigma_v=sp["sigma_v_s"],
        rho=sp["rho_s"],
        horizon_days=horizon_days, n_sims=n_sims, seed=COUPLED_SEED,
    )

    # ── GARCH ─────────────────────────────────────────────────────────────
    # GARCH travaille sur les résidus historiques — on applique vol_multiplier
    # en ré-échantillonnant les résidus mis à l'échelle.
    log_ret_stressed = log_ret_arr * stress.vol_multiplier
    paths["garch"] = run_garch(
        S0, log_ret_stressed, horizon_days, n_sims, seed=COUPLED_SEED,
    )

    # ── Métriques individuelles ────────────────────────────────────────────
    models_out: dict[str, dict] = {}
    fan_per_model: list[list[dict]] = []

    for name in MODEL_NAMES:
        p = paths[name]
        fan   = compute_fan_chart(p, max_points=100)
        histo = compute_histogram(p[:, -1], n_bins=50)
        metr  = compute_metrics(p, S0)
        fan_per_model.append(fan)
        models_out[name] = {
            "fan_chart": fan,
            "histogram": histo,
            "metrics":   metr,
        }

    # ── Paramètres utilisés (pour affichage) ──────────────────────────────
    models_out["gbm"]["params_used"]    = {"mu": round(sp["mu_s"],4), "sigma": round(sp["sigma_s"],4)}
    models_out["merton"]["params_used"] = {
        "mu": round(sp["mu_s"],4), "sigma": round(sp["sigma_s"],4),
        "lambda": round(sp["lambda_s"],3),
        "jump_mean": round(sp["jump_mean_s"],3),
        "jump_std":  round(sp["jump_std_s"],3),
    }
    models_out["heston"]["params_used"] = {
        "mu": round(sp["mu_s"],4), "v0": round(sp["v0_s"],6),
        "kappa": round(sp["kappa_s"],2), "theta": round(sp["theta_s"],6),
        "sigma_v": round(sp["sigma_v_s"],3), "rho": round(sp["rho_s"],3),
    }
    models_out["garch"]["params_used"]  = {
        "vol_multiplier_applied": round(stress.vol_multiplier,2),
        "n_returns_used": len(log_ret_arr),
    }

    # ── Consensus (médiane des 4 fans) ────────────────────────────────────
    cons_fan = _consensus_fan(fan_per_model)
    # pool all 4 × n_sims final prices for consensus distribution
    all_finals = np.concatenate([paths[n][:, -1] for n in MODEL_NAMES])
    cons_histo  = compute_histogram(all_finals, n_bins=50)
    cons_metrics = compute_metrics(
        np.stack([paths[n] for n in MODEL_NAMES]).mean(axis=0),  # mean path matrix
        S0,
    )

    # ── Histogramme partagé (axe X commun pour overlay frontend) ──────────
    # Bornes robustes : percentile 0.5–99.5 de tous les prix finaux poolés
    p_lo = float(np.percentile(all_finals, 0.5))
    p_hi = float(np.percentile(all_finals, 99.5))
    n_bins_shared = 60
    shared_edges   = np.linspace(p_lo, p_hi, n_bins_shared + 1)
    shared_centers = 0.5 * (shared_edges[:-1] + shared_edges[1:])

    histogram_overlay = []
    for ci, center in enumerate(shared_centers):
        row: dict = {"price": round(float(center), 2)}
        for name in MODEL_NAMES:
            cnt, _ = np.histogram(paths[name][:, -1], bins=shared_edges[[ci, ci+1]])
            row[name] = int(cnt[0])
        # consensus = all pooled
        cnt_all, _ = np.histogram(all_finals, bins=shared_edges[[ci, ci+1]])
        row["consensus"] = int(cnt_all[0])
        histogram_overlay.append(row)

    # ── Corrélation entre modèles (couplée — même seed) ───────────────────
    finals_mat = np.array([paths[n][:, -1] for n in MODEL_NAMES])  # (4, n_sims)
    corr_mat   = np.corrcoef(finals_mat)
    model_corr = [
        [round(float(corr_mat[i, j]), 4) for j in range(4)]
        for i in range(4)
    ]

    elapsed = round((time.perf_counter() - t0) * 1000)

    return {
        "models":              models_out,
        "model_names":         list(MODEL_NAMES),
        "histogram_overlay":   histogram_overlay,
        "consensus": {
            "fan_chart": cons_fan,
            "histogram": cons_histo,
            "metrics":   cons_metrics,
        },
        "model_corr":     model_corr,
        "stress_applied": {
            "vol_multiplier":    round(stress.vol_multiplier, 2),
            "mu_adjustment":     round(stress.mu_adjustment, 4),
            "geopolitical_risk": round(stress.geopolitical_risk, 2),
            "crash_severity":    round(stress.crash_severity, 2),
            "sigma_stressed":    round(float(sp["sigma_s"]), 4),
            "mu_stressed":       round(float(sp["mu_s"]), 4),
            "lambda_merton":     round(float(sp["lambda_s"]), 3),
            "jump_mean":         round(float(sp["jump_mean_s"]), 3),
            "rho_heston":        round(float(sp["rho_s"]), 3),
        },
        "computation_time_ms": elapsed,
    }
