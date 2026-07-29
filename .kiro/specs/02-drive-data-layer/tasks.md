# Tasks — Google Drive Data Layer

> Tick as the loop completes each. Append results to `contracts/_BUILD_LOG.md`.

- [x] Phase 1: GIS token client (drive.file)
- [x] Phase 2: Drive REST client
- [x] Phase 3: nizam_db schema + zod
- [x] Phase 4: atomic driveDb save + snapshots
- [x] Phase 5: Dexie cache + hydrate
- [x] Phase 6: sync + conflict merge
- [x] Phase 7: Picker + import + dedup
- [x] Phase 8: Integration test harness

## Gate
- [x] typecheck green  - [x] tests green  - [x] build green (where applicable)

## Manual verification pending user credentials (.env.local)
- [ ] Interactive sign-in yields a token with exactly drive.file (asserted in code)
- [ ] Live Drive round-trip + snapshot visible in the user's Drive
- [ ] Picker grants access to the picked master_ledger CSV
