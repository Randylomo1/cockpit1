/**
 * Account connect / switcher.
 *
 * - Tokens are stored only in sessionStorage (cleared on tab close).
 * - Multiple accounts can be connected concurrently; balances stream for all.
 * - "Use for trading" sets the active account that the engine executes with.
 * - DEMO accounts are visually prominent and chosen by default when present.
 */
import { useEffect, useState, useCallback } from "react";
import { Eye, EyeOff, Wifi, Loader2, ShieldCheck, AlertTriangle, X, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { useAccount } from "@/lib/deriv/accountStore";
import { toast } from "sonner";

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  DISCONNECTED:  { label: "OFFLINE",       color: "text-muted-foreground",     dot: "bg-muted-foreground/60" },
  CONNECTING:    { label: "CONNECTING",    color: "text-[var(--warning)]",     dot: "bg-[var(--warning)]" },
  AUTHORIZING:   { label: "AUTHORIZING",   color: "text-[var(--warning)]",     dot: "bg-[var(--warning)]" },
  CONNECTED:     { label: "ACCOUNT LIVE",  color: "text-[var(--success)]",     dot: "bg-[var(--success)]" },
  RECONNECTING:  { label: "RECONNECTING",  color: "text-[var(--warning)]",     dot: "bg-[var(--warning)]" },
  INVALID_TOKEN: { label: "INVALID TOKEN", color: "text-[var(--destructive)]", dot: "bg-[var(--destructive)]" },
  ERROR:         { label: "WS ERROR",      color: "text-[var(--destructive)]", dot: "bg-[var(--destructive)]" },
};

export function AccountConnect() {
  const bootstrap = useAccount((s) => s.bootstrap);
  const status = useAccount((s) => s.status);
  const error = useAccount((s) => s.error);
  const account = useAccount((s) => s.account);
  const balance = useAccount((s) => s.balance);
  const entries = useAccount((s) => s.entries);
  const activeToken = useAccount((s) => s.activeToken);
  const connect = useAccount((s) => s.connect);
  const setActive = useAccount((s) => s.setActive);
  const remove = useAccount((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [reveal, setReveal] = useState(false);
  const [pending, setPending] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  // Close pending whenever the new account terminal-states
  useEffect(() => {
    if (status === "CONNECTED" || status === "INVALID_TOKEN" || status === "ERROR") {
      setPending(false);
      if (status === "CONNECTED") {
        setToken("");
        setLabel("");
        setAdding(false);
      }
    }
  }, [status]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !pending) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  const meta = STATUS_META[status] ?? STATUS_META.DISCONNECTED;
  const isLive = status === "CONNECTED";

  const handleConnect = useCallback(async (tk: string, lb: string) => {
    if (!tk.trim()) return;
    setPending(true);
    try { await connect(tk.trim(), lb.trim() || "Account"); }
    catch { setPending(false); }
  }, [connect]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)]/70 hover:bg-[var(--surface-2)] px-3 py-1.5 text-xs font-mono tracking-wider transition-colors ${meta.color}`}
        title={error ?? meta.label}
      >
        <span className={`size-1.5 rounded-full ${meta.dot} ${isLive ? "shadow-[0_0_8px_currentColor]" : ""}`} />
        <span className="font-semibold">{meta.label}</span>
        {isLive && account && (
          <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider"
            style={{
              background: account.is_virtual ? "oklch(0.78 0.16 70 / 0.18)" : "oklch(0.72 0.17 145 / 0.18)",
              color: account.is_virtual ? "oklch(0.85 0.18 85)" : "oklch(0.85 0.16 150)",
            }}>
            {account.is_virtual ? "DEMO" : "REAL"}
          </span>
        )}
        {isLive && balance && (
          <span className="ml-1 text-foreground/90">
            {balance.balance.toFixed(2)} <span className="text-muted-foreground">{balance.currency}</span>
          </span>
        )}
        {isLive && account && (
          <span className="hidden lg:inline text-muted-foreground">· {account.loginid}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
          <div
            className="w-full max-w-md glass rounded-xl p-6 relative shadow-[0_20px_60px_-20px_oklch(0.78_0.13_86/0.35)] max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => !pending && setOpen(false)}
              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>

            <div className="flex items-center gap-3 mb-1">
              <div className="size-9 rounded-md bg-gradient-to-br from-[var(--gold-soft)] to-[var(--gold)] grid place-items-center">
                <ShieldCheck className="size-5 text-black" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Deriv Accounts</div>
                <div className="gold-text text-lg font-semibold leading-tight">Concurrent Sessions</div>
              </div>
            </div>

            <div className="mt-3 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-[10px] font-mono text-muted-foreground leading-snug">
              Tokens are kept in <span className="text-foreground">sessionStorage only</span> — wiped when this tab closes.
              No localStorage, no obfuscation. Demo is the default execution target.
            </div>

            {/* Connected sessions */}
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                Connected Sessions ({entries.length})
              </div>
              {entries.length === 0 ? (
                <div className="text-xs text-muted-foreground italic px-3 py-4 rounded-md border border-dashed border-[var(--border)] text-center">
                  No sessions yet. Connect a DEMO token first to safely test the engine, then add REAL when ready.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {entries.map((s) => {
                    const active = s.token === activeToken;
                    const isDemo = s.account?.is_virtual === true;
                    const isReal = s.account?.is_virtual === false;
                    return (
                      <div key={s.token}
                        className={`flex items-center gap-2 rounded-md border p-2 ${
                          active ? "border-[var(--gold)]/60 bg-[var(--gold)]/5"
                                 : "border-[var(--border)] bg-[var(--surface)]/40"
                        }`}>
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wider"
                          style={{
                            background: isDemo ? "oklch(0.78 0.16 70 / 0.18)"
                                       : isReal ? "oklch(0.72 0.17 145 / 0.18)"
                                       : "oklch(0.5 0 0 / 0.18)",
                            color: isDemo ? "oklch(0.85 0.18 85)"
                                  : isReal ? "oklch(0.85 0.16 150)"
                                  : "var(--muted-foreground)",
                          }}>
                          {isDemo ? "DEMO" : isReal ? "REAL" : s.status}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-foreground truncate">{s.label}</div>
                          <div className="text-[10px] font-mono text-muted-foreground truncate">
                            {s.account?.loginid ?? "—"}
                            {s.balance ? ` · ${s.balance.balance.toFixed(2)} ${s.balance.currency}` : ""}
                          </div>
                        </div>
                        {active ? (
                          <span className="text-[10px] font-mono uppercase tracking-widest text-[oklch(0.72_0.17_145)] flex items-center gap-1">
                            <CheckCircle2 className="size-3" /> Trading
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setActive(s.token); toast.success(`Now trading on ${s.label}`); }}
                            className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--gold)]/60 hover:text-[var(--gold)]"
                          >
                            Use
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { remove(s.token); toast.success("Session removed"); }}
                          className="text-muted-foreground hover:text-[var(--destructive)] p-1"
                          title="Disconnect & remove"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {error && (status === "INVALID_TOKEN" || status === "ERROR") && (
              <div className="mt-3 flex items-start gap-2 text-xs text-[var(--destructive)] bg-[var(--destructive)]/10 border border-[var(--destructive)]/30 rounded-md p-2.5">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                <span className="font-mono">{error}</span>
              </div>
            )}

            {!adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border)] hover:border-[var(--gold)]/60 hover:text-[var(--gold)] text-muted-foreground text-xs py-2.5 transition"
              >
                <Plus className="size-3.5" /> Add account (Demo or Real token)
              </button>
            ) : (
              <div className="mt-4 space-y-2 rounded-md border border-[var(--border)] p-3 bg-[var(--surface-2)]/30">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  New account · paste API token
                </div>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label (e.g. Demo, Real-USD)"
                  className="w-full bg-[var(--surface-2)] border border-[var(--border)] focus:border-[var(--gold)]/60 outline-none rounded-md px-3 py-2 text-xs text-foreground"
                />
                <div className="relative">
                  <input
                    type={reveal ? "text" : "password"}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="API token (read + trade scopes)"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={pending}
                    className="w-full bg-[var(--surface-2)] border border-[var(--border)] focus:border-[var(--gold)]/60 outline-none rounded-md px-3 py-2 pr-10 font-mono text-xs tracking-wider text-foreground disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Create at{" "}
                  <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noreferrer"
                     className="text-[var(--gold)] hover:underline">
                    app.deriv.com/account/api-token
                  </a>. Session-only · cleared when this tab closes.
                </p>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => { setAdding(false); setToken(""); setLabel(""); }}
                    className="flex-1 rounded-md border border-[var(--border)] text-xs py-2 text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConnect(token, label)}
                    disabled={!token.trim() || pending}
                    className="flex-[2] inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-b from-[var(--gold-soft)] to-[var(--gold)] text-black font-semibold text-xs py-2 hover:brightness-110 disabled:opacity-50"
                  >
                    {pending ? (<><Loader2 className="size-3.5 animate-spin" /> {meta.label}</>)
                              : (<><Wifi className="size-3.5" /> Connect</>)}
                  </button>
                </div>
              </div>
            )}

            <p className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground/60 text-center">
              Concurrent authorized sockets · Session-only tokens · Press Esc to close
            </p>
          </div>
        </div>
      )}
    </>
  );
}
