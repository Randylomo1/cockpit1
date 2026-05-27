import { useCockpit } from "@/lib/engine/store";

export function EngineStatus() {
  const { activeMarket, snapshot } = useCockpit();
  const snap = snapshot[activeMarket];

  if (!snap) {
    return (
      <div className="glass rounded-xl p-4">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Engine</h3>
        <div className="text-sm text-muted-foreground italic">Warming up analytics buffer…</div>
      </div>
    );
  }

  const top = snap.perDigit[snap.topDigit];
  const regimeColor =
    snap.regime === "chaotic" ? "text-[oklch(0.62_0.22_25)]"
    : snap.regime === "trending" ? "text-[oklch(0.72_0.17_145)]"
    : "text-[var(--gold)]";

  const bars: Array<[string, number]> = [
    ["Dominance", (snap.windows.w50.freq[snap.topDigit] - 0.1) / 0.25 * 100],
    ["Momentum",  top.momentum],
    ["Clustering", top.clustering],
    ["Persistence", top.persistence],
  ];

  return (
    <div className="glass rounded-xl p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Engine</h3>
        <span className={`text-[10px] font-mono uppercase tracking-widest ${regimeColor}`}>
          {snap.regime}
        </span>
      </div>

      <div className="flex items-baseline gap-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Best candidate</div>
        <div className="font-mono text-2xl font-bold gold-text">{snap.topDigit}</div>
        <div className="font-mono text-sm text-muted-foreground">{snap.topConfidence}% conf.</div>
      </div>

      <div className="space-y-1.5">
        {bars.map(([label, v]) => {
          const pct = Math.max(0, Math.min(100, v));
          return (
            <div key={label}>
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                <span>{label}</span><span>{pct.toFixed(0)}</span>
              </div>
              <div className="h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[var(--gold)] to-[var(--gold-soft)]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono pt-2 border-t border-[var(--border)]">
        <div><span className="text-muted-foreground">z-score </span><span>{top.zScore.toFixed(2)}</span></div>
        <div><span className="text-muted-foreground">p-value </span><span>{top.pValue.toFixed(3)}</span></div>
        <div><span className="text-muted-foreground">repeat P </span><span>{(top.persistence).toFixed(1)}%</span></div>
        <div><span className="text-muted-foreground">stability </span><span>{(top.persistenceStability * 100).toFixed(0)}%</span></div>
      </div>

      {snap.rejection && (
        <div className="text-[11px] text-muted-foreground italic border-l-2 border-[var(--border)] pl-2">
          Hold: {snap.rejection}
        </div>
      )}
    </div>
  );
}
