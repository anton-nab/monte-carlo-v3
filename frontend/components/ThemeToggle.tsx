/**
 * ThemeToggle — sun/moon button that switches between light and dark themes.
 *
 * Mechanism:
 *  - Toggles the `dark` class on <html> (picked up by `html.dark { }` in globals.css)
 *  - Persists the choice in `localStorage` under key `mc-theme`
 *  - The anti-flash script in _document.tsx reads this key before first paint
 */

import { useEffect, useState } from 'react';

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  // Read initial state from the html class applied by the anti-flash script
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add('dark');
      try { localStorage.setItem('mc-theme', 'dark'); } catch { /* private browsing */ }
    } else {
      document.documentElement.classList.remove('dark');
      try { localStorage.setItem('mc-theme', 'light'); } catch { /* private browsing */ }
    }
  };

  return (
    <button
      onClick={toggle}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="w-8 h-8 flex items-center justify-center rounded border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan transition-colors shrink-0"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
