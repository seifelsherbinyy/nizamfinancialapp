# Phase 1 — reconcile and align (exit record)

> Owning contract: `KIRO_FIVE_PHASE_CONTRACT.prompt.md`, Phase 1. Spec `07-bot-bringup-v1`.
> Produced 2026-08-11. **R24 binds: no deployment particular below.**
>
> Phase 1 produces one record and no code. The two forks it exists to close were both ruled by the
> owner in the instruction that started this run, so the contract's STOP-for-confirmation is
> **discharged rather than skipped** — the rulings are quoted in §0 and applied verbatim.

## 0. The two owner rulings this phase carries

Quoted from the owner's instruction of 2026-08-11, which opened this run:

1. > "commit the working-tree spec rewrite and the F20 import fix as separate commits, verify:all green
   > before each"
2. > "two windows — bot A's personas share one, bot B keeps its own"

Ruling 1 answers Phase 1 item 1 and is the answer to the HEAD-vs-tree fork. Ruling 2 answers Phase 1
item 2 and is the answer to README §10. Neither was re-asked.

## 1. The goal, restated and confirmed

NIZAM ships **two independent conversational agents on Telegram plus an owner-only web application, all
on one hardened host.**

- **Bot A, the life agent**, Python, in the other repository: therapeutic journaling, co-thinking,
  red-teaming, and a recovery downshift that outranks tactical pressure. **Many personas, one Telegram
  window**, the persona chosen inside the window.
- **Bot B, the finance agent**, TypeScript, in this repository: budgeting and finance conversation over
  the owner's real ledger. **Its own window, own credential, own spend bound, own store.**
- **The owner-only web app**: the built SPA, loopback-only over the admin tunnel (`--serve-app`), showing
  the owner's **real ingested figures**. It is where numbers are reviewed.

**End to end** means real financial data is loaded, bot B converses about it and the web app displays it,
bot A converses independently on life matters, both survive restart, both honour one kill switch, both
stay isolated — and each of those is **observed on the host and recorded**, never asserted.

**Confirmed: this matches the contract's own statement of the goal with no material difference.** No
question is raised against it.

## 2. Item 1 — HEAD versus the working tree, reconciled and committed

### What the disagreement actually was

Measured before any change: **197 dirty entries**, HEAD at `12ccbea`. The tree held two unrelated bodies
of work that the parallel loop had written and never committed, so `HEAD` and the tree disagreed about
what spec 07 was:

| Body of work | Entries | Evidence of the disagreement |
|---|---|---|
| The spec 07 rewrite | 7 | committed README carried no §12, no two-way gate discipline, no `B13`–`B20`, no `A6`; the tree did. `README.md` diff: **+498 / −**, `tasks.md`: **+422 / −** |
| The F20 launch-path repair | 190 | `tsconfig.json` flipped `allowImportingTsExtensions` to `true`; every relative specifier under `src/` made extension-explicit; `scripts/ladder/ts-resolve.mjs` deleted; a new `scripts/verify/launch-path.mjs` guard |

### The gate reading before either commit

```
npm run verify:all -- --all
```

**First run: 15 of 20.** Five failures, of which three were substantive and two were the dirty-tree pair:

- `FAIL AC02` typescript reports zero errors
- `FAIL AC03` linter is clean at zero warnings
- `FAIL AC05` production build (same root cause as AC02)
- `FAIL AC14` working tree is clean — 197 entries
- `FAIL AC15` repository is push ready — working tree dirty

**The three substantive failures were all one file and one root cause**, in the uncommitted wave-A1
ledger gates: `src/lib/ledger/canonicalLedgerFile.test.ts` read three tier-1 paths straight through
`readFileSync` with a possibly-absent path, while the `readCached` helper that exists for exactly that
sat unused (so it was also the lint error), and one indexed read was dereferenced without a guard.

**Repaired by routing the three reads through the existing helper and guarding the indexed read. No type
was widened, no assertion relaxed, no floor lowered, and no `eslint-disable` added.** Repairing an
inherited defect at the boundary rather than inheriting it is what the contract's Phase 3 language
requires of the F21–F24 findings; the same standard was applied here.

**Second run: 18 of 20.** The only two failures were `AC14` and `AC15`, which **cannot** be green while a
commit is still pending — they are the checks that assert the tree is clean. That is the honest maximum
before a commit, and it is recorded as such rather than described as green.

### The two commits

| Commit | Subject | Scope |
|---|---|---|
| `3f38e39` | `docs(spec-07): Commit the spec 07 rewrite and the verified-state record` | 7 files, +1094 / −310. Spec 07 README + tasks, spec 06 tasks, `ops/AGENT_CAPABILITY_SPLIT.md`, `ops/INTEROP_CONTRACT.md`, new `ops/NIZAMCORE_VERIFIED_STATE.md`, and the five-phase contract itself |
| `861652d` | `fix(launch): Repair F20 at source by making every relative import explicit` | 190 files, +1468 / −770. `tsconfig.json`, all of `src/`, the ladder and toolchain-pin scripts, `ops/IMAGE_BUILD.md`, the new launch-path guard and its test, minus the deleted resolve shim |

### The gate reading after both commits

```
npm run verify:all -- --all
→ PASS AC16 AC10 AC01 AC07 AC08 AC08b AC09 AC11 AC18 AC02 AC03 AC04 AC13 LOOP AC05 AC05b AC06 AC12 AC14 AC15
→ verification harness: 20 of 20 executed checks passed
→ HARNESS PASSED: every acceptance check is green.
```

### Consequence: D-F20-SCOPE is now settled, and F20 is fixed at source

The README's own instruction was to **re-measure before relying on the observation**, and it was
re-measured on the settled, committed tree:

```
node --version → v24.14.1
node src/server/process/start.ts
→ "NIZAM environment: the finance service environment is not configured — 16 entries to fix,
   all of them named here so one restart answers the whole question: finance/FINANCE_DATA_DIR …
   [ENV_ENTRY_ABSENT]; … finance/NIZAM_KILL_ALL … [ENV_ENTRY_ABSENT]"
→ EXIT=1
```

**Bare `node`, no resolve hook, loads every module, reaches the configuration loader, names all sixteen
finance entries in one message, and exits 1.** Before the repair the same command died at
`ERR_MODULE_NOT_FOUND`. So:

> **D-F20-SCOPE is rewritten by observation: F20 is fixed at source, not bypassed. The resolve hook is
> off the v1.0 path and off the host.** README §7's "or bare if the F20 observation holds after a commit"
> branch is now the settled posture.

**What this does NOT close.** It is the **negative** direction of rung L0 only, taken **on the developer
machine, not on the host**. L0 for bot B was already `OBSERVED` in spec 06 and is carried forward, not
re-earned. L2 (containers) stays out of scope per README §5 regardless of F20 now being clear.

## 3. Item 2 — the window fork, ruled

> **RESOLUTION of README §10: two windows.** Bot A's personas share one window — the single credential
> the other repository reads — and **bot B keeps its own window, its own credential, its own spend bound
> and its own store.**

This is the owner's ruling, and it is the reading README §10 already recorded as the default. Checked, as
the contract requires, that nothing has to change to accommodate it:

| What had to be confirmed unchanged | Result |
|---|---|
| steering `two-agent-vps.md` §1 — this repository is the finance agent, the other is the life agent, polyglot by design, no second money implementation | **unchanged.** Two windows is exactly what §1 assumes |
| R17 — each agent has its own credential and its own bound; the other agent's bound is none of its business | **unchanged** |
| Definition-of-done condition 3 — an unlisted sender refused by **both** bots, neither refusal revealing which check failed | **unchanged.** Two allowlists, two refusals |
| Condition 4 — each bot routes through its own credential and own bound; exhausting one leaves the other able to call | **unchanged.** This condition is only meaningful under two windows |
| Condition 6 — one kill-switch flip stops **both**, the sentinel entry name being shared | **unchanged.** Independent of window count |

**No steering amendment is needed and none is made.** That the free reading is also the ruled one is the
point: the alternative would have cost a steering amendment, a rewrite of three definition-of-done
conditions, and a money-handling process sharing a conversation with the journal.

## 4. Item 3 — the identifier set, confirmed closed and honest

### Spec 07

`A0`–`A6`, `B0`, `B2`, `B4`–`B20`, gates `G1`/`G3`/`G4`, and `D-BENCH`. **30 items.**

**`B1` and `B3` are deliberately unused and were not backfilled.** `B4`–`B7` are bound to the seam
identifiers `S1`–`S7` in `src/server/process/main.ts`; renumbering would break every seam
cross-reference. Verified against the committed `tasks.md`: no `B1` or `B3` heading exists, and the file
says why.

Done as of this record: **`A0`** (owner authorisation to modify the other repository, granted 2026-08-10,
push **not** included) and **`B0`** (ladder scripts committed at `adb127a`; L0 and L1 `OBSERVED` for bot
B in spec 06). Everything else open.

### Spec 08

`A0.1`–`A0.3`, `A1.1`–`A1.3`, `A2.1`–`A2.5`, `A3.1`–`A3.5`, `A4.1`–`A4.4`, `A5.1`–`A5.2`, `B1.1`–`B1.6`,
and the seven-plus-two definition-of-done conditions `K1`–`K9`. Waves `A0` and `A1` are ticked and carry
a written observation. `A2` onward is open and is Phase 3a of the five-phase contract.

**No identifier outside these two sets is introduced by this phase.**

## 5. Findings raised by Phase 1

### F25 — the AC04 floor was recorded as ratcheted and was not

`.kiro/specs/08-knowledge-ingestion/tasks.md` states, in committed text, that the floor "**rose from
2126 to 2146**". Measured on the settled tree:

```
node scripts/verify/testcount.mjs --min 2126
→ test files: 551
→ tests:      2165 total, 2165 passed, 0 failed
→ minimum:    2126
```

`scripts/verify/all.mjs` still passes `--min 2126`. **The ratchet was documented and never applied**, and
the true count has since reached 2165, so the floor is 39 cases slack. It is a monotonic guard that was
not advanced, not a broken guard: nothing regressed, but 39 tests could be deleted today without the
harness noticing.

**Not patched in this phase, deliberately** — Phase 1 writes no code beyond the defect repair that ruling
1 required. **Phase 2 raises the floor to the true count it leaves behind**, which is where the contract
puts the ratchet ("new tests added and the floor ratcheted").

### F26 — `.kiro/**` is still outside the particulars scan roots

Carried forward from README §11.1 rather than re-measured, and it is now **more** load-bearing than when
it was written: this phase committed 1,094 lines of specification text, and `AC18` never looked at any of
it. The open owner ruling stands (is a project's own bot name a deployment particular, or not) and **must
not be resolved by widening the scanner's allowlist**.

## 6. Exit gate

| Phase 1 requirement | State | Evidence |
|---|---|---|
| HEAD-vs-tree decision recorded, F20 fix and spec rewrite committed | **MET** | §2. `3f38e39` and `861652d`, two commits as ruled |
| `verify:all` green before each commit | **MET, with its limit stated** | 18 of 20 before each commit, the only two failures being the dirty-tree pair that cannot pass pre-commit; **20 of 20 after** |
| Two-window ruling recorded as the answer to README §10 | **MET** | §3, with the five unchanged dependants checked |
| Goal restated and confirmed | **MET** | §1 |
| Identifier set confirmed closed | **MET** | §4 |
| Owner confirmation on (a) and (b) | **DISCHARGED, not skipped** | Both ruled by the owner in the instruction that opened this run, quoted verbatim in §0 |

**Phase 1 is closed. Phase 2 may begin.** No gate was performed, no secret was invented, no guard was
weakened, no floor was lowered, and no gated item is claimed done.
