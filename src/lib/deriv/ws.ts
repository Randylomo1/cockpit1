/**
 * Deriv WebSocket client with auto-reconnect, request queue, ping, and tick streaming.
 * Browser-only (uses native WebSocket).
 */
import { DERIV_WS_URL, type MarketSymbol } from "./markets";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface Tick {
  symbol: MarketSymbol;
  quote: number;
  epoch: number;     // server epoch (seconds)
  receivedAt: number; // local ms
  lastDigit: number;
  pipSize: number;
}

type Listener = (t: Tick) => void;
type StatusListener = (s: ConnectionStatus, err?: string) => void;

interface PendingRequest {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  sentAt: number;
}

export class DerivClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "idle";
  private statusErr?: string;
  private reqId = 1;
  private pending = new Map<number, PendingRequest>();
  private subscriptions = new Map<MarketSymbol, string>(); // symbol -> subscription id
  private pendingSubs = new Set<MarketSymbol>();
  private tickListeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastLatencyMs = 0;
  private manualClose = false;

  connect() {
    if (typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.manualClose = false;
    this.setStatus("connecting");
    try {
      this.ws = new WebSocket(DERIV_WS_URL);
    } catch (e: any) {
      this.setStatus("error", e?.message ?? "WS construction failed");
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("open");
      this.startPing();
      // Re-subscribe to all markets after reconnect
      for (const sym of Array.from(this.subscriptions.keys())) {
        this.subscriptions.delete(sym);
        this.subscribeTicks(sym);
      }
    };
    this.ws.onmessage = (ev) => this.handleMessage(ev.data);
    this.ws.onclose = () => {
      this.stopPing();
      this.setStatus("closed");
      this.failAllPending(new Error("WebSocket closed"));
      if (!this.manualClose) this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      this.setStatus("error", "WebSocket error");
    };
  }

  disconnect() {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.subscriptions.clear();
    this.pendingSubs.clear();
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
    this.ws = null;
  }

  getStatus() { return this.status; }
  getStatusError() { return this.statusErr; }
  getLatency() { return this.lastLatencyMs; }

  onTick(l: Listener) { this.tickListeners.add(l); return () => this.tickListeners.delete(l); }
  onStatus(l: StatusListener) {
    this.statusListeners.add(l);
    l(this.status, this.statusErr);
    return () => this.statusListeners.delete(l);
  }

  /** Send raw request, returns a promise. */
  send<T = any>(payload: Record<string, any>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WS not open"));
        return;
      }
      const id = this.reqId++;
      const msg = { ...payload, req_id: id };
      this.pending.set(id, { resolve, reject, sentAt: performance.now() });
      try { this.ws.send(JSON.stringify(msg)); }
      catch (e) { this.pending.delete(id); reject(e); }
    });
  }

  async subscribeTicks(symbol: MarketSymbol) {
    if (this.subscriptions.has(symbol) || this.pendingSubs.has(symbol)) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.pendingSubs.add(symbol);
    try {
      await this.send({ ticks: symbol, subscribe: 1 });
    } catch (e) {
      // ignore — will retry on reconnect
    } finally {
      this.pendingSubs.delete(symbol);
    }
  }

  async unsubscribeTicks(symbol: MarketSymbol) {
    const id = this.subscriptions.get(symbol);
    this.subscriptions.delete(symbol);
    if (id && this.ws?.readyState === WebSocket.OPEN) {
      try { await this.send({ forget: id }); } catch {}
    }
  }

  /** Fetch the last N ticks (history) for warm-up. */
  async fetchHistory(symbol: MarketSymbol, count = 300) {
    return this.send({
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: "latest",
      style: "ticks",
    });
  }

  // ────────────────────────── internals ──────────────────────────

  private setStatus(s: ConnectionStatus, err?: string) {
    this.status = s;
    this.statusErr = err;
    this.statusListeners.forEach((l) => { try { l(s, err); } catch {} });
  }

  private handleMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.req_id && this.pending.has(msg.req_id)) {
      const p = this.pending.get(msg.req_id)!;
      this.lastLatencyMs = Math.round(performance.now() - p.sentAt);
      this.pending.delete(msg.req_id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "Deriv error"));
      else p.resolve(msg);
    }

    if (msg.msg_type === "tick" && msg.tick) {
      const t = msg.tick;
      const symbol = t.symbol as MarketSymbol;
      const subId = t.id as string;
      if (subId) this.subscriptions.set(symbol, subId);
      const pipSize = typeof t.pip_size === "number" ? t.pip_size : 2;
      const quote = Number(t.quote);
      const quoteStr = quote.toFixed(pipSize);
      const lastDigit = Number(quoteStr[quoteStr.length - 1]);
      const tick: Tick = {
        symbol,
        quote,
        epoch: Number(t.epoch),
        receivedAt: Date.now(),
        lastDigit,
        pipSize,
      };
      this.tickListeners.forEach((l) => { try { l(tick); } catch {} });
    }

    if (msg.msg_type === "history" && msg.history && msg.echo_req?.ticks_history) {
      const symbol = msg.echo_req.ticks_history as MarketSymbol;
      const rawPrices: Array<string | number> = msg.history.prices ?? [];
      const times: number[] = msg.history.times ?? [];
      const firstStr = rawPrices[0] != null ? String(rawPrices[0]) : "";
      const pipSize = firstStr.includes(".") ? (firstStr.split(".")[1]?.length ?? 2) : 2;
      const now = Date.now();
      rawPrices.forEach((p, i) => {
        const quote = Number(p);
        const quoteStr = quote.toFixed(pipSize);
        const lastDigit = Number(quoteStr[quoteStr.length - 1]);
        const tick: Tick = {
          symbol,
          quote,
          epoch: times[i] ?? Math.floor(now / 1000),
          receivedAt: now - (rawPrices.length - i) * 50,
          lastDigit,
          pipSize,
        };
        this.tickListeners.forEach((l) => { try { l(tick); } catch {} });
      });
    }
  }

  private failAllPending(err: Error) {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private scheduleReconnect() {
    if (this.manualClose) return;
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(15000, 500 * Math.pow(1.7, this.reconnectAttempts));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ ping: 1 }).catch(() => {});
      }
    }, 25_000);
  }
  private stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }
}

// Singleton for browser usage
let _client: DerivClient | null = null;
export function getDerivClient(): DerivClient {
  if (typeof window === "undefined") {
    // Return a non-connecting stub for SSR
    return new DerivClient();
  }
  if (!_client) _client = new DerivClient();
  return _client;
}
