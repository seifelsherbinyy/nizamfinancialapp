<!-- NIZAM BUILD CONTRACT — machine+human readable. KIRO: execute phases in order, loop each phase to a GREEN gate before advancing (see contracts/_KIRO_LOOP_PROTOCOL.md). Honor .kiro/steering/*. -->
# Contract 5 — Reports, Rescue Analytics & Release
- **id:** C5 · **depends on:** C1-C4 · **produces:** reports + Egypt rescue widgets + PWA + push-ready release
- **spec:** `.kiro/specs/05-reports-release/` · **steering:** product.md, tech.md, loop-protocol.md

## Objective
Add reporting and the Egypt-context "rescue" intelligence from the research docs, make it an installable offline PWA, produce a clean production build, and leave the repo ready to `git push` to the GitHub remote (provided later).

## Inputs
- C4 UI; `src/features/reports/*`; `docs/research/*` (liquidity buffer, loan-readiness, iScore levers); PWA assets.

## Phases
### Phase 5.1 — Core reports
- Tasks: `spending.ts`, `netWorth.ts`, `ageOfMoney.ts` + charts in `Reports.tsx`.
- **Gate:** reports compute from store; unit tests on calcs.

### Phase 5.2 — Rescue analytics (research-driven)
- Tasks: widgets for card utilization, FOIR/debt-service ratio, liquidity runway, 30/60/90 control panel — formulas sourced from `docs/research/*`. Vendor-neutral, personal only.
- **Gate:** widgets render from real imported data; formulas cite the research doc.

### Phase 5.3 — PWA / offline
- Tasks: manifest + service worker; app shell caches; works offline (reads from Dexie); sync on reconnect.
- **Gate:** Lighthouse PWA installable; offline load works.

### Phase 5.4 — Production build + docs
- Tasks: `npm run build` static SPA; finalize README run/setup/deploy steps; verify `.env.example`; confirm real ledgers gitignored.
- **Gate:** fresh clone -> `npm i && npm run build` works from README alone.

### Phase 5.5 — Push-ready release
- Tasks: version tag, CHANGELOG, ensure no secrets/real data committed (`git status` clean, .gitignore honored); prepare `git remote add origin <PROVIDED_REPO>` instructions (DO NOT push until the user provides the remote + confirms).
- **Gate:** `git status` clean; secret-scan clean; release checklist complete.

## Definition of Done
Reports + rescue analytics live, PWA offline, production build works from README, repo clean and push-ready. Mark C5 DONE and the FULL BUILD complete.
