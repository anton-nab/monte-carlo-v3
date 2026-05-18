/**
 * /markets — Live Market Dashboard (formerly /)
 *
 * Ticker tape · Indices · Movers · News · Macro · Module nav
 */

import { useEffect, useState, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { MacroIndicator } from '@/components/MacroIndicator';
import { apiFetch } from '@/lib/api';
import { useWebSocket, lookupPrice } from '@/hooks/useWebSocket';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TapeItem {
  ticker: string;
  label:  string;
  price:  number;
  change_pct: number;
}

interface Mover {
  ticker:     string;
  price:      number;
  change_pct: number;
}

interface NewsItem {
  title:     string;
  publisher: string;
  link:      string;
  published: string;
}

interface MarketData {
  tape:    TapeItem[];
  indices: TapeItem[];
  gainers: Mover[];
  losers:  Mover[];
  news:    NewsItem[];
  cached_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtPrice = (v: number) => {
  if (v >= 10_000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 1_000)  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (v >= 100)    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1)      return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return v.toFixed(6);
};

const clrPct = (pct: number) =>
  pct > 0 ? 'text-bull' : pct < 0 ? 'text-bear' : 'text-terminal-textMuted';

const signPct = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;

// ─────────────────────────────────────────────────────────────────────────────
// Ticker Tape
// ─────────────────────────────────────────────────────────────────────────────

function TickerTape({ items }: { items: TapeItem[] }) {
  if (!items.length) return null;
  const doubled = [...items, ...items];
  return (
    <div className="overflow-hidden bg-terminal-bg border-b border-terminal-border py-1.5 select-none">
      <div className="ticker-track">
        {doubled.map((item, i) => (
          <Link
            key={i}
            href={`/instrument/${encodeURIComponent(item.ticker)}`}
            className="inline-flex items-center gap-2 px-5 text-xs whitespace-nowrap border-r border-terminal-border last:border-0 hover:bg-terminal-surfaceHi transition-colors cursor-pointer"
          >
            <span className="text-terminal-textDim font-mono">{item.label}</span>
            <span className="num font-semibold text-terminal-text">{fmtPrice(item.price)}</span>
            <span className={`num font-semibold ${clrPct(item.change_pct)}`}>
              {signPct(item.change_pct)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Index card
// ─────────────────────────────────────────────────────────────────────────────

function IndexCard({ item }: { item: TapeItem }) {
  const up   = item.change_pct > 0;
  const down = item.change_pct < 0;
  return (
    <Link
      href={`/instrument/${encodeURIComponent(item.ticker)}`}
      className={`bg-terminal-surface border rounded-lg p-3 flex flex-col gap-1 transition hover:bg-terminal-surfaceHi cursor-pointer ${
        up ? 'border-bull-border hover:border-bull' : down ? 'border-bear-border hover:border-bear' : 'border-terminal-border hover:border-terminal-cyan'
      }`}
    >
      <div className="text-2xs text-terminal-textDim uppercase tracking-wider font-mono">
        {item.label}
      </div>
      <div className="num text-terminal-text font-semibold text-base leading-tight">
        {fmtPrice(item.price)}
      </div>
      <div className={`num text-sm font-bold ${clrPct(item.change_pct)}`}>
        {signPct(item.change_pct)}
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mover row
// ─────────────────────────────────────────────────────────────────────────────

function MoverRow({ mover, type }: { mover: Mover; type: 'gain' | 'loss' }) {
  return (
    <Link href={`/instrument/${mover.ticker}`}
      className="flex items-center justify-between px-3 py-2 hover:bg-terminal-surfaceHi transition rounded border border-transparent hover:border-terminal-border">
      <div className="flex items-center gap-3">
        <span className={`text-xs w-1.5 h-1.5 rounded-full ${type === 'gain' ? 'bg-bull' : 'bg-bear'}`} />
        <span className="font-mono font-semibold text-terminal-cyan text-sm">{mover.ticker}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="num text-xs text-terminal-textMuted">${fmtPrice(mover.price)}</span>
        <span className={`num text-sm font-bold min-w-[60px] text-right ${type === 'gain' ? 'text-bull' : 'text-bear'}`}>
          {signPct(mover.change_pct)}
        </span>
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// News card
// ─────────────────────────────────────────────────────────────────────────────

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <a href={item.link} target="_blank" rel="noopener noreferrer"
      className="block bg-terminal-surface border border-terminal-border rounded-lg p-3 hover:bg-terminal-surfaceHi hover:border-terminal-cyanDim transition group">
      <p className="text-sm text-terminal-text font-medium leading-snug group-hover:text-terminal-cyan transition line-clamp-3">
        {item.title}
      </p>
      <div className="flex items-center gap-2 mt-2 text-2xs text-terminal-textDim">
        <span className="font-semibold text-terminal-textMuted">{item.publisher}</span>
        {item.published && (
          <>
            <span>·</span>
            <span className="num">{item.published}</span>
          </>
        )}
      </div>
    </a>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Module quick-access cards
// ─────────────────────────────────────────────────────────────────────────────

const MODULES = [
  { href: '/simulate',  emoji: '∿',  title: 'Simulate',   desc: 'GBM · Merton · Heston · GARCH — calibration auto', color: '#ffa726' },
  { href: '/compare',   emoji: '⊕',  title: 'Compare',    desc: '4 modèles simultanés + stress géopolitique',        color: '#ce93d8' },
  { href: '/portfolio', emoji: '◈',  title: 'Portfolio',  desc: 'Markowitz · frontière efficiente · Monte Carlo',    color: '#81c784' },
  { href: '/backtest',  emoji: '↺',  title: 'Backtest',   desc: 'Rolling-window MC · Sharpe · VaR coverage',         color: '#00d9ff' },
  { href: '/calendar',  emoji: '▦',  title: 'Calendar',   desc: 'FOMC · ECB · BOE · BOJ · CPI · NFP · Dividendes',   color: '#ab47bc' },
  { href: '/screener',  emoji: '⊟',  title: 'Screener',   desc: 'S&P 500 live · secteur · exchange · momentum',      color: '#26c6da' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Macro config
// ─────────────────────────────────────────────────────────────────────────────

const MACRO_COUNTRIES = [
  {
    code: 'us', flag: '🇺🇸', name: 'United States',
    indicators: [
      { indicator: 'inflation',    title: 'Inflation (CPI)',    decimals: 2 },
      { indicator: 'unemployment', title: 'Unemployment',       decimals: 1 },
      { indicator: 'fed_rate',     title: 'Fed Funds Rate',     decimals: 2 },
      { indicator: 'gdp',          title: 'Real GDP Growth',    decimals: 2 },
      { indicator: 'yield_10y',    title: '10Y Treasury Yield', decimals: 3 },
    ],
  },
  {
    code: 'eu', flag: '🇪🇺', name: 'Eurozone',
    indicators: [
      { indicator: 'inflation',    title: 'Inflation (HICP)',   decimals: 2 },
      { indicator: 'unemployment', title: 'Unemployment',       decimals: 1 },
      { indicator: 'ecb_rate',     title: 'ECB Deposit Rate',   decimals: 2 },
      { indicator: 'gdp',          title: 'Real GDP',           decimals: 0 },
      { indicator: 'bund_10y',     title: 'Bund 10Y Yield',     decimals: 3 },
    ],
  },
  {
    code: 'gb', flag: '🇬🇧', name: 'United Kingdom',
    indicators: [
      { indicator: 'inflation',    title: 'Inflation (CPI)',    decimals: 2 },
      { indicator: 'unemployment', title: 'Unemployment',       decimals: 1 },
      { indicator: 'gdp',          title: 'Real GDP',           decimals: 0 },
      { indicator: 'gilt_10y',     title: 'Gilt 10Y Yield',     decimals: 3 },
    ],
  },
  {
    code: 'jp', flag: '🇯🇵', name: 'Japan',
    indicators: [
      { indicator: 'inflation',    title: 'Inflation (CPI)',    decimals: 2 },
      { indicator: 'unemployment', title: 'Unemployment',       decimals: 1 },
      { indicator: 'gdp',          title: 'Real GDP',           decimals: 0 },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-terminal-surface rounded ${className ?? ''}`} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

const TAPE_WS_SYMBOLS = [
  '^GSPC', '^NDX', '^DJI', '^VIX', '^RUT', '^FTSE', '^N225',
  'GC=F', 'CL=F', 'BTC-USD', 'ETH-USD', 'EURUSD=X', '^TNX',
  'AAPL', 'NVDA', 'MSFT',
];

export default function MarketsPage() {
  const [data,       setData]       = useState<MarketData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  const { prices: liveWs } = useWebSocket(TAPE_WS_SYMBOLS);

  const liveTape = useMemo(() => {
    if (!data?.tape) return [];
    return data.tape.map(item => {
      const live = lookupPrice(liveWs, item.ticker);
      return live ? { ...item, price: live.price } : item;
    });
  }, [data?.tape, liveWs]);

  const liveIndices = useMemo(() => {
    if (!data?.indices) return [];
    return data.indices.map(item => {
      const live = lookupPrice(liveWs, item.ticker);
      return live ? { ...item, price: live.price } : item;
    });
  }, [data?.indices, liveWs]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<MarketData>('/api/home/market')
      .then((d) => { if (!cancelled) { setData(d); setLastUpdate(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur de chargement'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    const interval = setInterval(() => {
      apiFetch<MarketData>('/api/home/market').then((d) => {
        if (!cancelled) { setData(d); setLastUpdate(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })); }
      }).catch(() => {});
    }, 5 * 60 * 1000);

    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <>
      <Head>
        <title>Markets — Monte Carlo v3</title>
      </Head>

      <Header />

      {liveTape.length > 0 ? (
        <TickerTape items={liveTape} />
      ) : data?.tape ? (
        <TickerTape items={data.tape} />
      ) : (
        <div className="h-8 bg-terminal-bg border-b border-terminal-border animate-pulse" />
      )}

      <main className="max-w-7xl mx-auto px-4 py-5 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold text-terminal-text">
              Marchés <span className="text-terminal-cyan">·</span> Actualités
            </h1>
            <p className="text-xs text-terminal-textDim mt-0.5">
              Twelve Data · prix en temps réel · snapshot 5 min
            </p>
          </div>
          {lastUpdate && (
            <div className="flex items-center gap-2 text-xs text-terminal-textDim num">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-bull animate-pulse" />
              Mis à jour {lastUpdate}
            </div>
          )}
          {error && (
            <div className="text-xs text-bear bg-bear bg-opacity-10 border border-bear border-opacity-30 rounded px-3 py-1.5">
              ⚠ {error}
            </div>
          )}
        </div>

        {/* Indices */}
        <section>
          <h2 className="text-2xs uppercase tracking-widest text-terminal-textDim mb-2">Marchés mondiaux</h2>
          {loading ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
              {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
              {(liveIndices.length > 0 ? liveIndices : data?.indices ?? []).map((item) => (
                <IndexCard key={item.ticker} item={item} />
              ))}
            </div>
          )}
        </section>

        {/* Movers + News */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
            <h2 className="text-2xs uppercase tracking-widest text-terminal-textDim mb-3 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-bull" />
              Meilleures performances
            </h2>
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : data?.gainers?.length ? (
              <div className="space-y-1">{data.gainers.map((m) => <MoverRow key={m.ticker} mover={m} type="gain" />)}</div>
            ) : (
              <p className="text-xs text-terminal-textDim">Marché fermé ou données indisponibles</p>
            )}
          </div>

          <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
            <h2 className="text-2xs uppercase tracking-widest text-terminal-textDim mb-3 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-bear" />
              Plus fortes baisses
            </h2>
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : data?.losers?.length ? (
              <div className="space-y-1">{data.losers.map((m) => <MoverRow key={m.ticker} mover={m} type="loss" />)}</div>
            ) : (
              <p className="text-xs text-terminal-textDim">Données indisponibles</p>
            )}
          </div>

          <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
            <h2 className="text-2xs uppercase tracking-widest text-terminal-textDim mb-3">Actualités financières</h2>
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
            ) : data?.news?.length ? (
              <div className="space-y-2">{data.news.slice(0, 5).map((item, i) => <NewsCard key={i} item={item} />)}</div>
            ) : (
              <p className="text-xs text-terminal-textDim">Actualités indisponibles</p>
            )}
          </div>
        </div>

        {!loading && data?.news && data.news.length > 5 && (
          <section>
            <h2 className="text-2xs uppercase tracking-widest text-terminal-textDim mb-3">Plus d'actualités</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {data.news.slice(5, 9).map((item, i) => <NewsCard key={i} item={item} />)}
            </div>
          </section>
        )}

        {/* Macro */}
        <section>
          <h2 className="text-2xs uppercase tracking-widest text-terminal-textDim mb-4">
            Global Macro — FRED · BCE · OCDE
          </h2>
          <div className="space-y-5">
            {MACRO_COUNTRIES.map((country) => (
              <div key={country.code}>
                <h3 className="text-xs font-semibold text-terminal-textMuted mb-2 flex items-center gap-2">
                  <span>{country.flag}</span>
                  <span>{country.name}</span>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {country.indicators.map((cfg) => (
                    <MacroIndicator
                      key={`${country.code}-${cfg.indicator}`}
                      country={country.code}
                      indicator={cfg.indicator}
                      title={cfg.title}
                      decimals={cfg.decimals}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Modules */}
        <section>
          <h2 className="text-2xs uppercase tracking-widest text-terminal-textDim mb-3">Modules d'analyse</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {MODULES.map((m) => (
              <Link key={m.href} href={m.href}
                className="bg-terminal-surface border border-terminal-border rounded-lg p-3 hover:bg-terminal-surfaceHi hover:border-terminal-cyanDim transition group block">
                <div className="flex items-start justify-between mb-2">
                  <span className="text-xl">{m.emoji}</span>
                  <span className="text-2xs font-semibold" style={{ color: m.color }}>● Live</span>
                </div>
                <div className="font-semibold text-sm text-terminal-text group-hover:text-terminal-cyan transition">
                  {m.title} →
                </div>
                <p className="text-2xs text-terminal-textMuted mt-1 leading-snug">{m.desc}</p>
              </Link>
            ))}
          </div>
        </section>

      </main>

      <footer className="border-t border-terminal-border mt-8 px-4 py-3 text-center text-2xs text-terminal-textDim num">
        Monte Carlo v3 · FastAPI + Next.js · Twelve Data · FMP · FRED API
      </footer>
    </>
  );
}
