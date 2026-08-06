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
