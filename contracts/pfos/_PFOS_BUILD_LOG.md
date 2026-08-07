# PFOS Build Log

A separate track from `contracts/_CONTRACT_INDEX.md` (the v1 application index, which
stays frozen at exactly five delivered contracts). This log records implementation of
the ingested PFOS contracts (`contracts/pfos/01..04`), authored against them as the
authoritative build input. See `docs/PFOS_IMPLEMENTATION_ROADMAP.md` for the full plan.

## Stage 1 — Obligations & Safe-to-Spend (server-free) · COMPLETE

The highest-value stage that needs no server: it turns raw balances into a defensible
"what can I actually spend" figure with visible reserves and honest confidence.

| Phase | Deliverable | Source (ingested) | Status |
| ----- | ----------- | ----------------- | ------ |
| S1.1 | Obligation + policy schema (v2, additive migration) | contract 02 §6, §2.2; contract 01 §5.2 | done |
| S1.2 | Obligation protection engine — funding status, horizons, shortfall | contract 03 §3; contract 01 §5.2 | done |
| S1.3 | Safe-to-spend engine — eight-term reserve waterfall + confidence | contract 03 §2.2/§2.4/§2.5; contract 01 §5.5; contract 02 §10 | done |

### What landed

- `src/features/obligations/obligation.types.ts` — the thirteen-field `Obligation`, the
  P0–P3 tier matrix and override policy, `reserveFor` (the safe-to-spend PROTECTION
  floor: P0 full, P1 minimum, P2/P3 nothing unless explicitly over-reserved),
  `isProtectedTier`, `fundingSequence` (most-harmful-first, total + stable order).
- `src/features/safeToSpend/policy.types.ts` — `FinancialPolicy` as versioned data the
  owner edits (buffers, essential-living, uncertainty/staleness rates, expected inflow);
  conservative `DEFAULT_POLICY` that invents no threshold.
- `src/features/obligations/obligations.logic.ts` — pure UTC date helpers (`addDays`,
  `daysBetween`), shared liquidity primitives (`liquidNow`, `inflowOccurrences`,
  `confidentInflowsBy`, `pendingOutflowsBy`), `fundingAmount` (feasibility, distinct
  from `reserveFor`), the four-rung status ladder (`green`/`amber`/`red`/`critical`)
  walked over the funding sequence with a running cumulative, and the six horizons
  (`1d`/`7d`/`until_inflow`/`30d`/`statement`/`90d`) — `statement` and `until_inflow`
  report `available: false` rather than silently aliasing to `30d`.
- `src/features/safeToSpend/safeToSpend.ts` — the eight-term waterfall (liquid + high-
  confidence inflows − pending − protected − essential − buffer − uncertainty − planned
  credit-card commitments), floored at zero with a truthful `deficit` flag, daily
  allowance, staleness-aware confidence in basis-point bands, freshness, primary risk,
  `whatWouldImprove`, and delayed-income / unexpected-expense sensitivity.

### Integration into the existing app

- `SCHEMA_VERSION` 1 → 2; `migrateV1toV2` is purely additive (seeds `obligations: []`
  and `policy: DEFAULT_POLICY`); Drive sync merges obligations by id and the policy as an
  audited singleton; the local cache persists and restores both (no Dexie version bump —
  reuses the `kv` table).

### Verification

- 58 new tests (obligation type helpers, protection engine, safe-to-spend), every value
  hand-computed. Full suite 193/193 across 19 files. Typecheck 0, lint 0.
- Acceptance harness 19/19 (AC04 floor ratcheted 110 → 185). No new denylisted terms,
  money stays integral, Drive scope + ingestion isolation intact.

## Stage 2 — Purchase Decision Cards (server-free) · COMPLETE

The second headline feature ("decide before you spend"). A DETERMINISTIC policy gate
over the Stage-1 outputs — no LLM (contract 03 §1: the model never sources numbers).

| Phase | Deliverable | Source (ingested) | Status |
| ----- | ----------- | ----------------- | ------ |
| S2.1 | Decision card schema (7 states, 11-line order, evidence-package fold) | contract 03 §4.1/§4.3/§4.4 + JSON schema | done |
| S2.2 | Decision policy gate + card builder | contract 03 §4.2/§4.3; §1 (no-LLM-numbers) | done |

### What landed

- src/features/decisions/decision.types.ts — PurchaseRequest (contract §4.1 inputs),
  the seven Recommendation states (§4.3), toEvidenceRecommendation folding cap+condition
  into the JSON schema's approve_with_conditions, and the eleven-field DecisionCard
  (§4.4 order) plus the four-key HorizonImpacts and the Affordability numbers.
- src/features/decisions/decision.logic.ts — decidePurchase simulates the purchase as a
  single uncleared outflow (credit defers it to the next statement date) and re-runs the
  tested Stage-1 engines, so the decision is exactly as trustworthy as safe-to-spend. The
  ladder is ordered most-protective-first: financially_blocked (worsens any P0/P1 status)
  -> approve (covered in hand) -> approve_with_condition (needs expected income) ->
  alternative (cheaper option fits) -> delay (affordable over 90 days) -> approve_with_cap
  (only part fits) -> reject. Every branch compares the price to a computed safe-to-spend
  figure — no invented thresholds.

### Verification

- 13 new tests (one per recommendation state + card conformance + the evidence fold), all
  values hand-computed against a zero-reserve fixture. Full suite 206/206 across 20 files.
  Typecheck 0, lint 0. Harness 19/19 (AC04 floor 185 -> 200).

### Honest scope note

The one-year effect is a directional/reversibility statement, not a computed net-worth
path — full deterministic forecasting is Stage 3. LLM-judgment dimensions of §4.2
(justification quality, ROI, behavioural context) are deferred to the Stage 7 LLM tier.

## Stage 3 — Deterministic forecasting & Decision Outcome Registry (server-free) · COMPLETE

| Phase | Deliverable | Source (ingested) | Status |
| ----- | ----------- | ----------------- | ------ |
| S3.1 | Decision Outcome Registry (append-only, immutable core, prohibition guard) | contract 03 §12 | done |
| S3.2 | Deterministic forecast engine (cash-flow paths + scenarios) | contract 03 §6 | done |

### What landed

- src/features/decisions/decisionRecord.types.ts — the §12 DecisionRecord (question,
  recommendation, alternatives, policy version, data-snapshot id, frozen forecast, confidence,
  user action, override, review dates, append-only outcomes, net-benefit estimate, learning
  proposal); the SIX PROHIBITED self-modification kinds + two allowed kinds as data.
- src/features/decisions/decisionRegistry.ts — recordDecision (freezes the card's forecast +
  confidence), reviewDecision (APPENDS an outcome, computes prediction error = actual −
  expected, and enforces byte-identical immutable core), guardLearningProposal (rejects the
  six prohibited kinds outright, requires approval for hard-policy changes), proposeLearning
  (a prohibited proposal throws — it can never even be recorded), matureDecisions.
- src/features/forecast/forecast.ts — six horizons (§6.1); deterministic cash-balance path
  built from scheduled events (expected income, pending in/out, obligations on due date);
  three scenarios (baseline / downside=income-delay / upside=feared-costs-miss) produced by
  toggling ONLY the uncertain inputs — no invented magnitudes; ending/min balance, shortfall,
  deterministic shortfall-probability, emergency-buffer days, main drivers; reconciles to
  safe-to-spend's liquid-now at H=today. Monte Carlo / probabilistic ranges defer to the server.

### Integration

- SCHEMA_VERSION 2 → 3; migrateV2toV3 additive (seeds decisions: []); Drive sync merges
  decisions by id; local cache persists/restores them (kv table). Full migration/schema
  regression suite still green.

### Verification

- 22 new tests (10 registry incl. immutability + all six prohibitions; 12 forecast, all paths
  hand-computed). Full suite 228/228 across 22 files. Typecheck 0, lint 0. Harness 19/19
  (AC04 floor 200 → 220).

## Stage 4 — Multi-currency & real net worth (server-free, additive) · COMPLETE

Resolves Conflict C-3. Deliberately ADDITIVE — accounts, transactions and the budget engine
are untouched, so a single-currency EGP database produces byte-identical numbers (the
regression bar). Foreign cash is modelled as a liquid asset rather than a foreign account.

| Phase | Deliverable | Source (ingested) | Status |
| ----- | ----------- | ----------------- | ------ |
| S4.1 | Net-worth schema (assets, FX rates, macro) | contract 01 §6; contract 03 §8.3 | done |
| S4.2 | Net-worth engine (views, FX, real value) | contract 01 §6; contract 03 §8.1/8.2/8.4 | done |

### What landed

- src/features/netWorth/netWorth.types.ts — Asset (financial/real, own currency, liquidation
  haircut, valuation source+time), FxRate (integer ratio to EGP with source+time — no float
  drift), MacroContext (reference currency, annual inflation bps). Intangible capital is
  deliberately excluded from book net worth (contract 03 §8.4).
- src/features/netWorth/netWorth.ts — toEgp/fromEgp/convert (through the EGP base, via
  mulRatio); netWorth() returning the nominal / liquid / liquidation views with an
  explainability component breakdown and an unrated-currency list (missing rates are flagged,
  never silently zeroed); realValue() deflating by whole years of inflation via integer ratios;
  realNetWorth().

### Integration

- SCHEMA_VERSION 3 → 4; migrateV3toV4 additive (empty assets/fx, zeroed macro); Drive sync
  merges assets by id, fx by currency, macro as an audited singleton; local cache persists all
  three. Budget / safe-to-spend / forecast numbers unchanged.

### Verification

- 13 new tests incl. the EGP-only regression (nominal reduces to cash − credit − obligations),
  exact FX rounding, liquidation haircuts, reference-currency expression, and unrated-currency
  flagging. Full suite 241/241 across 23 files. Typecheck 0, lint 0. Harness 19/19
  (AC04 floor 220 → 235).

### Honest scope note

Per-transaction multi-currency SPENDING and a live macro/FX API are deferred (higher
regression risk / a server concern). Projected & decision net worth compose from the Stage-2/3
engines. This completes the server-free product.

### The fork (Stage 5) — needs a human decision, no more server-free code

- Stage 5 = D1 (database location) + D2 (server/bot) choice — see docs/PFOS_HUMAN_DELIVERABLES.md.
- Stage 6 (ingestion tier) needs Path B/C + credentials; Stage 7 (LLM tier) needs the
  not-yet-written contract 05 or an approved interim orchestration policy; Stage 8 (behavioural)
  is last. NONE of these start until the fork is chosen.

---

## Stage 1-2 UI surfaces (Command Center + Decide) - completed 2026-08-06

**Why this addendum.** Stages 1-4 shipped the ENGINES (obligations, safe-to-spend, decision
cards, forecast, decision registry, multi-currency net worth) as headless pure modules with
full test coverage. The roadmap, however, also specifies the server-free UI for Stages 1-2 -
"a new Command Center / Home route (04 A2)" and "the 11-line Decision Card rendered in the web
app + a Decide route" - which had not yet been built. That UI needs no server, no secret, and
no human decision, so it was completed to genuinely finish the server-free product before the
Stage-5 fork.

### Work

- `src/app/router.tsx` - added `/home` and `/decide` to the `RoutePath` union + known list;
  DEFAULT_ROUTE now `/home` (contract 04 A2: the Command Center is the primary home). The
  budget grid and every existing route are untouched (C-4: safe-to-spend is a NEW figure beside
  Ready-to-Assign, never a rename).
- `src/features/safeToSpend/CommandCenter.tsx` - the Home route. Presentation only; renders
  `safeToSpendAllHorizons` (hero = next-7-days window + per-day allowance + confidence band +
  primary risk + what-would-improve; a deficit surfaces a red alert), `obligationFundingReport`
  (RAG-status table + worst-status badge), and `netWorth` (nominal / liquid / liquidation +
  component breakdown; unrated currencies flagged, never silently zeroed). No money math here.
- `src/features/decisions/DecideView.tsx` - the Decide route. A purchase-request form
  (price, cash/credit, urgency, reversibility, alternative price, purpose) that feeds
  `decidePurchase` and renders the 11-line Decision Card live: recommendation banner, reason,
  the five time-horizon effects, affordability line, evidence, alternative, confidence +
  missing-info, and the required next step.
- `src/App.tsx` - imports + NAV (Home, Decide) + exhaustive `views` record over all 7 routes.

### Verification

- 6 new component tests (CommandCenter: funded + deficit + empty-obligations paths; DecideView:
  price prompt, unqualified approve when affordable, qualified recommendation when far beyond
  cash). Full suite 247/247 across 25 files. Typecheck 0, lint 0, headers PASS (78 files).
  Harness 19/19. AC04 floor 235 -> 245.
- Test note: an unaffordable purchase yields `approve_with_cap` (approve up to the affordable
  cap), a deliberate tested engine behaviour - so the UI test asserts a *qualified* rather than
  a flatly negative recommendation.

The server-free product is now complete end to end (engines + UI). The Stage-5 fork below is
unchanged and still needs the human D1/D2 decision.

---

## Living sample dataset (demo) - completed 2026-08-06

**Why.** The server-free product (Stages 1-4 engines + UI) can be exercised without the owner's
real data (Dv3) by embedding a fully-worked SAMPLE portfolio. This lets the whole product be
seen and validated end to end today, and de-risks the eventual real-data load. It does NOT
unblock Stages 5-8 - those are gated on the D1/D2 architecture decision and contract 05, not on
data - so no ingestion/server/LLM code was written against mocks (which would presuppose D1=B/C
and risk the wrong parsers; real SMS/statement formats Dv1/Dv2 are still required there).

### Work

- `src/features/demo/sampleData.ts` - `buildSampleDb(nowIso)` (deterministic; relative dates so
  the demo is evergreen) + `applySampleData(draft, nowIso)`. Rich, clearly-labelled SAMPLE data:
  3 accounts (debit / credit / tracking), fresh transactions + one pending, obligations across
  ALL four tiers (P0-P3) incl. one credit-linked (statement horizon), a policy with buffers and
  a reliable expected salary (unlocks the "until income" horizon), 5 multi-currency assets
  (financial + real) including a DELIBERATELY unrated currency (SAR, no FX rate) to exercise the
  unrated flag, a USD->EGP integer FX rate, and an inflation macro for the real-value view.
- `src/features/safeToSpend/CommandCenter.tsx` - empty-portfolio onboarding: a "Load sample
  data" action shown ONLY when there are no accounts, so it can never overwrite a real ledger.
- `src/features/demo/sampleData.test.ts` - COVERAGE guarantee: the sample validates
  (`validateDb`) and is rich (accounts, all 4 tiers, multiple currencies), all six horizons
  resolve, net worth flags SAR (never zeroed), and every discrete state is provably reachable -
  all four obligation statuses, a safe-to-spend deficit, and multiple decision recommendations.

### Verification

- 8 new tests (7 coverage + 1 Command Center empty-state -> load -> populated). Full suite
  255/255 across 26 files. Typecheck 0, lint 0, headers PASS (80 files). Harness 19/19.
  AC04 floor 245 -> 253.

The server-free product is now demonstrable end to end with zero real data. Stage-5 fork below
is unchanged and still needs the human D1/D2 decision.

---

## Obligations manager UI - completed 2026-08-06

**Why.** The safe-to-spend engine and Command Center were only exercisable with sample data -
there was no way to enter REAL obligations. This is the primary server-free path for the owner
to supply Dv3 (their bills / loans / cards) through the app, so safe-to-spend can protect them.

### Work

- `src/app/router.tsx` + `src/App.tsx` - new `/obligations` route + NAV item + views entry.
- `src/features/obligations/ObligationsView.tsx` - add / edit / delete obligations against the
  Drive DB (pure client, no server). A modal form captures creditor, priority (P0-P3 with the
  override policy shown), amount due, minimum, due + optional grace date, frequency, penalty,
  autopay, a verification source (which maps to a default confidence so the owner never types a
  raw probability), and an optional linked account (enables the statement horizon). The list is
  shown in funding order (fundingSequence: most-harmful first). Ids via state/actions newId.
- Validation refuses an empty creditor, a non-positive amount, a missing/invalid due date, or a
  minimum greater than the amount due; a blank minimum defaults to the full amount.

### Verification

- 5 new tests (empty state, add+persist, reject no-amount, edit, delete). Full suite 260/260
  across 27 files. Typecheck 0, lint 0, headers PASS (82 files). Harness 19/19. AC04 floor
  253 -> 258.

Still server-free; the Stage-5 fork is unchanged. This makes real-data entry possible today
without waiting on the D1/D2 decision.

---

## Settings (financial policy + macro) UI - completed 2026-08-06

**Why.** Safe-to-spend reserves stay at zero until the owner declares them (the engine never
invents a threshold), and the "until next income" horizon + confidence depend on a declared
expected income. There was no UI to set any of this. The real-value net-worth view also needs
an inflation figure. All server-free config on the Drive DB.

### Work

- `src/app/router.tsx` + `src/App.tsx` - new `/settings` route + NAV item + views entry.
- `src/features/settings/SettingsView.tsx` - edits the versioned FinancialPolicy (minimum cash
  buffer, essential-living-per-month) and an optional expected income (amount, day-of-month,
  reliability -> confidence), plus the macro annual-inflation % (stored as bps). Save writes
  policy + macro via a single mutation and shows a saved confirmation. Validation refuses an
  out-of-range income day, a non-positive income amount, and negative inflation.

### Verification

- 3 new tests (save policy+macro, reject bad income day, clear income on uncheck). Full suite
  263/263 across 28 files. Typecheck 0, lint 0, headers PASS (84 files). Harness 19/19.
  AC04 floor 258 -> 261.

Server-free; Stage-5 fork unchanged. Combined with the obligations manager, the owner can now
fully configure safe-to-spend on real data with no server.


## Stage 3 UI (forecast + decision registry) - completed 2026-08-06

**Why.** Stages 3-4 built the forecast engine, the decision-outcome registry, and net worth,
but only the Decide route surfaced any of it. The deterministic cash-flow forecast had no
screen, decisions could be evaluated but never RECORDED, and the append-only registry (contract
03 section 12) had no way to view history or attach follow-through. All server-free, pure client
work over the Drive DB.

### Work

- `src/app/router.tsx` + `src/App.tsx` - new `/forecast` and `/decisions` routes + NAV items +
  exhaustive `views` entries.
- `src/features/forecast/ForecastView.tsx` - renders `forecastAll(db, asOf)` as a by-horizon
  table (starting cash, baseline ending, downside low, shortfall-risk %, buffer days) across the
  six fixed horizons. Presentation only; no money math.
- `src/features/decisions/DecideView.tsx` - added a "Record this decision" button that appends a
  frozen `recordDecision(...)` record to `db.decisions` (policy version + data-snapshot id +
  pending action), shows a "Recorded" confirmation, and disables to prevent a double-write. The
  confirmation resets only when the purchase INPUTS change (dependency keyed on `request`, not on
  the card object identity - recording itself mutates the db and re-derives the card, which would
  otherwise clear the confirmation instantly).
- `src/features/decisions/DecisionsView.tsx` - the append-only registry table: ALL recorded
  decisions, newest first (NOT `matureDecisions`, which filters to review-due only and would hide
  fresh records); `matureDecisions` is used solely to flag which rows are due for outcome review.
  "Followed"/"Overrode" buttons update only `userAction` - the frozen forecast/recommendation are
  never rewritten (03 section 12 prohibition).

### Verification

- 5 new tests: ForecastView (heading + by-horizon table; the six fixed horizons), DecisionsView
  (empty state; a recorded decision renders + "Followed" updates userAction), DecideView (records
  a decision into the registry, confirmation shown, button disabled). Full suite 268/268 across
  30 files. Typecheck 0, lint 0, headers PASS (88 files). AC04 floor 261 -> 266.

Server-free; the Stage-5 fork (D1/D2 architecture, contract 05) is unchanged. With this, every
Stage 1-4 engine now has a screen except the assets/FX net-worth editor (next, and last).


## Net-worth UI + asset/FX editor - completed 2026-08-06

**Why.** Stage 4 built the currency-aware net-worth engine (`netWorth`, `toEgp`, `realNetWorth`)
but it had NO screen - the `/accounts` route is the transaction register, and there was no way to
enter valued assets or currency rates. This was the LAST server-free engine without a UI. Pure
client work on the Drive DB.

### Work

- `src/app/router.tsx` + `src/App.tsx` - new `/networth` route + NAV item ("Net worth") +
  exhaustive `views` entry.
- `src/features/netWorth/NetWorthView.tsx` - three parts:
  1. The five net-worth figures as a summary (nominal / liquid / liquidation) with a component
     breakdown (cash, financial assets, real assets, credit owed, obligations owed).
  2. An **unrated-currencies banner** - if an asset's currency has no FX rate, the engine leaves
     it OUT (never silently zeroed, contract 03 section 8.3) and the UI says so, pointing the
     owner to add a rate. Per-asset values render in the asset's OWN currency via `toDecimal`
     (currency-agnostic, never throws on a non-ISO code - `toEgp` throws on a missing rate, so it
     is not used for row display).
  3. Add/edit/delete editors for `Asset` (name, kind, currency, value, liquid, liquidation
     haircut % <-> bps, valuation source + date) and `FxRate` (currency, integer EGP-per-unit
     ratio, source, date). FX rows are keyed by currency (no id); editing locks the code. Real
     assets force `liquid=false`. Validation refuses a negative value, a haircut outside 0-100%,
     a non-positive/invalid FX ratio, an EGP rate (base needs none), and bad dates.

### Verification

- 3 new tests: summary + empty prompts; a recorded EGP asset reflected in nominal; add an asset
  through the modal (writes to `db.assets`). Full suite 271/271 across 31 files. Typecheck 0,
  lint 0, headers PASS (90 files). AC04 floor 266 -> 269.

Server-free. **This exhausts the server-free surface:** every Stage 1-4 engine now has a screen,
and real data (accounts, obligations, policy, assets, FX) can be entered entirely client-side on
the Drive DB. The remaining work is human-gated - D1 (DB location) + D2 (server/bot) architecture
decision, and contract 05 (unwritten) for the LLM/orchestration tier.


## OpenRouter LLM-tier contracts ingested + architecture synthesis - 2026-08-06

**Why.** Three new PFOS contracts (OpenRouter Phase 1 Benchmark Calibration, Phase 2 Automatic
Task/Turn Routing, Phase 3 Adaptive Cost/Quality Governance) arrived as aki attachments. They are
the authoritative LLM-tier specification - the surface contracts 05 (orchestration/tooling) and 07
(benchmark bar) were meant to cover and that was previously VERIFIED ABSENT.

### Work

- **Ingested byte-faithful** into `contracts/pfos/09_..`, `10_..`, `11_..` (6,016 / 7,557 / 5,942 bytes;
  SHA-256 recorded). Honest provenance: **aki attachment channel via the SESHA DROPZONE, NOT the
  Drive-folder pull** - recorded in a SEPARATE manifest `_INGESTION_MANIFEST_OPENROUTER.json`; the
  drive-pull manifest `_INGESTION_MANIFEST.json` is untouched.
- **Registered** the three in `_PFOS_CONTRACT_INDEX.md` (SHA + scope) and reconciled the "Absent
  contracts" note: 05/07's LLM-tier surface is now substantially specified; D6 becomes closable by
  adoption rather than authoring a new 05.
- **Synthesis** `docs/PFOS_OPENROUTER_ARCHITECTURE.md`: model roster (mimo-v2.5 / glm-5.2 / grok-4.5 /
  kimi-k3 with tier roles), T0-T4 routing table, the end-to-end turn stack (classify -> filter -> score
  -> call -> escalate -> audit), the utility formula, the three-phase lifecycle, cost+safety envelope
  ($20-40/mo budget; cache-read is 93.1% of the cost driver; 7 safety invariants), and a **module map
  M0-M9** onto the NIZAM build. Key connection recorded: **Phase 2's "router never calculates money"
  rule is ALREADY satisfied** - the shipped Stage 1-4 deterministic engines are T0/the deterministic
  services; the LLM tier is strictly additive and never sources a number.
- **Readiness updated** (`PFOS_BUILD_READINESS.md` + `.yaml`): OpenRouter row BLOCKED -> SPEC_READY with
  the roster, budget thresholds, and launch gate (Phase-1 benchmark must pass before any live routing).

### Notes

- No code built. This is ingestion + architecture documentation only; the LLM tier (modules M1-M9) is
  Stage 7, server-tier, gated on D1/D2 + K4 + a passing Phase-1 benchmark. M2 (benchmark harness) is the
  one piece buildable ahead of the server decision.
- Public-repo note: these contracts contain the owner's LLM budget and AKI workload intensity (no keys/
  secrets), consistent with the already-public contracts 01-04.

---

## M2 - OpenRouter Phase-1 benchmark harness (2026-08-06)

Built the offline, deterministic, no-network, no-key benchmark harness identified in
`docs/PFOS_OPENROUTER_ARCHITECTURE.md` as the one LLM-tier piece buildable ahead of the D1/D2 server
decision. It is a standalone tested module under `src/features/benchmark/` and is deliberately NOT
imported by the app router (stays out of the bundle; AC05/AC06). The live OpenRouter caller is module
M6 (server/key-gated) and is NOT built here - the runner reaches the model only through an injected
`ModelCaller` port, of which only a deterministic mock is provided.

### Files (7 modules + 5 test files)

- `benchmark.types.ts` - the nine categories + per-category minimums (`CATEGORY_MINIMUMS`,
  `BENCHMARK_MINIMUM_CASES = 210`), `BenchmarkCase`, the `ExpectedAnswer` discriminated union
  (extraction / label / boolean / explanation / tool_call / refusal), `ModelResponse`, `CaseScore`.
- `dataset.ts` - `buildEvalSet()` generates 219 deterministic cases (sms 52, classification 32,
  dedup 26, safe-to-spend 26, purchase-decision 26 with a binding recommendation, forecast 21,
  tool-call 16, multilingual 10 Arabic/mixed, adversarial 10 prompt-injection fixtures). SMS/statement
  inputs are SANITIZED synthetic templates - human deliverable Dv1 (real bank SMS formats) augments or
  replaces them. `validateEvalSet()` enforces total >= 210, per-category minimums, and unique ids.
- `scoring.ts` - pure `scoreCase(case, response)` per category: extraction critical-field accuracy,
  label/boolean exact match, explanation evidence-coverage + binding-recommendation guard, tool-call
  correct-tool/args, and the adversarial refusal gate. A case passes only when its metric is exact AND
  it commits zero hard-rule violations.
- `eligibility.ts` - aggregates `CaseScore[]` into L0/L1/L2 per the Phase-1 gates (L0 extraction
  critical-field accuracy >= 0.99; L1 schema validity >= 0.99 + zero hard-rule violations + evidence
  coverage >= 0.90; L2 zero violations + calibrated + reviewer disagreement <= 15% + adversarial and
  purchase-decision pass rates == 1). A P0 breach, an unauthorized tool action, or a fabricated
  financial figure DISQUALIFIES the model (all levels false) - no reputation is granted before a
  passing run.
- `cost.ts` - the cost formula over the 30-day reference token mix (`REFERENCE_USAGE_30D`; cache-read
  ~93% of spend) + `projectMonthlyCost(price, hoursPerWeek)` scaling by `hoursPerWeek / 56`. Missing
  cache-write price falls back to the (higher) prompt price - conservative, never under-stated. USD
  prices use `*UsdPerMillion` field names and totals use `costUsd` (money-core invariant: no
  money-named fields, no parseFloat/toFixed). Verified reproductions at 7 h/week (asserted in tests):
  GLM = USD 29.83, MiMo = USD 4.71, Grok = USD 185.73, Kimi = USD 233.94.
- `pricing.ts` - the frozen Phase-1 pricing table (four rostered models), `isStale`/TTL (7 days),
  `loadPricing` (I/O-free: uses an injected snapshot or the frozen table), and the `PricingSource`
  live-fetch port that this harness never invokes.
- `runner.ts` - the `ModelCaller` port, a deterministic `mockCaller` (perfect happy-path derived from
  each case's expected answer), a `configurableCaller` for imperfect-behavior tests, `runBenchmark`,
  `renderReport` (Markdown), and `serializeOutputs` emitting the five contract-09 artifacts
  (benchmark_results.json, model_eligibility_registry.json, pricing_snapshot.json,
  cost_projection.json, benchmark_report.md).

### Verification

- `tsc --noEmit` clean; `eslint --max-warnings 0` clean.
- 48 new tests (dataset 6, scoring 17, eligibility 5, cost 13, runner 7). Suite 271 -> 319 / 36 files.
- AC04 floor ratcheted 269 -> 317. AC08/AC08b/AC10/AC11 verified on the new module (no Drive scope, no
  scripts/ import, headers present, no organization-specific terms).

### What this does NOT do (still gated)

- No live LLM call, no network, no key usage. The live OpenRouter adapter (M6), the pricing service
  (M1), the classifier/router (M3/M4), escalation orchestrator (M5), telemetry (M7), and governance
  (M8) remain Stage-7 server-tier, gated on D1 (DB location) + D2 (server/bot) + K4 (OpenRouter key +
  spend cap). M2 is the last legitimately-buildable server-free/offline piece; the server-free surface
  is now exhausted.

---

## Decisions D1/D2/K4 recorded + offline model-selection policy (2026-08-06)

Owner resolved three of the four gated items from the M2 report:

- **D1 = B (VPS + SQLite).** Architecture flips from Profile A (Drive-only) to the server tier. The
  finished Profile-A Drive-JSON app stays as-is; the server tier will use SQLite. Do NOT provision
  SQLite until the VPS exists. Recorded in `docs/PFOS_BUILD_READINESS.md` (reconciliation item 3,
  fetch order) and `docs/pfos_build_readiness.yaml` (`architecture_decision: B`).
- **D2 = yes; provider OVHcloud; NOT YET PROVISIONED.** All `[server]` items (bot, Gmail, SMS,
  OpenRouter live client, VPS host) stay BLOCKED until the OVHcloud box is provisioned, hardened, and
  a restore drill is proven. Recorded in the readiness MD VPS row/section and the YAML
  (`server_decision: yes`, vps_host gate note).
- **K4 = OpenRouter, hard USD 5.00/week cap; default {mimo, glm} cheapest-capable; grok/kimi OFF
  unless the owner explicitly opts in for an ultra-complex task.** This TIGHTENS the contract-10/11
  default roster (which used Grok for T3 review and Kimi for T4). Recorded as a budget + model-policy
  block in the YAML, an overlay note under the architecture routing table, and the budget guardrail
  line (`$20-40/month` -> `USD 5.00/week`).

### Offline module built: `src/features/routing/modelPolicy.ts` (+ test)

K4 unlocks one new SERVER-FREE piece: the deterministic model-selection + weekly-budget policy (the
pure decision the live router M4/M6 will call). Reuses M2's frozen pricing + `costOfUsage` cost model.
NOT imported by the app router (stays out of the bundle); no network, no key, no live spend I/O (the
caller passes the running weekly spend in).

- `TIER_CAPABLE` (contract 10): MiMo T1 only; GLM T1-T4 workhorse/fallback; Grok T2/T3; Kimi T3/T4.
- `DEFAULT_ALLOWED = {mimo, glm}`; `PREMIUM_MODELS = {grok, kimi}` (opt-in only); `TIER_PREMIUM_PICK`
  T3 -> Grok (independent reviewer), T4 -> Kimi.
- `budgetPhase()` maps the running weekly spend against USD 5 to ok/warn(70%)/restrict(85%)/
  critical(95%)/exhausted (contract 11 thresholds).
- `selectModel()`: T0 -> no model; default -> cheapest capable within {mimo, glm} (T1 MiMo; T2/T3/T4
  GLM); premium opt-in -> the tier's premium pick; hard cap exhausted -> block all LLM (deterministic
  engines never blocked); premium held back at >=95%; unaffordable premium falls back to GLM; blocks
  when even the cheapest capable turn will not fit the remaining budget.
- **Flagged consequence (surfaced in `notes` + the architecture overlay): with premium off by default,
  the T3 dual-model independent review (Grok) is unavailable - default T3 runs single-model GLM with
  human approval.** Owner ruling needed: either T3 high-impact decisions auto-qualify for the Grok
  opt-in, or single-model T3 + human approval is accepted. Encoded literally for now (explicit opt-in).

### Verification

- `tsc --noEmit` clean; `eslint --max-warnings 0` clean.
- 14 new tests (budget phases, default routing per tier, premium opt-in, hard-cap block, premium
  hold-back at critical, unaffordable-premium fallback, cheapest-won't-fit block). Suite 319 -> 333 /
  37 files. AC04 floor 317 -> 331. AC08/AC08b/AC10/AC11 verified.

### Still gated (unchanged by these decisions)

- The live router (M4/M6), pricing service (M1), and everything server-side wait on the **OVHcloud VPS
  being provisioned** (D2) + the **OpenRouter key** (K4 fetch) + a **passing Phase-1 benchmark** before
  any live routing. This module is the offline policy core they will wire up.

---

## Phase 0 - Two-agent server tier authorized, contracts 06 + 12 authored (2026-08-06)

**Why.** `.kiro/steering/pfos-current.md` blocked this entire area three ways: its wall forbade any
server / bot / ingestion work outright, its benchmark precondition was circular (runtime work needs a
passing Phase-1 benchmark, which needs live calls the wall forbids), and the server runtime was an
open decision. The owner authorized `.kiro/steering/two-agent-vps.md`, which relocates the wall from
*the area* to *the network and secret boundary*, settles the runtime per agent, and carves out the
dev-key path for the benchmark. That file is now AUTHORITATIVE for the server / agent / bot /
ingestion / deployment area and takes precedence over `pfos-current.md` there only; `money-rules.md`
and `drive-db.md` are still overridden by nothing.

Steering §5 then forbids building in an area before its contract exists, and names the two that were
missing. Phase 0 authors both and reconciles the ledgers. **No code was written**, by design.

| Phase | Deliverable | Source | Status |
| ----- | ----------- | ------ | ------ |
| 0.1 | Steering authorization confirmed (`two-agent-vps.md` IN FORCE, owner-authorized) | owner | done |
| 0.2 | Contract 06 - Database & Knowledge Model, NIZAM-derived | steering §5; contract 02 §1/§2/§4/§5/§9; architecture brief §1.8/§1.10/§2.2 | done |
| 0.3 | Contract 12 - Two-Agent VPS Deployment & Operations, NIZAM-derived | steering §0b/§1/§2/§4/§5/§6/§7; architecture brief §1.2-§1.10, §2-§4, §6, §7; contract 02 §5/§8/§9/§10; contract 06 | done |
| 0.4 | PFOS index + this log reconciled so AC12 still agrees | this section | done |

### Work

- **`contracts/pfos/06_PFOS_Database_and_Knowledge_Model.md`** (34,327 bytes) - owns requirements
  R1-R5 and R6 jointly with contract 12. Store topology and per-agent isolation, the `finance.db`
  schema, the money persistence boundary (integer milliunits across the store edge - `money-rules.md`
  is not relaxed at the database), migrations, the token-spend ledger that will supply the already
  shipped `src/features/routing/modelPolicy.ts`, the knowledge model, retention, and an unconditional
  forbidden list. Hands `signals.db`, consent scopes, network binding and all backup / restore /
  disaster-recovery mechanics to contract 12 rather than duplicating them.
- **`contracts/pfos/12_PFOS_Two_Agent_VPS_Deployment_and_Operations.md`** (76,544 bytes) - owns
  R6-R24 (R6 jointly with 06; R16-R19 extend contracts 09/10/11 rather than replacing them).
  Two-agent topology on one host, isolation, the consent bus and the closed set of what may cross it,
  transport security and de-duplication, deployment-level routing governance, operations, the kill
  switch, the human gate register, and the public-repository posture.
- **Both carry a `PROVENANCE: NIZAM-DERIVED` banner in their first lines**, naming every input they
  were derived from and stating plainly that they were never authored upstream. Neither was ingested,
  so neither appears in `_INGESTION_MANIFEST.json` or `_INGESTION_MANIFEST_OPENROUTER.json` - that
  omission is deliberate and is recorded in the index. Unlike the ingested contracts no SHA is
  pinned for them: they live and evolve in this repository, so git history is their integrity record
  and a pinned hash would only go stale.
- **Public-repository posture honoured (steering §0b).** Neither contract contains a deployment
  particular - no real domain, address, storage identifier, numeric messaging user id, bot name, port
  assignment, or real monetary figure, not even as an example. Every such value is written
  `<ANGLE_BRACKET>` and resolves only from the host environment at run time.
- **`_PFOS_CONTRACT_INDEX.md` reconciled.** 06 removed from the "Absent contracts" table (which now
  reads 05, 07, 08 and states why 06 left); the OpenRouter section's closing line, which said 06
  "remains open", updated; and a new section registers 06 and 12 as NIZAM-derived and IN FORCE with
  their owning requirement ranges and scopes.
- **Filename reconciliation, recorded honestly.** The absent-contracts table had named the expected
  file `06_PFOS_Database_and_Knowledge_Model_Contract.md`. The authored file has no `_Contract`
  suffix. **The index row was corrected to the real filename; the file was not renamed.** The suffix
  came from the original request's naming rather than from any document (the index itself already
  records that "the numbering came from the request, not from the documents"), no other contract in
  the directory carries it, and both `.kiro/specs/06-two-agent-vps/tasks.md` and contract 12's source
  notes already cite the suffix-free name - renaming would have meant editing a spec and another
  contract to preserve a name that was never authoritative.

### Verification

- `npm run verify:all -- --all` - **17 of 19**. **AC12 (contract index and build log agree) PASS.**
- AC12 was confirmed by reading the checker rather than assumed: it reads
  `contracts/_CONTRACT_INDEX.md` and `contracts/_BUILD_LOG.md` - the **original five** build contracts
  - and **not** this PFOS track. It asserts exactly five contract rows there, so contracts 06 and 12
  were deliberately **not** added to that file; adding them would have broken the check. Those two
  files therefore needed no change and were left untouched. The PFOS index and this log are the
  PFOS-track ledger and are kept mutually consistent by hand, which is what this section does.
- The only red checks are **AC14 (working tree clean)** and **AC15 (push ready)**, both reporting the
  same four uncommitted Phase-0 entries. That is the expected mid-phase state of a documentation
  phase and was **not** resolved by committing - Phase 0 is not finished until the orchestrator ticks
  it. Every other check is green: AC16, AC10, AC01, AC07, AC08, AC08b, AC09, AC11, AC02, AC03, AC04,
  AC13, LOOP, AC05, AC05b, AC06, AC12.
- No source or test file changed, so the suite stays at 333 across 37 files and the AC04 floor stays
  at 331. Nothing in `scripts/verify/` was touched - no check was weakened, relaxed, or edited to
  make a gate pass.

### Still gated (unchanged by Phase 0)

- Authoring a contract authorizes **writing code behind an injected port with a deterministic mock**;
  it authorizes nothing on the network. The human gates stand: provision and harden the host, DNS,
  create the two bots, mint the two runtime keys with weekly caps, the storage consent click, webhook
  registration, and generate the encryption keypair with the private half kept off the box. G7
  (repo privatization) stays **closed as WONT-DO** per steering §0b - it is not to be re-raised.
- No outbound call from a server process and no production secret, unchanged.

---

## Phase 1 - Finance data layer built on contract 06 (2026-08-06)

**Why.** Phase 0 authored contract 06 and thereby authorized code in its area (steering §5). Phase 1
builds it: the finance agent's SQLite store, the repositories the Stage 1-4 engines will read and write
through, the integer-milliunit persistence boundary, and the token-spend ledger that feeds the
already-shipped `src/features/routing/modelPolicy.ts`. All of it is offline. Nothing here opens a
socket, reads a secret, or touches a gated item; the engine is the runtime's own built-in binding, so
the tier also adds no supply-chain surface to a store that holds financial facts (§2.2).

The organizing rule for the whole phase is contract 06 §9: "a test that has only ever been observed
passing is not evidence; each guard must be shown REFUSING the guarded operation." Every guard below
therefore has a negative case, and each refusal is also shown to have written **nothing**.

| Phase | Deliverable | Source | Status |
| ----- | ----------- | ------ | ------ |
| 1.1 | `src/server/db/` — schema, migrations, WAL + `foreign_keys=ON` with read-back assertions, idempotent versioning | contract 06 §2.2, §3, §5 | done |
| 1.2 | Repositories for accounts / transactions / obligations / decisions, reusing the browser tier's own types | contract 06 §3.2, §4.2, §8.1; contract 02 §4/§5/§6/§9 | done |
| 1.3 | Integer-milliunit boundary guard + the server/browser parity test + the §4.4 rate boundary | contract 06 §4.2, §4.3, §4.4 | done |
| 1.4 | Token-spend ledger keyed by agent; the weekly total as a pure function feeding `modelPolicy` | contract 06 §6 (R5), §6.3 | done |
| 1.5 | Negative guards: non-integer money refused at every write path, a re-run executes zero statements, a cross-agent open is refused | contract 06 §9 | done |

### What landed

**1.1 — the store and its engine contract.** `connection.ts` is the single factory (§2.2's last line):
it sets `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=FULL` and a busy timeout, then **reads each
one back** and refuses to hand out a store that cannot prove them — because a pragma that was set but
did not take is indistinguishable from one that was never set. `paths.ts` resolves the store path by
**containment rather than pattern matching**, so a traversal segment, an absolute override, and a
symlink out of the directory all fail one check with one typed error. `schema.ts` holds the DDL for the
sixteen contracted tables plus the monetary and rate column maps that the boundary guard reads, so the
guarded set cannot drift from the schema by being maintained twice. `migrations.ts` applies an ordered
append-only series, each migration in **one transaction with the `INSERT` of its own version row**,
skipping by recorded version and refusing on checksum mismatch. `errors.ts` gives every guard a typed
failure with a discriminating `code`, so a caller never has to match a message string.

**1.2 — the fact repositories.** `accounts`, `transactions`, `obligations`, `decisions`, each with the
narrow surface the engines actually need and no speculative width. Two contract rules are structural
rather than advisory here: **correction is by superseding row** (`supersede` appends, points at the
predecessor, bumps `audit_version`, and never edits the predecessor's facts), and **a suspected
duplicate is never auto-deleted** (there is no delete path at all; a suspicion is recorded in
`transaction_links` with a confidence in integer basis points and settled by an explicit resolution
that removes nothing). Migration 4 puts `BEFORE UPDATE` and `BEFORE DELETE` triggers on `decisions`, so
append-only holds for every path into the store and not only for callers who came through the module.
Every write records an `audit_log` row that names the columns it touched and **never an amount**.

**1.3 — one money implementation, and the §4.4 gap that this task found and closed.**
`moneyBoundary.ts` is the single guard: it rejects anything that is not a safe integer, throws a typed
error carrying the offending **field name on the object**, and runs **before the statement is
prepared**, so a rejected value never reaches SQLite. Its predicate is the money core's own `isMoney` —
this tier defines no arithmetic, no parsing, and no formatting of its own (§4.3 INVARIANT), and
`moneyImplementation.test.ts` proves that structurally by reading the source: the server tier imports
the money core, declares no member of its surface, and calls no member it did not import.
`moneyParity.test.ts` takes one shared input vector, runs the **real** Stage-1 and Stage-4 engines over
it in memory, persists the same facts through the repositories, reads them back, and asserts the second
result equals the first — so T11's guarantee cannot silently decay, and T7's `allocate` exactness is
shown to survive the round trip.

> **The §4.4 gap.** Contract 06 §4.4 requires a rate to be an integer numerator over an integer
> denominator applied through `mulRatio`, and says a row that cannot be expressed that way "is rejected
> at the boundary by the same guard as §4.2". The DDL already had the integer pair, so the schema looked
> compliant — but there was **no guard, no write path, and no test**: `fx_rates` had columns and nothing
> that could put a value in them, which meant the only way to write a rate was ad-hoc SQL that crossed
> no boundary at all. 1.3 closed it: `assertRatePair` (same predicate, same typed error, same position
> before `prepare`, plus the positive-denominator check the DDL also carries), a `fxRatesRepository`
> that keeps rate **history** rather than a cache so an old conversion stays re-derivable, and
> `toFxRate` which hands the stored pair to the browser tier's own `FxRate` type — the server does not
> convert currency with its own arithmetic, it hands the same integer pair to the same engine.

**1.4 — the token-spend ledger (R5).** `spendLedgerRepo.ts` appends one row per **completed** call,
keyed by agent, carrying the provider's **actual reported** cost in integer micro-USD. An estimate is a
compile error (`costSource` is a single-member literal), re-checked at run time, and refused a third
time by the table's own CHECK. There is no update path and no delete path, and the test scans the source
for both SQL verbs so append-only is a property of the file rather than a convention. The read model
`src/features/routing/spendLedger.ts` deliberately lives in the **routing** tier, not the server tier,
because §6.3 requires `weeklySpend` to serve `modelPolicy` "without dragging the store into the browser
tier" — the dependency arrow points server → routing, one way, and the file has no imports at all. Its
purity is mechanical rather than remembered: `Date` is never referenced (the week bucket is integer
calendar arithmetic), no statement or handle is named, and there is no cap literal anywhere — the cap is
injected, which is why §6.3 writes it as `<AGENT_WEEKLY_CAP_USD>`. `agentBudget.ts` is the seam that
feeds `selectModel` from that total, per agent, never aggregated.

**1.5 — the negative guards, and two contract-hygiene items closed.** `negativeGuards.test.ts` closes
the places where 1.1-1.3 asserted a guard's existence without exercising its refusal. It adds nothing
that an existing test already asserts:

- **The money guard is now shown refusing at every repository write path**, not only at the two
  (`decisions`, `fx_rates`) that had negative cases. §4.2.3's "guard before prepare" is a
  **per-call-site** property — a new write path can forget it without breaking any existing test — so
  each path carries its own refusal on record, including the UPDATE paths (`updateBalances`,
  `reviseAmounts`) and the correction path, where a refusal is additionally shown to leave the
  predecessor current rather than superseded by a row that does not exist.
- **A re-run is shown to execute zero statements**, which is the stronger half of §5.2.2. The existing
  T8 proves the schema is unchanged, but every real migration statement is written defensively
  (`IF NOT EXISTS`, §5.2.3), so a re-executed statement would be invisible to a schema comparison. The
  new case migrates a deliberately **non-idempotent** series twice: if the migrator executed a single
  statement of an already-applied migration, the second call would throw. A companion case shows stored
  rows surviving a re-run, so "no-op" covers data and not only DDL.
- **The symlink escape is exercised.** `paths.ts` documented containment and named the symlink case
  explicitly; nothing had tested it, so the module's strongest sentence was its only untested one. A
  directory link inside the agent's own data directory, pointing at a peer's, is now shown being
  refused — the shape a string check misses, because every segment of the requested path looks local.

### Two contract-hygiene items closed (recorded as ADDENDUM in contract 06 §3.2)

1. **`decisions.outcome` admitted a value that could never truthfully be assigned.** The applied DDL's
   CHECK includes `'superseded'`, but §8.1's append-only rule plus migration 4's triggers make it
   impossible to ever put that value on the row it would describe: the predecessor of a supersede is
   never touched, so currentness is **derived** (`NOT EXISTS (successor)`), not stored. §3.2's column
   vocabulary and §8.1 therefore disagreed, and the member was reachable only by a caller
   self-declaring it — a row whose `outcome` asserts a lineage its lineage columns do not support.
   **Resolved by refusing the assignment, not by changing the DDL:** narrowing the CHECK in place would
   move a recorded checksum on an already-applied migration, which §5.1 forbids and §5.2.5's guard would
   refuse; rebuilding the table would be destructive DDL against history (§5.3) for no gain. The insert
   type is narrowed to the assignable subset (a compile error) and the write path throws
   `REPOSITORY_DERIVED_STATE_NOT_ASSIGNABLE` (a run-time refusal). **Reads still accept the full enum**,
   because a hand-repaired store may hold the value and refusing to read history fixes nothing. Recorded
   as ADDENDUM A1 with a new acceptance test **T18**.
2. **`DecisionOutcome` meant two unrelated things.** The browser tier's `DecisionOutcome` (contract 03
   §12) is an observed-outcome **record** — review date, actual net effect, prediction error,
   attribution. The server tier's was this section's small state **enum**. No file imported both, so it
   was never a bug; it was a trap for the first module that needed both, and exactly the collision that
   produces a wrong-but-compiling import. The **server** identifier was renamed to
   `DecisionOutcomeState` (`DECISION_OUTCOME_STATES`, plus `ASSIGNABLE_DECISION_OUTCOME_STATES`); the
   shipped browser tier is untouched, because it is named correctly for what it holds. No DDL, no stored
   value, and no migration checksum moves. Recorded as ADDENDUM A2.

### The acceptance tests of §9, and where each one lives

| # | Test | Where |
| - | ---- | ----- |
| T1 | WAL and `foreign_keys=ON` read back, and a store that cannot prove them is refused | `src/server/db/connection.test.ts` |
| T2 | A path outside the configured data directory is a typed error — relative escape, absolute override, missing directory, and (1.5) a **symlink** escape | `connection.test.ts`, `negativeGuards.test.ts` |
| T3 | No cross-database open statement anywhere in `src/server/**` (source scan; the keyword is assembled from fragments so the scanner never matches itself) | `src/server/db/isolation.test.ts` |
| T4 | A real foreign-key violation is rejected, proving the pragma took effect | `connection.test.ts` |
| T5 | A non-integer monetary value is refused with a typed error naming the field, and nothing is written — at **every** write path, and in the §4.4 rate form | `decisionsRepository.test.ts`, `fxRatesRepository.test.ts`, `negativeGuards.test.ts` |
| T6 | Every monetary column round-trips as the exact integer, and a nullable column stays null rather than reading as zero | `accountsRepository.test.ts`, `transactionsRepository.test.ts`, `obligationsRepository.test.ts`, `decisionsRepository.test.ts` |
| T7 | `allocate` parts, persisted and re-read, still sum exactly to the original total | `src/server/db/moneyParity.test.ts` |
| T8 | A second migrate applies zero migrations, changes no schema, executes **zero statements**, and preserves stored rows | `migrations.test.ts`, `negativeGuards.test.ts` |
| T9 | A migration failing mid-way leaves neither the schema change nor its version row | `migrations.test.ts` |
| T10 | An edited already-applied migration is refused on checksum mismatch, totally | `migrations.test.ts` |
| T11 | A shared input vector produces identical results through the server path and the browser path, using the real engines | `moneyParity.test.ts` |
| T12 | The server tier imports the money core and declares no arithmetic of its own (source scan) | `moneyImplementation.test.ts` |
| T13 | `weeklySpend` is pure — no clock, no store, no ambient state; proven by source scan **and** by running it with the clock and randomness trapped | `src/features/routing/spendLedger.test.ts` |
| T14 | Actual reported cost is what lands in the ledger; an estimate never does | `src/server/db/spendLedgerRepo.test.ts` |
| T15 | Exhausting one agent's weekly total refuses that agent and leaves the other unaffected | `spendLedgerRepo.test.ts`, `src/features/routing/agentBudget.test.ts` |
| T18 | A caller cannot assign the derived `superseded` outcome; refused with a typed error, nothing written, and the value still readable | `negativeGuards.test.ts` |

T16 (telemetry rejects prompt text) belongs to the telemetry store, which is Phase 5.3. T17 (no
deployment particular in a tracked file) is the harness check that task 9.0 owns.

### Verification

- `npm run typecheck` 0 errors; `npm run lint` 0 warnings at `--max-warnings 0`.
- Suite **333 → 531 across 37 → 51 files**: 1.1 +25 (connection 13, isolation 4, migrations 8),
  1.2 +57 (accounts 10, transactions 10, obligations 11, decisions 26), 1.3 +23 (parity 8,
  one-implementation 6, fx rates 9), 1.4 +69 (ledger repository 23, pure read model 37, per-agent
  budget 9), 1.5 +24 (negative guards). Every figure in every fixture is synthetic.
- `npm run verify:all -- --all` — **17 of 19**, with **AC12 (contract index and build log agree) PASS**,
  confirmed after editing this log rather than assumed: AC12 reads `contracts/_CONTRACT_INDEX.md` and
  `contracts/_BUILD_LOG.md` — the **original five** build contracts — and not this PFOS track, so
  appending here cannot move it. The only red checks are **AC14 (working tree clean)** and **AC15 (push
  ready)**, both reporting the same uncommitted Phase-1 work. That is the expected mid-phase state; the
  orchestrator commits at phase end.
- The AC04 floor stays at **331**. Ratcheting it is task 9.1's, and raising it here would have taken a
  decision that belongs to close-out.
- Nothing in `scripts/verify/` was touched. No check was weakened, relaxed, or edited to make a gate
  pass, and no DDL statement in an applied migration was altered.

### Known gaps, recorded honestly because they are real and unclosed

1. **`statements`, `assets`, and `valuations` declare monetary columns but have no repository.** They
   are in `MONETARY_COLUMNS`, so the guard knows about them, but nothing can currently write them
   *through* the guard — they are reachable only by ad-hoc SQL, which crosses no boundary. No task in
   `.kiro/specs/06-two-agent-vps/tasks.md` claims them today. Until one does, the §4.2 boundary is
   complete for every table that has a write path and absent for three that do not.
2. **§2.1.5 (local filesystem only, no network or synchronizing filesystem) has no in-process test, by
   design.** A process cannot verify that its own mount is not sync-mediated; the check is a property of
   the host, so it is carried by contract 12 and the ops gate register rather than pretended here. The
   same is true of contract 12 §3.2.1's second isolation belt — the peer's volume is not in this
   process's mount namespace at all. Phase 1 tests the **application** belt (a typed error) and
   documents the ops belt rather than simulating it.
3. **"The guard runs before prepare" is asserted behaviourally, per call site, not made mechanical by
   any single module.** Each repository proves it by refusing and then showing the table and the audit
   log unchanged; nothing structurally prevents a future write path from preparing first. A source-level
   assertion (every `prepare` in a repository is preceded by the guard for its table) would close it and
   is not written.

### Still gated (unchanged by Phase 1)

- Building behind an injected port with a deterministic mock is authorized; nothing on the network is.
  The human gates stand: provision and harden the host, DNS, create the two bots, mint the two runtime
  keys with weekly caps, the storage consent click, webhook registration, and generate the encryption
  keypair with the private half kept off the box. G7 stays **closed as WONT-DO** per steering §0b.
- No outbound call from a server process and no production secret, unchanged.

---

## Phase 2 - Ports and mocks, and the boundary that keeps them out of the browser (2026-08-07)

**Why.** Steering §2 relocated the wall from *the area* to *the network and secret boundary*, and the
thing that makes that relocation real rather than rhetorical is the phrase it turns on: work is
authorized when it sits **behind an injected port with a deterministic mock**. Design key decision 1
says the same in build terms — every external boundary (Telegram, OpenRouter, Drive, WHOOP, bus) is an
injected interface with a deterministic mock, and that is what makes the whole tier buildable and
testable with no host and no secret. Phase 2 builds exactly that boundary and nothing behind it. Every
live half stays gated (G3-G6).

The organizing rule for the phase is narrower than "declare the interfaces", and it is where the work
actually went: **a runtime filter is code, and code can be bypassed, mis-ordered, disabled under load,
or forgotten at a new call site, and its failure mode is silent leakage that looks like success.** So
each forbidden shape here is made **inexpressible** rather than merely rejected. The compiler is the
first belt; Phase 3's validation is the second. Where that could not be done in the type system it is
said so plainly below.

| Phase | Deliverable | Source | Status |
| ----- | ----------- | ------ | ------ |
| 2.1 | `src/server/ports/` — five interfaces plus the shape guards, the failure vocabulary, and a barrel. Interfaces only | contract 12 §4, §5, §6, §7; steering §2; design key decision 1 | done |
| 2.2 | `src/server/mocks/` — one deterministic mock per port, an invocation recorder, and a recorded-fixture loader | contract 12 §6.1; steering §3; design key decision 1 | done |
| 2.3 | `src/server/**` asserted absent from the browser bundle, by extending the existing isolation check | design §"must never be imported"; steering §7 | done |

### What landed

**2.1 — five interfaces, and the forbidden shape made inexpressible.** `telegram.ts`,
`openrouter.ts`, `drive.ts`, `whoop.ts`, `signalBus.ts`, plus `shapeGuards.ts` (three type-level
helpers, no runtime export at all), `errors.ts` (the failure vocabulary — a shape, deliberately with
no class, because this phase ships no implementation) and `index.ts`. **No network module, no request
primitive, no endpoint literal, no secret-shaped literal, and no implementation construct**: every
address, token, allowlist and identifier is an injected field on a `*Config` interface with no default,
because an unset value must be a startup failure and never a guess (steering §0b, R24).

What each boundary makes impossible to write down:

- **`SignalBusPort`** — four mechanisms against one clause each of §4.3. `NoMagnitude` types any
  numeric field `never`, so a figure added to a payload later becomes uninhabitable and fails to
  compile. The payload key set is exactly `level` / `direction` / `note`, so a due date or an account
  reference is not a forbidden *value* — it is a key the type does not have.
  `Exact<SignalPayload, P>` closes TypeScript's fresh-literal-only excess-property hole, without which
  the first two rules would be decorative (a producer could assign `balance` to a variable and pass).
  And `note` is a branded `SignalNote`, so a raw `string` cannot reach the field at all, let alone 121
  characters of it; Phase 3's validator is the only mint. Two absences are as deliberate: no `update`
  and no `delete` (a correction is another publish), and no member returning a quarantined invalid
  signal, which would be precisely the leak the schema prevents.
- **`OpenRouterPort`** — `privacy` is a **required** field of the request, so "every request carries
  the provider policy" is a property of the type rather than a habit; and within it
  `training: 'excluded'` and `dataCollectingProviders: 'denied'` are **single-member literals**, so
  there is no value meaning "training allowed". `tier` is `Exclude<Tier, 'T0'>`, so a request on the
  no-model tier does not type-check (R16) — a stronger statement than a runtime branch that happens
  not to be taken. `ModelCallTelemetry` is wrapped in `Redacted<>`, so a content-bearing key cannot
  hold a string and the R19 redaction is a property of the schema rather than of a formatting string
  someone will eventually edit.
- **`TelegramPort`** — three separate roles, and `inbound.accept()` is **synchronous**. It returns a
  decision, not a promise, so slow work before the acknowledgement cannot be written without blocking
  the process outright (R15, §5.5). `DedupKey` has two required fields, so a store keyed on the update
  identifier alone does not satisfy the type — which is the R14 collision, and its failure mode is one
  bot silently going quiet. And the `rejected` decision **has no reason field**, because §5.2 requires
  the response to reveal nothing about which check failed and the cheapest way to honour that is to
  leave nowhere to put it; the audit is a separate path with its own record.
- **`DrivePort`** — no generic `upload`, no `putFile`, and **no download member at all**: §7.2 runs
  the restore drill off the host with the key that only exists off the host, so giving this port a read
  path would give the host the ability to decrypt what it was designed not to be able to decrypt.
  `plaintextShredded: true`, `containsSecrets: false`, `source: 'engine_snapshot'` and
  `privateKeyPresentOnHost: false` are **literals, not booleans**, so an unshredded plaintext, a
  secret-bearing payload, a file copy passed off as a snapshot, and a host-resident private key are
  each not expressible (R20).
- **`WhoopPort`** — deliberately poorer than the upstream provider's API. `NoMagnitude` again, a band
  enum rather than a score, no member returning a raw sample or series, and `unavailable` as a
  **first-class outcome** rather than an exception or a substituted value — so a downed source can
  never be silently reported as `high`.

Verified by **18 tests** in one file: a **source scan** (no network or process module, no request
primitive, no endpoint literal, no secret-shaped literal, no implementation construct — every
forbidden token assembled from fragments so the scanner never matches itself), a behavioural check
that every runtime export is inert rather than callable, and **compile-time negatives** checked by
`tsc` rather than by the runner — eleven `@ts-expect-error` directives across six negative cases,
each of which fails the typecheck if its forbidden shape ever becomes expressible.

**2.2 — the mocks, and why they are a SIBLING of `ports/` rather than a child.**
`ports/interfaceOnly.test.ts` computes its scan root from its own location and recurses into every
subdirectory. A mock placed under `src/server/ports/mocks/` would therefore be scanned as a
declaration file and reported for containing a function, an arrow, a class, a constructor and a
return — **correctly, because that is exactly what a mock is.** The response was to move the
implementations out of the tree that promises to hold none, not to widen the promise. Recorded here
because the alternative (relaxing the assertion) is the tempting one and would have cost 2.1 its
strength.

- **Five deterministic mocks**, each able to drive its port's declared failure paths, so Phases 3/4/5
  have their negative tests available without a live boundary: the Telegram mock can fail closed on an
  absent or empty expected token, refuse a non-allowlisted sender without distinguishing which check
  fired, answer `duplicate` without an error, process a cross-bot identifier collision as two
  legitimate updates, fail an enqueue, and retry or abandon in the worker; the WHOOP mock can return
  each unavailability reason *and* throw the two codes its boundary declares, so a caller that treats
  a throw and an outcome differently is testable both ways; the Drive mock can present the unusable
  grant §7.1 documents and a verification mismatch that says which property disagreed; the bus and
  model mocks reject invalid envelopes and ineligible or unavailable models respectively. All five
  reject with **one** `MockPortFailure` class carrying only a `code` and a correlation reference — no
  field for a prompt, a completion, an amount, or the name of the failed check.
- **An invocation recorder**, because §6.1 states the acceptance shape directly ("assert against a
  port mock that records invocations, then assert the record is empty") and an absence is only
  observable if something was watching. Its `detail` is **scalars only**, with every content-bearing
  key typed `never` off the port tier's own `ContentBearingKey` list — so recording a prompt is a
  compile error rather than a review comment — and `isEmpty()` is the R16 assertion in one call. No
  clock, no randomness: `seq` starts at one, so two runs of the same script hold byte-identical logs.
- **A recorded-fixture loader** for steering §3 (when the dev key is absent or exhausted the harness
  runs against fixtures). `loadRecordedInteractions` **performs no I/O itself** — it takes an injected
  `FixtureSource`, and `nodeFixtureSource` is the one filesystem-touching function in the directory
  and is never called by default. A fixture-backed run is marked `provisional: true` **as a literal
  type**, the same technique as `plaintextShredded`, so there is no value meaning "fixture-backed but
  authoritative" and §3's rule (a provisional registry may never promote a model) cannot be lost by an
  assignment. And before anything is parsed, the **raw text** is scanned for a deployment particular —
  endpoint, host address, bare domain, long numeric identifier, two-decimal monetary figure, recipient
  or provider key literal, storage identifier field — and any match **refuses the whole fixture**. It
  fails closed on purpose: a fixture is exactly the file where anonymized real data would look
  harmless and would not be. That scan **pre-satisfies task 9.0 at the fixture boundary**; 9.0 still
  owns the gate-level check.

**2.3 — extended AC08b rather than adding a twentieth check** (see the constraint below), asserting
**both directions, because they fail differently**:

- **SOURCE** — nothing reachable from the browser entry seeds imports `src/server/**`, *and* no
  browser-side module imports it even if the router has not wired it up yet, because wiring it up
  later would be a one-line change this check would then have to catch after the fact.
- **OUTPUT** — five server-only probes appear nowhere in any text asset under `dist/`, which catches a
  path the source walk cannot see: a bundler alias, a plugin injection. The probes are **string-literal
  contents** — trigger names, a column name inside DDL text, typed error codes — so minification and
  identifier mangling preserve them verbatim, which is not true of a class or function name.

Its own integrity is checked before it looks at anything: **every probe must still exist in the tier
and be absent from every other file under `src/`**, so a probe that rots into a false negative or
drifts into ambiguity surfaces as a *harness failure* rather than as silence. And it **fails closed**
on a missing `dist`, a `dist` with no script asset, an empty tier, an empty probe list, a missing entry
seed, or a file it could not read — a scanner that passes vacuously is worse than no scanner. The
negative test was demonstrated in both directions (an import from the tier into browser source; a
probe planted in built output) and then removed.

### Verification

- `npm run typecheck` 0 errors; `npm run lint` 0 warnings at `--max-warnings 0`.
- Suite **531 → 685 across 51 → 60 files**: 2.1 **+18** (`ports/interfaceOnly.test.ts`), 2.3 **+0**
  (an extension to an existing harness check, which the harness runs rather than vitest), 2.2 **+136**
  (fixture loader 28, signal bus 27, telegram 18, openrouter 17, drive 13, determinism 12, whoop 11,
  invocation recorder 10). Every figure in every fixture is synthetic.
- `npm run verify:all -- --all` — **17 of 19**, with **AC12 (contract index and build log agree) PASS**,
  confirmed after editing this log rather than assumed: AC12 reads `contracts/_CONTRACT_INDEX.md` and
  `contracts/_BUILD_LOG.md` — the **original five** build contracts — and not this PFOS track, so
  appending here cannot move it. The only red checks are **AC14 (working tree clean)** and **AC15 (push
  ready)**, both reporting the same uncommitted Phase-2 work. That is the expected mid-phase state; the
  orchestrator commits at phase end.
- The AC04 floor stays at **331**. Ratcheting it is task 9.1's, and raising it here would take a
  decision that belongs to close-out.
- Nothing in `scripts/verify/` was weakened. AC08b was **extended**, and every assertion it already
  made is intact.

### Known constraint, recorded because Phase 9 will hit it

**Four tracked documents assert that the harness prints "19 of 19"**:
`.kiro/steering/pfos-current.md`, `docs/KIRO_HANDOFF.md`, `docs/KIRO_ONBOARDING.md`, and
`RELEASE_CHECKLIST.md`. (A fifth, `docs/PFOS_CONTRACT_INGESTION_REPORT.md`, records a past run at that
count rather than asserting a current one.) `KIRO_HANDOFF.md` goes further and instructs the next agent
to **stop and report** if the count is not 19. That is **why 2.3 extended AC08b instead of adding a
check**: a twentieth check would have made the documented gate figure wrong the moment it landed, and
the first thing the next session is told to do is treat that as a stop condition.

**Task 9.0 must add a fail-closed no-deployment-particular check**, so it inherits an open decision it
should take deliberately rather than discover:

1. **extend an existing check** again (cheapest, keeps the count at 19, but loads a second unrelated
   assertion onto a check whose name already covers two boundaries); or
2. **add a twentieth check AND update those four documents in the same increment**, so the gate figure
   and the documents never disagree even transiently.

Option 2 is the more honest one and is the recommendation, but it is a close-out decision and is left
to 9.0 rather than pre-empted here.

### Known gaps, recorded honestly because they are real and unclosed

1. **`NoMagnitude` and `Redacted` are trip-wires, not proofs of current cleanliness.** Today they
   resolve to their argument unchanged, because no numeric or content-bearing field exists on the
   guarded shapes. Their value is entirely prospective: they make a *future* addition fail to compile.
   A test cannot observe them doing anything today beyond the `@ts-expect-error` negatives, which is
   why those negatives are load-bearing rather than decorative.
2. **The branded `SignalNote` has no mint, so the `note` field is currently unreachable by anyone.**
   That is correct for this phase — Phase 3's validator owns the only mint — but it means the note path
   is type-checked and entirely unexercised until 3.1 lands.
3. **`errors.ts` declares the failure shape and ships no class**, so the ports tier cannot throw its
   own failure. `mocks/failure.ts` supplies the only thrower. A real adapter (gated) will need one of
   its own, and nothing structurally guarantees it will discriminate on the same `code` vocabulary
   rather than inventing a parallel one.
4. **The `dist/` half of 2.3 is only as current as the last build.** The check fails closed if `dist`
   is missing, but a stale `dist` that predates a bundling regression would pass. `npm run build`
   precedes the harness in the documented loop; nothing enforces that ordering inside the check itself.
5. **2.2's fixture scan and 9.0's gate scan are two implementations of one rule.** The loader's
   pattern list and the harness check task 9.0 will add can drift apart. 9.0 should either share the
   list or assert the two agree; today neither is done.

### Still gated (unchanged by Phase 2)

- Building behind an injected port with a deterministic mock is authorized; **nothing on the network
  is, and this phase built no live half of any boundary.** The human gates stand: provision and harden
  the host, DNS, create the two bots, mint the two runtime keys with weekly caps, the storage consent
  click, webhook registration, and generate the encryption keypair with the private half kept off the
  box. G7 stays **closed as WONT-DO** per steering §0b.
- No outbound call from a server process and no production secret, unchanged.
