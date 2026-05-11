/**
 * hooks/useWebSocket.ts
 * ─────────────────────
 * Custom hook for real-time price streaming via the backend WebSocket.
 *
 * Connects to /ws/quotes, subscribes to a list of tickers, and returns
 * live prices + connection status.
 *
 * Auto-reconnects with exponential back-off (1 s → 30 s).
 *
 * Usage:
 *   const { prices, connected } = useWebSocket(['AAPL', 'BTC-USD'])
 *   prices['AAPL']    → { symbol: 'AAPL', price: 150.25, timestamp: '...' }
 *   prices['BTC/USD'] → { symbol: 'BTC/USD', price: 65000, timestamp: '...' }
 *   connected         → true when the WS handshake is open
 *
 * Note on asset coverage (free Twelve Data plan):
 *   WS streams live prices only for US equities.
 *   Crypto, forex, commodities and indices require a paid WS plan.
 *   → `connected` will be true but `prices` empty for those assets.
 *   → Use lookupPrice() to bridge yfinance ↔ TD symbol formats.
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

export interface WsHookResult {
  /** Live price map keyed by Twelve Data symbol (e.g. 'AAPL', 'BTC/USD') */
  prices:    PriceMap;
  /** True when the WebSocket connection is open (but may not be streaming data) */
  connected: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;
const WS_READY_OPEN     = 1;

function buildWsUrl(): string {
  const api = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000')
    .replace(/\/$/, '');
  return api.replace(/^http/, 'ws') + '/ws/quotes';
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useWebSocket(symbols: string[]): WsHookResult {
  const [prices,    setPrices]    = useState<PriceMap>({});
  const [connected, setConnected] = useState(false);

  const wsRef      = useRef<WebSocket | null>(null);
  const symbolsRef = useRef<string[]>(symbols);
  const backoffRef = useRef(RECONNECT_BASE_MS);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const WS_URL     = useRef(buildWsUrl()).current;

  // Keep symbols ref current without re-creating connect()
  useEffect(() => { symbolsRef.current = symbols; });

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WS_READY_OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = RECONNECT_BASE_MS;
      setConnected(true);
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
          const { symbol, price, timestamp } = msg as {
            type: string; symbol: string; price: number; timestamp: string;
          };
          setPrices(prev => ({ ...prev, [symbol]: { symbol, price, timestamp } }));

        } else if (msg.type === 'snapshot') {
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
      setConnected(false);
      if (!mountedRef.current) return;
      timerRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, RECONNECT_MAX_MS);
        connect();
      }, backoffRef.current);
    };

    ws.onerror = () => ws.close();
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

  return { prices, connected };
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

/**
 * Returns true for asset classes that Twelve Data does NOT stream via WebSocket
 * on the free plan (crypto, forex, commodities, indices).
 * These assets still get REST-polled prices but won't show a LIVE badge.
 */
export function isWsUnsupported(ticker: string): boolean {
  // Crypto
  if (ticker.endsWith('-USD') && ticker !== ticker.replace('-USD', '')) return true;
  // Forex
  if (ticker.endsWith('=X')) return true;
  // Commodities / futures
  if (ticker.endsWith('=F')) return true;
  // Indices (start with ^)
  if (ticker.startsWith('^')) return true;
  return false;
}
