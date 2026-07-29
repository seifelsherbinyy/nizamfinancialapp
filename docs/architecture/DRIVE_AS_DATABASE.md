# Google Drive as the Database

> **Status:** IMPLEMENTED · **Owner:** KIRO Contract 2 / Phase 2.2 · code: `src/lib/drive/`

## Scope rationale (drive.file, not full drive)
The app requests exactly `https://www.googleapis.com/auth/drive.file` — a non-sensitive scope
under which the app can only see (a) files it created and (b) files the user explicitly picked
via Google Picker. The user's wider Drive is invisible to NIZAM by construction. Full `drive`
scope is never requested; `oauth.ts` asserts every granted token contains drive.file and
nothing broader (`assertDriveFileScopeOnly`).

## Canonical store
- Folder `NIZAM` (or the folder in `VITE_NIZAM_DRIVE_FOLDER_ID`) holds one canonical
  `nizam_db.json`, tagged `appProperties.nizam=db`.
- Schema: `src/lib/db/schema.ts` (zod-validated on every load); migrations forward-only in
  `src/lib/db/migrations.ts`.

## Atomic write discipline (`driveDb.saveDb`)
1. **Version guard** — remote `version` must equal our last-synced version, else the save
   returns `{conflict: true, remote}` and the caller merges (see SYNC_AND_CONFLICTS.md).
2. **Snapshot first** — `nizam_db.YYYYMMDD-HHmm.json` (tag `nizam=snapshot`) is uploaded
   BEFORE the canonical write, so a crash mid-save never loses the previous state.
3. **Media update** — the canonical file is updated in a single Drive call (atomic per call).
4. **Prune** — snapshots beyond the newest 10 are deleted (best-effort).

## Versioning / etag
Drive v3 exposes a monotonically increasing `version` per file; it is captured with
`fields=...version` on every read/write and stored in the Dexie `kv` table as
`lastSyncedVersion`. This is the optimistic-concurrency token for multi-device use.

## Backup snapshots
Every successful save produces a dated snapshot in the same folder (retain 10). Restoring =
copying a snapshot's content back over `nizam_db.json` (manual, by design for v1).
