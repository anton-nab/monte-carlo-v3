"""
api/simulate.py
---------------
Router FastAPI pour le moteur Monte Carlo.

Endpoints :
    POST /api/simulate          — lance une simulation complète
    GET  /api/simulate/info/{ticker} — calibration seule (rapide, sans simulation)
"""

from __future__ import annotations

import asyncio
import time
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.simulation import (
    run_gbm,
    run_merton,
    run_heston,
    run_garch,
    compute_metrics,
    compute_fan_chart,
    compute_histogram,
    calibrate_ticker,
)

router = APIRouter(prefix="/api/simulate", tags=["simulate"])


# ═════════════════════════════════════════════════════════════════════════════
# Schémas Pydantic
# ═════════════════════════════════════════════════════════════════════════════

class SimulateRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20, description="Symbole Yahoo Finance (ex. AAPL, BTC-USD)")
    model: Literal["gbm", "merton", "heston", "garch"] = Field("gbm", description="Modèle de simulation")
    n_sims: int = Field(1000, ge=100, le=5000, description="Nombre de trajectoires")
    horizon_days: int = Field(252, ge=5, le=504, description="Horizon en jours de bourse (252 = 1 an)")

    # Overrides optionnels des paramètres calibrés
    mu_override: Optional[float] = Field(None, description="Drift annualisé (ex. 0.12 = 12%). Remplace la calibration.")
    sigma_override: Optional[float] = Field(None, ge=0.001, le=5.0, description="Volatilité annualisée (ex. 0.25 = 25%)")

    # Paramètres Merton
    lambda_poisson: float = Field(0.5, ge=0.0, le=20.0, description="Intensité des sauts (sauts/an)")
    jump_mean: float = Field(-0.05, ge=-1.0, le=1.0, description="Taille moyenne d'un saut (log-rendement)")
    jump_std: float = Field(0.10, ge=0.001, le=1.0, description="Écart-type de la taille des sauts")

    # Paramètres Heston
    kappa: float = Field(2.0, ge=0.01, le=20.0, description="Vitesse de réversion à la moyenne")
    sigma_v: float = Field(0.3, ge=0.01, le=5.0, description="Vol de vol")
    rho: float = Field(-0.7, ge=-1.0, le=1.0, description="Corrélation prix-variance (typiquement négatif)")
    v0_override: Optional[float] = Field(None, ge=0.0001, description="Variance initiale (défaut = sigma²)")
    theta_override: Optional[float] = Field(None, ge=0.0001, description="Variance long-terme (défaut = sigma²)")


# ═════════════════════════════════════════════════════════════════════════════
# Endpoints
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/info/{ticker}", summary="Calibration seule (rapide)")
async def get_ticker_info(ticker: str):
    """
    Retourne les paramètres calibrés (µ, σ, S0) pour un ticker, sans lancer de simulation.
    Utile pour pré-remplir le formulaire côté frontend.
    """
    ticker = ticker.upper().strip()
    loop = asyncio.get_event_loop()
    try:
        calib = await loop.run_in_executor(None, lambda: calibrate_ticker(ticker))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Erreur de données : {exc}")

    return {
        "ticker": ticker,
        "S0": calib["S0"],
        "mu": calib["mu"],
        "sigma": calib["sigma"],
        "mu_pct": round(calib["mu"] * 100, 2),
        "sigma_pct": round(calib["sigma"] * 100, 2),
        "n_obs": calib["n_obs"],
        "period": calib["period"],
    }


@router.post("", summary="Lancer une simulation Monte Carlo")
async def simulate(req: SimulateRequest):
    """
    Lance une simulation Monte Carlo et retourne :
    - fan_chart   : percentile bands (p5/p25/p50/p75/p95) sur l'horizon
    - histogram   : distribution des prix finaux
    - metrics     : VaR, ES, drawdown, probabilités de gain/perte
    - calibration : µ et σ utilisés (calibrés ou overridés)
    """
    t0 = time.perf_counter()
    ticker = req.ticker.upper().strip()

    # ── 1. Calibration ──────────────────────────────────────────────────────
    loop = asyncio.get_event_loop()
    try:
        calib = await loop.run_in_executor(None, lambda: calibrate_ticker(ticker))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Erreur de données : {exc}")

    S0 = calib["S0"]
    mu = req.mu_override if req.mu_override is not None else calib["mu"]
    sigma = req.sigma_override if req.sigma_override is not None else calib["sigma"]
    log_returns = calib["log_returns"]

    # ── 2. Simulation (dans un thread — numpy CPU-bound) ─────────────────────
    def _run_simulation():
        if req.model == "gbm":
            return run_gbm(S0, mu, sigma, req.horizon_days, req.n_sims)

        elif req.model == "merton":
            return run_merton(
                S0, mu, sigma, req.horizon_days, req.n_sims,
                lambda_poisson=req.lambda_poisson,
                jump_mean=req.jump_mean,
                jump_std=req.jump_std,
            )

        elif req.model == "heston":
            v0 = req.v0_override if req.v0_override is not None else sigma ** 2
            theta = req.theta_override if req.theta_override is not None else sigma ** 2
            return run_heston(
                S0, mu, v0, req.kappa, theta, req.sigma_v, req.rho,
                req.horizon_days, req.n_sims,
            )

        elif req.model == "garch":
            return run_garch(S0, log_returns, req.horizon_days, req.n_sims)

        raise ValueError(f"Modèle inconnu : {req.model}")

    try:
        paths = await loop.run_in_executor(None, _run_simulation)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur de simulation : {exc}")

    # ── 3. Post-traitement ───────────────────────────────────────────────────
    metrics = compute_metrics(paths, S0)
    fan_chart = compute_fan_chart(paths, max_points=100)
    histogram = compute_histogram(paths[:, -1], n_bins=50)

    elapsed_ms = round((time.perf_counter() - t0) * 1000)

    return {
        "ticker": ticker,
        "model": req.model,
        "S0": S0,
        "calibration": {
            "mu": round(mu, 6),
            "sigma": round(sigma, 6),
            "mu_pct": round(mu * 100, 2),
            "sigma_pct": round(sigma * 100, 2),
            "n_obs": calib["n_obs"],
            "period": calib["period"],
            "mu_overridden": req.mu_override is not None,
            "sigma_overridden": req.sigma_override is not None,
        },
        "simulation": {
            "n_sims": req.n_sims,
            "horizon_days": req.horizon_days,
            "model": req.model,
        },
        "fan_chart": fan_chart,
        "histogram": histogram,
        "metrics": metrics,
        "computation_time_ms": elapsed_ms,
    }
