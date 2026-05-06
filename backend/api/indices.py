"""
Indices API router — Phase 2.5

Endpoints:
  GET /api/indices/              — list all supported indices (lightweight)
  GET /api/indices/{symbol}      — full index data with constituents + prices
"""

from fastapi import APIRouter, HTTPException
from services.indices import IndicesService

router = APIRouter(prefix="/api/indices", tags=["indices"])
_service = IndicesService()


@router.get("/")
async def list_indices():
    """List all supported global indices with current price level.

    Returns a lightweight summary (no constituents) for all 15+ indices.
    Suitable for the /indices landing page grid.

    Example: GET /api/indices/
    """
    try:
        return await _service.list_indices()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{symbol}")
async def get_index(symbol: str):
    """Get full index data: metadata + constituents + prices + sector aggregation.

    Args:
        symbol: Index symbol, e.g. SP500, NDX, DJI, CAC40, DAX, FTSE100

    Returns full payload:
    {
      "symbol": "SP500",
      "name": "S&P 500",
      "index_price": 5200.0,
      "index_change_pct": 0.45,
      "constituents": [...],    // with price + change_pct per stock
      "sectors": [...]          // sector aggregation
    }

    Note: first call for large indices (S&P 500) may take 10-20s.
    Subsequent calls within 15 min are served from cache.

    Example: GET /api/indices/SP500
    """
    try:
        result = await _service.get_index(symbol.upper())
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
