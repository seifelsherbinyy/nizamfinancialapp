# NIZAM — Kiro Handoff & Full-Stack Build Context

> Master entry brief for the Kiro IDE agent. Read `.kiro/steering/` first
> (`pfos-current.md` is authoritative and takes precedence where the older
> steering files disagree), then read this, then the contracts in §3.
> Do **not** clone — this working folder **is** the repo at HEAD.

---

## 1. Repository

| | |
|---|---|
| Remote | `https://github.com/seifelsherbinyy/nizamfinancialapp.git` (PUBLIC) |
| Branch | `master` (**not** `main`) |
| Local | this folder is the repo, clean and synced with origin |
| Toolchain | Node 24 (`.nvmrc`), `node:sqlite` available natively; deps installed |
| Gate | `npm run verify:all -- --all` must print `21 of 21 executed checks passed` |

First action: run the gate to prove the baseline. If it is not 21/21, stop and report.
Never force-push; never rewrite `master` history. Push each green increment.

Because the repo is PUBLIC, a secret in any **tracked** file leaks to the world.
Before every `git add`, confirm nothing secret is staged:
`git ls-files | grep -Ei "\.env|\.secrets/|\.key|client_secret"` → must show **only** `.env.example`.

---

## 2. Google Drive access — used BY REFERENCE, never printed or committed

Purpose: Profile-A storage. The app reads/writes `nizam_db.json` (+ statement files) in
the owner's Google Drive using the narrow **`drive.file`** scope only.

Credentials live LOCALLY, are git-ignored, and sit outside any synced cloud folder:

| Where | Holds | Rule |
|---|---|---|
| `.env.local` → `VITE_GOOGLE_CLIENT_ID` | OAuth **Web** client id | ships in the browser (public) — fine |
| `.env.local` → `VITE_GOOGLE_API_KEY` | browser API key (Picker import) | referrer-locked to `http://localhost:5173` |
| `.env.local` → `VITE_NIZAM_DRIVE_FOLDER_ID` | optional folder id | blank = app creates/finds a "NIZAM" folder |
| `.secrets/google-oauth-web.client.json` | canonical Web client | its `client_secret` is **not** used by the SPA and never enters browser code |
| `.secrets/google-oauth-desktop.client.json` | CLI / loopback ingest fallback | not used by the browser app |
| `.secrets/openrouter.dev.key` | OpenRouter **dev** key | **not** `VITE_`-prefixed; live LLM calls blocked until the VPS exists |

**Origin is pinned:** `vite.config.ts` uses `strictPort: true` on port 5173, so the
`http://localhost:5173` origin (which the client id + API key are locked to) can never
drift. The **same** client id and API key are valid for every dev session and every
developer — do not create new ones.

**Hard rules (Kiro and any developer):**
- Use secrets **by reference** — the running process reads `.env.local` / `.secrets/`.
  Never print a secret value into chat, a log, or a commit.
- Never commit `.env.local` or `.secrets/`; never upload any key to Drive.
- Google Drive is **not** a secret tier — it holds only the (to-be-encrypted) data
  payload; the keys stay in the secret tier. See `docs/PFOS_SECRETS_PLAN.md`.
- The interactive OAuth consent (account sign-in + `drive.file` grant) is a **human**
  step done in the owner's own browser; it cannot be automated.

`npm run dev` and any Node tool pick these up automatically — that is the "access":
the local process reads the local env with zero friction.

---

## 3. Contracts — the source of truth (supplementary support for the whole stack)

The contracts define WHAT to build; the specs (§6) translate a contract into EARS
acceptance criteria + phased tasks. Treat the contract as authoritative for
requirements, the steering for conventions, and this doc for orchestration.

`contracts/pfos/` (authoritative):
- `01_PFOS_Product_Constitution_and_Problem_Solution_Logic.md` — product constitution.
- `02_PFOS_Data_Architecture_Integrations_and_Security.md` — **data model + security**:
  SQLite + WAL, the live DB on the VPS local filesystem (never in a synced folder),
  the named tables (account, obligation, transaction, source-event, statement, asset,
  decision, audit, currencies/exchange-rate, immutable event inbox), and secret
  custody (§9). This is the primary input to Contract 06.
- `03_PFOS_Financial_Intelligence_Decision_Forecasting_and_Learning.md` — the engines.
- `04_PFOS_UX_UI_User_Journeys_Research_and_Delivery_Roadmap.md` — UX/UI + roadmap.
- `09/10/11_PFOS_OpenRouter_Phase_1/2/3...md` — LLM benchmark, routing, cost governance.
- `_PFOS_CONTRACT_INDEX.md` — contract ledger. `_PFOS_BUILD_LOG.md` — append per increment.

`.kiro/specs/` (format template — match these exactly for new specs):
`01-foundation`, `02-drive-data-layer`, `03-budget-engine`, `04-ui-ynab`,
`05-reports-release`, each with `requirements.md` / `design.md` / `tasks.md`.

`contracts/_CONTRACT_INDEX.md` + `contracts/_BUILD_LOG.md` are a separate read-only
ledger (AC12) — do **not** edit them; PFOS work is logged in `contracts/pfos/`.

---

## 4. Already built — do NOT rebuild

- Stage 1–4 engines: obligations, safe-to-spend, decision cards, forecasting +
  registry, multi-currency net worth. Full UI (home, budget, decide, forecast,
  decisions, networth, obligations, settings, reports, import, reconcile).
- Offline OpenRouter harness: `src/features/benchmark` (Phase-1 benchmark, no key)
  and `src/features/routing/modelPolicy` (offline model selection). Both are
  **isolated from the app bundle** and must stay that way (AC05/AC06).
- Integer-money core: `src/lib/money` (minor units only). AC07 forbids float money
  (`parseFloat`, `.toFixed(`, decimal literals on money fields) everywhere else.
- Drive-JSON store (`src/lib/db/schema.ts`, `NizamDb`) — the current Profile-A DB.
- 333 tests / 37 files at the 2026-08-06 handoff, when the gate was 19/19. The gate is **21/21**
  now (AC18 added by Phase 9.0, AC19 with the tracked implementation surface) and the suite has
  grown well past that figure; the numbers on this line are the dated handoff state, not a live
  count.

---

## 5. Decisions in force + what is blocked

- **D1 = VPS + SQLite** for the server tier. Drive-JSON stays as Profile A. Do not
  provision SQLite until the VPS exists.
- **D2 = OVHcloud, NOT provisioned.** Therefore the server, hosting, bot, live
  ingestion, and live LLM calls are **all blocked** — do not attempt them.
- **K4 = OpenRouter, hard USD 5.00/week cap.** Default allowed models
  `{xiaomi/mimo-v2.5, z-ai/glm-5.2}`; `x-ai/grok-4.5` + `moonshotai/kimi-k3` OFF
  unless an explicit ultra-complex opt-in.
- **Open decision (gates the server, not Contract 06):** server runtime —
  Node/TS (recommended: reuses the 333-test money core) vs Python/FastAPI
  (contract 02's letter). Contract 06 is runtime-agnostic, so build it now.

---

## 6. Next build — Contract 06, Database & Knowledge Model (offline, unblocked)

Create the spec, matching the existing 5 specs' shape:
`.kiro/specs/06-database-knowledge-model/{requirements.md, design.md, tasks.md}`
- `requirements.md`: `# Requirements — Database & Knowledge Model`, then
  `> KIRO spec for Contract 06. Full contract: contracts/pfos/06-database-knowledge-model.md. Read steering first.`,
  then `## User story`, then `## Acceptance criteria (EARS)` in
  `THE SYSTEM SHALL` / `WHEN … THE SYSTEM SHALL` form.
- `tasks.md`: `- [ ] Phase N: …` checkboxes + `## Gate` + `## Waiting on user input`.

Author `contracts/pfos/06-database-knowledge-model.md`, deriving the SQLite schema from:
1. `src/lib/db/schema.ts` — the existing `NizamDb` shape.
2. Contract 02's named tables (see §3).
3. NEW LLM-tier tables: token-spend ledger enforcing the USD 5/week cap,
   model-eligibility registry, pricing snapshots, benchmark runs, routing
   telemetry, escalation log.
End with a machine-executable JSON-schema block.

Then build, offline, with Node 24 `node:sqlite`: the SQLite layer, a
Drive-JSON → SQLite migration, and the spend ledger. **`node:sqlite` is Node-only —
never import it into the browser bundle** (keep it out of `App.tsx`/router, same rule
as `benchmark`/`routing`). Reuse `src/lib/money` for all money.

---

## 7. Per-increment loop + traps

```
spec → implement → npm run typecheck → npm run lint → npm test
     → npm run verify:all -- --all          (must stay 21/21)
     → tick tasks.md
     → append contracts/pfos/_PFOS_BUILD_LOG.md
     → git commit → git push origin master
```

- **AC04 test-count floor** lives in `scripts/verify/all.mjs` (`"--min"`, ~line 22).
  Ratchet it to (new total − 2) on every increment that adds tests.
- **AC11 generic-only** scans ALL tracked text for organisation-specific terms (the
  banned list is defined in `scripts/verify/`). Run that term scan before `git add`
  on any new file → it must be clean. (The terms are deliberately not spelled out
  in this doc, precisely because AC11 would flag them.)
- **AC10 headers**: every file under `src/` and `tests/` needs a contract + phase
  reference in its first 20 lines.
- **Bundle isolation (AC05/AC06)**: Node-only / benchmark / routing code must never be
  imported by the app bundle.

Full companion brief: `docs/KIRO_ONBOARDING.md`. Secret model: `docs/PFOS_SECRETS_PLAN.md`.
