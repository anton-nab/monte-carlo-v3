/**
 * Instruments index page — /instrument
 *
 * Landing page for the instruments section.
 * Shows popular tickers as quick-access cards.
 */

import Link from 'next/link';

const POPULAR_TICKERS = [
  { ticker: 'AAPL', name: 'Apple Inc.', type: 'Equity' },
  { ticker: 'MSFT', name: 'Microsoft', type: 'Equity' },
  { ticker: 'GOOGL', name: 'Alphabet', type: 'Equity' },
  { ticker: 'AMZN', name: 'Amazon', type: 'Equity' },
  { ticker: 'NVDA', name: 'NVIDIA', type: 'Equity' },
  { ticker: 'META', name: 'Meta Platforms', type: 'Equity' },
  { ticker: 'TSLA', name: 'Tesla', type: 'Equity' },
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF' },
  { ticker: 'QQQ', name: 'Invesco QQQ', type: 'ETF' },
  { ticker: '^GSPC', name: 'S&P 500', type: 'Index' },
  { ticker: '^IXIC', name: 'NASDAQ Composite', type: 'Index' },
  { ticker: '^DJI', name: 'Dow Jones', type: 'Index' },
  { ticker: 'BTC-USD', name: 'Bitcoin', type: 'Crypto' },
  { ticker: 'ETH-USD', name: 'Ethereum', type: 'Crypto' },
  { ticker: 'EURUSD=X', name: 'EUR/USD', type: 'Forex' },
  { ticker: 'GC=F', name: 'Gold Futures', type: 'Commodity' },
];

const TYPE_COLORS: Record<string, string> = {
  Equity: 'text-terminal-cyan',
  ETF: 'text-blue-400',
  Index: 'text-purple-400',
  Crypto: 'text-orange-400',
  Forex: 'text-green-400',
  Commodity: 'text-yellow-400',
};

export default function InstrumentsIndexPage() {
  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-terminal-cyan mb-2">
            Instruments
          </h1>
          <p className="text-terminal-textMuted text-sm">
            Search any instrument globally — stocks, ETFs, indices, crypto, forex,
            commodities. Use the search bar above or pick from popular below.
          </p>
        </div>

        {/* Popular Tickers Grid */}
        <div>
          <h2 className="text-sm font-semibold text-terminal-textMuted mb-3 uppercase tracking-wide">
            Popular instruments
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {POPULAR_TICKERS.map((item) => (
              <Link
                key={item.ticker}
                href={`/instrument/${encodeURIComponent(item.ticker)}`}
                className="bg-terminal-surface border border-terminal-border rounded p-4 hover:border-terminal-cyan transition group"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold num text-terminal-text group-hover:text-terminal-cyan transition">
                      {item.ticker}
                    </div>
                    <div className="text-xs text-terminal-textMuted mt-1 truncate">
                      {item.name}
                    </div>
                  </div>
                  <span
                    className={`text-2xs uppercase tracking-wide ${
                      TYPE_COLORS[item.type] || 'text-terminal-textMuted'
                    }`}
                  >
                    {item.type}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Info card */}
        <div className="mt-8 bg-terminal-surface border border-terminal-border rounded p-4">
          <div className="text-sm text-terminal-textMuted">
            <span className="text-terminal-cyan font-semibold">Tip:</span> Type a
            ticker, ISIN, or company name in the search bar at the top.
            Examples: <span className="num text-terminal-text">AAPL</span>,{' '}
            <span className="num text-terminal-text">US0378331005</span> (Apple
            ISIN), <span className="num text-terminal-text">apple</span>.
          </div>
        </div>
      </div>
    </div>
  );
}
