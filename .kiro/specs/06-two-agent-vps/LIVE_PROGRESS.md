# LIVE PROGRESS — two-agent VPS tier

> Authority and shape: `KIRO_SHIP_LIVE.prompt.md` §10. This file is the progress record, it is
> **cumulative**, and it is rewritten after each run so the owner sees movement without reading a
> transcript.
>
> **State is exactly one of** `OBSERVED`, `BLOCKED - awaiting human`, `BLOCKED - awaiting build`,
> `NOT STARTED`. **Evidence is mandatory for `OBSERVED`**: the command run and what it returned. A row
> with no evidence is `NOT STARTED` no matter how finished the code looks.
>
> **This version covers the test ladder only** (task 10.12, the §9 rungs). Task 10.14 adds the rows for
> gates G1-G8 and for each §6 build item, and the three closing lines. Nothing below is asserted from
> reading code: every `OBSERVED` row names a command that was run and what came back, and the verbatim
> transcripts are in the appendix.

## The test ladder (§9)

| Item | State | Evidence | Owner action | Date |
|---|---|---|---|---|
| **L0 config** — the loader refuses an incomplete environment | `OBSERVED` | `node scripts/ladder/l0-config.mjs` → `L0 PASSED`, exit 0. Case A broke **four** entries at once (two removed, one emptied, one left holding its template placeholder) and the real entrypoint exited **1** having written ONE aggregate naming all four with a per-entry code: `4 entries to fix … finance/FINANCE_STORE_FILE … [ENV_ENTRY_ABSENT]; finance/MAX_WORK_ITEMS … [ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER]; finance/MODEL_ELIGIBILITY_REGISTRY_PATH … [ENV_ENTRY_ABSENT]; finance/BUS_INTERNAL_ENDPOINT … [ENV_ENTRY_EMPTY]`. Case B restored all four and the boot **proceeded**: `{"level":"info","event":"store_opened","agent":"finance",…}` on the process's own output stream, empty error stream. | — | 2026-08-10 |
| **L1 guards** — both modes, both directions | `OBSERVED` | `npx vitest run src/server/telegram/modeAwareGuard.negative.test.ts` → `Test Files 1 passed (1)`, `Tests 25 passed (25)`, 18.85s. Covers `longPoll` refusing an unlisted sender, an empty allowlist and an empty sender identifier while **accepting the owner with no secret-token header**; the same delivery still refused under `webhook`; the `webhook` fence over five unusable expected-token shapes × three header states; dedup on the `(bot, update)` pair in **both** modes including the per-bot collision; and the crash-before-enqueue case asserted against the offset. | — | 2026-08-10 |
| **L2 compose** — the stack stands up | `BLOCKED - awaiting build` | Not run, and not attemptable: **finding F20** below. The earliest blocker is this repository's, not the owner's — every one of the three owned images invokes a shim with bare `node`, and bare `node` cannot start any of them. The owner's gates G1, G3-placement and G4 are also outstanding, and they are behind F20 rather than in front of it. | G1 host hardening and the six env files at `/etc/<CONFIG_DIR>` — but F20 must clear first, or a hardened host still starts nothing. | — |
| **L3 transport** — both bots reachable | `BLOCKED - awaiting human` | Not run. Needs L2 (so F20), then G3 **placement**: `BOT_B_TOKEN` and `ALLOWED_USER_IDS` in `finance.env` on the host. Both bots already exist and were verified live, so creation is the finished half of G3. Under the authorised option **(b)** phase 1 reaches **one** bot: the finance agent on bot B, with bot A created, hardened and idle. | G3 placement, per `OWNER_GATE_ACTIONS.md` | — |
| **L4 routing and safety** — money and halt | `BLOCKED - awaiting human` | Not run. Needs L3, then G4: two provider keys with a per-agent weekly limit. The refusal-at-cap logic, the deterministic-alert guarantee and both halt forms are implemented and unit-covered, which is **not** what this rung asks for — it asks for a turn that routed, a spend that was recorded, and a sentinel that stopped a live call. | G4 two keys, per `OWNER_GATE_ACTIONS.md` | — |
| **L5 durability** — the off-host copy is real | `BLOCKED - awaiting build` | Not run. Task **10.9** is open: `ops/backup/backup.sh` step four calls the `nizam-backup` uploader, and that uploader does not exist, which is why `<BACKUP_IMAGE_REF>` is `OWNED_BUILD_PENDING` in `ops/IMAGE_BUILD.md`. G5 and G8 are also outstanding, and the build blocker comes first. A backup that has not been restored is not a backup. | G5 consent screen published to production, G8 the `age` keypair | — |

**Rung order was honoured.** §8 step 8 says to stop at the first rung that fails. L0 failed on its
first run for a reason that was not the loader's — see F20 — and was re-run to a pass once the rung
could be launched at all. L2 is the first rung that cannot be *attempted*, and nothing above it was
simulated, asserted from code, or marked passed.

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

It fails on the first import, before any environment is read, on every host, in every mode.
Measured against Node v24.14.1, the pinned major. The CommonJS route was probed too and does not
help: `require('./src/server/process/main')` answers `MODULE_NOT_FOUND`.

**What it blocks, exactly.** All three images this repository owns run source directly and name one of
these shims:

| Artifact | The line | Consequence |
|---|---|---|
| `ops/images/finance-agent/Dockerfile` | `ENTRYPOINT ["node", "/app/src/server/process/start.ts"]` | the container exits immediately |
| `ops/images/signal-bus/Dockerfile` | `ENTRYPOINT ["node", "/app/src/server/process/busStart.ts"]` | the container exits immediately — and both agents declare `depends_on: signalbus: service_healthy` |
| `ops/images/scheduler/Dockerfile` | `ENTRYPOINT ["node", "/app/src/server/process/schedulerStart.ts"]` | the container exits immediately |
| all three, plus the restore drill | `exec node /app/src/server/process/probe.ts "$@"`, `… start.ts --health`, `… busStart.ts --health`, `… schedulerStart.ts --health` | every readiness command exits non-zero for a reason unrelated to readiness |
| `package.json` | `"start"`, `"health"` | both are unrunnable as written |

So rung **L2** is unreachable today for a reason that is **ours**, not the owner's: with G1, G3, G4,
G5 and G8 all observed, `docker compose up` would still stand up nothing.

**Why it was not visible before.** Tasks 10.7, 10.19, 10.20 and 10.21 asserted these processes through
Vitest, which imports the modules through the project's resolver. That proves the process logic and
proves nothing about launching it. This is the difference §9's opening line is about: *a rung is not
passed because the code looks right*.

**Not fixed here, and deliberately.** The repair is a packaging decision with two candidate shapes —
an extension on every relative specifier in the graph (with `allowImportingTsExtensions`), or a build
step that emits runnable modules into the image — and it touches the three Dockerfiles, the build
record and possibly every module under `src/`. It belongs to the task that owns the build path, with
its own tests and its own commit. What this run did instead was make the rung it blocks observable:
`scripts/ladder/ts-resolve.mjs` restores **exactly** the one resolution the project's toolchain
performs and nothing else, so L0 could be observed against the real `main`, the real loader and the
real store in a real child process, with F20 recorded as its own finding rather than mistaken for a
loader defect.

### F19 is confirmed, not new

The bot identity is a process **argument** (`--bot-id`), not an environment entry. L0 case B supplies
it on the command line and the boot proceeds; the loader refuses an absent or empty one with
`ENV_BOT_IDENTITY_EMPTY`. Recorded here because the ladder is the first place it was exercised through
the real command line rather than through a test's injection.

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
resolves to nothing). No token, key, host or identifier of the deployment is read, written or
invented, nothing is committed with a value in it, and the store is created in a temporary directory
outside the tree and removed at the end. **No outbound call is made in either case**, because this
build's live provider client refuses by construction: `main.ts` wires `fetchUpdates` and `sendMessage`
to throw `TELEGRAM_SEND_REFUSED` until gates G3 and G6 supply the real one.

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
