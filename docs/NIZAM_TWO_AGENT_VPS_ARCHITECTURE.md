# NIZAM - Two-Agent, One-VPS Deployment & Operations Architecture

**Author:** Systems architecture review · **Date:** 2026-08-06 · **Status:** RESEARCH + TARGET DESIGN (no secret provisioned by this doc)
**Repos inspected at HEAD:** `nizamcore` (Python, `main`, public) · `nizamfinancialapp` (TypeScript, `master`, public - this repo)
**Scope:** deploy both repos on one VPS as two logically-isolated Telegram agents sharing one OpenRouter account.

> Placeholders only. Every `<...>` is a value you fill in the VPS secret store, never in Git and never on Drive.
> This doc reconciles with - does not replace - `contracts/pfos/02_*`, `docs/PFOS_OPENROUTER_ARCHITECTURE.md`,
> `docs/PFOS_SECRETS_PLAN.md`, and `nizamcore/NIZAM__system/policies/PRIVACY_CLASSIFICATION.json`.

---

## 0. What is actually in the two repos (ground truth, not inference)

### `nizamcore` - the LIFE agent's engine (Python, pure-stdlib runtime core)
- **Working Telegram transport already exists** at `NIZAM__system/relay/`:
  - `webhook.py` - stdlib `http.server` handler; **already implements the CVE-2026-32980 mitigation** (constant-time `hmac.compare_digest` on `X-Telegram-Bot-Api-Secret-Token`) + `NIZAM_TELEGRAM_ALLOWED_IDS` whitelist + `update_id` dedup. Docstring explicitly says *"for production deploy on VPS, swap for FastAPI + uvicorn (I7) and keep `handle_update()` unchanged."*
  - `poller.py` - long-poll alternative (`getUpdates`), `RELAY_MODE=standby|live` gate, signal-safe loop with exponential backoff.
  - `auth.py`, `coordinator.py` (SUKOON pre-gate → router → agent **stub** → HIMAYAH egress → ledger append), `dedup.py` (bounded ring, atomic `os.replace`), `sukoon_gate.py`.
- **Governor** (`NIZAM__system/governor/`): `classifier.py` (privacy class + `EGRESS_MATRIX`), `cost_ceiling.py` ($50 soft / $300 hard / month, `.cost-month.json`), `kill_switch.py` (`NIZAM_KILL_ALL=1`), `ledger_writer.py` (sole writer = "Ammar"), `sync_arbiter.py`.
- **Privacy engine** (`policies/PRIVACY_CLASSIFICATION.json` + `classifier.py`): five tiers with a hard egress matrix.
  - `strict_local_maximum` → **AHEL (family) - set() targets, nothing leaves the machine**.
  - `strict_local` → **MAL (finance), BADAN (health), YAWMIYAT (journaling), SUKOON (recovery)** - laptop/vps-encrypted-volume/drive-crypt/zdr-inference/telegram-operator only.
  - `review_before_commit`, `private_github`, `mirror_sanitized` progressively wider.
- **Model routing** (`config/router.config.yaml`, `agents.registry.yaml`): `backend_provider: openrouter`, rule **R4 = ALL model calls via OpenRouter only**; `deepseek-v4-flash` router-class, reviewer `kimi-k2.6`; ZDR-required before first strict_local egress.
- **BADAN** (`schemas/body_signal.schema.json`) supports `WHOOP / Apple_Health / Garmin / smart_scale / gym_log / manual` - the WHOOP context path exists at the schema level.
- **MAL/pfa** (`MAL__financial_engine/pfa/`): `canonical_state.json` + append-only `debts/payments/decisions.jsonl`, EGP, HSBC cards + BNPL, all `strict_local` (gitignored; only READMEs/schemas committable).
- Test state verified: **55 passed, 14 subtests** (governor + relay).
- **The LLM layer is a deterministic stub today** - `coordinator._agent_stub()` returns canned replies. The transport is proven end-to-end; no model is wired.

### `nizamfinancialapp` (this repo) - the FINANCE agent, PFOS (TypeScript)
- Vite + React + TS PWA, **YNAB-style, Drive-as-database** (`nizam_db.json`), Dexie/IndexedDB offline cache, **money = integer milliunits** (`zMoney` = `z.number().int()`), zod-validated `SCHEMA_VERSION = 4`.
- `src/lib/drive/`: OAuth **WEB** client, `drive.file` scope only, Picker import, `sync.ts` (3-way merge: base=last-synced, local=cache, remote=Drive; both-changed → local-wins + audit `meta.conflicts`), pre-write snapshot `nizam_db.YYYYMMDD-HHmm.json`, optimistic-concurrency on Drive `version`.
- **Deterministic engines built + server-free** (Stages 1-4): `safeToSpend`, `obligations`, `decisions`, `forecast`, `netWorth`, `budget`, `transactions`, `reconciliation`, `reports`, `import`.
- **OpenRouter tier partially built OFFLINE**: `features/benchmark/` (eligibility L0/L1/L2, pricing, cost, runner) + `features/routing/modelPolicy.ts` (K4: `WEEKLY_BUDGET_USD = 5`, default allowed `{mimo, glm}`, premium off unless opt-in, warn 0.70 / restrict 0.85 / disable-premium 0.95).
- Full PFOS server-tier spec exists in `contracts/pfos/` (01-04, 09-11): FastAPI + SQLite+WAL + OpenRouter T0-T4 routing + Telegram + web dashboard + Hermes orchestrator.
- Test state verified: **333 passed (37 files)**.

### The single most important finding - surface, not architecture
**Both repositories are PUBLIC.** `nizamcore` is 92 MB with 48 open issues; a real Drive folder id (`<LIFE_DRIVE_FOLDER_ID>`) is committed in `.env.example`, `DUAL_WRITE_GOVERNOR.md`, `AGENT_MAPPING.json`, and a mermaid diagram. No API secret is tracked (the secret-scan and `.gitignore` are doing their job), but a public repo for a system that will hold mental-health + financial data is itself the top risk. **This is decision D0 below.**

---

## 1. Recommended target architecture

### 1.1 Repository strategy - keep TWO repos, add a THIN shared contract (not a monorepo, not a federated platform)

| Option | Verdict | Why |
|---|---|---|
| **Monorepo** (merge both) | ✗ Reject | Different languages (Python vs TS), different lifecycles, different owners of truth, and - critically - it collapses the consent boundary you are trying to *build*. One repo = one blast radius. |
| **Federated platform** (extract a shared "NIZAM platform" repo both depend on) | ✗ Defer | Correct at 5+ agents; premature at 2. Adds a third release train and a versioning burden for zero present benefit. |
| **Two repos + a small shared contract package** | ✓ **Adopt** | Preserves both repos verbatim (migration constraint), keeps the consent boundary at the repo edge, and lets exactly the pieces that *should* be shared (signal schema, model-router contract) live in one versioned place. |

**Shared contract = one small addition, `nizam-signalbus` (JSON-schema-only, language-neutral).** It defines the *typed signal store* envelope (§1.5) and nothing else. Both agents vendor it; neither imports the other's code. This is the federated idea applied at exactly one seam instead of the whole platform.

```
seifelsherbinyy/nizamcore            (LIFE agent - keep, make private)   ── main
seifelsherbinyy/nizamfinancialapp    (FINANCE agent - keep, make private) ── master
seifelsherbinyy/nizam-signalbus      (NEW - schemas only, ~10 files)     ── main
```

### 1.2 Physical topology on one VPS (Docker Compose, 6 services + Caddy)

```
                          Internet (Telegram servers only reach :443)
                                          │
                                          ▼
                        ┌──────────────────────────────────┐
                        │  caddy  (reverse proxy + TLS)      │   auto-HTTPS, Let's Encrypt
                        │  life.<domain>   → life-agent      │   routed by secret webhook path
                        │  money.<domain>  → finance-agent   │
                        └───────────┬───────────┬────────────┘
                     /tg/<lifepath> │           │ /tg/<moneypath>
                                    ▼           ▼
                 ┌──────────────────────┐   ┌──────────────────────┐
                 │ life-agent           │   │ finance-agent        │
                 │ (nizamcore)          │   │ (nizamfinancialapp)  │
                 │ FastAPI+uvicorn      │   │ Node 24 + TypeScript │
                 │ wraps relay.webhook  │   │ PFOS server tier     │
                 │ SQLite: life.db      │   │ SQLite: finance.db   │
                 │ BOT_A token          │   │ BOT_B token          │
                 │ OR key A (life cap)  │   │ OR key B (fin cap)   │
                 └──────────┬───────────┘   └──────────┬───────────┘
                            │  read-only, consent-gated │
                            └──────────┬────────────────┘
                                       ▼
                    ┌───────────────────────────────────────┐
                    │ signalbus  (append-only typed store)   │  shared, NOT shared secrets
                    │ SQLite: signals.db (WAL) + JSONL mirror│  finance PUBLISHES money-safe
                    │ HTTP on 127.0.0.1 only (never public)  │  life SUBSCRIBES (consent flag)
                    └───────────────────────────────────────┘
        ┌───────────────┐   ┌───────────────┐   ┌────────────────────────────┐
        │ router (opt.)  │   │ scheduler     │   │ backup + drive-connector    │
        │ shared OR      │   │ APScheduler   │   │ VACUUM INTO → age-encrypt    │
        │ client + spend │   │ or systemd    │   │ → Drive 07_Exports_and_     │
        │ ledger         │   │ timers        │   │ Backups (drive.file)         │
        └───────────────┘   └───────────────┘   └────────────────────────────┘
```

**Isolation invariant:** the two agents never share a process, a database file, a bot token, or an OpenRouter key. They share exactly three things, all read-mediated: the **VPS host**, the **OpenRouter *account*** (via two distinct keys), and the **signalbus** (append-only, consent-gated, money-safe payloads only).

### 1.3 Server runtime per agent (SETTLED), and why not the stdlib server / long-poll

**The two agents are polyglot on purpose: each uses the language its already-tested core is written in.**

- **life = Python (FastAPI + uvicorn).** `nizamcore/relay/webhook.py` already isolates
  `handle_update(update, secret_header)` from the transport, and its own docstring prescribes the FastAPI swap
  for production. You wrap - you do not rewrite - the proven core (55 tests).
- **finance = Node 24 + TypeScript (Fastify/Hono, native `node:sqlite`).** PFOS contract 02 says
  "Python + FastAPI", but taken literally for the finance agent that forces a **second integer-milliunit money
  implementation that must stay bit-identical to `src/lib/money/` forever**, and it strands the 333 existing
  tests. Contract 02's intent (a small typed server over SQLite) is honoured; its language choice is overridden
  **for the finance agent only**. This also settles the open decision recorded in
  `.kiro/steering/pfos-current.md`. Ruling recorded in `.kiro/steering/two-agent-vps.md` section 1.
- **INVARIANT: there is exactly one implementation of money, and it is the TypeScript one.**
- Webhook > long-poll on a VPS: you *have* a public HTTPS endpoint (that's the point of the box), so webhook removes the constant outbound `getUpdates` loop, lowers latency, and gives you the `secret_token` header defense-in-depth on top of the secret path. Keep `poller.py` as the **documented fallback** for when the domain/TLS is degraded (it needs no public endpoint).

### 1.4 Two bots, two webhook paths, one proxy

Telegram (verified against `core.telegram.org/bots/api#setwebhook`, 2026-08-06):
- `setWebhook` accepts `secret_token` (1-256 chars `[A-Za-z0-9_-]`) sent back in `X-Telegram-Bot-Api-Secret-Token` on **every** request - both agents already validate this constant-time.
- Webhook ports are restricted to **443 / 80 / 88 / 8443**; Caddy terminates on 443.
- Telegram's own FAQ recommends a **secret path in the URL** (`example.com/<bot_token_or_random>`) as the first authenticity check. We use a **random high-entropy path segment per bot**, *not* the token, so the token never appears in proxy logs.
- `max_connections` default 40 (set 10-20 per bot - a single-operator system needs almost nothing); `allowed_updates` narrowed to `["message","callback_query"]`; `drop_pending_updates=true` on first set to avoid replaying a backlog.

Registration (run once per bot, from the VPS, values from the secret store):
```
curl -sS "https://api.telegram.org/bot<BOT_A_TOKEN>/setWebhook" \
  --data-urlencode "url=https://life.<domain>/tg/<LIFE_WEBHOOK_PATH>" \
  --data-urlencode "secret_token=<LIFE_WEBHOOK_SECRET>" \
  --data-urlencode 'allowed_updates=["message","callback_query"]' \
  --data-urlencode "max_connections=15" \
  --data-urlencode "drop_pending_updates=true"
# repeat with BOT_B_TOKEN → money.<domain>/tg/<MONEY_WEBHOOK_PATH> + MONEY_WEBHOOK_SECRET
```

### 1.5 The shared typed signal store (the one legitimate cross-agent channel)

This is the answer to "shared typed signal store" *and* "secure cross-agent communication" *and* half of the consent model. It is a **narrow, append-only, one-directional-by-default** bus - not a shared database.

- **Storage:** `signals.db` (SQLite WAL) + a JSONL mirror for audit, owned by the `signalbus` service, reachable only on `127.0.0.1` (Docker internal network, never published to Caddy).
- **Envelope (from `nizam-signalbus`):**
```json
{
  "signal_id": "uuid", "ts": "ISO-8601Z", "producer": "finance|life",
  "kind": "money_pressure|recovery_state|whoop_readiness|budget_breach|...",
  "tier": "money_safe|life_safe",           // NEVER strict_local_maximum, NEVER raw financial figures
  "consent_scope": "shared|producer_only",  // subscriber MUST honor
  "payload": { "level": "green|amber|red", "note_<=120chars": "directional only" },
  "hash": "sha256(ts+producer+kind+payload)"
}
```
- **Rule (this is the consent boundary in code):** finance publishes only **directional, de-identified** signals (`money_pressure: amber`, never "you owe 47,000 EGP"). Life publishes only **recovery/readiness** states (`recovery_state: downshift`, never a journal excerpt). Each side runs the *other* repo's privacy classifier posture: nothing classified `strict_local_maximum` is ever eligible, and nothing carrying a raw balance/due-date/journal-text is ever eligible. The `nizamcore` `EGRESS_MATRIX` already models this; the bus reuses it.
- **Why this matters:** the whole point of two agents is that the FINANCE agent can *soften* when the LIFE agent says you're in recovery downshift (SUKOON), and the LIFE agent can *know* there's money pressure without ever seeing the numbers. The signal store carries the *state*, never the *data*.

### 1.6 Docker Compose (resource-bounded, verified against `docs.docker.com/reference/compose-file/deploy`)

```yaml
# docker-compose.yml - one VPS, two isolated agents + shared services
name: nizam
networks:
  edge:      { driver: bridge }         # only caddy + agents
  internal:  { driver: bridge, internal: true }   # signalbus, router - no route to internet
volumes:
  life-data: {}
  finance-data: {}
  signal-data: {}
  caddy-data: {}

services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["443:443", "80:80"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    networks: [edge]
    deploy:
      resources:
        limits:   { cpus: "0.50", memory: 256M }
        reservations: { cpus: "0.10", memory: 64M }

  life-agent:
    build: ./nizamcore            # git submodule / vendored checkout, main
    restart: unless-stopped
    env_file: /etc/nizam/life.env          # root:root chmod 600, NEVER in repo
    environment:
      - RELAY_MODE=live
      - TELEGRAM_WEBHOOK_PATH=/tg/${LIFE_WEBHOOK_PATH}
      - SIGNALBUS_URL=http://signalbus:8090
    volumes: [ "life-data:/data" ]          # life.db lives here (encrypted volume, §3)
    networks: [edge, internal]
    deploy:
      resources:
        limits:   { cpus: "1.5", memory: 2560M }   # peak model-orchestration headroom
        reservations: { cpus: "0.25", memory: 512M }
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8443/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  finance-agent:
    build: ./nizamfinancialapp    # this repo; server tier under /server (§5)
    restart: unless-stopped
    env_file: /etc/nizam/finance.env
    environment:
      - TELEGRAM_WEBHOOK_PATH=/tg/${MONEY_WEBHOOK_PATH}
      - SIGNALBUS_URL=http://signalbus:8090
    volumes: [ "finance-data:/data" ]       # finance.db here
    networks: [edge, internal]
    deploy:
      resources:
        limits:   { cpus: "1.5", memory: 2560M }
        reservations: { cpus: "0.25", memory: 512M }
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  signalbus:
    build: ./signalbus            # tiny service over the nizam-signalbus schemas (either runtime)
    restart: unless-stopped
    volumes: [ "signal-data:/data" ]
    networks: [internal]          # NO edge → never reachable from internet
    deploy:
      resources:
        limits: { cpus: "0.25", memory: 256M }

  scheduler:
    build: ./scheduler            # APScheduler: daily brief, backup, pricing refresh
    restart: unless-stopped
    env_file: /etc/nizam/scheduler.env
    volumes: [ "life-data:/data/life:ro", "finance-data:/data/finance:ro", "signal-data:/data/signal" ]
    networks: [internal]
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 512M }

  backup:
    build: ./backup               # VACUUM INTO → age → Drive; runs on scheduler tick or own timer
    restart: unless-stopped
    env_file: /etc/nizam/backup.env
    volumes:
      - "life-data:/data/life:ro"
      - "finance-data:/data/finance:ro"
      - "signal-data:/data/signal:ro"
    networks: [edge]              # needs Drive egress only
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 512M }
```

`Caddyfile` (TLS + path routing; Caddy auto-provisions Let's Encrypt certs):
```
life.<domain> {
    reverse_proxy /tg/* life-agent:8443
    reverse_proxy /healthz life-agent:8443
    log { output file /data/life-access.log }   # path is random; token never logged
}
money.<domain> {
    reverse_proxy /tg/* finance-agent:8000
    reverse_proxy /healthz finance-agent:8000
    # web dashboard (optional, behind passkey/basic-auth per PFOS contract 02 §5)
    reverse_proxy /* finance-agent:8000
}
```

### 1.7 Shared model router + OpenRouter (two keys, one account)

Verified against `openrouter.ai/docs/features/provisioning-api-keys` + `.../api-reference/api-keys/create-api-key` (2026-08-06): OpenRouter supports **many keys per account**, each with its own `limit` (credit cap) and `limit_reset` = `daily|weekly|monthly`, created/rotated programmatically via a **Management (Provisioning) key** under `/api/v1/keys`.

- **Two runtime keys, one account:**
  - `<OR_KEY_LIFE>` - `name: "nizam-life"`, `limit: <life weekly $>`, `limit_reset: "weekly"`.
  - `<OR_KEY_FINANCE>` - `name: "nizam-finance"`, `limit: 5`, `limit_reset: "weekly"` (the K4 decision, already encoded in `modelPolicy.ts:WEEKLY_BUDGET_USD`).
- **Per-key caps are the isolation** - a runaway life-agent loop cannot spend the finance budget and vice-versa. The account-level balance is the shared ceiling; the per-key `limit` is the private allocation.
- **Account-level privacy set once** (applies to both keys): training opt-out ON, prefer providers with `data_collection: deny` and ZDR. Per-request the client sends `provider: { data_collection: "deny", require_parameters: true }` and, where required, ZDR. `nizamcore` rule R4 (all calls via OpenRouter) and PFOS contract 09 §6 both already mandate this.
- **Shared router service is OPTIONAL.** Two valid shapes:
  - **(a) Library, not service (recommended first):** each agent vendors the same thin OpenRouter client + the offline `modelPolicy.ts` logic (finance) / `router.config.yaml` logic (life). No shared process; each holds only its own key. Simplest, most isolated.
  - **(b) Shared `router` service:** one process holds both keys, exposes `POST /route` on the `internal` network, and keeps a unified spend ledger. Buys you one place for canary/telemetry/governance (PFOS Phase 3, `contracts/pfos/11_*`) at the cost of co-locating both keys. Adopt only once you want the Phase-3 optimizer. If you do, it still enforces the two separate weekly caps and tags every call with the requesting agent.
- **Model roster is already agreed** (PFOS `docs/PFOS_OPENROUTER_ARCHITECTURE.md`): T1 extraction `xiaomi/mimo-v2.5`; workhorse `z-ai/glm-5.2`; premium `x-ai/grok-4.5` (T3 reviewer) + `moonshotai/kimi-k3` (T4) OFF unless opted in. The life agent's `router.config.yaml` names `deepseek-v4-flash` - reconcile the two rosters into `nizam-signalbus`-adjacent shared config, or keep separate rosters per agent (both are fine; separate is more isolated).

### 1.8 Separate SQLite databases (per agent) - and why not one shared DB

Verified against `sqlite.org/lang_vacuum.html` + WAL docs:
- **`life.db`** (nizamcore) and **`finance.db`** (PFOS) are **separate files on separate Docker volumes**. PFOS contract 02 §1 already mandates SQLite+WAL for the finance ledger and explicitly says *"the live database must remain on the VPS local filesystem, not inside a synchronizing Google Drive folder."*
- **WAL mode ON** for both; **never** place either on a network filesystem (SQLite's own warning). Enable `PRAGMA foreign_keys=ON` per connection.
- **`signals.db`** is the third file (bus). Three DBs, three volumes, zero cross-writes. An agent gets a **read-only** mount of the other's volume *only* for the backup/scheduler services, never for live logic - live cross-agent data flows through the signal bus exclusively.
- The finance repo's existing **Dexie/IndexedDB + Drive `nizam_db.json`** model is the *browser/PWA* path and stays intact for the web dashboard. The **server tier adds `finance.db`** as the authoritative server-side ledger (contract 02 §1). These are two projections of the same facts; the server DB is source-of-truth on the VPS, the Drive JSON remains the offline/PWA + document-archive projection. Reconciliation = the finance server writes canonical `finance.db`, then mirrors a sanitized `nizam_db.json` to Drive on the existing snapshot cadence.

### 1.9 Google Drive structure + role split

Verified against `developers.google.com/workspace/drive/api/guides/api-specific-auth` (drive.file is the non-sensitive per-file scope) + the service-account storage-quota gotcha:

- **Two purposes, cleanly separated:**
  1. **Finance app data payload** - the existing `NIZAM/nizam_db.json` + snapshots, `drive.file` scope, browser OAuth WEB client (unchanged).
  2. **Document archive + encrypted backups** - the `PFOS_Personal_CFO/` tree from contract 02 §7:
```
PFOS_Personal_CFO/
├── 00_Governance/  01_Product_Blueprints/  02_Financial_Knowledge/{Budgeting,Debt,Forecasting,Risk,Egypt_Macro,Provider_Terms}/
├── 03_Statements/{HSBC,CIB,NBE,Credit_Cards,BNPL}/   04_Receipts/
├── 05_Reports/{Daily,Weekly,Monthly}/   06_Decision_Records/
├── 07_Exports_and_Backups/              # ← encrypted VACUUM INTO backups land here
└── 08_Behavioral_Context/
```
- **Life agent's Drive** stays governed by nizamcore's `DUAL_WRITE_GOVERNOR` (human-readable narrative mirror). Keep the two Drive footprints in **separate top-level folders** so a mis-scoped token on one cannot see the other.
- **Service-account gotcha (do not step on this):** a Google *service account* has **no My-Drive storage quota** and cannot own files in a personal Drive - uploads fail or get orphaned. On the VPS backup path, either (a) use an **OAuth user grant** (refresh token in the secret store, `drive.file` scope, writes to a folder the user owns), or (b) a **Shared Drive** the service account is a member of. The doc's existing `drive.file` browser flow is the user-grant model; the backup service reuses a **narrow-scope user refresh token**, never a service account writing to My Drive.

### 1.10 Encrypted backup workflow (the actual commands)

```
# per DB, inside the backup container (age recommended; gpg is the fallback)
sqlite3 /data/finance/finance.db "VACUUM INTO '/tmp/finance-$(date +%Y%m%d-%H%M).db'"   # consistent, minimal, no forensic residue
age -r "<AGE_PUBLIC_KEY>" -o /tmp/finance-<ts>.db.age /tmp/finance-<ts>.db               # public-key encrypt; private key is NOT on the VPS
shred -u /tmp/finance-<ts>.db                                                            # plaintext never lingers
# upload the .age to Drive 07_Exports_and_Backups via the narrow user grant, then verify size+hash
```
- `VACUUM INTO` (not `cp`) gives a transactionally-consistent snapshot of a live WAL database - verified as the SQLite-blessed alternative to the backup API.
- **The age *private* key lives off the VPS** (your laptop secure store) - this is the "keys and the data they protect kept apart" invariant from `docs/PFOS_SECRETS_PLAN.md` §1. A VPS compromise yields only ciphertext.
- Retention: keep N daily on Drive, prune older (mirror the app's `SNAPSHOT_RETAIN = 10` discipline); monthly cold copy to a second location.
- **Restore drill is mandatory before trusting it** (PFOS contract 02 §9): pull a `.age`, decrypt with the off-box key, `PRAGMA integrity_check`, boot a throwaway agent against it.

---

## 2. Repository gap analysis

### 2.1 `nizamcore` (LIFE) - what exists vs what's missing

| Capability | State | Gap to close |
|---|---|---|
| Telegram transport | ✓ webhook.py + poller.py, secret-token + whitelist + dedup, 55 tests green | **FastAPI wrapper** around `handle_update()` + `/healthz` (the docstring's own I7 task). No logic change. |
| Privacy egress engine | ✓ classifier + EGRESS_MATRIX, 5 tiers | Add `telegram_operator` is already allowed for strict_local; add a **signalbus target** to the matrix (money_safe/life_safe). |
| Cost governor | ✓ $50/$300 month, kill switch | Reconcile with OpenRouter **per-key weekly** cap - the month ceiling is a *second* belt; wire `accumulate()` to real `usage.cost` from OpenRouter responses. |
| LLM layer | ✗ **deterministic stub only** (`_agent_stub`) | Wire the OpenRouter client (rule R4). This is the biggest build item - transport is done, brain is not. |
| WHOOP context | ◑ schema supports WHOOP; **no connector** | Build a WHOOP OAuth/ingest adapter → `body_signal` rows → `recovery_state`/`whoop_readiness` signals on the bus. |
| Server DB | ✗ ledgers are JSONL files | Optional: keep JSONL (works) or add `life.db` for query performance. JSONL is fine at single-user scale. |
| Secrets | ✓ `.env.example`, gitignore, secret-scan | Move to VPS `EnvironmentFile`; **rotate the leaked Drive folder id's exposure** (make repo private). |

### 2.2 `nizamfinancialapp` (FINANCE) - what exists vs what's missing

| Capability | State | Gap to close |
|---|---|---|
| Deterministic engines (S2S, obligations, forecast, decisions, net worth) | ✓ built, server-free, 333 tests | none - these are the crown jewels; the LLM tier sits on top and never touches the math |
| OpenRouter offline policy | ✓ `modelPolicy.ts` (K4 $5/wk), `benchmark/` eligibility | **Live client (M6)** + classifier (M4) + router (M5) + telemetry (M8) are server-tier, unbuilt - gated on VPS + key |
| Benchmark Phase-1 harness | ◑ offline scaffolding built | Run the **≥210-case eval → eligibility registry** BEFORE any routing goes live (contract 09 gates 10) |
| Telegram interface | ✗ **none** (contracts specify it; no code) | Build the **Node/TS** webhook + inbox-candidate flow. **Reuse nizamcore's `relay/auth.py` + `dedup.py` pattern** - do not reinvent the secret-token + whitelist + dedup you already proved. |
| Server ledger | ✗ Drive JSON + Dexie only | Add `finance.db` (SQLite+WAL) as VPS source-of-truth (contract 02 §1) |
| Ingestion inbox | ✗ | The research doc's key rule: Telegram/SMS/Gmail feed an **unposted candidate inbox**, never write the ledger directly. Build the quarantine queue. |

### 2.3 Cross-repo reusable components (don't rebuild)

- **`nizamcore/NIZAM__system/relay/{auth,dedup}.py`** → the finance agent's Telegram auth is *already written and tested* here. Vendor the pattern (or the files) into PFOS's server. This is the single biggest reuse win.
- **`nizamcore/governor/{cost_ceiling,kill_switch,classifier}.py`** → shared governance primitives. The `NIZAM_KILL_ALL` panic stop should be honored by **both** agents.
- **`modelPolicy.ts` + `benchmark/`** (finance) → the model-selection + eligibility logic; the life agent can consume the same eligibility registry.
- **PFOS Drive `sync.ts` 3-way merge + snapshot discipline** → the pattern for any Drive write, including the life agent's DUAL_WRITE.

### 2.4 Conflicts to resolve

1. **Model roster mismatch:** life names `deepseek-v4-flash`/`kimi-k2.6`; finance names `mimo/glm/grok/kimi-k3`. Not a blocker (separate keys, separate configs) but pick one shared roster if you build the shared router service.
2. **Money units:** finance = integer milliunits (USD-ish); MAL/pfa = EGP floats in JSONL. If the finance agent ever consumes MAL data, normalize at the boundary - never mix unit systems in one store.
3. **Two "NIZAM" Drive footprints:** life uses folder `1N_Cx...`; finance uses a `NIZAM/` folder it self-creates. Keep them in **separate top-level trees** to preserve the consent boundary.
4. **Branch names differ** (`main` vs `master`) - cosmetic; the compose `build:` contexts pin each.

### 2.5 Security risks found (ranked)

1. **ACCEPTED RISK - both repos stay PUBLIC** (owner decision 2026-08-06; D0 closed as WONT-DO). This is a sound posture for self-hosted finance software, but it converts one soft rule into a hard invariant: **the repo may hold the design, never a deployment particular.** No real domain, IP, Drive id, numeric Telegram id, bot username, or real monetary figure in any tracked file or fixture - all runtime-injected, enforced by a fail-closed harness check. Threat model: the attacker knows the architecture exactly and still cannot reach the system.
2. **P1 - real Drive folder id committed** in public `nizamcore` (5 files). Low direct harm (still needs auth) but it's reconnaissance. Scrub on privatize, or rotate the folder.
3. **P1 - no at-rest encryption on the Drive `nizam_db.json` payload yet** (flagged in `PFOS_SECRETS_PLAN.md` §2 as a gap). Close before real financial data syncs.
4. **P2 - LLM stub means no prompt-injection surface tested yet** in the life agent; when you wire the model, the PFOS adversarial eval cases (10 in the ≥210 set) must cover both agents.
5. **P2 - single VPS = single blast radius.** Mitigated by per-service resource caps, the `internal` network for signalbus, encrypted volumes, and off-box backup keys.

---

## 3. Security & privacy model

### 3.1 Consent boundary between financial and mental-health data (the core requirement)

This is enforced at **four** layers so no single failure crosses it:

1. **Process/DB isolation** - separate containers, separate SQLite files, separate volumes, separate tokens, separate OR keys. Finance code cannot read `life.db`; life code cannot read `finance.db`.
2. **Network isolation** - signalbus and router are on the `internal` Docker network with no route to Caddy/internet. The two agents reach each other *only* through the bus's `127.0.0.1`-scoped HTTP.
3. **Classification egress gate** - nizamcore's `EGRESS_MATRIX` is the model for the whole system. `strict_local_maximum` (family) → nothing leaves the box. `strict_local` (finance figures, health signals, journals) → may reach `telegram_operator` (the operator's own encrypted chat) and `zdr_inference`, but **never the other agent's store and never Drive in clear**. The signalbus adds two *new* narrow tiers: `money_safe` / `life_safe` - directional state only.
4. **Payload de-identification on the bus** - the bus schema forbids raw balances, due-dates, journal text, or any `strict_local_maximum` content. Finance publishes `money_pressure: amber`; life publishes `recovery_state: downshift`. **The state crosses; the data never does.** A subscriber that requests a `producer_only` signal is refused.

> Consequence, by design: the LIFE agent can make the FINANCE agent gentler during a recovery downshift (SUKOON), and the FINANCE agent can flag pressure without the LIFE agent ever seeing a number. That is the entire benefit of two agents instead of one - and it is safe because the boundary is code, not policy.

### 3.2 Secret custody (from `docs/PFOS_SECRETS_PLAN.md`, unchanged, extended for two agents)

Three tiers, chosen by *who runs the code*: **repo (templates only) · dev machine (`.env.local`/`.secrets/`, low-priv) · VPS store (production, root-owned)**. Drive is **not** a secret tier (holds only encrypted payload). Per-secret homes:

| Secret | Placeholder | Home | Cap / scope |
|---|---|---|---|
| Life bot token | `<BOT_A_TOKEN>` | `/etc/nizam/life.env` (600) | bot scope |
| Finance bot token | `<BOT_B_TOKEN>` | `/etc/nizam/finance.env` (600) | bot scope |
| Life webhook secret | `<LIFE_WEBHOOK_SECRET>` | life.env | 1-256 char header token |
| Finance webhook secret | `<MONEY_WEBHOOK_SECRET>` | finance.env | 1-256 char header token |
| OpenRouter life key | `<OR_KEY_LIFE>` | life.env | per-key weekly `limit`, data_collection deny |
| OpenRouter finance key | `<OR_KEY_FINANCE>` | finance.env | weekly `limit: 5`, data_collection deny |
| OpenRouter provisioning key | `<OR_MGMT_KEY>` | offline/laptop only | key rotation; never in a running agent |
| Drive user refresh token (backup) | `<DRIVE_REFRESH_TOKEN>` | backup.env | `drive.file`, folder-scoped |
| age backup **public** key | `<AGE_PUBLIC_KEY>` | backup.env (public - safe on VPS) | encrypt only |
| age backup **private** key | - | **OFF the VPS** (laptop) | decrypt only, restore drill |
| WHOOP OAuth | `<WHOOP_CLIENT_*>` | life.env | read-only recovery scope |

- **VPS runtime = systemd `EnvironmentFile` / Docker `--env-file`, `root:root chmod 600`** (Plan §3 option A). Backup/rotation copy via `sops`+`age` (option C).
- `VITE_*` keys are **build-time browser** values (finance PWA) and stay in the build env - never conflated with server secrets.
- Rotation: each secret independently revocable from its own console; `<OR_MGMT_KEY>` rotates the runtime OR keys programmatically; leak response = revoke → reissue → update the one home → re-verify.

### 3.3 Transport & auth hardening

- **TLS everywhere** (Caddy auto-HTTPS). Telegram only ever hits `:443`.
- **Two authenticity checks per bot**: random secret path segment (`/tg/<random>`) + constant-time `X-Telegram-Bot-Api-Secret-Token` compare (already in `auth.py`).
- **Operator whitelist** (`NIZAM_TELEGRAM_ALLOWED_IDS`) - only your numeric Telegram id talks to either bot; everyone else → 403.
- **Web dashboard** (finance, optional) behind passkey/basic-auth (contract 02 §5); consider VPN-only.
- **VPS baseline** (contract 02 §9): non-root user, `ufw` default-deny except 443/80 + your SSH, SSH key-only + fail2ban, unattended-upgrades, redacted logs (no prompt text - PFOS logs redacted *features* only, 90-day raw / aggregates forever).
- **Kill switch** `NIZAM_KILL_ALL=1` honored by both agents + scheduler + backup → one env flip halts all writers.

### 3.4 Data-tier discipline (both agents)

Every stored fact carries a confidence label (MAL/pfa model: CONFIRMED / ESTIMATED / ASSUMPTION / STALE / MISSING) and a privacy classification. **Money is computed deterministically; models never produce a balance, due-date, or safe-to-spend** (PFOS invariant #1). LLM output is parse/interpret/challenge/communicate only.

---

## 4. Resource & cost estimate (4 vCPU · 8 GB RAM · 75 GB NVMe)

### 4.1 CPU / RAM allocation (Compose `deploy.resources`)

| Service | CPU limit | CPU reserve | Mem limit | Mem reserve | Rationale |
|---|---:|---:|---:|---:|---|
| caddy | 0.50 | 0.10 | 256M | 64M | TLS + proxy, trivial load |
| life-agent | 1.50 | 0.25 | 2.5G | 512M | FastAPI + model orchestration bursts |
| finance-agent | 1.50 | 0.25 | 2.5G | 512M | Node/TS server + deterministic engines + orchestration |
| signalbus | 0.25 | 0.10 | 256M | - | tiny append-only store |
| scheduler | 0.50 | - | 512M | - | APScheduler jobs |
| backup | 0.50 | - | 512M | - | VACUUM + age, runs briefly |
| router (opt.) | 0.50 | - | 512M | - | only if shared-router shape chosen |
| **Sum limits** | **~5.25** | **~0.70** | **~7.1G** | **~1.6G** | limits oversubscribe (bursty, non-simultaneous); **reservations fit in 4 vCPU / 8 GB with headroom** |

- Reservations (guaranteed) total ~0.7 vCPU / ~1.6 GB → the box is never starved; limits are burst ceilings that won't all fire at once for a single operator.
- **8 GB is comfortable.** Leave ~1 GB for the host + Docker daemon. Add a **2 GB swapfile** as a safety net against an OOM-kill during a model burst.
- **4 vCPU is generous** for a single-user, event-driven workload; steady-state CPU is near-idle between messages.

### 4.2 Disk (75 GB NVMe)

| Consumer | Estimate |
|---|---|
| OS + Docker + images | ~8-12 GB |
| life.db + finance.db + signals.db (WAL) | < 1 GB for years at single-user volume |
| JSONL ledgers / logs (rotated) | ~1-2 GB with rotation |
| Local backup staging (pre-Drive) | ~1 GB (pruned) |
| Headroom | **~55+ GB free** - abundant |

Enable **log rotation** (`json-file` driver, `max-size: 10m`, `max-file: 3`) so container logs can't fill the disk.

### 4.3 Monthly cost estimate (placeholders - verify at purchase)

| Line | Estimate |
|---|---|
| VPS (4 vCPU / 8 GB / 75 GB NVMe - e.g. OVHcloud/Hetzner class) | ~$15-30/mo |
| Domain | ~$1/mo amortized |
| TLS (Let's Encrypt via Caddy) | $0 |
| OpenRouter - finance (K4 cap) | ≤ $5/wk ≈ **$21.7/mo hard cap** |
| OpenRouter - life (set your cap) | your `<life weekly $>` × ~4.3 |
| Google Drive (existing account) | $0 incremental |
| **Total** | **~$40-70/mo**, dominated by your two OpenRouter weekly caps |

The economics work because the workhorse is GLM+MiMo (single-digit $/mo); Grok/Kimi are opt-in only. The **per-key weekly `limit` is a hard stop** - spend cannot exceed it, and a hard budget stop **never** blocks deterministic obligation alerts (PFOS contract 09 §6).

---

## 5. Step-by-step migration plan (preserves BOTH repos)

**Ordering principle:** privatize → isolate secrets → wrap transport → stand up shared services → wire the brain last, behind the benchmark gate. Nothing destructive; both repos keep their history and default branches.

### Phase 0 - Preconditions (do first, no VPS needed)
1. **D0: make both repos PRIVATE** (GitHub → Settings → Danger Zone). Verify `git ls-files` still shows no tracked secret (already clean). This is the single highest-leverage step.
2. Scrub or rotate the exposed Drive folder id if that folder holds anything real.
3. Create `seifelsherbinyy/nizam-signalbus` (schemas only). Define the envelope (§1.5). Tag `v0.1.0`.
4. Provision + harden the VPS (Ubuntu 26.04 LTS - current, verified): non-root user, `ufw` deny-all except 443/80/SSH, SSH key-only, fail2ban, unattended-upgrades, Docker + Compose v2, 2 GB swap, `/etc/nizam/` (`root:root 700`).

### Phase 1 - Secrets & DNS (still no app running)
5. Point `life.<domain>` + `money.<domain>` A-records at the VPS.
6. Create the two Telegram bots via @BotFather → `<BOT_A_TOKEN>`, `<BOT_B_TOKEN>`.
7. Create the OpenRouter Management key `<OR_MGMT_KEY>` (offline). Use it to mint `<OR_KEY_LIFE>` + `<OR_KEY_FINANCE>` with weekly `limit`s. Set account privacy (training opt-out, prefer deny/ZDR).
8. Write `/etc/nizam/{life,finance,scheduler,backup}.env` (600). Generate `<LIFE_WEBHOOK_SECRET>`/`<MONEY_WEBHOOK_SECRET>` (random 32+ char) and the two random webhook path segments. Generate the age keypair; **move the private key OFF the VPS**.

### Phase 2 - Transport up, brain still stubbed (prove isolation before intelligence)
9. **Finance server tier scaffold** (`src/server/`): **Node 24 + TypeScript** (Fastify/Hono) wrapping the existing deterministic engines - reusing `src/lib/money` and the Stage 1-4 code verbatim, so the 333 tests carry over; **port the `relay/auth.py` + `dedup.py` logic** from nizamcore for Telegram auth; add `finance.db` (`node:sqlite`, WAL) + `/healthz`. Add a Dockerfile. **Keep the PWA/Drive path untouched.**
10. **Life server tier scaffold** (`nizamcore`): FastAPI wrapping the *existing* `relay.handle_update()` (its own I7 task) + `/healthz` + Dockerfile. `RELAY_MODE=live`. No logic change → the 55 tests still pass.
11. Build the tiny **signalbus** service (over the shared schema; either runtime) + **scheduler** + **backup** service.
12. `docker compose up -d`. Register both webhooks (§1.4 curl). Confirm both bots reply with their **stubbed** responses to your whitelisted id, and a non-whitelisted id gets 403. **At this point isolation is proven and no model has been called.**

### Phase 3 - Benchmark gate, then wire the brain
13. Run the **Phase-1 benchmark** (≥210 cases, `benchmark/` harness) against `<OR_KEY_*>` → produce the **eligibility registry**. *Nothing routes until this passes* (contract 09 gates 10).
14. Wire the **finance** OpenRouter client (M6) + classifier (M4) + router (M5) + telemetry (M8), consuming `modelPolicy.ts`. Enforce the weekly cap + data_collection deny + response_format.
15. Wire the **life** OpenRouter client (rule R4), replacing `_agent_stub` - behind the same cost governor + kill switch.
16. Turn on the **signal bus flows**: finance → `money_pressure`; life → `recovery_state`. Verify de-identification (no raw figures cross).

### Phase 4 - Ingestion, WHOOP, backups, hardening
17. Finance **ingestion inbox** (Telegram/SMS/Gmail → unposted candidates, never direct ledger writes).
18. Life **WHOOP connector** → `body_signal` → `whoop_readiness` signal.
19. Prove a **restore drill** from an encrypted Drive backup (decrypt off-box → `integrity_check` → boot throwaway).
20. Enable monitoring/alerts (§6), log rotation, and the weekly OpenRouter cost report to Telegram.

---

## 6. Acceptance tests

Each is objective and, per your standing rule, **VALIDATE-not-infer** - open the system of record, don't read a status enum.

### Isolation & consent (the whole point)
- **AT-1** Kill `finance-agent`; send a life message → life still replies. (Process isolation.)
- **AT-2** From inside `life-agent`, attempt to open `/data/finance/finance.db` → **permission denied / not mounted**. (DB isolation.)
- **AT-3** `docker exec` into any agent, `curl http://signalbus:8090` works; from the host `curl https://<domain>:8090` **fails/refused**. (Network isolation - bus never public.)
- **AT-4** Publish a finance signal carrying a raw balance → bus **rejects** (schema/tier violation). Publish `money_pressure: amber` → accepted, life subscriber sees `amber`, never a number. (De-identification.)
- **AT-5** Classify an AHEL (family) path for any egress target → `is_egress_blocked` returns **True** for everything except laptop_disk. (strict_local_maximum holds.)

### Telegram transport
- **AT-6** POST to `/tg/<path>` **without** the secret-token header → **401**; with a wrong token → **401/403** (constant-time). With correct token but non-whitelisted user_id → **403**. (auth.py, already tested - re-prove in prod.)
- **AT-7** Replay the same `update_id` twice → second is `duplicate`, no double side-effect. (dedup.)
- **AT-8** `getWebhookInfo` for both bots shows the correct URL, `pending_update_count: 0`, `last_error_date` absent. (Open Telegram's API, don't assume.)

### OpenRouter isolation & cost
- **AT-9** Drive finance spend to its weekly `limit` → finance LLM calls blocked, **deterministic obligation alerts still fire**; life agent **unaffected** (separate key). (Per-key cap = isolation + safety invariant.)
- **AT-10** Every model response's `usage.cost` is recorded to the spend ledger; monthly `/cost` report reconciles to OpenRouter's dashboard within tolerance. (Telemetry source-of-truth = OpenRouter usage.)
- **AT-11** A request confirms `provider.data_collection: "deny"` is sent and honored (no training). (Privacy.)

### Data integrity & recovery
- **AT-12** `PRAGMA integrity_check` on both live DBs = `ok`; WAL mode confirmed. 
- **AT-13** Backup → decrypt off-box → `integrity_check ok` → agent boots against the restored copy. (Restore drill - mandatory before trust.)
- **AT-14** Kill the process mid-write; on restart the DB is consistent and the update resumes from `dedup.max_seen()+1`. (Crash safety.)
- **AT-15** Money never floats: any `nizam_db.json` / finance.db amount that is non-integer-milliunit fails schema validation. (zMoney.)

### Health & benchmark gate
- **AT-16** `/healthz` on both agents returns 200; Compose healthcheck flips a stopped dependency to unhealthy and restarts it. 
- **AT-17** No model routes until the eligibility registry exists and passes (L0 critical-field ≥ 99%, 0 P0 breaches). (Phase-1 gates Phase-2.)
- **AT-18** Regression: `pytest` in nizamcore = 55 pass; `npm test` in finance = 333 pass (ratcheted) - **after** the server wrap on each side (a transport change must not break either core).

---

## 7. Risks & fallback options

| # | Risk | Likelihood | Fallback / mitigation |
|---|---|---|---|
| R1 | **Public-repo exposure** of a system holding health+finance data | High (current state) | **D0: privatize both now.** Fallback if forced-public: strip all real ids, keep only templates, split any sensitive design into a private repo. |
| R2 | Webhook endpoint down (TLS/DNS/domain lapse) | Med | **`poller.py` long-poll fallback** - no public endpoint needed; flip `RELAY_MODE` + start the poller. Both agents keep the poller as a documented degraded mode. |
| R3 | Single-VPS failure = total outage | Med | Nightly encrypted Drive backups + a proven restore drill → rebuild on a fresh box from Compose in <1h. Consider a second small box for the backup key custody. |
| R4 | OpenRouter account-level balance drained by one agent | Low (per-key caps) | Per-key weekly `limit` prevents cross-spend; account balance alert at 70%; deterministic engines never depend on a model. |
| R5 | Consent boundary breach (finance data reaches life store) | Low if 4 layers hold | Bus schema rejects raw figures; egress matrix blocks strict_local→cross-agent; **AT-4** is the continuous guard; log every bus write for audit. |
| R6 | Prompt injection via Telegram/ingested SMS/receipts | Med once LLM is live | Deterministic policy gate runs **before and after** any model synthesis; adversarial cases in the ≥210 benchmark; models can't move money (invariant #1); inbox is quarantine-only. |
| R7 | Drive service-account quota trap breaks backups | Med (classic gotcha) | Use the **OAuth user refresh token** (`drive.file`) or a Shared Drive - never a service account writing to My Drive. Verified against Drive auth docs. |
| R8 | SQLite on a synced/network path corrupts | Low if rules followed | DBs live on local Docker volumes only; **never** inside a Drive-synced folder (SQLite WAL warning + PFOS contract 02 §1). |
| R9 | Resource contention on the shared box | Low | Compose `deploy.resources` limits + reservations (§4); 2 GB swap; log rotation; steady-state is near-idle. |
| R10 | Roster/version drift between the two agents | Low | Separate keys+configs make drift harmless; if you adopt the shared router, pin one roster in a versioned config. |

### Fallback architecture ladder (if the full design is too much at once)
1. **Minimal viable:** two agents, two bots, two keys, **long-poll (no Caddy/webhook)**, no signalbus, no shared router - pure isolation. Proves the two-agent model in a weekend.
2. **+ Webhook + Caddy** when you want lower latency and the public endpoint.
3. **+ Signalbus** when you want the recovery↔money-pressure cross-talk (the real payoff).
4. **+ Shared router service + Phase-3 governance** when spend/telemetry justify one control point.

---

## Appendix A - decisions this doc assumes (confirm or override)
- **D0** privatize both repos - **CLOSED as WONT-DO** (owner-authorized public). Replaced by the no-deployment-particulars invariant.
- **D1/D2** VPS + SQLite on OVHcloud (from `PFOS_SECRETS_PLAN.md`) - consistent with this design.
- **K4** OpenRouter finance cap $5/week - encoded in `modelPolicy.ts`, reused here.
- **Server runtime** SETTLED: life = Python/FastAPI, finance = Node/TypeScript. One money implementation only (the TypeScript one). Overrides contract 02's language choice for the finance agent; closes the open decision in `pfos-current.md`.
- **Router shape** library-first (each agent holds its own key); upgrade to a shared service only for Phase-3 governance.
- **Signalbus** is the *only* new repo; everything else is additive to the two existing repos.

## Appendix B - sources (current official docs, fetched 2026-08-06)
- Telegram Bot API `setWebhook` (secret_token, ports 443/80/88/8443, max_connections, allowed_updates, drop_pending_updates) + Bots FAQ (1 msg/sec per chat, 30/sec broadcast, secret-path authenticity) - core.telegram.org
- OpenRouter API-key create + Provisioning/Management keys (per-key `limit` + `limit_reset` daily/weekly/monthly) + Provider Logging/privacy (data_collection deny, ZDR, EU in-region) - openrouter.ai/docs
- Docker Compose `deploy.resources` (limits/reservations cpus+memory+pids, restart_policy) - docs.docker.com
- Google Drive `drive.file` non-sensitive per-file scope + API limits + service-account My-Drive quota gotcha - developers.google.com/workspace/drive
- SQLite `VACUUM INTO` (consistent minimal backup) + WAL (not for network FS) - sqlite.org
- Ubuntu release cycle - 26.04 LTS current - ubuntu.com/about/release-cycle
- Internal repo ground truth: `nizamcore@main` (relay/governor/policies, 55 tests) + `nizamfinancialapp@master` (engines/benchmark/routing, 333 tests) + `contracts/pfos/*` + `docs/PFOS_*`.
