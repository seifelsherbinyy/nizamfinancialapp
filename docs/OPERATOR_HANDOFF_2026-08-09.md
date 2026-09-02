# Operator handoff - two-agent VPS - 2026-08-09

**BLUF.** The host is bought and live, so gate G1's precondition is met but its hardening is not done.
Both bots exist, are hardened, and were verified live on 2026-08-09 together with your allowlist
identifier, so G3 is down to placement, which waits on G1. Rotation of the three disclosed credentials is
deferred until after practical-use testing by your decision D-ROTATE, and is now the final acceptance test
rather than the first step. G2 is blocked on the one input that does not exist yet: a domain. Two things
beyond the gates still block a running deployment, five decisions are owed and one steering conflict needs
a ruling. Nothing here contains a deployment particular - those are in the untracked file
`outputs/DEPLOYMENT_PARTICULARS.local.md` (gitignored). This repo is public; keep it that way.

Authoritative sources this summarises, in fetch order for a Kiro session:
1. `ops/DEPLOYMENT_CONTROL.md` - gate meaning, steps, verification (a G1 recorded observation was added).
2. `.kiro/specs/06-two-agent-vps/OPERATOR_STATE_2026-08-09.md` - machine-readable state + build findings.
3. `outputs/OPERATOR_URL_WORKSHEET.md` - every console URL, what to click, what value returns (untracked).
4. `outputs/DEPLOYMENT_PARTICULARS.local.md` - the host facts (untracked).
5. `docs/TELEGRAM_BOTS_SETUP_G3.md` - gate G3 step by step: create, harden and verify the two bots.
6. `.kiro/specs/06-two-agent-vps/TELEGRAM_VALUE_LEDGER.md` - which transport value goes in which file, and the command that proves it (G3 + G6). Fill-in card: `outputs/BOT_SETUP_WORKSHEET.local.md` (untracked).
7. `docs/CLOUDFLARE_DNS_SETUP_G2.md` - gate G2 step by step: the two grey-cloud records, verification by resolution, and why the proxy must stay off. Fill-in card: `outputs/DNS_SETUP_WORKSHEET.local.md` (untracked).

## Where things stand

| Gate | State | Your next move |
|---|---|---|
| G1 host | **host exists, active; not hardened** | SSH in, run register G1 steps 2-9 (operator user, key-only login, default-deny firewall, container runtime, swap, root-owned config dir). |
| G2 DNS | **blocked: no domain yet** | Own a domain, point two A records at the host, **grey cloud (DNS only)**, no bus record. Buying the domain at the DNS provider itself removes the nameserver step entirely. Steps and the four reasons proxied is wrong here: `docs/CLOUDFLARE_DNS_SETUP_G2.md`. |
| G3 bots | **two bots exist and are verified; both tokens still disclosed** | Verified live 2026-08-09 23:57: join-groups off on both (observed `true` then `false`, so the change is evidenced), privacy value correct, `ok`/`is_bot` true, the two bot ids differ, your numeric id read via `getUpdates` on both bots, and `getWebhookInfo` confirms no webhook exists. Open: **rotate both with `/token`**, move the new tokens to the password manager rather than `.secrets/`, then place them once G1 exists. Steps: `docs/TELEGRAM_BOTS_SETUP_G3.md`. |
| G4 keys | **blocked on D-CAP below** | Two OpenRouter keys with weekly caps + training opt-out. |
| G5 storage | ready once G1 exists | Google `drive.file` consent, **publish the consent screen**, let the uploader create the folder. |
| G6 webhooks | needs G1+G2+G3 | Register both, verify with getWebhookInfo. Last step. |
| G8 backup key | ready once G1 exists | `age` keypair on this laptop, private half to the password manager + one offline copy. The provider's own snapshot does **not** count. |

## Rotation: deferred by your decision, and now the last test instead of the first

**Decision D-ROTATE, 2026-08-10: nothing is rotated until the deployment is tested in practical use and
you report it working.** Recorded, and this section rewritten rather than left contradicting you. The
earlier instruction here said rotate first; it no longer does.

Three credentials are disclosed: both bot tokens and the Cloudflare zone token. Two things stay true
regardless of when you rotate.

**Before G6 the deferral costs nothing.** There is no webhook, so there is nothing for a token holder to
redirect. **After G6 it costs one API call.** Whoever holds a bot token can `setWebhook` to their own
server and take every delivery, or `deleteWebhook` and take the bot down quietly. So the exposure window
is precisely G6-live-until-rotated, not now.

**Two conditions, both cheap.**

1. **Rotation becomes the final acceptance test.** Not skipped, moved. An unrotated deployment has never
   exercised its own rotation path, and `ops/runbook/DISASTER_RECOVERY.md` assumes that path works.
   Running it last proves the procedure and clears the disclosure in one action. Four steps, one sitting:
   BotFather `/token`, update the one env entry, re-run `setWebhook` with the same secret and path,
   `getWebhookInfo` to confirm. Skip the third and that bot goes dark.
2. **Detection while the disclosed tokens are live.** `getWebhookInfo` on both bots every time you test.
   If `url` is not the path you registered, or `pending_update_count` climbs while the agent is healthy,
   somebody else has used the token. This detects rather than prevents, which is the honest trade once
   prevention is deliberately deferred.

**The zone token is the exception worth taking early.** Nothing in the deployment ever holds it: no
service, no container, no environment file. It is used by hand from this laptop only, so rotating it
breaks nothing and needs no coordinated sitting.

**The repository is clean and was checked five ways:** `.secrets/` is gitignored, was never committed on
any branch, no tracked file holds either bot name or a token-shaped string, the staged diff had zero IPv4
literals and zero token shapes, and the repo's own scanner passes over all 406 tracked files. The exposure
is the chat and the plaintext files on this laptop, not GitHub.

When you do rotate, the new tokens do not go back into `.secrets/`. `docs/PFOS_SECRETS_PLAN.md` scopes
that directory to low-privilege development credentials. A bot token has two homes: your password manager,
and `/etc/<CONFIG_DIR>/*.env` at mode 600 owned by root.

## One correction to the register's G1 step 4

Open **port 80** as well as the TLS and admin ports. Automatic certificate issuance does an HTTP-01
challenge on 80; the step as written opens only TLS + admin, which would leave the proxy unable to get
its own certificate. Recorded under G1 in the register too.

## One thing to get right on the DNS records

Set both records to **DNS only (grey cloud)**, not proxied. The console defaults to proxied and it looks
like the safer choice. It is not, for four reasons, and the first is decisive: a proxied record routes
every delivery through an intermediary whose request log carries the full path and query string, and the
webhook path segment is a secret precisely so it stays out of proxy logs. Contract 12 section 2.2.4 is
the rule; the Caddyfile keeps no access log for the same reason. Proxying would put that secret in a log
you do not own and cannot rotate.

The other three: an intermediary replaces the Caddyfile's closed-connection deny with its own error page,
so a probe learns the hostname is real; the origin can no longer complete its own HTTP-01 challenge; and
only a fixed list of ports is proxied at all, which your admin port is probably not on. Full detail with
citations in `docs/CLOUDFLARE_DNS_SETUP_G2.md` section 6.

Verify by resolution, never by the console. Grey cloud returns your address, orange cloud returns theirs.

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

Domain plus registrar. Which Google account owns backups. The
D-CAP ruling. (Your numeric Telegram id is no longer needed - it was read from your own bots and is
recorded in the untracked worksheet.) Then I can prep the G2 records (with a `Zone DNS Edit`
scoped token, path in the worksheet) and draft the finance-agent entrypoint plus Dockerfiles as a spec
increment for O1.

Never paste a token, a webhook secret or a refresh token into a chat, including to an assistant. If you
need something confirmed, the answer is always a count or an observation, never the value.
