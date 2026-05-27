import { useCockpit } from "@/lib/engine/store";
import { HORIZONS, winRate } from "@/lib/engine/outcomes";
import { MARKETS } from "@/lib/deriv/markets";

export function MarketStatsStrip() {
  // Subscribe to trackerVersion so this re-renders on every outcome update.
  useCockpit((s) => s.trackerVersion);
  const outcomeStats = useCockpit((s) => s.outcomeStats);
  const activeMarket = useCockpit((s) => s.activeMarket);

  const rows = MARKETS
    .map((m) => ({ market: m, stats: outcomeStats[m.symbol] }))
    .filter((r) => r.stats && r.stats.totals.t1 > 0);

  return (
    <div className="glass rounded-xl p-4 space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">
          Empirical Outcomes · per market
        </h3>
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
          win-rate @ +1 / +2 / +3 / +5 ticks
        </span>
      </div>

      {rows.length === 0 && (
        <div className="text-[11px] text-muted-foreground italic py-3">
          Waiting for first resolved signals… the tracker logs every emitted MATCH
          and grades it against the next 1/2/3/5 ticks.
        </div>
      )}

      <div className="space-y-1">
        {rows.map(({ market, stats }) => {
          const isActive = market.symbol === activeMarket;
          return (
            <div
              key={market.symbol}
              className={`grid grid-cols-[140px_1fr_auto] items-center gap-3 text-[11px] font-mono px-2 py-1.5 rounded ${
                isActive ? "bg-[var(--gold)]/10 border border-[var(--gold)]/30" : "border border-transparent"
              }`}
            >
              <div className="truncate">
                <span className={isActive ? "gold-text font-semibold" : "text-foreground"}>
                  {market.symbol}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {HORIZONS.map((h) => {
                  const wr = winRate(stats, h);
                  const pct = wr == null ? "—" : `${(wr * 100).toFixed(0)}%`;
                  const tone =
                    wr == null ? "text-muted-foreground"
                    : wr >= 0.6 ? "text-[oklch(0.72_0.17_145)]"
                    : wr >= 0.45 ? "text-[var(--gold)]"
                    : "text-[oklch(0.62_0.22_25)]";
                  return (
                    <div key={h} className="flex items-baseline gap-1">
                      <span className="text-muted-foreground/70 uppercase">{h}</span>
                      <span className={tone}>{pct}</span>
                    </div>
                  );
                })}
              </div>
              <div className="text-muted-foreground/70 whitespace-nowrap">
                n={stats!.totals.t1} · rev {(stats!.reversalRate * 100).toFixed(0)}% · dom-surv {stats!.avgDominanceSurvival.toFixed(1)}t
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
