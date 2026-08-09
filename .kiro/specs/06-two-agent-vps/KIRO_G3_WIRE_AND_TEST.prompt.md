# KIRO task prompt - wire and test the Telegram transport against the now-verified G3 state

> **How to use this file:** open a Kiro session on this repository and give it exactly one instruction:
> "Read and execute `.kiro/specs/06-two-agent-vps/KIRO_G3_WIRE_AND_TEST.prompt.md`." Do not paraphrase
> the task into the chat. The file is the task.
>
> **Spec:** `.kiro/specs/06-two-agent-vps`. **Contract:** PFOS 12 sections 5 and 6.
> **Steering precedence:** `.kiro/steering/pfos-current.md` first, then `two-agent-vps.md`, then the rest.
> **Public repository (R24):** this file names no bot, no identifier, no token, no domain, and no host.
> Every real value lives in an untracked file or on the host. Keep it that way.

---

## 0. Role and boundary

You are wiring the code path that consumes gate G3's output. You are **not** running a gate, not creating
a bot, not registering a webhook, and not making any outbound network call from any process you write or
run. `ops/GATE_REGISTER.md` is the operator's, and steering section 2 gates every outbound call from a
server process. Everything below is buildable offline behind an injected port with a deterministic mock,
which is the house pattern already in place.

**First action, before reading anything else:** run `git status --porcelain`. A second agent session has
been active in this repository. If the tree is dirty with work that is not yours, stop and report the
paths rather than committing on top of them. Two writers on one file is how a correction gets clobbered.

Second action: run `npm run verify:all -- --all` and record the baseline. If it is not `20 of 20`, report
which check fails and whether it is the dirty tree (AC14/AC15) or something real, and stop if it is real.

## 1. Read these, in this order

1. `.kiro/steering/pfos-current.md`, then `.kiro/steering/two-agent-vps.md`.
2. `.kiro/specs/06-two-agent-vps/OPERATOR_STATE_2026-08-09.md` section 4 - the verified G3 state and the
   two obligations still open.
3. `.kiro/specs/06-two-agent-vps/TELEGRAM_VALUE_LEDGER.md` - every transport entry, its owning file, its
   gate, and its secret flag. This is your input contract.
4. `docs/TELEGRAM_BOTS_SETUP_G3.md` sections 7 and "Findings" - what was verified live, and F1/F2/F3.
5. `ops/env/life.env.example`, `ops/env/finance.env.example`, `ops/env/proxy.env.example` - the exact
   entry names. These are authoritative over any table.
6. `src/server/ops/envTemplates.ts` - `ENV_ENTRIES` (owners, gate, secret) and the declared bindings from
   entry name to port field.
7. `src/server/ports/telegram.ts` and `src/server/telegram/auth.ts` - the interfaces and the guard you
   are wiring, and the fail-closed rules you must not weaken.
8. `ops/Caddyfile` and `ops/docker-compose.yml` - the route shape and the service topology.
9. `outputs/BOT_SETUP_WORKSHEET.local.md` (untracked, operator machine) - the only place the real
   identifiers live. **Read it if you need to understand shape. Never copy a value out of it into a
   tracked file, a test, a fixture, or a commit message.**

## 2. Ground truth you may rely on, and must not re-litigate

Verified live against the provider on 2026-08-09 23:57 and again on 2026-08-10 00:03, recorded in the
operator state:

- Two bot identities exist, they authenticate, and their numeric ids differ. The per-bot de-duplication
  key `(botId, updateId)` therefore has two distinct values in production, as `ports/telegram.ts`
  section 5.4 requires.
- Both bots report `can_join_groups: false` and `can_read_all_group_messages: false`.
- **No webhook is registered on either bot** (`getWebhookInfo.url` is empty on both), so G6 has not run
  and the long-poll path is currently the only one a live deployment could use.
- The operator's allowlist identifier has been read and is recorded, untracked. Exactly one operator.
- **Both bot tokens are disclosed and unrotated.** Nothing you build may depend on the current values,
  and no test may embed one.

## 3. What is missing, and is yours to build

All four are offline, testable behind mocks, and blocked on nothing.

### 3.1 The environment loader - the real gap

`process.env` appears in **no** non-test file under `src/`. Nothing reads the environment, so every entry
in the ledger is declared and unconsumed, and the string-to-array shape of the allowlist is undecided.

Build a loader that resolves `TelegramTransportConfig` from the environment, with these properties, each
of which gets its own test:

- **No default for anything.** An unset entry is a startup failure with a named error, never a guess.
  An unconfigured guard must not be an open door (contract 12 sections 5.2, 5.3).
- **`ALLOWED_USER_IDS`**: parse to `readonly string[]`. Empty, whitespace-only, or absent yields an empty
  array, and an empty array must refuse **every** sender - `senderIsAllowlisted` already does this, so
  assert the composition, not just the parser.
- **`TELEGRAM_MODE`**: accept only the two literals `TELEGRAM_TRANSPORT_MODES` declares. Anything else is
  a startup failure, including a case variant.
- **`MAX_WORK_ITEMS`**: a positive integer. Zero, negative, non-numeric and absent all fail.
- **The expected secret token** is passed straight to `secretTokenIsConfigured`; do not re-implement its
  charset or length rules, and do not soften them.
- The loader never logs a value. Presence may be logged as a boolean; a value never is.

**D-ALLOWLIST is an owner decision you must record, not invent.** The operator's interim shape is a single
bare digit run with no quotes, brackets or spaces. Specify the delimiter as a superset of that shape,
write it into `requirements.md` as an EARS criterion plus a short decision note naming the alternatives
you rejected, and flag it in your report as awaiting owner confirmation. Do not silently pick a format.

### 3.2 The live transport adapter, behind the existing port

Implement `TelegramPort` against the real provider API for both modes the port declares, `webhook` and
`longPoll`, with the same guards on both paths. Constraints:

- The adapter is a **separate, later, gated module**. It must not be imported by the app bundle, by
  `App.tsx`, or by the router (AC05/AC06 and the isolation rule).
- Every request goes through `authorizeDelivery` before anything parses `rawBody`.
- `accept` stays synchronous. Nothing slow may precede the acknowledgement.
- **No live call in any test.** Use a recorded or injected transport double. A test that reaches the
  network is a failed test even when it passes.
- Long-poll is the mode that works today, since no webhook is registered. Treat it as the reachable path
  and webhook as the one G6 will enable.

### 3.3 The finance-agent process entrypoint (finding O1)

There is no process that listens on `FINANCE_CONTAINER_PORT`. `src/server/telegram/index.ts` is a barrel
re-export, not a main. Build an entrypoint that boots an HTTP listener on the configured port, wires
`acceptHandler` and `workerRunner`, exposes the health endpoint the orchestrator restarts on, honours the
kill sentinel and `NIZAM_KILL_ALL` before any model call or bus publish, and reads every value through the
loader in 3.1. Add the server dependency this needs; keep it out of the browser bundle.

### 3.4 A Dockerfile per image the compose file references

`ops/docker-compose.yml` names six images as placeholders and nothing in-repo builds any of them. Produce
the Dockerfiles this repository owns. **Do not touch `ops/**` filenames without reading trap 1 below.**

## 4. Tests you must add

- The loader's fail-closed matrix: for each entry, absent / empty / malformed / valid.
- Composition: an empty allowlist refuses a sender that would otherwise be authorised.
- An unconfigured expected token refuses a request that carries the correct token.
- Mode selection: both modes construct, an unknown mode fails at startup.
- The five negative cases already automated in `negativeGuards.test.ts`, re-run through the new adapter
  and the loader rather than through hand-built config objects.
- The entrypoint: it refuses to boot with an incomplete environment, and it honours the sentinel.
- **Every test uses synthetic values.** No real token, identifier, bot name, host or domain in any test or
  fixture. A fixture is the worst possible place for one; `src/server/mocks/fixtures/**` is scanned.

## 5. Traps that will cost you a red gate

1. **`ops/**` is scanned for declared dotted tokens.** If any file under `ops/` names a new filename, add
   that token to `DECLARED_DOTTED_TOKENS` in `src/server/ops/deploymentParticulars.ts` **and** its sibling
   list in `./patchSeries`, or AC18 fails with `DOTTED_TOKEN_UNDECLARED`. The reverse also fails: a
   declared token no longer present in the tree is `DECLARED_TOKEN_UNUSED`.
2. **AC04 has a test-count floor** in `scripts/verify/all.mjs` (`--min`, currently 1757). Ratchet it to
   (new total minus 2) in the same commit that adds tests.
3. **AC11 scans every tracked text file** for organisation-specific terms. The denylist is assembled from
   fragments inside `scripts/verify/generic-only.mjs`; run that check before `git add`.
4. **AC10** requires a contract and phase reference in the first 20 lines of every file under `src/` and
   `tests/`.
5. **AC14 and AC15** need a clean tree. If the other session is writing, your green run is not reproducible
   until it stops. Report that rather than committing its work.
6. Do not weaken a guard to make a test pass. A gate that can be satisfied by weakening it was not a gate.

## 6. Loop and definition of done

```
spec/design -> implement -> npm run typecheck -> npm run lint -> npm test
  -> npm run verify:all -- --all        (must print "20 of 20 executed checks passed")
  -> tick .kiro/specs/06-two-agent-vps/tasks.md
  -> append a section to contracts/pfos/_PFOS_BUILD_LOG.md
  -> commit; push to master only when the owner says so
```

Done means all of:

- The loader exists, nothing in `src/` reads `process.env` outside it, and every entry in the ledger is
  either consumed by it or explicitly declared out of scope with a reason.
- The adapter implements both modes behind the port, with no network call in any test.
- The entrypoint boots on the configured port and refuses an incomplete environment.
- A Dockerfile exists for every image this repository owns in the compose file.
- `20 of 20` on a clean tree.
- Your report names: the D-ALLOWLIST shape you specified and why, anything in the ledger you could not
  consume, and any place where the register or the ledger disagreed with the code. If they disagree, the
  register and the templates win and you report the discrepancy rather than reconciling it silently.

## 7. What you must not do

Create or rotate a bot. Register or delete a webhook. Read or move a token. Call the provider, the model
provider, or the storage provider. Write any real identifier into a tracked file. Tick a gate. Change a
`Status:` line in `ops/GATE_REGISTER.md` to anything other than `BLOCKED - awaiting human`. Mark a gated
item complete: that converts a known gap into an invisible one, and it is the single most damaging thing
possible here.
