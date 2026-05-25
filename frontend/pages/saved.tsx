/**
 * /saved — Mes analyses sauvegardées (Phase 8)
 *
 * Deux onglets :
 *   Simulations — liste des simulations Monte Carlo sauvegardées
 *   Portfolios  — liste des portefeuilles Markowitz sauvegardés
 *
 * Accessible via UserMenu → "Mes analyses".
 * Redirige vers GitHub login si non connecté.
 */

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession, signIn } from 'next-auth/react';
import { Header } from '../components/Header';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SavedSimulation {
  id:         number;
  name:       string;
  ticker:     string;
  model:      string;
  params:     {
    period?:       string;
    horizon_days?: number;
    n_sims?:       number;
    mu_override?:  number | null;
    sigma_override?: number | null;
  };
  summary:    {
    S0?:         number;
    metrics?:    Record<string, number>;
    calibration?: Record<string, unknown>;
  };
  created_at: string;
}

interface SavedPortfolio {
  id:         number;
  name:       string;
  tickers:    string[];
  params:     {
    period?:             string;
    n_sims?:             number;
    initial_investment?: number;
    risk_free_rate?:     number;
  };
  summary:    {
    optimal_sharpe?: { sharpe?: number; return?: number; volatility?: number };
    min_volatility?: { sharpe?: number; return?: number; volatility?: number };
    metrics?:        Record<string, number>;
  };
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (v: number | undefined, d = 2) =>
  v !== undefined ? v.toFixed(d) : '—';

const fmtPct = (v: number | undefined, d = 1) =>
  v !== undefined ? `${(v * 100).toFixed(d)}%` : '—';

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-lg p-10 text-center">
      <div className="text-4xl mb-3 opacity-20 select-none">📂</div>
      <p className="text-sm text-terminal-textMuted">
        Aucune {label} sauvegardée.
      </p>
      <p className="text-xs text-terminal-textDim mt-1">
        Lance une analyse et clique sur{' '}
        <strong className="text-terminal-text">💾 Enregistrer</strong>.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation card
// ─────────────────────────────────────────────────────────────────────────────

function SimCard({ item, onDelete }: { item: SavedSimulation; onDelete: (id: number) => void }) {
  const router = useRouter();
  const m = item.summary.metrics ?? {};

  const rerun = () => {
    const p = item.params;
    const q = new URLSearchParams({
      ticker: item.ticker,
      model:  item.model,
      ...(p.period       ? { period:       p.period }                : {}),
      ...(p.horizon_days ? { horizon_days: String(p.horizon_days) }  : {}),
      ...(p.n_sims       ? { n_sims:       String(p.n_sims) }        : {}),
    });
    router.push(`/simulate?${q.toString()}`);
  };

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-terminal-text truncate">{item.name}</p>
          <p className="text-xs text-terminal-textDim mt-0.5">{fmtDate(item.created_at)}</p>
        </div>
        <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-mono font-semibold
                         bg-terminal-bg border border-terminal-border text-terminal-cyan">
          {item.model.toUpperCase()}
        </span>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-terminal-bg rounded p-2">
          <div className="text-terminal-textDim uppercase tracking-wide text-[9px]">VaR 95%</div>
          <div className="num font-semibold text-bear mt-0.5">{fmtPct(m.var_95)}</div>
        </div>
        <div className="bg-terminal-bg rounded p-2">
          <div className="text-terminal-textDim uppercase tracking-wide text-[9px]">P(perte)</div>
          <div className="num font-semibold mt-0.5">{fmtPct(m.prob_loss)}</div>
        </div>
        <div className="bg-terminal-bg rounded p-2">
          <div className="text-terminal-textDim uppercase tracking-wide text-[9px]">Max DD</div>
          <div className="num font-semibold text-warn mt-0.5">{fmtPct(m.max_drawdown)}</div>
        </div>
      </div>

      {/* Params summary */}
      <div className="flex flex-wrap gap-1">
        {item.params.period && (
          <span className="text-[10px] bg-terminal-bg border border-terminal-border rounded px-1.5 py-0.5
                           text-terminal-textDim font-mono">
            {item.params.period.toUpperCase()}
          </span>
        )}
        {item.params.horizon_days && (
          <span className="text-[10px] bg-terminal-bg border border-terminal-border rounded px-1.5 py-0.5
                           text-terminal-textDim font-mono">
            {item.params.horizon_days}j
          </span>
        )}
        {item.params.n_sims && (
          <span className="text-[10px] bg-terminal-bg border border-terminal-border rounded px-1.5 py-0.5
                           text-terminal-textDim font-mono">
            {item.params.n_sims.toLocaleString()} sims
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={rerun}
          className="flex-1 px-3 py-1.5 rounded text-xs font-semibold
                     bg-terminal-cyan text-terminal-bg hover:opacity-90 transition"
        >
          ▶ Relancer
        </button>
        <Link
          href={`/instrument/${item.ticker}`}
          className="px-3 py-1.5 rounded text-xs font-semibold border border-terminal-border
                     text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan transition"
        >
          Fiche
        </Link>
        <button
          onClick={() => onDelete(item.id)}
          className="px-3 py-1.5 rounded text-xs border border-bear/40
                     text-bear/70 hover:text-bear hover:border-bear transition"
          title="Supprimer"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio card
// ─────────────────────────────────────────────────────────────────────────────

function PortCard({ item, onDelete }: { item: SavedPortfolio; onDelete: (id: number) => void }) {
  const router = useRouter();
  const opt = item.summary.optimal_sharpe ?? {};

  const rerun = () => {
    const p = item.params;
    const q = new URLSearchParams({
      tickers: item.tickers.join(','),
      ...(p.period ? { period: p.period } : {}),
      ...(p.n_sims ? { n_sims: String(p.n_sims) } : {}),
    });
    router.push(`/portfolio?${q.toString()}`);
  };

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4 flex flex-col gap-3">
      {/* Header */}
      <div>
        <p className="text-sm font-semibold text-terminal-text truncate">{item.name}</p>
        <p className="text-xs text-terminal-textDim mt-0.5">{fmtDate(item.created_at)}</p>
      </div>

      {/* Tickers */}
      <div className="flex flex-wrap gap-1">
        {item.tickers.map(t => (
          <span key={t}
            className="text-[10px] bg-terminal-bg border border-terminal-border rounded px-1.5 py-0.5
                       text-terminal-cyan font-mono">
            {t}
          </span>
        ))}
      </div>

      {/* Optimal Sharpe metrics */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-terminal-bg rounded p-2">
          <div className="text-terminal-textDim uppercase tracking-wide text-[9px]">Sharpe</div>
          <div className="num font-semibold text-bull mt-0.5">{fmt(opt.sharpe)}</div>
        </div>
        <div className="bg-terminal-bg rounded p-2">
          <div className="text-terminal-textDim uppercase tracking-wide text-[9px]">Retour</div>
          <div className="num font-semibold mt-0.5">{fmtPct(opt.return)}</div>
        </div>
        <div className="bg-terminal-bg rounded p-2">
          <div className="text-terminal-textDim uppercase tracking-wide text-[9px]">Vol.</div>
          <div className="num font-semibold text-warn mt-0.5">{fmtPct(opt.volatility)}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={rerun}
          className="flex-1 px-3 py-1.5 rounded text-xs font-semibold
                     bg-terminal-cyan text-terminal-bg hover:opacity-90 transition"
        >
          ▶ Relancer
        </button>
        <button
          onClick={() => onDelete(item.id)}
          className="px-3 py-1.5 rounded text-xs border border-bear/40
                     text-bear/70 hover:text-bear hover:border-bear transition"
          title="Supprimer"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'simulations' | 'portfolios';

export default function SavedPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>('simulations');

  const [sims,      setSims]      = useState<SavedSimulation[]>([]);
  const [ports,     setPorts]     = useState<SavedPortfolio[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  // ── Fetch saved items ───────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'authenticated') return;
    setLoading(true);
    Promise.all([
      fetch('/api/saves/simulations').then(r => r.json()),
      fetch('/api/saves/portfolios').then(r => r.json()),
    ]).then(([s, p]) => {
      setSims(s.items  ?? []);
      setPorts(p.items ?? []);
    }).catch(() => {
      setError('Erreur lors du chargement des données.');
    }).finally(() => setLoading(false));
  }, [status]);

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteSim = useCallback(async (id: number) => {
    await fetch(`/api/saves/simulations?id=${id}`, { method: 'DELETE' });
    setSims(prev => prev.filter(s => s.id !== id));
  }, []);

  const deletePort = useCallback(async (id: number) => {
    await fetch(`/api/saves/portfolios?id=${id}`, { method: 'DELETE' });
    setPorts(prev => prev.filter(p => p.id !== id));
  }, []);

  // ── Not authenticated ───────────────────────────────────────────────────────
  if (status === 'unauthenticated') {
    return (
      <>
        <Head><title>Mes analyses — Monte Carlo</title></Head>
        <div className="min-h-screen bg-terminal-bg text-terminal-text">
          <Header />
          <main className="max-w-3xl mx-auto px-4 py-20 text-center">
            <div className="text-5xl mb-4 opacity-20 select-none">🔒</div>
            <h1 className="text-xl font-semibold mb-2">Connexion requise</h1>
            <p className="text-sm text-terminal-textMuted mb-6">
              Connecte-toi avec GitHub pour accéder à tes analyses sauvegardées.
            </p>
            <button
              onClick={() => signIn('github')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded text-sm font-semibold
                         bg-terminal-cyan text-terminal-bg hover:opacity-90 transition"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483
                         0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466
                         -1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53
                         2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951
                         0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026
                         A9.564 9.564 0 0112 6.844a9.59 9.59 0 012.504.337c1.909-1.296 2.747-1.027 2.747
                         -1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339
                         4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0
                         .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              Se connecter avec GitHub
            </button>
          </main>
        </div>
      </>
    );
  }

  return (
    <>
      <Head><title>Mes analyses — Monte Carlo</title></Head>
      <div className="min-h-screen bg-terminal-bg text-terminal-text">
        <Header />

        <main className="max-w-7xl mx-auto px-4 py-6 space-y-5">

          {/* Title */}
          <div>
            <h1 className="text-xl font-semibold">Mes analyses</h1>
            <p className="text-sm text-terminal-textMuted mt-0.5">
              {session?.user?.name && (
                <span className="text-terminal-cyan">{session.user.name}</span>
              )}{' '}— simulations et portefeuilles sauvegardés
            </p>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-terminal-border">
            {(['simulations', 'portfolios'] as Tab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? 'border-terminal-cyan text-terminal-cyan'
                    : 'border-transparent text-terminal-textMuted hover:text-terminal-text'
                }`}
              >
                {tab === 'simulations'
                  ? `Simulations${sims.length ? ` (${sims.length})` : ''}`
                  : `Portfolios${ports.length ? ` (${ports.length})` : ''}`}
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-bear-bg border border-bear-border rounded-lg px-4 py-3 text-sm text-bear">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-terminal-surface border border-terminal-border rounded-lg p-4 h-40 animate-pulse" />
              ))}
            </div>
          )}

          {/* Simulations tab */}
          {!loading && activeTab === 'simulations' && (
            sims.length === 0
              ? <EmptyState label="simulation" />
              : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sims.map(s => (
                    <SimCard key={s.id} item={s} onDelete={deleteSim} />
                  ))}
                </div>
              )
          )}

          {/* Portfolios tab */}
          {!loading && activeTab === 'portfolios' && (
            ports.length === 0
              ? <EmptyState label="portfolio" />
              : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {ports.map(p => (
                    <PortCard key={p.id} item={p} onDelete={deletePort} />
                  ))}
                </div>
              )
          )}

        </main>
      </div>
    </>
  );
}
