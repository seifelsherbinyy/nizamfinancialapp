# Spec 07 - Bot bring-up v1.0

> **Goal, in one sentence.** Two Telegram bots, each an independent agent process on the one host,
> answering the owner and nobody else, with real model replies, and nothing else.
>
> **Deliberately lightweight.** No container orchestration, no domain, no certificate, no proxy, no
> public port, no signal-bus process, no scheduler, no backup drill, no statement parsing. Each of
> those is real work that v1.0 does not need in order to be *used*, and every one of them is already
> specified elsewhere (spec `06-two-agent-vps`) so nothing is lost by deferring it.
>
> **Phase:** v1.0. **Prerequisite spec:** `06-two-agent-vps` (everything below sits on its ports,
> loader, guards, routing and store). **Sibling spec:** `08-knowledge-ingestion` phase A can run in
> parallel; phase B depends on this spec being done.

## 0. Why this spec exists

Spec 06 built the tier correctly and then stopped one layer short of running. Its own final report is
honest about it: what is proven is that the artifacts *say* what the contracts require, not that any
procedure in them *works*. Measured on 2026-08-10, zero of spec 06's seven "definition of live"
conditions had ever been observed.

The distance to a working bot turned out to be much shorter than spec 06's own task list implies, and
this spec exists to name that distance precisely rather than re-plan the tier.

**Three measured facts set the scope.**

1. **The transport is already wired.** A real boot reaches
   `financeAgent -> runUntilShutdown -> runOnceLocal -> pollOnce -> liveTransport.pollOnce` and only
   then fails. The live transport adapter is in the call path, not bypassed.
2. **What fails is the bottom of the stack.** Exactly two functions in `src/server/process/main.ts`
   throw instead of performing a request, and the model port next to them throws too. They are
   deliberate, documented, typed refusals, not defects.
3. **Nothing can be packaged today.** Every image this repository owns fails at its entrypoint,
   because bare `node` performs no extension search over the extensionless relative imports the
   project's own toolchain resolves. This is finding **F18** and it blocks containers only.

So v1.0 is: fill the seams, skip the containers, run two processes under the host's own service
manager, and observe a reply.

## 1. Definition of done for v1.0

Observed, never asserted. Each line is a thing a human sees happen.

| # | Condition | How it is observed |
|---|---|---|
| **V1** | Both bots reply to the owner | Owner messages each bot, each answers |
| **V2** | Neither bot replies to anyone else | A non-allowlisted sender is refused, and the refusal does not say which check failed |
| **V3** | The reply is a real answer, not an identifier | The turn reaches a model through a pinned slug and returns prose |
| **V4** | Two independent processes, isolated | Separate store, separate model key, separate periodic cap; neither can open the other's store |
| **V5** | Spending refuses rather than overruns | Drive one agent's ledger to its cap; the next call refuses and the other agent is unaffected |
| **V6** | Both halt forms work | The sentinel file stops model calls; the halt-all entry stops the agent on restart |
| **V7** | A duplicate delivery has one effect | The same update delivered twice produces one reply and one queue row |
| **V8** | The harness is green and the tree is committed | `npm run verify:all` reports every named check passing |

Deliberately **not** in v1.0's definition of done: a published port, a certificate, a webhook, an
off-host backup, a restore drill, a bus process, a scheduled tick.

## 2. Rulings this spec needs from the owner

Three. Nothing else in the spec waits on a question, and the build proceeds on the recommendation
while an answer is outstanding.

### D-LIFE-RUNTIME (the only one that changes the architecture)

Agent 2, the life side, has no code in this repository. It is Python in the other repository, that
repository is not present on this machine, and the three change specifications under
`ops/nizamcore-patches/` are explicitly labelled as non-applicable, unverified, and unapplied.

| Option | What it means | Cost |
|---|---|---|
| **(A) Second instance of this process** *(recommended)* | Run the same Node agent twice, parameterised by agent identity. The loader **already** declares a full entry set for the life service, `SPEND_AGENTS` **already** enumerates both identities, per-agent cap isolation and per-agent store isolation are **already** built and tested. The life persona is a system-prompt and tool-allowlist difference, not a different codebase. | Small. One assembly change. Needs a steering amendment, because steering currently assigns the life agent to the other repository. |
| **(B) Wait for the Python agent** | Apply three unverified change specifications inside a repository nobody has read, then deploy a second runtime and language on the host. | Unestimated, and it does not make bot B arrive sooner. |

**Recommendation: (A) for v1.0, revisit (B) for v2.** Option A is the only one that makes "two agents
conversing" true this week, and it reuses machinery that is already tested rather than adding a
second stack.

### D-F18-SCOPE (build decision, recorded here so it is not silently taken)

| Option | Cost | Verdict |
|---|---|---|
| **Run under a resolve hook** *(recommended for v1.0)* | The hook already exists and is proven: with it, the real entrypoint boots, opens its store and enters the poll loop. It restores exactly the resolution the project's own toolchain performs and nothing more. | Take it. It is a **workaround, recorded as one.** F18 stays open. |
| **Add `.ts` to every relative specifier** | 606 specifiers across 142 files under `src/server` alone, plus flipping a compiler option. | Too wide a diff for v1.0. |
| **Add a build step emitting runnable modules** | The correct fix, and the one containers need. | v2, with its own tests and commit. |

**F18 is not closed by this spec.** It is bypassed for a non-container deployment and stays on the
register, because a container path that cannot start is a real gap and calling it fixed would hide it.

### D-BENCH (spend, and V3 depends on it)

A registry marked provisional may never promote a model for live routing. That is a hard invariant
with a type-level guarantee behind it and **this spec does not weaken it**. So a model-bearing reply
needs a measured registry, which needs one benchmark pass, which spends the owner's money and needs
the provider base URL resolved from the provider's own documentation.

Estimated at about a third of the development key's periodic allowance for a single pass. Until it is
authorised, **V3 cannot be observed** and the bots answer deterministically only.

## 3. The seams to fill

All in one file, `src/server/process/main.ts`, all currently explicit refusals. This is the whole
build surface of the spec.

| Seam | Where | Today | v1.0 |
|---|---|---|---|
| **S1** inbound | `fetchUpdates` | throws | long-poll `getUpdates` against `MSG_API_BASE`, bounded, offset-advancing |
| **S2** outbound | `sendMessage` | throws | `sendMessage`, with the existing retry and rate-limit refusal policy |
| **S3** model port | `createUnavailableModelPort` | throws | a real completion call honouring the cap and recording telemetry |
| **S4** request planner | `planModelRequest` | throws | turn plus facts to a request against a pinned slug |
| **S5** turn facts | `readTurnFacts` | returns conservative facts, so every turn classifies to the no-model tier | a real extraction step so a turn can classify above it |
| **S6** deterministic answer | `executeDeterministically` | returns the turn's own reference, a bare identifier | a human sentence for the deterministic intents |
| **S7** agent identity | `financeAgentDependenciesFromHost` | hard-codes one agent | parameterised by agent identity, resolving entry names through the existing helper |

**S1 and S2 are the only two that touch the network.** They are also the artifact the repository
deliberately does not contain today, which is why they are named first and fenced hardest: no request
function, no request module and no scheme literal exists in the adapter, and a test asserts that.
Adding them is a capability change and gets its own negative tests.

## 4. Gates v1.0 needs, and the four it does not

| Gate | v1.0 | Why |
|---|---|---|
| **G1** provision and harden the host | **required** | the trust root; every runtime item is downstream |
| **G3** two bots, placement half | **required** | the bots exist and were verified live already; only placement remains |
| **G4** two model keys with periodic caps | **required for V3** | live routing needs a real key with a provider-side ceiling |
| G2 records for two hostnames | not needed | long-poll needs no name |
| G6 register both webhooks | not needed | long-poll is the transport |
| G5 storage consent | not needed | no off-host copy in v1.0 |
| G8 backup keypair | not needed | no archive is produced, so nothing is retroactively voided |

Deferring G5 and G8 together is deliberate and safe: an archive taken before the keypair exists off
host would void the backup guarantee retroactively, so v1.0 produces **no archive at all** rather
than a weak one. That constraint is why backup is out of scope instead of half-done.

## 5. Test ladder for v1.0

Stop at the first rung that fails. A rung is not passed because the code looks right.

| Rung | Proves | Pass condition |
|---|---|---|
| **L0** config | The loader refuses an incomplete environment | Break four entries at once: the boot fails and names all four in one message. Restore them: the boot proceeds and the store opens. **Already scripted and passing.** |
| **L1** guards | Both directions of the mode-aware guard | An unlisted sender refused; the owner accepted with no secret header under long-poll; the same delivery still refused under webhook. **Already built.** |
| **L3'** transport | A real reply | Owner messages each bot and gets an answer. Kill an agent mid-work, restart, and the in-flight update completes exactly once |
| **L4'** money and halt | Refusal beats overspend | Drive one agent to its cap: the next call refuses, a deterministic alert still fires, the other agent is unaffected. Sentinel stops model calls; halt-all stops on restart |

L2 (compose) and L5 (backup and restore) are **out of scope**, tied to F18 and to G5/G8 respectively.

## 6. Runtime posture

- Two long-lived processes under the host's own service manager, one per agent identity.
- **No published port.** Long-poll dials outward; nothing listens publicly.
- Each process: its own data directory, its own store file, its own model key, its own periodic cap,
  its own liveness record.
- Secrets live only in the root-owned configuration directory G1 creates, mode-restricted, one file
  per agent. Never in this repository, never in a shell history, never in a log.
- The webapp is a **mode of the same entrypoint**, bound to loopback by construction, reached over
  the operator's existing administrative tunnel. It is one flag, it publishes no port, and it is the
  cheapest item in the plan because it is already built and already tested.

## 7. Explicitly out of scope

Container images and compose; the reverse proxy; DNS and certificates; webhook registration; the
signal-bus process and cross-agent signalling; the scheduler; backup, restore and the disaster drill;
the Python life agent and the three cross-repo change specifications; statement parsing of any kind;
the budgeting engine's own pipeline beyond what a deterministic answer needs.

Every one of these remains specified in `06-two-agent-vps`. None is deleted, and none is marked done.

## 8. Interlock with spec 08

Spec 08 phase A loads the owner's real financial history into the store and needs no bot. It can run
in parallel with this spec and **should land before the first conversation**, so the first reply has
something true to say. Spec 08 phase B, the two-way learning loop, needs S1 to S6 from this spec and
therefore follows it.
