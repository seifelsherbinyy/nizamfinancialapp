# NIZAM credential alias registry

> Owning authority: PFOS Contracts 12 and 14 (v2), `docs/PFOS_SECRETS_PLAN.md`, money rules, Drive scope.
> Status: locator only. This file holds **no secret value**.
> Privacy class: `private_github` / `review_before_commit`.
> v2 (2026-08-31): Telegram aliases revoked. Slack Socket Mode aliases replace them.

This is the non-secret control plane for aliases. A broker may resolve an alias into an
authorized process environment. It may never print, log, commit, or upload the value.

## Tiers

| Tier | Who may hold the value | Typical home |
|---|---|---|
| T0 | Human only | password manager |
| T1 | Infrastructure / host broker | `/etc/nizam/*.env` mode 600 |
| T2 | Authorized runtime APIs | injected EnvironmentFile |
| T3 | Ephemeral session | process memory only |

## Live aliases (Slack v2)

| Alias | Provider | Scope | Permitted process | Tier | Lifecycle |
|---|---|---|---|---|---|
| `SLACK_BOT_TOKEN` | Slack | xoxb bot token | Hermes ingress gateway only | T1/T2 | **REQUIRED for live ingress.** Owner creates via Slack app install. |
| `SLACK_APP_TOKEN` | Slack | xapp app-level token, `connections:write` | Hermes ingress gateway only | T1/T2 | **REQUIRED for Socket Mode.** Owner creates in Slack app settings. |
| `SLACK_ALLOWED_USERS` | Slack | owner member ID allowlist | ingress gateway | T2 | required; not a credential |
| `SLACK_HOME_CHANNEL` | Slack | scheduled delivery channel | ingress gateway | T2 | operator sets; not a credential |
| `SLACK_ALLOWED_CHANNELS` | Slack | approved channel list | ingress gateway | T2 | operator sets; not a credential |
| `ALLOWED_USER_IDS` | Slack | owner allowlist | ingress + both internal profiles | T2 | maps to `SLACK_ALLOWED_USERS` |
| `OR_KEY_LIFE` | OpenRouter | ingress / life model | nizam profile | T1/T2 | required before live model calls |
| `OR_KEY_FINANCE` | OpenRouter | PFOS model path | pfos tools | T1/T2 | required for isolated finance cap |
| `OPENROUTER_API_KEY` | OpenRouter | Hermes name | Hermes profile env | T2 | mapped from the profile's `OR_KEY_*` |
| `LIFE_WEEKLY_CAP` | OpenRouter | life spend ceiling | nizam profile | T2 | not a secret |
| `FINANCE_WEEKLY_CAP` | OpenRouter | finance spend ceiling | pfos tools | T2 | not a secret |
| `NIZAM_KILL_ALL` | local | coarse halt | every runtime | T2 | `0` or `1` only |
| `VITE_GOOGLE_CLIENT_ID` | Google | `drive.file` SPA | browser PWA | T2 | public client id |
| `VITE_GOOGLE_API_KEY` | Google | Picker + Drive API | browser PWA | T2 | referrer-locked |
| `DRIVE_REFRESH_TOKEN` | Google | backup / archive grant | backup process | T1 | G5; never on Drive |
| `CLOUDFLARE_API_TOKEN` | Cloudflare | DNS G2 | owner DNS script | T0/T1 | human-gated writes |

## Revoked aliases (Telegram — complete revocation)

All Telegram aliases are revoked. No live process may reference them.
The owner revokes tokens through BotFather before the Slack gateway starts.

| Alias | Former provider | Lifecycle |
|---|---|---|
| `BOT_NIZAM_TOKEN` | Telegram | REVOKED |
| `BOT_A_TOKEN` | Telegram | REVOKED |
| `BOT_B_TOKEN` | Telegram | REVOKED |
| `TELEGRAM_BOT_TOKEN` | Telegram | REVOKED |
| `TELEGRAM_ALLOWED_CHATS` | Telegram | REVOKED |
| `LIFE_WEBHOOK_SECRET` | Telegram webhook | REVOKED |
| `MONEY_WEBHOOK_SECRET` | Telegram webhook | REVOKED |
| `NIZAM_WEBHOOK_SECRET` | Telegram webhook | REVOKED |

## Mapping the broker must apply

```text
SLACK_BOT_TOKEN      → SLACK_BOT_TOKEN        (ingress Hermes env — identity map)
SLACK_APP_TOKEN      → SLACK_APP_TOKEN        (ingress Hermes env — identity map)
ALLOWED_USER_IDS     → SLACK_ALLOWED_USERS    (ingress Hermes env)
OR_KEY_LIFE          → OPENROUTER_API_KEY     (ingress Hermes env)
OR_KEY_FINANCE       → OPENROUTER_API_KEY     (pfos tool env only)
```

Copying `ops/env/life.env` or `finance.env` verbatim into Hermes or nizamcore is forbidden.
Those files use different names on purpose.

## Audit record

An audit line may contain: alias name, caller module, operation (`resolve` / `refuse` /
`presence-check`), timestamp, outcome. It must never contain a credential value, token
prefix, bot username, numeric sender id, webhook path, or Slack workspace ID.

## Owner delivery rule

The owner places values in a gitignored holding file or the host EnvironmentFile.
Agents may run value-blind presence checks and must refuse a paste in chat.
