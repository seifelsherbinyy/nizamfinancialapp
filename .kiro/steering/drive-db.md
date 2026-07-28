# Drive-as-Database (design contract)
- **Scope:** `https://www.googleapis.com/auth/drive.file` — the app only ever sees files it created + files the user explicitly picks. NEVER request `drive` (full) scope.
- **Canonical store:** one JSON file `nizam_db.json` inside a NIZAM app folder in the user's Drive. Schema in `src/lib/db/schema.ts`, validated with zod.
- **Writes are atomic:** write to a temp file then update; keep the previous version id; drop a dated snapshot `nizam_db.YYYYMMDD-HHmm.json` on each successful save (retain N).
- **Concurrency:** use Drive file version/etag; if remote changed since last pull -> run 3-way merge (base = last-synced, local = cache, remote = drive). Fallback: last-write-wins WITH an audit entry in `meta.conflicts`.
- **Offline:** Dexie is the working mirror; a `dirty` queue flushes to Drive when online.
- **Import of EXISTING data:** the master_ledger CSV (and credit_limits) are imported ONCE via Google Picker (grants drive.file on the picked file), parsed per `data/ledgers/LEDGER_SCHEMA.md`, deduped, and merged into `nizam_db.json`.
- **No external/organizational data** is ever read or written by this app — it is a personal-finance app bound to the user's own personal Drive only.
