/**
 * Header — global navigation bar.
 *
 * Phase 4.5: search bar fixed (min-w), Instruments removed,
 * disabled items hidden from nav (they're in the home roadmap).
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { GlobalSearch } from './GlobalSearch';

interface NavItem {
  href: string;
  label: string;
  emoji: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/',          label: 'Home',      emoji: '⌂'  },
  { href: '/dashboard', label: 'Macro',     emoji: '📊' },
  { href: '/simulate',  label: 'Simulate',  emoji: '⚡' },
  { href: '/compare',   label: 'Compare',   emoji: '🔬' },
  { href: '/portfolio', label: 'Portfolio', emoji: '💼' },
];

export function Header() {
  const router = useRouter();

  return (
    <header className="border-b border-terminal-border bg-terminal-surface/95 sticky top-0 z-20 backdrop-blur-sm shadow-sm">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">

        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 whitespace-nowrap shrink-0 group"
        >
          <span
            className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ background: 'var(--color-primary)' }}
          >
            MC
          </span>
          <span className="hidden sm:inline font-serif text-base font-normal text-terminal-text group-hover:text-terminal-cyan transition-colors">
            Monte Carlo
          </span>
          <span className="hidden sm:inline text-xs text-terminal-textDim font-mono">v3</span>
          <span className="sm:hidden font-serif text-sm text-terminal-text">MC3</span>
        </Link>

        {/* Search bar — flex-1 avec min-width garanti */}
        <div className="flex-1 min-w-0">
          <GlobalSearch />
        </div>

        {/* Nav links — shrink-0 pour qu'ils ne compressent pas la search */}
        <nav className="hidden lg:flex items-center gap-0.5 text-sm shrink-0">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === '/'
                ? router.pathname === '/'
                : router.pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-2.5 py-1.5 rounded transition flex items-center gap-1 whitespace-nowrap ${
                  isActive
                    ? 'text-terminal-cyan bg-terminal-surfaceHi'
                    : 'text-terminal-textMuted hover:text-terminal-text hover:bg-terminal-surfaceHi'
                }`}
              >
                <span className="text-xs">{item.emoji}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mobile hamburger placeholder */}
        <div className="lg:hidden shrink-0">
          <button className="text-terminal-textDim text-xl px-1">☰</button>
        </div>
      </div>
    </header>
  );
}
