/**
 * Next.js App Component — TintScale light theme
 * ===============================================
 *
 * Fonts:
 *   DM Serif Display → headings  (--font-dm-serif)
 *   DM Sans          → body      (--font-dm-sans)
 *   JetBrains Mono   → numbers   (--font-jetbrains)
 *
 * CSS variables are referenced in tailwind.config.js so Tailwind
 * classes like `font-sans`, `font-serif`, `font-mono` resolve correctly.
 */

import type { AppProps } from 'next/app';
import { SessionProvider } from 'next-auth/react';
import { DM_Sans, DM_Serif_Display, JetBrains_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import '../styles/globals.css';

const dmSans = DM_Sans({
  subsets:  ['latin'],
  variable: '--font-dm-sans',
  display:  'swap',
  weight:   ['300', '400', '500', '600', '700'],
});

const dmSerif = DM_Serif_Display({
  subsets:  ['latin'],
  variable: '--font-dm-serif',
  display:  'swap',
  weight:   '400',
  style:    ['normal', 'italic'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets:  ['latin'],
  variable: '--font-jetbrains',
  display:  'swap',
});

export default function App({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  return (
    <SessionProvider session={session}>
      <main className={`${dmSans.variable} ${dmSerif.variable} ${jetbrainsMono.variable} font-sans`}>
        <Component {...pageProps} />
        <Analytics />
      </main>
    </SessionProvider>
  );
}
