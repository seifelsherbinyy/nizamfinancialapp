<!--
NIZAM UI CONTRACT DELTA — Contract 4 vs the 2026-09-02 teardown.
owning contract: contracts/CONTRACT_4_ui_ynab.md
phase: RESEARCH_COMPLETE_ARCHITECTURE_PLAN_PENDING · implementation NOT authorized
evidence: docs/research/2026-09-02-ynab-live-product-teardown.md
labels: CONFIRMED · CONTRADICTION · MISSING · EXTENSION
-->

# UI Contract Delta — C4 vs Teardown

Contract 4 was written before the teardown. This records what the evidence **confirms**, what it
**contradicts**, what remains **unavailable**, and which additions are **Financial NIZAM's own** rather
than upstream mimicry.

Anti-goal restated: NIZAM must not become a generic envelope-budget clone. Everything under EXTENSION is
what makes it a decision system rather than a budget grid.

---

## 1. CONFIRMED — C4 was right, evidence agrees

| C4 phase | C4 text | Confirming evidence |
|---|---|---|
| 4.1 | `MoneyCell (RAG: green RTA, red/amber overspend)` | Upstream publishes semantic colour **families**: Meadow = positive, Mulberry/Sunset = negative, plus a lime/buttermilk family. C4's green/red/amber trio matches the real semantic structure. |
| 4.1 | redaction util (last-4) | Already implemented — `redactIdentifier()` in `accounts.types.ts` returns `••••NNNN`. Exceeds upstream, which exposes no such concept publicly. |
| 4.2 | `AccountsSidebar` with on/off-budget grouping | Upstream models `on_budget` as an **account data property**, not a UI grouping choice. C4's grouping is data-driven and correct. |
| 4.3 | grid: editable Assigned, RTA header, RAG Available | Upstream's category triple is `budgeted / activity / balance`; NIZAM's `MonthCategoryBudget { assigned, activity, available }` is the same triple. `Months` is a first-class entity upstream, matching C4's month navigation. |
| 4.6 | reconcile "...and **lock**" | Upstream clearance includes `reconciled` as a distinct third state. C4's lock language is correct and matches the intended semantics. |
| 4.7 | Picker -> map -> **dedupe preview** -> commit | Upstream models `import_id`, `matched_transaction_id`, and both raw and cleaned payee strings. A dedupe preview step is the right shape. |
| 4.5 | splits + transfers create "correct linked rows" | Upstream represents transfers as a doubly-linked pair via a per-account transfer payee. C4's linked-rows gate matches. |

---

## 2. CONTRADICTION — C4 must change

### 2.1 `cleared toggle` cannot express three states — **must be fixed**

C4 Phase 4.4 specifies: *"inline edit, **cleared toggle**, running balance"*.

FACT: clearance is a three-state enum — `CLEARED_STATUSES = ['uncleared','cleared','reconciled']`
(`src/features/transactions/transaction.types.ts:10`), confirmed as the same shape upstream.

A boolean toggle **cannot represent `reconciled`**, and `reconciled` is a lock (FN-YNAB-06, AD-5). A
two-state control either hides the locked state or silently discards it. The register needs a three-state
control, with `reconciled` rendered as non-interactive.

### 2.2 Split editing must be *better* than upstream, not equal to it

The teardown found upstream's own API states: *"Updating `subtransactions` on an existing split transaction
is not supported and will return an error."*

Owner decision FN-YNAB-03 **rejects** that limitation. C4 Phase 4.5 must therefore specify an editable,
atomically-superseding allocation set with retained history — an explicit divergence from the reference
product, not an oversight.

### 2.3 Phase 4.1 must not inherit upstream identity

C4 says "clean design system" without stating the boundary. Recorded explicitly: upstream palette, token
names (Blurple/Meadow/Mulberry/Firefly/Buttermilk/Midnight), CSS and JS are **not** to be copied. Structure
transfers (named semantic families with numeric ramps; a coarse ~5-step spacing scale); identity does not.

### 2.4 Single-currency assumption is now stale

C4 predates FN-YNAB-01. Money display must carry native currency, and `money-rules.md` rule 5 (EGP-only
`Intl.NumberFormat`) is superseded for display purposes.

---

## 3. MISSING — evidence unavailable

**MISSING_AUTHENTICATED_PRODUCT_EVIDENCE.** No YNAB account was created and no signed-in session was used.
The budget grid, register, transaction entry, reconciliation flow, import wizard and goal editor were
**never inspected**. Every confirmation in §1 derives from the public API and public pages.

Consequently these C4 details cannot be validated against upstream and must be decided on NIZAM's own
merits, not assumed:

- interaction model for inline assign/edit (keyboard flow, commit-on-blur vs explicit save)
- month-navigation affordance and overspend surfacing
- reconciliation step sequence and adjustment presentation
- import mapping UI and dedupe-preview presentation
- goal/target editor layout and rollover controls

Do not later restate any of the above as an upstream fact.

Also MISSING: `.kiro/specs/04-ui-ynab/{requirements,design,tasks}.md` are **deleted from the working tree**
(present in HEAD). C4's own spec is currently unreadable on disk; this delta was written against the
contract file plus HEAD.

---

## 4. EXTENSION — Financial NIZAM only, no upstream analogue

These are the product, not the clone. None may be justified by "YNAB does it".

| Extension | UI obligation |
|---|---|
| Safe to Spend | a single deterministic figure, with its reserve breakdown inspectable |
| Protected Obligations | reserved amounts visibly withheld from spendable, never silently netted |
| Purchase Decision Card | decision surface with recommendation, alternatives, confidence **band**, and horizon impacts |
| Debt / BNPL priority | ordered payoff view driven by `interestBps`, `penalty`, `graceDate` |
| Forecasts / scenarios | minimum-cash trough visible; scenario currency labelled |
| Net-worth views | nominal, liquid, liquidation-discounted, real (inflation-adjusted) |
| Outcome learning | decision -> outcome -> prediction error, append-only, never silently rewritten |
| Hermes queries | read-only surface; must never present a candidate as canonical |

### 4.1 New UI obligations created by the ratified decisions

- **Currency + FX provenance** — a converted figure must disclose source, `observedAt` and
  `conversionVersion` on inspection. A number whose provenance cannot be shown must not be shown.
- **`unconvertible` is a first-class visual state** — never rendered as 1:1, zero, or blank.
- **Candidate review queue** — structurally separate from the register. A candidate must be visually
  impossible to mistake for canonical ledger truth (FN-YNAB-02).
- **Approval is its own axis** — the register must show approval separately from clearance (FN-YNAB-07),
  which the current single "cleared toggle" conflates.
- **Allocation history** — superseded split sets are viewable; edits are never silent (FN-YNAB-03).
- **Transfer group integrity** — editing or reversing one leg must surface its counter-entry; an orphaned
  leg must be impossible to create from the UI (FN-YNAB-08).
- **Reconciled correction flow** — an explicit reversal+replacement (or unreconcile+amend) path, never
  in-place mutation of settled history.
- **Bilingual / RTL-ready** — Arabic and English, RTL-safe layout, accessible. No upstream analogue; this is
  an Egypt-context requirement.

---

## 5. Recommended C4 amendments

1. Phase 4.4 — replace "cleared toggle" with a **three-state clearance control**, `reconciled` non-interactive.
2. Phase 4.4 — add an **approval** column/control distinct from clearance.
3. Phase 4.5 — specify **versioned, atomically-superseding** split editing with visible history.
4. Phase 4.1 — state the identity boundary (structure transfers, palette does not) and add per-currency formatting.
5. Phase 4.6 — specify the reconciled **correction workflow**, not just the lock.
6. Phase 4.7 — require preservation of both raw and normalized payee, and a tri-state duplicate
   (`unique | duplicate | ambiguous`) with ambiguous routed to review.
7. New phase — **candidate review queue** for the ingestion boundary.

None of these are implemented. They are proposed amendments to C4 pending owner approval.
