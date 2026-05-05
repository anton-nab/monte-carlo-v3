/**
 * MacroIndicator — Phase 1.5 redesign.
 *
 * Carte d'indicateur style trading desk:
 * - Palette terminal (deep navy, accents cyan/bull/bear)
 * - Tous les chiffres en monospace tabular
 * - Sparkline TradingView lightweight-charts (pas Recharts)
 * - Click sur card -> ouvre modal plein-ecran avec chart agrandi + period selector
 * - Hover effect (border cyan)
 * - Loading skeleton et error state propres
 */

import { useEffect, useState } from 'react';

import { apiFetch, ApiError } from '@/lib/api';
import type { MacroIndicator as MacroIndicatorData } from '@/types/macro';

import { TradingViewChart } from './TradingViewChart';
import { IndicatorModal } from './IndicatorModal';

interface MacroIndicatorProps {
  country: string;
  indicator: string;
  title: string;
  decimals?: number;
}

export function MacroIndicator({
  country,
  indicator,
  title,
  decimals = 2,
}: MacroIndicatorProps) {
  const [data, setData] = useState<MacroIndicatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const result = await apiFetch<MacroIndicatorData>(
          `/api/macro/${country}/${indicator}`,
        );
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? `API ${err.status}` : 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    fetchData();

    return () => {
      cancelled = true;
    };
  }, [country, indicator]);

  // ----- LOADING -----
  if (loading) {
    return (
      <div className="card-terminal p-4 animate-pulse">
        <div className="h-3 bg-terminal-border rounded w-1/3 mb-3"></div>
        <div className="h-7 bg-terminal-border rounded w-1/2 mb-2"></div>
        <div className="h-3 bg-terminal-border rounded w-1/4 mb-4"></div>
        <div className="h-20 bg-terminal-border/40 rounded"></div>
      </div>
    );
  }

  // ----- ERROR -----
  if (error || !data) {
    return (
      <div className="card-terminal border-bear-border bg-bear-bg p-4">
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-sm font-medium text-terminal-text">{title}</h3>
          <span className="text-2xs uppercase tracking-wider text-bear">Error</span>
        </div>
        <p className="text-xs text-terminal-textMuted num">{error || 'No data'}</p>
      </div>
    );
  }

  // ----- LOADED -----
  const isPositive = (data.change_pct ?? 0) >= 0;
  const lineColor = isPositive ? '#26a69a' : '#ef5350';
  const trendColorClass = isPositive ? 'text-bull' : 'text-bear';
  const trendArrow = isPositive ? '▲' : '▼';
  const lastDate = data.series[data.series.length - 1]?.date || '—';

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="card-terminal p-4 text-left w-full group cursor-pointer focus:outline-none focus:ring-1 focus:ring-terminal-cyan"
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-terminal-text truncate">{title}</h3>
            <p className="text-2xs text-terminal-textDim uppercase tracking-wider mt-0.5 num">
              {data.country.toUpperCase()} · {data.frequency} · {data.source}
            </p>
          </div>
          <span className="text-2xs text-terminal-textDim num shrink-0 ml-2">
            {data.source_id}
          </span>
        </div>

        {/* Value + change */}
        <div className="flex items-baseline gap-2 mb-3">
          <span className="num text-2xl font-semibold text-terminal-text">
            {data.current_value !== null ? data.current_value.toFixed(decimals) : '—'}
          </span>
          <span className="num text-xs text-terminal-textMuted">{data.unit}</span>
          {data.change_pct !== null && (
            <span className={`num text-sm font-medium ml-auto ${trendColorClass}`}>
              {trendArrow} {Math.abs(data.change_pct).toFixed(2)}%
            </span>
          )}
        </div>

        {/* Sparkline (sans axes pour la densite) */}
        <div className="-mx-1">
          <TradingViewChart
            data={data.series}
            height={80}
            color={lineColor}
            fill
            showAxes={false}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-2xs text-terminal-textDim mt-2 num">
          <span>{data.series.length} obs</span>
          <span>last {lastDate}</span>
          <span className="opacity-0 group-hover:opacity-100 transition text-terminal-cyan">
            click to expand →
          </span>
        </div>
      </button>

      {/* Detail modal */}
      {modalOpen && (
        <IndicatorModal
          data={data}
          title={title}
          decimals={decimals}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
