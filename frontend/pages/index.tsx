/**
 * / — Landing Page (Phase 15)
 *
 * Portfolio showcase. Fully static — no API calls.
 * Dark hero (always dark regardless of theme) + theme-aware sections below.
 */

import Head from 'next/head';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

const GITHUB = 'https://github.com/anton-nab/monte-carlo-v3';

// ─────────────────────────────────────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────────────────────────────────────

const STATS = [
  { value: '4',    label: 'Stochastic models'  },
  { value: '500+', label: 'S&P 500 stocks'     },
  { value: 'Live', label: 'WebSocket feed'     },
  { value: '12',   label: 'API endpoints'      },
];

const FEATURES = [
  {
    href: '/simulate',
    icon: '∿',
    title: 'Monte Carlo Simulation',
    desc: '4 stochastic models (GBM, Merton Jump-Diffusion, Heston Stochastic Vol, GARCH) auto-calibrated from live price history. VaR 95/99, CVaR, max drawdown, P5/P50/P95 fan chart.',
    tags: ['GBM', 'Heston', 'GARCH', 'Merton'],
    color: '#ffa726',
    border: 'hover:border-[#ffa726]/40',
  },
  {
    href: '/compare',
    icon: '⊕',
    title: 'Multi-Model Comparison',
    desc: 'Run all 4 models simultaneously with a coupled seed — divergence shows model dynamics, not noise. Stress sliders for vol shocks, geopolitical risk and crash scenarios. 6 presets.',
    tags: ['Stress Tests', 'Consensus Fan', 'Model Spread'],
    color: '#ce93d8',
    border: 'hover:border-[#ce93d8]/40',
  },
  {
    href: '/portfolio',
    icon: '◈',
    title: 'Portfolio Optimizer',
    desc: 'Markowitz efficient frontier across up to 15 assets. Correlated Monte Carlo via Cholesky decomposition. Sharpe/Sortino optimization. Correlation heatmap.',
    tags: ['Markowitz', 'Cholesky', 'Efficient Frontier'],
    color: '#81c784',
    border: 'hover:border-[#81c784]/40',
  },
  {
    href: '/backtest',
    icon: '↺',
    title: 'Backtesting Engine',
    desc: 'Rolling-window walk-forward validation. Historical stress scenario replays. Sharpe, Sortino and max drawdown analysis across arbitrary date ranges.',
    tags: ['Walk-Forward', 'VaR Coverage', 'Drawdown'],
    color: '#00d9ff',
    border: 'hover:border-[#00d9ff]/40',
  },
  {
    href: '/calendar',
    icon: '▦',
    title: 'Economic Calendar',
    desc: 'FOMC, ECB, BOE, BOJ, SNB, RBA, BOC central bank decisions + CPI, NFP, GDP, PMI events. Ex-dividend dates for S&P 500 payers. Each event maps to affected equities and forex pairs.',
    tags: ['Central Banks', 'Macro Events', 'Dividends'],
    color: '#ab47bc',
    border: 'hover:border-[#ab47bc]/40',
  },
  {
    href: '/screener',
    icon: '⊟',
    title: 'Stock Screener',
    desc: 'Full S&P 500 universe with live Twelve Data bulk quotes. Filter by sector and exchange in real-time. Sort by momentum, volume, or price.',
    tags: ['S&P 500', 'Live Quotes', 'Sector Filter'],
    color: '#26c6da',
    border: 'hover:border-[#26c6da]/40',
  },
];

const STACK = [
  { label: 'FastAPI',         sub: 'Python async backend'  },
  { label: 'Next.js 14',      sub: 'React + SSR'           },
  { label: 'TypeScript',      sub: 'Full type safety'      },
  { label: 'Tailwind CSS',    sub: 'Design system'         },
  { label: 'Twelve Data',     sub: 'Live market data'      },
  { label: 'FMP API',         sub: 'Fundamentals & history'},
  { label: 'FRED API',        sub: 'Macro indicators'      },
  { label: 'WebSocket',       sub: 'Real-time prices'      },
  { label: 'LWC Charts',      sub: 'TradingView engine'    },
  { label: 'NumPy / SciPy',   sub: 'Quant models'         },
  { label: 'Railway',         sub: 'API deployment'        },
  { label: 'Vercel',          sub: 'Frontend CDN'          },
];

// ─────────────────────────────────────────────────────────────────────────────
// Hero chart — candlesticks + Monte Carlo fan (decorative, deterministic)
// ─────────────────────────────────────────────────────────────────────────────

// Candle data: SVG y-axis (lower y = higher price). bull = c < o.
const CANDLES = [
  { x:  20, o: 288, c: 274, h: 270, l: 292 },
  { x:  48, o: 274, c: 281, h: 270, l: 284 },
  { x:  76, o: 281, c: 266, h: 263, l: 284 },
  { x: 104, o: 266, c: 273, h: 263, l: 277 },
  { x: 132, o: 273, c: 258, h: 254, l: 276 },
  { x: 160, o: 258, c: 265, h: 254, l: 269 },
  { x: 188, o: 265, c: 249, h: 245, l: 268 },
  { x: 216, o: 249, c: 257, h: 245, l: 260 },
  { x: 244, o: 257, c: 241, h: 238, l: 260 },
  { x: 272, o: 241, c: 249, h: 238, l: 252 },
  { x: 300, o: 249, c: 232, h: 229, l: 252 },
  { x: 328, o: 232, c: 220, h: 217, l: 235 },
  { x: 356, o: 220, c: 214, h: 211, l: 223 },
];

// Deterministic pseudo-random MC trajectories (no runtime randomness = SSR safe)
function genMCPaths(): string[] {
  const xs = [385, 437, 495, 555, 615, 675, 735, 795, 855, 915, 975, 1035, 1095, 1155, 1200];
  const result: string[] = [];
  let s = 0x9e3779b9;
  const rng = () => {
    s = ((s ^ (s >>> 16)) * 0x45d9f3b) | 0;
    s = ((s ^ (s >>> 16)) * 0x45d9f3b) | 0;
    return ((s >>> 0) / 0x100000000);
  };
  for (let i = 0; i < 30; i++) {
    const drift = -2.6 + (i / 29) * 5.8; // strong bull → strong bear
    const vol = 4 + rng() * 9;
    let y = 214;
    const pts = [`${xs[0]},${Math.round(y)}`];
    for (let j = 1; j < xs.length; j++) {
      y += drift * 2.6 + (rng() - 0.5) * vol;
      y = Math.max(38, Math.min(388, y));
      pts.push(`${xs[j]},${Math.round(y)}`);
    }
    result.push(pts.join(' '));
  }
  return result;
}

const MC_PATHS = genMCPaths();

function HeroChart() {
  const closeLine = CANDLES.map(c => `${c.x + 7},${c.c}`).join(' ');
  const histArea  = `${CANDLES[0].x + 7},420 ` + closeLine + ` ${CANDLES[CANDLES.length - 1].x + 7},420`;

  return (
    <svg
      viewBox="0 0 1200 420"
      className="absolute inset-0 w-full h-full pointer-events-none"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.18)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient id="fanGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="transparent" />
          <stop offset="50%"  stopColor="rgba(0,217,255,0.05)" />
          <stop offset="100%" stopColor="rgba(0,217,255,0.13)" />
        </linearGradient>
      </defs>

      {/* ── Grid lines ───────────────────────────────────────────── */}
      {[80, 160, 240, 320, 400].map(y => (
        <line key={y} x1="0" y1={y} x2="1200" y2={y}
          stroke="rgba(42,48,64,0.85)" strokeWidth="1" strokeDasharray="3 14" />
      ))}

      {/* ── Historical area fill (under close line) ────────────── */}
      <polygon points={histArea} fill="url(#histGrad)" opacity="0.14" />

      {/* ── Close-price connector ───────────────────────────────── */}
      <polyline points={closeLine}
        fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.2"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* ── Candlestick bars ────────────────────────────────────── */}
      {CANDLES.map((c, i) => {
        const bull  = c.c < c.o;
        const color = bull ? '#4ade80' : '#f87171';
        const bodyY = Math.min(c.o, c.c);
        const bodyH = Math.max(2, Math.abs(c.o - c.c));
        return (
          <g key={i} opacity="0.72">
            {/* Wick */}
            <line x1={c.x + 7} y1={c.h} x2={c.x + 7} y2={c.l}
              stroke={color} strokeWidth="1.2" />
            {/* Body */}
            <rect x={c.x} y={bodyY} width="14" height={bodyH}
              fill={color} rx="1.5" />
          </g>
        );
      })}

      {/* ── "TODAY" separator ───────────────────────────────────── */}
      <line x1="385" y1="8" x2="385" y2="412"
        stroke="rgba(255,255,255,0.16)" strokeWidth="1"
        strokeDasharray="4 8" />
      <text x="390" y="24"
        fill="rgba(255,255,255,0.25)" fontSize="9"
        fontFamily="monospace" letterSpacing="1.5">TODAY</text>

      {/* ── MC background trajectories (30 paths, staggered) ────── */}
      {MC_PATHS.map((pts, i) => {
        const isBull = i < 9;
        const isBear = i > 20;
        const color  = isBull ? '#34d399' : isBear ? '#f87171' : '#6b7280';
        const op     = isBull ? (i < 3 ? 0.28 : 0.15) : isBear ? (i > 27 ? 0.28 : 0.14) : 0.1;
        return (
          <polyline key={i} points={pts} fill="none"
            stroke={color} strokeWidth="0.75" opacity={op}
            strokeLinejoin="round"
            style={{
              strokeDasharray: 2000,
              strokeDashoffset: 2000,
              animation: `draw-chart ${2.4 + i * 0.04}s ease-out ${0.4 + i * 0.04}s forwards`,
            }}
          />
        );
      })}

      {/* ── Fan area P5–P95 ─────────────────────────────────────── */}
      <path
        d="M 385,214 C 590,192 870,148 1200,88 L 1200,336 C 870,310 590,272 385,214 Z"
        fill="url(#fanGrad)"
      />

      {/* ── P95 ─────────────────────────────────────────────────── */}
      <path d="M 385,214 C 580,192 870,145 1200,88"
        fill="none" stroke="#00d9ff" strokeWidth="2.2" opacity="0.85"
        strokeLinecap="round"
        style={{ strokeDasharray: 1100, strokeDashoffset: 1100,
          animation: 'draw-chart 2.2s ease-out 1.3s forwards' }} />

      {/* ── P50 ─────────────────────────────────────────────────── */}
      <path d="M 385,214 C 640,208 920,200 1200,194"
        fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2.6" opacity="0.9"
        strokeLinecap="round"
        style={{ strokeDasharray: 960, strokeDashoffset: 960,
          animation: 'draw-chart 2.2s ease-out 1.5s forwards' }} />

      {/* ── P5 ──────────────────────────────────────────────────── */}
      <path d="M 385,214 C 580,232 870,295 1200,336"
        fill="none" stroke="#f87171" strokeWidth="2.2" opacity="0.8"
        strokeLinecap="round"
        style={{ strokeDasharray: 1100, strokeDashoffset: 1100,
          animation: 'draw-chart 2.2s ease-out 1.4s forwards' }} />

      {/* ── Percentile labels ───────────────────────────────────── */}
      <text x="1150" y="80"  fill="#00d9ff" fontSize="9.5" fontFamily="monospace" opacity="0.7">P95</text>
      <text x="1150" y="188" fill="rgba(255,255,255,0.7)" fontSize="9.5" fontFamily="monospace">P50</text>
      <text x="1150" y="330" fill="#f87171" fontSize="9.5" fontFamily="monospace" opacity="0.7">P5</text>

      {/* ── Origin dot (TODAY anchor) ────────────────────────────── */}
      <circle cx="385" cy="214" r="4" fill="#00d9ff" opacity="0.95" />
      <circle cx="385" cy="214" r="9" fill="none"
        stroke="#00d9ff" strokeWidth="1" opacity="0.35" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Landing page
// ─────────────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <>
      <Head>
        <title>Monte Carlo — Equity Analysis Platform</title>
        <meta name="description" content="Professional-grade equity analysis platform. Monte Carlo simulations, portfolio optimization, live market data, technical indicators and macro dashboard." />
        <meta property="og:title"       content="Monte Carlo — Equity Analysis Platform" />
        <meta property="og:description" content="4 stochastic models · Markowitz optimizer · Live WebSocket prices · S&P 500 screener · Economic calendar" />
        <meta property="og:type"        content="website" />
      </Head>

      {/* ── Top nav (always dark) ────────────────────────────────────── */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/10 bg-[#0a0e1a]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-5 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold"
              style={{ background: '#b92e25' }}>
              MC
            </span>
            <span className="font-serif text-[15px] text-white">Monte Carlo</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a
              href={GITHUB}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs text-white/55 hover:text-white/90 px-3 py-1.5 rounded border border-white/15 hover:border-white/35 transition"
            >
              GitHub ↗
            </a>
            <Link
              href="/markets"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded transition"
              style={{ background: '#b92e25', color: 'white' }}
            >
              Launch App →
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero (always dark) ───────────────────────────────────────── */}
      <section
        className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-14"
        style={{ background: '#0a0e1a' }}
      >
        {/* CSS grid background */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgba(42,48,64,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(42,48,64,0.55) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />

        {/* Radial fade — dims grid toward center */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 90% 70% at 50% 50%, transparent 10%, #0a0e1a 75%)',
          }}
        />

        {/* Animated chart lines */}
        <div className="absolute inset-0 opacity-20">
          <HeroChart />
        </div>

        {/* Content */}
        <div
          className="relative z-10 text-center px-6 max-w-4xl mx-auto"
          style={{ animation: 'fade-up 0.8s ease-out 0.1s both' }}
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full border mb-8 text-xs font-mono"
            style={{ borderColor: 'rgba(0,217,255,0.3)', background: 'rgba(0,217,255,0.08)', color: '#00d9ff' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#00d9ff' }} />
            Full-Stack Financial Analytics Platform
          </div>

          {/* Main title */}
          <h1 className="font-serif text-6xl sm:text-7xl md:text-8xl mb-4 tracking-tight"
            style={{ color: 'white' }}>
            Monte Carlo
          </h1>

          {/* Tagline */}
          <p className="text-lg sm:text-xl md:text-2xl mb-5 font-light"
            style={{ color: 'rgba(255,255,255,0.55)' }}>
            Equity analysis, simulation &amp; portfolio optimization
          </p>

          {/* Description */}
          <p className="text-sm leading-relaxed max-w-2xl mx-auto mb-10"
            style={{ color: 'rgba(255,255,255,0.35)' }}>
            Professional-grade financial platform built with FastAPI + Next.js 14.
            Monte Carlo simulations across 4 stochastic models, Markowitz efficient frontier,
            WebSocket live prices, TradingView charts with RSI/MACD, and a macro dashboard
            for US, EU, UK &amp; JP markets.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-4 mb-14">
            <Link
              href="/markets"
              className="inline-flex items-center gap-2 px-8 py-3 rounded-lg text-sm font-semibold text-white transition-all hover:scale-[1.03] hover:brightness-110"
              style={{ background: '#b92e25' }}
            >
              Launch Platform
              <span className="text-base">→</span>
            </Link>
            <a
              href={GITHUB}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-3 rounded-lg text-sm transition-all"
              style={{ border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.6)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.4)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.9)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.2)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'; }}
            >
              View on GitHub
              <span className="text-base">↗</span>
            </a>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-lg mx-auto">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-bold font-mono" style={{ color: 'white' }}>{s.value}</div>
                <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scroll indicator */}
        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce"
          style={{ color: 'rgba(255,255,255,0.25)' }}
        >
          ↓
        </div>
      </section>

      {/* ── Features (theme-aware) ───────────────────────────────────── */}
      <section className="bg-terminal-bg py-24 px-6">
        <div className="max-w-6xl mx-auto">

          <div className="text-center mb-14">
            <h2 className="font-serif text-3xl text-terminal-text mb-3">Platform Modules</h2>
            <p className="text-sm text-terminal-textMuted max-w-xl mx-auto">
              Each module is powered by real market data — Twelve Data, FMP and FRED APIs.
              No mock data, no static fixtures.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <Link
                key={f.href}
                href={f.href}
                className={`group bg-terminal-surface border border-terminal-border rounded-xl p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${f.border}`}
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="text-3xl font-mono leading-none" style={{ color: f.color }}>
                    {f.icon}
                  </span>
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full border opacity-60"
                    style={{ color: f.color, borderColor: f.color }}
                  >
                    {f.tags[0]}
                  </span>
                </div>

                <h3 className="font-semibold text-terminal-text group-hover:text-terminal-cyan transition text-[15px] mb-2">
                  {f.title} →
                </h3>

                <p className="text-xs text-terminal-textMuted leading-relaxed mb-4">
                  {f.desc}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {f.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] font-mono px-2 py-0.5 rounded border border-terminal-border text-terminal-textDim"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stack (theme-aware) ──────────────────────────────────────── */}
      <section className="bg-terminal-surface border-y border-terminal-border py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-center text-xs font-mono text-terminal-textMuted uppercase tracking-[0.2em] mb-10">
            Built with
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            {STACK.map((s) => (
              <div
                key={s.label}
                className="px-4 py-2.5 rounded-lg border border-terminal-border bg-terminal-bg hover:border-terminal-cyanDim transition-colors"
              >
                <div className="text-sm font-medium text-terminal-text">{s.label}</div>
                <div className="text-[10px] text-terminal-textDim mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer (always dark) ─────────────────────────────────────── */}
      <footer
        className="py-10 px-6 text-center"
        style={{ background: '#0a0e1a' }}
      >
        <div className="flex items-center justify-center gap-2 mb-3">
          <span className="w-6 h-6 rounded flex items-center justify-center text-white text-[10px] font-bold"
            style={{ background: '#b92e25' }}>
            MC
          </span>
          <span className="font-serif text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>Monte Carlo</span>
        </div>
        <p className="text-xs font-mono mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>
          FastAPI + Next.js 14 · Deployed on Railway + Vercel
        </p>
        <a
          href={GITHUB}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono transition"
          style={{ color: 'rgba(255,255,255,0.3)' }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)')}
        >
          github.com/anton-nab/monte-carlo-v3 ↗
        </a>
      </footer>
    </>
  );
}
