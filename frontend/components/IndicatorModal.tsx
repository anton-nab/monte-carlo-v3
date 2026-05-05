/**
 * IndicatorModal — vue plein-ecran pour un indicateur clique.
 *
 * Behaviour:
 * - Affiche TOUT l'historique disponible
 * - Period selector cadre la vue initiale (1M / 6M / 1Y / 5Y / Max)
 *   mais l'utilisateur peut SCROLLER/ZOOMER pour voir avant ou apres
 * - Stats panel en bas calculees sur la plage VISIBLE choisie
 * - Lien direct "View source" vers la page FRED de la serie
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

/**
 * Mappe la source d'une serie vers un URL externe pour "View source".
 * Phase 1.5: FRED uniquement. Phase 1.5+: ECB SDW, OECD, etc.
 */
function buildSourceUrl(source: string, sourceId: string): string | null {
  if (source === 'fred') {
    return `https://fred.stlouisfed.org/series/${sourceId}`;
  }
  if (source === 'oecd') {
    return `https://data.oecd.org/`;
  }
  return null;
}

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

  // Compute the initial visible range based on selected period.
  // We DO NOT filter data — full history stays loaded so user can scroll back.
  const visibleRange = useMemo(() => {
    if (data.series.length === 0) return undefined;
    const lastDate = data.series[data.series.length - 1].date;
    const days = PERIOD_DAYS[period];
    if (days === null) {
      // 'Max' — show full range
      return { from: data.series[0].date, to: lastDate };
    }
    const lastTime = new Date(lastDate).getTime();
    const fromTime = lastTime - days * 24 * 60 * 60 * 1000;
    const fromIso = new Date(fromTime).toISOString().slice(0, 10);
    return { from: fromIso, to: lastDate };
  }, [data.series, period]);

  // Stats — computed only on the selected period (user-friendly summary)
  const stats = useMemo(() => {
    if (!visibleRange) return null;
    const fromTime = new Date(visibleRange.from).getTime();
    const inRange = data.series.filter(
      (p) => new Date(p.date).getTime() >= fromTime,
    );
    if (inRange.length === 0) return null;
    const values = inRange.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const first = inRange[0].value;
    const last = inRange[inRange.length - 1].value;
    const periodChange = first !== 0 ? ((last - first) / first) * 100 : 0;
    return { min, max, avg, first, last, periodChange, count: inRange.length };
  }, [data.series, visibleRange]);

  const isPositive = (stats?.periodChange ?? 0) >= 0;
  const lineColor = isPositive ? '#26a69a' : '#ef5350';
  const sourceUrl = buildSourceUrl(data.source, data.source_id);

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
        <div className="border-b border-terminal-border px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-terminal-text">{title}</h2>
            <p className="text-xs text-terminal-textMuted uppercase tracking-wider mt-1 num">
              {data.country} · {data.frequency} · {data.source}/{data.source_id}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-terminal-cyan hover:text-terminal-text border border-terminal-cyan/40 hover:bg-terminal-cyan/10 rounded px-2 py-1 transition num flex items-center gap-1"
                title={`Open on ${data.source.toUpperCase()}`}
              >
                ↗ View on {data.source.toUpperCase()}
              </a>
            )}
            <button
              onClick={onClose}
              className="text-terminal-textMuted hover:text-terminal-text text-2xl leading-none px-2"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Period selector */}
        <div className="border-b border-terminal-border px-6 py-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-terminal-textMuted uppercase tracking-wider mr-2">
            Initial view:
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
          <span className="text-2xs text-terminal-textDim ml-3 italic">
            scroll/drag chart to explore older data
          </span>
          <span className="ml-auto text-xs text-terminal-textMuted num">
            {data.series.length} obs total
          </span>
        </div>

        {/* Chart — TOUTES les donnees, juste cadrees sur la periode demandee */}
        <div className="px-6 py-4">
          <TradingViewChart
            data={data.series}
            height={400}
            color={lineColor}
            fill
            showAxes
            visibleRange={visibleRange}
          />
        </div>

        {/* Stats sur la periode visible initiale */}
        {stats && (
          <div className="border-t border-terminal-border px-6 py-4 grid grid-cols-2 md:grid-cols-6 gap-4">
            <Stat label="Current" value={stats.last} unit={data.unit} decimals={decimals} highlight />
            <Stat
              label={`${period} Δ`}
              value={stats.periodChange}
              unit="%"
              decimals={2}
              colored={stats.periodChange}
            />
            <Stat label="Min" value={stats.min} unit={data.unit} decimals={decimals} />
            <Stat label="Max" value={stats.max} unit={data.unit} decimals={decimals} />
            <Stat label="Average" value={stats.avg} unit={data.unit} decimals={decimals} />
            <Stat label="Period start" value={stats.first} unit={data.unit} decimals={decimals} />
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
