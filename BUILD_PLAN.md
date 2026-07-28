# NIZAM — Build Plan
This is the meta-plan the KIRO IDE follows to turn this scaffold into a shippable webapp.

## 0. Ground rules (from `.kiro/steering/`)
- App: Vite + React 18 + TypeScript (strict). State: Zustand. Offline: Dexie/IndexedDB.
- **Database: Google Drive**, scope `drive.file` only, canonical `nizam_db.json` + snapshots.
- **Money: integer milliunits** (1 EGP = 1000). No floats, ever.
- Every source file headers the Contract/Phase that owns it.

## 1. The five contracts (execute in order, loop each to green)
| # | Contract | Outcome |
|---|----------|---------|
| 1 | Foundation & Scaffolding | Building app + tested money core + domain types |
| 2 | Google Drive Data Layer | Drive-as-database + offline cache + sync + ledger import |
| 3 | Budgeting Engine (YNAB core) | Zero-based budget math, fully unit-tested |
| 4 | UI / UX (YNAB-style) | Budget grid, register, entry, reconcile, import UI |
| 5 | Reports, Rescue Analytics & Release | Reports + Egypt rescue widgets + PWA + push-ready |

Dependencies: C1 → C2 → C3 → C4 → C5 (strict). Details in `contracts/CONTRACT_<n>_*.md`; KIRO-native specs in `.kiro/specs/`.

## 2. The engineering loop (per phase)
`read spec → build tasks → run typecheck/test/build → if red: diagnose+fix+repeat → if green: record → next`. Never advance on a red gate. Protocol: `contracts/_KIRO_LOOP_PROTOCOL.md`.

## 3. Data sources (from 47_NIZAM BANKING)
- `docs/research/` — YNAB-style + offline-first architecture, Egypt loan-readiness, iScore levers, liquidity-buffer, debt-loop research (the design source of truth).
- `data/ledgers/LEDGER_SCHEMA.md` — the real 25-column `master_ledger` contract used for import.
- The existing `master_ledger` + `credit_limits` are imported ONCE (Google Picker) — not committed.

## 4. Definition of full build DONE
- [ ] All 5 contracts marked DONE in `contracts/_CONTRACT_INDEX.md`
- [ ] `npm run test` green (money, budget engine, dedup covered)
- [ ] `npm run build` emits a working static SPA
- [ ] README run steps verified from a clean clone
- [ ] `git status` clean, no secrets / no real ledgers committed
- [ ] Repo ready for `git remote add origin <PROVIDED>` + `git push` (awaits user go)

## 5. What is NOT in scope (v1)
Multi-user, open-banking/live bank APIs, regulated advice, cloud multi-tenant. Drive + local is the whole backend.

## 6. Handoff to GitHub
When the user provides the repo URL: set remote, verify clean tree + secret-scan, then push. Until then: local only.
