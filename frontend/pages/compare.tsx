/**
 * /compare — Comparaison multi-modèle Monte Carlo + Stress Test (Phase 4.5)
 *
 * 4 modèles simultanés (GBM / Merton / Heston / GARCH) sur le même seed :
 *  - Simulation couplée → la corrélation entre modèles mesure réellement
 *    l'impact de la dynamique propre à chaque modèle
 *  - Variables de stress : volatilité de marché, choc économique,
 *    risque géopolitique, sévérité des crashes
 *  - Fan chart overlay (4 P50 + enveloppe consensus)
 *  - Distribution overlay (histogramme partagé, 4 couleurs)
 *  - Tableau comparatif de métriques (P5/P50/P95/VaR/ES)
 *  - Matrice de corrélation 4×4 entre modèles
 */

import { useState, useCallback } from 'react';
import Head from 'next/head';
import {
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Header } from '../components/Header';
import { apiFetch } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MODEL_KEYS   = ['gbm', 'merton', 'heston', 'garch'] as const;
type ModelKey = typeof MODEL_KEYS[number];

const MODEL_META: Record<ModelKey, { label: string; color: string; desc: string }> = {
  gbm:    { label: 'GBM',    color: '#00d9ff', desc: 'Mouvement Brownien Géométrique — baseline. µ et σ constants, distribution log-normale.' },
  merton: { label: 'Merton', color: '#ff7043', desc: 'Jump-Diffusion — GBM + sauts de Poisson (crises, annonces). Queues épaisses asymétriques.' },
  heston: { label: 'Heston', color: '#ce93d8', desc: 'Volatilité stochastique — σ varie dans le temps avec mean-reversion. Effet levier (ρ < 0).' },
  garch:  { label: 'GARCH',  color: '#81c784', desc: 'GARCH(1,1) Bootstrap — clustering de volatilité, chocs historiques rééchantillonnés.' },
};

const HORIZONS = [
  { label: '3M', days: 63  },
  { label: '6M', days: 126 },
  { label: '1Y', days: 252 },
  { label: '2Y', days: 504 },
  { label: '3Y', days: 756 },
];

const NSIMS_OPTIONS = [500, 1000, 2000, 5000, 10000];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FanPoint   { day: number; p5: number; p25: number; p50: number; p75: number; p95: number }
interface HistPoint  { price: number; count: number }
interface OverlayRow { price: number; gbm: number; merton: number; heston: number; garch: number; consensus: number }

interface SimMetrics {
  expected_price: number; median_price: number; std_price: number;
  p5: number; p50: number; p95: number;
  expected_return: number; var_95: number; var_99: number;
  es_95: number; es_99: number;
  prob_loss: number; avg_max_drawdown: number;
  prob_gain_10pct: number; prob_loss_10pct: number;
}

interface ModelResult {
  fan_chart: FanPoint[];
  histogram: HistPoint[];
  metrics:   SimMetrics;
  params_used: Record<string, number>;
}

interface CompareResult {
  ticker:       string;
  S0:           number;
  calibration:  { mu_pct: number; sigma_pct: number; n_obs: number; period: string; mu_overridden: boolean; sigma_overridden: boolean };
  simulation:   { n_sims: number; horizon_days: number };
  models:       Record<ModelKey, ModelResult>;
  model_names:  string[];
  histogram_overlay: OverlayRow[];
  consensus:    { fan_chart: FanPoint[]; histogram: HistPoint[]; metrics: SimMetrics };
  model_corr:   number[][];
  stress_applied: Record<string, number>;
  computation_time_ms: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stress slider definition
// ─────────────────────────────────────────────────────────────────────────────

interface StressSlider {
  key:       'vol_multiplier' | 'mu_adjustment' | 'geopolitical_risk' | 'crash_severity';
  label:     string;
  icon:      string;
  min:       number;
  max:       number;
  step:      number;
  default:   number;
  format:    (v: number) => string;
  ticks:     { val: number; label: string }[];
  info:      string;
}

const STRESS_SLIDERS: StressSlider[] = [
  {
    key: 'vol_multiplier',
    label: 'Régime de volatilité',
    icon: 'σ×',
    min: 1.0, max: 4.0, step: 0.1, default: 1.0,
    format: (v) => `${v.toFixed(1)}× σ`,
    ticks: [
      { val: 1.0, label: 'Normal'  },
      { val: 1.5, label: 'VIX 30'  },
      { val: 2.0, label: 'VIX 45'  },
      { val: 3.0, label: 'Crise 08' },
      { val: 4.0, label: 'Extrême' },
    ],
    info: 'Multiplie la volatilité σ calibrée historiquement. ×1=normal (VIX~18), ×1.5=marché nerveux (VIX~28), ×2=volatilité élevée (VIX~40), ×3=crise 2008/2020 (VIX~60-80), ×4=scénario catastrophe.',
  },
  {
    key: 'mu_adjustment',
    label: 'Tendance économique',
    icon: 'μ',
    min: -0.30, max: 0.20, step: 0.01, default: 0.0,
    format: (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%/an`,
    ticks: [
      { val: -0.30, label: 'Récession sévère' },
      { val: -0.10, label: 'Récession' },
      { val:  0.00, label: 'Neutre' },
      { val:  0.10, label: 'Croissance' },
      { val:  0.20, label: 'Bull' },
    ],
    info: "Ajuste le drift µ annualisé. -30% = récession sévère (marchés en chute structurelle), -10% = récession, 0% = scénario de base calibré, +10% = croissance soutenue, +20% = fort bull market. S'ajoute au µ calibré historiquement.",
  },
  {
    key: 'geopolitical_risk',
    label: 'Risque géopolitique',
    icon: 'λ',
    min: 0, max: 5, step: 0.1, default: 0,
    format: (v) => `${v.toFixed(1)} sauts/an`,
    ticks: [
      { val: 0,   label: 'Aucun'    },
      { val: 1,   label: 'Faible'   },
      { val: 2.5, label: 'Modéré'   },
      { val: 4,   label: 'Élevé'    },
      { val: 5,   label: 'Extrême'  },
    ],
    info: "Ajoute des sauts de Poisson au modèle Merton. 0 = aucun choc supplémentaire, 1 = ~1 choc géopolitique/an (élection, conflit limité), 2.5 = tensions importantes, 5 = crise géopolitique majeure (guerre, embargo). Affecte la queue gauche de la distribution.",
  },
  {
    key: 'crash_severity',
    label: 'Sévérité des chocs',
    icon: 'Δ',
    min: 0, max: 1, step: 0.05, default: 0,
    format: (v) => {
      if (v < 0.15) return 'Léger (-3%)';
      if (v < 0.40) return 'Modéré (-8%)';
      if (v < 0.65) return 'Sévère (-13%)';
      if (v < 0.85) return 'Crash (-17%)';
      return 'Extrême (-20%)';
    },
    ticks: [
      { val: 0,    label: 'Léger'   },
      { val: 0.25, label: 'Modéré'  },
      { val: 0.5,  label: 'Sévère'  },
      { val: 0.75, label: 'Crash'   },
      { val: 1,    label: 'Extrême' },
    ],
    info: "Taille moyenne des sauts dans le modèle Merton. Léger = -3% par saut (rumeur, news), Modéré = -8% (choc sectoriel), Sévère = -13% (récession, faillite majeure), Crash = -17% (2008-level), Extrême = -20% (marchés 1929 / COVID).",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers UI
// ─────────────────────────────────────────────────────────────────────────────

const pct  = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const fmt  = (v: number, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (v: number)        => v >= 0 ? '+' : '';

function InfoBadge({ text }: { text: string }) {
  return (
    <span title={text}
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-terminal-textDim text-terminal-textDim text-[9px] cursor-help ml-1 select-none hover:border-terminal-cyan hover:text-terminal-cyan transition-colors">
      i
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-terminal-textDim uppercase tracking-widest mb-3">
      {children}
    </h2>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fan chart overlay — 4 P50 lines + consensus + shared envelope
// ─────────────────────────────────────────────────────────────────────────────

interface MergedFanPoint {
  day: number;
  gbm_p50: number; gbm_p5: number; gbm_p95: number;
  merton_p50: number; merton_p5: number; merton_p95: number;
  heston_p50: number; heston_p5: number; heston_p95: number;
  garch_p50: number; garch_p5: number; garch_p95: number;
  cons_p50: number;
  env_lo: number; env_hi: number;  // global min/max across all models
}

function mergeFans(res: CompareResult): MergedFanPoint[] {
  const n = res.models.gbm.fan_chart.length;
  return Array.from({ length: n }, (_, i) => {
    const g = res.models.gbm.fan_chart[i];
    const m = res.models.merton.fan_chart[i];
    const h = res.models.heston.fan_chart[i];
    const r = res.models.garch.fan_chart[i];
    const c = res.consensus.fan_chart[i];
    return {
      day: g.day,
      gbm_p50: g.p50,   gbm_p5: g.p5,   gbm_p95: g.p95,
      merton_p50: m.p50, merton_p5: m.p5, merton_p95: m.p95,
      heston_p50: h.p50, heston_p5: h.p5, heston_p95: h.p95,
      garch_p50:  r.p50, garch_p5:  r.p5, garch_p95:  r.p95,
      cons_p50: c.p50,
      env_lo: Math.min(g.p5,  m.p5,  h.p5,  r.p5),
      env_hi: Math.max(g.p95, m.p95, h.p95, r.p95),
    };
  });
}

interface FanPayload { payload: MergedFanPoint }

function FanOverlayTooltip({ active, payload, label }: { active?: boolean; payload?: FanPayload[]; label?: number }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const rows = [
    { model: 'GBM',    color: MODEL_META.gbm.color,    p50: d.gbm_p50,    p5: d.gbm_p5,    p95: d.gbm_p95    },
    { model: 'Merton', color: MODEL_META.merton.color,  p50: d.merton_p50, p5: d.merton_p5, p95: d.merton_p95 },
    { model: 'Heston', color: MODEL_META.heston.color,  p50: d.heston_p50, p5: d.heston_p5, p95: d.heston_p95 },
    { model: 'GARCH',  color: MODEL_META.garch.color,   p50: d.garch_p50,  p5: d.garch_p5,  p95: d.garch_p95  },
  ];
  return (
    <div style={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 6, padding: '8px 12px', fontSize: 11, minWidth: 220 }}>
      <p style={{ color: 'var(--chart-tooltip-muted)', marginBottom: 6, fontFamily: 'monospace' }}>Jour {label}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', gap: '2px 8px', marginBottom: 2 }}>
        <span style={{ color: 'var(--chart-tooltip-muted)', fontSize: 9 }}>MODÈLE</span>
        <span style={{ color: 'var(--chart-tooltip-muted)', fontSize: 9, textAlign: 'right' }}>P5</span>
        <span style={{ color: 'var(--chart-tooltip-muted)', fontSize: 9, textAlign: 'right' }}>P50</span>
        <span style={{ color: 'var(--chart-tooltip-muted)', fontSize: 9, textAlign: 'right' }}>P95</span>
        {rows.map(({ model, color, p50, p5, p95 }) => (
          <>
            <span key={`m-${model}`} style={{ color, fontWeight: 600 }}>{model}</span>
            <span key={`p5-${model}`}  style={{ color: '#ef5350', fontFamily: 'monospace', textAlign: 'right' }}>${p5.toFixed(0)}</span>
            <span key={`p50-${model}`} style={{ color, fontFamily: 'monospace', fontWeight: 700, textAlign: 'right' }}>${p50.toFixed(0)}</span>
            <span key={`p95-${model}`} style={{ color: '#26a69a', fontFamily: 'monospace', textAlign: 'right' }}>${p95.toFixed(0)}</span>
          </>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--chart-tooltip-border)', marginTop: 4, paddingTop: 4, color: 'var(--chart-tooltip-text)', fontFamily: 'monospace', fontSize: 11 }}>
        Consensus P50 : <strong>${d.cons_p50.toFixed(0)}</strong>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Correlation heatmap 4×4
// ─────────────────────────────────────────────────────────────────────────────

function corrColor4(v: number): string {
  if (v >= 0.99) return 'rgba(0,217,255,0.2)';          // diagonal
  if (v >= 0.8)  return `rgba(0,${Math.round(200*v)},${Math.round(255*v)},0.7)`;
  if (v >= 0.5)  return `rgba(0,${Math.round(150*v)},${Math.round(200*v)},0.45)`;
  if (v >= 0.2)  return `rgba(100,100,${Math.round(180*v)},0.3)`;
  if (v >= 0)    return 'rgba(60,60,70,0.25)';
  return `rgba(239,${Math.round(80*(1+v))},${Math.round(70*(1+v))},${0.3-0.3*v})`;
}

function ModelCorrHeatmap({ corr, names }: { corr: number[][]; names: string[] }) {
  const cell = 54;
  return (
    <div style={{ display: 'inline-grid', gridTemplateColumns: `${cell}px repeat(${names.length}, ${cell}px)`, gap: 3 }}>
      {/* Header */}
      <div />
      {names.map((n) => (
        <div key={n} style={{ fontSize: 10, color: MODEL_META[n as ModelKey]?.color ?? '#7a8294', fontFamily: 'monospace', textAlign: 'center' }}>
          {MODEL_META[n as ModelKey]?.label ?? n}
        </div>
      ))}
      {/* Rows */}
      {names.map((rowN, i) => (
        <>
          <div key={`lbl-${rowN}`} style={{ fontSize: 10, color: MODEL_META[rowN as ModelKey]?.color ?? '#7a8294', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 4 }}>
            {MODEL_META[rowN as ModelKey]?.label ?? rowN}
          </div>
          {names.map((colN, j) => {
            const v = corr[i][j];
            const isDiag = i === j;
            return (
              <div key={`${i}-${j}`}
                title={isDiag ? `${MODEL_META[rowN as ModelKey]?.label} / ${MODEL_META[colN as ModelKey]?.label}` : `corr = ${v.toFixed(3)}`}
                style={{
                  width: cell, height: cell,
                  background: isDiag ? 'rgba(0,217,255,0.15)' : corrColor4(v),
                  border: isDiag ? '1px solid rgba(0,170,200,0.40)' : '1px solid var(--chart-tooltip-border)',
                  borderRadius: 4,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: isDiag ? 9 : 11,
                  fontFamily: 'monospace',
                  cursor: 'default',
                  color: 'var(--chart-tooltip-text)',
                }}>
                {isDiag
                  ? <span style={{ fontSize: 8, color: 'var(--chart-tooltip-muted)' }}>{MODEL_META[rowN as ModelKey]?.label}</span>
                  : v.toFixed(3)
                }
              </div>
            );
          })}
        </>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics comparison table
// ─────────────────────────────────────────────────────────────────────────────

interface MetricDef { key: keyof SimMetrics; label: string; format: (v: number) => string; invert?: boolean; info?: string }

const METRIC_DEFS: MetricDef[] = [
  { key: 'p50',             label: 'P50 — Médiane',        format: (v) => `$${fmt(v)}`, info: 'Prix final médian : 50% des trajectoires terminent au-dessus.' },
  { key: 'p5',              label: 'P5 — Pessimiste',       format: (v) => `$${fmt(v)}`, invert: true, info: '5e percentile : scénario défavorable, atteint dans 5% des cas.' },
  { key: 'p95',             label: 'P95 — Optimiste',       format: (v) => `$${fmt(v)}`, info: '95e percentile : scénario favorable.' },
  { key: 'expected_return', label: 'Rendement attendu',     format: (v) => `${sign(v)}${pct(v)}` },
  { key: 'var_95',          label: 'VaR 95%',               format: (v) => pct(v), invert: true, info: 'Perte maximale dans 95% des scénarios.' },
  { key: 'var_99',          label: 'VaR 99%',               format: (v) => pct(v), invert: true, info: 'Perte maximale dans 99% des scénarios.' },
  { key: 'es_95',           label: 'ES 95%',                format: (v) => pct(v), invert: true, info: 'Perte moyenne dans les 5% pires scénarios (CVaR).' },
  { key: 'prob_loss',       label: 'P(perte)',              format: (v) => pct(v), invert: true, info: 'Probabilité de finir sous le prix initial.' },
  { key: 'avg_max_drawdown', label: 'Drawdown moyen',       format: (v) => pct(v), invert: true },
  { key: 'prob_gain_10pct', label: 'P(gain > 10%)',         format: (v) => pct(v) },
  { key: 'prob_loss_10pct', label: 'P(perte > 10%)',        format: (v) => pct(v), invert: true },
];

function MetricsTable({ result }: { result: CompareResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-terminal-border text-left text-terminal-textDim uppercase tracking-wider">
            <th className="pb-2 pr-4 text-terminal-textDim font-normal w-40">Métrique</th>
            {MODEL_KEYS.map((k) => (
              <th key={k} className="pb-2 px-3 text-right font-semibold" style={{ color: MODEL_META[k].color }}>
                {MODEL_META[k].label}
              </th>
            ))}
            <th className="pb-2 px-3 text-right text-terminal-text font-semibold">Consensus</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_DEFS.map(({ key, label, format, invert, info }) => {
            const allVals = [
              ...MODEL_KEYS.map((k) => result.models[k].metrics[key] as number),
              result.consensus.metrics[key] as number,
            ];
            const bestVal = invert
              ? Math.max(...allVals)   // least negative = best for loss metrics
              : Math.max(...allVals);
            const worstVal = invert
              ? Math.min(...allVals)
              : Math.min(...allVals);

            return (
              <tr key={key} className="border-b border-terminal-border last:border-0 hover:bg-terminal-surfaceHi transition">
                <td className="py-1.5 pr-4 text-terminal-textMuted whitespace-nowrap">
                  {label}
                  {info && <InfoBadge text={info} />}
                </td>
                {MODEL_KEYS.map((k) => {
                  const v = result.models[k].metrics[key] as number;
                  const isBest  = v === bestVal;
                  const isWorst = v === worstVal && allVals.length > 2;
                  const baseColor = invert
                    ? (v < -0.15 ? '#ef5350' : v < 0 ? '#ffa726' : '#e8e9ed')
                    : (v > 0 ? '#26a69a' : '#ef5350');
                  return (
                    <td key={k} className="py-1.5 px-3 text-right num">
                      <span style={{ color: isBest && !invert ? '#26a69a' : isWorst && invert ? '#ef5350' : baseColor,
                                     fontWeight: isBest || isWorst ? 700 : 400 }}>
                        {format(v)}
                      </span>
                    </td>
                  );
                })}
                {/* Consensus */}
                <td className="py-1.5 px-3 text-right num text-terminal-textMuted">
                  {format(result.consensus.metrics[key] as number)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stress slider component
// ─────────────────────────────────────────────────────────────────────────────

type StressState = Record<string, number>;

function StressSlider({
  slider, value, onChange,
}: {
  slider: StressSlider;
  value: number;
  onChange: (key: string, v: number) => void;
}) {
  const pct = ((value - slider.min) / (slider.max - slider.min)) * 100;
  const isDefault = value === slider.default;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm text-terminal-text flex items-center gap-1.5">
          <span>{slider.icon}</span>
          <span>{slider.label}</span>
          <InfoBadge text={slider.info} />
        </label>
        <div className="flex items-center gap-2">
          <span
            className="num text-sm font-semibold"
            style={{ color: isDefault ? '#7a8294' : '#00d9ff', minWidth: 100, textAlign: 'right' }}
          >
            {slider.format(value)}
          </span>
          {!isDefault && (
            <button
              onClick={() => onChange(slider.key, slider.default)}
              className="text-2xs text-terminal-textDim hover:text-terminal-text px-1.5 py-0.5 rounded border border-terminal-border"
              title="Réinitialiser"
            >
              ↺
            </button>
          )}
        </div>
      </div>

      {/* Slider */}
      <div className="relative">
        <input
          type="range"
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={value}
          onChange={(e) => onChange(slider.key, parseFloat(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, #00d9ff ${pct}%, #2a3040 ${pct}%)`,
          }}
        />
        {/* Tick marks */}
        <div className="flex justify-between mt-1">
          {slider.ticks.map(({ val, label }) => {
            const tp = ((val - slider.min) / (slider.max - slider.min)) * 100;
            return (
              <button
                key={val}
                onClick={() => onChange(slider.key, val)}
                className="text-2xs text-terminal-textDim hover:text-terminal-text transition absolute"
                style={{ left: `${tp}%`, transform: 'translateX(-50%)', position: 'absolute', top: 14 }}
                title={label}
              >
                |
              </button>
            );
          })}
        </div>
        <div className="flex justify-between mt-5">
          <span className="text-2xs text-terminal-textDim">{slider.ticks[0].label}</span>
          <span className="text-2xs text-terminal-textDim">{slider.ticks[slider.ticks.length - 1].label}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario presets
// ─────────────────────────────────────────────────────────────────────────────

const PRESETS: { label: string; emoji: string; desc: string; values: StressState }[] = [
  {
    label: 'Base', emoji: '◎', desc: 'Paramètres calibrés sur 2 ans d\'historique, aucun stress.',
    values: { vol_multiplier: 1.0, mu_adjustment: 0.0, geopolitical_risk: 0.0, crash_severity: 0.0 },
  },
  {
    label: 'Bull', emoji: '▲', desc: 'Fort bull market : tendance positive +10%/an, volatilité calme.',
    values: { vol_multiplier: 0.8, mu_adjustment: 0.10, geopolitical_risk: 0.0, crash_severity: 0.0 },
  },
  {
    label: 'Correction', emoji: '↘', desc: 'Correction de marché : volatilité ×1.5, légère tendance négative.',
    values: { vol_multiplier: 1.5, mu_adjustment: -0.05, geopolitical_risk: 0.5, crash_severity: 0.15 },
  },
  {
    label: 'Récession', emoji: '▼', desc: 'Scénario récessif : vol ×2, rendements en baisse, risque géopolitique modéré.',
    values: { vol_multiplier: 2.0, mu_adjustment: -0.15, geopolitical_risk: 1.5, crash_severity: 0.35 },
  },
  {
    label: 'Crise 2008', emoji: '⚠', desc: 'Crise financière systémique : vol ×3, chutes structurelles, sauts fréquents.',
    values: { vol_multiplier: 3.0, mu_adjustment: -0.25, geopolitical_risk: 3.0, crash_severity: 0.70 },
  },
  {
    label: 'Extrême', emoji: '⊗', desc: 'Scénario catastrophe : vol ×4, effondrement, chocs extrêmes.',
    values: { vol_multiplier: 4.0, mu_adjustment: -0.30, geopolitical_risk: 5.0, crash_severity: 1.0 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_STRESS: StressState = {
  vol_multiplier: 1.0, mu_adjustment: 0.0, geopolitical_risk: 0.0, crash_severity: 0.0,
};

export default function ComparePage() {
  // ── Formulaire ─────────────────────────────────────────────────────────
  const [ticker,      setTicker]      = useState('AAPL');
  const [horizonDays, setHorizonDays] = useState(252);
  const [nSims,       setNSims]       = useState(1000);
  const [investment,  setInvestment]  = useState('10000');
  const [stress,      setStress]      = useState<StressState>({ ...DEFAULT_STRESS });
  const [activePreset, setActivePreset] = useState('Base');

  // ── État ─────────────────────────────────────────────────────────────
  const [result,  setResult]  = useState<CompareResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [fanView, setFanView] = useState<'p50' | 'full'>('p50');

  const updateStress = useCallback((key: string, val: number) => {
    setStress((prev) => ({ ...prev, [key]: val }));
    setActivePreset('');   // custom
  }, []);

  const applyPreset = useCallback((preset: typeof PRESETS[number]) => {
    setStress({ ...preset.values });
    setActivePreset(preset.label);
  }, []);

  // ── Run ────────────────────────────────────────────────────────────────
  const run = useCallback(async () => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setRunning(true);
    setError(null);
    setResult(null);

    const body = {
      ticker: t,
      n_sims: nSims,
      horizon_days: horizonDays,
      initial_investment: parseFloat(investment) || 10000,
      stress: {
        vol_multiplier:    stress.vol_multiplier,
        mu_adjustment:     stress.mu_adjustment,
        geopolitical_risk: stress.geopolitical_risk,
        crash_severity:    stress.crash_severity,
      },
    };

    try {
      const data = await apiFetch<CompareResult>('/api/simulate/compare', { method: 'POST', body: JSON.stringify(body) });
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur de simulation');
    } finally {
      setRunning(false);
    }
  }, [ticker, nSims, horizonDays, investment, stress]);

  // ── Dérivés ────────────────────────────────────────────────────────────
  const mergedFan = result ? mergeFans(result) : [];
  const S0        = result?.S0 ?? 10000;
  const hlLabel   = HORIZONS.find((h) => h.days === horizonDays)?.label ?? `${horizonDays}j`;
  const isStressed = Object.entries(stress).some(([k, v]) => v !== DEFAULT_STRESS[k]);

  return (
    <>
      <Head><title>Compare — Monte Carlo</title></Head>
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Titre ─────────────────────────────────────────────────── */}
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-terminal-cyan">Multi-Model Compare</h1>
          <span className="text-xs text-terminal-textDim bg-terminal-surface border border-terminal-border px-2 py-0.5 rounded">
            Phase 4.5 · GBM · Merton · Heston · GARCH
          </span>
        </div>

        {/* ── Panneau principal ─────────────────────────────────────── */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5 space-y-6">

          {/* Row 1 — Ticker + Paramètres de base */}
          <div className="flex flex-wrap gap-6 items-end">
            <div className="min-w-[160px]">
              <label className="block text-xs text-terminal-textDim mb-1">Ticker</label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="AAPL, MSFT, BTC-USD…"
                className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-3 py-2 rounded font-mono text-sm focus:outline-none focus:border-terminal-cyan"
              />
            </div>
            <div className="min-w-[140px]">
              <label className="block text-xs text-terminal-textDim mb-1">Capital initial ($)</label>
              <input
                type="number"
                value={investment}
                onChange={(e) => setInvestment(e.target.value)}
                min="100"
                className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-3 py-1.5 rounded num text-sm focus:outline-none focus:border-terminal-cyan"
              />
            </div>
            <div>
              <label className="block text-xs text-terminal-textDim mb-2">Horizon</label>
              <div className="flex flex-wrap gap-1">
                {HORIZONS.map((h) => (
                  <button key={h.days} onClick={() => setHorizonDays(h.days)}
                    className={`px-2 py-1 rounded border text-xs num transition ${horizonDays === h.days ? 'bg-terminal-surfaceHi border-terminal-cyan text-terminal-cyan' : 'bg-terminal-bg border-terminal-border text-terminal-textMuted hover:text-terminal-text'}`}>
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-terminal-textDim mb-2">
                Simulations
                <InfoBadge text="10k recommandé pour des métriques stables (VaR, ES). Attention : Merton et Heston ont une boucle temporelle Python, 10k×252 jours ≈ 5-15s selon la machine." />
              </label>
              <div className="flex flex-wrap gap-1">
                {NSIMS_OPTIONS.map((n) => (
                  <button key={n} onClick={() => setNSims(n)}
                    className={`px-2 py-1 rounded border text-xs num transition ${nSims === n ? 'bg-terminal-surfaceHi border-terminal-cyan text-terminal-cyan' : 'bg-terminal-bg border-terminal-border text-terminal-textMuted hover:text-terminal-text'}`}>
                    {n >= 1000 ? `${n / 1000}k` : n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Scénarios prédéfinis ─────────────────────────────────── */}
          <div>
            <label className="block text-xs text-terminal-textDim mb-2 uppercase tracking-wider">Scénario de stress</label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  title={p.desc}
                  className={`px-3 py-1.5 rounded border text-sm transition flex items-center gap-1.5 ${
                    activePreset === p.label
                      ? 'bg-terminal-surfaceHi border-terminal-cyan text-terminal-cyan'
                      : 'bg-terminal-bg border-terminal-border text-terminal-textMuted hover:border-terminal-cyan hover:text-terminal-text'
                  }`}
                >
                  <span>{p.emoji}</span>
                  <span>{p.label}</span>
                </button>
              ))}
              {isStressed && !activePreset && (
                <span className="px-3 py-1.5 text-xs text-terminal-textDim bg-terminal-surfaceHi border border-terminal-cyan border-opacity-40 rounded">
                  ✎ Personnalisé
                </span>
              )}
            </div>
          </div>

          {/* ── Sliders de stress ────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-terminal-bg border border-terminal-border rounded-lg p-5">
            <SectionTitle>Variables de stress économique et géopolitique</SectionTitle>
            <div />   {/* placeholder second column title */}
            {STRESS_SLIDERS.map((sl) => (
              <StressSlider key={sl.key} slider={sl} value={stress[sl.key]} onChange={updateStress} />
            ))}
          </div>

          {/* ── Stress summary badge ─────────────────────────────────── */}
          {isStressed && (
            <div className="flex flex-wrap gap-2 text-2xs">
              <span className="text-terminal-textDim">Stress actif :</span>
              {stress.vol_multiplier !== 1.0 && (
                <span className="bg-terminal-surfaceHi border border-terminal-border rounded px-2 py-0.5 text-warn num">
                  σ ×{stress.vol_multiplier.toFixed(1)}
                </span>
              )}
              {stress.mu_adjustment !== 0 && (
                <span className={`bg-terminal-surfaceHi border border-terminal-border rounded px-2 py-0.5 num ${stress.mu_adjustment < 0 ? 'text-bear' : 'text-bull'}`}>
                  µ {stress.mu_adjustment >= 0 ? '+' : ''}{(stress.mu_adjustment * 100).toFixed(0)}%/an
                </span>
              )}
              {stress.geopolitical_risk > 0 && (
                <span className="bg-terminal-surfaceHi border border-terminal-border rounded px-2 py-0.5 text-warn num">
                  λ +{stress.geopolitical_risk.toFixed(1)} sauts/an
                </span>
              )}
              {stress.crash_severity > 0 && (
                <span className="bg-terminal-surfaceHi border border-terminal-border rounded px-2 py-0.5 text-bear num">
                  Δ sévérité {(stress.crash_severity * 100).toFixed(0)}%
                </span>
              )}
            </div>
          )}

          {/* ── CTA ─────────────────────────────────────────────────── */}
          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={run}
              disabled={running || !ticker.trim()}
              className={`px-6 py-2.5 rounded font-semibold text-sm transition ${
                running || !ticker.trim()
                  ? 'bg-terminal-border text-terminal-textDim cursor-not-allowed'
                  : 'bg-terminal-cyan text-terminal-bg hover:opacity-90 active:scale-95'
              }`}
            >
              {running
                ? <span className="flex items-center gap-2"><span className="animate-spin inline-block">⟳</span> Simulation des 4 modèles…</span>
                : '▶ Comparer les 4 modèles'}
            </button>

            {result && !running && (
              <span className="text-xs text-terminal-textDim num">
                {result.computation_time_ms}ms · {nSims.toLocaleString()} trajectoires × 4 modèles
              </span>
            )}
          </div>

          {error && (
            <div className="text-bear text-sm bg-bear bg-opacity-10 border border-bear border-opacity-30 rounded px-3 py-2">
              ❌ {error}
            </div>
          )}
        </div>

        {/* ── Skeleton ──────────────────────────────────────────────── */}
        {running && (
          <div className="space-y-6 animate-pulse">
            <div className="bg-terminal-surface border border-terminal-border rounded-lg h-80" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-terminal-surface border border-terminal-border rounded-lg h-72" />
              <div className="bg-terminal-surface border border-terminal-border rounded-lg h-72" />
            </div>
            <div className="bg-terminal-surface border border-terminal-border rounded-lg h-64" />
          </div>
        )}

        {/* ── Placeholder ───────────────────────────────────────────── */}
        {!result && !running && (
          <div className="border border-dashed border-terminal-border rounded-lg p-12 text-center text-terminal-textDim">
            <div className="text-4xl mb-3 font-mono text-terminal-textDim">⊕</div>
            <p className="text-sm">Choisissez un ticker, un scénario de stress, puis cliquez sur <strong className="text-terminal-text">▶ Comparer les 4 modèles</strong></p>
            <p className="text-xs mt-2 max-w-lg mx-auto leading-relaxed">
              Les 4 modèles tournent avec le même seed aléatoire (simulation couplée).
              La corrélation mesure donc réellement l'impact des dynamiques propres à chaque modèle.
            </p>
            <div className="flex justify-center gap-6 mt-4 flex-wrap">
              {MODEL_KEYS.map((k) => (
                <div key={k} className="flex items-center gap-2 text-xs">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: MODEL_META[k].color }} />
                  <span className="font-semibold" style={{ color: MODEL_META[k].color }}>{MODEL_META[k].label}</span>
                  <span className="text-terminal-textDim">{MODEL_META[k].desc.split(' — ')[0]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════ */}
        {/* RÉSULTATS                                                    */}
        {/* ════════════════════════════════════════════════════════════ */}
        {result && (
          <>
            {/* Badges résumé */}
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 num font-mono">
                {result.ticker} · µ={result.calibration.mu_pct.toFixed(1)}% · σ={result.calibration.sigma_pct.toFixed(1)}%
              </span>
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 text-terminal-textDim">
                {hlLabel} · {nSims.toLocaleString()} sims · {result.calibration.n_obs}j historique
              </span>
              {isStressed && (
                <span className="bg-terminal-surfaceHi border border-terminal-cyan border-opacity-50 rounded px-2 py-1 text-warn">
                  ⚠ Stress : σ×{result.stress_applied.vol_multiplier.toFixed(1)}
                  {result.stress_applied.mu_adjustment !== 0 && ` · µ${result.stress_applied.mu_adjustment >= 0 ? '+' : ''}${(result.stress_applied.mu_adjustment * 100).toFixed(0)}%`}
                </span>
              )}
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 num text-terminal-textDim">
                {result.computation_time_ms}ms
              </span>
            </div>

            {/* ── 1. Fan chart overlay ─────────────────────────────── */}
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <SectionTitle>Fan Chart — P50 par modèle · {hlLabel} · {nSims.toLocaleString()} simulations</SectionTitle>
                <div className="flex gap-1">
                  {(['p50', 'full'] as const).map((v) => (
                    <button key={v} onClick={() => setFanView(v)}
                      className={`text-xs px-2 py-1 rounded border transition ${fanView === v ? 'border-terminal-cyan text-terminal-cyan bg-terminal-surfaceHi' : 'border-terminal-border text-terminal-textDim hover:text-terminal-text'}`}>
                      {v === 'p50' ? 'Médianes' : 'P5/P50/P95'}
                    </button>
                  ))}
                </div>
              </div>

              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={mergedFan} margin={{ top: 4, right: 12, bottom: 0, left: 16 }}>
                  <CartesianGrid strokeDasharray="2 6" stroke="var(--chart-grid)" />
                  <XAxis dataKey="day" tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 11 }} tickFormatter={(v) => `J${v}`}
                    interval={Math.floor(mergedFan.length / 6)} />
                  <YAxis tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 11 }} tickFormatter={(v) => `$${Number(v).toFixed(0)}`} width={64} />
                  <Tooltip content={<FanOverlayTooltip />} />

                  {/* Enveloppe globale (min P5 → max P95 de tous les modèles) */}
                  {fanView === 'full' && (
                    <>
                      <Area dataKey="env_lo"    fill="transparent" stroke="none" legendType="none" />
                      <Area dataKey="env_hi"    fill="var(--chart-grid)" stroke="none" legendType="none" stackId="env" />
                    </>
                  )}

                  {/* P5/P95 en vue "full" */}
                  {fanView === 'full' && MODEL_KEYS.map((k) => (
                    <Line key={`${k}_p5`}  type="monotone" dataKey={`${k}_p5`}  stroke={MODEL_META[k].color}
                      strokeWidth={0.8} strokeDasharray="3 3" dot={false} opacity={0.45} legendType="none" />
                  ))}
                  {fanView === 'full' && MODEL_KEYS.map((k) => (
                    <Line key={`${k}_p95`} type="monotone" dataKey={`${k}_p95`} stroke={MODEL_META[k].color}
                      strokeWidth={0.8} strokeDasharray="3 3" dot={false} opacity={0.45} legendType="none" />
                  ))}

                  {/* P50 lines — toujours visibles */}
                  {MODEL_KEYS.map((k) => (
                    <Line key={`${k}_p50`} type="monotone" dataKey={`${k}_p50`}
                      stroke={MODEL_META[k].color} strokeWidth={2} dot={false}
                      name={MODEL_META[k].label} />
                  ))}

                  {/* Consensus */}
                  <Line type="monotone" dataKey="cons_p50" stroke="var(--chart-tooltip-muted)"
                    strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Consensus" />

                  {/* S0 reference */}
                  <ReferenceLine y={S0} stroke="var(--chart-grid)" strokeDasharray="5 3"
                    label={{ value: `$${S0.toFixed(0)}`, fill: 'var(--chart-tooltip-muted)', fontSize: 10 }} />
                </ComposedChart>
              </ResponsiveContainer>

              {/* Légende modèles */}
              <div className="flex flex-wrap gap-5 mt-3 text-xs">
                {MODEL_KEYS.map((k) => (
                  <div key={k} className="flex items-start gap-2">
                    <span className="inline-block w-5 h-0.5 mt-1.5 flex-shrink-0" style={{ background: MODEL_META[k].color }} />
                    <div>
                      <span className="font-semibold" style={{ color: MODEL_META[k].color }}>{MODEL_META[k].label}</span>
                      <span className="text-terminal-textDim ml-1">{MODEL_META[k].desc.split(' — ')[1]?.split('.')[0]}</span>
                    </div>
                  </div>
                ))}
                <div className="flex items-start gap-2">
                  <span className="inline-block w-5 h-0.5 mt-1.5 flex-shrink-0 opacity-30" style={{ borderTop: '1px dashed white' }} />
                  <span className="text-terminal-textDim">Consensus (médiane des 4)</span>
                </div>
              </div>
            </div>

            {/* ── 2. Distribution overlay + Corrélation ─────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Overlay distribution */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
                <SectionTitle>
                  Distribution des prix finaux — overlay 4 modèles
                  <InfoBadge text="Histogramme partagé (même axe X). Chaque barre montre combien de trajectoires d'un modèle terminent dans ce bin de prix. Les modèles qui s'écartent le plus du GBM ont des queues plus épaisses." />
                </SectionTitle>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={result.histogram_overlay} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barCategoryGap={0} barGap={0}>
                    <CartesianGrid strokeDasharray="2 6" stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="price" tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 9 }}
                      tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                      interval={Math.floor(result.histogram_overlay.length / 6)} />
                    <YAxis tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 10 }} width={32} />
                    <Tooltip
                      contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 6, fontSize: 11, color: 'var(--chart-tooltip-text)' }}
                      labelFormatter={(l) => `Prix : $${Number(l).toFixed(0)}`}
                    />
                    {MODEL_KEYS.map((k) => (
                      <Bar key={k} dataKey={k} name={MODEL_META[k].label}
                        fill={MODEL_META[k].color} opacity={0.45} radius={0} stackId={undefined} />
                    ))}
                    <ReferenceLine x={S0} stroke="var(--chart-tooltip-muted)" strokeDasharray="4 2"
                      label={{ value: 'S₀', fill: 'var(--chart-tooltip-muted)', fontSize: 9, position: 'top' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Corrélation entre modèles */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
                <SectionTitle>
                  Corrélation entre modèles (simulation couplée)
                  <InfoBadge text="Corrélation de Pearson des prix finaux, calculée avec le même seed aléatoire pour les 4 modèles. Une corrélation élevée (cyan) signifie que les deux modèles donnent des résultats similaires sur cet actif. Une faible corrélation (rouge/gris) révèle que les dynamiques stochastiques divergent — Merton avec des sauts fréquents, Heston avec une vol changeante, ou GARCH avec du clustering divergent du GBM de base." />
                </SectionTitle>
                <ModelCorrHeatmap corr={result.model_corr} names={result.model_names} />

                {/* Interprétation */}
                <div className="mt-4 space-y-1.5">
                  {result.model_names.map((n, i) =>
                    result.model_names.slice(i + 1).map((m, jj) => {
                      const j = i + 1 + jj;
                      const r = result.model_corr[i][j];
                      const strength = r > 0.8 ? 'très corrélés' : r > 0.5 ? 'modérément corrélés' : r > 0.2 ? 'faiblement corrélés' : 'divergents';
                      const color = r > 0.8 ? '#26a69a' : r > 0.5 ? '#ffa726' : '#ef5350';
                      return (
                        <div key={`${n}-${m}`} className="flex items-center gap-2 text-xs">
                          <span style={{ color: MODEL_META[n as ModelKey]?.color }}>{MODEL_META[n as ModelKey]?.label}</span>
                          <span className="text-terminal-textDim">↔</span>
                          <span style={{ color: MODEL_META[m as ModelKey]?.color }}>{MODEL_META[m as ModelKey]?.label}</span>
                          <span className="text-terminal-textDim">:</span>
                          <span className="num font-semibold" style={{ color }}>{r.toFixed(3)}</span>
                          <span className="text-terminal-textDim italic">{strength}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* ── 3. Tableau métriques ──────────────────────────────── */}
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
              <SectionTitle>
                Comparaison des métriques — {result.ticker} · {hlLabel}
                <InfoBadge text="La colonne la plus favorable est en vert gras, la plus défavorable en rouge gras. Le consensus est la moyenne des 4 modèles sur les chemins." />
              </SectionTitle>
              <MetricsTable result={result} />
            </div>

            {/* ── 4. Paramètres de stress effectifs ────────────────── */}
            {isStressed && (
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
                <SectionTitle>Paramètres de stress appliqués</SectionTitle>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <div>
                    <div className="text-terminal-textDim mb-1">σ stressé (annuel)</div>
                    <div className="num text-warn font-semibold">
                      {pct(result.stress_applied.sigma_stressed)}
                      <span className="text-terminal-textDim font-normal ml-1">(×{result.stress_applied.vol_multiplier.toFixed(1)} hist.)</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-terminal-textDim mb-1">µ stressé (annuel)</div>
                    <div className={`num font-semibold ${result.stress_applied.mu_stressed >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {sign(result.stress_applied.mu_stressed)}{pct(result.stress_applied.mu_stressed)}
                    </div>
                  </div>
                  <div>
                    <div className="text-terminal-textDim mb-1">λ Merton (sauts/an)</div>
                    <div className="num text-terminal-text font-semibold">{result.stress_applied.lambda_merton.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-terminal-textDim mb-1">Saut moyen Merton</div>
                    <div className="num text-bear font-semibold">{pct(result.stress_applied.jump_mean)}</div>
                  </div>
                  <div>
                    <div className="text-terminal-textDim mb-1">ρ Heston (S–v)</div>
                    <div className="num text-terminal-text font-semibold">{result.stress_applied.rho_heston.toFixed(3)}</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
