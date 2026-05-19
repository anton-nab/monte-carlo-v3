/**
 * /simulate — Monte Carlo Simulation Page (Phase 3)
 *
 * Améliorations v2 :
 *  - Tooltip fan chart custom (P5/P25/P50/P75/P95 corrects, P95=haut P5=bas)
 *  - 10 000 simulations disponibles
 *  - Horizons jusqu'à 5 ans
 *  - µ et σ avec explication (ⓘ) au survol
 *  - Prix le plus probable (Mode) sur l'histogramme
 *  - Tooltips ⓘ sur toutes les métriques de risque
 */

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
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

interface StackedFanPoint {
  day: number;
  base: number;
  band_lo: number;
  band_mid_lo: number;
  band_mid_hi: number;
  band_hi: number;
  // Absolus pour tooltip et lignes
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
  {
    id: 'gbm', label: 'GBM',
    desc: 'Geometric Brownian Motion — le modèle de Black-Scholes. Drift µ et volatilité σ sont constants dans le temps. Distribution log-normale : jamais de prix négatif, trajectoires lisses et continues. Idéal comme référence de base pour comparer les autres modèles.',
  },
  {
    id: 'merton', label: 'Merton',
    desc: 'Jump-Diffusion de Merton — GBM + sauts brusques aléatoires (processus de Poisson). Modélise les chocs soudains : publications trimestrielles, crises, upgrades/downgrades. Queues de distribution plus épaisses qu\'un GBM pur. Paramètres avancés : λ (fréquence des sauts/an), jump mean (taille moyenne), jump σ (dispersion).',
  },
  {
    id: 'heston', label: 'Heston',
    desc: 'Volatilité stochastique de Heston — σ n\'est plus constante mais évolue aléatoirement autour d\'une moyenne long-terme θ, avec une vitesse de retour κ. Capture le clustering de volatilité et le smile d\'options. Plus réaliste sur horizons > 6 mois. Paramètres : κ (vitesse de mean-reversion), σᵥ (volatilité de la vol), ρ (corrélation prix-vol, généralement négatif).',
  },
  {
    id: 'garch', label: 'GARCH',
    desc: 'Bootstrap GARCH(1,1) — calibré sur les résidus historiques réels. Simule le clustering de volatilité : les périodes agitées se regroupent, les chocs appellent les chocs. Dépend moins de µ/σ théoriques et plus de la structure temporelle des rendements passés. Nécessite un historique suffisant (≥ 6 mois).',
  },
];

const HORIZONS: { label: string; days: number }[] = [
  { label: '1M',  days: 21   },
  { label: '3M',  days: 63   },
  { label: '6M',  days: 126  },
  { label: '1Y',  days: 252  },
  { label: '2Y',  days: 504  },
  { label: '3Y',  days: 756  },
  { label: '5Y',  days: 1260 },
];

const NSIMS_OPTIONS = [100, 500, 1000, 2000, 5000, 10000];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers UI
// ─────────────────────────────────────────────────────────────────────────────

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const fmt = (v: number, digits = 2) =>
  v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Badge "?" avec tooltip — hover desktop, tap mobile */
function InfoBadge({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex group ml-1" style={{ verticalAlign: 'middle' }}>
      <span
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full
                   border border-terminal-textDim text-terminal-textDim text-[9px]
                   cursor-help select-none
                   group-hover:border-terminal-cyan group-hover:text-terminal-cyan
                   transition-colors">
        ?
      </span>
      <span className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                       w-64 bg-terminal-bg border border-terminal-border rounded-lg
                       px-3 py-2 text-xs text-terminal-textMuted leading-relaxed
                       shadow-xl z-50 transition-opacity duration-150
                       whitespace-normal text-left font-normal
                       ${open
                         ? 'opacity-100 pointer-events-auto'
                         : 'opacity-0 pointer-events-none group-hover:opacity-100'}`}>
        {text}
      </span>
    </span>
  );
}

interface MetricRowProps {
  label: string;
  value: string;
  color?: string;
  info?: string;
}

function MetricRow({ label, value, color, info }: MetricRowProps) {
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-terminal-textDim uppercase tracking-widest mb-3">
      {children}
    </h2>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fan chart — transform + custom tooltip
// ─────────────────────────────────────────────────────────────────────────────

/** Convertit les percentiles absolus en deltas empilables pour Recharts */
function toStackedFan(data: FanPoint[]): StackedFanPoint[] {
  return data.map((d) => ({
    day: d.day,
    base: d.p5,
    band_lo:     d.p25 - d.p5,
    band_mid_lo: d.p50 - d.p25,
    band_mid_hi: d.p75 - d.p50,
    band_hi:     d.p95 - d.p75,
    // Valeurs absolues — utilisées par le tooltip et les lignes
    p5:  d.p5,
    p25: d.p25,
    p50: d.p50,
    p75: d.p75,
    p95: d.p95,
  }));
}

interface TooltipPayload {
  payload: StackedFanPoint;
}

/** Tooltip personnalisé : affiche P95 (optimiste) en haut, P5 (pessimiste) en bas */
function FanTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: number;
}) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload; // données brutes du point

  const rows: { label: string; value: number; color: string; bold?: boolean }[] = [
    { label: 'P95 — optimiste',  value: d.p95, color: 'rgba(255,100,100,0.85)' },
    { label: 'P75',              value: d.p75, color: 'rgba(180,210,255,0.7)'  },
    { label: 'P50 — médiane',    value: d.p50, color: '#00e5ff', bold: true    },
    { label: 'P25',              value: d.p25, color: 'rgba(180,210,255,0.7)'  },
    { label: 'P5 — pessimiste',  value: d.p5,  color: 'rgba(255,100,100,0.85)' },
  ];

  return (
    <div style={{
      background: 'var(--chart-tooltip-bg)',
      border: '1px solid var(--chart-tooltip-border)',
      borderRadius: 6,
      padding: '8px 12px',
      fontSize: 12,
      minWidth: 180,
    }}>
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
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function SimulatePage() {
  const router = useRouter();

  // ── Formulaire ───────────────────────────────────────────────────────────
  const [tickerInput, setTickerInput]   = useState('AAPL');
  const [model, setModel]               = useState<ModelId>('gbm');
  const [horizonDays, setHorizonDays]   = useState(252);
  const [nSims, setNSims]               = useState(1000);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Overrides optionnels
  const [muOverride, setMuOverride]       = useState('');
  const [sigmaOverride, setSigmaOverride] = useState('');
  // Merton
  const [lambdaPoisson, setLambdaPoisson] = useState('0.5');
  const [jumpMean, setJumpMean]           = useState('-0.05');
  const [jumpStd, setJumpStd]             = useState('0.1');
  // Heston
  const [kappa, setKappa]   = useState('2.0');
  const [sigmaV, setSigmaV] = useState('0.3');
  const [rho, setRho]       = useState('-0.7');

  // ── État ─────────────────────────────────────────────────────────────────
  const [tickerInfo, setTickerInfo]   = useState<TickerInfo | null>(null);
  const [tickerError, setTickerError] = useState<string | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [result, setResult]           = useState<SimResult | null>(null);
  const [running, setRunning]         = useState(false);
  const [runError, setRunError]       = useState<string | null>(null);

  // ── Lire ?ticker= depuis l'URL (venant du screener ou d'une fiche) ─────────
  useEffect(() => {
    const t = router.query.ticker;
    if (typeof t === 'string' && t.trim()) {
      setTickerInput(t.trim().toUpperCase());
    }
  }, [router.query.ticker]);

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
        setTickerError(e instanceof Error ? e.message : 'Ticker introuvable');
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

    const body: Record<string, unknown> = { ticker, model, n_sims: nSims, horizon_days: horizonDays };
    if (muOverride)    body.mu_override    = parseFloat(muOverride) / 100;
    if (sigmaOverride) body.sigma_override = parseFloat(sigmaOverride) / 100;
    if (model === 'merton') {
      body.lambda_poisson = parseFloat(lambdaPoisson) || 0.5;
      body.jump_mean      = parseFloat(jumpMean) || -0.05;
      body.jump_std       = parseFloat(jumpStd)  || 0.1;
    }
    if (model === 'heston') {
      body.kappa   = parseFloat(kappa)   || 2.0;
      body.sigma_v = parseFloat(sigmaV)  || 0.3;
      body.rho     = parseFloat(rho)     || -0.7;
    }

    try {
      const data = await apiFetch<SimResult>('/api/simulate', { method: 'POST', body: JSON.stringify(body) });
      setResult(data);
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : 'Erreur de simulation');
    } finally {
      setRunning(false);
    }
  }, [tickerInput, model, nSims, horizonDays, muOverride, sigmaOverride, lambdaPoisson, jumpMean, jumpStd, kappa, sigmaV, rho]);

  // ── Dérivés ──────────────────────────────────────────────────────────────
  const stackedFan = result ? toStackedFan(result.fan_chart) : [];
  const m = result?.metrics;

  // Prix le plus probable = bin avec le plus de trajectoires
  const modeBin = result?.histogram.reduce<HistPoint | null>((best, bin) =>
    best === null || bin.count > best.count ? bin : best, null);

  const varColor = (v: number) => v < -0.2 ? 'text-bear' : v < -0.1 ? 'text-warn' : 'text-bull';

  // Libellé horizon pour les badges
  const horizonLabel = HORIZONS.find((h) => h.days === result?.simulation.horizon_days)?.label
    ?? (result ? `${result.simulation.horizon_days}j` : '');

  return (
    <>
      <Head><title>Simulate — Monte Carlo</title></Head>
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Titre ─────────────────────────────────────────────────── */}
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-terminal-cyan">Monte Carlo Simulator</h1>
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
            <div className="flex-1 min-w-[240px]">
              {loadingInfo && (
                <div className="flex items-center gap-2 text-terminal-textDim text-sm">
                  <span className="animate-spin">⟳</span> Chargement…
                </div>
              )}
              {tickerError && (
                <div className="text-bear text-sm">❌ {tickerError}</div>
              )}
              {tickerInfo && !loadingInfo && (
                <div className="flex gap-5 flex-wrap">
                  <div>
                    <div className="text-xs text-terminal-textDim">Dernier prix</div>
                    <div className="num text-terminal-cyan font-semibold">${fmt(tickerInfo.S0)}</div>
                  </div>
                  <div>
                    <div
                      className="text-xs text-terminal-textDim flex items-center cursor-help"
                      title="µ (mu) = rendement moyen annualisé calculé sur les 2 dernières années. C'est la tendance du modèle : +12% signifie que le modèle part du principe que l'action monte en moyenne de 12%/an. Vous pouvez l'overrider dans les paramètres avancés."
                    >
                      µ annuel <InfoBadge text="µ (mu) = rendement moyen annualisé sur 2 ans. Représente la tendance haussière ou baissière attendue du modèle. Calibré automatiquement, overridable." />
                    </div>
                    <div className={`num font-medium ${tickerInfo.mu_pct >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {tickerInfo.mu_pct >= 0 ? '+' : ''}{tickerInfo.mu_pct.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-xs text-terminal-textDim flex items-center cursor-help"
                    >
                      σ annuelle <InfoBadge text="σ (sigma) = volatilité annualisée. Mesure l'écart-type des rendements journaliers × √252. Plus σ est grand, plus les trajectoires sont dispersées. Un σ de 20-30% est typique pour une action, 60-80% pour une crypto." />
                    </div>
                    <div className="num text-warn font-medium">{tickerInfo.sigma_pct.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-terminal-textDim">Historique</div>
                    <div className="num text-terminal-textMuted">{tickerInfo.n_obs} jours</div>
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
              {MODELS.find((mod) => mod.id === model)?.desc}
            </p>
          </div>

          {/* Row 3 : Horizon + N sims */}
          <div className="flex flex-wrap gap-6">
            <div>
              <label className="block text-xs text-terminal-textDim mb-2">Horizon</label>
              <div className="flex flex-wrap gap-1">
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
              <label className="block text-xs text-terminal-textDim mb-2">
                Simulations
                <InfoBadge text="Nombre de trajectoires générées. Plus il y en a, plus les métriques (VaR, ES…) sont précises. 1 000 est un bon équilibre. 10 000 donne des résultats très stables mais peut prendre plusieurs secondes." />
              </label>
              <div className="flex flex-wrap gap-1">
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
              {nSims >= 5000 && (
                <p className="text-xs text-warn mt-1">⚠ {nSims >= 10000 ? '10k sims peut prendre 5-15s selon le modèle' : '5k sims peut prendre 2-5s'}</p>
              )}
            </div>
          </div>

          {/* Row 4 : Paramètres avancés */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-terminal-textDim hover:text-terminal-text flex items-center gap-1"
            >
              <span>{showAdvanced ? '▾' : '▸'}</span>
              Paramètres avancés (µ/σ override{model !== 'gbm' ? `, paramètres ${model}` : ''})
            </button>

            {showAdvanced && (
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-terminal-textDim mb-1">
                    µ override (%/an)
                    <InfoBadge text="Remplace le µ calibré automatiquement. Entrez le rendement annuel attendu en %. Ex: 15 pour +15%/an." />
                  </label>
                  <input
                    type="number"
                    value={muOverride}
                    onChange={(e) => setMuOverride(e.target.value)}
                    placeholder={tickerInfo ? `${tickerInfo.mu_pct.toFixed(1)}` : '—'}
                    className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num focus:outline-none focus:border-terminal-cyan"
                  />
                </div>
                <div>
                  <label className="block text-xs text-terminal-textDim mb-1">
                    σ override (%/an)
                    <InfoBadge text="Remplace la volatilité calibrée automatiquement. Entrez la vol annuelle en %. Ex: 30 pour σ=30%. Un σ élevé élargit le fan chart." />
                  </label>
                  <input
                    type="number"
                    value={sigmaOverride}
                    onChange={(e) => setSigmaOverride(e.target.value)}
                    placeholder={tickerInfo ? `${tickerInfo.sigma_pct.toFixed(1)}` : '—'}
                    className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num focus:outline-none focus:border-terminal-cyan"
                  />
                </div>

                {model === 'merton' && (
                  <>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">
                        λ (sauts/an)
                        <InfoBadge text="λ (lambda) = intensité du processus de Poisson. Nombre de sauts attendus par an. 0.5 = 1 saut tous les 2 ans. 2.0 = 2 sauts par an." />
                      </label>
                      <input type="number" value={lambdaPoisson} onChange={(e) => setLambdaPoisson(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num focus:outline-none focus:border-terminal-cyan" />
                    </div>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">
                        Jump mean
                        <InfoBadge text="Taille moyenne d'un saut en log-rendement. -0.05 = saut de -5% en moyenne. Utilisez des valeurs négatives pour modéliser les crashes." />
                      </label>
                      <input type="number" value={jumpMean} onChange={(e) => setJumpMean(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num focus:outline-none focus:border-terminal-cyan" />
                    </div>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">
                        Jump std
                        <InfoBadge text="Écart-type de la taille des sauts. 0.1 = les sauts varient d'environ ±10% autour de la moyenne." />
                      </label>
                      <input type="number" value={jumpStd} onChange={(e) => setJumpStd(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num focus:outline-none focus:border-terminal-cyan" />
                    </div>
                  </>
                )}

                {model === 'heston' && (
                  <>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">
                        κ (mean-rev)
                        <InfoBadge text="κ (kappa) = vitesse de réversion à la moyenne de la variance. Plus κ est grand, plus la vol revient vite vers sa moyenne long-terme θ. Typiquement 0.5–5." />
                      </label>
                      <input type="number" value={kappa} onChange={(e) => setKappa(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num focus:outline-none focus:border-terminal-cyan" />
                    </div>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">
                        σᵥ (vol of vol)
                        <InfoBadge text="σᵥ = volatilité de la volatilité. Contrôle à quelle vitesse σ fluctue. Plus σᵥ est grand, plus la vol est erratique. Typiquement 0.1–0.5." />
                      </label>
                      <input type="number" value={sigmaV} onChange={(e) => setSigmaV(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num focus:outline-none focus:border-terminal-cyan" />
                    </div>
                    <div>
                      <label className="block text-xs text-terminal-textDim mb-1">
                        ρ (corr S-v)
                        <InfoBadge text="ρ (rho) = corrélation entre le mouvement du prix et celui de la variance. Généralement négatif (effet levier) : quand le prix baisse, la vol monte. Typiquement -0.7 à -0.3." />
                      </label>
                      <input type="number" min="-1" max="1" step="0.1" value={rho} onChange={(e) => setRho(e.target.value)}
                        className="w-full bg-terminal-bg border border-terminal-border text-terminal-text px-2 py-1.5 rounded text-sm num focus:outline-none focus:border-terminal-cyan" />
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
              {running
                ? <span className="flex items-center gap-2"><span className="animate-spin inline-block">⟳</span> Simulation en cours…</span>
                : '▶ Lancer la simulation'}
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
            {/* Badges résumé */}
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 num">
                {result.ticker} · {result.model.toUpperCase()}
              </span>
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 num">
                µ={result.calibration.mu_pct.toFixed(1)}%{result.calibration.mu_overridden ? ' ✎' : ''}
              </span>
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 num">
                σ={result.calibration.sigma_pct.toFixed(1)}%{result.calibration.sigma_overridden ? ' ✎' : ''}
              </span>
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 text-terminal-textDim">
                {horizonLabel} · {result.simulation.n_sims.toLocaleString()} sims · {result.calibration.n_obs}j historique
              </span>
              <span className="bg-terminal-surface border border-terminal-border rounded px-2 py-1 num text-terminal-textDim">
                {result.computation_time_ms}ms
              </span>
            </div>

            {/* Fan Chart */}
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
              <SectionTitle>
                Fan Chart — {result.ticker} · {result.simulation.n_sims.toLocaleString()} simulations · {horizonLabel}
              </SectionTitle>
              <ResponsiveContainer width="100%" height={340}>
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
                    width={60}
                  />
                  {/* Custom tooltip — lit les valeurs absolues brutes */}
                  <Tooltip content={<FanTooltip />} />

                  {/* Bandes empilées P5→P25→P50→P75→P95 */}
                  <Area stackId="fan" type="monotone" dataKey="base"       stroke="none" fill="transparent"           legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_lo"    stroke="none" fill="rgba(0,229,255,0.07)"  legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_mid_lo" stroke="none" fill="rgba(0,229,255,0.15)" legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_mid_hi" stroke="none" fill="rgba(0,229,255,0.15)" legendType="none" />
                  <Area stackId="fan" type="monotone" dataKey="band_hi"    stroke="none" fill="rgba(0,229,255,0.07)"  legendType="none" />

                  {/* Lignes P50 (médiane), P95 (optimiste en haut), P5 (pessimiste en bas) */}
                  <Line type="monotone" dataKey="p50" stroke="#00e5ff"              strokeWidth={2}   dot={false} />
                  <Line type="monotone" dataKey="p95" stroke="rgba(255,100,100,0.6)" strokeWidth={1}  strokeDasharray="4 3" dot={false} />
                  <Line type="monotone" dataKey="p5"  stroke="rgba(255,100,100,0.6)" strokeWidth={1}  strokeDasharray="4 3" dot={false} />

                  {/* Ligne S0 de référence */}
                  <ReferenceLine
                    y={result.S0}
                    stroke="var(--chart-grid)"
                    strokeDasharray="6 3"
                    label={{ value: `$${result.S0.toFixed(0)}`, fill: 'var(--chart-tooltip-muted)', fontSize: 10 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex gap-5 mt-2 text-xs text-terminal-textDim flex-wrap">
                <span><span className="inline-block w-5 h-0.5 bg-terminal-cyan align-middle mr-1.5" />P50 médiane</span>
                <span><span className="inline-block w-5 h-0.5 border-t border-dashed border-red-400 opacity-60 align-middle mr-1.5" />P5 pessimiste / P95 optimiste</span>
                <span><span className="inline-block w-3 h-3 rounded-sm bg-terminal-cyan opacity-20 align-middle mr-1.5" />P25–P75 (IQR 50%)</span>
                <span><span className="inline-block w-5 h-0.5 bg-terminal-cyan opacity-10 align-middle mr-1.5" />P5–P95 (90% des trajectoires)</span>
              </div>
            </div>

            {/* Distribution + Métriques */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Histogramme */}
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
                <SectionTitle>Distribution des prix finaux</SectionTitle>
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
                      labelFormatter={(l) => `Prix : $${Number(l).toFixed(2)}`}
                    />
                    <Bar dataKey="count" fill="rgba(0,229,255,0.5)" radius={[2, 2, 0, 0]} />

                    {/* S0 de départ */}
                    <ReferenceLine x={result.S0} stroke="var(--chart-tooltip-muted)" strokeDasharray="4 2"
                      label={{ value: 'S₀', fill: 'var(--chart-tooltip-muted)', fontSize: 10, position: 'top' }} />

                    {/* Médiane */}
                    <ReferenceLine x={m.p50} stroke="#00e5ff" strokeWidth={1.5}
                      label={{ value: 'P50', fill: '#00e5ff', fontSize: 10, position: 'top' }} />

                    {/* Prix le plus probable (mode) */}
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
                      Prix le plus probable :{' '}
                      <span className="num text-terminal-text">${modeBin.price.toFixed(2)}</span>
                      {' '}({modeBin.count} trajectoires)
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
                <SectionTitle>Métriques de risque</SectionTitle>

                <div className="grid grid-cols-2 gap-x-6">
                  {/* Colonne gauche — Prix final */}
                  <div>
                    <p className="text-xs text-terminal-textDim font-semibold uppercase tracking-wide mb-1">Prix final</p>
                    <MetricRow
                      label="Médiane" value={`$${fmt(m.median_price)}`}
                      info="P50 des prix finaux : 50% des simulations terminent au-dessus, 50% en-dessous. Meilleure estimation centrale que la moyenne car insensible aux outliers." />
                    <MetricRow
                      label="Attendu" value={`$${fmt(m.expected_price)}`}
                      info="Moyenne arithmétique des prix finaux. Sous GBM = S0 × exp(µ × T). Légèrement supérieur à la médiane à cause de l'asymétrie log-normale." />
                    <MetricRow
                      label="P5 (pessimiste)" value={`$${fmt(m.p5)}`} color="text-bear"
                      info="5e percentile des prix finaux. Dans 5% des simulations, le prix sera inférieur à cette valeur. Représente un scénario défavorable." />
                    <MetricRow
                      label="P95 (optimiste)" value={`$${fmt(m.p95)}`} color="text-bull"
                      info="95e percentile des prix finaux. Dans 5% des simulations, le prix sera supérieur à cette valeur. Représente un scénario favorable." />
                    <MetricRow
                      label="Rendement attendu" value={pct(m.expected_return)}
                      color={m.expected_return >= 0 ? 'text-bull' : 'text-bear'}
                      info="(Prix final moyen − S0) / S0. Rendement total attendu sur l'horizon de simulation." />
                  </div>

                  {/* Colonne droite — Risque */}
                  <div>
                    <p className="text-xs text-terminal-textDim font-semibold uppercase tracking-wide mb-1">Risque</p>
                    <MetricRow
                      label="VaR 95%" value={pct(m.var_95)} color={varColor(m.var_95)}
                      info="Value at Risk à 95% : dans 95% des cas, la perte sera inférieure à cette valeur. Ex: -15% signifie que vous ne perdrez pas plus de 15% dans 95% des scénarios." />
                    <MetricRow
                      label="VaR 99%" value={pct(m.var_99)} color={varColor(m.var_99)}
                      info="Value at Risk à 99% : seuil de perte dépassé dans seulement 1% des cas. Correspond aux scénarios extrêmes." />
                    <MetricRow
                      label="ES 95%" value={pct(m.es_95)} color="text-bear"
                      info="Expected Shortfall (CVaR) à 95% : perte MOYENNE dans les 5% pires scénarios. Toujours pire que la VaR, mesure le risque de queue de distribution." />
                    <MetricRow
                      label="ES 99%" value={pct(m.es_99)} color="text-bear"
                      info="Expected Shortfall à 99% : perte moyenne dans le 1% pire. Indicateur réglementaire (Bâle III). Correspond à un scénario de crise sévère." />
                    <MetricRow
                      label="Drawdown moyen" value={pct(m.avg_max_drawdown)} color="text-warn"
                      info="Max drawdown moyen sur toutes les trajectoires. Pour chaque simulation, on calcule (creux − pic) / pic. Cette valeur est la moyenne de tous ces drawdowns." />
                  </div>
                </div>

                {/* Probabilités directionnelles */}
                <div>
                  <p className="text-xs text-terminal-textDim font-semibold uppercase tracking-wide mb-2">
                    Probabilités
                    <InfoBadge text="Fréquences observées sur les N simulations. P(perte) = % de trajectoires dont le prix final est inférieur au prix initial S0." />
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'P(perte)',       value: m.prob_loss,       bear: true,  info: `Part des simulations terminant sous $${fmt(result.S0)} (prix initial).` },
                      { label: 'P(gain > 10%)',  value: m.prob_gain_10pct, bear: false, info: `Part des simulations terminant 10% au-dessus de $${fmt(result.S0)}.` },
                      { label: 'P(perte > 10%)', value: m.prob_loss_10pct, bear: true,  info: `Part des simulations terminant 10% en-dessous de $${fmt(result.S0)}.` },
                      { label: 'P(gain > 20%)',  value: m.prob_gain_20pct, bear: false, info: `Part des simulations terminant 20% au-dessus de $${fmt(result.S0)}.` },
                    ].map(({ label, value, bear, info }) => (
                      <div key={label}
                        className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 flex justify-between items-center">
                        <span className="text-xs text-terminal-textDim flex items-center">
                          {label}
                          <InfoBadge text={info} />
                        </span>
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

        {/* ── Placeholder ───────────────────────────────────────────── */}
        {!result && !running && (
          <div className="border border-dashed border-terminal-border rounded-lg p-12 text-center text-terminal-textDim">
            <div className="text-4xl mb-3 font-mono text-terminal-textDim">∿</div>
            <p className="text-sm">Configurez les paramètres ci-dessus et cliquez sur <strong className="text-terminal-text">▶ Lancer la simulation</strong></p>
            <p className="text-xs mt-1">GBM · Merton · Heston · GARCH — calibration automatique depuis yfinance</p>
          </div>
        )}

        {/* ── Skeleton ─────────────────────────────────────────────── */}
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
