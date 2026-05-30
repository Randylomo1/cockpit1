/**
 * Signal generation engine.
 * Combines analytics into a weighted confidence score and emits MATCH signals
 * only when ALL hard filters pass AND confidence >= threshold.
 */
import {
  buildWindow, currentStreakInfo, clusteringScore, momentumScore,
  digitZScore, pValueFromZ, selfRepeatProbability, transitionMatrix, clamp,
  type DigitArray, type WindowStats,
} from "./analytics";
import type { MarketSymbol } from "../deriv/markets";
import { MarketStateRegistry, type MarketStateRow } from "./marketStats";

export interface Signal {
  id: string;
  market: MarketSymbol;
  digit: number;
  confidence: number;        // 0..100
  createdAt: number;         // ms
  createdAtTick: number;     // tick index at creation
  factors: {
    dominance: number;
    momentum: number;
    clustering: number;
    persistence: number;     // transition self-repeat
    statistical: number;     // significance
    streakQuality: number;
  };
  components: {
    zScore: number;
    pValue: number;
    selfRepeatProb: number;
    selfRepeatStability: number;
    entropy: number;
    streakLength: number;
  };
  status: "active" | "decayed" | "expired";
  decayedConfidence: number; // live confidence after decay
  ticksAlive: number;
  rejection?: string;
}

export interface EngineSnapshot {
  windows: {
    w20: WindowStats;
    w50: WindowStats;
    w100: WindowStats;
    w300: WindowStats;
  };
  perDigit: Array<{
    digit: number;
    zScore: number;
    pValue: number;
    momentum: number;
    clustering: number;
    persistence: number;
    persistenceStability: number;
    /** Weighted 0..100 confidence using the same formula as the top-signal candidate. */
    confidence: number;
    /** Trailing consecutive run for this digit (>0 only when this digit is the last tick). */
    streak: number;
    /** "hot" | "cold" | "neutral" classification vs uniform 10%. */
    temperature: "hot" | "cold" | "neutral";
  }>;
  topDigit: number;
  topConfidence: number;
  regime: "stable" | "trending" | "chaotic";
  rejection?: string;
  newSignal?: Signal;
}

// Rebalanced to react fast to live ticks: clustering + momentum dominate so
// hot digits surface in 1–2 ticks instead of waiting for long-window dominance.
export const DEFAULT_WEIGHTS = {
  dominance: 0.18,
  momentum: 0.28,
  clustering: 0.22,
  persistence: 0.12,
  statistical: 0.12,
  streakQuality: 0.08,
};

export interface EngineConfig {
  minConfidence: number;        // 0..100
  cooldownMs: number;
  maxStreakForEntry: number;    // skip after exhaustion
  maxRegimeEntropy: number;     // 0..1 — reject if > this (chaotic)
  minSampleSize: number;        // need at least this many digits
  decayPerTick: number;         // confidence points lost per tick alive
}

// Lowered thresholds for real-time MATCH trading: warm-up is short (20 ticks),
// cooldown is tight (700 ms), and the confidence floor is reachable on live
// streams. Hard statistical gates still block chaotic regimes.
export const DEFAULT_CONFIG: EngineConfig = {
  minConfidence: 62,
  cooldownMs: 700,
  maxStreakForEntry: 6,
  maxRegimeEntropy: 0.992,
  minSampleSize: 20,
  decayPerTick: 4,
};

export class SignalEngine {
  private config: EngineConfig;
  private lastSignalAt = 0;
  private state = new MarketStateRegistry();

  constructor(config: Partial<EngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  updateConfig(c: Partial<EngineConfig>) { this.config = { ...this.config, ...c }; }
  getConfig() { return this.config; }
  getMarketState(market: MarketSymbol): MarketStateRow | undefined { return this.state.get(market); }

  analyse(market: MarketSymbol, digits: DigitArray, tickIndex: number): EngineSnapshot {
    const w20 = buildWindow(digits, 20);
    const w50 = buildWindow(digits, 50);
    const w100 = buildWindow(digits, 100);
    const w300 = buildWindow(digits, 300);

    const { matrix, rowTotals } = transitionMatrix(digits.slice(-500));
    const streak = currentStreakInfo(digits);

    const perDigit = Array.from({ length: 10 }, (_, d) => {
      const z = digitZScore(w100.counts[d], w100.size);
      const p = pValueFromZ(z);
      const m = momentumScore(digits, d, 15, 100);
      const c = clusteringScore(digits, d, 30);
      const sr = selfRepeatProbability(matrix, rowTotals, d);
      return {
        digit: d,
        zScore: z,
        pValue: p,
        momentum: m,
        clustering: c,
        persistence: sr.prob * 100,
        persistenceStability: sr.stability,
      };
    });

    // Best candidate: highest weighted preliminary score among hot digits.
    // Same scoring math is exposed back on `perDigit[i].confidence` so the
    // UI (per-digit match buttons) can rank without recomputing.
    const W = DEFAULT_WEIGHTS;
    const scored = perDigit.map((pd) => {
      const dominance = (w50.freq[pd.digit] - 0.1) / 0.25;
      const dominanceScore = clamp(dominance * 100, 0, 100);
      const stat = clamp((Math.abs(pd.zScore) - 1) / 2.5, 0, 1) * 100;
      const streakQuality = streak.digit === pd.digit
        ? clamp(streak.length / 3, 0, 1) * 100 - clamp(streak.length - 4, 0, 5) * 15
        : pd.digit === w20.dominant ? 40 : 10;
      const factors = {
        dominance: dominanceScore,
        momentum: pd.momentum,
        clustering: pd.clustering,
        persistence: pd.persistence > 10 ? clamp((pd.persistence - 10) * 4, 0, 100) * pd.persistenceStability : 0,
        statistical: stat,
        streakQuality: clamp(streakQuality, 0, 100),
      };
      const confidence =
        factors.dominance * W.dominance +
        factors.momentum * W.momentum +
        factors.clustering * W.clustering +
        factors.persistence * W.persistence +
        factors.statistical * W.statistical +
        factors.streakQuality * W.streakQuality;
      return { pd, factors, confidence };
    });

    // Enrich perDigit with confidence / streak / temperature for downstream UI.
    const enrichedPerDigit = scored.map(({ pd, confidence }) => {
      const z = pd.zScore;
      const temperature: "hot" | "cold" | "neutral" =
        z >= 1.2 ? "hot" : z <= -1.2 ? "cold" : "neutral";
      return {
        ...pd,
        confidence: Math.round(confidence),
        streak: streak.digit === pd.digit ? streak.length : 0,
        temperature,
      };
    });

    const candidates = [...scored].sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];
    const topMomentumDigit = [...perDigit].sort((a, b) => b.momentum - a.momentum)[0].digit;

    // Update per-market rolling state (entropy baseline, dominance flips, z-trend).
    const mstate = this.state.update(
      market,
      w100.entropy,
      w20.entropy,
      w50.dominant,
      Math.abs(best.pd.zScore),
    );

    const regime: EngineSnapshot["regime"] =
      w100.entropy > this.config.maxRegimeEntropy ? "chaotic"
        : w100.entropy < 0.93 ? "trending"
        : "stable";

    const snap: EngineSnapshot = {
      windows: { w20, w50, w100, w300 },
      perDigit: enrichedPerDigit,
      topDigit: best.pd.digit,
      topConfidence: Math.round(best.confidence),
      regime,
    };

    // Hardened filters: existing + 4 new statistical-stability gates.
    const entropySpike = mstate.updates > 50
      && w20.entropy > mstate.entropyBaseline + 0.04
      && w20.entropy > 0.97;
    const dominanceFlipRate = mstate.flipWindow.length > 10
      ? mstate.dominanceFlips / mstate.flipWindow.length
      : 0;
    const momentumDominanceConflict =
      best.pd.digit !== w20.dominant && best.pd.digit !== w50.dominant && best.pd.digit !== topMomentumDigit;

    const filters: Array<[boolean, string]> = [
      [digits.length >= this.config.minSampleSize, `Warming up (${digits.length}/${this.config.minSampleSize} ticks)`],
      [regime !== "chaotic", "Chaotic regime — random distribution"],
      [Date.now() - this.lastSignalAt >= this.config.cooldownMs, "Cooldown active"],
      [!(streak.digit === best.pd.digit && streak.length > this.config.maxStreakForEntry), `Streak exhausted (${streak.length})`],
      [best.confidence >= this.config.minConfidence, `Confidence ${Math.round(best.confidence)}% < ${this.config.minConfidence}%`],
      [best.pd.persistenceStability > 0.15, "Transition sample too small"],
      [Math.abs(best.pd.zScore) >= 0.8, `Z-score ${best.pd.zScore.toFixed(2)} insignificant`],
      // Hardened gates:
      [!entropySpike, `Entropy spike (Δ ${(w20.entropy - mstate.entropyBaseline).toFixed(3)})`],
      [dominanceFlipRate < 0.5, `Dominance unstable (flips ${(dominanceFlipRate * 100).toFixed(0)}%)`],
      [mstate.zTrend > -0.18, `Z-score weakening (trend ${mstate.zTrend.toFixed(2)})`],
      [!momentumDominanceConflict, "Momentum / dominance conflict"],
    ];
    const failed = filters.find(([ok]) => !ok);
    if (failed) {
      snap.rejection = failed[1];
      return snap;
    }

    const signal: Signal = {
      id: `${market}-${Date.now()}-${best.pd.digit}`,
      market,
      digit: best.pd.digit,
      confidence: Math.round(best.confidence),
      createdAt: Date.now(),
      createdAtTick: tickIndex,
      factors: best.factors,
      components: {
        zScore: best.pd.zScore,
        pValue: best.pd.pValue,
        selfRepeatProb: best.pd.persistence / 100,
        selfRepeatStability: best.pd.persistenceStability,
        entropy: w100.entropy,
        streakLength: streak.digit === best.pd.digit ? streak.length : 0,
      },
      status: "active",
      decayedConfidence: Math.round(best.confidence),
      ticksAlive: 0,
    };
    this.lastSignalAt = Date.now();
    snap.newSignal = signal;
    return snap;
  }

  /** Age all active signals; mark expired when below cutoff. */
  ageSignals(signals: Signal[], currentTick: number): Signal[] {
    return signals.map((s) => {
      if (s.status === "expired") return s;
      const ticksAlive = currentTick - s.createdAtTick;
      const decayed = Math.max(0, s.confidence - ticksAlive * this.config.decayPerTick);
      const status: Signal["status"] = decayed < 50 ? "expired" : decayed < s.confidence * 0.85 ? "decayed" : "active";
      return { ...s, ticksAlive, decayedConfidence: Math.round(decayed), status };
    });
  }
}
