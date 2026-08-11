# Requirements Document

## Introduction

This specification governs one time-boxed bringup run (60 minutes) that must ship three outcomes in
priority order: (1) this repository pushed to its remote master, (2) the other repository cloned
writable and its test suite RUN for the first time with the result recorded, (3) both bots live on the
host in long-poll mode replying to a real message. Outcomes 1 and 2 ship even if 3 proves impossible.

The run is executed as ten ordered steps, with step 6 replaced by a four-rung ladder. Each rung is
independently reportable as OBSERVED with quoted evidence or BLOCKED with a one-line reason. The
governing constraint of the whole run is that **no state is reported unless it was confirmed by opening
the system of record**: a successful command, a returned identifier, or a started process is not
evidence that the effect occurred.

This document contains NO deployment particular. Every credential, identifier, hostname and address is
referred to by its `<ENTRY_NAME>` placeholder only, per steering §0b and R24.

The measured corrections in the Glossary override the numbers stated in the originating contract,
because the contract's own standing rule requires a state to be confirmed against the system of record
before it is reported.

## Glossary

- **Bringup_Run**: the single time-boxed execution governed by this document, comprising STEP 0 through
  STEP 9 and the four ladder rungs.
- **Operator**: the human owner of the deployment. The only party who can supply a gated credential,
  send a real message from their own messaging client, or grant a push to the other repository.
- **Finance_Repo**: this repository, the finance agent's source tree, remote `origin`, branch `master`.
- **Nizamcore_Repo**: the other repository, the life agent's source tree, held under separate ownership
  and governed by steering §6.
- **Nizamcore_Clone**: a writable clone of Nizamcore_Repo at a sibling directory outside Finance_Repo's
  tree and outside the ignored path used for the earlier read-only copy.
- **Identity_Sweeper**: the scanning procedure run at STEP 1 over every tracked file of Finance_Repo,
  looking for the four disclosure shapes defined in Requirement 2.
- **Disclosure_Shape**: one of four text patterns: (a) the life bot display name or handle, (b) a
  numeric messaging user identifier of 8 to 10 digits, (c) a hostname, IPv4 address or hosting-provider
  address, (d) a 40-character mixed-case token shape that is not a git object hash.
- **Verification_Harness**: the acceptance gate invoked as `npm run verify:all -- --all`, comprising 20
  checks including AC04 (test floor), AC09 (`ops/` placeholders only), AC10 (contract/phase headers) and
  AC18 (deployment particulars, fails closed).
- **Test_Floor**: the `AC04 --min` value in `scripts/verify/all.mjs`. Measured value **2301**. The value
  2223 recorded elsewhere is stale.
- **Push_Verifier**: the procedure that, after a push, re-reads the remote reference and compares it to
  the local reference.
- **Credential_Intake**: the single request, issued once at STEP 5, for the values that cannot be minted
  by Bringup_Run.
- **Env_File**: a service's own environment file on the host: root-owned, mode-600, one per service, read
  by no other service (contract 12 §3.2.7).
- **Live_Transport**: the finance agent's messaging transport call stack, driven at RUNG 1 against a
  local fake responder with no network and no credential.
- **Fake_Responder**: a local in-process stand-in for the messaging provider, used at RUNG 1.
- **Env_Loader**: the finance agent's environment loading and validation path, which fails closed on any
  unset entry because `finance.env.example` declares no default for anything.
- **Registry_Runner**: the new entrypoint `scripts/benchmark/earn-registry.mjs` plus its `package.json`
  script, which dials, mints, grades and emits in ONE process invocation.
- **Witness_Chain**: the refusal path in `src/server/benchmark/liveRegistry.ts` comprising
  `validateEvalSet`, `auditEvalSet`, `assertWitnessedRuns`, the injected `verifyWitness`, and the
  injected `buildCaller`. `provisional: false` exists only downstream of it.
- **Live_Registry**: the emitted eligibility registry document carrying `provisional: false`.
- **Provisional_Registry**: an eligibility registry document carrying `provisional: true`. It may never
  promote a model for live routing.
- **End_To_End_Chain**: the six hops proven at RUNG 4: transport received, authenticated against the
  allowlist, queued, worker picked up, reply sent, reply arrived.
- **Store_Isolation**: the invariant that no process opens another agent's store, and no cross-store
  attach statement exists or resolves (steering §4 invariant 1).
- **Drive_Audit**: the STEP 7 determination of whether a server-side Drive integration exists at all.
- **Intent_Resolver**: the life agent's routing layer, in which the `decision_log` intent currently
  names a codename absent from the runtime registry with no persona file (gap A-G4).
- **Final_Report**: the single STEP 9 output block, in the exact prescribed shape, with nothing else.
- **Evidence_Of_Record**: a quoted reading taken from a system of record — a store row, a structured log
  line, a remote reference, a provider response body, or a test runner summary line.
- **Observation**: a fact measured on the working tree and not present in a commit. Labelled as an
  observation with its date, never as a decision.

## Requirements

### Requirement 1: Stillness before the irreversible step

**User Story:** As the Operator, I want every background writer stopped before anything irreversible
happens, so that no concurrent process changes the tree between a scan and a push.

#### Acceptance Criteria

1. WHEN STEP 0 begins, THE Bringup_Run SHALL stop all background loops and watchers that write into
   Finance_Repo.
2. WHEN all background writers are stopped, THE Bringup_Run SHALL emit the written confirmation line "no
   other process is writing this tree."
3. THE Bringup_Run SHALL record that `git status --porcelain` was measured empty and that `turnIntake.ts`
   is tracked, superseding the contract's claim of three mid-edit files and one untracked file.
4. IF a background writer cannot be stopped, THEN THE Bringup_Run SHALL name that writer and halt before
   STEP 1 rather than proceeding with a moving tree.
5. THE Bringup_Run SHALL report a timestamp at the completion of STEP 0.

### Requirement 2: Full identity sweep of every tracked file

**User Story:** As the Operator, I want every tracked file scanned from scratch for four disclosure
shapes before the push, so that the one irreversible step does not publish a deployment particular.

#### Acceptance Criteria

1. WHEN STEP 1 begins, THE Identity_Sweeper SHALL scan every tracked file of Finance_Repo across the
   full 47-commit range ahead of the remote, without inheriting any prior sweep result.
2. THE Identity_Sweeper SHALL scan for all four Disclosure_Shapes (a), (b), (c) and (d) in the same pass.
3. THE Identity_Sweeper SHALL cover paths under `.kiro/**`, which the Verification_Harness AC18 check has
   never covered because its scan roots are `ops` and `src/server/mocks/fixtures` only.
4. THE Identity_Sweeper SHALL report, for each Disclosure_Shape, a hit count and the list of file paths.
5. THE Identity_Sweeper SHALL exclude every matched value from its output, reporting counts and paths
   only.
6. IF Disclosure_Shape (a) or (b) produces a hit, THEN THE Bringup_Run SHALL correct the offending text,
   leave the AC18 scanner's allowlist and scan roots unchanged, and re-run the Identity_Sweeper.
7. WHILE any Disclosure_Shape (a) or (b) hit remains uncorrected and unanswered by the Operator, THE
   Bringup_Run SHALL hold at STEP 1 and SHALL NOT execute STEP 3.
8. THE Bringup_Run SHALL report a timestamp at the completion of STEP 1.

### Requirement 3: One full harness run, immediately before the push

**User Story:** As the Operator, I want the acceptance gate run exactly once at full strength before the
push, so that the published commits are gated without spending the time box on repeated full runs.

#### Acceptance Criteria

1. WHEN STEP 2 begins, THE Bringup_Run SHALL invoke the Verification_Harness as
   `npm run verify:all -- --all` exactly once.
2. THE Bringup_Run SHALL require 20 of 20 executed checks to pass before executing STEP 3.
3. THE Bringup_Run SHALL quote the Verification_Harness's two summary lines verbatim in the Final_Report.
4. IF fewer than 20 of 20 checks pass, THEN THE Bringup_Run SHALL report the failing check identifiers
   and SHALL NOT execute STEP 3.
5. THE Bringup_Run SHALL run the Verification_Harness at no other point in the run.
6. THE Bringup_Run SHALL report a timestamp at the completion of STEP 2.

### Requirement 4: The push is verified against the remote, not against the command

**User Story:** As the Operator, I want the push confirmed by reading the remote back, so that "the
command printed success" is never mistaken for "the commits are on the remote."

#### Acceptance Criteria

1. WHEN STEP 3 begins, THE Bringup_Run SHALL push Finance_Repo to `origin master`.
2. WHEN the push command returns, THE Push_Verifier SHALL re-read the reference from the remote and
   SHALL assert that the remote head equals the local head.
3. THE Push_Verifier SHALL report the remote object identifier, the local object identifier, and an ahead
   count of 0.
4. IF the remote head does not equal the local head, THEN THE Bringup_Run SHALL report the two
   identifiers and the remaining ahead count as a failure rather than as a success.
5. THE Bringup_Run SHALL treat the command's exit status alone as insufficient Evidence_Of_Record for a
   completed push.
6. THE Bringup_Run SHALL report a timestamp at the completion of STEP 3.

### Requirement 5: The other repository's tests are RUN for the first time

**User Story:** As the Operator, I want the other repository's suite actually executed rather than
counted from its files, so that a number that has only ever been read becomes a number that was
observed.

#### Acceptance Criteria

1. WHEN STEP 4 begins, THE Bringup_Run SHALL create Nizamcore_Clone as a writable clone at a sibling
   directory outside Finance_Repo's tree and outside the ignored path used for the earlier read-only
   copy.
2. THE Bringup_Run SHALL install Nizamcore_Clone's runtime requirements and SHALL execute its test suite.
3. THE Bringup_Run SHALL report the observed total test count and the observed passed count, and SHALL
   record that this is the first observed execution.
4. IF the suite does not execute at all, THEN THE Bringup_Run SHALL report the refusal as the finding,
   naming the single step that blocked it.
5. THE Bringup_Run SHALL commit changes to Nizamcore_Clone locally only and SHALL NOT push
   Nizamcore_Clone.
6. WHERE the Operator has stated "push granted", THE Bringup_Run SHALL treat a push of Nizamcore_Clone as
   permitted.
7. THE Bringup_Run SHALL report a timestamp at the completion of STEP 4.

### Requirement 6: One credential request, and every choosable value chosen

**User Story:** As the Operator, I want to be asked exactly once for only what cannot be minted, with
every operator-choosable and build-supplied value already decided and justified, so that I answer one
list instead of a stream of questions.

#### Acceptance Criteria

1. WHEN STEP 5 begins, THE Credential_Intake SHALL print exactly one list containing `BOT_A_TOKEN`,
   `BOT_B_TOKEN`, `OR_KEY_LIFE`, `OR_KEY_FINANCE`, `ALLOWED_USER_IDS`, `MODEL_API_BASE` and
   `MSG_API_BASE`, and SHALL then wait for the Operator.
2. THE Credential_Intake SHALL propose values for `MODEL_API_BASE` and `MSG_API_BASE` from each
   provider's own documentation, for the Operator to confirm.
3. THE Bringup_Run SHALL choose and state a value, with its reason, for every entry whose gate is
   `operator` or `build`: `FINANCE_DATA_DIR`, `FINANCE_STORE_FILE`, `STORE_BUSY_TIMEOUT_MS`,
   `FINANCE_CONTAINER_PORT`, `MAX_WORK_ITEMS`, `FINANCE_WEEKLY_CAP`, `KILL_SENTINEL_PATH`,
   `NIZAM_KILL_ALL`, `BUS_INTERNAL_ENDPOINT` and `MODEL_ELIGIBILITY_REGISTRY_PATH`, and their life-side
   counterparts.
4. THE Bringup_Run SHALL set `NIZAM_KILL_ALL` to `0`.
5. THE Bringup_Run SHALL set `TELEGRAM_MODE` to `longPoll` on both sides.
6. THE Bringup_Run SHALL generate a random value for `MONEY_WEBHOOK_SECRET` and for
   `LIFE_WEBHOOK_SECRET`, SHALL tell the Operator that each was generated, SHALL note that neither is
   used on the long-poll path, and SHALL NOT ask the Operator for either.
7. THE Credential_Intake SHALL issue its request exactly once and SHALL NOT proceed on a guessed value.
8. THE Bringup_Run SHALL report a timestamp at the completion of STEP 5.

### Requirement 7: A credential is never disclosed anywhere

**User Story:** As the Operator, I want every credential to exist in exactly one place and never appear
in any artefact, so that a public repository and a run report disclose nothing.

#### Acceptance Criteria

1. THE Bringup_Run SHALL write a credential value to exactly one destination: the owning service's
   Env_File on the host.
2. THE Bringup_Run SHALL refer to a credential by its entry name in every message, log line, commit,
   test fixture, comment, error message and report.
3. THE Bringup_Run SHALL exclude every credential value from every tracked file, every commit, every log
   line, every test fixture, every code comment, every error message and the Final_Report.
4. IF a provider rejects a credential, THEN THE Bringup_Run SHALL report the provider's refusal code and
   the entry name, and SHALL exclude the value.
5. THE Bringup_Run SHALL use `OR_KEY_FINANCE` and `OR_KEY_LIFE` only for their own agent, and SHALL NOT
   substitute one for the other under any failure condition.
6. THE Bringup_Run SHALL invent no credential value, including a plausible placeholder of the correct
   shape.
7. THE Bringup_Run SHALL rotate no credential, consistent with the standing D-ROTATE deferral.
8. WHEN any run executes, THE Bringup_Run SHALL check `getWebhookInfo` as the compensating detection
   control for the D-ROTATE deferral.

### Requirement 8: RUNG 1 — the transport proves itself offline, with no network and no credential

**User Story:** As the Operator, I want the live transport proven against a local fake before any
credential is supplied, so that a failure that no key can fix is found first.

#### Acceptance Criteria

1. THE Bringup_Run SHALL execute RUNG 1 before any credential is supplied and before any network call.
2. WHEN RUNG 1 runs, THE Live_Transport SHALL be driven against the Fake_Responder with no network
   access and no credential present.
3. THE Bringup_Run SHALL prove that Live_Transport composes the request correctly, and SHALL quote the
   composed request object as Evidence_Of_Record.
4. THE Bringup_Run SHALL prove that authentication is applied to the request AND that the credential
   value does not appear anywhere in the request object.
5. THE Bringup_Run SHALL prove that response parsing handles all five of: a success body, a non-success
   status, a rate-limit response carrying a retry hint, a malformed body, and a body exceeding the size
   bound.
6. THE Bringup_Run SHALL prove that telemetry emits exactly one structured line per request, and that
   the line excludes the credential, the request body, the sender identity and the provider base address.
7. THE Bringup_Run SHALL prove that the store write lands, by reading the written row back from the
   store.
8. IF any of the five RUNG 1 proofs fails, THEN THE Bringup_Run SHALL halt the ladder at RUNG 1 and
   SHALL report that no credential can resolve the failure.
9. THE Bringup_Run SHALL add exactly one new smoke test for RUNG 1.

### Requirement 9: RUNG 2 — credentials wired, environment accepted, isolation proven, still no model call

**User Story:** As the Operator, I want each service to load its own full environment and reach ready,
with proof that neither side holds the other's secrets, so that isolation is measured rather than
assumed.

#### Acceptance Criteria

1. BEFORE writing any Env_File, THE Bringup_Run SHALL confirm that `.env` and `ops/env/*.env` are
   matched by `.gitignore`, and SHALL quote the matching entries.
2. THE Bringup_Run SHALL write each Env_File on the host as root-owned, mode-600, one per service, read
   by no other service.
3. THE Bringup_Run SHALL commit no filled Env_File.
4. WHEN each service is started, THE Env_Loader SHALL accept all 16 declared entries and the process
   SHALL reach ready rather than refusing.
5. IF the Env_Loader refuses, THEN THE Bringup_Run SHALL report the refusing entry name and SHALL
   exclude its value.
6. THE Bringup_Run SHALL prove the negative direction: the finance Env_File holds no life secret, and the
   life Env_File holds no finance secret.
7. THE Bringup_Run SHALL prove that neither agent's store path resolves from the other agent's container.
8. THE Bringup_Run SHALL make no model call during RUNG 2.
9. THE Bringup_Run SHALL add exactly one new smoke test for RUNG 2.

### Requirement 10: RUNG 3 — the registry is earned, then one real model response is quoted

**User Story:** As the Operator, I want the eligibility registry produced by the witness chain and the
spend reported in the provider's own accounting, so that live routing rests on a measurement rather than
on a document that claims one.

#### Acceptance Criteria

1. THE Bringup_Run SHALL build the Registry_Runner as `scripts/benchmark/earn-registry.mjs` plus a
   `package.json` script, because no existing script is benchmark-related.
2. THE Registry_Runner SHALL dial, mint, grade and emit within ONE process invocation, without
   resumability and without a checkpoint file.
3. THE Registry_Runner SHALL inject the existing `isLiveMeasurementWitness` implementation unchanged as
   `verifyWitness`, and SHALL inject `buildCaller`.
4. THE Registry_Runner SHALL fund its run from the development model key, from the local developer
   machine, and SHALL NOT use `OR_KEY_FINANCE`.
5. THE Registry_Runner SHALL run both default-allowed models so the registry carries a genuine
   cheapest-capable choice, and SHALL NOT enable any model outside the default-allowed set.
6. BEFORE spending anything, THE Bringup_Run SHALL compute and report a pre-flight cost estimate against
   the development weekly ceiling.
7. IF the pre-flight estimate does not fit within the development weekly ceiling, THEN THE Bringup_Run
   SHALL report RUNG 3 as BLOCKED at the estimated number and SHALL spend nothing.
8. BEFORE claiming RUNG 3, THE Bringup_Run SHALL report four numbers: cases in the eval set, cases
   answered, models graded, and the actual cost in the provider's own accounting unit as the provider
   reported it.
9. THE Bringup_Run SHALL take the actual cost as integer micro-USD exactly as the provider reported it,
   and SHALL NOT convert, re-derive or estimate it.
10. WHEN the Live_Registry is emitted, THE Bringup_Run SHALL point
    `MODEL_ELIGIBILITY_REGISTRY_PATH` at it and SHALL make ONE controlled model call and quote the
    response body as Evidence_Of_Record.
11. IF the Live_Registry cannot be earned within the time box, THEN THE Bringup_Run SHALL stop the ladder
    at RUNG 2 and SHALL report transport live, routing refusing on a provisional registry, and the
    Registry_Runner's completion state.
12. THE Bringup_Run SHALL accept that a crash or refusal mid-run forfeits the spend already incurred and
    restarts from zero, and SHALL introduce no new trust mechanism to avoid that cost.
13. THE Bringup_Run SHALL add exactly one new smoke test for RUNG 3.

### Requirement 11: The three forbidden shortcuts around the witness chain

**User Story:** As the Operator, I want the three ways of faking a measured registry explicitly
forbidden and testable, so that the gate cannot be satisfied by bypassing it.

#### Acceptance Criteria

1. THE Bringup_Run SHALL produce a registry document carrying `provisional: false` only as the return
   value of `emitLiveRegistry` downstream of the Witness_Chain.
2. THE Bringup_Run SHALL NOT hand-write or hand-edit any registry document to carry `provisional: false`.
3. THE Bringup_Run SHALL implement `verifyWitness` as the existing `isLiveMeasurementWitness` and SHALL
   NOT supply a verifier that returns a constant acceptance.
4. THE Bringup_Run SHALL state in writing what `verifyWitness` checks.
5. THE Bringup_Run SHALL prove that `verifyWitness` REFUSES a tampered witness AND accepts a genuine
   one, because a gate observed only passing is unproven.
6. THE Bringup_Run SHALL NOT point `MODEL_ELIGIBILITY_REGISTRY_PATH` at a Provisional_Registry and then
   report routing as working.
7. WHILE `MODEL_ELIGIBILITY_REGISTRY_PATH` resolves to a Provisional_Registry, THE Bringup_Run SHALL
   report live routing as refused.
8. THE Bringup_Run SHALL report a process reaching ready as insufficient Evidence_Of_Record for working
   routing.

### Requirement 12: RUNG 4 — a real message proven hop by hop

**User Story:** As the Operator, I want every hop of the reply chain read from a system of record, so
that a reply is proven end to end rather than inferred from one hop or from the absence of an error.

#### Acceptance Criteria

1. WHEN the Operator sends a real message from their own messaging client, THE End_To_End_Chain SHALL be
   proven hop by hop.
2. THE Bringup_Run SHALL read each of the six hops — transport received, authenticated against the
   allowlist, queued, worker picked up, reply sent, reply arrived — from the store or from the structured
   log, and SHALL quote each reading.
3. THE Bringup_Run SHALL treat the absence of an error as insufficient Evidence_Of_Record for any hop.
4. THE Bringup_Run SHALL treat evidence of one hop as insufficient Evidence_Of_Record for any other hop.
5. THE Bringup_Run SHALL accept a reply appearing in the Operator's own messaging client as the only
   evidence for the final hop.
6. WHEN the chain is proven, THE Bringup_Run SHALL prove Store_Isolation in both directions.
7. THE Bringup_Run SHALL operate both sides in long-poll mode and SHALL make no DNS change, no
   certificate request, no public port publication and no webhook registration.
8. THE Bringup_Run SHALL add exactly one new smoke test for RUNG 4.

### Requirement 13: The rungs stay independent

**User Story:** As the Operator, I want each rung reported on its own evidence, so that a lower rung's
success is never borrowed to claim a higher one.

#### Acceptance Criteria

1. THE Bringup_Run SHALL report each rung as OBSERVED with quoted Evidence_Of_Record, or as BLOCKED with
   a one-line reason.
2. THE Bringup_Run SHALL NOT merge two rungs into a single report line.
3. THE Bringup_Run SHALL NOT claim a rung on the evidence of the rung below it.
4. THE Bringup_Run SHALL execute the rungs in order 1, 2, 3, 4.

### Requirement 14: The T4 tier is unroutable by this path, and that is reported

**User Story:** As the Operator, I want to be told which tier the finance agent actually routes at, so
that a structural limit is not mistaken for a credential problem.

#### Acceptance Criteria

1. THE Bringup_Run SHALL report that a finance eval run records `unmeasured` for the developer/build
   verdict with reason `code_benchmark_not_run`, so `developerBuildPasses` answers `false`.
2. THE Bringup_Run SHALL report that `TIER_REQUIRED_ELIGIBILITY.T4` cannot be met by a finance eval run.
3. THE Final_Report SHALL state which tier the finance agent actually routes at.
4. THE Final_Report SHALL state whether the proven reply path depends on tier T4.
5. IF the proven reply path depends on tier T4, THEN THE Bringup_Run SHALL report that dependency as a
   separate blocker and SHALL NOT report it as a credential problem.

### Requirement 15: The Drive question is answered, not built

**User Story:** As the Operator, I want a precise answer about server-side Drive integration, so that a
missing capability is documented rather than invented.

#### Acceptance Criteria

1. WHEN STEP 7 begins, THE Drive_Audit SHALL determine whether a server-side Drive integration path
   exists.
2. WHERE a server-side Drive path exists, THE Drive_Audit SHALL name the module and the credential entry
   it requires.
3. WHERE no server-side Drive path exists, THE Drive_Audit SHALL state "no server-side Drive integration
   exists; Drive is a browser capability of the PWA" and SHALL proceed.
4. THE Bringup_Run SHALL build no server-side Drive integration.
5. THE Drive_Audit SHALL cite the evidence it read, including the absence of a Drive credential entry in
   either environment template.
6. THE Bringup_Run SHALL report a timestamp at the completion of STEP 7.

### Requirement 16: A-G4 is closed rather than left routable

**User Story:** As the Operator, I want the unresolvable routable intent closed, so that a classified
message cannot surface as silence in the single window.

#### Acceptance Criteria

1. WHERE time remains after RUNG 4, THE Bringup_Run SHALL close gap A-G4 by either authoring the missing
   persona and registering the codename, or removing the `decision_log` intent.
2. THE Bringup_Run SHALL NOT leave the `decision_log` intent routable to a codename absent from the
   runtime registry.
3. THE Bringup_Run SHALL default to removing the `decision_log` intent, emitted as a patch under
   `ops/nizamcore-patches/NNN-<slug>.patch`, because it is the smaller change, invents no persona content
   on the Operator's behalf, and stays inside steering §6.
4. THE Bringup_Run SHALL present the two coupled decisions — persona-and-register versus intent removal,
   and direct edit versus emitted patch — to the Operator with the stated default, and SHALL wait.
5. THE Bringup_Run SHALL report that the 2026-08-10 authorisation is scoped to the files needed to wire
   the life agent's model layer and take its relay live, and that A-G4 is arguably outside that scope.
6. THE Bringup_Run SHALL NOT push Nizamcore_Repo without an explicit "push granted" from the Operator.
7. THE Final_Report SHALL state A-G4 as closed or open.
8. THE Bringup_Run SHALL report a timestamp at the completion of STEP 8.

### Requirement 17: The gate floor and the guards are never weakened

**User Story:** As the Operator, I want the ratchet held, so that speed is bought from coverage rather
than from the gate.

#### Acceptance Criteria

1. THE Bringup_Run SHALL keep the `AC04 --min` Test_Floor at 2301 or higher.
2. THE Bringup_Run SHALL NOT lower the Test_Floor for any reason.
3. THE Bringup_Run SHALL report the Test_Floor as 2301, and SHALL NOT report 2223.
4. THE Bringup_Run SHALL add no `eslint-disable` directive.
5. THE Bringup_Run SHALL NOT widen any guard's allowlist or scan roots, including the AC18 scan roots.
6. THE Bringup_Run SHALL NOT weaken a gate to make it pass.
7. THE Bringup_Run SHALL declare the owning contract and phase in the first 20 lines of every new file
   under `src/` or `tests/`.
8. THE Bringup_Run SHALL keep `ops/` values as `<ANGLE_BRACKET>` placeholders only.
9. THE Bringup_Run SHALL keep `src/features/benchmark/` and `src/features/routing/` out of the
   application bundle.

### Requirement 18: The testing budget is bounded to four new tests

**User Story:** As the Operator, I want the test spend fixed in advance, so that the time box is spent on
observation rather than on coverage.

#### Acceptance Criteria

1. THE Bringup_Run SHALL add exactly four new tests in total: one smoke test per ladder rung.
2. THE Bringup_Run SHALL add no other new test.
3. WHEN a step touches source files, THE Bringup_Run SHALL verify that step with `npm run typecheck`,
   `npm run lint`, and the test runner scoped to the touched files only.
4. THE Bringup_Run SHALL run the full test suite exactly once, immediately before the push.
5. THE Bringup_Run SHALL NOT run the full test suite between steps.

### Requirement 19: The host is confirmed reachable by a read, and the register disagreement is a finding

**User Story:** As the Operator, I want the host's real state measured before anything is written to it,
and the gate register's disagreement with reality reported.

#### Acceptance Criteria

1. BEFORE writing any Env_File, THE Bringup_Run SHALL confirm host reachability with a read-only probe
   over the existing key material.
2. THE Bringup_Run SHALL treat that probe as a read under steering §2a and SHALL make no mutation during
   it.
3. THE Bringup_Run SHALL report that gate G1 is done in fact while `pfos-current.md` records the host as
   not provisioned and spec 07 wave 3 lists G1 as open.
4. THE Bringup_Run SHALL report that disagreement between the gate register and measured reality as a
   finding in its own right.
5. IF the read-only probe fails, THEN THE Bringup_Run SHALL report RUNG 2 as BLOCKED naming the probe as
   the blocked step.

### Requirement 20: Two-agent isolation invariants hold throughout

**User Story:** As the Operator, I want the isolation invariants preserved by every action in the run, so
that bringing the agents live does not join them.

#### Acceptance Criteria

1. THE Bringup_Run SHALL keep the three stores separate and SHALL ensure no process opens another agent's
   store.
2. THE Bringup_Run SHALL issue no cross-store attach statement.
3. THE Bringup_Run SHALL route all cross-agent data through the signal bus and SHALL expose the bus only
   on the internal network.
4. THE Bringup_Run SHALL ensure no signal payload carries a balance, a due date, an account identifier,
   journal text, or free text exceeding 120 characters.
5. THE Bringup_Run SHALL ensure `strict_local_maximum` classified data never reaches the host.
6. THE Bringup_Run SHALL ensure the model tier sources no monetary number.
7. THE Bringup_Run SHALL keep both agents honouring `NIZAM_KILL_ALL` and their own weekly cap.
8. THE Bringup_Run SHALL express all owner money as integer milliunits through `src/lib/money/`, and
   SHALL use no `parseFloat` or `toFixed` outside that module.

### Requirement 21: Cross-repository edits leave this repository as the only one written

**User Story:** As the Operator, I want changes to the other repository emitted as reviewable patches
unless authorisation covers them, so that ownership boundaries stay intact.

#### Acceptance Criteria

1. THE Bringup_Run SHALL treat a clone or fetch of Nizamcore_Repo as a read, and a modify or push as a
   mutation.
2. WHERE a change to Nizamcore_Repo falls outside the 2026-08-10 authorisation scope, THE Bringup_Run
   SHALL emit it as a patch under `ops/nizamcore-patches/NNN-<slug>.patch`.
3. THE Bringup_Run SHALL place Nizamcore_Clone outside Finance_Repo's tracked tree.
4. THE Bringup_Run SHALL NOT modify spec `07-bot-bringup-v1`, and SHALL cite it as evidence only.

### Requirement 22: Every reported state is confirmed against a system of record

**User Story:** As the Operator, I want the run to distinguish a confirmed fact from an inference, so
that the report can be trusted without re-doing the work.

#### Acceptance Criteria

1. THE Bringup_Run SHALL report a state only when it has been confirmed by opening the system of record
   for that state.
2. THE Bringup_Run SHALL treat a process starting as insufficient Evidence_Of_Record that the process
   works.
3. THE Bringup_Run SHALL treat a returned identifier as insufficient Evidence_Of_Record that a message
   arrived.
4. WHEN a fact is measured on the working tree and is absent from a commit, THE Bringup_Run SHALL label
   it an Observation with its date.
5. THE Bringup_Run SHALL NOT label an Observation a decision.
6. THE Bringup_Run SHALL state, for each claim it makes, what was checked and what could not be checked.

### Requirement 23: A blockage is decomposed to the single blocked step

**User Story:** As the Operator, I want a blockage named precisely, so that a wall that is really four
steps with one bad step is not raised as a wall.

#### Acceptance Criteria

1. IF an objective cannot be completed, THEN THE Bringup_Run SHALL decompose it into its steps and SHALL
   name which single step is blocked.
2. THE Bringup_Run SHALL name the party responsible for each blocked step.
3. THE Bringup_Run SHALL NOT report a multi-step obstacle as a single undifferentiated wall.
4. WHEN the time box expires, THE Bringup_Run SHALL stop and SHALL file the Final_Report with whatever
   was measured.
5. THE Bringup_Run SHALL prefer a partial Final_Report carrying Evidence_Of_Record over a complete one
   carrying an inference.

### Requirement 24: The final report has one exact shape

**User Story:** As the Operator, I want one report block in a fixed shape, so that the run's outcome is
readable at a glance and comparable across runs.

#### Acceptance Criteria

1. WHEN STEP 9 begins, THE Bringup_Run SHALL emit exactly one Final_Report block and nothing else.
2. THE Final_Report SHALL contain the lines `PUSHED`, `HARNESS`, `SUITE`, `NIZAMCORE`, `T1 TRANSPORT`,
   `T2 MODEL`, `T3 STORE`, `DRIVE`, `A-G4`, `LIVE CONDITIONS` and `NEXT BLOCKER`, in that order.
3. THE Final_Report SHALL record `SUITE` against a floor of 2301.
4. THE Final_Report SHALL record each of `T1 TRANSPORT`, `T2 MODEL` and `T3 STORE` as OBSERVED or BLOCKED
   with a one-line reason.
5. THE Final_Report SHALL record `NEXT BLOCKER` as one line naming the blocker and the party who owns it.
6. THE Final_Report SHALL exclude every credential value and every deployment particular.
7. THE Bringup_Run SHALL report a timestamp at the completion of STEP 9.
