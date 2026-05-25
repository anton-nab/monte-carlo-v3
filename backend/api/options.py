"""
api/options.py
--------------
Router FastAPI pour le pricer d'options.

Endpoints :
    POST /api/options/price      — Black-Scholes prix + Greeks
    POST /api/options/iv         — Implied Volatility solver
    GET  /api/options/spot/{ticker} — Prix spot pour auto-remplissage
"""

from __future__ import annotations

import math
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.options import bs_price, bs_greeks, implied_vol_newton
from services.options.options_engine import payoff_series

router = APIRouter(prefix="/api/options", tags=["options"])


# ═════════════════════════════════════════════════════════════════════════════
# Schémas Pydantic
# ═════════════════════════════════════════════════════════════════════════════

class OptionPriceRequest(BaseModel):
    S: float = Field(..., gt=0, description="Prix spot de l'actif sous-jacent")
    K: float = Field(..., gt=0, description="Prix d'exercice (strike)")
    T: float = Field(..., ge=0, description="Temps jusqu'à l'échéance en années (ex. 0.25 = 3 mois)")
    r: float = Field(..., description="Taux sans risque annualisé (ex. 0.045 = 4.5 %)")
    sigma: float = Field(..., gt=0, le=20.0, description="Volatilité implicite annualisée (ex. 0.25 = 25 %)")
    option_type: Literal["call", "put"] = Field("call", description="Type d'option")


class IVRequest(BaseModel):
    S: float = Field(..., gt=0)
    K: float = Field(..., gt=0)
    T: float = Field(..., ge=0)
    r: float = Field(...)
    market_price: float = Field(..., gt=0, description="Prix de marché observé")
    option_type: Literal["call", "put"] = Field("call")


# ═════════════════════════════════════════════════════════════════════════════
# Endpoints
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/price")
async def price_option(req: OptionPriceRequest):
    """
    Calcule le prix théorique Black-Scholes et les 5 Greeks pour une option européenne.

    ### Paramètres
    - **S** : prix spot (ex. 182.50)
    - **K** : strike (ex. 185.00)
    - **T** : temps en années — calculer comme `jours_calendaires / 365`
    - **r** : taux sans risque (ex. 0.045)
    - **sigma** : volatilité implicite (ex. 0.25)
    - **option_type** : "call" ou "put"

    ### Greeks retournés
    | Greek | Unité |
    |-------|-------|
    | delta | Δ$ par +1$ de spot |
    | gamma | Δdelta par +1$ de spot |
    | theta | $/ jour calendaire |
    | vega  | $ par +1% de vol |
    | rho   | $ par +1% de taux |
    """
    try:
        price = bs_price(req.S, req.K, req.T, req.r, req.sigma, req.option_type)
        greeks = bs_greeks(req.S, req.K, req.T, req.r, req.sigma, req.option_type)

        # Intrinsic value + time value
        if req.option_type == "call":
            intrinsic = max(req.S - req.K, 0.0)
        else:
            intrinsic = max(req.K - req.S, 0.0)
        time_value = max(price - intrinsic, 0.0)

        # d1, d2 for display
        if req.T > 0 and req.sigma > 0:
            sqrt_T = math.sqrt(req.T)
            d1 = (math.log(req.S / req.K) + (req.r + 0.5 * req.sigma ** 2) * req.T) / (req.sigma * sqrt_T)
            d2 = d1 - req.sigma * sqrt_T
        else:
            d1 = d2 = 0.0

        # Payoff series for diagram
        payoff = payoff_series(req.S, req.K, price, req.option_type)

        # Break-even at expiry
        if req.option_type == "call":
            breakeven = req.K + price
        else:
            breakeven = req.K - price

        return {
            "price":           round(price, 4),
            "intrinsic_value": round(intrinsic, 4),
            "time_value":      round(time_value, 4),
            "greeks":          greeks,
            "d1":              round(d1, 4),
            "d2":              round(d2, 4),
            "breakeven":       round(breakeven, 4),
            "payoff_series":   payoff,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/iv")
async def compute_iv(req: IVRequest):
    """
    Calcule la volatilité implicite à partir d'un prix de marché observé.

    Utilise Newton-Raphson avec repli sur la bissection si besoin.
    """
    result = implied_vol_newton(
        market_price=req.market_price,
        S=req.S,
        K=req.K,
        T=req.T,
        r=req.r,
        option_type=req.option_type,
    )
    if result["implied_vol"] is None:
        raise HTTPException(status_code=422, detail=result.get("error", "IV computation failed"))
    return result


@router.get("/spot/{ticker}")
async def get_spot(ticker: str):
    """
    Récupère le prix spot actuel d'un actif pour pré-remplir le calculateur.
    Utilise Twelve Data comme source principale, FMP en fallback.
    """
    ticker = ticker.upper().strip()

    # ── Twelve Data quote ─────────────────────────────────────────────────────
    try:
        import os, httpx
        td_key = os.getenv("TWELVE_DATA_API_KEY", "")
        if td_key:
            url = f"https://api.twelvedata.com/quote?symbol={ticker}&apikey={td_key}"
            with httpx.Client(timeout=8) as c:
                r = c.get(url)
            data = r.json()
            if "close" in data and data.get("close") not in (None, ""):
                spot = float(data["close"])
                return {
                    "ticker": ticker,
                    "spot":   round(spot, 4),
                    "name":   data.get("name", ticker),
                    "source": "twelvedata",
                }
    except Exception:
        pass

    # ── FMP fallback ─────────────────────────────────────────────────────────
    try:
        from services.fmp_provider import get_fmp_provider
        fmp = get_fmp_provider()
        rows = await __import__("asyncio").get_event_loop().run_in_executor(
            None, fmp._sync_get,
            f"https://financialmodelingprep.com/api/v3/quote/{ticker}",
            {"apikey": fmp._api_key},
        )
        if rows:
            spot = float(rows[0].get("price", 0))
            if spot > 0:
                return {
                    "ticker": ticker,
                    "spot":   round(spot, 4),
                    "name":   rows[0].get("name", ticker),
                    "source": "fmp",
                }
    except Exception:
        pass

    raise HTTPException(status_code=404, detail=f"Could not fetch spot price for {ticker}")
