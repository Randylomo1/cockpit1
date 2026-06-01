import { useEffect, useState, useCallback } from "react";
import { Eye, EyeOff, Wifi, WifiOff, Loader2, ShieldCheck, AlertTriangle, X, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { useAccount } from "@/lib/deriv/accountStore";
import {
  loadSavedAccounts,
  upsertSavedAccount,
  removeSavedAccount,
  type SavedAccount,
} from "@/lib/deriv/authWs";
import { toast } from "sonner";

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  DISCONNECTED:  { label: "OFFLINE",       color: "text-muted-foreground",          dot: "bg-muted-foreground/60" },
  CONNECTING:    { label: "CONNECTING",    color: "text-[var(--warning)]",          dot: "bg-[var(--warning)]" },
  AUTHORIZING:   { label: "AUTHORIZING",   color: "text-[var(--warning)]",          dot: "bg-[var(--warning)]" },
  CONNECTED:     { label: "ACCOUNT LIVE",  color: "text-[var(--success)]",          dot: "bg-[var(--success)]" },
  RECONNECTING:  { label: "RECONNECTING",  color: "text-[var(--warning)]",          dot: "bg-[var(--warning)]" },
  INVALID_TOKEN: { label: "INVALID TOKEN", color: "text-[var(--destructive)]",      dot: "bg-[var(--destructive)]" },
  ERROR:         { label: "WS ERROR",      color: "text-[var(--destructive)]",      dot: "bg-[var(--destructive)]" },
};

export function AccountConnect() {
  const bootstrap = useAccount((s) => s.bootstrap);
  const status = useAccount((s) => s.status);
  const error = useAccount((s) => s.error);
  const account = useAccount((s) => s.account);
  const balance = useAccount((s) => s.balance);
  const remember = useAccount((s) => s.remember);
  const connect = useAccount((s) => s.connect);
  const disconnect = useAccount((s) => s.disconnect);

  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [reveal, setReveal] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<SavedAccount[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    bootstrap();
    setSaved(loadSavedAccounts());
  }, [bootstrap]);

  // Reset only the input pending state on auth result. DO NOT auto-close —
  // the dropdown must remain stable until the user explicitly dismisses it.
  useEffect(() => {
    if (status === "CONNECTED") {
      setPending(false);
      // Auto-save successful connection if not already saved
      if (account && token.trim()) {
        const acc: SavedAccount = {
          label: label.trim() || (account.is_virtual ? "Demo" : "Real"),
          token: token.trim(),
          loginid: account.loginid,
          isVirtual: account.is_virtual,
          currency: account.currency,
          savedAt: Date.now(),
        };
        setSaved(upsertSavedAccount(acc));
        setToken("");
        setLabel("");
        setAdding(false);
      }
    }
    if (status === "INVALID_TOKEN" || status === "ERROR") setPending(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, account?.loginid]);

  // Escape closes the modal
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !pending) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  const meta = STATUS_META[status] ?? STATUS_META.DISCONNECTED;
  const isLive = status === "CONNECTED";

  const handleConnect = useCallback(async (overrideToken?: string, overrideLabel?: string) => {
    const tk = (overrideToken ?? token).trim();
    if (!tk) return;
    if (overrideLabel !== undefined) setLabel(overrideLabel);
    if (overrideToken !== undefined) setToken(overrideToken);
    setPending(true);
    try { await connect(tk, true); }
    catch { setPending(false); }
  }, [connect, token]);

  const handleSwitchTo = async (acc: SavedAccount) => {
    if (pending) return;
    if (account?.loginid === acc.loginid && isLive) {
      toast.info(`Already on ${acc.label} · ${acc.loginid}`);
      return;
    }
    // Disconnect current, then connect to new account
    if (isLive) disconnect();
    // Tiny delay so the WS cleanly closes before we open a new one
    setTimeout(() => { void handleConnect(acc.token, acc.label); }, 60);
  };

  const handleRemove = (tk: string) => {
    setSaved(removeSavedAccount(tk));
    toast.success("Account removed");
  };

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
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
          /* Backdrop does NOT close the modal — only the X button or Escape do. */
        >
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
                <div className="gold-text text-lg font-semibold leading-tight">Account Switcher</div>
              </div>
            </div>

            {/* Saved accounts list */}
            <div className="mt-5">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                Saved Accounts ({saved.length})
              </div>
              {saved.length === 0 ? (
                <div className="text-xs text-muted-foreground italic px-3 py-4 rounded-md border border-dashed border-[var(--border)] text-center">
                  No accounts saved yet. Add your Demo and Real tokens below to switch instantly.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {saved.map((s) => {
                    const active = isLive && account?.loginid === s.loginid;
                    return (
                      <div key={s.token}
                        className={`flex items-center gap-2 rounded-md border p-2 ${
                          active ? "border-[var(--gold)]/60 bg-[var(--gold)]/5"
                                 : "border-[var(--border)] bg-[var(--surface)]/40"
                        }`}>
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wider"
                          style={{
                            background: s.isVirtual ? "oklch(0.78 0.16 70 / 0.18)" : "oklch(0.72 0.17 145 / 0.18)",
                            color: s.isVirtual ? "oklch(0.85 0.18 85)" : "oklch(0.85 0.16 150)",
                          }}>
                          {s.isVirtual ? "DEMO" : "REAL"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-foreground truncate">{s.label}</div>
                          <div className="text-[10px] font-mono text-muted-foreground truncate">
                            {s.loginid ?? "—"} {s.currency ? `· ${s.currency}` : ""}
                          </div>
                        </div>
                        {active ? (
                          <span className="text-[10px] font-mono uppercase tracking-widest text-[oklch(0.72_0.17_145)] flex items-center gap-1">
                            <CheckCircle2 className="size-3" /> Active
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => handleSwitchTo(s)}
                            className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--gold)]/60 hover:text-[var(--gold)] disabled:opacity-40"
                          >
                            Use
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemove(s.token)}
                          className="text-muted-foreground hover:text-[var(--destructive)] p-1"
                          title="Remove saved account"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Status + balance */}
            {isLive && account && (
              <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface)]/60 p-3 text-xs font-mono space-y-1.5">
                <Row label="Account"  value={account.loginid} />
                <Row label="Type"     value={account.is_virtual ? "DEMO (virtual funds)" : "REAL"} />
                <Row label="Currency" value={account.currency} />
                {balance && (
                  <Row label="Balance" value={`${balance.balance.toFixed(2)} ${balance.currency}`} highlight />
                )}
              </div>
            )}

            {error && (status === "INVALID_TOKEN" || status === "ERROR") && (
              <div className="mt-3 flex items-start gap-2 text-xs text-[var(--destructive)] bg-[var(--destructive)]/10 border border-[var(--destructive)]/30 rounded-md p-2.5">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                <span className="font-mono">{error}</span>
              </div>
            )}

            {/* Add new account */}
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
                  </a>. Tokens stay local on this device.
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
                    onClick={() => handleConnect()}
                    disabled={!token.trim() || pending}
                    className="flex-[2] inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-b from-[var(--gold-soft)] to-[var(--gold)] text-black font-semibold text-xs py-2 hover:brightness-110 disabled:opacity-50"
                  >
                    {pending ? (<><Loader2 className="size-3.5 animate-spin" /> {meta.label}</>)
                              : (<><Wifi className="size-3.5" /> Connect & Save</>)}
                  </button>
                </div>
              </div>
            )}

            {isLive && (
              <button
                type="button"
                onClick={disconnect}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface)] text-foreground text-xs py-2 transition"
              >
                <WifiOff className="size-3.5" /> Disconnect current session
              </button>
            )}

            <p className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground/60 text-center">
              Isolated authorized socket · Local-only tokens · Press Esc to close
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground uppercase tracking-wider text-[10px]">{label}</span>
      <span className={highlight ? "gold-text font-semibold" : "text-foreground"}>{value}</span>
    </div>
  );
}
