/**
 * Multi-Market Scanner panel — ranks all 5 Volatility indices live by their
 * matches score so you can spot the strongest opportunity across markets.
 */
import { useEffect, useState } from "react";
import { getMultiScanner, type MarketRanking } from "@/lib/engine/multiScanner";
import { useCockpit } from "@/lib/engine/store";

const MARKET_LABEL: Record<string, string> = {
  R_10: "V10",
  R_25: "V25",
  R_50: "V50",
  R_75: "V75",
  R_100: "V100",
};

export function MultiMarketScanner() {
  const [rows, setRows] = useState<MarketRanking[]>([]);
  const setActive = useCockpit((s) => s.setActiveMarket);
  const active = useCockpit((s) => s.activeMarket);

  useEffect(() => {
    const ms = getMultiScanner();
    ms.start();
    const off = ms.subscribe(setRows);
    return () => { off(); };
  }, []);

  const top = rows[0];

  return (
    <div className="glass rounded-xl p-4 border border-[var(--border)]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
          Multi-Market Scanner · Volatility 10 / 25 / 50 / 75 / 100
        </div>
        {top?.scan.best && (
          <div className="text-[10px] font-mono uppercase tracking-widest">
            <span className="text-muted-foreground">Strongest: </span>
            <span className="text-[var(--gold)] font-bold">
              {MARKET_LABEL[top.symbol]} · digit {top.scan.best.digit} · {top.scan.best.score}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        {rows.map((r) => {
          const best = r.scan.best;
          const isActive = r.symbol === active;
          const hot = best && best.score >= 78;
          return (
            <button
              key={r.symbol}
              onClick={() => setActive(r.symbol)}
              className={`text-left rounded-md border p-2 transition ${
                isActive ? "border-[var(--gold)] bg-[var(--gold)]/5"
                  : hot ? "border-[oklch(0.72_0.17_145)]/50 bg-[oklch(0.72_0.17_145)]/5 hover:border-[var(--gold)]/60"
                  : "border-[var(--border)] bg-[var(--surface-2)]/30 hover:border-[var(--gold)]/40"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-xs font-bold">{MARKET_LABEL[r.symbol]}</span>
                <span className="text-[9px] font-mono text-muted-foreground">{r.tickCount}t</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-black gold-text leading-none">
                  {best ? best.digit : "·"}
                </span>
                <span className="font-mono text-sm font-semibold">
                  {best ? best.score : "—"}
                </span>
              </div>
              <div className="mt-1 text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                {r.scan.entry}
              </div>
              {best && (
                <div className="mt-1 h-1 bg-[var(--surface-2)] rounded-full overflow-hidden">
                  <div
                    className="h-full"
                    style={{
                      width: `${best.score}%`,
                      background: hot ? "var(--gold)" : "oklch(0.65 0.12 220)",
                    }}
                  />
                </div>
              )}
            </button>
          );
        })}
        {rows.length === 0 && (
          <div className="col-span-5 text-center text-xs text-muted-foreground italic py-3">
            Warming up scanner…
          </div>
        )}
      </div>

      <div className="mt-2 text-[9px] font-mono text-muted-foreground/70 uppercase tracking-widest">
        Click a tile to switch active market · Threshold ≥ 78 highlighted green
      </div>
    </div>
  );
}
