# Operator state snapshot - 2026-08-09

> **Spec:** `.kiro/specs/06-two-agent-vps`. **Steering:** `.kiro/steering/two-agent-vps.md`.
> **Register:** `ops/GATE_REGISTER.md` (the authority on gate meaning and verification).
> **Companion (human-facing):** `docs/OPERATOR_HANDOFF_2026-08-09.md`.
> **Particulars (untracked):** `outputs/DEPLOYMENT_PARTICULARS.local.md` + `outputs/OPERATOR_URL_WORKSHEET.md`.
> **Transport values (G3 + G6):** `TELEGRAM_VALUE_LEDGER.md` in this folder; operator steps in
> `docs/TELEGRAM_BOTS_SETUP_G3.md`; fill-in card `outputs/BOT_SETUP_WORKSHEET.local.md` (untracked).
>
> This file is a recorded observation, not a task edit. It renumbers no gate, ticks no box, softens
> no verification line, and contains no deployment particular (R24). It exists so a later Kiro session
> opens the spec and finds the current external state plus two build-side findings without re-deriving
> them.

## 1. Gate state, as of this snapshot

| Gate | Blocked-on | Movement since the register was authored |
|---|---|---|
| G1 provision + harden | precondition met, hardening outstanding | **The host now exists** (provider, active). Steps 2-9 + `/etc/<CONFIG_DIR>` not yet worked. Recorded observation added under G1 in the register. Status stays `BLOCKED - awaiting human`. |
| G2 DNS for two hostnames | **no zone yet** | Still blocked on the single missing input: a domain / DNS zone does not yet exist. Intended host Cloudflare. Records must be **A -> host, grey cloud (DNS only)**. A step-by-step walkthrough (`docs/CLOUDFLARE_DNS_SETUP_G2.md`) was authored 2026-08-09 against the provider's current documentation and carries four findings: F5 the register mandates grey cloud without recording why (the reason is contract 12 section 2.2.4 plus the intermediary's own `ClientRequestURI` log field), F6 the Caddyfile's closed-connection indistinguishability is a property of every hop in front of it and no line records that dependency, F7 `ACME_CONTACT` is an operator entry with no gate, F8 `<ADMIN_PORT>` is unconstrained while the proxied-port list is not. Fill-in card: `outputs/DNS_SETUP_WORKSHEET.local.md` (untracked). |
| G3 two bots | hardening + verification + a place to put tokens | **Two bot identities now exist** (created 2026-08-09), so the creation half has moved; Hardening, distinctness and the operator identifier were then **verified live** at 23:57 local on 2026-08-09 (see §4). G3 stays `BLOCKED` on two things only: **placement** (needs G1's config dir) and **rotation** of the two disclosed tokens. A step-by-step walkthrough (`docs/TELEGRAM_BOTS_SETUP_G3.md`) and a transport value ledger (`TELEGRAM_VALUE_LEDGER.md`, this folder) were authored 2026-08-09 and carry three findings: F1 the allowlist delimiter is undeclared and nothing reads the environment yet (decision **D-ALLOWLIST**), F2 `MAX_CONNECTIONS` is verified against a value stored nowhere, F3 G3's verification does not assert G3 step 3 although `getMe` makes it machine-checkable. |
| G4 two model keys + caps | **D-CAP ruling** (see §3) | Unchanged, and now carries an unresolved decision the register's step does not name. |
| G5 storage consent | nothing but G1 | Unchanged. Two traps re-confirmed live (§3, D-G5). |
| G6 register webhooks | G1 + G2 + G3 | Unchanged. Last of the reachability chain. |
| G7 | CLOSED - WONT-DO | Unchanged. Do not re-raise. |
| G8 backup keypair | nothing but G1 | Unchanged. The provider's own snapshot/backup does **not** satisfy it (recorded under G1). |

## 2. Build-side findings (NOT gates - these are code/spec observations)

These are not human gates and do not belong in `ops/GATE_REGISTER.md`. They are recorded here because
they sit between "all gates clear" and "the deployment actually runs", and neither appears in
`FINAL_REPORT.md` §5 "Honest limits".

### O1 - no container image is produced by either repository, and this repo's finance agent has no process entrypoint

`ops/docker-compose.yml` names six services, each `image: "<..._IMAGE_REF>"` - a placeholder, by
design (Phase 7 is "TEXT ONLY, never executed"). Confirmed in this repo at this snapshot:

- **No `Dockerfile` / `Containerfile`** anywhere in the tree.
- **No process entrypoint.** `src/server/` holds `db/`, `ports/`, `mocks/`, `signals/`, `telegram/`,
  `routing/`, `benchmark/`, `ops/` - application logic, all tested behind mocks - but nothing that
  boots an HTTP server and listens on `FINANCE_CONTAINER_PORT`. `src/server/telegram/index.ts` is a
  barrel re-export, not a `main`. No `createServer` / `listen(` / `Bun.serve` / server framework in
  non-test server code.
- **No server dependency.** `package.json` dependencies are `dexie, react, react-dom, zod, zustand`;
  there is no fastify/express/node-http-server and no start script (`scripts` are dev/build/test/lint
  and the loop/verify tooling only).

**Consequence:** even after G1-G8 all clear, `docker compose up` cannot run, because the six images the
compose file references are not built by anything in-repo, and the finance-agent image would have no
server process to run. The life-agent image is downstream of the three `ops/nizamcore-patches/` change
specs (which add the FastAPI/uvicorn wrapper in the *other* repo) - those are emitted, unapplied.

**This is a decision for the owner / a later Kiro session, not an agent action here.** The likely
missing spec work is: (a) a finance-agent process entrypoint that wires
`telegram/acceptHandler` + `workerRunner` + `routing/turnDispatch` behind an HTTP listener on
`FINANCE_CONTAINER_PORT`; (b) a `Dockerfile` per image the compose file references; (c) a documented
build-and-publish path to the registry `ops/runbook/ROLLBACK.md` assumes tags exist in. None of these
is a human GATE; all are buildable in-repo behind the existing network/secret boundary. Recorded, not
resolved.

### O2 - the eligibility registry is still `provisional: true`

Unchanged from `FINAL_REPORT.md` §5.1 and the register's own recorded observation (2026-08-07). The
register closed task 6.3 on the ELSE branch: no live model call was made. Live routing stays gated on
G4. Externally verified this snapshot: the model provider base URL resolves to a real documented
endpoint and all four pinned model slugs (`xiaomi/mimo-v2.5`, `z-ai/glm-5.2`, `x-ai/grok-4.5`,
`moonshotai/kimi-k3`) resolve at the provider today - so the branch the register left open ("no env
entry resolves the model provider base URL") is resolvable by the operator, and the benchmark run is
affordable. Still an owner decision, because it spends the owner's money.

## 3. Decisions still owed by the owner

| Id | Decision | Why it blocks |
|---|---|---|
| **D-CAP** | Is the weekly cap **5 per agent** (a USD 10/week provider ceiling) or **5 total**? G4 mints two keys and its step says both caps equal "the value already in the code". The code pins exactly one number: `WEEKLY_BUDGET_USD = 5`, with `budgetPhase(5)` exhausted (`src/features/routing/k4Constants.test.ts`). Two keys at 5 each is twice K4's stated "hard USD 5.00/week". | G4 cannot be executed correctly until this is settled. If "5 total", `WEEKLY_BUDGET_USD` needs a per-agent companion and the two provider-side limits become 2.50 each or an asymmetric split. |
| **D-WAL** | The write-ahead-log sidecar determination. Take **outcome B** (documented default): the owning service snapshots and hands the artifact over, widening no mount. | Until recorded, rollback across a migration stays blocked (register G8 sub-section). |
| **D-BENCH** | Authorize one Phase-1 benchmark pass from the dev machine (~1/3 of the dev key's USD 1 weekly allowance) or leave the registry provisional. | A provisional registry can never promote a model, so routing stays off either way (register "dev-key carve-out"). |
| **D-ALLOWLIST** | What delimiter does `ALLOWED_USER_IDS` use, and which module reads it? Raised as F1 in `TELEGRAM_VALUE_LEDGER.md` section 5. Nothing reads the environment at all today, so the string-to-array shape is undecided and a loader written later could disagree with what the operator wrote. `senderIsAllowlisted` resolves membership by exact string identity, so a stray space or quote refuses the only sender on the list. Interim shape: one identifier, bare digits, no quotes, no brackets, no spaces. | Not blocking G3, but it is the first thing the O1 entrypoint work has to settle, and getting it wrong locks the owner out of both bots with a refusal that is deliberately indistinguishable from a wrong secret token. |
| **D-ROTATE** | **DECIDED by the owner, 2026-08-10: no credential is rotated until the deployment has been tested end to end in practical use and the owner reports it working.** This reverses the "rotate before G6" instruction that this file and three others carried, and the reversal is recorded rather than the instruction quietly deleted. Rationale accepted: churning three credentials before anything has been proven to work adds a variable to every failure you are trying to diagnose. Two conditions attach, in section 4: rotation becomes the **final acceptance test** rather than a skipped step, and a zero-cost detection check runs for as long as the disclosed tokens are live. | Nothing. It unblocks G6 immediately, and moves a known obligation to the end of the sequence instead of the front. |
| **D-G5** | Two G5 traps to apply when doing the consent grant: (1) the OAuth consent screen must be **published to production**, not left in "Testing", or the refresh token expires in 7 days and the unattended uploader dies silently on day 8 - safe because `drive.file` is non-sensitive and needs no review; (2) `BACKUP_FOLDER_REF` must be a folder the **uploader creates on first run**, not a hand-made one, because `drive.file` reaches only files the app created. | Not blocking today, but both make G5 pass on day 1 and fail later. |

## 4. Recorded observation - the G3 creation half happened, and what it left open

Two bot identities were created on 2026-08-09 and recorded in `outputs/BOT_SETUP_WORKSHEET.local.md`
(untracked). Their names also appear in `.secrets/MANIFEST.json` and `.secrets/telegram-bots.env`, both
untracked; a scan of all 400 tracked files for the two tokens, the two bot identifiers, the two bot names
and the operator identifier returned **zero hits**, so no particular is in any tracked file (R24).

**G3 is not satisfied by creation alone.** Four halves of it were unobserved at creation time; all four
have since been observed live, and two obligations remain open - **placement** (blocked on G1) and
**rotation** of the two disclosed tokens:

1. **Hardening applied and verified by change.** `/setjoingroups` to Disable is confirmed on both bots:
   `getMe.can_join_groups` was observed `true` on a first probe and `false` on a second, so the change is
   evidenced rather than assumed. `can_read_all_group_messages` is `false` on both, which is the wanted
   value, and is also the provider default - so the value is proven and the `/setprivacy` action is not
   distinguishable from it.
2. **Verified with `getMe`, twice.** `ok: true` and `is_bot: true` on both tokens, and both hardening
   fields read back as above. Both tokens returning `ok: true` is also independent proof that **neither
   has been rotated yet**.
3. **Distinctness proven.** The two `result.id` values were compared and differ, so the per-bot
   de-duplication key is safe.
4. **The operator identifier has been read** via `getUpdates` on **both** bots, which returned one update
   each from the same non-bot sender - a free cross-check that one operator owns both. The value is
   recorded once in `outputs/BOT_SETUP_WORKSHEET.local.md` and appears nowhere tracked. It was read
   **before** G6, and `getWebhookInfo` confirms `url` is empty on both bots, so no webhook exists and
   `getUpdates` is still available.

**How this was observed, and by whom.** The register reserves `getMe` and `getUpdates` for the operator;
the owner explicitly directed an agent to run them on his behalf, so these are **agent-run,
owner-directed** observations rather than operator-run ones, and are labelled that way in the worksheet.
Probe time 2026-08-09 23:57 local. `getWebhookInfo` was added to the probe because the earlier claim that
no webhook existed had been inferred rather than checked.

### Disclosure obligation - deferred by owner decision D-ROTATE, not discharged

Both tokens were disclosed to a third-party assistant chat at creation time, and are currently held in
`.secrets/telegram-bots.env` on the development machine. Two consequences, and neither is optional:

- **Rotation is deferred, on the owner's explicit instruction of 2026-08-10 (D-ROTATE): no rotation until
  the deployment has been tested in practical use and reported working.** What that changes and what it
  does not:
  - **What it does not change.** A disclosed bot token still lets whoever holds it call `setWebhook` and
    redirect every delivery to their own server, or call `deleteWebhook` and silently take the bot down.
    That is one API call, needs nothing else, and is exactly the reachability G6 exists to control. Before
    G6 there is nothing to redirect, so the deferral costs nothing at all. From the moment G6 registers a
    webhook until rotation happens, that call is available to a third party.
  - **Condition 1 - rotation is the final acceptance test, not a skipped step.** An unrotated deployment
    has never exercised its own rotation path, so rotation is untested capability, and
    `ops/runbook/DISASTER_RECOVERY.md` depends on it working. Running it as the last test case proves the
    procedure and clears the disclosure in one action. The sequence is four steps in one sitting:
    BotFather `/token`; update the one entry in the one environment file; re-run `setWebhook` with the
    same secret token and path; `getWebhookInfo` to confirm `url` and `max_connections` came back and
    `last_error_message` is absent. Miss the third step and that bot goes dark.
  - **Condition 2 - detection, for as long as the disclosed tokens are live.** `getWebhookInfo` costs
    nothing and answers the only question that matters: does `url` still equal the path you registered? If
    it ever differs, or `pending_update_count` climbs while the agent is healthy, the token has been used
    by somebody else. Add it to whatever loop the practical-use test already runs. This detects rather
    than prevents, which is the correct trade once prevention has been deliberately deferred.
- **A third credential is on the same deferral.** `.kiro/steering/cloudflare-dns.md` item 3 records that
  the Cloudflare API token was read into a message on 2026-08-09 and is compromised until rotated, so the
  list is three: both bot tokens and the zone token. The zone token is the odd one out and worth calling
  separately, because nothing in the deployment ever holds it: no service, no container, no environment
  file. It is only ever used by hand from the operator's laptop, so rotating it breaks nothing and needs no
  coordinated sitting. If any of the three is rotated early, it should be that one. One follow-up on the steering file: item 3 there states
  the token is compromised until rotated, which stays true under the deferral and is not a contradiction -
  but it reads as an instruction to a session that has not seen D-ROTATE, and steering is what an agent
  loads first. The deferral belongs in `.kiro/steering/cloudflare-dns.md` item 3 so no future session
  rotates unilaterally in good faith.
- **`.secrets/` is the wrong class of home for this credential.** `docs/PFOS_SECRETS_PLAN.md` scopes the
  development machine's `.secrets/` to dev, browser-safe, low-privilege credentials, and states that
  production secrets never live there. A bot token reaches the deployment, so its two legitimate homes
  are the password manager and `/etc/<CONFIG_DIR>/*.env` at mode 600 owned by root.

**The repository itself is clean, verified five ways at this snapshot:** `.secrets/` is ignored
(`.gitignore:54`); no tracked path matching `secret` exists other than the plan document and the scanner;
the history of `.secrets` is empty, so it was never committed in any branch; no tracked file contains
either bot name or any token-shaped string; and the repository's own `scripts/verify/secret-scan.mjs`
reports a pass with no secrets and no real ledger data tracked, across 400 tracked files.

### O1 re-proved with counts, not impressions

Re-checked at this snapshot, because O1 is the finding most likely to be waved away: `process.env`
appears in **zero** non-test files under `src/`; there is **no** HTTP listener anywhere in `src/`
(`createServer`, `.listen(`, `Bun.serve`, `node:http` and every server framework return no non-comment
hit); there is **no** Dockerfile or Containerfile in the tree; and `ops/docker-compose.yml` carries
**six** image-reference placeholders. The transport logic itself is complete and heavily tested (auth,
de-duplication, work queue, worker runner, accept handler), which is what makes the absence easy to
miss: the code exists, the process does not.

One consequence for **D-ALLOWLIST**: `senderIsAllowlisted` in `src/server/telegram/auth.ts` resolves
membership with an exact-string `includes` against a `readonly string[]`. Whatever loader is specified
must split the entry into strings that match the provider's identifier rendering exactly. A stray space
or a quote inside the value refuses the only sender on the list, and that refusal is deliberately
indistinguishable from a wrong secret token.

## 5. What an agent did in this snapshot, and did not

**Did:** recorded the host-exists observation under G1 (no particular, status unchanged, harness
`gateRegister.test.ts` 43/43 green, AC18 particular-scan green); wrote this observation; wrote the
human handoff; kept every particular in the two untracked `outputs/` files; audited the repository for
a leaked bot credential five independent ways and re-proved O1 by count (section 4).

**Did not:** provision, harden, create a bot, mint a key, register a webhook, generate a keypair,
apply any cross-repo patch, or tick any box in `tasks.md`. It also did not **read** either bot token,
call the provider with one, or rotate one: the credential audit counted entry names and never a value,
and every provider call in gate G3 belongs to the owner's own session (steering section 2). Those remain the owner's, exactly as the
register requires.

## 6. Findings index

Every finding raised across this tier, with where it is recorded. This table is pointers only: the
owning file is the authority and this row is never the place to read the detail.

| Id | One line | Recorded in |
|---|---|---|
| **O1** | No container image is built by anything in-repo and the finance agent has no process entrypoint, so `docker compose up` cannot run even after every gate clears | this file, section 2 (re-proved by count in section 4) |
| **O2** | The eligibility registry is still `provisional: true`, so live routing stays gated on G4 | this file, section 2 |
| **F1** | `ALLOWED_USER_IDS` has no declared delimiter and nothing reads the environment yet | `TELEGRAM_VALUE_LEDGER.md` section 5; decision **D-ALLOWLIST** in section 3 above |
| **F2** | `MAX_CONNECTIONS` is used by G6's command and verification but stored in no template and no `ENV_ENTRIES` row | `TELEGRAM_VALUE_LEDGER.md` section 5; interim capture in `outputs/BOT_SETUP_WORKSHEET.local.md` |
| **F3** | G3's register verification does not assert G3 step 3, although `getMe` returns both hardening fields | `TELEGRAM_VALUE_LEDGER.md` section 5; asserted in `docs/TELEGRAM_BOTS_SETUP_G3.md` section 7a |
| **F4** | The rotation command is BotFather `/token`; there is no `/revoke`. Two tracked docs said otherwise and were corrected | `docs/TELEGRAM_BOTS_SETUP_G3.md` finding F4; fixed in `docs/PFOS_BUILD_READINESS.md` and `docs/pfos_build_readiness.yaml` |
| **F5** | The register mandates grey cloud without recording why; the reason is contract 12 section 2.2.4 plus the intermediary's own `ClientRequestURI` log field | `docs/CLOUDFLARE_DNS_SETUP_G2.md` sections 6 and 8 |
| **F6** | The Caddyfile's closed-connection indistinguishability is a property of every hop in front of it, and no line records that dependency | `docs/CLOUDFLARE_DNS_SETUP_G2.md` section 8 |
| **F7** | `ACME_CONTACT` is an operator-gated entry with no gate step and a real consequence (certificate expiry notices) | `docs/CLOUDFLARE_DNS_SETUP_G2.md` section 8 |
| **F8** | `<ADMIN_PORT>` is unconstrained while the provider's proxied-port list is not, so a future flip to proxied would take the admin path down | `docs/CLOUDFLARE_DNS_SETUP_G2.md` section 8 |
| **F9** | `scripts/cf_dns.sh` demanded a token for `resolve`, the one subcommand that authenticates with nothing and the one the G2 walkthrough names as the actual evidence. The credential block ran unconditionally at script top, so on a fresh clone the only credential-free command died on a missing credential. **Fixed** in this snapshot: the env file is still sourced for `CF_ZONE_NAME` and `HOST_IP`, the token is asserted per command by `need_token`, and an exported token is preserved across the source so the documented first-hit-wins order holds. Both halves negative-tested. | `scripts/cf_dns.sh` credential section |
| **F10** | The same script's failure message told the operator to create the env file `from ops/env/cloudflare.env.example`, which does not exist and should not: `ops/env/` holds the six container templates audited against `ENV_ENTRIES`, and this token belongs to the operator's laptop rather than to any container. **Fixed**: the three required entries are documented inline in the script header instead. | `scripts/cf_dns.sh` header |
| **F11** | **Steering now contradicts steering, and no precedence line resolves it.** `.kiro/steering/two-agent-vps.md` section 2 puts "any use of a production secret" in its STOP-and-record column. The newer `.kiro/steering/cloudflare-dns.md` item 5 says "Reads are free, writes are gated", and declares precedence only against `docs/CLOUDFLARE_DNS_SETUP_G2.md` - not against `two-agent-vps.md`. Both are canonical, both load, and they disagree on whether an agent may authenticate with the owner's zone token in order to read. The same question was already answered once by exception rather than by rule: the two read-only bot calls in section 4 are labelled agent-run **owner-directed**, which is a waiver, not a standing permission. Owner decision: either add an explicit read-only carve-out to `two-agent-vps.md` section 2 and cite it from the newer file, or narrow item 5 to match. Leaving two canonical files disagreeing means the next session obeys whichever it happens to read first. | this row; `.kiro/steering/cloudflare-dns.md` item 5 vs `.kiro/steering/two-agent-vps.md` section 2 |

### Independent evidence for the G2 blocker, from the operator's own configuration

`.secrets/cloudflare.env` (gitignored, never committed) holds a token, and `CF_ZONE_NAME`, `CF_ZONE_ID`
and `HOST_IP` are all **empty**. Read by field name and emptiness only; no value was printed. Two
consequences worth acting on: the empty zone fields are independent confirmation that no domain exists
yet, which is exactly what G2 is blocked on and is now attested by something other than a chat message;
and `HOST_IP` being empty means `resolve`'s match check silently degrades to printing the answer without
comparing it, so filling it in is what turns that command into real evidence rather than an observation.

**Three of these are deferred `ops/**` edits, not oversights.** F3, F5 and F6 all want a line in
`ops/GATE_REGISTER.md`, and `ops/**` is scanned for declared dotted tokens, so any new filename reference
there needs a matching entry in `src/server/ops/deploymentParticulars.ts` and its sibling list. Doing that
as a side effect of a documentation increment is how a scanner allowlist quietly grows. They belong to the
next ops increment, together.
