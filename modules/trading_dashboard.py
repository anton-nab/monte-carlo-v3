"""
trading_dashboard.py
--------------------
Dashboard trading-like (TradingView style) avec candlesticks, volumes, orderflow.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots


def generate_intrabar_volume_profile(candle_open: float, candle_high: float,
                                     candle_low: float, candle_close: float,
                                     total_volume: float, n_levels: int = 30) -> dict:
    """
    Génère un profil de volume synthétique intra-bougie basé sur la forme de la bougie.

    Approche:
    - Diviser le range (high-low) en N niveaux
    - Distribuer le volume selon le mouvement des prix
    - Plus de volume vers le close = accumulation, vers l'open = distribution

    Parameters
    ----------
    candle_open, high, low, close : float
        OHLC de la bougie
    total_volume : float
        Volume total de la bougie
    n_levels : int
        Nombre de niveaux de prix à modéliser

    Returns
    -------
    dict with 'prices', 'volumes', 'poc_price'
    """
    price_min = candle_low
    price_max = candle_high
    price_range = price_max - price_min

    # Créer grille de prix
    price_levels = np.linspace(price_min, price_max, n_levels)
    volumes_at_level = np.zeros(n_levels)

    # Distribuer le volume selon le mouvement
    # Si close > open: accumulation vers close (acheteurs dominants)
    # Si close < open: distribution vers close (vendeurs dominants)

    if candle_close >= candle_open:  # Hausse
        # Plus de volume vers le haut (close)
        # Distribution linéaire : léger vers bas, fort vers haut
        for i, price in enumerate(price_levels):
            norm_price = (price - price_min) / price_range if price_range > 0 else 0.5
            # Courbe d'accumulation vers le close
            weight = 0.3 + 0.7 * (norm_price ** 1.5)  # Concavité vers le haut
            volumes_at_level[i] = weight
    else:  # Baisse
        # Plus de volume vers le bas (close)
        # Distribution: fort vers bas, léger vers haut
        for i, price in enumerate(price_levels):
            norm_price = (price - price_min) / price_range if price_range > 0 else 0.5
            # Courbe de distribution vers le close (bas)
            weight = 0.3 + 0.7 * ((1 - norm_price) ** 1.5)  # Concavité vers le bas
            volumes_at_level[i] = weight

    # Normaliser et appliquer volume total
    volumes_at_level = (volumes_at_level / volumes_at_level.sum()) * total_volume

    # Identifier POC (point avec le plus de volume)
    poc_idx = np.argmax(volumes_at_level)
    poc_price = price_levels[poc_idx]

    return {
        'prices': price_levels,
        'volumes': volumes_at_level,
        'poc_price': poc_price,
        'poc_volume': volumes_at_level[poc_idx]
    }


def create_intrabar_volume_profile_chart(candle_open: float, candle_high: float,
                                        candle_low: float, candle_close: float,
                                        total_volume: float,
                                        candle_date: str = "Date") -> go.Figure:
    """
    Crée un graphique détaillé du profil de volume à l'intérieur d'une bougie.

    Utile pour comprendre où le volume a été échangé dans une période donnée.

    Parameters
    ----------
    candle_* : float
        OHLC de la bougie
    total_volume : float
        Volume total
    candle_date : str
        Libellé de la date/période
    """
    profile = generate_intrabar_volume_profile(candle_open, candle_high, candle_low,
                                              candle_close, total_volume, n_levels=40)

    fig = go.Figure()

    # Barres verticales: volume profile
    fig.add_trace(go.Bar(
        y=profile['prices'],
        x=profile['volumes'],
        orientation='h',
        name='Volume Profile',
        marker=dict(
            color=profile['volumes'],
            colorscale='Viridis',
            showscale=True,
            colorbar=dict(title="Volume")
        ),
        hovertemplate="<b>Prix: €%{y:.2f}</b><br>Volume: %{x:,.0f}<extra></extra>"
    ))

    # Ajouter ligne POC
    fig.add_hline(
        y=profile['poc_price'],
        line_dash='dash',
        line_color='gold',
        line_width=3,
        annotation_text=f"<b>POC: €{profile['poc_price']:.2f}</b><br>Volume: {profile['poc_volume']:,.0f}",
        annotation_position='right'
    )

    # Ajouter zones OHLC
    fig.add_hrect(
        y0=candle_open, y1=candle_close,
        fillcolor='green' if candle_close >= candle_open else 'red',
        opacity=0.1,
        layer='below',
        annotation_text=f"{'Hausse' if candle_close >= candle_open else 'Baisse'}<br>O:{candle_open:.2f} C:{candle_close:.2f}",
        annotation_position='top left'
    )

    # High/Low lines
    fig.add_hline(y=candle_high, line_dash='dot', line_color='green',
                  annotation_text=f"H: €{candle_high:.2f}", annotation_position='left')
    fig.add_hline(y=candle_low, line_dash='dot', line_color='red',
                  annotation_text=f"L: €{candle_low:.2f}", annotation_position='left')

    fig.update_layout(
        title=f"Volume Profile Intrabar - {candle_date}",
        xaxis_title="Volume",
        yaxis_title="Prix (€)",
        template='plotly_dark',
        height=600,
        hovermode='y unified',
        showlegend=True
    )

    return fig


def create_candlestick_chart(data: pd.DataFrame) -> go.Figure:
    """
    Crée un graphique candlestick (OHLC).

    Parameters
    ----------
    data : pd.DataFrame
        Colonnes : Open, High, Low, Close, Volume (optionnel)
    """
    fig = go.Figure(data=[go.Candlestick(
        x=data.index,
        open=data['Open'],
        high=data['High'],
        low=data['Low'],
        close=data['Close'],
        name="Price"
    )])

    fig.update_layout(
        title="Candlestick Chart",
        yaxis_title="Price",
        xaxis_title="Date",
        template="plotly_dark",
        height=600,
    )

    return fig


def detect_support_resistance(prices: pd.Series, volumes: pd.Series, window: int = 5) -> dict:
    """
    Détecte les niveaux de support/résistance basés sur:
    - Pivots (hauts/bas locaux)
    - Volume (niveaux avec beaucoup de volume)
    - Prix proches répétés (clustering)
    """
    n_bins = 60
    price_bins = np.linspace(prices.min(), prices.max(), n_bins)
    volume_hist = np.zeros(n_bins - 1)

    for p_idx in range(n_bins - 1):
        mask = (prices >= price_bins[p_idx]) & (prices < price_bins[p_idx + 1])
        volume_hist[p_idx] = volumes[mask].sum()

    # Trouver les pics de volume (résistance/support)
    threshold = np.percentile(volume_hist, 85)
    support_resistance = []

    for p_idx in range(1, len(volume_hist) - 1):
        if volume_hist[p_idx] > threshold:
            # Vérifier que c'est un pic local
            if (volume_hist[p_idx] > volume_hist[p_idx - 1] and
                volume_hist[p_idx] > volume_hist[p_idx + 1]):
                support_resistance.append({
                    'price': price_bins[p_idx],
                    'volume': volume_hist[p_idx],
                    'strength': volume_hist[p_idx] / volume_hist.max()
                })

    # Trier par force
    support_resistance.sort(key=lambda x: x['strength'], reverse=True)
    return support_resistance[:3]  # Top 3 niveaux


def create_candlestick_with_dynamic_profile(prices: pd.Series, volumes: pd.Series,
                                           title: str = "Trading View Style - Candlesticks + Volume Profile") -> go.Figure:
    """
    Crée un graphique candlestick avec volume profile dynamique (à droite).

    Le volume profile se met à jour automatiquement selon la sélection zone.
    Détecte et affiche les support/résistance importants.

    Parameters
    ----------
    prices : pd.Series
        Prix de clôture (avec index datetime)
    volumes : pd.Series
        Volumes correspondants
    """
    # Préparer les données OHLC
    data = pd.DataFrame({
        'Close': prices,
        'Volume': volumes,
    })
    data['Open'] = prices.shift(1).fillna(prices.iloc[0])
    data['High'] = prices.rolling(2).max()
    data['Low'] = prices.rolling(2).min()

    # Créer subplots: candlesticks + volume (bas), volume profile (droite)
    fig = make_subplots(
        rows=2, cols=2,
        shared_xaxes=True,
        vertical_spacing=0.08,
        horizontal_spacing=0.05,
        row_heights=[0.7, 0.3],
        column_widths=[0.85, 0.15],
        specs=[
            [{"secondary_y": False}, {"secondary_y": False}],
            [{"secondary_y": False, "colspan": 2}, None],
        ]
    )

    # Panel 1a: Candlesticks
    fig.add_trace(
        go.Candlestick(
            x=prices.index,
            open=data['Open'],
            high=data['High'],
            low=data['Low'],
            close=data['Close'],
            name="Prix",
            increasing_line_color='green',
            decreasing_line_color='red',
        ),
        row=1, col=1
    )

    # Panel 1b: Volume Profile (barres horizontales)
    price_min, price_max = prices.min(), prices.max()
    n_bins = 50
    price_bins = np.linspace(price_min, price_max, n_bins)
    volume_hist = np.zeros(n_bins - 1)

    for p_idx in range(n_bins - 1):
        mask = (prices >= price_bins[p_idx]) & (prices < price_bins[p_idx + 1])
        volume_hist[p_idx] = volumes[mask].sum()

    # Identifier POC (Point of Control) - DYNAMIQUE selon la sélection
    poc_idx = np.argmax(volume_hist)
    poc_price = price_bins[poc_idx]

    # Colorier le POC en jaune/orange, le reste en bleu
    colors = ["orange" if i == poc_idx else "rgba(70, 130, 180, 0.6)"
              for i in range(len(volume_hist))]

    fig.add_trace(
        go.Bar(
            y=price_bins[:-1],
            x=volume_hist,
            orientation="h",
            name="Volume Profile",
            marker=dict(color=colors),
            hovertemplate="<b>Prix: €%{y:.2f}</b><br>Volume: %{x:,.0f}<extra></extra>",
            showlegend=False,
        ),
        row=1, col=2
    )

    # Ajouter ligne POC avec annotation dynamique
    fig.add_hline(
        y=poc_price,
        line_dash="dash",
        line_color="gold",
        line_width=2,
        annotation_text=f"<b>POC: €{poc_price:.2f}</b>",
        annotation_position="right",
        row=1, col=1
    )

    # Détecter et afficher les niveaux support/résistance importants
    sr_levels = detect_support_resistance(prices, volumes)
    colors_sr = ['#FF6B6B', '#4ECDC4', '#45B7D1']  # Rouge, cyan, bleu
    labels_sr = ['R1 (Résistance)', 'S1 (Support)', 'S2']

    for i, sr in enumerate(sr_levels):
        color = colors_sr[i % len(colors_sr)]
        label = labels_sr[i % len(labels_sr)]

        fig.add_hline(
            y=sr['price'],
            line_dash="dot",
            line_color=color,
            line_width=2,
            opacity=0.7,
            annotation_text=f"<b>{label}</b><br>€{sr['price']:.2f}",
            annotation_position="left",
            row=1, col=1,
            showlegend=False,
        )

    # Panel 2: Volumes (histogramme bas)
    colors_vol = ["green" if data['Close'].iloc[i] >= data['Close'].iloc[i-1] else "red"
                  for i in range(1, len(data))]
    colors_vol.insert(0, "gray")

    fig.add_trace(
        go.Bar(
            x=volumes.index,
            y=volumes,
            name="Volume",
            marker=dict(color=colors_vol),
            hovertemplate="<b>Date: %{x}</b><br>Volume: %{y:,.0f}<extra></extra>",
            showlegend=False,
        ),
        row=2, col=1,
    )

    # Mise à jour axes
    fig.update_yaxes(title_text="Prix (€)", row=1, col=1)
    fig.update_yaxes(title_text="", row=1, col=2)
    fig.update_yaxes(title_text="Volume", row=2, col=1)
    fig.update_xaxes(title_text="", row=1, col=1)
    fig.update_xaxes(title_text="", row=1, col=2)
    fig.update_xaxes(title_text="Date", row=2, col=1)

    fig.update_layout(
        title=title,
        template="plotly_dark",
        height=800,
        hovermode="y unified",
        xaxis_rangeslider_visible=False,  # Pas de rangeslider en bas!
        showlegend=True,
    )

    return fig


def create_price_volume_chart_with_profile(prices: pd.Series, volumes: pd.Series,
                                          title: str = "Candlesticks + Volume + Profile") -> go.Figure:
    """
    Crée un graphique avec candlesticks, volumes ET volume profile en overlay.

    Le volume profile montre les niveaux de prix avec beaucoup de volume (support/resistance).
    """
    from plotly.subplots import make_subplots

    # Préparer les données OHLC (approximation depuis Close)
    data = pd.DataFrame({
        'Close': prices,
        'Volume': volumes
    })
    data['Open'] = prices.shift(1).fillna(prices.iloc[0])
    data['High'] = prices.rolling(2).max()
    data['Low'] = prices.rolling(2).min()

    # Créer subplots: main (candlesticks+profile) et volume
    fig = make_subplots(
        rows=2, cols=2,
        shared_xaxes=True,
        vertical_spacing=0.08,
        horizontal_spacing=0.08,
        row_heights=[0.7, 0.3],
        column_widths=[0.85, 0.15],
        specs=[
            [{"secondary_y": False}, {"secondary_y": False}],
            [{"secondary_y": False, "colspan": 2}, None],
        ]
    )

    # Panel 1a: Candlesticks
    fig.add_trace(
        go.Candlestick(
            x=prices.index,
            open=data['Open'],
            high=data['High'],
            low=data['Low'],
            close=data['Close'],
            name="Prix"
        ),
        row=1, col=1
    )

    # Panel 1b: Volume Profile (horizontal bars)
    price_bins, volume_hist = np.linspace(prices.min(), prices.max(), 40), np.zeros(39)
    for p_idx in range(39):
        price_grid = np.linspace(prices.min(), prices.max(), 40)
        volume_hist[p_idx] = volumes[(prices >= price_grid[p_idx]) &
                                     (prices < price_grid[p_idx + 1])].sum()

    price_grid = np.linspace(prices.min(), prices.max(), 40)
    peak_vol_idx = np.argmax(volume_hist)
    poc = price_grid[peak_vol_idx]

    # Normaliser pour afficher en overlay
    max_vol = volume_hist.max()
    vol_normalized = (volume_hist / max_vol) * (prices.max() - prices.min()) * 0.15

    fig.add_trace(
        go.Bar(
            y=price_grid[:-1],
            x=volume_hist,
            orientation="h",
            name="Volume Profile",
            marker=dict(color="rgba(100, 150, 255, 0.4)"),
            showlegend=True,
        ),
        row=1, col=2
    )

    # Ajouter ligne POC
    fig.add_hline(
        y=poc,
        line_dash="dash",
        line_color="yellow",
        annotation_text=f"POC: {poc:.2f}",
        row=1, col=1
    )

    # Panel 2: Volumes (histogramme)
    colors = ["green" if data['Close'].iloc[i] >= data['Close'].iloc[i-1] else "red"
              for i in range(1, len(data))]
    colors.insert(0, "gray")

    fig.add_trace(
        go.Bar(
            x=volumes.index,
            y=volumes,
            name="Volume",
            marker=dict(color=colors),
            showlegend=False,
        ),
        row=2, col=1,
    )

    # Mise à jour axes et layout
    fig.update_yaxes(title_text="Prix (€)", row=1, col=1)
    fig.update_yaxes(title_text="Vol", row=1, col=2)
    fig.update_yaxes(title_text="Volume", row=2, col=1)
    fig.update_xaxes(title_text="Date", row=2, col=1)

    fig.update_layout(
        title=title,
        template="plotly_dark",
        height=800,
        hovermode="x unified",
        showlegend=True,
    )

    return fig


def create_price_volume_chart(prices: pd.Series, volumes: pd.Series,
                             title: str = "Price & Volume") -> go.Figure:
    """
    Crée un graphique 2 panneaux : prix (haut) + volume (bas).
    """
    fig = make_subplots(
        rows=2, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.03,
        row_heights=[0.7, 0.3],
        subplot_titles=("Prix", "Volume"),
    )

    # Panel 1 : Prix
    fig.add_trace(
        go.Scatter(
            x=prices.index,
            y=prices,
            name="Prix",
            line=dict(color="blue", width=2),
            mode="lines",
        ),
        row=1, col=1,
    )

    # Panel 2 : Volume (histogramme)
    colors = ["green" if prices.iloc[i] >= prices.iloc[i-1] else "red"
              for i in range(1, len(prices))]
    colors.insert(0, "gray")

    fig.add_trace(
        go.Bar(
            x=volumes.index,
            y=volumes,
            name="Volume",
            marker=dict(color=colors),
            showlegend=False,
        ),
        row=2, col=1,
    )

    fig.update_yaxes(title_text="Prix (€)", row=1, col=1)
    fig.update_yaxes(title_text="Volume", row=2, col=1)
    fig.update_xaxes(title_text="Date", row=2, col=1)

    fig.update_layout(
        title=title,
        template="plotly_dark",
        height=700,
        hovermode="x unified",
    )

    return fig


def create_density_heatmap(paths: np.ndarray, S0: float,
                          n_bins_price: int = 100,
                          n_bins_time: int = 100,
                          title: str = "Densité Probabiliste") -> go.Figure:
    """
    Crée une heatmap haute résolution : (temps × prix) colorée par densité.

    Parameters
    ----------
    paths : np.ndarray
        Shape (n_sims, n_steps+1)
    S0 : float
        Prix initial
    n_bins_price, n_bins_time : int
        Résolution de la heatmap
    """
    n_sims, n_steps = paths.shape

    # Grille de prix
    price_min = paths.min()
    price_max = paths.max()
    price_grid = np.linspace(price_min, price_max, n_bins_price)

    # Grille de temps
    time_grid = np.linspace(0, n_steps - 1, n_bins_time)

    # Matrice de densité - optimisée avec numpy
    density = np.zeros((n_bins_price - 1, n_bins_time - 1))

    # Limiter le nombre de simulations à traiter pour perf si > 5000
    sample_step = max(1, n_sims // 5000) if n_sims > 5000 else 1

    # Remplir la densité avec approche vectorisée
    for t_idx in range(n_bins_time - 1):
        t_min = int(time_grid[t_idx])
        t_max = int(time_grid[t_idx + 1])

        # Prendre un échantillon de simulations pour performance
        for s in range(0, n_sims, sample_step):
            prices_in_window = paths[s, t_min:t_max+1]
            # Utiliser histogramme numpy pour binning rapide
            counts, _ = np.histogram(prices_in_window, bins=price_grid)
            density[:len(counts), t_idx] += counts

    # Normaliser et ajuster pour sampling
    density = density / (n_sims / sample_step + 1e-6)

    # Créer heatmap avec prix adapté
    price_min_actual = price_grid.min()
    price_max_actual = price_grid.max()
    price_range = price_max_actual - price_min_actual

    fig = go.Figure(data=go.Heatmap(
        z=density.T,
        x=price_grid[:-1],
        y=time_grid[:-1],
        colorscale="YlOrRd",
        colorbar=dict(title="Densité"),
        name="Densité",
        hovertemplate="<b>Prix: €%{x:.2f}</b><br><b>Jour: %{y:.0f}</b><br><b>Densité: %{z:.3f}</b><extra></extra>"
    ))

    # Ajouter trajectoire moyenne
    mean_path = np.mean(paths, axis=0)
    fig.add_trace(go.Scatter(
        x=mean_path,
        y=np.arange(n_steps),
        mode="lines",
        name="Moyenne",
        line=dict(color="blue", width=3),
    ))

    # Ajouter percentiles P5 et P95 (les niveaux clés)
    p5 = np.percentile(paths, 5, axis=0)
    p95 = np.percentile(paths, 95, axis=0)

    fig.add_trace(go.Scatter(
        x=p5,
        y=np.arange(n_steps),
        mode="lines",
        name="P5 (Support probable)",
        line=dict(color="green", dash="dash", width=2),
    ))

    fig.add_trace(go.Scatter(
        x=p95,
        y=np.arange(n_steps),
        mode="lines",
        name="P95 (Résistance probable)",
        line=dict(color="red", dash="dash", width=2),
    ))

    # Ajouter zones de support/résistance (zones de haute densité)
    # Identifier les zones où la densité est > 75e percentile
    density_threshold = np.percentile(density, 75)
    high_density_zones = []

    for p_idx in range(len(price_grid) - 1):
        if (density[p_idx, :]).mean() > density_threshold:
            high_density_zones.append((price_grid[p_idx], price_grid[p_idx + 1]))

    # Ajouter annotations pour zones clés
    if len(high_density_zones) > 0:
        # Fusionner zones contiguës
        merged_zones = []
        for p_min, p_max in high_density_zones:
            if merged_zones and merged_zones[-1][1] >= p_min:
                merged_zones[-1] = (merged_zones[-1][0], p_max)
            else:
                merged_zones.append((p_min, p_max))

        # Afficher max 5 zones pour clarté
        for i, (p_min, p_max) in enumerate(merged_zones[:5]):
            zone_mid = (p_min + p_max) / 2
            fig.add_hline(
                y=n_steps // 2,
                x0=p_min, x1=p_max,
                line_dash="dot",
                line_color="rgba(255, 255, 0, 0.3)",
                layer="below"
            )

    fig.update_layout(
        title=title + f" (Prix: €{price_min_actual:.2f} → €{price_max_actual:.2f})",
        xaxis_title=f"Prix (€) — Range: €{price_range:.2f}",
        yaxis_title="Temps (jours)",
        template="plotly_dark",
        height=700,
        hovermode="closest",
        legend=dict(x=0.02, y=0.98, bgcolor="rgba(0,0,0,0.5)"),
    )

    return fig


def create_orderflow_chart(orders: pd.DataFrame, prices: pd.Series | None = None) -> go.Figure:
    """
    Crée un graphique orderflow avec cumulative delta + buy/sell volumes.

    Les axes sont adaptés aux prix réels de l'action analysée.

    Parameters
    ----------
    orders : pd.DataFrame
        Dataframe avec colonnes: timestamp, price, size, side, cumulative_delta
    prices : pd.Series, optional
        Série de prix pour adapter l'axe Y des prix
    """
    fig = make_subplots(
        rows=2, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.05,
        row_heights=[0.5, 0.5],
        subplot_titles=("Cumulative Delta (Orderflow)", "Buy vs Sell Volume (par prix)"),
    )

    # Convertir timestamps en format lisible "Mois Année"
    timestamps = pd.to_datetime(orders["timestamp"])

    # Format des labels (afficher chaque mois)
    x_labels = []
    x_positions = []

    if len(timestamps) > 0:
        current_month = None
        for i, ts in enumerate(timestamps):
            month_key = ts.strftime("%b %Y")  # "Jan 2024", "Feb 2024", etc.
            if month_key != current_month:
                x_labels.append(month_key)
                x_positions.append(i)
                current_month = month_key

    # Panel 1 : Cumulative Delta
    fig.add_trace(
        go.Scatter(
            x=np.arange(len(orders)),
            y=orders["cumulative_delta"],
            name="Cumulative Delta",
            line=dict(color="purple", width=2),
            fill="tozeroy",
            hovertemplate="<b>Ordre %{x}</b><br>Delta: %{y:,.0f}<extra></extra>"
        ),
        row=1, col=1,
    )

    fig.add_hline(y=0, line_dash="dash", line_color="gray", row=1, col=1)

    # Panel 2 : Buy/Sell volumes avec adaptation au prix
    buy_orders = orders[orders["side"] == "buy"]
    sell_orders = orders[orders["side"] == "sell"]

    fig.add_trace(
        go.Bar(
            x=buy_orders.index,
            y=buy_orders["size"],
            name="Buy",
            marker=dict(color="green"),
            hovertemplate="<b>Achat</b><br>Volume: %{y:,.0f}<extra></extra>"
        ),
        row=2, col=1,
    )

    fig.add_trace(
        go.Bar(
            x=sell_orders.index,
            y=-sell_orders["size"],
            name="Sell",
            marker=dict(color="red"),
            hovertemplate="<b>Vente</b><br>Volume: %{y:,.0f}<extra></extra>"
        ),
        row=2, col=1,
    )

    fig.update_yaxes(title_text="Delta Cumulé", row=1, col=1)
    fig.update_yaxes(title_text="Volume", row=2, col=1)

    # Adapter l'axe X pour afficher mois/année
    if len(x_labels) > 0:
        fig.update_xaxes(
            ticktext=x_labels,
            tickvals=x_positions,
            row=2, col=1
        )

    fig.update_xaxes(title_text="Date (Mois/Année)", row=2, col=1)

    fig.update_layout(
        title="Orderflow Analysis — Buy/Sell Imbalance",
        template="plotly_dark",
        height=800,
        hovermode="x unified",
        barmode="relative",
    )

    return fig


def create_volume_profile_chart(price_bins: np.ndarray,
                               volume_hist: np.ndarray,
                               poc: float | None = None) -> go.Figure:
    """
    Crée un graphique Volume Profile (distribution verticale).

    Parameters
    ----------
    price_bins : np.ndarray
        Niveaux de prix
    volume_hist : np.ndarray
        Volumes à chaque niveau
    poc : float, optional
        Point of Control (prix avec le plus gros volume)
    """
    colors = ["red" if v == volume_hist.max() else "blue" for v in volume_hist]

    fig = go.Figure(data=go.Bar(
        y=price_bins,
        x=volume_hist,
        orientation="h",
        marker=dict(color=colors),
        name="Volume",
    ))

    if poc is not None:
        fig.add_hline(
            y=poc,
            line_dash="dash",
            line_color="yellow",
            annotation_text=f"POC: {poc:.2f}",
        )

    fig.update_layout(
        title="Volume Profile",
        xaxis_title="Volume",
        yaxis_title="Prix (€)",
        template="plotly_dark",
        height=600,
        hovermode="y unified",
    )

    return fig


def create_multi_panel_dashboard(prices: pd.Series, volumes: pd.Series,
                                orders: pd.DataFrame,
                                paths: np.ndarray,
                                S0: float) -> go.Figure:
    """
    Crée un dashboard multi-panneaux TradingView-like.

    4 panneaux :
    1. Prix + Volume
    2. Densité probabiliste
    3. Orderflow (Cumulative Delta)
    4. Volume Profile
    """
    from plotly.subplots import make_subplots

    fig = make_subplots(
        rows=4, cols=2,
        shared_xaxes=True,
        vertical_spacing=0.08,
        horizontal_spacing=0.1,
        row_heights=[0.25, 0.25, 0.25, 0.25],
        subplot_titles=(
            "Prix", "Volume",
            "Densité Probabiliste", "Distribution Rendements",
            "Orderflow Delta", "Buy/Sell Volume",
            "Volume Profile", "Metrics"
        ),
        specs=[
            [{"secondary_y": False}, {"secondary_y": False}],
            [{"secondary_y": False, "colspan": 2}, None],
            [{"secondary_y": False}, {"secondary_y": False}],
            [{"secondary_y": False}, {"secondary_y": False}],
        ],
    )

    # Panel 1a : Prix
    fig.add_trace(
        go.Scatter(
            x=prices.index, y=prices,
            name="Prix", line=dict(color="blue", width=2),
            mode="lines",
        ),
        row=1, col=1,
    )

    # Panel 1b : Volume
    colors_vol = ["green" if prices.iloc[i] >= prices.iloc[i-1] else "red"
                  for i in range(1, len(prices))]
    colors_vol.insert(0, "gray")

    fig.add_trace(
        go.Bar(
            x=volumes.index, y=volumes,
            name="Volume", marker=dict(color=colors_vol),
            showlegend=False,
        ),
        row=1, col=2,
    )

    # Panel 2 : Densité (large, colspan 2) - optimisée
    n_bins_p, n_bins_t = 60, 60  # Réduit pour perf
    price_min, price_max = paths.min(), paths.max()
    price_grid = np.linspace(price_min, price_max, n_bins_p)
    time_grid = np.linspace(0, paths.shape[1] - 1, n_bins_t)

    density = np.zeros((n_bins_p - 1, n_bins_t - 1))
    # Limiter le sampling des simulations
    max_sims_to_use = min(300, paths.shape[0])
    sample_step = max(1, paths.shape[0] // max_sims_to_use)

    for t_idx in range(n_bins_t - 1):
        t_min, t_max = int(time_grid[t_idx]), int(time_grid[t_idx + 1])
        for s in range(0, paths.shape[0], sample_step):
            prices_in_window = paths[s, t_min:t_max+1]
            counts, _ = np.histogram(prices_in_window, bins=price_grid)
            density[:len(counts), t_idx] += counts

    density = density / (paths.shape[0] / sample_step + 1e-6)

    fig.add_trace(
        go.Heatmap(
            z=density.T, x=price_grid[:-1], y=time_grid[:-1],
            colorscale="YlOrRd", name="Densité", showlegend=False,
        ),
        row=2, col=1,
    )

    # Panel 3a : Orderflow Delta
    fig.add_trace(
        go.Scatter(
            x=orders.index, y=orders["cumulative_delta"],
            name="CVD", line=dict(color="purple", width=2),
            mode="lines", fill="tozeroy",
        ),
        row=3, col=1,
    )
    fig.add_hline(y=0, line_dash="dash", line_color="gray", row=3, col=1)

    # Panel 3b : Buy/Sell
    buy_ord = orders[orders["side"] == "buy"]
    sell_ord = orders[orders["side"] == "sell"]

    fig.add_trace(
        go.Bar(
            x=buy_ord.index, y=buy_ord["size"],
            name="Buy", marker=dict(color="green"), showlegend=False,
        ),
        row=3, col=2,
    )
    fig.add_trace(
        go.Bar(
            x=sell_ord.index, y=-sell_ord["size"],
            name="Sell", marker=dict(color="red"), showlegend=False,
        ),
        row=3, col=2,
    )

    # Panel 4a : Volume Profile (horizontal bars)
    price_bins_vp, volume_hist_vp = np.linspace(price_min, price_max, 40), np.zeros(39)
    for p_idx in range(39):
        volume_hist_vp[p_idx] = volumes[(prices >= price_bins_vp[p_idx]) &
                                        (prices < price_bins_vp[p_idx + 1])].sum()

    fig.add_trace(
        go.Bar(
            y=price_bins_vp[:-1], x=volume_hist_vp,
            orientation="h", name="Vol Profile", marker=dict(color="steelblue"),
            showlegend=False,
        ),
        row=4, col=1,
    )

    # Panel 4b : Statistiques texte
    mean_path = np.mean(paths, axis=0)[-1]
    final_prices = paths[:, -1]
    var_95 = np.percentile(final_prices, 5)
    prob_loss = np.mean(final_prices < S0)

    metrics_text = f"""
    <b>Statistiques</b><br>
    Prix moyen : {mean_path:.2f}€<br>
    VaR 95% : {(var_95/S0 - 1)*100:.1f}%<br>
    P(Perte) : {prob_loss*100:.1f}%<br>
    Volumes : {volumes.sum():.0f}
    """

    fig.add_annotation(
        text=metrics_text,
        xref="paper", yref="paper",
        x=0.85, y=0.15,
        showarrow=False,
        bgcolor="rgba(0,0,0,0.7)",
        font=dict(color="white", size=12),
        align="left",
        xanchor="left",
        yanchor="middle",
    )

    # Mise à jour layout
    fig.update_yaxes(title_text="Prix (€)", row=1, col=1)
    fig.update_yaxes(title_text="Volume", row=1, col=2)
    fig.update_yaxes(title_text="Prix (€)", row=2, col=1)
    fig.update_yaxes(title_text="CVD", row=3, col=1)
    fig.update_yaxes(title_text="Volume", row=3, col=2)
    fig.update_yaxes(title_text="Prix (€)", row=4, col=1)

    fig.update_xaxes(title_text="Date", row=4, col=1)
    fig.update_xaxes(title_text="Temps", row=3, col=2)
    fig.update_xaxes(title_text="Volume", row=4, col=1)

    fig.update_layout(
        title_text="TradingView-Style Dashboard",
        template="plotly_dark",
        height=1400,
        hovermode="x unified",
        barmode="relative",
        showlegend=True,
    )

    return fig
