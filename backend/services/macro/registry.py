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
    # EUROZONE
    # IDs Fred re-distribuant donnees ECB/Eurostat (plus simple que SDMX direct).
    # Phase 1.5: brancher ECB Statistical Data Warehouse pour donnees natives plus fraiches.
    # -----------------------------------------------------------------------
    "eu": {
        "inflation": IndicatorSpec(
            provider="fred",
            source_id="CP0000EZ19M086NEST",
            description="Eurozone Harmonised Index of Consumer Prices (HICP)",
            unit="index",
            frequency="monthly",
            importance="critical",
        ),
        "unemployment": IndicatorSpec(
            provider="fred",
            source_id="LRHUTTTTEZM156S",
            description="Eurozone Harmonized Unemployment Rate",
            unit="%",
            frequency="monthly",
            importance="critical",
        ),
        "ecb_rate": IndicatorSpec(
            provider="fred",
            source_id="ECBDFR",
            description="ECB Deposit Facility Rate",
            unit="%",
            frequency="daily",
            importance="critical",
        ),
        "gdp": IndicatorSpec(
            provider="fred",
            source_id="CLVMEURSCAB1GQEA19",
            description="Eurozone Real GDP (chained linked volumes)",
            unit="EUR M",
            frequency="quarterly",
            importance="critical",
        ),
        "bund_10y": IndicatorSpec(
            provider="fred",
            source_id="IRLTLT01DEM156N",
            description="Germany 10-Year Government Bond Yield (Eurozone proxy)",
            unit="%",
            frequency="monthly",
            importance="critical",
        ),
    },

    # -----------------------------------------------------------------------
    # UK — IDs Fred re-distribuant donnees ONS/OECD/BoE
    # Phase 1.5: brancher BoE direct pour Bank Rate (Fred lag ~8 ans)
    # -----------------------------------------------------------------------
    "gb": {
        "inflation": IndicatorSpec(
            provider="fred",
            source_id="GBRCPIALLMINMEI",
            description="UK Consumer Price Index (all items)",
            unit="index",
            frequency="monthly",
            importance="critical",
        ),
        "unemployment": IndicatorSpec(
            provider="fred",
            source_id="LRUNTTTTGBQ156S",
            description="UK Unemployment Rate (quarterly, OECD harmonised)",
            unit="%",
            frequency="quarterly",
            importance="critical",
        ),
        "gdp": IndicatorSpec(
            provider="fred",
            source_id="NGDPRSAXDCGBQ",
            description="UK Real GDP (seasonally adjusted, chained linked)",
            unit="GBP M",
            frequency="quarterly",
            importance="critical",
        ),
        "gilt_10y": IndicatorSpec(
            provider="fred",
            source_id="IRLTLT01GBM156N",
            description="UK 10-Year Gilt Yield",
            unit="%",
            frequency="monthly",
            importance="critical",
        ),
        # TODO Phase 1.5: boe_rate via BoE direct API (Fred series lag depuis 2017)
    },

    # -----------------------------------------------------------------------
    # JAPAN — IDs Fred re-distribuant donnees BoJ/Cabinet Office
    # Phase 1.5: brancher BoJ direct pour Policy Rate et JGB (Fred lag)
    # -----------------------------------------------------------------------
    "jp": {
        "inflation": IndicatorSpec(
            provider="fred",
            source_id="JPNCPIALLMINMEI",
            description="Japan CPI (all items) — note: stale data, last update mid-2021",
            unit="index",
            frequency="monthly",
            importance="high",  # high not critical because stale
        ),
        "unemployment": IndicatorSpec(
            provider="fred",
            source_id="LRHUTTTTJPM156S",
            description="Japan Harmonized Unemployment Rate",
            unit="%",
            frequency="monthly",
            importance="critical",
        ),
        "gdp": IndicatorSpec(
            provider="fred",
            source_id="NGDPRSAXDCJPQ",
            description="Japan Real GDP (seasonally adjusted)",
            unit="JPY M",
            frequency="quarterly",
            importance="critical",
        ),
        # TODO Phase 1.5: boj_rate, jgb_10y via BoJ direct API (Fred series lag depuis 2017)
    },

    # -----------------------------------------------------------------------
    # CHINA — couverture Fred limitee, integration sera via World Bank (annuel)
    # ou Trading Economics (paid) en Phase 1.5.
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
