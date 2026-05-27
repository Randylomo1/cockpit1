/**
 * Global cockpit store — Zustand.
 * Holds tick buffer per market, active market, engine config, signals, snapshot.
 * Also drives the empirical OutcomeTracker (Wave 1) — every emitted signal
 * is logged and graded against the next 1/2/3/5 ticks, per market.
 */
import { create } from "zustand";
import type { MarketSymbol } from "../deriv/markets";
import { getDerivClient, type ConnectionStatus, type Tick } from "../deriv/ws";
import { SignalEngine, type EngineSnapshot, type Signal, type EngineConfig } from "./signals";
import { OutcomeTracker, type MarketOutcomeStats, type PendingSignal } from "./outcomes";

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
  // Outcome tracking
  outcomeStats: Record<string, MarketOutcomeStats | undefined>;
  resolvedSignals: Record<string, PendingSignal | undefined>;
  trackerVersion: number;
  // Actions
  setActiveMarket: (m: MarketSymbol) => void;
  connect: () => void;
  disconnect: () => void;
  updateConfig: (c: Partial<EngineConfig>) => void;
  clearSignals: () => void;
  getEngineConfig: () => EngineConfig;
}

const engine = new SignalEngine();
const tracker = new OutcomeTracker();
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
  outcomeStats: {},
  resolvedSignals: {},
  trackerVersion: 0,

  setActiveMarket: (m) => {
    const prev = get().activeMarket;
    if (prev === m) return;
    const client = getDerivClient();
    set({ activeMarket: m });
    if (get().status === "open") {
      client.subscribeTicks(m);
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

      // Feed outcome tracker BEFORE computing new snapshot — so the just-arrived
      // tick resolves any pending signals waiting on it.
      tracker.onTick(tick.symbol, tick.lastDigit);

      let snapshot = st.snapshot[tick.symbol];
      let newSignals = st.signals;
      if (tick.symbol === st.activeMarket) {
        const snap = engine.analyse(tick.symbol, nextDigits, tickIndex);
        snapshot = snap;
        let aged = engine.ageSignals(newSignals, tickIndex);
        if (snap.newSignal) {
          aged = [snap.newSignal, ...aged].slice(0, 30);
          const topMomentumDigit = [...snap.perDigit].sort((a, b) => b.momentum - a.momentum)[0].digit;
          tracker.track(snap.newSignal, {
            entropy: snap.windows.w100.entropy,
            dominantDigit: snap.windows.w50.dominant,
            topMomentumDigit,
          });
        }
        newSignals = aged;
      }

      // Snapshot tracker projections for React subscribers.
      const stats: Record<string, MarketOutcomeStats | undefined> = {};
      for (const s of tracker.getAllStats()) stats[s.market] = s;
      const resolved: Record<string, PendingSignal | undefined> = {};
      for (const sig of newSignals) {
        const r = tracker.getResolved(sig.id);
        if (r) resolved[sig.id] = r;
      }

      set({
        digits: { ...st.digits, [tick.symbol]: nextDigits },
        lastTick: { ...st.lastTick, [tick.symbol]: tick },
        snapshot: { ...st.snapshot, [tick.symbol]: snapshot },
        signals: newSignals,
        tickIndex,
        latencyMs: client.getLatency(),
        outcomeStats: stats,
        resolvedSignals: resolved,
        trackerVersion: tracker.version,
      });
    });
    client.connect();
    const unsub = client.onStatus((s) => {
      if (s === "open") {
        const m = get().activeMarket;
        client.subscribeTicks(m);
        client.fetchHistory(m, 300).catch(() => {});
      }
    });
    void unsub;
  },

  disconnect: () => {
    getDerivClient().disconnect();
  },

  updateConfig: (c) => engine.updateConfig(c),
  getEngineConfig: () => engine.getConfig(),
  clearSignals: () => set({ signals: [] }),
}));
