/**
 * TradingViewChart — wrapper React pour lightweight-charts.
 *
 * Supports:
 * - Line/area chart (single value per point)
 * - Candlestick chart (OHLC per point)
 * - Intraday mode: Unix-second timestamps + time axis label
 *
 * Doc lib: https://tradingview.github.io/lightweight-charts/
 */

import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  LineData,
  Time,
  AreaData,
  CandlestickData,
  AreaSeries,
  LineSeries,
  CandlestickSeries,
} from 'lightweight-charts';

interface DataPoint {
  date: string;
  value: number;
}

interface OHLCPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type ChartType = 'line' | 'area' | 'candle';

interface TradingViewChartProps {
  /** Line/area data — used when chartType is 'line' or 'area' */
  data?: DataPoint[];
  /** OHLC data — used when chartType is 'candle' */
  ohlcData?: OHLCPoint[];
  /** Chart type — defaults to 'area' (or 'line' if fill=false). */
  chartType?: ChartType;
  /** Legacy prop: if true => area, false => line. Ignored if chartType is set. */
  fill?: boolean;
  height?: number;
  /** Color of the line (hex). For candles, ignored. */
  color?: string;
  /** Show price scale on right (default true) */
  showAxes?: boolean;
  /**
   * When true: dates are ISO datetime strings (e.g. "2024-01-15T14:30:00+00:00").
   * They will be converted to Unix seconds. Time axis label will show H:MM.
   * When false (default): dates are "YYYY-MM-DD" strings.
   */
  isIntraday?: boolean;
  /**
   * Plage de dates initialement visibles. Si fournie, le chart cadre dessus
   * mais TOUTES les donnees restent dans le chart.
   * Ignored when isIntraday=true (data already covers the exact window).
   */
  visibleRange?: { from: string; to: string };
}

/**
 * Convert a date string to a lightweight-charts Time value.
 * - Daily: "YYYY-MM-DD" string (lightweight-charts native format)
 * - Intraday: ISO datetime → Unix seconds (number)
 */
function toChartTime(dateStr: string, isIntraday: boolean): Time {
  if (isIntraday) {
    return Math.floor(new Date(dateStr).getTime() / 1000) as Time;
  }
  // Trim any time/timezone suffix: "2024-01-15T00:00:00+00:00" → "2024-01-15"
  return dateStr.split('T')[0] as Time;
}

export function TradingViewChart({
  data,
  ohlcData,
  chartType,
  fill,
  height = 240,
  color = '#26a69a',
  showAxes = true,
  isIntraday = false,
  visibleRange,
}: TradingViewChartProps) {
  // Resolve chartType from explicit prop or legacy fill prop
  const resolvedChartType: ChartType =
    chartType ?? (fill === false ? 'line' : 'area');
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area' | 'Line' | 'Candlestick'> | null>(null);

  // Init chart on mount and when chartType/color/isIntraday changes
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#5a4f4f',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(231,229,227,0.8)' },
        horzLines: { color: 'rgba(231,229,227,0.8)' },
      },
      rightPriceScale: {
        visible: showAxes,
        borderColor: '#e7e5e3',
      },
      timeScale: {
        visible: showAxes,
        borderColor: '#e7e5e3',
        timeVisible: isIntraday,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#b92e25', width: 1, style: 2 },
        horzLine: { color: '#b92e25', width: 1, style: 2 },
      },
      handleScroll: showAxes,
      handleScale: showAxes,
    });

    if (resolvedChartType === 'candle') {
      const series = chart.addSeries(CandlestickSeries, {
        upColor:        '#009371',
        downColor:      '#b92e25',
        borderUpColor:  '#009371',
        borderDownColor:'#b92e25',
        wickUpColor:    '#009371',
        wickDownColor:  '#b92e25',
      });
      seriesRef.current = series;
    } else if (resolvedChartType === 'area') {
      const series = chart.addSeries(AreaSeries, {
        lineColor: color,
        topColor: `${color}55`,
        bottomColor: `${color}05`,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: showAxes,
      });
      seriesRef.current = series;
    } else {
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: showAxes,
      });
      seriesRef.current = series;
    }

    chartRef.current = chart;

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, color, showAxes, resolvedChartType, isIntraday]);

  // Update data when it changes
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    if (resolvedChartType === 'candle' && ohlcData) {
      const formatted: CandlestickData[] = ohlcData.map((p) => ({
        time: toChartTime(p.date, isIntraday),
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
      }));
      (seriesRef.current as ISeriesApi<'Candlestick'>).setData(formatted);
    } else if (data) {
      const formatted: (LineData | AreaData)[] = data
        .filter((p) => Number.isFinite(p.value))
        .map((p) => ({
          time: toChartTime(p.date, isIntraday),
          value: p.value,
        }));
      (seriesRef.current as ISeriesApi<'Line' | 'Area'>).setData(formatted);
    }

    // Apply visible range only for non-intraday with explicit range
    if (!isIntraday && visibleRange) {
      chartRef.current.timeScale().setVisibleRange({
        from: visibleRange.from as Time,
        to: visibleRange.to as Time,
      });
    } else {
      chartRef.current.timeScale().fitContent();
    }
  }, [data, ohlcData, resolvedChartType, isIntraday, visibleRange]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
