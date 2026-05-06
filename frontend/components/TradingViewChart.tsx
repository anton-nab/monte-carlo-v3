/**
 * TradingViewChart — wrapper React pour lightweight-charts.
 *
 * Supports:
 * - Line/area chart (single value per point)
 * - Candlestick chart (OHLC per point)
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
   * Plage de dates initialement visibles. Si fournie, le chart cadre dessus
   * mais TOUTES les donnees restent dans le chart.
   */
  visibleRange?: { from: string; to: string };
}

export function TradingViewChart({
  data,
  ohlcData,
  chartType,
  fill,
  height = 240,
  color = '#26a69a',
  showAxes = true,
  visibleRange,
}: TradingViewChartProps) {
  // Resolve chartType from explicit prop or legacy fill prop
  const resolvedChartType: ChartType =
    chartType ?? (fill === false ? 'line' : 'area');
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area' | 'Line' | 'Candlestick'> | null>(null);

  // Init chart on mount and when chartType/color changes
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#7a8294',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(42,48,64,0.3)' },
        horzLines: { color: 'rgba(42,48,64,0.3)' },
      },
      rightPriceScale: {
        visible: showAxes,
        borderColor: '#2a3040',
      },
      timeScale: {
        visible: showAxes,
        borderColor: '#2a3040',
        timeVisible: false,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#00d9ff', width: 1, style: 2 },
        horzLine: { color: '#00d9ff', width: 1, style: 2 },
      },
      handleScroll: showAxes,
      handleScale: showAxes,
    });

    if (resolvedChartType === 'candle') {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
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
  }, [height, color, showAxes, resolvedChartType]);

  // Update data when it changes
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    if (resolvedChartType === 'candle' && ohlcData) {
      const formatted: CandlestickData[] = ohlcData.map((p) => ({
        time: p.date as Time,
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
          time: p.date as Time,
          value: p.value,
        }));
      (seriesRef.current as ISeriesApi<'Line' | 'Area'>).setData(formatted);
    }

    // Apply visible range if provided
    if (visibleRange) {
      chartRef.current.timeScale().setVisibleRange({
        from: visibleRange.from as Time,
        to: visibleRange.to as Time,
      });
    } else {
      chartRef.current.timeScale().fitContent();
    }
  }, [data, ohlcData, resolvedChartType, visibleRange]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
