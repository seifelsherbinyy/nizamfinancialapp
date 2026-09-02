<!--
NIZAM FINANCIAL DATA MODEL vNEXT — target model and invariants, defined BEFORE any migration.
owning contract: contracts/CONTRACT_6_multicurrency_ledger_integrity.md (DRAFT)
phase: RESEARCH_COMPLETE_ARCHITECTURE_PLAN_PENDING · implementation NOT authorized
depends on: docs/architecture/CURRENT_FINANCIAL_ARCHITECTURE_GAP_ANALYSIS.md
preserves: .kiro/steering/money-rules.md (INVARIANT), drive-db.md
extends: docs/architecture/DATA_MODEL.md, docs/architecture/SYNC_AND_CONFLICTS.md
-->

# Financial Data Model — vNext

Target model for FN-YNAB-01..10. **Additive wherever possible.** Existing entities are preserved; a
single-currency EGP database must produce byte-identical numbers after migration (the same regression bar
Stage 4 already set in `netWorth.types.ts`).

Dependency direction is fixed and one-way:

```
canonical integer money  ->  deterministic finance-core  ->  derived presentation
```

Nothing downstream may flow back upstream.

## 1. Money and currency

### 1.1 Canonical form
- **M1** A monetary value is an integer count of milliunits **of its own stated currency**. Scale 1/1000, currency-independent. (money-rules 1-2.)
- **M2** `Money` remains `number` constrained to `Number.isSafeInteger`. Recommended hardening: a branded/nominal type so a formatted string can never be assigned where `Money` is expected — this makes FN-YNAB-04 unrepresentable to violate rather than merely forbidden.
- **M3** Instruments needing >3 decimals are rejected at the boundary, never truncated silently.

### 1.2 Currency carriers
Add `currency: CurrencyCode` to:

| Entity | Meaning |
|---|---|
| `Account` | the account's native denomination |
| `Transaction` | the currency the amount was actually transacted in |
| `TransactionAllocation` (splits) | inherited from parent; must equal it |
| `Asset` | already present — preserve |

`MacroContext.referenceCurrency` remains the single reporting currency (default `EGP`).

### 1.3 FX observations
`FxRate` becomes an append-only **observation series**, not a lookup row:

```
FxObservation {
  currency, perUnitNum, perUnitDen,   // integer rational — preserve existing shape
  source,                             // provenance string
  observedAt,                         // ISO DATETIME (widened from date-only)
  conversionVersion                   // bumped when rate semantics change
}
```

- **F1** Conversion uses `mulRatio()` only (already exact, BigInt, half-away-from-zero). No new arithmetic is needed.
- **F2** A converted figure is a **derived leaf** and is never persisted as canonical truth.
- **F3** Every derived figure carries provenance: source currency, target currency, `perUnitNum/Den`, `source`, `observedAt`, `conversionVersion`.
- **F4** Selection rule: the latest observation **at or before** the required instant. No interpolation, no reaching forward.
- **F5** No observation available -> the result is `unconvertible`, surfaced to the UI. Never 1:1, never nearest-future.
- **F6** Observations are append-only. A correction adds an observation.
- **F7** No LLM, benchmark or routing module may originate, choose or interpolate a rate.
- **F8** Summing amounts of differing `currency` without explicit conversion **throws**.

## 2. Postings, splits and transfers

### 2.1 Allocation sets
A split becomes a first-class, versioned **allocation set** owned by its parent:

```
TransactionAllocation { id, transactionId, allocationSetVersion,
                        categoryId, amount, memo, currency }
```

- **A1** Legs sum EXACTLY to the parent `amount` via `allocate()` (already exact).
- **A2** All legs share the parent's `currency`.
- **A3** Editing is **atomic supersession**: the prior set is marked superseded and the replacement is written in the same operation. Partial application is a defect.
- **A4** Superseded sets are retained as history and never destroyed.
- **A5** Import provenance survives supersession.

### 2.2 Transfers
- **T1** A transfer is neither spending nor income and must be excluded from both.
- **T2** Both legs carry a shared `transferGroupId` **in addition to** the existing `transferAccountId`/`transferTransactionId` pair. The existing pair is preserved for compatibility.
- **T3** Each leg carries its own `amount` + `currency`. A cross-currency transfer records both legs natively and does **not** force one into the other's currency.
- **T4** Invariant: a transfer group has exactly two live legs, or zero. **One live leg is a defect** and must be detectable by a test.
- **T5** Correction, reversal or deletion operates on the group, never on a single leg.

## 3. State axes — deliberately independent

Five orthogonal axes. Collapsing any two is a modelling error.

| Axis | Values | Notes |
|---|---|---|
| Clearance | `uncleared` -> `cleared` -> `reconciled` | already exists; `reconciled` is a **lock** |
| Approval / review | `unreviewed` / `approved` | already exists as `approved: boolean` |
| Lifecycle | `active`, `superseded`, `deleted`, `reversed`, `archived` | new |
| Import confidence | band and/or bps | exists; band never rendered as a score |
| Categorization confidence | separate from import confidence | new |

- **S1** `reconciled` is strictly stronger than `cleared`. A reconciled transaction, its allocation set and its transfer peer are immutable in place.
- **S2** Changing reconciled history requires **one** chosen workflow, and this model chooses **reversal + replacement** (append-only, audit-preserving) as the default, with `unreconcile + amend` permitted only as an explicit owner action. One of the two must be tested; both are specified so the test target is unambiguous.
- **S3** Approval is never a substitute for staging isolation.

## 4. Deletion, versioning and sync

- **D1** Every syncable entity carries `deleted: boolean` (tombstone) and `version: number` (per-entity, monotonic).
- **D2** Absence is not deletion. A tombstone is a positive fact.
- **D3** **Repair first:** the existing `merge3`/`mergeCollection` is base-aware and already correct *given a true base*. The live defect is `getBase: () => baseDb ?? db` in `src/state/store.ts` (base collapses to local when `baseDb` is null, so remote wins unconditionally and deleted rows resurrect). The base fallback must be replaced with an explicit "no base -> do not merge, treat as first pull" path. **This repair precedes tombstones and is independently valuable.**
- **D4** A monotonic cursor exposes *new / changed / superseding / deleted* since version X. Document-level `meta.revision` is retained but is not the cursor.
- **D5** A stale client must not resurrect deleted data. Required test: delete on A, merge a stale B that still holds the live row, assert still deleted and audited in `meta.conflicts`.
- **D6** The model must be consumable by web, offline/local clients, Hermes readers, recovery mirrors and a possible mobile client. Each needs deletion visibility without having held the base.
- **D7** Tombstones are retained for the life of the Profile-A store. Compaction is a separate authorized change.

## 5. Ingestion boundary

One direction only:

```
capture -> parser -> normalized candidate -> deterministic validation
        -> dedupe -> review -> canonical ledger -> reconciliation
```

- **I1** New staging collection `transactionCandidates`, structurally separate from `transactions[]`.
- **I2** A candidate is **not** financial truth: excluded from balances, budgets, forecasts, obligations, net worth, scenarios and reports.
- **I3** Promotion requires deterministic parse + validation + review. `approved` is not the isolation boundary.
- **I4** Drive, Telegram and email must never become competing ledgers. Exactly one canonical ledger exists.
- **I5** Provenance verbatim, including the existing honest `unknown` extraction method. A machine row never claims `manual`.
- **I6** No LLM output becomes a monetary value or a canonical row; it may annotate or propose only.

### 5.1 Dedupe identity
Extend the existing `ImportInfo` (preserve current fields) with: `batchId`, `contentHash`, `parserVersion`,
`sourceType`, `sourceTransactionId`, `sourceAccountId`, `statementReference`, `normalizedPayee`, `currency`.

- **X1** Duplicates must never inflate spending, income, balances, debt payments, net worth or forecasts.
- **X2** Duplicate state becomes tri-state: `unique | duplicate | ambiguous`. Ambiguous routes to review; the current boolean `is_duplicate` cannot express it.

## 6. Targets

`CategoryTarget.type` widens from 2 to the required set:

`target_balance` · `target_balance_by_date` · `monthly_funding` · `obligation_reserve` ·
`debt_reduction` · `emergency_reserve` · `sinking_fund` · `acquisition`

- **G1** `obligation_reserve` and `debt_reduction` **map onto the existing `Obligation` entity** (`amountDue`, `minimumDue`, `dueDate`, `graceDate`, `priority`, `penalty`, `interestBps`, `protectedReserve`). Map, do not duplicate — a second source of obligation truth is a defect.
- **G2** Rollover behaviour is explicit per target: `set_aside` vs `refill`. The two produce materially different funding demands.
- **G3** Derived figures — required funding, underfunded, funded amount, progress, next contribution, expected completion — are **finance-core outputs only**. No LLM authorship.
- **G4** System/internal categories must be representable and non-editable.
- **G5** `MonthCategoryBudget { assigned, activity, available }` is preserved unchanged.

## 7. Migration posture

- **P1** Additive with defaults: `currency` defaults `EGP`; `deleted` defaults `false`; `version` defaults `0`.
- **P2** `FxRate.asOf` -> `observedAt` datetime is the **only mutation of an existing field**, and therefore the highest-risk item. Migrate by widening (date -> date`T00:00:00Z`), preserving ordering.
- **P3** Reversibility is required: a v4 fixture must migrate to vNext and back with **zero monetary drift**.
- **P4** Regression bar: an existing single-currency EGP database yields byte-identical engine outputs.
- **P5** No migration runs against a real Drive document until the fixture round-trip passes.

## 8. Open items requiring an owner decision

Items 1-5 were ratified by the owner on 2026-09-02 (see `IMPLEMENTATION_PLAN.md` "Owner decisions — RESOLVED 2026-09-02" for the full disposition table; D-numbers below map to that table).

1. **RESOLVED (D2).** Uncleared balance — **derive** (`balance - clearedBalance`). No stored field exists yet; this is forward policy for when one is added.
2. **RESOLVED (D3).** Reporting amount — **derive on read**. No stored field exists yet; forward policy.
3. **RESOLVED (D1).** `FxRate.asOf` -> `observedAt` datetime — **do it**. Mutates a tracked field (P2), still the highest-risk remaining item; not yet implemented.
4. **RESOLVED (D4).** Reconciled correction workflow — **reversal + replacement** (S2). Unblocks Step 4; not yet implemented.
5. **RESOLVED (D5).** Branded `Money` type (M2) — **defer**.
6. **STILL OPEN.** Per-currency display formatting as data, extending money-rules rule 5 beyond EGP. This was NOT among the eight decisions the owner ratified on 2026-09-02 — it needs its own explicit answer before any code touches display formatting beyond EGP.
