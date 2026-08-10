# LIVE PROGRESS — two-agent VPS tier

> Authority and shape: `KIRO_SHIP_LIVE.prompt.md` §10. This file is the progress record, it is
> **cumulative**, and it is rewritten after each run so the owner sees movement without reading a
> transcript. Last rewritten **2026-08-10**, after tasks 10.12, 10.16 and 10.17.
>
> **State is exactly one of** `OBSERVED`, `BLOCKED - awaiting human`, `BLOCKED - awaiting build`,
> `NOT STARTED`. **Evidence is mandatory for `OBSERVED`**: the command run and what it returned. **A row
> with no evidence is `NOT STARTED` no matter how finished the code looks**, and that rule was applied
> against this repository's own work below, not only against the owner's.
>
> One row per gate **G1-G8**, one per ladder rung **L0-L5**, one per build item in mandate **§6**.
> Verbatim transcripts are in the appendix, so no `OBSERVED` row rests on a summary of itself.

## Gates G1-G8

| Item | State | Evidence | Owner action | Date |
|---|---|---|---|---|
| **G1** provision + harden the host | `BLOCKED - awaiting human` | The **host exists** — provider active — recorded as an observation in `OPERATOR_STATE_2026-08-09.md` §1. Hardening is outstanding: steps 2-9 and `/etc/<CONFIG_DIR>` are unperformed, and no environment file is placed. Nothing was attempted from this session. | Work the **G1** section of `OWNER_GATE_ACTIONS.md`, then place the six environment files | host observed 2026-08-09; hardening — |
| **G2** DNS for the two hostnames | `NOT STARTED` | **Deferred to phase 2, not cancelled** (mandate §2: phase 1 ships on `longPoll`, which needs no domain, no DNS, no certificate and no proxy). Blocked on a domain rather than on tooling: the account held **zero zones**, measured 2026-08-09. | none in phase 1 | — |
| **G3** create the two bots | `BLOCKED - awaiting human` | **Creation and live verification are observed**, by the owner's own session on 2026-08-09 and recorded in `OPERATOR_STATE_2026-08-09.md` §4: two bot identities exist; `getMe` returned `ok: true` and `is_bot: true` on **both** tokens across two probes; `getWebhookInfo` confirmed `url` empty on both, so no webhook exists. **Placement is not observed** and is the open half — the tokens and the allowlist are not on any host, because there is no hardened host to put them on. | Place `BOT_B_TOKEN` and `ALLOWED_USER_IDS` in the finance environment file once G1 is done | creation 2026-08-09; placement — |
| **G4** two model keys + weekly bounds | `BLOCKED - awaiting human` | Not attempted. **D-CAP is settled** (a hard total per week, two keys at half each) and the code companion exists, so nothing waits on a decision. The unit trap is recorded as **F13** and carried into `OWNER_GATE_ACTIONS.md`: the ledger entry is a bare integer in the ledger's own accounting unit, and the figure typed into the provider console is a decimal — the same bound written two ways, and confusing them is a startup refusal in one direction and a bound a million times too large in the other. | Mint two keys at the per-agent bound, with training opt-out, per the **G4** section of `OWNER_GATE_ACTIONS.md` | — |
| **G5** storage consent grant | `BLOCKED - awaiting human` | Not attempted. **D-G5 is settled**: the consent screen must be published to **production**, because a testing screen issues a short-lived refresh token and the uploader would die silently about a week later; and the backup folder reference must be a folder **the uploader creates on first run**, because the scope reaches only what the application itself created. | Perform the grant per the **G5** section of `OWNER_GATE_ACTIONS.md` | — |
| **G6** register the two webhooks | `NOT STARTED` | **Deferred with G2, not cancelled.** `setWebhook` was not run and must not be run in phase 1. | none in phase 1 | — |
| **G7** repository privatization | `NOT STARTED` | **CLOSED as WONT-DO** by owner decision, steering §0b. Both repositories stay public, and the rule that pays for it is R24: the repository may hold the design, never a deployment particular. Do not re-raise. | none, ever | closed 2026-08-06 |
| **G8** backup keypair | `BLOCKED - awaiting human` | Not attempted. Additionally, its verification **drill** cannot run yet for a reason on this side: rung L5 needs the uploader that task 10.9 owns. So even a correctly generated keypair could not be shown to work today. | Generate the keypair per the **G8** section of `OWNER_GATE_ACTIONS.md`, keeping the private half off the host | — |

**On G7 and the four-state vocabulary.** §10 admits exactly four states and none of them means *closed,
deliberately, and never coming back*. G7 is recorded as `NOT STARTED` with the closure stated in its
evidence rather than by inventing a fifth state, because inventing one would make this table stop being
comparable with the next rewrite of it. It is the one row where the state column is the least informative
cell, and this paragraph is the compensation.

**No gate was attempted, advanced or ticked from this session.** A read produces evidence *about* a gate;
it does not advance one (steering §2a). No `setWebhook`, no DNS record, no published port, no image build,
no stack start, no credential created or rotated, and no outbound call of any kind.

## The test ladder (§9)

| Item | State | Evidence | Owner action | Date |
|---|---|---|---|---|
| **L0 config** — the loader refuses an incomplete environment | `OBSERVED` | `node scripts/ladder/l0-config.mjs` → `L0 PASSED`, exit 0. Case A broke **four** entries at once (two removed, one emptied, one left holding its template placeholder) and the real entrypoint exited **1** having written ONE aggregate naming all four with a per-entry code: `4 entries to fix … finance/FINANCE_STORE_FILE … [ENV_ENTRY_ABSENT]; finance/MAX_WORK_ITEMS … [ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER]; finance/MODEL_ELIGIBILITY_REGISTRY_PATH … [ENV_ENTRY_ABSENT]; finance/BUS_INTERNAL_ENDPOINT … [ENV_ENTRY_EMPTY]`. Case B restored all four and the boot **proceeded**: `{"level":"info","event":"store_opened","agent":"finance",…}` on the process's own output stream, error stream **empty**. Full transcript in the appendix. | — | 2026-08-10 |
| **L1 guards** — both modes, both directions | `OBSERVED` | `npx vitest run src/server/telegram/modeAwareGuard.negative.test.ts` → `Test Files 1 passed (1)`, `Tests 25 passed (25)`, 18.85s. `longPoll` refuses an unlisted sender, an empty allowlist and an empty sender identifier while **accepting the owner with no secret-token header**; the same delivery is still refused under `webhook`; the `webhook` fence holds over five unusable expected-token shapes × three header states; dedup holds on the `(bot, update)` pair in **both** modes including the per-bot collision; and the crash-before-enqueue case is asserted against the offset. | — | 2026-08-10 |
| **L2 compose** — the stack stands up | `BLOCKED - awaiting build` | Not run, and not attemptable: **finding F20**. The earliest blocker is **ours**, not the owner's — all three owned images invoke a shim with bare `node`, and bare `node` cannot start any of them. G1, G3-placement and G4 are also outstanding and sit *behind* F20 rather than in front of it. | G1 hardening and the six environment files — but F20 must clear first, or a hardened host still starts nothing | — |
| **L3 transport** — both bots reachable | `BLOCKED - awaiting human` | Not run. Needs L2 (so F20), then G3 **placement**. Under option **(b)** phase 1 reaches **one** bot: the finance agent, with the other bot created, hardened and idle. | G3 placement | — |
| **L4 routing and safety** — money and halt | `BLOCKED - awaiting human` | Not run. Needs L3, then G4. The refusal-at-bound logic, the deterministic-alert guarantee and both halt forms are implemented and unit-covered, which is **not** what this rung asks: it asks for a turn that routed, a spend that was recorded, and a sentinel that stopped a live call. | G4 two keys | — |
| **L5 durability** — the off-host copy is real | `NOT STARTED` | Not run. Task **10.9** is open: the fourth step of the backup script calls an uploader that does not exist, which is why `<BACKUP_IMAGE_REF>` is `OWNED_BUILD_PENDING`. G5 and G8 are also outstanding. A backup that has not been restored is not a backup. | G5 and G8, after the uploader exists | — |

## Mandate §6 build items

| Item | State | Evidence | Owner action | Date |
|---|---|---|---|---|
| **§6.1** the environment loader, all six services, one ambient bridge, every missing entry in one message | `OBSERVED` | The L0 run above **is** this item's observation: the real process refused four entries in one message under three codes, and proceeded when they were restored. Held by 35+ tests, and the one-bridge property by a tree scan. | — | 2026-08-10 |
| **§6.2** the live transport adapter, both modes, offset after durable enqueue | `OBSERVED`, with its limit named | Constructed **in the real process** during L0 case B — the boot reaches `createLiveTelegramTransport` and enters the loop — and its mode-aware guard is the L1 observation above. **What is NOT observed is delivery**: this build wires a provider client whose two members refuse (`TELEGRAM_SEND_REFUSED`), so nothing has been fetched or sent. The at-least-once-becoming-effectively-once ordering is asserted against the offset in tests, not against a live re-delivery. | G3 placement, then G6 for the webhook mode | wiring + guard 2026-08-10; delivery — |
| **§6.3** the finance-agent entrypoint: refuses an incomplete environment, honours the sentinel, binds no public port in `longPoll` | `BLOCKED - awaiting build` | Two facts, and the second outranks the first. The **process behaviour** was observed: it booted, refused, opened its store, and bound nothing under `longPoll`. But **the entrypoint as packaged cannot be launched** — `node src/server/process/start.ts` answers `ERR_MODULE_NOT_FOUND`, and so do `npm start` and `npm run health` (**F20**). The L0 observation was taken with a resolve hook supplying exactly the resolution the project's toolchain performs. | — | behaviour 2026-08-10; launchability blocked |
| **§6.4** a Dockerfile per owned image, and a build path producing the tags compose references | `BLOCKED - awaiting build` | Three recipes exist (`finance-agent`, `signal-bus`, `scheduler`) and their ownership is recorded in `ops/IMAGE_BUILD.md`; `<BACKUP_IMAGE_REF>` is still `OWNED_BUILD_PENDING` on task 10.9. **No image has ever been built** — building one is outside this phase's permitted actions — and under F20 all three would produce containers that exit immediately. | — | — |
| **§6.5** wire the existing backup and restore scripts | `NOT STARTED` | Task **10.9**, unstarted. The scripts exist from Phase 7.4 and fix the tool set; the uploader their fourth step calls does not exist, so nothing has been wired and nothing has been run. | — | — |

## Findings this run

### F20 — no owned image can start: bare `node` cannot resolve an extensionless relative import

Every relative import under `src/` is written extensionless (`import { main } from './main'`). The
project's own toolchain resolves that (`moduleResolution: "bundler"`; Vite and Vitest search the same
way). **Node's ESM resolver performs no extension search**, so:

```
node src/server/process/start.ts
  → Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/server/process/main'
    imported from …/src/server/process/start.ts
```

It fails on the first import, before any environment is read, on every host, in every mode. Measured
against Node v24.14.1, the pinned major. The CommonJS route was probed too and does not help:
`require('./src/server/process/main')` answers `MODULE_NOT_FOUND`.

**What it blocks, exactly.** All three images this repository owns run source directly and name one of
these shims:

| Artifact | The line | Consequence |
|---|---|---|
| `ops/images/finance-agent/Dockerfile` | `ENTRYPOINT ["node", "/app/src/server/process/start.ts"]` | the container exits immediately |
| `ops/images/signal-bus/Dockerfile` | `ENTRYPOINT ["node", "/app/src/server/process/busStart.ts"]` | the container exits immediately — and both agents declare `depends_on: signalbus: service_healthy` |
| `ops/images/scheduler/Dockerfile` | `ENTRYPOINT ["node", "/app/src/server/process/schedulerStart.ts"]` | the container exits immediately |
| all three, plus the restore drill | `exec node /app/src/server/process/probe.ts "$@"`, and each service's `--health` command | every readiness command exits non-zero for a reason unrelated to readiness |
| `package.json` | `"start"`, `"health"` | both are unrunnable as written |

So rung **L2** is unreachable today for a reason that is **ours**, not the owner's: with G1, G3, G4, G5
and G8 all observed, `docker compose up` would still stand up nothing.

**Why it was not visible before.** Tasks 10.7, 10.19, 10.20 and 10.21 asserted these processes through
Vitest, which imports the modules through the project's resolver. That proves the process logic and
proves nothing about launching it. This is the difference §9's opening line is about: *a rung is not
passed because the code looks right.*

**Not fixed here, and deliberately.** The repair is a packaging decision with two candidate shapes — an
extension on every relative specifier in the graph (with `allowImportingTsExtensions`, currently
`false`), or a build step that emits runnable modules into the image — and it touches the three
Dockerfiles, `ops/IMAGE_BUILD.md`, `package.json` and possibly every module under `src/`. It belongs to
the task that owns the build path, with its own tests and its own commit. What this run did instead was
make the rung it blocks observable: `scripts/ladder/ts-resolve.mjs` restores **exactly** the one
resolution the project's toolchain performs and nothing else, so L0 could be observed against the real
`main`, the real loader and the real store in a real child process, with F20 recorded as its own finding
rather than mistaken for a loader defect.

### F19 confirmed, not new

The bot identity is a process **argument** (`--bot-id`), not an environment entry. L0 case B supplies it
on the command line and the boot proceeds; the loader refuses an absent or empty one with
`ENV_BOT_IDENTITY_EMPTY`. Recorded because the ladder is the first place it was exercised through the
real command line rather than through a test's injection.

## Mandate §5 — the definition of live, marked ruthlessly

Seven conditions. **Observed, not asserted**, and a condition about a *running deployment* is not
observed by a test that proves the logic it would need.

| # | Condition (§5) | Observed? | Why |
|---|---|---|---|
| 1 | Both bots answer the owner, and only the owner | **no** | No bot has answered anything. The refusal half is proven (L1), the answering half needs L3 |
| 2 | Two independent agent processes, each with its own store, key and bound; neither can reach the other's | **no** | **One** agent exists in this repository and the other is in the other repository, unbuilt. One process has been booted, on a developer machine, against a store in a temporary directory. Isolation is proven structurally and by tests; that is not two processes running on a host |
| 3 | Model routing works through the pinned slugs, honours the bound, and **refuses rather than overspends** | **no** | No live model call has ever been made from anywhere. The eligibility registry is still `provisional: true`, and a provisional registry may not promote a model for live routing. The refusal-at-bound path is unit-covered only |
| 4 | The consent bus carries a band, never a figure, and is reachable from neither the internet nor the proxy | **no** | The band-not-figure half is strong — it is a schema absence, and `ops/INTEROP_CONTRACT.md` now records it for both sides. The **reachability** half is a property of a running host, and no host is running |
| 5 | Kill switch works in both forms | **no** | Both forms are implemented and unit-covered, including the sentinel being re-read per call. Neither has been flipped against a running deployment |
| 6 | The placement map holds, and one **restore** has been exercised | **no** | Nothing is placed. No backup has been taken and no restore attempted; L5 needs the uploader task 10.9 owns |
| 7 | `npm run verify:all` is 20 of 20 and the tree is committed | **yes** | `npm run verify:all -- --all` → `verification harness: 20 of 20 executed checks passed` / `HARNESS PASSED: every acceptance check is green.`, with `AC14 working tree is clean` and `AC15 repository is push ready` both green, `AC04` at 2126 tests against a floor of 2126 |

**Count: 1 of 7 observed.** Six are not, and five of those six are not observed for the same underlying
reason — nothing is running anywhere — rather than for five different reasons.

## Appendix — verbatim transcripts

### L0

Command, run from the repository root:

```
node scripts/ladder/l0-config.mjs
```

```
NIZAM test ladder — rung L0 (config): the loader refuses an incomplete environment
entrypoint: node --import ./scripts/ladder/ts-resolve.mjs src/server/process/start.ts --bot-id ladder-bot
           (the hook is finding F20, not a convenience — see ts-resolve.mjs)

CASE A — four required entries broken at once:
  FINANCE_STORE_FILE: removed
  MODEL_ELIGIBILITY_REGISTRY_PATH: removed
  BUS_INTERNAL_ENDPOINT: emptied
  MAX_WORK_ITEMS: left as its template placeholder
  exit code: 1
  error stream:
    NIZAM environment: the finance service environment is not configured — 4 entries to fix, all of
    them named here so one restart answers the whole question: finance/FINANCE_STORE_FILE is not set,
    and this loader supplies no default [ENV_ENTRY_ABSENT]; finance/MAX_WORK_ITEMS still holds the
    angle-bracket placeholder its template ships with, so the template was copied but never filled in
    [ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER]; finance/MODEL_ELIGIBILITY_REGISTRY_PATH is not set, and this
    loader supplies no default [ENV_ENTRY_ABSENT]; finance/BUS_INTERNAL_ENDPOINT is set but empty, and
    an empty value is not a configured value [ENV_ENTRY_EMPTY]
    (node:32484) ExperimentalWarning: SQLite is an experimental feature and might change at any time

CASE B — the same environment with all four entries restored:
  observed the boot proceed: yes
  output stream (first line):
    {"at":"2026-08-10T11:55:09.512Z","level":"info","event":"store_opened","agent":"finance","correlationRef":null,"fields":{"storeLabel":{"kind":"enum","value":"finance"}}}
  error stream:
    (nothing)

L0 PASSED — refused four entries in one message with a non-zero exit, and proceeded when they were restored
```

The aggregate is wrapped above for width; it is one line on the stream. Two things in it are worth
naming rather than skimming: the four findings carry **three different codes**, so the message is a
classification and not a list; and case B's error stream is **empty**, which is what rules out a boot
that proceeded while still complaining.

**What the ladder run uses for values, and what it does not.** Every entry in
`scripts/ladder/l0-config.mjs` is a self-evident non-value (`ladder-not-a-token`, `ladder-not-a-secret`,
`ladder-not-a-key`, a bus name of `ladder-bus`, and a base whose suffix is permanently reserved and
resolves to nothing). No token, key, host or identifier of the deployment is read, written or invented,
nothing is committed with a value in it, and the store is created in a temporary directory outside the
tree and removed at the end. **No outbound call is made in either case**, because this build's live
provider client refuses by construction: the entrypoint wires `fetchUpdates` and `sendMessage` to throw
`TELEGRAM_SEND_REFUSED` until gates G3 and G6 supply the real one.

### L1

Command, run from the repository root:

```
npx vitest run src/server/telegram/modeAwareGuard.negative.test.ts
```

```
 ✓ src/server/telegram/modeAwareGuard.negative.test.ts (25 tests) 13650ms
   ✓ longPoll: the allowlist is the whole guard (R26) > refuses that SAME delivery under webhook, so the two modes are not one path 340ms
   ✓ longPoll: the allowlist is the whole guard (R26) > refuses EVERYONE under an empty allowlist, including the otherwise-authorised sender 1144ms
   ✓ longPoll: the allowlist is the whole guard (R26) > refuses an empty sender identifier, which is nobody rather than everybody 335ms
   ✓ longPoll: the allowlist is the whole guard (R26) > does not consult the token gate, so an unusable expected token still admits the owner 3119ms
   ✓ webhook is NOT relaxed by the mode axis — the regression fence (R11, R26) > still refuses every request when the expected token is absent, header echoing it or not 564ms
   ✓ webhook is NOT relaxed by the mode axis — the regression fence (R11, R26) > still refuses every request when the expected token is null, header echoing it or not 528ms
   ✓ webhook is NOT relaxed by the mode axis — the regression fence (R11, R26) > still refuses every request when the expected token is empty, header echoing it or not 504ms
   ✓ webhook is NOT relaxed by the mode axis — the regression fence (R11, R26) > still refuses every request when the expected token is over-length, header echoing it or not 950ms
   ✓ webhook is NOT relaxed by the mode axis — the regression fence (R11, R26) > still refuses every request when the expected token is out-of-charset, header echoing it or not 363ms
   ✓ webhook is NOT relaxed by the mode axis — the regression fence (R11, R26) > still refuses an absent, an empty and a wrong header under a usable expected token 736ms
   ✓ webhook is NOT relaxed by the mode axis — the regression fence (R11, R26) > still refuses an unlisted sender carrying the correct token 429ms
   ✓ webhook is NOT relaxed by the mode axis — the regression fence (R11, R26) > keeps all three gates consulted, so no gate became unreachable 952ms
   ✓ the same update twice produces ONE effect, in both modes (R26.1, R13) > is deduped on the (bot, update) pair under webhook 310ms
   ✓ the same update twice produces ONE effect, in both modes (R26.1, R13) > is deduped on the (bot, update) pair under longPoll 357ms
   ✓ the same update twice produces ONE effect, in both modes (R26.1, R13) > keeps the per-bot half of the key under longPoll, so two bots do not collide (R14) 424ms
   ✓ longPoll: a crash BEFORE the enqueue commits re-delivers rather than loses (R26.1, D2) > leaves the offset where it was, then enqueues exactly once on the next poll 330ms
   ✓ the decision type still has nowhere to put a reason (R26, §5.2) > returns the one accept-path rejected value in both modes 1129ms

 Test Files  1 passed (1)
      Tests  25 passed (25)
   Duration  18.85s (transform 1.11s, setup 1.15s, collect 1.55s, tests 13.65s, environment 0ms, prepare 508ms)
```

Vitest prints the seventeen `describe`-grouped names above for twenty-five cases, because five of them
are table-driven over a shape set. The count that matters is the summary line: **25 passed**.

### The harness, for §5 condition 7

```
npm run verify:all -- --all
```

```
verification harness: 20 of 20 executed checks passed
HARNESS PASSED: every acceptance check is green.
```

---

Nothing is live: no host is hardened, no container has ever started and no bot has answered — what
exists is a finance agent that boots, refuses an incomplete environment correctly and opens its store on
a developer machine, two new cross-repository contracts, and 2126 green tests.

The single next blocking action is **ours, not the owner's**: fix **F20**, because until bare `node` can
start the three shims, a fully gated host still stands up nothing — and only then does G1 hardening
become the owner's next step.

**1 of 7** of mandate §5's conditions is observed: condition 7, the harness at 20 of 20 with a committed
tree. Six are not, and five of the six for one reason — nothing is running anywhere yet.
