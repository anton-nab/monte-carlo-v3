"""
api/compare.py
--------------
Router FastAPI — comparaison multi-modèle Monte Carlo.

Endpoint :
    POST /api/simulate/compare  — 4 modèles simultanés + variables de stress
"""

from __future__ import annotations

import asyncio

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.simulation.calibration import calibrate_ticker
from services.simulation.compare_engine import StressParams, run_comparison

router = APIRouter(prefix="/api/simulate", tags=["compare"])


# ─────────────────────────────────────────────────────────────────────────────
# Schémas
# ─────────────────────────────────────────────────────────────────────────────

class StressInput(BaseModel):
    """
    Variables de stress macroéconomique et géopolitique.
    Chaque variable modifie les paramètres de simulation de façon transparente.
    """
    vol_multiplier:    float = Field(1.0,  ge=0.5, le=4.0,
        description="Multiplicateur de volatilité (1=normal, 2=VIX élevé, 3=crise 2008)")
    mu_adjustment:     float = Field(0.0,  ge=-0.50, le=0.30,
        description="Ajustement du rendement annualisé (ex: -0.15 = récession -15%/an)")
    geopolitical_risk: float = Field(0.0,  ge=0.0, le=5.0,
        description="Risque géopolitique : sauts Poisson supplémentaires (0→5 par an)")
    crash_severity:    float = Field(0.0,  ge=0.0, le=1.0,
        description="Sévérité des chocs : 0=saut léger -3%, 1=crash extrême -20%")


class CompareRequest(BaseModel):
    ticker:             str   = Field(..., min_length=1, max_length=20)
    n_sims:             int   = Field(1000,   ge=100, le=10_000)
    horizon_days:       int   = Field(252,    ge=5,   le=1_260)
    initial_investment: float = Field(10_000, ge=100)
    mu_override:        float | None = Field(None, description="Override µ annuel (décimal)")
    sigma_override:     float | None = Field(None, description="Override σ annuel (décimal)")
    stress:             StressInput  = Field(default_factory=StressInput)


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/compare", summary="Comparer les 4 modèles Monte Carlo avec stress")
async def compare_models(req: CompareRequest):
    """
    Lance GBM, Merton, Heston et GARCH avec le même seed aléatoire (simulation
    couplée) + paramètres de stress contrôlés par l'utilisateur.

    Retourne :
    - fan chart + histogramme + métriques pour chaque modèle
    - fan chart consensus (médiane des 4 modèles)
    - matrice de corrélation 4×4 des prix finaux
    - paramètres de stress effectivement appliqués
    """
    ticker = req.ticker.upper().strip()
    loop   = asyncio.get_event_loop()

    # ── Calibration ────────────────────────────────────────────────────────
    try:
        calib = await loop.run_in_executor(None, lambda: calibrate_ticker(ticker))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Erreur de calibration : {exc}")

    S0 = float(req.initial_investment)
    if req.mu_override    is not None: calib["mu"]    = float(req.mu_override)
    if req.sigma_override is not None: calib["sigma"] = float(req.sigma_override)

    stress = StressParams(
        vol_multiplier    = req.stress.vol_multiplier,
        mu_adjustment     = req.stress.mu_adjustment,
        geopolitical_risk = req.stress.geopolitical_risk,
        crash_severity    = req.stress.crash_severity,
    )

    # ── Simulation (thread executor — CPU-bound) ───────────────────────────
    def _run():
        return run_comparison(calib, stress, req.n_sims, req.horizon_days, S0)

    try:
        result = await loop.run_in_executor(None, _run)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur de simulation : {exc}")

    return {
        "ticker":          ticker,
        "S0":              S0,
        "calibration": {
            "mu_pct":    round(calib["mu"] * 100, 2),
            "sigma_pct": round(calib["sigma"] * 100, 2),
            "n_obs":     calib["n_obs"],
            "period":    calib["period"],
            "mu_overridden":    req.mu_override is not None,
            "sigma_overridden": req.sigma_override is not None,
        },
        "simulation":       {"n_sims": req.n_sims, "horizon_days": req.horizon_days},
        **result,
    }
