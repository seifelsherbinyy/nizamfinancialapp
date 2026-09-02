<!--
NIZAM ARCHITECTURE GAP ANALYSIS — FN-YNAB-01..10
owning contract: contracts/CONTRACT_4_ui_ynab.md (evidence) + contracts/CONTRACT_6_multicurrency_ledger_integrity.md (DRAFT)
phase: RESEARCH_COMPLETE_ARCHITECTURE_PLAN_PENDING
evidence: docs/research/2026-09-02-ynab-live-product-teardown.md
inspected: live repository working tree, 2026-09-02. No implementation performed.
labels: FACT = read from this repo or a public source · INFERENCE = reasoned · ASSUMPTION = unverified · MISSING = evidence unavailable
-->

# Current Financial Architecture — Gap Analysis (FN-YNAB-01..10)

Method: DISCOVER EXISTING -> MAP -> PRESERVE/REPAIR/EXTEND -> CREATE ONLY IF ABSENT.
Every row below was checked against source, not assumed. Where I previously asserted something
incorrectly, the correction is stated explicitly.

## Summary

| ID | Decision | Status |
|----|----------|--------|
| FN-YNAB-01 | Multi-currency foundational | **PARTIAL** |
| FN-YNAB-02 | Egyptian ingestion manual/file first | **PARTIAL** |
| FN-YNAB-03 | Editable splits use versioning | **PARTIAL** |
| FN-YNAB-04 | Canonical vs presentation money | **SUPPORTED** |
| FN-YNAB-05 | Tombstones + versioned sync | **PARTIAL — contains a live defect** |
| FN-YNAB-06 | Multiple balance views | **PARTIAL** |
| FN-YNAB-07 | Approval independent of clearance | **PARTIAL** |
| FN-YNAB-08 | Transfers are linked events | **PARTIAL** |
| FN-YNAB-09 | Import dedupe first-class | **PARTIAL** |
| FN-YNAB-10 | Goals/targets core schema | **PARTIAL** |
| Cloudflare Workers + D1 target | (infrastructure) | **ABSENT and CONFLICTING** |

Nothing is ABSENT outright except the Cloudflare target and the candidate-staging tier. The foundation is
stronger than the mandate assumes, which shrinks the plan.

---

## FN-YNAB-01 — Multi-currency: **PARTIAL**

**Already supported (PRESERVE, do not rebuild):**

- FACT `src/features/netWorth/netWorth.types.ts` — `Asset.currency: CurrencyCode`, `BASE_CURRENCY = 'EGP'`.
- FACT `FxRate { currency, perUnitNum, perUnitDen, source, asOf }` — FX is an **integer rational**, already float-free, already carrying source and time.
- FACT `MacroContext.referenceCurrency` — a reporting-currency concept exists.
- FACT `src/lib/money/money.ts:203-217` — **`mulRatio(a, num, den)` already performs exact rational conversion with a `BigInt` intermediate and half-away-from-zero rounding**, matching `fromDecimal`.
  *Correction:* my C6 draft (I2.2/I2.3) specified BigInt conversion and explicit rounding as new work. **Both already exist.** C6 §0.1 must be amended to list `mulRatio`.

**Gaps:**

- FACT ABSENT — no `currency` field on `Account` (`src/features/accounts/accounts.types.ts`) or `Transaction` (`src/features/transactions/transaction.types.ts`). Native currency is therefore unrepresentable for the ledger itself. Multi-currency today exists **only for assets**.
- FACT `src/lib/db/schema.ts:243` — `zFxRate.asOf` is `zIsoDate` (date only). The mandate requires a **timestamped** observation.
- ABSENT — `conversionVersion`, a derived reporting amount carrying provenance, and explicit "unconvertible" handling for a missing observation.
- FACT `.kiro/steering/money-rules.md` rule 5 hardcodes EGP display (`Intl.NumberFormat`, `ar-EG`/`en`). Needs widening, not replacing.

**Tests present:** `src/lib/money/money.test.ts`, `src/lib/money/pfosBoundaryParity.test.ts`.
**Tests absent:** stale/missing FX, mixed-currency guard, conversion provenance.

---

## FN-YNAB-02 — Ingestion manual/file first: **PARTIAL**

- FACT `src/lib/ledger/ledger.types.ts` — `LedgerRow` (25 fields) with `currency`, `duplicate_key`, `is_duplicate`, `source_file`, `source_page_or_sheet`, `extraction_method`.
- FACT `IngestLedgerRow` + `INGEST_EXTRACTION_METHODS` include an honest **`unknown`**, with an explicit comment that a machine-extracted row must never claim `manual`. This already satisfies the provenance-honesty rule.
- FACT `IngestLedgerRow` derives signed `amount` as `inflow - outflow` and retains `declared_amount_magnitude`, because the upstream export's own `amount` column is an unsigned magnitude. Native-amount preservation is already practised.
- FACT Telegram code exists server-side (`src/server/telegram/`).
- **ABSENT** — no candidate/staging collection in `NizamDb` (`src/lib/db/schema.ts:288-309`). The only isolation for unreviewed rows is `Transaction.approved: false`, which the mandate explicitly forbids as a substitute for staging.

INFERENCE: without a staging tier, a Telegram-sourced row can only be written into `transactions[]`, where it would already be counted by balance and budget computations. This is the highest-risk ingestion gap.

---

## FN-YNAB-03 — Editable splits versioned: **PARTIAL**

- FACT `TransactionSplit { id, categoryId, amount, memo }`; `Transaction.splits: TransactionSplit[] | null`.
- FACT `allocate(total, weights)` in `money.ts:243` guarantees legs sum EXACTLY to the parent (largest remainder, BigInt). The determinism requirement is already met.
- **ABSENT** — no version, no supersession, no retained history, no audit on split edits. Splits are a mutable embedded array.
- **ABSENT** — no enforcement that a `reconciled` parent cannot be mutated in place; no correction/reversal or unreconcile+amend workflow. `src/features/reconciliation/` exists but does not lock allocations.

---

## FN-YNAB-04 — Canonical vs presentation: **SUPPORTED**

- FACT `Money = number`, integer milliunits; `MILLI = 1000`; `assertMoney` enforces `Number.isSafeInteger`.
- FACT `zMoney = z.number().int().finite()` guards every money field at the schema boundary.
- FACT `toDecimal`, `format`, `formatEGP` are one-way integer -> string. **No `_formatted` or decimal field is persisted anywhere in `NizamDb`** — verified across `schema.ts`.
- FACT `fromDecimal` parses digit-by-digit with a BigInt accumulator; no `parseFloat` in the money path.

This is the one decision that is genuinely already satisfied, and it is stronger than YNAB's own API, which ships `balance_currency` as a double.

Residual: ASSUMPTION — the separation is enforced by convention and review, not by the type system. A nominal/branded `Money` type would make display-feeding-arithmetic unrepresentable. Recommended, not required.

---

## FN-YNAB-05 — Tombstones + versioned sync: **PARTIAL, and one live defect**

**Better than assumed:**

- FACT `src/lib/drive/sync.ts:40-93` — `mergeCollection` is a genuine **base-aware 3-way merge**. With a correct base it handles deletion properly: `localChanged && !remoteChanged` pushes only if defined, so a local delete **drops the row** (line 66), and edit/delete divergence is resolved and **audited** into `meta.conflicts` (lines 76-88).
  *Correction:* I earlier told the owner that "absence is not deletion" was a live bug across the board. **That was too strong.** With an accurate base, deletion propagates correctly today.

**The live defect (FACT):**

- `src/state/store.ts:35-36` — `baseDb: NizamDb | null`, initialised `null` (line 96).
- `src/state/store.ts:63` and `:137` — the base is supplied as `getBase: () => baseDb ?? db`.
- INFERENCE (direct, from the code above): when `baseDb` is `null`, **base === local**. Then `localChanged = !deepEqual(b, l)` is always `false`, so every divergence takes the `!localChanged && remoteChanged` branch and **remote wins unconditionally**. A row deleted locally but still present remotely is re-added — **resurrection**. Reachable on any fresh session or cache loss before a first successful sync point.

**Structural gaps:**

- ABSENT — per-entity `deleted` tombstone and per-entity `version`.
- FACT `meta.revision` is document-level (`Math.max(local, remote) + 1`, sync.ts:173). It cannot serve as the monotonic cursor the mandate requires ("new, changed, superseding, deletion events since version X").
- INFERENCE — with no tombstone, a client that never held the base (Hermes reader, recovery mirror, future mobile client) cannot learn that a deletion occurred. It sees only live rows. The mandate explicitly requires the model to serve those clients.

---

## FN-YNAB-06 — Balance views: **PARTIAL**

- FACT `Account.balance` and `Account.clearedBalance` exist (both cached, "derived from transactions").
- FACT ABSENT — no uncleared balance. It is exactly `balance - clearedBalance`.
- FACT **SUPPORTED** — `CLEARED_STATUSES = ['uncleared','cleared','reconciled']` (`transaction.types.ts:10`), so clearance is already a 3-state enum with `reconciled` present.
- FACT `src/features/reconciliation/` exists as a feature area.
- ABSENT — `reconciled` is not enforced as a stronger lock (see FN-YNAB-03).

---

## FN-YNAB-07 — Approval independent of clearance: **PARTIAL**

- FACT `Transaction.approved: boolean` is a distinct field from `Transaction.cleared`. Two independent axes: **SUPPORTED**.
- FACT import confidence exists: `ImportInfo.confidenceScore` + `confidenceReason`; `IngestLedgerRow` additionally separates `confidence_bps` from `confidence_band` and refuses to render a band as a score.
- ABSENT — categorization confidence as its own axis; pending/provisional state as its own axis.

---

## FN-YNAB-08 — Transfers are linked events: **PARTIAL**

- FACT `Transaction.transferAccountId` + `transferTransactionId` — the doubly-linked pair exists.
- ABSENT — no common transfer ID grouping the two legs; no currency on the legs (blocked by FN-YNAB-01); no stated invariant or test preventing an orphaned counter-entry on correction/reversal/deletion.

INFERENCE: with `merge3` resolving entity-by-entity and independently per collection, one leg can win and its peer be dropped, leaving an orphan. No test covers this.

---

## FN-YNAB-09 — Import dedupe first-class: **PARTIAL**

- FACT present: `duplicateKey`, `sourceFile`, `sourcePageOrSheet`, `extractionMethod`, `confidenceScore`, `confidenceReason` (`ImportInfo`); `duplicate_key`, `is_duplicate` (`LedgerRow`).
- FACT present: original vs cleaned payee is preserved at the ingest boundary (`transaction_type_raw`, `extraction_method_raw`, `declared_amount_magnitude`).
- ABSENT — batch ID, source/content hash, parser version, source transaction/account IDs, currency, normalized payee, statement reference as first-class fields.
- ABSENT — an explicit "ambiguous -> review" state; `is_duplicate` is a boolean, not a tri-state.

---

## FN-YNAB-10 — Goals/targets core schema: **PARTIAL**

- FACT `TARGET_TYPES = ['monthly', 'target_by_date']` (`budget.types.ts:18`) — **2 of the 7 required shapes**.
- FACT `CategoryTarget { type, amount, targetMonth }` — 3 fields. The teardown recorded 16 goal fields upstream; the gap is depth, not existence.
- FACT a separate `Obligation` entity already exists (`obligation.types.ts`) with `amountDue`, `minimumDue`, `dueDate`, `graceDate`, `priority`, `penalty`, `interestBps`, `protectedReserve`. This substantially covers "obligation reserve" and part of "debt reduction" — it must be **mapped, not duplicated**.
- ABSENT — emergency reserve, sinking fund, acquisition targets as modelled types; rollover behaviour ("set aside" vs "refill"); derived funding fields (required funding, underfunded, funded amount, progress, next contribution, expected completion).
- FACT `MonthCategoryBudget { assigned, activity, available }` — the budget triple already exists and matches upstream.

---

## Cloudflare Workers + D1: **ABSENT and CONFLICTING**

- FACT — no `wrangler.toml`, no `.dev.vars`, no D1/R2/Queues binding, no Workers entrypoint anywhere in the repo. Greenfield.
- FACT `.kiro/steering/tech.md` — "**D1 (2026-08-06): the SERVER tier will use VPS + SQLite** — this Drive-JSON store is the Profile-A build, NOT the final database." (Note: "D1" here is a **decision number**, not Cloudflare D1.)
- FACT `.kiro/steering/drive-db.md` — canonical store is one `nizam_db.json` in the user's Drive, `drive.file` scope only, atomic writes, dated snapshots, 3-way merge.
- FACT `.kiro/steering/cloudflare-dns.md` — Cloudflare's role today is **DNS and gate G2 only**, via a scoped API token at `.secrets/cloudflare.env`. It further records that a token was **disclosed on 2026-08-09**, that **rotation is DEFERRED by owner decision D-ROTATE**, and that **no session may rotate unilaterally**.

**Therefore:** adopting Workers + D1 as the database contradicts two steering files and would supersede ADR-0001 (Drive-as-database). It is an owner-level architecture change, not an implementation detail, and it is recorded as CONFLICTING in `docs/adr/ADR-0003-post-ynab-architecture.md` rather than assumed. I have not touched any Cloudflare credential or configuration.

---

## MISSING evidence

- **MISSING_AUTHENTICATED_PRODUCT_EVIDENCE** — YNAB's signed-in application (budget grid, register, reconcile flow, import wizard, goal editor) was never inspected. No account was created and no authenticated session was used. All upstream claims in the teardown derive from public pages and the public API. Any statement about upstream *screen* behaviour is unavailable, not inferred.
- MISSING — `.kiro/specs/` and `.kiro/steering/` are **deleted from the working tree** (52 tracked deletions, still in HEAD). Authority for this analysis was read via `git show HEAD:...`. Nothing was restored.
- MISSING — no `verify:all` baseline was established this session, so the 20/20 figure is unconfirmed today.
