# Design — Budgeting Engine (YNAB core)

> Skeleton — KIRO expands during the loop. Honor `.kiro/steering/*`.

## Components / modules
- budget.types + budget.logic (engine)
- ledgerStore read model
- credit-card handling
- goals/targets
- engine unit tests vs YNAB parity cases

## Notes
- Money = integer milliunits. Drive scope = drive.file only. Every file headers its Contract/Phase.
