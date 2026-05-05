/**
 * Macro Dashboard page — Phase 1.5 redesign.
 *
 * Layout trading desk:
 * - Header global avec search bar (placeholder)
 * - Sticky country nav avec ancres
 * - Sections par pays avec grids denses
 * - Cards cliquables -> modal plein-ecran
 */

import Head from 'next/head';

import { Header } from '@/components/Header';
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

      <Header />

      {/* Country nav */}
      <nav className="border-b border-terminal-border bg-terminal-surface px-4 py-2 sticky top-14 z-10">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3 text-xs">
          <span className="text-terminal-textDim uppercase tracking-wider">Jump to:</span>
          {COUNTRIES.map((c) => (
            <a
              key={c.code}
              href={`#${c.code}`}
              className="text-terminal-textMuted hover:text-terminal-cyan transition num"
            >
              {c.flag} {c.code.toUpperCase()}
            </a>
          ))}
          <span className="text-terminal-textDim">·</span>
          <span className="text-terminal-textDim num">🇨🇳 CN (P1.5)</span>
          <span className="ml-auto text-terminal-textDim num">
            17 indicators · 4 countries · live FRED
          </span>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {/* Page title */}
        <div>
          <h1 className="text-xl font-semibold text-terminal-text">
            <span className="text-terminal-cyan">📊</span> Global Macro Dashboard
          </h1>
          <p className="text-xs text-terminal-textMuted mt-1">
            Click any indicator card to expand · period selectors available in detail view
          </p>
        </div>

        {/* Country sections */}
        {COUNTRIES.map((country) => (
          <section key={country.code} id={country.code} className="scroll-mt-28">
            <div className="flex items-baseline gap-3 mb-3 border-b border-terminal-border pb-2">
              <h2 className="text-base font-semibold text-terminal-text">
                {country.flag} {country.name}
              </h2>
              <span className="text-2xs text-terminal-textDim uppercase tracking-wider num">
                {country.indicators.length} indicators
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
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
        <section id="cn" className="scroll-mt-28 opacity-60">
          <div className="flex items-baseline gap-3 mb-3 border-b border-terminal-border pb-2">
            <h2 className="text-base font-semibold text-terminal-text">🇨🇳 China</h2>
            <span className="text-2xs text-terminal-textDim uppercase tracking-wider num">
              Phase 1.5
            </span>
          </div>
          <div className="card-terminal p-4 text-center">
            <p className="text-sm text-terminal-textMuted">
              China indicators require dedicated provider (World Bank annual or paid Trading Economics).
            </p>
            <p className="text-2xs text-terminal-textDim mt-1 num">
              Coming with World Bank integration in Phase 1.5+
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-terminal-border mt-12 px-4 py-4 text-center text-2xs text-terminal-textDim num">
        Monte Carlo v3 · Data: FRED · Phase 1.5 of 11 · Bloomberg-lite global terminal
      </footer>
    </>
  );
}
