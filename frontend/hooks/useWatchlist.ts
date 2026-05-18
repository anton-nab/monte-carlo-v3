/**
 * hooks/useWatchlist.ts
 * ─────────────────────
 * Persists a list of tracked tickers in localStorage.
 * Works without a backend — pure client-side.
 *
 * Usage:
 *   const { items, add, remove, isWatched } = useWatchlist();
 *   add('AAPL', 'Apple Inc.')   → adds to list
 *   remove('AAPL')              → removes from list
 *   isWatched('AAPL')           → true / false
 */

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'mc3_watchlist_v1';

export interface WatchlistItem {
  ticker: string;
  name:   string;
}

export function useWatchlist() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  /** true once the localStorage read on mount is done */
  const [ready, setReady] = useState(false);

  // Hydrate from localStorage (client-side only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw) as WatchlistItem[]);
    } catch {
      // Ignore corrupted / SSR
    }
    setReady(true);
  }, []);

  const _write = (next: WatchlistItem[]) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  };

  /** Add a ticker. If already present, silently ignored. */
  const add = useCallback((ticker: string, name = '') => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setItems(prev => {
      if (prev.some(i => i.ticker === t)) return prev;
      const next = [...prev, { ticker: t, name: name.trim() || t }];
      _write(next);
      return next;
    });
  }, []);

  /** Remove a ticker. */
  const remove = useCallback((ticker: string) => {
    const t = ticker.trim().toUpperCase();
    setItems(prev => {
      const next = prev.filter(i => i.ticker !== t);
      _write(next);
      return next;
    });
  }, []);

  /** Returns true if ticker is already in the watchlist. */
  const isWatched = useCallback(
    (ticker: string) => items.some(i => i.ticker === ticker.trim().toUpperCase()),
    [items],
  );

  /** Toggle: add if absent, remove if present. */
  const toggle = useCallback((ticker: string, name = '') => {
    const t = ticker.trim().toUpperCase();
    setItems(prev => {
      const exists = prev.some(i => i.ticker === t);
      const next = exists
        ? prev.filter(i => i.ticker !== t)
        : [...prev, { ticker: t, name: name.trim() || t }];
      _write(next);
      return next;
    });
  }, []);

  return { items, add, remove, toggle, isWatched, ready };
}
