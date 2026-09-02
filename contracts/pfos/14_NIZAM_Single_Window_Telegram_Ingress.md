# NIZAM Single-Window Slack Ingress

> **PROVENANCE: NIZAM-DERIVED.** Originally authorised by the owner's 2026-08-24 Option B
> decision (one primary Telegram bot). Amended 2026-08-31 by owner decision: Telegram killed
> completely; Slack Socket Mode replaces it as the sole conversational window.
> Derived from PFOS Contracts 06, 12, and 13, UPOI design sections 5 and 6, historical
> `two-agent-vps.md` isolation rules, `money-rules.md`, and `drive-db.md`.
>
> **Status:** IN FORCE for the ingress surface only. It does **not** supersede Contract 12
> isolation, Contract 06 store topology, or money/Drive invariants. Contract 13's two-bot
> *Telegram identity* drawing is replaced entirely for live traffic; its internal
> dual-profile, dual-store, dual-cap drawing remains.
>
> **v2 change:** Telegram is revoked at all levels. All Telegram bot aliases are no longer
> live. Slack credentials replace them. The routing contract, store isolation, and money
> rules are unchanged.
>
> **Privacy:** architecture and aliases only. No secret values, hostnames, workspace IDs,
> Slack member IDs, channel IDs, Drive IDs, webhook paths, or ledger figures.

## 1. Purpose

Give the owner one Slack workspace window that can switch between NIZAMCORE life work and
PFOS/MAL financial work without merging repositories, stores, or financial authority.

## 2. Topology

```text
USER
 └─ Slack (Desktop / Mobile)
      └─ NIZAM Hermes App  (Socket Mode, agent view)
           → Hermes gateway (one process, one allowlist)
                → NIZAM ingress router (deterministic first)
                     ├─ nizam tools   TAFRIGH YAWMIYAT SHURA NAQD QARAR THABAT
                     └─ pfos tools    deterministic PFOS/MAL only
```

Slack is an interface. Hermes is an execution runtime. The router is governance, not
a second money engine. Profiles `nizam` and `pfos` remain internal tool/store/cap
boundaries. They are not separate live Slack identities.

## 3. What stays isolated (unchanged from v1)

- `life.db`, `finance.db`, and `signals.db` remain separate. No cross-database ATTACH.
- OpenRouter keys and weekly caps remain distinct (`OR_KEY_LIFE` / `OR_KEY_FINANCE`,
  `LIFE_WEEKLY_CAP` / `FINANCE_WEEKLY_CAP`) even when only one Slack app is live.
- PFOS remains the only writer and the only source of monetary magnitudes.
- Integer milliunits only. One EGP = 1000 milliunits. No floating-point money.
- Drive remains `drive.file` only and never stores keys.
- Strict-local material has no egress path.
- Human gates G1 through G8 stay human. This contract does not complete, test, or mark them.

## 4. What changes (v2)

- All Telegram bot aliases are revoked: the owner revokes through BotFather and confirms
  no live poller exists before the Slack gateway starts.
- Live Slack ingress uses exactly two Hermes credentials: `SLACK_BOT_TOKEN` (xoxb prefix)
  and `SLACK_APP_TOKEN` (xapp prefix, `connections:write` scope for Socket Mode).
- Allowlist migrates to `SLACK_ALLOWED_USERS` (Slack member IDs). The `ALLOWED_USER_IDS`
  alias maps to this entry.
- Channel restriction uses `SLACK_ALLOWED_CHANNELS` and `SLACK_HOME_CHANNEL` for scheduled
  delivery. All other channels are ignored by policy.
- A stolen bot token reaches the Slack window only. Internal grants still fail closed, so
  the token is not a second PFOS writer.
- Mention requirement is enforced in channel contexts (`require_mention: true`). DM to the
  Hermes app requires no mention. Thread continuation in an active Hermes session requires
  no repeat mention.
- Bot-to-bot triggering is disabled (`allow_bots: none`).

## 5. Routing rule (unchanged from v1)

Classification is deterministic first. An LLM may explain a routed result; it may not
choose a monetary figure or widen a grant.

| Message class | Target | Authority |
|---|---|---|
| dump / journal / yawmiyat | nizamcore journal tools | nizamcore |
| plan / debate / critique | SHURA / NAQD tools | nizamcore |
| decision / continuity | QARAR / THABAT | nizamcore |
| money / budget / debt / forecast / balance | `pfos.*` | PFOS engines |
| mixed narrative plus money | nizamcore narrative plus PFOS facts by reference | both; numbers from PFOS only |
| secret, host, credential, commit, unknown write | refuse / `BLOCKED_HUMAN` | nobody |

Weak classification produces one clarifying question and zero effect.

## 6. Secret aliases this contract names (v2)

Named only. Values never appear in this repository.

- Live ingress: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`
- Allowlist: `SLACK_ALLOWED_USERS` / `ALLOWED_USER_IDS`
- Channel config: `SLACK_HOME_CHANNEL`, `SLACK_ALLOWED_CHANNELS` (not secrets; operator sets)
- Kill switch: `NIZAM_KILL_ALL`
- Model: `OR_KEY_LIFE` (ingress default), `OR_KEY_FINANCE` (PFOS tool path)
- Revoked: all Telegram bot aliases (see ALIAS_REGISTRY for the full revocation list)

The approved holding place on the host is a root-owned mode-600 environment file.
Chat, tickets, tracked docs, Drive, and Git are not approved secret homes.

## 7. Acceptance

Offline: ingress policy tests, router tests, gateway-template audit, secret-scan clean.
Live (human, later): Slack app created from Hermes manifest; credentials installed on VPS;
Telegram pollers stopped and tokens revoked; Hermes gateway started; DM round-trip succeeds;
PFOS route returns integer milliunits; journal route creates local record; unauthorized
channel ignored; unauthorized user DM ignored; slash commands work; bot-to-bot triggering
blocked. `NIZAM_UNIFIED_RUNTIME_READY` is printed only after those live observations.

## 8. Hermes Slack configuration policy

The Hermes gateway process for `nizam-ingress` uses Socket Mode. The Slack app is created
from the Hermes-generated manifest (`hermes slack manifest --agent-view --write`). No manual
scope or event invention. The app name in the owner's private Slack workspace is `NIZAM Hermes`.

Slack AI is a separate optional retrieval layer. It does not replace NIZAM persistence or
financial truth. Canonical state path: Slack to Hermes to HIMAYAH to NIZAM to approved
local/Drive/GitHub persistence. Never: Slack as memory, Slack as ledger, Slack as journal.

## 9. Owner-only offline composition

`src/server/process/singleWindowFlow.ts` remains the offline rehearsal of the routing
window: one namespace, one allowlisted sender, deterministic routing, PFOS-only money,
local journal append, secret-seeking refusal. Platform credential checks are bypassed in
the offline mode by design.
