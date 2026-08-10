# Spec 07 - Bot bring-up v1.0 (both bots)

> **Purpose.** Get **both** Telegram bots answering the owner, as two agent processes on the one VPS, in
> the shortest honest path. Nothing else.
>
> **REVISED 2026-08-10 on new evidence.** The previous revision of this file scoped v1.0 to **one**
> conversing agent, on the stated grounds that the life capabilities lived in a repository this session
> could not read. **That repository has now been read**, under the standing read-only carve-out, and the
> grounds do not hold. See `ops/NIZAMCORE_VERIFIED_STATE.md`, which is the evidence base for every claim
> below about the other repository. Read it before re-opening any decision here.
>
> **Owner ruling of record:** the owner defined the two personas on 2026-08-10 (bot A therapeutic
> journaling, brainstorming, challenging and debating; bot B budgeting and finance) and directed that
> both repositories be brought into this spec.
>
> **Parent spec:** `06-two-agent-vps` remains the authority on topology, isolation, gates and contracts.
> This spec carves a v1.0 slice and defers the rest.
>
> **Requirement prefix:** `B`. **Public repository (R24) binds.** Placeholders only, no particular.
> **Gate discipline binds.** No task performs a gate, invents a secret, or weakens a guard.

## 0. What changed, and why the scope reopened

Three findings from reading the other repository, each recorded with its consequence.

1. **Bot A is fully specified and largely built.** Its Phase 1 modules are exactly the owner's four
   wants. Its messaging transport exists with 29 relay tests, pure standard library. Its governance is
   built: three gates around every turn, a deterministic governor as sole ledger writer, separate kill
   switch and cost ceiling modules. Twelve agent personas are authored.

2. **Two of the three cross-repo change specifications are not on the v1.0 path.** The wrapper serves a
   webhook topology v1.0 does not use, and per-bot de-duplication matters only when one process serves
   two bots, which neither repository does. Only the bus egress target is still required, and it is a v2
   capability on both sides. **"Blocked on three unapplied patches" is retired as a v1.0 statement.**

3. **Both agents stopped on the same line.** Each has a working transport and a non-calling model layer,
   each held by a gate that a model credential releases. Neither is behind the other. This is the single
   most useful fact in the spec: **one wiring task per repository, plus one shared gate, is the whole of
   v1.0.**

## 1. Definition of done for v1.0

Seven conditions, each observed on the host and evidenced, never asserted.

1. The owner messages **bot A** and receives a **model-generated** reply that reflects the routed agent
   (a capture, a co-thinking turn, or a critique), not a canned string.
2. The owner messages **bot B** and receives a real answer about budgeting.
3. An unlisted sender is refused by **both** bots, and neither refusal reveals which check failed.
4. Each bot routes through its own model credential and its own spend bound. Exhausting one refuses that
   one and leaves the other able to call.
5. Both processes survive a restart, and an in-flight update completes exactly once on each.
6. The kill switch halts **both**, in both of its forms. The entry name is shared, which is why one flip
   must be shown stopping two processes.
7. `npm run verify:all` is green in this repository and the tree is committed.

**Bot A's three gates must be shown firing**, not merely present: the recovery pre-gate, the privacy
pre-write gate and the continuity post-gate. Its own design makes recovery override tactical pressure, so
a bring-up that never exercises the downshift has not exercised its top operating principle.

## 2. The ruling this spec now carries

### D-LIFE-RUNTIME, superseded on 2026-08-10

The earlier options were **(a)** apply three patches in the other repository, or **(b)** ship one bot and
leave the other idle. Both rested on the belief that the life agent was unread and patch-blocked. It is
neither.

> **Option (c), adopted: deploy the other repository's existing agent as it stands, and wire its model
> layer there. No patch is on the v1.0 path.**

| Option | Verified position |
|---|---|
| **(a)** apply the three patches first | Two are off the v1.0 path, one is v2. Superseded by (c). |
| **(b)** one bot, other idle | Was the correct call on the evidence then available. **No longer the cheapest path to two bots**, and it under-delivers against the owner's stated intent. |
| **(c)** deploy and wire in place | **Adopted.** Smallest change per repository, no cross-repo patch, no second implementation of a life agent in this repository's language. |

**Option (c) does not need the steering amendment the previous revision described**, because it does not
make this repository the life agent. Steering §1 still holds: this repository is the finance agent. The
life agent stays in its own repository, in its own language, with its own store, key, bound and gates.
`ops/AGENT_CAPABILITY_SPLIT.md` stays correct on every row.

**What option (c) DOES need, and it is the one thing this spec cannot self-authorise.** Wiring the model
layer means **modifying the other repository**. Steering §6 and §2a permit a read-only clone or fetch and
**gate modify and push on the owner**. So:

> **The single owner authorisation this spec requires: permission to modify the other repository for the
> tasks named A2 and A3.** Nothing in that repository has been created, changed, staged, committed or
> pushed. Until that authorisation is on record, every bot A task is `BLOCKED - awaiting human` and every
> bot B task proceeds.

### D-ONE-WINDOW, ruled 2026-08-10 on the owner's instruction

> **Every bot A agent presents through ONE messaging window: the single bot whose token the other
> repository reads as `BOT_A_TOKEN` (`<BOT_A_HANDLE>`). The owner does not open a chat per agent. One
> conversation, and the routing happens inside it.**

**This was CONFIRMED against the other repository's own files, not assumed.** It is already the design,
so the requirement costs no architectural change:

| What was checked | Measured result |
|---|---|
| how many bot credentials the other repository knows | **exactly one** token environment entry across its whole system tree |
| where a reply is addressed | its poller reads the incoming conversation id and replies to that same id, private conversation type |
| how an agent is chosen | its coordinator calls a router that reads the routing configuration and returns a target codename per message, defaulting to the capture agent |
| routable agents behind the one window | **10 intents** to 10 codenames, plus **3** direct commands and **3** control commands |
| does a gate get to re-target inside the window | yes. A crisis signal re-targets to the crisis protocol, and the recovery gate downshifts the critic to the brainstormer |
| the governor | present, deliberately **not** routable: it holds the ledger and the gates rather than taking a turn |

**Consequence for the work.** A2 wires the model layer **behind that single window**, and A3 takes that
single relay live. There is no per-agent transport to build, no second bot for bot A, and the agent
identity seam in this repository (**S7**) stays optional exactly as recorded.

**One defect this confirmation surfaced, now `A-G4` and task A5.** Of the 10 routable targets, **9
resolve fully and 1 does not**: the decision-log intent points at a codename that exists in the codename
mapping layer but is **absent from the runtime registry** and whose **persona file does not exist**. So
one intent inside the single window currently dead-ends. Author and register it, or remove the intent.

**What is NOT ruled here, and it is a real fork.** `D-ONE-WINDOW` covers **bot A's agents**. Bot B, the
finance agent in this repository, still has its **own** credential (`BOT_B_TOKEN`), its own bound and its
own window, which is what steering section 1, R17, and definition-of-done conditions 3, 4 and 6 all
assume. Collapsing both agents into one window would be a different topology, would need a steering
amendment, and would put a money-handling process behind the same conversation as the journal. It is not
assumed in either direction here. **See the open question in section 10.**
### D-F20-SCOPE (under revision, see the observation below)

The ruling as written: bot B runs under the existing resolve hook for v1.0, **F20 stays open**, it is
bypassed for a non-container deployment and remains on the register, because a container path that cannot
start is a real gap and calling it fixed would hide it. Adding a build step that emits runnable modules
is the correct fix and is v2.

> **OBSERVATION, 2026-08-10 16:00, on the WORKING TREE and NOT on any commit.** The parallel build loop
> is fixing F20 at source rather than by a build step: it is making every relative import specifier
> extension-explicit and `allowImportingTsExtensions` now reads `true` in `tsconfig.json`. At the time of
> this note the count of extensionless relative specifiers under `src/server` had fallen from **606 across
> 142 files** to **5**, with 215 files dirty and no commit yet.
>
> **What was measured, once, and reproducibly.** `node src/server/process/start.ts` with **no resolve
> hook** on Node 24.14.1 now loads every module, reaches the configuration loader, refuses with all **16**
> finance entries named in one message, and exits 1. Before this change the same command died at
> `ERR_MODULE_NOT_FOUND`. That refusal is exactly rung **L0**'s pass condition.
>
> **What this note does NOT do.** It does not close F20, it does not move the ruling, and it does not tick
> anything. The change is uncommitted, 15 extensionless specifiers remain elsewhere under `src/`, and the
> loop has not yet run its own harness. **Re-measure before relying on any of this**: count the
> specifiers, run bare `node src/server/process/start.ts`, and read `npm run verify:all` on a settled
> tree. If it holds after a commit, D-F20-SCOPE should be rewritten to record F20 as fixed at source and
> the resolve hook as no longer on the v1.0 path, and section 7 below changes with it.

### D-BENCH (unchanged, and now serves both bots)

A registry marked provisional may never promote a model for live routing. **This spec does not weaken
that.** Bot B needs one measured benchmark pass. Bot A needs the same class of credential to leave
standby. **One gate release, two bots unblocked.**

## 3. The two agents, side by side

| | **Bot A - the life agent** | **Bot B - the finance agent** |
|---|---|---|
| Repository | the other one (read-only here) | this one |
| Language | Python, standard library relay | TypeScript on the pinned major |
| Persona | journaling, brainstorming, challenging, debating | budgeting and finance |
| Transport | long-poll runner, built, 29 relay tests | long-poll, built, in the live call stack |
| What blocks a reply | the agent call is a deterministic stub, and the relay is held in standby | two request functions throw, and the model port throws |
| Gates around a turn | recovery, privacy, continuity, plus a deterministic governor as sole ledger writer | classification, cap, halt |
| Store | its own | its own |
| Agent runtime | **declared in one line, imported by nothing** (the main unknown) | not applicable |
| Owner authorisation to modify | **REQUIRED** | already held |

## 4. The work, per repository

### 4.1 Bot B, in this repository: seven seams in `src/server/process/main.ts`

Unchanged from the previous revision and still accurate at commit `1cd0a32`.

| # | Seam | Line | Today |
|---|---|---|---|
| S1 | `transportClient.fetchUpdates` | 263 | throws |
| S2 | `transportClient.sendMessage` | 268 | throws |
| S3 | model port `complete` | 219 | throws |
| S4 | `planModelRequest` | 279 | throws |
| S5 | `readTurnFacts` | 287 | conservative facts, so **every turn classifies T0 and no model is reached** |
| S6 | `executeDeterministically` | 278 | returns the turn reference, so a deterministic reply is a bare identifier |
| S7 | agent identity | 245 | finance-hardcoded, which v1.0 no longer needs to change (see below) |

**S7 is demoted to optional.** Its only purpose was running a life agent in this process, which option
(c) removes. It stays listed because parameterising identity is still correct hygiene, not because v1.0
needs it.

### 4.2 Bot A, in the other repository: three gaps

| # | Gap | Where | Today |
|---|---|---|---|
| A-G1 | the agent runtime is declared, not integrated | its runtime agent registry | one configuration line, **no module imports it**, no dependency manifest lists it |
| A-G2 | the agent reply is a deterministic stub | its coordinator | full pipeline runs for real, then a canned string is returned |
| A-G3 | the relay is held in standby | its relay environment | correct by design, released by a credential |
| A-G4 | one routable agent does not resolve | its routing configuration, registry and persona directory | the decision-log intent targets a codename absent from the runtime registry with no persona file, so that intent dead-ends inside the single window (task A5) |

**A-G1 is the only genuine unknown in the entire v1.0.** The package is real and its version floor is
satisfiable, but it carries a large dependency tree against a relay that advertises zero installed
dependencies, and nothing in that repository has ever imported it. **Close A-G1 before estimating
anything else on bot A.**

## 5. Gates v1.0 needs, and the four it does not

Needed: **G1** provision and harden the host. **G3** place both bot tokens. **G4** mint two model
credentials with their bounds.

Deferred with the reason: **G2** domain and records, and **G6** webhook registration, because both
agents use long-poll and neither needs a name, a certificate or a public port. **G5** storage consent and
**G8** the backup keypair, because durability is a v2 guarantee, which means **v1.0 has no off-host copy
and no proven restore.** That is a recorded debt.

## 6. Test ladder for v1.0

| Rung | Bot | Pass condition |
|---|---|---|
| **L0** config | both | each refuses an incomplete environment and names every missing entry at once. **Already `OBSERVED` for bot B.** |
| **L1** guards | both | an unlisted sender refused, the owner accepted, the same update twice producing one effect. **Already `OBSERVED` for bot B** (25 tests). |
| **L3'** transport | both | the owner messages each bot and gets a **model-generated** reply. Kill mid-work, restart, the in-flight update completes exactly once. |
| **L4'** routing and safety | both | a turn routes and the spend is recorded; the bound refuses at exhaustion while the deterministic alert still fires; one kill-switch flip stops **both** processes. |
| **L5'** bot A gates | A | the recovery pre-gate downshifts, the privacy pre-write gate blocks a classified capture, the continuity post-gate records. |

L2 (containers) and the backup drill are out of scope per §5.

## 7. Runtime posture

Both agents run as host services under the host's own service manager. No containers, no proxy, no
published port, no domain. Bot B starts under the resolve hook per D-F20-SCOPE, **or bare if the F20
observation in section 2 holds after a commit**, which is the cheaper posture and needs no hook on the
host at all. Bot A runs on a Python
major its runtime package supports. The agent runtime's profiles live outside both repositories, per host.

## 8. Explicitly out of scope for v1.0

Containers and the proxy. The domain, records and webhooks. The signal bus **process** and therefore all
cross-agent signalling, which also means the money-pressure band does not reach bot A and the recovery
band does not reach bot B in v1.0. Backup, off-host copy and the restore drill. The wearable connector.
The Stage 1-4 finance engines, so **bot B converses about budgeting without quoting live balances**; the
already-built web app is where numbers are reviewed, per B12.

## 9. Risks, ranked

1. **A-G1, the agent runtime.** One declared line, nothing importing it, a large dependency tree. If it
   does not install cleanly on the host, bot A's model layer needs a direct provider call instead, which
   is a different task. **Close it first.**
2. **The other repository has been dormant since 2026-05-29.** Anything assumed to be progressing there
   is not.
3. **Owner authorisation to modify the other repository** is the gate on half this spec.
4. **One credential releases both bots**, so a single benchmark and cap decision has twice the blast
   radius. The bounds are per agent and must be shown isolated.
5. **The parallel build loop in this repository rewrites specs.** This file has already been rewritten
   once mid-session. Re-read it before acting on a remembered version.

## 10. The one open question for the owner

**Does bot B share bot A's single window, or keep its own?**

`D-ONE-WINDOW` is settled for bot A and needs no further input. The instruction that set it said *all* of
them, and "all" has two readings that lead to different deployments:

| Reading | What it means | Cost |
|---|---|---|
| **One window for bot A's agents, bot B keeps its own** | the recorded position. Two bots, two credentials, two bounds, two stores. Matches steering section 1, R17 and definition-of-done 3, 4 and 6 | **none.** Already the plan, and already how both repositories are built |
| **One window for everything, bot A and bot B** | a single conversation reaches the journal agents *and* the money agent. One transport, one allowlist, an agent-selection layer in front of two processes | a steering amendment, a rewrite of three definition-of-done conditions, and a money process sharing a conversation with the journal. **Not recommended, and not started** |

Until the owner answers, this spec proceeds on the **first** reading, because it is the one every existing
contract already assumes and it is reversible. Nothing is blocked by the question.

## 11. Two findings raised while confirming `D-ONE-WINDOW`

### 11.1 A bot name is already committed, and the particulars scan cannot see it

**Measured 2026-08-10.** A repository-wide sweep of every tracked file for the life bot's name returns
**exactly one hit**, and it is **committed**: `.kiro/specs/06-two-agent-vps/tasks.md` line 591 quotes the
name inside the record of the owner's clarification. None of the files written in this session contain it,
and none ever should.

**Why the harness did not catch it.** The particulars scan roots are `ops` and the server fixture
directory. **`.kiro/**` is not scanned**, so AC18 has never looked at any specification file. That is a
scan-root gap, not a scanner defect: the guard is working exactly as configured, over a smaller surface
than R24 claims.

**This needs an owner ruling, and it is deliberately not taken here.** Two coherent answers:

| Ruling | Consequence |
|---|---|
| the project's own brand name is **not** a deployment particular | R24 is clarified to say so explicitly, and the committed line stays. The scan roots may still be widened for the other particular classes |
| a bot name **is** a particular, as R24 already says | the line is rewritten to a placeholder and `.kiro/**` is added to the scan roots, which will surface anything else hiding there |

**Do not resolve this by widening the guard's allowlist.** Widening a guard so existing text passes is
the failure the guard exists to prevent. Either the rule changes on the record, or the text does.

### 11.2 The deployment consumes a token, never a name

Worth stating because it removes a whole class of risk from `D-ONE-WINDOW`: the messaging platform
distinguishes a bot's **display name**, which is cosmetic and changeable, from its **handle**, which is
unique and effectively permanent. **Neither is consumed by either agent.** Both read a token,
`BOT_A_TOKEN` and `BOT_B_TOKEN`, placed under gate **G3** into the host configuration directory.

So the window can be named whatever the owner likes, renamed later at no cost, and **the name never needs
to enter a tracked file in either repository.** The single-window ruling binds the *token*, not the label.

## 12. Live-data proof addendum (two-way gates, Drive lanes, the privacy test)

Added 2026-08-11, on the owner's request for an end-to-end proof run against live Drive data. This
section amends the test discipline and adds one data track. It does not change section 1's seven
conditions, section 5's gates, or section 2's rulings.

### 12.1 Two-way gate discipline (binds every rung and every gate claim from here on)

**A gate is only proven when it has been shown both firing and releasing.** Observing a refusal without
ever observing the matching success (or the reverse) is half a proof. For every item in section 6's test
ladder and every gate in section 5, the observation recorded in `LIVE_PROGRESS_V1.md` must include:
- the **positive** case: the gate lets a valid input through, quoted, or
- the **negative** case: the gate refuses an invalid input, quoted, with the refusal code or message,

and wherever the gate can meaningfully do both (config validation, the recovery downshift, the privacy
pre-write gate, token validation), **both** must be recorded, not one. Tampering an input to produce the
negative case is deliberate and expected; it is not a failure of the run.

### 12.2 The Drive lane classification (new data track, this repository, no new gate)

Before any Drive content is imported or shown to a model, every listed file in the target Drive folder is
sorted into exactly one lane:

| Lane | Meaning | Egress rule |
|---|---|---|
| `FINANCE-NUMERIC` | a statement, ledger, invoice or receipt whose amounts are usable | amounts only may become finance transactions; narrative is stripped to a merchant-level description |
| `JOURNAL-LOCAL` | a journal, session, brain-dump or reflective text | `strict_local` per the privacy classification; never leaves the host, never enters a model request |
| `MEDICAL-LOCAL` | a diagnosis, assessment, prescription or therapy note | `strict_local`; never leaves the host, never enters a model request, in this run or any future one without a separate written widening |
| `EXCLUDED` | anything else | recorded with a reason, not silently dropped |

The four lane counts must sum to the total files listed. A file with no lane assigned is a reporting
defect. This classification is a **local enumeration step** against a Drive folder the owner names (or
locates via a discovery search); it is not the shipped app's `drive.file` grant and must not be described
as if it were — see steering `two-agent-vps.md` §0b and this repo's own drive-db.md scope note.

**The medical archive is not test data for a model.** Under the dev-key carve-out (README parent spec 06
§3 / steering §3), live model calls are permitted only on the sanitized benchmark eval set, never against
real financial or journal data, and `MEDICAL-LOCAL` content specifically must never be placed in a model
request in this run. Its role in this proof is to be **blocked** by the privacy pre-write gate (task A6),
with that block quoted as evidence — a stop signal, if reached, means the run has gone wrong, not that a
task remains to finish.

### 12.3 Amendment to the L3' / L5' pass condition — the conversational matrix

Section 6's `L3'` row ("the owner messages each bot and gets a model-generated reply") and `L5'` row
("bot A gates fire") are both satisfied, for bot A, only by observing this six-message matrix live, one
row per message, both directions transcribed:

| # | Message | Expected route | What it proves |
|---|---|---|---|
| 1 | a plain sentence | capture agent | journaling capture |
| 2 | a brainstorming command with a real decision | brainstormer | co-thinking |
| 3 | a challenge command with a real plan | critic | challenger |
| 4 | a follow-up to row 2's thread | continuation | thread resume, not a fresh turn |
| 5 | a low-capacity statement | recovery downshift | the critic must **not** be selected — proves the top operating principle |
| 6 | a decision-log style statement | dangling target (`A-G4`) | expect silence, not a crash, until A5 closes it |

Row 5 is the load-bearing row: a bring-up that never exercises the downshift has not exercised bot A's
own stated top operating principle. Row 6 is expected to reproduce the known defect, not to pass it —
recording that reproduction is the evidence, not a blocker.

### 12.4 New tasks this addendum adds

`B13`-`B19` (Drive lanes -> real numbers in the app, this repository, gated only on the owner supplying a
Drive folder id — see "Waiting on the owner"), `A6` (the privacy gate two-way test, bot A, gated on `A0`
+ `A2` + `A3` same as the rest of wave 2), and `B20` (the Drive-to-host wiring plan, planning only). See
`tasks.md` waves 1.5, 2 and 5.
