# Changelog

All notable changes to NIZAM. Format loosely follows Keep a Changelog; the
project adheres to semantic versioning from 0.1.0 onward.

## [Unreleased]

### Added
- Budget grid target editing (post-release item R2): set / clear a monthly or
  by-date target per category from the grid; goal badge shows funding progress
  and the suggested per-month amount for by-date targets (engine support landed
  in Contract 3 / Phase 3.5; this exposes it in the UI).

### Changed
- AC15 release check now recognizes an owner-acknowledged release: a remote
  branch with a "Released" section in RELEASE_CHECKLIST.md passes; an
  unrecorded remote branch still fails (accidental-push detection preserved).

## [0.1.0] — 2026-07-29

First complete build. All five build contracts executed and verified
(`contracts/_BUILD_LOG.md` has the per-phase gate record; the hash-chained
verification ledger in `.loop/` carries one certificate per phase).

### Added
- **Foundation (C1)**: Vite + React 18 + TypeScript strict toolchain; integer
  milliunit money core (`fromDecimal`/`toDecimal`, drift-free `allocate`,
  EGP formatting for `en`/`ar-EG`); domain types incl. the 25-column ledger contract.
- **Google Drive data layer (C2)**: GIS token-client auth with `drive.file`
  scope only (asserted); Drive REST v3 client with backoff; atomic
  `nizam_db.json` save with snapshot-first ordering + retention; zod-validated
  schema + forward-only migrations; Dexie offline mirror; 3-way merge sync with
  conflict audit; Google Picker + pure CSV import engine with exact/fuzzy dedup.
- **Budget engine (C3)**: YNAB-parity zero-based math — Assigned/Activity/
  Available, Ready-To-Assign, rollover, cash-vs-credit overspend, credit-card
  payment automation, monthly + target-by-date goals. Fully unit-tested.
- **UI (C4)**: YNAB-style shell with accounts sidebar (redacted identifiers),
  budget grid with editable Assigned + RAG Available, transaction register with
  running balance, entry form with exact-sum splits and linked transfers,
  reconciliation with adjustment + lock, import wizard over the pure engine.
- **Reports & release (C5)**: spending / net worth / Age of Money reports with
  inline-SVG charts; Egypt-context rescue analytics (card utilization,
  debt-service ratio, liquidity runway, 30/60/90 panel) with research-cited
  formulas; installable offline PWA (local-asset-only precache); acceptance
  harness `npm run verify:all` (17 checks) and the verification ledger.

### Security / privacy
- Drive scope is `drive.file` only; tokens live in memory; secrets only in
  `.env.local` (gitignored); real ledgers gitignored; identifiers redacted to
  last-4 in the UI; no telemetry; the built output references no remote assets.
