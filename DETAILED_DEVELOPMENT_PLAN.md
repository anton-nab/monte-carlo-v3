# 📐 Detailed Development Plan - Blocks & Architecture

> ## ⚠️ ROADMAP V2 (revised 2026-05-04) — supersede les sections datées
>
> Ce document a été écrit avant la pivotation vers la vision **Bloomberg-lite global**.
> Les sections legacy (Phase 1 = US macro only, etc.) restent en bas comme reference
> historique mais ne reflètent plus la cible. **La source de vérité actuelle est:**
>
> - [MODERNIZATION_PLAN.md](./MODERNIZATION_PLAN.md) — vue d'ensemble + roadmap 11 phases
> - Cette section "ROADMAP V2" ci-dessous — détails par phase
>
> ---
>
> ## 🆕 Phases ajoutées par rapport au plan d'origine
>
> ### Phase 1.5 — Polish v1 (~2-3h)
> Refresh visuel du dashboard actuel sans ajouter de feature data.
> - **Palette finance**: deep navy/black background, accents cyan/vert/rouge,
>   blanc cassé pour le texte (style terminal)
> - **Typographie monospace pour les chiffres** (`JetBrains Mono` ou `IBM Plex Mono`) —
>   convention Bloomberg / Trade Republic
> - **Cards plus denses** (style trading desk vs space-héro)
> - **Hover effects** + animations sur tick updates (flash vert/rouge)
> - **Click sur card → modal plein écran** avec chart agrandi
> - **Period selector** (1M / 6M / 1Y / 5Y / Max) sur le chart agrandi
> - **Migration Recharts → TradingView lightweight-charts** (gratuit, MIT, pro-grade)
> - **Barre de recherche header** (placeholder pour P2 — visuel seulement)
>
> ### Phase 2 — Instruments universels (refonte du Phase 2 d'origine)
> Couvre maintenant TOUS les types d'instruments, pas juste les actions US.
> - **yfinance** comme source primaire (gratuit, global: stocks, ETF, indices, FX,
>   commodities, crypto via Yahoo)
> - **OpenFIGI** (Bloomberg open API gratuit) pour mapping ISIN ↔ ticker ↔ nom
> - **Search universelle**: tape "Apple", "AAPL", "US0378331005" (ISIN), "AI.PA" — toutes
>   ces formes ramènent au même instrument
> - **Index local de ~70k tickers** avec fuzzy matching (rapidfuzz Python) pour
>   suggestions instantanées en autocomplete
> - **Page `/instrument/{ticker}`**: chart pro (TradingView), prix live, fondamentaux
>   (P/E, EPS, dividende, market cap), news liées, bouton "Run Monte Carlo"
> - **Intraday timeframes** (1m / 5m / 15m / 1H / 4H / 1D / 1W / 1M) sur les
>   instruments — yfinance supporte intraday via `period=1d, interval=5m`.
>   Period selector affiche: intraday courts puis 1M, 6M, 1Y, 5Y, Max comme actuellement.
> - **Lien "View on TradingView"** sur chaque chart instrument (URL pattern:
>   `https://www.tradingview.com/chart/?symbol=NASDAQ:AAPL`)
> - **Backend**: `services/instruments/` avec `BaseInstrumentProvider`,
>   `YFinanceProvider`, `instruments_service.py`
>
> ### Phase 2.5 — Index/ETF decomposition (NOUVELLE)
> Voir **n'importe quel indice mondial** ou ETF avec ses composants détaillés.
> - **25+ indices mondiaux**: S&P 500, Nasdaq 100, Dow 30, Russell 2000, EuroStoxx 50,
>   STOXX 600, DAX 40, CAC 40, FTSE 100, FTSE MIB, IBEX 35, SMI, AEX, Nikkei 225,
>   TOPIX, CSI 300, Hang Seng, KOSPI, Nifty 50, Bovespa, TSX 60, ASX 200
> - **ETFs**: tous ceux dont l'issuer publie ses holdings (iShares, SPDR, Vanguard,
>   ARK, Global X) — soit ~95% des ETF majeurs
> - **3 vues par indice**: treemap (heatmap), table triable, donut sectoriel
> - **Sources gratuites**: Wikipedia (constituents), iShares/SPDR/Vanguard CSVs
>   officiels, Financial Modeling Prep en backup (250 calls/jour free)
> - **Page `/index/{symbol}`** — chaque carré du treemap cliquable vers
>   `/instrument/{ticker}` du composant
>
> ### Phase 2.7 — Discovery feed "Today" (NOUVELLE)
> Page d'accueil du trader: ce qui bouge maintenant.
> - **Top gainers/losers** (24h, 7j) par marché
> - **Volume inhabituel** (>3x moyenne 30j)
> - **52-week highs/lows** breaks
> - **Buzz Reddit WSB** (mentions count delta) via Reddit API gratuit
> - **News velocity** via NewsAPI (free 100/jour)
> - **Insider buys récents** via SEC EDGAR (Form 4)
> - **Short squeeze candidates** (short interest >20% + momentum)
> - **ETF flows** quotidiens
> - **Crypto trending** via CoinGecko free
> - **Page `/discover`** — cards cliquables vers `/instrument/{ticker}`
>
> ### Phase 3.7 — Indicateurs techniques (NOUVELLE)
> Overlays techniques sur les charts d'instruments — demande utilisateur explicite
> Phase 1.5 ("EMA, MACD, Stochastics... directement sur la courbe").
> - **Priorite 1** (les 3 nommes par l'utilisateur):
>   - **EMA** (Exponential Moving Average) — overlay sur le chart principal
>   - **MACD** (Moving Average Convergence Divergence) — panel separe en bas
>   - **Stochastic Oscillator** — panel separe en bas
> - **Priorite 2** (standards complementaires):
>   - **RSI** (Relative Strength Index)
>   - **Bollinger Bands** (overlay)
>   - **VWAP** (Volume Weighted Average Price)
>   - **SMA** (Simple Moving Average) — overlay
> - **Implementation**:
>   - Calculs server-side dans `services/analytics/` (pandas-ta ou talib-py)
>   - Cacheable, partage entre users
>   - Frontend: ajoute `Line series` ou panel via lightweight-charts
>   - Toggle on/off via UI (checkboxes ou panneau lateral)
> - **Pages impactees**: `/instrument/{ticker}` (Phase 2), `/index/{symbol}` (Phase 2.5),
>   futurs charts d'obligations (Phase 4)
>
> ### Phase 3.5 — Sentiment (NOUVELLE)
> Indicateurs de sentiment de marché.
> - **CNN Fear & Greed Index** (scraping légal des données publiques)
> - **Crypto Fear & Greed** (alternative.me free API)
> - **Custom FOMO indicator** combinant volume + buzz social + price action
> - **Analyst consensus** (Strong Buy/Buy/Hold/Sell ratios) via yfinance
> - **Insider trading clusters** (multiple insiders buying same stock = signal)
> - **Short interest** + "days to cover" via Finnhub free
> - **Page `/sentiment`** + widgets dans `/instrument/{ticker}`
>
> ### Phase 6 — Polish Bloomberg final (refonte du Phase 5 d'origine)
> - **Layout multi-pane** (style Bloomberg Terminal): 4-6 fenêtres redimensionnables
>   sur l'écran (ex: chart top-left, news top-right, watchlist bottom-left,
>   simulation bottom-right)
> - **Watchlists persistantes** (PostgreSQL + auth simple)
> - **Alertes** (price cross, news event, volume spike) via WebSocket push
> - **Dark mode terminal** complet (vert/orange sur noir, monospace partout)
> - **Raccourcis clavier** (style Bloomberg: G GO pour ticker, etc.)
> - **Multi-screen** (drag chart vers fenêtre séparée)
>
> ---
>
> ## 📋 Roadmap finale tabulaire
>
> | # | Phase | Status | Sortie utilisateur |
> |---|-------|--------|---------------------|
> | 0 | Foundation | ✅ Done | Site live |
> | 1 | Global Macro | ✅ Done | `/dashboard` 4 pays / 17 indicators |
> | 1.5 | Polish v1 | ⏳ Next | Site stop being "cheap" |
> | 2 | Instruments universels | 🔜 | Search globale + page instrument |
> | 2.5 | Index/ETF decomposition | 🔜 | `/index/{symbol}` 25+ indices |
> | 2.7 | Discovery feed | 🔜 | `/discover` "today" |
> | 3 | Monte Carlo intégré | 🔜 | Forecast bouton sur chaque instrument |
> | 3.5 | Sentiment | 🔜 | `/sentiment` + widgets |
> | 3.7 | **Indicateurs techniques (EMA/MACD/Stoch/RSI/...)** | 🔜 | Overlays sur charts instruments |
> | 4 | Obligations & yield curves | 🔜 | `/bonds` global |
> | 5 | Thèses & probabilités | 🔜 | `/research` |
> | 6 | Polish Bloomberg final | 🔜 | Multi-pane layout terminal |
>
> **Estimation totale restante:** ~3-4 mois solo dev pour atteindre Phase 6.
>
> ---
>
> ## 📦 APIs gratuites mobilisées par phase
>
> | API | Phase | Usage |
> |-----|-------|-------|
> | FRED | ✅ 1 | Macro US + données internationales redistribuées |
> | OECD | 1.5+ | Macro internationales natives (donnees fraiches) |
> | yfinance | 2 | Tous instruments (stocks/ETF/indices/FX/commodities/crypto) |
> | OpenFIGI | 2 | Mapping ISIN/CUSIP/ticker/nom mondial |
> | Financial Modeling Prep | 2, 2.5 | Backup search + index data (250/jour) |
> | Wikipedia | 2.5 | Constituents indices (S&P 500, CAC 40, ...) |
> | iShares/SPDR/Vanguard CSVs | 2.5 | Holdings ETF officiels |
> | Reddit API | 2.7, 3.5 | Buzz WSB, mentions count |
> | NewsAPI | 2.7, 5 | News velocity (100/jour free) |
> | SEC EDGAR | 2.7, 3.5 | Insider trading, filings |
> | Finnhub | 2, 3.5 | Fundamentals, short interest, analyst |
> | CoinGecko | 2.7 | Crypto trending |
> | alternative.me | 3.5 | Crypto Fear & Greed |
> | CNN Fear & Greed | 3.5 | Equity F&G (web scraping légal) |
>
> ---
>
> ## 🔚 Fin de la section ROADMAP V2 — le legacy ci-dessous est conservé pour reference

---

## Vision Complète du Projet (legacy)

Vous allez transformer votre Streamlit local en **plateforme cloud professionnel**, étape par étape.

```
AVANT (Actuel)
==============
┌─────────────────────────────────┐
│     Streamlit (Local)           │
│  - UI + Logique mélangées       │
│  - Yahoo Finance seulement      │
│  - Pas d'API, pas de cloud      │
└─────────────────────────────────┘

APRÈS (Cible)
=============
┌──────────────────────────────────────────────────────────────┐
│                    Frontend (React/Next.js)                  │
│   Dashboard | Simulator | Company | Opportunities | Export   │
└────────────────────────┬─────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
┌───────▼────────┐ ┌────▼─────────┐ ┌───▼────────────┐
│  FastAPI       │ │  WebSocket   │ │  Background   │
│  REST API      │ │  (Real-time) │ │  Jobs         │
└───────┬────────┘ └────┬─────────┘ └───┬────────────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
┌───────▼────────┐ ┌────▼─────────┐ ┌───▼────────────┐
│  PostgreSQL    │ │  Fred API    │ │  Finnhub API  │
│  (App data)    │ │  (Macro)     │ │  (Company)    │
└────────────────┘ └──────────────┘ └───────────────┘
```

---

## Architecture en Couches

```
┌─────────────────────────────────────────────────────────────┐
│                      COUCHE PRÉSENTATION                     │
│  (Frontend - Next.js React, Tailwind, Recharts)             │
│                                                              │
│  Pages:                                                      │
│  ├─ Dashboard        (home page, macro overview)            │
│  ├─ Simulator        (Monte Carlo interface)                │
│  ├─ Company/:ticker  (fiche entreprise détaillée)          │
│  ├─ Opportunities    (screener de stocks)                   │
│  └─ Analysis/:id     (saved analyses, reports)             │
└─────────────────────────────────────────────────────────────┘
                             ↓
        ┌────────────────────────────────────────────┐
        │  HTTP REST API + WebSocket                  │
        │  (Vercel ↔ Railway communication)           │
        └────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                    COUCHE MÉTIER (API)                       │
│  (FastAPI Python - Railway backend)                         │
│                                                              │
│  Endpoints:                                                 │
│  ├─ /api/macro/*          (Fred data + calculations)       │
│  ├─ /api/company/*        (Finnhub, SEC data)              │
│  ├─ /api/simulate         (Monte Carlo execution)          │
│  ├─ /api/opportunities    (Screener logic)                 │
│  └─ /api/analysis/*       (Save/retrieve analyses)         │
│                                                              │
│  Services:                                                  │
│  ├─ MacroService          (calculations: EMA, yields)      │
│  ├─ CompanyService        (fundamentals, health score)     │
│  ├─ SimulationService     (import from simulation.py)      │
│  └─ OpportunityService    (screener rules)                 │
└─────────────────────────────────────────────────────────────┘
                             ↓
        ┌────────────────────────────────────────────┐
        │  Database ORM (SQLAlchemy)                 │
        │  External APIs (httpx async)               │
        └────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                   COUCHE DONNÉES & APIS                      │
│                                                              │
│  PostgreSQL (Railway)                                       │
│  ├─ Users & sessions                                        │
│  ├─ Watchlists                                             │
│  ├─ Saved analyses                                         │
│  └─ User preferences                                       │
│                                                              │
│  External APIs (Free)                                       │
│  ├─ Fred (macro data)                                      │
│  ├─ Finnhub (company data)                                 │
│  ├─ Yahoo (historical)                                    │
│  ├─ SEC Edgar (filings)                                    │
│  └─ NewsAPI (news)                                        │
│                                                              │
│  Python Modules (vos codes existants)                       │
│  ├─ simulation.py                                          │
│  ├─ risk_metrics.py                                        │
│  ├─ optimization.py                                        │
│  └─ correlation.py                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Phases Détaillées

### PHASE 0: Foundation (Semaines 1-2)

**Objectif:** Avoir une app en production (même vide) que vous pouvez visiter en ligne

#### Block 0.1: Backend Minimal
```
Créer: backend/main.py (200 lignes)

Structure:
  ├─ FastAPI app
  ├─ CORS configuration
  ├─ 3 endpoints de test:
  │  ├─ GET /health              (toujours "ok")
  │  ├─ GET /api/version         (renvoie "0.0.1")
  │  └─ POST /api/test           (echo le paramètre)
  └─ uvicorn configuration

Déployer sur: Railway
Résultat: API accessible via https://yourapp-backend.railway.app
```

**Code détaillé:**
```python
# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Monte Carlo API", version="0.0.1")

# CORS pour que Vercel frontend puisse appeler
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://your-frontend.vercel.app",
        "http://localhost:3000"
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.0.1"}

@app.get("/api/version")
async def version():
    return {"app": "Monte Carlo", "version": "0.0.1"}

@app.post("/api/test")
async def test_echo(data: dict):
    return {"echo": data, "received_at": datetime.now()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

#### Block 0.2: Frontend Minimal
```
Créer: frontend/pages/index.tsx (150 lignes)

Structure:
  ├─ Home page avec:
  │  ├─ Title "Monte Carlo Simulator"
  │  ├─ 3 buttons: Dashboard, Simulator, Company
  │  ├─ Status indicator (API connected? ✅/❌)
  │  └─ Version display
  └─ API health check on load

Déployer sur: Vercel
Résultat: Accessible via https://yourapp.vercel.app
```

**Code détaillé:**
```typescript
// frontend/pages/index.tsx
import { useState, useEffect } from 'react';

export default function Home() {
  const [apiStatus, setApiStatus] = useState('checking...');

  useEffect(() => {
    // Test API connection
    const testApi = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/health`
        );
        const data = await response.json();
        setApiStatus('Connected ✅');
      } catch (error) {
        setApiStatus('Disconnected ❌');
      }
    };

    testApi();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-purple-600">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center text-white">
          <h1 className="text-5xl font-bold mb-4">
            📈 Monte Carlo Simulator v3
          </h1>
          <p className="text-xl mb-8">
            IBM-Equivalent Financial Analysis Platform
          </p>

          <div className="mb-8 p-4 bg-white bg-opacity-20 rounded-lg">
            <p>API Status: {apiStatus}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button className="px-8 py-4 bg-blue-500 rounded-lg text-lg font-bold hover:bg-blue-600">
              📊 Dashboard
            </button>
            <button className="px-8 py-4 bg-purple-500 rounded-lg text-lg font-bold hover:bg-purple-600">
              🎲 Simulator
            </button>
            <button className="px-8 py-4 bg-pink-500 rounded-lg text-lg font-bold hover:bg-pink-600">
              🏢 Company
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

#### Block 0.3: Deployment Configuration
```
Créer:
  ├─ backend/requirements.txt
  ├─ backend/Procfile (pour Railway)
  ├─ frontend/.env.local
  └─ frontend/vercel.json

Railway setup:
  - Link GitHub repo
  - Set env vars (FRED_KEY, FINNHUB_KEY)
  - Auto-deploy on push

Vercel setup:
  - Link GitHub repo
  - Set NEXT_PUBLIC_API_URL env var
  - Auto-deploy on push
```

**Phase 0 Success Criteria:**
- ✅ Backend running on Railway
- ✅ Frontend running on Vercel
- ✅ Frontend shows "API Status: Connected ✅"
- ✅ Both URLs accessible (no localhost)

---

### PHASE 1: Macro Dashboard (Semaines 2-4)

**Objectif:** Les données macroéconomiques sont le HÉROS de la plateforme

#### Block 1.1: Fred API Integration

```
backend/services/fred_service.py (300 lignes)

Services:
  ├─ FredClient class:
  │  ├─ __init__(api_key)
  │  ├─ fetch_series(series_id, limit)      → GET raw data from Fred
  │  ├─ format_timeseries(data)             → Convert to frontend format
  │  └─ batch_fetch(series_ids)             → Parallel requests
  │
  ├─ MacroService class:
  │  ├─ get_inflation()                     → CPI data + trend
  │  ├─ get_unemployment()                  → UNRATE + forecast
  │  ├─ get_gdp()                           → Quarterly GDP growth
  │  ├─ get_fed_rate()                      → Current + historical
  │  ├─ get_yield_curve()                   → 3mo-30yr spreads
  │  ├─ compute_ema(series, window)         → 20/50/200 EMA
  │  ├─ compute_sma(series, window)         → Simple moving averages
  │  └─ detect_recession()                  → Auto-detect from indicators
  │
  └─ Constants:
     └─ INDICATORS = {
          'inflation': 'CPIAUCSL',
          'unemployment': 'UNRATE',
          'gdp': 'A191RL1Q225SBEA',
          'fed_rate': 'FEDFUNDS',
          'yield_2yr': 'DGS2',
          'yield_10yr': 'DGS10',
          ... (20+ more)
        }
```

**Code détaillé:**
```python
# backend/services/fred_service.py
import httpx
import pandas as pd
from datetime import datetime, timedelta
import asyncio

class FredClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.stlouisfed.org/fred"

    async def fetch_series(self, series_id: str, limit: int = 252):
        """Fetch time series from Fred"""
        async with httpx.AsyncClient() as client:
            params = {
                "series_id": series_id,
                "api_key": self.api_key,
                "limit": limit,
                "sort_order": "desc"
            }
            response = await client.get(
                f"{self.base_url}/series/observations",
                params=params
            )
            return response.json()

    def format_timeseries(self, fred_response: dict) -> list:
        """Convert Fred format to Recharts format"""
        observations = fred_response.get('observations', [])
        
        # Reverse to chronological order (oldest first)
        observations.reverse()
        
        formatted = []
        for obs in observations:
            try:
                value = float(obs.get('value', 'NaN'))
                if value == 'NaN':
                    continue
                
                formatted.append({
                    'date': obs['date'],
                    'value': value,
                    'timestamp': datetime.strptime(obs['date'], '%Y-%m-%d').timestamp()
                })
            except:
                continue
        
        return formatted

    async def batch_fetch(self, series_ids: list) -> dict:
        """Fetch multiple series in parallel"""
        tasks = [self.fetch_series(sid, limit=252) for sid in series_ids]
        results = await asyncio.gather(*tasks)
        
        return {
            sid: self.format_timeseries(result)
            for sid, result in zip(series_ids, results)
        }


class MacroService:
    def __init__(self, fred_client: FredClient):
        self.fred = fred_client
        self.indicators = {
            'inflation': 'CPIAUCSL',
            'unemployment': 'UNRATE',
            'gdp': 'A191RL1Q225SBEA',
            'fed_rate': 'FEDFUNDS',
            'yield_2yr': 'DGS2',
            'yield_10yr': 'DGS10',
            'oil': 'DCOILWTICO',
            'copper': 'DCOILWTICO',  # placeholder
        }

    async def get_indicator(self, name: str) -> dict:
        """Get specific indicator with trend analysis"""
        if name not in self.indicators:
            raise ValueError(f"Unknown indicator: {name}")
        
        series_id = self.indicators[name]
        fred_data = await self.fred.fetch_series(series_id, limit=252)
        formatted = self.fred.format_timeseries(fred_data)
        
        # Calculate trend
        if len(formatted) >= 2:
            recent = float(formatted[-1]['value'])
            previous = float(formatted[-2]['value'])
            change = ((recent - previous) / previous) * 100 if previous != 0 else 0
        else:
            change = 0
        
        return {
            'name': name,
            'series_id': series_id,
            'data': formatted,
            'current_value': formatted[-1]['value'] if formatted else None,
            'trend_pct': change,
            'last_updated': datetime.now().isoformat()
        }

    async def get_yield_curve(self) -> dict:
        """Get yield curve (3mo, 2yr, 5yr, 10yr, 30yr)"""
        yield_series = {
            '3mo': 'DGS3MO',
            '2yr': 'DGS2',
            '5yr': 'DGS5',
            '10yr': 'DGS10',
            '30yr': 'DGS30',
        }
        
        tasks = [
            self.fred.fetch_series(sid, limit=252)
            for sid in yield_series.values()
        ]
        results = await asyncio.gather(*tasks)
        
        formatted = {
            name: self.fred.format_timeseries(result)
            for name, result in zip(yield_series.keys(), results)
        }
        
        return {
            'name': 'yield_curve',
            'yields': formatted,
            'curve_slope': self._calculate_curve_slope(formatted),
            'inverted': self._is_curve_inverted(formatted)
        }

    def _calculate_curve_slope(self, yields: dict) -> float:
        """10yr - 2yr spread"""
        try:
            yield_10yr = float(yields['10yr'][-1]['value'])
            yield_2yr = float(yields['2yr'][-1]['value'])
            return yield_10yr - yield_2yr
        except:
            return 0

    def _is_curve_inverted(self, yields: dict) -> bool:
        """Check if 2yr > 10yr (recession signal)"""
        return self._calculate_curve_slope(yields) < 0

    @staticmethod
    def compute_ema(values: list, window: int = 20) -> list:
        """Exponential Moving Average"""
        series = pd.Series([float(v['value']) for v in values])
        ema = series.ewm(span=window, adjust=False).mean()
        return ema.tolist()

    @staticmethod
    def compute_sma(values: list, window: int = 50) -> list:
        """Simple Moving Average"""
        series = pd.Series([float(v['value']) for v in values])
        sma = series.rolling(window=window).mean()
        return sma.tolist()
```

#### Block 1.2: API Endpoints

```
backend/api/macro.py (200 lignes)

Routes:
  ├─ GET /api/macro/indicators
  │   └─ Return list of available indicators with descriptions
  │
  ├─ GET /api/macro/{indicator_name}
  │   └─ Return time series + current value + trend
  │
  ├─ GET /api/macro/yield-curve
  │   └─ Return all yields + curve slope + inversion status
  │
  ├─ GET /api/macro/recession-score
  │   └─ Composite indicator (0-100) of recession probability
  │
  └─ GET /api/macro/snapshot
      └─ All major indicators in one call (for dashboard)
```

**Code détaillé:**
```python
# backend/api/macro.py
from fastapi import APIRouter, HTTPException, Query
from services.fred_service import MacroService, FredClient
import os

router = APIRouter(prefix="/api/macro", tags=["macro"])

# Initialize service
fred_client = FredClient(api_key=os.getenv("FRED_API_KEY"))
macro_service = MacroService(fred_client)

@router.get("/indicators")
async def list_indicators():
    """List all available macro indicators"""
    return {
        "indicators": [
            {
                "name": "inflation",
                "description": "Consumer Price Index (CPI)",
                "frequency": "monthly",
                "importance": "critical"
            },
            {
                "name": "unemployment",
                "description": "Unemployment Rate",
                "frequency": "monthly",
                "importance": "critical"
            },
            {
                "name": "gdp",
                "description": "Real GDP Growth",
                "frequency": "quarterly",
                "importance": "critical"
            },
            # ... 20+ more
        ],
        "total": 30
    }

@router.get("/{indicator}")
async def get_indicator(
    indicator: str,
    limit: int = Query(252, ge=30, le=1000)
):
    """Get specific indicator data"""
    try:
        data = await macro_service.get_indicator(indicator)
        return data
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.get("/yield-curve/full")
async def get_yield_curve():
    """Get complete yield curve"""
    try:
        curve = await macro_service.get_yield_curve()
        return curve
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/snapshot/all")
async def get_all_indicators():
    """Get all major indicators for dashboard (performance optimized)"""
    indicators = [
        'inflation',
        'unemployment',
        'fed_rate',
        'gdp',
        'oil'
    ]
    
    results = {}
    for indicator in indicators:
        try:
            results[indicator] = await macro_service.get_indicator(indicator)
        except:
            results[indicator] = None
    
    return {
        "timestamp": datetime.now().isoformat(),
        "indicators": results
    }
```

#### Block 1.3: Frontend - Macro Dashboard

```
frontend/components/MacroIndicator.tsx (200 lignes)

Component que vous réutilisez 30+ fois:
  ├─ Props:
  │  ├─ indicatorName: string
  │  ├─ title: string
  │  ├─ unit: string
  │  └─ isImportant: boolean
  │
  ├─ Features:
  │  ├─ Line chart (Recharts)
  │  ├─ Current value + % change
  │  ├─ EMA 20/50/200 overlays
  │  ├─ Period selector (1Y, 5Y, 10Y, Max)
  │  └─ Comparison mode (compare 2 indicators)
  │
  └─ On mount:
     └─ Fetch /api/macro/{indicatorName}

frontend/pages/dashboard.tsx (400 lignes)

Layout:
  ├─ Header
  │  ├─ Title "📊 Macro Dashboard"
  │  ├─ Last updated timestamp
  │  └─ Refresh button
  │
  ├─ Critical Indicators Row (4 columns):
  │  ├─ Inflation (CPI)
  │  ├─ Unemployment
  │  ├─ Fed Rate
  │  └─ GDP Growth
  │
  ├─ Yields & Spreads Row:
  │  ├─ Yield Curve Chart
  │  ├─ Curve Slope
  │  └─ Inversion Status (🟢 Normal / 🔴 Inverted)
  │
  ├─ Additional Indicators Grid (6 columns):
  │  ├─ Oil Price
  │  ├─ Copper
  │  ├─ Credit Spreads
  │  ├─ Consumer Sentiment
  │  ├─ Housing Starts
  │  └─ Durable Orders
  │
  └─ Comparisons Tab:
     └─ Side-by-side indicator comparison

Styling:
  ├─ Responsive grid (1 col mobile, 2 tablet, 4 desktop)
  ├─ Color-coded trends (🟢 up, 🔴 down, 🟡 flat)
  ├─ Dark mode support
  └─ Smooth animations on data update
```

**Code détaillé:**
```typescript
// frontend/components/MacroIndicator.tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useState, useEffect } from 'react';

interface MacroIndicatorProps {
  name: string;
  title: string;
  unit: string;
  decimals?: number;
}

export function MacroIndicator({
  name,
  title,
  unit,
  decimals = 2
}: MacroIndicatorProps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/macro/${name}`
        );
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Refresh every hour
    const interval = setInterval(fetchData, 3600000);
    return () => clearInterval(interval);
  }, [name]);

  if (loading) return <div className="p-4 bg-gray-100 rounded">Loading...</div>;
  if (error) return <div className="p-4 bg-red-100 rounded">{error}</div>;
  if (!data) return null;

  const currentValue = data.data[data.data.length - 1]?.value;
  const trendColor = data.trend_pct > 0 ? 'text-green-600' : 'text-red-600';

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      
      <div className="mb-4">
        <div className="text-3xl font-bold">
          {currentValue?.toFixed(decimals)} {unit}
        </div>
        <div className={`text-lg ${trendColor}`}>
          {data.trend_pct > 0 ? '📈' : '📉'} {data.trend_pct.toFixed(2)}%
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data.data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#3b82f6"
            name={title}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// frontend/pages/dashboard.tsx
import { MacroIndicator } from '@/components/MacroIndicator';

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="text-4xl font-bold mb-8">📊 Macro Dashboard</h1>

      {/* Critical Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MacroIndicator name="inflation" title="Inflation (CPI)" unit="%" decimals={2} />
        <MacroIndicator name="unemployment" title="Unemployment" unit="%" decimals={2} />
        <MacroIndicator name="fed_rate" title="Fed Rate" unit="%" decimals={2} />
        <MacroIndicator name="gdp" title="GDP Growth" unit="%" decimals={2} />
      </div>

      {/* Yields */}
      <div className="grid grid-cols-1 gap-4 mb-8">
        <MacroIndicator name="yield_10yr" title="10Y Treasury Yield" unit="%" decimals={3} />
      </div>

      {/* More indicators... */}
    </div>
  );
}
```

#### Block 1.4: Caching & Performance

```
backend/cache_service.py (100 lignes)

Caching strategy:
  ├─ Macro data: 24h TTL (updated daily by Fred)
  │  └─ Store in PostgreSQL with timestamp
  │
  ├─ Company data: 4h TTL (less stable)
  │  └─ Store with refresh timestamp
  │
  └─ User session: 30 days
     └─ PostgreSQL auth tokens

Implementation:
  ├─ Check DB for cached data
  ├─ If expired: fetch from API
  ├─ Store in DB with timestamp
  └─ Return to client

Result: API calls drop by 99%
```

**Phase 1 Success Criteria:**
- ✅ 10+ macro indicators fetched from Fred
- ✅ Dashboard displays them with charts
- ✅ EMA/SMA overlays working
- ✅ Yield curve showing
- ✅ Data updates without page refresh
- ✅ Responsive on mobile

---

### PHASE 2: Company Real-Time (Semaines 5-7)

**Objectif:** Snapshot de la santé d'une entreprise

#### Block 2.1: Finnhub Integration

```
backend/services/finnhub_service.py (250 lignes)

FinnhubClient:
  ├─ __init__(api_key)
  ├─ get_profile(ticker)           → P/E, ROE, debt, dividend
  ├─ get_quote(ticker)             → Real-time price + volume
  ├─ get_earnings_calendar()       → Next earnings
  ├─ get_company_news(ticker)      → Recent news
  └─ get_dividends(ticker)         → Dividend history

CompanyService:
  ├─ get_company_snapshot(ticker)
  │  └─ Return: ALL data in one call
  │
  ├─ calculate_health_score(ticker)
  │  └─ 0-100 score based on:
  │     ├─ P/E vs sector avg
  │     ├─ Debt ratio
  │     ├─ ROE vs sector
  │     ├─ Dividend yield
  │     └─ Recent earnings beat
  │
  ├─ detect_crisis(ticker)
  │  └─ Return: crisis_level (0-10)
  │     ├─ Red flags:
  │     │  ├─ P/E spike
  │     │  ├─ Debt ratio >70%
  │     │  ├─ Negative ROE
  │     │  ├─ Earnings miss
  │     │  └─ Negative news sentiment
  │     └─ Green flags:
  │        ├─ Dividend stable/growing
  │        └─ Positive earnings trend
  │
  └─ get_sector_averages(sector)
     └─ Compare company vs peers
```

**Code détaillé:**
```python
# backend/services/finnhub_service.py
import httpx
from datetime import datetime

class FinnhubClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://finnhub.io/api/v1"

    async def get_profile(self, ticker: str) -> dict:
        """Get company profile"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/stock/profile2",
                params={"symbol": ticker, "token": self.api_key}
            )
            return response.json()

    async def get_quote(self, ticker: str) -> dict:
        """Get real-time quote"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/quote",
                params={"symbol": ticker, "token": self.api_key}
            )
            return response.json()

    async def get_company_news(self, ticker: str, limit: int = 10) -> list:
        """Get recent company news"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/company-news",
                params={
                    "symbol": ticker,
                    "from": (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d'),
                    "to": datetime.now().strftime('%Y-%m-%d'),
                    "token": self.api_key
                }
            )
            return response.json()[:limit]


class CompanyService:
    def __init__(self, finnhub_client: FinnhubClient):
        self.finnhub = finnhub_client

    async def get_company_snapshot(self, ticker: str) -> dict:
        """Get all company data in one call"""
        profile = await self.finnhub.get_profile(ticker)
        quote = await self.finnhub.get_quote(ticker)
        news = await self.finnhub.get_company_news(ticker)

        return {
            'ticker': ticker,
            'company_name': profile.get('name'),
            'sector': profile.get('finnhubIndustry'),
            
            # Price data
            'current_price': quote.get('c'),
            'prev_close': quote.get('pc'),
            'price_change': quote.get('c') - quote.get('pc'),
            'price_change_pct': ((quote.get('c') - quote.get('pc')) / quote.get('pc') * 100) if quote.get('pc') else 0,
            'high_52w': quote.get('h'),
            'low_52w': quote.get('l'),
            
            # Fundamentals
            'market_cap': profile.get('marketCapitalization'),
            'pe_ratio': profile.get('pe'),
            'pb_ratio': profile.get('pb'),
            'dividend_yield': profile.get('dividendYield'),
            'roe': profile.get('roe'),
            'debt_to_equity': profile.get('beta'),  # placeholder
            'revenue_ttm': profile.get('ttmRevenue'),
            'gross_margin': profile.get('grossMargin'),
            
            # Recent news
            'recent_news': [
                {
                    'headline': article.get('headline'),
                    'source': article.get('source'),
                    'datetime': article.get('datetime'),
                    'url': article.get('url')
                } for article in news
            ],
            
            # Health score
            'health_score': self._calculate_health_score(profile, quote),
            'crisis_level': self._detect_crisis(profile, quote),
            'last_updated': datetime.now().isoformat()
        }

    def _calculate_health_score(self, profile: dict, quote: dict) -> float:
        """Calculate 0-100 health score"""
        score = 50  # Start at 50
        
        # P/E analysis
        pe = profile.get('pe', 0)
        if 15 < pe < 25:
            score += 10
        elif pe > 30:
            score -= 15
        elif pe < 10:
            score += 5
        
        # Dividend
        dividend = profile.get('dividendYield', 0)
        if dividend > 0.02:
            score += 15
        
        # ROE
        roe = profile.get('roe', 0)
        if roe > 0.15:
            score += 10
        elif roe < 0:
            score -= 20
        
        # Cap at 0-100
        return max(0, min(100, score))

    def _detect_crisis(self, profile: dict, quote: dict) -> int:
        """Detect crisis level (0-10)"""
        crisis = 0
        
        pe = profile.get('pe', 0)
        if pe > 50:
            crisis += 3
        
        roe = profile.get('roe', 0)
        if roe < 0:
            crisis += 5
        
        return min(10, crisis)
```

#### Block 2.2: API Endpoints

```
backend/api/company.py (150 lignes)

Routes:
  ├─ GET /api/company/{ticker}
  │   └─ Return: Full snapshot (all data)
  │
  ├─ GET /api/company/{ticker}/fundamentals
  │   └─ Return: P/E, ROE, debt, margins, etc.
  │
  ├─ GET /api/company/{ticker}/health-score
  │   └─ Return: 0-100 score + breakdown
  │
  ├─ GET /api/company/{ticker}/filings
  │   └─ Return: Recent 10-K, 10-Q, 8-K (from SEC)
  │
  └─ GET /api/company/{ticker}/news
      └─ Return: Recent news + sentiment
```

#### Block 2.3: SEC Edgar Integration

```
backend/services/sec_service.py (150 lignes)

Functions:
  ├─ get_latest_10k(ticker)       → Most recent 10-K filing
  ├─ get_latest_10q(ticker)       → Most recent 10-Q filing
  ├─ get_filing_metadata(ticker)  → List of filings with dates
  └─ extract_financial_data(filing) → Parse balance sheet data

No API key needed (public API)
```

#### Block 2.4: Frontend - Company Page

```
frontend/pages/company/[ticker].tsx (500 lignes)

Layout:
  ├─ Header
  │  ├─ Company name
  │  ├─ Ticker + sector
  │  ├─ Current price + % change
  │  └─ Market cap + P/E
  │
  ├─ Health Scorecard (3 columns)
  │  ├─ Health Score (0-100 gauge)
  │  ├─ Crisis Level (0-10 indicator)
  │  └─ Recommendation (Buy/Hold/Sell)
  │
  ├─ Fundamentals Grid (4x4)
  │  ├─ P/E Ratio
  │  ├─ PB Ratio
  │  ├─ ROE
  │  ├─ Debt/Equity
  │  ├─ Dividend Yield
  │  ├─ Revenue TTM
  │  ├─ Gross Margin
  │  └─ 52W High/Low
  │
  ├─ Price Chart (1Y, 5Y, Max)
  │  └─ Line chart with volume
  │
  ├─ Recent News Section
  │  └─ News cards with sentiment
  │
  └─ Action Buttons
     ├─ "Analyze with Monte Carlo" (→ /simulator)
     ├─ "Add to Watchlist"
     └─ "View SEC Filings"

Search:
  ├─ Global search for any ticker
  ├─ Autocomplete suggestions
  └─ Recent searches
```

**Phase 2 Success Criteria:**
- ✅ /company/[ticker] page works
- ✅ Finnhub data displays
- ✅ Health score calculated
- ✅ Crisis detection working
- ✅ SEC filings accessible
- ✅ Price charts displaying

---

### PHASE 3: Opportunity Discovery (Semaines 8-10)

**Objectif:** Screener intelligent suggère des stocks intéressants

#### Block 3.1: Screener Rules Engine

```
backend/services/screener_service.py (300 lignes)

OpportunityScreener:
  ├─ Rules:
  │  ├─ Rule 1: High Dividend + Low Debt
  │  │  └─ dividend_yield > 3% AND debt_ratio < 50%
  │  │
  │  ├─ Rule 2: Growth + Value
  │  │  └─ pe < sector_avg AND earnings_growth > 10%
  │  │
  │  ├─ Rule 3: Macro Tailwinds
  │  │  └─ fed_rate < 3% AND inflation < 4% → equity bullish
  │  │
  │  ├─ Rule 4: Volume Breakout
  │  │  └─ price_change > 5% AND volume > 2x avg
  │  │
  │  └─ Rule 5: Sentiment Flip
  │     └─ news_sentiment: negative → positive
  │
  ├─ Scoring:
  │  ├─ Each rule adds points (0-100)
  │  ├─ Weight rules by importance
  │  └─ Rank candidates by score
  │
  └─ Filter:
     ├─ Market cap range
     ├─ Sector preference
     └─ Volatility range
```

**Code détaillé:**
```python
# backend/services/screener_service.py
class OpportunityScreener:
    def __init__(self, company_service, macro_service):
        self.company = company_service
        self.macro = macro_service

    async def scan_opportunities(self, 
                                 strategy: str = "balanced",
                                 sector: str = None,
                                 limit: int = 20) -> list:
        """Scan for opportunities based on strategy"""
        
        # Get macro conditions
        fed_rate = await self.macro.get_indicator('fed_rate')
        inflation = await self.macro.get_indicator('inflation')
        
        current_fed = fed_rate['data'][-1]['value']
        current_inflation = inflation['data'][-1]['value']
        
        # Determine macro regime
        if current_fed < 3 and current_inflation < 4:
            regime = "bullish"  # Growth mode
        elif current_fed > 4 and current_inflation > 5:
            regime = "bearish"  # Defensive mode
        else:
            regime = "neutral"
        
        # Get list of tickers to scan (top 500 by market cap)
        tickers = self._get_tickers_to_scan()
        
        opportunities = []
        for ticker in tickers:
            try:
                company = await self.company.get_company_snapshot(ticker)
                score = self._score_opportunity(company, regime, strategy)
                
                if score > 50:  # Only keep good opportunities
                    opportunities.append({
                        'ticker': ticker,
                        'score': score,
                        'company': company,
                        'regime': regime,
                        'reason': self._get_reason(company, score)
                    })
            except:
                continue
        
        # Sort by score and return top N
        opportunities.sort(key=lambda x: x['score'], reverse=True)
        return opportunities[:limit]

    def _score_opportunity(self, company: dict, regime: str, strategy: str) -> float:
        """Calculate opportunity score (0-100)"""
        score = 50  # Base score
        
        pe = company.get('pe_ratio', 0)
        dividend = company.get('dividend_yield', 0)
        roe = company.get('roe', 0)
        health = company.get('health_score', 50)
        
        # Strategy: Dividend hunting (regime bearish)
        if strategy == "dividend" or regime == "bearish":
            if dividend > 0.03:
                score += 20
            if pe < 20:
                score += 15
            if company.get('debt_to_equity', 1) < 0.5:
                score += 15
        
        # Strategy: Growth hunting (regime bullish)
        elif strategy == "growth" or regime == "bullish":
            if pe < 25 and roe > 0.15:
                score += 20
            if company.get('price_change_pct', 0) > 5:
                score += 10
        
        # Health is always important
        score += (health - 50) / 5  # Add/subtract based on health
        
        # Cap at 0-100
        return max(0, min(100, score))

    def _get_reason(self, company: dict, score: float) -> str:
        """Explain why this is an opportunity"""
        reasons = []
        
        pe = company.get('pe_ratio', 0)
        if pe < 15:
            reasons.append("Low P/E ratio")
        
        dividend = company.get('dividend_yield', 0)
        if dividend > 0.03:
            reasons.append("High dividend yield")
        
        health = company.get('health_score', 50)
        if health > 70:
            reasons.append("Strong fundamentals")
        
        return " • ".join(reasons)

    def _get_tickers_to_scan(self) -> list:
        """Get list of tickers to scan"""
        # TODO: Fetch from data source (S&P 500, etc.)
        return ['AAPL', 'MSFT', 'GOOGL', ...] # placeholder
```

#### Block 3.2: API Endpoints

```
backend/api/opportunities.py (100 lignes)

Routes:
  ├─ GET /api/opportunities
  │   └─ Query params:
  │      ├─ strategy: "growth" | "dividend" | "balanced"
  │      ├─ sector: filter by sector
  │      └─ limit: number of results
  │
  ├─ GET /api/opportunities/top-10
  │   └─ Return: Top 10 by score
  │
  └─ GET /api/opportunities/{ticker}/analysis
      └─ Return: Detailed analysis of why it's an opportunity
```

#### Block 3.3: Frontend - Screener

```
frontend/pages/opportunities.tsx (400 lignes)

Layout:
  ├─ Filters (left sidebar)
  │  ├─ Strategy selector
  │  │  ├─ 🌱 Growth
  │  │  ├─ 💰 Dividend
  │  │  └─ ⚖️ Balanced
  │  │
  │  ├─ Macro filter
  │  │  └─ Shows current regime
  │  │
  │  ├─ Sector selector (multi)
  │  └─ Apply button
  │
  ├─ Results Table
  │  ├─ Columns:
  │  │  ├─ Ticker
  │  │  ├─ Score (0-100)
  │  │  ├─ Current Price
  │  │  ├─ P/E Ratio
  │  │  ├─ Dividend Yield
  │  │  ├─ Reason
  │  │  └─ Action (→ Company Page)
  │  │
  │  ├─ Row highlight (color by score)
  │  │  ├─ 80-100: 🟢 Green
  │  │  ├─ 60-80: 🟡 Yellow
  │  │  └─ 50-60: 🟠 Orange
  │  │
  │  └─ Sorting: by score, P/E, dividend, etc.
  │
  └─ Macro Context Banner
     └─ "Currently in BULLISH regime (Low rates, Low inflation)"
```

**Phase 3 Success Criteria:**
- ✅ Screener runs on 100+ stocks
- ✅ Returns ranked opportunities
- ✅ Different strategies working (growth/dividend)
- ✅ Macro regime detection working
- ✅ Frontend displays results

---

### PHASE 4: Monte Carlo Integration (Semaines 11-13)

**Objectif:** Intégrer vos modules existants (simulation.py, risk_metrics.py)

#### Block 4.1: Simulator Service

```
backend/services/simulation_service.py (200 lignes)

Import your existing modules:
  ├─ from modules.simulation import (
  │  │   gbm_simulation,
  │  │   merton_jump_diffusion,
  │  │   heston_simulation,
  │  │   garch_bootstrap_simulation
  │  │ )
  │  │
  │  └─ from modules.risk_metrics import compute_all_metrics
  │
  ├─ from modules.optimization import (
  │     efficient_frontier,
  │     sharpe_ratio
  │  )
  │
  └─ from modules.correlation import simulate_correlated_gbm

SimulationService:
  ├─ run_single_asset_simulation(ticker, model, horizon, n_sims)
  │  └─ Return: paths + metrics
  │
  ├─ run_portfolio_simulation(tickers, weights, horizon, n_sims)
  │  └─ Return: correlated paths + portfolio metrics
  │
  ├─ optimize_portfolio(tickers)
  │  └─ Return: Markowitz frontier + optimal allocation
  │
  └─ backtest_simulation(ticker, lookback, horizon, n_sims)
     └─ Return: backtest metrics
```

**Code détaillé:**
```python
# backend/services/simulation_service.py
from modules.simulation import gbm_simulation, merton_jump_diffusion
from modules.risk_metrics import compute_all_metrics
from modules.optimization import efficient_frontier, sharpe_ratio
import numpy as np

class SimulationService:
    def __init__(self, data_service):
        self.data = data_service

    async def run_simulation(self, 
                            ticker: str,
                            model: str = "GBM",
                            horizon_days: int = 252,
                            n_sims: int = 5000,
                            use_manual_params: bool = False,
                            mu: float = None,
                            sigma: float = None) -> dict:
        """Run Monte Carlo simulation"""
        
        # Get current price
        quote = await self.data.get_quote(ticker)
        S0 = quote['c']
        
        # Get historical returns if not manual params
        if not use_manual_params:
            historical = await self.data.get_historical_returns(ticker, period='1y')
            mu = np.mean(historical) * 252  # Annualize
            sigma = np.std(historical) * np.sqrt(252)
        
        # Run simulation based on model
        if model == "GBM":
            paths = gbm_simulation(
                S0=S0,
                mu=mu,
                sigma=sigma,
                horizon_days=horizon_days,
                n_sims=n_sims,
                seed=42
            )
        elif model == "Merton":
            paths = merton_jump_diffusion(
                S0=S0,
                mu=mu,
                sigma=sigma,
                horizon_days=horizon_days,
                n_sims=n_sims,
                lambda_poisson=0.5,
                jump_mean=-0.05,
                jump_std=0.1
            )
        # ... handle other models
        
        # Compute metrics
        metrics = compute_all_metrics(paths, S0)
        
        return {
            "ticker": ticker,
            "model": model,
            "S0": S0,
            "mu": mu,
            "sigma": sigma,
            "horizon_days": horizon_days,
            "n_sims": n_sims,
            "paths": paths[:100].tolist(),  # Send sample paths to frontend
            "metrics": metrics,
            "generated_at": datetime.now().isoformat()
        }

    async def run_portfolio_simulation(self,
                                       tickers: list,
                                       weights: list,
                                       horizon_days: int = 252,
                                       n_sims: int = 5000) -> dict:
        """Run correlated multi-asset simulation"""
        
        # Get data for all assets
        S0_dict = {}
        mu_dict = {}
        sigma_dict = {}
        
        for ticker in tickers:
            quote = await self.data.get_quote(ticker)
            S0_dict[ticker] = quote['c']
            
            historical = await self.data.get_historical_returns(ticker, period='1y')
            mu_dict[ticker] = np.mean(historical) * 252
            sigma_dict[ticker] = np.std(historical) * np.sqrt(252)
        
        # Calculate correlation matrix
        returns_data = await self.data.get_correlated_returns(tickers, period='1y')
        corr_matrix = np.corrcoef(returns_data)
        
        # Run correlated simulation
        paths = simulate_correlated_gbm(
            S0_dict=S0_dict,
            mu_dict=mu_dict,
            sigma_dict=sigma_dict,
            corr_matrix=corr_matrix,
            horizon_days=horizon_days,
            n_sims=n_sims
        )
        
        # Compute portfolio metrics
        portfolio_paths = np.sum(
            [paths[ticker] * weights[i] for i, ticker in enumerate(tickers)],
            axis=0
        )
        portfolio_metrics = compute_all_metrics(portfolio_paths, np.sum(list(S0_dict.values()) * weights))
        
        return {
            "tickers": tickers,
            "weights": weights,
            "correlation_matrix": corr_matrix.tolist(),
            "portfolio_metrics": portfolio_metrics,
            "individual_metrics": {
                ticker: compute_all_metrics(paths[ticker], S0_dict[ticker])
                for ticker in tickers
            }
        }

    async def optimize_portfolio(self, tickers: list) -> dict:
        """Find optimal portfolio allocation"""
        
        # Get returns data
        returns_data = await self.data.get_correlated_returns(tickers, period='1y')
        mean_returns = np.mean(returns_data, axis=1) * 252
        cov_matrix = np.cov(returns_data) * 252
        
        # Compute efficient frontier
        frontier = efficient_frontier(
            mean_returns=mean_returns,
            cov_matrix=cov_matrix,
            n_points=50
        )
        
        # Compute Sharpe optimal
        sharpe_opt = sharpe_ratio(
            mean_returns=mean_returns,
            cov_matrix=cov_matrix
        )
        
        return {
            "frontier": frontier,
            "sharpe_optimal": sharpe_opt,
            "tickers": tickers
        }
```

#### Block 4.2: API Endpoints

```
backend/api/simulation.py (150 lignes)

Routes:
  ├─ POST /api/simulate
  │   Body: {ticker, model, horizon, n_sims, mu?, sigma?}
  │   Return: paths + metrics
  │
  ├─ POST /api/simulate/portfolio
  │   Body: {tickers, weights, horizon, n_sims}
  │   Return: correlated paths + metrics
  │
  ├─ GET /api/optimize-portfolio
  │   Query: tickers (comma-separated)
  │   Return: efficient frontier + optimal weights
  │
  └─ POST /api/backtest
      Body: {ticker, lookback_days, horizon_days, n_sims}
      Return: backtest metrics
```

#### Block 4.3: Frontend - Simulator

```
frontend/pages/simulator.tsx (600 lignes)

Beginner Mode:
  ├─ Input:
  │  ├─ Ticker selector (from opportunities)
  │  ├─ Horizon buttons (1mo, 3mo, 1y, 3y)
  │  └─ Risk tolerance slider
  │
  └─ Output:
     ├─ "Expected price: $X-Y in [horizon]"
     ├─ "Risk of -20% loss: 5% probability"
     ├─ "Expected gain: +15%"
     └─ 3 trajectories (best, mid, worst case)

Advanced Mode:
  ├─ All current Streamlit features
  ├─ 4 models (GBM, Merton, Heston, GARCH)
  ├─ Manual μ/σ
  ├─ Scenarios selector
  ├─ Monte Carlo settings
  ├─ Backtesting
  ├─ Portfolio comparison
  ├─ Export results
  └─ Detailed metrics table
```

**Phase 4 Success Criteria:**
- ✅ Single asset simulation working
- ✅ Portfolio simulation working
- ✅ Efficient frontier calculating
- ✅ Backtest running
- ✅ Frontend displays all results
- ✅ Export functionality working

---

### PHASE 5: Polish & Production (Semaines 14-16)

**Objectif:** Rendre la plateforme prête pour production 24/7

#### Block 5.1: UI/UX Polish

```
Frontend:
  ├─ Responsive design (mobile, tablet, desktop)
  ├─ Dark mode toggle
  ├─ Loading states + skeletons
  ├─ Error handling + recovery
  ├─ Search autocomplete
  ├─ Watchlist persistence
  ├─ User preferences saved
  ├─ Keyboard shortcuts
  └─ Accessibility (WCAG 2.1)

Components to build:
  ├─ Global navbar
  ├─ Sidebar navigation
  ├─ Search bar with autocomplete
  ├─ Watchlist sidebar
  ├─ Loading skeletons
  ├─ Error boundaries
  ├─ Modals (export, settings)
  └─ Toast notifications
```

#### Block 5.2: Backend Optimization

```
Performance:
  ├─ Database indexing
  ├─ Query optimization
  ├─ API response compression
  ├─ Caching strategy (24h macro, 4h company)
  └─ Rate limiting

Monitoring:
  ├─ Error logging (Sentry)
  ├─ Performance metrics (APM)
  ├─ Uptime monitoring
  └─ Alert thresholds

Security:
  ├─ HTTPS/TLS
  ├─ CORS configuration
  ├─ Rate limiting per IP
  ├─ Input validation
  └─ SQL injection prevention
```

#### Block 5.3: Export & Reports

```
Features:
  ├─ Export simulations as PDF
  ├─ Export data as CSV
  ├─ Generate analysis reports
  ├─ Compare scenarios in PDF
  └─ Email report delivery (future)

Implementation:
  ├─ Use ReportLab (Python) for PDF generation
  ├─ CSV export via pandas
  └─ Template-based reports
```

#### Block 5.4: Background Jobs

```
Using APScheduler:
  ├─ Every night (2am UTC):
  │  ├─ Refresh all macro data
  │  ├─ Update company snapshots
  │  ├─ Recalibrate models
  │  └─ Update opportunity screener
  │
  ├─ Every hour:
  │  ├─ Update real-time quotes
  │  └─ Check for crisis alerts
  │
  └─ Every week:
     └─ Archive old data, optimize database
```

**Phase 5 Success Criteria:**
- ✅ Responsive on all devices
- ✅ Dark mode working
- ✅ PDF export generating
- ✅ Background jobs running
- ✅ 99% uptime
- ✅ <2s page load time

---

## Full Tech Stack Diagram

```
Frontend (Vercel)
├─ Next.js 14 (React, TypeScript)
├─ Tailwind CSS + Shadcn/ui
├─ Recharts + Lightweight Charts
├─ TanStack Query (data fetching)
├─ Zustand (state)
└─ Vercel Analytics

Backend (Railway)
├─ FastAPI (Python)
├─ SQLAlchemy (ORM)
├─ Pydantic (validation)
├─ httpx (async HTTP)
├─ APScheduler (background jobs)
├─ Your modules:
│  ├─ simulation.py
│  ├─ risk_metrics.py
│  ├─ optimization.py
│  └─ correlation.py
└─ PostgreSQL (Railway)

External APIs
├─ Fred (macro - FREE)
├─ Finnhub (company - FREE)
├─ Yahoo Finance (historical - FREE)
├─ SEC Edgar (filings - FREE)
├─ NewsAPI (news - FREE)
└─ Redis Cloud (caching - FREE tier)

Monitoring (Free/Cheap)
├─ GitHub Actions (CI/CD)
├─ Sentry (error tracking - free)
├─ DataDog (APM - free tier)
└─ Uptime monitoring
```

---

## Dependencies Map

```
Phase 0 Foundation
    ↓
    ├─→ Phase 1: Macro (depends on Phase 0)
    │       ├─→ Phase 3: Opportunities (depends on Phase 1 + 2)
    │       │
    ├─→ Phase 2: Company (depends on Phase 0)
    │
    ├─→ Phase 4: Monte Carlo (depends on Phase 0)
    │
    └─→ Phase 5: Polish (depends on all above)

Can start phases in parallel:
- Phase 1 & 2 can run in parallel
- Phase 3 needs 1 & 2 complete
- Phase 4 independent until Phase 5
- Phase 5 is final polish
```

---

## Data Flow Example: User View Stock

```
1. User types "AAPL" in search → Frontend autocomplete calls /api/company/AAPL

2. Backend receives request:
   ├─ Check PostgreSQL cache (fresh? return cached)
   ├─ If not cached or expired:
   │  ├─ Call Finnhub API (get fundamentals)
   │  ├─ Call Fred API (get macro context)
   │  ├─ Call NewsAPI (get recent news)
   │  ├─ Call YahooFinance (get current price)
   │  └─ Calculate health_score + crisis_level
   ├─ Store in PostgreSQL cache
   └─ Return to frontend

3. Frontend receives data:
   ├─ Display company header
   ├─ Show health scorecard
   ├─ Display fundamentals grid
   ├─ Show price chart (if available)
   ├─ Show recent news
   └─ Show action buttons (Analyze, Watchlist, Filings)

4. User clicks "Analyze with Monte Carlo":
   ├─ Frontend sends /api/simulate (POST)
   ├─ Backend runs simulation (Python modules)
   ├─ Returns paths + metrics
   └─ Frontend displays results

5. User exports to PDF:
   ├─ Frontend sends /api/export (POST)
   ├─ Backend generates PDF
   ├─ Returns download URL
   └─ User downloads file
```

---

## Success Metrics by Phase

| Phase | Metric | Target |
|-------|--------|--------|
| 0 | Deployment | 2 live URLs (Vercel + Railway) |
| 1 | Macro Data | 30+ indicators, <100ms response |
| 2 | Company Data | 100+ companies indexed |
| 3 | Screener | 1000+ stocks scanned, top 20 returned |
| 4 | Simulator | All 4 models working, <5s simulation |
| 5 | Production | 99% uptime, <2s load time, PDF export |

---

Voilà ! Un plan complet, détaillé, avec chaque bloc qui dépend du précédent. Voulez-vous que je détaille plus une phase spécifique ?
