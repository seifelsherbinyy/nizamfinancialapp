<!-- NIZAM BUILD CONTRACT — machine+human readable. KIRO: execute phases in order, loop each phase to a GREEN gate before advancing (see contracts/_KIRO_LOOP_PROTOCOL.md). Honor .kiro/steering/*. -->
# Contract 6 — Multi-currency, Ledger Integrity & Ingestion Boundary (C2/C3 delta)

- **id:** C6 · **depends on:** C1 (money core), C2 (Drive data layer), C3 (budget engine) · **produces:** a multi-currency-capable, tombstoned, version-audited ledger and a hardened ingestion boundary
- **spec:** `.kiro/specs/02-drive-data-layer/`, `.kiro/specs/03-budget-engine/` (delta; no new spec directory)
- **steering:** `money-rules.md` (INVARIANT), `drive-db.md`, `product.md`, `tech.md`
- **status:** DRAFT — authored for owner review. **No implementation authorized by this document.**
- **evidence base:** `docs/research/2026-09-02-ynab-live-product-teardown.md` (owning contract C4)
- **owner decisions ratified:** 2026-09-02 (multi-currency YES; ingestion file/manual authoritative; reject YNAB's split-edit limitation)

## 0. Relationship to existing authority

This contract **extends and never contradicts** `.kiro/steering/money-rules.md`. Rules 1-4 and 6 of that
file are carried through unchanged and are restated here as C6 invariants. Rule 5 (display) assumes a
single EGP presentation and is **widened**, not replaced: EGP remains the default and base currency.

`drive-db.md` defines the canonical store (one `nizam_db.json`, atomic writes, dated snapshots, 3-way
merge with `meta.conflicts` audit, Dexie mirror with a dirty queue). C6 adds tombstone and per-entity
version semantics **inside** that model. It does not introduce a new store, a new scope, or a server.
`drive.file` remains the only scope. Drive continues to hold encrypted data only, never keys.

Per `product.md`, v1 non-goals are multi-user, SaaS, regulated advice and open-banking. Multi-currency
is **not** a non-goal and is therefore in scope. Per `tech.md` D1, this Drive-JSON store is the
Profile-A build; C6 must not assume it is the final database.

### 0.1 What is already compliant and MUST NOT be rebuilt

Verified against live code on 2026-09-02. These are already correct and are in scope only for regression
protection:

| Fact | Location |
|---|---|
| Money is integer milliunits; zod guards integrality | `src/lib/money/money.ts`, `zMoney` in `src/lib/db/schema.ts` |
| Exact-sum allocation (largest remainder) | `allocate()` in `src/lib/money/money.ts` |
| Clearance is a 3-state enum incl. `reconciled` | `CLEARED_STATUSES` in `transaction.types.ts` |
| `approved` is an axis independent of clearance | `Transaction.approved` |
| Transfers are linked postings | `transferAccountId` + `transferTransactionId` |
| Import dedupe metadata is first-class | `ImportInfo` incl. `duplicateKey` |
| FX ratios are integer rationals, not floats | `FxRate { perUnitNum, perUnitDen, source, asOf }` |
| A monotonic sync counter exists | `meta.revision` |
| **Ratio multiplication already uses a BigInt intermediate and half-away-from-zero rounding.** C6 adds NO new arithmetic here and MUST reuse it. | `mulRatio(a, num, den)` in `src/lib/money/money.ts` |
| **The 3-way merge is genuinely base-aware**: given a true base it drops locally deleted rows and audits edit/delete divergence into `meta.conflicts`. The defect was an absent base, not the algorithm; repaired 2026-09-02 via `noCommonAncestorBase()`. | `mergeCollection` / `pushDb` in `src/lib/drive/sync.ts` |

## 1. Multi-currency invariants

- **I1.1** Every monetary amount is an integer count of milliunits **of its own stated currency**. The
  1/1000 scale is fixed and currency-independent. (Extends money-rules 1-2.)
- **I1.2** `Account` and `Transaction` MUST each carry an explicit `currency` (ISO 4217). Absence is not
  permitted; migration defaults existing rows to `'EGP'`.
- **I1.3** The base/reporting currency is `MacroContext.referenceCurrency` (default `EGP`). Base-currency
  figures are **derived leaf outputs**. They are never canonical, never inputs to further arithmetic,
  and never persisted as truth.
- **I1.4** A transaction's `amount` and `currency` are immutable facts of record. A conversion never
  rewrites them.
- **I1.5** Instruments requiring more than 3 decimal places (e.g. crypto) are **out of scope** and MUST
  be rejected at the boundary rather than silently truncated.
- **I1.6** Mixed-currency arithmetic without an explicit conversion is a defect. Summing amounts of
  differing `currency` MUST throw, not coerce.

## 2. FX derivation rules

- **I2.1** Conversion uses only the integer rational `perUnitNum / perUnitDen`. No float appears in any
  conversion path.
- **I2.2** The intermediate product MUST be computed in `BigInt`. `Money` is a float64 holding a safe
  integer (cap 2^53-1); `amount * perUnitNum` can exceed that cap for plausible values, so native
  multiplication is prohibited. The result is narrowed back to a safe integer and asserted.
  **Correction (2026-09-02): this is ALREADY satisfied by `mulRatio()` in `src/lib/money/money.ts`.**
  An earlier draft of this contract wrongly presented it as new work. C6 MUST reuse `mulRatio()` and
  MUST NOT write a second ratio-multiplication path; the requirement here is regression protection.
- **I2.3** Rounding is deterministic and matches the existing boundary convention in
  `money.ts::fromDecimal` (half away from zero). **Correction (2026-09-02): `mulRatio()` already
  implements half-away-from-zero explicitly.** The open requirement is only that a conversion helper
  states which convention it relies on, so it is not inherited by accident.
- **I2.4** Every derived base-currency figure MUST be accompanied by provenance: source currency,
  target currency, `perUnitNum`, `perUnitDen`, FX `source`, FX observation instant, and
  `conversionVersion`. A converted number presented without provenance is a defect.
- **I2.5** `FxRate.asOf` is currently `zIsoDate` (date only) and MUST widen to an ISO **datetime**. Date
  granularity cannot distinguish two observations in one day, which is material for EGP.
- **I2.6** FX observations are append-only. Correcting a rate adds an observation; it never edits one.
- **I2.7** No LLM, benchmark, or routing module may originate, select, or interpolate an FX rate. Rates
  are owner-entered or deterministically imported, per the standing rule that the LLM tier never sources
  monetary values.
- **I2.8** Conversion with no observation at or before the required instant MUST fail loudly and be
  surfaced as "unconvertible", never defaulted to 1:1 or to the nearest future rate.

## 3. Deletion and sync integrity

- **I3.1** **Absence is not deletion.** Every syncable entity carries an explicit `deleted` tombstone.
- **I3.2** Every syncable entity carries a per-entity monotonic `version`. Document-level
  `meta.revision` is retained but is insufficient for merge, because it cannot distinguish
  "deleted on the peer" from "not yet created locally".
- **I3.3** A tombstone MUST survive a 3-way merge against a stale peer that still holds the live row.
  This is the resurrection case and it is a required test, not an aspiration.
- **I3.4** Tombstones are retained, not vacuumed, for the life of the Profile-A store. Any future
  compaction is a separate authorized change.
- **I3.5** Merge outcomes continue to be audited in `meta.conflicts` per `drive-db.md`. Tombstone
  resolutions MUST appear there.

## 4. Split allocations, versioning and the reconciled lock

- **I4.1** A split is a **first-class allocation set** owned by its parent transaction, not an
  incidentally-mutable array.
- **I4.2** Allocation legs MUST sum EXACTLY to the parent `amount`, enforced through `allocate()`
  (money-rules 3). All legs share the parent's `currency`.
- **I4.3** Editing a split is an **atomic versioned mutation**: the prior allocation set is superseded
  and the replacement is written in the same operation. Partial application is a defect. NIZAM
  explicitly **rejects** the upstream limitation that split legs cannot be edited.
- **I4.4** Superseded allocation sets are retained as audit history and are never destroyed by an edit.
- **I4.5** `reconciled` is a **lock**. A reconciled transaction, its allocations and its transfer peer
  MUST NOT be mutated in place. Change requires an explicit correction/reversal or a deliberate
  unreconcile, each producing an audit record.
- **I4.6** A transfer's two legs are mutated as one unit. Leaving one leg edited and its peer stale is
  a defect.

## 5. Ingestion boundary

- **I5.1** Authoritative intake for Release 1 is **manual entry, account snapshots, and statement-file
  ingestion** (CSV/XLSX/statement parsers), per `drive-db.md` one-time Picker import.
- **I5.2** Telegram, SMS and email may only produce **candidates in a staging collection distinct from
  `transactions[]`**. A candidate is not financial truth and MUST NOT be counted in any balance,
  budget, forecast or report.
- **I5.3** Promotion of a candidate to canonical requires deterministic parsing plus validation plus the
  normal review/reconciliation path. `approved` is a review flag, not an isolation boundary, and MUST
  NOT be used as a substitute for staging.
- **I5.4** Provenance is preserved verbatim, including the honest `unknown` extraction method already
  modelled in `IngestLedgerRow`. A machine-extracted row MUST NEVER claim `manual`.
- **I5.5** No LLM output may become a monetary value or a canonical row. It may only annotate or propose.
- **I5.6** Dedupe on promotion uses the existing `duplicateKey` and preserves both the original and
  cleaned payee strings.

## 6. Targets as a planning primitive

- **I6.1** Targets are core schema, not a later feature. The current
  `CategoryTarget { monthly | target_by_date }` is insufficient and widens toward the modelled shapes
  (target balance, target balance by date, monthly funding, spending plan, debt payoff).
- **I6.2** Every derived target figure (under-funded, months-to-budget, percent complete) is a
  **deterministic engine output** of C3. None may originate from an LLM.
- **I6.3** Monthly rollover behaviour ("set aside" vs "refill") MUST be explicit per target, because the
  two produce materially different funding demands.
- **I6.4** System/internal categories MUST be representable and non-editable by the user.

## 7. Phases and gates

### Phase 6.1 — Contract + spec delta (this document)
- Tasks: ratify invariants; record decisions in `.kiro/specs/02-drive-data-layer/` and
  `.kiro/specs/03-budget-engine/` as EARS acceptance criteria.
- **Gate:** owner approval. No source file changes.

### Phase 6.2 — Schema v5 (additive, migrated, reversible)
- Tasks: `SCHEMA_VERSION 4 -> 5`; add `currency` to `Account`/`Transaction` (default `EGP`); expose
  uncleared balance; add per-entity `deleted` + `version`; widen `FxRate.asOf` to datetime; add
  `conversionVersion`; staging collection for candidates.
- **Gate:** a v4 fixture migrates to v5 with zero monetary drift **and** migrates back; `zMoney`
  integrality holds on every money field; `schema.test.ts` + `migrations.test.ts` green.

### Phase 6.3 — FX derivation module
- Tasks: `src/lib/money/fx.ts` — pure conversion returning value **plus** provenance; BigInt
  intermediate; explicit rounding; mixed-currency sum guard; unconvertible surfaced.
- **Gate:** property tests prove no float path, deterministic rounding, exact round-trip where the
  ratio is exact, throw on mixed-currency sum, throw on missing observation.

### Phase 6.4 — Versioned allocations + reconciled lock
- Tasks: supersede-and-replace as one atomic mutation with retained history; reject in-place mutation
  of reconciled rows; correction/reversal/unreconcile workflow; transfer legs mutate as a unit.
- **Gate:** legs sum exactly to parent; superseded sets retrievable; reconciled mutation rejected;
  transfer peer never left stale.

### Phase 6.5 — Tombstone-aware merge
- Tasks: extend the `drive-db.md` 3-way merge for tombstones and per-entity versions; audit into
  `meta.conflicts`.
- **Gate:** **resurrection test** — delete on A, merge stale B holding the live row, assert still
  deleted and audited. Offline dirty-queue path preserves tombstones.

### Phase 6.6 — Targets widening + repository gate
- Tasks: widen `CategoryTarget`; derived figures as C3 engine outputs; rollover behaviour explicit.
- **Gate:** `npm run typecheck` · `npm run lint` · focused tests · `npm run build` ·
  `npm run verify:all -- --all` (expected 20/20 on a healthy baseline).

## 8. Definition of Done

Multi-currency representable end-to-end with EGP as base; every base figure derived with provenance and
no float anywhere in the conversion path; deletions replicate as tombstones and survive a stale-peer
merge; split edits are atomic, versioned and audited; reconciled history is locked behind an explicit
correction workflow; Telegram/SMS/email cannot write canonical financial truth; targets are first-class
with deterministic derived figures. `drive.file` unchanged. Benchmark and routing remain out of the
application bundle. Mark C6 DONE only when the repository gate is green.

## 9. Out of scope

Server/SQLite tier (`tech.md` D1), open-banking or live bank APIs (`product.md` non-goal), instruments
needing more than 3 decimals, multi-user or shared plans, tombstone compaction, and any change to the
Drive scope.

## 10. Open items requiring an owner decision before Phase 6.2

1. **Uncleared balance: derive or store?** It is exactly `balance - clearedBalance`. Recommendation:
   **derive**, so there is no third stored balance that can drift out of agreement.
2. **Base-currency amount: derive-on-read or cache?** Recommendation: **derive**, and cache only against
   a measured performance need, because a cached converted amount silently goes stale when a rate is
   corrected.
3. **`FxRate.asOf` widening** mutates an existing tracked field rather than adding one. It is the
   highest-risk item in Phase 6.2 and needs explicit sign-off.
4. **Currency display formatting** must extend money-rules rule 5 beyond EGP. Per-currency decimal
   digits and symbol placement should be data, not hardcoded.
