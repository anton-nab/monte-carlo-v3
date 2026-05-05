/**
 * Instrument Page — /instrument/{ticker}
 *
 * Displays:
 * - Real-time quote (price, change, volume)
 * - Interactive chart with period selector
 * - Company fundamentals (P/E, PB, ROE, market cap, etc.)
 */

import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { TradingViewChart } from '../../components/TradingViewChart';

interface QuoteData {
  ticker: string;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
  timestamp: string;
}

interface FundamentalsData {
  ticker: string;
  name?: string;
  sector?: string;
  industry?: string;
  market_cap?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  roe?: number;
  dividend_yield?: number;
  debt_to_equity?: number;
  eps?: number;
  beta?: number;
}

interface HistoricalPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartDataPoint {
  date: string;
  value: number;
}

const CHART_PERIODS = [
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: '1Y', value: '1y' },
  { label: '5Y', value: '5y' },
  { label: 'Max', value: 'max' },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function InstrumentPage() {
  const router = useRouter();
  const { ticker } = router.query;
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('1y');
  const [isLoadingChart, setIsLoadingChart] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch quote + fundamentals on ticker change
  useEffect(() => {
    if (!ticker) return;

    const fetchQuote = async () => {
      try {
        const res = await fetch(`${API_URL}/api/instruments/quote/${ticker}`);
        if (res.ok) setQuote(await res.json());
      } catch (err) {
        console.error('Quote fetch error:', err);
      }
    };

    const fetchFundamentals = async () => {
      try {
        const res = await fetch(`${API_URL}/api/instruments/fundamentals/${ticker}`);
        if (res.ok) setFundamentals(await res.json());
      } catch (err) {
        console.error('Fundamentals fetch error:', err);
      }
    };

    fetchQuote();
    fetchFundamentals();

    const interval = setInterval(fetchQuote, 30000);
    return () => clearInterval(interval);
  }, [ticker]);

  // Fetch chart data when ticker or period changes
  useEffect(() => {
    if (!ticker) return;

    const fetchChart = async () => {
      setIsLoadingChart(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_URL}/api/instruments/chart/${ticker}?period=${selectedPeriod}&interval=1d`
        );
        if (res.ok) {
          const data = await res.json();
          const points: ChartDataPoint[] = (data.data || []).map((p: HistoricalPoint) => ({
            date: p.date.split('T')[0],
            value: p.close,
          }));
          setChartData(points);
        } else {
          setError(`Failed to load chart data`);
        }
      } catch (err) {
        console.error('Chart fetch error:', err);
        setError('Failed to load chart');
      } finally {
        setIsLoadingChart(false);
      }
    };

    fetchChart();
  }, [ticker, selectedPeriod]);

  if (!ticker) {
    return (
      <div className="min-h-screen bg-terminal-bg text-terminal-text flex items-center justify-center">
        <div className="text-terminal-textMuted">Loading...</div>
      </div>
    );
  }

  const isPositive = quote && quote.change >= 0;
  const changeColor = isPositive ? 'text-green-500' : 'text-red-500';
  const changeBgColor = isPositive ? 'bg-green-500/10' : 'bg-red-500/10';
  const lineColor = isPositive ? '#26a69a' : '#ef5350';

  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text">
      {/* Header Section */}
      <div className="border-b border-terminal-border bg-terminal-surface sticky top-14 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold num text-terminal-cyan">
                {String(ticker).toUpperCase()}
              </h1>
              {fundamentals?.name && (
                <p className="text-terminal-textMuted text-sm mt-1">
                  {fundamentals.name}
                  {fundamentals.sector && ` · ${fundamentals.sector}`}
                </p>
              )}
            </div>
            {quote && (
              <div className={`text-right ${changeBgColor} rounded px-4 py-2`}>
                <div className="text-2xl font-bold num text-terminal-text">
                  ${quote.price.toFixed(2)}
                </div>
                <div className={`text-sm font-semibold num ${changeColor}`}>
                  {isPositive ? '+' : ''}{quote.change.toFixed(2)} ({quote.change_pct.toFixed(2)}%)
                </div>
              </div>
            )}
          </div>

          {/* Additional Info */}
          {quote && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-terminal-textMuted text-xs">Volume</div>
                <div className="font-semibold num">
                  {(quote.volume / 1000000).toFixed(1)}M
                </div>
              </div>
              {fundamentals?.market_cap && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Market Cap</div>
                  <div className="font-semibold num">
                    ${(fundamentals.market_cap / 1000000000).toFixed(1)}B
                  </div>
                </div>
              )}
              {fundamentals?.pe_ratio && (
                <div>
                  <div className="text-terminal-textMuted text-xs">P/E Ratio</div>
                  <div className="font-semibold num">
                    {fundamentals.pe_ratio.toFixed(2)}x
                  </div>
                </div>
              )}
              {fundamentals?.dividend_yield && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Dividend Yield</div>
                  <div className="font-semibold num">
                    {(fundamentals.dividend_yield * 100).toFixed(2)}%
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded px-4 py-3 mb-6 text-red-500 text-sm">
            {error}
          </div>
        )}

        {/* Chart Section */}
        <div className="bg-terminal-surface border border-terminal-border rounded mb-6 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Price Chart</h2>
            <div className="flex gap-2 flex-wrap">
              {CHART_PERIODS.map((period) => (
                <button
                  key={period.value}
                  onClick={() => setSelectedPeriod(period.value)}
                  className={`px-3 py-1 text-sm rounded transition num ${
                    selectedPeriod === period.value
                      ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                      : 'border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan'
                  }`}
                >
                  {period.label}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-terminal-bg rounded p-2">
            {isLoadingChart ? (
              <div className="h-96 flex items-center justify-center text-terminal-textMuted">
                Loading chart...
              </div>
            ) : chartData.length > 0 ? (
              <TradingViewChart
                data={chartData}
                height={400}
                color={lineColor}
                fill={true}
                showAxes={true}
              />
            ) : (
              <div className="h-96 flex items-center justify-center text-terminal-textMuted">
                No chart data available
              </div>
            )}
          </div>
        </div>

        {/* Fundamentals Grid */}
        {fundamentals && (
          <div className="bg-terminal-surface border border-terminal-border rounded p-4">
            <h2 className="text-lg font-semibold mb-4">Fundamentals</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {fundamentals.pe_ratio !== undefined && fundamentals.pe_ratio !== null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">P/E Ratio</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    {fundamentals.pe_ratio.toFixed(2)}x
                  </div>
                </div>
              )}
              {fundamentals.pb_ratio !== undefined && fundamentals.pb_ratio !== null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">P/B Ratio</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    {fundamentals.pb_ratio.toFixed(2)}x
                  </div>
                </div>
              )}
              {fundamentals.roe !== undefined && fundamentals.roe !== null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">ROE</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    {(fundamentals.roe * 100).toFixed(2)}%
                  </div>
                </div>
              )}
              {fundamentals.eps !== undefined && fundamentals.eps !== null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">EPS</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    ${fundamentals.eps.toFixed(2)}
                  </div>
                </div>
              )}
              {fundamentals.beta !== undefined && fundamentals.beta !== null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Beta</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    {fundamentals.beta.toFixed(2)}
                  </div>
                </div>
              )}
              {fundamentals.dividend_yield !== undefined && fundamentals.dividend_yield !== null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Dividend Yield</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    {(fundamentals.dividend_yield * 100).toFixed(2)}%
                  </div>
                </div>
              )}
              {fundamentals.debt_to_equity !== undefined && fundamentals.debt_to_equity !== null && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Debt/Equity</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    {fundamentals.debt_to_equity.toFixed(2)}
                  </div>
                </div>
              )}
              {fundamentals.industry && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Industry</div>
                  <div className="text-sm font-semibold text-terminal-cyan">
                    {fundamentals.industry}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
