/**
 * Backtester panel — replays digit history through the matches scanner with
 * chosen risk params. Source can be:
 *  - LIVE: current in-memory buffer for the active market.
 *  - STORED: persisted tick history from IndexedDB (per market, up to 20k).
 *
 * Pure local computation; runs instantly and never touches the API.
 */
import { useEffect, useMemo, useState } from "react";
import { useCockpit } from "@/lib/engine/store";
import { runBacktest, type BacktestResult } from "@/lib/engine/backtester";
import { HIGH_CONF_THRESHOLD } from "@/lib/engine/matchScanner";
import { loadTickDigits, tickCounts, clearTicks } from "@/lib/db/tickDb";
import { SCAN_MARKETS } from "@/lib/engine/multiScanner";
import type { MarketSymbol } from "@/lib/deriv/markets";

type Source = "LIVE" | "STORED";

export function Backtester() {
  const { activeMarket, digits } = useCockpit();
  const liveBuffer = digits[activeMarket] ?? [];

  const [source, setSource] = useState<Source>("LIVE");
  const [market, setMarket] = useState<MarketSymbol>(activeMarket);
  const [stake, setStake] = useState(1);
  const [threshold, setThreshold] = useState(HIGH_CONF_THRESHOLD);
  const [minInterval, setMinInterval] = useState(2);
  const [maxLossStreak, setMaxLossStreak] = useState(4);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [stored, setStored] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    const tick = () => tickCounts().then((c) => { if (alive) setStored(c); }).catch(() => {});
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const sample = source === "LIVE" ? liveBuffer.length : (stored[market] ?? 0);

  const run = async () => {
    if (sample < 50) { setResult(null); return; }
    setRunning(true);
    try {
      const series = source === "LIVE"
        ? liveBuffer
        : await loadTickDigits(market, 20_000);
      const r = runBacktest({
        digits: series,
        stake,
        threshold,
        minIntervalTicks: minInterval,
        maxConsecLosses: maxLossStreak,
      });
      setResult(r);
    } finally {
      setRunning(false);
    }
  };

  const pnlTone = useMemo(() => {
    if (!result) return "text-foreground";
    return result.netPnL > 0 ? "text-[oklch(0.72_0.17_145)]"
      : result.netPnL < 0 ? "text-[oklch(0.62_0.22_25)]" : "text-foreground";
  }, [result]);

  const totalStored = Object.values(stored).reduce((s, n) => s + n, 0);

  return (
    <div className="glass rounded-xl p-4 border border-[var(--border)]">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
          Backtester · {source === "LIVE" ? `Live buffer (${sample} ticks)` : `Stored ${market} (${sample} / ${totalStored} total)`}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSource("LIVE")}
            className={`px-2 py-1 rounded text-[9px] font-mono uppercase tracking-widest ${
              source === "LIVE" ? "bg-[var(--gold)] text-black" : "bg-[var(--surface-2)] text-muted-foreground"
            }`}
          >Live</button>
          <button
            onClick={() => setSource("STORED")}
            className={`px-2 py-1 rounded text-[9px] font-mono uppercase tracking-widest ${
              source === "STORED" ? "bg-[var(--gold)] text-black" : "bg-[var(--surface-2)] text-muted-foreground"
            }`}
          >Stored</button>
        </div>
      </div>

      {source === "STORED" && (
        <div className="mb-3 flex items-center gap-1 flex-wrap">
          {SCAN_MARKETS.map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={`px-2 py-1 rounded text-[10px] font-mono ${
                market === m ? "bg-[var(--gold)] text-black" : "bg-[var(--surface-2)] text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.replace("R_", "V")} · {stored[m] ?? 0}
            </button>
          ))}
          <button
            onClick={async () => { await clearTicks(); setStored({}); }}
            className="ml-auto px-2 py-1 rounded text-[9px] font-mono uppercase tracking-widest text-muted-foreground hover:text-[oklch(0.62_0.22_25)]"
          >Clear all</button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
        <Num label="Stake $" value={stake} setValue={setStake} min={0.35} step={0.5} />
        <Num label="Score ≥" value={threshold} setValue={setThreshold} min={50} step={1} />
        <Num label="Min Interval ticks" value={minInterval} setValue={setMinInterval} min={1} step={1} />
        <Num label="Max Loss Streak" value={maxLossStreak} setValue={setMaxLossStreak} min={1} step={1} />
      </div>

      <button
        onClick={run}
        disabled={running || sample < 50}
        className="mt-3 w-full px-4 py-2 rounded-md font-mono text-[10px] uppercase tracking-widest font-bold bg-gradient-to-b from-[var(--gold-soft)] to-[var(--gold)] text-black disabled:opacity-40 hover:brightness-110"
      >
        {running ? "Replaying…" : sample < 50 ? "Need ≥ 50 ticks" : `Run backtest on ${sample} ticks`}
      </button>

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
            <Stat label="Profit Factor" value={isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : "∞"} />
          </div>
          <div className="mt-3 text-[10px] font-mono text-muted-foreground/70 leading-snug">
            Replayed {result.ticksAnalysed} ticks · {result.signalRate.toFixed(1)} signals / 1k ticks · payout assumed 9× stake · simulated, not executed.
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
