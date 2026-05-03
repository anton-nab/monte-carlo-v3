/**
 * Next.js App Component
 * ====================
 *
 * This wraps ALL pages in the app.
 * Use for global styling, context providers, etc.
 */

import type { AppProps } from 'next/app';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
