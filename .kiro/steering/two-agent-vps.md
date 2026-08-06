# Two-Agent VPS tier (AUTHORITATIVE for the server/agent/bot area)

**Status:** DRAFT - requires owner sign-off before Kiro acts on it (see §0).
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
  G7 make both repos private (D0); G8 generate the age keypair and move the private key off the box.
- Any outbound network call from a **server** process.
- Any use of a **production** secret.

**Never, under any circumstance:** invent a secret value, commit a real secret, place a key on Drive, weaken
a gate to make it pass, or claim a gated item is done.

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

Kiro is open on `nizamfinancialapp` and **must not** clone, modify, or push `nizamcore`. Changes needed
there (the FastAPI wrapper, per-bot dedup namespacing, the signalbus target in `EGRESS_MATRIX`) are emitted
as a reviewable patch series plus a README under:

```
ops/nizamcore-patches/NNN-<slug>.patch
```

applied later in a separate Kiro session opened on `nizamcore`.

## 7. Gate discipline

- The gate stays `npm run verify:all -- --all`. It must print all checks passed before any commit.
- Tests ratchet **up only**: raise the `AC04 --min` floor in `scripts/verify/all.mjs` as tests grow.
- New `src/`+`tests/` files declare their owning contract and phase in the first 20 lines (**AC10**).
- `ops/` holds **templates with placeholders only**; `<ANGLE_BRACKET>` values never resolve to real data (**AC09**).
