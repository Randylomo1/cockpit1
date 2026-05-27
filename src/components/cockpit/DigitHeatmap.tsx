import { useCockpit } from "@/lib/engine/store";

export function DigitHeatmap() {
  const { activeMarket, snapshot } = useCockpit();
  const snap = snapshot[activeMarket];

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Digit Dominance</h3>
        <span className="text-[10px] font-mono text-muted-foreground">
          {snap ? `entropy ${snap.windows.w100.entropy.toFixed(3)}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: 10 }, (_, d) => {
          const freq50 = snap?.windows.w50.freq[d] ?? 0;
          const freq100 = snap?.windows.w100.freq[d] ?? 0;
          const intensity = Math.min(1, Math.max(0, (freq50 - 0.05) / 0.2));
          const isTop = snap?.topDigit === d;
          return (
            <div
              key={d}
              className={`relative rounded-md border ${isTop ? "border-[var(--gold)]" : "border-[var(--border)]"} p-2 text-center`}
              style={{
                background: `linear-gradient(180deg, oklch(0.78 0.13 86 / ${intensity * 0.45}), oklch(0.165 0 0))`,
              }}
              title={`50w ${(freq50 * 100).toFixed(1)}% • 100w ${(freq100 * 100).toFixed(1)}%`}
            >
              <div className="text-base font-mono font-bold">{d}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{(freq50 * 100).toFixed(0)}%</div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-10 gap-1 mt-2">
        {Array.from({ length: 10 }, (_, d) => {
          const pd = snap?.perDigit[d];
          const z = pd?.zScore ?? 0;
          const sig = Math.min(1, Math.abs(z) / 3);
          const color = z > 0 ? "oklch(0.78 0.13 86)" : "oklch(0.55 0.04 256)";
          return (
            <div key={d} className="h-1 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div className="h-full" style={{ width: `${sig * 100}%`, background: color }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 text-[9px] font-mono text-muted-foreground text-center">Z-score significance</div>
    </div>
  );
}
