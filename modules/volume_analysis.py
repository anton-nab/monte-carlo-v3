"""
volume_analysis.py
------------------
Indicateurs de volume : OBV, VWAP, Volume Profile, Cumulative Volume Delta.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def compute_obv(prices: pd.Series, volumes: pd.Series) -> pd.Series:
    """
    On-Balance Volume (OBV) : cumul des volumes avec signe.

    OBV_t = OBV_{t-1} + (volume_t * sign(price_change_t))
    """
    price_changes = prices.diff()
    obv = volumes * np.sign(price_changes)
    return obv.cumsum()


def compute_vwap(prices: pd.Series, volumes: pd.Series) -> pd.Series:
    """
    Volume-Weighted Average Price (VWAP).

    VWAP_t = Σ(price * volume) / Σ(volume) jusqu'à t
    """
    cumul_pv = (prices * volumes).cumsum()
    cumul_v = volumes.cumsum()
    return cumul_pv / cumul_v


def compute_volume_profile(prices: pd.Series, volumes: pd.Series,
                          n_bins: int = 50) -> tuple:
    """
    Volume Profile : distribution des volumes par niveau de prix.

    Returns
    -------
    (price_bins, volume_histogram)
    """
    price_bins = np.linspace(prices.min(), prices.max(), n_bins)
    volume_per_bin = np.zeros(n_bins - 1)

    for i in range(len(price_bins) - 1):
        mask = (prices >= price_bins[i]) & (prices < price_bins[i + 1])
        volume_per_bin[i] = volumes[mask].sum()

    return price_bins[:-1] + (price_bins[1] - price_bins[0]) / 2, volume_per_bin


def compute_cumulative_delta(prices: pd.Series, volumes: pd.Series,
                            bid_ratio: float = 0.5) -> pd.Series:
    """
    Cumulative Volume Delta (CVD) : simule buy vs sell volumes.

    Assomption simple :
    - Price up → buy volume
    - Price down → sell volume
    - Ratio contrôlé par bid_ratio (partie buy)

    CVD_t = Σ(buy_vol - sell_vol)
    """
    price_changes = prices.diff()

    # Simuler buy/sell basé sur la direction des prix
    buy_vol = volumes.copy()
    sell_vol = volumes.copy()

    for i in range(1, len(prices)):
        if price_changes.iloc[i] > 0:
            # Price up = mostly buy
            buy_vol.iloc[i] = volumes.iloc[i] * (1 - bid_ratio + bid_ratio * 0.8)
            sell_vol.iloc[i] = volumes.iloc[i] * (bid_ratio - bid_ratio * 0.8)
        elif price_changes.iloc[i] < 0:
            # Price down = mostly sell
            sell_vol.iloc[i] = volumes.iloc[i] * (1 - bid_ratio + bid_ratio * 0.8)
            buy_vol.iloc[i] = volumes.iloc[i] * (bid_ratio - bid_ratio * 0.8)
        else:
            # No change = balanced
            buy_vol.iloc[i] = volumes.iloc[i] * bid_ratio
            sell_vol.iloc[i] = volumes.iloc[i] * (1 - bid_ratio)

    delta = buy_vol - sell_vol
    return delta.cumsum()


def detect_volume_clusters(volumes: pd.Series,
                          threshold_percentile: float = 75) -> np.ndarray:
    """
    Détecte les clusters de volume (pics d'intérêt).

    Returns
    -------
    np.ndarray de booléens (True pour cluster)
    """
    threshold = np.percentile(volumes, threshold_percentile)
    return volumes >= threshold


def compute_on_balance_volume_rsi(obv: pd.Series,
                                 period: int = 14) -> pd.Series:
    """
    RSI de l'OBV (mesure momentum des volumes).
    """
    obv_changes = obv.diff()
    gains = obv_changes.where(obv_changes > 0, 0)
    losses = -obv_changes.where(obv_changes < 0, 0)

    avg_gain = gains.rolling(window=period).mean()
    avg_loss = losses.rolling(window=period).mean()

    rs = avg_gain / avg_loss
    obv_rsi = 100 - (100 / (1 + rs))

    return obv_rsi


def compute_money_flow_index(high: pd.Series, low: pd.Series,
                            close: pd.Series, volume: pd.Series,
                            period: int = 14) -> pd.Series:
    """
    Money Flow Index (MFI) : RSI des volumes pondérés par prix.

    MFI = 100 - 100/(1 + Positive Money Flow / Negative Money Flow)
    """
    typical_price = (high + low + close) / 3
    raw_money_flow = typical_price * volume

    positive_flow = raw_money_flow.where(
        typical_price > typical_price.shift(1), 0
    )
    negative_flow = raw_money_flow.where(
        typical_price < typical_price.shift(1), 0
    )

    positive_mf = positive_flow.rolling(window=period).sum()
    negative_mf = negative_flow.rolling(window=period).sum()

    mfi = 100 - (100 / (1 + positive_mf / negative_mf))

    return mfi


def analyze_volume_profile_extremes(price_bins: np.ndarray,
                                   volume_hist: np.ndarray) -> dict:
    """
    Analyse les extremes du volume profile.

    Returns
    -------
    dict avec : peak (POC), support, resistance levels
    """
    peak_idx = np.argmax(volume_hist)
    poc = price_bins[peak_idx]  # Point of Control

    # Support/Resistance : régions haute volume
    high_vol_threshold = np.percentile(volume_hist, 75)
    support_levels = price_bins[volume_hist >= high_vol_threshold]

    return {
        "point_of_control": poc,
        "support_levels": support_levels.min() if len(support_levels) > 0 else None,
        "resistance_levels": support_levels.max() if len(support_levels) > 0 else None,
        "volume_at_poc": volume_hist[peak_idx],
    }
