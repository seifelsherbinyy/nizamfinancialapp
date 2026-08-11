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

## STEP 2 — remediation and re-run

Append-only, as the rest of this file: nothing above this heading was rewritten. Observation 22 stands
as the record of the **first** harness run and its 16 of 20. This section records the remediation and
the **second** run, and supersedes Observation 22's verdict without editing it.

### Observation 23 — the deviation from "one full suite per run", stated rather than left implicit (2026-08-11)

R3.5 and R18.4 budget the full suite at **once per run** to protect the time box, and the first run
already spent that budget. They do **not** cap remediation at one attempt. The loop protocol
(`.kiro/steering/loop-protocol.md` step 4) requires diagnose → fix → re-verify until green and
forbids advancing with a red gate, and `pfos-current.md`'s per-increment loop ends on 20/20.

**The deviation, named:** the full suite executed **twice** this session — once at the first STEP 2 run
and once at the re-run recorded below. The alternative was advancing on a red gate, which R3.4 forbids
outright. Between the two runs, verification was **narrow**: `npm run typecheck`, `npm run lint`, and
vitest on the touched files only. The full suite was not run between fixes.

### Observation 24 — the four failures, their root causes, and the fixes (2026-08-11)

**Nothing was weakened to close any of them.** No `eslint-disable` was added anywhere. The AC04 floor
was not lowered and not raised — `scripts/verify/all.mjs:23` still reads `--min 2301`. No guard's
allowlist and no scan root was widened, AC16's and AC18's included. No test was skipped, marked
`.skip`/`.todo`, deleted or loosened. No check was edited to stop it detecting what it detects.

**1. AC16 — the extensionless relative specifier (F20 class).**

- **Finding:** `src/features/import/ledgerImportStrict.test.ts:25` imported `./ledgerImport` with no
  extension.
- **Root cause:** `package.json` declares `"type": "module"` with `engines.node >=24 <25` and native
  type stripping. Node's ESM resolver performs **no extension search**, so bare `node` cannot start any
  module graph that reaches this file. The project's own convention — explicit relative specifiers
  carrying `.ts` — was not followed on this one line. Vitest resolves it, which is why 2385 other tests
  were green while it was true: a different resolver from the one a container has.
- **Fix:** the specifier now names its file — `./ledgerImport.ts`. One character class of change, in
  the code, not in the check.
- **Confirmed sole occurrence:** the tree was re-scanned with AC16's own rule after the fix —
  **872 relative specifiers across 305 source files, 0 extensionless.** The 872 figure reproduces
  AC16's own count exactly, so the scan is the same scan.

**2. AC04 — `launchPath.test.ts`, "carries an extension in every file under src and tests".**

- **Root cause:** the same single specifier. This test asserts specifier SHAPE over the tree, so it was
  reporting the same defect AC16 reported, from inside the suite.
- **Fix:** none of its own. It went green on the AC16 fix, which is the correct outcome for a test that
  reads the tree rather than a module.

**3. AC04 — `runbookTemplate.test.ts`, three failures with one root cause.**

The three were: "produces no finding at all"; "records the migration version the series is at"
(`expected … to contain 'version:** 008'`); and "the file entry point agrees with the text entry point
on the real documents". All three reported the **same** audit finding:

```
MIGRATION_VERSION_STALE: ROLLBACK.md records version 7 as the latest applied migration; the
migration series is at 8, and a rollback that targets the wrong version targets the wrong store
```

- **Root cause:** `src/server/db/migrations.ts` is the system of record for the series and ends at
  `{ version: 8, name: 'ingestion_provenance_and_document_sets' }` — added for spec 08 wave A2/A4.
  `ops/runbook/ROLLBACK.md` still recorded `**Latest applied migration version:** 007`. The runbook had
  gone stale behind the migrations, exactly as the audit's own comment says it would.
- **Fix, in the direction that keeps the authoritative artifact authoritative:** the **document** was
  updated to 008. The test's expectation was **not** changed to match the stale document — it was
  already derived from `EXPECTED_SCHEMA_VERSION`, which reads the head of `MIGRATIONS`.
- **Second, smaller cause, fixed too:** the test held the version as a **literal** in its negative-case
  anchor (`RECORDED_VERSION = '… 007'`). That literal is what let the rot happen quietly — a fixture
  quoting a document, going stale with it. It now reads the number from `EXPECTED_SCHEMA_VERSION`, and
  the stale negative case is derived one version **behind** the head rather than pinned at `006`. Both
  negative cases still fire `MIGRATION_VERSION_STALE`; the rule is untouched and no assertion was
  relaxed.

**4. AC14, and AC15 as its cascade — the uncommitted spec documents.**

- **Root cause:** the structural ordering finding of Observation 21. The five documents under
  `.kiro/specs/ship-run-live-bringup/` were the only entries dirtying the tree, and the step that would
  commit them sat behind the gate that requires them committed.
- **Fix:** the Operator authorised the commit. The five paths were staged **specifically** — no
  `git add .` — and `git status` was read before committing to confirm only those five were staged.
  Nothing under `.loop/`, `.secrets/`, `artifacts/` or any filled env file was staged; `.loop/` is
  gitignored and `git status --porcelain` confirmed it never appeared.
- **What the commit publishes is what STEP 1 already measured:** shape (a) 0, shape (b) 0, shape (d) 0,
  and shape (c) 0 for four of the five, with `design.md` carrying exactly one hit — the hosting
  provider's brand name, adjudicated a false positive against steering §0b's six-item ban list, which
  does not list a provider's brand. The re-run after `RUN_LOG.md` was written reproduced every figure.

### Observation 25 — the commits (2026-08-11)

Three commits, in this order. The two fixes were kept separate from the documents so a later reader can
revert one without the other.

```
d08a136  fix(import): Name the file in the last extensionless specifier
67b90f0  fix(runbook): Record migration 008 as the latest applied version
177238a  docs(spec): Add ship-run-live-bringup spec and run log
```

`177238a` is the commit the harness was then run against. Its full object identifier:

```
177238aa0eae2a16e809e0cfb56dcdc6ff0e1fa6
```

It contains **exactly five paths**, all additions, all under this spec's directory:

```
.kiro/specs/ship-run-live-bringup/.config.kiro
.kiro/specs/ship-run-live-bringup/RUN_LOG.md
.kiro/specs/ship-run-live-bringup/design.md
.kiro/specs/ship-run-live-bringup/requirements.md
.kiro/specs/ship-run-live-bringup/tasks.md
```

**Nothing was pushed.** STEP 3 is task 4 and was not executed here.

### Observation 26 — the re-run, verbatim (2026-08-11)

`npm run verify:all -- --all`, once, captured to `.loop/tmp/verify-step2-rerun.out`. The harness's two
summary lines, verbatim:

```
verification harness: 20 of 20 executed checks passed
HARNESS PASSED: every acceptance check is green.
```

All twenty checks reported PASS, the four that had failed among them: AC16, AC04, AC14, AC15.

### Observation 27 — the test count against the Test_Floor (2026-08-11)

```
observed total tests    2389
observed passed         2389
observed failed            0
Test_Floor (AC04 --min) 2301
margin, total vs floor   +88
margin, passed vs floor  +88
```

The total is **unchanged** at 2389: no test was added and none removed, so the same 2389 tests the first
run measured now all pass. The passed count closed the gap of 4, and the passed-vs-floor margin closed
from +84 to +88. A passing AC04 prints no counts, so the total is carried from the first run's measured
`2389 total` together with the observation that no test file gained or lost a case — `launchPath` 19,
`ledgerImportStrict` 24, `runbookTemplate` 69, before and after. **The floor was neither raised nor
lowered** (R17.1, R17.2, R24.3).

### Observation 28 — STEP 2 verdict, revised, and completion timestamp (2026-08-11)

```
STEP 2 re-run completed at  2026-08-11T08:04:50Z   (UTC)
local clock read            2026-08-11T11:04:50+03:00
```

**STEP 2 gate: PASSED.** R3.2 is satisfied — 20 of 20 executed checks passed. R3.4 no longer applies.
This **supersedes Observation 22's CLOSED verdict**, which recorded the first run and stays in the file
unedited, as this file's convention requires. Task 3.1 and its parent task 3 are ticked. **STEP 3
(task 4, the push) is cleared** by this gate; it is a separate task and was not executed.

The STEP 1 gate is untouched by this and is not substituted for by it (Observation 17 stands).

### Observation 29 — the tree is deliberately dirty again, and why (2026-08-11)

Recorded so a later reader does not read it as a regression. The harness ran against a **clean** tree at
`177238a`, which is what AC14 and AC15 measured. Writing this section, and ticking tasks 3 and 3.1,
modifies two tracked documents **after** that measurement:

```
 M .kiro/specs/ship-run-live-bringup/RUN_LOG.md
 M .kiro/specs/ship-run-live-bringup/tasks.md
```

This is unavoidable in the order the plan specifies: the run log records the re-run, so it cannot be
written before it. The two entries are documents only — no source file, no template, no credential, no
env file. They are STEP 3's to commit ahead of the push, and AC14 will measure the tree again there.

**Untouched by this remediation:** the money, credential and isolation invariants. No credential was
read into any output, no host was contacted, no store was opened, no network call was made, no value was
printed. Nothing was pushed. All scratch output stayed under `.loop/tmp/`.

---

## STEP 3 — the push and its verification

Append-only, as the rest of this file: nothing above this heading was rewritten. This is the **only
irreversible step in the run**. What ships is history, not the working tree.

### Observation 30 — the pre-push commit, and the clean-tree reading (2026-08-11)

Observation 29 left two tracked documents modified after the harness measured a clean tree. Both are
documents the run wrote about itself, so they were committed **before** the push — publishing commits
whose own log is absent would be a worse record than publishing one commit later.

The two paths were staged **specifically**, by path, never with `git add .`, and `git status` was read
before the commit to confirm the index held **only** those two:

```
M  .kiro/specs/ship-run-live-bringup/RUN_LOG.md
M  .kiro/specs/ship-run-live-bringup/tasks.md
```

Nothing under `.loop/`, `.secrets/`, `artifacts/`, and no filled env file, was staged. The diff was
180 insertions and 2 deletions: the STEP 2 remediation section, and the two ticked checkboxes on tasks
3 and 3.1. The commit:

```
a0f5c80  docs(spec): Record STEP 2 remediation and re-run in the run log
```

Its full object identifier, which is the pre-push local head:

```
a0f5c80019f52effc85b47a09c5ed397ac14cdaa
```

`git status --porcelain` was then re-read and returned **empty**. A push does not require a clean tree;
the reading is recorded because it fixes exactly what was published.

Read from the remote **before** the push, so that the after-reading has something to be different from:

```
remote refs/heads/master (pre-push)  5498c66b1f055f871244dd2786a92ad1a9fc18a4
local  HEAD              (pre-push)  a0f5c80019f52effc85b47a09c5ed397ac14cdaa
ahead count              (pre-push)  51
```

### Observation 31 — the push command, and why its exit status is not the evidence (2026-08-11)

`git push origin master`. No `--force`, no `--force-with-lease`, no `-f`. One ref, `master`; no branch,
no tag, no other ref. No other repository was touched. The command's output:

```
5498c66..a0f5c80  master -> master
exit status 0
```

**This is not the Evidence_Of_Record for a completed push** (R4.5). It is the pushing process's own
report of its own work, which is the exact shape of claim this run is built to refuse. A successful
command is not a confirmed state. What follows in Observation 32 is the evidence.

One note on the transcript so a later reader does not misread it: the shell surfaced git's progress
output, which git writes to stderr, wrapped as a native-command error. The exit status was **0** and the
ref update line printed. The wrapper is the shell's handling of stderr, not a push failure.

### Observation 32 — the Push_Verifier, read from the remote (2026-08-11)

The reference was re-read **from the remote** with `git ls-remote origin refs/heads/master`, which asks
the remote directly rather than reading a local tracking reference that may be stale. That distinction
is the whole of this task. A second, independent route — `git fetch origin` then
`git rev-parse origin/master` — was taken as a cross-check, and agreed.

```
remote object identifier (ls-remote)   a0f5c80019f52effc85b47a09c5ed397ac14cdaa
remote object identifier (fetch+parse) a0f5c80019f52effc85b47a09c5ed397ac14cdaa
local  object identifier (HEAD)        a0f5c80019f52effc85b47a09c5ed397ac14cdaa
equal                                  YES
ahead count  origin/master..HEAD       0
behind count HEAD..origin/master       0
```

**Push_Verifier: PASS.** R4.2 and R4.3 are satisfied — the remote head equals the local head and the
ahead count reads 0. R4.4 does not apply; had the identifiers differed, both plus the remaining ahead
count would stand here as a **failure**, not as a success with a caveat, and no force, amend or reset
would have been attempted.

**On the count, measured rather than predicted.** 51 commits landed in the pushed range
`5498c66..a0f5c80`, confirmed by `git rev-list --count` over it. That reconciles with the run's own
arithmetic — 47 ahead at the start of the run, three added by the STEP 2 remediation (Observation 25),
and this one — but the figure recorded here is the one that was counted, not the one that was expected.

### Observation 33 — STEP 3 verdict and completion timestamp (2026-08-11)

```
STEP 3 completed at   2026-08-11T08:11:32Z   (UTC)
local clock read      2026-08-11T11:11:32+03:00
```

**STEP 3: PASSED.** Finance_Repo is pushed to `origin master` and the push is confirmed against the
remote. Priority-one of the three objectives is shipped. Tasks 4, 4.1 and 4.2 are ticked, on the
strength of Observation 32's equality and nothing else.

**Untouched by this step:** the money, credential and isolation invariants. No credential was read into
any output, no host was contacted beyond the repository remote, no store was opened, no model call was
made, no value was printed. `requirements.md` and `design.md` were not modified. The Test_Floor was not
lowered, no `eslint-disable` was added, no guard was widened, and the full suite was not re-run — STEP 2
is settled at Observation 28.

### Observation 34 — the tree is dirty again, for the same reason as Observation 29 (2026-08-11)

Recorded so a later reader does not read it as a regression, exactly as Observation 29 records it for
STEP 2. Writing this section, and ticking tasks 4, 4.1 and 4.2, modifies the same two tracked documents
**after** the push that published them:

```
 M .kiro/specs/ship-run-live-bringup/RUN_LOG.md
 M .kiro/specs/ship-run-live-bringup/tasks.md
```

This is unavoidable in the order the plan specifies: the log records the push, so it cannot be written
before it. Both are documents only — no source file, no template, no credential, no env file. They are
left **uncommitted** for a later step to carry.

## STEP 4 — the other repository's first observed suite run

### Observation 35 — Nizamcore_Clone created, and proven outside both excluded paths (2026-08-11)

A writable clone was taken as a **sibling of the repository root**, not inside it. Both exclusions that
task 5.1 names were checked by resolved-path comparison rather than by eye, because the whole point of
the second one is that a read-only copy must not be silently reused as if it were the writable one.

```
clone destination           <HOME>/nizamcore-writable
Finance_Repo root           <HOME>/NIZAM
destination inside root     False
earlier read-only copy      <TEMP>/nizamcore-readonly-A1
destination == read-only    False
```

Absolute paths are recorded here in the placeholder shape this log has used throughout; the two facts
that matter are the two booleans, and both were measured, not assumed.

**What the clone is, measured against `ops/NIZAMCORE_VERIFIED_STATE.md` §Provenance:**

```
branch                      main
head                        071e54c2d4cfcf7258471e4abb845542df113e8f
last commit date            2026-05-29T13:12:23+03:00
tracked files               313
```

All four agree with §Provenance — commit `071e54c`, 313 files, last commit dated 2026-05-29. So the
clone is the same object the verified-state document was written from, and the counts below are being
observed on the same bytes that were previously only read. The origin was the remote recorded in the
read-only copy; it is named here as `<NIZAMCORE_ORIGIN>` rather than reproduced, in keeping with this
log's practice of carrying no host.

**A clone is a read** under steering §2a, which is the authority this step rests on. No modify, no push.

**Finance_Repo was not disturbed by it.** `git status --porcelain` in Finance_Repo reads two lines, and
they are the same two documents Observation 34 already names for the same reason. No untracked entry
appeared, and the head is unchanged at `a0f5c80019f52effc85b47a09c5ed397ac14cdaa`. A clone landing
outside the tracked tree cannot add to it, and the check confirms it rather than resting on that.

### Observation 36 — the standard-library path, tried first, and what it did (2026-08-11)

Task 5.2 requires the cheapest path first, because §3 records the relay as pure standard library with no
installed dependencies. A Python interpreter is present — **Python 3.13.2 on PATH** — so the first
finding is that the interpreter is not the obstacle.

Root-level discovery collects nothing, and the reason is specific rather than general:

```
python -m unittest discover -t . -s . -p "test_*.py"      exit 5    Ran 0 tests   NO TESTS RAN
```

**The single blocked step: recursion stops at the first non-package directory.** `unittest discover`
descends only into importable packages, and that repository's test directories carry no `__init__.py`.
This is a property of the invocation, not of the suite — the same tests run when pointed at their own
directories, as the next three lines show. Recording it as "the suite does not collect" would have been
wrong.

```
python -m unittest discover -t . -s NIZAM__system/relay/tests    -p "test_*.py"   exit 0   Ran 29   OK
python -m unittest discover -t . -s NIZAM__system/governor/tests -p "test_*.py"   exit 0   Ran 26   OK
python -m unittest discover -t . -s HIFZ__github_version_control/scripts -p "..." exit 1   ImportError
                                    ImportError: Start directory is not importable
python HIFZ__github_version_control/scripts/test_governor_lib.py                  exit 0   7 OK lines
```

The fourth line is the same non-package cause as the first; that file is a script with its own
`__main__` runner and seven plain test functions, so invoking it directly is the correct call and it
passes. **Standard-library subtotal: 62 tests, 62 passing, zero packages installed.**

### Observation 37 — the whole suite, one command, first observed execution (2026-08-11)

The remaining 81 tests live under the flight-radar subtree and import `pytest`, so the standard-library
path cannot reach them. **No install proved necessary**: `pytest 9.0.0` was already present on the
machine, so the measured install cost of this run is **zero packages**. One command from the clone root
therefore covers everything:

```
command    python -m pytest -q -p no:cacheprovider        (cwd = clone root)
exit       0
collected  143
result     143 passed, 1 warning, 14 subtests passed in 2.50s
failed 0   errored 0   skipped 0
```

Collection was confirmed separately — `--collect-only -q` reports `143 tests collected` — so the total
is a collected total and not inferred from the passing total. **143 is exactly the figure §Provenance
records**, and independently reproduced here by counting `def test_` across the fourteen test files.

**The relay tests specifically, which is what task 5.2 singles out:**

```
NIZAM__system/relay/tests/test_phase1_boot_loop.py     22 test functions
NIZAM__system/relay/tests/test_poller.py                7 test functions
                                                       -- 29 across two files (7 + 22)
python -m unittest discover ... -s NIZAM__system/relay/tests   exit 0   Ran 29   OK
python -m pytest -q ... NIZAM__system/relay/tests               exit 0   29 passed
```

**They ran and they passed, under both runners.** The 7 + 22 split §3 records is confirmed by count.

**This is the first observed execution.** `ops/NIZAMCORE_VERIFIED_STATE.md` §8 states in its own words
that "no test was run, no runner started" there, and that its counts were "read from its files, not
observed passing". As of this observation the first two bullets of §8 are superseded by measurement:
143 of 143 pass, and the 29 relay tests pass. §8's third bullet — that the declared agent-runtime
package's install cost is unmeasured — **still stands and is untouched**, because §4 gap 1 holds that no
Python module imports it, and nothing in this run needed it. That gap was not closed; it was not
reached. `ops/NIZAMCORE_VERIFIED_STATE.md` is deliberately **left unedited**: this run may append to
this log and tick this spec's `tasks.md`, and nothing else in Finance_Repo.

No network request was made by the suite. The two relay test files were read for outbound calls before
running them and contain none; the environment values they set are test literals, and the one line of
output reading like a transport failure is a fake responder's own message, not a dialled socket.

### Observation 38 — what the run left behind in the clone, and a second hygiene finding (2026-08-11)

Running a suite is not free of side effects, and reporting the counts without them would be a partial
account. Four working-tree paths were created by the run, and **all four are ignored by that
repository's own nested `.gitignore` files**, proven with `git check-ignore -v` rather than by reading
the files:

```
NIZAM__system/governor/.keys/                one Ed25519 signing key, 119 bytes
NIZAM__system/ledgers/EVENT_LEDGER.jsonl     37 lines
NIZAM__system/ledgers/STRATEGY_LEDGER.jsonl   2 lines
NIZAM__system/ledgers/sth/                   3 signed-tree-head documents
```

**The key's contents were not read** and are not reproduced. It is a **local** signing key the suite
minted for its own signed-tree-head fixture inside a clone this session created — it authorises nothing
with any third party, spends nothing and publishes nothing, so it is not the credential class steering
§2a gates. It is named here rather than omitted so the Operator can decide whether they want it removed.

This is also the run's own positive finding beyond the counts: the governor's append-only ledger and its
signed-tree-head chain are not merely authored, they **execute** — 37 ledger events and two signed tree
heads were produced.

**Second hygiene finding in that repository, alongside the one §7 already records.** Its `.gitignore`
covers `__pycache__` only under the flight-radar subtree:

```
git check-ignore -v MARSAD__flight_radar/__pycache__/x.pyc
    .gitignore:117:MARSAD__flight_radar/**/__pycache__/    MARSAD__flight_radar/__pycache__/x.pyc
git check-ignore -v NIZAM__system/relay/__pycache__/x.pyc
    (no match — not ignored)
```

So running its own suite leaves five **untracked** bytecode directories that a careless `git add -A`
there would commit. Severity is low — bytecode, not a secret — and the recommended action there is one
unscoped `__pycache__/` entry. The five directories this run created were removed, so the clone's
working tree carries no untracked path.

### Observation 39 — nothing was committed in the clone, and nothing was pushed (2026-08-11)

Task 5.3 permits a local commit and forbids a push. It also says a commit for its own sake is noise.

```
tracked files changed                 0
clone head                            071e54c2d4cfcf7258471e4abb845542df113e8f  (unchanged)
commits ahead of origin/main          0
git push in the clone                 never invoked
```

**So nothing was committed.** No source file, template, configuration or document in that repository was
created, edited, staged or committed. The only working-tree residue is the four gitignored paths
Observation 38 names, and gitignored paths cannot be committed. **No push, under any reading** — the
Operator has not said "push granted", and the clone sits level with its origin.

Spec `07-bot-bringup-v1` was **not modified**. Its record of gap A-G4 and task A5 is cited as evidence
in §10 of the verified-state document and was left exactly as it stands.

### Observation 40 — STEP 4 verdict and completion timestamp (2026-08-11)

```
STEP 4 completed at   2026-08-11T09:58:32Z   (UTC)
local clock read      2026-08-11T12:58:32+03:00
```

**STEP 4: PASSED, with a real number.** Priority-two of the three objectives is shipped, and it shipped
independently of the ladder: the other repository's suite has now been **executed** rather than read —
143 collected, 143 passed, exit 0 — and its 29 relay tests across two files pass. Tasks 5, 5.1, 5.2 and
5.3 are ticked.

**What was verified, and what was not.** Verified: the clone's identity against §Provenance on four
independent facts; both path exclusions by resolved-path comparison; Finance_Repo undisturbed; the
interpreter's presence; the collected total independently of the passing total; the relay split by count
and by two runners; the gitignore status of every path the run created, by `git check-ignore -v`. Not
verified: that the relay **works against a live provider** — every test here is offline, and a passing
transport test is not a delivered message; the install cost of the declared agent-runtime package, which
§8 leaves unmeasured and this run did not reach; and whether the suite passes on any machine other than
this one, since it was observed once, on one interpreter.

**Untouched by this step:** no credential was read into any output, no value was printed, no host was
contacted beyond the two repository remotes, no store was opened, no model call was made. The numeric
operator identifier §7 records as committed in the other repository's relay environment example was
**not reproduced**, and neither was the fake identifier its own test file sets. `requirements.md` and
`design.md` were not modified. The Test_Floor was not lowered, no `eslint-disable` was added, no guard
was widened, and the Finance_Repo suite was not re-run — STEP 2 remains settled at Observation 28.

### Observation 41 — the tree is dirty again, same two documents, same reason (2026-08-11)

For the third time, and recorded so no later reader misreads it, exactly as Observations 29 and 34 do.
Writing this section and ticking tasks 5, 5.1, 5.2 and 5.3 modifies:

```
 M .kiro/specs/ship-run-live-bringup/RUN_LOG.md
 M .kiro/specs/ship-run-live-bringup/tasks.md
```

Both are documents only — no source file, no template, no credential, no env file. They are left
**uncommitted** for a later step to carry.

## STEP 7 — the Drive audit

Read-only throughout, and the last answerable question in the run. Task 14 asks whether a
**server-side** Drive integration path exists at all — not whether Drive appears in the repository,
which it plainly does. Nothing was built (R15.4).

### Observation 42 — the four bodies of evidence, read and cited (2026-08-11)

**(1) Both environment templates hold no Drive credential entry of any kind.** Entry names were
extracted mechanically rather than read by eye, and the counts are a measured correction to the plan's
own prose:

```
ops/env/finance.env.example     17 assignment entries
ops/env/life.env.example        19 assignment entries
```

`tasks.md` 14.1 says "all 16 entries" and task 10.3 says "sixteen entries per agent". **Measured: 17
and 19.** Recorded here as an **Observation dated 2026-08-11**, not as a decision, and neither
template nor `requirements.md` nor `design.md` was edited to match it. The finance file carries one
entry more than sixteen; the life file carries three more, being the two recovery-provider entries and
the same one. The discrepancy does not affect the Drive answer, and it is written down because a count
quoted in a plan and never checked is exactly the kind of claim this run exists to stop repeating.

The names, in file order, so the absence below is checkable rather than asserted:

```
finance  FINANCE_DATA_DIR · FINANCE_STORE_FILE · STORE_BUSY_TIMEOUT_MS · FINANCE_CONTAINER_PORT
         <BOT_B_TOKEN> · <MONEY_WEBHOOK_SECRET> · <ALLOWED_USER_IDS> · MSG_API_BASE · TELEGRAM_MODE
         MAX_WORK_ITEMS · <OR_KEY_FINANCE> · MODEL_API_BASE · FINANCE_WEEKLY_CAP
         MODEL_ELIGIBILITY_REGISTRY_PATH · BUS_INTERNAL_ENDPOINT · KILL_SENTINEL_PATH · NIZAM_KILL_ALL

life     LIFE_DATA_DIR · LIFE_STORE_FILE · STORE_BUSY_TIMEOUT_MS · LIFE_CONTAINER_PORT
         <BOT_A_TOKEN> · <LIFE_WEBHOOK_SECRET> · <ALLOWED_USER_IDS> · MSG_API_BASE · TELEGRAM_MODE
         MAX_WORK_ITEMS · <OR_KEY_LIFE> · MODEL_API_BASE · LIFE_WEEKLY_CAP
         MODEL_ELIGIBILITY_REGISTRY_PATH · BUS_INTERNAL_ENDPOINT · WHOOP_API_BASE
         <WHOOP_ACCESS_TOKEN> · KILL_SENTINEL_PATH · NIZAM_KILL_ALL
```

A pattern search across both files for any entry name containing `DRIVE`, `GOOGLE`, `GDRIVE`, `OAUTH`,
`REFRESH`, `FOLDER`, `BACKUP`, `SNAPSHOT` or `AGE_` returns **0 matches**. There is no client
identifier, no refresh token, no folder reference and no recipient-key reference in either template.
Both files also say so in prose: each closes with a "what is deliberately absent" list, and the finance
file's opening paragraph states that recovery context reaches that agent as a **band on the consent
bus, never as a provider call**.

**(2) `src/lib/drive/` is browser-side, and the evidence is its globals.** Seven modules
(`oauth.ts`, `driveClient.ts`, `driveDb.ts`, `sync.ts`, `picker.ts` plus two test files). What they
reach for:

```
src/lib/drive/oauth.ts:70    window.google?.accounts?.oauth2        GIS token client
src/lib/drive/oauth.ts:75    document.createElement('script')       script tag injection
src/lib/drive/oauth.ts:79    window.google?.accounts?.oauth2
src/lib/drive/oauth.ts:84    document.head.appendChild(script)
src/lib/drive/picker.ts:56   window.gapi?.load('picker', ...)       Google Picker
src/lib/drive/picker.ts:66   document.createElement('script')
src/lib/drive/picker.ts:71   document.head.appendChild(script)
```

`window`, `document` and `document.head` do not exist in the server runtime. This is not a module that
happens to run in a browser — it is a module that **cannot** run anywhere else. Steering `tech.md`
states the same thing from the other direction: the token client is in-browser and tokens live in
memory or session, never committed.

**(3) AC08 enforces the per-file scope, and it is a browser OAuth concern.** The harness registers it as
`{ id: "AC08", label: "drive scope is per file only", cmd: node scripts/verify/drive-scope.mjs }`. That
check forbids the full-scope string literal in any non-defensive position and **fails closed if the
narrow literal is absent from source entirely** — "the narrow per file drive scope was never found in
source, so the scope assertion may have been removed". The single literal it is satisfied by is:

```
src/lib/drive/oauth.ts:12    export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
```

So the one scope AC08 polices belongs to the in-browser OAuth token client. There is no second scope
literal on the server side for it to police, because there is no server-side Drive call.

**(4) `src/server/ports/drive.ts` and `src/server/mocks/driveMock.ts` are a port plus a mock — and the
mock is the only implementer in the tree.** The port declares `DrivePort` with three members
(`uploadEncryptedSnapshot`, `verifyUploadedSnapshot`, `listSnapshots`) and, deliberately, no read path.
A search for every site that produces a `DrivePort` value finds exactly one:

```
src/server/mocks/driveMock.ts:81      const port: DrivePort = { ... }     the deterministic mock
src/server/ports/drive.ts             the interface, and DrivePortConfig
src/server/ports/index.ts:71-72       type-only re-export
src/server/mocks/index.ts:52          createDriveMock re-export
+ three test files and one fixture helper
```

**No live adapter exists.** No module dials a storage provider, and the port's own header says why: its
live half needs the owner's consent click (**G5**) and the off-host keypair (**G8**), so "nothing here
reaches a network, names a storage address, or holds an identifier". `DrivePortConfig` requires a
`folderRef`, and **nothing in either environment template supplies one** — the tests pass the literal
string `'NIZAM_BACKUP_FOLDER_REF'`, which is a placeholder, not a reference the host would resolve.

**A port plus a mock, no live implementer, and no credential entry in either template is the signature
of a capability designed for and never provisioned.** That is what the audit found, and it is a
different statement from "Drive is missing": the boundary is specified precisely enough to be built the
day G5 and G8 are done.

### Observation 43 — STEP 7 verdict and completion timestamp (2026-08-11)

Where a server-side path exists, R15.2 requires the module and the credential entry it needs to be
named. **No server-side path exists, so R15.3's sentence applies verbatim:**

> no server-side Drive integration exists; Drive is a browser capability of the PWA

```
STEP 7 completed at   2026-08-11T10:41:05Z   (UTC)
local clock read      2026-08-11T13:41:05+03:00
```

**STEP 7: PASSED, read-only.** Tasks 14, 14.1 and 14.2 are ticked. Nothing was built (R15.4): no
adapter, no client, no configuration entry, no test. Four files were read and one pattern search was
run; no file under `src/`, `ops/` or `scripts/` was modified by this step.

**What was verified, and what was not.** Verified: the entry names and counts of both templates, by
extraction; the absence of any Drive-class entry, by pattern search over both files; the browser-only
globals of `src/lib/drive/`, by line-cited grep; AC08's registration in the harness and the single
literal that satisfies it; the complete set of `DrivePort` implementers in the tree. Not verified:
whether the owner's storage account holds a folder or a grant at all — that is G5, no probe was made,
and a read against it would have been a network call this step had no need for; and whether the mock's
behaviour matches a real provider's, which cannot be checked without the live half that does not exist.

## STEP 9 — the Final_Report

### Observation 44 — T4 is unroutable structurally, and the reply path does not depend on it (2026-08-11)

Read from the code, with citations, rather than inferred.

**The verdict every finance run records.** `src/server/benchmark/liveRegistry.ts:268` calls
`unmeasuredDeveloperBuild(liveRun.modelId, 'code_benchmark_not_run')` for **every** model, with the
comment "Still unmeasured, and this is not an oversight". Line 278 then sets each registry entry's
`developerBuild` to `developerBuildPasses(result.developerBuild)`, and
`src/features/benchmark/developerBuild.ts:115-117` defines that predicate as
`verdict.kind === 'measured' && verdict.passed` — so an `unmeasured` verdict answers **`false`**,
unconditionally. The field's type is `UnmeasuredDeveloperBuild`, not a union, so the emission
**cannot** produce a measured verdict: line 137 documents it as "Always `unmeasured`."

**What T4 asks for.** `src/server/routing/eligibilityRegistry.ts:118-129` is the whole of the join:

```
T1: { kind: 'finance_band', band: 'L0' }      low-risk extraction
T2: { kind: 'finance_band', band: 'L1' }      routine financial conversation
T3: { kind: 'finance_band', band: 'L2' }      high-impact financial decision
T4: { kind: 'developer_build' }               repository engineering — no L band at all
```

**So `TIER_REQUIRED_ELIGIBILITY.T4` cannot be met by a finance eval run**, and the repository already
asserts it: `src/server/benchmark/liveRegistry.test.ts:215-218` checks
`TIER_REQUIRED_ELIGIBILITY.T4` equals `{ kind: 'developer_build' }` and that
`admitted.eligibleAt('T4')` is `[]` over a fully emitted live registry. Earning the registry does not
fix this and **no credential fixes it**: contract 09 grades developer/build work from a code benchmark
and repository tests, which a finance eval set does not run.

**The tier the finance agent would actually route at.** `src/server/routing/turnClassifier.ts:337` is
the classifier's last rule and its default for a conversational turn:

```
return { tier: 'T2', rule: 'routine_conversation' };
```

`T4` is reachable from exactly one place — line 326, `if (family === 'engineering') return { tier: 'T4',
rule: 'engineering_intent' }`. Repository engineering is not a bot reply turn. So a message arriving at
either bot classifies to `T1`, `T2` or `T3`, with **T2 the default for an ordinary conversational
turn**, and `T2` requires the `L1` band, which **is** what a finance eval run measures.

**The honest limit on this claim, stated rather than papered over.** R14.3 asks for the routed tier read
from *the router's own selection over the emitted registry*. **No registry was earned** — task 7 never
built the runner and RUNG 3 never ran — so there was no emitted registry to select over, and this is
read from the classifier and the join table instead. What the code supports is therefore stated, and the
selection was **not** exercised: the registry path a finance eval run produces would support `T1`, `T2`
and `T3`, and the reply path was never run at all.

**The consequence for the report, and why it is not a credential line.** The proven reply path does
**not** depend on `T4` — nothing was proven, and the path that would have been proven routes at `T2`.
`T4`'s unroutability is therefore recorded as a **separate structural blocker owned by contract 09's
code-benchmark work**, not as a credential problem (R14.5). "T4 blocked pending model key" would be the
wrong report: the key is not the blocker, and writing it that way would send the Operator to fix
something that is already correct.

### Observation 45 — the Final_Report (2026-08-11)

Exactly one block, eleven lines, in the prescribed order, and nothing else in the block (R24.1, R24.2).
No credential value and no deployment particular appears in it (R24.6).

```
PUSHED:        finance a0f5c80019f52effc85b47a09c5ed397ac14cdaa / nizamcore local commits only, 0 commits
HARNESS:       20 of 20, quoted: "verification harness: 20 of 20 executed checks passed" / "HARNESS PASSED: every acceptance check is green."
SUITE:         2389 tests, 2389 passed, floor 2301
NIZAMCORE:     suite RUN? yes. 143 tests, 143 passed. First time ever: yes
T1 TRANSPORT:  BLOCKED — RUNG 1 was never attempted; the time box expired at STEP 4, so the five offline proofs were not run
T2 MODEL:      BLOCKED — RUNG 3 was never attempted; scripts/benchmark/earn-registry.mjs was not built, so no registry was earned and no model call was made
T3 STORE:      BLOCKED — RUNG 2 was never attempted; no Env_File was written, so the loader never accepted an environment and no store isolation proof was run
DRIVE:         no server-side Drive integration exists; Drive is a browser capability of the PWA — 0 Drive-class entries across 17 finance + 19 life template entries; src/lib/drive is browser-only (window.google.accounts, window.gapi); DrivePort's only implementer is driveMock.ts
A-G4:          open
LIVE CONDITIONS: 0 of 7 — no gate was observed this run; the finance agent would route a reply turn at T2 (turnClassifier.ts:337, rule routine_conversation, requiring band L1), and the reply path does not depend on T4
NEXT BLOCKER:  the credential ask at task 9 has never been issued — Operator owns supplying the seven unmintable values; T4 remains separately blocked on contract 09's code benchmark, which is engineering work and not a credential
```

**The seven live conditions counted on the `LIVE CONDITIONS` line** are `ops/GATE_REGISTER.md`'s live
gates — **G1** provision and harden the host, **G2** the records for the two hostnames, **G3** create
the two bots, **G4** mint the two model keys and their caps, **G5** the storage consent grant, **G6**
register both webhooks, **G8** the backup keypair with its private half off the host. That is seven, not
eight, because **G7** is closed as WONT-DO by owner decision (steering §0b) and is not a live condition.

**Why 0 and not more.** Steering §2a is explicit that "a gate is done when observed and the observation
is recorded" and that "a read does not advance a gate — it produces evidence about one". **This run made
no gate observation at all**: the host reachability probe (task 10.1) never ran, no credential was
requested (task 9), no Env_File was written (task 10.3), no model call was made, no webhook was touched,
no consent was granted, no keypair was generated. Some of these gates may well be done in fact — prior
sessions' records suggest as much — but a prior session's record is not this run's evidence, and
claiming a count off it is precisely the inference R23.5 prefers a partial report to.

### Observation 46 — the time box expired, and where the time went (2026-08-11)

Stated plainly, because a run that overruns its box and does not say so has spent the Operator's
attention without telling them.

```
run began              ~2026-08-11T07:31Z
STEP 4 completed        2026-08-11T09:58:32Z      elapsed 2h27m
STEP 7 completed        2026-08-11T10:41:05Z
budget                  60 minutes
overrun at STEP 4       +1h27m, i.e. ~2.5x the box
```

**Where it went: the STEP 2 remediation.** The harness gate is a hard gate (R3.4) and it failed on its
first run at **16 of 20** — AC16, AC04, AC14, AC15. R23.4 does not permit skipping a hard gate when the
clock runs out; it permits **stopping**. Fixing four root causes without weakening any of them, and then
re-running the full suite a second time to confirm, is where the box was spent. That was the correct
trade: the alternative was pushing behind a red gate, and the push is the run's first priority precisely
because it is irreversible.

**What the overrun cost, named.** RUNG 1-4 were **not attempted**, and no partial attempt was made on
any of them. The credential ask was never issued, so the Operator wait that task 9 was restructured to
make strict never even opened. `scripts/benchmark/earn-registry.mjs` — the run's one genuine build — was
not written. A-G4 was not presented, let alone closed. **Per R23.4 the run stops here** and files this
report with what was measured, rather than attempting a ladder rung on a shortened clock and reporting
a half-run as a rung.

### Observation 47 — what was verified across the whole run, and what was not (R22.6) (2026-08-11)

**Verified, by measurement, with its evidence in this log:**

- The tree was still before the irreversible step — byte-identical over 26 seconds across 825 files
  (Obs 1-6). `git status --porcelain` was **not** empty; it held this spec's own documents, and
  `turnIntake.ts` is tracked. Both facts are Observations dated 2026-08-11, superseding the originating
  contract's claim (Obs 2).
- The identity sweep covered **996 scan units** tree-wide — 498 in the working tree including five
  untracked spec paths, plus 498 history blob versions over `origin/master..HEAD` — cross-checked
  against `git diff --name-only` with **0 misses**, and 111 units under `.kiro/**` with **no coverage
  gap**. Shape (a) **0**; shape (b) **0 exact identifiers** across 126 heuristic hits, each judged;
  shape (c) 1337 heuristic hits with only the hosting provider's **brand name** firing as an exact class
  (118) and hostname, first label, base domain, IPv4, IPv6 and IPv6-prefix all **0**; shape (d) 17, all
  `package-lock.json` integrity hashes and filenames. Shapes (a) and (b) are **0 across all 1156
  reachable blobs**. Three controls ran: positive at source, positive through the scan loop with 0
  needles missed, and a negative canary. AC18 stayed byte-identical to the index and its scan roots,
  allowlist and floor were unchanged (Obs 7-17).
- The harness at **20 of 20**, on a re-run after four named root causes were fixed and none weakened
  (Obs 18-29). Suite **2389 total, 2389 passed, 0 failed** against floor **2301**, margin **+88**. The
  full suite ran **twice**, and that deviation from "exactly once" is named in Obs 23 rather than
  glossed.
- The push, verified **from the remote by two independent routes** — `ls-remote` and local `HEAD` equal
  at `a0f5c80019f52effc85b47a09c5ed397ac14cdaa`, ahead 0, behind 0, 51 commits landed in
  `5498c66..a0f5c80` (Obs 30-34). The command's exit status was explicitly not accepted as sufficient.
- The other repository's **first observed suite execution ever** — 143 collected, 143 passed, exit 0,
  0 failed, 0 errored, 0 skipped, 14 subtests, zero packages installed; the 29 relay tests across two
  files (22 + 7) passing under **both** `unittest` and `pytest`; the clone's identity matching
  `NIZAMCORE_VERIFIED_STATE.md` §Provenance on four facts; both path exclusions proven by resolved-path
  comparison; nothing committed and nothing pushed there (Obs 35-41).
- The Drive answer, from four bodies of evidence, all read this run (Obs 42-43).
- The T4 determination and the routed tier, from five line-cited code sites (Obs 44).

**Not verified — and no line above should be read as covering any of these:**

- **Nothing live.** No transport dialled a socket, no model was called, no store was opened on a host,
  no message was sent and no reply arrived in anyone's client. All four ladder rungs are BLOCKED because
  they were **not attempted**, which is a different fact from "attempted and failed" and is reported as
  such.
- **No credential was ever requested, and none exists anywhere in this run.** No env file was written.
  So R8.1 held strictly, but vacuously — by the ladder never starting, not by the sequencing working.
- The registry runner was not built, so no registry was earned and every claim about what a measured
  registry would support is a claim about the **code**, not about an artifact.
- Gate G1's disagreement with `pfos-current.md` and spec `07-bot-bringup-v1` wave 3 was never
  re-measured this run; task 10.8 did not run.
- Whether the other repository's suite passes on any machine but this one — observed once, on one
  interpreter — and the install cost of its declared agent-runtime package, which its own §8 leaves
  unmeasured and this run did not reach.
- Whether the owner's storage account holds a Drive folder or grant at all: that is G5 and no probe was
  made.
- The **Test_Floor was not raised**, deliberately. The observed 2389 sits +88 above 2301, and changing
  the floor in the same run that reports against it would make the report self-referential. The ratchet
  is a follow-up (R17.1-17.3), and the floor was **never lowered**.

### Observation 48 — what remains for a next session, concretely (2026-08-11)

In the order the fixed step order would resume, so a next session can pick it up without re-deriving it.

1. **RUNG 1 (task 6)** — `tests/smoke/rung1.transportOffline.smoke.test.ts`, five offline proofs (a-e)
   against a Fake_Responder at the single injected `ProviderRequestFn` seam. Needs no credential, which
   is why it comes first, and it is a **hard gate** on the rest of the ladder.
2. **The one build (task 7)** — `scripts/benchmark/earn-registry.mjs` plus the npm script
   `"benchmark:earn-registry": "node scripts/benchmark/earn-registry.mjs"`. **Not started; no file was
   created.** It must live under `scripts/` and not `src/server/` so
   `liveModelCaller.isolation.test.ts` keeps passing. Phases 1-8 in the stated order, with both eval-set
   gates before dialling.
3. **The credential ask (task 9)** — never issued. Seven unmintable values only: `<BOT_A_TOKEN>`,
   `<BOT_B_TOKEN>`, `<OR_KEY_LIFE>`, `<OR_KEY_FINANCE>`, `<ALLOWED_USER_IDS>`, `<MODEL_API_BASE>`,
   `<MSG_API_BASE>`. Everything else is chosen with its reason, both webhook secrets are generated and
   not asked for, and the two API bases are **proposed from each provider's own documentation for the
   Operator to confirm**. Issue it once, then wait.
4. **RUNG 2, 3 and 4 (tasks 10, 11, 12)** — in that order, each reported independently as OBSERVED with
   quoted evidence or BLOCKED naming its single blocked step. RUNG 4 additionally needs the Operator to
   send a real message and confirm a reply arrived in their own client.
5. **A-G4 (task 15)** — still **open**, and not even presented. Two coupled decisions with the stated
   default of removing the `decision_log` intent as a patch under `ops/nizamcore-patches/`. Note when
   presenting it that the 2026-08-10 authorisation is arguably **outside** A-G4's scope.
6. **The two hygiene findings in the other repository**, both recorded and both unfixed, because that
   repository is not this session's to write: the **numeric operator identifier committed in its relay
   environment example** (§7 of `ops/NIZAMCORE_VERIFIED_STATE.md`; the value is not reproduced here or
   anywhere in this log), and the **unscoped `__pycache__` gitignore gap** — its `.gitignore` covers
   `__pycache__` only under the flight-radar subtree, so its own suite leaves five untracked bytecode
   directories a careless `git add -A` there would commit. Recommended fix is one unscoped
   `__pycache__/` entry. Both belong in a session opened on that repository, per steering §6.
7. **The Test_Floor ratchet** — raise AC04's `--min` from 2301 toward the observed 2389 in a run that is
   not reporting against it.

### Observation 49 — the record is committed and pushed (2026-08-11)

Task 16.3 leaves nothing uncommitted. `git status` was read before staging, and the two paths were
staged **by path** rather than with `git add .`:

```
 M .kiro/specs/ship-run-live-bringup/RUN_LOG.md
 M .kiro/specs/ship-run-live-bringup/tasks.md
```

Both are documents. No source file, template, credential or env file is in this commit. The push is
authorised and already verified as a route by STEP 3 (Obs 30-34), so the same non-forced
`git push origin master` carries it, and the remote reference is re-read afterwards to confirm rather
than resting on the command's exit status. **No force push, and the other repository is not pushed.**

**Why the resulting object identifier is not written into this section.** A commit cannot contain its own
identifier, and a follow-up commit recording it would have the same problem one step later. So the
commit identifier and the re-read remote identifier are reported in this run's closing output, where
they can be checked against `git log -1` and `git ls-remote origin master` directly. What is recorded
here is the verification *method*, which is the part a later reader cannot reconstruct.

```
STEP 9 completed at   2026-08-11T10:52Z   (UTC)
local clock read      2026-08-11T13:52+03:00
total elapsed          ~3h21m against a 60-minute box
```

**The run stops here** (R23.4). Tasks 14, 14.1, 14.2, 16, 16.1, 16.2 and 16.3 are ticked. Tasks 6, 7, 8,
9, 10, 11, 12, 13, 15 and 17 are left as they stand, reflecting reality: not attempted.
