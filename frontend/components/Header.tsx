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
  { href: '/indices',   label: 'Indices',   emoji: '🗂️' },
  { href: '/simulate',  label: 'Simulate',  emoji: '⚡' },
  { href: '/compare',   label: 'Compare',   emoji: '🔬' },
  { href: '/portfolio', label: 'Portfolio', emoji: '💼' },
];

export function Header() {
  const router = useRouter();

  return (
    <header className="border-b border-terminal-border bg-terminal-surface sticky top-0 z-20 backdrop-blur-md bg-opacity-95">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">

        {/* Logo — shrink-0 pour ne jamais être écrasé */}
        <Link
          href="/"
          className="flex items-center gap-2 text-terminal-text font-semibold whitespace-nowrap shrink-0"
        >
          <span className="text-terminal-cyan text-lg">▲</span>
          <span className="hidden sm:inline">Monte Carlo v3</span>
          <span className="sm:hidden text-terminal-cyan">MC3</span>
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
