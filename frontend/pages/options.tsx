/**
 * /options — Options Pricing Calculator (Phase 19)
 *
 * Black-Scholes pricer : call/put price + 5 Greeks + payoff diagram + IV solver.
 */

import { useState, useMemo, useCallback } from 'react';
import Head from 'next/head';
import {
  ComposedChart,
  Area,
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

interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega:  number;
  rho:   number;
}

interface OptionResult {
  price:           number;
  intrinsic_value: number;
  time_value:      number;
  greeks:          Greeks;
  d1:              number;
  d2:              number;
  breakeven:       number;
  payoff_series:   { price: number; intrinsic: number; pnl: number }[];
}

interface IVResult {
  implied_vol: number;
  converged:   boolean;
  iterations:  number;
  error:       string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Days between today and expiry date → years */
function daysToYears(expiry: string): number {
  const now  = Date.now();
  const then = new Date(expiry).getTime();
  return Math.max((then - now) / (365.25 * 24 * 3600 * 1000), 0);
}

/** Default expiry: 3 months from today */
function defaultExpiry(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().slice(0, 10);
}

/** Today's date (lower bound for expiry input) */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + '%';
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface GreekCardProps {
  symbol: string;
  name:   string;
  value:  number;
  format: (v: number) => string;
  desc:   string;
  color?: string;
}
const GreekCard = ({ symbol, name, value, format, desc, color }: GreekCardProps) => (
  <div className="bg-terminal-bg border border-terminal-border rounded-lg p-4 flex flex-col gap-1">
    <div className="flex items-baseline gap-2">
      <span className="text-xl font-serif text-terminal-textMuted">{symbol}</span>
      <span className="text-xs text-terminal-textDim uppercase tracking-wider">{name}</span>
    </div>
    <span
      className="text-2xl font-mono font-bold"
      style={{ color: color ?? 'var(--color-text)' }}
    >
      {format(value)}
    </span>
    <span className="text-[11px] text-terminal-textDim leading-snug">{desc}</span>
  </div>
);

interface InputFieldProps {
  label:      string;
  value:      string | number;
  onChange:   (v: string) => void;
  type?:      string;
  min?:       string;
  step?:      string;
  suffix?:    string;
  placeholder?: string;
}
const InputField = ({ label, value, onChange, type = 'number', min, step, suffix, placeholder }: InputFieldProps) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs text-terminal-textMuted font-medium uppercase tracking-wider">{label}</label>
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        min={min}
        step={step}
        placeholder={placeholder}
        className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm font-mono text-terminal-text
                   focus:outline-none focus:border-terminal-cyan placeholder-terminal-textDim
                   [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-terminal-textDim pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Custom Tooltip
// ─────────────────────────────────────────────────────────────────────────────

const PayoffTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const pnl = payload.find((p: any) => p.dataKey === 'pnl')?.value ?? 0;
  return (
    <div className="rounded-lg border text-sm px-3 py-2 shadow-xl"
         style={{ background: '#0f1522', borderColor: '#2a3040', color: '#e8e9ed' }}>
      <div className="font-mono font-bold">${Number(label).toFixed(2)}</div>
      <div className={`font-mono font-semibold ${pnl >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
        P&L {pnl >= 0 ? '+' : ''}{Number(pnl).toFixed(2)}
      </div>
      {payload.find((p: any) => p.dataKey === 'intrinsic') && (
        <div className="text-xs text-[#9ca3af]">
          Intrinsic {Number(payload.find((p: any) => p.dataKey === 'intrinsic')?.value ?? 0).toFixed(2)}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function OptionsPage() {
  // ── Form state ──────────────────────────────────────────────────────────────
  const [ticker,     setTicker]     = useState('AAPL');
  const [spotInput,  setSpotInput]  = useState('182.50');
  const [strikeInput,setStrikeInput]= useState('185.00');
  const [expiry,     setExpiry]     = useState(defaultExpiry);
  const [rateInput,  setRateInput]  = useState('4.5');     // %
  const [volInput,   setVolInput]   = useState('25');      // %
  const [optionType, setOptionType] = useState<'call' | 'put'>('call');

  // ── IV Calculator state ─────────────────────────────────────────────────────
  const [mktPriceInput, setMktPriceInput] = useState('');
  const [ivResult,      setIvResult]      = useState<IVResult | null>(null);
  const [ivLoading,     setIvLoading]     = useState(false);
  const [ivError,       setIvError]       = useState('');

  // ── Result state ────────────────────────────────────────────────────────────
  const [result,  setResult]  = useState<OptionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // ── Spot fetch ──────────────────────────────────────────────────────────────
  const [spotLoading, setSpotLoading] = useState(false);

  const fetchSpot = useCallback(async () => {
    if (!ticker.trim()) return;
    setSpotLoading(true);
    try {
      const data = await apiFetch<{ spot: number; name: string }>(`/api/options/spot/${ticker.trim().toUpperCase()}`);
      setSpotInput(String(data.spot));
      setStrikeInput(String(Math.round(data.spot / 5) * 5)); // round to nearest 5
    } catch (e: any) {
      // silently ignore — user can type manually
    } finally {
      setSpotLoading(false);
    }
  }, [ticker]);

  // ── Derived T ───────────────────────────────────────────────────────────────
  const T = useMemo(() => daysToYears(expiry), [expiry]);
  const calendarDays = useMemo(() => {
    const now  = Date.now();
    const then = new Date(expiry).getTime();
    return Math.max(Math.round((then - now) / (24 * 3600 * 1000)), 0);
  }, [expiry]);

  // ── Calculate ───────────────────────────────────────────────────────────────
  const calculate = useCallback(async () => {
    const S     = parseFloat(spotInput);
    const K     = parseFloat(strikeInput);
    const r     = parseFloat(rateInput) / 100;
    const sigma = parseFloat(volInput)  / 100;

    if (!S || !K || S <= 0 || K <= 0 || sigma <= 0) {
      setError('Please fill all fields with valid positive values.');
      return;
    }
    if (T <= 0) {
      setError('Expiry date must be in the future.');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const data = await apiFetch<OptionResult>('/api/options/price', {
        method: 'POST',
        body: JSON.stringify({ S, K, T, r, sigma, option_type: optionType }),
      });
      setResult(data);
    } catch (e: any) {
      setError(e.message || 'Calculation failed');
    } finally {
      setLoading(false);
    }
  }, [spotInput, strikeInput, rateInput, volInput, optionType, T]);

  // ── IV Calculation ──────────────────────────────────────────────────────────
  const calculateIV = useCallback(async () => {
    const S   = parseFloat(spotInput);
    const K   = parseFloat(strikeInput);
    const r   = parseFloat(rateInput) / 100;
    const mkt = parseFloat(mktPriceInput);

    if (!mkt || mkt <= 0) { setIvError('Enter a valid market price.'); return; }
    if (!S || !K || S <= 0 || K <= 0) { setIvError('Set spot and strike first.'); return; }
    if (T <= 0) { setIvError('Expiry date must be in the future.'); return; }

    setIvLoading(true);
    setIvError('');
    setIvResult(null);

    try {
      const data = await apiFetch<IVResult>('/api/options/iv', {
        method: 'POST',
        body: JSON.stringify({ S, K, T, r, market_price: mkt, option_type: optionType }),
      });
      setIvResult(data);
    } catch (e: any) {
      setIvError(e.message || 'IV computation failed');
    } finally {
      setIvLoading(false);
    }
  }, [spotInput, strikeInput, rateInput, mktPriceInput, optionType, T]);

  // ── Payoff chart data ────────────────────────────────────────────────────────
  const payoffData = result?.payoff_series ?? [];

  const payoffDomain = useMemo(() => {
    if (!payoffData.length) return [-10, 30];
    const vals = payoffData.map(d => d.pnl);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const pad  = (maxV - minV) * 0.1;
    return [minV - pad, maxV + pad];
  }, [payoffData]);

  // ── Moneyness label ──────────────────────────────────────────────────────────
  const moneyness = useMemo(() => {
    const S = parseFloat(spotInput);
    const K = parseFloat(strikeInput);
    if (!S || !K) return '';
    const ratio = S / K;
    if (optionType === 'call') {
      if (ratio > 1.01) return 'ITM';
      if (ratio < 0.99) return 'OTM';
      return 'ATM';
    } else {
      if (ratio < 0.99) return 'ITM';
      if (ratio > 1.01) return 'OTM';
      return 'ATM';
    }
  }, [spotInput, strikeInput, optionType]);

  const moneynessColor = moneyness === 'ITM' ? '#22c55e' : moneyness === 'OTM' ? '#ef4444' : '#f59e0b';

  return (
    <>
      <Head>
        <title>Options Pricing · Monte Carlo</title>
      </Head>
      <div className="min-h-screen bg-terminal-bg">
        <Header />

        <main className="max-w-7xl mx-auto px-4 py-8">

          {/* ── Page header ─────────────────────────────────────────────── */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="font-serif text-2xl text-terminal-text">Options Pricing</h1>
              <span className="text-xs px-2 py-0.5 rounded font-mono bg-terminal-surface border border-terminal-border text-terminal-textMuted">
                Black-Scholes
              </span>
            </div>
            <p className="text-sm text-terminal-textMuted">
              European call &amp; put pricer · Greeks · Implied volatility · Payoff diagram
            </p>
          </div>

          {/* ── Two-column layout ──────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">

            {/* ══ LEFT — Calculator Form ═══════════════════════════════════ */}
            <div className="flex flex-col gap-4">

              {/* Ticker + spot fetch */}
              <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-terminal-text mb-4 uppercase tracking-wider">
                  Parameters
                </h2>

                {/* Ticker row */}
                <div className="flex gap-2 mb-4">
                  <div className="flex-1">
                    <label className="text-xs text-terminal-textMuted font-medium uppercase tracking-wider block mb-1">
                      Ticker
                    </label>
                    <input
                      type="text"
                      value={ticker}
                      onChange={e => setTicker(e.target.value.toUpperCase())}
                      onKeyDown={e => e.key === 'Enter' && fetchSpot()}
                      placeholder="AAPL"
                      className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm font-mono text-terminal-text
                                 focus:outline-none focus:border-terminal-cyan placeholder-terminal-textDim uppercase"
                    />
                  </div>
                  <div className="flex flex-col justify-end">
                    <button
                      onClick={fetchSpot}
                      disabled={spotLoading}
                      className="px-4 py-2 rounded text-sm font-medium bg-terminal-surfaceHi border border-terminal-border
                                 text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan transition
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {spotLoading ? '…' : 'Fetch'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <InputField label="Spot Price (S)" value={spotInput} onChange={setSpotInput} step="0.01" suffix="$" />
                  <InputField label="Strike (K)" value={strikeInput} onChange={setStrikeInput} step="0.01" suffix="$" />
                </div>

                <div className="mb-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-terminal-textMuted font-medium uppercase tracking-wider">
                        Expiry Date
                      </label>
                      {calendarDays > 0 && (
                        <span className="text-xs font-mono text-terminal-textDim">
                          {calendarDays}d · {(T * 365).toFixed(0)}d · {fmt(T, 4)}y
                        </span>
                      )}
                    </div>
                    <input
                      type="date"
                      value={expiry}
                      min={todayStr()}
                      onChange={e => setExpiry(e.target.value)}
                      className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm font-mono text-terminal-text
                                 focus:outline-none focus:border-terminal-cyan"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-5">
                  <InputField label="Risk-free Rate (r)" value={rateInput} onChange={setRateInput} step="0.1" suffix="%" />
                  <InputField label="Implied Volatility" value={volInput} onChange={setVolInput} step="0.5" suffix="%" />
                </div>

                {/* Call / Put toggle */}
                <div className="flex rounded-lg overflow-hidden border border-terminal-border mb-5">
                  {(['call', 'put'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setOptionType(type)}
                      className={`flex-1 py-2.5 text-sm font-semibold uppercase tracking-wider transition
                        ${optionType === type
                          ? type === 'call'
                            ? 'bg-[#15803d] text-white'
                            : 'bg-[#b91c1c] text-white'
                          : 'bg-terminal-bg text-terminal-textMuted hover:text-terminal-text'
                        }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                {/* Moneyness badge */}
                {moneyness && (
                  <div className="flex items-center gap-2 mb-4 text-sm">
                    <span className="text-terminal-textDim">Moneyness:</span>
                    <span className="font-mono font-bold px-2 py-0.5 rounded text-xs"
                          style={{ color: moneynessColor, background: moneynessColor + '20', border: `1px solid ${moneynessColor}40` }}>
                      {moneyness}
                    </span>
                    {parseFloat(spotInput) > 0 && parseFloat(strikeInput) > 0 && (
                      <span className="text-xs font-mono text-terminal-textDim">
                        S/K = {(parseFloat(spotInput) / parseFloat(strikeInput)).toFixed(4)}
                      </span>
                    )}
                  </div>
                )}

                {/* Calculate button */}
                <button
                  onClick={calculate}
                  disabled={loading}
                  className="w-full py-3 rounded-lg font-semibold text-sm transition
                             text-white disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: loading ? 'var(--color-primary)88' : 'var(--color-primary)' }}
                >
                  {loading ? 'Calculating…' : 'Calculate'}
                </button>

                {error && (
                  <p className="mt-3 text-xs text-[#ef4444] bg-[#ef444420] border border-[#ef444440] rounded px-3 py-2">
                    {error}
                  </p>
                )}
              </div>

              {/* ── IV Calculator ─────────────────────────────────────────── */}
              <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-terminal-text mb-1 uppercase tracking-wider">
                  Implied Volatility Solver
                </h2>
                <p className="text-xs text-terminal-textDim mb-4">
                  Enter the market-observed option price to back-solve for IV.
                </p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <InputField
                      label="Market Price"
                      value={mktPriceInput}
                      onChange={setMktPriceInput}
                      step="0.01"
                      suffix="$"
                      placeholder="e.g. 12.50"
                    />
                  </div>
                  <div className="flex flex-col justify-end">
                    <button
                      onClick={calculateIV}
                      disabled={ivLoading}
                      className="px-4 py-2 rounded text-sm font-medium border transition
                                 text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan
                                 bg-terminal-bg border-terminal-border disabled:opacity-50"
                    >
                      {ivLoading ? '…' : 'Solve'}
                    </button>
                  </div>
                </div>

                {ivError && (
                  <p className="mt-2 text-xs text-[#ef4444]">{ivError}</p>
                )}

                {ivResult && (
                  <div className="mt-3 rounded-lg bg-terminal-bg border border-terminal-border p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-terminal-textMuted uppercase tracking-wider">Implied Vol</span>
                      <span className={`text-xl font-mono font-bold ${ivResult.converged ? 'text-terminal-cyan' : 'text-[#f59e0b]'}`}>
                        {fmtPct(ivResult.implied_vol)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] text-terminal-textDim">
                        {ivResult.converged ? `Converged (${ivResult.iterations} iterations)` : 'Approximate (did not fully converge)'}
                      </span>
                      <button
                        onClick={() => setVolInput(fmt(ivResult.implied_vol * 100, 2))}
                        className="text-[11px] text-terminal-cyan hover:underline"
                      >
                        Use this σ ↑
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ══ RIGHT — Results ═══════════════════════════════════════════ */}
            <div className="flex flex-col gap-4">

              {!result && !loading && (
                <div className="bg-terminal-surface border border-terminal-border rounded-xl p-8 flex flex-col items-center justify-center text-center gap-3 h-64">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="1.5" className="text-terminal-textDim">
                    <path d="M3 18L9 12L13 16L21 6"/>
                    <path d="M21 6H15M21 6V12" strokeLinecap="round"/>
                  </svg>
                  <p className="text-terminal-textMuted text-sm">
                    Configure your option parameters and click <strong>Calculate</strong>.
                  </p>
                </div>
              )}

              {loading && (
                <div className="bg-terminal-surface border border-terminal-border rounded-xl p-8 flex items-center justify-center h-64">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-terminal-border border-t-terminal-cyan rounded-full animate-spin" />
                    <span className="text-sm text-terminal-textMuted">Computing…</span>
                  </div>
                </div>
              )}

              {result && (
                <>
                  {/* ── Option Price Card ────────────────────────────────── */}
                  <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-semibold text-terminal-text uppercase tracking-wider">
                        Option Price
                      </h2>
                      <span className={`text-xs px-2 py-0.5 rounded font-mono font-semibold uppercase
                        ${optionType === 'call' ? 'bg-[#15803d20] text-[#22c55e] border border-[#22c55e40]'
                                                : 'bg-[#b91c1c20] text-[#f87171] border border-[#f8717140]'}`}>
                        {optionType}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-1 flex flex-col">
                        <span className="text-xs text-terminal-textDim uppercase tracking-wider mb-1">Theoretical Price</span>
                        <span className="text-3xl font-mono font-bold text-terminal-text">
                          ${fmt(result.price, 4)}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-terminal-textDim uppercase tracking-wider mb-1">Intrinsic</span>
                        <span className="text-xl font-mono text-terminal-text">${fmt(result.intrinsic_value, 4)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-terminal-textDim uppercase tracking-wider mb-1">Time Value</span>
                        <span className="text-xl font-mono text-terminal-cyan">${fmt(result.time_value, 4)}</span>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-terminal-border grid grid-cols-3 gap-4 text-sm">
                      <div className="flex flex-col">
                        <span className="text-xs text-terminal-textDim mb-0.5">Break-even</span>
                        <span className="font-mono font-semibold text-terminal-text">${fmt(result.breakeven, 2)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-terminal-textDim mb-0.5">d₁</span>
                        <span className="font-mono text-terminal-textMuted">{fmt(result.d1, 4)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-terminal-textDim mb-0.5">d₂</span>
                        <span className="font-mono text-terminal-textMuted">{fmt(result.d2, 4)}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── Greeks ───────────────────────────────────────────── */}
                  <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
                    <h2 className="text-sm font-semibold text-terminal-text uppercase tracking-wider mb-4">
                      Greeks
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                      <GreekCard
                        symbol="Δ" name="Delta"
                        value={result.greeks.delta}
                        format={v => fmt(v, 4)}
                        desc={`$${fmt(Math.abs(result.greeks.delta), 4)} change per $1 in spot`}
                        color={result.greeks.delta >= 0 ? '#22c55e' : '#ef4444'}
                      />
                      <GreekCard
                        symbol="Γ" name="Gamma"
                        value={result.greeks.gamma}
                        format={v => fmt(v, 6)}
                        desc="Δ-change per $1 spot move"
                        color="var(--color-cyan)"
                      />
                      <GreekCard
                        symbol="Θ" name="Theta"
                        value={result.greeks.theta}
                        format={v => `${fmt(v, 4)}/d`}
                        desc="Value lost per calendar day"
                        color={result.greeks.theta < 0 ? '#ef4444' : '#22c55e'}
                      />
                      <GreekCard
                        symbol="ν" name="Vega"
                        value={result.greeks.vega}
                        format={v => fmt(v, 4)}
                        desc="$ change per +1% implied vol"
                        color="#a78bfa"
                      />
                      <GreekCard
                        symbol="ρ" name="Rho"
                        value={result.greeks.rho}
                        format={v => fmt(v, 4)}
                        desc="$ change per +1% rate"
                        color="var(--color-textMuted)"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Payoff Diagram ──────────────────────────────────────────────── */}
          {result && payoffData.length > 0 && (
            <div className="mt-6 bg-terminal-surface border border-terminal-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-terminal-text uppercase tracking-wider">
                    Payoff at Expiry
                  </h2>
                  <p className="text-xs text-terminal-textDim mt-0.5">
                    P&L after paying ${fmt(result.price, 4)} premium · Break-even at ${fmt(result.breakeven, 2)}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs text-terminal-textDim">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-[#22c55e] inline-block" />Profit
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-[#ef4444] inline-block" />Loss
                  </span>
                </div>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={payoffData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="payoffGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.25} />
                        <stop offset="50%" stopColor="#22c55e" stopOpacity={0.05} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} />
                    <XAxis
                      dataKey="price"
                      tickFormatter={v => `$${Number(v).toFixed(0)}`}
                      tick={{ fill: 'var(--color-textDim)', fontSize: 11 }}
                      axisLine={{ stroke: 'var(--color-border)' }}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={v => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}`}
                      tick={{ fill: 'var(--color-textDim)', fontSize: 11 }}
                      axisLine={{ stroke: 'var(--color-border)' }}
                      tickLine={false}
                      domain={payoffDomain as [number, number]}
                      width={55}
                    />
                    <Tooltip content={<PayoffTooltip />} />
                    <ReferenceLine y={0} stroke="var(--color-textDim)" strokeDasharray="4 2" strokeWidth={1} />
                    <ReferenceLine
                      x={result.breakeven}
                      stroke="var(--color-cyan)"
                      strokeDasharray="4 2"
                      strokeWidth={1.5}
                      label={{ value: `BE $${fmt(result.breakeven, 2)}`, fill: 'var(--color-cyan)', fontSize: 11, position: 'top' }}
                    />
                    {/* Spot price line */}
                    <ReferenceLine
                      x={parseFloat(spotInput)}
                      stroke="var(--color-textMuted)"
                      strokeDasharray="4 2"
                      strokeWidth={1}
                      label={{ value: `S $${parseFloat(spotInput).toFixed(2)}`, fill: 'var(--color-textMuted)', fontSize: 11, position: 'top' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="pnl"
                      stroke="none"
                      fill="url(#payoffGradient)"
                      fillOpacity={1}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="pnl"
                      dot={false}
                      strokeWidth={2.5}
                      isAnimationActive={false}
                      stroke="url(#payoffLineGradient)"
                      style={{ stroke: '#22c55e' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Model Notes ──────────────────────────────────────────────── */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                title: 'Model assumptions',
                lines: [
                  'European exercise only',
                  'Constant implied volatility',
                  'Continuous risk-free rate',
                  'No dividends',
                  'Log-normal underlying returns',
                ],
              },
              {
                title: 'Greek conventions',
                lines: [
                  'Delta: Δ$ per $1 spot move',
                  'Gamma: Δdelta per $1 spot move',
                  'Theta: $ per calendar day',
                  'Vega: $ per +1% implied vol',
                  'Rho: $ per +1% risk-free rate',
                ],
              },
              {
                title: 'IV Solver',
                lines: [
                  'Newton-Raphson primary method',
                  'Bisection fallback on divergence',
                  'Tolerance: 1×10⁻⁶',
                  'Initial guess: σ = 30%',
                  'Bounds: [0.01%, 2000%]',
                ],
              },
            ].map(card => (
              <div key={card.title} className="bg-terminal-surface border border-terminal-border rounded-xl p-4">
                <h3 className="text-xs font-semibold text-terminal-textMuted uppercase tracking-wider mb-3">
                  {card.title}
                </h3>
                <ul className="space-y-1">
                  {card.lines.map(l => (
                    <li key={l} className="text-xs text-terminal-textDim flex items-start gap-2">
                      <span className="text-terminal-textDim mt-0.5">·</span>
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

        </main>
      </div>
    </>
  );
}
