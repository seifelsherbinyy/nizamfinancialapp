# NIZAM / PFOS - Kiro development initialization prompt

> Paste this into a fresh Kiro IDE agent session (or drop this file into `.kiro/steering/` so Kiro
> auto-includes it). It is the single onboarding brief for continuing development of NIZAM. The
> repository, its contracts, and its verify harness are the source of truth - this brief points at them.

---

## 0. Your role

You are an AI development agent working in Kiro IDE on **NIZAM**, a single-user **Personal Financial
Operating System (PFOS)**. Currency is EGP; money is always **integer milliunits**. The deterministic
engines are the source of financial truth; the LLM/router tier is strictly additive and **never
calculates a monetary number**. Your job is to keep extending the solution while keeping the full
verification harness green and every safety invariant intact.

## 1. Get the code and prove it is healthy (do this first, every session)

```bash
git clone https://github.com/seifelsherbinyy/nizamfinancialapp.git
cd nizamfinancialapp
git checkout master          # the default branch is master, NOT main
nvm use                      # Node 24, pinned in .nvmrc
npm ci                       # reproducible install from package-lock.json
cp .env.example .env.local   # fill Google keys ONLY when doing live Drive; dev/tests need neither
npm run verify:all -- --all  # MUST print "19 of 19 executed checks passed" before you change anything
```

If the harness is not 19/19 on a clean checkout, stop and report - do not build on a broken base.

## 2. Read the source of truth (in this order) before writing code

1. `contracts/pfos/01..04` - the frozen product contracts (product/constitution, data architecture +
   security, financial intelligence/forecasting/learning, UX/journeys/roadmap).
2. `contracts/pfos/09,10,11` - the OpenRouter LLM-tier phases (benchmark calibration, task/turn
   routing, adaptive cost/quality governance).
3. `contracts/pfos/_PFOS_BUILD_LOG.md` - the running build record: what was built, why, and every
   sealed lesson. Read the tail first.
4. `contracts/pfos/_PFOS_CONTRACT_INDEX.md` - which contracts exist and which are absent.
5. `docs/PFOS_BUILD_READINESS.md`, `docs/PFOS_OPENROUTER_ARCHITECTURE.md`, `docs/PFOS_SECRETS_PLAN.md`.
6. `src/lib/db/schema.ts` - the canonical, tested data model (`NizamDb`).

Contracts outrank docs; docs outrank code comments. Never invent policy an area's contract would
govern - if the contract is absent, author it (clearly marked as NIZAM-derived) before building.

## 3. Non-negotiable invariants (the harness enforces these - keep it at 19/19)

- **Money is integer milliunits.** No floats for money. No `parseFloat` / `Number.parseFloat` /
  `.toFixed(` outside `src/lib/money/`. No decimal literal assigned to a money-named field. (AC07)
- **The deterministic engines are the source of truth.** The LLM/router never computes or sources a
  monetary figure; it explains and routes only.
- **Google Drive scope is `drive.file` only** - never the broad `.../auth/drive` scope. **Drive holds
  encrypted DATA only, never keys or secrets** (contract 02 section 9). (AC08)
- **No secrets in the repo** - only `.env.example`. `.env.local` and `.secrets/` are gitignored and
  must stay that way. (AC08b, AC09)
- **Every source file** (under `src/` and `tests/`) declares its **owning contract and phase** in the
  first 20 lines. (AC10)
- **No organization-specific terms** in any tracked file. (AC11)
- **Benchmark and routing modules stay OUT of the app bundle** - not imported by `App.tsx`/the router;
  they are standalone tested modules. (AC05/AC05b/AC06)
- **Tests only ratchet up.** When you add tests, raise the `--min` floor for AC04 in
  `scripts/verify/all.mjs`.
- **No placeholders** left in `src/`. (AC01)

## 4. Build discipline (every increment, no exceptions)

Design/spec -> implement -> `npm run typecheck` -> `npm run lint` -> `npm run test` ->
`npm run verify:all -- --all` (19/19) -> commit -> push to `master`.

- Put a contract+phase header on every new file; ratchet the AC04 test floor when tests grow.
- Append a short section to `contracts/pfos/_PFOS_BUILD_LOG.md` describing the increment.
- Use conventional commit messages (`feat(pfos): ...`, `docs(pfos): ...`).
- Prefer pure, offline, testable logic behind an injected port; provide a deterministic mock. The live
  adapter (network/key) is a separate, later, gated module.

## 5. Current state (already built and decided)

**Built (offline, server-free, 333 tests, 19/19 harness):**
- Stage 1-4 deterministic engines + UI: money core, budget, safe-to-spend, cash-flow forecast, the
  append-only decision registry, and net worth (assets + FX + macro).
- M2 benchmark harness (`src/features/benchmark/`): the >=210-case eval set, per-category scoring, the
  L0/L1/L2 eligibility gates, the token-cost model, and the frozen pricing snapshot - all offline,
  reached only through an injected `ModelCaller` port with a mock. No live model.
- Model-selection + weekly-budget policy (`src/features/routing/modelPolicy.ts`): the deterministic
  "which model, is it affordable" decision the future live router will call.

**Decided:**
- D1 = **VPS + SQLite** (Profile B). The current Drive-JSON app stays as the Profile-A build; the
  server tier will use SQLite.
- D2 = **OVHcloud, NOT yet provisioned.** All server/hosting/live pieces are blocked until it exists.
- K4 = **OpenRouter, hard USD 5.00/week cap; default {mimo, glm} cheapest-capable; grok/kimi OFF unless
  explicitly opted in for an ultra-complex task.**

## 6. The wall - do NOT build these yet

No live LLM calls, no network, no key usage, no server/hosting/bot/ingestion until ALL of:
the OVHcloud VPS is provisioned + hardened (D2), the OpenRouter key + USD 5/week cap are set in the VPS
secret store (K4), and a **Phase-1 benchmark passes** (no model routes live on reputation). Absent
contracts 05/06/07/08 must be authored (derived, clearly marked) before building their area.

## 7. Immediate next step (recommended)

**Author Contract 06 - Database & Knowledge Model.** It is the missing keystone and it is derivable,
not inventable: fuse the tested `NizamDb` model (`src/lib/db/schema.ts`) + contract 02's named tables
(immutable source-event inbox, statement/document metadata, audit, currencies/exchange-rate) + the
LLM-tier tables the OpenRouter phases imply (**token-spend ledger** for the USD 5/week cap, model
eligibility registry, pricing snapshots, benchmark runs, routing telemetry, escalation log). End it
with a machine-executable JSON-schema block like the other contracts.

Then build + test (offline, Node 24 `node:sqlite`) the SQLite schema, the Drive-JSON -> SQLite
migration, a repository layer, and the token-spend ledger that supplies `modelPolicy`'s
`spentThisWeekUsd`.

**Decision to settle first (does NOT block contract 06, which is runtime-agnostic):** the **server
runtime**. Contract 02 names Python + FastAPI. The entire money-critical core is TypeScript with 333
tests and an enforced money invariant. Choosing Node/TypeScript reuses that core and keeps a single
money implementation (recommended); choosing Python forces a second integer-money implementation that
must stay bit-identical. Decide before authoring Contract 05 (orchestration) or building the server.

## 8. Ask the human before

Overwriting `.env.local`; any `git push --force`; weakening or skipping a harness check; committing any
secret; or building any server/live-key/network piece while the wall in section 6 still stands.

---

*Prepared 2026-08-06. Repo state at handoff: branch `master`, working tree clean, 19/19 harness,
333 tests. Nothing secret is or was tracked.*
