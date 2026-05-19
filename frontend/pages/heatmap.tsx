/**
 * pages/heatmap.tsx — Phase 18
 * ─────────────────────────────
 * S&P 500 Market Heatmap — colored tiles grouped by sector.
 * Data from GET /api/heatmap (reuses FMP screener 12h cache).
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { API_BASE } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StockTile {
  ticker:     string;
  name:       string;
  change_pct: number | null;
  price:      number | null;
}

interface SectorData {
  name:       string;
  count:      number;
  avg_change: number | null;
  stocks:     StockTile[];
}

interface HeatmapResponse {
  total:   number;
  source:  string;
  as_of:   string;
  sectors: SectorData[];
}

// ── Color helpers ─────────────────────────────────────────────────────────────

/** Background color for a tile based on change_pct (-6% → +6% clamped). */
function heatBg(pct: number | null): string {
  if (pct == null) return 'rgba(30,32,44,0.85)';
  const v = Math.max(-6, Math.min(6, pct));
  if (v >= 0) {
    const t = v / 6;
    const r = Math.round(10 + 15 * (1 - t));
    const g = Math.round(50 + 120 * t);
    const b = Math.round(10 + 20 * (1 - t));
    return `rgba(${r},${g},${b},0.85)`;
  } else {
    const t = (-v) / 6;
    const r = Math.round(50 + 130 * t);
    const g = Math.round(10 + 15 * (1 - t));
    const b = Math.round(10 + 15 * (1 - t));
    return `rgba(${r},${g},${b},0.85)`;
  }
}

/** Sector badge / avg change color. */
function changeColor(pct: number | null): string {
  if (pct == null) return '#6b7280';
  if (pct > 0.1)  return '#4ade80';   // green-400
  if (pct < -0.1) return '#f87171';   // red-400
  return '#9ca3af';                    // gray-400
}

function fmt(pct: number | null): string {
  if (pct == null) return '—';
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HeatmapPage() {
  const [data,    setData]    = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/heatmap`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: HeatmapResponse) => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  return (
    <>
      <Head>
        <title>Market Heatmap — Monte Carlo</title>
        <meta name="description" content="S&P 500 market heatmap grouped by sector" />
      </Head>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Page header ─────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-2 justify-between">
          <div>
            <h1 className="text-2xl font-bold text-terminal-text">Market Heatmap</h1>
            <p className="text-sm text-terminal-textMuted mt-0.5">
              S&amp;P 500 · performance du jour par secteur
            </p>
          </div>
          {data && (
            <div className="text-xs text-terminal-textDim font-mono shrink-0">
              {data.total} titres · {data.source} · {data.as_of}
            </div>
          )}
        </div>

        {/* ── Legend ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-terminal-textDim">Variation :</span>
          {([-5, -3, -1, 0, 1, 3, 5] as const).map(v => (
            <span
              key={v}
              className="inline-flex items-center justify-center text-[10px] font-mono px-2 py-0.5 rounded"
              style={{ background: heatBg(v), color: v === 0 ? '#9ca3af' : v > 0 ? '#86efac' : '#fca5a5' }}
            >
              {v >= 0 ? '+' : ''}{v}%
            </span>
          ))}
        </div>

        {/* ── States ──────────────────────────────────────────────────── */}
        {loading && (
          <div className="flex items-center justify-center h-64 text-terminal-textMuted">
            <div className="text-center space-y-2">
              <div className="w-8 h-8 border-2 border-terminal-cyan border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm">Chargement du heatmap S&amp;P 500…</p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
            Erreur : {error}
          </div>
        )}

        {/* ── Sectors ─────────────────────────────────────────────────── */}
        {data && (
          <div className="space-y-5">
            {data.sectors.map(sector => (
              <div
                key={sector.name}
                className="bg-terminal-surface border border-terminal-border rounded-xl overflow-hidden"
              >
                {/* Sector header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-terminal-border bg-terminal-surfaceHi/40">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm text-terminal-text">
                      {sector.name}
                    </span>
                    <span className="text-xs text-terminal-textDim font-mono">
                      {sector.count} titres
                    </span>
                  </div>
                  <span
                    className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
                    style={{
                      color: changeColor(sector.avg_change),
                      background: sector.avg_change == null
                        ? 'rgba(107,114,128,0.1)'
                        : sector.avg_change >= 0
                          ? 'rgba(74,222,128,0.1)'
                          : 'rgba(248,113,113,0.1)',
                    }}
                  >
                    moy. {fmt(sector.avg_change)}
                  </span>
                </div>

                {/* Tiles */}
                <div className="p-3 flex flex-wrap gap-1.5">
                  {sector.stocks.map(stock => (
                    <Link
                      key={stock.ticker}
                      href={`/instrument/${stock.ticker}`}
                      title={`${stock.name}${stock.price != null ? ` · $${stock.price.toFixed(2)}` : ''}`}
                      className="flex flex-col items-center justify-center rounded-md transition-all duration-150
                                 hover:ring-2 hover:ring-white/30 hover:brightness-110 active:scale-95
                                 select-none cursor-pointer"
                      style={{
                        background: heatBg(stock.change_pct),
                        minWidth: '60px',
                        width:    '60px',
                        height:   '46px',
                        padding:  '4px 6px',
                      }}
                    >
                      <span className="text-[11px] font-bold text-white leading-tight tracking-wide">
                        {stock.ticker}
                      </span>
                      <span
                        className="text-[10px] font-mono leading-tight mt-0.5"
                        style={{ color: changeColor(stock.change_pct) }}
                      >
                        {fmt(stock.change_pct)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
