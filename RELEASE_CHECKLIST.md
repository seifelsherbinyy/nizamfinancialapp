# NIZAM Release Checklist — v0.1.0 (2026-07-29)

Push-ready state. The push itself waits for the remote address and an explicit
go from the owner (steering: never push until the user provides the remote).

## Quality gates
- [x] `npm run typecheck` — zero errors (TypeScript strict)
- [x] `npm run lint` — zero errors, zero warnings
- [x] `npm run test` — full suite green (123 tests across 16 files)
- [x] `npm run build` — static SPA + service worker emitted to `dist/`
- [x] `npm run verify:all` — all 17 acceptance checks pass

## Invariants
- [x] Zero placeholder markers in `src/`
- [x] Money is integer milliunits everywhere (invariant scan clean)
- [x] Drive scope is `drive.file` only (scope scan clean)
- [x] Every source file names its owning contract and phase
- [x] No organization-specific term in any tracked file
- [x] Built output references no remote asset (offline-capable)

## Repository hygiene
- [x] No secrets tracked (`.env.local` gitignored; secret scan clean)
- [x] No real ledger data tracked (only `.example` shapes)
- [x] Working tree clean
- [x] No git remote / no remote tracking branch (nothing pushed)
- [x] `.nvmrc` pins Node 24 (active LTS); `npm ci` reproduces from the lockfile

## Documentation
- [x] README states the real build status and verified run steps
- [x] `.env.example` lists exactly the keys the app reads
- [x] CHANGELOG.md written for 0.1.0
- [x] Contracts 1–5 marked DONE in `contracts/_CONTRACT_INDEX.md`
- [x] Build log has one line per completed phase
- [x] Verification ledger intact with one certificate per phase

## Released
- [x] GitHub remote provided by the owner and push explicitly authorized ("push it", 2026-07-29)
- [x] Pushed `master` to `origin` (github.com/seifelsherbinyy/nizamfinancialapp) at commit `4b0a66a`
- [x] Tagged `v0.1.0`
- [x] Pre-push secret scan clean (153 tracked files, zero findings)

## Released — 2026-08-05 (PFOS contract ingestion and analysis)
- [x] Owner granted explicit push authority ("commit you have my full authority on this", 2026-08-05)
- [x] Pre-push secret gate clean: 166 tracked files, zero findings; no secret VALUE appears in
  any tracked file; `.env.local`, `.secrets/*` (client json, token cache, manifest) all untracked
- [x] `npm run verify:all` — **19 of 19** acceptance checks pass *at that release* (adds AC08b, ingestion tooling
  stays isolated from the application; negative-tested on all five of its conditions)
- [x] Test suite green — 135 tests across 16 files (floor 110); no `src/` file modified by this change
- [x] Four PFOS product contracts ingested byte-for-byte with SHA-256 provenance
  (`contracts/pfos/_INGESTION_MANIFEST.json`); re-verified against both the working tree and the
  committed blobs after `.gitattributes` pinned them against end-of-line conversion
- [x] Contracts 05-08 and any prerequisite/readiness/credential document proven ABSENT from the
  drive account (three independent sweeps plus nineteen keyword sweeps) — recorded, not worked around
- [x] Pushed `master` to `origin` at commit `9f5ac27`

### Note on the dated sections above
The 0.1.0 section records 123 tests and 17 checks — the true figures at the 0.1.0 tag. The
2026-08-05 section records 135 tests and 19 checks — the true figures at that release. **The tree
now measures 1714 tests and 20 checks** (AC18, added by Phase 9.0, is the twentieth). The older
numbers are left intact on purpose: those sections are dated release records, not a live dashboard.
The live figure is the one in this paragraph and in `.kiro/steering/pfos-current.md`.

## Still waiting on the owner
- [ ] Google **Web application** OAuth client id + browser API key (U1) and optional
  folder id (U2) in `.env.local` — needed for live Drive sign-in, round-trip, and
  Picker import verification (the tracked credential type on file is a desktop client)
