/**
 * Next.js App Component
 * =====================
 *
 * Wraps every page. Loads fonts (Inter + JetBrains Mono) via next/font/google
 * which inlines them into the HTML and avoids CLS / FOUT.
 *
 * The CSS variables --font-inter and --font-jetbrains are referenced in
 * tailwind.config.js so we can use `font-sans` and `font-mono` classes.
 */

import type { AppProps } from 'next/app';
import { Inter, JetBrains_Mono } from 'next/font/google';
import '../styles/globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <main className={`${inter.variable} ${jetbrainsMono.variable} font-sans`}>
      <Component {...pageProps} />
    </main>
  );
}
