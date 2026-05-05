from fastapi import APIRouter, Query, HTTPException
from services.search import SearchService

router = APIRouter(prefix="/api/search", tags=["search"])

# Initialize search service
search_service = SearchService()


@router.get("/")
async def search(
    q: str = Query(..., min_length=1, max_length=100, description="Search query (ticker, ISIN, or name)"),
    limit: int = Query(10, ge=1, le=50, description="Max results"),
):
    """Universal search: ticker, ISIN, or company name.

    Examples:
    - GET /api/search?q=AAPL → Apple Inc.
    - GET /api/search?q=US0378331005 → Apple Inc. (by ISIN)
    - GET /api/search?q=apple → Apple Inc. (by name)
    """
    try:
        results = await search_service.search(q, limit=limit)
        return {
            "query": q,
            "results": results,
            "count": len(results),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/autocomplete")
async def autocomplete(
    q: str = Query(..., min_length=1, max_length=50, description="Partial query for autocomplete"),
    limit: int = Query(10, ge=1, le=20, description="Max suggestions"),
):
    """Autocomplete suggestions (instant, local search).

    Example: GET /api/search/autocomplete?q=appl
    Returns: [AAPL, etc.]
    """
    try:
        results = await search_service.autocomplete(q, limit=limit)
        return {
            "query": q,
            "suggestions": results,
            "count": len(results),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/by-ticker/{ticker}")
async def search_by_ticker(
    ticker: str,
    limit: int = 10,
):
    """Search by ticker symbol.

    Example: GET /api/search/by-ticker/MSFT
    """
    try:
        results = await search_service.search_by_ticker(ticker, limit=limit)
        return {
            "type": "ticker",
            "query": ticker,
            "results": results,
            "count": len(results),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/by-isin/{isin}")
async def search_by_isin(
    isin: str,
    limit: int = 10,
):
    """Search by ISIN code.

    Example: GET /api/search/by-isin/US0378331005 (Apple)
    """
    try:
        results = await search_service.search_by_isin(isin, limit=limit)
        return {
            "type": "isin",
            "query": isin,
            "results": results,
            "count": len(results),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/by-name/{name}")
async def search_by_name(
    name: str,
    limit: int = 10,
):
    """Search by company or instrument name.

    Example: GET /api/search/by-name/amazon
    """
    try:
        results = await search_service.search_by_name(name, limit=limit)
        return {
            "type": "name",
            "query": name,
            "results": results,
            "count": len(results),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/resolve/isin-to-ticker/{isin}")
async def isin_to_ticker(isin: str):
    """Quick resolve: ISIN → ticker.

    Example: GET /api/search/resolve/isin-to-ticker/US0378331005
    Returns: AAPL
    """
    try:
        ticker = await search_service.get_ticker_by_isin(isin)
        if not ticker:
            raise HTTPException(status_code=404, detail=f"ISIN {isin} not found")
        return {
            "isin": isin,
            "ticker": ticker,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/resolve/ticker-to-isin/{ticker}")
async def ticker_to_isin(ticker: str):
    """Quick resolve: ticker → ISIN.

    Example: GET /api/search/resolve/ticker-to-isin/AAPL
    Returns: US0378331005
    """
    try:
        isin = await search_service.get_isin_by_ticker(ticker)
        if not isin:
            raise HTTPException(status_code=404, detail=f"Ticker {ticker} not found")
        return {
            "ticker": ticker,
            "isin": isin,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
