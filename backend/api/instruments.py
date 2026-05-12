"""
api/instruments.py
------------------
Instrument data endpoints.

Provider hierarchy (Phase 7):
  Primary:  Twelve Data   — quote, chart, intraday, news, search
  Fallback: yfinance       — fundamentals (TD requires paid plan),
                             ETF holdings, ETF profile, financial statements
"""
import os
import asyncio
from fastapi import APIRouter, HTTPException, Query
from services.instruments import YFinanceProvider, TwelveDataProvider, InstrumentsService
from services.fmp_provider import get_fmp_provider

router = APIRouter(prefix="/api/instruments", tags=["instruments"])

# ─────────────────────────────────────────────────────────────────────────────
# Provider initialisation
# ─────────────────────────────────────────────────────────────────────────────

_td_key = os.getenv("TWELVE_DATA_API_KEY", "")
_td_provider = TwelveDataProvider(_td_key) if _td_key else None
_yf_provider = YFinanceProvider()

# Service uses Twelve Data as primary when available, yfinance otherwise
_primary = _td_provider or _yf_provider
service = InstrumentsService(_primary)
_fmp = get_fmp_provider()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _get_fundamentals_with_fallback(ticker: str):
    """Try Twelve Data /statistics, fall back to yfinance on failure."""
    if _td_provider:
        try:
            return await _td_provider.get_fundamentals(ticker)
        except Exception as e:
            print(f"[instruments] TD fundamentals failed for {ticker}: {e}, falling back to yfinance")
    return await _yf_provider.get_fundamentals(ticker)


async def _get_news_with_fallback(ticker: str):
    """Try Twelve Data /news, fall back to yfinance on failure."""
    if _td_provider:
        result = await _td_provider.get_news(ticker)
        if result:
            return result
    return await _yf_provider.get_news(ticker)


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/snapshot/{ticker}")
async def get_instrument_snapshot(ticker: str):
    """Get complete instrument snapshot (quote + fundamentals).

    Example: GET /api/instruments/snapshot/AAPL
    """
    try:
        quote = await _primary.get_quote(ticker)
        fundamentals = await _get_fundamentals_with_fallback(ticker)
        return {
            "ticker":        ticker,
            "quote":         quote,
            "fundamentals":  fundamentals,
            "snapshot_time": quote.get("timestamp", ""),
        }
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
    """Get company fundamentals (TD primary, yfinance fallback).

    Example: GET /api/instruments/fundamentals/GOOGL
    """
    try:
        result = await _get_fundamentals_with_fallback(ticker)
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
        if _td_provider:
            result = await _td_provider.get_batch_quotes(tickers)
        else:
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
    """Get latest news for a ticker (TD primary, yfinance fallback).

    Returns up to 15 news items.
    Example: GET /api/instruments/news/AAPL
    """
    try:
        result = await _get_news_with_fallback(ticker.upper())
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/financials/{ticker}")
async def get_financials(
    ticker: str,
    period: str = Query("annual", description="'annual' or 'quarterly'"),
):
    """Get full financial statements (IS + BS + CF) + earnings history + analyst data.

    Primary: FMP (commercial-friendly, 72 h cache).
    Fallback: yfinance (if FMP returns empty or fails).
    Example: GET /api/instruments/financials/AAPL?period=annual
    """
    t = ticker.upper()
    try:
        result = await _fmp.get_financials_data(t, period)
        # FMP succeeded but returned empty IS — fall back to yfinance
        if result.get("income_statement"):
            return result
        raise ValueError("FMP returned empty income statement")
    except Exception as fmp_err:
        print(f"[instruments] FMP financials failed for {t}: {fmp_err} — falling back to yfinance")
    try:
        return await _yf_provider.get_financials_data(t, period)
    except Exception as yf_err:
        raise HTTPException(status_code=400, detail=str(yf_err))


@router.get("/etf-profile/{ticker}")
async def get_etf_profile(ticker: str):
    """Get ETF sector + country breakdown + asset class weights.

    Combines FMP sector/country data with yfinance asset-class breakdown.
    Example: GET /api/instruments/etf-profile/SPY
    """
    t = ticker.upper()
    try:
        results = await asyncio.gather(
            _fmp.get_etf_sectors(t),
            _fmp.get_etf_countries(t),
            _yf_provider.get_etf_profile(t),
            return_exceptions=True,
        )
        sectors   = results[0] if not isinstance(results[0], Exception) else []
        countries = results[1] if not isinstance(results[1], Exception) else []
        yf_data   = results[2] if not isinstance(results[2], Exception) else {}
        return {
            "ticker":             t,
            "sector_weightings":  sectors or yf_data.get("sector_weightings", []),
            "country_weightings": countries,
            "asset_classes":      yf_data.get("asset_classes", {}),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/etf-holdings/{ticker}")
async def get_etf_holdings(ticker: str):
    """Get ETF top holdings.

    Uses yfinance funds_data (most accurate weights) with FMP fallback.
    Example: GET /api/instruments/etf-holdings/SPY
    """
    t = ticker.upper()
    try:
        yf_result = await _yf_provider.get_etf_holdings(t)
        if yf_result and any(h["weight_pct"] > 0 for h in yf_result):
            print(f"[holdings] {t}: yfinance OK ({len(yf_result)} positions)")
            return yf_result

        fmp_result = await _fmp.get_etf_holdings(t)
        if fmp_result and any(h["weight_pct"] > 0 for h in fmp_result):
            print(f"[holdings] {t}: FMP OK ({len(fmp_result)} positions)")
            return fmp_result

        print(f"[holdings] {t}: no valid weights found")
        return yf_result or fmp_result or []
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
