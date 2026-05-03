"""
glossary.py
-----------
Explications pédagogiques interactives des concepts financiers et probabilistes.
Chaque entrée inclut formule, exemple concret, impact visuel.
"""

GLOSSAIRE = {
    "Dérive (μ)": {
        "simple": "La tendance générale de hausse ou baisse d'un prix sur le long terme.",
        "technique": "Le rendement moyen attendu annualisé. Paramètre μ dans le GBM.",
        "formule": "μ = E[rendement annuel] = (rendement_jour_moyen) × 252",
        "exemple": "Si une action monte de 0,05% par jour en moyenne → μ ≈ 12,6% par an",
        "impact": (
            "• ↑ μ : les courbes montent plus haut en moyenne (optimisme)\n"
            "• ↓ μ : les courbes restent plates ou baissent (pessimisme)\n"
            "• Impact sur risque : faible (n'affecte pas la volatilité)"
        ),
        "illustration": "Imaginez une escalier roulant : μ contrôle la vitesse de montée.",
    },

    "Volatilité (σ)": {
        "simple": "L'ampleur des oscillations du prix. Plus σ est grand, plus le prix « danse ».",
        "technique": "L'écart-type des rendements quotidiens, annualisé. Mesure de l'incertitude.",
        "formule": "σ = √(Var[rendements]) × √252",
        "exemple": "σ = 20% = le prix peut bouger ±20% sur un horizon d'un an (95% confiance).",
        "impact": (
            "• ↑ σ : éventail de résultats plus large (risque accru, gains potentiels plus gros)\n"
            "• ↓ σ : éventail étroit (stabilité, mais moins d'opportunités)\n"
            "• Impact sur VaR : très fort (plus grande perte possible)"
        ),
        "illustration": "Imaginez la largeur d'un trompette : σ contrôle l'ouverture.",
    },

    "VaR 95% (Value at Risk)": {
        "simple": "La perte maximale qu'on peut s'attendre à subir 95% du temps (5% de chance de pire).",
        "technique": "Le 5ème percentile des rendements. Réponse à : quel est le pire cas à 95% confiance ?",
        "formule": "VaR(95%) = rendement_à_5e_percentile",
        "exemple": "VaR 95% = -15% → 95% du temps, perte ≤ 15%. 5% du temps, perte > 15%.",
        "impact": (
            "• ↑ volatilité σ : VaR pire (perte plus grande)\n"
            "• Horizon court : VaR petit (peu de temps pour dégâts)\n"
            "• Horizon long : VaR grand (plus de temps, plus de risque)"
        ),
        "illustration": "Imaginez les 100 scénarios simulés : VaR = la perte dans les 5 pires scénarios.",
    },

    "Expected Shortfall (ES/CVaR)": {
        "simple": "La perte **moyenne** quand les choses tournent mal (dans les 5% pires scénarios).",
        "technique": "Moyenne des rendements sous le seuil de VaR. Plus prudent que VaR seule.",
        "formule": "ES(95%) = moyenne(rendements < VaR(95%))",
        "exemple": "Si VaR = -15%, mais les pires cas donnent -20%, -18%, -17% → ES ≈ -18,3%",
        "impact": (
            "• ↑ volatilité σ : ES pire (catastrophe coûte plus cher)\n"
            "• Mesure le « tail risk » : cap ne dit pas **combien** on perd si on dépasse"
        ),
        "illustration": "VaR = limite de sécurité. ES = coût moyen quand on franchit la limite.",
    },

    "Drawdown": {
        "simple": "La plus forte baisse « pic-creux » sur une trajectoire. Perte non-réalisée.",
        "technique": "max(S_t) - S_t) / max(S_t) : recul par rapport au sommet atteint.",
        "formule": "Drawdown_t = (Sommet_historique - Prix_actuel) / Sommet_historique",
        "exemple": "Prix monte à 100€, retombe à 80€ → drawdown = 20%",
        "impact": (
            "• Résume la psychologie : un -20% est pire qu'une -10% × 2\n"
            "• Horizon long : drawdown pire (plus de temps pour rechute)\n"
            "• Volatilité haute : drawdown pire (oscillations plus amples)"
        ),
        "illustration": "Imaginez un escalier : vous montez, puis glissez. Drawdown = votre chute.",
    },

    "Probabilité de perte": {
        "simple": "Chance que l'investissement soit dans le rouge à la fin.",
        "technique": "P(rendement final < 0) = % de scénarios où prix < prix initial",
        "formule": "P(perte) = (nombre de simulations où S_T < S_0) / total",
        "exemple": "P(perte) = 30% → 3 chances sur 10 de terminer en négatif",
        "impact": (
            "• ↑ μ (dérive) : P(perte) baisse (dérive haussière)\n"
            "• ↑ σ (volatilité) : P(perte) augmente (plus d'incertitude)\n"
            "• Horizon court : P(perte) haute (peu de temps pour rebond)"
        ),
        "illustration": "Lance une pièce : P(face) = 50%. Ici : P(gain) = probabilité de profit.",
    },

    "Skewness (Asymétrie)": {
        "simple": "La queue d'une distribution : à gauche ou à droite ?",
        "technique": "Moment d'ordre 3. Skew < 0 = queue à gauche (crashs), Skew > 0 = queue à droite.",
        "formule": "Skewness = E[(X - μ)³] / σ³",
        "exemple": "Actions : skew ≈ -0.3 (crashs soudains plus courants que gains soudains)",
        "impact": (
            "• Skew négatif : pire que ce que GBM prédit (tail risk caché)\n"
            "• Skew positif : meilleur que GBM (asymétrie favorable)"
        ),
        "illustration": "Courbe de cloche normalement symétrique. Ici, elle s'étire d'un côté.",
    },

    "Kurtosis (Queues épaisses)": {
        "simple": "Fréquence des événements extrêmes. Haut = crashs/booms plus courants.",
        "technique": "Moment d'ordre 4. Kurt > 3 = fat tails (plus d'extrêmes que gaussienne).",
        "formule": "Kurtosis = E[(X - μ)⁴] / σ⁴",
        "exemple": "Actions : Kurt ≈ 5 (vs 3 pour courbe normale) → 2× plus de crashs",
        "impact": (
            "• Kurt haute : VaR sous-estimée par GBM\n"
            "• Merton/Heston captent ça mieux que GBM pur"
        ),
        "illustration": "Courbe pointue au centre, avec queues épaisses. Événements extrêmes plus fréquents.",
    },

    "Corrélation": {
        "simple": "Dansent-elles ensemble ? Si une monte, l'autre monte aussi ?",
        "technique": "Covariance normalisée [-1, 1]. 0 = indépendant, 1 = mouvement identique.",
        "formule": "Corr(X,Y) = Cov(X,Y) / (σ_X × σ_Y)",
        "exemple": "Corr(AAPL, MSFT) = 0.7 → 70% d'accord. Quand AAPL monte, MSFT suit souvent.",
        "impact": (
            "• Corr haute : diversification faible (même risque)\n"
            "• Corr basse : diversification forte (risques indépendants)\n"
            "• Matrice Cholesky crée les corrélations dans simulations"
        ),
        "illustration": "Deux danseurs : corrélation = syncro. 1 = mouvement miroir, 0 = indépendant.",
    },

    "Modèle GBM": {
        "simple": "Le modèle 'basique' : le prix suit une tendance + oscillations aléatoires.",
        "technique": "dS = μ·S·dt + σ·S·dW. Solution : S_t = S_0·exp((μ-σ²/2)t + σ√t·Z)",
        "formule": "S_{t+1} = S_t × exp((μ - σ²/2)·Δt + σ√Δt·Z), Z~N(0,1)",
        "exemple": "S_0 = 100€, μ = 10%, σ = 20%, Δt = 1 jour → S_1 ≈ 100 × exp(0.00026 + 0.0126·Z)",
        "impact": (
            "• Rapide, simple, bon baseline\n"
            "• ❌ Sous-estime crashs (queues fines)\n"
            "• ❌ Volatilité constante (pas de clustering)"
        ),
        "illustration": "Une marche aléatoire : à chaque pas, une pièce détermine direction + grandeur.",
    },

    "Modèle Merton": {
        "simple": "GBM + des « sauts » aléatoires (crashs soudains ou gains soudains).",
        "technique": "dS = μ·S·dt + σ·S·dW + J·dN, où dN = processus de Poisson",
        "formule": "À chaque pas, ajouter λ·dt sauts de rendement ~N(μ_J, σ_J²)",
        "exemple": "99% du temps : mouvement normal. 1% du temps : -5% soudain (crash).",
        "impact": (
            "• ✅ Capture les queues épaisses (fat tails réalistes)\n"
            "• ✅ VaR mieux calibrée\n"
            "• ❌ Plus lent à calculer"
        ),
        "illustration": "Marche aléatoire PLUS des « téléportations » aléatoires (sauts).",
    },

    "Modèle Heston": {
        "simple": "La volatilité elle-même fluctue ! Les calmes et les orages alternent.",
        "technique": "Deux EDS couplées : dS = μ·S·dt + √v·S·dW1, dv = κ(θ-v)dt + σ_v√v·dW2",
        "formule": "Volatilité retourne à une moyenne long-terme θ à vitesse κ",
        "exemple": "Vol = 15% aujourd'hui → orages → vol = 40% → calme → vol = 15% à nouveau",
        "impact": (
            "• ✅ Volatility clustering réaliste\n"
            "• ✅ Smile de volatilité (options)\n"
            "• ❌ Lent, 2 variables d'état"
        ),
        "illustration": "Marche aléatoire avec « largeur de pas » qui varie (large quand volatile, petit quand calme).",
    },

    "Modèle GARCH": {
        "simple": "Apprendre des vraies données : utiliser les oscillations passées pour prédire futures.",
        "technique": "σ_t² = ω + α·ε_{t-1}² + β·σ_{t-1}². Rééchantillonner résidus.",
        "formule": "GARCH(1,1) : chaque jour, vol dépend du jour précédent + surprise d'hier",
        "exemple": "Jour 1 : vol = 15%. Jour 2 : crash → vol monte → 25%. Jour 3 : calme → vol redescend.",
        "impact": (
            "• ✅ Empirique, pas d'assomption\n"
            "• ✅ Capture le clustering réel\n"
            "• ❌ Limité à l'historique (pas de prédiction véritable)"
        ),
        "illustration": "Apprendre le passé : si hier il y a eu un grand mouvement, aujourd'hui attendez-vous à plus.",
    },

    "Backtesting": {
        "simple": "Tester le modèle sur le passé : simuler, comparer à ce qui s'est vraiment passé.",
        "technique": "Fenêtres roulantes : calibrer sur 252j, prédire 20j, comparer, répéter.",
        "formule": "Coverage = % cas où rendement réalisé < VaR prédite. Idéal = 5%.",
        "exemple": "Simulé : VaR 95% = -15%. Réalisé : -17% → couverture échouée (compter 1)",
        "impact": (
            "• ✅ Validation honnête du modèle\n"
            "• Coverage 5% = bien calibré\n"
            "• Coverage > 5% = modèle surestime le risque"
        ),
        "illustration": "Jouer le jeu dans le rétro : si je l'avais fait hier, aurais-je eu raison ?",
    },

    "Frontière Efficiente": {
        "simple": "Les meilleurs portefeuilles : pour chaque risque, quel rendement max ?",
        "technique": "Minimiser σ_p pour chaque μ_p cible (optimisation convexe).",
        "formule": "min(w.T @ Σ @ w) s.c. w.T @ μ = μ_target, Σw = 1",
        "exemple": "Portefeuille A : 5% risque, 8% rendement. B : 5% risque, 7% rend → A meilleur",
        "impact": (
            "• Visualise trade-off risque/rendement\n"
            "• Ratio Sharpe = pente optimale\n"
            "• Poids à gauche = conservateur, à droite = agressif"
        ),
        "illustration": "Une courbe croissante : monter à droite (plus risque) = plus rendement potentiel.",
    },

    "Ratio Sharpe": {
        "simple": "Le « rendement par unité de risque pris ». Meilleur portefeuille pour votre appétence.",
        "technique": "(μ_p - r_f) / σ_p : rendement excédentaire / volatilité",
        "formule": "Sharpe = (E[rendement] - taux_sans_risque) / écart_type",
        "exemple": "Port A : 10% rendement, 15% risque, rf = 2% → Sharpe = 8/15 = 0.53",
        "impact": (
            "• Sharpe haute = efficace (gain par risque)\n"
            "• Ratio Sharpe optimal = meilleur choix\n"
            "• Deux ports même Sharpe = équivalent"
        ),
        "illustration": "Pente d'une montagne : Sharpe = raideur. Plus raide = plus efficace.",
    },

    "Simulation Monte Carlo": {
        "simple": "Lancer les dés 10 000 fois pour voir tous les possibles futurs.",
        "technique": "Générer n_sims trajectoires indépendantes via chocs gaussiens itérés.",
        "formule": "Pour i=1..n_sims : générer Z~N(0,I), calculer S_t = S_0·exp(intégrale)",
        "exemple": "10 000 futurs possibles → distribution de richesse finale → VaR = 5e percentile",
        "impact": (
            "• Précision ↑ avec n_sims (loi des grands nombres)\n"
            "• Rapide avec vectorisation NumPy\n"
            "• Antithétique : variance /2 gratuitement"
        ),
        "illustration": "Jeu de dés : plus il y a de lancers, plus fidèle la distribution observée.",
    },
}


def afficher_glossaire_complet():
    """Retourne le glossaire complet avec formatage Streamlit."""
    return GLOSSAIRE


def afficher_terme(terme: str) -> dict | None:
    """Retourne l'explication d'un terme spécifique."""
    return GLOSSAIRE.get(terme)


def liste_termes() -> list:
    """Retourne la liste de tous les termes du glossaire."""
    return sorted(list(GLOSSAIRE.keys()))
