# Run log — ship-run-live-bringup

**Owning spec:** `.kiro/specs/ship-run-live-bringup/` (requirements.md, design.md, tasks.md).
**What this file is:** the measured findings of the bringup run, in the order they were taken. Each
entry is an **Observation** — a reading taken from a system of record, carrying its date, its
measuring command and its result. **No entry here is a decision.** An Observation records what was
measured; a decision records a choice that was made. Decisions belong in design.md, which states
them with their rationale and their accepted cost.

**Append-only in practice.** Later steps add sections below; earlier entries are not rewritten. When
a later measurement supersedes an earlier one, the supersession is recorded as its own Observation
naming what changed and why, rather than by editing the earlier entry. An Observation that has gone
stale is not an Observation that was wrong — that is what the dates are for.

**This file carries no deployment particular.** It lives under `.kiro/**`, which is tracked and which
AC18 has never covered, so it is an input to the STEP 1 sweep it will be swept by (R2.3, R24.6).
Every credential, host, address, bot and numeric messaging identifier appears only as its
`<ENTRY_NAME>` placeholder — and none is needed to state anything below.

**On the date.** Entries are dated **2026-08-10** in UTC. The measuring machine's clock read
`2026-08-11 02:33 +03:00` local at the time of writing, which is the same instant. Both are recorded
so a reader comparing this file to a local timestamp elsewhere is not left to guess which convention
was used.

---

## STEP 0 — stillness before the irreversible step

### Observation 1 — `git status --porcelain` is NOT empty (2026-08-10)

The task text for 1.2, and the design's own recorded correction, both state that
`git status --porcelain` was measured **empty**. Measured directly at STEP 0, it is not. What was
read:

```
$ git status --porcelain
?? .kiro/specs/ship-run-live-bringup/
```

```
$ git status --porcelain --untracked-files=all
?? .kiro/specs/ship-run-live-bringup/.config.kiro
?? .kiro/specs/ship-run-live-bringup/design.md
?? .kiro/specs/ship-run-live-bringup/requirements.md
?? .kiro/specs/ship-run-live-bringup/tasks.md
```

Four untracked paths, and **all four are this spec's own documents**. The short form collapses them
to the containing directory, which is why both readings are quoted: the short form alone would leave
a reader unable to tell one untracked file from four.

**Recorded as measured, not as predicted.** R22.1 requires the state that was opened to be reported
rather than the state a document claims. Recording `git status --porcelain` as empty because the task
text says so would have propagated a false reading into the run's own record.

**What this does to the originating contract's claim.** The contract describes **three mid-edit
files** (`src/server/process/main.ts`, `src/server/process/turnWorker.ts`) and **one untracked file**
(`src/server/process/turnIntake.ts`). That claim does not hold in either half:

- the named files are **clean** — none appears in either porcelain reading above;
- `turnIntake.ts` is **tracked** (Observation 2);
- the untracked paths that do exist are **not** those files. They are this spec's documents, which
  did not exist when the contract was written.

### Observation 2 — `turnIntake.ts` is tracked (2026-08-10)

Confirmed against the **index**, not against the disk. A file existing on disk says nothing about
whether git tracks it, so `git ls-files` is the system of record for this question and a directory
listing is not.

```
$ git ls-files --error-unmatch src/server/process/turnIntake.ts
src/server/process/turnIntake.ts
EXIT=0
```

The same command over the two files the contract calls mid-edit also exits 0, so all three are
tracked and clean.

### Observation 3 — HEAD and the ahead count (2026-08-10)

```
$ git rev-parse --short HEAD
24c432a

$ git rev-list --count origin/master..HEAD
47
```

HEAD is `24c432a` and the branch is **47 commits ahead** of `origin/master`. This supersedes the
originating contract's `0d25679` and 43. It **agrees** with the correction already recorded in
design.md, so this entry confirms that correction rather than replacing it.

### Observation 4 — the design's own `git status` Observation is superseded, and by what (2026-08-10)

design.md records `git status --porcelain` as empty under "Measured corrections that override the
originating contract". That reading was **true when it was taken** and is now stale.

**What made it stale:** this session authored `requirements.md`, `design.md`, `tasks.md` and
`.config.kiro` into `.kiro/specs/ship-run-live-bringup/` **after** the reading was taken. The tree
changed because the run documented itself. Nothing suggests the earlier measurement was wrong at the
time, and no discovery contradicted it.

This is the ordinary lifecycle of an Observation: it is a reading at an instant, not a standing
property, which is why it carries a date. The correction is recorded **here**; design.md's entry is
left exactly as written. Rewriting a design document's Observation to match a later reading destroys
the evidence that the tree changed, and would be a worse outcome than the stale line.

### Observation 5 — the tree is still (2026-08-10)

Stillness was established by a **byte-identical metadata snapshot** taken twice across an interval of
**26 seconds** over **825 files**, with `.git` and `node_modules` excluded. The two snapshots matched
exactly.

`awake.ps1` is running. It opens no file in this tree, so it is **not a writer** and does not need to
be stopped for STEP 1 to measure a stable tree.

### Observation 6 — writing this file added a fifth untracked path (2026-08-10)

Re-measured immediately after this file was created:

```
$ git status --porcelain --untracked-files=all -- .kiro/specs/ship-run-live-bringup/
?? .kiro/specs/ship-run-live-bringup/.config.kiro
?? .kiro/specs/ship-run-live-bringup/RUN_LOG.md
?? .kiro/specs/ship-run-live-bringup/design.md
?? .kiro/specs/ship-run-live-bringup/requirements.md
?? .kiro/specs/ship-run-live-bringup/tasks.md
```

**Five** untracked paths now, not four. Observation 1 is left as written — it was accurate when taken,
and this entry records the change rather than editing it, which is the convention this file declares
in its header. The cause is the same as in Observation 4: the run is documenting itself, and each
document it writes is a change to the tree it is measuring. C1 and C2 below are stated over all five
paths.

---

## Consequences carried forward from STEP 0

These are not decisions. They are consequences of the readings above that later steps depend on, and
one of them requires an Operator decision that is **not** taken here.

### C1 — STEP 1's sweep must enumerate this spec's documents explicitly

R2.1 scopes the Identity_Sweeper to every **tracked** file. `git ls-files` will not return the five
untracked paths in Observation 6, because they are in no commit and in no index entry. Meanwhile task
2.2 explicitly requires `requirements.md`, `design.md` and `tasks.md` to be swept — they are inputs to
the sweep they specify.

**Therefore a tracked-file enumeration alone cannot satisfy task 2.2.** The sweep must add all five
paths of this spec's directory — `requirements.md`, `design.md`, `tasks.md`, `.config.kiro` and this
`RUN_LOG.md` — to its file list explicitly, on top of whatever `git ls-files` returns.

### C2 — STEP 3's push will not publish this spec

Untracked files are in no commit, so the 47-commit push carries none of the five paths in
Observation 6. Whatever STEP 3 verifies against the remote, it will not include this spec.

**This needs an Operator decision at STEP 3, and this task does not take it.** The two options, with
what each costs:

- **Commit the spec before the push.** Adds a 48th commit, which must itself be swept at STEP 1
  before STEP 3 — so this choice reorders work, it does not merely add a commit. The ahead count
  reported by the Push_Verifier becomes 48, not 47.
- **Push the 47 as-is.** The spec stays local and unpublished. Nothing already measured changes.

Neither is chosen here. STEP 3 reports whichever the Operator directs, and reports the ahead count it
actually reads.

---

## Verification status of the STEP 0 entries

**Verified by opening the system of record:**

- the two porcelain readings, from the working tree and the index;
- `turnIntake.ts` tracked, plus the two contract-named files tracked and clean, from the index;
- HEAD `24c432a` and the ahead count 47, from the local git references;
- the byte-identical two-pass metadata snapshot over 825 files.

**NOT verified, stated as a limitation (R22.6):**

- **The command line of seven processes could not be read** — six `powershell.exe` and one `cmd.exe`.
  `Win32_Process` returned an empty `CommandLine` and an empty `ExecutablePath` for each, so it is
  not established from process metadata what those seven are doing.
- Consequently the stillness claim in Observation 5 rests on the **snapshot**, not on a complete
  enumeration of candidate writers. A writer that touched no file during the 26-second interval would
  be invisible to it. The claim is "the tree did not change across that interval", which is what was
  measured; it is not "no process is capable of writing".
- The ahead count is measured against the **local** `origin/master` reference. Whether that reference
  matches the remote is what the STEP 3 Push_Verifier exists to read, and is not claimed here.

**Untouched by this entry:** the money, credential and isolation invariants. Nothing above reads,
writes, moves or names a credential; no store was opened; no host was contacted.

---

## STEP 1 — full identity sweep of every tracked file

**On the date, and on the day rolling over.** The STEP 0 entries above are dated **2026-08-10** in UTC.
The entries below are dated **2026-08-11** in UTC; the measuring machine's clock read
`2026-08-11 10:38 +03:00` local, which is the same instant. Nothing about the run paused overnight —
UTC simply crossed midnight between STEP 0 and the completion of STEP 1.

**Why this section is written after the fact.** Task 2.2 swept `.kiro/**`, and this file is inside
`.kiro/**`. Writing STEP 1's findings here **while** 2.2 was measuring would have changed the file it
had just measured clean, exactly as writing this file changed the tree in Observation 6. So 2.2
deliberately wrote nothing here, and the record of both passes is entered now, from the pass outputs,
by task 2.3. The cost is named rather than hidden: these entries were **not** written at the instant
the readings were taken, and Observation 15 records what the write itself did to this file's own
sweep result.

### Observation 7 — the scan sets, and the method used to reach history (2026-08-11)

**Tree-wide pass (task 2.1): 996 scan units.**

- **498 working-tree files** — everything `git ls-files` returns, plus the five untracked paths of this
  spec's own directory added explicitly per consequence C1, minus the binary extensions AC18's own
  `BINARY_EXTENSIONS` reasoning excludes.
- **498 history blob versions** over `origin/master..HEAD` — unique path+blob pairs, so a file touched
  in eleven commits contributes eleven units rather than one.
- Unreadable units: **0**.

**How history was reached, and how the method was checked.** `git rev-list --objects origin/master..HEAD`
enumerated the path-bearing objects; `git cat-file --batch-check` separated blobs from trees;
`git cat-file --batch` produced the bodies. That walk was then cross-checked against an independent
enumeration, `git diff --name-only origin/master HEAD`: **every path the diff reports was covered by
the object walk, 0 misses.** Two methods agreeing is the reason the coverage claim is stated at all;
one method agreeing with itself would not be evidence.

**`.kiro/**` pass (task 2.2): 111 scan units** — 43 tracked paths, the 5 untracked spec paths, and 63
history versions. Coverage gap against the same cross-check: **0**.

### Observation 8 — the four Disclosure_Shapes, both passes (2026-08-11)

Counts and paths only; no matched value appears here or appeared in either pass's output.

| Shape | Tree-wide (996 units) | `.kiro/**` (111 units) |
|---|---|---|
| **(a)** life bot display name / handle | **0** | **0** |
| **(b)** numeric messaging user id, 8–10 digits | 126 heuristic hits / 24 paths; **0** exact identifiers | **0** |
| **(c)** hostname / IPv4 / hosting-provider address | 1337 heuristic hits / 76 paths; one exact class fires | 17 hits / 8 paths |
| **(d)** 40-char mixed-case token that is not a git hash | 17, `package-lock.json` only | **0** |

**Both fail-closed shapes are zero, in both passes.** That is the finding the gate turns on.

### Observation 9 — what each shape's hits actually are, judged (2026-08-11)

**(a) — zero, and the zero is load-bearing.** All four life-bot needle classes were exercised against
the local file that holds them as a positive control before the tree was scanned; all four fired
there. A needle set that matches nothing would produce a clean sweep for the wrong reason, so the
control is the point. Separately, the sweep was extended to `git rev-list --objects --all`
(**1156** non-binary blobs) and returned **0** there too — so the life-bot-name finding recorded by an
earlier, different sweep is **absent from all reachable history**, not merely absent from this range.

**(b) — 126 hits, none of them an identifier.** Every hit was classified and none is a messaging
identifier: benchmark token counts; a question id inside a citation URL; the redaction guards' own
fixtures, which must contain identifier-shaped text in order to prove they redact it; synthetic
8-digit `accountIdentifier` values in demo and test fixtures; pseudo-random-number-generator
constants; digit runs that fall inside 64-character hex digests; and 6 `YYYYMMDD` dates. **Exact known
numeric messaging identifiers: 0. Hits sitting in an identifier-named field: 0.**

**(c) — one exact class fires, and it is the hosting provider's brand name.** Of the exact
host-particular classes, **host name (full), host name first label, host base domain, IPv4, IPv6 and
IPv6 prefix are all 0.** The brand name accounts for 118 hits across 12 units. Of 45 address literals:
25 are the wildcard bind address, 10 loopback, 6 private-range, and **4 are routable-looking** — those
4 are negative-test payloads in `datasetIntegrity.test.ts` and `provisionalRegistry.test.ts` that exist
to prove the scanner catches an address. A scanner test that contained no address would prove nothing.

**(d) — 17 hits, all in `package-lock.json`.** 9 are filename or path segments, 5 are lockfile
integrity fields, and 3 sit confirmed inside an `"integrity": "sha512-…"` value.

### Observation 10 — the brand-name hit is adjudicated a false positive (2026-08-11)

This is the only exact-particular class that fires anywhere, so it was checked against the actual ban
list rather than against a recollection of it. Steering §0b enumerates six things that must never
appear in a tracked file: hostnames or domains; the secret webhook path segments; bot usernames, bot
ids or numeric messaging user ids; storage folder ids, file ids or account addresses; server IP
addresses, SSH ports or the backup public key; and any real amount, balance, account identifier,
payee or journal excerpt in a fixture. **A hosting provider's brand name is on none of the six.**
Independently, AC18's own vocabulary in `deploymentParticulars.ts` carries no `provider`, `brand` or
`hosting` notion at all, so the check that governs this area does not treat it as a particular either.

**The residual cost, named rather than waved away.** Knowing which provider hosts a system narrows an
attacker's search space a little: it tells them which address ranges and which control-plane to think
about. That is a real if small reduction in obscurity. It is accepted because §0b's threat model is
explicit that the architecture may be public and only the particulars may not be — an attacker who
knows the provider still cannot reach or impersonate the deployment without a host, an address, a path
segment, an id or a credential, and **every one of those measured zero.**

**Conclusion: no correction is owed, and none was made.** Nothing in the tree was edited for this
finding. In particular `design.md`, which carries the single `.kiro/**`-scoped brand-name hit that is
not in an older spec, was left exactly as written: rewriting a design document to satisfy a sweep it
passed would destroy evidence to remove nothing.

### Observation 11 — `TELEGRAM_VALUE_LEDGER.md` carries no value (2026-08-11)

Read in full because its name invites the opposite assumption. It is a table of **entry names** with,
per row, the gate that produces the entry, whether it is secret, the file that owns it, and the command
that verifies it. **No row carries a value.** Its single shape (c) hit is the messaging provider's
public documented API base — a fact about the provider, not about this deployment.

### Observation 12 — the independent spot-check of the load-bearing claims (2026-08-11)

Task 2.3 re-derived the claims whose being wrong would matter most, by a route deliberately unlike the
one the earlier passes used, on the principle that a report confirming itself is not a check.

**What was re-derived, and how the route differs.** The earlier passes derived their bot needles from
**one** comment-line pattern in the secrets file. Had that pattern failed to match, the needle set
would have been empty and the sweep would have reported a clean tree for the worst possible reason.
This pass therefore (i) measured that pattern's match count directly, (ii) re-derived host needles by
walking **every** string and numeric value of the host record recursively rather than by naming four
known keys, and (iii) widened the bot needle set with derived forms the earlier passes did not carry —
a handle stem, a display name with whitespace removed, and a display name with spaces replaced by
underscores.

**Results.**

- The identity pattern matches **2** times, and the credential-prefix pattern matches **2** times. The
  earlier passes' needle sets were **not** empty. The empty-needle false clean is ruled out at source.
- **12 bot-identity needle classes** — both sides' handle, handle stem, display name, display name
  without whitespace, display name underscored, and both numeric messaging ids — produce **0 hits**
  across all 996 units and **0** under `.kiro/**`.
- **8 host-particular needle classes** — host name full, first label and base domain, IPv4, IPv6, IPv6
  prefix, the key path and the datacentre location — produce **0 hits** across all 996 units and **0**
  under `.kiro/**`.
- The brand-name class produces **118** hits tree-wide and **3** under `.kiro/**`, reproducing the
  earlier passes' figures exactly by a different derivation.
- Per document: `requirements.md`, `tasks.md`, `.config.kiro` and this `RUN_LOG.md` carry **zero** of
  any particular class. `design.md` carries **exactly one**, the brand name. This reproduces task 2.2's
  reading.
- Across **all** reachable history (1156 non-binary blobs), the only needles that fire at all are two
  single words drawn from a display name, and their distribution proves what they are: they appear in
  `.eslintrc.cjs`, `index.html`, `package.json`, `vite.config.ts`, the money core and the research
  notes. A bot display name does not appear in a linter configuration. They are project and domain
  vocabulary that happens to be a substring of a name, and neither is a bot identity.

**Three controls, because a zero is only worth what the matcher behind it is worth.**

- **Positive, at source** — each needle was matched against the file it came from; all fired, except
  the two forms that are derived rather than verbatim, which cannot appear verbatim by construction.
- **Positive, through the loop** — each needle was planted into a synthetic in-memory scan unit and the
  **same** scan loop was asked to find it. **0 needles were missed.** This is the control that catches
  the three ways a clean can be false: an empty unit list, a needle set that is never applied, and a
  broken matcher.
- **Negative** — a canary string that exists nowhere returned **0** across all 996 units, so the
  matcher is not indiscriminately reporting hits.

**Two deltas from the earlier reports, neither consequential.** The recursive walk of the host record
found two firing values the earlier passes did not enumerate, because they had named only four keys:
the operating-system name and version (1 hit, in the architecture document) and three values that are
ordinary English words also used as field values. An OS version is on none of §0b's six items and
reveals nothing about reachability. The earlier reports are **narrower than the truth, not wrong about
it**, and the wider truth is still clean.

### Observation 13 — AC18 is unmodified (2026-08-11)

Checked by byte identity against the index rather than by reading the files, because "it looks the
same" is not a measurement.

```
$ git hash-object scripts/verify/no-deployment-particular.mjs   == git rev-parse HEAD:<same>   -> equal
$ git hash-object src/server/ops/deploymentParticulars.ts       == git rev-parse HEAD:<same>   -> equal
$ git hash-object scripts/verify/all.mjs                        == git rev-parse HEAD:<same>   -> equal

$ git status --porcelain -- scripts src        (empty)
$ git diff --stat        -- scripts src        (empty)
$ git diff --cached --stat                     (empty)
```

The most recent commit touching any of the three is **not** HEAD and predates STEP 1, so no commit of
this run touched them either. `SCAN_ROOTS` still reads `['ops', 'src/server/mocks/fixtures']` and the
AC04 floor still reads `--min 2301`. **Scan roots unchanged, allowlist unchanged, floor unchanged —
defect class F25 not incurred.**

Two of the three differ from `origin/master`, which is expected and is not a STEP 1 change: they were
edited inside the 47 commits that are already ahead of the remote.

### Observation 14 — the gate decision (2026-08-11)

**STEP 1's gate is OPEN.** R2.7 holds the run at STEP 1 while any shape (a) or (b) hit remains
uncorrected and unanswered. Both shapes measured **0**, tree-wide and under `.kiro/**`, on two
independent derivations, with the positive controls that make a zero mean something. There is no
(a) or (b) hit to correct, so there is nothing for the Operator to answer, and the condition R2.7
holds on is not satisfied.

Shapes (c) and (d) are reported and judged rather than auto-failed, which is what task 2.3 specifies.
Their judgements are Observations 9, 10 and 12.

**What this unblocks and what it does not.** STEP 2 and STEP 3 are no longer blocked *by STEP 1*.
STEP 2 remains its own hard gate at 20 of 20 (R3.4), and STEP 3 remains blocked until STEP 2 passes.
Consequence C2 above still stands: the Operator's decision about whether to commit this spec before
the push has not been taken, and STEP 3 does not proceed on an assumption about it.

### Observation 15 — writing this section changed this file's own sweep result (2026-08-11)

Task 2.2 measured this `RUN_LOG.md` clean of all four shapes. That reading was taken **before** the
text above existed. The reading is not rewritten; this entry records what the write did, which is the
convention this file's header declares.

The text above was composed to carry no particular — every credential, host, address, bot and
identifier is referred to by role or by `<ENTRY_NAME>`, and the hosting provider is referred to as
"the hosting provider" rather than by name. Observation 16 records the re-run that checks that claim
instead of asserting it.

---

## Declared limitations of STEP 1 (R22.6)

**Verified by opening the system of record:**

- the two scan-set sizes and the zero coverage gap, from the object walk cross-checked against
  `git diff --name-only`;
- the four shape counts for both passes, from the sweep outputs;
- shape (a) zero and exact shape (b) zero, re-derived independently at task 2.3 with a positive
  control at source, a positive control through the scan loop, and a negative canary;
- every exact host-particular class other than the brand name at zero, re-derived by a recursive walk
  of the whole host record;
- AC18 byte-identical to the index, and its scan roots, allowlist and test floor unchanged.

**NOT verified, stated as a limitation:**

- **History coverage is `origin/master..HEAD` only.** Both passes read the 47 commits ahead of the
  remote. A particular that already sits in a commit **at or behind** `origin/master` is caught by
  **neither pass** — it is already published, and this sweep would not see it. The task-2.3
  spot-check widened shapes (a) and (b) to all reachable history and found zero there, so that
  specific exposure is closed for the two fail-closed shapes; **it is not closed for shapes (c) and
  (d)**, which were measured over the range only.
- **Shape (c)'s hostname half is a heuristic, not an oracle.** It matches dotted tokens whose last
  label looks like a top-level domain, then buckets them. A hostname written in a form the pattern
  does not recognise — split across lines, obfuscated, percent-encoded, or assembled at runtime from
  parts — would not be counted. The *exact-needle* half of shape (c) has no such weakness for the
  particulars actually in the host record, and that half is zero; the heuristic half is what carries
  the 1337 and what needed judging.
- **Shape (d)'s exclusion of git hashes rests on case.** Git object hashes are lowercase hex, so a
  mixed-case requirement separates them. A 40-character all-lowercase secret would be indistinguishable
  from an object hash by that rule and would not be counted.
- **Binary files were skipped**, following AC18's own reasoning. A particular embedded in an image or
  an archive is outside both passes.
- **The brand-name adjudication is a judgement, not a measurement.** It was checked against §0b's
  actual six-item list and against AC18's vocabulary, and its residual cost is named in Observation 10;
  but it is the Operator's call to overturn, and overturning it would mean editing tracked documents
  the run has otherwise left alone.
- **These entries were written after the readings were taken**, by task 2.3 rather than by the passes
  that measured them, for the reason given at the head of this section.

**Untouched by STEP 1:** the money, credential and isolation invariants. No credential was read into
any output, no host was contacted, no store was opened, no value was printed. Nothing was committed.
All scratch work stayed under `.loop/tmp/`, which is gitignored at `.gitignore:39`.

---

## STEP 1 — completion

### Observation 16 — the sweep re-run after this file was written (2026-08-11)

Task 2.3 requires the sweep re-run after a correction. No correction was owed, so what was re-run is
the one thing that **did** change: this file. Both halves were re-measured over the same 996 scan
units, with this section's predecessor already on disk.

**Exact-needle half — the particulars themselves:**

```
units: total 996, .kiro/** 111
bot identity classes tested: 12   -> hits, whole scan set: 0    .kiro/** only: 0
host-particular classes tested: 8 -> hits, whole scan set: 0    .kiro/** only: 0
hosting provider brand name       -> hits, whole scan set: 118  .kiro/** only: 3

requirements.md   identity 0   host-particular 0   brand name 0
design.md         identity 0   host-particular 0   brand name 1
tasks.md          identity 0   host-particular 0   brand name 0
.config.kiro      identity 0   host-particular 0   brand name 0
RUN_LOG.md        identity 0   host-particular 0   brand name 0
```

**Heuristic half — the four shape patterns, over this spec's five documents:**

```
requirements.md  (b) 0   (c) dotted 0   (c) addresses 0   (d) 0
design.md        (b) 0   (c) dotted 0   (c) addresses 0   (d) 0
tasks.md         (b) 0   (c) dotted 0   (c) addresses 0   (d) 0
.config.kiro     (b) 0   (c) dotted 0   (c) addresses 0   (d) 0
RUN_LOG.md       (b) 0   (c) dotted 0   (c) addresses 0   (d) 0
```

**Every figure is unchanged from before this file was written**, and this file is still clean of all
four shapes. Observation 15's claim is therefore measured rather than asserted. The 118 and the 3 are
identical to the pre-write readings, so nothing added here introduced a hit of any kind.

### Observation 17 — STEP 1 completion timestamp (2026-08-11)

```
STEP 1 completed at  2026-08-11T07:42:20Z   (UTC)
local clock read     2026-08-11T10:42:20+03:00
```

Both are recorded for the same reason the header records both: a reader comparing this to a local
timestamp elsewhere should not have to guess the convention.

**STEP 1 gate: OPEN.** Shapes (a) and (b) are zero, so R2.7's holding condition is not satisfied and
STEP 2 may proceed. STEP 2's own 20-of-20 gate (R3.4) and consequence C2's untaken Operator decision
are both still in force and neither is disturbed by this.

---

## STEP 2 — one full harness run, immediately before the push

### Observation 18 — the harness ran once and returned 16 of 20 (2026-08-11)

`npm run verify:all -- --all` was invoked **exactly once** (R3.1, R3.5, R18.4), with its output
redirected to `.loop/tmp/verify-step2.out` (gitignored at `.gitignore:39`). `npm run test` was not
invoked separately. Process exit status was `1`.

The harness's **two summary lines, verbatim** (R3.3), from lines 45 and 47 of that file:

```
verification harness: 16 of 20 executed checks passed
```

```
HARNESS FAILED at AC16: toolchain pin, lockfile and launch path
```

**Tally: 16 of 20.** The 20-of-20 line required by R3.2 was **not** printed. This confirms the
task-3.1 premise that the gate is real rather than a formality.

### Observation 19 — the four failing check identifiers, and what each read (2026-08-11)

Failing: **AC16**, **AC04**, **AC14**, **AC15**. Sixteen passed: AC01, AC02, AC03, AC05, AC05b, AC06,
AC07, AC08, AC08b, AC09, AC10, AC11, AC12, AC13, AC18, LOOP.

**AC16 — toolchain pin, lockfile and launch path.** One finding, quoted:

```
FAIL AC16  toolchain pin, lockfile and launch path
      lockfile version: 3
      relative specifiers checked: 872 across 305 source file(s)
      entrypoints launched with bare node: 7 of 7
      detector proved live: an extensionless relative import still fails under v24.14.1
      FAIL toolchain pin and lockfile make a fresh clone reproducible, and the pinned runtime starts every entrypoint: 1 finding(s)
        - src/features/import/ledgerImportStrict.test.ts:25 imports "./ledgerImport" with no extension; Node performs no extension search, so bare `node` cannot start any module that reaches this one (finding F20)
```

Read directly, the cited file does carry `} from './ledgerImport';` with no extension. The finding is
a real property of a tracked file at HEAD `24c432a`, not a harness artefact.

**AC04 — test suite passes and meets its size floor.** Quoted:

```
FAIL AC04  test suite passes and meets its size floor
      test files: 626
      tests:      2389 total, 2385 passed, 4 failed
      minimum:    2301
      FAIL 4 test(s) are failing
```

AC04 fails on **health, not on size** — see Observation 20 for the count against the floor. The four
failing tests were read from the runner's own machine report at `.loop/tmp/test-results.json`, which
`scripts/verify/testcount.mjs` writes, so their identities were obtained **without a second suite
run**:

```
src/server/ops/launchPath.test.ts
  - carries an extension in every file under src and tests
    extensionless relative specifiers: expected [ Array(1) ] to deeply equal []

src/server/ops/runbookTemplate.test.ts
  - produces no finding at all
    expected [ Array(1) ] to deeply equal []
  - records the migration version the series is at
    expected '# Rollback runbook - reverting a depl...' to contain 'version:** 008'
  - the file entry point agrees with the text entry point on the real documents
    expected [ { ...(2) } ] to deeply equal []
```

`launchPath.test.ts` is the same defect AC16 reports, counted a second time by the suite — one root
cause, two checks. The three `runbookTemplate.test.ts` failures are a separate root cause about the
runbook documents on disk: one unnamed finding, a migration version the rollback runbook does not
record, and an entry-point disagreement between a runbook's file and its text.

**AC14 — working tree is clean.** Quoted:

```
FAIL AC14  working tree is clean
      entries: 1
      FAIL working tree is clean: 1 finding(s)
        - uncommitted entry: ?? .kiro/specs/ship-run-live-bringup/
```

The one entry is **this spec's own document set**, exactly as Observation 1 measured it at STEP 0.

**AC15 — repository is push ready and unpushed.** Quoted:

```
FAIL AC15  repository is push ready and unpushed
      remotes:         origin
      remote branches: origin/HEAD -> origin/master, origin/master
      working tree:    dirty
      release state:   released (push acknowledged in the checklist)
      FAIL repository release state is deliberate and recorded: 1 finding(s)
        - the working tree is not clean: 1 entry(ies)
```

AC15's sole finding is the dirty tree, so it is a **cascade of AC14** and not an independent defect.

### Observation 20 — the test count against the Test_Floor (2026-08-11)

```
observed total tests   2389
observed passed        2385
Test_Floor (AC04 --min) 2301
margin, total vs floor  +88
margin, passed vs floor +84
```

The floor was **neither raised nor lowered** (R17.1, R17.2, R24.3). `scripts/verify/all.mjs:23` still
reads `--min 2301` and was not edited. The floor is not what AC04 failed on; four failing tests are.
Recorded here so a later reader does not mistake the +88 margin for a passing AC04.

### Observation 21 — the ordering finding AC14/AC15 expose (2026-08-11)

Named because the Operator needs it before deciding how to proceed, and because it is a property of
the plan rather than of the tree.

R3.2 requires 20 of 20 **before** STEP 3 executes. AC14 requires a clean tree, and AC15 requires it
transitively. The only thing making the tree dirty is this spec's own five documents, and the step
that would commit them is STEP 3 — which R3.2 gates on the harness first. So **as long as this spec's
documents are uncommitted, the harness cannot reach 20 of 20 at the point in the order where STEP 2
runs.** Two of the four failures are therefore structural to the sequence, and two (AC16, and the
three `runbookTemplate` tests inside AC04) are genuine defects in tracked files that no ordering
change would clear.

**Nothing was done about any of the four.** No `eslint-disable` was added, no allowlist or scan root
was widened, no floor was moved, no check was weakened, no file was committed (R17.2, R17.4, R17.5,
R17.6, F25). The failures are reported as the finding.

### Observation 22 — STEP 2 verdict and completion timestamp (2026-08-11)

```
STEP 2 completed at  2026-08-11T07:50:20Z   (UTC)
local clock read     2026-08-11T10:50:20+03:00
```

**STEP 2 gate: CLOSED.** 16 of 20 executed checks passed, so R3.2 is not satisfied and R3.4 applies:
the failing check identifiers are reported above and **STEP 3 SHALL NOT execute**. Task 3.1 stays
untickable and task 4 (the push) is not cleared. The STEP 1 gate remains open (Observation 17); it is
not disturbed by this, and it does not substitute for this one.

**Untouched by STEP 2:** the money, credential and isolation invariants. No credential was read into
any output, no host was contacted, no store was opened, no network call was made, no value was
printed. Nothing was committed and nothing was pushed. All scratch output stayed under `.loop/tmp/`.
