/**
 * TradingViewChart — lightweight-charts v5 wrapper
 *
 * Features:
 *  - Line / Area / Candlestick chart types
 *  - Intraday support (ISO datetime → Unix seconds)
 *  - Theme-aware: reads `html.dark` class, re-creates chart on toggle
 *  - Dashed grid lines (subtle, not solid)
 *  - overlays prop: additional line series (EMA, Bollinger bands …)
 *  - volumeData prop: histogram series at the bottom 20 % of the chart
 *
 * Doc: https://tradingview.github.io/lightweight-charts/
 */

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  IChartApi,
  ISeriesApi,
  LineData,
  Time,
  AreaData,
  CandlestickData,
  AreaSeries,
  LineSeries,
  CandlestickSeries,
  HistogramSeries,
} from 'lightweight-charts';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

interface DataPoint  { date: string; value: number }
interface OHLCPoint  { date: string; open: number; high: number; low: number; close: number }

/** A single overlay line (EMA, Bollinger band …) drawn on top of the main chart */
export interface OverlayLine {
  data:       DataPoint[];
  color:      string;
  lineWidth?: 1 | 2;
  /** 0=solid 1=dotted 2=dashed 3=large-dashed 4=sparse-dotted */
  lineStyle?: number;
}

/** Volume bar data — color should be bull/bear green/red */
export interface VolumePoint {
  date:   string;
  value:  number;
  color?: string;
}

export type ChartType = 'line' | 'area' | 'candle';

interface TradingViewChartProps {
  /** Line / area data — used when chartType is 'line' or 'area' */
  data?: DataPoint[];
  /** OHLC data — used when chartType is 'candle' */
  ohlcData?: OHLCPoint[];
  /** Chart type — defaults to 'area' (or 'line' if fill=false) */
  chartType?: ChartType;
  /** Legacy: if false => line, true => area. Ignored if chartType is set. */
  fill?: boolean;
  height?: number;
  /** Line colour (hex). Candlestick colours are fixed green/red. */
  color?: string;
  /** Show price scale + time axis (default true) */
  showAxes?: boolean;
  /**
   * Intraday mode: dates are ISO datetime strings → converted to Unix seconds.
   * Time-axis label shows H:MM.
   */
  isIntraday?: boolean;
  /**
   * Initial visible date range for daily charts.
   * All data stays in the chart; this just sets the viewport.
   */
  visibleRange?: { from: string; to: string };
  /** Additional line series drawn on the main chart (EMA, Bollinger …) */
  overlays?: OverlayLine[];
  /** Volume histogram drawn at the bottom 20 % of the chart */
  volumeData?: VolumePoint[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toChartTime(dateStr: string, isIntraday: boolean): Time {
  if (isIntraday) return Math.floor(new Date(dateStr).getTime() / 1000) as Time;
  return dateStr.split('T')[0] as Time;
}

function isDarkTheme(): boolean {
  return typeof document !== 'undefined'
    ? document.documentElement.classList.contains('dark')
    : true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function TradingViewChart({
  data,
  ohlcData,
  chartType,
  fill,
  height  = 240,
  color   = '#26a69a',
  showAxes = true,
  isIntraday = false,
  visibleRange,
  overlays,
  volumeData,
}: TradingViewChartProps) {
  const resolvedChartType: ChartType =
    chartType ?? (fill === false ? 'line' : 'area');

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  // Series refs — populated in init effect, used in the same effect
  const mainSeriesRef    = useRef<ISeriesApi<'Area' | 'Line' | 'Candlestick'> | null>(null);
  const overlayRefsRef   = useRef<ISeriesApi<'Line'>[]>([]);
  const volSeriesRef     = useRef<ISeriesApi<'Histogram'> | null>(null);

  // ── Theme detection ─────────────────────────────────────────────────────────
  const [dark, setDark] = useState(isDarkTheme);

  useEffect(() => {
    const update = () => setDark(isDarkTheme());
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => obs.disconnect();
  }, []);

  // ── Chart init effect ───────────────────────────────────────────────────────
  // Re-creates the chart when structural settings change.
  // Data is loaded separately below to avoid a full re-create on every
  // SWR refresh.
  //
  // `overlayKey` encodes overlay structure (count + per-line color/style) so
  // the chart re-creates only when the user toggles an indicator,
  // not on every data refresh.
  const overlayKey = (overlays ?? [])
    .map((o) => `${o.color}|${o.lineWidth ?? 1}|${o.lineStyle ?? 0}`)
    .join(',') + (volumeData != null ? '|vol' : '');

  useEffect(() => {
    if (!containerRef.current) return;

    const textColor   = dark ? '#9ca3af' : '#5a4f4f';
    const gridColor   = dark ? 'rgba(42,48,64,0.55)' : 'rgba(180,180,180,0.35)';
    const borderColor = dark ? '#2a3040' : '#e0ddd9';

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: gridColor, style: LineStyle.LargeDashed },
        horzLines: { color: gridColor, style: LineStyle.LargeDashed },
      },
      rightPriceScale: {
        visible:     showAxes,
        borderColor: borderColor,
      },
      timeScale: {
        visible:        showAxes,
        borderColor:    borderColor,
        timeVisible:    isIntraday,
        secondsVisible: false,
      },
      crosshair: {
        mode:     1,
        vertLine: { color: '#b92e25', width: 1, style: LineStyle.Dashed },
        horzLine: { color: '#b92e25', width: 1, style: LineStyle.Dashed },
      },
      handleScroll: showAxes,
      handleScale:  showAxes,
    });
    chartRef.current = chart;

    // ── Main series ──────────────────────────────────────────────────────────
    if (resolvedChartType === 'candle') {
      mainSeriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor:         '#009371',
        downColor:       '#b92e25',
        borderUpColor:   '#009371',
        borderDownColor: '#b92e25',
        wickUpColor:     '#009371',
        wickDownColor:   '#b92e25',
      });
    } else if (resolvedChartType === 'area') {
      mainSeriesRef.current = chart.addSeries(AreaSeries, {
        lineColor:        color,
        topColor:         `${color}55`,
        bottomColor:      `${color}05`,
        lineWidth:        2,
        priceLineVisible: false,
        lastValueVisible: showAxes,
      });
    } else {
      mainSeriesRef.current = chart.addSeries(LineSeries, {
        color,
        lineWidth:        2,
        priceLineVisible: false,
        lastValueVisible: showAxes,
      });
    }

    // ── Overlay series (EMA, Bollinger …) ───────────────────────────────────
    overlayRefsRef.current = [];
    for (const ov of overlays ?? []) {
      const s = chart.addSeries(LineSeries, {
        color:               ov.color,
        lineWidth:           ov.lineWidth ?? 1,
        lineStyle:           ov.lineStyle ?? 0,
        priceLineVisible:    false,
        lastValueVisible:    false,
        crosshairMarkerVisible: false,
      });
      overlayRefsRef.current.push(s);
    }

    // ── Volume histogram ─────────────────────────────────────────────────────
    volSeriesRef.current = null;
    if (volumeData != null) {
      const vs = chart.addSeries(HistogramSeries, {
        priceScaleId:     'vol',
        priceLineVisible: false,
        lastValueVisible: false,
      });
      vs.priceScale().applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });
      volSeriesRef.current = vs;
    }

    // ── Resize observer ──────────────────────────────────────────────────────
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current    = null;
      mainSeriesRef.current  = null;
      overlayRefsRef.current = [];
      volSeriesRef.current   = null;
    };
    // overlayKey captures overlay structure; dark captures theme
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, color, showAxes, resolvedChartType, isIntraday, dark, overlayKey]);

  // ── Data update effect ──────────────────────────────────────────────────────
  // Runs when data changes without re-creating the chart.
  useEffect(() => {
    const chart      = chartRef.current;
    const mainSeries = mainSeriesRef.current;
    if (!chart || !mainSeries) return;

    // Main series data
    if (resolvedChartType === 'candle' && ohlcData) {
      const formatted: CandlestickData[] = ohlcData.map((p) => ({
        time:  toChartTime(p.date, isIntraday),
        open:  p.open,
        high:  p.high,
        low:   p.low,
        close: p.close,
      }));
      (mainSeries as ISeriesApi<'Candlestick'>).setData(formatted);
    } else if (data) {
      const formatted: (LineData | AreaData)[] = data
        .filter((p) => Number.isFinite(p.value))
        .map((p) => ({
          time:  toChartTime(p.date, isIntraday),
          value: p.value,
        }));
      (mainSeries as ISeriesApi<'Line' | 'Area'>).setData(formatted);
    }

    // Overlay data
    const overlaySeries = overlayRefsRef.current;
    for (let i = 0; i < overlaySeries.length; i++) {
      const ov = overlays?.[i];
      if (!ov) continue;
      overlaySeries[i].setData(
        ov.data
          .filter((p) => Number.isFinite(p.value))
          .map((p) => ({
            time:  toChartTime(p.date, isIntraday),
            value: p.value,
          })),
      );
    }

    // Volume data
    if (volSeriesRef.current && volumeData) {
      volSeriesRef.current.setData(
        volumeData.map((p) => ({
          time:  toChartTime(p.date, isIntraday),
          value: p.value,
          color: p.color ?? '#26a69a55',
        })),
      );
    }

    // Visible range / fit
    if (!isIntraday && visibleRange) {
      chart.timeScale().setVisibleRange({
        from: visibleRange.from as Time,
        to:   visibleRange.to   as Time,
      });
    } else {
      chart.timeScale().fitContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ohlcData, overlays, volumeData, resolvedChartType, isIntraday, visibleRange]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
