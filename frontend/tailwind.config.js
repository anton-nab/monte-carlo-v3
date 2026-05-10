/**
 * Tailwind CSS Configuration — TintScale light theme
 * ====================================================
 *
 * Palette: TintScale warm light (cream bg, crimson primary, teal secondary)
 * Fonts: DM Serif Display (headings) + DM Sans (body) + JetBrains Mono (numbers)
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
        // ── Terminal tokens remapped to TintScale light palette ──────────────
        terminal: {
          bg:          '#fafaf9',   // Warm white — page background
          surface:     '#f6f5f4',   // Card background
          surfaceHi:   '#ede9e6',   // Hover / elevated card
          border:      '#e7e5e3',   // Card borders

          text:        '#1b1616',   // Primary text (near-black warm)
          textMuted:   '#5a4f4f',   // Secondary text
          textDim:     '#a79e9e',   // Tertiary / disabled

          cyan:        '#b92e25',   // Brand accent → crimson red (primary)
          cyanDim:     '#840000',   // Deeper accent
        },

        // ── Financial convention ─────────────────────────────────────────────
        bull: {
          DEFAULT: '#009371',
          bg:      'rgba(0,147,113,0.10)',
          border:  'rgba(0,147,113,0.30)',
        },
        bear: {
          DEFAULT: '#b92e25',
          bg:      'rgba(185,46,37,0.10)',
          border:  'rgba(185,46,37,0.30)',
        },
        warn: {
          DEFAULT: '#d97706',
        },

        // ── TintScale full scale (available as Tailwind classes) ─────────────
        primary: {
          950: '#200000', 900: '#3a0000', 800: '#550000',
          700: '#840000', 600: '#a20000', 500: '#b92e25',
          400: '#eb7c6e', 300: '#ffbfb4', 200: '#ffdad3',
          100: '#ffefec',  50: '#fff8f6',
          DEFAULT: '#b92e25',
          dark:    '#840000',
          light:   '#ffdad3',
        },
        secondary: {
          950: '#000f0f', 900: '#001e1d', 800: '#00302e',
          700: '#004d4b', 600: '#006260', 500: '#00afab',
          400: '#50b3af', 300: '#a9e1de', 200: '#ceecea',
          100: '#e9f9f8',  50: '#f5fcfb',
          DEFAULT: '#00afab',
        },
        accent: {
          700: '#004f37', 600: '#006548', 500: '#009371',
          400: '#60b497', 300: '#b0e1ce', 200: '#d2ede2',
          DEFAULT: '#009371',
        },
      },

      fontFamily: {
        sans:  ['var(--font-dm-sans)',  'DM Sans',           'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['var(--font-dm-serif)', 'DM Serif Display',  'ui-serif',      'Georgia',   'serif'],
        mono:  ['var(--font-jetbrains)','JetBrains Mono',    'IBM Plex Mono', 'monospace'],
      },

      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },

      animation: {
        'flash-bull': 'flashBull 600ms ease-out',
        'flash-bear': 'flashBear 600ms ease-out',
        'fade-in':    'fadeIn 200ms ease-out',
      },

      keyframes: {
        flashBull: {
          '0%':   { backgroundColor: 'rgba(0,147,113,0.25)' },
          '100%': { backgroundColor: 'transparent' },
        },
        flashBear: {
          '0%':   { backgroundColor: 'rgba(185,46,37,0.25)' },
          '100%': { backgroundColor: 'transparent' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
