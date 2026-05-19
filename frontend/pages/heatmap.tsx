/**
 * pages/heatmap.tsx — Phase 18 (TradingView-style)
 * ──────────────────────────────────────────────────
 * Squarified treemap: tiles proportional to market cap, colored by change_pct.
 * Two-level layout: sector regions → stock tiles within each sector.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { API_BASE } from '../lib/api';

// ── API types ─────────────────────────────────────────────────────────────────

interface StockData {
  ticker:     string;
  name:       string;
  change_pct: number | null;
  price:      number | null;
  market_cap: number | null;
}

interface SectorData {
  name:         string;
  count:        number;
  avg_change:   number | null;
  total_mktcap: number | null;
  stocks:       StockData[];
}

interface HeatmapResponse {
  index:   string;
  label:   string;
  flag:    string;
  total:   number;
  as_of:   string;
  sectors: SectorData[];
}

// ── Squarified treemap ────────────────────────────────────────────────────────

interface TileNode {
  value: number;
  [key: string]: any;
}

interface TileRect extends TileNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

function worstAR(rowAreas: number[], s: number): number {
  if (!rowAreas.length || s === 0) return Infinity;
  const sum   = rowAreas.reduce((a, b) => a + b, 0);
  const maxA  = rowAreas[0]; // already sorted desc
  const minA  = rowAreas[rowAreas.length - 1];
  if (sum === 0 || minA === 0) return Infinity;
  return Math.max((s * s * maxA) / (sum * sum), (sum * sum) / (s * s * minA));
}

function layoutRow(
  row: TileNode[], areas: number[],
  x: number, y: number, w: number, h: number,
  out: TileRect[],
): [number, number, number, number] {
  const rowSum = areas.reduce((a, b) => a + b, 0);
  if (w >= h) {
    const stripW = rowSum / h;
    let cy = y;
    for (let i = 0; i < row.length; i++) {
      const tileH = stripW > 0 ? areas[i] / stripW : 0;
      out.push({ ...row[i], x, y: cy, w: stripW, h: tileH });
      cy += tileH;
    }
    return [x + stripW, y, w - stripW, h];
  } else {
    const stripH = rowSum / w;
    let cx = x;
    for (let i = 0; i < row.length; i++) {
      const tileW = stripH > 0 ? areas[i] / stripH : 0;
      out.push({ ...row[i], x: cx, y, w: tileW, h: stripH });
      cx += tileW;
    }
    return [x, y + stripH, w, h - stripH];
  }
}

function _squarify(
  items: TileNode[],
  scaledAreas: number[],
  x: number, y: number, w: number, h: number,
  out: TileRect[],
): void {
  if (!items.length) return;
  if (items.length === 1) {
    out.push({ ...items[0], x, y, w, h });
    return;
  }

  const s = Math.min(w, h);
  let rowItems:  TileNode[] = [];
  let rowAreas:  number[]   = [];

  for (let i = 0; i <= items.length; i++) {
    if (i === items.length) {
      layoutRow(rowItems, rowAreas, x, y, w, h, out);
      return;
    }
    const newAreas = [...rowAreas, scaledAreas[i]];
    if (
      rowItems.length === 0 ||
      worstAR(newAreas, s) <= worstAR(rowAreas, s)
    ) {
      rowItems.push(items[i]);
      rowAreas = newAreas;
    } else {
      const [nx, ny, nw, nh] = layoutRow(rowItems, rowAreas, x, y, w, h, out);
      _squarify(items.slice(i), scaledAreas.slice(i), nx, ny, nw, nh, out);
      return;
    }
  }
}

function squarify(nodes: TileNode[], x: number, y: number, w: number, h: number): TileRect[] {
  const filtered = nodes.filter(n => n.value > 0);
  const total    = filtered.reduce((s, n) => s + n.value, 0);
  if (!total || !filtered.length || w <= 0 || h <= 0) return [];

  const scale        = (w * h) / total;
  const scaledAreas  = filtered.map(n => n.value * scale);
  const out: TileRect[] = [];
  _squarify(filtered, scaledAreas, x, y, w, h, out);
  return out;
}

// ── Two-level layout ──────────────────────────────────────────────────────────

const SECTOR_GAP = 3;   // px between sector blocks
const TILE_GAP   = 1;   // px between stock tiles
const LABEL_H    = 20;  // px reserved for sector header label

interface SectorRect extends TileRect {
  sectorData: SectorData;
}

interface StockTileRect extends TileRect {
  ticker:     string;
  name:       string;
  change_pct: number | null;
  price:      number | null;
  sectorName: string;
}

interface SectorLabelRect {
  type:       'sector-label';
  x: number; y: number; w: number; h: number;
  name:       string;
  avg_change: number | null;
}

function computeTreemap(
  sectors: SectorData[],
  W: number,
  H: number,
): { stockTiles: StockTileRect[]; sectorLabels: SectorLabelRect[] } {
  const stockTiles:   StockTileRect[]   = [];
  const sectorLabels: SectorLabelRect[] = [];

  if (W <= 0 || H <= 0) return { stockTiles, sectorLabels };

  // Level-1: sectors sized by total_mktcap (fallback: stock count)
  const sectorNodes: TileNode[] = sectors.map(sec => ({
    value:      sec.total_mktcap ?? sec.count,
    sectorData: sec,
  }));
  const sectorRects = squarify(sectorNodes, 0, 0, W, H) as SectorRect[];

  for (const sr of sectorRects) {
    const sec = sr.sectorData as SectorData;

    // Inner area after gap
    const ix = sr.x + SECTOR_GAP;
    const iy = sr.y + SECTOR_GAP;
    const iw = sr.w - SECTOR_GAP * 2;
    const ih = sr.h - SECTOR_GAP * 2;

    if (iw <= 4 || ih <= 4) continue;

    // Reserve space for sector label (only if large enough)
    const showLabel = iw >= 60 && ih >= 30;
    const labelH    = showLabel ? LABEL_H : 0;

    // Level-2: stocks sized by market_cap (fallback: 1)
    const stockNodes: TileNode[] = sec.stocks.map(st => ({
      value:      Math.max(st.market_cap ?? 1, 1),
      ticker:     st.ticker,
      name:       st.name,
      change_pct: st.change_pct,
      price:      st.price,
    }));

    const stockRects = squarify(
      stockNodes,
      ix,
      iy + labelH,
      iw,
      ih - labelH,
    ) as (TileRect & StockData)[];

    for (const tr of stockRects) {
      // Apply tile gap
      stockTiles.push({
        ...tr,
        x:          tr.x + TILE_GAP / 2,
        y:          tr.y + TILE_GAP / 2,
        w:          tr.w - TILE_GAP,
        h:          tr.h - TILE_GAP,
        sectorName: sec.name,
      });
    }

    if (showLabel) {
      sectorLabels.push({
        type:       'sector-label',
        x:          ix,
        y:          iy,
        w:          iw,
        h:          LABEL_H,
        name:       sec.name,
        avg_change: sec.avg_change,
      });
    }
  }

  return { stockTiles, sectorLabels };
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function heatBg(pct: number | null): string {
  if (pct == null) return 'rgba(28,30,42,0.9)';
  const v = Math.max(-7, Math.min(7, pct));
  if (v >= 0) {
    const t = v / 7;
    return `rgba(${Math.round(10 + 10 * (1-t))},${Math.round(55 + 115 * t)},${Math.round(18 * (1-t))},0.9)`;
  } else {
    const t = (-v) / 7;
    return `rgba(${Math.round(55 + 130 * t)},${Math.round(12 * (1-t))},${Math.round(12 * (1-t))},0.9)`;
  }
}

function changeColor(pct: number | null): string {
  if (pct == null) return '#6b7280';
  if (pct >  0.05) return '#4ade80';
  if (pct < -0.05) return '#f87171';
  return '#9ca3af';
}

function fmt(pct: number | null): string {
  if (pct == null) return '—';
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}

// ── Index selector config ─────────────────────────────────────────────────────

const INDICES = [
  { key: 'sp500',       label: 'S&P 500',    sub: 'US 500'  },
  { key: 'nasdaq100',   label: 'Nasdaq 100', sub: 'US Tech' },
  { key: 'dowjones',    label: 'Dow Jones',  sub: 'US 30'   },
  { key: 'cac40',       label: 'CAC 40',     sub: 'France'  },
  { key: 'commodities', label: 'Commodities',sub: 'Matières'},
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HeatmapPage() {
  const [selectedIndex, setSelectedIndex] = useState('sp500');
  const [data,    setData]    = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 1000, h: 640 });

  // Measure container on mount + resize
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0) setDims({ w: rect.width, h: rect.height });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Fetch on index change
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`${API_BASE}/api/heatmap?index=${selectedIndex}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: HeatmapResponse) => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [selectedIndex]);

  // Compute treemap layout (memoized — only recomputes when data or dims change)
  const { stockTiles, sectorLabels } = useMemo(() => {
    if (!data?.sectors) return { stockTiles: [], sectorLabels: [] };
    return computeTreemap(data.sectors, dims.w, dims.h);
  }, [data, dims]);

  return (
    <>
      <Head>
        <title>Market Heatmap — Monte Carlo</title>
        <meta name="description" content="Market heatmap: tiles proportional to market cap, colored by daily change" />
      </Head>

      <div className="max-w-[1600px] mx-auto px-4 py-5 space-y-4">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
          <div>
            <h1 className="text-2xl font-bold text-terminal-text">Market Heatmap</h1>
            <p className="text-sm text-terminal-textMuted mt-0.5">
              Taille ∝ capitalisation boursière · couleur = variation du jour
            </p>
          </div>
          {data && !loading && (
            <span className="text-xs text-terminal-textDim font-mono shrink-0">
              {data.label} · {data.total} titres · {data.as_of}
            </span>
          )}
        </div>

        {/* ── Index selector ──────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          {INDICES.map(idx => (
            <button
              key={idx.key}
              onClick={() => setSelectedIndex(idx.key)}
              className={`flex flex-col items-start px-3.5 py-2 rounded-lg border text-left transition-all ${
                selectedIndex === idx.key
                  ? 'bg-terminal-cyan/10 border-terminal-cyan text-terminal-cyan'
                  : 'bg-terminal-surface border-terminal-border text-terminal-textMuted hover:border-terminal-textDim hover:text-terminal-text'
              }`}
            >
              <span className="text-xs font-semibold leading-tight">{idx.label}</span>
              <span className="text-[10px] font-mono opacity-70 leading-tight">{idx.sub}</span>
            </button>
          ))}
        </div>

        {/* ── Legend ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-terminal-textDim mr-1">Variation :</span>
          {([-5, -3, -1, 0, 1, 3, 5] as const).map(v => (
            <span
              key={v}
              className="inline-flex items-center justify-center text-[10px] font-mono px-2 py-0.5 rounded"
              style={{
                background: heatBg(v),
                color: v > 0 ? '#86efac' : v < 0 ? '#fca5a5' : '#9ca3af',
              }}
            >
              {v >= 0 ? '+' : ''}{v}%
            </span>
          ))}
          <span className="text-[10px] text-terminal-textDim ml-2">
            Cliquer sur un titre → fiche instrument
          </span>
        </div>

        {/* ── Treemap container ───────────────────────────────────── */}
        <div
          ref={containerRef}
          className="w-full rounded-xl overflow-hidden border border-terminal-border bg-terminal-bg"
          style={{ height: 'calc(100vh - 300px)', minHeight: 480, maxHeight: 720 }}
        >
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center h-full text-terminal-textMuted">
              <div className="text-center space-y-3">
                <div className="w-9 h-9 border-2 border-terminal-cyan border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm">Chargement du heatmap…</p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="bg-red-900/20 border border-red-500/30 rounded-lg px-5 py-4 text-red-400 text-sm max-w-sm text-center">
                Erreur : {error}
              </div>
            </div>
          )}

          {/* Treemap */}
          {!loading && !error && data && (
            <div className="relative w-full h-full">

              {/* Stock tiles */}
              {stockTiles.map(tile => (
                <Link
                  key={tile.ticker}
                  href={`/instrument/${tile.ticker}`}
                  title={`${tile.name}${tile.price != null ? ` · $${tile.price.toFixed(2)}` : ''} · ${fmt(tile.change_pct)}`}
                  className="absolute overflow-hidden transition-all duration-100
                             hover:ring-2 hover:ring-white/40 hover:z-10 hover:brightness-125
                             active:scale-95 cursor-pointer select-none"
                  style={{
                    left:       tile.x,
                    top:        tile.y,
                    width:      tile.w,
                    height:     tile.h,
                    background: heatBg(tile.change_pct),
                  }}
                >
                  {tile.w >= 44 && tile.h >= 30 && (
                    <span
                      className="absolute inset-0 flex flex-col items-center justify-center gap-0"
                      style={{ padding: '2px 3px' }}
                    >
                      {/* Ticker */}
                      <span
                        className="text-white font-bold leading-none text-center w-full truncate"
                        style={{ fontSize: Math.min(13, Math.max(8, tile.w / 5)) }}
                      >
                        {tile.ticker}
                      </span>
                      {/* Change% — only if tall enough */}
                      {tile.h >= 44 && tile.w >= 50 && (
                        <span
                          className="font-mono leading-none text-center"
                          style={{
                            fontSize: Math.min(11, Math.max(7, tile.w / 6)),
                            color:    changeColor(tile.change_pct),
                          }}
                        >
                          {fmt(tile.change_pct)}
                        </span>
                      )}
                    </span>
                  )}
                </Link>
              ))}

              {/* Sector label overlays */}
              {sectorLabels.map(lbl => (
                <div
                  key={lbl.name}
                  className="absolute flex items-center gap-2 px-2 pointer-events-none"
                  style={{
                    left:       lbl.x,
                    top:        lbl.y,
                    width:      lbl.w,
                    height:     lbl.h,
                    background: 'rgba(0,0,0,0.55)',
                    backdropFilter: 'blur(2px)',
                    zIndex: 5,
                    borderRadius: '2px 2px 0 0',
                  }}
                >
                  <span
                    className="font-semibold text-white truncate"
                    style={{ fontSize: Math.min(11, Math.max(9, lbl.w / 12)) }}
                  >
                    {lbl.name}
                  </span>
                  {lbl.w >= 120 && (
                    <span
                      className="font-mono shrink-0"
                      style={{
                        fontSize: 10,
                        color: changeColor(lbl.avg_change),
                      }}
                    >
                      {fmt(lbl.avg_change)}
                    </span>
                  )}
                </div>
              ))}

            </div>
          )}
        </div>

      </div>
    </>
  );
}
