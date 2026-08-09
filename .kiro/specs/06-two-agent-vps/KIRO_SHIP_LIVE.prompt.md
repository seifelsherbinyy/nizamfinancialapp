# KIRO task prompt - wire it, run it, prove it. Owner authority, 2026-08-10 (rev 2)

> **Read first, in this order:** `ops/GATE_REGISTER.md`, `.kiro/steering/two-agent-vps.md`,
> `.kiro/steering/cloudflare-dns.md`, `OPERATOR_STATE_2026-08-09.md`,
> `KIRO_G3_WIRE_AND_TEST.prompt.md`, `TELEGRAM_VALUE_LEDGER.md`, `ops/docker-compose.yml`,
> all six `ops/env/*.env.example`, `ops/backup/backup.sh`, `ops/restore/restore.sh`,
> `ops/runbook/DISASTER_RECOVERY.md`.
>
> Where this file disagrees with the register on **how a gate is verified**, the register wins.
> Where it disagrees with anything on **what the owner has decided**, this file wins. It carries owner
> authority, dated, and the rulings in section 1 are his to make.

## 0. The mandate: execute, do not plan

**The objective is to wire everything, run it, watch it work, and report what the evidence says.** Not a
design. Not a proposal. A running deployment with observations attached.

**How to behave:**

- **Build and commit in increments.** Every section 8 step ends in a commit with `npm run verify:all`
  at 20 of 20. Do not batch ten steps into one heroic commit.
- **Do not stop to ask a question this file already answers.** Section 1 rules on seven decisions.
  Section 7 is the only place you are permitted to block on the owner, and even there you proceed with
  the recommended option unless he has said otherwise.
- **When you are blocked, say what you did anyway.** A reply that reports only a blocker has wasted the
  turn. Report the blocker plus everything you completed around it.
- **One question per reply, maximum.** Batch anything else into the fill-in sheet from section 8 step 3.

**OVERRIDDEN by owner decision. Do not raise these again:**

1. **D-ROTATE.** No credential is rotated until the deployment is tested in practical use and the owner
   reports it working. Both bot tokens and the Cloudflare zone token. The tokens in
   `.secrets/telegram-bots.env` are the tokens this deployment will use. **Build with them.**
   `.kiro/steering/cloudflare-dns.md` item 3 still reads as an instruction to rotate: **edit it to record
   the deferral** so no later session rotates unilaterally in good faith.
2. **Speed is the ranking criterion.** Between two correct options, take the one that is live sooner.
   The owner accepts a narrower first release over a later complete one, and will fix forward.
3. **The agent may perform gate steps at the owner's direction.** That waiver, already exercised for the
   two read-only bot probes, is now standing for this task, which resolves **F11**: reads are free;
   mutations that spend money, publish a public record, or grant a third party access still come to the
   owner first. Add the read-only carve-out to `.kiro/steering/two-agent-vps.md` section 2 and cite it,
   so the two steering files stop disagreeing.

**NOT overridden. Mechanical, and they stay:**

- `npm run verify:all` is **20 of 20** when you stop. A red harness is not a faster release.
- **No secret and no deployment particular in a tracked file** (R24). No token, no domain, no address,
  no numeric identifier, no bot name. This repository is PUBLIC.
- **Never invent a secret value**, not even a plausible placeholder of the right shape or width.
- **Fail-closed stays fail-closed.** An unconfigured guard refuses. Never add a default that opens a
  door to make a test pass.
- **Never claim a gate is done.** A gate is done when observed and the observation is recorded.
- **The test floor only ratchets up.** It is at 1790 against a real 1792.

## 1. Rulings, so nothing waits on a question

| Id | Ruling |
|---|---|
| **D-ROTATE** | Deferred until after practical-use testing. Rotation becomes the **final acceptance test**, and `getWebhookInfo` is checked on every run while the disclosed tokens are live. |
| **F11** | Reads free, mutations owner-in-the-loop. Reconcile both steering files to this. |
| **D-CAP** | The owner's ceiling is a hard USD 5.00 per week **in total**. Mint two keys at **2.50 each**. `WEEKLY_BUDGET_USD = 5` stays as the total; add the per-agent companion the code lacks. One word from him overrides this. |
| **D-WAL** | Outcome **B**, the documented default: the owning service snapshots and hands the artifact over, widening no mount. |
| **D-BENCH** | Authorized. One Phase-1 pass on the dev key to get the eligibility registry off `provisional: true`. |
| **D-ALLOWLIST** | You own the loader, so you decide and **write it down**: comma-separated, surrounding whitespace trimmed, and a single bare identifier must parse. `senderIsAllowlisted` compares exact strings, so one stray quote locks the owner out with a refusal indistinguishable from a wrong token. |
| **D-G5** | Publish the OAuth consent screen to **In production** (a Testing screen issues a 7-day refresh token and the uploader dies silently on day 8; `drive.file` is non-sensitive so there is no review). `BACKUP_FOLDER_REF` must be a folder the **uploader creates on first run**, because `drive.file` reaches only what the app created. |

## 2. THE UNLOCK: ship on long-poll. Do not wait for a domain

**The most important instruction here.** The owner has no domain; the account holds **zero zones**,
measured. Every plan beginning with a webhook is blocked on a purchase that has not happened.

`src/server/ports/telegram.ts` already admits `TELEGRAM_TRANSPORT_MODES = ['webhook', 'longPoll']`, and
long-poll is documented there as the degraded mode. **Long-poll needs no domain, no DNS, no TLS, no
certificate, no public port and no reverse proxy.** It is outbound only.

- **Phase 1, now: `TELEGRAM_MODE=longPoll`.** G1, G3, G4, G5, G8 suffice. **G2, G6 and the entire proxy
  path are deferred, not cancelled.** Do not run `setWebhook`. Do not create a DNS record. Do not
  publish a port. In compose, the `caddy` service stays down in phase 1 and `<TLS_PORT>` is not bound.
- **Phase 2, when a domain exists:** flip the mode entry, register both webhooks under G6, bring Caddy
  up. Nothing from phase 1 is discarded, because the guards are identical either way.

**Phase 2 carries an unrecorded gap, finding F12, and it is yours to close before you get there.**
`ops/docker-compose.yml` publishes exactly one host port, `<TLS_PORT>`, on the `caddy` service, and no
other service has a `ports:` key at all. The G1 correction in the register says to open port 80 for the
certificate challenge. Both statements are individually true and together insufficient: opening 80 in the
host firewall reaches nothing if compose never binds it, so an HTTP-01 challenge would still fail with the
firewall looking correct. Two ways out, and you must pick one and record it: publish 80 as a second port
on `caddy`, or rely on the TLS-ALPN-01 challenge on `<TLS_PORT>` alone and state in the register that 80
is then **not** required. The firewall and the port bindings have to agree, and right now nothing asserts
that they do.

### The trap that costs a day if missed

`authorizeDelivery` consults `secretTokenIsConfigured` **first**, and an absent expected token refuses
**every** request. Long-poll has no inbound HTTP request and therefore no
`X-Telegram-Bot-Api-Secret-Token` header at all. Naive reuse of the webhook guard refuses every message
and presents as a broken bot.

Make the requirement **mode-aware**, and negative-test both directions:

- In `longPoll`: the secret-token check is **not applicable**; the allowlist is the whole guard. An
  unlisted sender is still refused. An empty allowlist still refuses everyone.
- In `webhook`: an absent, empty, over-length or out-of-charset secret token still refuses everything,
  exactly as today. **Do not relax the webhook path to let one code path serve both.**
- Dedup on the `(bot, update)` pair applies in both modes. Long-poll re-delivers after a crash if the
  offset has not advanced, so **advance the offset only after the update is durably enqueued**. That
  ordering is the whole of at-least-once becoming effectively-once.

## 3. What lives where. The placement map

Three destinations, three **different** payloads. Conflating them is how a public repository ends up
holding a bot token. Every row below is derived from `ops/docker-compose.yml`, the six env templates, or
the runbooks. Do not invent a destination that is not in this table.

### 3.1 GitHub (public, this repository)

| Lives here | Never here |
|---|---|
| All source, contracts, specs, `.kiro/**` | Any token, key, refresh token or secret of any kind |
| `ops/**` templates, `Caddyfile`, `docker-compose.yml`, runbooks, `backup.sh`, `restore.sh` | Any **filled-in** `ops/env/*.env` (ignored since 2026-08-09; before that a filled `proxy.env` was tracked) |
| Docs, Dockerfiles, the eligibility registry | Any domain, address, zone id, numeric identifier or bot name (R24) |
| | `.secrets/**`, `outputs/**` |

### 3.2 The VPS (the only place the deployment runs)

| Artifact | Exact location | Owner / mode | Consumed by |
|---|---|---|---|
| The six environment files | `/etc/<CONFIG_DIR>/{life,finance,proxy,bus,scheduler,backup}.env` | `root:root`, `600` | one service each, via `env_file`. **No service reads another's** |
| Life store | volume `life-data` at `/data` in `life-agent` | container | life agent only |
| Finance store | volume `finance-data` at `/data` in `finance-agent` | container | finance agent only |
| Signal store | volume `signal-data` at `/data` in `signalbus` | container | bus only |
| Kill sentinel | volume `kill-switch` at `/run/nizam-kill` | mounted **`:ro`** into `life-agent`, `finance-agent`, `scheduler`, `backup` | all four honour it. The proxy has none, because it writes nothing |
| Backup scratch | volume `backup-work` at `/work` | container | backup only. `BACKUP_WORK_DIR` points here. **Never a store, never retained** |
| The three stores, for backup | `life-data:/stores/life:ro`, `finance-data:/stores/finance:ro`, `signal-data:/stores/signal:ro` | **read-only** | backup only. Read-only is the invariant: the backup service cannot corrupt what it copies |
| Proxy state and config | volumes `proxy-state:/data`, `proxy-config:/config`, plus host bind `<PROXY_CONFIG_FILE>:/etc/caddy/Caddyfile:ro` | container | caddy only. **Phase 2** |
| The repository itself | a `git clone` on the host | operator user | **`git pull` to update, never a copy of the working tree**, so nothing gitignored rides along |

**The `age` private key is not on this list and must never be.** It lives in the owner's password manager
plus one offline copy. Only `AGE_PUBLIC_KEY` reaches the VPS, in `backup.env`.

### 3.3 Google Drive (the off-host copy, and nothing else)

| Lives here | Never here |
|---|---|
| **`age`-encrypted** snapshot artifacts, one per store, produced by `ops/backup/backup.sh` | Any plaintext store, ever |
| Inside `BACKUP_FOLDER_REF`, a folder **the uploader created on first run** | Any environment file, plaintext or encrypted |
| At most `BACKUP_RETAIN_COUNT` artifacts; the oldest is dropped | The `age` **private** key. Backup and key in one place is not a backup |
| Written under `drive.file` scope only | Any credential, any token, the repository itself |

**Ordering is the security property: encrypt, then upload, then shred the scratch copy.** Never upload
first and encrypt later. `BACKUP_ENCRYPTION_SCHEME` names the tool; `AGE_PUBLIC_KEY` is the recipient.

### 3.4 The laptop

`.secrets/**` and `outputs/**` stay here and reach neither the VPS nor Drive nor GitHub. Values get
**typed** into `/etc/<CONFIG_DIR>` over the admin session, never copied up, never appended from a shell
whose history is kept.

## 4. The wire-up matrix

For every entry in every template you must be able to answer four things: which file it belongs to, which
gate supplies it, which service consumes it, and the one command that proves it landed.
`TELEGRAM_VALUE_LEDGER.md` already does this for the transport. **Extend that table to all six services**
and put it in `.kiro/specs/06-two-agent-vps/DEPLOYMENT_VALUE_LEDGER.md`. Rules it must satisfy:

- **Every entry has no default.** An unset entry is a startup failure, not a guess.
- **Negative rows are as important as positive ones.** The life file contains no finance secret; the
  finance file no life secret and no recovery credential; the proxy file no bot token and no webhook
  secret; no agent file a webhook path. Each of those is a `grep -c` returning `0`.
- **Shared entries must be equal where shared.** `LIFE_CONTAINER_PORT` appears in the proxy and life
  files and must match; same for `FINANCE_CONTAINER_PORT`. `ALLOWED_USER_IDS` is in **both** agent files
  or the deployment refuses the owner on one bot and has no list on the other.
- **`KILL_SENTINEL_PATH` must be identical in all four honouring files** and must resolve inside the
  `kill-switch` mount. A typo there is a kill switch that silently does nothing.
- **`MAX_CONNECTIONS`** has no home (F2). Irrelevant in long-poll: record that, give it a home in phase 2.

## 5. Definition of live

Observed, not asserted:

1. **Both bots answer the owner, and only the owner.** Bot A is life, bot B is finance. An unlisted
   sender is refused, and the refusal does not reveal which check failed.
2. **Two independent agent processes**, each with Hermes-style orchestration and tool isolation per
   contract 01, its own store, its own OpenRouter key, its own weekly cap. Neither can reach the other's
   store or key. A compromise of one yields nothing of the other.
3. **Model routing works** through the four pinned slugs, honours the per-agent cap, and **refuses
   rather than overspends** when the cap is exhausted.
4. **The consent bus carries a band, never a figure**, and is reachable from neither the internet nor the
   proxy.
5. **Kill switch works in both forms**: the sentinel halts model calls, model-path writes and bus
   publishes; `NIZAM_KILL_ALL=1` halts on restart.
6. **The placement map in section 3 holds**, and one **restore** has been exercised.
7. **`npm run verify:all` is 20 of 20** and the tree is committed.

## 6. The build gap, which is yours (finding O1)

Buildable behind the existing port and mock boundary. No human gate here.

1. **The environment loader.** `src/server/config/environment.ts` plus its 35 tests exist and are green.
   Confirmed: `process.env` appears in that module and nowhere else in `src/`, and it names **every**
   missing entry at once. Extend it to all six services and keep both properties.
2. **The live transport adapter** behind the existing port, implementing both modes from section 2.
3. **The finance-agent entrypoint.** `src/server/telegram/index.ts` is a barrel, not a main. Build a
   process that wires `acceptHandler` plus `workerRunner` plus `routing/turnDispatch`, refuses to boot on
   an incomplete environment, and honours the sentinel. In long-poll it binds no public port; in webhook
   it listens on `FINANCE_CONTAINER_PORT`.
4. **A Dockerfile per image this repository owns**, and a build path producing the tags compose
   references. It names six `<*_IMAGE_REF>` placeholders that nothing builds, which is why
   `docker compose up` cannot run today.
5. **Wire the existing `ops/backup/backup.sh` and `ops/restore/restore.sh`.** Do not write a second
   backup mechanism. If they need a change, change them.

## 7. The one blocker that is the owner's, not yours

The finance agent is this repository. **The life agent is Python and lives in the OTHER repository**, and
`.kiro/steering/two-agent-vps.md` forbids you from touching it. The three specs in
`ops/nizamcore-patches/` are the FastAPI wrapper, per-bot dedup and bus egress target it needs. Written,
unapplied.

So "both bots working" needs one of:

- **(a)** the owner authorises you to apply those three patches in the other repository; or
- **(b)** phase 1 ships the **finance agent on bot B only**, and life follows immediately. Bot A stays
  created, hardened and idle.

**Ask once, in your first line, recommend (b), and proceed on (b) while you wait.** Everything in
sections 3, 4, 6 and 8 is identical either way, so nothing blocks on the answer.

## 8. Order of operations

1. Reconcile both steering files per section 0 item 3 and section 1. Commit.
2. Extend the loader to all six services, tests included. Commit.
3. Emit **one** fill-in sheet: every entry the owner must supply, grouped by file, with its gate, its
   `secret` flag, and the proof command. One pass, not six round trips.
4. Write `DEPLOYMENT_VALUE_LEDGER.md` per section 4. Commit.
5. Transport adapter, both modes, section 2 negative tests. Commit.
6. Entrypoint and Dockerfiles. Commit.
7. Tell the owner exactly which gate steps to perform, with the command for each: G1 hardening plus
   `/etc/<CONFIG_DIR>`; G4 two keys at 2.50 with training opt-out; G5 with the consent screen published;
   G8 the `age` keypair.
8. **Run the test ladder in section 9.** Stop at the first rung that fails, fix, re-run from that rung.
9. Exercise backup and one restore.
10. Write the scorecard in section 10. Report. Phase 2 when a domain exists.

## 9. The test ladder

Each rung has an observable pass condition. **A rung is not passed because the code looks right.**

| Rung | What is proven | Pass condition |
|---|---|---|
| **L0 config** | The loader refuses an incomplete environment | Remove one required entry: boot fails, names **that** entry, and names every other missing one in the same message. Restore it: boot proceeds |
| **L1 guards** | Both modes, both directions | `longPoll` refuses an unlisted sender and accepts the owner with no secret-token header. `webhook` still refuses an absent, empty, over-length and out-of-charset token. Same update twice produces one effect |
| **L2 compose** | The stack stands up | `docker compose up` with all six images built. Every service healthy. In phase 1 **no host port is published** and `caddy` is down. `docker compose config` shows each env file mounted into exactly one service |
| **L3 transport** | Both bots reachable | Owner messages each bot and gets a reply. An unlisted sender is refused. Kill the agent mid-work, restart, and the in-flight update completes exactly once |
| **L4 routing and safety** | Money and halt | A turn routes to a pinned slug and the spend is recorded. Drive the ledger to the cap: the next call **refuses**, and a deterministic alert still fires. `touch` the sentinel: model calls, model-path writes and bus publishes all stop. `NIZAM_KILL_ALL=1` plus restart: the agent halts |
| **L5 durability** | The off-host copy is real | `backup.sh` runs, the artifact is encrypted (a plaintext store name must not appear in it), it lands in `BACKUP_FOLDER_REF`, retention drops the oldest past `BACKUP_RETAIN_COUNT`, and `restore.sh` rebuilds a store into a **scratch** location that matches the source |

**L5 is not optional and it is not last for convenience.** A backup that has not been restored is not a
backup, and `DISASTER_RECOVERY.md` says the drill is the prerequisite, not the recovery.

## 10. How progress is evaluated

After every run, write or update `.kiro/specs/06-two-agent-vps/LIVE_PROGRESS.md` with this table. It is
the progress record, it is cumulative, and it is how the owner sees movement without reading a transcript.

| Column | Rule |
|---|---|
| Item | one row per gate G1 to G8, one per ladder rung L0 to L5, one per build item in section 6 |
| State | exactly one of `OBSERVED`, `BLOCKED - awaiting human`, `BLOCKED - awaiting build`, `NOT STARTED` |
| Evidence | the command run and what it returned. For `OBSERVED` this is mandatory. A row with no evidence is `NOT STARTED` no matter how finished the code looks |
| Owner action | the single thing the owner must do, or blank |
| Date | when observed |

Then close with three lines and nothing else:

1. **What is live now**, in one sentence.
2. **The single next blocking action**, and whose it is.
3. **Percent of section 5's seven conditions observed**, as a count out of seven, so the number cannot be
   inflated by partial credit.

## 11. What you must not do

- Do not run `setWebhook`, create a DNS record, or publish a port in phase 1.
- Do not rotate anything (D-ROTATE).
- Do not put a secret, a particular, or a filled-in `ops/env/*.env` in a tracked file.
- Do not upload anything to Drive that is not `age`-encrypted, and never the private key.
- Do not mount a store read-write into the backup service, or into the other agent.
- Do not weaken a guard, soften a verification line, lower the test floor, or tick a gate checkbox you
  have not observed.
- Do not touch the other repository without the section 7 authorisation.
- Do not stop with a red harness, and do not stop with an unwritten scorecard.
