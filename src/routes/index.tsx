import { createFileRoute } from "@tanstack/react-router";
import { Cockpit } from "@/components/cockpit/Cockpit";

export const Route = createFileRoute("/")({
  component: CockpitPage,
  head: () => ({
    meta: [
      { title: "Matches Cockpit · Synthetic Indices Probability Intelligence" },
      { name: "description", content: "Institutional-grade MATCHES analysis platform for Deriv synthetic indices. Real-time digit dominance, momentum, transition probability and confidence-scored MATCH signals." },
    ],
  }),
});

function CockpitPage() {
  return <Cockpit />;
}
