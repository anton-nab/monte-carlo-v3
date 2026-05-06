# Monte Carlo V3 — Project Knowledge Base

> Document vivant. Mis à jour à chaque session.
> Objectif : repartir rapidement sur de bonnes bases à chaque nouvelle session.

---

## 📍 Où on en est (mai 2026)

**Stack :** Python FastAPI (Railway) + Next.js 14 / Tailwind (Vercel)
**Phases terminées :** 0 (Foundation) → 1 (Macro) → 2 (Instruments) → 2.5 (Indices) → 2.6 (Data sources)
**Prochaine phase :** Phase 3 — Moteur Monte Carlo (simulation server-side)
**Branch de travail :** `main` (toujours merger avant de déployer)

---

## 🐛 Problèmes rencontrés & solutions

### P1 — FMP API entièrement morte (août 2025)
**Symptôme :** HTTP 403 "Legacy Endpoint" sur tous les endpoints FMP.
**Endpoints morts :** `/sp500_constituent`, `/nasdaq_constituent`, `/dowjones_constituent`, `/etf-holder/{symbol}`
**Quand :** Dépréciés le 31 août 2025 par Financial Modeling Prep.
**Solution :** Abandonner FMP pour les constituants. Remplacé par GitHub CSV (SP500) + hardcoded lists (autres indices). Pour les ETF holdings : yfinance uniquement.
**Fichiers touchés :** `services/fmp_provider.py` (conservé mais inutilisé), `api/instruments.py`, `services/indices/indices_service.py`

---

### P2 — Wikipedia bloqué (scraping + MediaWiki API)
**Symptôme :** HTTP 403 "Please respect our robot policy" sur toutes les requêtes Wikipedia.
**Contexte :** Bloqué depuis les IPs cloud/VPS (Railway, etc.). Fonctionne en local parfois.
**Ce qui a été essayé :**
1. Scraping HTML direct → 403
2. MediaWiki API (`/w/api.php?action=parse`) → 403 aussi
3. User-Agent bot → 403
**Solution :** Abandonner Wikipedia entièrement pour les indices. Remplacé par GitHub CSV (SP500) + hardcoded lists.
**Leçon :** Ne jamais compter sur Wikipedia depuis un serveur cloud.

---

### P3 — Bug secteur "Others" pour DJI et NDX
**Symptôme :** Le donut chart des secteurs affiche tout en "Other" pour DJI et NDX.
**Root cause :** Wikipedia était parfois accessible depuis le local mais retournait les données **sans colonne de secteur**. Le fallback hardcoded (avec secteurs corrects) ne se déclenchait pas car `if result` était `True` (liste non-vide).
**Code problématique :**
```python
result = await self._wiki.get_constituents(cfg["wikipedia"])
if result:          # True même si sectors sont tous vides !
    return result   # retourne 30 stocks avec sector=""
```
**Solution :** Changer `source: "wikipedia"` → `source: "hardcoded"` pour DJI et NDX. Supprimer la tentative Wikipedia pour ces indices.
**Leçon :** Valider la qualité des données (secteurs non-vides), pas seulement la quantité.

---

### P4 — DOW30 avait 31 stocks
**Symptôme :** DJI retournait 31 constituants au lieu de 30.
**Cause :** VZ (Verizon) était resté dans la liste alors qu'il a été retiré du DJIA en **février 2024** (remplacé par AMZN).
**Solution :** Supprimer VZ de `DOW30` dans `indices_registry.py`.
**Leçon :** Les listes hardcodées se périment. Ajouter la date de dernière vérification.

---

### P5 — TSX60 yf_ticker invalide
**Symptôme :** `^TSX: possibly delisted; no price data found` au démarrage.
**Cause :** `^TSX` n'existe pas sur Yahoo Finance.
**Solution :** Remplacer par `^GSPTSE` (S&P/TSX Composite Index).
**Leçon :** Toujours vérifier les yf tickers avec `yf.Ticker("^XXXXX").fast_info` avant de les ajouter.

---

### P6 — TypeScript: imports inutilisés
**Symptômes :**
- `SkeletonTable` declared but never read → erreur de build
- `useEffect` importé mais non utilisé → warning
**Solution :** Supprimer les imports morts avant de push.
**Leçon :** Lancer `npm run build` en local avant chaque push sur Vercel.

---

### P7 — `lxml` / `html5lib` non installés
**Symptôme :** `pandas.read_html` échoue avec "Import html5lib failed".
**Cause :** Manquant dans `requirements.txt`.
**Solution :** `pip install lxml html5lib` + ajout dans `requirements.txt`.
**Status :** Résolu, mais le Wikipedia provider n'est plus utilisé de toute façon.

---

### P8 — User-Agent avec espace (illegal header)
**Symptôme :** Erreur httpx "Illegal header value" sur les requêtes Wikipedia.
**Cause :** String multi-ligne Python avec concaténation créait un espace parasite dans le User-Agent.
**Solution :** User-Agent sur une seule ligne.

---

### P9 — SWR `dedupingInterval` trop court
**Contexte :** Deux appels SWR simultanés (phase 1 sans prix, phase 2 avec prix) pour le même endpoint.
**Solution :** `dedupingInterval: 60_000` (1 min) pour éviter les re-fetches inutiles, `dedupingInterval: 60_000 * 15` pour les données avec prix (cache backend 15 min).

---

### P10 — NDX liste incomplète (91 au lieu de 100)
**Symptôme :** NDX retourne 91 stocks au lieu de 100.
**Cause :** La liste hardcoded `NDX100` est incomplète (quelques stocks manquants/doublon).
**Status :** Non bloquant, liste à compléter lors d'une prochaine session.
**TODO :** Compléter NDX100 avec les 9 stocks manquants.

---

## 💡 Types d'améliorations demandées (patterns)

### Performance & Réactivité
- **Two-phase loading** : Phase 1 rapide (constituants sans prix, ~1s) + Phase 2 en background (avec prix yfinance, ~5-20s, cache 15min)
- **SWR caching** : `stale-while-revalidate` partout sur le frontend
- **Skeleton screens** : `animate-pulse` Tailwind pendant les chargements
- **Cache backend 24h** pour les constituants, 15min pour les prix

### Données live vs. hardcoded
- Demande récurrente : "peut-on récupérer ça automatiquement ?"
- Règle apprise : Pour les indices internationaux, hardcoded > API (toutes les sources libres sont bloquées ou mal formatées depuis les IPs cloud)
- Exception : SP500 → GitHub CSV (fiable, gratuit, pas de blocage)

### Sources de données ouvertes (inventaire)
| Source | Fonctionnel ? | Usage actuel |
|--------|---------------|-------------|
| yfinance | ✅ Oui | Prix, charts, fundamentals, ETF holdings |
| FRED API | ✅ Oui (key requise) | Macro indicators |
| GitHub CSV (datasets org) | ✅ Oui | SP500 constituants |
| FMP API | ❌ Mort (403 depuis août 2025) | Abandonné |
| Wikipedia HTML | ❌ Bloqué cloud | Abandonné |
| Wikipedia MediaWiki API | ❌ Bloqué cloud | Abandonné |
| iShares ETF CSV | ⚠️ Requiert cookies | Non utilisé |
| NSE India CSV | ⚠️ Anti-bot | Non utilisé |
| HKEX / ASX / TSX | ⚠️ Auth requise | Non utilisé |

---

## ✅ Ce qui fonctionne bien

### Architecture
- **Séparation backend/frontend** claire — le backend est un pur JSON API, le frontend ne fait que consommer
- **Services modulaires** — chaque provider (fred, yfinance, csv) est isolé avec sa propre logique de cache
- **Registry pattern** pour les indices — un seul fichier `indices_registry.py` à mettre à jour pour ajouter/modifier un indice
- **Two-phase loading** — l'UX perçue est excellente : page visible immédiatement, prix se chargent en fond
- **SWR** — le cache frontend évite les re-fetches répétés, très efficace pour les pages de détail

### Déploiement
- **Railway** (backend) : déploiement automatique sur push `main`, variables d'env dans le dashboard
- **Vercel** (frontend) : déploiement automatique sur push `main`, preview sur chaque branch
- **GitHub Actions** n'est pas nécessaire — Railway et Vercel écoutent directement le repo

### Design
- **Terminal theme** (dark, cyan accents, monospace numbers) — cohérent sur toutes les pages
- **Recharts** — treemap, pieChart, lineChart tous fonctionnels
- **Tailwind** — `animate-pulse` skeleton screens propres, responsive par défaut

---

## ⚠️ Ce qui ne fonctionne pas bien / Points d'attention

### Données
- **NDX100 incomplète** — 91 stocks au lieu de 100 (liste à vérifier)
- **Listes hardcodées se périment** — les indices changent trimestriellement. Penser à ajouter une date "last verified" dans les commentaires
- **Russell 2000 sans constituants** — 2000 stocks trop lourd pour un heatmap. Solution future : limiter aux 200 premiers de IWM
- **Prix yfinance lents** — un batch de 500 tickers (SP500) prend 5-20s. Bien géré par le cache 15min mais la première requête après un redémarrage est lente

### Code
- **`wikipedia_provider.py` conservé mais inutilisé** — dead code à nettoyer si on veut. Gardé au cas où Wikipedia redeviendrait accessible
- **`fmp_provider.py` conservé mais inutilisé** — même situation
- **`asyncio.get_event_loop()`** deprecated en Python 3.10+ → utiliser `asyncio.get_running_loop()` dans une prochaine refacto
- **Les commentaires dans `main.py` font référence à "Phase 0"** alors qu'on est en Phase 2.6 — à nettoyer

### Performance
- **Pas de base de données persistante** — tout est en mémoire (cache Python dict). Si Railway redémarre, tout le cache est perdu et la première requête de chaque index est lente
- **Pas de rate limiting** sur le backend — si quelqu'un appelle 100 fois `/api/indices/SP500` simultanément, yfinance va bloquer

---

## 📁 Fichiers clés à connaître

```
backend/
├── main.py                          # Entry point — CORS, routers, startup logs
├── api/
│   ├── indices.py                   # GET /api/indices/{symbol}?include_prices=
│   ├── instruments.py               # GET /api/instruments/{quote,chart,news,etf}
│   ├── search.py                    # GET /api/search?q=
│   └── macro.py                     # GET /api/macro/{indicator}
└── services/
    ├── fred_provider.py             # FRED API (macro data)
    ├── instruments/
    │   └── yfinance_provider.py     # yfinance wrapper
    └── indices/
        ├── indices_registry.py      # ← MODIFIER POUR AJOUTER/MODIFIER UN INDICE
        ├── indices_service.py       # Orchestration : constituants + prix + secteurs
        ├── csv_provider.py          # GitHub CSV fetcher (SP500)
        └── wikipedia_provider.py   # Conservé, non utilisé (bloqué)

frontend/
├── pages/
│   ├── index.tsx                    # Dashboard macro
│   ├── search.tsx                   # Recherche universelle
│   ├── instrument/[ticker].tsx      # Fiche instrument (quote, chart, news, ETF)
│   └── indices/
│       ├── index.tsx                # Liste tous les indices
│       └── [symbol].tsx             # Détail indice (heatmap / table / donut)
└── lib/fetcher.ts                   # SWR fetcher générique
```

---

## 🔧 Commandes utiles

```bash
# Lancer le backend en local
cd backend
venv\Scripts\activate          # Windows
uvicorn main:app --reload --port 8000

# Lancer le frontend en local
cd frontend
npm run dev                    # → http://localhost:3000

# Vérifier qu'un indice fonctionne sans lancer le serveur
cd backend
python -c "
import asyncio, sys; sys.path.insert(0,'.')
from dotenv import load_dotenv; load_dotenv()
from services.indices import IndicesService
async def t():
    r = await IndicesService().get_index('SP500', include_prices=False)
    print(r['constituents_count'], 'stocks,', len(r['sectors']), 'sectors')
asyncio.run(t())
"

# Vérifier les sources de données
# (quand le backend tourne)
curl http://localhost:8000/api/debug/sources

# Build TypeScript (détecter les erreurs avant push)
cd frontend && npm run build

# Merge et deploy
git checkout main && git pull
git merge phase-xxx/feature-name
git push   # → Vercel + Railway se redéploient automatiquement
```

---

## 📋 Conventions & règles établies

### Git
- Branches : `phase{N}/{feature-name}` (ex: `phase2.5/index-etf-decomposition`)
- Commits : conventionnel (`feat:`, `fix:`, `docs:`, `refactor:`)
- Toujours PR → merge → push sur `main` (jamais de push direct)
- Co-authored-by : `Claude Opus 4.7 <noreply@anthropic.com>`

### Backend
- Tous les providers ont un cache in-memory (`_cache: Dict[str, tuple]`) avec TTL
- Constituants : TTL 24h | Prix : TTL 15min
- Les services utilisent `asyncio.get_event_loop().run_in_executor(None, sync_fn)` pour les appels HTTP synchrones (httpx, yfinance)
- Tickers yfinance pour les indices mondiaux : toujours avec suffixe exchange (`.PA`, `.DE`, `.L`, `.NS`, `.T`, `.HK`, `.AX`, `.TO`, `.SA`, `.SW`, `.MC`)

### Frontend
- `fetcher.ts` pour tous les appels SWR
- Toujours deux appels SWR pour les pages lentes : fast (`include_prices=false`) + full (avec prix)
- Skeleton screens obligatoires sur toutes les données asynchrones
- Constante `API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'` dans chaque page

---

## 🗺️ Roadmap détaillée (prochaines sessions)

### Phase 3 — Monte Carlo Simulation Engine (priorité 1)
**Backend :**
- `POST /api/simulate` — paramètres : ticker, model, n_sims, horizon_days, mu_override, sigma_override
- Models : GBM, Merton (sauts), Heston (vol. stochastique), GARCH(1,1)
- Response : trajectories (échantillon), percentiles (5/25/50/75/95), VaR 95%/99%, Expected Shortfall, max drawdown, P(loss)
- Calibration automatique µ et σ sur données historiques yfinance

**Frontend :**
- Page `/simulate` : sélection ticker (via search) → paramètres modèle → résultats
- Fan chart (recharts AreaChart avec percentile bands)
- Distribution finale (histogram)
- Tableau métriques : VaR, ES, drawdown, P(loss)
- Comparaison de modèles (GBM vs Merton vs...)

### Phase 4 — Portfolio (priorité 2)
- Multi-actifs : liste de tickers + poids
- Corrélation (matrice + Cholesky)
- Frontière efficiente Markowitz
- Portefeuille Sharpe optimal

### Phase 5 — Backtesting (priorité 3)
- Rolling-window sur données historiques
- Coverage empirique VaR
- Diagnostic de calibration

### Phase 6 — Users (priorité 4)
- Watchlists sauvegardées
- Auth (Clerk ou NextAuth)
- PostgreSQL persistence (Railway)

### Améliorations techniques transverses
- Remplacer `asyncio.get_event_loop()` par `asyncio.get_running_loop()` (Python 3.10+)
- Compléter `NDX100` à 100 stocks (9 manquants)
- Ajouter Redis pour le cache (si Railway redémarre souvent)
- Rate limiting sur les endpoints lourds (`/api/indices/{symbol}`)
- Vérifier/mettre à jour les listes hardcodées trimestriellement

---

## 📅 Historique des sessions

### Session — mai 2026
**Problèmes résolus :**
- FMP mort → GitHub CSV pour SP500
- Wikipedia bloqué → hardcoded lists
- Secteurs "Other" (DJI/NDX) → source: hardcoded direct
- DOW30 31 stocks → retiré VZ
- TSX ticker → ^GSPTSE
- 8 nouveaux indices ajoutés (SMI, IBEX35, NIFTY50, NIKKEI225, HSI, ASX200, TSX60, BOVESPA)
- SWR two-phase loading + skeleton screens (Phase 2.6)
- README réécrit depuis zéro

**Améliorations demandées :**
- Site plus réactif / moins de temps de chargement → two-phase loading + SWR
- Indices hardcodés → sources live quand possible
- Tous les indices visibles → 16 indices opérationnels
- Roadmap à jour → README + PROJECT_KNOWLEDGE.md
