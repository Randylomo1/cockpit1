/**
 * Multi-market scanner — subscribes to all Volatility markets in parallel,
 * runs scanMatches() on each per-market digit buffer, and emits a ranked
 * list so the UI can show the strongest opportunity right now.
 *
 * Independent of the main cockpit store: holds its own lightweight digit
 * buffers tied to the shared DerivClient WS.
 */
import { getDerivClient, type Tick } from "../deriv/ws";
import type { MarketSymbol } from "../deriv/markets";
import { scanMatches, type MatchScan } from "./matchScanner";
import { recordTick } from "../db/tickDb";

export const SCAN_MARKETS: MarketSymbol[] = ["R_10", "R_25", "R_50", "R_75", "R_100"];
const BUFFER_CAP = 500;

export interface MarketRanking {
  symbol: MarketSymbol;
  scan: MatchScan;
  tickCount: number;
  lastPrice?: number;
  lastDigit?: number;
}

type Listener = (rankings: MarketRanking[]) => void;

class MultiScanner {
  private buffers = new Map<MarketSymbol, number[]>();
  private lastTick = new Map<MarketSymbol, Tick>();
  private listeners = new Set<Listener>();
  private started = false;
  private unsubTick?: () => void;
  private unsubStatus?: () => void;
  private throttle: ReturnType<typeof setTimeout> | null = null;

  start() {
    if (this.started) return;
    this.started = true;
    const client = getDerivClient();
    for (const sym of SCAN_MARKETS) this.buffers.set(sym, []);

    const tickListener = (t: Tick) => {
      if (!SCAN_MARKETS.includes(t.symbol)) return;
      const buf = this.buffers.get(t.symbol) ?? [];
      const next = buf.length >= BUFFER_CAP
        ? [...buf.slice(buf.length - BUFFER_CAP + 1), t.lastDigit]
        : [...buf, t.lastDigit];
      this.buffers.set(t.symbol, next);
      this.lastTick.set(t.symbol, t);
      // Persist to tick history DB (batched internally).
      recordTick({ ts: t.receivedAt, symbol: t.symbol, price: t.quote, digit: t.lastDigit });
      this.scheduleEmit();
    };
    const off1 = client.onTick(tickListener);
    this.unsubTick = off1 as unknown as () => void;

    const subAll = () => {
      for (const sym of SCAN_MARKETS) {
        client.subscribeTicks(sym);
        client.fetchHistory(sym, 300).catch(() => {});
      }
    };
    if (client.getStatus() === "open") subAll();
    const off2 = client.onStatus((s) => { if (s === "open") subAll(); });
    this.unsubStatus = off2 as unknown as () => void;
  }

  stop() {
    this.started = false;
    this.unsubTick?.();
    this.unsubStatus?.();
    if (this.throttle) clearTimeout(this.throttle);
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    l(this.snapshot());
    return () => this.listeners.delete(l);
  }

  snapshot(): MarketRanking[] {
    const rows: MarketRanking[] = [];
    for (const sym of SCAN_MARKETS) {
      const buf = this.buffers.get(sym) ?? [];
      const scan = scanMatches(buf);
      const lt = this.lastTick.get(sym);
      rows.push({
        symbol: sym,
        scan,
        tickCount: buf.length,
        lastPrice: lt?.quote,
        lastDigit: lt?.lastDigit,
      });
    }
    rows.sort((a, b) => (b.scan.best?.score ?? 0) - (a.scan.best?.score ?? 0));
    return rows;
  }

  private scheduleEmit() {
    if (this.throttle) return;
    this.throttle = setTimeout(() => {
      this.throttle = null;
      const snap = this.snapshot();
      this.listeners.forEach((l) => { try { l(snap); } catch {} });
    }, 200);
  }
}

let _instance: MultiScanner | null = null;
export function getMultiScanner(): MultiScanner {
  if (!_instance) _instance = new MultiScanner();
  return _instance;
}
