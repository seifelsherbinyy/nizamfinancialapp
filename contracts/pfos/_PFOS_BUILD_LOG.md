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
