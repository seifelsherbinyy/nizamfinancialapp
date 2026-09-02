<!--
NIZAM IMPLEMENTATION PLAN — post-YNAB architecture continuation.
phase: PLAN_APPROVED_STEP_1_IMPLEMENTED
STATUS: approved by owner 2026-09-02. Step 1 IMPLEMENTED and verified. Steps 2-7 not started.
NOTHING IN STEPS 2-7 HAS BEEN IMPLEMENTED.
owning contract: contracts/CONTRACT_6_multicurrency_ledger_integrity.md (DRAFT)
inputs: CURRENT_FINANCIAL_ARCHITECTURE_GAP_ANALYSIS.md · FINANCIAL_DATA_MODEL_VNEXT.md
        ADR-0003-post-ynab-architecture.md · UI_CONTRACT_DELTA.md
-->

# Implementation Plan — 7 steps

Ordered by dependency and by value-per-risk. **Step 1 fixes a live defect and requires no schema change**,
so it is shippable on its own. Steps 2-7 build on it.

Platform-independent by construction: every step is required under Drive-JSON, VPS+SQLite **or** Cloudflare
D1, so none of it is blocked on the unresolved AD-1 platform decision.

**Baseline established 2026-09-02 (was a prerequisite, now a fact).** `npm run verify:all -- --all`
reports **16 of 21**, not the 20/20 quoted historically. The repository baseline is NOT healthy. Every
failure was attributed before any code changed:

| Check | Cause | Attributable to this work? |
|---|---|---|
| AC18 | `ops/hermes/WHOOP_RUNBOOK.md` undeclared dotted tokens | No. Untracked owner work |
| AC04 (6 tests) | `ops/hermes/WHOOP_RUNBOOK.md` + `ops/hermes/WORKSPACE_MOUNT.md:18` | No. Same two files |
| AC12 | a premature C6 row added to `contracts/_CONTRACT_INDEX.md` | **Yes — corrected, now PASS** |
| AC14 / AC15 | 204 uncommitted entries incl. the 52 deletions | Mostly pre-existing; unpassable without a commit |

All 6 failing tests are whole-tree scanners tripping on two untracked files, not application logic.
Separately flagged to the owner: `ops/hermes/WORKSPACE_MOUNT.md:18` names the excluded classification
tier that `src/server/signals/exclusion.test.ts` forbids outside refusal tests. Not edited here.

AC12 was repaired without weakening any check: `scripts/verify/contract-ledger.mjs:13` hard-codes
`rows.length !== 5` and line 33 fails on any outstanding contract, so the unapproved C6 row was removed
from the release ledger and recorded as a draft proposal in prose instead. `node
scripts/verify/contract-ledger.mjs` now reports PASS.

---

## Step 1 — Repair the merge base fallback  ·  IMPLEMENTED 2026-09-02

**Outcome.** Done and verified. Two corrections to the plan as written:

1. There were **two** bad fallbacks with **opposite** failure modes, not one.
   - `doPush` used `baseDb ?? db`. Base = local makes `localChanged` always false, so **remote wins
     every divergence** and local edits vanish.
   - `connectDrive` used `baseDb ?? latest.db`. Base = remote makes `remoteChanged` always false, so
     **local wins every divergence** and every remote-only row is read as a local delete and dropped.
     This sits on the offline-reconnect path.
   - `hydrateFromCache` persisted the first fault via `syncPoint?.baseDb ?? db`.
2. **This is not a complete resurrection fix.** Without a base, a local deletion is
   information-theoretically indistinguishable from a row never held, so a deleted row still
   reappears. Durable deletion needs tombstones (Step 5). The limit is pinned by an explicit
   `KNOWN LIMIT until tombstones` test that Step 5 must flip, rather than left as prose.

A third suspicion was **investigated and disproved**: `SyncPoint.baseDb` persists correctly
(`localCache.ts:176` writes `KV.baseDb` from `args.db`). No defect there.

**Fix.** The honest base for "no common ancestor" is an EMPTY db, not local and not remote. Every row
on both sides then reads as an addition, the merge becomes a union, and neither side can be silently
dropped. The degraded merge is recorded in `meta.conflicts` instead of being invisible.

- **Files changed (3):** `src/lib/drive/sync.ts` (`getBase` widened to `() => NizamDb | null`; new
  exported `noCommonAncestorBase()`; `pushDb` resolves the base explicitly and audits the null case),
  `src/state/store.ts` (all three `??` substitutions removed), `src/lib/drive/sync.test.ts` (+5 tests).
- **Migration impact:** none. **Finance-core impact:** none, sync layer only.
- **Privacy/security blast radius:** none. No scope, credential or network change. `drive.file` untouched.
- **Tamper proof.** Each original defect was reintroduced and the new tests caught both, in opposite
  directions: `base ?? local` -> dropped `pay_local` (1 failed/12 passed); `base ?? first.remote.db`
  -> dropped `pay_remote` (2 failed/11 passed); restored -> 13 passed.
- **Observed verification:**
  `npm test -- --run src/lib/drive/sync.test.ts` 13 passed ·
  `npm run typecheck` clean (one error found and fixed) ·
  `npm run lint` clean at zero warnings ·
  `npm test -- --run src/lib/drive src/lib/db src/state` 32 passed ·
  `npm test -- --run` 164 passed / 2 failed (166 files) — the same 6 pre-existing failures, none new ·
  `npm run build` emitted `dist` ·
  `npm run verify:all -- --all` 16 of 21, unchanged from baseline.

## Step 1 (original plan text, retained for audit)


**Why first.** Smallest change, fixes a real reachable bug, no migration, no schema change, independently valuable.

- **Files:** `src/state/store.ts` (lines ~63, ~137 — the `getBase: () => baseDb ?? db` fallback; `baseDb` init line ~96). Possibly `src/lib/drive/sync.ts` to accept an explicit "no base" signal.
- **Migration impact:** none.
- **Finance-core impact:** none. Sync-layer only.
- **API/UI impact:** a first-pull path may need a user-visible "first sync" state instead of a silent merge.
- **Tests:** `src/lib/drive/sync.test.ts` — new case: `baseDb === null` must **not** merge-as-if-base-equals-local. Regression case: locally deleted row + remote still holding it -> stays deleted. Assert the `meta.conflicts` audit entry.
- **Privacy/security blast radius:** none. No scope, credential or network change. `drive.file` untouched.
- **Verification:** `npm test -- --run src/lib/drive/sync.test.ts` then `npm run typecheck`.

## Step 2a — Currency carriers  ·  IMPLEMENTED 2026-09-02

Step 2 was SPLIT because it contained one item that cannot proceed without owner sign-off and one
that is not safely additive. Delivered here: currency carriers (FN-YNAB-01) and a reversible
migration. Held back: see "Deferred out of Step 2a" below.

**Files (11 changed, 1 new).** New `src/lib/money/currency.ts` (`CurrencyCode`, `BASE_CURRENCY`,
`CURRENCY_CODE_PATTERN`, `isCurrencyCode`, `toCurrencyCode`). `CurrencyCode` was DISCOVERED already
declared in `features/netWorth/netWorth.types.ts`; per the audit method it was promoted to the money
core (so the ledger no longer depends on a net-worth feature module) and re-exported from its old home,
so every existing import still resolves. Then `schema.ts` (`SCHEMA_VERSION` 4->5, `zCurrencyCode`,
`zAccount.currency`, `zTransaction.currency`, `zFxRate.conversionVersion`), `accounts.types.ts`,
`transaction.types.ts`, `netWorth.types.ts`, `migrations.ts`, `state/actions.ts`,
`features/import/ledgerImport.ts`, `features/decisions/decision.logic.ts`, `features/demo/sampleData.ts`,
`features/netWorth/NetWorthView.tsx`, `server/db/repositories/fxRatesRepository.ts`.

**Non-guessing backfill.** The migration takes the currency from the store's OWN `meta.currency`
(persisted and defaulted to `EGP` since v1), not from a hardcoded constant. A test proves it: set
`meta.currency = 'SAR'` and every row migrates to SAR. Production writes resolve a transaction's
currency from ITS ACCOUNT via `accountCurrency()`, which throws rather than defaulting.

**Cross-currency transfers are refused, not faked.** `addTransfer` now throws when the two accounts
differ in currency, because a single `input.amount` cannot honestly describe both legs until per-leg
amounts land (vNext T3, Step 4). Silence here would have mis-stated money.

**Reversibility (vNext P3).** New exported `downgradeV5toV4()`, deliberately outside the forward-only
`migrate` chain. It strips only the v5 additions, and REFUSES with an error if any row carries a
currency other than the store currency, because v4 cannot represent a second currency and dropping
one would misstate money.

**Tamper proof — and a CORRECTION to this plan.** The tamper target originally listed for Step 2
("change one milliunit in the v4 fixture") would have proved NOTHING: both sides of the drift
comparison are built from the same fixture function, so mutating it moves both and the test still
passes. The valid tamper is to break the MIGRATION. Making `migrateV4toV5` add 1 milliunit to a
balance failed both drift assertions (`1234567` -> `1234568`, 2 failed / 9 passed); restored -> 11 passed.

**Observed verification:** `npm run typecheck` clean · `npm run lint` clean at zero warnings ·
`npm test -- --run src/lib/db/migrations.test.ts` 11 passed ·
`npm test -- --run src/lib/db src/lib/money src/lib/drive` 62 passed ·
`npm test -- --run` 2691 passed / 6 failed (2697 total, up from 2685) — the same 6 pre-existing
failures, none new · `npm run build` emitted `dist` · `npm run verify:all -- --all` **17 of 21**.

**Two self-inflicted gate regressions were caught and fixed, not hidden.** An intermediate gate run
reported 15 of 21: AC03 (13 `@typescript-eslint/no-explicit-any` errors in the tests I had just
appended — I had run lint BEFORE appending them) and AC10 (`currency.ts` header did not match the
`/contract\s*\d/` and `/phase\s*\d/` patterns the check requires). Both fixed at source. No check
was edited.

### Deferred out of Step 2a, deliberately

| Item | Why it is held |
|---|---|
| `FxRate.asOf` -> `observedAt` datetime | The only MUTATION of an existing tracked field. Needs owner sign-off (vNext P2). `asOf` is untouched and a test pins it as still date-only. |
| Tombstones (`deleted`) and per-entity `version` | Belong with Step 5, which implements the merge that consumes them. Landing them unused invites a half-enforced invariant. |
| `TARGET_TYPES` widening 2 -> 8 | **NOT safely additive.** `budget.logic.ts:369` branches `if (target.type === 'monthly')` and treats everything else as `target_by_date`, so 6 new types would silently get wrong funding math. Requires fail-loud exhaustiveness, which belongs with the Step 7 engine. |
| Allocation-set `currency` | Step 4. Storing it on splits while it "must equal the parent" creates a second source of truth. |

## Step 2b — Schema vNext, remaining items (NOT STARTED, BLOCKED)

Step 2a delivered `SCHEMA_VERSION 5`, `currency` on accounts and transactions, `FxRate.conversionVersion`,
the v4->v5 migration and the v5->v4 downgrade. What follows is only what Step 2a deliberately did **not** do.
The original Step 2 text is superseded by this section and by the Step 2a record above.

- **Blocked on:** owner decision 1 (`FxRate.asOf` -> `observedAt` datetime). This is the only field *mutation*
  in the vNext model, so it cannot be taken on builder judgement.
- **Remaining files:** `src/features/netWorth/netWorth.types.ts` + `src/lib/db/schema.ts` (`asOf` -> `observedAt`,
  widen `YYYY-MM-DD` -> `...T00:00:00Z` preserving order, `SCHEMA_VERSION 5 -> 6`, `migrateV5toV6`),
  `src/features/budget/budget.types.ts` (`TARGET_TYPES` 2 -> 8 + rollover) **only together with the Step 7
  fail-loud exhaustiveness**, `src/features/transactions/transaction.types.ts` (`deleted`, `version`) **only
  together with the Step 5 merge that consumes them**.
- **Migration impact:** the `asOf` rename is the highest-risk single edit in the whole plan: it is the one
  change that rewrites an existing tracked field rather than adding one. It needs its own migration version,
  its own downgrade, and an order-preservation test.
- **Finance-core impact:** none intended. Regression bar unchanged: a single-currency EGP database must produce
  byte-identical engine outputs.
- **API/UI impact:** none yet; fields land unused until Steps 4, 5 and 7.
- **Tests:** extend `src/lib/db/migrations.test.ts` — v5 fixture -> v6 **and back** with zero monetary drift and
  zero ordering change across `observedAt`; the existing `asOf`-is-date-only pin must be *replaced*, not deleted,
  by an `observedAt`-is-datetime pin.
- **Privacy/security blast radius:** schema shape only. No new data category, no secret, no scope change.
- **Verification:** `npm test -- --run src/lib/db` then `npm run typecheck` then `npm run build`.

## Step 3 — FX derivation with provenance  ·  IMPLEMENTED 2026-09-02

**The plan called this a new module. The audit found it was mostly already there, so it became a
repair.** `DISCOVER EXISTING` results, with labels:

| Finding | Label | Disposition |
|---|---|---|
| `netWorth.ts:26-45` already held `toEgp` / `fromEgp` / `convert`, already on `mulRatio` | FACT | **PRESERVED.** No FX arithmetic was rewritten. |
| `FxRate.asOf` was stored but **never read** — `fx.find((r) => r.currency === from)` ignored the date | FACT | **REPAIRED.** `selectObservation` now reads it. |
| `sync.ts:153` keys `fxRates` by `(r) => r.currency`, and `NetWorthView.tsx:225-227` overwrites by currency, so the store holds **one observation per currency — no time series exists** | FACT | Selection is written to be correct on a time series but returns today's answer unchanged on a one-row table. Giving `fxRates` a real history means changing its merge identity, which is a Step 5 change, not this one. |
| `convert()` was `fromEgp(toEgp(x))`, so non-EGP -> non-EGP **rounded twice** | FACT | **REPAIRED.** One composed integer ratio, one rounding. |
| `convert()` has **zero production callers** (only its own test) | FACT | The repair could not change any existing output. |
| No `unconvertible` result; a missing rate could only throw | MISSING | **CREATED.** |
| Nothing stopped a caller adding two currencies together | MISSING | **CREATED** (`sumSameCurrency`). |

### What landed

- **New `src/lib/money/fx.ts`** (365 lines) — the single FX code path. `selectObservation` (newest
  observation at or before a date, or newest overall when no date is asked for), `convertMoney`
  returning `Converted | Unconvertible`, `describeUnconvertible`, `sumSameCurrency`, and a
  `RateProvenance` envelope carrying source, date, `conversionVersion` and the ratio actually applied.
  Five refusal reasons: `no_observation`, `no_observation_at_or_before`, `ambiguous_observation`,
  `non_positive_rate`, `ratio_not_representable`.
- **`src/features/netWorth/netWorth.ts`** — `toEgp` / `fromEgp` / `convert` are now thin throwing
  adapters over `convertMoney`. Signatures unchanged; the thrown message still contains `no FX rate`
  so the existing assertion keeps holding.
- **`src/lib/money/fx.test.ts`** (266 lines, 27 tests).

### Decisions taken inside this step, and why

- **No second arithmetic path.** `fx.ts` calls `mulRatio` and writes no rounding of its own. This is the
  correction already recorded against Contract 6 sections I2.2/I2.3.
- **`asOf === null` means "newest"**, which is exactly what the old code did. A caller that does not ask
  for a date gets the previous number, so no existing figure moved. Date selection is opt-in.
- **Same-day disagreement is refused, not resolved.** Two rows sharing the newest date with different
  ratios have no defined ordering under a date-only stamp, so `ambiguous_observation` is returned rather
  than picking by array order (which the merge does not even fix). Identical same-day rows from two
  sources are treated as a duplicate and accepted. This is what makes the date-only limit visible instead
  of silently wrong, and it is the argument for the Step 2b `observedAt` widening.
- **A zero or negative rate is refused, never inverted.**
- **A composed cross-rate that will not reduce into a safe integer ratio is refused**, because
  approximating it would invent precision.
- **An empty `sumSameCurrency` demands an explicit currency.** A currency-less zero is wrong the moment
  something adds it to a real figure.
- **`netWorth(db, ref)` still throws when the reference currency is unrated.** Left as-is deliberately:
  labelling EGP figures as USD, or zeroing them, would both be lies. Rendering a partially expressible
  net worth is a UI decision (Step 4 / UI delta section 4.1), not a silent default.

### Verification actually run

- `npm test -- --run src/features/netWorth src/lib/money` — **5 files, 73 tests passed.**
- `npm test -- --run` (whole repository) — **2718 passed / 6 failed of 2724**, 165 of 167 files. The 6
  failures are the pre-existing `ops/hermes/` ones present before any of this work; the count rose from
  2697 by exactly the 27 new FX tests. `npm run build` — succeeded.
- `npm run typecheck` — clean. `npm run lint` — clean at `--max-warnings 0`.
- `npm run verify:all -- --all` — **17 of 21**, unchanged from the pre-Step-3 baseline. The four failures
  are AC18 and AC04 (both caused by `ops/hermes/`, untracked owner work) and AC14/AC15 (a dirty tree, which
  needs a commit). Nothing attributable to this step fails.

**Regression evidence, stated precisely.** `src/features/netWorth/netWorth.test.ts` (13 tests) had **no
assertion changed by Step 3**; its only difference from `HEAD` is two mechanical field additions made back
in Step 2a (`currency: 'EGP'` on an account fixture, `conversionVersion: 0` on the FX fixture). Its
conversion values and its `/no FX rate/i` refusal assertion are the originals and still pass, which is what
demonstrates that delegating produced no change in any existing answer. An earlier draft of this record
called the file "completely unmodified", which was wrong, and is corrected here rather than left standing.

### Negative controls (the plan's Step 3 tamper, replaced with two stronger ones)

The plan proposed "replace an exact ratio with a rounded one". That was dropped because the suite already
contains the stronger version permanently: the cross-rate tests compute the **old** base-routed answer from
primitives in the same run and assert it differs. Two mutation runs were then done, each restoring the file
in the same command:

1. Cross path substituted with the pre-repair `fromEgp(toEgp(x))` — **2 failed / 25 passed**:
   `expected 1001 to be 1000` (two currencies on the same rate must convert 1:1) and
   `expected 912 to be 911` (USD->SAR on 49.25 / 13.13 at 243 milliunits). Restored.
2. `asOf` filter removed, reproducing the old match-by-currency-only behaviour — **3 failed / 24 passed**:
   `expected '2026-06-01' to be '2026-01-01'`, `expected 5000000 to be 4900000`, and the
   reach-forward refusal. Restored.

Both confirm the assertions are load-bearing rather than decorative. No acceptance check was touched.

### Known limits carried forward

- **`fxRates` still has no history.** Until its merge identity changes, `asOf` selection has exactly one
  row to choose from per currency. The selection logic is correct and forward-compatible; the storage is
  not yet there. Step 5.
- **Date-only resolution.** Two rates on one day cannot be ordered, so they are refused. Step 2b.

## Step 3 (original plan text, retained for audit)

- **Files:** new `src/lib/money/fx.ts`; `src/features/netWorth/` consumers.
- **Migration impact:** none (consumes Step 2 fields).
- **Finance-core impact:** additive and **reuses existing `mulRatio()`** — no new arithmetic is written. Adds: latest-observation-at-or-before selection, `unconvertible` result, mixed-currency sum guard, provenance envelope.
- **API/UI impact:** conversions must return provenance for disclosure (UI delta §4.1).
- **Tests:** new `src/lib/money/fx.test.ts` — no float path; deterministic rounding; exact round-trip on exact ratios; **throws** on mixed-currency sum; **`unconvertible`** on missing/stale observation, never 1:1; no reaching forward to a future rate.
- **Privacy/security blast radius:** none. Rates are owner-entered or deterministically imported; no network call, no LLM in the path.
- **Verification:** `npm test -- --run src/lib/money` then `npm run typecheck`.

## Step 4 — Versioned allocation sets + reconciled lock

- **Files:** `src/features/transactions/transaction.types.ts`, transaction mutation paths in `src/state/actions.ts`, `src/features/reconciliation/*`.
- **Migration impact:** existing embedded `splits` become allocation-set version 0. Additive.
- **Finance-core impact:** allocation sum enforced via existing `allocate()`. Reconciled records become immutable in place; corrections flow through reversal + replacement (vNext §S2 default — needs owner confirmation).
- **API/UI impact:** C4 Phase 4.5 needs visible history; Phase 4.6 needs the correction workflow.
- **Tests:** legs sum exactly to parent (property test); edit is atomic — a failed write leaves neither old nor partial state; superseded sets retrievable; mutating a `reconciled` parent is **rejected**; transfer peer never left stale.
- **Privacy/security blast radius:** retained history increases stored data volume; no new data category. Redaction of `accountIdentifier` must hold in history views.
- **Verification:** `npm test -- --run src/features/transactions src/features/reconciliation`.

## Step 5 — Tombstone-aware merge + cursor

- **Files:** `src/lib/drive/sync.ts` (`mergeCollection`, `merge3`), `src/lib/db/localCache.ts`, `src/state/store.ts`.
- **Migration impact:** consumes Step 2 tombstones; no new migration.
- **Finance-core impact:** none. Deleted and superseded entities must be excluded from every engine input.
- **API/UI impact:** a cursor read surface for Hermes/mirror clients; deletions become visible to clients that never held a base.
- **Tests:** **the resurrection test is mandatory** — delete on A, merge a stale B holding the live row, assert still deleted **and** audited. Cursor returns new/changed/superseding/deleted since version X. Offline dirty-queue path preserves tombstones.
- **Privacy/security blast radius:** tombstones retain the fact that a record existed. That is intended (audit) and must be stated; it is not a leak, but it is a retention decision.
- **Verification:** `npm test -- --run src/lib/drive src/lib/db` then `npm run build`.

## Step 6 — Candidate staging tier + dedupe identity  ·  IMPLEMENTED 2026-09-02

### Audit (DISCOVER EXISTING)

| Finding | Label | Disposition |
|---|---|---|
| `ImportInfo` already on `Transaction` with 6 fields | FACT | **PRESERVED.** New fields are additive-optional. |
| `LedgerRow.is_duplicate: boolean` already exists | FACT | **PRESERVED.** Maps to tri-state at the type level; no stored rows changed. |
| `importLedger()` writes directly to `db.transactions[]` — no staging tier | FACT | **OUT OF SCOPE.** Routing change requires UI support. This step builds the receptacle only. |
| No `transactionCandidates` collection, no `DuplicateStatus`, no `TransactionCandidate` type | MISSING | **CREATED.** |

### What landed

- **`src/lib/ledger/ledger.types.ts`** — `DUPLICATE_STATUSES` + `DuplicateStatus = 'unique' | 'duplicate' | 'ambiguous'`.
- **`src/features/transactions/transaction.types.ts`** — `ImportInfo` extended with 8 optional fields:
  `batchId`, `contentHash`, `parserVersion`, `sourceType`, `sourceTransactionId`, `sourceAccountId`,
  `statementReference`, `normalizedPayee`. Optional = backward-compatible; pre-Step-6 rows still parse.
- **`src/lib/db/schema.ts`** — `TransactionCandidate extends Transaction { duplicateStatus }`,
  `zTransactionCandidate`, `NizamDb.transactionCandidates: TransactionCandidate[]`, `SCHEMA_VERSION 5→6`.
- **`src/lib/db/migrations.ts`** — `migrateV5toV6` (additive: injects `transactionCandidates: []`) +
  `downgradeV6toV5` (drops the collection, refuses if non-empty so no silent data loss).
- **`src/lib/db/localCache.ts`** — KV key `transactionCandidates` added; write and read paths updated.
- **`src/lib/drive/sync.ts`** — merge result carries `local.transactionCandidates` (candidates are
  device-local; they are not synced to Drive).
- **`src/lib/db/migrations.test.ts`** — 7 new tests; also corrected 2 Step 2a tests that pinned
  intermediate schema version 5 (correct fix: pin `SCHEMA_VERSION` and add two-step downgrade chain).

### Exclusion guarantee

The separation is **structural**: all engine functions read `db.transactions[]`. Nothing reads
`db.transactionCandidates`. The test verifies this behaviourally with a 999,000,000 milliunit
candidate — if any engine looked at it, the figure would change by ~1000 EGP, which is visible.

### Scope boundary held

- `importLedger()` continues to write to `db.transactions[]`. Routing new rows to the staging tier
  requires a review queue UI and is a separate step.
- The Telegram / SMS / email intake boundary is also deferred (Step 6 in the original plan text
  references it but it is part of the routing behavior, not the schema).

### Broken tests repaired (not weakened)

Two Step 2a tests had `expect(db.schemaVersion).toBe(5)`. After Step 6, `migrate()` advances to v6,
so those assertions were factually wrong. Fixes: (1) `toBe(SCHEMA_VERSION)` for the currency test,
which was never about the schema version number; (2) two-step downgrade `v6→v5→v4` for the
round-trip test, which still proves the same invariant (zero monetary drift, shape restored).

### Verification

- `npm test -- --run src/lib/db/migrations.test.ts` — **18 passed / 0 failed**.
- `npm test -- --run` (whole repository) — **2725 passed / 6 failed of 2731** (up 7 from Step 3;
  the 6 failures are pre-existing `ops/hermes/` ones).
- `npm run typecheck` — clean. `npm run lint --max-warnings 0` — clean.

### Negative control (Step 6 tamper)

Injected a candidate-amount leak into `netWorth()` (`cashEgp` sums `transactionCandidates` as well
as canonical accounts). Result: **1 failed / 17 passed** — `expected 999000000 to be +0`. File
restored in the same command (`ORIGINAL_BACK` confirmed). The exclusion assertion is load-bearing.

## Step 6 (original plan text, retained for audit)

- **Files:** `src/lib/db/schema.ts` (`transactionCandidates`), `src/lib/ledger/ledger.types.ts` (extend `ImportInfo`: `batchId`, `contentHash`, `parserVersion`, `sourceType`, `sourceTransactionId`, `sourceAccountId`, `statementReference`, `normalizedPayee`, `currency`; duplicate state -> `unique | duplicate | ambiguous`), `src/features/import/*`, `src/server/telegram/*` boundary.
- **Migration impact:** new empty collection + additive `ImportInfo` fields. Existing `is_duplicate` boolean maps to the tri-state.
- **Finance-core impact:** **candidates must be excluded** from balances, budgets, forecasts, obligations, net worth, scenarios and reports. This exclusion is the load-bearing assertion.
- **API/UI impact:** new review queue (UI delta §4.1); candidates visually impossible to mistake for canonical.
- **Tests:** a candidate never affects any engine output; duplicates never inflate spending/income/balances/debt/net worth/forecasts; ambiguous routes to review; a machine-extracted row never claims `manual`; Telegram input cannot reach `transactions[]` without passing validation + review.
- **Privacy/security blast radius:** **the largest of any step.** Telegram/email/SMS intake touches message content. Candidates must carry redaction from first write, secrets never enter the store, and no real ledger or identifier may appear in fixtures.
- **Verification:** `npm test -- --run src/features/import src/lib/ledger` then `npm run verify:all -- --all`.

## Step 7 — Target funding engine + repository gate  ·  IMPLEMENTED 2026-09-02

### Audit table

| Finding | Label | Disposition |
|---|---|---|
| `TARGET_TYPES = ['monthly','target_by_date']` (2 types) | FACT | **EXTENDED** to 8 canonical names |
| `budget.logic.ts:369` — `if (type === 'monthly')`, everything else treated as `target_by_date` | FACT | **REPAIRED** — total compile-time family dispatch; a new type without math is a compile error |
| `Math.ceil(remaining / monthsLeft)` — float divide on money | FACT | **REPAIRED** — new `divCeil(a, den)` with BigInt intermediate |
| `targetMonth ? monthsBetween(...) : 1` — silent fallback | FACT | **REPAIRED** — zod refuses the shape; engine throws on null-month by-date target |
| `Obligation` with all obligation fields already present | FACT | **MAPPED ONTO** — G1 honoured; no second source of obligation truth |
| `fundingAmount(o)` already returns the tier-correct demand | FACT | **REUSED** verbatim |
| `reserveFor(o)` and safe-to-spend use | FACT | **PRESERVED** untouched; double-count guarded by `obligationTargetReconciliation` |
| rollover `set_aside` vs `refill` | MISSING | **CREATED** — two materially different demands proven by test |
| funded amount, next contribution, expected completion | MISSING | **CREATED** |
| GoalProgress adapter signature | FACT | **PRESERVED** — thin adapter over new engine; all 3 field meanings unchanged |

### What landed

**New files:**
- `src/features/budget/month.ts` (66 lines) — month arithmetic extracted from `budget.logic.ts` so the engine can use it without a cycle; byte-identical in behaviour; re-exported from the original home.
- `src/features/budget/targets.ts` (342 lines) — the funding engine: `targetFunding()` (fail-loud family dispatch, `TARGET_FAMILY` total map), `obligationTargetReconciliation()` (double-count guard).
- `src/lib/money/money.ts` — `divCeil(a, den)` BigInt ceiling divide (+27 lines).
- `src/features/budget/targets.test.ts` (388 lines, 31 tests).

**Changed files:**
- `budget.types.ts` — `TARGET_TYPES` widened 2→8; `ROLLOVER_BEHAVIOURS`; `TARGET_FAMILY` total map; `requiresTargetMonth()`, `requiresObligation()` guards; `CategoryTarget.{rollover, obligationId}`.
- `budget.logic.ts` — month utilities replaced by re-export from `month.ts`; `goalProgress()` is now a thin adapter (binary branch deleted, float divide deleted).
- `BudgetView.tsx` — 8-type editor, rollover control, obligation link, family-aware `GoalBadge`.
- `schema.ts` — `SCHEMA_VERSION 6→7`; `zTarget` widened with conditional requirements (shape enforced at load time).
- `migrations.ts` — `migrateV6toV7` (renames `monthly→monthly_funding`, `target_by_date→target_balance_by_date`; adds rollover/obligationId defaults; converts targetless `target_by_date` to `target_balance`); refusing `downgradeV7toV6` (5 v7-only types refused); chain step added.
- `migrations.test.ts` — 7 new migration tests (now 25 total); v5→v6 pin corrected from `schemaVersion === 6` to `SCHEMA_VERSION`.
- `budget.logic.test.ts` / `BudgetView.test.tsx` — 4 legacy type literals renamed; no assertion changed.

### Key design decisions

1. **Total map, not a catch-all.** `TARGET_FAMILY: Record<TargetType, TargetFamily>` makes a new type without math a compile error. The old `if (type === 'monthly') ... else ...` gave 6 new types silently wrong math; that defect is now architecturally impossible.
2. **`per_month` monthlyRate = requiredFunding**, not `schedule(underfunded, month, month)`. The recurring demand is the target amount; `nextContribution = min(monthlyRate, underfunded)` gives the correct "assign now" figure without conflating the two.
3. **G1 strictly enforced.** `obligation_reserve` and `debt_reduction` ignore `target.amount` entirely; `requiredFunding` is sourced only from the linked `Obligation` via `fundingAmount()`. A test proves `debt_reduction.requiredFunding > obligation_reserve.requiredFunding` (they differ materially).
4. **`target_balance` is NOT v7-only.** It is `target_by_date` with null targetMonth expressed honestly; it round-trips to/from v6 losslessly via `target_by_date`. This keeps the downgrade from refusing a shape that was already valid in v6.

### Verification actually run (2026-09-02)

```
npx tsc --noEmit   → TSC_EXIT=0  (clean after fix of 12 legacy-literal errors)
npm run lint       → LINT_EXIT=0 (clean after removing unused CategoryFundingState import)
npm test targets.test.ts          → 31/31 passed
npm test migrations.test.ts       → 25/25 passed
npm test budget.logic.test.ts     → 19/19 passed
npm test BudgetView.test.tsx      → 9/9 passed
npm run verify:all -- --all       → 17/21; same 4 pre-existing failures, 0 regressions
  test count: 2777 total, 2771 passed (+46 from baseline 2731)
```

### Negative control (tamper discipline — Step 7 row)

Understate a `target_balance_by_date` amount: `EGP(100) → EGP(50)` in the `underfunded` assertion test.
Result: **1 failed / 30 passed** — `expected 40000 to be 90000`. The underfunded assertion is load-bearing.
Restored: `EGP(100)` back; confirmed 31/31 pass.

### Known limits

- `goalProgress()` adapter does not forward obligation context. Call `targetFunding()` directly for `obligation_reserve` / `debt_reduction` categories that need `GoalProgress`-style output.
- Schema v7 `zTarget` conditional enforcement means a pre-existing store with a malformed target will fail validation on load; this is intentional (refuse bad data loudly) but may surface on a dirty real store if one exists.
- Step 2b (`FxRate.observedAt` datetime, tombstones) is still BLOCKED on owner decision 1.

---

## Tamper discipline (applies to every step)

Per the mandate: a test only watched pass is unproven. For each step, at least one **financially
consequential** fixture will be deliberately altered so its test **fails**, the failure shown, the fixture
restored, and the passing output shown. Candidate tamper targets:

| Step | Tamper target |
|---|---|
| 1 | flip the stale-peer fixture so the deleted row returns — resurrection test must fail |
| 2a | ~~change one milliunit in the v4 fixture~~ — **invalid, corrected 2026-09-02:** both sides of the drift comparison derive from the same fixture function, so that edit proves nothing. Valid target used: break `migrateV4toV5` itself (+1 milliunit on a balance) — both drift assertions failed. |
| 3 | replace an exact ratio with a rounded one — determinism assertion must fail |
| 4 | make split legs sum to parent ± 1 — exact-sum assertion must fail |
| 5 | drop a tombstone during merge — resurrection assertion must fail |
| 6 | mark a duplicate as unique — inflation assertion must fail |
| 7 | understate a target amount — underfunded assertion must fail |

No acceptance check will be weakened, skipped or edited to make a step pass.

## Blocked / not authorized

- **AD-1 Cloudflare Workers + D1** — RESOLVED 2026-09-02 as D7: hybrid. Workers may serve as a stateless edge/ingestion layer (e.g. for Telegram/SMS); Drive/SQLite remains the canonical store per `tech.md`/`drive-db.md`; ADR-0001 is NOT superseded. A companion requirement (Hermes daily transaction capture) is new scope awaiting a governing contract — see D7 above.
- **Cloudflare credentials** — `cloudflare-dns.md` records a disclosed token with rotation DEFERRED (D-ROTATE) and forbids unilateral rotation. Untouched. Not part of D7's ruling.
- **52 deleted tracked files** — RESOLVED 2026-09-02 as D6-B: intentional, committed (`f2db9ee`, `e418825`). `.kiro/specs` and `.kiro/steering` remain deleted; if a later step needs them restored, that is a new owner decision, not implied by D6.
- **G1-G8 gates, commits, pushes, deployments** — none performed, none planned without explicit authorization.

## Owner decisions — RESOLVED 2026-09-02

All eight decisions below were ratified by the owner on 2026-09-02 and are binding.

| # | Decision | Answer | Disposition |
|---|---|---|---|
| D1 | `FxRate.asOf` -> `observedAt` datetime mutation (AD-3) | **A — do it** | Unblocks Step 2b (`SCHEMA_VERSION 7->8`). Not yet implemented — highest-risk remaining item, full negative-control discipline required before touching Drive. |
| D2 | Uncleared balance: derive vs store | **A — derive** (`balance - clearedBalance`) | No stored field exists today; recorded as forward policy for when such a field is added. |
| D3 | Reporting amount: derive-on-read vs cache | **A — derive on read** | No stored field exists today; recorded as forward policy. |
| D4 | Reconciled correction workflow | **A — reversal + replacement** | Unblocks Step 4. Not yet implemented. |
| D5 | Branded `Money` type | **B — defer** | No action. |
| D6 | 52 working-tree deletions | **B — confirm intentional** | Committed `f2db9ee` (51 files under `.kiro/` + kickoff files) and `e418825` (`ops/GATE_REGISTER.md`). |
| D7 | AD-1: Cloudflare Workers + D1 platform ruling | **C — hybrid** (Workers as stateless edge/ingestion; Drive/SQLite stays canonical, ADR-0001 not superseded) **plus** a new requirement: Hermes must proactively ask for and capture daily transactional information | Hybrid ruling recorded here. The daily-capture requirement is new scope with no governing contract yet — per AGENTS.md, a contract/spec addendum must be authored before any implementation. Not started. |
| D8 | Repair `ops/hermes/WORKSPACE_MOUNT.md:18` + declare the WHOOP runbook's legitimate dotted tokens | **A — fix it**, and the owner granted full authorization to operate on their behalf for proper completion | Done. `WORKSPACE_MOUNT.md:18` redacted (no longer names the excluded classification tier contiguously). `deploymentParticulars.ts` `DECLARED_DOTTED_TOKENS` extended. `ops/hermes/WHOOP_RUNBOOK.md` real IP/hostname/client_id/user_id/loopback-port particulars placeholder-ized into the repo's standard `<ANGLE_BRACKET>` convention (required for AC18/AC04 to pass; discovered once the dotted-token fix surfaced the underlying particulars). Verified: `tsc --noEmit`, lint, full suite (2777/2777), `vite build` all green. Committed `32aaa2e` (amended `3861fe3` to also repair a pre-existing UTF-8 double-encoding defect — `§`/`·` mojibake — found in the same file while verifying). `ops/hermes/` itself remains untracked by git; only the pre-existing tracked file (`deploymentParticulars.ts`) was committed.

Steps 1 and 2a needed none of these and are implemented. Step 3 needs none of these either: it can be built against the existing date-only `asOf` with the resolution limit documented, so it was the next unblocked step at the time. D1/D4 now unblock Step 2b and Step 4 respectively.
