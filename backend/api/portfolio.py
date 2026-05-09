"""
api/portfolio.py
----------------
Router FastAPI — analyse de portefeuille multi-actifs.

Endpoints :
    POST /api/portfolio/analyze  — analyse complète (Markowitz + MC corrélé)
"""

from __future__ import annotations

import asyncio
import time

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from services.portfolio import (
    fetch_portfolio_data,
    compute_portfolio_stats,
    generate_random_portfolios,
    find_optimal_sharpe,
    find_min_volatility,
    simulate_portfolio_paths,
)
from services.simulation.simulation_engine import (
    compute_metrics,
    compute_fan_chart,
    compute_histogram,
)

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


# ═════════════════════════════════════════════════════════════════════════════
# Schémas
# ═════════════════════════════════════════════════════════════════════════════

class PortfolioAsset(BaseModel):
    ticker: str  = Field(..., min_length=1, max_length=20)
    weight: float = Field(..., ge=0.0)     # poids brut (sera normalisé)


class PortfolioRequest(BaseModel):
    assets:             list[PortfolioAsset]
    horizon_days:       int   = Field(252, ge=5, le=1260)
    n_sims:             int   = Field(1000, ge=100, le=5000)
    risk_free_rate:     float = Field(0.05, ge=0.0, le=0.5)
    initial_investment: float = Field(10_000.0, ge=100.0)

    @model_validator(mode="after")
    def check_assets(self) -> "PortfolioRequest":
        if len(self.assets) < 2:
            raise ValueError("Au moins 2 actifs requis pour un portefeuille")
        if len(self.assets) > 15:
            raise ValueError("Maximum 15 actifs par portefeuille")
        total = sum(a.weight for a in self.assets)
        if total <= 0:
            raise ValueError("La somme des poids doit être positive")
        return self


# ═════════════════════════════════════════════════════════════════════════════
# Endpoint
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/analyze", summary="Analyser un portefeuille multi-actifs")
async def analyze_portfolio(req: PortfolioRequest):
    """
    Analyse complète d'un portefeuille :
    - Calibration depuis 2 ans d'historique yfinance
    - Statistiques : rendement, volatilité, Sharpe
    - Frontière efficiente (600 portefeuilles aléatoires)
    - Portefeuille optimal (Sharpe max) + Min Vol
    - Monte Carlo corrélé (Cholesky) → fan chart + métriques de risque
    - Matrice de corrélation
    """
    t0 = time.perf_counter()

    # ── Normalisation des poids ─────────────────────────────────────────────
    tickers = [a.ticker.upper().strip() for a in req.assets]
    raw_w   = np.array([a.weight for a in req.assets], dtype=float)
    weights = raw_w / raw_w.sum()

    # ── 1. Données historiques ──────────────────────────────────────────────
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(
            None, lambda: fetch_portfolio_data(tickers)
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Erreur de données : {exc}")

    mean_r = np.array(data["mean_returns"])
    cov    = np.array(data["cov_matrix"])
    tickers_ordered = data["tickers"]      # peut différer si yf réordonne

    # Réaligner les poids si l'ordre des tickers a changé
    if tickers_ordered != tickers:
        order = [tickers.index(t) for t in tickers_ordered]
        weights = weights[order]

    # ── 2. Stats du portefeuille soumis ────────────────────────────────────
    def _run_analysis():
        ret, vol, sharpe = compute_portfolio_stats(
            weights, mean_r, cov, req.risk_free_rate
        )

        # Actifs individuels
        individual = []
        for i, t in enumerate(tickers_ordered):
            ann_ret_i = float(mean_r[i] * 252)
            ann_vol_i = float(np.sqrt(cov[i, i] * 252))
            sr_i      = (ann_ret_i - req.risk_free_rate) / ann_vol_i if ann_vol_i > 0 else 0
            individual.append({
                "ticker":     t,
                "return":     round(ann_ret_i, 6),
                "volatility": round(ann_vol_i, 6),
                "sharpe":     round(sr_i, 4),
                "weight":     round(float(weights[tickers_ordered.index(t)]), 4),
            })

        current = {
            "weights":    {t: round(float(w), 4) for t, w in zip(tickers_ordered, weights)},
            "return":     round(ret, 6),
            "volatility": round(vol, 6),
            "sharpe":     round(sharpe, 4),
        }

        # Frontière efficiente
        frontier = generate_random_portfolios(
            mean_r, cov, n_portfolios=600, risk_free_rate=req.risk_free_rate
        )

        # Optimaux
        opt_sharpe = find_optimal_sharpe(
            tickers_ordered, mean_r, cov, req.risk_free_rate
        )
        min_vol = find_min_volatility(
            tickers_ordered, mean_r, cov, req.risk_free_rate
        )

        return current, individual, frontier, opt_sharpe, min_vol

    try:
        current, individual, frontier, opt_sharpe, min_vol = \
            await loop.run_in_executor(None, _run_analysis)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur d'optimisation : {exc}")

    # ── 3. Monte Carlo corrélé ──────────────────────────────────────────────
    S0 = req.initial_investment

    def _run_mc():
        return simulate_portfolio_paths(
            weights.tolist(), mean_r, cov,
            S0, req.horizon_days, req.n_sims,
        )

    try:
        paths = await loop.run_in_executor(None, _run_mc)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur de simulation : {exc}")

    metrics   = compute_metrics(paths, S0)
    fan_chart = compute_fan_chart(paths, max_points=100)
    histogram = compute_histogram(paths[:, -1], n_bins=50)

    elapsed = round((time.perf_counter() - t0) * 1000)

    return {
        "tickers":     tickers_ordered,
        "current_portfolio":  current,
        "optimal_sharpe":     opt_sharpe,
        "min_volatility":     min_vol,
        "individual_assets":  individual,
        "frontier_portfolios": frontier,
        "correlation_matrix": {
            "tickers": tickers_ordered,
            "values":  data["corr_matrix"],
        },
        "fan_chart":  fan_chart,
        "histogram":  histogram,
        "metrics":    metrics,
        "calibration": {
            "n_obs":           data["n_obs"],
            "period":          data["period"],
            "risk_free_rate":  req.risk_free_rate,
            "initial_investment": S0,
            "ann_returns":     {t: round(r, 4) for t, r in zip(tickers_ordered, data["ann_returns"])},
            "ann_vols":        {t: round(v, 4) for t, v in zip(tickers_ordered, data["ann_vols"])},
        },
        "simulation": {
            "n_sims":       req.n_sims,
            "horizon_days": req.horizon_days,
        },
        "computation_time_ms": elapsed,
    }
