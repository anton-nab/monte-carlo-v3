/**
 * Macro Dashboard page
 * ====================
 *
 * Phase 1 MVP: 5 indicateurs US (inflation, chomage, Fed Rate, GDP, 10Y yield).
 *
 * Phase 1.1 (a venir): selecteur de pays (US/EU/UK/JP/CN) avec OECD provider.
 * Phase 6 (Bloomberg): multi-fenetres, watchlists, alertes.
 */

import Head from 'next/head';
import Link from 'next/link';

import { MacroIndicator } from '@/components/MacroIndicator';

export default function Dashboard() {
  return (
    <>
      <Head>
        <title>Macro Dashboard — Monte Carlo v3</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        {/* Header */}
        <header className="border-b border-white/10 px-6 py-4 sticky top-0 backdrop-blur-md bg-slate-900/80 z-10">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">📊 Global Macro Dashboard</h1>
              <p className="text-sm text-white/60">
                Live macroeconomic indicators · Phase 1 MVP
              </p>
            </div>
            <Link
              href="/"
              className="text-sm px-4 py-2 rounded-md bg-white/10 hover:bg-white/20 transition border border-white/20"
            >
              ← Home
            </Link>
          </div>
        </header>

        {/* Content */}
        <main className="max-w-7xl mx-auto px-6 py-8">
          {/* Section: USA — Critical indicators */}
          <section className="mb-12">
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-xl font-semibold">🇺🇸 United States</h2>
              <span className="text-sm text-white/50">Critical indicators</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MacroIndicator
                country="us"
                indicator="inflation"
                title="Inflation (CPI)"
                decimals={2}
              />
              <MacroIndicator
                country="us"
                indicator="unemployment"
                title="Unemployment"
                decimals={1}
              />
              <MacroIndicator
                country="us"
                indicator="fed_rate"
                title="Fed Funds Rate"
                decimals={2}
              />
              <MacroIndicator
                country="us"
                indicator="gdp"
                title="Real GDP Growth"
                decimals={2}
              />
            </div>
          </section>

          {/* Section: USA — Yields (full-width chart, plus de granularite) */}
          <section className="mb-12">
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-xl font-semibold">📈 Yields</h2>
              <span className="text-sm text-white/50">Treasury rates (daily)</span>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <MacroIndicator
                country="us"
                indicator="yield_10y"
                title="US 10Y Treasury Yield"
                decimals={3}
              />
            </div>
          </section>

          {/* Placeholder for future countries */}
          <section className="mb-12 opacity-60">
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-xl font-semibold">🌍 Coming next</h2>
              <span className="text-sm text-white/50">Phase 1.1</span>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-6 text-center">
              <p className="text-white/70">
                🇪🇺 Eurozone · 🇬🇧 UK · 🇯🇵 Japan · 🇨🇳 China
              </p>
              <p className="text-sm text-white/50 mt-2">
                OECD provider integration in progress (~20 indicators incoming)
              </p>
            </div>
          </section>
        </main>

        <footer className="border-t border-white/10 mt-12 px-6 py-6 text-center text-sm text-white/40">
          Monte Carlo v3 · Data: Federal Reserve (FRED) · Phase 1 of 6
        </footer>
      </div>
    </>
  );
}
