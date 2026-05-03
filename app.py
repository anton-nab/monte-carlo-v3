"""
app.py
------
Dashboard Streamlit : Simulation Monte Carlo v2 – Modern & Educational

Lancer avec :
    streamlit run app.py
"""

from __future__ import annotations

import io
from datetime import datetime

import numpy as np
import pandas as pd
import streamlit as st
import plotly.graph_objects as go

from modules import (
    data_fetcher, simulation, risk_metrics, visualizations,
    correlation, backtesting, optimization, explanations, ui_helpers,
    glossary, interactive_demos, volume_analysis, orderflow_simulator,
    trading_dashboard
)
from modules import scenarios as scen_module


# --------------------------------------------------------------------------- #
# Configuration globale
# --------------------------------------------------------------------------- #
st.set_page_config(
    page_title="Monte Carlo Simulator v2",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
    menu_items={"About": "Simulation Monte Carlo avancée avec pédagogie"}
)

# Thème moderne avec couleurs cohérentes
st.markdown(
    """
    <style>
    /* Couleurs cohérentes */
    :root {
        --color-primary: #0066CC;
        --color-success: #00AA44;
        --color-warning: #FF9900;
        --color-danger: #CC0000;
        --color-light: #F5F7FA;
        --color-dark: #1F2937;
    }

    /* Layout */
    .main .block-container {
        padding-top: 2rem; padding-bottom: 2rem;
        max-width: 1400px;
    }

    /* Cartes métriques modernes */
    .metric-modern {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 1.5rem; border-radius: 12px; margin: 0.5rem 0;
        color: white; box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    }

    /* Headers */
    h1 {
        color: #0066CC;
        border-bottom: 3px solid #0066CC;
        padding-bottom: 0.5rem;
    }
    h2 { color: #1F2937; margin-top: 2rem; }
    h3 { color: #333; font-weight: 600; }

    /* Tabs modernes */
    .stTabs [data-baseweb="tab-list"] {
        gap: 8px;
        border-bottom: 2px solid #E5E7EB;
    }
    .stTabs [data-baseweb="tab"] {
        padding: 0.75rem 1.5rem;
        background-color: #F3F4F6;
        border-radius: 8px 8px 0 0;
        border: none;
        font-weight: 500;
    }
    .stTabs [aria-selected="true"] {
        background-color: #0066CC !important;
        color: white !important;
    }

    /* Expanders */
    .streamlit-expanderHeader {
        background-color: #F3F4F6 !important;
        border-radius: 8px;
    }

    /* Boutons */
    .stButton > button {
        background: linear-gradient(135deg, #0066CC, #004499);
        color: white;
        border: none;
        border-radius: 8px;
        padding: 0.75rem 1.5rem;
        font-weight: 600;
        transition: all 0.3s;
    }
    .stButton > button:hover {
        background: linear-gradient(135deg, #004499, #003366);
        box-shadow: 0 4px 12px rgba(0,102,204,0.3);
    }

    /* Inputs */
    .stSlider, .stNumberInput, .stSelectbox, .stTextInput {
        padding: 0.5rem;
        border-radius: 8px;
    }

    /* Info boxes */
    .stInfo, .stSuccess, .stWarning, .stError {
        border-radius: 8px;
        border-left: 4px solid;
    }

    /* Smooth transitions */
    * {
        transition: all 0.3s ease;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


# --------------------------------------------------------------------------- #
# Cache des appels lourds (réseau et calculs)
# --------------------------------------------------------------------------- #
@st.cache_data(show_spinner=False, ttl=3600)
def cached_fetch(ticker: str, period: str) -> dict:
    """Cache 1h des données Yahoo Finance."""
    info = data_fetcher.get_asset_info(ticker, period=period)
    # On retire 'history' du cache pour limiter la mémoire
    return {
        "ticker": info["ticker"],
        "prices": info["prices"],
        "log_returns": info["log_returns"],
        "stats": info["stats"],
        "last_price": info["last_price"],
    }


@st.cache_data(show_spinner=False)
def cached_simulation(
    S0: float,
    mu: float,
    sigma: float,
    horizon: int,
    n_sims: int,
    seed: int,
    antithetic: bool,
    model: str = "GBM",
    merton_params: dict | None = None,
    heston_params: dict | None = None,
    log_returns: np.ndarray | None = None,
) -> np.ndarray:
    """Cache des simulations (clés = paramètres)."""
    if "Merton" in model:
        params = merton_params or {}
        return simulation.merton_jump_diffusion(
            S0=S0, mu=mu, sigma=sigma, horizon_days=horizon, n_sims=n_sims,
            seed=seed, **params
        )
    elif "Heston" in model:
        params = heston_params or {}
        return simulation.heston_simulation(
            S0=S0, mu=mu, horizon_days=horizon, n_sims=n_sims,
            seed=seed, **params
        )
    elif "GARCH" in model:
        if log_returns is None:
            raise ValueError("log_returns requis pour GARCH bootstrap.")
        return simulation.garch_bootstrap_simulation(
            S0=S0, returns=log_returns, horizon_days=horizon, n_sims=n_sims,
            seed=seed
        )
    else:  # GBM
        func = (
            simulation.antithetic_gbm_simulation
            if antithetic
            else simulation.gbm_simulation
        )
        return func(
            S0=S0, mu=mu, sigma=sigma, horizon_days=horizon, n_sims=n_sims,
            seed=seed,
        )


# --------------------------------------------------------------------------- #
# Sidebar : tous les inputs
# --------------------------------------------------------------------------- #
def render_sidebar() -> dict:
    """Construit la sidebar et retourne tous les paramètres choisis."""
    st.sidebar.title("⚙️ Paramètres")

    st.sidebar.markdown("### 📊 Actif(s)")
    mode = st.sidebar.radio(
        "Mode d'analyse",
        ["Actif unique", "Comparaison multi-actifs"],
        horizontal=True,
    )

    if mode == "Actif unique":
        ticker_input = st.sidebar.text_input(
            "Ticker",
            value="AAPL",
            help="Ex : AAPL, MSFT, TSLA, BTC-USD, ^GSPC, MC.PA",
        )
        tickers = [ticker_input.strip().upper()] if ticker_input else []
    else:
        tickers_str = st.sidebar.text_input(
            "Tickers (séparés par virgule)",
            value="AAPL, MSFT, GOOGL",
            help="Maximum 6 actifs recommandé.",
        )
        tickers = [t.strip().upper() for t in tickers_str.split(",") if t.strip()]

    period = st.sidebar.selectbox(
        "Période historique",
        ["6mo", "1y", "2y", "5y", "10y", "max"],
        index=2,
    )

    st.sidebar.markdown("### 🎲 Simulation")
    n_sims = st.sidebar.slider(
        "Nombre de simulations",
        min_value=500,
        max_value=20000,
        value=5000,
        step=500,
        help="Plus de simulations = précision accrue, mais plus lent.",
    )
    horizon_unit = st.sidebar.radio(
        "Unité d'horizon", ["Jours", "Mois"], horizontal=True
    )
    if horizon_unit == "Jours":
        horizon = st.sidebar.slider("Horizon (jours de bourse)", 5, 504, 252)
    else:
        horizon_months = st.sidebar.slider("Horizon (mois)", 1, 24, 12)
        horizon = int(horizon_months * 21)  # ~21 jours de bourse / mois

    seed = st.sidebar.number_input(
        "Graine aléatoire", value=42, step=1, help="Pour reproductibilité."
    )

    antithetic = st.sidebar.checkbox(
        "Variables antithétiques",
        value=True,
        help="Réduction de variance gratuite.",
    )

    st.sidebar.markdown("### 🧬 Modèle de simulation")
    model = st.sidebar.selectbox(
        "Modèle de prix",
        ["GBM (classique)", "Merton (sauts)", "Heston (vol. stochastique)", "GARCH (bootstrap)"],
        index=0,
    )
    st.sidebar.caption(explanations.explain_model(model.split("(")[0].strip()))

    st.sidebar.markdown("### 📐 Paramètres du modèle")
    use_manual = st.sidebar.checkbox("Forcer mu/sigma manuellement", value=False)
    manual_mu = None
    manual_sigma = None
    if use_manual:
        manual_mu = st.sidebar.number_input(
            "μ (drift annualisé, ex 0.08)", value=0.10, step=0.01, format="%.4f"
        )
        manual_sigma = st.sidebar.number_input(
            "σ (volatilité annualisée, ex 0.25)",
            value=0.25,
            step=0.01,
            format="%.4f",
        )

    # Paramètres spécifiques à Merton
    merton_params = {}
    if "Merton" in model:
        st.sidebar.markdown("#### Merton : Sauts")
        merton_params["lambda_poisson"] = st.sidebar.slider(
            "Intensité λ (sauts/an)", 0.1, 3.0, 0.5
        )
        merton_params["jump_mean"] = st.sidebar.slider(
            "Rendement moyen saut", -0.20, 0.0, -0.05
        )
        merton_params["jump_std"] = st.sidebar.slider(
            "Écart-type saut", 0.01, 0.3, 0.1
        )

    # Paramètres spécifiques à Heston
    heston_params = {}
    if "Heston" in model:
        st.sidebar.markdown("#### Heston : Volatilité Stochastique")
        heston_params["v0"] = st.sidebar.slider(
            "Variance initiale (v0)", 0.01, 1.0, 0.2
        )
        heston_params["kappa"] = st.sidebar.slider(
            "Vitesse reversion κ", 0.1, 3.0, 1.0
        )
        heston_params["theta"] = st.sidebar.slider(
            "Vol. moyenne long-terme θ", 0.05, 1.0, 0.3
        )
        heston_params["sigma_v"] = st.sidebar.slider(
            "Vol. de la volatilité", 0.01, 1.0, 0.3
        )
        heston_params["rho"] = st.sidebar.slider(
            "Corrélation prix-vol ρ", -0.9, 0.0, -0.5
        )

    st.sidebar.markdown("### 🌪️ Scénario")
    scenario = st.sidebar.selectbox(
        "Régime de marché",
        list(scen_module.SCENARIOS.keys()),
        index=0,
    )
    st.sidebar.caption(scen_module.scenario_description(scenario))

    compare_scenarios = st.sidebar.checkbox(
        "Comparer tous les scénarios", value=False
    )

    return {
        "mode": mode,
        "tickers": tickers,
        "period": period,
        "n_sims": n_sims,
        "horizon": horizon,
        "seed": int(seed),
        "antithetic": antithetic,
        "use_manual": use_manual,
        "manual_mu": manual_mu,
        "manual_sigma": manual_sigma,
        "scenario": scenario,
        "compare_scenarios": compare_scenarios,
        "model": model,
        "merton_params": merton_params,
        "heston_params": heston_params,
    }


# --------------------------------------------------------------------------- #
# Affichage des métriques avec design moderne
# --------------------------------------------------------------------------- #
def render_metrics(metrics: dict, S0: float):
    """Affiche les KPI principaux avec design moderne et interactions."""
    st.markdown("## 🎯 Métriques principales")

    # Ligne 1 : Prix et rendement
    col1, col2, col3, col4 = st.columns(4, gap="medium")

    with col1:
        st.metric(
            "💰 Prix attendu",
            f"{metrics['expected_price']:.2f}",
            f"{(metrics['expected_price'] / S0 - 1) * 100:+.2f}%",
            delta_color="inverse",
        )

    with col2:
        st.metric(
            "📊 Prix médian (P50)",
            f"{metrics['median_price']:.2f}",
            f"{(metrics['median_price'] / S0 - 1) * 100:+.2f}%",
            delta_color="inverse",
        )

    with col3:
        var_pct = metrics['var_95'] * 100
        color = "🔴" if var_pct < -15 else "🟡" if var_pct < -5 else "🟢"
        st.metric(
            f"{color} VaR 95% (Risque)",
            f"{var_pct:.2f}%",
            help="Perte max 95% du temps",
        )

    with col4:
        prob_loss_pct = metrics['prob_loss'] * 100
        st.metric(
            "⚠️ P(Perte)",
            f"{prob_loss_pct:.1f}%",
            help="Chance de terminer en négatif",
        )

    # Ligne 2 : Risque avancé
    col5, col6, col7, col8 = st.columns(4, gap="medium")

    with col5:
        st.metric(
            "💥 Expected Shortfall",
            f"{metrics['es_95'] * 100:.2f}%",
            help="Perte moyenne en cas de crise",
        )

    with col6:
        st.metric(
            "📉 Drawdown moyen",
            f"{metrics['avg_max_drawdown'] * 100:.2f}%",
            help="Recul moyen du pic au creux",
        )

    with col7:
        st.metric(
            "🔻 Pire drawdown",
            f"{metrics['worst_drawdown'] * 100:.2f}%",
            help="Recul extrême observé",
        )

    with col8:
        st.metric(
            "🎯 P(Gain > 10%)",
            f"{metrics['prob_gain_10pct'] * 100:.1f}%",
            help="Chance d'un gain substantiel",
        )

    # Explication visuelle
    with st.expander("💡 Interpréter ces chiffres", expanded=False):
        col_left, col_right = st.columns(2)

        with col_left:
            st.markdown("### ✅ Profil de risque")
            if metrics['var_95'] > -0.10 and metrics['prob_loss'] < 0.3:
                st.success("✓ Profil modéré — risque contrôlé")
            elif metrics['var_95'] < -0.20 or metrics['prob_loss'] > 0.5:
                st.warning("⚠ Profil agressif — risque élevé")
            else:
                st.info("→ Profil équilibré")

        with col_right:
            st.markdown("### 🎯 Comprendre")
            st.markdown("""
            • **VaR 95%** = perte max 95% du temps
            • **ES 95%** = perte moyenne en cas de dépassement
            • **Drawdown** = recul du meilleur au pire
            • **P(Perte)** = probabilité de rendement négatif
            """)


# --------------------------------------------------------------------------- #
# Export CSV
# --------------------------------------------------------------------------- #
def build_export(paths: np.ndarray, metrics: dict, params: dict) -> bytes:
    """Construit un fichier Excel multi-feuilles téléchargeable."""
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        # Feuille 1 : métriques
        pd.DataFrame([metrics]).T.rename(columns={0: "Valeur"}).to_excel(
            writer, sheet_name="Metriques"
        )
        # Feuille 2 : paramètres
        pd.DataFrame([params]).T.rename(columns={0: "Valeur"}).to_excel(
            writer, sheet_name="Parametres"
        )
        # Feuille 3 : percentiles dans le temps
        pcts = risk_metrics.percentile_paths(paths, (1, 5, 25, 50, 75, 95, 99))
        pd.DataFrame(pcts).to_excel(writer, sheet_name="Percentiles", index=False)
        # Feuille 4 : prix finaux (échantillon)
        pd.DataFrame(
            {"Prix_finaux": paths[:, -1]}
        ).to_excel(writer, sheet_name="Prix_finaux", index=False)

    buffer.seek(0)
    return buffer.getvalue()


# --------------------------------------------------------------------------- #
# Mode 1 : Actif unique
# --------------------------------------------------------------------------- #
def run_single_asset(params: dict):
    """Exécute le pipeline pour un actif unique."""
    if not params["tickers"]:
        st.warning("Veuillez saisir un ticker.")
        return

    ticker = params["tickers"][0]

    with st.spinner(f"📡 Récupération des données pour {ticker}..."):
        try:
            asset = cached_fetch(ticker, params["period"])
        except ValueError as e:
            st.error(str(e))
            return
        except Exception as e:
            st.error(f"Erreur lors de la récupération : {e}")
            return

    S0 = asset["last_price"]
    stats = asset["stats"]

    # Choix mu / sigma : auto ou manuel
    if params["use_manual"]:
        mu_base = params["manual_mu"]
        sigma_base = params["manual_sigma"]
    else:
        mu_base = stats["mu_annual"]
        sigma_base = stats["sigma_annual"]

    # Application du scénario
    mu_adj, sigma_adj = scen_module.apply_scenario(
        mu_base, sigma_base, params["scenario"]
    )

    # En-tête
    st.markdown(f"# 📈 {ticker}")
    info_cols = st.columns(5)
    info_cols[0].metric("Dernier prix", f"{S0:.2f}")
    info_cols[1].metric(
        "μ historique (an)", f"{stats['mu_annual'] * 100:.2f}%"
    )
    info_cols[2].metric(
        "σ historique (an)", f"{stats['sigma_annual'] * 100:.2f}%"
    )
    info_cols[3].metric("μ utilisé", f"{mu_adj * 100:.2f}%")
    info_cols[4].metric("σ utilisé", f"{sigma_adj * 100:.2f}%")

    # Afficher le scénario et ses impacts
    if params["scenario"] != "Base (historique)":
        st.info(
            f"**Scénario actif : {params['scenario']}**\n"
            f"{scen_module.scenario_description(params['scenario'])}"
        )

        # Montrer l'ajustement
        with st.expander("📊 Comment le scénario modifie les paramètres", expanded=False):
            col_before, col_arrow, col_after = st.columns([2, 0.5, 2])

            with col_before:
                st.markdown("### Avant (Historique)")
                st.metric("μ (dérive)", f"{stats['mu_annual'] * 100:.2f}%")
                st.metric("σ (volatilité)", f"{stats['sigma_annual'] * 100:.2f}%")

            with col_arrow:
                st.markdown("### ")
                st.markdown("→")

            with col_after:
                st.markdown("### Après (Scénario)")
                st.metric("μ ajusté", f"{mu_adj * 100:.2f}%")
                st.metric("σ ajusté", f"{sigma_adj * 100:.2f}%")

    # Simulation
    with st.spinner(f"🎲 {params['n_sims']:,} simulations en cours..."):
        paths = cached_simulation(
            S0=S0,
            mu=mu_adj,
            sigma=sigma_adj,
            horizon=params["horizon"],
            n_sims=params["n_sims"],
            seed=params["seed"],
            antithetic=params["antithetic"],
            model=params["model"],
            merton_params=params.get("merton_params"),
            heston_params=params.get("heston_params"),
            log_returns=asset.get("log_returns") if "GARCH" in params["model"] else None,
        )

    metrics = risk_metrics.compute_all_metrics(paths, S0)

    # KPIs
    st.markdown("## 🎯 Métriques principales")
    render_metrics(metrics, S0)

    # Onglets de visualisation
    st.markdown("## 📊 Visualisations & Analyses")
    tab1, tab2, tab3, tab4, tab5, tab6, tab7, tab8 = st.tabs(
        [
            "Trajectoires",
            "Distribution finale",
            "Rendements",
            "Densité (Haute Résolution)",
            "Données brutes",
            "Explications",
            "Backtesting",
            "📈 Dashboard Trading",
        ]
    )

    with tab1:
        fig = visualizations.plot_simulation_paths(
            paths, S0, n_display=200, title=f"Trajectoires Monte Carlo — {ticker}"
        )
        st.plotly_chart(fig, use_container_width=True, key="tab1_paths")

    with tab2:
        fig = visualizations.plot_final_distribution(paths, S0)
        st.plotly_chart(fig, use_container_width=True, key="tab2_distribution")

    with tab3:
        fig = visualizations.plot_return_distribution(paths, S0)
        st.plotly_chart(fig, use_container_width=True, key="tab3_returns")

    with tab4:
        st.info("🔥 Heatmap de Densité Probabiliste — Voir où le prix a le plus de chances d'être")
        st.write("""
        **Comprendre le graphique:**
        - 🔴 **Zones ROUGES** (chaudes) = Probabilité ÉLEVÉE que le prix soit à ce niveau à ce moment
        - 🟡 **Zones JAUNES** = Probabilité MOYENNE
        - 🔵 **Zones BLEUES** (froides) = Probabilité BASSE

        **Les courbes:**
        - 🔷 Cyan = Scénario moyen (50% de chance d'être au-dessus/dessous)
        - 🟢 Vert = P5 (95% de chances que le prix soit AU-DESSUS de cette ligne)
        - 🔴 Rouge = P95 (95% de chances que le prix soit EN-DESSOUS de cette ligne)
        """)

        with st.spinner("Calcul de la densité probabiliste..."):
            fig = visualizations.plot_probability_density_heatmap(paths, S0)
        st.plotly_chart(fig, use_container_width=True, key="tab4_density_heatmap")

    with tab5:
        df_metrics = pd.DataFrame(
            [(k, v) for k, v in metrics.items()],
            columns=["Métrique", "Valeur"],
        )
        st.dataframe(df_metrics, use_container_width=True, height=400)

    with tab6:
        st.markdown("## 📖 Explications")
        st.markdown(explanations.interpretation_summary(metrics, S0))

        st.markdown("### Détail des métriques")
        metric_choice = st.selectbox(
            "Choisir une métrique",
            list(explanations.METRIC_EXPLANATIONS.keys()),
        )
        st.info(explanations.explain_metric(metric_choice))

    with tab7:
        st.markdown("## 🔍 Validation du modèle")
        st.info(
            "Le backtesting simule le modèle sur des fenêtres passées et compare "
            "à la réalité. Cela évalue si le modèle est bien calibré."
        )

        if st.button("Lancer backtesting (peut être lent...)", key="backtest_btn"):
            with st.spinner("Backtesting en cours..."):
                try:
                    backtest_results = backtesting.rolling_window_backtesting(
                        prices=asset["prices"],
                        lookback_days=min(252, len(asset["prices"]) // 3),
                        horizon_days=min(20, len(asset["prices"]) // 10),
                        n_sims=min(params["n_sims"], 2000),
                        seed=params["seed"],
                    )
                    backtest_metrics = backtesting.compute_backtesting_metrics(
                        backtest_results
                    )

                    st.markdown(
                        explanations.backtesting_summary(backtest_metrics)
                    )

                    # Visualiser réalisé vs prédit
                    import plotly.graph_objects as go

                    fig = go.Figure()
                    fig.add_trace(
                        go.Scatter(
                            y=backtest_results["real_returns"],
                            mode="markers",
                            name="Rendements réalisés",
                            marker=dict(color="green", size=6),
                        )
                    )
                    fig.add_trace(
                        go.Scatter(
                            y=backtest_results["pred_var_95"],
                            mode="lines",
                            name="VaR 95% prédite",
                            line=dict(color="red", dash="dash"),
                        )
                    )
                    fig.update_layout(
                        title="Backtesting : Réalisé vs Prédit",
                        xaxis_title="Fenêtre",
                        yaxis_title="Rendement",
                        hovermode="x unified",
                    )
                    st.plotly_chart(fig, use_container_width=True, key="tab7_backtesting_chart")

                except Exception as e:
                    st.error(f"Backtesting échoué : {e}")

    with tab8:
        st.markdown("## 📊 Dashboard Trading (Style TradingView)")

        try:
            # Récupérer les données OHLCV (données limitées pour performance)
            with st.spinner("Préparation des données..."):
                ticker_data = data_fetcher.fetch_data(ticker, period=params["period"])

            if ticker_data is not None and len(ticker_data) > 0:
                # Limiter aux 252 derniers jours pour performance
                ticker_data = ticker_data.iloc[-252:] if len(ticker_data) > 252 else ticker_data

                prices = ticker_data["Close"] if "Close" in ticker_data.columns else asset["prices"][-252:]
                volumes = ticker_data["Volume"] if "Volume" in ticker_data.columns else pd.Series(
                    np.ones(len(prices)) * prices.mean() * 0.01, index=prices.index
                )

                # Time range selector (comme TradingView)
                col1, col2, col3 = st.columns([1, 2, 1])
                with col1:
                    st.write("**⏱️ Période:**")
                with col2:
                    time_range = st.radio(
                        "Sélectionner la période à afficher",
                        ["1 semaine", "1 mois", "3 mois", "6 mois", "1 an", "Tout"],
                        horizontal=True,
                        label_visibility="collapsed"
                    )

                # Calculer le nombre de jours selon la sélection
                time_range_map = {
                    "1 semaine": 5,
                    "1 mois": 21,
                    "3 mois": 63,
                    "6 mois": 126,
                    "1 an": 252,
                    "Tout": len(ticker_data),
                }
                days_to_display = time_range_map[time_range]

                # Limiter les données à la plage sélectionnée
                ticker_data_filtered = ticker_data.iloc[-days_to_display:] if len(ticker_data) > days_to_display else ticker_data
                prices_filtered = ticker_data_filtered["Close"] if "Close" in ticker_data_filtered.columns else ticker_data_filtered["Close"]
                volumes_filtered = ticker_data_filtered["Volume"] if "Volume" in ticker_data_filtered.columns else pd.Series(
                    np.ones(len(prices_filtered)) * volumes.mean(), index=prices_filtered.index
                )

                st.info(f"📊 Affichage: {len(prices_filtered)} jours de données ({prices_filtered.index[0].strftime('%d/%m/%Y')} à {prices_filtered.index[-1].strftime('%d/%m/%Y')})")

                # Afficher le choix d'affichage
                dash_option = st.radio(
                    "Vue du dashboard",
                    ["Candlesticks + Volume + Profile", "Analyse Orderflow"],
                    horizontal=True
                )

                if dash_option == "Candlesticks + Volume + Profile":
                    st.info("📊 Candlesticks avec volumes + Volume Profile en overlay (voir les niveaux clés avec beaucoup de volume)")
                    with st.spinner("Génération du graphique..."):
                        # Créer le graphique avec volume profile superposé (utilise données filtrées)
                        fig = trading_dashboard.create_candlestick_with_dynamic_profile(prices_filtered, volumes_filtered)
                        st.plotly_chart(fig, use_container_width=True, key="tab8_candlestick_chart")

                    # Intrabar volume profile pour zoom 1 semaine
                    if time_range == "1 semaine" and len(ticker_data_filtered) > 1:
                        st.markdown("### 🔍 Profil de Volume Intrabar")
                        st.caption("Sélectionnez une bougie pour voir où le volume a été échangé")

                        # Créer liste des bougies avec leurs caractéristiques
                        candles_data = []
                        for idx in range(len(ticker_data_filtered)):
                            date = ticker_data_filtered.index[idx].strftime('%d/%m/%Y')
                            close = ticker_data_filtered['Close'].iloc[idx]
                            open_p = ticker_data_filtered['Open'].iloc[idx] if 'Open' in ticker_data_filtered.columns else close
                            high = ticker_data_filtered['High'].iloc[idx] if 'High' in ticker_data_filtered.columns else close
                            low = ticker_data_filtered['Low'].iloc[idx] if 'Low' in ticker_data_filtered.columns else close
                            vol = ticker_data_filtered['Volume'].iloc[idx] if 'Volume' in ticker_data_filtered.columns else volumes_filtered.iloc[idx]

                            direction = "🟢 Hausse" if close >= open_p else "🔴 Baisse"
                            candles_data.append({
                                'label': f"{date} {direction} | C: €{close:.2f}",
                                'idx': idx,
                                'open': open_p,
                                'high': high,
                                'low': low,
                                'close': close,
                                'volume': vol,
                                'date': date
                            })

                        selected_candle_label = st.selectbox(
                            "Choisir une bougie",
                            [c['label'] for c in candles_data],
                            key="intrabar_candle_selector"
                        )

                        selected_candle = next(c for c in candles_data if c['label'] == selected_candle_label)

                        with st.spinner(f"Génération du profil intrabar pour {selected_candle['date']}..."):
                            intrabar_fig = trading_dashboard.create_intrabar_volume_profile_chart(
                                candle_open=selected_candle['open'],
                                candle_high=selected_candle['high'],
                                candle_low=selected_candle['low'],
                                candle_close=selected_candle['close'],
                                total_volume=selected_candle['volume'],
                                candle_date=selected_candle['date']
                            )
                            st.plotly_chart(intrabar_fig, use_container_width=True, key="intrabar_profile_chart")

                elif dash_option == "Analyse Orderflow":
                    st.info("Flux d'ordres simulé avec delta cumulé et imbalance buy/sell")
                    with st.spinner("Génération du flux d'ordres (cela peut prendre quelques secondes)..."):
                        # Générer orderflow avec subdivisions réduites pour perf (utilise données filtrées)
                        orders = orderflow_simulator.generate_orderflow_tape(
                            prices=prices_filtered,
                            volumes=volumes_filtered,
                            n_subdivisions=10,  # Réduit de 20 pour perf
                            seed=params["seed"]
                        )

                        fig = trading_dashboard.create_orderflow_chart(orders, prices=prices_filtered)
                        st.plotly_chart(fig, use_container_width=True, key="tab8_orderflow_chart")

                        # Métriques orderflow
                        col1, col2, col3, col4 = st.columns(4)
                        with col1:
                            st.metric("Ordres total", f"{len(orders):,}")
                        with col2:
                            buy_count = len(orders[orders["side"] == "buy"])
                            st.metric("🟢 Achat", f"{buy_count:,}")
                        with col3:
                            sell_count = len(orders[orders["side"] == "sell"])
                            st.metric("🔴 Vente", f"{sell_count:,}")
                        with col4:
                            final_delta = orders["cumulative_delta"].iloc[-1]
                            st.metric("Delta final", f"{final_delta:,.0f}")

                        # Divergences
                        with st.expander("📊 Détail des divergences"):
                            divergences = orderflow_simulator.detect_orderflow_divergence(
                                prices=prices,
                                cumul_delta=orders["cumulative_delta"]
                            )
                            col1, col2 = st.columns(2)
                            with col1:
                                st.metric("Haussières", divergences["bullish_divergences"])
                            with col2:
                                st.metric("Baissières", divergences["bearish_divergences"])

                # Volume Profile (commun à tous, utilise données filtrées)
                with st.expander("📊 Volume Profile"):
                    price_bins, volume_hist = volume_analysis.compute_volume_profile(prices_filtered, volumes_filtered, n_bins=40)
                    profile_stats = volume_analysis.analyze_volume_profile_extremes(price_bins, volume_hist)

                    col1, col2, col3 = st.columns(3)
                    with col1:
                        st.metric("Point of Control (POC)", f"{profile_stats['point_of_control']:.2f}")
                    with col2:
                        st.metric("Support", f"{profile_stats['support_levels']:.2f}" if profile_stats['support_levels'] else "N/A")
                    with col3:
                        st.metric("Resistance", f"{profile_stats['resistance_levels']:.2f}" if profile_stats['resistance_levels'] else "N/A")

                    fig = trading_dashboard.create_volume_profile_chart(
                        price_bins, volume_hist,
                        poc=profile_stats['point_of_control']
                    )
                    st.plotly_chart(fig, use_container_width=True, key="tab8_volume_profile_chart")
            else:
                st.warning("Données historiques non disponibles pour ce ticker")

        except Exception as e:
            st.error(f"Dashboard Trading échoué : {str(e)}")
            import traceback
            with st.expander("Voir le détail de l'erreur"):
                st.code(traceback.format_exc())

    # Comparaison multi-scénarios
    if params["compare_scenarios"]:
        st.markdown("## 🌪️ Comparaison de scénarios")
        scenarios_results = {}
        for sc_name in scen_module.SCENARIOS.keys():
            mu_s, sig_s = scen_module.apply_scenario(mu_base, sigma_base, sc_name)
            scenarios_results[sc_name] = cached_simulation(
                S0=S0,
                mu=mu_s,
                sigma=sig_s,
                horizon=params["horizon"],
                n_sims=min(params["n_sims"], 3000),
                seed=params["seed"],
                antithetic=params["antithetic"],
            )

        fig = visualizations.plot_scenarios_comparison(scenarios_results, S0)
        st.plotly_chart(fig, use_container_width=True, key="scenarios_comparison")

        rows = []
        for name, p in scenarios_results.items():
            m = risk_metrics.compute_all_metrics(p, S0)
            rows.append(
                {
                    "Scénario": name,
                    "Prix attendu": f"{m['expected_price']:.2f}",
                    "Médiane": f"{m['median_price']:.2f}",
                    "VaR 95%": f"{m['var_95'] * 100:.2f}%",
                    "ES 95%": f"{m['es_95'] * 100:.2f}%",
                    "P(perte)": f"{m['prob_loss'] * 100:.1f}%",
                    "Drawdown moy.": f"{m['avg_max_drawdown'] * 100:.2f}%",
                }
            )
        st.dataframe(pd.DataFrame(rows), use_container_width=True)

    # Export
    st.markdown("## 💾 Export des résultats")
    export_params = {
        "ticker": ticker,
        "S0": S0,
        "mu_used": mu_adj,
        "sigma_used": sigma_adj,
        "horizon_days": params["horizon"],
        "n_sims": params["n_sims"],
        "scenario": params["scenario"],
        "seed": params["seed"],
        "timestamp": datetime.now().isoformat(timespec="seconds"),
    }
    excel_bytes = build_export(paths, metrics, export_params)
    st.download_button(
        "📥 Télécharger les résultats (Excel)",
        data=excel_bytes,
        file_name=f"monte_carlo_{ticker}_{datetime.now():%Y%m%d_%H%M}.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


# --------------------------------------------------------------------------- #
# Mode 2 : Comparaison multi-actifs
# --------------------------------------------------------------------------- #
def run_multi_asset(params: dict):
    """Compare plusieurs actifs sur la même base + optimisation portefeuille."""
    if not params["tickers"]:
        st.warning("Veuillez saisir au moins un ticker.")
        return

    st.markdown("# 📊 Comparaison multi-actifs")

    # Onglets
    tab_comparison, tab_optimization = st.tabs(
        ["Comparaison individuelle", "Optimisation portefeuille"]
    )

    results = {}

    for ticker in params["tickers"][:6]:
        with st.spinner(f"Traitement de {ticker}..."):
            try:
                asset = cached_fetch(ticker, params["period"])
            except Exception as e:
                st.warning(f"⚠️ Échec pour {ticker} : {e}")
                continue

            S0 = asset["last_price"]
            stats = asset["stats"]
            mu_base = stats["mu_annual"]
            sigma_base = stats["sigma_annual"]
            mu_adj, sigma_adj = scen_module.apply_scenario(
                mu_base, sigma_base, params["scenario"]
            )

            paths = cached_simulation(
                S0=S0,
                mu=mu_adj,
                sigma=sigma_adj,
                horizon=params["horizon"],
                n_sims=params["n_sims"],
                seed=params["seed"],
                antithetic=params["antithetic"],
                model=params["model"],
                merton_params=params.get("merton_params"),
                heston_params=params.get("heston_params"),
                log_returns=asset.get("log_returns") if "GARCH" in params["model"] else None,
            )
            results[ticker] = {
                "paths": paths,
                "S0": S0,
                "metrics": risk_metrics.compute_all_metrics(paths, S0),
                "stats": stats,
            }

    if not results:
        st.error("Aucune donnée n'a pu être récupérée.")
        return

    with tab_comparison:
        # Graphique comparatif
        fig = visualizations.plot_multi_asset_comparison(
            {t: {"paths": r["paths"], "S0": r["S0"]} for t, r in results.items()}
        )
        st.plotly_chart(fig, use_container_width=True, key="multi_asset_comparison")

        # Tableau de synthèse
        rows = []
        for ticker, r in results.items():
            m = r["metrics"]
            rows.append(
                {
                    "Ticker": ticker,
                    "Prix initial": f"{r['S0']:.2f}",
                    "μ histo. (an)": f"{r['stats']['mu_annual'] * 100:.2f}%",
                    "σ histo. (an)": f"{r['stats']['sigma_annual'] * 100:.2f}%",
                    "Rendement attendu": f"{m['expected_return'] * 100:.2f}%",
                    "VaR 95%": f"{m['var_95'] * 100:.2f}%",
                    "ES 95%": f"{m['es_95'] * 100:.2f}%",
                    "P(perte)": f"{m['prob_loss'] * 100:.1f}%",
                    "Drawdown moyen": f"{m['avg_max_drawdown'] * 100:.2f}%",
                }
            )
        st.markdown("### 📋 Synthèse")
        st.dataframe(pd.DataFrame(rows), use_container_width=True)

    with tab_optimization:
        st.markdown("### 📊 Optimisation de portefeuille (Markowitz)")

        # Construire la matrice de log-rendements
        log_returns_dict = {}
        S0_dict = {}
        mu_dict = {}
        sigma_dict = {}

        for ticker, res in results.items():
            log_returns_dict[ticker] = pd.Series(
                np.log(res["stats"]["prices"] / res["stats"]["prices"].shift(1)).dropna()
                if "prices" in res["stats"] else np.random.normal(0, 0.02, 100)
            )
            S0_dict[ticker] = res["S0"]
            mu_dict[ticker] = res["stats"]["mu_annual"]
            sigma_dict[ticker] = res["stats"]["sigma_annual"]

        try:
            # Calcul des rendements et covariance
            df_rets = pd.DataFrame(log_returns_dict).dropna()
            mean_returns = df_rets.mean() * 252
            cov_matrix = df_rets.cov() * 252

            # Frontière efficiente
            frontier = optimization.efficient_frontier(
                mean_returns.values, cov_matrix.values, n_points=50
            )

            # Portefeuille Sharpe
            sharpe_port = optimization.sharpe_ratio(
                mean_returns.values, cov_matrix.values
            )

            # Visualiser la frontière
            import plotly.graph_objects as go

            fig = go.Figure()
            fig.add_trace(
                go.Scatter(
                    x=frontier["risks"],
                    y=frontier["returns"],
                    mode="lines",
                    name="Frontière efficiente",
                    line=dict(color="blue", width=2),
                )
            )

            # Marquer le portefeuille Sharpe
            if sharpe_port:
                fig.add_trace(
                    go.Scatter(
                        x=[sharpe_port["risk"]],
                        y=[sharpe_port["return"]],
                        mode="markers",
                        name="Sharpe optimal",
                        marker=dict(color="red", size=15, symbol="star"),
                    )
                )

            # Marquer les actifs individuels
            for ticker in results.keys():
                fig.add_trace(
                    go.Scatter(
                        x=[sigma_dict[ticker]],
                        y=[mu_dict[ticker]],
                        mode="markers+text",
                        name=ticker,
                        text=[ticker],
                        textposition="top center",
                        marker=dict(size=10),
                    )
                )

            fig.update_layout(
                title="Frontière Efficiente (Markowitz)",
                xaxis_title="Risque (σ)",
                yaxis_title="Rendement (μ)",
                hovermode="closest",
                height=600,
            )
            st.plotly_chart(fig, use_container_width=True, key="efficient_frontier")

            # Afficher allocations
            st.markdown("#### Allocations optimales")

            if sharpe_port:
                c1, c2 = st.columns(2)
                with c1:
                    st.metric("Rendement Sharpe", f"{sharpe_port['return'] * 100:.2f}%")
                with c2:
                    st.metric("Risque (σ) Sharpe", f"{sharpe_port['risk'] * 100:.2f}%")

                weights_df = pd.DataFrame(
                    {
                        "Ticker": list(results.keys()),
                        "Poids": sharpe_port["weights"],
                    }
                )
                weights_df["Poids %"] = weights_df["Poids"] * 100
                st.dataframe(
                    weights_df[["Ticker", "Poids %"]].sort_values("Poids %", ascending=False),
                    use_container_width=True,
                )

        except Exception as e:
            st.error(f"Optimisation échouée : {e}")


# --------------------------------------------------------------------------- #
# Navigation & Mode principal
# --------------------------------------------------------------------------- #
def render_main_sidebar():
    """Sidebar principal avec mode de navigation."""
    st.sidebar.markdown("# ⚙️ PARAMÈTRES & MODE")

    # Mode principal
    mode = st.sidebar.radio(
        "Sélectionner un mode",
        ["🎯 Analyser", "📚 Apprendre", "⚙️ Configuration"],
        index=0,
    )

    return mode


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    # Navigation principale
    main_mode = render_main_sidebar()

    # Ajouter le glossaire interactif dans la sidebar
    ui_helpers.glossary_sidebar()

    if main_mode == "📚 Apprendre":
        ui_helpers.create_education_page()

    elif main_mode == "⚙️ Configuration":
        st.title("⚙️ Configuration & Aide")

        col1, col2 = st.columns(2)

        with col1:
            st.markdown("### 📖 Guide rapide")
            st.markdown("""
            1. **Allez en mode Analyser** pour simuler
            2. **Choisissez un actif** (ticker)
            3. **Sélectionnez le modèle** (GBM, Merton, Heston, GARCH)
            4. **Ajustez les paramètres** (μ, σ, horizon)
            5. **Observez l'impact** sur les courbes et métriques
            6. **Allez en mode Apprendre** pour comprendre les concepts
            """)

        with col2:
            st.markdown("### 🎯 Points clés")
            st.success("**Volatilité (σ)** = ampleur des oscillations")
            st.info("**VaR 95%** = perte maximale 95% du temps")
            st.warning("**Drawdown** = recul du pic au creux")
            st.error("**Backtesting** = validation sur le passé")

    else:  # Mode Analyser
        # Header
        st.title("📈 Monte Carlo Simulator v2")
        st.markdown("""
        <div style='background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 1.5rem; border-radius: 12px; color: white; margin-bottom: 2rem;'>
        <h3>🎲 Simulation probabiliste avancée</h3>
        <p>4 modèles • Backtesting • Optimisation Markowitz • Explication pédagogique</p>
        </div>
        """, unsafe_allow_html=True)

        # Paramètres
        params = render_sidebar()

        # Mode d'analyse
        if params["mode"] == "Actif unique":
            run_single_asset(params)
        else:
            run_multi_asset(params)

        # Footer éducatif
        st.markdown("---")
        col1, col2, col3 = st.columns(3)

        with col1:
            st.markdown("**💡 Astuce**")
            st.caption("Cliquez sur 'Glossaire interactif' en bas de la sidebar pour apprendre")

        with col2:
            st.markdown("**⚠️ Avertissement**")
            st.caption("Outil pédagogique, pas un conseil en investissement")

        with col3:
            st.markdown("**🔗 Mode Apprendre**")
            st.caption("Consultez le mode 'Apprendre' pour approfondir chaque concept")


if __name__ == "__main__":
    main()
