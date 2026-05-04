/**
 * Macro Dashboard page
 * ====================
 *
 * Phase 1: 17 indicateurs sur 4 pays (US/EU/UK/JP) via Fred.
 *
 * Phase 1.5 (a venir): China via World Bank, donnees natives ECB/BoE/BoJ
 *                     pour les indicateurs ou Fred est en retard.
 * Phase 6 (Bloomberg): multi-fenetres, watchlists, alertes, dark mode terminal.
 */

import Head from 'next/head';
import Link from 'next/link';

import { MacroIndicator } from '@/components/MacroIndicator';

interface IndicatorConfig {
  indicator: string;
  title: string;
  decimals: number;
}

interface CountryConfig {
  code: string;
  flag: string;
  name: string;
  indicators: IndicatorConfig[];
}

const COUNTRIES: CountryConfig[] = [
  {
    code: 'us',
    flag: '🇺🇸',
    name: 'United States',
    indicators: [
      { indicator: 'inflation', title: 'Inflation (CPI)', decimals: 2 },
      { indicator: 'unemployment', title: 'Unemployment', decimals: 1 },
      { indicator: 'fed_rate', title: 'Fed Funds Rate', decimals: 2 },
      { indicator: 'gdp', title: 'Real GDP Growth', decimals: 2 },
      { indicator: 'yield_10y', title: '10Y Treasury Yield', decimals: 3 },
    ],
  },
  {
    code: 'eu',
    flag: '🇪🇺',
    name: 'Eurozone',
    indicators: [
      { indicator: 'inflation', title: 'Inflation (HICP)', decimals: 2 },
      { indicator: 'unemployment', title: 'Unemployment', decimals: 1 },
      { indicator: 'ecb_rate', title: 'ECB Deposit Rate', decimals: 2 },
      { indicator: 'gdp', title: 'Real GDP', decimals: 0 },
      { indicator: 'bund_10y', title: 'Bund 10Y Yield', decimals: 3 },
    ],
  },
  {
    code: 'gb',
    flag: '🇬🇧',
    name: 'United Kingdom',
    indicators: [
      { indicator: 'inflation', title: 'Inflation (CPI)', decimals: 2 },
      { indicator: 'unemployment', title: 'Unemployment', decimals: 1 },
      { indicator: 'gdp', title: 'Real GDP', decimals: 0 },
      { indicator: 'gilt_10y', title: 'Gilt 10Y Yield', decimals: 3 },
    ],
  },
  {
    code: 'jp',
    flag: '🇯🇵',
    name: 'Japan',
    indicators: [
      { indicator: 'inflation', title: 'Inflation (CPI)', decimals: 2 },
      { indicator: 'unemployment', title: 'Unemployment', decimals: 1 },
      { indicator: 'gdp', title: 'Real GDP', decimals: 0 },
    ],
  },
];

export default function Dashboard() {
  return (
    <>
      <Head>
        <title>Global Macro Dashboard — Monte Carlo v3</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        {/* Header */}
        <header className="border-b border-white/10 px-6 py-4 sticky top-0 backdrop-blur-md bg-slate-900/80 z-10">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">📊 Global Macro Dashboard</h1>
              <p className="text-sm text-white/60">
                17 indicators · 4 countries · live data via FRED
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

        {/* Quick country navigation */}
        <nav className="border-b border-white/10 px-6 py-3 bg-slate-900/50">
          <div className="max-w-7xl mx-auto flex flex-wrap gap-3 text-sm">
            <span className="text-white/50">Jump to:</span>
            {COUNTRIES.map((c) => (
              <a
                key={c.code}
                href={`#${c.code}`}
                className="text-white/80 hover:text-white transition"
              >
                {c.flag} {c.name}
              </a>
            ))}
            <span className="text-white/30">·</span>
            <span className="text-white/40">🇨🇳 China (Phase 1.5)</span>
          </div>
        </nav>

        {/* Main content */}
        <main className="max-w-7xl mx-auto px-6 py-8 space-y-12">
          {COUNTRIES.map((country) => (
            <section key={country.code} id={country.code} className="scroll-mt-24">
              <div className="flex items-baseline gap-3 mb-4">
                <h2 className="text-xl font-semibold">
                  {country.flag} {country.name}
                </h2>
                <span className="text-sm text-white/50">
                  {country.indicators.length} indicators
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {country.indicators.map((cfg) => (
                  <MacroIndicator
                    key={`${country.code}-${cfg.indicator}`}
                    country={country.code}
                    indicator={cfg.indicator}
                    title={cfg.title}
                    decimals={cfg.decimals}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* China placeholder */}
          <section id="cn" className="opacity-60 scroll-mt-24">
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-xl font-semibold">🇨🇳 China</h2>
              <span className="text-sm text-white/50">Phase 1.5</span>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-6 text-center">
              <p className="text-white/70">
                China indicators require dedicated provider (World Bank annual data
                or paid Trading Economics for real-time).
              </p>
              <p className="text-sm text-white/50 mt-2">
                Coming in Phase 1.5 with World Bank integration.
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
