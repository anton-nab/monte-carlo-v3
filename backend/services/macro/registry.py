"""
Indicator registry: catalogue de TOUS les indicateurs supportes.

QUOI: Mapping centralise (country, indicator) -> (provider, source_id, ...).
POURQUOI: Le frontend demande "GDP du Japon" avec un nom logique. Le registry
          traduit ca en "OECD provider, dataflow XYZ.JPN.QGDP, frequency Q".

Pour AJOUTER un indicateur:
    1. Ajouter une entree IndicatorSpec dans REGISTRY ci-dessous
    2. C'est tout. Le frontend l'aura disponible via /api/macro/{country}/{indicator}

Pour AJOUTER un nouveau pays:
    1. Ajouter ses indicateurs dans REGISTRY
    2. Ajouter le pays dans SUPPORTED_COUNTRIES
"""

from dataclasses import dataclass
from typing import Literal


# Codes ISO 2-lettres en lowercase (us, eu, gb, jp, cn) — convention REST
SupportedCountry = Literal["us", "eu", "gb", "jp", "cn"]
SupportedProvider = Literal["fred", "oecd"]  # Phase 1.5: + ecb, world_bank


@dataclass(frozen=True)
class IndicatorSpec:
    """Definition d'un indicateur dans le registry."""
    provider: SupportedProvider
    source_id: str
    description: str
    unit: str
    frequency: Literal["daily", "monthly", "quarterly", "annual"]
    importance: Literal["critical", "high", "medium", "low"] = "medium"


# ===========================================================================
# REGISTRY — toutes les combinaisons (country, indicator) supportees
# ===========================================================================

REGISTRY: dict[str, dict[str, IndicatorSpec]] = {

    # -----------------------------------------------------------------------
    # USA — via Fred (Federal Reserve Economic Data)
    # Source: https://fred.stlouisfed.org/
    # -----------------------------------------------------------------------
    "us": {
        "inflation": IndicatorSpec(
            provider="fred",
            source_id="CPIAUCSL",
            description="Consumer Price Index for All Urban Consumers",
            unit="index",
            frequency="monthly",
            importance="critical",
        ),
        "unemployment": IndicatorSpec(
            provider="fred",
            source_id="UNRATE",
            description="Unemployment Rate",
            unit="%",
            frequency="monthly",
            importance="critical",
        ),
        "fed_rate": IndicatorSpec(
            provider="fred",
            source_id="FEDFUNDS",
            description="Federal Funds Effective Rate",
            unit="%",
            frequency="monthly",
            importance="critical",
        ),
        "gdp": IndicatorSpec(
            provider="fred",
            source_id="A191RL1Q225SBEA",
            description="Real GDP, Percent Change from Preceding Period (Annualized)",
            unit="%",
            frequency="quarterly",
            importance="critical",
        ),
        "yield_10y": IndicatorSpec(
            provider="fred",
            source_id="DGS10",
            description="10-Year Treasury Constant Maturity Rate",
            unit="%",
            frequency="daily",
            importance="critical",
        ),
    },

    # -----------------------------------------------------------------------
    # EUROZONE — via OECD (Phase 1.5: ajouter ECB direct pour real-time)
    # Note: les SDMX paths OECD sont fragiles, a tester/ajuster apres setup.
    # Pour l'instant on declare les indicateurs, l'integration OECD finalisee
    # dans un commit ulterieur.
    # -----------------------------------------------------------------------
    "eu": {
        # TODO Phase 1.1: completer apres validation des paths OECD avec un
        # premier test live. Format SDMX OECD: voir oecd_provider.py.
        # Indicateurs cibles: inflation (HICP), unemployment, ECB rate, GDP,
        # bund_10y (allemand comme proxy zone euro).
    },

    # -----------------------------------------------------------------------
    # UK — via OECD principalement
    # -----------------------------------------------------------------------
    "gb": {
        # TODO Phase 1.1: integration OECD pour UK
    },

    # -----------------------------------------------------------------------
    # JAPAN — via OECD
    # -----------------------------------------------------------------------
    "jp": {
        # TODO Phase 1.1: integration OECD pour Japon
    },

    # -----------------------------------------------------------------------
    # CHINA — OECD a une couverture limitee, World Bank en backup (Phase 1.5)
    # -----------------------------------------------------------------------
    "cn": {
        # TODO Phase 1.5: World Bank provider pour Chine
    },
}


SUPPORTED_COUNTRIES = {
    "us": "United States",
    "eu": "Eurozone",
    "gb": "United Kingdom",
    "jp": "Japan",
    "cn": "China",
}


# ===========================================================================
# Helpers de lookup
# ===========================================================================

def get_indicator_spec(country: str, indicator: str) -> IndicatorSpec:
    """Retrouve la spec d'un indicateur par (country, indicator)."""
    country_lc = country.lower()
    indicator_lc = indicator.lower()

    if country_lc not in REGISTRY:
        raise KeyError(f"Country '{country}' non supporte. Supportes: {list(REGISTRY.keys())}")

    country_indicators = REGISTRY[country_lc]
    if indicator_lc not in country_indicators:
        available = list(country_indicators.keys()) or "(aucun pour le moment)"
        raise KeyError(
            f"Indicator '{indicator}' non disponible pour '{country}'. "
            f"Disponibles: {available}"
        )

    return country_indicators[indicator_lc]


def list_indicators(country: str | None = None) -> list[dict]:
    """
    Liste plate de tous les indicateurs disponibles.
    Filtrable par pays.
    """
    out: list[dict] = []
    countries = [country.lower()] if country else REGISTRY.keys()
    for c in countries:
        if c not in REGISTRY:
            continue
        for indicator_name, spec in REGISTRY[c].items():
            out.append({
                "country": c,
                "country_name": SUPPORTED_COUNTRIES.get(c, c),
                "indicator": indicator_name,
                "description": spec.description,
                "unit": spec.unit,
                "frequency": spec.frequency,
                "importance": spec.importance,
                "provider": spec.provider,
            })
    return out
