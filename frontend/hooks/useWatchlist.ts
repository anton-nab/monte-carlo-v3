/**
 * hooks/useWatchlist.ts
 * ──────────────────────
 * Session-aware watchlist hook.
 *
 * - Authenticated   → persists in PostgreSQL via /api/saves/watchlist
 * - Unauthenticated → falls back to localStorage (exact previous behavior)
 * - On sign-in      → auto-migrates localStorage items to the DB
 *
 * Interface is identical to the previous localStorage-only version
 * so all consumers (WatchlistButton, watchlist.tsx) work without changes.
 *
 * Usage:
 *   const { items, add, remove, isWatched, toggle, ready } = useWatchlist();
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';

const STORAGE_KEY = 'mc3_watchlist_v1';

export interface WatchlistItem {
  ticker: string;
  name:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage helpers (used when not signed in)
// ─────────────────────────────────────────────────────────────────────────────

function lsRead(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WatchlistItem[]) : [];
  } catch { return []; }
}

function lsWrite(items: WatchlistItem[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {}
}

function lsClear() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers (Next.js API routes)
// ─────────────────────────────────────────────────────────────────────────────

async function dbFetch(): Promise<WatchlistItem[]> {
  const r = await fetch('/api/saves/watchlist');
  if (!r.ok) return [];
  const data = await r.json();
  return data.items ?? [];
}

async function dbAdd(ticker: string, name: string): Promise<void> {
  await fetch('/api/saves/watchlist', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ticker, name }),
  });
}

async function dbRemove(ticker: string): Promise<void> {
  await fetch(`/api/saves/watchlist?ticker=${encodeURIComponent(ticker)}`, {
    method: 'DELETE',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useWatchlist() {
  const { status } = useSession();
  const isAuth  = status === 'authenticated';
  const isGuest = status === 'unauthenticated';

  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [ready, setReady] = useState(false);

  // Track whether we already migrated for this session
  const migrated = useRef(false);

  // ── Load on mount / auth status change ─────────────────────────────────────
  useEffect(() => {
    if (status === 'loading') return;

    if (isAuth) {
      // Authenticated: load from DB
      dbFetch().then(async (dbItems) => {
        // Migrate localStorage items that aren't in DB yet
        if (!migrated.current) {
          migrated.current = true;
          const localItems = lsRead();
          const dbTickers  = new Set(dbItems.map(i => i.ticker));
          const toMigrate  = localItems.filter(i => !dbTickers.has(i.ticker));
          if (toMigrate.length > 0) {
            await Promise.all(toMigrate.map(i => dbAdd(i.ticker, i.name)));
            lsClear(); // clear localStorage after successful migration
            const merged = [...dbItems, ...toMigrate];
            setItems(merged);
          } else {
            lsClear();
            setItems(dbItems);
          }
        } else {
          setItems(dbItems);
        }
        setReady(true);
      }).catch(() => setReady(true));
    } else if (isGuest) {
      // Not signed in: use localStorage
      setItems(lsRead());
      setReady(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ── Add ────────────────────────────────────────────────────────────────────
  const add = useCallback((ticker: string, name = '') => {
    const t = ticker.trim().toUpperCase();
    const n = name.trim() || t;
    if (!t) return;

    setItems(prev => {
      if (prev.some(i => i.ticker === t)) return prev;
      const next = [...prev, { ticker: t, name: n }];
      if (isAuth) {
        dbAdd(t, n).catch(console.error);
      } else {
        lsWrite(next);
      }
      return next;
    });
  }, [isAuth]);

  // ── Remove ─────────────────────────────────────────────────────────────────
  const remove = useCallback((ticker: string) => {
    const t = ticker.trim().toUpperCase();
    setItems(prev => {
      const next = prev.filter(i => i.ticker !== t);
      if (isAuth) {
        dbRemove(t).catch(console.error);
      } else {
        lsWrite(next);
      }
      return next;
    });
  }, [isAuth]);

  // ── Toggle ─────────────────────────────────────────────────────────────────
  const toggle = useCallback((ticker: string, name = '') => {
    const t = ticker.trim().toUpperCase();
    const n = name.trim() || t;
    setItems(prev => {
      const exists = prev.some(i => i.ticker === t);
      const next   = exists
        ? prev.filter(i => i.ticker !== t)
        : [...prev, { ticker: t, name: n }];
      if (isAuth) {
        if (exists) dbRemove(t).catch(console.error);
        else        dbAdd(t, n).catch(console.error);
      } else {
        lsWrite(next);
      }
      return next;
    });
  }, [isAuth]);

  // ── isWatched ──────────────────────────────────────────────────────────────
  const isWatched = useCallback(
    (ticker: string) => items.some(i => i.ticker === ticker.trim().toUpperCase()),
    [items],
  );

  return { items, add, remove, toggle, isWatched, ready };
}
