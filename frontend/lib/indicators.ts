/**
 * lib/indicators.ts
 * ─────────────────
 * Pure TypeScript technical indicator math.
 *
 * EMA / RSI / MACD / Bollinger accept close-price arrays and return
 * (number | null)[] — null during warm-up (insufficient data).
 *
 * CVD accepts full OHLCV bars — no warm-up period, no nulls.
 *
 * No external dependencies.
 */

// ─────────────────────────────────────────────────────────────────────────────
// EMA  (Exponential Moving Average)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes EMA for a given period.
 * Uses SMA as the seed for the first EMA value, then applies the
 * standard smoothing factor k = 2 / (period + 1).
 */
export function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;

  const k = 2 / (period + 1);

  // Seed: SMA of first `period` values
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  result[period - 1] = seed / period;

  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + (result[i - 1] as number) * (1 - k);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// RSI  (Relative Strength Index, Wilder's smoothing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes RSI(period) using Wilder's smoothed average gain/loss method.
 * Returns values in [0, 100]. First valid value is at index `period`.
 */
export function rsi(values: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return result;

  // Seed averages
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));

  // Wilder smoothing
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MACD  (Moving Average Convergence/Divergence)
// ─────────────────────────────────────────────────────────────────────────────

export interface MacdResult {
  macd:   (number | null)[];
  signal: (number | null)[];
  hist:   (number | null)[];
}

/**
 * MACD = EMA(fast) − EMA(slow)
 * Signal = EMA(macd, signal_period)
 * Histogram = MACD − Signal
 *
 * Default params: 12 / 26 / 9
 */
export function macd(
  values: number[],
  fast   = 12,
  slow   = 26,
  signal = 9,
): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);

  // MACD line
  const macdLine: (number | null)[] = values.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null
      ? (emaFast[i] as number) - (emaSlow[i] as number)
      : null,
  );

  // Signal line = EMA(9) of MACD, starting from first non-null MACD value
  const signalLine: (number | null)[] = new Array(values.length).fill(null);
  const firstIdx = macdLine.findIndex((v) => v !== null);

  if (firstIdx !== -1 && firstIdx + signal - 1 < values.length) {
    const k = 2 / (signal + 1);

    // Seed: SMA of first `signal` MACD values
    let sigVal = 0;
    for (let i = firstIdx; i < firstIdx + signal; i++) {
      sigVal += macdLine[i] as number;
    }
    sigVal /= signal;
    signalLine[firstIdx + signal - 1] = sigVal;

    for (let i = firstIdx + signal; i < values.length; i++) {
      sigVal = (macdLine[i] as number) * k + sigVal * (1 - k);
      signalLine[i] = sigVal;
    }
  }

  // Histogram = MACD − Signal
  const histLine: (number | null)[] = values.map((_, i) =>
    macdLine[i] !== null && signalLine[i] !== null
      ? (macdLine[i] as number) - (signalLine[i] as number)
      : null,
  );

  return { macd: macdLine, signal: signalLine, hist: histLine };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bollinger Bands
// ─────────────────────────────────────────────────────────────────────────────

export interface BollingerResult {
  upper:  (number | null)[];
  middle: (number | null)[];  // SMA
  lower:  (number | null)[];
}

/**
 * Bollinger Bands = SMA(period) ± stdDev × σ(period)
 * Default: period=20, stdDev=2
 */
export function bollinger(
  values:  number[],
  period   = 20,
  stdDev   = 2,
): BollingerResult {
  const upper:  (number | null)[] = new Array(values.length).fill(null);
  const middle: (number | null)[] = new Array(values.length).fill(null);
  const lower:  (number | null)[] = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean  = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    middle[i] = mean;
    upper[i]  = mean + stdDev * sd;
    lower[i]  = mean - stdDev * sd;
  }
  return { upper, middle, lower };
}

// ─────────────────────────────────────────────────────────────────────────────
// CVD  (Cumulative Volume Delta)
// ─────────────────────────────────────────────────────────────────────────────

export interface CvdPoint {
  /** Running cumulative delta at this bar */
  cvd:   number;
  /**
   * Individual bar delta (buying − selling pressure).
   * Positive → buyers dominated; negative → sellers dominated.
   */
  delta: number;
}

/**
 * CVD — Cumulative Volume Delta
 *
 * Per-bar delta approximation using the High-Low-Close method (no tick data):
 *   delta_i = volume_i × (2 × (close_i − low_i) / (high_i − low_i) − 1)
 *
 * Interpretation of delta:
 *   close = high    → delta = +volume  (100% buying pressure)
 *   close = low     → delta = −volume  (100% selling pressure)
 *   close = midpoint → delta = 0       (balanced)
 *
 * CVD = running cumulative sum of all deltas.
 *   Rising CVD  → net accumulation (buyers in control)
 *   Falling CVD → net distribution (sellers in control)
 *   Divergence from price → potential reversal signal
 *
 * Returns one CvdPoint per input bar — no warm-up period.
 */
export function cvd(
  bars: { open: number; high: number; low: number; close: number; volume: number }[],
): CvdPoint[] {
  const result: CvdPoint[] = [];
  let cumulative = 0;

  for (const bar of bars) {
    const range = bar.high - bar.low;
    // Guard against zero-range candles (doji, gaps at open)
    const d = range > 1e-10
      ? bar.volume * (2 * (bar.close - bar.low) / range - 1)
      : 0;
    cumulative += d;
    result.push({ cvd: cumulative, delta: d });
  }

  return result;
}
