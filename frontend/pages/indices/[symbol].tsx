/**
 * /indices/[symbol] — Index Detail Page
 *
 * Two-phase loading:
 *   Phase 1 → constituents list (fast, ~1-2s — FMP cached)
 *   Phase 2 → prices enrichment (background, ~5-20s — yfinance, cached 15min)
 *
 * Three views:
 *   1. Heatmap  — Treemap colored by % change, grouped by sector
 *   2. Table    — Sortable full constituent list
 *   3. Sectors  — Donut chart of sector breakdown
 */

import { useRouter } from 'next/router';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  Treemap,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts';
import { fetcher } from '../../lib/fetcher';
import { TradingViewChart, ChartType } from '../../components/TradingViewChart';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Constituent {
  ticker: string;
  name: string;
  sector: string;
  price: number | null;
  change_pct: number | null;
  volume: number | null;
}

interface SectorStat {
  name: string;
  count: number;
  weight_pct: number;
  avg_change_pct: number | null;
}

interface IndexData {
  symbol: string;
  name: string;
  description: string;
  region: string;
  exchange: string;
  currency: string;
  flag: string;
  index_price: number | null;
  index_change_pct: number | null;
  constituents_count: number;
  constituents: Constituent[];
  sectors: SectorStat[];
  prices_included: boolean;
  last_updated: string;
}

type ViewMode = 'chart' | 'heatmap' | 'table' | 'sectors';
type SortKey = 'ticker' | 'name' | 'sector' | 'price' | 'change_pct';

// ── Timeframe config (same as instrument page) ───────────────────────────────
interface Timeframe {
  label: string;
  group: 'intraday' | 'daily';
  fetchPeriod: string;
  fetchInterval: string;
  isIntraday: boolean;
  resampleHours?: number;
  visibleDays?: number;
}

const TIMEFRAMES: Timeframe[] = [
  { label: '5m',  group: 'intraday', fetchPeriod: '5d',  fetchInterval: '5m',  isIntraday: true },
  { label: '15m', group: 'intraday', fetchPeriod: '15d', fetchInterval: '15m', isIntraday: true },
  { label: '30m', group: 'intraday', fetchPeriod: '60d', fetchInterval: '30m', isIntraday: true },
  { label: '1H',  group: 'intraday', fetchPeriod: '60d', fetchInterval: '1h',  isIntraday: true },
  { label: '4H',  group: 'intraday', fetchPeriod: '2y',  fetchInterval: '1h',  isIntraday: true, resampleHours: 4 },
  { label: 'D',   group: 'daily', fetchPeriod: 'max', fetchInterval: '1d',  isIntraday: false },
  { label: '1M',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d',  isIntraday: false, visibleDays: 30 },
  { label: '3M',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d',  isIntraday: false, visibleDays: 90 },
  { label: '6M',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d',  isIntraday: false, visibleDays: 180 },
  { label: '1Y',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1d',  isIntraday: false, visibleDays: 365 },
  { label: '5Y',  group: 'daily', fetchPeriod: 'max', fetchInterval: '1wk', isIntraday: false },
  { label: 'Max', group: 'daily', fetchPeriod: 'max', fetchInterval: '1d',  isIntraday: false },
];

interface HistoricalPoint {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}
interface ChartResponse { ticker: string; period: string; data: HistoricalPoint[]; }

function resampleToNHour(data: HistoricalPoint[], n: number): HistoricalPoint[] {
  const bars = new Map<string, HistoricalPoint>();
  for (const p of data) {
    const dt = new Date(p.date);
    const bucket = Math.floor(dt.getUTCHours() / n) * n;
    const key = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), bucket, 0, 0)).toISOString();
    const e = bars.get(key);
    if (!e) bars.set(key, { date: key, open: p.open, high: p.high, low: p.low, close: p.close, volume: p.volume ?? 0 });
    else { e.high = Math.max(e.high, p.high); e.low = Math.min(e.low, p.low); e.close = p.close; e.volume += (p.volume ?? 0); }
  }
  return Array.from(bars.values()).sort((a, b) => a.date.localeCompare(b.date));
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ─────────────────────────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────────────────────────

function getHeatColor(pct: number | null): string {
  if (pct == null) return '#1e2433';
  if (pct >  4)   return '#0d6e4a';
  if (pct >  2)   return '#1a9e6a';
  if (pct >  0.5) return '#26a69a';
  if (pct >  0)   return '#1d7a6a';
  if (pct > -0.5) return '#8b2020';
  if (pct > -2)   return '#c0392b';
  if (pct > -4)   return '#e53935';
  return '#7b1f1f';
}

const SECTOR_COLORS = [
  '#00d9ff', '#26a69a', '#f9a825', '#ef6c00', '#ab47bc',
  '#42a5f5', '#66bb6a', '#ec407a', '#8d6e63', '#78909c',
  '#ffa726', '#29b6f6', '#9ccc65',
];

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton components
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonHeader() {
  return (
    <div className="border-b border-terminal-border bg-terminal-surface">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-4 w-12 bg-terminal-border animate-pulse rounded" />
          <span className="text-terminal-textDim">/</span>
          <div className="h-4 w-16 bg-terminal-border animate-pulse rounded" />
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className="h-8 w-48 bg-terminal-border animate-pulse rounded mb-2" />
            <div className="h-4 w-64 bg-terminal-border animate-pulse rounded" />
          </div>
          <div className="h-14 w-28 bg-terminal-border animate-pulse rounded" />
        </div>
      </div>
    </div>
  );
}

function SkeletonHeatmap() {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <div className="h-4 w-64 bg-terminal-border animate-pulse rounded mb-3" />
      <div className="h-[580px] bg-terminal-border/30 animate-pulse rounded" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function IndexPage() {
  const router = useRouter();
  const { symbol } = router.query as { symbol?: string };

  const [view, setView] = useState<ViewMode>('chart');
  const [sortKey, setSortKey] = useState<SortKey>('change_pct');
  const [sortDesc, setSortDesc] = useState(true);
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [selectedLabel, setSelectedLabel] = useState('1Y');
  const [chartType, setChartType] = useState<ChartType>('area');

  const tf = TIMEFRAMES.find((t) => t.label === selectedLabel) ?? TIMEFRAMES[9];

  // ── Phase 1: fast — constituents without prices (FMP cache ~1-2s) ──
  const {
    data: fastData,
    error: fastError,
    isLoading: isLoadingFast,
  } = useSWR<IndexData>(
    symbol ? `${API_URL}/api/indices/${symbol}?include_prices=false` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );

  // ── Phase 2: full — with prices (yfinance batch, cached 15min) ──
  const {
    data: fullData,
    isLoading: isLoadingPrices,
  } = useSWR<IndexData>(
    symbol ? `${API_URL}/api/indices/${symbol}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000 * 15,  // 15 min dedupe matches backend cache
    }
  );

  // ── Chart data for the index itself ──
  const { data: chartResponse, isLoading: isLoadingChart } = useSWR<ChartResponse>(
    symbol
      ? `${API_URL}/api/instruments/chart/${encodeURIComponent(symbol)}?period=${tf.fetchPeriod}&interval=${tf.fetchInterval}`
      : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 * 5 }
  );

  const rawHistorical = chartResponse?.data ?? [];
  const historical = useMemo(() => {
    if (tf.resampleHours && rawHistorical.length > 0) return resampleToNHour(rawHistorical, tf.resampleHours);
    return rawHistorical;
  }, [rawHistorical, tf.resampleHours]);

  const lineData = useMemo(() => historical.map((p) => ({ date: p.date, value: p.close })), [historical]);
  const ohlcData  = useMemo(() => historical.map((p) => ({ date: p.date, open: p.open, high: p.high, low: p.low, close: p.close })), [historical]);

  const visibleRange = useMemo(() => {
    if (tf.isIntraday || !tf.visibleDays || historical.length === 0) return undefined;
    const lastDate = historical[historical.length - 1].date.split('T')[0];
    const fromDate = new Date(new Date(lastDate).getTime() - tf.visibleDays * 86_400_000).toISOString().split('T')[0];
    return { from: fromDate, to: lastDate };
  }, [historical, tf.isIntraday, tf.visibleDays]);

  // Use full data (with prices) when available, else fast data (no prices)
  const data = fullData || fastData;
  const pricesLoaded = !!fullData;
  const isInitialLoading = isLoadingFast && !fastData;
  const error = fastError;

  const isPositiveIndex =
    data?.index_change_pct != null && data.index_change_pct >= 0;

  // Loading state — show skeleton header
  if (isInitialLoading || (!data && !error)) {
    return (
      <div className="min-h-screen bg-terminal-bg text-terminal-text">
        <SkeletonHeader />
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex gap-1 mb-6 border-b border-terminal-border pb-4">
            {[80, 80, 80].map((_, i) => (
              <div key={i} className="h-9 w-24 bg-terminal-border animate-pulse rounded" />
            ))}
          </div>
          <SkeletonHeatmap />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text">
      {/* ── Header ── */}
      <div className="border-b border-terminal-border bg-terminal-surface">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-2 text-terminal-textMuted text-sm mb-3">
            <Link href="/indices" className="hover:text-terminal-cyan transition">
              Indices
            </Link>
            <span>/</span>
            <span className="text-terminal-text">{symbol}</span>
          </div>

          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold text-terminal-cyan">
                {data?.flag} {data?.name ?? symbol}
              </h1>
              <p className="text-terminal-textMuted text-sm mt-0.5">
                {data?.exchange} · {data?.currency}
                {data && (
                  <span className="ml-2 text-terminal-textDim">
                    {data.constituents_count} constituents
                  </span>
                )}
              </p>
            </div>

            {data?.index_price != null && (
              <div
                className={`text-right px-4 py-2 rounded ${
                  isPositiveIndex ? 'bg-green-500/10' : 'bg-red-500/10'
                }`}
              >
                <div className="text-xl font-bold num">
                  {data.index_price.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div
                  className={`text-sm font-semibold num ${
                    isPositiveIndex ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {isPositiveIndex ? '+' : ''}
                  {data.index_change_pct?.toFixed(2)}%
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* ── Error ── */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded px-4 py-3 text-red-500 text-sm mb-6">
            Failed to load index data. Please try again.
          </div>
        )}

        {data && (
          <>
            {/* ── Prices loading banner ── */}
            {isLoadingPrices && !pricesLoaded && (
              <div className="flex items-center gap-2 text-xs text-terminal-textDim bg-terminal-surface border border-terminal-border/50 rounded px-3 py-2 mb-4">
                <span className="animate-spin inline-block">⟳</span>
                <span>Loading live prices in background…</span>
              </div>
            )}

            {/* ── View tabs ── */}
            <div className="flex gap-1 mb-6 border-b border-terminal-border pb-4 flex-wrap">
              {(['chart', 'heatmap', 'table', 'sectors'] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-4 py-2 rounded text-sm font-semibold capitalize transition ${
                    view === v
                      ? 'bg-terminal-cyan text-terminal-bg'
                      : 'text-terminal-textMuted hover:text-terminal-text hover:bg-terminal-surfaceHi'
                  }`}
                >
                  {v === 'chart' ? '📈 Chart' : v === 'heatmap' ? '🔥 Heatmap' : v === 'table' ? '📋 Table' : '🥧 Sectors'}
                </button>
              ))}

              {/* Legend for heatmap */}
              {view === 'heatmap' && (
                <div className="ml-auto flex items-center gap-2 text-xs text-terminal-textMuted">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#e53935' }} />
                  <span>-4%+</span>
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#1e2433' }} />
                  <span>0</span>
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#26a69a' }} />
                  <span>+4%+</span>
                </div>
              )}
            </div>

            {/* ── CHART VIEW ── */}
            {view === 'chart' && (
              <div className="bg-terminal-surface border border-terminal-border rounded p-4">
                <div className="mb-3 flex items-center justify-between flex-wrap gap-3">
                  {/* Chart type toggle */}
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider">Price History</h3>
                    <div className="flex border border-terminal-border rounded overflow-hidden">
                      {(['area', 'candle'] as ChartType[]).map((ct) => (
                        <button
                          key={ct}
                          onClick={() => setChartType(ct)}
                          className={`px-2 py-1 text-xs transition border-l first:border-l-0 border-terminal-border ${
                            chartType === ct
                              ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                              : 'text-terminal-textMuted hover:text-terminal-text'
                          }`}
                        >
                          {ct === 'area' ? 'Line' : 'Candle'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Timeframe buttons */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {TIMEFRAMES.filter((t) => t.group === 'intraday').map((t) => (
                      <button
                        key={t.label}
                        onClick={() => setSelectedLabel(t.label)}
                        className={`px-2.5 py-1 text-xs rounded transition num ${
                          selectedLabel === t.label
                            ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                            : 'border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan'
                        }`}
                      >{t.label}</button>
                    ))}
                    <span className="text-terminal-border text-xs mx-0.5">│</span>
                    {TIMEFRAMES.filter((t) => t.group === 'daily').map((t) => (
                      <button
                        key={t.label}
                        onClick={() => setSelectedLabel(t.label)}
                        className={`px-2.5 py-1 text-xs rounded transition num ${
                          selectedLabel === t.label
                            ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                            : 'border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan'
                        }`}
                      >{t.label}</button>
                    ))}
                  </div>
                </div>
                <div className="bg-terminal-bg rounded p-2">
                  {isLoadingChart ? (
                    <div className="h-80 bg-terminal-border/20 animate-pulse rounded" />
                  ) : historical.length > 0 ? (
                    <TradingViewChart
                      data={lineData}
                      ohlcData={ohlcData}
                      chartType={chartType}
                      height={360}
                      color={isPositiveIndex ? '#26a69a' : '#ef5350'}
                      showAxes={true}
                      isIntraday={tf.isIntraday}
                      visibleRange={visibleRange}
                    />
                  ) : (
                    <div className="h-80 flex items-center justify-center text-terminal-textMuted text-sm">
                      No chart data available for {symbol}
                    </div>
                  )}
                </div>
                <p className="text-2xs text-terminal-textDim mt-2">
                  {tf.isIntraday ? `${tf.label} candles · scroll/wheel to zoom` : 'Scroll/drag to see full history'}
                </p>
              </div>
            )}

            {/* ── HEATMAP VIEW ── */}
            {view === 'heatmap' && (
              isLoadingPrices && !pricesLoaded
                ? <SkeletonHeatmap />
                : <HeatmapView constituents={data.constituents} />
            )}

            {/* ── TABLE VIEW ── */}
            {view === 'table' && (
              <TableView
                constituents={data.constituents}
                sortKey={sortKey}
                sortDesc={sortDesc}
                sectorFilter={sectorFilter}
                isLoadingPrices={isLoadingPrices && !pricesLoaded}
                onSort={(key) => {
                  if (key === sortKey) setSortDesc(!sortDesc);
                  else { setSortKey(key); setSortDesc(true); }
                }}
                onSectorFilter={setSectorFilter}
              />
            )}

            {/* ── SECTORS VIEW ── */}
            {view === 'sectors' && (
              <SectorsView sectors={data.sectors} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Heatmap View
// ─────────────────────────────────────────────────────────────────────────────

function HeatmapView({
  constituents,
}: {
  constituents: Constituent[];
}) {
  const treeData = useMemo(() => {
    const bySector: Record<string, Constituent[]> = {};
    for (const c of constituents) {
      const s = c.sector || 'Other';
      if (!bySector[s]) bySector[s] = [];
      bySector[s].push(c);
    }

    return Object.entries(bySector).map(([sector, stocks]) => ({
      name: sector,
      children: stocks.map((s) => ({
        name: s.ticker,
        fullName: s.name,
        value: 1,
        change_pct: s.change_pct,
      })),
    }));
  }, [constituents]);

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <p className="text-xs text-terminal-textDim mb-3">
        Cell size = equal weight · Color = daily % change · Click = go to instrument
      </p>
      <div style={{ width: '100%', height: 580 }}>
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treeData}
            dataKey="value"
            aspectRatio={4 / 3}
            content={<CustomTreemapCell />}
          />
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CustomTreemapCell(props: any) {
  const { x, y, width, height, name, change_pct, depth } = props;

  if (width < 2 || height < 2) return null;

  const fill = depth === 1 ? '#0d1117' : getHeatColor(change_pct);
  const border = depth === 1 ? '#1e2a3a' : '#0a0f1a';

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke={border}
        strokeWidth={depth === 1 ? 2 : 1}
        style={{ cursor: depth === 2 ? 'pointer' : 'default' }}
        onClick={() => {
          if (depth === 2 && name) {
            window.location.href = `/instrument/${name}`;
          }
        }}
      />
      {depth === 1 && width > 60 && height > 20 && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#7a8294"
          fontSize={11}
          fontWeight="600"
          fontFamily="JetBrains Mono, monospace"
        >
          {name.length > 20 ? name.slice(0, 18) + '…' : name}
        </text>
      )}
      {depth === 2 && width > 35 && height > 22 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - (height > 38 ? 7 : 0)}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(255,255,255,0.92)"
            fontSize={Math.min(12, width / 4)}
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            {name}
          </text>
          {height > 38 && (
            <text
              x={x + width / 2}
              y={y + height / 2 + 9}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="rgba(255,255,255,0.7)"
              fontSize={Math.min(10, width / 5)}
              fontFamily="JetBrains Mono, monospace"
            >
              {change_pct != null
                ? `${change_pct >= 0 ? '+' : ''}${change_pct.toFixed(2)}%`
                : '—'}
            </text>
          )}
        </>
      )}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Table View
// ─────────────────────────────────────────────────────────────────────────────

function TableView({
  constituents,
  sortKey,
  sortDesc,
  sectorFilter,
  isLoadingPrices,
  onSort,
  onSectorFilter,
}: {
  constituents: Constituent[];
  sortKey: SortKey;
  sortDesc: boolean;
  sectorFilter: string;
  isLoadingPrices: boolean;
  onSort: (k: SortKey) => void;
  onSectorFilter: (s: string) => void;
}) {
  const filtered = useMemo(() => {
    let list = constituents;
    if (sectorFilter !== 'All') {
      list = list.filter((c) => c.sector === sectorFilter);
    }
    return [...list].sort((a, b) => {
      const aVal = a[sortKey] ?? (sortDesc ? -Infinity : Infinity);
      const bVal = b[sortKey] ?? (sortDesc ? -Infinity : Infinity);
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
      }
      return sortDesc
        ? (bVal as number) - (aVal as number)
        : (aVal as number) - (bVal as number);
    });
  }, [constituents, sortKey, sortDesc, sectorFilter]);

  const allSectors = ['All', ...new Set(constituents.map((c) => c.sector).filter(Boolean))];

  const Th = ({
    label,
    col,
    align = 'left',
  }: {
    label: string;
    col: SortKey;
    align?: string;
  }) => (
    <th
      className={`px-4 py-3 text-xs font-semibold text-terminal-textMuted uppercase tracking-wider cursor-pointer hover:text-terminal-cyan transition text-${align}`}
      onClick={() => onSort(col)}
    >
      {label}
      {sortKey === col && (
        <span className="ml-1 text-terminal-cyan">{sortDesc ? '↓' : '↑'}</span>
      )}
    </th>
  );

  return (
    <div>
      {/* Sector filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {allSectors.map((s) => (
          <button
            key={s}
            onClick={() => onSectorFilter(s)}
            className={`px-3 py-1 text-xs rounded transition ${
              sectorFilter === s
                ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                : 'border border-terminal-border text-terminal-textMuted hover:border-terminal-cyan hover:text-terminal-text'
            }`}
          >
            {s === 'All' ? `All (${constituents.length})` : s}
          </button>
        ))}
      </div>

      <div className="bg-terminal-surface border border-terminal-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-terminal-border">
              <tr>
                <Th label="Ticker" col="ticker" />
                <Th label="Company" col="name" />
                <Th label="Sector" col="sector" />
                <Th label="Price" col="price" align="right" />
                <Th label="Change %" col="change_pct" align="right" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const isPos = c.change_pct != null && c.change_pct >= 0;
                return (
                  <tr
                    key={c.ticker}
                    className={`border-b border-terminal-border/40 hover:bg-terminal-surfaceHi transition cursor-pointer ${
                      i % 2 === 0 ? '' : 'bg-white/[0.01]'
                    }`}
                    onClick={() => (window.location.href = `/instrument/${c.ticker}`)}
                  >
                    <td className="px-4 py-2.5 font-mono font-bold text-terminal-cyan">
                      {c.ticker}
                    </td>
                    <td className="px-4 py-2.5 text-terminal-text max-w-[200px] truncate">
                      {c.name}
                    </td>
                    <td className="px-4 py-2.5 text-terminal-textMuted text-xs">
                      {c.sector || '—'}
                    </td>
                    <td className="px-4 py-2.5 num text-right text-terminal-text">
                      {isLoadingPrices ? (
                        <span className="inline-block h-3 w-12 bg-terminal-border animate-pulse rounded" />
                      ) : c.price != null ? (
                        c.price.toFixed(2)
                      ) : '—'}
                    </td>
                    <td className={`px-4 py-2.5 num text-right font-semibold ${
                      isLoadingPrices
                        ? ''
                        : c.change_pct == null
                        ? 'text-terminal-textMuted'
                        : isPos
                        ? 'text-green-400'
                        : 'text-red-400'
                    }`}>
                      {isLoadingPrices ? (
                        <span className="inline-block h-3 w-10 bg-terminal-border animate-pulse rounded" />
                      ) : c.change_pct != null ? (
                        `${isPos ? '+' : ''}${c.change_pct.toFixed(2)}%`
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-xs text-terminal-textDim border-t border-terminal-border/40">
          {filtered.length} of {constituents.length} constituents
          {isLoadingPrices && (
            <span className="ml-2 text-terminal-textDim animate-pulse">· fetching prices…</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sectors View (donut chart)
// ─────────────────────────────────────────────────────────────────────────────

function SectorsView({ sectors }: { sectors: SectorStat[] }) {
  const data = sectors.map((s) => ({
    name: s.name.length > 22 ? s.name.slice(0, 20) + '…' : s.name,
    fullName: s.name,
    value: s.weight_pct,
    count: s.count,
    avg_change_pct: s.avg_change_pct,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Donut */}
      <div className="bg-terminal-surface border border-terminal-border rounded p-4">
        <h3 className="text-sm font-semibold mb-4 text-terminal-textMuted uppercase tracking-wider">
          Sector Allocation
        </h3>
        <ResponsiveContainer width="100%" height={360}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={80}
              outerRadius={140}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: '#1a2035',
                border: '1px solid #2a3040',
                borderRadius: '4px',
                fontSize: '12px',
              }}
              formatter={(value: any, _name: any, props: any) => [
                `${Number(value).toFixed(1)}% (${props.payload.count} stocks)`,
                props.payload.fullName,
              ]}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              formatter={(value) => (
                <span style={{ color: '#7a8294', fontSize: '11px' }}>{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Sector stats table */}
      <div className="bg-terminal-surface border border-terminal-border rounded p-4">
        <h3 className="text-sm font-semibold mb-4 text-terminal-textMuted uppercase tracking-wider">
          Sector Performance
        </h3>
        <div className="space-y-2">
          {sectors.map((s, i) => {
            const isPos = s.avg_change_pct != null && s.avg_change_pct >= 0;
            const barWidth = Math.max(4, s.weight_pct);
            return (
              <div key={s.name} className="group">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: SECTOR_COLORS[i % SECTOR_COLORS.length] }}
                    />
                    <span className="text-xs text-terminal-text">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-terminal-textDim num">{s.count} stocks</span>
                    {s.avg_change_pct != null && (
                      <span
                        className={`num font-semibold ${
                          isPos ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {isPos ? '+' : ''}
                        {s.avg_change_pct.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-1 bg-terminal-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${barWidth}%`,
                      background: SECTOR_COLORS[i % SECTOR_COLORS.length],
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
