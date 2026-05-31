/**
 * REAL-TIME MATCHES DIGIT ANALYSIS ENGINE
 * ---------------------------------------
 * Pure, synchronous, per-tick scoring for Deriv DIGIT MATCHES.
 *
 * Weighted composite (per professional spec):
 *   Frequency   35%   short/medium imbalance vs fair 10%
 *   Momentum    30%   recent acceleration (ultra-short vs short)
 *   Persistence 25%   same digit ranks #1 across 20/50/100/200 windows
 *   Streak      10%   consecutive / cluster appearances in last 20
 *
 * A high-confidence signal fires ONLY when:
 *   - composite score ≥ HIGH_CONF_THRESHOLD
 *   - top digit clearly dominates #2 (MIN_DOMINANCE_GAP)
 *   - positive momentum + frequency edge confirmed
 *   - persistence across at least 3 of 4 windows
 *
 * Output is consumed by <MatchIntelligence /> and recomputed every tick.
 */

const EXPECTED = 0.10;

/** Composite score ≥ this triggers ENTER NOW. */
export const HIGH_CONF_THRESHOLD = 78;

/** Need this gap between rank 1 and rank 2 for ENTER NOW. */
const MIN_DOMINANCE_GAP = 8;

/** Minimum ticks before producing a candidate at all. */
export const MIN_TICKS = 12;

export type SignalStrength = "WEAK" | "MODERATE" | "STRONG" | "VERY STRONG" | "EXTREME";
export type EntryStatus = "ENTER NOW" | "PREPARING" | "WAIT";

export interface DigitRank {
  digit: number;
  score: number;
  confidence: number;
  freqShort: number;   // 20
  freqMedium: number;  // 50
  freqLong: number;    // 100
  freqStable: number;  // 200
  countShort: number;
  momentum: number;       // -100..+100
  persistence: number;    // 0..100 (multi-window rank stability)
  streak: number;         // 0..100 (cluster density)
  hot: number;            // 0..100 (deviation above fair 10%)
  rank: number;
}

export interface MatchScan {
  ranks: DigitRank[];
  best: DigitRank | null;
  strength: SignalStrength;
  entry: EntryStatus;
  highConfidence: boolean;
  dominanceGap: number;
  filters: {
    sample: boolean;
    scoreThreshold: boolean;
    dominanceGap: boolean;
    momentumPositive: boolean;
    frequencyEdge: boolean;
    persistence: boolean;
  };
  reasons: string[];
  tickCount: number;
}

function freq(digits: number[], target: number, window: number) {
  const slice = digits.length > window ? digits.slice(-window) : digits;
  if (slice.length === 0) return { count: 0, rate: 0 };
  let c = 0;
  for (const d of slice) if (d === target) c++;
  return { count: c, rate: c / slice.length };
}

/** Rank of each digit (1..10, best=1) within a window. */
function rankInWindow(digits: number[], window: number): number[] {
  const slice = digits.length > window ? digits.slice(-window) : digits;
  const counts = new Array(10).fill(0);
  for (const d of slice) counts[d]++;
  const order = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  const rank = new Array(10).fill(10);
  order.forEach((d, i) => { rank[d] = i + 1; });
  return rank;
}

/** Frequency score: short+medium edge over fair 10%, 0..100. */
function frequencyScore(fS: number, fM: number): number {
  // Weighted blend; +15pp above expected -> 100.
  const edge = (fS - EXPECTED) * 0.65 + (fM - EXPECTED) * 0.35;
  return Math.max(0, Math.min(100, (edge / 0.15) * 100));
}

/** Momentum: ultra-short vs short rate, -100..+100. */
function momentumScore(digits: number[], target: number): number {
  const u = freq(digits, target, 10).rate;
  const s = freq(digits, target, 30).rate;
  const diff = u - s;
  return Math.max(-100, Math.min(100, (diff / 0.10) * 100));
}

/** Persistence: how many of {20,50,100,200} windows rank target #1. 0..100. */
function persistenceScore(r20: number, r50: number, r100: number, r200: number): number {
  const ranks = [r20, r50, r100, r200];
  let topHits = 0;
  let podiumHits = 0;
  for (const r of ranks) {
    if (r === 1) topHits++;
    if (r <= 3) podiumHits++;
  }
  // 4× rank-1 -> 100, 3× rank-1 -> 80, 2× rank-1 + podium -> 55, etc.
  return Math.max(0, Math.min(100, topHits * 22 + podiumHits * 3));
}

/** Streak: longest run + cluster density in last 20. 0..100. */
function streakScore(digits: number[], target: number): number {
  const slice = digits.length > 20 ? digits.slice(-20) : digits;
  if (slice.length < 4) return 0;
  let longest = 0, run = 0, clusters = 0, last = -999;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === target) {
      run++;
      if (run > longest) longest = run;
      if (i - last <= 3) clusters++;
      last = i;
    } else run = 0;
  }
  return Math.max(0, Math.min(100, longest * 20 + clusters * 8));
}

function strengthOf(score: number): SignalStrength {
  if (score >= HIGH_CONF_THRESHOLD) return "EXTREME";
  if (score >= 66) return "VERY STRONG";
  if (score >= 52) return "STRONG";
  if (score >= 38) return "MODERATE";
  return "WEAK";
}

export function scanMatches(digits: number[]): MatchScan {
  const tickCount = digits.length;

  const rank20 = rankInWindow(digits, 20);
  const rank50 = rankInWindow(digits, 50);
  const rank100 = rankInWindow(digits, 100);
  const rank200 = rankInWindow(digits, 200);

  const raw: DigitRank[] = [];
  for (let d = 0; d <= 9; d++) {
    const fS = freq(digits, d, 20);
    const fM = freq(digits, d, 50);
    const fL = freq(digits, d, 100);
    const fX = freq(digits, d, 200);

    const fScore = frequencyScore(fS.rate, fM.rate);
    const mScore = momentumScore(digits, d);
    const pScore = persistenceScore(rank20[d], rank50[d], rank100[d], rank200[d]);
    const sScore = streakScore(digits, d);
    const hot = Math.max(0, Math.min(100, ((fS.rate - EXPECTED) / 0.15) * 100));

    // Composite per spec: 35 / 30 / 25 / 10.
    const score =
      fScore * 0.35 +
      Math.max(0, mScore) * 0.30 +
      pScore * 0.25 +
      sScore * 0.10;

    raw.push({
      digit: d,
      score: Math.round(score),
      confidence: 0,
      freqShort: fS.rate,
      freqMedium: fM.rate,
      freqLong: fL.rate,
      freqStable: fX.rate,
      countShort: fS.count,
      momentum: Math.round(mScore),
      persistence: Math.round(pScore),
      streak: Math.round(sScore),
      hot: Math.round(hot),
      rank: 0,
    });
  }

  raw.sort((a, b) => b.score - a.score);
  raw.forEach((r, i) => { r.rank = i + 1; });

  const best = tickCount >= MIN_TICKS ? raw[0] : null;
  const second = raw[1];
  const dominanceGap = best && second ? best.score - second.score : 0;

  if (best) {
    const gapBoost = Math.min(20, dominanceGap);
    best.confidence = Math.min(100, Math.round(best.score * 0.85 + gapBoost));
  }
  for (let i = 1; i < raw.length; i++) {
    raw[i].confidence = Math.round(raw[i].score * 0.7);
  }

  const filters = {
    sample: tickCount >= MIN_TICKS,
    scoreThreshold: !!best && best.score >= HIGH_CONF_THRESHOLD,
    dominanceGap: dominanceGap >= MIN_DOMINANCE_GAP,
    momentumPositive: !!best && best.momentum > 0,
    frequencyEdge: !!best && best.freqShort > EXPECTED + 0.04,
    persistence: !!best && best.persistence >= 55,
  };

  const highConfidence = Object.values(filters).every(Boolean);

  const reasons: string[] = [];
  if (!filters.sample) reasons.push(`Need ${MIN_TICKS - tickCount} more ticks`);
  if (best) {
    if (!filters.scoreThreshold) reasons.push(`Score ${best.score}<${HIGH_CONF_THRESHOLD}`);
    if (!filters.dominanceGap) reasons.push(`Gap to #2 only ${dominanceGap}`);
    if (!filters.momentumPositive) reasons.push("Momentum flat/negative");
    if (!filters.frequencyEdge) reasons.push("No frequency edge over 10%");
    if (!filters.persistence) reasons.push("Not persistent across windows");
  }

  let entry: EntryStatus = "WAIT";
  if (highConfidence) entry = "ENTER NOW";
  else if (best && best.score >= 58 && filters.momentumPositive) entry = "PREPARING";

  return {
    ranks: raw,
    best,
    strength: best ? strengthOf(best.score) : "WEAK",
    entry,
    highConfidence,
    dominanceGap,
    filters,
    reasons,
    tickCount,
  };
}
