import yfinance as yf
from datetime import datetime, timedelta
from typing import Dict, List, Any
import asyncio
from .base_provider import BaseInstrumentProvider


class YFinanceProvider(BaseInstrumentProvider):
    """YFinance implementation of instrument data provider."""

    def __init__(self):
        self.cache = {}
        self.cache_ttl = 300  # 5 minutes

    async def get_quote(self, ticker: str) -> Dict[str, Any]:
        """Get real-time quote from Yahoo Finance."""
        try:
            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(None, self._fetch_quote, ticker)
            return data
        except Exception as e:
            raise ValueError(f"Failed to fetch quote for {ticker}: {str(e)}")

    def _fetch_quote(self, ticker: str) -> Dict[str, Any]:
        """Sync helper to fetch quote."""
        stock = yf.Ticker(ticker)
        info = stock.info

        # Handle different keys Yahoo returns
        price = info.get("currentPrice") or info.get("regularMarketPrice", 0)
        prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose", 0)
        change = price - prev_close
        change_pct = (change / prev_close * 100) if prev_close else 0

        return {
            "ticker": ticker,
            "price": float(price) if price else 0,
            "previous_close": float(prev_close) if prev_close else 0,
            "change": float(change),
            "change_pct": float(change_pct),
            "volume": int(info.get("volume", 0)),
            "market_cap": float(info.get("marketCap", 0)) if info.get("marketCap") else None,
            "timestamp": datetime.now().isoformat(),
        }

    async def get_fundamentals(self, ticker: str) -> Dict[str, Any]:
        """Get fundamentals from Yahoo Finance."""
        try:
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(None, self._fetch_fundamentals, ticker)
            return data
        except Exception as e:
            raise ValueError(f"Failed to fetch fundamentals for {ticker}: {str(e)}")

    def _fetch_fundamentals(self, ticker: str) -> Dict[str, Any]:
        """Sync helper to fetch fundamentals."""
        stock = yf.Ticker(ticker)
        info = stock.info

        # Normalize quoteType → simple type string
        quote_type = info.get("quoteType", "").upper()
        type_map = {
            "EQUITY": "equity", "ETF": "etf", "MUTUALFUND": "mutual_fund",
            "INDEX": "index", "CRYPTOCURRENCY": "crypto",
            "CURRENCY": "forex", "FUTURE": "commodity",
        }
        instrument_type = type_map.get(quote_type, quote_type.lower() or "equity")

        return {
            "ticker": ticker,
            "type": instrument_type,
            "name": info.get("longName", ""),
            "sector": info.get("sector", ""),
            "industry": info.get("industry", ""),
            "market_cap": float(info.get("marketCap", 0)) if info.get("marketCap") else None,
            "pe_ratio": float(info.get("trailingPE", 0)) if info.get("trailingPE") else None,
            "pb_ratio": float(info.get("priceToBook", 0)) if info.get("priceToBook") else None,
            "dividend_yield": float(info.get("dividendYield", 0)) if info.get("dividendYield") else None,
            "roe": float(info.get("returnOnEquity", 0)) if info.get("returnOnEquity") else None,
            "debt_to_equity": float(info.get("debtToEquity", 0)) if info.get("debtToEquity") else None,
            "revenue_ttm": float(info.get("totalRevenue", 0)) if info.get("totalRevenue") else None,
            "gross_margin": float(info.get("grossMargins", 0)) if info.get("grossMargins") else None,
            "eps": float(info.get("trailingEps", 0)) if info.get("trailingEps") else None,
            "52_week_high": float(info.get("fiftyTwoWeekHigh", 0)) if info.get("fiftyTwoWeekHigh") else None,
            "52_week_low": float(info.get("fiftyTwoWeekLow", 0)) if info.get("fiftyTwoWeekLow") else None,
            "beta": float(info.get("beta", 0)) if info.get("beta") else None,
        }

    async def get_news(self, ticker: str) -> List[Dict[str, Any]]:
        """Fetch latest news for a ticker via yfinance."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._fetch_news, ticker)

    def _fetch_news(self, ticker: str) -> List[Dict[str, Any]]:
        try:
            stock = yf.Ticker(ticker)
            raw = stock.news or []
            result = []
            for item in raw[:15]:
                content = item.get("content", {})
                # yfinance >= 0.2.50 wraps inside "content" dict
                if content:
                    title = content.get("title", "")
                    summary = content.get("summary", "")
                    pub_time = content.get("pubDate", "")
                    provider = content.get("provider", {}).get("displayName", "")
                    url = content.get("canonicalUrl", {}).get("url", "") or content.get("clickThroughUrl", {}).get("url", "")
                    thumbnail = None
                    thumb_data = content.get("thumbnail")
                    if thumb_data:
                        resolutions = thumb_data.get("resolutions", [])
                        if resolutions:
                            thumbnail = resolutions[0].get("url")
                else:
                    # Older yfinance format
                    title = item.get("title", "")
                    summary = ""
                    pub_ts = item.get("providerPublishTime")
                    pub_time = datetime.fromtimestamp(pub_ts).isoformat() if pub_ts else ""
                    provider = item.get("publisher", "")
                    url = item.get("link", "")
                    thumbnail = None
                    thumb = item.get("thumbnail", {})
                    if thumb:
                        resolutions = thumb.get("resolutions", [])
                        if resolutions:
                            thumbnail = resolutions[0].get("url")

                if not title or not url:
                    continue

                result.append({
                    "title": title,
                    "summary": summary,
                    "publisher": provider,
                    "url": url,
                    "published_at": pub_time,
                    "thumbnail": thumbnail,
                })
            return result
        except Exception as exc:
            print(f"News fetch failed for {ticker}: {exc}")
            return []

    async def get_etf_holdings(self, ticker: str) -> List[Dict[str, Any]]:
        """Fetch ETF top holdings via yfinance."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._fetch_etf_holdings, ticker)

    def _fetch_etf_holdings(self, ticker: str) -> List[Dict[str, Any]]:
        try:
            t = yf.Ticker(ticker)
            result = []

            # Try modern funds_data API (yfinance >= 0.2.40)
            try:
                fd = t.funds_data
                if fd is not None:
                    holdings_df = getattr(fd, "top_holdings", None)
                    if holdings_df is not None and not holdings_df.empty:
                        for _, row in holdings_df.iterrows():
                            sym = str(row.get("Symbol") or row.get("symbol") or "").strip()
                            name = str(row.get("holdingName") or row.get("name") or sym).strip()
                            pct = row.get("holdingPercent") or row.get("percent") or 0
                            result.append({
                                "ticker": sym,
                                "name": name,
                                "weight_pct": round(float(pct) * 100, 3) if float(pct) < 1 else round(float(pct), 3),
                            })
                        if result:
                            return result
            except Exception:
                pass

            # Fallback: info dict (some ETFs expose holdings there)
            info = t.info
            holdings = info.get("holdings") or []
            for h in holdings:
                sym = h.get("symbol", "")
                name = h.get("holdingName", sym)
                pct = h.get("holdingPercent", 0)
                result.append({
                    "ticker": sym,
                    "name": name,
                    "weight_pct": round(float(pct) * 100, 3) if float(pct) < 1 else round(float(pct), 3),
                })
            return result
        except Exception as exc:
            print(f"ETF holdings fetch failed for {ticker}: {exc}")
            return []

    async def get_historical(
        self,
        ticker: str,
        period: str = "1y",
        interval: str = "1d",
    ) -> List[Dict[str, Any]]:
        """Get historical OHLCV data."""
        try:
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(
                None, self._fetch_historical, ticker, period, interval
            )
            return data
        except Exception as e:
            raise ValueError(f"Failed to fetch historical data for {ticker}: {str(e)}")

    def _fetch_historical(
        self,
        ticker: str,
        period: str = "1y",
        interval: str = "1d",
    ) -> List[Dict[str, Any]]:
        """Sync helper to fetch historical data."""
        stock = yf.Ticker(ticker)
        df = stock.history(period=period, interval=interval)

        if df.empty:
            return []

        result = []
        for idx, row in df.iterrows():
            result.append({
                "date": idx.isoformat(),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]),
            })

        return result

    async def get_intraday(
        self,
        ticker: str,
        interval: str = "1h"
    ) -> List[Dict[str, Any]]:
        """Get intraday data for today."""
        try:
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(
                None, self._fetch_intraday, ticker, interval
            )
            return data
        except Exception as e:
            raise ValueError(f"Failed to fetch intraday data for {ticker}: {str(e)}")

    def _fetch_intraday(
        self,
        ticker: str,
        interval: str = "1h"
    ) -> List[Dict[str, Any]]:
        """Sync helper to fetch intraday data."""
        stock = yf.Ticker(ticker)
        df = stock.history(period="1d", interval=interval)

        if df.empty:
            return []

        result = []
        for idx, row in df.iterrows():
            result.append({
                "date": idx.isoformat(),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]),
            })

        return result

    async def search(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search for instruments (basic implementation).

        Note: YFinance doesn't have a built-in search API, so this is a
        placeholder. In production, use OpenFIGI or similar.
        """
        # TODO: Implement with OpenFIGI or similar service
        return [
            {
                "ticker": query.upper(),
                "name": f"Symbol {query.upper()}",
                "type": "equity",
                "exchange": "UNKNOWN",
                "currency": "USD"
            }
        ]
