/**
 * REAL-TIME MATCHES DIGIT ANALYSIS ENGINE
 * ---------------------------------------
 * Pure, synchronous, per-tick scoring for Deriv DIGIT MATCHES.
 *
 * Philosophy:
 *  - No prediction. No AI. No guessing.
 *  - Every incoming tick recomputes a transparent statistical score for
 *    each digit 0–9 across multiple rolling windows.
 *  - The strongest digit becomes the current trade candidate.
 *  - A HIGH-CONFIDENCE FILTER (score ≥ HIGH_CONF_THRESHOLD) decides
 *    whether to surface an ENTER NOW signal — otherwise the system
 *    stays silent.
 *
 * Score components (each 0..100, then weighted):
 *   frequency   — short-window appearance rate vs expected 10%
 *   momentum    — short freq vs medium freq (is it accelerating?)
 *   recency     — exponentially weighted recent appearances
 *   hot         — deviation above expected 10% across windows
 *   pattern     — clustering / repetition density in last 20 ticks
 *
 * Output is consumed by <MatchIntelligence /> and updated every tick.
 */

/** Expected probability of any one digit on a fair stream. */
const EXPECTED = 0.10;

/** Score ≥ this triggers ENTER NOW. Tunable. */
export const HIGH_CONF_THRESHOLD = 98;

/** Minimum ticks before we even bother ranking (avoids cold-start noise). */
export const MIN_TICKS = 20;

/** Required gap between rank 1 and rank 2 for a HIGH-CONFIDENCE signal. */
const MIN_DOMINANCE_GAP = 10;

export type SignalStrength = "WEAK" | "MODERATE" | "STRONG" | "VERY STRONG" | "EXTREME";
export type EntryStatus = "ENTER NOW" | "PREPARING" | "WAIT";

export interface DigitRank {
  digit: number;
  score: number;            // 0..100 composite
  confidence: number;       // 0..100, score-dominance weighted
  freqShort: number;        // last 20
  freqMedium: number;       // last 50
  freqLong: number;         // last 100
  freqStable: number;       // last 300
  countShort: number;
  momentum: number;         // -100..+100
  recency: number;          // 0..100
  hot: number;              // 0..100
  pattern: number;          // 0..100
  rank: number;             // 1..10
}

export interface MatchScan {
  ranks: DigitRank[];                // sorted desc by score, length 10
  best: DigitRank | null;            // ranks[0] or null if not enough data
  strength: SignalStrength;
  entry: EntryStatus;
  highConfidence: boolean;           // best.score >= HIGH_CONF_THRESHOLD + filters
  dominanceGap: number;              // best.score - second.score
  filters: {
    rankedFirst: boolean;
    scoreThreshold: boolean;
    momentumShort: boolean;
    momentumMedium: boolean;
    frequencyEdge: boolean;
    patternRepetition: boolean;
    clustering: boolean;
    dominanceGap: boolean;
    sample: boolean;
  };
  reasons: string[];                  // why we're NOT firing
  tickCount: number;
}

function frequency(digits: number[], target: number, window: number): { count: number; rate: number } {
  const slice = digits.length > window ? digits.slice(-window) : digits;
  if (slice.length === 0) return { count: 0, rate: 0 };
  let c = 0;
  for (const d of slice) if (d === target) c++;
  return { count: c, rate: c / slice.length };
}

/**
 * Exponentially weighted recency score: recent ticks dominate.
 * Weight w_i = exp(-i / tau) for the i-th most recent tick (i=0 = newest).
 * Returns 0..100.
 */
function recencyScore(digits: number[], target: number, window = 30, tau = 8): number {
  const slice = digits.length > window ? digits.slice(-window) : digits;
  if (slice.length === 0) return 0;
  let num = 0;
  let denom = 0;
  for (let idx = 0; idx < slice.length; idx++) {
    const ageFromNewest = slice.length - 1 - idx;
    const w = Math.exp(-ageFromNewest / tau);
    denom += w;
    if (slice[idx] === target) num += w;
  }
  const weightedRate = denom > 0 ? num / denom : 0;
  // Scale: 0% -> 0, 10% (expected) -> 50, 25%+ -> 100.
  return Math.max(0, Math.min(100, (weightedRate / 0.25) * 100));
}

/**
 * Pattern / clustering score: counts repeated appearances within last 20.
 * Rewards back-to-back or near-back-to-back occurrences of the digit.
 */
function patternScore(digits: number[], target: number, window = 20): number {
  const slice = digits.length > window ? digits.slice(-window) : digits;
  if (slice.length < 4) return 0;
  let clusters = 0;
  let lastIdx = -999;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === target) {
      if (i - lastIdx <= 3) clusters += 1; // tight cluster
      lastIdx = i;
    }
  }
  // 0 clusters -> 0, 5+ clusters -> 100
  return Math.max(0, Math.min(100, clusters * 20));
}

/**
 * Momentum: short-window rate vs medium-window rate.
 * Positive => accelerating, negative => decaying.
 * Returns -100..+100.
 */
function momentumScore(shortRate: number, mediumRate: number): number {
  const diff = shortRate - mediumRate; // typically in [-1, 1] but small
  // Scale: ±10pp diff = ±100.
  return Math.max(-100, Math.min(100, (diff / 0.10) * 100));
}

/**
 * Hot score: how much the digit's frequency exceeds the fair 10% baseline,
 * blended across short and medium windows. Returns 0..100.
 */
function hotScore(freqShort: number, freqMedium: number): number {
  const edge = (freqShort - EXPECTED) * 0.6 + (freqMedium - EXPECTED) * 0.4;
  // +10pp above expected -> 100. Negative deviation clamped to 0.
  return Math.max(0, Math.min(100, (edge / 0.10) * 100));
}

/** Frequency score: short-window rate vs expected 10%, in 0..100. */
function freqScoreOf(freqShort: number): number {
  // 10% -> 50, 25%+ -> 100, 0% -> 0
  return Math.max(0, Math.min(100, (freqShort / 0.25) * 100));
}

function strengthOf(score: number): SignalStrength {
  if (score >= HIGH_CONF_THRESHOLD) return "EXTREME";
  if (score >= 81) return "VERY STRONG";
  if (score >= 61) return "STRONG";
  if (score >= 41) return "MODERATE";
  return "WEAK";
}

/**
 * MAIN ENTRY: scan all 10 digits, rank them, decide entry status.
 * Called on every incoming tick. Cheap: O(window) per digit, no allocs in loops.
 */
export function scanMatches(digits: number[]): MatchScan {
  const tickCount = digits.length;

  // Per-digit feature extraction.
  const raw: DigitRank[] = [];
  for (let d = 0; d <= 9; d++) {
    const fS = frequency(digits, d, 20);
    const fM = frequency(digits, d, 50);
    const fL = frequency(digits, d, 100);
    const fX = frequency(digits, d, 300);

    const freqComp = freqScoreOf(fS.rate);
    const momComp = momentumScore(fS.rate, fM.rate); // -100..100
    const recComp = recencyScore(digits, d);
    const hotComp = hotScore(fS.rate, fM.rate);
    const patComp = patternScore(digits, d);

    // Weighted composite. Momentum is signed; clamp negative contribution.
    // Weights sum to 1.0 on the positive scale.
    const score =
      freqComp * 0.25 +
      Math.max(0, momComp) * 0.20 +
      recComp * 0.25 +
      hotComp * 0.15 +
      patComp * 0.15;

    raw.push({
      digit: d,
      score: Math.round(score),
      confidence: 0, // filled after ranking
      freqShort: fS.rate,
      freqMedium: fM.rate,
      freqLong: fL.rate,
      freqStable: fX.rate,
      countShort: fS.count,
      momentum: Math.round(momComp),
      recency: Math.round(recComp),
      hot: Math.round(hotComp),
      pattern: Math.round(patComp),
      rank: 0,
    });
  }

  // Rank by score desc.
  raw.sort((a, b) => b.score - a.score);
  raw.forEach((r, i) => { r.rank = i + 1; });

  const best = tickCount >= MIN_TICKS ? raw[0] : null;
  const second = raw[1];
  const dominanceGap = best && second ? best.score - second.score : 0;

  // Confidence reflects score-dominance, not probability of next digit.
  // Strong score + large gap from #2 = high confidence in the *ranking*.
  if (best) {
    const gapBoost = Math.min(20, dominanceGap); // up to +20
    best.confidence = Math.min(100, Math.round(best.score * 0.85 + gapBoost));
  }
  for (let i = 1; i < raw.length; i++) {
    raw[i].confidence = Math.round(raw[i].score * 0.7);
  }

  // HIGH-CONFIDENCE FILTER — all must pass.
  const filters = {
    rankedFirst: !!best,
    scoreThreshold: !!best && best.score >= HIGH_CONF_THRESHOLD,
    momentumShort: !!best && best.momentum > 0,
    momentumMedium: !!best && best.freqMedium > EXPECTED,
    frequencyEdge: !!best && best.freqShort > EXPECTED + 0.05, // +5pp over fair
    patternRepetition: !!best && best.pattern >= 40,
    clustering: !!best && best.pattern >= 20,
    dominanceGap: dominanceGap >= MIN_DOMINANCE_GAP,
    sample: tickCount >= MIN_TICKS,
  };

  const highConfidence = Object.values(filters).every(Boolean);

  const reasons: string[] = [];
  if (!filters.sample) reasons.push(`Need ${MIN_TICKS - tickCount} more ticks`);
  if (best) {
    if (!filters.scoreThreshold) reasons.push(`Score ${best.score} < ${HIGH_CONF_THRESHOLD}`);
    if (!filters.momentumShort) reasons.push("Momentum not positive");
    if (!filters.frequencyEdge) reasons.push("No frequency edge");
    if (!filters.patternRepetition) reasons.push("No pattern repetition");
    if (!filters.dominanceGap) reasons.push(`Gap to #2 only ${dominanceGap}`);
  }

  // Entry status: ENTER NOW only on high-confidence; PREPARING when close.
  let entry: EntryStatus = "WAIT";
  if (highConfidence) entry = "ENTER NOW";
  else if (best && best.score >= 80 && filters.momentumShort && filters.dominanceGap) {
    entry = "PREPARING";
  }

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
