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
        """Sync helper to fetch quote.

        Uses fast_info as primary (works for ETFs and equities alike),
        falls back to info dict for any missing fields.
        """
        stock = yf.Ticker(ticker)

        # fast_info is lightweight and works for all asset types
        price = prev_close = volume = market_cap = 0.0
        try:
            fi = stock.fast_info
            price      = float(getattr(fi, "last_price",           0) or 0)
            prev_close = float(getattr(fi, "previous_close",       0) or 0)
            volume     = int(  getattr(fi, "three_month_average_volume", 0) or 0)
            market_cap = float(getattr(fi, "market_cap",           0) or 0)
        except Exception:
            pass

        # Fallback to info for any zeros (some fields only in info)
        if not price:
            try:
                info = stock.info or {}
                price      = float(info.get("currentPrice") or info.get("regularMarketPrice", 0) or 0)
                prev_close = float(info.get("previousClose") or info.get("regularMarketPreviousClose", 0) or 0)
                volume     = int(info.get("volume", 0) or 0)
                market_cap = float(info.get("marketCap", 0) or 0)
            except Exception:
                pass

        change     = price - prev_close
        change_pct = (change / prev_close * 100) if prev_close else 0

        return {
            "ticker":         ticker,
            "price":          price,
            "previous_close": prev_close,
            "change":         change,
            "change_pct":     change_pct,
            "volume":         volume,
            "market_cap":     market_cap or None,
            "timestamp":      datetime.now().isoformat(),
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
        """Sync helper to fetch fundamentals.

        For ETFs, Yahoo Finance's quoteSummary endpoint returns 404 for
        stock-specific modules (assetProfile, defaultKeyStatistics, etc.).
        We fall back to fast_info + basic ETF fields in that case.
        """
        stock = yf.Ticker(ticker)

        # Try full info — works for equities; may 404 for ETFs
        info: dict = {}
        try:
            info = stock.info or {}
        except Exception as exc:
            print(f"[YF] {ticker} info failed ({exc}), trying fast_info")
            try:
                fi = stock.fast_info
                # fast_info is a SimpleNamespace-like object
                info = {
                    "quoteType":            getattr(fi, "quote_type",        "ETF"),
                    "longName":             getattr(fi, "regular_market_name", ticker),
                    "marketCap":            getattr(fi, "market_cap",         None),
                    "fiftyTwoWeekHigh":     getattr(fi, "year_high",          None),
                    "fiftyTwoWeekLow":      getattr(fi, "year_low",           None),
                    "dividendYield":        getattr(fi, "last_dividend_value", None),
                }
            except Exception as exc2:
                print(f"[YF] {ticker} fast_info also failed: {exc2}")
                info = {"quoteType": "ETF", "longName": ticker}

        # Normalize quoteType → simple type string
        quote_type = str(info.get("quoteType", "")).upper()
        type_map = {
            "EQUITY": "equity", "ETF": "etf", "MUTUALFUND": "mutual_fund",
            "INDEX": "index", "CRYPTOCURRENCY": "crypto",
            "CURRENCY": "forex", "FUTURE": "commodity",
        }
        instrument_type = type_map.get(quote_type, quote_type.lower() or "equity")

        def _f(key: str):
            v = info.get(key)
            try:
                return float(v) if v else None
            except (TypeError, ValueError):
                return None

        return {
            "ticker": ticker,
            "type": instrument_type,
            "name": info.get("longName") or info.get("shortName", ""),
            "sector": info.get("sector", ""),
            "industry": info.get("industry", ""),
            "market_cap":      _f("marketCap"),
            "pe_ratio":        _f("trailingPE"),
            "pb_ratio":        _f("priceToBook"),
            "dividend_yield":  _f("dividendYield"),
            "roe":             _f("returnOnEquity"),
            "debt_to_equity":  _f("debtToEquity"),
            "revenue_ttm":     _f("totalRevenue"),
            "gross_margin":    _f("grossMargins"),
            "eps":             _f("trailingEps"),
            "52_week_high":    _f("fiftyTwoWeekHigh"),
            "52_week_low":     _f("fiftyTwoWeekLow"),
            "beta":            _f("beta"),
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

            # ── Path 1: funds_data.top_holdings (yfinance >= 0.2.36) ──
            try:
                fd = t.funds_data
                if fd is not None:
                    holdings_df = getattr(fd, "top_holdings", None)
                    if holdings_df is not None and not holdings_df.empty:
                        # Flatten index so Symbol becomes a regular column
                        df = holdings_df.reset_index()
                        # Log actual columns for debugging
                        print(f"[YF] {ticker} top_holdings columns: {list(df.columns)}, index: {df.index.name}")
                        for _, row in df.iterrows():
                            # Handle all known column-name variants (yfinance changes these)
                            sym = None
                            for key in ("Symbol", "symbol", "Ticker", "ticker"):
                                val = row.get(key)
                                if val and str(val).strip() not in ("", "nan", "None"):
                                    sym = str(val).strip()
                                    break
                            if not sym:
                                continue
                            name = None
                            for key in ("holdingName", "longName", "name", "Name"):
                                val = row.get(key)
                                if val and str(val).strip() not in ("", "nan", "None"):
                                    name = str(val).strip()
                                    break
                            name = name or sym
                            pct_raw = None
                            for key in ("Holding Percent", "holdingPercent", "percent", "Percent", "Weight", "weight"):
                                val = row.get(key)
                                if val is not None and str(val).strip() not in ("", "nan", "None"):
                                    pct_raw = val
                                    break
                            try:
                                pct = float(pct_raw) if pct_raw is not None else 0.0
                                weight_pct = round(pct * 100, 3) if pct <= 1 else round(pct, 3)
                            except (TypeError, ValueError):
                                weight_pct = 0.0
                            result.append({"ticker": sym, "name": name, "weight_pct": weight_pct})
                        if result:
                            print(f"[YF] {ticker} top_holdings: {len(result)} rows, sample weight={result[0]['weight_pct']}")
                            return result
            except Exception as exc:
                print(f"[YF] funds_data.top_holdings failed for {ticker}: {exc}")

            # ── Path 2: info dict (older yfinance / some ETFs) ──
            try:
                info = t.info
                holdings = info.get("holdings") or []
                print(f"[YF] {ticker} info holdings: {len(holdings)} rows")
                for h in holdings:
                    sym = h.get("symbol") or h.get("ticker") or ""
                    if not sym:
                        continue
                    name = h.get("holdingName") or h.get("name") or sym
                    pct_raw = h.get("holdingPercent") or h.get("percent") or 0
                    try:
                        pct_f = float(pct_raw)
                        weight_pct = round(pct_f * 100, 3) if pct_f <= 1 else round(pct_f, 3)
                    except (TypeError, ValueError):
                        weight_pct = 0.0
                    result.append({"ticker": str(sym), "name": str(name), "weight_pct": weight_pct})
            except Exception as exc:
                print(f"[YF] info holdings failed for {ticker}: {exc}")

            return result
        except Exception as exc:
            print(f"[YF] ETF holdings fetch failed for {ticker}: {exc}")
            return []

    async def get_etf_profile(self, ticker: str) -> Dict[str, Any]:
        """Asset classes + sector weightings from yfinance funds_data (fallback source)."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._fetch_etf_profile, ticker)

    def _fetch_etf_profile(self, ticker: str) -> Dict[str, Any]:
        result: Dict[str, Any] = {"asset_classes": {}, "sector_weightings": []}
        try:
            t = yf.Ticker(ticker)
            fd = t.funds_data
            if fd is None:
                return result
            # Asset classes (stock / bond / cash / other)
            try:
                ac = getattr(fd, "asset_classes", None)
                if ac and isinstance(ac, dict):
                    result["asset_classes"] = {
                        k: round(float(v) * 100, 2) if v is not None else 0.0
                        for k, v in ac.items()
                    }
            except Exception as e:
                print(f"[YF] asset_classes failed {ticker}: {e}")
            # Sector weightings (fallback if FMP empty)
            try:
                sw = getattr(fd, "sector_weightings", None)
                if sw and isinstance(sw, dict):
                    for sector, weight in sw.items():
                        try:
                            w = float(weight)
                            if w > 0:
                                result["sector_weightings"].append({
                                    "sector": sector,
                                    "weight_pct": round(w * 100, 2),
                                })
                        except (TypeError, ValueError):
                            pass
                    result["sector_weightings"].sort(
                        key=lambda x: x["weight_pct"], reverse=True
                    )
            except Exception as e:
                print(f"[YF] sector_weightings failed {ticker}: {e}")
        except Exception as e:
            print(f"[YF] etf_profile failed {ticker}: {e}")
        return result

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

    # ─────────────────────────────────────────────────────────────────────────
    # Phase 6 — Financial Statements + Earnings + Analyst
    # ─────────────────────────────────────────────────────────────────────────

    async def get_financials_data(self, ticker: str, period: str = "annual") -> Dict[str, Any]:
        """Income Statement + Balance Sheet + Cash Flow + Earnings + Analyst."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._fetch_financials, ticker, period)

    def _safe_val(self, series, col) -> float | None:
        """Extract a single float value from a Series, handling NaN."""
        if series is None:
            return None
        try:
            v = series.get(col) if hasattr(series, "get") else series[col]
            f = float(v)
            return None if f != f else round(f, 2)  # NaN → None
        except Exception:
            return None

    def _row(self, df, *names):
        """Find first matching row in a DataFrame (tries multiple names)."""
        if df is None or df.empty:
            return None
        for name in names:
            if name in df.index:
                return df.loc[name]
        return None

    def _df_to_records(self, df, metric_map: dict) -> list:
        """
        Convert a yfinance financial DataFrame to list of {date, metric1, ...}.
        df: rows = metric names, columns = Timestamps (most recent first).
        metric_map: {output_key: [possible_row_names, ...]}
        Returns records sorted oldest → newest.
        """
        if df is None or df.empty:
            return []

        records = []
        for col in df.columns:
            date_str = col.strftime("%Y-%m-%d") if hasattr(col, "strftime") else str(col)[:10]
            rec = {"date": date_str}
            for key, names in metric_map.items():
                series = self._row(df, *names)
                rec[key] = self._safe_val(series, col)
            records.append(rec)

        # Sort oldest → newest
        records.sort(key=lambda r: r["date"])
        return records

    def _fetch_financials(self, ticker: str, period: str) -> Dict[str, Any]:
        """Sync: fetch all financial statements for a ticker."""
        stock = yf.Ticker(ticker)
        quarterly = period == "quarterly"

        # ── Income Statement ─────────────────────────────────────────────────
        is_df = stock.quarterly_financials if quarterly else stock.financials
        income = self._df_to_records(is_df, {
            "revenue":          ["Total Revenue"],
            "gross_profit":     ["Gross Profit"],
            "ebitda":           ["EBITDA", "Normalized EBITDA"],
            "operating_income": ["Operating Income", "EBIT"],
            "net_income":       ["Net Income", "Net Income Common Stockholders",
                                 "Net Income Including Noncontrolling Interests"],
            "rd_expense":       ["Research And Development"],
            "sga_expense":      ["Selling General And Administration"],
        })
        # Add margin ratios
        for row in income:
            rev = row.get("revenue")
            if rev and rev != 0:
                gp  = row.get("gross_profit")
                oi  = row.get("operating_income")
                ni  = row.get("net_income")
                row["gross_margin"]     = round(gp / rev, 4)  if gp  is not None else None
                row["operating_margin"] = round(oi / rev, 4)  if oi  is not None else None
                row["net_margin"]       = round(ni / rev, 4)  if ni  is not None else None
            else:
                row["gross_margin"] = row["operating_margin"] = row["net_margin"] = None

        # ── Balance Sheet ────────────────────────────────────────────────────
        bs_df = stock.quarterly_balance_sheet if quarterly else stock.balance_sheet
        balance = self._df_to_records(bs_df, {
            "total_assets":      ["Total Assets"],
            "total_liabilities": ["Total Liabilities Net Minority Interest", "Total Liab"],
            "equity":            ["Common Stock Equity", "Stockholders Equity",
                                  "Total Equity Gross Minority Interest"],
            "cash":              ["Cash And Cash Equivalents",
                                  "Cash Cash Equivalents And Short Term Investments"],
            "total_debt":        ["Total Debt"],
            "net_debt":          ["Net Debt"],
        })
        # Compute net_debt if missing
        for row in balance:
            if row.get("net_debt") is None:
                td = row.get("total_debt")
                ca = row.get("cash")
                if td is not None and ca is not None:
                    row["net_debt"] = round(td - ca, 2)

        # ── Cash Flow ────────────────────────────────────────────────────────
        cf_df = stock.quarterly_cashflow if quarterly else stock.cashflow
        cashflow = self._df_to_records(cf_df, {
            "operating_cf":   ["Operating Cash Flow",
                               "Cash Flow From Continuing Operating Activities"],
            "investing_cf":   ["Investing Cash Flow",
                               "Cash Flow From Continuing Investing Activities"],
            "financing_cf":   ["Financing Cash Flow",
                               "Cash Flow From Continuing Financing Activities"],
            "capex":          ["Capital Expenditure"],
            "free_cf":        ["Free Cash Flow"],
        })
        # Compute free_cf if missing
        for row in cashflow:
            if row.get("free_cf") is None:
                op = row.get("operating_cf")
                cx = row.get("capex")
                if op is not None and cx is not None:
                    row["free_cf"] = round(op + cx, 2)  # capex is negative

        # ── Earnings History ─────────────────────────────────────────────────
        earnings = []
        try:
            eh = stock.earnings_history
            if eh is not None and not eh.empty:
                for idx, row in eh.iterrows():
                    date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
                    actual   = row.get("epsActual")
                    estimate = row.get("epsEstimate")
                    surprise = row.get("surprisePercent")
                    period_lbl = row.get("period", "")
                    earnings.append({
                        "date":         date_str,
                        "period":       str(period_lbl),
                        "eps_actual":   float(actual)   if actual   == actual   else None,
                        "eps_estimate": float(estimate) if estimate == estimate else None,
                        "surprise_pct": float(surprise) * 100 if (surprise == surprise and surprise is not None) else None,
                    })
                earnings.sort(key=lambda r: r["date"])
                earnings = earnings[-8:]  # keep last 8 quarters
        except Exception:
            pass

        # ── Analyst Recommendations ──────────────────────────────────────────
        analyst = {"recommendations": None, "price_targets": None}
        try:
            rec_summary = getattr(stock, "recommendations_summary", None)
            if rec_summary is not None and not rec_summary.empty:
                # Period '0m' = current month
                row0 = rec_summary[rec_summary["period"] == "0m"] if "period" in rec_summary.columns else rec_summary.iloc[:1]
                if not row0.empty:
                    r = row0.iloc[0]
                    analyst["recommendations"] = {
                        "strong_buy":   int(r.get("strongBuy", 0)   or 0),
                        "buy":          int(r.get("buy", 0)          or 0),
                        "hold":         int(r.get("hold", 0)         or 0),
                        "sell":         int(r.get("sell", 0)         or 0),
                        "strong_sell":  int(r.get("strongSell", 0)   or 0),
                    }
        except Exception:
            pass

        try:
            pt = stock.analyst_price_targets
            if pt is not None:
                # pt may be a dict or a Series
                pt_dict = pt if isinstance(pt, dict) else pt.to_dict()
                def _fv(k):
                    v = pt_dict.get(k)
                    return float(v) if v is not None and str(v) != "nan" else None
                analyst["price_targets"] = {
                    "low":    _fv("low"),
                    "mean":   _fv("mean"),
                    "high":   _fv("high"),
                    "median": _fv("median"),
                    "count":  int(pt_dict.get("numberOfAnalysts", 0) or 0),
                }
        except Exception:
            pass

        return {
            "ticker":           ticker,
            "period":           period,
            "income_statement": income,
            "balance_sheet":    balance,
            "cash_flow":        cashflow,
            "earnings":         earnings,
            "analyst":          analyst,
        }

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
