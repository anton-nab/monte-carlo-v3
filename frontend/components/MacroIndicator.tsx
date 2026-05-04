/**
 * MacroIndicator component
 * ========================
 *
 * Carte d'indicateur macro reutilisable. Une carte = un indicateur.
 * Affiche: titre, valeur courante, % de changement, mini-chart (sparkline).
 *
 * Phase 1 MVP. Phase 6 (Bloomberg-style): support multi-axes, EMAs, periodes.
 */

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

import { apiFetch, ApiError } from '@/lib/api';
import type { MacroIndicator as MacroIndicatorData } from '@/types/macro';

interface MacroIndicatorProps {
  /** Code pays: 'us', 'eu', 'gb', 'jp', 'cn' */
  country: string;
  /** Nom logique: 'inflation', 'unemployment', 'fed_rate', ... */
  indicator: string;
  /** Titre affiche (ex: "Inflation (CPI)") */
  title: string;
  /** Decimales d'affichage de la valeur courante */
  decimals?: number;
  /** Format compact (juste valeur + sparkline, pas de chart detaille) */
  compact?: boolean;
}

export function MacroIndicator({
  country,
  indicator,
  title,
  decimals = 2,
  compact = false,
}: MacroIndicatorProps) {
  const [data, setData] = useState<MacroIndicatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        if (err instanceof ApiError) {
          setError(`API error ${err.status}`);
        } else {
          setError('Failed to load');
        }
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
      <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 animate-pulse">
        <div className="h-4 bg-white/20 rounded w-1/3 mb-4"></div>
        <div className="h-8 bg-white/20 rounded w-1/2 mb-2"></div>
        <div className="h-32 bg-white/10 rounded mt-4"></div>
      </div>
    );
  }

  // ----- ERROR -----
  if (error || !data) {
    return (
      <div className="bg-red-900/40 border border-red-500/50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-red-200">{title}</h3>
        <p className="text-sm text-red-300 mt-2">{error || 'No data'}</p>
      </div>
    );
  }

  // ----- LOADED -----
  const isPositive = (data.change_pct ?? 0) >= 0;
  const trendColor = isPositive ? 'text-emerald-400' : 'text-rose-400';
  const trendArrow = isPositive ? '▲' : '▼';
  const lineColor = isPositive ? '#34d399' : '#fb7185';

  // Recharts data format
  const chartData = data.series.map((p) => ({
    date: p.date,
    value: p.value,
  }));

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 border border-white/10 hover:border-white/30 transition">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="text-xs text-white/60 uppercase tracking-wider mt-1">
            {data.country} · {data.frequency} · via {data.source}
          </p>
        </div>
        <span className="text-xs text-white/50">{data.source_id}</span>
      </div>

      {/* Valeur + variation */}
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-3xl font-bold text-white">
          {data.current_value !== null
            ? data.current_value.toFixed(decimals)
            : '—'}
          <span className="text-lg font-normal text-white/70 ml-1">
            {data.unit}
          </span>
        </span>
        {data.change_pct !== null && (
          <span className={`text-sm font-semibold ${trendColor}`}>
            {trendArrow} {Math.abs(data.change_pct).toFixed(2)}%
          </span>
        )}
      </div>

      {/* Chart */}
      {!compact && chartData.length > 0 && (
        <div className="h-40 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.6)' }}
                tickFormatter={(d: string) => d.slice(0, 7)}  // YYYY-MM
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.6)' }}
                domain={['auto', 'auto']}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(15,23,42,0.95)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#fff' }}
                itemStyle={{ color: lineColor }}
                formatter={(v: number) => [`${v.toFixed(decimals)} ${data.unit}`, title]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={2}
                dot={false}
                animationDuration={500}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Footer */}
      <div className="text-xs text-white/40 mt-3">
        {data.series.length} observations · last:{' '}
        {data.series[data.series.length - 1]?.date || 'n/a'}
      </div>
    </div>
  );
}
