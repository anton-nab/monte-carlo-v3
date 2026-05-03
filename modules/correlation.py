"""
correlation.py
---------------
Multi-actifs corrélés via décomposition de Cholesky.

Approche :
    1. Calculer la matrice de corrélation des log-rendements historiques.
    2. Appliquer la décomposition de Cholesky L tel que L @ L.T = Corr.
    3. Générer Z ~ N(0, I) puis transformer en Z_corr = Z @ L.T.
    4. Utiliser Z_corr pour piloter les GBM multiples.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def compute_correlation_matrix(log_returns_dict: dict) -> tuple:
    """
    Calcule la matrice de corrélation à partir des log-rendements historiques.

    Parameters
    ----------
    log_returns_dict : dict
        {ticker: pd.Series de log-rendements}

    Returns
    -------
    tuple
        (corrélation_matrix, tickers_ordered)
    """
    if not log_returns_dict:
        raise ValueError("log_returns_dict vide.")

    # Aligner les séries temporelles sur l'index commun
    df = pd.DataFrame(log_returns_dict)
    df = df.dropna()

    if df.empty:
        raise ValueError("Aucune donnée commune entre les actifs.")

    corr_matrix = df.corr().values
    tickers = list(df.columns)

    return corr_matrix, tickers


def cholesky_decomposition(corr_matrix: np.ndarray) -> np.ndarray:
    """
    Décompose la matrice de corrélation via Cholesky.
    Ajoute un petit jitter si la matrice n'est pas semi-définie positive.

    Returns
    -------
    np.ndarray
        Matrice L telle que L @ L.T = corr_matrix (approx).
    """
    try:
        L = np.linalg.cholesky(corr_matrix)
    except np.linalg.LinAlgError:
        # Ajouter jitter sur la diagonale si singularière
        epsilon = 1e-6
        corr_matrix_adj = corr_matrix + epsilon * np.eye(corr_matrix.shape[0])
        try:
            L = np.linalg.cholesky(corr_matrix_adj)
        except np.linalg.LinAlgError:
            # Fallback : PCA
            evals, evecs = np.linalg.eigh(corr_matrix)
            evals = np.maximum(evals, 1e-8)
            L = evecs @ np.diag(np.sqrt(evals))

    return L


def simulate_correlated_gbm(
    S0_dict: dict,
    mu_dict: dict,
    sigma_dict: dict,
    corr_matrix: np.ndarray,
    horizon_days: int,
    n_sims: int = 5000,
    trading_days: int = 252,
    seed: int | None = None,
) -> dict:
    """
    Simule des trajectoires GBM corrélées pour plusieurs actifs.

    Parameters
    ----------
    S0_dict : dict
        {ticker: prix_initial}
    mu_dict, sigma_dict : dict
        {ticker: drift/volatilité annualisés}
    corr_matrix : np.ndarray
        Matrice de corrélation (n_assets × n_assets).
    tickers_order : list
        Ordre des tickers dans la matrice de corrélation.

    Returns
    -------
    dict
        {ticker: np.ndarray de shape (n_sims, horizon_days + 1)}
    """
    if seed is not None:
        np.random.seed(seed)

    n_assets = corr_matrix.shape[0]
    tickers = list(S0_dict.keys())

    if len(tickers) != n_assets:
        raise ValueError(
            f"Nombre de tickers ({len(tickers)}) != taille matrice corr ({n_assets})."
        )

    dt = 1.0 / trading_days
    L = cholesky_decomposition(corr_matrix)

    # Matrices de paramètres
    S0_vec = np.array([S0_dict[t] for t in tickers])
    mu_vec = np.array([mu_dict[t] for t in tickers])
    sigma_vec = np.array([sigma_dict[t] for t in tickers])

    drift = (mu_vec - 0.5 * sigma_vec**2) * dt
    diffusion = sigma_vec * np.sqrt(dt)

    # Z indépendants (n_assets, horizon_days, n_sims)
    Z_indep = np.random.standard_normal((n_assets, horizon_days, n_sims))

    # Appliquer la corrélation via Cholesky
    Z_corr = np.zeros_like(Z_indep)
    for step in range(horizon_days):
        Z_indep_step = Z_indep[:, step, :]  # (n_assets, n_sims)
        Z_corr_step = L @ Z_indep_step      # (n_assets, n_sims) corrélés
        Z_corr[:, step, :] = Z_corr_step

    # Log-rendements
    log_returns = drift[:, np.newaxis, np.newaxis] + diffusion[:, np.newaxis, np.newaxis] * Z_corr

    # Cumul et conversion en prix
    cum_log_returns = np.concatenate(
        [np.zeros((n_assets, 1, n_sims)), np.cumsum(log_returns, axis=1)],
        axis=1,
    )

    # (n_assets, horizon_days + 1, n_sims)
    paths_expanded = S0_vec[:, np.newaxis, np.newaxis] * np.exp(cum_log_returns)

    # Réorganiser en dict {ticker: (n_sims, horizon_days + 1)}
    result = {}
    for idx, ticker in enumerate(tickers):
        result[ticker] = paths_expanded[idx, :, :].T

    return result
