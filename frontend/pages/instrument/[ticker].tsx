/**
 * Instrument Page — /instrument/{ticker}
 *
 * 3 tabs:
 *   Chart      — price chart (12 timeframes) + key stats + news
 *   Financials — Income Statement / Balance Sheet / Cash Flow (annual/quarterly)
 *   Analysis   — Earnings EPS history + Analyst recommendations + price targets
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

// Financial statement row
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

  const [activeTab, setActiveTab]       = useState<PageTab>('chart');
  const [selectedLabel, setSelectedLabel] = useState('1Y');
  const [chartType, setChartType]       = useState<ChartType>('area');
  const [fsPeriod, setFsPeriod]         = useState<'annual' | 'quarterly'>('annual');
  const [fsTab, setFsTab]               = useState<'income' | 'balance' | 'cashflow'>('income');

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

          {/* Quick stats row */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {quote && <Stat label="Volume" value={`${(quote.volume / 1_000_000).toFixed(1)}M`} />}
            {fundamentals?.market_cap && <Stat label="Mkt Cap" value={fmtBig(fundamentals.market_cap)} />}
            {fundamentals?.pe_ratio    && <Stat label="P/E"     value={`${fundamentals.pe_ratio.toFixed(1)}x`} />}
            {fundamentals?.eps         && <Stat label="EPS"     value={`$${fundamentals.eps.toFixed(2)}`} />}
            {fundamentals?.beta        && <Stat label="Beta"    value={fundamentals.beta.toFixed(2)} />}
            {fundamentals?.dividend_yield && <Stat label="Div Yield" value={fmtPct(fundamentals.dividend_yield)} />}
            {fundamentals?.revenue_ttm && <Stat label="Rev TTM" value={fmtBig(fundamentals.revenue_ttm)} />}
            {fundamentals?.gross_margin && <Stat label="Gross Margin" value={fmtPct(fundamentals.gross_margin)} />}
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
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small reusable components
// ─────────────────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-terminal-textMuted text-xs">{label}</span>
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
        {/* Period toggle */}
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
        {/* Statement tabs */}
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

  const metrics: { key: keyof ISRow; label: string; fmt: (v: number | null) => string }[] = [
    { key: 'revenue',          label: 'Revenue',           fmt: (v) => fmtBig(v) },
    { key: 'gross_profit',     label: 'Gross Profit',      fmt: (v) => fmtBig(v) },
    { key: 'ebitda',           label: 'EBITDA',            fmt: (v) => fmtBig(v) },
    { key: 'operating_income', label: 'Operating Income',  fmt: (v) => fmtBig(v) },
    { key: 'net_income',       label: 'Net Income',        fmt: (v) => fmtBig(v) },
    { key: 'rd_expense',       label: 'R&D Expense',       fmt: (v) => fmtBig(v) },
    { key: 'gross_margin',     label: 'Gross Margin',      fmt: (v) => fmtPct(v) },
    { key: 'operating_margin', label: 'Operating Margin',  fmt: (v) => fmtPct(v) },
    { key: 'net_margin',       label: 'Net Margin',        fmt: (v) => fmtPct(v) },
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
    'Total Assets':    r.total_assets,
    'Total Debt':      r.total_debt,
    Cash:              r.cash,
    Equity:            r.equity,
  }));

  const metrics: { key: keyof BSRow; label: string; fmt: (v: number | null) => string }[] = [
    { key: 'total_assets',      label: 'Total Assets',      fmt: (v) => fmtBig(v) },
    { key: 'total_liabilities', label: 'Total Liabilities', fmt: (v) => fmtBig(v) },
    { key: 'equity',            label: 'Equity',            fmt: (v) => fmtBig(v) },
    { key: 'cash',              label: 'Cash & Equiv.',     fmt: (v) => fmtBig(v) },
    { key: 'total_debt',        label: 'Total Debt',        fmt: (v) => fmtBig(v) },
    { key: 'net_debt',          label: 'Net Debt',          fmt: (v) => fmtBig(v) },
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

  const metrics: { key: keyof CFRow; label: string; fmt: (v: number | null) => string }[] = [
    { key: 'operating_cf',  label: 'Operating CF',  fmt: (v) => fmtBig(v) },
    { key: 'investing_cf',  label: 'Investing CF',  fmt: (v) => fmtBig(v) },
    { key: 'financing_cf',  label: 'Financing CF',  fmt: (v) => fmtBig(v) },
    { key: 'capex',         label: 'CapEx',         fmt: (v) => fmtBig(v) },
    { key: 'free_cf',       label: 'Free CF',       fmt: (v) => fmtBig(v) },
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
  metrics: { key: keyof T; label: string; fmt: (v: number | null) => string }[];
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
            {metrics.map(({ key, label, fmt }, mi) => (
              <tr key={String(key)} className={`border-b border-terminal-border/30 ${mi % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                <td className="px-4 py-2.5 text-terminal-textMuted text-xs">{label}</td>
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
// AnalysisTab — Earnings + Analyst
// ─────────────────────────────────────────────────────────────────────────────

function AnalysisTab({
  financials, isLoading, quote,
}: {
  financials: FinancialsData | undefined;
  isLoading: boolean;
  quote: QuoteData | undefined;
}) {
  if (isLoading) return (
    <div className="space-y-4">{Array.from({ length: 2 }).map((_, i) => <SkeletonBlock key={i} className="h-64 w-full" />)}</div>
  );
  if (!financials) return <div className="text-terminal-textMuted text-sm">No analysis data available.</div>;

  const { earnings, analyst } = financials;

  // ── Earnings chart data ───────────────────────────────────────────────────
  const earningsData = earnings.map((e) => ({
    label:        e.period || shortDate(e.date),
    eps_actual:   e.eps_actual,
    eps_estimate: e.eps_estimate,
    surprise:     e.surprise_pct,
    beat:         e.eps_actual != null && e.eps_estimate != null && e.eps_actual >= e.eps_estimate,
  }));

  // ── Analyst pie data ──────────────────────────────────────────────────────
  const rec = analyst.recommendations;
  const pieCols = ['#26a69a', '#4caf50', '#7a8294', '#ef6c00', '#ef5350'];
  const pieData = rec ? [
    { name: 'Strong Buy', value: rec.strong_buy,  color: pieCols[0] },
    { name: 'Buy',        value: rec.buy,         color: pieCols[1] },
    { name: 'Hold',       value: rec.hold,        color: pieCols[2] },
    { name: 'Sell',       value: rec.sell,        color: pieCols[3] },
    { name: 'Strong Sell',value: rec.strong_sell, color: pieCols[4] },
  ].filter((d) => d.value > 0) : [];

  const pt = analyst.price_targets;
  const currentPrice = quote?.price;

  return (
    <div className="space-y-6">

      {/* ── Earnings History ── */}
      {earningsData.length > 0 ? (
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
            EPS — Actual vs Estimate
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
          {/* Surprise table */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border text-terminal-textMuted">
                  <th className="py-2 text-left">Quarter</th>
                  <th className="py-2 text-right num">Estimate</th>
                  <th className="py-2 text-right num">Actual</th>
                  <th className="py-2 text-right num">Surprise</th>
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

  const labels: { val: number; label: string; color: string }[] = [
    ...(low   != null ? [{ val: low,   label: `Low $${low.toFixed(0)}`,    color: '#7a8294' }] : []),
    ...(mean  != null ? [{ val: mean,  label: `Mean $${mean.toFixed(0)}`,  color: '#00d9ff' }] : []),
    ...(high  != null ? [{ val: high,  label: `High $${high.toFixed(0)}`,  color: '#26a69a' }] : []),
  ];

  return (
    <div className="space-y-6 pt-2">
      {/* Bar */}
      <div className="relative h-4 bg-terminal-bg rounded-full overflow-hidden">
        {low != null && high != null && (
          <div className="absolute h-full bg-terminal-cyan/20 rounded-full"
            style={{ left: `${pct(low)}%`, width: `${pct(high) - pct(low)}%` }} />
        )}
        {mean != null && (
          <div className="absolute h-full w-0.5 bg-terminal-cyan"
            style={{ left: `${pct(mean)}%` }} />
        )}
        {current != null && (
          <div className="absolute top-0 w-3 h-3 rounded-full bg-white border-2 border-terminal-bg -translate-y-0 mt-0.5 -translate-x-1/2"
            style={{ left: `${pct(current)}%` }} />
        )}
      </div>
      {/* Labels */}
      <div className="flex flex-col gap-2">
        {labels.map((l) => (
          <div key={l.label} className="flex items-center justify-between text-sm">
            <span style={{ color: l.color }}>{l.label.split(' ')[0]}</span>
            <span className="num font-semibold" style={{ color: l.color }}>{l.label.split(' ')[1]}</span>
          </div>
        ))}
        {current != null && (
          <div className="flex items-center justify-between text-sm border-t border-terminal-border pt-2 mt-1">
            <span className="text-white">Current</span>
            <span className="num font-bold text-white">${current.toFixed(2)}</span>
          </div>
        )}
        {mean != null && current != null && (
          <div className="text-xs text-terminal-textMuted mt-1">
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
