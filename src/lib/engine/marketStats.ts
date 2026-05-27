/**
 * Per-market lightweight rolling state for hardened filters.
 * Tracks short-horizon entropy baseline + dominance flip rate so the signal
 * engine can reject regime transitions without re-scanning the buffer.
 *
 * Pure data container — no I/O. Updated each tick on the active market.
 */
import type { MarketSymbol } from "../deriv/markets";

interface MarketStateRow {
  market: MarketSymbol;
  entropyBaseline: number;       // EWMA of long-window entropy
  entropyShortEwma: number;      // EWMA of short-window entropy
  lastTopDigit: number;
  dominanceFlips: number;        // rolling count over `flipWindow` updates
  flipWindow: number[];          // 0/1 ring of recent flip occurrences
  lastZAbs: number;
  zTrend: number;                // EWMA of (currentZ - lastZ)
  updates: number;
}

const FLIP_WINDOW = 40;
const ALPHA_BASELINE = 0.03;
const ALPHA_SHORT = 0.18;
const ALPHA_Z = 0.15;

export class MarketStateRegistry {
  private rows = new Map<MarketSymbol, MarketStateRow>();

  update(
    market: MarketSymbol,
    longEntropy: number,
    shortEntropy: number,
    topDigit: number,
    zAbs: number,
  ): MarketStateRow {
    let row = this.rows.get(market);
    if (!row) {
      row = {
        market,
        entropyBaseline: longEntropy,
        entropyShortEwma: shortEntropy,
        lastTopDigit: topDigit,
        dominanceFlips: 0,
        flipWindow: [],
        lastZAbs: zAbs,
        zTrend: 0,
        updates: 0,
      };
      this.rows.set(market, row);
      return row;
    }
    row.entropyBaseline = row.entropyBaseline * (1 - ALPHA_BASELINE) + longEntropy * ALPHA_BASELINE;
    row.entropyShortEwma = row.entropyShortEwma * (1 - ALPHA_SHORT) + shortEntropy * ALPHA_SHORT;
    const flipped = topDigit !== row.lastTopDigit ? 1 : 0;
    row.flipWindow.push(flipped);
    if (row.flipWindow.length > FLIP_WINDOW) row.flipWindow.shift();
    row.dominanceFlips = row.flipWindow.reduce((a, b) => a + b, 0);
    row.lastTopDigit = topDigit;
    const dz = zAbs - row.lastZAbs;
    row.zTrend = row.zTrend * (1 - ALPHA_Z) + dz * ALPHA_Z;
    row.lastZAbs = zAbs;
    row.updates += 1;
    return row;
  }

  get(market: MarketSymbol): MarketStateRow | undefined { return this.rows.get(market); }
}

export type { MarketStateRow };
