/**
 * components/UserMenu.tsx
 * ────────────────────────
 * Login / logout button + user avatar dropdown.
 *
 * Non connecté : bouton "GitHub" avec l'icône Octocat.
 * Connecté     : avatar (image GitHub) + dropdown :
 *                  → Mes analyses (/saved)
 *                  → Déconnexion
 *
 * Utilisé dans Header.tsx (desktop + drawer).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import Link from 'next/link';
import Image from 'next/image';

// ── GitHub Octocat icon ───────────────────────────────────────────────────────
const IconGitHub = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483
             0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608
             1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338
             -2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65
             0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844a9.59 9.59 0 012.504.337c1.909-1.296 2.747-1.027
             2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566
             4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019
             10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

// ── Bookmark / saved icon ─────────────────────────────────────────────────────
const IconSaved = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
  </svg>
);

// ── Logout icon ───────────────────────────────────────────────────────────────
const IconLogout = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────

export function UserMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const ref  = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  const onOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', onOutside);
    } else {
      document.removeEventListener('mousedown', onOutside);
    }
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open, onOutside]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="w-7 h-7 rounded-full bg-terminal-border animate-pulse shrink-0" />
    );
  }

  // ── Not signed in ─────────────────────────────────────────────────────────
  if (!session) {
    return (
      <button
        onClick={() => signIn('github')}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium
                   border border-terminal-border text-terminal-textMuted
                   hover:text-terminal-text hover:border-terminal-cyan
                   transition-colors shrink-0"
        title="Se connecter avec GitHub"
      >
        <IconGitHub />
        <span className="hidden sm:inline">Login</span>
      </button>
    );
  }

  // ── Signed in ─────────────────────────────────────────────────────────────
  const user  = session.user;
  const name  = user?.name ?? 'User';
  const image = user?.image;
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="relative shrink-0" ref={ref}>
      {/* Avatar button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-full p-0.5
                   ring-2 ring-transparent hover:ring-terminal-cyan
                   transition-all focus:outline-none"
        title={name}
        aria-label="Menu utilisateur"
      >
        {image ? (
          <Image
            src={image}
            alt={name}
            width={28}
            height={28}
            className="rounded-full"
            unoptimized
          />
        ) : (
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center
                       text-[10px] font-bold text-white"
            style={{ background: 'var(--color-primary)' }}
          >
            {initials}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-52 z-[90]
                     bg-[#0f1522] border border-[#2a3040] rounded-xl
                     shadow-2xl py-1 overflow-hidden"
        >
          {/* User info */}
          <div className="px-3 py-2 border-b border-[#2a3040]">
            <p className="text-xs font-semibold text-[#e8e9ed] truncate">{name}</p>
            {user?.email && (
              <p className="text-[10px] text-[#7a8294] truncate mt-0.5">{user.email}</p>
            )}
          </div>

          {/* Mes analyses */}
          <Link
            href="/saved"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5
                       text-[#c8d0e0] hover:bg-[#1a2235] hover:text-[#e8e9ed]
                       transition-colors text-xs"
          >
            <span className="text-[#00e5ff]"><IconSaved /></span>
            Mes analyses
          </Link>

          <div className="my-1 border-t border-[#2a3040]" />

          {/* Déconnexion */}
          <button
            onClick={() => { setOpen(false); signOut({ callbackUrl: '/' }); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5
                       text-[#c8d0e0] hover:bg-[#1a2235] hover:text-[#e8e9ed]
                       transition-colors text-xs"
          >
            <span className="text-[#7a8294]"><IconLogout /></span>
            Déconnexion
          </button>
        </div>
      )}
    </div>
  );
}
