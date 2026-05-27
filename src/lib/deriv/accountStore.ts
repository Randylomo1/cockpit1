/**
 * Account state — isolated from market cockpit store.
 * Subscribes to the singleton DerivAuthClient and exposes a Zustand slice.
 */
import { create } from "zustand";
import {
  getAuthClient,
  saveToken,
  loadToken,
  clearToken,
  type AuthStatus,
  type AuthAccount,
  type AuthBalance,
} from "./authWs";

interface AccountState {
  status: AuthStatus;
  error?: string;
  account: AuthAccount | null;
  balance: AuthBalance | null;
  remember: boolean;
  initialised: boolean;
  redactedToken: string | null;
  connect: (token: string, remember: boolean) => Promise<void>;
  disconnect: () => void;
  bootstrap: () => void;
  setRemember: (v: boolean) => void;
}

export const useAccount = create<AccountState>((set, get) => ({
  status: "DISCONNECTED",
  account: null,
  balance: null,
  remember: false,
  initialised: false,
  redactedToken: null,

  bootstrap: () => {
    if (get().initialised) return;
    set({ initialised: true });
    const c = getAuthClient();
    c.onStatus(({ status, error }) =>
      set({ status, error, redactedToken: c.getRedactedToken() }),
    );
    c.onAccount((a) => set({ account: a }));
    c.onBalance((b) => set({ balance: b }));

    const persisted = loadToken();
    if (persisted) {
      set({ remember: !!localStorage.getItem("dvx.auth.remember.v1") });
      c.connect(persisted).catch(() => {});
    }
  },

  connect: async (token, remember) => {
    saveToken(token, remember);
    set({ remember });
    await getAuthClient().connect(token);
  },

  disconnect: () => {
    clearToken();
    getAuthClient().disconnect();
  },

  setRemember: (v) => set({ remember: v }),
}));
