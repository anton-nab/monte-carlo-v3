"""
services/options/options_engine.py
------------------------------------
Black-Scholes options pricing engine.

Implements:
  - bs_price()         : Call/Put fair value
  - bs_greeks()        : delta, gamma, theta, vega, rho
  - implied_vol_newton() : Newton-Raphson IV solver (bisection fallback)
  - payoff_series()    : P&L at expiry across a price range

Mathematical conventions:
  - T  : time to expiry in YEARS (calendar days / 365.0)
  - r  : annualised continuously-compounded risk-free rate  (0.045 = 4.5 %)
  - sigma : annualised volatility (0.25 = 25 %)
  - theta : returned PER CALENDAR DAY  (raw / 365)
  - vega  : returned PER 1 % CHANGE IN VOL (raw / 100)
  - rho   : returned PER 1 % CHANGE IN RATE (raw / 100)
"""

from __future__ import annotations

import math
from typing import Literal

# scipy.stats.norm is available (scipy already in requirements.txt)
from scipy.stats import norm  # type: ignore

OptionType = Literal["call", "put"]

# ─── Helpers ──────────────────────────────────────────────────────────────────

_SQRT_2PI = math.sqrt(2.0 * math.pi)


def _d1_d2(S: float, K: float, T: float, r: float, sigma: float) -> tuple[float, float]:
    """Compute d1 and d2 for Black-Scholes."""
    sqrt_T = math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)
    d2 = d1 - sigma * sqrt_T
    return d1, d2


def _n_prime(x: float) -> float:
    """Standard normal PDF."""
    return math.exp(-0.5 * x * x) / _SQRT_2PI


# ─── Black-Scholes price ──────────────────────────────────────────────────────

def bs_price(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: OptionType = "call",
) -> float:
    """
    Compute the Black-Scholes theoretical price for a European option.

    Parameters
    ----------
    S : spot price
    K : strike price
    T : time to expiry in years  (e.g. 90 / 365 for 90 days)
    r : risk-free rate annualised (e.g. 0.045 for 4.5 %)
    sigma : implied volatility annualised (e.g. 0.25 for 25 %)
    option_type : "call" or "put"

    Returns
    -------
    Theoretical option price (always >= 0).
    """
    if T <= 0.0:
        # At expiry: return intrinsic value
        if option_type == "call":
            return max(S - K, 0.0)
        else:
            return max(K - S, 0.0)

    if sigma <= 0.0:
        # Zero-vol limit: discounted intrinsic
        fwd = S * math.exp(r * T)
        if option_type == "call":
            return math.exp(-r * T) * max(fwd - K, 0.0)
        else:
            return math.exp(-r * T) * max(K - fwd, 0.0)

    d1, d2 = _d1_d2(S, K, T, r, sigma)

    if option_type == "call":
        return S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
    else:
        return K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)


# ─── Greeks ───────────────────────────────────────────────────────────────────

def bs_greeks(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: OptionType = "call",
) -> dict[str, float]:
    """
    Compute the five primary Greeks for a European option.

    Returns a dict with keys:
      delta  : sensitivity to spot (dimensionless)
      gamma  : second derivative w.r.t. spot (per $ of spot move)
      theta  : time decay PER CALENDAR DAY (negative = value lost per day)
      vega   : sensitivity per 1 % CHANGE in implied vol
      rho    : sensitivity per 1 % CHANGE in risk-free rate
    """
    if T <= 1e-8 or sigma <= 1e-8:
        # Degenerate case — return zeroed greeks except delta
        intrinsic_call = 1.0 if S >= K else 0.0
        delta = intrinsic_call if option_type == "call" else (intrinsic_call - 1.0)
        return {"delta": delta, "gamma": 0.0, "theta": 0.0, "vega": 0.0, "rho": 0.0}

    d1, d2 = _d1_d2(S, K, T, r, sigma)
    sqrt_T = math.sqrt(T)
    disc = math.exp(-r * T)
    n_d1 = _n_prime(d1)

    # Delta
    if option_type == "call":
        delta = norm.cdf(d1)
    else:
        delta = norm.cdf(d1) - 1.0

    # Gamma (same for call and put)
    gamma = n_d1 / (S * sigma * sqrt_T)

    # Theta (raw per year → convert to per calendar day by / 365)
    raw_theta_common = -(S * n_d1 * sigma) / (2.0 * sqrt_T)
    if option_type == "call":
        raw_theta = raw_theta_common - r * K * disc * norm.cdf(d2)
    else:
        raw_theta = raw_theta_common + r * K * disc * norm.cdf(-d2)
    theta = raw_theta / 365.0  # per calendar day

    # Vega (raw per unit of sigma → per 1 % change / 100)
    raw_vega = S * n_d1 * sqrt_T
    vega = raw_vega / 100.0  # per 1 % point

    # Rho (raw per unit of r → per 1 % change / 100)
    if option_type == "call":
        raw_rho = K * T * disc * norm.cdf(d2)
    else:
        raw_rho = -K * T * disc * norm.cdf(-d2)
    rho = raw_rho / 100.0  # per 1 % point

    return {
        "delta": round(delta, 6),
        "gamma": round(gamma, 6),
        "theta": round(theta, 6),
        "vega":  round(vega, 6),
        "rho":   round(rho, 6),
    }


# ─── Implied Volatility solver ────────────────────────────────────────────────

def implied_vol_newton(
    market_price: float,
    S: float,
    K: float,
    T: float,
    r: float,
    option_type: OptionType = "call",
    *,
    tol: float = 1e-6,
    max_iter: int = 100,
) -> dict:
    """
    Recover implied volatility via Newton-Raphson with bisection fallback.

    Returns
    -------
    {
        "implied_vol": float,   # annualised (e.g. 0.224 = 22.4 %)
        "converged": bool,
        "iterations": int,
        "error": str | None,
    }
    """
    if T <= 0:
        return {"implied_vol": None, "converged": False, "iterations": 0, "error": "Option has expired (T ≤ 0)"}

    # Intrinsic-value check: price must be at least the intrinsic
    intrinsic = bs_price(S, K, T, r, 0.0001, option_type)
    if market_price < intrinsic - 1e-4:
        return {
            "implied_vol": None,
            "converged": False,
            "iterations": 0,
            "error": f"Market price ({market_price:.4f}) below intrinsic value ({intrinsic:.4f})",
        }

    # ── Newton-Raphson ────────────────────────────────────────────────────────
    sigma = 0.30  # initial guess 30 %
    for i in range(max_iter):
        price = bs_price(S, K, T, r, sigma, option_type)
        diff  = price - market_price
        if abs(diff) < tol:
            return {"implied_vol": round(sigma, 6), "converged": True, "iterations": i + 1, "error": None}

        # vega raw (per unit sigma)
        if T > 1e-8 and sigma > 1e-8:
            d1, _ = _d1_d2(S, K, T, r, sigma)
            vega_raw = S * _n_prime(d1) * math.sqrt(T)
        else:
            vega_raw = 0.0

        if abs(vega_raw) < 1e-10:
            break  # switch to bisection
        sigma -= diff / vega_raw
        sigma = max(1e-4, min(sigma, 20.0))  # clamp to [0.01%, 2000%]

    # ── Bisection fallback ────────────────────────────────────────────────────
    lo, hi = 1e-4, 10.0
    for i in range(200):
        mid = (lo + hi) / 2.0
        diff = bs_price(S, K, T, r, mid, option_type) - market_price
        if abs(diff) < tol:
            return {"implied_vol": round(mid, 6), "converged": True, "iterations": max_iter + i + 1, "error": None}
        if diff > 0:
            hi = mid
        else:
            lo = mid
        if hi - lo < tol:
            break

    sigma = (lo + hi) / 2.0
    return {
        "implied_vol": round(sigma, 6),
        "converged": False,
        "iterations": max_iter + 200,
        "error": "Convergence not achieved — approximate value",
    }


# ─── Payoff series ────────────────────────────────────────────────────────────

def payoff_series(
    S: float,
    K: float,
    premium: float,
    option_type: OptionType,
    n_points: int = 120,
) -> list[dict]:
    """
    Generate payoff / P&L data for the payoff diagram.

    Returns a list of {price, intrinsic, pnl} dicts covering
    roughly S ± 35 % (or K ± 35 %) so the break-even is always visible.
    """
    center = (S + K) / 2.0
    low  = center * 0.60
    high = center * 1.40

    result = []
    for i in range(n_points + 1):
        price = low + (high - low) * i / n_points
        if option_type == "call":
            intrinsic = max(price - K, 0.0)
        else:
            intrinsic = max(K - price, 0.0)
        pnl = intrinsic - premium
        result.append({
            "price":    round(price, 4),
            "intrinsic": round(intrinsic, 4),
            "pnl":      round(pnl, 4),
        })
    return result
