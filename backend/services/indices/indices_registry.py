"""
Registry of supported global indices.

Each entry defines:
  - Metadata (name, region, currency)
  - Yahoo Finance ticker for index-level price
  - Wikipedia source for constituent scraping
  - Column names within the Wikipedia table

Sources:
  - Wikipedia (primary, free, good coverage)
  - Hardcoded fallback for indices with unstable Wikipedia pages
"""

from typing import Optional, List, Dict, Any

# ---------------------------------------------------------------------------
# Hardcoded fallbacks (for indices whose Wikipedia tables break often)
# ---------------------------------------------------------------------------

DOW30 = [
    {"ticker": "AAPL",  "name": "Apple",                    "sector": "Information Technology"},
    {"ticker": "AMGN",  "name": "Amgen",                    "sector": "Health Care"},
    {"ticker": "AMZN",  "name": "Amazon",                   "sector": "Consumer Discretionary"},
    {"ticker": "AXP",   "name": "American Express",         "sector": "Financials"},
    {"ticker": "BA",    "name": "Boeing",                   "sector": "Industrials"},
    {"ticker": "CAT",   "name": "Caterpillar",              "sector": "Industrials"},
    {"ticker": "CRM",   "name": "Salesforce",               "sector": "Information Technology"},
    {"ticker": "CSCO",  "name": "Cisco Systems",            "sector": "Information Technology"},
    {"ticker": "CVX",   "name": "Chevron",                  "sector": "Energy"},
    {"ticker": "DIS",   "name": "Walt Disney",              "sector": "Communication Services"},
    {"ticker": "DOW",   "name": "Dow Inc.",                 "sector": "Materials"},
    {"ticker": "GS",    "name": "Goldman Sachs",            "sector": "Financials"},
    {"ticker": "HD",    "name": "Home Depot",               "sector": "Consumer Discretionary"},
    {"ticker": "HON",   "name": "Honeywell",                "sector": "Industrials"},
    {"ticker": "IBM",   "name": "IBM",                      "sector": "Information Technology"},
    {"ticker": "JNJ",   "name": "Johnson & Johnson",        "sector": "Health Care"},
    {"ticker": "JPM",   "name": "JPMorgan Chase",           "sector": "Financials"},
    {"ticker": "KO",    "name": "Coca-Cola",                "sector": "Consumer Staples"},
    {"ticker": "MCD",   "name": "McDonald's",               "sector": "Consumer Discretionary"},
    {"ticker": "MMM",   "name": "3M",                       "sector": "Industrials"},
    {"ticker": "MRK",   "name": "Merck",                    "sector": "Health Care"},
    {"ticker": "MSFT",  "name": "Microsoft",                "sector": "Information Technology"},
    {"ticker": "NKE",   "name": "Nike",                     "sector": "Consumer Discretionary"},
    {"ticker": "NVDA",  "name": "NVIDIA",                   "sector": "Information Technology"},
    {"ticker": "PG",    "name": "Procter & Gamble",         "sector": "Consumer Staples"},
    {"ticker": "SHW",   "name": "Sherwin-Williams",         "sector": "Materials"},
    {"ticker": "TRV",   "name": "Travelers Companies",      "sector": "Financials"},
    {"ticker": "UNH",   "name": "UnitedHealth Group",       "sector": "Health Care"},
    {"ticker": "V",     "name": "Visa",                     "sector": "Financials"},
    {"ticker": "VZ",    "name": "Verizon",                  "sector": "Communication Services"},
    {"ticker": "WMT",   "name": "Walmart",                  "sector": "Consumer Staples"},
]

CAC40 = [
    {"ticker": "AI.PA",   "name": "Air Liquide",          "sector": "Materials"},
    {"ticker": "AIR.PA",  "name": "Airbus",               "sector": "Industrials"},
    {"ticker": "ALO.PA",  "name": "Alstom",               "sector": "Industrials"},
    {"ticker": "MT.AS",   "name": "ArcelorMittal",        "sector": "Materials"},
    {"ticker": "ATO.PA",  "name": "Atos",                 "sector": "Information Technology"},
    {"ticker": "CS.PA",   "name": "AXA",                  "sector": "Financials"},
    {"ticker": "BNP.PA",  "name": "BNP Paribas",          "sector": "Financials"},
    {"ticker": "EN.PA",   "name": "Bouygues",             "sector": "Industrials"},
    {"ticker": "CAP.PA",  "name": "Capgemini",            "sector": "Information Technology"},
    {"ticker": "CA.PA",   "name": "Carrefour",            "sector": "Consumer Staples"},
    {"ticker": "ACA.PA",  "name": "Crédit Agricole",      "sector": "Financials"},
    {"ticker": "BN.PA",   "name": "Danone",               "sector": "Consumer Staples"},
    {"ticker": "DSY.PA",  "name": "Dassault Systèmes",    "sector": "Information Technology"},
    {"ticker": "ENGI.PA", "name": "Engie",                "sector": "Utilities"},
    {"ticker": "EL.PA",   "name": "EssilorLuxottica",     "sector": "Health Care"},
    {"ticker": "RMS.PA",  "name": "Hermès",               "sector": "Consumer Discretionary"},
    {"ticker": "KER.PA",  "name": "Kering",               "sector": "Consumer Discretionary"},
    {"ticker": "OR.PA",   "name": "L'Oréal",              "sector": "Consumer Staples"},
    {"ticker": "LR.PA",   "name": "Legrand",              "sector": "Industrials"},
    {"ticker": "LVMH.PA", "name": "LVMH",                 "sector": "Consumer Discretionary"},
    {"ticker": "MC.PA",   "name": "LVMH (MC)",            "sector": "Consumer Discretionary"},
    {"ticker": "ML.PA",   "name": "Michelin",             "sector": "Consumer Discretionary"},
    {"ticker": "ORA.PA",  "name": "Orange",               "sector": "Communication Services"},
    {"ticker": "RI.PA",   "name": "Pernod Ricard",        "sector": "Consumer Staples"},
    {"ticker": "PUB.PA",  "name": "Publicis",             "sector": "Communication Services"},
    {"ticker": "RNO.PA",  "name": "Renault",              "sector": "Consumer Discretionary"},
    {"ticker": "SAF.PA",  "name": "Safran",               "sector": "Industrials"},
    {"ticker": "SGO.PA",  "name": "Saint-Gobain",         "sector": "Materials"},
    {"ticker": "SAN.PA",  "name": "Sanofi",               "sector": "Health Care"},
    {"ticker": "SU.PA",   "name": "Schneider Electric",   "sector": "Industrials"},
    {"ticker": "GLE.PA",  "name": "Société Générale",     "sector": "Financials"},
    {"ticker": "STLAM.MI","name": "Stellantis",           "sector": "Consumer Discretionary"},
    {"ticker": "STM.PA",  "name": "STMicroelectronics",   "sector": "Information Technology"},
    {"ticker": "TEP.PA",  "name": "Teleperformance",      "sector": "Industrials"},
    {"ticker": "HO.PA",   "name": "Thales",               "sector": "Industrials"},
    {"ticker": "TTE.PA",  "name": "TotalEnergies",        "sector": "Energy"},
    {"ticker": "URW.AS",  "name": "Unibail-Rodamco",      "sector": "Real Estate"},
    {"ticker": "VIE.PA",  "name": "Veolia",               "sector": "Utilities"},
    {"ticker": "DG.PA",   "name": "Vinci",                "sector": "Industrials"},
    {"ticker": "WLN.PA",  "name": "Worldline",            "sector": "Information Technology"},
]

# ---------------------------------------------------------------------------
# Main registry
# ---------------------------------------------------------------------------

INDICES_REGISTRY: Dict[str, Dict[str, Any]] = {
    # ── United States ───────────────────────────────────────────────────────
    "SP500": {
        "name": "S&P 500",
        "description": "500 largest US-listed companies by float-adjusted market cap",
        "region": "United States",
        "exchange": "NYSE / NASDAQ",
        "yf_ticker": "^GSPC",
        "currency": "USD",
        "flag": "🇺🇸",
        "source": "wikipedia",
        "wikipedia": {
            "url": "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
            "table_index": 0,
            "ticker_col": "Symbol",
            "name_col": "Security",
            "sector_col": "GICS Sector",
        },
    },
    "NDX": {
        "name": "Nasdaq 100",
        "description": "100 largest non-financial companies listed on the Nasdaq",
        "region": "United States",
        "exchange": "NASDAQ",
        "yf_ticker": "^NDX",
        "currency": "USD",
        "flag": "🇺🇸",
        "source": "wikipedia",
        "wikipedia": {
            "url": "https://en.wikipedia.org/wiki/Nasdaq-100",
            "table_index": 4,
            "ticker_col": "Ticker",
            "name_col": "Company",
            "sector_col": "GICS Sector",
        },
    },
    "DJI": {
        "name": "Dow Jones Industrial Average",
        "description": "30 large US industrial companies",
        "region": "United States",
        "exchange": "NYSE / NASDAQ",
        "yf_ticker": "^DJI",
        "currency": "USD",
        "flag": "🇺🇸",
        "source": "hardcoded",
        "hardcoded": DOW30,
    },
    "RUT": {
        "name": "Russell 2000",
        "description": "2000 smallest US companies in the Russell 3000",
        "region": "United States",
        "exchange": "NYSE / NASDAQ",
        "yf_ticker": "^RUT",
        "currency": "USD",
        "flag": "🇺🇸",
        "source": "none",  # Too many constituents, no Wikipedia table
    },
    # ── Europe ───────────────────────────────────────────────────────────────
    "CAC40": {
        "name": "CAC 40",
        "description": "40 largest French companies on Euronext Paris",
        "region": "France",
        "exchange": "Euronext Paris",
        "yf_ticker": "^FCHI",
        "currency": "EUR",
        "flag": "🇫🇷",
        "source": "hardcoded",
        "hardcoded": CAC40,
    },
    "DAX": {
        "name": "DAX 40",
        "description": "40 largest German companies on Frankfurt Stock Exchange",
        "region": "Germany",
        "exchange": "XETRA / Frankfurt",
        "yf_ticker": "^GDAXI",
        "currency": "EUR",
        "flag": "🇩🇪",
        "source": "wikipedia",
        "wikipedia": {
            "url": "https://en.wikipedia.org/wiki/DAX",
            "table_index": 3,
            "ticker_col": "Ticker",
            "name_col": "Company",
            "sector_col": "Prime Standard Sector",
        },
    },
    "FTSE100": {
        "name": "FTSE 100",
        "description": "100 largest companies listed on the London Stock Exchange",
        "region": "United Kingdom",
        "exchange": "London Stock Exchange",
        "yf_ticker": "^FTSE",
        "currency": "GBP",
        "flag": "🇬🇧",
        "source": "wikipedia",
        "wikipedia": {
            "url": "https://en.wikipedia.org/wiki/FTSE_100_Index",
            "table_index": 4,
            "ticker_col": "Ticker",
            "name_col": "Company",
            "sector_col": "FTSE ICB Sector[25]",
        },
    },
    "EUROSTOXX50": {
        "name": "EURO STOXX 50",
        "description": "50 largest Eurozone companies across 8 countries",
        "region": "Eurozone",
        "exchange": "Multiple EU exchanges",
        "yf_ticker": "^STOXX50E",
        "currency": "EUR",
        "flag": "🇪🇺",
        "source": "wikipedia",
        "wikipedia": {
            "url": "https://en.wikipedia.org/wiki/EURO_STOXX_50",
            "table_index": 3,
            "ticker_col": "Ticker",
            "name_col": "Company",
            "sector_col": "Sector",
        },
    },
    "SMI": {
        "name": "SMI (Swiss Market Index)",
        "description": "20 largest Swiss companies",
        "region": "Switzerland",
        "exchange": "SIX Swiss Exchange",
        "yf_ticker": "^SSMI",
        "currency": "CHF",
        "flag": "🇨🇭",
        "source": "wikipedia",
        "wikipedia": {
            "url": "https://en.wikipedia.org/wiki/Swiss_Market_Index",
            "table_index": 1,
            "ticker_col": "Ticker",
            "name_col": "Company",
            "sector_col": "Sector",
        },
    },
    "IBEX35": {
        "name": "IBEX 35",
        "description": "35 largest Spanish companies on BME",
        "region": "Spain",
        "exchange": "BME",
        "yf_ticker": "^IBEX",
        "currency": "EUR",
        "flag": "🇪🇸",
        "source": "wikipedia",
        "wikipedia": {
            "url": "https://en.wikipedia.org/wiki/IBEX_35",
            "table_index": 2,
            "ticker_col": "Ticker",
            "name_col": "Company",
            "sector_col": "Sector",
        },
    },
    # ── Asia-Pacific ─────────────────────────────────────────────────────────
    "NIKKEI225": {
        "name": "Nikkei 225",
        "description": "225 largest Japanese companies on Tokyo Stock Exchange",
        "region": "Japan",
        "exchange": "Tokyo Stock Exchange",
        "yf_ticker": "^N225",
        "currency": "JPY",
        "flag": "🇯🇵",
        "source": "none",  # Complex ticker format (4-digit + .T), no clean Wikipedia table
    },
    "HSI": {
        "name": "Hang Seng Index",
        "description": "80 largest companies on Hong Kong Stock Exchange",
        "region": "Hong Kong",
        "exchange": "HKEX",
        "yf_ticker": "^HSI",
        "currency": "HKD",
        "flag": "🇭🇰",
        "source": "none",
    },
    "NIFTY50": {
        "name": "Nifty 50",
        "description": "50 largest Indian companies on NSE",
        "region": "India",
        "exchange": "NSE",
        "yf_ticker": "^NSEI",
        "currency": "INR",
        "flag": "🇮🇳",
        "source": "none",
    },
    "ASX200": {
        "name": "S&P/ASX 200",
        "description": "200 largest companies on the Australian Securities Exchange",
        "region": "Australia",
        "exchange": "ASX",
        "yf_ticker": "^AXJO",
        "currency": "AUD",
        "flag": "🇦🇺",
        "source": "none",
    },
    # ── Americas (non-US) ────────────────────────────────────────────────────
    "TSX60": {
        "name": "S&P/TSX 60",
        "description": "60 largest Canadian companies",
        "region": "Canada",
        "exchange": "TSX",
        "yf_ticker": "^TSX",
        "currency": "CAD",
        "flag": "🇨🇦",
        "source": "none",
    },
    "BOVESPA": {
        "name": "Bovespa (Ibovespa)",
        "description": "~87 most liquid stocks on B3 (Brazilian exchange)",
        "region": "Brazil",
        "exchange": "B3",
        "yf_ticker": "^BVSP",
        "currency": "BRL",
        "flag": "🇧🇷",
        "source": "none",
    },
}


def get_index(symbol: str) -> Optional[Dict[str, Any]]:
    """Return index config or None."""
    return INDICES_REGISTRY.get(symbol.upper())


def list_all() -> List[Dict[str, Any]]:
    """Return all indices as a list (with symbol injected)."""
    return [
        {**v, "symbol": k}
        for k, v in INDICES_REGISTRY.items()
    ]
