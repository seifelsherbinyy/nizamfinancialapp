# PFOS Contract 05 — Agent Orchestration, Skill Execution, and Knowledge Integration

> **Status:** NIZAM-derived. Authored 2026-08-18 to govern the ungoverned surface identified
> in `_PFOS_CONTRACT_INDEX.md`. The owner-side document 05 was never written; this contract
> fills the gap and is authoritative until the owner authors a superseding document.
>
> **Scope:** This contract governs how the two Telegram agents (myNIZAM / financeNIZAM)
> consume knowledge, load multi-domain memory, read external repositories, score readiness,
> and execute skills. It does not govern model routing (contracts 09-11), database schema
> (contract 06), or Telegram webhook operations (contract 12).
>
> **Money rule:** This contract never defines or computes money. All monetary values are
> integer milliunits produced by the deterministic engine (contract 03). Nothing in the
> agent orchestration or knowledge layer may override that.

---

## §1 Problem and north star

### §1.1 Why this contract exists

The Hermes gateway (contract 12) defines two isolated agent profiles — `nizam` (myNIZAM)
and `pfos` (financeNIZAM). Those profiles route Telegram messages through model tiers and
enforce spend caps. What they do not define is *what the agents know* — the structured
memory they carry into each turn, where that memory comes from, and how complete it is.

Without a knowledge integration contract, each agent invents answers. With it, each agent
applies the owner's own data — journals, transactions, bank statements, personas, goals,
health records — as grounded evidence. The goal is ≥ 90% readiness: a score that means
the agent can answer queries about the owner's life and finances from real indexed data,
not hallucination.

### §1.2 North star

Both agents reach ≥ 90% readiness score when all data types they are responsible for
have at least one indexed document in the knowledge tier. Readiness degrades gracefully
when data is unavailable (Drive not connected, GitHub not configured) — it never
fabricates data to look ready.

---

## §2 Agents and their knowledge domains

### §2.1 myNIZAM (`nizam` profile)

myNIZAM is the life-context agent. It holds the owner's complete picture.

| Domain | Folder role | Privacy class | Reaches model |
|--------|-------------|---------------|---------------|
| `persona` | `personas` | `cloud_allowed` | yes |
| `goal` | `goals` | `cloud_allowed` | yes |
| `life_context` | `operational` | `cloud_allowed` | yes |
| `journal` | `journal` | `local_only` | **no** |
| `health` | `health` | `local_only` | **no** |
| `financial` | `financial` | `cloud_allowed` | yes |
| `transaction` | `transactions` | `cloud_allowed` | yes |
| `statement` | `statements` | `cloud_allowed` | yes |
| `contract` | `contracts` | `cloud_allowed` | yes |
| `operational` | `operational` | `cloud_allowed` | yes |

Journal and health data is indexed locally and available for the agent's context but
**never sent to the model provider** (contract 12, `drive-db.md`).

### §2.2 financeNIZAM (`pfos` profile)

financeNIZAM is the financial intelligence agent. It is deliberately narrower.

| Domain | Folder role | Privacy class | Reaches model |
|--------|-------------|---------------|---------------|
| `transaction` | `transactions` | `cloud_allowed` | yes |
| `statement` | `statements` | `cloud_allowed` | yes |
| `financial` | `financial` | `cloud_allowed` | yes |
| `contract` | `contracts` | `cloud_allowed` | yes |
| `operational` | `operational` | `cloud_allowed` | yes |

financeNIZAM does **not** index or serve `journal`, `health`, `persona`, or `goal` data.
Those domains are excluded by the `pfos` profile's `allowedDomains` list.

---

## §3 Knowledge classes

### §3.1 Extended class set

This contract extends the knowledge tier (contract 06, §A4) with new classes required
for ≥ 90% readiness. Every class addition must have a corresponding `KNOWLEDGE_SOURCE_RULE`
with a non-overlapping `referencePattern`.

| Class | Domain | Description |
|-------|--------|-------------|
| `recovery_plan` | `financial` | Owner's staged financial recovery plan (ordered set — existing) |
| `financial_research` | `financial` | Research documents informing financial decisions (existing) |
| `agent_contract` | `contract` | Governing contracts for the product (existing) |
| `architecture` | `operational` | System architecture decision records (existing) |
| `transaction_history` | `transaction` | Bank/card transaction exports (CSV, JSON, XML) |
| `bank_statement` | `statement` | Monthly/period bank account statements |
| `persona` | `persona` | Owner persona documents — identity, values, habits, goals summary |
| `journal_entry` | `journal` | Owner journal entries (local only, never sent to model) |
| `health_record` | `health` | Health metrics, recovery scores, biometric snapshots (local only) |
| `goal` | `goal` | Explicit owner goals — financial, personal, career, health |
| `life_context` | `life_context` | General life context — biography fragments, preferences, decisions |
| `github_content` | `operational` | Content pulled from authorised GitHub repositories |

### §3.2 Classification refusal

A document whose reference matches no declared rule is **reported as unclassified, never
filed under a default class**. This is property A4.1 from contract 06 and is preserved
by all new rules.

### §3.3 Pattern non-overlap requirement

Each new rule's `referencePattern` must not match references already claimed by existing
rules. The recovery plan pattern (`/recovery\/[^/]+\.md$/i`) is checked first and takes
priority per the rule-order guarantee in `knowledgeIndex.ts`.

---

## §4 Drive folder roles

### §4.1 New roles

This contract adds four new `DriveFolderRole` values:

| Role | Domain | Privacy class | Notes |
|------|--------|---------------|-------|
| `transactions` | `transaction` | `cloud_allowed` | Raw transaction exports |
| `statements` | `statement` | `cloud_allowed` | Bank account statements |
| `personas` | `persona` | `cloud_allowed` | Persona and identity docs |
| `goals` | `goal` | `cloud_allowed` | Goal tracking documents |

These are added to `DRIVE_FOLDER_ROLES` and `DRIVE_ROLE_POLICY` in
`src/server/ingest/driveEvidencePacket.ts`.

### §4.2 Folder identifier constraint

No folder identifier (Google Drive folder ID, path string, or canonical name) is stored
in any tracked file. Folder IDs are deployment particulars and live in the operator's
environment (`KNOWLEDGE_DRIVE_ROOT_ID`, profile-specific sub-folder env entries).

---

## §5 GitHub read port

### §5.1 Capability scope

The GitHub port is a **read-only** interface. It may fetch file contents and list
directories. It may not create files, open pull requests, or write to any repository.

### §5.2 Credential handling

GitHub access requires a Personal Access Token (PAT). The PAT is:
- Loaded from environment entry `GITHUB_PAT` by `githubEnvironment.ts`
- Wrapped in a `GitHubSecret` (the same opaque-reveal pattern as `KnowledgeSecret`)
- Never stored in any tracked file
- Never logged or serialised
- Never committed to the repository

### §5.3 Repository allowlist

The list of authorised repositories is loaded from `GITHUB_REPOS` (comma-separated
`owner/repo` specs). An empty list means GitHub capability is absent (the agent still
boots offline). A partial configuration (PAT present, repos absent or vice-versa) is
refused — the same fail-closed pattern as `knowledgeEnvironment.ts`.

### §5.4 Port interface and mock

`src/server/ports/github.ts` defines:
- `GitHubPort` — the injected interface
- `createMockGitHubPort()` — a deterministic mock that returns synthetic fixtures

The live adapter is in `src/server/ingest/githubKnowledgeClient.ts` and depends on the
injected `GitHubPort`. The production wiring injects the real adapter; tests inject the
mock.

### §5.5 Content classes

GitHub content is classified as `github_content` for all paths. It is not sub-classified
by file type at this contract level. A future contract revision may add sub-classification
(e.g., `github_schema`, `github_workflow`) if the need arises.

---

## §6 Readiness metric

### §6.1 Definition

Readiness is a score from 0 to 100 computed per profile from the document index.
It answers: "what fraction of the data types this agent is responsible for are indexed?"

### §6.2 Scoring formula

```
readiness = sum( weight_k * min(count_k / threshold_k, 1.0) ) * 100
```

Where:
- `weight_k` is the declared weight for class `k` (weights sum to 1.0 per profile)
- `count_k` is the number of indexed documents in class `k`
- `threshold_k` is the minimum document count to receive full weight for class `k`
  (default: 1 for all classes; a class with 1+ document receives its full weight)

### §6.3 Weights — myNIZAM (`nizam`)

| Class | Weight | Threshold |
|-------|--------|-----------|
| `transaction_history` | 0.20 | 1 |
| `bank_statement` | 0.15 | 1 |
| `persona` | 0.20 | 1 |
| `goal` | 0.15 | 1 |
| `journal_entry` | 0.10 | 1 |
| `health_record` | 0.10 | 1 |
| `life_context` | 0.05 | 1 |
| `agent_contract` | 0.05 | 1 |

### §6.4 Weights — financeNIZAM (`pfos`)

| Class | Weight | Threshold |
|-------|--------|-----------|
| `transaction_history` | 0.30 | 1 |
| `bank_statement` | 0.20 | 1 |
| `financial_research` | 0.15 | 1 |
| `agent_contract` | 0.15 | 1 |
| `github_content` | 0.10 | 1 |
| `architecture` | 0.10 | 1 |

### §6.5 Readiness report fields

The `AgentReadinessReport` interface (in `agentReadiness.ts`) must carry:
- `profile` — the profile name
- `score` — 0 to 100 (integer)
- `breakdown` — per-class `{ class, weight, count, contribution }` array
- `readinessLevel` — `'not_ready' | 'partial' | 'operational' | 'full'`
  - `not_ready`: score < 30
  - `partial`: 30 ≤ score < 60
  - `operational`: 60 ≤ score < 90
  - `full`: score ≥ 90
- `blockers` — classes with weight > 0 and count = 0 (what is missing)
- `drivenByDrive` — boolean: whether Drive config is present
- `drivenByGitHub` — boolean: whether GitHub config is present

### §6.6 Readiness does not fabricate

A score of 0 when no data is indexed is correct and expected. The system never generates
synthetic indexed documents to inflate readiness. A score under 90 is reported honestly
and points the owner to what to provide.

---

## §7 Profile memory loader

### §7.1 Boot sequence

On startup, each agent profile may call `loadProfileMemory()` to build a `GroundedContext`
from the knowledge index. The boot sequence:

1. Query the document index for all rows in the profile's allowed classes
2. For each row, retrieve or reconstruct the evidence item
3. Apply the boundary rules (`canProfileRead`, `canSendToCloud`) from `knowledgeBoundary.ts`
4. Return the `GroundedContext` with model-eligible items and local-only counts

The memory loader does not fetch new data from Drive or GitHub. It reads the existing
index. Fetching is the responsibility of the separate ingestion workers.

### §7.2 Context size limits

The `loadProfileMemory()` function accepts a `limit` parameter (default: 50 items).
Evidence items are sorted by `observedAt` descending (newest first) before truncation.
The caller is responsible for respecting model context window limits — this layer
applies no token counting.

### §7.3 Empty context

An empty document index returns an empty `GroundedContext` with `modelEligible: false`.
This is correct and expected on a fresh installation. The agent must degrade gracefully
rather than refusing to boot.

---

## §8 Tool extensions

### §8.1 Knowledge tools

This contract adds two knowledge-specific tool names:

| Tool | Profile | Description |
|------|---------|-------------|
| `knowledge.read_github_content` | both | Read a file from an authorised GitHub repository |
| `knowledge.load_profile_memory` | both | Load the indexed evidence for the current profile |

These are added to `HERMES_TOOL_NAMES` and `HERMES_TOOLS_BY_PROFILE` in `toolBoundary.ts`.

### §8.2 Tool permission

Both tools are read-only. `knowledge.read_github_content` requires GitHub config to be
present; it returns an error if GitHub is not configured rather than throwing.
`knowledge.load_profile_memory` always succeeds (returns empty context on an empty index).

---

## §9 Drive scope constraint

This contract does not change the `drive.file` scope constraint from `drive-db.md` and
contract 12. The Drive knowledge client reads only files that the owner has explicitly
shared with the application or that the application created. Broader Drive enumeration
requires explicit owner authorisation and a policy amendment by the owner.

To reach ≥ 90% readiness, the owner must:
1. Complete OAuth consent (G5 in `ops/DEPLOYMENT_CONTROL.md`)
2. Provide the root folder ID in `KNOWLEDGE_DRIVE_ROOT_ID`
3. Organise Drive data into the declared folder roles, or pick files explicitly
4. Run the ingestion workers to populate the index

These are human gates that agents cannot automate. The readiness score reports what is
indexed — it does not trigger ingestion automatically.

---

## §10 Human gates

| Gate | Description | Owner action |
|------|-------------|--------------|
| G-K1 | Provide Drive refresh token | `KNOWLEDGE_DRIVE_REFRESH_TOKEN` in operator env |
| G-K2 | Provide Drive root folder ID | `KNOWLEDGE_DRIVE_ROOT_ID` in operator env |
| G-K3 | Provide GitHub PAT | `GITHUB_PAT` in operator env |
| G-K4 | Provide GitHub repo list | `GITHUB_REPOS` in operator env |
| G-K5 | Run initial knowledge ingestion | Execute ingestion worker after G-K1/G-K2 |
| G-K6 | Run GitHub content pull | Execute GitHub client after G-K3/G-K4 |

None of G-K1 through G-K6 may be automated by an agent. The operator completes them
manually and the code fails closed when the required env entries are absent.

---

## §11 Security and boundary rules

1. **No secret in a tracked file.** PATs, tokens, folder IDs, and refresh tokens are
   deployment particulars. They live in the operator environment and never in `src/`,
   `tests/`, `contracts/`, or `docs/`.

2. **Journal and health are local-only.** Evidence from the `journal` and `health` domains
   is processed locally and never included in model-bound context. This is enforced by
   `canSendToCloud()` in `knowledgeBoundary.ts` (unchanged).

3. **Money is integer milliunits.** Nothing in this contract layer may compute, transform,
   or restate monetary values. All financial facts come from the deterministic engine.

4. **No ambient Drive reads.** The Drive client reads only when explicitly called by an
   authorised ingestion worker. It does not run continuously or in the background.

5. **GitHub read-only.** The GitHub port has no write methods. A write attempt must be
   rejected by the port interface — never silently dropped.

---

## §12 Acceptance criteria

| ID | Criterion |
|----|-----------|
| AC-K1 | `KNOWLEDGE_CLASSES` includes all 12 declared classes, each with a non-overlapping pattern |
| AC-K2 | `DRIVE_FOLDER_ROLES` includes `transactions`, `statements`, `personas`, `goals` |
| AC-K3 | `agentReadiness.ts` computes scores matching the declared weights to within 1% |
| AC-K4 | Readiness score is 0 on an empty index and ≥ 90 when all weighted classes have ≥ 1 doc |
| AC-K5 | `GitHubPort` interface has no write methods |
| AC-K6 | `GitHubSecret` cannot be serialised to its raw value |
| AC-K7 | `loadProfileMemory` returns empty context on an empty index without throwing |
| AC-K8 | `knowledge.read_github_content` and `knowledge.load_profile_memory` are in both profiles' tool lists |
| AC-K9 | Journal and health evidence never appears in a model-eligible `GroundedContext` |
| AC-K10 | No real folder ID, PAT, or refresh token appears in any file under `src/`, `tests/`, `contracts/`, `docs/` |

---

*Authored 2026-08-18 by NIZAM Builder from PFOS Contract 01-04, Contract 06, Contract 12,
money-rules.md, drive-db.md, two-agent-vps.md, and the gap analysis in _PFOS_CONTRACT_INDEX.md.*
