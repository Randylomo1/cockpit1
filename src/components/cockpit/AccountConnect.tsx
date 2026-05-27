import { useEffect, useState } from "react";
import { Eye, EyeOff, Wifi, WifiOff, Loader2, ShieldCheck, AlertTriangle, X } from "lucide-react";
import { useAccount } from "@/lib/deriv/accountStore";

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
  const [reveal, setReveal] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  // Auto-close on successful connection
  useEffect(() => {
    if (status === "CONNECTED" && open) {
      setPending(false);
      setToken("");
      const t = setTimeout(() => setOpen(false), 350);
      return () => clearTimeout(t);
    }
    if (status === "INVALID_TOKEN" || status === "ERROR") setPending(false);
  }, [status, open]);

  const meta = STATUS_META[status] ?? STATUS_META.DISCONNECTED;
  const isLive = status === "CONNECTED";

  const handleConnect = async () => {
    if (!token.trim()) return;
    setPending(true);
    try { await connect(token.trim(), remember); }
    catch { setPending(false); }
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
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md glass rounded-xl p-6 relative shadow-[0_20px_60px_-20px_oklch(0.78_0.13_86/0.35)]"
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
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Deriv Account</div>
                <div className="gold-text text-lg font-semibold leading-tight">Secure Connection</div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
              Paste your Deriv API token. Token is stored locally on this device only — never sent to any
              third-party server. Create at{" "}
              <a
                href="https://app.deriv.com/account/api-token"
                target="_blank" rel="noreferrer"
                className="text-[var(--gold)] hover:underline"
              >app.deriv.com/account/api-token</a>.
            </p>

            <div className="mt-5 space-y-3">
              <label className="block text-[10px] uppercase tracking-widest text-muted-foreground">API Token</label>
              <div className="relative">
                <input
                  type={reveal ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="e.g. a1B2c3D4…"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={pending || isLive}
                  className="w-full bg-[var(--surface-2)] border border-[var(--border)] focus:border-[var(--gold)]/60 focus:ring-2 focus:ring-[var(--gold)]/20 outline-none rounded-md px-3 py-2.5 pr-10 font-mono text-sm tracking-wider text-foreground disabled:opacity-60"
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

              <label className="flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => useAccount.setState({ remember: e.target.checked })}
                  className="accent-[var(--gold)] size-3.5"
                />
                Remember on this device
              </label>

              {error && (status === "INVALID_TOKEN" || status === "ERROR") && (
                <div className="flex items-start gap-2 text-xs text-[var(--destructive)] bg-[var(--destructive)]/10 border border-[var(--destructive)]/30 rounded-md p-2.5">
                  <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                  <span className="font-mono">{error}</span>
                </div>
              )}

              {isLive && account && (
                <div className="rounded-md border border-[var(--border)] bg-[var(--surface)]/60 p-3 text-xs font-mono space-y-1.5">
                  <Row label="Account"  value={account.loginid} />
                  <Row label="Type"     value={account.is_virtual ? "DEMO" : "REAL"} />
                  <Row label="Currency" value={account.currency} />
                  {balance && (
                    <Row label="Balance" value={`${balance.balance.toFixed(2)} ${balance.currency}`} highlight />
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center gap-2">
              {!isLive ? (
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={!token.trim() || pending || status === "CONNECTING" || status === "AUTHORIZING"}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-b from-[var(--gold-soft)] to-[var(--gold)] text-black font-semibold text-sm py-2.5 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {pending || status === "CONNECTING" || status === "AUTHORIZING" ? (
                    <><Loader2 className="size-4 animate-spin" /> {meta.label}</>
                  ) : (
                    <><Wifi className="size-4" /> Connect</>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={disconnect}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface)] text-foreground text-sm py-2.5 transition"
                >
                  <WifiOff className="size-4" /> Disconnect
                </button>
              )}
            </div>

            <p className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground/60 text-center">
              Isolated authorized socket · No third-party relay · Local-only token
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
