"""
Macro data API routes.

QUOI: Endpoints HTTP exposant les donnees macro au frontend.
POURQUOI: Couche fine qui delegue toute la logique a MacroService.
          Les routes ne font que: parsing requete -> appel service -> serialisation.

Endpoints (Phase 1):
    GET /api/macro/health              -> Status providers
    GET /api/macro/indicators          -> Liste tous les indicateurs disponibles
    GET /api/macro/indicators?country=us -> Filtrer par pays
    GET /api/macro/{country}/{indicator} -> Donnees d'un indicateur specifique
"""

from fastapi import APIRouter, HTTPException, Query

from services.macro.base import IndicatorNotFoundError, MacroIndicator, ProviderError
from services.macro.registry import SUPPORTED_COUNTRIES
from services.macro.service import get_macro_service

router = APIRouter(prefix="/api/macro", tags=["Macro"])


@router.get("/health")
async def macro_health() -> dict:
    """
    Status de tous les providers macro.
    Utile pour debug ("Pourquoi je n'ai pas les donnees EU? Ah, ECB pas configure").
    """
    service = get_macro_service()
    return {
        "status": "ok",
        "providers_active": service.configured_providers,
        "supported_countries": SUPPORTED_COUNTRIES,
    }


@router.get("/indicators")
async def list_indicators(
    country: str | None = Query(None, description="Filtrer par pays (us, eu, gb, jp, cn)"),
) -> dict:
    """
    Liste tous les indicateurs disponibles dans le registry.

    Exemple:
        GET /api/macro/indicators           -> tous (US + EU + UK + JP + CN)
        GET /api/macro/indicators?country=us -> uniquement US
    """
    service = get_macro_service()
    indicators = service.list_available(country=country)
    return {
        "total": len(indicators),
        "indicators": indicators,
    }


@router.get("/{country}/{indicator}", response_model=MacroIndicator)
async def get_indicator(country: str, indicator: str) -> MacroIndicator:
    """
    Recupere les donnees d'un indicateur pour un pays donne.

    Exemple:
        GET /api/macro/us/inflation
        GET /api/macro/us/fed_rate
        GET /api/macro/us/yield_10y

    Args:
        country: Code pays (us, eu, gb, jp, cn)
        indicator: Nom logique (inflation, unemployment, gdp, ...)

    Returns:
        MacroIndicator avec series temporelle + current/previous + change_pct
    """
    service = get_macro_service()
    try:
        return await service.get_indicator(country=country, indicator=indicator)
    except IndicatorNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ProviderError as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {e}") from e
    except Exception as e:
        # Filet de securite pour ne pas exposer le stacktrace au client
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}") from e
