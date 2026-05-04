/**
 * PostCSS Configuration
 * ====================
 *
 * QUOI: Pipeline CSS de Next.js
 * POURQUOI: Tailwind passe par PostCSS pour generer le CSS final
 *           Autoprefixer ajoute automatiquement les prefixes navigateurs (-webkit-, -moz-, ...)
 */

module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
