"""
ui_helpers.py
-------------
Composants UI modernes et pédagogiques pour Streamlit.
"""

import streamlit as st
import plotly.graph_objects as go
import numpy as np


def render_metric_card(label: str, value: str, delta: str | None = None,
                      help_text: str | None = None, color: str = "blue"):
    """Rend une carte métrique moderne avec couleur et aide."""
    with st.container():
        cols = st.columns([3, 1]) if help_text else [st.columns(1)[0]]

        with cols[0]:
            col1, col2 = st.columns([2, 1])
            with col1:
                st.markdown(f"**{label}**")
                st.markdown(f"<h2 style='color: {color}'>{value}</h2>", unsafe_allow_html=True)
            with col2:
                if delta:
                    st.markdown(f"<p style='color: green'>{delta}</p>", unsafe_allow_html=True)

        if help_text:
            with cols[1]:
                st.info(help_text, icon="ℹ️")


def create_interactive_parameter_demo(param_name: str, param_symbol: str,
                                     formula: str, impact_text: str):
    """Crée une démo interactive montrant l'impact d'un paramètre."""
    st.markdown(f"### 📐 {param_name} ({param_symbol})")

    col1, col2 = st.columns(2)

    with col1:
        st.latex(formula)
        st.markdown("**Impact sur les courbes :**")
        st.markdown(impact_text)

    with col2:
        # Slider pour démonstration
        demo_value = st.slider(
            f"Ajuster {param_symbol}",
            min_value=0.0,
            max_value=1.0,
            value=0.5,
            step=0.1,
            key=f"demo_{param_symbol}"
        )

        # Graphique d'impact
        x = np.linspace(0, 10, 100)
        y_low = np.exp(-0.2 * x)
        y_high = np.exp(-demo_value * x)

        fig = go.Figure()
        fig.add_trace(go.Scatter(x=x, y=y_low, name="Baseline",
                                line=dict(color="blue", dash="dash")))
        fig.add_trace(go.Scatter(x=x, y=y_high, name=f"{param_symbol}={demo_value:.2f}",
                                line=dict(color="red")))
        fig.update_layout(
            title=f"Impact de {param_symbol} sur les trajectoires",
            xaxis_title="Temps (jours)",
            yaxis_title="Prix (relatif)",
            height=300,
            hovermode="x unified"
        )
        st.plotly_chart(fig, use_container_width=True)


def create_sensitivity_plot(base_value: float, param_name: str,
                           range_pct: float = 0.5) -> go.Figure:
    """Crée un graphique montrant la sensibilité aux paramètres."""
    range_vals = np.linspace(base_value * (1 - range_pct),
                             base_value * (1 + range_pct), 11)

    # Métrique simulée (exemple : VaR)
    var_values = -0.05 - (range_vals - base_value) / base_value * 0.03

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=range_vals * 100,
        y=var_values * 100,
        mode="lines+markers",
        name="VaR 95%",
        line=dict(color="red", width=3),
        marker=dict(size=8)
    ))

    # Ajouter ligne verticale au baseline
    fig.add_vline(
        x=base_value * 100,
        line_dash="dash",
        line_color="green",
        annotation_text="Baseline",
        annotation_position="top right"
    )

    fig.update_layout(
        title=f"Sensibilité : Impact de {param_name} sur VaR",
        xaxis_title=f"{param_name} (%)",
        yaxis_title="VaR 95% (%)",
        height=400,
        hovermode="x unified"
    )

    return fig


def glossary_sidebar():
    """Rendu une sidebar avec glossaire et explications."""
    with st.sidebar.expander("📚 Glossaire interactif", expanded=False):
        st.markdown("### Termes techniques expliqués")

        from modules.glossary import liste_termes

        terme = st.selectbox(
            "Choisir un terme",
            liste_termes(),
            key="glossary_select"
        )

        if terme:
            from modules.glossary import afficher_terme
            info = afficher_terme(terme)

            st.markdown(f"#### {terme}")

            with st.expander("Explication simple", expanded=True):
                st.markdown(f"**{info['simple']}**")
                st.markdown(f"*{info['illustration']}*")

            with st.expander("Explication technique"):
                st.markdown(info['technique'])
                st.latex(info['formule'])

            with st.expander("Exemple concret"):
                st.markdown(info['exemple'])

            with st.expander("Impact sur l'analyse"):
                st.markdown(info['impact'])


def create_comparison_view(before: dict, after: dict, metric_names: list):
    """Affiche une comparaison avant/après pour montrer l'impact des changements."""
    st.markdown("### 📊 Avant / Après")

    cols = st.columns(len(metric_names))

    for idx, metric in enumerate(metric_names):
        with cols[idx]:
            before_val = before.get(metric, 0)
            after_val = after.get(metric, 0)
            delta = after_val - before_val
            delta_pct = (delta / before_val * 100) if before_val != 0 else 0

            st.metric(
                metric,
                f"{after_val:.2%}",
                f"{delta:+.2%} ({delta_pct:+.1f}%)"
            )


def create_risk_gauge(var_95: float, es_95: float, prob_loss: float):
    """Crée un jauge de risque visual pour montrer le profil."""
    fig = go.Figure(go.Indicator(
        mode="gauge+number+delta",
        value=-var_95 * 100,
        title={'text': "Risque (VaR 95%)"},
        delta={'reference': -es_95 * 100, 'suffix': ' vs ES'},
        gauge={
            'axis': {'range': [None, 30]},
            'bar': {'color': "darkred"},
            'steps': [
                {'range': [0, 5], 'color': "lightgreen"},
                {'range': [5, 15], 'color': "yellow"},
                {'range': [15, 25], 'color': "orange"},
                {'range': [25, 30], 'color': "red"}
            ],
            'threshold': {
                'line': {'color': "black", 'width': 4},
                'thickness': 0.75,
                'value': 20
            }
        }
    ))

    fig.update_layout(height=300)
    return fig


def create_education_page():
    """Page d'apprentissage complète avec tous les concepts et démos."""
    st.title("📚 Centre d'apprentissage")

    st.markdown("""
    <div style='background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 1.5rem; border-radius: 12px; color: white; margin-bottom: 2rem;'>
    <h3>🎓 Bienvenue !</h3>
    <p>Explorez les concepts financiers avec des explications simples et des démonstrations interactives.</p>
    <p>Chaque concept est expliqué en : langage simple → formule → exemple → impact visuel</p>
    </div>
    """, unsafe_allow_html=True)

    # Onglets principaux
    tab_demos, tab_glossary, tab_guide = st.tabs(
        ["🎮 Démos interactives", "📖 Glossaire complet", "🎯 Guide rapide"]
    )

    with tab_demos:
        st.markdown("## Ajustez les paramètres pour voir l'impact en temps réel !")

        from modules.interactive_demos import (
            demo_volatility_impact, demo_drift_impact,
            demo_horizon_impact, demo_correlation_impact
        )

        demo_tabs = st.tabs([
            "Volatilité (σ)",
            "Dérive (μ)",
            "Horizon",
            "Corrélation"
        ])

        with demo_tabs[0]:
            demo_volatility_impact()

        with demo_tabs[1]:
            demo_drift_impact()

        with demo_tabs[2]:
            demo_horizon_impact()

        with demo_tabs[3]:
            demo_correlation_impact()

    with tab_glossary:
        st.markdown("## 📖 Tous les termes expliqués")

        # Catégories
        categories = {
            "🎯 Concepts fondamentaux": [
                "Dérive (μ)", "Volatilité (σ)", "Corrélation"
            ],
            "⚠️ Mesures de risque": [
                "VaR 95% (Value at Risk)",
                "Expected Shortfall (ES/CVaR)",
                "Drawdown",
                "Probabilité de perte"
            ],
            "📊 Concepts statistiques": [
                "Skewness (Asymétrie)",
                "Kurtosis (Queues épaisses)",
                "Simulation Monte Carlo"
            ],
            "🧬 Modèles de prix": [
                "Modèle GBM",
                "Modèle Merton",
                "Modèle Heston",
                "Modèle GARCH"
            ],
            "💼 Optimisation de portefeuille": [
                "Frontière Efficiente",
                "Ratio Sharpe",
                "Corrélation"
            ],
            "🔍 Validation": [
                "Backtesting"
            ]
        }

        # Onglets par catégorie
        tabs = st.tabs(list(categories.keys()))

        for tab_idx, (category, terms) in enumerate(categories.items()):
            with tabs[tab_idx]:
                for term in terms:
                    with st.expander(f"**{term}**", expanded=False):
                        from modules.glossary import afficher_terme
                        info = afficher_terme(term)

                        col1, col2 = st.columns(2)

                        with col1:
                            st.markdown("**Explication simple**")
                            st.markdown(info['simple'])
                            st.markdown(f"*💡 {info['illustration']}*")

                            st.markdown("**Exemple**")
                            st.markdown(info['exemple'])

                        with col2:
                            st.markdown("**Formule mathématique**")
                            st.latex(info['formule'])

                            st.markdown("**Impact sur l'analyse**")
                            st.markdown(info['impact'])

    with tab_guide:
        st.markdown("## 🎯 Guide rapide")
        st.markdown("""
        ### 💡 Conseils pour bien utiliser l'app

        1. **Commencez par comprendre VaR et volatilité** : ce sont les 2 concepts clés
        2. **Testez l'impact des paramètres** : modifiez μ et σ, voyez comment ça change les courbes
        3. **Utilisez le backtesting** : vérifiez que le modèle s'est bien comporté dans le passé
        4. **Diversifiez avec la corrélation** : des actifs corrélés = pas de vraie diversification
        5. **Cherchez l'équilibre avec Sharpe** : rendement par unité de risque, pas rendement brut
        """)
