/**
 * Empirical outcome tracking for emitted MATCH signals.
 * Per-market isolation. Pure in-memory ring buffer; DB persistence lands in W1b.
 *
 * Evaluates each signal at +1, +2, +3, +5 ticks after emission and accumulates
 * per-market rolling statistics (totals, wins, EWMA, reversal, dominance survival).
 */
import type { Signal } from "./signals";
import type { MarketSymbol } from "../deriv/markets";

export type Horizon = "t1" | "t2" | "t3" | "t5";
export const HORIZONS: Horizon[] = ["t1", "t2", "t3", "t5"];

export interface SignalSnapshotMeta {
  entropy: number;
  dominantDigit: number;
  topMomentumDigit: number;
}

export interface PendingSignal {
  signal: Signal;
  emittedAtTick: number;
  ticksSeen: number;
  postDigits: number[];      // digits observed AFTER emission, in order
  outcomes: Partial<Record<Horizon, boolean>>;
  meta: SignalSnapshotMeta;
  resolved: boolean;
}

export interface MarketOutcomeStats {
  market: MarketSymbol;
  totals: Record<Horizon, number>;
  wins: Record<Horizon, number>;
  ewmaWin: Record<Horizon, number>;          // EWMA(α=0.1) of {0,1}
  reversalRate: number;                       // share where t1 win but t3 lost (signal collapsed quickly)
  avgDominanceSurvival: number;               // mean ticks until top-dominance digit changed in postDigits
  lastUpdated: number;
}

const HISTORY_CAP = 500;
const ALPHA = 0.1;

function emptyStats(market: MarketSymbol): MarketOutcomeStats {
  return {
    market,
    totals: { t1: 0, t2: 0, t3: 0, t5: 0 },
    wins:   { t1: 0, t2: 0, t3: 0, t5: 0 },
    ewmaWin:{ t1: 0, t2: 0, t3: 0, t5: 0 },
    reversalRate: 0,
    avgDominanceSurvival: 0,
    lastUpdated: 0,
  };
}

export class OutcomeTracker {
  private pending = new Map<MarketSymbol, PendingSignal[]>();
  private history = new Map<MarketSymbol, PendingSignal[]>();
  private stats   = new Map<MarketSymbol, MarketOutcomeStats>();
  private resolvedById = new Map<string, PendingSignal>();
  /** Bumped on every state change so React stores can detect updates cheaply. */
  public version = 0;

  track(signal: Signal, meta: SignalSnapshotMeta) {
    const ps: PendingSignal = {
      signal,
      emittedAtTick: signal.createdAtTick,
      ticksSeen: 0,
      postDigits: [],
      outcomes: {},
      meta,
      resolved: false,
    };
    const arr = this.pending.get(signal.market) ?? [];
    arr.push(ps);
    this.pending.set(signal.market, arr);
    this.version++;
  }

  /** Called for every tick on the active market. */
  onTick(market: MarketSymbol, digit: number) {
    const arr = this.pending.get(market);
    if (!arr || arr.length === 0) return;
    const stillPending: PendingSignal[] = [];
    let changed = false;
    for (const ps of arr) {
      ps.ticksSeen += 1;
      ps.postDigits.push(digit);
      const target = ps.signal.digit;
      if (ps.ticksSeen === 1) ps.outcomes.t1 = digit === target;
      if (ps.ticksSeen === 2) ps.outcomes.t2 = ps.outcomes.t2 ?? ps.postDigits.slice(0, 2).includes(target);
      if (ps.ticksSeen === 3) ps.outcomes.t3 = ps.outcomes.t3 ?? ps.postDigits.slice(0, 3).includes(target);
      if (ps.ticksSeen >= 5) {
        ps.outcomes.t1 = ps.outcomes.t1 ?? (ps.postDigits[0] === target);
        ps.outcomes.t2 = ps.outcomes.t2 ?? ps.postDigits.slice(0, 2).includes(target);
        ps.outcomes.t3 = ps.outcomes.t3 ?? ps.postDigits.slice(0, 3).includes(target);
        ps.outcomes.t5 = ps.postDigits.slice(0, 5).includes(target);
        ps.resolved = true;
        this.finalize(ps);
        changed = true;
      } else {
        stillPending.push(ps);
        changed = true;
      }
    }
    this.pending.set(market, stillPending);
    if (changed) this.version++;
  }

  private finalize(ps: PendingSignal) {
    const market = ps.signal.market;
    this.resolvedById.set(ps.signal.id, ps);
    const hist = this.history.get(market) ?? [];
    hist.push(ps);
    if (hist.length > HISTORY_CAP) hist.shift();
    this.history.set(market, hist);

    const s = this.stats.get(market) ?? emptyStats(market);
    for (const h of HORIZONS) {
      s.totals[h] += 1;
      const w = ps.outcomes[h] ? 1 : 0;
      s.wins[h] += w;
      s.ewmaWin[h] = s.totals[h] === 1 ? w : s.ewmaWin[h] * (1 - ALPHA) + w * ALPHA;
    }

    // Reversal: won at t1 but lost at t3.
    const reversals = hist.filter((p) => p.outcomes.t1 && !p.outcomes.t3).length;
    s.reversalRate = hist.length ? reversals / hist.length : 0;

    // Dominance survival: ticks until postDigits[i] != emission dominant
    const surv: number[] = [];
    for (const p of hist) {
      let i = 0;
      while (i < p.postDigits.length && p.postDigits[i] === p.meta.dominantDigit) i++;
      surv.push(i);
    }
    s.avgDominanceSurvival = surv.length ? surv.reduce((a, b) => a + b, 0) / surv.length : 0;
    s.lastUpdated = Date.now();
    this.stats.set(market, s);
  }

  getStats(market: MarketSymbol): MarketOutcomeStats | undefined { return this.stats.get(market); }
  getAllStats(): MarketOutcomeStats[] { return Array.from(this.stats.values()); }
  getResolved(signalId: string): PendingSignal | undefined { return this.resolvedById.get(signalId); }
  getPending(market: MarketSymbol): PendingSignal[] { return this.pending.get(market) ?? []; }
  getHistory(market: MarketSymbol): PendingSignal[] { return this.history.get(market) ?? []; }
}

export function winRate(stats: MarketOutcomeStats | undefined, h: Horizon): number | null {
  if (!stats || stats.totals[h] === 0) return null;
  return stats.wins[h] / stats.totals[h];
}
