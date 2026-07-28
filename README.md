# NIZAM
**A private, offline-first, YNAB-style personal-finance webapp — with your own Google Drive as the database.**

Built from the research + real financial data in the `47_NIZAM BANKING` Drive folder. Single-user, private, no third-party servers: your Google Drive stores the canonical database (`nizam_db.json`), the app runs in the browser (React + TypeScript), and a local IndexedDB cache keeps it working offline.

> **Status:** SCAFFOLD + build contracts only. The actual code is built by KIRO IDE, executing `contracts/CONTRACT_1..5` in a loop. This repo is not yet a running app — it is the machine-readable build plan + placeholders KIRO fills.

## What it will do (v1)
- Zero-based budgeting (YNAB's four rules): categories, monthly assign/activity/available, Ready-To-Assign, rollover, goals.
- Accounts (CIB current, HSBC credit cards, cash), transaction register, splits/transfers, reconciliation.
- Import your existing `master_ledger` (25-column schema) once via Google Picker, with dedup.
- Reports (net worth, spending, age-of-money) + Egypt-context "rescue" widgets (card utilization, FOIR, liquidity runway, 30/60/90) drawn from `docs/research`.
- Installable PWA, works offline.

## Architecture (one line)
`React SPA` → `budget engine (pure, tested)` → `Drive-as-database adapter (drive.file scope)` ↔ `Dexie offline cache`. Money is integer **milliunits** (1 EGP = 1000), never floats.

## Run (after KIRO completes the build)
```bash
cp .env.example .env.local     # fill Google client id / api key / drive folder id
npm install
npm run dev                    # local dev
npm run test                   # vitest
npm run build                  # static SPA in dist/
```

## How this repo is built (KIRO)
1. Read `BUILD_PLAN.md` then `contracts/_CONTRACT_INDEX.md`.
2. Execute `contracts/CONTRACT_1_foundation.md` → ... → `CONTRACT_5_reports_release.md`, IN ORDER.
3. For each phase: build → self-verify against the phase gate → **loop until green** → tick `.kiro/specs/*/tasks.md` and append to `contracts/_BUILD_LOG.md`.
4. Full build done when all 5 contracts pass, `npm run build` works, and the repo is clean + push-ready.

## Privacy & safety
- Database = **your** Google Drive, scope `drive.file` ONLY (app-created + picked files; never full-drive).
- Real ledgers are **gitignored**; only `.example` shapes are committed. Secrets live in `.env.local` (gitignored).
- Account identifiers are redacted (last-4) in the UI.

## GitHub
Push target provided later. `git init` is done; **do not push until the remote is set and confirmed** (Contract 5, Phase 5.5).
