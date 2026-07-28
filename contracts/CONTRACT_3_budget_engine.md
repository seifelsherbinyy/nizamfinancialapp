<!-- NIZAM BUILD CONTRACT — machine+human readable. KIRO: execute phases in order, loop each phase to a GREEN gate before advancing (see contracts/_KIRO_LOOP_PROTOCOL.md). Honor .kiro/steering/*. -->
# Contract 3 — Budgeting Engine (YNAB core)
- **id:** C3 · **depends on:** C1, C2 · **produces:** the zero-based budgeting engine + read models
- **spec:** `.kiro/specs/03-budget-engine/` · **steering:** money-rules.md, product.md

## Objective
Implement YNAB's zero-based budgeting math as pure, tested functions over the C2 data: category groups/categories, monthly assigned/activity/available, rollover, Ready-To-Assign, overspend rules (cash vs credit), credit-card payment automation, and category targets.

## Inputs
- C2 store + ledgerStore; `src/features/budget/*`; seed `data/seed/categories.seed.json`.

## Phases
### Phase 3.1 — Category model + seed
- Tasks: finalize `budget.types.ts`; category groups/categories CRUD in store; load seed + derive categories from imported master_ledger categories.
- **Gate:** groups/categories persist to Drive DB.

### Phase 3.2 — Monthly state + read model
- Tasks: month records; `ledgerStore` selectors for activity per category/month.
- **Gate:** activity equals sum of categorized transactions for the month (unit test).

### Phase 3.3 — assigned/activity/available + RTA
- Tasks: implement `budget.logic.ts`: available = prevAvailable + assigned + activity; Ready-To-Assign = income - totalAssigned.
- **Gate:** parity unit tests vs hand-computed YNAB cases pass.

### Phase 3.4 — Rollover + overspend
- Tasks: positive available rolls forward; cash overspend reduces next RTA; credit overspend flows to CC payment category.
- **Gate:** overspend test matrix (cash/credit) passes.

### Phase 3.5 — Credit-card payment automation + goals
- Tasks: on credit spending in a budgeted category, auto-move to the card's payment category; implement category targets/goals (monthly, target-by-date).
- **Gate:** CC automation + goal progress unit tests pass.

## Definition of Done
Engine is pure + fully unit-tested with YNAB-parity fixtures; wired to the store; typecheck+test green. Mark C3 DONE.
