"""
Indices API router — Phase 2.5+

Endpoints:
  GET /api/indices/              — list all supported indices (lightweight)
  GET /api/indices/{symbol}      — full index data with constituents + prices

Two-phase loading:
  Phase 1 (fast):  GET /api/indices/{symbol}?include_prices=false
                   Returns constituent list immediately (from FMP cache, ~1s).
  Phase 2 (full):  GET /api/indices/{symbol}
                   Returns prices too (yfinance batch, 5-20s first call, cached 15min).
"""

from fastapi import APIRouter, HTTPException, Query
from services.indices import IndicesService

router = APIRouter(prefix="/api/indices", tags=["indices"])
_service = IndicesService()


@router.get("/")
async def list_indices():
    """List all supported global indices with current price level.

    Returns a lightweight summary (no constituents) for all 15+ indices.
    Suitable for the /indices landing page grid.
    """
    try:
        return await _service.list_indices()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{symbol}")
async def get_index(
    symbol: str,
    include_prices: bool = Query(
        True,
        description=(
            "Set to false for fast first load (constituents only, no prices). "
            "Then call again with true (default) to get prices in background."
        ),
    ),
):
    """Get full index data: metadata + constituents (+ prices if include_prices=true).

    Two-phase loading pattern:
      1. GET /api/indices/SP500?include_prices=false  → instant (~1s, cached)
      2. GET /api/indices/SP500                       → with prices (~15s first, cached 15min)

    Args:
        symbol: Index symbol e.g. SP500, NDX, DJI, CAC40, DAX, FTSE100
        include_prices: Whether to fetch current prices for each constituent
    """
    try:
        result = await _service.get_index(symbol.upper(), include_prices=include_prices)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
