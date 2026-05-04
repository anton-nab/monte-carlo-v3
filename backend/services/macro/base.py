"""
Base provider class for macro data sources.

QUOI: Classe abstraite que TOUS les providers (Fred, OECD, ECB...) doivent implementer.
POURQUOI: Garantit que tous les providers ont la meme interface, donc l'orchestrateur
          (MacroService) peut les utiliser de maniere interchangeable.

C'est le pattern "Strategy" en programmation OO.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# ===========================================================================
# DATA MODELS (format unifie cote sortie)
# ===========================================================================

class TimeSeriesPoint(BaseModel):
    """Un point dans une serie temporelle."""
    date: str  # ISO format YYYY-MM-DD
    value: float

    class Config:
        json_schema_extra = {
            "example": {"date": "2026-01-15", "value": 3.2}
        }


class MacroIndicator(BaseModel):
    """
    Format unifie pour un indicateur macro.
    Peu importe la source (Fred, OECD, ECB), tout passe par cette structure.
    """
    # Identification
    indicator: str = Field(..., description="Nom logique: 'inflation', 'unemployment', etc.")
    country: str = Field(..., description="Code ISO: 'us', 'eu', 'jp', etc.")

    # Donnees
    series: list[TimeSeriesPoint] = Field(default_factory=list)
    current_value: Optional[float] = None
    previous_value: Optional[float] = None
    change_pct: Optional[float] = Field(None, description="% change vs derniere observation")

    # Metadonnees
    unit: str = Field("", description="'%', 'index', 'USD', etc.")
    frequency: str = Field("", description="'daily', 'monthly', 'quarterly', 'annual'")
    source: str = Field("", description="'fred', 'oecd', 'ecb', 'world_bank'")
    source_id: str = Field("", description="ID natif chez la source (ex: 'CPIAUCSL' pour Fred)")
    last_updated: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

    class Config:
        json_schema_extra = {
            "example": {
                "indicator": "inflation",
                "country": "us",
                "series": [
                    {"date": "2025-12-01", "value": 3.1},
                    {"date": "2026-01-01", "value": 3.2}
                ],
                "current_value": 3.2,
                "previous_value": 3.1,
                "change_pct": 3.23,
                "unit": "%",
                "frequency": "monthly",
                "source": "fred",
                "source_id": "CPIAUCSL"
            }
        }


# ===========================================================================
# PROVIDER ABSTRACT CLASS
# ===========================================================================

class BaseMacroProvider(ABC):
    """
    Interface que tous les providers macro doivent implementer.

    Pour ajouter un nouveau provider (ex: ECB, BoJ):
    1. Heriter de BaseMacroProvider
    2. Implementer fetch_indicator()
    3. Enregistrer le provider dans services/macro/registry.py
    4. Ajouter les indicateurs supportes dans le registry

    C'est tout — le frontend n'a pas a etre touche.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Nom court du provider: 'fred', 'oecd', 'ecb', etc."""
        ...

    @abstractmethod
    async def fetch_indicator(
        self,
        source_id: str,
        country: str,
        indicator_name: str,
        unit: str = "",
        frequency: str = "monthly",
    ) -> MacroIndicator:
        """
        Recupere un indicateur depuis la source externe.

        Args:
            source_id: ID natif chez la source (ex: 'CPIAUCSL' pour Fred CPI)
            country: Code pays ISO ('us', 'eu', 'jp', ...)
            indicator_name: Nom logique ('inflation', 'unemployment', ...)
            unit: Unite de mesure ('%', 'index', 'USD', ...)
            frequency: 'daily' | 'monthly' | 'quarterly' | 'annual'

        Returns:
            MacroIndicator avec series + current_value + change_pct calcules

        Raises:
            ProviderError: Si la source est down ou retourne une erreur
            ValueError: Si l'ID n'existe pas chez ce provider
        """
        ...


# ===========================================================================
# EXCEPTIONS
# ===========================================================================

class ProviderError(Exception):
    """Erreur generique d'un provider (timeout, 5xx, parsing, ...)."""
    pass


class IndicatorNotFoundError(ValueError):
    """L'indicateur demande n'est pas dans le registry."""
    pass
