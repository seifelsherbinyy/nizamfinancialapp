# ops/hermes/WHOOP_RUNBOOK.md
# Personal Health (WHOOP → Hermes) Operational Runbook
# VPS: <WHOOP_VPS_ADDRESS> (<WHOOP_VPS_HOSTNAME>)
# Service root: /opt/personal-health/
#
# THIS IS A RUNBOOK, NOT A SCRIPT: every value in <ANGLE_BRACKETS> resolves only in the
# operator's own session or the host's secret store (owner decision D8, 2026-09-02). No
# deployment particular is tracked in this file.

## Quick Status

```bash
ssh nizam@<WHOOP_VPS_ADDRESS>
docker ps --filter name=personal-health --format 'table {{.Names}}\t{{.Status}}'
docker exec personal-health-postgres psql -U postgres -d personal_health \
  -c 'SELECT data_type, last_synced FROM sync_state;'
```

## Services

| Container | Role | Port |
|---|---|---|
| `personal-health-caddy` | TLS reverse proxy (Let's Encrypt) | 443 |
| `personal-health-postgres` | PostgreSQL 16 | <WHOOP_POSTGRES_BIND> |
| `personal-health-sync` | FastAPI: OAuth callback + webhook handler | internal 8080 |
| `personal-health-mcp` | Stdio MCP server (read-only) | stdio |

## Restart All

```bash
cd /opt/personal-health && docker compose up -d
```

## Token Expiry Recovery

Tokens expire in 1 hour. The sync service refreshes automatically on each request.
If refresh fails (e.g. server was down during rotation):

```bash
# Re-authorize manually
# 1. Generate new auth URL (run on local machine):
python3 -c "
import urllib.parse, secrets
print('https://<WHOOP_API_BASE>/oauth/oauth2/auth?' + urllib.parse.urlencode({
  'client_id': '<WHOOP_CLIENT_ID>',
  'redirect_uri': 'https://<WHOOP_VPS_HOSTNAME>/whoop/callback',
  'response_type': 'code',
  'scope': 'offline read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement',
  'state': secrets.token_hex(4),
}))"
# 2. Open URL in browser, authorize with WHOOP account
# 3. Callback will auto-save new tokens to /opt/personal-health/data/tokens.json
```

## Manual Reconciliation

```bash
# Run 7-day reconciliation immediately
WRITER_PW=$(grep POSTGRES_WRITER_PASSWORD /opt/personal-health/.env | cut -d= -f2)
docker run --rm --network personal-health-net \
  -v /opt/personal-health/sync:/code:ro \
  -v /opt/personal-health/data:/data:rw \
  -e POSTGRES_URL="postgresql+asyncpg://whoop_writer:${WRITER_PW}@postgres:5432/personal_health" \
  -e WHOOP_CLIENT_ID=$(grep WHOOP_CLIENT_ID /opt/personal-health/.env | cut -d= -f2) \
  -e WHOOP_CLIENT_SECRET=$(grep WHOOP_CLIENT_SECRET /opt/personal-health/.env | cut -d= -f2) \
  -e TOKEN_STORE_PATH=/data/tokens.json \
  personal-health-sync:latest python3 /code/reconcile.py
```

## Webhook Failure Investigation

```bash
# Check recent webhook events
docker exec personal-health-postgres psql -U postgres -d personal_health \
  -c 'SELECT trace_id, event_type, object_id, received_at, processed, error
      FROM webhook_events ORDER BY received_at DESC LIMIT 20;'

# Check sync service logs
docker logs personal-health-sync --tail 50

# Test webhook endpoint manually (replace SECRET with value from .env)
SECRET=$(grep WHOOP_WEBHOOK_SECRET /opt/personal-health/.env | cut -d= -f2)
TS=$(date +%s%3N)
BODY='{"user_id":<WHOOP_TEST_USER_ID>,"id":"test-id","type":"recovery.updated","trace_id":"test-001"}'
SIG=$(echo -n "${TS}${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)
curl -X POST https://<WHOOP_VPS_HOSTNAME>/whoop/webhook \
  -H "Content-Type: application/json" \
  -H "X-Whoop-Signature: $SIG" \
  -H "X-Whoop-Signature-Timestamp: $TS" \
  -d "$BODY"
```

## PostgreSQL Backup

```bash
# Manual backup
docker exec personal-health-postgres pg_dump -U postgres personal_health | \
  gzip > /opt/personal-health/backup/ph_$(date +%Y%m%d_%H%M).sql.gz

# List backups
ls -lh /opt/personal-health/backup/
```

## DB Restore

```bash
# Stop sync service (prevent writes during restore)
cd /opt/personal-health && docker compose stop whoop-sync

# Restore
zcat /opt/personal-health/backup/ph_YYYYMMDD_HHMM.sql.gz | \
  docker exec -i personal-health-postgres psql -U postgres -d personal_health

# Restart
docker compose up -d whoop-sync
```

## Credential Locations

| Credential | Location | Mode |
|---|---|---|
| WHOOP client_id + client_secret | `/opt/personal-health/.env` | 0600 |
| WHOOP access/refresh tokens | `/opt/personal-health/data/tokens.json` | 0600 |
| DB passwords | `/opt/personal-health/.env` | 0600 |
| MCP-only env (no WHOOP) | `/opt/personal-health/.env.mcp` | 0600 |

**NEVER put WHOOP credentials in:**
- Hermes config.yaml
- MCP container env
- Git
- Slack messages

## Cron Schedule (Phase 6)

Set up on VPS crontab (`crontab -e`):
```
# Reconciliation every 6 hours
0 */6 * * * /opt/personal-health/scripts/reconcile.sh >> /opt/personal-health/logs/cron.log 2>&1
```
