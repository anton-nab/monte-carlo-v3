/**
 * Instrument Page — /instrument/{ticker}
 *
 * Tabs:
 *   Chart      — price chart (12 timeframes) + news
 *   Financials — IS / BS / CF (annual or quarterly)
 *   Analysis   — EPS vs estimates + analyst recs + price targets + FOMO indicator
 *   ETF        — shown only for ETFs: holdings, sector & country breakdown,
 *                monthly returns heatmap, annual performance
 */

import { useRouter } from 'next/router';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import useSWR from 'swr';
import { useWebSocket, lookupPrice, isWsUnsupported } from '../../hooks/useWebSocket';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ReferenceLine,
  ComposedChart, Line,
} from 'recharts';
import { TradingViewChart, ChartType, OverlayLine, VolumePoint } from '../../components/TradingViewChart';
import { fetcher } from '../../lib/fetcher';
import { Header } from '../../components/Header';
import { ema, rsi as computeRsi, macd as computeMacd, bollinger, cvd as computeCvd, CvdPoint } from '../../lib/indicators';

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
interface EtfProfile {
  ticker: string;
  sector_weightings:  { sector: string;  weight_pct: number }[];
  country_weightings: { country: string; weight_pct: number }[];
  asset_classes: Record<string, number>;
}
interface FomoResult {
  score: number;
  breakdown: { momentum: number; volume: number; analyst: number; eps: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
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

/** 15 distinct colours for pies / breakdown bars */
const PIE_PALETTE = [
  '#00d9ff', '#26a69a', '#f9a825', '#ef6c00', '#4caf50',
  '#2196f3', '#9c27b0', '#ff5722', '#607d8b', '#8bc34a',
  '#e91e63', '#00bcd4', '#ff9800', '#3f51b5', '#009688',
];
/** Fixed colours by sector name */
const SECTOR_COLORS: Record<string, string> = {
  'Technology': '#00d9ff', 'Information Technology': '#00d9ff',
  'Healthcare': '#26a69a', 'Health Care': '#26a69a',
  'Financial Services': '#f9a825', 'Financials': '#f9a825',
  'Consumer Cyclical': '#ef6c00', 'Consumer Discretionary': '#ef6c00',
  'Consumer Defensive': '#4caf50', 'Consumer Staples': '#4caf50',
  'Industrials': '#2196f3',
  'Communication Services': '#9c27b0', 'Communications': '#9c27b0',
  'Energy': '#ff5722',
  'Utilities': '#607d8b',
  'Real Estate': '#795548',
  'Basic Materials': '#8bc34a', 'Materials': '#8bc34a',
};
function sectorColor(name: string, idx: number): string {
  return SECTOR_COLORS[name] ?? PIE_PALETTE[idx % PIE_PALETTE.length];
}

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
function shortDate(d: string): string {
  try {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  } catch { return d.slice(0, 7); }
}

/** Background + foreground colour for a monthly-return cell. */
function returnCellStyle(pct: number): { background: string; color: string } {
  if (Math.abs(pct) < 0.05) return { background: '#1a2035', color: '#6b7280' };
  const intensity = Math.min(Math.abs(pct) / 8, 1);
  if (pct > 0) {
    const l = Math.round(16 + intensity * 27);
    return { background: `hsl(142,70%,${l}%)`, color: `hsl(142,90%,${62 + Math.round(intensity * 23)}%)` };
  }
  const l = Math.round(16 + intensity * 27);
  return { background: `hsl(0,70%,${l}%)`, color: `hsl(0,90%,${62 + Math.round(intensity * 23)}%)` };
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`bg-terminal-border animate-pulse rounded ${className ?? ''}`} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// FOMO
// ─────────────────────────────────────────────────────────────────────────────

function computeFomoScore(
  chartData: HistoricalPoint[],
  currentVolume: number | undefined,
  financials: FinancialsData | undefined,
): FomoResult | null {
  if (!chartData.length) return null;
  let momentumPts = 0, volumePts = 0, analystPts = 0, epsPts = 0;

  const last = chartData[chartData.length - 1].close;
  const cutoffTime = Date.now() - 30 * 86_400_000;
  let refClose = chartData[0].close;
  for (let i = chartData.length - 1; i >= 0; i--) {
    if (new Date(chartData[i].date).getTime() <= cutoffTime) { refClose = chartData[i].close; break; }
  }
  const changePct = ((last - refClose) / refClose) * 100;
  momentumPts = Math.max(0, Math.min(30, ((changePct + 20) / 40) * 30));

  if (chartData.length >= 20 && currentVolume != null && currentVolume > 0) {
    const avgVol = chartData.slice(-20).reduce((s, p) => s + (p.volume ?? 0), 0) / 20;
    if (avgVol > 0) volumePts = Math.max(0, Math.min(20, (currentVolume / avgVol - 1) * 20));
  }

  if (financials?.analyst?.recommendations) {
    const r = financials.analyst.recommendations;
    const total = r.strong_buy + r.buy + r.hold + r.sell + r.strong_sell;
    if (total > 0) analystPts = Math.min(25, ((r.strong_buy * 1.0 + r.buy * 0.7) / total) * 35);
  }

  if (financials?.earnings?.length) {
    const sups = financials.earnings.slice(-4).filter(e => e.surprise_pct != null).map(e => e.surprise_pct as number);
    if (sups.length > 0) {
      const avg = sups.reduce((a, b) => a + b, 0) / sups.length;
      epsPts = Math.max(0, Math.min(25, ((avg + 10) / 20) * 25));
    }
  }

  return {
    score: Math.round(Math.min(100, momentumPts + volumePts + analystPts + epsPts)),
    breakdown: { momentum: Math.round(momentumPts), volume: Math.round(volumePts), analyst: Math.round(analystPts), eps: Math.round(epsPts) },
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
// Recharts tooltip style
// ─────────────────────────────────────────────────────────────────────────────
const TOOLTIP_STYLE = {
  contentStyle: { background: '#1a2035', border: '1px solid #2a3040', borderRadius: 4, fontSize: 11 },
  labelStyle: { color: '#7a8294' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

type PageTab = 'chart' | 'financials' | 'analysis' | 'etf';
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

  // ── Technical indicators state ─────────────────────────────────────────────
  type IndicatorKey = 'volume' | 'ema50' | 'ema100' | 'ema200' | 'bb' | 'rsi' | 'macd';
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorKey>>(new Set());
  const toggleIndicator = (k: IndicatorKey) =>
    setActiveIndicators(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  // ── Fullscreen state ──────────────────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [winHeight, setWinHeight] = useState(800);
  useEffect(() => {
    setWinHeight(window.innerHeight);
    const onResize = () => setWinHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Zoom synchronisation (TradingViewChart → RSI / MACD panels) ───────────
  const [chartVisibleDates, setChartVisibleDates] = useState<{ from: string; to: string } | null>(null);
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleChartRangeChange = useCallback((fromTs: number, toTs: number) => {
    if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = setTimeout(() => {
      setChartVisibleDates({
        from: new Date(fromTs * 1000).toISOString().substring(0, 10),
        to:   new Date(toTs   * 1000).toISOString().substring(0, 10),
      });
    }, 120);
  }, []);
  // Reset zoom state when timeframe changes
  useEffect(() => { setChartVisibleDates(null); }, [selectedLabel]);

  /** Filter sub-panel data to the currently visible chart window */
  const applyRange = useCallback(<T extends { date: string }>(arr: T[]): T[] => {
    if (!chartVisibleDates || arr.length === 0) return arr;
    const { from, to } = chartVisibleDates;
    return arr.filter(p => { const d = p.date.substring(0, 10); return d >= from && d <= to; });
  }, [chartVisibleDates]);

  const tf = TIMEFRAMES.find(t => t.label === selectedLabel) ?? TIMEFRAMES[9];

  // ── Live price via WebSocket (Phase 7) ─────────────────────────────────────
  const wsSymbols = useMemo(
    () => (tickerStr ? [tickerStr] : []),
    [tickerStr],
  );
  const { prices: livePrices, connected: wsConnected } = useWebSocket(wsSymbols);
  const livePrice  = tickerStr ? lookupPrice(livePrices, tickerStr) : undefined;

  // ── SWR fetches ────────────────────────────────────────────────────────────
  const { data: quoteRaw } = useSWR<QuoteData>(
    tickerStr ? `${API_URL}/api/instruments/quote/${tickerStr}` : null,
    fetcher, { refreshInterval: 30_000, dedupingInterval: 10_000 });

  // Merge WS live price into quote (keep change/change_pct from REST, update price from WS)
  const quote: QuoteData | undefined = useMemo(() => {
    if (!quoteRaw) return undefined;
    if (!livePrice) return quoteRaw;
    return { ...quoteRaw, price: livePrice.price };
  }, [quoteRaw, livePrice]);

  const { data: fundamentals } = useSWR<FundamentalsData>(
    tickerStr ? `${API_URL}/api/instruments/fundamentals/${tickerStr}` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 });

  const { data: chartResponse, isLoading: isLoadingChart, error: chartError } = useSWR<ChartResponse>(
    tickerStr ? `${API_URL}/api/instruments/chart/${tickerStr}?period=${tf.fetchPeriod}&interval=${tf.fetchInterval}` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 });

  const { data: news = [], isLoading: isLoadingNews } = useSWR<NewsItem[]>(
    tickerStr ? `${API_URL}/api/instruments/news/${tickerStr}` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 });

  const { data: etfHoldings = [], isLoading: isLoadingHoldings } = useSWR<EtfHolding[]>(
    tickerStr ? `${API_URL}/api/instruments/etf-holdings/${tickerStr}` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 86_400_000 });

  // Financials — lazy (Financials / Analysis tabs)
  const { data: financials, isLoading: isLoadingFS, error: financialsError } = useSWR<FinancialsData>(
    tickerStr && (activeTab === 'financials' || activeTab === 'analysis')
      ? `${API_URL}/api/instruments/financials/${tickerStr}?period=${fsPeriod}`
      : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 3_600_000, shouldRetryOnError: true, errorRetryCount: 2 });

  // FOMO sources — always active so score is consistent across all tabs
  const { data: fomoChart } = useSWR<ChartResponse>(
    tickerStr ? `${API_URL}/api/instruments/chart/${tickerStr}?period=6mo&interval=1d` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 3_600_000 });
  const { data: fomoFinancials } = useSWR<FinancialsData>(
    tickerStr ? `${API_URL}/api/instruments/financials/${tickerStr}?period=annual` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 3_600_000 });

  // ETF tab — lazy
  const { data: etfProfile, isLoading: isLoadingEtf } = useSWR<EtfProfile>(
    tickerStr && activeTab === 'etf'
      ? `${API_URL}/api/instruments/etf-profile/${tickerStr}` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 3_600_000 });
  const { data: monthlyChart } = useSWR<ChartResponse>(
    tickerStr && activeTab === 'etf'
      ? `${API_URL}/api/instruments/chart/${tickerStr}?period=max&interval=1mo` : null,
    fetcher, { revalidateOnFocus: false, dedupingInterval: 3_600_000 });

  // ── Chart data ─────────────────────────────────────────────────────────────
  const rawHistorical = chartResponse?.data ?? [];
  const historical: HistoricalPoint[] = useMemo(() => {
    if (tf.resampleHours && rawHistorical.length > 0) return resampleToNHour(rawHistorical, tf.resampleHours);
    return rawHistorical;
  }, [rawHistorical, tf.resampleHours]);
  const lineData  = useMemo(() => historical.map(p => ({ date: p.date, value: p.close })), [historical]);
  const ohlcData  = useMemo(() => historical.map(p => ({ date: p.date, open: p.open, high: p.high, low: p.low, close: p.close })), [historical]);
  const visibleRange = useMemo(() => {
    if (tf.isIntraday || !tf.visibleDays || historical.length === 0) return undefined;
    const lastDate = historical[historical.length - 1].date.split('T')[0];
    const fromDate = new Date(new Date(lastDate).getTime() - tf.visibleDays * 86_400_000).toISOString().split('T')[0];
    return { from: fromDate, to: lastDate };
  }, [historical, tf.isIntraday, tf.visibleDays]);

  // ── Technical indicator values ──────────────────────────────────────────────
  const closes = useMemo(() => historical.map(p => p.close), [historical]);
  const dates  = useMemo(() => historical.map(p => p.date),  [historical]);

  const ema50Vals  = useMemo(() => ema(closes, 50),  [closes]);
  const ema100Vals = useMemo(() => ema(closes, 100), [closes]);
  const ema200Vals = useMemo(() => ema(closes, 200), [closes]);
  const bbVals     = useMemo(() => bollinger(closes, 20, 2), [closes]);
  const rsiVals    = useMemo(() => computeRsi(closes, 14),   [closes]);
  const macdVals   = useMemo(() => computeMacd(closes),      [closes]);

  // Helper: zip dates + nullabe values into { date, value }[]
  const toOverlay = (vals: (number | null)[]): { date: string; value: number }[] =>
    dates.reduce<{ date: string; value: number }[]>((acc, d, i) => {
      if (vals[i] !== null) acc.push({ date: d, value: vals[i] as number });
      return acc;
    }, []);

  // Overlay lines for TradingViewChart
  const tvOverlays = useMemo((): OverlayLine[] => {
    const lines: OverlayLine[] = [];
    if (activeIndicators.has('ema50'))  lines.push({ data: toOverlay(ema50Vals),  color: '#ffa726', lineWidth: 1 });
    if (activeIndicators.has('ema100')) lines.push({ data: toOverlay(ema100Vals), color: '#42a5f5', lineWidth: 1 });
    if (activeIndicators.has('ema200')) lines.push({ data: toOverlay(ema200Vals), color: '#ef5350', lineWidth: 1 });
    if (activeIndicators.has('bb')) {
      lines.push({ data: toOverlay(bbVals.upper),  color: '#ab47bc', lineWidth: 1, lineStyle: 2 });
      lines.push({ data: toOverlay(bbVals.middle), color: '#ab47bc', lineWidth: 1, lineStyle: 1 });
      lines.push({ data: toOverlay(bbVals.lower),  color: '#ab47bc', lineWidth: 1, lineStyle: 2 });
    }
    return lines;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndicators, ema50Vals, ema100Vals, ema200Vals, bbVals]);

  // In-chart volume histogram (bottom 30 % of main LWC chart, green/red by candle)
  const tvVolumeData = useMemo((): VolumePoint[] => {
    if (!activeIndicators.has('volume')) return [];
    return historical.map((p) => ({
      date:  p.date,
      value: p.volume,
      color: p.close >= p.open ? '#00937166' : '#b92e2566',
    }));
  }, [activeIndicators, historical]);

  // CVD sub-panel data — per-bar volume delta (below the main chart)
  // delta > 0 → buyers dominated, delta < 0 → sellers dominated
  const cvdPanelData = useMemo((): (CvdPoint & { date: string })[] => {
    if (!activeIndicators.has('volume')) return [];
    const points = computeCvd(historical);
    return historical.map((p, i) => ({
      date:  p.date.split('T')[0],
      cvd:   points[i].cvd,
      delta: points[i].delta,
    }));
  }, [activeIndicators, historical]);

  // Sub-panel data: full dataset (applyRange() is called at render time for zoom sync)
  const rsiPanelData = useMemo(() =>
    activeIndicators.has('rsi')
      ? dates.map((d, i) => {
          const v = rsiVals[i];
          return { date: d.split('T')[0], rsi: v !== null ? +v.toFixed(2) : undefined };
        }).filter((p): p is { date: string; rsi: number } => p.rsi !== undefined)
      : [],
  [activeIndicators, dates, rsiVals]);

  const macdPanelData = useMemo(() =>
    activeIndicators.has('macd')
      ? dates.map((d, i) => {
          const h = macdVals.hist[i];
          if (h === null) return null;
          return {
            date:   d.split('T')[0],
            macd:   macdVals.macd[i]   !== null ? +(macdVals.macd[i]   as number).toFixed(4) : undefined,
            signal: macdVals.signal[i] !== null ? +(macdVals.signal[i] as number).toFixed(4) : undefined,
            hist:   +(h as number).toFixed(4),
          };
        }).filter(Boolean) as { date: string; macd?: number; signal?: number; hist: number }[]
      : [],
  [activeIndicators, dates, macdVals]);

  // ── FOMO ───────────────────────────────────────────────────────────────────
  const fomoResult = useMemo(
    () => computeFomoScore(fomoChart?.data ?? [], quote?.volume, fomoFinancials),
    [fomoChart, quote?.volume, fomoFinancials]);

  // ── ETF detection ──────────────────────────────────────────────────────────
  const isEtf = fundamentals?.type === 'etf' || etfHoldings.length > 0;

  if (!tickerStr) return (
    <div className="min-h-screen bg-terminal-bg flex items-center justify-center text-terminal-textMuted">Loading…</div>
  );

  const isPositive    = quote && quote.change >= 0;
  const changeColor   = isPositive ? 'text-green-500' : 'text-red-500';
  const changeBgColor = isPositive ? 'bg-green-500/10' : 'bg-red-500/10';
  const lineColor     = isPositive !== false ? '#26a69a' : '#ef5350';

  const tabs: { id: PageTab; label: string }[] = [
    { id: 'chart',      label: 'Chart' },
    { id: 'financials', label: 'Financials' },
    { id: 'analysis',   label: 'Analysis' },
    ...(isEtf ? [{ id: 'etf' as PageTab, label: 'ETF' }] : []),
  ];

  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text">

      {/* ── Global nav ── */}
      <Header />

      {/* ── Instrument header (ticker + price + stats) ── */}
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
                <div className="flex items-baseline justify-end gap-2">
                  <div className="text-2xl font-bold num">${quote.price.toFixed(2)}</div>
                  {livePrice ? (
                    <span className="text-2xs font-mono text-terminal-cyan px-1 py-0.5 border border-terminal-cyan/40 rounded tracking-wider">
                      LIVE
                    </span>
                  ) : wsConnected && tickerStr && !isWsUnsupported(tickerStr) ? (
                    <span className="text-2xs font-mono text-terminal-textDim px-1 py-0.5 border border-terminal-border rounded tracking-wider" title="WebSocket connected — streaming when market opens">
                      WS
                    </span>
                  ) : null}
                </div>
                <div className={`text-sm font-semibold num ${changeColor}`}>
                  {isPositive ? '+' : ''}{quote.change.toFixed(2)} ({quote.change_pct.toFixed(2)}%)
                </div>
              </div>
            ) : <SkeletonBlock className="h-14 w-32" />}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm items-center">
            {quote && <Stat label="Volume" value={`${(quote.volume / 1_000_000).toFixed(1)}M`} info="Shares traded today" />}
            {fundamentals?.market_cap && <Stat label="Mkt Cap" value={fmtBig(fundamentals.market_cap)} info="Price × shares outstanding" />}
            {fundamentals?.pe_ratio    && <Stat label="P/E"     value={`${fundamentals.pe_ratio.toFixed(1)}x`} info="Price-to-Earnings ratio" />}
            {fundamentals?.eps         && <Stat label="EPS"     value={`$${fundamentals.eps.toFixed(2)}`} info="Earnings Per Share (trailing)" />}
            {fundamentals?.beta        && <Stat label="Beta"    value={fundamentals.beta.toFixed(2)} info="Volatility vs market (1.0 = market rate)" />}
            {fundamentals?.dividend_yield && <Stat label="Div Yield" value={fmtPct(fundamentals.dividend_yield)} info="Annual dividend / current price" />}
            {fundamentals?.revenue_ttm && <Stat label="Rev TTM" value={fmtBig(fundamentals.revenue_ttm)} info="Trailing-twelve-month revenue" />}
            {fundamentals?.gross_margin && <Stat label="Gross Margin" value={fmtPct(fundamentals.gross_margin)} info="(Revenue − COGS) / Revenue" />}
            {fomoResult && <FomoBadge score={fomoResult.score} />}
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-7xl mx-auto px-4 flex gap-0 border-t border-terminal-border/50">
          {tabs.map(({ id, label }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`px-5 py-2.5 text-sm font-semibold transition border-b-2 ${
                activeTab === id ? 'border-terminal-cyan text-terminal-cyan' : 'border-transparent text-terminal-textMuted hover:text-terminal-text'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* ════ CHART ════ */}
        {activeTab === 'chart' && (
          <div className="space-y-6">

            {/* ── Fullscreen modal ── */}
            {isFullscreen && (
              <div className="fixed inset-0 z-[100] bg-terminal-bg flex flex-col overflow-hidden">
                {/* FS top bar */}
                <div className="px-4 py-2 border-b border-terminal-border bg-terminal-surface flex items-center gap-3 flex-wrap shrink-0">
                  <span className="font-mono font-bold text-terminal-cyan text-lg">{tickerStr}</span>
                  {quote && <span className="num text-terminal-text">${quote.price.toFixed(2)}</span>}
                  {livePrice ? (
                    <span className="text-2xs text-terminal-cyan border border-terminal-cyan/30 rounded px-1 font-mono">LIVE</span>
                  ) : wsConnected && tickerStr && !isWsUnsupported(tickerStr) ? (
                    <span className="text-2xs text-terminal-textDim border border-terminal-border rounded px-1 font-mono" title="WebSocket connected — streaming when market opens">WS</span>
                  ) : null}
                  <div className="flex items-center gap-1 flex-wrap ml-4">
                    {(['area', 'candle'] as ChartType[]).map(ct => (
                      <button key={ct} onClick={() => setChartType(ct)}
                        className={`px-2 py-0.5 text-xs transition border rounded ${
                          chartType === ct ? 'bg-terminal-cyan text-terminal-bg font-semibold border-terminal-cyan' : 'border-terminal-border text-terminal-textMuted hover:text-terminal-text'
                        }`}>
                        {ct === 'area' ? 'Line' : 'Candle'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {TIMEFRAMES.filter(t => t.group === 'intraday').map(t => (
                      <TfBtn key={t.label} label={t.label} active={selectedLabel === t.label} onClick={() => setSelectedLabel(t.label)} />
                    ))}
                    <span className="text-terminal-border text-xs mx-0.5">│</span>
                    {TIMEFRAMES.filter(t => t.group === 'daily').map(t => (
                      <TfBtn key={t.label} label={t.label} active={selectedLabel === t.label} onClick={() => setSelectedLabel(t.label)} />
                    ))}
                  </div>
                  <button onClick={() => setIsFullscreen(false)}
                    className="ml-auto text-terminal-textMuted hover:text-terminal-text text-xl leading-none px-2" title="Fermer (Esc)">
                    ✕
                  </button>
                </div>

                {/* FS indicator chips */}
                <div className="px-4 py-2 border-b border-terminal-border shrink-0 flex flex-wrap gap-1.5">
                  {([
                    { key: 'volume', label: 'Vol',       color: '#26a69a' },
                    { key: 'ema50',  label: 'EMA 50',    color: '#ffa726' },
                    { key: 'ema100', label: 'EMA 100',   color: '#42a5f5' },
                    { key: 'ema200', label: 'EMA 200',   color: '#ef5350' },
                    { key: 'bb',     label: 'Bollinger', color: '#ab47bc' },
                    { key: 'rsi',    label: 'RSI 14',    color: '#00d9ff' },
                    { key: 'macd',   label: 'MACD',      color: '#f9a825' },
                  ] as { key: IndicatorKey; label: string; color: string }[]).map(({ key, label, color }) => {
                    const on = activeIndicators.has(key);
                    return (
                      <button key={key} onClick={() => toggleIndicator(key)}
                        className={`px-2.5 py-0.5 text-2xs font-mono rounded border transition ${
                          on ? 'bg-terminal-surfaceHi font-semibold' : 'border-terminal-border text-terminal-textMuted hover:text-terminal-text'
                        }`}
                        style={on ? { borderColor: color, color } : undefined}>
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* FS chart + sub-panels */}
                <div className="flex-1 overflow-y-auto p-3">
                  <div className="bg-terminal-bg rounded p-2">
                    {historical.length > 0 ? (
                      <TradingViewChart data={lineData} ohlcData={ohlcData} chartType={chartType}
                        height={Math.max(winHeight - 230, 400)}
                        color={lineColor} showAxes isIntraday={tf.isIntraday}
                        visibleRange={visibleRange}
                        overlays={tvOverlays.length ? tvOverlays : undefined}
                        volumeData={tvVolumeData.length ? tvVolumeData : undefined}
                        onVisibleRangeChange={handleChartRangeChange} />
                    ) : <div className="h-64 flex items-center justify-center text-terminal-textMuted">No data</div>}
                  </div>

                  {/* FS RSI sub-panel */}
                  {activeIndicators.has('rsi') && rsiPanelData.length > 0 && (
                    <div className="mt-2 bg-terminal-bg rounded p-2">
                      <div className="text-2xs text-terminal-textDim mb-1 font-mono">RSI (14)</div>
                      <ResponsiveContainer width="100%" height={110}>
                        <ComposedChart data={applyRange(rsiPanelData)} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="2 6" stroke="rgba(42,48,64,0.4)" vertical={false} />
                          <XAxis dataKey="date" hide />
                          <YAxis orientation="right" domain={[0, 100]} tick={{ fill: '#9ca3af', fontSize: 9 }} width={64} tickCount={3} />
                          <Tooltip contentStyle={{ background: '#1a2035', border: '1px solid #2a3040', borderRadius: 4, fontSize: 10 }} labelStyle={{ color: '#7a8294' }}
                            formatter={(v: unknown) => [typeof v === 'number' ? v.toFixed(1) : '—', 'RSI']} />
                          <ReferenceLine y={70} stroke="#ef5350" strokeDasharray="3 3" strokeOpacity={0.6} />
                          <ReferenceLine y={30} stroke="#26a69a" strokeDasharray="3 3" strokeOpacity={0.6} />
                          <ReferenceLine y={50} stroke="#4b5563" strokeDasharray="2 4" strokeOpacity={0.4} />
                          <Line type="monotone" dataKey="rsi" stroke="#00d9ff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* FS MACD sub-panel */}
                  {activeIndicators.has('macd') && macdPanelData.length > 0 && (() => {
                    const d = applyRange(macdPanelData);
                    return (
                      <div className="mt-2 bg-terminal-bg rounded p-2">
                        <div className="text-2xs text-terminal-textDim mb-1 font-mono">MACD (12, 26, 9)</div>
                        <ResponsiveContainer width="100%" height={110}>
                          <ComposedChart data={d} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="2 6" stroke="rgba(42,48,64,0.4)" vertical={false} />
                            <XAxis dataKey="date" hide />
                            <YAxis orientation="right" tick={{ fill: '#9ca3af', fontSize: 9 }} width={64} tickFormatter={v => v.toFixed(2)} />
                            <Tooltip contentStyle={{ background: '#1a2035', border: '1px solid #2a3040', borderRadius: 4, fontSize: 10 }} labelStyle={{ color: '#7a8294' }}
                              formatter={(v: unknown, name: unknown) => [typeof v === 'number' ? v.toFixed(4) : '—', name === 'hist' ? 'Hist' : name === 'macd' ? 'MACD' : 'Signal']} />
                            <ReferenceLine y={0} stroke="#4b5563" strokeOpacity={0.5} />
                            <Bar dataKey="hist" isAnimationActive={false}>
                              {d.map((e, i) => <Cell key={i} fill={(e.hist ?? 0) >= 0 ? '#009371' : '#b92e25'} />)}
                            </Bar>
                            <Line type="monotone" dataKey="macd"   stroke="#00d9ff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="signal" stroke="#ffa726" strokeWidth={1}   dot={false} isAnimationActive={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()}

                  {/* FS CVD sub-panel */}
                  {activeIndicators.has('volume') && cvdPanelData.length > 0 && (() => {
                    const d = applyRange(cvdPanelData);
                    const fmt = (v: number) => {
                      const a = Math.abs(v);
                      if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
                      if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
                      if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
                      return String(Math.round(v));
                    };
                    return (
                      <div className="mt-2 bg-terminal-bg rounded p-2">
                        <div className="text-2xs text-terminal-textDim mb-1 font-mono">CVD — Volume Delta per bar</div>
                        <ResponsiveContainer width="100%" height={110}>
                          <ComposedChart data={d} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="2 6" stroke="rgba(42,48,64,0.4)" vertical={false} />
                            <XAxis dataKey="date" hide />
                            <YAxis orientation="right" tick={{ fill: '#9ca3af', fontSize: 9 }} width={64} tickFormatter={fmt} />
                            <Tooltip contentStyle={{ background: '#1a2035', border: '1px solid #2a3040', borderRadius: 4, fontSize: 10 }}
                              labelStyle={{ color: '#7a8294' }}
                              formatter={(v: unknown) => [typeof v === 'number' ? fmt(v) : '—', 'Δ vol']} />
                            <ReferenceLine y={0} stroke="#6b7280" strokeOpacity={0.7} />
                            <Bar dataKey="delta" isAnimationActive={false} maxBarSize={8}>
                              {d.map((e, i) => (
                                <Cell key={i} fill={e.delta >= 0 ? '#009371' : '#b92e25'} />
                              ))}
                            </Bar>
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ── Normal card ── */}
            <div className="bg-terminal-surface border border-terminal-border rounded p-4">
              {/* ── Row 1: chart type + fullscreen + timeframe buttons ── */}
              <div className="mb-2 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold">Price Chart</h2>
                  <div className="flex border border-terminal-border rounded overflow-hidden">
                    {(['area', 'candle'] as ChartType[]).map(ct => (
                      <button key={ct} onClick={() => setChartType(ct)}
                        className={`px-2 py-1 text-xs transition border-l first:border-l-0 border-terminal-border ${
                          chartType === ct ? 'bg-terminal-cyan text-terminal-bg font-semibold' : 'text-terminal-textMuted hover:text-terminal-text'
                        }`}>
                        {ct === 'area' ? 'Line' : 'Candle'}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setIsFullscreen(true)}
                    className="px-2 py-1 text-xs border border-terminal-border rounded text-terminal-textMuted hover:text-terminal-cyan hover:border-terminal-cyan transition"
                    title="Plein écran">
                    ⛶
                  </button>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {TIMEFRAMES.filter(t => t.group === 'intraday').map(t => (
                    <TfBtn key={t.label} label={t.label} active={selectedLabel === t.label} onClick={() => setSelectedLabel(t.label)} />
                  ))}
                  <span className="text-terminal-border text-xs mx-0.5">│</span>
                  {TIMEFRAMES.filter(t => t.group === 'daily').map(t => (
                    <TfBtn key={t.label} label={t.label} active={selectedLabel === t.label} onClick={() => setSelectedLabel(t.label)} />
                  ))}
                </div>
              </div>

              {/* ── Row 2: indicator chips ── */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {([
                  { key: 'volume',  label: 'CVD',       color: '#26a69a' },
                  { key: 'ema50',   label: 'EMA 50',    color: '#ffa726' },
                  { key: 'ema100',  label: 'EMA 100',   color: '#42a5f5' },
                  { key: 'ema200',  label: 'EMA 200',   color: '#ef5350' },
                  { key: 'bb',      label: 'Bollinger', color: '#ab47bc' },
                  { key: 'rsi',     label: 'RSI 14',    color: '#00d9ff' },
                  { key: 'macd',    label: 'MACD',      color: '#f9a825' },
                ] as { key: IndicatorKey; label: string; color: string }[]).map(({ key, label, color }) => {
                  const on = activeIndicators.has(key);
                  return (
                    <button key={key} onClick={() => toggleIndicator(key)}
                      className={`px-2.5 py-0.5 text-2xs font-mono rounded border transition ${
                        on ? 'bg-terminal-surfaceHi font-semibold' : 'border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan/50'
                      }`}
                      style={on ? { borderColor: color, color } : undefined}>
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* ── Chart (hidden while fullscreen) ── */}
              {isFullscreen ? (
                <div className="h-40 flex items-center justify-center text-terminal-textMuted text-sm border border-terminal-border rounded bg-terminal-bg">
                  Chart ouvert en plein écran · appuyer sur <kbd className="mx-1 px-1.5 py-0.5 text-xs rounded border border-terminal-border bg-terminal-surfaceHi font-mono">Esc</kbd> pour fermer
                </div>
              ) : (
                <>
                  <div className="bg-terminal-bg rounded p-2">
                    {chartError ? (
                      <div className="h-80 flex items-center justify-center text-red-500 text-sm">Failed to load chart data</div>
                    ) : isLoadingChart ? (
                      <SkeletonBlock className="h-96 w-full" />
                    ) : historical.length > 0 ? (
                      <TradingViewChart data={lineData} ohlcData={ohlcData} chartType={chartType}
                        height={400} color={lineColor} showAxes isIntraday={tf.isIntraday}
                        visibleRange={visibleRange}
                        overlays={tvOverlays.length ? tvOverlays : undefined}
                        volumeData={tvVolumeData.length ? tvVolumeData : undefined}
                        onVisibleRangeChange={handleChartRangeChange} />
                    ) : (
                      <div className="h-96 flex items-center justify-center text-terminal-textMuted">No chart data</div>
                    )}
                  </div>

                  {/* RSI sub-panel */}
                  {activeIndicators.has('rsi') && rsiPanelData.length > 0 && (
                    <div className="mt-2 bg-terminal-bg rounded p-2">
                      <div className="text-2xs text-terminal-textDim mb-1 font-mono">RSI (14)</div>
                      <ResponsiveContainer width="100%" height={110}>
                        <ComposedChart data={applyRange(rsiPanelData)} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="2 6" stroke="rgba(42,48,64,0.4)" vertical={false} />
                          <XAxis dataKey="date" hide />
                          <YAxis orientation="right" domain={[0, 100]} tick={{ fill: '#9ca3af', fontSize: 9 }} width={64} tickCount={3} />
                          <Tooltip contentStyle={{ background: '#1a2035', border: '1px solid #2a3040', borderRadius: 4, fontSize: 10 }}
                            labelStyle={{ color: '#7a8294' }} formatter={(v: unknown) => [typeof v === 'number' ? v.toFixed(1) : '—', 'RSI']} />
                          <ReferenceLine y={70} stroke="#ef5350" strokeDasharray="3 3" strokeOpacity={0.6} />
                          <ReferenceLine y={30} stroke="#26a69a" strokeDasharray="3 3" strokeOpacity={0.6} />
                          <ReferenceLine y={50} stroke="#4b5563" strokeDasharray="2 4" strokeOpacity={0.4} />
                          <Line type="monotone" dataKey="rsi" stroke="#00d9ff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* MACD sub-panel */}
                  {activeIndicators.has('macd') && macdPanelData.length > 0 && (() => {
                    const d = applyRange(macdPanelData);
                    return (
                      <div className="mt-2 bg-terminal-bg rounded p-2">
                        <div className="text-2xs text-terminal-textDim mb-1 font-mono">MACD (12, 26, 9)</div>
                        <ResponsiveContainer width="100%" height={110}>
                          <ComposedChart data={d} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="2 6" stroke="rgba(42,48,64,0.4)" vertical={false} />
                            <XAxis dataKey="date" hide />
                            <YAxis orientation="right" tick={{ fill: '#9ca3af', fontSize: 9 }} width={64} tickFormatter={v => v.toFixed(2)} />
                            <Tooltip contentStyle={{ background: '#1a2035', border: '1px solid #2a3040', borderRadius: 4, fontSize: 10 }}
                              labelStyle={{ color: '#7a8294' }}
                              formatter={(v: unknown, name: unknown) => [typeof v === 'number' ? v.toFixed(4) : '—', name === 'hist' ? 'Hist' : name === 'macd' ? 'MACD' : 'Signal']} />
                            <ReferenceLine y={0} stroke="#4b5563" strokeOpacity={0.5} />
                            <Bar dataKey="hist" isAnimationActive={false}>
                              {d.map((e, i) => <Cell key={i} fill={(e.hist ?? 0) >= 0 ? '#009371' : '#b92e25'} />)}
                            </Bar>
                            <Line type="monotone" dataKey="macd"   stroke="#00d9ff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="signal" stroke="#ffa726" strokeWidth={1}   dot={false} isAnimationActive={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()}

                  {/* CVD sub-panel */}
                  {activeIndicators.has('volume') && cvdPanelData.length > 0 && (() => {
                    const d = applyRange(cvdPanelData);
                    const fmt = (v: number) => {
                      const a = Math.abs(v);
                      if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
                      if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
                      if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
                      return String(Math.round(v));
                    };
                    return (
                      <div className="mt-2 bg-terminal-bg rounded p-2">
                        <div className="text-2xs text-terminal-textDim mb-1 font-mono">CVD — Volume Delta per bar</div>
                        <ResponsiveContainer width="100%" height={110}>
                          <ComposedChart data={d} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="2 6" stroke="rgba(42,48,64,0.4)" vertical={false} />
                            <XAxis dataKey="date" hide />
                            <YAxis orientation="right" tick={{ fill: '#9ca3af', fontSize: 9 }} width={64} tickFormatter={fmt} />
                            <Tooltip contentStyle={{ background: '#1a2035', border: '1px solid #2a3040', borderRadius: 4, fontSize: 10 }}
                              labelStyle={{ color: '#7a8294' }}
                              formatter={(v: unknown) => [typeof v === 'number' ? fmt(v) : '—', 'Δ vol']} />
                            <ReferenceLine y={0} stroke="#6b7280" strokeOpacity={0.7} />
                            <Bar dataKey="delta" isAnimationActive={false} maxBarSize={8}>
                              {d.map((e, i) => (
                                <Cell key={i} fill={e.delta >= 0 ? '#009371' : '#b92e25'} />
                              ))}
                            </Bar>
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()}
                </>
              )}

              <p className="text-2xs text-terminal-textDim mt-2">
                {tf.isIntraday ? `${tf.label} candles · scroll to zoom` : 'Scroll/drag to see full history'}
              </p>
            </div>

            {/* News */}
            <div className="bg-terminal-surface border border-terminal-border rounded p-4">
              <h2 className="text-lg font-semibold mb-4">Latest News</h2>
              {isLoadingNews ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} className="h-12 w-full" />)}</div>
              ) : news.length === 0 ? (
                <p className="text-terminal-textDim text-sm">No news for {tickerStr}</p>
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

        {/* ════ FINANCIALS ════ */}
        {activeTab === 'financials' && (
          financialsError ? (
            <div className="bg-terminal-surface border border-bear-border rounded p-6 text-sm space-y-2">
              <p className="font-semibold text-bear">⚠ Impossible de charger les données financières</p>
              <p className="text-terminal-textMuted font-mono text-xs">{String(financialsError?.message ?? financialsError)}</p>
              <p className="text-terminal-textDim text-xs">Source : yfinance (Yahoo Finance peut être temporairement indisponible ou avoir changé son API)</p>
            </div>
          ) : (
            <FinancialsTab financials={financials} isLoading={isLoadingFS}
              fsPeriod={fsPeriod} setFsPeriod={setFsPeriod} fsTab={fsTab} setFsTab={setFsTab} />
          )
        )}

        {/* ════ ANALYSIS ════ */}
        {activeTab === 'analysis' && (
          financialsError ? (
            <div className="bg-terminal-surface border border-bear-border rounded p-6 text-sm">
              <p className="font-semibold text-bear">⚠ Données financières indisponibles</p>
              <p className="text-terminal-textMuted font-mono text-xs mt-1">{String(financialsError?.message ?? financialsError)}</p>
            </div>
          ) : (
            <AnalysisTab financials={financials} isLoading={isLoadingFS} quote={quote} fomoResult={fomoResult} />
          )
        )}

        {/* ════ ETF ════ */}
        {activeTab === 'etf' && (
          <EtfTab
            holdings={etfHoldings}
            profile={etfProfile}
            monthlyData={monthlyChart?.data ?? []}
            isLoading={isLoadingEtf}
            isLoadingHoldings={isLoadingHoldings}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small reusable components
// ─────────────────────────────────────────────────────────────────────────────

function InfoTip({ text, dir = 'right' }: { text: string; dir?: 'right' | 'top' | 'bottom' }) {
  const pos = { right: 'left-full top-1/2 -translate-y-1/2 ml-1.5', top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5', bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5' }[dir];
  return (
    <span className="relative group inline-flex items-center cursor-help align-middle ml-0.5">
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-terminal-textMuted text-terminal-textMuted text-[9px] select-none leading-none hover:border-terminal-cyan hover:text-terminal-cyan transition-colors">i</span>
      <span className={`pointer-events-none absolute ${pos} z-50 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-[#0f1522] border border-[#2a3040] rounded px-2 py-1.5 text-xs text-[#e8e9ed] w-52 leading-snug shadow-xl`}>
        {text}
      </span>
    </span>
  );
}
function Stat({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-terminal-textMuted text-xs">{label}{info && <InfoTip text={info} dir="bottom" />}</span>
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
function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-8 text-center text-terminal-textMuted text-sm">{msg}</div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FinancialsTab
// ─────────────────────────────────────────────────────────────────────────────

function FinancialsTab({ financials, isLoading, fsPeriod, setFsPeriod, fsTab, setFsTab }: {
  financials: FinancialsData | undefined; isLoading: boolean;
  fsPeriod: 'annual' | 'quarterly'; setFsPeriod: (p: 'annual' | 'quarterly') => void;
  fsTab: 'income' | 'balance' | 'cashflow'; setFsTab: (t: 'income' | 'balance' | 'cashflow') => void;
}) {
  if (isLoading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <SkeletonBlock key={i} className="h-64 w-full" />)}</div>;
  if (!financials) return <div className="text-terminal-textMuted text-sm">No financial data available.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex border border-terminal-border rounded overflow-hidden">
          {(['annual', 'quarterly'] as const).map(p => (
            <button key={p} onClick={() => setFsPeriod(p)}
              className={`px-3 py-1.5 text-xs font-semibold capitalize transition ${fsPeriod === p ? 'bg-terminal-cyan text-terminal-bg' : 'text-terminal-textMuted hover:text-terminal-text'}`}>
              {p === 'annual' ? 'Annual' : 'Quarterly'}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {([['income', 'Income Statement'], ['balance', 'Balance Sheet'], ['cashflow', 'Cash Flow']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setFsTab(k)}
              className={`px-3 py-1.5 text-xs rounded transition ${fsTab === k ? 'bg-terminal-surfaceHi text-terminal-cyan font-semibold border border-terminal-cyan/30' : 'text-terminal-textMuted hover:text-terminal-text hover:bg-terminal-surfaceHi'}`}>
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

function IncomeStatementPanel({ data }: { data: ISRow[] }) {
  if (!data.length) return <EmptyState msg="No income statement data." />;
  const chartData = data.map(r => ({ date: shortDate(r.date), Revenue: r.revenue, 'Gross Profit': r.gross_profit, 'Net Income': r.net_income }));
  const metrics: { key: keyof ISRow; label: string; fmt: (v: number | null) => string; info: string }[] = [
    { key: 'revenue',          label: 'Revenue',          fmt: v => fmtBig(v), info: 'Total sales before any deductions' },
    { key: 'gross_profit',     label: 'Gross Profit',     fmt: v => fmtBig(v), info: 'Revenue minus Cost of Goods Sold' },
    { key: 'ebitda',           label: 'EBITDA',           fmt: v => fmtBig(v), info: 'Earnings Before Interest, Taxes, D&A' },
    { key: 'operating_income', label: 'Operating Income', fmt: v => fmtBig(v), info: 'Profit from core operations' },
    { key: 'net_income',       label: 'Net Income',       fmt: v => fmtBig(v), info: 'Bottom-line profit after all expenses' },
    { key: 'rd_expense',       label: 'R&D Expense',      fmt: v => fmtBig(v), info: 'Research & Development spending' },
    { key: 'gross_margin',     label: 'Gross Margin',     fmt: v => fmtPct(v), info: 'Gross Profit / Revenue' },
    { key: 'operating_margin', label: 'Operating Margin', fmt: v => fmtPct(v), info: 'Operating Income / Revenue' },
    { key: 'net_margin',       label: 'Net Margin',       fmt: v => fmtPct(v), info: 'Net Income / Revenue' },
  ];
  return <div className="space-y-4"><FinChart data={chartData} keys={['Revenue','Gross Profit','Net Income']} colors={['#00d9ff','#26a69a','#f9a825']} title="Revenue · Gross Profit · Net Income" /><FinTable data={data} metrics={metrics} /></div>;
}
function BalanceSheetPanel({ data }: { data: BSRow[] }) {
  if (!data.length) return <EmptyState msg="No balance sheet data." />;
  const chartData = data.map(r => ({ date: shortDate(r.date), 'Total Assets': r.total_assets, 'Total Debt': r.total_debt, Cash: r.cash, Equity: r.equity }));
  const metrics: { key: keyof BSRow; label: string; fmt: (v: number | null) => string; info: string }[] = [
    { key: 'total_assets',      label: 'Total Assets',      fmt: v => fmtBig(v), info: 'Everything the company owns' },
    { key: 'total_liabilities', label: 'Total Liabilities', fmt: v => fmtBig(v), info: 'All debts and obligations' },
    { key: 'equity',            label: 'Equity',            fmt: v => fmtBig(v), info: 'Assets − Liabilities' },
    { key: 'cash',              label: 'Cash & Equiv.',     fmt: v => fmtBig(v), info: 'Cash + short-term liquid investments' },
    { key: 'total_debt',        label: 'Total Debt',        fmt: v => fmtBig(v), info: 'Short-term + long-term financial debt' },
    { key: 'net_debt',          label: 'Net Debt',          fmt: v => fmtBig(v), info: 'Total Debt − Cash. Negative = more cash.' },
  ];
  return <div className="space-y-4"><FinChart data={chartData} keys={['Total Assets','Total Debt','Cash','Equity']} colors={['#00d9ff','#ef5350','#26a69a','#f9a825']} title="Balance Sheet Evolution" /><FinTable data={data} metrics={metrics} /></div>;
}
function CashFlowPanel({ data }: { data: CFRow[] }) {
  if (!data.length) return <EmptyState msg="No cash flow data." />;
  const chartData = data.map(r => ({ date: shortDate(r.date), 'Operating CF': r.operating_cf, 'Free CF': r.free_cf, CapEx: r.capex ? Math.abs(r.capex) : null }));
  const metrics: { key: keyof CFRow; label: string; fmt: (v: number | null) => string; info: string }[] = [
    { key: 'operating_cf', label: 'Operating CF', fmt: v => fmtBig(v), info: 'Cash from core business operations' },
    { key: 'investing_cf', label: 'Investing CF', fmt: v => fmtBig(v), info: 'Cash used for asset purchases / investments' },
    { key: 'financing_cf', label: 'Financing CF', fmt: v => fmtBig(v), info: 'Cash from debt, dividends, buybacks' },
    { key: 'capex',        label: 'CapEx',        fmt: v => fmtBig(v), info: 'Capital Expenditures on PP&E' },
    { key: 'free_cf',      label: 'Free CF',      fmt: v => fmtBig(v), info: 'Operating CF − CapEx' },
  ];
  return <div className="space-y-4"><FinChart data={chartData} keys={['Operating CF','Free CF','CapEx']} colors={['#26a69a','#00d9ff','#ef6c00']} title="Operating CF · Free CF · CapEx" /><FinTable data={data} metrics={metrics} /></div>;
}
function FinChart({ data, keys, colors, title }: { data: Record<string,string|number|null>[]; keys: string[]; colors: string[]; title: string }) {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <p className="text-xs text-terminal-textMuted uppercase tracking-wider mb-4">{title}</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barCategoryGap="30%" barGap={2}>
          <CartesianGrid strokeDasharray="2 6" stroke="rgba(42,48,64,0.4)" />
          <XAxis dataKey="date" tick={{ fill: '#7a8294', fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: '#7a8294', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => fmtBig(v as number, '')} width={52} />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown) => fmtBig(typeof v === 'number' ? v : null)} />
          {keys.map((k, i) => <Bar key={k} dataKey={k} fill={colors[i]} radius={[3,3,0,0]} maxBarSize={40} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function FinTable<T extends { date: string }>({ data, metrics }: {
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
              {data.map(r => <th key={r.date} className="px-4 py-3 text-right text-xs font-semibold text-terminal-textMuted uppercase tracking-wider num">{shortDate(r.date)}</th>)}
            </tr>
          </thead>
          <tbody>
            {metrics.map(({ key, label, fmt, info }, mi) => (
              <tr key={String(key)} className={`border-b border-terminal-border/30 ${mi % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                <td className="px-4 py-2.5 text-terminal-textMuted text-xs">
                  <span className="inline-flex items-center gap-0">{label}{info && <InfoTip text={info} />}</span>
                </td>
                {data.map(r => {
                  const v = r[key] as number | null;
                  return <td key={r.date} className={`px-4 py-2.5 text-right num text-sm font-semibold ${v != null && v < 0 ? 'text-red-400' : 'text-terminal-cyan'}`}>{fmt(v)}</td>;
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
// AnalysisTab
// ─────────────────────────────────────────────────────────────────────────────

function AnalysisTab({ financials, isLoading, quote, fomoResult }: {
  financials: FinancialsData | undefined; isLoading: boolean;
  quote: QuoteData | undefined; fomoResult: FomoResult | null;
}) {
  if (isLoading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <SkeletonBlock key={i} className="h-64 w-full" />)}</div>;
  if (!financials) return <div className="text-terminal-textMuted text-sm">No analysis data available.</div>;

  const { earnings, analyst } = financials;
  const earningsData = earnings.map(e => ({
    label: e.period || shortDate(e.date),
    eps_actual: e.eps_actual, eps_estimate: e.eps_estimate, surprise: e.surprise_pct,
    beat: e.eps_actual != null && e.eps_estimate != null && e.eps_actual >= e.eps_estimate,
  }));

  const rec = analyst.recommendations;
  const pieCols = ['#26a69a','#4caf50','#7a8294','#ef6c00','#ef5350'];
  const pieData = rec ? [
    { name: 'Strong Buy',  value: rec.strong_buy,  color: pieCols[0] },
    { name: 'Buy',         value: rec.buy,         color: pieCols[1] },
    { name: 'Hold',        value: rec.hold,        color: pieCols[2] },
    { name: 'Sell',        value: rec.sell,        color: pieCols[3] },
    { name: 'Strong Sell', value: rec.strong_sell, color: pieCols[4] },
  ].filter(d => d.value > 0) : [];

  const pt = analyst.price_targets;
  const currentPrice = quote?.price;

  return (
    <div className="space-y-6">
      <FomoCard fomoResult={fomoResult} />

      {earningsData.length > 0 ? (
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
            EPS — Actual vs Estimate <InfoTip text="Green = beat, red = missed estimate. Consistent beats signal strong execution." dir="bottom" />
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={earningsData} barCategoryGap="30%" barGap={4}>
              <CartesianGrid strokeDasharray="2 6" stroke="rgba(42,48,64,0.4)" />
              <XAxis dataKey="label" tick={{ fill: '#7a8294', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#7a8294', fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown) => [`$${typeof v === 'number' ? v.toFixed(2) : String(v)}`]} />
              <ReferenceLine y={0} stroke="#2a3040" />
              <Bar dataKey="eps_estimate" fill="#7a8294" name="Estimate" radius={[3,3,0,0]} maxBarSize={30} />
              <Bar dataKey="eps_actual" name="Actual" radius={[3,3,0,0]} maxBarSize={30}>
                {earningsData.map((e, i) => <Cell key={i} fill={e.beat ? '#26a69a' : '#ef5350'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border text-terminal-textMuted">
                  <th className="py-2 text-left">Quarter</th>
                  <th className="py-2 text-right num">Estimate <InfoTip text="Consensus EPS before the report" /></th>
                  <th className="py-2 text-right num">Actual <InfoTip text="Reported EPS" /></th>
                  <th className="py-2 text-right num">Surprise <InfoTip text="% difference: Actual vs Estimate" /></th>
                </tr>
              </thead>
              <tbody>
                {[...earningsData].reverse().map((e, i) => (
                  <tr key={i} className="border-b border-terminal-border/30">
                    <td className="py-2 text-terminal-textMuted">{e.label}</td>
                    <td className="py-2 text-right num">{e.eps_estimate != null ? `$${e.eps_estimate.toFixed(2)}` : '—'}</td>
                    <td className={`py-2 text-right num font-semibold ${e.beat ? 'text-green-400' : 'text-red-400'}`}>{e.eps_actual != null ? `$${e.eps_actual.toFixed(2)}` : '—'}</td>
                    <td className={`py-2 text-right num font-semibold ${e.beat ? 'text-green-400' : 'text-red-400'}`}>{e.surprise != null ? `${e.surprise >= 0 ? '+' : ''}${e.surprise.toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : <EmptyState msg="No earnings history available." />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {pieData.length > 0 ? (
          <div className="bg-terminal-surface border border-terminal-border rounded p-4">
            <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
              Analyst Consensus {pt?.count ? `(${pt.count})` : ''} <InfoTip text="Current analyst recommendation distribution." dir="bottom" />
            </h3>
            <div className="flex items-center gap-4">
              <PieChart width={160} height={160}>
                <Pie data={pieData} cx={75} cy={75} innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={2}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown) => [`${v} analysts`]} />
              </PieChart>
              <div className="space-y-1.5">
                {pieData.map(d => (
                  <div key={d.name} className="flex items-center gap-2 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="text-terminal-text">{d.name}</span>
                    <span className="ml-auto num font-semibold text-terminal-cyan">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : <EmptyState msg="No analyst recommendations." />}

        {pt && (pt.low != null || pt.mean != null || pt.high != null) ? (
          <div className="bg-terminal-surface border border-terminal-border rounded p-4">
            <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
              Price Targets <InfoTip text="12-month price targets. White dot = current price vs analyst range." dir="bottom" />
            </h3>
            <PriceTargetBar low={pt.low} mean={pt.mean} high={pt.high} current={currentPrice ?? null} />
          </div>
        ) : <EmptyState msg="No price targets available." />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FOMO Gauge + Card
// ─────────────────────────────────────────────────────────────────────────────

function FomoGauge({ score }: { score: number }) {
  const W = 220, H = 128, cx = W / 2, cy = H - 13, R = 90, SW = 18;
  const toAngle = (s: number) => Math.PI * (1 - s / 100);
  const ptOnArc = (s: number, r: number) => ({
    x: +(cx + r * Math.cos(toAngle(s))).toFixed(2),
    y: +(cy - r * Math.sin(toAngle(s))).toFixed(2),
  });
  const start = ptOnArc(0, R); const end = ptOnArc(100, R); const sPt = ptOnArc(Math.min(score, 99.9), R);
  const bgArc     = `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y}`;
  const activeArc = score <= 0 ? null : score >= 100 ? bgArc : `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${sPt.x} ${sPt.y}`;
  const nPt = ptOnArc(score, R - SW / 2 - 3);
  const { label, ringColor } = getFomoMeta(score);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="fg-active" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3b82f6"/><stop offset="25%" stopColor="#6b7280"/>
          <stop offset="50%" stopColor="#eab308"/><stop offset="75%" stopColor="#f97316"/><stop offset="100%" stopColor="#ef4444"/>
        </linearGradient>
        <linearGradient id="fg-dim" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.18"/><stop offset="25%" stopColor="#6b7280" stopOpacity="0.18"/>
          <stop offset="50%" stopColor="#eab308" stopOpacity="0.18"/><stop offset="75%" stopColor="#f97316" stopOpacity="0.18"/><stop offset="100%" stopColor="#ef4444" stopOpacity="0.18"/>
        </linearGradient>
      </defs>
      <path d={bgArc} fill="none" stroke="#080c14" strokeWidth={SW + 6} strokeLinecap="round" />
      <path d={bgArc} fill="none" stroke="url(#fg-dim)" strokeWidth={SW} strokeLinecap="round" />
      {activeArc && <path d={activeArc} fill="none" stroke="url(#fg-active)" strokeWidth={SW} strokeLinecap="round" />}
      <line x1={cx} y1={cy} x2={nPt.x} y2={nPt.y} stroke="white" strokeWidth={2.5} strokeLinecap="round" opacity={0.9} />
      <circle cx={cx} cy={cy} r={5} fill="white" opacity={0.9} /><circle cx={cx} cy={cy} r={2.5} fill="#080c14" />
      <text x={cx} y={cy - 24} textAnchor="middle" fill="white" fontSize={30} fontWeight="bold" fontFamily="'Courier New', monospace">{score}</text>
      <text x={cx} y={cy - 8} textAnchor="middle" fill={ringColor} fontSize={11} fontWeight="700">{label}</text>
      <text x={start.x + 2} y={start.y} dominantBaseline="hanging" textAnchor="start" fill="#374151" fontSize={9}>0</text>
      <text x={end.x - 2} y={end.y} dominantBaseline="hanging" textAnchor="end" fill="#374151" fontSize={9}>100</text>
    </svg>
  );
}
function FomoCard({ fomoResult }: { fomoResult: FomoResult | null }) {
  if (!fomoResult) return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <div className="flex items-center gap-2 text-terminal-textMuted text-sm"><span className="animate-pulse">●</span> Computing FOMO indicator…</div>
    </div>
  );
  const { score, breakdown } = fomoResult;
  const { ringColor, bgColor } = getFomoMeta(score);
  const items: { key: keyof FomoResult['breakdown']; label: string; max: number; info: string }[] = [
    { key: 'momentum', label: 'Price Momentum 30d', max: 30, info: '+20% price change → max 30pts' },
    { key: 'volume',   label: 'Volume Surge',       max: 20, info: "Today's volume vs 20-day avg. 2× avg → 20pts" },
    { key: 'analyst',  label: 'Analyst Consensus',  max: 25, info: 'Weighted bullish analyst rating' },
    { key: 'eps',      label: 'EPS Beat History',   max: 25, info: 'Avg EPS surprise last 4 quarters' },
  ];
  return (
    <div className={`bg-terminal-surface border border-terminal-border rounded p-4 ${bgColor}`}>
      <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
        FOMO Indicator <InfoTip text="0–100 composite: price momentum (30) + volume surge (20) + analyst consensus (25) + EPS beat history (25)." dir="bottom" />
      </h3>
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="shrink-0">
          <FomoGauge score={score} />
          <div className="flex justify-between mt-1 px-1 text-[9px]">
            <span className="text-blue-400/60">Froid</span><span className="text-gray-400/60">Neutre</span>
            <span className="text-yellow-400/60">Momentum</span><span className="text-orange-400/60">Chaud</span><span className="text-red-400/60">FOMO</span>
          </div>
        </div>
        <div className="flex-1 w-full space-y-3">
          {items.map(({ key, label, max, info }) => {
            const pts = breakdown[key]; const pct = (pts / max) * 100;
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-terminal-textMuted inline-flex items-center">{label}<InfoTip text={info} /></span>
                  <span className="text-xs num font-semibold text-terminal-text">{pts}<span className="text-terminal-textDim">/{max}</span></span>
                </div>
                <div className="h-1.5 bg-terminal-bg rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ringColor + 'cc' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PriceTargetBar
// ─────────────────────────────────────────────────────────────────────────────

function PriceTargetBar({ low, mean, high, current }: { low: number|null; mean: number|null; high: number|null; current: number|null }) {
  const allVals = [low, mean, high, current].filter((v): v is number => v != null);
  if (!allVals.length) return null;
  const min = Math.min(...allVals) * 0.95;
  const max = Math.max(...allVals) * 1.05;
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  return (
    <div className="space-y-4 pt-2">
      <div className="relative pt-9">
        {current != null && (
          <div className="absolute top-0 flex flex-col items-center pointer-events-none" style={{ left: `${pct(current)}%`, transform: 'translateX(-50%)' }}>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-terminal-text bg-terminal-surfaceHi border border-terminal-border rounded px-1.5 py-0.5 whitespace-nowrap">● Current price</span>
            <svg width="8" height="5" viewBox="0 0 8 5" className="mt-0.5 shrink-0"><path d="M4 5L0 0h8z" fill="var(--chart-tooltip-border)" /></svg>
          </div>
        )}
        <div className="relative h-3.5 bg-terminal-bg rounded-full">
          {low != null && high != null && <div className="absolute h-full bg-terminal-cyan/20 rounded-full" style={{ left: `${pct(low)}%`, width: `${pct(high) - pct(low)}%` }} />}
          {mean != null && <div className="absolute h-full w-0.5 bg-terminal-cyan" style={{ left: `${pct(mean)}%` }} />}
          {current != null && <div className="absolute top-1/2 w-4 h-4 rounded-full bg-white border-2 border-terminal-bg shadow-lg -translate-y-1/2 -translate-x-1/2" style={{ left: `${pct(current)}%` }} />}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {low  != null && <div className="flex items-center justify-between text-sm"><span className="text-terminal-textMuted">Low <InfoTip text="Most pessimistic analyst 12m target" /></span><span className="num font-semibold text-terminal-textMuted">${low.toFixed(0)}</span></div>}
        {mean != null && <div className="flex items-center justify-between text-sm"><span className="text-terminal-cyan">Mean <InfoTip text="Consensus 12-month price target" /></span><span className="num font-semibold text-terminal-cyan">${mean.toFixed(0)}</span></div>}
        {high != null && <div className="flex items-center justify-between text-sm"><span className="text-green-400">High <InfoTip text="Most optimistic analyst 12m target" /></span><span className="num font-semibold text-green-400">${high.toFixed(0)}</span></div>}
        {current != null && <div className="flex items-center justify-between text-sm border-t border-terminal-border pt-2 mt-1"><span className="text-white font-semibold">● Current price</span><span className="num font-bold text-white">${current.toFixed(2)}</span></div>}
        {mean != null && current != null && (
          <div className="text-xs text-terminal-textMuted">Upside to mean:{' '}
            <span className={`font-semibold num ${mean > current ? 'text-green-400' : 'text-red-400'}`}>
              {mean > current ? '+' : ''}{(((mean - current) / current) * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ETF Tab
// ─────────────────────────────────────────────────────────────────────────────

function EtfTab({ holdings, profile, monthlyData, isLoading, isLoadingHoldings }: {
  holdings: EtfHolding[];
  profile: EtfProfile | undefined;
  monthlyData: HistoricalPoint[];
  isLoading: boolean;
  isLoadingHoldings: boolean;
}) {
  // Compute all monthly/annual return stats once, pass to children
  const returnStats = useMemo(() => {
    if (monthlyData.length < 2) return null;
    const monthlyReturns = new Map<string, number>(); // "YYYY-MM" → %
    for (let i = 1; i < monthlyData.length; i++) {
      const prev = monthlyData[i - 1].close;
      const curr = monthlyData[i].close;
      if (prev > 0) monthlyReturns.set(monthlyData[i].date.slice(0, 7), ((curr - prev) / prev) * 100);
    }
    const yearData: Record<number, Record<number, number>> = {};
    for (const [key, ret] of monthlyReturns) {
      const year = parseInt(key.slice(0, 4));
      const month = parseInt(key.slice(5, 7));
      if (!yearData[year]) yearData[year] = {};
      yearData[year][month] = ret;
    }
    const years = Object.keys(yearData).map(Number).sort((a, b) => b - a);
    const annualReturns: Record<number, number | null> = {};
    for (const year of years) {
      const vals = Object.values(yearData[year]);
      annualReturns[year] = vals.length ? (vals.reduce((acc, r) => acc * (1 + r / 100), 1) - 1) * 100 : null;
    }
    // Average monthly return per month index (1–12)
    const avgByMonth: Record<number, number | null> = {};
    for (let m = 1; m <= 12; m++) {
      const vals = years.map(y => yearData[y]?.[m]).filter((v): v is number => v !== undefined);
      avgByMonth[m] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    return { years, yearData, annualReturns, avgByMonth, monthlyReturns };
  }, [monthlyData]);

  return (
    <div className="space-y-6">
      {/* Holdings */}
      {isLoadingHoldings
        ? <SkeletonBlock className="h-48 w-full" />
        : <HoldingsPanel holdings={holdings} />
      }

      {/* Sector + Country */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonBlock className="h-64 w-full" /><SkeletonBlock className="h-64 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BreakdownChart
            title="Sector Breakdown"
            infoText="Portfolio weight by industry sector. Source: FMP / Yahoo Finance."
            items={(profile?.sector_weightings ?? []).map(s => ({ name: s.sector, value: s.weight_pct }))}
            colorFn={(name, idx) => sectorColor(name, idx)}
          />
          <GeoBreakdownChart
            title="Geographic Breakdown"
            infoText="Portfolio weight by country of domicile. Source: Financial Modeling Prep."
            items={(profile?.country_weightings ?? []).map(c => ({ name: c.country, value: c.weight_pct }))}
          />
        </div>
      )}

      {/* Monthly returns heatmap */}
      {monthlyData.length < 2 ? (
        returnStats === null && monthlyData.length === 0
          ? <SkeletonBlock className="h-64 w-full" />
          : <EmptyState msg="Not enough monthly data for heatmap." />
      ) : returnStats ? (
        <>
          <MonthlyHeatmap
            years={returnStats.years}
            yearData={returnStats.yearData}
            annualReturns={returnStats.annualReturns}
            avgByMonth={returnStats.avgByMonth}
          />
          <PerformanceSummary monthlyData={monthlyData} annualReturns={returnStats.annualReturns} />
        </>
      ) : null}
    </div>
  );
}

// ── Holdings panel ────────────────────────────────────────────────────────────
function HoldingsPanel({ holdings }: { holdings: EtfHolding[] }) {
  if (!holdings.length) return <EmptyState msg="No holdings data available." />;
  const THRESHOLD = 0.5;
  const shown = holdings.filter(h => h.weight_pct >= THRESHOLD);
  const display = shown.length > 0 ? shown : holdings.slice(0, 20);
  const totalShown = display.reduce((s, h) => s + h.weight_pct, 0);
  const maxW = display[0]?.weight_pct || 1;
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider">
          Top Holdings
          <InfoTip text={`Positions with weight ≥ ${THRESHOLD}%. Covers ${totalShown.toFixed(1)}% of fund assets.`} dir="bottom" />
        </h3>
        <span className="text-xs text-terminal-textMuted">{display.length} positions · {totalShown.toFixed(1)}% of assets</span>
      </div>
      <div className="space-y-2.5">
        {display.map((h, i) => (
          <div key={h.ticker || i}>
            <div className="flex items-center justify-between mb-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-terminal-textDim num w-5 text-right shrink-0">{i + 1}</span>
                {h.ticker
                  ? <a href={`/instrument/${h.ticker}`} className="font-mono font-bold text-terminal-cyan hover:underline text-sm shrink-0">{h.ticker}</a>
                  : null}
                <span className="text-xs text-terminal-textMuted truncate">{h.name}</span>
              </div>
              <span className="text-sm font-bold num text-terminal-text ml-2 shrink-0">{h.weight_pct.toFixed(2)}%</span>
            </div>
            <div className="h-1.5 bg-terminal-bg rounded-full overflow-hidden ml-7">
              <div className="h-full rounded-full bg-terminal-cyan/70" style={{ width: `${(h.weight_pct / maxW) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      {shown.length < holdings.length && shown.length > 0 && (
        <p className="text-[10px] text-terminal-textDim mt-3">
          {holdings.length - shown.length} additional positions below {THRESHOLD}% not shown · {(100 - totalShown).toFixed(1)}% in remaining holdings
        </p>
      )}
    </div>
  );
}

// ── Sector breakdown — donut + horizontal bars ────────────────────────────────
function BreakdownChart({ items, colorFn, title, infoText }: {
  items: { name: string; value: number }[];
  colorFn: (name: string, idx: number) => string;
  title: string;
  infoText: string;
}) {
  if (!items.length) return <EmptyState msg={`No ${title.toLowerCase()} data.`} />;
  const TOP_N = 10;
  const top = items.slice(0, TOP_N);
  const otherW = items.slice(TOP_N).reduce((s, i) => s + i.value, 0);
  if (otherW > 0.1) top.push({ name: 'Other', value: Math.round(otherW * 10) / 10 });
  const maxVal = Math.max(...top.map(i => i.value));
  const pieItems = top.map((item, idx) => ({ ...item, color: colorFn(item.name, idx) }));
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
        {title} <InfoTip text={infoText} dir="bottom" />
      </h3>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="shrink-0">
          <PieChart width={140} height={140}>
            <Pie data={pieItems} cx={65} cy={65} innerRadius={35} outerRadius={62} dataKey="value" paddingAngle={1}>
              {pieItems.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip contentStyle={{ background: '#1a2035', border: '1px solid #2a3040', borderRadius: 4, fontSize: 11 }}
              formatter={(v: unknown) => [`${typeof v === 'number' ? v.toFixed(1) : v}%`]} />
          </PieChart>
        </div>
        <div className="flex-1 space-y-1.5">
          {pieItems.map((item) => (
            <div key={item.name}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs truncate max-w-[150px]" style={{ color: item.color }}>{item.name}</span>
                <span className="text-xs num font-semibold text-terminal-text ml-2">{item.value.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-terminal-bg rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(item.value / maxVal) * 100}%`, background: item.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Geographic breakdown — bars only (no donut) ───────────────────────────────
function GeoBreakdownChart({ items, title, infoText }: {
  items: { name: string; value: number }[];
  title: string;
  infoText: string;
}) {
  if (!items.length) return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-3">
        {title} <InfoTip text={infoText} dir="bottom" />
      </h3>
      <p className="text-xs text-terminal-textDim">Geographic data not available for this ETF.</p>
    </div>
  );
  const TOP_N = 15;
  const top = items.slice(0, TOP_N);
  const otherW = items.slice(TOP_N).reduce((s, i) => s + i.value, 0);
  if (otherW > 0.1) top.push({ name: 'Other', value: Math.round(otherW * 10) / 10 });
  const maxVal = Math.max(...top.map(i => i.value));
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
        {title} <InfoTip text={infoText} dir="bottom" />
      </h3>
      <div className="space-y-2">
        {top.map((item, idx) => {
          const color = PIE_PALETTE[idx % PIE_PALETTE.length];
          return (
            <div key={item.name}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs text-terminal-textMuted truncate max-w-[200px]">{item.name}</span>
                <span className="text-xs num font-semibold text-terminal-text ml-3 shrink-0">{item.value.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-terminal-bg rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${(item.value / maxVal) * 100}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Monthly returns heatmap ───────────────────────────────────────────────────
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function MonthlyHeatmap({ years, yearData, annualReturns, avgByMonth }: {
  years: number[];
  yearData: Record<number, Record<number, number>>;
  annualReturns: Record<number, number | null>;
  avgByMonth: Record<number, number | null>;
}) {
  if (!years.length) return <EmptyState msg="Not enough data for heatmap." />;
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
        Monthly Returns Heatmap
        <InfoTip text="Monthly price returns. Green = positive, Red = negative. Last column = full-year compound return." dir="bottom" />
      </h3>
      <div className="overflow-x-auto">
        <table className="text-xs min-w-[700px] w-full border-separate border-spacing-0.5">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-terminal-textMuted w-12">Year</th>
              {MONTH_LABELS.map(m => <th key={m} className="px-1 py-1 text-center text-terminal-textMuted w-14">{m}</th>)}
              <th className="px-2 py-1 text-center text-terminal-textMuted">Year</th>
            </tr>
          </thead>
          <tbody>
            {years.map(year => (
              <tr key={year}>
                <td className="px-2 py-0.5 text-terminal-textMuted num font-semibold text-[11px]">{year}</td>
                {Array.from({ length: 12 }, (_, idx) => idx + 1).map(month => {
                  const ret = yearData[year]?.[month] ?? null;
                  return (
                    <td key={month} className="px-0 py-0">
                      <div className="rounded text-center py-1.5 px-0.5 leading-none" style={ret !== null ? returnCellStyle(ret) : { background: '#0f1522', color: '#374151' }}>
                        {ret !== null
                          ? <span className="num font-semibold text-[10px]">{ret >= 0 ? '+' : ''}{ret.toFixed(1)}</span>
                          : <span className="text-[10px]">—</span>}
                      </div>
                    </td>
                  );
                })}
                <td className="px-0.5 py-0">
                  {annualReturns[year] !== null ? (
                    <div className="rounded text-center py-1.5 px-1 leading-none font-bold" style={returnCellStyle(annualReturns[year]!)}>
                      <span className="num text-[11px]">{(annualReturns[year]! >= 0 ? '+' : '')}{annualReturns[year]!.toFixed(1)}%</span>
                    </div>
                  ) : <span className="text-terminal-textDim text-[10px]">—</span>}
                </td>
              </tr>
            ))}

            {/* Average row */}
            <tr className="border-t-2 border-terminal-border">
              <td className="px-2 py-1 text-terminal-textMuted text-[10px] font-semibold">Avg</td>
              {Array.from({ length: 12 }, (_, idx) => idx + 1).map(month => {
                const avg = avgByMonth[month];
                return (
                  <td key={month} className="px-0 py-0.5">
                    <div className="rounded text-center py-1 px-0.5 leading-none" style={avg !== null ? returnCellStyle(avg) : { background: '#0f1522', color: '#374151' }}>
                      {avg !== null
                        ? <span className="num font-semibold text-[10px]">{avg >= 0 ? '+' : ''}{avg.toFixed(1)}</span>
                        : <span className="text-[10px] text-terminal-textDim">—</span>}
                    </div>
                  </td>
                );
              })}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-terminal-textMuted">
        <span>Scale:</span>
        {[-8,-4,0,4,8].map(v => (
          <span key={v} className="px-2 py-0.5 rounded num" style={v !== 0 ? returnCellStyle(v) : { background: '#1a2035', color: '#6b7280' }}>
            {v > 0 ? '+' : ''}{v}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Annual performance summary ────────────────────────────────────────────────
function PerformanceSummary({ monthlyData, annualReturns }: {
  monthlyData: HistoricalPoint[];
  annualReturns: Record<number, number | null>;
}) {
  const stats = useMemo(() => {
    const full = Object.entries(annualReturns)
      .filter(([, v]) => v !== null)
      .map(([y, v]) => ({ year: parseInt(y), ret: v as number }));

    const rets = full.map(x => x.ret);
    const bestEntry  = full.length ? full.reduce((a, b) => b.ret > a.ret ? b : a) : null;
    const worstEntry = full.length ? full.reduce((a, b) => b.ret < a.ret ? b : a) : null;
    const avgAnnual  = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null;

    const last = monthlyData[monthlyData.length - 1]?.close;
    const compute = (months: number) => {
      if (monthlyData.length < months + 1 || !last) return null;
      const past = monthlyData[monthlyData.length - 1 - months].close;
      if (!past) return null;
      return (Math.pow(1 + (last - past) / past, 12 / months) - 1) * 100;
    };
    return { r1y: compute(12), r3y: compute(36), r5y: compute(60), r10y: compute(120), bestEntry, worstEntry, avgAnnual, yearsCount: full.length };
  }, [monthlyData, annualReturns]);

  if (!stats) return null;

  const perfItems = [
    { label: '1Y', value: stats.r1y, info: 'Annualized return last 12 months' },
    { label: '3Y ann.', value: stats.r3y, info: 'Compound annualized return last 3 years' },
    { label: '5Y ann.', value: stats.r5y, info: 'Compound annualized return last 5 years' },
    { label: '10Y ann.', value: stats.r10y, info: 'Compound annualized return last 10 years' },
  ];

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
        Performance Summary
        <InfoTip text="Returns computed from monthly closing prices. Multi-year = annualized compound." dir="bottom" />
      </h3>

      {/* Multi-period cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {perfItems.map(item => (
          <div key={item.label} className="bg-terminal-bg rounded p-3">
            <div className="text-xs text-terminal-textMuted mb-1">{item.label}<InfoTip text={item.info} /></div>
            {item.value !== null
              ? <div className={`text-xl font-bold num ${item.value >= 0 ? 'text-green-400' : 'text-red-400'}`}>{item.value >= 0 ? '+' : ''}{item.value.toFixed(1)}%</div>
              : <div className="text-terminal-textDim text-lg">N/A</div>}
          </div>
        ))}
      </div>

      {/* Best / Worst / Avg */}
      <div className="grid grid-cols-3 gap-3">
        {stats.bestEntry && (
          <div className="bg-green-500/5 border border-green-500/20 rounded p-3">
            <div className="text-xs text-terminal-textMuted mb-1">Best Year</div>
            <div className="text-lg font-bold text-green-400 num">+{stats.bestEntry.ret.toFixed(1)}%</div>
            <div className="text-xs text-terminal-textMuted">{stats.bestEntry.year}</div>
          </div>
        )}
        {stats.worstEntry && (
          <div className="bg-red-500/5 border border-red-500/20 rounded p-3">
            <div className="text-xs text-terminal-textMuted mb-1">Worst Year</div>
            <div className="text-lg font-bold text-red-400 num">{stats.worstEntry.ret.toFixed(1)}%</div>
            <div className="text-xs text-terminal-textMuted">{stats.worstEntry.year}</div>
          </div>
        )}
        {stats.avgAnnual !== null && (
          <div className="bg-terminal-bg rounded p-3">
            <div className="text-xs text-terminal-textMuted mb-1">Avg Annual <span className="text-terminal-textDim">({stats.yearsCount}Y)</span></div>
            <div className={`text-lg font-bold num ${stats.avgAnnual >= 0 ? 'text-green-400' : 'text-red-400'}`}>{stats.avgAnnual >= 0 ? '+' : ''}{stats.avgAnnual.toFixed(1)}%</div>
          </div>
        )}
      </div>

      {/* Annual bar chart */}
      {stats.yearsCount > 1 && (() => {
        const barData = Object.entries(annualReturns)
          .filter(([, v]) => v !== null)
          .map(([y, v]) => ({ year: String(y), ret: v as number }))
          .sort((a, b) => a.year.localeCompare(b.year));
        return (
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={barData} barCategoryGap="20%" barGap={2}>
                <CartesianGrid strokeDasharray="2 6" stroke="rgba(42,48,64,0.4)" />
                <XAxis dataKey="year" tick={{ fill: '#7a8294', fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#7a8294', fontSize: 10 }} tickLine={false} axisLine={false} width={40}
                  tickFormatter={v => `${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(0)}%`} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown) => [`${typeof v === 'number' && v >= 0 ? '+' : ''}${typeof v === 'number' ? v.toFixed(1) : v}%`]} />
                <ReferenceLine y={0} stroke="#2a3040" />
                <Bar dataKey="ret" name="Return" radius={[3,3,0,0]} maxBarSize={32}>
                  {barData.map((d, i) => <Cell key={i} fill={d.ret >= 0 ? '#26a69a' : '#ef5350'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })()}
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
