# Two-Agent VPS tier (AUTHORITATIVE for the server/agent/bot area)

**Status:** IN FORCE (owner-authorized 2026-08-06). Override any line you disagree with; it is method, not policy about your data.
**Precedence:** for the **server / agent / bot / ingestion / deployment** area ONLY, this file wins over
`pfos-current.md`. Everywhere else `pfos-current.md` still wins. `money-rules.md` and `drive-db.md` are
never overridden by anything.
**Source design:** `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md` (repo-inspected, docs-verified 2026-08-06).

## 0. Why this file exists (three blockers it removes)

`pfos-current.md` currently makes this work impossible for an agent to execute:

1. **The wall forbids the whole area.** "The wall - do NOT build: no live LLM call, no network, no key
   use, and no server / hosting / bot / ingestion until the VPS is provisioned." Read literally, Kiro must
   refuse every task in this tier. §2 relocates the wall from *the area* to *the network boundary*.
2. **The benchmark deadlock.** The wall permits runtime work only after "a Phase-1 benchmark passes", but
   the Phase-1 benchmark itself requires live OpenRouter calls, which the wall forbids. Circular. §3
   resolves it with an explicit dev-key carve-out.
3. **An unsettled decision gates everything.** "Open decision to settle first: the server runtime -
   Node/TypeScript ... or Python/FastAPI." §1 settles it.

## 0b. SETTLED: both repos stay PUBLIC (owner decision, 2026-08-06)

The owner has authorized keeping `nizamcore` and `nizamfinancialapp` public. D0/G7 is **closed as
WONT-DO**; do not re-raise it. This is a normal posture for self-hosted finance software.

**The one rule it changes - treat it as an invariant:** the repository may contain the *design*, but
never a *deployment particular*. Nothing in a tracked file may reveal how to reach or impersonate the
running system. Specifically, these NEVER appear in a tracked file, not even as an example:

- real hostnames or domains (use `<domain>`, `life.<domain>`, `money.<domain>`)
- the secret webhook path segments (generated at deploy time; they live only in the VPS env)
- bot usernames, bot ids, or numeric Telegram user ids (use `<BOT_A_TOKEN>`, `<ALLOWED_USER_ID>`)
- Google Drive folder ids, file ids, or account addresses
- server IP addresses, SSH ports, or the age public key
- any real amount, balance, account identifier, payee, or journal excerpt in a fixture

Fixtures and eval cases use synthetic data only. The threat model becomes: an attacker knows the
architecture exactly, and still cannot reach the system because every particular is runtime-injected.
That is the same posture as any open-source self-hosted app, and it is sound.

Consequence for `ops/`: it is a set of **templates**. A reader can see the shape of the compose file and
the Caddyfile; they cannot learn a single value that would let them talk to the deployment.

## 1. SETTLED: server runtime per agent (do not re-open)

| Agent | Runtime | Why |
|---|---|---|
| **finance** (this repo) | **Node 24 + TypeScript** (Fastify or Hono; `node:sqlite` native) | Reuses the existing integer-money core and the Stage 1-4 engines **and their 333 tests** verbatim. |
| **life** (`nizamcore`) | **Python 3** (FastAPI + uvicorn) | `nizamcore`'s relay + governor are already Python with 55 passing tests. |

**INVARIANT: there will never be a second implementation of money.** PFOS contract 02 says
"Python + FastAPI"; taken literally for the finance agent it would force a second integer-milliunit
implementation that must stay bit-identical to `src/lib/money/` forever. That is rejected. Contract 02's
intent (a small typed server over SQLite) is honoured; its language choice is overridden **for the finance
agent only**, and the override is recorded here as the reason.

Consequence: the two agents are **polyglot by design**. They share no code. They share only the
`nizam-signalbus` JSON schema, the host, and the OpenRouter account (via two separate keys).

## 2. The wall, relocated: BUILD vs GATE

The wall is no longer "do not build the area". It is now a **network + secret boundary**.

**BUILD NOW (no secret, no network, no VPS - proceed without asking):**
- Every module behind an **injected port with a deterministic mock**: Telegram transport, OpenRouter
  client, Drive backup uploader, WHOOP connector, signal bus client.
- The SQLite schema, migrations, and repositories (`node:sqlite`, WAL, `foreign_keys=ON`).
- The turn classifier, router/scorer, spend ledger, telemetry store - all pure functions over injected state.
- The consent gate + signal envelope validation + de-identification, with negative tests.
- `ops/` artifacts as **text**: `docker-compose.yml`, `Caddyfile`, `.env.example` templates, systemd units,
  backup/restore scripts. Writing them is allowed. **Running them is not.**
- Contracts and specs (see §5).

**GATED - STOP and record, never attempt (these need a human):**
- G1 Provision/harden the VPS; G2 DNS records; G3 create the two bots in BotFather; G4 mint the two
  runtime OpenRouter keys + weekly caps; G5 the Google OAuth consent click; G6 `setWebhook` registration;
  G8 generate the age keypair and move the private key off the box.
  (**G7 repo-privatization is CLOSED as WONT-DO** per §0b - do not re-raise it.)
- Any outbound network call from a **server** process.
- Any **mutating** use of a **production** secret. (Read-only use is carved out below; that carve-out is
  the whole of the exception and nothing else in this column moves.)

**Never, under any circumstance:** invent a secret value, commit a real secret, place a key on Drive, weaken
a gate to make it pass, or claim a gated item is done.

### 2a. The read-only carve-out (owner decision, STANDING as of 2026-08-10) - this resolves F11

**Authority:** `.kiro/specs/06-two-agent-vps/KIRO_SHIP_LIVE.prompt.md` §0 item 3, dated 2026-08-10, which
carries owner authority and makes standing the waiver already exercised for the two read-only bot probes.
**Reconciles with:** `.kiro/steering/cloudflare-dns.md` item 5 ("reads are free, writes are gated"), which
said the same thing for one provider while this file's GATED column said the opposite for all of them.
`OPERATOR_STATE_2026-08-09.md` §6 records that as **F11** - steering contradicting steering with no
precedence line to resolve it. This sub-section is the resolution: **one rule, not two.** Do not re-raise it.

**Reads are free.** A **read-only** operation against a live provider, using a credential that **already
exists**, is permitted at the owner's direction, and that direction is now standing for the Phase 10 task.
It is a read when it cannot change any state the provider holds. Examples, and the list is illustrative
rather than exhaustive: a status or health probe, `getMe`, `getWebhookInfo`, a zone or record **listing**, a
DNS **resolution**, `git clone` or `git fetch` of a repository. Confirm a credential by making a scoped call,
never by echoing it - the value still never reaches a message, a log, a commit or a report.

**Mutations are owner-in-the-loop.** Any operation that **spends money**, **publishes a public record**, or
**grants a third party access** comes to the owner first. So does any operation that **creates, rotates or
destroys a credential**, and any **write to a repository this session does not own**. Concretely and without
inference: `setWebhook`, creating or editing a DNS record, publishing a host port, minting or revoking a key
or token (see `cloudflare-dns.md` item 3 for the standing **D-ROTATE** deferral), a model call charged to a
**production** key, an upload, and a push. Presenting a mutation as a diagnostic does not make it a read.

**What this carve-out does NOT touch.** The fail-closed rules are unchanged and are restated here so no
reader mistakes a narrower gate for a looser posture: **never invent a secret value** (not even a plausible
placeholder of the right shape); **never commit a real secret**; **never place a key in the backup storage**;
**never weaken a gate to make it pass**; **never claim a gated item is done** - a gate is done when observed
and the observation is recorded. G1-G8 keep their numbers, their steps and their states; **G7 stays CLOSED as
WONT-DO** per §0b. A read does not advance a gate. It produces evidence about one.

## 3. Benchmark deadlock: the dev-key carve-out

`.secrets/openrouter.dev.key` already exists (gitignored, dev tier, ~USD 1/week cap per
`docs/PFOS_SECRETS_PLAN.md` §4). Therefore:

- The **Phase-1 benchmark (M2)** MAY make live OpenRouter calls **from the developer machine only**, using
  the **dev** key, on the **sanitized** eval set, never against real financial or journal data.
- Those calls are the **single** permitted network exception, and only for producing
  `model_eligibility_registry.json`.
- The **production runtime** path stays walled until G1 + G4 are done.
- If the dev key is absent or exhausted, the harness must run against **recorded fixtures** and mark the
  registry `provisional: true`. A provisional registry may **never** promote a model for live routing.

## 4. Two-agent invariants (new, enforced by tests)

1. **Separate stores.** `life.db`, `finance.db`, `signals.db`. No process opens another agent's DB. No
   cross-DB `ATTACH`. Ever.
2. **The bus is the only channel.** Cross-agent data flows exclusively through the signal bus, which is
   append-only, internal-network-only, and never exposed through Caddy.
3. **The state crosses, the data never does.** A signal payload may carry a direction or a level
   (`green|amber|red`, `downshift`). It may **not** carry a balance, a due date, an account identifier,
   journal text, or any free text over 120 characters. Enforced by schema: **the field does not exist**, so
   leakage is not possible by construction.
4. **`strict_local_maximum` never reaches the VPS.** `nizamcore` classifies `AHEL__family_network/**` with
   an empty egress set. Family data is excluded from the deployment entirely.
5. **The LLM tier never sources a monetary number.** Unchanged from `pfos-current.md`, restated because it
   now spans two agents.
6. **Both agents honour `NIZAM_KILL_ALL=1`** and their own weekly spend cap.

## 5. Author the contract before building its area

`pfos-current.md` requires a contract to exist before its area is built. Two are missing here. Kiro authors
both, clearly marked NIZAM-derived, BEFORE writing code in their area:

- **Contract 06 - Database & Knowledge Model** (SQLite schema, migrations, retention, the token-spend ledger).
- **Contract 12 - Two-Agent VPS Deployment & Operations** (topology, isolation, consent bus, backup/restore,
  health, rollback, DR).

Then update `contracts/pfos/_PFOS_CONTRACT_INDEX.md` and the build log, because **AC12** asserts the index
and the log agree.

## 6. Cross-repo rule (Kiro edits ONE repo)

Kiro is open on `nizamfinancialapp` and **must not** modify or push `nizamcore`. Changes needed
there (the FastAPI wrapper, per-bot dedup namespacing, the signalbus target in `EGRESS_MATRIX`) are emitted
as a reviewable patch series plus a README under:

```
ops/nizamcore-patches/NNN-<slug>.patch
```

applied later in a separate Kiro session opened on `nizamcore`.

**Where §2a lands on this rule, written down rather than left to be inferred.** A `git clone` or `git fetch`
of the other repository is a **read**; a modify or a push is a **mutation**. So:

- **Permitted:** a read-only `clone` or `fetch` of `nizamcore`, into a location **outside this repository's
  tracked tree**, so nothing it brings can be committed here by accident.
- **Still forbidden without the owner's explicit authorisation:** modifying it, committing in it, or pushing
  it. The three change specifications in `ops/nizamcore-patches/` stay **emitted and unapplied** until that
  authorisation exists - it is the §7 blocker of the owner mandate, and the recommended path is that phase 1
  ships the finance agent on bot B only while the life agent follows.
- The permission to read is not a licence to exercise it for no reason. Read it when a task needs to see it.

### 6a. The cross-repo WRITE authorisation (owner decision, STANDING as of 2026-08-11) - this resolves the §7 blocker of the owner mandate

**Authority:** `.kiro/specs/06-two-agent-vps/OWNER_AUTHORITY_VPS_LIVE.prompt.md` §0 item 6 and §12, dated
2026-08-11, which carries owner authority and supplies in writing the "explicit authorisation" that §6 above
names as the missing precondition. **Reconciles with:** §6's second bullet, which held the three change
specifications in `ops/nizamcore-patches/` as emitted and unapplied pending exactly this authorisation, and
which named that blocker as the reason phase 1 was recommended on bot B alone. This sub-section is the
resolution: **one rule, not two.** Do not re-raise it.

**Writing in `nizamcore` is permitted, scoped.** A session opened on this repository may modify, commit and
push in the other repository for four purposes and no others:

1. **Wiring its model layer.** Its coordinator runs the whole pipeline for real and then calls a stub that
   returns a canned string (`ops/NIZAMCORE_VERIFIED_STATE.md` §4 item 2). Replacing that stub with a real
   client, and integrating the agent runtime its registry declares but no module imports (§4 item 1), is the
   work this authorisation exists for.
2. **Its environment file.** The template stays here as `ops/env/life.env.example` by §1's boundary rule and
   the filled file lives on the host, root-owned and mode-restricted. Entries may be added to the template
   when the model layer needs them, and a rename there surfaces as a finding rather than as silent drift.
3. **Releasing its relay from standby.** Its standby mode gate is the same class of gate as G4 on this side
   (`ops/NIZAMCORE_VERIFIED_STATE.md` §5). A reviewable patch series cannot release a runtime gate, which is
   why the emitted-and-unapplied posture would have left that agent dormant indefinitely rather than later.
4. **Idempotency and concurrency safety in its deterministic ledger writer** (owner decision, 2026-09-02).
   `NIZAM__system/governor/ledger_writer.py` mints a fresh `uuid4()` for `row_id` on every call and defaults
   `trace_id` the same way, so it has no idempotency of any kind: an interrupted logical append that is
   retried produces a SECOND row with identical content and a cryptographically valid chain. Neither
   `verify_tail` nor `verify_chain` can detect that, because a duplicate row IS a valid chain, and because
   the ledger is append-only the duplicate cannot be removed without breaking the chain. Separately,
   `append` reads the tail and then writes with no lock, so two concurrent callers derive the same
   `prev_hash` and silently fork the chain mid-file, which `verify_tail` cannot see because it rehashes only
   the last row in isolation. Both are correctness defects in the one module that every ledger write passes
   through, and neither can be fixed from this repository by a patch queue. This purpose authorizes: a
   required stable record identity supplied by the caller, a canonical payload hash, an existence check that
   returns the already-written row instead of appending a second one, and an advisory lock spanning
   read-tail-and-append.

**Why the posture changed, in one line.** Both agents stop on the same line and are released by the same
class of credential (`ops/NIZAMCORE_VERIFIED_STATE.md` §5). Holding one of them behind a patch queue does
not make the deployment safer, it makes it half a deployment.

**The three emitted patches are not blessed by this authorisation.** They were authored without reading
their target, and the verified-state file records which of them the target contradicts
(`ops/NIZAMCORE_VERIFIED_STATE.md` §6). Check each against the verified state before applying it, and do not
apply one the verified state contradicts. Authorisation to write is not agreement with what was written
before the target had been read.

**What stays out of scope, so the grant does not widen by inference.** This is not a licence to restructure
that repository. Its three per-turn gates (the recovery pre-gate, the privacy pre-write gate and the
continuity post-gate), that governor's zero cost ceiling and zero tool budget, its twelve-agent persona
registry and its router configuration all stay as authored. **Its deterministic governor's exclusivity as
the sole writer to every ledger also stays as authored, and purpose 4 above does not touch it:** making a
write idempotent and locked changes how the sole writer writes, never who may write. A second writer is
still forbidden. Purpose 4 also adds no new ledger, no new privacy class, and no ability to delete or
rewrite an existing row: an append-only ledger stays append-only, so a duplicate already committed is
superseded and never removed. Its own tests stay green and its test count does not go down: **143 test
functions, of which 29 are relay tests**, measured 2026-08-10. The read permission in §6 is unchanged and
still requires the clone to sit outside this repository's tracked tree.

**Precedence line for the spend clause, because §2a and the authorising prompt would otherwise disagree.**
§2a classes a model call charged to a production key as a mutation requiring the owner in the loop. The
authorising prompt requires exactly that call, twice, one per agent, as the done-when line of its G4 step.
Resolution: **a model call charged to a production key is authorised while it is inside that agent's own
declared weekly cap**, because the cap is itself the owner's spend decision, recorded per agent in
`LIFE_WEEKLY_CAP` and `FINANCE_WEEKLY_CAP` and enforced by a ledger that is never aggregated across agents
for a cap decision. Spending past a cap, raising a cap, and minting or revoking a key stay
owner-in-the-loop. One rule, not two.

**What this authorisation does NOT touch.** R24 in **both** repositories, both of which are public: no
secret and no deployment particular in a tracked file, in either tree. No secret value in a message, a log,
a commit or a report. **Never invent a secret value.** **Never weaken a gate to make it pass.** **Never
claim a gated item is done** - a gate is done when observed and the observation is recorded. G1-G8 keep
their numbers, their steps and their states, and **G7 stays CLOSED as WONT-DO** per §0b. §2a's reads-free
and mutations-gated boundary is unchanged for everything this sub-section does not name. And **D-ROTATE is
unchanged**: no session rotates any credential unilaterally, and the `getWebhookInfo` compensating control
stays mandatory on every run while a disclosed token is live (`cloudflare-dns.md` item 3).

## 7. Gate discipline

- The gate stays `npm run verify:all -- --all`. It must print all checks passed before any commit.
- Tests ratchet **up only**: raise the `AC04 --min` floor in `scripts/verify/all.mjs` as tests grow.
- New `src/`+`tests/` files declare their owning contract and phase in the first 20 lines (**AC10**).
- `ops/` holds **templates with placeholders only**; `<ANGLE_BRACKET>` values never resolve to real data (**AC09**).
- Because the repo is public (§0b), add a check that `ops/**` and all fixtures contain **no deployment
  particular**: no bare domain, no IP, no Drive id, no numeric Telegram id, no real monetary figure.
  Wire it into the harness so it fails closed.
