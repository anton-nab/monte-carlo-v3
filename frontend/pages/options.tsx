/**
 * /options — Options Pricing Calculator (Phase 19)
 *
 * Fixes v2:
 *  - Auto-fetch spot on ticker change (debounce 700ms)
 *  - Greeks avec tooltips détaillés
 *  - Graphique dark-mode-aware (isDark hook)
 *  - Courbe payoff bicolore (vert profit / rouge perte)
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
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

function daysToYears(expiry: string): number {
  const now  = Date.now();
  const then = new Date(expiry).getTime();
  return Math.max((then - now) / (365.25 * 24 * 3600 * 1000), 0);
}

function defaultExpiry(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().slice(0, 10);
}

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
// GreekCard with hover tooltip
// ─────────────────────────────────────────────────────────────────────────────

interface GreekCardProps {
  symbol:  string;
  name:    string;
  value:   number;
  format:  (v: number) => string;
  desc:    string;
  tooltip: string;
  color?:  string;
}

const GreekCard = ({ symbol, name, value, format, desc, tooltip, color }: GreekCardProps) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="bg-terminal-bg border border-terminal-border rounded-lg p-4 flex flex-col gap-1.5 relative cursor-default"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-serif text-terminal-textMuted">{symbol}</span>
          <span className="text-[10px] text-terminal-textDim uppercase tracking-widest">{name}</span>
        </div>
        <span className="text-[10px] text-terminal-textDim select-none opacity-60">ⓘ</span>
      </div>
      <span className="text-2xl font-mono font-bold leading-none" style={{ color: color ?? 'var(--color-text)' }}>
        {format(value)}
      </span>
      <span className="text-[11px] text-terminal-textMuted leading-snug">{desc}</span>

      {/* Tooltip popup — always hardcoded dark */}
      {hover && (
        <div
          className="absolute bottom-full left-0 mb-2 z-50 w-64 rounded-lg border text-xs p-3 shadow-2xl pointer-events-none"
          style={{ background: '#0f1522', borderColor: '#2a3040', color: '#e8e9ed', lineHeight: 1.55 }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// InputField
// ─────────────────────────────────────────────────────────────────────────────

interface InputFieldProps {
  label:       string;
  value:       string | number;
  onChange:    (v: string) => void;
  type?:       string;
  min?:        string;
  step?:       string;
  suffix?:     string;
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
// Custom Payoff Tooltip (always hardcoded dark — theme-safe)
// ─────────────────────────────────────────────────────────────────────────────

const PayoffTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const pnl       = payload.find((p: any) => p.dataKey === 'pnl')?.value       ?? 0;
  const intrinsic = payload.find((p: any) => p.dataKey === 'intrinsic')?.value ?? 0;
  return (
    <div className="rounded-lg border text-sm px-3 py-2 shadow-xl"
         style={{ background: '#0f1522', borderColor: '#2a3040', color: '#e8e9ed' }}>
      <div className="font-mono font-bold text-[#e8e9ed]">${Number(label).toFixed(2)}</div>
      <div className={`font-mono font-semibold ${pnl >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
        P&L {pnl >= 0 ? '+' : ''}{Number(pnl).toFixed(2)}
      </div>
      <div className="text-xs text-[#7a8294]">
        Intrinsic {Number(intrinsic).toFixed(2)}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function OptionsPage() {
  // ── Form state ──────────────────────────────────────────────────────────────
  const [ticker,      setTicker]      = useState('AAPL');
  const [spotInput,   setSpotInput]   = useState('182.50');
  const [strikeInput, setStrikeInput] = useState('185.00');
  const [expiry,      setExpiry]      = useState(defaultExpiry);
  const [rateInput,   setRateInput]   = useState('4.5');
  const [volInput,    setVolInput]    = useState('25');
  const [optionType,  setOptionType]  = useState<'call' | 'put'>('call');

  // ── IV Calculator state ─────────────────────────────────────────────────────
  const [mktPriceInput, setMktPriceInput] = useState('');
  const [ivResult,      setIvResult]      = useState<IVResult | null>(null);
  const [ivLoading,     setIvLoading]     = useState(false);
  const [ivError,       setIvError]       = useState('');

  // ── Result state ────────────────────────────────────────────────────────────
  const [result,      setResult]      = useState<OptionResult | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [spotLoading, setSpotLoading] = useState(false);

  // ── Dark mode detection (for chart colors) ──────────────────────────────────
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  const chartTextColor   = isDark ? '#7a8294' : '#5a4f4f';
  const chartGridColor   = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(90,79,79,0.1)';
  const chartBorderColor = isDark ? '#2a3040' : '#e7e5e3';
  const chartCyan        = '#00afab';

  // ── Auto-fetch spot on ticker change (700ms debounce) ───────────────────────
  useEffect(() => {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    const timer = setTimeout(async () => {
      setSpotLoading(true);
      try {
        const data = await apiFetch<{ spot: number; name: string }>(`/api/options/spot/${sym}`);
        setSpotInput(String(data.spot));
        setStrikeInput(String(Math.round(data.spot / 5) * 5));
      } catch { /* silently ignore — user can type manually */ }
      finally { setSpotLoading(false); }
    }, 700);
    return () => clearTimeout(timer);
  }, [ticker]);

  // ── Manual fetch (Fetch button / Enter key) ──────────────────────────────────
  const fetchSpot = useCallback(async () => {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    setSpotLoading(true);
    try {
      const data = await apiFetch<{ spot: number; name: string }>(`/api/options/spot/${sym}`);
      setSpotInput(String(data.spot));
      setStrikeInput(String(Math.round(data.spot / 5) * 5));
    } catch {}
    finally { setSpotLoading(false); }
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
    const r     = parseFloat(rateInput)  / 100;
    const sigma = parseFloat(volInput)   / 100;
    if (!S || !K || S <= 0 || K <= 0 || sigma <= 0) { setError('Remplissez tous les champs avec des valeurs valides.'); return; }
    if (T <= 0) { setError("La date d'expiration doit être dans le futur."); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await apiFetch<OptionResult>('/api/options/price', {
        method: 'POST',
        body: JSON.stringify({ S, K, T, r, sigma, option_type: optionType }),
      });
      setResult(data);
    } catch (e: any) { setError(e.message || 'Calculation failed'); }
    finally { setLoading(false); }
  }, [spotInput, strikeInput, rateInput, volInput, optionType, T]);

  // ── IV Calculation ──────────────────────────────────────────────────────────
  const calculateIV = useCallback(async () => {
    const S   = parseFloat(spotInput);
    const K   = parseFloat(strikeInput);
    const r   = parseFloat(rateInput) / 100;
    const mkt = parseFloat(mktPriceInput);
    if (!mkt || mkt <= 0) { setIvError('Entrez un prix de marché valide.'); return; }
    if (!S || !K || S <= 0 || K <= 0) { setIvError('Définissez d\'abord le spot et le strike.'); return; }
    if (T <= 0) { setIvError("La date d'expiration doit être dans le futur."); return; }
    setIvLoading(true); setIvError(''); setIvResult(null);
    try {
      const data = await apiFetch<IVResult>('/api/options/iv', {
        method: 'POST',
        body: JSON.stringify({ S, K, T, r, market_price: mkt, option_type: optionType }),
      });
      setIvResult(data);
    } catch (e: any) { setIvError(e.message || 'IV computation failed'); }
    finally { setIvLoading(false); }
  }, [spotInput, strikeInput, rateInput, mktPriceInput, optionType, T]);

  // ── Payoff chart data ────────────────────────────────────────────────────────
  const payoffData = result?.payoff_series ?? [];

  const payoffDomain = useMemo(() => {
    if (!payoffData.length) return [-10, 30] as [number, number];
    const vals = payoffData.map(d => d.pnl);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const pad  = (maxV - minV) * 0.12;
    return [minV - pad, maxV + pad] as [number, number];
  }, [payoffData]);

  // Zero-crossing position in SVG gradient coordinates (0=top → 1=bottom)
  const zeroFraction = useMemo(() => {
    const [minV, maxV] = payoffDomain;
    if (maxV <= 0) return 0;
    if (minV >= 0) return 1;
    return maxV / (maxV - minV);
  }, [payoffDomain]);

  // Split series for dual-color area fill
  const payoffEnhanced = useMemo(() =>
    payoffData.map(d => ({
      ...d,
      pnl_pos: Math.max(d.pnl, 0),
      pnl_neg: Math.min(d.pnl, 0),
    })),
    [payoffData]
  );

  // ── Moneyness ───────────────────────────────────────────────────────────────
  const moneyness = useMemo(() => {
    const S = parseFloat(spotInput);
    const K = parseFloat(strikeInput);
    if (!S || !K) return '';
    const ratio = S / K;
    if (optionType === 'call') return ratio > 1.01 ? 'ITM' : ratio < 0.99 ? 'OTM' : 'ATM';
    else                       return ratio < 0.99 ? 'ITM' : ratio > 1.01 ? 'OTM' : 'ATM';
  }, [spotInput, strikeInput, optionType]);
  const moneynessColor = moneyness === 'ITM' ? '#22c55e' : moneyness === 'OTM' ? '#ef4444' : '#f59e0b';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Head><title>Options Pricing · Monte Carlo</title></Head>
      <div className="min-h-screen bg-terminal-bg">
        <Header />
        <main className="max-w-7xl mx-auto px-4 py-8">

          {/* Page header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="font-serif text-2xl text-terminal-text">Options Pricing</h1>
              <span className="text-xs px-2 py-0.5 rounded font-mono bg-terminal-surface border border-terminal-border text-terminal-textMuted">
                Black-Scholes
              </span>
            </div>
            <p className="text-sm text-terminal-textMuted">
              Pricer européen call &amp; put · Greeks · Volatilité implicite · Diagramme de payoff
            </p>
          </div>

          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">

            {/* ══ LEFT — Form ══════════════════════════════════════════════ */}
            <div className="flex flex-col gap-4">

              <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-terminal-text mb-4 uppercase tracking-wider">Paramètres</h2>

                {/* Ticker + auto-fetch */}
                <div className="flex gap-2 mb-4">
                  <div className="flex-1">
                    <label className="text-xs text-terminal-textMuted font-medium uppercase tracking-wider block mb-1">Ticker</label>
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
                      {spotLoading
                        ? <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 border border-terminal-textDim border-t-terminal-cyan rounded-full animate-spin inline-block" />
                            …
                          </span>
                        : 'Fetch'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <InputField label="Spot (S)" value={spotInput} onChange={setSpotInput} step="0.01" suffix="$" />
                  <InputField label="Strike (K)" value={strikeInput} onChange={setStrikeInput} step="0.01" suffix="$" />
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-terminal-textMuted font-medium uppercase tracking-wider">Expiration</label>
                    {calendarDays > 0 && (
                      <span className="text-xs font-mono text-terminal-textDim">{calendarDays} j · T = {fmt(T, 4)} an</span>
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

                <div className="grid grid-cols-2 gap-3 mb-5">
                  <InputField label="Taux sans risque (r)" value={rateInput} onChange={setRateInput} step="0.1" suffix="%" />
                  <InputField label="Vol implicite (σ)" value={volInput} onChange={setVolInput} step="0.5" suffix="%" />
                </div>

                {/* Call / Put */}
                <div className="flex rounded-lg overflow-hidden border border-terminal-border mb-5">
                  {(['call', 'put'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setOptionType(type)}
                      className={`flex-1 py-2.5 text-sm font-semibold uppercase tracking-wider transition
                        ${optionType === type
                          ? type === 'call' ? 'bg-[#15803d] text-white' : 'bg-[#b91c1c] text-white'
                          : 'bg-terminal-bg text-terminal-textMuted hover:text-terminal-text'}`}
                    >
                      {type === 'call' ? '▲ Call' : '▼ Put'}
                    </button>
                  ))}
                </div>

                {/* Moneyness */}
                {moneyness && (
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xs text-terminal-textDim">Moneyness :</span>
                    <span className="font-mono font-bold px-2 py-0.5 rounded text-xs"
                          style={{ color: moneynessColor, background: moneynessColor + '22', border: `1px solid ${moneynessColor}44` }}>
                      {moneyness}
                    </span>
                    {parseFloat(spotInput) > 0 && parseFloat(strikeInput) > 0 && (
                      <span className="text-xs font-mono text-terminal-textDim">
                        S/K = {(parseFloat(spotInput) / parseFloat(strikeInput)).toFixed(3)}
                      </span>
                    )}
                  </div>
                )}

                <button
                  onClick={calculate}
                  disabled={loading}
                  className="w-full py-3 rounded-lg font-semibold text-sm text-white transition disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: loading ? 'var(--color-primary)88' : 'var(--color-primary)' }}
                >
                  {loading ? 'Calcul en cours…' : 'Calculer'}
                </button>
                {error && (
                  <p className="mt-3 text-xs text-[#ef4444] bg-[#ef444415] border border-[#ef444430] rounded px-3 py-2">{error}</p>
                )}
              </div>

              {/* ── IV Solver ────────────────────────────────────────────── */}
              <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-terminal-text mb-1 uppercase tracking-wider">
                  Volatilité Implicite (IV)
                </h2>
                <div className="text-xs text-terminal-textMuted mb-3 space-y-1">
                  <p>
                    La <strong className="text-terminal-text">volatilité implicite</strong> est le σ que le marché "price in" dans l'option.
                    C'est l'inverse de Black-Scholes : au lieu de calculer un prix à partir de σ,
                    on cherche le σ qui correspond au prix observé.
                  </p>
                  <p className="text-terminal-textDim">
                    IV &gt; vol historique → option chère (marché anticipe turbulences) ·
                    IV &lt; vol historique → option bon marché
                  </p>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <InputField
                      label="Prix de marché observé"
                      value={mktPriceInput}
                      onChange={setMktPriceInput}
                      step="0.01"
                      suffix="$"
                      placeholder="ex. 12.50"
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
                {ivError && <p className="mt-2 text-xs text-[#ef4444]">{ivError}</p>}
                {ivResult && (
                  <div className="mt-3 rounded-lg bg-terminal-bg border border-terminal-border p-3 space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-terminal-textMuted uppercase tracking-wider">IV calculée</span>
                      <span className={`text-2xl font-mono font-bold ${ivResult.converged ? 'text-terminal-cyan' : 'text-[#f59e0b]'}`}>
                        {fmtPct(ivResult.implied_vol)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-terminal-textDim">
                        {ivResult.converged
                          ? `✓ Convergé en ${ivResult.iterations} itérations`
                          : `⚠ Valeur approchée (${ivResult.iterations} itérations)`}
                      </span>
                      <button
                        onClick={() => setVolInput(fmt(ivResult.implied_vol * 100, 2))}
                        className="text-[11px] text-terminal-cyan hover:underline"
                      >
                        Utiliser ce σ ↑
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ══ RIGHT — Results ══════════════════════════════════════════ */}
            <div className="flex flex-col gap-4">

              {!result && !loading && (
                <div className="bg-terminal-surface border border-terminal-border rounded-xl p-8 flex flex-col items-center justify-center text-center gap-3 h-64">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="1.5" className="text-terminal-textDim">
                    <path d="M3 18L9 12L13 16L21 6"/><path d="M21 6H15M21 6V12" strokeLinecap="round"/>
                  </svg>
                  <p className="text-terminal-textMuted text-sm">
                    Configurez vos paramètres et cliquez sur <strong>Calculer</strong>.
                  </p>
                </div>
              )}

              {loading && (
                <div className="bg-terminal-surface border border-terminal-border rounded-xl p-8 flex items-center justify-center h-64">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-terminal-border border-t-terminal-cyan rounded-full animate-spin" />
                    <span className="text-sm text-terminal-textMuted">Calcul en cours…</span>
                  </div>
                </div>
              )}

              {result && (
                <>
                  {/* Option Price */}
                  <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-semibold text-terminal-text uppercase tracking-wider">Prix de l'option</h2>
                      <span className={`text-xs px-2 py-0.5 rounded font-mono font-semibold uppercase
                        ${optionType === 'call' ? 'bg-[#15803d20] text-[#22c55e] border border-[#22c55e40]'
                                                : 'bg-[#b91c1c20] text-[#f87171] border border-[#f8717140]'}`}>
                        {optionType}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="flex flex-col">
                        <span className="text-xs text-terminal-textDim uppercase tracking-wider mb-1">Prix théorique</span>
                        <span className="text-3xl font-mono font-bold text-terminal-text">${fmt(result.price, 4)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-terminal-textDim uppercase tracking-wider mb-1">Valeur intrinsèque</span>
                        <span className="text-xl font-mono text-terminal-text">${fmt(result.intrinsic_value, 4)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-terminal-textDim uppercase tracking-wider mb-1">Valeur temps</span>
                        <span className="text-xl font-mono text-terminal-cyan">${fmt(result.time_value, 4)}</span>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-terminal-border grid grid-cols-3 gap-4">
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

                  {/* Greeks */}
                  <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-semibold text-terminal-text uppercase tracking-wider">Greeks</h2>
                      <span className="text-xs text-terminal-textDim italic">Survolez une carte pour plus de détails</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                      <GreekCard
                        symbol="Δ" name="Delta"
                        value={result.greeks.delta}
                        format={v => fmt(v, 4)}
                        desc={`${result.greeks.delta >= 0 ? '+' : ''}$${fmt(result.greeks.delta, 4)} par $1 de spot`}
                        tooltip={`Sensibilité au prix du sous-jacent.\n\nUn delta de ${fmt(result.greeks.delta, 2)} signifie que si le spot monte de $1, l'option gagne $${fmt(Math.abs(result.greeks.delta), 2)}.\n\nC'est aussi une approximation de la probabilité que l'option expire ITM (~${fmt(Math.abs(result.greeks.delta) * 100, 0)}%). Call : Δ ∈ [0,1] · Put : Δ ∈ [-1,0]`}
                        color={result.greeks.delta >= 0 ? '#22c55e' : '#ef4444'}
                      />
                      <GreekCard
                        symbol="Γ" name="Gamma"
                        value={result.greeks.gamma}
                        format={v => fmt(v, 5)}
                        desc={`Δ varie de ${fmt(result.greeks.gamma, 5)} par $1`}
                        tooltip={`Dérivée seconde du prix par rapport au spot — vitesse de changement du delta.\n\nGamma est maximal ATM et proche de l'expiration (risque de "gamma squeeze").\nSymétrique pour call et put.\n\nUn fort gamma = delta très instable = forte exposition aux mouvements brusques.`}
                        color="var(--color-cyan)"
                      />
                      <GreekCard
                        symbol="Θ" name="Theta"
                        value={result.greeks.theta}
                        format={v => `${fmt(v, 4)}/j`}
                        desc={`${result.greeks.theta < 0 ? 'Perd' : 'Gagne'} $${fmt(Math.abs(result.greeks.theta), 4)} par jour`}
                        tooltip={`Dépréciation temporelle — valeur perdue chaque jour, toutes choses égales.\n\nTheta est négatif pour l'acheteur (time decay) et positif pour le vendeur.\nMaximal pour les options ATM proches de l'expiration.\n\nUn theta de ${fmt(result.greeks.theta, 4)} = $${fmt(Math.abs(result.greeks.theta * 7), 3)} perdus en une semaine.`}
                        color={result.greeks.theta < 0 ? '#ef4444' : '#22c55e'}
                      />
                      <GreekCard
                        symbol="ν" name="Vega"
                        value={result.greeks.vega}
                        format={v => fmt(v, 4)}
                        desc={`+$${fmt(result.greeks.vega, 4)} si vol +1%`}
                        tooltip={`Sensibilité à la volatilité implicite.\n\nSi IV passe de ${volInput}% à ${(parseFloat(volInput) + 1).toFixed(1)}%, l'option gagne $${fmt(result.greeks.vega, 4)}.\n\nVega est positif pour tout acheteur d'option (long vega).\nMaximal ATM et à longue échéance.\nStrike éloigné + expiration courte = vega très faible.`}
                        color="#a78bfa"
                      />
                      <GreekCard
                        symbol="ρ" name="Rho"
                        value={result.greeks.rho}
                        format={v => fmt(v, 4)}
                        desc={`${result.greeks.rho >= 0 ? '+' : ''}$${fmt(result.greeks.rho, 4)} si taux +1%`}
                        tooltip={`Sensibilité au taux sans risque.\n\nCall : rho positif (taux ↑ → call ↑ car financement futur moins coûteux).\nPut : rho négatif (taux ↑ → put ↓).\n\nImpact faible sur les options court terme. Significatif sur les LEAPS (2 ans+) et dans un environnement de taux élevés.`}
                        color="var(--color-textMuted)"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Payoff Diagram ────────────────────────────────────────────── */}
          {result && payoffEnhanced.length > 0 && (
            <div className="mt-6 bg-terminal-surface border border-terminal-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-terminal-text uppercase tracking-wider">Payoff à l'expiration</h2>
                  <p className="text-xs text-terminal-textDim mt-0.5">
                    P&amp;L après prime de ${fmt(result.price, 4)} · Break-even à ${fmt(result.breakeven, 2)}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs text-terminal-textDim">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#22c55e] inline-block rounded" />Profit</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#ef4444] inline-block rounded" />Perte</span>
                </div>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={payoffEnhanced} margin={{ top: 8, right: 24, left: 8, bottom: 5 }}>
                    <defs>
                      {/* Line gradient: sharp green→red split at zero */}
                      <linearGradient id="pnlLineGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset={`${zeroFraction * 100 - 0.5}%`} stopColor="#22c55e" />
                        <stop offset={`${zeroFraction * 100 + 0.5}%`} stopColor="#ef4444" />
                      </linearGradient>
                      {/* Area fill gradients */}
                      <linearGradient id="areaGreenGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#22c55e" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity={0.04} />
                      </linearGradient>
                      <linearGradient id="areaRedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.04} />
                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0.22} />
                      </linearGradient>
                    </defs>

                    <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                    <XAxis
                      dataKey="price"
                      tickFormatter={v => `$${Number(v).toFixed(0)}`}
                      tick={{ fill: chartTextColor, fontSize: 11 }}
                      axisLine={{ stroke: chartBorderColor }}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={v => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}`}
                      tick={{ fill: chartTextColor, fontSize: 11 }}
                      axisLine={{ stroke: chartBorderColor }}
                      tickLine={false}
                      domain={payoffDomain}
                      width={58}
                    />
                    <Tooltip content={<PayoffTooltip />} />

                    {/* Zero line */}
                    <ReferenceLine y={0} stroke={chartTextColor} strokeDasharray="4 3" strokeWidth={1} />
                    {/* Break-even */}
                    <ReferenceLine
                      x={result.breakeven}
                      stroke={chartCyan}
                      strokeDasharray="4 2"
                      strokeWidth={1.5}
                      label={{ value: `BE $${fmt(result.breakeven, 2)}`, fill: chartCyan, fontSize: 10, position: 'insideTopLeft' }}
                    />
                    {/* Current spot */}
                    <ReferenceLine
                      x={parseFloat(spotInput)}
                      stroke={chartTextColor}
                      strokeDasharray="3 3"
                      strokeWidth={1}
                      label={{ value: `S $${parseFloat(spotInput).toFixed(2)}`, fill: chartTextColor, fontSize: 10, position: 'insideTopRight' }}
                    />

                    {/* Fill areas — green above 0, red below 0 */}
                    <Area dataKey="pnl_pos" baseValue={0} stroke="none" fill="url(#areaGreenGrad)" fillOpacity={1} isAnimationActive={false} />
                    <Area dataKey="pnl_neg" baseValue={0} stroke="none" fill="url(#areaRedGrad)"   fillOpacity={1} isAnimationActive={false} />

                    {/* Main P&L line — bicolor via gradient */}
                    <Line
                      dataKey="pnl"
                      type="monotone"
                      dot={false}
                      strokeWidth={2.5}
                      stroke="url(#pnlLineGrad)"
                      isAnimationActive={false}
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
                title: 'Hypothèses du modèle',
                lines: ['Exercice européen uniquement', 'Vol implicite constante (pas de smile)', 'Taux sans risque continu et constant', 'Pas de dividendes', 'Rendements log-normaux'],
              },
              {
                title: 'Conventions des Greeks',
                lines: ['Delta : Δ$ par +$1 spot', 'Gamma : Δdelta par +$1 spot', 'Theta : $/jour calendaire', 'Vega : $ par +1% de vol (σ)', 'Rho : $ par +1% de taux (r)'],
              },
              {
                title: 'Solveur IV (Newton-Raphson)',
                lines: ['σ initial : 30%', 'σ_n+1 = σ_n − (BS(σ_n) − prix) / ν(σ_n)', 'Repli bissection si divergence', 'Tolérance : 10⁻⁶', 'Bornes : [0.01 %, 2000 %]'],
              },
            ].map(card => (
              <div key={card.title} className="bg-terminal-surface border border-terminal-border rounded-xl p-4">
                <h3 className="text-xs font-semibold text-terminal-textMuted uppercase tracking-wider mb-3">{card.title}</h3>
                <ul className="space-y-1.5">
                  {card.lines.map(l => (
                    <li key={l} className="text-xs text-terminal-textDim flex items-start gap-2">
                      <span className="mt-0.5 shrink-0">·</span>{l}
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
