# NIZAM
**A private, offline-first, YNAB-style personal-finance webapp — with your own Google Drive as the database.**

Single-user and private by construction: the canonical database is one JSON file
(`nizam_db.json`) in **your** Google Drive, the app is a static React + TypeScript
SPA, and a local IndexedDB (Dexie) mirror keeps everything working offline. No
third-party servers, no telemetry.

> **Status:** BUILT. All five build contracts are complete
> (`contracts/_CONTRACT_INDEX.md`), the test suite is green, and `npm run build`
> emits a working installable PWA. Live Google Drive sign-in needs your own
> credentials in `.env.local` (see below) — everything else works without them.

## What it does (v1)
- Zero-based budgeting (YNAB's four rules): category groups + categories, monthly
  Assigned / Activity / Available, Ready-To-Assign, rollover, cash-vs-credit
  overspend rules, credit-card payment automation, targets (monthly + by-date).
- Accounts (bank / credit card / cash / tracking), transaction register with
  running balance, splits and transfers, reconciliation with adjustment + lock.
- One-time import of an existing 25-column `master_ledger` CSV
  (`data/ledgers/LEDGER_SCHEMA.md`) via Google Picker or a local file, with
  exact + fuzzy dedup (re-import is a no-op).
- Reports: spending by category, net worth, Age of Money — plus Egypt-context
  rescue analytics (card utilization, debt-service ratio, liquidity runway,
  30/60/90 control panel) with formulas cited from `docs/research/`.
  Personal analytics only — not regulated financial advice.
- Installable offline PWA (service worker precaches only local assets).

## Architecture (one line)
`React SPA` → `budget engine (pure, tested)` → `Drive-as-database adapter
(drive.file scope ONLY)` ↔ `Dexie offline cache`. Money is integer
**milliunits** (1 EGP = 1000) — never floats. Details: `docs/architecture/`.

## Run
Requires Node 24 (see `.nvmrc`).

```bash
npm ci                # reproducible install from the lockfile
npm run dev           # local dev server
npm run test          # vitest (unit + component suites)
npm run build         # static SPA + service worker in dist/
npm run preview       # serve the production build locally
npm run verify:all    # full acceptance harness (21 checks)
```

The app runs fully offline/local out of the box (data stays in your browser's
IndexedDB). To use Google Drive as the database:

```bash
cp .env.example .env.local    # then fill the values below
```

1. Create a Google Cloud project; enable the **Drive API** and **Picker API**.
2. Create an OAuth **Web** client id (add your local origin, e.g.
   `http://localhost:5173`) and a browser API key.
3. Put both in `.env.local`. Optionally set a Drive folder id for the database.
4. Start the app and press **Connect Google Drive**. The requested scope is
   `drive.file` only — the app can see only files it created or you picked.

## Repo map
- `src/lib/money` integer money core · `src/lib/drive` Drive-as-DB + sync ·
  `src/lib/db` schema/cache/migrations · `src/features/*` budget, accounts,
  transactions, reconciliation, import, reports
- `contracts/` the five build contracts + build log · `.kiro/specs/` per-contract specs
- `docs/architecture/` design docs · `docs/adr/` decisions · `docs/research/` corpus
- `scripts/verify` acceptance checks · `scripts/loop` verification ledger

## Privacy & safety
- Database = **your** Google Drive, scope `drive.file` ONLY — never full-drive.
- Real ledgers are **gitignored**; only `.example` shapes are committed.
  Secrets live in `.env.local` (gitignored). Tokens stay in memory.
- Account identifiers are redacted (last-4) in the UI.

## Release
See `RELEASE_CHECKLIST.md`. The repository is push-ready; nothing is pushed
until a remote is provided and explicitly confirmed.
