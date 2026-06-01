/**
 * MATCH INTELLIGENCE — primary cockpit panel.
 *
 * - Runs scanMatches() on every incoming tick (microseconds, O(10×window)).
 * - Displays the current Trade Digit, ranking, frequency table.
 * - Manual one-click execute via DIGITMATCH.
 * - Optional AUTO-TRADE toggle with full risk controls:
 *     stake · take-profit · stop-loss · max consecutive losses ·
 *     min seconds between trades.
 * - Tracks settled contracts for live performance metrics
 *   (wins, losses, win-rate, net P/L).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useCockpit } from "@/lib/engine/store";
import { scanMatches, HIGH_CONF_THRESHOLD, type SignalStrength } from "@/lib/engine/matchScanner";
import { useAccount } from "@/lib/deriv/accountStore";
import { getAuthClient, type TradeTimings } from "@/lib/deriv/authWs";
import { toast } from "sonner";

const STRENGTH_COLOR: Record<SignalStrength, string> = {
  WEAK: "text-muted-foreground",
  MODERATE: "text-[oklch(0.78_0.16_70)]",
  STRONG: "text-[oklch(0.78_0.16_70)]",
  "VERY STRONG": "text-[oklch(0.85_0.18_85)]",
  EXTREME: "text-[oklch(0.72_0.17_145)]",
};

interface Perf {
  trades: number;
  wins: number;
  losses: number;
  netPnL: number;
  consecLosses: number;
}

export function MatchIntelligence() {
  const { activeMarket, digits, lastTick } = useCockpit();
  const buffer = digits[activeMarket] ?? [];
  const tick = lastTick[activeMarket];

  const scan = useMemo(() => scanMatches(buffer), [buffer]);

  // ─── Trade params ─────────────────────────────────────────────────────────
  const [stake, setStake] = useState(1);
  const [autoTrade, setAutoTrade] = useState(false);
  const [takeProfit, setTakeProfit] = useState(20);   // session $
  const [stopLoss, setStopLoss] = useState(15);       // session $
  const [maxConsecLosses, setMaxConsecLosses] = useState(3);
  const [minIntervalSec, setMinIntervalSec] = useState(4);

  // ─── Account ──────────────────────────────────────────────────────────────
  const accountStatus = useAccount((s) => s.status);
  const bootstrap = useAccount((s) => s.bootstrap);
  const balance = useAccount((s) => s.balance);
  useEffect(() => { bootstrap(); }, [bootstrap]);
  const accountConnected = accountStatus === "CONNECTED";

  // ─── Performance ──────────────────────────────────────────────────────────
  const [perf, setPerf] = useState<Perf>({
    trades: 0, wins: 0, losses: 0, netPnL: 0, consecLosses: 0,
  });
  const [tradeStatus, setTradeStatus] = useState<"IDLE" | "ANALYZING" | "EXECUTING" | "OPEN" | "SETTLED" | "PAUSED">("ANALYZING");
  const [pausedReason, setPausedReason] = useState<string | null>(null);
  const [lastTimings, setLastTimings] = useState<TradeTimings | null>(null);

  // Subscribe to live latency emitted by buyMatch()
  useEffect(() => {
    const unsub = getAuthClient().onTradeTimings((t) => setLastTimings(t));
    return () => { unsub(); };
  }, []);

  // ─── Stable presented digit (hysteresis to prevent flicker) ───────────────
  const best = scan.best;
  const [presentedDigit, setPresentedDigit] = useState<number | null>(null);

  useEffect(() => {
    if (!best) return;
    setPresentedDigit((current) => {
      if (current == null) return best.digit;
      if (current === best.digit) return current;
      const cur = scan.ranks.find((r) => r.digit === current);
      const upgrade = best.score - (cur?.score ?? 0);
      if (upgrade >= 6 || scan.dominanceGap >= 10) return best.digit;
      return current;
    });
  }, [best, scan.dominanceGap, scan.ranks]);

  const displayedRank = presentedDigit == null
    ? best
    : scan.ranks.find((r) => r.digit === presentedDigit) ?? best;
  const showDigit = displayedRank;

  // ─── Risk gate ────────────────────────────────────────────────────────────
  const checkRiskGate = (): string | null => {
    if (perf.netPnL >= takeProfit) return `Take-profit hit (+$${perf.netPnL.toFixed(2)})`;
    if (perf.netPnL <= -stopLoss) return `Stop-loss hit (-$${Math.abs(perf.netPnL).toFixed(2)})`;
    if (perf.consecLosses >= maxConsecLosses) return `Max ${maxConsecLosses} consecutive losses`;
    return null;
  };

  // ─── Core executor (manual + auto share this) ─────────────────────────────
  const inFlight = useRef(false);
  const lastTradeAt = useRef<number>(0);

  const executeTrade = async (digit: number) => {
    if (inFlight.current) return;
    if (!accountConnected) { toast.error("Connect your Deriv account first"); return; }
    const risk = checkRiskGate();
    if (risk) { setTradeStatus("PAUSED"); setPausedReason(risk); toast.error(risk); return; }

    inFlight.current = true;
    setTradeStatus("EXECUTING");
    lastTradeAt.current = Date.now();
    const tid = toast.loading(`MATCH ${digit} · ${activeMarket} · $${stake}`);
    try {
      const res = await getAuthClient().buyMatch({
        symbol: activeMarket, digit, stake, durationTicks: 1,
      });
      toast.success(`Trade placed · #${res.contract_id}`, {
        id: tid,
        description: `Stake $${res.buy_price.toFixed(2)} · Payout $${res.payout.toFixed(2)}`,
      });
      setTradeStatus("OPEN");
      // Await settlement → update perf
      try {
        const settled = await getAuthClient().awaitSettlement(res.contract_id);
        const win = settled.profit > 0;
        setPerf((p) => ({
          trades: p.trades + 1,
          wins: p.wins + (win ? 1 : 0),
          losses: p.losses + (win ? 0 : 1),
          netPnL: p.netPnL + settled.profit,
          consecLosses: win ? 0 : p.consecLosses + 1,
        }));
        setTradeStatus("SETTLED");
        toast[win ? "success" : "error"](
          `${win ? "WIN" : "LOSS"} · ${settled.profit >= 0 ? "+" : ""}$${settled.profit.toFixed(2)}`
        );
      } catch (e: any) {
        toast.error("Settlement tracking lost", { description: String(e?.message ?? e) });
        setTradeStatus("IDLE");
      }
    } catch (e: any) {
      toast.error("Trade rejected", { id: tid, description: String(e?.message ?? e) });
      setTradeStatus("IDLE");
    } finally {
      inFlight.current = false;
    }
  };

  // ─── Auto-trade loop: react to high-confidence scans ──────────────────────
  useEffect(() => {
    if (!autoTrade) return;
    if (!accountConnected) return;
    if (inFlight.current) return;
    if (!scan.highConfidence || !showDigit) return;

    const risk = checkRiskGate();
    if (risk) { setTradeStatus("PAUSED"); setPausedReason(risk); return; }

    const since = (Date.now() - lastTradeAt.current) / 1000;
    if (since < minIntervalSec) return;

    setPausedReason(null);
    void executeTrade(showDigit.digit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.highConfidence, scan.tickCount, autoTrade, accountConnected, showDigit?.digit]);

  // Reset to ANALYZING after a settlement so the UI clearly returns to live scan.
  useEffect(() => {
    if (tradeStatus === "SETTLED") {
      const t = setTimeout(() => setTradeStatus("ANALYZING"), 1500);
      return () => clearTimeout(t);
    }
  }, [tradeStatus]);

  const onManualExecute = () => {
    if (!showDigit) { toast.error("No candidate yet"); return; }
    void executeTrade(showDigit.digit);
  };

  const resetSession = () => {
    setPerf({ trades: 0, wins: 0, losses: 0, netPnL: 0, consecLosses: 0 });
    setPausedReason(null);
    setTradeStatus("IDLE");
    toast.success("Session reset");
  };

  // ─── Styles ───────────────────────────────────────────────────────────────
  const entryColor =
    scan.entry === "ENTER NOW" ? "text-[oklch(0.72_0.17_145)]" :
    scan.entry === "PREPARING" ? "text-[oklch(0.85_0.18_85)]" :
    "text-muted-foreground";

  const borderClass = scan.highConfidence
    ? "border-[var(--gold)] shadow-[0_0_50px_-10px_var(--gold)]"
    : "border-[var(--border)]";

  const winRate = perf.trades > 0 ? (perf.wins / perf.trades) * 100 : 0;
  const pnlColor = perf.netPnL > 0 ? "text-[oklch(0.72_0.17_145)]"
    : perf.netPnL < 0 ? "text-[oklch(0.62_0.22_25)]" : "text-foreground";

  const statusBadge = {
    IDLE: "text-muted-foreground",
    ANALYZING: "text-muted-foreground",
    EXECUTING: "text-[oklch(0.85_0.18_85)]",
    OPEN: "text-[oklch(0.85_0.18_85)]",
    SETTLED: "text-foreground",
    PAUSED: "text-[oklch(0.62_0.22_25)]",
  }[tradeStatus];

  return (
    <div className={`glass rounded-xl p-5 border-2 ${borderClass} transition-all duration-200`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
          Match Intelligence · Real-Time Scanner
        </div>
        <div className="flex items-center gap-4">
          <div className={`text-[10px] font-mono uppercase tracking-widest ${statusBadge}`}>
            ◉ {tradeStatus}{pausedReason ? ` — ${pausedReason}` : ""}
          </div>
          <div className={`text-[10px] font-mono uppercase tracking-widest ${entryColor}`}>
            ● {scan.entry}
          </div>
        </div>
      </div>

      {/* Live execution-latency strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <LatencyTile label="Proposal" value={lastTimings ? `${lastTimings.proposalMs} ms` : "—"} good={lastTimings ? lastTimings.proposalMs < 250 : null} />
        <LatencyTile label="Buy" value={lastTimings ? `${lastTimings.buyMs} ms` : "—"} good={lastTimings ? lastTimings.buyMs < 250 : null} />
        <LatencyTile label="Total Execution" value={lastTimings ? `${lastTimings.totalMs} ms` : "—"} good={lastTimings ? lastTimings.totalMs < 500 : null} />
        <LatencyTile label="Last Trade" value={lastTimings ? `${Math.max(0, Math.round((Date.now() - lastTimings.at) / 1000))}s ago` : "no trades yet"} />
      </div>

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
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Persistence</div>
            <div className="text-right text-foreground">{showDigit?.persistence ?? 0}/100</div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Momentum</div>
            <div className="text-right text-foreground">{showDigit ? (showDigit.momentum > 0 ? "+" : "") + showDigit.momentum : "—"}</div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Streak</div>
            <div className="text-right text-foreground">{showDigit?.streak ?? 0}</div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Rank #1 gap</div>
            <div className="text-right text-foreground">+{scan.dominanceGap}</div>
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Ticks analysed</div>
            <div className="text-right text-foreground">{scan.tickCount}</div>
          </div>
        </div>
      </div>

      {/* Reasons (when not firing) */}
      {!scan.highConfidence && scan.reasons.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--border)]">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
            Filter Status · need ALL · threshold {HIGH_CONF_THRESHOLD}/100
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

      {/* Performance */}
      <div className="mt-4 pt-4 border-t border-[var(--border)] grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Trades" value={String(perf.trades)} />
        <Stat label="Wins" value={String(perf.wins)} tone="text-[oklch(0.72_0.17_145)]" />
        <Stat label="Losses" value={String(perf.losses)} tone="text-[oklch(0.62_0.22_25)]" />
        <Stat label="Win Rate" value={`${winRate.toFixed(0)}%`} />
        <Stat label="Net P/L" value={`${perf.netPnL >= 0 ? "+" : ""}$${perf.netPnL.toFixed(2)}`} tone={pnlColor} />
      </div>

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
                  <div>per {r.persistence}</div>
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
                <th className="text-right">f₂₀₀</th>
                <th className="text-right">Mom</th>
                <th className="text-right">Per</th>
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
                    <td className={`text-right ${r.momentum > 0 ? "text-[oklch(0.72_0.17_145)]" : "text-muted-foreground"}`}>
                      {r.momentum > 0 ? "+" : ""}{r.momentum}
                    </td>
                    <td className="text-right text-muted-foreground">{r.persistence}</td>
                    <td className="text-right text-foreground">{r.score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Risk controls */}
      <div className="mt-4 pt-4 border-t border-[var(--border)]">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Risk Controls · Session
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] font-mono">
          <NumberField label="Stake $" value={stake} setValue={setStake} min={0.35} step={0.5} />
          <NumberField label="Take Profit $" value={takeProfit} setValue={setTakeProfit} min={0} step={1} />
          <NumberField label="Stop Loss $" value={stopLoss} setValue={setStopLoss} min={0} step={1} />
          <NumberField label="Max Loss Streak" value={maxConsecLosses} setValue={setMaxConsecLosses} min={1} step={1} />
          <NumberField label="Min Interval s" value={minIntervalSec} setValue={setMinIntervalSec} min={0} step={1} />
        </div>
      </div>

      {/* Execution */}
      <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-mono text-muted-foreground">
          {balance ? `${balance.currency} · bal ${balance.balance.toFixed(2)}` : "USD"}
        </span>
        <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground select-none cursor-pointer">
          <input
            type="checkbox"
            checked={autoTrade}
            onChange={(e) => {
              setAutoTrade(e.target.checked);
              if (e.target.checked) setPausedReason(null);
            }}
            className="accent-[var(--gold)] w-4 h-4"
          />
          Auto-trade {autoTrade ? "ON" : "OFF"}
        </label>
        <button
          onClick={resetSession}
          className="px-3 py-1 rounded-md font-mono text-[10px] uppercase tracking-widest text-muted-foreground border border-[var(--border)] hover:border-[var(--gold)]/60"
        >
          Reset session
        </button>
        <div className="flex-1" />
        <button
          onClick={onManualExecute}
          disabled={inFlight.current}
          className={`px-5 py-2 rounded-md font-mono text-xs uppercase tracking-widest font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${
            accountConnected && scan.highConfidence
              ? "bg-[oklch(0.72_0.17_145)] text-black hover:brightness-110"
              : "bg-[var(--surface-2)] text-foreground border border-[var(--border)] hover:border-[var(--gold)]/60"
          }`}
          title={!accountConnected ? "Account not connected"
            : !showDigit ? "Waiting for candidate"
            : `Buy DIGITMATCH ${showDigit.digit} on ${activeMarket} for $${stake}`}
        >
          {inFlight.current ? "Placing…" : `▶ Execute Match${showDigit ? ` · ${showDigit.digit}` : ""}`}
        </button>
      </div>

      <div className="mt-2 text-[10px] font-mono text-muted-foreground/70 leading-snug">
        Real-time statistical scoring — no prediction. Auto-trade fires only when score ≥ {HIGH_CONF_THRESHOLD}/100,
        all filters align, and risk gates are clear. Past frequency does not guarantee future ticks.
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--surface-2)]/30 p-2">
      <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`font-mono text-base font-bold ${tone ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}

function NumberField({
  label, value, setValue, min, step,
}: { label: string; value: number; setValue: (v: number) => void; min: number; step: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground uppercase tracking-widest">{label}</span>
      <input
        type="number" min={min} step={step} value={value}
        onChange={(e) => setValue(Math.max(min, Number(e.target.value) || min))}
        className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-foreground focus:outline-none focus:border-[var(--gold)]"
      />
    </label>
  );
}
