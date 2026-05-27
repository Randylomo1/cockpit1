/**
 * Pure tick-replay helpers operating on already-recorded post-emission digits.
 * Used by Wave 2 (calibration / EQS) and the analytics dashboard.
 */
import type { PendingSignal } from "./outcomes";

export interface ReplayResult {
  immediateWinProb: number;     // share of t1 wins
  delayedWinProb: number;       // share of (t5 win && !t1 win)
  reversalRate: number;         // t1 win but t3 loss
  persistenceContinuation: number; // P(t2 | t1)
  avgDominanceSurvival: number;
  meanEntropyAtEmission: number;
}

export function replayAggregate(history: PendingSignal[]): ReplayResult {
  if (history.length === 0) {
    return {
      immediateWinProb: 0, delayedWinProb: 0, reversalRate: 0,
      persistenceContinuation: 0, avgDominanceSurvival: 0, meanEntropyAtEmission: 0,
    };
  }
  let t1 = 0, t3 = 0, t5 = 0, t1AndT2 = 0, reversed = 0, delayed = 0;
  let survSum = 0, entropySum = 0;
  for (const p of history) {
    if (p.outcomes.t1) t1++;
    if (p.outcomes.t3) t3++;
    if (p.outcomes.t5) t5++;
    if (p.outcomes.t1 && p.outcomes.t2) t1AndT2++;
    if (p.outcomes.t1 && !p.outcomes.t3) reversed++;
    if (!p.outcomes.t1 && p.outcomes.t5) delayed++;
    let i = 0;
    while (i < p.postDigits.length && p.postDigits[i] === p.meta.dominantDigit) i++;
    survSum += i;
    entropySum += p.meta.entropy;
  }
  const n = history.length;
  return {
    immediateWinProb: t1 / n,
    delayedWinProb: delayed / n,
    reversalRate: reversed / n,
    persistenceContinuation: t1 > 0 ? t1AndT2 / t1 : 0,
    avgDominanceSurvival: survSum / n,
    meanEntropyAtEmission: entropySum / n,
  };
}
