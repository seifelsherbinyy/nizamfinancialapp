# Design Document

## Overview

This design covers one time-boxed bringup run. It is **configuration plus evidence-driven smoke
testing, with exactly one genuine build**: the registry runner entrypoint
`scripts/benchmark/earn-registry.mjs`. Everything else already exists in the tree and works; this
document says how to *drive* it and how to *read the evidence back*, not how to rebuild it.

The design therefore has an unusual shape for a design document. It is dominated by two things:

1. **One new module**, specified concretely — its sequence, its injected capabilities, its refusal
   surface, its artifact naming, and its npm script.
2. **Four evidence sources**, one per ladder rung, each with a named system of record and a named
   halt condition. The deliverable of a rung is a *quoted reading*, not a passing process.

Everything in this document that names a credential, a host, an address, a bot, a numeric user
identifier or a store path names it as its `<ENTRY_NAME>` placeholder. `.kiro/**` is tracked and has
**never** been scanned by AC18 — its scan roots are `['ops', 'src/server/mocks/fixtures']`
(`src/server/ops/deploymentParticulars.ts`, `SCAN_ROOTS`) — so this document and `tasks.md` are
themselves inputs to the STEP 1 sweep and must survive it. That is a design constraint on the
documents, not only on the code.

### What is being built versus what is being driven

| Thing | State before this run | This run |
|---|---|---|
| `scripts/benchmark/earn-registry.mjs` + its npm script | **does not exist** | **built** |
| `emitLiveRegistry`, `assertWitnessedRuns` | built, tested, unreachable from a server process | **called, for the first time** |
| `runLiveModelCalls`, `isLiveMeasurementWitness`, `grantDeveloperMachineRun` | built, tested offline | **driven with a real credential** |
| the messaging transport (`liveTransport.ts`, `liveProviderRequest.ts`, `providerRequest.ts`) | built; **no test invokes the dialler** | **driven against a fake responder (RUNG 1), then live (RUNG 4)** |
| `auditEnvTemplates` / `auditEnvTemplateFiles` | built, run on every test run | **reused as the RUNG 2 evidence source** |
| the four rung smoke tests | do not exist | **built — and they are the only four new tests** |
| the identity sweep | AC18 exists, scoped to two roots | **a separate one-off procedure, roots unchanged** |

Nothing in `src/` is redesigned. The one exception worth stating: **no existing file is modified to
make the runner reachable.** The runner is a `scripts/` entrypoint precisely so that no `src/server/`
module gains an import of the benchmark tier.

---

## Design Decisions

Four clarifying questions were answered before this design. Each is recorded with its rationale
because each one closes off an alternative that would otherwise look reasonable.

### A1 — Full re-sweep of all 47 commits, inheriting no prior result

**Decision.** The STEP 1 identity sweep scans every tracked file across the full 47-commit range
ahead of the remote, from scratch. A prior sweep's clean result is not inherited.

**Rationale.** A prior sweep found the life bot's **name** committed in a spec file under `.kiro/**`.
AC18 has never covered `.kiro/**`, so the harness passing 20/20 is not evidence about that path. The
push is the one irreversible step in the run; a sweep that trusts an earlier sweep's scope is
trusting a scope that was measured to be too narrow. Cost is minutes; the alternative is publishing
a deployment particular on a public repository, which cannot be withdrawn.

**Alternative rejected.** Sweeping only the paths changed in the 47 commits. Rejected because the
disclosure that was actually found sat in a file that a diff-scoped sweep would only catch if that
file happened to be in the diff — and the point of the sweep is not to trust that.

### A2 — The host is a real provisioned machine reachable over SSH with the key already in `.secrets/`

**Decision.** RUNG 2 and RUNG 4 target a real host. Reachability is established by a **read-only**
probe over the existing key material before anything is written.

**Rationale.** Steering §2a makes a read free and a mutation owner-gated. A reachability probe
changes no state the host holds, so it is a read. Establishing reachability *before* writing an
`Env_File` means a failure is attributed to the probe rather than surfacing later as an ambiguous
"the service did not come up". R19.5 makes this explicit: a failed probe reports **RUNG 2 BLOCKED,
blocked step = the probe**, not "the host is down".

**Alternative rejected.** Assuming the host from the gate register. Rejected because the gate
register and reality disagree — see the finding below.

### A3 — One-shot runner: no resumability, no checkpoint file

**Decision.** `earn-registry.mjs` dials, mints, grades and emits in **one process invocation**. There
is no checkpoint file, no resume flag, and no partial-run cache.

**Rationale — and this is the load-bearing one.** The witness is an **in-process object identity**. A
`LiveMeasurementWitness` is a branded interface whose brand is a `unique symbol`; the actual gate is
membership in a module-private `WeakSet` (`liveWitnesses`) inside
`src/features/benchmark/liveModelCaller.ts`, added only by `runLiveModelCalls` and read only by
`isLiveMeasurementWitness`. A `WeakSet` does not survive serialization and cannot be rebuilt from a
file. So a serialized witness is **correctly refused** — and that means the chain
dial → mint → grade → emit cannot be split across processes without either defeating the gate or
introducing a new trust mechanism to carry the witness across the boundary.

A checkpoint file would be exactly that new trust mechanism: a replay path into the witness chain. It
would turn "this registry is backed by a live run that happened in this process" into "this registry
is backed by a file that says a live run happened". That is the shortcut R11 forbids.

**The accepted cost, stated plainly.** A crash or a refusal mid-run **forfeits the spend already
incurred** and the next attempt starts from zero. On two models over the eval set that is a small
number of micro-USD, and it is the correct price. R10.12 records the acceptance; this design
introduces no mechanism to avoid it.

### A4 — Dev key from the local machine, over both default-allowed models

**Decision.** The run is funded by `.secrets/openrouter.dev.key`, executed from the **local**
developer machine, over **both** default-allowed models `xiaomi/mimo-v2.5` and `z-ai/glm-5.2`. Not
`<OR_KEY_FINANCE>`.

**Rationale.** Steering §3 grants exactly one network exception: the Phase-1 benchmark may make live
calls **from the developer machine only**, using the **dev** key, on the **sanitized** eval set, and
only for producing the eligibility registry. `<OR_KEY_FINANCE>` is the production runtime key behind
gate G4; spending it on a benchmark would both breach that wall and charge the agent's own weekly cap
for work that is not a turn.

Both models, not one, because `TIER_REQUIRED_ELIGIBILITY` and the K4 policy select the **cheapest
capable** model. A registry with one entry cannot express a cheapest-capable choice — it expresses
"the only one we measured". Two entries make the choice genuine. No model outside the default-allowed
set is enabled; `assertScopedToDefaultAllowed` refuses one at the moment of the call anyway.

**The constraint this decision creates, and it is the important one.**
`grantDeveloperMachineRun({ invocation, serverRuntimeMarker })` **refuses outright** with
`LIVE_GRANT_REFUSED_SERVER_RUNTIME` when `serverRuntimeMarker !== null`. A caller that can see a
server-runtime marker *is* a server process. Therefore **the runner cannot execute on the host at
all** — not "should not", cannot. The emitted artifact must be produced locally and **transferred**.
That transfer is designed in §"Artifact transfer" below.

---

## Measured corrections that override the originating contract

The originating contract states numbers that were measured and found stale. The contract's own
standing rule is that a state is confirmed against its system of record before it is reported, so
these corrections follow the contract rather than contradict it. Each is an **Observation** with its
date, not a decision.

| Claim in the originating contract | Measured | System of record |
|---|---|---|
| HEAD `0d25679`, 43 commits ahead | HEAD `24c432a`, **47 ahead** | the local git reference |
| Test floor 2223 | **2301** | `AC04 --min` in `scripts/verify/all.mjs` |
| Three mid-edit files, one untracked (`turnIntake.ts`) | `git status --porcelain` **empty**; `turnIntake.ts` **tracked** | the working tree and the index |
| Harness verified | **unverified this session** — no 20/20 line has been observed in this session | the harness's own summary lines |

Consequences carried into the design:

- STEP 0 reduces to **stopping background writers plus the written confirmation line**. There is no
  mid-edit reconciliation step, because there are no mid-edit files.
- The Final_Report records `SUITE` against a floor of **2301** and never 2223 (R17.3, R24.3).
- STEP 2 is a real gate, not a formality: the 20/20 line has not been observed this session, so it
  must be observed before STEP 3 rather than assumed from a previous run.
- The floor is **not raised** this run even though four tests are added. R17.1 requires
  "2301 or higher" and R24.3 pins the report to 2301; not raising is not lowering, and changing the
  floor in the same run that reports against it would make the report self-referential. The observed
  count above the floor is recorded instead, and the ratchet is a follow-up.

### The gate-register-versus-reality finding

**G1 is done in fact.** The host is provisioned and reachable (A2). Meanwhile:

- `.kiro/steering/pfos-current.md` records **"D2 = OVHcloud, NOT provisioned"** and states that all
  server / hosting / bot / ingestion work is blocked.
- Spec `07-bot-bringup-v1` wave 3 lists **G1 as open**.

Three registers, two of them wrong, and nothing in the harness compares a register to reality. This
is reported as a **finding in its own right** (R19.4), not as a footnote to RUNG 2. It matters beyond
this run: a gate register that lags reality causes work to be refused as blocked when it is not, and
it is the same class of error as reporting a state that was never opened. The finding is recorded in
the run report; the registers are not edited by this run, because editing a register on the strength
of one session's read is the mistake in the other direction.

---

## Architecture

### The witness chain, and where the runner sits in it

```
                          .secrets/openrouter.dev.key        <FINANCE_ENV_PATH> on the host
                                    │                                  │
                                    │ (local machine only)             │ (never the runner)
                                    ▼                                  ✗
  scripts/benchmark/earn-registry.mjs   ◄── the ONE new module; a scripts/ entrypoint
        │
        │ 1. grantDeveloperMachineRun({ invocation, serverRuntimeMarker })   ── refuses on the host
        │ 2. buildEvalSet()
        │ 3. validateEvalSet(cases)        ── BEFORE dialling (caller's obligation)
        │ 4. auditEvalSet(cases)           ── BEFORE dialling (caller's obligation)
        │ 5. pre-flight estimate vs the dev ceiling   ── reported before any spend
        │ 6. resolveLiveRun(grant, environment, config)
        │ 7. runLiveModelCalls(...) per model  ──► LiveModelRun { modelId, exchanges, witness }
        │                                              witness minted into `liveWitnesses` WeakSet
        │ 8. emitLiveRegistry({ runs, buildCaller, verifyWitness })
        │        └── validateEvalSet + auditEvalSet again (fail-closed)
        │        └── assertWitnessedRuns(runs, verifyWitness, cases.length)
        │        └── provisional: false   ◄── exists ONLY here
        │ 9. write emitted.artifacts through a sink
        │10. report four numbers + the emitted path
        ▼
  artifacts/benchmark/model_eligibility_registry.json   ──transfer──►  host
                                                                        │
                                              <MODEL_ELIGIBILITY_REGISTRY_PATH> points here
```

**Why the runner is a `scripts/` entrypoint and not a `src/server/` module.** Every edge from
`src/server/benchmark/liveRegistry.ts` to the live adapter is `import type`, erased at compile time,
and `liveModelCaller.isolation.test.ts` asserts mechanically that **no file under `src/server/**`
imports `src/features/benchmark/liveModelCaller.ts`** — with a negative test that breaks the
assertion and watches it fire. The runner is the module that legitimately imports **both** tiers,
because it is the caller the injection was designed for. Putting it under `src/server/` would break
that isolation assertion; putting it under `scripts/` satisfies it by construction, since the
assertion is scoped to `src/server/**`.

This also means the runner is **not** covered by AC10's contract-and-phase header rule, which applies
to new files under `src/` or `tests/`. It carries the header anyway, for the same reason every other
file does, but the four rung smoke tests under `tests/` carry it as a **requirement**.

### Node runtime note

`package.json` has `"type": "module"` and `engines.node >=24 <25`, and the existing
`"start": "node src/server/process/start.ts"` script proves that native TypeScript type stripping is
in effect. A `.mjs` runner can therefore `import` the `.ts` modules directly, using the explicit
`.ts` specifier extension the tree already uses (`'./providerRequest.ts'`). No build step, no
bundler, no loader flag.

---

## Components and Interfaces

### 1. `scripts/benchmark/earn-registry.mjs` — the one build

The module exports its phases as named functions so the RUNG 3 smoke test can drive them without
executing a run, and guards `main()` behind a direct-invocation check so importing it dials nothing.

```js
// scripts/benchmark/earn-registry.mjs
// NIZAM · Registry runner — the entrypoint that earns a non-provisional eligibility registry
// Owning contract: PFOS 09 (benchmark calibration) + PFOS 12 / phase 6.3
// Owning spec: .kiro/specs/ship-run-live-bringup — R10, R11, R14
// Steering: two-agent-vps.md §3 (the dev-key carve-out: developer machine only, dev key only,
//   sanitized eval set only, and only for producing the eligibility registry)
// NO DEPLOYMENT PARTICULAR. The provider base and the credential arrive as ENTRY NAMES.

export const DEFAULT_ALLOWED_MODEL_IDS = ['xiaomi/mimo-v2.5', 'z-ai/glm-5.2'];

/** Dev-tier weekly ceiling, integer micro-USD. ~USD 1/week per docs/PFOS_SECRETS_PLAN.md §4. */
export const DEV_WEEKLY_CEILING_MICRO_USD = 1_000_000;

/** An explicit environment: a Map, never `process.env`. An absent name resolves to null. */
export function explicitEnvironment(entries) { /* { resolve(name) => string | null } */ }

/** The ONE `revealSecret` call site on the model side. Returns a `LiveTransport`. */
export function httpsTransport({ requestTimeoutMs }) { /* … */ }

/** Integer micro-USD. Reads the tracked frozen pricing snapshot; no float, no toFixed. */
export function preflightEstimateMicroUsd({ cases, modelIds, maxOutputTokens }) { /* … */ }

/** Phases 1-8. Returns { emitted, runs, estimateMicroUsd }. Dials. */
export async function earnRegistry({ grant, transport, environment, config, modelIds, evalSet }) { /* … */ }

/** Phase 9. Writes every entry of `emitted.artifacts` through the injected sink. */
export function writeEmitted(sink, emitted) { /* … */ }
```

#### Sequence, and the two gates that must run before dialling

The order is not cosmetic. `emitLiveRegistry` re-runs `validateEvalSet` and `auditEvalSet` — its own
header says so, and says why: "it runs after the calls, which is too late to prevent the send." An
unsanitized case sent to a third party is **the one failure a live run can commit that a fixture run
cannot**, and it cannot be undone by a later refusal. So the runner runs both gates itself, before
step 6, and the re-run inside `emitLiveRegistry` is the belt.

| # | Step | Refuses with | Spend at risk |
|---|---|---|---|
| 1 | `grantDeveloperMachineRun({ invocation: DEVELOPER_MACHINE_INVOCATION, serverRuntimeMarker })` | `LIVE_GRANT_REFUSED_SERVER_RUNTIME`, `LIVE_GRANT_INVOCATION_UNRECOGNISED` | none |
| 2 | `buildEvalSet()` | — | none |
| 3 | `validateEvalSet(cases)` | runner exits; reports the problem count | none |
| 4 | `auditEvalSet(cases)` | runner exits; reports the failing **gate names** | none |
| 5 | pre-flight estimate vs `DEV_WEEKLY_CEILING_MICRO_USD` | runner reports **RUNG 3 BLOCKED at the estimated number** | none |
| 6 | `resolveLiveRun(grant, environment, config)` | `LIVE_API_BASE_URL_UNRESOLVED`, `LIVE_API_KEY_UNRESOLVED` | none |
| 7 | `runLiveModelCalls(...)` per model | any `LIVE_*` provider code; first failure aborts, no retry | **spend already incurred is forfeit** |
| 8 | `emitLiveRegistry({ runs, buildCaller, verifyWitness })` | any `LIVE_REGISTRY_*` code | **forfeit** |
| 9 | `writeEmitted(sink, emitted)` | filesystem error | artifact lost, spend forfeit |
| 10 | report four numbers + path | — | — |

`serverRuntimeMarker` is read by the **runner** from the process environment and passed in, because
`liveModelCaller.ts` reads no environment by design — its behaviour is a function of its arguments so
a test can drive both branches without mutating a process. The runner is the boundary that touches
the world.

#### Injection: both capabilities required, neither defaulted

```js
import { isLiveMeasurementWitness, liveModelCaller } from '../../src/features/benchmark/liveModelCaller.ts';
import { emitLiveRegistry } from '../../src/server/benchmark/liveRegistry.ts';

const emitted = emitLiveRegistry({
  runs,                                   // one LiveModelRun per model, each carrying its witness
  buildCaller: liveModelCaller,           // (modelId, exchanges) => ModelCaller — signature matches exactly
  verifyWitness: isLiveMeasurementWitness, // injected UNCHANGED. Not wrapped, not re-implemented.
  evalSet: cases,
});
```

`buildCaller` needs no adapter: `liveModelCaller(modelId, exchanges): ModelCaller` is already the
exact shape `emitLiveRegistry` asks for. `verifyWitness` is passed **by reference, unchanged**. There
is no wrapper, no `?? (() => true)`, and no local re-implementation. Writing either would be R11.3's
forbidden shortcut, and the RUNG 3 smoke test proves the injected function refuses as well as
accepts.

#### Funding and the transfer that decision A4 forces

```
LOCAL MACHINE                                              HOST
─────────────                                              ────
.secrets/openrouter.dev.key   (gitignored: `.secrets/`)
        │
        ├─ read into an OpaqueSecret via opaqueSecret(); toString/toJSON are '[redacted]'
        │
   earn-registry.mjs  ──► artifacts/benchmark/model_eligibility_registry.json
                          artifacts/benchmark/<prefix>/…            (gitignored: `artifacts/`)
                                    │
                                    │  transfer: scp over the existing key material in .secrets/
                                    │  — a WRITE to the host, so it is owner-in-the-loop under
                                    │    steering §2a, and it is the only host write in this step
                                    ▼
                                  <MODEL_ELIGIBILITY_REGISTRY_PATH>
                                    │
                                    └─ read by the router; `provisional: false` permits live routing
```

The runner **cannot** run on the host (A4). So the emitted document is produced locally and copied.
Three properties of the transfer matter:

- **The document carries no credential.** `LiveEligibilityRegistry` is
  `{ registryVersion, provisional, entries[] }` and an entry is
  `{ modelId, bands, developerBuild, disqualified }`. No key, no endpoint, no cost figure, no case
  text. It is safe to move and safe to read.
- **The transfer does not weaken the witness chain.** The witness never leaves the local process; what
  crosses is the *emitted document*, which only exists because the chain already passed. Copying a
  document produced downstream of the gate is not a replay path into it. Copying a *witness* would be,
  which is why the artifact is the unit of transfer and not the run state.
- **`artifacts/` is gitignored**, so the emitted registry is never committed. That is deliberate and
  pre-existing: a registry is a run output, and a provisional one sitting in a public repository would
  look like graded evidence.

#### The failure surface: nine codes, discriminated on `code`

`LiveRegistryError` carries `code` and a frozen `detail` holding **counts, gate names, model ids and
micro-USD figures only**. The runner discriminates on `code` and **never** on a message — a message
is prose that can be reworded; a code is the contract.

| Code | What the runner reports | Ladder consequence |
|---|---|---|
| `LIVE_REGISTRY_NO_RUNS` | no run was supplied; `detail.at` | internal error in the runner itself; RUNG 3 BLOCKED |
| `LIVE_REGISTRY_DUPLICATE_MODEL` | `detail.modelId` appeared twice | runner's model list is wrong; RUNG 3 BLOCKED |
| `LIVE_REGISTRY_MODEL_NOT_DEFAULT_ALLOWED` | `detail.modelId` outside the K4 set | a model was enabled that must not be; RUNG 3 BLOCKED |
| `LIVE_REGISTRY_WITNESS_NOT_ACCEPTED` | `detail.modelId`; the witness is not in `liveWitnesses` | **the gate firing correctly.** Live: the run did not mint it in this process. Test: the tamper case passing |
| `LIVE_REGISTRY_WITNESS_MODEL_MISMATCH` | `detail.modelId`, `detail.witnessModelId` | the witness attests a different model; RUNG 3 BLOCKED |
| `LIVE_REGISTRY_RUN_INCOMPLETE` | `detail.answered`, `detail.exchanges`, `detail.expected` | a partial run is not a measurement; RUNG 3 BLOCKED, spend forfeit |
| `LIVE_REGISTRY_EVAL_SET_INCOMPLETE` | `detail.problems` (a count) | caught at step 3, before any spend |
| `LIVE_REGISTRY_EVAL_SET_UNSANITIZED` | `detail.gates` (gate names) | caught at step 4, **before any send** — the one that must never be caught late |
| `LIVE_REGISTRY_ARTIFACT_MISSING` | `detail.at` (artifact name), `detail.modelId` | contract 09's output list incomplete; registry not written |

The upstream `LIVE_*` codes from `liveModelCaller.ts` are surfaced the same way, by `code`, and the
runner adds nothing to their `detail`. `LiveRunError.detail` has **no field** for a prompt, a
completion, or a credential, and the runner does not create one.

#### Artifact naming

`LIVE_REGISTRY_FILE_NAME === PROVISIONAL_REGISTRY_FILE_NAME` — both are
`'model_eligibility_registry.json'`. This is deliberate and the runner must not "fix" it. One name
means a stale provisional document and a measured one **cannot sit side by side**; the router reads
whichever document is at `<MODEL_ELIGIBILITY_REGISTRY_PATH>` and refuses it if it is provisional. Two
names is exactly how the stale one ends up being the one that was read.

Per-model artifacts land under `artifactPrefixForModel(modelId)` — the model id with `/` replaced by
`__`, so no nested directory is created from provider-supplied text — one subdirectory per model,
each holding `PER_MODEL_ARTIFACT_NAMES`. The runner writes `emitted.artifacts` verbatim: the map is
already keyed by final relative path, including the top-level registry.

#### The npm script

```json
"benchmark:earn-registry": "node scripts/benchmark/earn-registry.mjs"
```

**Name and reason.** `package.json` currently has no benchmark-related script at all
(`dev, start, health, build, preview, test, test:watch, lint, typecheck, test:loop, verify:ledger,
verify:all`), so there is no existing convention to match and no name to collide with. The
`namespace:verb` shape matches the existing `verify:ledger` / `verify:all` and `test:loop` pairs. The
verb is **`earn`** rather than `run` or `generate` because the whole point of the module is that the
registry is *earned* downstream of a witness — a name like `benchmark:registry` would read as though
the script produces a document, which is the framing R11.2 forbids. The script takes no arguments in
its default form; the model list, the entry names and the pricing inputs are module constants and CLI
flags, so the default invocation is the audited one.

### 2. The `verifyWitness` tamper proof

`verifyWitness` is `isLiveMeasurementWitness`, injected unchanged. R11.4 requires this design to
**state in writing what it checks**, and R11.5 requires proof that it refuses as well as accepts.

#### What it checks

```ts
declare const LIVE_MEASUREMENT_WITNESS_BRAND: unique symbol;
export interface LiveMeasurementWitness {
  readonly [LIVE_MEASUREMENT_WITNESS_BRAND]: 'minted from a complete live provider run on the sanitized eval set';
  readonly modelId: string;
  readonly casesAnswered: number;
  readonly actualCostMicroUsd: number;
}
const liveWitnesses = new WeakSet<LiveMeasurementWitness>();
export function isLiveMeasurementWitness(candidate: LiveMeasurementWitness): boolean {
  return liveWitnesses.has(candidate);
}
```

`isLiveMeasurementWitness` checks **membership in a module-private `WeakSet`** that only
`runLiveModelCalls` writes to. It is:

- **not cryptographic** — there is no signature, no MAC, no key;
- **not structural** — it does not inspect `modelId`, `casesAnswered` or `actualCostMicroUsd`, so an
  object with perfectly plausible field values fails;
- **identity-based** — the question it answers is "is this the *same object* `runLiveModelCalls`
  produced in this process?"

That is why the branded interface matters. The brand is a `unique symbol` property, so a hand-built
object literal **cannot** satisfy `LiveMeasurementWitness` without a cast — TypeScript refuses it
outright. And the cast is a compile-time operation: it changes the type, and it **does not add the
object to the `WeakSet`**. So the only way past the gate is to be the object the mint produced.

This is also the mechanical reason decision A3 has no alternative. `WeakSet` membership is
process-scoped and unserializable, so there is no format in which a witness could be written to a
checkpoint and read back. A design that wanted resumability would have to replace identity with
something forgeable.

The same pattern guards the other capability: `DeveloperMachineGrant` is branded, minted only by
`grantDeveloperMachineRun`, and recorded in `developerMachineGrants`. Both sets share one property
worth stating: **a `WeakSet` can only refuse a candidate it did not mint; it can never invent one.**

#### Proving refusal, as the RUNG 3 smoke test's negative half

A gate only ever observed passing is unproven. The RUNG 3 test therefore has two halves over the
same eval set and the same run shape:

| Half | Witness supplied | Expected |
|---|---|---|
| **positive** | the witness `runLiveModelCalls` minted (over a fake transport, so no network and no key) | `emitLiveRegistry` returns a document with `provisional: false` |
| **negative** | a hand-built object literal `{ modelId, casesAnswered, actualCostMicroUsd }` cast to `LiveMeasurementWitness`, with field values **identical** to the genuine one | throws `LiveRegistryError` with `code === 'LIVE_REGISTRY_WITNESS_NOT_ACCEPTED'` |

The field values are deliberately identical. If the negative case used wrong values it would prove
only that *some* check exists; matching values prove the check is **identity**, not structure. The
assertion is on `code`, never on the message.

The positive half runs `runLiveModelCalls` against an in-process fake `LiveTransport` — the transport
is a parameter, so this needs no network, no endpoint and no credential — which is what lets the
RUNG 3 test be a real test rather than a live-run harness.

---

## The four-rung ladder

Each rung is **independently reportable**: OBSERVED with quoted Evidence_Of_Record, or BLOCKED with a
one-line reason naming the single blocked step. No rung is claimed on the rung below it, no two rungs
share a report line, and the order is 1 → 2 → 3 → 4. Each rung gets exactly **one** new smoke test;
four total, and they are the only new tests in the run.

### RUNG 1 — offline: no network, no credential. Runs FIRST.

Runs **before any credential is supplied and before any network call** (R8.1). The reason is
economic: a failure here is one no key can fix, and finding it after credentials are wired means
diagnosing a transport bug through a credential surface.

**The fake responder seam.** `liveProviderRequest.ts` holds the only socket in the tree, and its own
header records that **nothing in the test suite invokes the function it returns**. That is the seam:
`providerRequest.ts` declares its whole outside world as one injected parameter,
`ProviderRequestFn`, and does not implement it. So the socket is a **parameter, not a global** — the
fake responder is a `ProviderRequestFn` that returns a `ProviderHttpResponse` from an in-process
table. No loopback listener, no port, no DNS, no recorded transcript.

`createLiveTelegramTransport(ctx)` takes its `TelegramTransportClient` the same way, and
`createInMemoryOffsetStore()` already exists for the offset. So RUNG 1 drives the real composition,
the real auth application, the real reader and the real store write, with a fake at exactly one
point.

**Five proofs, one test:**

| Proof | Evidence source | Quoted |
|---|---|---|
| (a) request composition | the `ProviderHttpRequest` the fake responder receives | the request object |
| (b) auth applied **and** credential absent from the request | `composeDialledAddress` is reached with a `ProviderCredential`; the request object has **no** `headers` field carrying an authorization value | the whole request object, safely, because the credential travels **beside** it as an opaque holder |
| (c) response parsing across five shapes | `performProviderRequest` / `readProviderResponse` return value or thrown code, per shape | each refusal `code` |
| (d) telemetry: exactly one structured line per request | the redacted logger's captured lines | the line, and its field set |
| (e) the store write lands | **read back from the store** — not the return value of the write | the row read back |

Proof (b) is the one that would be easy to fake and is not. The design point is structural:
`LiveHttpRequest` / `ProviderHttpRequest` has **no field** for an authorization value. The credential
is a separate parameter carried as an `OpaqueSecret` whose `toString` and `toJSON` both return
`'[redacted]'`, and the single path to the characters is `revealSecret`, called at exactly one site —
inside `composeDialledAddress`, where the address is a local `const` that reaches no logger, no
return value and no error. So "the credential does not appear in the request object" is provable by
construction *and* asserted.

Proof (c)'s five shapes: a success body; a non-success status; a rate-limit response carrying a
retry hint (`retryAfterSecondsFromHeaders` **reads** the advertised interval, and
`TelegramRateLimitRefusal` is what waits on it — the dialler obeys nothing); a malformed body; and a
body exceeding `MAX_PROVIDER_RESPONSE_BYTES`, which `readChunksBounded` truncates and reports so the
reader refuses it with `body_over_read_bound`.

Proof (d) asserts the line **excludes** four things: the credential, the request body, the sender
identity, and the provider base address. Those are R19's four, and each has a structural reason it
cannot be there — but the test asserts absence rather than trusting the reason.

Proof (e) is the difference between a write returning and a write landing. The assertion reads the
row back out of the store through the repository, because R22.2 makes a process starting insufficient
evidence that it works, and the same logic applies to a write returning.

**Halt condition.** If any of the five fails, **stop the ladder at RUNG 1** and report that **no
credential can resolve the failure** (R8.8). Do not wire credentials to "see if it helps". The
proofs are all offline; a credential changes none of their inputs.

### RUNG 2 — credentials wired, environment accepted, isolation proven. No model call.

**Before writing any `Env_File`,** two pre-write checks:

1. **Reachability probe** (A2, R19.1-R19.2): a read-only probe over the existing key material in
   `.secrets/`. It changes no host state, so it is a read under steering §2a. Failure ⇒ **RUNG 2
   BLOCKED, blocked step = the probe.**
2. **`.gitignore` coverage** (R9.1): confirm `.env` and `ops/env/*.env` are matched, and **quote the
   matching entries**:

   ```gitignore
   .env
   ```
   ```gitignore
   ops/env/*.env
   ```

   The second entry exists because the first does not cover it. `.gitignore`'s own comment records the
   measurement: *"The `.env` rule above matches only a file named exactly \".env\", so
   `ops/env/proxy.env` was NOT ignored: proven with `git check-ignore -v` on 2026-08-09, on a PUBLIC
   repository."* The check is `git check-ignore -v` on a representative path per pattern, not a
   grep of `.gitignore` — the system of record for "is this ignored" is git, not the file.

**Writing the env files.** One per service, on the host, **root-owned, mode-600, read by no other
service** (contract 12 §3.2.7). Sixteen entries per agent, and the template declares **no default for
anything** — an unset entry is a startup failure, not a guess. No filled `Env_File` is committed
(R9.3); the `.gitignore` check above is what makes that structural rather than careful.

**Evidence, reusing what already audits this.** `src/server/ops/envTemplates.ts` already audits the
templates on every test run: `auditEnvTemplates(input)` over template text, and
`auditEnvTemplateFiles(envDir, composePath, serverDir)` over the tracked files, the compose topology
and the code bindings. It already carries `ENTRY_SPECS` (per-entry owners, gate, secret), the
`GATE_VOCABULARY` (`G1`-`G6`, `G8`, `operator`, `build` — `G7` absent because it is closed as
WONT-DO), `AGENT_CAP_ENTRY` keyed per agent, `CODE_BINDINGS` tying `MSG_API_BASE` to
`ports/telegram.ts`'s `apiBaseUrlRef`, **and the cross-file check that no entry of one agent's
template appears in the other's unless it is a declared non-secret shared entry.**

So RUNG 2 **calls the existing audit and quotes its findings list** rather than re-implementing the
cross-file comparison. Duplicating it would create a second rule that can disagree with the first.
What the rung adds on top is the three things the audit cannot see, because the audit reads templates
and this rung reads a running system:

| Proof | Evidence source |
|---|---|
| `Env_Loader` accepts all 16 entries and each process reaches **ready** | the process's own readiness output / structured log line |
| the finance `Env_File` holds no life secret, and the life file holds no finance secret | `auditEnvTemplates`' cross-file finding on the filled files' **entry names** — never values |
| neither store path resolves from the other container | an attempted resolution from inside each container, refused in **both** directions |

The negative direction is proven **both ways**, not once. Finance holds no `<BOT_A_TOKEN>`, no
`<OR_KEY_LIFE>`, no `<LIFE_WEBHOOK_SECRET>`, no `<WHOOP_ACCESS_TOKEN>`; life holds no
`<BOT_B_TOKEN>`, no `<OR_KEY_FINANCE>`, no `<MONEY_WEBHOOK_SECRET>`. And the store-path proof rests
on the same structure the finance template's own closing notes state: the other agent's volume is not
mounted into this container, so a guessed path does not resolve, **and** the statement that would join
two stores is refused by the code as well.

If `Env_Loader` refuses, report **the refusing entry name** and exclude its value (R9.5). An entry
name is not a credential; a refusal message that quotes the value is a disclosure.

**No model call in RUNG 2** (R9.8). That is what makes RUNG 3 a separate rung rather than a
continuation.

**Halt condition.** Probe failure, `.gitignore` gap, `Env_Loader` refusal, or an isolation proof
failing in either direction ⇒ **RUNG 2 BLOCKED** naming the single blocked step.

### RUNG 3 — earn the registry, then one real model response

**Pre-flight, before anything is spent** (R10.6). The estimate is integer micro-USD computed from the
tracked frozen pricing snapshot (`src/features/benchmark/pricing.ts`) over the eval set and the two
models, with integer arithmetic only — no `parseFloat`, no `.toFixed(`, per the money invariant. It
is reported **before** the first call, and compared against `DEV_WEEKLY_CEILING_MICRO_USD`
(≈ USD 1/week, dev tier).

> If the estimate does not fit, report **RUNG 3 BLOCKED at the estimated number and spend nothing**
> (R10.7). Not "attempt and stop when the cap trips" — an estimate that does not fit is a decision not
> to start.

**Four numbers reported before the rung is claimed** (R10.8):

| Number | Source |
|---|---|
| cases in the eval set | `cases.length` after `buildEvalSet()` and both gates |
| cases answered | `witness.casesAnswered` per model — the witness's own count |
| models graded | `emitted.results.length` |
| **actual cost, integer micro-USD** | `emitted.actualCostMicroUsd`, summed from `witness.actualCostMicroUsd` |

The cost is the **provider's own reported figure**, taken exactly as reported: never converted, never
re-derived from a price table, never estimated. `LiveModelExchange.costMicroUsd` is the provider's
actual, and `usageOf()` deliberately leaves contract 09's `costUsd` at `0` rather than converting,
because they are different units. Owner money never appears on this path — it is integer milliunits
behind `src/lib/money/` and provider cost is integer micro-USD, kept in its own unit precisely so the
two cannot be mistaken for each other.

**Then ONE controlled model call.** `<MODEL_ELIGIBILITY_REGISTRY_PATH>` is pointed at the **emitted**
document (R10.10), and one call is made through the agent's own path with the **response body
quoted** as Evidence_Of_Record.

Two things this rung must not do, and both are R11:

- It must not point `<MODEL_ELIGIBILITY_REGISTRY_PATH>` at a provisional registry and then report
  routing as working. While that path resolves to a provisional document, live routing is reported as
  **refused** (R11.6-R11.7).
- It must not report a process reaching ready as evidence of working routing (R11.8). Ready means the
  loader accepted 16 entries. It says nothing about whether a model was selected.

**Halt condition — and it is the one most likely to fire.** If the registry cannot be earned in the
time box, **stop the ladder at RUNG 2** and report exactly three states:

> `transport live, routing refuses on a provisional registry, runner <state>`

where `<state>` is the runner's actual completion state — built-not-run, refused-at-<code>, or
partial-with-spend-forfeit. Reporting "the model layer is blocked" as one undifferentiated wall is
what R23.3 forbids; the transport being live and the runner existing are separate measured facts.

### RUNG 4 — a real message, proven hop by hop

The Operator sends a real message from their own messaging client. **Six hops, each read from the
store or the structured log, each quoted:**

| # | Hop | System of record |
|---|---|---|
| 1 | transport received | the poll report / structured log line for the update |
| 2 | authenticated against `<ALLOWED_USER_IDS>` | the auth decision line — the **decision**, not the identifier |
| 3 | queued | the work-queue row, read back from the store |
| 4 | worker picked up | the worker's claim on that row, read back |
| 5 | reply sent | the send receipt line |
| 6 | **reply arrived** | **the reply appearing in the Operator's own messaging client** |

Three rules govern how these are read, and each closes a specific way of over-claiming:

- **The absence of an error is not evidence of any hop** (R12.3). A quiet log is a quiet log.
- **One hop is not evidence of another** (R12.4). A send receipt is hop 5. It is not hop 6 — a
  returned identifier is not an arrived message (R22.3).
- **A reply appearing in the Operator's own client is the only acceptable evidence for hop 6**
  (R12.5). Nothing the system can read about itself substitutes for it.

**Then store isolation, proven in BOTH directions** (R12.6): finance cannot open the life store, and
life cannot open the finance store. Both attempted, both refused, both quoted. One direction is half a
proof.

**Long-poll on both sides** (R12.7): `TELEGRAM_MODE=longPoll`. **No DNS change, no certificate
request, no public port published, no `setWebhook`.** Long poll pulls outbound, so none of the four is
needed — and each of them is a mutation under steering §2a. `getWebhookInfo` is nonetheless checked on
every run (R7.8) as the compensating detection control for the standing D-ROTATE deferral; a deferral
without its compensating control is just an unrotated credential.

**Halt condition.** Any hop unreadable ⇒ **RUNG 4 BLOCKED** naming that hop as the single blocked
step, with the five readable hops still reported as read. A ladder rung is not all-or-nothing in what
it *reports*, only in what it *claims*.

---

## The identity sweep (STEP 1) — a separate one-off procedure

AC18 stays exactly as it is. Its scan roots are `['ops', 'src/server/mocks/fixtures']` and its
allowlist is untouched — widening either is defect class F25 and R17.5 forbids it in the same sentence
that forbids lowering the floor. The sweep is therefore a **separate, one-off procedure**, not a
change to the checker.

**Why it is needed at all.** `.kiro/**` is tracked and AC18 has never covered it. A prior sweep found
the life bot's **name** committed in a spec file under `.kiro/**`. So the harness printing 20/20 tells
you nothing about that path, and STEP 3 is irreversible.

**Scope.** Every tracked file of the repository, across the full 47-commit range ahead of the remote,
from scratch (A1). Binary extensions are skipped as unreadable-as-text, matching AC18's own
`BINARY_EXTENSIONS` reasoning.

**Four disclosure shapes, one pass:**

| Shape | What it looks for | Note |
|---|---|---|
| (a) | the life bot display name and handle | the shape that was actually found before |
| (b) | a numeric messaging user identifier, 8-10 digits | authorises nothing alone, still an operator fact |
| (c) | a hostname, an IPv4 address, or a hosting-provider address | AC18's `DOTTED_TOKEN` vocabulary is the model for the hostname half |
| (d) | a 40-character mixed-case token shape **that is not a git object hash** | a git hash is 40 chars but lowercase hex only, so the mixed-case requirement is what separates them |

**Output discipline — the part that is easy to get wrong.** The report is **counts and paths only.
Never values** (R2.5). A sweep that prints what it found publishes the disclosure into the run report,
which is itself a tracked artifact if anyone pastes it. So the output shape is fixed:

```
shape (a)  hits: <n>   paths: <path>[, <path>…]
shape (b)  hits: <n>   paths: …
shape (c)  hits: <n>   paths: …
shape (d)  hits: <n>   paths: …
```

**Gate behaviour.** If (a) or (b) hits: **fix the text**, leave AC18's allowlist and scan roots
**unchanged**, and **re-run the sweep** (R2.6). Hold at STEP 1 while any (a)/(b) hit is uncorrected
and unanswered; **do not execute STEP 3** (R2.7). Shapes (c) and (d) are reported and judged — a
dotted token can legitimately be a filename or an attribute access, which is exactly why AC18
enumerates its permitted tokens rather than pattern-matching them.

**The design tension worth naming.** `.kiro/**` is tracked, and *this spec's own documents live
there*. So `requirements.md`, this `design.md` and the forthcoming `tasks.md` are **inputs to the
sweep they specify**. The design constraint that follows: every credential, host, address, bot,
identifier and store path in these three documents appears **only** as its `<ENTRY_NAME>` placeholder.
That is not stylistic caution — it is what makes the sweep able to pass on the documents that describe
it. A design document that named the host would fail its own gate.

---

## The remaining steps

### STEP 0 — stillness

Reduced by the measured corrections: `git status --porcelain` is empty and `turnIntake.ts` is tracked,
so the three mid-edit files and one untracked file the originating contract describes are already
clean. What remains:

1. Stop every background loop and watcher that writes into this tree.
2. Emit the written confirmation line, verbatim: **"no other process is writing this tree."**
3. Record the correction as an Observation with its date, superseding the contract's claim (R1.3).
4. Timestamp.

If a writer cannot be stopped, **name that writer and halt before STEP 1** (R1.4). A moving tree
between the sweep and the push means the sweep measured something that is no longer what gets pushed.

### STEP 2 → STEP 3 — harness once, then push, then verify the push separately

`npm run verify:all -- --all`, **exactly once**, immediately before the push (R3.1, R3.5, R18.4).
20 of 20 executed checks must pass. The **two summary lines are quoted verbatim** in the Final_Report
(R3.3). Fewer than 20/20 ⇒ report the failing check identifiers and **do not execute STEP 3** (R3.4).

The push and its verification are **two distinct steps**, and the separation is the whole design point:

```
STEP 3a  the push command          git push origin master
              │
              │  exit status 0  ◄── NOT evidence (R4.5)
              ▼
STEP 3b  the Push_Verifier         re-READ the reference from the remote
              │
              └─ assert remote head == local head, ahead count == 0
                 report: remote object id, local object id, ahead count
```

The Push_Verifier re-reads the reference **from the remote**, compares it to the local head, and
reports both object identifiers plus an ahead count of 0 (R4.2-R4.3). A mismatch is reported as a
**failure** with both identifiers and the remaining ahead count — not as a success with a caveat
(R4.4). The command's exit status alone is insufficient Evidence_Of_Record, and this is the archetype
of the rule the whole run is built on: a successful command is not a confirmed state.

### STEP 4 — the other repository's tests are RUN

The clone is **writable**, at a **sibling directory outside this tree** and outside the ignored path
used for the earlier read-only copy (R5.1). Outside this tree so nothing it brings can be committed
here by accident; outside the earlier path so the read-only copy is not silently reused as if it were
the writable one.

**What the measured state tells us about install cost**, from `ops/NIZAMCORE_VERIFIED_STATE.md`:

- §3: its long-poll runner is **pure standard library with no installed dependencies**. That bounds
  the install cost of the transport path to nothing.
- §4 gap 1: its declared agent-runtime package carries a **large dependency tree** and **no Python
  module imports it** — it is one line in one configuration file. So the suite may not need it at all.
- §8: **143 test functions**, **29 relay tests across two files (7 + 22)**, all **read from files and
  never observed passing**.

The design consequence: attempt the suite with the standard-library path first and record what it
does. Only if the suite actually fails on a missing import does the agent-runtime package's install
cost become relevant, and at that point it is a measured finding rather than an assumed prerequisite.

Report the **observed** total and passed counts, and record that this is the **first observed
execution** (R5.3). If the suite does not execute at all, **the refusal is the finding**, naming the
single step that blocked it (R5.4) — not "the suite is broken".

**Commit locally only. Never push** (R5.5). A push requires an explicit "push granted" from the
Operator (R5.6, R16.6).

### STEP 5 — one credential list, and every choosable value chosen

**Exactly one request, issued once, then wait** (R6.1, R6.7). Never proceed on a guessed value.

**Asked for (cannot be minted by this run):**

`<BOT_A_TOKEN>`, `<BOT_B_TOKEN>`, `<OR_KEY_LIFE>`, `<OR_KEY_FINANCE>`, `<ALLOWED_USER_IDS>`,
`<MODEL_API_BASE>`, `<MSG_API_BASE>`.

The last two are **proposed** from each provider's own published documentation for the Operator to
**confirm** (R6.2) — proposed, because a base address resolved from documentation is a fact about the
provider, not a choice; confirmed, because a wrong base is a silent failure at the first call.

**Chosen and stated, with reasons — every `operator` and `build` gated entry:**

| Entry | Gate | Chosen | Reason |
|---|---|---|---|
| `FINANCE_DATA_DIR` | G1 | this agent's **own** volume path, mounted nowhere else | contract 06 §2.1: its own directory and no fallback. A shared parent would make invariant 1 a convention |
| `FINANCE_STORE_FILE` | operator | `finance.db` | steering §4 invariant 1 names the three files. Matching that name means an isolation test can assert the name it was told |
| `STORE_BUSY_TIMEOUT_MS` | operator | a few seconds | long enough that a normal write behind another write waits rather than failing; short enough that a stuck writer surfaces as a busy failure to its caller instead of hanging the turn |
| `FINANCE_CONTAINER_PORT` | operator | an internal-network port; **no agent binds a public port** | contract 12 §3.2.1. The proxy is the only thing that faces outward, and in long-poll mode nothing needs to |
| `MAX_WORK_ITEMS` | operator | a small single-digit bound | contract 12 §5.5.5: a single-operator system needs very little, and an unbounded worker pool turns one bad turn into a spend incident |
| `FINANCE_WEEKLY_CAP` | G4 | this agent's **own** ceiling, in the provider's own accounting unit | §6.2: never one entry for both. A shared cap makes one agent's runaway loop the other agent's outage, which R17 forbids in the same sentence that requires deterministic alerts to survive exhaustion |
| `KILL_SENTINEL_PATH` | G1 | a path on this agent's own volume, checked before every model call, model-path write and bus publish | contract 12 §8. On its own volume so the halt does not depend on the other agent's mount |
| `NIZAM_KILL_ALL` | operator | **`0`** | R6.4. `1` halts this agent. `0` is the running state. It is restart-scoped, so it is not a panic stop — the sentinel is |
| `BUS_INTERNAL_ENDPOINT` | operator | an internal-network endpoint, unreachable from outside by construction, **never exposed through the proxy** | steering §4 invariant 2 |
| `MODEL_ELIGIBILITY_REGISTRY_PATH` | build | the path of the **emitted** registry after transfer | R10.10. Pointing it at a provisional document and reporting routing as working is R11.6's forbidden shortcut |
| `TELEGRAM_MODE` | operator | **`longPoll`**, both sides | R6.5. Pulls outbound: no DNS, no certificate, no public port, no `setWebhook` — four mutations avoided |

**Life-side counterparts, same reasoning, own values:** `LIFE_DATA_DIR` (own volume),
`LIFE_STORE_FILE` = `life.db`, `STORE_BUSY_TIMEOUT_MS` (same shape, its own file),
`LIFE_CONTAINER_PORT` (internal, distinct from the finance port), `MAX_WORK_ITEMS` (own bound),
`LIFE_WEEKLY_CAP` (own ceiling — `AGENT_CAP_ENTRY` keys the cap per agent for exactly this reason),
`KILL_SENTINEL_PATH` (its own volume), `NIZAM_KILL_ALL=0`, `BUS_INTERNAL_ENDPOINT` (the same bus, both
sides internal-only), `MODEL_ELIGIBILITY_REGISTRY_PATH`, `TELEGRAM_MODE=longPoll`. Plus the two
entries the life template holds and the finance template deliberately does not: `WHOOP_API_BASE` and
`WHOOP_ACCESS_TOKEN` — recovery context reaches the finance agent as a **band** on the consent bus,
never as a provider call, which is why there is no recovery credential on the finance side to hold.

**Generated, not asked for:** `<MONEY_WEBHOOK_SECRET>` and `<LIFE_WEBHOOK_SECRET>` are generated
randomly. The Operator is **told each was generated**, and told that **neither is used on the
long-poll path** — they are the token the provider echoes on a webhook delivery, and there are no
webhook deliveries in `longPoll` mode. They are still populated because the template declares **no
default for anything**: an unset entry is a startup failure, not a guess. The Operator is **not asked**
for either (R6.6).

**Credential discipline throughout** (R7): one destination only — the owning service's `Env_File` on
the host. Referred to by **entry name** in every message, log line, commit, fixture, comment, error
message and report. `<OR_KEY_FINANCE>` and `<OR_KEY_LIFE>` are used **only** for their own agent and
**never substituted** for one another under any failure condition. **No credential is invented**,
including a plausible placeholder of the correct shape. **Nothing is rotated** (standing D-ROTATE
deferral), and `getWebhookInfo` is checked on every run as the compensating detection control. A
provider refusal is reported as **the provider's refusal code plus the entry name**, with the value
excluded.

### STEP 7 — the Drive audit: answer the question, build nothing

This is an **audit**, not an integration (R15.4).

**The question:** does a server-side Drive path exist at all?

**Evidence read:**

| Read | Finding |
|---|---|
| `ops/env/finance.env.example` — all 16 entries | **no Drive credential entry** |
| `ops/env/life.env.example` — all entries | **no Drive credential entry** |
| `src/lib/drive/` | browser-side: OAuth token client in-browser, Google Picker, Dexie mirror |
| AC08 | enforces per-file scope (`drive.file`), a browser OAuth concern |
| `src/server/ports/drive.ts`, `src/server/mocks/driveMock.ts` | a **port and a mock** — an injected interface with a deterministic mock, which is what steering §2 prescribes for a capability that is not wired |

A port plus a mock and **no credential entry in either template** is the signature of a capability
that was designed for and never provisioned. There is no environment entry through which a server
process could obtain a Drive credential, so there is no server-side Drive path to exercise.

**The answer, stated as the exact sentence R15.3 prescribes:**

> no server-side Drive integration exists; Drive is a browser capability of the PWA

Then proceed. Nothing is built. If the audit were to find a server-side path, it would **name the
module and the credential entry it requires** (R15.2) — but on the evidence above, it does not.

### STEP 8 — A-G4: a stop-and-ask with a stated default

`ops/NIZAMCORE_VERIFIED_STATE.md` §10 records it: of 10 routable intents behind the single window,
**9 resolve fully and 1 does not.** The `decision_log` intent names a codename that is **present in
the codename mapping layer but absent from the runtime registry**, and its **persona file does not
exist**. A message classified as a decision log routes to an agent that cannot answer — and the
failure surfaces to the Operator as **silence in the one window**, not as a refusal. That is the one
thing not to do, which is why this is worth a step.

**Two COUPLED decisions**, and the coupling is why they are presented together:

| Decision | Option A | Option B |
|---|---|---|
| what | author the persona and register the codename → **10/10 routable** | **remove the intent** → 9 routable, 9 resolved |
| how | direct edit in the clone | **emitted patch** under `ops/nizamcore-patches/NNN-<slug>.patch` |

**Stated default: remove the intent, emitted as a patch.** Three reasons:

1. It is the **smaller change** — one routing-configuration entry, versus a persona document plus a
   registry entry.
2. It **invents no persona content on the Operator's behalf.** A persona is voice and judgement; twelve
   already exist, authored by their owner. Writing the thirteenth in an automated run is inventing
   policy that a contract would govern.
3. It **stays inside steering §6**, which requires changes to the other repository to be emitted as a
   reviewable patch series rather than applied.

**Why this is a stop-and-ask rather than a default carried out.** The 2026-08-10 authorisation is
scoped to *"the files needed to wire its model layer and take its relay live."* A-G4 is a routing
defect, not the model layer and not the relay — so it is **arguably outside that scope** (R16.5). An
automated run that reads a granted scope generously is how a scope stops meaning anything. So the two
coupled decisions are presented with the default stated, and the run **waits** (R16.4).

**No push of the other repository without an explicit "push granted"** (R16.6). The authorisation's
scope on pushing was never stated and is therefore still closed: work there commits locally and the
Operator pushes.

The Final_Report states A-G4 as **closed or open** (R16.7) — and "presented, awaiting the Operator" is
**open**.

### STEP 9 — the Final_Report

Exactly **one** block, nothing else (R24.1). Eleven lines, in this order (R24.2):

```
PUSHED           <remote object id> == <local object id>, ahead 0   |   BLOCKED: <one line>
HARNESS          <the two summary lines, verbatim>
SUITE            <observed count> against floor 2301
NIZAMCORE        <observed total>/<observed passed>, first observed execution   |   refusal + blocked step
T1 TRANSPORT     OBSERVED <evidence>   |   BLOCKED <one-line reason>
T2 MODEL         OBSERVED <evidence>   |   BLOCKED <one-line reason>
T3 STORE         OBSERVED <evidence>   |   BLOCKED <one-line reason>
DRIVE            no server-side Drive integration exists; Drive is a browser capability of the PWA
A-G4             closed | open
LIVE CONDITIONS  <the tier the finance agent actually routes at; whether the reply path depends on T4>
NEXT BLOCKER     <one line: the blocker, and the party who owns it>
```

`SUITE` records against a floor of **2301** and never 2223 (R24.3). `T1 TRANSPORT`, `T2 MODEL` and
`T3 STORE` are each **OBSERVED or BLOCKED with a one-line reason** (R24.4). `NEXT BLOCKER` is one line
naming the blocker **and the party who owns it** (R24.5). The report **excludes every credential value
and every deployment particular** (R24.6). Timestamp at completion (R24.7).

When the time box expires, **stop and file the report with whatever was measured** (R23.4). A partial
report carrying Evidence_Of_Record is preferred over a complete one carrying an inference (R23.5).

---

## T4 — reporting a structural limit, not a credential problem

This is the finding most likely to be misread, so the report is designed to make misreading hard.

**What the code says.** `src/server/benchmark/liveRegistry.ts` header point 3 is titled
*"`developerBuild` is STILL `false`, and still `unmeasured`"*, and calls it "the difference readers are
most likely to expect and it does not exist." The emission calls
`unmeasuredDeveloperBuild(liveRun.modelId, 'code_benchmark_not_run')` for every model, and every
registry entry's `developerBuild` field is `developerBuildPasses(result.developerBuild)` — which
answers **`false`** for an unmeasured verdict.

**Why.** Contract 09 grades developer/build work from a **code benchmark and repository tests,
separate from live finance eligibility**. A finance eval run measures **finance** work: it runs no code
benchmark and records no per-candidate repository-test result. So the verdict is `unmeasured` with
reason `code_benchmark_not_run`, and that is correct rather than an oversight.

**The consequence, stated plainly.** `TIER_REQUIRED_ELIGIBILITY.T4` asks for the developer verdict. No
finance run can supply one. So **even a fully measured live registry leaves T4 unroutable.** Earning
the registry does not fix this, and neither does any credential.

**How the report handles it** (R14):

1. State that a finance eval run records `unmeasured` / `code_benchmark_not_run`, so
   `developerBuildPasses` answers `false` (R14.1).
2. State that `TIER_REQUIRED_ELIGIBILITY.T4` **cannot be met by this path** (R14.2).
3. `LIVE CONDITIONS` states **which tier the finance agent actually routes at** (R14.3) — read from
   the router's own selection over the emitted registry, not inferred from the registry's contents.
4. `LIVE CONDITIONS` states **whether the proven reply path depends on T4** (R14.4).
5. **If it does**, that dependency is reported as a **separate blocker** and explicitly **not** as a
   credential problem (R14.5). The distinction matters operationally: a credential problem is closed by
   the Operator supplying a value; this one is closed by running a code benchmark, which is a different
   contract's work.

The wrong report here would be "T4 blocked pending model key". The key is not the blocker. Reporting it
as one would send the Operator to fix something that is already correct.

---

## Data Models

No new persisted shape is introduced. The runner consumes and produces existing types.

```ts
// src/features/benchmark/liveModelCaller.ts — consumed by the runner
interface LiveModelExchange {
  readonly caseId: string;
  readonly modelIdRequested: string;
  readonly modelIdServed: string;      // a substitution refuses: a registry names the model it graded
  readonly text: string;
  readonly parsed: Record<string, unknown> | null;
  readonly schemaValid: boolean;
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
  readonly costMicroUsd: number;       // the provider's ACTUAL, integer micro-USD, as reported
  readonly latencyMs: number;
  readonly confidenceBps: number;
}

interface LiveModelRun {
  readonly modelId: string;
  readonly exchanges: readonly LiveModelExchange[];
  readonly witness: LiveMeasurementWitness;   // WeakSet-backed identity; see the tamper proof
}

// src/server/benchmark/liveRegistry.ts — produced by the runner
interface EmittedLiveRegistry {
  readonly fileName: typeof LIVE_REGISTRY_FILE_NAME;   // === PROVISIONAL_REGISTRY_FILE_NAME
  readonly document: LiveEligibilityRegistry;          // { registryVersion, provisional: false, entries }
  readonly json: string;
  readonly results: readonly LiveModelResult[];
  readonly actualCostMicroUsd: number;                 // summed provider actual, integer micro-USD
  readonly artifacts: Readonly<Record<string, string>>; // path -> text, ready to write verbatim
}
```

**Two units, deliberately never joined.** Provider cost is **integer micro-USD**
(`MICRO_USD_PER_USD = 1_000_000`, `src/features/routing/spendLedger.ts`) and lives in its own unit so
it can never be mistaken for owner money. Owner money is **integer milliunits** behind
`src/lib/money/`. Owner money does not appear anywhere on the registry path, and no `parseFloat` or
`.toFixed(` is written outside `src/lib/money/`. The runner's pre-flight estimate is integer
arithmetic over integer micro-USD for the same reason.

---

## Error Handling

**Discriminate on `code`, never on a message.** Both error classes on this path — `LiveRunError` and
`LiveRegistryError` — carry an enumerated `code` and a frozen `detail`. Messages are prose and can be
reworded; a code is the contract. The runner's dispatch is a `switch` on `code`, and its default arm
re-raises rather than swallowing an unrecognised code.

**`detail` has no field for a secret, and the runner does not add one.** `LiveRunError.detail` holds
field paths, status codes, model ids and case ids — no prompt, no completion, no credential.
`LiveRegistryError.detail` holds counts, gate names, model ids and micro-USD figures. `ProviderDialError`
carries a single field, the operation name, and deliberately does **not** attach the platform's error
as a `cause`, because a socket failure's message names the host it could not reach.

**Failures halt rather than degrade.** `runLiveModelCalls` aborts on the first failure: no retry loop,
no per-case fallback, no continue-on-error. A run with a hole in it is not a measurement, and a loop
that keeps trying after a refusal is how a narrow carve-out becomes an open channel. The runner does
not add a retry on top — the bounded budgets that exist (`SEND_RETRY_POLICY`, `POLL_POLICY`) belong to
the messaging path, and a second budget over the same limit is how two halves of one policy come to
disagree.

**A refusal is reported with its blocked step, not as a wall.** R23 governs every failure path in this
run: decompose the objective, name the **single** blocked step, name the party who owns it. "The model
layer is blocked" is not a report. "The pre-flight estimate is `<n>` micro-USD against a ceiling of
1,000,000; RUNG 3 BLOCKED at that number; nothing spent" is.

---

## Testing Strategy

**Exactly four new tests. One smoke test per ladder rung. No others** (R18.1-R18.2).

| Test | Rung | Drives | Fake at |
|---|---|---|---|
| `tests/smoke/rung1.transportOffline.smoke.test.ts` | 1 | composition, auth, five parse shapes, telemetry, store write read back | the injected `ProviderRequestFn` |
| `tests/smoke/rung2.envAndIsolation.smoke.test.ts` | 2 | `auditEnvTemplateFiles`, 16-entry acceptance, cross-file negative both ways, store-path non-resolution | template text and an in-memory environment |
| `tests/smoke/rung3.witnessGate.smoke.test.ts` | 3 | `runLiveModelCalls` → `emitLiveRegistry`; **positive and negative witness halves** | the injected `LiveTransport` |
| `tests/smoke/rung4.endToEnd.smoke.test.ts` | 4 | the six-hop chain over the store and the log; isolation both directions | the injected transport client |

Every one of the four sits under `tests/`, so every one **declares its owning contract and phase in
the first 20 lines** (AC10, R17.7).

**None of the four makes a network call.** Each fakes at exactly one injected seam, which is the whole
return on the injected-port design: the transport's socket is a parameter, the model transport is a
parameter, the offset store has an in-memory constructor, and the registry's two capabilities are
injected. The tests exercise real composition, real parsing, real grading and real refusals with no
credential and no endpoint.

**Per-step verification is scoped** (R18.3): when a step touches source files, run `npm run typecheck`,
`npm run lint`, and the test runner **on the touched files only**. The full suite runs **exactly once**,
immediately before the push (R18.4), and **never between steps** (R18.5).

**Nothing is weakened to make anything pass** (R17):

- The `AC04 --min` floor stays at **2301** — not lowered, and not raised this run (see the measured
  corrections for why).
- **No `eslint-disable` directive** is added, anywhere, for any reason.
- **No guard's allowlist or scan roots are widened**, including AC18's. The identity sweep is a separate
  procedure precisely so that this holds.
- `ops/` keeps `<ANGLE_BRACKET>` placeholders only (AC09).
- `src/features/benchmark/` and `src/features/routing/` stay **out of the application bundle** — and the
  runner does not change that, because a `scripts/` entrypoint is not imported by `App.tsx` or the
  router.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a
system — essentially, a formal statement about what the system should do. Properties serve as the
bridge between human-readable specifications and machine-verifiable correctness guarantees.*

**How these are validated under a four-test budget.** R18.1 fixes the spend at exactly four new tests,
one smoke test per ladder rung. So each property below names the rung test that asserts it, or is
marked **existing coverage** where a harness check or an existing test in the suite already asserts it.
No new property-test file is added. Where a property is asserted by one of the four, it is asserted
over generated shapes rather than one example wherever the input space makes that worthwhile — the
tamper property in particular is worth generating over, because generated field combinations are what
prove the check is identity rather than structure.

### Property 1: A tampered witness is refused and a minted one is accepted

*For any* triple of `(modelId, casesAnswered, actualCostMicroUsd)` values, a hand-built object literal
carrying that triple and cast to `LiveMeasurementWitness` is refused by `emitLiveRegistry` with
`code === 'LIVE_REGISTRY_WITNESS_NOT_ACCEPTED'`, while a witness minted by `runLiveModelCalls` over a
complete run of the same shape is accepted and yields a document with `provisional: false`.

The field values in the refused case are drawn from the same space as the accepted one — including
being exactly equal to it — so passing this property proves the check is **identity** (`WeakSet`
membership) and not structure. It follows that no serialized witness can pass, which is the mechanical
reason a checkpoint file would be a replay path and why decision A3 has no resumable alternative.

**Validates: Requirements 10.2, 10.3, 11.1, 11.3, 11.5** — asserted by `rung3.witnessGate.smoke.test.ts`

### Property 2: No renderer emits a credential value or a deployment particular

*For any* credential value and *any* deployment particular supplied to the run, every rendering path
yields a redaction marker, an entry name, or a path — never the value. This holds across all five
renderers: the composed request object, the telemetry line, a thrown error's `detail`, the identity
sweep's output, and the Final_Report.

`OpaqueSecret.toString()` and `toJSON()` both return `'[redacted]'`, so template interpolation,
`String()`, `console.log`, `JSON.stringify` and every structured logger reach the marker. `revealSecret`
is the single path to the characters and is called at exactly one site. The property asserts the outcome
rather than trusting the structure.

**Validates: Requirements 2.5, 7.2, 7.3, 7.4, 8.6, 24.6** — asserted by
`rung1.transportOffline.smoke.test.ts` (request object, telemetry line, error detail); the sweep and
report halves are asserted by the sweep procedure's own output check

### Property 3: Authentication is applied while the credential stays out of the request

*For any* request the transport composes, the credential is absent from the request object — the
serialized object contains no substring of the credential value — **and** the single reveal site is
reached exactly once, so the dial is genuinely authenticated rather than merely credential-free.

Both halves are required. A request with no credential anywhere would satisfy the absence half and be
an unauthenticated call; a request carrying the credential in a header field would satisfy the
application half and be a disclosure surface.

**Validates: Requirements 8.4** — asserted by `rung1.transportOffline.smoke.test.ts`

### Property 4: Response reading is total — a validated response or an enumerated refusal, never a partial success

*For any* response triple of `(status, bodyText, byteLength)`, the reader either returns a fully
validated response or throws with a `code` drawn from the enumerated code set. It never returns a
partially populated response and never invents a success.

The generator must cover all five shapes RUNG 1 requires: a success body, a non-success status, a
rate-limit response carrying a retry hint, a malformed body, and a body exceeding
`MAX_PROVIDER_RESPONSE_BYTES`. An absent status is reported as `0`, which is outside the success range,
so the reader refuses it rather than the dialler inventing a success.

**Validates: Requirements 8.5** — asserted by `rung1.transportOffline.smoke.test.ts`

### Property 5: A store write round-trips

*For any* valid update written to the store, the row read back through the repository equals the row
written.

This is the canonical round trip, and it is the difference between a write **returning** and a write
**landing**. R22.2's rule that a process starting is not evidence it works applies identically to a
write returning.

**Validates: Requirements 8.7** — asserted by `rung1.transportOffline.smoke.test.ts`

### Property 6: Store isolation holds in both directions, and no cross-store attach resolves

*For any* pair of distinct agent stores, an open of one store from the other agent's context is
refused, in **both** directions, and any statement that would join two stores is refused rather than
executed.

Stated as one property with the bidirectionality inside it, deliberately: proving one direction is half
a proof, and splitting it into two properties would let one half be reported as the invariant.

**Validates: Requirements 9.7, 12.6, 20.1, 20.2** — asserted by
`rung2.envAndIsolation.smoke.test.ts` and `rung4.endToEnd.smoke.test.ts`; existing coverage in
`src/server/db/isolation.test.ts`

### Property 7: Neither agent's environment file holds the other agent's secret

*For any* entry declared `secret: yes` in one agent's environment template, that entry name is absent
from the other agent's template — checked in both directions over the full entry set.

Distinct from Property 6: this is about which entry **names** live in which file, whereas Property 6 is
about which process can open which file. A file could satisfy one and violate the other.

**Validates: Requirements 9.6** — asserted by `rung2.envAndIsolation.smoke.test.ts` via the existing
`auditEnvTemplates` cross-file finding; existing coverage in `src/server/ops/envTemplates.test.ts`

### Property 8: The environment loader is complete and fails closed

*For any* entry declared in an agent's template, the loader recognises it; and *for any* single entry
omitted or left empty, startup refuses, the refusal names the **entry name**, and the refusal carries
no value.

Two directions of one fail-closed statement. The template declares no default for anything, so an
unset entry is a startup failure rather than a guess — and an unconfigured guard must not be an open
door.

**Validates: Requirements 9.4, 9.5** — asserted by `rung2.envAndIsolation.smoke.test.ts`

### Property 9: Provider cost is the exact integer sum of what the provider reported

*For any* list of live exchanges, the emitted `actualCostMicroUsd` equals the exact integer sum of the
per-exchange `costMicroUsd` figures, is a non-negative safe integer, and the four reported numbers
(cases in the eval set, cases answered, models graded, actual cost) agree with the emitted results.

A conversion, a re-derivation from a price table, or an estimate substituted for the actual all show up
as an inequality. Contract 09's `costUsd` is deliberately left at `0` rather than converted, because
micro-USD and USD are different units and joining them is how an estimate becomes an actual.

**Validates: Requirements 10.6, 10.8, 10.9** — asserted by `rung3.witnessGate.smoke.test.ts`

### Property 10: An estimate over the ceiling spends nothing

*For any* pre-flight estimate exceeding the development weekly ceiling, the transport is invoked
**zero** times and the run reports BLOCKED at the estimated number.

Separate from Property 9 on purpose: the arithmetic can be perfect while the run still starts spending,
and "attempt and stop when the cap trips" is not the same decision as "do not start".

**Validates: Requirements 10.7** — asserted by `rung3.witnessGate.smoke.test.ts`

### Property 11: Every model this path grades fails the developer/build verdict, so T4 is unroutable

*For any* set of witnessed finance runs, over any models and any eval set, every emitted result's
developer/build verdict is `unmeasured` with reason `code_benchmark_not_run`, every registry entry's
`developerBuild` is `false`, and therefore no entry satisfies `TIER_REQUIRED_ELIGIBILITY.T4`.

This is a structural fact of the emission, not a configuration: contract 09 grades developer/build work
from a code benchmark and repository tests, separate from live finance eligibility, and a finance eval
run runs neither. It holds for a fully measured registry, which is why the report must name it as a
structural limit and not as a credential problem.

**Validates: Requirements 14.1, 14.2** — asserted by `rung3.witnessGate.smoke.test.ts`

### Property 12: A developer-machine grant is refused wherever a server-runtime marker is present

*For any* non-null `serverRuntimeMarker` value, `grantDeveloperMachineRun` throws
`LIVE_GRANT_REFUSED_SERVER_RUNTIME` and no live call is made; for `null`, and only with the single
recognised invocation literal, it mints a grant.

This is the mechanism behind decision A4's constraint. It is not a policy the runner honours — it is a
refusal the runner cannot get past, which is why the runner **cannot** execute on the host and the
emitted artifact must be transferred.

**Validates: Requirements 10.4, 10.5** — asserted by `rung3.witnessGate.smoke.test.ts`

---

### Properties held by existing coverage, restated so nothing is claimed twice

The following are universally quantified invariants of this system that this run must not violate. Each
is **already implemented and asserted** by a harness check or an existing test, so this run adds no new
assertion for it. They are listed because "unchanged" is a claim that should be visible, not because
this run earns credit for them.

| Invariant | Existing assertion |
|---|---|
| For any provisional registry document, no model is promoted for live routing | `provisionalCannotPromote.test.ts`, `provisionalStillRefuses.test.ts` (R11.7) |
| For any new file under `src/` or `tests/`, a contract and phase are declared in the first 20 lines | AC10 (R17.7) |
| For any entry in any `ops/` template, the value is its own `<ENTRY_NAME>` placeholder | AC09 + `parseEnvTemplate` (R17.8) |
| For any module reachable from the app entry, it is outside `features/benchmark/` and `features/routing/` | existing bundle assertion (R17.9) |
| For any file outside `src/lib/money/`, no `parseFloat` and no `.toFixed(` | harness check (R20.8) |
| For any signal envelope, the forbidden fields are absent and free text is ≤ 120 characters | `envelopeValidation.test.ts` — the field does not exist, so leakage is impossible by construction (R20.4) |
| For any spend row set, one agent's cap decision is independent of the other's | `capIsolation.negative.test.ts` (R20.7) |
| For any server module, none imports `features/benchmark/liveModelCaller.ts` | `liveModelCaller.isolation.test.ts`, with a negative test that breaks the assertion and watches it fire |

### Reporting properties, held by procedure rather than by a test

Three properties govern the report itself. They are universally quantified over run outcomes and are
enforced by the report's fixed shape rather than by an automated assertion, because the report is
authored once at STEP 9 and there is no budget for a fifth test.

1. **For any** run outcome — every combination of pushed/not and observed/blocked rungs — the
   Final_Report contains all eleven prescribed lines in the prescribed order (R24.2, R13.1, R24.4).
2. **For any** BLOCKED line, exactly one blocked step is named **and** the party who owns it is named
   (R23.1, R23.2, R24.5).
3. **For any** rung, the evidence sources it cites are disjoint from those of the rungs below it — which
   is what stops a rung being claimed on the evidence of the rung beneath it (R13.3).

The third is the one that matters most in practice, and it is why each rung's evidence source is named
explicitly in the ladder section above rather than left as "the logs".
