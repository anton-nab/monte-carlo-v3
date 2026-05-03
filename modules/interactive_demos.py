"""
interactive_demos.py
--------------------
Démonstrations interactives pour comprendre l'impact des paramètres.
"""

import numpy as np
import streamlit as st
import plotly.graph_objects as go
from .simulation import gbm_simulation


def demo_volatility_impact():
    """Démo interactive : impact de la volatilité sur les courbes."""
    st.markdown("## 📊 Impact de la Volatilité (σ)")

    col1, col2 = st.columns([1, 2])

    with col1:
        st.markdown("### Paramètres")
        S0 = st.slider("Prix initial", 50.0, 200.0, 100.0, key="vol_s0")
        mu = st.slider("Dérive (μ)", 0.0, 0.20, 0.10, step=0.01, key="vol_mu")
        sigma = st.slider("Volatilité (σ) ← À MODIFIER", 0.05, 0.50, 0.20,
                         step=0.02, key="vol_sigma")
        horizon = st.slider("Horizon (jours)", 1, 252, 60, key="vol_horizon")

    with col2:
        # Simuler à différentes volatilités
        volatilities = [sigma * 0.5, sigma, sigma * 1.5]
        colors = ["green", "blue", "red"]
        labels = [f"σ = {v*100:.1f}%", f"σ = {sigma*100:.1f}%", f"σ = {sigma*150:.1f}%"]

        fig = go.Figure()

        for vol, color, label in zip(volatilities, colors, labels):
            paths = gbm_simulation(S0, mu, vol, horizon, n_sims=500, seed=42)
            mean_path = np.mean(paths, axis=0)

            fig.add_trace(go.Scatter(
                x=np.arange(horizon + 1),
                y=mean_path,
                name=label,
                line=dict(color=color, width=3),
                mode="lines"
            ))

        fig.update_layout(
            title="Impact de σ sur le prix moyen attendu",
            xaxis_title="Jours",
            yaxis_title="Prix (€)",
            hovermode="x unified",
            height=400
        )
        st.plotly_chart(fig, use_container_width=True)

    # Explications
    with st.expander("📖 Comprendre cet impact"):
        st.markdown(f"""
        ### Observations :

        1. **σ faible ({sigma*0.5*100:.1f}%)** : courbe lisse et étroite
           - Moins d'oscillations
           - Risque faible (VaR petit)
           - Peu de surprises

        2. **σ moyen ({sigma*100:.1f}%)** : notre baseline
           - Oscillations modérées
           - Risque modéré

        3. **σ élevé ({sigma*1.5*100:.1f}%)** : courbe large et volatile
           - Grandes oscillations
           - Risque élevé (VaR grand)
           - Plus de possibilités d'extrêmes (haut ET bas)

        ### Formule :
        σ contrôle l'écart-type du log-rendement quotidien:
        - σ = 20% → en 1 an, 95% des prix restent entre ±20% du prix initial (approx.)

        ### Impact sur l'investisseur :
        - Personne conservative : préfère bas σ (stabilité)
        - Personne agressive : accepte haut σ (oscillations, mais potentiel de gain)
        """)


def demo_drift_impact():
    """Démo interactive : impact de la dérive sur les courbes."""
    st.markdown("## 📈 Impact de la Dérive (μ)")

    col1, col2 = st.columns([1, 2])

    with col1:
        st.markdown("### Paramètres")
        S0 = st.slider("Prix initial", 50.0, 200.0, 100.0, key="drift_s0")
        mu = st.slider("Dérive (μ) ← À MODIFIER", -0.10, 0.30, 0.10,
                      step=0.02, key="drift_mu")
        sigma = st.slider("Volatilité (σ)", 0.05, 0.50, 0.20, step=0.02, key="drift_sigma")
        horizon = st.slider("Horizon (jours)", 1, 252, 60, key="drift_horizon")

    with col2:
        # Simuler à différentes dérives
        drifts = [mu - 0.10, mu, mu + 0.10]
        colors = ["red", "blue", "green"]
        labels = [f"μ = {d*100:.1f}%", f"μ = {mu*100:.1f}%", f"μ = {mu+0.1*100:.1f}%"]

        fig = go.Figure()

        for drift, color, label in zip(drifts, colors, labels):
            paths = gbm_simulation(S0, drift, sigma, horizon, n_sims=500, seed=42)
            mean_path = np.mean(paths, axis=0)

            fig.add_trace(go.Scatter(
                x=np.arange(horizon + 1),
                y=mean_path,
                name=label,
                line=dict(color=color, width=3),
                mode="lines"
            ))

        fig.update_layout(
            title="Impact de μ sur le prix moyen attendu",
            xaxis_title="Jours",
            yaxis_title="Prix (€)",
            hovermode="x unified",
            height=400
        )
        st.plotly_chart(fig, use_container_width=True)

    # Explications
    with st.expander("📖 Comprendre cet impact"):
        st.markdown(f"""
        ### Observations :

        1. **μ négatif ({(mu-0.1)*100:.1f}%)** : escalier qui descend
           - Rendement moyen négatif
           - Perte attendue
           - P(perte) > 50%

        2. **μ modéré ({mu*100:.1f}%)** : escalier neutre/légèrement haussier
           - Rendement moyen positif
           - P(perte) < 50%

        3. **μ élevé ({(mu+0.1)*100:.1f}%)** : escalier qui monte fortement
           - Rendement moyen très positif
           - P(perte) très faible

        ### Formule :
        μ = rendement annuel attendu. Si S_0 = 100€ et μ = 10%, on attend 110€ en 1 an (moyenne).

        ### Important :
        - **μ n'affecte PAS la volatilité** (risque instantané)
        - Seule la **tendance générale** change
        - Horizon court : μ a peu d'impact
        - Horizon long : μ devient dominant (tendance prend le dessus)
        """)


def demo_horizon_impact():
    """Démo interactive : impact de l'horizon sur le risque."""
    st.markdown("## ⏱️ Impact de l'Horizon")

    col1, col2 = st.columns([1, 2])

    with col1:
        st.markdown("### Paramètres")
        S0 = st.slider("Prix initial", 50.0, 200.0, 100.0, key="horiz_s0")
        mu = st.slider("Dérive (μ)", 0.0, 0.20, 0.10, step=0.01, key="horiz_mu")
        sigma = st.slider("Volatilité (σ)", 0.05, 0.50, 0.20, step=0.02, key="horiz_sigma")

    with col2:
        horizons = [10, 60, 252]
        colors = ["green", "orange", "red"]
        labels = ["10 jours", "60 jours (2-3 mois)", "252 jours (1 an)"]

        fig = go.Figure()

        for horizon, color, label in zip(horizons, colors, labels):
            paths = gbm_simulation(S0, mu, sigma, horizon, n_sims=1000, seed=42)
            final_prices = paths[:, -1]

            fig.add_trace(go.Histogram(
                x=final_prices,
                name=label,
                nbinsx=30,
                marker=dict(color=color, opacity=0.6)
            ))

        fig.update_layout(
            title="Distribution finale selon l'horizon",
            xaxis_title="Prix final (€)",
            yaxis_title="Fréquence (simulations)",
            barmode="overlay",
            height=400,
            hovermode="x unified"
        )
        st.plotly_chart(fig, use_container_width=True)

    # Explications
    with st.expander("📖 Comprendre cet impact"):
        st.markdown("""
        ### Observations :

        1. **Horizon court (10 jours)** : distribution étroite
           - Peu de temps pour les mouvements
           - Distribution centrée autour du prix initial
           - Risque faible (VaR petit)

        2. **Horizon moyen (60 jours)** : distribution s'élargit
           - Plus de temps pour les oscillations
           - Distribution plus plate
           - Risque modéré

        3. **Horizon long (252 jours)** : distribution très large
           - Beaucoup de temps pour variation
           - Distribution très plate et asymétrique
           - Risque élevé (VaR très négatif potentiellement)
           - Mais aussi gain potentiel plus grand

        ### Formule :
        Volatilité se **multiplie** par √horizon:
        - σ quotidien = 1%
        - σ sur 60 jours = 1% × √60 ≈ 7.7%
        - σ sur 252 jours = 1% × √252 ≈ 15.9%

        ### Implication :
        **Plus l'horizon est long, plus le risque augmente.** C'est contre-intuitif mais vrai !
        """)


def demo_correlation_impact():
    """Démo interactive : impact de la corrélation sur la diversification."""
    st.markdown("## 🔗 Impact de la Corrélation")

    col1, col2 = st.columns([1, 2])

    with col1:
        st.markdown("### Paramètres")
        corr = st.slider("Corrélation ← À MODIFIER", -1.0, 1.0, 0.5,
                        step=0.1, key="corr_value")
        w1 = st.slider("Poids Asset 1", 0.0, 1.0, 0.5, key="w1")
        w2 = 1 - w1

    with col2:
        # Générer deux séries corrélées
        n = 252
        Z1 = np.random.standard_normal(n)
        Z2_indep = np.random.standard_normal(n)
        Z2 = corr * Z1 + np.sqrt(1 - corr**2) * Z2_indep

        # Portefeuille
        port_ret = w1 * Z1 + w2 * Z2

        fig = go.Figure()

        fig.add_trace(go.Scatter(
            x=np.arange(n),
            y=np.cumsum(Z1) / np.std(Z1),
            name="Asset 1",
            line=dict(color="blue"),
            opacity=0.7
        ))

        fig.add_trace(go.Scatter(
            x=np.arange(n),
            y=np.cumsum(Z2) / np.std(Z2),
            name="Asset 2",
            line=dict(color="red"),
            opacity=0.7
        ))

        fig.add_trace(go.Scatter(
            x=np.arange(n),
            y=np.cumsum(port_ret) / np.std(port_ret),
            name="Portefeuille",
            line=dict(color="green", width=3),
        ))

        fig.update_layout(
            title=f"Mouvement des actifs (corr = {corr:.2f})",
            xaxis_title="Jours",
            yaxis_title="Prix normalisé",
            hovermode="x unified",
            height=400
        )
        st.plotly_chart(fig, use_container_width=True)

    # Explications
    with st.expander("📖 Comprendre cet impact"):
        port_vol_perfect = np.sqrt(w1**2 + w2**2 + 2*w1*w2*corr)
        port_vol_zero_corr = np.sqrt(w1**2 + w2**2)

        st.markdown(f"""
        ### Observations :

        - **Corr = 1.0** (identique) : les deux assets bougent ensemble
          - Portefeuille = moyenne simple
          - Pas de diversification

        - **Corr = {corr:.1f}** (votre valeur)
          - Volatilité portefeuille = {port_vol_perfect:.2f}
          - Gain de diversification

        - **Corr = 0.0** (indépendant)
          - Volatilité portefeuille = {port_vol_zero_corr:.2f}
          - Meilleure diversification

        - **Corr = -1.0** (opposé) : couverture parfaite
          - Les mouvements se cancellent
          - Risque minimal

        ### Formule :
        σ_portefeuille = √(w₁²σ₁² + w₂²σ₂² + 2w₁w₂ρσ₁σ₂)

        ### Implication :
        **La corrélation affecte DRASTIQUEMENT le risque du portefeuille.**
        Chercher des actifs peu corrélés est clé pour la diversification !
        """)
