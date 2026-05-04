"""
API routers package.

Chaque sous-module definit un router FastAPI prefixe.
Les routers sont inclus dans main.py via app.include_router(...).

Structure:
    api/
    ├── macro.py     /api/macro/*    (Phase 1)
    ├── company.py   /api/company/*  (Phase 2)
    └── monte_carlo.py /api/mc/*     (Phase 3)
"""
