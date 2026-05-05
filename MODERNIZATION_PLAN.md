# 🚀 Modernization Plan — Monte Carlo V3

**Status:** Phase 1 complete (deployed live 2026-05-04)
**Vision:** Bloomberg-lite global terminal for traders / portfolio managers
**Timeline:** ~3-4 months solo dev to reach full terminal feel
**Cost:** $0/month during dev (free tiers); $5-50/month at scale

---

## 🎯 Vision (revised 2026-05-04)

This is **NOT** a US-macro dashboard. This is a **Bloomberg-style global terminal** combining:

```
🌍 GLOBAL MACRO          📈 INSTRUMENTS LIVE           🎲 ANALYTICS
US, EU, UK, JP, CN...    Stocks, ETFs, Bonds, FX,     Monte Carlo, VaR,
30+ indicators           Commodities — globally       Scenarios

🔍 UNIVERSAL SEARCH      🔥 DISCOVERY FEED             📚 RESEARCH
By name, ticker, ISIN    "What's hot today" —          Theses, probabilities,
fuzzy match, autocomplete trending stocks/ETFs/bonds   backtests
```

Built for: a single user / small team who wants institutional-grade analysis without paying $24,000/year for a Bloomberg Terminal.

---

## 📊 Roadmap (revised — 11 phases counting sub-phases)

| # | Phase | Status | Estimate | Key deliverable |
|---|-------|--------|----------|-----------------|
| 0 | Foundation (FastAPI + Next.js + cloud) | ✅ Done | — | Live skeleton on Vercel + Railway |
| 1 | Global Macro Dashboard (4 countries, 17 indicators) | ✅ Done | — | `/dashboard` with live FRED data |
| **1.5** | **Polish v1** (terminal palette, monospace nums, click-to-detail, TradingView charts) | ⏳ Next | 2-3h | Site stops looking "cheap" |
| 2 | Instruments universels (yfinance, search via OpenFIGI, page détail) | 🔜 | 3 sem | `/instrument/{ticker}` + global search bar |
| 2.5 | Index/ETF decomposition (25+ indices: S&P, CAC, DAX, Nikkei... + ETFs) | 🔜 | 1-2 sem | Treemap, table, sectors per index |
| 2.7 | Discovery feed ("Today" / trending stocks-ETFs-bonds) | 🔜 | 1-2 sem | `/discover` — what's moving live |
| 3 | Monte Carlo intégré (4 modèles existants sur n'importe quel instrument) | 🔜 | 2 sem | Forecast / VaR / scenarios button on instrument page |
| 3.5 | Sentiment (Fear & Greed, FOMO, analyst consensus, insider, short interest) | 🔜 | 1-2 sem | `/sentiment` + widgets dans page instrument |
| **3.7** | **Indicateurs techniques (EMA/MACD/Stochastic/RSI/Bollinger)** | 🔜 | 1-2 sem | Overlays toggle-ables sur tous les charts d'instruments |
| 4 | Obligations & yield curves globales | 🔜 | 2 sem | `/bonds` (souverains, corporate, courbes par pays) |
| 5 | Thèses & probabilités (CMS éditorial + analytics) | 🔜 | 2 sem | `/research` (recession proba, default proba, custom theses) |
| 6 | Polish Bloomberg final (multi-fenêtres, watchlists, alertes, dark terminal) | 🔜 | 2 sem | Layout multi-pane "trading desk" |

---

## 🧱 Architecture principles (figés)

1. **Multi-provider abstraction layer** — toute donnée externe passe par une couche
   `services/{domain}/` avec `BaseProvider` + `Service` orchestrateur. Permet de
   changer/ajouter des sources sans toucher API ni frontend.

2. **Feature branches + PR + Vercel preview** depuis Phase 1. Plus de commit
   direct sur `main` (sauf docs).

3. **Free tier first** pour toutes les sources externes. Budget paid APIs uniquement
   après validation usage (Phase 5+).

4. **Données privées en `.env`** uniquement (jamais commité). Variables
   d'environnement sur Railway/Vercel pour la prod.

5. **TypeScript strict** côté frontend. Tests `next build` localement avant
   chaque push (sinon Vercel échoue silencieusement en preview).

---

## 🔌 Sources de données (toutes gratuites pour MVP)

| Module | Sources | Free tier |
|--------|---------|-----------|
| **Macro** | FRED, OECD, ECB, World Bank, BoJ, BoE | ✅ Illimité (sauf FRED clé) |
| **Instruments** | yfinance, Financial Modeling Prep, OpenFIGI | ✅ Illimité (FMP 250/j) |
| **Indices/ETFs** | Wikipedia (constituents), iShares/SPDR/Vanguard CSVs | ✅ Illimité |
| **Sentiment** | Reddit API, NewsAPI, SEC EDGAR, Finnhub | ✅ Limité mais OK |
| **News** | NewsAPI, RSS feeds Reuters/FT | ✅ 100/jour suffisant |
| **Bonds** | yfinance (treasuries), FMP (corporate) | ✅ |

**Sources payantes envisagées (Phase 5+):** Twitter API ($100/mo), Trading Economics ($75/mo), Refinitiv (institutionnel).

---

## 🚀 Stack technique (figée)

| Couche | Choix | Pourquoi |
|--------|-------|----------|
| Frontend | Next.js 14 + TypeScript + Tailwind | Modern, SSR, type-safe |
| Charts | Recharts (sparklines) + TradingView lightweight-charts (pro) | Free, financial-grade |
| Backend | FastAPI 0.136 (Python 3.13, async) | Performance + Pydantic validation |
| ORM | SQLAlchemy 2.0 (Phase 4+) | Standard Python |
| Database | PostgreSQL Railway (Phase 3+) | Free tier, fiable |
| Hosting | Vercel (frontend) + Railway (backend) | Free + auto-deploy |
| Search | OpenFIGI (Bloomberg, free) + rapidfuzz local | Couvre ISIN/ticker/nom mondial |

---

## 📈 Pages cibles (visibilité utilisateur)

```
/                    Home (status + quick links)
/dashboard           Global macro (4 pays / 17 indicateurs)  [✅ Phase 1]
/discover            Today / Trending stocks-ETFs-bonds       [Phase 2.7]
/search?q=...        Résultats recherche universelle           [Phase 2]
/instrument/{ticker} Page détail instrument + chart + Monte Carlo  [Phase 2-3]
/index/{symbol}      Décomposition indice (S&P, CAC, etc.)    [Phase 2.5]
/sentiment           Fear & Greed, FOMO, sentiment            [Phase 3.5]
/bonds               Obligations globales + yield curves       [Phase 4]
/research            Thèses, probabilités, backtests           [Phase 5]
/watchlist           (Phase 6) Favoris persistants
```

---

## 💰 Coût (rappel)

```
Aujourd'hui (Phase 1 done):     $0/mois
Phase 2-5 (ajout APIs):          $0/mois (free tiers)
Phase 6 + petite scale:          $5-15/mois (Railway DB upgrade)
Si tu veux X/Twitter en live:    +$100/mois (Twitter API basic)
Si tu veux Trading Economics:    +$75/mois
```

**Tu peux atteindre le terminal Bloomberg-lite complet pour $0/mois si tu acceptes les free tiers.**

---

## 📚 Pour aller plus loin

- [DETAILED_DEVELOPMENT_PLAN.md](./DETAILED_DEVELOPMENT_PLAN.md) — Détail technique par phase
- [LINKS.txt](./LINKS.txt) — Toutes les URLs prod, dashboards cloud, APIs externes
- [PROJECT_RULES.md](./PROJECT_RULES.md) — Conventions de communication & process
- [phase0_completion.md](.claude/...memory/phase0_completion.md) — Bilan Phase 0
- [phase1_completion.md](.claude/...memory/phase1_completion.md) — Bilan Phase 1

---

**Updated:** 2026-05-04 (Phase 1 deployed, vision revised to Bloomberg-lite global)
