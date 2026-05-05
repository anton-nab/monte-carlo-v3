/**
 * TradingViewChart — wrapper React pour lightweight-charts.
 *
 * QUOI: Composant qui transforme une serie temporelle en graphique pro,
 *       style TradingView (utilise par Coinbase, Binance, etc.).
 * POURQUOI: Recharts c'est OK pour des sparklines basiques, mais pour le
 *           "look terminal" on a besoin de quelque chose de plus dense
 *           et performant. lightweight-charts pese ~50KB et gere des
 *           millions de points sans broncher.
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
  AreaSeries,
  LineSeries,
} from 'lightweight-charts';

interface DataPoint {
  date: string;
  value: number;
}

interface TradingViewChartProps {
  data: DataPoint[];
  height?: number;
  /** Color of the line (hex). Auto-derives from trend if not passed. */
  color?: string;
  /** Show area fill below the line (visual emphasis) */
  fill?: boolean;
  /** Show price scale on right (default true for full-size, false for sparklines) */
  showAxes?: boolean;
}

export function TradingViewChart({
  data,
  height = 240,
  color = '#26a69a',
  fill = true,
  showAxes = true,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area' | 'Line'> | null>(null);

  // Init chart once
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
        mode: 1, // Magnet to data
        vertLine: { color: '#00d9ff', width: 1, style: 2 },
        horzLine: { color: '#00d9ff', width: 1, style: 2 },
      },
      handleScroll: showAxes,
      handleScale: showAxes,
    });

    if (fill) {
      // lightweight-charts v5 API: addSeries(SeriesDefinition, options)
      const series = chart.addSeries(AreaSeries, {
        lineColor: color,
        topColor: `${color}55`,    // 33% opacity
        bottomColor: `${color}05`, // ~2% opacity
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

    // Resize listener
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
  }, [height, color, fill, showAxes]);

  // Update data when it changes
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    const formatted: (LineData | AreaData)[] = data
      .filter((p) => Number.isFinite(p.value))
      .map((p) => ({
        time: p.date as Time,
        value: p.value,
      }));

    seriesRef.current.setData(formatted);
    chartRef.current.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
