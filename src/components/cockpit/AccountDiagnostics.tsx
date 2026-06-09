/**
 * Account Diagnostics — shows every authorized session in the auth pool with
 * status, account type (DEMO/REAL detected from the authorize response),
 * loginid, balance, and last API response timestamp.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import { getAuthPool, type PoolEntry } from "@/lib/deriv/authPool";

export function AccountDiagnostics() {
  const [entries, setEntries] = useState<PoolEntry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const off = getAuthPool().on((e, a) => { setEntries(e); setActive(a); });
    const i = setInterval(() => tick((n) => n + 1), 1000); // refresh "last response" age
    return () => { off(); clearInterval(i); };
  }, []);

  if (entries.length === 0) {
    return (
      <div className="glass rounded-xl p-4 border border-[var(--border)]">
        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground mb-2">
          Account Diagnostics
        </div>
        <div className="text-xs text-muted-foreground italic">
          No accounts connected. Add a DEMO token first to safely test the engine.
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-4 border border-[var(--border)]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
          Account Diagnostics · {entries.length} session{entries.length === 1 ? "" : "s"}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Tokens · sessionStorage only
        </div>
      </div>
      <div className="grid gap-2">
        {entries.map((e) => {
          const isActive = e.token === active;
          const isDemo = e.account?.is_virtual === true;
          const isReal = e.account?.is_virtual === false;
          const lastApi = e.client.getLastApiResponseAt();
          const ageSec = lastApi ? Math.max(0, Math.round((Date.now() - lastApi) / 1000)) : null;
          return (
            <div key={e.token}
              className={`rounded-md border p-3 ${
                isActive ? "border-[var(--gold)]/70 bg-[var(--gold)]/5"
                         : "border-[var(--border)] bg-[var(--surface-2)]/30"
              }`}>
              <div className="flex items-center gap-2 flex-wrap">
                {isActive
                  ? <CheckCircle2 className="size-3.5 text-[var(--gold)]" />
                  : <Circle className="size-3.5 text-muted-foreground" />}
                <span className="text-xs font-bold">{e.label}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wider"
                  style={{
                    background: isDemo ? "oklch(0.78 0.16 70 / 0.18)"
                               : isReal ? "oklch(0.72 0.17 145 / 0.18)"
                               : "oklch(0.5 0 0 / 0.18)",
                    color: isDemo ? "oklch(0.85 0.18 85)"
                          : isReal ? "oklch(0.85 0.16 150)"
                          : "var(--muted-foreground)",
                  }}>
                  {isDemo ? "DEMO" : isReal ? "REAL" : "—"}
                </span>
                <span className="ml-auto text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  {e.status}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[10px] font-mono">
                <Field k="Login" v={e.account?.loginid ?? "—"} />
                <Field k="Currency" v={e.account?.currency ?? "—"} />
                <Field k="Balance" v={e.balance ? `${e.balance.balance.toFixed(2)} ${e.balance.currency}` : "—"} highlight />
                <Field k="Last API" v={ageSec == null ? "—" : `${ageSec}s ago`} />
              </div>
              {e.discovered.length > 1 && (
                <div className="mt-2 pt-2 border-t border-[var(--border)]/40">
                  <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                    Discovered accounts ({e.discovered.length}) · connect token for any not authorized here
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {e.discovered.map((d) => {
                      const isThis = d.loginid === e.account?.loginid;
                      return (
                        <span key={d.loginid}
                          className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                            isThis ? "border-[var(--gold)]/60 text-[var(--gold)]"
                                   : "border-[var(--border)] text-muted-foreground"
                          }`}>
                          <span className="font-bold mr-1">{d.is_virtual ? "DEMO" : "REAL"}</span>
                          {d.loginid} · {d.currency}
                          {isThis && " ✓"}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {e.error && (
                <div className="mt-2 flex items-start gap-1.5 text-[10px] text-[var(--destructive)]">
                  <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                  <span className="font-mono">{e.error}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


function Field({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground uppercase tracking-widest">{k}</span>
      <span className={highlight ? "gold-text font-semibold" : "text-foreground"}>{v}</span>
    </div>
  );
}
