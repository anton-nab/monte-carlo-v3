"""
explanations.py
---------------
Explications en langage naturel des métriques de risque.

Objective : transformer un outil quantitatif en outil accessible aux non-techniciens.
"""

METRIC_EXPLANATIONS = {
    "expected_price": (
        "Prix moyen attendu après l'horizon. C'est la **moyenne** de toutes les "
        "simulations, qui intègre aussi bien les scénarios optimistes que pessimistes."
    ),
    "median_price": (
        "Prix médian (P50) : 50% des scénarios simulés donnent un prix plus haut, "
        "50% plus bas. Souvent plus représentatif que la moyenne en cas de distribution asymétrique."
    ),
    "var_95": (
        "VaR (Value at Risk) 95% : la perte maximale attendue dans 95% des cas. "
        "En d'autres termes, il y a 5 chances sur 100 de perdre **plus** que cette VaR. ⚠️"
    ),
    "es_95": (
        "Expected Shortfall (CVaR) : en cas de dépassement de la VaR, la perte "
        "moyenne dans les 5% pires scénarios. Capture le risque extrême."
    ),
    "prob_loss": (
        "Probabilité de perte : pourcentage de scénarios où le prix final < prix initial. "
        "Plus proche de 0% = meilleure perspective de gain."
    ),
    "prob_gain_10pct": (
        "Probabilité de gain > 10% : pourcentage de scénarios avec un rendement > +10%. "
        "Mesure le potentiel haussier."
    ),
    "prob_loss_10pct": (
        "Probabilité de perte > 10% : pourcentage de scénarios avec une perte > -10%. "
        "Mesure le risque de correction sévère."
    ),
    "avg_max_drawdown": (
        "Drawdown moyen : baisse moyenne observée pic-creux sur les trajectoires. "
        "Mesure la volatilité intra-horizon."
    ),
    "worst_drawdown": (
        "Pire drawdown : la plus forte baisse pic-creux observée dans toutes les simulations. "
        "Scénario de stress extrême."
    ),
    "expected_return": (
        "Rendement moyen attendu : (Prix final moyen - Prix initial) / Prix initial. "
        "Utile pour comparer plusieurs actifs sur un horizon identique."
    ),
    "return_std": (
        "Volatilité du rendement : écart-type des rendements finaux. "
        "Plus élevé = plus d'incertitude autour du rendement moyen."
    ),
}

MODEL_EXPLANATIONS = {
    "GBM": (
        "**Geometric Brownian Motion (GBM)** : le modèle classique de finance. "
        "Hypothèses : rendements log-normaux, volatilité constante. "
        "✅ Simple et rapide. ❌ Sous-estime les queues (événements extrêmes)."
    ),
    "Merton": (
        "**Merton Jump-Diffusion** : GBM + sauts aléatoires (comme des crashs). "
        "Modélise les événements extrêmes non-gaussiens (émeutes, faillites). "
        "✅ Capture les queues épaisses. ❌ Plus complexe."
    ),
    "Heston": (
        "**Heston (Volatilité Stochastique)** : la volatilité elle-même fluctue "
        "(clustering), et elle tend à rebondir vers une moyenne long-terme. "
        "✅ Réaliste (smile de volatilité). ❌ Lent, calibrage complexe."
    ),
    "GARCH": (
        "**GARCH Bootstrap** : réutilise les résidus réels passés pour générer "
        "futures trajectoires. Capture le volatility clustering sans assomption d'optimalité. "
        "✅ Très empirique. ❌ Limité à l'historique."
    ),
}

SCENARIO_EXPLANATIONS = {
    "Base (historique)": (
        "Utilise les paramètres (μ, σ) estimés sur l'historique. "
        "Hypothèse : le passé est un bon guide du futur."
    ),
    "Haussier": (
        "Augmente le drift (rendement attendu) de +2% annualisé. "
        "Hypothèse : le marché surperforme ses tendances historiques."
    ),
    "Baissier": (
        "Réduit le drift de -2% annualisé. "
        "Hypothèse : correction ou ralentissement économique."
    ),
    "Volatilité extrême": (
        "Augmente la volatilité de +50%. "
        "Hypothèse : crise, incertitude macroéconomique."
    ),
    "Calme": (
        "Réduit la volatilité de -30%. "
        "Hypothèse : normalisation, réduction d'incertitude."
    ),
}

RISK_MEASURE_SUMMARY = {
    "VaR": "Perte max (proba 95%). ⚠️ Ne dit pas **combien** on perd si on dépasse.",
    "ES": "Perte **moyenne** si on dépasse VaR. Plus prudent que VaR seule.",
    "Drawdown": "Creux dans le parcours. Important pour la psychologie (perte non réalisée).",
    "Probability": "Fréquence d'un événement. Utile pour la comparaison actifs.",
}


def explain_metric(metric_name: str) -> str:
    """Retourne l'explication d'une métrique en français."""
    return METRIC_EXPLANATIONS.get(metric_name, "Pas d'explication disponible.")


def explain_model(model_name: str) -> str:
    """Retourne l'explication d'un modèle en français."""
    return MODEL_EXPLANATIONS.get(model_name, "Pas d'explication disponible.")


def explain_scenario(scenario_name: str) -> str:
    """Retourne l'explication d'un scénario en français."""
    return SCENARIO_EXPLANATIONS.get(scenario_name, "Pas d'explication disponible.")


def interpretation_summary(metrics: dict, S0: float) -> str:
    """
    Génère un résumé **non-technique** des résultats.
    """
    var_95 = metrics.get("var_95", 0)
    es_95 = metrics.get("es_95", 0)
    prob_loss = metrics.get("prob_loss", 0)
    expected_return = metrics.get("expected_return", 0)
    median_price = metrics.get("median_price", S0)

    summary = f"""
### 📊 Interprétation pour non-techniciens

**Rendement attendu** : {expected_return * 100:+.1f}%
  → Gain/perte moyen anticipé sur l'horizon.

**Scénario médian** : {median_price:.2f} (prix actuel : {S0:.2f})
  → 50% chance d'être **au-dessus**, 50% au-dessous.

**Perte maximale acceptée (VaR 95%)** : {var_95 * 100:.1f}%
  → ⚠️ Il y a 5% de chance de perdre **plus** que ça.

**Perte moyenne en cas de crise (ES 95%)** : {es_95 * 100:.1f}%
  → Si le pire arrive, la perte moyenne observée.

**Probabilité de perte** : {prob_loss * 100:.1f}%
  → Chance que l'investissement soit dans le rouge à terme.

---

**Conseil rapide** :
- Si **VaR 95% > -10%** et **P(perte) < 20%** : profil relativement prudent.
- Si **VaR 95% < -20%** et **P(perte) > 40%** : profil agressif, concentration du risque.
"""
    return summary.strip()


def backtesting_summary(backtest_metrics: dict) -> str:
    """Résumé non-technique des résultats de backtesting."""
    coverage = backtest_metrics.get("coverage_95_empirical", 0)
    miscal = backtest_metrics.get("miscalibration_error", 0)
    is_calibrated = backtest_metrics.get("is_well_calibrated", False)

    status = "✅ Bien calibré" if is_calibrated else "⚠️ À affiner"

    summary = f"""
### 🔍 Qualité du modèle (Backtesting)

**Couverture empirique VaR 95%** : {coverage * 100:.1f}%
  → Idéal = 5%. {coverage * 100:.1f}% signifie que le modèle dépassait VaR dans {coverage * 100:.1f}% des cas.

**Erreur de calibration** : {miscal * 100:.2f}%
  → Écart entre 5% (théorique) et la réalité. Proche de 0% = mieux.

**Diagnostic** : {status}
  → Le modèle **sous-estime** ou **surestime** systématiquement le risque ?

---

**Nombre de fenêtres testées** : {backtest_metrics.get('n_windows', 'N/A')}
  → Plus il y a de fenêtres, plus fiable le diagnostic.
"""
    return summary.strip()
