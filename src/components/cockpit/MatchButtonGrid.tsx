/**
 * MATCH BUTTON GRID — per-digit (0..9) live execution panel.
 *
 * Reads `snap.perDigit[d].confidence` (computed by SignalEngine using the
 * same weighted formula as top-signal scoring) plus momentum, streak, and
 * temperature. Each button is a single-click execute for DIGITMATCH on the
 * active market, with **confidence-weighted stake**:
 *
 *     stake = stakeMin + (stakeMax - stakeMin) * clamp((conf - 50)/50, 0..1)
 *
 * Buttons gate themselves: disabled if not connected, if confidence is below
 * `executeThreshold`, or while the engine reports a chaotic regime. The
 * visual heat reflects the engine's current ranking — no random pulses.
 */
import { useMemo, useState } from "react";
import { useCockpit } from "@/lib/engine/store";
import { useAccount } from "@/lib/deriv/accountStore";
import { getAuthClient } from "@/lib/deriv/authWs";
import { toast } from "sonner";

const EXECUTE_THRESHOLD = 70; // min per-digit confidence for the green path

function weightedStake(confidence: number, min: number, max: number) {
  const t = Math.max(0, Math.min(1, (confidence - 50) / 50));
  const raw = min + (max - min) * t;
  return Math.max(0.35, Number(raw.toFixed(2)));
}

export function MatchButtonGrid() {
  const { activeMarket, snapshot } = useCockpit();
  const snap = snapshot[activeMarket];

  const accountStatus = useAccount((s) => s.status);
  const balance = useAccount((s) => s.balance);
  const connected = accountStatus === "CONNECTED";

  const [stakeMin, setStakeMin] = useState(0.5);
  const [stakeMax, setStakeMax] = useState(5);
  const [busyDigit, setBusyDigit] = useState<number | null>(null);

  const rows = useMemo(() => {
    if (!snap) return [];
    const sorted = [...snap.perDigit].sort((a, b) => b.confidence - a.confidence);
    const topConf = sorted[0]?.confidence ?? 0;
    return snap.perDigit.map((pd) => ({
      ...pd,
      isTop: pd.digit === sorted[0]?.digit,
      relative: topConf > 0 ? pd.confidence / topConf : 0,
      stake: weightedStake(pd.confidence, stakeMin, stakeMax),
    }));
  }, [snap, stakeMin, stakeMax]);

  const chaotic = snap?.regime === "chaotic";

  const onExecute = async (digit: number, conf: number, stake: number) => {
    if (!connected) {
      toast.error("Connect your Deriv account first");
      return;
    }
    if (conf < EXECUTE_THRESHOLD) {
      toast.error(`Confidence ${conf}% < ${EXECUTE_THRESHOLD}% — wait for stronger setup`);
      return;
    }
    if (chaotic) {
      toast.error("Chaotic regime — entries blocked");
      return;
    }
    setBusyDigit(digit);
    const tid = toast.loading(`MATCH ${digit} · ${activeMarket} · $${stake.toFixed(2)}`);
    try {
      const res = await getAuthClient().buyMatch({
        symbol: activeMarket, digit, stake, durationTicks: 1,
      });
      toast.success(`Trade placed · #${res.contract_id}`, {
        id: tid,
        description: `Conf ${conf}% · Stake $${res.buy_price.toFixed(2)} · Payout $${res.payout.toFixed(2)}`,
      });
    } catch (e: any) {
      toast.error("Trade rejected", { id: tid, description: String(e?.message ?? e) });
    } finally {
      setBusyDigit(null);
    }
  };

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">
            Match Buttons · 0–9
          </h3>
          <div className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">
            Confidence-weighted stake · 1-click DIGITMATCH on {activeMarket}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <label className="text-muted-foreground uppercase tracking-widest">Min</label>
          <input
            type="number" step="0.5" min="0.35"
            value={stakeMin}
            onChange={(e) => setStakeMin(Math.max(0.35, Number(e.target.value) || 0.35))}
            className="w-16 bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-foreground focus:outline-none focus:border-[var(--gold)]"
          />
          <label className="text-muted-foreground uppercase tracking-widest">Max</label>
          <input
            type="number" step="0.5" min="0.35"
            value={stakeMax}
            onChange={(e) => setStakeMax(Math.max(stakeMin, Number(e.target.value) || stakeMin))}
            className="w-16 bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-foreground focus:outline-none focus:border-[var(--gold)]"
          />
          <span className="text-muted-foreground">
            {balance ? `${balance.currency} ${balance.balance.toFixed(2)}` : "USD"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
        {rows.map((r) => {
          const armed = connected && !chaotic && r.confidence >= EXECUTE_THRESHOLD;
          const tempColor =
            r.temperature === "hot" ? "oklch(0.78 0.13 86)"
            : r.temperature === "cold" ? "oklch(0.55 0.04 256)"
            : "oklch(0.45 0.02 256)";
          const glow = r.isTop && armed
            ? "shadow-[0_0_24px_-6px_var(--gold)] border-[var(--gold)]"
            : armed ? "border-[var(--gold)]/40"
            : "border-[var(--border)]";
          const intensity = Math.min(1, Math.max(0, (r.confidence - 30) / 70));
          const busy = busyDigit === r.digit;
          return (
            <button
              key={r.digit}
              onClick={() => onExecute(r.digit, r.confidence, r.stake)}
              disabled={busy}
              className={`relative group rounded-lg border-2 ${glow} p-2 text-left transition-all duration-200 disabled:opacity-60 disabled:cursor-wait hover:scale-[1.02] hover:brightness-110 ${!armed ? "opacity-70" : ""}`}
              style={{
                background: `linear-gradient(180deg, oklch(0.78 0.13 86 / ${intensity * 0.18}), oklch(0.165 0 0))`,
              }}
              title={
                !connected ? "Connect Deriv account to enable"
                : chaotic ? "Chaotic regime — entries blocked"
                : r.confidence < EXECUTE_THRESHOLD ? `Confidence ${r.confidence}% below ${EXECUTE_THRESHOLD}%`
                : `Buy DIGITMATCH ${r.digit} · stake $${r.stake.toFixed(2)} (conf ${r.confidence}%)`
              }
            >
              <div className="flex items-baseline justify-between">
                <span className={`font-mono font-black text-2xl ${r.isTop && armed ? "gold-text" : "text-foreground"}`}>
                  {r.digit}
                </span>
                <span className="text-[10px] font-mono" style={{ color: tempColor }}>
                  {r.temperature === "hot" ? "▲" : r.temperature === "cold" ? "▼" : "—"}
                </span>
              </div>
              <div className="mt-1 font-mono text-[11px] font-semibold">
                {busy ? "…" : `${r.confidence}%`}
              </div>
              {/* momentum bar */}
              <div className="mt-1 h-1 bg-[var(--surface-2)] rounded-full overflow-hidden">
                <div
                  className="h-full"
                  style={{
                    width: `${Math.min(100, r.momentum)}%`,
                    background: "linear-gradient(90deg, var(--gold-soft), var(--gold))",
                  }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[9px] font-mono text-muted-foreground">
                <span>z{r.zScore >= 0 ? "+" : ""}{r.zScore.toFixed(1)}</span>
                <span>{r.streak > 0 ? `×${r.streak}` : "·"}</span>
              </div>
              <div className="mt-0.5 text-[9px] font-mono text-muted-foreground/80">
                ${r.stake.toFixed(2)}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-muted-foreground/70">
        <span>Threshold ≥ {EXECUTE_THRESHOLD}% · regime: <span className="capitalize text-foreground/80">{snap?.regime ?? "—"}</span></span>
        <span>{connected ? "● account live" : "○ account offline"}</span>
      </div>
    </div>
  );
}
