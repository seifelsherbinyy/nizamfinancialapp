# Operator handoff - two-agent VPS - 2026-08-09

**BLUF.** The host is bought and live, so gate G1's precondition is met but its hardening is not done.
Two bots now exist, are hardened, and were verified live at 23:57 on 2026-08-09 along with your allowlist
identifier, so G3 is down to two open items: rotate both tokens (they were disclosed in a chat) and place
them once G1 exists. Two things beyond the gates still block a running
deployment, and four decisions are owed. Nothing here contains a deployment particular - those are in the untracked file
`outputs/DEPLOYMENT_PARTICULARS.local.md` (gitignored). This repo is public; keep it that way.

Authoritative sources this summarises, in fetch order for a Kiro session:
1. `ops/GATE_REGISTER.md` - gate meaning, steps, verification (a G1 recorded observation was added).
2. `.kiro/specs/06-two-agent-vps/OPERATOR_STATE_2026-08-09.md` - machine-readable state + build findings.
3. `outputs/OPERATOR_URL_WORKSHEET.md` - every console URL, what to click, what value returns (untracked).
4. `outputs/DEPLOYMENT_PARTICULARS.local.md` - the host facts (untracked).
5. `docs/TELEGRAM_BOTS_SETUP_G3.md` - gate G3 step by step: create, harden and verify the two bots.
6. `.kiro/specs/06-two-agent-vps/TELEGRAM_VALUE_LEDGER.md` - which transport value goes in which file, and the command that proves it (G3 + G6). Fill-in card: `outputs/BOT_SETUP_WORKSHEET.local.md` (untracked).

## Where things stand

| Gate | State | Your next move |
|---|---|---|
| G1 host | **host exists, active; not hardened** | SSH in, run register G1 steps 2-9 (operator user, key-only login, default-deny firewall, container runtime, swap, root-owned config dir). |
| G2 DNS | **blocked: no domain yet** | Own a domain, point two A records at the host, **grey cloud**, no bus record. This is the one input that unblocks the reachability chain. |
| G3 bots | **two bots exist and are verified; both tokens still disclosed** | Verified live 2026-08-09 23:57: join-groups off on both (observed `true` then `false`, so the change is evidenced), privacy value correct, `ok`/`is_bot` true, the two bot ids differ, your numeric id read via `getUpdates` on both bots, and `getWebhookInfo` confirms no webhook exists. Open: **rotate both with `/token`**, move the new tokens to the password manager rather than `.secrets/`, then place them once G1 exists. Steps: `docs/TELEGRAM_BOTS_SETUP_G3.md`. |
| G4 keys | **blocked on D-CAP below** | Two OpenRouter keys with weekly caps + training opt-out. |
| G5 storage | ready once G1 exists | Google `drive.file` consent, **publish the consent screen**, let the uploader create the folder. |
| G6 webhooks | needs G1+G2+G3 | Register both, verify with getWebhookInfo. Last step. |
| G8 backup key | ready once G1 exists | `age` keypair on this laptop, private half to the password manager + one offline copy. The provider's own snapshot does **not** count. |

## Do this first: rotate both bot tokens

Both were pasted into an assistant chat when the bots were created, so treat both as public. A holder of
a bot token can register its own webhook and receive everything you send that bot, which is precisely the
reachability gate G6 exists to control. Rotation is BotFather `/token`, it is free while no webhook is
registered, and it costs nothing to do twice.

The repository is clean and was checked five ways: `.secrets/` is gitignored, was never committed on any
branch, no tracked file holds either bot name or a token-shaped string, and the repo's own secret scanner
passes over all 400 tracked files. The exposure is the chat and the plaintext file on this laptop, not
the repository.

Also move the new tokens out of `.secrets/`. `docs/PFOS_SECRETS_PLAN.md` scopes that directory to
low-privilege development credentials only. A bot token has exactly two homes: your password manager, and
`/etc/<CONFIG_DIR>/*.env` at mode 600 owned by root once G1 creates it.

## One correction to the register's G1 step 4

Open **port 80** as well as the TLS and admin ports. Automatic certificate issuance does an HTTP-01
challenge on 80; the step as written opens only TLS + admin, which would leave the proxy unable to get
its own certificate. Recorded under G1 in the register too.

## Two build-side blockers (not gates - a Kiro session resolves these)

1. **No container images are built by anything in-repo, and the finance agent has no server entrypoint.**
   The compose file names six images as placeholders; there is no Dockerfile and no process that
   listens on the finance port. So `docker compose up` cannot run even after every gate clears. Detail
   and the likely missing spec work: `OPERATOR_STATE_2026-08-09.md` §2 O1.
2. **The eligibility registry is still provisional** - live routing stays gated on G4. The model
   endpoint and all four model slugs were confirmed live, so the benchmark run is now genuinely doable.

## Four decisions owed

- **D-CAP:** cap is 5 **per agent** (=USD 10/week) or 5 **total**? The code pins one number
  (`WEEKLY_BUDGET_USD = 5`); G4 sets two caps to it. Twice your stated ceiling unless you rule.
- **D-WAL:** take outcome **B** (default). Unblocks rollback across a migration.
- **D-BENCH:** authorize one benchmark pass (~1/3 of the dev key's weekly allowance) or leave routing off.
- **D-G5:** publish the OAuth consent screen (else the token dies on day 8); let the uploader create the
  backup folder (a hand-made one is unreachable under `drive.file`).

## What I need from you

Confirmation that both tokens are rotated. Domain plus registrar. Which Google account owns backups. The
D-CAP ruling. (Your numeric Telegram id is no longer needed - it was read from your own bots and is
recorded in the untracked worksheet.) Then I can prep the G2 records (with a `Zone DNS Edit`
scoped token, path in the worksheet) and draft the finance-agent entrypoint plus Dockerfiles as a spec
increment for O1.

Never paste a token, a webhook secret or a refresh token into a chat, including to an assistant. If you
need something confirmed, the answer is always a count or an observation, never the value.
