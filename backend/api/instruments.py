"""
api/instruments.py
------------------
Instrument data endpoints.

Provider hierarchy (Phase 8.6):
  Primary:  Twelve Data   — quote, chart, intraday, news
  Primary:  FMP           — fundamentals (profile + ratios), financials, ETF data
  Fallback: yfinance       — ONLY when no commercial API key is set (local dev)

yfinance (Yahoo Finance) ToS forbids commercial use.
All production paths must go through TD or FMP.
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
# Commercial API guard
# yfinance is only allowed when no commercial key is set (i.e. local dev).
# In production (TD key present) all paths must use TD / FMP.
# ─────────────────────────────────────────────────────────────────────────────

_allow_yfinance = not bool(_td_key)   # True only in local dev without TD key


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _get_fundamentals(ticker: str):
    """
    Fundamentals hierarchy (Phase 8.6):
      1. FMP /profile + /ratios-ttm  (commercial OK, free tier)
      2. yfinance                    (local dev only — no commercial key)
    """
    fmp_key = os.getenv("FMP_API_KEY", "")
    if fmp_key:
        try:
            return await _fmp.get_company_profile(ticker)
        except Exception as e:
            print(f"[instruments] FMP profile failed for {ticker}: {e}")
            if not _allow_yfinance:
                raise
    if _allow_yfinance:
        return await _yf_provider.get_fundamentals(ticker)
    raise ValueError(f"No fundamentals data available for {ticker} (no commercial API key configured)")


async def _get_news_with_fallback(ticker: str):
    """
    News hierarchy:
      1. Twelve Data /news           (commercial OK, free tier)
      2. yfinance                    (local dev only)
    """
    if _td_provider:
        result = await _td_provider.get_news(ticker)
        if result:
            return result
    if _allow_yfinance:
        return await _yf_provider.get_news(ticker)
    return []   # TD returned empty — return nothing rather than hit yfinance in prod


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
        fundamentals = await _get_fundamentals(ticker)
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
    """Get company fundamentals (FMP profile+ratios primary, yfinance local-dev fallback).

    Example: GET /api/instruments/fundamentals/GOOGL
    """
    try:
        result = await _get_fundamentals(ticker)
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
    Fallback: yfinance — local dev only (no commercial API key configured).
    Example: GET /api/instruments/financials/AAPL?period=annual
    """
    t = ticker.upper()
    try:
        result = await _fmp.get_financials_data(t, period)
        if result.get("income_statement"):
            return result
        raise ValueError("FMP returned empty income statement")
    except Exception as fmp_err:
        if not _allow_yfinance:
            raise HTTPException(status_code=502, detail=f"Financial data unavailable: {fmp_err}")
        print(f"[instruments] FMP financials failed for {t}: {fmp_err} — falling back to yfinance (local dev)")
    try:
        return await _yf_provider.get_financials_data(t, period)
    except Exception as yf_err:
        raise HTTPException(status_code=400, detail=str(yf_err))


@router.get("/etf-profile/{ticker}")
async def get_etf_profile(ticker: str):
    """Get ETF sector + country breakdown + asset class weights.

    FMP primary (sectors + countries). yfinance asset-class breakdown
    is only fetched in local dev (no commercial API key).
    Example: GET /api/instruments/etf-profile/SPY
    """
    t = ticker.upper()
    try:
        if _allow_yfinance:
            results = await asyncio.gather(
                _fmp.get_etf_sectors(t),
                _fmp.get_etf_countries(t),
                _yf_provider.get_etf_profile(t),
                return_exceptions=True,
            )
            sectors   = results[0] if not isinstance(results[0], Exception) else []
            countries = results[1] if not isinstance(results[1], Exception) else []
            yf_data   = results[2] if not isinstance(results[2], Exception) else {}
        else:
            results = await asyncio.gather(
                _fmp.get_etf_sectors(t),
                _fmp.get_etf_countries(t),
                return_exceptions=True,
            )
            sectors   = results[0] if not isinstance(results[0], Exception) else []
            countries = results[1] if not isinstance(results[1], Exception) else []
            yf_data   = {}
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

    FMP primary (commercial OK). yfinance fallback — local dev only.
    Example: GET /api/instruments/etf-holdings/SPY
    """
    t = ticker.upper()
    try:
        fmp_result = await _fmp.get_etf_holdings(t)
        if fmp_result and any(h["weight_pct"] > 0 for h in fmp_result):
            print(f"[holdings] {t}: FMP OK ({len(fmp_result)} positions)")
            return fmp_result

        if _allow_yfinance:
            yf_result = await _yf_provider.get_etf_holdings(t)
            if yf_result:
                print(f"[holdings] {t}: yfinance fallback ({len(yf_result)} positions)")
                return yf_result

        print(f"[holdings] {t}: no valid weights found")
        return fmp_result or []
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
