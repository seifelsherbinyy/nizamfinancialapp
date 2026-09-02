# NIZAM Build Contracts — Index & Status
Execute in order. Each contract loops its phases to a GREEN gate before advancing (see `_KIRO_LOOP_PROTOCOL.md`).

| # | Contract | Depends | Status |
|---|----------|---------|--------|
| 1 | Foundation & Scaffolding | - | [x] DONE |
| 2 | Google Drive Data Layer | C1 | [x] DONE |
| 3 | Budgeting Engine (YNAB core) | C1,C2 | [x] DONE |
| 4 | UI / UX (YNAB-style) | C1-C3 | [x] DONE |
| 5 | Reports, Rescue Analytics & Release | C1-C4 | [x] DONE |

**Full build DONE when:** all 5 = DONE, `npm run build` works, tests green, README verified, repo clean + push-ready.

> **Draft proposal, not yet a numbered contract.**
> `CONTRACT_6_multicurrency_ledger_integrity.md` (multi-currency, ledger integrity and the
> ingestion boundary; a C2/C3 delta) is on disk awaiting owner approval. It is deliberately
> kept out of the table above: the table is the release ledger, and listing an unapproved
> contract there would assert release-incompleteness. Promote it to row 6 only when approved,
> and update the expected row count in `scripts/verify/contract-ledger.mjs` in the same change.
