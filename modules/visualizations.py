"""
visualizations.py
-----------------
Tous les graphiques Plotly de l'application.

Chaque fonction retourne un objet Figure prêt à être passé à
`st.plotly_chart`. Les graphiques sont volontairement échantillonnés
pour rester fluides même avec 10 000 simulations.
"""

from __future__ import annotations

import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from . import risk_metrics

# Palette professionnelle (compatible dark/light)
COLORS = {
    "primary": "#2E86AB",
    "secondary": "#A23B72",
    "success": "#06A77D",
    "warning": "#F18F01",
    "danger": "#C73E1D",
    "neutral": "#6C757D",
    "p5": "#C73E1D",
    "p50": "#2E86AB",
    "p95": "#06A77D",
}


# --------------------------------------------------------------------------- #
# 1. Trajectoires simulées
# --------------------------------------------------------------------------- #
def plot_simulation_paths(
    paths: np.ndarray,
    S0: float,
    n_display: int = 200,
    show_percentiles: bool = True,
    title: str = "Trajectoires Monte Carlo",
) -> go.Figure:
    """
    Affiche un sous-échantillon de trajectoires + courbes de percentiles.

    n_display : nombre maximum de trajectoires affichées (sinon illisible).
    """
    n_sims, n_steps = paths.shape
    days = np.arange(n_steps)

    fig = go.Figure()

    # Échantillon de trajectoires (gris translucide)
    idx = np.random.choice(n_sims, size=min(n_display, n_sims), replace=False)
    for i in idx:
        fig.add_trace(
            go.Scatter(
                x=days,
                y=paths[i],
                mode="lines",
                line=dict(width=0.5, color="rgba(100, 100, 100, 0.15)"),
                showlegend=False,
                hoverinfo="skip",
            )
        )

    if show_percentiles:
        pcts = risk_metrics.percentile_paths(paths, percentiles=(5, 50, 95))

        # Bande p5-p95
        fig.add_trace(
            go.Scatter(
                x=np.concatenate([days, days[::-1]]),
                y=np.concatenate([pcts[95], pcts[5][::-1]]),
                fill="toself",
                fillcolor="rgba(46, 134, 171, 0.15)",
                line=dict(color="rgba(0,0,0,0)"),
                name="Intervalle 90%",
                hoverinfo="skip",
            )
        )

        # Médiane
        fig.add_trace(
            go.Scatter(
                x=days,
                y=pcts[50],
                mode="lines",
                line=dict(color=COLORS["p50"], width=2.5),
                name="Médiane (P50)",
            )
        )

        # P5 et P95 avec annotations de pourcentage
        final_p5 = pcts[5][-1]
        final_p95 = pcts[95][-1]
        chg_p5 = (final_p5 - S0) / S0 * 100
        chg_p95 = (final_p95 - S0) / S0 * 100

        fig.add_trace(
            go.Scatter(
                x=days,
                y=pcts[5],
                mode="lines",
                line=dict(color=COLORS["p5"], width=1.8, dash="dash"),
                name=f"P5: {final_p5:.2f}€ ({chg_p5:+.1f}%)",
            )
        )
        fig.add_trace(
            go.Scatter(
                x=days,
                y=pcts[95],
                mode="lines",
                line=dict(color=COLORS["p95"], width=1.8, dash="dash"),
                name=f"P95: {final_p95:.2f}€ ({chg_p95:+.1f}%)",
            )
        )

        # Ajouter annotations aux extrémités des courbes
        final_day = n_steps - 1
        fig.add_annotation(
            x=final_day, y=final_p5,
            text=f"P5<br>{chg_p5:.1f}%",
            showarrow=True,
            arrowhead=2,
            arrowsize=1,
            arrowwidth=2,
            arrowcolor=COLORS["p5"],
            ax=40,
            ay=-40,
            bgcolor="rgba(199, 62, 29, 0.7)",
            bordercolor=COLORS["p5"],
            borderwidth=1,
            font=dict(color="white", size=10),
        )

        fig.add_annotation(
            x=final_day, y=final_p95,
            text=f"P95<br>{chg_p95:+.1f}%",
            showarrow=True,
            arrowhead=2,
            arrowsize=1,
            arrowwidth=2,
            arrowcolor=COLORS["p95"],
            ax=40,
            ay=40,
            bgcolor="rgba(6, 167, 125, 0.7)",
            bordercolor=COLORS["p95"],
            borderwidth=1,
            font=dict(color="white", size=10),
        )

    # Ligne du prix initial
    fig.add_hline(
        y=S0,
        line=dict(color=COLORS["neutral"], width=1.5, dash="dot"),
        annotation_text=f"Prix initial : {S0:.2f}",
        annotation_position="top left",
    )

    fig.update_layout(
        title=title,
        xaxis_title="Jours de bourse",
        yaxis_title="Prix simulé",
        hovermode="x unified",
        template="plotly_white",
        height=520,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0),
    )
    return fig


# --------------------------------------------------------------------------- #
# 2. Histogramme des prix finaux
# --------------------------------------------------------------------------- #
def plot_final_distribution(
    paths: np.ndarray, S0: float, var_alpha: float = 0.05
) -> go.Figure:
    """
    Histogramme des prix finaux avec zones colorées et explications.

    Zones:
    - ROUGE: Perte (prix < S0)
    - BLEU: Gain faible (S0 à médiane)
    - VERT: Gain fort (> médiane)
    """
    final_prices = paths[:, -1]
    var_threshold = np.percentile(final_prices, var_alpha * 100)
    median_price = np.median(final_prices)
    prob_loss = (final_prices < S0).mean() * 100

    fig = go.Figure()

    fig.add_trace(
        go.Histogram(
            x=final_prices,
            nbinsx=80,
            marker=dict(
                color=COLORS["primary"],
                line=dict(color="white", width=0.5),
            ),
            name="Distribution des prix",
            hovertemplate="Prix: €%{x:.2f}<br>Fréquence: %{y} simulations<extra></extra>",
        )
    )

    # Zones coloriées
    # Zone 1: Perte (rouge)
    fig.add_vrect(
        x0=final_prices.min(),
        x1=S0,
        fillcolor=COLORS["danger"],
        opacity=0.15,
        line_width=2,
        line_color=COLORS["danger"],
        annotation_text=f"<b>🔴 PERTE</b><br>{prob_loss:.1f}% des cas<br>Perte max: €{(final_prices.min()-S0):.2f}",
        annotation_position="top left",
        annotation_font_size=11,
        annotation_bgcolor="rgba(199, 62, 29, 0.8)",
    )

    # Zone 2: Gain faible (bleu)
    fig.add_vrect(
        x0=S0,
        x1=median_price,
        fillcolor=COLORS["primary"],
        opacity=0.08,
        line_width=0,
        annotation_text=f"<b>🔵 Gain faible</b><br>0% à {((median_price-S0)/S0*100):.1f}%",
        annotation_position="top right",
        annotation_font_size=10,
        annotation_bgcolor="rgba(46, 134, 171, 0.6)",
    )

    # Zone 3: Gain fort (vert)
    fig.add_vrect(
        x0=median_price,
        x1=final_prices.max(),
        fillcolor=COLORS["success"],
        opacity=0.08,
        line_width=0,
        annotation_text=f"<b>🟢 Gain fort</b><br>> {((median_price-S0)/S0*100):.1f}%<br>Gain max: €{(final_prices.max()-S0):.2f}",
        annotation_position="top right",
        annotation_font_size=10,
        annotation_bgcolor="rgba(6, 167, 125, 0.6)",
    )

    # Lignes verticales clés
    fig.add_vline(
        x=S0,
        line=dict(color="black", width=2),
        annotation_text=f"<b>Prix initial</b><br>€{S0:.2f}",
        annotation_position="top",
        annotation_bgcolor="rgba(0,0,0,0.7)",
        annotation_font_color="white",
    )

    fig.add_vline(
        x=median_price,
        line=dict(color=COLORS["p50"], width=2.5),
        annotation_text=f"<b>Médiane (50%)</b><br>€{median_price:.2f}<br>{((median_price-S0)/S0*100):+.1f}%",
        annotation_position="bottom",
        annotation_bgcolor=f"rgba({int(46*0.8)}, {int(134*0.8)}, {int(171*0.8)}, 0.7)",
        annotation_font_color="white",
    )

    fig.add_vline(
        x=var_threshold,
        line=dict(color=COLORS["danger"], width=1.5, dash="dash"),
        annotation_text=f"<b>VaR 95%</b><br>€{var_threshold:.2f}",
        annotation_position="bottom",
        annotation_xanchor="left",
    )

    fig.update_layout(
        title="Distribution des Prix Finaux — Analyse des Zones de Profit/Perte",
        xaxis_title="Prix final simulé (€)",
        yaxis_title="Nombre de simulations",
        template="plotly_white",
        height=550,
        bargap=0.02,
        hovermode="x unified",
        font=dict(size=11),
    )
    return fig


# --------------------------------------------------------------------------- #
# 3. Distribution des rendements
# --------------------------------------------------------------------------- #
def plot_return_distribution(paths: np.ndarray, S0: float) -> go.Figure:
    """
    Distribution des rendements totaux avec zones claires et métriques de risque.

    Zones:
    - ROUGE: Perte (rendement < 0%)
    - BLEU: Gain modéré (0% à médiane)
    - VERT: Gain important (> médiane)
    """
    returns = (paths[:, -1] - S0) / S0 * 100
    var_95 = np.percentile(returns, 5)
    es_95 = returns[returns <= var_95].mean() if (returns <= var_95).any() else var_95
    median_return = np.median(returns)
    prob_loss = (returns < 0).mean() * 100

    fig = go.Figure()
    fig.add_trace(
        go.Histogram(
            x=returns,
            nbinsx=80,
            marker=dict(
                color=COLORS["secondary"],
                line=dict(color="white", width=0.5),
            ),
            name="Distribution des rendements",
            hovertemplate="Rendement: %{x:.1f}%<br>Fréquence: %{y} simulations<extra></extra>",
        )
    )

    # Zone PERTE (rouge)
    fig.add_vrect(
        x0=returns.min() - 5,
        x1=0,
        fillcolor=COLORS["danger"],
        opacity=0.15,
        line_width=2,
        line_color=COLORS["danger"],
        annotation_text=f"<b>🔴 PERTE</b><br>{prob_loss:.1f}% des cas<br>Perte max: {returns.min():.1f}%",
        annotation_position="top left",
        annotation_font_size=11,
        annotation_bgcolor="rgba(199, 62, 29, 0.8)",
        annotation_font_color="white",
    )

    # Zone GAIN MODÉRÉ (bleu)
    fig.add_vrect(
        x0=0,
        x1=median_return,
        fillcolor=COLORS["primary"],
        opacity=0.08,
        line_width=0,
        annotation_text=f"<b>🔵 Gain modéré</b><br>0% à {median_return:.1f}%<br>50% des cas",
        annotation_position="top left",
        annotation_font_size=10,
        annotation_bgcolor="rgba(46, 134, 171, 0.6)",
        annotation_font_color="white",
    )

    # Zone GAIN IMPORTANT (vert)
    fig.add_vrect(
        x0=median_return,
        x1=returns.max() + 5,
        fillcolor=COLORS["success"],
        opacity=0.08,
        line_width=0,
        annotation_text=f"<b>🟢 Gain important</b><br>> {median_return:.1f}%<br>Gain max: {returns.max():.1f}%",
        annotation_position="top right",
        annotation_font_size=10,
        annotation_bgcolor="rgba(6, 167, 125, 0.6)",
        annotation_font_color="white",
    )

    # Ligne 0 (break-even)
    fig.add_vline(
        x=0,
        line=dict(color="black", width=2),
        annotation_text="<b>Point mort</b><br>(0% rendement)",
        annotation_position="top",
        annotation_bgcolor="rgba(0,0,0,0.7)",
        annotation_font_color="white",
    )

    # Médiane (rendement attendu)
    fig.add_vline(
        x=median_return,
        line=dict(color=COLORS["p50"], width=2.5),
        annotation_text=f"<b>Rendement médian</b><br>{median_return:+.1f}%<br>Scénario 50/50",
        annotation_position="bottom",
        annotation_bgcolor=f"rgba({int(46*0.8)}, {int(134*0.8)}, {int(171*0.8)}, 0.7)",
        annotation_font_color="white",
    )

    # VaR 95% (pire 5%)
    fig.add_vline(
        x=var_95,
        line=dict(color=COLORS["danger"], width=2, dash="dash"),
        annotation_text=f"<b>VaR 95%</b><br>Pire 5% des cas<br>{var_95:.1f}%",
        annotation_position="bottom",
        annotation_xanchor="right",
        annotation_bgcolor="rgba(199, 62, 29, 0.7)",
        annotation_font_color="white",
    )

    # Expected Shortfall (moyenne du pire 5%)
    fig.add_vline(
        x=es_95,
        line=dict(color=COLORS["warning"], width=1.5, dash="dot"),
        annotation_text=f"<b>ES 95%</b><br>(Perte moyenne)<br>{es_95:.1f}%",
        annotation_position="bottom",
        annotation_xanchor="left",
        annotation_bgcolor="rgba(241, 143, 1, 0.7)",
        annotation_font_color="white",
    )

    fig.update_layout(
        title="Distribution des Rendements (%) — Analyse Risque/Gain",
        xaxis_title="Rendement total (%)",
        yaxis_title="Nombre de simulations",
        template="plotly_white",
        height=550,
        bargap=0.02,
        hovermode="x unified",
        font=dict(size=11),
        showlegend=False,
    )
    return fig


# --------------------------------------------------------------------------- #
# 4. Comparaison multi-actifs
# --------------------------------------------------------------------------- #
def plot_multi_asset_comparison(results: dict) -> go.Figure:
    """
    Compare les courbes de médianes de plusieurs actifs sur un même graphique.

    Parameters
    ----------
    results : dict {ticker: {'paths': ndarray, 'S0': float}}
    """
    fig = go.Figure()
    palette = [
        "#2E86AB",
        "#A23B72",
        "#06A77D",
        "#F18F01",
        "#C73E1D",
        "#6C757D",
    ]

    for i, (ticker, data) in enumerate(results.items()):
        paths = data["paths"]
        S0 = data["S0"]

        # Normalisation à 100 pour comparer des actifs de prix très différents
        paths_norm = paths / S0 * 100
        days = np.arange(paths_norm.shape[1])

        median = np.median(paths_norm, axis=0)
        p5 = np.percentile(paths_norm, 5, axis=0)
        p95 = np.percentile(paths_norm, 95, axis=0)

        color = palette[i % len(palette)]

        # Bande p5-p95
        fig.add_trace(
            go.Scatter(
                x=np.concatenate([days, days[::-1]]),
                y=np.concatenate([p95, p5[::-1]]),
                fill="toself",
                fillcolor=f"rgba({int(color[1:3], 16)}, {int(color[3:5], 16)}, {int(color[5:7], 16)}, 0.12)",
                line=dict(color="rgba(0,0,0,0)"),
                showlegend=False,
                hoverinfo="skip",
            )
        )

        # Médiane
        fig.add_trace(
            go.Scatter(
                x=days,
                y=median,
                mode="lines",
                line=dict(color=color, width=2.5),
                name=ticker,
            )
        )

    fig.add_hline(
        y=100,
        line=dict(color="gray", width=1, dash="dot"),
        annotation_text="Base 100",
    )

    fig.update_layout(
        title="Comparaison multi-actifs (base 100, médianes + intervalle 90%)",
        xaxis_title="Jours de bourse",
        yaxis_title="Prix normalisé (base 100)",
        template="plotly_white",
        height=500,
        hovermode="x unified",
    )
    return fig


# --------------------------------------------------------------------------- #
# 5. Comparaison de scénarios
# --------------------------------------------------------------------------- #
def plot_scenarios_comparison(scenarios_results: dict, S0: float) -> go.Figure:
    """
    Affiche les distributions de prix finaux pour chaque scénario en violons.

    scenarios_results : dict {scenario_name: paths (ndarray)}
    """
    fig = go.Figure()
    palette = ["#2E86AB", "#06A77D", "#F18F01", "#C73E1D", "#A23B72"]

    for i, (name, paths) in enumerate(scenarios_results.items()):
        final_prices = paths[:, -1]
        fig.add_trace(
            go.Violin(
                y=final_prices,
                name=name,
                box_visible=True,
                meanline_visible=True,
                fillcolor=palette[i % len(palette)],
                opacity=0.6,
                line_color=palette[i % len(palette)],
            )
        )

    fig.add_hline(
        y=S0,
        line=dict(color="black", width=1.5, dash="dot"),
        annotation_text=f"Prix initial = {S0:.2f}",
    )

    fig.update_layout(
        title="Distribution des prix finaux par scénario",
        yaxis_title="Prix final",
        template="plotly_white",
        height=500,
    )
    return fig


# --------------------------------------------------------------------------- #
# 6. Heatmap de probabilités dans le temps
# --------------------------------------------------------------------------- #
def plot_probability_density_heatmap(paths: np.ndarray, S0: float, title: str = "Densité Probabiliste — Heatmap des Prix Futurs") -> go.Figure:
    """
    Crée une heatmap de densité style trading professionnel.

    Montre la probabilité d'être à chaque prix à chaque moment.
    Les zones chaudes (rouges) = probabilité élevée
    Les zones froides (blues) = probabilité basse

    Surposition:
    - Ligne bleue: Trajectoire moyenne (scénario 50%)
    - Tirets verts: P5 (95% de chances d'être au-dessus)
    - Tirets rouges: P95 (95% de chances d'être en-dessous)
    """
    n_sims, n_steps = paths.shape

    # Grille de prix et temps
    price_min = paths.min()
    price_max = paths.max()
    price_grid = np.linspace(price_min, price_max, 100)
    time_grid = np.arange(0, n_steps)

    # Matrice de densité - optimisée avec sampling
    density = np.zeros((len(price_grid) - 1, len(time_grid) - 1))
    sample_step = max(1, n_sims // 2000)  # Limiter pour perf

    for t_idx in range(len(time_grid) - 1):
        for s in range(0, n_sims, sample_step):
            prices_at_t = paths[s, time_grid[t_idx]:time_grid[t_idx + 1]]
            counts, _ = np.histogram(prices_at_t, bins=price_grid)
            density[:len(counts), t_idx] += counts

    # Normaliser
    density = density / (n_sims / sample_step + 1e-6)

    # Créer la heatmap
    fig = go.Figure(data=go.Heatmap(
        z=density.T,
        x=price_grid[:-1],
        y=time_grid[:-1],
        colorscale="RdYlBu_r",  # Rouge (chaud) = haute probabilité, Bleu (froid) = basse
        colorbar=dict(
            title="Densité<br>Probabiliste",
            thickness=15,
            len=0.7,
        ),
        hovertemplate="<b>Prix: €%{x:.2f}</b><br><b>Jour: %{y:.0f}</b><br><b>Densité: %{z:.3f}</b><extra></extra>",
        name="Densité",
    ))

    # Trajectoire moyenne (50%)
    mean_path = np.mean(paths, axis=0)
    fig.add_trace(go.Scatter(
        x=mean_path,
        y=np.arange(n_steps),
        mode="lines",
        name="Scénario moyen (50%)",
        line=dict(color="cyan", width=3),
        hovertemplate="<b>Jour %{y:.0f}</b><br>Prix attendu: €%{x:.2f}<extra></extra>",
    ))

    # Percentiles P5 et P95
    p5 = np.percentile(paths, 5, axis=0)
    p95 = np.percentile(paths, 95, axis=0)

    fig.add_trace(go.Scatter(
        x=p5,
        y=np.arange(n_steps),
        mode="lines",
        name="P5 - Scénario bas (5% de chances de descendre plus)",
        line=dict(color="lime", dash="dash", width=2),
        hovertemplate="<b>Jour %{y:.0f}</b><br>Limite basse: €%{x:.2f}<br>(95% au-dessus)<extra></extra>",
    ))

    fig.add_trace(go.Scatter(
        x=p95,
        y=np.arange(n_steps),
        mode="lines",
        name="P95 - Scénario haut (5% de chances de monter plus)",
        line=dict(color="red", dash="dash", width=2),
        hovertemplate="<b>Jour %{y:.0f}</b><br>Limite haute: €%{x:.2f}<br>(95% en-dessous)<extra></extra>",
    ))

    # Ligne du prix initial
    fig.add_hline(
        y=0,
        line=dict(color="white", width=1.5, dash="dot"),
        annotation_text=f"<b>Prix initial: €{S0:.2f}</b>",
        annotation_position="right",
        annotation_bgcolor="rgba(0,0,0,0.7)",
        annotation_font_color="white",
    )

    fig.update_layout(
        title=title + f"<br><sub>Gamme de prix: €{price_min:.2f} à €{price_max:.2f} | Variance: €{price_max-price_min:.2f}</sub>",
        xaxis_title="Prix simulé (€)",
        yaxis_title="Jours de bourse",
        template="plotly_dark",
        height=700,
        hovermode="closest",
        legend=dict(
            x=0.02, y=0.98,
            bgcolor="rgba(0,0,0,0.7)",
            bordercolor="white",
            borderwidth=1,
        ),
    )

    # Ajouter une annotation explicative
    fig.add_annotation(
        text="<b>Comment lire cette heatmap:</b><br>" +
             "🔴 Zones rouges = Probabilité ÉLEVÉE d'être à ce prix<br>" +
             "🟡 Zones jaunes = Probabilité MOYENNE<br>" +
             "🔵 Zones bleues = Probabilité BASSE<br><br>" +
             "Les courbes montrent les scénarios 50%, 5% et 95%",
        xref="paper", yref="paper",
        x=0.02, y=-0.12,
        showarrow=False,
        bgcolor="rgba(0,0,0,0.5)",
        bordercolor="white",
        borderwidth=1,
        font=dict(color="white", size=10),
        align="left",
        xanchor="left",
        yanchor="top",
    )

    return fig


def plot_probability_heatmap(paths: np.ndarray, S0: float) -> go.Figure:
    """
    Heatmap : probabilité d'atteindre chaque niveau de prix à chaque date.
    Donne une vision intuitive de la dispersion temporelle.
    """
    n_sims, n_steps = paths.shape

    # Bornes : on couvre les 99% centraux
    p_min = np.percentile(paths, 0.5)
    p_max = np.percentile(paths, 99.5)
    n_bins = 60
    bins = np.linspace(p_min, p_max, n_bins + 1)

    heatmap = np.zeros((n_bins, n_steps))
    for t in range(n_steps):
        hist, _ = np.histogram(paths[:, t], bins=bins)
        heatmap[:, t] = hist / n_sims  # densité

    fig = go.Figure(
        data=go.Heatmap(
            z=heatmap,
            x=np.arange(n_steps),
            y=(bins[:-1] + bins[1:]) / 2,
            colorscale="Viridis",
            colorbar=dict(title="Densité"),
        )
    )

    fig.add_hline(
        y=S0,
        line=dict(color="white", width=2, dash="dot"),
        annotation_text="S₀",
        annotation_font_color="white",
    )

    fig.update_layout(
        title="Densité de probabilité dans le temps",
        xaxis_title="Jours",
        yaxis_title="Prix",
        template="plotly_white",
        height=460,
    )
    return fig
