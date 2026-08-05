# PFOS Contract Index

> **Source of truth:** the owner's cloud drive folder `PFOS_Personal_CFO/01_Product_Blueprints`
> (folder id `1w4ekuw9rSXktm2NO8rJL65YXUA--W0Tm`).
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

## Absent contracts (4 of 8 expected) — VERIFIED ABSENT, NOT MISFILED

The request named eight contracts. Four do not exist anywhere in the drive account.

| # | Expected file | Status |
|---|---------------|--------|
| 05 | `05_PFOS_Agent_Orchestration_and_Tooling_Contract.md` | **Not found** |
| 06 | `06_PFOS_Database_and_Knowledge_Model_Contract.md` | **Not found** |
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
