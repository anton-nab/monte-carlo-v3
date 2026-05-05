/**
 * Instrument Page — /instrument/{ticker}
 *
 * Displays:
 * - Real-time quote (price, change, volume)
 * - Interactive chart with period selector
 * - Company fundamentals (P/E, PB, ROE, market cap, etc.)
 * - Technical indicators (Phase 3.7)
 */

import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { TradingViewChart } from '../../components/TradingViewChart';

interface QuoteData {
  ticker: string;
  price: number;
  currency: string;
  change: number;
  change_percent: number;
  volume: number;
  market_cap: number;
}

interface FundamentalsData {
  ticker: string;
  pe_ratio?: number;
  pb_ratio?: number;
  roe?: number;
  dividend_yield?: number;
  market_cap?: number;
  debt_to_equity?: number;
  company_name?: string;
  sector?: string;
  industry?: string;
}

const CHART_PERIODS = [
  { label: '1D', value: '1d' },
  { label: '5D', value: '5d' },
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: '1Y', value: '1y' },
  { label: '5Y', value: '5y' },
  { label: 'Max', value: 'max' },
];

export default function InstrumentPage() {
  const router = useRouter();
  const { ticker } = router.query;
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('1y');
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [isLoadingFundamentals, setIsLoadingFundamentals] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch quote on mount and ticker change
  useEffect(() => {
    if (!ticker) return;

    const fetchQuote = async () => {
      setIsLoadingQuote(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/instruments/quote/${ticker}`
        );
        if (res.ok) {
          setQuote(await res.json());
        } else {
          setError(`Failed to load quote for ${ticker}`);
        }
      } catch (err) {
        console.error('Quote fetch error:', err);
        setError('Failed to load quote');
      } finally {
        setIsLoadingQuote(false);
      }
    };

    const fetchFundamentals = async () => {
      setIsLoadingFundamentals(true);
      try {
        const res = await fetch(
          `/api/instruments/fundamentals/${ticker}`
        );
        if (res.ok) {
          setFundamentals(await res.json());
        }
      } catch (err) {
        console.error('Fundamentals fetch error:', err);
      } finally {
        setIsLoadingFundamentals(false);
      }
    };

    fetchQuote();
    fetchFundamentals();

    // Refresh quote every 30s
    const interval = setInterval(fetchQuote, 30000);
    return () => clearInterval(interval);
  }, [ticker]);

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
              {fundamentals?.company_name && (
                <p className="text-terminal-textMuted text-sm mt-1">
                  {fundamentals.company_name}
                </p>
              )}
            </div>
            {quote && (
              <div className={`text-right ${changeBgColor} rounded px-4 py-2`}>
                <div className="text-2xl font-bold num text-terminal-text">
                  ${quote.price.toFixed(2)}
                </div>
                <div className={`text-sm font-semibold num ${changeColor}`}>
                  {isPositive ? '+' : ''}{quote.change.toFixed(2)} ({quote.change_percent.toFixed(2)}%)
                </div>
              </div>
            )}
          </div>

          {/* Additional Info */}
          {quote && (
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-terminal-textMuted text-xs">Volume</div>
                <div className="font-semibold num">
                  {(quote.volume / 1000000).toFixed(1)}M
                </div>
              </div>
              {quote.market_cap && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Market Cap</div>
                  <div className="font-semibold num">
                    ${(quote.market_cap / 1000000000).toFixed(1)}B
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
          <div className="bg-red-500/10 border border-red-500/30 rounded px-4 py-3 mb-6 text-red-500">
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
          <div className="h-96 bg-terminal-bg rounded">
            <TradingViewChart
              ticker={String(ticker).toUpperCase()}
              period={selectedPeriod}
            />
          </div>
        </div>

        {/* Fundamentals Grid */}
        {fundamentals && (
          <div className="bg-terminal-surface border border-terminal-border rounded p-4">
            <h2 className="text-lg font-semibold mb-4">Fundamentals</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {fundamentals.pe_ratio && (
                <div>
                  <div className="text-terminal-textMuted text-xs">P/E Ratio</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    {fundamentals.pe_ratio.toFixed(2)}x
                  </div>
                </div>
              )}
              {fundamentals.pb_ratio && (
                <div>
                  <div className="text-terminal-textMuted text-xs">P/B Ratio</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    {fundamentals.pb_ratio.toFixed(2)}x
                  </div>
                </div>
              )}
              {fundamentals.roe && (
                <div>
                  <div className="text-terminal-textMuted text-xs">ROE</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    {(fundamentals.roe * 100).toFixed(2)}%
                  </div>
                </div>
              )}
              {fundamentals.dividend_yield && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Dividend Yield</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    {(fundamentals.dividend_yield * 100).toFixed(2)}%
                  </div>
                </div>
              )}
              {fundamentals.debt_to_equity && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Debt/Equity</div>
                  <div className="text-lg font-semibold num text-terminal-cyan">
                    {fundamentals.debt_to_equity.toFixed(2)}
                  </div>
                </div>
              )}
              {fundamentals.sector && (
                <div>
                  <div className="text-terminal-textMuted text-xs">Sector</div>
                  <div className="text-lg font-semibold text-terminal-cyan">
                    {fundamentals.sector}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading States */}
        {(isLoadingQuote || isLoadingFundamentals) && (
          <div className="text-center py-4 text-terminal-textMuted">
            Loading data...
          </div>
        )}
      </div>
    </div>
  );
}
