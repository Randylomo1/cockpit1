
# MATCH Cockpit → Adaptive Intelligence Upgrade

Your 19-step spec covers months of work. To keep the cockpit shippable at every stage and avoid a giant unreviewable diff, I'll deliver it as **4 waves**. Each wave leaves the system fully functional and visibly better. Existing files, naming, WS lifecycle, Zustand store, Noir & Gold UI are preserved — new code is **added alongside**, not in place of, current modules.

I'll start on **Wave 1** as soon as you approve. Waves 2–4 follow on confirmation after each one.

---

## Architectural Principles (applied to every wave)

- **Per-market isolation**: every new statistic, weight, calibration table, and outcome buffer is keyed by `MarketSymbol`. No global pools.
- **Pure engines, thin store**: heavy math stays in `src/lib/engine/*` as pure functions/classes. The Zustand store only orchestrates.
- **Non-blocking**: tick-time work stays O(window). Replay/calibration/adaptation run in batched async passes (`requestIdleCallback` fallback to `setTimeout(0)`).
- **Persistence**: outcome history, calibration tables, and adaptive weights persist to Supabase (per-market rows, append-only events + rolling aggregates). In-memory ring buffers for hot path; DB for durability and cross-session learning.
- **MATCH-only**: no over/under, even/odd, rise/fall, multipliers — anywhere.
- **No execution yet**: paper trading only through Wave 3. Live execution scaffolding lands in Wave 4 behind an explicit "ARM LIVE" gate.

---

## Wave 1 — Empirical Foundation  (steps 1, 2, 5, 13, 17)

Goal: every signal we already emit gets tracked, replayed, and graded against the next 1/2/3/5 ticks — per market — without touching the UI's signal generation path.

New files:
- `src/lib/engine/outcomes.ts` — `OutcomeTracker` class. Logs every signal with the full snapshot fields you listed (signalId, market, confidence, z, p, entropy, regime, dominance, persistence, transition continuation, streak, decay, digit distribution, momentum, cooldown, quote, latency, tier-placeholder, EV-placeholder). Resolves outcome at +1/+2/+3/+5 ticks. Per-market ring buffer (1k signals) + flush to Supabase.
- `src/lib/engine/replay.ts` — pure tick-replay helpers: immediate win prob, delayed win prob, decay speed, reversal rate, persistence continuation, entropy shift, dominance survival.
- `src/lib/engine/marketStats.ts` — per-market rolling stats container (win rate, regime perf, digit perf, entropy baseline, volatility profile, cooldown effectiveness). EWMA-based.
- Hardened filters extension in `src/lib/engine/signals.ts` (add: entropy spike, dominance flip rate, z-weakening, transition destabilization, decay acceleration, persistence divergence, momentum/dominance conflict). Existing filters preserved.

DB (one migration):
- `match_signals` (append-only): id, market, emitted_at, digit, confidence, eqs (nullable until W2), tier (nullable), full snapshot JSONB, outcome JSONB (nullable until resolved), resolved_at.
- `match_market_stats` (one row per market): rolling counters, ewma fields, last_updated.
- RLS: authenticated read/write own rows scoped by `user_id`; service_role full. User auth lands at the start of W1 (email/password + Google via Lovable broker).

Store changes (minimal):
- New `outcomes` slice and `marketStats` slice. Existing `signals` array untouched.
- Signal emission also pushes into `OutcomeTracker.track(signal, snapshot)`.

UI (small, additive):
- New `MarketStatsStrip` under `EngineStatus` showing per-market resolved win-rates at +1/+2/+3/+5 with sample sizes.
- Signal cards gain a tiny "tracking" pill that flips to ✓/✗ with the +N tick result once resolved.

Acceptance for Wave 1:
- Every emitted signal appears in DB with snapshot.
- After ≥5 ticks past emission, outcomes row is populated.
- Per-market win-rate strip updates live.
- No regression to current cockpit; new hard filters can be toggled.

---

## Wave 2 — Quality Grading & Calibration  (steps 3, 4, 6, 7, 9, 10)

Goal: turn raw confidence into a calibrated, EV-aware tier system.

New files:
- `src/lib/engine/eqs.ts` — Entry Quality Score (0–100) combining confidence, z, persistence stability, CSS, entropy stability, dominance durability, momentum alignment, decay health, market stability. Pure function over snapshot + marketStats.
- `src/lib/engine/css.ts` — Continuation Strength Score: self-repeat prob × stability, transition matrix entropy, persistence duration, entropy/z/dominance modifiers.
- `src/lib/engine/regime.ts` — full regime classifier: TRENDING / CYCLIC / STABLE / CHAOTIC / REVERSAL / TRANSITIONAL. Replaces current 3-state regime (back-compat alias maintained).
- `src/lib/engine/calibration.ts` — per-market reliability table mapping raw confidence buckets → empirical win prob (isotonic / binned Bayesian update from `match_signals.outcome`). Rebuilt on a debounced timer from DB.
- `src/lib/engine/ev.ts` — EV = winProb·payout − lossProb·stake. Configurable payout (default Deriv MATCH ≈ 8.5x per digit; surfaced as setting). Min-EV threshold, EV ranking, EV decay over ticksAlive.

Tier mapping in `signals.ts`:
- S 92–100, A 88–91, B 84–87, reject <84. Tier stored on signal.
- Execution-eligibility flag = S-tier or upper A-tier AND positive EV AND regime ∈ {TRENDING, STABLE, CYCLIC}.

UI:
- Signal card shows: TIER badge (gold for S), calibrated win prob, EV %, regime icon. Existing decay bar kept.
- `CalibrationChart` panel: raw confidence vs. empirical win prob (per active market).
- `RegimeBadge` in header.

Acceptance:
- Signals carry EQS, tier, calibrated prob, EV, regime.
- Calibration chart converges as outcomes accumulate.
- Volume drops (by design — quality over frequency).

---

## Wave 3 — Adaptation & Paper Trading  (steps 8, 11, 12, 14)

Goal: the system learns, and we measure that learning against a realistic paper book.

New files:
- `src/lib/engine/adaptiveWeights.ts` — replaces static `DEFAULT_WEIGHTS` consumption. Per-market weight vector updated via EWMA + Bayesian shrinkage from outcome-attributed factor reliability. Bounded (no weight collapses to 0; floor 0.02). Persisted in `match_market_stats.weights`.
- `src/lib/engine/timingOptimizer.ts` — for each market, learns best entry offset ∈ {0, +1t, +2t, persistence-confirm}. Computed from replay buffers; surfaced as `signal.recommendedEntry`.
- `src/lib/paper/engine.ts` — paper book: simulated proposal latency (from real WS RTT), entry delay, payout variance, slippage. Positions resolve on tick stream. Per-market and global ROI, max DD, streaks, Sharpe-ish.
- `src/lib/paper/store.ts` — Zustand slice for paper positions + ledger.

DB:
- `match_paper_trades` (per user): signalId, market, tier, entry params, outcome, pnl.

UI (new section under SignalsPanel, collapsible):
- `PaperBook` — open positions, ledger, equity curve sparkline.
- `AnalyticsDashboard` route segment with: per-market win rate, digit perf, regime perf, calibration overlay, EQS histogram, EV histogram, streak distribution, entry-timing analysis, decay curves, weight drift over time.

Acceptance:
- Auto-paper-traded every eligible signal end-to-end.
- Adaptive weights observably drift per market (visible in dashboard).
- Recommended entry timing differs across markets after enough samples.

---

## Wave 4 — Safety, Risk & Execution Readiness  (steps 15, 16 verify, 18 cleanup)

Goal: institutional-grade safety rails + scaffold (not enable) live execution.

New files:
- `src/lib/risk/engine.ts` — max consecutive loss, max session DD, post-volatility cooldown, signal frequency limiter, duplicate suppression, invalid statistical state, stale tick detector, WS desync detector. Every gate emits a structured `RiskEvent`.
- `src/lib/execution/orchestrator.ts` — state machine: `IDLE → PROPOSED → VALIDATED → ARMED → EXECUTING → SETTLED`. Currently terminates at `ARMED` unless `LIVE_MODE` flag is on. Builds Deriv `proposal` and `buy` payloads for MATCH only.
- `src/lib/deriv/auth.ts` — Deriv API token auth (user-supplied, stored encrypted server-side via a Supabase row + server function; never in localStorage). Token scope check (read+trade), account snapshot.
- `src/components/cockpit/RiskPanel.tsx`, `ExecutionPanel.tsx` — live risk telemetry, ARM/DISARM toggle (defaults OFF), per-trade confirm dialog.

Cleanup pass:
- Remove dead code, ensure all engines strongly typed, deterministic, MATCH-only audit (grep for forbidden contract types).
- Verify perf: signal pipeline budget ≤ 3ms per tick on active market; analytics dashboard runs off the hot path.

Acceptance:
- Risk events visible and gating signals.
- Full Deriv proposal/buy path executable in `LIVE_MODE=off` (dry run logs the exact payload).
- Flipping `LIVE_MODE` on with a valid token actually executes (manual confirm per trade).

---

## What I need from you

1. **Approve Wave 1** to start (DB migration + outcome tracker + replay + hardened filters + auth).
2. Confirm payout assumption for EV (default I'll use: MATCH on synthetic digits ≈ **8.5×** stake; tweakable per market). If you have a more accurate per-market table, paste it.
3. Confirm auth: **email/password + Google** (Lovable broker), email auto-confirm OFF (standard).

On approval I'll ship Wave 1 end-to-end in the next turn, then check in before Wave 2.
