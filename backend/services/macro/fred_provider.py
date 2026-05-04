"""
Fred API provider (Federal Reserve Economic Data, US).

QUOI: Recupere les donnees economiques americaines via l'API officielle de la Fed.
POURQUOI: La source de reference pour la macro US (CPI, GDP, taux Fed, chomage, ...).
COUT: Gratuit, illimite, juste besoin d'une cle API.
DOC: https://fred.stlouisfed.org/docs/api/fred/

Requiert FRED_API_KEY dans les variables d'environnement.
"""

import os
from datetime import datetime
from typing import Optional

import httpx

from .base import (
    BaseMacroProvider,
    MacroIndicator,
    ProviderError,
    TimeSeriesPoint,
)


class FredProvider(BaseMacroProvider):
    """Provider pour Federal Reserve Economic Data (US)."""

    BASE_URL = "https://api.stlouisfed.org/fred"
    DEFAULT_LIMIT = 252  # ~1 an de donnees daily, ~21 ans monthly

    def __init__(self, api_key: Optional[str] = None):
        """
        Args:
            api_key: Cle Fred API. Si None, lit FRED_API_KEY dans l'environnement.
        """
        self.api_key = api_key or os.getenv("FRED_API_KEY")
        if not self.api_key:
            raise ValueError(
                "FRED_API_KEY manquant. Definir dans .env ou passer api_key="
            )

    @property
    def name(self) -> str:
        return "fred"

    async def fetch_indicator(
        self,
        source_id: str,
        country: str,
        indicator_name: str,
        unit: str = "",
        frequency: str = "monthly",
    ) -> MacroIndicator:
        """Recupere une serie depuis Fred et la convertit au format unifie."""
        try:
            raw = await self._fetch_observations(source_id, limit=self.DEFAULT_LIMIT)
        except httpx.HTTPError as e:
            raise ProviderError(f"Fred API error for {source_id}: {e}") from e

        series = self._parse_observations(raw)

        # Calculer current/previous/change
        current_value = series[-1].value if series else None
        previous_value = series[-2].value if len(series) >= 2 else None
        change_pct = None
        if current_value is not None and previous_value not in (None, 0):
            change_pct = ((current_value - previous_value) / previous_value) * 100

        return MacroIndicator(
            indicator=indicator_name,
            country=country,
            series=series,
            current_value=current_value,
            previous_value=previous_value,
            change_pct=change_pct,
            unit=unit,
            frequency=frequency,
            source=self.name,
            source_id=source_id,
            last_updated=datetime.utcnow().isoformat(),
        )

    # -----------------------------------------------------------------------
    # Internes
    # -----------------------------------------------------------------------

    async def _fetch_observations(self, series_id: str, limit: int) -> dict:
        """Appel HTTP brut a Fred."""
        params = {
            "series_id": series_id,
            "api_key": self.api_key,
            "file_type": "json",
            "limit": limit,
            "sort_order": "desc",  # Plus recent en premier (on reverse apres)
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{self.BASE_URL}/series/observations",
                params=params,
            )
            response.raise_for_status()
            return response.json()

    @staticmethod
    def _parse_observations(raw: dict) -> list[TimeSeriesPoint]:
        """
        Convertit la reponse Fred en list[TimeSeriesPoint].

        Format Fred:
            {
              "observations": [
                {"date": "2026-01-01", "value": "3.2"},
                {"date": "2025-12-01", "value": "3.1"},
                {"date": "2025-11-01", "value": "."},  # "." = NaN chez Fred
                ...
              ]
            }
        """
        observations = raw.get("observations", [])
        # Inverser pour ordre chronologique (plus ancien en premier)
        observations = list(reversed(observations))

        points: list[TimeSeriesPoint] = []
        for obs in observations:
            value_str = obs.get("value", "")
            # Fred met "." pour les valeurs manquantes
            if value_str in (".", "", None):
                continue
            try:
                value = float(value_str)
            except (TypeError, ValueError):
                continue

            points.append(TimeSeriesPoint(date=obs["date"], value=value))

        return points
