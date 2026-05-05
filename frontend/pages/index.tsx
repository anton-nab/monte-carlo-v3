/**
 * Home / landing page — Phase 1.5 redesign.
 *
 * Style trading desk: header global avec search bar, status backend en haut,
 * quick links vers les modules disponibles + roadmap visible.
 */

import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

import { Header } from '@/components/Header';
import { apiFetch, ApiError } from '@/lib/api';

interface ApiHealth {
  status: 'checking' | 'connected' | 'disconnected';
  message: string;
  version?: string;
}

interface PhaseInfo {
  num: string;
  name: string;
  status: 'done' | 'next' | 'planned';
  href?: string;
  description: string;
}

const PHASES: PhaseInfo[] = [
  { num: '0', name: 'Foundation', status: 'done', description: 'Cloud deployment, Vercel + Railway' },
  { num: '1', name: 'Global Macro', status: 'done', href: '/dashboard', description: '17 indicators × 4 countries via FRED' },
  { num: '1.5', name: 'Polish v1', status: 'next', description: 'Terminal palette, monospace, click-to-expand (current)' },
  { num: '2', name: 'Instruments', status: 'planned', description: 'yfinance, search by ticker/name/ISIN, fundamentals' },
  { num: '2.5', name: 'Index/ETF decomposition', status: 'planned', description: '25+ indices: S&P, CAC, DAX, Nikkei… + ETFs' },
  { num: '2.7', name: 'Discovery feed', status: 'planned', description: 'Trending stocks/ETFs/bonds, "what\'s hot today"' },
  { num: '3', name: 'Monte Carlo intégré', status: 'planned', description: 'GBM/Heston/Merton/GARCH on any instrument' },
  { num: '3.5', name: 'Sentiment', status: 'planned', description: 'Fear & Greed, FOMO, analyst, insider, short interest' },
  { num: '4', name: 'Bonds & yield curves', status: 'planned', description: 'Sovereign + corporate bonds globally' },
  { num: '5', name: 'Theses & probabilities', status: 'planned', description: 'Editorial CMS, recession proba, backtests' },
  { num: '6', name: 'Bloomberg polish', status: 'planned', description: 'Multi-pane layout, watchlists, alerts, dark terminal' },
];

export default function Home() {
  const [health, setHealth] = useState<ApiHealth>({
    status: 'checking',
    message: 'Checking API connection…',
  });

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ status: string; version: string }>('/health')
      .then((data) => {
        if (cancelled) return;
        setHealth({
          status: 'connected',
          message: 'Online',
          version: data.version,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setHealth({
          status: 'disconnected',
          message: err instanceof ApiError ? `API ${err.status}` : 'Cannot reach API',
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const statusColor =
    health.status === 'connected'
      ? 'bg-bull text-terminal-bg'
      : health.status === 'checking'
      ? 'bg-warn text-terminal-bg'
      : 'bg-bear text-white';

  return (
    <>
      <Head>
        <title>Monte Carlo v3 — Bloomberg-lite global terminal</title>
      </Head>

      <Header />

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Hero */}
        <section className="mb-10">
          <div className="flex items-baseline gap-3 mb-2">
            <h1 className="text-3xl font-bold text-terminal-text">Monte Carlo v3</h1>
            <span className="text-2xs uppercase tracking-wider text-terminal-textDim num">
              Phase 1.5 / 11
            </span>
          </div>
          <p className="text-terminal-textMuted">
            Bloomberg-lite global terminal — macro, instruments, simulations, sentiment, all in one place.
          </p>

          {/* API status pill */}
          <div className="mt-4 inline-flex items-center gap-2 text-xs">
            <span className="text-terminal-textDim uppercase tracking-wider">API:</span>
            <span className={`px-2 py-0.5 rounded text-2xs font-semibold uppercase ${statusColor} num`}>
              ● {health.message}
            </span>
            {health.version && (
              <span className="text-terminal-textDim num">v{health.version}</span>
            )}
          </div>
        </section>

        {/* Quick links — modules disponibles */}
        <section className="mb-10">
          <h2 className="text-xs uppercase tracking-wider text-terminal-textDim mb-3">
            Available modules
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ModuleCard
              href="/dashboard"
              emoji="📊"
              title="Macro Dashboard"
              description="17 indicators × 4 countries"
              enabled
            />
            <ModuleCard
              href="#"
              emoji="🔥"
              title="Discover"
              description="Trending stocks, ETFs, bonds"
              badge="Phase 2.7"
              enabled={false}
            />
            <ModuleCard
              href="#"
              emoji="📈"
              title="Instruments"
              description="Stocks, ETFs, bonds, FX, crypto"
              badge="Phase 2"
              enabled={false}
            />
          </div>
        </section>

        {/* Roadmap */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-terminal-textDim mb-3">
            Roadmap
          </h2>
          <div className="card-terminal divide-y divide-terminal-border">
            {PHASES.map((p) => (
              <div
                key={p.num}
                className="px-4 py-3 flex items-center gap-4 hover:bg-terminal-surfaceHi transition"
              >
                <span className="num text-terminal-textDim text-sm w-12 shrink-0">P{p.num}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {p.href && p.status === 'done' ? (
                      <Link href={p.href} className="text-terminal-text hover:text-terminal-cyan font-medium">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="text-terminal-text font-medium">{p.name}</span>
                    )}
                    <PhaseBadge status={p.status} />
                  </div>
                  <p className="text-xs text-terminal-textMuted mt-0.5">{p.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-terminal-border mt-12 px-4 py-4 text-center text-2xs text-terminal-textDim num">
        Monte Carlo v3 · Built with FastAPI + Next.js · Free-tier APIs (FRED, OECD, yfinance, OpenFIGI…)
      </footer>
    </>
  );
}

interface ModuleCardProps {
  href: string;
  emoji: string;
  title: string;
  description: string;
  enabled: boolean;
  badge?: string;
}

function ModuleCard({ href, emoji, title, description, enabled, badge }: ModuleCardProps) {
  if (!enabled) {
    return (
      <div className="card-terminal p-4 opacity-60 cursor-not-allowed">
        <div className="flex items-start justify-between mb-2">
          <span className="text-2xl">{emoji}</span>
          {badge && (
            <span className="text-2xs uppercase tracking-wider text-terminal-textDim border border-terminal-border rounded px-1.5 py-0.5 num">
              {badge}
            </span>
          )}
        </div>
        <h3 className="font-medium text-terminal-text">{title}</h3>
        <p className="text-xs text-terminal-textMuted mt-1">{description}</p>
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="card-terminal p-4 cursor-pointer block group"
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-2xl">{emoji}</span>
        <span className="text-bull text-2xs uppercase tracking-wider num">● Live</span>
      </div>
      <h3 className="font-medium text-terminal-text group-hover:text-terminal-cyan transition">
        {title} →
      </h3>
      <p className="text-xs text-terminal-textMuted mt-1">{description}</p>
    </Link>
  );
}

function PhaseBadge({ status }: { status: PhaseInfo['status'] }) {
  if (status === 'done') {
    return (
      <span className="text-2xs uppercase tracking-wider px-1.5 py-0.5 rounded bg-bull-bg text-bull border border-bull-border num">
        ✓ Done
      </span>
    );
  }
  if (status === 'next') {
    return (
      <span className="text-2xs uppercase tracking-wider px-1.5 py-0.5 rounded bg-terminal-cyan/15 text-terminal-cyan border border-terminal-cyan/40 num">
        ◆ In progress
      </span>
    );
  }
  return (
    <span className="text-2xs uppercase tracking-wider px-1.5 py-0.5 rounded text-terminal-textDim border border-terminal-border num">
      Planned
    </span>
  );
}
