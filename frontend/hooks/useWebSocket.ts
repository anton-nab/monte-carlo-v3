/**
 * hooks/useWebSocket.ts
 * ─────────────────────
 * Custom hook for real-time price streaming via the backend WebSocket.
 *
 * Connects to /ws/quotes, subscribes to a list of tickers, and returns
 * a live price map that updates in real time via Twelve Data.
 *
 * Auto-reconnects with exponential back-off (1 s → 30 s).
 *
 * Usage:
 *   const prices = useWebSocket(['AAPL', 'BTC-USD', '^GSPC'])
 *   prices['AAPL']       → { symbol: 'AAPL', price: 150.25, timestamp: '...' }
 *   prices['BTC/USD']    → { symbol: 'BTC/USD', price: 65000, timestamp: '...' }
 *
 * Note: TD symbols are returned in TD format (e.g. 'BTC/USD', 'SPX') even when
 * subscribed with yfinance-style tickers ('BTC-USD', '^GSPC'). The backend
 * translates on subscribe; the snapshot/price events use the TD symbol.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LivePrice {
  symbol:    string;
  price:     number;
  timestamp: string;
}

/** Map of TD symbol → latest price event */
export type PriceMap = Record<string, LivePrice>;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const RECONNECT_BASE_MS  = 1_000;
const RECONNECT_MAX_MS   = 30_000;
const WS_READY_OPEN      = 1; // WebSocket.OPEN

function buildWsUrl(): string {
  const api = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000')
    .replace(/\/$/, '');
  // http(s) → ws(s)
  return api.replace(/^http/, 'ws') + '/ws/quotes';
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useWebSocket(symbols: string[]): PriceMap {
  const [prices, setPrices] = useState<PriceMap>({});

  const wsRef      = useRef<WebSocket | null>(null);
  const symbolsRef = useRef<string[]>(symbols);
  const backoffRef = useRef(RECONNECT_BASE_MS);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const WS_URL     = useRef(buildWsUrl()).current;

  // Keep symbols ref current without re-creating connect()
  useEffect(() => {
    symbolsRef.current = symbols;
  });

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    // Don't stack connections
    if (wsRef.current?.readyState === WS_READY_OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = RECONNECT_BASE_MS;
      if (symbolsRef.current.length > 0) {
        ws.send(JSON.stringify({
          action:  'subscribe',
          symbols: symbolsRef.current,
        }));
      }
    };

    ws.onmessage = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(evt.data as string) as Record<string, unknown>;

        if (msg.type === 'price') {
          // Single price update
          const { symbol, price, timestamp } = msg as {
            type: string; symbol: string; price: number; timestamp: string;
          };
          setPrices(prev => ({
            ...prev,
            [symbol]: { symbol, price, timestamp },
          }));

        } else if (msg.type === 'snapshot') {
          // Bulk snapshot on connect/subscribe
          const snap = msg.prices as Record<string, LivePrice> | null;
          if (snap && typeof snap === 'object') {
            setPrices(prev => ({ ...prev, ...snap }));
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;
      timerRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, RECONNECT_MAX_MS);
        connect();
      }, backoffRef.current);
    };

    ws.onerror = () => ws.close(); // triggers onclose → retry
  }, [WS_URL]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-subscribe when symbol list changes while connected
  useEffect(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WS_READY_OPEN && symbols.length > 0) {
      ws.send(JSON.stringify({ action: 'subscribe', symbols }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')]);

  // Mount / unmount lifecycle
  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return prices;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: yfinance symbol → expected TD symbol key in PriceMap
// ─────────────────────────────────────────────────────────────────────────────

const YF_TO_TD: Record<string, string> = {
  '^GSPC':    'SPX',
  '^NDX':     'NDX',
  '^DJI':     'DJI',
  '^VIX':     'VIX',
  '^RUT':     'RUT2000',
  '^FTSE':    'FTSE100',
  '^N225':    'N225',
  '^TNX':     'US10Y',
  'GC=F':     'XAU/USD',
  'CL=F':     'WTI/USD',
  'BTC-USD':  'BTC/USD',
  'ETH-USD':  'ETH/USD',
  'EURUSD=X': 'EUR/USD',
  'GBPUSD=X': 'GBP/USD',
  'USDJPY=X': 'USD/JPY',
};

/**
 * Look up a live price from the PriceMap.
 * Accepts both yfinance-style tickers ('BTC-USD') and TD format ('BTC/USD').
 */
export function lookupPrice(
  prices: PriceMap,
  ticker: string,
): LivePrice | undefined {
  return prices[ticker] ?? prices[YF_TO_TD[ticker] ?? ticker];
}
