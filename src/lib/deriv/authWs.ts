/**
 * Authorized Deriv WebSocket — isolated from the public market WS.
 * Handles: authorize, balance stream, ping, reconnect, subscription restore.
 * Future-ready for proposal / buy / portfolio / transaction streams.
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

  // listeners
  private statusListeners = new Set<Listener<{ status: AuthStatus; error?: string }>>();
  private accountListeners = new Set<Listener<AuthAccount | null>>();
  private balanceListeners = new Set<Listener<AuthBalance | null>>();

  // ──────── public api ────────

  getStatus() { return this.status; }
  getStatusError() { return this.statusErr; }
  getAccount() { return this.account; }
  getBalance() { return this.balance; }
  getLatency() { return this.lastLatencyMs; }

  /**
   * Buy a DIGITMATCH contract directly via proposal → buy.
   * Returns Deriv's buy response (contract_id, buy_price, payout, …).
   */
  async buyMatch(args: {
    symbol: string;
    digit: number;
    stake: number;
    durationTicks?: number;
    currency?: string;
  }): Promise<{ contract_id: number; buy_price: number; payout: number; longcode: string; transaction_id: number }> {
    if (this.status !== "CONNECTED") throw new Error("Account not connected");
    const currency = args.currency ?? this.account?.currency ?? "USD";
    const duration = args.durationTicks ?? 1;
    const stake = Math.max(0.35, Number(args.stake.toFixed(2)));
    const digit = Math.max(0, Math.min(9, Math.round(args.digit)));

    const propRes: any = await this.send({
      proposal: 1,
      amount: stake,
      basis: "stake",
      contract_type: "DIGITMATCH",
      currency,
      duration,
      duration_unit: "t",
      symbol: args.symbol,
      barrier: String(digit),
    });
    if (propRes?.error) throw new Error(propRes.error.message ?? "proposal failed");
    const proposal = propRes.proposal;
    if (!proposal?.id) throw new Error("No proposal id returned");

    const buyRes: any = await this.send({ buy: proposal.id, price: stake });
    if (buyRes?.error) throw new Error(buyRes.error.message ?? "buy failed");
    const b = buyRes.buy;
    return {
      contract_id: b.contract_id,
      buy_price: Number(b.buy_price),
      payout: Number(b.payout),
      longcode: b.longcode,
      transaction_id: b.transaction_id,
    };
  }

  getRedactedToken() { return this.token ? REDACT(this.token) : null; }

  onStatus(l: Listener<{ status: AuthStatus; error?: string }>) {
    this.statusListeners.add(l);
    l({ status: this.status, error: this.statusErr });
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
    } catch {
      // tolerated
    }
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

let _client: DerivAuthClient | null = null;
export function getAuthClient(): DerivAuthClient {
  if (typeof window === "undefined") return new DerivAuthClient();
  if (!_client) _client = new DerivAuthClient();
  return _client;
}

// ─── token persistence (light obfuscation; not true encryption) ───
const TOKEN_KEY = "dvx.auth.token.v1";
const REMEMBER_KEY = "dvx.auth.remember.v1";

function xorObfuscate(s: string): string {
  const k = "matchcockpit-noir-gold";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += String.fromCharCode(s.charCodeAt(i) ^ k.charCodeAt(i % k.length));
  }
  return typeof btoa !== "undefined" ? btoa(out) : out;
}
function xorDeobfuscate(s: string): string {
  const raw = typeof atob !== "undefined" ? atob(s) : s;
  const k = "matchcockpit-noir-gold";
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ k.charCodeAt(i % k.length));
  }
  return out;
}

export function saveToken(token: string, remember: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (remember) {
      localStorage.setItem(TOKEN_KEY, xorObfuscate(token));
      localStorage.setItem(REMEMBER_KEY, "1");
    } else {
      sessionStorage.setItem(TOKEN_KEY, xorObfuscate(token));
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REMEMBER_KEY);
    }
  } catch {}
}
export function loadToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
    return raw ? xorDeobfuscate(raw) : null;
  } catch { return null; }
}
export function clearToken() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REMEMBER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}
