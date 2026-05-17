/**
 * /calendar — Economic & Earnings Calendar (Phase 10)
 *
 * Layout:
 *  - Range selector  : 1W / 2W / 1M / 3M
 *  - Filter pills    : All | Macro | Earnings | 🔴 High impact
 *  - Timeline grouped by day
 *  - Event row       : impact dot · time · flag · title · prev/estimate
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
  type:     'macro' | 'earnings';
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
  events:          CalEvent[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatDayHeader(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'UTC',
  });
}

function isToday(iso: string): boolean {
  return iso === toISO(new Date());
}

function isTomorrow(iso: string): boolean {
  return iso === toISO(addDays(new Date(), 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Range config
// ─────────────────────────────────────────────────────────────────────────────

const RANGES = [
  { label: '1W',  days: 7   },
  { label: '2W',  days: 14  },
  { label: '1M',  days: 30  },
  { label: '3M',  days: 90  },
];

type FilterType = 'all' | 'macro' | 'earnings' | 'high';

const FILTERS: { id: FilterType; label: string }[] = [
  { id: 'all',      label: 'All'           },
  { id: 'macro',    label: 'Macro'         },
  { id: 'earnings', label: 'Earnings'      },
  { id: 'high',     label: '🔴 High impact' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ImpactDot({ impact }: { impact: CalEvent['impact'] }) {
  const cls =
    impact === 'high'   ? 'bg-red-500'
    : impact === 'medium' ? 'bg-yellow-400'
    : 'bg-green-500';
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

function ImpactBadge({ impact }: { impact: CalEvent['impact'] }) {
  if (impact === 'high') return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 uppercase tracking-wide shrink-0">
      HIGH
    </span>
  );
  if (impact === 'medium') return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-400/15 text-yellow-500 uppercase tracking-wide shrink-0">
      MED
    </span>
  );
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 uppercase tracking-wide shrink-0">
      LOW
    </span>
  );
}

function EventRow({ ev }: { ev: CalEvent }) {
  const isEarnings = ev.type === 'earnings';

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 border-b border-terminal-border last:border-0
                     hover:bg-terminal-surfaceHi transition-colors group
                     ${ev.impact === 'high' ? 'border-l-2 border-l-red-500/40' : ''}`}>

      {/* Impact dot */}
      <ImpactDot impact={ev.impact} />

      {/* Time */}
      <span className="num text-xs text-terminal-textDim w-16 shrink-0 tabular-nums">
        {ev.time !== '—' ? ev.time : '—'}
      </span>

      {/* Flag */}
      <span className="text-base w-6 text-center shrink-0">{ev.flag}</span>

      {/* Title */}
      <div className="flex-1 min-w-0">
        {isEarnings && ev.ticker ? (
          <Link
            href={`/instrument/${encodeURIComponent(ev.ticker)}`}
            className="text-sm font-medium text-terminal-text group-hover:text-terminal-cyan transition truncate block"
          >
            {ev.title}
          </Link>
        ) : (
          <span className="text-sm font-medium text-terminal-text truncate block">
            {ev.title}
          </span>
        )}
        <span className="text-xs text-terminal-textDim">{ev.country}</span>
      </div>

      {/* Impact badge */}
      <ImpactBadge impact={ev.impact} />

      {/* Values */}
      <div className="hidden sm:flex items-center gap-4 shrink-0 text-xs tabular-nums">
        {ev.actual != null ? (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-terminal-textDim uppercase">Actual</span>
            <span className="num font-semibold text-bull">{ev.actual}</span>
          </div>
        ) : ev.estimate != null ? (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-terminal-textDim uppercase">Est.</span>
            <span className="num font-medium text-terminal-textMuted">{ev.estimate}</span>
          </div>
        ) : (
          <div className="w-16" />
        )}

        {ev.previous != null && (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-terminal-textDim uppercase">Prev.</span>
            <span className="num text-terminal-textMuted">{ev.previous}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DayGroup({ date: iso, events }: { date: string; events: CalEvent[] }) {
  const label   = formatDayHeader(iso);
  const today   = isToday(iso);
  const tomorrow = isTomorrow(iso);
  const tag = today ? 'Today' : tomorrow ? 'Tomorrow' : null;

  const highCount = events.filter((e) => e.impact === 'high').length;

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-lg overflow-hidden">
      {/* Day header */}
      <div className="flex items-center justify-between px-4 py-2 bg-terminal-surfaceHi border-b border-terminal-border">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${today ? 'text-terminal-cyan' : 'text-terminal-text'}`}>
            {label}
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
          <span>{events.length} event{events.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Events */}
      <div>
        {events.map((ev, i) => (
          <EventRow key={i} ev={ev} />
        ))}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {[70, 90, 60].map((w, i) => (
        <div key={i} className="bg-terminal-surface border border-terminal-border rounded-lg overflow-hidden animate-pulse">
          <div className="h-9 bg-terminal-surfaceHi" />
          {Array.from({ length: 2 + (i % 2) }).map((_, j) => (
            <div key={j} className="flex items-center gap-3 px-4 py-2.5 border-b border-terminal-border last:border-0">
              <div className="w-2 h-2 rounded-full bg-terminal-border" />
              <div className="w-10 h-3 bg-terminal-border rounded" />
              <div className="w-5 h-4 bg-terminal-border rounded" />
              <div className={`h-3 bg-terminal-border rounded`} style={{ width: `${w}%` }} />
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
  const [rangeDays, setRangeDays] = useState(14);
  const [filter,    setFilter]    = useState<FilterType>('all');
  const [data,      setData]      = useState<CalendarResponse | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    const from = toISO(new Date());
    const to   = toISO(addDays(new Date(), days));
    try {
      const d = await apiFetch<CalendarResponse>(
        `/api/calendar?from_date=${from}&to_date=${to}`
      );
      setData(d);
    } catch (e: any) {
      setError(e?.message ?? 'Load error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(rangeDays); }, [rangeDays, load]);

  // Filter events
  const filtered = (data?.events ?? []).filter((ev) => {
    if (filter === 'macro')    return ev.type === 'macro';
    if (filter === 'earnings') return ev.type === 'earnings';
    if (filter === 'high')     return ev.impact === 'high';
    return true;
  });

  // Group by date
  const groups: Record<string, CalEvent[]> = {};
  for (const ev of filtered) {
    if (!groups[ev.date]) groups[ev.date] = [];
    groups[ev.date].push(ev);
  }
  const sortedDates = Object.keys(groups).sort();

  const totalHigh = filtered.filter((e) => e.impact === 'high').length;

  return (
    <>
      <Head>
        <title>Calendar — Monte Carlo v3</title>
      </Head>
      <div className="min-h-screen bg-terminal-bg text-terminal-text">
        <Header />

        <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">

          {/* Title */}
          <div>
            <h1 className="text-xl font-semibold text-terminal-text">
              Economic Calendar
            </h1>
            <p className="text-sm text-terminal-textMuted mt-0.5">
              Central bank decisions · Macro data releases · Earnings
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Range */}
            <div className="flex gap-1">
              {RANGES.map(({ label, days }) => (
                <button
                  key={days}
                  onClick={() => setRangeDays(days)}
                  className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                    rangeDays === days
                      ? 'bg-terminal-cyan text-terminal-bg font-semibold'
                      : 'bg-terminal-surface border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <span className="text-terminal-border">|</span>

            {/* Filter */}
            <div className="flex gap-1">
              {FILTERS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setFilter(id)}
                  className={`px-3 py-1.5 rounded text-xs transition-colors ${
                    filter === id
                      ? 'bg-terminal-surfaceHi border border-terminal-cyan text-terminal-cyan font-semibold'
                      : 'bg-terminal-surface border border-terminal-border text-terminal-textMuted hover:text-terminal-text hover:border-terminal-cyan'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Stats */}
            {data && !loading && (
              <span className="ml-auto text-xs text-terminal-textDim num">
                {filtered.length} events
                {totalHigh > 0 && (
                  <span className="ml-2 text-red-400">· {totalHigh} high impact</span>
                )}
              </span>
            )}
          </div>

          {/* No Finnhub key notice */}
          {data && !data.has_finnhub_key && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2.5 text-xs text-yellow-600 flex items-start gap-2">
              <span className="mt-0.5">⚠</span>
              <span>
                <strong>FINNHUB_API_KEY</strong> not set — showing central bank schedule only.
                Add a free key at <a href="https://finnhub.io" target="_blank" rel="noopener noreferrer" className="underline">finnhub.io</a> to get macro data releases and earnings.
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-bear-bg border border-bear-border rounded-lg px-4 py-3 text-sm text-bear">
              {error}
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs text-terminal-textDim">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> High impact</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> Medium</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Low</span>
            <span className="flex items-center gap-1.5 ml-4"><span>📊</span> Earnings — click ticker for instrument page</span>
          </div>

          {/* Content */}
          {loading ? (
            <Skeleton />
          ) : sortedDates.length === 0 ? (
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-10 text-center text-terminal-textDim">
              <div className="text-4xl mb-3 opacity-30 select-none">📅</div>
              <p className="text-sm">No events found for this range and filter.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedDates.map((d) => (
                <DayGroup key={d} date={d} events={groups[d]} />
              ))}
            </div>
          )}

        </main>
      </div>
    </>
  );
}
