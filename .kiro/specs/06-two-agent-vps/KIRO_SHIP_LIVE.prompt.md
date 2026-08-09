# KIRO task prompt - ship it live, owner authority, 2026-08-10

> **Read `ops/GATE_REGISTER.md`, `.kiro/steering/two-agent-vps.md`, `.kiro/steering/cloudflare-dns.md`,
> `.kiro/specs/06-two-agent-vps/OPERATOR_STATE_2026-08-09.md` and this file's siblings
> `KIRO_G3_WIRE_AND_TEST.prompt.md` and `docs/OPERATOR_HANDOFF_2026-08-09.md` before acting.
> Where this file disagrees with the register on **how a gate is verified**, the register wins.
> Where it disagrees with anything on **what the owner has decided**, this file wins: it carries owner
> authority, dated, and the decisions in section 1 are his to make.**

## 0. Owner authority, and exactly what it does and does not override

The owner has read the findings and is exercising his authority. Do not re-litigate the items in section
1. Do not raise them again as blockers. Record them as decided and proceed.

**OVERRIDDEN by owner decision. Stop treating these as open:**

1. **D-ROTATE.** No credential is rotated until the deployment is tested in practical use and the owner
   reports it working. This applies to both bot tokens and the Cloudflare zone token. The tokens in
   `.secrets/telegram-bots.env` are the tokens the deployment will use. Build with them.
   `.kiro/steering/cloudflare-dns.md` item 3 currently reads as an instruction to rotate; **update that
   item to record the deferral** so no later session rotates unilaterally in good faith.
2. **Speed is the ranking criterion.** Between two correct options, take the one that is live sooner.
   Iterate after it is live. The owner will accept a narrower first release over a later complete one.
3. **The agent may perform gate steps at the owner's direction**, as already happened for the two
   read-only bot probes. That waiver is now standing for this task, and it resolves **F11**: reads are
   free, mutations still require the owner in the loop for anything that spends money, publishes a
   public record, or grants a third party access. Add the read-only carve-out to
   `.kiro/steering/two-agent-vps.md` section 2 and cite it, so the two steering files stop disagreeing.

**NOT overridden. These are mechanical and they stay:**

- `npm run verify:all` must be **20 of 20** when you stop. A red harness is not a faster release, it is
  a broken one. AC14 means commit your work; AC15 means the tree stays push-ready.
- **No secret and no deployment particular in a tracked file** (R24). No token, no domain, no address,
  no numeric identifier, no bot name. The repository is PUBLIC.
- **Never invent a secret value**, not even a plausible-looking placeholder of the right shape.
- **Fail-closed guards stay fail-closed.** An unconfigured guard refuses. Do not add a default that
  opens a door to make a test pass.
- **Never claim a gate is done.** A gate is done when it is observed, and the observation is recorded.
  A document asserting completion is the one thing the register forbids outright.

## 1. Decisions, so nothing waits on a question

| Id | Ruling | Note |
|---|---|---|
| **D-ROTATE** | Deferred until after practical-use testing. Rotation becomes the final acceptance test, and `getWebhookInfo` is checked on every test run while the disclosed tokens are live. | Owner, 2026-08-10 |
| **F11** | Reads are free for an agent; mutations that spend, publish or grant stay owner-in-the-loop. Reconcile both steering files to this. | Owner, 2026-08-10 |
| **D-CAP** | The owner's stated ceiling is a hard USD 5.00 per week **in total**. So mint two keys at **2.50 each**, not 5 each. `WEEKLY_BUDGET_USD = 5` stays as the total; add the per-agent companion the code currently lacks. | Derived from the owner's stated constraint. One word from him overrides it. |
| **D-WAL** | Take outcome **B**, the documented default: the owning service snapshots and hands the artifact over, widening no mount. | |
| **D-BENCH** | Authorized. One Phase-1 benchmark pass from the dev key, to get the eligibility registry off `provisional: true`. | |
| **D-ALLOWLIST** | You are building the loader, so you decide the delimiter and **write it down**. Comma-separated with surrounding whitespace trimmed, and a single bare identifier must parse. `senderIsAllowlisted` compares exact strings, so a stray quote or space locks the owner out with a refusal that is deliberately indistinguishable from a wrong token. | |
| **D-G5** | Publish the OAuth consent screen to **In production**. A Testing-status screen issues a 7-day refresh token and the unattended uploader dies on day 8. `drive.file` is non-sensitive, so there is no verification review. `BACKUP_FOLDER_REF` must be a folder the **uploader creates on first run**. | |

## 2. THE UNLOCK: ship on long-poll, and do not wait for a domain

**This is the most important instruction in this file.** The owner has no domain. The account holds
**zero zones**, measured. G2 therefore cannot complete, and every plan that starts with a webhook is
blocked on a purchase that has not happened.

`src/server/ports/telegram.ts` already admits two modes: `TELEGRAM_TRANSPORT_MODES = ['webhook',
'longPoll']`, and long-poll is described there as the documented degraded mode. **Long-poll needs no
domain, no DNS, no TLS, no certificate, no public port and no reverse proxy.** It is outbound only.

So the release plan is:

- **Phase 1, now: `TELEGRAM_MODE=longPoll`.** Gates G1, G3, G4, G5 and G8 are enough. G2, G6 and the
  whole Caddy path are **deferred, not cancelled**. Do not run `setWebhook`. Do not create DNS records.
  Do not open a public port.
- **Phase 2, when a domain exists:** flip the mode entry, register both webhooks under G6, bring Caddy
  in. Nothing built in phase 1 is thrown away, because the guards are the same either way.

### The trap that will cost you a day if you miss it

`authorizeDelivery` in `src/server/telegram/auth.ts` consults `secretTokenIsConfigured` **first**, and an
absent expected token refuses **every** request. In long-poll mode there is no inbound HTTP request and
therefore no `X-Telegram-Bot-Api-Secret-Token` header at all. A naive reuse of the webhook guard will
refuse every message in long-poll mode and look like a broken bot.

Make the authenticity requirement **mode-aware**, and prove it with negative tests in both directions:

- In `longPoll`, the secret-token check is **not applicable**, and the allowlist is the whole guard. An
  unlisted sender must still be refused. An empty allowlist must still refuse everyone.
- In `webhook`, an absent, empty, over-length or out-of-charset secret token must still refuse
  everything, exactly as today. Do not relax this to make one code path serve both.
- De-duplication on the `(bot, update)` pair applies in both modes. Long-poll re-delivers on a crash
  before the offset advances, so the dedup index is what makes it safe. Advance the offset only after
  the update is durably enqueued.

## 3. Definition of "live", so we agree on the finish line

Live means all of the following are observed, not asserted:

1. **Both bots answer the owner**, and only the owner. Bot A is the life agent, bot B is the finance
   agent. An unlisted sender is refused.
2. **Two independent agent processes**, each with its own Hermes-style orchestration and tool isolation
   per contract 01, its own store, its own OpenRouter key, its own weekly cap, and no access to the
   other's store or key. A compromise of one yields nothing of the other.
3. **Each agent routes through OpenRouter** with the four pinned slugs, honours its own cap, and refuses
   rather than overspends when the cap is exhausted.
4. **The consent bus** carries a band, never a figure, between them. It is reachable from neither the
   internet nor the proxy.
5. **The kill switch works in both forms**: the sentinel file halts model calls, model-path writes and
   bus publishes; `NIZAM_KILL_ALL=1` halts the agent on restart.
6. **The three-way mirror in section 5 is exercised end to end**, including one restore.
7. **`npm run verify:all` is 20 of 20** and the tree is committed.

## 4. The build gap, which is yours (finding O1)

Nothing here is a human gate. All of it is buildable behind the existing port and mock boundary.

1. **The environment loader.** In progress at `src/server/config/environment.ts`. Finish it with tests.
   `process.env` must appear in **that module only** and nowhere else in `src/`. It must **name every
   missing entry at once**, not fail on the first, because the owner fills the files by hand and one
   pass beats six round trips. Every entry in `TELEGRAM_VALUE_LEDGER.md` and all six templates must be
   covered, and **there is no default for anything**.
2. **The live transport adapter** behind the existing port interface, implementing both modes from
   section 2.
3. **The finance-agent entrypoint.** `src/server/telegram/index.ts` is a barrel, not a main. Build a
   process that boots on `FINANCE_CONTAINER_PORT`, wires `acceptHandler` plus `workerRunner` plus
   `routing/turnDispatch`, refuses to boot on an incomplete environment, and honours the sentinel.
   In long-poll mode it does not need to bind a public port at all.
4. **A Dockerfile per image this repository owns**, and a build path that produces the tags
   `ops/docker-compose.yml` references. It currently names six `<*_IMAGE_REF>` placeholders that nothing
   builds, which is why `docker compose up` cannot run today.
5. **`MAX_CONNECTIONS`** has no home (finding F2). In long-poll it is irrelevant, so record that and give
   it a home when phase 2 lands.

## 5. The three-way mirror, and the boundary that must not be crossed

The owner wants everything on GitHub, on the VPS and on Google Drive. Three destinations, three
**different** payloads. Conflating them is how a public repository ends up holding a bot token.

| Destination | Holds | Never holds |
|---|---|---|
| **GitHub** (public) | source, contracts, specs, `ops/**` templates and runbooks, docs | any secret, any token, any domain, any address, any numeric identifier, any bot name, any filled-in `ops/env/*.env` |
| **The VPS** | the running deployment, the two agent stores, and the only filled-in environment files, at `/etc/<CONFIG_DIR>/*.env`, `root:root`, mode `600` | nothing that belongs only on the laptop; no plaintext backup |
| **Google Drive** | **age-encrypted** backup artifacts only, in a folder the uploader created, under `drive.file` | any plaintext store, any plaintext environment file, any key material. The age **private** key never goes to Drive, or the backup and its key sit in the same place |

Requirements:

- Use the existing `backup` service in `ops/docker-compose.yml`. It already mounts the three stores
  read-only and has the entries for this: `AGE_PUBLIC_KEY`, `BACKUP_ENCRYPTION_SCHEME`,
  `BACKUP_SCHEDULE`, `BACKUP_RETAIN_COUNT`, `BACKUP_FOLDER_REF`, `DRIVE_REFRESH_TOKEN`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `STORAGE_TOKEN_URL`. Do not invent a second mechanism.
- **Encrypt before upload, always.** Gate G8's `age` keypair is the encryption; the public half goes in
  the backup environment file and the private half goes to the owner's password manager plus one offline
  copy, never onto the VPS and never onto Drive.
- **A backup you have not restored is not a backup.** Exercise one full restore into a scratch location
  and record the observation. `ops/runbook/DISASTER_RECOVERY.md` must state the recovery objective in
  terms of the configured cadence.
- **Mirror the repository to the VPS by `git clone` or `git pull`**, never by copying the working tree,
  so no gitignored file rides along. `.secrets/` must never reach the VPS or Drive: the VPS gets its
  values typed into `/etc/<CONFIG_DIR>` by hand.

## 6. The cross-repo blocker, which needs one word from the owner

The finance agent is this repository. **The life agent is Python and lives in the OTHER repository**, and
`.kiro/steering/two-agent-vps.md` forbids you from touching it. The three change specs in
`ops/nizamcore-patches/` are the FastAPI wrapper and per-bot de-duplication it needs. They are written
and unapplied.

So "both bots working" needs one of:

- **(a)** the owner authorises you to apply those three patches in the other repository, in which case
  say so and do it; or
- **(b)** phase 1 ships the **finance agent on bot B only**, and the life agent follows immediately
  after. Bot A stays created, hardened and idle.

**Ask once, at the top of your first reply, and recommend (b)** if the owner has not already answered,
because it is live sooner and it is the ranking criterion in section 0.

## 7. Order of operations

1. Reconcile the two steering files per section 0 item 3 and section 1. Commit.
2. Finish the loader with tests. Commit.
3. Emit **one** fill-in sheet listing every environment entry the owner must supply, grouped by file,
   with the gate that supplies each and its `secret` flag. One pass, not six.
4. Ask the section 6 question. Recommend (b).
5. Build the transport adapter, both modes, with the section 2 negative tests. Commit.
6. Build the entrypoint and the Dockerfiles. Commit.
7. Tell the owner exactly which gate steps he must perform, in order, with the command for each: G1
   hardening plus the config directory, G4 two keys at 2.50 each with training opt-out, G5 with the
   consent screen published, G8 the `age` keypair.
8. First live run in long-poll. Both bots, or bot B under option (b).
9. Exercise the backup and one restore.
10. Report. Then phase 2 when a domain exists.

## 8. What you must not do

- Do not run `setWebhook`, create a DNS record, or open a public port in phase 1.
- Do not rotate anything (D-ROTATE).
- Do not put a secret, a particular or a filled-in `ops/env/*.env` in a tracked file.
- Do not weaken a guard, soften a verification line, or tick a gate checkbox you have not observed.
- Do not touch the other repository without the section 6 authorisation.
- Do not stop with a red harness.

## 9. How to report

Lead with: the section 6 answer you need, then what is live, then what is blocked and on whose action.
State every gate as either `BLOCKED - awaiting human` or observed-with-evidence. Never as done because a
document says so. If you deviate from this prompt, say which line and why, in your first reply.
