/**
 * LIVE DBOT MATCH SIGNAL — dominant execution panel.
 * Combines the engine's strongest digit + outcome stats into a single
 * EXECUTE NOW / WAIT decision and a one-click DBot launcher.
 */
import { useEffect, useMemo, useState } from "react";
import { useCockpit } from "@/lib/engine/store";
import { downloadDbotXml, DBOT_URL } from "@/lib/dbot/template";
import { useAccount } from "@/lib/deriv/accountStore";
import { getAuthClient } from "@/lib/deriv/authWs";
import { toast } from "sonner";

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
      winRate: stats ? stats.ewmaWin.t1 : undefined,
      sample: stats?.totals.t1,
    });
  }, [snap, activeSignal, stats]);

  const digit = activeSignal?.digit ?? snap?.topDigit ?? null;
  const confidence = activeSignal?.decayedConfidence ?? snap?.topConfidence ?? 0;

  const accountStatus = useAccount((s) => s.status);
  const bootstrap = useAccount((s) => s.bootstrap);
  const balance = useAccount((s) => s.balance);
  useEffect(() => { bootstrap(); }, [bootstrap]);
  const accountConnected = accountStatus === "CONNECTED";
  const [executing, setExecuting] = useState(false);

  const onDownload = () => {
    if (digit == null) return;
    downloadDbotXml({ market: activeMarket, digit, stake, durationTicks: 1 });
  };

  const onExecute = async () => {
    if (digit == null || !accountConnected || executing) return;
    setExecuting(true);
    const tid = toast.loading(`Placing MATCH ${digit} · ${activeMarket} · $${stake}`);
    try {
      const res = await getAuthClient().buyMatch({
        symbol: activeMarket, digit, stake, durationTicks: 1,
      });
      toast.success(`Trade placed · #${res.contract_id}`, {
        id: tid,
        description: `Stake $${res.buy_price.toFixed(2)} · Payout $${res.payout.toFixed(2)}`,
      });
    } catch (e: any) {
      toast.error("Trade rejected", { id: tid, description: String(e?.message ?? e) });
    } finally {
      setExecuting(false);
    }
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
            {stats && stats.totals.t1 >= 5 && (
              <>
                <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Hist t+1</div>
                <div className="text-right text-foreground">
                  {(stats.ewmaWin.t1 * 100).toFixed(0)}% · n={stats.totals.t1}
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

      {/* Execution */}
      <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap items-center gap-3">
        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Stake</label>
        <input
          type="number"
          step="0.5"
          min="0.35"
          value={stake}
          onChange={(e) => setStake(Math.max(0.35, Number(e.target.value) || 1))}
          className="w-20 bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-sm font-mono text-foreground focus:outline-none focus:border-[var(--gold)]"
        />
        <span className="text-[10px] font-mono text-muted-foreground">
          {balance ? `${balance.currency} · bal ${balance.balance.toFixed(2)}` : "USD"}
        </span>
        <div className="flex-1" />

        <button
          onClick={onExecute}
          disabled={digit == null || !accountConnected || executing || !decision.ready}
          className="px-5 py-2 rounded-md font-mono text-xs uppercase tracking-widest font-bold bg-[oklch(0.72_0.17_145)] text-black hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed"
          title={!accountConnected ? "Connect your Deriv account first" : !decision.ready ? "Wait for a valid signal" : `Buy DIGITMATCH ${digit} on ${activeMarket} for $${stake}`}
        >
          {executing ? "Placing…" : `▶ Execute Trade${digit != null ? ` · ${digit}` : ""}`}
        </button>

        <button
          onClick={onDownload}
          disabled={digit == null}
          className="px-3 py-2 rounded-md font-mono text-[11px] uppercase tracking-widest border border-[var(--gold)]/60 text-[var(--gold)] hover:bg-[var(--gold)]/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
          title="Download MATCH bot XML for DBot"
        >
          ⬇ XML
        </button>
        <a
          href={DBOT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 rounded-md font-mono text-[11px] uppercase tracking-widest border border-[var(--border)] text-muted-foreground hover:text-foreground hover:border-[var(--gold)]/60 transition"
        >
          DBot ↗
        </a>
      </div>

      <div className="mt-2 text-[10px] font-mono text-muted-foreground/70 leading-snug">
        {accountConnected
          ? <>Click <span className="text-foreground">Execute Trade</span> to place <span className="text-foreground">DIGITMATCH {digit ?? "—"}</span> on <span className="text-foreground">{activeMarket}</span> · 1 tick · ${stake} directly through your Deriv account.</>
          : <>Connect your Deriv account in the header to enable one-click execution. Fallback: download the XML and load it in DBot.</>}
      </div>
    </div>
  );
}
