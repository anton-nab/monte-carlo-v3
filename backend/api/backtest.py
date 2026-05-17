"""
api/backtest.py
---------------
POST /api/backtest — Rolling-window Monte Carlo backtesting.

Delegates heavy computation to services/backtesting/backtest_engine.py
via asyncio.run_in_executor() so the event loop stays free.
"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.backtesting import run_backtest

router = APIRouter(prefix="/api/backtest", tags=["backtest"])


# ─────────────────────────────────────────────────────────────────────────────
# Request / Response schemas
# ─────────────────────────────────────────────────────────────────────────────

class BacktestRequest(BaseModel):
    ticker:        str = Field(...,   min_length=1, max_length=20,
                               description="Yahoo Finance symbol (e.g. 'AAPL', 'BTC-USD')")
    period:        str = Field("5y", description="Historical data window: '3y'|'5y'|'10y'|'max'")
    lookback_days: int = Field(252,  ge=60,  le=504,
                               description="Calibration window length (trading days)")
    horizon_days:  int = Field(20,   ge=5,   le=126,
                               description="Prediction horizon (trading days)")
    n_sims:        int = Field(500,  ge=100, le=5000,
                               description="Monte Carlo paths per window")
    model: Literal["gbm", "merton", "heston", "garch"] = Field(
        "gbm", description="Simulation model"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "",
    summary="Rolling-window Monte Carlo backtest",
    response_description="Backtest result with per-window data and aggregate metrics",
)
async def run_backtest_endpoint(req: BacktestRequest):
    """
    Run a rolling-window Monte Carlo backtest on any Yahoo Finance ticker.

    - Calibrates µ / σ on each lookback window
    - Simulates `n_sims` Monte Carlo paths forward `horizon_days`
    - Records predicted VaR 95%, ES 95%, P(loss) vs realised return
    - Returns per-window data + aggregate performance & calibration metrics

    **Computation time**: ~1-5 s depending on n_sims and n_windows.
    CPU-bound work runs in a thread pool to keep the async loop free.
    """
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: run_backtest(
                ticker        = req.ticker,
                period        = req.period,
                lookback_days = req.lookback_days,
                horizon_days  = req.horizon_days,
                n_sims        = req.n_sims,
                model         = req.model,
            ),
        )
        return result

    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Backtest error for '{req.ticker}': {exc}",
        )
