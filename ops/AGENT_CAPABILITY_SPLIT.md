# NIZAM capability split — the full scope, divided across the two bots by functionality

> **Status:** IN FORCE. Authored 2026-08-10 under spec `06-two-agent-vps` task 10.17, owning requirement
> **R32**, on the owner's clarification of the same date: the life/therapy agent is owed the same
> treatment as the finance agent, so that the **full NIZAM scope** exists with its features split across
> the two bots **by functionality**.
>
> **What this document is.** One table, every capability, which bot owns it, which contract governs it,
> and — for each — whether it needs a cross-agent signal and, if so, which band. It is the companion to
> `ops/INTEROP_CONTRACT.md`, which defines the channel; this defines who says what over it.
>
> **What this document is NOT.** It **authors the split; it does not implement the life side.** The life
> agent is Python and lives in the other repository, which steering §6 forbids this session from
> modifying — that is option **(a)** work, in a session opened there. Nothing here is a claim that a
> life-side capability exists today. Read the `State` column before acting on a row.
>
> **Phase 1 reality, stated once so no row has to repeat it.** Under the authorised option **(b)**, phase
> 1 ships the **finance agent** on its bot alone; the other bot stays created, hardened and idle. Every
> `life` row below is therefore `NOT BUILT` or `OTHER REPO` today, and every cross-agent signal is
> **latent**: the channel exists and is tested, and nothing crosses until the second agent runs.

## How to read the table

**Bot** is `finance` (this repository), `life` (the other repository), or `neither` — the third case
being the shared services that belong to the deployment rather than to an agent.

**Signal** is one of:

| Value | Meaning |
|---|---|
| `none` | the capability is local. Nothing about it needs to reach the other agent |
| a kind | it publishes that envelope kind, carrying the band in the `Band` column |
| a kind, read | it *consumes* that kind, and adjusts its own behaviour by the band |
| `REFUSED BY CONSTRUCTION` | the useful thing to send would be a **figure**, a **date**, an **identifier** or a **narrative**, and the envelope **has no field for one**. Not deferred. Refused |

**`REFUSED BY CONSTRUCTION` is not a limitation being apologised for.** It is the design working. Steering
§4.3: the state crosses, the data never does. A row in that state records what somebody would
reasonably have wanted to send, and why the schema makes it impossible rather than merely
discouraged — so that a later reader proposes a band instead of proposing a field.

**Band** is drawn from the payload's own vocabulary and nothing else: `level` is `green` \| `amber` \|
`red`, `direction` is `downshift` \| `hold` \| `upshift`, and an optional `note` under 120 characters
carrying **no digit**. Four kinds exist and the set is closed: `money_pressure`, `budget_breach`,
`recovery_state`, `readiness`.

**Every cross-agent signal is `producer_only` today.** The widening list is empty, so the bus refuses a
cross-agent read of any kind until the owner widens that kind in a recorded change. The `Signal` column
below says what a kind is *for*; it does not say that it is readable yet. That is the fail-closed
starting position, and `ops/INTEROP_CONTRACT.md` §5 is where it is stated as a rule.

## The split

| # | Capability | Bot | State | Governing contract | Where it lives | Signal | Band |
|---|---|---|---|---|---|---|---|
| 1 | Zero-based budget: categories, allocation, month roll | finance | BUILT | PFOS 01, 03; money rules | `src/features/budget/` | `none` | — |
| 2 | Category overspend detection | finance | BUILT | PFOS 03 | `src/features/budget/` | `budget_breach` (publish) | `level`, plus `direction` |
| 3 | Transaction register: entry, edit, split, flags | finance | BUILT | PFOS 01, 02 | `src/features/transactions/`, `src/server/db/repositories/` | `none` | — |
| 4 | One-time import of an existing ledger | finance | BUILT | PFOS 02 | `src/features/import/` | `none` | — |
| 5 | Reconciliation against a statement | finance | BUILT | PFOS 02 | `src/features/reconciliation/` | `none` | — |
| 6 | Accounts and their balances | finance | BUILT | PFOS 02; money rules | `src/features/accounts/`, `src/server/db/repositories/` | `REFUSED BY CONSTRUCTION` | a balance is a **figure**, and an account is an **identifier**. Two absent fields, not one |
| 7 | Obligations register: recurring commitments | finance | BUILT | PFOS 03 | `src/features/obligations/` | `none` | — |
| 8 | Obligation alerts, deterministic | finance | BUILT | PFOS 03; contract 12 §8 | `src/features/obligations/` | `REFUSED BY CONSTRUCTION` | the alert's value is *what is due, when*: a **figure** and a **date**. The pressure it creates crosses as row 15's band instead |
| 9 | Safe-to-spend | finance | BUILT | PFOS 03 | `src/features/safeToSpend/` | `REFUSED BY CONSTRUCTION` | the answer **is** a figure. There is no numeric field in the payload, so what crosses is the band, never the amount |
| 10 | Cash-flow forecast | finance | BUILT | PFOS 03 | `src/features/forecast/` | `REFUSED BY CONSTRUCTION` | a forecast is a series of figures against dates, and `ts` is the envelope's only temporal field |
| 11 | Net worth: assets, currency conversion, macro context | finance | BUILT | PFOS 03 | `src/features/netWorth/` | `REFUSED BY CONSTRUCTION` | a total is a **figure**; the holdings behind it are **identifiers** |
| 12 | Decision registry, append-only | finance | BUILT | PFOS 03 | `src/features/decisions/` | `REFUSED BY CONSTRUCTION` | a decision record names amounts, accounts and dates. It is the single richest thing in the tier and therefore the one most clearly excluded |
| 13 | Reports: spending, age of money, rescue view | finance | BUILT | PFOS 03, 04 | `src/features/reports/` | `none` | — |
| 14 | Owner-only web view of the above | finance | BUILT | PFOS 04; R33 | `src/server/process/` (`--serve-app`) | `none` | — |
| 15 | Money-pressure band | finance | BUILT | contract 12 §4; steering §4.3 | `src/server/signals/` | `money_pressure` (publish) | `level`, plus `direction` |
| 16 | Reads the life side's state and softens its own turns | finance | BUILT (consumer) | contract 12 §4.5 | `src/server/signals/` | `recovery_state`, `readiness` (read) | `level`, `direction` |
| 17 | Conversational turn classification and model routing | finance | BUILT | PFOS 09, 10, 11 | `src/server/routing/`, `src/features/routing/` | `none` | — |
| 18 | Its own weekly spend bound and refusal at the bound | finance | BUILT | PFOS 11; R17 | `src/features/routing/` | `REFUSED BY CONSTRUCTION` | a spend figure is a figure, and the other agent's bound is none of this agent's business (**R17**) |
| 19 | Its own bot transport, allowlist and de-duplication | finance | BUILT | contract 12 §5 | `src/server/telegram/` | `none` | — |
| 20 | Its own store, migrations and integer-money boundary | finance | BUILT | PFOS 06; money rules | `src/server/db/` | `none` | — |
| 21 | Halt in both forms | finance | BUILT | contract 12 §8; R29 | `src/server/process/` | `none` | — |
| 22 | Journaling: capture a written entry | life | OTHER REPO | **no NIZAM contract — gap, see below** | other repository | `REFUSED BY CONSTRUCTION` | journal text is a **narrative**. The only text field is a directional note under 120 characters with no digit, which is not a journal entry and must never be used as one |
| 23 | Journal retrieval and reflection over history | life | OTHER REPO | gap | other repository | `REFUSED BY CONSTRUCTION` | as row 22, and additionally it would need to point at a stored entry, which is an **identifier** |
| 24 | Recovery state from the wearable's own reading | life | OTHER REPO | gap | other repository | `recovery_state` (publish) | `level`, plus `direction` |
| 25 | Readiness for demand today | life | OTHER REPO | gap | other repository | `readiness` (publish) | `level`, plus `direction` |
| 26 | Therapy-style dialogue and reflective turns | life | OTHER REPO | gap | other repository | `none` | — |
| 27 | The wearable connector itself | life | OTHER REPO | gap | other repository, `life.env` | `REFUSED BY CONSTRUCTION` | a recovery percentage, a sleep duration and a heart-rate figure are all **figures**. Row 24's band is the whole of what crosses |
| 28 | Reads the money-pressure band and adjusts its own tone | life | NOT BUILT | contract 12 §4.5 | other repository | `money_pressure`, `budget_breach` (read) | `level`, `direction` |
| 29 | Its own bot transport, allowlist and de-duplication | life | OTHER REPO | contract 12 §5; change spec 002 | other repository | `none` | — |
| 30 | Its own store, its own model key, its own bound | life | OTHER REPO | R17 | other repository, `life.db`, `life.env` | `none` | — |
| 31 | Halt in both forms | life | OTHER REPO | contract 12 §8 | other repository | `none` | — |
| 32 | The most-restricted classification's own content | life | OTHER REPO | R10; steering §4.4 | other repository, `PRIVACY_CLASSIFICATION.json` | `REFUSED BY CONSTRUCTION` | its egress set is **empty**, and the `tier` enum has no member for it. Excluded from the deployment entirely, not filtered on the way out |
| 33 | The signal bus: append-only store, both consent gates | neither | BUILT | contract 12 §4; R7, R8, R34 | `src/server/process/`, `src/server/signals/` | it **is** the channel | — |
| 34 | The vendored envelope document both sides validate against | neither | BUILT | contract 12 §4.2 | `nizam-signalbus.envelope.schema.json` | it **is** the schema | — |
| 35 | The scheduler: periodic ticks to each agent | neither | BUILT | contract 12 §7; R34 | `src/server/process/` | `none` | — |
| 36 | Backup, encryption, off-host copy and the restore drill | neither | PARTIAL | contract 12 §6 | `ops/backup/`, `ops/restore/` | `none` | — |
| 37 | The proxy and its two host routes | neither | PHASE 2 | contract 12 §2 | `ops/docker-compose.yml`, the proxy configuration | `none` | — |

## What the table says when you stand back from it

**Twelve of thirty-seven rows are `REFUSED BY CONSTRUCTION`, and every one of them is a figure, a date,
an identifier or a narrative.** That is not a coincidence and it is not a gap: it is the same four rules
appearing thirty-seven times and firing twelve of them. Steering §4.3's claim — that leakage is
impossible *by construction* rather than *by filtering* — is only worth making if it survives being
applied capability by capability, and this is what applying it looks like.

**Only four things cross, and each is a band.** `money_pressure` and `budget_breach` go one way;
`recovery_state` and `readiness` go the other. Everything else in NIZAM's full scope is local to the
agent that owns it. Two agents, thirty-seven capabilities, **four** kinds of message between them: that
ratio is the design, and a proposal to raise it should have to argue against this table.

**The rich capabilities are the refused ones, and that is the expected shape.** Safe-to-spend, the
forecast, net worth and the decision registry are the most valuable things the finance agent computes,
and they are exactly the four that cannot cross. The life agent does not need them. It needs to know
whether money is a source of pressure today, which is one of three levels.

## The gap this document records rather than hides

**There is no NIZAM contract governing the life side.** Rows 22 to 27 name their governing contract as
*gap*, and that is honest rather than tidy: PFOS contracts 01 to 04, 06 and 09 to 11 are the finance
product; contract 12 governs the **deployment** of both agents and the boundary between them; and the
life agent's own behaviour — what journaling is for, what a therapy turn may and may not do, what
retention applies to a journal — is governed by the other repository's own documents and by nothing
here.

The PFOS current-state steering file states the rule that applies: **author the relevant contract before
building its area, and never invent policy a contract would govern.** So this document does not decide
what a therapy turn may say, and rows 22 to 27 carry only what the boundary needs: who owns the
capability, and what may cross. Whoever builds the life side authors that contract first. Recording the
absence is the most this side can honestly do, and it is more than leaving the rows out would have been.

## Where each side goes next

| Side | Next |
|---|---|
| finance | phase 1 ships it on its own bot. The blockers are recorded in the spec's own progress record, not here |
| life | option **(a)**: a session opened on the other repository applies the three change specifications under `ops/nizamcore-patches/`, authors the missing life contract, and builds rows 22 to 28. Owner-gated |
| both | nothing in `ops/INTEROP_CONTRACT.md` changes when the second agent arrives. That is the point of having written it first |
