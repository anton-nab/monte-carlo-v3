"""
OECD SDMX-JSON provider (38 pays developpes).

QUOI: Recupere les donnees economiques de l'OCDE (OCDE = 38 pays developpes:
      US, EU, UK, JP, AU, CA, KR, ...).
POURQUOI: Source officielle pour comparaisons internationales. Couvre les
          indicateurs principaux (CPI, unemployment, GDP, taux centraux).
COUT: Gratuit, pas besoin de cle API.
DOC: https://data.oecd.org/api/sdmx-json-documentation/

L'API OECD utilise le standard SDMX-JSON, plus complexe que Fred mais plus
puissant (gestion native multi-dimensions).
"""

from datetime import datetime
from typing import Optional

import httpx

from .base import (
    BaseMacroProvider,
    MacroIndicator,
    ProviderError,
    TimeSeriesPoint,
)


class OECDProvider(BaseMacroProvider):
    """Provider pour OECD Statistics (donnees globales developpees)."""

    BASE_URL = "https://sdmx.oecd.org/public/rest/data"

    @property
    def name(self) -> str:
        return "oecd"

    async def fetch_indicator(
        self,
        source_id: str,
        country: str,
        indicator_name: str,
        unit: str = "",
        frequency: str = "monthly",
    ) -> MacroIndicator:
        """
        Recupere une serie depuis OECD.

        IMPORTANT: source_id pour OECD est un chemin SDMX complet.
        Format: 'DATAFLOW_ID/KEY?dimensionAtObservation=AllDimensions'
        Exemple pour CPI France: 'OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/FRA....M'

        Le registry centralise ces chemins complexes.
        """
        try:
            raw = await self._fetch_sdmx(source_id)
        except httpx.HTTPError as e:
            raise ProviderError(f"OECD API error for {source_id}: {e}") from e

        series = self._parse_sdmx(raw)

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

    async def _fetch_sdmx(self, sdmx_path: str) -> dict:
        """Appel HTTP a OECD avec format SDMX-JSON."""
        url = f"{self.BASE_URL}/{sdmx_path}"
        headers = {"Accept": "application/vnd.sdmx.data+json;version=1.0.0"}

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.json()

    @staticmethod
    def _parse_sdmx(raw: dict) -> list[TimeSeriesPoint]:
        """
        Parse la reponse SDMX-JSON d'OECD.

        Le format SDMX est complexe — voici la structure simplifiee:
            {
              "data": {
                "dataSets": [{
                  "observations": {
                    "0:0:0:0:0": [3.2],   # Cle indexant les dimensions
                    "0:0:0:0:1": [3.1],
                    ...
                  }
                }],
                "structure": {
                  "dimensions": {
                    "observation": [{
                      "id": "TIME_PERIOD",
                      "values": [{"id": "2026-01"}, {"id": "2026-02"}, ...]
                    }]
                  }
                }
              }
            }

        On extrait les paires (date, valeur) en correlant les cles d'observation
        avec la dimension TIME_PERIOD.
        """
        try:
            datasets = raw["data"]["dataSets"]
            if not datasets:
                return []

            observations = datasets[0].get("observations", {})

            # Trouver la dimension TIME_PERIOD pour mapper les cles aux dates
            obs_dimensions = raw["data"]["structure"]["dimensions"]["observation"]
            time_dim_index = None
            time_values: list[str] = []
            for idx, dim in enumerate(obs_dimensions):
                if dim["id"] == "TIME_PERIOD":
                    time_dim_index = idx
                    time_values = [v["id"] for v in dim["values"]]
                    break

            if time_dim_index is None:
                return []

            points: list[TimeSeriesPoint] = []
            for key, value_list in observations.items():
                # key est de la forme "0:0:1:5" — on prend l'indice de TIME_PERIOD
                indices = key.split(":")
                if len(indices) <= time_dim_index:
                    continue
                try:
                    time_idx = int(indices[time_dim_index])
                    date_str = time_values[time_idx]
                except (ValueError, IndexError):
                    continue

                # Premiere valeur du tableau = la valeur observee
                if not value_list or value_list[0] is None:
                    continue
                try:
                    value = float(value_list[0])
                except (TypeError, ValueError):
                    continue

                # Normaliser la date au format YYYY-MM-DD
                normalized_date = OECDProvider._normalize_date(date_str)
                points.append(TimeSeriesPoint(date=normalized_date, value=value))

            # Trier chronologiquement
            points.sort(key=lambda p: p.date)
            return points

        except (KeyError, TypeError):
            return []

    @staticmethod
    def _normalize_date(date_str: str) -> str:
        """
        OECD retourne des dates dans differents formats:
            "2026"        (annuel)
            "2026-Q1"     (trimestriel)
            "2026-01"     (mensuel)
            "2026-01-15"  (journalier — rare)

        On normalise tout au format YYYY-MM-DD pour cohérence frontend.
        """
        if "Q" in date_str:
            # Quarter -> premier mois du trimestre
            year, quarter = date_str.split("-Q")
            month = (int(quarter) - 1) * 3 + 1
            return f"{year}-{month:02d}-01"
        if len(date_str) == 4:
            # Annual -> 1er janvier
            return f"{date_str}-01-01"
        if len(date_str) == 7:
            # Monthly YYYY-MM -> add day
            return f"{date_str}-01"
        return date_str
