/**
 * /indices — Global Indices Directory
 *
 * Grid of all supported indices with current level and daily change.
 * Click any card → /indices/{symbol} for full breakdown.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface IndexSummary {
  symbol: string;
  name: string;
  description: string;
  region: string;
  exchange: string;
  currency: string;
  flag: string;
  yf_ticker: string;
  has_constituents: boolean;
  index_price: number | null;
  index_change_pct: number | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function IndicesPage() {
  const [indices, setIndices] = useState<IndexSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchIndices = async () => {
      try {
        const res = await fetch(`${API_URL}/api/indices/`);
        if (!res.ok) throw new Error('Failed to load indices');
        const data = await res.json();
        setIndices(data);
      } catch (err) {
        setError('Failed to load indices list');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchIndices();
  }, []);

  const regions = [...new Set(indices.map((i) => i.region))];

  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text">
      {/* Page header */}
      <div className="border-b border-terminal-border bg-terminal-surface">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-terminal-cyan">Global Indices</h1>
          <p className="text-terminal-textMuted text-sm mt-1">
            {indices.length > 0
              ? `${indices.filter((i) => i.has_constituents).length} indices with constituent breakdown`
              : 'Major stock market indices worldwide'}
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {isLoading && (
          <div className="text-terminal-textMuted text-center py-20">
            Loading indices…
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded px-4 py-3 text-red-500 text-sm">
            {error}
          </div>
        )}

        {!isLoading && !error && regions.map((region) => (
          <div key={region} className="mb-10">
            <h2 className="text-sm font-semibold text-terminal-textMuted uppercase tracking-wider mb-4">
              {region}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {indices
                .filter((idx) => idx.region === region)
                .map((idx) => (
                  <IndexCard key={idx.symbol} index={idx} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IndexCard({ index }: { index: IndexSummary }) {
  const isPositive = index.index_change_pct != null && index.index_change_pct >= 0;
  const changeColor =
    index.index_change_pct == null
      ? 'text-terminal-textMuted'
      : isPositive
      ? 'text-green-400'
      : 'text-red-400';
  const changeBg =
    index.index_change_pct == null
      ? ''
      : isPositive
      ? 'bg-green-500/5'
      : 'bg-red-500/5';

  const card = (
    <div
      className={`bg-terminal-surface border border-terminal-border rounded p-4
        transition hover:border-terminal-cyan hover:bg-terminal-surfaceHi
        ${!index.has_constituents ? 'opacity-60' : 'cursor-pointer'}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-lg">{index.flag}</span>{' '}
          <span className="text-xs text-terminal-textDim font-mono">{index.symbol}</span>
        </div>
        {index.has_constituents && (
          <span className="text-2xs bg-terminal-cyan/10 text-terminal-cyan border border-terminal-cyan/20 rounded px-1.5 py-0.5">
            Breakdown
          </span>
        )}
      </div>

      <div className="font-semibold text-terminal-text text-sm mb-1 leading-tight">
        {index.name}
      </div>
      <div className="text-2xs text-terminal-textDim mb-3 leading-relaxed line-clamp-2">
        {index.exchange}
      </div>

      <div className={`flex items-baseline gap-2 ${changeBg} rounded px-2 py-1.5`}>
        {index.index_price != null ? (
          <>
            <span className="font-bold num text-terminal-text">
              {index.index_price.toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className={`text-sm font-semibold num ${changeColor}`}>
              {isPositive ? '+' : ''}
              {index.index_change_pct?.toFixed(2)}%
            </span>
          </>
        ) : (
          <span className="text-terminal-textDim text-sm">— no price —</span>
        )}
      </div>
    </div>
  );

  if (!index.has_constituents) return card;

  return (
    <Link href={`/indices/${index.symbol}`} className="block">
      {card}
    </Link>
  );
}
