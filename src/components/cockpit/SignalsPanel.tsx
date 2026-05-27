import { useCockpit } from "@/lib/engine/store";
import type { Signal } from "@/lib/engine/signals";
import type { PendingSignal } from "@/lib/engine/outcomes";

function TrackingPill({ resolved }: { resolved?: PendingSignal }) {
  if (!resolved) {
    return (
      <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-[var(--border)] text-muted-foreground">
        tracking
      </span>
    );
  }
  const o = resolved.outcomes;
  const cells: Array<{ k: string; v?: boolean }> = [
    { k: "1", v: o.t1 }, { k: "2", v: o.t2 }, { k: "3", v: o.t3 }, { k: "5", v: o.t5 },
  ];
  return (
    <span className="flex items-center gap-0.5 text-[9px] font-mono">
      {cells.map((c) => (
        <span
          key={c.k}
          className={`px-1 py-0.5 rounded ${
            c.v ? "bg-[oklch(0.72_0.17_145)]/20 text-[oklch(0.72_0.17_145)]"
                : "bg-[oklch(0.62_0.22_25)]/15 text-[oklch(0.62_0.22_25)]"
          }`}
          title={`+${c.k} ticks: ${c.v ? "win" : "loss"}`}
        >
          {c.v ? "✓" : "✗"}{c.k}
        </span>
      ))}
    </span>
  );
}

function SignalCard({ s, resolved }: { s: Signal; resolved?: PendingSignal }) {
  const decayPct = (s.decayedConfidence / Math.max(1, s.confidence)) * 100;
  const statusColor =
    s.status === "active" ? "text-[oklch(0.72_0.17_145)]"
    : s.status === "decayed" ? "text-[oklch(0.78_0.16_70)]"
    : "text-[oklch(0.62_0.22_25)]";

  return (
    <div className={`rounded-lg border p-3 ${s.status === "expired" ? "border-[var(--border)] opacity-50" : "border-[var(--gold)]/40 bg-[var(--gold)]/5"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">MATCH</span>
          <span className="font-mono text-2xl font-black gold-text leading-none">{s.digit}</span>
          <TrackingPill resolved={resolved} />
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-semibold">{s.decayedConfidence}%</div>
          <div className={`text-[10px] uppercase tracking-widest ${statusColor}`}>{s.status}</div>
        </div>
      </div>
      <div className="h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden mb-2">
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${decayPct}%`,
            background: s.status === "expired" ? "oklch(0.62 0.22 25)" : "linear-gradient(90deg, var(--gold-soft), var(--gold))",
          }}
        />
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px] font-mono text-muted-foreground">
        <div>dom {s.factors.dominance.toFixed(0)}</div>
        <div>mom {s.factors.momentum.toFixed(0)}</div>
        <div>clu {s.factors.clustering.toFixed(0)}</div>
        <div>per {s.factors.persistence.toFixed(0)}</div>
        <div>stat {s.factors.statistical.toFixed(0)}</div>
        <div>str {s.factors.streakQuality.toFixed(0)}</div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <span>z={s.components.zScore.toFixed(2)} · p={s.components.pValue.toFixed(3)}</span>
        <span>{s.ticksAlive}t · {new Date(s.createdAt).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

export function SignalsPanel() {
  const { signals, clearSignals, activeMarket, resolvedSignals } = useCockpit();
  const marketSignals = signals.filter((s) => s.market === activeMarket);

  return (
    <div className="glass rounded-xl p-4 flex flex-col h-full min-h-[460px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Signals · MATCH only</h3>
        <button
          onClick={clearSignals}
          className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-auto space-y-2 pr-1">
        {marketSignals.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground italic">
            No high-confidence signals.<br />
            <span className="text-[11px]">The engine is being selective — fewer signals, higher quality.</span>
          </div>
        )}
        {marketSignals.map((s) => <SignalCard key={s.id} s={s} resolved={resolvedSignals[s.id]} />)}
      </div>
    </div>
  );
}
