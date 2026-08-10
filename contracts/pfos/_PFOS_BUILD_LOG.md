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

---

## Phase 3 - The signal bus and the consent boundary (2026-08-07)

**Why.** Steering §4.3 is the sentence the whole two-agent design earns its keep on: *the state
crosses, the data never does.* Phase 3 builds the only channel between the two agents and makes that
sentence mechanical. Contract 12 §4.3 states the mechanism and names the failure mode it is chosen
against: **a runtime filter is code, and code can be bypassed, mis-ordered, disabled under load, or
forgotten at a new call site, and its failure mode is silent leakage that looks like success.** A
schema with no such field cannot carry the value at all, and its failure mode is a loud validation
error at the producer before anything is stored. So the boundary here is **consent by absence** — the
field does not exist — and every negative test asserts a refusal that also wrote nothing.

| Phase | Deliverable | Source | Status |
| ----- | ----------- | ------ | ------ |
| 3.1 | Vendored envelope schema + `envelopeValidation.ts`: the four §4.3 mechanisms, the sole `SignalNote` mint, the sealing digest, and a read path that re-validates | contract 12 §4.2, §4.3; steering §4.3 | done |
| 3.2 | `consentGate.ts`: the five §4.5 rules, the tier gate, and the §4.6 layer-4 de-identification claims about the gate's OUTPUT | contract 12 §4.5, §4.6 | done |
| 3.3 | `signalStore.ts` + `signalStoreSchema.ts`: append-only at the engine with an audit mirror; `ops/BUS_NETWORK_BINDING.md` for the R9 network half | contract 12 §4.1, §2.2.5, §2.2.6 | done |
| 3.4 | The R10 exclusion scan, the coverage audit of the other three negatives, and this section | contract 12 §4.4.3, §4.4.5 | done |

### The consent-by-absence argument, and the four §4.3 mechanisms it decomposes into

§4.3 is not one rule but four that only work together, and the fourth is what keeps the first three
from being decorative:

1. **No numeric field of any kind in the payload.** A level is an enum, not a magnitude. Enforced at
   the type level by Phase 2.1's `NoMagnitude`, in the vendored JSON document by typing no payload
   field `number` or `integer`, and at run time by `field_numeric` — including the case that reads as
   a member mismatch but is not: a **permitted** key handed a magnitude (`payload.level = 2`) refuses
   as `field_numeric`, at `payload.level`.
2. **No temporal field other than the envelope's own `ts`.** Refused by name *and* by value, so
   `dueDate: 'soon'` and `observed: '2026-09-01'` both fail as `field_temporal`. A due date cannot be
   expressed.
3. **No identifier field.** No account, transaction, document, or storage reference —
   `field_identifier`.
4. **`additionalProperties` false at every level, and the note capped by the schema.** Without the
   closed level the first three are theatre: a producer could add `balance` and pass. An unrecognized
   field with no telling name (`colour: 'teal'`) refuses as `field_unrecognized`. And an over-cap note
   is **refused, never truncated**, because truncation would silently ship the first 120 characters of
   something that was never allowed to leave.

Two absences carry as much weight as the four presences. **A refusal retains no refused value**
(§4.3.6): `SignalRefusal` has no `value`, no `payload`, no `received` — it carries the reason, the
path, the producer's own identifier, and the *length* of a note. There is no quarantine table, because
that table would be exactly the leak the schema prevents. And the rules are re-run **on read**, from
the stored row, every read: the digest covers `ts | producer | kind | payload` and therefore does *not*
cover `tier` or `consent_scope`, so integrity cannot substitute for the gate, and a row a widened
schema once accepted is still refused today.

### What landed

**3.1 — the schema, the validator, and the mint Phase 2 left open.** `nizam-signalbus.envelope.schema.json`
is the one artifact the two agents share (steering §1); `envelopeSchema.ts` is this agent's mirror, and
`schemaParity.test.ts` reads the JSON document **as text from disk** and fails if the two ever drift —
because two statements of the same rules in two languages is exactly the shape where one moves and the
other does not, and the consequence would be this agent accepting an envelope the Python agent rejects.
The parity scan fails closed: a missing document, an unparseable one, an object level with no closing
keyword, or a `$defs` entry the walk did not reach are all failures.

`envelopeValidation.ts` **became the sole mint for `SignalNote`, which Phase 2 recorded as an open
gap** ("the branded `SignalNote` has no mint, so the `note` field is currently unreachable by anyone").
It is now reachable through exactly one function, and the test proves the bypass is a compile error:
a raw `string` is not assignable to the branded field. That is what makes §4.3.4 structural rather than
advisory — 121 characters cannot reach the field, because no unvalidated string can.

**3.2 — the consent gate, with each of the five §4.5 rules given its own mechanism.** Rule 1 (the
refusal happens at the **bus**, not the subscriber) is a brand: a stored envelope is not a served
envelope until the gate says so, so a subscriber deciding for itself is a compile error rather than a
review comment. Rule 2 (a refusal is not an empty result) is a discriminated outcome with **no
`signals` key on the refusal**, and the gate refuses the **whole read** rather than quietly shortening
the delivered list — dropping the denied row and returning the rest is precisely the indistinguishable
empty-ish answer the rule forbids. Rule 3 (`producer_only` is the default for a new kind) is asserted
by **iterating `SIGNAL_KINDS`**, so a kind added tomorrow is covered on the day it is added, and
covered as closed; the shipped widening allowlist is empty, and the gate takes the *narrower* of the
stored scope and the kind default so a stray `shared` widens nothing. Rule 4 (evaluated on read, every
read) is proved three ways: a source scan for module-level mutable state, a map, a memo or a cache; two
reads returning different answers when the stored row changes between them; and a getter-instrumented
row showing `consentScope` is re-read on the second call. Rule 5 (tier and scope are independent) is
walked across the whole four-row truth table.

Beside the five rules, `deidentificationBreaches` is an **independent derivation** asserted about what
the gate actually delivers (§4.6 layer 4), and it earns its independence by catching something read
validation accepts: a bare calendar date is a legal signal identifier as far as the envelope schema is
concerned — a non-empty string within bound — and it is still a date crossing the boundary.

**3.3 — append-only at the engine, and one duplicate validator collapsed.** `signals.db` is its own
migration series with its own bookkeeping, and append-only is enforced by `BEFORE UPDATE` and
`BEFORE DELETE` triggers on **both** `signals` and the `signal_audit` mirror, so every path is bound
and not only callers who came through the module — an editable audit trail is not one. A correction is
a new row. The audit mirror records the accept **and** the refusal, naming the rule that fired and
measuring a note's length rather than copying it, and `AUDIT_FORBIDDEN_COLUMNS` is asserted against the
live `table_info` so the absence of a quarantine column is a property of the shipped table.

> **`signalBusMock` lost its duplicate validation and deliberately KEPT its own digest.** Phase 2.2
> shipped its own copy of the permitted payload keys, its own instant pattern and its own inline field
> checks, because the real validator did not exist; its docstring recorded that Phase 3 owned the real
> one. 3.3 collapsed all of it onto `validateSignalDraft`, so there is one vocabulary, one note cap,
> one enum set and one field classifier, and the mock cannot drift from the bus. Two checks stayed,
> because neither is a property of the *envelope*: the duplicate-identifier check and the consent
> policy. **The mock's `hash` stays a 32-bit FNV-1a rendered as eight hex digits.** The real digest is
> a sha256, 64 characters wide, and Phase 2.2's determinism and receipt tests **pin the
> eight-character form**. Pointing the mock at the real digest would break tests that are asserting
> something true, for no gain: a *mock* integrity claim only has to be stable across runs and
> sensitive to the payload, which FNV-1a is. The real digest belongs to the real store, and that is
> where it lives.

`ops/BUS_NETWORK_BINDING.md` is the **R9 documentation half**, and it is a *requirement*, not an
artifact: nothing in it is executed, and it carries `<ANGLE_BRACKET>` placeholders only. It exists
because R9 cannot be tested in-process — §2.2.6 requires reaching the bus from outside to fail as a
**connection refusal at the network layer**, not as an authentication check that denies a reachable
port, and an authenticated-but-reachable bus is a weaker guarantee that does not satisfy R9 on its own.
**Phase 7 must honour it**: tasks 7.1 (`ops/docker-compose.yml`) and 7.2 (`ops/Caddyfile`) are the
artifacts it binds, and it states the constraint they are checked against so they cannot be authored in
a way that quietly violates R9 and passes review anyway.

**3.4 — the exclusion scan, which is the one §4.4 claim nothing asserted.** §4.4 makes a claim
stronger than "the bus rejects it", and states five things. Four were already carried: §4.4.1 (not a
member of the tier enum) by `schemaParity`, `envelopeValidation` and Phase 2's port and mock tests;
§4.4.2 (not stored) by the store's DDL assertions and contract 06 §3.4/§7.2; §4.4.4 (not transmitted)
by §4.4.1, since the tier enum is the only channel. **§4.4.3 — it is not REFERENCED — and §4.4.5 — the
posture is exclusion, not filtering — were the gap**, and 3.2 explicitly left them here.

`signals/exclusion.test.ts` scans **four roots, discovered from disk rather than from a list**, so an
artifact added tomorrow is covered on the day it lands: `src/server/**` (source, fixtures), `ops/**`
(templates, runbooks, the gate register, Phase 7's backup manifests), `src/features/benchmark/**` (eval
cases, which Phase 6.1 completes there), and `src/features/routing/**` (the read-model half of the tier
that lives outside `src/server`). That is every artifact kind §4.4.3 enumerates **except a log**, and
this tier has no tracked log — a log is runtime output on a host that does not exist — so that is
recorded as a gap rather than papered over, and the scan additionally asserts no `.log` file has
appeared under a scanned root.

Three assertions, and each has a distinct failure it catches:

- **The name appears nowhere**, in code or in prose, in any artifact under any root. Comments are in
  scope, because a comment that names the thing is a reference. Two of the three tokens are the other
  repository's **family-domain path** rather than the classification name, because §4.4.3 binds
  "points at" exactly as tightly as it binds "names" — an artifact could point at the content without
  ever naming its class.
- **Nor in assembled form, in anything that is not a refusal test.** The scan collapses adjacent
  string-literal concatenation before matching, so it sees through the very fragment technique every
  scanner here uses. 3.2 asserted this for one module; 3.4 generalizes it to every non-test artifact
  in the tier, `ops/**` included.
- **The set of files that name it at all is exactly the enumerated refusal tests, checked in both
  directions.** This is §4.4.5 made mechanical: an unlisted file naming it is a new reference, and a
  **listed file that stopped naming it is a refusal test that quietly went away**. The check found two
  files 3.4 had not anticipated — `ports/interfaceOnly.test.ts` (2.1) and `mocks/signalBusMock.test.ts`
  (2.2) — both legitimate refusal tests, which is the two-directional check doing its job on its first
  run.

**The exception was handled by reading the rule, not by widening it.** Five documents name the
classification contiguously: contracts 06 and 12, `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md`,
`.kiro/steering/two-agent-vps.md`, and this spec's `requirements.md`. They are out of scope **and not
by exemption**: §4.4.3 enumerates the artifact kinds it binds — source, template, fixture, eval case,
log, backup manifest, runbook — and a governing document is none of them. A contract, a steering file
and a requirements document are the instruments that *forbid* the thing, and a prohibition that could
not be written down would be unenforceable. No carve-out was added; those files simply are not
artifacts in the tier, and no scanned root holds one.

The scan **fails closed**: a missing root, an empty root, a shortened collection, an allowlist entry
that is not on disk, a coverage set missing an artifact kind, or a needle that cannot match are all
failures. Two of those are load-bearing rather than ceremonial — a needle self-test proves each regex
matches a planted token and rejects a clean line, and a fragment-assembly self-test proves the
collapse step works, because without them the three assertions above could be green from a malformed
pattern. The **planted-reference negative was demonstrated twice and removed both times**: a
contiguous name in `src/server/signals/index.ts` failed three assertions at once
(`src/server/signals/index.ts:99 (the excluded tier name)`, the same line again in assembled form, and
the file appearing in the naming set); the pointer form planted in `ops/BUS_NETWORK_BINDING.md` failed
the same three, reporting all four token/shape combinations at `ops/BUS_NETWORK_BINDING.md:103`.

**3.4 also strengthened one existing claim rather than restating it.** R7 and steering §4.3.3 both name
the number — "any free text over **120** characters" — and **nothing pinned it**. Every assertion about
the cap, in `envelopeValidation.test.ts`, `schemaParity.test.ts`, the store's DDL check and the gate's
output claims, is expressed *relative to* `SIGNAL_NOTE_MAX_LENGTH`. Raising that constant to 500 would
have kept all of them green while violating R7 outright. One assertion in
`envelopeValidation.test.ts` now writes the requirement's own number down, which is what makes the
relative ones load-bearing. Nothing else was added: the other three negatives this task nominally owned
were audited against the requirements and found already asserted, so 3.4 added no test that duplicates
one.

### The acceptance tests of §12, and where each one lives

| # | Test | Where |
| - | ---- | ----- |
| T7 | A valid directional signal is accepted and served as a level — the positive control, first on purpose | `signals/envelopeValidation.test.ts`, `signals/consentGate.test.ts` |
| T8 | A payload carrying a figure is rejected and stores nothing, including a **permitted** key handed a magnitude | `envelopeValidation.test.ts`, `signalStore.test.ts` |
| T9 | A date and an identifier are each rejected individually, by name **and** by value | `envelopeValidation.test.ts` |
| T10 | A note over the cap is rejected, **not truncated**; at the cap accepted; no shortened form returned or persisted; and the cap is the 120 the requirement names | `envelopeValidation.test.ts`, `signalStore.test.ts` |
| T11 | An unrecognized payload field is rejected, with no telling name needed | `envelopeValidation.test.ts` |
| T12 | A `producer_only` signal is refused to a subscriber, from the bus, distinguishably from "no such signal" | `consentGate.test.ts` (rules 1 and 2) |
| T13 | Tier and scope are independent gates, walked across the full truth table | `consentGate.test.ts` (rule 5) |
| T14 | A new kind defaults to `producer_only`, asserted by iterating the enum so a future kind is covered on arrival | `consentGate.test.ts` (rule 3) |
| T15 | The excluded classification cannot be expressed here **and no artifact in the tier references it** | `schemaParity.test.ts`, `envelopeValidation.test.ts`, `consentGate.test.ts`, `ports/interfaceOnly.test.ts`, `mocks/signalBusMock.test.ts`, **`signals/exclusion.test.ts`** |

T5 and T6 (the bus is reachable only from the internal network; no proxy rule routes to it) are R9 and
cannot be asserted in-process; they are carried by `ops/BUS_NETWORK_BINDING.md` and bind Phase 7.

### Verification

- `npm run typecheck` 0 errors; `npm run lint` 0 warnings at `--max-warnings 0`.
- Suite **685 → 816 across 60 → 65 files**, all of it in `src/server/signals/` (**131 tests, 5
  files**): 3.1 **+46** (envelope validation 32, schema parity 14), 3.2 **+36** (consent gate), 3.3
  **+35** (signal store; the `signalBusMock` collapse changed no count, because the mock's own 27
  tests assert the same refusals through one validator instead of two), 3.4 **+14** (exclusion scan
  13, the cap pin 1). Every figure in every fixture is synthetic.
- `npm run verify:all -- --all` — **17 of 19**, with **AC12 (contract index and build log agree)
  PASS**, confirmed after editing this log rather than assumed: AC12 reads
  `contracts/_CONTRACT_INDEX.md` and `contracts/_BUILD_LOG.md` — the **original five** build contracts
  — and not this PFOS track, so appending here cannot move it. Every pre-existing scanner
  (`db/isolation.test.ts`, `db/moneyImplementation.test.ts`, `ports/interfaceOnly.test.ts`,
  `mocks/determinism.test.ts`, `signals/schemaParity.test.ts`) still passes alongside the new one, and
  the new one assembles its tokens from fragments for exactly that reason. The only red checks are
  **AC14 (working tree clean)** and **AC15 (push ready)**, both reporting the same uncommitted Phase-3
  work. That is the expected mid-phase state; the orchestrator commits at phase end.
- The AC04 floor stays at **331**. Ratcheting it is task 9.1's, and raising it here would take a
  decision that belongs to close-out.
- Nothing in `scripts/verify/` was touched, weakened, relaxed, or edited. No check was changed to make
  a gate pass, and no DDL statement in an applied migration was altered.

### Open items that need an owner decision, recorded rather than decided here

1. **3.1 omitted the JSON Schema `$schema` dialect keyword.** The 2020-12 dialect URI is an absolute
   URI with a bare domain, and steering §0b admits **no exception** — "no bare domain … not even as an
   example" — so the document names its dialect **in prose**, inside its `$comment`, and
   `schemaParity.test.ts` asserts the file holds no absolute URI at all. **The cost is real:** a
   generic validator must be *told* which dialect to apply rather than reading it from the document,
   which is a hand-off cost the Python agent pays too. The alternatives — permitting this one URI, or
   injecting it at deploy time — are both owner calls about how literally §0b binds a
   language-neutral specification identifier, and neither was taken unilaterally.
2. **3.1 added a rule contract 12 does not state: a note containing ANY digit is refused**
   (`note_carries_a_figure`). It is **derived**, from architecture §1.5 — the finance agent publishes a
   pressure level and never "you owe 47,000" — and it closes a real hole, because §4.3.1's ban on a
   numeric *field* says nothing about a figure written inside the one free-text field the schema
   permits. But it is stricter than the contract's letter, and it refuses legitimate directional prose
   that happens to contain a digit ("ease off for 2 weeks"). Either contract 12 §4.3 should be amended
   to state it, or the rule should be narrowed to figure-shaped runs rather than any digit. **Owner
   decision.**
3. **`ops/BUS_NETWORK_BINDING.md` check 5 is not wired to anything.** Four of its five verification
   steps need a host and therefore wait on G1. The fifth — the proxy template names no bus upstream —
   is a **string match an automated harness can run today**, and it fails closed, which is the only
   useful direction for that rule. **Task 9.0 is its natural home** (it is already adding a
   fail-closed no-deployment-particular scanner over `ops/**`), and it is **NOT yet wired**. Until it
   is, that check is a runbook line rather than a gate.

### Known gaps, recorded honestly because they are real and unclosed

1. **The exclusion scan's refusal-test allowlist is a maintenance surface.** That is deliberate — a
   new file naming the classification should require a deliberate edit — but it means a legitimate new
   refusal test fails the suite until it is listed. The alternative (inferring the allowlist from the
   tree) would make the check assert nothing.
2. **§4.4.2 "not stored in any of the **three** stores" is asserted for one store.** `signals.db` is
   checked at the DDL level; `finance.db` is covered by contract 06's column vocabulary; `life.db` is
   in the other repository and cannot be asserted from here. Steering §6 keeps Kiro out of that repo,
   so the claim there is carried by the patch series Phase 8 emits, not by a test.
3. **The store's append-only triggers are asserted; the *absence* of a future non-triggered table is
   not.** A table added later without triggers would not break any existing test. The same shape as
   Phase 1's "guard before prepare is per-call-site" gap, and unclosed for the same reason.
4. **`deidentificationBreaches` is an audit function with no caller in a live path.** It is exercised
   by tests and by nothing else, because there is no live bus. When Phase 7 wires one, whether it runs
   on every delivery or only in the audit path is an unmade decision.

### Still gated (unchanged by Phase 3)

- Building behind an injected port with a deterministic mock is authorized; **nothing on the network
  is, and this phase built no live half of any boundary** — the bus store is a local file and the
  network binding is a document. The human gates stand: provision and harden the host, DNS, create the
  two bots, mint the two runtime keys with weekly caps, the storage consent click, webhook
  registration, and generate the encryption keypair with the private half kept off the box. G7 stays
  **closed as WONT-DO** per steering §0b.
- No outbound call from a server process and no production secret, unchanged.

---

## Phase 4 - The Telegram transport, mocked end to end (2026-08-07)

**Why.** This is the only place an outside party touches the finance agent, so it is the only place a
guard is load-bearing rather than tidy. Contract 12 §5 states five rules and names, for each, the
failure it is chosen against: a short-circuiting token compare leaks the secret through timing; a
refusal that says *which* check failed hands an attacker an oracle; a dedup store keyed on the update
identifier alone silently discards one bot's traffic; and a handler that does slow work before
acknowledging manufactures the retries the dedup store then has to absorb. Every one of those failure
modes is quiet — the system keeps answering — which is why Phase 4 is built as guards with negative
tests rather than as a happy path with validation.

| Phase | Deliverable | Source | Status |
| ----- | ----------- | ------ | ------ |
| 4.1 | `auth.ts`: the constant-time token compare, the fail-closed configuration check, the allowlist, and one frozen refusal for every stage | contract 12 §5.1, §5.2, §5.3 | done |
| 4.2 | `updateDedupRepo.ts`: `PRIMARY KEY (bot_id, update_id)` + `INSERT OR IGNORE`, where the insert IS the decision; retention refused shorter than the redelivery window | contract 12 §5.4 | done |
| 4.3 | `workQueueRepo.ts` + `acceptHandler.ts` + `workerRunner.ts`: accept fast in one transaction, process asynchronously, bounded concurrency; migration 006 for the payload columns | contract 12 §5.5 | done |
| 4.4 | The five-claim coverage audit, the R11 provider-rule pin, the all-four-stage refusal pin, and this section | contract 12 §5.2, §5.4.6 | done |

### 4.1 — R11's timing leak was removed, not special-cased

`node:crypto`'s `timingSafeEqual` is the right primitive and it **throws when the two buffers differ in
length**. That throw is itself a timing signal and a control-flow one, so the obvious fix — guard it
with `if (a.length !== b.length)` — does not remove the leak, it relocates it into the guard and calls
it handled. Phase 4.1 made the length mismatch **unreachable instead of detectable**: both operands are
first reduced to a keyed digest of fixed width, so `timingSafeEqual` receives two equal-length buffers
on every call, cannot throw, and compares the same number of bytes for a one-character token as for a
4096-character one. `constantTimeTokenEquals` contains no length branch because there is no length
question left to ask. The key is drawn fresh per call — the double-HMAC verification form — so digests
cannot be precomputed or compared offline.

The property is proved **structurally, not by wall clock**. A timing assertion on a shared or
virtualized host is dominated by scheduler noise, turbo clocking and JIT warm-up, so it either fails at
random or passes on code that leaks: a flaky test that certifies nothing. `auth.constantTime.test.ts`
instead denies the two things a short-circuit needs in order to exist — it reads the comparison's own
source and asserts it contains no `if`, no loop, no `break`, no ternary, no `&&`/`||`, no `===`, no
`.length`, and exactly one `return`; and it drives a length sweep (0, 1, 2, 32, 256, 4096, and astral
characters at four times the byte width) showing the compared width never moves. It then drives every
length relationship through the comparison and requires an **answer rather than an exception**, which
is the assertion the removed throw earns.

The other §5.2 rules got mechanisms rather than prose. **The refusal has nowhere to put a reason:**
`TelegramAuthDecision`'s refusing variant has no reason field, and every refusal returns the *same
frozen object*, so two refusals are identical by reference and a per-stage shape is not something a
later call site can build by accident. **All three gates are evaluated unconditionally before any is
consulted** — the pattern `signals/consentGate.ts` already set — so an absent header performs the same
digest work as a wrong one and wall-clock time does not say which stage refused; §5.3's ordering
survives as the *precedence the verdicts are read in*, which is what "checked after the token check"
governs operationally. **The authorizer cannot parse the content because it is never handed it:**
`TelegramAuthSubject` is a three-field projection that omits `rawBody` entirely, and the test plants a
throwing getter as a tripwire, so any code path that touched the body would fail loudly rather than
silently.

### 4.2 — R14 is a correctness fix, and the collision test is the one that matters

Namespacing dedup per bot reads like a refinement and is not. Update identifiers are **per-bot
sequences**, so two bots on one host will emit the same identifier for two entirely unrelated updates.
A store keyed on the identifier alone treats the second bot's legitimate update as a duplicate of the
first bot's and discards it. The symptom is **one bot going silent for no visible reason** — which
reads as a network problem, is not one, and would be diagnosed for a long time. The pair is enforced in
three places that cannot disagree: `DedupKey` has two required fields, the table declares
`PRIMARY KEY (bot_id, update_id)`, and the test reads the **live index back from the engine** via
`PRAGMA index_list` / `index_info` rather than trusting the DDL text, asserting the unique column set is
exactly `['bot_id', 'update_id']` and that nothing narrower exists.

**§5.4.6's test is the one that matters, and the reason is worth stating plainly: a suite asserting
only "a duplicate is dropped" passes on the broken single-key design.** Both designs drop a duplicate.
Only the correct one treats two bots' shared identifier as two new deliveries. So that case is asserted
from both directions — both claims report `new`, and both rows survive — at the repository level in
`updateDedupRepo.test.ts` and again through the accept path in `acceptHandler.test.ts`.

The insert **is** the decision: one `INSERT OR IGNORE` whose row count is the answer, with no prior
read, which is what closes the race a read-then-write scheme leaves open — two concurrent deliveries
can both read "not seen" and both proceed, and a unique index cannot be raced. For the same reason the
module exports **no "have I seen this" predicate**: that would be the read half of the pattern the
contract removed, and the first caller in a hurry would pair it with a conditional insert and re-open
the window. A duplicate returns `duplicate` and **throws nothing**, because an error would travel back
as a failed delivery and earn another retry of the very update we just declined.

### 4.3 — the dedup claim and the durable enqueue are ONE transaction

This is the phase's least obvious correctness requirement, so it is recorded in full. Taken as two
steps, a failure between them **marks the pair as seen with no work behind it**. The provider's
redelivery is then refused as a duplicate — *correctly*, per §5.4.4 — and the update is lost forever,
silently, with both guards behaving exactly as specified. Wrapping both in `BEGIN IMMEDIATE` makes "the
pair is claimed" and "the work exists" the same fact; a duplicate rolls back, so a refused delivery
writes nothing at all. The test forces the enqueue to fail after the claim is written and asserts the
dedup table is empty afterwards and the retry is accepted.

`acceptDelivery` is **synchronous**, and that is the design rather than an implementation detail: its
return value is a decision, not a promise, so there is no point at which an awaited slow call could
have been placed, and `TelegramInboundPort.accept` is declared synchronous so a future implementation
that wanted to `await` a model call could not satisfy the type. R15 is proved two ways that together
are decisive — the decision is asserted not to be thenable, and an `InvocationRecorder` shared with the
port mock is asserted **empty** after a successful accept, so the slow side exists, is reachable, and
was not reached. A downstream failure then stays in the queue: the worker's throw does not make the
drain reject, the item is retried on a doubling backoff clamped at an injected ceiling, and the
transport decision is unchanged — the redelivery is still a duplicate.

> **Migration 006 is NOT defensively re-runnable, and that is stated rather than hidden.** 003 declared
> `work_queue` with the operational minimum; §5.5.1 acknowledges before anything reads the delivery, so
> the sender and the raw body have to be **in the row**, and 003 is frozen (§5.1). 006 adds them. Its
> three `ALTER TABLE ... ADD COLUMN` statements have no `IF NOT EXISTS` form in SQLite — the form does
> not exist to write. **What makes the run once-only is the recorded version, not the DDL:** §5.2.2
> skips a recorded migration without executing a single statement, which is the guarantee Phase 1.5's
> T8 pinned with a deliberately non-idempotent statement rather than with a schema comparison. The two
> index statements in the same migration *are* defensive, because they can be. No applied migration was
> edited.

### 4.4 — the audit, and the one gap of Phase 3.4's shape

**All five claims 4.4 nominally owned were already covered, at both levels.** They were audited against
the requirements one by one and **no test was added that duplicates an existing assertion**:

| Claim | Unit level | Accept-path level |
| ----- | ---------- | ----------------- |
| Missing token | `auth.test.ts` — absent and empty asserted as **distinct facts**, both refused, the audit telling them apart via a boolean without recording either | `acceptHandler.test.ts` — refused, `tokenHeaderPresent: false`, nothing enqueued |
| Wrong token | `auth.test.ts` — prefix, superstring, same-length near-miss, single character, and an unrelated same-shape token | `acceptHandler.test.ts` — refused, `tokenHeaderPresent: true`, nothing enqueued |
| Non-allowlisted sender | `auth.test.ts` — absent sender, **empty allowlist means nobody**, empty sender is nobody, and exact matching (no trim, no case fold, no prefix) | `acceptHandler.test.ts` — refused at the allowlist stage, after the token check, nothing enqueued |
| Duplicate update | `updateDedupRepo.test.ts` — `duplicate`, no second row, first instant preserved, no throw | `acceptHandler.test.ts` — `duplicate`, queue depth unmoved, nothing audited |
| **Two bots, one update id** | `updateDedupRepo.test.ts` — both `new`, both rows present, and the live unique index read back from the engine | `acceptHandler.test.ts` — **both `enqueued`, distinct refs, depth 2** |

**The drift gap, and it is exactly R7's shape.** Phase 3.4 found that R7's "120 characters" was never
pinned: every assertion was written *relative to* `SIGNAL_NOTE_MAX_LENGTH`, so raising the constant
would have kept the suite green while violating the requirement outright. The equivalent here is
**R11's fail-closed rule against the provider's own token rule**.
`docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md` §1.4 records, verified against the provider's documentation,
that a secret token is **1-256 characters drawn from `[A-Za-z0-9_-]`** — a value outside that set can
never be echoed back on a request. `auth.ts` encodes it as `TELEGRAM_SECRET_TOKEN_MAX_LENGTH` and
`TELEGRAM_SECRET_TOKEN_PATTERN`, and **every** assertion about it — the over-length fail-closed case,
the at-the-limit accepting case — was expressed in terms of those two names. Raising the length or
widening the charset would have left the suite green while the guard stopped matching the transport it
exists to guard: an operator would configure a token the provider cannot echo,
`secretTokenIsConfigured` would call it configured, and every request would be refused at the **token**
stage instead of the **configuration** stage — a guard armed against nothing, reporting the wrong
reason, and an operator debugging a mismatch that does not exist. `telegram/negativeGuards.test.ts` now
writes the rule's own number and alphabet down: `TELEGRAM_SECRET_TOKEN_MAX_LENGTH` is pinned to 256, the
bound is driven in literals on both sides (256 configured, 257 not; one character yes, zero no), every
character of the documented alphabet is accepted individually, and eleven characters outside it fail
closed **even when the header echoes the configured value exactly**.

The other three candidates were checked and are **not** gaps, which is worth recording so the check is
not repeated:

- **R11's digest width is self-checking.** `TOKEN_DIGEST_BYTES` looks like the same pattern but is not:
  the width assertions would *fail* if the algorithm drifted away from a matching width, and the
  requirement is "both operands the same fixed width", which equality to one shared constant gives
  transitively. Pinning 32 would over-pin a number no requirement names.
- **R14's pair key is already pinned to literals.** The index assertion names `bot_id` and `update_id`
  as strings read from the engine, not as constants the module owns.
- **R13's retention rule owns no constant at all.** `pruneDedupBefore` demands *both* the retention and
  the provider's redelivery window from its caller and refuses when the first is shorter, so there is
  no code-owned number to drift. Contract 06 §8.2 keeps retention as `<DEDUP_RETENTION_DAYS>`.
- **R15 has no numeric claim to pin.** "Nothing slow before the acknowledgement" is proved by the
  synchronous return type and the empty recorder, both structural.

**One existing claim was strengthened rather than restated.** §5.2's "the refusal reveals nothing about
which check failed" was asserted by-reference for **two** of the accept path's **four** refusing
stages. The enqueue stage is the one a later edit is most likely to give its own shape, because it is
the only refusal carrying a distinct failure code internally. All four stages now return the one frozen
value, asserted identical by reference and single-keyed, while the audit — which §5.3 requires and
which is a separate path from the response — confirms these really are four *different* refusals being
answered identically.

### The acceptance tests of contract 12 §12, and where each one lives

| # | Test | Where |
| - | ---- | ----- |
| T16 | A request with no secret-token header is rejected, and **absent is not empty** — both refused, kept distinguishable in the audit without recording either | `auth.test.ts`, `acceptHandler.test.ts` |
| T17 | A mismatched token is rejected — prefix, superstring, same-length near-miss — and the response reveals nothing about which check failed | `auth.test.ts`, `acceptHandler.test.ts`, `negativeGuards.test.ts` (all four stages) |
| T18 | The token comparison is constant-time: no branch, no early exit, no length-dependent work, and the length-mismatch **throw is gone** | `auth.constantTime.test.ts` |
| T19 | An absent, empty, over-length, or out-of-charset expected token fails closed, refusing even a request carrying the configured value — **and the 256-character, `[A-Za-z0-9_-]` rule is pinned to its own number** | `auth.test.ts`, `negativeGuards.test.ts` |
| T20 | A sender absent from the allowlist is refused before any parsing; an empty allowlist refuses everyone; the authorizer is never handed the body | `auth.test.ts`, `acceptHandler.test.ts` |
| T21 | A repeated update identifier is a no-op acknowledged as success, with no duplicate write and no error | `updateDedupRepo.test.ts`, `acceptHandler.test.ts` |
| T22 | **Two bots emitting the same update identifier are both processed** — both `new`, both rows, both enqueued with distinct refs | `updateDedupRepo.test.ts`, `acceptHandler.test.ts` |
| T23 | Concurrent duplicate deliveries cannot both proceed: exactly one of eight repeats and one of **two independent connections** wins | `updateDedupRepo.test.ts`, `workQueueRepo.test.ts` |
| T24 | The handler acknowledges before any slow work: the decision is not thenable, and the shared recorder is **empty** after a successful accept | `acceptHandler.test.ts` |
| T25 | An enqueued update survives a restart: closed, re-opened, still claimable | `workQueueRepo.test.ts` |
| T26 | A downstream failure retries in the queue, never at the transport; the redelivery is still a duplicate; the attempt ceiling abandons without a transport failure | `workerRunner.test.ts` |

### Verification

- `npm run typecheck` 0 errors; `npm run lint` 0 warnings at `--max-warnings 0`.
- Suite **816 → 945 across 65 → 72 files**, all of it in `src/server/telegram/` (**129 tests, 7
  files**): 4.1 **+65** (`auth.test.ts` 27, `auth.constantTime.test.ts` 38), 4.2 **+12**
  (`updateDedupRepo.test.ts`), 4.3 **+37** (`workQueueRepo.test.ts` 15, `acceptHandler.test.ts` 12,
  `workerRunner.test.ts` 10), 4.4 **+15** (`negativeGuards.test.ts`). Every token, bot, sender and
  update identifier in every test is synthetic and deliberately short (R24, steering §0b).
- `npm run verify:all -- --all` — **17 of 19**, with **AC12 (contract index and build log agree) PASS**,
  confirmed after editing this log rather than assumed: AC12 reads `contracts/_CONTRACT_INDEX.md` and
  `contracts/_BUILD_LOG.md` — the **original five** build contracts — and not this PFOS track, so
  appending here cannot move it. Every pre-existing test still passes: 72 of 72 files green, including
  every scanner (`db/isolation.test.ts`, `db/moneyImplementation.test.ts`, `ports/interfaceOnly.test.ts`,
  `mocks/determinism.test.ts`, `signals/schemaParity.test.ts`, `signals/exclusion.test.ts`). The only
  red checks are **AC14 (working tree clean)** and **AC15 (push ready)**, both reporting the same
  uncommitted Phase-4 work. That is the expected mid-phase state; the orchestrator commits at phase end.
- The AC04 floor stays at **331**. Ratcheting it is task 9.1's, and raising it here would take a
  decision that belongs to close-out.
- Nothing in `scripts/verify/` was touched, weakened, relaxed, or edited. No check was changed to make
  a gate pass, no applied migration was edited, and no `ATTACH` statement exists anywhere in
  `src/server/**`.

### Open items that need an owner decision, recorded rather than decided here

1. **The accept path does not check the delivery's `botId` against the transport's `botId`.** Each
   agent runs one bot, so in the deployed topology the two always agree, and §5.2/§5.3 do not require
   the check. But nothing refuses a delivery claiming a *different* bot identifier, and it would be
   recorded under that identifier in both the dedup table and the queue. Whether that is a guard worth
   having, or a configuration fact the transport layer should assert once at start-up, is an owner
   call — and it interacts with T4 (each agent resolves exactly one bot token), which is Phase 7's.
2. **The retention pair has no configured value yet.** `pruneDedupBefore` correctly refuses to prune
   shorter than the provider's redelivery window, but **both numbers are injected and neither is set
   anywhere in the repository** — `<DEDUP_RETENTION_DAYS>` is still a placeholder in contract 06 §8.2,
   and the provider's documented maximum is an operational fact. Until Phase 7.3 writes the env
   template, nothing prunes, which is the safe direction but not a decision anyone took deliberately.

### Known gaps, recorded honestly because they are real and unclosed

1. **The constant-time property is proved structurally, and structure is not timing.** The source scan
   and the width sweep together deny everything a short-circuit needs, and that is the strongest
   deterministic evidence available — but it is evidence about the *code*, not a measurement. A
   platform-level regression in `timingSafeEqual` itself would not be caught here, and neither would a
   leak introduced by a future JIT optimization. Recorded rather than papered over.
2. **The two-connection race stands in for two processes, not for two hosts.** Two handles on one store
   file prove the decision lives in the engine rather than in either caller's memory, which is the
   property that matters. True cross-process concurrency under load waits on a host and is G1's.
3. **`work_queue`'s payload columns carry a `DEFAULT ''`, which migration 006 needed and the code does
   not want.** `ALTER TABLE ADD COLUMN ... NOT NULL` requires a default in SQLite, so an empty sender
   or body is representable at the DDL level even though `enqueueWork` refuses both. The guard is in the
   repository, not in the schema — the same "guard before prepare is per-call-site" shape Phase 1
   recorded, and unclosed for the same reason.
4. **Nothing exercises the transport against a real HTTP surface.** There is no server, no route, and
   no header parsing: `TelegramDelivery` is constructed directly in every test. The header *name* is
   pinned, but the step that reads it off a request does not exist yet and is Phase 7's.
5. **The worker's `process` step does no real work.** Every worker in these tests is scripted. What the
   finance agent actually *does* with an accepted update is Phase 5's routing tier, so the queue's
   durability and retry semantics are proved while the payload's meaning is still unexamined.

### Still gated (unchanged by Phase 4)

- Phase 4 built the transport's **decision** logic and no part of its network half: no route, no
  `setWebhook`, no outbound call, no live token. The human gates stand: provision and harden the host,
  DNS, create the two bots, mint the two runtime keys with weekly caps, the storage consent click,
  webhook registration, and generate the encryption keypair with the private half kept off the box.
  G7 stays **closed as WONT-DO** per steering §0b.
- No outbound call from a server process and no production secret, unchanged.

---

## Phase 5 - Routing, spend and telemetry: the tier that decides whether to spend (2026-08-07)

**Why.** Phase 4 ended with an accepted update sitting in a durable queue and nothing that knew what
to do with it. Phase 5 is what the worker does — and it is the first tier in this build whose
mistakes cost money, send content to a third party, or both. Contract 12 §6 states four rules and,
as in §5, names the failure each is chosen against. A `T0` guarantee asserted by inspecting the
ANSWER "would pass if a model were called and its output discarded, which still spends money and
still sends content to a provider". A registry checked AFTER selection is a runtime filter, and
§4.3 already recorded what those are worth: re-orderable, skippable at a new call site, failing as
a paid call to an unvetted model that looks like success. A cost adapted from an ESTIMATE makes
contract 11's governance loop grade its own guesses. And a cap that suppressed a due-date warning
would be, in §6.2's words, "the single worst failure mode this system could have".

Every one of those is quiet. So Phase 5 is built the way Phase 3 built consent and Phase 5.1 builds
R16: not as checks that fire, but as **capabilities the wrong path does not hold**, with the runtime
belt behind the type and a negative test that shows the belt refusing.

| Phase | Deliverable | Source | Status |
| ----- | ----------- | ------ | ------ |
| 5.1 | `turnClassifier.ts` + `turnDispatch.ts`: T0-T4 from rules only, and a T0 turn that holds no capability to reach a model | contract 12 §6.1, contract 10 classifier | done |
| 5.2 | `eligibilityRegistry.ts` + `modelRouter.ts`: presence in the registry as a precondition of selection, `provisional` as a compile error, contract 09's L-scale joined to contract 10's T-scale | contract 12 §6.3, contracts 09/10 | done |
| 5.3 | `modelTelemetryRepo.ts` + migration 007: actual reported cost, tokens, latency, schema validity, append-only, and no prompt text at four independent layers | contract 12 §6.4, contract 06 §3.3/§6.2 | done |
| 5.4 | The five-claim coverage audit, the cap-isolation sweep, the deterministic-alerts differential, the T0 composition, the promotion-versus-admission walk, and the K4 drift pin | contract 12 §6.2, contract 06 §9 T15/T16 | done |

### 5.1 — the T0 guarantee is a capability the T0 branch does not have

Three mechanisms were available for R16 and the choice among them is the whole of the sub-task, so
it is recorded rather than summarized. **A runtime branch** (`if (tier === 'T0') return
deterministic(...)`) was rejected as the primary mechanism for §4.3's reason about runtime filters
generally. **`Exclude<Tier, 'T0'>` on the request type** was already in force one layer out —
`ModelRequest.tier` has excluded `T0` since Phase 2.1 — and is not sufficient: a caller holding a
T0 classification can relabel the turn `T1` and call the port, because the type constrains the
LABEL and not the AUTHORITY. What shipped is the third: **a capability the T0 branch does not
have.**

`TurnClassification` is a discriminated union. The model-bearing branch carries a
`ModelInvocationGrant`; the `T0` branch types that same field **`never`**, so it cannot hold one
under any spelling. `classifyTurn` is the grant's only mint — the device Phase 3.2 used for
`ServedSignalEnvelope` — and the port is **not handed to the dispatcher at all**: it is wrapped once
in `createModelChannel`, captured in the closure, absent from the returned object, and the channel's
only member demands a grant. So the deterministic branch of `dispatchTurn` does not decline to call
the model; it has no argument it could pass and no expression it could write. Writing the call is a
compile error rather than a code-review question.

A `as unknown as` cast defeats any purely type-level brand, so three runtime belts sit behind the
type and each throws **before the port is touched**, which is what lets the negative tests assert
the refusal AND an empty invocation record in the same breath: the grant must have been minted
(`TURN_MODEL_GRANT_NOT_MINTED`), the request's tier must equal the grant's
(`TURN_MODEL_GRANT_TIER_MISMATCH`, closing the gap where a `T1` grant buys a `T4` model), and the
request's correlation reference must equal the grant's turn reference
(`TURN_MODEL_GRANT_TURN_MISMATCH` — one grant, one turn, the discipline Phase 4.2 applied to dedup
keys). The mint is recorded in a module-private `WeakSet`, and **note the direction state can move
in**: nothing outside `mintGrant` adds to it, so the registry can only ever REFUSE a grant it did
not issue. Its failure mode is a false negative that halts a call, never a false positive that
permits one. It holds no decision and no cache — a classification is re-derived on every call,
exactly as §4.5.4 requires of a consent scope.

**The empirical half, because a structural argument about a capability still has to be observed.**
`t0NoModel.test.ts` dispatches a corpus that is adversarial on purpose: six deterministic intents
crossed with six pressure profiles, every profile carrying a fact that WOULD escalate a
non-deterministic turn — new debt, an over-threshold amount, a critical obligation, conflicting
evidence, low confidence, irreversibility. Thirty-six turns is not a large number; it is every
deterministic intent under every pressure the classifier knows about. The `InvocationRecorder`
shared with the port mock is asserted **empty** after all thirty-six. And because an empty record
only means something if a full one is reachable through the same wiring, a **positive control** at
the bottom dispatches one non-T0 turn through the identical dependencies and asserts the recorder
DID capture it — without that, "the record is empty" would be equally consistent with a recorder
that never records.

Two vocabulary decisions are worth recording because a later phase will be tempted to undo them.
`Tier` is **imported** from `src/features/routing/modelPolicy.ts` — contract 10's own taxonomy — so
`T0`-`T4` have exactly one definition in this repository and a rename breaks here loudly instead of
leaving two ladders to drift. And contract 09's `L0`/`L1`/`L2` are **deliberately not mixed in**:
they grade a MODEL, not a turn, and conflating the two axes is the mistake 5.2 then has to be
careful about at the join.

No figure can enter the classifier, and that is enforced rather than intended. Contract 10 lists an
amount and two ratios among its features; `TurnFacts` consumes the deterministic engines' VERDICTS
about them (`amountOverOwnerThreshold`, `exceedsSafeToSpendAllowance`,
`materialShareOfLiquidNetWorth`) and has no numeric field at all. `NoMagnitude<>` types every
numeric key `never`, so adding `amountMilliunits: number` later makes the field uninhabitable, and
`Exact<>` on the argument refuses a surplus key — TypeScript's own excess-property check fires only
on a fresh literal, so a figure smuggled in on an extra key would otherwise pass. `src/lib/money` is
neither imported nor needed: there is no arithmetic, because there is no money.

### 5.2 — stage 4 is a resolution, not a check, and a provisional registry is a compile error

The router's last stage takes the model id `selectModel` answered with and produces the value the
caller may return. The obvious shape for R18 is `if (!registry.includes(modelId)) refuse(...)`
somewhere after it. What shipped inverts the direction: **`EligibleModel` is branded and
`admitEligibilityRegistry` is its only mint.** One `EligibleModel` is minted per registry entry;
there is no `from(modelId)`, no widening export, and the entries are captured in the closure so a
caller cannot retrieve one and build its own. `RoutedModel.model` is an `EligibleModel`, and the
only route from a `string` to one is `AdmittedRegistry.resolve`. So stage 4 is a **resolution**: a
miss leaves nothing to return rather than a value that needs checking, and "selected a model that
was not in the registry" is not a case the tests have to cover, because it is not a sentence this
tier can write.

The same device carries R18's second half further than a runtime refusal can.
`LiveEligibilityRegistry` intersects the document with **`provisional: false` as a LITERAL**, and
`admitEligibilityRegistry` takes that type — so a document holding `provisional: true`, or one whose
flag is merely `boolean` and therefore not known to be `false`, is not assignable at all. The
refusal happens in the type checker, before the program exists.

**What closes that loop is one directory away and was already there.** `mocks/fixtures.ts` types
`LoadedFixture.provisional` as the literal `true`, because steering §3 ties a fixture-backed run to
a provisional registry. `provisionalRegistryFromFixture` makes the tie mechanical in the other
direction: it accepts anything carrying `provisional: true` — which a `LoadedFixture` does,
structurally — and returns `ProvisionalEligibilityRegistry`, which is precisely what
`LiveEligibilityRegistry` excludes. **The only path from recorded fixtures to a registry therefore
ends in a document the router cannot be handed, with no `as` anywhere along it and nothing for an
author to remember.**

A literal is only known statically, so `parseEligibilityRegistry` is the runtime belt for a registry
that arrives as `unknown` from disk, and it is fail-closed in all four of §6.3's senses with **a
distinct code for each**: `ELIGIBILITY_REGISTRY_ABSENT`, `..._UNPARSEABLE`,
`..._PROVISIONAL_FLAG_ABSENT` (§6.3 is explicit that an absent flag is NOT read as "not
provisional"), and `..._PROVISIONAL`. They are four codes rather than one because §6.3 calls a
provisional registry "a gate item, not worked around", and an operator has to know WHICH of the four
they are in before they can record it. Four more codes cover the shapes that make a registry
ambiguous rather than merely provisional — an unsupported version, an invalid entry, a duplicated
model, and an **empty** registry, which is refused rather than admitted because an enabled-but-empty
registry lets an operator believe routing works when nothing can be selected. Nothing degrades to a
cheaper model, returns an empty registry, or continues with a warning.

**The L×T join is `TIER_REQUIRED_ELIGIBILITY`, and it needed two reconciliations that are not
obvious.** It is a total `Record` over `ModelBearingTier`, so a tier added to contract 10's taxonomy
without a stated eligibility requirement fails to compile rather than routing to an ungraded model.

- **The bands are NOT a ladder.** `L1` does not imply `L0`. `L0` is critical-field extraction
  accuracy; `L1` is schema validity plus evidence coverage; `evaluateEligibility` computes them
  independently. So each tier names exactly ONE requirement rather than a minimum band. Treating
  them as nested would admit a model to extraction on the strength of an evidence-coverage score,
  which measures something else entirely.
- **`T4` does not take an L band at all.** Contract 09's own words: developer/build tasks are judged
  "separate from live finance eligibility". So `T4` takes `developerBuild`, which comes from the code
  benchmark and the repository tests rather than from the finance eval set — and `developerBuild` is
  a REQUIRED field of an entry, so a registry that omits it is unparseable and refuses. An unstated
  developer verdict is not read as a passing one.

**The deliberate non-implementation, recorded because a later reader will otherwise think it was
missed.** Contract 10 gives a weighted utility over seven terms: QualityFit, SafetyFit,
ToolReliability, LatencyFit, ContextFit, HistoricalPersonalAccuracy, and normalized expected cost.
**Only the last has a data source today** — cost comes from the frozen pricing snapshot through
`modelPolicy`. The other six come from a Phase-1 benchmark run that has not happened; Phase 6 owns
it, and contract 09's exit criteria end with "No model promoted from benchmark reputation alone."
Fabricating the six with plausible constants would manufacture exactly the reputation contract 09
forbids, and once written down it would be indistinguishable from measurement. So the two terms that
DO have evidence are expressed as contract 10's **own hard filters** rather than as weighted
numbers: SafetyFit is the disqualification gate — an admitted registry grades a disqualified model
for nothing, so contract 09's automatic-failure outcome survives into routing without a second place
to record it — and QualityFit is the band gate. Cost stays `modelPolicy`'s cheapest-capable rule.
The candidate ordering is contract 10's OWN stated primary-then-fallback order, read from
`TIER_CAPABLE`, which is evidence somebody already wrote. When Phase 6 produces a measured registry
the terms have a source and the score can be added.

`modelPolicy` is consumed and nothing about it is restated: no second roster, no second tier map, no
second cap ladder, no reimplementation of "cheapest capable". `selectModel`'s verdict is carried in
`RoutedModel.policy` verbatim. What this file adds is the stage contract 10 puts in FRONT of that
decision — "hard eligibility filters execute before scoring" — which is the join contract 09 and
contract 10 each half-described and neither owned. When the roster and the registry disagree, the
refusal is **explicit** (`MODEL_ROUTING_POLICY_PICK_NOT_ELIGIBLE`) and no second-choice model is
substituted, because §6.3 forbids the silent degradation and because a silent upgrade spends money
nobody approved.

K4 is held off by three things and the first is load-bearing: `allowPremium` is derived from a
`PremiumOptIn` **argument**, and an argument that is not supplied is not supplied — no default, no
environment lookup, no field that could be set once and forgotten. `PremiumOptIn` is bound to ONE
turn (`authorizedBy` is a single-member literal so it cannot arrive as "it was already like that";
`forTurnRef` must equal the grant's reference so it cannot be carried forward), and a present opt-in
belonging to another turn is **refused rather than ignored**, because ignoring it would leave the
owner believing they had authorized something they had not. `premiumRefusal` is the belt behind
both, applied to the chosen model and to every member of the fallback chain — the chain is what a
provider request would actually carry as `models`.

### 5.3 — no prompt text, enforced at four layers that fail independently

Migration **007** finishes `model_telemetry`. 003 declared it in Phase 1 with tokens, latency, schema
validity and the requested model identity; three things §6.4 permits an operator to see were absent
and one thing §6.2.1 requires of a recorded cost was not expressible. 007 adds the actual reported
cost and its provenance, the pre-flight estimate in its own column, the model actually **served**,
the per-request privacy assertion, an index on `(agent, occurred_at)`, and two append-only triggers.
A new migration rather than an edit to 003, because an applied migration is frozen (§5.1) and the
migrator refuses a rewritten checksum rather than guessing which state is correct. As with 006, the
five `ALTER TABLE ADD COLUMN` statements **cannot** be defensive — SQLite has no `IF NOT EXISTS`
form for them — and what makes the run once-only is the recorded version, not the DDL: §5.2.2 skips
a recorded migration without executing a single statement. No applied migration was edited.

R19's "no prompt text and no completion text is written to any log, ever" is mechanical at four
layers, and the point of four is that they **fail independently**:

1. **The TYPE cannot hold content.** The write path accepts nothing broader than
   `ModelCallTelemetry`, which Phase 2.1 already defined as a `Redacted<>` projection typing every
   content-named key `never`. It is **reused, not re-defined** — there is deliberately no second
   telemetry shape in this module, because two shapes would eventually disagree about what a log
   line may carry. `TelemetryRecord` adds only what a stored row needs and a loggable projection has
   no business holding: a surrogate key, the UTC instant, and the optional estimate. The read model
   is wrapped in the same `Redacted<>` for the same reason: today it resolves to itself, and
   tomorrow it refuses to compile if somebody adds a content field.
2. **The DDL has no column that could hold free text.** `TELEMETRY_FORBIDDEN_COLUMNS` enumerates
   eighteen names the table must never grow, and the test asserts the list against the live
   `table_info` of **every table in the store** AND against the DDL text of **every migration** — so
   the absence is a property of the shipped schema rather than of a comment about it. Matching is by
   exact column name on purpose: `prompt_tokens` and `completion_tokens` are COUNTS, which §6.4
   explicitly permits, in the same way `signal_audit.note_length` measures a note it does not keep.
   A substring rule would forbid the counts and pass anything named `narrative`, which is the wrong
   trade in both directions.
3. **The WRITE PATH refuses a surplus key and refuses prose.** A cast defeats a type, so the key set
   is re-checked at run time against the permitted projection, and every string field is checked for
   being an identifier, an enum member, or a timestamp rather than narrative — length past 120
   characters, or any newline or tab, is decisive. The refusal reports the **KEY and never the value**,
   for the reason §4.3.6 gives about quarantine tables: an error message that quotes the refused
   value is itself a log line carrying prompt text. A refused record writes nothing, because every
   guard runs before the statement is prepared.
4. **An independent derivation about the STORED ROW.** `contentBreaches` re-derives, from the raw
   record the engine hands back, that the row's key set is exactly the table's columns, that none is
   content-named, and that no value on it is prose. It is deliberately **not** a call back into the
   write guards — the two would then fail together — and it earns its independence the way Phase
   3.2's `deidentificationBreaches` did: it catches what input validation never saw. A caller who
   reached the handle and inserted a completion into `model_id` passed no write guard at all, and
   this is the layer that refuses to serve the result. It is wired into `readTelemetry` and also
   exercised directly, because a guard only ever observed passing is not evidence.

**Actual cost and estimated cost are separated four ways, not documented as different.** §6.2.1 lets
an estimate GATE a call and never be what is recorded; contract 11 adapts cost policy from what WAS
recorded, so adapting from estimates would make the governance loop grade its own guesses. So:
**different columns**, `actual_cost_micro_usd` and `preflight_estimate_micro_usd`, neither of them
the bare `cost` — the ambiguous name `cost_micro_usd` exists in no table that also holds an
estimate, so a careless `SELECT` cannot pick up "the cost"; **different types**, each with a
single-member provenance literal (`provider_reported_actual` versus `preflight_estimate`), so neither
structure type-checks where the other is wanted, in either direction; **a CHECK at the engine** on
`actual_cost_source`, so a caller reaching the handle still cannot record an estimate as an actual;
and **different names on the read model**, where the actual is a number and the estimate is an object
carrying its own provenance, so a consumer that wants a figure has to name which figure it means.

Append-only, for the reason 004 and 005 give and one more. Telemetry is **evidence**: contract 11
promotes and demotes models from it, and an editable evidence table is a governance input that can be
quietly rewritten to justify the decision it was supposed to inform. The module exposes no update
path and no delete path and its test scans this source to prove it — but that is a property of one
module, and the handle is what every future caller reaches, so the refusal lives in the table as two
triggers. A correction is another `recordTelemetry` with its own `id`. Retention pruning stays an
explicit operation rather than an incidental delete.

Two refusals in this repository are worth naming together because they are the same idea from
opposite ends: a `T0` turn class is refused here outright — a telemetry row describing a model call
at a tier that invokes no model is a contradiction — and a missing `schemaValid` verdict is refused
rather than defaulted, because a missing verdict is not a failed one and contracts 09 and 11 both
read that field. This sub-task is what satisfies contract 06 §9 **T16**.

### 5.4 — the audit, and the one claim that was covered by an argument instead of a test

The five claims 5.4 nominally owned were audited against the requirements one by one, and **claim 2
was the only wholly uncovered one**. No test was added that duplicates an existing assertion:

| Claim | Status at audit | What 5.4 added |
| ----- | --------------- | -------------- |
| Cap exhausted refuses one agent and not the other | Covered at the POLICY level by `features/routing/agentBudget.test.ts`, which says so in its own header and says the sweep belongs here | `capIsolation.negative.test.ts` — the same claim at the ROUTER, at the PROVIDER belt, and over a REAL store |
| **Deterministic alerts still fire** | **Uncovered. True by construction and asserted nowhere** | `deterministicAlerts.negative.test.ts` — a differential over the real Stage 1-4 engines |
| T0 never calls a model | Covered by 5.1's 36-turn corpus with a positive control | `t0UnderClosedDoors.test.ts` — the COMPOSITION 5.1 held fixed |
| A provisional registry cannot promote | ADMISSION covered thoroughly by `eligibilityRegistry.test.ts` | `provisionalCannotPromote.test.ts` — the whole promotion journey, not just the gate |
| K4's roster and cap are what the owner set | Asserted only RELATIVE to the constants | `features/routing/k4Constants.test.ts` — the drift pin |

**Cap isolation, proved at the three levels R17 actually spans (contract 06 §9 T15).** §6.2 says
"Two belts, and neither substitutes for the other", so a test exercising one belt has tested half of
R17 and left the other half to a comment. The three: the **server router**, where the other agent is
now shown routing successfully in the same breath as the first is refused, so nothing could begin
consulting an aggregate unnoticed; the **provider belt**, which is one key per agent — two mocks with
two configurations is what that topology looks like from this side of the port, and one is driven to
refusal while the other completes; and a **real store**, because the pure read model is handed rows
by a caller, that caller is `spendLedgerRepo`, and §6.2.3 has it read BOTH agents' rows deliberately
so the per-agent scoping is exercised at run time rather than hidden in a `WHERE` clause. The
topology asserted is the tree's own — one ledger table with an enumerated `agent` column, never
aggregated for a cap decision — and store-file isolation stays where it already is, under contract 06
§9 T2/T3. Asserting a two-file topology here would assert something the tree does not do.

**The deterministic-alerts claim is a DIFFERENTIAL over the real engines, and it needed to be.** The
claim is true by construction today: the engines take no model port, so a cap cannot reach them. That
is exactly why it had never been asserted — a property nobody can see failing is a property nobody
writes down. But "the engines do not import the router" is a structural fact about today's tree, and
R17 is a promise about the system's behaviour, and the gap between them is one refactor wide: a
briefing path that decorated an obligation alert with a model-written sentence and then propagated
the refusal instead of degrading to the deterministic line would violate R17 while every existing
test stayed green. So the same synthetic ledger is run **twice** — once with an ample cap, once with
the cap exhausted and the channel refusing on every call — through `obligationFundingReport`,
`safeToSpendAllHorizons`, `forecastAll` and `worstStatus`, the **real Stage 1-4 engines imported
verbatim**. The assertion is **deep equality** across the two runs: not "still non-empty", not "still
red somewhere", but identical field for field, including the amber and red statuses, the shortfall
figures, the penalty exposure and the due-date arithmetic. A deterministic alert that changed in ANY
respect because a model budget ran out fails this. Owner money in the fixture is integer milliunits
through `src/lib/money`; provider cost is integer micro-USD; the two never meet.

**The T0 composition, under closed doors.** 5.1's corpus runs with a healthy budget and a fully
graded registry. R16 with R17 and R18 promises something stronger — a T0 turn is answered when there
is no model available to call at all — and there are three distinct ways of having none. The cap is
exhausted, so both belts refuse. The registry is **absent**, and this is the sharpest form: with no
`AdmittedRegistry` in existence, `routeModel` cannot even be CALLED, because the value its parameter
needs was never produced. Not a refusal at run time — an absence of the argument. Or the registry is
present but provisional, so admission refuses and again there is nothing to route with. In all three
the T0 turn is answered and the recorder is asserted empty. The corpus here is deliberately small:
the breadth argument was made in 5.1, and repeating thirty-six turns three times would be volume
rather than evidence. What this file adds is the axis 5.1 held fixed.

**Promotion is narrower than admission, and contract 09 words the narrow one.** "No model promoted
from benchmark reputation alone." Promotion is a JOURNEY — a run grades a model, the grades are
written into a registry, the registry admits, the router selects, a request carries the id, the
provider serves it — and §6.3 cuts it at the registry. A test that only showed a provisional document
being refused would leave open whether a well-graded model could reach live routing by some other
route. So `provisionalCannotPromote.test.ts` walks the whole journey with a model that contract 09's
**real aggregator** (`evaluateEligibility`, imported verbatim) promoted to L0, L1 **and** L2 — a
genuinely well-graded model, not a failing one, because a disqualified model would make the test pass
for the wrong reason — and shows every remaining step unavailable because the run was fixture-backed.
There is no other route, and this is where that is written down.

**The K4 drift pin, and it is the third instance of this shape in the build.** Phase 3.4 found it on
R7's 120-character note cap and pinned `SIGNAL_NOTE_MAX_LENGTH` to `120`. Phase 4.4 found it on R11's
token length and charset. The shape: every assertion is written *relative to* the constant it is
about, which is the right way to write each one individually, and taken together they leave a hole.
`modelPolicy.test.ts` blocks routing at `spentThisWeekUsd: WEEKLY_BUDGET_USD`. `agentBudget.test.ts`
asserts the chosen model is `toContain`-ed in `DEFAULT_ALLOWED`. `modelRouter.negative.test.ts`
iterates `PREMIUM_MODELS` and filters `TIER_CAPABLE` by `DEFAULT_ALLOWED`. Raise the weekly cap from
the owner's five to fifty and all of them stay green while the ceiling is multiplied by ten. Move
`x-ai/grok-4.5` out of `PREMIUM_MODELS` into `DEFAULT_ALLOWED` and the premium-refusal tests still
pass — **because they iterate the very array that was changed** — while a model the owner turned OFF
becomes a default. The tests would be measuring the code against itself.

**This was verified rather than argued.** The move was performed on `modelPolicy.ts` and the three
K4-relative files were run against it: **all 40 pre-existing tests stayed green** — 14 in
`modelPolicy.test.ts`, 9 in `agentBudget.test.ts`, 17 in `modelRouter.negative.test.ts` — and only
the new pin failed, 3 of its 9. The mutation was reverted with `git checkout --` and the tree
verified clean before anything was staged. So the number the log reports is measured, not asserted.

What is pinned is only the OWNER-FACING values: the weekly cap, because K4 says "a hard USD 5.00/week
cap"; the allowed and premium sets, because K4 says which two are on and which two are off; the
premium picks, because K4 admits one only for an ultra-complex task; and contract 11's governance
ladder, because those thresholds are what "restrictive routing" means. Deliberately **not** pinned:
`NOMINAL_TURN_USAGE`, which is a ranking aid tuned from measurement rather than a decision, and the
frozen price snapshot, which contract 09's pricing module pins itself. Pinning those would convert
every future recalibration into a test failure that says nothing. The cap is a POLICY figure in USD —
the ceiling the owner set on provider spend, already published in the steering file and in contract
11 — not an amount in the owner's finances, which is what R24 forbids.

### The acceptance tests of contract 06 §9 and contract 12 §12, and where each one lives

| # | Test | Where |
| - | ---- | ----- |
| T15 | Exhausting one agent's weekly total refuses that agent and leaves the other unaffected — at the router, at the provider belt, and over rows that round-tripped through the engine | `capIsolation.negative.test.ts`, `features/routing/agentBudget.test.ts` |
| T16 | No table accepts a column named in §3.4, asserted against live `table_info` for every table AND the DDL text of every migration; telemetry rejects prompt text at the write path and refuses to serve it from a stored row | `modelTelemetryRepo.test.ts` |
| R16 | A `T0` turn invokes no model: `modelGrant` typed `never`, `classifyTurn` the sole mint, the port unreachable without a grant, 36 adversarial turns leaving the record empty, and a positive control proving the record works | `turnClassifier.test.ts`, `turnDispatch.negative.test.ts`, `t0NoModel.test.ts` |
| R16+17+18 | A `T0` turn is still answered with the cap exhausted, with no registry at all, and with a provisional registry | `t0UnderClosedDoors.test.ts` |
| R17 | An exhausted cap refuses model calls and changes **no** deterministic output — deep equality across an ample run and an exhausted one, over the real Stage 1-4 engines | `deterministicAlerts.negative.test.ts` |
| R18 | A model absent from the registry cannot be named; a provisional registry is refused by the type checker, again behind a cast, at both parse and admit; the fixture path can only produce a provisional document | `eligibilityRegistry.test.ts`, `modelRouter.negative.test.ts`, `provisionalCannotPromote.test.ts` |
| R18 | The roster and the registry disagreeing is an explicit refusal, never a substitution to a different model | `modelRouter.negative.test.ts` |
| R19 | Actual cost cannot be recorded from an estimate and an estimate cannot be recorded as an actual, in either direction, at the type, at the write path, and at the engine's CHECK; the table is append-only whatever the path | `modelTelemetryRepo.test.ts` |
| K4 | The owner's cap, allowed set, premium set, premium picks and governance ladder are pinned to their own literals | `features/routing/k4Constants.test.ts` |

### Verification

- `npm run typecheck` 0 errors; `npm run lint` 0 warnings at `--max-warnings 0`.
- Suite **945 → 1095 across 72 → 83 files** (**+150 tests, +11 files**): 5.1 **+33**
  (`turnClassifier.test.ts` 22, `turnDispatch.negative.test.ts` 7, `t0NoModel.test.ts` 4 — four cases
  driving a 36-turn corpus), 5.2 **+37** (`eligibilityRegistry.test.ts` 20,
  `modelRouter.negative.test.ts` 17), 5.3 **+41** (`modelTelemetryRepo.test.ts`), 5.4 **+39**
  (`capIsolation.negative.test.ts` 11, `provisionalCannotPromote.test.ts` 7,
  `deterministicAlerts.negative.test.ts` 6, `t0UnderClosedDoors.test.ts` 6, `k4Constants.test.ts` 9).
  Every model id, agent, reference, token count and cost figure in every test is synthetic; provider
  cost is integer micro-USD and owner money never appears (R24, steering §0b).
- `npm run verify:all -- --all` — **17 of 19** before the commit, with the two red checks being
  **AC14 (working tree clean)** and **AC15 (push ready)**, both reporting the same uncommitted Phase-5
  work; **19 of 19** after it. **AC12 (contract index and build log agree) PASS**, confirmed after
  editing this log rather than assumed: AC12 reads `contracts/_CONTRACT_INDEX.md` and
  `contracts/_BUILD_LOG.md` — the **original five** build contracts — not this PFOS track, so
  appending here cannot move it. Every pre-existing test still passes, including every scanner
  (`db/isolation.test.ts`, `db/moneyImplementation.test.ts`, `ports/interfaceOnly.test.ts`,
  `mocks/determinism.test.ts`, `signals/schemaParity.test.ts`, `signals/exclusion.test.ts`,
  `telegram/negativeGuards.test.ts`).
- The AC04 floor stays at **331**. Ratcheting it is task 9.1's, and raising it here would take a
  decision that belongs to close-out.
- **One file under `scripts/verify/` was touched, additively, and it is recorded rather than glossed.**
  `ingest-isolation.mjs` gained two entries to `BUNDLE_PROBES` —
  `TURN_MODEL_GRANT_NOT_MINTED` and `ELIGIBILITY_REGISTRY_PROVISIONAL_FLAG_ABSENT`, both typed error
  codes from the new modules — so AC08b now proves the routing tier is absent from the browser bundle
  by looking for strings that only exist in it. That is a **strengthening**: the check does more work
  than before and can only fail in more cases. No check was weakened, relaxed, or edited to make a
  gate pass, no test floor was lowered, no applied migration was edited, and no `ATTACH` statement
  exists anywhere in `src/server/**`.

### Open items that need an owner decision or a later phase, recorded rather than decided here

1. **`src/features/benchmark/eligibility.ts` emits neither a `provisional` marker nor a
   `developerBuild` field, and Phase 6.2 must add both.** Contract 09's aggregator returns
   `ModelEligibility` with `levels: { L0, L1, L2 }`, `disqualified`, `disqualifiers`,
   `reviewerDisagreementBps` and `metrics`. Phase 5.2 reads a registry DOCUMENT whose entries require
   `bands`, `developerBuild` **and** `disqualified`, and whose top level requires an explicit
   `provisional` boolean. The two shapes therefore do not meet yet: a registry emitted by today's
   `buildRegistry` would be refused by `parseEligibilityRegistry` with
   `ELIGIBILITY_REGISTRY_PROVISIONAL_FLAG_ABSENT` and, per entry,
   `ELIGIBILITY_REGISTRY_ENTRY_INVALID` on `developerBuild`. **That is the correct direction to fail
   in** — an unstated developer verdict is not a passing one, and an absent flag is not "not
   provisional" — but it means Phase 6.2 has a concrete, non-optional job: emit `provisional` as a
   literal `true` for a fixture-backed run, and emit `developerBuild` from contract 09's code
   benchmark and repository tests rather than from the finance eval set. Phase 5.2's tests construct
   registry documents directly, so nothing in the tree currently depends on the aggregator producing
   the document shape, and nothing hides the gap either.
2. **`design.md` and the tree disagree about where the spend ledger and telemetry live, and the tree
   was followed.** The design file places both under `src/server/routing/` ("classifier, router, spend
   ledger, telemetry"). The tree puts the **repositories** in `src/server/db/` — `spendLedgerRepo.ts`
   since Phase 1.4, `modelTelemetryRepo.ts` now — with only **pure read models** in
   `src/features/routing/` (`spendLedger.ts`, `modelPolicy.ts`, `agentBudget.ts`). The tree's split is
   the one contract 06 implies, because a repository is a store concern and the weekly total is R5's
   "pure function", and it keeps `src/server/routing/` free of any store handle — which is what lets
   the classifier and the router be tested with no database at all. It is recorded here as a
   divergence to reconcile rather than corrected silently in either direction: the fix is a one-line
   edit to `design.md`, and that edit is an owner-visible change to a spec document.
3. **R18 is now enforced at two boundaries with two vocabularies, on purpose.** Phase 2.2's
   OpenRouter mock refuses an ineligible or provisional model at the **port**, with the shared
   `PortFailureCode` set. Phase 5.2's router refuses at **selection**, with tier-local
   `MODEL_ROUTING_*` codes. That is not duplication to be collapsed. The port's refusal is the belt
   that holds when something bypasses the router entirely — which is exactly the case a router-only
   guard cannot cover — and the router's refusal is the one that can say WHICH requirement was unmet
   at WHICH tier, which a generic port code cannot express. Collapsing them would lose one property or
   the other. Recorded so a later tidy-up does not read two error vocabularies as an accident.
4. **`MODEL_ROUTING_NO_MODEL_SELECTED` is unreachable today, and the test asserts the precondition
   instead of contriving a path.** It fires only if `selectModel` returns a null pick for a reason
   other than the budget, which requires a tier's capable set and K4's allowed set to stop
   intersecting — the budget cases that also yield a null pick are caught one branch earlier by
   `MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED`. Rather than fabricate a fake roster to drive the branch, the
   test asserts the **precondition**: that `TIER_CAPABLE[tier]` and `DEFAULT_ALLOWED` intersect at
   every model-bearing tier. So the day contract 10's roster changes, the branch becomes reachable
   **knowingly** — the precondition test fails and names the tier — rather than becoming reachable
   silently behind a guard nobody has exercised.

### Known gaps, recorded honestly because they are real and unclosed

1. **Six of contract 10's seven utility terms are not implemented, and this is a gap rather than a
   design.** §5.2 above records why fabricating them would be worse. But the consequence is that
   selection today is contract 09's hard filters followed by cheapest-capable within K4's allowed set,
   in contract 10's stated roster order — not a scored ranking. A model that is *technically* eligible
   at a tier and *materially worse* at it than another eligible model will be chosen if it is cheaper.
   Phase 6 is what closes this, and until it does, the ordering is an inherited opinion rather than a
   measurement.
2. **Nothing in Phase 5 has ever spoken to a provider.** Every model call is the deterministic mock
   behind `OpenRouterPort`. The channel, the grant checks, the registry, the router and the telemetry
   store are all proved against it, which means latency, provider-side model substitution, the shape
   of a real usage report, and the actual reported cost are all *shapes this tier accepts* rather than
   values it has seen. `model_id_served` exists precisely because a provider may serve another model;
   no test has ever observed one doing it.
3. **`preflight_estimate_micro_usd` has no producer.** The column, the type, the provenance literal
   and the refusals are all in place, and §6.2.1's separation is airtight — but nothing in the tree
   computes a pre-flight estimate yet, so every row written today carries `null`. The gating half of
   §6.2.1 ("an estimate may gate a call") is therefore unimplemented, and the recording half is
   implemented and unexercised by any real estimate.
4. **The five columns migration 007 adds carry defaults the code does not want**, the same shape Phase
   4.3 recorded for `work_queue`. `ALTER TABLE ADD COLUMN ... NOT NULL` requires a default in SQLite,
   so `actual_cost_micro_usd` defaults to `0` and `model_id_served` to the empty string, both
   representable at the DDL level even though `recordTelemetry` refuses an empty served identity. The
   guard is in the repository, not in the schema, and it is per-call-site for the same reason as
   before.
5. **The router is never called from anything.** Phase 4.3's worker still does no real work: the queue
   is durable and retrying, `dispatchTurn` classifies and routes, and no line of code joins the two.
   Which turn facts a real Telegram update produces — who derives `amountOverOwnerThreshold` from a
   parsed bank message, and how — is unwritten, and it is where Phase 7's HTTP surface and the
   deterministic engines have to meet.
6. **`contentBreaches` recognizes prose by length and by control characters, which is a heuristic.** A
   119-character single-line completion inserted directly into `model_id` through the handle would
   pass it. The layers in front make that unreachable through any supported path, and the column set
   is the real guarantee — but layer 4's own rule is a shape test, not a semantic one, and it is
   recorded as such.

### Still gated (unchanged by Phase 5)

- Phase 5 built the routing tier's **decisions** and no part of its network half: no live model call,
  no key, no registry produced from measurement, no request ever sent. The human gates stand: provision
  and harden the host, DNS, create the two bots, mint the two runtime keys with weekly caps, the
  storage consent click, webhook registration, and generate the encryption keypair with the private
  half kept off the box. G7 stays **closed as WONT-DO** per steering §0b.
- The **dev-key carve-out of steering §3 was not used.** No live OpenRouter call was made from any
  machine in this phase. Phase 6.3 is where that decision arises, and it arises with a cap.
- No outbound call from a server process and no production secret, unchanged.

---

## Phase 6 - Benchmark Phase-1: the eval set audited, the registry made readable, and the live run refused (2026-08-07)

**Why.** Phase 5 ended holding a router that could not be fed. Its last recorded open item was blunt:
the artifact `src/features/benchmark/` emits and the document `src/server/routing/eligibilityRegistry.ts`
reads "do not meet yet". Phase 6 is the phase that makes them meet, and it is also the first phase whose
task line contains an `IF`. Steering §3 grants a single network exception — the Phase-1 benchmark, from
the developer machine, on the dev key, over the sanitized eval set — and 6.3 is where that grant is
either taken or declined. It was declined, on a precondition the carve-out does not name.

Three things shaped the work, and each is a refusal to accept a claim on its face.

The **6.1** bar was already met before the phase began: 219 cases against contract 09's 210 floor. So
6.1 was never a padding exercise, and nothing was padded. What it turned out to be is an audit of the
*other* half of its own task line — "sanitized cases only" — which had **zero** mechanical backing. The
**6.2** gap was recorded by Phase 5 and had a concrete shape: an emitted document the reading side
refuses. What was not recorded is that the fix's load-bearing assertion is a **round trip**, not a field
check. And **6.3** had four preconditions in its task line, all four held, and the run was still
impossible.

| Phase | Deliverable | Source | Status |
| ----- | ----------- | ------ | ------ |
| 6.1 | `datasetIntegrity.ts`: 19 gates over every string and number in every case — steering §0b sanitization, contract-09 structural completeness, and money integrity — plus `egpAmountText` replacing float division, and three drift pins | contract 09 §eval set, steering §0b | done |
| 6.2 | `fixtureReplay.ts` + `provisionalRegistry.ts` + `developerBuild.ts`: contract 09's five artifacts, emitted in the shape `eligibilityRegistry.ts` parses, and refused by it as `provisional` on a round trip through disk | contract 09, contract 12 §6.3, steering §3, Phase 5 open item 1 | done |
| 6.3 | `preflight.ts` + `liveModelCaller.ts` + `liveRegistry.ts` + `liveModelCaller.isolation.test.ts`: the whole live path, built and tested against a deterministic transport, and **not run** — the ELSE branch, recorded in `ops/GATE_REGISTER.md` | steering §3, contract 09, contract 12 | done (branch closed as ELSE) |

### 6.1 — the bar was met; the claim beside it had nothing behind it

**What the audit found first, and it is the reason this sub-task exists.** The task line has two halves.
The count half was satisfied: 219 cases, and the distribution is proportional rather than back-loaded
onto one cheap category — `sms_extraction` 52 against 50, `classification` 32 against 30, `dedup` 26
against 25, `safe_to_spend_explanation` 26 against 25, `purchase_decision` 26 against 25, `forecast` 21
against 20, `tool_call` 16 against 15, with `multilingual` and `adversarial` sitting **exactly** on
their floor of 10. Seven of nine categories carry one or two cases of headroom and two carry none; that
is recorded precisely rather than rounded up to "all nine", because a category at exactly its minimum
loses coverage the moment one case is deleted, and a later reader should know which two those are.

The sanitization half had **nothing**. `datasetIntegrity.test.ts` did not exist. `dataset.test.ts`
asserted counts, uniqueness, that the counts sum to the total, and that removing a category invalidates
the set — every one of those a **cardinality** property. Not one line of the repository asserted that a
case carried no URL, no bare domain, no address handle, no opaque identifier, no long numeric
identifier, and no journal-length prose. The claim "sanitized cases only" was true by the care of
whoever wrote the generators, and would have stayed true only for as long as that care held.

So 6.1's deliverable is **19 gates**, and the count is not arbitrary — it is seven forbidden-token
scanners plus twelve structural and money gates, enumerated in `INTEGRITY_GATES` in evaluation order so
the list itself is testable:

- **Steering §0b, seven scanners:** `no_url_scheme`, `no_domain` (a bare `label.tld` with no scheme,
  which is what a hostname looks like in prose), `no_ip_address` (dotted-quad), `no_address_handle`
  (the `local@domain` shape, which covers both a mail address and a bot handle), `no_opaque_identifier`
  (a run of at least 28 characters from the opaque-id alphabet — the shape of a Drive file or folder id),
  `no_long_numeric_identifier` (a digit run past six, which is what a numeric Telegram user id or a full
  account number looks like, and which a masked four-digit tail, a year, and a grouped amount triple all
  sit safely under), and `no_public_key`.
- **Two length gates**, which are §0b's "no journal excerpt" made mechanical: `MAX_CASE_INPUT_CHARS` is
  400 because a case is one event or one instruction, and `MAX_CASE_INPUT_LINES` is 3 because the
  longest legitimate shape in the set is a prompt plus the dedup A/B pair.
- **Contract-09 completeness**, five gates: `has_safety_constraints`, `has_allowable_variation`,
  `valid_severity`, `tier_matches_category`, `expected_kind_matches_category` — contract 09 requires
  every case to define expected structured output, hard safety constraints, allowable variation and
  severity, and before this the requirement was prose — and `p0_category_severity`, which pins the four
  categories where a fabricated field is an automatic failure (`sms_extraction`, `multilingual`,
  `purchase_decision`, `adversarial`) to severity P0 so a case cannot be quietly downgraded to P2.
- **Money integrity**, three gates: `numeric_fields_are_integers` over every number at any depth,
  `amount_is_integer_milliunits` through `assertMoney`, and `amount_text_matches_expected`, which is the
  one that actually caught something. Plus `account_is_masked`.

**Every gate has a proven negative.** `datasetIntegrity.test.ts` is 28 tests, and its shape matters more
than its size: for each forbidden token it constructs a case that carries one and asserts the specific
gate fires by name — not "some problem was reported". A scanner that has only ever been observed passing
is not evidence, which is the argument Phase 5.3 made for its fourth layer and the same argument holds
here. The forbidden tokens in the scanner are **assembled from fragments** (`'co' + 'm'`) for a reason
that is not stylistic: this file must not match itself, and it must not trip the repository's own
scanners, which read tracked files looking for exactly these shapes.

**The real find: `dataset.ts` was doing float arithmetic on money, and AC07 does not catch it.** Three
call sites computed display text as

```
(amountMilli / 1000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
```

That is a division producing a `number` with a fractional part, outside `src/lib/money`, on a value
whose name ends in `Milli`. The money invariant is unambiguous — "NO floating-point money anywhere" —
and the harness misses it, because AC07 scans for `parseFloat`, `Number.parseFloat`, `.toFixed(` and
decimal literals assigned to money-named fields. `/ 1000` is none of those. The bug is real rather than
theoretical: `toLocaleString` with `maximumFractionDigits: 2` **rounds**, so a non-piastre-clean amount
would render text that disagrees with the case's own `expected.amountMilli`, and a model marked wrong
for extracting the amount the text actually showed.

The replacement is `egpAmountText`, integer-only end to end: it asserts the input through `assertMoney`,
takes the digits from the money core's own exact decimal form (`toDecimal`), groups the units with a
string regex, and slices two fractional digits. It **throws** on an amount that is not piastre-clean
rather than truncating, because dropping the third fractional digit silently is precisely the drift the
invariant exists to prevent. `amount_text_matches_expected` then re-derives the text from the expected
amount and compares — so the gate and the renderer disagree loudly if either changes.

**And this is the fourth instance of the drift-gap shape, found and pinned.** Phase 3.4 found it on
R7's 120-character note cap, Phase 4.4 on R11's token length and charset, Phase 5.4 on K4's roster and
weekly cap. The shape is always the same: every assertion is written *relative to* the constant it is
about, which is correct for each assertion taken alone, and collectively leaves the constant free to
move. `dataset.test.ts` asserted `cases.length >= BENCHMARK_MINIMUM_CASES` and each category against
`CATEGORY_MINIMUMS`; lower `BENCHMARK_MINIMUM_CASES` to 10 and every test stays green while contract
09's bar is gone. So three pins were added: `BENCHMARK_MINIMUM_CASES` to `210`, `CATEGORY_MINIMUMS` to
contract 09's nine literals **with their sum checked against the total** (so the nine cannot be
individually plausible and jointly wrong), and `eligibility.ts`'s promotion thresholds to `0.99` /
`0.99` / `0.9`. The L2 reviewer-disagreement threshold is pinned too, and labelled NIZAM-derived in the
test, because contract 09 states only "below threshold" and the number is ours — pinning it makes a
change to it visible rather than authoritative.

### 6.2 — the load-bearing assertion is the round trip, not the field

Phase 5 recorded the gap precisely: `buildRegistry` produced `{ [modelId]: ModelEligibility }`, and
`parseEligibilityRegistry` wants a document with an explicit top-level `provisional` boolean and, per
entry, `bands`, `developerBuild` **and** `disqualified`. Handed today's output it would refuse twice
over — `ELIGIBILITY_REGISTRY_PROVISIONAL_FLAG_ABSENT` at the top and
`ELIGIBILITY_REGISTRY_ENTRY_INVALID` on every entry. Phase 5 called that "the correct direction to fail
in", and it was, but it also meant the benchmark and the router were two halves of a mechanism that had
never been connected.

The emitted document now has **exactly** the three top-level keys `eligibilityRegistry.ts` declares —
`registryVersion`, `provisional`, `entries` — and exactly the four entry keys `modelId`, `bands`,
`developerBuild`, `disqualified`. Not a superset with the extra fields ignored: the reader's shape is the
writer's shape, so a field added on one side is a compile error on the other rather than a value silently
dropped at the boundary.

**What is actually asserted, and why a field check would not have been enough.** A test that built the
document in memory and read `doc.provisional === true` would prove the writer sets a flag. It would not
prove the artifact is *readable* — which is the thing Phase 5 recorded as broken, and the thing a field
check structurally cannot see. So the assertion is a **round trip**: the emitted document is serialized
to text, the text is handed to `parseEligibilityRegistry` **the way the router reads it** — as `unknown`
from a string, not as a typed object passed between functions — and the parse is required to refuse with
`ELIGIBILITY_REGISTRY_PROVISIONAL`. It is asserted four ways, and the fourth is the one that closes the
loop: from **the text that actually reached the sink**, not from a re-serialization of the in-memory
object. A writer that produced a correct object and a subtly different file would pass the first three
and fail the fourth.

The refusal being the *expected* outcome is the point. A fixture-backed run must produce a document the
router declines, and now there is a test that watches it decline, through the real reader, on real text.

**`provisional: true` is copied, not written.** `provisionalRegistryFromFixture` was already in place
from Phase 5.2 — it accepts anything structurally carrying `provisional: true`, which a `LoadedFixture`
does, and returns `ProvisionalEligibilityRegistry`, precisely what `LiveEligibilityRegistry` excludes.
6.2 makes the emitter use that path rather than restating the literal: the flag on the emitted document
comes from the fixture loader's own `provisional: true`, so **hand-writing `false` there is a compile
error** (TS2322 — `false` is not assignable to `true`). Steering §3's rule that a fixture-backed run
yields a provisional registry is now a property of the type graph rather than a line somebody has to
remember. There is no `as` anywhere along the path.

**`developerBuild` is derived, and `unmeasured` is not a pass.** `developerBuild.ts` models the verdict as
a discriminated union with a `measured` member and an `unmeasured` member carrying a `reason`. A
fixture-backed run has not executed a code benchmark or a per-model repository-test pass, so its verdict
is `unmeasured` with reason `fixture_backed_run`, and `developerBuildPasses` answers `false` for it. The
`false` on the emitted entry is therefore **derived from the absence of a measurement** rather than
written as a value — the same discipline as contract 09's "no model promoted from benchmark reputation
alone", applied to the axis nobody measured. Writing `developerBuild: true` on a fixture-backed entry
would be inventing a passing grade for a benchmark that never ran; the union makes it unspellable.

**All five contract-09 artifacts are emitted**, under the names contract 09 gives them: the registry as
`model_eligibility_registry.json`, and per model `benchmark_results.json`, `pricing_snapshot.json`,
`cost_projection.json` and `reviewer_disagreement.json`. The artifact **directory** is
`artifacts/benchmark` and it is **git-ignored**, with the reasoning recorded in `.gitignore` beside the
entry rather than left implicit: the set is regenerable from tracked inputs — the eval set, the recorded
fixture, and `src/server/benchmark` — and a *provisional* registry sitting in a public repository would
look like graded evidence to anyone who found it. Artifact names are checked for directory escape
(`REGISTRY_ARTIFACT_NAME_ESCAPES_DIRECTORY`), because a name is data and a sink writes where it is told.

`fixtureReplay.ts` is the transport half: it maps recorded exchanges onto cases through
`configurableCaller`, which is Phase 2.2's own deterministic loader rather than a second one, and
`src/server/mocks/fixtures/benchmark-phase1-replay.json` is the recorded corpus it replays. The
`serializeOutputs` form is not extended or wrapped — it is **replaced** for registry purposes, because
`{ [modelId]: ModelEligibility }` is not a document any reader in this repository can parse, and keeping
it alongside a parseable one would leave two artifacts with the same job.

**One thing about how this sub-task was reached, recorded because it is unusual.** An interrupted prior
6.2 attempt had left three files in the tree — `fixtureReplay.ts`, `provisionalRegistry.ts` and
`liveRegistry.ts` — with no tests and no log entry. They were **completed rather than rewritten**: each
was read, audited against contract 09 and Phase 5's recorded gap, corrected where it disagreed, and given
its tests. Rewriting from scratch would have been faster to narrate and would have discarded work that
was substantially right; the audit is what makes the claim that they are right worth anything.

### 6.3 — the ELSE branch, and the fifth precondition the task line does not name

The task line reads: **IF** the dev key is present and within its cap, run live and emit a
non-provisional registry; **ELSE** leave provisional and record it in the gate register. The
determination was made and the ELSE branch was taken. Stated plainly, because a phase that ends in a
refusal is where a build log is most tempted to be vague:

- **Dev credential present.** Yes. `.secrets/openrouter.dev.key`, **74 bytes**. Existence and length
  only — the file was **never opened** and its contents have never entered any process, any log, or this
  document.
- **Estimated cost strictly below the ceiling.** Yes. **USD 0.320812 against a USD 1.00 cap — 32%.**
- **Scoped to the two K4-allowed models.** Yes. `xiaomi/mimo-v2.5` and `z-ai/glm-5.2`; the premium pair
  is refused by a gate with no opt-in parameter to supply.
- **Both 6.1 gates green.** Yes — completeness and sanitization.
- **An environment entry resolving the provider base URL.** **No.** And this is the one the carve-out
  never names.

**The fifth precondition, and why an agent supplying it would be the wrong answer.** Phase 2.1's
`OpenRouterPortConfig` states the rule it rests on: *"there is no default endpoint."* The base URL
therefore arrives as the **name** of an environment entry, and an unresolved name fails closed. No entry
in the developer environment resolves it, in any form. Resolving `<MODEL_API_BASE>` is an **operator**
step by `ops/GATE_REGISTER.md`'s own placeholder glossary, so an agent creating the entry would be
*manufacturing the precondition* rather than finding it satisfied — gate discipline rule 4, "never
weaken a gate to make it pass", read in the direction that is easy to miss. The sub-agent declined, and
declining was correct.

The carve-out is written as a binary — the key is either usable or "absent or exhausted". This deployment
is in a **third** state the binary does not have a name for: the key is present, the run is affordable,
and the run is impossible. That correction is written into the gate register rather than smoothed over,
because the next person to read the carve-out will otherwise conclude the key must be missing.

**What was built and tested, so that the operator's remaining job is one step and not six.** Every part
of the live path exists and runs today under test against a deterministic in-memory transport — with no
key, no endpoint, and no network:

- **`preflight.ts`** — a **pessimistic** estimate, and the pessimism is stacked four ways on purpose:
  prompt tokens from `CHARS_PER_PROMPT_TOKEN = 4` (the low end, so token count comes out high),
  `REQUEST_OVERHEAD_TOKENS = 400` added per request, `MAX_OUTPUT_TOKENS_PER_CASE = 512` charged in full
  as though every case saturated its ceiling, and `ESTIMATE_SAFETY_MULTIPLIER = 2` over the lot. An
  estimate that is wrong should be wrong in the direction that refuses a run, never in the direction
  that authorizes one. Two refusal gates sit on it, and the estimate is in integer micro-USD —
  `DEV_KEY_WEEKLY_CAP_MICRO_USD` — so the affordability comparison itself involves no float.
- **`liveModelCaller.ts`** — five properties, each a capability rather than a check.
  **(1)** The credential is an `OpaqueSecret` whose `toString` and `toJSON` both return
  `REDACTION_MARKER`, so the two implicit paths a secret escapes through — string interpolation into a
  log line and `JSON.stringify` of a context object — are closed at the value, not at the call sites.
  `revealSecret` is the single named chokepoint. **(2)** A branded `DeveloperMachineGrant`, minted only
  by `grantDeveloperMachineRun`, which **refuses when a server-runtime marker is present** — steering
  §2's "no outbound network call from a server process" enforced by the module that would make the call,
  rather than by convention about where the module is imported. **(3)** No network primitive of any kind
  exists in the module: no `fetch`, no request module, and **no scheme literal** — asserted by a test.
  The transport is a `LiveTransport` function injected at the moment of the run, so the network
  capability lives nowhere in this repository. **(4)** Stop on first failure, with **no retry loop**: a
  partial run falls back to the fixture path rather than emitting a half-measured registry, and a
  refusal retried in a loop is how a USD 1.00 cap becomes a surprise. **(5)** No correct-answer baseline
  is available to the caller, so an **unanswered case refuses rather than scoring as correct** — the
  failure mode where a model that returned nothing grades perfectly.
- **`liveRegistry.ts`** — `provisional: false` is reachable only downstream of a
  `LiveMeasurementWitness`. A run that did not answer every case cannot produce a non-provisional
  document, and there is no flag that overrides it.
- **`liveModelCaller.isolation.test.ts`** — a **five-part reachability argument** with non-vacuity belts:
  each part asserts that a capability is absent, and each is paired with an assertion that the same
  probe *would* find the capability if it were there. An absence proved by a probe that can never find
  anything is not a proof, which is the positive-control discipline Phase 5.1 used on its 36-turn corpus.

**The real bug the tests caught, and it would have inverted the result of every live run.** The
fabrication detector scans a model's response for numbers the model was not given — contract 09's
automatic-failure outcome for a fabricated field. It flagged the model's own **`confidenceBps`**. The
reason is that a basis-point confidence is drawn from a fixed 0–10000 scale, so its digits are
*structurally* indistinguishable from an invented figure: a model answering perfectly, with a
well-formed confidence on every case, was graded a **total P0 failure** across the board. Left in, the
first live run would have produced a registry disqualifying both models and the disqualification would
have looked like a finding. The fix is `FABRICATION_SCAN_EXEMPT_KEYS` — response **metadata** rather than
asserted answers — and it deliberately keeps **`toolCalls` in scope**, because a fabricated argument to a
tool call is exactly the failure the detector exists to catch and exempting the whole response envelope
would have been the easy over-correction.

### The acceptance criteria of contract 09 and steering §0b/§3, and where each one lives

| # | Test | Where |
| - | ---- | ----- |
| C09 eval set | 219 cases against the 210 floor, every per-category minimum met, ids unique, counts summing to the total, and an under-count invalidating the set | `dataset.test.ts` |
| C09 eval set | Every case defines expected structured output, hard safety constraints, allowable variation and severity; expected kind matches category; the four fabrication-critical categories are P0 | `datasetIntegrity.test.ts` |
| §0b | No case carries a URL scheme, a bare domain, a dotted-quad, an address/bot handle, an opaque Drive-style id, a long numeric id, or an age public key — each gate driven by a case that carries one and asserted **by gate name** | `datasetIntegrity.test.ts` |
| §0b | No case is journal-length: 400 characters and 3 lines, both pinned | `datasetIntegrity.test.ts` |
| Money | Every number in every case is an integer; every amount passes `assertMoney`; the rendered display text is re-derived from the expected amount and compared; a non-piastre-clean amount throws rather than rounding | `datasetIntegrity.test.ts`, `dataset.test.ts` |
| Drift | Contract 09's case bar, its nine category minimums **and their sum**, and the L0/L1/L2 promotion thresholds are pinned to their own literals | `dataset.test.ts`, `eligibility.test.ts` |
| §3 + C12 §6.3 | The emitted registry, re-read from **the text that reached the sink** exactly as the router reads it, is refused with `ELIGIBILITY_REGISTRY_PROVISIONAL` — asserted four ways | `provisionalRegistry.test.ts` |
| §3 | `provisional: true` is copied from the fixture loader's own literal; writing `false` is a compile error | `provisionalRegistry.test.ts` |
| C09 | `developerBuild` on a fixture-backed entry is `unmeasured`/`fixture_backed_run` and answers `false`; an injected passing verdict is refused | `developerBuild.test.ts`, `provisionalRegistry.test.ts` |
| C09 | All five artifacts emitted under contract 09's own names; an artifact name that escapes the directory is refused | `provisionalRegistry.test.ts` |
| §3 | The estimate is pessimistic on all four axes and both refusal gates fire; affordability is integer micro-USD | `preflight.test.ts` |
| §2 | The credential redacts through `toString` **and** `toJSON`; the developer-machine grant refuses when a server-runtime marker is present; an unanswered case refuses instead of scoring correct; a failure stops the run with no retry | `liveModelCaller.test.ts` |
| §2 | The module holds no request primitive, no request module and no scheme literal — five absence proofs, each with a non-vacuity control | `liveModelCaller.isolation.test.ts` |
| C09 | `provisional: false` is reachable only downstream of a measurement witness; an incomplete run cannot emit | `liveRegistry.test.ts` |

### Verification

- `npm run typecheck` 0 errors; `npm run lint` 0 warnings at `--max-warnings 0`.
- Suite **1095 → 1262 across 83 → 91 files** (**+167 tests, +8 files**): 6.1 **+30**
  (`datasetIntegrity.test.ts` 28, plus the two drift pins added to `dataset.test.ts` and
  `eligibility.test.ts`), 6.2 **+48** (`provisionalRegistry.test.ts` 25, `fixtureReplay.test.ts` 18,
  `developerBuild.test.ts` 5), 6.3 **+89** (`liveModelCaller.test.ts` 41,
  `liveModelCaller.isolation.test.ts` 18, `preflight.test.ts` 17, `liveRegistry.test.ts` 13). Every
  model id, amount, account, merchant tail and cost figure in every test is synthetic; provider cost is
  integer micro-USD and owner money never appears (R24, steering §0b).
- `npm run verify:all -- --all` — **`verification harness: 17 of 19 executed checks passed`** before the
  commits, the two red checks being **AC14 (working tree clean)** and **AC15 (push ready)**, both
  reporting the same uncommitted Phase-6 work; **`verification harness: 19 of 19 executed checks
  passed`** after them. Every pre-existing test still passes, including every scanner.
- The AC04 floor stays at **331**. Ratcheting it is task **9.1**'s, and raising it here would take a
  decision that belongs to close-out.
- **No check was weakened and nothing was invented to reach the 6.3 outcome.** `scripts/verify/all.mjs`
  was not touched. The `AC04 --min` floor was not touched. No migration was edited. No network call was
  made from any machine in this phase. `.secrets/` was never read: the dev credential's **existence and
  byte length** were observed and nothing else, and no endpoint, no key material and no host particular
  appears in any file this phase added.
- **One untracked file at the repository root was resolved as housekeeping, not as spec work.**
  `jiggle.ps1` is a local mouse-jiggler that keeps a workstation awake. It is imported by nothing, has
  no project role, and contains no deployment particular and no secret — it was read in full and scanned
  before the decision. It is **git-ignored**, in its own `chore:` commit, with the reason recorded beside
  the entry. It was **not deleted**: it belongs to whoever is sitting at the machine.

### Open items that need an owner decision or a later phase, recorded rather than decided here

1. **The eval set names real banks and merchants, and task 9.0 must settle this deliberately rather than
   by omission.** The set carries `CIB`, `HSBC`, `NBE`, `QNB`, `CARREFOUR`, `TALABAT`, `VODAFONE` and
   `بنك مصر`, among others. Steering §0b bans "any real ... payee" in a fixture, so read literally these
   are violations. Against that: `src/lib/db/schema.ts` has shipped `CIB_DEBIT` and `HSBC_CC` as
   `AccountType` values **since Contract 1**, and roughly a dozen committed tests use them — so the
   repository has treated a bank *name* as a schema-level enumeration, not as a payee, for the whole
   build. The two readings cannot both stand. **9.0 owns the fixture scanner, so 9.0 is where this is
   decided**, and it must be decided rather than left to whichever way the scanner's regex happens to
   fall. Note the cost of the strict reading: renaming would need semantically-loaded synthetic names,
   because a classification case that maps `MERCHANT_17` to `Groceries` is unsolvable — the merchant
   name *is* the signal being tested.
2. **A real Google Drive folder id is committed**, at `contracts/pfos/_PFOS_CONTRACT_INDEX.md` line 4,
   and `_INGESTION_MANIFEST.json` carries long identifier strings that need triage (its SHA-256 digests
   are legitimate; a Drive **file** id is not). This **predates this build** — it was written by the
   ingestion run on 2026-08-05 — and steering §0b names "Google Drive folder ids, file ids" explicitly.
   9.0's scanner as currently scoped reads `ops/**` and fixtures, so **it would not catch this.** The
   options are a widened scope plus redaction, or a recorded reviewed exception. Doing neither leaves a
   §0b violation in a public repository behind a check that structurally cannot see it.
3. **`.secrets/KEYS_TODO.md` still says live LLM calls are blocked until the VPS exists.** That
   prohibition is superseded by steering §3's dev-key carve-out, but the stale sentence is sitting in the
   same directory as the key, which is the worst place for it: the next reader reaches for the key and
   finds a note telling them not to use it.
4. **`ops/GATE_REGISTER.md`'s G4 entry can be read two ways.** Its "Unblocks" section can be read as
   gating 6.3 on G4, while the later carve-out section says G4 gates **routing** and the carve-out buys
   the **registry**. The second reading is the one steering §3 supports and the one this phase acted on.
   The two sections should be reconciled so a future operator does not conclude that the benchmark needs
   a runtime key it does not need.
5. **Even a fully measured live registry leaves contract 10's T4 unroutable.** Contract 09 grades
   developer/build work "separate from live finance eligibility", so a run over the **finance** eval set
   leaves the developer verdict `unmeasured` and `developerBuildPasses` answers `false` — on **every**
   entry. `T4` therefore resolves to no eligible model even after a perfect live run. That is contract 09
   being honoured rather than a bug, and it is recorded because it will surprise: making T4 routable needs
   a **code** benchmark against a separate corpus, which is a separate exercise nobody has scheduled.
6. **`ModelCaller` is synchronous, so the live path is necessarily two-phase.** Async collection followed
   by synchronous replay. A consequence worth writing down: the live adapter can be **neither** a
   `ModelCaller` **nor** an `OpenRouterPort` implementation. Not a `ModelCaller` because that interface is
   sync; not an `OpenRouterPort` because **AC08b flags any textual import of `src/server/**` from a
   non-server `src` file, including `import type`** — a type-only import that vanishes at compile time is
   still a string in the file the scanner reads. So `liveModelCaller.ts` declares
   **structurally-compatible** types in its own tier rather than importing the port's. That is deliberate
   duplication, and it is the kind a later tidy-up will want to collapse; collapsing it would break
   AC08b.

### Known gaps, recorded honestly because they are real and unclosed

1. **Nothing in this phase has spoken to a provider either.** Phase 5's gap 2 stands unchanged and now
   has a sharper edge: the live path exists, is tested, and has never run. Latency, provider-side model
   substitution, the true shape of a usage report, and the actual reported cost remain **shapes the code
   accepts** rather than values it has seen. The pessimistic estimate has never been compared to a real
   invoice.
2. **The registry the router can read is the one it refuses.** 6.2 closed the parse gap; it did not
   produce a routable registry, and by steering §3 it could not. So contract 10's routing tier still has
   no admitted registry, and `AdmittedRegistry` still cannot be constructed in this tree from any
   available input.
3. **Two categories sit exactly on their floor.** `multilingual` and `adversarial` are at 10 against a
   minimum of 10, so deleting one case in either breaks the bar. Recorded rather than fixed, because
   adding cases to reach headroom is the padding 6.1 deliberately did not do — but a later reader
   editing those generators should know there is none.
4. **`egpAmountText` throwing is correct and unexercised by the shipped set.** Every amount in the eval
   set is piastre-clean, so the `RangeError` path is reached only by its own negative test. The guard is
   real; the condition has never occurred in production data because there is none.
5. **`FABRICATION_SCAN_EXEMPT_KEYS` is a list, which means it is a maintenance surface.** The
   `confidenceBps` bug was a *false positive* that inverted a whole run; the failure mode of the fix is a
   *false negative* if a future response field carrying an asserted answer is added to the exempt list by
   analogy with metadata. `toolCalls` is deliberately in scope as the marker of where that line sits, and
   the reasoning is in the module — but the discipline is a comment, not a mechanism.
6. **Six of contract 10's seven utility terms are still unimplemented.** Phase 5's gap 1 stands
   unchanged, and Phase 6 is the phase that was supposed to close it. It does not, because the terms need
   a **measured** run and the measured run did not happen. Selection is still contract 09's hard filters
   followed by cheapest-capable within K4's allowed set, in contract 10's stated roster order.

### Still gated (unchanged by Phase 6, except where noted)

- The **dev-key carve-out of steering §3 was evaluated and not exercised.** No live OpenRouter call was
  made from any machine. The registry remains fixture-backed and `provisional: true`, and live routing is
  still gated on **G4**. The full determination — all five preconditions, the operator's remaining steps,
  and the verification lines to record afterwards — is in `ops/GATE_REGISTER.md` under *"Recorded
  observation - registry is PROVISIONAL as of 2026-08-07"*.
- The human gates stand unchanged: provision and harden the host, DNS, create the two bots, mint the two
  runtime keys with weekly caps, the storage consent click, webhook registration, and generate the
  encryption keypair with the private half kept off the box. G7 stays **closed as WONT-DO** per steering
  §0b.
- One **new** operator step is now recorded that was not previously named: resolve `<MODEL_API_BASE>` into
  the developer environment, and supply the transport function, if and when the owner authorizes the live
  benchmark spend.
- No outbound call from a server process and no production secret, unchanged.

---

## Task 7.6 - the rollback and disaster-recovery runbooks, and the rate-limit posture, checked by reading them (2026-08-09)

**Why.** Contract 12 §7.4 and §7.5 are procedures, and §5.5/§2.3 is a posture. All three are prose, and
prose is the one artifact in this repository with no compiler. Steering §2 permits writing an ops
document and forbids running it, so the only remaining way to know a runbook still describes the system
it claims to describe is to READ it - mechanically, on every test run, against the artifacts it quotes.
A runbook does not rot by becoming wrong on its own terms; it rots by staying internally consistent
about a system that moved underneath it. A migration lands and the recorded schema version goes stale.
The restore template's step order is revised and the runbook still quotes the old one. A service is
renamed and the image reference an operator is told to change no longer exists. Each of those is
silent, and each surfaces at the exact moment nobody has time to notice it.

### Work

- `ops/runbook/ROLLBACK.md` (274 lines) - §7.4. Rollback by image tag, never by rebuild; a rollback
  **across** a migration refuses to reverse the migration and routes through the restore drill instead;
  the write-ahead-log sidecar determination with its outcomes enumerated and the copy-only fallback
  refused; deployment order for a change that carries a migration; promotion kept separate from
  rollback; and the rollback recorded afterwards. Every `### Step N` block carries a `**VERIFY:**` line,
  because a step whose result an operator cannot check is a step they will believe they completed.
- `ops/runbook/DISASTER_RECOVERY.md` (188 lines) - §7.5. Blast radius with its four mitigations named;
  a recovery objective bound to the backup **cadence** rather than to a wished-for number; the rebuild
  path in order; coverage of all three stores; secrets stated as **unrecoverable** rather than as
  restorable; degraded operation while the endpoint is unavailable, with every transport guard still
  intact; and the drill named as the prerequisite rather than as the recovery.
- `ops/runbook/RATE_LIMIT_POSTURE.md` (164 lines) - §5.5/§2.3. Each documented provider limit carries a
  `Documented:` line with its quantity and its provenance, then the posture taken against it. A refusal
  is handled as a **queue** failure rather than as a lost update; `Retry-After` is honoured rather than
  guessed at; the connection ceiling is deliberately low; and the long-poll degraded mode is named as
  the configuration choice §2.3 makes it, not as a code path. **No number here was discovered by
  exceeding a limit.** A limit is documentation; probing it is a live call, which §2 forbids.
- `src/server/ops/runbookTemplate.ts` - the structural checker. It parses the three documents into a
  narrow markdown subset (`## ` sections, `### Step N -` / `### Limit N -` blocks, fenced code) and
  reports **52 finding codes**. It prefers cross-reading a real artifact over asserting a copy: the
  drill sequence quoted in ROLLBACK.md is compared against `ops/restore/restore.sh` **through that
  template's own parser** (`parseShellScript`, `RESTORE_SEQUENCE`); the recorded migration version
  against the migration series; every image reference against the topology's declarations; every
  `${ENTRY}` and `<PLACEHOLDER>` against a vocabulary assembled from `ops/env/**`, the topology, the
  gate register and the two shell templates; every gate named against `ops/GATE_REGISTER.md`; and the
  health-probe invocation by the probe's **own** parser (`parseProbeInvocation`). R24 is not
  reimplemented - the one no-deployment-particular scan in `./composeTemplate` is called and its
  findings re-reported, with a code this checker has no equivalent for becoming
  `PARTICULAR_SCAN_UNMAPPED` rather than being dropped, because silently discarding a finding from a
  fail-closed scan turns a widened rule into a narrowed one.
- **It fails closed.** An unreadable document, an unreadable companion, a document outside the subset,
  a missing section, a section nobody declared, an out-of-order procedure, and a step with no
  verification line are all findings rather than skips.

### Verification

- `npm run typecheck` 0 errors; `npm run lint` 0 warnings at `--max-warnings 0`.
- `src/server/ops/runbookTemplate.test.ts` - **67 tests**. Every one of the **52** finding codes has a
  negative case: the test mutates the **real** file on disk in memory and asserts the code **by name**,
  and a closing coverage assertion fails if any code has no case, so the count cannot drift. The
  mutations are the ones that matter rather than the ones that are easy - the drill pair swapped to
  `decrypt_artifact -> verify_artifact_integrity` (integrity after trust), a secret entry given a
  pasted value, a migration reversal permitted, the connection ceiling raised, the transport mode left
  unnamed. Each of the three documents also asserts an **empty** finding list as it stands, which is
  the assertion that makes the other 52 mean anything: a checker that reports nothing on a mutated file
  and nothing on a clean one has proven nothing.
- Suite **1606 tests across 98 files**, all passing; `src/server/ops/` contributes **344** of them
  (`composeTemplate` 64, `backupScripts` 58, `caddyTemplate` 50, `envTemplates` 44, `redactedLogger`
  37, `healthProbe` 24, `runbookTemplate` 67).
- `npm run verify:all -- --all` - **`HARNESS PASSED`, `19 of 19 executed checks passed`**. Before this
  increment's commit the harness reported **17 of 19**, the two red checks being **AC14 (working tree
  clean)** and **AC15 (push ready)**, both reporting the same uncommitted Phase-7 work and nothing else.
- The AC04 floor stays at **331**. Ratcheting it to 1606 is task **9.1** and it happens there; raising
  it here would take a close-out decision early.
- **No check was weakened.** `scripts/verify/all.mjs` was not touched, no assertion was loosened, no
  test was skipped or deleted, and no scanner was given an exemption. The only harness edit in this
  increment is task 7.5's, which **adds** two bundle probes to `scripts/verify/ingest-isolation.mjs`
  (`queue_worker_not_reporting`, `no_field_beyond_the_record_shape`) so AC08's browser-bundle check
  fails if either 7.5 module reaches the app bundle.
- Every tracked file in this commit was re-scanned for a deployment particular before staging: no
  hostname or domain, no address literal, no Drive id, no bot handle or numeric id, no port, no
  encryption public key, no monetary figure, no secret value. `ops/**` is `<ANGLE_BRACKET>`
  placeholders throughout - including the two webhook path segments, for which there is deliberately
  no example, no redacted stand-in of the right length, and no comment showing the shape.

### Honest scope note

**Nothing was executed.** No shell ran, no container was built or started, no store was opened by an
ops artifact, and no network call was made from any machine in this task. The three runbooks are
validated **as text, by their own checker**: `runbookTemplate.ts` reads them with `readFileSync` and
parses strings. `ops/restore/restore.sh` is likewise read as text and never invoked, and the
health-probe invocation quoted inside ROLLBACK.md is checked by parsing the string - the probe is not
run. So what is proven here is that the documents say what contract 12 requires and that they still
agree with the artifacts they quote. What is **not** proven is that any procedure in them works: no
rollback has been performed, no restore drill has been rehearsed, no degraded long-poll mode has been
entered, and not one of the documented provider limits has been observed in the wild. Their first real
execution will be by a human, on a host that does not exist yet, and this task's value is that the
document they open on that day will not be describing a system from two months earlier.

### Still gated

- **G1-G8 are untouched**, and none was attempted: G1 provision and harden the host; G2 DNS for the two
  hostnames; G3 create the two bots; G4 mint the two runtime keys with their weekly caps; G5 the
  storage consent click; G6 register both webhooks; G8 generate the encryption keypair and keep the
  private half off the box. G7 remains **closed as WONT-DO** per steering §0b.
- The runbooks name those gates as prerequisites and refuse to stand in for them; every gate reference
  in the prose is checked against `ops/GATE_REGISTER.md`, so a runbook cannot quietly invent one.
- No outbound call from a server process and no production secret, unchanged.

## Tasks 8.1-8.4 - the cross-repo change series, emitted as text that does not pretend to be a patch (2026-08-09)

### Work

Phase 8 of `.kiro/specs/06-two-agent-vps/tasks.md`, as one increment. Steering §6 forbids this
repository's agent from cloning, fetching, reading, modifying or pushing the life agent's repository,
so the three changes needed there are emitted here and applied later by a human in a session opened
on that repository.

**The form, decided first, because it decides everything else.** A unified diff needs three things:
target paths, changed lines, and enough surrounding context to locate each hunk. The first two can be
written from documented interfaces; the third cannot, because context lines are a verbatim quotation
of a file this session may not read. So all three files are **explicitly-labelled change
specifications, not applicable unified diffs** - one form, applied uniformly, so a reviewer learns one
shape and reads it three times. Each opens with a header block declaring `FORM`, `TARGET REPOSITORY`,
`TARGET BRANCH`, `TARGET FILES`, `SUBJECT`, `AUTHORED BY`, `AUTHORED FROM` and `NOT VERIFIED`; each
names, under `NOT VERIFIED`, the specific things that could not be determined from here. **No `index`
line and no blob hash appears anywhere in the series**, because a blob hash is a content address that
can only be computed from bytes nobody here read, and a plausible-looking one would make an
unverified change look verified.

- **`ops/nizamcore-patches/001-fastapi-wrapper.patch`** - an ASGI front end that WRAPS the existing
  update handler. The handler is imported and called, never rewritten, copied or inlined; the
  secret-token header is read and passed through unchanged so the constant-time comparison, the
  allowlist and the dedup call all stay on the new path; the long-poll fallback stays exactly as it
  is. Two new files in full: the module, and a test file whose first four tests drive the ROUTE rather
  than the handler, because the risk in a transport swap is not that the new server fails - a failing
  server is obvious - but that it succeeds while a check no longer runs. `/healthz` answers
  **readiness, not liveness**, and its status mapping fails closed on an unrecognized verdict: a
  default of success would turn every unmapped outcome into an acknowledged delivery, which is how a
  dropped guard stops being visible. Two things the specification could not read are stated as such
  and listed first in its verification section: the handler's return contract, and whether all three
  guards live inside the handler or partly in the request handler being replaced.
- **`ops/nizamcore-patches/002-dedup-per-bot.patch`** - the dedup key becomes the pair
  `(bot_id, update_id)`. Framed as a **correctness fix, not a refinement**: update identifiers are
  per-bot sequences, so two bots both emit 1, then 2, and a store keyed on the identifier alone
  discards the second bot's unrelated update. The failure presents as one bot going quiet for no
  visible reason, which reads as a network problem and is not one. Semantics mirror this repository's
  own `src/server/telegram/updateDedupRepo.ts` deliberately rather than inventing a second scheme:
  the claim IS the decision (no read-then-write), a duplicate is a **success** and not an error, and
  there is no "have I seen this" predicate to pair with a conditional write. Three existing properties
  are preserved - the atomic replace, the bound, and duplicate-as-success - and one is added: **the
  bound is per bot**, because one shared ring holding pairs would let a chatty bot evict the quiet
  bot's window and re-open its replay gap. The version-1 state file's bare identifiers are adopted
  conservatively, with the reasoning for the direction written out.
- **`ops/nizamcore-patches/003-signalbus-egress-target.patch`** - a `signalbus` egress target,
  eligible for `money_safe` and `life_safe` and for nothing else, added neither to `strict_local` nor
  to any other pre-existing tier: content in an existing tier reaches the bus only by being reduced to
  a directional signal first, and that reduction is an act at a call site rather than a permission in
  the matrix. **The family classification's egress set stays empty**, restated as a requirement,
  asserted at import in the module and again in a test, with three code shapes that would widen it
  refused by the checker. The envelope shape is reproduced for the reviewer, note cap included.
- **`ops/nizamcore-patches/README.md`** - the apply order **001 → 002 → 003 with a reason for each
  position** (001 is purely additive and stands up the harness 002's key test needs; 002 is the only
  change that migrates state, so it lands when the surface above it is settled; 003 is independent of
  the transport and is the only change that widens what may leave the machine, so it lands when the
  two mechanical changes are already green and a bisect would find a one-concern commit). Per-change
  apply-and-verify commands, a `--3way` note for anyone converting a section into a diff, the expected
  test deltas as a table, and an explicit statement that applying happens in a **separate session
  opened on the other repository, never from here**.

**One artifact-level decision worth recording.** 003 names the family classification's key as
`<FAMILY_CLASSIFICATION>` rather than writing it. That is not squeamishness: contract 12 §4.4.3 holds
that no artifact of this tier names, counts, summarizes or points at that content, and
`src/server/signals/exclusion.test.ts` enforces it across `src/server/**` and `ops/**`. The first
draft of 003 wrote the key out and **the suite caught it** - four failures in that scan. The fix was to
the artifact, not to the scanner: no root was narrowed, no exemption was added, and the enumerated
refusal-test list was not extended. The placeholder also makes the specification slightly better,
because substituting it forces the human to open the policy document and read the row, which is the
one verification item in 003 that is not delegable to a test.

**New checker: `src/server/ops/patchSeries.ts`.** A pure text-in / findings-out module in the
established `src/server/ops/` shape, with **55 finding codes**. It reads the four artifacts and holds
them to the honesty they claim: the header fields are present and non-empty, the form is declared, the
target repository and branch are the expected ones, the authorship caveat and the provenance document
are named, no fabricated `index` line appears, and **no sentence claims applicability except inside a
sentence that denies it** (the check is sentence-scoped with a negation set, so "no claim is made that
it applies cleanly" passes and "this applies cleanly" does not). It also cross-reads: every declared
target file must be discussed below the header, the README's stated apply order must equal the file
numbering, every change must have a test delta and a verification block, and the baseline must be
**labelled as read from a document rather than observed**.

R24 is re-reported from the ONE shared scan in `composeTemplate.ts`, with a code the shared scan
produces that this checker has no equivalent for surfacing as `PARTICULAR_SCAN_UNMAPPED` rather than
being dropped. Because these are the only tracked artifacts here that quote another language's source,
the shared scan's hostname heuristic would read `os.replace` and `webhook.py` as hostnames. Rather
than loosen that heuristic - which would loosen it everywhere - the checker masks an **explicit,
enumerated list** of 61 dotted tokens before running the scan and reports any dotted token NOT on that
list as `DOTTED_TOKEN_UNDECLARED`. The result is stricter than the heuristic, not weaker: a hostname is
on nobody's list, so it is reported twice, and a test asserts every declared token is actually used, so
the list cannot go stale or over-broad.

### Verification

- `npm run typecheck` 0 errors; `npm run lint` 0 warnings at `--max-warnings 0`.
- `src/server/ops/patchSeries.test.ts` - **72 tests**. Every one of the **55** finding codes has a
  negative case: the test mutates the **real** file on disk in memory and asserts the code **by
  name**, and a closing coverage assertion fails if any code has no case. The mutations are the ones
  that matter rather than the ones that are easy - an `index` line with a hash pair injected into 001,
  "this applies cleanly" injected as an unqualified claim, the authorship caveat softened from "never
  cloned" to "rarely cloned", the provenance document replaced by the phrase "the architecture note",
  the family row turned from `== set()` into an assignment carrying the bus, the README's stated order
  reversed to 003 → 001, the per-bot bound reworded to a shared one, and the transport's constant-time
  comparison and allowlist each removed in turn. The four artifacts also assert an **empty** finding
  list as they stand, which is what makes the other 55 mean anything.
- Suite **1678 tests across 99 files**, all passing; `src/server/ops/` contributes **416** of them.
- `npm run verify:all -- --all` - **`HARNESS PASSED`, `19 of 19 executed checks passed`**. Before this
  increment's commit the harness reported **17 of 19**, the two red checks being **AC14 (working tree
  clean)** and **AC15 (push ready)**, both reporting the same uncommitted Phase-8 work and nothing
  else.
- The AC04 floor stays at **331**. Ratcheting it is task **9.1** and it happens there.
- **No check was weakened.** `scripts/verify/all.mjs` was not touched, no assertion was loosened, no
  test was skipped or deleted, no floor was lowered, and no scanner was given an exemption - including
  the one that failed on the first draft of 003. The only edits outside the four new artifacts and the
  two new source files are the four ticked boxes in `tasks.md` and this log section.
- Every one of the four artifacts was re-scanned for a deployment particular: no hostname or domain,
  no address literal, no storage identifier, no bot handle or numeric identifier, no port, no monetary
  figure, no secret value. The one route literal in 001's test file is a synthetic test-only segment,
  and the two bind values in the service command are `<ANGLE_BRACKET>` placeholders.

### Honest scope note

**The patches are unapplied, and they are unappliable from here.** Nobody has applied them; nobody has
run the target repository's suite against them; no claim is made that any of them applies cleanly,
compiles, or passes. Every statement they make about the other repository is sourced from documentation
in **this** repository - sections 0, 1.3, 1.5, 2.1 and 3.1 of `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md`
- and each file names that source in its own header. The 55-passing / 14-subtest baseline the deltas are
measured against was **read from that note, not observed**, and all three files and the README say so;
the three predicted totals (62, 69, 74) are predictions from a session that could not run the suite, and
they are labelled as such so a human can tell an expected delta from a surprise.

**The other repository was never read, cloned, fetched, modified or pushed.** No `git clone`, no
`git fetch`, no `git apply`, no submodule, no vendored checkout, no network request to any code host.
Nothing in this increment was executed: no shell ran an ops artifact, no container was built or
started, no store was opened, and no provider was called. What is proven here is that four text files
say what Phase 8 requires and that they do not overclaim. What is **not** proven is that any change in
them is correct against the code it describes - the two items 001 lists first under "what a human must
verify" are exactly the places where it could be wrong, and 002's existing-test delta is explicitly
**not zero** for the same reason.

### Still gated

- **G1-G8 are untouched**, and none was attempted: G1 provision and harden the host; G2 DNS for the
  two hostnames; G3 create the two bots; G4 mint the two runtime keys with their weekly caps; G5 the
  storage consent click; G6 register both webhooks; G8 generate the encryption keypair and keep the
  private half off the box. G7 remains **closed as WONT-DO** per steering §0b.
- **Applying this series is itself a human step in another repository**, and it is not in the G1-G8
  register because it is not a deployment gate - it is a cross-repo handoff. Until a human performs it,
  the correct status of all three changes is *emitted, unapplied*, and nothing here reports otherwise.
- No outbound call from a server process and no production secret, unchanged.

---

## Policy hygiene - five owner-approved resolutions, none of them a numbered task (2026-08-09)

> Spec: `.kiro/specs/06-two-agent-vps`. Owner-approved verbatim; this increment implements them and
> re-litigates none. **No numbered task box was ticked** - task 9.0 (the no-deployment-particular
> harness check), 9.1 (the AC04 floor) and 9.3 (completing the gate register) remain open and were
> deliberately not started here.

### Work

**1. `scripts/server/` retired.** `Caddyfile`, `deploy.sh` and `harden.sh` are gone via `git rm`.
They predate Phase 7 and are superseded by `ops/` plus `ops/GATE_REGISTER.md`, which is now the only
deployment surface. Two proxy configurations in one repository is an operational hazard at G1 because
an operator can install the wrong one, and the old one routed a single host to a single app under a
real-looking example domain that named the owner. **The whole tracked tree was grepped for the three
paths before deleting anything, and there were no references at all** - not in a doc, a contract, a
README, a script, the harness or any checker. The three files referenced only each other, and
`scripts/server/harden.sh` additionally carried a literal SSH public key, which is a second reason
it had to go. Git history retains all three, so this is reversible. Two things that survive and are
*not* the deleted file: `ops/Caddyfile` (the Phase 7.2 template, audited by
`src/server/ops/caddyTemplate.ts`) and the many `/etc/caddy/Caddyfile` **container target paths** in
`ops/docker-compose.yml` and the env templates, which name where a file is mounted inside a service
rather than a file in this repository.

**2. Storage identifiers redacted - six occurrences across four files.** The finding in
`docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md` §0 is *kept intact*; only the literal changed. The
security point was never the value - it is that the **other** repository commits that identifier in
several of its files - and that point survives redaction word for word. The sweep then found five
more, none of them in the file the owner named:

| File | What | Now |
|---|---|---|
| `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md` §0 | the other repository's folder identifier | `<LIFE_DRIVE_FOLDER_ID>` |
| `contracts/pfos/_PFOS_CONTRACT_INDEX.md` header | the contract source folder identifier | `<PFOS_SOURCE_FOLDER_ID>` |
| `contracts/pfos/_INGESTION_MANIFEST.json` `source_folder.id` | same folder identifier | `<PFOS_SOURCE_FOLDER_ID>` |
| `contracts/pfos/_INGESTION_MANIFEST.json` `files[].source_id` x4 | four contract **file** identifiers | `<PFOS_SOURCE_FILE_ID_01..04>` |
| `scripts/ingest/pfos-drive-pull.mjs` | the folder identifier as a hardcoded `--folder` default | resolved from `PFOS_SOURCE_FOLDER_ID` or `--folder`, and **fails closed** with an exit code when neither is supplied |
| `scripts/server/harden.sh` | an SSH public key literal | file deleted under item 1 |

The manifest change needed care, so it was made **at the source as well as in the artifact**: the
tool now writes placeholders, so a re-ingest cannot quietly reintroduce the identifiers. Nothing was
weakened by this: the manifest's job is to prove byte-identity to the source, and that proof is
`source_name` + `bytes` + `sha256`, none of which the redaction touches. The identifiers were
provenance labels. A new `id_note` field in the manifest says exactly that, so a later reader does
not mistake a placeholder for missing data. No hash in the manifest or the contract index changed,
because no contract file's bytes changed.

**3. The eval set's brand names are synthetic.** `src/features/benchmark/dataset.ts` hardcoded six
real bank names and seven real merchant names, used across the T1 extraction cases, plus a 32-row
merchant-to-category table with real brands - one of which contained the **owner's own name**.
Steering `pfos-current.md` forbids an organization-specific term in any tracked file and steering §0b
forbids a real payee in a fixture, so this was a live violation in a public repository. The scheme:

- `BANK_1`..`BANK_6`, `MERCHANT_A`..`MERCHANT_G`, continuing `MERCHANT_H`..`MERCHANT_AG` for the
  classification table. `I` and `O` are skipped throughout, because a reader cannot tell them from
  `1` and `0`.
- **The variation the cases exist to exercise is preserved deliberately, not incidentally.** Two of
  the seven merchants carry a second word (`MERCHANT_D STORE`, `MERCHANT_G LTD`) because two of the
  originals did, and every extraction case declares that merchant **whitespace** may be normalized -
  a set of single-token names would leave that clause with nothing to prove. Every token is
  upper-case, so the clause that merchant **casing** may be normalized still has a non-canonical
  form to normalize. In the classification table the **word-count shape of every row** is preserved
  (two-word rows stay two words, `MERCHANT_AD COM BILL` and `MERCHANT_V AND CO` stay three),
  because a classifier only ever shown a single token is not being asked the same question.
- **The multilingual cases keep their teeth by keeping their scripts.** Row 1 stays fully Arabic -
  an Arabic-script sender and an Arabic-script merchant - so the expected merchant is still a
  non-Latin string and the declared allowable variation (merchant **transliteration** may vary,
  critical fields may not) still has something to vary. The invented tokens read "bank alef" and
  "merchant alef", the Arabic counterparts of `BANK_1` and `MERCHANT_A`. Row 2 stays **mixed**:
  Arabic body, Latin sender and Latin merchant drawn from the sets above. Replacing the Arabic
  merchant with a Latin token would have quietly deleted the property the category tests.
- **Category table:** 32 rows unchanged, and the label of every row unchanged **positionally**, so
  the distribution is identical - Groceries x3, Dining x3, Transport x3, Utilities x3, Shopping x3,
  Health x3, Subscriptions x3, Housing x2, Travel x2, Clothing x2, Debt x2, Electronics x1,
  Fitness x1, Bills x1. A label appearing once still discriminates alone; a label appearing three
  times still forces a choice between three merchants. `BANK_1 LOAN` keeps the one row whose
  merchant is a sender from `BANKS`, which is what makes `Debt` reachable from a name the extraction
  set also uses.
- **Nothing else changed.** Case count **219** (identical: 52 + 32 + 26 + 26 + 26 + 21 + 16 + 10 +
  10), case ids identical, amounts, dates, masked account tails, severities, tiers, safety
  constraints and every expected value other than the merchant label identical.

**No integrity assertion was weakened and no hash needed re-pinning.** This was checked rather than
assumed: `src/features/benchmark/datasetIntegrity.ts` pins **limits**, not names or hashes
(`MAX_CASE_INPUT_CHARS`, `MAX_CASE_INPUT_LINES`, `MIN_OPAQUE_ID_RUN`, `MAX_DIGIT_RUN`) and its 28
tests pin no literal name; `dataset.test.ts` pins the **contract 09 constants** (`210` and the nine
per-category minimums) and no name; and
`src/server/mocks/fixtures/benchmark-phase1-replay.json` keys its twelve recordings by **case id**
(`bench:<model>:sms_0001`), carries no brand literal, no count and no hash, so the rename left it
byte-identical and correct. Had any of the three pinned a hash, the honest move would have been to
re-pin it to the newly computed value and say so; none did.

**4. The WAL outcomes are ranked, with outcome B as the documented default.** The structure the owner
asked to keep is kept: still an OPEN CONSTRAINT, still exactly two acceptable outcomes, still an
operator determination at the first-backup step, still an absolute refusal of the file-copy fallback.
What changed is that the two outcomes are no longer presented as equals. **Outcome B** - the snapshot
statement is issued from inside the owning service, which already holds the shared-memory sidecar as
its single writer, and the artifact is handed to the backup's scratch directory - is now the
**documented default**, on the stated ground that it needs **no write grant** and therefore resolves
the constraint **without widening a mount**: §3.2.2's read-only guarantee survives intact rather than
with an exception carved into it. **Outcome A** - grant the backup write access to the sidecar and to
nothing else - stays documented as the **fallback**, still acceptable, still bounded, but second.
Mirrored in all three places the constraint is described: `ops/backup/backup.sh` (header),
`ops/runbook/ROLLBACK.md` (§ the sidecar determination) and `ops/GATE_REGISTER.md`, where it did not
previously appear at all and now does, as a ranked table under G8 at the first-backup step with a
"record here when decided" line. That register entry is scoped to item 4 only; completing the rest of
the register is still task 9.3.

**The new property is checked rather than left to prose.** All three existing finding codes still
pass and their negative cases still fire - `WAL_DETERMINATION_MISSING`, `WAL_OUTCOMES_INCOMPLETE` and
`WAL_COPY_FALLBACK_NOT_REFUSED` anchor on sentences that were preserved **verbatim** ("This is an
**operator determination**", "exactly two acceptable outcomes", "write access to the sidecar", "from
inside the owning service", and the copy refusal in full). Ranking the outcomes introduced a
property nothing asserted, so rather than leave it unchecked,
`src/server/ops/runbookTemplate.ts` gained a fourth code, **`WAL_DEFAULT_OUTCOME_NOT_RANKED`**, which
requires the determination to state both halves - that outcome B is the documented default *and*
that outcome A is the fallback - because a document naming a default without saying which outcome it
is would tell an operator only that somebody had a preference. It has **two** negative cases, each
mutating the real file on disk in memory: one demotes the default to "**Another acceptable
outcome:**", the other demotes the fallback to "**The other acceptable outcome:**". Both were written
to break the ranking **and nothing else** - the phrases the completeness check reads survive, so each
case fails on the ranking alone rather than on membership. The positive half is the existing
assertion that the real documents produce an **empty** finding list.

**5. `.secrets/KEYS_TODO.md` deleted.** It was gitignored, so nothing leaked, but it documented the
finished Profile-A browser OAuth work, named a cloud project, and covered none of G1-G8 - so a human
following it at gate time would have been reading the wrong document. `ops/GATE_REGISTER.md` is
authoritative. **Nothing was carried across, and that was checked rather than assumed:** its three
sections were the web OAuth client id, the browser API key and the dev-tier model key. The first two
are Profile-A and not gates at all. The third is the dev-key carve-out, which the register already
carries under "Context: the dev-key carve-out, and why it does not release G4", including the small
periodic cap and the reason it does not release **G4**. Its closing "verify nothing leaked" grep is
subsumed by AC09 (`secret-scan.mjs`), which runs on every gate rather than when somebody remembers.
`.secrets/` remains gitignored; neither the file nor its contents were committed.

### Verification

- `npm run typecheck` **0 errors**; `npm run lint` **0 warnings** at `--max-warnings 0`.
- `npm run test` - **1680 tests across 99 files**, all passing, up from 1678 by exactly the two new
  `WAL_DEFAULT_OUTCOME_NOT_RANKED` negative cases. `src/server/ops/runbookTemplate.test.ts` is now
  **69 tests** and its coverage assertion - which fails if a finding code has no negative case -
  still passes with the new code included.
- **The eval set still meets the bar: 219 cases against the `>=210` floor**, unchanged by the
  rename, and every per-category minimum met (`sms_extraction` 52/50, `classification` 32/30,
  `dedup` 26/25, `safe_to_spend_explanation` 26/25, `purchase_decision` 26/25, `forecast` 21/20,
  `tool_call` 16/15, `multilingual` 10/10, `adversarial` 10/10). `auditEvalSet` reports **0
  problems**, so every sanitization, structural and money gate still holds over every case.
- `npm run verify:all -- --all` - **`HARNESS PASSED`, `19 of 19 executed checks passed`**. Before
  this increment's commit the harness reported **17 of 19**, the two red checks being **AC14
  (working tree clean)** and **AC15 (push ready)**, both reporting only this uncommitted work.
- AC11 (`generic-only.mjs`) and AC09 (`secret-scan.mjs`) both pass over the reduced tree, and the
  storage-identifier sweep now returns **nothing** across every tracked file.
- The AC04 floor stays at **331**. Ratcheting it is task **9.1** and it happens there.
- **No check was weakened.** `scripts/verify/all.mjs` was not touched. No assertion was loosened, no
  test skipped or deleted, no floor lowered, and no scanner given an allowlist entry or an exemption.
  Where the artifact and a checker disagreed the artifact changed, not the checker - and the one
  checker change is an **addition** of a code with both halves, not a relaxation of an existing one.

### Honest scope note

**Item 3 was scoped to the eval set, and real brand names remain elsewhere in the repository.** This
is a deliberate boundary, not an oversight, and it is recorded so nobody reads the gate as proof that
none exist. `src/features/accounts/`, `src/lib/db/`, `tests/helpers/fixtures.ts` and a number of
feature tests still use two real bank names, principally as the **domain account-type identifiers**
`CIB_DEBIT` and `HSBC_CC`, which are part of the Profile-A data model rather than fixture decoration;
the PFOS contracts under `contracts/pfos/01`-`04` and the research notes under `docs/research/`
name real institutions throughout, and those are **ingested byte-faithful** documents and cited
research whose bytes are checksummed in `_INGESTION_MANIFEST.json`. Renaming a domain type is a
schema change and rewriting an ingested contract would break its hash; neither is one of the five
approved resolutions, and neither was attempted. AC11's denylist does not currently carry these
terms, so it did not and does not fail on them - that is the honest state, not a claim that it is
the desired one.

**Nothing was executed and nothing was provisioned.** No `ops/` artifact was run, no container was
built or started, no store was opened, no provider was called, no network request was made, and no
secret was read. `ops/backup/backup.sh`, `ops/runbook/ROLLBACK.md` and `ops/GATE_REGISTER.md` were
edited **as text** and are read **as text** by their checkers. The WAL determination itself is
**still not made** - the ranking states which outcome to reach for first; it does not make the
operator's choice, and no code path behaves differently because of it.

**One functional change rides along with item 2 and should be seen.** `scripts/ingest/pfos-drive-pull.mjs`
no longer has a working default folder: an operator must now supply `PFOS_SOURCE_FOLDER_ID` or
`--folder`, and the tool exits with a message and a non-zero code otherwise. That is the correct
direction to fail, but it does mean a bare `node scripts/ingest/pfos-drive-pull.mjs` that used to
work now stops. `--discover PFOS`, which needs no identifier, still finds it. The tool was **not
run** in this increment, so that path is reasoned about rather than exercised.

### Still gated

- **G1-G8 are untouched**, and none was attempted: G1 provision and harden the host; G2 DNS for the
  two hostnames; G3 create the two bots; G4 mint the two runtime keys with their weekly caps; G5 the
  storage consent click; G6 register both webhooks; G8 generate the encryption keypair and keep the
  private half off the box. G7 remains **closed as WONT-DO** per steering §0b.
- **The write-ahead-log sidecar determination is a new, explicitly registered human step** under G8.
  It is now ranked and recorded in three places, and it is still **undecided**. Until an operator
  makes and records it, every rollback across a migration is blocked on a human rather than
  available.
- **Tasks 9.0, 9.1, 9.3 and 9.4 remain open**, and nothing here ticked or partially performed them.
  The no-deployment-particular harness check does not exist yet; this increment removed particulars
  by hand and by grep, which is exactly why 9.0 is worth having.
- No outbound call from a server process and no production secret, unchanged.

---

## Phase 9.0 - The tree-level no-deployment-particular gate, as a twentieth named check (2026-08-07)

**Why.** Steering §0b keeps both repositories public and pays for that with one rule: the repository
may hold the *design*, never a *deployment particular*. Six per-artifact checkers already held that
rule over the artifact each of them owns - the topology template, the proxy template, the environment
templates, the backup and restore scripts, the runbooks, the cross-repo series. **Nothing held it over
the tree.** `ops/GATE_REGISTER.md` and `ops/BUS_NETWORK_BINDING.md` were claimed by no checker at all,
and a fixture added anywhere outside a checker's field of view was covered by nobody. Phase 2 removed
particulars from those files by hand and by grep and said plainly that this is exactly why 9.0 is
worth having. This is that gate.

### Work

**The check.** `AC18 no deployment particular in ops or any fixture`, wired into
`scripts/verify/all.mjs` between AC11 and AC02, backed by
`scripts/verify/no-deployment-particular.mjs` over `src/server/ops/deploymentParticulars.ts`.

**R24 still has ONE implementation.** `scanForParticulars` in `./composeTemplate` is it, and the new
module takes it as an **injected argument** rather than restating a pattern of its own, so a later
widening of R24 moves every artifact at once instead of moving six of them and leaving the seventh
behind. That injection is also the whole bridge: the harness is plain Node, Node 24 strips types
natively, and `composeTemplate.ts` has no runtime relative import, so the harness imports both modules
directly with an explicit `.ts` extension. **Nothing is transpiled, no dependency was added, no build
step was introduced, and there is no second copy of the scan.** The audit module's only relative
import is `import type`, which is erased before resolution - which is what lets it keep the real types
while staying loadable by a runtime that cannot resolve an extensionless specifier, and it is why the
scanner is a parameter rather than a static import. `allowImportingTsExtensions` was deliberately set
`false` in `tsconfig.json` and **was not flipped**.

**Scope, and the globs it settled on.** Two declared roots, each of which must exist and must
contribute at least one file: `ops/**` (19 files) and `src/server/mocks/fixtures/**` (2 files) - 21
artifacts. A third pattern, a file *named* like a fixture rather than living in a fixture directory,
was **deliberately not declared as a root**, because nothing in this repository matches it and the
task's own rule is that a glob matching nothing is a failure. It is covered more strongly instead:
`FIXTURE_SHAPED_PATH` is applied to **every tracked path**, and a fixture-shaped path outside the scan
set is `FIXTURE_OUTSIDE_SCAN_SET`. A glob can be silently wrong; that assertion cannot. Two paths were
judged **code, not fixtures**, and are therefore out of scope: `src/server/mocks/fixtures.ts` and
`tests/helpers/fixtures.ts` *load and build* fixtures, and code is where the scan's own patterns
legitimately appear. `data/seed/**` and `data/ledgers/nizam_db.example.json` were also judged out of
scope - they are the Profile-A example store, where a currency code in a currency field is the schema
doing its job, not a monetary particular.

**Two further bans over `src/server/**` (steering §4.1), in code and in prose alike.** The
row-append data statement used as a **bare binding name** (`ROW_APPEND_STATEMENT_AS_LOCAL`), and the
keyword that opens a **second store on an existing connection** (`SECOND_STORE_KEYWORD_PRESENT`).
Neither token is written out contiguously anywhere in the module or its test: both are assembled from
fragments at construction, the technique `runbookTemplate.test.ts` and `patchSeries.test.ts` already
use, and a test asserts the checker's own two files hold neither token - so it cannot flag itself.
123 files under `src/server/**` are scanned.

**The repository was NOT clean, and the source was fixed rather than the check narrowed.** The
second-store keyword: **clean**, zero occurrences as a whole word in any case. The row-append
statement as a bare binding name: **two occurrences**, both fixed -
`src/server/db/connection.test.ts:195` and `src/server/db/spendLedgerRepo.test.ts:130` each bound
`const <row-append-statement> = handle.db.prepare(...)`. Renamed `orphanWrite` and `rawWrite`; the
assertions they carry are untouched. A third finding fell out of the scan itself:
`ops/GATE_REGISTER.md` carried `<B|A>`, which is not the `<UPPER_SNAKE>` shape R24 requires of a
placeholder, so a real value could have sat in its shape unnoticed. Fixed to
`<SIDECAR_OUTCOME>` (B or A) - meaning preserved, nothing renumbered, reordered or softened; 9.3
still owns that file.

**Tests, both halves.** `src/server/ops/deploymentParticulars.test.ts`, 34 tests. Positive: the real
tree produces an **empty** finding list over a scan set whose size is asserted non-zero per root; no
dotted token survives the mask in any scanned file; the declared-token list agrees with
`patchSeries`'s wherever the two meet, so they cannot drift. Negative: **all 17 finding codes** have a
row that breaks one property and observes that code fire by name, plus a coverage test that fails if a
code arrives without a row. Four extra rows assert the row-append ban does **not** fire on a
repository method reached through a receiver, on the statement inside a prepared string, or on prose,
and that a longer word merely containing the second-store keyword is not that keyword.

**The three fail-closed paths are exercised through the real file entry point, and each RETURNS a
finding rather than throwing:** a root directory that does not exist yields `SCAN_ROOT_MISSING` with
`artifactsScanned === 0`; a real empty directory (`mkdtempSync`) yields `SCAN_ROOT_EMPTY` **and**
`SCAN_SET_EMPTY`; a server root that does not exist yields `SERVER_TREE_EMPTY` with
`serverFilesScanned === 0`. The harness script re-asserts both counts itself, so a check that examined
nothing cannot report success.

**Closing the constraint recorded in Phase 2.** That note listed the open decision for 9.0 - extend an
existing check again, or add a twentieth and move the documents in the same increment - and left it to
9.0 rather than pre-empting it. **Option 2 was taken**, on the reasoning that folding a genuinely new
guarantee into `AC08b` would hide a new promise behind an old name, and `AC08b` already covers two
boundaries. Every document asserting the **current** gate figure moved to 20/20 in this same commit:
`.kiro/steering/pfos-current.md` (×2), `.kiro/steering/loop-protocol.md`,
`.kiro/steering/structure.md` (the "19-check harness"), `docs/KIRO_HANDOFF.md` (×3, including line 20,
whose "if it is not 19/19, stop and report" would otherwise have made this increment a stop condition
for the next session), `docs/KIRO_ONBOARDING.md` (×4), and
`.kiro/specs/06-two-agent-vps/LOOP.prompt.md` (×2, including the T2 stop predicate). Four documents
the Phase 2 note did not enumerate were found by re-grepping and are the reason the note said to
re-grep. **Dated records were left as dated records and made unambiguous rather than falsified:**
`docs/KIRO_HANDOFF.md` §4 and `docs/KIRO_ONBOARDING.md` §5 and its footer carried snapshot figures
("333 tests / 37 files", "at handoff") that were already stale, so each now names its date and points
at the live figure; `RELEASE_CHECKLIST.md`'s 19-of-19 line sits inside a section headed
`## Released - 2026-08-05` under a file-level convention that dated sections are not a live dashboard,
so it is marked *at that release* and the note below it now states the live figure (1714 tests, 20
checks); `docs/KIRO_KICKOFF_TWO_AGENT.prompt.md` line 97 read present-tense and now states both the
figure when it was written and the figure from 9.0 onward. Left untouched as history: every
`Harness 19/19` line already in this log and in `contracts/_BUILD_LOG.md` (whose "19/19" is a *test*
count, not the harness), `docs/PFOS_CONTRACT_INGESTION_REPORT.md` (headed `Run date: 2026-08-05`, and
its "now" is relative to that run), `docs/PFOS_IMPLEMENTATION_ROADMAP.md` ("Baseline preserved"), and
every `note` field in `.loop/verification-ledger.json`, which is never hand-edited.

### Verification

- `npm run typecheck` - 0 errors. `npm run lint` - 0 warnings at `--max-warnings 0`.
- `npm run test` - **1714 passed across 100 files**, up from 1680 across 99. The 34 new tests are all
  in `deploymentParticulars.test.ts`.
- `npm run verify:all -- --all` - **`HARNESS PASSED`, `20 of 20 executed checks passed`**, with
  `PASS AC18 no deployment particular in ops or any fixture`. Before the commit the same run reported
  **18 of 20** with only **AC14 (working tree clean)** and **AC15 (push ready)** red, both naming the
  same uncommitted work; that is the expected mid-increment state.
- AC18's own output, printed on every run so the check cannot pass silently:
  `declared scan roots: ops/** (19 files), src/server/mocks/fixtures/** (2 files)`,
  `artifacts scanned for a deployment particular: 21`,
  `files scanned under src/server/** for the two store-isolation bans: 123`.
- **The AC04 floor stays at 331.** Ratcheting it is task 9.1 and was not done here.
- Nothing in `scripts/verify/` was weakened, no assertion was loosened, no test was skipped or
  deleted, and no scanner was given an exemption to make a check pass. Where the new check fired on a
  real file, **the file was fixed** - three times, all three recorded above.

### Honest scope note

1. **The one judgement this module adds beyond the shared scan, stated rather than buried.** The
   shared scan refuses an absolute address outright, which is right for a machine-read template and
   wrong for a human-facing register that must show the exact command an operator types. The new
   module masks the scheme **only when that address's authority carries an `<UPPER_SNAKE>`
   placeholder**, so the host is provably injected; an address with a concrete authority still reaches
   the shared scan and still reports `PARTICULAR_URL_SCHEME`. Both directions have a test. This is a
   rule with a stated semantic, not a file exemption, and it narrows nothing the shared scan would
   otherwise catch about a real endpoint.
2. **The declared dotted-token list is data, and it duplicates `patchSeries`'s.** A dotted token is
   how the shared scan recognizes a possible host name, and an `ops/` document legitimately holds
   dozens that are file names or attribute accesses in quoted source. The list is enumerated exactly,
   as `patchSeries` does and for the same reason, and it is policed in **both** directions by findings
   rather than by remarks: an undeclared token in the tree is `DOTTED_TOKEN_UNDECLARED`, and a stale
   entry is `DECLARED_TOKEN_UNUSED`. The duplication with `patchSeries` is real and is not shared
   code - the harness cannot import that module at run time, because it has an extensionless relative
   import - so a test asserts the two lists agree on every token they share. That is a checked
   invariant, not a resolved one; **the honest description is one scanner and two copies of one word
   list**.
3. **The row-append ban is narrower than "the token anywhere".** It fires on a *binding name* -
   `const`/`let`/`var`/`function` followed by the statement name or its three-letter short form - and
   not on a repository method reached through a receiver, the statement inside a prepared string, or a
   sentence about how a row is written. That is deliberate and is the only defensible line: the tree
   contains about forty legitimate occurrences of the word, including the row-append method on six
   repositories, and a ban on all of them would have meant renaming the store's own boundary. Both
   negative directions are tested. A binding introduced some other way - a destructured field, a
   function parameter - would not be caught; the check is a named smell detector, not a type system.
4. **The two paths named `fixtures.ts` are out of scope by judgement.** They load and build fixtures
   rather than being fixtures. If either ever starts carrying literal recorded data, nothing in this
   check notices, because `FIXTURE_SHAPED_PATH` deliberately does not match a bare `fixtures.ts`.
5. **The scan is over the tracked tree as it stands on disk, from the repository root.** Both the
   harness and the vitest run start there; neither resolves paths relative to the module. That matches
   every existing checker in `scripts/verify/` and is stated so it is a known property rather than a
   discovered one.
6. **`PARTICULAR_SCAN_UNMAPPED` is a trip-wire, not a live path.** Today every code the shared scan
   can produce over these artifacts has a mapping. Its value is entirely prospective: if R24 widens
   and grows a code, this check reports it instead of silently dropping it - which is what would turn
   a widened rule into a narrowed one. It is exercised with an injected scanner, not by the real one.

### Still gated

- Writing `ops/**` is authorized and running it is not (steering §2). **Nothing in this increment
  executed, applied or provisioned anything**, made an outbound call, or used a secret. The check
  reads text.
- **G1-G8 untouched and unattempted:** G1 provision and harden the host; G2 DNS for the two
  hostnames; G3 create the two bots; G4 mint the two runtime keys with their weekly caps; G5 the
  storage consent click; G6 register both webhooks; G8 generate the encryption keypair and keep the
  private half off the box. G7 stays **closed as WONT-DO** per steering §0b.
- The write-ahead-log sidecar determination under G8 is still **undecided**; this increment only
  reshaped the placeholder that records it.
- **Tasks 9.1, 9.2, 9.3 and 9.4 remain open.** In particular 9.1 (raise the AC04 `--min` floor to the
  proven count) was deliberately not done here, and the floor is still 331 against 1714 tests.
- No outbound call from a server process and no production secret, unchanged.

---

## Tasks 9.3 and 9.1 - the gate register held to its own standard by a checker, and the test floor ratcheted (2026-08-09)

**Why.** `ops/GATE_REGISTER.md` is the one document that has to work on the worst day. Its standard is
the owner's: *a competent human, holding only this file, can stand the deployment up.* Two things were
true of it before this increment. It was read by `src/server/ops/runbookTemplate.ts` for its gate list
and scanned by `src/server/ops/deploymentParticulars.ts` for a deployment particular, and **nothing
held it to that standard** - so every way it can rot silently was uncovered, and all of them rot in the
same direction: toward a register that reads complete and is not.

### Work

**Half one - the reconciliation (commit `7e7cb58`, `ops/GATE_REGISTER.md` only).** Task 0.5 seeded the
register before Phase 7 authored the artifacts its steps refer to, so the seed promised paths, file
names and environment entry names that Phase 7 had not yet delivered. Half one resolved them: four
"intended path" phrasings became authored paths; nine entries that `ops/env/*.env.example` attributes
to a gate but that no step told the operator to set were given a step each (G1 five, G2 one, G4 two,
G5 two); G6's step 2 was corrected to say that the webhook **paths** live in the proxy's file and the
webhook **secrets** in the two agents' files, in opposite directions. One promised path - a unit-file
directory under `ops/` - **did not exist and was not created to match the promise**; the reference was
corrected to what task 7.5 actually delivered, and the correction is recorded in the document under G1
rather than dropped. Nothing was renumbered, removed, softened, reopened or marked satisfied.

**Half two - the checker (this commit).** Half one's method was re-reading, and re-reading does not
scale past one careful pass. The checker is what makes the standard re-provable on every run:

- `src/server/ops/gateRegister.ts` - a pure text-in / findings-out module in the established shape of
  `runbookTemplate.ts` and `patchSeries.ts`: a narrow markdown subset parser, twenty finding codes, no
  severity ladder, and the on-disk existence probe **injected** so the audit itself stays pure.
- `src/server/ops/gateRegister.test.ts` - 43 tests, both halves.

The nine properties it holds. The first four are the ones half one found that nothing asserted:

1. **`ENTRY_STEP_MISSING`** - every entry an `ops/env/**` template declares that `ENTRY_SPECS`
   attributes to a gate is named by a step of **that** gate. This is the check that would have caught
   half one's nine entries. The templates are **parsed**, not restated, so the vocabulary has one home.
2. **`STEP_WITHOUT_VERIFICATION`** and **`ENTRY_STEP_NOT_VERIFIED`** - a gate with steps has a
   non-empty VERIFICATION block, and every entry a step sets is answered in it. A step whose outcome
   is not checked is a step assumed to have worked.
3. **`VERIFICATION_PRINTS_A_VALUE`** - no verification line prints a value: no whole-file print, no
   environment dump, no expansion, and no `grep` naming an entry without a counting or name-only flag.
   The register's own rule is "record the observation, never the value".
4. **`QUOTED_PATH_MISSING`** - every repository path the register quotes in an inline code span exists
   on disk. This is the check that would have caught the unit-file directory at authoring time.
5. **`GATE_MISSING` / `GATE_UNEXPECTED` / `G7_NOT_CLOSED`** - G1-G8 all present, G7 recorded as
   `CLOSED - WONT-DO` with the line saying it is not to be raised again.
6. **`GATE_SECTION_MISSING` / `GATE_PREREQUISITE_UNRECORDED`** - every open gate carries why a human is
   required, its steps, a VERIFICATION block and what it unblocks; and the summary table records a
   prerequisite for every gate, including the two whose prerequisite is "nothing".
7. **`GATE_STATUS_UNEXPECTED` / `GATE_DESCRIBED_AS_PERFORMED`** - every status under an open gate is
   `BLOCKED - awaiting human`, including the ones on determinations recorded *inside* a gate, and no
   prose describes a gate in the past tense as performed. Gate discipline rule 5 calls that claim the
   single most damaging thing possible in this document.
8. **`ORDERING_NOT_STATED` / `NEXT_ACTION_NOT_FIRST_GATE`** - the dependency ordering is stated and
   places every open gate, and G1 is named as the single next action.
9. **`WAL_DETERMINATION_RECORD_MISSING` / `PROVISIONAL_REGISTRY_RECORD_MISSING`** - the two places an
   outcome must be recorded back exist: the write-ahead-log sidecar determination under G8, with a
   named place to record it, and task 6.3's provisional-registry determination.

**Two genuine defects, found by the checker and fixed in the file.**

- **G3 placed `ALLOWED_USER_IDS` and verified nothing.** Step 5 tells the operator to write the
  allowlist into *each* agent's file; the VERIFICATION block authenticated the two bots and checked the
  file mode, and never mentioned the allowlist. The asymmetry is what makes it dangerous rather than
  untidy: an allowlist present in one file and absent from the other refuses the owner on one bot while
  the other has no allowlist to consult at all. Added a counting line over both files, plus the note
  that presence is necessary and not sufficient - an empty allowlist must refuse everyone (**R12**), so
  non-emptiness is confirmed by observing the refusal path, never by reading the value.
- **G4 placed two keys and confirmed one.** Step 4 places `OR_KEY_LIFE` and `OR_KEY_FINANCE` in their
  own files. The read-back `curl` is run **per key** and the block only ever showed the finance one, so
  the life key had no placement check at all. Added a counting line for each, with the comment saying
  why the read-back above does not cover the second key.

Both fixes are of the two kinds the document's own "What an agent may write in this file" permits - an
added verification line, and a recorded observation carrying no value - and both report a **count**.
Neither the checker nor any assertion was weakened to accommodate them, and the register's own record
of what 9.3 resolved now carries a bullet saying these two were found by the checker rather than by
re-reading, which is the argument for having written it.

**Task 9.1 - the floor.** Ratcheted the AC04 `--min` in `scripts/verify/all.mjs` from **331** to
**1757**, the count proven by the `npm run test` run below. Up only. The floor had been stranded at 331
against a suite five times that size since Stage 3, which made AC04 a health check with no size floor
in practice; it is now a real ratchet again.

### Verification

- `npm run typecheck` - clean.
- `npm run lint` - clean at zero warnings.
- `npm run test` - **1757 passed across 101 files**, up from 1714 across 100. All 43 new tests are in
  `gateRegister.test.ts`.
- `npm run verify:all -- --all` - **`HARNESS PASSED`, `20 of 20 executed checks passed`**, with
  `PASS AC04 test suite passes and meets its size floor` against the new floor of 1757. Before the
  commit the same run reported **18 of 20** with only **AC14 (working tree clean)** and **AC15 (push
  ready)** red, both naming the same uncommitted work - the expected mid-increment state.
- The negative half is a case **per finding code**, 27 of them, each taking the real file, breaking one
  property, and observing that code fire **by name**. Three properties of the harness itself are
  asserted so a case cannot pass hollowly: a tamper reporting **zero** findings fails as a false pass;
  every mutation helper (`swap`, `swapAll`, `reorder`) **throws** on a rotted anchor rather than
  matching nothing; and a mutation that changes no byte is refused. A coverage test fails if a code is
  added without a case.
- The fail-closed paths are each a **finding**, never a skip, and each has its own test: an unreadable
  register (`REGISTER_UNREADABLE`, driven both through a null source and through the file entry point
  against an absent directory), a register outside the markdown subset (`REGISTER_OUTSIDE_SUBSET`), an
  unparseable environment template (`ENV_COMPANION_UNREADABLE`), and a quoted path that does not exist
  (`QUOTED_PATH_MISSING`, driven with a probe that denies one real path so the detail names it).
- The positive half asserts **non-zero** cross-read counts - `gateAttributedEntriesExamined` and
  `quotedPathsExamined` - through both the text entry point and the file entry point, so the check
  cannot pass by not running. Today those are **22** gate-attributed entries and **17** quoted paths.
- Nothing was loosened, no test was skipped or deleted, no floor was lowered, and no scanner was
  allowlisted or exempted. Where the new checker fired on a real file, **the file was fixed** - twice,
  both recorded above.

### Honest scope note

1. **"Every human step carries a verification line" is enforced per gate and per entry, not per step.**
   The register's structure is one VERIFICATION block per gate, not one per numbered step, so a literal
   per-step reading has nothing to bind to. What is enforced instead is stronger where it matters and
   weaker where it does not: every gate with steps must have a non-empty VERIFICATION block, and every
   *entry* a step sets must be named in it. That second clause is what found both defects. A step that
   sets no entry - "disable group joining for both bots" - is covered only by the gate-level block.
2. **`GATE_DESCRIBED_AS_PERFORMED` is a phrase matcher with a stated exclusion, not a tense parser.**
   It refuses a gate identifier followed by a completion verb, and skips the match when a conditional
   word (`until`, `before`, `once`, `if`, ...) leads it within sixty characters - because "Until G8 is
   done, the backup script may be written" is the sentence that *does* the gating and refusing it would
   refuse the register's own method. A completion claim phrased without a gate identifier nearby, or
   with a verb outside the list, is not caught. The `Status:` check is the load-bearing half; this is
   the prose belt beside it.
3. **`namesEntry` distinguishes `DOMAIN=` from `<DOMAIN>` and that distinction is load-bearing.** Two
   entries are spelled identically to the placeholder that carries their value, so a naive substring
   test would have let a gate satisfy the check merely by mentioning the value it needs. The boundary
   excludes `<` and `>`; a placeholder spelled some other way would not be excluded.
4. **The quoted-path probe reads inline code spans only, outside fenced blocks.** A path named in prose
   without backticks, or inside a command block, is not probed. That is deliberate: a fenced block is
   full of host paths like the configuration directory, which are not repository paths and must not be,
   and a prose mention with no backticks is not the register pointing a reader at a file. The cost is
   that an un-backticked broken reference would pass.
5. **The path set is recognized by first segment against a fixed list of repository roots.** A quoted
   path under a root nobody listed is silently out of scope rather than a finding. The list is data in
   the module, and the count assertion is what keeps it from decaying to nothing - but a *new* top-level
   directory would need adding, and until then its paths would go unprobed.
6. **The checker is not wired into the harness as a twenty-first named check.** It runs in the vitest
   suite, which AC04 executes, so a regression fails the gate - but through AC04's name rather than its
   own. Every other `ops/` checker in this directory sits the same way except AC18, which needed a
   named check because nothing else covered the tree. Making this one named is a separate decision with
   a document cost (every file asserting "20 of 20" would move), and it was not taken here.
7. **`ENV_COMPANION_UNREADABLE` covers an unparseable template, not an unreadable one, on the file
   path.** `readEnvTemplates` skips a template it cannot read, and the absence then surfaces as either
   a missing gate-attributed entry or, in the limit, `CROSS_READ_EMPTY`. It is reported, but through a
   less specific code than the parse failure gets.
8. **The floor ratchet is to the count proven on this machine, this run.** 1757 is a floor, not a
   target; a future increment that legitimately removes a test will have to argue the case rather than
   lower the number quietly, which is the intent.

### Still gated

- Writing `ops/**` is authorized and running it is not (steering §2). **Nothing in this increment
  executed, attempted, simulated or claimed any gate.** No shell was invoked, no host, DNS record, bot,
  key, consent, webhook or keypair was touched, no outbound call was made, and no secret was read. The
  checker reads text and probes for file existence.
- **G1-G8 untouched and unattempted, every one still `BLOCKED - awaiting human`:** G1 provision and
  harden the host; G2 records for the two hostnames; G3 create the two bots; G4 mint the two runtime
  keys with their periodic caps; G5 the storage consent click; G6 register both webhooks; G8 generate
  the backup keypair and keep the private half off the host. G7 stays **closed as WONT-DO** per
  steering §0b and was not re-raised. **G1 remains the single next human action.**
- The write-ahead-log sidecar determination under G8 is still **undecided**, and every rollback across
  a migration stays blocked on it. This increment only proved that the place to record it still exists.
- The eligibility registry is still `provisional: true`, and live routing is still gated on **G4**.
- **Tasks 9.2 and 9.4 remain open**; they close with the final report. 9.1 and 9.3 are done.
- No outbound call from a server process and no production secret, unchanged.

---

## Tasks 9.2 and 9.4 - close out: the push proven rather than asserted, and the final report (2026-08-09)

**Why.** Two boxes remained, and each was a claim about the work rather than a piece of it. 9.2 says
every green increment was committed and pushed - a claim that is trivially easy to tick and worth
nothing unless it was checked, because a locally-committed increment looks identical to a pushed one in
`git log`. 9.4 is the deliverable the owner set the standard for: DONE means every box above *Waiting on
user input* ticked, harness green, tree clean, every commit pushed, and G1-G8 untouched but executable by
a human from `ops/GATE_REGISTER.md` alone. The report has to say what is built, what is proven and how,
what is gated, and exactly one next action - and it has to carry the honest limits forward rather than
present a clean sheet, because a close-out that reads cleaner than the work is a close-out that lies.

### Work

**9.2 - verified, not asserted.** `git fetch origin master`, then
`git merge-base --is-ancestor <commit> origin/master` for each of this spec's seven increments:
`0392d1d` (the live model path, 6.3 on the ELSE branch), `b5ff8c4` (the deployment templates), `b0af379`
(the cross-repo change series), `2b31bd0` (the five policy hygiene items), `5f70139` (AC18), `7e7cb58`
(the gate register reconciliation), `5d3d18c` (the gate register checker). **All seven are ancestors of
`origin/master`**, so none is unpushed, and `git status --porcelain` was empty. The exit status of a
`git push` is not the evidence; ancestry after a fetch is.

**The Gate block - each of its three lines checked before ticking.**

- The harness prints `HARNESS PASSED`, **20 of 20 executed checks passed**.
- The AC04 floor is **1757**, and its whole history was read out of `scripts/verify/all.mjs` rather than
  quoted from memory: 110 → 185 → 200 → 220 → 235 → 245 → 253 → 258 → 261 → 266 → 269 → 317 → 331 →
  1757. Fourteen values, thirteen transitions, **every one an increase**. The abbreviated series carried
  in the close-out prompt (110 → 185 → 200 → 235 → 245 → 331 → 1757) omits seven intermediate values;
  it agrees on the direction and on both endpoints, and the full series is recorded here because the
  ratchet claim is about every transition, not about the endpoints.
- "No secret in any tracked file; `ops/` holds placeholders only" decomposes into three checks with one
  clause each, and the report states which covers which: **AC09** `secret-scan.mjs` for the secret
  clause (five content patterns, five forbidden tracked paths, over every tracked file); **AC11**
  `generic-only.mjs` for the organization-term clause; **AC18** `no-deployment-particular.mjs` for the
  placeholder clause (21 artifacts across `ops/**` and `src/server/mocks/fixtures/**`, plus two
  store-isolation bans over 123 files under `src/server/**`). All three green, none allowlisted.

**9.4 - `.kiro/specs/06-two-agent-vps/FINAL_REPORT.md`**, a new tracked document in six sections.

1. **What is built**, phase 0 through 9, naming the modules and what each one *proves* rather than what
   it contains - the T0 guarantee as a capability the branch does not hold, consent by absence as a
   field that does not exist, the two-bots-same-update-id collision as the test that matters. It carries
   the **per-artifact checker table**: which `src/server/ops/` module validates which `ops/` artifact,
   its finding-code count and its test count. The counts were **read out of the modules**, not copied
   from earlier log sections: compose 49/64, caddy 39/50, env 33/44, backup 43/58, runbook **53**/69,
   patch 55/72, gate register 20/43, particulars 17/34, health probe 6 refusals + 7 readiness failures/24,
   redacted logger 12/37 - 495 of the 1757 tests. Runbook is 53 rather than the 52 recorded at task 7.6
   because the policy-hygiene increment added `WAL_DEFAULT_OUTCOME_NOT_RANKED`; taking the older figure
   would have been a small, silent, and entirely avoidable error. Coverage is described precisely rather
   than generalized: eight checkers carry a `NEGATIVE_CASES` row per code with a coverage test, and the
   two whose shape differs (`redactedLogger`, `healthProbe`) are stated as they are.
   `ops/BUS_NETWORK_BINDING.md` is named as the one artifact with no checker of its own, with what does
   cover it.
2. **What is proven, and how** - **static rehearsal**, enumerated as seven negatives: no `ops/` artifact
   run, no container built or started, no store opened by an artifact, no provider called, no network
   request, no secret read, and the other repository never read. The tests are text-in / findings-out.
   The section states the limit in the same breath as the claim: what is proven is that the artifacts
   say what the contracts require and still agree with each other; what is **not** proven is that any
   procedure in them works.
3. **What is gated** - G1-G8 as a table, G7 `CLOSED - WONT-DO`, every open gate `BLOCKED - awaiting
   human`, plus the two determinations registered *inside* a gate. It says plainly that none was
   attempted, simulated or claimed, and that nothing was renumbered, reordered, softened or reopened.
4. **Exactly ONE named next human action: G1**, with a pointer to `## G1 - Provision and harden the host`
   in `ops/GATE_REGISTER.md` and to its Steps, VERIFICATION and Unblocks blocks. Not a list, and not an
   ordering with G1 at the top.
5. **Honest limits**, six carried forward verbatim in substance and two more restated: the provisional
   registry and the never-made live call; the change series *emitted, unapplied*, not applicable diffs,
   the other repository never read; the write-ahead-log determination **ranked but unmade**; the
   55-passing baseline **read from a document, never observed**; the real brand names remaining in
   `src/features/accounts/`, `src/lib/db/`, `tests/helpers/fixtures.ts` and the byte-checksummed ingested
   contracts, outside the eval set that was cleaned; and the gate-register checker running inside the
   vitest suite under AC04's name rather than as a twenty-first named check. Nothing was softened and
   nothing was invented.
6. **The count change** - 19 → 20 when AC18 landed in `5f70139`, with the seven documents that moved in
   the same increment named, and the dated records that were made unambiguous rather than falsified
   distinguished from the history that was left alone.

Ticked in `tasks.md`: **9.2**, **9.4**, and all three **Gate** boxes, each with the evidence beside it.
**Every `G1`-`G8` box under *Waiting on user input* is deliberately left unticked.**

### Verification

- `npm run typecheck` - 0 errors. `npm run lint` - 0 warnings at `--max-warnings 0`.
- `npm run test` - **1757 passed across 101 files**, unchanged. This increment adds no test, because it
  adds no behaviour: three markdown files changed and no source file did. The AC04 floor therefore stays
  at **1757** and needed no ratchet.
- `npm run verify:all -- --all` - **`HARNESS PASSED`, `20 of 20 executed checks passed`**. Before this
  increment's commit the same run reported **18 of 20** with only **AC14 (working tree clean)** and
  **AC15 (push ready)** red, both naming the same uncommitted work - the expected mid-increment state.
- `node scripts/loop/verify-ledger.mjs` - exit **0**, with the 9.4 quartet appended in order
  PRODUCE(builder) → VERIFY(gate-runner) → APPROVE(reviewer) → CERTIFY(reviewer, RESOLVED/VERIFIED) over
  one `--files` list. The ledger was **never hand-edited**.
- The new report is a tracked file and is therefore subject to the scanners it describes. **AC09** and
  **AC11** pass over it, and it was written to that standard rather than checked into it: no hostname or
  domain, no address literal, no storage identifier, no bot handle or numeric identifier, no port, no
  keypair, no monetary figure, no secret value, and no deployment particular of any kind. Every
  third-party endpoint it refers to is named by role.
- **No check was weakened.** `scripts/verify/all.mjs` was not touched in this increment. No assertion
  was loosened, no test skipped or deleted, no floor lowered, no scanner allowlisted or exempted, and no
  gate renumbered, reordered, softened or reopened.

### Honest scope note

**Nothing was executed, attempted, simulated or claimed.** No shell ran an `ops/` artifact, no container
was built or started, no store was opened, no provider was called, no network request was made, and no
secret was read. This increment wrote and edited three markdown files and appended four ledger events.

**The report is a claim about the repository, and its evidence is the repository.** Every figure in it
was read from the artifact it describes - the finding-code counts from the module source, the test counts
from the run, the floor history from the file's own history, the ancestry from `git merge-base`. Where a
figure quoted in an earlier log section had since moved, the current one was taken and the discrepancy
recorded rather than smoothed. Where the close-out prompt's own summary of the floor history was
incomplete, the full series was reported instead of the summary repeated.

**"Production-ready" in this report means exactly one thing, and it is the narrow thing.** Each ops
artifact is validated by its own checker, every human step carries a verification line, and there is
exactly one named next action. It does not mean the system runs, because there is no system: no host,
DNS record, bot, key, consent, webhook or keypair exists, and none of them is mine to create. The first
execution of every artifact in `ops/` will be a human's, on a host that does not exist yet.

**One thing this close-out does not do.** It does not make the write-ahead-log sidecar determination, and
it does not promote the eligibility registry out of `provisional`. Both are recorded as open in the
report's honest limits and in the gate register, and both stay open.

### Still gated

- Writing `ops/**` is authorized and running it is not (steering §2). **No gate was performed,
  attempted, simulated or claimed** in this increment or in any increment of this spec.
- **G1-G8 untouched and unattempted, every open one still `BLOCKED - awaiting human`:** G1 provision and
  harden the host; G2 records for the two hostnames; G3 create the two bots; G4 mint the two runtime keys
  with their periodic caps; G5 the storage consent click; G6 register both webhooks; G8 generate the
  backup keypair and keep the private half off the host. G7 stays **closed as WONT-DO** per steering §0b
  and was not re-raised. **G1 is the single next human action.**
- The write-ahead-log sidecar determination under G8 is still **undecided**, and every rollback across a
  migration stays blocked on it.
- The eligibility registry is still `provisional: true`, and live routing is still gated on **G4**.
- The three cross-repo changes are still *emitted, unapplied*, and applying them is a human step in
  another repository, in a session opened on that repository.
- No outbound call from a server process and no production secret, unchanged.

---

## Task 10.0 - the five requirements Phase 10 adds, and the one place the mandate disagreed with the disk (2026-08-10)

**Spec:** `.kiro/specs/06-two-agent-vps`. **Authority:** `KIRO_SHIP_LIVE.prompt.md` rev 2, 2026-08-10, which
carries owner authority and rules on seven decisions. **Scope:** documentation only - requirements and design
text. **No implementation code was written**, no Dockerfile was created, and neither the environment loader
nor the transport was touched; those are tasks 10.2, 10.5, 10.7 and 10.8.

### What was authored

Six criteria in `.kiro/specs/06-two-agent-vps/requirements.md`, in the existing EARS
`WHEN/WHERE ... THEN ... SHALL ...` form and inside the existing section grouping:

| Id | Section it joined | What it requires |
|---|---|---|
| **R26** | Transport (Contract 12) | Delivery authorization is **mode-aware in both directions**. In `longPoll` the secret-token check is **not applicable** and the allowlist is the whole guard, so an unlisted sender is still refused and an empty allowlist still refuses everyone. In `webhook` an absent, empty, over-length or out-of-charset token still refuses everything, and no clause may be read as relaxing R11. The refusal stays indistinguishable as to stage in both modes. |
| **R26.1** | Transport (Contract 12) | Dedup on the `(bot, update)` pair applies in **both** modes, and in `longPoll` the read offset advances **only after the update is durably enqueued**. |
| **R27** | Configuration, process and images (new) | The loader covers all six services; preserves exactly **one** `process.env` bridge in the whole of `src/`; names **every** missing entry in **one** message; supplies no default; and treats an unsubstituted `<ANGLE_BRACKET>` value as a failure rather than a value. |
| **R28** | Configuration, process and images (new) | Every image this repository owns has a Dockerfile and a build path producing the tag `ops/docker-compose.yml` references. Closes **O1**'s image half. |
| **R29** | Configuration, process and images (new) | The finance-agent process refuses to boot on an incomplete environment, honours the kill sentinel in both forms, binds **no** public port in `longPoll`, and listens on `FINANCE_CONTAINER_PORT` in `webhook`. Closes **O1**'s process half. |
| **R30** | Configuration, process and images (new) | The host firewall posture and the compose port bindings must **agree**, and the certificate-challenge resolution must be **recorded** in `ops/GATE_REGISTER.md`. Closes **F12**. |

Three prose blocks carry the reasoning that does not belong inside a criterion, in R25's established style:
a **trap note** under R26 explaining why the requirement is mode-aware rather than shared; a **finding note**
under R28 citing O1; and a **finding note** under R30 setting out the F12 gap and both admissible
resolutions.

**A decision note recording the seven owner rulings as settled**, each with the artifact that must change for
it to be carried out: **D-ROTATE** deferred, rotation becoming the final acceptance test; **F11** reads free
and mutations owner-in-the-loop; **D-CAP** a hard USD 5.00 per week **in total**, two keys at 2.50 each;
**D-WAL** outcome B, widening no mount; **D-BENCH** authorized, one Phase-1 pass on the dev key;
**D-ALLOWLIST** comma-separated with surrounding whitespace trimmed and a single bare identifier parsing;
**D-G5** the consent screen published to production and `BACKUP_FOLDER_REF` a folder the uploader creates on
first run.

**And the phasing, recorded so a deferral is not later read as a cancellation.** Phase 1 is `longPoll`, so
**G2, G6 and the entire proxy path are deferred, not cancelled**; in phase 1 the `caddy` service stays down
and `<TLS_PORT>` is not bound. F12 must be closed **before** phase 2 begins, because it is the phase-2
prerequisite that currently looks satisfied and is not.

### The design delta

Appended to `.kiro/specs/06-two-agent-vps/design.md` as a new section; **nothing above it was revised**,
because nothing above it turned out to be wrong - what Phase 10 changes is the order of delivery, not the
shape. Six parts: **D1** the transport mode as a first-class axis, with the three shapes considered and why
two were rejected (synthesising a header makes the guard lie; making the expected token optional is the door
R11 exists to close); **D2** offset advance as the durability boundary, and why the dedup key does not change;
**D3** the loader's growth to six services plus the aggregate refusal, with two constraints on how the
aggregate is built (a code per finding, and entry names only); **D4** the process entrypoint and what
`longPoll` removes from it; **D5** images and the port posture, holding the `signalbus` no-published-port
comment as correct and unchanged; **D6** four added test cases, the webhook ones named as the regression fence.

### The one thing the mandate got wrong, reported rather than smoothed

Mandate §6.1 states that the environment loader "names **every** missing entry at once" and marks it
**Confirmed**. **It does not, and the disk says so.** `readRaw` in `src/server/config/environment.ts` throws
`EnvConfigError` on the **first** absent entry, and that error carries a single `entry` field. The module's own
note describes the situation accurately - it calls `describeConfiguredPresence` the answer to "which entry am
I missing", "which is exactly the question a loader that refuses on the FIRST missing entry answers one item
at a time". So the all-entries facility exists, returns a boolean per entry, and is **not on the refusal
path**.

Two consequences, both recorded rather than worked around. R27 is authored as the **target** behaviour, since
it is what ladder rung **L0** observes and what the mandate intends; and task 10.2 therefore has real work in
it - collect across all required entries, refuse once naming every finding - rather than a re-confirmation of
a property that was reported as already holding. The other property §6.1 asserts **is** true as stated:
`process.env` appears in exactly one non-test expression under `src/`, `processEnvSource()`, isolated so the
tree scan has exactly one permitted hit.

### Reconciliations made, and the one deliberately not made

- **`_PFOS_CONTRACT_INDEX.md`** - contract 12's owning-requirement range read `R6-R24` while the spec already
  carried **R25**, so it had drifted by one before this increment. Now `R6-R30`, covering both the drift and
  the six new criteria, with the reconciliation recorded in place. **The contract file itself was not edited.**
- **R25's decision note** was labelled `AWAITING OWNER CONFIRMATION`. D-ALLOWLIST is now settled, so the label
  was corrected to `SETTLED 2026-08-10` with a pointer to the ruling. **R25's criterion text is unchanged**:
  its delimiter is a strict **superset** of the ruling, so every value the ruling admits already parses to the
  same list, and the ruling forbids nothing R25 accepts. Leaving the stale label would have left two blocks in
  one file disagreeing, which is the exact failure mode this spec keeps flagging elsewhere.
- **Not made:** `ops/GATE_REGISTER.md` was **not touched**. No gate was renumbered, softened, reordered,
  reopened or ticked; G7 stays **CLOSED - WONT-DO**. R30 obliges a line there, and that line belongs to task
  10.8 which makes the choice - writing it now would record a resolution nobody has chosen.

### Verification

- `npm run verify:all -- --all` - **`HARNESS PASSED`, `20 of 20 executed checks passed`**.
- `npm run test` - **1792 passing**, unchanged by this increment, which adds no test because it adds no
  behaviour. The AC04 `--min` floor stays at **1790** and needed no ratchet; it was not lowered.
- **AC09**, **AC11** and **AC18** pass over the four changed files, and they were written to that standard
  rather than checked into it: no domain, no host address, no port number, no storage identifier, no bot name
  or numeric identifier, no token, no monetary figure other than the owner's own published cap figures, and no
  deployment particular of any kind (**R24**). Every value referenced is named by entry name or by
  `<ANGLE_BRACKET>` placeholder.
- `node scripts/loop/verify-ledger.mjs` - exit **0**: 80 events, chain **intact**, 20 certificates,
  `uncovered: none`. The ledger required **no append** for this increment and was **not hand-edited**; AC13
  passes as "intact and covering" over the tree as changed.
- **No check was weakened.** `scripts/verify/all.mjs` was not touched. No assertion was loosened, no test
  skipped or deleted, no floor lowered, no scanner allowlisted or exempted.

### Honest scope note

**Nothing was executed and nothing was attempted.** No gate was performed, simulated or claimed; no container
was built; no provider was called; no network request was made; no secret was read; `setWebhook` was not run;
no DNS record was created; no port was published. The other repository was not cloned, read, modified or
pushed. Four tracked files changed - the spec's `requirements.md`, `design.md` and `tasks.md`, plus this log
and the PFOS contract index - and **no file under `src/`, `tests/` or `ops/` was touched**, so **AC10** had no
new file to declare a contract and phase for.

**The `tasks.md` change in this increment is not this task's own edit.** The Phase 10 task rows and the task
dependency graph were authored by the orchestrator before this task ran and were uncommitted on disk; they are
included in this increment's commit so the tree is clean for **AC14** and so the rows that define R26-R30 are
committed alongside the requirements that answer them. Task status transitions belong to the orchestrator, and
no checkbox was ticked here.

### Still gated

- **G1-G8 untouched and unattempted; every open one stays `BLOCKED - awaiting human`.** G7 remains closed as
  WONT-DO and was not re-raised. **G2 and G6 are deferred by the phase-1 `longPoll` decision, not cancelled**,
  and the deferral is recorded in the requirements rather than left implicit.
- **O1 is not closed by this task** - it is now *specified* (R28, R29) and closes when 10.7 and 10.8 land.
- **F12 is not resolved by this task** - R30 asserts that the firewall and the bindings must agree and that
  the choice must be recorded; **task 10.8 makes the choice**.
- The eligibility registry is still `provisional: true`; D-BENCH authorizes the run that lifts it, and the run
  has not happened.
- The three cross-repo changes are still *emitted, unapplied*. The mandate's §7 blocker stands: option **(b)**
  is recommended, phase 1 ships the finance agent on bot B only.

## Task 10.1 - the two steering files reconciled, so a session reads one rule instead of two (2026-08-10)

**Spec:** `.kiro/specs/06-two-agent-vps`. **Authority:** `KIRO_SHIP_LIVE.prompt.md` rev 2, 2026-08-10 - §0
item 3 (the standing waiver), §1 (**D-ROTATE** and **F11**), §11 (the prohibitions). **Scope:** steering text
only. Two files changed, four entries between them. **No code, no test, no `ops/` artifact and no contract file
was touched**, and nothing was executed - see the scope note below.

### The defect this closes

`OPERATOR_STATE_2026-08-09.md` §6 records it as **F11**: *steering contradicted steering and no precedence
line resolved it.* `.kiro/steering/two-agent-vps.md` §2 put "any use of a **production** secret" in its
STOP-and-record column. `.kiro/steering/cloudflare-dns.md` item 5 said "reads are free, writes are gated" and
declared precedence only against `docs/CLOUDFLARE_DNS_SETUP_G2.md` - **not** against `two-agent-vps.md`. Both
files are canonical, both load, and they disagreed on whether an agent may authenticate with the owner's token
in order to **read**. The question had been answered once already by exception - the two read-only bot probes
were labelled *owner-directed*, which is a waiver rather than a rule - so the next session would have obeyed
whichever file it happened to read first. A second, separate defect sat in `cloudflare-dns.md` item 3, which
still read as an instruction to **rotate** after the owner had deferred rotation: a later session could have
rotated unilaterally, in good faith, and taken the deployment's own credentials out from under it.

### Edit 1 - `.kiro/steering/two-agent-vps.md`, new §2a plus one line of §2 and three bullets of §6

The GATED bullet now reads "any **mutating** use of a production secret", and says in place that the carve-out
below is the whole of the exception so nothing else in that column moves. **§2a** is the new sub-section, and
it states the rule with its boundary rather than as a general loosening:

| Half of the rule | What it says |
|---|---|
| **Reads are free** | A read-only operation against a live provider using an **existing** credential is permitted at the owner's direction, and that direction is **standing**. The test is stated, not just illustrated: it is a read when it cannot change any state the provider holds. Named examples: a status or health probe, `getMe`, `getWebhookInfo`, a zone or record **listing**, a DNS **resolution**, `git clone`, `git fetch`. A credential is still confirmed by a scoped call, never by echoing it. |
| **Mutations are owner-in-the-loop** | Anything that **spends money**, **publishes a public record**, or **grants a third party access** goes to the owner first - and so does anything that **creates, rotates or destroys a credential**, and any **write to a repository this session does not own**. Named concretely so nothing has to be inferred: `setWebhook`, a DNS record, publishing a host port, minting or revoking a token, a model call charged to a production key, an upload, a push. Presenting a mutation as a diagnostic does not make it a read. |

It cites **§0 item 3 dated 2026-08-10** as the authority, names `cloudflare-dns.md` item 5 as the file it
reconciles with, and states that it **resolves F11**. The fail-closed rules are restated inside it as
explicitly untouched - never invent a secret value, never commit a real secret, never place a key in the backup
storage, never weaken a gate, never claim a gate is done - with the line that matters for a reader in a hurry:
**a read does not advance a gate; it produces evidence about one.** G1-G8 keep their numbers, steps and
states, and **G7 stays CLOSED - WONT-DO**.

**§6 was amended because the carve-out made the cross-repo question live rather than theoretical.** It had
forbidden "clone, modify, or push" as one undivided prohibition; under §2a a clone or fetch is a **read** and a
modify or push is a **mutation**, so leaving it undivided would have left the next session to infer the split.
It now says so: a read-only `clone` or `fetch` is permitted **into a location outside this repository's tracked
tree**, so nothing it brings can be committed here by accident; modifying, committing in, or pushing it stays
forbidden without the owner's explicit authorisation; and the three change specifications in
`ops/nizamcore-patches/` stay **emitted and unapplied** until that authorisation exists. A closing line notes
that a permission to read is not a reason to exercise it.

### Edit 2 - `.kiro/steering/cloudflare-dns.md`, item 3 rewritten and item 5 extended

Item 3 keeps its force as a **prohibition on disclosure** and resequences only the remedy. Its first sentence
is unchanged - the token is never read into a message, a log, a commit or a report, confirmed by a scoped call,
and `docs/CLOUDFLARE_DNS_SETUP_G2.md` step 7 states this as a rule that was **violated on 2026-08-09**. The
one word that changed there is the tail: the token is now described as **disclosed** rather than "compromised
until rotated", because "until rotated" was the clause that read as an instruction. Then four things are added:

- **Rotation is deferred by owner decision dated 2026-08-10 (D-ROTATE)**, until the deployment has been tested
  in practical use and the owner reports it working; rotation then becomes the **final acceptance test** rather
  than a step that was skipped. The disclosed tokens are the tokens this deployment uses.
- **No session may rotate unilaterally** - not the zone token, not either bot token - citing
  `KIRO_SHIP_LIVE.prompt.md` §1 **D-ROTATE** and §11 ("do not rotate anything").
- **The compensating control**, stated as not optional: while the disclosed tokens are live, `getWebhookInfo`
  is checked **on every run** as the detection control. A deferral without its compensating control is just an
  unrotated credential.
- **The cross-reference**: creating, rotating or destroying a credential is a **mutation**, so the boundary
  lives in `two-agent-vps.md` §2a.

Item 5 now says that "reads are free, writes are gated" is the **general rule** rather than one provider's
local habit, cites §2a for the boundary, and records that it resolves **F11** - the citation the requirements
table names as this task's obligation.

### Verification against the ruling table, done before the harness

`requirements.md`'s decision note names the two obligations this task carries, and both were checked against
the edits rather than assumed:

- **D-ROTATE row** - "Task 10.1 edits `.kiro/steering/cloudflare-dns.md` item 3 to record the deferral."
  Recorded, with all three components the row states: deferred until practical-use testing; rotation becomes
  the final acceptance test; `getWebhookInfo` checked on every run while the disclosed tokens are live.
- **F11 row** - "Task 10.1 adds the read-only carve-out to `.kiro/steering/two-agent-vps.md` §2 and cites it
  from `.kiro/steering/cloudflare-dns.md` item 5." Both done, and the mutation clause is worded to the row's
  own three triggers: spends money, publishes a public record, grants a third party access.

**Nothing in the ruling table had to be reconciled**, and no requirement, design line or gate register entry
was edited by this task.

### The third file that did NOT have to change, checked rather than assumed

`.kiro/steering/cloudflare-dns.md` declares its own precedence: `docs/CLOUDFLARE_DNS_SETUP_G2.md` wins on gate
G2 and on the token. That document was **read** for the disagreement the mandate anticipated, and there is
none: its step 7 states the non-disclosure rule ("do not paste the token into a chat, including to an
assistant... it never needs the value") and states **no rotation instruction anywhere in the file** - a search
for `rotat` matches once, in section 6's argument about a log the deployment "cannot rotate", which is about
the intermediary's logs and not about this credential. So the deferral has nothing there to disagree with, and
**`docs/CLOUDFLARE_DNS_SETUP_G2.md` was not modified.** Item 3 now says this in place, so the next reader does
not have to repeat the check.

### Gate result

- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because **AC14**
  and **AC15** require a clean tree. The pre-commit run was 18 of 20 with exactly those two failing on the
  three uncommitted entries, which is the expected shape and not a regression.
- `npm run test` - **1792 passing**, unchanged: this increment adds no behaviour and therefore no test. The
  AC04 `--min` floor stays at **1790**, was not ratcheted because nothing grew, and was **not lowered**.
- **AC09**, **AC11** and **AC18** pass over the changed files, which were written to that standard rather than
  checked into it: no domain, no host address, no port number, no storage identifier, no bot name, no numeric
  identifier, no token, no monetary figure other than the owner's own published cap figures, and no deployment
  particular of any kind (**R24**). Every value is named by entry name or by `<ANGLE_BRACKET>` placeholder.
- **No check was weakened.** `scripts/verify/all.mjs` was not touched; no assertion loosened, no test skipped
  or deleted, no floor lowered, no scanner allowlisted.

### Honest scope note

**Nothing was executed and nothing was attempted.** No credential was created, rotated or destroyed. No
credential value was read. `setWebhook` was not run; no DNS record was created; no host port was published; no
outbound network call was made at all. **No clone or fetch of the other repository was performed** - this task
wrote the rule permitting one, and deliberately did not exercise it. `ops/GATE_REGISTER.md` was not opened for
edit: nothing was softened, renumbered, removed or reopened, no checkbox was ticked, and **G7 stays
CLOSED - WONT-DO**.

Four tracked files are in this increment: the two steering files, this log, and the PFOS contract index. The
spec's `tasks.md` also carries the orchestrator's own in-progress marker for this row, uncommitted on disk when
this task began; it rides along so the tree is clean for **AC14**. **Task status transitions belong to the
orchestrator and no checkbox was ticked here.**

### Still gated, unchanged by this task

- **G1-G8 untouched and unattempted.** Every open one stays `BLOCKED - awaiting human`. **G2 and G6 remain
  deferred** by the phase-1 `longPoll` decision - deferred, not cancelled.
- **O1 and F12 are untouched.** They close at tasks 10.7, 10.8 and 10.2, not here.
- **The rotation itself is now a scheduled acceptance test, not a closed item.** D-ROTATE defers it; it is not
  done, and the compensating `getWebhookInfo` check is a control rather than a substitute.
- The three cross-repo changes stay **emitted and unapplied**. §2a now permits reading that repository; the
  mandate's §7 authorisation is still what is needed to write to it, and option **(b)** remains the
  recommendation.

## Task 10.2 - the environment loader over all six services, and the aggregate refusal it did not have (2026-08-10)

**Spec:** `.kiro/specs/06-two-agent-vps`, Phase 10 task 10.2. **Authority:** `KIRO_SHIP_LIVE.prompt.md` rev 2
§6.1, and **R27**. **Design:** `design.md` **D3**, authored by task 10.0 for exactly this work. **Scope:** two
files under `src/server/config/`, plus the AC04 floor and this log. **No network call, no secret read, no
credential created, no gate touched, and no checkbox ticked.**

### This task had two jobs, because §6.1 was wrong on one point

Task 10.0 recorded it and this task carried it out. Mandate §6.1 marks "names **every** missing entry at once"
as **Confirmed**; the disk said otherwise, and still did when this task began: `readRaw` threw
`EnvConfigError` on the **first** absent entry, and that error carries a single `entry` field.
`describeConfiguredPresence` returned a boolean per entry and was **not on the refusal path**. So the work
was (a) widen the loader from two agents to six services, and (b) **build the aggregate refusal that did not
exist**. Ladder rung **L0** is unpassable without (b): its pass condition is that removing one required entry
fails the boot naming that entry **and every other missing one in the same message**, and a first-failure
error passes half of that.

### What the loader now holds

| Added | What it is |
|---|---|
| `DEPLOYMENT_SERVICES`, `DeploymentService`, `isDeploymentService` | The six identities the deployment declares - `life`, `finance`, `proxy`, `bus`, `scheduler`, `backup` - spelled as `ops/env/*.env.example` names them. The two agent identities are members with the same spelling, so every existing agent-shaped call site is unchanged. |
| `SERVICE_ENTRY_NAMES`, `serviceEntryNames(service)` | Each service's own entry names, frozen. The same shape `AGENT_ENTRY_NAMES` already had, over six rows instead of two. An identity outside the set is refused with `ENV_SERVICE_UNKNOWN`; there is **no lookup by arbitrary string**. |
| `EnvConfigFinding`, `EnvConfigAggregateError`, `refuseOnFindings` | The aggregate. **A code per finding, not one umbrella code** - `EnvConfigAggregateError` has no `code` field at all, and exposes `findings`, `entries` and `codes`. Constructing one with no finding throws, because a refusal with no reason is not a refusal. |
| `classifyEntry`, `collectServiceFindings`, `requireServiceEnvironment` | Collect first, refuse once. `classifyEntry` never throws, which is what makes naming everything possible. |
| `collectDeploymentFindings`, `requireDeploymentEnvironment`, `servicesPresent`, `EnvByService` | The same, across any subset of the six, still one message for all of them. A phase that runs three services is not obliged to supply six. |
| `ABSENCE_IS_A_DECISION` | The one documented exception, and it is about **absence only**: an absent, empty or whitespace-only `ALLOWED_USER_IDS` is a decision that means nobody (**R25**), while an unfilled placeholder there is still a finding. |
| `SHARED_ENTRY_AGREEMENTS`, `collectSharedEntryDisagreements` | The mandate §4 rule that a shared entry must carry the **same value** where it is shared: both container ports, the allowlist, the sentinel path, the bus endpoint, the eligibility registry path, and the two provider bases. |
| `KILL_SENTINEL_MOUNT_TARGET`, `KILL_SENTINEL_SERVICES`, `collectKillSentinelFindings` | The sentinel path must resolve **inside** the halt mount in all four honouring services, and must not climb out of it. A sentinel elsewhere is a kill switch that silently does nothing. |
| `collectForeignEntryFindings`, `collectCrossServiceFindings`, `requireCrossServiceAgreement` | Every negative row of §4 as **one** rule rather than four greps: an entry declared by another service and not by this one is `ENV_FOREIGN_ENTRY_PRESENT`. That covers no finance secret in the life file and the reverse, no bot token or expected secret token in the proxy file, and no webhook path segment in either agent file. |
| `describeServiceConfiguredPresence` | Presence for a service's whole entry set, booleans and nothing else. |

Four codes joined `ENV_CONFIG_ERROR_CODES`: `ENV_SERVICE_UNKNOWN`, `ENV_SHARED_ENTRY_DISAGREES`,
`ENV_KILL_SENTINEL_OUTSIDE_MOUNT`, `ENV_FOREIGN_ENTRY_PRESENT`. **No existing export was renamed or removed
and no existing code changed meaning**, so every one of the 35 pre-existing cases in `environment.test.ts`
still asserts what it asserted.

### The three properties that had to survive, and how each is still held

1. **Exactly one bridge to the ambient process environment in the whole of `src/`.** `processEnvSource()` is
   still the only expression that reads it. Six services did **not** become six bridges - they became six
   entry-name groups behind the one bridge, each handed an `EnvSource` by its caller. The tree scan asserts
   the reader list is exactly `['src/server/config/environment.ts']` and its length is **1**, in both suites.
2. **Per-service independence is structural, not checked.** Nothing below the table looks an entry name up by
   string. A `proxy` load can no more spell `OR_KEY_FINANCE` than a `finance` load can spell `OR_KEY_LIFE`,
   and the pairwise exclusions are asserted for the agent secrets, the two webhook path segments, and every
   credential against the bus and the scheduler.
3. **No default for anything, and a placeholder is a failure rather than a value.** Asserted exhaustively:
   for **every** service and **every** one of its entries except the documented allowlist exception, removing
   that entry alone produces exactly one finding, naming that entry, coded `ENV_ENTRY_ABSENT`.

### The entry names came from the templates, and a test says so

`ops/env/*.env.example` is the source of truth. No entry was invented and none renamed. The suite parses all
six templates with the **existing** `parseEnvTemplate` from `src/server/ops/envTemplates.ts` - reused rather
than re-derived - and asserts each loader group equals its template **set for set in both directions**, plus
the authored counts: life **19**, finance **17**, proxy **6**, bus **3**, scheduler **5**, backup **12**. A
count is the one assertion a renamed entry cannot satisfy by accident, so the six counts are written out.
`KILL_SENTINEL_MOUNT_TARGET` is likewise asserted against `ops/docker-compose.yml`: four mount lines, each
read-only, each at that target.

**`MAX_CONNECTIONS` was given no home** (finding **F2**). It is an argument to the gate G6 registration
command, it belongs to no environment file, and it is **irrelevant in `longPoll`** - the mode phase 1 ships on
delivers nothing, so there is no delivery concurrency for it to bound. That is recorded in a comment in the
loader and asserted by a test that it appears in no service's entry set. Task 10.4 records where it belongs
for phase 2. Inventing a home would have created a value with two owners that can disagree.

### Tests

**37 new cases** in `src/server/config/environmentServices.test.ts`, a sibling rather than an edit, so the
existing 35 stayed untouched. The headline is the aggregate, and it is asserted the way D3 insists:

- **More than one entry broken at a time.** Three entries wrong three different ways - absent, blank, still
  holding its placeholder - produce **one** refusal naming all three, with the **right code on each**. D3's
  warning is why: a case that removes only one is a case a first-failure error also passes.
- **A whole template copied and never filled in** produces twelve findings in one message, one per backup
  entry.
- **Findings from three services in the same message**, each carrying its own service identity.
- **A negative case per new code**, and each observed firing rather than merely returning a value.
- **No message carries a value.** Every synthetic value is a recognizable marker and the messages are swept
  for all of them; the sentinel finding is shown naming the **mount** and not the configured path, and the
  disagreement finding naming the **entry and its services** and neither of the two values.

### Gate result

- `npm run typecheck` - clean. `npm run lint` - clean at zero warnings.
- `npm run test` - **1829 passing**, up from 1792. The AC04 `--min` floor is **ratcheted 1790 -> 1829**, up
  only, never down.
- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because **AC14**
  and **AC15** require a clean tree.
- **No check was weakened.** No assertion loosened, no test skipped or deleted, no scanner allowlisted, and the
  only edit to `scripts/verify/all.mjs` is the floor moving up.
- **R24** holds over both changed files: every test value is synthetic and says so on sight (`syn-` prefix, a
  `.invalid` provider base, two- and three-digit sender stand-ins). No domain, no host address, no bot name, no
  numeric identifier, no token, and no monetary figure.

### What this task did not do, stated so the next session does not assume it

**Values are still not resolved for the four non-agent services.** This task widened **coverage** - which
entries a service requires, and refusing a boot that lacks any of them - not value resolution. The typed
per-agent loaders (`loadTelegramTransportConfig`, `loadAgentModelBinding`) are unchanged, and the proxy, bus,
scheduler and backup services get completeness and cross-file agreement rather than a typed configuration
object. That is deliberate: three of those four services are not this repository's processes, and a returned
object holding their values would put `DRIVE_REFRESH_TOKEN` and `GOOGLE_CLIENT_SECRET` into a shape something
could log. **R29's boot refusal is task 10.7**, which is where `requireServiceEnvironment` gets called by a
process. **Ladder rung L0 is now passable** and task 10.12 is where it is recorded as observed.

---

## Task 10.3 - one fill-in sheet, so the owner is asked once and never for a value he cannot get (2026-08-10)

**Authority:** `KIRO_SHIP_LIVE.prompt.md` rev 2 §8 step 3 - "every entry the owner must supply, grouped by
file, with its gate, its `secret` flag, and the proof command. One pass, not six round trips."
**Artifact:** `.kiro/specs/06-two-agent-vps/OWNER_FILL_IN_SHEET.md`. **Task:** 10.3, ticked.

### What it is, and what it deliberately is not

It is an **action sheet for the owner**: sixty-two entry-to-file assignments across the six environment
files, ordered by the sequence he should work them rather than by template order. It is **not** the wire-up
matrix - that is task 10.4's `DEPLOYMENT_VALUE_LEDGER.md`, written in the next increment as a separate
commit, because the two documents answer different questions for different readers. This one is worked top
to bottom once and then thrown away; that one is a reference the build is held against.

### The three things it does that a list of entry names would not

1. **It says when.** Every row carries `phase 1`, `phase 1 - fill, unused`, or `phase 2`. The middle
   marker is the one that mattered to get right: `FINANCE_CONTAINER_PORT` and `MONEY_WEBHOOK_SECRET` are
   **required by the loader or the boot refuses**, and are read by **nothing** in `longPoll`. A sheet that
   only marked them "phase 2" would produce a deployment that will not start; a sheet that marked them
   "phase 1" without qualification would imply they do something. Both webhook secrets are additionally
   recorded as **host-generated rather than provider-issued**, which is why the owner can supply them now
   with no domain even though their *use* is deferred with G6.
2. **It states the unit where the unit is the trap.** See F13 below. `2.50` typed literally into
   `FINANCE_WEEKLY_CAP` is a startup refusal, and the sheet says so in place rather than in a footnote.
3. **Its proof commands report counts.** Every one is `grep -c` -> `1`, with a negative block per file
   returning `0`. That is the only form R24 permits: it answers "did the value land" without the value
   reaching a terminal, a log, or a report. Where a proof line could disagree with `ops/GATE_REGISTER.md`,
   the sheet states in its own header that **the register wins and the sheet is the bug**.

### The order, which is not the template order

`finance` -> `bus` -> `scheduler` -> `backup` -> `life` -> `proxy`. Under mandate §7 option **(b)** the
finance agent is the only process phase 1 runs, the bus and scheduler are what it talks to, backup is
durability (ladder L5), and the last two files belong to work that has not started - all nineteen `life`
entries and all six `proxy` entries. Listing them in full anyway is deliberate: the owner should never work
a file twice.

### Sources, in precedence order, all re-read rather than trusted

`src/server/ops/envTemplates.ts` (`ENTRY_SPECS` - gate and secrecy), `src/server/config/environment.ts`
(`SERVICE_ENTRY_NAMES` - entry names and the cross-file rules), the six `ops/env/*.env.example` templates
(the authoritative `what:` / `gate:` / `secret:` annotations), `ops/docker-compose.yml`,
`ops/GATE_REGISTER.md`, and `ops/backup/backup.sh` plus `ops/restore/restore.sh`. The three disagreements
that re-reading turned up are recorded as **F13**, **F14** and **F15** in task 10.4's ledger rather than
reconciled silently here, because two of the three need a decision this task does not own.

**F13, in short, because it changes what the owner types.** `LIFE_WEEKLY_CAP` and `FINANCE_WEEKLY_CAP`
carry one entry name over **two units**: `loadAgentModelBinding` reads a bare integer of the spend ledger's
micro-USD and **refuses a decimal rather than rounding it**, while `ops/GATE_REGISTER.md` G4 step 3
interpolates the same placeholder into the provider's key-creation body, where the field is a decimal. Both
are individually correct and together they cannot both take D-CAP's `2.50`. The register was **not edited**
(this task must not), so the sheet carries the conversion and the finding carries the decision to 10.10.

### Gate result

- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because AC14
  and AC15 require a clean tree.
- **No code changed**, so the test count is unmoved at **1829** and the AC04 `--min` floor stays **1829**.
  Nothing was lowered, allowlisted, skipped or exempted.
- **R24 holds.** No token, domain, host address, numeric identifier, bot name, storage reference or real
  monetary figure. Every value is an `<ANGLE_BRACKET>` placeholder; the D-CAP figure appears only as the
  policy ruling already tracked in `requirements.md`, and the micro-USD conversion is expressed by pointing
  at `MICRO_USD_PER_USD` in `src/features/routing/spendLedger.ts` rather than by writing an integer out.
- **No gate was attempted, no checkbox ticked, and `ops/GATE_REGISTER.md` was not edited.** G7 stays
  CLOSED - WONT-DO. No outbound call was made: nothing was registered, resolved, published or uploaded.
- The orchestrator's uncommitted rows **10.16**, **10.17** and **10.18** plus the wave-graph update were
  carried into this commit rather than dropped or rewritten.

### What it did not do

No value was obtained, read, generated or placed; no environment file exists on any host. No template under
`ops/env/` was edited - the sheet is a reading of them, and if it ever disagrees with one, the template is
authoritative and the sheet is wrong.

---

## Task 10.4 - the deployment value ledger, and the rules it admits are not yet mechanical (2026-08-10)

**Authority:** `KIRO_SHIP_LIVE.prompt.md` rev 2 §4 (four rules the wire-up matrix must satisfy) and §3 (the
placement map). **Artifact:** `.kiro/specs/06-two-agent-vps/DEPLOYMENT_VALUE_LEDGER.md`. **Task:** 10.4,
ticked. **Extends** `TELEGRAM_VALUE_LEDGER.md`'s 14 transport entries to **62 entry-to-file assignments over
45 distinct entries across all six services** - life 19, finance 17, backup 12, proxy 6, scheduler 5, bus 3.

### The four §4 rules, each satisfied testably rather than asserted

1. **No entry has a default.** Stated **once** as an invariant instead of 62 times, with its mechanism
   (`classifyEntry` -> `collectServiceFindings` -> `refuseOnFindings`) and its **one** documented
   exception: `ABSENCE_IS_A_DECISION` holds only `ALLOWED_USER_IDS`, and only about **absence** - an
   unfilled placeholder is still a refusal there, because that is a template nobody completed rather than
   a list somebody emptied.
2. **Negative rows.** Five `grep -c` -> `0` assertions covering the mandate's four crossings, recorded as
   **one rule rather than four**: `collectForeignEntryFindings` reports any entry present in one service's
   environment that another declares and this one does not, so all four fall out of it and so does every
   future one. The ledger keeps the reason the two G6 value kinds split in **opposite** directions - paths
   to the proxy because routing is its job, secret tokens to the agents because a proxy that held the value
   could compare it, and that comparison would then live where no test covers it.
3. **Shared entries equal where shared.** The **full** eight-row set taken from `SHARED_ENTRY_AGREEMENTS`,
   plus - and this is the half a shorter document would have dropped - **the three deliberate exclusions
   with their reasons.** `TELEGRAM_MODE` must **not** be forced equal, because phase 1 runs the finance
   agent on `longPoll` while the life agent idles and forcing agreement would refuse the phasing the owner
   chose. `MAX_WORK_ITEMS` and `STORE_BUSY_TIMEOUT_MS` are per-process capacity choices.
4. **`KILL_SENTINEL_PATH` identical in all four and inside the mount.** Recorded as **two** properties
   because either alone is insufficient: four paths that agree and sit outside `/run/nizam-kill` are four
   halts that do nothing, and four paths inside the mount that disagree are a halt that reaches some
   writers and not others. A halt that reaches only some writers is not a halt.

### `MAX_CONNECTIONS` (F2): a home recommended, and nothing applied

Recorded as having **no referent** in `longPoll` rather than merely being unused - in that mode the provider
delivers nothing, so there is no delivery concurrency to bound. The finding is that after a host rebuild
G6's verification line cannot be re-run against the value actually set, because nothing on the host records
it. The recommended phase-2 home is an operator-gated entry in **`proxy.env`**: it is already the file whose
entire contents are the phase-2 webhook surface, it already carries the other two G6-gated entries, and G6
is run from the host with values sourced from it. **No template was edited and no entry added** - the change
belongs with the increment that closes **F12**, because both are port-and-registration facts that must agree
with the firewall.

### Three findings, none of them reconciled where it was found

- **F13 - one cap entry, two units.** `loadAgentModelBinding` reads `FINANCE_WEEKLY_CAP` as a bare
  micro-USD integer and **refuses a decimal rather than rounding**; `ops/GATE_REGISTER.md` G4 step 3
  interpolates the **same placeholder** into the provider's key-creation body, where the field takes a
  decimal. Both correct alone; D-CAP's figure cannot satisfy both spellings of one name. **The register was
  not edited** - this task must not, and the register outranks the ledger on gate verification. Owner: task
  **10.10**.
- **F14 - `restore.sh` requires five entries no template declares**, and that is **correct and must stay
  correct**: restore runs on the operator machine, and `AGE_IDENTITY_FILE` is a path to the **off-host
  private half**, which the placement map forbids from ever reaching the host. Recorded because a reader
  counting entries would otherwise think six were missing, and because it means the six templates are
  **not** the whole configuration surface of this repository.
- **F15 - `backup.sh` asserts six of `backup.env`'s twelve.** Five of the six it does not assert are the
  storage credentials plus `BACKUP_FOLDER_REF`, and the script is deliberate: it names no credential entry,
  because the `nizam-backup` uploader resolves them. The **residual gap** is that the uploader does not
  exist yet (**O1**), so nothing today asserts those five before an upload is attempted. Owner: tasks
  **10.8** and **10.9**.

**And a non-finding worth recording.** `ENTRY_SPECS`, `SERVICE_ENTRY_NAMES` and the six templates were found
to **agree** on all 45 entries and all 62 assignments, in both directions, each pair already asserted by an
existing test. Task 10.2's observation that two sources of entry truth exist with neither named the
authority is resolved by the ledger's precedence header: **secrecy and gate from `ENTRY_SPECS`, entry names
and cross-file rules from `SERVICE_ENTRY_NAMES`**, and the templates above both.

### The honest half: what the ledger says is NOT mechanically checked

§9 carries an **eight-item** "not yet mechanical" list rather than letting a table of checker names imply
enforcement. The two that matter most to a later reader: **nothing checks the six env files as they exist on
the host** - every check runs over the templates or an injected `EnvSource`, and the `grep -c` proofs are
commands for a human because the harness has no host; and **the four-way sentinel agreement is not asserted
in phase 1**, because `collectSharedEntryDisagreements` correctly skips a rule with fewer than two holders
and phase 1 runs one agent. Also listed: the encrypt-then-upload-then-shred ordering is implemented by
`backup.sh` and read by no checker (ladder **L5** is the observation, blocked on G5 and G8); nothing asserts
the private key is absent from the host or the storage (that is G8's line, and the empty output is the
gate); F15's gap; F13's unresolved unit; `MAX_CONNECTIONS` still homeless; and `BACKUP_FOLDER_REF`
unvalidatable before the first uploader run by construction.

### Every asserted rule cites its checker

`collectServiceFindings`, `collectSharedEntryDisagreements`, `collectKillSentinelFindings`,
`collectForeignEntryFindings`, `refuseOnFindings`, `classifyEntry`, `auditEnvTemplates`,
`scanForParticulars`, `KILL_SENTINEL_MOUNT_TARGET`, `KILL_SENTINEL_SERVICES`, `SHARED_ENTRY_AGREEMENTS`,
`ABSENCE_IS_A_DECISION` - named, so a rename in code makes the document visibly wrong instead of quietly
stale.

### Gate result

- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because AC14 and
  AC15 require a clean tree.
- **No code changed**, so the test count is unmoved at **1829** and the AC04 `--min` floor stays **1829**.
  Nothing lowered, allowlisted, skipped or exempted.
- **R24 holds.** No token, domain, host address, numeric identifier, bot name, storage reference or real
  monetary figure; every value is an `<ANGLE_BRACKET>` placeholder. The document sits under `.kiro/specs/`
  rather than `ops/`, so it is outside AC18's scanned set - and it was written to pass that scan anyway,
  because a document that would fail it is a document carrying something it should not.
- **Two separate commits, deliberately.** 10.3 is an action sheet the owner works once; 10.4 is a reference
  the build is held against. Merging them would have produced one document serving neither reader.
- **No gate attempted, no checkbox ticked, `ops/GATE_REGISTER.md` untouched**, G7 still CLOSED - WONT-DO, no
  outbound call, and the other repository not touched.

## Task 10.5 - the live transport adapter, and the mode axis the guard did not have (2026-08-10)

> Owning contract: **PFOS 12** - Two-Agent VPS Deployment & Operations, §5 (transport), §2.3 (the
> long-poll fallback), §5.5 (accept fast, process asynchronously). Spec:
> `.kiro/specs/06-two-agent-vps/` task **10.5**, mandate `KIRO_SHIP_LIVE.prompt.md` §8 step 5.
> Requirements: **R26** (the mode selects which gates apply), **R26.1** (the offset advances only
> after the update is durably enqueued), with **R11**, **R12**, **R13**, **R14**, **R15** composed
> unchanged. Design: delta **D1** (the taken shape) and **D2** (the durability boundary).

### What was built

`src/server/telegram/liveTransport.ts` - one module, behind the **existing** `TelegramPort`, both
modes. `createLiveTelegramTransport(ctx)` returns `{ port, mode, currentOffset(), pollOnce() }`,
where `port` is a `TelegramPort` assembled from three things that already existed: the synchronous
accept path (`createInboundHandler`), the injected worker, and an outbound role that retries the
provider's documented rate-limit refusal with bounded backoff.

**The port's shape did not change.** Nothing was added to `ports/telegram.ts`, nothing was widened,
and `TelegramAcceptDecision` still has no reason field. The adapter's own vocabulary - the polled
update, the batch, the fetch request, the offset store, the two policies - lives in the adapter,
because none of it is a port concern: it describes how one transport is *reached*, not what the three
roles *are*.

### The mode axis, which is the whole of the trap

`authorizeDelivery` evaluated three gates unconditionally and read them in the order configuration,
token, allowlist. `secretTokenIsConfigured` is consulted **first**, so an absent, empty, over-length
or out-of-charset expected token refuses **every** request. That is right for `webhook` and it stays.
Under `longPoll` there is no inbound request, so `secretTokenHeader` is `null` and there is no
expected token to match - the unchanged guard would have refused every message the owner sent, and
presented as a bot that was created, verified live and silently broken.

So `authorizeDelivery` now takes the **mode** as a required third input, and
`TELEGRAM_MODE_APPLICABLE_GATES` is the whole of the asymmetry, written as data rather than as a
branch:

| Mode | Gates applied | Consequence |
|---|---|---|
| `webhook` | configuration, token, allowlist | R11 untouched. All four refusal shapes still refuse. |
| `longPoll` | allowlist | The allowlist is the whole guard, and it refuses by default. |
| anything else | configuration, token, allowlist | The fallback is the **full** set, never the empty one. |

Both shapes D1 rejected are unreachable, and by construction rather than by discipline. **No
synthesised header:** `TelegramPolledUpdate` has no `secretTokenHeader` field at all, so there is
nowhere for a later edit to put a manufactured one, and the accept path is handed `null` - which is
what "the header was absent" already means. **No optional-token relaxation:**
`secretTokenIsConfigured` is unchanged and the `webhook` row still depends on it, so weakening it to
make `longPoll` pass would break the mode that still uses it.

Fail-closed survives, which is the load-bearing claim. A `longPoll` deployment with nothing
configured admits **nobody**: `senderIsAllowlisted` answers false for an empty list and for an empty
sender identifier. The refusal stays indistinguishable as to stage in both modes, because the
decision type has nowhere to put a reason and every refusal returns the one frozen value.

### The offset is the durability boundary (R26.1, D2)

`pollOnce` reads the offset from an injected store, fetches a batch, sorts it ascending, and for each
update calls the accept path - which commits the dedup claim and the queue row in **one**
transaction - and only then advances the offset, by one update at a time. Two properties fall out and
both are asserted against the offset rather than against a sleep:

- **A crash before the enqueue commits re-delivers.** The offset does not move, so the provider
  serves the update again.
- **A crash after it commits and before the offset advances re-delivers too**, and dedup absorbs it -
  one queued row, not two.

The batch **halts** at the first update whose work was not stored. That is not tidiness: the offset is
monotonic, so advancing past a failed update to reach a later one would discard the failed one for
good, and nothing would ever absorb that.

### Two findings this task recorded

- **F16 - the durability answer had to come from the audit path.** `TelegramAcceptDecision` has no
  reason field, deliberately (§5.2), so the adapter cannot ask the decision whether a refusal was an
  authorization refusal or a durability failure - and it needs to know, because one has no work to
  lose and the other has work that was not stored. The **audit sink** is the separate path §5.3
  already requires and it carries the stage, so the adapter interposes on the caller's sink, forwards
  every line unchanged first, and reads exactly one bit: was the stage `enqueue`. Nothing about it
  reaches the response. D2 did not anticipate this, and the alternative - adding a reason to the
  decision - would have broken §5.2 to satisfy R26.1.
- **F17 - a refused update must still advance the offset.** R26.1 says the offset advances only after
  a durable enqueue, and read literally that would pin the offset on an update that will never be
  enqueued at all. An unlisted sender would then wedge the poller forever - a livelock any stranger
  could cause by messaging the bot once. A refusal has no work to lose, so the offset advances past
  it; a durability failure does, so it does not. The requirement's intent is durability, and this is
  the reading that serves it.

### The provider limits, respected rather than restated

Two of the seven limits in `ops/runbook/RATE_LIMIT_POSTURE.md` reach this module. **Limit 4**, the
too-many-requests refusal: the advertised interval is honoured, not estimated, and the wait is the
**longer** of that interval and the module's own bounded backoff - so an interval-less refusal cannot
become a tight loop and an interval-bearing one is never under-waited. The budget is bounded and its
exhaustion surfaces as a refusal; it never becomes a transport failure, because there is no code path
here that reports one. **Limit 6**, the long-poll duration: a non-positive timeout is refused at
construction, because short polling in production is a busy loop against a rate-limited endpoint.

### No network, and none reachable

The adapter's entire outside world is one injected interface, `TelegramTransportClient`. The module
resolves no network module, names no endpoint, and holds no token literal, and that is asserted over
its own source rather than trusted: no `node:http`, no `node:https`, no `fetch(`, no `setWebhook`.
The tests drive it with a scripted client over an array. **No outbound call was made in this task.**

### Gate result

- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because
  AC14 and AC15 require a clean tree.
- Tests **1829 -> 1847** passing, and the AC04 `--min` floor ratcheted **1829 -> 1847**. Up only.
  Nothing lowered, allowlisted, skipped or exempted.
- The durability ordering was **shown failing**: reversing it - advancing the offset before the accept
  path returns - fails `halts the batch and leaves the offset where it was when the enqueue does NOT
  commit`, and only that test. The mutation was reverted.
- Three existing test files bind the mode to `webhook` in one place each rather than at forty call
  sites, so every pinned R11 assertion reads exactly as it did and the fence stays legible.
- **R24 holds.** No token, domain, host address, numeric identifier, bot name or monetary figure; the
  test values are synthetic and obviously so.
- **No gate attempted, no checkbox ticked in `ops/GATE_REGISTER.md`**, G7 still CLOSED - WONT-DO, no
  DNS record, no published port, no credential read, and the other repository untouched.

## Task 10.6 - both directions of the mode-aware guard, shown failing (ladder L1) (2026-08-10)

> Owning contract: **PFOS 12** - Two-Agent VPS Deployment & Operations, §5.2 (the token gate and its
> fail-closed rule), §5.3 (the allowlist, and the audit as a separate path), §5.4 (dedup on the
> pair). Spec: `.kiro/specs/06-two-agent-vps/` task **10.6**, mandate `KIRO_SHIP_LIVE.prompt.md` §6
> item 2 and §9 rung **L1**. Requirements: **R26**, **R26.1**, with **R11**, **R12**, **R13**,
> **R14** held to unchanged. Design: delta **D6**, all four cases.

### What was written

`src/server/telegram/modeAwareGuard.negative.test.ts` - **25 tests**, and the discipline that makes
them evidence rather than decoration: each one is asserted against the **guarded operation** - the
accept path and the poll loop, over a real store on disk - and each refusal is checked to have
written **nothing**. `expectNothingHappened` reads the queue depth in all four states and the dedup
table for the pair, both from the engine. A decision object of the right shape with a row behind it
would otherwise be a green test and an open door at the same time.

### The four D6 cases, each in both directions

| Case | The refusing side | The accepting side it differs from by one field |
|---|---|---|
| `longPoll` and an unlisted sender | refused, audited at the `allowlist` stage, nothing written | the same delivery from the allowlisted owner is enqueued |
| `longPoll` and **no header at all** | the same delivery is still refused under `webhook` | **accepted**, with `secretTokenHeader` asserted `null` first |
| `longPoll` and an empty allowlist | the owner, an outsider and an empty identifier are all refused | one field of policy different - a populated list - and the owner is enqueued |
| `webhook` and an unusable expected token | five shapes times three header states, all refused at the `configuration` stage | a usable token with a header that echoes it is enqueued |

The fence is deliberately wider than the mandate's four shapes: `absent`, `null`, `empty`,
`over-length` and `out-of-charset`, because the policy type admits `null` and a shape the type admits
must be refused rather than assumed unreachable. It also covers absent, empty and wrong **headers**
under a usable token, the unlisted sender carrying the correct token, and one case per `webhook`
stage in turn - so a mode axis that had quietly dropped a gate from `webhook` would show up as a
granted decision rather than as a changed audit line.

Dedup is asserted in **both** modes, including R14's per-bot collision: the same update identifier
from a second bot is a legitimate second update and both are enqueued. The crash before the enqueue
commits is asserted **against the offset** and nowhere near a sleep: the offset does not move, the
provider serves the update again, the second attempt enqueues, the depth is one, and a third poll is
served nothing because the offset now acknowledges it.

### Shown failing, which is the whole of rung L1

A test only ever observed passing is not evidence, so both forbidden shapes were introduced and the
suite was watched to refuse them:

- **The naive reuse** - `longPoll` applying all three gates, which is the trap R26's note describes -
  fails **10 of the 25**, including the acceptance of the owner with no header, the stage of the
  unlisted-sender refusal, both dedup cases and the offset case.
- **The relaxation D1 rejected** - an absent or empty expected token meaning "skip the check" - fails
  **4** fence tests: the `absent`, `null` and `empty` rows, and the all-three-gates-consulted case.
  It changes nothing about `longPoll`, which is exactly why the fence has to exist: without it that
  mutation opens `webhook` and every other test in the tree stays green.

Both mutations were reverted, and `git diff` was read back to confirm the guard is byte-identical to
what commit 1 recorded.

### Rung L1

```
npx vitest run src/server/telegram/modeAwareGuard.negative.test.ts src/server/telegram/auth.test.ts \
  src/server/telegram/auth.constantTime.test.ts src/server/telegram/negativeGuards.test.ts \
  src/server/telegram/acceptHandler.test.ts
```

```
 Test Files  5 passed (5)
      Tests  117 passed (117)
```

**L1 is OBSERVED.** It needs no gate: every guard in it is exercised behind the injected boundary,
with no network, no credential and no host.

### Gate result

- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because
  AC14 and AC15 require a clean tree.
- Tests **1847 -> 1872** passing, and the AC04 `--min` floor ratcheted **1847 -> 1872**. Up only.
  Nothing lowered, allowlisted, skipped or exempted.
- **No production code changed in this commit.** The tests are the deliverable, and they pass against
  the guard exactly as commit 1 left it - which is the only way the fence means anything.
- **R24 holds.** Every token, sender and bot identifier is synthetic and obviously so; no secret value
  was invented, not even a plausible placeholder of the right width.
- **No gate attempted, no checkbox ticked in `ops/GATE_REGISTER.md`**, G7 still CLOSED - WONT-DO, no
  outbound call, and the other repository untouched.

## Task 10.7 - the finance-agent process, and the three things a module cannot be (2026-08-10)

**Owning requirement:** R29. **Design:** delta **D4** (the entrypoint and what `longPoll` removes from it) and
**D6** (the listener assertion). **Mandate:** §8 step 6 / §6 item 3. **Finding closed:** the process half of
**O1**.

### What was actually missing

Not the logic. `src/server/telegram/index.ts` re-exports auth, dedup, the work queue, the accept path, the worker
runner and the live adapter, all of them tested behind mocks - and that completeness is what made the gap easy to
miss. `package.json` had `dev`, `build`, `preview`, `test`, `lint`, `typecheck` and the two verify scripts, and no
`start`. **The code existed; the process did not.** Even with G1 through G8 all clear, there was nothing for a
container to run.

### The shape

`src/server/process/`, five files, one of which touches the platform:

| File | What it owns |
|---|---|
| `haltGate.ts` | §8's two halt forms, and the one activity a halt never reaches |
| `financeAgent.ts` | boot refusal, the three gated activities, the listener set, the loop, shutdown |
| `turnWorker.ts` | `workerRunner`'s slow side wired to `routing/turnDispatch` |
| `main.ts` | the **only** file naming a platform facility: HTTP server, filesystem, streams, signals |
| `start.ts` | one statement: turn an outcome into an exit status |

The split between `main.ts` and `start.ts` is one statement wide and it is deliberate: a module that starts a
process as a side effect of being imported cannot be tested, because the first import would open a store, bind a
listener and register signal handlers.

### Behaviour 1 - it refuses to boot, and it does not catch that refusal

`requireServiceEnvironment({ service: 'finance', env })` is the **first** statement of `bootFinanceAgent`, wrapped
in nothing. There is no `catch` on that path and no degraded mode to fall back to. A booted-but-unconfigured agent
is the failure fail-closed exists to prevent, one layer up: every per-request guard would refuse correctly while
the process as a whole sat there pretending to be a deployment. `runFinanceAgentProcess` reports the message and
returns exit code **1**.

The aggregate is what makes it useful rather than merely correct. Four entries removed produces **one** message
naming all four, with a code per finding rather than one umbrella code - asserted by removing four and reading
`aggregate.entries`, which a first-failure error cannot pass. The message is assembled from entry names, service
identities and codes and never from a value, so reporting it in full is safe (R24).

### Behaviour 2 - the halt, and the asymmetry between its two forms

The **file sentinel** is re-read on every check and cached nowhere. The test that carries this is the only shape a
cached read fails: the injected probe is flipped **between two calls on the same gate**, in both directions, and
the answer is asserted to have changed. A gate that had cached the construction-time read would still answer
`false` after the sentinel appeared; a gate that cached the first engaged read would still answer `true` after it
was removed.

`NIZAM_KILL_ALL` is read **once**, at boot, because that is the only moment its value can have changed. Reading it
repeatedly would be a false promise about the weaker of the two forms.

Three things fail closed rather than open:

- An **unrecognised** coarse value (`yes`, `true`, `2`, `01`, empty) engages the halt. A switch whose position
  cannot be read is treated as on.
- A sentinel probe that **threw** is treated as present. "We could not tell whether the operator has halted us" is
  not a licence to carry on spending.
- The sentinel form is reported in preference to the coarse form when both are engaged, so an operator reads the
  live one.

**What a halt stops is exactly R29's three activities** - `model_call`, `model_path_write`, `bus_publish` - and
`HALTED_ACTIVITIES` is asserted equal to that list, so a fourth cannot be added without a failing test. Each of
the three asserts **before** touching its dependency, and the test reads the dependency's own record afterwards:
no model call recorded, no second write performed, no second signal published.

**R17's other half is structural.** `produceDeterministicAlerts` has no gate, and
`deterministicAlertsPermitted()` returns `true` with no branch that could ever return otherwise.
`ACTIVITIES_A_HALT_NEVER_STOPS` names it, so gating it later would mean deleting a named guarantee. The test runs
the same producer before and under the halt and asserts the answers are equal - a halt is a spend and write guard,
never a blackout, and losing a due-date warning to one is the single worst failure this system could have.

### Behaviour 3 - the port, and the absence of one

Under `longPoll` the listener block **does not run at all**, so `listeningPorts` is empty by construction rather
than by unbinding afterwards. D6 asks for that absence to be asserted against the process's own listener set, and
the reason is worth restating: probing a socket and finding nothing is also what a crashed listener, a wrong port
and a firewall look like, so a socket probe would pass for the wrong reason. Both directions are read - the
process's own `listeningPorts` **and** the injected host's record of what it was asked to bind:

```
longPoll  ->  agent.listeningPorts == []            host.requested == []
webhook   ->  agent.listeningPorts == [PORT]        host.requested == [PORT]        length == 1
```

### No framework, and why

Steering §1 permits Fastify or Hono for this agent. **Neither was taken.** `acceptHandler.accept` is typed
**synchronous** precisely so nothing slow can precede the acknowledgement, and the listening surface is one route
whose handler performs one local transaction. A framework would contribute routing, validation and plugin
machinery this surface has no use for, in exchange for a dependency, a lockfile entry and a supply-chain surface.
`node:http` is the platform's own server, is available under the pinned runtime, and covers the whole requirement.
**`package.json` gained two scripts and zero dependencies**, so the AC16 lockfile check is untouched.

The webhook listener answers **`200` with an empty body for every outcome**, including a refusal. A refusal must
be indistinguishable from an acceptance (§5.2), and a non-2xx answer would additionally tell the provider the
delivery failed - earning a retry of a message this agent has already declined.

### The loop and the shutdown

The loop calls `liveTransport.pollOnce()`; it does not restate the ordering. R26.1's rule - the offset advances
only after the dedup-claim-plus-enqueue transaction has returned - is the adapter's and stays there. The loop is
asserted to advance the offset once per durably enqueued update, and to move past a **refused** update without
enqueuing anything (finding **F17** from task 10.5: a refusal that did not advance would wedge the poller on a
stranger's message).

Shutdown is five ordered steps, and the order is the requirement: stop accepting; close the listeners; **let the
in-flight iteration settle**; return anything still `running` to `queued`; close the store **last**. Closing the
store under a running drain would abort a transaction that was about to commit, which is the one way a clean
shutdown could lose durable work. The test leaves three rows queued and a worker that never settles its item,
shuts down, **reopens the store from disk**, and asserts all three are still there with nothing `done` and nothing
`failed`. A delivery arriving after the signal is refused with the same frozen `rejected` value every other
refusal returns, and writes nothing.

The idle wait is a real macrotask. An idle loop that only awaited microtasks would starve the timer the
termination signal arrives on, which is a property of the loop worth getting right: a poller that never yields
cannot be interrupted.

### Health, and what reaches a log

The compose healthcheck invokes `<FINANCE_HEALTH_PROBE>` as a **CMD**, not an HTTP request, which is why the
`longPoll` posture needs no port for health either. `npm run health` is that command; `readiness()` is the
in-process answer. Silence from the worker is a **failure**, not an absence of news, so a process that has drained
nothing reports `not_ready`, and one that has begun shutting down reports `not_ready` again.

Every line goes through `redactedLogger`, which takes an event and named features rather than a format string.
The test parses every emitted line and asserts it contains neither the sentinel path, nor the API base, nor the
data directory (R19, R24).

### Findings

**F18 - no module derives `TurnFacts` from a provider body, and one should not be invented here.** Every field of
`TurnFacts` is a deterministic engine's verdict or an enumerated intent; nothing in the tree turns a message into
one. So `readTurnFacts` is a **required injected dependency** of the worker, and the process supplies
`conservativeTurnFacts()`: intent `validate_schema`, every verdict false. That classifies **T0** by the
`deterministic_intent` rule, mints no grant, and therefore cannot reach the model port even if a later edit handed
it a channel. It is fail-closed and it spends nothing - the alternative, guessing a model-bearing intent from an
unparsed body, would spend the owner's cap on a guess. **Owner:** the extraction step is a later task; this is
recorded so nobody reads the T0 route as a claim that the turn pipeline is complete.

**F19 - the bot identity is an argument, not an entry.** No template, no `SERVICE_ENTRY_NAMES` row and no
`DEPLOYMENT_VALUE_LEDGER.md` row declares it, and the two ways to obtain it - reading the bot token or calling the
provider's identity endpoint - both belong to a gate. Inventing a template entry would put a value in the
environment file set that no gate supplies and no ledger row tracks, and would break the count assertion that
holds `SERVICE_ENTRY_NAMES` equal to the six templates. So it is `--bot-id`, and absent or empty it is a boot
refusal (`ENV_BOT_IDENTITY_EMPTY`), never a default: a blank half of the dedup key would let one bot's update be
dropped as a duplicate of the other's (R14).

**The live adapters stay absent, and say so.** `main.ts` wires a provider client and a model port that **refuse**
with `TELEGRAM_SEND_REFUSED` and `MODEL_PROVIDER_UNAVAILABLE`. They are present so the shape is complete and
refuse so nothing pretends a provider answered. G3/G6 supply the first; G4 supplies the second. A stand-in that
answered would be a fabricated financial answer.

### Gate result

- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because AC14 and AC15
  require a clean tree.
- Tests **1872 -> 1906** passing, and the AC04 `--min` floor ratcheted **1872 -> 1906**. Up only. Nothing lowered,
  allowlisted, skipped or exempted.
- **AC08b unchanged:** the new tier is under `src/server/**`, which the check already excludes from the browser
  bundle; no browser entry point reaches it and AC05/AC05b/AC06 still pass.
- **AC16 unchanged:** two scripts added, zero dependencies, so the toolchain pin and the lockfile are untouched.
- **One `process.env` bridge preserved:** `processEnvSource()` is still the only expression in `src/` that reads
  the ambient environment. `main.ts` calls it; nothing under it reads around it.
- **R24 holds.** Every value in every test is synthetic and derived from the entry name. No secret was invented,
  not even a plausible placeholder of the right shape.
- **No gate attempted, no checkbox ticked in `ops/GATE_REGISTER.md`**, G7 still CLOSED - WONT-DO, no outbound
  call, no process started against a live provider, and the other repository untouched.

## Task 10.10 - the per-agent cap companion, and the placeholder that could not serve two units (2026-08-10)

**Owning requirement:** R17. **Decision:** **D-CAP**, as settled in `requirements.md`'s decision note - a hard
weekly ceiling **in total**, met by **two keys at half each**. **Finding closed:** **F13**.

### What was missing, precisely

Not the isolation. `weeklySpend` already filters rows to one agent, so one agent's spend cannot reach the other's
total, and `agentBudget.ts` already takes `capMicroUsd` injected per agent. What was missing was the **companion**:
nothing in the code expressed that the injected per-agent figure is **half of a total**, nothing related the two
halves to the total, and nothing refused a cap set that over-allocated it. `WEEKLY_BUDGET_USD = 5` was the total
with no per-agent counterpart, so the relation lived only in a decision note.

`src/features/routing/agentWeeklyCaps.ts` is the counterpart.

### The total stays the total

`WEEKLY_BUDGET_USD` was **not** re-scoped, and that is a deliberate refusal rather than an omission. Contract 11's
governance thresholds - warn, restrict, disable-premium - are **fractions of that constant**. Halving it to make it
per-agent would silently convert every one of those fractions into a per-agent fraction, changing behaviour nobody
asked to change. So the total is expressed once, in the ledger's integer unit, by **deriving** it:

```
WEEKLY_CAP_TOTAL_MICRO_USD = microUsdFromUsd(WEEKLY_BUDGET_USD)
PER_AGENT_WEEKLY_CAP_MICRO_USD = perAgentCapMicroUsd(WEEKLY_CAP_TOTAL_MICRO_USD, CAPPED_AGENTS.length)
```

Derived, not restated: a second literal would be a second place to disagree. The one USD-to-micro conversion is
applied once, to a configuration value that is already a whole number of dollars, which is the boundary
`spendLedger` already sanctions for exactly this.

### Three refusals, all in the fail-closed direction

- **An inexact split is refused**, not rounded. Rounding down strands budget the owner authorised; rounding up
  hands out more than the total. A total that will not divide is a configuration to fix.
- **A cap set summing above the total is refused**, not scaled to fit. A silent adjustment would mean the figure an
  operator reads in a file is not the figure being enforced. And the total is **never raised** to accommodate the
  caps - steering forbids raising, bypassing or temporarily lifting a cap under any circumstance.
- **A cap set summing below the total is permitted** and is not a finding. Spending less than authorised is always
  allowed, and refusing it would be a rule invented here.

### R17, asserted as a differential rather than in isolation

The isolation test puts **both** agents' rows in **one** array, drives one agent past its half, and reads the
other's decision back. A test that exhausted an agent in isolation would pass even if the caps were pooled, which
is the failure R17 exists to prevent. Asserted in both directions, plus the case that matters most: one agent
spending its whole half is still refused **even though the pair is under the total**, because a cap decision is
scoped to one agent and is never aggregated (§6.2.3).

The deterministic half is a **typed field**, not a comment: `deterministicAlertsProduced: true`. A build that made
exhaustion suppress an obligation alert would not compile. The differential test runs the same deterministic
producer under an ample cap and an exhausted one and asserts the answers are equal - a cap is a spend guard, not a
service outage.

### F13 - the resolution, and why it is a naming problem rather than a unit problem

Both sides of the collision were right, which is what made it a real finding:

| Artifact | Reads | Unit | On a decimal |
|---|---|---|---|
| `loadAgentModelBinding` | `FINANCE_WEEKLY_CAP` | integer micro-USD | **refuses**, never rounds |
| `ops/GATE_REGISTER.md` G4 step 2 | `<FINANCE_WEEKLY_CAP>` | decimal USD | requires one |

A literal `2.50` typed into the environment entry is a startup refusal; the integer sent to the provider would be a
limit a million times too large. **One placeholder cannot serve two units**, so it stops being one placeholder:

```
LEDGER_WEEKLY_CAP_ENTRY[agent]        -> the entry name the loader reads, integer micro-USD
PROVIDER_KEY_LIMIT_PLACEHOLDER[agent] -> the gate placeholder the provider body takes, decimal USD text
```

The provider-facing form is **text**, deliberately. A decimal `number` in a variable named for a limit is precisely
the shape AC07 forbids, and it would invite arithmetic on it. The rendering uses integer digits only - the whole
part is the exact division, the fractional part is the remainder zero-padded to six places and trimmed to the
shortest exact form of at least two - so there is no rounding step, because every micro-USD value has an exact
six-place decimal. Reading back parses the two integer parts **separately** and combines them by integer
arithmetic, so the value never passes through a float; more precision than micro-USD can hold is **refused rather
than rounded**, which is the same rule the integer entry applies, and having one function each way is what stops
the two artifacts drifting. **No `parseFloat`, no `.toFixed(`, no decimal literal assigned to a money-named field.**

The provider-facing name is **not** an environment entry, and that is the second half of the resolution: it is
interpolated into one gate command and never stored, so adding it to `ops/env/*.env.example` would create a
seventh entry in a file set `DEPLOYMENT_VALUE_LEDGER.md` enumerates exactly, owned by no gate and tracked by no
row - and would break the assertion holding `SERVICE_ENTRY_NAMES` equal to the six templates.

### RECOMMENDATION FOR THE OWNER - the one line `ops/GATE_REGISTER.md` G4 needs

**Not applied.** The register outranks this repository's modules on gate verification and was not edited. The change
is one line in G4 step 2, replacing the ledger-facing name with the provider-facing one:

```
-     -d '{"name":"<FINANCE_KEY_NAME>","limit":<FINANCE_WEEKLY_CAP>,"limit_reset":"weekly"}'
+     -d '{"name":"<FINANCE_KEY_NAME>","limit":<FINANCE_KEY_LIMIT_USD>,"limit_reset":"weekly"}'
```

Two consequential lines follow from it if the owner takes the change: the identical line for the life key
(`<LIFE_WEEKLY_CAP>` -> `<LIFE_KEY_LIMIT_USD>`), and the verification comment `# -> limit == <FINANCE_WEEKLY_CAP>`
-> `# -> limit == <FINANCE_KEY_LIMIT_USD>`. **Step 5 is already correct and must not change**: it records
`FINANCE_WEEKLY_CAP=<FINANCE_WEEKLY_CAP>` in the environment file, which is the integer the ledger reads. With the
change, step 2's sentence "must equal the value already encoded in the offline policy module" becomes true as
written - the two names hold the same figure in their own unit, and `providerKeyLimitUsdText` is the conversion
that proves it.

### Gate result

- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because AC14 and AC15
  require a clean tree.
- Tests **1906 -> 1929** passing, and the AC04 `--min` floor ratcheted **1906 -> 1929**. Up only. Nothing lowered,
  allowlisted, skipped or exempted.
- **AC07 holds**, and the new module is the reason to say so out loud: no `parseFloat`, no `.toFixed(`, no decimal
  literal assigned to a money-named field, and the one decimal that has to exist for the provider is a **string**.
- **No cap was raised, bypassed or lifted.** Every refusal added here refuses; none of them permits.
- **`ops/GATE_REGISTER.md` untouched**, no checkbox ticked, G7 still CLOSED - WONT-DO, no outbound call, and the
  other repository untouched.

## Task 10.8 - the images this repository owns, and the port nobody was binding (2026-08-10)

**Spec:** `.kiro/specs/06-two-agent-vps/` phase 10, task 10.8. **Owning requirements:** R28 (a Dockerfile
for every image this repository owns, and a documented build path producing the exact tag the topology
references), R30 (the firewall posture and the port bindings agree, and the certificate-challenge
resolution is recorded). **Findings addressed:** **O1** (six image references, zero recipes) and **F12**
(the certificate-challenge port). **Contract 12** §2.1, §2.2.1, §7.3, §10.1.

### What was actually missing, stated without hedging

`ops/docker-compose.yml` names six image references. The tree held zero build recipes. So after every one
of the gates G1 through G8 clears, `docker compose up` still could not run, because nothing in either
repository produced the six artifacts the topology names. That is O1, and it is a build gap rather than a
human gate, which is why it was never in the register.

Separately, two individually true statements were together insufficient. The topology publishes exactly one
host port. The register's G1 correction advised opening a second one for a cleartext certificate challenge.
Opening a port in the firewall reaches nothing if the topology never binds it, so the challenge would have
failed **while the firewall looked correct** - the artifact an operator checks to diagnose it is the one
that is right. That is F12.

### R28's answer is a record, not six recipes

Writing six recipes would have been the wrong shape and a worse defect than the absence: an image that
builds and then fails at its first real step is harder to diagnose than one that was never there. Four of
the six are not this repository's to write, or are not writable yet. So `ops/IMAGE_BUILD.md` accounts for
**every** reference in exactly one of three states, and `src/server/ops/imageOwnership.ts` checks the
record rather than trusting it.

| Reference | State | Why |
|---|---|---|
| `<FINANCE_IMAGE_REF>` | `BUILT_HERE` | This repository is the finance agent (steering §1); task 10.7 built the process it runs. |
| `<LIFE_IMAGE_REF>` | `EXTERNAL` | Python, in the other repository, downstream of the three unapplied change specifications. Steering §6 forbids this session from touching it, and it could not build a correct one if it were permitted to try. |
| `<PROXY_IMAGE_REF>` | `EXTERNAL` | An upstream release, configured entirely by the file the topology mounts read-only. A wrapper recipe would add a build step, a supply-chain surface and a second place the version is pinned, for nothing. |
| `<BUS_IMAGE_REF>` | `OWNED_BUILD_PENDING` | The envelope schema, the validation, the consent gate and the signal store are all here. What does not exist is a bus **server process**, so there is no entry point for a recipe to name. Blocked by **O2**. |
| `<SCHEDULER_IMAGE_REF>` | `OWNED_BUILD_PENDING` | Same shape, same reason. Its recipe is absent because its process is, not because it is hard. Blocked by **O2**. |
| `<BACKUP_IMAGE_REF>` | `OWNED_BUILD_PENDING` | `ops/backup/backup.sh` fixes the tool set exactly, but its fourth step calls an uploader that does not exist - the live storage adapter is gated on G5. An image whose entrypoint fails at step four **after** writing a plaintext snapshot is a new failure mode, not a partial backup. Blocked by **task 10.9**. |

**`OWNED_BUILD_PENDING` is a state R28 did not anticipate**, and it is recorded rather than avoided. R28's
ownership axis is binary - the repository owns an image or it does not - and three references sit in
neither box, being owned here in library form with no process to package. Calling them `EXTERNAL` would
hand them to a repository that does not hold their code; calling them `BUILT_HERE` would need an entry
point nobody has written. The third state is the honest shape, and the audit makes it strictly stronger
than silence, because a row in it **must** name the task or finding that closes it.

### The recipe, and the four properties that are checked rather than described

`ops/images/finance-agent/Dockerfile` is two stages: production dependencies resolved from the lockfile
(`npm ci --omit=dev --ignore-scripts`, so no install hook runs during the build), then the runtime. There
is no compile step, because the pinned runtime strips types natively - and that is deliberate rather than
lazy, since a build step would produce a second copy of the money core and steering §1 permits exactly one.

1. **The base is pinned to the `.nvmrc` major.** Both stages name it, the audit reads `.nvmrc` and reports
   a finding if they disagree. A major and not a patch: a patch this repository invented would be a version
   nobody verified exists, and the immutable identity of the bytes is the digest, which belongs in the
   operator's own build receipt.
2. **It ends unprivileged.** The last directive names the unprivileged account the base image provides.
   Everything needing root - installing the entry points, preparing the store directory with the right
   ownership so an empty named volume inherits it - happens before that line, and nothing after it needs
   root. The alternative, an entrypoint that starts as root and drops privilege, reintroduces the root the
   directive exists to remove.
3. **No secret and no deployment particular.** No `ENV`, no `ARG` carrying a value, no endpoint, no default
   for anything the environment supplies. A default would turn R27's refused boot into a guessed one. The
   audit distinguishes `ARG NAME` (an input the builder supplies, leaving nothing in the image) from
   `ARG NAME=value` (a default), and refuses only the second.
4. **The healthcheck command exists inside it.** Two commands, because two callers ask different questions:
   `nizam-finance-health` takes no arguments and derives the store from the service's own environment,
   which is why the topology's healthcheck is a single-element `CMD` needing no port; and
   `nizam-health-probe --store … --throwaway`, the grammar the restore drill invokes. That second name is
   **not invented in the recipe** - `healthProbe.ts` exports it as `PROBE_COMMAND_NAME`, the drill quotes
   it, and the audit fails if the recipe does not install it. `src/server/process/probe.ts` is the one
   statement that turns the probe's answer into an exit status, the same split as `start.ts` and for the
   same reason: a module that ends the process cannot be tested.

Three things are **deliberately absent** and each is a finding if it appears: no `EXPOSE` (phase 1 binds
nothing, and in webhook mode the proxy reaches the container over the agent's own network), no
`HEALTHCHECK` (the topology declares one per service with its interval, timeout, retries and grace period,
and two policies drift), and no development dependency.

### The build context, and why `.gitignore` was not enough

A build context is a copy of the directory handed to the builder, and **the builder does not read
`.gitignore`**. So a broad `COPY` could place a private key inside a layer that is then tagged, pushed and
unreadable-once-shipped. The root `.dockerignore` excludes the untracked secret material, the local
environment files, key-shaped files by pattern, the version-control directory and the browser bundle -
first block first, by name and by directory, so a future widening of a `COPY` cannot pick one up.

### The build path: one value resolved once

The property is not "a convention that the build tag and the topology's `image:` entry should match".
There is nothing to match, because there is only one string: the operator resolves the reference once, in
the untracked file that already holds every other particular, and both the build invocation and the
topology receive that same value. `ops/IMAGE_BUILD.md` documents the invocation from the repository root
with the recipe named explicitly. The tag is derived from something that cannot be reused - a moving tag
turns `ops/runbook/ROLLBACK.md`'s revert-to-the-previous-tag into a coin flip - and the digest is recorded
in the operator's build receipt, never here, because a digest is a particular in the same sense a tag is.
The audit's `BUILD_PATH_UNDOCUMENTED` requires the recipe and the reference **on one invocation**, matched
on the two flags rather than on proximity; the first draft matched any line holding both and was silently
satisfied by the record's own table row, which is exactly the shape of check that passes without checking.

### THE F12 DECISION: TLS-ALPN-01 on `<TLS_PORT>` alone

**Chosen.** R30 set out two admissible resolutions and deliberately did not pick; design delta D5 said the
same and named this task as the one that decides. The criterion is the owner's: **speed**.

- The rejected alternative - publishing the cleartext port as a second port on the proxy service - costs
  four edits that must land together: a second `ports:` entry, removal of the challenge-disabling directive
  from **both** sites in `ops/Caddyfile`, a widened firewall allowance, and a relaxation of the assertion
  that exactly one host port is published. Each is small; together they widen the public surface of the
  deployment from one port to two, permanently, for a challenge that is not needed.
- The chosen resolution costs **one** edit, because every other artifact was already in this posture and
  nothing had noticed: the topology publishes one host port, and `ops/Caddyfile` already disables the
  cleartext challenge on both sites and turns off the redirect hosts that would stand up on that port. The
  option that requires no artifact to move is the fast one, and here it is also the narrower one - unusual
  enough to be worth saying rather than assuming.

**`ops/GATE_REGISTER.md` WAS edited, and this is the deliberate difference from task 10.10.** R30 does not
merely permit the record, it requires it: "the resolution chosen for the certificate-challenge port SHALL
be **recorded** in `ops/GATE_REGISTER.md` rather than left to be inferred from either artifact alone", and
R30's finding note says option 2 "makes the firewall advice wrong as written and obliges the correction".
So one paragraph inside G1 changed: the observation advising a second firewall port is replaced by the
recorded resolution, stating that step 4 is correct as written and no cleartext challenge port is required.
**Nothing else in that file moved** - no gate renumbered, removed, reopened or restated, no verification
line softened, no `Status:` changed, no checkbox ticked, G7 still CLOSED - WONT-DO.

**The assertion is neutral about the choice.** `auditPortPosture` reads which challenge the register names
and then requires the ports the topology binds and the directive the proxy configuration carries to match
**that** choice. Naming neither is a finding; naming both is a different finding, because a document naming
both records a discussion rather than a decision. A test drives the **rejected** resolution through the
same checker, coherently (it passes) and incoherently (it fires four codes), because a cross-artifact check
that only holds for the choice its author made is not a check about agreement. The module also compares the
firewall allowance the register records against the host ports the topology publishes, excluding
`<ADMIN_PORT>` by name - it admits the operator's own session, which no container serves - and that
comparison is R30's literal assertion in both directions.

### The phase-1 posture, which task 10.0 found and which belonged here

`ops/docker-compose.yml` had **zero** `profiles` keys, so "the `caddy` service stays down in phase 1" was
an operator convention that no file asserted: a bare `docker compose up` brought it up and bound
`<TLS_PORT>`, which is exactly what phase 1 forbids, and which R26's trap note names as the compensating
control for the mode-scoped guard. `caddy` - the only service with a `ports:` key - now carries a
`profiles:` entry, so it does not start unless that profile is named explicitly. `composeTemplate.ts`
asserts **both** directions, because they fail differently: a port-publishing service that is not gated
publishes in phase 1, and a service phase 1 needs that **is** gated silently does not start, which presents
as a deployment that came up clean and answers nothing. A profile was chosen over a second compose file
because an override file is another artifact to keep in step, and over a comment because a comment is what
this replaced.

### What the previous pass had already done, and what was kept

The uncommitted tree held the compose `profiles:` key and its `composeTemplate.ts` assertions, the
`.dockerignore`, `ops/IMAGE_BUILD.md`, the recipe, and `src/server/process/probe.ts`. All of it was kept.
Three things were wrong and were fixed rather than rewritten: the record and two comments cited a design
delta **D7** that does not exist (the design's Phase 10 delta ends at D6), so the citations were repointed
at the register and at the record itself; the record claimed `src/server/ops/imageOwnership.ts` audits it
on every test run and that module did not exist, so it was written; and the new `ops/` text left **AC18**
red with sixteen findings, all undeclared dotted tokens plus two file names the shared scan read as
hostnames, so nine tokens were added to `DECLARED_DOTTED_TOKENS` in `deploymentParticulars.ts` - which is
the list that keeps that scan honest in both directions, since a declared token absent from the tree is
itself a finding. The previous pass's stated reason for not editing the register - "a session may not edit
that file" - is right as a default and wrong for this task specifically, because R30 names that file as
where the resolution is recorded.

### Findings recorded rather than resolved

- **O1 is closed on the image half only for the one image this repository owns.** Three references remain
  `OWNED_BUILD_PENDING`. That is not a partial pass being reported as a full one: it is the state the audit
  requires each of them to declare, with a named blocker, so the gap has an owner instead of a hope.
- **A recipe cannot be verified without building it, and building is gated (steering §2).** Everything
  asserted here is a property of the recipe's **text**: the base's major, the final `USER`, the command
  names installed, the absence of a port, a healthcheck and a default. Whether the image runs is observed
  after G1, on the host, by the operator. Nothing here claims otherwise.
- **`<PROXY_HEALTH_PROBE>` must resolve to a command the upstream release already ships**, since this
  repository guarantees nothing about the inside of an `EXTERNAL` image. Recorded in `ops/IMAGE_BUILD.md`
  because it is the kind of assumption discovered at first start, in the one place where nothing else is
  working either.

### Gate result

- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because AC14
  and AC15 require a clean tree.
- Tests **1929 -> 1982** passing across 110 files, and the AC04 `--min` floor ratcheted **1929 -> 1982**.
  Up only. Nothing lowered, allowlisted, skipped or exempted. The `tasks.md` Gate note claiming a floor of
  1757 was corrected to 1982 with the full transition list; its "up only, never down" claim was true
  throughout, and only the number it made the claim about was stale.
- **AC18 passes** over 23 `ops/**` and fixture artifacts. No placeholder was resolved, no port literal
  written, and the register's edit removed a numeric port rather than adding one.
- **No image was built, no tag resolved, no registry contacted, no outbound call made, no host port
  published, no `setWebhook`, no DNS record, no `docker compose up`.** This task authored text and code.
- **The other repository was not touched.** G7 still CLOSED - WONT-DO.

---

## 2026-08-10 - spec 06 task 10.11: the owner's gate walkthrough (§8 step 7)

**Contract:** PFOS 12 - Two-Agent VPS Deployment & Operations, §9 (the human gate register).
**Spec:** `.kiro/specs/06-two-agent-vps/` task **10.11**. **Authority:** `KIRO_SHIP_LIVE.prompt.md`
§8 step 7 - "tell the owner exactly which gate steps to perform, with the command for each".
**Deliverable:** `.kiro/specs/06-two-agent-vps/OWNER_GATE_ACTIONS.md`. **An instruction sheet, never
an attempt.**

### What it is, and what it deliberately is not

It is the **ordered gate walkthrough**, written for a human at a terminal rather than for a reader.
`OWNER_FILL_IN_SHEET.md` (task 10.3) is the **value reference** - 62 entry-to-file assignments, each
with its gate, its `secret` flag and its proof command. Both are named in the new document's first
lines with which is which, so the owner never has to work out which to open. Nothing from 10.3 is
duplicated; the walkthrough points at it wherever a step needs values.

`ops/GATE_REGISTER.md` outranks both and the new document says so. Every verification block in it is
**copied from the register**, not reinvented, and each is followed by the reminder that the observation
is what gets recorded and never the value (R24).

### The order, and why it is the order

**G1 -> G3 (placement) -> G4 -> G5 -> G8.** The register's ordering is a dependency ordering: G3, G4,
G5 and G8 each end by writing a secret into `/etc/<CONFIG_DIR>`, which only G1 creates, so working G4
first produces a production secret with nowhere to live. **G3 is the placement half only** - both bots
already exist and were verified live by read-only probes, so creation is finished and the walkthrough
says which half is which rather than restating steps the owner has already worked.

### F13 carried where a wrong number would boot successfully

G4's section leads with a two-row unit table before any command, because the same D-CAP figure is
written two ways: `<FINANCE_KEY_LIMIT_USD>` is **decimal USD text** in the provider's key-creation
body, and `FINANCE_WEEKLY_CAP` is **integer micro-USD** in the environment entry, where a decimal is
refused rather than rounded. A literal `2.50` in the entry is a startup refusal; the integer form sent
to the provider is a limit a million times too large. The register's G4 step 2 still interpolates
`<FINANCE_WEEKLY_CAP>` into the provider body, so the walkthrough flags that as the one place the owner
supplies the decimal reading - the register outranks `src/features/routing/agentWeeklyCaps.ts` on gate
verification, which is why task 10.10 left it as a recommendation and this task did not take it either.

**D-G5** is stated as the highest-value sentence in G5's section: a Testing screen issues a seven-day
refresh token and the unattended uploader dies **silently** on day eight. **D-ROTATE** is in the ground
rules with its compensating control - `getWebhookInfo` on every run - and there is no rotation step
anywhere in the document.

### Deferred work is named so the owner does not go looking for it

**G2 and G6 are DEFERRED**, with the reason rather than the label: phase 1 ships on
`TELEGRAM_MODE=longPoll`, which is outbound only - no domain, no DNS record, no certificate, no public
port, no proxy - and G2 is additionally blocked on a domain that does not exist, the account holding
zero zones as measured. `setWebhook` is named as a thing not to run. Deferred is not cancelled: both
keep their gate numbers and every verification line, and phase 2 is a configuration change because the
guards are identical either way. **G7 is CLOSED - WONT-DO** and is listed only so a reader who finds
G1-G6 and G8 does not conclude it was lost.

### The stack section, and the ceiling it reports honestly

The `<FINANCE_IMAGE_REF>` build is quoted from `ops/IMAGE_BUILD.md` with the immutable-tag rule and the
digest-in-the-operator-file rule, because `ops/runbook/ROLLBACK.md` reverts by naming a previous tag. The
bare `docker compose up` is given as the whole of "keep the proxy down", since `caddy` carries
`profiles: [phase2]` and is the only service with a `ports:` key. L0 and L1 are runnable now; L4 needs
L2/L3 plus G4; L5 waits on task 10.9 and then G5 step 4 and G8 step 6.

### Findings recorded rather than invented

- **G1 step 5 has no verification line.** Intrusion blocking and unattended security updates are a step;
  the VERIFICATION block covers every other G1 step and not that one. Not patched here - the command
  differs by distribution, and guessing one produces a line that passes on the wrong machine.
- **G4 step 3's verification is a console observation, not a runnable command.** The register names no
  provider endpoint reporting the account-level training posture. Acceptable as written; recorded so it
  is not later mistaken for something a script covers.
- **G5 step 1 has no command in this repository.** No consent-flow script is tracked, and writing one was
  not this task. The flow is the provider's own documented installed-app flow, run from the laptop.
- **The walkthrough cannot close end to end in one sitting**, and this is the answer to the question the
  task asked. `BACKUP_FOLDER_REF` is created by the uploader on first run (D-G5), the uploader does not
  exist - `<BACKUP_IMAGE_REF>` is `OWNED_BUILD_PENDING` on task 10.9 - so G5's folder line and G8's
  restore drill both wait. Beyond that: with **every** gate observed, `docker compose up` still cannot
  stand the stack up, because `<BUS_IMAGE_REF>` and `<SCHEDULER_IMAGE_REF>` are `OWNED_BUILD_PENDING`
  (finding **O2**) and `finance-agent` declares `depends_on: signalbus: condition: service_healthy`. So
  **L2 and L3 are blocked on build work in this repository, not on the owner**, and the document says
  that in the same table that lists the rungs.

### Gate result

- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because AC14
  and AC15 require a clean tree.
- **No test added and no floor moved**; the deliverable is a document. The AC04 `--min` floor stays at
  **1982**. Up only, and nothing lowered, allowlisted, skipped or exempted.
- **`ops/GATE_REGISTER.md` was NOT edited.** No gate renumbered, removed, softened or reopened, no
  `Status:` moved, no verification line changed, and **no checkbox ticked** anywhere except `10.11`'s own
  line in `tasks.md` - not in the register, and not in the "Waiting on user input" list.
- **No gate step was performed.** No host provisioned or hardened, no secret placed, no key minted, no
  keypair generated, no consent screen clicked, no image built, no stack started, no `setWebhook`, no DNS
  record, no outbound network call. **The other repository was not touched.** G7 still CLOSED - WONT-DO.
- Every value in the new document is an `<ANGLE_BRACKET>` placeholder and none resolves to anything real.
  It lives under `.kiro/specs/`, outside AC18's `ops/**` scan roots, and was held to the same standard
  regardless.

## Task 10.19 - the signal-bus process, the one thing between a gated host and a bot that answers (2026-08-10)

**Spec:** `.kiro/specs/06-two-agent-vps/` task 10.19. **Contract:** PFOS 12 §2.1, §2.2.5, §2.2.6, §4.1, §4.5,
§7.3. **Requirements:** **R34** (authored by this task), R9, R7, R8, R10, R22, R27, R28, R24.
**Finding closed:** **O2**, for one of its two services.

### The defect, stated without hedging

Task 10.11 established the ceiling: with every one of the gates G1 through G8 observed and every environment
file filled in, `docker compose up` still could not stand the phase-1 stack up. This task is that reason.
`ops/docker-compose.yml` gives `finance-agent` and `life-agent` a `depends_on: signalbus: condition:
service_healthy`, and `<BUS_IMAGE_REF>` built nothing. The bus's *library* was complete and tested - the
envelope schema, its validator, the consent gate, the append-only store and its audit mirror - and **no process
listened** on the endpoint the two agents dial. That is build work in this repository, not a gate, which is why
O2 was recorded as a build-side finding and never added to the register.

### What was written, and what was only exposed

**`src/server/process/busServer.ts`** - the process. **`src/server/process/busMain.ts`** - the only file in the
bus tier that names a platform facility, and it names five: the HTTP server, the filesystem the liveness record
lives on, the error stream, a source of surrogate identifiers, and the termination signals.
**`src/server/process/busStart.ts`** - one statement wide, so `busMain.ts` can be imported without being run.
The same three-file split, for the same reasons, as `financeAgent.ts` / `main.ts` / `start.ts`.

**Nothing in the signals tier was reimplemented, and that was the point of reading before writing.** The write
path is `appendSignal`, which validates through Phase 3.1's `validateForWrite` and audits the refusal without
retaining the value. The read path is `readSignals` - which re-runs every field rule and re-checks the digest
before a row is served - followed by Phase 3.2's `serveToSubscriber`, which re-validates again, re-derives the
de-identification claims over the value about to cross, and applies the tier and scope gates independently. No
field rule, note cap, enum, integrity digest or scope decision is written in the process. The environment
refusal is the existing `requireServiceEnvironment` over `SERVICE_ENTRY_NAMES.bus`; no second entry table was
added. The readiness answer is the existing `probeReadiness`, given the **signals** migration series' expected
version rather than the finance one.

**No server framework was added**, for the reason 10.7 gave and which holds more strongly here: the accept
surface is two routes whose handler is synchronous and performs one local transaction, so `node:http` covers it
and a dependency would buy a supply-chain surface on the one service where both agents' state meets.

### The four properties a process has that a module cannot

1. **It refuses to boot on an incomplete environment, and the refusal is not caught.** All three bus entries
   named in one message, so one restart answers the whole question. Asserted with two entries removed at once,
   with an unfilled `<ANGLE_BRACKET>` placeholder, with an empty value, and through the run wrapper for the
   non-zero exit - and asserted to refuse **before** it binds anything, so a refused bus holds no listener.
2. **It binds the internal endpoint and only that one (R9).** The listening boundary it is handed takes a
   **port**: no host argument, no publish flag. Readiness is an exec check, so there is no second route to add.
3. **It answers readiness without a listener (R22).** The orchestrator's check is an exec probe, so the answer
   has to survive a process boundary, and the only thing the health command and the server share is the volume.
   The server records that its listener is up in a **content-free** file beside the store; the command reads how
   old that record is. An absent record and a stale one both read as not ready - silence is not health - and
   shutdown removes the record so a stopped bus reports not-ready at once rather than after the window.
4. **It refuses an endpoint that would be reachable anywhere else.** This is the one guard the task added rather
   than reused, and it is the process's whole contribution to R9: a scheme, a path, an address literal, a
   wildcard, a name resolving to the container itself, and an out-of-range port are each refused at boot. All
   **eight** declared refusals are exercised, and a test asserts the vocabulary carries no unexercised member.

### How the internal-only binding is asserted (delta D6, applied a second time)

Not by probing a socket: a socket that answers nothing is also what a crashed listener, a wrong port and a
firewall look like, so it would pass for the wrong reason. Three assertions, in both directions:

- the process's own `listeningPorts` holds exactly the configured port, and still holds exactly that after
  publish traffic, read traffic, a readiness call and a liveness tick;
- the injected listener host's own **bind record** holds exactly one request, for that port, and is empty on
  every refused boot;
- the real `ops/docker-compose.yml`, read through the existing compose parser, gives `signalbus` **no `ports:`
  key** and exactly the one internal network - so no bind the process makes can reach the host.

### Where the halt is, and why it is not here

The task brief expected a halt gate in the bus. The artifacts had already settled it the other way, and the
decision is sound rather than an oversight: contract 12 §8.2 names the two agents, the scheduler and the backup
service; `ops/docker-compose.yml` mounts the sentinel volume into exactly those four; and
`ops/env/bus.env.example` records the absence with its reason - *a publish is halted at the publisher, before
the envelope is built, so halting the store as well would add a second place for the halt to be wrong without
closing anything the first place leaves open*. Adding a sentinel entry here would also mean a halt this service
examines and the operator's mount never creates, which `collectKillSentinelFindings` correctly calls a kill
switch that silently does nothing. So the halt is **observed where it lives**: a test boots the real finance
agent against the real bus process and shows `publishSignal` refusing with `HaltEngagedError` while the
append-only store holds no row and its audit mirror holds no line - with the released-halt case beside it
storing the same envelope, so the refusal is not vacuous.

### Negative tests, every one shown failing the guarded operation

Not merely returning a refusal shape: after each refusal the store's row count **and** its audit mirror are
read, so a rule that returned the right word and wrote the row anyway would fail.

- a payload carrying a **figure** - refused `field_numeric`, nothing stored, `refused_on_write` audited, and the
  answer asserted to contain no field the value could have travelled in;
- a **due date** - `field_temporal`; an **account identifier** - `field_identifier`; a surplus field **beside**
  the payload - `field_temporal`, because a date next to the payload leaks as well as one inside it;
- **over-length text** - `note_exceeds_cap`, and the point is that it is refused rather than truncated: nothing
  is stored, so no first-120-characters copy exists anywhere;
- a note carrying a digit - `note_carries_a_figure`; a producer asserting its own digest -
  `hash_asserted_by_producer`;
- the **excluded classification** - `tier_not_a_member`, refused as an unknown member rather than filtered
  later, and spelled from fragments the way every other refusal test spells it;
- a repeated signal identifier - refused, and the originally stored envelope shown **unchanged**;
- **`producer_only` read by the other agent** - refused with `consent_scope_producer_only`, and asserted to be a
  refusal rather than an empty delivery (the answer carries no `signals` field at all), with the producer's own
  read as the positive control;
- a kind the producer marked `shared` - still refused, because the widened-kinds allowlist ships **empty** and
  the effective scope is the narrower of the two;
- an incomplete environment, an endpoint that would be reachable elsewhere, an absent and a stale liveness
  record, a wrong method, an unknown route, an over-bound body, a non-JSON body, and every malformed query
  field.

### The image, and the record

`ops/images/signal-bus/Dockerfile`: pinned to the runtime major `.nvmrc` names in both stages, ending on an
unprivileged `USER`, installing `nizam-health-probe` (the restore drill's grammar) and `nizam-bus-health` (the
no-argument command `<BUS_HEALTH_PROBE>` resolves to), with no `EXPOSE`, no `HEALTHCHECK`, no `ENV`/`ARG` default
and an `ENTRYPOINT`. `ops/IMAGE_BUILD.md`'s row moved from `OWNED_BUILD_PENDING` to `BUILT_HERE` with its recipe
path and **no blocker**, and the build path gained a second invocation naming `--file` and `--tag` on one
statement. `src/server/ops/imageOwnership.ts` audits the row shape in both directions and needed **no change** -
the record and the tree agree, which is what that audit exists to establish. Its test's per-state sets and one
mutation anchor moved to the scheduler row, which is the only row still in that state alongside the backup.
`ops/BUS_NETWORK_BINDING.md` gained the process half of R9, which it could not name in Phase 3.3 because no
process existed.

### Findings, reported rather than papered over

- **`nizam-finance-health` can never report ready, so `finance-agent`'s own healthcheck cannot pass.**
  `main.ts`'s `runHealthCommand` calls `runProbe(['--store', …])` with **no** probe environment, so
  `queueWorkerAlive` is absent, and `probeReadiness` correctly treats absence as `queue_worker_not_reporting` in
  `service` mode. The command therefore always exits 1. It has no test. Consequence: `caddy` and `scheduler`
  both declare `depends_on: finance-agent: condition: service_healthy`, so **the stack still cannot come up** -
  the blocker has moved from the bus to the finance agent's health command. This is task 10.7/10.8's artifact and
  was left unchanged rather than fixed inside this task; the bus does **not** repeat the defect, and its
  liveness-record mechanism is the shape that would fix the finance side.
- **The bus authenticates nothing, by design, and the subscriber is self-declared.** §2.2.6 requires refusal at
  the network layer rather than an authentication check on a reachable port, and `ops/env/bus.env.example` gives
  this service no credential of any kind. So the `subscriber` a read declares and the `producer` a publish
  declares are claims, and the compensating control is that exactly two containers can address the port. That is
  consistent with the envelope schema, where `producer` has always been a field rather than a proof - written
  down in the process and in `ops/BUS_NETWORK_BINDING.md` so a later reader does not "fix" it by putting a
  credential in the one service where holding one would be worst.
- **The bus's busy timeout is a constant, not an entry.** `ops/env/bus.env.example` declares exactly three
  entries and states why it is short; a lock wait is a per-process capacity choice, which is why
  `STORE_BUSY_TIMEOUT_MS` belongs to the two agents. A fourth bus entry would need a row in the fill-in sheet,
  the value ledger and the template audit to configure something no operator has an opinion about.
- **The bus emits no application log line.** `redactedLogger.ts` binds a line to a `SpendAgent`, and the bus is
  not one; widening that type would widen the identity per-agent cap isolation depends on (R17). It costs
  nothing: `signal_audit` is append-only and records every accept and every refusal with its reason, its path
  and its failure code, which is a stronger record than a line could carry.

### Gate result

- `npm run typecheck`, `npm run lint`, `npm run test` green throughout.
- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because AC14 and
  AC15 require a clean tree.
- **49 tests added; the AC04 `--min` floor raised 1982 -> 2031.** Up only, and nothing lowered, allowlisted,
  skipped or exempted.
- `src/server/signals/exclusion.test.ts`'s refusal-test allowlist gained the new test file, in both directions,
  because the bus process is now a place where an attempt to introduce the excluded classification is refused.
- **`ops/GATE_REGISTER.md` was NOT edited.** No gate renumbered, removed, softened or reopened, no `Status:`
  moved, no verification line changed, and **no checkbox ticked** anywhere except `10.19`'s own line in
  `tasks.md`.
- **Nothing was run that steering §2 gates.** No image built, no tag resolved, no registry contacted, no stack
  started, no port published, no outbound network call, and the other repository was not touched. Writing a
  recipe is permitted; running one is not.
- Every value in every new artifact is an `<ANGLE_BRACKET>` placeholder or a synthetic value derived from an
  entry name. AC18's tree scan gained two declared file-name tokens and no host, address, identifier or figure.

---

## Task 10.21 - the readiness command that could never say yes, and the liveness rule now kept in one place (2026-08-10)

**Spec:** `.kiro/specs/06-two-agent-vps/` task 10.21. **Contract:** PFOS 12 §7.3 (a service reports ACTUAL
readiness, and the orchestrator restarts what reports unhealthy). **Owning requirements:** R22, R9, R24, R29.
**Found by:** task 10.19, which recorded it as the reason the stack still could not come up after the bus gained
a process.

### The defect, stated plainly

`src/server/process/main.ts`'s `runHealthCommand` called `runProbe(['--store', <path>])` and passed **no probe
environment**. In `service` mode that leaves `queueWorkerAlive` absent; `probeReadiness` treats absence as
`queue_worker_not_reporting`, because a probe that reads silence as health is the liveness answer §7.3 forbids
wearing a readiness label. So the command **always exited 1** - for every store, on every host, however healthy
the agent was. `ops/docker-compose.yml` gives both `caddy` and `scheduler` a
`depends_on: finance-agent: condition: service_healthy`, so this one line held the whole phase-1 stack at
unhealthy for ever. It was the top blocker to rung **L2**, and therefore to the owner's stated goal of
conversing with the bot. It carried **no test**, which is how it survived tasks 10.7 and 10.8.

### The fix reuses task 10.19's mechanism rather than inventing a second one

The health command is a **different process** from the server and shares nothing with it but the container, so
the fourth of §7.3's four facts has to survive a process boundary. Task 10.19 worked that out for the bus: the
server records that it is alive in a content-free file, shutdown removes the record, and the command reads how
old the record is. The instruction was to reuse that shape and, if it could be shared, to share it - because two
copies of a liveness rule is exactly the "second place for it to be wrong" this repository keeps refusing.

**It is shared.** `src/server/process/liveness.ts` is new and holds the rule once:

- `LivenessRecord` - three operations and no fourth: `touch`, `clear`, `ageMs`. There is no argument through
  which a value could be passed, so the record cannot carry one (R24).
- `livenessIsFresh(ageMs, maxAgeMs)` - the whole rule, and every ambiguity answers false: absent, non-finite,
  **negative** (a record dated in the future, i.e. a clock that moved backwards), and over the window. It takes
  `maxAgeMs` as a required argument and has **no default**, so no service inherits another's window silently.
- `LIVENESS_TOUCH_INTERVAL_MS` - the shared interval for a service with nothing else to do. A service with a
  loop touches the record as part of that loop instead, which is better evidence: the loop turned.
- `createFileLivenessRecord(dir, fileName, nowMs)` - the file-backed record, resolved through `db/paths`'s ONE
  containment guard, **lazily**. Resolution had to move inside each operation: `main.ts` and `busMain.ts` both
  assemble dependencies before `requireServiceEnvironment` has refused an incomplete environment, so resolving
  eagerly would replace an aggregate naming every unfilled entry with a path error naming one (R27).

`busServer.ts` keeps `BusHeartbeat` and `heartbeatIsFresh` as its own names **over that rule** - the type is now
an alias and the function delegates - and `busMain.ts`'s `createFileHeartbeat` is one line supplying the bus's
own file name. No bus behaviour changed, and `busServer.test.ts` passed unmodified, which is the observation
that makes "shared, not rewritten" mechanical rather than asserted.

Each service supplies only what is legitimately its own: its **file name**, because the record sits beside what
that service already has, and its **staleness window**, because a window is a statement about that service's own
loop. The finance window is deliberately wider - `FINANCE_LIVENESS_MAX_AGE_MS` at 120s against the bus's 30s -
and the reason is the loop rather than a preference: one iteration performs a **long-poll read** before it
drains the queue, so a bus-sized window would report a working agent wedged on every quiet minute, and an
operator who saw that would learn to ignore the check, which is worse than not having it. A test asserts it
clears `POLL_POLICY.timeoutSeconds`, and it still sits far below the 30s interval times three retries the
topology gives this healthcheck, so a genuinely wedged loop is observed rather than tolerated.

### What the agent now writes, and when

`financeAgent.ts` takes an optional `liveness` record and touches it in three places: **at boot**, after the
store is open and the mode's listener (if any) is bound, so the exec check is answerable during the
orchestrator's start-up grace period rather than only after a poll; **at the top of every iteration**, so a
30-second read is bracketed by two touches rather than followed by one; and **inside every drain**. Shutdown
**clears** it, reported as `livenessCleared` on the shutdown report, so a stopped agent answers not-ready at
once instead of after the window - a stopped agent that still looked alive would hold `caddy` and `scheduler`
at `service_healthy` against a service that has gone.

A touch that fails is swallowed, and that is not a shrug: an absent record is not fresh, so an unwritable volume
becomes a **not-ready answer** rather than a crash in the middle of a queue drain, which would be a strictly
worse answer to the same fact and would lose the drain as well.

The dependency is optional and its absence opens no door in either direction. The health command reads the
record unconditionally, so a deployment whose server never wrote one answers not ready - which is the
fail-closed direction, and is exactly what the defect looked like. The in-process `readiness()` was also
tightened to consult the same record, so it can never be more generous than the exec check that gates the stack.

### Asserted, in both directions

Two new test files, 27 tests, no mock of the thing under test - the record is a real file on a temporary
directory and the store is a real migrated store:

- **ready, exit 0** for a running agent once its loop has turned, including through `runHealthCommand` itself
  reading its ambient environment - the exact call `nizam-finance-health` makes, which was 1 before this task.
- **not ready, exit 1** for: a **stopped** agent (and the record file is asserted gone); a **stale** record, with
  the boundary asserted ready and one millisecond past it not; a record **never written** (silence is not
  health, with the three store facts asserted passing so the only missing fact is the loop); a record dated in
  the **future**; and **unconfigured** entries, which answer `probe_invocation_invalid` rather than throwing,
  because a probe that threw would hand the orchestrator a non-answer at the one moment it needs a verdict.
- **the record holds no content** - read back as the empty string, and its size asserted zero (R24).
- **R9 in both directions, either side of a ready answer.** Under `longPoll` the process's own `listeningPorts`
  is empty AND the injected listener host's bind record is empty; under `webhook` both hold exactly the
  configured port and nothing else. Readiness adds no second listener because it is a command, not an endpoint.
- **the containment guard shown refusing the guarded operation**: a record name that escapes the data directory
  and a directory that is not mounted both make `touch` and `clear` throw, and `ageMs` answer null.

### Gate result

- `npm run typecheck`, `npm run lint`, `npm run test` green throughout.
- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because AC14 and
  AC15 require a clean tree.
- **27 tests added; the AC04 `--min` floor raised 2031 -> 2058.** Up only, and nothing lowered, allowlisted,
  skipped or exempted.
- **`ops/GATE_REGISTER.md` was NOT edited**, no gate touched, and no checkbox ticked anywhere except `10.21`'s
  own line in `tasks.md`. No file under `ops/` changed at all: the defect was in `src/`, and the topology's
  healthcheck declaration was already correct - what it resolved to was not.
- **Nothing was run that steering §2 gates.** No image built, no tag resolved, no registry contacted, no stack
  started, no port published, no outbound network call, and the other repository was not touched.
- No host, address, port literal, identifier, token or figure was written. The two new file-name tokens are
  synthetic and derived from the service name.

### Open item this task did not close

The stack still cannot come up, and the remaining blockers are recorded against task 10.20 and the gates: the
scheduler has no process or image (`<SCHEDULER_IMAGE_REF>` = `OWNED_BUILD_PENDING`, finding **O2**'s other
half), three of the six image references are external and unbuilt, and no artifact yet states whether phase 1
is a bare `docker compose up` or an explicit service selection. Recorded here rather than fixed, because each
belongs to a task or a gate that owns it.

---

## Task 10.20 - the scheduler process and its image, and the one place readiness has no store to stand on (2026-08-10)

**Spec:** `.kiro/specs/06-two-agent-vps/` task 10.20. **Contract:** PFOS 12 §2.1 (six services), §3.2.2 (the
scheduler is permitted a read-only cross-store view and takes NONE), §7.3 (readiness), §8.2 (it is one of the four
services that honour the halt). **Owning requirements:** R34, R29, R9, R27, R22, R28, R24. **Closes:** the other
half of finding **O2**.

### Work

`src/server/process/scheduler.ts` is the process tick delivery never had, in the shape task 10.19 established and
task 10.7 before it. It is deliberately the smallest of the three, because of what it does not hold: no store, no
volume, no bot token, no model key, no storage credential, no weekly cap and no bus endpoint.

- **It refuses to boot on an incomplete environment (R27).** `requireServiceEnvironment` over
  `SERVICE_ENTRY_NAMES.scheduler` is the ONE refusal, called first and wrapped in nothing, and it names every
  finding in a single message - asserted with three simultaneously broken entries, and again with an entry still
  holding its own placeholder. A booted-but-unconfigured clock would deliver ticks nowhere while reporting itself
  healthy, and both agents would go un-ticked with nothing anywhere saying so.
- **It honours the halt in both forms (R29), and the gate is REUSED rather than re-read.** The file sentinel is
  consulted **per tick**, because a halt that needs a restart is not a halt; `NIZAM_KILL_ALL` is read once at
  boot, because that is the only moment its value can have changed. An unrecognised coarse value is treated as
  engaged, a blank one is refused a layer earlier by the completeness pass, and a sentinel that **cannot be
  examined** is treated as present - all three already true of `haltGate.ts` and none restated here. Flipping the
  sentinel between two ticks changes behaviour with no restart, in both directions, which is the only way "per
  tick" is observable rather than asserted.
- **The halt is consulted, not asserted, and `HALTED_ACTIVITIES` did not grow.** An agent calls
  `assertPermitted`, which raises, because an agent has a caller to refuse. This service has none: a halted tick
  is not a refused request, it is a tick that does not happen. So it reads `engagedForm()` and delivers nothing,
  and R29's list of three activities stayed verbatim rather than acquiring a fourth entry with no caller to inform.
- **Both tick endpoints go through the bus's rule, which is now SHARED.** `internalEndpoint.ts` holds the
  classification once - `<name>:<port>` and nothing else, with a scheme, a path, an address literal, a wildcard, a
  reserved name and an out-of-range port each refused rather than coerced - and `busServer.ts` keeps
  `BUS_ENDPOINT_REFUSALS`, `BusInternalEndpoint`, `BUS_RESERVED_ENDPOINT_HOSTS` and `parseInternalEndpoint` as its
  own names over it. All eight declared refusals are exercised against a tick endpoint, each shown stopping the
  boot with **nothing dialled**, and each refusal message is asserted **not** to contain the value that offended
  it (R24). The bus's own suite passed unmodified, which is what makes "shared, not rewritten" mechanical.
- **It binds no public port, asserted in both directions (R9, delta D6).** `listeningPorts` is a `const` with no
  writer anywhere in the module; the injected host's bind record is empty after a tick, a readiness answer and a
  shutdown; and the real host's `listen` half **refuses**, so an edit that tried to give this service an accept
  surface fails loudly instead of publishing a port. The topology gives it no `ports:` key either.
- **A failed tick does not kill the clock.** Each target is delivered independently with a bounded doubling
  backoff and is then abandoned **for that tick only**. One unreachable agent does not cost the other its tick, a
  client that raises does not propagate, and the process wrapper still exits 0 after a tick in which nothing was
  delivered. `restart: unless-stopped` means a process that exited on a failed dial would be restarted into the
  same failure - a crash loop that also loses the other agent's ticks.

### The one place the bus's shape does not transfer: readiness without a store

The bus's readiness answer rests on three store facts plus a liveness record beside the store. This service mounts
**no store at all** - §3.2.2 permits it a read-only cross-store view and it declines, because a tick is a signal
to the agent that owns a store rather than a query against one - so `ops/docker-compose.yml` gives it no store
volume and the three store facts are not merely unavailable to it, they are **meaningless** for it. Two things
were needed and neither is a weakening:

1. **A third probe mode.** `healthProbe.ts` now declares `storeless`, in which the three store checks are
   `not_applicable` and `queue_worker_alive` stays **applicable** - so this service is ready only when its own
   loop reports itself, which is the one check it cannot decline. A third mode rather than a second probe module
   because both alternatives were worse: a hand-built report claiming `store_opens: pass` for a service with no
   store would be a lie in the one artifact the orchestrator acts on, and a parallel readiness vocabulary would
   give the deployment two `isReady` rules and two exit-code mappings to keep in agreement. **There is no
   command-line flag for the mode**, and `ProbeInvocation` became a union so a storeless probe has no field a
   store path could occupy while a store-backed one cannot omit it - the parser's return type narrows to the
   store-backed variants, which makes "no argv route to leniency" a type-level claim as well as a tested one.
2. **Somewhere for the liveness record.** There is no volume, so it lives in the platform's temporary directory,
   read from `node:os` in `schedulerMain.ts` rather than written as a path anywhere. That works for the same
   reason the bus's does: an exec healthcheck runs inside the service's **own container**, so the container is
   what the two processes share. Two consequences, both correct rather than tolerated - the record does not
   survive a container restart, so a restarted container reports not-ready until its new loop has recorded itself,
   which is what should happen because the old loop's evidence says nothing about the new one; and no path in this
   repository names it, so nothing about it is a deployment particular (R24).

The staleness window is **derived from the configured cadence** - three periods, with a floor - rather than fixed,
because the loop's period is the operator's choice and a fixed window would either fail a correctly configured
slow cadence or tolerate a wedged fast one. A **halted** scheduler still records liveness and still reads ready,
because it is running and correctly delivering nothing: reporting it unhealthy would have the orchestrator restart
a service that is doing exactly what the operator asked.

### The image, and the record

`ops/images/scheduler/Dockerfile` packages it with the four properties the audit already holds the other two owned
recipes to: base pinned to the `.nvmrc` major in both stages, an unprivileged final `USER`, no `ENV`/`ARG` value
of any kind, and the healthcheck command installed inside it (`nizam-scheduler-health` with no arguments, plus
`nizam-health-probe` so one spelling of the restore drill's command is installed everywhere). It is the smallest
of the six and says why for each absence: no store directory and no `install -d`, because there is neither a
volume nor a store; no `EXPOSE`, because this service is a client with no accept surface; no `HEALTHCHECK`,
because the topology declares one per service with its own interval and retries.

`ops/IMAGE_BUILD.md`'s row moved from `OWNED_BUILD_PENDING` to **`BUILT_HERE`** with its recipe path, no blocker,
and a build invocation naming the recipe and the reference on one statement - which is the property, one value
resolved once. `<BACKUP_IMAGE_REF>` is now the only row in the third state, and its blocker is a missing uploader
rather than a missing process, which is why writing two processes did not move it. `imageOwnership.ts` needed no
change; its test's state groupings and two negative-test anchors moved, which is that audit working as intended.

### One unit decision, recorded rather than guessed

No artifact declared `SCHEDULER_TICK_INTERVAL`'s unit: the fill-in sheet says "your choice of tick cadence" and
the value ledger says "operator choice of cadence". It is read as **whole seconds**. The convention this
repository already follows is that an entry whose name ends `_MS` is milliseconds - `STORE_BUSY_TIMEOUT_MS`, every
`*_TIMEOUT_MS` - so an entry that does not say so is not, and reading a sensible-looking value as milliseconds
would silently turn a cadence into a tick storm against both agents. `ops/env/scheduler.env.example` now states
the unit on the entry's own `what:` line so the operator is told rather than left to match a comment in code, and
its header's stale claim that "this file is four entries long" was corrected to five.

### Gate result

- `npm run typecheck`, `npm run lint`, `npm run test` green throughout.
- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because AC14 and AC15
  require a clean tree.
- **28 tests added; the AC04 `--min` floor raised 2058 -> 2086.** Up only, and nothing lowered, allowlisted,
  skipped or exempted.
- AC18's declared dotted-token list gained three file names (`scheduler.ts`, `schedulerMain.ts`,
  `schedulerStart.ts`). No host, address, port literal, identifier, token or figure was added anywhere; the two
  endpoint values in the test file are synthetic service names.
- **`ops/GATE_REGISTER.md` was NOT edited.** No gate renumbered, removed, softened or reopened, and **no checkbox
  ticked** anywhere except `10.20`'s own line in `tasks.md`.
- **Nothing was run that steering §2 gates.** No image built, no tag resolved, no registry contacted, no stack
  started, no port published, no tick delivered, no outbound network call, and the other repository was not
  touched. The dialling adapter is written and exercised only through an injected recorder that reaches nothing.

### What still stops `docker compose up`

Recorded here because it is the question this pair of tasks was aimed at, and it is now shorter than it was.
Three of the six image references remain unbuildable from this repository - `<LIFE_IMAGE_REF>` is the other
repository's, `<PROXY_IMAGE_REF>` is an upstream release, and `<BACKUP_IMAGE_REF>` waits on the uploader that
gate G4/G5 work implies (task 10.9) - and every gate G1 through G8 except the closed G7 is still open, so no
value exists to resolve any reference to. Beyond that, **no artifact yet states whether phase 1 is a bare
`docker compose up` or an explicit service selection**, which task 10.19 flagged and this task did not close:
under option (b) the life agent is idle, and the topology gives `scheduler` a `depends_on` on
`life-agent: service_healthy`, so a bare `up` would wait on a service phase 1 does not intend to run. That is a
topology question with an owner, not a defect in either process written here.

## Task 10.22 - the phase-1 start that would have waited for ever, and the selection nobody had written down (2026-08-10)

**Owning requirement: R35 (new).** Spec `.kiro/specs/06-two-agent-vps/`, task 10.22. Owner ruling dated
2026-08-10, recorded rather than proposed.

### What was wrong

Task 10.20 found it and could not close it, because it was a topology question with an owner. `ops/docker-compose.yml`
gave both `caddy` and `scheduler` a `depends_on: life-agent: condition: service_healthy`. Under the authorised
option **(b)** the life agent stays created, hardened and **idle** - it is the other repository's, and steering §6
forbids this session from modifying it - so phase 1 does not run it. A start dependency on a service phase 1 does
not run has two consequences and both are quiet: a bare start waits for ever on a service that is never coming, and
naming the `scheduler` on the command line **drags the life agent in with it**.

### The ruling, and the reasoning worth keeping

**Relax it.** The owner's reason is what makes the relaxation safe rather than merely convenient: a tick delivered
to an absent agent is **already** an abandoned delivery with a bounded backoff rather than a crash. Task 10.20
built that, and `scheduler.test.ts` observes it. So the `service_healthy` condition was buying a start-up wait and
no safety property - it was protecting against a failure the process already handles better than a dependency can,
since a dependency is evaluated once at start and the agent can go away afterwards regardless.

`caddy` keeps its life dependency, deliberately. It is phase 2 and profile-gated, so it does not start in phase 1
at all and its dependency costs phase 1 nothing; removing it would let phase 2 stand a proxy up in front of an
agent that is not ready.

### What changed

- **`ops/docker-compose.yml`** - the `life-agent` condition is gone from `scheduler`'s `depends_on`. Its
  `finance-agent` condition **stays**, so the relaxation cannot be satisfied by a scheduler that waits for nothing.
  The block carries the ruling, its date and its reasoning, because the next reader's first instinct on seeing an
  asymmetry between `caddy` and `scheduler` will be to make them agree.
- **`src/server/ops/composeTemplate.ts`** - `PHASE_ONE_SERVICES` is the selection as data, with the reason it
  cannot be derived from the file: a profile is not the discriminator, since `caddy` carries one because it
  publishes a port while `life-agent` and `backup` carry none and are still not started. Four new finding codes,
  each with a negative case that mutates the real template and observes the code fire:
  `PHASE_ONE_SERVICE_DEPENDS_ON_ABSENT_SERVICE` (the rule, shown firing when the removed condition is put back),
  `PHASE_ONE_SERVICE_NOT_DECLARED` (the vacuity guard - a phase-1 name the template does not declare would make
  the rule apply to nothing), `DEPENDS_ON_NAMES_UNDECLARED_SERVICE`, and `DEPENDS_ON_UNREADABLE`. Both compose
  spellings of `depends_on` are read - a list of names and a mapping of name to condition - and an unrecognised
  condition is a finding, because the engine accepts one as the weakest condition it knows.
- **`ops/IMAGE_BUILD.md`** - the selection task 10.20 flagged as written nowhere. The command names the three
  services, and a table gives the reason for each of the three absences: `caddy` is phase 2 and profile-gated,
  `life-agent` is idle under option (b), `backup` is `OWNED_BUILD_PENDING` on task 10.9.
  `phaseOneServicesNamedIn` reads that command back out of the fenced block and the test compares its operands
  with `PHASE_ONE_SERVICES`, so prose and code cannot drift. Its negative half is asserted too: a document with
  two start commands, or one outside a fence, reads as **no** selection rather than as a lenient match.
- **`.kiro/specs/06-two-agent-vps/OWNER_GATE_ACTIONS.md`** step 4 - it said `up --detach` with no operands, which
  was **wrong**, and it is the file the owner works from. It now names the three services and states what a bare
  start would have done.
- **`requirements.md`** - **R35**, written over "a service phase 1 starts" rather than over the scheduler, because
  the defect is a class: the same edit could be made to the bus or the finance agent by somebody adding a
  dependency that looks harmless, and it would present identically - a deployment that comes up clean, reports
  nothing, and waits for a service nobody intends to start.

### Gate result

- `npm run typecheck`, `npm run lint`, `npm run test` green.
- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because AC14 and AC15
  require a clean tree.
- **7 tests added; the AC04 `--min` floor raised 2086 -> 2093.** Up only.
- No secret, no address, no port literal, no identifier and no figure was added anywhere. AC18's declared
  dotted-token list is unchanged: every dotted token in the new prose was already declared.
- **`ops/GATE_REGISTER.md` was NOT edited.** No gate renumbered, removed, softened or reopened, and no checkbox
  ticked anywhere except `10.22`'s own line in `tasks.md`.
- **Nothing steering §2 gates was run.** No image built, no stack started, no port published, no outbound call,
  and the other repository was not touched.

## Task 10.18 - owner-only web access, where reachability is the control and loopback is not a setting (2026-08-10)

**Owning requirement: R33 (new).** Spec `.kiro/specs/06-two-agent-vps/`, task 10.18. Owner request.

### The decision, and it is a mode rather than a seventh service

`--serve-app` on the finance agent's own entrypoint. **`ops/docker-compose.yml` is unchanged**: no service,
no `ports:` key, no seventh environment template, no row in `SERVICE_ENTRY_NAMES`, no row in
`DEPLOYMENT_VALUE_LEDGER.md` or `OWNER_FILL_IN_SHEET.md`, no image row, no healthcheck.

The saving is real - a seventh service is six edits, not one - but it is not the argument. **A compose
service could not have done the job at all**, for three reasons recorded in `ops/APP_ACCESS.md`:

1. **A container's loopback is not the host's loopback.** The operator's tunnel terminates on the host's
   loopback interface. A container binding its own loopback is unreachable from that tunnel, and the only
   bridge is a `ports:` key - the one thing phase 1 forbids and the reason `caddy` is profile-gated. A
   published port would have made loopback-only depend on the operator spelling the address half of a port
   mapping correctly every time, rather than on the process refusing anything else.
2. **The built bundle is deliberately not in the image.** The root ignore file keeps it out of the build
   context on purpose, so an in-container app service would need a new image or a new bind mount.
3. **On demand beats always on.** The mode exists only while the operator's own session runs it.

### How loopback-only is made structural rather than careful

- **There is no way to express a bind.** No environment entry (the six templates and `SERVICE_ENTRY_NAMES`
  are untouched, and `environmentServices.test.ts` would fail in both directions if one had been added) and
  **no flag** in the invocation grammar - a test feeds an invocation a bind-shaped token and observes the
  parsed result hold only a port and a root.
- **The process passes a constant, and the bind path refuses anything else.** `requireLoopbackBind` is
  applied to that constant by the real listener host, which looks redundant and is not: it makes the
  refusal a property of the bind path, so an edit that replaced the constant with a configured value would
  be refused at the bind instead of quietly widening the server.
- **Nine refusals, each shown throwing, each naming the rule rather than the value.** An **empty** host is
  among them, because the platform reads an absent host as *every interface* - the widest bind there is,
  wearing the appearance of "unset". A **name** is refused even when it usually resolves to loopback,
  because resolution goes through configuration this process does not own: a bind address must be a fact,
  not a lookup.
- **R9 is asserted in both directions**: the process's own `listeningPorts` holds exactly one entry, the
  injected host's bind record holds the same one, and both are empty again after shutdown.

### No authentication, and that is the stronger posture

The same argument contract 12 §2.2.6 makes for the bus. A password protects a **reachable** port - the
attacker still connects, still fingerprints, still attempts, and still reaches whatever is in front of the
check. It is also a secret with a lifecycle, on a public repository whose whole posture is that no
particular exists in it to leak; adding one would add the first. And the owner has already proven who they
are to the host, with a key, before a request can exist. Nothing to rotate, nothing to store, nothing to
put in the fill-in sheet.

### Reads only, and nothing escapes the root

Two methods, and the request body is **drained and never read**, so there is nothing for a write to arrive
in. The module imports no connection factory, no repository and no migration series, so there is no code
path from a request to a store - it could not grow one without a visible new import. Every request path
resolves through `resolveStorePath`, the ONE containment guard, reused rather than copied for the reason
`liveness.ts` gives about itself: a second containment implementation is a second place for the fail-closed
direction to go generous, and generous here means handing out a file nobody published. A traversal, an
absolute override, a symlink out of the root and a root that is not there all fail the same single test,
and an escape answers with the **same status as an absent file** - so the answer confirms nothing about
what exists outside the root. An encoded traversal is not decoded, so it names a file that is not there.

### Readiness, and the halt

Readiness is the `storeless` probe mode task 10.20 added, over the **shared** liveness record - no third
copy of either. The three store facts are `not_applicable` because this mode opens no store; the loop check
stays applicable and additionally requires a bound port, so a process whose loop turns while nothing is
listening cannot report ready. Absent, stale, future-dated and not-listening are each shown not ready.

**No sentinel entry was invented.** Contract 12 §8.2 names the two agents, the scheduler and the backup
service; §8.1 lists a model call, a model-path store write and a bus publish. This mode performs none of
the three and holds none of the ports that could. The stronger reason is direction: §8's own rule is that a
halt **never** disables a deterministic view, and a halted deployment is exactly when the owner most needs
to read their own figures - so refusing a read-only static view under a halt would make the halt harmful.
`HALTED_ACTIVITIES` and `SERVICE_ENTRY_NAMES` are unchanged, following tasks 10.19 and 10.20.

### The rejected alternatives, recorded rather than dismissed

- **A public port plus basic authentication** - needs the published port phase 1 refuses, and phase 1 has
  no domain and no certificate, so the honest version of this option is a password in cleartext over the
  public internet.
- **An identity-aware proxy** - the eventual right answer, and it presupposes a domain (**G2**, blocked on
  a zone that does not exist), a certificate, a running proxy (phase 2, profile-gated) and a third party
  with a view of when the owner reads their own finances.
- **A private overlay network** - sound and redundant: it re-creates "only the owner's machine can reach
  it" with a second network, a second key distribution, a coordination service and a new daemon whose own
  reachability then needs reasoning about, when the existing tunnel already gives exactly that property.

The threat model in `ops/APP_ACCESS.md` includes **what this does not defend against**: anyone who can open
an authenticated session on the host can read the application, because that is the control being used. That
is the exposure the host already carries for the stores, the environment files and the sentinel, so it adds
no new trust - and it is why the tunnel is treated as the security boundary rather than as a convenience.

### Gate result

- `npm run typecheck`, `npm run lint`, `npm run test` green.
- `npm run verify:all -- --all` - **20 of 20 executed checks passed**, run after the commit because AC14
  and AC15 require a clean tree.
- **32 tests added; the AC04 `--min` floor raised 2093 -> 2125.** Up only.
- AC18's declared dotted-token list gained one file name (`appServer.ts`), which the new document names.
  No domain, host address, port literal, path on the host, credential or figure was added anywhere - the
  port and the served root are named by the operator in their own session, and the loopback literal
  identifies no deployment.
- **`ops/GATE_REGISTER.md` was NOT edited**, no gate touched, and no checkbox ticked anywhere except
  `10.18`'s own line in `tasks.md`.
- **Nothing steering §2 gates was run.** No listener was bound - every test drives an injected host that
  binds nothing - no image built, no stack started, no port published, no outbound call, and the other
  repository was not touched.

### The flake task 10.20 could not identify, identified and fixed (2026-08-10)

Task 10.20 reported `2086 total, 2085 passed, 1 failed` in one intermediate run and could not reproduce it.
This session reproduced it on the first full harness run after task 10.18 - `2125 total, 2124 passed, 1
failed` - and read the failing case out of the machine report the harness already writes:

```
src/server/process/financeReadiness.test.ts
"answers ready under longPoll while binding NOTHING, asserted in both directions"
AssertionError: expected 'not_ready' to be 'ready'
```

**It is a real defect, not a test artefact.** `createFileLivenessRecord.ageMs` subtracts two DIFFERENT
clocks: the filesystem's record of when the file was written, which carries sub-millisecond precision, and
this process's wall clock, which is quantized. A record written and then read inside the same quantum
therefore produces a small NEGATIVE age with nothing wrong anywhere. `livenessIsFresh` reads a negative age
as "the clock moved backwards" and answers not-fresh - which is the right treatment of a real backwards
jump and the wrong treatment of quantization. So a service that had just recorded itself reported **not
ready at random**, and under §7.3 the orchestrator restarts what reports unhealthy: the production
consequence was a healthy service being restarted, or a stack that never went healthy, for no reason an
operator could reproduce. All four services that answer readiness this way were exposed.

**The fix is at the measurement, not in the rule.** `ageMs` now reports a negative age inside
`CLOCK_QUANTIZATION_MS` as zero - which is what it means, the record was written just now - and returns
anything beyond that bound unchanged, so `livenessIsFresh` still refuses a record genuinely dated ahead.
The rule's fail-closed treatment of a future-dated record is untouched at every magnitude that matters: a
backwards jump worth refusing is seconds or hours, never a few milliseconds.

**One existing test was amended, and it is worth saying why rather than burying it.**
`financeReadiness.test.ts`'s backwards-clock case dated the record **one millisecond** ahead. A millisecond
is not a backwards clock; it is exactly the artefact. So that case was asserting that the artefact was
refused - which is both how the defect got in and why nobody found it, because the suite contained an
assertion that the broken behaviour was correct. It now names an offset a clock could actually have moved
by, and `liveness.test.ts` pins both directions of the bound explicitly: three sub-quantum disagreements
read as zero and stay fresh, three real future-datings read unchanged and stay refused.

One test added by the fix; the AC04 floor moved 2125 -> 2126 in the same increment.

### Phase 10 task 10.12 — the test ladder was RUN, and it found the top blocker (2026-08-10)

Mandate §9's ladder, executed rather than described. Record:
`.kiro/specs/06-two-agent-vps/LIVE_PROGRESS.md` — one row per rung with the command and what it
returned, the L2-L5 blockers with whose they are, and the verbatim transcripts in an appendix.

**L0 OBSERVED, through the real entrypoint in its own child process.**
`node scripts/ladder/l0-config.mjs` → `L0 PASSED`, exit 0. The runner spawns
`src/server/process/start.ts` and reads what that process wrote to its own streams; nothing in it
imports the loader or asserts against a returned value, because an in-process assertion is what the
existing loader and guard tests already are and §9's opening line says a rung is not passed because
the code looks right. Case A breaks **four** entries at once — two removed, one emptied, one left
holding its own template placeholder — deliberately, because a first-failure loader passes the
single-entry version of this rung. The boot exited **1** having written ONE aggregate naming all four
under **three different codes** (`ENV_ENTRY_ABSENT` ×2, `ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER`,
`ENV_ENTRY_EMPTY`) with the count stated, so one restart answers the whole question (R27). Case B
restored the four and the boot **proceeded** — `store_opened` on the process's own output stream, and
an **empty** error stream, which is what rules out a boot that proceeded while still complaining.

**L1 OBSERVED, by running task 10.6's 25 tests rather than writing new ones.**
`npx vitest run src/server/telegram/modeAwareGuard.negative.test.ts` → `Test Files 1 passed (1)`,
`Tests 25 passed (25)`, 18.85s.

**Finding F20, and it is the single most consequential thing this run produced.** Bare
`node src/server/process/start.ts` **cannot start**. Every relative import under `src/` is written
extensionless; `moduleResolution: "bundler"` resolves that and so do Vite and Vitest; **Node's own ESM
resolver performs no extension search**, so the first import answers `ERR_MODULE_NOT_FOUND` before any
environment is read, on every host, in every mode. Measured against Node v24.14.1, the pinned major.
The CommonJS route was probed and does not help. The consequence is not academic:

- all three owned images' `ENTRYPOINT` name one of these shims (`start.ts`, `busStart.ts`,
  `schedulerStart.ts`) and would exit immediately;
- all four `--health` commands and the restore drill's `probe.ts` exit non-zero for a reason unrelated
  to readiness — and `caddy` and `scheduler` wait on `finance-agent: service_healthy`, while both
  agents wait on `signalbus: service_healthy`;
- `package.json`'s `start` and `health` scripts are unrunnable as written.

So rung **L2 is `BLOCKED - awaiting build` and the blocker is OURS**: with G1, G3, G4, G5 and G8 all
observed, `docker compose up` would still stand up nothing. **It was invisible because tasks 10.7,
10.19, 10.20 and 10.21 asserted these processes through Vitest**, which imports them through the
project's resolver — that proves the process logic and says nothing at all about launching it. This is
precisely the gap between "what is written" and "what is observed" that the ladder exists to expose,
and three of those four tasks recorded their process as done on the strength of the former.

**Not repaired here, and that is a scope judgement rather than an omission.** The repair is a packaging
decision with two candidate shapes — an extension on every relative specifier in the graph (with
`allowImportingTsExtensions`, which the project currently sets to `false`), or a build step emitting
runnable modules into the image — and it touches the three Dockerfiles, `ops/IMAGE_BUILD.md`,
`package.json` and possibly every module under `src/`. It deserves its own task, its own tests and its
own commit. What this run did instead was make the rung it blocks observable:
`scripts/ladder/ts-resolve.mjs` registers a resolve hook that restores **exactly** the one resolution
the project's toolchain already performs — a file, then a directory index — and nothing else: no
transform, no path mapping, no condition. So L0 was observed against the real `main`, the real loader
and the real store, and F20 is recorded as its own finding rather than mistaken for a loader defect.

**L2-L5 are recorded with the precise blocker and whose it is**, and none was simulated, asserted from
code, or marked passed. L3 needs L2 then G3 **placement** (both bots already exist and were verified
live, so creation is the finished half); L4 needs G4's two keys; L5 needs task **10.9**'s uploader —
which is why `<BACKUP_IMAGE_REF>` is still `OWNED_BUILD_PENDING` — and then G5 and G8.

**Nothing steering §2 gates was run.** No `setWebhook`, no DNS record, no published port, no image
built, no stack started, no outbound call — the finance agent's live provider client refuses by
construction in this build, which is what makes case B safe to run at all — and the other repository
was not cloned, fetched, read, modified or pushed. `ops/GATE_REGISTER.md` was **not** edited and no gate
checkbox was ticked. Every ladder value is a self-evident non-value and the store is created in a
temporary directory outside the tree and removed at the end (R24).

No test added — this task's deliverable is an observation, not a mechanism. Floor stays **2126**
against a real 2126.

### Phase 10 task 10.16 — the cross-repo interop contract, and R31 (2026-08-10)

`ops/INTEROP_CONTRACT.md`. **R31** authored in `.kiro/specs/06-two-agent-vps/requirements.md` under a
new *Cross-repository interoperation* heading, with its finding note.

**The owner's clarification is the whole of the scope decision.** "Clone and migrate both repositories"
means *making the two agents understand each other* — feeding information and communicating — **not** a
code migration and **not** a repository move. So the deliverable is a contract and not a git operation,
and nothing in this increment touched, cloned, fetched or read the other repository.

**The test applied to every sentence: could the other side act on this with no access to this tree?**
That is what makes the document long, and it is not padding. Written out in full rather than cited: the
eight stored-envelope fields with their forms; the three payload keys; the two envelope forms and the
one field that differs between them, with the reason a producer may not assert its own integrity; all
**24** validation reason codes; the four consent-by-absence rules with a code each; the note's two
separate fences; the query's four keys; both response shapes; all eleven protocol-level refusals with
their statuses; and all eight endpoint refusals with what each one catches. A reader in the other
repository cannot resolve an import into this one, so a citation would have been a dead end.

**Four things are stated because a reader would otherwise get them wrong.**

1. **Absent, not filtered.** A filter is code that can be bypassed, mis-ordered or forgotten on a new
   path; an absent field cannot be populated by any caller on any path. So the rule is a schema refusal
   with its own reason code, not a scrub, and the document says so where a reader would look for the
   scrub.
2. **A refusal is not an empty list.** The two are different shapes deliberately, so "you may not see
   this" cannot be conflated with "there is nothing here".
3. **Today every kind is `producer_only`**, because the widening list is empty — so a cross-agent read
   is refused *right now*. That is the fail-closed starting position and it is written down so the other
   side does not read its first refusal as a defect and start looking for the bug.
4. **The bus authenticates nothing**, under a heading that says *do not fix this by adding a
   credential*, with the three reasons it would be worse: it guards a route that does not exist; it is a
   secret with a lifecycle that must be kept equal in two files on a public repository; and reachability
   already excludes everything but the two agents. This is the argument contract 12 §2.2.6 makes,
   restated where the person tempted to undo it will be reading.

**The excluded classification is recorded WITHOUT being named, and that rule was learned by breaking
it.** Contract 12 §4.4.3 forbids any artifact in this tier from naming, counting, summarizing or
pointing at that content, and `src/server/signals/exclusion.test.ts` holds it over `ops/**` among four
roots. The first draft of this document spelled the classification and failed three of that file's
thirteen cases — which is the checker working exactly as intended, and it is worth recording that the
mistake was caught by the tree scan rather than by review. The document now uses the phrasing the
vendored schema and the port already use — *the classification whose egress set is empty in the other
repository* — and it states in one sentence **why** it does not name it, so that a later editor does not
read the omission as an oversight and helpfully repair it. The exclusion is recorded as enforced twice:
the egress set excludes it at source in the other repository, and the `tier` enum has two members, so
the excluded classification **is not a member of the union** and a signal claiming it fails as an unknown
member (`tier_not_a_member`) rather than being filtered somewhere later.

**The three change specifications are named as change specifications.** `ops/nizamcore-patches/` is the
mechanism by which the other side acquires its half, and the document states explicitly that they are
**not applicable diffs**: the other repository was never read, so there are no verified context lines
and no blob hashes, and none were invented. The read-only clone at an **ignored** path is recorded as
permitted (steering §6 as amended by task 10.1's §2a), with modify and push still owner-gated, and the
present fact stated plainly — nothing cloned, nothing fetched, the three specifications emitted and
unapplied. Option **(b)** is recorded as authorised, together with the observation that makes it cheap:
nothing in this contract changes when the second agent arrives.

**R24 held under AC18, which scans this file.** No host, address, port, token, identifier or monetary
figure appears; the weekly bound is referred to and never printed. Five dotted tokens were added to
`DECLARED_DOTTED_TOKENS` (`INTEROP_CONTRACT.md`, `AGENT_CAPABILITY_SPLIT.md`, `consentGate.ts`,
`envelopeValidation.ts`, `internalEndpoint.ts`) because that list is **bidirectional** — a declared token
that appears in no scanned artifact is itself a finding — so each one is a file this document actually
names, and the document names its own path once for the same reason. Feature and module citations are by
**directory** wherever a file name would have been a sixth declaration, which is both accurate and
smaller.

No test added — the deliverable is a document. Floor stays **2126**.

### Phase 10 task 10.17 — the full-scope capability split, and R32 (2026-08-10)

`ops/AGENT_CAPABILITY_SPLIT.md`. **R32** authored in `.kiro/specs/06-two-agent-vps/requirements.md` with
its finding note. The owner's clarification is the reason it exists: the life/therapy agent is owed the
same treatment as the finance agent, so that the **full NIZAM scope** exists with its features split
across the two bots **by functionality**.

**One table, 37 rows.** Twenty-one finance, eleven life, five belonging to the deployment rather than to
either agent. Each row carries the owning bot, its **State**, the governing contract, the directory it
lives in, its signal, and its band. The finance rows were read out of `src/features/**` and
`src/server/**` rather than guessed, which is why there are twenty-one and not the seven the task text
names: budgeting, transactions, obligations, safe-to-spend, forecast, net worth and decisions are all
there, and so are import, reconciliation, accounts, reports, the owner-only view, turn classification and
routing, the per-agent bound, the transport, the store and the halt.

**Twelve rows are `REFUSED BY CONSTRUCTION`, each with its reason, and every one of them is a figure, a
date, an identifier or a narrative.** That is the same four schema rules appearing thirty-seven times and
firing twelve of them, which is what steering §4.3's *by construction rather than by filtering* looks
like when it is applied capability by capability instead of asserted once. The document states the
uncomfortable half rather than burying it: **the four richest things the finance agent computes are among
the refused** — safe-to-spend, the cash-flow forecast, net worth and the decision registry — and the
reason it is not a loss is that the life agent does not need any of them. It needs to know whether money
is a source of pressure today, which is one of three levels.

**Only four kinds cross, two each way**, out of thirty-seven capabilities. The document says plainly that
this ratio is the design and that a proposal to widen the channel should have to argue against the table.

**Two honest columns rather than one flattering one.**

- Every life-side row reads `OTHER REPO` or `NOT BUILT`, **in a column** rather than in a caveat a reader
  could skip, so no row can be mistaken for something that exists today. Authoring the split is not
  implementing it: that is option **(a)** work in a session opened on the other repository.
- Rows 22 to 27 record their governing contract as **gap**. There is no NIZAM contract for journaling,
  reflective retrieval, therapy dialogue or the wearable connector — PFOS 01 to 04, 06 and 09 to 11 are
  the finance product, and contract 12 governs the deployment and the boundary. The current-state steering
  file's rule is to author the relevant contract before building its area and never invent policy a
  contract would govern, so this document decides nothing about what a therapy turn may say and carries
  only what the boundary needs. Recording the absence is the most this side can honestly do, and it is
  more than leaving the rows out would have been.

**One clarification that prevents a predictable misreading:** every cross-agent kind is `producer_only`
today, because the widening list is empty. So the `Signal` column says what a kind is **for**, not that
it is readable yet — and the reader is pointed at `ops/INTEROP_CONTRACT.md` §5 where that is stated as a
rule rather than as a state.

R24 held under AC18, which scans this file: no host, address, port, token, identifier or monetary figure;
the PFOS contracts are cited **without their file extensions** so that no dotted token had to be
declared, and the one citation that would have needed a declaration was reworded instead. No test added —
the deliverable is a document. Floor stays **2126**.

### Phase 10 task 10.14 — the cumulative scorecard, marked ruthlessly (2026-08-10)

`.kiro/specs/06-two-agent-vps/LIVE_PROGRESS.md`, rewritten to mandate §10's full shape: **19 rows** —
eight gates, six ladder rungs, five §6 build items — each with a state drawn from the four §10 admits,
evidence, the owner action if there is one, and a date. The verbatim transcripts are in an appendix, so
no `OBSERVED` row rests on a summary of itself.

**Three rows are `OBSERVED` and no more:** L0, L1 and §6.1, each naming the command and quoting what came
back. Everything else is blocked or not started.

**The evidence rule was applied against this repository's own work rather than only against the owner's**,
and that is where it bit:

- **§6.3, the finance-agent entrypoint, is `BLOCKED - awaiting build`** even though its process behaviour
  was observed in L0 case B — it booted, refused, opened its store, bound nothing under `longPoll`.
  The reason is F20: the entrypoint **as packaged cannot be launched**, and launchability outranks
  behaviour here because it is the launch that rung L2 needs. Recording it `OBSERVED` on the strength of
  the behaviour would have been the exact inflation §10's evidence rule exists to prevent.
- **§6.2 is `OBSERVED` with its limit written into the state cell**: the live adapter is constructed in
  the real process and its mode-aware guard is proven by 25 tests, and **delivery is not observed at
  all**, because this build wires a provider client whose two members refuse.
- **§6.4 records that no image has ever been built.** Three recipes exist; building one is outside this
  phase's permitted actions; and under F20 all three would produce containers that exit immediately.

**§5 is marked at 1 of 7.** Only condition 7 — the harness at 20 of 20 with a committed tree — is
observed, with the harness's own two summary lines quoted. The other six are marked `no` with a reason
each, and the table states the thing most worth knowing: **five of the six fail for one underlying
reason**, that nothing is running anywhere, rather than for five different ones. Two of the six deserve
their reasoning recorded here as well:

- **Condition 4 is split honestly.** The band-not-figure half is strong, because it is a schema absence
  rather than a filter, and task 10.16 has now recorded it for both sides. The *reachability* half is a
  property of a running host, and no host is running — so the condition as written is not observed.
- **Condition 2 is refused despite the isolation being proven.** One process booted on a developer
  machine against a store in a temporary directory is not *two independent agent processes* on a host,
  and the second agent is in the other repository and unbuilt. The structural isolation is real; the
  condition is about something else.

**One vocabulary gap is recorded rather than papered over.** §10 admits exactly four states and none of
them means *closed, deliberately, and never coming back*, which is what G7 is. It is recorded as
`NOT STARTED` with the closure stated in its evidence, and a paragraph under the table says why a fifth
state was **not** invented: a new state would make this record incomparable with its next rewrite, and
comparability across rewrites is the whole value of a cumulative record.

G3 carries its **creation half's live evidence cited to the owner's own 2026-08-09 session** —
`getMe` twice on both tokens, `getWebhookInfo` confirming no webhook — with **placement** named as the
open half, so the row neither claims a gate nor loses an observation that was genuinely taken. No gate was
attempted, advanced or ticked from this session; `ops/GATE_REGISTER.md` was not edited.

The three closing lines are the last three lines of the file and nothing follows them: what is live, the
single next blocking action and whose it is — **ours, F20** — and the count, **1 of 7**.

No test added — the deliverable is a record. Floor stays **2126**.

### Spec 07 Phase 2 task B4 — the messaging provider module, and the socket that stayed a parameter (2026-08-11)

`src/server/telegram/providerRequest.ts`, wired at `src/server/process/main.ts` in place of the two
throwing stubs that stood at seams **S1** and **S2**. `liveTransport.ts` had already built the live half
of the transport — the offset durability ordering, the bounded send retry, the accept path — and declared
its whole outside world as one injected interface it deliberately did not implement. This is that
implementation, and it is the artifact spec 06 withheld.

**What the two seams now do.** A long-poll read composes the provider's own parameters from the request
the transport handed it — the offset, the timeout, the batch bound — and **passes all three through
unchanged**: no margin on the timeout, no cap on the limit, no offset arithmetic, because `POLL_POLICY`
and R26.1 already own those. A send composes the reply and returns a receipt whose instant comes from the
injected clock rather than from a provider field. Both go through one function whose refusal ordering is
the point: the credential must be configured, the base address must be transport-secured, the body must be
inside the read bound **before** it is parsed, the provider's rate limit is raised as a typed refusal, any
other non-success status is refused, and only then is the envelope read.

**No network call is made, and that is structural rather than promised.** The socket is a parameter, the
same shape `liveModelCaller.ts` takes on the model side: no `fetch`, no `node:http`, no `node:https`, no
client library, so importing the module grants no ability to reach anything. What `main.ts` wires is
`gatedProviderRequest()`, which holds no network primitive and refuses while naming the two gates that
supply one. The seam therefore still refuses today — but it refuses *from the real module*, having already
resolved the credential, composed the request and applied the bound, so G3 and G6 supply **one function**
rather than a module. Steering §2's ban on an outbound call from a server process is untouched.

**The credential cannot be printed.** It is resolved into an opaque holder whose `toString` and `toJSON`
are the redaction marker, so interpolation, `String()`, `JSON.stringify` and every structured logger reach
the marker. `revealProviderCredential` is the single named way to the characters and **this module never
calls it** — the capability does, at the one call site a human will write. The credential also never
travels *inside* the request object: that shape has no header field and no credential field, so a request
may be recorded whole, and a test asserts the recorded request holds no token and the argument beside it
prints as the marker.

**One chokepoint, not two.** `processEnvSource` remains the only expression in `src/` that reads the
ambient environment, and the tree scan that enforces that still finds exactly one hit. The module takes an
injected `EnvSource` and asks the loader's **own exported rules** — `describeConfiguredPresence` for "is
this entry configured", `parseApiBase` for the base address — so nothing about entry usability is restated
here and nothing here can soften it. An unfilled template placeholder is refused as unconfigured because
that is the loader's rule, not a second copy of it.

**One implementation of the update-key rule, two policies over it.** `readUpdateKeyFields` reads the two
fields that matter — the update identifier, which is half the dedup key, and the sender, which the
allowlist reads — and `main.ts`'s `readDeliveryIdentifiers` now delegates to it. The policies differ
because the consequences differ: on the webhook path an update with no readable sender is ignored and the
provider retries, while on the long-poll path the offset **is** the acknowledgement, so dropping such an
update would park the offset on it for ever. It is therefore represented with the *empty* sender rather
than an invented one — no allowlist holds the empty sender, so the existing guard refuses it, the offset
advances, and the poller cannot wedge. An update whose *identifier* is unreadable refuses the whole batch,
because a partially read batch would move the offset past work nobody stored.

**No credential, body, sender or base address reaches a log line.** One line per request, built through
`redactedLogger` and through nothing else, carrying an operation, a verdict, a latency and a refusal code —
`enum` and `duration_ms` fields only, and that logger's field types cannot hold prose at all. Two events
were **added to the closed set** rather than reached through a wider one, so what this tier writes down is
still reviewable in a single read. A latency the capability did not report as an integer is omitted rather
than rounded, because a refused log line must never fail a request that worked.

**Tests: 28, all over a local fake responder, no network.** A normal update, an empty update set, a
non-success status, a rate-limit answer with a retry hint (and one preferring the response's interval over
the body's, and one with no interval at all, which must never read as "retry immediately"), a malformed
body, and a body over the read bound proved to refuse **before** the parse by using a body that would
otherwise have succeeded. Plus: the bound is measured in bytes rather than code units; the credential is
absent, and separately still a placeholder; the base address is not transport-secured; the wired capability
refuses; a receipt is not invented; and one test asserts that across a read, a send and a refusal no line
carries the token, the message text, the sender, the chat reference or the base address, and that every
line is the structured record with only declared feature names.

**No guard was weakened, no floor lowered, no `eslint-disable` added, and no gate performed or claimed.**

Floor ratcheted **2126 → 2193**, which also closes finding **F25**: spec 08's `tasks.md` recorded a
ratchet to 2146 that was never applied to `scripts/verify/all.mjs`, and the true count had since reached
2165, leaving the monotonic guard 39 cases slack. The floor now equals the measured count.

### Spec 07 Phase 2 task B4, second half — the dialler exists, and the gate became a selection (2026-08-11)

Decision id **D-DIALLER**. The first half of B4 built `src/server/telegram/providerRequest.ts` and made the
network capability an injected parameter, wiring `gatedProviderRequest()` — which holds no socket and
refuses, naming G3 and G6. Defensible, and it left a real gap. Phase 2's exit says rung `L3'` becomes
reachable for bot B "once a credential exists in Phase 5", and spec 07 README §2 claims "one credential
release, two bots unblocked". Neither was true while a socket-owning function still had to be **written** in
Phase 5. **A build that needs new code after the owner performs a gate is not a ready build.**

**The ruling.** Steering §2 gates *making* an outbound call from a server process. It does not forbid
*writing* the adapter: §2's BUILD NOW column lists the messaging transport as build-now behind an injected
port, and `pfos-current.md` says "the live adapter is a separate, later, gated module".
`src/features/benchmark/liveModelCaller.ts` is the precedent on the model side of the tier — a live caller
that exists in the tree and is exercised only under an authorised carve-out. This mirrors it on the
messaging side, and the gate is now expressed as a **selection** rather than as an unwritten file.

**One new module: `src/server/telegram/liveProviderRequest.ts`.** `node:https` and `node:buffer`, the
platform's own facilities, and **no dependency added**. There was no in-tree style to follow: the model-side
`liveModelCaller.ts` holds no network primitive at all, declaring its transport as a parameter it
deliberately never implements, so the repository contained *zero* concrete live adapters before this one.
The nearest precedent for a bounded, byte-counted read over the platform's own HTTP module is `readBody` in
`process/main.ts`, which uses `node:http`; the dialler mirrors it with `node:https` so there is one style of
socket read in this tree rather than two.

**It is the only place the address is composed, and therefore the only caller of the one reveal.**
`composeDialledAddress` joins the resolved base, the credential segment and the provider's published method
name, and the address it returns is held in a local and handed straight to the platform. A scan of the
module's executable lines asserts exactly one call to `revealProviderCredential`. Nothing else in the
repository composes an address, and nothing receives one back.

**Nothing that could disclose anything leaves it.** The module holds no logger, no sink and no `console` —
asserted by source scan — so the single redacted line per request is still the existing module's, built
through `redactedLogger` and through nothing else. Every refusal is a `ProviderDialError` carrying an
enumerated code and the operation name, and the platform's own error is **discarded rather than chained**: a
socket failure's message names the host it could not reach, so a `cause` would smuggle the address into
every handler that formats an error tree. Three codes, one per way no answer exists at all: an unsecured
base, an unreachable peer, an expired deadline.

**No policy in the dialler.** It dials and reports `status`, `bodyText`, `latencyMs` and the interval the
provider advertised, read off the `retry-after` header and **reported rather than obeyed** — the wait belongs
to the existing `SEND_RETRY_POLICY`, which already consumes the typed rate-limit refusal. Source scans assert
the module contains no retry budget, no backoff, no success range, and no `JSON.parse`: whether the body
parses, whether the envelope reports success, and whether the status is a success are all the existing
reader's judgements and they stay there. An absent status is reported as `0`, which is outside the success
range, so the reader refuses it — the dialler does not decide that, it merely does not invent a success.

**Two bounds, both derived.** The read bound is the existing `MAX_PROVIDER_RESPONSE_BYTES`, measured in bytes
on the wire, and reading stops once the bound is **exceeded** rather than reached — stopping exactly at it
would hand the reader a truncated body that counts as within bounds, which it would then refuse as
unparseable: the right outcome for the wrong reason, and a reason that hides the fact that the provider sent
too much. The accumulation rule is extracted as a pure function so the bound is tested without a socket, and
a test carries its report through the **existing** reader and observes `body_over_read_bound`. The request
deadline is derived from `POLL_POLICY.timeoutSeconds` — the one long-poll policy, doubled, because a socket
deadline shorter than the hold would abort every successful long poll — and an unusable hold is refused at
**construction**, so a bad deadline never reaches a socket.

**The selection is the load-bearing part, and it is structural.** `selectProviderRequest(env)` in
`process/main.ts` returns the dialler when this agent's `BOT_B_TOKEN` entry is configured — asked through the
loader's own `describeConfiguredPresence`, so "configured" still means set, non-blank and not still its
template placeholder — and `gatedProviderRequest()` otherwise. Two branches, one function each, no flag
inside either.

**No liveness entry was reused, because this repository declares none, and that is reported rather than
papered over.** `TELEGRAM_MODE` is the only mode entry the finance service declares and its vocabulary is
`webhook | longPoll`: which of two ways the provider and the agent reach each other, not whether the
deployment is live. Both values describe a running deployment, so neither can carry the decision.
`NIZAM_KILL_ALL` is a halt rather than a liveness flag, and `HALTED_ACTIVITIES` does not name an outbound
messaging request. The `finance` entry set holds no other candidate. Adding one would be a new environment
entry that R23 would then have to gate, and a new invocation flag was equally out of scope, so the
credential-configured condition stands **alone**. It is not a weak condition: the token entry is gate **G3**,
populated by the owner placing a credential in the host's root-owned configuration directory and by nothing
else. A developer machine has no such entry and therefore gets the gated capability; the suite passes
synthetic environments and therefore does too.

**Tests: 30 added, and NO NETWORK CALL IS MADE BY ANY OF THEM** — not to a provider, not to loopback, not to
a local fake listener. The live capability is **constructed and never invoked**; constructing it opens
nothing. Which capability was wired is proved by a `WeakSet`-backed identity marker that only the dialler
module can mint, so a cast cannot forge it and the assertion needs no call. Both directions are asserted: an
unconfigured credential — absent, empty, blank, and still a placeholder — selects the gated capability, and
that one *is* invoked and observed refusing with `transport_gated` while naming G3 and G6, because refusing
holds no socket and is the whole of what it does. The rest is the pure surface: address composition for both
operations and for a base with a trailing separator, the refusal of an unsecured base, the byte-counted bound
including a wide character that a code-unit bound would have measured cheaply, the header read across a list
value, a mixed-case name, a zero, a negative, a decimal and a date form, and the refusal shape carrying no
address and no credential and chaining no platform error.

**What is NOT tested, stated plainly rather than left to be discovered.** The socket. Whether the platform
returns the bytes expected, whether a real peer times out inside the derived deadline, and whether a real
oversized answer truncates at the bound are observable only by dialling, so they are left untested — an
untested branch reported honestly is worth more than a green that made a call. The first exercise of that
path is the owner's, on the host, after G3.

**What remains gated.** G3 places the token on the host and is what flips the selection; **no code change is
needed when it does**, which is the whole point of this task. G6 (`setWebhook`) stays deferred per README §5
and is irrelevant under `longPoll`, where the provider delivers nothing. B5 and B6 still stand between a
delivered message and a model-generated reply.

**No guard was weakened, no floor lowered, no `eslint-disable` added, and no gate performed or claimed.** The
dialler was deliberately NOT added to `src/server/telegram/index.ts`, whose note states there is no exported
request function that dials; keeping it out of the barrel keeps that statement true and keeps the single
import site visible.

Floor ratcheted **2193 → 2223**, the measured count.

## Spec 07 Phase 2 wave 1, batch B5 + B6 + B7 (and B2 skipped with its cost shown) — 2026-08-11

**One batch, because all four wire into the same file.** `src/server/process/main.ts` holds seams S3-S7;
doing them separately would have meant three passes over the same assembly with three chances to disagree
with each other. Nothing below performs a gate, invents a secret, weakens a guard, lowers a floor, or makes
a network call.

### B5 — real turn facts and the request planner (S5, S4)

`src/server/process/turnIntake.ts`. Before this, `readTurnFacts` returned `conservativeTurnFacts()`, so
**every turn classified `T0`, no grant was ever minted, and no model was reachable at all**. This module is
the extraction step, and the partition it draws is the load-bearing part: **three** facts are properties of
the message — the intent, whether a triggered turn is missing its subject, whether the request must enforce
structured output — and the **fourteen** others are deterministic engines' verdicts about the owner's money,
which arrive injected as the named `NO_ENGINE_VERDICTS`. Deriving `newDebt: true` from the word "loan" would
have been this tier inventing a financial judgement, and inventing it as the trigger for the tier that
carries independent review; §6's standing invariant forbids exactly that. So a turn now reaches T1, T2 and
T4 **by its intent** and reaches **T3 by no route at all** while nothing reports pressure — asserted over
the whole intent set rather than argued.

Two lexicon decisions are worth writing down because they are the invariant expressed as vocabulary. **A
balance question is deterministic**: "what is my balance" maps to `recalculate_balances`, therefore `T0`,
therefore answered by code — a model may not be asked for it. **A question about a figure is not a request
for one**: "how much is safe to spend" maps to `explain_safe_to_spend`, a conversation about a number the
engines produced. An unreadable body, a blank message and an unrecognised trigger all fail closed onto a
deterministic intent, because a mistyped command answered by a model would be a confident answer about an
operation nobody named.

**R16 was not weakened, and both directions are shown.** The classifier and the dispatcher are byte-identical
to before. `turnWorker.ts` gained one optional per-item planner hook, and it exists for a type-level reason:
`TurnFacts` carries "no figure, no free text" by the classifier's own design, so the owner's words cannot
travel to a planner through the facts and must travel with the item. The refusing direction is a
`@ts-expect-error` on `classification.modelGrant` — the deterministic branch types it `never`, so the
compiler is the guarantee and the test observes the compiler — plus runtime belts for a forged grant, a
foreign turn, an empty turn and an over-bound turn. The releasing direction plans a complete request and
opens the door with it. **24 tests.**

### B6 — the model provider module (S3)

`src/server/model/modelProvider.ts` replaced the port that threw `MODEL_PROVIDER_UNAVAILABLE` for every
request. It resolves the base from the **existing** `MODEL_API_BASE` entry with **no default**, resolves this
agent's credential through `loadAgentModelBinding` — the one loader that knows which entry belongs to which
agent, so a `finance` port cannot read `OR_KEY_LIFE` — composes the body with the privacy policy the request
type makes REQUIRED, hands the pair to an injected capability, and judges the answer.

**The reader is shared, not copied, and the extraction was necessary rather than tidy.** The task says reuse
the benchmark-path reader. It could not be imported: `liveModelCaller.isolation.test.ts` asserts that **no
runtime file under `src/server/**` imports that adapter**, because the adapter holds the developer-machine
grant and the transport seam. Writing a second reader was also refused. So the five refusals moved into
`src/features/benchmark/providerResponseReader.ts` — the part that holds no capability at all, five
judgements over a body of text — and both paths now import it. `readLiveResponse` re-raises the shared
refusal as `LiveRunError` with the same code and the same detail key, so the benchmark path's error
vocabulary is unchanged and its 41 tests were untouched. **The isolation guard is intact.**

The five, unchanged in substance: a non-success status; an unparseable body or one that is not an object; an
absent usage block or a cost that is not a non-negative safe integer of micro-USD; a substituted model; and
an unstated schema verdict read as **invalid** rather than valid. Each halts rather than degrades.

**Telemetry goes through the existing repository.** `recordTelemetry`, via an injected sink: reported cost
(integer micro-USD, `provider_reported_actual`, taken as reported and never recomputed), tokens, latency,
schema verdict, and the asserted privacy policy. **No prompt text and no completion text** — asserted by
serialising the record and searching for the fixture turn and the fixture answer. A refusal is recorded with
**zeroed** measurements: nothing was reported, so nothing is claimed. One wrinkle worth recording rather than
hiding: the port is assembled from the host **before** the boot opens the store, so the sink is *bindable* and
`main.ts` binds it through the very store factory the boot already uses. Records arriving before the bind are
**counted**, not silently dropped and not raised — losing the call because the observation could not be filed
would put the record ahead of the work.

**The dialler is its own module and the suite never invokes it.**
`src/server/model/liveModelDial.ts`, `node:https` and `node:buffer` only, **no dependency added**, following
B4's D-DIALLER precedent for the same reason: a build that needs new code written after the owner performs a
gate is not a ready build. It is the only place that composes the address and the authorization header, and
therefore the only caller of `revealModelCredential`. It holds **no policy** — no retry, no status
interpretation, no envelope reading; an absent status is reported as `0`, which the shared reader refuses.
`selectModelDial` in `main.ts` chooses it structurally when this agent's `OR_KEY_FINANCE` entry is configured
(**G4** is the whole of the condition, asked through the loader's own `describeConfiguredPresence`) and
`gatedModelDial()` otherwise, which refuses naming **G4** and **D-BENCH**. **No environment entry and no
invocation flag was added.** The live branch is proved by a `WeakSet`-backed identity marker only that module
can mint; the gated branch is invoked, because refusing is all it does.

**The provisional guard stays, and it is proved in both directions.**
`provisionalStillRefuses.test.ts` asserts what changed and what did not: a call is now *possible* — the door
reaches the port with a minted grant and returns a result — and still *not routable*, because `routeModel`
cannot name a model from a fixture-backed registry, so the wired capability records **zero** invocations and
a capability never called has spent nothing. The same registry entry routes the moment `provisional: false`,
so the cut is demonstrably the flag rather than the grades. **B8** is what moves it.

**Not tested, stated plainly.** The socket. Whether a real peer answers, times out inside the derived
deadline, or truncates at the byte bound is observable only by dialling. The first exercise of that path is
the owner's, on the host, after G4.

### B7 — deterministic answers (S6)

`src/server/process/deterministicAnswer.ts`. The route returned the turn's own correlation reference, so a
reply was a bare identifier. It now answers a **named and listed** set — exactly the six intents the
classifier routes `T0`, derived from `INTENT_FAMILY` rather than re-typed, so the list cannot drift from what
actually arrives — in one human sentence each, with one honest out-of-family sentence so the function stays
total. A `Record` over the whole intent union means a new intent cannot be added without a sentence.

**It quotes no figure.** The contract's own scope line keeps the Stage 1-4 engines out of v1.0, so where a
number would be the natural answer the sentence points at the owner-only web view instead. That is asserted,
not promised: **no sentence contains a single digit**, so a figure added later fails the suite rather than
reaching the owner as an authoritative-looking number nobody computed. The correlation reference is kept out
of the sentence deliberately — putting it in front of the owner is how the reply became an identifier in the
first place. **8 tests**, one driving a real `T0` turn through `dispatchTurn` and observing the port
untouched.

### B2 — skipped, with the cost shown

The task says to skip it if it costs anything real. It does. Its premise — that the enumerated agent set, the
per-agent entry-name resolver and the per-agent bounds already exist — is true, and they are *already used*:
`agentEntryNames`, `describeConfiguredPresence`, `loadAgentModelBinding` and `loadTelegramTransportConfig`
are all parameterised by identity today, with `FINANCE_AGENT` passed in rather than spelled inline. What is
**not** parameterised is the process's own store and volume: `FINANCE_DATA_DIR`, `FINANCE_STORE_FILE`,
`FINANCE_CONTAINER_PORT`, `FINANCE_STORE_NAME` — and **no `LIFE_*` counterpart of any of them exists**, in
`environment.ts`, in the value ledger, or in the six deployment templates. Parameterising the entrypoint
therefore means inventing four environment entries that no gate supplies and no ledger row tracks, which R23
would then have to gate, for an agent this repository never runs (option (c)). That is a new surface, not
hygiene. The property B2 existed to obtain is already in force and already tested: `agentEntryNames` refuses
an unknown identity with `ENV_AGENT_UNKNOWN` rather than defaulting it.

### Gate

`npm run verify:all -- --all` green. Floor ratcheted **2223 → 2301**, the measured count (**+78**: 24 for B5,
36 for B6's three files, 10 for the model selection, 8 for B7). No guard weakened, no `eslint-disable` added,
no gate performed or claimed. What remains between a delivered message and a model-generated reply is now
**only** the owner's: **G3** (the bot token), **G4** (the model credential) and **D-BENCH** → **B8** (one
authorised pass, a measured registry). No code change is needed when any of them lands.
