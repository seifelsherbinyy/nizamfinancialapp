# PFOS Two-Agent VPS Deployment and Operations Contract

> **PROVENANCE: NIZAM-DERIVED. THIS CONTRACT WAS NEVER AUTHORED UPSTREAM.**
> Contracts 01-04 and 09-11 were ingested byte-for-byte from the owner's source material.
> Contract 12 was **verified absent** from every source sweep — there is no upstream contract 12, and
> there is no upstream document that governs a two-agent deployment at all. It is therefore **derived
> inside this repository** from four inputs and nothing else:
> 1. `.kiro/steering/two-agent-vps.md` — **AUTHORITATIVE** for the server / agent / bot / ingestion /
>    deployment area (§0b public posture, §1 runtimes, §2 the BUILD/GATE split, §4 the two-agent
>    invariants, §5 the author-before-build rule, §6 the one-repo rule, §7 gate discipline);
> 2. `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md` §1.2-§1.10, §2.x, §3.x, §4.x, §6, §7;
> 3. `contracts/pfos/02_PFOS_Data_Architecture_Integrations_and_Security.md` §5 (deduplication),
>    §8 (agent and model architecture), §9 (security architecture), §10 (reliability);
> 4. `contracts/pfos/06_PFOS_Database_and_Knowledge_Model.md`, which explicitly hands this contract
>    the `signals.db` envelope, consent scopes, network binding, and all backup / restore / disaster
>    recovery mechanics (contract 06 §1 "Out of scope").
>
> It invents no policy that an upstream contract governs. Where it must choose, the choice is recorded
> with its reason and can be overridden by the owner.

**Status:** IN FORCE for the two-agent deployment, the cross-agent consent bus, the transport layer, and
operations.
**Owning requirements:** `.kiro/specs/06-two-agent-vps/requirements.md` **R6-R24** (R6 jointly with
contract 06; R16-R19 extend contracts 09/10/11 rather than replacing them).
**Precedence:** subordinate to `.kiro/steering/two-agent-vps.md` in every line; subordinate to
`money-rules.md` and `drive-db.md`, which nothing overrides. It overrides nothing in either. Where it
touches the finance data tier it is subordinate to contract 06.

**Public-repository posture (steering §0b, R24).** This repository is public by owner decision. This
contract may describe the *design* of the deployment; it may never contain a *deployment particular*.
No real domain, address, storage identifier, numeric messaging user id, bot name, port assignment, or
real monetary figure appears below, not even as an example. Every such value is written as
`<ANGLE_BRACKET>` and is resolved only from the host environment at run time.

---

## 1. Document purpose

Define how two logically isolated agents run on one host: the topology, what isolates them, the single
channel between them and what may cross it, how untrusted transport is authenticated and de-duplicated,
how model spend and model eligibility are governed at deployment level, how the system is backed up and
restored, how it reports health, and which operations are reserved for a human and must never be
attempted by an automated agent.

This contract must exist **before** code is written in its area (steering §5). It is the authority that
`src/server/{telegram,signals,routing}/**` and the `ops/**` templates implement, and that the Phase 3,
4, 5, 7, 8, and 9 tests in `.kiro/specs/06-two-agent-vps/tasks.md` verify.

### 1.1 In scope

- Physical and logical topology of the two agents on one host, including the reverse proxy posture and
  the internal-only network the bus lives on (**R9**).
- The isolation surface: process, store file, volume, bot token, model key — one of each per agent
  (**R6**).
- The consent bus: the signal envelope, its tiers, its consent scopes, and the de-identification rule
  that makes leakage impossible by construction (**R7, R8**).
- The exclusion of `strict_local_maximum` content from this tier in its entirety (**R10**).
- Transport security: secret-token comparison, allowlist, de-duplication and its per-bot namespacing,
  and the accept-fast / process-async obligation (**R11-R15**).
- Deployment-level model routing governance: the no-model tier, per-agent cap isolation, the
  eligibility registry gate, and provider privacy and log redaction (**R16-R19**).
- Operations: backup, restore, health, restart, structured logging, log rotation, rollback, disaster
  recovery, and the documented degraded mode (**R20-R22**).
- The kill switch, in both its per-call and coarse forms.
- The human gate register (**R23**).
- The no-deployment-particular invariant and its fail-closed harness check (**R24**).

### 1.2 Out of scope — handed to or held by another document

This contract deliberately does not re-govern what another document already governs. Restating a rule
in a second place creates two authorities that can drift, which is worse than one authority that is
merely incomplete.

| Area | Authority | This contract's only claim |
|---|---|---|
| `finance.db` schema, pragmas, connection factory, migrations | **Contract 06** §2.2, §3, §5 | That the store is opened by exactly one process, on a local volume |
| The integer-milliunit persistence boundary and the one-money-implementation invariant | **Contract 06** §4 | That no deployment concern may weaken it |
| The `spend_ledger` table shape and the `weeklySpend` pure function | **Contract 06** §6 | That deployment supplies two independent caps that read it (§6.2) |
| Retention windows and pruning mechanics for every table | **Contract 06** §8 | That the dedup window is never pruned shorter than the transport's redelivery window |
| The knowledge index and what it may not hold | **Contract 06** §7 | Nothing |
| `life.db` internals | The other repository (steering §6) | That the finance process never opens it |
| Telegram interface copy, command surface, and inbox-candidate UX | Contracts 02 §3, 04 | Nothing |
| Model roster, tier definitions, benchmark gates, promotion and demotion policy | Contracts 09, 10, 11 | The four deployment-level guards in §6 |
| The browser tier's Drive-JSON store and its offline mirror | `drive-db.md`, build contracts 1-5 (DONE) | That the server tier does not disturb it |

Contract 06 states that backup, encryption, restore, and disaster recovery mechanics belong here, and
that the `signals.db` envelope, consent scopes, and network binding belong here. §4 and §7 discharge
that hand-off. Contract 06 also states what a backup must be *able* to assert about consistency
(its §8.3); §7.1 consumes that requirement rather than restating the store rules behind it.

---

## 2. Topology (R9)

### 2.1 Shape

One host. Two agents. One public entry point. One internal channel.

```
                       the public network reaches exactly one port
                                        |
                                        v
                      +---------------------------------+
                      |  reverse proxy, terminates TLS  |
                      |  life.<DOMAIN>   -> life agent   |
                      |  money.<DOMAIN>  -> finance agent|
                      +---------+-------------+----------+
        /tg/<LIFE_WEBHOOK_PATH> |             | /tg/<MONEY_WEBHOOK_PATH>
                                v             v
             +----------------------+   +----------------------+
             | life agent           |   | finance agent        |
             | other repository     |   | this repository      |
             | Python + FastAPI     |   | Node + TypeScript    |
             | store: life.db       |   | store: finance.db    |
             | token: <BOT_A_TOKEN> |   | token: <BOT_B_TOKEN> |
             | key:   <OR_KEY_LIFE> |   | key: <OR_KEY_FINANCE>|
             +----------+-----------+   +-----------+----------+
                        |   consent-gated, one channel only   |
                        +------------------+------------------+
                                           v
                        +------------------------------------+
                        | signal bus, append-only            |
                        | store: signals.db                  |
                        | bound to the internal network ONLY |
                        +------------------------------------+
              scheduler        |        backup        |     (optional router)
              internal only    |   egress for backup  |     internal only
```

### 2.2 Invariants

1. **One public port.** The transport provider reaches the reverse proxy on the single TLS port it
   permits for webhooks. The provider documents a closed set of acceptable webhook ports; the
   deployment uses the standard TLS one and no other. No agent process binds a public port itself.
2. **TLS is terminated by the proxy, automatically provisioned.** No certificate material is generated,
   stored, or renewed by application code, and no certificate or key is ever tracked.
3. **Two hostnames, one per agent** (`life.<DOMAIN>`, `money.<DOMAIN>`). Routing to an agent is by
   hostname *and* by a high-entropy secret path segment, never by hostname alone.
4. **The secret path segment is not the bot token.** It is independently generated per bot. Using the
   token as the path would place the token in proxy access logs, which is why it is forbidden here.
5. **The bus is never published (R9).** The signal bus service is attached to an internal network with
   no route to the proxy and no route out. It listens on the loopback interface of that internal
   network only. There is no proxy rule that reaches it, and adding one is a contract violation.
6. **Reaching the bus from outside the internal network is refused, not merely unauthorized.** The
   correct failure is connection refusal at the network layer. An authentication check on a reachable
   port is a weaker guarantee and does not satisfy R9 on its own.
7. **The optional shared router, if ever adopted, is internal-only too.** Adopting it co-locates both
   model keys in one process, which is why §6.2 keeps the library-first shape as the default and treats
   the shared service as a later, deliberate trade.
8. **Resource ceilings are declared per service.** Every service declares a CPU and memory limit and a
   reservation, so one agent's burst cannot starve the other. Limits may oversubscribe the host;
   reservations may not.
9. **Log rotation is mandatory.** Container logs are size-capped and file-capped so no log stream can
   fill the volume that holds a store.

### 2.3 Degraded mode is documented, not improvised

If the hostname, the certificate, or the public endpoint is unavailable, the documented fallback is the
provider's long-poll mode, which requires no public endpoint. It is a **mode**, selected by
configuration, with the same authentication and de-duplication guarantees as the webhook path. It is
not a second code path with weaker checks. Failing over must never disable a guard in §5.

---

## 3. Isolation (R6)

### 3.1 Six things are separate; three are shared

| Dimension | Life agent | Finance agent | Shared? |
|---|---|---|---|
| Process | own container | own container | **no** |
| Store file | `life.db` | `finance.db` | **no** |
| Volume | own volume | own volume | **no** |
| Bot token | `<BOT_A_TOKEN>` | `<BOT_B_TOKEN>` | **no** |
| Model key | `<OR_KEY_LIFE>` | `<OR_KEY_FINANCE>` | **no** |
| Environment file | `<LIFE_ENV_PATH>` | `<FINANCE_ENV_PATH>` | **no** |
| Host | — | — | yes |
| Model provider **account** | — | — | yes, via two distinct keys |
| Signal envelope schema | — | — | yes, schema only, no code |

The two agents share **no code**. They are polyglot by design (steering §1): each runs the language its
already-tested core is written in. A shared library would create a third release train and a coupling
the consent boundary exists to prevent.

### 3.2 Invariants

1. **No cross-agent store open (R6).** Neither agent's volume is mounted into the other's container.
   Even if a path were guessable it would not resolve. The application-level guard — a store path
   outside the configured data directory is a typed error — is contract 06 §2.1; this contract supplies
   the second, mechanical belt: the file is not present in the namespace at all.
2. **The only cross-store mounts are read-only and non-application.** The backup and scheduler
   utilities may hold a read-only mount of a store they do not own. Live agent logic never does. A
   read-write cross-mount is forbidden without exception.
3. **`ATTACH DATABASE` is forbidden everywhere** (contract 06 §2.1.3). Deployment cannot create a
   cross-store join that the code refuses to express.
4. **One writer per store.** Concurrency inside a process is a transaction problem, not a second
   process.
5. **No store on a network or synchronizing filesystem.** Local volumes only. A write-ahead-logged
   store on a synchronized path can be corrupted; this is the engine's own documented warning.
6. **Killing one agent must not affect the other.** Restart policy, health check, and resource limits
   are per service. A crash loop in one agent is contained by its own limits.
7. **Environment files are root-owned and mode-restricted**, one per service, outside the repository.
   No service reads another service's environment file.

---

## 4. The consent bus (R7, R8, R10)

This is the only legitimate channel between the two agents, and it is the place where the entire
privacy argument for splitting the system into two agents is either honoured or lost.

The purpose is narrow and worth stating plainly: the finance agent should be able to *soften* when the
life agent reports a recovery downshift, and the life agent should be able to know that money pressure
exists **without ever seeing a number**. The bus carries the *state*. It never carries the *data*.

### 4.1 The store

- `signals.db`, owned by the bus service, on its own volume, with an append-only audit mirror.
- Append-only: no update, no delete, no correction in place. A correction is a new signal.
- Bound to the internal network only (§2.2.5). Not reachable from the public network (**R9**).
- Engine invariants (write-ahead logging, enforced foreign keys, no `ATTACH`, local filesystem) are
  contract 06 §2.2's, applied to this third store. This contract does not restate them.

### 4.2 The envelope

Every signal validates against the vendored `nizam-signalbus` envelope schema before it is stored, and
again before it is served to a subscriber. Validation on write alone is insufficient: a schema change
must not silently make historical rows readable in a shape the current consent rules forbid.

| Field | Type | Rule |
|---|---|---|
| `signal_id` | identifier | Unique. Generated by the producer. |
| `ts` | timestamp, UTC | Producer's completion time. |
| `producer` | enum `life` \| `finance` | Enumerated. No free text. |
| `kind` | enum, closed set | e.g. money pressure, recovery state, readiness, budget breach. Extending the set is a schema change with its own review, not a runtime string. |
| `tier` | enum `money_safe` \| `life_safe` | Two narrow tiers only. `strict_local_maximum` is **not a member of this enum** (§4.4). |
| `consent_scope` | enum `shared` \| `producer_only` | The subscriber **must** honour it (§4.5). |
| `payload.level` | enum `green` \| `amber` \| `red` | A level. Not a magnitude. |
| `payload.direction` | enum, closed set, optional | e.g. a downshift. A direction. Not a delta. |
| `payload.note` | string, `<= 120` characters, optional | Directional only. Length is capped by the schema. |
| `hash` | digest | Over timestamp, producer, kind, and payload. Integrity, not authentication. |

### 4.3 Consent by absence — the central mechanism (R7)

**The payload has no field capable of carrying a balance, a due date, an account identifier, or a
narrative.** Not "such a value is filtered". Not "such a value is redacted". **The field does not
exist.**

This matters because the two designs fail differently:

- A runtime filter is code that can be bypassed, mis-ordered, disabled under load, or forgotten on a
  new call site. Its failure mode is silent leakage that looks like success.
- A schema with no such field cannot carry the value at all. Its failure mode is a validation error at
  the producer, loudly, before anything is stored.

Concretely, and as a binding rule:

1. `payload` accepts **no numeric field of any kind**. A level is an enum, not a number.
2. `payload` accepts **no date or timestamp field** other than the envelope's own `ts`. A due date
   cannot be expressed.
3. `payload` accepts **no identifier field**. No account reference, no transaction reference, no
   document reference, no storage identifier.
4. `payload.note` is capped at 120 characters **by the schema**, and is documented as directional. A
   longer note is rejected, not truncated. Truncation would silently ship the first 120 characters of
   something that was never allowed to leave.
5. `additionalProperties` is **false** at every level of the payload. An unrecognized field is a
   rejection, not an ignored extra. Without this, the previous four rules are decorative: a producer
   could simply add `balance` and have it pass.
6. A signal that fails validation is **refused and audited**. It is not stored in a quarantine table
   for later inspection, because that table would be exactly the leak the schema prevents.

The finance agent publishes a pressure level. It never publishes what the pressure is made of. The life
agent publishes a recovery state. It never publishes a journal excerpt. This is the mechanical form of
steering §4.3: *the state crosses, the data never does.*

### 4.4 `strict_local_maximum` is excluded from this tier entirely (R10)

Content classified `strict_local_maximum` has an **empty egress set** in the other repository's
classification policy. Nothing leaves the machine on which it originates.

For this deployment the consequence is stronger than "the bus rejects it":

1. **It is not a member of the `tier` enum.** There is no value a producer could set to mark a signal
   as carrying it. A signal claiming that tier fails schema validation as an unknown enum member.
2. **It is not stored in any of the three stores.** No table, no column, no index, no pointer
   (contract 06 §3.4, §7.2).
3. **It is not referenced.** No artifact in this tier — source, template, fixture, eval case, log,
   backup manifest, or runbook — names, counts, summarizes, or points at such content.
4. **It is not transmitted.** No model request, no bus signal, no backup payload, no report.
5. **The correct posture is exclusion, not filtering.** The category is out of the deployment's scope
   entirely, which is why there is no code path that handles it and no test that exercises carrying it.
   The only test is that an attempt to introduce it is refused.

### 4.5 Consent scope (R8)

- `shared` — a subscriber on the other side may read the signal, subject to its tier.
- `producer_only` — the signal exists for the producer's own later use. **A subscriber request for it
  is refused.**

Rules:

1. The refusal happens at the **bus**, not at the subscriber. A subscriber that decides for itself
   whether to honour a scope is not a consent boundary; it is a convention.
2. The refusal is a refusal, not an empty result that is indistinguishable from "no such signal". The
   subscriber learns the request was denied, not that nothing exists.
3. `producer_only` is the **default** for any new `kind` until the owner explicitly widens it. A new
   signal type is not shared because someone forgot to restrict it.
4. Scope is evaluated on **read**, every read, from the stored envelope. It is not cached, and it is
   not evaluated once at write time and trusted afterwards.
5. Tier and scope are **independent gates**, both of which must pass. A `money_safe` signal marked
   `producer_only` is still refused to a subscriber.

### 4.6 Four layers, so no single failure crosses the boundary

The consent boundary is enforced at four independent layers, from architecture §3.1. Each is listed
with the failure it survives.

| Layer | Mechanism | Survives |
|---|---|---|
| 1. Process and store isolation | separate container, file, volume, token, key (§3) | a code defect in one agent |
| 2. Network isolation | bus on an internal network with no public route (§2.2.5) | a misconfigured proxy rule that exposes an agent |
| 3. Classification egress gate | the other repository's egress matrix, plus the two narrow bus tiers | a producer that mis-tiers content |
| 4. Payload de-identification by absence | the envelope has no field for a figure or a narrative (§4.3) | every one of the above failing at once |

Layer 4 is the one that holds when the other three do not, which is why it is expressed as a missing
field rather than as a check.

---

## 5. Transport security (R11-R15)

The transport is untrusted input from the public network. Everything in this section is a guard on
input that an attacker fully controls except for the two secrets.

### 5.1 Reuse, do not reinvent

The other repository's relay already implements constant-time secret-token comparison, the operator
allowlist, and update de-duplication, with passing tests. The finance agent ports that **logic** to its
own runtime. It does not invent a new scheme, and it does not weaken one. Two deviations are deliberate
and are corrections, not preferences: per-bot dedup namespacing (§5.4) and accept-fast processing
(§5.5). Both are emitted as patches for the other repository under
`ops/nizamcore-patches/` (steering §6) rather than being applied across the repository boundary.

### 5.2 Two authenticity checks, both required (R11)

1. **The secret path segment.** A request to an unknown path is not routed to an agent at all. This is
   the provider's own documented first authenticity check.
2. **The secret-token header.** The provider echoes a configured secret on **every** request. The
   handler compares it to the configured value.

Rules:

- A request with **no** token header is rejected. Absent is not empty; empty is not valid.
- A request with a **mismatched** token is rejected.
- The comparison is **constant-time** (**R11**). A short-circuiting equality comparison leaks the
  length and the matching prefix through timing, which over many requests recovers the secret. This is
  a functional requirement of the guard, not an optimization detail, and it has its own test.
- The rejection response carries **no detail** about which check failed and no timing signal that
  distinguishes them.
- The token is never logged, never included in an error, and never echoed back.
- A configuration in which the expected token is absent or empty **fails closed**: the handler refuses
  every request rather than accepting every request. An unconfigured guard must not be an open door.

### 5.3 Operator allowlist (R12)

- Only identifiers present in `<ALLOWED_USER_IDS>` may interact with either bot. Every other sender is
  rejected.
- The allowlist is injected configuration. It is never a literal in source, and no real identifier
  appears in any tracked file (**R24**).
- An **empty** allowlist means "nobody", not "everybody". Fail closed.
- The allowlist is checked **after** the token check and **before** any parsing of content, so a
  non-allowlisted sender never reaches a parser.
- Allowlist rejection is audited with the fact of rejection, never with the message content.

### 5.4 De-duplication, namespaced per bot (R13, R14)

The provider retries delivery. A retried update must produce **no second side effect** (**R13**).

**Namespacing is not a refinement; it is a correctness fix (R14).** Update identifiers are **per-bot
sequences**. Two bots on one host will therefore emit the same identifier for two entirely different
updates. A dedup store keyed on the identifier alone would treat the second bot's legitimate update as
a duplicate of the first bot's and silently discard it. The observable symptom is one bot going quiet
for no visible reason — a data-loss bug that looks like a network problem.

Rules:

1. The dedup key is the pair `(bot_id, update_id)`. Never the identifier alone.
2. It is enforced by a **UNIQUE index in the store**, and insertion is a conditional insert that
   ignores a conflict. The insert *is* the dedup decision.
3. This also removes a race that a read-then-write scheme has: two concurrent deliveries of the same
   update can both read "not seen" and both proceed. A unique index cannot be raced.
4. A duplicate is a **no-op with a success acknowledgement**, not an error. Returning an error would
   make the provider retry the duplicate again.
5. The dedup window is never pruned shorter than the provider's maximum redelivery window (contract 06
   §8.2). Pruning early re-opens the replay window this guard closes.
6. **The test that matters is the collision test:** two bots emitting the *same* identifier must both
   be processed. A test that only proves a duplicate is dropped would pass on the broken design.

### 5.5 Accept fast, process asynchronously (R15)

The provider treats a slow response as a failed delivery and retries. A handler that performs a model
call inline will therefore exceed the tolerance, be retried, and — on the second delivery — be
protected only by §5.4. That is a correct guard being used to paper over an incorrect design.

Rules:

1. The handler authenticates, checks the allowlist, de-duplicates, **enqueues**, and acknowledges.
   Nothing slow happens before the acknowledgement.
2. Work is durable: the queue is a table in the agent's own store (contract 06 §3.3), so a restart
   between acknowledgement and processing does not lose the update.
3. Processing is idempotent per queue item, because a worker can crash mid-item.
4. A downstream failure — model, network, provider — is a **queue** failure with its own retry and
   backoff. It never becomes a transport-level failure that triggers redelivery.
5. Concurrency is bounded, and the connection ceiling requested from the provider is set low, because a
   single-operator system needs very little. The provider's documented per-chat and broadcast rate
   limits are respected by the outbound path with backoff.

---

## 6. Model routing governance at deployment level (R16-R19)

Contracts 09, 10, and 11 own the roster, the tier definitions, the benchmark gates, and the promotion
and demotion policy. This section adds only the four guards that are **deployment** properties, because
they cannot be expressed inside a single agent's routing logic.

**The standing invariant, restated because it now spans two agents:** the model tier never computes or
sources a monetary number. The deterministic engines do. A model parses, interprets, challenges, and
communicates. It does not produce a balance, a due date, or a safe-to-spend figure, and it cannot move
money.

### 6.1 The no-model tier is provably free of model calls (R16)

- A turn classified `T0` invokes **no model**. Not a cheap model. Not a cached model. None.
- This is proved structurally: on the `T0` path the model port is **not called**, and the test asserts
  against a port mock that records invocations, then asserts the record is empty.
- A test that merely asserts the response looks deterministic is insufficient. It would pass if a model
  were called and its output discarded, which still spends money and still sends content to a provider.

### 6.2 Per-agent cap isolation, with deterministic alerts surviving exhaustion (R17)

Two belts, and neither substitutes for the other:

1. **In-app:** the weekly total from contract 06 §6.3, read per agent, compared against that agent's
   injected cap (`<AGENT_WEEKLY_CAP_USD>`).
2. **At the provider:** one key per agent, each with its own periodic spend limit. The account balance
   is the shared ceiling; the per-key limit is the private allocation.

Rules:

- **Exhaustion is scoped to one agent.** A runaway loop in one agent cannot spend the other's budget.
  This is only true because the ledger is keyed by agent and is never aggregated across agents for a
  cap decision, and because the keys are distinct.
- **Exhaustion refuses model calls. It never suppresses a deterministic alert (R17).** Obligation
  alerts, due-date warnings, and safe-to-spend figures are produced by the deterministic engines and do
  not depend on a model. A cap is a spend guard, not a service outage. Losing a due-date warning
  because a model budget ran out would be the single worst failure mode this system could have, and it
  is forbidden.
- A cap is **never** raised, bypassed, or temporarily lifted to make an operation succeed.
- The refusal is explicit and legible to the operator, not a silent degradation.

### 6.3 The eligibility registry is required, and a provisional one cannot route (R18)

- A model may be selected only if it is present in `model_eligibility_registry.json`. Absent means
  ineligible; there is no implicit default.
- **A registry marked `provisional: true` must not permit live routing.** A provisional registry is one
  produced without live measurement — from recorded fixtures, or with the development key absent or
  exhausted (steering §3). It is a scaffold, not evidence.
- The check is **fail-closed**: a missing registry, an unparseable registry, a registry without an
  explicit non-provisional marker, and a provisional registry all refuse routing. The absence of a
  "provisional" flag is not treated as "not provisional".
- A provisional registry that cannot be upgraded is recorded in the gate register (§9) as a blocked
  item, not worked around.

### 6.4 Provider privacy on every request, and no prompt text in any log (R19)

- **Every** model request carries the provider privacy policy: training excluded, providers that
  collect data denied, required parameters enforced, and zero-data-retention inference where the
  content class requires it. This is per request. An account-level default is a second belt, not a
  substitute — a per-request assertion is what a test can observe.
- **No prompt text and no completion text is written to any log, ever** (**R19**). Not at debug level.
  Not on error. Not in a crash dump. Not in a bus signal. Not in a backup manifest. Contract 06 §3.4
  forbids the columns; this forbids the log lines.
- What may be logged: redacted **features** — a tier, a model identity, token counts, latency, a schema
  validity verdict, an actual reported cost, a correlation reference. Never content.
- Logs are **structured**, so redaction is a property of the schema rather than of a formatting string
  that someone will eventually change.
- A model response is **untrusted data**. It cannot issue an instruction, and a deterministic policy
  gate runs before and after any model synthesis (contract 02 §9). Ingested documents and messages are
  untrusted for the same reason; the ingestion inbox is a quarantine that never writes the ledger
  directly.

---

## 7. Operations (R20-R22)

### 7.1 Backup (R20)

Three properties, all required, in this order.

1. **Transactionally consistent snapshot.** The snapshot is produced by the engine's own snapshot
   statement against the live store, not by copying files. A file copy of a write-ahead-logged store
   that is being written is not a database; it is a fragment that may restore, may fail, or may restore
   *wrongly*. Contract 06 §8.3 requires the store to remain capable of this operation, which is why the
   store is single-writer and write-ahead-logged.
2. **Public-key encryption whose private half is absent from the host.** The snapshot is encrypted to
   `<BACKUP_PUBLIC_KEY>`, using a public-key encryption tool (`age`, with `gpg` as the documented
   fallback). **The private key is never on the host** — it lives in the operator's off-host secure
   store (gate G8, §9). The host can therefore *create* a backup it cannot *read*. A host compromise
   yields ciphertext and nothing else. This is the "keys and the data they protect are kept apart"
   invariant.
3. **Shred the plaintext.** The intermediate snapshot is securely removed immediately after
   encryption, in the same operation, including on the failure path. A plaintext snapshot that outlives
   its encryption is the largest unencrypted concentration of financial data the system ever creates.

Further rules:

- The encrypted artifact is uploaded through a **narrow, per-file storage grant** owned by the operator.
  A service identity with no personal storage quota **cannot** own files in a personal storage account;
  uploads fail or orphan. This is a documented trap and the reason the grant model is a user grant, not
  a service identity.
- After upload, **size and digest are verified** against the local artifact. An upload that is not
  verified is not a backup.
- Retention is bounded, with a cold copy at a lower frequency to a second location.
- The backup service holds **read-only** mounts of the stores (§3.2.2) and is the only service besides
  the scheduler permitted a cross-store view.
- No key, no token, and no environment file is ever included in a backup payload. Backups contain data.
  Secrets are re-provisioned, not restored.

### 7.2 Restore (R21)

**A backup is not a backup until a restore has been exercised.** An untested backup is an assumption.

The drill, in order:

1. Retrieve the encrypted artifact.
2. Decrypt it **off the host**, with the private key that only exists off the host.
3. Run the engine's **integrity check** on the decrypted store. **This gate precedes trust (R21).**
4. Boot a throwaway agent instance against the restored copy and confirm it opens with the required
   pragmas in force and answers its health endpoint.
5. Only then is the artifact considered good.

Rules:

- An artifact that fails the integrity check is **discarded, and the failure is escalated**. It is not
  repaired, not partially imported, and not used "because it is better than nothing".
- The drill is scheduled and its outcome recorded. A drill that has not been run recently is treated as
  a failing control, not an unknown one.
- Restoring **never** overwrites a live store in place. Restore targets a fresh path; promotion is a
  separate, deliberate step.

### 7.3 Health and restart (R22)

- Every long-running service exposes a health endpoint that reports **actual** readiness: the store
  opens, the required pragmas are in force, the migration version is the expected one, and the queue
  worker is alive. It must not return success merely because the process is running.
- The orchestrator polls it with an interval, a timeout, a retry count, and a start-up grace period, and
  **restarts a service that reports unhealthy** (**R22**).
- Restart policy is per service, so a crash loop is contained.
- A restart is not a fix. Repeated restarts are surfaced, not absorbed silently.
- The health endpoint reveals **nothing sensitive**: no configuration values, no counts of financial
  records, no identifiers. A liveness signal, a version, and a coarse component status.

### 7.4 Rollback

- Rollback is by **re-deploying a previously known-good image tag**. Images are tagged immutably; the
  previous tag remains available.
- **A schema migration is not rolled back by reversing it.** Migrations are append-only and forward-only
  (contract 06 §5). If a deployment must be reverted across a migration, the store is restored from a
  snapshot taken before it, through §7.2, integrity check included.
- Deployment order for a change that includes a migration: snapshot, migrate, deploy. Never deploy code
  that assumes a migration that has not yet been applied.
- A rollback is recorded with what was reverted and why.

### 7.5 Disaster recovery

- **Blast radius.** One host is one failure domain. This is accepted, and mitigated by: bounded
  per-service resources, the internal-only bus, off-host backup keys, and a rebuild path that does not
  depend on the failed host.
- **Rebuild path.** Provision a fresh host (G1), restore the encrypted artifacts through §7.2,
  re-provision secrets into fresh environment files (secrets are re-issued, never restored), bring the
  services up from the templates, and re-register the webhooks (G6). Objective: a rebuild from
  templates plus a verified backup, without any tracked deployment particular.
- **Degraded operation** while the endpoint is unavailable: the long-poll mode of §2.3, with every guard
  in §5 intact.
- **What is unrecoverable is what was never backed up.** The recovery objective is therefore stated in
  terms of the backup cadence, and the cadence is a configuration value, not a hope.
- Recovery **must not** be the moment a guard is first tested. The drill (§7.2) exists so that the
  procedure is familiar before it is needed.

### 7.6 Where the ops artifacts live

Phase 7 of the spec owns these files. This contract governs their content and names their intended
paths only; it does not create them, and no automated agent executes them.

```
ops/docker-compose.yml         topology, internal network, per-service limits, health checks
ops/Caddyfile                  the two hostnames, the two secret webhook paths
ops/env/*.env.example          one per service, placeholders only
ops/backup/                    consistent snapshot, public-key encrypt, shred, verified upload
ops/restore/                   decrypt off-host, integrity check, throwaway boot
ops/systemd/                   unit and timer templates
ops/DEPLOYMENT_CONTROL.md      the human-gated items, with exact steps (§9)
ops/nizamcore-patches/         reviewable patch series for the other repository (steering §6)
```

`ops/**` is **templates with placeholders only** (steering §7). Writing them is permitted. **Running
them is not.** No `<ANGLE_BRACKET>` value in a tracked file ever resolves to real data.

---

## 8. The kill switch

Two forms, deliberately. Neither replaces the other.

1. **File sentinel, checked per call.** Before every outbound model call, every store write that
   originates from a model path, and every bus publish, the process checks for the presence of a
   sentinel path (`<KILL_SENTINEL_PATH>`). Present means stop.
2. **Coarse environment variable.** `NIZAM_KILL_ALL=1`, honoured by both agents, the scheduler, and the
   backup service.

Why both: an environment variable cannot be changed without restarting the process that reads it, so on
its own it is not a panic stop — it is a configuration change with a restart. A sentinel file that is
checked per call halts every writer the moment it appears, with no restart and no deployment. The
environment variable remains as the coarse, restart-scoped form, and as the documented way to bring the
system up already halted.

Rules:

- The check is **per call**, not cached, not read once at start-up.
- **Fail closed on ambiguity.** If the sentinel path cannot be examined, the answer is "halted".
- Halting is **loud**: the operator is told the system is halted and why, through a path that does not
  itself require a model.
- Halting **never** disables a deterministic obligation alert (§6.2). It stops model spend and outbound
  writes; it does not stop the deterministic engines from telling the owner a payment is due.
- Halting is **not** a graceful shutdown and **not** a data-destroying operation. Nothing is deleted.
- No code path removes the sentinel. Only the operator does.

---

## 9. The human gate register (R23)

Steering §2 relocates the wall from *the area* to *the network and secret boundary*. Everything behind
that boundary is buildable now. Everything on it requires a human.

**These items must appear in `ops/DEPLOYMENT_CONTROL.md` with their exact steps, must never be attempted by
an automated agent, and must never be reported as done.** Marking a gated item complete is the single
most damaging thing an agent could do here, because it converts a known gap into an invisible one.

| Gate | Requires a human to | Why it cannot be automated here |
|---|---|---|
| **G1** | Provision and harden the host: non-root user, default-deny firewall except the TLS port and the operator's administrative access, key-only administrative login with intrusion blocking, unattended security updates, container runtime, swap, root-owned configuration directory | Creates the trust root of the entire deployment. No code may create the host it will run on. |
| **G2** | Create the records for the two hostnames | Changes a public record outside the repository's control. |
| **G3** | Create the two bots and obtain `<BOT_A_TOKEN>` and `<BOT_B_TOKEN>` | Requires an interactive session with the provider and mints production secrets. |
| **G4** | Mint `<OR_KEY_LIFE>` and `<OR_KEY_FINANCE>` with their periodic spend limits, and set the account privacy posture | Mints production secrets and sets the spend ceiling that §6.2's second belt depends on. |
| **G5** | Complete the storage consent grant for the backup path and place `<DRIVE_REFRESH_TOKEN>` in the backup environment file | An interactive consent click. Cannot be simulated, and must not be. |
| **G6** | Register both webhooks with their secret paths and secret tokens, narrowed update types, a low connection ceiling, and pending updates dropped on first registration | Requires production tokens and makes the deployment publicly reachable. |
| **G8** | Generate the backup keypair, place the public half in the backup environment file, and **move the private half off the host** | The one step that makes §7.1's guarantee true. If an agent generated this key, the private half would exist on the host and the guarantee would be void. |

**G7 — repository privatization — is CLOSED as WONT-DO.** The owner authorized keeping both
repositories public on 2026-08-06 (steering §0b, architecture Appendix A / D0). It is **not** a gate,
**not** an open decision, and **not** to be raised again. It is recorded here solely so that a reader
who finds G1-G6 and G8 does not conclude that G7 was lost. What replaced it is the hard invariant in
§10: the repository may hold the design, never a deployment particular.

Gate discipline, binding:

1. **Never invent a secret value.** Not to unblock a test, not as an example, not as a placeholder that
   looks real.
2. **Never commit a real secret**, and never place a key in the data-backup storage.
3. **Never weaken a gate to make it pass.** A gate that can be satisfied by weakening it was not a gate.
4. **Never claim a gated item is done.** Record it as blocked, with the exact next human action.
5. A gated item that is blocking progress is reported to the owner as a single, specific request.

---

## 10. Public-repository posture (R24)

The repository is public. The threat model is therefore explicit: **an attacker knows the architecture
exactly, and still cannot reach the system, because every particular is injected at run time.** That is
the same posture as any open-source self-hosted application, and it is sound — but only while the
invariant holds without exception.

### 10.1 What may never appear in a tracked file

Not in source, not in a template, not in a fixture, not in an eval case, not in a comment, not in a
commit message, and **not as an example**:

- a real hostname or domain — write `<DOMAIN>`, `life.<DOMAIN>`, `money.<DOMAIN>`;
- an address of a host — no literal address of any form;
- a secret webhook path segment — generated at deploy time, resident only in the host environment;
- a bot name, a bot identifier, or a numeric messaging user identifier — write `<BOT_A_TOKEN>`,
  `<ALLOWED_USER_IDS>`;
- a storage folder identifier, file identifier, or account address — write `<DOCUMENT_REF>`,
  `<BACKUP_FOLDER_REF>`;
- an administrative access port or the backup public key;
- any real amount, balance, account identifier, payee, or ledger excerpt, including in a fixture;
- any organization-specific term (this is already a separate harness check).

Fixtures and eval cases use **synthetic** data only. Synthetic means constructed for the test, not
"anonymized real data" — anonymization is a judgement call and this invariant does not admit judgement
calls.

### 10.2 The check fails closed (R24)

Phase 9 of the spec adds a harness check that scans `ops/**` and every fixture for a deployment
particular: a bare domain, an address literal, a storage identifier, a numeric messaging identifier, or
a real monetary figure. Requirements for that check:

1. It **fails closed**: an unreadable file, an unparseable file, or an unrecognized new location under
   the scanned paths is a failure, not a skip.
2. It runs inside `npm run verify:all -- --all`, so it cannot be forgotten.
3. Its allowlist of exceptions is explicit, short, and reviewed. A growing exception list is a signal
   that the invariant is being eroded.
4. It has a **negative** test: a file containing a synthetic-but-particular-shaped value must make the
   check fail. A scanner that has only ever been observed passing is not evidence that it scans.

---

## 11. Acceptance tests (the definition of done for this area)

Each maps to an owning requirement. **Every guard has a negative case**, because a guard that has only
ever been observed passing is not evidence that it fires. The negative case must show the guarded
operation being *refused*, not merely a function returning a value.

| # | Test | Negative case (the guard must refuse) | Requirement |
|---|---|---|---|
| T1 | Stopping one agent leaves the other serving | With one agent stopped, the other must still answer, not degrade or error | **R6** |
| T2 | Neither agent's volume is mounted into the other's container | An attempted open of the other agent's store path fails: not present, not merely unauthorized | **R6** |
| T3 | No `ATTACH DATABASE` statement exists in the server source | A source scan finds an `ATTACH` and the check fails | R6 |
| T4 | Each agent resolves exactly one bot token and one model key | A configuration presenting a second agent's key is refused | **R6** |
| T5 | The bus is reachable only from the internal network | A connection from outside the internal network is **refused at the network layer**, not authenticated and denied | **R9** |
| T6 | No proxy rule routes to the bus | A template that adds such a route fails review and the check | R9 |
| T7 | A valid directional signal is accepted and served as a level | — (positive control for T8-T11) | R7 |
| T8 | A payload carrying a figure is rejected | A payload with any numeric field fails validation and stores nothing | **R7** |
| T9 | A payload carrying a date, a due date, or an identifier is rejected | Each of the three is rejected individually | **R7** |
| T10 | A note over 120 characters is rejected, **not truncated** | The over-length note must not be stored in shortened form | **R7** |
| T11 | An unrecognized payload field is rejected | `additionalProperties` false: a field named like a balance fails validation | **R7** |
| T12 | A `producer_only` signal is refused to a subscriber | The refusal is distinguishable from "no such signal", and comes from the bus | **R8** |
| T13 | Tier and scope are independent gates | A permitted-tier signal marked `producer_only` is still refused | R8 |
| T14 | A new signal kind defaults to `producer_only` | A new kind that is readable by a subscriber without explicit widening fails | R8 |
| T15 | `strict_local_maximum` cannot be expressed in this tier | A signal claiming that tier fails as an unknown enum member; no artifact references such content | **R10** |
| T16 | A request with no secret-token header is rejected | Absent header must not be treated as empty or as valid | **R11** |
| T17 | A request with a mismatched token is rejected | Wrong token refused; response reveals nothing about which check failed | **R11** |
| T18 | The token comparison is constant-time | A short-circuiting comparison in the source fails the test | **R11** |
| T19 | An absent or empty expected token fails closed | Unconfigured guard refuses every request; it must not accept every request | **R11** |
| T20 | A sender absent from the allowlist is rejected before any parsing | Non-allowlisted sender refused; an empty allowlist refuses everyone | **R12** |
| T21 | A repeated update identifier produces no second side effect | Second delivery is a no-op, acknowledged as success, with no duplicate write | **R13** |
| T22 | **Two bots emitting the same update identifier are both processed** | A dedup store keyed on the identifier alone drops the second and fails this test | **R14** |
| T23 | Concurrent duplicate deliveries cannot both proceed | A read-then-write dedup scheme fails; the unique index does not | R13, R14 |
| T24 | The handler acknowledges before any slow work | A handler that awaits a model call inline fails the latency assertion | **R15** |
| T25 | An enqueued update survives a restart before processing | Losing the item on restart fails | R15 |
| T26 | A downstream failure retries in the queue, not at the transport | A downstream error that surfaces as a transport failure fails | R15 |
| T27 | A `T0` turn invokes no model | The model port mock records **zero** invocations; a recorded call fails, even if its output is discarded | **R16** |
| T28 | An exhausted cap refuses that agent's model calls | An over-cap call that proceeds fails | **R17** |
| T29 | An exhausted cap for one agent leaves the other unaffected | A cross-agent aggregate cap decision fails this test | **R17** |
| T30 | Deterministic obligation alerts still fire with the cap exhausted | A suppressed alert fails; this is the most important negative case in the table | **R17** |
| T31 | A model absent from the eligibility registry cannot be selected | Selection of an unlisted model fails | **R18** |
| T32 | A `provisional` registry does not permit live routing | Routing under a provisional registry fails | **R18** |
| T33 | A missing, unparseable, or unmarked registry fails closed | Absence of a provisional flag must not be read as "not provisional" | **R18** |
| T34 | Every model request carries the provider privacy policy | A request assembled without it fails | **R19** |
| T35 | No prompt or completion text reaches any log or signal | A log line, error path, or bus payload containing content fails | **R19** |
| T36 | A backup snapshot is transactionally consistent | A file-copy snapshot path fails; the snapshot statement is required | **R20** |
| T37 | The backup is encrypted to a public key whose private half is absent from the host | A private key present on the host fails | **R20** |
| T38 | The plaintext snapshot is shredded, including on the failure path | A surviving plaintext snapshot after a failed encryption fails | **R20** |
| T39 | Upload is verified by size and digest | An unverified upload counted as a backup fails | R20 |
| T40 | A restored store passes an integrity check **before** being trusted | A restore path that boots or promotes before the check fails | **R21** |
| T41 | A restored store failing the integrity check is discarded and escalated | A repair-and-use path fails | **R21** |
| T42 | Restore never overwrites a live store in place | An in-place restore fails | R21 |
| T43 | An unhealthy service reports failure and is restarted | A health endpoint returning success while the store is unopenable fails | **R22** |
| T44 | The health endpoint reveals nothing sensitive | An endpoint exposing configuration or record counts fails | R22 |
| T45 | The kill sentinel halts model calls and outbound writes per call | A cached or start-up-only check fails; an unreadable sentinel path must read as halted | §8 |
| T46 | The kill switch does not suppress deterministic alerts | A suppressed alert fails | §8, R17 |
| T47 | Every gated item G1-G6 and G8 appears in the gate register as blocked | A gated item marked done, or absent, fails | **R23** |
| T48 | No tracked file contains a deployment particular | A synthetic-but-particular-shaped value in `ops/**` or a fixture makes the check fail | **R24** |
| T49 | The particulars check fails closed | An unreadable or unrecognized scanned file is a failure, not a skip | **R24** |

---

## 12. Forbidden, unconditionally

- Publishing the signal bus, or adding any proxy rule that reaches it.
- Adding a field to the signal payload that can carry a figure, a date, an identifier, or a narrative.
- Permitting `additionalProperties` anywhere in the signal payload.
- Truncating an over-length note instead of rejecting it.
- Honouring a consent scope at the subscriber instead of at the bus.
- Defaulting a new signal kind to `shared`.
- Storing, referencing, transmitting, or counting `strict_local_maximum` content.
- Mounting one agent's store read-write into another agent's container.
- A short-circuiting comparison of the secret token.
- Treating an absent token, an empty token, or an empty allowlist as permissive.
- De-duplicating on an update identifier without the bot identifier.
- Performing a slow call before acknowledging a delivery.
- Invoking any model on the `T0` path.
- Raising, bypassing, or temporarily lifting a spend cap.
- Suppressing a deterministic obligation alert for any reason — cap exhaustion, kill switch, or outage.
- Routing under a missing, unparseable, unmarked, or `provisional` eligibility registry.
- Writing prompt or completion text to any log, error, signal, or backup.
- Copying a live store file as a backup.
- Placing a backup private key on the host.
- Leaving a plaintext snapshot after encryption.
- Trusting a restored store before its integrity check.
- Reversing a migration instead of restoring a snapshot.
- Inventing a secret value, committing a real secret, weakening a gate, or claiming a gated item is done.
- Re-raising G7.
- A real domain, address, storage identifier, numeric messaging user id, bot name, port assignment, or
  real monetary figure in this file or any artifact it governs.

---

## 13. Source notes

Nothing in this contract is novel behaviour invented here. It is the documented behaviour of the
components plus the positions the steering file and the architecture review already took.

External documentation, current as fetched 2026-08-06 (see architecture Appendix B):

- Messaging platform webhook registration: the secret-token header, the closed set of permitted webhook
  ports, narrowed update types, the connection ceiling, dropping pending updates on first registration,
  and the platform FAQ's recommendation of a secret path segment as a first authenticity check —
  `core.telegram.org/bots/api#setwebhook`, `core.telegram.org/bots/faq`
- Model provider keys: many keys per account, each with its own spend limit and reset period, minted and
  rotated through a management key; and the provider privacy controls (training exclusion, denying
  providers that collect data, zero data retention) — `openrouter.ai/docs`
- Container orchestration resource limits and reservations, restart policy, and health checks —
  `docs.docker.com/reference/compose-file/deploy`
- The store's snapshot statement as the blessed way to take a consistent copy of a live database, and
  the write-ahead-logging warning against network filesystems — `sqlite.org/lang_vacuum.html`,
  `sqlite.org/wal.html`
- Per-file storage scope as the non-sensitive grant, and the service-identity storage-quota trap that
  breaks uploads to a personal account — `developers.google.com/workspace/drive`

Internal sources, all in this repository:
`.kiro/steering/two-agent-vps.md` §0b, §1, §2, §3, §4, §5, §6, §7;
`.kiro/steering/pfos-current.md`; `.kiro/steering/money-rules.md`; `.kiro/steering/drive-db.md`;
`docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md` §1.2-§1.10, §2.1-§2.5, §3.1-§3.4, §4.1-§4.3, §6, §7,
Appendix A, Appendix B;
`contracts/pfos/02_PFOS_Data_Architecture_Integrations_and_Security.md` §3, §5, §8, §9, §10;
`contracts/pfos/06_PFOS_Database_and_Knowledge_Model.md` §1.2, §2, §3.3, §3.4, §6, §7, §8;
`contracts/pfos/09_PFOS_OpenRouter_Phase_1_Benchmark_Calibration.md`;
`contracts/pfos/10_PFOS_OpenRouter_Phase_2_Automatic_Task_and_Turn_Routing.md`;
`contracts/pfos/11_PFOS_OpenRouter_Phase_3_Adaptive_Cost_Quality_Governance.md`;
`docs/PFOS_SECRETS_PLAN.md`;
`.kiro/specs/06-two-agent-vps/requirements.md` R6-R24; `.kiro/specs/06-two-agent-vps/design.md`.

---

## Machine-executable contract

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "pfos://contracts/two-agent-vps-deployment-and-operations.schema.json",
  "title": "PFOS Two-Agent VPS Deployment and Operations Contract",
  "description": "NIZAM-derived. Governs topology, isolation, the consent bus, transport, deployment-level routing governance, operations, the kill switch, the human gate register, and the public-repository posture. Owning requirements R6-R24.",
  "type": "object",
  "required": [
    "provenance",
    "topology",
    "isolation",
    "consent_bus",
    "transport",
    "routing_governance",
    "operations",
    "kill_switch",
    "gate_register",
    "public_repo_posture",
    "acceptance_tests"
  ],
  "properties": {
    "provenance": {
      "type": "object",
      "required": ["origin", "derived_from", "authoritative_steering"],
      "properties": {
        "origin": {"const": "nizam_derived_never_authored_upstream"},
        "derived_from": {"type": "array", "minItems": 4, "items": {"type": "string"}},
        "authoritative_steering": {"const": ".kiro/steering/two-agent-vps.md"}
      }
    },
    "topology": {
      "type": "object",
      "required": [
        "agents",
        "public_entry_points",
        "tls_termination",
        "webhook_paths",
        "webhook_path_is_bot_token",
        "bus_network",
        "bus_publicly_reachable",
        "outside_bus_access_result",
        "per_service_resource_limits",
        "log_rotation",
        "degraded_mode"
      ],
      "properties": {
        "agents": {"const": 2},
        "public_entry_points": {"const": 1},
        "tls_termination": {"const": "reverse_proxy_automatic"},
        "webhook_paths": {"const": "one_high_entropy_secret_segment_per_bot"},
        "webhook_path_is_bot_token": {"const": false},
        "bus_network": {"const": "internal_only_no_route_to_proxy_or_internet"},
        "bus_publicly_reachable": {"const": false},
        "outside_bus_access_result": {"const": "refused_at_network_layer"},
        "per_service_resource_limits": {"const": true},
        "log_rotation": {"const": "mandatory_size_and_file_capped"},
        "degraded_mode": {"const": "long_poll_with_all_guards_intact"}
      }
    },
    "isolation": {
      "type": "object",
      "required": [
        "separate_per_agent",
        "shared",
        "cross_agent_store_open",
        "cross_store_mounts",
        "attach_permitted",
        "writers_per_store",
        "store_on_network_or_synced_filesystem",
        "shared_code"
      ],
      "properties": {
        "separate_per_agent": {
          "type": "array",
          "minItems": 6,
          "items": {"enum": ["process", "store_file", "volume", "bot_token", "model_key", "environment_file"]}
        },
        "shared": {
          "type": "array",
          "items": {"enum": ["host", "model_provider_account_via_two_keys", "signal_envelope_schema"]}
        },
        "cross_agent_store_open": {"const": "not_present_in_namespace_and_typed_error_in_code"},
        "cross_store_mounts": {"const": "read_only_backup_and_scheduler_only"},
        "attach_permitted": {"const": false},
        "writers_per_store": {"const": 1},
        "store_on_network_or_synced_filesystem": {"const": false},
        "shared_code": {"const": false}
      }
    },
    "consent_bus": {
      "type": "object",
      "required": [
        "store",
        "append_only",
        "validated_on",
        "envelope_fields",
        "payload_permits",
        "payload_forbids",
        "note_max_chars",
        "over_length_note_behaviour",
        "additional_properties",
        "invalid_signal_behaviour",
        "tier_enum",
        "consent_scope_enum",
        "scope_enforced_at",
        "scope_evaluated_on",
        "new_kind_default_scope",
        "producer_only_subscriber_result",
        "tier_and_scope",
        "strict_local_maximum",
        "defence_layers"
      ],
      "properties": {
        "store": {"const": "signals.db"},
        "append_only": {"const": true},
        "validated_on": {"const": "write_and_read"},
        "envelope_fields": {
          "type": "array",
          "minItems": 9,
          "items": {"enum": ["signal_id", "ts", "producer", "kind", "tier", "consent_scope", "payload.level", "payload.direction", "payload.note", "hash"]}
        },
        "payload_permits": {
          "type": "array",
          "items": {"enum": ["level_enum", "direction_enum", "note_max_120_chars"]}
        },
        "payload_forbids": {
          "type": "array",
          "minItems": 5,
          "items": {"enum": ["any_numeric_field", "any_date_or_due_date_field", "any_identifier_field", "free_text_over_120_chars", "unrecognized_field"]}
        },
        "note_max_chars": {"const": 120},
        "over_length_note_behaviour": {"const": "rejected_never_truncated"},
        "additional_properties": {"const": false},
        "invalid_signal_behaviour": {"const": "refused_and_audited_never_quarantine_stored"},
        "tier_enum": {
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "items": {"enum": ["money_safe", "life_safe"]}
        },
        "consent_scope_enum": {
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "items": {"enum": ["shared", "producer_only"]}
        },
        "scope_enforced_at": {"const": "the_bus_not_the_subscriber"},
        "scope_evaluated_on": {"const": "every_read_from_stored_envelope_never_cached"},
        "new_kind_default_scope": {"const": "producer_only"},
        "producer_only_subscriber_result": {"const": "refused_distinguishable_from_absent"},
        "tier_and_scope": {"const": "independent_gates_both_must_pass"},
        "strict_local_maximum": {"const": "not_a_tier_member_excluded_from_this_tier_entirely"},
        "defence_layers": {"const": 4},
        "leakage_prevention_mechanism": {"const": "consent_by_absence_the_field_does_not_exist"}
      }
    },
    "transport": {
      "type": "object",
      "required": [
        "authenticity_checks",
        "missing_token",
        "mismatched_token",
        "token_comparison",
        "unconfigured_token",
        "token_logged",
        "allowlist",
        "empty_allowlist",
        "allowlist_check_order",
        "dedup_key",
        "dedup_enforcement",
        "duplicate_result",
        "dedup_window_floor",
        "acknowledgement",
        "queue_durability",
        "downstream_failure_surface"
      ],
      "properties": {
        "authenticity_checks": {
          "type": "array",
          "minItems": 2,
          "items": {"enum": ["secret_path_segment", "secret_token_header"]}
        },
        "missing_token": {"const": "rejected"},
        "mismatched_token": {"const": "rejected"},
        "token_comparison": {"const": "constant_time"},
        "unconfigured_token": {"const": "fail_closed_refuse_every_request"},
        "token_logged": {"const": false},
        "allowlist": {"const": "injected_configuration_placeholder"},
        "empty_allowlist": {"const": "refuses_everyone"},
        "allowlist_check_order": {"const": "after_token_before_any_parsing"},
        "dedup_key": {"const": "bot_id_and_update_id"},
        "dedup_enforcement": {"const": "unique_index_with_conflict_ignoring_insert"},
        "duplicate_result": {"const": "no_op_acknowledged_as_success"},
        "dedup_window_floor": {"const": "never_shorter_than_provider_max_redelivery_window"},
        "acknowledgement": {"const": "accept_fast_before_any_slow_work"},
        "queue_durability": {"const": "table_in_the_agents_own_store"},
        "downstream_failure_surface": {"const": "queue_retry_never_transport_failure"},
        "namespacing_rationale": {"const": "update_ids_are_per_bot_sequences_and_would_collide"}
      }
    },
    "routing_governance": {
      "type": "object",
      "required": [
        "t0_model_invocations",
        "t0_proof",
        "cap_belts",
        "cap_key",
        "cap_exhaustion_scope",
        "deterministic_alerts_under_exhaustion",
        "cap_bypass_permitted",
        "eligibility_registry_required",
        "provisional_registry_permits_live_routing",
        "registry_check_mode",
        "privacy_policy_per_request",
        "prompt_text_in_logs",
        "loggable_fields",
        "log_format",
        "model_output_trust",
        "model_sources_monetary_number"
      ],
      "properties": {
        "t0_model_invocations": {"const": 0},
        "t0_proof": {"const": "port_mock_records_zero_invocations"},
        "cap_belts": {
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "items": {"enum": ["in_app_weekly_total_per_agent", "provider_per_key_periodic_limit"]}
        },
        "cap_key": {"const": "agent"},
        "cap_exhaustion_scope": {"const": "one_agent_only_never_aggregated_across_agents"},
        "deterministic_alerts_under_exhaustion": {"const": "still_produced"},
        "cap_bypass_permitted": {"const": false},
        "eligibility_registry_required": {"const": true},
        "provisional_registry_permits_live_routing": {"const": false},
        "registry_check_mode": {"const": "fail_closed_absent_flag_is_not_not_provisional"},
        "privacy_policy_per_request": {"const": true},
        "prompt_text_in_logs": {"const": false},
        "loggable_fields": {
          "type": "array",
          "items": {"enum": ["tier", "model_identity", "token_counts", "latency", "schema_validity", "actual_reported_cost", "correlation_ref"]}
        },
        "log_format": {"const": "structured_redacted_features_only"},
        "model_output_trust": {"const": "untrusted_data_cannot_issue_an_instruction"},
        "model_sources_monetary_number": {"const": false}
      }
    },
    "operations": {
      "type": "object",
      "required": ["backup", "restore", "health", "rollback", "disaster_recovery", "artifact_paths"],
      "properties": {
        "backup": {
          "type": "object",
          "required": ["snapshot_method", "file_copy_permitted", "encryption", "private_key_on_host", "plaintext_handling", "upload_grant", "upload_verification", "contains_secrets"],
          "properties": {
            "snapshot_method": {"const": "engine_snapshot_statement_transactionally_consistent"},
            "file_copy_permitted": {"const": false},
            "encryption": {"const": "public_key_to_BACKUP_PUBLIC_KEY_placeholder"},
            "private_key_on_host": {"const": false},
            "plaintext_handling": {"const": "shredded_immediately_including_on_failure_path"},
            "upload_grant": {"const": "narrow_per_file_user_grant_never_service_identity"},
            "upload_verification": {"const": "size_and_digest"},
            "contains_secrets": {"const": false}
          }
        },
        "restore": {
          "type": "object",
          "required": ["decrypt_location", "integrity_check_before_trust", "failed_integrity_behaviour", "overwrites_live_store", "drill_required"],
          "properties": {
            "decrypt_location": {"const": "off_host_only"},
            "integrity_check_before_trust": {"const": true},
            "failed_integrity_behaviour": {"const": "discard_and_escalate_never_repair_and_use"},
            "overwrites_live_store": {"const": false},
            "drill_required": {"const": "scheduled_and_recorded_stale_drill_is_a_failing_control"}
          }
        },
        "health": {
          "type": "object",
          "required": ["reports", "process_running_is_sufficient", "unhealthy_action", "restart_policy_scope", "exposes_sensitive_data"],
          "properties": {
            "reports": {
              "type": "array",
              "items": {"enum": ["store_opens", "pragmas_in_force", "migration_version_expected", "queue_worker_alive"]}
            },
            "process_running_is_sufficient": {"const": false},
            "unhealthy_action": {"const": "orchestrator_restarts_the_service"},
            "restart_policy_scope": {"const": "per_service"},
            "exposes_sensitive_data": {"const": false}
          }
        },
        "rollback": {
          "type": "object",
          "required": ["method", "migration_reversal_permitted", "across_migration_method", "deployment_order"],
          "properties": {
            "method": {"const": "redeploy_previous_immutable_image_tag"},
            "migration_reversal_permitted": {"const": false},
            "across_migration_method": {"const": "restore_snapshot_taken_before_it_with_integrity_check"},
            "deployment_order": {"const": "snapshot_then_migrate_then_deploy"}
          }
        },
        "disaster_recovery": {
          "type": "object",
          "required": ["failure_domains", "rebuild_path", "secrets_on_rebuild", "degraded_operation", "recovery_objective_basis"],
          "properties": {
            "failure_domains": {"const": 1},
            "rebuild_path": {"const": "fresh_host_then_restore_then_reprovision_secrets_then_templates_then_reregister_webhooks"},
            "secrets_on_rebuild": {"const": "reissued_never_restored"},
            "degraded_operation": {"const": "long_poll_mode_with_all_guards_intact"},
            "recovery_objective_basis": {"const": "backup_cadence_configuration_value"}
          }
        },
        "artifact_paths": {
          "type": "object",
          "required": ["root", "content_rule", "execution_by_automated_agent"],
          "properties": {
            "root": {"const": "ops/"},
            "content_rule": {"const": "templates_with_angle_bracket_placeholders_only"},
            "execution_by_automated_agent": {"const": false}
          }
        }
      }
    },
    "kill_switch": {
      "type": "object",
      "required": ["forms", "sentinel_check_frequency", "unreadable_sentinel_behaviour", "suppresses_deterministic_alerts", "destroys_data", "cleared_by"],
      "properties": {
        "forms": {
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "items": {"enum": ["file_sentinel_checked_per_call", "coarse_environment_variable"]}
        },
        "sentinel_check_frequency": {"const": "per_call_never_cached_never_startup_only"},
        "unreadable_sentinel_behaviour": {"const": "fail_closed_treated_as_halted"},
        "suppresses_deterministic_alerts": {"const": false},
        "destroys_data": {"const": false},
        "cleared_by": {"const": "the_operator_only"}
      }
    },
    "gate_register": {
      "type": "object",
      "required": ["path", "gated", "closed_wont_do", "attempt_permitted", "report_as_done_permitted", "invent_secret_permitted", "weaken_gate_permitted"],
      "properties": {
        "path": {"const": "ops/DEPLOYMENT_CONTROL.md"},
        "gated": {
          "type": "array",
          "minItems": 7,
          "maxItems": 7,
          "items": {"enum": ["G1", "G2", "G3", "G4", "G5", "G6", "G8"]}
        },
        "closed_wont_do": {
          "type": "array",
          "minItems": 1,
          "items": {"enum": ["G7_repo_privatization"]}
        },
        "attempt_permitted": {"const": false},
        "report_as_done_permitted": {"const": false},
        "invent_secret_permitted": {"const": false},
        "weaken_gate_permitted": {"const": false},
        "g7_may_be_reraised": {"const": false}
      }
    },
    "public_repo_posture": {
      "type": "object",
      "required": ["repository_visibility", "deployment_particular_in_tracked_file", "forbidden_particulars", "placeholder_form", "fixture_data", "harness_check"],
      "properties": {
        "repository_visibility": {"const": "public_by_owner_decision"},
        "deployment_particular_in_tracked_file": {"const": false},
        "forbidden_particulars": {
          "type": "array",
          "minItems": 8,
          "items": {
            "enum": [
              "real_domain_or_hostname",
              "host_address_literal",
              "secret_webhook_path_segment",
              "bot_name_or_numeric_messaging_user_id",
              "storage_folder_or_file_identifier",
              "administrative_access_port_or_backup_public_key",
              "real_monetary_figure_or_balance_or_payee",
              "organization_specific_term"
            ]
          }
        },
        "placeholder_form": {"type": "string", "pattern": "^<[A-Z_]+>$"},
        "fixture_data": {"const": "synthetic_only_never_anonymized_real_data"},
        "harness_check": {
          "type": "object",
          "required": ["fails_closed", "runs_in_gate", "exception_list", "has_negative_test"],
          "properties": {
            "fails_closed": {"const": true},
            "runs_in_gate": {"const": "npm run verify:all -- --all"},
            "exception_list": {"const": "explicit_short_and_reviewed"},
            "has_negative_test": {"const": true}
          }
        }
      }
    },
    "acceptance_tests": {
      "type": "array",
      "minItems": 49,
      "items": {
        "type": "object",
        "required": ["id", "requirement", "has_negative_case"],
        "properties": {
          "id": {"pattern": "^T\\d+$"},
          "requirement": {"pattern": "^(R\\d+|section_\\d+)$"},
          "has_negative_case": {"const": true}
        }
      }
    },
    "forbidden": {
      "type": "array",
      "items": {
        "enum": [
          "publish_the_signal_bus",
          "payload_field_capable_of_carrying_a_figure_date_identifier_or_narrative",
          "additional_properties_in_the_payload",
          "truncate_an_over_length_note",
          "honour_consent_scope_at_the_subscriber",
          "default_a_new_kind_to_shared",
          "store_reference_or_transmit_strict_local_maximum",
          "read_write_cross_agent_store_mount",
          "short_circuiting_secret_token_comparison",
          "treat_absent_or_empty_token_or_allowlist_as_permissive",
          "dedup_without_the_bot_identifier",
          "slow_work_before_acknowledgement",
          "invoke_a_model_on_the_t0_path",
          "raise_bypass_or_lift_a_spend_cap",
          "suppress_a_deterministic_obligation_alert",
          "route_under_a_missing_unparseable_unmarked_or_provisional_registry",
          "write_prompt_or_completion_text_to_a_log_signal_or_backup",
          "copy_a_live_store_file_as_a_backup",
          "place_a_backup_private_key_on_the_host",
          "leave_a_plaintext_snapshot_after_encryption",
          "trust_a_restored_store_before_its_integrity_check",
          "reverse_a_migration_instead_of_restoring_a_snapshot",
          "invent_a_secret_value",
          "commit_a_real_secret",
          "weaken_a_gate_to_make_it_pass",
          "claim_a_gated_item_is_done",
          "reraise_g7",
          "deployment_particular_in_a_tracked_file"
        ]
      }
    }
  }
}
```
