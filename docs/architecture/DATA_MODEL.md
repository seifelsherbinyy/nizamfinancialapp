# Data Model

> **Status:** IMPLEMENTED · **Owner:** KIRO Contract 3 / Phase 3.1 · code: `src/lib/db/schema.ts`, `src/features/*/**.types.ts`

## Entities
```
NizamDb (one JSON document in Drive)
├── meta            currency EGP · moneyBase milliunits · revision · conflicts[] (sync audit)
├── accounts[]      Account   — CIB_DEBIT | HSBC_CC | CASH | BANK_OTHER | CREDIT_OTHER | TRACKING
│                     onBudget · balance/clearedBalance (cached) · accountIdentifier (REDACTED last-4)
│                     creditLimit · paymentCategoryId (credit accounts)
├── categoryGroups[] CategoryGroup — name · order · hidden
├── categories[]     Category — groupId · target (monthly | target_by_date) ·
│                     isCreditCardPayment + linkedAccountId (CC payment categories)
├── months[]         MonthBudget — month YYYY-MM · categories{catId: {assigned, activity, available}}
│                     ONLY `assigned` is user-entered truth; activity/available are derived
├── payees[]         Payee — id · name
└── transactions[]   Transaction — accountId · date · payee · categoryId? · amount (signed) ·
                      cleared (uncleared|cleared|reconciled) · approved · transfer linkage ·
                      splits[] (sum == parent amount) · importInfo (25-col ledger provenance)
```

## Invariants
1. Every money field is an INTEGER of milliunits (zod `int()` enforced on load). 1 EGP = 1000.
2. Signed convention: outflow negative, inflow positive (`amount`); split legs sum to parent.
3. A transaction has a category XOR a transfer link (transfers carry no category).
4. Months are explicit records (YNAB/Actual pattern) — never recomputed from "current" state.
5. `meta.conflicts` is append-only audit of sync merges.

## YNAB parity notes (engine: `src/features/budget/budget.logic.ts`)
- available = carryIn + assigned + activity; carryIn = max(0, prev available).
- RTA(m) = Σincome(≤m) − Σassigned(≤m) − Σcash-overspend(<m).
- Cash overspend resets + reduces next RTA; credit overspend becomes card debt.
- Funded credit spending auto-moves into the linked card-payment category; payments
  (transfers into the card) draw it down.
- Goals: monthly (assigned vs amount) and target-by-date (available vs amount, ceil
  per-month suggestion).
