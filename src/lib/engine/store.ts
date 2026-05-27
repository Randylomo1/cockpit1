/**
 * Global cockpit store — Zustand.
 * Holds tick buffer per market, active market, engine config, signals, snapshot.
 */
import { create } from "zustand";
import type { MarketSymbol } from "../deriv/markets";
import { getDerivClient, type ConnectionStatus, type Tick } from "../deriv/ws";
import { SignalEngine, type EngineSnapshot, type Signal, type EngineConfig } from "./signals";

const MAX_BUFFER = 1500;

interface CockpitState {
  activeMarket: MarketSymbol;
  status: ConnectionStatus;
  statusError?: string;
  latencyMs: number;
  // Per-market state
  digits: Record<MarketSymbol, number[]>;
  lastTick: Record<MarketSymbol, Tick | undefined>;
  snapshot: Record<MarketSymbol, EngineSnapshot | undefined>;
  signals: Signal[]; // newest first, capped
  tickIndex: number;
  // Actions
  setActiveMarket: (m: MarketSymbol) => void;
  connect: () => void;
  disconnect: () => void;
  updateConfig: (c: Partial<EngineConfig>) => void;
  clearSignals: () => void;
  getEngineConfig: () => EngineConfig;
}

const engine = new SignalEngine();
let initialised = false;

export const useCockpit = create<CockpitState>((set, get) => ({
  activeMarket: "R_100",
  status: "idle",
  latencyMs: 0,
  digits: {} as any,
  lastTick: {} as any,
  snapshot: {} as any,
  signals: [],
  tickIndex: 0,

  setActiveMarket: (m) => {
    const prev = get().activeMarket;
    if (prev === m) return;
    const client = getDerivClient();
    set({ activeMarket: m });
    if (get().status === "open") {
      client.subscribeTicks(m);
      // warm up history
      client.fetchHistory(m, 300).catch(() => {});
    }
  },

  connect: () => {
    if (initialised) {
      getDerivClient().connect();
      return;
    }
    initialised = true;
    const client = getDerivClient();
    client.onStatus((s, err) => set({ status: s, statusError: err, latencyMs: client.getLatency() }));
    client.onTick((tick) => {
      const st = get();
      const prevDigits = st.digits[tick.symbol] ?? [];
      const nextDigits = prevDigits.length >= MAX_BUFFER
        ? [...prevDigits.slice(prevDigits.length - MAX_BUFFER + 1), tick.lastDigit]
        : [...prevDigits, tick.lastDigit];

      const tickIndex = st.tickIndex + (tick.symbol === st.activeMarket ? 1 : 0);

      // Compute snapshot only for active market for perf
      let snapshot = st.snapshot[tick.symbol];
      let newSignals = st.signals;
      if (tick.symbol === st.activeMarket) {
        const snap = engine.analyse(tick.symbol, nextDigits, tickIndex);
        snapshot = snap;
        // Age existing signals for this market
        let aged = engine.ageSignals(newSignals, tickIndex);
        if (snap.newSignal) {
          aged = [snap.newSignal, ...aged].slice(0, 30);
        }
        newSignals = aged;
      }

      set({
        digits: { ...st.digits, [tick.symbol]: nextDigits },
        lastTick: { ...st.lastTick, [tick.symbol]: tick },
        snapshot: { ...st.snapshot, [tick.symbol]: snapshot },
        signals: newSignals,
        tickIndex,
        latencyMs: client.getLatency(),
      });
    });
    client.connect();
    // Wait until open, then subscribe + warm up
    const unsub = client.onStatus((s) => {
      if (s === "open") {
        const m = get().activeMarket;
        client.subscribeTicks(m);
        client.fetchHistory(m, 300).catch(() => {});
      }
    });
    // Don't unsub — we want auto re-subscribe on every reconnect.
    void unsub;
  },

  disconnect: () => {
    getDerivClient().disconnect();
  },

  updateConfig: (c) => engine.updateConfig(c),
  getEngineConfig: () => engine.getConfig(),
  clearSignals: () => set({ signals: [] }),
}));
