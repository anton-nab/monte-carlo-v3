from fastapi import APIRouter, HTTPException, Query
from services.instruments import YFinanceProvider, InstrumentsService
from services.fmp_provider import get_fmp_provider

router = APIRouter(prefix="/api/instruments", tags=["instruments"])

# Initialize services
provider = YFinanceProvider()
service = InstrumentsService(provider)
_fmp = get_fmp_provider()


@router.get("/snapshot/{ticker}")
async def get_instrument_snapshot(ticker: str):
    """Get complete instrument snapshot (quote + fundamentals).

    Example: GET /api/instruments/snapshot/AAPL
    """
    try:
        result = await service.get_instrument_snapshot(ticker)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/quote/{ticker}")
async def get_quote(ticker: str):
    """Get real-time quote for an instrument.

    Example: GET /api/instruments/quote/MSFT
    """
    try:
        result = await service.get_quote_simple(ticker)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/fundamentals/{ticker}")
async def get_fundamentals(ticker: str):
    """Get company fundamentals.

    Example: GET /api/instruments/fundamentals/GOOGL
    """
    try:
        result = await provider.get_fundamentals(ticker)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/chart/{ticker}")
async def get_chart(
    ticker: str,
    period: str = Query("1y", description="Period: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max"),
    interval: str = Query("1d", description="Interval: 1m, 5m, 15m, 30m, 60m, 1h, 1d, 1wk, 1mo, 3mo"),
):
    """Get OHLCV chart data.

    Example: GET /api/instruments/chart/TSLA?period=6mo&interval=1d
    """
    try:
        result = await service.get_chart_data(ticker, period, interval)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/intraday/{ticker}")
async def get_intraday(
    ticker: str,
    interval: str = Query("1h", description="Interval: 1m, 5m, 15m, 30m, 60m, 1h"),
):
    """Get intraday data for today.

    Example: GET /api/instruments/intraday/AAPL?interval=5m
    """
    try:
        result = await service.get_intraday_chart(ticker, interval)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/batch-quotes")
async def batch_quotes(tickers: list[str]):
    """Get quotes for multiple instruments.

    Example: POST /api/instruments/batch-quotes
    Body: ["AAPL", "MSFT", "GOOGL"]
    """
    try:
        result = await service.batch_get_quotes(tickers)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/price/{ticker}")
async def get_price(ticker: str):
    """Get current price only (lightweight).

    Example: GET /api/instruments/price/BTC-USD
    """
    try:
        price = await service.get_price(ticker)
        return {"ticker": ticker, "price": price}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/news/{ticker}")
async def get_news(ticker: str):
    """Get latest news for a ticker.

    Returns up to 15 news items from Yahoo Finance.
    Example: GET /api/instruments/news/AAPL
    """
    try:
        result = await provider.get_news(ticker.upper())
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/etf-holdings/{ticker}")
async def get_etf_holdings(ticker: str):
    """Get ETF top holdings.

    Tries FMP API first (reliable, 24h cache), falls back to yfinance.
    Returns top holdings with weight % for ETFs (SPY, QQQ, VTI, etc.)

    Example: GET /api/instruments/etf-holdings/SPY
    """
    t = ticker.upper()
    try:
        # Primary: FMP API (accurate, free tier, 24h cache)
        result = await _fmp.get_etf_holdings(t)
        if result:
            return result
    except Exception as exc:
        print(f"FMP ETF holdings failed for {t}: {exc}")

    # Fallback: yfinance
    try:
        result = await provider.get_etf_holdings(t)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
