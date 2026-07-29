# Design — Google Drive Data Layer

> Expanded by KIRO during Contract 2. Honor `.kiro/steering/*` (drive-db.md is the contract).

## Decisions (researched)

### Auth — Google Identity Services token client (Phase 2.1)
- Use the GIS **token model** (`google.accounts.oauth2.initTokenClient`) — the implicit-grant
  flow recommended for browser SPAs that call Google APIs directly. Access tokens are
  short-lived (~1h), held in memory only; re-auth re-runs `requestAccessToken()`.
  Ref: https://developers.google.com/identity/oauth2/web/guides/use-token-model
- Scope is **exactly** `https://www.googleapis.com/auth/drive.file`. It is a *recommended /
  non-sensitive* scope: the app can only see files it created or that the user picked via
  Google Picker. Ref: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- The token response's `scope` field is asserted to contain drive.file and nothing broader.

### Drive REST client (Phase 2.2)
- Plain `fetch` against Drive **API v3** (`https://www.googleapis.com/drive/v3`), no gapi client
  library needed for REST calls: `files.list` (q + fields), `files.get` (`alt=media` for content),
  multipart `files.create` (uploadType=multipart), media `files.update` (uploadType=media|multipart).
  Ref: https://developers.google.com/workspace/drive/api/reference/rest/v3
- Exponential backoff with jitter on HTTP 403 (rate), 429, 5xx.
- `fields=id,name,version,modifiedTime,parents,appProperties` captured on every write; Drive's
  `version` (monotonically increasing per-file) is our optimistic-concurrency guard.

### Canonical DB file (Phase 2.2)
- One JSON document `nizam_db.json` in a NIZAM folder (folder id from `VITE_NIZAM_DRIVE_FOLDER_ID`
  or app-created). Schema in `src/lib/db/schema.ts`, validated with zod on every load.
- **Atomic-save discipline**: Drive media updates are atomic per call. Save order is
  (1) read current remote `version` and require it to equal our last-synced version,
  (2) upload snapshot `nizam_db.YYYYMMDD-HHmm.json`, (3) media-update the canonical file,
  (4) capture the new `version`. Snapshots retained: newest 10 (pruned after save).
- Files are tagged `appProperties.nizam=db|snapshot` so `files.list` can find them under
  drive.file scope.

### Local cache (Phase 2.3)
- Dexie v4 database `nizam_cache` mirrors the schema per-entity (accounts, categoryGroups,
  categories, months, payees, transactions) + `kv` table (dbFileId, lastSyncedVersion,
  base snapshot for 3-way merge, dirty flag). Ref: https://dexie.org/docs/Tutorial/Design
- Migrations are forward-only, idempotent, pure functions over the raw JSON (v0 example shape
  -> v1 current schema).

### Sync + conflicts (Phase 2.4)
- Pull-on-open, debounced push-on-change (1.5s), online/offline listeners; a `dirty` flag in
  Dexie queues offline edits and flushes on `online`.
- Version conflict -> **3-way entity merge** (base = last-synced copy, local = cache, remote =
  fresh Drive read): per collection keyed by id — only-local-changed wins locally, only-remote-
  changed takes remote, both-changed = local wins (the saving device) **with an audit entry**
  appended to `meta.conflicts` (steering fallback: LWW + audit). Deletions detected vs base.
- Merge is a pure function (`merge3`) with unit tests.

### Import (Phase 2.5)
- Google Picker grants drive.file access to the *picked* file only. Picker is loaded from
  `https://apis.google.com/js/api.js` (`gapi.load('picker')`) and built with the OAuth token +
  API key. Ref: https://developers.google.com/workspace/drive/picker/guides/overview
- `ledgerImport.ts` parses the 25-column CSV per `data/ledgers/LEDGER_SCHEMA.md`:
  RFC-4180 quote-aware parser; money columns are integer milliunits (decimal values tolerated
  and converted via `fromDecimal`); dedup key = `duplicate_key` column, falling back to a
  deterministic hash of (date|amount|account|payee); plus fuzzy pass (same account+amount,
  ±3 days, normalized payee). Re-import is a no-op (existing duplicate keys skipped);
  `is_duplicate=true` rows skipped; confidence carried into `Transaction.importInfo`.

## Test strategy
Interactive OAuth/Picker cannot run headless — covered by manual checklist (needs `.env.local`
credentials). Everything else is unit-tested: schema round-trip, migration idempotence,
driveDb save/load against a mocked Drive client, merge3 matrix, CSV parse + dedup idempotence
(fake-indexeddb backs Dexie in vitest).
