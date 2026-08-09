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
| G2 DNS for two hostnames | **no zone yet** | Still blocked on the single missing input: a domain / DNS zone does not yet exist. Intended host Cloudflare. Records must be **A -> host, grey cloud (DNS only)**. |
| G3 two bots | hardening + verification + a place to put tokens | **Two bot identities now exist** (created 2026-08-09), so the creation half has moved; Hardening, distinctness and the operator identifier were then **verified live** at 23:57 local on 2026-08-09 (see §4). G3 stays `BLOCKED` on two things only: **placement** (needs G1's config dir) and **rotation** of the two disclosed tokens. Only **placement** needs G1's config dir. A step-by-step walkthrough (`docs/TELEGRAM_BOTS_SETUP_G3.md`) and a transport value ledger (`TELEGRAM_VALUE_LEDGER.md`, this folder) were authored 2026-08-09 and carry three findings: F1 the allowlist delimiter is undeclared and nothing reads the environment yet (decision **D-ALLOWLIST**), F2 `MAX_CONNECTIONS` is verified against a value stored nowhere, F3 G3's verification does not assert G3 step 3 although `getMe` makes it machine-checkable. |
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

### Disclosure obligation - both tokens must be rotated before G6

Both tokens were disclosed to a third-party assistant chat at creation time, and are currently held in
`.secrets/telegram-bots.env` on the development machine. Two consequences, and neither is optional:

- **Rotate both with BotFather `/token` before G6 registers a webhook.** Rotation is free while nothing
  depends on the values; after G6 it costs a same-sitting update of the environment file and the webhook
  registration, or that bot goes dark. A disclosed bot token lets a holder register its own webhook and
  receive every delivery, which is exactly the reachability G6 exists to control.
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
