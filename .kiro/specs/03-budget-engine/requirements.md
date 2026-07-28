# Requirements — Budgeting Engine (YNAB core)

> KIRO spec for Contract 3. Full contract: `contracts/CONTRACT_3_*.md`. Read steering first.

## User story
As the sole user, I want budgeting engine (ynab core) so the NIZAM build advances one verifiable contract.

## Acceptance criteria (EARS)
- THE SYSTEM SHALL compute available = prevAvailable + assigned + activity per category per month.
- THE SYSTEM SHALL compute Ready-To-Assign = income - totalAssigned.
- THE SYSTEM SHALL roll positive available forward and apply overspend rules (cash vs credit).
- THE SYSTEM SHALL auto-manage the credit-card payment category on credit spending.
- THE SYSTEM SHALL support category targets/goals.
