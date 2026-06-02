/**
 * Account state — Zustand slice over the auth pool.
 *
 * Tokens are session-only (sessionStorage). No localStorage persistence.
 * Multiple accounts (Demo + Real) can be connected simultaneously; one is
 * marked active for trade execution.
 */
import { create } from "zustand";
import { getAuthPool, type PoolEntry } from "./authPool";
import { purgeLegacyTokenStorage, type AuthStatus, type AuthAccount, type AuthBalance } from "./authWs";

interface AccountState {
  // active account mirrors
  status: AuthStatus;
  error?: string;
  account: AuthAccount | null;
  balance: AuthBalance | null;
  // pool
  entries: PoolEntry[];
  activeToken: string | null;
  initialised: boolean;

  bootstrap: () => void;
  connect: (token: string, label: string) => Promise<void>;
  setActive: (token: string) => void;
  remove: (token: string) => void;
  disconnect: () => void;
}

export const useAccount = create<AccountState>((set, get) => ({
  status: "DISCONNECTED",
  account: null,
  balance: null,
  entries: [],
  activeToken: null,
  initialised: false,

  bootstrap: () => {
    if (get().initialised) return;
    set({ initialised: true });
    purgeLegacyTokenStorage();
    const pool = getAuthPool();
    pool.on((entries, activeToken) => {
      const active = activeToken ? entries.find((e) => e.token === activeToken) ?? null : null;
      set({
        entries,
        activeToken,
        status: active?.status ?? "DISCONNECTED",
        error: active?.error,
        account: active?.account ?? null,
        balance: active?.balance ?? null,
      });
    });
    pool.bootstrap();
  },

  connect: async (token, label) => {
    await getAuthPool().add(token, label);
  },

  setActive: (token) => getAuthPool().setActive(token),
  remove: (token) => getAuthPool().remove(token),

  disconnect: () => {
    const active = getAuthPool().getActiveToken();
    if (active) getAuthPool().remove(active);
  },
}));
