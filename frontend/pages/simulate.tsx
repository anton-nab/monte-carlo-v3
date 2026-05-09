/**
 * /simulate — Monte Carlo Simulation Page (Phase 3)
 *
 * Flow :
 *   1. User entre un ticker → on charge S0, µ, σ via GET /api/simulate/info/{ticker}
 *   2. User choisit modèle, horizon, n_sims (+ overrides optionnels)
 *   3. Click "Run" → POST /api/simulate → résultats
 *
 * Charts :
 *   - Fan chart : bandes de percentiles (ComposedChart Recharts)
 *   - Distribution : histogramme des prix finaux (BarChart)
 *
 * Métriques : VaR, ES, drawdown, probabilités directionnelles
 */

import { useState, useEffect, useCallback } from 'react';
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
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TickerInfo {
  ticker: string;
  S0: number;
  mu: number;
  sigma: number;
  mu_pct: number;
  sigma_pct: number;
  n_obs: number;
  period: string;
}

interface FanPoint {
  day: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
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

interface SimResult {
  ticker: string;
  model: string;
  S0: number;
  calibration: {
    mu_pct: number;
    sigma_pct: number;
    n_obs: number;
    period: string;
    mu_overridden: boolean;
    sigma_overridden: boolean;
  };
  simulation: { n_sims: number; horizon_days: number };
  fan_chart: FanPoint[];
  histogram: HistPoint[];
  metrics: SimMetrics;
  computation_time_ms: number;
}

type ModelId = 'gbm' | 'merton' | 'heston' | 'garch';

const MODELS: { id: ModelId; label: string; desc: string }[] = [
  { id: 'gbm', label: 'GBM', desc: 'Geometric Brownian Motion — baseline classique' },
  { id: 'merton', label: 'Merton', desc: 'Jump-Diffusion — ajoute des sauts brusques' },
  { id: 'heston', label: 'Heston', desc: 'Volatilité stochastique — vol qui évolue dans le temps' },
  { id: 'garch', label: 'GARCH', desc: 'Bootstrap GARCH(1,1) — clustering de volatilité' },
];

const HORIZONS: { label: string; days: number }[] = [
  { label: '1M', days: 21 },
  { label: '3M', days: 63 },
  { label: '6M', days: 126 },
  { label: '1Y', days: 252 },
  { label: '2Y', days: 504 },
];

const NSIMS_OPTIONS = [100, 500, 1000, 2000, 5000];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const fmt = (v: number, digits = 2) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-terminal-border last:border-0">
      <span className="text-terminal-textMuted text-sm">{label}</span>
      <span className={`num text-sm font-medium ${color ?? 'text-terminal-text'}`}>{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-terminal-textDim uppercase tracking-widest mb-3">
      {children}
    </h2>
  );
}

// Fan chart : transforme { p5, p25, p50, p75, p95 } en stacked deltas
function toStackedFan(data: FanPoint[]) {
  return data.map((d) => ({
    day: d.day,
    base: d.p5,
    band_lo: d.p25 - d.p5,
    band_mid_lo: d.p50 - d.p25,
    band_mid_hi: d.p75 - d.p50,
    band_hi: d.p95 - d.p75,
    // Valeurs absolues pour le tooltip / lignes
    p5: d.p5,
    p50: d.p50,
    p95: d.p95,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function SimulatePage() {
  // ── Formulaire ───────────────────────────────────────────────────────────
  const [tickerInput, setTickerInput] = useState('AAPL');
  const [model, setModel] = useState<ModelId>('gbm');
  const [horizonDays, setHorizonDays] = useState(252);
  const [nSims, setNSims] = useState(1000);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Overrides optionnels
  const [muOverride, setMuOverride] = useState('');
  const [sigmaOverride, setSigmaOverride] = useState('');
  // Merton
  const [lambdaPoisson, setLambdaPoisson] = useState('0.5');
  const [jumpMean, setJumpMean] = useState('-0.05');
  const [jumpStd, setJumpStd] = useState('0.1');
  // Heston
  const [kappa, setKappa] = useState('2.0');
  const [sigmaV, setSigmaV] = useState('0.3');
  const [rho, setRho] = useState('-0.7');

  // ── État ─────────────────────────────────────────────────────────────────
  const [tickerInfo, setTickerInfo] = useState<TickerInfo | null>(null);
  const [tickerError, setTickerError] = useState<string | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // ── Chargement info ticker (debounce 600ms) ───────────────────────────────
  useEffect(() => {
    const t = tickerInput.trim().toUpperCase();
    if (!t) return;
    const timer = setTimeout(async () => {
      setLoadingInfo(true);
      setTickerError(null);
      try {
        const info = await apiFetch<TickerInfo>(`/api/simulate/info/${t}`);
        setTickerInfo(info);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Ticker introuvable';
        setTickerError(msg);
        setTickerInfo(null);
      } finally {
        setLoadingInfo(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [tickerInput]);

  // ── Lancer la simulation ─────────────────────────────────────────────────
  const runSimulation = useCallback(async () => {
    const ticker = tickerInput.trim().toUpperCase();
    if (!ticker) return;
    setRunning(true);
    setRunError(null);
    setResult(null);

    const body: Record<string, unknown> = {
      ticker,
      model,
      n_sims: nSims,
      horizon_days: horizonDays,
    };

    if (muOverride) body.mu_override = parseFloat(muOverride) / 100;
    if (sigmaOverride) body.sigma_override = parseFloat(sigmaOverride) / 100;
    if (model === 'merton') {
      body.lambda_poisson = parseFloat(lambdaPoisson) || 0.5;
      body.jump_mean = parseFloat(jumpMean) || -0.05;
      body.jump_std = parseFloat(jumpStd) || 0.1;
    }
    if (model === 'heston') {
      body.kappa = parseFloat(kappa) || 2.0;
      body.sigma_v = parseFloat(sigmaV) || 0.3;
      body.rho = parseFloat(rho) || -0.7;
    }

    try {
      const data = await apiFetch<SimResult>('/api/simulate', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setResult(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur de simulation';
      setRunError(msg);
    } finally {
      setRunning(false);
    }
  }, [tickerInput, model, nSims, horizonDays, muOverride, sigmaOverride, lambdaPoisson, jumpMean, jumpStd, kappa, sigmaV, rho]);

  // ── Dérivés ──────────────────────────────────────────────────────────────
  const stackedFan = result ? toStackedFan(result.fan_chart) : [];
  const m = result?.metrics;

  const varColor = (v: number) => v < -0.2 ? 'text-bear' : v < -0.1 ? 'text-warn' : 'text-bull';

  return (
    <>
      <Head>
        <title>Simulate — Monte Carlo v3</title>
      </Head>
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Titre ─────────────────────────────────────────────────── */}
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-terminal-cyan">⚡ Monte Carlo Simulator</h1>
          <span className="text-xs text-terminal-textDim bg-terminal-surface border border-terminal-border px-2 py-0.5 rounded">Phase 3</span>
        </div>

        {/* ── Panneau de paramètres ─────────────────────────────────── */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5 space-y-5">
          <SectionTitle>Paramètres</SectionTitle>

          {/* Row 1 : Ticker + Calibration info */}
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-terminal-textDim mb-1">Ticker</label>
              <input
                type="text"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                placeholder="AAPL, BTC-USD, ^GSPC…"
                className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-3 py-2 rounded font-mono text-sm focus:outline-none focus:border-terminal-cyan"
              />
            </div>

            {/* Info calibration */}
            <div className="flex-1 min-w-[220px]">
              {loadingInfo && (
                <div className="flex items-center gap-2 text-terminal-textDim text-sm">
                  <span className="animate-spin">⟳</span> Chargement…
                </div>
              )}
              {tickerError && (
                <div className="text-bear text-sm">❌ {tickerError}</div>
              )}
              {tickerInfo && !loadingInfo && (
                <div className="flex gap-4 flex-wrap">
                  <div>
                    <div className="text-xs text-terminal-textDim">Dernier prix</div>
                    <div className="num text-terminal-cyan font-semibold">${fmt(tickerInfo.S0)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-terminal-textDim">µ annuel</div>
                    <div className={`num font-medium ${tickerInfo.mu_pct >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {tickerInfo.mu_pct >= 0 ? '+' : ''}{tickerInfo.mu_pct.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-terminal-textDim">σ annuelle</div>
                    <div className="num text-warn font-medium">{tickerInfo.sigma_pct.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-terminal-textDim">Obs.</div>
                    <div className="num text-terminal-textMuted">{tickerInfo.n_obs}j</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Row 2 : Modèle */}
          <div>
            <label className="block text-xs text-terminal-textDim mb-2">Modèle</label>
            <div className="flex flex-wrap gap-2">
              {MODELS.map((mod) => (
                <button
                  key={mod.id}
                  onClick={() => setModel(mod.id)}
                  title={mod.desc}
                  className={`px-4 py-2 rounded border text-sm font-medium transition ${
                    model === mod.id
                      ? 'bg-terminal-cyan text-terminal-bg border-terminal-cyan'
                      : 'bg-terminal-bg border-terminal-border text-terminal-textMuted hover:border-terminal-cyan hover:text-terminal-cyan'
                  }`}
                >
                  {mod.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-terminal-textDim mt-1.5">
              {MODELS.find((m) => m.id === model)?.desc}
            </p>
          </div>

          {/* Row 3 : Horizon + N sims */}
          <div className="flex flex-wrap gap-6">
            <div>
              <label className="block text-xs text-terminal-textDim mb-2">Horizon</label>
              <div className="flex gap-1">
                {HORIZONS.map((h) => (
                  <button
                    key={h.days}
                    onClick={() => setHorizonDays(h.days)}
                    className={`px-3 py-1.5 rounded border text-sm num transition ${
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

            <div>
              <label className="block text-xs text-terminal-textDim mb-2">Simulations</label>
              <div className="flex gap-1">
                {NSIMS_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setNSims(n)}
                    className={`px-3 py-1.5 rounded border text-sm num transition ${
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

          {/* Row 4 : Paramètres avancés (accordéon) */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-terminal-textDim hover:text-terminal-text flex items-center gap-1"
            >
              <span>{showAdvanced ? '▾' : '▸'}</span>
              Paramètres avancés
            </button>

            {showAdvanced && (
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-terminal-textDim mb-1">µ override (%/an)</label>
                  <input
                    type="number"
                    value={muOverride}
                    onChange={(e) => setMuOverride(e.target.value)}
                    placeholder={tickerInfo ? `${tickerInfo.mu_pct.toFixed(1)}` : '—'}
                    className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num"
                  />
                </div>
                <div>
                  <label className="block text-xs text-terminal-textDim mb-1">σ override (%/an)</label>
                  <input
                    type="number"
                    value={sigmaOverride}
                    onChange={(e) => setSigmaOverride(e.target.value)}
                    placeholder={tickerInfo ? `${tickerInfo.sigma_pct.toFixed(1)}` : '—'}
                    className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num"
                  />
                </div>

                {/* Merton params */}
                {model === 'merton' && (
                  <>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">λ (sauts/an)</label>
                      <input type="number" value={lambdaPoisson} onChange={(e) => setLambdaPoisson(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num" />
                    </div>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">Jump mean</label>
                      <input type="number" value={jumpMean} onChange={(e) => setJumpMean(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num" />
                    </div>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">Jump std</label>
                      <input type="number" value={jumpStd} onChange={(e) => setJumpStd(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num" />
                    </div>
                  </>
                )}

                {/* Heston params */}
                {model === 'heston' && (
                  <>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">κ (mean-rev)</label>
                      <input type="number" value={kappa} onChange={(e) => setKappa(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num" />
                    </div>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">σᵥ (vol of vol)</label>
                      <input type="number" value={sigmaV} onChange={(e) => setSigmaV(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num" />
                    </div>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">ρ (corr S-v)</label>
                      <input type="number" min="-1" max="1" step="0.1" value={rho} onChange={(e) => setRho(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num" />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* CTA */}
          <div className="flex items-center gap-4">
            <button
              onClick={runSimulation}
              disabled={running || !tickerInput.trim() || !!tickerError}
              className={`px-6 py-2.5 rounded font-semibold text-sm transition ${
                running || !tickerInput.trim() || !!tickerError
                  ? 'bg-terminal-border text-terminal-textDim cursor-not-allowed'
                  : 'bg-terminal-cyan text-terminal-bg hover:opacity-90 active:scale-95'
              }`}
            >
              {running ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin inline-block">⟳</span> Simulation en cours…
                </span>
              ) : (
                '▶ Lancer la simulation'
              )}
            </button>

            {result && !running && (
              <span className="text-xs text-terminal-textDim num">
                {result.computation_time_ms}ms · {result.simulation.n_sims.toLocaleString()} trajectoires
              </span>
            )}
          </div>

          {runError && (
            <div className="text-bear text-sm bg-bear bg-opacity-10 border border-bear border-opacity-30 rounded px-3 py-2">
              ❌ {runError}
            </div>
          )}
        </div>

        {/* ── Résultats ─────────────────────────────────────────────── */}
        {result && m && (
          <>
            {/* Calibration badge */}
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 num">
                {result.ticker} · {result.model.toUpperCase()}
              </span>
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 num">
                µ={result.calibration.mu_pct.toFixed(1)}%{result.calibration.mu_overridden ? ' (override)' : ''}
              </span>
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 num">
                σ={result.calibration.sigma_pct.toFixed(1)}%{result.calibration.sigma_overridden ? ' (override)' : ''}
              </span>
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 text-terminal-textDim">
                {HORIZONS.find((h) => h.days === result.simulation.horizon_days)?.label ?? `${result.simulation.horizon_days}j`} · {result.calibration.n_obs}j historique
              </span>
            </div>

            {/* Fan Chart */}
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
              <SectionTitle>
                Fan Chart — {result.ticker} · {result.simulation.n_sims.toLocaleString()} simulations
              </SectionTitle>
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={stackedFan} margin={{ top: 4, right: 12, bottom: 0, left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    tickFormatter={(v) => `J${v}`}
                    interval={Math.floor(stackedFan.length / 6)}
                  />
                  <YAxis
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    tickFormatter={(v) => `$${v.toFixed(0)}`}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0f1117', border: '1px solid #2a2d3a', borderRadius: 6, fontSize: 12 }}
                    formatter={(value, name) => {
                      if (name === 'p50') return [`$${Number(value).toFixed(2)}`, 'Médiane'];
                      if (name === 'p95') return [`$${Number(value).toFixed(2)}`, 'P95'];
                      if (name === 'p5') return [`$${Number(value).toFixed(2)}`, 'P5'];
                      return [null, null];
                    }}
                    labelFormatter={(label) => `Jour ${label}`}
                  />

                  {/* Bandes stacked : base (p5) transparent, puis deltas colorés */}
                  <Area stackId="fan" type="monotone" dataKey="base"
                    stroke="none" fill="transparent" legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_lo"
                    stroke="none" fill="rgba(0,229,255,0.06)" legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_mid_lo"
                    stroke="none" fill="rgba(0,229,255,0.14)" legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_mid_hi"
                    stroke="none" fill="rgba(0,229,255,0.14)" legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_hi"
                    stroke="none" fill="rgba(0,229,255,0.06)" legendType="none" />

                  {/* Lignes de percentile */}
                  <Line type="monotone" dataKey="p50" stroke="#00e5ff" strokeWidth={2} dot={false} name="p50" />
                  <Line type="monotone" dataKey="p95" stroke="rgba(255,100,100,0.55)" strokeWidth={1} strokeDasharray="4 3" dot={false} name="p95" />
                  <Line type="monotone" dataKey="p5" stroke="rgba(255,100,100,0.55)" strokeWidth={1} strokeDasharray="4 3" dot={false} name="p5" />

                  {/* Ligne S0 */}
                  <ReferenceLine y={result.S0} stroke="rgba(255,255,255,0.15)" strokeDasharray="6 3"
                    label={{ value: `$${result.S0.toFixed(0)}`, fill: '#6b7280', fontSize: 10 }} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2 text-xs text-terminal-textDim">
                <span><span className="inline-block w-4 h-0.5 bg-terminal-cyan align-middle mr-1" />Médiane (P50)</span>
                <span><span className="inline-block w-4 h-0.5 border-t border-dashed border-bear opacity-60 align-middle mr-1" />P5 / P95</span>
                <span><span className="inline-block w-3 h-3 rounded-sm bg-terminal-cyan opacity-20 align-middle mr-1" />P25–P75</span>
              </div>
            </div>

            {/* Distribution + Métriques */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Histogramme */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
                <SectionTitle>Distribution des prix finaux</SectionTitle>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={result.histogram} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="price" tick={{ fill: '#6b7280', fontSize: 10 }}
                      tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                      interval={Math.floor(result.histogram.length / 6)} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} width={36} />
                    <Tooltip
                      contentStyle={{ background: '#0f1117', border: '1px solid #2a2d3a', borderRadius: 6, fontSize: 12 }}
                      formatter={(v) => [v, 'trajectoires']}
                      labelFormatter={(l) => `Prix : $${Number(l).toFixed(2)}`}
                    />
                    <Bar dataKey="count" fill="rgba(0,229,255,0.5)" radius={[2, 2, 0, 0]} />
                    <ReferenceLine x={result.S0} stroke="rgba(255,255,255,0.3)" strokeDasharray="4 2"
                      label={{ value: 'S₀', fill: '#9ca3af', fontSize: 10 }} />
                    <ReferenceLine x={m.p50} stroke="#00e5ff" strokeWidth={1.5}
                      label={{ value: 'P50', fill: '#00e5ff', fontSize: 10 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Métriques de risque */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5 space-y-4">
                <SectionTitle>Métriques de risque</SectionTitle>

                <div className="grid grid-cols-2 gap-x-6">
                  {/* Colonne gauche — Prix */}
                  <div>
                    <p className="text-xs text-terminal-textDim font-semibold uppercase tracking-wide mb-1">Prix final</p>
                    <MetricRow label="Médiane" value={`$${fmt(m.median_price)}`} />
                    <MetricRow label="Attendu" value={`$${fmt(m.expected_price)}`} />
                    <MetricRow label="P5" value={`$${fmt(m.p5)}`} color="text-bear" />
                    <MetricRow label="P95" value={`$${fmt(m.p95)}`} color="text-bull" />
                    <MetricRow label="Rendement attendu" value={pct(m.expected_return)}
                      color={m.expected_return >= 0 ? 'text-bull' : 'text-bear'} />
                  </div>

                  {/* Colonne droite — Risque */}
                  <div>
                    <p className="text-xs text-terminal-textDim font-semibold uppercase tracking-wide mb-1">Risque</p>
                    <MetricRow label="VaR 95%" value={pct(m.var_95)} color={varColor(m.var_95)} />
                    <MetricRow label="VaR 99%" value={pct(m.var_99)} color={varColor(m.var_99)} />
                    <MetricRow label="ES 95%" value={pct(m.es_95)} color="text-bear" />
                    <MetricRow label="ES 99%" value={pct(m.es_99)} color="text-bear" />
                    <MetricRow label="Max drawdown moyen" value={pct(m.avg_max_drawdown)} color="text-warn" />
                  </div>
                </div>

                {/* Probabilités directionnelles */}
                <div>
                  <p className="text-xs text-terminal-textDim font-semibold uppercase tracking-wide mb-2">Probabilités</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'P(perte)', value: m.prob_loss, bear: true },
                      { label: 'P(gain > 10%)', value: m.prob_gain_10pct, bear: false },
                      { label: 'P(perte > 10%)', value: m.prob_loss_10pct, bear: true },
                      { label: 'P(gain > 20%)', value: m.prob_gain_20pct, bear: false },
                    ].map(({ label, value, bear }) => (
                      <div key={label}
                        className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 flex justify-between items-center">
                        <span className="text-xs text-terminal-textDim">{label}</span>
                        <span className={`num text-sm font-semibold ${bear ? 'text-bear' : 'text-bull'}`}>
                          {pct(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Placeholder (pas encore lancé) ──────────────────────── */}
        {!result && !running && (
          <div className="border border-dashed border-terminal-border rounded-lg p-12 text-center text-terminal-textDim">
            <div className="text-4xl mb-3">📊</div>
            <p className="text-sm">Configurez les paramètres ci-dessus et cliquez sur <strong className="text-terminal-text">▶ Lancer la simulation</strong></p>
            <p className="text-xs mt-1">GBM · Merton · Heston · GARCH — calibration automatique depuis yfinance</p>
          </div>
        )}

        {/* ── Skeleton chargement ──────────────────────────────────── */}
        {running && (
          <div className="space-y-4">
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5 h-64 animate-pulse" />
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5 h-48 animate-pulse" />
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5 h-48 animate-pulse" />
            </div>
          </div>
        )}
      </main>
    </>
  );
}
