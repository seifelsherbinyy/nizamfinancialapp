# Verified state of the other repository (the life agent)

> **Why this file exists.** Every document in this repository that describes the life agent was written
> **without reading it**. `ops/nizamcore-patches/` says so in its own header, `ops/INTEROP_CONTRACT.md`
> §9 says so, and `ops/AGENT_CAPABILITY_SPLIT.md` records rows 22-27 as `gap - no NIZAM contract`. That
> was honest, and it was also wrong about the facts. This file is the first record in this repository
> written from the other repository's actual bytes.
>
> **Provenance.** Read-only clone taken 2026-08-10 at an ignored path outside this tree, refreshed the
> same day. Branch `main`, commit `071e54c`, **last commit dated 2026-05-29**. 313 files, 65 Python
> modules, 146 documents, 143 test functions.
>
> **Authority for reading it.** Steering §2a (the read-only carve-out, standing as of 2026-08-10) and
> `ops/INTEROP_CONTRACT.md` §10: a read-only clone or fetch is permitted; **modify and push stay
> owner-gated.** Nothing in that repository was created, changed, staged, committed or pushed.
>
> **R24 still binds here.** No hostname, address, identifier, token or provider endpoint from that
> repository is reproduced below. Where it holds one, this file says so and names the placeholder.

## 1. What the other repository actually is

It is not a thin life-agent shell. It is a personal operating system with its own governance,
registries, personas and ledgers, published under its own name. Its Phase 1 minimum viable product is
three cognitive modules plus a recovery gate, and those three modules are **exactly** the capabilities
the owner asked for on 2026-08-10.

| Owner's stated want | Module in the other repository | Agent codename | Hermes profile |
|---|---|---|---|
| therapeutic journaling | brain-dump module, plus a journaling module | `Amin` | none |
| brainstorming | consultation module ("co-thinking partner") | `Salman` | `shura` |
| challenger | critique module ("red-team your plans") | `Hazim` | `naqd` |
| debating together | the two above, dual-lane, with an arbitrator | `Salman` + `Hazim` | both |

A fourth foundation module tracks recovery signals and drives a downshift gate that **overrides
tactical pressure**. That is its stated top operating principle.

## 2. Correction to `ops/AGENT_CAPABILITY_SPLIT.md`

That document marks the life rows 22 to 27 as governed by `gap`, and concludes "there is no NIZAM
contract governing the life side."

**Read narrowly, that is true: no contract in THIS repository governs it. Read as a statement about the
system, it is false.** The other repository governs those capabilities with its own always-loaded facts
file, a temple/registry document, a per-agent persona document for every codename, a privacy
classification policy, a tool-access matrix, and a runtime agent registry. Twelve persona documents
exist, one per agent.

The correct characterisation is **a cross-repository visibility gap, not a specification gap.** The
split's row-by-row reasoning about what may cross the bus stays correct and is untouched by this file:
a journal entry is still a narrative, a recovery reading is still a figure, and the envelope still has
no field for either.

## 3. What is already built there, and it is more than assumed

**The messaging transport exists and is tested.** The other repository holds a long-poll runner, an
authentication module, a de-duplication module, a coordinator, a recovery-gate module and a webhook
module. Its relay tests number **29** across two files (7 plus 22). The runner is **pure standard
library, no installed dependencies**, and pulls updates outbound so it needs no public endpoint, no
webhook registration, no domain and no certificate.

Its authentication for long-poll is an allowlist of operator identifiers. It resumes from a
de-duplication offset. It has a standby/live mode gate, a no-network dry-run mode and a single-cycle
mode.

**Governance is built.** Three named gates run around every turn: a recovery pre-gate, a privacy
pre-write gate and a continuity post-gate. A deterministic governor agent is the **sole writer** to
every ledger, makes no model calls, and carries a zero cost ceiling and zero tool budget. Separate
modules exist for the kill switch, the cost ceiling, classification, strict-local-maximum handling and
sync arbitration.

**The runtime agent registry is authored.** Twelve agents, each with a persona document, a primary and
reviewer model, a delegation list, context sources, target ledgers, an egress class and its three
gates. Delegation depth is capped, and one agent is named conflict arbitrator with a confidence-delta
threshold.

**A router configuration is authored**, mapping intents to agents, including brainstorming to the
consultation agent and red-teaming to the critique agent, with confidence bands and a
capture-instead-of-judge fallback.

**The kill switch environment entry has the same name in both repositories.** That is a genuine
compatibility win and was not designed for; it was discovered.

## 4. The three honest gaps there, stated as they are

1. **The agent runtime is declared but not integrated.** The registry names a runtime package and a
   version floor, sets a profiles root outside the repository, a tool budget, a session-reset rule and a
   memory tier. That is **one line in one configuration file**. **No Python module imports it**, and no
   dependency manifest lists it. The package itself is real and its version floor is satisfiable, and it
   carries a large dependency tree, which is a material decision against a relay that currently
   advertises zero installed dependencies.

2. **The agent reply is a deterministic stub.** The coordinator runs the whole pipeline for real
   (recovery gate, router, privacy gate, ledger append) and then calls a stub that returns a canned
   string. Its own docstring says the model layer is engaged in a later phase. **No model call is made.**

3. **The relay is held in standby by design**, pending the same class of gate this repository calls G4.
   So the transport is proven and deliberately silent.

**And it has been dormant since 2026-05-29**, while this repository committed daily through 2026-08-10.
Any plan that assumes work is progressing on both sides is wrong.

## 5. The two agents are at the SAME point, and this is the finding that matters

| | Life agent (other repository) | Finance agent (this repository) |
|---|---|---|
| Messaging transport | built, 29 relay tests | built, in the live call stack |
| Model layer | a stub returning a canned string | a port whose only member throws |
| Held by | a standby mode gate | a provisional registry |
| Released by | a model credential | a model credential (G4) |
| Kill switch entry | same name | same name |

Two independent builds, the same architecture, the same stopping line, the same blocking gate, and
neither had read the other. Neither is behind the other.

## 6. Consequence for `ops/nizamcore-patches/`

The three change specifications were authored without reading the target. Against the verified state:

| Specification | Verified position |
|---|---|
| 001 wrap the update handler so the topology can start it, and add a health endpoint | **Not required for a long-poll v1.0.** The target already holds both a long-poll runner and a webhook module. The wrapper serves the webhook topology, which v1.0 does not use. |
| 002 key de-duplication per bot | **Not required for v1.0 as scoped.** Per-bot keying matters when one process serves two bots. Each repository serves one. It remains correct for any future single-process, two-bot arrangement. |
| 003 add the bus as an egress target | **Still required, and still deferred.** This is cross-agent signalling, which is a v2 capability in both repositories. |

So the standing description of the life side as "blocked on three unapplied patches" **does not hold for
v1.0.** One of the three is a v2 item and two are not on the v1.0 path at all. None of them was applied,
verified, or is claimed here to apply cleanly.

## 7. One hygiene finding in the other repository

Its relay environment example commits a **real-looking numeric operator identifier** as a default value.
R24 in this repository names "a numeric messaging user identifier" as a deployment particular, so the
equivalent file here would fail its own scanner. **The value is deliberately not reproduced in this
file.** Recommended action there: replace it with a placeholder. It is lower severity than a token,
because it authorises nothing on its own, and it is still an operator fact in a public repository.

Its provider endpoint is likewise a literal in that repository's source. Referenced here only as
`<MSG_API_BASE>`.

## 8. What this file does NOT establish

- **Nothing there was executed.** No test was run, no runner started, no model called, no network
  request made from that repository's code. Its test counts are **read from its files**, not observed
  passing.
- **No claim that its runner works.** The transport is described as built and tested because its tests
  exist and its documentation says so, not because this session ran them.
- **No dependency resolution was attempted.** The runtime package's real install cost on the host is
  unmeasured.
- **Nothing there was modified.** Modify and push remain owner-gated (steering §6, §2a).

## 9. One window, confirmed 2026-08-10 against its files

The owner ruled that every life-side agent presents through a **single** messaging window. That was
checked rather than assumed, and it is already the design:

| Checked | Measured |
|---|---|
| bot credentials the other repository knows | **exactly one** token environment entry in its whole system tree |
| reply addressing | its poller reads the incoming conversation id and answers on that same id, private conversation type |
| agent selection | its coordinator calls a router over the routing configuration, returning one target codename per message, defaulting to the capture agent |
| routable agents behind the one window | **10** intents to 10 codenames, plus **3** direct commands and **3** control commands |
| gate override inside the window | a crisis signal re-targets to the crisis protocol; the recovery gate downshifts the critic to the brainstormer |
| the governor | present and deliberately **not** routable, because it holds the gates and the ledger rather than taking a turn |

**So the single-window requirement costs no architectural change.** Wiring the model layer wires it
behind that one window, and the agent-identity seam in this repository stays optional.

## 10. A defect this confirmation found: one routable agent does not resolve

Of the 10 routable targets, **9 resolve fully and 1 does not.** The decision-log intent points at a
codename that is present in the codename mapping layer but is **absent from the runtime registry**, and
its persona file **does not exist** in the persona directory. A message classified as a decision log
therefore routes to an agent that cannot answer.

This is recorded as gap **A-G4** with task **A5** in spec `07-bot-bringup-v1`. It is small and it is real:
either author the persona and register it, or remove the intent. Leaving a routable target that cannot
answer is the one thing not to do, because the failure surfaces to the owner as silence in the one window
rather than as a refusal.

## 11. Authorisation status

**The owner GRANTED authorisation to modify the other repository on 2026-08-10.** Scope as granted: the
files needed to wire its model layer and take its relay live. Scope not stated and therefore still
closed: whether pushing is included, so work there commits locally and the owner pushes. Up to the point
this section was written, nothing in that repository had been created, changed, staged, committed or
pushed.
