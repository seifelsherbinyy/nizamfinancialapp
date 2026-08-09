# Tasks - Two-Agent VPS Tier

> Tick as the loop completes each. Append a section to `contracts/pfos/_PFOS_BUILD_LOG.md` per phase.
> Gate after EVERY phase: `npm run verify:all -- --all` must pass all checks. Never advance on a red gate.
> Steering: `.kiro/steering/two-agent-vps.md`. Requirements/design: this folder.

## Phase 0 - Authorize and author (no code)
- [x] 0.1 Confirm `.kiro/steering/two-agent-vps.md` is signed off by the owner. If not, STOP and ask.
- [x] 0.2 Author `contracts/pfos/06_PFOS_Database_and_Knowledge_Model.md` (NIZAM-derived, marked as such)
- [x] 0.3 Author `contracts/pfos/12_PFOS_Two_Agent_VPS_Deployment_and_Operations.md`
- [x] 0.4 Update `_PFOS_CONTRACT_INDEX.md` + build log so **AC12** still agrees
- [x] 0.5 Create `ops/GATE_REGISTER.md` seeded with G1-G8 from steering §2

## Phase 1 - Data layer (Contract 06) → R1-R5
- [x] 1.1 `src/server/db/` schema + migrations on `node:sqlite`, WAL, `foreign_keys=ON`, idempotent versioning
- [x] 1.2 Repositories for accounts/transactions/obligations/decisions reusing existing types
- [x] 1.3 Integer-milliunit boundary guard (reject non-integer at persist) + parity test vs the browser engines (R4)
- [x] 1.4 Token-spend ledger keyed by agent; weekly total as a pure function feeding `modelPolicy` (R5)
- [x] 1.5 Negative tests: non-integer money rejected; migration re-run is a no-op; cross-agent DB open fails

## Phase 2 - Ports and mocks → foundation for everything gated
- [x] 2.1 `src/server/ports/` interfaces: TelegramPort, OpenRouterPort, DrivePort, WhoopPort, SignalBusPort
- [x] 2.2 Deterministic mock per port + a recorded-fixture loader
- [x] 2.3 Assert `src/server/**` is absent from the browser bundle (extend the existing isolation check)

## Phase 3 - Signal bus and the consent boundary → R7-R10
- [x] 3.1 Vendor the signal envelope schema; validation module; no field can carry a figure or long text
- [x] 3.2 Consent gate: `producer_only` refused; tier check; de-identification assertions
- [x] 3.3 Append-only store + audit mirror; internal-only binding documented in ops
- [x] 3.4 Negative tests: figure in payload rejected; `producer_only` refused; over-length text rejected;
      `strict_local_maximum` reference rejected

## Phase 4 - Telegram transport (mocked) → R11-R15
- [x] 4.1 Port `auth` logic from `nizamcore/relay/auth.py`: constant-time token compare + allowlist
- [x] 4.2 SQLite dedup keyed `(bot_id, update_id)` UNIQUE + `INSERT OR IGNORE` (fixes collision + race)
- [x] 4.3 Accept-fast / process-async handler with a work queue
- [x] 4.4 Negative tests: missing token, wrong token, non-allowlisted user, duplicate update, and
      **two bots emitting the same update id must both be processed**

## Phase 5 - Routing, spend, telemetry → R16-R19
- [x] 5.1 Turn classifier (rules-first) producing T0-T4; T0 provably invokes no model
- [x] 5.2 Router/scorer consuming `modelPolicy` + the eligibility registry; refuse a `provisional` registry
- [x] 5.3 Telemetry store: actual reported cost, tokens, latency, schema validity; **no prompt text**
- [x] 5.4 Negative tests: cap exhausted refuses one agent and not the other; deterministic alerts still fire;
      T0 never calls a model; provisional registry cannot promote

## Phase 6 - Benchmark Phase-1 (dev-key carve-out, steering §3)
- [x] 6.1 Complete the eval set toward the >=210-case bar; sanitized cases only
- [x] 6.2 Run against recorded fixtures; emit `model_eligibility_registry.json` marked `provisional: true`
- [x] 6.3 IF the dev key is present and within its cap: run live from the dev machine only, emit a
      non-provisional registry. ELSE leave provisional and record it in the gate register.
      **Closed on the ELSE branch: no live call was made.** The live path (`preflight.ts`,
      `liveModelCaller.ts`, `liveRegistry.ts`) is built and tested against a deterministic transport;
      the registry stays `provisional: true` and the determination is recorded in `ops/GATE_REGISTER.md`.

## Phase 7 - Ops artifacts (TEXT ONLY, never executed) → R20-R22
- [x] 7.1 `ops/docker-compose.yml` with per-service resource limits/reservations + healthchecks + internal network
- [x] 7.2 `ops/Caddyfile` with the two hosts and secret webhook paths
- [x] 7.3 `ops/env/*.env.example` for life/finance/scheduler/backup - placeholders only
- [x] 7.4 `ops/backup/` consistent-snapshot + public-key-encrypt + shred; `ops/restore/` with integrity check
- [x] 7.5 Health endpoints + structured redacted logging + log rotation config
- [x] 7.6 Rollback and disaster-recovery runbook; rate-limit posture per Telegram's documented limits

## Phase 8 - Cross-repo handoff (steering §6)
- [x] 8.1 `ops/nizamcore-patches/001-fastapi-wrapper.patch` (wrap `handle_update`, add health endpoint)
- [x] 8.2 `ops/nizamcore-patches/002-dedup-per-bot.patch`
- [x] 8.3 `ops/nizamcore-patches/003-signalbus-egress-target.patch`
- [x] 8.4 `ops/nizamcore-patches/README.md`: apply order, expected test deltas, how to verify
      **Form:** all three are explicitly-labelled **change specifications, not applicable unified
      diffs** - the other repository was never read, so there are no verified context lines and no
      blob hashes, and none were invented. Held to that by `src/server/ops/patchSeries.ts` (55
      finding codes, each with a negative case). The other repository was not cloned, fetched, read,
      modified or pushed.

## Phase 9 - Close out
- [x] 9.0 Add a harness check: no deployment particular in `ops/**` or any fixture (steering §0b) - no bare
      domain, IP, Drive id, numeric Telegram id, or real monetary figure. Must fail closed.
      **Form:** a TWENTIETH named check, `AC18 no deployment particular in ops or any fixture`, not an
      extension of AC08b - the constraint recorded at `_PFOS_BUILD_LOG.md` §Phase 2 is closed on
      **option 2**, and every document asserting the current gate figure moved to 20/20 in this same
      increment. R24 keeps ONE implementation: `scanForParticulars` is injected into
      `src/server/ops/deploymentParticulars.ts`, never re-derived. Two further bans hold over
      `src/server/**` per steering §4.1.
- [x] 9.1 Raise the `AC04 --min` floor to the new test count
      Ratcheted 331 -> 1757, the count proven by the `npm run test` run at the end of this increment
      (1757 passing across 101 files). Up only, never down.
- [x] 9.2 Gate passes all checks; commit and push each green increment
      **Verified, not asserted.** After `git fetch origin master`, each of this spec's seven increments
      was tested with `git merge-base --is-ancestor <commit> origin/master`: `0392d1d`, `b5ff8c4`,
      `b0af379`, `2b31bd0`, `5f70139`, `7e7cb58`, `5d3d18c` - all seven are ancestors of
      `origin/master`, so none is unpushed. `git status --porcelain` empty. The per-increment harness
      results are recorded in `contracts/pfos/_PFOS_BUILD_LOG.md`, and the table is in
      `FINAL_REPORT.md` §6.
- [x] 9.3 `ops/GATE_REGISTER.md` complete: every human step with exact commands and a verification line
      **Two halves.** The first reconciled the register against the Phase 7 artifacts (commit
      `7e7cb58`). The second added the checker that holds it there: `src/server/ops/gateRegister.ts`
      plus `gateRegister.test.ts`, twenty finding codes, a negative case per code, and two cross-reads
      that are asserted to have examined a non-zero number of items - every gate-attributed entry in
      `ops/env/**` against the gate `ENTRY_SPECS` attributes it to, and every repository path the
      register quotes against the disk. It found two defects the first half's re-reading did not:
      G3's allowlist entry and G4's life-agent key were placed by a step and verified by nothing.
      Both now carry a counting line.
- [x] 9.4 Final report: what is built, what is gated, and the single next human action
      `.kiro/specs/06-two-agent-vps/FINAL_REPORT.md`. Six sections: what is built phase by phase with
      the per-artifact checker table; what is proven and how - **static rehearsal**, nothing executed;
      what is gated (G1-G8, G7 closed WONT-DO, every open gate still `BLOCKED - awaiting human`, none
      attempted); **exactly one** named next human action, **G1**, pointing at its section in
      `ops/GATE_REGISTER.md`; the honest limits carried forward unsoftened from the build log; and the
      19 → 20 check count change with the documents that moved with it.

## Phase 10 - Ship live on long-poll (owner mandate `KIRO_SHIP_LIVE.prompt.md` rev 2, 2026-08-10)
> Authority: that prompt carries owner authority and rules on seven decisions (D-ROTATE, F11, D-CAP,
> D-WAL, D-BENCH, D-ALLOWLIST, D-G5). Its §2 is the unlock: **phase 1 ships on `longPoll`**, so G2, G6
> and the whole proxy path are **deferred, not cancelled**. Do not run `setWebhook`, create a DNS
> record, or publish a host port in this phase.
> Gate after every task: `npm run verify:all -- --all` at 20 of 20. Test floor ratchets up only.

- [x] 10.0 Author the requirements this phase adds - **R26** mode-aware delivery authorization
      (`longPoll` has no secret-token header, so the check is not applicable and the allowlist is the
      whole guard; `webhook` keeps refusing an absent/empty/over-length/out-of-charset token
      unchanged); **R27** the environment loader covers all six services and still names every
      missing entry at once from a single `process.env` bridge; **R28** every image the repository
      owns has a Dockerfile and a build path producing the tag compose references (closes **O1**);
      **R29** the finance-agent process refuses to boot on an incomplete environment, honours the
      kill sentinel, and binds no public port in `longPoll`; **R30** the host firewall and the compose
      port bindings must agree (closes **F12**). Record the design delta in `design.md`.
- [x] 10.1 Reconcile the two steering files so they stop disagreeing (§8 step 1, §1): add the
      read-only carve-out to `.kiro/steering/two-agent-vps.md` §2 and cite it as the resolution of
      **F11** (reads free, mutations owner-in-the-loop); edit `.kiro/steering/cloudflare-dns.md`
      item 3 to record the **D-ROTATE** deferral so no later session rotates unilaterally.
- [-] 10.2 Extend `src/server/config/environment.ts` from the two agents to all six services
      (life, finance, proxy, bus, scheduler, backup), keeping both proven properties: one
      `process.env` bridge in the whole of `src/`, and every missing entry named in one message.
      Tests included. (§6.1, R27)
- [ ] 10.3 Emit **one** fill-in sheet: every entry the owner must supply, grouped by env file, each
      with its gate, its `secret` flag, and its proof command. One pass, not six round trips.
      (§8 step 3)
- [ ] 10.4 Write `.kiro/specs/06-two-agent-vps/DEPLOYMENT_VALUE_LEDGER.md` extending
      `TELEGRAM_VALUE_LEDGER.md`'s 14 transport entries to all six services (§4): no entry has a
      default; negative rows asserted with `grep -c` -> 0 (no finance secret in the life file, no
      bot token or webhook secret in the proxy file, no webhook path in either agent file); shared
      entries asserted equal where shared (`LIFE_CONTAINER_PORT`, `FINANCE_CONTAINER_PORT`,
      `ALLOWED_USER_IDS` in both agent files); `KILL_SENTINEL_PATH` identical in all four honouring
      files and resolving inside the `kill-switch` mount; and a recorded home for `MAX_CONNECTIONS`
      (**F2**) - irrelevant in `longPoll`, homed in phase 2.
- [ ] 10.5 Live transport adapter behind the existing `TelegramPort`, implementing both modes (§6.2,
      §2, R26). In `longPoll` the offset advances **only after the update is durably enqueued** -
      that ordering is at-least-once becoming effectively-once.
- [ ] 10.6 Negative tests for both directions of the mode-aware guard (ladder **L1**): `longPoll`
      refuses an unlisted sender and accepts the owner with no secret-token header; an empty
      allowlist still refuses everyone; `webhook` still refuses absent, empty, over-length and
      out-of-charset tokens; the same update twice produces one effect in both modes.
      **Do not relax the webhook path to let one code path serve both.**
- [ ] 10.7 Build the finance-agent entrypoint (§6.3, R29). `src/server/telegram/index.ts` is a
      barrel, not a main: add a process that wires `acceptHandler` + `workerRunner` +
      `routing/turnDispatch`, refuses to boot on an incomplete environment, and honours the sentinel.
      Binds no public port in `longPoll`; listens on `FINANCE_CONTAINER_PORT` in `webhook`.
- [ ] 10.8 A Dockerfile per image this repository owns, plus a build path producing the tags compose
      references (six `<*_IMAGE_REF>` placeholders today build nothing - **O1**). Decide and record
      the **F12** resolution: publish 80 as a second port on `caddy`, **or** rely on TLS-ALPN-01 on
      `<TLS_PORT>` alone and state in `ops/GATE_REGISTER.md` that 80 is then not required. The
      firewall and the port bindings must agree. (R28, R30)
- [ ] 10.9 Wire the **existing** `ops/backup/backup.sh` and `ops/restore/restore.sh`. Do not write a
      second backup mechanism; if they need a change, change them. (§6.5)
- [ ] 10.10 Add the per-agent weekly cap companion the code lacks: **D-CAP** is a hard USD 5.00 per
      week **in total**, two keys at **2.50** each. `WEEKLY_BUDGET_USD = 5` stays as the total.
- [ ] 10.11 Tell the owner exactly which gate steps to perform, with the command for each: **G1**
      hardening plus `/etc/<CONFIG_DIR>`; **G4** two keys at 2.50 with training opt-out; **G5** with
      the consent screen published to production (**D-G5**); **G8** the `age` keypair.
      (§8 step 7 - an instruction sheet, never an attempt)
- [ ] 10.12 Run the test ladder, stopping at the first rung that fails (§9). **L0** config refusal and
      **L1** guards are runnable now. **L2** compose, **L3** transport, **L4** routing and safety are
      `BLOCKED - awaiting human` until G1/G3-placement/G4 clear. Record each rung's observation.
- [ ] 10.13 Exercise backup and **one** restore (**L5**). A backup that has not been restored is not a
      backup - `ops/runbook/DISASTER_RECOVERY.md` makes the drill the prerequisite, not the recovery.
      `BLOCKED - awaiting human` on G5 + G8.
- [ ] 10.14 Write and keep current `.kiro/specs/06-two-agent-vps/LIVE_PROGRESS.md` (§10): one row per
      gate G1-G8, per ladder rung L0-L5, and per §6 build item; `State` exactly one of `OBSERVED`,
      `BLOCKED - awaiting human`, `BLOCKED - awaiting build`, `NOT STARTED`; `Evidence` mandatory for
      `OBSERVED` (a row with no evidence is `NOT STARTED`). Close with three lines: what is live, the
      single next blocking action and whose it is, and the count of §5's seven conditions observed.
- [ ] 10.15 Cross-repo (**§7, owner blocker**): the life agent is Python and lives in the other
      repository, which `.kiro/steering/two-agent-vps.md` §6 forbids this session from modifying. The
      three change specifications in `ops/nizamcore-patches/` are written and unapplied. Recommended
      option **(b)**: phase 1 ships the finance agent on bot B only; bot A stays created, hardened and
      idle. `BLOCKED - awaiting owner` for option (a).

## Task Dependency Graph
```json
{
  "waves": [
    { "wave": 1, "tasks": ["10.0"] },
    { "wave": 2, "tasks": ["10.1"] },
    { "wave": 3, "tasks": ["10.2"] },
    { "wave": 4, "tasks": ["10.3", "10.4", "10.5", "10.10"] },
    { "wave": 5, "tasks": ["10.6"] },
    { "wave": 6, "tasks": ["10.7"] },
    { "wave": 7, "tasks": ["10.8"] },
    { "wave": 8, "tasks": ["10.9", "10.11"] },
    { "wave": 9, "tasks": ["10.12"] },
    { "wave": 10, "tasks": ["10.13"] },
    { "wave": 11, "tasks": ["10.14", "10.15"] }
  ]
}
```

```
10.0 ──> 10.1 ──> 10.2 ──> 10.3
                    │
                    ├──> 10.4
                    ├──> 10.5 ──> 10.6 ──> 10.7 ──> 10.8 ──> 10.12 (L0, L1 only)
                    └──> 10.10 ──┘                    │
                                                      ├──> 10.9 ──> 10.13  [gated: G5, G8]
                                                      └──> 10.11 [owner action sheet]

10.14  depends on every row above; rewritten after each run (cumulative record)
10.15  no dependency; blocked on the owner, and nothing else blocks on it
```
Gated beyond this repository: 10.12 rungs **L2-L4** need G1 + G3 placement + G4; 10.13 needs G5 + G8.
Everything else is buildable now behind the existing port and mock boundary.

## Gate
- [x] `npm run verify:all -- --all` passes all checks after every phase
      `HARNESS PASSED`, **20 of 20 executed checks passed**, at the close of this increment.
- [x] Test floor ratcheted up, never down
      The AC04 `--min` in `scripts/verify/all.mjs` is **1757**. Read from that file's history, every
      transition is an increase: 110 → 185 → 200 → 220 → 235 → 245 → 253 → 258 → 261 → 266 → 269 →
      317 → 331 → 1757. Fourteen values, thirteen transitions, all upward, none down.
- [x] No secret in any tracked file; `ops/` holds placeholders only
      Three checks, one clause each. **AC09** (`secret-scan.mjs`) covers *no secret in any tracked
      file*: five secret-shaped content patterns and five forbidden tracked paths over every tracked
      file. **AC11** (`generic-only.mjs`) covers *no organization-specific term in any tracked file*.
      **AC18** (`no-deployment-particular.mjs`) covers *`ops/` holds placeholders only*: 21 artifacts
      across `ops/**` and `src/server/mocks/fixtures/**`, plus the two store-isolation bans over 123
      files under `src/server/**`. All three pass, and none was allowlisted or exempted.

## Waiting on user input (do NOT attempt - steering §2)
> External state as of 2026-08-09 is recorded in `OPERATOR_STATE_2026-08-09.md` (a recorded observation, not a task edit): the G1 host now exists but is unhardened; two build-side findings (O1 no container images / no finance-agent entrypoint; O2 provisional registry) and four owed owner decisions (D-CAP, D-WAL, D-BENCH, D-G5) are logged there. No box below was ticked and no gate was attempted.

- [ ] G1 provision + harden the VPS
- [ ] G2 DNS for the two hostnames
- [ ] G3 create the two bots in BotFather
- [ ] G4 mint the two runtime OpenRouter keys + weekly caps
- [ ] G5 Google OAuth consent for the backup grant
- [ ] G6 register both webhooks
- [ ] G8 age keypair; private half stored off the host
