/**
 * Instrument Page — /instrument/{ticker}
 *
 * SWR-powered: cached data shown instantly on re-visit, refreshed in background.
 * Quote auto-refreshes every 30s.
 *
 * Timeframe strategy:
 * - Intraday (5m/15m/30m/1H/4H): fetch correct period+interval from backend,
 *   convert ISO datetime → Unix seconds for lightweight-charts.
 * - Daily+ (D/1M/3M/6M/1Y): share period=max&interval=1d fetch, use visibleRange.
 * - Weekly (5Y): period=max&interval=1wk.
 * - 4H: fetch 1H data from backend, resample to 4-hour bars on frontend.
 */

import { useRouter } from 'next/router';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { TradingViewChart, ChartType } from '../../components/TradingViewChart';
import { fetcher } from '../../lib/fetcher';

interface QuoteData {
  ticker: string;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
  timestamp: string;
}

interface FundamentalsData {
  ticker: string;
  type?: string;
  name?: string;
  sector?: string;
  industry?: string;
  market_cap?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  roe?: number;
  dividend_yield?: number;
  debt_to_equity?: number;
  eps?: number;
  beta?: number;
}

interface NewsItem {
  title: string;
  summary: string;
  publisher: string;
  url: string;
  published_at: string;
  thumbnail: string | null;
}

interface EtfHolding {
  ticker: string;
  name: string;
  weight_pct: number;
}

interface HistoricalPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartLinePoint {
  date: string;
  value: number;
}

interface ChartOHLCPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface ChartResponse {
  ticker: string;
  period: string;
  data: HistoricalPoint[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeframe configuration
// ─────────────────────────────────────────────────────────────────────────────

interface Timeframe {
  label: string;
  group: 'intraday' | 'daily';
  /** yfinance period param sent to backend */
  fetchPeriod: string;
  /** yfinance interval param sent to backend */
  fetchInterval: string;
  /** true = dates are datetimes, need Unix-second conversion in chart */
  isIntraday: boolean;
  /** if set, resample N×1H bars into N-hour bars on the frontend */
  resampleHours?: number;
  /** if set, zoom the daily data to the last N days via visibleRange */
  visibleDays?: number;
}

const TIMEFRAMES: Timeframe[] = [
  // ── Intraday ──────────────────────────────────────────────────────────────
  { label: '5m',  group: 'intraday', fetchPeriod: '5d',  fetchInterval: '5m',  isIntraday: true },
  { label: '15m', group: 'intraday', fetchPeriod: '15d', fetchInterval: '15m', isIntraday: true },
  { label: '30m', group: 'intraday', fetchPeriod: '60d', fetchInterval: '30m', isIntraday: true },
  { label: '1H',  group: 'intraday', fetchPeriod: '60d', fetchInterval: '1h',  isIntraday: true },
  // 4H = fetch 1H (730d max), resample 4×1H→1 bar on frontend
  { label: '4H',  group: 'intraday', fetchPeriod: '2y',  fetchInterval: '1h',  isIntraday: true, resampleHours: 4 },
  // ── Daily+ ────────────────────────────────────────────────────────────────
  // D / 1M / 3M / 6M / 1Y / Max all share period=max&interval=1d → one SWR fetch
  { label: 'D',   group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false },
  { label: '1M',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false, visibleDays: 30 },
  { label: '3M',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false, visibleDays: 90 },
  { label: '6M',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false, visibleDays: 180 },
  { label: '1Y',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false, visibleDays: 365 },
  { label: '5Y',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1wk', isIntraday: false },
  { label: 'Max', group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false },
];

const DEFAULT_TF = '1Y';

// ─────────────────────────────────────────────────────────────────────────────
// 4H resampling helper (groups consecutive 1H bars into 4H bars)
// ─────────────────────────────────────────────────────────────────────────────

function resampleToNHour(data: HistoricalPoint[], n: number): HistoricalPoint[] {
  const bars = new Map<string, HistoricalPoint>();
  for (const p of data) {
    const dt = new Date(p.date);
    const bucket = Math.floor(dt.getUTCHours() / n) * n;
    const key = new Date(Date.UTC(
      dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), bucket, 0, 0
    )).toISOString();

    const existing = bars.get(key);
    if (!existing) {
      bars.set(key, { date: key, open: p.open, high: p.high, low: p.low, close: p.close, volume: p.volume ?? 0 });
    } else {
      existing.high   = Math.max(existing.high, p.high);
      existing.low    = Math.min(existing.low, p.low);
      existing.close  = p.close;           // last 1H bar in this 4H window
      existing.volume = existing.volume + (p.volume ?? 0);
    }
  }
  return Array.from(bars.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton helpers
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`bg-terminal-border animate-pulse rounded ${className ?? ''}`} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function InstrumentPage() {
  const router = useRouter();
  const { ticker } = router.query;
  const tickerStr = ticker ? String(ticker).toUpperCase() : null;

  const [selectedLabel, setSelectedLabel] = useState(DEFAULT_TF);
  const [chartType, setChartType] = useState<ChartType>('area');

  const tf = TIMEFRAMES.find((t) => t.label === selectedLabel) ?? TIMEFRAMES[9]; // default 1Y

  // ── Quote: auto-refresh every 30s ──
  const { data: quote } = useSWR<QuoteData>(
    tickerStr ? `${API_URL}/api/instruments/quote/${tickerStr}` : null,
    fetcher,
    { refreshInterval: 30_000, dedupingInterval: 10_000 }
  );

  // ── Fundamentals: cached 5min ──
  const { data: fundamentals } = useSWR<FundamentalsData>(
    tickerStr ? `${API_URL}/api/instruments/fundamentals/${tickerStr}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 * 5 }
  );

  // ── Chart data: key = period + interval — SWR caches per unique combination ──
  const { data: chartResponse, isLoading: isLoadingChart, error: chartError } = useSWR<ChartResponse>(
    tickerStr
      ? `${API_URL}/api/instruments/chart/${tickerStr}?period=${tf.fetchPeriod}&interval=${tf.fetchInterval}`
      : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 * 5 }
  );

  // ── News: cached 5min ──
  const { data: news = [], isLoading: isLoadingNews } = useSWR<NewsItem[]>(
    tickerStr ? `${API_URL}/api/instruments/news/${tickerStr}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 * 5 }
  );

  // ── ETF holdings: cached 24h ──
  const { data: etfHoldings = [] } = useSWR<EtfHolding[]>(
    tickerStr ? `${API_URL}/api/instruments/etf-holdings/${tickerStr}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 * 60 * 24 }
  );

  // Raw data from backend
  const rawHistorical = chartResponse?.data ?? [];

  // Apply 4H resampling if needed (otherwise pass through)
  const historical: HistoricalPoint[] = useMemo(() => {
    if (tf.resampleHours && rawHistorical.length > 0) {
      return resampleToNHour(rawHistorical, tf.resampleHours);
    }
    return rawHistorical;
  }, [rawHistorical, tf.resampleHours]);

  // Transform historical to line/area format
  const lineData: ChartLinePoint[] = useMemo(
    () => historical.map((p) => ({ date: p.date, value: p.close })),
    [historical]
  );

  // Transform historical to OHLC format
  const ohlcData: ChartOHLCPoint[] = useMemo(
    () => historical.map((p) => ({ date: p.date, open: p.open, high: p.high, low: p.low, close: p.close })),
    [historical]
  );

  // Compute visible range for daily timeframes that zoom into full history
  const visibleRange = useMemo(() => {
    if (tf.isIntraday || !tf.visibleDays || historical.length === 0) return undefined;
    const lastDate = historical[historical.length - 1].date.split('T')[0];
    const fromTs   = new Date(lastDate).getTime() - tf.visibleDays * 86_400_000;
    const fromDate = new Date(fromTs).toISOString().split('T')[0];
    return { from: fromDate, to: lastDate };
  }, [historical, tf.isIntraday, tf.visibleDays]);

  if (!tickerStr) {
    return (
      <div className="min-h-screen bg-terminal-bg text-terminal-text flex items-center justify-center">
        <div className="text-terminal-textMuted">Loading…</div>
      </div>
    );
  }

  const isPositive  = quote && quote.change >= 0;
  const changeColor = isPositive ? 'text-green-500' : 'text-red-500';
  const changeBgColor = isPositive ? 'bg-green-500/10' : 'bg-red-500/10';
  const lineColor   = isPositive !== false ? '#26a69a' : '#ef5350';

  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text">
      {/* ── Header ── */}
      <div className="border-b border-terminal-border bg-terminal-surface">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold num text-terminal-cyan">{tickerStr}</h1>
              {fundamentals?.name ? (
                <p className="text-terminal-textMuted text-sm mt-1">
                  {fundamentals.name}
                  {fundamentals.sector && ` · ${fundamentals.sector}`}
                </p>
              ) : (
                <SkeletonBlock className="h-4 w-48 mt-2" />
              )}
            </div>
            {quote ? (
              <div className={`text-right ${changeBgColor} rounded px-4 py-2`}>
                <div className="text-2xl font-bold num text-terminal-text">
                  ${quote.price.toFixed(2)}
                </div>
                <div className={`text-sm font-semibold num ${changeColor}`}>
                  {isPositive ? '+' : ''}{quote.change.toFixed(2)} ({quote.change_pct.toFixed(2)}%)
                </div>
              </div>
            ) : (
              <SkeletonBlock className="h-14 w-32" />
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {quote ? (
              <div>
                <div className="text-terminal-textMuted text-xs">Volume</div>
                <div className="font-semibold num">{(quote.volume / 1_000_000).toFixed(1)}M</div>
              </div>
            ) : (
              <div>
                <SkeletonBlock className="h-3 w-12 mb-1" />
                <SkeletonBlock className="h-4 w-16" />
              </div>
            )}
            {fundamentals?.market_cap ? (
              <div>
                <div className="text-terminal-textMuted text-xs">Market Cap</div>
                <div className="font-semibold num">${(fundamentals.market_cap / 1_000_000_000).toFixed(1)}B</div>
              </div>
            ) : null}
            {fundamentals?.pe_ratio ? (
              <div>
                <div className="text-terminal-textMuted text-xs">P/E Ratio</div>
                <div className="font-semibold num">{fundamentals.pe_ratio.toFixed(2)}x</div>
              </div>
            ) : null}
            {fundamentals?.dividend_yield ? (
              <div>
                <div className="text-terminal-textMuted text-xs">Dividend Yield</div>
                <div className="font-semibold num">{(fundamentals.dividend_yield * 100).toFixed(2)}%</div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {chartError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded px-4 py-3 mb-6 text-red-500 text-sm">
            Failed to load chart data
          </div>
        )}

        {/* ── Chart Section ── */}
        <div className="bg-terminal-surface border border-terminal-border rounded mb-6 p-4">
          <div className="mb-3 flex items-center justify-between flex-wrap gap-3">
            {/* Chart type toggle */}
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Price Chart</h2>
              <div className="flex border border-terminal-border rounded overflow-hidden">
                <button
                  onClick={() => setChartType('area')}
                  className={`px-2 py-1 text-xs transition ${
                    chartType === 'area'
                      ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                      : 'text-terminal-textMuted hover:text-terminal-text'
                  }`}
                >
                  Line
                </button>
                <button
                  onClick={() => setChartType('candle')}
                  className={`px-2 py-1 text-xs transition border-l border-terminal-border ${
                    chartType === 'candle'
                      ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                      : 'text-terminal-textMuted hover:text-terminal-text'
                  }`}
                >
                  Candle
                </button>
              </div>
            </div>

            {/* Timeframe buttons */}
            <div className="flex items-center gap-1 flex-wrap">
              {/* Intraday group */}
              {TIMEFRAMES.filter((t) => t.group === 'intraday').map((t) => (
                <button
                  key={t.label}
                  onClick={() => setSelectedLabel(t.label)}
                  className={`px-2.5 py-1 text-xs rounded transition num ${
                    selectedLabel === t.label
                      ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                      : 'border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan'
                  }`}
                >
                  {t.label}
                </button>
              ))}
              {/* Visual separator */}
              <span className="text-terminal-border text-xs mx-0.5">│</span>
              {/* Daily+ group */}
              {TIMEFRAMES.filter((t) => t.group === 'daily').map((t) => (
                <button
                  key={t.label}
                  onClick={() => setSelectedLabel(t.label)}
                  className={`px-2.5 py-1 text-xs rounded transition num ${
                    selectedLabel === t.label
                      ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                      : 'border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-terminal-bg rounded p-2">
            {isLoadingChart ? (
              <SkeletonBlock className="h-96 w-full" />
            ) : historical.length > 0 ? (
              <TradingViewChart
                data={lineData}
                ohlcData={ohlcData}
                chartType={chartType}
                height={400}
                color={lineColor}
                showAxes={true}
                isIntraday={tf.isIntraday}
                visibleRange={visibleRange}
              />
            ) : (
              <div className="h-96 flex items-center justify-center text-terminal-textMuted">
                No chart data available
              </div>
            )}
          </div>

          {tf.isIntraday ? (
            <p className="text-2xs text-terminal-textDim mt-2">
              {tf.label} candles · scroll to pan · pinch/wheel to zoom
            </p>
          ) : (
            <p className="text-2xs text-terminal-textDim mt-2">
              Scroll/drag the chart to see data outside the selected window.
            </p>
          )}
        </div>

        {/* ── Fundamentals Grid ── */}
        {fundamentals ? (
          <div className="bg-terminal-surface border border-terminal-border rounded p-4 mb-6">
            <h2 className="text-lg font-semibold mb-4">Fundamentals</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {fundamentals.pe_ratio != null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">P/E Ratio</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">{fundamentals.pe_ratio.toFixed(2)}x</div>
                </div>
              )}
              {fundamentals.pb_ratio != null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">P/B Ratio</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">{fundamentals.pb_ratio.toFixed(2)}x</div>
                </div>
              )}
              {fundamentals.roe != null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">ROE</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">{(fundamentals.roe * 100).toFixed(2)}%</div>
                </div>
              )}
              {fundamentals.eps != null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">EPS</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">${fundamentals.eps.toFixed(2)}</div>
                </div>
              )}
              {fundamentals.beta != null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Beta</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">{fundamentals.beta.toFixed(2)}</div>
                </div>
              )}
              {fundamentals.dividend_yield != null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Dividend Yield</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">{(fundamentals.dividend_yield * 100).toFixed(2)}%</div>
                </div>
              )}
              {fundamentals.debt_to_equity != null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Debt/Equity</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">{fundamentals.debt_to_equity.toFixed(2)}</div>
                </div>
              )}
              {fundamentals.industry && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Industry</div>
                  <div className="text-sm font-semibold text-terminal-cyan">{fundamentals.industry}</div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-terminal-surface border border-terminal-border rounded p-4 mb-6">
            <SkeletonBlock className="h-5 w-32 mb-4" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                  <SkeletonBlock className="h-3 w-16 mb-2" />
                  <SkeletonBlock className="h-6 w-20" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ETF Holdings ── */}
        {etfHoldings.length > 0 && (
          <div className="bg-terminal-surface border border-terminal-border rounded p-4 mb-6">
            <h2 className="text-lg font-semibold mb-4">
              Top Holdings
              <span className="ml-2 text-xs text-terminal-textMuted font-normal">
                ({etfHoldings.length} positions)
              </span>
            </h2>
            <div className="space-y-2">
              {etfHoldings.slice(0, 15).map((h, i) => {
                const barWidth = Math.min(100, (h.weight_pct / (etfHoldings[0]?.weight_pct || 1)) * 100);
                return (
                  <div key={h.ticker || i} className="group">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-terminal-textDim num w-5 text-right">{i + 1}</span>
                        <a href={`/instrument/${h.ticker}`} className="font-mono font-bold text-terminal-cyan hover:underline text-sm">
                          {h.ticker}
                        </a>
                        <span className="text-xs text-terminal-textMuted truncate max-w-[200px]">{h.name}</span>
                      </div>
                      <span className="text-sm font-semibold num text-terminal-text">{h.weight_pct.toFixed(2)}%</span>
                    </div>
                    <div className="h-1 bg-terminal-border rounded-full overflow-hidden ml-8">
                      <div className="h-full rounded-full bg-terminal-cyan/60 transition-all" style={{ width: `${barWidth}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {etfHoldings.length > 15 && (
              <p className="text-xs text-terminal-textDim mt-3">Showing top 15 of {etfHoldings.length} holdings</p>
            )}
          </div>
        )}

        {/* ── News Section ── */}
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <h2 className="text-lg font-semibold mb-4">Latest News</h2>
          {isLoadingNews && (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <SkeletonBlock className="w-16 h-12 shrink-0" />
                  <div className="flex-1">
                    <SkeletonBlock className="h-4 w-full mb-2" />
                    <SkeletonBlock className="h-3 w-3/4 mb-2" />
                    <SkeletonBlock className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!isLoadingNews && news.length === 0 && (
            <p className="text-terminal-textDim text-sm">No news available for {tickerStr}</p>
          )}
          {!isLoadingNews && news.length > 0 && (
            <div className="space-y-4">
              {news.map((item, i) => (
                <a
                  key={i}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 group hover:bg-terminal-surfaceHi rounded p-2 -mx-2 transition"
                >
                  {item.thumbnail && (
                    <img
                      src={item.thumbnail}
                      alt=""
                      className="w-16 h-12 object-cover rounded shrink-0 opacity-80 group-hover:opacity-100"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-terminal-text group-hover:text-terminal-cyan transition leading-tight line-clamp-2">
                      {item.title}
                    </p>
                    {item.summary && (
                      <p className="text-xs text-terminal-textMuted mt-1 line-clamp-1">{item.summary}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-2xs text-terminal-textDim">{item.publisher}</span>
                      {item.published_at && (
                        <>
                          <span className="text-terminal-textDim">·</span>
                          <span className="text-2xs text-terminal-textDim num">{formatNewsDate(item.published_at)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatNewsDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / 3_600_000);
    if (diffH < 1) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
