/**
 * GlobalSearch — Phase 2 autocomplete search
 *
 * Features:
 * - Debounced input (300ms)
 * - Fetches from /api/search/autocomplete
 * - Dropdown with suggestions
 * - Navigate to /instrument/{ticker} on select
 * - Escape to close, arrow keys to navigate
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';

interface Suggestion {
  ticker: string;
  name: string;
  type?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Route to /indices/[symbol] only if the ticker starts with '^'.
 * All real market indices in Yahoo Finance use the ^ prefix (^GSPC, ^FCHI, etc.).
 * Checking the `type` field is intentionally avoided — it can return unexpected
 * values for ordinary stocks (e.g. AI.PA / Air Liquide) and cause wrong routing.
 */
function isIndexTicker(ticker: string): boolean {
  return ticker.startsWith('^');
}

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const debounceTimer = useRef<NodeJS.Timeout>();
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (!query.trim()) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/search/autocomplete?q=${encodeURIComponent(query)}&limit=10`
        );
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions || []);
          setIsOpen(true);
          setSelectedIndex(-1);
        }
      } catch (error) {
        console.error('Search error:', error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === 'Enter' && query.trim()) {
        const sym = query.trim().toUpperCase();
        router.push(isIndexTicker(sym) ? `/indices/${sym}` : `/instrument/${sym}`);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          selectSuggestion(suggestions[selectedIndex]);
        } else if (suggestions.length > 0) {
          selectSuggestion(suggestions[0]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const selectSuggestion = (suggestion: Suggestion) => {
    const route = isIndexTicker(suggestion.ticker)
      ? `/indices/${suggestion.ticker}`
      : `/instrument/${suggestion.ticker}`;
    router.push(route);
    setQuery('');
    setIsOpen(false);
    setSuggestions([]);
  };

  return (
    <div className="flex-1 max-w-xl relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query && suggestions.length > 0 && setIsOpen(true)}
          placeholder="Search ticker, name, ISIN…"
          className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-1.5 text-sm text-terminal-text placeholder:text-terminal-textDim focus:outline-none focus:border-terminal-cyan focus:ring-1 focus:ring-terminal-cyan/30 transition num"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-terminal-textMuted animate-spin">
            ◌
          </div>
        )}
        {!isLoading && (
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-2xs text-terminal-textDim border border-terminal-border rounded px-1 py-0.5 num pointer-events-none">
            ⌘K
          </kbd>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-terminal-surface border border-terminal-border rounded shadow-lg z-50 max-h-96 overflow-y-auto">
          {suggestions.map((suggestion, idx) => (
            <button
              key={suggestion.ticker}
              onClick={() => selectSuggestion(suggestion)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full px-3 py-2 text-left text-sm transition flex items-center gap-2 ${
                idx === selectedIndex
                  ? 'bg-terminal-surfaceHi text-terminal-cyan'
                  : 'text-terminal-text hover:bg-terminal-surfaceHi hover:text-terminal-cyan'
              }`}
            >
              <span className="font-semibold num">{suggestion.ticker}</span>
              <span className="text-terminal-textMuted text-xs truncate">
                {suggestion.name}
              </span>
              {suggestion.type && (
                <span className="text-2xs text-terminal-textDim ml-auto">
                  {suggestion.type}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {isOpen && !isLoading && query.trim() && suggestions.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-terminal-surface border border-terminal-border rounded px-3 py-2 text-sm text-terminal-textMuted z-50">
          No results for "{query}"
        </div>
      )}
    </div>
  );
}
