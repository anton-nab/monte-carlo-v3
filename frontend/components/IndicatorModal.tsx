/**
 * IndicatorModal — vue plein-ecran pour un indicateur clique.
 *
 * Affiche le chart agrandi + period selector (1M / 6M / 1Y / 5Y / Max)
 * + statistiques sur la periode visible.
 *
 * Ferme via: clic backdrop, bouton X, ou touche Escape.
 */

import { useEffect, useMemo, useState } from 'react';

import { TradingViewChart } from './TradingViewChart';
import type { MacroIndicator as MacroIndicatorData } from '@/types/macro';

interface IndicatorModalProps {
  data: MacroIndicatorData;
  title: string;
  decimals: number;
  onClose: () => void;
}

type Period = '1M' | '6M' | '1Y' | '5Y' | 'Max';

const PERIOD_DAYS: Record<Period, number | null> = {
  '1M': 30,
  '6M': 180,
  '1Y': 365,
  '5Y': 365 * 5,
  Max: null,
};

export function IndicatorModal({ data, title, decimals, onClose }: IndicatorModalProps) {
  const [period, setPeriod] = useState<Period>('1Y');

  // Lock scroll + Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Filter data to selected period
  const filteredSeries = useMemo(() => {
    const days = PERIOD_DAYS[period];
    if (days === null) return data.series;
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    return data.series.filter((p) => new Date(p.date).getTime() >= cutoffMs);
  }, [data.series, period]);

  // Stats on filtered period
  const stats = useMemo(() => {
    if (filteredSeries.length === 0) return null;
    const values = filteredSeries.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const first = filteredSeries[0].value;
    const last = filteredSeries[filteredSeries.length - 1].value;
    const periodChange = first !== 0 ? ((last - first) / first) * 100 : 0;
    return { min, max, avg, first, last, periodChange };
  }, [filteredSeries]);

  const isPositive = (stats?.periodChange ?? 0) >= 0;
  const lineColor = isPositive ? '#26a69a' : '#ef5350';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-terminal-surface border border-terminal-border rounded-lg w-full max-w-6xl max-h-[90vh] m-4 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-terminal-border px-6 py-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-terminal-text">{title}</h2>
            <p className="text-xs text-terminal-textMuted uppercase tracking-wider mt-1">
              {data.country} · {data.frequency} · {data.source}/{data.source_id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-terminal-textMuted hover:text-terminal-text text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Period selector */}
        <div className="border-b border-terminal-border px-6 py-3 flex items-center gap-2">
          <span className="text-xs text-terminal-textMuted uppercase tracking-wider mr-2">
            Period:
          </span>
          {(Object.keys(PERIOD_DAYS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs rounded transition num ${
                period === p
                  ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                  : 'text-terminal-textMuted hover:text-terminal-text hover:bg-terminal-surfaceHi'
              }`}
            >
              {p}
            </button>
          ))}
          <span className="ml-auto text-xs text-terminal-textMuted num">
            {filteredSeries.length} obs
          </span>
        </div>

        {/* Chart */}
        <div className="px-6 py-4">
          <TradingViewChart
            data={filteredSeries}
            height={400}
            color={lineColor}
            fill
            showAxes
          />
        </div>

        {/* Stats */}
        {stats && (
          <div className="border-t border-terminal-border px-6 py-4 grid grid-cols-2 md:grid-cols-6 gap-4">
            <Stat label="Current" value={stats.last} unit={data.unit} decimals={decimals} highlight />
            <Stat
              label="Period Δ"
              value={stats.periodChange}
              unit="%"
              decimals={2}
              colored={stats.periodChange}
            />
            <Stat label="Min" value={stats.min} unit={data.unit} decimals={decimals} />
            <Stat label="Max" value={stats.max} unit={data.unit} decimals={decimals} />
            <Stat label="Average" value={stats.avg} unit={data.unit} decimals={decimals} />
            <Stat label="Start" value={stats.first} unit={data.unit} decimals={decimals} />
          </div>
        )}
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: number;
  unit: string;
  decimals: number;
  highlight?: boolean;
  colored?: number;
}

function Stat({ label, value, unit, decimals, highlight, colored }: StatProps) {
  const colorClass =
    colored !== undefined
      ? colored >= 0
        ? 'text-bull'
        : 'text-bear'
      : highlight
      ? 'text-terminal-text'
      : 'text-terminal-textMuted';

  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-terminal-textDim">{label}</div>
      <div className={`num text-lg ${colorClass} ${highlight ? 'font-semibold' : ''}`}>
        {colored !== undefined && colored >= 0 ? '+' : ''}
        {value.toFixed(decimals)}
        <span className="text-xs ml-1 opacity-60">{unit}</span>
      </div>
    </div>
  );
}
