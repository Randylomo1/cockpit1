import { useCockpit } from "@/lib/engine/store";

export function TickFeed() {
  const { activeMarket, digits, lastTick } = useCockpit();
  const buf = (digits[activeMarket] ?? []).slice(-40);
  const tick = lastTick[activeMarket];

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Live Quote</h3>
        <span className="text-[10px] font-mono text-muted-foreground">
          {tick ? new Date(tick.receivedAt).toLocaleTimeString() : "—"}
        </span>
      </div>
      <div className="flex items-baseline gap-3">
        <div className="font-mono text-3xl gold-text font-semibold">
          {tick ? tick.quote.toFixed(tick.pipSize) : "0.00"}
        </div>
        <div className="font-mono text-5xl font-black text-[var(--gold)]">
          {tick ? tick.lastDigit : "·"}
        </div>
      </div>
      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Last 40 digits</div>
        <div className="flex flex-wrap gap-1">
          {buf.length === 0 && <span className="text-xs text-muted-foreground italic">Waiting for ticks…</span>}
          {buf.map((d, i) => (
            <span
              key={i}
              className={`size-6 grid place-items-center text-[11px] font-mono rounded-sm border ${
                i === buf.length - 1
                  ? "bg-[var(--gold)] text-black border-[var(--gold)]"
                  : "bg-[var(--surface-2)] border-[var(--border)] text-foreground/80"
              }`}
            >
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
