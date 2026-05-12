/**
 * TradingViewChart — lightweight-charts v5 wrapper
 *
 * Features:
 *  - Line / Area / Candlestick chart types
 *  - Intraday support (ISO datetime → Unix seconds)
 *  - Theme-aware: reads `html.dark` class via MutationObserver
 *  - Dashed grid lines (LargeDashed, subtle)
 *  - overlays prop: additional LineSeries (EMA, Bollinger …)
 *  - volumeData prop: histogram at bottom ~30% of chart (in-chart, always synced)
 *  - onVisibleRangeChange: fires debounced unix-second range for sub-panel sync
 *
 * Bug fix: init + data loading combined in ONE effect so the chart is never
 * left blank after a theme toggle (the data effect no longer trails behind).
 */

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  IChartApi,
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

interface DataPoint { date: string; value: number }
interface OHLCPoint { date: string; open: number; high: number; low: number; close: number }

/** Single overlay line drawn on top of the main chart (EMA, Bollinger …) */
export interface OverlayLine {
  data:       DataPoint[];
  color:      string;
  lineWidth?: 1 | 2;
  /** 0=solid 1=dotted 2=dashed 3=large-dashed 4=sparse-dotted */
  lineStyle?: number;
}

/** Volume bar — color should reflect bull/bear */
export interface VolumePoint {
  date:   string;
  value:  number;
  color?: string;
}

export type ChartType = 'line' | 'area' | 'candle';

interface TradingViewChartProps {
  data?:         DataPoint[];
  ohlcData?:     OHLCPoint[];
  chartType?:    ChartType;
  /** Legacy: false → line, true → area. Ignored when chartType is set. */
  fill?:         boolean;
  height?:       number;
  color?:        string;
  showAxes?:     boolean;
  isIntraday?:   boolean;
  visibleRange?: { from: string; to: string };
  /** Additional LineSeries overlays (EMA, Bollinger …) */
  overlays?:     OverlayLine[];
  /** Volume histogram drawn at the bottom 30 % of the chart */
  volumeData?:   VolumePoint[];
  /**
   * Fires with the currently visible time window (unix seconds).
   * Debounced ~100 ms. Used by the instrument page to sync RSI/MACD panels.
   */
  onVisibleRangeChange?: (fromTs: number, toTs: number) => void;
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

/** Convert a LWC Time value to a Unix-second timestamp */
function timeToUnix(t: Time): number {
  if (typeof t === 'number') return t;
  // 'YYYY-MM-DD' string → midnight UTC
  return new Date(String(t) + 'T00:00:00Z').getTime() / 1000;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function TradingViewChart({
  data,
  ohlcData,
  chartType,
  fill,
  height   = 240,
  color    = '#26a69a',
  showAxes = true,
  isIntraday   = false,
  visibleRange,
  overlays,
  volumeData,
  onVisibleRangeChange,
}: TradingViewChartProps) {
  const resolvedChartType: ChartType =
    chartType ?? (fill === false ? 'line' : 'area');

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  // Keep the callback ref always current without requiring it as an effect dep
  const onRangeChangeRef = useRef(onVisibleRangeChange);
  useEffect(() => { onRangeChangeRef.current = onVisibleRangeChange; });

  // ── Theme detection ─────────────────────────────────────────────────────────
  const [dark, setDark] = useState(isDarkTheme);
  useEffect(() => {
    const update = () => setDark(isDarkTheme());
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  // ── Overlay structure key ────────────────────────────────────────────────────
  // Changes only when overlay count/colors/styles change (not on data refresh).
  // This determines whether the chart needs full re-creation.
  const overlayKey = (overlays ?? [])
    .map((o) => `${o.color}|${o.lineWidth ?? 1}|${o.lineStyle ?? 0}`)
    .join(',') + (volumeData != null ? '|vol' : '');

  // ── Single combined effect — creates chart, series, AND sets data ───────────
  // Combining init + data in one effect is the safest approach:
  // a separate data effect would trail a render cycle behind after a theme toggle,
  // leaving the chart momentarily blank.
  useEffect(() => {
    if (!containerRef.current) return;

    const textColor   = dark ? '#9ca3af' : '#5a4f4f';
    const gridColor   = dark ? 'rgba(42,48,64,0.55)' : 'rgba(180,180,180,0.35)';
    const borderColor = dark ? '#2a3040' : '#e0ddd9';

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height,
      layout: {
        background:  { type: ColorType.Solid, color: 'transparent' },
        textColor,
        fontFamily:  'JetBrains Mono, monospace',
        fontSize:    11,
      },
      grid: {
        vertLines: { color: gridColor, style: LineStyle.LargeDashed },
        horzLines: { color: gridColor, style: LineStyle.LargeDashed },
      },
      rightPriceScale: { visible: showAxes, borderColor, minimumWidth: 64 },
      timeScale:       { visible: showAxes, borderColor, timeVisible: isIntraday, secondsVisible: false },
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
    let mainSeries;
    if (resolvedChartType === 'candle') {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#009371', downColor: '#b92e25',
        borderUpColor: '#009371', borderDownColor: '#b92e25',
        wickUpColor: '#009371', wickDownColor: '#b92e25',
      });
    } else if (resolvedChartType === 'area') {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor: color, topColor: `${color}55`, bottomColor: `${color}05`,
        lineWidth: 2, priceLineVisible: false, lastValueVisible: showAxes,
      });
    } else {
      mainSeries = chart.addSeries(LineSeries, {
        color, lineWidth: 2, priceLineVisible: false, lastValueVisible: showAxes,
      });
    }

    // Main data
    if (resolvedChartType === 'candle' && ohlcData) {
      mainSeries.setData(
        ohlcData.map((p) => ({
          time: toChartTime(p.date, isIntraday),
          open: p.open, high: p.high, low: p.low, close: p.close,
        })) as CandlestickData[],
      );
    } else if (data) {
      mainSeries.setData(
        data.filter((p) => Number.isFinite(p.value)).map((p) => ({
          time: toChartTime(p.date, isIntraday), value: p.value,
        })) as (LineData | AreaData)[],
      );
    }

    // ── Overlay series (EMA, Bollinger …) ───────────────────────────────────
    for (const ov of overlays ?? []) {
      const s = chart.addSeries(LineSeries, {
        color:               ov.color,
        lineWidth:           ov.lineWidth ?? 1,
        lineStyle:           ov.lineStyle ?? 0,
        priceLineVisible:    false,
        lastValueVisible:    false,
        crosshairMarkerVisible: false,
      });
      s.setData(
        ov.data.filter((p) => Number.isFinite(p.value)).map((p) => ({
          time: toChartTime(p.date, isIntraday), value: p.value,
        })),
      );
    }

    // ── Volume histogram at bottom 30 % ─────────────────────────────────────
    if (volumeData != null) {
      const vs = chart.addSeries(HistogramSeries, {
        priceScaleId:     'vol',
        priceLineVisible: false,
        lastValueVisible: false,
      });
      vs.priceScale().applyOptions({ scaleMargins: { top: 0.70, bottom: 0 } });
      vs.setData(
        volumeData.map((p) => ({
          time:  toChartTime(p.date, isIntraday),
          value: p.value,
          color: p.color ?? '#26a69a44',
        })),
      );
    }

    // ── Visible range / fit ──────────────────────────────────────────────────
    if (!isIntraday && visibleRange) {
      chart.timeScale().setVisibleRange({
        from: visibleRange.from as Time,
        to:   visibleRange.to   as Time,
      });
    } else {
      chart.timeScale().fitContent();
    }

    // ── Subscribe to visible range for sub-panel sync ────────────────────────
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleRangeChange = (range: { from: Time; to: Time } | null) => {
      if (!range) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onRangeChangeRef.current?.(timeToUnix(range.from), timeToUnix(range.to));
      }, 100);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chart.timeScale().subscribeVisibleTimeRangeChange(handleRangeChange as any);

    // ── Resize observer ──────────────────────────────────────────────────────
    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, color, showAxes, resolvedChartType, isIntraday, dark, overlayKey,
      data, ohlcData, overlays, volumeData, visibleRange]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
