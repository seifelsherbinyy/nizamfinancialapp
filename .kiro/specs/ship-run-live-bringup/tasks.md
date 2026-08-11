# Implementation Plan: ship-run-live-bringup

## Overview

One time-boxed bringup run in a **fixed step order**: STEP 0 → STEP 1 → STEP 2 → STEP 3 → STEP 4 →
RUNG 1 → the runner build → STEP 5 → (RUNG 2 → RUNG 3 → RUNG 4) → STEP 7 → STEP 8 → STEP 9. The order
is not reorderable.

**One sequencing decision the Operator made explicit.** RUNG 1 (task 6) and the runner build (task 7)
both complete **before the credential ask at task 9 is issued at all** — not merely while it waits.
R8.1 requires RUNG 1 to run before any credential is supplied and before any network call, and issuing
the ask concurrently would leave credentials in existence while the offline proofs were still running.
No credential reaches disk until task 10.3, so the concurrent arrangement was a narrow reading rather
than a wrong one; the Operator chose to make R8.1 hold **strictly** instead of resting on that
narrowness. **The accepted cost, named:** the ask can no longer overlap the offline proofs, so the
Operator wait is not absorbed by RUNG 1's runtime. RUNG 1 and the runner build still run concurrently
**with each other** — neither needs a credential, and that overlap is worth keeping.

This plan is **configuration plus evidence-driven smoke testing with exactly one genuine build** —
`scripts/benchmark/earn-registry.mjs` plus its npm script. Everything else already exists; the tasks
below *drive* it and *read its evidence back*.

Language: **TypeScript** (Node 24, `"type": "module"`, native type stripping, Vitest, `node:sqlite`).
The one runner is `.mjs` build tooling under `scripts/`; the four smoke tests are `.ts` under `tests/`.

**Priority order, reflected in task order.** (1) Finance_Repo pushed, (2) Nizamcore_Clone created and
its suite RUN for the first time, (3) both bots live replying. Tasks 1-5 (the push and the nizamcore
suite) sit on the critical path **ahead of the ladder**, so objectives 1 and 2 ship even if 3 proves
impossible.

**Three hard gates that stop the run**: task 2 (STEP 1 identity sweep, R2.7), task 3 (STEP 2 harness,
R3.4), task 6 (RUNG 1, R8.8). **Two Operator waits**: task 9 (STEP 5 credential list, R6.1/R6.7) and
task 15 (STEP 8 A-G4, R16.4). RUNG 4 additionally depends on the Operator sending a real message and
confirming a reply arrived in their own client (R12.1, R12.5).

**STEP 9 is reachable from any point.** It is not gated on the rungs succeeding. When the time box
expires, stop wherever the run is and file the Final_Report with whatever was measured (R23.4) — a
partial report carrying Evidence_Of_Record beats a complete one carrying an inference (R23.5).

**This file carries no deployment particular.** `.kiro/**` is tracked and AC18 has never covered it,
so every credential, host, address, bot and identifier here appears **only** as its `<ENTRY_NAME>`
placeholder. This file is an input to the STEP 1 sweep it specifies (R2.3, R24.6).

## Tasks

- [x] 1. STEP 0 — stillness before the irreversible step
  - [x] 1.1 Stop every background loop and watcher that writes into Finance_Repo
    - Stop each background writer; if one cannot be stopped, name that writer and halt before STEP 1
      rather than proceeding with a moving tree
    - Emit the written confirmation line verbatim: "no other process is writing this tree."
    - Report a timestamp at completion of STEP 0
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [x] 1.2 Record the measured tree-state correction as a dated Observation
    - Record that `git status --porcelain` was measured empty and `turnIntake.ts` is tracked,
      superseding the originating contract's claim of three mid-edit files and one untracked file
    - Label it an Observation with its date; never as a decision
    - _Requirements: 1.3, 22.4, 22.5_

- [x] 2. STEP 1 — full identity sweep of every tracked file **[HARD GATE: blocks STEP 3]**
  - [x] 2.1 Build the one-off sweep procedure over every tracked file, full 47-commit range
    - Separate one-off procedure. AC18's scan roots `['ops', 'src/server/mocks/fixtures']` and its
      allowlist stay **unchanged** — widening either is defect class F25
    - Scan from scratch, inheriting no prior sweep result; skip binary extensions per AC18's own
      `BINARY_EXTENSIONS` reasoning
    - All four Disclosure_Shapes in one pass: (a) life bot display name/handle, (b) numeric messaging
      user id 8-10 digits, (c) hostname/IPv4/hosting-provider address, (d) 40-char mixed-case token
      that is not a git object hash (git hashes are lowercase hex, so mixed-case separates them)
    - Output is the fixed four-line shape: **counts and paths only, never values**
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 17.5_

  - [x] 2.2 Sweep `.kiro/**`, including this spec's own three documents
    - `.kiro/**` is tracked and AC18 has never covered it, so a 20/20 harness says nothing about it
    - `requirements.md`, `design.md` and this `tasks.md` are inputs to the sweep they specify and must
      survive it — every particular in them is an `<ENTRY_NAME>` placeholder for exactly that reason
    - _Requirements: 2.3, 24.6_

  - [x] 2.3 Correct any shape (a) or (b) hit, re-run the sweep, and hold the gate
    - Correct the offending text; leave the AC18 allowlist and scan roots unchanged; re-run the sweep
    - Shapes (c) and (d) are reported and judged, not auto-failed
    - **Hold at STEP 1 while any (a)/(b) hit is uncorrected and unanswered by the Operator; do NOT
      execute STEP 3**
    - Report a timestamp at completion of STEP 1
    - _Requirements: 2.6, 2.7, 2.8_

- [x] 3. STEP 2 — one full harness run, immediately before the push **[HARD GATE: blocks STEP 3]**
  - [x] 3.1 Invoke `npm run verify:all -- --all` exactly once and require 20 of 20
    - The 20/20 line has not been observed this session, so it is a real gate rather than a formality
    - Capture the harness's two summary lines verbatim for the Final_Report
    - **If fewer than 20/20 pass: report the failing check identifiers and do NOT execute STEP 3**
    - The full suite runs here and at no other point in the run
    - Report a timestamp at completion of STEP 2
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 18.4, 18.5_

- [x] 4. STEP 3 — the push, and its verification against the remote
  - [x] 4.1 Push Finance_Repo to `origin master`
    - The command's exit status alone is **insufficient** Evidence_Of_Record for a completed push
    - _Requirements: 4.1, 4.5_

  - [x] 4.2 Run the Push_Verifier: re-read the reference from the remote
    - Re-read the remote reference and assert remote head equals local head
    - Report the remote object identifier, the local object identifier, and an ahead count of 0
    - On mismatch, report both identifiers and the remaining ahead count as a **failure**, not as a
      success with a caveat
    - Report a timestamp at completion of STEP 3
    - _Requirements: 4.2, 4.3, 4.4, 4.6_

- [x] 5. STEP 4 — Nizamcore_Clone and the first observed suite execution
  - [x] 5.1 Create Nizamcore_Clone as a writable clone at a sibling directory
    - Outside Finance_Repo's tracked tree, so nothing it brings can be committed here by accident
    - Outside the ignored path used for the earlier read-only copy, so the read-only copy is not
      silently reused as if it were the writable one
    - A clone is a read under steering §2a; a modify or push is a mutation
    - _Requirements: 5.1, 21.1, 21.3_

  - [x] 5.2 Attempt the suite with the standard-library path first and record what it does
    - Its long-poll runner is pure standard library with no installed dependencies
      (`NIZAMCORE_VERIFIED_STATE.md` §3), so start there
    - Its declared agent-runtime package carries a large dependency tree and **no Python module
      imports it** (§4 gap 1). Only if the suite fails on a missing import does that install cost
      become relevant — and then it is a **measured finding**, not an assumed prerequisite
    - Report the observed total and passed counts and record that this is the **first observed
      execution**: 143 test functions and 29 relay tests across two files (7 + 22) had previously
      only ever been read from files (§8)
    - **If the suite does not execute at all, the refusal IS the finding**, naming the single step
      that blocked it — not "the suite is broken"
    - _Requirements: 5.2, 5.3, 5.4, 22.1, 23.1, 23.2_

  - [x] 5.3 Commit changes to Nizamcore_Clone locally only
    - Never push Nizamcore_Clone. A push requires an explicit "push granted" from the Operator
    - Do not modify spec `07-bot-bringup-v1`; cite it as evidence only
    - Report a timestamp at completion of STEP 4
    - _Requirements: 5.5, 5.6, 5.7, 16.6, 21.4_

- [x] 6. RUNG 1 — the transport proves itself offline **[HARD GATE: halts the ladder]**
  - [x] 6.1 Write `tests/smoke/rung1.transportOffline.smoke.test.ts` against a Fake_Responder
    - The **only** new test for this rung. Fake at exactly one seam: the injected `ProviderRequestFn`
      — `providerRequest.ts` declares its whole outside world as that one parameter, so the socket is
      a parameter and not a global. No loopback listener, no port, no DNS, no recorded transcript
    - Use `createLiveTelegramTransport(ctx)` with a fake `TelegramTransportClient` and
      `createInMemoryOffsetStore()`. **No network access and no credential present**
    - Declare the owning contract and phase in the first 20 lines (AC10)
    - Runs **before any credential is supplied and before any network call** — RUNG 1 completes
      **before the credential ask at task 9 is issued**, so no credential exists anywhere in the run
      at the time these offline proofs execute
    - _Requirements: 8.1, 8.2, 8.9, 17.7, 18.1_

  - [x] 6.2 Proof (a) + (b): request composition, auth applied, credential absent
    - (a) Quote the `ProviderHttpRequest` the fake responder receives as Evidence_Of_Record
    - (b) Assert **both halves**: `composeDialledAddress` is reached with a `ProviderCredential`, and
      the credential value appears nowhere in the request object. `ProviderHttpRequest` has **no
      field** for an authorization value; the credential travels beside it as an `OpaqueSecret` whose
      `toString`/`toJSON` return `'[redacted]'`, with the single `revealSecret` site inside
      `composeDialledAddress`. Assert the outcome rather than trusting the structure
    - **Property 2: No renderer emits a credential value or a deployment particular**
    - **Property 3: Authentication is applied while the credential stays out of the request**
    - **Validates: Requirements 8.3, 8.4, 7.2, 7.3**

  - [x] 6.3 Proof (c): five response shapes, discriminated on `code`
    - Success body; non-success status; rate-limit carrying a retry hint
      (`retryAfterSecondsFromHeaders` reads the advertised interval, `TelegramRateLimitRefusal` is
      what waits on it); malformed body; body over `MAX_PROVIDER_RESPONSE_BYTES` refused with
      `body_over_read_bound` after `readChunksBounded` truncates and reports
    - Assert on `code`, never on a message. An absent status reports `0`, outside the success range,
      so the reader refuses rather than the dialler inventing a success
    - **Property 4: Response reading is total — a validated response or an enumerated refusal**
    - **Validates: Requirements 8.5**

  - [x] 6.4 Proof (d): exactly one structured telemetry line per request, and four absences
    - Assert the line count is exactly one per request
    - Assert **absence** of the credential, the request body, the sender identity and the provider
      base address. Each has a structural reason it cannot be there; assert absence anyway
    - **Property 2: No renderer emits a credential value or a deployment particular**
    - **Validates: Requirements 8.6**

  - [x] 6.5 Proof (e): the store write lands, read back through the repository
    - Read the written row back **through the repository** — not from the write's return value. A
      write returning is not a write landing, by the same logic as R22.2
    - **Property 5: A store write round-trips**
    - **Validates: Requirements 8.7**

  - [x] 6.6 Report RUNG 1 independently, and halt the ladder on any failed proof
    - OBSERVED with quoted Evidence_Of_Record, or BLOCKED with a one-line reason naming the single
      blocked step. Not merged with any other rung; not claimed on another rung's evidence
    - **If any of the five proofs fails: halt the ladder at RUNG 1 and report that no credential can
      resolve the failure.** Do not wire credentials to "see if it helps" — every proof is offline,
      so a credential changes none of their inputs, and at this point in the run no credential has
      been asked for yet
    - Verify with `npm run typecheck`, `npm run lint`, and vitest **on the touched files only**
    - _Requirements: 8.8, 13.1, 13.2, 13.3, 13.4, 18.3_

- [ ] 7. The ONE build — `scripts/benchmark/earn-registry.mjs` and its npm script
  - [~] 7.1 Create the module with its header, constants and `explicitEnvironment(entries)`
    - It lives in `scripts/` and **not** `src/server/`, because
      `liveModelCaller.isolation.test.ts` asserts mechanically that no file under `src/server/**`
      imports `src/features/benchmark/liveModelCaller.ts`. Do not break that assertion
    - Header declares the owning contract, the owning spec, and the steering §3 dev-key carve-out.
      **No deployment particular** — the provider base and the credential arrive as entry names
    - Export `DEFAULT_ALLOWED_MODEL_IDS = ['xiaomi/mimo-v2.5', 'z-ai/glm-5.2']` and
      `DEV_WEEKLY_CEILING_MICRO_USD = 1_000_000`
    - Export `explicitEnvironment(entries)` returning `{ resolve(name) }` over a **Map, never
      `process.env`**; an absent name resolves to `null`
    - Import the `.ts` modules directly with the explicit `.ts` specifier the tree already uses — no
      build step, no bundler, no loader flag
    - Writing this module needs no credential, which is why it sits ahead of the credential ask
    - _Requirements: 10.1, 17.9_

  - [~] 7.2 Implement `httpsTransport({ requestTimeoutMs })`
    - Returns a `LiveTransport`. This is the **ONE** `revealSecret` call site on the model side
    - _Requirements: 7.1, 7.2, 7.3_

  - [~] 7.3 Implement `preflightEstimateMicroUsd({ cases, modelIds, maxOutputTokens })`
    - Integer micro-USD from the tracked frozen pricing snapshot
      (`src/features/benchmark/pricing.ts`). Integer arithmetic only — **no `parseFloat`, no
      `.toFixed(`** anywhere outside `src/lib/money/`
    - Provider cost is integer micro-USD; owner money is integer milliunits behind `src/lib/money/`.
      The two units are never joined
    - _Requirements: 10.6, 20.6, 20.8_

  - [~] 7.4 Implement `earnRegistry({ grant, transport, environment, config, modelIds, evalSet })`
    - Phases 1-8 in this exact order, because the ordering is not cosmetic:
      `grantDeveloperMachineRun({ invocation, serverRuntimeMarker })` → `buildEvalSet()` →
      `validateEvalSet(cases)` → `auditEvalSet(cases)` → **pre-flight estimate reported before any
      spend** → `resolveLiveRun(grant, environment, config)` → `runLiveModelCalls(...)` per model →
      `emitLiveRegistry({ runs, buildCaller, verifyWitness, evalSet })`
    - **Both gates run BEFORE dialling — the caller's obligation.** `emitLiveRegistry` re-runs
      `validateEvalSet` and `auditEvalSet`, but that is after the calls and too late to prevent the
      send. An unsanitized case sent to a third party cannot be undone by a later refusal
    - Injection exactly as designed: `buildCaller: liveModelCaller` (its signature already matches
      `(modelId, exchanges) => ModelCaller`) and `verifyWitness: isLiveMeasurementWitness` **passed
      by reference, unchanged — no wrapper, no `?? (() => true)`, no local re-implementation**
    - The runner reads `serverRuntimeMarker` from the process environment and passes it in, because
      `liveModelCaller.ts` reads no environment by design
    - Fund from the development model key on the local machine over **both** default-allowed models;
      never `<OR_KEY_FINANCE>`; enable no model outside the default-allowed set
    - Discriminate refusals on `code` in a `switch` whose default arm re-raises; never on a message.
      Add no field to any error `detail`. Failures halt: no retry loop, no per-case fallback
    - Accept that a crash or refusal mid-run forfeits the spend and restarts from zero; introduce **no
      new trust mechanism** to avoid that cost — no checkpoint file, no resume flag, no partial-run
      cache, because a `WeakSet`-backed witness cannot survive a process boundary
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.12, 11.1, 11.3_

  - [~] 7.5 Implement `writeEmitted(sink, emitted)` and guard `main()`
    - Phase 9: write every entry of `emitted.artifacts` **verbatim** through the injected sink — the
      map is already keyed by final relative path, including the top-level registry
    - Leave `LIVE_REGISTRY_FILE_NAME === PROVISIONAL_REGISTRY_FILE_NAME` alone. One name means a
      stale provisional document and a measured one cannot sit side by side; the runner must not
      "fix" it
    - Phase 10: report the four numbers plus the emitted path
    - Guard `main()` behind a direct-invocation check so **importing the module dials nothing**
    - _Requirements: 10.2, 10.8, 11.2_

  - [~] 7.6 Add the npm script `"benchmark:earn-registry": "node scripts/benchmark/earn-registry.mjs"`
    - `package.json` has no benchmark-related script, so there is no convention to match and no name
      to collide with. `namespace:verb` matches the existing `verify:ledger` / `verify:all` pair
    - The verb is **`earn`** rather than `run` or `generate` because the registry is earned downstream
      of a witness; a name reading as "produces a document" is the framing R11.2 forbids
    - Default invocation takes no arguments: the model list, entry names and pricing inputs are module
      constants, so the default invocation is the audited one
    - _Requirements: 10.1_

  - [~] 7.7 Verify the build without breaking the isolation assertion
    - Run `npm run typecheck`, `npm run lint`, and vitest on the touched files only
    - Confirm `liveModelCaller.isolation.test.ts` still passes and that
      `src/features/benchmark/` and `src/features/routing/` stay out of the application bundle
    - Add no `eslint-disable` directive, do not lower the Test_Floor, do not widen any allowlist
    - _Requirements: 17.4, 17.5, 17.6, 17.9, 18.3_

- [~] 8. Checkpoint — RUNG 1 reported and the runner built, before any credential is asked for
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. STEP 5 — one credential request, and every choosable value chosen **[WAITS ON OPERATOR]**
  - [~] 9.1 Compose the single list: ask for what cannot be minted, choose everything else
    - Issued only after RUNG 1 (task 6) and the runner build (task 7) have completed, so R8.1 holds
      strictly: at no point while the offline proofs were running did a credential exist
    - Ask for exactly: `<BOT_A_TOKEN>`, `<BOT_B_TOKEN>`, `<OR_KEY_LIFE>`, `<OR_KEY_FINANCE>`,
      `<ALLOWED_USER_IDS>`, `<MODEL_API_BASE>`, `<MSG_API_BASE>`
    - **Propose** `<MODEL_API_BASE>` and `<MSG_API_BASE>` from each provider's own published
      documentation for the Operator to **confirm** — a base resolved from docs is a fact about the
      provider; a wrong base is a silent failure at the first call
    - Choose and state a value **with its reason** for every `operator`/`build` gated entry on both
      sides: `FINANCE_DATA_DIR`, `FINANCE_STORE_FILE`, `STORE_BUSY_TIMEOUT_MS`,
      `FINANCE_CONTAINER_PORT`, `MAX_WORK_ITEMS`, `FINANCE_WEEKLY_CAP`, `KILL_SENTINEL_PATH`,
      `NIZAM_KILL_ALL`, `BUS_INTERNAL_ENDPOINT`, `MODEL_ELIGIBILITY_REGISTRY_PATH`, and the life-side
      counterparts including `LIFE_STORE_FILE`, `LIFE_CONTAINER_PORT`, `LIFE_WEEKLY_CAP`,
      `WHOOP_API_BASE`, `WHOOP_ACCESS_TOKEN`
    - Set `NIZAM_KILL_ALL` to `0` and `TELEGRAM_MODE` to `longPoll` on both sides
    - Generate `<MONEY_WEBHOOK_SECRET>` and `<LIFE_WEBHOOK_SECRET>` randomly; tell the Operator each
      was generated and that neither is used on the long-poll path; **do not ask for either**
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.6_

  - [~] 9.2 Issue the request exactly once, then wait for the Operator
    - Never proceed on a guessed value; invent no credential, including a plausible placeholder of
      the correct shape
    - One destination only for any value: the owning service's Env_File on the host. Entry name
      everywhere else — every message, log line, commit, fixture, comment, error message, report
    - Use `<OR_KEY_FINANCE>` and `<OR_KEY_LIFE>` only for their own agent; never substitute one for
      the other under any failure condition. Rotate nothing (standing D-ROTATE deferral)
    - The wait is no longer absorbed by other work; that is the accepted cost of issuing the ask
      strictly after RUNG 1 rather than alongside it
    - Report a timestamp at completion of STEP 5
    - _Requirements: 6.7, 6.8, 7.1, 7.2, 7.3, 7.5, 7.6, 7.7_

- [ ] 10. RUNG 2 — credentials wired, environment accepted, isolation proven, **no model call**
  - [~] 10.1 Pre-write check 1: read-only host reachability probe
    - A read-only probe over the existing key material in `.secrets/`. It changes no state the host
      holds, so it is a **read** under steering §2a. Make no mutation during it
    - **If the probe fails: report RUNG 2 BLOCKED with the blocked step named as the probe** — not
      "the host is down"
    - _Requirements: 19.1, 19.2, 19.5_

  - [~] 10.2 Pre-write check 2: `.gitignore` coverage confirmed with `git check-ignore -v`
    - Run `git check-ignore -v` on a representative path **per pattern**. The system of record for
      "is this ignored" is git, not a grep of the file
    - Quote the matching entries: the `.env` entry and the `ops/env/*.env` entry. The second exists
      because the first matches only a file named exactly `.env`
    - _Requirements: 9.1, 9.3_

  - [~] 10.3 Write each Env_File on the host
    - Root-owned, mode-600, one per service, read by no other service (contract 12 §3.2.7)
    - Sixteen entries per agent; the template declares **no default for anything**, so an unset entry
      is a startup failure rather than a guess
    - This is the first point in the run at which any credential reaches disk
    - **Commit no filled Env_File.** This is a host WRITE and therefore owner-in-the-loop under
      steering §2a
    - _Requirements: 9.2, 9.3, 7.1_

  - [~] 10.4 Proof 1: `Env_Loader` accepts all 16 entries and each process reaches ready
    - Evidence source: the process's own readiness output / structured log line
    - **If the loader refuses: report the refusing entry name and exclude its value.** An entry name
      is not a credential; a refusal message that quotes the value is a disclosure
    - Reaching ready is **not** evidence of working routing — that is RUNG 3's claim, not this one
    - **Property 8: The environment loader is complete and fails closed**
    - **Validates: Requirements 9.4, 9.5, 11.8**

  - [~] 10.5 Proof 2: cross-file secret absence, proven **both ways**
    - Reuse `auditEnvTemplates` / `auditEnvTemplateFiles` and quote their findings list rather than
      duplicating the cross-file comparison — a second rule can disagree with the first
    - Finance holds no `<BOT_A_TOKEN>`, no `<OR_KEY_LIFE>`, no `<LIFE_WEBHOOK_SECRET>`, no
      `<WHOOP_ACCESS_TOKEN>`; life holds no `<BOT_B_TOKEN>`, no `<OR_KEY_FINANCE>`, no
      `<MONEY_WEBHOOK_SECRET>`. Compare **entry names only, never values**
    - **Property 7: Neither agent's environment file holds the other agent's secret**
    - **Validates: Requirements 9.6**

  - [~] 10.6 Proof 3: neither store path resolves from the other container
    - Attempt the resolution from inside each container and confirm it is **refused in both
      directions**. One direction is half a proof
    - Issue no cross-store attach statement; keep the three stores separate
    - **Property 6: Store isolation holds in both directions, and no cross-store attach resolves**
    - **Validates: Requirements 9.7, 20.1, 20.2**

  - [~] 10.7 Write `tests/smoke/rung2.envAndIsolation.smoke.test.ts`
    - The **only** new test for this rung. Fake at template text plus an in-memory environment
    - Drives `auditEnvTemplateFiles`, 16-entry acceptance, the cross-file negative both ways, and
      store-path non-resolution. **No network call**
    - Declare the owning contract and phase in the first 20 lines (AC10)
    - Verify with `npm run typecheck`, `npm run lint`, and vitest on the touched files only
    - _Requirements: 9.9, 17.7, 18.1, 18.3_

  - [~] 10.8 Report RUNG 2 independently, plus the gate-register finding
    - OBSERVED with quoted Evidence_Of_Record, or BLOCKED with a one-line reason naming the single
      blocked step (the probe, a `.gitignore` gap, a loader refusal, or an isolation proof failing in
      either direction). Not merged with RUNG 1; not claimed on RUNG 1's evidence
    - **Make no model call in RUNG 2** — that is what makes RUNG 3 a separate rung
    - Report that gate G1 is done in fact while `pfos-current.md` records the host as not provisioned
      and spec `07-bot-bringup-v1` wave 3 lists G1 as open, and report that disagreement as a
      **finding in its own right**. Do not edit the registers on one session's read
    - _Requirements: 9.8, 13.1, 13.2, 13.3, 19.3, 19.4, 22.1_

- [ ] 11. RUNG 3 — the registry is earned, then one real model response is quoted
  - [~] 11.1 Report the pre-flight estimate before anything is spent
    - Integer micro-USD over the eval set and both models, compared against
      `DEV_WEEKLY_CEILING_MICRO_USD`
    - **If it does not fit: report RUNG 3 BLOCKED at the estimated number and spend nothing.** Not
      "attempt and stop when the cap trips" — an estimate that does not fit is a decision not to start
    - _Requirements: 10.6, 10.7_

  - [~] 11.2 Run the runner locally and report the four numbers
    - Run from the local developer machine on the development model key over both default-allowed
      models. `grantDeveloperMachineRun` refuses with `LIVE_GRANT_REFUSED_SERVER_RUNTIME` when a
      server-runtime marker is present, so the runner **cannot** execute on the host at all
    - Four numbers: cases in the eval set (`cases.length` after both gates), cases answered
      (`witness.casesAnswered`), models graded (`emitted.results.length`), actual cost
      (`emitted.actualCostMicroUsd`)
    - Take the actual cost as **integer micro-USD exactly as the provider reported it** — never
      converted, never re-derived from a price table, never estimated
    - _Requirements: 10.4, 10.5, 10.8, 10.9_

  - [~] 11.3 Transfer the emitted registry to the host and point the entry at it
    - Produce the artifact locally, then copy it to `<MODEL_ELIGIBILITY_REGISTRY_PATH>` on the host.
      This copy is a host WRITE and therefore **owner-in-the-loop** under steering §2a
    - The document carries no credential, no endpoint, no cost figure and no case text, so it is safe
      to move. What crosses is the emitted document, which exists only because the chain already
      passed — copying it is not a replay path into the gate. A witness is never transferred
    - `artifacts/` is gitignored, so the emitted registry is never committed
    - Never point the entry at a Provisional_Registry and then report routing as working; while it
      resolves to a provisional document, report live routing as **refused**
    - _Requirements: 10.10, 11.6, 11.7_

  - [~] 11.4 Make ONE controlled model call and quote the response body
    - One call through the agent's own path, with the response body quoted as Evidence_Of_Record
    - A process reaching ready is **insufficient** evidence for working routing
    - _Requirements: 10.10, 11.8, 22.1, 22.2_

  - [~] 11.5 Write `tests/smoke/rung3.witnessGate.smoke.test.ts` with **both** halves
    - The **only** new test for this rung. Fake at the injected `LiveTransport`, so no network, no
      endpoint and no credential
    - **Positive half:** the witness `runLiveModelCalls` minted ⇒ `emitLiveRegistry` returns a
      document with `provisional: false`
    - **Negative half:** a hand-built object literal cast to `LiveMeasurementWitness` with field
      values **identical** to the genuine one ⇒ throws with
      `code === 'LIVE_REGISTRY_WITNESS_NOT_ACCEPTED'`. Identical values are what prove the check is
      **identity** (`WeakSet` membership) and not structure. **Assert on `code`, never on a message**
    - State in writing what `verifyWitness` checks; supply no verifier returning a constant acceptance
    - Also assert the cost sum, the estimate-over-ceiling zero-spend path, the structural T4 verdict,
      and the server-runtime grant refusal
    - Declare the owning contract and phase in the first 20 lines (AC10)
    - **Property 1: A tampered witness is refused and a minted one is accepted**
    - **Property 9: Provider cost is the exact integer sum of what the provider reported**
    - **Property 10: An estimate over the ceiling spends nothing**
    - **Property 11: Every model this path grades fails the developer/build verdict, so T4 is
      unroutable**
    - **Property 12: A developer-machine grant is refused wherever a server-runtime marker is
      present**
    - **Validates: Requirements 10.2, 10.3, 10.7, 10.9, 11.1, 11.3, 11.4, 11.5, 14.1, 14.2, 17.7,
      18.1**

  - [~] 11.6 Report RUNG 3 independently, or halt at RUNG 2 with the exact wording
    - OBSERVED with quoted Evidence_Of_Record, or BLOCKED with a one-line reason naming the single
      blocked step. Not merged with RUNG 2; not claimed on RUNG 2's evidence
    - **If the registry cannot be earned in the time box: stop the ladder at RUNG 2 and report
      exactly** `transport live, routing refuses on a provisional registry, runner <state>` **where
      `<state>` is built-not-run, refused-at-`<code>`, or partial-with-spend-forfeit.** Reporting
      "the model layer is blocked" as one undifferentiated wall is what R23.3 forbids
    - Verify with `npm run typecheck`, `npm run lint`, and vitest on the touched files only
    - _Requirements: 10.11, 10.13, 13.1, 13.2, 13.3, 18.3, 23.1, 23.2, 23.3_

- [ ] 12. RUNG 4 — a real message proven hop by hop **[depends on the Operator]**
  - [~] 12.1 Wait for the Operator to send a real message from their own messaging client
    - Both sides in long-poll mode (`TELEGRAM_MODE=longPoll`). **No DNS change, no certificate
      request, no public port published, no `setWebhook`** — long poll pulls outbound, so none of the
      four is needed and each is a mutation under steering §2a
    - _Requirements: 12.1, 12.7_

  - [~] 12.2 Read and quote hops 1-3, each from its own distinct system of record
    - Hop 1 transport received — the poll report / structured log line for the update
    - Hop 2 authenticated against `<ALLOWED_USER_IDS>` — the auth **decision** line, not the
      identifier
    - Hop 3 queued — the work-queue row, **read back** from the store
    - The absence of an error is not evidence of any hop; one hop is not evidence of another
    - **Validates: Requirements 12.2, 12.3, 12.4, 22.1**

  - [~] 12.3 Read and quote hops 4-6, including the Operator's own client for hop 6
    - Hop 4 worker picked up — the worker's claim on that row, **read back**
    - Hop 5 reply sent — the send receipt line. A returned identifier is not an arrived message
    - Hop 6 **reply arrived** — the reply appearing in the Operator's own messaging client, which is
      the **only** acceptable evidence. Nothing the system can read about itself substitutes for it
    - **Validates: Requirements 12.2, 12.3, 12.4, 12.5, 22.3**

  - [~] 12.4 Prove Store_Isolation in both directions
    - Finance cannot open the life store and life cannot open the finance store. **Both attempted,
      both refused, both quoted.** One direction is half a proof
    - **Property 6: Store isolation holds in both directions, and no cross-store attach resolves**
    - **Validates: Requirements 12.6, 20.1, 20.2**

  - [~] 12.5 Check `getWebhookInfo` as the D-ROTATE compensating detection control
    - Checked on every run. A deferral without its compensating control is just an unrotated
      credential. `getWebhookInfo` is a read; `setWebhook` is a mutation and is not performed
    - _Requirements: 7.7, 7.8, 12.7_

  - [~] 12.6 Write `tests/smoke/rung4.endToEnd.smoke.test.ts`
    - The **only** new test for this rung, and the **fourth and last new test of the run**. Fake at
      the injected transport client. **No network call**
    - Drives the six-hop chain over the store and the log, and isolation in both directions
    - Declare the owning contract and phase in the first 20 lines (AC10)
    - Verify with `npm run typecheck`, `npm run lint`, and vitest on the touched files only
    - _Requirements: 12.8, 17.7, 18.1, 18.2, 18.3_

  - [~] 12.7 Report RUNG 4 independently
    - OBSERVED with quoted Evidence_Of_Record, or BLOCKED with a one-line reason. Not merged with
      RUNG 3; not claimed on RUNG 3's evidence
    - **If any hop is unreadable: RUNG 4 BLOCKED naming that hop as the single blocked step, with the
      readable hops still reported as read.** A rung is all-or-nothing in what it *claims*, not in
      what it *reports*
    - Confirm the isolation invariants held throughout: bus internal-only, no forbidden field or
      over-120-character free text on any envelope, `strict_local_maximum` data never reaching the
      host, both agents honouring `NIZAM_KILL_ALL` and their own cap, the model tier sourcing no
      monetary number
    - _Requirements: 13.1, 13.2, 13.3, 20.3, 20.4, 20.5, 20.6, 20.7, 23.1, 23.2_

- [~] 13. Checkpoint — the four rungs reported
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. STEP 7 — the Drive audit: answer the question, build nothing
  - [x] 14.1 Read the evidence and cite it
    - `ops/env/finance.env.example` all 16 entries and `ops/env/life.env.example` — **no Drive
      credential entry in either template**; `src/lib/drive/` is browser-side (in-browser OAuth token
      client, Google Picker, Dexie mirror); AC08 enforces per-file `drive.file` scope, a browser OAuth
      concern; `src/server/ports/drive.ts` and `src/server/mocks/driveMock.ts` are a port plus a mock
    - A port plus a mock and no credential entry in either template is the signature of a capability
      designed for and never provisioned
    - Where a server-side path exists, name the module and the credential entry it requires
    - _Requirements: 15.1, 15.2, 15.5_

  - [x] 14.2 State the answer verbatim and proceed; build nothing
    - Emit exactly: "no server-side Drive integration exists; Drive is a browser capability of the
      PWA"
    - Build no server-side Drive integration
    - Report a timestamp at completion of STEP 7
    - _Requirements: 15.3, 15.4, 15.6_

- [ ] 15. STEP 8 — A-G4 closed rather than left routable **[WAITS ON OPERATOR]**
  - [~] 15.1 Present the two coupled decisions with the stated default, then wait
    - Decision one: author the missing persona and register the codename (10/10 routable) **versus**
      remove the `decision_log` intent (9 routable, 9 resolved). Decision two: direct edit in the
      clone **versus** an emitted patch
    - **Stated default: remove the intent, emitted as a patch under
      `ops/nizamcore-patches/NNN-<slug>.patch`** — it is the smaller change, it invents no persona
      content on the Operator's behalf, and it stays inside steering §6
    - Report that the 2026-08-10 authorisation is scoped to the files needed to wire the life agent's
      model layer and take its relay live, and that A-G4 is arguably **outside** that scope. A run
      that reads a granted scope generously is how a scope stops meaning anything
    - **Wait for the Operator.** Do not carry out the default unasked
    - _Requirements: 16.1, 16.3, 16.4, 16.5_

  - [~] 15.2 Apply the Operator's answer without leaving the intent routable, and never push
    - Do not leave the `decision_log` intent routable to a codename absent from the runtime registry
      with no persona file — a classified message would surface as silence in the single window
    - Emit the change as a patch under `ops/nizamcore-patches/NNN-<slug>.patch` unless the Operator
      chose a direct edit; commit locally only
    - **Never push Nizamcore_Repo without an explicit "push granted"**
    - "Presented, awaiting the Operator" is **open**, not closed
    - Report a timestamp at completion of STEP 8
    - _Requirements: 16.2, 16.6, 16.7, 16.8, 21.2, 21.4_

- [x] 16. STEP 9 — the Final_Report **[reachable from any point in the run]**
  - [x] 16.1 Determine the T4 condition and the tier the finance agent actually routes at
    - Report that a finance eval run records `unmeasured` with reason `code_benchmark_not_run`, so
      `developerBuildPasses` answers `false`, and that `TIER_REQUIRED_ELIGIBILITY.T4` cannot be met
      by a finance eval run. Earning the registry does not fix this and neither does any credential
    - Read the routed tier from the router's own selection over the emitted registry, not inferred
      from the registry's contents
    - **If the proven reply path depends on T4: report that dependency as a separate blocker and NOT
      as a credential problem.** "T4 blocked pending model key" is the wrong report — it would send
      the Operator to fix something already correct
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 16.2 Emit exactly one Final_Report block, eleven lines, in the prescribed order
    - `PUSHED`, `HARNESS`, `SUITE`, `NIZAMCORE`, `T1 TRANSPORT`, `T2 MODEL`, `T3 STORE`, `DRIVE`,
      `A-G4`, `LIVE CONDITIONS`, `NEXT BLOCKER` — that order, and nothing else in the block
    - `HARNESS` quotes the harness's two summary lines verbatim. `SUITE` records the observed count
      against a floor of **2301** and never 2223
    - `T1 TRANSPORT`, `T2 MODEL` and `T3 STORE` are each OBSERVED or BLOCKED with a one-line reason
    - `NEXT BLOCKER` is one line naming the blocker **and the party who owns it**
    - Exclude every credential value and every deployment particular
    - Report a timestamp at completion of STEP 9
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 3.3, 13.1_

  - [x] 16.3 Honour the time box and state what was checked versus what was not
    - When the box expires, stop wherever the run is and file the Final_Report with whatever was
      measured. A partial report carrying Evidence_Of_Record beats a complete one carrying an
      inference
    - For each claim, state what was checked and what could not be checked. Label any working-tree
      fact absent from a commit an Observation with its date, never a decision
    - Record the observed test count above the floor and leave the ratchet as a follow-up — the floor
      is not raised this run, because changing it in the same run that reports against it would make
      the report self-referential
    - _Requirements: 22.4, 22.5, 22.6, 23.4, 23.5, 17.1, 17.2, 17.3_

- [~] 17. Final checkpoint — the run is reported
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- **The step order is fixed and must not be reordered.** The one sequencing decision worth stating:
  RUNG 1 (task 6) and the runner build (task 7) both complete **before the credential ask at task 9 is
  issued at all**, because R8.1 requires RUNG 1 to run before any credential is supplied and before
  any network call, and that reads strictly rather than narrowly only if no credential exists while
  the offline proofs run. This is the Operator's explicit choice; **its cost is that the Operator wait
  is no longer absorbed by other work.** RUNG 1 and the runner build still overlap **with each other**,
  since neither needs a credential.
- **Three hard gates stop the run:** task 2.3 (hold at STEP 1, do not execute STEP 3), task 3.1
  (fewer than 20/20 ⇒ report failing check identifiers, do not execute STEP 3), task 6.6 (any failed
  proof ⇒ halt the ladder at RUNG 1 and report that no credential can resolve it).
- **Two tasks wait on the Operator:** task 9 (the single credential list, asked once) and task 15
  (the A-G4 coupled decisions with the stated default). Task 12 additionally depends on the Operator
  sending a real message and confirming a reply arrived in their own client.
- **The four rungs stay independent.** Each produces OBSERVED-with-quoted-evidence or
  BLOCKED-with-one-line, from its own distinct systems of record. No rung is claimed on the rung
  below it and no two rungs share a report line.
- **No task is marked optional.** The four smoke tests are the run's only new tests and are named as
  acceptance criteria in R8.9, R9.9, R10.13 and R12.8 — they are the ladder's evidence mechanism, not
  discretionary coverage, so marking them skippable would gut the run. R18.1 and R18.2 fix the budget
  at exactly these four and forbid any other new test.
- **Nothing is weakened to make anything pass.** The Test_Floor stays at 2301 (never lowered, and not
  raised this run); no `eslint-disable` directive is added anywhere; no guard's allowlist or scan
  roots are widened, including AC18's — which is why the identity sweep is a separate one-off
  procedure. That is defect class F25.
- **Verification cadence.** The full suite runs exactly once, at task 3.1, immediately before the
  push, and never between steps. Every source-touching task verifies with `npm run typecheck`,
  `npm run lint`, and vitest **on the touched files only**.
- **Credential discipline.** One destination per value — the owning service's Env_File on the host,
  written at task 10.3 and nowhere earlier. Entry name everywhere else. Never in a tracked file,
  commit, log, fixture, comment, error message or the report. Never substitute one model key for the
  other. Invent nothing. Rotate nothing, and check `getWebhookInfo` as the compensating control.
- **Discriminate on `code`, never on a message.** Failures halt rather than degrade: no retry loop,
  no per-case fallback, no continue-on-error.
- **Two units, never joined.** Provider cost is integer micro-USD as the provider reported it; owner
  money is integer milliunits behind `src/lib/money/`. No `parseFloat` and no `.toFixed(` outside
  that module.
- **Cross-repo.** This repository is the only one written. Nizamcore_Clone commits locally and is
  never pushed without an explicit "push granted". Spec `07-bot-bringup-v1` is cited as evidence only
  and never modified.
- **Evidence discipline.** A started process is not a working one. A returned identifier is not an
  arrived message. A successful command is not a confirmed state. A working-tree fact absent from a
  commit is an Observation with its date.
- **This file carries no deployment particular** — every credential, host, address and identifier
  appears only as its `<ENTRY_NAME>` placeholder, because `.kiro/**` is tracked and is an input to the
  STEP 1 sweep.

## Task Dependency Graph

The graph encodes the fixed step order as a mostly linear chain, with one deliberate overlap: waves
11-17 run RUNG 1 (6.1-6.6) and the runner build (7.1-7.7) **concurrently with each other**, and both
finish before the credential ask opens. RUNG 1's terminal report leaf (6.6) lands at wave 16 and the
build's verification leaf (7.7) at wave 17, while the first credential-ask leaf (9.1) does not enter
until wave 18 — so no wave holds a credential-ask leaf alongside a RUNG 1 leaf or a runner-build leaf,
which is what makes R8.1 hold strictly. Each rung's smoke test enters the wave its rung opens, and the
leaf tasks that write the same file are always in different waves.

**STEP 9 (16.1-16.3) is reachable from any point.** It is placed last so the complete run reads in
order, but it is not gated on the rungs succeeding: when the time box expires at any wave, jump
straight to wave 42 and file the report with whatever was measured (R23.4, R23.5).

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["4.1"] },
    { "id": 7, "tasks": ["4.2"] },
    { "id": 8, "tasks": ["5.1"] },
    { "id": 9, "tasks": ["5.2"] },
    { "id": 10, "tasks": ["5.3"] },
    { "id": 11, "tasks": ["6.1", "7.1"] },
    { "id": 12, "tasks": ["6.2", "7.2"] },
    { "id": 13, "tasks": ["6.3", "7.3"] },
    { "id": 14, "tasks": ["6.4", "7.4"] },
    { "id": 15, "tasks": ["6.5", "7.5"] },
    { "id": 16, "tasks": ["6.6", "7.6"] },
    { "id": 17, "tasks": ["7.7"] },
    { "id": 18, "tasks": ["9.1"] },
    { "id": 19, "tasks": ["9.2"] },
    { "id": 20, "tasks": ["10.1"] },
    { "id": 21, "tasks": ["10.2"] },
    { "id": 22, "tasks": ["10.3"] },
    { "id": 23, "tasks": ["10.4", "10.7"] },
    { "id": 24, "tasks": ["10.5"] },
    { "id": 25, "tasks": ["10.6"] },
    { "id": 26, "tasks": ["10.8"] },
    { "id": 27, "tasks": ["11.1", "11.5"] },
    { "id": 28, "tasks": ["11.2"] },
    { "id": 29, "tasks": ["11.3"] },
    { "id": 30, "tasks": ["11.4"] },
    { "id": 31, "tasks": ["11.6"] },
    { "id": 32, "tasks": ["12.1", "12.6"] },
    { "id": 33, "tasks": ["12.2"] },
    { "id": 34, "tasks": ["12.3"] },
    { "id": 35, "tasks": ["12.4"] },
    { "id": 36, "tasks": ["12.5"] },
    { "id": 37, "tasks": ["12.7"] },
    { "id": 38, "tasks": ["14.1"] },
    { "id": 39, "tasks": ["14.2"] },
    { "id": 40, "tasks": ["15.1"] },
    { "id": 41, "tasks": ["15.2"] },
    { "id": 42, "tasks": ["16.1"] },
    { "id": 43, "tasks": ["16.2"] },
    { "id": 44, "tasks": ["16.3"] }
  ]
}
```
