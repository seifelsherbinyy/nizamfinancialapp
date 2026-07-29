# Design — Budgeting Engine (YNAB core)

> Expanded by KIRO during Contract 3. Honor `.kiro/steering/*` (money-rules.md is the contract).

## Decisions (researched — docs/research/budgeting-app-ynab-architecture.md + Actual Budget docs)

### Model
- **Explicit month records** (`db.months[]`) store user-entered `assigned` per category;
  `activity` and `available` are DERIVED by the engine (never trusted from storage).
  Matches the research recommendation "explicit monthly budget state" and Actual's docs.
- Engine is **pure**: `computeBudget(db, throughMonth)` returns computed months; no I/O,
  no floats, all arithmetic through `lib/money`.

### Core math (YNAB parity)
- `carryIn(c, m) = max(0, available(c, m-1))` — positive available rolls forward.
- `available(c, m) = carryIn + assigned + activity` (activity is negative for spending).
- **Ready-To-Assign(m)** = cumulative income (≤ m) − cumulative assigned (≤ m)
  − cumulative CASH overspend of months < m. Cash overspending resets the category to 0
  and comes out of next month's RTA; CREDIT overspending becomes card debt and does NOT
  reduce RTA (Actual/YNAB rule).
- **Income** = transactions in on-budget accounts categorized to an income category
  (category named "Income"/"Inflow: Ready to Assign" or flagged id). Uncategorized inflows
  do NOT count until categorized.

### Credit-card payment automation (per-month aggregate)
For each category c, month m: `creditSpend` = magnitude of credit-account outflows in c.
`overspend = max(0, -(carryIn+assigned+activity))`; `creditOverspend = min(overspend, creditSpend)`;
`fundedCredit = creditSpend − creditOverspend`. The funded portion MOVES into the card's
payment category (available up); payments (transfers INTO the credit account) move it down:
`available(P,m) = carryIn(P) + assigned(P,m) + Σ fundedCredit(on that card) − payments(m)`.
Payment-category overspend is cash overspend (payments are real cash).

### Targets / goals
- `monthly`: need `amount` assigned each month; progress = assigned/amount.
- `target_by_date`: need `amount` AVAILABLE by `targetMonth`; suggested per-month funding =
  remaining / months-left (ceil, integer). Progress = available/amount.

### Mutation helpers (used via store.mutate)
`setAssigned`, `applySeed` (categories.seed.json), `ensureCreditCardPaymentCategories`
(creates the "Credit Card Payments" group + linked category per credit account).

## Test strategy (Phase 3.8)
Hand-computed YNAB-parity fixtures: simple assign/spend/RTA; rollover; cash-overspend
reduces next RTA + resets; credit-overspend keeps RTA + partial payment funding; CC
automation incl. payments; activity == sum of categorized transactions; goal progress.
