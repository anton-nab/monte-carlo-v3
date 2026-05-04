"""
MacroService — Orchestrateur de tous les providers macro.

QUOI: Point d'entree UNIQUE pour tout ce qui touche aux donnees macro.
POURQUOI: Le code des routes (api/macro.py) ne doit pas savoir quel provider
          est utilise. Il appelle MacroService.get_indicator(...) et c'est tout.

Resolution dynamique:
    1. L'API recoit une requete: GET /api/macro/us/inflation
    2. La route appelle service.get_indicator(country='us', indicator='inflation')
    3. MacroService consulte le registry → trouve provider='fred', source_id='CPIAUCSL'
    4. MacroService appelle FredProvider.fetch_indicator(...)
    5. Retourne le MacroIndicator au format unifie
"""

import os
from typing import Optional

from .base import BaseMacroProvider, IndicatorNotFoundError, MacroIndicator
from .fred_provider import FredProvider
from .oecd_provider import OECDProvider
from .registry import get_indicator_spec, list_indicators


class MacroService:
    """Facade unifiee pour les donnees macroeconomiques globales."""

    def __init__(
        self,
        fred_provider: Optional[FredProvider] = None,
        oecd_provider: Optional[OECDProvider] = None,
    ):
        """
        Args:
            fred_provider: Instance FredProvider (auto-cree si None et FRED_API_KEY present)
            oecd_provider: Instance OECDProvider (auto-cree si None — pas de cle requise)
        """
        # Lazy-init de Fred (peut echouer si FRED_API_KEY pas defini)
        if fred_provider is None:
            try:
                fred_provider = FredProvider()
            except ValueError:
                # FRED_API_KEY manquant — Fred sera indisponible mais le service fonctionne
                # avec les autres providers. On loggera un avertissement.
                fred_provider = None

        if oecd_provider is None:
            oecd_provider = OECDProvider()

        self._providers: dict[str, BaseMacroProvider] = {}
        if fred_provider is not None:
            self._providers["fred"] = fred_provider
        self._providers["oecd"] = oecd_provider

    # -----------------------------------------------------------------------
    # API publique
    # -----------------------------------------------------------------------

    async def get_indicator(self, country: str, indicator: str) -> MacroIndicator:
        """
        Recupere un indicateur par (country, indicator).

        Args:
            country: 'us', 'eu', 'gb', 'jp', 'cn'
            indicator: 'inflation', 'unemployment', 'gdp', etc.

        Returns:
            MacroIndicator au format unifie

        Raises:
            IndicatorNotFoundError: Si la combinaison n'existe pas dans le registry
            ProviderError: Si le provider externe est down
        """
        try:
            spec = get_indicator_spec(country, indicator)
        except KeyError as e:
            raise IndicatorNotFoundError(str(e)) from e

        provider = self._providers.get(spec.provider)
        if provider is None:
            raise IndicatorNotFoundError(
                f"Provider '{spec.provider}' non configure (cle API manquante?)"
            )

        return await provider.fetch_indicator(
            source_id=spec.source_id,
            country=country.lower(),
            indicator_name=indicator.lower(),
            unit=spec.unit,
            frequency=spec.frequency,
        )

    def list_available(self, country: Optional[str] = None) -> list[dict]:
        """Liste tous les indicateurs disponibles (filtrable par pays)."""
        return list_indicators(country)

    @property
    def configured_providers(self) -> list[str]:
        """Noms des providers actifs (utile pour /api/macro/health)."""
        return list(self._providers.keys())


# ===========================================================================
# Singleton (cree une fois, reutilise partout)
# ===========================================================================

_default_service: Optional[MacroService] = None


def get_macro_service() -> MacroService:
    """
    Retourne l'instance partagee de MacroService.
    Pattern singleton pour eviter de recreer les providers (et leurs clients HTTP)
    a chaque requete.
    """
    global _default_service
    if _default_service is None:
        _default_service = MacroService()
    return _default_service
