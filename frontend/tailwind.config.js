/**
 * Tailwind CSS Configuration — Phase 1.5 (Polish v1)
 * ===================================================
 *
 * Palette: terminal/financial (deep navy, cyan accents, financial green/red)
 * Fonts: Inter (sans) + JetBrains Mono (numbers, terminal feel)
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './app/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Terminal palette (Bloomberg-inspired)
        terminal: {
          // Backgrounds (du plus sombre au plus clair)
          bg: '#0a0e1a',           // Page background — deep navy/black
          surface: '#131725',       // Card background
          surfaceHi: '#1a2030',     // Hover/active card
          border: '#2a3040',        // Card border

          // Text
          text: '#e8e9ed',          // Primary off-white
          textMuted: '#7a8294',     // Secondary muted blue-gray
          textDim: '#4b5366',       // Tertiary very muted

          // Accents
          cyan: '#00d9ff',          // Brand accent
          cyanDim: '#0086a3',
        },
        // Financial colors (TradingView convention)
        bull: {
          DEFAULT: '#26a69a',       // Green for up/positive
          bg: 'rgba(38,166,154,0.12)',
          border: 'rgba(38,166,154,0.4)',
        },
        bear: {
          DEFAULT: '#ef5350',       // Red for down/negative
          bg: 'rgba(239,83,80,0.12)',
          border: 'rgba(239,83,80,0.4)',
        },
        warn: {
          DEFAULT: '#ffa726',       // Amber for warnings/neutral
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'JetBrains Mono', 'IBM Plex Mono', 'monospace'],
      },
      fontSize: {
        // Tighter scale for trading desk density
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      animation: {
        // Tick flash animations (data update visual feedback)
        'flash-bull': 'flashBull 600ms ease-out',
        'flash-bear': 'flashBear 600ms ease-out',
        'fade-in': 'fadeIn 200ms ease-out',
      },
      keyframes: {
        flashBull: {
          '0%': { backgroundColor: 'rgba(38,166,154,0.4)' },
          '100%': { backgroundColor: 'transparent' },
        },
        flashBear: {
          '0%': { backgroundColor: 'rgba(239,83,80,0.4)' },
          '100%': { backgroundColor: 'transparent' },
        },
        fadeIn: {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      },
    },
  },
  plugins: [],
};
