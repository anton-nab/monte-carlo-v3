"""
services/backtesting/backtest_engine.py
---------------------------------------
Rolling-window Monte Carlo backtesting engine (ported + extended from V1).

Methodology
-----------
Non-overlapping windows, stride = horizon_days:

  For each window w:
    1. Calibrate mu / sigma on prices[w*h : w*h + lookback]
    2. Run n_sims Monte Carlo paths over the next horizon_days
    3. Record predicted VaR 95%, ES 95%, P(loss)
    4. Record realized return over the same horizon
    5. Flag "breach" if realized < predicted VaR

Aggregate metrics
-----------------
  Equity curve (compounded realized returns), Sharpe, Sortino, max drawdown,
  Calmar, hit rate, VaR coverage (calibration quality).
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

from services.simulation.simulation_engine import (
    run_gbm,
    run_merton,
    run_heston,
    run_garch,
)

TRADING_DAYS = 252


# ─────────────────────────────────────────────────────────────────────────────
# Data fetch
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_prices(ticker: str, period: str) -> pd.Series:
    """Adjusted close prices via yfinance — DatetimeIndex, ascending."""
    t  = yf.Ticker(ticker)
    df = t.history(period=period, auto_adjust=True)
    if df.empty:
        raise ValueError(f"yfinance returned no data for '{ticker}'")
    return df["Close"].dropna().sort_index()


# ─────────────────────────────────────────────────────────────────────────────
# Per-window simulation
# ─────────────────────────────────────────────────────────────────────────────

def _simulate_window(
    S0: float,
    mu: float,
    sigma: float,
    log_returns_window: np.ndarray,
    horizon_days: int,
    n_sims: int,
    model: str,
    seed: int | None,
) -> np.ndarray:
    """Run one forward simulation. Returns paths (n_sims, horizon_days+1)."""
    if model == "gbm":
        return run_gbm(S0, mu, sigma, horizon_days, n_sims, seed=seed)
    elif model == "merton":
        return run_merton(S0, mu, sigma, horizon_days, n_sims, seed=seed)
    elif model == "heston":
        v0    = sigma ** 2
        theta = sigma ** 2
        return run_heston(S0, mu, v0, 2.0, theta, 0.3, -0.7,
                          horizon_days, n_sims, seed=seed)
    elif model == "garch":
        return run_garch(S0, log_returns_window.tolist(), horizon_days, n_sims)
    else:
        raise ValueError(f"Modèle inconnu : {model}")


# ─────────────────────────────────────────────────────────────────────────────
# Aggregate metrics
# ─────────────────────────────────────────────────────────────────────────────

def _aggregate_metrics(
    real_returns: np.ndarray,
    pred_var_95:  np.ndarray,
    pred_es_95:   np.ndarray,
    horizon_days: int,
) -> dict[str, Any]:
    n = len(real_returns)
    if n == 0:
        raise ValueError("Aucune fenêtre calculée")

    # ── Equity curve ──────────────────────────────────────────────────────────
    cum         = np.cumprod(1.0 + real_returns)
    total_return = float(cum[-1] - 1.0)

    # Annualisation (fenêtres non-chevauchantes de horizon_days)
    total_td         = n * horizon_days
    ann_return       = float(cum[-1] ** (TRADING_DAYS / total_td) - 1.0)
    ann_vol          = float(real_returns.std(ddof=1) * np.sqrt(TRADING_DAYS / horizon_days))

    # ── Sharpe (rf = 0) ───────────────────────────────────────────────────────
    sharpe = ann_return / ann_vol if ann_vol > 0 else 0.0

    # ── Sortino ───────────────────────────────────────────────────────────────
    neg = real_returns[real_returns < 0]
    ds  = float(neg.std(ddof=1) * np.sqrt(TRADING_DAYS / horizon_days)) if len(neg) > 1 else ann_vol
    sortino = ann_return / ds if ds > 0 else 0.0

    # ── Max drawdown ──────────────────────────────────────────────────────────
    peak        = np.maximum.accumulate(cum)
    drawdowns   = (cum - peak) / peak
    max_drawdown = float(drawdowns.min())

    # ── Calmar ────────────────────────────────────────────────────────────────
    calmar = ann_return / abs(max_drawdown) if max_drawdown != 0 else 0.0

    # ── Hit rate ──────────────────────────────────────────────────────────────
    hit_rate = float(np.mean(real_returns > 0))

    # ── VaR calibration (coverage rate — ideal: 5%) ───────────────────────────
    coverage_95     = float(np.mean(real_returns < pred_var_95))
    miscalibration  = abs(coverage_95 - 0.05)
    well_calibrated = miscalibration < 0.025

    return {
        "n_windows":          n,
        "total_return":       round(total_return, 4),
        "annualized_return":  round(ann_return,   4),
        "annualized_vol":     round(ann_vol,       4),
        "sharpe":             round(sharpe,         3),
        "sortino":            round(sortino,        3),
        "max_drawdown":       round(max_drawdown,   4),
        "calmar":             round(calmar,          3),
        "hit_rate":           round(hit_rate,        3),
        "coverage_95":        round(coverage_95,     4),
        "miscalibration":     round(miscalibration,  4),
        "is_well_calibrated": well_calibrated,
        "mean_pred_var_95":   round(float(np.mean(pred_var_95)), 4),
        "mean_pred_es_95":    round(float(np.mean(pred_es_95)),  4),
        "bias":               round(float(np.mean(real_returns) - np.mean(pred_var_95)), 4),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def run_backtest(
    ticker:        str,
    period:        str = "5y",
    lookback_days: int = 252,
    horizon_days:  int = 20,
    n_sims:        int = 500,
    model:         str = "gbm",
    seed:          int = 42,
) -> dict[str, Any]:
    """
    Rolling-window Monte Carlo backtesting.

    Parameters
    ----------
    ticker        : Yahoo Finance symbol (e.g. 'AAPL', '^GSPC', 'BTC-USD').
    period        : Historical data window ('3y', '5y', '10y', 'max').
    lookback_days : Calibration window length (trading days).
    horizon_days  : Prediction horizon (trading days).
    n_sims        : Monte Carlo paths per window.
    model         : 'gbm' | 'merton' | 'heston' | 'garch'.
    seed          : Base RNG seed (window w uses seed + w).

    Returns
    -------
    dict with keys:
        ticker, model, period, lookback_days, horizon_days, n_sims,
        n_windows, calibration, windows, metrics, computation_time_ms.
    """
    t0     = time.perf_counter()
    ticker = ticker.upper().strip()

    # ── Fetch ─────────────────────────────────────────────────────────────────
    prices = _fetch_prices(ticker, period)

    min_required = lookback_days + horizon_days * 2
    if len(prices) < min_required:
        raise ValueError(
            f"Données insuffisantes pour '{ticker}': {len(prices)} jours disponibles, "
            f"minimum requis = {min_required} "
            f"(lookback {lookback_days} + 2 × horizon {horizon_days})."
        )

    dates   = prices.index
    n_max   = (len(prices) - lookback_days) // horizon_days

    windows_out:     list[dict]  = []
    real_list:       list[float] = []
    pred_var_list:   list[float] = []
    pred_es_list:    list[float] = []
    cum_return = 0.0

    for w in range(n_max):
        start_idx = w * horizon_days
        end_idx   = start_idx + lookback_days
        fut_idx   = end_idx   + horizon_days

        if fut_idx > len(prices):
            break

        # Calibrate on training window
        hist   = prices.iloc[start_idx:end_idx].values.astype(float)
        lr     = np.diff(np.log(hist))
        mu     = float(lr.mean() * TRADING_DAYS)
        sigma  = max(float(lr.std(ddof=1) * np.sqrt(TRADING_DAYS)), 0.001)
        S0     = float(prices.iloc[end_idx])

        # Simulate forward
        paths = _simulate_window(
            S0, mu, sigma, lr,
            horizon_days, n_sims, model,
            seed + w if seed is not None else None,
        )

        # Predicted risk metrics
        final_ret = (paths[:, -1] - S0) / S0
        var_95    = float(np.percentile(final_ret, 5))
        below_var = final_ret[final_ret <= var_95]
        es_95     = float(np.mean(below_var)) if len(below_var) > 0 else var_95
        prob_loss = float(np.mean(final_ret < 0))

        # Realized
        real_price  = float(prices.iloc[fut_idx])
        real_return = (real_price - S0) / S0
        cum_return  = (1.0 + cum_return) * (1.0 + real_return) - 1.0

        date_str = str(dates[end_idx])[:10] if end_idx < len(dates) else ""

        windows_out.append({
            "date":              date_str,
            "real_return":       round(real_return,  4),
            "pred_var_95":       round(var_95,        4),
            "pred_es_95":        round(es_95,          4),
            "pred_prob_loss":    round(prob_loss,      3),
            "breach":            bool(real_return < var_95),
            "cumulative_return": round(cum_return,     4),
        })
        real_list.append(real_return)
        pred_var_list.append(var_95)
        pred_es_list.append(es_95)

    real_arr = np.array(real_list)
    var_arr  = np.array(pred_var_list)
    es_arr   = np.array(pred_es_list)

    metrics = _aggregate_metrics(real_arr, var_arr, es_arr, horizon_days)

    # Full-period calibration summary (for display purposes)
    all_lr     = np.diff(np.log(prices.values.astype(float)))
    mu_full    = float(all_lr.mean() * TRADING_DAYS)
    sigma_full = max(float(all_lr.std(ddof=1) * np.sqrt(TRADING_DAYS)), 0.001)

    return {
        "ticker":         ticker,
        "model":          model,
        "period":         period,
        "lookback_days":  lookback_days,
        "horizon_days":   horizon_days,
        "n_sims":         n_sims,
        "n_windows":      len(windows_out),
        "calibration": {
            "mu":        round(mu_full,    6),
            "sigma":     round(sigma_full, 6),
            "mu_pct":    round(mu_full    * 100, 2),
            "sigma_pct": round(sigma_full * 100, 2),
            "S0":        round(float(prices.iloc[-1]), 4),
            "n_obs":     len(prices),
        },
        "windows":             windows_out,
        "metrics":             metrics,
        "computation_time_ms": round((time.perf_counter() - t0) * 1000),
    }
