/**
 * Tailwind CSS Configuration
 * ==========================
 *
 * QUOI: Configuration de Tailwind pour Next.js
 * POURQUOI: Tailwind doit savoir quels fichiers scanner pour trouver
 *           les classes utilisees (sinon il purge tout en production)
 *
 * Documentation: https://tailwindcss.com/docs/configuration
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Quels fichiers Tailwind doit scanner pour les classes
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './app/**/*.{js,ts,jsx,tsx}',  // Future Next.js App Router
  ],

  // Theme customization (extensible quand on aura besoin de couleurs custom)
  theme: {
    extend: {
      // Phase 1: rien pour l'instant, on utilise les defaults
      // Phase 6 (Bloomberg-style): ajouter palette terminal (vert/orange sur noir)
    },
  },

  // Plugins (vide pour Phase 1)
  plugins: [],
};
