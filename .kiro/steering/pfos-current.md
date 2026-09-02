# PFOS current state (AUTHORITATIVE)

**Precedence:** where this file conflicts with `loop-protocol.md`, `tech.md`, or `structure.md`, **this
file wins.** Those three describe the original 5-contract Drive-JSON build, which is DONE.

## What changed since the original 5 contracts
- Original build contracts 1-5 are **DONE**. Active work is the **PFOS layer** under `contracts/pfos/`
  (product contracts 01-04 + OpenRouter phases 09/10/11) plus the briefs in `docs/`.
- Built since: PFOS Stage 1-4 deterministic engines + UI (obligations, safe-to-spend, cash-flow
  forecast, append-only decision registry, net worth with assets/FX/macro); the **M2 benchmark harness**
  (`src/features/benchmark/`); the **model-selection + weekly-budget policy**
  (`src/features/routing/modelPolicy.ts`). 333 tests.
- **THE GATE IS NOW `npm run verify:all -- --all`, which must print "21 of 21 executed checks passed".**
  `typecheck` / `test` / `build` alone are NO LONGER sufficient.

## Decisions in force
- **D1 = VPS + SQLite** for the server tier. The Drive-JSON store is the **Profile-A** build, not the
  final database. Do not provision SQLite until the VPS exists.
- **D2 = OVHcloud, NOT provisioned.** All server / hosting / bot / ingestion work is blocked.
- **K4 = OpenRouter, hard USD 5.00/week cap.** Default allowed models are {`xiaomi/mimo-v2.5`,
  `z-ai/glm-5.2`}, choosing the **cheapest capable**. `x-ai/grok-4.5` and `moonshotai/kimi-k3` are OFF
  unless the owner **explicitly opts in** for an ultra-complex task.

## Added invariants (on top of money-rules.md and drive-db.md)
- Every file under `src/` and `tests/` declares its **owning contract and phase** in the first 20 lines.
- No `parseFloat` / `Number.parseFloat` / `.toFixed(` outside `src/lib/money/`; no decimal literal
  assigned to a money-named field.
- **Drive holds encrypted DATA only - never keys or secrets.** Scope stays `drive.file`.
- No secret is ever tracked; only `.env.example`. `.env.local` and `.secrets/` stay gitignored.
- No organization-specific terms in any tracked file.
- `src/features/benchmark/` and `src/features/routing/` must stay **OUT of the app bundle** - never
  imported by `App.tsx` or the router. They are standalone tested modules.
- Tests only ratchet **up**: raise the AC04 `--min` floor in `scripts/verify/all.mjs` when tests grow.
- The LLM / router tier **never computes or sources a monetary number** - the deterministic engines do.

## The wall - do NOT build
No live LLM call, no network, no key use, and no server / hosting / bot / ingestion until **all** of:
the OVHcloud VPS is provisioned + hardened, the OpenRouter key + USD 5/week cap are set in the VPS secret
store, and a **Phase-1 benchmark passes**. Build offline logic behind an **injected port with a
deterministic mock**; the live adapter is a separate, later, gated module.

## Missing contracts
05 (agent orchestration/tooling), 06 (database & knowledge model), 07 (testing/validation/benchmarking),
and 08 (research) were never authored. **Author the relevant one** (clearly marked NIZAM-derived) BEFORE
building its area - never invent policy a contract would govern.

## Next step
Author **Contract 06 - Database & Knowledge Model**, then build the offline SQLite layer + the
token-spend ledger that supplies `modelPolicy`. Full brief: `docs/KIRO_ONBOARDING.md`.
**Open decision to settle first:** the server runtime - Node/TypeScript reuses the existing tested money
core and engines (recommended); Python/FastAPI is contract 02's letter but forces a second
integer-money implementation that must stay bit-identical.

## Per-increment loop
spec/design -> implement -> `npm run typecheck` -> `npm run lint` -> `npm run test` ->
`npm run verify:all -- --all` (21/21) -> tick the spec `tasks.md` -> append a section to
`contracts/pfos/_PFOS_BUILD_LOG.md` -> commit -> push to `master`.

> Master handoff / full-stack build context for the IDE agent: `docs/KIRO_HANDOFF.md` (read after this file).
