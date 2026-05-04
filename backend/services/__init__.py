"""
Services package
================

Contient toute la logique metier (business logic) du backend.
Separe du code des routes (api/) et de la config (main.py).

Structure:
    services/
    ├── macro/      Donnees macroeconomiques (Fred, OECD, World Bank, ECB...)
    ├── company/    (Phase 2) Donnees societes (yfinance, Finnhub...)
    └── monte_carlo/ (Phase 3) Modeles stochastiques (GBM, Heston, Merton, GARCH)
"""
