"""
api/screener.py
---------------
GET /api/screener

Stock screener — filter US equities by sector, exchange, market cap,
beta, and price. Results enriched with live PE + change% via FMP quotes.

Source: FMP /v3/stock-screener + /v3/quote batch
Cache:  30 min per unique filter combination
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from services.fmp_provider import get_fmp_provider

router = APIRouter(prefix="/api/screener", tags=["screener"])

# Valid sectors (FMP naming)
VALID_SECTORS = {
    "Technology", "Healthcare", "Financials", "Consumer Cyclical",
    "Consumer Defensive", "Energy", "Industrials", "Basic Materials",
    "Communication Services", "Real Estate", "Utilities",
}

# Valid exchange short names
VALID_EXCHANGES = {"NASDAQ", "NYSE", "AMEX", "NYSE ARCA"}

# Valid sort fields
VALID_SORT = {"marketCap", "volume", "beta", "pe", "price", "change_pct"}


@router.get("", summary="Stock screener")
async def get_screener(
    sector: str = Query(default="", description="Sector filter (e.g. Technology)"),
    exchange: str = Query(default="", description="Exchange filter (NASDAQ, NYSE, AMEX)"),
    market_cap_min: float = Query(default=0, ge=0, description="Min market cap in billions"),
    market_cap_max: float = Query(default=0, ge=0, description="Max market cap in billions"),
    beta_min: float = Query(default=0, ge=0, description="Min beta"),
    beta_max: float = Query(default=0, ge=0, description="Max beta"),
    price_min: float = Query(default=0, ge=0, description="Min price (USD)"),
    price_max: float = Query(default=0, ge=0, description="Max price (USD)"),
    sort_by: str = Query(default="marketCap", description="Sort field"),
    sort_dir: str = Query(default="desc", description="asc or desc"),
    limit: int = Query(default=50, ge=1, le=200, description="Max results"),
) -> dict[str, Any]:
    """
    Screen US equities by fundamental and price criteria.

    Returns a list of matching stocks with price, change %, market cap,
    sector, industry, beta, P/E ratio, volume, and dividend yield.

    All filters are optional — omitting a filter returns all stocks.
    """
    # Validate sector
    if sector and sector not in VALID_SECTORS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown sector '{sector}'. Valid: {sorted(VALID_SECTORS)}",
        )

    # Validate exchange (allow partial: "NYSE ARCA" still passes if user sends "NYSE")
    fmp_exchange = ""
    if exchange:
        ex = exchange.upper().strip()
        if ex in ("NASDAQ",):
            fmp_exchange = "NASDAQ"
        elif ex in ("NYSE",):
            fmp_exchange = "NYSE"
        elif ex in ("AMEX",):
            fmp_exchange = "AMEX"
        else:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown exchange '{exchange}'. Valid: NASDAQ, NYSE, AMEX",
            )

    fmp = get_fmp_provider()

    try:
        stocks = await fmp.get_screener(
            sector=sector,
            exchange=fmp_exchange,
            market_cap_min=market_cap_min,
            market_cap_max=market_cap_max,
            beta_min=beta_min,
            beta_max=beta_max,
            price_min=price_min,
            price_max=price_max,
            limit=limit,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    # Client-side sort (FMP screener returns unsorted results)
    field_map = {
        "marketCap":  lambda s: s.get("market_cap") or 0,
        "volume":     lambda s: s.get("volume") or 0,
        "beta":       lambda s: s.get("beta") or 0,
        "pe":         lambda s: s.get("pe") or 0,
        "price":      lambda s: s.get("price") or 0,
        "change_pct": lambda s: s.get("change_pct") or 0,
    }
    key_fn = field_map.get(sort_by, field_map["marketCap"])
    reverse = sort_dir.lower() != "asc"
    stocks.sort(key=key_fn, reverse=reverse)

    return {
        "count":       len(stocks),
        "has_fmp_key": bool(fmp._api_key),
        "universe":    "S&P 500",
        "filters": {
            "sector":         sector,
            "exchange":       fmp_exchange,
            "market_cap_min": market_cap_min,
            "market_cap_max": market_cap_max,
            "beta_min":       beta_min,
            "beta_max":       beta_max,
            "price_min":      price_min,
            "price_max":      price_max,
            "sort_by":        sort_by,
            "sort_dir":       sort_dir,
            "limit":          limit,
        },
        "stocks": stocks,
    }
