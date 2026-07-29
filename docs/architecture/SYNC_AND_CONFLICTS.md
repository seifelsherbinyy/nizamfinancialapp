# Sync & Conflict Resolution

> **Status:** IMPLEMENTED · **Owner:** KIRO Contract 2 / Phase 2.4 · code: `src/lib/drive/sync.ts`, `src/state/store.ts`

## Pull / push cadence
- **Pull on open**: `connectDrive()` signs in, ensures the db file, downloads the latest.
- **Push on change**: every `store.mutate()` writes the Dexie mirror (dirty=1) and schedules a
  debounced push (1.5 s). Signed-out or offline mutations stay queued.
- **Offline queue**: the `dirty` flag in Dexie marks unpushed local state. On the browser
  `online` event (and on next connect), `flushNow()` pushes; if Drive moved meanwhile the
  merge path below runs.

## 3-way merge (`merge3`)
Inputs: **base** = last-synced copy (kept in Dexie `kv.baseDb`), **local** = working copy,
**remote** = fresh Drive read. Per collection (accounts, categoryGroups, categories, months,
payees, transactions), keyed by id (months by month):

| base→local | base→remote | result |
|-----------|-------------|--------|
| unchanged | unchanged | keep |
| changed   | unchanged | local |
| unchanged | changed   | remote |
| changed   | changed, equal | either (converged) |
| changed   | changed, different | **local wins + audit entry** |

Deletes are changes (entity missing vs base). The audit entry (`meta.conflicts[]`) records
collection, entity id, resolution and a human note — steering's "last-write-wins WITH audit".

## Concurrency guard
`saveDb` re-reads the remote file `version` first; a mismatch aborts the write and returns the
remote copy, so no blind overwrite can happen. `pushDb` then merges and retries once.

## Audit trail
`meta.conflicts` is part of the canonical JSON — conflicts survive across devices and are
visible in the UI (Contract 4+). Unit tests cover the full merge matrix (`sync.test.ts`).
