# Hermes single-window Slack deployment

Owning authority: PFOS Contracts 12 and 14 (v2), money rules, Drive scope rules.
Status: deployment templates only. Not executed by repository tests or agents.
v2 (2026-08-31): Telegram revoked completely. Slack Socket Mode is the sole transport.

## Active profile: nizam-ingress (Slack)

One Hermes gateway process, one Slack workspace, one allowlisted operator.

- `nizam-ingress` runs as the live gateway on the VPS.
- Hermes 0.15.2 is installed at `/opt/nizam/hermes` (VPS, isolation virtualenv).
- The profile home, config file, and protected env file are separate from the internal profiles.

The gateway must not start until all of the following are true:

1. The Slack app is created from the Hermes-generated manifest (`hermes slack manifest --agent-view --write`).
2. `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are installed in the protected env file.
3. `SLACK_ALLOWED_USERS` contains only the owner's Slack member ID.
4. All Telegram pollers are stopped and tokens revoked through BotFather.
5. The OpenRouter key and weekly cap are present and non-provisional.
6. The NIZAMCORE and PFOS adapters are installed and their contract tests pass.
7. A round-trip test proves inbound delivery and response delivery.

Hermes is the interface and model runtime. It does not become the financial source of truth.
PFOS deterministic engines remain the only financial writer and calculator.

## Internal profiles: nizam and pfos (rollback only)

The `nizam` and `pfos` profile homes remain as isolated internal tool-execution boundaries
and as rollback. They do not run as live gateways while `nizam-ingress` is active.
They must not poll at the same time as `nizam-ingress`.

## Templates

### Active ingress (Slack)

- `nizam-ingress.service.example` — systemd unit for the Slack gateway
- `nizam-ingress.env.example` — protected environment template (Slack credentials)
- `nizam-ingress.config.yaml.example` — Hermes model + Slack platform config

### Internal profiles (rollback)

- `nizam.service.example`, `nizam.env.example`, `nizam.config.yaml.example`
- `pfos.service.example`, `pfos.env.example`, `pfos.config.yaml.example`

## Hermes version

Use the installed VPS line (Hermes 0.15.2 in `/opt/nizam/hermes`).
If Slack Socket Mode requires a newer version, upgrade via the `.whl` in the toolkit before starting.
Do not install Hermes on the development laptop.

## Rollback

If the Slack gateway fails, stop it, restore `config.yaml` and env from backup, and
restart the internal profiles (nizam/pfos) independently with separate Telegram tokens
minted fresh. The NIZAM canonical data stores are unaffected by gateway rollback.
