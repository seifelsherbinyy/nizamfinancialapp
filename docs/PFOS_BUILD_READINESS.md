# PFOS Build Readiness Contract

**Date:** 2026-08-06 · **Companion manifest:** `docs/pfos_build_readiness.yaml` (machine-readable)
**Sibling:** `docs/PFOS_HUMAN_DELIVERABLES.md` (decisions D1-D7, data Dv1-Dv6)

This is the guided provisioning checklist. It answers one question per integration: **what do
you fetch, where does it go, how do you verify it, and how do you rotate it** - so a human or an
agent can provision the build consistently with nothing missed or misfiled.

---

## 0. The intake -> routing model (place a value ONCE; it routes to its home)

You do **not** dump keys into one pile. There are exactly **four homes**, and every credential
belongs to exactly one. This contract tells you which.

| Home | What lives here | Read by | Committed? |
|---|---|---|---|
| `.env.local` | Browser SPA **public** config (`VITE_*`) - client id, browser API key, folder id | Vite build / the running web app | **No** (gitignored) |
| `.secrets/` | **Local dev** tokens - the ingest tool's desktop-client JSON + cached token | Local Node scripts only | **No** (gitignored) |
| VPS secret store / server env | **Production server** secrets - bot token, LLM key, SMS secret, backup key | The server tier (Stage 6+) | **No** (never in repo) |
| Google Drive | **DATA only** - `nizam_db.json` + a statements folder, encrypted | The app, via `drive.file` scope | n/a |

> **The one hard rule (contract 02 section 9):** *"Environment secrets outside repository **and
> Drive**."* Keys never go on Drive. Drive holds your encrypted **data**, never your credentials.
> This is the correction to "store all credentials on Drive" - the design deliberately forbids it.

**Why the two browser values are not "secrets":** the SPA uses the Google Identity Services token
model - the access token lives in memory only and expires within the hour (`src/lib/drive/oauth.ts`).
The client id and browser API key are **public identifiers**; their safety comes from OAuth consent
+ origin/referrer restrictions, not from being hidden. **The browser app holds no client secret.**

---

## 1. Architecture gate - READ BEFORE FETCHING ANYTHING

**Half of the 20 items on a generic list only exist if you run a server.** That is decision **D1**
(see `PFOS_HUMAN_DELIVERABLES.md`). Pick your profile first:

- **Profile A - Drive-only (current build, server-free).** The app is done through Stage 4 and runs
  entirely in the browser on the Drive DB. **You fetch only K1 (+ optional K2).** Telegram, Gmail,
  VPS, domain, Docker, FastAPI, SQLite, SMS, OpenRouter - **none of them.**
- **Profile B/C - Server tier.** Adds always-on ingestion + bot + LLM. Everything else on the list
  applies, but **only after D1/D2 are recorded and contract 05 exists (for the LLM tier).**

Each row below is tagged **[A]** (fetch now, any profile) or **[server]** (only Profile B/C) or
**[behavioral]** (Stage 8, consent-gated). Do not fetch a `[server]` item until D1/D2 are decided.

---

## 2. Master provisioning table

| # | Integration | Credential to fetch | Home | Profile / gate | Unblocks | Status |
|---|---|---|---|---|---|---|
| 1 | Google OAuth (**Web** client) | OAuth **client id** (no secret) | `.env.local` `VITE_GOOGLE_CLIENT_ID` | **[A] now** | Live Drive sign-in | **IN_PROGRESS** - id present, **verify it is a Web client** |
| 2 | Google browser API key | API key (Drive+Picker, referrer-locked) | `.env.local` `VITE_GOOGLE_API_KEY` | **[A] now** | Picker import | **NOT_STARTED - the one real remaining fetch** |
| 3 | Google Drive folder (optional) | Folder id | `.env.local` `VITE_NIZAM_DRIVE_FOLDER_ID` | **[A] now** | Pin `nizam_db.json` | NOT_STARTED |
| 4 | Google OAuth (**Desktop** client) | Desktop client JSON | `.secrets/google-oauth-desktop.client.json` | [A] dev-only | Contract ingest tool | ON_FILE |
| 5 | OpenRouter | API key + hard spend cap | VPS secret store | [server] + D6/contract 05 | LLM routing (Stage 7) | BLOCKED |
| 6 | Telegram Bot | Bot token | VPS secret store | [server] + D2 | Bot interface (Stage 6) | BLOCKED |
| 7 | Telegram user id | Your numeric user id (allowlist) | server config | [server] + D2 | Bot auth allowlist | BLOCKED |
| 8 | Gmail API + grant | Restricted OAuth grant (label/query scope) | VPS secret store | [server] + D2 | Email-relay ingest (Stage 6) | BLOCKED |
| 9 | SMS / Apple Shortcuts | Shared webhook secret | VPS secret store | [server] + D2 | Signed SMS ingest (Stage 6) | BLOCKED |
| 10 | VPS | SSH key + host creds + backup-encryption key | VPS secret store / local secure | [server] + D1=B/C | Server host + backups | BLOCKED |
| 11 | Domain / Cloudflare | DNS/API token (optional) | deploy secret store | [server] + D2 | Public TLS endpoint | BLOCKED |
| 12 | Macro/FX data source | API key (only if the chosen source needs one) | `.env.local` or server | [A] optional (D3) | Automated real net worth | OPTIONAL |
| 13 | WHOOP | OAuth client + token | **separate encrypted namespace** | [behavioral] + D7 | Behavioral signals (Stage 8) | DEFERRED |
| 14 | GitHub | Fine-grained PAT (repo-scoped) | local git credential / CI secret | dev/CI, optional | Automated push / CI | OPTIONAL |

**No credential to fetch** (frameworks / libraries / references, not keys): Google Cloud project
(the container), Google Drive API enablement, Gmail label creation, SQLite, FastAPI, Docker,
OpenRouter model/pricing pages, OAuth consent-screen config. These are *steps*, tracked in section 5.

---

## 3. Per-integration provisioning blocks

### [A] 1-3 · Google Web OAuth + API key + Drive folder  · FETCH NOW
- **Purpose:** live Drive-as-database sign-in, `nizam_db.json` round-trip, one-time Picker import.
- **Primary:** https://console.cloud.google.com/apis/credentials
- **Fallback:** https://console.cloud.google.com/apis/library · consent: https://console.cloud.google.com/apis/credentials/consent
- **Needed:** OAuth 2.0 Client ID of type **Web application** (NOT Desktop); a browser **API key**;
  optionally a Drive folder id.
- **Home:** `.env.local` -> `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, `VITE_NIZAM_DRIVE_FOLDER_ID`.
- **Setup:** enable **Drive API** + **Picker API**; consent screen External, scope **`drive.file` only**,
  add your own account as a test user; Web client - add your origins (e.g. `http://localhost:5173`
  and the deploy URL) to *Authorized JavaScript origins*; API key restricted by HTTP referrer + to
  Drive+Picker APIs.
- **Verify:** run the app, click "Connect Google Drive", confirm the consent shows **only** "see,
  edit, create, delete only the specific files you use" (drive.file). The app hard-rejects any
  broader grant (`assertDriveFileScopeOnly` in `oauth.ts`).
- **Rotate:** delete the client id / API key in the console, create a new one, replace in `.env.local`.
  No server restart; the browser just re-consents.

### [A/dev] 4 · Google Desktop OAuth (contract ingest tool) · ALREADY ON FILE
- **Purpose:** the LOCAL read-only tool that pulled contracts 01-04 from your Drive folder.
- **Primary:** https://console.cloud.google.com/apis/credentials (type: **Desktop app**)
- **Needed:** desktop client JSON at `.secrets/google-oauth-desktop.client.json` (gitignored); token
  cached at `.secrets/pfos-ingest.token.json`.
- **Verify:** `node scripts/ingest/pfos-drive-pull.mjs` lists the folder read-only over loopback.
- **Rotate / revoke:** `node scripts/ingest/pfos-drive-pull.mjs --revoke` once contracts are stable.
- **Note:** an installed-app "client secret" is **not confidential** (public client + loopback);
  do not treat it as a server secret, and never reuse it for the browser app.

### [server] 5 · OpenRouter · BLOCKED until contract 05 exists (D6)
- **Purpose:** LLM routing for classification / reasoning / narrative forecasting.
- **Primary:** https://openrouter.ai/settings/keys
- **Fallback:** https://openrouter.ai/settings · https://openrouter.ai/models · https://openrouter.ai/docs
- **Needed:** API key **+ a hard monthly spend cap**.
- **Home:** VPS secret store (server-side only - **never** `VITE_*`, never the browser).
- **Verify:** `GET /models`; then one small completion. Confirm **data-retention = off** (contract 02
  section 12.6).
- **Rotate:** revoke the key in settings, issue a new one, update the server secret, re-verify.
- **Gate:** contract 05 (agent/tooling/credential surface) must be written first - it does not exist.

### [server] 6-7 · Telegram bot + user allowlist · BLOCKED until D2
- **Purpose:** chat interface for briefs + decision prompts.
- **Primary:** https://t.me/BotFather · your id: https://t.me/userinfobot (alt https://t.me/RawDataBot)
- **Fallback:** https://core.telegram.org/bots/api
- **Needed:** bot token (secret) + your numeric user id (allowlist - the primary auth per 02 section 9).
- **Home:** token -> VPS secret store; user id -> server config.
- **Verify:** `GET https://api.telegram.org/bot<TOKEN>/getMe` returns your bot.
- **Rotate:** `/revoke` in BotFather, reissue, update the server secret.

### [server] 8 · Gmail API (email-relay ingest) · BLOCKED until D2
- **Purpose:** ingest bank/statement emails from a dedicated, restricted label.
- **Primary:** https://console.cloud.google.com/apis/library/gmail.googleapis.com · docs https://developers.google.com/gmail/api
- **Needed:** restricted OAuth grant - **minimal scope, one dedicated label/query only** (02 section 3.2).
- **Home:** VPS secret store.
- **Labels to create in Gmail:** `PFOS`, `PFOS/Bank SMS`, `PFOS/Statements`.
- **Verify:** list messages under the label only; confirm no access outside it.
- **Rotate:** revoke the grant in Google Account permissions, re-consent with the minimal scope.

### [server] 9 · SMS / Apple Shortcuts signed webhook · BLOCKED until D2
- **Purpose:** forward bank SMS to the server over a **signed** request (never an open endpoint).
- **Primary:** https://support.apple.com/guide/shortcuts/welcome/ios
- **Needed:** a shared secret for the signed webhook path (02 section 9); replay protection.
- **Home:** VPS secret store (+ the same secret in the Shortcut).
- **Verify:** a signed test post is accepted; an unsigned/replayed one is rejected.
- **Rotate:** regenerate the shared secret on both ends.
- **Prereq data:** Dv1 (sanitized real SMS formats) - parsers are built deterministically first.

### [server] 10-11 · VPS + domain · BLOCKED until D1=B/C
- **Purpose:** the always-on host for ingestion/bot/LLM, and a public TLS endpoint.
- **VPS primary:** Hetzner https://console.hetzner.cloud · Netcup https://www.customercontrolpanel.de · Contabo https://my.contabo.com
- **Domain/TLS:** https://dash.cloudflare.com
- **Needed:** SSH keypair, host credentials, **backup-encryption key** (offsite backups must be
  encrypted, 02 section 9-10); optional DNS/API token.
- **Home:** VPS secret store / your local secure store; backup key stored **separately** from backups.
- **Verify:** hardened box (TLS, firewall, redacted logs) + a **restore drill proven**, not just a
  backup created (02 section 10).
- **Rotate:** rotate SSH keys + API tokens on a schedule (02 section 9 "rotate bot and API keys").

### [A/optional] 12 · Macro / FX data source · tied to D3
- **Purpose:** automate the EGP inflation + FX inputs to the real-net-worth view.
- **Needed:** an API key **only if** your chosen source requires one (D3 picks the source).
- **Today:** the app takes inflation + FX **manually** in `/settings` and `/networth` (server-free) -
  so **no key is required** unless you choose to automate it.

### [behavioral] 13 · WHOOP · DEFERRED, consent-gated (D7), Stage 8
- **Purpose:** optional behavioral/recovery context.
- **Primary:** https://developer.whoop.com · app https://app.whoop.com
- **Contract constraints:** behavioral/health data lives in a **separate encrypted namespace**
  (02 section 2.5) and is **excluded from book net worth** (03 section 8.4). Default = **no linkage**;
  requires explicit revocable consent (D7). **Do not fetch until Stage 8 and the namespace exists.**

### [dev/optional] 14 · GitHub PAT
- **Purpose:** only if you want token-auth push or CI - normal `git push` over HTTPS already works.
- **Primary:** https://github.com/settings/personal-access-tokens
- **Needed (if used):** a **fine-grained** PAT, scoped to this repo, `contents:read/write` only.
- **Home:** local git credential manager or a CI secret - never in the repo.
- **Rotate:** expire/regenerate on a schedule.

---

## 4. What we need to FIX (reconciliation of the generic list against the contracts + code)

1. **OAuth client TYPE is wrong for the app.** The credential on file (`.secrets/...desktop.client.json`)
   is a **Desktop** client (for the ingest tool). The browser app needs a **Web application** client.
   And there is **no client secret** for the SPA - do not paste one into `.env.local`. *(Fixes list
   item "OAuth Client ID + Client Secret".)*
2. **The list conflates two mutually-exclusive builds.** ~9 of the 20 items (Telegram, Gmail, VPS,
   domain, Docker, FastAPI, SQLite, SMS, OpenRouter) exist **only if D1 = B/C**. If you stay Drive-only
   you fetch none of them. Decide **D1/D2 first** (see `PFOS_HUMAN_DELIVERABLES.md`).
3. **SQLite vs Drive-JSON is an open architecture conflict (D1).** Contract 02 mandates SQLite and names
   "ledger inside a syncing Drive folder" as the anti-pattern; NIZAM chose Drive-JSON for the server-free
   build. SQLite is only relevant under D1=B/C. Record the decision; don't provision SQLite until then.
4. **OpenRouter is blocked by a missing contract, not a missing key.** Contract 05 (agent/tooling/
   credential surface) does not exist. Writing it (or an approved interim policy) is D6 - **do that
   before fetching an LLM key.**
5. **WHOOP is not a near-term fetch.** It is Stage 8, consent-gated (D7), and must be isolated in an
   encrypted namespace; it never enters net worth. Default stays no-linkage.
6. **"Hermes" is not a PFOS dependency in this repo** - dropped from the contract (ambiguous project
   name). If you meant a specific service, name the repo/URL and it gets a row.
7. **`.env.local` already exists** and already holds a **client id**; only `VITE_GOOGLE_API_KEY` is
   empty. Verify the existing client id is a **Web** client (not the desktop ingest client), then add
   the API key. Nothing else in Profile A is outstanding.
8. **GitHub PAT is optional** - HTTPS push already works; only needed for CI/token-auth.
9. **Macro/FX needs no key today** - inflation + FX are entered manually (server-free). A key is a
   *convenience* under D3, not a blocker.
10. **The "store all credentials on Drive" intent is reversed by 02 section 9** - keys go to
    `.env.local` / `.secrets/` / VPS secret store; **Drive holds only the encrypted data.**

---

## 5. Fetch order (do these in sequence)

**Now (Profile A - unblocks the finished app on live Drive):**
> Current local state (2026-08-06): `.env.local` already has a **client id**; `VITE_GOOGLE_API_KEY`
> is **empty**. So for you, steps 3 and 5 (API key) are the real remaining work; step 4 is a *verify*.
1. Google Cloud project -> enable **Drive API** + **Picker API**.
2. OAuth consent screen (External, `drive.file`, add yourself as test user).
3. Create a browser **API key** (referrer-locked) -> paste into `.env.local` as `VITE_GOOGLE_API_KEY`.
4. **Verify** the existing `VITE_GOOGLE_CLIENT_ID` is a **Web-application** client (not the desktop
   ingest client). If it is the desktop one, create a Web client and replace it.
5. Run the app, click Connect Google Drive, confirm the consent is **drive.file only**; done.

**Before any server work (Profile B/C):** decide **D1 + D2**, then provision VPS (K7), harden it,
prove a **restore drill**, then fetch K3/K5/K6 into the VPS secret store.

**Before any LLM work:** write **contract 05** (D6), set the OpenRouter **spend cap**, verify
data-retention off, then fetch K4.

**Before any behavioral data:** build the encrypted namespace, capture D7 consent, then WHOOP.

---

## 6. Rotation & audit (applies to every secret)

- Rotate bot tokens + API keys on a schedule (02 section 9). Store rotation dates alongside the manifest.
- Audit every external tool call and every financial-record mutation (02 section 9).
- Redact secrets from all logs. No bank passwords, card CVV, or full card numbers anywhere (02 section 9).
- Keep the backup-encryption key **separate** from the backups themselves.
