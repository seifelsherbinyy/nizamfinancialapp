# PFOS Database and Knowledge Model Contract

> **PROVENANCE: NIZAM-DERIVED. THIS CONTRACT WAS NEVER AUTHORED UPSTREAM.**
> Contracts 01-04 and 09-11 were ingested byte-for-byte from the owner's source material.
> Contract 06 was **verified absent** from every source sweep (see `_PFOS_CONTRACT_INDEX.md`,
> "Absent contracts"). It is therefore **derived inside this repository** from three inputs and
> nothing else:
> 1. `contracts/pfos/02_PFOS_Data_Architecture_Integrations_and_Security.md` (§1 store choice,
>    §2 data-domain separation, §4 transaction state model, §5 deduplication, §9 security controls);
> 2. `.kiro/steering/two-agent-vps.md` (AUTHORITATIVE for the server/agent area) and
>    `.kiro/steering/money-rules.md` (never overridden);
> 3. `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md` §1.8, §1.10, §2.2.
>
> It invents no policy that an upstream contract governs. Where it must choose, the choice is
> recorded with its reason and can be overridden by the owner.

**Status:** IN FORCE for the finance server data tier.
**Owning requirements:** `.kiro/specs/06-two-agent-vps/requirements.md` **R1, R2, R3, R4, R5** (and
**R6** jointly with contract 12).
**Precedence:** for the server data tier this contract is subordinate to
`.kiro/steering/two-agent-vps.md` and to `money-rules.md`; it overrides nothing in either. Where it
conflicts with contract 02's *language* choice, steering §1 already settled that and recorded why.

**Public-repository posture (steering §0b).** This repository is public by owner decision. This
contract may describe the *design* of the store; it may never contain a *deployment particular*. No
real domain, address, storage identifier, numeric messaging user id, bot name, or real monetary
figure appears below, not even as an example. Every such value is written as `<ANGLE_BRACKET>` and is
resolved only from the runtime environment on the host.

---

## 1. Document purpose

Define the persistent data tier for the **finance agent's server process**: which stores exist, how
they are opened, how they change over time, how money crosses the persistence boundary, how model
spend is accounted, how long anything is kept, and what may never be stored at all.

This contract must exist **before** code is written in its area (steering §5). It is the authority
that `src/server/db/**` implements and that the Phase 1 tests in
`.kiro/specs/06-two-agent-vps/tasks.md` verify.

### In scope

- The engine, connection pragmas, and file layout of `finance.db`.
- The migration model and its idempotence guarantee.
- The integer-milliunit persistence boundary.
- The one-money-implementation invariant across server and browser.
- The token-spend ledger and the weekly-total read model.
- Retention and pruning for every table this contract defines.
- The knowledge model: how documents, research, and derived context are *indexed* rather than
  duplicated, and what the index may not hold.
- Store isolation as it applies to the finance agent's own process.

### Out of scope

- `life.db`'s internal schema. It belongs to the other repository (steering §6); this contract only
  asserts that the finance process never opens it.
- `signals.db`'s envelope schema, consent scopes, and network binding. Those belong to
  **contract 12**; this contract states only the isolation and engine invariants that all three
  stores share.
- Backup, encryption, restore, and disaster recovery mechanics. **Contract 12**, informed by
  architecture §1.10. This contract defines only what a backup must be *able* to assert about
  consistency (§8.3).
- The browser tier's Drive-JSON store and its offline mirror. Governed by `drive-db.md` and the
  original build contracts 1-5, which are DONE and unchanged by this document.

---

## 2. Store topology and isolation (R1, R6)

Three stores. Three files. Three volumes. Zero cross-writes.

| Store | Owner | Written by | Read by |
|---|---|---|---|
| `life.db` | life agent (other repository) | life agent only | life agent only |
| `finance.db` | finance agent (this repository) | finance agent only | finance agent only |
| `signals.db` | the bus (contract 12) | either agent, append-only, through the bus client | either agent, consent-gated |

### 2.1 Invariants

1. **One writer per store.** No store has two writing processes. Concurrency inside a process is
   handled by SQLite transactions, not by a second process.
2. **No cross-agent open.** The finance process resolves its database path from a single injected
   configuration value and **never** constructs a path to another agent's file. An attempt to open a
   path outside its own configured data directory is a typed error, not a fallback.
3. **No `ATTACH`, ever.** The finance process issues no `ATTACH DATABASE` statement for any purpose,
   including reporting, migration, and diagnostics. Cross-store joins do not exist. This is the
   mechanical form of "the state crosses, the data never does" (steering §4.3).
4. **The bus is the only cross-agent channel.** If the finance agent needs to know something the
   life agent knows, it subscribes to a signal. It does not read a file.
5. **Local filesystem only.** No store is placed on a network filesystem or inside a synchronizing
   cloud folder. This restates contract 02 §1 and SQLite's own documented warning; a WAL database on
   a network or sync-mediated path can be corrupted.
6. **Read-only where read is all that is needed.** The only processes permitted a cross-store view
   are the backup and scheduler utilities described by contract 12, and only as a read-only mount.
   Live application logic never gets one.

### 2.2 Engine and connection contract

- Engine: the runtime's **built-in SQLite binding** (`node:sqlite`). No third-party driver, no
  native compilation step, no ORM. Rationale: the server tier must add zero supply-chain surface to
  a store that holds financial facts, and the query surface here is small and hand-written.
- Every connection, immediately on open and before any statement:

  | Pragma | Required value | Why |
  |---|---|---|
  | `journal_mode` | `WAL` | Reader/writer concurrency; the documented mode for a live single-writer store. Set once per database, persists. |
  | `foreign_keys` | `ON` | **Per connection**, not per database. Referential integrity is off by default and silently so. |
  | `busy_timeout` | `<BUSY_TIMEOUT_MS>` | A short lock wait must not surface as a user-visible failure. |
  | `synchronous` | `FULL` | Durability over throughput. This store holds money. |
  | `foreign_keys` verification | read back and assert | A pragma that was set but did not take is indistinguishable from one that was never set, unless it is read back. |

- The open routine **asserts** each pragma's effective value after setting it and throws a typed
  error on mismatch. A store that cannot prove WAL and enforced foreign keys is not opened.
- Connections are created through a single factory. No module opens its own connection.

---

## 3. Schema of `finance.db`

Table names are stable identifiers and part of this contract. Column lists below are the required
minimum; a migration may add columns, and may never repurpose or silently retype one.

### 3.1 Meta and migration

| Table | Purpose |
|---|---|
| `schema_migrations` | One row per applied migration: `version` (integer, PRIMARY KEY), `name`, `applied_at`, `checksum`. |
| `schema_meta` | Single-row store for the store's identity: logical store name, created-at, and the engine assertions recorded at creation. |

### 3.2 Financial facts

These reuse contract 02 §4 and §6 field names deliberately, so the server ledger and the browser
ledger describe the same facts with the same vocabulary.

| Table | Purpose | Notes |
|---|---|---|
| `accounts` | The account set of contract 02 §6 | Account identifiers are stored **redacted to a last-four fragment**; a full account number is never persisted (contract 02 §9). |
| `source_events` | The immutable inbox of contract 02 §1 | Append-only. Raw payload retained before parsing so a parser change can be replayed. Carries the idempotency key set of §5.1. |
| `transactions` | The transaction state model of contract 02 §4 | Every monetary column is integer milliunits. Carries `status`, `verification_level`, `supersedes_transaction_id`, `audit_version`. |
| `transaction_links` | Suspected-duplicate and pending-to-posted relationships | Contract 02 §5.2 forbids automatic deletion of a suspected duplicate; the link table is how it is recorded instead. |
| `obligations` | The obligation fields of contract 02 §6 | Monetary columns integer milliunits; `due_date` and `grace_date` as dates. |
| `statements` | Statement periods and their close state | A period closes only after the balance equation checks pass or an exception is explicitly accepted. |
| `decisions` | The append-only decision registry (PFOS Stage 4) | Append-only. A decision is superseded by a new row, never edited. |
| `assets` and `valuations` | Net-worth inputs | Valuation history retained; a valuation is never overwritten. |
| `fx_rates` | Rate history | Integer-safe representation only; see §4.4. |

#### ADDENDUM (added Phase 1.5, after implementation) — two tensions this section created

Both were surfaced by building `src/server/db/**` against this section and are recorded here
rather than silently resolved in code, because §5.1 makes one of them impossible to resolve the
obvious way.

**A1 — `decisions.outcome` admits a value that can never truthfully be assigned.**

The applied DDL constrains `outcome` to `pending | confirmed | reverted | superseded`. But
`superseded` is unreachable as an honest description of the row it appears on:

- §8.1 makes the registry append-only, and migration 4 puts `BEFORE UPDATE` and `BEFORE DELETE`
  triggers on the table, so the predecessor of a supersede is never touched — not its status,
  not its timestamp, not its outcome.
- Consequently "which row currently stands" is **DERIVED**, as `NOT EXISTS (successor)` over
  `supersedes_decision_id`, and is never stored. That derivation is precisely what makes the
  no-update rule affordable.
- So the only way the value could ever land is a caller **self-declaring** it at insert time,
  producing a row whose `outcome` column asserts a lineage its lineage columns do not support
  and are free to contradict. §3.2's column vocabulary and §8.1's append-only rule therefore
  disagreed, and the enum member was dead weight with a trap attached.

**Resolution: the member is RETAINED in the schema and REFUSED on the write path.**

- The DDL is **not** changed. §5.1 forbids editing a migration after it has been applied, and
  §5.2.5 makes the migrator refuse an applied migration whose checksum no longer matches — so
  narrowing the `CHECK` in place would move a recorded checksum and be rejected by the store's
  own guard. Correcting it would require a whole new migration to rebuild the table, which is
  destructive DDL against financial history (§5.3) for no gain: nothing needs the value gone,
  only unassignable.
- The **write path refuses it**, with a typed error
  (`REPOSITORY_DERIVED_STATE_NOT_ASSIGNABLE`), and the insert type is narrowed to the
  assignable subset so the refusal is also a compile error. A revised outcome is recorded the
  way every other change to a decision is recorded: by appending a successor.
- **Reads still accept the full enum.** A store repaired by hand may hold the value, and
  refusing to read history is not a fix for anything.
- Forward compatibility is the reason to keep the member rather than merely tolerate it: if a
  later migration ever introduces a stored-currentness column (it should not), the vocabulary
  is already there.

**A2 — `DecisionOutcome` meant two unrelated things in one repository.**

The browser tier's `DecisionOutcome` (`src/features/decisions/decisionRecord.types.ts`,
contract 03 §12) is an **observed-outcome record**: a review date, an actual net effect, a
prediction error, an attribution. The server tier's was this section's small **state enum**. No
file imported both, so it was never a bug — it was a trap for the first module that needed both,
and the kind of collision that produces a wrong-but-compiling import.

**Resolution: the SERVER identifier is renamed** to `DecisionOutcomeState` (values
`DECISION_OUTCOME_STATES`, assignable subset `ASSIGNABLE_DECISION_OUTCOME_STATES`). The browser
tier is unchanged, because it is shipped, tested, and named correctly for what it holds. This is
a naming change in this repository's own code and touches no DDL, no stored value, and no
migration checksum.

### 3.3 Server-tier operational tables

| Table | Purpose | Owning requirement |
|---|---|---|
| `spend_ledger` | Append-only actual model cost per completed call, keyed by agent | **R5** |
| `model_telemetry` | Tokens, latency, schema validity, model identity per call. **No prompt text, no completion text, ever.** | R19 (contract 12 / 09-11) |
| `update_dedup` | `(bot_id, update_id)` UNIQUE — per-bot dedup | R13, R14 (contract 12) |
| `work_queue` | Accept-fast / process-async queue for accepted updates | R15 (contract 12) |
| `document_index` | Pointer records for archived documents; see §7 | — |
| `audit_log` | Every mutation of a financial record and every external tool call | Contract 02 §9 |

### 3.4 Forbidden columns

No table in `finance.db` may hold, in any column, under any name:

- a bank password, a card verification value, or a full card number (contract 02 §9);
- a full account number (only a last-four fragment);
- a secret, token, key, or credential of any kind — these live only in the host's environment;
- prompt text or completion text from a model call;
- content classified `strict_local_maximum` (steering §4.4). Such content is excluded from this
  deployment entirely; there is no column for it because there must be no possibility of it.

A schema change that introduces such a column is a contract violation, not a design decision.

---

## 4. The money persistence boundary (R2, R4)

### 4.1 The representation

Money is an **integer number of milliunits**: 1 major unit = 1000 milliunits (`money-rules.md` §1).
Every monetary column is a SQLite `INTEGER` with `NOT NULL` where the value is required. There is no
`REAL` money column, no decimal-string money column, and no money value stored as text.

### 4.2 The boundary rule (R2)

A monetary value crosses into the store through exactly one guard. The guard:

1. rejects any value that is not a safe integer;
2. throws a **typed error** carrying the offending field's name and the received value — not a
   boolean, not a silent coercion, not a rounded write;
3. is applied on the write path, in the repository layer, **before** the statement is prepared, so a
   rejected value never reaches SQLite.

Rounding, truncation, and "helpful" coercion are all forbidden at this boundary. A non-integer
arriving at the persistence layer means an upstream parse was wrong, and the correct outcome is a
loud failure at the point of the error rather than a plausible-looking number in the ledger.

Decimal text is parsed to integer milliunits **at the ingestion boundary**, far upstream, by the
existing money core. The persistence guard is the second belt, not the first.

### 4.3 One money implementation, forever (R4) — INVARIANT

**There will never be a second implementation of money in this system.**

The server tier imports `src/lib/money/` **verbatim**. It does not port it, mirror it, re-derive it,
or wrap it in an alternative arithmetic. The full surface — the `Money` type, `MILLI`, `isMoney`,
`assertMoney`, `fromDecimal`, `fromNumber`, `toDecimal`, `add`, `sub`, `negate`, `abs`, `mul`,
`mulRatio`, `sum`, `cmp`, `min`, `max`, `allocate`, `format` — is the single source of monetary
arithmetic for both tiers.

Consequences, all of them binding:

- **Bit-identical derivation.** Where the server derives a figure the browser also derives, the two
  must produce an identical result from identical inputs. This is guaranteed by construction because
  it is literally the same code path, and it is *verified* by a parity test that feeds the same input
  vector to both and asserts equality, so the guarantee cannot silently decay.
- **`allocate` exactness survives the boundary.** `allocate(total, weights)` sums exactly to `total`
  with a deterministic remainder distribution (`money-rules.md` §3). Persisting the parts and reading
  them back must still sum exactly to `total`.
- **No float ever touches money.** No `parseFloat`, no `Number.parseFloat`, no `.toFixed(` outside
  `src/lib/money/`, and no decimal literal assigned to a money-named field. This is already enforced
  by the harness money-invariant check; the server tier is inside its scope, not outside it.
- **This invariant is the stated reason the finance runtime is Node/TypeScript** (steering §1). A
  second language for this tier would force a second integer-money implementation required to stay
  bit-identical forever, which is rejected. Contract 02's intent — a small typed server over
  SQLite — is honoured; only its language line is overridden, and only for this agent.

### 4.4 Rates and ratios

A rate, a percentage, or an exchange rate is never stored as a float that later multiplies money.
Rates are stored as an integer numerator and an integer denominator, and applied through `mulRatio`,
which uses an exact intermediate. A rate table row that cannot be expressed as an integer pair is
rejected at the boundary by the same guard as §4.2.

---

## 5. Migrations (R3)

### 5.1 The model

- Migrations are an **ordered, append-only** series. A migration file is numbered, named, and never
  edited after it has been applied anywhere. A mistake is corrected by a **new** migration.
- Each migration declares its `version` (a monotonically increasing integer) and a checksum of its
  own statements.
- Applying migrations is a single entry point: read the highest recorded `version` from
  `schema_migrations`, then apply every migration above it, in order.

### 5.2 The idempotence guarantee (R3)

Running the migrator against an already-current store **is a no-op**. Specifically:

1. Each migration runs inside **one transaction** together with the `INSERT` of its own
   `schema_migrations` row. Either the schema change and the version record both land, or neither
   does. A partially applied migration is therefore not a reachable state.
2. A migration whose `version` is already present in `schema_migrations` is **skipped without
   executing a single statement**. Skipping is decided by the recorded version, not by probing the
   schema.
3. Individual statements are additionally written defensively (`CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`) so that a hand-repaired store converges rather than aborting.
4. The migrator returns a summary — versions applied, versions skipped — so a caller can assert that
   a second consecutive run applied **zero** migrations. That assertion is the test of R3.
5. A recorded version whose checksum no longer matches the migration file is a **hard failure**. It
   means a migration was edited after application, which §5.1 forbids. The migrator refuses to
   proceed rather than guessing which of the two states is correct.

### 5.3 What a migration may not do

- Drop or rename a column holding financial facts. Superseding rows and additive columns are the
  mechanisms for change; destructive DDL against history is not.
- Rewrite money values. A representation change requires a new column, a backfill written as its own
  migration, and a verification query — never an in-place arithmetic `UPDATE`.
- Depend on data that only exists on one machine. Migrations must apply identically to an empty store
  and to a populated one.
- Weaken a constraint to let existing bad rows pass. If rows violate a constraint the correct action
  is to surface them, not to remove the constraint.

---

## 6. The token-spend ledger (R5)

The routing tier (contracts 09-11) may only spend what this ledger says is left.

### 6.1 Shape

`spend_ledger` is **append-only**. One row per **completed** model call:

| Column | Meaning |
|---|---|
| `id` | Surrogate key |
| `agent` | `life` or `finance` — the spend key. Enumerated; no free text. |
| `occurred_at` | Timestamp of completion, UTC |
| `week_key` | Derived UTC week bucket, stored at write time so the read model never re-derives it ambiguously |
| `model_id` | The model actually served, as reported by the provider |
| `cost_micro_usd` | **Actual reported cost**, integer micro-USD. Never an estimate, never a float. |
| `prompt_tokens`, `completion_tokens` | Integers, as reported |
| `request_ref` | Correlation identifier for the telemetry row |

There is no `amount` column in a currency the money core owns, and no column that could carry prompt
content. Cost is provider accounting, not a financial fact of the owner's ledger, and is deliberately
kept in its own integer unit so it can never be mistaken for a ledger amount.

### 6.2 Rules

1. **Actual, not estimated.** The row is written from the provider's reported usage on the completed
   response. A pre-flight estimate may gate a call; it may never be what gets recorded.
2. **Append-only.** No update, no delete, no correction in place. A correction is a compensating row
   with its own `request_ref`.
3. **Keyed by agent.** Every read of remaining budget is scoped to one agent. Exhausting one agent's
   cap must leave the other agent unaffected (R17), which is only possible if the ledger is keyed
   this way and never aggregated across agents for a cap decision.
4. **A failed call with reported cost is still recorded.** Cost that was incurred is cost that
   counts, regardless of whether the result was usable.
5. **The ledger is the in-app belt; the provider's per-key cap is the second belt.** One key per
   agent gives platform-enforced isolation underneath this ledger. Neither belt substitutes for the
   other, and neither may be weakened to make a call succeed.

### 6.3 The weekly total is a pure function (R5)

`weeklySpend(rows, agent, weekKey) -> integer micro-USD` is a **pure function** of its inputs:

- no clock read inside it — the week boundary is an argument;
- no database access inside it — rows are handed in by a repository;
- no I/O, no randomness, no ambient configuration.

This is what makes the cap decision testable exhaustively over synthetic ledgers, and what lets the
same function serve `src/features/routing/modelPolicy.ts` without dragging the store into the browser
tier. The cap it is compared against (`<WEEKLY_CAP_USD>`, `<AGENT_WEEKLY_CAP_USD>`) is injected
configuration, never a literal in the ledger code.

**The LLM tier never sources a monetary number** (steering §4.5). The spend ledger is the one place
model cost is recorded, and model cost is not a figure in the owner's financial ledger. No routing
decision reads a balance, an obligation, or a safe-to-spend value.

---

## 7. The knowledge model

Financial facts live in `finance.db`. Knowledge does not.

### 7.1 Separation

Per contract 02 §2, four non-fact domains exist: policy and rules (version-controlled in the
repository), documents and knowledge (the archive), personal context, and behavioural context. This
contract binds them to the store as follows.

- **The store indexes; it does not duplicate.** `document_index` holds a pointer record only:
  a storage identifier resolved at runtime (`<DOCUMENT_REF>`), a content hash, a byte count, a
  document class, a processing state, and a link to the `source_events` row that consumed it. It does
  not hold the document body, and it does not hold an extracted narrative.
- **The content hash is the idempotency key.** A document already indexed by hash is not reprocessed
  (contract 02 §3.4).
- **Behavioural and health context is a separate namespace.** Recovery, sleep, and strain context
  reaches the finance agent **only** as a bus signal carrying a level or a direction — never as a
  row copied into `finance.db`, and never as free text. Financial logic reads a permitted feature
  summary, not a body of context.
- **Documents are untrusted data** (contract 02 §9). Text extracted from a statement, a receipt, or a
  research artifact can never issue an instruction. Storing an extraction does not make it trusted;
  the trust boundary is unchanged by persistence.

### 7.2 What the knowledge index may not contain

- A storage identifier, folder identifier, or account address as a literal. Runtime-injected
  references only (steering §0b).
- Free-text narrative over the envelope limit that contract 12 sets for cross-agent payloads. If a
  narrative is long enough to be interesting, it is long enough to leak, and it does not belong in a
  cross-readable index.
- Anything classified `strict_local_maximum`. Not indexed, not referenced, not counted.

---

## 8. Retention

### 8.1 Kept indefinitely

Financial history is the product. These are never pruned on a schedule:

`accounts`, `transactions`, `transaction_links`, `obligations`, `statements`, `decisions`, `assets`,
`valuations`, `fx_rates`, `audit_log`.

Correction is by superseding row, so history stays legible; `supersedes_transaction_id` and
`audit_version` exist precisely so nothing has to be destroyed to be fixed.

### 8.2 Bounded by policy

| Table | Retention | Reason |
|---|---|---|
| `source_events` | `<SOURCE_EVENT_RETENTION_DAYS>` for the **raw payload**; the parsed record and its idempotency keys are kept indefinitely | Replayability has a useful life; the raw payload is the most sensitive artifact in the store and should not outlive it. |
| `spend_ledger` | `<SPEND_LEDGER_RETENTION_WEEKS>`, and never fewer than the number of weeks any cap window spans | Pruning inside an open cap window would silently restore budget. |
| `model_telemetry` | `<TELEMETRY_RETENTION_DAYS>` | Enough to compute promotion and demotion decisions; no longer. |
| `update_dedup` | `<DEDUP_RETENTION_DAYS>`, and never shorter than the transport's maximum redelivery window | Pruning too early re-opens the replay window that R13 closes. |
| `work_queue` | Completed items pruned after `<WORK_QUEUE_RETENTION_HOURS>` | Operational, not historical. |
| `document_index` | Pointer retained while the document exists in the archive; tombstoned, not deleted, when it does not | A deleted pointer would make the same document look new and be reprocessed. |

### 8.3 Pruning rules

1. Pruning is a **scheduled, logged, transactional** operation. It writes an `audit_log` row stating
   the table, the cutoff, and the row count.
2. Pruning never runs implicitly on open, on migration, or as a side effect of a read.
3. A prune that would cross a boundary named in §8.2 as a floor is refused, not clamped.
4. Reclaiming space uses `VACUUM INTO` against a copy, never a destructive in-place rewrite of the
   live store. This is the same mechanism contract 12 uses for a transactionally consistent backup
   snapshot, which is why this contract requires the store to be capable of it: WAL mode plus a
   single writer.

---

## 9. Acceptance tests (the definition of done for this area)

Each maps to an owning requirement and must include the **negative** case. A test that has only ever
been observed passing is not evidence; each guard must be shown refusing the guarded operation.

| # | Test | Requirement |
|---|---|---|
| T1 | An opened store reports `journal_mode=WAL` and `foreign_keys=ON` when read back | R1 |
| T2 | Opening a path outside the configured data directory throws a typed error | R1, R6 |
| T3 | No `ATTACH` statement exists anywhere in the server source | R1, R6 |
| T4 | A foreign-key violation is rejected by the store, proving the pragma took effect | R1 |
| T5 | Persisting a non-integer monetary value throws a typed error naming the field, and writes nothing | **R2** |
| T6 | Round-trip of every monetary column preserves the exact integer | R2 |
| T7 | `allocate` parts, persisted and re-read, still sum exactly to the original total | R2, R4 |
| T8 | Migrating a fresh store then migrating again applies **zero** migrations and changes no schema | **R3** |
| T9 | A migration that fails mid-way leaves neither the schema change nor its version row | R3 |
| T10 | An edited already-applied migration is refused on checksum mismatch | R3 |
| T11 | A shared input vector produces identical results from the server path and the browser path | **R4** |
| T12 | The server tier imports the money core and defines no arithmetic of its own | R4 |
| T13 | `weeklySpend` is pure: identical inputs give identical outputs with no clock or store access | **R5** |
| T14 | Actual reported cost is what lands in the ledger; an estimate never does | R5 |
| T15 | Exhausting one agent's weekly total refuses that agent and leaves the other unaffected | R5, R17 |
| T16 | No table accepts a column named in §3.4; telemetry rejects prompt text | R19 |
| T17 | No tracked file in this area contains a deployment particular | R24 |
| T18 | A caller cannot assign a DERIVED state: `decisions.outcome = 'superseded'` is refused with a typed error and nothing is written (§3.2 ADDENDUM A1) | R1, §8.1 |

---

## 10. Forbidden, unconditionally

- A second implementation of money, in any language, for any reason.
- A float, a decimal string, or a rounded value in a monetary column.
- `ATTACH DATABASE`, in any code path.
- Opening another agent's store.
- A credential, token, or key in any column.
- Prompt or completion text in any column.
- Editing an applied migration.
- Destructive DDL against financial history.
- Weakening a constraint, a cap, or a pragma assertion to make an operation succeed.
- A real domain, address, storage identifier, numeric messaging user id, bot name, or real monetary
  figure in this file or any artifact it governs.

---

## 11. Source notes

The store choice and its constraints are not novel here; they are the documented behaviour of the
engine and the position contract 02 already took.

- SQLite transactions are atomic, which is why a single-user financial ledger is a good fit:
  https://www.sqlite.org/lang_transaction.html
- Transactional guarantees: https://www.sqlite.org/transactional.html
- Write-ahead logging, including its explicit warning against network filesystems:
  https://www.sqlite.org/wal.html
- `VACUUM INTO` as the blessed way to take a consistent snapshot of a live database:
  https://www.sqlite.org/lang_vacuum.html
- `PRAGMA foreign_keys` is per connection and defaults off:
  https://www.sqlite.org/pragma.html
- The runtime's built-in SQLite binding: https://nodejs.org/api/sqlite.html

Internal sources, all in this repository:
`contracts/pfos/02_PFOS_Data_Architecture_Integrations_and_Security.md` §1, §2, §4, §5, §6, §9;
`docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md` §1.8, §1.10, §2.2;
`.kiro/steering/two-agent-vps.md` §0b, §1, §2, §4, §5;
`.kiro/steering/money-rules.md`; `.kiro/steering/pfos-current.md`;
`.kiro/specs/06-two-agent-vps/requirements.md` R1-R6, R17, R19, R24.

---

## Machine-executable contract

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "pfos://contracts/database-and-knowledge-model.schema.json",
  "title": "PFOS Database and Knowledge Model Contract",
  "description": "NIZAM-derived. Governs the finance agent server data tier. Owning requirements R1-R5.",
  "type": "object",
  "required": ["provenance", "stores", "connection", "money_boundary", "migrations", "spend_ledger", "knowledge", "retention", "acceptance_tests"],
  "properties": {
    "provenance": {
      "type": "object",
      "required": ["origin", "derived_from"],
      "properties": {
        "origin": {"const": "nizam_derived_never_authored_upstream"},
        "derived_from": {"type": "array", "minItems": 3, "items": {"type": "string"}}
      }
    },
    "stores": {
      "type": "array",
      "minItems": 3,
      "items": {
        "type": "object",
        "required": ["name", "owner", "writers", "cross_open_permitted"],
        "properties": {
          "name": {"enum": ["life.db", "finance.db", "signals.db"]},
          "owner": {"enum": ["life_agent", "finance_agent", "signal_bus"]},
          "writers": {"const": 1},
          "cross_open_permitted": {"const": false}
        }
      }
    },
    "connection": {
      "type": "object",
      "required": ["engine", "journal_mode", "foreign_keys", "synchronous", "attach_permitted", "network_filesystem_permitted", "pragmas_read_back"],
      "properties": {
        "engine": {"const": "node:sqlite"},
        "journal_mode": {"const": "WAL"},
        "foreign_keys": {"const": "ON"},
        "synchronous": {"const": "FULL"},
        "attach_permitted": {"const": false},
        "network_filesystem_permitted": {"const": false},
        "pragmas_read_back": {"const": true}
      }
    },
    "money_boundary": {
      "type": "object",
      "required": ["unit", "column_type", "non_integer_behaviour", "implementations", "implementation_source", "parity_required"],
      "properties": {
        "unit": {"const": "integer_milliunits"},
        "column_type": {"const": "INTEGER"},
        "non_integer_behaviour": {"const": "reject_with_typed_error"},
        "implementations": {"const": 1},
        "implementation_source": {"const": "src/lib/money"},
        "parity_required": {"const": "bit_identical_server_and_browser"}
      }
    },
    "migrations": {
      "type": "object",
      "required": ["ordering", "version_recorded", "idempotent", "transactional", "rerun_effect", "edit_applied_migration", "destructive_ddl_on_history"],
      "properties": {
        "ordering": {"const": "append_only_monotonic_integer"},
        "version_recorded": {"const": true},
        "idempotent": {"const": true},
        "transactional": {"const": "schema_change_and_version_row_in_one_transaction"},
        "rerun_effect": {"const": "no_op_zero_migrations_applied"},
        "edit_applied_migration": {"const": "refused_on_checksum_mismatch"},
        "destructive_ddl_on_history": {"const": false}
      }
    },
    "spend_ledger": {
      "type": "object",
      "required": ["append_only", "key", "cost_source", "cost_unit", "weekly_total", "contains_prompt_text", "cap_source"],
      "properties": {
        "append_only": {"const": true},
        "key": {"const": "agent"},
        "cost_source": {"const": "provider_reported_actual"},
        "cost_unit": {"const": "integer_micro_usd"},
        "weekly_total": {"const": "pure_function_of_rows_agent_and_week_key"},
        "contains_prompt_text": {"const": false},
        "cap_source": {"const": "injected_configuration_placeholder"}
      }
    },
    "knowledge": {
      "type": "object",
      "required": ["mode", "idempotency_key", "behavioural_context_channel", "documents_trust", "strict_local_maximum"],
      "properties": {
        "mode": {"const": "index_pointers_not_content"},
        "idempotency_key": {"const": "content_hash"},
        "behavioural_context_channel": {"const": "signal_bus_level_or_direction_only"},
        "documents_trust": {"const": "documents_are_untrusted_data"},
        "strict_local_maximum": {"const": "excluded_from_this_tier_entirely"}
      }
    },
    "retention": {
      "type": "object",
      "required": ["indefinite", "bounded", "prune_rules"],
      "properties": {
        "indefinite": {"type": "array", "items": {"type": "string"}},
        "bounded": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["table", "window_placeholder", "floor_reason"],
            "properties": {
              "table": {"type": "string"},
              "window_placeholder": {"type": "string", "pattern": "^<[A-Z_]+>$"},
              "floor_reason": {"type": "string"}
            }
          }
        },
        "prune_rules": {
          "type": "object",
          "required": ["transactional", "audited", "implicit_on_open", "clamp_below_floor", "space_reclaim"],
          "properties": {
            "transactional": {"const": true},
            "audited": {"const": true},
            "implicit_on_open": {"const": false},
            "clamp_below_floor": {"const": false},
            "space_reclaim": {"const": "VACUUM INTO a copy"}
          }
        }
      }
    },
    "acceptance_tests": {
      "type": "array",
      "minItems": 17,
      "items": {
        "type": "object",
        "required": ["id", "requirement", "has_negative_case"],
        "properties": {
          "id": {"pattern": "^T\\d+$"},
          "requirement": {"pattern": "^R\\d+$"},
          "has_negative_case": {"const": true}
        }
      }
    },
    "forbidden": {
      "type": "array",
      "items": {
        "enum": [
          "second_money_implementation",
          "float_or_decimal_money_column",
          "attach_database",
          "open_another_agents_store",
          "credential_in_a_column",
          "prompt_or_completion_text_in_a_column",
          "edit_an_applied_migration",
          "destructive_ddl_on_financial_history",
          "weaken_a_constraint_cap_or_pragma_assertion",
          "deployment_particular_in_a_tracked_file"
        ]
      }
    }
  }
}
```
