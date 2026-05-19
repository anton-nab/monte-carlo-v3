/**
 * pages/heatmap.tsx — Phase 18 (TradingView-style)
 * ──────────────────────────────────────────────────
 * Squarified treemap : tuiles proportionnelles à la market cap, colorées par change_pct.
 * Vue globale : top 15 par secteur.
 * Clic secteur → vue détaillée : toutes les actions du secteur.
 * Panneaux analytiques : Top Holdings + Sector Breakdown.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { API_BASE } from '../lib/api';
import { Header } from '@/components/Header';

// ── Couleurs secteurs (identiques à instrument/[ticker].tsx) ─────────────────
const SECTOR_COLORS: Record<string, string> = {
  'Technology':              '#00d9ff',
  'Healthcare':              '#26a69a',
  'Financials':              '#f9a825',
  'Financial Services':      '#f9a825',
  'Consumer Cyclical':       '#ef6c00',
  'Consumer Discretionary':  '#ef6c00',
  'Consumer Defensive':      '#4caf50',
  'Consumer Staples':        '#4caf50',
  'Industrials':             '#2196f3',
  'Communication Services':  '#9c27b0',
  'Energy':                  '#ff5722',
  'Utilities':               '#607d8b',
  'Real Estate':             '#795548',
  'Basic Materials':         '#8bc34a',
  'Materials':               '#8bc34a',
  'Precious Metals':         '#ffd700',
  'Industrial Metals':       '#90a4ae',
  'Agriculture':             '#66bb6a',
  'Diversified':             '#ab47bc',
};
const PIE_PALETTE = [
  '#00d9ff','#26a69a','#f9a825','#ef6c00','#4caf50',
  '#2196f3','#9c27b0','#ff5722','#607d8b','#8bc34a',
  '#e91e63','#00bcd4','#ff9800','#3f51b5','#009688',
];
function sectorColor(name: string, i: number): string {
  return SECTOR_COLORS[name] ?? PIE_PALETTE[i % PIE_PALETTE.length];
}

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

// ── Historical data type ──────────────────────────────────────────────────────
interface HistoricalPoint {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}

// ── ETF proxy pour les données historiques de chaque indice ──────────────────
const INDEX_ETF: Record<string, string> = {
  sp500:       'SPY',   // SPDR S&P 500
  nasdaq100:   'QQQ',   // Invesco Nasdaq 100
  dowjones:    'DIA',   // SPDR Dow Jones
  cac40:       'EWQ',   // iShares MSCI France
  commodities: 'DJP',   // iPath Bloomberg Commodity
};

const INDEX_ETF_LABEL: Record<string, string> = {
  sp500:       'SPY', nasdaq100: 'QQQ', dowjones: 'DIA', cac40: 'EWQ', commodities: 'DJP',
};

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Couleur cellule pour heatmap mensuelle ────────────────────────────────────
function returnCellStyle(pct: number): { background: string; color: string } {
  if (Math.abs(pct) < 0.05) return { background: '#1a2035', color: '#6b7280' };
  const intensity = Math.min(Math.abs(pct) / 8, 1);
  if (pct > 0) return { background: `rgba(38,166,154,${0.15 + intensity * 0.55})`, color: '#a7f3d0' };
  return { background: `rgba(239,83,80,${0.15 + intensity * 0.55})`, color: '#fca5a5' };
}

// ── Calcul des retours mensuels ───────────────────────────────────────────────
interface MonthlyData {
  years:         number[];
  yearData:      Record<number, Record<number, number | null>>;
  annualReturns: Record<number, number | null>;
  avgByMonth:    Record<number, number | null>;
}

function computeMonthlyReturns(pts: HistoricalPoint[]): MonthlyData {
  const empty: MonthlyData = { years: [], yearData: {}, annualReturns: {}, avgByMonth: {} };
  if (pts.length < 5) return empty;

  // groupe les clôtures par année-mois
  const grouped: Record<string, number[]> = {};
  for (const p of pts) {
    const d = new Date(p.date);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(p.close);
  }

  const yearData: Record<number, Record<number, number | null>> = {};
  const byYear:   Record<number, number[]> = {};

  for (const [key, closes] of Object.entries(grouped)) {
    const [y, m] = key.split('-').map(Number);
    if (!yearData[y]) yearData[y] = {};
    const first = closes[0], last = closes[closes.length - 1];
    if (first > 0) {
      const ret = ((last - first) / first) * 100;
      yearData[y][m] = parseFloat(ret.toFixed(2));
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push(ret);
    } else {
      yearData[y][m] = null;
    }
  }

  const annualReturns: Record<number, number | null> = {};
  for (const [y, rets] of Object.entries(byYear)) {
    const comp = rets.reduce((acc, r) => acc * (1 + r / 100), 1);
    annualReturns[Number(y)] = parseFloat(((comp - 1) * 100).toFixed(2));
  }

  const avgByMonth: Record<number, number | null> = {};
  for (let m = 1; m <= 12; m++) {
    const vals = Object.values(yearData)
      .map(yd => yd[m])
      .filter((v): v is number => v != null);
    avgByMonth[m] = vals.length > 0
      ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2))
      : null;
  }

  const years = Object.keys(yearData).map(Number).sort((a, b) => a - b);
  return { years, yearData, annualReturns, avgByMonth };
}

// ── FOMO adapté à un indice ───────────────────────────────────────────────────
interface IndexFomo {
  score: number;
  breakdown: { momentum: number; trend: number; ytd: number; breadth: number };
}

function computeIndexFomo(pts: HistoricalPoint[], sectors: SectorData[]): IndexFomo | null {
  if (pts.length < 30) return null;
  const last = pts[pts.length - 1].close;

  // Momentum 30 jours
  const cutoff30 = Date.now() - 30 * 86_400_000;
  let ref30 = pts[0].close;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (new Date(pts[i].date).getTime() <= cutoff30) { ref30 = pts[i].close; break; }
  }
  const chg30 = ((last - ref30) / ref30) * 100;
  const momentumPts = Math.max(0, Math.min(30, ((chg30 + 15) / 30) * 30));

  // Tendance vs MM200
  const ma200 = pts.slice(-200).reduce((s, p) => s + p.close, 0) / Math.min(200, pts.length);
  const distMa = ((last - ma200) / ma200) * 100;
  const trendPts = Math.max(0, Math.min(20, ((distMa + 10) / 20) * 20));

  // YTD
  const thisYear = new Date().getFullYear();
  const jan1 = pts.find(p => new Date(p.date).getFullYear() === thisYear);
  const ytdPct = jan1 ? ((last - jan1.close) / jan1.close) * 100 : 0;
  const ytdPts = Math.max(0, Math.min(25, ((ytdPct + 15) / 30) * 25));

  // Ampleur secteurs
  const posSec = sectors.filter(s => (s.avg_change ?? 0) > 0).length;
  const breadthPct = sectors.length > 0 ? (posSec / sectors.length) * 100 : 50;
  const breadthPts = Math.max(0, Math.min(25, (breadthPct / 100) * 25));

  return {
    score: Math.round(Math.min(100, momentumPts + trendPts + ytdPts + breadthPts)),
    breakdown: {
      momentum: Math.round(momentumPts),
      trend:    Math.round(trendPts),
      ytd:      Math.round(ytdPts),
      breadth:  Math.round(breadthPts),
    },
  };
}

function getFomoMeta(score: number) {
  if (score >= 80) return { label: 'FOMO',     ringColor: '#ef4444', bgColor: 'bg-red-500/10'    };
  if (score >= 60) return { label: 'Chaud',    ringColor: '#f97316', bgColor: 'bg-orange-500/10' };
  if (score >= 40) return { label: 'Momentum', ringColor: '#eab308', bgColor: 'bg-yellow-500/10' };
  if (score >= 20) return { label: 'Neutre',   ringColor: '#6b7280', bgColor: 'bg-gray-500/10'   };
  return              { label: 'Froid',    ringColor: '#3b82f6', bgColor: 'bg-blue-500/10'   };
}

// ── FOMO Gauge (SVG demi-cercle) ──────────────────────────────────────────────
function FomoGauge({ score }: { score: number }) {
  const W = 220, H = 128, cx = W / 2, cy = H - 13, R = 90, SW = 18;
  const toAngle = (s: number) => Math.PI * (1 - s / 100);
  const ptOnArc = (s: number, r: number) => ({
    x: +(cx + r * Math.cos(toAngle(s))).toFixed(2),
    y: +(cy - r * Math.sin(toAngle(s))).toFixed(2),
  });
  const start = ptOnArc(0, R); const end = ptOnArc(100, R);
  const sPt = ptOnArc(Math.min(score, 99.9), R);
  const bgArc     = `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y}`;
  const activeArc = score <= 0 ? null : score >= 100 ? bgArc
    : `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${sPt.x} ${sPt.y}`;
  const nPt = ptOnArc(score, R - SW / 2 - 3);
  const { label, ringColor } = getFomoMeta(score);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="hm-fg-active" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#3b82f6"/>
          <stop offset="25%"  stopColor="#6b7280"/>
          <stop offset="50%"  stopColor="#eab308"/>
          <stop offset="75%"  stopColor="#f97316"/>
          <stop offset="100%" stopColor="#ef4444"/>
        </linearGradient>
        <linearGradient id="hm-fg-dim" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#3b82f6" stopOpacity="0.18"/>
          <stop offset="25%"  stopColor="#6b7280" stopOpacity="0.18"/>
          <stop offset="50%"  stopColor="#eab308" stopOpacity="0.18"/>
          <stop offset="75%"  stopColor="#f97316" stopOpacity="0.18"/>
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.18"/>
        </linearGradient>
      </defs>
      <path d={bgArc} fill="none" stroke="#080c14" strokeWidth={SW + 6} strokeLinecap="round" />
      <path d={bgArc} fill="none" stroke="url(#hm-fg-dim)" strokeWidth={SW} strokeLinecap="round" />
      {activeArc && <path d={activeArc} fill="none" stroke="url(#hm-fg-active)" strokeWidth={SW} strokeLinecap="round" />}
      <line x1={cx} y1={cy} x2={nPt.x} y2={nPt.y} stroke="white" strokeWidth={2.5} strokeLinecap="round" opacity={0.9} />
      <circle cx={cx} cy={cy} r={5} fill="white" opacity={0.9} />
      <circle cx={cx} cy={cy} r={2.5} fill="#080c14" />
      <text x={cx} y={cy - 24} textAnchor="middle" fill="white" fontSize={30} fontWeight="bold"
        fontFamily="'Courier New', monospace">{score}</text>
      <text x={cx} y={cy - 8} textAnchor="middle" fill={ringColor} fontSize={11} fontWeight="700">{label}</text>
      <text x={start.x + 2} y={start.y} dominantBaseline="hanging" textAnchor="start" fill="#374151" fontSize={9}>0</text>
      <text x={end.x - 2} y={end.y} dominantBaseline="hanging" textAnchor="end"   fill="#374151" fontSize={9}>100</text>
    </svg>
  );
}

// ── FOMO Card ─────────────────────────────────────────────────────────────────
function IndexFomoCard({ result, loading }: { result: IndexFomo | null; loading: boolean }) {
  if (loading) return (
    <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
      <div className="flex items-center gap-2 text-terminal-textMuted text-sm">
        <span className="animate-pulse">●</span> Calcul du FOMO indicator…
      </div>
    </div>
  );
  if (!result) return null;
  const { score, breakdown } = result;
  const { ringColor, bgColor } = getFomoMeta(score);
  const items = [
    { key: 'momentum' as const, label: 'Momentum 30 jours',  max: 30, info: 'Variation sur les 30 derniers jours calendaires' },
    { key: 'trend'    as const, label: 'Tendance vs MM200',   max: 20, info: 'Distance à la moyenne mobile 200 jours' },
    { key: 'ytd'      as const, label: 'Performance YTD',     max: 25, info: 'Retour depuis le 1er janvier' },
    { key: 'breadth'  as const, label: 'Ampleur de marché',   max: 25, info: '% de secteurs en hausse aujourd\'hui' },
  ];
  return (
    <div className={`bg-terminal-surface border border-terminal-border rounded-xl p-5 ${bgColor}`}>
      <h2 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
        FOMO Indicator — Indice
      </h2>
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="shrink-0">
          <FomoGauge score={score} />
          <div className="flex justify-between mt-1 px-1 text-[9px]">
            <span className="text-blue-400/60">Froid</span>
            <span className="text-gray-400/60">Neutre</span>
            <span className="text-yellow-400/60">Momentum</span>
            <span className="text-orange-400/60">Chaud</span>
            <span className="text-red-400/60">FOMO</span>
          </div>
        </div>
        <div className="flex-1 w-full space-y-3">
          {items.map(({ key, label, max }) => {
            const pts = breakdown[key];
            const pct = (pts / max) * 100;
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-terminal-textMuted">{label}</span>
                  <span className="text-xs font-mono font-semibold text-terminal-text">
                    {pts}<span className="text-terminal-textDim">/{max}</span>
                  </span>
                </div>
                <div className="h-1.5 bg-terminal-bg rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ringColor + 'cc' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Heatmap Retours Mensuels ──────────────────────────────────────────────────
function MonthlyHeatmap({ monthly, etfLabel }: { monthly: MonthlyData; etfLabel: string }) {
  const { years, yearData, annualReturns, avgByMonth } = monthly;
  if (!years.length) return (
    <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
      <p className="text-sm text-terminal-textDim">Données historiques insuffisantes pour le heatmap mensuel.</p>
    </div>
  );
  const recentYears = years.slice(-12);
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider">
          Monthly Returns Heatmap
        </h2>
        <span className="text-[10px] font-mono text-terminal-textDim bg-terminal-surfaceHi px-2 py-0.5 rounded">
          {etfLabel}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs min-w-[700px] w-full border-separate border-spacing-0.5">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-terminal-textMuted w-12">Year</th>
              {MONTH_LABELS.map(m => (
                <th key={m} className="px-1 py-1 text-center text-terminal-textMuted w-14">{m}</th>
              ))}
              <th className="px-2 py-1 text-center text-terminal-textMuted">Year</th>
            </tr>
          </thead>
          <tbody>
            {recentYears.map(year => (
              <tr key={year}>
                <td className="px-2 py-0.5 text-terminal-textMuted font-mono font-semibold text-[11px]">{year}</td>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                  const ret = yearData[year]?.[month] ?? null;
                  return (
                    <td key={month} className="px-0 py-0">
                      <div className="rounded text-center py-1.5 px-0.5 leading-none"
                        style={ret !== null ? returnCellStyle(ret) : { background: '#0f1522', color: '#374151' }}>
                        {ret !== null
                          ? <span className="font-mono font-semibold text-[10px]">{ret >= 0 ? '+' : ''}{ret.toFixed(1)}</span>
                          : <span className="text-[10px]">—</span>}
                      </div>
                    </td>
                  );
                })}
                <td className="px-0.5 py-0">
                  {annualReturns[year] != null ? (
                    <div className="rounded text-center py-1.5 px-1 leading-none font-bold"
                      style={returnCellStyle(annualReturns[year]!)}>
                      <span className="font-mono text-[11px]">
                        {(annualReturns[year]! >= 0 ? '+' : '')}{annualReturns[year]!.toFixed(1)}%
                      </span>
                    </div>
                  ) : <span className="text-terminal-textDim text-[10px]">—</span>}
                </td>
              </tr>
            ))}
            {/* Ligne moyenne */}
            <tr>
              <td className="px-2 py-1 text-terminal-textMuted text-[10px] font-semibold">Avg</td>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                const avg = avgByMonth[month];
                return (
                  <td key={month} className="px-0 py-0.5">
                    <div className="rounded text-center py-1 px-0.5 leading-none"
                      style={avg != null ? returnCellStyle(avg) : { background: '#0f1522', color: '#374151' }}>
                      {avg != null
                        ? <span className="font-mono font-semibold text-[10px]">{avg >= 0 ? '+' : ''}{avg.toFixed(1)}</span>
                        : <span className="text-[10px] text-terminal-textDim">—</span>}
                    </div>
                  </td>
                );
              })}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {/* Échelle */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <span className="text-[10px] text-terminal-textDim">Échelle :</span>
        {[-8, -4, -1, 0, 1, 4, 8].map(v => (
          <span key={v} className="px-2 py-0.5 rounded font-mono text-[10px]"
            style={v !== 0 ? returnCellStyle(v) : { background: '#1a2035', color: '#6b7280' }}>
            {v > 0 ? '+' : ''}{v}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Performances Annuelles (bar chart) ────────────────────────────────────────
function AnnualPerfChart({ monthly, etfLabel }: { monthly: MonthlyData; etfLabel: string }) {
  const { years, annualReturns } = monthly;
  if (!years.length) return null;
  const barData = years.map(y => ({ year: String(y), ret: annualReturns[y] ?? 0 }));
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider">
          Performances Annuelles
        </h2>
        <span className="text-[10px] font-mono text-terminal-textDim bg-terminal-surfaceHi px-2 py-0.5 rounded">
          {etfLabel}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={barData} barCategoryGap="25%" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="2 6" stroke="rgba(42,48,64,0.4)" />
          <XAxis dataKey="year" tick={{ fill: '#7a8294', fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fill: '#7a8294', fontSize: 10 }} tickLine={false} axisLine={false} width={44}
            tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
          />
          <Tooltip
            contentStyle={{ background: '#1a2035', border: '1px solid #2a3040', borderRadius: 4, fontSize: 11 }}
            labelStyle={{ color: '#7a8294' }}
            formatter={(v: unknown) => [
              `${typeof v === 'number' ? (v >= 0 ? '+' : '') + v.toFixed(1) : v}%`,
              'Retour annuel',
            ]}
          />
          <Bar dataKey="ret" radius={[3, 3, 0, 0]} maxBarSize={40}>
            {barData.map((d, i) => (
              <Cell key={i} fill={d.ret >= 0 ? '#26a69a' : '#ef5350'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Config indices ────────────────────────────────────────────────────────────

const INDICES = [
  { key: 'sp500',       label: 'S&P 500',    sub: 'US · 500 titres'  },
  { key: 'nasdaq100',   label: 'Nasdaq 100', sub: 'US · Tech'        },
  { key: 'dowjones',    label: 'Dow Jones',  sub: 'US · 30 blue chips'},
  { key: 'cac40',       label: 'CAC 40',     sub: 'France · 40 titres'},
  { key: 'commodities', label: 'Matières 1ères', sub: 'Or · Pétrole · Agri' },
];

const TOP_N = 10; // top 10 titres par secteur en vue globale (les plus influents)

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HeatmapPage() {
  const [selIdx,          setSelIdx]          = useState('sp500');
  const [data,            setData]            = useState<HeatmapResponse | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [expandedSector,  setExpandedSector]  = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 1000, h: 620 });

  // Historique prix pour monthly heatmap / FOMO
  const [indexHistory,    setIndexHistory]    = useState<HistoricalPoint[]>([]);
  const [loadingHistory,  setLoadingHistory]  = useState(false);

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

  // Fetch heatmap data
  useEffect(() => {
    setLoading(true); setError(null); setData(null); setExpandedSector(null);
    fetch(`${API_BASE}/api/heatmap?index=${selIdx}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: HeatmapResponse) => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [selIdx]);

  // Fetch historical data for monthly returns / FOMO
  useEffect(() => {
    const etf = INDEX_ETF[selIdx];
    if (!etf) return;
    setLoadingHistory(true);
    setIndexHistory([]);
    fetch(`${API_BASE}/api/instruments/chart/${etf}?period=max&interval=1d`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { data?: HistoricalPoint[] } | null) => {
        setIndexHistory(d?.data ?? []);
        setLoadingHistory(false);
      })
      .catch(() => setLoadingHistory(false));
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

  // ── Retours mensuels / FOMO ───────────────────────────────────────────────
  const monthlyData = useMemo(() => computeMonthlyReturns(indexHistory), [indexHistory]);
  const fomoResult  = useMemo(
    () => data ? computeIndexFomo(indexHistory, data.sectors) : null,
    [indexHistory, data],
  );
  const etfLabel = INDEX_ETF_LABEL[selIdx] ?? selIdx.toUpperCase();

  // ── Analytics: top holdings & sector breakdown ────────────────────────────
  const topHoldings = useMemo(() => {
    if (!data) return [];
    const all = data.sectors.flatMap(sec =>
      sec.stocks.map(s => ({ ...s, sector: sec.name }))
    );
    return all
      .filter(s => s.market_cap != null && (s.market_cap as number) > 0)
      .sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))
      .slice(0, 15);
  }, [data]);

  const sectorBreakdown = useMemo(() => {
    if (!data) return [];
    const total = data.sectors.reduce((s, sec) => s + (sec.total_mktcap ?? 0), 0);
    if (!total) return [];
    return data.sectors
      .filter(s => (s.total_mktcap ?? 0) > 0)
      .map(s => ({
        name:       s.name,
        weight:     ((s.total_mktcap ?? 0) / total) * 100,
        avg_change: s.avg_change,
        count:      s.count,
      }))
      .sort((a, b) => b.weight - a.weight);
  }, [data]);

  return (
    <>
      <Head>
        <title>Market Heatmap — Monte Carlo</title>
        <meta name="description" content="Heatmap marché : tuiles proportionnelles à la capitalisation, colorées par variation" />
      </Head>

      <Header />

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
                Top {TOP_N} par secteur ({totalDisplayed} affiché / {data.total} total) · cliquer un secteur = voir tous
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
                      style={{ padding: '3px 4px', gap: 0 }}>
                      {/* Ticker */}
                      <span
                        className="text-white font-bold leading-none text-center w-full truncate"
                        style={{ fontSize: Math.min(14, Math.max(9, Math.min(tile.w / 4.5, tile.h / 3.5))) }}
                      >
                        {tile.ticker}
                      </span>
                      {/* Nom entreprise — grandes tuiles seulement */}
                      {tile.h >= 62 && tile.w >= 70 && (
                        <span
                          className="text-white/60 leading-none text-center w-full truncate"
                          style={{ fontSize: Math.min(10, Math.max(7, tile.w / 9)), marginTop: 2 }}
                        >
                          {tile.name}
                        </span>
                      )}
                      {/* Variation % */}
                      {tile.h >= 42 && tile.w >= 46 && (
                        <span
                          className="font-mono font-semibold leading-none text-center"
                          style={{
                            fontSize: Math.min(12, Math.max(8, Math.min(tile.w / 6, tile.h / 4.5))),
                            color:    changeColor(tile.change_pct),
                            marginTop: 2,
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

        {/* ── Analytics panels ─────────────────────────────────────── */}
        {!loading && !error && data && (topHoldings.length > 0 || sectorBreakdown.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pb-6">

            {/* ── Top Holdings ───────────────────────────────────────── */}
            <div className="bg-terminal-surface border border-terminal-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border">
                <div>
                  <h2 className="text-sm font-semibold text-terminal-text">Top Holdings</h2>
                  <p className="text-[11px] text-terminal-textDim mt-0.5">
                    Positions les plus importantes — {data.label}
                  </p>
                </div>
                <span className="text-[10px] font-mono text-terminal-textDim bg-terminal-surfaceHi px-2 py-0.5 rounded">
                  TOP {topHoldings.length}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-terminal-border">
                      <th className="text-left px-4 py-2 text-terminal-textDim font-medium w-8">#</th>
                      <th className="text-left px-3 py-2 text-terminal-textDim font-medium">Ticker</th>
                      <th className="text-left px-3 py-2 text-terminal-textDim font-medium hidden sm:table-cell">Nom</th>
                      <th className="text-left px-3 py-2 text-terminal-textDim font-medium hidden md:table-cell">Secteur</th>
                      <th className="text-right px-3 py-2 text-terminal-textDim font-medium">Poids</th>
                      <th className="text-right px-4 py-2 text-terminal-textDim font-medium">Variation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topHoldings.map((stock, i) => (
                      <tr
                        key={stock.ticker}
                        className="border-b border-terminal-border/50 hover:bg-terminal-surfaceHi/50 transition-colors"
                      >
                        <td className="px-4 py-2.5 text-terminal-textDim font-mono">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/instrument/${stock.ticker}`}
                            className="font-bold text-terminal-cyan hover:underline font-mono"
                          >
                            {stock.ticker}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-terminal-textMuted hidden sm:table-cell truncate max-w-[140px]">
                          {stock.name}
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell">
                          <span className="text-[10px] text-terminal-textDim bg-terminal-surfaceHi px-1.5 py-0.5 rounded truncate max-w-[100px] block">
                            {(stock as any).sector}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="hidden sm:block w-16 h-1.5 rounded-full bg-terminal-surfaceHi overflow-hidden">
                              <div
                                className="h-full rounded-full bg-terminal-cyan/70"
                                style={{ width: `${Math.min(100, ((stock.market_cap ?? 0) / (topHoldings[0].market_cap ?? 1)) * 100)}%` }}
                              />
                            </div>
                            <span className="font-mono text-terminal-text">
                              {(stock.market_cap ?? 0).toFixed(2)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold"
                          style={{ color: changeColor(stock.change_pct) }}>
                          {fmt(stock.change_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Sector Breakdown ──────────────────────────────────── */}
            <div className="bg-terminal-surface border border-terminal-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border">
                <div>
                  <h2 className="text-sm font-semibold text-terminal-text">Sector Breakdown</h2>
                  <p className="text-[11px] text-terminal-textDim mt-0.5">
                    Poids par secteur dans {data.label}
                  </p>
                </div>
                <span className="text-[10px] font-mono text-terminal-textDim bg-terminal-surfaceHi px-2 py-0.5 rounded">
                  {sectorBreakdown.length} secteurs
                </span>
              </div>

              {/* Camembert + liste */}
              <div className="flex flex-col sm:flex-row gap-0 items-start px-4 py-4">

                {/* Pie chart */}
                <div className="shrink-0 flex items-center justify-center sm:justify-start w-full sm:w-auto">
                  <PieChart width={170} height={170}>
                    <Pie
                      data={sectorBreakdown.map((s, i) => ({
                        name:  s.name,
                        value: parseFloat(s.weight.toFixed(1)),
                        color: sectorColor(s.name, i),
                      }))}
                      cx={82} cy={82}
                      innerRadius={44} outerRadius={74}
                      dataKey="value"
                      paddingAngle={1}
                    >
                      {sectorBreakdown.map((s, i) => (
                        <Cell key={s.name} fill={sectorColor(s.name, i)} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#1a2035', border: '1px solid #2a3040', borderRadius: 4, fontSize: 11 }}
                      formatter={(v: unknown) => [`${typeof v === 'number' ? v.toFixed(1) : v}%`]}
                    />
                  </PieChart>
                </div>

                {/* Liste secteurs : nom + variation (pas de barre) */}
                <div className="flex-1 space-y-1 min-w-0 sm:pl-3">
                  {sectorBreakdown.map((sec, i) => (
                    <div key={sec.name} className="flex items-center gap-2 py-0.5">
                      {/* Pastille couleur */}
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ background: sectorColor(sec.name, i) }}
                      />
                      {/* Nom secteur */}
                      <span className="text-[11px] text-terminal-textMuted flex-1 truncate">
                        {sec.name}
                      </span>
                      {/* Poids */}
                      <span className="text-[10px] font-mono text-terminal-textDim shrink-0">
                        {sec.weight.toFixed(1)}%
                      </span>
                      {/* Variation */}
                      <span
                        className="text-[11px] font-mono font-semibold shrink-0 w-14 text-right"
                        style={{ color: changeColor(sec.avg_change) }}
                      >
                        {fmt(sec.avg_change)}
                      </span>
                    </div>
                  ))}
                </div>

              </div>
            </div>

          </div>
        )}

        {/* ── FOMO + Performances annuelles ────────────────────────── */}
        {(loadingHistory || fomoResult || monthlyData.years.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <IndexFomoCard result={fomoResult} loading={loadingHistory && !fomoResult} />
            <AnnualPerfChart monthly={monthlyData} etfLabel={etfLabel} />
          </div>
        )}

        {/* ── Monthly Returns Heatmap ───────────────────────────────── */}
        {(loadingHistory || monthlyData.years.length > 0) && (
          loadingHistory && !monthlyData.years.length ? (
            <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5 flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-terminal-cyan border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-sm text-terminal-textMuted">Chargement des données historiques ({etfLabel})…</span>
            </div>
          ) : (
            <MonthlyHeatmap monthly={monthlyData} etfLabel={etfLabel} />
          )
        )}

      </div>
    </>
  );
}
