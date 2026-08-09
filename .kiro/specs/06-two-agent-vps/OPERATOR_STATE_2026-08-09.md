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
| G3 two bots | nothing but a place to put tokens | Creation is unblocked and can be done today; only **placement** needs G1's config dir. A step-by-step walkthrough (`docs/TELEGRAM_BOTS_SETUP_G3.md`) and a transport value ledger (`TELEGRAM_VALUE_LEDGER.md`, this folder) were authored 2026-08-09 and carry three findings: F1 the allowlist delimiter is undeclared and nothing reads the environment yet (decision **D-ALLOWLIST**), F2 `MAX_CONNECTIONS` is verified against a value stored nowhere, F3 G3's verification does not assert G3 step 3 although `getMe` makes it machine-checkable. |
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

## 4. What an agent did in this snapshot, and did not

**Did:** recorded the host-exists observation under G1 (no particular, status unchanged, harness
`gateRegister.test.ts` 43/43 green, AC18 particular-scan green); wrote this observation; wrote the
human handoff; kept every particular in the two untracked `outputs/` files.

**Did not:** provision, harden, create a bot, mint a key, register a webhook, generate a keypair,
apply any cross-repo patch, or tick any box in `tasks.md`. Those remain the owner's, exactly as the
register requires.
