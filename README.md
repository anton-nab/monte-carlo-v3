# 📈 Monte Carlo Simulator v2 – Avancé

Simulation probabiliste des marchés avec **4 modèles stochastiques**, **backtesting**, **optimisation de portefeuille Markowitz** et **explications en langage naturel**.

## 🎯 Objectifs

- **Modélisation réaliste** : GBM + Merton (sauts) + Heston (vol. stochastique) + GARCH (clustering)
- **Validation scientifique** : backtesting sur fenêtres passées
- **Optimisation** : frontière efficiente interactive
- **Accessibilité** : explications pour non-techniciens

## 🚀 Lancement

```bash
pip install -r requirements.txt
streamlit run app.py
```

## 🧬 Modèles implémentés

| Modèle | Équation | Cas d'usage | Pros/Cons |
|--------|----------|-----------|-----------|
| **GBM** | dS = μS dt + σS dW | Baseline classique | ✅ Rapide ❌ Sous-estime queues |
| **Merton** | GBM + J·N (sauts Poisson) | Crashs/crises | ✅ Fat tails ❌ Lent |
| **Heston** | Vol. stochastique + EDS couplées | Smile de vol. | ✅ Réaliste ❌ 2 variables |
| **GARCH** | Bootstrap résidus GARCH(1,1) | Volatility clustering | ✅ Empirique ❌ Historique limité |

## 📊 Nouvelles fonctionnalités

### 1. **Backtesting** (Tab 7)
- Simule le modèle sur **fenêtres passées**
- Calcule VaR 95% prédite vs rendements réalisés
- Mesure **couverture empirique** (doit être ~5%)
- Diagnostic : "bien calibré" ou "à affiner"

```python
backtest_results = backtesting.rolling_window_backtesting(
    prices=asset["prices"],
    lookback_days=252,
    horizon_days=20,
    n_sims=2000,
)
```

### 2. **Explications non-techniques** (Tab 6)
- Résumé rapide des résultats pour non-techniciens
- Dictionnaire complet des métriques : VaR, ES, drawdown, etc.
- Interprétation en français simple

```python
explanations.interpretation_summary(metrics, S0)
# → "Une VaR 95% à −15% signifie qu'il y a 5 chances sur 100..."
```

### 3. **Optimisation de portefeuille** (Tab 2 multi-actifs)
- Frontière efficiente Markowitz
- Portefeuille Sharpe optimal
- Allocations pondérées par ticker
- Visualisation interactive (risque vs rendement)

```python
frontier = optimization.efficient_frontier(
    mean_returns, cov_matrix, n_points=50
)
```

### 4. **Multi-actifs corrélés** (Module `correlation.py`)
- Matrice de corrélation historique
- Décomposition Cholesky
- Génération de trajectoires corrélées

```python
paths = correlation.simulate_correlated_gbm(
    S0_dict, mu_dict, sigma_dict, corr_matrix
)
```

## 📁 Architecture

```
├── app.py                          # Dashboard enrichi
├── modules/
│   ├── simulation.py               # GBM, Merton, Heston, GARCH
│   ├── correlation.py              # Cholesky, multi-actifs
│   ├── backtesting.py              # Validation rolling-window
│   ├── optimization.py             # Markowitz, Sharpe
│   ├── explanations.py             # Dictionnaires explicatifs
│   ├── risk_metrics.py             # VaR, ES, drawdown (inchangé)
│   ├── data_fetcher.py             # Yahoo Finance (inchangé)
│   ├── visualizations.py           # Plotly (inchangé)
│   └── scenarios.py                # Scénarios de marché (inchangé)
└── requirements.txt                # + scipy, numba
```

## 🎛️ Sidebar enrichi

### Modèle de simulation
- **GBM (classique)** : baseline
- **Merton (sauts)** : λ, amplitude et écart-type des sauts
- **Heston (vol. stochastique)** : v0, κ, θ, σ_v, ρ
- **GARCH (bootstrap)** : calibrage automatique sur historique

### Paramètres GBM
- μ et σ manuels (override)
- Variables antithétiques
- Scénarios (base, bull, bear, stress)

## 📈 Onglets actif unique

1. **Trajectoires** : N trajectoires simulées
2. **Distribution finale** : histogramme + percentiles
3. **Rendements** : distribution des rendements finaux
4. **Densité dans le temps** : heatmap probabiliste
5. **Données brutes** : table complète des métriques
6. **Explications** : interprétation non-technique + drill-down
7. **Backtesting** : validation sur fenêtres passées

## 📊 Onglets multi-actifs

1. **Comparaison individuelle** : courbes de rendement comparées + synthèse
2. **Optimisation portefeuille** : frontière Markowitz + allocations Sharpe

## 🔧 Performance

- **Vectorisation 100% NumPy** : pas de boucles Python
- **Cache Streamlit** : ~1h pour données, illimité pour simulations
- **Numba** : optionnel pour GBM très gros (>100k simulations)

Pour 100k simulations en <5s :
```python
from numba import jit

@jit(nopython=True)
def fast_gbm(...):
    # implémentation Numba
```

## 📚 Explications incluses

- **Métriques** : VaR, ES, drawdown, P(perte), etc. — en français accessible
- **Modèles** : GBM, Merton, Heston, GARCH — pros/cons
- **Scénarios** : base, bull, bear, stress — impact sur μ/σ
- **Backtesting** : couverture, miscalibration — diagnostic

## ⚠️ Limites & avertissements

- Modèles supposent **marchés continus** (pas de circuit-breaker)
- Backtesting repose sur **performance passée** (non-garantie future)
- GARCH limité à **volatility clustering seul** (pas causalité prix-vol comme Heston)
- Optimisation Markowitz ignore **coûts de transaction** et **frictions**

**C'est un outil pédagogique, pas un conseil en investissement.**

## 🚀 Améliorations futures

- [ ] Optimisation GPU (CuPy) pour 1M+ simulations
- [ ] Calibration Black-Litterman (vues utilisateur)
- [ ] Copules pour multi-actifs exotiques
- [ ] Pricing d'options (Black-Scholes, payoff custom)
- [ ] Risk contribution par actif
- [ ] Stress-testing paramétrique

## 📜 Licence

Code libre d'usage à des fins personnelles et éducatives.
