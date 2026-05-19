/**
 * pages/heatmap.tsx — Phase 18 (TradingView-style)
 * ──────────────────────────────────────────────────
 * Squarified treemap : tuiles proportionnelles à la market cap, colorées par change_pct.
 * Vue globale : top 15 par secteur.
 * Clic secteur → vue détaillée : toutes les actions du secteur.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { API_BASE } from '../lib/api';

// ── Types API ─────────────────────────────────────────────────────────────────

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

// ── Squarified Treemap ────────────────────────────────────────────────────────

interface TileNode { value: number; [k: string]: any; }
interface TileRect  extends TileNode { x: number; y: number; w: number; h: number; }

/** Worst aspect-ratio for a row (Bruls 2000). rowAreas must be sorted desc. */
function worstAR(rowAreas: number[], s: number): number {
  if (!rowAreas.length || s === 0) return Infinity;
  const sum  = rowAreas.reduce((a, b) => a + b, 0);
  const maxA = rowAreas[0];
  const minA = rowAreas[rowAreas.length - 1];
  if (sum === 0 || minA === 0) return Infinity;
  return Math.max((s * s * maxA) / (sum * sum), (sum * sum) / (s * s * minA));
}

function layoutStrip(
  row:   TileNode[], areas: number[],
  x: number, y: number, w: number, h: number,
  out:   TileRect[],
): [number, number, number, number] {
  const rowSum = areas.reduce((a, b) => a + b, 0);
  if (w >= h) {
    const sw = rowSum / h;
    let cy = y;
    for (let i = 0; i < row.length; i++) {
      const th = sw > 0 ? areas[i] / sw : 0;
      out.push({ ...row[i], x, y: cy, w: sw, h: th });
      cy += th;
    }
    return [x + sw, y, w - sw, h];
  } else {
    const sh = rowSum / w;
    let cx = x;
    for (let i = 0; i < row.length; i++) {
      const tw = sh > 0 ? areas[i] / sh : 0;
      out.push({ ...row[i], x: cx, y, w: tw, h: sh });
      cx += tw;
    }
    return [x, y + sh, w, h - sh];
  }
}

function _squarify(
  items: TileNode[], scaled: number[],
  x: number, y: number, w: number, h: number,
  out: TileRect[],
): void {
  if (!items.length) return;
  if (items.length === 1) { out.push({ ...items[0], x, y, w, h }); return; }

  const s = Math.min(w, h);
  let row: TileNode[] = [], rowA: number[] = [];

  for (let i = 0; i <= items.length; i++) {
    if (i === items.length) { layoutStrip(row, rowA, x, y, w, h, out); return; }
    const nA = [...rowA, scaled[i]];
    if (row.length === 0 || worstAR(nA, s) <= worstAR(rowA, s)) {
      row.push(items[i]); rowA = nA;
    } else {
      const [nx, ny, nw, nh] = layoutStrip(row, rowA, x, y, w, h, out);
      _squarify(items.slice(i), scaled.slice(i), nx, ny, nw, nh, out);
      return;
    }
  }
}

function squarify(nodes: TileNode[], x: number, y: number, w: number, h: number): TileRect[] {
  const f = nodes.filter(n => n.value > 0);
  const total = f.reduce((s, n) => s + n.value, 0);
  if (!total || !f.length || w <= 0 || h <= 0) return [];
  const sc = (w * h) / total;
  const out: TileRect[] = [];
  _squarify(f, f.map(n => n.value * sc), x, y, w, h, out);
  return out;
}

// ── Layout 2 niveaux ──────────────────────────────────────────────────────────

const SGAP = 3;   // gap inter-secteurs
const TGAP = 1;   // gap inter-tuiles
const LBL_H = 22; // hauteur label secteur

interface StockTileRect {
  ticker: string; name: string;
  change_pct: number | null; price: number | null;
  x: number; y: number; w: number; h: number;
  sectorName: string;
}
interface SectorLabelRect {
  name: string; avg_change: number | null; hiddenCount: number;
  x: number; y: number; w: number; h: number;
}

interface SectorDisplay extends SectorData { _hidden: number; }

function computeTreemap(
  sectors: SectorDisplay[], W: number, H: number, isExpanded: boolean,
): { stockTiles: StockTileRect[]; sectorLabels: SectorLabelRect[] } {
  const stockTiles:   StockTileRect[]   = [];
  const sectorLabels: SectorLabelRect[] = [];
  if (W <= 0 || H <= 0) return { stockTiles, sectorLabels };

  // ── Vue "expanded" : une seule section remplit tout le container ──────────
  if (isExpanded && sectors.length === 1) {
    const sec = sectors[0];
    const headerH = 30;
    sectorLabels.push({
      name: sec.name, avg_change: sec.avg_change, hiddenCount: 0,
      x: 0, y: 0, w: W, h: headerH,
    });
    const nodes: TileNode[] = sec.stocks.map(st => ({
      value: Math.max(st.market_cap ?? 1, 1),
      ...st,
    }));
    const rects = squarify(nodes, SGAP, headerH + SGAP, W - 2 * SGAP, H - headerH - 2 * SGAP);
    for (const r of rects) {
      stockTiles.push({
        ...r, ticker: r.ticker, name: r.name,
        change_pct: r.change_pct, price: r.price,
        x: r.x + TGAP / 2, y: r.y + TGAP / 2,
        w: r.w - TGAP, h: r.h - TGAP,
        sectorName: sec.name,
      });
    }
    return { stockTiles, sectorLabels };
  }

  // ── Vue globale : squarify des secteurs, puis stocks dans chaque secteur ──
  const sNodes: TileNode[] = sectors.map(s => ({
    value: s.total_mktcap ?? s.count, sectorData: s,
  }));
  const sRects = squarify(sNodes, 0, 0, W, H) as (TileRect & { sectorData: SectorDisplay })[];

  for (const sr of sRects) {
    const sec = sr.sectorData;
    const ix = sr.x + SGAP, iy = sr.y + SGAP;
    const iw = sr.w - SGAP * 2, ih = sr.h - SGAP * 2;
    if (iw <= 4 || ih <= 4) continue;

    const showLabel = iw >= 55 && ih >= 28;
    const lblH      = showLabel ? LBL_H : 0;

    sectorLabels.push({
      name: sec.name, avg_change: sec.avg_change, hiddenCount: sec._hidden,
      x: ix, y: iy, w: iw, h: showLabel ? lblH : 0,
    });

    const nodes: TileNode[] = sec.stocks.map(st => ({
      value: Math.max(st.market_cap ?? 1, 1), ...st,
    }));
    const rects = squarify(nodes, ix, iy + lblH, iw, ih - lblH);
    for (const r of rects) {
      stockTiles.push({
        ...r, ticker: r.ticker, name: r.name,
        change_pct: r.change_pct, price: r.price,
        x: r.x + TGAP / 2, y: r.y + TGAP / 2,
        w: r.w - TGAP, h: r.h - TGAP,
        sectorName: sec.name,
      });
    }
  }
  return { stockTiles, sectorLabels };
}

// ── Couleurs ──────────────────────────────────────────────────────────────────

function heatBg(pct: number | null): string {
  if (pct == null)         return 'rgba(42,46,62,0.95)';   // no data
  if (Math.abs(pct) < 0.1) return 'rgba(50,55,72,0.95)';  // flat
  const v = Math.max(-8, Math.min(8, pct));
  const t = Math.max(0.12, Math.abs(v) / 8);
  if (v > 0) {
    const g = Math.round(72 + 110 * t);
    return `rgba(8,${g},22,0.92)`;
  } else {
    const r = Math.round(72 + 120 * t);
    return `rgba(${r},8,8,0.92)`;
  }
}

function changeColor(pct: number | null): string {
  if (pct == null)          return '#6b7280';
  if (pct >  0.05) return '#4ade80';
  if (pct < -0.05) return '#f87171';
  return '#9ca3af';
}

function fmt(pct: number | null): string {
  if (pct == null) return '—';
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}

// ── Config indices ────────────────────────────────────────────────────────────

const INDICES = [
  { key: 'sp500',       label: 'S&P 500',    sub: 'US · 500 titres'  },
  { key: 'nasdaq100',   label: 'Nasdaq 100', sub: 'US · Tech'        },
  { key: 'dowjones',    label: 'Dow Jones',  sub: 'US · 30 blue chips'},
  { key: 'cac40',       label: 'CAC 40',     sub: 'France · 40 titres'},
  { key: 'commodities', label: 'Matières 1ères', sub: 'Or · Pétrole · Agri' },
];

const TOP_N = 15; // titres affichés par secteur en vue globale

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HeatmapPage() {
  const [selIdx,          setSelIdx]          = useState('sp500');
  const [data,            setData]            = useState<HeatmapResponse | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [expandedSector,  setExpandedSector]  = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 1000, h: 620 });

  // ResizeObserver
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        if (width > 0 && height > 0) setDims({ w: width, h: height });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Fetch
  useEffect(() => {
    setLoading(true); setError(null); setData(null); setExpandedSector(null);
    fetch(`${API_BASE}/api/heatmap?index=${selIdx}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: HeatmapResponse) => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [selIdx]);

  // Sectors à afficher (limités ou expanded)
  const displaySectors = useMemo<SectorDisplay[]>(() => {
    if (!data?.sectors) return [];
    if (expandedSector) {
      const sec = data.sectors.find(s => s.name === expandedSector);
      return sec ? [{ ...sec, _hidden: 0 }] : [];
    }
    return data.sectors.map(sec => ({
      ...sec,
      stocks:  sec.stocks.slice(0, TOP_N),
      _hidden: Math.max(0, sec.stocks.length - TOP_N),
    }));
  }, [data, expandedSector]);

  // Layout treemap (memoized)
  const { stockTiles, sectorLabels } = useMemo(() => {
    if (!displaySectors.length) return { stockTiles: [], sectorLabels: [] };
    return computeTreemap(displaySectors, dims.w, dims.h, !!expandedSector);
  }, [displaySectors, dims, expandedSector]);

  const totalDisplayed = displaySectors.reduce((s, sec) => s + sec.stocks.length, 0);

  return (
    <>
      <Head>
        <title>Market Heatmap — Monte Carlo</title>
        <meta name="description" content="Heatmap marché : tuiles proportionnelles à la capitalisation, colorées par variation" />
      </Head>

      <div className="max-w-[1600px] mx-auto px-4 py-5 space-y-4">

        {/* ── En-tête ──────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-2 justify-between">
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

        {/* ── Sélecteur d'indice ───────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          {INDICES.map(idx => (
            <button
              key={idx.key}
              onClick={() => setSelIdx(idx.key)}
              className={`flex flex-col items-start px-3.5 py-2 rounded-lg border text-left transition-all ${
                selIdx === idx.key
                  ? 'bg-terminal-cyan/10 border-terminal-cyan text-terminal-cyan'
                  : 'bg-terminal-surface border-terminal-border text-terminal-textMuted hover:border-terminal-textDim hover:text-terminal-text'
              }`}
            >
              <span className="text-xs font-semibold leading-tight">{idx.label}</span>
              <span className="text-[10px] font-mono opacity-60 leading-tight">{idx.sub}</span>
            </button>
          ))}
        </div>

        {/* ── Légende + barre d'actions ────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-terminal-textDim">Variation :</span>
            {([-5, -3, -1, 0, 1, 3, 5] as const).map(v => (
              <span key={v}
                className="inline-flex items-center justify-center text-[10px] font-mono px-2 py-0.5 rounded"
                style={{ background: heatBg(v), color: v > 0 ? '#86efac' : v < 0 ? '#fca5a5' : '#9ca3af' }}
              >
                {v >= 0 ? '+' : ''}{v}%
              </span>
            ))}
          </div>
          {/* Bouton retour quand un secteur est expanded */}
          {expandedSector ? (
            <button
              onClick={() => setExpandedSector(null)}
              className="flex items-center gap-1.5 text-xs text-terminal-cyan border border-terminal-cyan/40
                         rounded-lg px-3 py-1.5 hover:bg-terminal-cyan/10 transition"
            >
              ← Retour au heatmap global
            </button>
          ) : (
            !loading && data && (
              <span className="text-[11px] text-terminal-textDim">
                {totalDisplayed} / {data.total} titres · cliquer un secteur pour tout afficher
              </span>
            )
          )}
        </div>

        {/* ── Conteneur treemap ────────────────────────────────────── */}
        <div
          ref={containerRef}
          className="w-full rounded-xl overflow-hidden border border-terminal-border bg-[#0f1117]"
          style={{ height: 'calc(100vh - 310px)', minHeight: 480, maxHeight: 720 }}
        >
          {loading && (
            <div className="flex items-center justify-center h-full text-terminal-textMuted">
              <div className="text-center space-y-3">
                <div className="w-9 h-9 border-2 border-terminal-cyan border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm">Chargement…</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="bg-red-900/20 border border-red-500/30 rounded-lg px-5 py-4 text-red-400 text-sm max-w-sm text-center">
                Erreur : {error}
              </div>
            </div>
          )}

          {!loading && !error && data && (
            <div className="relative w-full h-full">

              {/* Tuiles stocks */}
              {stockTiles.map(tile => (
                <Link
                  key={`${tile.sectorName}-${tile.ticker}`}
                  href={`/instrument/${tile.ticker}`}
                  title={`${tile.name}${tile.price != null ? ` · $${tile.price.toFixed(2)}` : ''} · ${fmt(tile.change_pct)}`}
                  className="absolute overflow-hidden cursor-pointer select-none
                             hover:ring-2 hover:ring-white/40 hover:z-10 hover:brightness-125
                             active:scale-95 transition-[filter,box-shadow] duration-100"
                  style={{
                    left:       tile.x,
                    top:        tile.y,
                    width:      tile.w,
                    height:     tile.h,
                    background: heatBg(tile.change_pct),
                  }}
                >
                  {tile.w >= 40 && tile.h >= 26 && (
                    <span className="absolute inset-0 flex flex-col items-center justify-center"
                      style={{ padding: '2px 3px', gap: 0 }}>
                      <span
                        className="text-white font-bold leading-none text-center w-full truncate"
                        style={{ fontSize: Math.min(13, Math.max(8, Math.min(tile.w / 5, tile.h / 3))) }}
                      >
                        {tile.ticker}
                      </span>
                      {tile.h >= 42 && tile.w >= 46 && (
                        <span
                          className="font-mono leading-none"
                          style={{
                            fontSize: Math.min(11, Math.max(7, Math.min(tile.w / 6.5, tile.h / 4))),
                            color: changeColor(tile.change_pct),
                            marginTop: 1,
                          }}
                        >
                          {fmt(tile.change_pct)}
                        </span>
                      )}
                    </span>
                  )}
                </Link>
              ))}

              {/* Labels secteurs */}
              {sectorLabels.map(lbl => (
                lbl.h > 0 && (
                  <div
                    key={lbl.name}
                    onClick={() => !expandedSector && setExpandedSector(lbl.name)}
                    className={`absolute flex items-center gap-2 px-2 z-10 ${
                      !expandedSector ? 'cursor-pointer hover:bg-black/70' : 'cursor-default'
                    }`}
                    style={{
                      left:           lbl.x,
                      top:            lbl.y,
                      width:          lbl.w,
                      height:         lbl.h,
                      background:     'rgba(0,0,0,0.65)',
                      backdropFilter: 'blur(3px)',
                      borderRadius:   '3px 3px 0 0',
                      transition:     'background 0.15s',
                    }}
                  >
                    <span
                      className="font-semibold text-white truncate flex-1"
                      style={{ fontSize: Math.min(12, Math.max(9, lbl.w / 11)) }}
                    >
                      {expandedSector ? `▾ ${lbl.name}` : lbl.name}
                    </span>
                    {lbl.w >= 100 && (
                      <span
                        className="font-mono shrink-0"
                        style={{ fontSize: 10, color: changeColor(lbl.avg_change) }}
                      >
                        {fmt(lbl.avg_change)}
                      </span>
                    )}
                    {!expandedSector && lbl.hiddenCount > 0 && lbl.w >= 110 && (
                      <span
                        className="shrink-0 font-mono text-terminal-textDim rounded px-1"
                        style={{ fontSize: 9, background: 'rgba(255,255,255,0.07)' }}
                      >
                        +{lbl.hiddenCount}
                      </span>
                    )}
                  </div>
                )
              ))}

            </div>
          )}
        </div>

      </div>
    </>
  );
}
