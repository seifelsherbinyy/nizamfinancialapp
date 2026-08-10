# KIRO five-phase bring-up contract — NIZAM v1.0 (both agents, end to end)

> **You are the IDE build agent working in `nizamfinancialapp` (this repository).** This file is a
> governing contract, not a task list to improvise around. Proceed **strictly phase by phase**. Do not
> start a phase until the prior phase's exit gate is green and recorded. If a phase's premise turns out
> false when you reach it, **stop and report — do not route around it.**
>
> **Read before you write anything:** `.kiro/specs/07-bot-bringup-v1/README.md`,
> `.kiro/specs/07-bot-bringup-v1/tasks.md`, `ops/NIZAMCORE_VERIFIED_STATE.md`, `.kiro/steering/two-agent-vps.md`,
> `.kiro/steering/pfos-current.md`, `ops/AGENT_CAPABILITY_SPLIT.md`, `ops/APP_ACCESS.md`,
> `.kiro/specs/08-knowledge-ingestion/README.md`, and `.kiro/specs/06-two-agent-vps/LIVE_PROGRESS.md`.

## THE GOAL — echo this back before you begin, in your own words, and confirm it matches

NIZAM ships **two independent conversational agents on Telegram**, plus an **owner-only YNAB-style web
application**, all on **one hardened VPS**:

- **Bot A — the life agent** (Python, the `nizamcore` repository): therapeutic journaling, brainstorming
  ("co-thinking"), challenging/debating ("red-team"), and a recovery downshift that overrides tactical
  pressure. **Multiple agent personas behind ONE Telegram window**, routing chosen inside the window.
- **Bot B — the finance agent** (TypeScript, this repository): budgeting and finance conversation, backed
  by the owner's real ledger. **Its OWN Telegram window, its own credential, its own spend bound, its own
  store.**
- **The owner-only web app**: the already-built YNAB-style SPA, served loopback-only over the admin
  tunnel (`--serve-app`), showing the owner's **real ingested figures** — the place numbers are reviewed.

**End to end means:** real financial data loaded → bot B converses about it and the web app displays it →
bot A converses independently on life matters → both survive restart, honour one kill switch, stay
isolated → observed on the host and recorded, never asserted.

**If your restatement of this goal differs from the above in any material way, STOP and ask the owner
before Phase 1. Alignment is the point of this section.**

## STANDING RULES (carried from specs 06/07, never relaxed by any phase)

1. **Never perform an owner gate, never invent a secret value** (not even a plausibly-shaped placeholder),
   never commit a real secret, never place a key in backup storage, never weaken a guard to make it pass,
   never lower the test floor, and **never claim a gated item is done** — a gate is done only when observed
   and the observation is recorded with its command and output.
2. **Public repo (R24):** no deployment particular in any tracked file — no domain, host address, port
   literal, path on the host, bot id, numeric messaging user id, Drive folder/file id, or any real amount,
   balance, account identifier, payee or journal excerpt. `ops/**` is templates with `<ANGLE_BRACKET>`
   placeholders only. Fixtures and eval cases are synthetic.
3. **`A*` tasks act on the OTHER repository (`nizamcore`); `B*`/`K*` tasks act on THIS one.** The other
   repo is read-only except for the model-wiring files named in A2/A3/A4/A5, which the owner authorised on
   2026-08-10 (A0). **Pushing the other repo is NOT authorised** — commit locally there; the owner pushes.
4. **The gate is `npm run verify:all -- --all` — it must print all checks passed before any commit in this
   repository.** Ratchet the `AC04 --min` floor UP as tests grow; never down. Every new `src/`+`tests/`
   file declares its owning contract/phase in its first 20 lines.
5. **Money is integer milliunits, always, at the boundary or refused.** The LLM/router tier never sources a
   monetary number; the deterministic engines do.
6. **Two-way gate discipline:** a gate is proven only when shown BOTH firing (refuses a tampered input,
   with the code quoted) AND releasing (admits a valid input). A gate only ever observed passing is unproven.
7. **STOP conditions (halt the phase, report, do not work around):** a red harness; an owner gate reached;
   the other-repo push line; an ambiguity between two readings that lead to different deployments; a
   missing owner input (a Drive folder id, a token, a credential — never guessed).

---

## PHASE 1 — RECONCILE & ALIGN (no code, no build; this phase produces one record and STOPS for two confirmations)

**Why first:** the working tree and the last commit disagree about what spec 07 even is, and the
one-window/two-window fork is unsettled. Building on either uncertainty wastes the build.

1. **Reconcile the spec against the commit.** `git status` shows ~193 dirty files. The committed
   `07-bot-bringup-v1/README.md` is ~199 lines and does **not** contain §12, tasks `B13`–`B20`, `A6`, or
   the two-way gate discipline; the working tree (~369 lines) does — the parallel loop wrote them and never
   committed. Also in flight uncommitted: the F20 fix (extensionless relative imports made explicit,
   `allowImportingTsExtensions: true`). **Do this:** diff HEAD vs working tree for the spec files and for
   `tsconfig.json`/`src/`; decide with the owner whether to (a) commit the working-tree spec rewrite + F20
   fix as their own commits with `npm run verify:all -- --all` green, or (b) discard them. **Until this is
   resolved, treat the working-tree spec as authoritative but UNCOMMITTED, and say so in every reference.**
2. **Settle the window fork (README §10).** The owner's instruction — "two agents, independently, one
   finance one life" — is the **two-window** reading: bot A's personas share one window; **bot B keeps its
   own window, own token, own bound, own store.** Record this as the resolution of README §10 and confirm
   nothing in steering §1, R17, or definition-of-done conditions 3/4/6 must change (it must not — that is
   the whole point of the two-window reading being free).
3. **Confirm the identifier set is closed and honest:** `A0`–`A6`, `B0`, `B2`, `B4`–`B20`, gates
   `G1`/`G3`/`G4`, `D-BENCH`, plus spec-08 `A0.*`–`A5.*`/`B1.*` and `K1`–`K9`. `B1` and `B3` are
   deliberately unused (bound to seam ids `S1`–`S7`); do not backfill them.

**Exit gate for Phase 1:** a short `PHASE1_ALIGNMENT.md` in this spec folder recording (a) the HEAD-vs-tree
decision and whether the F20 fix and spec rewrite are now committed, (b) the two-window ruling as the
answer to README §10, (c) the goal restated and confirmed. **STOP here for owner confirmation on (a) and
(b) before Phase 2.** These two are the "different-deployment" forks the standing rules require you to halt on.

---

## PHASE 2 — FINANCE AGENT REACHES A MODEL (this repository; no owner gate, no secret)

Wave 1 of `tasks.md`. Make bot B converse for real, offline, behind an injected port with a deterministic
mock — no live call, no key, no network. Fill the seams in `src/server/process/main.ts`:

- **B4** the messaging provider module (S1/S2): the one outbound request function, in place of the two
  throwing stubs. Reads its token through the existing single chokepoint; never logs a token, body or
  sender; fails closed on non-success; honours existing retry policy. Test with a local fake responder
  (normal, empty, non-success, rate-limit-with-hint, malformed, over-bound) and assert no credential or
  message text reaches any log line.
- **B5** real turn facts + request planner (S5/S4): extract real facts so the classifier can reach the
  model-bearing tiers, and implement `planModelRequest`. **Do not weaken the no-model-tier guarantee** — it
  is a type-level property; add a test that the no-model class cannot carry a model request and that a
  model-bearing class can.
- **B6** the model provider module (S3): reuse the existing benchmark-path response reader/validator (it
  already fails closed on bad status, missing usage, non-integer cost, substituted model). Record cost,
  tokens, latency, schema validity through the existing telemetry repo; **no prompt text**. The provisional
  guard stays — a test asserts routing still refuses until B8.
- **B7** deterministic answers (S6): answer a small named/listed intent set in human sentences (not a bare
  turn reference). Not the Stage 1-4 engine wiring.
- **B2** (optional hygiene) parameterise agent identity (S7) — an unknown identity is refused, never
  defaulted. Skip if it costs anything; option (c) means this repo never runs the life agent.

**Exit gate for Phase 2:** `npm run verify:all -- --all` green; new tests added and the floor ratcheted;
committed. Rung L3' (a model-generated reply, not a canned string) becomes reachable for bot B once a
credential exists in Phase 5 — do **not** fake it now.

---

## PHASE 3 — REAL DATA INTO THE STORE, AND THE OWNER-ONLY WEBAPP SHOWS IT (this repository)

This phase closes the "end-to-end with the web app" goal. Two tracks; keep them ordered.

**3a — Seed the store from real history (spec 08 phase A, waves A2–A5, needs a Drive folder id — owner
input).** The hard extraction is already done in the owner's Drive (a completed pipeline: canonical
1,216-row 25-column master ledger, per-account validated tables, pre-computed gate results). Ingest the
already-validated tables — **no parser, no OCR** (deferred to v2). Enforce: idempotent (K2), fail-closed on
exact ordered column-name set before parsing (not width alone), money integral or refused, grain proven
before keying, provenance on every row (unknown loads as unknown — do not coerce extraction_method to
`manual`, per finding F23), and reconcile the canonical ledger against the per-account tables **two
independent code paths** with the pre-computed gates as a third opinion — any residual explained line by
line, never averaged away (K1/K3/K4). Carry findings F21 (limit table all-absent), F22 (money-format
detection), F23/F24 (importer coercions) forward — fix them at the boundary, do not inherit them.

**3b — Wire the owner-only YNAB webapp to the ingested store, then serve it (B12 + the seam nobody closed).**
Today `--serve-app` (loopback-only, admin-tunnel, no published port, no password — see `ops/APP_ACCESS.md`)
serves the static SPA whose runtime DB is Google Drive, while Phase 3a loads the real ledger into the
SERVER's store. **These must be the same data for the goal to hold.** Produce the smallest change that lets
the owner-only web view reflect the ingested figures (read-only view of the server store, or a documented
one-time export path), **without** publishing a port, adding a password, or changing the loopback-only
posture. If closing this seam needs a new gate or new surface, STOP and record it as a decision rather than
taking it silently. Keep `src/features/benchmark/` and `src/features/routing/` out of the app bundle.

**Exit gate for Phase 3:** K1–K7 observed (row count exact, idempotent, reconciled with residual explained,
provenance complete, knowledge tier indexed, exclusion register complete, scanners pass over the whole
tree); the owner-only webapp verified serving the real ingested figures over loopback (screenshot or health
line + a hand-checkable number cross-computed two ways per B19/K3); `verify:all` green; committed. **B13–B19
and 3a are BLOCKED until the owner supplies a Drive folder id — never guess one.**

---

## PHASE 4 — LIFE AGENT REACHES A MODEL (the OTHER repository, `nizamcore`; A0 granted, push is owner's)

Independent of bot B. Same architecture, same stopping line. Order is load-bearing:

- **A1 FIRST — close A-G1, the runtime unknown (the single highest risk).** The other repo's registry names
  an agent-runtime package + version floor in **one config line that no module imports and no manifest
  lists** — this is what the owner calls "hermes"/the agent framework. On a scratch environment (never the
  host, never that repo's tree, no credential, no model call), determine whether it installs on the target
  Python major, what it pulls in, and whether its profile model matches the three profile names already
  assigned. Record ONE decision: **(i)** adopt the declared runtime, or **(ii)** call the provider directly
  from the coordinator and mark the registry line aspirational. **Choosing by assumption is forbidden.**
- **A2** wire the coordinator's one stubbed agent call to A1's chosen outcome. **Change nothing else** — not
  the three gates, not the governor's sole-writer position, not the ledger contract, router config,
  allowlist or de-dup. Run its own tests as the regression net; record count before/after; add tests for a
  provider refusal, an over-budget refusal, and a classified capture still blocked by the privacy gate.
- **A3** take the relay out of standby: dry-run (no network) → single-cycle → continuous loop. **Never set
  mode live before the dry-run passes on the host.** Needs G3/G4 (Phase 5).
- **A4** replace the committed real-looking numeric operator identifier in its relay env example with a
  placeholder (R24). Do not reproduce the value here, in any file, including a commit message.
- **A5** close the dangling routable agent (A-G4): the `decision_log` intent points at a codename absent
  from the runtime registry with no persona file — one of ten routable targets dead-ends inside the one
  window. Author + register the persona, or remove the intent. Do not leave a routable target that answers
  with silence.

**Exit gate for Phase 4:** A1 decision recorded; A2/A5 done with the other repo's tests green and counted;
A3 dry-run passes; A4 placeholder in place; **committed locally in the other repo, NOT pushed** — the owner
pushes. A6 (privacy pre-write gate, two-way) and the live conversational matrix wait for Phase 5 credentials.

---

## PHASE 5 — DEPLOY, TEST END TO END ON THE HOST, RECORD, CLOSE

**Owner gates first — STOP and hand off, do not attempt (these need a human):**
- **G1** provision + harden the host, ending with the root-owned config directory.
- **G3** place BOTH bot tokens on the host (bot A + bot B, two windows, two tokens).
- **G4** mint TWO model credentials with their per-agent weekly bounds and training opt-out.
- **D-BENCH** authorise one benchmark pass and resolve the provider base URL into the environment; then
  **B8** runs the benchmark ONCE (pre-flight estimate against the ceiling first; no retry-in-a-loop; no
  half-measured registry). One credential release unblocks both bots — twice the blast radius, so show the
  two bounds isolated.

**Then, on the host:**
- **B9** install both agents as host services — two units, each its own env file (mode 600, root-owned),
  own data dir, restart-on-failure, journal output. No published port, no proxy, no container. State
  plainly whether one kill-switch flip stops both (the entry name is shared) and make the units agree.
  Author `ops/HOST_INSTALL_V1.md` with placeholders only.
- **B20** the Drive-to-host wiring plan (planning only, no execution, no new gate): direction of data flow,
  which credential a host process holds and why the read-only token from B13 must not be it, whether either
  agent needs Drive at runtime or only at import time, and the recorded debt (no off-host copy, no restore
  drill).
- **B10** run the ladder on the host: L0/L1 already OBSERVED for bot B (carry forward); **L3'** each bot
  gets a **model-generated** reply (never canned) and survives a kill-restart with exactly-once in-flight;
  **L4'** a turn routes and spend is recorded, the bound refuses at exhaustion while the deterministic alert
  still fires, one kill flip stops both; **L5'/A6** bot A's three gates fire — the recovery downshift (the
  critic must NOT be selected), the privacy pre-write gate blocks a `MEDICAL-LOCAL` capture (never place
  that content in a model request), the continuity post-gate records; run the six-message conversational
  matrix (README §12.3) with both directions transcribed.
- **B11** write `.kiro/specs/07-bot-bringup-v1/LIVE_PROGRESS_V1.md` and keep it current — one row per task,
  ladder rung and gate, `State` ∈ {OBSERVED, BLOCKED - awaiting human, BLOCKED - awaiting build, NOT
  STARTED}, evidence mandatory for OBSERVED (command + output). Close with four lines: what is live; the
  single next blocking action and whose it is; the count of README §1's seven conditions observed; the v1.0
  debt list (no off-host copy, no restore drill, no cross-agent signalling). **v1.0 is not closable without
  this file — its absence in spec 06 is what made the project unreadable to the owner.**

**Exit gate for Phase 5 (= v1.0 done):** README §1's seven conditions all OBSERVED with evidence; both bots
answer independently in their own windows; the owner-only webapp serves real figures over loopback; the
kill switch and per-agent bounds shown isolated; `LIVE_PROGRESS_V1.md` current and closed.

## OUT OF SCOPE for v1.0 (name it, do not build it)
Containers and the proxy; domain, DNS records and webhooks (both bots long-poll); the signal-bus process
and all cross-agent signalling (so money-pressure does not reach bot A and recovery does not reach bot B in
v1.0); off-host backup and the restore drill; the wearable connector; statement/payslip parsing (v2). Bot B
converses about budgeting from the ingested ledger and the web app, without the Stage 1-4 engines wired to
chat.

## THE ONE THING NOT TO DO
Do not ship a bot that talks confidently about an empty store. Phase 3a lands before Phase 5 takes the bots
live. And do not route around a STOP condition — a blocked step reported honestly is worth more than a
green that hid a gate.
