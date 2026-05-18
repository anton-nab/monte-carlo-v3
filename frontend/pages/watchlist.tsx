/**
 * /watchlist — Personal Watchlist (Phase 13)
 *
 * Tickers stored in localStorage (no auth needed).
 * Live prices via WebSocket (Twelve Data, US equities).
 * Batch REST quotes on mount for initial prices + names.
 */

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Header } from '@/components/Header';
import { apiFetch } from '@/lib/api';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useWebSocket, lookupPrice } from '@/hooks/useWebSocket';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface QuoteData {
  ticker:     string;
  price:      number;
  change:     number;
  change_pct: number;
  volume:     number;
  timestamp?: string;
  error?:     string;
}

interface SearchSuggestion {
  ticker: string;
  name:   string;
  type?:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v ? String(v) : '—';
}

function changeTone(v: number | null): string {
  if (v === null || v === undefined) return 'text-terminal-textMuted';
  return v >= 0 ? 'text-bull' : 'text-bear';
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton row
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-terminal-border/40">
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-3.5 rounded bg-terminal-border/50 animate-pulse"
               style={{ width: `${40 + (i % 4) * 15}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WatchlistButton — reusable star button for other pages
// ─────────────────────────────────────────────────────────────────────────────

export function WatchlistButton({
  ticker, name, size = 'md',
}: { ticker: string; name?: string; size?: 'sm' | 'md' }) {
  const { isWatched, toggle, ready } = useWatchlist();
  if (!ready) return null;
  const watched = isWatched(ticker);
  const cls = size === 'sm'
    ? 'px-1.5 py-0.5 text-[10px] border rounded transition'
    : 'px-2 py-1 text-xs border rounded transition';
  return (
    <button
      onClick={() => toggle(ticker, name)}
      title={watched ? 'Retirer de la watchlist' : 'Ajouter à la watchlist'}
      className={`${cls} ${
        watched
          ? 'border-terminal-cyan text-terminal-cyan bg-terminal-cyan/10'
          : 'border-terminal-border text-terminal-textMuted hover:border-terminal-cyan hover:text-terminal-cyan'
      }`}
    >
      {watched ? '★' : '☆'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function WatchlistPage() {
  const router = useRouter();
  const { items, add, remove, ready } = useWatchlist();

  // Quote data (REST, refreshed on mount and when list changes)
  const [quotes, setQuotes]       = useState<Record<string, QuoteData>>({});
  const [loadingQ, setLoadingQ]   = useState(false);

  // Add-ticker form
  const [addInput,  setAddInput]  = useState('');
  const [adding,    setAdding]    = useState(false);
  const [addError,  setAddError]  = useState('');

  // WebSocket for live prices
  const tickers = items.map(i => i.ticker);
  const { prices: livePrices, connected: wsConnected } = useWebSocket(tickers);

  // ── Fetch batch quotes ───────────────────────────────────────────────────
  const fetchQuotes = useCallback(async (tickerList: string[]) => {
    if (!tickerList.length) return;
    setLoadingQ(true);
    try {
      const data = await apiFetch<Record<string, QuoteData>>(
        '/api/instruments/batch-quotes',
        { method: 'POST', body: JSON.stringify(tickerList) },
      );
      setQuotes(prev => ({ ...prev, ...data }));
    } catch {
      // silently degrade
    } finally {
      setLoadingQ(false);
    }
  }, []);

  useEffect(() => {
    if (ready && tickers.length) fetchQuotes(tickers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tickers.join(',')]);

  // ── Effective price: WS first, REST fallback ─────────────────────────────
  function getPrice(ticker: string): number | null {
    const live = lookupPrice(livePrices, ticker);
    if (live?.price) return live.price;
    return quotes[ticker]?.price ?? null;
  }
  function getChangePct(ticker: string): number | null {
    return quotes[ticker]?.change_pct ?? null;
  }
  function getVolume(ticker: string): number {
    return quotes[ticker]?.volume ?? 0;
  }

  // ── Add a ticker ─────────────────────────────────────────────────────────
  const handleAdd = useCallback(async () => {
    const t = addInput.trim().toUpperCase();
    if (!t) return;
    if (items.some(i => i.ticker === t)) {
      setAddError(`${t} est déjà dans la watchlist.`);
      return;
    }
    setAdding(true);
    setAddError('');
    try {
      // Resolve name via autocomplete
      const res = await apiFetch<{ suggestions: SearchSuggestion[] }>(
        `/api/search/autocomplete?q=${encodeURIComponent(t)}&limit=3`,
      );
      const match = res.suggestions?.find(
        s => s.ticker.toUpperCase() === t,
      ) ?? res.suggestions?.[0];
      const name = match?.name ?? t;
      add(t, name);
      setAddInput('');
      // Pre-fetch quote for the new ticker
      fetchQuotes([t]);
    } catch {
      // Ticker might not exist in search, but add it anyway with ticker as name
      add(t, t);
      setAddInput('');
      fetchQuotes([t]);
    } finally {
      setAdding(false);
    }
  }, [addInput, items, add, fetchQuotes]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Watchlist — Monte Carlo</title>
      </Head>
      <Header />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">

        {/* ── Title + add form ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-2xl text-terminal-text">Watchlist</h1>
            <span className="text-xs text-terminal-textMuted font-mono">
              {items.length} titre{items.length !== 1 ? 's' : ''}
              {wsConnected && (
                <span className="ml-2 text-bull">● live</span>
              )}
            </span>
          </div>

          {/* Add input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={addInput}
              onChange={e => { setAddInput(e.target.value.toUpperCase()); setAddError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Ticker (ex: TSLA)"
              className="bg-terminal-bg border border-terminal-border rounded px-3 py-1.5 text-sm
                         text-terminal-text w-36 font-mono uppercase placeholder:normal-case
                         placeholder:text-terminal-textMuted focus:outline-none focus:border-terminal-cyan transition"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !addInput.trim()}
              className="px-3 py-1.5 text-sm rounded bg-terminal-cyan text-terminal-bg font-semibold
                         hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {adding ? '…' : '+ Ajouter'}
            </button>
            {addError && (
              <span className="text-xs text-bear">{addError}</span>
            )}
          </div>
        </div>

        {/* ── Empty state ──────────────────────────────────────────────── */}
        {ready && items.length === 0 && (
          <div className="bg-terminal-surface border border-terminal-border rounded-lg p-12
                          text-center text-terminal-textMuted">
            <div className="text-5xl mb-4 opacity-20 select-none">☆</div>
            <p className="text-sm mb-1">Votre watchlist est vide.</p>
            <p className="text-xs opacity-60">
              Ajoutez un ticker ci-dessus ou cliquez sur ☆ depuis le screener ou une fiche instrument.
            </p>
          </div>
        )}

        {/* ── Table ───────────────────────────────────────────────────── */}
        {items.length > 0 && (
          <div className="bg-terminal-surface border border-terminal-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-terminal-border bg-terminal-bg/60">
                    {['Ticker', 'Nom', 'Prix', 'Var. %', 'Volume', 'Actions'].map(h => (
                      <th key={h}
                          className="px-3 py-2 text-left text-xs font-medium text-terminal-textMuted
                                     uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!ready
                    ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
                    : items.map(item => {
                      const price     = getPrice(item.ticker);
                      const changePct = getChangePct(item.ticker);
                      const volume    = getVolume(item.ticker);
                      const isLive    = !!lookupPrice(livePrices, item.ticker);

                      return (
                        <tr key={item.ticker}
                            className="border-b border-terminal-border/40 hover:bg-terminal-surfaceHi
                                       transition-colors group">
                          {/* Ticker */}
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <Link href={`/instrument/${item.ticker}`}
                                    className="font-mono font-semibold text-terminal-cyan hover:underline text-xs">
                                {item.ticker}
                              </Link>
                              {isLive && (
                                <span className="text-[9px] text-bull font-mono">●</span>
                              )}
                            </div>
                          </td>

                          {/* Name */}
                          <td className="px-3 py-2.5 max-w-[200px]">
                            <span className="truncate block text-terminal-text text-xs"
                                  title={item.name}>
                              {item.name}
                            </span>
                          </td>

                          {/* Price */}
                          <td className="px-3 py-2.5 font-mono text-xs text-terminal-text text-right whitespace-nowrap">
                            {loadingQ && price === null
                              ? <span className="h-3 w-16 rounded bg-terminal-border/50 animate-pulse inline-block" />
                              : price !== null ? `$${price.toFixed(2)}` : '—'}
                          </td>

                          {/* Change % */}
                          <td className={`px-3 py-2.5 font-mono text-xs text-right whitespace-nowrap font-medium
                                         ${changeTone(changePct)}`}>
                            {changePct !== null
                              ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`
                              : '—'}
                          </td>

                          {/* Volume */}
                          <td className="px-3 py-2.5 font-mono text-xs text-terminal-textMuted text-right whitespace-nowrap">
                            {fmtVol(volume)}
                          </td>

                          {/* Actions */}
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => router.push(`/simulate?ticker=${encodeURIComponent(item.ticker)}`)}
                                title="Simuler"
                                className="px-1.5 py-0.5 text-[10px] border border-terminal-border rounded
                                           hover:border-terminal-cyan hover:text-terminal-cyan
                                           text-terminal-textMuted transition">
                                ∿
                              </button>
                              <Link href={`/instrument/${item.ticker}`} title="Fiche"
                                    className="px-1.5 py-0.5 text-[10px] border border-terminal-border rounded
                                               hover:border-terminal-cyan hover:text-terminal-cyan
                                               text-terminal-textMuted transition">
                                ↗
                              </Link>
                              <button
                                onClick={() => remove(item.ticker)}
                                title="Retirer de la watchlist"
                                className="px-1.5 py-0.5 text-[10px] border border-terminal-border rounded
                                           hover:border-bear/60 hover:text-bear
                                           text-terminal-textMuted transition">
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-terminal-border/40 text-xs text-terminal-textMuted
                            font-mono bg-terminal-bg/40 flex items-center justify-between">
              <span>
                {items.length} titre{items.length !== 1 ? 's' : ''} · sauvegardé localement
              </span>
              <span>
                {wsConnected
                  ? <span className="text-bull">● WebSocket connecté</span>
                  : 'Prix au dernier rafraîchissement'}
              </span>
            </div>
          </div>
        )}

        {/* ── Tip ─────────────────────────────────────────────────────── */}
        {ready && items.length > 0 && (
          <p className="text-xs text-terminal-textMuted">
            Astuce : cliquez sur ☆ dans le{' '}
            <Link href="/screener" className="text-terminal-cyan hover:underline">Screener</Link>
            {' '}ou sur une fiche instrument pour ajouter rapidement un titre.
          </p>
        )}

      </main>
    </>
  );
}
