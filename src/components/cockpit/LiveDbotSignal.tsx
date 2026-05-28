/**
 * LIVE DBOT MATCH SIGNAL — dominant execution panel.
 * Combines the engine's strongest digit + outcome stats into a single
 * EXECUTE NOW / WAIT decision and a one-click DBot launcher.
 */
import { useMemo, useState } from "react";
import { useCockpit } from "@/lib/engine/store";
import { launchDbot } from "@/lib/dbot/template";

interface Decision {
  ready: boolean;
  tier: "S-TIER" | "A-TIER" | "B-TIER" | "—";
  reasons: string[];
}

function evaluate(args: {
  confidence: number;
  zScore: number;
  entropy: number;
  persistenceStability: number;
  regime: string;
  winRate?: number;
  sample?: number;
}): Decision {
  const reasons: string[] = [];
  if (args.confidence < 90) reasons.push(`Confidence ${args.confidence}% < 90`);
  if (Math.abs(args.zScore) < 2.2) reasons.push(`Z-score ${args.zScore.toFixed(2)} < 2.2`);
  if (args.entropy > 0.97) reasons.push("Entropy unstable");
  if (args.persistenceStability < 0.4) reasons.push("Persistence weakening");
  if (args.regime !== "stable" && args.regime !== "trending") reasons.push(`Regime ${args.regime}`);

  // EQS composite (Execution Quality Score)
  const eqs = Math.round(
    args.confidence * 0.5
    + Math.min(100, Math.abs(args.zScore) * 25) * 0.25
    + (1 - args.entropy) * 100 * 0.15
    + args.persistenceStability * 100 * 0.10
  );
  if (eqs < 92) reasons.push(`EQS ${eqs} < 92`);

  const ready = reasons.length === 0;
  let tier: Decision["tier"] = "—";
  if (ready) {
    tier = eqs >= 96 && args.confidence >= 93 ? "S-TIER"
      : eqs >= 94 ? "A-TIER" : "B-TIER";
  }
  return { ready, tier, reasons };
}

export function LiveDbotSignal() {
  const { activeMarket, snapshot, signals, outcomeStats } = useCockpit();
  const [stake, setStake] = useState(1);

  const snap = snapshot[activeMarket];
  const activeSignal = signals.find((s) => s.market === activeMarket && s.status === "active");
  const stats = outcomeStats[activeMarket];

  const decision = useMemo<Decision>(() => {
    if (!snap || !activeSignal) {
      return { ready: false, tier: "—", reasons: ["No active candidate"] };
    }
    const pd = snap.perDigit[activeSignal.digit];
    return evaluate({
      confidence: activeSignal.decayedConfidence,
      zScore: pd?.zScore ?? 0,
      entropy: snap.windows.w100.entropy,
      persistenceStability: pd?.persistenceStability ?? 0,
      regime: snap.regime,
      winRate: stats?.t1?.winRate,
      sample: stats?.t1?.sample,
    });
  }, [snap, activeSignal, stats]);

  const digit = activeSignal?.digit ?? snap?.topDigit ?? null;
  const confidence = activeSignal?.decayedConfidence ?? snap?.topConfidence ?? 0;

  const onOpenDbot = () => {
    if (digit == null) return;
    launchDbot({ market: activeMarket, digit, stake, durationTicks: 1 });
  };

  const statusLabel = decision.ready ? "EXECUTE NOW" : "WAIT";
  const statusColor = decision.ready ? "text-[oklch(0.72_0.17_145)]" : "text-[oklch(0.78_0.16_70)]";
  const borderClass = decision.ready
    ? "border-[var(--gold)] shadow-[0_0_40px_-10px_var(--gold)]"
    : "border-[var(--border)]";

  return (
    <div className={`glass rounded-xl p-5 border-2 ${borderClass} transition-all duration-300`}>
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
          Live DBot · Match Signal
        </div>
        <div className={`text-[10px] font-mono uppercase tracking-widest ${statusColor}`}>
          ● {decision.ready ? "READY TO LOAD" : "STANDBY"}
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-6 items-center">
        {/* Massive digit */}
        <div className="text-center">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            Trade Digit
          </div>
          <div
            className={`font-mono font-black leading-none ${decision.ready ? "gold-text" : "text-muted-foreground/60"}`}
            style={{ fontSize: "8rem", letterSpacing: "-0.05em" }}
          >
            {digit ?? "—"}
          </div>
        </div>

        {/* Status stack */}
        <div className="space-y-2">
          <div className={`text-3xl font-mono font-bold ${statusColor} uppercase tracking-wider`}>
            {statusLabel}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-mono pt-2">
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Market</div>
            <div className="text-right text-foreground">{activeMarket}</div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Quality</div>
            <div className="text-right gold-text font-semibold">{decision.tier}</div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Confidence</div>
            <div className="text-right text-foreground">{confidence}%</div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Regime</div>
            <div className="text-right text-foreground capitalize">{snap?.regime ?? "—"}</div>
            {stats?.t1 && stats.t1.sample >= 5 && (
              <>
                <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Hist t+1</div>
                <div className="text-right text-foreground">
                  {(stats.t1.winRate * 100).toFixed(0)}% · n={stats.t1.sample}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Reasons when waiting */}
      {!decision.ready && decision.reasons.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--border)]">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
            Wait Reason
          </div>
          <div className="flex flex-wrap gap-1.5">
            {decision.reasons.map((r) => (
              <span
                key={r}
                className="text-[10px] font-mono px-2 py-0.5 rounded border border-[var(--border)] text-muted-foreground bg-[var(--surface-2)]/40"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* DBot launcher */}
      <div className="mt-4 pt-4 border-t border-[var(--border)] flex items-center gap-3">
        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Stake
        </label>
        <input
          type="number"
          step="0.5"
          min="0.35"
          value={stake}
          onChange={(e) => setStake(Math.max(0.35, Number(e.target.value) || 1))}
          className="w-20 bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-sm font-mono text-foreground focus:outline-none focus:border-[var(--gold)]"
        />
        <span className="text-[10px] font-mono text-muted-foreground">USD</span>
        <div className="flex-1" />
        <button
          onClick={onOpenDbot}
          disabled={digit == null}
          className="px-4 py-2 rounded-md font-mono text-xs uppercase tracking-widest font-bold bg-[var(--gold)] text-[var(--primary-foreground)] hover:bg-[var(--gold-soft)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Downloads the prepared MATCH bot XML and opens dbot.deriv.com — drag the file into DBot to load."
        >
          Open in DBot →
        </button>
      </div>
      <div className="mt-2 text-[10px] font-mono text-muted-foreground/70 leading-snug">
        XML downloads with market <span className="text-foreground">{activeMarket}</span>, contract <span className="text-foreground">DIGITMATCH</span>, duration <span className="text-foreground">1 tick</span>, prediction <span className="text-foreground">{digit ?? "—"}</span>. In DBot click <span className="text-foreground">Load</span> → <span className="text-foreground">Local</span> and pick the file, then <span className="text-foreground">Run</span>.
      </div>
    </div>
  );
}
