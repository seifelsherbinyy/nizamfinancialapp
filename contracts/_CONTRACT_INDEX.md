# NIZAM Build Contracts — Index & Status
Execute in order. Each contract loops its phases to a GREEN gate before advancing (see `_KIRO_LOOP_PROTOCOL.md`).

| # | Contract | Depends | Status |
|---|----------|---------|--------|
| 1 | Foundation & Scaffolding | - | [x] DONE |
| 2 | Google Drive Data Layer | C1 | [x] DONE |
| 3 | Budgeting Engine (YNAB core) | C1,C2 | [x] DONE |
| 4 | UI / UX (YNAB-style) | C1-C3 | [ ] TODO |
| 5 | Reports, Rescue Analytics & Release | C1-C4 | [ ] TODO |

**Full build DONE when:** all 5 = DONE, `npm run build` works, tests green, README verified, repo clean + push-ready.
