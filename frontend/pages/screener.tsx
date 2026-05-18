/**
 * /screener — Stock Screener (Phase 11)
 *
 * Universe: S&P 500 (~503 stocks) from GitHub CSV.
 * Live data: Twelve Data bulk quotes (price, change%, volume, exchange).
 * Filters: sector + exchange (from CSV, instant).
 */

import { useState, useCallback, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Header } from '@/components/Header';
import { apiFetch } from '@/lib/api';
import { useWatchlist } from '@/hooks/useWatchlist';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Stock {
  ticker:     string;
  name:       string;
  price:      number | null;
  change_pct: number | null;
  volume:     number;
  exchange:   string;
  sector:     string;
}

interface ScreenerResponse {
  count:    number;
  universe: string;
  filters:  Record<string, unknown>;
  stocks:   Stock[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SECTORS = [
  'Technology', 'Healthcare', 'Financials', 'Consumer Cyclical',
  'Consumer Defensive', 'Energy', 'Industrials', 'Basic Materials',
  'Communication Services', 'Real Estate', 'Utilities',
];

const EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX'];

const SORT_OPTIONS = [
  { value: 'change_pct', label: 'Variation %' },
  { value: 'volume',     label: 'Volume'       },
  { value: 'price',      label: 'Prix'         },
  { value: 'ticker',     label: 'Ticker'       },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function changeTone(v: number | null): string {
  if (v === null) return 'text-terminal-textMuted';
  return v >= 0 ? 'text-bull' : 'text-bear';
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Pill({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-full border transition whitespace-nowrap ${
        active
          ? 'border-terminal-cyan text-terminal-cyan bg-terminal-cyan/10 font-medium'
          : 'border-terminal-border text-terminal-textMuted hover:border-terminal-textMuted hover:text-terminal-text'
      }`}
    >
      {label}
    </button>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-terminal-border/40">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-3 py-2.5">
          <div
            className="h-3.5 rounded bg-terminal-border/50 animate-pulse"
            style={{ width: `${40 + (i % 4) * 15}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function ScreenerPage() {
  const router = useRouter();
  const { toggle, isWatched } = useWatchlist();

  // ── Filters ───────────────────────────────────────────────────────────────
  const [sector,   setSector]   = useState('');
  const [exchange, setExchange] = useState('');
  const [sortBy,   setSortBy]   = useState('change_pct');
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>('desc');
  const [limit,    setLimit]    = useState(50);

  // ── Data ──────────────────────────────────────────────────────────────────
  const [data,    setData]    = useState<ScreenerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchScreener = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (sector)   params.set('sector',   sector);
    if (exchange) params.set('exchange', exchange);
    params.set('sort_by',  sortBy);
    params.set('sort_dir', sortDir);
    params.set('limit',    String(limit));

    try {
      const res = await apiFetch<ScreenerResponse>(`/api/screener?${params}`);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur réseau');
    } finally {
      setLoading(false);
    }
  }, [sector, exchange, sortBy, sortDir, limit]);

  useEffect(() => { fetchScreener(); }, [fetchScreener]);

  // ── Sort toggle ───────────────────────────────────────────────────────────
  function handleSort(field: string) {
    if (field === sortBy) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  }

  function SortIcon({ field }: { field: string }) {
    if (field !== sortBy) return <span className="text-terminal-border ml-0.5">↕</span>;
    return <span className="text-terminal-cyan ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  const stocks = data?.stocks ?? [];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Screener — Monte Carlo v3</title>
      </Head>
      <Header />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">

        {/* ── Title ───────────────────────────────────────────────────── */}
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-2xl text-terminal-text">Stock Screener</h1>
          {data && !loading && (
            <span className="text-xs text-terminal-textMuted font-mono">
              {data.count} résultats · {data.universe ?? 'S&P 500'}
            </span>
          )}
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4 space-y-3">

          {/* Sector */}
          <div className="space-y-1.5">
            <span className="text-xs text-terminal-textMuted font-mono uppercase tracking-wide">Secteur</span>
            <div className="flex flex-wrap gap-1.5">
              <Pill label="Tous" active={sector === ''} onClick={() => setSector('')} />
              {SECTORS.map(s => (
                <Pill key={s} label={s} active={sector === s}
                  onClick={() => setSector(s === sector ? '' : s)} />
              ))}
            </div>
          </div>

          {/* Exchange + Sort + Limit */}
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3 pt-1 border-t border-terminal-border/50">

            {/* Exchange */}
            <div className="space-y-1.5">
              <span className="text-xs text-terminal-textMuted font-mono uppercase tracking-wide">Bourse</span>
              <div className="flex gap-1.5">
                <Pill label="Toutes" active={exchange === ''} onClick={() => setExchange('')} />
                {EXCHANGES.map(e => (
                  <Pill key={e} label={e} active={exchange === e}
                    onClick={() => setExchange(e === exchange ? '' : e)} />
                ))}
              </div>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-terminal-textMuted font-mono">Trier par</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="text-xs bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-terminal-text focus:outline-none focus:border-terminal-cyan"
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                className="text-xs px-2 py-1 border border-terminal-border rounded text-terminal-textMuted hover:text-terminal-text transition"
              >
                {sortDir === 'desc' ? '↓ Desc' : '↑ Asc'}
              </button>
            </div>

            {/* Limit */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-terminal-textMuted font-mono">Résultats</span>
              {[50, 100, 200].map(n => (
                <Pill key={n} label={String(n)} active={limit === n} onClick={() => setLimit(n)} />
              ))}
            </div>
          </div>
        </div>

        {/* ── Error ────────────────────────────────────────────────────── */}
        {error && (
          <div className="bg-bear/10 border border-bear/40 rounded-lg p-3 text-sm text-bear">
            {error}
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────────── */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-terminal-border bg-terminal-bg/60">
                  {[
                    { field: 'ticker',     label: 'Ticker'    },
                    { field: 'name',       label: 'Nom'       },
                    { field: 'price',      label: 'Prix'      },
                    { field: 'change_pct', label: 'Var. %'    },
                    { field: 'sector',     label: 'Secteur'   },
                    { field: 'exchange',   label: 'Bourse'    },
                    { field: 'volume',     label: 'Volume'    },
                    { field: '',           label: '☆'         },
                    { field: '',           label: 'Actions'   },
                  ].map(col => (
                    <th
                      key={col.field}
                      onClick={col.field ? () => handleSort(col.field) : undefined}
                      className={`px-3 py-2 text-left text-xs font-medium text-terminal-textMuted uppercase tracking-wide whitespace-nowrap ${
                        col.field ? 'cursor-pointer hover:text-terminal-text select-none' : ''
                      }`}
                    >
                      {col.label}
                      {col.field && <SortIcon field={col.field} />}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {loading
                  ? Array.from({ length: 12 }).map((_, i) => <SkeletonRow key={i} />)
                  : stocks.length === 0
                  ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-terminal-textMuted text-sm">
                        Aucun résultat pour ces filtres.
                      </td>
                    </tr>
                  )
                  : stocks.map(s => (
                    <tr key={s.ticker}
                      className="border-b border-terminal-border/40 hover:bg-terminal-surfaceHi transition-colors group"
                    >
                      {/* Ticker */}
                      <td className="px-3 py-2.5">
                        <Link href={`/instrument/${s.ticker}`}
                          className="font-mono font-semibold text-terminal-cyan hover:underline text-xs">
                          {s.ticker}
                        </Link>
                      </td>

                      {/* Name */}
                      <td className="px-3 py-2.5 max-w-[200px]">
                        <span className="truncate block text-terminal-text text-xs" title={s.name}>
                          {s.name}
                        </span>
                      </td>

                      {/* Price */}
                      <td className="px-3 py-2.5 font-mono text-xs text-terminal-text text-right whitespace-nowrap">
                        {s.price !== null ? `$${s.price.toFixed(2)}` : '—'}
                      </td>

                      {/* Change % */}
                      <td className={`px-3 py-2.5 font-mono text-xs text-right whitespace-nowrap font-medium ${changeTone(s.change_pct)}`}>
                        {s.change_pct !== null
                          ? `${s.change_pct >= 0 ? '+' : ''}${s.change_pct.toFixed(2)}%`
                          : '—'}
                      </td>

                      {/* Sector */}
                      <td className="px-3 py-2.5 text-xs text-terminal-textMuted whitespace-nowrap">
                        {s.sector || '—'}
                      </td>

                      {/* Exchange */}
                      <td className="px-3 py-2.5 text-xs text-terminal-textMuted font-mono">
                        {s.exchange || '—'}
                      </td>

                      {/* Volume */}
                      <td className="px-3 py-2.5 font-mono text-xs text-terminal-textMuted text-right whitespace-nowrap">
                        {fmtVol(s.volume)}
                      </td>

                      {/* Watchlist toggle */}
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => toggle(s.ticker, s.name)}
                          title={isWatched(s.ticker) ? 'Retirer de la watchlist' : 'Ajouter à la watchlist'}
                          className={`text-sm transition ${
                            isWatched(s.ticker)
                              ? 'text-terminal-cyan'
                              : 'text-terminal-textMuted hover:text-terminal-cyan'
                          }`}
                        >
                          {isWatched(s.ticker) ? '★' : '☆'}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => router.push(`/simulate?ticker=${encodeURIComponent(s.ticker)}`)}
                            title="Simuler"
                            className="px-1.5 py-0.5 text-[10px] border border-terminal-border rounded hover:border-terminal-cyan hover:text-terminal-cyan text-terminal-textMuted transition"
                          >∿</button>
                          <Link href={`/instrument/${s.ticker}`} title="Fiche"
                            className="px-1.5 py-0.5 text-[10px] border border-terminal-border rounded hover:border-terminal-cyan hover:text-terminal-cyan text-terminal-textMuted transition">
                            ↗
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          {data && !loading && (
            <div className="px-4 py-2 border-t border-terminal-border/40 text-xs text-terminal-textMuted font-mono bg-terminal-bg/40 flex items-center justify-between">
              <span>{data.count} actions · univers {data.universe ?? 'S&P 500'}</span>
              <span>Source: Twelve Data · cache 12h</span>
            </div>
          )}
        </div>

      </main>
    </>
  );
}
