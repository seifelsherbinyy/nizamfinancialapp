# Implementation Plan: Unified Personal Operating Intelligence

## Overview

This plan derives offline, synthetic, dependency-aware implementation work from the current UPOI requirements and proposed design. The implementation language selected for this plan is **Python**. Python components must integrate through an injected deterministic PFOS port and must never create a second money implementation; PFOS remains the sole financial authority.

This is a planning artifact only. It authorizes no production code change, deployment, network call, provider spend, secret handling, Drive/Telegram mutation, human-gate completion, commit, or push. All fixtures and rehearsals use synthetic values and redacted identifiers.

## Governing constraints

- PFOS is the deterministic financial authority; model, router, Hermes, Telegram, context, and Drive output cannot source or overwrite monetary truth.
- Money is integer milliunits at every canonical boundary; no floating-point conversion, estimation, or model-generated monetary persistence.
- Google Drive is an encrypted archive/projection under `drive.file` only; keys and secrets never enter Drive.
- Every consequential effect requires explicit authority, a scoped grant, idempotency, append-only audit, post-action verification, and a rollback reference.
- Provenance is complete, content-addressed, privacy-aware, and non-authoritative; incomplete or restricted context fails closed.
- Existing user changes, deletions, modifications, and untracked artifacts are protected. No task may reset, clean, overwrite, revert, or infer current acceptance from historical evidence.
- Routing and benchmark code remain outside the browser bundle; fixtures contain no real ledgers, secrets, hostnames, IPs, Drive identifiers, bot identifiers, or deployment particulars.
- Human-gated live work is explicitly **BLOCKED** until the owner provides applicable authorization and all offline predecessor gates are green. No task below may execute G1-G8, OAuth consent, webhook/DNS/host mutation, production provider spend, credential work, or cross-repository mutation.

## Tasks

- [x] 1. Establish governed UPOI contracts, schemas, and immutable evidence primitives
  - [x] 1.1 Define Python typed models for authority classes, evidence labels, provenance records, objective definitions/evaluations, action plans, grants, gates, execution receipts, verification receipts, and typed blockers.
    - Preserve the eight authority classes and distinguish owner, governance, deterministic-domain, runtime, interface, context, archive, and evidence-only authority.
    - Reject malformed hashes, non-UTC timestamps, incomplete provenance, and unsupported authority transfers.
    - _Requirements: 1.1, 1.3, 1.4; Design Sections 6, 7.1, 7.4_
  - [x] 1.2 Implement the canonical ordered twenty-objective registry and fail-closed validator.
    - Require exactly twenty unique entries, IDs 1–20 in order, immutable supplied slugs/questions, and exactly five normalized words per question.
    - Render and evaluate from one validated registry; do not maintain a second dashboard list.
    - _Requirements: 1.1, 1.3; Design Sections 10, 10.1; Property 1_
  - [x] 1.3 Implement immutable baseline manifests, append-only evidence-chain events, loop admission, and loop closure records.
    - Require content-addressed immutable baselines, bounded allowed/prohibited scope, exit criteria, positive control, negative test, regression check, rollback reference, and dashboard rerun metadata.
    - Prevent check-floor reduction, baseline rewriting, and conversion of failed/regressed/blocked loops into passed loops.
    - _Requirements: 1.3; Design Sections 9.2, 10.2, 14.2, 18_
  - [x] 1.4 Write unit and contract tests for authority separation, provenance validation, twenty-objective validation, baseline immutability, and loop-state transitions.
    - Cover malformed records, duplicate objective IDs, reordered questions, tampered evidence links, missing rollback references, and `BLOCKED_HUMAN` outcomes.
    - _Requirements: 1.1, 1.3, 1.4_

- [x] 2. Implement governance planning, grants, gates, and receipt traceability
  - [x] 2.1 Implement operator-turn planning and authority classification.
    - Classify intent, target authority, risk, required grants, preconditions, postconditions, idempotency key, rollback reference, and applicable human gate before dispatch.
    - Unknown or uncovered authority rules must produce bounded clarification/refusal with zero external effect.
    - _Requirements: 1.1, 1.2, 1.4; Design Sections 6.1, 7.4, 9.1_
  - [x] 2.2 Implement grant admission and human-gate enforcement as fail-closed policy.
    - Reject absent, stale, over-broad, profile-mismatched, or scope-mismatched grants; never infer owner approval from context, model output, historical receipts, or test fixtures.
    - Record one explicit next owner action for blocked plans without exposing guard details.
    - _Requirements: 1.1, 1.2; Design Sections 8.2, 14.2, 22_
  - [x] 2.3 Implement bounded dispatch, append-only audit receipts, post-action verification, and safe duplicate replay handling.
    - Link governing contract/requirement references through plan, execution, and verification receipts; preserve the original idempotency key on retries.
    - Ensure external state is never blindly retried when verification is unknown.
    - _Requirements: 1.3; Design Sections 6.1, 7.4, 9.1, 19.3_
  - [x] 2.4 Write the property-based test for **Property 3: Bounded effect execution**.
    - Generate authority, risk, grant, gate, idempotency, audit, verification, and rollback combinations; assert every missing/stale approval produces zero effect and every accepted effect has the complete receipt chain.
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 3. Implement the deterministic PFOS boundary without duplicating financial computation
  - [x] 3.1 Implement the injected Python `DeterministicFinancePort` adapter and unavailable-source behavior.
    - Read financial snapshots and decision results only from the existing authoritative PFOS implementation through a typed port; preserve source-version and provenance references.
    - Refuse and report source unavailability; never estimate, synthesize, or ask a model/router/context/archive to fill a monetary gap.
    - _Requirements: 2.1, 2.2, 2.3, 2.4; Design Sections 6.2, 7.5, 11_
  - [x] 3.2 Implement strict integer-milliunit boundary validation and serialization adapters.
    - Accept only lossless safe integer milliunits, preserve signed flow conventions, and carry exact values through browser/server/migration/queue/archive envelopes without floating-point conversion.
    - Delegate financial arithmetic to PFOS; do not add Python financial formulas, float parsing, decimal rounding, or alternate writers.
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3; Design Sections 6.2, 7.5, 11.1_
  - [x] 3.3 Implement non-authoritative explanation composition that cites deterministic result references.
    - Keep model/Hermes explanations separate from financial values and prevent explanation text from becoming a persistence or decision input.
    - _Requirements: 2.2, 2.4; Design Sections 6.2, 8.1, 7.5_
  - [x] 3.4 Write boundary and parity tests for milliunits, overflow, lossless parsing, deterministic formatting, signed conventions, and browser/server fixtures.
    - Include synthetic EGP boundary cases where one EGP is exactly 1000 milliunits; prove rejection before calculation/persistence and prove no drift across every envelope.
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 3.5 Write the property-based test for **Property 2: Financial authority preservation**.
    - Generate safe and unsafe monetary inputs plus deterministic-source availability states; assert only PFOS-sourced integer results can be authoritative and unavailable PFOS never yields a substitute result.
    - **Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3**

- [x] 4. Implement provenance context, locality controls, and bounded Hermes execution
  - [x] 4.1 Implement the provenance context port over approved local/indexed content.
    - Support bounded search, profile-local loading, provenance explanation, source hash/version, observed time, privacy class, confidence, and authority class.
    - Refuse incomplete, stale, corrupt, unclassified, or wrong-profile content instead of guessing or silently widening scope.
    - _Requirements: 1.4, 2.4; Design Sections 6.5, 7.1, 20_
  - [x] 4.2 Implement profile policy and the Hermes runtime adapter as an execution-only boundary.
    - Expose capabilities/readiness and invoke only explicitly granted bounded tools; prevent self-granting, policy decisions, financial sourcing, human-gate completion, and cross-profile leakage.
    - Keep routing/benchmark modules server-only and out of the browser bundle.
    - _Requirements: 1.1, 1.2, 1.4, 2.2; Design Sections 6.3, 12, 22_
  - [x] 4.3 Write the property-based test for **Property 4: Provenance and locality**.
    - Generate complete/incomplete provenance, privacy classes, profile policies, and restricted content; assert only permitted complete items enter profile context and restricted/local-only items cannot reach provider-bound context.
    - **Validates: Requirements 1.4, 2.4**
  - [x] 4.4 Write unit and contract tests for profile capability denial, restricted-context egress refusal, readiness-state distinctions, and non-authoritative model explanations.
    - _Requirements: 1.2, 1.4, 2.2, 2.4_

- [ ] 5. Implement operator intake, durable queue, consent bus, and offline turn composition
  - [x] 5.1 Implement the authenticated operator message port and durable queue adapter.
    - Enforce authentication/allowlist, bot-scoped delivery keys, atomic claim, durable enqueue before acknowledgement, bounded leases/reclaim, retries, and generic refusal codes.
    - Preserve duplicate delivery as a successful no-op and never log message bodies, user identifiers, tokens, or webhook particulars.
    - _Requirements: 1.1, 1.2, 1.3; Design Sections 6.4, 9.1, 20_
  - [-] 5.2 Implement the closed consent-gated signal envelope and append-only signal adapter.
    - Permit only bounded nonnumeric state, explicit consent scope, de-identified references, integrity hashes, deduplication, and schema-versioned receipts; reject balances, due dates, account identifiers, journal text, and unrestricted free text.
    - Keep separate `life.db`, `finance.db`, and `signals.db` boundaries with no cross-database attachment.
    - _Requirements: 1.2, 1.4, 2.2; Design Sections 4, 6.4, 20, 22_
  - [x] 5.3 Wire the offline read-only flow from synthetic authenticated delivery through queue, governance, deterministic PFOS read, optional cited explanation, and redacted reply.
    - Verify that financial answers cite PFOS version references and that context/model output cannot alter the returned monetary result.
    - _Requirements: 1.1, 1.3, 2.1, 2.2, 2.4_
  - [x] 5.4 Write property-based tests for duplicate delivery sequences, queue interruption/reclaim schedules, same-key replay, and forbidden signal fields.
    - Assert no duplicate canonical effect, no acknowledgement before durable enqueue, no cross-profile queue leakage, and no signal payload containing numeric financial state.
    - _Requirements: 1.2, 1.3, 1.4, 2.2_
  - [x] 5.5 Write the offline integration test for authenticated intake → queue → governance → PFOS → redacted reply and blocked unknown-authority flow.
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 2.4_

- [ ] 6. Implement Drive archive controls and non-destructive PFOS/MAL migration rehearsal
  - [-] 6.1 Implement the Drive archive port behind a testable injected provider.
    - Stage only sanitized artifacts, encrypt when required, enforce `drive.file`, keep keys out of artifacts, use idempotency keys, and require destination hash/version read-back before a verified success.
    - Treat upload/read-back mismatch as failure and retain a prior verified mirror reference.
    - _Requirements: 1.3, 1.4, 3.3; Design Sections 6.6, 9.3, 19.2_
  - [x] 6.2 Implement a read-only synthetic MAL/PFOS migration mapper and staged parity receipt.
    - Inventory schemas and units without reading real ledgers; transform only synthetic records into PFOS-shaped candidates; prove exact milliunit conversion and deterministic output parity.
    - Never delete or rewrite a legacy source, change the canonical writer, dual-write automatically, or perform cutover.
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3; Design Section 11.1_
  - [x] 6.3 Write archive and migration contract tests.
    - Cover missing approval, wrong scope, key-bearing artifact rejection, read-back mismatch, same-key replay, parity mismatch, unexplained records, and staged-only migration receipts.
    - _Requirements: 1.2, 1.3, 2.3, 3.3_
  - [x] 6.4 Implement offline rollback/restore rehearsal helpers using synthetic encrypted snapshots.
    - Model halt intake, fence workers, capture redacted evidence, restore a known-good snapshot/binary reference, preserve failed candidates, safely reclaim work under original keys, and rerun verification checks.
    - Do not execute deployment, restore a real store, or touch `ops/DEPLOYMENT_CONTROL.md`.
    - _Requirements: 1.3, 2.3, 3.3; Design Section 19_
  - [x] 6.5 Write the integration test for encrypted archive → destination read-back → mismatch handling → synthetic restore and PFOS/MAL parity refusal.
    - _Requirements: 1.3, 2.3, 3.3_

- [ ] 7. Implement the read-only objective dashboard and complete-loop control plane
  - [x] 7.1 Implement the objective evaluation read model and dashboard projection.
    - Render only the validated twenty-objective registry; distinguish current-baseline evidence from historical evidence; show `BLOCKED_HUMAN`, `BLOCKED_DEPENDENCY`, `FAILED`, and `REGRESSED` distinctly from completion.
    - Prevent any dashboard route or control from writing finance, life, signal, queue, Drive, or runtime state.
    - _Requirements: 1.3, 1.4, 2.1, 3.3; Design Sections 7.2, 10, 10.1_
  - [x] 7.2 Implement one complete-loop definition/adapter for UPOI-L01 through UPOI-L20.
    - Require immutable baseline, bounded allowed/prohibited scope, exit criteria, positive control, negative test, regression check, rollback reference, dashboard rerun, and typed blocker/next action for every loop.
    - Map financial objectives to read-only deterministic PFOS evidence and preserve the PFOS/MAL migration alias without creating a new authority.
    - _Requirements: 1.3, 1.4, 2.1, 2.2, 3.4; Design Sections 10.2, 18_
  - [x] 7.3 Write the property-based test for **Property 1: Objective registry completeness**.
    - Generate missing, duplicate, reordered, and reworded registries; assert validation fails closed and no dashboard evaluation proceeds from an invalid registry.
    - **Validates: Requirements 1.1, 1.3**
  - [-] 7.4 Write the property-based test for **Property 5: Loop evidence integrity**.
    - Generate tampered baselines, check omissions, lowered floors, invalid chain heads, failed reruns, and human-gate blockers; assert only a complete same-baseline chain can close and failed/regressed loops remain non-passed.
    - **Validates: Requirements 1.2, 1.3, 1.4**
  - [x] 7.5 Write dashboard/read-model tests for twenty-objective rendering, historical/current evidence separation, read-only enforcement, financial integer formatting, and blocker states.
    - _Requirements: 1.3, 1.4, 2.1, 3.1, 3.4_

- [x] 8. Add integrated offline rehearsal, acceptance gates, and fail-closed release checks
  - [x] 8.1 Implement a synthetic end-to-end rehearsal fixture covering read-only questions, blocked effects, approved synthetic reversible effects, PFOS unavailable behavior, provenance refusal, queue replay, Drive read-back, migration staging, rollback, and dashboard rerun.
    - Assert positive, negative, and regression checks all execute against one immutable baseline and append evidence without rewriting it.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_
  - [x] 8.2 Implement fail-closed repository acceptance checks for protected invariants.
    - Check no floating-point money boundary, no second financial writer, `drive.file` scope, no secrets/deployment particulars in fixtures or tracked templates, routing/benchmark bundle exclusion, separate stores, closed signal schema, and test-floor ratcheting.
    - Preserve the expected current acceptance floor; do not rewrite stale historical counts or lower a threshold to pass.
    - _Requirements: 1.2, 1.4, 2.2, 3.4; Design Sections 14.3, 20.3, 22, 24.4_
  - [x] 8.3 Write the repository-compatible Python property-test suite for all five design properties.
    - Use the property library already present in the repository; add a pinned dependency only after explicit approval. Keep generated fixtures synthetic and bounded.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_
  - [x] 8.4 Run focused offline checks for changed behavior, then record observed results from typecheck/lint/tests/build and the repository acceptance command.
    - Use only single-run test invocations; do not start watchers or servers. A historical 20/20 receipt cannot substitute for a current result.
    - _Requirements: 1.3, 3.4; Design Section 24.4_

- [x] 9. Checkpoint — preserve evidence and stop before live work
  - Ensure all offline implementation and test tasks are complete only when the current baseline, synthetic evidence, negative controls, regression controls, rollback references, and dashboard reruns are present; ask the owner if questions arise.

## Notes

- Tasks marked with `*` are optional test/property-test subtasks and must not be implemented when skipped; core implementation tasks are mandatory.
- Every implementation prompt must build on preceding tasks, integrate its output into the existing composition, and end with wiring rather than orphaned modules.
- Required task-generation instruction: **Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.**
- Python was selected because the design uses pseudocode. The authoritative runtime and existing PFOS money implementation remain protected; resolve any implementation-language conflict with the owner/design authority before creating a duplicate financial engine.
- Property tests must map to the design's five properties and the numbered requirements shown on each task. Use the repository-compatible property framework only; dependency additions require explicit approval and exact pinning.
- Offline rehearsal means injected providers, deterministic mocks, synthetic fixtures, redacted identifiers, and local verification only. It does not mean starting servers, making network calls, reading secrets, using real ledgers, or exercising a provider.
- Human-gated live work is **BLOCKED_HUMAN** and intentionally not an executable leaf task: VPS/DNS/host changes, OAuth consent, webhook registration, credential minting/rotation, production provider calls/spend, Drive/Telegram external mutations, cross-repository changes, and any G1-G8 action require explicit owner authorization and applicable project authority after all offline predecessor gates pass. A task cannot mark a human gate complete or substitute a fixture for approval.
- No task may modify `ops/DEPLOYMENT_CONTROL.md`, restore deleted historical files, alter protected user changes, lower acceptance floors, or claim current readiness from historical receipts.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "3.1", "4.1"] },
    { "id": 1, "tasks": ["1.3", "2.1", "3.2", "4.2"] },
    { "id": 2, "tasks": ["1.4", "2.2", "3.3", "4.3", "5.1", "5.2", "6.1", "7.1"] },
    { "id": 3, "tasks": ["2.3", "3.4", "4.4", "5.3", "6.2", "7.2"] },
    { "id": 4, "tasks": ["2.4", "3.5", "5.4", "5.5", "6.3", "6.4", "7.3", "7.4", "7.5"] },
    { "id": 5, "tasks": ["6.5", "8.1", "8.2"] },
    { "id": 6, "tasks": ["8.3"] },
    { "id": 7, "tasks": ["8.4"] }
  ]
}
```
