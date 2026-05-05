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
from api.macro import router as macro_router
from api.instruments import router as instruments_router
from api.search import router as search_router

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

app.include_router(macro_router)           # /api/macro/*         (Phase 1)
app.include_router(instruments_router)     # /api/instruments/*   (Phase 2)
app.include_router(search_router)          # /api/search/*        (Phase 2)

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
        "status": "🟢 Running",
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
    print("🚀 API Startup - Monte Carlo v3")
    print("📡 All systems operational")


@app.on_event("shutdown")
async def shutdown_event():
    """Called when API shuts down"""
    print("🛑 API Shutdown")
    print("All connections closed")


# ===========================================================================
# 6. IF YOU RUN THIS FILE DIRECTLY
# ===========================================================================
# python main.py → runs uvicorn server locally

if __name__ == "__main__":
    import uvicorn

    print("=" * 60)
    print("Monte Carlo Backend - Phase 0")
    print("=" * 60)
    print("🚀 Starting server on http://0.0.0.0:8000")
    print("📖 Documentation at http://localhost:8000/docs")
    print("=" * 60)

    uvicorn.run(
        "main:app",      # Import string (requis pour reload=True)
        host="0.0.0.0",  # Listen on all IPs (needed for Docker/Railway)
        port=8000,       # Default port
        reload=True      # Auto-reload on code change (dev mode)
    )
