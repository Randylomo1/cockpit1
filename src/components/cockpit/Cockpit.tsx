import { useEffect } from "react";
import { useCockpit } from "@/lib/engine/store";
import { CockpitHeader } from "./Header";
import { TickFeed } from "./TickFeed";
import { DigitHeatmap } from "./DigitHeatmap";
import { EngineStatus } from "./EngineStatus";
import { SignalsPanel } from "./SignalsPanel";
import { MarketStatsStrip } from "./MarketStatsStrip";
import { LiveDbotSignal } from "./LiveDbotSignal";
import { MatchButtonGrid } from "./MatchButtonGrid";
import { MatchIntelligence } from "./MatchIntelligence";

export function Cockpit() {
  const connect = useCockpit((s) => s.connect);
  const disconnect = useCockpit((s) => s.disconnect);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return (
    <div className="dark min-h-screen text-foreground">
      <CockpitHeader />
      <main className="max-w-[1500px] mx-auto p-5 grid gap-4 lg:grid-cols-3">
        {/* PRIMARY: real-time matches intelligence — single trade digit, high-confidence filter */}
        <div className="lg:col-span-3">
          <MatchIntelligence />
        </div>
        <div className="lg:col-span-3">
          <LiveDbotSignal />
        </div>
        <section className="lg:col-span-2 space-y-4">
          <TickFeed />
          <MatchButtonGrid />
          <DigitHeatmap />
          <EngineStatus />
          <MarketStatsStrip />
        </section>
        <aside className="lg:col-span-1">
          <SignalsPanel />
        </aside>
        <footer className="lg:col-span-3 text-center text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 pt-2">
          Real-time MATCH intelligence · Composite 35/30/25/10 · Threshold ≥ 78/100 · Source: Deriv WS app_id 1089
        </footer>
      </main>
    </div>
  );
}
