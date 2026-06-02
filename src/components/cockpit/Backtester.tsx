/**
 * Backtester panel — replays the current live digit buffer through the
 * matches scanner with chosen risk params. Pure local computation; runs
 * instantly and never touches the API.
 */
import { useMemo, useState } from "react";
import { useCockpit } from "@/lib/engine/store";
import { runBacktest, type BacktestResult } from "@/lib/engine/backtester";
import { HIGH_CONF_THRESHOLD } from "@/lib/engine/matchScanner";

export function Backtester() {
  const { activeMarket, digits } = useCockpit();
  const buffer = digits[activeMarket] ?? [];

  const [stake, setStake] = useState(1);
  const [threshold, setThreshold] = useState(HIGH_CONF_THRESHOLD);
  const [minInterval, setMinInterval] = useState(2);
  const [maxLossStreak, setMaxLossStreak] = useState(4);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);

  const sample = buffer.length;

  const run = () => {
    if (sample < 50) { setResult(null); return; }
    setRunning(true);
    // microtask – computation is fast but yield so the UI repaints
    queueMicrotask(() => {
      const r = runBacktest({
        digits: buffer,
        stake,
        threshold,
        minIntervalTicks: minInterval,
        maxConsecLosses: maxLossStreak,
      });
      setResult(r);
      setRunning(false);
    });
  };

  const pnlTone = useMemo(() => {
    if (!result) return "text-foreground";
    return result.netPnL > 0 ? "text-[oklch(0.72_0.17_145)]"
      : result.netPnL < 0 ? "text-[oklch(0.62_0.22_25)]" : "text-foreground";
  }, [result]);

  return (
    <div className="glass rounded-xl p-4 border border-[var(--border)]">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
          Backtester · Replay live buffer ({sample} ticks)
        </div>
        <button
          onClick={run}
          disabled={running || sample < 50}
          className="px-4 py-1.5 rounded-md font-mono text-[10px] uppercase tracking-widest font-bold bg-gradient-to-b from-[var(--gold-soft)] to-[var(--gold)] text-black disabled:opacity-40 hover:brightness-110"
        >
          {running ? "Replaying…" : sample < 50 ? "Need ≥ 50 ticks" : "Run backtest"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
        <Num label="Stake $" value={stake} setValue={setStake} min={0.35} step={0.5} />
        <Num label="Score ≥" value={threshold} setValue={setThreshold} min={50} step={1} />
        <Num label="Min Interval ticks" value={minInterval} setValue={setMinInterval} min={1} step={1} />
        <Num label="Max Loss Streak" value={maxLossStreak} setValue={setMaxLossStreak} min={1} step={1} />
      </div>

      {result && (
        <div className="mt-4 pt-4 border-t border-[var(--border)]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Trades" value={String(result.trades)} />
            <Stat label="Win Rate" value={`${result.winRate.toFixed(1)}%`} />
            <Stat label="Net P/L" value={`${result.netPnL >= 0 ? "+" : ""}$${result.netPnL.toFixed(2)}`} tone={pnlTone} />
            <Stat label="ROI" value={`${result.roi >= 0 ? "+" : ""}${result.roi.toFixed(1)}%`} tone={pnlTone} />
            <Stat label="Wins" value={String(result.wins)} tone="text-[oklch(0.72_0.17_145)]" />
            <Stat label="Losses" value={String(result.losses)} tone="text-[oklch(0.62_0.22_25)]" />
            <Stat label="Max DD" value={`$${result.maxDrawdown.toFixed(2)}`} />
            <Stat label="Signal/1k" value={result.signalRate.toFixed(1)} />
          </div>
          <div className="mt-3 text-[10px] font-mono text-muted-foreground/70 leading-snug">
            Replayed {result.ticksAnalysed} historical ticks · payout assumed 9× stake · trades are simulated, not executed.
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--surface-2)]/30 p-2">
      <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`font-mono text-base font-bold ${tone ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}

function Num({ label, value, setValue, min, step }: { label: string; value: number; setValue: (v: number) => void; min: number; step: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground uppercase tracking-widest">{label}</span>
      <input
        type="number" min={min} step={step} value={value}
        onChange={(e) => setValue(Math.max(min, Number(e.target.value) || min))}
        className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-foreground focus:outline-none focus:border-[var(--gold)]"
      />
    </label>
  );
}
