# Architecture Overview

> **Status:** IMPLEMENTED · **Owner:** KIRO Contract 1 (final form Contract 5 / Phase 5.4)

## Component diagram
```
┌────────────────────────── Browser (static SPA, installable PWA) ─────────────────────────┐
│                                                                                          │
│  React UI (features/)                     State (state/)                                 │
│  ├─ BudgetView (grid, RTA)                ├─ Zustand store: db in memory,                │
│  ├─ Register + TransactionForm            │   mutate() → cache → debounced push          │
│  ├─ Reconcile · ImportWizard              └─ actions.ts (pure domain mutations)          │
│  └─ Reports (+ rescue analytics)                                                         │
│           │ selectors                                                                    │
│           ▼                                                                              │
│  Budget engine (features/budget/budget.logic.ts) — pure, YNAB math                       │
│  Ledger read model (lib/ledger/ledgerStore.ts) — memoized indexes                        │
│           │                                                                              │
│           ▼                                                                              │
│  lib/db: schema.ts (zod) · migrations.ts · localCache.ts (Dexie/IndexedDB mirror)        │
│           │                                        ▲                                     │
│           ▼                                        │ offline reads/writes                │
│  lib/drive: oauth.ts (GIS, drive.file ONLY) · driveClient.ts (REST v3)                   │
│             driveDb.ts (atomic save + snapshots) · sync.ts (3-way merge) · picker.ts     │
└───────────┬──────────────────────────────────────────────────────────────────────────────┘
            ▼
   The user's own Google Drive: NIZAM/nizam_db.json + dated snapshots (the database)
```

## Data flow
1. **Boot**: hydrate from the Dexie cache (offline-first); a fresh local db is
   created when nothing exists yet.
2. **Edit**: every mutation goes through `store.mutate()` → new immutable db →
   Dexie mirror (dirty flag) → debounced push to Drive when signed in + online.
3. **Sync**: push checks the Drive file `version`; on conflict a 3-way entity
   merge runs (base = last-synced, local wins on true conflicts, audited in
   `meta.conflicts`). See `SYNC_AND_CONFLICTS.md`.
4. **Import**: Google Picker grants access to just the picked ledger CSV; the
   pure import engine parses/dedups and merges. Re-import is a no-op.
5. **Offline**: the service worker precaches the app shell (local assets only);
   data reads come from Dexie; the dirty queue flushes on reconnect.

## Tech choices
| Concern | Choice | Why |
|---|---|---|
| UI | React 18 + TypeScript strict + Vite | steering tech.md; typed, fast static build |
| State | Zustand | minimal, hook-based, no provider tree |
| Money | integer milliunits via `lib/money` | money-rules.md invariant; drift-free `allocate` |
| Database | Google Drive (`drive.file` only) | user owns the data; ADR-0001/0002 |
| Offline | Dexie (IndexedDB) mirror + dirty queue | local-first; survives restarts |
| Validation | zod on every db load | corrupt/foreign JSON can never enter |
| Routing | tiny hash router | static-host friendly, zero dependency |
| Charts | inline SVG | no chart library, offline by construction |
| PWA | vite-plugin-pwa (generateSW) | precaches only local build assets |
| Tests | Vitest + Testing Library (+ fake-indexeddb) | engine parity + component behavior |
