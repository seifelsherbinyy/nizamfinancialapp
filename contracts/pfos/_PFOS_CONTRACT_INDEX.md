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
| 12 | `12_PFOS_Two_Agent_VPS_Deployment_and_Operations.md` | 76,544 | R6-R30 (R6 jointly with 06; R16-R19 extend 09/10/11 rather than replacing them) | Two-agent topology on one host, isolation, the consent bus and what may cross it, transport security and de-duplication, deployment-level model-routing governance, operations (backup, restore, health, rollback, disaster recovery), the kill switch, the human gate register, and the public-repository posture |

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
