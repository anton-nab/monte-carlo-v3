"""
scenarios.py
------------
Ajustement des paramètres (mu, sigma) selon différents scénarios économiques.

Les scénarios appliquent des chocs sur les paramètres historiques pour
simuler des régimes de marché différents : haussier, baissier, stress, neutre.
"""

from __future__ import annotations


SCENARIOS = {
    "Base (historique)": {
        "mu_multiplier": 1.0,
        "mu_add": 0.0,
        "sigma_multiplier": 1.0,
        "description": "Paramètres historiques sans modification.",
    },
    "Bull (haussier)": {
        "mu_multiplier": 1.5,
        "mu_add": 0.05,
        "sigma_multiplier": 0.85,
        "description": "Drift augmenté, volatilité réduite. Marché optimiste.",
    },
    "Bear (baissier)": {
        "mu_multiplier": 0.3,
        "mu_add": -0.10,
        "sigma_multiplier": 1.25,
        "description": "Drift fortement réduit, volatilité accrue. Marché baissier.",
    },
    "Stress (crise)": {
        "mu_multiplier": 0.0,
        "mu_add": -0.25,
        "sigma_multiplier": 2.0,
        "description": "Drift très négatif, volatilité doublée. Type 2008 / Covid.",
    },
    "Volatilité extrême": {
        "mu_multiplier": 1.0,
        "mu_add": 0.0,
        "sigma_multiplier": 2.5,
        "description": "Drift inchangé mais volatilité multipliée par 2,5.",
    },
}


def apply_scenario(
    mu: float, sigma: float, scenario_name: str
) -> tuple[float, float]:
    """
    Applique un scénario aux paramètres mu et sigma.

    Parameters
    ----------
    mu, sigma : paramètres historiques annualisés.
    scenario_name : clé de SCENARIOS.

    Returns
    -------
    (mu_adjusted, sigma_adjusted)
    """
    if scenario_name not in SCENARIOS:
        return mu, sigma

    cfg = SCENARIOS[scenario_name]
    mu_adj = mu * cfg["mu_multiplier"] + cfg["mu_add"]
    sigma_adj = max(sigma * cfg["sigma_multiplier"], 0.001)  # vol > 0
    return mu_adj, sigma_adj


def scenario_description(scenario_name: str) -> str:
    """Retourne la description textuelle d'un scénario."""
    return SCENARIOS.get(scenario_name, {}).get("description", "")
