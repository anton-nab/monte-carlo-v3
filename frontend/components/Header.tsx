/**
 * Header — global navigation bar.
 *
 * Phase 2: Global search is now functional with autocomplete.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { GlobalSearch } from './GlobalSearch';

interface NavItem {
  href: string;
  label: string;
  emoji: string;
  enabled: boolean;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', emoji: '⌂', enabled: true },
  { href: '/dashboard', label: 'Macro', emoji: '📊', enabled: true },
  { href: '/discover', label: 'Discover', emoji: '🔥', enabled: false, badge: 'P2.7' },
  { href: '/instrument', label: 'Instruments', emoji: '📈', enabled: false, badge: 'P2' },
  { href: '/sentiment', label: 'Sentiment', emoji: '🌡️', enabled: false, badge: 'P3.5' },
  { href: '/bonds', label: 'Bonds', emoji: '🏦', enabled: false, badge: 'P4' },
];

export function Header() {
  const router = useRouter();

  return (
    <header className="border-b border-terminal-border bg-terminal-surface sticky top-0 z-20 backdrop-blur-md bg-opacity-95">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-terminal-text font-semibold whitespace-nowrap shrink-0"
        >
          <span className="text-terminal-cyan text-lg">▲</span>
          <span>Monte Carlo v3</span>
        </Link>

        {/* Search bar */}
        <GlobalSearch />

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-1 text-sm">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === '/'
                ? router.pathname === '/'
                : router.pathname.startsWith(item.href);

            if (!item.enabled) {
              return (
                <span
                  key={item.href}
                  className="px-2 py-1 text-terminal-textDim cursor-not-allowed flex items-center gap-1"
                  title={`Coming in ${item.badge}`}
                >
                  <span className="opacity-60">{item.emoji}</span>
                  <span className="opacity-60">{item.label}</span>
                  <span className="text-2xs text-terminal-textDim border border-terminal-border rounded px-1 num">
                    {item.badge}
                  </span>
                </span>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-2 py-1 rounded transition flex items-center gap-1 ${
                  isActive
                    ? 'text-terminal-cyan bg-terminal-surfaceHi'
                    : 'text-terminal-textMuted hover:text-terminal-text hover:bg-terminal-surfaceHi'
                }`}
              >
                <span>{item.emoji}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
