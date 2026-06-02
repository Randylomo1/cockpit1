/**
 * Backtester — replays a captured digit stream through scanMatches() and
 * simulates DIGITMATCH trades as if auto-trade had been enabled.
 *
 * Purely synchronous, no network. Operates on a digit array (0–9) which is
 * the same shape the live cockpit buffer already maintains, so you can
 * "freeze and replay" the current market without leaving the page.
 *
 * Match payout assumption: 9× stake on win (Deriv standard for DIGITMATCH).
 * Pass `payoutMultiplier` to override.
 */
import { scanMatches, HIGH_CONF_THRESHOLD, MIN_TICKS } from "./matchScanner";

export interface BacktestParams {
  digits: number[];
  stake: number;
  payoutMultiplier?: number;   // default 9
  minIntervalTicks?: number;   // ticks between trades (≥1)
  maxConsecLosses?: number;
  takeProfit?: number;
  stopLoss?: number;
  threshold?: number;          // override HIGH_CONF_THRESHOLD
}

export interface BacktestTrade {
  i: number;                // index of trigger tick
  digit: number;
  score: number;
  outcome: "WIN" | "LOSS";
  profit: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  wins: number;
  losses: number;
  winRate: number;
  netPnL: number;
  roi: number;
  maxDrawdown: number;
  ticksAnalysed: number;
  signalRate: number;       // trades per 1000 ticks
}

export function runBacktest(p: BacktestParams): BacktestResult {
  const payoutMul = p.payoutMultiplier ?? 9;
  const minInterval = Math.max(1, p.minIntervalTicks ?? 1);
  const threshold = p.threshold ?? HIGH_CONF_THRESHOLD;
  const stake = Math.max(0.35, p.stake);

  const trades: BacktestTrade[] = [];
  let consecLosses = 0;
  let net = 0;
  let peak = 0;
  let maxDd = 0;
  let lastTradeAt = -Infinity;
  let totalRisked = 0;

  for (let i = MIN_TICKS; i < p.digits.length - 1; i++) {
    if (p.maxConsecLosses && consecLosses >= p.maxConsecLosses) break;
    if (p.takeProfit != null && net >= p.takeProfit) break;
    if (p.stopLoss != null && net <= -Math.abs(p.stopLoss)) break;
    if (i - lastTradeAt < minInterval) continue;

    const window = p.digits.slice(0, i + 1);
    const scan = scanMatches(window);
    if (!scan.best || scan.best.score < threshold || !scan.highConfidence) continue;

    const nextDigit = p.digits[i + 1];
    const win = nextDigit === scan.best.digit;
    const profit = win ? stake * (payoutMul - 1) : -stake;
    net += profit;
    totalRisked += stake;
    if (net > peak) peak = net;
    const dd = peak - net;
    if (dd > maxDd) maxDd = dd;
    if (win) consecLosses = 0; else consecLosses++;
    trades.push({ i, digit: scan.best.digit, score: scan.best.score, outcome: win ? "WIN" : "LOSS", profit });
    lastTradeAt = i;
  }

  const wins = trades.filter((t) => t.outcome === "WIN").length;
  const losses = trades.length - wins;
  return {
    trades,
    wins,
    losses,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    netPnL: net,
    roi: totalRisked ? (net / totalRisked) * 100 : 0,
    maxDrawdown: maxDd,
    ticksAnalysed: p.digits.length,
    signalRate: p.digits.length ? (trades.length / p.digits.length) * 1000 : 0,
  };
}
