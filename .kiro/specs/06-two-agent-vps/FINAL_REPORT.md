# Final report - Two-Agent VPS tier (spec `06-two-agent-vps`)

> Spec: `.kiro/specs/06-two-agent-vps`. Steering: `.kiro/steering/two-agent-vps.md`.
> Contracts: `contracts/pfos/06_PFOS_Database_and_Knowledge_Model.md`,
> `contracts/pfos/12_PFOS_Two_Agent_VPS_Deployment_and_Operations.md`.
> Written at commit `5d3d18c` + this increment. Suite **1757 tests across 101 files**.
> Harness **`HARNESS PASSED`, 20 of 20 executed checks passed**.
>
> **This document claims no gate was performed.** Read §3 and §4 before acting on anything here.

---

## 1. What is built

### Phase 0 - authorize and author

Two missing contracts were authored before any code was written in their area, as steering §5 requires:
**contract 06** (SQLite schema, migrations, retention, the token-spend ledger) and **contract 12**
(topology, isolation, consent bus, backup and restore, health, rollback, disaster recovery). Both are
marked NIZAM-derived. `contracts/pfos/_PFOS_CONTRACT_INDEX.md` and `contracts/pfos/_PFOS_BUILD_LOG.md`
were updated in the same increment so **AC12** (index and log agree) still passes.
`ops/GATE_REGISTER.md` was seeded with G1-G8 from steering §2.

**What it proves:** no policy was invented that a contract should govern, and the gate set was
enumerated before anything could accidentally depend on one being satisfied.

### Phase 1 - the finance data layer (contract 06, R1-R5)

`src/server/db/` - `schema.ts`, `migrations.ts`, `connection.ts`, `store.ts`, `sqliteBinding.ts`,
`paths.ts`, `moneyBoundary.ts`, `errors.ts`; repositories for accounts, transactions, obligations,
decisions and FX rates under `src/server/db/repositories/`; the agent-keyed token-spend ledger in
`spendLedgerRepo.ts`, whose periodic total is a pure function feeding `src/features/routing/modelPolicy.ts`.

**What it proves:** money persists as an **integer milliunit** or is refused at the boundary
(`moneyBoundary.ts`, `negativeGuards.test.ts`); the server arithmetic is bit-identical to the browser
core (`moneyParity.test.ts`, `moneyImplementation.test.ts`) so there is no second money implementation;
re-running the migration series is a no-op (`migrations.test.ts`); and one process cannot open another
agent's store (`isolation.test.ts`) - steering §4.1.

### Phase 2 - ports and deterministic mocks

`src/server/ports/` - `telegram.ts`, `openrouter.ts`, `drive.ts`, `whoop.ts`, `signalBus.ts`, plus
`shapeGuards.ts` and `errors.ts`. `src/server/mocks/` - one deterministic mock per port, an
`invocationRecorder.ts`, a `fixtureLoader`, and a `failure.ts` for the refusal paths.

**What it proves:** every capability that would touch a network or a secret is behind an injected port
with a mock, so the whole tier is testable without either. `interfaceOnly.test.ts` asserts the port
modules carry no implementation, `determinism.test.ts` asserts identical input yields identical output,
and `scripts/verify/ingest-isolation.mjs` (**AC08b**) asserts `src/server/**` never reaches the browser
bundle.

### Phase 3 - the signal bus and the consent boundary (R7-R10)

`src/server/signals/` - `envelopeSchema.ts`, `envelopeValidation.ts`, `consentGate.ts`,
`signalStore.ts`, `signalStoreSchema.ts`, `exclusion.test.ts`, `schemaParity.test.ts`.

**What it proves:** consent by **absence**. A balance, a due date, an account identifier or journal text
cannot cross the bus because the envelope has no field that could carry one, and free text is capped;
`producer_only` is refused; the store is append-only with an audit mirror; and the family
classification is excluded from the deployment entirely - `exclusion.test.ts` enforces that across
`src/server/**` and `ops/**`, and it is the check that caught the first draft of cross-repo change 003.

### Phase 4 - the Telegram transport, mocked end to end (R11-R15)

`src/server/telegram/` - `auth.ts` (constant-time token comparison plus allowlist),
`updateDedupRepo.ts` (`(bot_id, update_id)` UNIQUE with `INSERT OR IGNORE`), `workQueueRepo.ts`,
`acceptHandler.ts`, `workerRunner.ts`.

**What it proves:** a missing token, a wrong token and a non-allowlisted user are each refused, and the
refusal leaks no timing (`auth.constantTime.test.ts`); a duplicate update is a **success**, not an
error; and **two bots emitting the same update identifier are both processed**, which is the collision
the single-key scheme silently dropped. The dedup claim and the durable enqueue are one transaction.

### Phase 5 - routing, spend and telemetry (R16-R19)

`src/server/routing/` - `turnClassifier.ts` (T0-T4, rules first), `modelRouter.ts`,
`eligibilityRegistry.ts`, `turnDispatch.ts`, and the negative suites `capIsolation.negative.test.ts`,
`deterministicAlerts.negative.test.ts`, `modelRouter.negative.test.ts`,
`provisionalCannotPromote.test.ts`, `t0NoModel.test.ts`, `t0UnderClosedDoors.test.ts`.
`src/server/db/modelTelemetryRepo.ts` records reported cost, tokens, latency and schema validity.

**What it proves:** T0 provably invokes no model - the T0 branch does not hold the capability, so it is
a type-level guarantee rather than a runtime check; a `provisional` registry **cannot promote** a model
for live routing; an exhausted cap refuses one agent and not the other; deterministic alerts still
fire with the model tier off; and **no prompt text** enters telemetry, enforced at four independently
failing layers.

### Phase 6 - benchmark Phase-1, on the dev-key carve-out (steering §3)

`src/server/benchmark/` - `fixtureReplay.ts`, `provisionalRegistry.ts`, `liveRegistry.ts`; the live path
`preflight.ts` and `liveModelCaller.ts` under `src/features/benchmark/`.

**What it proves:** the eval set meets its bar - **219 cases against the `>=210` floor**, every
per-category minimum met, `auditEvalSet` reporting **0 problems** over every sanitization, structural
and money gate. The registry emission round-trips. **Task 6.3 closed on the ELSE branch: no live call
was made**, the registry stays `provisional: true`, and the determination is recorded in
`ops/GATE_REGISTER.md`.

### Phase 7 - ops artifacts, text only (R20-R22)

`ops/docker-compose.yml`, `ops/Caddyfile`, five `ops/env/*.env.example` templates, `ops/backup/backup.sh`,
`ops/restore/restore.sh`, `ops/runbook/ROLLBACK.md`, `ops/runbook/DISASTER_RECOVERY.md`,
`ops/runbook/RATE_LIMIT_POSTURE.md`, `ops/BUS_NETWORK_BINDING.md`, plus the health endpoints
(`src/server/ops/healthProbe.ts`) and structured redacted logging with rotation
(`src/server/ops/redactedLogger.ts`).

**What it proves:** each artifact says what contract 12 requires **and still agrees with the artifacts
it quotes** - see the table in §1b. Every `### Step N` in a runbook carries a `**VERIFY:**` line,
because a step whose result an operator cannot check is a step they will believe they completed. Every
documented provider limit carries a `Documented:` line with its quantity and its provenance; **no number
was discovered by exceeding a limit**, because probing one is a live call.

### Phase 8 - the cross-repo handoff (steering §6)

`ops/nizamcore-patches/001-fastapi-wrapper.patch`, `002-dedup-per-bot.patch`,
`003-signalbus-egress-target.patch`, `README.md`.

**What it proves:** the three changes the life agent's repository needs are specified without pretending
to be applicable diffs. Each declares `FORM`, `TARGET REPOSITORY`, `TARGET BRANCH`, `TARGET FILES`,
`AUTHORED FROM` and `NOT VERIFIED`; **no `index` line and no blob hash appears anywhere in the series**,
because a content address can only be computed from bytes nobody here read. The apply order 001 → 002 →
003 carries a reason for each position. See §5 for their status.

### Phase 9 - close out

- **9.0** `AC18 no deployment particular in ops or any fixture` - a **twentieth named check**, not a
  clause folded into AC08b. `scripts/verify/no-deployment-particular.mjs` over
  `src/server/ops/deploymentParticulars.ts`. R24 keeps ONE implementation: `scanForParticulars` from
  `composeTemplate.ts` is **injected**, never re-derived, so a later widening moves every artifact at
  once. Two further bans hold over `src/server/**` per steering §4.1. The repository was **not** clean
  when the check first ran; three real files were fixed and the check was not narrowed.
- **9.1** the AC04 `--min` floor ratcheted **331 → 1757**. Up only.
- **9.2** every increment of this spec committed and pushed - verified below in §6.
- **9.3** `ops/GATE_REGISTER.md` completed in two halves: a reconciliation against the Phase 7 artifacts
  (`7e7cb58`), then the checker that holds it there (`gateRegister.ts`, 20 codes). The checker found two
  defects re-reading had not: G3 placed the allowlist and verified nothing; G4 placed two keys and
  confirmed one. Both now carry a counting line.
- **9.4** this document.

### 1b. Per-artifact checker table

Every `ops/` artifact is validated by a module in `src/server/ops/`, each of which is pure text-in /
findings-out. The negative cases mutate the **real file on disk in memory** and assert the code **by
name**; each artifact also asserts an **empty** finding list as it stands, which is what makes the codes
mean anything. Coverage is described precisely below the table rather than generalized in one phrase.

| Checker (`src/server/ops/`) | Artifact it validates | Finding codes | Tests |
|---|---|---|---|
| `composeTemplate.ts` | `ops/docker-compose.yml`; owns the ONE R24 scan (`scanForParticulars`) | 49 | 64 |
| `caddyTemplate.ts` | `ops/Caddyfile` | 39 | 50 |
| `envTemplates.ts` | `ops/env/backup`, `bus`, `finance`, `life`, `proxy`, `scheduler` `.env.example` | 33 | 44 |
| `backupScripts.ts` | `ops/backup/backup.sh`, `ops/restore/restore.sh` | 43 | 58 |
| `runbookTemplate.ts` | `ops/runbook/ROLLBACK.md`, `DISASTER_RECOVERY.md`, `RATE_LIMIT_POSTURE.md` | 53 | 69 |
| `patchSeries.ts` | `ops/nizamcore-patches/001`, `002`, `003`, `README.md` | 55 | 72 |
| `gateRegister.ts` | `ops/GATE_REGISTER.md` | 20 | 43 |
| `deploymentParticulars.ts` | tree level: `ops/**` (19 files) + `src/server/mocks/fixtures/**` (2), plus two store-isolation bans over 123 files under `src/server/**` | 17 | 34 |
| `healthProbe.ts` | the health endpoints and their invocation shape | 6 invocation refusals + 7 readiness failures, over 4 readiness checks | 24 |
| `redactedLogger.ts` | structured redacted logging and rotation | 12 error codes | 37 |

The eight checkers with a finding-code list each carry a `NEGATIVE_CASES` table with **a row per code**
and a coverage test that fails if a code is added without one. The two whose shape differs are stated as
they are rather than rounded up: `redactedLogger.ts` asserts *every error code is reachable, so none is
decoration*, and `healthProbe.ts` asserts its refusal vocabulary cannot grow without a case.

`src/server/ops/` contributes **495** of the 1757 tests. `ops/BUS_NETWORK_BINDING.md` has no checker of
its own: its six numbered items and three prohibitions are enforced by `composeTemplate.ts` (topology)
and `caddyTemplate.ts` (proxy), and the document itself is covered by the tree-level AC18 scan.

Three checkers prefer **cross-reading a real artifact over asserting a copy**: `runbookTemplate.ts`
compares the drill sequence quoted in ROLLBACK.md against `ops/restore/restore.sh` through that
template's own parser; `gateRegister.ts` parses `ops/env/**` rather than restating its entry names, and
probes every repository path the register quotes against the disk; `deploymentParticulars.ts` asserts a
non-zero count per scan root. Where a checker has no equivalent for a code the shared R24 scan produces,
it reports `PARTICULAR_SCAN_UNMAPPED` rather than dropping it - because silently discarding a finding
from a fail-closed scan turns a widened rule into a narrowed one.

---

## 2. What is proven, and how

**This is proven by static rehearsal.** Nothing was executed.

- **No `ops/` artifact was ever run.** `docker-compose.yml`, `Caddyfile`, `backup.sh` and `restore.sh`
  are read with `readFileSync` and parsed as strings. `backup.sh` and `restore.sh` were never invoked by
  any shell.
- **No container was built or started.** No image was pulled, built or tagged.
- **No store was opened by an ops artifact.** The SQLite work in Phase 1 opens throwaway test stores
  under a temporary directory; no artifact in `ops/` opened anything.
- **No provider was called.** No model call, no messaging platform call, no storage call, no health
  request. The health probe's invocation quoted inside ROLLBACK.md is checked by **parsing the string**;
  the probe is not run.
- **No network request was made** from any process in this spec, and no outbound call from a server
  process exists on any tested path.
- **No secret was read.** No production secret, and no value from `.secrets/`. Task 6.3 closed on the
  ELSE branch precisely so that the dev key was not used either.
- **The other repository was never read.** No clone, no fetch, no `git apply`, no submodule, no vendored
  checkout, no request to any code host.

**The tests are text-in / findings-out.** Each checker takes a string (or reads one file), returns a
list of `{ code, detail }`, and the test asserts which codes fire. That shape is what makes the
guarantees checkable without running anything, and it is also exactly the limit: **what is proven is
that the artifacts say what the contracts require and still agree with each other. What is not proven is
that any procedure in them works.** No rollback has been performed, no restore drill rehearsed, no
degraded long-poll mode entered, and not one documented provider limit observed in the wild. The first
real execution of every ops artifact will be by a human, on a host that does not exist yet.

Every checker **fails closed**. An unreadable document, an unreadable companion, a document outside the
parsed subset, a missing section, a section nobody declared, an out-of-order procedure, a step with no
verification line, a scan root that does not exist, a root that matched nothing, and an empty scan set
are all **findings**, never skips. The counts are printed and re-asserted by the harness script, so a
check that examined nothing cannot report success.

---

## 3. What is gated

**Eight gates were enumerated in Phase 0. Seven remain open, one is closed as WONT-DO, and not one was
attempted, simulated or claimed.** No host, DNS record, bot, key, consent, webhook or keypair is
mine to create.

| Gate | What a human must do | Status |
|---|---|---|
| **G1** | Provision and harden the host | `BLOCKED - awaiting human` |
| **G2** | Records for the two hostnames | `BLOCKED - awaiting human` |
| **G3** | Create the two bots | `BLOCKED - awaiting human` |
| **G4** | Mint the two runtime model keys and their periodic caps | `BLOCKED - awaiting human` |
| **G5** | Storage consent grant for the backup path | `BLOCKED - awaiting human` |
| **G6** | Register both webhooks | `BLOCKED - awaiting human` |
| **G7** | *Repository privatization* | **`CLOSED - WONT-DO`** (owner decision, 2026-08-06, steering §0b). Not a gate. Not to be re-raised. |
| **G8** | Backup keypair, private half kept off the host | `BLOCKED - awaiting human` |

Two determinations are registered **inside** a gate and are also still `BLOCKED - awaiting human`: the
**write-ahead-log sidecar determination** under G8, and task **6.3's provisional-registry
determination**. `src/server/ops/gateRegister.ts` asserts that the place to record each outcome exists,
that every open gate's status is exactly `BLOCKED - awaiting human`, that G7 is recorded as closed, and
that **no prose describes a gate in the past tense as performed** - the register's own discipline calls
that claim the single most damaging thing this document could contain.

Nothing was renumbered, reordered, softened or reopened. The seven open gates are enumerated, never
attempted, and their boxes under *Waiting on user input* in `tasks.md` are deliberately **unticked**.

---

## 4. The single next human action

> ### **G1 - Provision and harden the host.**
> `ops/GATE_REGISTER.md` → section **`## G1 - Provision and harden the host`**.
> Its `### Steps` block is the operator procedure; its `### VERIFICATION` block is how to know each step
> took effect; its `### Unblocks` block says what becomes possible next.

That is the whole action. **One.** Not a list and not a recommended order with G1 at the top - G1 is
the only gate with no prerequisite of its own, and every other open gate is downstream of a host that
exists. `ops/GATE_REGISTER.md` states the dependency ordering and names G1 as the single next action;
`gateRegister.ts` fails with `NEXT_ACTION_NOT_FIRST_GATE` if that ever stops being true.

---

## 5. Honest limits

These are carried forward from `contracts/pfos/_PFOS_BUILD_LOG.md` unchanged, not softened, and none is
new.

1. **The eligibility registry is still `provisional: true`, and no live model call was ever made.**
   Task 6.3 closed on the **ELSE branch**. The live path (`preflight.ts`, `liveModelCaller.ts`,
   `liveRegistry.ts`) is built and tested against a deterministic transport only. A provisional registry
   may never promote a model for live routing, and live routing stays gated on **G4**.
2. **The three cross-repo change specifications are *emitted, unapplied*.** They are explicitly-labelled
   **change specifications, not applicable unified diffs**. Nobody has applied them, nobody has run the
   target repository's suite against them, and no claim is made that any of them applies cleanly,
   compiles or passes. **The other repository was never read, cloned, fetched, modified or pushed**, so
   there are no verified context lines and no blob hashes - and none were invented. Applying the series
   is a human step in another repository; it is not in the G1-G8 register because it is a cross-repo
   handoff rather than a deployment gate.
3. **The write-ahead-log sidecar determination is ranked but unmade.** The ranking states which outcome
   to reach for first; it does not make the operator's choice, and no code path behaves differently
   because of it. Until an operator makes and records it, **every rollback across a migration is blocked
   on a human** rather than available.
4. **The 55-passing / 14-subtest baseline quoted for the other repository was read from a document,
   never observed.** Its source is `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md`, and all three change
   specifications plus their README say so. The three predicted post-change totals (62, 69, 74) are
   predictions from a session that could not run that suite, and they are labelled as predictions.
5. **Real brand names remain outside the eval set that was cleaned.** The cleanup was scoped to the eval
   set, deliberately. `src/features/accounts/`, `src/lib/db/`, `tests/helpers/fixtures.ts` and a number
   of feature tests still carry two real bank names, principally as the **domain account-type
   identifiers** `CIB_DEBIT` and `HSBC_CC`, which are part of the Profile-A data model rather than
   fixture decoration. `contracts/pfos/01`-`04` and `docs/research/` name real institutions throughout;
   those are **ingested byte-faithful** documents whose bytes are checksummed in
   `_INGESTION_MANIFEST.json`. Renaming a domain type is a schema change and rewriting an ingested
   contract would break its hash; neither was approved and neither was attempted. AC11's denylist does
   not carry these terms, so it does not fail on them - that is the honest state, not a claim that it is
   the desired one.
6. **The gate-register checker is not a twenty-first named harness check.** `gateRegister.ts` runs inside
   the vitest suite, which **AC04** executes, so a regression does fail the gate - but through AC04's
   name rather than its own. Every other `ops/` checker sits the same way except AC18, which needed a
   named check because nothing else covered the tree. Making this one named is a separate decision with
   a document cost, and it was not taken.

Two further limits already recorded and still true: the two paths named `fixtures.ts` are out of AC18's
scope **by judgement** (they load and build fixtures rather than being fixtures), and the R24 dotted-token
word list exists in **two copies** - `patchSeries.ts` and `deploymentParticulars.ts` - because the plain
Node harness cannot import the former at run time. A test asserts the two lists agree on every token they
share; the honest description is one scanner and two copies of one word list.

---

## 6. The count change: 19 checks → 20

The harness moved from **19** named checks to **20** when **`AC18 no deployment particular in ops or any
fixture`** was added in task 9.0 (commit `5f70139`), wired between AC11 and AC02 in
`scripts/verify/all.mjs`. It is a twentieth *named* check rather than a clause folded into AC08b,
because folding a genuinely new guarantee into an existing name hides a new promise behind an old one.

**Every document asserting the current gate figure moved to 20/20 in that same increment**, so the
figure and the documents never disagreed:

- `.kiro/steering/pfos-current.md` (twice)
- `.kiro/steering/loop-protocol.md`
- `.kiro/steering/structure.md` (the "19-check harness" phrasing)
- `docs/KIRO_HANDOFF.md` (three times, including the line whose "if it is not 19/19, stop and report"
  would otherwise have made that increment a stop condition for the next session)
- `docs/KIRO_ONBOARDING.md` (four times)
- `.kiro/specs/06-two-agent-vps/LOOP.prompt.md` (twice, including the T2 stop predicate)

**Dated records were left as dated records and made unambiguous rather than falsified.**
`docs/KIRO_HANDOFF.md` §4 and `docs/KIRO_ONBOARDING.md` §5 carried snapshot figures that were already
stale, so each now names its date and points at the live figure. `RELEASE_CHECKLIST.md`'s 19-of-19 line
sits inside a section headed `## Released - 2026-08-05`, so it is marked *at that release* with the live
figure stated below it. `docs/KIRO_KICKOFF_TWO_AGENT.prompt.md` now states both the figure when it was
written and the figure from 9.0 onward. Left untouched as history: every `Harness 19/19` line already in
the build logs, `docs/PFOS_CONTRACT_INGESTION_REPORT.md` (headed with its run date),
`docs/PFOS_IMPLEMENTATION_ROADMAP.md`, and every `note` field in `.loop/verification-ledger.json`, which
is never hand-edited.

### The AC04 floor, ratcheted up and never down

Read from the history of `scripts/verify/all.mjs`, every change to the `--min` value is an increase:

`110` → `185` → `200` → `220` → `235` → `245` → `253` → `258` → `261` → `266` → `269` → `317` → `331` →
**`1757`**

Fourteen values, thirteen transitions, **all upward**. The floor is the count proven by the test run in
the increment that raised it; 1757 is a floor, not a target, so a future increment that legitimately
removes a test has to argue the case rather than lower the number quietly.

### 9.2 - the push verification

Every increment of this spec is an ancestor of `origin/master`, verified with
`git merge-base --is-ancestor <commit> origin/master` after `git fetch origin master`:

| Commit | Subject | Pushed |
|---|---|---|
| `0392d1d` | `feat(benchmark): Add the live model path and close 6.3 on the ELSE branch` | yes |
| `b5ff8c4` | `feat(ops): add two-agent VPS deployment templates` | yes |
| `b0af379` | `docs(ops): emit cross-repo change series for life agent` | yes |
| `2b31bd0` | `chore(policy): resolve five policy hygiene items` | yes |
| `5f70139` | `feat(ops): add AC18 no-particular gate check` | yes |
| `7e7cb58` | `docs(ops): resolve gate register to authored ops` | yes |
| `5d3d18c` | `feat(ops): check the gate register for completeness` | yes |

`git status --porcelain` was empty at each verification point.
