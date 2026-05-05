/**
 * Header — global navigation bar.
 *
 * Phase 1.5: barre de recherche est un PLACEHOLDER (visuel seulement,
 * non-fonctionnelle). L'integration reelle (OpenFIGI + autocomplete) arrive
 * en Phase 2 quand on aura la couche instruments.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';

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

        {/* Search bar (placeholder) */}
        <div className="flex-1 max-w-xl">
          <div className="relative">
            <input
              type="text"
              disabled
              placeholder="Search ticker, name, ISIN…  (Phase 2)"
              className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-1.5 text-sm text-terminal-textMuted placeholder:text-terminal-textDim cursor-not-allowed focus:outline-none num"
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-2xs text-terminal-textDim border border-terminal-border rounded px-1 py-0.5 num">
              ⌘K
            </kbd>
          </div>
        </div>

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
