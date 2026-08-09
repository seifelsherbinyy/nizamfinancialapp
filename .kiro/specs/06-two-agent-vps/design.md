# Design - Two-Agent VPS Tier

> Full rationale, comparisons, and verified source citations: `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md`.
> This file is the build-facing summary. Steering: `.kiro/steering/two-agent-vps.md`.

## Shape

```
Telegram --443--> caddy --/tg/<secret-a>--> life-agent    (nizamcore, Python)   -> life.db
                        \-/tg/<secret-b>--> finance-agent (this repo, Node/TS)  -> finance.db
                                                  \                /
                                                   signalbus (internal only)    -> signals.db
                          scheduler | backup | (optional shared router)
```

Isolation: separate process, DB file, volume, bot token, and OpenRouter key per agent. Shared: the host, the
OpenRouter **account** (two keys), and the signal bus schema.

## Repo layout added by this spec (finance side)

```
src/server/                 # Node/TS server tier (NOT in the browser bundle)
  db/                       # node:sqlite, WAL, migrations, repositories
  telegram/                 # webhook handler behind a port + deterministic mock
  routing/                  # classifier, router, spend ledger, telemetry
  signals/                  # bus client + consent gate + envelope validation
  ports/                    # every external boundary as an interface + mock
ops/                        # TEXT ONLY, placeholders only, never executed by Kiro
  docker-compose.yml  Caddyfile  env/*.env.example  systemd/*  backup/*  restore/*
  GATE_REGISTER.md          # the human-gated items, with exact steps
  nizamcore-patches/        # patch series for the OTHER repo (steering §6)
```

`src/server/**` must never be imported by `App.tsx` or the browser router, exactly as
`src/features/benchmark/**` and `src/features/routing/**` are already excluded.

## Key decisions

1. **Ports and mocks everywhere.** Every external boundary (Telegram, OpenRouter, Drive, WHOOP, bus) is an
   injected interface with a deterministic mock. This is what makes the tier fully buildable and testable with
   no VPS and no secret, and it is already the house pattern.
2. **Reuse, do not rewrite.** `nizamcore/NIZAM__system/relay/auth.py` and `dedup.py` already implement
   constant-time secret-token comparison, the allowlist, and update dedup, with tests. The finance agent ports
   that *logic* to TypeScript; it does not invent a new scheme. The money core and Stage 1-4 engines are reused
   verbatim, which is why the finance runtime is Node (steering §1).
3. **Dedup must be namespaced per bot (R14).** `dedup.py` keys a single shared state file by update id only.
   Update ids are per-bot sequences, so two bots collide. Correct key is `(bot_id, update_id)`, and in SQLite
   it becomes `INSERT OR IGNORE` on a UNIQUE index, which also removes the read-modify-write race that the
   JSON file has under concurrent webhook delivery.
4. **Acknowledge fast, process async (R15).** The current handler processes inline; a slow model call would
   exceed Telegram's tolerance and trigger redelivery. Accept, enqueue, return promptly.
5. **Consent by absence (R7).** The signal envelope has no field capable of carrying a figure or free-form
   narrative. Leakage is prevented by the schema lacking the field, not by a runtime filter that could be
   bypassed. Negative tests assert rejection.
6. **Two keys, one account.** OpenRouter supports many keys per account, each with its own `limit` and
   `limit_reset` (daily/weekly/monthly). One key per agent gives platform-enforced budget isolation on top of
   the in-app cap.
7. **Kill switch as a file sentinel, not only an env var.** An env var cannot be flipped without a restart.
   Check a sentinel path per call so a single touch halts every writer immediately; keep `NIZAM_KILL_ALL` as
   the coarse form.

## Testing strategy

- Pure functions and repositories: unit tests over an in-memory or temp-file SQLite.
- Every gate gets a **negative** test that proves it fires: bad token, wrong user, duplicate update, colliding
  update ids across two bots, over-cap spend, a signal carrying a figure, a `producer_only` signal, a
  provisional registry attempting promotion, a cross-agent DB open.
- A test that has only ever been observed passing is not evidence. Each negative test must be shown failing
  the guarded operation, not merely returning a value.

---

## Design delta - Phase 10, ship live on long-poll (R26-R30)

> **Authority:** `KIRO_SHIP_LIVE.prompt.md` rev 2, 2026-08-10. **Requirements added:** R26, R26.1, R27, R28,
> R29, R30. **Findings closed by them:** O1 (R28 + R29), F12 (R30). This section is an **append**: nothing
> above it is revised, because nothing above it turned out to be wrong. What changes is the order of
> delivery, not the shape.

### D1 - The transport mode becomes a first-class axis, not a configuration detail

The port already admits `TELEGRAM_TRANSPORT_MODES = ['webhook', 'longPoll']` and documents long-poll as the
degraded mode, so the vocabulary exists and needs no widening. What was missing is that **one of the three
guards is mode-scoped and the other two are not**, and nothing in the design said so.

Authenticity is two independent gates plus a fail-closed configuration check, evaluated unconditionally and
then read in the order configuration, token, allowlist. In `webhook` all three apply. In `longPoll` there is
no inbound request, so the first two have no input: `secretTokenHeader` is `null` because no header exists,
and the expected token guards a door that is not there. The allowlist is unaffected - it reads
`senderId`, which long-poll supplies just as webhook does.

The design consequence, and the reason this is a delta rather than a code note: **`authorizeDelivery` must
take the mode as an input, and the two modes must not share a relaxed path.** Three shapes were considered.

| Shape | Why it was not taken |
|---|---|
| Synthesise the expected token into the header on the long-poll path, so the existing guard passes | It makes the guard lie. A reader of the audit line cannot tell a real match from a manufactured one, and the same trick applied by mistake on the webhook path is an open door. |
| Make `expectedSecretToken` optional and treat absent as "skip the check" | This is the door R11 exists to close. An absent token would then open `webhook` too, and the failure would be silent in exactly the mode where it matters. |
| **Taken:** the mode selects **which gates are applicable**, and the applicable set is a property of the mode rather than of the values | The asymmetry is explicit and testable in both directions. `webhook` keeps all three gates and R11 is untouched. `longPoll` declares the token gate not applicable and keeps the allowlist as the whole guard, so an empty allowlist still refuses everyone. Neither mode can be satisfied by weakening the other. |

Fail-closed survives the change, and that is the load-bearing claim. Under the taken shape a `longPoll`
deployment with nothing configured admits **nobody**, because `senderIsAllowlisted` returns false for an
empty list and for an empty sender identifier. The refusal stays indistinguishable as to stage in both modes,
since the refusal type has no reason field and every refusal returns the same frozen value.

### D2 - Offset advance is the durability boundary (R26.1)

Webhook and long-poll differ in **who holds the retry**. Under webhook the provider retries until
acknowledged, and R15's accept-fast/process-async split plus the `(bot, update)` dedup key makes that
at-least-once delivery effectively-once. Under long-poll the agent holds its own read offset, so the agent
owns the retry - and the offset is the acknowledgement.

Therefore: **advance the offset only after the update is durably enqueued.** Enqueue commits first, offset
advances second. A crash between them re-reads the update, which dedup absorbs; a crash in the other order
loses it, and nothing absorbs that. This is the same ordering rule as the webhook path expressed against a
different acknowledgement mechanism, which is why the dedup key does not change: the pair keys both modes,
and R14's per-bot half stays mandatory because update identifiers remain per-bot sequences.

### D3 - The loader grows from two agents to six services, and gains an aggregate refusal (R27)

Two properties are preserved and one is added.

- **Preserved: exactly one `process.env` bridge in the whole of `src/`.** `processEnvSource()` is that
  bridge, isolated in a single expression precisely so the tree scan has exactly one permitted hit. Six
  services must not become six bridges; they become six entry-name groups behind the same bridge.
- **Preserved: per-service independence is structural, not checked.** `AGENT_ENTRY_NAMES` gives each identity
  its own entry names and the two rows share none, so a `finance` load never spells a `life` entry name -
  isolation by never looking the other name up rather than by rejecting it afterwards. Extending to six
  services extends that table; it does not introduce a lookup by string.
- **Added: every missing entry named in one message.** This is the property the design must now grow, and it
  is the one place the mandate's own text disagrees with the disk. §6.1 states the loader "names **every**
  missing entry at once" and marks it **Confirmed**. It does not. `readRaw` throws `EnvConfigError` on the
  **first** absent entry, and that error carries a single `entry` field; the module's own note says as much,
  describing `describeConfiguredPresence` as answering the question "a loader that refuses on the FIRST
  missing entry answers one item at a time". So the multi-entry facility exists, returns booleans for every
  entry, and is **not on the refusal path**.

  The delta is therefore real work, not a re-confirmation: collect across all required entries, then refuse
  once with every finding named. Ladder rung **L0** is the observation that settles it - remove one required
  entry, and the boot must fail naming **that** entry **and every other missing one in the same message**.
  An aggregate error is what makes L0 passable; a first-failure error passes half of it.

  Two constraints on how the aggregate is built. It must carry a **code per finding**, not one umbrella code,
  or the discriminator that lets a caller tell an absent entry from an unusable one is lost. And it must
  carry **entry names only, never values**, which is already the invariant: the message is assembled from the
  name alone so an error reaching a log carries what an operator needs and nothing that discloses what was
  configured.

### D4 - The process entrypoint, and what `longPoll` removes from it (R29)

`src/server/telegram/index.ts` is a barrel re-export, not a `main`. The application logic it re-exports is
complete and tested behind mocks - authenticity, dedup, the work queue, the worker runner, the accept
handler - which is exactly what makes the absence easy to miss: the code exists, the process does not.

The entrypoint wires `acceptHandler` + `workerRunner` + `routing/turnDispatch` and adds three behaviours that
belong to a process rather than to a module:

1. **Refuse to boot on an incomplete environment.** The loader already refuses; the process must not catch
   that and continue degraded. A booted-but-unconfigured agent is the failure mode fail-closed exists to
   prevent, one layer up.
2. **Honour the sentinel in both forms.** The file sentinel is checked per call, because an environment
   variable cannot be flipped without a restart and a halt that needs a restart is not a halt.
   `NIZAM_KILL_ALL=1` remains the coarse form, honoured at boot.
3. **Bind a port only in `webhook`.** In `longPoll` there is nothing to listen for, so the process binds
   **no public port** - which is why phase 1 needs no firewall rule, no certificate and no proxy. In
   `webhook` it listens on `FINANCE_CONTAINER_PORT` and nothing else.

This is also where the missing runtime dependency surfaces honestly: `package.json` today has no server
framework and no start script, so R29 implies adding both. That is a dependency decision inside the existing
boundary, not a network or secret decision.

### D5 - Images, and the port posture they publish (R28, R30)

**Images.** Six `<*_IMAGE_REF>` placeholders, zero Dockerfiles. The design position is that a placeholder is
correct for a **value** and wrong for a **capability**: `ops/**` holds templates whose values are injected at
deploy time, and an image tag is such a value - but the *ability to produce* the artifact that tag names is
not a deployment particular and its absence is a build gap. So R28 asks for a Dockerfile per image **this
repository owns** and a build path producing the referenced tag. The life-agent image is downstream of the
three unapplied `ops/nizamcore-patches/` change specifications and belongs to the other repository; this
repository does not build it and must not pretend to.

**Ports.** The compose file publishes exactly one host port and comments the absence elsewhere as
deliberate - `signalbus` in particular states that not even a loopback-bound published port is acceptable,
because the host is what the proxy runs on. That posture is correct and stays. R30 adds the missing
**cross-artifact** assertion: the firewall posture and the port bindings must agree, in both directions, and
the certificate-challenge resolution must be recorded rather than inferred.

The two admissible resolutions are set out in R30's finding note. **This design delta does not choose
between them**, and the choice is not a design question dressed as a task: both are sound, they differ in
which artifact has to change, and the owner-mandated criterion is speed. Task 10.8 decides, records the
choice in `ops/GATE_REGISTER.md`, and makes the two artifacts agree.

### D6 - Testing strategy delta

The strategy above is unchanged in kind - every gate gets a negative test that is shown failing the guarded
operation - and gains four cases, one per new asymmetry:

- **Both directions of the mode-aware guard.** `longPoll` refuses an unlisted sender; `longPoll` accepts the
  owner **with no secret-token header at all**; an empty allowlist under `longPoll` refuses everyone;
  `webhook` still refuses absent, empty, over-length and out-of-charset tokens. The webhook cases are the
  regression fence: they must be shown still failing after the mode axis lands, or the relaxation the mandate
  forbids has happened and nothing noticed.
- **Same update twice produces one effect in both modes**, and in `longPoll` a crash before the enqueue
  commits re-delivers rather than loses.
- **The aggregate refusal names every missing entry**, asserted by removing more than one and reading the
  message - not by removing one, which a first-failure error also passes.
- **`longPoll` binds no port.** An assertion about an absence, so it is made against the process's own
  listener set rather than by probing a socket.
