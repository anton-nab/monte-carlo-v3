"""
api/instruments.py
------------------
Instrument data endpoints.

Provider hierarchy (demo project — yfinance primary everywhere):
  Quotes / Chart / Intraday  → yfinance (primary) | Twelve Data (enhancement)
  Fundamentals (profile)     → yfinance (primary) | Finnhub (fallback)
  Financial statements       → yfinance (primary) | SEC EDGAR (US fallback) | Finnhub (non-US)
  Earnings + Analyst         → yfinance (primary) | Finnhub (fallback)
  News (per ticker)          → yfinance (primary) | Twelve Data | Finnhub
  ETF holdings / sectors     → yfinance (primary) | FMP (secondary)
  Index constituents         → FMP + CSV fallback
"""
import os
import asyncio
from fastapi import APIRouter, HTTPException, Query
from services.instruments import YFinanceProvider, TwelveDataProvider, InstrumentsService
from services.fmp_provider import get_fmp_provider
from services.finnhub_provider import get_finnhub_provider
from services.sec_edgar_provider import get_sec_edgar_provider

router = APIRouter(prefix="/api/instruments", tags=["instruments"])

# ─────────────────────────────────────────────────────────────────────────────
# Provider initialisation
# ─────────────────────────────────────────────────────────────────────────────

_td_key      = os.getenv("TWELVE_DATA_API_KEY", "")
_td_provider = TwelveDataProvider(_td_key) if _td_key else None
_yf_provider = YFinanceProvider()

# yfinance is primary for all chart / fundamental / ETF data (demo project)
_primary = _yf_provider
service  = InstrumentsService(_primary)

_fmp     = get_fmp_provider()       # ETF sectors + index data (secondary)
_finnhub = get_finnhub_provider()   # fundamentals + news global fallback
_sec     = get_sec_edgar_provider() # US financials fallback

# yfinance always allowed — demo project, not a commercial product
_allow_yfinance = True


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _get_fundamentals(ticker: str):
    """
    Fundamentals hierarchy:
      1. yfinance   (primary — free, no key)
      2. Finnhub    (fallback — global coverage)
    """
    try:
        return await _yf_provider.get_fundamentals(ticker)
    except Exception as e:
        print(f"[instruments] yfinance fundamentals failed for {ticker}: {e}")
        try:
            return await _finnhub.get_company_profile(ticker)
        except Exception as fh_err:
            raise ValueError(
                f"All fundamentals sources failed for {ticker}: {fh_err}"
            ) from fh_err


async def _get_news_with_fallback(ticker: str):
    """
    News hierarchy:
      1. yfinance              (primary — free, integrated)
      2. Twelve Data /news     (secondary — richer metadata)
      3. Finnhub /company-news (last resort)
    """
    try:
        result = await _yf_provider.get_news(ticker)
        if result:
            return result
    except Exception as e:
        print(f"[instruments] yfinance news failed for {ticker}: {e}")

    if _td_provider:
        try:
            result = await _td_provider.get_news(ticker)
            if result:
                return result
        except Exception:
            pass

    try:
        result = await _finnhub.get_company_news(ticker)
        return result or []
    except Exception:
        return []


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
    """Get company fundamentals (yfinance primary, Finnhub fallback).

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
    """Get OHLCV chart data (yfinance).

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
    """Get intraday data for today (yfinance).

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

    TD batch if key available, yfinance sequential fallback.
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
    """Get latest news for a ticker (yfinance primary, TD/Finnhub fallback).

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
    """Get full financial statements (IS + BS + CF) + earnings + analyst.

    Hierarchy:
      1. yfinance (IS/BS/CF + earnings + analyst, global)
      2. SEC EDGAR XBRL (US, IS/BS/CF) + Finnhub (earnings/analyst)
      3. Finnhub /stock/financials-reported (non-US fallback)

    Example: GET /api/instruments/financials/AAPL?period=annual
    """
    t = ticker.upper()

    # ── Primary: yfinance ────────────────────────────────────────────────────
    try:
        yf_result = await _yf_provider.get_financials_data(t, period)
        if yf_result.get("income_statement"):
            return yf_result
    except Exception as yf_err:
        print(f"[instruments] yfinance financials failed for {t}: {yf_err}")

    # ── Secondary: SEC EDGAR (IS/BS/CF for US companies) ────────────────────
    sec_result: dict | None = None
    try:
        sec_result = await _sec.get_financials_data(t, period)
    except Exception as sec_err:
        print(f"[instruments] SEC EDGAR failed for {t}: {sec_err}")

    # ── Finnhub (earnings + analyst always; full statements for non-US) ──────
    fh_result: dict | None = None
    try:
        fh_result = await _finnhub.get_financials_data(t, period)
    except Exception as fh_err:
        print(f"[instruments] Finnhub financials failed for {t}: {fh_err}")

    # ── Merge: prefer SEC EDGAR IS/BS/CF; use Finnhub earnings/analyst ───────
    if sec_result and sec_result.get("income_statement"):
        result = sec_result
        if fh_result:
            result["earnings"] = fh_result.get("earnings") or []
            result["analyst"]  = fh_result.get("analyst")  or result["analyst"]
        return result

    if fh_result and fh_result.get("income_statement"):
        return fh_result

    raise HTTPException(
        status_code=502,
        detail=f"No financial data available for {t}",
    )


@router.get("/etf-profile/{ticker}")
async def get_etf_profile(ticker: str):
    """Get ETF sector + country breakdown + asset class weights.

    yfinance primary (sectors + asset classes). FMP for country breakdown.
    Example: GET /api/instruments/etf-profile/SPY
    """
    t = ticker.upper()
    try:
        yf_data, fmp_sectors, fmp_countries = await asyncio.gather(
            _yf_provider.get_etf_profile(t),
            _fmp.get_etf_sectors(t),
            _fmp.get_etf_countries(t),
            return_exceptions=True,
        )
        yf_data       = yf_data       if not isinstance(yf_data,       Exception) else {}
        fmp_sectors   = fmp_sectors   if not isinstance(fmp_sectors,   Exception) else []
        fmp_countries = fmp_countries if not isinstance(fmp_countries, Exception) else []

        # Prefer FMP sectors if richer, otherwise fall back to yfinance
        sectors = fmp_sectors or yf_data.get("sector_weightings", [])

        return {
            "ticker":             t,
            "sector_weightings":  sectors,
            "country_weightings": fmp_countries,
            "asset_classes":      yf_data.get("asset_classes", {}),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/etf-holdings/{ticker}")
async def get_etf_holdings(ticker: str):
    """Get ETF top holdings.

    yfinance primary, FMP secondary.
    Example: GET /api/instruments/etf-holdings/SPY
    """
    t = ticker.upper()
    try:
        # yfinance primary
        yf_result = await _yf_provider.get_etf_holdings(t)
        if yf_result and any(h["weight_pct"] > 0 for h in yf_result):
            print(f"[holdings] {t}: yfinance OK ({len(yf_result)} positions)")
            return yf_result

        # FMP secondary
        fmp_result = await _fmp.get_etf_holdings(t)
        if fmp_result and any(h["weight_pct"] > 0 for h in fmp_result):
            print(f"[holdings] {t}: FMP OK ({len(fmp_result)} positions)")
            return fmp_result

        print(f"[holdings] {t}: no valid weights found")
        return yf_result or fmp_result or []
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
