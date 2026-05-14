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
 *  - rsiData prop: RSI(14) rendered as a native LWC pane below the main chart
 *  - macdData prop: MACD(12,26,9) rendered as a native LWC pane below RSI
 *  All panes share the same time scale → perfect pan/zoom sync, no Recharts hacks.
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
  IPaneApi,
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

/** RSI data point for LWC pane */
export interface RsiPoint {
  date: string;
  rsi:  number;
}

/** MACD data point for LWC pane */
export interface MacdPoint {
  date:    string;
  hist:    number;
  macd?:   number;
  signal?: number;
}

export type ChartType = 'line' | 'area' | 'candle';

// Sub-pane heights (pixels)
const RSI_PANE_H  = 110;
const MACD_PANE_H = 110;

interface TradingViewChartProps {
  data?:         DataPoint[];
  ohlcData?:     OHLCPoint[];
  chartType?:    ChartType;
  /** Legacy: false → line, true → area. Ignored when chartType is set. */
  fill?:         boolean;
  /** Height of the MAIN price chart pane (sub-panes are added on top). */
  height?:       number;
  color?:        string;
  showAxes?:     boolean;
  isIntraday?:   boolean;
  visibleRange?: { from: string; to: string };
  /** Additional LineSeries overlays (EMA, Bollinger …) */
  overlays?:     OverlayLine[];
  /** Volume histogram drawn at the bottom 30 % of the main pane */
  volumeData?:   VolumePoint[];
  /** RSI(14) data — rendered as a separate LWC pane below the main chart */
  rsiData?:      RsiPoint[];
  /** MACD(12,26,9) data — rendered as a separate LWC pane below RSI */
  macdData?:     MacdPoint[];
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
  height   = 240,
  color    = '#26a69a',
  showAxes = true,
  isIntraday   = false,
  visibleRange,
  overlays,
  volumeData,
  rsiData,
  macdData,
}: TradingViewChartProps) {
  const resolvedChartType: ChartType =
    chartType ?? (fill === false ? 'line' : 'area');

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  // ── Theme detection ─────────────────────────────────────────────────────────
  const [dark, setDark] = useState(isDarkTheme);
  useEffect(() => {
    const update = () => setDark(isDarkTheme());
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  // ── Total container height ───────────────────────────────────────────────────
  const hasRsi  = (rsiData?.length  ?? 0) > 0;
  const hasMacd = (macdData?.length ?? 0) > 0;
  const totalHeight = height + (hasRsi ? RSI_PANE_H : 0) + (hasMacd ? MACD_PANE_H : 0);

  // ── Overlay structure key ────────────────────────────────────────────────────
  const overlayKey = (overlays ?? [])
    .map((o) => `${o.color}|${o.lineWidth ?? 1}|${o.lineStyle ?? 0}`)
    .join(',')
    + (volumeData != null ? '|vol' : '')
    + (hasRsi  ? '|rsi'  : '')
    + (hasMacd ? '|macd' : '');

  // ── Single combined effect — creates chart, series, AND sets data ───────────
  useEffect(() => {
    if (!containerRef.current) return;

    const textColor   = dark ? '#9ca3af' : '#5a4f4f';
    const gridColor   = dark ? 'rgba(42,48,64,0.55)' : 'rgba(180,180,180,0.35)';
    const borderColor = dark ? '#2a3040' : '#e0ddd9';

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: totalHeight,
      layout: {
        background:       { type: ColorType.Solid, color: 'transparent' },
        textColor,
        fontFamily:       'JetBrains Mono, monospace',
        fontSize:         11,
        attributionLogo:  false,
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

    // ── Fix main pane height ─────────────────────────────────────────────────
    const mainPane: IPaneApi<Time> = chart.panes()[0];
    mainPane.setHeight(height);

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

    // ── Volume histogram at bottom 30 % of main pane ─────────────────────────
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

    // ── RSI pane ─────────────────────────────────────────────────────────────
    if (hasRsi && rsiData) {
      const rsiPane: IPaneApi<Time> = chart.addPane();
      rsiPane.setHeight(RSI_PANE_H);

      const rsiLine = rsiPane.addSeries(LineSeries, {
        color:                 '#00d9ff',
        lineWidth:             1,
        priceLineVisible:      false,
        lastValueVisible:      false,
        crosshairMarkerVisible: false,
        // Lock Y-axis to [0, 100]
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: 0, maxValue: 100 },
          margins:    { above: 0.05, below: 0.05 },
        }),
      });
      rsiLine.setData(
        rsiData.map((p) => ({ time: toChartTime(p.date, isIntraday), value: p.rsi })),
      );

      // Reference lines: overbought / midline / oversold
      rsiLine.createPriceLine({ price: 70, color: '#ef535088', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
      rsiLine.createPriceLine({ price: 50, color: '#4b5563',   lineWidth: 1, lineStyle: LineStyle.Dotted,  axisLabelVisible: false });
      rsiLine.createPriceLine({ price: 30, color: '#26a69a88', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });

      // Price scale styling
      rsiPane.priceScale('right').applyOptions({ borderColor, textColor });
    }

    // ── MACD pane ─────────────────────────────────────────────────────────────
    if (hasMacd && macdData) {
      const macdPane: IPaneApi<Time> = chart.addPane();
      macdPane.setHeight(MACD_PANE_H);

      // Histogram (green/red bars)
      const histSeries = macdPane.addSeries(HistogramSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
      });
      histSeries.setData(
        macdData.map((p) => ({
          time:  toChartTime(p.date, isIntraday),
          value: p.hist,
          color: p.hist >= 0 ? '#009371aa' : '#b92e25aa',
        })),
      );

      // MACD line
      const macdLine = macdPane.addSeries(LineSeries, {
        color:                 '#00d9ff',
        lineWidth:             1,
        priceLineVisible:      false,
        lastValueVisible:      false,
        crosshairMarkerVisible: false,
      });
      const macdLineData = macdData
        .filter((p) => p.macd !== undefined)
        .map((p) => ({ time: toChartTime(p.date, isIntraday), value: p.macd as number }));
      macdLine.setData(macdLineData);

      // Signal line
      const signalLine = macdPane.addSeries(LineSeries, {
        color:                 '#ffa726',
        lineWidth:             1,
        priceLineVisible:      false,
        lastValueVisible:      false,
        crosshairMarkerVisible: false,
      });
      const signalData = macdData
        .filter((p) => p.signal !== undefined)
        .map((p) => ({ time: toChartTime(p.date, isIntraday), value: p.signal as number }));
      signalLine.setData(signalData);

      // Zero line
      histSeries.createPriceLine({ price: 0, color: '#6b7280', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false });

      macdPane.priceScale('right').applyOptions({ borderColor, textColor });
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

    // ── Resize observer ──────────────────────────────────────────────────────
    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, totalHeight, color, showAxes, resolvedChartType, isIntraday, dark, overlayKey,
      data, ohlcData, overlays, volumeData, rsiData, macdData, visibleRange]);

  return <div ref={containerRef} style={{ width: '100%', height: totalHeight }} />;
}
