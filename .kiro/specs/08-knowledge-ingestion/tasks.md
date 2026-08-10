# Spec 08 tasks - Knowledge ingestion and continuous learning

> Read `README.md` first. Rules that bind every task below:
> **no real financial value, balance, account identifier, payee or ledger excerpt in a tracked file**;
> **no storage folder or file identifier in a tracked file** (they arrive from the operator
> environment, and an unresolved name fails closed); **the ingestion tooling stays isolated from the
> application bundle**; **read-only scope only**; **money is an integer milliunit or it is refused**.
>
> Every gate below is shown **failing** before it is trusted. Tamper the input, watch it refuse, and
> print the row count that changed: zero rows changed means the tamper never applied and the pass was
> false.

## Phase A - the seed load (no bot required, runs in parallel with spec 07)

### Wave A0 - inventory and refusal, before any parsing

- [ ] A0.1 Enumerate the whole banking tree read-only and write an **exclusion register**: one row per
      detected item, each either a tier assignment or an explicit decline with a reason. Assert in code
      that ingested plus excluded equals detected (**K6**). A completeness check over only what you
      already listed cannot find what you forgot.
- [ ] A0.2 Encode the **work-material subtree exclusion as a rule, not a filter**, referenced by
      placeholder only. Negative-test it: point the rule at a decoy path and show the load refuses.
      Assert no term from that subtree appears in any artifact this spec produces.
- [ ] A0.3 Resolve the drive folder references from the operator environment. An unresolved reference
      **fails closed**. Do not write a folder or file identifier into a tracked file, and do not add a
      default.

### Wave A1 - shape, before content

- [ ] A1.1 Assert the canonical ledger's columns as an **exact ordered name set** before parsing a
      single row. Negative-test twice: a file of the right width with two columns swapped must be
      refused, and a file with a column renamed must be refused. A width-only guard passes both, which
      is the reason this task exists.
- [ ] A1.2 Prove the **grain** before keying anything. Test each candidate key, print the duplicate
      excess, and make uniqueness a hard gate. Then shuffle the source rows and re-run: any total that
      moves was reading row order as data, and that is a defect, not a variance.
- [ ] A1.3 Assert the credit-limit table's shape the same way, and that its account references resolve
      to the account roster. An unresolvable reference is a finding, not a skipped row.

### Wave A2 - the loader

- [ ] A2.1 Port the existing 25-column parse and dedup logic to the server store. **Do not write a
      second parser.** If the existing one needs a change, change it, so there is one implementation
      and one place a rule can be widened.
- [ ] A2.2 Write every row through `source_events` first, with an idempotency key and a content hash,
      unique on channel plus key. This is the property that makes re-ingestion safe rather than
      additive.
- [ ] A2.3 Money to integer milliunits at the boundary or refused. Negative-test a fractional value, a
      value with a thousands separator, and a value that would round: each refused, none coerced.
- [ ] A2.4 Carry provenance on every row: source file, page or sheet, extraction method, confidence and
      confidence reason. A row with unknown provenance loads as **unknown**, never as parsed (**K4**).
- [ ] A2.5 Load the account roster and the statement periods. A statement whose totals do not satisfy
      the balance equation is recorded with its close state as an accepted exception **and a reason**,
      never silently balanced.

### Wave A3 - reconciliation, which is the real test

- [ ] A3.1 Total the canonical ledger and the per-account tables **by two independent code paths** and
      compare. Emit a reconciliation artifact. Pass only if the difference is zero or fully explained.
- [ ] A3.2 Use the pre-computed gate results as an independent third opinion: schema, balance equation,
      transfer pairs, duplicates, stage summary, quarantine. Where this load disagrees with a
      pre-computed verdict, **report the disagreement as a finding.** Do not adopt either side silently
      and do not average them.
- [ ] A3.3 Account for the duplicate and quarantine populations **line by line**. An unexplained
      residual is the deliverable's most important number, so it is reported, not absorbed.
- [ ] A3.4 Derive any tolerance you need from the arithmetic of the rounding involved, and state the
      derivation. Do not widen a tolerance to turn red into green: diagnose the deviation profile
      first, then justify the bound.
- [ ] A3.5 Assert **K1**: the store's row count equals the verified source row count exactly. Not
      approximately, and not "within the duplicates".

### Wave A4 - the knowledge tier

- [ ] A4.1 Index the tier-2 documents into `document_index`: one row per accepted document, content
      hash unique across the table, class assigned, processing state set. Negative-test that a
      re-index of the same bytes is a no-op rather than a second row (**K5**).
- [ ] A4.2 Index the owner's recovery plan set as a **single ordered set** across its five horizons, so
      a later horizon cannot be applied as though it were the immediate one. The ordering is meaning
      here, not presentation.
- [ ] A4.3 Index the agent contract set and the architecture documents from the drive root. These are
      the behavioural knowledge the system's title refers to, and they belong in the index rather than
      in a prompt string.
- [ ] A4.4 Assert **K7**: run the repository's own secret, particular and generic-term scanners over
      the whole tree with the store present. This spec is the first one with enough real data to
      actually exercise those scanners, so a pass here means more than it did before.

### Wave A5 - place it on the host

- [ ] A5.1 Move the seeded store to the host's per-agent data directory, owned and mode-restricted as
      G1 established. The store is untracked, and it never enters the repository or a backup that has
      no keypair behind it.
- [ ] A5.2 Record the load as an observation: row counts, reconciliation verdict, residual, document
      count, exclusion count. Never a financial value.

## Phase B - the learning loop (depends on spec 07 waves 3 and 4)

- [ ] B1.1 Route every owner message into `source_events` with an idempotency key, so the same thing
      said twice has one effect. Negative-test the duplicate.
- [ ] B1.2 Below the confidence threshold, **ask one specific question** rather than accepting or
      dropping. Assert the agent never fills a missing figure with an estimate: negative-test that the
      estimate path does not exist rather than that it is not taken.
- [ ] B1.3 Record the owner's answer as a `decisions` row with its rationale, correct the transaction,
      and set its extraction method to the manual value. A later change **supersedes** through the
      supersession link; nothing is erased.
- [ ] B1.4 Assert there is **no path** that mutates a financial record without an audit row. Put the
      check on the enforcing path, not on a helper beside it, and negative-test it there.
- [ ] B1.5 Move `document_index` processing state on correction or supersession. A tombstone is a
      state, never a deletion.
- [ ] B1.6 Observe **K8**: ask the agent a question about the real position and get an answer grounded
      in loaded rows. Then **K9**: correct one item in chat, confirm a decision row and an audit row
      both exist, re-run the seed load, and confirm the correction survives. A correction that a
      re-ingest reverts is not a correction.

## Waiting on the owner

- [ ] Confirm the drive folder reference to use, supplied through the environment rather than in a file
- [ ] Confirm the account roster is complete, and whether any account is intentionally absent
- [ ] Rule on whether the payslip set is in scope for v1.1 or stays deferred to v2

## Dependency graph

```json
{
  "waves": [
    { "wave": "A0", "tasks": ["A0.1", "A0.2", "A0.3"] },
    { "wave": "A1", "tasks": ["A1.1", "A1.2", "A1.3"] },
    { "wave": "A2", "tasks": ["A2.1", "A2.2", "A2.3", "A2.4", "A2.5"] },
    { "wave": "A3", "tasks": ["A3.1", "A3.2", "A3.3", "A3.4", "A3.5"] },
    { "wave": "A4", "tasks": ["A4.1", "A4.2", "A4.3", "A4.4"] },
    { "wave": "A5", "tasks": ["A5.1", "A5.2"] },
    { "wave": "B1", "tasks": ["B1.1", "B1.2", "B1.3", "B1.4", "B1.5", "B1.6"] }
  ],
  "notes": [
    "Phase A has no dependency on spec 07 and should land first or alongside it.",
    "Wave A3 is the wave that decides whether the load can be trusted, and it is the one most likely to surface a real finding.",
    "Phase B depends on spec 07 seams S1, S2 and S6 existing.",
    "No wave in phase A requires a document parser or optical character recognition."
  ]
}
```
