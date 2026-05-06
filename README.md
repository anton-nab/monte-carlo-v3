# Monte Carlo v3 — Financial Analysis Platform

Full-stack financial analysis platform. React frontend (Vercel) + FastAPI backend (Railway) + yfinance/FRED data.

**Live:**
- Frontend → https://monte-carlo-v3.vercel.app *(update with actual URL)*
- Backend API → https://monte-carlo-v3.up.railway.app *(update with actual URL)*
- API Docs → `/docs` (Swagger UI)

---

## ✅ What's Built

### Phase 0 — Foundation
- FastAPI backend skeleton, CORS, health check
- Next.js 14 + Tailwind CSS frontend
- Railway (backend) + Vercel (frontend) deployment

### Phase 1 — Macro Dashboard
- 10+ macro indicators via FRED API (CPI, unemployment, GDP, yield curve, Fed rate, oil, dollar index…)
- Interactive line charts (Recharts)
- Live data, 1h cache

### Phase 2 — Instruments
- Universal search (stocks, ETFs, crypto, forex, indices) with fuzzy matching
- Instrument detail page: quote, OHLCV chart, fundamentals, news, ETF holdings
- Any Yahoo Finance ticker supported (AAPL, BTC-USD, EUR/USD, ^GSPC…)
- 30s quote refresh via SWR

### Phase 2.5 — Global Indices
- 16 global indices with constituent breakdown
- 3 views: **Heatmap** (treemap by sector), **Table** (sortable, filterable), **Sectors** (donut chart)
- Two-phase loading: fast metadata (~1s) + background price enrichment (cached 15min)
- Skeleton screens on all loading states

### Phase 2.6 — Data Sources & Performance
- SP500: live from GitHub CSV (auto-updated quarterly, 503 stocks, 11 sectors)
- SWR caching throughout frontend (stale-while-revalidate)
- Fixed: Wikipedia and FMP both dead/blocked → replaced with reliable sources

---

## 📊 Supported Indices

| Index | Region | Stocks | Data Source |
|-------|--------|--------|-------------|
| S&P 500 | 🇺🇸 USA | 503 | GitHub CSV (auto-updated) |
| Nasdaq 100 | 🇺🇸 USA | 91 | Hardcoded |
| Dow Jones | 🇺🇸 USA | 30 | Hardcoded |
| CAC 40 | 🇫🇷 France | 40 | Hardcoded |
| DAX 40 | 🇩🇪 Germany | 40 | Hardcoded |
| FTSE 100 | 🇬🇧 UK | 60 | Hardcoded |
| EURO STOXX 50 | 🇪🇺 Eurozone | 50 | Hardcoded |
| SMI | 🇨🇭 Switzerland | 20 | Hardcoded |
| IBEX 35 | 🇪🇸 Spain | 35 | Hardcoded |
| Nifty 50 | 🇮🇳 India | 50 | Hardcoded |
| Nikkei 225 | 🇯🇵 Japan | 71 | Hardcoded |
| Hang Seng | 🇭🇰 Hong Kong | 50 | Hardcoded |
| S&P/ASX 200 | 🇦🇺 Australia | 50 | Hardcoded |
| S&P/TSX 60 | 🇨🇦 Canada | 61 | Hardcoded |
| Bovespa | 🇧🇷 Brazil | 50 | Hardcoded |
| Russell 2000 | 🇺🇸 USA | — | Price only (2000 stocks) |

---

## 🗺️ Roadmap

### ✅ Done — Phases 0–2.6
See above.

### 🔜 Phase 3 — Monte Carlo Simulation Engine
*The core feature of the project.*
- [ ] Endpoint `POST /api/simulate` — run Monte Carlo simulation server-side
- [ ] Models: GBM (baseline), Merton (jumps), Heston (stochastic vol), GARCH (clustering)
- [ ] Response: trajectories, VaR, Expected Shortfall, percentiles
- [ ] Frontend simulation page: ticker input → parameters → results
- [ ] Interactive charts: fan chart (trajectories), distribution histogram, density heatmap
- [ ] Results: VaR 95%/99%, Expected Shortfall, max drawdown, P(loss)

### 🔜 Phase 4 — Portfolio Analysis
- [ ] Multi-asset portfolio constructor (add tickers + weights)
- [ ] Markowitz efficient frontier
- [ ] Optimal Sharpe ratio portfolio
- [ ] Correlated Monte Carlo (Cholesky decomposition)
- [ ] Portfolio risk metrics (VaR, diversification ratio, correlation matrix)
- [ ] Portfolio vs benchmark comparison

### 🔜 Phase 5 — Backtesting
- [ ] Rolling-window backtesting on historical data
- [ ] VaR coverage (empirical vs theoretical)
- [ ] Calibration diagnostic (well-calibrated / over/under-estimates risk)
- [ ] Model comparison (which model fits best for this asset?)

### 🔜 Phase 6 — User Features
- [ ] Watchlists (save favourite instruments)
- [ ] Saved simulations + portfolios
- [ ] Auth (NextAuth or Clerk)
- [ ] PostgreSQL persistence (Railway)

### 💡 Future Ideas
- [ ] Options pricing (Black-Scholes, Greeks)
- [ ] Risk contribution per asset in portfolio
- [ ] Stress testing (custom scenario: "what if vol doubles?")
- [ ] Mobile-responsive layout improvements
- [ ] Russell 2000 constituent display (top 200 from IWM ETF)
- [ ] Export simulation results to PDF

---

## 🏗️ Architecture

```
monte-carlo-v3/
├── backend/                    # FastAPI — deployed on Railway
│   ├── main.py                 # App entry point, CORS, routes
│   ├── api/
│   │   ├── macro.py            # /api/macro/* (FRED data)
│   │   ├── instruments.py      # /api/instruments/* (yfinance)
│   │   ├── search.py           # /api/search/* (fuzzy search)
│   │   └── indices.py          # /api/indices/* (global indices)
│   └── services/
│       ├── fred_provider.py    # FRED API client
│       ├── instruments/        # yfinance wrapper
│       └── indices/
│           ├── indices_registry.py   # All 16 indices + constituent lists
│           ├── indices_service.py    # Orchestration + price enrichment
│           ├── csv_provider.py       # GitHub CSV fetcher (SP500)
│           └── wikipedia_provider.py # Kept for future use
│
└── frontend/                   # Next.js 14 — deployed on Vercel
    ├── pages/
    │   ├── index.tsx           # Home / Macro dashboard
    │   ├── search.tsx          # Universal search
    │   ├── instrument/[ticker].tsx   # Instrument detail
    │   └── indices/
    │       ├── index.tsx       # All indices list
    │       └── [symbol].tsx    # Index detail (heatmap/table/sectors)
    ├── components/
    │   └── Header.tsx
    └── lib/
        └── fetcher.ts          # SWR fetcher
```

---

## 🛠️ Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, Recharts, SWR |
| Backend | FastAPI, Python 3.13, uvicorn |
| Data | yfinance (prices), FRED API (macro), GitHub CSV (SP500) |
| Deploy | Vercel (frontend), Railway (backend) |

---

## 🚀 Local Development

```bash
# Backend
cd backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev      # → http://localhost:3000
```

**Environment variables:**
```
# backend/.env
FRED_API_KEY=your_fred_key        # https://fred.stlouisfed.org/
```

---

## 📡 API Endpoints

```
GET  /health                              Health check
GET  /api/version                         API version

GET  /api/macro/{indicator}               Macro data (FRED)
     Indicators: gdp, inflation, unemployment, fed-rate,
                 yield-curve, oil, dollar, vix, ...

GET  /api/search?q={query}                Universal search
GET  /api/instruments/snapshot/{ticker}   Full instrument data
GET  /api/instruments/chart/{ticker}      OHLCV history
GET  /api/instruments/quote/{ticker}      Real-time quote
GET  /api/instruments/news/{ticker}       Latest news
GET  /api/instruments/etf-holdings/{etf}  ETF top holdings

GET  /api/indices/                        All indices list (with prices)
GET  /api/indices/{symbol}                Index detail + constituents + prices
GET  /api/indices/{symbol}?include_prices=false  Fast path (no price enrichment)

GET  /api/debug/sources                   Data source connectivity check
```
