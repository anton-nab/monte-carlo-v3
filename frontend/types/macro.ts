/**
 * Types miroir des modeles Pydantic du backend (services/macro/base.py).
 *
 * Si tu modifies un modele cote backend, METS A JOUR ce fichier aussi.
 * (Phase 5+: on automatisera ce sync via openapi-typescript)
 */

export interface TimeSeriesPoint {
  date: string;   // ISO YYYY-MM-DD
  value: number;
}

export interface MacroIndicator {
  // Identification
  indicator: string;
  country: string;

  // Donnees
  series: TimeSeriesPoint[];
  current_value: number | null;
  previous_value: number | null;
  change_pct: number | null;

  // Metadonnees
  unit: string;
  frequency: 'daily' | 'monthly' | 'quarterly' | 'annual' | string;
  source: string;
  source_id: string;
  last_updated: string;
}

export interface IndicatorListItem {
  country: string;
  country_name: string;
  indicator: string;
  description: string;
  unit: string;
  frequency: string;
  importance: 'critical' | 'high' | 'medium' | 'low';
  provider: string;
}

export interface IndicatorsResponse {
  total: number;
  indicators: IndicatorListItem[];
}

export interface MacroHealthResponse {
  status: string;
  providers_active: string[];
  supported_countries: Record<string, string>;
}
