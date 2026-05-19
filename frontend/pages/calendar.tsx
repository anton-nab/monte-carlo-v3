/**
 * /calendar — Economic, Earnings & Dividend Calendar
 *
 * Events:
 *   macro    — Central banks (FOMC/ECB/BOE/BOJ/SNB/RBA/BOC), CPI, NFP, GDP…
 *   earnings — Quarterly results (EPS vs estimates)
 *   dividend — Ex-dividend dates for major S&P 500 dividend payers
 *
 * Click any event → detail modal with:
 *   - What the indicator measures
 *   - Why markets care + typical reaction
 *   - Assets affected (indices, bonds, forex pairs)
 *   - Current values (prev / estimate / actual)
 */

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Header } from '../components/Header';
import { apiFetch } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CalEvent {
  date:     string;
  time:     string;
  type:     'macro' | 'earnings' | 'dividend';
  country:  string;
  flag:     string;
  title:    string;
  impact:   'high' | 'medium' | 'low';
  previous: string | null;
  estimate: string | null;
  actual:   string | null;
  ticker:   string | null;
}

interface CalendarResponse {
  from_date:       string;
  to_date:         string;
  n_events:        number;
  has_finnhub_key: boolean;
  has_dividends:   boolean;
  events:          CalEvent[];
}

interface EventInfo {
  what:    string;
  why:     string;
  assets:  { label: string; ticker: string }[];
  source:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event knowledge base
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_INFO: Record<string, EventInfo> = {
  fomc: {
    what: "Le Federal Open Market Committee (FOMC) se réunit 8 fois par an pour fixer le taux cible des federal funds — le taux auquel les banques américaines se prêtent entre elles au jour le jour. Ce taux est le levier principal de la politique monétaire américaine.",
    why:  "L'événement le plus scruté des marchés mondiaux. Une hausse renforce le dollar, pèse sur les actions (taux d'actualisation plus élevé) et pousse les rendements obligataires à la hausse. La conférence de presse du Président de la Fed et les projections 'dot plot' sont tout aussi importantes que la décision elle-même.",
    assets: [
      { label: "S&P 500",       ticker: "^GSPC"    },
      { label: "Nasdaq",        ticker: "^NDX"     },
      { label: "US 10Y Yield",  ticker: "^TNX"     },
      { label: "Gold",          ticker: "GC=F"     },
      { label: "EUR/USD",       ticker: "EURUSD=X" },
      { label: "GBP/USD",       ticker: "GBPUSD=X" },
      { label: "USD/JPY",       ticker: "JPY=X"    },
      { label: "USD/CHF",       ticker: "CHF=X"    },
      { label: "USD/CAD",       ticker: "CAD=X"    },
      { label: "VIX",           ticker: "^VIX"     },
    ],
    source: "Federal Reserve (Fed)",
  },
  ecb: {
    what: "La Banque Centrale Européenne (BCE) fixe les taux directeurs pour la zone euro (20 pays). Les trois taux clés sont : le taux de dépôt, le taux de refinancement et le taux de prêt marginal. La réunion comprend une conférence de presse de la Présidente.",
    why:  "Détermine les conditions de crédit pour ~350 millions d'Européens. Un changement de taux affecte l'euro, les obligations souveraines (OAT, Bund, BTP) et les actions européennes. La guidance prospective ('forward guidance') sur les prochaines réunions est souvent plus importante que la décision du jour.",
    assets: [
      { label: "EUR/USD",       ticker: "EURUSD=X" },
      { label: "EUR/GBP",       ticker: "EURGBP=X" },
      { label: "EUR/JPY",       ticker: "EURJPY=X" },
      { label: "EUR/CHF",       ticker: "EURCHF=X" },
      { label: "CAC 40 (ETF)",  ticker: "EWQ"      },
      { label: "DAX (ETF)",     ticker: "EWG"      },
    ],
    source: "Banque Centrale Européenne (BCE)",
  },
  boe: {
    what: "La Banque d'Angleterre (BoE) fixe le taux 'Bank Rate'. Le Comité de Politique Monétaire (MPC) vote à 9 membres, et le résultat du vote est publié simultanément avec la décision.",
    why:  "Impacte directement la livre sterling (GBP), les gilts (obligations d'État britanniques) et le marché immobilier britannique. Le vote du MPC (ex: 7-2 pour maintien) donne des signaux sur les décisions futures.",
    assets: [
      { label: "GBP/USD",       ticker: "GBPUSD=X" },
      { label: "EUR/GBP",       ticker: "EURGBP=X" },
      { label: "GBP/JPY",       ticker: "GBPJPY=X" },
      { label: "FTSE 100",      ticker: "^FTSE"    },
    ],
    source: "Bank of England (BoE)",
  },
  boj: {
    what: "La Banque du Japon (BOJ) contrôle sa politique monétaire historiquement ultra-accommodante. Elle surveille les taux d'intérêt, le contrôle de la courbe des taux ('Yield Curve Control', YCC) et les achats d'actifs.",
    why:  "Le yen (JPY) est une devise 'refuge' et une devise de carry trade majeure. Les décisions de la BOJ provoquent des mouvements violents sur le JPY et, par ricochet, sur tous les actifs risqués mondiaux via le dénouement des positions carry.",
    assets: [
      { label: "USD/JPY",       ticker: "JPY=X"    },
      { label: "EUR/JPY",       ticker: "EURJPY=X" },
      { label: "GBP/JPY",       ticker: "GBPJPY=X" },
      { label: "AUD/JPY",       ticker: "AUDJPY=X" },
      { label: "Nikkei 225",    ticker: "^N225"    },
    ],
    source: "Bank of Japan (BOJ)",
  },
  snb: {
    what: "La Banque Nationale Suisse (BNS/SNB) se réunit 4 fois par an pour fixer son taux directeur. La SNB surveille aussi activement le taux de change du franc suisse (CHF) pour éviter une sur-appréciation qui nuirait aux exportations suisses.",
    why:  "Le franc suisse est une valeur refuge mondiale. La SNB est connue pour intervenir directement sur les marchés de changes (vente de CHF) pour limiter l'appréciation du franc. Un discours hawkish renforce le CHF contre EUR et USD.",
    assets: [
      { label: "USD/CHF",       ticker: "CHF=X"    },
      { label: "EUR/CHF",       ticker: "EURCHF=X" },
      { label: "GBP/CHF",       ticker: "GBPCHF=X" },
      { label: "SMI (Swiss MI)", ticker: "^SSMI"   },
    ],
    source: "Swiss National Bank (SNB / BNS)",
  },
  rba: {
    what: "La Banque de Réserve d'Australie (RBA) fixe le taux directeur 'cash rate'. L'Australie est un grand exportateur de matières premières (minerai de fer, charbon), ce qui rend la politique monétaire de la RBA sensible aux prix des commodités et à la croissance chinoise.",
    why:  "L'AUD est une devise 'commodity currency' très corrélée aux prix du minerai de fer et à l'appétit pour le risque mondial. Une surprise hawkish de la RBA renforce l'AUD, particulièrement contre JPY (position carry trade populaire).",
    assets: [
      { label: "AUD/USD",       ticker: "AUDUSD=X" },
      { label: "AUD/JPY",       ticker: "AUDJPY=X" },
      { label: "AUD/NZD",       ticker: "AUDNZD=X" },
      { label: "ASX 200 (ETF)", ticker: "EWA"      },
    ],
    source: "Reserve Bank of Australia (RBA)",
  },
  boc: {
    what: "La Banque du Canada (BoC) fixe son taux directeur 'overnight rate'. Le Canada est un grand producteur de pétrole (WTI, WCS), ce qui lie étroitement la politique monétaire canadienne aux prix de l'énergie.",
    why:  "Le dollar canadien (CAD) est fortement corrélé aux prix du pétrole. Une hausse des taux BoC renforce le CAD (USD/CAD baisse). Surveille de près les données économiques américaines vu la forte interdépendance commerciale USA-Canada.",
    assets: [
      { label: "USD/CAD",       ticker: "CAD=X"    },
      { label: "EUR/CAD",       ticker: "EURCAD=X" },
      { label: "Crude Oil WTI", ticker: "CL=F"     },
      { label: "S&P/TSX (ETF)", ticker: "EWC"      },
    ],
    source: "Bank of Canada (BoC)",
  },
  cpi: {
    what: "L'Indice des Prix à la Consommation (CPI) mesure la variation du coût d'un panier de biens et services pour les ménages. Publié mensuellement par le BLS (US), Eurostat (EU) ou l'ONS (UK). Le 'core CPI' exclut l'alimentation et l'énergie pour mesurer l'inflation structurelle.",
    why:  "C'est le baromètre principal de l'inflation que les banques centrales cherchent à maintenir autour de 2%. Un CPI supérieur aux attentes pousse les marchés à anticiper des hausses de taux → baisse des actions, hausse du dollar et des rendements obligataires.",
    assets: [
      { label: "S&P 500",       ticker: "^GSPC"    },
      { label: "US 10Y Yield",  ticker: "^TNX"     },
      { label: "EUR/USD",       ticker: "EURUSD=X" },
      { label: "GBP/USD",       ticker: "GBPUSD=X" },
      { label: "USD/JPY",       ticker: "JPY=X"    },
      { label: "USD/CHF",       ticker: "CHF=X"    },
      { label: "Gold",          ticker: "GC=F"     },
    ],
    source: "Bureau of Labor Statistics (BLS) / Eurostat / ONS",
  },
  nonfarm: {
    what: "Les Non-Farm Payrolls (NFP) mesurent le nombre d'emplois créés en dehors de l'agriculture aux États-Unis, publiés le premier vendredi de chaque mois par le BLS. Comprend également le taux de chômage et la croissance des salaires horaires moyens.",
    why:  "L'un des indicateurs macro les plus volatils. Un chiffre fort signale une économie en surchauffe → la Fed pourrait monter ses taux → baisse des actions, hausse du dollar. Les révisions des mois précédents sont aussi importantes.",
    assets: [
      { label: "S&P 500",       ticker: "^GSPC"    },
      { label: "USD Index",     ticker: "DX-Y.NYB" },
      { label: "EUR/USD",       ticker: "EURUSD=X" },
      { label: "GBP/USD",       ticker: "GBPUSD=X" },
      { label: "USD/JPY",       ticker: "JPY=X"    },
      { label: "USD/CAD",       ticker: "CAD=X"    },
      { label: "US 10Y Yield",  ticker: "^TNX"     },
      { label: "Gold",          ticker: "GC=F"     },
    ],
    source: "Bureau of Labor Statistics (BLS)",
  },
  gdp: {
    what: "Le Produit Intérieur Brut (PIB) mesure la valeur totale des biens et services produits dans un pays. Publié en 3 versions : estimation préliminaire (flash), révision, et finale. La croissance réelle corrige l'effet de l'inflation.",
    why:  "Indicateur retardé de la santé économique. Deux trimestres consécutifs de PIB négatif = récession technique. Un PIB au-dessus des attentes soutient les actions et la devise nationale. Très surveillé pour le positionnement des banques centrales.",
    assets: [
      { label: "S&P 500",       ticker: "^GSPC"    },
      { label: "EUR/USD",       ticker: "EURUSD=X" },
      { label: "GBP/USD",       ticker: "GBPUSD=X" },
      { label: "USD/JPY",       ticker: "JPY=X"    },
      { label: "USD/CAD",       ticker: "CAD=X"    },
      { label: "AUD/USD",       ticker: "AUDUSD=X" },
    ],
    source: "Bureau of Economic Analysis (BEA) / Eurostat",
  },
  unemployment: {
    what: "Le taux de chômage mesure la part de la population active sans emploi qui en cherche activement un. Aux US, publié avec les NFP. En zone euro, publié séparément par Eurostat avec un décalage d'un mois.",
    why:  "Composante du double mandat de la Fed (plein emploi + stabilité des prix). Un chômage bas est généralement positif pour les actions mais peut pousser la Fed à être plus hawkish si les salaires accélèrent.",
    assets: [
      { label: "S&P 500",       ticker: "^GSPC"    },
      { label: "EUR/USD",       ticker: "EURUSD=X" },
      { label: "GBP/USD",       ticker: "GBPUSD=X" },
    ],
    source: "BLS (US) / Eurostat (EU) / ONS (UK)",
  },
  pmi: {
    what: "L'Indice des Directeurs d'Achat (PMI) est une enquête mensuelle auprès de directeurs d'achat d'entreprises. Un PMI > 50 = expansion, < 50 = contraction. Publié par S&P Global / ISM. Le PMI composite combine industrie et services.",
    why:  "Indicateur avancé (leading indicator) de l'activité économique — connu avant les données officielles de PIB. Les marchés y réagissent fortement car il préfigure les tendances. Un PMI manufacturier US < 48 peut signaler une récession industrielle.",
    assets: [
      { label: "S&P 500",       ticker: "^GSPC"    },
      { label: "EUR/USD",       ticker: "EURUSD=X" },
      { label: "GBP/USD",       ticker: "GBPUSD=X" },
      { label: "USD/JPY",       ticker: "JPY=X"    },
      { label: "AUD/USD",       ticker: "AUDUSD=X" },
    ],
    source: "S&P Global / ISM",
  },
  retail: {
    what: "Les ventes au détail mesurent les recettes totales des commerces de détail aux États-Unis (données mensuelles du Census Bureau). Le chiffre 'core' exclut les automobiles. Représente ~70% du PIB américain via la consommation.",
    why:  "Baromètre direct de la consommation, moteur principal de la croissance américaine. Un chiffre fort = économie résiliente = Fed moins encline à baisser les taux. Impact modéré sur les actions, plus fort sur le dollar et les rendements.",
    assets: [
      { label: "S&P 500 Cons.", ticker: "XLY"      },
      { label: "S&P 500",       ticker: "^GSPC"    },
      { label: "USD Index",     ticker: "DX-Y.NYB" },
      { label: "EUR/USD",       ticker: "EURUSD=X" },
      { label: "USD/JPY",       ticker: "JPY=X"    },
    ],
    source: "US Census Bureau",
  },
  ppi: {
    what: "L'Indice des Prix à la Production (PPI) mesure l'évolution des prix reçus par les producteurs pour leurs biens et services. Considéré comme un indicateur avancé du CPI, car les hausses de coûts de production se répercutent souvent sur les prix à la consommation.",
    why:  "Surveillé comme signal d'alerte précoce de l'inflation. Un PPI élevé suggère que le CPI pourrait monter dans les mois suivants. Impact plus faible que le CPI sur les marchés, mais significatif en période d'inquiétude inflationniste.",
    assets: [
      { label: "S&P 500",       ticker: "^GSPC"    },
      { label: "US 10Y Yield",  ticker: "^TNX"     },
      { label: "EUR/USD",       ticker: "EURUSD=X" },
      { label: "USD Index",     ticker: "DX-Y.NYB" },
    ],
    source: "Bureau of Labor Statistics (BLS)",
  },
  dividend_generic: {
    what: "La date d'ex-dividende (ex-date) est la date à partir de laquelle un acheteur de l'action N'a PAS droit au prochain dividende. Pour recevoir le dividende, vous devez détenir l'action AVANT cette date. La date de paiement intervient généralement 2 à 4 semaines après.",
    why:  "Le cours de l'action tend à baisser d'un montant proche du dividende à l'ouverture du jour d'ex-dividende (ajustement mécanique de prix). Les stratégies 'dividend capture' (achat avant / vente après) créent parfois de la volatilité. Attirent les investisseurs revenus et modifient la structure des détenteurs.",
    assets: [],
    source: "SEC Filing / Communiqué dividende de la société",
  },
  earnings_generic: {
    what: "Publication des résultats trimestriels : chiffre d'affaires, résultat net, BPA (bénéfice par action) comparés aux estimations des analystes. Inclut souvent des guidance sur les prochains trimestres.",
    why:  "L'action peut bouger de ±5 à ±20% dans les minutes suivant la publication, surtout en after-hours. Ce qui compte le plus : la 'surprise' (actual vs estimate) et la guidance. Un BPA en hausse mais avec une guidance décevante peut faire baisser le titre.",
    assets: [],
    source: "SEC Filing / Communiqué de presse de la société",
  },
};

function getEventInfo(title: string, type: string): EventInfo | null {
  const t = title.toLowerCase();
  if (t.includes('fomc') || t.includes('fed rate') || (t.includes('fed') && t.includes('rate')))
    return EVENT_INFO.fomc;
  if (t.includes('ecb') || (t.includes('european') && t.includes('rate')))
    return EVENT_INFO.ecb;
  if (t.includes('boe') || t.includes('bank of england') || t.includes('boe rate'))
    return EVENT_INFO.boe;
  if (t.includes('boj') || t.includes('bank of japan') || t.includes('boj rate'))
    return EVENT_INFO.boj;
  if (t.includes('snb') || t.includes('swiss national'))
    return EVENT_INFO.snb;
  if (t.includes('rba') || t.includes('reserve bank of australia'))
    return EVENT_INFO.rba;
  if (t.includes('boc') || t.includes('bank of canada'))
    return EVENT_INFO.boc;
  if (t.includes('cpi') || t.includes('inflation') || t.includes('consumer price'))
    return EVENT_INFO.cpi;
  if (t.includes('nonfarm') || t.includes('non-farm') || t.includes('nfp') || t.includes('payroll'))
    return EVENT_INFO.nonfarm;
  if (t.includes('gdp') || t.includes('gross domestic'))
    return EVENT_INFO.gdp;
  if (t.includes('unemployment') || t.includes('jobless'))
    return EVENT_INFO.unemployment;
  if (t.includes('pmi') || t.includes('purchasing manager') || t.includes('manufacturing index') || t.includes('services pmi'))
    return EVENT_INFO.pmi;
  if (t.includes('retail sales') || t.includes('retail'))
    return EVENT_INFO.retail;
  if (t.includes('ppi') || t.includes('producer price'))
    return EVENT_INFO.ppi;
  if (type === 'dividend')
    return EVENT_INFO.dividend_generic;
  if (type === 'earnings')
    return EVENT_INFO.earnings_generic;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function toISO(d: Date) { return d.toISOString().slice(0, 10); }

function formatDayHeader(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
function isToday(iso: string)    { return iso === toISO(new Date()); }
function isTomorrow(iso: string) { return iso === toISO(addDays(new Date(), 1)); }

const RANGES  = [{ label:'1W', days:7 }, { label:'2W', days:14 }, { label:'1M', days:30 }, { label:'3M', days:90 }];
type FilterType = 'all' | 'macro' | 'earnings' | 'dividend' | 'high';
const FILTERS: { id: FilterType; label: string }[] = [
  { id:'all',      label:'Tous'           },
  { id:'macro',    label:'Macro'          },
  { id:'earnings', label:'Earnings'       },
  { id:'dividend', label:'💰 Dividendes'  },
  { id:'high',     label:'🔴 High impact' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ImpactDot({ impact }: { impact: CalEvent['impact'] }) {
  const cls = impact === 'high' ? 'bg-red-500' : impact === 'medium' ? 'bg-yellow-400' : 'bg-green-500';
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

function ImpactBadge({ impact }: { impact: CalEvent['impact'] }) {
  if (impact === 'high')   return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 uppercase tracking-wide shrink-0">HIGH</span>;
  if (impact === 'medium') return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-400/15 text-yellow-500 uppercase tracking-wide shrink-0">MED</span>;
  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 uppercase tracking-wide shrink-0">LOW</span>;
}

/** Small type chip shown in the event row */
function TypeChip({ type }: { type: CalEvent['type'] }) {
  if (type === 'dividend')
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-terminal-cyan/10 text-terminal-cyan uppercase tracking-wide shrink-0">DIV</span>;
  if (type === 'earnings')
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 uppercase tracking-wide shrink-0">EPS</span>;
  return null;
}

function EventRow({
  ev,
  onClick,
}: {
  ev: CalEvent;
  onClick: (ev: CalEvent) => void;
}) {
  const info = getEventInfo(ev.title, ev.type);
  const isDividend = ev.type === 'dividend';

  return (
    <button
      onClick={() => onClick(ev)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 border-b border-terminal-border last:border-0
                  hover:bg-terminal-surfaceHi transition-colors text-left cursor-pointer
                  ${ev.impact === 'high' ? 'border-l-2 border-l-red-500/40' : ''}
                  ${isDividend ? 'border-l-2 border-l-terminal-cyan/30' : ''}`}
    >
      <ImpactDot impact={ev.impact} />
      <span className="num text-xs text-terminal-textDim w-16 shrink-0 tabular-nums">
        {ev.time !== '—' ? ev.time : '—'}
      </span>
      {/* Flag + country code — emoji seul sur mobile, + badge texte sur desktop */}
      <div className="flex items-center gap-1 shrink-0 w-14">
        <span className="text-base leading-none w-6 text-center">{ev.flag}</span>
        <span className="hidden sm:block text-[10px] font-mono font-semibold text-terminal-textMuted uppercase tracking-wide">
          {ev.country.length <= 3 ? ev.country : ev.country.slice(0, 2)}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-terminal-text truncate block">
          {ev.title}
        </span>
        <span className="text-xs text-terminal-textDim sm:hidden">{ev.country}</span>
      </div>
      <TypeChip type={ev.type} />
      <ImpactBadge impact={ev.impact} />
      <div className="hidden sm:flex items-center gap-4 shrink-0 text-xs tabular-nums">
        {ev.actual != null ? (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-terminal-textDim uppercase">Actual</span>
            <span className="num font-semibold text-bull">{ev.actual}</span>
          </div>
        ) : ev.estimate != null ? (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-terminal-textDim uppercase">
              {isDividend ? 'Dividende' : 'Est.'}
            </span>
            <span className="num font-medium text-terminal-textMuted">{ev.estimate}</span>
          </div>
        ) : <div className="w-16" />}
        {ev.previous != null && (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-terminal-textDim uppercase">Prev.</span>
            <span className="num text-terminal-textMuted">{ev.previous}</span>
          </div>
        )}
      </div>
      {info && (
        <span className="text-[10px] text-terminal-textDim shrink-0 hidden md:inline">
          détails →
        </span>
      )}
    </button>
  );
}

function DayGroup({
  date: iso,
  events,
  onEventClick,
}: {
  date: string;
  events: CalEvent[];
  onEventClick: (ev: CalEvent) => void;
}) {
  const today     = isToday(iso);
  const tomorrow  = isTomorrow(iso);
  const tag       = today ? 'Today' : tomorrow ? 'Tomorrow' : null;
  const highCount = events.filter((e) => e.impact === 'high').length;
  const divCount  = events.filter((e) => e.type === 'dividend').length;

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-terminal-surfaceHi border-b border-terminal-border">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${today ? 'text-terminal-cyan' : 'text-terminal-text'}`}>
            {formatDayHeader(iso)}
          </span>
          {tag && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-terminal-cyan/20 text-terminal-cyan uppercase tracking-wide">
              {tag}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-terminal-textDim">
          {highCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
              {highCount} high
            </span>
          )}
          {divCount > 0 && (
            <span className="flex items-center gap-1 text-terminal-cyan">
              💰 {divCount} div
            </span>
          )}
          <span>{events.length} event{events.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div>
        {events.map((ev, i) => (
          <EventRow key={i} ev={ev} onClick={onEventClick} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail Modal
// ─────────────────────────────────────────────────────────────────────────────

function EventModal({
  ev,
  onClose,
}: {
  ev: CalEvent;
  onClose: () => void;
}) {
  const info       = getEventInfo(ev.title, ev.type);
  const isDividend = ev.type === 'dividend';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative bg-terminal-bg border border-terminal-border rounded-xl shadow-2xl
                      w-full max-w-xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className={`sticky top-0 bg-terminal-bg border-b border-terminal-border px-5 py-4 flex items-start justify-between gap-3
                         ${ev.impact === 'high'   ? 'border-l-4 border-l-red-500'
                         : ev.impact === 'medium' ? 'border-l-4 border-l-yellow-400'
                         : isDividend             ? 'border-l-4 border-l-terminal-cyan'
                         : ''}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl">{ev.flag}</span>
              <h2 className="text-base font-semibold text-terminal-text">{ev.title}</h2>
              <TypeChip type={ev.type} />
              <ImpactBadge impact={ev.impact} />
            </div>
            <p className="text-xs text-terminal-textDim mt-1 num">
              {formatDayHeader(ev.date)} · {ev.time !== '—' ? `${ev.time} UTC` : 'Heure TBD'}
              {ev.country && ` · ${ev.country}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-terminal-textDim hover:text-terminal-text transition-colors shrink-0 text-lg leading-none mt-0.5"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">

          {/* Values */}
          {(ev.actual || ev.estimate || ev.previous) && (
            <div className="grid grid-cols-3 gap-3">
              {ev.actual && (
                <div className="bg-terminal-surface border border-terminal-border rounded-lg p-3 text-center">
                  <div className="text-[10px] text-terminal-textDim uppercase tracking-wide mb-1">Résultat</div>
                  <div className="num text-lg font-bold text-bull">{ev.actual}</div>
                </div>
              )}
              {ev.estimate && (
                <div className="bg-terminal-surface border border-terminal-border rounded-lg p-3 text-center">
                  <div className="text-[10px] text-terminal-textDim uppercase tracking-wide mb-1">
                    {isDividend ? 'Montant / action' : 'Estimé'}
                  </div>
                  <div className={`num text-lg font-semibold ${isDividend ? 'text-terminal-cyan' : 'text-terminal-textMuted'}`}>
                    {ev.estimate}
                  </div>
                </div>
              )}
              {ev.previous && (
                <div className="bg-terminal-surface border border-terminal-border rounded-lg p-3 text-center">
                  <div className="text-[10px] text-terminal-textDim uppercase tracking-wide mb-1">Précédent</div>
                  <div className="num text-lg font-semibold text-terminal-textMuted">{ev.previous}</div>
                </div>
              )}
            </div>
          )}

          {info ? (
            <>
              {/* What */}
              <div>
                <h3 className="text-xs font-semibold text-terminal-textDim uppercase tracking-widest mb-2">
                  📖 Qu&apos;est-ce que c&apos;est ?
                </h3>
                <p className="text-sm text-terminal-textMuted leading-relaxed">{info.what}</p>
              </div>

              {/* Why */}
              <div>
                <h3 className="text-xs font-semibold text-terminal-textDim uppercase tracking-widest mb-2">
                  📈 Pourquoi ça bouge les marchés ?
                </h3>
                <p className="text-sm text-terminal-textMuted leading-relaxed">{info.why}</p>
              </div>

              {/* Source */}
              <div className="flex items-center gap-2 text-xs text-terminal-textDim">
                <span>📡 Source :</span>
                <span className="text-terminal-textMuted font-medium">{info.source}</span>
              </div>

              {/* Affected assets — always show the action link for dividends */}
              {(info.assets.length > 0 || ev.ticker) && (
                <div>
                  <h3 className="text-xs font-semibold text-terminal-textDim uppercase tracking-widest mb-2">
                    🔗 {isDividend ? 'Action concernée' : 'Actifs typiquement affectés'}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {ev.ticker && (
                      <Link
                        href={`/instrument/${encodeURIComponent(ev.ticker)}`}
                        onClick={onClose}
                        className="px-3 py-1.5 rounded border border-terminal-cyan text-terminal-cyan text-xs font-mono
                                   hover:bg-terminal-cyan hover:text-terminal-bg transition-colors"
                      >
                        {ev.ticker} →
                      </Link>
                    )}
                    {info.assets.map((a) => (
                      <Link
                        key={a.ticker}
                        href={`/instrument/${encodeURIComponent(a.ticker)}`}
                        onClick={onClose}
                        className="px-3 py-1.5 rounded border border-terminal-border text-terminal-textMuted text-xs font-mono
                                   hover:border-terminal-cyan hover:text-terminal-cyan transition-colors"
                      >
                        {a.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-terminal-textDim italic">
              Pas de description détaillée disponible pour cet événement.
            </p>
          )}

        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {[2, 3, 2].map((n, i) => (
        <div key={i} className="bg-terminal-surface border border-terminal-border rounded-lg overflow-hidden animate-pulse">
          <div className="h-9 bg-terminal-surfaceHi" />
          {Array.from({ length: n }).map((_, j) => (
            <div key={j} className="flex items-center gap-3 px-4 py-2.5 border-b border-terminal-border last:border-0">
              <div className="w-2 h-2 rounded-full bg-terminal-border" />
              <div className="w-12 h-3 bg-terminal-border rounded" />
              <div className="w-5 h-4 bg-terminal-border rounded" />
              <div className="flex-1 h-3 bg-terminal-border rounded" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [rangeDays,      setRangeDays]      = useState(14);
  const [filter,         setFilter]         = useState<FilterType>('all');
  const [data,           setData]           = useState<CalendarResponse | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [selectedEvent,  setSelectedEvent]  = useState<CalEvent | null>(null);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    const from = toISO(new Date());
    const to   = toISO(addDays(new Date(), days));
    try {
      const d = await apiFetch<CalendarResponse>(`/api/calendar?from_date=${from}&to_date=${to}`);
      setData(d);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(rangeDays); }, [rangeDays, load]);

  // Close modal on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedEvent(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const filtered = (data?.events ?? []).filter((ev) => {
    if (filter === 'macro')    return ev.type === 'macro';
    if (filter === 'earnings') return ev.type === 'earnings';
    if (filter === 'dividend') return ev.type === 'dividend';
    if (filter === 'high')     return ev.impact === 'high';
    return true;
  });

  const groups: Record<string, CalEvent[]> = {};
  for (const ev of filtered) {
    if (!groups[ev.date]) groups[ev.date] = [];
    groups[ev.date].push(ev);
  }
  const sortedDates   = Object.keys(groups).sort();
  const totalHigh     = filtered.filter((e) => e.impact === 'high').length;
  const totalDividend = (data?.events ?? []).filter((e) => e.type === 'dividend').length;

  return (
    <>
      <Head><title>Calendar — Monte Carlo</title></Head>
      <div className="min-h-screen bg-terminal-bg text-terminal-text">
        <Header />

        <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">

          {/* Title */}
          <div>
            <h1 className="text-xl font-semibold text-terminal-text">Economic Calendar</h1>
            <p className="text-sm text-terminal-textMuted mt-0.5">
              Banques centrales · Publications macro · Earnings · Dividendes — cliquez sur un événement pour les détails
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {RANGES.map(({ label, days }) => (
                <button key={days} onClick={() => setRangeDays(days)}
                  className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                    rangeDays === days
                      ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                      : 'bg-terminal-surface border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            <span className="text-terminal-border">|</span>
            <div className="flex gap-1 flex-wrap">
              {FILTERS.map(({ id, label }) => (
                <button key={id} onClick={() => setFilter(id)}
                  className={`px-3 py-1.5 rounded text-xs transition-colors ${
                    filter === id
                      ? 'bg-terminal-surfaceHi border border-terminal-cyan text-terminal-cyan font-semibold'
                      : 'bg-terminal-surface border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            {data && !loading && (
              <span className="ml-auto text-xs text-terminal-textDim num">
                {filtered.length} events
                {totalHigh > 0    && <span className="ml-2 text-red-400">· {totalHigh} high</span>}
                {totalDividend > 0 && <span className="ml-2 text-terminal-cyan">· {totalDividend} div</span>}
              </span>
            )}
          </div>

          {/* No Finnhub key notice */}
          {data && !data.has_finnhub_key && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2.5 text-xs text-yellow-600 flex items-start gap-2">
              <span className="mt-0.5">⚠</span>
              <span>
                <strong>FINNHUB_API_KEY</strong> non configurée — calendrier des banques centrales uniquement.
                Ajoutez une clé gratuite sur <a href="https://finnhub.io" target="_blank" rel="noopener noreferrer" className="underline">finnhub.io</a> pour les publications macro et les earnings.
              </span>
            </div>
          )}

          {error && (
            <div className="bg-bear/10 border border-bear/40 rounded-lg px-4 py-3 text-sm text-bear">{error}</div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs text-terminal-textDim">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> High impact</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> Medium</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Low</span>
            <span className="flex items-center gap-1.5 text-terminal-cyan">💰 Ex-dividende</span>
            <span className="flex items-center gap-1.5 text-purple-400">EPS Earnings</span>
          </div>

          {/* Content */}
          {loading ? <Skeleton /> : sortedDates.length === 0 ? (
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-10 text-center text-terminal-textDim">
              <div className="text-4xl mb-3 opacity-30 select-none">📅</div>
              <p className="text-sm">Aucun événement pour cette plage et ce filtre.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedDates.map((d) => (
                <DayGroup key={d} date={d} events={groups[d]} onEventClick={setSelectedEvent} />
              ))}
            </div>
          )}

        </main>
      </div>

      {/* Detail modal */}
      {selectedEvent && (
        <EventModal ev={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </>
  );
}
