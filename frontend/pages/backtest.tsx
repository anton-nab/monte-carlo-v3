/**
 * /backtest — Rolling-window Monte Carlo Backtesting (Phase 9)
 *
 * Form → POST /api/backtest → display:
 *   • 8 metric cards (Sharpe, Sortino, MaxDD, Calmar, HitRate, VaR Coverage, Ann.Return, Ann.Vol)
 *   • Equity curve (cumulative realized return over time)
 *   • Returns vs VaR chart (realized bars + VaR 95% line + breach markers)
 *   • Calibration summary strip
 */

import { useState, useCallback } from 'react';
import Head from 'next/head';
import {
  ComposedChart,
  Bar,
  Cell,
  Line,
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
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BacktestWindow {
  date:              string;
  real_return:       number;
  pred_var_95:       number;
  pred_es_95:        number;
  pred_prob_loss:    number;
  breach:            boolean;
  cumulative_return: number;
}

interface BacktestMetrics {
  n_windows:          number;
  total_return:       number;
  annualized_return:  number;
  annualized_vol:     number;
  sharpe:             number;
  sortino:            number;
  max_drawdown:       number;
  calmar:             number;
  hit_rate:           number;
  coverage_95:        number;
  miscalibration:     number;
  is_well_calibrated: boolean;
  mean_pred_var_95:   number;
  mean_pred_es_95:    number;
  bias:               number;
}

interface BacktestCalibration {
  mu:        number;
  sigma:     number;
  mu_pct:    number;
  sigma_pct: number;
  S0:        number;
  n_obs:     number;
}

interface BacktestResult {
  ticker:              string;
  model:               string;
  period:              string;
  lookback_days:       number;
  horizon_days:        number;
  n_sims:              number;
  n_windows:           number;
  calibration:         BacktestCalibration;
  windows:             BacktestWindow[];
  metrics:             BacktestMetrics;
  computation_time_ms: number;
}

type ModelId = 'gbm' | 'merton' | 'heston' | 'garch';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MODELS: { id: ModelId; label: string; desc: string }[] = [
  {
    id: 'gbm', label: 'GBM',
    desc: 'Geometric Brownian Motion — le modèle de Black-Scholes. Drift µ et volatilité σ sont constants dans le temps. Distribution log-normale : jamais de prix négatif, trajectoires lisses et continues. Idéal comme référence de base pour comparer les autres modèles.',
  },
  {
    id: 'merton', label: 'Merton',
    desc: 'Jump-Diffusion de Merton — GBM + sauts brusques aléatoires (processus de Poisson). Modélise les chocs soudains : publications trimestrielles, crises, upgrades/downgrades. Queues de distribution plus épaisses qu\'un GBM pur. Produit en général une VaR plus élevée.',
  },
  {
    id: 'heston', label: 'Heston',
    desc: 'Volatilité stochastique de Heston — σ n\'est plus constante mais évolue aléatoirement autour d\'une moyenne long-terme, avec un retour à la moyenne (kappa=2, rho=−0.7). Capture le clustering de volatilité et le smile d\'options. Modèle le plus réaliste pour les indices sur horizons longs.',
  },
  {
    id: 'garch', label: 'GARCH',
    desc: 'Bootstrap GARCH(1,1) — calibré sur les résidus historiques réels. Simule le clustering de volatilité : les crises appellent les crises. Dépend peu de µ/σ théoriques ; reproduit la dynamique temporelle des rendements passés. Peut être plus lent sur les longues séries.',
  },
];

const PERIODS = ['3y', '5y', '10y', 'max'];

const LOOKBACKS = [
  { label: '3M',  days: 63  },
  { label: '6M',  days: 126 },
  { label: '1Y',  days: 252 },
  { label: '2Y',  days: 504 },
];

const HORIZONS = [
  { label: '1W',  days: 5   },
  { label: '2W',  days: 10  },
  { label: '1M',  days: 20  },
  { label: '3M',  days: 63  },
  { label: '6M',  days: 126 },
];

const NSIMS_OPTIONS = [100, 500, 1000, 2000, 5000];

// Chart colours (hardcoded — consistent across light/dark)
const C_CYAN   = '#00e5ff';
const C_GREEN  = '#009371';
const C_RED    = 'rgba(255,100,100,0.85)';
const C_ORANGE = 'rgba(255,180,0,0.85)';
const C_GRID   = 'var(--chart-grid)';

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────

const pct   = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const round = (v: number, d = 2) => v.toFixed(d);

/** Badge "?" avec tooltip personnalisé visible au survol */
function InfoBadge({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group ml-1" style={{ verticalAlign: 'middle' }}>
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full
                       border border-terminal-textDim text-terminal-textDim text-[9px]
                       cursor-help select-none
                       group-hover:border-terminal-cyan group-hover:text-terminal-cyan
                       transition-colors">
        ?
      </span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                       w-64 bg-terminal-bg border border-terminal-border rounded-lg
                       px-3 py-2 text-xs text-terminal-textMuted leading-relaxed
                       shadow-xl z-50
                       opacity-0 pointer-events-none group-hover:opacity-100
                       transition-opacity duration-150
                       whitespace-normal text-left font-normal">
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

/** Segment button (toggle group) */
function SegBtn({
  active, onClick, children, title,
}: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${
        active
          ? 'bg-terminal-cyan text-terminal-bg font-semibold'
          : 'bg-terminal-bg border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan'
      }`}
    >
      {children}
    </button>
  );
}

interface MetricCardProps {
  label:  string;
  value:  string;
  sub?:   string;
  tone?:  'good' | 'bad' | 'warn' | 'neutral';
  info?:  string;
}

function MetricCard({ label, value, sub, tone = 'neutral', info }: MetricCardProps) {
  const color =
    tone === 'good'    ? 'text-bull'
    : tone === 'bad'   ? 'text-bear'
    : tone === 'warn'  ? 'text-warn'
    : 'text-terminal-cyan';
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-terminal-textDim uppercase tracking-wide flex items-center">
        {label}
        {info && <InfoBadge text={info} />}
      </span>
      <span className={`num text-2xl font-semibold ${color}`}>{value}</span>
      {sub && <span className="text-xs text-terminal-textMuted">{sub}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom tooltips
// ─────────────────────────────────────────────────────────────────────────────

function EquityTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val: number = payload[0]?.value ?? 0;
  return (
    <div className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-xs shadow-lg">
      <div className="text-terminal-textMuted mb-1">{label}</div>
      <div
        className="num font-semibold"
        style={{ color: val >= 0 ? C_GREEN : C_RED }}
      >
        {val >= 0 ? '+' : ''}{pct(val)}
      </div>
    </div>
  );
}

function ReturnsTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const real = payload.find((p: any) => p.dataKey === 'real_return');
  const varP = payload.find((p: any) => p.dataKey === 'pred_var_95');
  return (
    <div className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-xs shadow-lg min-w-[160px]">
      <div className="text-terminal-textMuted mb-2">{label}</div>
      {real && (
        <div className="flex justify-between gap-4">
          <span className="text-terminal-textMuted">Realized</span>
          <span
            className="num font-semibold"
            style={{ color: real.value >= 0 ? C_GREEN : C_RED }}
          >
            {real.value >= 0 ? '+' : ''}{pct(real.value)}
          </span>
        </div>
      )}
      {varP && (
        <div className="flex justify-between gap-4">
          <span className="text-terminal-textMuted">VaR 95%</span>
          <span className="num font-semibold" style={{ color: C_ORANGE }}>
            {pct(varP.value)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function BacktestPage() {
  // Form state
  const [ticker,   setTicker]   = useState('AAPL');
  const [period,   setPeriod]   = useState('5y');
  const [model,    setModel]    = useState<ModelId>('gbm');
  const [lookback, setLookback] = useState(252);
  const [horizon,  setHorizon]  = useState(20);
  const [nSims,    setNSims]    = useState(500);

  // Result state
  const [result,  setResult]  = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiFetch<BacktestResult>('/api/backtest', {
        method: 'POST',
        body: JSON.stringify({
          ticker:        t,
          period,
          model,
          lookback_days: lookback,
          horizon_days:  horizon,
          n_sims:        nSims,
        }),
      });
      setResult(data);
    } catch (err: any) {
      setError(err?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [ticker, period, model, lookback, horizon, nSims]);

  const m = result?.metrics;

  // Chart data
  const equityData = result?.windows.map((w) => ({
    date:  w.date.slice(0, 7),
    value: w.cumulative_return,
  })) ?? [];

  const returnsData = result?.windows.map((w) => ({
    date:        w.date.slice(0, 7),
    real_return: w.real_return,
    pred_var_95: w.pred_var_95,
    breach:      w.breach,
  })) ?? [];

  const nBreaches  = result?.windows.filter((w) => w.breach).length ?? 0;
  const breachRate = result ? nBreaches / result.n_windows : 0;

  return (
    <>
      <Head>
        <title>Backtest — Monte Carlo</title>
      </Head>
      <div className="min-h-screen bg-terminal-bg text-terminal-text">
        <Header />

        <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

          {/* ── Page title ─────────────────────────────────────────────── */}
          <div>
            <h1 className="text-xl font-semibold text-terminal-text">
              Rolling-Window Backtest
            </h1>
            <p className="text-sm text-terminal-textMuted mt-0.5">
              Calibrate a Monte Carlo model on historical windows and measure predicted risk vs realised returns.
            </p>
          </div>

          {/* ── Form ──────────────────────────────────────────────────── */}
          <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5 space-y-5">
            <SectionTitle>Parameters</SectionTitle>

            {/* Ticker + Period */}
            <div className="flex flex-wrap gap-5 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-terminal-textMuted uppercase tracking-wide">Ticker</label>
                <input
                  type="text"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleRun()}
                  placeholder="AAPL"
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-1.5 text-sm
                             text-terminal-text w-28 focus:outline-none focus:border-terminal-cyan
                             transition-colors font-mono uppercase"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-terminal-textMuted uppercase tracking-wide">History</label>
                <div className="flex gap-1">
                  {PERIODS.map((p) => (
                    <SegBtn key={p} active={period === p} onClick={() => setPeriod(p)}>
                      {p.toUpperCase()}
                    </SegBtn>
                  ))}
                </div>
              </div>
            </div>

            {/* Model */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-terminal-textMuted uppercase tracking-wide">Model</label>
              <div className="flex flex-wrap gap-2">
                {MODELS.map((mod) => (
                  <SegBtn
                    key={mod.id}
                    active={model === mod.id}
                    onClick={() => setModel(mod.id)}
                  >
                    {mod.label}
                  </SegBtn>
                ))}
              </div>
              <p className="text-xs text-terminal-textDim mt-1.5 max-w-xl leading-relaxed">
                {MODELS.find((m) => m.id === model)?.desc}
              </p>
            </div>

            {/* Lookback + Horizon + N sims */}
            <div className="flex flex-wrap gap-6">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-terminal-textMuted uppercase tracking-wide flex items-center">
                  Calibration window
                  <InfoBadge text="Trading days of history used to calibrate µ and σ per window." />
                </label>
                <div className="flex gap-1">
                  {LOOKBACKS.map(({ label, days }) => (
                    <SegBtn key={days} active={lookback === days} onClick={() => setLookback(days)}>
                      {label}
                    </SegBtn>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-terminal-textMuted uppercase tracking-wide flex items-center">
                  Prediction horizon
                  <InfoBadge text="How many trading days ahead the model forecasts each window." />
                </label>
                <div className="flex gap-1">
                  {HORIZONS.map(({ label, days }) => (
                    <SegBtn key={days} active={horizon === days} onClick={() => setHorizon(days)}>
                      {label}
                    </SegBtn>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-terminal-textMuted uppercase tracking-wide flex items-center">
                  Simulations / window
                  <InfoBadge text="Monte Carlo paths per window. Higher = more accurate but slower." />
                </label>
                <div className="flex gap-1">
                  {NSIMS_OPTIONS.map((n) => (
                    <SegBtn key={n} active={nSims === n} onClick={() => setNSims(n)}>
                      {n >= 1000 ? `${n / 1000}k` : n}
                    </SegBtn>
                  ))}
                </div>
              </div>
            </div>

            {/* Run */}
            <div className="flex items-center gap-4 pt-1">
              <button
                onClick={handleRun}
                disabled={loading}
                className="px-6 py-2 rounded text-sm font-semibold transition-colors
                           bg-terminal-cyan text-terminal-bg hover:opacity-90
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Running…' : 'Run Backtest'}
              </button>
              {result && !loading && (
                <span className="text-xs text-terminal-textDim">
                  {result.n_windows} windows · {result.computation_time_ms} ms
                </span>
              )}
            </div>
          </div>

          {/* ── Error ────────────────────────────────────────────────── */}
          {error && (
            <div className="bg-bear-bg border border-bear-border rounded-lg px-4 py-3 text-sm text-bear">
              {error}
            </div>
          )}

          {/* ── Results ──────────────────────────────────────────────── */}
          {result && m && (
            <>
              {/* Calibration strip */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg px-5 py-3
                              flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-terminal-textDim">Ticker </span>
                  <span className="font-mono font-semibold text-terminal-cyan">{result.ticker}</span>
                </div>
                <div>
                  <span className="text-terminal-textDim">Model </span>
                  <span className="font-mono font-semibold text-terminal-text">{result.model.toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-terminal-textDim flex items-center">
                    µ (ann.)
                    <InfoBadge text="µ (mu) — drift annualisé. Rendement moyen attendu par an, calibré sur l'ensemble de la période historique via les log-rendements journaliers × 252. Représente la tendance directionnelle du modèle : +15% signifie que le modèle suppose une hausse moyenne de 15%/an." />
                  </span>
                  <span
                    className="num font-semibold"
                    style={{ color: result.calibration.mu_pct >= 0 ? C_GREEN : C_RED }}
                  >
                    {result.calibration.mu_pct >= 0 ? '+' : ''}{result.calibration.mu_pct.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-terminal-textDim flex items-center">
                    σ (ann.)
                    <InfoBadge text="σ (sigma) — volatilité annualisée. Écart-type des log-rendements journaliers multiplié par √252. Mesure l'amplitude typique des fluctuations : 20% est courant pour une action, 60-80% pour une crypto. Plus σ est élevé, plus les trajectoires simulées sont dispersées." />
                  </span>
                  <span className="num font-semibold text-warn">
                    {result.calibration.sigma_pct.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-terminal-textDim flex items-center">
                    Last price
                    <InfoBadge text="Dernier cours de clôture ajusté disponible dans les données yfinance. Utilisé comme S₀ (prix initial) pour la dernière fenêtre de simulation." />
                  </span>
                  <span className="num font-semibold">
                    ${result.calibration.S0.toLocaleString('en-US', {
                      minimumFractionDigits: 2, maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-terminal-textDim flex items-center">
                    Obs.
                    <InfoBadge text="Nombre total de jours de trading disponibles dans l'historique. Utilisé pour la calibration globale (µ et σ du strip) et pour déterminer le nombre de fenêtres possibles." />
                  </span>
                  <span className="num font-semibold">{result.calibration.n_obs}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-terminal-textDim flex items-center">
                    Windows
                    <InfoBadge text="Nombre de fenêtres de backtesting calculées = (obs. − lookback) ÷ horizon. Chaque fenêtre calibre µ/σ sur le lookback, simule l'horizon suivant, puis compare à la réalité." />
                  </span>
                  <span className="num font-semibold">{result.n_windows}</span>
                </div>
                <div>
                  <span className="text-terminal-textDim">Period </span>
                  <span className="num font-semibold">{result.period.toUpperCase()}</span>
                </div>
              </div>

              {/* Metric cards */}
              <div>
                <SectionTitle>Performance Metrics</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MetricCard
                    label="Annualized Return"
                    value={`${m.annualized_return >= 0 ? '+' : ''}${pct(m.annualized_return)}`}
                    sub={`Total: ${m.total_return >= 0 ? '+' : ''}${pct(m.total_return)}`}
                    tone={m.annualized_return > 0 ? 'good' : m.annualized_return < -0.05 ? 'bad' : 'neutral'}
                    info="Compound annualised return over all backtest windows."
                  />
                  <MetricCard
                    label="Annualized Vol"
                    value={pct(m.annualized_vol)}
                    tone="warn"
                    info="Annualised standard deviation of window returns."
                  />
                  <MetricCard
                    label="Sharpe Ratio"
                    value={round(m.sharpe)}
                    tone={m.sharpe > 1 ? 'good' : m.sharpe < 0 ? 'bad' : 'neutral'}
                    info="Annualised return / annualised vol (rf = 0). >1 is good, >2 excellent."
                  />
                  <MetricCard
                    label="Sortino Ratio"
                    value={round(m.sortino)}
                    tone={m.sortino > 1 ? 'good' : m.sortino < 0 ? 'bad' : 'neutral'}
                    info="Like Sharpe but penalises only downside volatility."
                  />
                  <MetricCard
                    label="Max Drawdown"
                    value={pct(m.max_drawdown)}
                    tone={m.max_drawdown < -0.25 ? 'bad' : m.max_drawdown > -0.1 ? 'good' : 'warn'}
                    info="Largest peak-to-trough decline in the compounded equity curve."
                  />
                  <MetricCard
                    label="Calmar Ratio"
                    value={round(m.calmar)}
                    tone={m.calmar > 1 ? 'good' : m.calmar < 0 ? 'bad' : 'neutral'}
                    info="Annualised return / |max drawdown|."
                  />
                  <MetricCard
                    label="Hit Rate"
                    value={pct(m.hit_rate)}
                    tone={m.hit_rate > 0.55 ? 'good' : m.hit_rate < 0.4 ? 'bad' : 'neutral'}
                    info="Fraction of windows with a positive realised return."
                  />
                  <MetricCard
                    label="VaR Coverage"
                    value={pct(m.coverage_95)}
                    sub={m.is_well_calibrated ? '✓ Well calibrated' : '⚠ Miscalibrated'}
                    tone={m.is_well_calibrated ? 'good' : 'bad'}
                    info="Empirical breach rate (ideal ≈ 5% for VaR 95%). Well-calibrated if within ±2.5%."
                  />
                </div>
              </div>

              {/* ES / Breach detail */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
                  <div className="text-xs text-terminal-textDim uppercase tracking-wide mb-1 flex items-center">
                    Mean VaR 95%
                    <InfoBadge text="Average predicted 5th-percentile loss across all windows." />
                  </div>
                  <div className="num text-xl font-semibold text-warn">{pct(m.mean_pred_var_95)}</div>
                </div>
                <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
                  <div className="text-xs text-terminal-textDim uppercase tracking-wide mb-1 flex items-center">
                    Mean ES 95%
                    <InfoBadge text="Average Expected Shortfall — mean loss when VaR is breached." />
                  </div>
                  <div className="num text-xl font-semibold text-bear">{pct(m.mean_pred_es_95)}</div>
                </div>
                <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
                  <div className="text-xs text-terminal-textDim uppercase tracking-wide mb-1 flex items-center">
                    Breach count
                    <InfoBadge text="Windows where realised return fell below the predicted VaR 95% floor." />
                  </div>
                  <div
                    className="num text-xl font-semibold"
                    style={{ color: m.is_well_calibrated ? C_GREEN : C_RED }}
                  >
                    {nBreaches}/{result.n_windows}
                    <span className="text-sm font-normal text-terminal-textDim ml-1.5">
                      ({pct(breachRate, 1)})
                    </span>
                  </div>
                </div>
              </div>

              {/* Equity Curve */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
                <SectionTitle>Equity Curve — Cumulative Realized Return</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={equityData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="2 6" stroke={C_GRID} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 10 }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                      tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip content={<EquityTooltip />} />
                    <ReferenceLine y={0} stroke="var(--chart-tooltip-muted)" strokeWidth={1} strokeDasharray="4 2" />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={C_CYAN}
                      strokeWidth={2}
                      dot={false}
                      name="Cumulative Return"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Returns vs VaR */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
                <SectionTitle>Realized Returns vs Predicted VaR 95%</SectionTitle>
                <p className="text-xs text-terminal-textMuted mb-4">
                  Cyan bars = realized return. Orange line = predicted VaR 95% floor.
                  <span className="text-bear font-semibold"> Red bars</span> = breaches (realized &lt; VaR).
                </p>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={returnsData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="2 6" stroke={C_GRID} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 10 }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                      tick={{ fill: 'var(--chart-tooltip-muted)', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip content={<ReturnsTooltip />} />
                    <ReferenceLine y={0} stroke="var(--chart-tooltip-muted)" strokeWidth={1} strokeDasharray="4 2" />
                    <Bar
                      dataKey="real_return"
                      name="Realized return"
                      isAnimationActive={false}
                      radius={[1, 1, 0, 0]}
                    >
                      {returnsData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.real_return >= 0
                            ? 'rgba(0,229,255,0.60)'
                            : 'rgba(255,80,80,0.70)'}
                        />
                      ))}
                    </Bar>
                    <Line
                      type="monotone"
                      dataKey="pred_var_95"
                      stroke={C_ORANGE}
                      strokeWidth={1.5}
                      dot={false}
                      name="VaR 95%"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div className="flex flex-wrap gap-6 mt-3 text-xs text-terminal-textDim">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: 'rgba(0,229,255,0.55)' }} />
                    Realized return
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 inline-block" style={{ backgroundColor: C_ORANGE }} />
                    VaR 95% (predicted floor)
                  </span>
                  <span className="text-terminal-textDim">
                    Breach = realized &lt; VaR · ideal breach rate ≈ 5%
                  </span>
                </div>
              </div>

            </>
          )}

          {/* ── Empty state ───────────────────────────────────────────── */}
          {!result && !loading && !error && (
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-10 text-center text-terminal-textDim">
              <div className="text-5xl mb-3 opacity-20 select-none">📈</div>
              <p className="text-sm">
                Configure the parameters above and click{' '}
                <strong className="text-terminal-text">Run Backtest</strong> to start.
              </p>
              <p className="text-xs mt-1 opacity-60">
                Supports any Yahoo Finance symbol — equities, ETFs, indices, crypto.
              </p>
            </div>
          )}

        </main>
      </div>
    </>
  );
}
