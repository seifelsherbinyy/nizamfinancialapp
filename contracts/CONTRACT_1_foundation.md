<!-- NIZAM BUILD CONTRACT — machine+human readable. KIRO: execute phases in order, loop each phase to a GREEN gate before advancing (see contracts/_KIRO_LOOP_PROTOCOL.md). Honor .kiro/steering/*. -->
# Contract 1 — Foundation & Scaffolding
- **id:** C1 · **depends on:** none · **produces:** a building React+TS app + money core + domain types
- **spec:** `.kiro/specs/01-foundation/` · **steering:** tech.md, structure.md, money-rules.md

## Objective
Stand up the toolchain and the two things everything else depends on: an integer-money core and the domain type system. When C1 is done, `npm run build` and `npm run test` are green on an empty-but-correct app.

## Inputs
- Steering docs; `package.json`/`tsconfig`/`vite.config.ts` placeholders; `src/lib/money/*`; `src/features/*/**.types.ts`.

## Phases
### Phase 1.1 — Project init
- Goal: real dependency set pinned; app boots.
- Tasks: fill `package.json` deps (react, react-dom, zustand, dexie, zod; dev: vite, typescript, @vitejs/plugin-react, vitest, @testing-library/react, jsdom, eslint, prettier). `npm install`.
- Files: package.json.
- **Gate:** `npm install` succeeds; `npm run dev` serves a blank root.

### Phase 1.2 — Tooling
- Tasks: finalize tsconfig (strict, `@/*`), vite.config (react plugin, alias, vitest jsdom + tests/setup.ts), eslint+prettier.
- Files: tsconfig.json, vite.config.ts, tests/setup.ts, .eslintrc, .prettierrc.
- **Gate:** `npm run typecheck` = 0 errors; `npm run lint` clean.

### Phase 1.3 — App shell
- Tasks: implement `src/main.tsx`, `src/App.tsx`, `app/providers.tsx`, `app/router.tsx` (routes stubbed).
- **Gate:** `npm run build` produces dist; app renders shell.

### Phase 1.4 — Money core
- Tasks: implement `src/lib/money/money.ts` per money-rules.md (fromDecimal/toDecimal, add/sub/mul, allocate, format EGP).
- **Gate:** typecheck green.

### Phase 1.5 — Money tests + domain types
- Tasks: complete `money.test.ts` (round-trip, no-drift, allocate-sums-exact, negatives); implement domain type modules (budget/accounts/transactions .types.ts) + ledger.types.ts.
- **Gate:** `npm run test` green; typecheck green.

## Definition of Done
`npm install`, `typecheck`, `lint`, `test`, `build` ALL green. Money core fully tested. Mark C1 DONE in `_CONTRACT_INDEX.md`.
