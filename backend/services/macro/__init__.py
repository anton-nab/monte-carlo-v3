"""
Macro data services
===================

Couche d'abstraction pour les donnees macroeconomiques globales.

Architecture (multi-provider):
    MacroService (orchestrateur)
        │
        ├── FredProvider   (US: Fed Reserve, gratuit illimite)
        ├── OECDProvider   (38 pays developpes, gratuit, pas de cle)
        ├── WorldBankProvider (Phase 1.5: tous pays, gratuit, slow)
        └── ECBProvider    (Phase 1.5: zone euro, gratuit)

Le frontend appelle MacroService — il ne sait pas (et ne doit pas savoir)
quel provider est utilise derriere. Ca permet de changer de source de
donnees sans toucher au frontend.

Usage:
    from services.macro.service import MacroService
    service = MacroService()
    indicator = await service.get_indicator(country='us', indicator='inflation')
"""
