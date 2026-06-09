/**
 * Auth pool — manages multiple concurrent authorized Deriv WS sessions.
 *
 * Supports Demo + Real (and more) connected in parallel so balances stream
 * for every account simultaneously. Exactly one account at a time is the
 * **active** account that executes trades. Switching is instant (no
 * disconnect/reconnect of the existing sessions).
 */
import {
  DerivAuthClient,
  type AuthAccount,
  type AuthBalance,
  type AuthStatus,
  type DiscoveredAccount,
  loadSavedAccounts,
  loadActiveToken,
  persistActiveToken,
  upsertSavedAccount,
  removeSavedAccount,
} from "./authWs";

export interface PoolEntry {
  token: string;
  label: string;
  client: DerivAuthClient;
  status: AuthStatus;
  error?: string;
  account: AuthAccount | null;
  balance: AuthBalance | null;
  discovered: DiscoveredAccount[];
}

type Listener = (entries: PoolEntry[], activeToken: string | null) => void;

class DerivAuthPool {
  private entries = new Map<string, PoolEntry>();
  private activeToken: string | null = null;
  private listeners = new Set<Listener>();
  private placeholder: DerivAuthClient | null = null;

  /** Returns the active client, or a disconnected placeholder if none. */
  getActiveClient(): DerivAuthClient {
    if (this.activeToken && this.entries.has(this.activeToken)) {
      return this.entries.get(this.activeToken)!.client;
    }
    if (!this.placeholder) this.placeholder = new DerivAuthClient();
    return this.placeholder;
  }

  getActiveEntry(): PoolEntry | null {
    return this.activeToken ? this.entries.get(this.activeToken) ?? null : null;
  }

  list(): PoolEntry[] {
    return Array.from(this.entries.values());
  }

  getActiveToken(): string | null { return this.activeToken; }

  on(l: Listener): () => void {
    this.listeners.add(l);
    l(this.list(), this.activeToken);
    return () => { this.listeners.delete(l); };
  }

  private emit() {
    const snap = this.list();
    this.listeners.forEach((l) => { try { l(snap, this.activeToken); } catch {} });
  }

  /**
   * Add (or refresh) an account by token. Connects authorized WS. Returns the
   * entry once the WS reaches CONNECTED or an error terminal state.
   */
  async add(token: string, label: string): Promise<PoolEntry> {
    const tk = token.trim();
    let entry = this.entries.get(tk);
    if (!entry) {
      const client = new DerivAuthClient();
      entry = { token: tk, label, client, status: "DISCONNECTED", account: null, balance: null, discovered: [] };
      this.entries.set(tk, entry);
      client.onStatus(({ status, error }) => {
        const e = this.entries.get(tk);
        if (!e) return;
        e.status = status;
        e.error = error;
        this.emit();
      });
      client.onAccount((a) => {
        const e = this.entries.get(tk);
        if (!e) return;
        e.account = a;
        if (a) {
          upsertSavedAccount({
            label: e.label || (a.is_virtual ? "Demo" : "Real"),
            token: tk,
            loginid: a.loginid,
            isVirtual: a.is_virtual,
            currency: a.currency,
            savedAt: Date.now(),
          });
        }
        this.emit();
      });
      client.onBalance((b) => {
        const e = this.entries.get(tk);
        if (!e) return;
        e.balance = b;
        this.emit();
      });
      client.onDiscoveredAccounts((list) => {
        const e = this.entries.get(tk);
        if (!e) return;
        e.discovered = list;
        this.emit();
      });
    } else {
      entry.label = label || entry.label;
    }
    const live = this.entries.get(tk)!;
    await live.client.connect(tk);
    // Demo-first: prefer a connected Demo as the active trading account whenever possible.
    const demo = this.list().find((e) => e.account?.is_virtual === true);
    if (!this.activeToken) {
      this.setActive(demo?.token ?? tk);
    } else {
      const activeEntry = this.entries.get(this.activeToken);
      if (demo && activeEntry?.account?.is_virtual === false) {
        // Auto-switch from a real account to a freshly-connected demo (safer default).
        this.setActive(demo.token);
      }
    }
    this.emit();
    return live;
  }


  remove(token: string) {
    const entry = this.entries.get(token);
    if (!entry) return;
    try { entry.client.disconnect(); } catch {}
    this.entries.delete(token);
    removeSavedAccount(token);
    if (this.activeToken === token) {
      const demo = this.list().find((e) => e.account?.is_virtual);
      const any = demo ?? this.list()[0] ?? null;
      this.setActive(any?.token ?? null);
    }
    this.emit();
  }

  setActive(token: string | null) {
    if (token && !this.entries.has(token)) return;
    this.activeToken = token;
    persistActiveToken(token);
    this.emit();
  }

  /**
   * Restore sessionStorage saved accounts at app start. Reconnects each one
   * and selects the previously-active token if available, else prefers DEMO.
   */
  async bootstrap() {
    const saved = loadSavedAccounts();
    if (saved.length === 0) return;
    const prevActive = loadActiveToken();
    for (const a of saved) {
      // best-effort; do not throw
      this.add(a.token, a.label).catch(() => {});
    }
    if (prevActive && saved.some((a) => a.token === prevActive)) {
      this.setActive(prevActive);
    }
  }
}

let _pool: DerivAuthPool | null = null;
export function getAuthPool(): DerivAuthPool {
  if (typeof window === "undefined") return new DerivAuthPool();
  if (!_pool) _pool = new DerivAuthPool();
  return _pool;
}
