"""
FastAPI Backend for Monte Carlo V3
======================================

Ce fichier est le CŒUR du backend.
Tout commence ici.

Qu'est-ce que FastAPI?
- Framework Python pour créer APIs web
- Asynchrone (peut gérer 1000+ requêtes simultanées)
- Auto-documentation (Swagger UI à /docs)
- Type-safe (grâce à Python typing)

Comment ça marche:
1. User visit frontend (Vercel)
2. Frontend appelle GET /api/company/AAPL
3. FastAPI routes la requête
4. Retourne JSON response
5. Frontend affiche le résultat
"""

# Charger les variables d'environnement depuis .env avant tout autre import
# qui en depend (ex: FredProvider lit FRED_API_KEY).
# En production (Railway), les variables sont injectees directement dans
# l'environnement du conteneur — load_dotenv() ne fait rien dans ce cas.
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

# Routers
from api.home import router as home_router
from api.macro import router as macro_router
from api.instruments import router as instruments_router
from api.search import router as search_router
from api.indices import router as indices_router
from api.simulate import router as simulate_router
from api.compare import router as compare_router
from api.portfolio import router as portfolio_router
from api.ws import router as ws_router           # Phase 7: WebSocket
from api.backtest  import router as backtest_router   # Phase 9: Backtesting
from api.calendar  import router as calendar_router   # Phase 10: Calendar
from api.screener  import router as screener_router   # Phase 11: Screener

# ===========================================================================
# 1. CRÉER L'APPLICATION FASTAPI
# ===========================================================================

app = FastAPI(
    title="Monte Carlo API",
    description="IBM-Equivalent Financial Analysis Platform",
    version="0.1.0"  # Phase 1: Global Macro Layer
)

# ===========================================================================
# 2. CONFIGURER CORS (Cross-Origin Resource Sharing)
# ===========================================================================
# POURQUOI CORS?
# Quand le frontend (Vercel URL) appelle le backend (Railway URL),
# le navigateur dit "Hold on, different domain!"
# CORS dit: "OK, c'est autorisé"

# Sans CORS: Frontend appelle backend → Error 403 Forbidden
# Avec CORS: Frontend appelle backend → ✅ Works!

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",              # Development frontend (local testing)
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",  # Tous sous-domaines Vercel (preview + prod)
    allow_credentials=True,
    allow_methods=["*"],                      # Allow GET, POST, PUT, DELETE, etc.
    allow_headers=["*"],                      # Allow any header
)

# ===========================================================================
# 2.5. INCLURE LES ROUTERS (organisation modulaire des endpoints)
# ===========================================================================
# Chaque module dans api/ definit un router prefixe.
# Cela evite que main.py grossisse a chaque nouvelle phase.

app.include_router(home_router)            # /api/home/*          (Phase 5)
app.include_router(macro_router)           # /api/macro/*         (Phase 1)
app.include_router(instruments_router)     # /api/instruments/*   (Phase 2)
app.include_router(search_router)          # /api/search/*        (Phase 2)
app.include_router(indices_router)         # /api/indices/*       (Phase 2.5)
app.include_router(simulate_router)        # /api/simulate        (Phase 3)
app.include_router(compare_router)        # /api/simulate/compare (Phase 4.5)
app.include_router(portfolio_router)      # /api/portfolio/*     (Phase 4)
app.include_router(ws_router)             # /ws/quotes           (Phase 7)
app.include_router(backtest_router)       # /api/backtest        (Phase 9)
app.include_router(calendar_router)       # /api/calendar        (Phase 10)
app.include_router(screener_router)       # /api/screener        (Phase 11)

# ===========================================================================
# 3. ROUTES (Endpoints API)
# ===========================================================================

# ROUTE 1: Health Check
# =====================
# Purpose: Is the API alive?
# Who calls it: Monitoring systems, frontend status check
# Returns: Simple JSON saying "yes I'm alive"

@app.get("/health")
async def health_check():
    """
    Health check endpoint.

    Returns:
        dict: Status and version info

    Example response:
    {
        "status": "ok",
        "version": "0.0.1",
        "timestamp": "2026-05-03T10:00:00"
    }
    """
    return {
        "status": "ok",
        "version": "0.0.1",
        "timestamp": datetime.now().isoformat(),
        "message": "API is running!"
    }


# ROUTE 2: API Version
# ====================
# Purpose: What version of the API is this?
# Who calls it: Frontend for compatibility checks
# Returns: Version info

@app.get("/api/version")
async def get_version():
    """
    Get API version info.

    Returns:
        dict: Version and build info

    Why separate from /health?
    - /health: "Are you alive?" (minimal check)
    - /api/version: "What version?" (more details)
    - Good separation of concerns
    """
    return {
        "app_name": "Monte Carlo Simulator v3",
        "api_version": "0.0.1",
        "phase": "Foundation (Phase 0)",
        "status": "development",
        "build_date": "2026-05-03"
    }


# ROUTE 3: Test Echo
# ==================
# Purpose: Test if backend receives data correctly
# Who calls it: Frontend testing
# Returns: Echoes back what you sent

@app.post("/api/test")
async def test_echo(data: dict):
    """
    Echo test endpoint for debugging.

    This endpoint takes whatever data you send,
    and sends it back with a timestamp.

    Useful for: Testing frontend → backend communication

    Example request:
    POST /api/test
    {
        "message": "Hello backend!"
    }

    Example response:
    {
        "echo": {
            "message": "Hello backend!"
        },
        "received_at": "2026-05-03T10:00:00",
        "note": "Data received successfully!"
    }
    """
    return {
        "echo": data,
        "received_at": datetime.now().isoformat(),
        "note": "Data received and echoed back successfully!"
    }


# ===========================================================================
# 4. ROOT ENDPOINT (Landing Page Info)
# ===========================================================================

@app.get("/api/debug/sources")
async def debug_sources():
    """
    Diagnostic: test connectivity to each data source used by the indices service.
    SP500 → GitHub CSV | NDX/DJI → hardcoded | Prices → FMP batch quotes
    """
    import asyncio
    import httpx as _httpx
    result: dict = {}

    # ── SP500 GitHub CSV ─────────────────────────────────────────────────────
    csv_url = (
        "https://raw.githubusercontent.com/datasets/"
        "s-and-p-500-companies/main/data/constituents.csv"
    )
    try:
        with _httpx.Client(timeout=15) as c:
            r = c.get(csv_url, follow_redirects=True)
        lines = r.text.strip().splitlines()
        result["sp500_csv"] = {
            "status": r.status_code,
            "ok": r.status_code == 200,
            "rows": len(lines) - 1,  # minus header
            "header": lines[0] if lines else None,
        }
    except Exception as e:
        result["sp500_csv"] = {"ok": False, "error": str(e)}

    # ── FMP spot check ───────────────────────────────────────────────────────
    try:
        from services.fmp_provider import get_fmp_provider as _get_fmp
        fmp = _get_fmp()
        rows = await asyncio.get_event_loop().run_in_executor(
            None, fmp._sync_get,
            "https://financialmodelingprep.com/api/v3/profile/AAPL",
            {"apikey": fmp._api_key},
        )
        result["fmp"] = {
            "ok": bool(rows),
            "AAPL_name": rows[0].get("companyName") if rows else None,
        }
    except Exception as e:
        result["fmp"] = {"ok": False, "error": str(e)}

    return result


@app.get("/")
async def root():
    """
    Root endpoint - shows API info.

    When user visits: https://yourapp-backend.railway.app/
    They see this JSON instead of blank page.
    """
    return {
        "name": "Monte Carlo v3 Backend API",
        "version": "0.0.1",
        "endpoints": {
            "health": "/health",
            "api_version": "/api/version",
            "test": "/api/test (POST)",
            "documentation": "/docs (Swagger UI)",
            "redoc": "/redoc (ReDoc UI)"
        },
        "phase": "0 - Foundation",
        "status": "[OK] Running",
        "next_phase": "1 - Macro Dashboard"
    }


# ===========================================================================
# 5. STARTUP & SHUTDOWN EVENTS
# ===========================================================================
# POURQUOI?
# Sometimes you need to do things when API starts/stops
# e.g., Connect to database, close connections, log events

@app.on_event("startup")
async def startup_event():
    """Called when API starts"""
    import os
    print("[*] API Startup - Monte Carlo v3")
    print("[*] All systems operational")
    # Diagnostic: show which API keys are configured
    fred_key = os.getenv("FRED_API_KEY", "")
    td_key   = os.getenv("TWELVE_DATA_API_KEY", "")
    print(f"[*] FRED_API_KEY:        {'SET (' + fred_key[:6] + '...)' if fred_key else 'NOT SET'}")
    print(f"[*] TWELVE_DATA_API_KEY: {'SET (' + td_key[:6] + '...)' if td_key else 'NOT SET — FMP + Twelve Data only'}")
    print("[*] SP500 source : GitHub CSV (datasets/s-and-p-500-companies)")
    print("[*] NDX/DJI source: hardcoded")
    print("[*] Simulation : GBM / Merton / Heston / GARCH (POST /api/simulate)")
    print("[*] WebSocket  : /ws/quotes (Twelve Data live prices)")


@app.on_event("shutdown")
async def shutdown_event():
    """Called when API shuts down"""
    print("[*] API Shutdown")
    print("[*] All connections closed")


# ===========================================================================
# 6. IF YOU RUN THIS FILE DIRECTLY
# ===========================================================================
# python main.py → runs uvicorn server locally

if __name__ == "__main__":
    import uvicorn

    print("=" * 60)
    print("Monte Carlo Backend - Phase 0")
    print("=" * 60)
    print("[*] Starting server on http://0.0.0.0:8000")
    print("[*] Documentation at http://localhost:8000/docs")
    print("=" * 60)

    uvicorn.run(
        "main:app",      # Import string (requis pour reload=True)
        host="0.0.0.0",  # Listen on all IPs (needed for Docker/Railway)
        port=8000,       # Default port
        reload=True      # Auto-reload on code change (dev mode)
    )
