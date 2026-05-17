/**
 * Header — global navigation bar.
 *
 * Nav icons: small inline SVGs (no emoji, no external library).
 * ThemeToggle: light/dark switcher, persisted in localStorage.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { GlobalSearch } from './GlobalSearch';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  href:  string;
  label: string;
  icon:  React.ReactNode;
}

// ─── Inline SVG icons (14×14, currentColor) ──────────────────────────────────

const IconHome = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12L5 10M5 10L12 3L19 10M5 10V20a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1V10" />
  </svg>
);

const IconSimulate = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12h2l3-9 4 18 3-9h4l3-3" />
  </svg>
);

const IconCompare = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8"  cy="12" r="5" />
    <circle cx="16" cy="12" r="5" />
  </svg>
);

const IconPortfolio = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
    <line x1="12" y1="12" x2="12" y2="16" />
    <line x1="10" y1="14" x2="14" y2="14" />
  </svg>
);

const IconCalendar = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8"  y1="2" x2="8"  y2="6" />
    <line x1="3"  y1="10" x2="21" y2="10" />
  </svg>
);

const IconBacktest = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

const NAV_ITEMS: NavItem[] = [
  { href: '/',          label: 'Home',      icon: <IconHome />      },
  { href: '/simulate',  label: 'Simulate',  icon: <IconSimulate />  },
  { href: '/compare',   label: 'Compare',   icon: <IconCompare />   },
  { href: '/portfolio', label: 'Portfolio', icon: <IconPortfolio /> },
  { href: '/backtest',  label: 'Backtest',  icon: <IconBacktest />  },
  { href: '/calendar',  label: 'Calendar',  icon: <IconCalendar />  },
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
                className={`px-2.5 py-1.5 rounded transition flex items-center gap-1.5 whitespace-nowrap ${
                  isActive
                    ? 'text-terminal-cyan bg-terminal-surfaceHi'
                    : 'text-terminal-textMuted hover:text-terminal-text hover:bg-terminal-surfaceHi'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Theme toggle */}
        <ThemeToggle />

        {/* Mobile hamburger placeholder */}
        <div className="lg:hidden shrink-0">
          <button className="text-terminal-textDim text-xl px-1">&#9776;</button>
        </div>
      </div>
    </header>
  );
}
