"""
orderflow_simulator.py
---------------------
Simulation d'orderflow basée sur volumes historiques.

Approche :
- Récupérer volumes intraday Yahoo Finance
- Simuler buy/sell basé sur momentum des prix
- Générer "tape" (ordre par ordre)
- Calculer cumulative volume delta
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def generate_orderflow_tape(prices: pd.Series, volumes: pd.Series,
                           n_subdivisions: int = 10,
                           seed: int | None = None) -> pd.DataFrame:
    """
    Génère une "tape" (flux d'ordres) basée sur volumes historiques.

    Approche : diviser chaque bougie en N sous-ordres, avec direction basée sur momentum.

    Parameters
    ----------
    prices : pd.Series
        Prix de clôture historiques
    volumes : pd.Series
        Volumes correspondants
    n_subdivisions : int
        Nombre de sous-ordres par bougie (10 = 10% du volume par ordre)
    seed : int, optional
        Graine pour reproductibilité

    Returns
    -------
    pd.DataFrame
        Colonnes : timestamp, price, size, side (buy/sell), cumulative_delta
    """
    if seed is not None:
        np.random.seed(seed)

    orders = []
    cumulative_delta = 0

    for i in range(len(prices)):
        # Calculer direction : up = buy, down = sell
        if i > 0:
            price_change = prices.iloc[i] - prices.iloc[i - 1]
            direction = 1 if price_change > 0 else (-1 if price_change < 0 else 0)
        else:
            direction = 1  # Par défaut : buy

        # Diviser le volume en N ordres
        volume_per_order = volumes.iloc[i] / n_subdivisions
        price_level = prices.iloc[i]

        # Ajouter légère variation de prix (bid-ask spread simulé)
        for j in range(n_subdivisions):
            # Variation intra-bougie
            price_var = np.random.normal(0, price_level * 0.001)
            order_price = price_level + price_var

            # Probabilité buy/sell basée sur direction
            if direction > 0:
                is_buy = np.random.random() < 0.7  # 70% buy si up
            elif direction < 0:
                is_buy = np.random.random() < 0.3  # 30% buy si down
            else:
                is_buy = np.random.random() < 0.5  # 50/50 si flat

            side = "buy" if is_buy else "sell"
            delta = volume_per_order if is_buy else -volume_per_order
            cumulative_delta += delta

            orders.append({
                "timestamp": prices.index[i],
                "price": order_price,
                "size": volume_per_order,
                "side": side,
                "cumulative_delta": cumulative_delta,
            })

    return pd.DataFrame(orders)


def compute_orderflow_imbalance(orders: pd.DataFrame,
                               window: int = 100) -> pd.Series:
    """
    Calcule l'imbalance d'orderflow (buy - sell) / total volume.

    Valeur > 0 : plus d'achats
    Valeur < 0 : plus de ventes
    Valeur ≈ 0 : équilibré
    """
    buy_mask = orders["side"] == "buy"
    buy_vol = orders.loc[buy_mask, "size"].rolling(window=window).sum()
    sell_vol = orders.loc[~buy_mask, "size"].rolling(window=window).sum()

    total_vol = buy_vol + sell_vol
    imbalance = (buy_vol - sell_vol) / total_vol

    return imbalance


def detect_large_orders(orders: pd.DataFrame,
                       threshold_percentile: float = 90) -> pd.DataFrame:
    """
    Détecte les gros ordres (>90e percentile).

    Utile pour identifier les mouvements de "whale" ou "market makers".
    """
    threshold = np.percentile(orders["size"], threshold_percentile)
    return orders[orders["size"] >= threshold]


def compute_buy_sell_ratio(orders: pd.DataFrame,
                          window: int = 100) -> pd.Series:
    """
    Ratio buy/sell volumes.

    > 1 : plus d'achats que de ventes
    < 1 : plus de ventes que d'achats
    """
    buy_vol = orders[orders["side"] == "buy"]["size"].rolling(window=window).sum()
    sell_vol = orders[orders["side"] == "sell"]["size"].rolling(window=window).sum()

    return buy_vol / sell_vol


def generate_orderflow_heatmap(orders: pd.DataFrame,
                              price_bins: int = 50,
                              time_bins: int = 100) -> tuple:
    """
    Génère une heatmap : (prix × temps) colorée par orderflow intensity.

    Returns
    -------
    (price_grid, time_grid, intensity_matrix)
    """
    # Normaliser les timestamps
    timestamps = pd.to_datetime(orders["timestamp"])
    time_numeric = np.arange(len(timestamps))

    # Créer grilles
    price_min, price_max = orders["price"].min(), orders["price"].max()
    price_grid = np.linspace(price_min, price_max, price_bins)
    time_grid = np.linspace(0, len(orders), time_bins)

    # Matrice d'intensité
    intensity = np.zeros((price_bins - 1, time_bins - 1))

    for i in range(len(orders)):
        price_idx = np.searchsorted(price_grid, orders.iloc[i]["price"]) - 1
        time_idx = np.searchsorted(time_grid, i) - 1

        if 0 <= price_idx < price_bins - 1 and 0 <= time_idx < time_bins - 1:
            size = orders.iloc[i]["size"]
            if orders.iloc[i]["side"] == "buy":
                intensity[price_idx, time_idx] += size
            else:
                intensity[price_idx, time_idx] -= size

    return price_grid, time_grid, intensity


def analyze_orderflow_momentum(orders: pd.DataFrame,
                              window: int = 50) -> pd.DataFrame:
    """
    Analyse le momentum de l'orderflow (accélération des buy/sell).

    Retourne un dataframe avec momentum indicators.
    """
    cumul_delta = orders["cumulative_delta"]
    delta_momentum = cumul_delta.diff().rolling(window=window).mean()

    return pd.DataFrame({
        "cumulative_delta": cumul_delta,
        "delta_momentum": delta_momentum,
        "timestamp": orders["timestamp"],
    })


def detect_orderflow_divergence(prices: pd.Series,
                               cumul_delta: pd.Series) -> dict:
    """
    Détecte les divergences : prix montent mais orderflow baisse (bearish).

    Returns
    -------
    dict avec : divergence_type, strength, timestamp
    """
    price_changes = prices.diff()
    delta_changes = cumul_delta.diff()

    # Haussière : prix baissent, but orderflow monte (accumulation)
    bullish_div = (price_changes < 0) & (delta_changes > 0)

    # Baissière : prix montent, but orderflow baisse (distribution)
    bearish_div = (price_changes > 0) & (delta_changes < 0)

    results = {
        "bullish_divergences": bullish_div.sum(),
        "bearish_divergences": bearish_div.sum(),
        "bullish_indices": bullish_div[bullish_div].index.tolist(),
        "bearish_indices": bearish_div[bearish_div].index.tolist(),
    }

    return results
