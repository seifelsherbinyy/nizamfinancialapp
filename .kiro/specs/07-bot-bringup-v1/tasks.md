# Spec 07 tasks - Bot bring-up v1.0 (both bots)

> Read `README.md` first, then `ops/NIZAMCORE_VERIFIED_STATE.md`. Requirement prefix `B`.
> `A*` tasks act on the **other** repository. `B*` tasks act on **this** one.
>
> **Rules carried from spec 06, unchanged:** never tick a gate box, never invent a secret value, never
> weaken a guard or lower the test floor, never place a particular in a tracked file, run
> `npm run verify:all` green before closing any task in this repository, and ratchet the floor up.
>
> **Hard rule for every `A*` task:** the other repository is **read-only until the owner authorises a
> modification** (steering §6, §2a). No `A*` task below may create, change, stage, commit or push there
> before that authorisation is recorded in A0.
>
> **Stop conditions:** a red harness, or an unwritten `LIVE_PROGRESS_V1.md`.
>
> **The identifier set is closed, and it has two deliberate holes.** The set is `A0`-`A4`, `B0`, `B2`,
> `B4`-`B12`, the three gates `G1`/`G3`/`G4`, and `D-BENCH`: **21 items, 1 done, 20 open** as of
> 2026-08-10, the one done being `A0`. The `A` range is `A0`-`A5`. **`B1` and `B3` are unused.** They are not lost tasks and nothing is hidden behind them: the
> `B4`-`B7` numbering is bound to the seam identifiers `S1`-`S7` in `src/server/process/main.ts` and was
> not renumbered when two candidate tasks were folded away, because renumbering would have broken every
> seam cross-reference in this file. Do not add a `B1` or a `B3`; take the next free number instead.
>
> **2026-08-11 addendum (README §12): live-data proof run.** Adds `A6`, `B13`-`B20`, and the two-way gate
> discipline (README §12.1) binding every rung/gate observation from here on. Set is now `A0`-`A6`, `B0`,
> `B2`, `B4`-`B20`, three gates, `D-BENCH`: **30 items, 1 done, 29 open.** `A6` acts on the other
> repository and inherits every `A*` rule below, including the A0 modify-gate. `B13`-`B19` act on this
> repository against a Drive folder the owner names; they do not require A0 and do not touch the other
> repository. `B20` is a plan only, no execution, no new gate.

## Wave 0 - close the unknown, and get the one authorisation

- [x] A0 **Owner authorisation RECORDED. GRANTED on 2026-08-10.** The owner authorised modifying the
      other repository in the same instruction that fixed the single-window requirement (see A5 and
      README section 2, `D-ONE-WINDOW`). **Scope as granted:** the other repository, the files needed to
      wire its model layer and take its relay live, which is A2 and A3. **Scope NOT stated and therefore
      still closed:** whether pushing is included. Until the owner says otherwise, work there commits
      locally and the owner pushes. Nothing in that repository has been created, changed, staged,
      committed or pushed up to this point.
      This is the single gate on half of v1.0 (README §2). Until it is recorded, A2 and A3 are
      `BLOCKED - awaiting human` and every `B*` task proceeds regardless. Record the ruling, its date,
      and its scope: which repository, which files, and whether pushing is included or the owner pushes.

- [ ] A1 **Close A-G1, the agent runtime unknown. Do this before estimating anything else on bot A.**
      The other repository's registry declares a runtime package and a version floor in **one
      configuration line**; **no module imports it** and no dependency manifest lists it. The package is
      real and the floor is satisfiable, and it carries a large dependency tree against a relay that
      advertises zero installed dependencies.
      **Deliverable is a decision, not an install:** on a scratch environment (never the host, never the
      other repository's tree), determine whether the package installs on the Python major the host will
      run, what it pulls in, and whether its profile model matches the three profile names the registry
      already assigns. Then record one of two outcomes:
      **(i)** adopt the declared runtime, or **(ii)** call the model provider directly from the
      coordinator and record the registry line as aspirational. **Either is acceptable. Choosing by
      assumption is not.** No credential is used and no model is called in this task.

- [ ] B0 **Done 2026-08-10 by the parallel build loop, recorded rather than dropped.** Commit `adb127a`
      committed the ladder scripts, which were the sole cause of a red harness (AC14 and AC15 both
      failed on one untracked entry), recorded the packaging defect as **F20**, and observed rungs
      **L0** and **L1** with evidence in `.kiro/specs/06-two-agent-vps/LIVE_PROGRESS.md`. Read that file
      before starting B2: those two rungs are already `OBSERVED` and re-running them is not work.

## Wave 1 - bot B reaches a model (this repository, no gate, no owner)

- [ ] B4 **The messaging provider module** (**S1**, **S2**). One module, the only place in this tree that
      performs an outbound messaging request: a long-poll fetch against `MSG_API_BASE` with the offset
      semantics the existing transport already expects, and a send. Wire it in place of the two throwing
      stubs at `main.ts:263` and `main.ts:268`. **The transport above it is already built and already in
      the live call stack**; this task supplies only the request function, which is the artifact spec 06
      deliberately withheld. Reads its token through the existing single chokepoint. Never logs a token,
      a body or a sender. Fails closed on a non-success status. Honours the existing bounded retry
      policies rather than adding new ones.
      **Tests without a network:** a local fake responder for a normal update, an empty update set, a
      non-success status, a rate-limit response with a retry hint, a malformed body, and a body over the
      read bound. Assert no credential and no message text reaches any log line.

- [ ] B5 **Real turn facts and the request planner** (**S5**, **S4**). `readTurnFacts` at `main.ts:287`
      returns conservative facts, so **every turn classifies T0 and no model is ever invoked**. Extract
      real facts from the inbound message so the existing classifier can reach the model-bearing tiers,
      and implement `planModelRequest` at `main.ts:279`.
      **Do not weaken the no-model tier guarantee.** It is a type-level property, not a branch. Add a
      test that the no-model classification still cannot carry a model request, and one that a
      model-bearing classification can.

- [ ] B6 **The model provider module** (**S3**). Replace the throwing port at `main.ts:219` with one
      module that performs the request. **Reuse the existing response reader and validation** built for
      the benchmark path rather than writing a second one: it already fails closed on a bad status, a
      missing usage block, a non-integer cost and a substituted model. Record reported cost, tokens,
      latency and schema validity through the existing telemetry repository, and **no prompt text**.
      **The provisional guard stays.** This task makes a call possible, not routable. A test asserts
      routing still refuses until B8.

- [ ] B7 **Deterministic answers, thin on purpose** (**S6**). The deterministic route at `main.ts:278`
      returns the turn reference, so a reply is a bare identifier. Answer a small **named and listed** set
      of intents in a human sentence. This is not the Stage 1-4 engine wiring, which stays out of v1.0.

- [ ] B2 *(optional, hygiene)* Parameterise the agent process by identity (**S7**). Demoted from required:
      option (c) means this repository never runs the life agent, so v1.0 does not need it. Still correct
      hygiene, and cheap, because the enumerated agent set, the per-agent entry-name resolver and the
      per-agent bounds all already exist. If taken, an unknown identity is refused, never defaulted.

## Wave 1.5 - Drive lanes to real numbers (this repository, gated only on a Drive folder id)

> None of `B13`-`B19` touch the other repository and none require `A0`. They are blocked only on the
> owner supplying a Drive folder id (or a `--discover <term>` search term) per README §12.2 and
> `two-agent-vps.md` R-B: **never guess a folder id.** `PFOS_SOURCE_FOLDER_ID` and
> `VITE_NIZAM_DRIVE_FOLDER_ID` are empty today; that emptiness is reported as a finding by `B13`, not
> patched around.

- [ ] B13 **Prove the Drive pull tool fails closed, then enumerate.** Run the Drive pull tool with no
      folder id set; pass means it refuses and names `PFOS_SOURCE_FOLDER_ID` — quote the refusal (two-way
      gate, README §12.1, negative case first because there is nothing to enumerate without a folder id).
      Once the owner supplies a folder id or a discovery term, run the tool in list-only mode against that
      folder and print the full tree (path, mime, size, modified) without downloading anything. This is
      the enumeration step; do not skip to download.

- [ ] B14 **Classify every listed file into exactly one Drive lane** (README §12.2): `FINANCE-NUMERIC`,
      `JOURNAL-LOCAL`, `MEDICAL-LOCAL`, `EXCLUDED` (with a reason each). Write the register before any
      download. Assert the four lane counts sum to the total listed; an unassigned file is a reporting
      defect, not a rounding error. `JOURNAL-LOCAL` and `MEDICAL-LOCAL` are `strict_local`: they are
      recorded in the register and never downloaded, never opened in a model request, in this task or any
      later one, absent a separate written widening from the owner.

- [ ] B15 **Download only the `FINANCE-NUMERIC` lane.** One provenance row per file: source path, sha256,
      bytes, fetched-at. Write to a git-ignored destination and prove it is ignored — quote the ignore
      check's output (two-way gate: also prove a tracked-destination attempt would NOT be ignored, i.e.
      confirm the check actually discriminates rather than reporting everything as ignored).

- [ ] B16 **Transform the `FINANCE-NUMERIC` lane into the master ledger CSV** (`data/ledgers/
      LEDGER_SCHEMA.md`: 25 columns, `duplicate_key` for dedup, idempotent, money in milliunits or decimal,
      default currency EGP). Carry amount, date, direction, account, currency, and a merchant-level
      description only. Strip every clinical or narrative detail at this step — a therapy invoice becomes
      a dated amount in a category, nothing more. This task produces the CSV; it does not import it.

- [ ] B17 **Import the transformed CSV through the real import code path** (not a fixture). Report rows
      parsed, rows fresh, rows deduped, parse errors, and the resulting account balances.
      **Idempotence, two-way (README §12.1):** import the identical CSV a second time; pass means zero
      fresh rows and identical balances. If a second import changes a balance, stop — that is a
      data-integrity defect and outranks the rest of this wave. Report both the first import (fresh rows
      created) and the second (zero fresh rows) as the two directions of one proof.

- [ ] B18 **Money-integrality, two-way.** Assert every stored amount from B17 is an integer in minor units
      per `money-rules.md`; quote the assertion passing. Then tamper one cell to a float value and confirm
      the boundary refuses it; quote the refusal. A gate only ever observed passing is unproven per
      README §12.1.

- [ ] B19 **Cross-check one derived figure two independent ways.** Pick one derived figure produced from
      B17's real imported data (safe-to-spend, or a category total). Compute it once through the app's own
      function and once through a standalone script written for this task. Pass means the two agree to the
      minor unit; print both. This is the first proof in the spec that real, owner-supplied financial data
      flows all the way through the deterministic engines to a number the owner can check by hand.

## Wave 2 - bot A reaches a model (the OTHER repository, gated on A0 + A1)

- [ ] A2 **Wire the coordinator's agent call** (**A-G2**). `BLOCKED - awaiting human` on **A0**, and
      blocked on **A1**'s recorded outcome. The coordinator already runs the whole pipeline for real:
      recovery pre-gate, router, privacy pre-write gate, ledger append through the deterministic
      governor. Only the agent call is a stub returning a canned string.
      Replace **that one call** with the outcome A1 chose. **Change nothing else:** not the gates, not the
      governor's sole-writer position, not the ledger contract, not the router configuration, not the
      allowlist, not the de-duplication. The three gates must still run in the same order around the new
      call, and the governor must remain the only writer.
      Its own tests are the regression net; run them and record the count before and after. Add tests for
      the new call: a refusal from the provider, an over-budget refusal against the existing cost ceiling,
      and a classified capture still blocked by the privacy gate.

- [ ] A3 **Take the relay out of standby** (**A-G3**). `BLOCKED - awaiting human` on **A0**, and on
      **G3** and **G4**. Its mode entry is held in standby **by design** pending a credential. Place the
      bot token and the model credential on the host, then set the mode to live. Verify first with its own
      no-network dry-run mode, then its single-cycle mode, then the continuous loop. **Never set the mode
      live before the dry-run passes on the host.**

- [ ] A4 **Replace the committed operator identifier in its relay environment example with a
      placeholder** (`ops/NIZAMCORE_VERIFIED_STATE.md` §7). `BLOCKED - awaiting human` on **A0**. A
      real-looking numeric operator identifier sits there as a default value, and R24 in this repository
      names that class of value a deployment particular. Lower severity than a token because it
      authorises nothing on its own, and still an operator fact in a public repository. **Do not
      reproduce the value in this repository, in any file, including a commit message.**

- [ ] A5 **Close the dangling routable agent, `A-G4`.** The router sends the `decision_log` intent to a
      target that is **not** in the runtime registry and whose persona file **does not exist**, so that
      one intent dead-ends inside the single window. Measured 2026-08-10: 10 routable targets, 9 of them
      fully resolved, 1 mapped in the codename layer but absent from both the runtime registry and the
      persona directory. Either author the missing persona and register it, or remove the intent. Do not
      leave a routable target that cannot answer. Blocked on nothing except A0, which is granted.

- [ ] A6 **The privacy pre-write gate, two-way (README §12.1, §12.3 row 5-6).** `BLOCKED - awaiting human`
      on **A0**, and blocked on **A2**/**A3** (needs a live model-bearing turn to attempt a write against).
      Attempt to have the coordinator write a capture whose content is drawn from a `MEDICAL-LOCAL` file
      per §12.2 — never place that content in a model **request**; the attempt targets the pre-write gate
      itself, before any model call, and must be constructed so the classified content never crosses into
      a prompt even on the negative path. Quote the refusal and the class it assigned. Then run the same
      capture path with a benign, non-classified input and confirm it succeeds — quoting both directions
      is the task; a gate observed only refusing, or only succeeding, is not proven. Also exercise §12.3
      row 5 (recovery downshift; the critic must not be selected, quote the downshift) and row 6 (the
      `A-G4` dangling target; expect silence, not a crash, until A5 closes it — if A5 has already closed
      it by the time this runs, row 6 should route successfully instead, and the task records which case
      held). Never write the medical narrative itself into any file this session produces; report the
      file's lane and the gate's refusal code only.

## Wave 3 - owner gates (nothing here is performed by an agent)

- [ ] G1 provision and harden the host, ending with the root-owned configuration directory
- [ ] G3 place **both** bot tokens into the host configuration directory
- [ ] G4 mint **two** model credentials with their per-agent bounds and training opt-out
- [ ] D-BENCH authorise one benchmark pass, and resolve the provider base URL into the environment

> `ops/GATE_REGISTER.md` and `.kiro/specs/06-two-agent-vps/OWNER_GATE_ACTIONS.md` carry the steps and the
> verification lines; this spec does not restate them. **G2, G5, G6 and G8 are deferred** per README §5
> and are deliberately absent rather than unticked here.
> **One credential release unblocks both bots**, so this wave has twice the usual leverage.

## Wave 4 - clear the provisional registry (bot B)

- [ ] B8 Run the benchmark once and emit a **measured** registry. Blocked on **D-BENCH** and the provider
      base URL. The pre-flight estimate and both its gates already exist and spend nothing; run that
      first and report the estimate against the ceiling. Then one pass through the witnessed emission
      path. Do not retry a refusal in a loop and do not emit a half-measured registry.
      Record the observation only: date, models graded, spend within estimate. Never the credential,
      never the endpoint.

## Wave 5 - install and operate both on the host

- [ ] B9 **Install both agents as host services.** Two service units, each with its own environment file
      at mode 600 owned by root in the host configuration directory, its own data directory,
      restart-on-failure and journal output. No published port, no proxy, no container. Bot B starts under
      the resolve hook per D-F20-SCOPE; bot A on a Python major its runtime supports, with the agent
      runtime's profiles outside both repository trees.
      Author `ops/HOST_INSTALL_V1.md`: both unit templates with **placeholders only**, install and enable
      commands, how to read status and logs, how to stop one agent without the other, and the commands
      that flip the kill switch in each form.
      **The kill switch entry name is shared between the two repositories.** State plainly whether one
      flip is intended to stop both, and make the unit files agree with the answer.

- [ ] B20 **Drive-to-host wiring plan (planning only, no execution, no new gate).** Produce a plan, not a
      change: for each item, name the gate and the owner. Cover (a) which direction data moves — host to
      Drive is backup, gated on `G5`/`G8`, both deferred per README §5; Drive to host is ingestion — and
      state which direction each agent actually needs, without conflating the two; (b) which credential a
      host process would hold, and why the read-only operator token used in B13 must **not** be the one
      placed there; (c) whether either agent needs Drive at **runtime** or only at **import time** — if
      import-only, say plainly that the host needs no Drive access at all for v1.0, and note that this is
      the cheapest correct answer if the evidence from wave 1.5 supports it; (d) the recorded debt that
      v1.0 has no off-host copy and no proven restore. Recommend the smallest change that makes the app
      alive on the host without opening a new gate. This task changes no code and grants no access.

## Wave 6 - observe, record, close

- [ ] B10 **Run the ladder on the host** and record each rung's observation (README §6). Stop at the first
      rung that fails, fix, re-run from that rung. L0 and L1 are already `OBSERVED` for bot B; carry those
      rows forward rather than re-running them. **L3', L4' and L5' are the new observations**, and L3' is
      only passed by a **model-generated** reply from each bot, never a canned one.

- [ ] B11 **Write `.kiro/specs/07-bot-bringup-v1/LIVE_PROGRESS_V1.md` and keep it current.** One row per
      task here, per ladder rung, and per gate in wave 3. `State` is exactly one of `OBSERVED`,
      `BLOCKED - awaiting human`, `BLOCKED - awaiting build`, `NOT STARTED`. `Evidence` is mandatory for
      `OBSERVED` and is the command run plus what it returned; a row without evidence is `NOT STARTED`
      however finished the code looks. Rows for `A*` tasks record observations taken **in the other
      repository** and say so.
      Close with four lines and nothing else: what is live in one sentence; the single next blocking
      action and whose it is; the count of README §1's seven conditions observed; and the v1.0 debt list
      (no off-host copy, no restore drill, no cross-agent signalling).
      **The absence of this file in spec 06 is what made the project unreadable to the owner. Do not close
      v1.0 without it.**

## Wave 7 - optional, cheap

- [ ] B12 Serve the already-built web app to the owner over the existing admin tunnel. Loopback-only mode
      on this repository's own entrypoint, already decided and already built. Start it on the host and
      record the observation. **This is where the owner reviews real figures in v1.0**, because the finance
      engines stay out of scope.

## Task dependency graph

```json
{
  "waves": [
    { "wave": 0, "tasks": ["A0", "A1", "B0"] },
    { "wave": 1, "tasks": ["B4", "B5", "B6", "B7", "B2"] },
    { "wave": 1.5, "tasks": ["B13", "B14", "B15", "B16", "B17", "B18", "B19"] },
    { "wave": 2, "tasks": ["A2", "A3", "A4", "A5", "A6"] },
    { "wave": 3, "tasks": ["G1", "G3", "G4", "D-BENCH"], "owner": true },
    { "wave": 4, "tasks": ["B8"] },
    { "wave": 5, "tasks": ["B9", "B20"] },
    { "wave": 6, "tasks": ["B10", "B11"] },
    { "wave": 7, "tasks": ["B12"] }
  ],
  "buildable_now_without_gate_or_owner": ["A1", "B4", "B5", "B6", "B7", "B2", "B20"],
  "blocked_only_on_a_drive_folder_id": ["B13", "B14", "B15", "B16", "B17", "B18", "B19"],
  "blocked_on_owner_authorisation_to_modify_other_repo": ["A2", "A3", "A4", "A6"],
  "blocked_on_gates": ["A3", "B8", "B9", "B10"],
  "single_highest_risk": "A1"
}
```

## Waiting on the owner

- [ ] **A0: authorisation to modify the other repository** (the gate on half of v1.0)
- [ ] G1, G3 for both tokens, G4 for two credentials
- [ ] D-BENCH, plus the provider base URL in the environment
- [ ] A decision on whether one kill-switch flip should stop both agents (B9)
- [ ] **A Drive folder id, or a `--discover <term>` search term, for `B13`-`B19`** (README §12.2; never
      guessed, per `two-agent-vps.md` R-B)
