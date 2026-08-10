# PFOS Contract Index

> **Source of truth:** the owner's cloud drive folder `PFOS_Personal_CFO/01_Product_Blueprints`
> (folder id `<PFOS_SOURCE_FOLDER_ID>` - redacted; a storage folder identifier is a deployment
> particular and this repository is public, steering §0b. The identifier lives in the operator's
> environment as `PFOS_SOURCE_FOLDER_ID`, and the ingestion tool fails closed without it).
> **Ingested:** 2026-08-05 by `scripts/ingest/pfos-drive-pull.mjs`, byte for byte, unmodified.
> **Integrity:** every file below carries the SHA-256 of the exact bytes received.
> Re-run the tool to refresh; it reports whether each file changed since the last pull.

These documents are **authoritative product direction**. This repository's own five
build contracts (`contracts/CONTRACT_1..5`) describe what has already been built and
verified. Where the two disagree, the disagreement is recorded in
`docs/PFOS_REPOSITORY_GAP_ANALYSIS.md` and resolved by an owner decision — never by
silently editing either side.

---

## Present contracts (4 of 8 expected)

| # | File | Bytes | SHA-256 (first 16) | Scope it governs |
|---|------|-------|--------------------|------------------|
| 01 | `01_PFOS_Product_Constitution_and_Problem_Solution_Logic.md` | 17,299 | `2763df52cce0648b` | Problem, north star, financial constitution, obligation tiers P0-P3, confidence bands, net-worth views, phases P0-P5, success metrics |
| 02 | `02_PFOS_Data_Architecture_Integrations_and_Security.md` | 18,170 | `47e381d37f1850d1` | Server topology, data-domain separation, ingestion paths, transaction state model, deduplication, drive folder layout, agent/model routing, security controls, phases A-F |
| 03 | `03_PFOS_Financial_Intelligence_Decision_Forecasting_and_Learning.md` | 16,201 | `098ac967ba387038` | Safe-to-spend engine, obligation protection, purchase decision engine, risk engine, forecast engine, debt and capital allocation, net-worth engine, leak and behavioural intelligence, macro engine, evidence packages, decision outcome registry |
| 04 | `04_PFOS_UX_UI_User_Journeys_Research_and_Delivery_Roadmap.md` | 17,072 | `f86c614174450619` | Experience strategy, dashboard layout, seven-section information architecture, chat experience, report formats, six user journeys, screen specs, accessibility, research program, releases R0-R4, MVP acceptance criteria |

Each of the four ends with a machine-executable JSON Schema block (`pfos://contracts/...`).
Those schemas are the strongest available definition of "done" for their area and should
drive future validation code.

---

## Absent contracts (3 of 8 expected still unauthored) — VERIFIED ABSENT, NOT MISFILED

The request named eight contracts. Four of them do not exist anywhere in the drive
account. Three of those four are still unauthored; **06 has since been authored inside this
repository as NIZAM-derived** (see the section below) and is therefore no longer listed here.

| # | Expected file | Status |
|---|---------------|--------|
| 05 | `05_PFOS_Agent_Orchestration_and_Tooling_Contract.md` | **Not found** |
| 07 | `07_PFOS_Testing_Validation_and_Benchmarking_Contract.md` | **Not found** |
| 08 | `08_PFOS_Research_and_Continuous_Improvement_Contract.md` | **Not found** |

**How absence was established** (three independent sweeps, all on 2026-08-05):

1. Recursive walk of the named folder — 4 objects, no subfolders.
2. Recursive walk of the whole `PFOS_Personal_CFO` tree — same 4 objects.
3. Name search across the entire drive account for `PFOS` — 1 folder + the same 4 files;
   plus 19 further keyword sweeps (`Orchestration`, `Tooling`, `Testing`, `Validation`,
   `Benchmarking`, `Database`, `Knowledge`, `Research`, `Improvement`, `Readiness`,
   `Credential`, `OAuth`, `Implementation`, `Architecture`, `Roadmap`, and others).
   Every hit belonged to an unrelated project.

**Corroborating evidence that they were never written:** none of the four present
contracts contains a single forward reference to a contract 05-08. The numbering came
from the request, not from the documents. These are *planned but unwritten*, not lost.

**Why this matters more than a missing file usually would:** contract 05 is the one that
would govern chat-bot orchestration, model routing, tool isolation and credential
handling — the highest-risk surface in the whole product, and the exact surface the
request asks about. Contract 07 would define the test and benchmark bar for financial
correctness. Building either area without its contract means inventing policy for
money movement and third-party data access. The roadmap therefore gates that work.

---

## Also absent: prerequisite / readiness / credential documents

The request also asked for "any newer files concerning prerequisites, human deliverables,
API keys, OAuth, credentials, readiness, architecture, or implementation". **No such file
exists in the PFOS tree.** The keyword sweeps above found matches only in unrelated
projects. Consequently the required-credential list in
`docs/PFOS_HUMAN_DELIVERABLES.md` is *derived* from the security and integration sections
of contracts 02 and 04, and is labelled as derived rather than quoted.

---

## Provenance of every ingested byte

Machine-readable: `contracts/pfos/_INGESTION_MANIFEST.json` (file id, drive version,
modified time, byte count, SHA-256, and whether the content changed since the prior pull).

All four source files were last modified 2026-08-04 within a 19-second window and are at
drive version 2 — a single authoring session, not four independently evolving documents.


## OpenRouter LLM-tier contracts (ingested 2026-08-06 via aki attachment)

Three further PFOS contracts arrived as **aki attachments** (dropped into the SESHA workspace
DROPZONE), **not** via the Drive-folder pull. Ingested byte-for-byte; SHA-256 recorded in
`contracts/pfos/_INGESTION_MANIFEST_OPENROUTER.json`. Synthesis: `docs/PFOS_OPENROUTER_ARCHITECTURE.md`.

| # | File | Bytes | SHA-256 (first 16) | Scope it governs |
|---|------|-------|--------------------|------------------|
| 09 | `09_PFOS_OpenRouter_Phase_1_Benchmark_Calibration.md` | 6,016 | `06851b8ed77a5a02` | Model-selection baseline: ≥210-case PFOS eval set, live pricing refresh (24h TTL), actual-cost scoring, L0/L1/L2 eligibility gates, candidate roster (mimo-v2.5 / glm-5.2 / grok-4.5 / kimi-k3) |
| 10 | `10_PFOS_OpenRouter_Phase_2_Automatic_Task_and_Turn_Routing.md` | 7,557 | `4a593a8ba70374e2` | Runtime routing: T0-T4 task taxonomy, per-tier model chains + cost caps, turn classifier, utility scoring, escalation rules, OpenRouter request controls, per-turn audit |
| 11 | `11_PFOS_OpenRouter_Phase_3_Adaptive_Cost_Quality_Governance.md` | 5,942 | `1a16747838426179` | Closed-loop governance: telemetry (OpenRouter usage as source of truth), promotion/demotion, canary 5→100%, $20-40/mo budget guards, weekly optimizer authority ladder, no autonomous weakening of safeguards |

**Effect on the "Absent contracts" list above.** These three **substantially specify the LLM-tier
surface** that contracts **05 (Agent Orchestration & Tooling)** and **07 (Testing/Validation/
Benchmarking)** would have governed — the highest-risk surface in the product. They do not renumber
or replace 05-08; they are adopted as the **authoritative OpenRouter routing / benchmark / governance
specification**. This lets decision **D6** (`docs/PFOS_HUMAN_DELIVERABLES.md`) be closed by adopting
these three as the LLM-tier contract rather than authoring a new 05 from scratch. The
non-OpenRouter parts of 05/07 remain open. Contract 06 (Database & Knowledge Model) was open at
the time of that note and has since been authored in-repo — see the next section.

---

## NIZAM-derived contracts authored in this repository (06, 12) — IN FORCE, 2026-08-06

**Authorization.** `.kiro/steering/two-agent-vps.md` (IN FORCE, owner-authorized 2026-08-06) §5
requires a contract to exist **before** its area is built, and names exactly these two as the ones
missing for the two-agent server tier. They were authored in Phase 0 of
`.kiro/specs/06-two-agent-vps/` (tasks 0.2 and 0.3) before any code in their area.

**These were not ingested.** They came from no upstream channel — neither the drive-folder pull nor
the aki attachment route — so they appear in **neither** `_INGESTION_MANIFEST.json` nor
`_INGESTION_MANIFEST_OPENROUTER.json`, deliberately. Each carries a `PROVENANCE: NIZAM-DERIVED`
banner in its own first lines naming every input it was derived from. Unlike the ingested contracts,
their integrity record is this repository's git history, not a pinned content hash — they are
expected to evolve here, so no SHA is pinned that would silently go stale.

| # | File | Bytes at authoring | Owning requirements | Scope it governs |
|---|------|--------------------|---------------------|------------------|
| 06 | `06_PFOS_Database_and_Knowledge_Model.md` | 34,327 | R1, R2, R3, R4, R5 (and R6 jointly with 12) | Store topology and per-agent isolation, `finance.db` schema, the money persistence boundary (integer milliunits across the store edge), migrations, the token-spend ledger that supplies `modelPolicy`, the knowledge model, retention, and what may never be stored |
| 12 | `12_PFOS_Two_Agent_VPS_Deployment_and_Operations.md` | 76,544 | R6-R30 and R34 (R6 jointly with 06; R16-R19 extend 09/10/11 rather than replacing them) | Two-agent topology on one host, isolation, the consent bus and what may cross it, transport security and de-duplication, deployment-level model-routing governance, operations (backup, restore, health, rollback, disaster recovery), the kill switch, the human gate register, and the public-repository posture |

Requirement identifiers refer to `.kiro/specs/06-two-agent-vps/requirements.md`.

**Owning-requirement range, reconciled 2026-08-10.** Contract 12's row above read `R6-R24` while the spec
already carried **R25** (the allowlist delimiter, authored with the transport value ledger), so the range had
drifted by one before this increment. Phase 10 then added **R26, R26.1, R27, R28, R29 and R30** - mode-aware
delivery authorization, the six-service environment loader, a Dockerfile per owned image, the finance-agent
process contract, and the firewall/port-binding agreement. The row now reads **R6-R30**, which covers both the
pre-existing drift and the new requirements. **The contract file itself was not edited**: R25-R30 are
requirements of the spec that contract 12 owns, and each records its own authority in place - R25 its decision
note, R26-R30 the owner mandate `KIRO_SHIP_LIVE.prompt.md` rev 2 - so nothing was invented here that the
contract would have to govern. The `<..._IMAGE_REF>` placeholders R28 speaks to, and the single published port
R30 speaks to, are both in `ops/docker-compose.yml` and neither was changed by this increment.

**R34 added 2026-08-10 (task 10.19), so the row now reads `R6-R30 and R34`.** R28 requires an image for every
service this repository owns and R29 requires a process, naming exactly one - the finance agent. The gap
between them is finding **O2**, and it is not a documentation gap: two services are owned here **in library
form**, `ops/docker-compose.yml` gives both agents `depends_on: signalbus: condition: service_healthy`, and so
with every gate observed `docker compose up` still could not stand the phase-1 stack up. R34 states the joint
rule - a service this repository owns has a process, an image recipe, a `BUILT_HERE` row, a boot that refuses
an incomplete environment, an internal-only binding asserted against the process's own listener set, and a
healthcheck command that answers without a listener - so tasks 10.19 and 10.20 are bound by one requirement
rather than by two halves of others. **The contract file itself was not edited**: R34 restates §2.1, §2.2.5,
§2.2.6, §4.1, §4.5 and §7.3 obligations contract 12 already owns, and it deliberately says nothing about the
kill sentinel, because §8.2 names the four services that honour it and a bus publish is halted at the
publisher. The gap at R31-R33 is not an omission of this increment: those identifiers belong to tasks 10.16,
10.17 and 10.18, which are not yet done and will author them.

**R27 is now mechanical rather than documented, 2026-08-10 (task 10.2).** Contract 12 §5.2/§5.3's "no default
for anything" rule, and §3.2.7's one-environment-file-per-service rule, are held in code over **all six**
services the deployment declares rather than over the two agents alone: `src/server/config/environment.ts`
carries a per-service entry-name group for each of `life`, `finance`, `proxy`, `bus`, `scheduler` and `backup`,
refuses a boot naming **every** missing, empty or unsubstituted entry in a single message, and keeps exactly
**one** bridge to the ambient process environment in the whole of `src/`. The entry names are transcribed from
`ops/env/*.env.example` and asserted equal to them, set for set, by test. **Neither contract file was edited,
and no owning requirement range moved** - R27 was already in contract 12's `R6-R30` range recorded above; what
changed is that the disk now does what the requirement says. The §4 cross-file rules the deployment ledger
(task 10.4) will assert are expressible in the same module, which is why they were built with it.

**Steering reconciliation, 2026-08-10 (task 10.1).** The file both contracts are subordinate to gained a
sub-section: `.kiro/steering/two-agent-vps.md` **§2a** carries the standing read-only carve-out - reads against
a live provider with an existing credential are free at the owner's direction; mutations that spend money,
publish a public record, grant a third party access, or create/rotate/destroy a credential remain
owner-in-the-loop - which resolves finding **F11**, and §6 now splits the cross-repo rule along the same line
(a `clone` or `fetch` is a read, a modify or push is a mutation). `.kiro/steering/cloudflare-dns.md` item 3
records the **D-ROTATE** deferral and item 5 cites §2a. **Neither contract file was edited**, and no owning
requirement range moved: the carve-out narrows *when a human is in the loop*, not *what contract 06 or 12
governs*, and every fail-closed rule those contracts rely on is restated unchanged inside §2a.

Both are subordinate to `.kiro/steering/two-agent-vps.md`, and to `money-rules.md` and `drive-db.md`
which nothing overrides. Contract 12 is subordinate to contract 06 wherever it touches the finance
data tier. Neither invents policy that an upstream contract governs; where either had to choose, the
choice is recorded in place with its reason and can be overridden by the owner.

**Filename reconciliation.** The "Absent contracts" table above previously named the expected file
`06_PFOS_Database_and_Knowledge_Model_Contract.md`. The authored file is
`06_PFOS_Database_and_Knowledge_Model.md`, without the `_Contract` suffix. **The index row was
corrected to match the file; the file was not renamed.** Three reasons: the `_Contract` suffix came
from the original request's naming, not from any real document (the same paragraph above records
that "the numbering came from the request, not from the documents"); no present contract in this
directory carries that suffix, so keeping it would make 06 the only inconsistent name; and both
`.kiro/specs/06-two-agent-vps/tasks.md` and contract 12's own source notes already reference the
suffix-free name, so renaming would have required edits in the spec and inside another contract to
fix a name that was never authoritative in the first place.

**Effect on the machine gate.** Acceptance criterion AC12 (`scripts/verify/contract-ledger.mjs`)
reads `contracts/_CONTRACT_INDEX.md` and `contracts/_BUILD_LOG.md` — the original five build
contracts — and **not** this PFOS index. It asserts exactly five contract rows there, so 06 and 12
are deliberately **not** added to that file: doing so would break the check. This index and
`_PFOS_BUILD_LOG.md` are the PFOS-track ledger and are kept mutually consistent by hand; the Phase 0
section of that log records the same two contracts and this reconciliation.

**The owner's fill-in sheet, 2026-08-10 (task 10.3).** Contract 12 §3.2.7's one-file-per-service placement
rule and R23's "every value traces to a human gate" now have a single operator-facing companion:
`.kiro/specs/06-two-agent-vps/OWNER_FILL_IN_SHEET.md` lists all **62** entry-to-file assignments across the
six `ops/env/` files with each entry's gate, its `secret` flag, where the value comes from, one `grep -c`
proof that reports a count rather than a value, and **when** it is needed - `phase 1`, `phase 1 - fill,
unused`, or `phase 2` - so the `longPoll` phasing recorded above is visible per entry instead of as a
footnote. **No contract file was edited and no owning requirement range moved:** the sheet restates nothing
either contract governs, it reads `ENTRY_SPECS`, `SERVICE_ENTRY_NAMES` and the six templates and defers to
`ops/GATE_REGISTER.md` on gate verification in its own header. Three source disagreements it turned up
(**F13** one cap entry over two units, **F14** `restore.sh` requiring five entries no template declares,
**F15** `backup.sh` asserting six of `backup.env`'s twelve) are recorded in the task 10.4 ledger with the
tasks that own their resolution, not reconciled where they were found.

**The deployment value ledger, 2026-08-10 (task 10.4).** Contract 12 §3.2.7 (one environment file per
service, read by no other), §5.2/§5.3 (no default for anything), §6.2 (per-agent cap isolation) and §8 (the
halt in both forms) now have one reference document covering **all six** services rather than the transport
alone: `.kiro/specs/06-two-agent-vps/DEPLOYMENT_VALUE_LEDGER.md` records 62 entry-to-file assignments over 45
distinct entries, the five negative assertions that keep one service from holding another's secret, the full
shared-entry agreement set **with its three deliberate exclusions and their reasons**, and the mandate §3
placement map including the encrypt-then-upload-then-shred ordering and the `age` private key reaching none
of the three destinations. Each asserted rule **cites the loader function that checks it**, and §9 lists
eight rules that are **not** mechanically checked instead of implying they are. **No contract file was
edited, no owning requirement range moved, and no `ops/` artifact was changed** - the ledger reads
`ENTRY_SPECS`, `SERVICE_ENTRY_NAMES`, the six templates, `ops/docker-compose.yml`, `ops/GATE_REGISTER.md`
and the two shell scripts, and defers to the register on gate verification. Findings **F13**, **F14** and
**F15** are recorded there with the tasks that own them (10.10, none - it is correct as it stands, and 10.8
plus 10.9 respectively), and `MAX_CONNECTIONS` (**F2**) has a recommended phase-2 home with nothing applied.

**R26 and R26.1 are now mechanical rather than documented, 2026-08-10 (task 10.5).** Contract 12 §5's transport
guards and §2.3's long-poll fallback are held in code as **one mode axis** rather than as two code paths:
`src/server/telegram/auth.ts` gains `TELEGRAM_MODE_APPLICABLE_GATES`, and `authorizeDelivery` takes the mode as
a **required** input with no default - `webhook` applies configuration, token and allowlist exactly as **R11**
requires, `longPoll` applies the allowlist alone because an outbound-only transport has no header to consult,
and an unrecognised mode falls back to the **full** gate set rather than the empty one. The live adapter
`src/server/telegram/liveTransport.ts` sits behind the **unchanged** `TelegramPort`, takes its whole outside
world as one injected client so nothing resolves a network module, and advances the long-poll read offset **only
after** the accept path's dedup-claim-plus-enqueue transaction has returned - halting the batch at the first
update whose work was not stored, because the offset is monotonic. **No contract file was edited and no owning
requirement range moved** - R26 and R26.1 were already in contract 12's `R6-R30` range recorded above. Two
findings are recorded in the build log with their reasons: **F16**, the accept decision has no reason field by
design, so the durability answer is read from the **audit** path §5.3 already requires rather than by adding one;
and **F17**, a *refused* update must still advance the offset, or any unlisted sender wedges the poller forever.

**Ladder rung L1 is OBSERVED, 2026-08-10 (task 10.6).** Contract 12 §5.2's "the refusal reveals nothing about
which check failed" rule, §5.3's allowlist-before-parsing rule and §5.4's dedup-on-the-pair rule are now
asserted **in both transport modes** by `src/server/telegram/modeAwareGuard.negative.test.ts` (25 tests), and
every case is asserted against the **guarded operation** over a real store rather than against a returned
value - each refusal is checked to have written no dedup claim and no queue row. The `webhook` rows are the
**regression fence** for **R11**: five unusable expected-token shapes times three header states, plus a case
reaching each of the three gates in turn. Both forbidden shapes were introduced and shown to fail the suite -
the naive reuse that applies all three gates under `longPoll` (10 of 25 fail) and the "absent means skip"
relaxation **D1** rejected (4 fence tests fail) - then reverted. **No contract file was edited, no owning
requirement range moved, and no production code changed in that increment**: the tests pass against the guard
exactly as task 10.5 left it, which is the only condition under which a fence means anything.

**R29 is now mechanical rather than documented, 2026-08-10 (task 10.7).** Contract 12 §6.3's agent process and
§8's kill switch existed as *modules* and not as a *process*: `src/server/telegram/index.ts` is a barrel
re-export, and `package.json` had no server framework and no start script - which is precisely why the absence
was easy to miss, since the application logic was complete and tested behind mocks. `src/server/process/` is the
process. `haltGate.ts` holds §8's two forms with their asymmetry made explicit: the **file sentinel is re-read on
every check** and cached nowhere, because an environment variable cannot be flipped without a restart and a halt
that needs a restart is not a halt; `NIZAM_KILL_ALL` is read **once at boot** because that is the only moment its
value can change; a switch whose position cannot be read - an unrecognised value, or a probe that threw - is
treated as **engaged**. `financeAgent.ts` adds the three behaviours a module cannot have: it calls the six-service
aggregate refusal **first and catches nothing**, so an incomplete environment is a non-zero exit rather than a
degraded run; it gates exactly R29's three activities (model call, model-path write, bus publish) and gates
**nothing else**, so R17's deterministic obligation alert has no gate to fail; and it binds a listener **only** in
`webhook`, on `FINANCE_CONTAINER_PORT` alone, leaving `listeningPorts` empty under `longPoll` by construction
rather than by unbinding afterwards. **No contract file was edited and no owning requirement range moved** - R29
was already in contract 12's `R6-R30` range. **No dependency was added:** steering §1 permits Fastify or Hono,
and neither was taken, because `acceptHandler` is typed synchronous and single-route so the platform's own
`node:http` covers the whole listening surface. Two findings are recorded in the build log with their reasons:
**F18**, no module derives `TurnFacts` from a provider body yet, so the facts reader is an injected dependency and
the process supplies the conservative reader that classifies every turn `T0` - fail-closed, and it spends nothing;
and **F19**, the bot identity is a process **argument** rather than an environment entry, because no template,
`SERVICE_ENTRY_NAMES` row or value-ledger row declares it.

**R17's per-agent half is now mechanical, and F13 is resolved, 2026-08-10 (task 10.10).** Contract 06 §6.2.3's
"a cap decision is scoped to one agent and never aggregated" was held by `weeklySpend`'s row filter, but the
**companion** was missing: nothing in code expressed **D-CAP** - a hard weekly ceiling **in total**, met by two
per-agent halves - nor the relation between the halves and the total. `src/features/routing/agentWeeklyCaps.ts`
adds it. `WEEKLY_BUDGET_USD` in `modelPolicy` **stays as the total** and is not re-scoped, because it is what
contract 11's governance fractions are measured against and halving it would silently turn each of them into a
per-agent fraction; the total is expressed once in the ledger's integer micro-USD by **deriving** it from that
constant, so the two can never disagree. The per-agent half is derived from the total and the agent count, and an
**inexact** split is refused rather than rounded in either direction - rounding down strands authorised budget,
rounding up hands out more than the total. `assertCapsWithinTotal` refuses a cap set that sums above the total
rather than scaling it to fit, and never raises the total to accommodate it. `decideAgentCaps` returns one decision
per agent with **no field spanning both**, and `deterministicAlertsProduced` is typed `true`, so a build that made
exhaustion suppress an obligation alert would not compile. **F13 is resolved on this side of the boundary**: the
ledger-facing integer (`LEDGER_WEEKLY_CAP_ENTRY`) and the provider-facing decimal
(`PROVIDER_KEY_LIMIT_PLACEHOLDER`) now have **distinct names**, the provider form is decimal **text** rather than a
number so no limit-named field holds a decimal (AC07), and one tested function each way carries the value between
them with no `parseFloat`, no `.toFixed(` and no rounding - more precision than micro-USD can hold is refused.
**`ops/GATE_REGISTER.md` was not edited** - it outranks this module on gate verification - and the one-line change
its G4 step would need is recorded in the build log as a recommendation for the owner. **No contract file was
edited and no owning requirement range moved.**

**R28 and R30 are now mechanical, O1 is recorded rather than closed by pretence, and F12 is resolved,
2026-08-10 (task 10.8).** Contract 12 §2.1 names six services and §10.1 injects every image reference, and
the tree held **zero** build recipes - finding **O1**, whose consequence is that after all eight gates clear
`docker compose up` still could not run. R28 is met by an honest **record** rather than by six recipes:
`ops/IMAGE_BUILD.md` accounts for every reference in one of three states, and `src/server/ops/imageOwnership.ts`
reads that record against the topology, against `.nvmrc` and against the recipes on disk on every test run,
in **both** directions - a reference with no row, a row for a reference nothing runs, a recipe a row names and
the tree lacks, and a recipe the tree holds and no row claims are each a finding. `ops/images/finance-agent/Dockerfile`
is the one image this repository owns: pinned to the runtime major `.nvmrc` names, ending on an unprivileged
`USER`, installing the readiness command `healthProbe.ts` exports so **R22**'s healthcheck names something
that exists, and carrying no `EXPOSE`, no `HEALTHCHECK` and no configuration default - the last because a
default in an image turns **R27**'s refused boot into a guessed one. A root `.dockerignore` keeps the untracked
secret material, the local environment files and the browser bundle out of the build context, which
`.gitignore` cannot do because a builder does not read it. **`OWNED_BUILD_PENDING` is a state R28 did not
anticipate** and it is recorded rather than avoided: R28's ownership axis is binary, and three references are
owned here **in library form** with no process to package, so a row in that state must name the task or
finding that closes it. **F12 is resolved on TLS-ALPN-01 on `<TLS_PORT>` alone**, on the owner's speed
criterion: every artifact except one line of the register was already in that posture, so the alternative cost
four coordinated edits and a permanently wider public surface for a challenge nothing needs.
**`ops/GATE_REGISTER.md` WAS edited, once and only at the certificate-challenge line inside G1**, because R30
requires the resolution recorded in that file and this resolution makes the advice that line carried wrong -
no gate was renumbered, removed, reopened or restated, no verification line softened, no `Status:` moved and
no box ticked. The R30 cross-artifact assertion is **neutral about which resolution was chosen**: it reads the
challenge the register names and requires the bindings and the proxy configuration to match **that** one, and
a test drives the rejected resolution through it to show it would have been held just as tightly. It also
compares the firewall allowance the register records against the host ports the topology publishes, excluding
the administrative port, which is R30's literal assertion. Separately, the phase-1 posture task 10.0 found
resting on an operator convention is now a **property of `ops/docker-compose.yml`**: `caddy`, the only service
with a `ports:` key, carries a `profiles:` entry, and `src/server/ops/composeTemplate.ts` asserts both
directions of it. **No contract file was edited and no owning requirement range moved** - R28 and R30 were
already in contract 12's `R6-R30` range. **The other repository was not touched**, no image was built, no tag
resolved, no registry contacted and no outbound call made.

**The owner's gate walkthrough, 2026-08-10 (task 10.11).** Contract 12 §9's human gate register states what
each gate requires and how it is verified; what it does not do is walk one person through the subset that is
open, in order, in one sitting. `.kiro/specs/06-two-agent-vps/OWNER_GATE_ACTIONS.md` is that walkthrough -
**G1**, **G3 placement only** (both bots exist and were verified live, so creation is the finished half),
**G4**, **G5**, **G8** - each with its purpose in a sentence, its commands in order, and its verification
block **copied from `ops/GATE_REGISTER.md`** rather than reinvented, followed by the reminder that the
observation is recorded and never the value (**R24**). It names task 10.3's `OWNER_FILL_IN_SHEET.md` in its
first lines as the **value reference** and itself as the **gate walkthrough**, so the two are not confused and
the 62 entry-to-file assignments are referenced rather than duplicated. The order is the register's dependency
order, and the reason is stated: four gates end by writing a secret into `/etc/<CONFIG_DIR>`, which only G1
creates. **F13 is carried where a wrong number would otherwise boot successfully** - G4 leads with a two-row
unit table, decimal USD text for the provider's `limit` against integer micro-USD for the ledger entry, and
flags the register's own `<FINANCE_WEEKLY_CAP>` interpolation as the one place the owner supplies the decimal
reading, since the register outranks `agentWeeklyCaps.ts` on gate verification. **D-G5** is stated as the
consequence rather than the label (a Testing screen's seven-day token kills the unattended uploader silently
on day eight) and **D-ROTATE** appears only as a ground rule with its `getWebhookInfo` compensating control -
there is no rotation step. **G2 and G6 are named DEFERRED with the reason** (phase 1 is `longPoll`: no domain,
no DNS, no certificate, no public port, no proxy) and **G7 as CLOSED - WONT-DO**, so the owner does not go
looking for them. Four findings are reported rather than invented: G1 step 5 has **no verification line**
while every other G1 step does; G4 step 3's opt-out check is a console observation, not a runnable command; G5
step 1 has no command in this repository; and the walkthrough **cannot close end to end today**, because
`BACKUP_FOLDER_REF` and G8's drill wait on the uploader task 10.9 owns, and because with every gate observed
`docker compose up` still cannot stand the stack up - `<BUS_IMAGE_REF>` and `<SCHEDULER_IMAGE_REF>` are
`OWNED_BUILD_PENDING` (**O2**) and `finance-agent` declares `depends_on: signalbus: service_healthy`, so
**L2 and L3 are blocked on this repository, not on the owner**. **No contract file was edited and no owning
requirement range moved.** `ops/GATE_REGISTER.md` was **not** edited - no gate renumbered, removed, softened or
reopened, no `Status:` moved, and no box ticked anywhere but `10.11`'s own line. No gate step was performed, no
network call made, and the other repository was not touched.

**The consent bus has a process and an image, and O2 is half closed, 2026-08-10 (task 10.19).** Contract 12 §4
gives the bus an envelope schema with no field for a figure, a validator that runs on write and again on read,
two independent consent gates, and an append-only store with an audit mirror - all of which existed here and
were tested - and §2.2.5/§2.2.6 give it an internal-only binding. What did not exist was a **process**: nothing
listened on the endpoint the two agents dial, which is finding **O2** and is why `ops/IMAGE_BUILD.md` had to
carry `<BUS_IMAGE_REF>` in the third state R28 did not anticipate. `src/server/process/busServer.ts` is that
process, in the shape task 10.7 established: it refuses to boot on an incomplete environment through the one
`requireServiceEnvironment` pass, naming all three bus entries in a single message (**R27**); it binds the port
`BUS_INTERNAL_ENDPOINT` names and **only** that one, with a listening boundary that takes a port and offers no
host argument and no publish flag; it enforces the envelope schema on every write and the consent gate on every
read by **calling** Phase 3.1's and Phase 3.2's modules rather than restating a single field rule; and it
answers readiness as an exec check computed against local state, so no listener is needed for the healthcheck
(**R22**). **It adds one guard of its own and nothing else:** `BUS_INTERNAL_ENDPOINT` is refused if it names a
scheme, a path, an address literal, a wildcard, a name that resolves to the container itself, or a port outside
the protocol's range - each of which is a way the bus ends up reachable where **R9** forbids it, or unreachable
by its only two clients. The R9 absence is asserted against the **process's own listener set** and the injected
host's own bind record, in both directions, plus the topology's absent `ports:` key read through the existing
compose parser - never by probing a socket, because a socket that answers nothing is also what a crashed
listener looks like (delta **D6**, applied a second time). `ops/images/signal-bus/Dockerfile` packages it with
the same properties the audit already held the finance recipe to, and `ops/IMAGE_BUILD.md`'s row moved from
`OWNED_BUILD_PENDING` to `BUILT_HERE` with its recipe path and no blocker (**R28**). **Two absences are recorded
rather than filled:** the bus honours no kill sentinel, because §8.2 names four services and a publish is halted
at the publisher - shown by a test in which a halted `publishSignal` never reaches this store - and the bus
emits no log line, because `redactedLogger.ts` binds a line to a spend identity the bus does not have and its
own append-only audit mirror is the stronger record. **No contract file was edited.** No image was built, no tag
resolved, no registry contacted, no stack started, no port published and no outbound call made;
`ops/GATE_REGISTER.md` was not edited and no box was ticked anywhere but `10.19`'s own line.

**The finance agent's readiness command can now report ready, and the liveness rule lives in one place,
2026-08-10 (task 10.21).** Contract 12 §7.3 requires ACTUAL readiness and forbids a success returned merely
because a process is running; `main.ts`'s `runHealthCommand` obeyed the letter of that and failed its purpose,
because it called `runProbe` with **no probe environment**, leaving `queueWorkerAlive` absent and therefore
answering `queue_worker_not_reporting` on every invocation. The command **always exited 1**, it had no test, and
`ops/docker-compose.yml` gives both `caddy` and `scheduler` a `depends_on` on this service reporting healthy - so
one line held the whole phase-1 stack at unhealthy for ever. The fix is task 10.19's mechanism, **shared rather
than copied**: `src/server/process/liveness.ts` now holds the record shape, the one freshness rule and the
file-backed factory, `busServer.ts` keeps `BusHeartbeat`/`heartbeatIsFresh` as its own names over that rule, and
the bus's tests passed unmodified. Each service supplies only its own file name and its own staleness window, and
the rule takes the window as a required argument so nobody inherits one silently; the finance window is wider
because this agent's iteration performs a long-poll read before it drains, which is a fact about the loop rather
than a preference. The agent writes the record at boot, at the top of every iteration and inside every drain, and
**clears it on shutdown**, so a stopped agent answers not-ready at once. Every ambiguity stays closed: absent,
stale, and a record dated in the **future** all read as not ready, and an unconfigured store answers not-ready
rather than throwing. **R9 remained asserted in both directions either side of a ready answer** - the process's
own listener set and the injected host's bind record are both empty under `longPoll` - because readiness is a
command and not an endpoint. **No contract file was edited, and nothing under `ops/` changed**: the topology's
healthcheck declaration was already correct; what it resolved to was not. `ops/GATE_REGISTER.md` was not edited
and no box was ticked anywhere but `10.21`'s own line.

**The scheduler has a process and an image, O2 is fully closed, and R34 is met for both services it named,
2026-08-10 (task 10.20).** Contract 12 §2.1 gives the topology six services and tick delivery belongs to this
repository; no process performed it, which is finding **O2**'s other half and why `ops/IMAGE_BUILD.md` carried
`<SCHEDULER_IMAGE_REF>` in the third state R28 did not anticipate. `src/server/process/scheduler.ts` is that
process: one boot refusal naming every incomplete entry at once (**R27**), the halt gate **reused whole** in both
forms with the sentinel re-read per tick and an unexaminable switch treated as engaged (**R29**), both tick
endpoints parsed by the bus's own rule - which moved to `internalEndpoint.ts` and is now shared, with all eight
declared refusals exercised and each shown stopping the boot - and a bounded doubling backoff so a failed tick is
abandoned for that tick only rather than becoming a crash loop. **R9 is asserted in both directions**: an
always-empty `listeningPorts` with no writer, an injected host whose bind record stays empty, and a real host whose
`listen` half **refuses**. **The one place the bus's shape did not transfer is readiness**, because this service
mounts no store: §3.2.2 permits it a read-only cross-store view and it declines, so three of §7.3's four facts are
meaningless for it rather than unavailable. `healthProbe.ts` therefore gained a third **mode** - `storeless`, in
which the three store checks are `not_applicable` and the loop check stays applicable, with **no command-line
route to it** so a service that has a store cannot skip its own checks - and the liveness record lives in the
platform's temporary directory, which works because an exec healthcheck runs in the service's own container. Its
staleness window is derived from the configured cadence rather than fixed, since the period is the operator's
choice. `ops/images/scheduler/Dockerfile` packages it and the record row moved to **`BUILT_HERE`** with a build
invocation naming recipe and reference on one statement; `<BACKUP_IMAGE_REF>` is now the only row still pending,
blocked on a missing uploader rather than a missing process. `SCHEDULER_TICK_INTERVAL` is read in **whole
seconds**, a decision recorded because no artifact declared the unit, and stated on the entry's own line in
`ops/env/scheduler.env.example`. **No contract file was edited.** No image was built, no tag resolved, no registry
contacted, no stack started, no port published, no tick delivered and no outbound call made;
`ops/GATE_REGISTER.md` was not edited and no box was ticked anywhere but `10.20`'s own line.

**The phase-1 start no longer waits on a service phase 1 does not run, and the selection is written down,
2026-08-10 (task 10.22, R35).** Owner ruling, recorded rather than proposed. `ops/docker-compose.yml` gave
`scheduler` a `depends_on: life-agent: condition: service_healthy`, and under the authorised option **(b)** the
life agent stays created and **idle** - so a bare start waited for ever and naming the scheduler dragged the life
agent in with it. The owner's reasoning is what makes relaxing it safe rather than convenient: a tick to an absent
agent is **already** an abandoned delivery with a bounded backoff rather than a crash (task 10.20 built that), so
the condition bought a start-up wait and no safety property. The `finance-agent` condition stays, so the
relaxation cannot pass by the scheduler waiting for nothing; `caddy` keeps its own life dependency because it is
phase 2 and profile-gated and therefore costs phase 1 nothing. **R35 is written over the class, not the
instance**: no service phase 1 starts may declare a start dependency on a service phase 1 does not start, asserted
by `src/server/ops/composeTemplate.ts` with a vacuity guard first - a phase-1 name the template does not declare
is itself a finding, because otherwise the rule would apply to nothing. The selection task 10.20 found written
**nowhere** is now the command in `ops/IMAGE_BUILD.md` with the reason for each of the three absences, held as data
in `PHASE_ONE_SERVICES`, and read back out of the document by `phaseOneServicesNamedIn` so prose and code cannot
drift. `OWNER_GATE_ACTIONS.md` step 4 was wrong as written and names the three services now. **No contract file
was edited**, no image built, no stack started, no port published, `ops/GATE_REGISTER.md` untouched and no box
ticked but `10.22`'s own.

**The application is reachable by the owner alone, over the tunnel they already hold, 2026-08-10 (task
10.18, R33).** The static build had nowhere to be read from on the host. It is now served by a **mode** of
the finance agent's own process (`--serve-app`), not a seventh service - and that is not a saving, it is the
only thing that works: a container's loopback is not the host's loopback, so a compose service would have
had to **publish a port** to be reachable from the tunnel at all, which phase 1 forbids, and the built
bundle is deliberately kept out of the image. So `ops/docker-compose.yml`, the six environment templates,
`SERVICE_ENTRY_NAMES`, the value ledger and the fill-in sheet are all **unchanged**. **Loopback is
structural, not configured**: there is no entry and no flag through which a bind address can be expressed,
the process passes a constant, and the listener host applies `requireLoopbackBind` to whatever it is handed
- so a caller inside the tree cannot widen it either. Nine refusals are shown stopping the bind, including
an **empty** host, because the platform reads an absent host as *every interface*, and a **name**, because
resolution is configuration this process does not own. **No authentication was added, and that is the
stronger posture** - the argument §2.2.6 makes for the bus: a password protects a port that stays reachable
while it is attacked, and it is a secret with a lifecycle on a public repository. Serving is reads only -
two methods, the body drained and never read, no store import at all - and every path goes through the ONE
containment guard, so an escape answers with the same status as an absent file and confirms nothing.
Readiness is the `storeless` mode over the **shared** liveness record and additionally requires a bound
port. **No sentinel entry was invented**: §8.2 names four services and this is none of them, §8.1's three
halted activities are absent here, and §8's own rule that a halt never disables a deterministic view means
refusing a read-only view under a halt would make the halt harmful. `ops/APP_ACCESS.md` records the
decision, the three rejected alternatives, the threat model **including what it does not defend against**,
and what phase 2 changes - which is nothing, unless the owner decides it explicitly and it is recorded
first. **No contract file was edited**, no port bound, no stack started, `ops/GATE_REGISTER.md` untouched
and no box ticked but `10.18`'s own.

**The test ladder was RUN, and finding F20 is now the top blocker to a bot that answers, 2026-08-10
(task 10.12).** Mandate §9's rungs L0 and L1 are `OBSERVED` with the command and the return recorded in
`.kiro/specs/06-two-agent-vps/LIVE_PROGRESS.md`: L0 through the **real entrypoint in its own child
process** (`node scripts/ladder/l0-config.mjs`), breaking **four** entries at once because a
first-failure loader would pass the single-entry version of that rung, and observing one aggregate that
names all four under three different codes with a non-zero exit, then the boot proceeding once they were
restored; L1 by running task 10.6's existing 25 tests rather than writing new ones (`25 passed`).
**F20:** bare `node src/server/process/start.ts` cannot start at all — every relative import under
`src/` is extensionless, which `moduleResolution: "bundler"`, Vite and Vitest all resolve and Node's own
ESM resolver does not — so all three owned images' `ENTRYPOINT`, all four `--health` commands, the
restore drill's probe and both `package.json` scripts are unrunnable as written, and rung **L2 is blocked
on THIS repository rather than on the owner**: with every gate observed, the stack would still stand up
nothing. It was invisible because tasks 10.7, 10.19, 10.20 and 10.21 proved those processes through
Vitest, which imports through the project's resolver — the logic, never the launch. It is recorded and
deliberately **not** repaired in this increment, because the repair is a packaging decision touching the
three Dockerfiles, `ops/IMAGE_BUILD.md`, `package.json` and possibly every module under `src/`, and it
deserves its own task and tests. `scripts/ladder/ts-resolve.mjs` restores **exactly** the one resolution
the toolchain performs, and nothing else, so the rung F20 blocks was still observable. **No contract file
was edited**, `ops/GATE_REGISTER.md` untouched, no gate ticked, nothing steering §2 gates was run, and no
test was added — the deliverable is an observation. Floor stays **2126** against a real 2126.

**R31 is authored and the two agents now have ONE document to agree on, 2026-08-10 (task 10.16).** The
owner's clarification settles the scope: "clone and migrate both repositories" means *making the two
understand each other*, not a code migration and not a repository move — so `ops/INTEROP_CONTRACT.md` is
the deliverable and no git operation is. The test applied to every sentence was whether the other side
could act on it **with no access to this tree**, because the life agent is authored in a session opened on
the other repository by a reader who cannot resolve an import into this one. So the eight envelope fields,
the three payload keys, the two forms and their single difference, all 24 validation reason codes, the
four consent-by-absence rules, the query's four keys, both response shapes, the eleven protocol refusals
with their statuses and the eight endpoint refusals are **written out** rather than referred to. Four
things are stated because a reader would otherwise get them wrong: **absent is not filtered** (a filter
can be forgotten on a new path, an absent field cannot be populated on any path); a **refusal is not an
empty list**; **every kind is `producer_only` today** because the widening list is empty, so a
cross-agent read is refused right now and that is the fail-closed starting position rather than a defect;
and **the bus authenticates nothing**, under a heading that says not to fix it with a credential, with
the three reasons one would be worse — the §2.2.6 argument restated where the person tempted to undo it
will be reading. `strict_local_maximum` is recorded as excluded **twice**, the binding one being that the
classification is not a member of the `tier` enum. The three `ops/nizamcore-patches/` items are named as
**change specifications and not applicable diffs**, and the read-only clone at an ignored path is recorded
as permitted with modify and push owner-gated — nothing was cloned, fetched or read. **No contract file
was edited**, `ops/GATE_REGISTER.md` untouched, no gate ticked, no test added; floor stays 2126.
