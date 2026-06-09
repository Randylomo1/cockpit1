/**
 * Authorized Deriv WebSocket client.
 *
 * SECURITY NOTE
 * -------------
 * Previous versions XOR-obfuscated tokens in localStorage. That was
 * security theatre — anything with JS access (XSS, extensions, devtools)
 * could recover the token. This module now uses **sessionStorage only**
 * with plain JSON: tokens live in memory for the tab session, are gone
 * when the tab closes, and are never persisted to disk via localStorage.
 *
 * Multiple concurrent authorized sockets are supported via the auth pool
 * (see ./authPool.ts) — e.g. Demo + Real connected simultaneously, with
 * one selected as the trading-active account.
 */
import { DERIV_WS_URL } from "./markets";

export type AuthStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "AUTHORIZING"
  | "CONNECTED"
  | "RECONNECTING"
  | "INVALID_TOKEN"
  | "ERROR";

export interface AuthAccount {
  loginid: string;
  currency: string;
  email?: string;
  is_virtual: boolean;
  landing_company_name?: string;
  fullname?: string;
}

export interface AuthBalance {
  balance: number;
  currency: string;
}

/** A sibling account discovered via `account_list` after authorize. */
export interface DiscoveredAccount {
  loginid: string;
  currency: string;
  is_virtual: boolean;
  landing_company_name?: string;
}

export interface TradeTimings {
  tickReceivedAt?: number;   // ms epoch when triggering tick arrived
  signalAt?: number;         // ms epoch when signal was selected
  proposalMs: number;
  buyMs: number;
  totalMs: number;           // proposal+buy round-trip
  signalToOrderMs?: number;  // signalAt → buy confirmed
  at: number;                // ms epoch when buy confirmed
}

export interface SavedAccount {
  label: string;
  token: string;
  loginid?: string;
  isVirtual?: boolean;
  currency?: string;
  savedAt: number;
}

type Listener<T> = (v: T) => void;

interface PendingRequest {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  sentAt: number;
}

const REDACT = (s: string) => (s ? `${s.slice(0, 3)}…${s.slice(-3)}` : "");

export class DerivAuthClient {
  private ws: WebSocket | null = null;
  private status: AuthStatus = "DISCONNECTED";
  private statusErr?: string;
  private token: string | null = null;
  private reqId = 1;
  private pending = new Map<number, PendingRequest>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private manualClose = false;
  private lastLatencyMs = 0;
  private account: AuthAccount | null = null;
  private balance: AuthBalance | null = null;
  private balanceSubId: string | null = null;
  private lastApiResponseAt: number | null = null;
  private discoveredAccounts: DiscoveredAccount[] = [];

  private statusListeners = new Set<Listener<{ status: AuthStatus; error?: string }>>();
  private accountListeners = new Set<Listener<AuthAccount | null>>();
  private balanceListeners = new Set<Listener<AuthBalance | null>>();
  private discoveryListeners = new Set<Listener<DiscoveredAccount[]>>();
  private contractListeners = new Map<number, (msg: any) => void>();
  private lastTradeTimings: TradeTimings | null = null;
  private tradeTimingsListeners = new Set<Listener<TradeTimings | null>>();

  // ──────── public api ────────
  getStatus() { return this.status; }
  getStatusError() { return this.statusErr; }
  getAccount() { return this.account; }
  getBalance() { return this.balance; }
  getLatency() { return this.lastLatencyMs; }
  getLastApiResponseAt() { return this.lastApiResponseAt; }
  getRedactedToken() { return this.token ? REDACT(this.token) : null; }
  getToken() { return this.token; }
  getLastTradeTimings() { return this.lastTradeTimings; }
  getDiscoveredAccounts() { return this.discoveredAccounts; }

  onDiscoveredAccounts(l: Listener<DiscoveredAccount[]>) {
    this.discoveryListeners.add(l); l(this.discoveredAccounts);
    return () => this.discoveryListeners.delete(l);
  }

  // ──────── public api ────────
  getStatus() { return this.status; }
  getStatusError() { return this.statusErr; }
  getAccount() { return this.account; }
  getBalance() { return this.balance; }
  getLatency() { return this.lastLatencyMs; }
  getLastApiResponseAt() { return this.lastApiResponseAt; }
  getRedactedToken() { return this.token ? REDACT(this.token) : null; }
  getToken() { return this.token; }
  getLastTradeTimings() { return this.lastTradeTimings; }

  onTradeTimings(l: Listener<TradeTimings | null>) {
    this.tradeTimingsListeners.add(l); l(this.lastTradeTimings);
    return () => this.tradeTimingsListeners.delete(l);
  }
  private emitTimings(t: TradeTimings) {
    this.lastTradeTimings = t;
    this.tradeTimingsListeners.forEach((l) => { try { l(t); } catch {} });
  }

  onStatus(l: Listener<{ status: AuthStatus; error?: string }>) {
    this.statusListeners.add(l); l({ status: this.status, error: this.statusErr });
    return () => this.statusListeners.delete(l);
  }
  onAccount(l: Listener<AuthAccount | null>) {
    this.accountListeners.add(l); l(this.account);
    return () => this.accountListeners.delete(l);
  }
  onBalance(l: Listener<AuthBalance | null>) {
    this.balanceListeners.add(l); l(this.balance);
    return () => this.balanceListeners.delete(l);
  }

  /**
   * Buy a DIGITMATCH contract directly via proposal → buy. Accepts optional
   * pipeline timestamps so we can measure tick→signal→order latency end-to-end.
   */
  async buyMatch(args: {
    symbol: string;
    digit: number;
    stake: number;
    durationTicks?: number;
    currency?: string;
    tickReceivedAt?: number;
    signalAt?: number;
  }): Promise<{ contract_id: number; buy_price: number; payout: number; longcode: string; transaction_id: number; timings: TradeTimings }> {
    if (this.status !== "CONNECTED") throw new Error("Account not connected");
    const currency = args.currency ?? this.account?.currency ?? "USD";
    const duration = args.durationTicks ?? 1;
    const stake = Math.max(0.35, Number(args.stake.toFixed(2)));
    const digit = Math.max(0, Math.min(9, Math.round(args.digit)));

    const t0 = performance.now();
    const propRes: any = await this.send({
      proposal: 1, amount: stake, basis: "stake",
      contract_type: "DIGITMATCH", currency,
      duration, duration_unit: "t",
      symbol: args.symbol, barrier: String(digit),
    });
    const t1 = performance.now();
    if (propRes?.error) throw new Error(propRes.error.message ?? "proposal failed");
    const proposal = propRes.proposal;
    if (!proposal?.id) throw new Error("No proposal id returned");

    const buyRes: any = await this.send({ buy: proposal.id, price: stake });
    const t2 = performance.now();
    if (buyRes?.error) throw new Error(buyRes.error.message ?? "buy failed");
    const b = buyRes.buy;
    const now = Date.now();
    const timings: TradeTimings = {
      tickReceivedAt: args.tickReceivedAt,
      signalAt: args.signalAt,
      proposalMs: Math.round(t1 - t0),
      buyMs: Math.round(t2 - t1),
      totalMs: Math.round(t2 - t0),
      signalToOrderMs: args.signalAt ? Math.round(now - args.signalAt) : undefined,
      at: now,
    };
    this.emitTimings(timings);
    // eslint-disable-next-line no-console
    console.info(
      `[trade] digit=${digit} prop=${timings.proposalMs}ms buy=${timings.buyMs}ms total=${timings.totalMs}ms` +
      (timings.signalToOrderMs != null ? ` s→o=${timings.signalToOrderMs}ms` : ""),
    );
    return {
      contract_id: b.contract_id,
      buy_price: Number(b.buy_price),
      payout: Number(b.payout),
      longcode: b.longcode,
      transaction_id: b.transaction_id,
      timings,
    };
  }

  awaitSettlement(contract_id: number, timeoutMs = 60_000): Promise<{ profit: number; status: string }> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("auth ws not open"));
        return;
      }
      const id = this.reqId++;
      let subId: string | null = null;
      let done = false;
      const finish = (err: Error | null, val?: { profit: number; status: string }) => {
        if (done) return;
        done = true;
        this.contractListeners.delete(id);
        if (subId) { try { this.send({ forget: subId }); } catch {} }
        if (err) reject(err); else resolve(val!);
      };
      const timer = setTimeout(() => finish(new Error("settlement timeout")), timeoutMs);
      this.contractListeners.set(id, (msg) => {
        if (msg?.subscription?.id) subId = msg.subscription.id;
        const poc = msg?.proposal_open_contract;
        if (!poc || poc.contract_id !== contract_id) return;
        if (poc.is_sold || poc.status === "won" || poc.status === "lost") {
          clearTimeout(timer);
          finish(null, { profit: Number(poc.profit ?? 0), status: String(poc.status ?? "settled") });
        }
      });
      try {
        this.ws.send(JSON.stringify({
          proposal_open_contract: 1, contract_id, subscribe: 1, req_id: id,
        }));
      } catch (e: any) {
        clearTimeout(timer);
        finish(e);
      }
    });
  }

  async connect(token: string) {
    if (typeof window === "undefined") return;
    if (!token || token.trim().length < 8) {
      this.setStatus("INVALID_TOKEN", "Token too short");
      return;
    }
    this.token = token.trim();
    this.manualClose = false;
    this.reconnectAttempts = 0;
    await this.openSocket();
  }

  disconnect() {
    this.manualClose = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopPing();
    this.failAllPending(new Error("disconnected"));
    if (this.ws) { try { this.ws.close(); } catch {} }
    this.ws = null;
    this.token = null;
    this.account = null;
    this.balance = null;
    this.balanceSubId = null;
    this.accountListeners.forEach((l) => l(null));
    this.balanceListeners.forEach((l) => l(null));
    this.setStatus("DISCONNECTED");
  }

  // ──────── internals ────────
  private async openSocket() {
    this.setStatus(this.reconnectAttempts > 0 ? "RECONNECTING" : "CONNECTING");
    try {
      this.ws = new WebSocket(DERIV_WS_URL);
    } catch (e: any) {
      this.setStatus("ERROR", e?.message ?? "WS construct failed");
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = async () => {
      this.setStatus("AUTHORIZING");
      try {
        const res: any = await this.send({ authorize: this.token });
        if (res?.error) throw new Error(res.error.message ?? "authorize failed");
        const a = res.authorize;
        this.account = {
          loginid: a.loginid,
          currency: a.currency,
          email: a.email,
          is_virtual: a.is_virtual === 1 || a.is_virtual === true,
          landing_company_name: a.landing_company_name,
          fullname: a.fullname,
        };
        this.accountListeners.forEach((l) => l(this.account));
        this.reconnectAttempts = 0;
        this.setStatus("CONNECTED");
        this.startPing();
        await this.subscribeBalance();
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (/Invalid|token|authoriz/i.test(msg)) {
          this.setStatus("INVALID_TOKEN", msg);
          this.disconnect();
        } else {
          this.setStatus("ERROR", msg);
          try { this.ws?.close(); } catch {}
        }
      }
    };
    this.ws.onmessage = (ev) => this.handleMessage(ev.data);
    this.ws.onclose = () => {
      this.stopPing();
      this.failAllPending(new Error("ws closed"));
      if (this.manualClose || this.status === "INVALID_TOKEN") return;
      this.setStatus("RECONNECTING");
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      if (this.status !== "INVALID_TOKEN") this.setStatus("ERROR", "WebSocket error");
    };
  }

  private async subscribeBalance() {
    try {
      const res: any = await this.send({ balance: 1, subscribe: 1 });
      if (res?.balance) {
        this.balance = { balance: Number(res.balance.balance), currency: res.balance.currency };
        this.balanceListeners.forEach((l) => l(this.balance));
      }
      if (res?.subscription?.id) this.balanceSubId = res.subscription.id;
    } catch { /* tolerated */ }
  }

  send<T = any>(payload: Record<string, any>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("auth ws not open"));
        return;
      }
      const id = this.reqId++;
      this.pending.set(id, { resolve, reject, sentAt: performance.now() });
      try { this.ws.send(JSON.stringify({ ...payload, req_id: id })); }
      catch (e) { this.pending.delete(id); reject(e); }
    });
  }

  private handleMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    this.lastApiResponseAt = Date.now();

    if (msg.req_id && this.pending.has(msg.req_id)) {
      const p = this.pending.get(msg.req_id)!;
      this.lastLatencyMs = Math.round(performance.now() - p.sentAt);
      this.pending.delete(msg.req_id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "deriv error"));
      else p.resolve(msg);
    }

    if (msg.msg_type === "balance" && msg.balance) {
      this.balance = { balance: Number(msg.balance.balance), currency: msg.balance.currency };
      this.balanceListeners.forEach((l) => l(this.balance));
    }

    if (msg.msg_type === "proposal_open_contract") {
      for (const [, l] of this.contractListeners) {
        try { l(msg); } catch {}
      }
    }
  }

  private failAllPending(err: Error) {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private scheduleReconnect() {
    if (this.manualClose || !this.token) return;
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(20_000, 800 * Math.pow(1.6, this.reconnectAttempts));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
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

  private setStatus(s: AuthStatus, err?: string) {
    this.status = s;
    this.statusErr = err;
    this.statusListeners.forEach((l) => { try { l({ status: s, error: err }); } catch {} });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session-only token storage. No localStorage, no obfuscation.
// Tokens live for the lifetime of the tab. Closing the tab clears them.
// ─────────────────────────────────────────────────────────────────────────────

const SAVED_KEY = "dvx.auth.saved.v2";        // sessionStorage only
const ACTIVE_KEY = "dvx.auth.active.v2";      // sessionStorage only
const LEGACY_KEYS = [
  "dvx.auth.token.v1", "dvx.auth.remember.v1", "dvx.auth.saved.v1",
];

/** Wipe legacy XOR-obfuscated localStorage entries from previous versions. */
export function purgeLegacyTokenStorage() {
  if (typeof window === "undefined") return;
  try {
    for (const k of LEGACY_KEYS) {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    }
  } catch {}
}

export function loadSavedAccounts(): SavedAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((a) => a && a.token && a.label) : [];
  } catch { return []; }
}
export function persistSavedAccounts(list: SavedAccount[]) {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch {}
}
export function upsertSavedAccount(acc: SavedAccount): SavedAccount[] {
  const list = loadSavedAccounts().filter(
    (a) => a.token !== acc.token && a.label.toLowerCase() !== acc.label.toLowerCase(),
  );
  list.unshift(acc);
  const trimmed = list.slice(0, 4);
  persistSavedAccounts(trimmed);
  return trimmed;
}
export function removeSavedAccount(token: string): SavedAccount[] {
  const list = loadSavedAccounts().filter((a) => a.token !== token);
  persistSavedAccounts(list);
  return list;
}
export function loadActiveToken(): string | null {
  if (typeof window === "undefined") return null;
  try { return sessionStorage.getItem(ACTIVE_KEY); } catch { return null; }
}
export function persistActiveToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) sessionStorage.setItem(ACTIVE_KEY, token);
    else sessionStorage.removeItem(ACTIVE_KEY);
  } catch {}
}

// ─── Backward-compatible single-client accessor ──────────────────────────────
// Returns the *active* client from the auth pool so existing call sites
// (executeTrade, etc.) keep working.
import { getAuthPool } from "./authPool";
export function getAuthClient(): DerivAuthClient {
  return getAuthPool().getActiveClient();
}
