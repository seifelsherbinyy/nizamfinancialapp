# KIRO Kickoff Prompt — build NIZAM fully, locally

> Paste the block below into Kiro IDE (Agent mode) with this repo open as the workspace.
> It runs the whole build loop autonomously, researches current external sources, and verifies locally.

---

You are the build agent for **NIZAM**, a private, offline-first, **YNAB-style personal-finance webapp** whose **database is the user's own Google Drive**. This repository is already scaffolded with a full build plan, five sequential build contracts, KIRO-native specs, steering rules, and a research corpus. Your job is to **execute the entire build locally, end to end, until it is a working app and the repo is push-ready** — researching authoritative external sources as you go.

## 1. Read before you build (in this order)
1. `BUILD_PLAN.md` and `INDEX.md` — the overall plan and map.
2. `.kiro/steering/*` — ALWAYS-ON rules. Non-negotiable: **money = integer milliunits (1 EGP = 1000), never floats**; **Google Drive scope = `drive.file` ONLY** (never full `drive`); account identifiers redacted (last-4) in UI; personal-only, no third-party servers.
3. `contracts/_CONTRACT_INDEX.md` and `contracts/_KIRO_LOOP_PROTOCOL.md` — the 5 contracts and the loop.
4. `contracts/CONTRACT_1..5_*.md` — the phase-by-phase specs you will implement.
5. `.kiro/specs/01..05/{requirements,design,tasks}.md` — your native specs; expand `design.md` and tick `tasks.md` as you work.
6. `docs/research/*` — the design source of truth (YNAB architecture, offline-first, Egypt loan-readiness/iScore/liquidity). Use these for domain decisions and the Contract 5 "rescue" widgets.
7. `data/ledgers/LEDGER_SCHEMA.md` — the authoritative 25-column ledger contract for import.

## 2. Research mandate (do this, cite it)
Before implementing each contract, research the **current** (APIs drift — verify versions) authoritative docs and record decisions into the contract's `.kiro/specs/<n>/design.md` and, where architectural, a new `docs/adr/ADR-####.md`. Cover at minimum:
- **YNAB method** — the four rules, zero-based budgeting math (assigned/activity/available, Ready-To-Assign, rollover, overspend cash-vs-credit, credit-card payment category), Age of Money.
- **Actual Budget** — its local-first architecture, import/dedup, reconciliation, sync-reset (as the reference pattern, not to copy code).
- **Google Identity Services (GIS)** token client for browser SPAs; **Drive API v3** (`files` list/get/create/update media), **`drive.file` scope** semantics, and the **Google Picker API** for one-time access to an existing file.
- **Integer money** handling (milliunits/minor units, allocate-without-drift), `Intl.NumberFormat` for `EGP` (ar-EG/en).
- **Dexie/IndexedDB** offline cache patterns; **conflict resolution / 3-way merge** for a single-user multi-device store; **etag/version** guards on Drive files.
- **PWA / service worker** (installable, offline app shell), **Vite + React 18 + TypeScript strict** best practices, **Vitest + Testing Library**.
- Egypt-context formulas from `docs/research/` (card utilization, FOIR/debt-service ratio, liquidity runway, iScore levers) for the reports/rescue widgets.

## 3. Execute the contracts (in strict order 1 -> 5)
Follow `contracts/_KIRO_LOOP_PROTOCOL.md`. For **each contract, each phase**:
1. Implement ONLY that phase's tasks, replacing the `PLACEHOLDER` files it names (each file's header states its Contract/Phase).
2. **Self-verify against the phase's Acceptance Gate** by actually running, locally: `npm install`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run lint` (as applicable). 
3. **Loop like an engineer:** if any gate is red, diagnose -> fix -> re-run. Do NOT advance to the next phase on a red gate. Do NOT fake or skip a gate.
4. Tick the boxes in `.kiro/specs/<n>/tasks.md`; append one line per phase to `contracts/_BUILD_LOG.md` (`date | C<n>.<phase> | gate: PASS | note`).
5. When all phases pass, mark the contract DONE in `contracts/_CONTRACT_INDEX.md` and start the next.

## 4. Build FULLY and LOCALLY
- Install real dependencies and pin them in `package.json` (Contract 1 Phase 1).
- Produce actual working code — not stubs. `npm run dev` must serve the app; `npm run build` must emit a working static SPA in `dist/`.
- Write real unit tests for the money core, the budget engine, and the import/dedup logic; keep them green.

## 5. Constraints (hard)
- Integer milliunits everywhere; all money through `src/lib/money`. No floating-point money.
- Drive scope `drive.file` only. Never request full `drive`. Never read/write anything but the user's NIZAM app files + explicitly picked files.
- Secrets only in `.env.local` (gitignored). Real ledgers stay gitignored — commit only `.example` shapes. Redact account identifiers in the UI.
- This app is personal-finance only — do not add analytics/telemetry or any external data egress beyond the user's own Google Drive.

## 6. Inputs you will need from the user (ask once, then continue)
- A **Google OAuth client** (Client ID + browser API key) with the **Google Drive API** and **Picker API** enabled, and the NIZAM Drive **folder ID** for the database file. Put them in `.env.local` per `.env.example`. If not yet provided, implement everything else and leave a clearly-marked TODO + a mock so tests/build still pass.

## 7. Definition of DONE (stop condition)
- All 5 contracts marked DONE; `npm run test` and `npm run build` green; app runs offline as a PWA.
- README run steps verified from a clean state.
- `git status` clean; secret-scan clean; no real ledger/secret committed.
- Repo is push-ready. **DO NOT `git push`** — stop and report. The user will provide the GitHub remote; only then add it and push (Contract 5, Phase 5.5).

Work autonomously through the phases without pausing for confirmation between green gates. Pause only for a genuine blocking input (e.g., the Google credentials) or a real architectural fork, and state the options crisply. Begin now with Contract 1, Phase 1.1.
