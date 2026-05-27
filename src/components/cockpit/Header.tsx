import { useCockpit } from "@/lib/engine/store";
import { MARKETS } from "@/lib/deriv/markets";
import { AccountConnect } from "./AccountConnect";

export function CockpitHeader() {
  const { status, latencyMs, activeMarket, setActiveMarket } = useCockpit();

  const statusColor =
    status === "open" ? "text-[oklch(0.72_0.17_145)]"
    : status === "connecting" ? "text-[oklch(0.78_0.16_70)]"
    : "text-[oklch(0.62_0.22_25)]";
  const statusLabel =
    status === "open" ? "LIVE"
    : status === "connecting" ? "CONNECTING"
    : status === "closed" ? "DISCONNECTED"
    : status === "error" ? "ERROR" : "IDLE";

  const grouped = MARKETS.reduce<Record<string, typeof MARKETS>>((acc, m) => {
    (acc[m.group] ??= []).push(m); return acc;
  }, {});

  return (
    <header className="glass sticky top-0 z-30 px-5 py-3 flex items-center gap-5">
      <div className="flex items-center gap-3">
        <div className="size-8 rounded-md bg-gradient-to-br from-[var(--gold-soft)] to-[var(--gold)] grid place-items-center text-[10px] font-black text-black">
          MX
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Matches Intelligence</div>
          <div className="gold-text text-lg font-semibold leading-none">COCKPIT</div>
        </div>
      </div>

      <div className="ml-4 hidden md:flex items-center gap-2 text-xs">
        <span className={`pulse-dot ${statusColor} font-semibold tracking-wider`}>{statusLabel}</span>
        <span className="text-muted-foreground">•</span>
        <span className="font-mono text-muted-foreground">{latencyMs}ms</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Market</label>
        <select
          value={activeMarket}
          onChange={(e) => setActiveMarket(e.target.value as any)}
          className="bg-[var(--surface-2)] border border-[var(--border)] rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
        >
          {Object.entries(grouped).map(([group, list]) => (
            <optgroup key={group} label={group}>
              {list.map((m) => (
                <option key={m.symbol} value={m.symbol}>{m.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <AccountConnect />
      </div>
    </header>
  );
}
