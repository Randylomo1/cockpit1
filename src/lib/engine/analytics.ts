/**
 * MATCHES analytics engine.
 * Pure functions over a rolling digit buffer. No I/O.
 */

export type DigitArray = readonly number[];

export interface WindowStats {
  size: number;
  counts: number[];          // count per digit 0..9
  freq: number[];            // freq per digit (0..1)
  dominant: number;          // digit with highest count
  dominanceScore: number;    // 0..100 — how much top digit exceeds 10%
  entropy: number;           // 0..1 normalised (1 = uniform / random)
}

export interface DigitMetrics {
  digit: number;
  zScore: number;            // statistical significance vs expected 10%
  pValueApprox: number;      // two-tailed approximation
  momentum: number;          // 0..100 short vs long window acceleration
  clustering: number;        // 0..100 recency clustering
  persistence: number;       // 0..100 self-repeat probability (transition)
  streak: number;            // current consecutive run length of this digit ending now
  transitionScore: number;   // 0..100 from last digit -> this digit probability
}

export interface RepeatAnalysis {
  currentDigit: number;
  selfRepeatProb: number;    // empirical P(next == current) from transition matrix
  selfRepeatStability: number; // 0..1 — sample size adequacy
  zScore: number;            // significance of current digit vs uniform
}

export function buildWindow(digits: DigitArray, size: number): WindowStats {
  const slice = digits.slice(-size);
  const n = slice.length;
  const counts = new Array(10).fill(0);
  for (const d of slice) counts[d]++;
  const freq = counts.map((c) => (n ? c / n : 0));
  let dominant = 0, maxFreq = -1;
  for (let i = 0; i < 10; i++) if (freq[i] > maxFreq) { maxFreq = freq[i]; dominant = i; }
  const dominanceScore = clamp01((maxFreq - 0.1) / 0.25) * 100; // 0% extra→0, +25% extra→100
  // Shannon entropy normalised by log2(10)
  let H = 0;
  for (const p of freq) if (p > 0) H += -p * Math.log2(p);
  const entropy = H / Math.log2(10);
  return { size: n, counts, freq, dominant, dominanceScore, entropy };
}

/** Z-score of observed count vs expected uniform 10%. */
export function digitZScore(count: number, n: number): number {
  if (n <= 0) return 0;
  const p = 0.1;
  const mu = n * p;
  const sigma = Math.sqrt(n * p * (1 - p));
  if (sigma === 0) return 0;
  return (count - mu) / sigma;
}

/** Two-tailed p-value approximation via erfc. */
export function pValueFromZ(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  // Abramowitz & Stegun 7.1.26 erfc approximation
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return Math.max(0, Math.min(1, y));
}

/** Build a 10x10 transition matrix from digit sequence (rows: from, cols: to). */
export function transitionMatrix(digits: DigitArray): { matrix: number[][]; rowTotals: number[] } {
  const matrix = Array.from({ length: 10 }, () => new Array(10).fill(0));
  const rowTotals = new Array(10).fill(0);
  for (let i = 0; i < digits.length - 1; i++) {
    const a = digits[i], b = digits[i + 1];
    matrix[a][b]++;
    rowTotals[a]++;
  }
  return { matrix, rowTotals };
}

/** Self-repeat probability for digit d, with Laplace smoothing. */
export function selfRepeatProbability(matrix: number[][], rowTotals: number[], d: number) {
  const row = matrix[d];
  const total = rowTotals[d];
  const smoothed = (row[d] + 1) / (total + 10);
  const stability = Math.min(1, total / 30); // 30 prior observations = full confidence
  return { prob: smoothed, stability };
}

/** Current trailing streak of consecutive identical digits, at the end of the buffer. */
export function currentStreakInfo(digits: DigitArray): { digit: number; length: number } {
  if (digits.length === 0) return { digit: -1, length: 0 };
  const d = digits[digits.length - 1];
  let len = 1;
  for (let i = digits.length - 2; i >= 0; i--) {
    if (digits[i] === d) len++;
    else break;
  }
  return { digit: d, length: len };
}

/** Recency-weighted clustering score for digit d in last `window` ticks. */
export function clusteringScore(digits: DigitArray, d: number, window = 30): number {
  const slice = digits.slice(-window);
  if (slice.length === 0) return 0;
  let weighted = 0, weightSum = 0;
  for (let i = 0; i < slice.length; i++) {
    const w = (i + 1) / slice.length; // newer ticks weigh more
    weightSum += w;
    if (slice[i] === d) weighted += w;
  }
  const ratio = weighted / weightSum;
  return clamp01((ratio - 0.1) / 0.4) * 100;
}

/** Momentum: compare short-window freq vs long-window freq for digit d. */
export function momentumScore(digits: DigitArray, d: number, short = 15, long = 100): number {
  const sShort = digits.slice(-short);
  const sLong = digits.slice(-long);
  if (sShort.length === 0 || sLong.length === 0) return 0;
  const fShort = sShort.filter((x) => x === d).length / sShort.length;
  const fLong = sLong.filter((x) => x === d).length / sLong.length;
  const delta = fShort - fLong;
  // +20% delta → ~100
  return clamp01((delta + 0) / 0.2) * 100;
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
export function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
