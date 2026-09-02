# NIZAM Hermes Slack Gateway — VPS Operator Runbook

> **Owning authority:** PFOS Contract 14 (v2); Contract 12.
> **Status:** Human-operator runbook. Not executed by agents or tests.
> **Platform:** OVHcloud VPS, Linux x86_64.
> **Hermes:** 0.15.2 at `/opt/nizam/hermes` (virtualenv). Upgrade to 0.19.0 if Slack
> Socket Mode requires it — the wheel is available in the toolkit.
> **Privacy:** No secret values, hostnames, workspace IDs, member IDs, or channel IDs.
> All deployment particulars go into the host secret store only.

This runbook is executed by the owner in their own SSH session after repository code passes
all local checks. Nothing in this file is auto-executed.

---

## Prerequisites (confirm before starting)

- [ ] Local `npm run verify:all -- --all` passes (or failures are known pre-existing)
- [ ] VPS SSH access is working
- [ ] Telegram pollers confirmed stopped (check process list on VPS)
- [ ] Telegram tokens revoked through BotFather
- [ ] Slack workspace created with five channels
- [ ] Slack app created from the Hermes manifest (see Phase A below)
- [ ] Both Slack tokens obtained (`SLACK_BOT_TOKEN` xoxb-… and `SLACK_APP_TOKEN` xapp-…)
- [ ] Your Slack member ID copied from Profile settings

---

## Phase A — Create the Slack App (browser, before VPS work)

1. On the VPS, run: `<HERMES_EXECUTABLE> slack manifest --agent-view --write`
   This generates a manifest in the Hermes home directory.
2. Open Slack App Management in your browser (Slack settings > Manage apps)
3. Create New App → From an app manifest → Select your NIZAM workspace
4. Paste the generated manifest. Name the app `NIZAM Hermes`.
5. Under Basic Information → App-Level Tokens → Generate Token and Scopes
   - Name: `hermes-socket`
   - Scope: `connections:write`
   - Record the `xapp-…` token securely
6. Under OAuth and Permissions → Install to Workspace → Approve
   - Copy the Bot User OAuth Token (`xoxb-…`) securely
7. Copy your Slack Member ID from Profile → More → Copy member ID

---

## Phase B — Stop Telegram (VPS SSH session)

```bash
# Check for any running Telegram pollers
ps aux | grep -E 'hermes|telegram'
# Stop them (adjust unit names to actual service names)
systemctl stop <LEGACY_TELEGRAM_UNIT> 2>/dev/null || true
# Confirm stopped
systemctl is-active <LEGACY_TELEGRAM_UNIT> 2>/dev/null || echo "stopped"
```

---

## Phase C — Install credentials (VPS SSH session, root or sudo)

```bash
# Create the protected env file — fill in your real values
cat > <HOST_NIZAM_ENV_PATH> << 'EOF'
HERMES_HOME=<NIZAM_INGRESS_HERMES_HOME>
SLACK_BOT_TOKEN=<YOUR_XOXB_TOKEN>
SLACK_APP_TOKEN=<YOUR_XAPP_TOKEN>
OPENROUTER_API_KEY=<YOUR_OR_KEY_LIFE_VALUE>
SLACK_ALLOWED_USERS=<YOUR_SLACK_MEMBER_ID>
SLACK_HOME_CHANNEL=<YOUR_HOME_CHANNEL_ID>
SLACK_ALLOWED_CHANNELS=<COMMA_SEPARATED_CHANNEL_IDS>
NIZAM_KILL_ALL=0
EOF
chmod 600 <HOST_NIZAM_ENV_PATH>
chown root:root <HOST_NIZAM_ENV_PATH>
# Presence-check (never print values)
grep -c '^SLACK_BOT_TOKEN=' <HOST_NIZAM_ENV_PATH>
grep -c '^SLACK_APP_TOKEN=' <HOST_NIZAM_ENV_PATH>
```

---

## Phase D — Deploy config and invite Hermes (VPS SSH session)

```bash
# Copy config template to the profile home
cp <NIZAM_INGRESS_HERMES_HOME>/config.yaml.example <NIZAM_INGRESS_HERMES_HOME>/config.yaml
# Update config if needed (editor of choice)
# Fill in actual channel IDs for allowed_channels

# Install the systemd service
cp <PATH_TO_REPO>/ops/hermes/nizam-ingress.service.example /etc/systemd/system/<INGRESS_UNIT_NAME>.service
# Edit the service file to replace all <PLACEHOLDER> values with real paths
# Then reload and enable
systemctl daemon-reload
systemctl enable <INGRESS_UNIT_NAME>
```

---

## Phase E — Foreground test (VPS SSH session)

```bash
# Run gateway in foreground FIRST — do not install auto-start yet
HERMES_HOME=<NIZAM_INGRESS_HERMES_HOME> <HERMES_EXECUTABLE> gateway run
```

In Slack Desktop, send a DM to NIZAM Hermes:
```
Hello. Reply with SLACK-HERMES-OK.
```
Expected response: `SLACK-HERMES-OK`

If no response within 30 seconds: **STOP. Check gateway logs. Do not proceed.**

---

## Phase F — Gate tests (before auto-start)

Run each test manually:

```text
GATE 1 — DM response:          Send DM → expect reply
GATE 2 — slash commands:       /help /model /new /stop
GATE 3 — channel mention:      @NIZAM Hermes reply BUILD-OK in #nizam-build
GATE 4 — thread continuation:  reply in Hermes thread without mention
GATE 5 — unauthorized channel: mention in non-allowlisted channel → no response
GATE 6 — unauthorized user:    DM from second account → no response
GATE 7 — PFOS route:           "what is my balance?" → integer milliunits in reply
GATE 8 — journal route:        "journal: test entry" → local record created
```

All 8 gates must pass before enabling auto-start.

---

## Phase G — Enable auto-start (VPS SSH session)

```bash
systemctl start <INGRESS_UNIT_NAME>
systemctl status <INGRESS_UNIT_NAME>
# Reboot test
reboot
# After reboot: check gateway auto-started
systemctl is-active <INGRESS_UNIT_NAME>
# Send DM: production-check
```

---

## Phase H — Print readiness statement

Only after all gates pass and auto-start confirmed:

```
NIZAM_UNIFIED_RUNTIME_READY
Platform: Slack Socket Mode
Profile: nizam-ingress
VPS: confirmed
Telegram: revoked
Gates 1-8: PASS
```

---

## Rollback

```bash
systemctl stop <INGRESS_UNIT_NAME>
systemctl disable <INGRESS_UNIT_NAME>
# Restore config if needed from backup
# NIZAM data stores (life.db, finance.db, signals.db) are unaffected
```

---

## Troubleshooting

| Symptom | First check |
|---|---|
| Gateway exits immediately | `journalctl -u <INGRESS_UNIT_NAME> -n 50` |
| DM ignored | `SLACK_ALLOWED_USERS` has the right member ID |
| Channel ignored | Channel ID in `SLACK_ALLOWED_CHANNELS`; bot invited with `/invite @NIZAM Hermes` |
| Slash commands missing | Regenerate manifest and reinstall app |
| Works foreground, not on start | `systemctl status` and check env file path |
| Wrong HERMES_HOME loaded | `echo $HERMES_HOME` in the service environment |
