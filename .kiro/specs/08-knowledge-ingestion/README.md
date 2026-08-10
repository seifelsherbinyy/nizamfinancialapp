# Spec 08 - Knowledge ingestion and continuous learning

> **Goal, in one sentence.** Load the owner's real financial history and financial-strategy knowledge
> from the cloud drive into the agent's own store, so the very first conversation has something true
> to say, and then keep that store current through ordinary two-way chat.
>
> **Two phases, and the split matters.** **Phase A** seeds the store and needs no bot at all, so it
> runs in parallel with spec `07-bot-bringup-v1`. **Phase B** is the learning loop and depends on 07.
>
> **Phase:** v1.0 (phase A) and v1.1 (phase B). **Prerequisite specs:** `02-drive-data-layer` and the
> store from `06-two-agent-vps`. **Sibling:** `07-bot-bringup-v1`.

## 0. The finding that sets the scope

A read-only enumeration of the owner's drive tree on 2026-08-10 found **223 files** in the banking
subtree, and the single most useful fact about them is this:

> **The hard extraction work has already been done, by the owner, months ago.**

There is a completed pipeline run sitting in the tree. It holds, per statement, the extracted page
text and a metadata sidecar. It holds **per-account validated transaction tables**. It holds the
results of a schema gate, a balance-equation gate, a transfer-pair gate, a duplicate gate, a stage
summary and a quarantine list, **already computed**. Alongside it sits a **canonical master ledger**
whose shape this repository already documents.

**Two consequences, and they define the whole spec.**

1. **v1.0 needs no document parser and no optical character recognition.** Ingesting already-validated
   tables is a different, far smaller, far safer job than parsing statements. Statement parsing is
   deferred to v2 and is not on this spec's critical path.
2. **There are two independent renderings of the same history**, plus a third set of pre-computed
   gate results. That is not redundancy to be collapsed. It is the material for a reconciliation, and
   this spec requires one, because a load that agrees with itself proves nothing.

### What was verified against the live files, not read from a document

| Artifact | Verified |
|---|---|
| Canonical master ledger | **1,216 data rows, exactly 25 columns**, column names and order matching `data/ledgers/LEDGER_SCHEMA.md` precisely |
| Credit-limit table | 2 data rows, 3 columns, shape matching the placeholder already in `data/seed/` |
| Per-account validated tables | three, one per account |
| Statement page text and sidecars | present for every statement in the tree |
| Pre-computed gate results | schema, balance equation, transfer pairs, duplicates, stage summary, quarantine |

The schema document turned out to be accurate. That is worth stating explicitly, because the reason
to check was that a schema document is never authoritative on its own, and here the check passed.

## 1. What gets ingested, and what is refused

Every item in the tree is either ingested or **explicitly declined on the record**. A completeness
check over only the things already known about cannot find what was forgotten, so the register below
must account for the whole tree: ingested plus excluded equals detected.

### Tier 1 - transactional truth (phase A, required)

| Source | Target | Notes |
|---|---|---|
| Canonical master ledger | `transactions` | The 25-column contract. Money to integer milliunits at the boundary or refused |
| Credit-limit table | `accounts` | Limits and close day for the two revolving accounts |
| Per-account validated tables | reconciliation only | The independent second rendering. **Not** a second insert path |
| Pre-computed gate results | `source_events` provenance, and the QA baseline | An independent third check on the load |
| Account roster | `accounts` | Three accounts: one transaction account, two revolving |

### Tier 2 - knowledge, not transactions (phase A, required)

Loaded into `document_index`, never into `transactions`. This is what turns a calculator into an
adviser that knows the owner's own situation and stated intentions.

| Source | Why it matters |
|---|---|
| The owner's own recovery plan set, staged over five horizons from immediate triage to a year of monitoring | This is the owner's strategy in his own words. Without it the agent invents advice; with it the agent applies advice the owner already agreed to |
| The financial research corpus, including the two design documents that specify this system | Grounds recommendations in reasoning the owner has already accepted |
| The debt and interest-loop analyses | The specific failure modes this system exists to prevent |
| The agent contract set and the architecture documents from the drive root | Declares how the agents are meant to behave. The contracts are the knowledge layer this spec's title refers to |

### Tier 3 - deferred to v2, named so it is not lost

Statement documents themselves; the payslip set; the spreadsheet rendering of the ledger; the
partitioned columnar copies; the derived dashboards and reports.

Each is deferred for a stated reason: the statements and payslips need a parser, the spreadsheet
duplicates the canonical ledger, the columnar copies duplicate the validated tables, and the
dashboards are **derived output**, so ingesting them would import conclusions instead of evidence.

### Tier 4 - EXCLUDED BY RULE, and this one is absolute

The tree contains a large subtree of the owner's **employment-related work material**, roughly sixty
files, sitting in the same parent as the banking data. It has nothing to do with personal finance.

**It is excluded by rule, not by filter.** The distinction matters: an exclusion by filter can be
widened by a later change, and a rule cannot be widened without someone editing the rule and saying
why. The register records the subtree by placeholder only. No file from it is read, hashed, indexed or
quoted, and no term from it appears in any tracked artifact this spec produces.

Also excluded: source code of the other agent's repository that happens to live in the drive tree,
interpreter caches, and an encrypted container whose contents are not this system's business.

## 2. Where the knowledge lives

Nothing new is invented. Every table this spec needs **already exists** in the store schema, which
was designed for exactly this and has been waiting for data.

| Table | Role in this spec |
|---|---|
| `source_events` | One row per inbound item, with an idempotency key and a content hash, unique on channel plus key. **This is what makes re-ingestion safe.** Running the load twice is a no-op |
| `document_index` | The knowledge index: a reference, a content hash unique across the table, a class, and a processing state of indexed, processed, rejected or tombstoned |
| `transactions` | The 25-column ledger, money as integer milliunits, carrying its own confidence score, confidence reason, extraction method and duplicate key |
| `statements` | Period, opening and closing balance, totals, and a close state of open, balanced or exception-accepted |
| `accounts` | The roster and the limits |
| `decisions` | **The two-way loop's memory.** A ruling, its rationale, its expected and observed effect, and an outcome of pending, confirmed, reverted or superseded, with a supersession link |
| `audit_log` | Every mutation of a financial record, including every prune, with its table, cutoff and row count |

The presence of `confidence_score`, `confidence_reason` and an `extraction_method` that already
enumerates a manual value tells you the schema was designed for a human in the loop. Phase B is that
design being used, not an extension of it.

## 3. Phase A - the seed load

Runs on the developer machine, writes a store, and the store is moved to the host. No bot needed.

**Six properties the loader must have, each with a test that has been shown failing.**

1. **Idempotent.** Re-running changes nothing. Proven by running it twice and asserting the second run
   inserts zero rows and the row count is identical, not merely that it did not crash.
2. **Fail-closed on shape.** The column names are asserted as an exact ordered set before a single row
   is parsed. A file of the right width with reordered columns must be **refused**, because a
   width-only check cannot tell a reorder from a match, and a positional binding behind a width guard
   is how a load silently corrupts every field at once.
3. **Money is integral or refused.** Never a float, never a rounded float, at the boundary.
4. **Reconciled two ways.** The canonical ledger and the per-account tables are totalled
   independently, by two different code paths, and compared. The pre-computed gate results are the
   third opinion. **Any disagreement is reported as a finding, never averaged away.** The duplicate
   and quarantine lists are expected to explain part of the gap, and the explained part must be
   accounted for line by line rather than assumed.
5. **Grain proven before keying.** Test candidate keys and print the duplicate excess **before**
   keying anything. A key that is not unique silently keeps the last row it sees, and the row it keeps
   depends on file order. Shuffle the input and re-run: any total that moves was reading row order as
   data.
6. **Provenance on every row.** Source file, page or sheet, extraction method, confidence and its
   reason are carried through, never defaulted. A row whose provenance is unknown is loaded as unknown,
   not as parsed.

**Two properties about the ingestion tooling itself**, both already established in this repository and
both to be preserved: the tooling stays isolated from the application bundle, and it requests a
read-only scope, runs on the loopback interface, and caches its token outside the repository.

**And one about the data:** no real financial value, balance, account identifier, payee or ledger
excerpt enters a tracked file. The store is untracked. The seeds stay shape-only placeholders. This is
the same invariant the repository already enforces, and this spec is the first one with enough real
data to actually test it.

## 4. Phase B - the two-way learning loop

The part that makes the system improve by being used. It needs spec 07's inbound and outbound seams.

**The loop, in five steps.**

1. **Anything the owner sends is an event.** A message, a forwarded receipt, a correction. It lands in
   `source_events` with an idempotency key, so the same thing said twice has one effect.
2. **Low confidence asks instead of guessing.** A row below the confidence threshold is not silently
   accepted and not silently dropped. The agent asks the owner one specific question about it.
3. **The answer becomes a decision, not an overwrite.** The ruling is recorded in `decisions` with its
   rationale. The transaction is corrected and its extraction method becomes the manual value, so the
   record says a human decided it. A later change **supersedes** rather than erases, through the
   supersession link that column already exists for.
4. **Every mutation is audited.** Including prunes, with table, cutoff and row count.
5. **The knowledge index learns too.** A document the owner corrects or supersedes moves processing
   state rather than being deleted, and a tombstone is a state, not an absence.

**Three refusals that hold in phase B**, because a learning loop is exactly where guarantees get
quietly traded away:

- **The agent never invents a figure.** A missing value is asked about or reported missing. It is
  never estimated into a record that later reads as measured.
- **A correction cannot escape the audit.** There is no path that writes a financial record without an
  audit row, and that is asserted by a test on the enforcing path, not on a sibling helper.
- **Cross-agent signalling still carries a band and never a figure.** If the life agent ever needs to
  know something, it learns a direction, not an amount. The envelope has no field that could carry
  one, and the correct way to keep it that way is for the field not to exist.

## 5. Definition of done

| # | Condition | Observed how |
|---|---|---|
| **K1** | The canonical ledger is loaded, whole | Row count in the store equals the verified source row count, exactly |
| **K2** | The load is idempotent | Second run inserts zero rows; totals byte-identical |
| **K3** | Two independent totals reconcile | A reconciliation artifact, with any residual explained line by line |
| **K4** | Every row carries provenance | Zero rows with a defaulted extraction method or an absent source reference |
| **K5** | The knowledge tier is indexed | One `document_index` row per accepted document, each with a unique content hash |
| **K6** | The exclusion register is complete | Ingested plus excluded equals detected, asserted in code |
| **K7** | No real financial value is tracked | The repository's own scanners pass over the whole tree |
| **K8** | The agent answers from real data | A question about the owner's actual position returns an answer grounded in loaded rows |
| **K9** | A correction sticks and is auditable | Owner corrects one item in chat; a decision row and an audit row both exist; a re-run does not revert it |

K1 to K7 are phase A. K8 and K9 are phase B and depend on spec 07.

## 6. Interlock and sequencing

Phase A has **no dependency on spec 07** and should land first or alongside it, because it is what
makes the first conversation worth having. Phase B is the last thing built, because it needs a working
bot on one side and a seeded store on the other.

The honest ordering, then: **phase A, then spec 07 waves 3 and 4, then phase B.** The one thing that
must not happen is shipping a bot that talks confidently about an empty store.
