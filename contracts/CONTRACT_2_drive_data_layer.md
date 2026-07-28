<!-- NIZAM BUILD CONTRACT — machine+human readable. KIRO: execute phases in order, loop each phase to a GREEN gate before advancing (see contracts/_KIRO_LOOP_PROTOCOL.md). Honor .kiro/steering/*. -->
# Contract 2 — Google Drive Data Layer (the database)
- **id:** C2 · **depends on:** C1 · **produces:** working Drive-as-database with offline cache, sync, and one-time ledger import
- **spec:** `.kiro/specs/02-drive-data-layer/` · **steering:** drive-db.md, tech.md

## Objective
Make Google Drive the canonical database. The app authenticates with `drive.file` scope ONLY, stores `nizam_db.json` in a NIZAM Drive folder (atomic + snapshots), mirrors it to a Dexie cache for offline, syncs with conflict resolution, and imports the user's EXISTING master_ledger once via Google Picker.

## Inputs
- C1 types + money; `src/lib/drive/*`, `src/lib/db/*`, `src/lib/ledger/*`, `src/state/store.ts`, `src/features/import/*`.
- `data/ledgers/LEDGER_SCHEMA.md` (authoritative 25-col import contract).

## Phases
### Phase 2.1 — Auth (drive.file)
- Tasks: `oauth.ts` GIS token client, scope `drive.file` ONLY; sign-in/out; token in memory. ASSERT never requests broader scope.
- **Gate:** interactive sign-in yields a token with exactly drive.file.

### Phase 2.2 — Drive DB adapter
- Tasks: `driveClient.ts` (files list/get/create/update media); `db/schema.ts` (+ zod) & `driveDb.ts` (ensure folder+file, load, ATOMIC save via temp+update, dated snapshot, version/etag capture).
- **Gate:** create -> save -> reload round-trips a nizam_db.json in Drive; a snapshot appears.

### Phase 2.3 — Local cache + migrations
- Tasks: `db/localCache.ts` (Dexie tables mirroring schema), `db/migrations.ts` (forward-only), `lib/ledger/ledgerStore.ts` read model, hydrate cache from Drive.
- **Gate:** app reads from cache offline; migration v0->v1 idempotent.

### Phase 2.4 — Sync + conflicts
- Tasks: `sync.ts` pull-on-open / debounced push-on-change; 3-way merge on version conflict; offline dirty queue; conflict audit in meta. Wire `state/store.ts`.
- **Gate:** simulated concurrent edit resolves deterministically + logs a conflict entry; offline edits flush on reconnect.

### Phase 2.5 — Import existing ledger
- Tasks: `drive/picker.ts` (Google Picker, drive.file grant on pick); `features/import/ledgerImport.ts` (parse per LEDGER_SCHEMA, dedup via duplicate_key + fuzzy, map to Transaction, respect confidence). 
- **Gate:** importing a sample 25-col CSV yields deduped transactions merged into nizam_db.json; a re-import is a no-op (idempotent dedup).

## Definition of Done
Sign-in (drive.file), DB round-trip + snapshots, offline cache, sync/merge, and idempotent ledger import all verified. Integration harness green. Mark C2 DONE.
