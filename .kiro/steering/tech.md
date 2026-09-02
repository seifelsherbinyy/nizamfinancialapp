# Tech — NIZAM
- **App:** Vite + React 18 + TypeScript (strict, noUncheckedIndexedAccess). Path alias `@/*` -> `src/*`.
- **State:** Zustand. **Offline cache:** IndexedDB via Dexie (local mirror of the canonical DB).
- **Database:** Google Drive (scope `drive.file` ONLY — app-created files; never request full `drive` scope). Canonical store = a single `nizam_db.json` in a NIZAM Drive folder + dated snapshots. Existing ledgers imported one-time via Google Picker. **D1 (2026-08-06): the SERVER tier will use VPS + SQLite - this Drive-JSON store is the Profile-A build, NOT the final database. Drive holds encrypted DATA only, never keys or secrets.**
- **Auth:** Google Identity Services (GIS) token client in-browser. Tokens in memory/session; never committed.
- **Money:** integer **milliunits** (1 EGP = 1000). NEVER floats. All arithmetic through `src/lib/money`.
- **Tests:** Vitest + Testing Library. Money + budget engine + dedup must have unit tests.
- **Build target:** static SPA (deployable to GitHub Pages / any static host). PWA/offline in Contract 5.
- **Secrets:** `.env.local` only (gitignored). `.env.example` documents keys. Real ledgers gitignored.
