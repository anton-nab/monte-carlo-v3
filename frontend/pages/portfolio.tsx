/**
 * /portfolio — Portfolio Analysis Page (Phase 4)
 *
 * Fonctionnalités :
 *  - Constructeur de portefeuille (2–15 actifs + poids)
 *  - Stats portefeuille soumis vs Optimal Sharpe vs Min Vol
 *  - Frontière efficiente (scatter 600 pts colorés par Sharpe)
 *  - Matrice de corrélation (heatmap CSS)
 *  - Tableau actifs individuels
 *  - Monte Carlo corrélé → fan chart + distribution + métriques de risque
 */

import { useState, useCallback } from 'react';
import Head from 'next/head';
import { useSession } from 'next-auth/react';
import {
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ZAxis,
} from 'recharts';
import { Header } from '../components/Header';
import { apiFetch } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AssetRow {
  id: number;
  ticker: string;
  weight: string;
}

interface PortfolioStats {
  weights: Record<string, number>;
  return: number;
  volatility: number;
  sharpe: number;
}

interface IndividualAsset {
  ticker: string;
  return: number;
  volatility: number;
  sharpe: number;
  weight: number;
}

interface FrontierPoint {
  return: number;
  volatility: number;
  sharpe: number;
}

interface FanPoint {
  day: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

interface StackedFanPoint extends FanPoint {
  base: number;
  band_lo: number;
  band_mid_lo: number;
  band_mid_hi: number;
  band_hi: number;
}

interface HistPoint {
  price: number;
  count: number;
}

interface SimMetrics {
  expected_price: number;
  median_price: number;
  std_price: number;
  p5: number;
  p50: number;
  p95: number;
  expected_return: number;
  var_95: number;
  var_99: number;
  es_95: number;
  es_99: number;
  prob_loss: number;
  avg_max_drawdown: number;
  worst_drawdown: number;
  prob_gain_10pct: number;
  prob_loss_10pct: number;
  prob_gain_20pct: number;
  prob_loss_20pct: number;
}

interface PortfolioResult {
  tickers: string[];
  current_portfolio: PortfolioStats;
  optimal_sharpe: PortfolioStats;
  min_volatility: PortfolioStats;
  individual_assets: IndividualAsset[];
  frontier_portfolios: FrontierPoint[];
  correlation_matrix: { tickers: string[]; values: number[][] };
  fan_chart: FanPoint[];
  histogram: HistPoint[];
  metrics: SimMetrics;
  calibration: {
    n_obs: number;
    period: string;
    risk_free_rate: number;
    initial_investment: number;
    ann_returns: Record<string, number>;
    ann_vols: Record<string, number>;
  };
  simulation: { n_sims: number; horizon_days: number };
  computation_time_ms: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers UI
// ─────────────────────────────────────────────────────────────────────────────

const pct  = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const fmt  = (v: number, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (v: number)        => (v >= 0 ? '+' : '');

/** Badge "i" — hover sur desktop, appui long sur mobile (relâcher = ferme) */
function InfoBadge({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <span className="relative inline-flex ml-1 align-middle">
      <span
        onMouseEnter={show}
        onMouseLeave={hide}
        onTouchStart={(e) => { e.preventDefault(); show(); }}
        onTouchEnd={hide}
        onTouchCancel={hide}
        className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full
                   border text-[9px] cursor-help select-none transition-colors
                   ${open
                     ? 'border-terminal-cyan text-terminal-cyan'
                     : 'border-terminal-textDim text-terminal-textDim'}`}
      >
        i
      </span>
      <span className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5
                       w-56 bg-terminal-bg border border-terminal-border rounded-lg
                       px-2.5 py-2 text-xs text-terminal-textMuted leading-relaxed
                       shadow-xl z-50 whitespace-normal text-left font-normal
                       transition-opacity duration-150 pointer-events-none
                       ${open ? 'opacity-100' : 'opacity-0'}`}>
        {text}
      </span>
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

function MetricRow({
  label, value, color, info,
}: {
  label: string; value: string; color?: string; info?: string;
}) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-terminal-border last:border-0">
      <span className="text-terminal-textMuted text-sm flex items-center">
        {label}
        {info && <InfoBadge text={info} />}
      </span>
      <span className={`num text-sm font-medium ${color ?? 'text-terminal-text'}`}>{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontier scatter — coloring by Sharpe
// ─────────────────────────────────────────────────────────────────────────────

/** Split de la frontière en 5 buckets Sharpe pour recharts ScatterChart */
function splitFrontierBySharpe(pts: FrontierPoint[]) {
  const buckets: { color: string; data: FrontierPoint[] }[] = [
    { color: 'rgba(239,83,80,0.55)',  data: [] }, // Sharpe < 0.2
    { color: 'rgba(255,152,0,0.55)', data: [] },  // 0.2–0.6
    { color: 'rgba(255,235,59,0.6)', data: [] },  // 0.6–1.0
    { color: 'rgba(38,166,154,0.65)', data: [] }, // 1.0–1.5
    { color: 'rgba(0,217,255,0.80)', data: [] },  // > 1.5
  ];
  for (const p of pts) {
    if      (p.sharpe < 0.2)  buckets[0].data.push(p);
    else if (p.sharpe < 0.6)  buckets[1].data.push(p);
    else if (p.sharpe < 1.0)  buckets[2].data.push(p);
    else if (p.sharpe < 1.5)  buckets[3].data.push(p);
    else                       buckets[4].data.push(p);
  }
  return buckets;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fan chart helpers (same as simulate page)
// ─────────────────────────────────────────────────────────────────────────────

function toStackedFan(data: FanPoint[]): StackedFanPoint[] {
  return data.map((d) => ({
    ...d,
    base:        d.p5,
    band_lo:     d.p25 - d.p5,
    band_mid_lo: d.p50 - d.p25,
    band_mid_hi: d.p75 - d.p50,
    band_hi:     d.p95 - d.p75,
  }));
}

interface TooltipPayload { payload: StackedFanPoint }

function FanTooltip({
  active, payload, label,
}: {
  active?: boolean; payload?: TooltipPayload[]; label?: number;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const rows = [
    { label: 'P95 — optimiste',  value: d.p95, color: 'rgba(255,100,100,0.85)' },
    { label: 'P75',              value: d.p75, color: 'rgba(180,210,255,0.7)'  },
    { label: 'P50 — médiane',    value: d.p50, color: '#00d9ff', bold: true    },
    { label: 'P25',              value: d.p25, color: 'rgba(180,210,255,0.7)'  },
    { label: 'P5 — pessimiste',  value: d.p5,  color: 'rgba(255,100,100,0.85)' },
  ];
  return (
    <div style={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 6, padding: '8px 12px', fontSize: 12, minWidth: 180 }}>
      <p style={{ color: 'var(--chart-tooltip-muted)', marginBottom: 6, fontFamily: 'monospace' }}>Jour {label}</p>
      {rows.map(({ label: l, value, color, bold }) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color }}>{l}</span>
          <span style={{ color: bold ? color : 'var(--chart-tooltip-text)', fontFamily: 'monospace', fontWeight: bold ? 700 : 400 }}>
            ${value.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Correlation heatmap
// ─────────────────────────────────────────────────────────────────────────────

function corrColor(v: number): string {
  // -1 → rouge, 0 → gris, +1 → cyan
  if (v >= 0) {
    const t = v;
    return `rgba(0,${Math.round(170 * t)},${Math.round(255 * t)},${0.15 + 0.55 * t})`;
  } else {
    const t = -v;
    return `rgba(239,${Math.round(83 * (1 - t))},${Math.round(80 * (1 - t))},${0.15 + 0.55 * t})`;
  }
}

function CorrelationHeatmap({
  tickers,
  values,
}: {
  tickers: string[];
  values: number[][];
}) {
  const n = tickers.length;
  const cellSize = Math.min(52, Math.floor(420 / n));
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'inline-grid', gridTemplateColumns: `${cellSize}px repeat(${n}, ${cellSize}px)`, gap: 2 }}>
        {/* Header row — ticker labels */}
        <div /> {/* empty top-left corner */}
        {tickers.map((t) => (
          <div key={t} style={{ width: cellSize, textAlign: 'center', fontSize: 10, color: 'var(--chart-tooltip-muted)', fontFamily: 'monospace', padding: '2px 0' }}>
            {t.length > 5 ? t.slice(0, 4) + '…' : t}
          </div>
        ))}

        {/* Data rows */}
        {tickers.map((rowTicker, i) => (
          <>
            {/* Row label */}
            <div
              key={`lbl-${rowTicker}`}
              style={{ fontSize: 10, color: 'var(--chart-tooltip-muted)', fontFamily: 'monospace', textAlign: 'right', paddingRight: 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}
            >
              {rowTicker.length > 5 ? rowTicker.slice(0, 4) + '…' : rowTicker}
            </div>
            {/* Cells */}
            {tickers.map((_, j) => {
              const v = values[i][j];
              const isDiag = i === j;
              return (
                <div
                  key={`${i}-${j}`}
                  title={`${tickers[i]} / ${tickers[j]}: ${v.toFixed(3)}`}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    background: isDiag ? 'rgba(0,150,180,0.25)' : corrColor(v),
                    border: isDiag ? '2px solid rgba(0,150,180,0.55)' : '1px solid var(--chart-tooltip-border)',
                    borderRadius: 3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: cellSize > 40 ? 10 : 9,
                    fontFamily: 'monospace',
                    fontWeight: isDiag ? 700 : 400,
                    color: 'var(--chart-tooltip-text)',
                    cursor: 'default',
                  }}
                >
                  {v.toFixed(2)}
                </div>
              );
            })}
          </>
        ))}
      </div>

      {/* Légende */}
      <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 10, color: 'var(--chart-tooltip-muted)', alignItems: 'center' }}>
        <span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(239,40,30,0.55)', borderRadius: 2 }} />
        <span>Corrélation négative</span>
        <span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--chart-grid)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 2 }} />
        <span>Neutre (≈0)</span>
        <span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(0,130,200,0.55)', borderRadius: 2 }} />
        <span>Corrélation positive</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio comparison card
// ─────────────────────────────────────────────────────────────────────────────

function PortfolioCard({
  title,
  stats,
  tickers,
  accent,
  highlight,
}: {
  title: string;
  stats: PortfolioStats;
  tickers: string[];
  accent: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`bg-terminal-surface rounded-lg p-4 border flex-1 min-w-[180px] ${
        highlight ? 'border-terminal-cyan' : 'border-terminal-border'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
          {title}
        </span>
        {highlight && (
          <span className="text-2xs bg-terminal-cyan text-terminal-bg px-1.5 py-0.5 rounded font-semibold">
            Optimal
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <div className="text-2xs text-terminal-textDim">Rendement</div>
          <div className={`num text-sm font-semibold ${stats.return >= 0 ? 'text-bull' : 'text-bear'}`}>
            {sign(stats.return)}{pct(stats.return)}
          </div>
        </div>
        <div>
          <div className="text-2xs text-terminal-textDim">Volatilité</div>
          <div className="num text-sm font-semibold text-warn">{pct(stats.volatility)}</div>
        </div>
        <div>
          <div className="text-2xs text-terminal-textDim">Sharpe</div>
          <div
            className="num text-sm font-semibold"
            style={{ color: accent }}
          >
            {stats.sharpe.toFixed(2)}
          </div>
        </div>
      </div>
      {/* Weights mini table */}
      <div className="space-y-0.5">
        {tickers.map((t) => {
          const w = stats.weights[t] ?? 0;
          return (
            <div key={t} className="flex items-center gap-2 text-2xs">
              <span className="text-terminal-textDim w-12 shrink-0 font-mono">{t}</span>
              <div className="flex-1 bg-terminal-bg rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${(w * 100).toFixed(1)}%`, background: accent, opacity: 0.8 }}
                />
              </div>
              <span className="num text-terminal-textMuted w-10 text-right">{pct(w, 0)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio templates (roulette)
// ─────────────────────────────────────────────────────────────────────────────

interface PortfolioTemplate {
  id: string;
  name: string;
  description: string;
  tag: string;
  color: string;
  assets: { ticker: string; weight: string }[];
}

const PORTFOLIO_TEMPLATES: PortfolioTemplate[] = [
  {
    id: 'tech',
    name: 'Tech Giants',
    description: 'Big Tech US — semi-conducteurs inclus',
    tag: '🚀',
    color: '#00d9ff',
    assets: [
      { ticker: 'AAPL',  weight: '20' },
      { ticker: 'MSFT',  weight: '20' },
      { ticker: 'NVDA',  weight: '20' },
      { ticker: 'GOOGL', weight: '15' },
      { ticker: 'META',  weight: '15' },
      { ticker: 'AMZN',  weight: '10' },
    ],
  },
  {
    id: 'value',
    name: 'Value & Dividendes',
    description: 'P/E faible, dividendes élevés, faible volatilité',
    tag: '💎',
    color: '#f9a825',
    assets: [
      { ticker: 'BRK-B', weight: '25' },
      { ticker: 'JPM',   weight: '20' },
      { ticker: 'JNJ',   weight: '20' },
      { ticker: 'PG',    weight: '20' },
      { ticker: 'KO',    weight: '15' },
    ],
  },
  {
    id: 'allweather',
    name: 'All Weather',
    description: 'Stratégie Ray Dalio — résistant à tous les cycles',
    tag: '⛅',
    color: '#26a69a',
    assets: [
      { ticker: 'SPY', weight: '30' },
      { ticker: 'TLT', weight: '40' },
      { ticker: 'GLD', weight: '15' },
      { ticker: 'IEF', weight: '15' },
    ],
  },
  {
    id: '6040',
    name: '60/40 Classique',
    description: '60 % actions US / 40 % obligations — traditionnel',
    tag: '⚖️',
    color: '#9c27b0',
    assets: [
      { ticker: 'SPY', weight: '60' },
      { ticker: 'AGG', weight: '40' },
    ],
  },
  {
    id: 'global',
    name: 'ETF Mondial',
    description: 'Diversification globale via ETF indiciels',
    tag: '🌍',
    color: '#4caf50',
    assets: [
      { ticker: 'VTI',  weight: '30' },
      { ticker: 'VXUS', weight: '25' },
      { ticker: 'BND',  weight: '20' },
      { ticker: 'GLD',  weight: '15' },
      { ticker: 'VNQ',  weight: '10' },
    ],
  },
  {
    id: 'sante',
    name: 'Santé & Biotech',
    description: 'Pharma, medtech et biotech',
    tag: '🧬',
    color: '#ef6c00',
    assets: [
      { ticker: 'UNH',  weight: '25' },
      { ticker: 'JNJ',  weight: '25' },
      { ticker: 'ABBV', weight: '20' },
      { ticker: 'LLY',  weight: '20' },
      { ticker: 'BMY',  weight: '10' },
    ],
  },
  {
    id: 'energie',
    name: 'Énergie & Transition',
    description: 'Mix fossile + renouvelable',
    tag: '⚡',
    color: '#ff5722',
    assets: [
      { ticker: 'XOM',  weight: '25' },
      { ticker: 'CVX',  weight: '20' },
      { ticker: 'NEE',  weight: '20' },
      { ticker: 'ENPH', weight: '20' },
      { ticker: 'FSLR', weight: '15' },
    ],
  },
  {
    id: 'crypto',
    name: 'Crypto + Actions',
    description: 'Exposition crypto via ETF + tech',
    tag: '₿',
    color: '#ff9800',
    assets: [
      { ticker: 'IBIT',  weight: '20' },
      { ticker: 'COIN',  weight: '15' },
      { ticker: 'MSTR',  weight: '15' },
      { ticker: 'NVDA',  weight: '25' },
      { ticker: 'MSFT',  weight: '25' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Horizons / NSims options
// ─────────────────────────────────────────────────────────────────────────────

const HORIZONS = [
  { label: '3M', days: 63  },
  { label: '6M', days: 126 },
  { label: '1Y', days: 252 },
  { label: '2Y', days: 504 },
  { label: '3Y', days: 756 },
];

const NSIMS_OPTIONS = [500, 1000, 2000, 5000];

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

let _nextId = 1;

export default function PortfolioPage() {
  // ── Formulaire ───────────────────────────────────────────────────────────
  const [assets, setAssets] = useState<AssetRow[]>([
    { id: _nextId++, ticker: 'AAPL',  weight: '25' },
    { id: _nextId++, ticker: 'MSFT',  weight: '25' },
    { id: _nextId++, ticker: 'GOOGL', weight: '25' },
    { id: _nextId++, ticker: 'AMZN',  weight: '25' },
  ]);
  const [horizonDays,       setHorizonDays]       = useState(252);
  const [nSims,             setNSims]             = useState(1000);
  const [riskFreeRate,      setRiskFreeRate]      = useState('5');
  const [initialInvestment, setInitialInvestment] = useState('10000');

  // ── État ─────────────────────────────────────────────────────────────────
  const [result,       setResult]       = useState<PortfolioResult | null>(null);
  const [running,      setRunning]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [spinning,     setSpinning]     = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);

  // ── Save portfolio (Phase 8) ──────────────────────────────────────────────
  const { data: session } = useSession();
  const [saveName,  setSaveName]  = useState('');
  const [saving,    setSaving]    = useState(false);
  const [saveMsg,   setSaveMsg]   = useState<{ ok: boolean; text: string } | null>(null);

  const handleSave = useCallback(async () => {
    if (!result || !session) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await fetch('/api/saves/portfolios', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:    saveName.trim() || `${result.tickers.join(' · ')} · ${new Date().toISOString().slice(0, 10)}`,
          tickers: result.tickers,
          params: {
            period:             result.calibration.period,
            n_sims:             result.simulation.n_sims,
            initial_investment: result.calibration.initial_investment,
            risk_free_rate:     result.calibration.risk_free_rate,
          },
          summary: {
            optimal_sharpe: result.optimal_sharpe,
            min_volatility: result.min_volatility,
            metrics:        result.metrics,
          },
        }),
      });
      if (r.ok) {
        setSaveMsg({ ok: true, text: 'Portfolio enregistré ✓' });
        setSaveName('');
      } else {
        const d = await r.json().catch(() => ({}));
        setSaveMsg({ ok: false, text: d.error ?? 'Erreur lors de la sauvegarde' });
      }
    } catch {
      setSaveMsg({ ok: false, text: 'Erreur réseau' });
    } finally {
      setSaving(false);
    }
  }, [result, session, saveName]);

  // ── Load template ────────────────────────────────────────────────────────
  const loadTemplate = useCallback((tpl: PortfolioTemplate) => {
    setActiveTemplate(tpl.id);
    setAssets(tpl.assets.map((a) => ({ id: _nextId++, ticker: a.ticker, weight: a.weight })));
    setResult(null);
    setError(null);
  }, []);

  const spinRoulette = useCallback(() => {
    setSpinning(true);
    let count = 0;
    const total = 12; // number of flickers
    const interval = setInterval(() => {
      const random = PORTFOLIO_TEMPLATES[Math.floor(Math.random() * PORTFOLIO_TEMPLATES.length)];
      setActiveTemplate(random.id);
      count++;
      if (count >= total) {
        clearInterval(interval);
        setSpinning(false);
        // Final pick
        const final = PORTFOLIO_TEMPLATES[Math.floor(Math.random() * PORTFOLIO_TEMPLATES.length)];
        loadTemplate(final);
      }
    }, 80);
  }, [loadTemplate]);

  // ── Gestion du builder ──────────────────────────────────────────────────
  const addAsset = () => {
    if (assets.length >= 15) return;
    setAssets((prev) => [...prev, { id: _nextId++, ticker: '', weight: '10' }]);
  };

  const removeAsset = (id: number) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
  };

  const updateAsset = (id: number, field: 'ticker' | 'weight', val: string) => {
    setAssets((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: field === 'ticker' ? val.toUpperCase() : val } : a))
    );
  };

  // ── Lancer l'analyse ─────────────────────────────────────────────────────
  const run = useCallback(async () => {
    const valid = assets.filter((a) => a.ticker.trim() && parseFloat(a.weight) > 0);
    if (valid.length < 2) {
      setError('Au moins 2 actifs valides requis (ticker non vide, poids > 0)');
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);

    const body = {
      assets: valid.map((a) => ({ ticker: a.ticker.trim(), weight: parseFloat(a.weight) })),
      horizon_days: horizonDays,
      n_sims: nSims,
      risk_free_rate: (parseFloat(riskFreeRate) || 5) / 100,
      initial_investment: parseFloat(initialInvestment) || 10000,
    };

    try {
      const data = await apiFetch<PortfolioResult>('/api/portfolio/analyze', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'analyse');
    } finally {
      setRunning(false);
    }
  }, [assets, horizonDays, nSims, riskFreeRate, initialInvestment]);

  // ── Dérivés ──────────────────────────────────────────────────────────────
  const stackedFan     = result ? toStackedFan(result.fan_chart) : [];
  const frontierBucket = result ? splitFrontierBySharpe(result.frontier_portfolios) : [];
  const m              = result?.metrics;
  const S0             = result?.calibration.initial_investment ?? 10000;

  const modeBin = result?.histogram.reduce<HistPoint | null>(
    (best, bin) => (best === null || bin.count > best.count ? bin : best),
    null
  );

  const horizonLabel = HORIZONS.find((h) => h.days === horizonDays)?.label ?? `${horizonDays}j`;

  // Points spéciaux sur la frontière
  const currentDot = result ? [{
    volatility: result.current_portfolio.volatility,
    return: result.current_portfolio.return,
    sharpe: result.current_portfolio.sharpe,
    label: 'Actuel',
  }] : [];

  const optSharpeDot = result ? [{
    volatility: result.optimal_sharpe.volatility,
    return: result.optimal_sharpe.return,
    sharpe: result.optimal_sharpe.sharpe,
    label: 'Sharpe max',
  }] : [];

  const minVolDot = result ? [{
    volatility: result.min_volatility.volatility,
    return: result.min_volatility.return,
    sharpe: result.min_volatility.sharpe,
    label: 'Min Vol',
  }] : [];

  // Validation en temps réel
  const validAssets = assets.filter((a) => a.ticker.trim() && parseFloat(a.weight) > 0);
  const totalWeight = validAssets.reduce((s, a) => s + parseFloat(a.weight), 0);

  return (
    <>
      <Head><title>Portfolio — Monte Carlo</title></Head>
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Titre ────────────────────────────────────────────────── */}
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-terminal-cyan">Portfolio Analyzer</h1>
          <span className="text-xs text-terminal-textDim bg-terminal-surface border border-terminal-border px-2 py-0.5 rounded">
            Phase 4 · Markowitz
          </span>
        </div>

        {/* ── Disclaimer ──────────────────────────────────────────── */}
        <div className="flex items-start gap-3 bg-amber-950/30 border border-amber-700/40 rounded-lg px-4 py-3">
          <span className="text-amber-400 text-lg shrink-0 mt-0.5">⚠️</span>
          <p className="text-xs text-amber-200/80 leading-relaxed">
            <strong className="text-amber-300">Avertissement — usage théorique uniquement.</strong>{' '}
            Les simulations Monte Carlo sont un outil d&apos;analyse probabiliste basé sur des données historiques.
            Elles ne constituent <strong>pas des conseils en investissement</strong> et ne préjugent en aucun cas des performances futures.
            Tout investissement comporte un risque de perte en capital.
            Les portefeuilles types ci-dessous sont fournis à titre <strong>illustratif uniquement</strong>.
          </p>
        </div>

        {/* ── Roulette / Templates ─────────────────────────────────── */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <SectionTitle>Portefeuilles types</SectionTitle>
            <button
              onClick={spinRoulette}
              disabled={spinning}
              className={`flex items-center gap-2 px-4 py-2 rounded border text-sm font-semibold transition ${
                spinning
                  ? 'border-terminal-cyan text-terminal-cyan bg-terminal-cyan/10 cursor-wait'
                  : 'border-terminal-border text-terminal-textMuted hover:border-terminal-cyan hover:text-terminal-cyan'
              }`}
            >
              <span className={spinning ? 'animate-spin' : ''} style={{ display: 'inline-block' }}>🎲</span>
              {spinning ? 'Tirage…' : 'Portefeuille aléatoire'}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {PORTFOLIO_TEMPLATES.map((tpl) => {
              const isActive = activeTemplate === tpl.id;
              return (
                <button
                  key={tpl.id}
                  onClick={() => loadTemplate(tpl)}
                  className={`text-left p-3 rounded border transition group ${
                    isActive
                      ? 'border-2 bg-terminal-surfaceHi'
                      : 'border-terminal-border hover:border-terminal-textMuted bg-terminal-bg'
                  }`}
                  style={isActive ? { borderColor: tpl.color } : undefined}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base">{tpl.tag}</span>
                    <span className="text-xs font-semibold text-terminal-text truncate">{tpl.name}</span>
                  </div>
                  <p className="text-[10px] text-terminal-textDim leading-tight">{tpl.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {tpl.assets.map((a) => (
                      <span
                        key={a.ticker}
                        className="text-[9px] font-mono px-1 py-0.5 rounded"
                        style={{
                          background: isActive ? `${tpl.color}22` : 'transparent',
                          color: isActive ? tpl.color : '#6b7280',
                        }}
                      >
                        {a.ticker}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-terminal-textDim">
            Cliquer sur un modèle charge automatiquement les actifs dans le constructeur ci-dessous.
            Les poids peuvent être modifiés librement avant l&apos;analyse.
          </p>
        </div>

        {/* ── Constructeur ────────────────────────────────────────── */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5 space-y-5">
          <SectionTitle>Composition du portefeuille</SectionTitle>

          {/* Asset rows */}
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-[1fr_100px_32px] gap-2 text-2xs text-terminal-textDim uppercase tracking-wider px-1">
              <span>Ticker</span>
              <span>Poids (%)</span>
              <span />
            </div>

            {assets.map((a) => (
              <div key={a.id} className="grid grid-cols-[1fr_100px_32px] gap-2 items-center">
                <input
                  type="text"
                  value={a.ticker}
                  onChange={(e) => updateAsset(a.id, 'ticker', e.target.value)}
                  placeholder="AAPL, BTC-USD…"
                  className="bg-terminal-bg border border-terminal-border text-terminal-text px-3 py-1.5 rounded font-mono text-sm focus:outline-none focus:border-terminal-cyan placeholder:text-terminal-textDim"
                />
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={a.weight}
                  onChange={(e) => updateAsset(a.id, 'weight', e.target.value)}
                  className="bg-terminal-bg border border-terminal-border text-terminal-text px-3 py-1.5 rounded num text-sm focus:outline-none focus:border-terminal-cyan text-right"
                />
                <button
                  onClick={() => removeAsset(a.id)}
                  disabled={assets.length <= 2}
                  className="text-terminal-textDim hover:text-bear disabled:opacity-30 text-lg leading-none flex items-center justify-center h-8"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* Add + normalisation info */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <button
                onClick={addAsset}
                disabled={assets.length >= 15}
                className="text-sm text-terminal-cyan hover:opacity-80 disabled:opacity-30 flex items-center gap-1"
              >
                <span>+</span> Ajouter un actif
              </button>
              <span className="text-xs text-terminal-textDim">
                {assets.length}/15 actifs
              </span>
            </div>
            <div className="text-xs text-terminal-textDim num">
              Somme : <span className={Math.abs(totalWeight - 100) < 1 ? 'text-bull' : 'text-warn'}>
                {totalWeight.toFixed(0)}%
              </span>
              {Math.abs(totalWeight - 100) > 1 && (
                <span className="ml-1 text-terminal-textDim">(sera normalisé à 100%)</span>
              )}
            </div>
          </div>

          {/* Paramètres de simulation */}
          <div className="border-t border-terminal-border pt-4 grid grid-cols-2 md:grid-cols-4 gap-5">
            {/* Investissement initial */}
            <div>
              <label className="block text-xs text-terminal-textDim mb-1">
                Capital initial ($)
              </label>
              <input
                type="number"
                value={initialInvestment}
                onChange={(e) => setInitialInvestment(e.target.value)}
                min="100"
                className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-3 py-1.5 rounded num text-sm focus:outline-none focus:border-terminal-cyan"
              />
            </div>

            {/* Taux sans risque */}
            <div>
              <label className="block text-xs text-terminal-textDim mb-1">
                Taux sans risque (%/an)
                <InfoBadge text="Utilisé pour calculer le ratio de Sharpe = (rendement − taux sans risque) / volatilité. Typiquement le taux des T-Bills US (actuellement ~5%)." />
              </label>
              <input
                type="number"
                value={riskFreeRate}
                onChange={(e) => setRiskFreeRate(e.target.value)}
                min="0" max="20" step="0.5"
                className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-3 py-1.5 rounded num text-sm focus:outline-none focus:border-terminal-cyan"
              />
            </div>

            {/* Horizon */}
            <div>
              <label className="block text-xs text-terminal-textDim mb-2">Horizon MC</label>
              <div className="flex flex-wrap gap-1">
                {HORIZONS.map((h) => (
                  <button
                    key={h.days}
                    onClick={() => setHorizonDays(h.days)}
                    className={`px-2 py-1 rounded border text-xs num transition ${
                      horizonDays === h.days
                        ? 'bg-terminal-surfaceHi border-terminal-cyan text-terminal-cyan'
                        : 'bg-terminal-bg border-terminal-border text-terminal-textMuted hover:text-terminal-text'
                    }`}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </div>

            {/* N sims */}
            <div>
              <label className="block text-xs text-terminal-textDim mb-2">Simulations</label>
              <div className="flex flex-wrap gap-1">
                {NSIMS_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setNSims(n)}
                    className={`px-2 py-1 rounded border text-xs num transition ${
                      nSims === n
                        ? 'bg-terminal-surfaceHi border-terminal-cyan text-terminal-cyan'
                        : 'bg-terminal-bg border-terminal-border text-terminal-textMuted hover:text-terminal-text'
                    }`}
                  >
                    {n >= 1000 ? `${n / 1000}k` : n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={run}
              disabled={running || validAssets.length < 2}
              className={`px-6 py-2.5 rounded font-semibold text-sm transition ${
                running || validAssets.length < 2
                  ? 'bg-terminal-border text-terminal-textDim cursor-not-allowed'
                  : 'bg-terminal-cyan text-terminal-bg hover:opacity-90 active:scale-95'
              }`}
            >
              {running
                ? <span className="flex items-center gap-2"><span className="animate-spin inline-block">⟳</span> Analyse en cours…</span>
                : '▶ Analyser le portefeuille'}
            </button>
            {result && !running && (
              <span className="text-xs text-terminal-textDim num">
                {result.computation_time_ms}ms · {result.calibration.n_obs} jours historique · {nSims.toLocaleString()} trajectoires
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
            <div className="flex gap-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex-1 bg-terminal-surface border border-terminal-border rounded-lg h-40" />
              ))}
            </div>
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
            <div className="text-4xl mb-3">💼</div>
            <p className="text-sm">
              Choisissez un portefeuille type ou construisez le vôtre, puis cliquez sur{' '}
              <strong className="text-terminal-text">▶ Analyser le portefeuille</strong>
            </p>
            <p className="text-xs mt-1">
              Markowitz · Frontière efficiente · Monte Carlo corrélé (Cholesky) · Matrice de corrélation
            </p>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════ */}
        {/* RÉSULTATS                                                    */}
        {/* ════════════════════════════════════════════════════════════ */}

        {result && m && (
          <>
            {/* ── Save portfolio (Phase 8) ─────────────────────────── */}
            {session && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => { setSaveName(e.target.value); setSaveMsg(null); }}
                  placeholder={`${result.tickers.join(' · ')} · ${new Date().toISOString().slice(0, 10)}`}
                  className="flex-1 min-w-[220px] bg-terminal-bg border border-terminal-border rounded px-3 py-1.5
                             text-xs text-terminal-text placeholder:text-terminal-textDim
                             focus:outline-none focus:border-terminal-cyan transition-colors"
                />
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 rounded text-xs font-semibold transition-colors shrink-0
                             bg-terminal-cyan text-terminal-bg hover:opacity-90 disabled:opacity-40"
                >
                  {saving ? 'Enregistrement…' : '💾 Enregistrer'}
                </button>
                {saveMsg && (
                  <span className={`text-xs ${saveMsg.ok ? 'text-bull' : 'text-bear'}`}>
                    {saveMsg.text}
                  </span>
                )}
              </div>
            )}

            {/* ── 1. Comparison cards ───────────────────────────────── */}
            <div>
              <SectionTitle>Comparaison des portefeuilles</SectionTitle>
              <div className="flex flex-wrap gap-4">
                <PortfolioCard
                  title="Portefeuille soumis"
                  stats={result.current_portfolio}
                  tickers={result.tickers}
                  accent="rgba(0,217,255,0.7)"
                />
                <PortfolioCard
                  title="Sharpe maximal"
                  stats={result.optimal_sharpe}
                  tickers={result.tickers}
                  accent="rgba(38,166,154,1)"
                  highlight
                />
                <PortfolioCard
                  title="Volatilité minimale"
                  stats={result.min_volatility}
                  tickers={result.tickers}
                  accent="rgba(255,167,38,0.9)"
                />
              </div>
            </div>

            {/* ── 2. Frontière efficiente + Corrélation ─────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Scatter — Frontière efficiente */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
                <SectionTitle>
                  Frontière efficiente
                  <InfoBadge text="Nuage de 600 portefeuilles aléatoires (poids Dirichlet). L'axe X est la volatilité annualisée, l'axe Y le rendement. La couleur représente le ratio de Sharpe : rouge=faible, cyan=élevé." />
                </SectionTitle>
                <ResponsiveContainer width="100%" height={280}>
                  <ScatterChart margin={{ top: 4, right: 10, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="2 6" stroke="var(--chart-grid)" />
                    <XAxis
                      type="number"
                      dataKey="volatility"
                      name="Volatilité"
                      tickFormatter={(v) => pct(v, 0)}
                      tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 10 }}
                      label={{ value: 'Volatilité', fill: 'var(--chart-tooltip-muted)', fontSize: 10, position: 'insideBottom', offset: -12 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="return"
                      name="Rendement"
                      tickFormatter={(v) => pct(v, 0)}
                      tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 10 }}
                      width={44}
                    />
                    <ZAxis range={[16, 16]} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', fontSize: 11, borderRadius: 6, color: 'var(--chart-tooltip-text)' }}
                      formatter={(v: unknown, name: unknown) => [`${pct(Number(v))}`, String(name ?? '')]}
                      labelFormatter={() => ''}
                    />

                    {/* Frontière colorée par Sharpe */}
                    {frontierBucket.map((b, i) => (
                      <Scatter
                        key={i}
                        data={b.data}
                        fill={b.color}
                        opacity={0.75}
                        name={`Sharpe ${['<0.2','0.2–0.6','0.6–1','1–1.5','>1.5'][i]}`}
                      />
                    ))}

                    {/* Points spéciaux */}
                    <Scatter
                      data={currentDot}
                      fill="none"
                      stroke="#00d9ff"
                      strokeWidth={2}
                      shape="circle"
                      name="Actuel"
                    />
                    <Scatter
                      data={optSharpeDot}
                      fill="#26a69a"
                      stroke="#fff"
                      strokeWidth={1}
                      shape="star"
                      name="Sharpe max"
                    />
                    <Scatter
                      data={minVolDot}
                      fill="#ffa726"
                      stroke="#fff"
                      strokeWidth={1}
                      shape="diamond"
                      name="Min Vol"
                    />
                  </ScatterChart>
                </ResponsiveContainer>

                {/* Légende points spéciaux */}
                <div className="flex gap-4 mt-1 text-2xs text-terminal-textDim flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full border-2 border-terminal-cyan" />
                    Actuel
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm bg-bull" />
                    Sharpe max
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm bg-warn" />
                    Min Vol
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-10 h-1.5 rounded" style={{ background: 'linear-gradient(to right, #ef5350, #ffa726, #00d9ff)' }} />
                    Sharpe (bas → haut)
                  </span>
                </div>
              </div>

              {/* Heatmap corrélation */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
                <SectionTitle>
                  Matrice de corrélation
                  <InfoBadge text="Corrélation de Pearson des rendements log journaliers sur 2 ans. Une corrélation proche de 1 (bleu) signifie que les actifs bougent ensemble — ils ne diversifient pas le risque. Cherchez des corrélations faibles ou négatives (rouge) pour réduire la volatilité du portefeuille." />
                </SectionTitle>
                <CorrelationHeatmap
                  tickers={result.correlation_matrix.tickers}
                  values={result.correlation_matrix.values}
                />
              </div>
            </div>

            {/* ── 3. Tableau actifs individuels ─────────────────────── */}
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
              <SectionTitle>Actifs individuels</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-2xs text-terminal-textDim uppercase tracking-wider border-b border-terminal-border">
                      <th className="pb-2 pr-4">Ticker</th>
                      <th className="pb-2 pr-4 text-right">Poids</th>
                      <th className="pb-2 pr-4 text-right">
                        Rendement/an
                        <InfoBadge text="Rendement log moyen annualisé × 252 sur les 2 dernières années." />
                      </th>
                      <th className="pb-2 pr-4 text-right">
                        Volatilité/an
                        <InfoBadge text="Écart-type des rendements journaliers × √252. Mesure le risque de l'actif seul, hors effets de diversification." />
                      </th>
                      <th className="pb-2 text-right">
                        Sharpe
                        <InfoBadge text="(Rendement − taux sans risque) / Volatilité. Un Sharpe > 1 est bon, > 2 excellent." />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.individual_assets.map((a) => (
                      <tr key={a.ticker} className="border-b border-terminal-border last:border-0 hover:bg-terminal-surfaceHi transition">
                        <td className="py-2 pr-4 font-mono text-terminal-cyan font-semibold">{a.ticker}</td>
                        <td className="py-2 pr-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-terminal-bg rounded-full h-1.5 overflow-hidden">
                              <div
                                className="h-1.5 rounded-full bg-terminal-cyan opacity-60"
                                style={{ width: `${(a.weight * 100).toFixed(0)}%` }}
                              />
                            </div>
                            <span className="num text-terminal-textMuted w-10 text-right">{pct(a.weight, 0)}</span>
                          </div>
                        </td>
                        <td className={`py-2 pr-4 text-right num font-medium ${a.return >= 0 ? 'text-bull' : 'text-bear'}`}>
                          {sign(a.return)}{pct(a.return)}
                        </td>
                        <td className="py-2 pr-4 text-right num text-warn">{pct(a.volatility)}</td>
                        <td className={`py-2 text-right num font-medium ${a.sharpe >= 1 ? 'text-bull' : a.sharpe >= 0 ? 'text-terminal-text' : 'text-bear'}`}>
                          {a.sharpe.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── 4. Fan Chart MC ────────────────────────────────────── */}
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
              <SectionTitle>
                Monte Carlo corrélé — {result.tickers.join(' · ')} · {nSims.toLocaleString()} simulations · {horizonLabel}
              </SectionTitle>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={stackedFan} margin={{ top: 4, right: 12, bottom: 0, left: 12 }}>
                  <CartesianGrid strokeDasharray="2 6" stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 11 }}
                    tickFormatter={(v) => `J${v}`}
                    interval={Math.floor(stackedFan.length / 6)}
                  />
                  <YAxis
                    tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 11 }}
                    tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                    width={64}
                  />
                  <Tooltip content={<FanTooltip />} />

                  <Area stackId="fan" type="monotone" dataKey="base"        stroke="none" fill="transparent"           legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_lo"     stroke="none" fill="rgba(0,217,255,0.07)"  legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_mid_lo" stroke="none" fill="rgba(0,217,255,0.15)"  legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_mid_hi" stroke="none" fill="rgba(0,217,255,0.15)"  legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_hi"     stroke="none" fill="rgba(0,217,255,0.07)"  legendType="none" />

                  <Line type="monotone" dataKey="p50" stroke="#00d9ff"               strokeWidth={2}  dot={false} />
                  <Line type="monotone" dataKey="p95" stroke="rgba(255,100,100,0.6)" strokeWidth={1}  strokeDasharray="4 3" dot={false} />
                  <Line type="monotone" dataKey="p5"  stroke="rgba(255,100,100,0.6)" strokeWidth={1}  strokeDasharray="4 3" dot={false} />

                  <ReferenceLine
                    y={S0}
                    stroke="var(--chart-grid)"
                    strokeDasharray="6 3"
                    label={{ value: `$${S0.toFixed(0)}`, fill: 'var(--chart-tooltip-muted)', fontSize: 10 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex gap-5 mt-2 text-xs text-terminal-textDim flex-wrap">
                <span><span className="inline-block w-5 h-0.5 bg-terminal-cyan align-middle mr-1.5" />P50 médiane</span>
                <span><span className="inline-block w-5 h-0.5 border-t border-dashed border-red-400 opacity-60 align-middle mr-1.5" />P5 pessimiste / P95 optimiste</span>
                <span><span className="inline-block w-3 h-3 rounded-sm bg-terminal-cyan opacity-20 align-middle mr-1.5" />P25–P75 (IQR 50%)</span>
              </div>
            </div>

            {/* ── 5. Histogramme + Métriques ────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Histogramme */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
                <SectionTitle>Distribution des valeurs finales</SectionTitle>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={result.histogram} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="2 6" stroke="var(--chart-grid)" vertical={false} />
                    <XAxis
                      dataKey="price"
                      tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 10 }}
                      tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                      interval={Math.floor(result.histogram.length / 6)}
                    />
                    <YAxis tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 10 }} width={36} />
                    <Tooltip
                      contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 6, fontSize: 12, color: 'var(--chart-tooltip-text)' }}
                      formatter={(v) => [v, 'trajectoires']}
                      labelFormatter={(l) => `Valeur : $${Number(l).toFixed(2)}`}
                    />
                    <Bar dataKey="count" fill="rgba(0,217,255,0.5)" radius={[2, 2, 0, 0]} />

                    <ReferenceLine x={S0} stroke="var(--chart-tooltip-muted)" strokeDasharray="4 2"
                      label={{ value: 'S₀', fill: 'var(--chart-tooltip-muted)', fontSize: 10, position: 'top' }} />
                    <ReferenceLine x={m.p50} stroke="#00d9ff" strokeWidth={1.5}
                      label={{ value: 'P50', fill: '#00d9ff', fontSize: 10, position: 'top' }} />
                    {modeBin && modeBin.price !== m.p50 && (
                      <ReferenceLine x={modeBin.price} stroke="rgba(255,200,0,0.8)" strokeWidth={1.5}
                        label={{ value: 'Mode', fill: 'rgba(255,200,0,0.9)', fontSize: 10, position: 'top' }} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
                {modeBin && (
                  <div className="mt-2 flex gap-4 text-xs text-terminal-textDim flex-wrap">
                    <span>
                      <span className="inline-block w-3 h-0.5 bg-yellow-400 opacity-80 align-middle mr-1" />
                      Valeur la plus probable : <span className="num text-terminal-text">${modeBin.price.toFixed(2)}</span>
                    </span>
                    <span>
                      <span className="inline-block w-3 h-0.5 bg-terminal-cyan align-middle mr-1" />
                      Médiane : <span className="num text-terminal-text">${m.p50.toFixed(2)}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Métriques de risque */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5 space-y-4">
                <SectionTitle>Métriques de risque du portefeuille</SectionTitle>

                <div className="grid grid-cols-2 gap-x-6">
                  {/* Valeur finale */}
                  <div>
                    <p className="text-2xs text-terminal-textDim font-semibold uppercase tracking-wide mb-1">Valeur finale</p>
                    <MetricRow
                      label="Médiane" value={`$${fmt(m.median_price)}`}
                      info="P50 : 50% des portefeuilles terminent au-dessus." />
                    <MetricRow
                      label="Attendue" value={`$${fmt(m.expected_price)}`}
                      info="Moyenne arithmétique des valeurs finales." />
                    <MetricRow
                      label="P5" value={`$${fmt(m.p5)}`} color="text-bear"
                      info="Valeur dépassée dans seulement 5% des scénarios (pessimiste)." />
                    <MetricRow
                      label="P95" value={`$${fmt(m.p95)}`} color="text-bull"
                      info="Valeur atteinte dans 5% des scénarios les plus favorables." />
                    <MetricRow
                      label="Rendement attendu" value={`${sign(m.expected_return)}${pct(m.expected_return)}`}
                      color={m.expected_return >= 0 ? 'text-bull' : 'text-bear'}
                      info="(Valeur finale moyenne − investissement initial) / investissement initial." />
                  </div>

                  {/* Risque */}
                  <div>
                    <p className="text-2xs text-terminal-textDim font-semibold uppercase tracking-wide mb-1">Risque</p>
                    <MetricRow
                      label="VaR 95%" value={pct(m.var_95)}
                      color={m.var_95 < -0.2 ? 'text-bear' : 'text-warn'}
                      info="Value at Risk : perte maximale dans 95% des scénarios sur l'horizon." />
                    <MetricRow
                      label="VaR 99%" value={pct(m.var_99)} color="text-bear"
                      info="Perte maximale dans 99% des scénarios — événements extrêmes." />
                    <MetricRow
                      label="ES 95%" value={pct(m.es_95)} color="text-bear"
                      info="Expected Shortfall : perte MOYENNE dans les 5% pires scénarios." />
                    <MetricRow
                      label="P(perte)" value={pct(m.prob_loss)} color="text-warn"
                      info="Part des simulations où la valeur finale est inférieure à l'investissement initial." />
                    <MetricRow
                      label="Drawdown moyen" value={pct(m.avg_max_drawdown)} color="text-warn"
                      info="Max drawdown moyen sur toutes les trajectoires simulées." />
                  </div>
                </div>

                {/* Probabilités */}
                <div>
                  <p className="text-2xs text-terminal-textDim font-semibold uppercase tracking-wide mb-2">Probabilités</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'P(gain > 10%)',  value: m.prob_gain_10pct, bear: false },
                      { label: 'P(gain > 20%)',  value: m.prob_gain_20pct, bear: false },
                      { label: 'P(perte > 10%)', value: m.prob_loss_10pct, bear: true  },
                      { label: 'P(perte)',        value: m.prob_loss,       bear: true  },
                    ].map(({ label, value, bear }) => (
                      <div key={label}
                        className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 flex justify-between items-center">
                        <span className="text-2xs text-terminal-textDim">{label}</span>
                        <span className={`num text-sm font-semibold ${bear ? 'text-bear' : 'text-bull'}`}>
                          {pct(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── 6. Calibration info ────────────────────────────────── */}
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
              <SectionTitle>Calibration</SectionTitle>
              <div className="flex flex-wrap gap-6 text-xs">
                <span className="text-terminal-textDim">
                  Période : <span className="text-terminal-text num">{result.calibration.period}</span>
                </span>
                <span className="text-terminal-textDim">
                  Observations : <span className="text-terminal-text num">{result.calibration.n_obs} jours</span>
                </span>
                <span className="text-terminal-textDim">
                  Taux sans risque : <span className="text-terminal-text num">{pct(result.calibration.risk_free_rate)}</span>
                </span>
                {result.tickers.map((t) => (
                  <span key={t} className="text-terminal-textDim">
                    <span className="font-mono text-terminal-cyan">{t}</span>
                    {' '}µ=<span className="num text-terminal-text">{sign(result.calibration.ann_returns[t])}{pct(result.calibration.ann_returns[t])}</span>
                    {' '}σ=<span className="num text-warn">{pct(result.calibration.ann_vols[t])}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* ── Disclaimer résultats ───────────────────────────────── */}
            <div className="flex items-start gap-3 border border-terminal-border/50 rounded-lg px-4 py-3 bg-terminal-surface/50">
              <span className="text-terminal-textDim text-sm shrink-0">ℹ️</span>
              <p className="text-[11px] text-terminal-textDim leading-relaxed">
                <strong className="text-terminal-textMuted">Ces résultats sont purement théoriques.</strong>{' '}
                Le modèle GBM (Geometric Brownian Motion) suppose une distribution log-normale des rendements et une volatilité constante,
                hypothèses qui ne reflètent pas la réalité des marchés (queues épaisses, crises, corrélations dynamiques).
                Les performances passées ne présagent pas des performances futures.
                <strong className="text-terminal-textMuted"> Ce n&apos;est pas un conseil en investissement.</strong>
              </p>
            </div>
          </>
        )}
      </main>
    </>
  );
}
