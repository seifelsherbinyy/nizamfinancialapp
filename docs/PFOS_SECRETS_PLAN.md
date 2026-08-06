# PFOS Secrets & Developer-Access Plan

**Owning contract:** PFOS contract 02 (Data & Security), section 9 (secret custody) + the Build
Readiness map (`docs/PFOS_BUILD_READINESS.md`).
**Build phase:** planning for the server tier (D1 = B: VPS + SQLite; D2 = OVHcloud, not yet
provisioned; K4 = OpenRouter, USD 5.00/week cap).
**Status:** PLAN. No secret is provisioned by this document. Nothing here is fetched until the
OVHcloud VPS exists.

---

## 1. The one principle everything else follows (contract 02 section 9)

Secrets live in exactly **three tiers**, chosen by *who runs the code*:

| Tier | Home | Holds | Committed to Git? |
|---|---|---|---|
| **Repo (public GitHub)** | the repository | code + `.env.example` **templates only** | never a secret (enforced by AC08/AC09) |
| **Local dev machine** | `.env.local`, `.secrets/` (gitignored) | dev/browser-safe, low-privilege credentials | never |
| **VPS (OVHcloud) secret store** | server-side only | production server secrets | never |

**Google Drive is NOT a secret tier.** It stores only the application's **encrypted data payload**
(`nizam_db.json` + statements). The key that decrypts that payload lives in the secret tier, **never on
Drive**. Keys and the data they protect are kept apart on purpose.

---

## 2. Secret inventory (what exists, where each one lives)

| Secret | Used by | Home | Scope / cap | On Drive? |
|---|---|---|---|---|
| Google OAuth **Web client id** (`VITE_GOOGLE_CLIENT_ID`) | browser Drive sign-in | dev `.env.local`; prod build env | `drive.file` only; client id (no client secret for an SPA) | no |
| Google browser **API key** (`VITE_GOOGLE_API_KEY`) | Picker import | dev `.env.local`; prod build env | referrer-locked; Drive + Picker API | no |
| Google OAuth **Desktop client + token** | contract-ingest tool (`scripts/ingest`) | dev-only `.secrets/` (gitignored) | narrow scope; `--revoke` path already built | no |
| **OpenRouter API key** | live LLM client (module M6) | **VPS secret store** (+ a *separate* dev key locally) | hard cap USD 5.00/week (prod); data-retention OFF | no |
| **Telegram bot token** | bot interface | VPS secret store | bot scope | no |
| **SMS webhook shared secret** | signed SMS ingest | VPS secret store (+ the same value in the phone Shortcut) | HMAC signing only | no |
| **Gmail restricted grant** | email-relay ingest | VPS secret store | label/query scope only | no |
| **Backup-encryption key** | encrypted offsite backups | local secure store / VPS, stored **separately** from the backups | symmetric (age/gpg) | no |
| **`nizam_db` data-encryption key** | app crypto for the Drive payload | dev `.env.local`; prod VPS secret store | symmetric; **never leaves the secret tier** | **no (key)** - only the *encrypted* payload goes to Drive |

> Gap to close before real data goes live: if the current Profile-A build writes `nizam_db.json` to
> Drive in plaintext, at-rest encryption of the payload must be added before real financial data is
> synced. That is a Profile-B (server-tier) task; the invariant above governs it.

---

## 3. VPS (OVHcloud) secret store - the runtime home

The VPS is not provisioned yet. When it is, production secrets live server-side only (never `VITE_*`,
never in the browser bundle). Options, simplest first:

- **A) systemd `EnvironmentFile` (recommended for one small VPS).** A root-owned
  `/etc/nizam/nizam.env`, `chmod 600` (`root:root`), loaded by the service unit via
  `EnvironmentFile=/etc/nizam/nizam.env`. Not in the repo, not world-readable, survives reboots.
- **B) Container env / Docker secrets.** If containerized: `--env-file` (perms 600) or Docker secrets
  mounted under `/run/secrets` (tmpfs).
- **C) `sops` + `age` encrypted-at-rest.** Keep an encrypted `nizam.env.enc` for backup/rotation;
  decrypt on deploy with an `age` key that is stored **separately** from the file. Good middle ground;
  a full secrets-manager server is overkill for a single box.

**Recommendation:** **A for runtime + C for the backup/rotation copy.** Result: secrets are not in the
repo, not world-readable, reboot-safe, encrypted at rest for backups, with a documented rotation path.

---

## 4. Seamless AI-developer access - WITHOUT exposing production secrets

The goal ("the AI dev can work without friction") is met by two things, not by widening access:

**(1) Mock-first / offline-first development.** NIZAM is already built this way: injected ports + mocks
(the M2 benchmark harness, `modelPolicy`, the deterministic Stage 1-4 engines). About 95% of the surface
needs **no real secret at all**. The only piece that needs the live OpenRouter key is the M6 client,
and even it should be developed against a recorded/mock response before the real key is touched. The AI
developer is never blocked waiting for a secret because the mock path always runs.

**(2) A separate DEV credential tier** - low-privilege, capped, revocable, never production:
- **Dev OpenRouter key** with its own tiny hard cap (about USD 1/week) and data-retention off. If it
  leaks, the blast radius is about a dollar - not the production key or the USD 5/week budget.
- **Dev Google account + a dedicated dev Drive folder**, `drive.file` scope. The AI dev exercises the
  Drive round-trip against throwaway data, never the owner's real financial Drive.
- These live in the **dev machine's `.env.local` / `.secrets/`** (gitignored). A running `npm run dev`
  reads them automatically - that *is* the "free access": the local process picks up the local env with
  zero friction. The agent uses secrets **by reference** (the process reads the file), never by printing
  a value into chat, a log, or a commit.

**Hard rules for the AI developer (and any dev):**
- Never commit a secret; never upload one to Drive; never paste a secret *value* into the agent context.
- Never grant the agent the **production** VPS secret store. Dev uses the dev tier only.
- If developing on the VPS over SSH later, use a separate `nizam-dev.env`, never `/etc/nizam/nizam.env`.

---

## 5. Why not "put the secrets on Google Drive so the AI can read them freely"

Two reasons this is rejected:
1. **It breaks the encryption model.** Drive holds only the *encrypted* data payload; its decryption key
   must live in the secret tier. Putting the key on Drive next to the data it unlocks makes the
   encryption pointless (contract 02 section 9).
2. **Drive is broad, synced, un-capped storage.** One over-broad share, one compromised synced device,
   or one mis-scoped token exposes *every* key at once, with no per-secret cap, rotation, or audit.

The seamless-development outcome is delivered by section 4 instead - and it is genuinely more seamless,
because the local process already reads `.env.local` with no manual step.

---

## 6. Rotation & revocation

- Every credential is **independently revocable** and issued from its own console.
- The ingest token has a built-in `--revoke` path; run it once contracts are stable.
- Rotate on a schedule (monthly for the dev key; on any suspected leak for all).
- Leak response: **revoke -> reissue -> update the one home (dev `.env.local` or the VPS store) ->
  re-verify**. Because each secret has exactly one home, rotation touches exactly one place.

---

## 7. Provisioning order (once OVHcloud is live)

1. Provision + harden the OVHcloud VPS: non-root user, firewall, TLS, redacted logs.
2. Create `/etc/nizam/nizam.env` (`root:root`, `chmod 600`); wire `EnvironmentFile=` into the systemd
   unit.
3. Optionally `sops`+`age`-encrypt a backup copy; store the `age` key separately from the backup.
4. Fetch **production** secrets into the VPS store only: OpenRouter key (+ USD 5/week cap,
   data-retention off), Telegram bot token, SMS shared secret, Gmail grant, backup-encryption key.
5. Prove a **restore drill** from an encrypted backup before relying on it.
6. Keep the **dev tier** entirely separate: dev OpenRouter key (about USD 1/week), dev Google account,
   dev Drive folder.

---

## 8. Current state (2026-08-06)

- Repo: public, clean, pushed. No secret is or was tracked (AC09 enforced).
- Dev machine: `.env.local` present (holds `VITE_GOOGLE_CLIENT_ID`; `VITE_GOOGLE_API_KEY` empty),
  `.secrets/` present (dev ingest client + token). Both gitignored.
- VPS: **not provisioned** (OVHcloud chosen). No production secret exists yet.
- Drive: holds the app data payload only; the data-encryption invariant above must be honored before
  real financial data is synced.
