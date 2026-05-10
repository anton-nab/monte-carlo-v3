/**
 * Instrument Page — /instrument/{ticker}
 *
 * 3 tabs:
 *   Chart      — price chart (12 timeframes) + key stats + news
 *   Financials — Income Statement / Balance Sheet / Cash Flow (annual/quarterly)
 *   Analysis   — Earnings EPS history + Analyst recommendations + price targets + FOMO
 */

import { useRouter } from 'next/router';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ReferenceLine,
} from 'recharts';
import { TradingViewChart, ChartType } from '../../components/TradingViewChart';
import { fetcher } from '../../lib/fetcher';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface QuoteData {
  ticker: string; price: number; change: number; change_pct: number; volume: number; timestamp: string;
}
interface FundamentalsData {
  ticker: string; type?: string; name?: string; sector?: string; industry?: string;
  market_cap?: number; pe_ratio?: number; pb_ratio?: number; roe?: number;
  dividend_yield?: number; debt_to_equity?: number; eps?: number; beta?: number;
  revenue_ttm?: number; gross_margin?: number;
}
interface NewsItem {
  title: string; summary: string; publisher: string; url: string; published_at: string; thumbnail: string | null;
}
interface EtfHolding { ticker: string; name: string; weight_pct: number; }
interface HistoricalPoint { date: string; open: number; high: number; low: number; close: number; volume: number; }
interface ChartResponse { ticker: string; period: string; data: HistoricalPoint[]; }

// Financial statement rows
interface ISRow {
  date: string; revenue: number | null; gross_profit: number | null; ebitda: number | null;
  operating_income: number | null; net_income: number | null; rd_expense: number | null;
  gross_margin: number | null; operating_margin: number | null; net_margin: number | null;
}
interface BSRow {
  date: string; total_assets: number | null; total_liabilities: number | null; equity: number | null;
  cash: number | null; total_debt: number | null; net_debt: number | null;
}
interface CFRow {
  date: string; operating_cf: number | null; investing_cf: number | null;
  financing_cf: number | null; capex: number | null; free_cf: number | null;
}
interface EarningsRow {
  date: string; period: string; eps_actual: number | null; eps_estimate: number | null; surprise_pct: number | null;
}
interface FinancialsData {
  ticker: string; period: string;
  income_statement: ISRow[];
  balance_sheet: BSRow[];
  cash_flow: CFRow[];
  earnings: EarningsRow[];
  analyst: {
    recommendations: { strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number; } | null;
    price_targets: { low: number | null; mean: number | null; high: number | null; count: number; } | null;
  };
}

interface FomoResult {
  score: number;
  breakdown: { momentum: number; volume: number; analyst: number; eps: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeframe config
// ─────────────────────────────────────────────────────────────────────────────

interface Timeframe {
  label: string; group: 'intraday' | 'daily';
  fetchPeriod: string; fetchInterval: string; isIntraday: boolean;
  resampleHours?: number; visibleDays?: number;
}
const TIMEFRAMES: Timeframe[] = [
  { label: '5m',  group: 'intraday', fetchPeriod: '5d',  fetchInterval: '5m',  isIntraday: true },
  { label: '15m', group: 'intraday', fetchPeriod: '15d', fetchInterval: '15m', isIntraday: true },
  { label: '30m', group: 'intraday', fetchPeriod: '60d', fetchInterval: '30m', isIntraday: true },
  { label: '1H',  group: 'intraday', fetchPeriod: '60d', fetchInterval: '1h',  isIntraday: true },
  { label: '4H',  group: 'intraday', fetchPeriod: '2y',  fetchInterval: '1h',  isIntraday: true, resampleHours: 4 },
  { label: 'D',   group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false },
  { label: '1M',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false, visibleDays: 30 },
  { label: '3M',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false, visibleDays: 90 },
  { label: '6M',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false, visibleDays: 180 },
  { label: '1Y',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false, visibleDays: 365 },
  { label: '5Y',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1wk', isIntraday: false },
  { label: 'Max', group: 'daily', fetchPeriod: 'max', fetchInterval: '1d', isIntraday: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resampleToNHour(data: HistoricalPoint[], n: number): HistoricalPoint[] {
  const bars = new Map<string, HistoricalPoint>();
  for (const p of data) {
    const dt = new Date(p.date);
    const bucket = Math.floor(dt.getUTCHours() / n) * n;
    const key = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), bucket, 0, 0)).toISOString();
    const e = bars.get(key);
    if (!e) bars.set(key, { date: key, open: p.open, high: p.high, low: p.low, close: p.close, volume: p.volume ?? 0 });
    else { e.high = Math.max(e.high, p.high); e.low = Math.min(e.low, p.low); e.close = p.close; e.volume += p.volume ?? 0; }
  }
  return Array.from(bars.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Format large financial numbers compactly: 391B, 23.4M, etc. */
function fmtBig(n: number | null, prefix = '$'): string {
  if (n == null) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${sign}${prefix}${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9)  return `${sign}${prefix}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}${prefix}${(abs / 1e6).toFixed(1)}M`;
  return `${sign}${prefix}${abs.toFixed(0)}`;
}
function fmtPct(n: number | null): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(1)}%`;
}
/** Shorten a date label for chart axis: "2024-09-30" → "Sep '24" */
function shortDate(d: string): string {
  try {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  } catch { return d.slice(0, 7); }
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`bg-terminal-border animate-pulse rounded ${className ?? ''}`} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// FOMO computation
// ─────────────────────────────────────────────────────────────────────────────

function computeFomoScore(
  chartData: HistoricalPoint[],
  currentVolume: number | undefined,
  financials: FinancialsData | undefined,
): FomoResult | null {
  if (!chartData.length) return null;

  let momentumPts = 0, volumePts = 0, analystPts = 0, epsPts = 0;

  // 1. Price momentum 30d (0-30 pts)
  const last = chartData[chartData.length - 1].close;
  const cutoffTime = Date.now() - 30 * 86_400_000;
  let refClose = chartData[0].close;
  for (let i = chartData.length - 1; i >= 0; i--) {
    if (new Date(chartData[i].date).getTime() <= cutoffTime) {
      refClose = chartData[i].close;
      break;
    }
  }
  const changePct = ((last - refClose) / refClose) * 100;
  // -20% → 0pts · 0% → 15pts · +20% → 30pts
  momentumPts = Math.max(0, Math.min(30, ((changePct + 20) / 40) * 30));

  // 2. Volume surge vs 20-day avg (0-20 pts)
  if (chartData.length >= 20 && currentVolume != null && currentVolume > 0) {
    const avgVol = chartData.slice(-20).reduce((s, p) => s + (p.volume ?? 0), 0) / 20;
    if (avgVol > 0) {
      const ratio = currentVolume / avgVol;
      // 1× avg → 0pts · 2× avg → 20pts
      volumePts = Math.max(0, Math.min(20, (ratio - 1) * 20));
    }
  }

  // 3. Analyst bullish % (0-25 pts)
  if (financials?.analyst?.recommendations) {
    const r = financials.analyst.recommendations;
    const total = r.strong_buy + r.buy + r.hold + r.sell + r.strong_sell;
    if (total > 0) {
      const weighted = (r.strong_buy * 1.0 + r.buy * 0.7) / total;
      analystPts = Math.min(25, weighted * 35);
    }
  }

  // 4. Avg EPS surprise last 4 quarters (0-25 pts)
  if (financials?.earnings?.length) {
    const last4 = financials.earnings.slice(-4);
    const surprises = last4.filter((e) => e.surprise_pct != null).map((e) => e.surprise_pct as number);
    if (surprises.length > 0) {
      const avg = surprises.reduce((a, b) => a + b, 0) / surprises.length;
      // -10% → 0pts · 0% → 12.5pts · +10% → 25pts
      epsPts = Math.max(0, Math.min(25, ((avg + 10) / 20) * 25));
    }
  }

  return {
    score: Math.round(Math.min(100, momentumPts + volumePts + analystPts + epsPts)),
    breakdown: {
      momentum: Math.round(momentumPts),
      volume:   Math.round(volumePts),
      analyst:  Math.round(analystPts),
      eps:      Math.round(epsPts),
    },
  };
}

function getFomoMeta(score: number) {
  if (score >= 80) return { label: 'FOMO',     ringColor: '#ef4444', textColor: 'text-red-400',    bgColor: 'bg-red-500/10'    };
  if (score >= 60) return { label: 'Chaud',    ringColor: '#f97316', textColor: 'text-orange-400', bgColor: 'bg-orange-500/10' };
  if (score >= 40) return { label: 'Momentum', ringColor: '#eab308', textColor: 'text-yellow-400', bgColor: 'bg-yellow-500/10' };
  if (score >= 20) return { label: 'Neutre',   ringColor: '#6b7280', textColor: 'text-gray-400',   bgColor: 'bg-gray-500/10'   };
  return              { label: 'Froid',    ringColor: '#3b82f6', textColor: 'text-blue-400',   bgColor: 'bg-blue-500/10'   };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recharts shared tooltip style
// ─────────────────────────────────────────────────────────────────────────────
const TOOLTIP_STYLE = {
  contentStyle: { background: '#1a2035', border: '1px solid #2a3040', borderRadius: 4, fontSize: 11 },
  labelStyle: { color: '#7a8294' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

type PageTab = 'chart' | 'financials' | 'analysis';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function InstrumentPage() {
  const router = useRouter();
  const { ticker } = router.query;
  const tickerStr = ticker ? String(ticker).toUpperCase() : null;

  const [activeTab, setActiveTab]         = useState<PageTab>('chart');
  const [selectedLabel, setSelectedLabel] = useState('1Y');
  const [chartType, setChartType]         = useState<ChartType>('area');
  const [fsPeriod, setFsPeriod]           = useState<'annual' | 'quarterly'>('annual');
  const [fsTab, setFsTab]                 = useState<'income' | 'balance' | 'cashflow'>('income');

  const tf = TIMEFRAMES.find((t) => t.label === selectedLabel) ?? TIMEFRAMES[9];

  // ── SWR fetches ────────────────────────────────────────────────────────────
  const { data: quote } = useSWR<QuoteData>(
    tickerStr ? `${API_URL}/api/instruments/quote/${tickerStr}` : null,
    fetcher, { refreshInterval: 30_000, dedupingInterval: 10_000 }
  );
  const { data: fundamentals } = useSWR<FundamentalsData>(
    tickerStr ? `${API_URL}/api/instruments/fundamentals/${tickerStr}` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 }
  );
  const { data: chartResponse, isLoading: isLoadingChart, error: chartError } = useSWR<ChartResponse>(
    tickerStr ? `${API_URL}/api/instruments/chart/${tickerStr}?period=${tf.fetchPeriod}&interval=${tf.fetchInterval}` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 }
  );
  const { data: news = [], isLoading: isLoadingNews } = useSWR<NewsItem[]>(
    tickerStr ? `${API_URL}/api/instruments/news/${tickerStr}` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 }
  );
  const { data: etfHoldings = [] } = useSWR<EtfHolding[]>(
    tickerStr ? `${API_URL}/api/instruments/etf-holdings/${tickerStr}` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 86_400_000 }
  );
  const { data: financials, isLoading: isLoadingFS } = useSWR<FinancialsData>(
    tickerStr && (activeTab === 'financials' || activeTab === 'analysis')
      ? `${API_URL}/api/instruments/financials/${tickerStr}?period=${fsPeriod}`
      : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );
  // Dedicated 6-month daily fetch for FOMO score (always loaded, lightweight)
  const { data: fomoChart } = useSWR<ChartResponse>(
    tickerStr ? `${API_URL}/api/instruments/chart/${tickerStr}?period=6mo&interval=1d` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );
  // Always-active financials for FOMO — never lazy, so badge is consistent on all tabs
  const { data: fomoFinancials } = useSWR<FinancialsData>(
    tickerStr ? `${API_URL}/api/instruments/financials/${tickerStr}?period=annual` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );

  // ── Chart data processing ──────────────────────────────────────────────────
  const rawHistorical = chartResponse?.data ?? [];
  const historical: HistoricalPoint[] = useMemo(() => {
    if (tf.resampleHours && rawHistorical.length > 0) return resampleToNHour(rawHistorical, tf.resampleHours);
    return rawHistorical;
  }, [rawHistorical, tf.resampleHours]);

  const lineData  = useMemo(() => historical.map((p) => ({ date: p.date, value: p.close })), [historical]);
  const ohlcData  = useMemo(() => historical.map((p) => ({ date: p.date, open: p.open, high: p.high, low: p.low, close: p.close })), [historical]);
  const visibleRange = useMemo(() => {
    if (tf.isIntraday || !tf.visibleDays || historical.length === 0) return undefined;
    const lastDate = historical[historical.length - 1].date.split('T')[0];
    const fromDate = new Date(new Date(lastDate).getTime() - tf.visibleDays * 86_400_000).toISOString().split('T')[0];
    return { from: fromDate, to: lastDate };
  }, [historical, tf.isIntraday, tf.visibleDays]);

  // ── FOMO score — uses dedicated always-loaded fetches for consistency ────────
  const fomoResult = useMemo(
    () => computeFomoScore(fomoChart?.data ?? [], quote?.volume, fomoFinancials),
    [fomoChart, quote?.volume, fomoFinancials]
  );

  if (!tickerStr) return (
    <div className="min-h-screen bg-terminal-bg flex items-center justify-center text-terminal-textMuted">Loading…</div>
  );

  const isPositive    = quote && quote.change >= 0;
  const changeColor   = isPositive ? 'text-green-500' : 'text-red-500';
  const changeBgColor = isPositive ? 'bg-green-500/10' : 'bg-red-500/10';
  const lineColor     = isPositive !== false ? '#26a69a' : '#ef5350';

  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text">

      {/* ── Sticky header: quote + quick stats ── */}
      <div className="border-b border-terminal-border bg-terminal-surface">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-end justify-between mb-3">
            <div>
              <h1 className="text-3xl font-bold num text-terminal-cyan">{tickerStr}</h1>
              {fundamentals?.name
                ? <p className="text-terminal-textMuted text-sm mt-1">{fundamentals.name}{fundamentals.sector && ` · ${fundamentals.sector}`}</p>
                : <SkeletonBlock className="h-4 w-48 mt-2" />}
            </div>
            {quote ? (
              <div className={`text-right ${changeBgColor} rounded px-4 py-2`}>
                <div className="text-2xl font-bold num">${quote.price.toFixed(2)}</div>
                <div className={`text-sm font-semibold num ${changeColor}`}>
                  {isPositive ? '+' : ''}{quote.change.toFixed(2)} ({quote.change_pct.toFixed(2)}%)
                </div>
              </div>
            ) : <SkeletonBlock className="h-14 w-32" />}
          </div>

          {/* Quick stats row + FOMO badge */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm items-center">
            {quote && <Stat label="Volume" value={`${(quote.volume / 1_000_000).toFixed(1)}M`} info="Number of shares traded today" />}
            {fundamentals?.market_cap && <Stat label="Mkt Cap"      value={fmtBig(fundamentals.market_cap)} info="Total market value of all shares outstanding (price × shares)" />}
            {fundamentals?.pe_ratio    && <Stat label="P/E"         value={`${fundamentals.pe_ratio.toFixed(1)}x`} info="Price-to-Earnings: stock price divided by earnings per share. Lower = cheaper relative to earnings." />}
            {fundamentals?.eps         && <Stat label="EPS"         value={`$${fundamentals.eps.toFixed(2)}`} info="Earnings Per Share: net profit divided by shares outstanding" />}
            {fundamentals?.beta        && <Stat label="Beta"        value={fundamentals.beta.toFixed(2)} info="Volatility vs market. β=1 moves with market; β>1 more volatile; β<1 more stable." />}
            {fundamentals?.dividend_yield && <Stat label="Div Yield" value={fmtPct(fundamentals.dividend_yield)} info="Annual dividend payments as % of current stock price" />}
            {fundamentals?.revenue_ttm && <Stat label="Rev TTM"     value={fmtBig(fundamentals.revenue_ttm)} info="Total revenue over the last 12 months (Trailing Twelve Months)" />}
            {fundamentals?.gross_margin && <Stat label="Gross Margin" value={fmtPct(fundamentals.gross_margin)} info="(Revenue − Cost of Goods Sold) / Revenue — measures production efficiency" />}
            {fomoResult && <FomoBadge score={fomoResult.score} />}
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div className="max-w-7xl mx-auto px-4 flex gap-0 border-t border-terminal-border/50">
          {(['chart', 'financials', 'analysis'] as PageTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-5 py-2.5 text-sm font-semibold capitalize transition border-b-2 ${
                activeTab === t
                  ? 'border-terminal-cyan text-terminal-cyan'
                  : 'border-transparent text-terminal-textMuted hover:text-terminal-text'
              }`}
            >
              {t === 'chart' ? '📈 Chart' : t === 'financials' ? '📊 Financials' : '🔍 Analysis'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* ════════════════════ CHART TAB ════════════════════ */}
        {activeTab === 'chart' && (
          <div className="space-y-6">
            {/* Chart card */}
            <div className="bg-terminal-surface border border-terminal-border rounded p-4">
              <div className="mb-3 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold">Price Chart</h2>
                  <div className="flex border border-terminal-border rounded overflow-hidden">
                    {(['area', 'candle'] as ChartType[]).map((ct) => (
                      <button key={ct} onClick={() => setChartType(ct)}
                        className={`px-2 py-1 text-xs transition border-l first:border-l-0 border-terminal-border ${
                          chartType === ct ? 'bg-terminal-cyan text-terminal-bg font-semibold' : 'text-terminal-textMuted hover:text-terminal-text'
                        }`}>
                        {ct === 'area' ? 'Line' : 'Candle'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {TIMEFRAMES.filter((t) => t.group === 'intraday').map((t) => (
                    <TfBtn key={t.label} label={t.label} active={selectedLabel === t.label} onClick={() => setSelectedLabel(t.label)} />
                  ))}
                  <span className="text-terminal-border text-xs mx-0.5">│</span>
                  {TIMEFRAMES.filter((t) => t.group === 'daily').map((t) => (
                    <TfBtn key={t.label} label={t.label} active={selectedLabel === t.label} onClick={() => setSelectedLabel(t.label)} />
                  ))}
                </div>
              </div>
              <div className="bg-terminal-bg rounded p-2">
                {chartError ? (
                  <div className="h-80 flex items-center justify-center text-red-500 text-sm">Failed to load chart data</div>
                ) : isLoadingChart ? (
                  <SkeletonBlock className="h-96 w-full" />
                ) : historical.length > 0 ? (
                  <TradingViewChart data={lineData} ohlcData={ohlcData} chartType={chartType}
                    height={400} color={lineColor} showAxes isIntraday={tf.isIntraday} visibleRange={visibleRange} />
                ) : (
                  <div className="h-96 flex items-center justify-center text-terminal-textMuted">No chart data available</div>
                )}
              </div>
              <p className="text-2xs text-terminal-textDim mt-2">
                {tf.isIntraday ? `${tf.label} candles · scroll/wheel to zoom` : 'Scroll/drag to see full history'}
              </p>
            </div>

            {/* ETF Holdings */}
            {etfHoldings.length > 0 && (
              <div className="bg-terminal-surface border border-terminal-border rounded p-4">
                <h2 className="text-lg font-semibold mb-4">Top Holdings <span className="text-xs text-terminal-textMuted font-normal">({etfHoldings.length})</span></h2>
                <div className="space-y-2">
                  {etfHoldings.slice(0, 15).map((h, i) => {
                    const barW = Math.min(100, (h.weight_pct / (etfHoldings[0]?.weight_pct || 1)) * 100);
                    return (
                      <div key={h.ticker || i}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-terminal-textDim num w-5 text-right">{i + 1}</span>
                            <a href={`/instrument/${h.ticker}`} className="font-mono font-bold text-terminal-cyan hover:underline text-sm">{h.ticker}</a>
                            <span className="text-xs text-terminal-textMuted truncate max-w-[200px]">{h.name}</span>
                          </div>
                          <span className="text-sm font-semibold num">{h.weight_pct.toFixed(2)}%</span>
                        </div>
                        <div className="h-1 bg-terminal-border rounded-full overflow-hidden ml-8">
                          <div className="h-full rounded-full bg-terminal-cyan/60" style={{ width: `${barW}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* News */}
            <div className="bg-terminal-surface border border-terminal-border rounded p-4">
              <h2 className="text-lg font-semibold mb-4">Latest News</h2>
              {isLoadingNews ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} className="h-12 w-full" />)}</div>
              ) : news.length === 0 ? (
                <p className="text-terminal-textDim text-sm">No news available for {tickerStr}</p>
              ) : (
                <div className="space-y-4">
                  {news.map((item, i) => (
                    <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                      className="flex gap-3 group hover:bg-terminal-surfaceHi rounded p-2 -mx-2 transition">
                      {item.thumbnail && <img src={item.thumbnail} alt="" className="w-16 h-12 object-cover rounded shrink-0 opacity-80 group-hover:opacity-100" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold group-hover:text-terminal-cyan transition leading-tight line-clamp-2">{item.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-2xs text-terminal-textDim">{item.publisher}</span>
                          {item.published_at && <><span className="text-terminal-textDim">·</span><span className="text-2xs text-terminal-textDim num">{formatNewsDate(item.published_at)}</span></>}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════ FINANCIALS TAB ════════════════════ */}
        {activeTab === 'financials' && (
          <FinancialsTab
            financials={financials}
            isLoading={isLoadingFS}
            fsPeriod={fsPeriod}
            setFsPeriod={setFsPeriod}
            fsTab={fsTab}
            setFsTab={setFsTab}
          />
        )}

        {/* ════════════════════ ANALYSIS TAB ════════════════════ */}
        {activeTab === 'analysis' && (
          <AnalysisTab
            financials={financials}
            isLoading={isLoadingFS}
            quote={quote}
            fomoResult={fomoResult}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small reusable components
// ─────────────────────────────────────────────────────────────────────────────

/** Hover ⓘ tooltip. dir defaults to 'right' (ideal for table/row labels). */
function InfoTip({ text, dir = 'right' }: { text: string; dir?: 'right' | 'top' | 'bottom' }) {
  const pos = {
    right:  'left-full top-1/2 -translate-y-1/2 ml-1.5',
    top:    'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  }[dir];
  return (
    <span className="relative group inline-flex items-center cursor-help align-middle ml-0.5">
      <span className="text-terminal-textDim/60 text-[9px] select-none leading-none">ⓘ</span>
      <span className={`pointer-events-none absolute ${pos} z-50
        invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity duration-150
        bg-[#0f1522] border border-terminal-border rounded px-2 py-1.5
        text-xs text-terminal-text w-52 leading-snug shadow-xl`}>
        {text}
      </span>
    </span>
  );
}

function Stat({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-terminal-textMuted text-xs">
        {label}{info && <InfoTip text={info} dir="bottom" />}
      </span>
      <span className="font-semibold num text-sm">{value}</span>
    </div>
  );
}

function TfBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-xs rounded transition num ${
      active ? 'bg-terminal-cyan text-terminal-bg font-semibold' : 'border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan'
    }`}>{label}</button>
  );
}

/** Small inline FOMO badge for the header stats row */
function FomoBadge({ score }: { score: number }) {
  const { label, ringColor, textColor, bgColor } = getFomoMeta(score);
  return (
    <span className={`inline-flex items-center gap-2 px-2 py-0.5 rounded text-xs font-bold border border-current/20 ${textColor} ${bgColor}`}>
      <span className="w-10 h-1.5 rounded-full overflow-hidden bg-black/30 inline-block align-middle shrink-0">
        <span className="h-full block rounded-full" style={{ width: `${score}%`, background: ringColor }} />
      </span>
      {score} · {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FinancialsTab
// ─────────────────────────────────────────────────────────────────────────────

function FinancialsTab({
  financials, isLoading, fsPeriod, setFsPeriod, fsTab, setFsTab,
}: {
  financials: FinancialsData | undefined;
  isLoading: boolean;
  fsPeriod: 'annual' | 'quarterly';
  setFsPeriod: (p: 'annual' | 'quarterly') => void;
  fsTab: 'income' | 'balance' | 'cashflow';
  setFsTab: (t: 'income' | 'balance' | 'cashflow') => void;
}) {
  if (isLoading) return (
    <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <SkeletonBlock key={i} className="h-64 w-full" />)}</div>
  );
  if (!financials) return <div className="text-terminal-textMuted text-sm">No financial data available.</div>;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex border border-terminal-border rounded overflow-hidden">
          {(['annual', 'quarterly'] as const).map((p) => (
            <button key={p} onClick={() => setFsPeriod(p)}
              className={`px-3 py-1.5 text-xs font-semibold capitalize transition ${
                fsPeriod === p ? 'bg-terminal-cyan text-terminal-bg' : 'text-terminal-textMuted hover:text-terminal-text'
              }`}>
              {p === 'annual' ? 'Annual' : 'Quarterly'}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {([['income', 'Income Statement'], ['balance', 'Balance Sheet'], ['cashflow', 'Cash Flow']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setFsTab(k)}
              className={`px-3 py-1.5 text-xs rounded transition ${
                fsTab === k ? 'bg-terminal-surfaceHi text-terminal-cyan font-semibold border border-terminal-cyan/30' : 'text-terminal-textMuted hover:text-terminal-text hover:bg-terminal-surfaceHi'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {fsTab === 'income'   && <IncomeStatementPanel data={financials.income_statement} />}
      {fsTab === 'balance'  && <BalanceSheetPanel data={financials.balance_sheet} />}
      {fsTab === 'cashflow' && <CashFlowPanel data={financials.cash_flow} />}
    </div>
  );
}

// ── Income Statement ──────────────────────────────────────────────────────────
function IncomeStatementPanel({ data }: { data: ISRow[] }) {
  if (!data.length) return <EmptyState msg="No income statement data available." />;

  const chartData = data.map((r) => ({
    date: shortDate(r.date),
    Revenue: r.revenue,
    'Gross Profit': r.gross_profit,
    'Net Income': r.net_income,
  }));

  const metrics: { key: keyof ISRow; label: string; fmt: (v: number | null) => string; info: string }[] = [
    { key: 'revenue',          label: 'Revenue',           fmt: (v) => fmtBig(v), info: 'Total sales before any deductions or expenses' },
    { key: 'gross_profit',     label: 'Gross Profit',      fmt: (v) => fmtBig(v), info: 'Revenue minus Cost of Goods Sold (COGS)' },
    { key: 'ebitda',           label: 'EBITDA',            fmt: (v) => fmtBig(v), info: 'Earnings Before Interest, Taxes, Depreciation & Amortization — operating cash earnings proxy' },
    { key: 'operating_income', label: 'Operating Income',  fmt: (v) => fmtBig(v), info: 'Profit from core business after COGS and operating expenses' },
    { key: 'net_income',       label: 'Net Income',        fmt: (v) => fmtBig(v), info: 'Bottom-line profit after all expenses, interest and taxes' },
    { key: 'rd_expense',       label: 'R&D Expense',       fmt: (v) => fmtBig(v), info: 'Research & Development spending — key for tech/pharma growth assessment' },
    { key: 'gross_margin',     label: 'Gross Margin',      fmt: (v) => fmtPct(v), info: 'Gross Profit / Revenue — measures production cost efficiency' },
    { key: 'operating_margin', label: 'Operating Margin',  fmt: (v) => fmtPct(v), info: 'Operating Income / Revenue — operational profitability before interest & taxes' },
    { key: 'net_margin',       label: 'Net Margin',        fmt: (v) => fmtPct(v), info: 'Net Income / Revenue — final % of revenue that becomes profit' },
  ];

  return (
    <div className="space-y-4">
      <FinChart data={chartData} keys={['Revenue', 'Gross Profit', 'Net Income']}
        colors={['#00d9ff', '#26a69a', '#f9a825']} title="Revenue · Gross Profit · Net Income" />
      <FinTable data={data} metrics={metrics} />
    </div>
  );
}

// ── Balance Sheet ─────────────────────────────────────────────────────────────
function BalanceSheetPanel({ data }: { data: BSRow[] }) {
  if (!data.length) return <EmptyState msg="No balance sheet data available." />;

  const chartData = data.map((r) => ({
    date: shortDate(r.date),
    'Total Assets': r.total_assets,
    'Total Debt':   r.total_debt,
    Cash:           r.cash,
    Equity:         r.equity,
  }));

  const metrics: { key: keyof BSRow; label: string; fmt: (v: number | null) => string; info: string }[] = [
    { key: 'total_assets',      label: 'Total Assets',      fmt: (v) => fmtBig(v), info: 'Everything the company owns — current assets + long-term assets' },
    { key: 'total_liabilities', label: 'Total Liabilities', fmt: (v) => fmtBig(v), info: 'All debts, obligations and financial commitments' },
    { key: 'equity',            label: 'Equity',            fmt: (v) => fmtBig(v), info: "Shareholders' equity = Total Assets − Total Liabilities. Net worth." },
    { key: 'cash',              label: 'Cash & Equiv.',     fmt: (v) => fmtBig(v), info: 'Cash on hand + short-term highly liquid investments' },
    { key: 'total_debt',        label: 'Total Debt',        fmt: (v) => fmtBig(v), info: 'Short-term + long-term financial borrowings and bonds' },
    { key: 'net_debt',          label: 'Net Debt',          fmt: (v) => fmtBig(v), info: 'Total Debt − Cash. True debt burden; negative = more cash than debt.' },
  ];

  return (
    <div className="space-y-4">
      <FinChart data={chartData} keys={['Total Assets', 'Total Debt', 'Cash', 'Equity']}
        colors={['#00d9ff', '#ef5350', '#26a69a', '#f9a825']} title="Balance Sheet Evolution" />
      <FinTable data={data} metrics={metrics} />
    </div>
  );
}

// ── Cash Flow ─────────────────────────────────────────────────────────────────
function CashFlowPanel({ data }: { data: CFRow[] }) {
  if (!data.length) return <EmptyState msg="No cash flow data available." />;

  const chartData = data.map((r) => ({
    date: shortDate(r.date),
    'Operating CF': r.operating_cf,
    'Free CF':      r.free_cf,
    CapEx:          r.capex ? Math.abs(r.capex) : null,
  }));

  const metrics: { key: keyof CFRow; label: string; fmt: (v: number | null) => string; info: string }[] = [
    { key: 'operating_cf', label: 'Operating CF', fmt: (v) => fmtBig(v), info: 'Cash generated from core business operations. Should be positive and growing.' },
    { key: 'investing_cf', label: 'Investing CF', fmt: (v) => fmtBig(v), info: 'Cash used for asset purchases, acquisitions and investments (usually negative)' },
    { key: 'financing_cf', label: 'Financing CF', fmt: (v) => fmtBig(v), info: 'Cash flow from debt issuance/repayment, dividends, stock buybacks' },
    { key: 'capex',        label: 'CapEx',        fmt: (v) => fmtBig(v), info: 'Capital Expenditures — spending on PP&E and infrastructure maintenance/growth' },
    { key: 'free_cf',      label: 'Free CF',      fmt: (v) => fmtBig(v), info: 'Operating CF − CapEx. Cash freely available to investors, debt repayment or buybacks.' },
  ];

  return (
    <div className="space-y-4">
      <FinChart data={chartData} keys={['Operating CF', 'Free CF', 'CapEx']}
        colors={['#26a69a', '#00d9ff', '#ef6c00']} title="Operating CF · Free CF · CapEx" />
      <FinTable data={data} metrics={metrics} />
    </div>
  );
}

// ── Shared FinChart ───────────────────────────────────────────────────────────
function FinChart({ data, keys, colors, title }: {
  data: Record<string, string | number | null>[]; keys: string[]; colors: string[]; title: string;
}) {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <p className="text-xs text-terminal-textMuted uppercase tracking-wider mb-4">{title}</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barCategoryGap="30%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,48,64,0.4)" />
          <XAxis dataKey="date" tick={{ fill: '#7a8294', fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: '#7a8294', fontSize: 10 }} tickLine={false} axisLine={false}
            tickFormatter={(v) => fmtBig(v as number, '')} width={52} />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown) => fmtBig(typeof v === 'number' ? v : null)} />
          {keys.map((k, i) => <Bar key={k} dataKey={k} fill={colors[i]} radius={[3, 3, 0, 0]} maxBarSize={40} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Shared FinTable ───────────────────────────────────────────────────────────
function FinTable<T extends { date: string }>({
  data, metrics,
}: {
  data: T[];
  metrics: { key: keyof T; label: string; fmt: (v: number | null) => string; info?: string }[];
}) {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-terminal-border">
              <th className="px-4 py-3 text-left text-xs font-semibold text-terminal-textMuted uppercase tracking-wider w-40">Metric</th>
              {data.map((r) => (
                <th key={r.date} className="px-4 py-3 text-right text-xs font-semibold text-terminal-textMuted uppercase tracking-wider num">
                  {shortDate(r.date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map(({ key, label, fmt, info }, mi) => (
              <tr key={String(key)} className={`border-b border-terminal-border/30 ${mi % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                <td className="px-4 py-2.5 text-terminal-textMuted text-xs">
                  <span className="inline-flex items-center gap-0">
                    {label}
                    {info && <InfoTip text={info} />}
                  </span>
                </td>
                {data.map((r) => {
                  const v = r[key] as number | null;
                  const isNeg = v != null && v < 0;
                  return (
                    <td key={r.date} className={`px-4 py-2.5 text-right num text-sm font-semibold ${isNeg ? 'text-red-400' : 'text-terminal-cyan'}`}>
                      {fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AnalysisTab — Earnings + Analyst + FOMO
// ─────────────────────────────────────────────────────────────────────────────

function AnalysisTab({
  financials, isLoading, quote, fomoResult,
}: {
  financials: FinancialsData | undefined;
  isLoading: boolean;
  quote: QuoteData | undefined;
  fomoResult: FomoResult | null;
}) {
  if (isLoading) return (
    <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <SkeletonBlock key={i} className="h-64 w-full" />)}</div>
  );
  if (!financials) return <div className="text-terminal-textMuted text-sm">No analysis data available.</div>;

  const { earnings, analyst } = financials;

  const earningsData = earnings.map((e) => ({
    label:        e.period || shortDate(e.date),
    eps_actual:   e.eps_actual,
    eps_estimate: e.eps_estimate,
    surprise:     e.surprise_pct,
    beat:         e.eps_actual != null && e.eps_estimate != null && e.eps_actual >= e.eps_estimate,
  }));

  const rec = analyst.recommendations;
  const pieCols = ['#26a69a', '#4caf50', '#7a8294', '#ef6c00', '#ef5350'];
  const pieData = rec ? [
    { name: 'Strong Buy',  value: rec.strong_buy,  color: pieCols[0] },
    { name: 'Buy',         value: rec.buy,         color: pieCols[1] },
    { name: 'Hold',        value: rec.hold,        color: pieCols[2] },
    { name: 'Sell',        value: rec.sell,        color: pieCols[3] },
    { name: 'Strong Sell', value: rec.strong_sell, color: pieCols[4] },
  ].filter((d) => d.value > 0) : [];

  const pt = analyst.price_targets;
  const currentPrice = quote?.price;

  return (
    <div className="space-y-6">

      {/* ── FOMO Indicator ── */}
      <FomoCard fomoResult={fomoResult} />

      {/* ── Earnings History ── */}
      {earningsData.length > 0 ? (
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
            EPS — Actual vs Estimate
            <InfoTip text="Quarterly EPS: green bars = beat estimate, red = missed. Consistent beats signal strong execution." dir="bottom" />
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={earningsData} barCategoryGap="30%" barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,48,64,0.4)" />
              <XAxis dataKey="label" tick={{ fill: '#7a8294', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#7a8294', fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip {...TOOLTIP_STYLE}
                formatter={(v: unknown) => [`$${typeof v === 'number' ? v.toFixed(2) : String(v)}`]} />
              <ReferenceLine y={0} stroke="#2a3040" />
              <Bar dataKey="eps_estimate" fill="#7a8294" name="Estimate" radius={[3,3,0,0]} maxBarSize={30} />
              <Bar dataKey="eps_actual" name="Actual" radius={[3,3,0,0]} maxBarSize={30}>
                {earningsData.map((e, i) => (
                  <Cell key={i} fill={e.beat ? '#26a69a' : '#ef5350'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border text-terminal-textMuted">
                  <th className="py-2 text-left">Quarter</th>
                  <th className="py-2 text-right num">
                    Estimate <InfoTip text="Consensus EPS estimate from analyst forecasts before the report" />
                  </th>
                  <th className="py-2 text-right num">
                    Actual <InfoTip text="Reported EPS from the earnings release" />
                  </th>
                  <th className="py-2 text-right num">
                    Surprise <InfoTip text="% difference between Actual and Estimate. Positive = beat, negative = miss." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...earningsData].reverse().map((e, i) => (
                  <tr key={i} className="border-b border-terminal-border/30">
                    <td className="py-2 text-terminal-textMuted">{e.label}</td>
                    <td className="py-2 text-right num">{e.eps_estimate != null ? `$${e.eps_estimate.toFixed(2)}` : '—'}</td>
                    <td className={`py-2 text-right num font-semibold ${e.beat ? 'text-green-400' : 'text-red-400'}`}>
                      {e.eps_actual != null ? `$${e.eps_actual.toFixed(2)}` : '—'}
                    </td>
                    <td className={`py-2 text-right num font-semibold ${e.beat ? 'text-green-400' : 'text-red-400'}`}>
                      {e.surprise != null ? `${e.surprise >= 0 ? '+' : ''}${e.surprise.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState msg="No earnings history available." />
      )}

      {/* ── Analyst Recommendations + Price Targets ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Donut */}
        {pieData.length > 0 ? (
          <div className="bg-terminal-surface border border-terminal-border rounded p-4">
            <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
              Analyst Consensus {pt?.count ? `(${pt.count} analysts)` : ''}
              <InfoTip text="Current distribution of analyst recommendations — Strong Buy through Strong Sell. Source: Yahoo Finance." dir="bottom" />
            </h3>
            <div className="flex items-center gap-4">
              <PieChart width={160} height={160}>
                <Pie data={pieData} cx={75} cy={75} innerRadius={45} outerRadius={70}
                  dataKey="value" paddingAngle={2}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown) => [`${v} analysts`]} />
              </PieChart>
              <div className="space-y-1.5">
                {pieData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="text-terminal-text">{d.name}</span>
                    <span className="ml-auto num font-semibold text-terminal-cyan">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState msg="No analyst recommendations available." />
        )}

        {/* Price Targets */}
        {pt && (pt.low != null || pt.mean != null || pt.high != null) ? (
          <div className="bg-terminal-surface border border-terminal-border rounded p-4">
            <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
              Price Targets
              <InfoTip text="12-month price targets from analysts. The white dot shows current price vs the analyst range." dir="bottom" />
            </h3>
            <PriceTargetBar
              low={pt.low}
              mean={pt.mean}
              high={pt.high}
              current={currentPrice ?? null}
            />
          </div>
        ) : (
          <EmptyState msg="No price targets available." />
        )}
      </div>
    </div>
  );
}

// ── FOMO Semicircular Gauge ───────────────────────────────────────────────────
function FomoGauge({ score }: { score: number }) {
  const W = 220, H = 128;
  const cx = W / 2;   // 110
  const cy = H - 13;  // 115 — pivot sits near bottom
  const R  = 90;
  const SW = 18;      // track stroke width

  // Angle in standard math convention (0=right, π=left, CCW positive)
  const toAngle = (s: number) => Math.PI * (1 - s / 100);
  const ptOnArc = (s: number, r: number) => ({
    x: +(cx + r * Math.cos(toAngle(s))).toFixed(2),
    y: +(cy - r * Math.sin(toAngle(s))).toFixed(2),
  });

  const start = ptOnArc(0, R);    // left arc tip  (20, 115)
  const end   = ptOnArc(100, R);  // right arc tip (200, 115)
  const sPt   = ptOnArc(Math.min(score, 99.9), R); // active arc end

  // SVG arc: sweep-flag=1 → clockwise in SVG = goes over the top ✓
  const bgArc     = `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y}`;
  const activeArc = score <= 0 ? null
    : score >= 100 ? bgArc
    : `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${sPt.x} ${sPt.y}`;

  // Needle tip (slightly inside the track centre-line)
  const needleLen = R - SW / 2 - 3;
  const nPt = ptOnArc(score, needleLen);

  const { label, ringColor } = getFomoMeta(score);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }}>
      <defs>
        {/* Full-brightness gradient (blue→gray→yellow→orange→red) */}
        <linearGradient id="fg-active" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#3b82f6" />
          <stop offset="25%"  stopColor="#6b7280" />
          <stop offset="50%"  stopColor="#eab308" />
          <stop offset="75%"  stopColor="#f97316" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
        {/* Dim version — shows the full scale as background */}
        <linearGradient id="fg-dim" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#3b82f6" stopOpacity="0.18" />
          <stop offset="25%"  stopColor="#6b7280" stopOpacity="0.18" />
          <stop offset="50%"  stopColor="#eab308" stopOpacity="0.18" />
          <stop offset="75%"  stopColor="#f97316" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.18" />
        </linearGradient>
      </defs>

      {/* Dark border track */}
      <path d={bgArc} fill="none" stroke="#080c14" strokeWidth={SW + 6} strokeLinecap="round" />

      {/* Dim full-range arc — the "dial background" */}
      <path d={bgArc} fill="none" stroke="url(#fg-dim)" strokeWidth={SW} strokeLinecap="round" />

      {/* Active arc — lights up from 0 to score */}
      {activeArc && (
        <path d={activeArc} fill="none" stroke="url(#fg-active)" strokeWidth={SW} strokeLinecap="round" />
      )}

      {/* Needle */}
      <line x1={cx} y1={cy} x2={nPt.x} y2={nPt.y}
        stroke="white" strokeWidth={2.5} strokeLinecap="round" opacity={0.9} />
      {/* Needle pivot */}
      <circle cx={cx} cy={cy} r={5}   fill="white" opacity={0.9} />
      <circle cx={cx} cy={cy} r={2.5} fill="#080c14" />

      {/* Score number */}
      <text x={cx} y={cy - 24} textAnchor="middle"
        fill="white" fontSize={30} fontWeight="bold" fontFamily="'Courier New', monospace">
        {score}
      </text>
      {/* Label */}
      <text x={cx} y={cy - 8} textAnchor="middle"
        fill={ringColor} fontSize={11} fontWeight="700" fontFamily="sans-serif">
        {label}
      </text>

      {/* Scale end labels */}
      <text x={start.x + 2} y={start.y} dominantBaseline="hanging"
        textAnchor="start" fill="#374151" fontSize={9} fontFamily="sans-serif">0</text>
      <text x={end.x - 2} y={end.y} dominantBaseline="hanging"
        textAnchor="end" fill="#374151" fontSize={9} fontFamily="sans-serif">100</text>
    </svg>
  );
}

// ── FOMO Indicator Card ───────────────────────────────────────────────────────
function FomoCard({ fomoResult }: { fomoResult: FomoResult | null }) {
  if (!fomoResult) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded p-4">
        <div className="flex items-center gap-2 text-terminal-textMuted text-sm">
          <span className="animate-pulse">●</span>
          Computing FOMO indicator…
        </div>
      </div>
    );
  }

  const { score, breakdown } = fomoResult;
  const { ringColor, bgColor } = getFomoMeta(score);

  const items: { key: keyof FomoResult['breakdown']; label: string; max: number; info: string }[] = [
    { key: 'momentum', label: 'Price Momentum 30d', max: 30, info: 'Price change over last 30 days. +20% → max 30pts' },
    { key: 'volume',   label: 'Volume Surge',       max: 20, info: "Today's volume vs 20-day average. 2× avg → max 20pts" },
    { key: 'analyst',  label: 'Analyst Consensus',  max: 25, info: 'Weighted bullish analyst rating (Strong Buy weighted more). Max 25pts' },
    { key: 'eps',      label: 'EPS Beat History',   max: 25, info: 'Average EPS surprise over last 4 quarters. +10% avg → max 25pts' },
  ];

  return (
    <div className={`bg-terminal-surface border border-terminal-border rounded p-4 ${bgColor}`}>
      {/* Title */}
      <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
        FOMO Indicator
        <InfoTip
          text="Composite momentum score 0–100. Components: price momentum (30pts), volume surge (20pts), analyst consensus (25pts), EPS beat history (25pts)."
          dir="bottom"
        />
      </h3>

      {/* Gauge + breakdown side by side on larger screens */}
      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Semicircular gauge */}
        <div className="shrink-0">
          <FomoGauge score={score} />
          {/* Colour scale legend */}
          <div className="flex justify-between mt-1 px-1 text-[9px]">
            <span className="text-blue-400/60">Froid</span>
            <span className="text-gray-400/60">Neutre</span>
            <span className="text-yellow-400/60">Momentum</span>
            <span className="text-orange-400/60">Chaud</span>
            <span className="text-red-400/60">FOMO</span>
          </div>
        </div>

        {/* Breakdown bars */}
        <div className="flex-1 w-full space-y-3">
          {items.map(({ key, label: itemLabel, max, info }) => {
            const pts = breakdown[key];
            const pct = (pts / max) * 100;
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-terminal-textMuted inline-flex items-center">
                    {itemLabel}
                    <InfoTip text={info} />
                  </span>
                  <span className="text-xs num font-semibold text-terminal-text">
                    {pts}<span className="text-terminal-textDim">/{max}</span>
                  </span>
                </div>
                <div className="h-1.5 bg-terminal-bg rounded-full overflow-hidden">
                  <div className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: ringColor + 'cc' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Price target visual bar ───────────────────────────────────────────────────
function PriceTargetBar({ low, mean, high, current }: {
  low: number | null; mean: number | null; high: number | null; current: number | null;
}) {
  const allVals = [low, mean, high, current].filter((v): v is number => v != null);
  if (!allVals.length) return null;
  const min = Math.min(...allVals) * 0.95;
  const max = Math.max(...allVals) * 1.05;
  const range = max - min;
  const pct = (v: number) => ((v - min) / range) * 100;

  return (
    <div className="space-y-4 pt-2">
      {/* Bar area with floating "Current price" label above dot */}
      <div className="relative pt-9">
        {/* Floating label for current price — anchored above the dot */}
        {current != null && (
          <div
            className="absolute top-0 flex flex-col items-center pointer-events-none"
            style={{ left: `${pct(current)}%`, transform: 'translateX(-50%)' }}
          >
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-white/10 border border-white/25 rounded px-1.5 py-0.5 whitespace-nowrap">
              ● Current price
            </span>
            {/* Arrow pointing down to bar */}
            <svg width="8" height="5" viewBox="0 0 8 5" className="mt-0.5 shrink-0">
              <path d="M4 5L0 0h8z" fill="rgba(255,255,255,0.25)" />
            </svg>
          </div>
        )}

        {/* Bar track */}
        <div className="relative h-3.5 bg-terminal-bg rounded-full">
          {/* Range fill between low and high */}
          {low != null && high != null && (
            <div
              className="absolute h-full bg-terminal-cyan/20 rounded-full"
              style={{ left: `${pct(low)}%`, width: `${pct(high) - pct(low)}%` }}
            />
          )}
          {/* Mean target line */}
          {mean != null && (
            <div
              className="absolute h-full w-0.5 bg-terminal-cyan"
              style={{ left: `${pct(mean)}%` }}
            />
          )}
          {/* Current price dot — overlaid on bar track */}
          {current != null && (
            <div
              className="absolute top-1/2 w-4 h-4 rounded-full bg-white border-2 border-terminal-bg shadow-lg -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${pct(current)}%` }}
            />
          )}
        </div>
      </div>

      {/* Labels below bar */}
      <div className="flex flex-col gap-2">
        {low != null && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-terminal-textMuted">
              Low <InfoTip text="Lowest analyst 12-month price target" />
            </span>
            <span className="num font-semibold text-terminal-textMuted">${low.toFixed(0)}</span>
          </div>
        )}
        {mean != null && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-terminal-cyan">
              Mean <InfoTip text="Average of all analyst 12-month price targets — the consensus target" />
            </span>
            <span className="num font-semibold text-terminal-cyan">${mean.toFixed(0)}</span>
          </div>
        )}
        {high != null && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-green-400">
              High <InfoTip text="Most optimistic analyst 12-month price target" />
            </span>
            <span className="num font-semibold text-green-400">${high.toFixed(0)}</span>
          </div>
        )}
        {current != null && (
          <div className="flex items-center justify-between text-sm border-t border-terminal-border pt-2 mt-1">
            <span className="text-white font-semibold">● Current price</span>
            <span className="num font-bold text-white">${current.toFixed(2)}</span>
          </div>
        )}
        {mean != null && current != null && (
          <div className="text-xs text-terminal-textMuted">
            Upside to mean:{' '}
            <span className={`font-semibold num ${mean > current ? 'text-green-400' : 'text-red-400'}`}>
              {mean > current ? '+' : ''}{(((mean - current) / current) * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-8 text-center text-terminal-textMuted text-sm">
      {msg}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatNewsDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const diffMs = Date.now() - d.getTime();
    const diffH = Math.floor(diffMs / 3_600_000);
    if (diffH < 1) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}
