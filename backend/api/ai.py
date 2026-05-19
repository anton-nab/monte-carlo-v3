"""
POST /api/ai/summarize  — Phase 17
-----------------------------------
Génère une analyse qualitative d'une simulation Monte Carlo
via GPT-4o mini (OpenAI).

Nécessite OPENAI_API_KEY dans l'environnement.
Sans clé : retourne un message explicatif (pas d'erreur 500).
"""

from __future__ import annotations

import os

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/ai", tags=["ai"])


# ─────────────────────────────────────────────────────────────────────────────
# Schémas
# ─────────────────────────────────────────────────────────────────────────────

class SimSummaryRequest(BaseModel):
    ticker:           str
    model:            str
    horizon_days:     int
    S0:               float
    mu_pct:           float   # %/an, ex: 12.5
    sigma_pct:        float   # %/an, ex: 28.0
    n_sims:           int
    median_price:     float
    expected_price:   float
    p5:               float
    p95:              float
    expected_return:  float   # décimal, ex: 0.12 = +12%
    var_95:           float   # décimal, ex: -0.15 = -15%
    es_95:            float   # décimal
    prob_loss:        float   # décimal, ex: 0.38 = 38%
    prob_gain_10pct:  float   # décimal
    avg_max_drawdown: float   # décimal


class SimSummaryResponse(BaseModel):
    summary:  str
    has_key:  bool


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/summarize", response_model=SimSummaryResponse)
async def summarize_simulation(req: SimSummaryRequest):
    api_key = os.getenv("OPENAI_API_KEY", "").strip()

    if not api_key:
        return SimSummaryResponse(
            summary=(
                "Clé OpenAI non configurée. Ajoutez la variable "
                "OPENAI_API_KEY dans les paramètres de votre service Railway "
                "pour activer l'analyse IA."
            ),
            has_key=False,
        )

    # Libellé horizon lisible
    days = req.horizon_days
    if days >= 252:
        horizon = f"{days // 252} an{'s' if days // 252 > 1 else ''}"
    elif days >= 21:
        horizon = f"{days // 21} mois"
    else:
        horizon = f"{days} jours"

    # Rendement médian en %
    median_ret = ((req.median_price - req.S0) / req.S0) * 100

    prompt = f"""Tu es un analyste financier quantitatif senior.
Analyse cette simulation Monte Carlo et rédige exactement 3 phrases concises en français.

━━ SIMULATION ━━
Ticker : {req.ticker} | Modèle : {req.model.upper()} | Horizon : {horizon} ({days} jours)
Prix actuel S₀ : ${req.S0:.2f} | µ (drift) : {req.mu_pct:+.1f}%/an | σ (vol) : {req.sigma_pct:.1f}%/an
Nombre de simulations : {req.n_sims:,}

━━ RÉSULTATS ━━
Prix médian (P50) : ${req.median_price:.2f} ({median_ret:+.1f}%) | Prix attendu : ${req.expected_price:.2f}
Fourchette P5–P95 : ${req.p5:.2f} → ${req.p95:.2f}
VaR 95% : {req.var_95 * 100:.1f}% | Expected Shortfall 95% : {req.es_95 * 100:.1f}%
P(perte) : {req.prob_loss * 100:.1f}% | P(gain > 10%) : {req.prob_gain_10pct * 100:.1f}%
Drawdown moyen : {req.avg_max_drawdown * 100:.1f}%

━━ FORMAT ATTENDU ━━
Phrase 1 — Orientation générale (haussier / baissier / neutre) avec les chiffres P50 et probabilités clés.
Phrase 2 — Risques identifiés à partir de la VaR, de l'ES et du drawdown.
Phrase 3 — Insight actionnable et concis pour l'investisseur.

Sois précis, quantitatif et direct. Pas d'introduction ni de conclusion."""

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key)

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=350,
            temperature=0.25,
        )
        summary = response.choices[0].message.content.strip()
        return SimSummaryResponse(summary=summary, has_key=True)

    except Exception as exc:
        return SimSummaryResponse(
            summary=f"Erreur OpenAI : {str(exc)[:300]}",
            has_key=True,
        )
