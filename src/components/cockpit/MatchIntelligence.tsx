/**
 * MATCH INTELLIGENCE — primary cockpit panel.
 *
 * Reads the live tick buffer from the cockpit store, runs scanMatches()
 * on EVERY tick, and renders:
 *   - the single current Trade Digit (or "no setup" silence)
 *   - signal strength, score, confidence, entry status
 *   - top 3 ranked digits
 *   - live frequency table (counts + rate per window)
 *   - one-click execute (DIGITMATCH on the active market)
 *
 * No prediction. No AI. Pure rolling statistics.
 */
import { useEffect, useMemo, useState } from "react";
import { useCockpit } from "@/lib/engine/store";
import { scanMatches, HIGH_CONF_THRESHOLD, type SignalStrength } from "@/lib/engine/matchScanner";
import { useAccount } from "@/lib/deriv/accountStore";
import { getAuthClient } from "@/lib/deriv/authWs";
import { toast } from "sonner";

const STRENGTH_COLOR: Record<SignalStrength, string> = {
  WEAK: "text-muted-foreground",
  MODERATE: "text-[oklch(0.78_0.16_70)]",
  STRONG: "text-[oklch(0.78_0.16_70)]",
  "VERY STRONG": "text-[oklch(0.85_0.18_85)]",
  EXTREME: "text-[oklch(0.72_0.17_145)]",
};

export function MatchIntelligence() {
  const { activeMarket, digits, lastTick } = useCockpit();
  const buffer = digits[activeMarket] ?? [];
  const tick = lastTick[activeMarket];

  // scanMatches runs every render — which is every tick because the cockpit
  // store sets new state on every incoming tick. O(10 × window), microseconds.
  const scan = useMemo(() => scanMatches(buffer), [buffer]);

  const [stake, setStake] = useState(1);
  const [executing, setExecuting] = useState(false);
  const accountStatus = useAccount((s) => s.status);
  const bootstrap = useAccount((s) => s.bootstrap);
  const balance = useAccount((s) => s.balance);
  useEffect(() => { bootstrap(); }, [bootstrap]);
  const accountConnected = accountStatus === "CONNECTED";

  const best = scan.best;
  /**
   * Stable live candidate logic:
   * - Always surface the top-ranked digit as soon as the stream has a small sample.
   * - Keep the last presented digit unless the newcomer is materially better.
   * This prevents the main trade digit from staying blank or flickering too often.
   */
  const [presentedDigit, setPresentedDigit] = useState<number | null>(null);

  useEffect(() => {
    if (!best) return;
    setPresentedDigit((current) => {
      if (current == null) return best.digit;
      if (current === best.digit) return current;

      const currentRank = scan.ranks.find((rank) => rank.digit === current);
      const currentScore = currentRank?.score ?? 0;
      const scoreUpgrade = best.score - currentScore;

      // Switch only when the new leader clearly outclasses the current one.
      if (scoreUpgrade >= 8 || scan.dominanceGap >= 12 || best.rank === 1 && best.score >= 82) {
        return best.digit;
      }

      return current;
    });
  }, [best, scan.dominanceGap, scan.ranks]);

  const displayedRank = presentedDigit == null
    ? best
    : scan.ranks.find((rank) => rank.digit === presentedDigit) ?? best;
  const showDigit = displayedRank;

  const onExecute = async () => {
    if (executing) return;
    if (!showDigit) { toast.error("No candidate yet — waiting for ticks"); return; }
    if (!accountConnected) {
      toast.error("Connect your Deriv account first", { description: `Status: ${accountStatus}` });
      return;
    }
    if (!scan.highConfidence) {
      toast.error("Signal not high-confidence", {
        description: scan.reasons.slice(0, 2).join(" · ") || "Wait for setup.",
      });
      return;
    }
    setExecuting(true);
    const tid = toast.loading(`Placing MATCH ${showDigit.digit} · ${activeMarket} · $${stake}`);
    try {
      const res = await getAuthClient().buyMatch({
        symbol: activeMarket, digit: showDigit.digit, stake, durationTicks: 1,
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

  const entryColor =
    scan.entry === "ENTER NOW" ? "text-[oklch(0.72_0.17_145)]" :
    scan.entry === "PREPARING" ? "text-[oklch(0.85_0.18_85)]" :
    "text-muted-foreground";

  const borderClass = scan.highConfidence
    ? "border-[var(--gold)] shadow-[0_0_50px_-10px_var(--gold)]"
    : "border-[var(--border)]";

  return (
    <div className={`glass rounded-xl p-5 border-2 ${borderClass} transition-all duration-200`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
          Match Intelligence · Real-Time Scanner
        </div>
        <div className={`text-[10px] font-mono uppercase tracking-widest ${entryColor}`}>
          ● {scan.entry}
        </div>
      </div>

      {/* Main display */}
      <div className="grid grid-cols-[auto_1fr] gap-6 items-center">
        <div className="text-center">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            Trade Digit
          </div>
          <div
            className={`font-mono font-black leading-none ${showDigit ? "gold-text" : "text-muted-foreground/40"}`}
            style={{ fontSize: "8rem" }}
          >
            {showDigit ? showDigit.digit : "—"}
          </div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-1">
            {showDigit ? `Signal Quality Score ${showDigit.score}/100` : "warming up live stream"}
          </div>
        </div>

        <div className="space-y-2">
          {showDigit ? (
            <div className={`text-3xl font-mono font-bold ${scan.highConfidence ? STRENGTH_COLOR.EXTREME : STRENGTH_COLOR[scan.strength]} uppercase tracking-wider`}>
              {scan.highConfidence ? "HIGH-CONFIDENCE SETUP" : "LIVE TRADE DIGIT"}
            </div>
          ) : (
            <div className="text-xl font-mono font-bold text-muted-foreground/80 uppercase tracking-wider">
              Continue Monitoring…
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-mono pt-2">
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Market</div>
            <div className="text-right text-foreground">{activeMarket}</div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Last Tick</div>
            <div className="text-right text-foreground">{tick?.lastDigit ?? "—"} · {tick?.quote.toFixed(4) ?? "—"}</div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Strength</div>
            <div className={`text-right font-semibold ${showDigit ? STRENGTH_COLOR[scan.strength] : "text-muted-foreground"}`}>
              {showDigit ? scan.strength : "—"}
            </div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Signal Quality</div>
            <div className="text-right text-foreground">{showDigit?.score ?? 0}/100</div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Rank #1 gap</div>
            <div className="text-right text-foreground">+{scan.dominanceGap}</div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Ticks analysed</div>
            <div className="text-right text-foreground">{scan.tickCount}</div>
          </div>
        </div>
      </div>

      {/* Reasons / filter status when not firing */}
      {!scan.highConfidence && scan.reasons.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--border)]">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
            Filter Status (need ALL to pass · threshold {HIGH_CONF_THRESHOLD})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {scan.reasons.map((r) => (
              <span key={r}
                className="text-[10px] font-mono px-2 py-0.5 rounded border border-[var(--border)] text-muted-foreground bg-[var(--surface-2)]/40">
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Top 3 ranking */}
      <div className="mt-4 pt-4 border-t border-[var(--border)]">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Live Ranking · Top 3
        </div>
        <div className="grid grid-cols-3 gap-2">
          {scan.ranks.slice(0, 3).map((r) => (
            <div key={r.digit}
              className={`rounded border p-2 font-mono text-xs ${
                r.rank === 1
                  ? "border-[var(--gold)]/60 bg-[var(--gold)]/5"
                  : "border-[var(--border)] bg-[var(--surface-2)]/30"
              }`}>
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Rank {r.rank}</span>
                <span className="text-[10px] text-muted-foreground">score {r.score}</span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className={`text-3xl font-black ${r.rank === 1 ? "gold-text" : "text-foreground"}`}>{r.digit}</span>
                <div className="text-right text-[10px] text-muted-foreground leading-tight">
                  <div>f₂₀ {(r.freqShort * 100).toFixed(0)}%</div>
                  <div>mom {r.momentum > 0 ? "+" : ""}{r.momentum}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live frequency table */}
      <div className="mt-4 pt-4 border-t border-[var(--border)]">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Live Frequency Table
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="text-muted-foreground uppercase tracking-widest">
                <th className="text-left py-1">Digit</th>
                <th className="text-right">Count₂₀</th>
                <th className="text-right">f₂₀</th>
                <th className="text-right">f₅₀</th>
                <th className="text-right">f₁₀₀</th>
                <th className="text-right">f₃₀₀</th>
                <th className="text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {[...scan.ranks].sort((a, b) => a.digit - b.digit).map((r) => {
                const hot = r.freqShort > 0.10;
                return (
                  <tr key={r.digit} className="border-t border-[var(--border)]/40">
                    <td className={`py-1 ${r.rank === 1 ? "gold-text font-bold" : "text-foreground"}`}>{r.digit}</td>
                    <td className="text-right text-foreground">{r.countShort}</td>
                    <td className={`text-right ${hot ? "text-[oklch(0.72_0.17_145)]" : "text-muted-foreground"}`}>
                      {(r.freqShort * 100).toFixed(0)}%
                    </td>
                    <td className="text-right text-muted-foreground">{(r.freqMedium * 100).toFixed(0)}%</td>
                    <td className="text-right text-muted-foreground">{(r.freqLong * 100).toFixed(0)}%</td>
                    <td className="text-right text-muted-foreground">{(r.freqStable * 100).toFixed(0)}%</td>
                    <td className="text-right text-foreground">{r.score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Execution */}
      <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap items-center gap-3">
        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Stake</label>
        <input
          type="number" step="0.5" min="0.35" value={stake}
          onChange={(e) => setStake(Math.max(0.35, Number(e.target.value) || 1))}
          className="w-20 bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-sm font-mono text-foreground focus:outline-none focus:border-[var(--gold)]"
        />
        <span className="text-[10px] font-mono text-muted-foreground">
          {balance ? `${balance.currency} · bal ${balance.balance.toFixed(2)}` : "USD"}
        </span>
        <div className="flex-1" />
        <button
          onClick={onExecute}
          disabled={executing}
          className={`px-5 py-2 rounded-md font-mono text-xs uppercase tracking-widest font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${
            accountConnected && scan.highConfidence
              ? "bg-[oklch(0.72_0.17_145)] text-black hover:brightness-110"
              : "bg-[var(--surface-2)] text-foreground border border-[var(--border)] hover:border-[var(--gold)]/60"
          }`}
          title={!accountConnected ? "Click for details — account not connected"
            : !scan.highConfidence ? "Click for details — no high-confidence setup"
            : `Buy DIGITMATCH ${showDigit?.digit} on ${activeMarket} for $${stake}`}
        >
          {executing ? "Placing…" : `▶ Execute Match${showDigit ? ` · ${showDigit.digit}` : ""}`}
        </button>
      </div>

      <div className="mt-2 text-[10px] font-mono text-muted-foreground/70 leading-snug">
        Real-time statistical scoring — no prediction. Signal fires only when score ≥ {HIGH_CONF_THRESHOLD}/100 AND all filters align.
        Past frequency does not guarantee future ticks; trade responsibly.
      </div>
    </div>
  );
}
