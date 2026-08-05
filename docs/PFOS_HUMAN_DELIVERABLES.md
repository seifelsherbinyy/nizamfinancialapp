# PFOS Human Deliverables

**Date:** 2026-08-05
**What this is:** everything only the owner can supply or decide before the corresponding
PFOS stage can proceed. Nothing here can be produced by code.

> **Provenance note.** The request asked for a "human deliverables / prerequisites / API keys /
> credentials / readiness" document from the drive. **No such document exists** — the keyword
> sweeps on 2026-08-05 found none in the PFOS tree. Everything below is therefore **derived**
> from the security and integration sections of contracts 02 and 04, plus the current repository
> state, and is labelled as derived. If an authoritative prerequisites document is written later,
> re-run the ingestion tool and reconcile against it.

---

## A. Decisions (no code proceeds past Stage 5 without these)

### D1 — Where does the authoritative database live? · BLOCKS Stage 6+
The single biggest fork. Contract 02 mandates VPS SQLite; NIZAM uses Google Drive JSON, and
contract 02 explicitly names "ledger inside a syncing Drive folder" as the thing to avoid.
- **Option A:** keep Drive-as-database (owner-owned, zero-cost, no server; loses server-side
  ingestion and the bot).
- **Option B:** move to VPS SQLite (transactional integrity, enables the full PFOS tier; adds
  cost, a server, and secrets).
- **Option C:** hybrid — Drive stays the store + interface, a minimal server does ingestion only.
- **Needed from you:** the choice, and your tolerance for (a) recurring VPS cost and (b) a
  standing internet-exposed server holding financial data.

### D2 — Is there a chat bot and a server at all? · BLOCKS Stages 6-8
Downstream of D1 but separable. Telegram/Gmail/SMS/OpenRouter all require an always-on backend.
- **Needed from you:** whether an always-on bot is worth a server's cost and risk, or whether
  the offline web dashboard is sufficient.

### D3 — Reference currency & inflation source
Contract 03 §8 requires "real" net worth. Needs your reference currency (EGP? USD?) and an
acceptable EGP inflation + FX source. (Open question 04 §15 Q3.)

### D4 — Initial protected-buffer rule
Safe-to-spend (Stage 1) needs your minimum liquidity buffer and essential-living reserve.
(Open question 04 §15 Q2.)

### D5 — Which provider is imported first, and event-alert threshold
Contract 04 §15 Q4 + Q7. Needed to prioritize ingestion and to set the "material event" cutoff.

### D6 — Contract 05 (agent orchestration & tooling): write it or approve an interim policy
· BLOCKS Stage 7
This contract does not exist. It would govern the money-adjacent LLM/tooling/credential surface.
Stage 7 must not begin until it is written or you approve an interim policy recorded in the repo.

### D7 — Behavioural/health data consent · BLOCKS Stage 8
Explicit, revocable consent to join minimized WHOOP/journal signals, only after the separate
encrypted namespace exists. Default is **no linkage**.

---

## B. Credentials & secrets (each is a new attack surface; none exist server-side today)

> All go into `.env.local` or a server secret store — **never** the repo or Drive. New
> integrations add only placeholder keys to `.env.example`.

| # | Credential | For | Stage | Notes |
|---|---|---|---|---|
| K1 | **Google Web-application OAuth client id + browser API key** | Live Drive sign-in + Picker import in the *existing* app | now | Already outstanding in `RELEASE_CHECKLIST.md`. The tracked credential is a *desktop* client (wrong type for the browser SPA). This is the one unblock the current app needs. |
| K2 | Optional Drive folder id | Pin `nizam_db.json` to a chosen folder | now | `VITE_NIZAM_DRIVE_FOLDER_ID`; app creates a folder if empty. |
| K3 | Telegram bot token + your Telegram user id (allowlist) | Bot interface | 6 | Rotate-able; allowlist is the primary auth (02 §9). |
| K4 | OpenRouter API key + spend cap | LLM routing | 7 | Verify data-retention settings (02 §12.6). Set a hard spend limit. |
| K5 | Gmail OAuth grant (restricted label/query) | Email relay ingestion | 6 | Minimal scope, dedicated label only (02 §3.2). |
| K6 | SMS/iOS Shortcuts shared secret | Signed SMS ingestion | 6 | Signed webhook path (02 §9); validate on your current iOS version (02 §12.1). |
| K7 | VPS credentials + backup encryption key | Server host + offsite backup | 6 | Only if D1=B/C. Offsite backups must be encrypted (02 §9). |
| K8 | Macro/FX data source key (if the chosen source needs one) | Real net worth + macro engine | 4/7 | EGP inflation + FX; source chosen in D3. |

**Server-free stages (1-4) require none of K3-K8.** They only benefit from K1/K2 for live Drive.

---

## C. Data & artifacts only you can provide

| # | Item | For | Contract ref |
|---|---|---|---|
| Dv1 | Sanitized examples of every bank/financing **SMS** format you receive | Building deterministic parsers before any LLM | 02 §12.2 |
| Dv2 | Representative monthly **statements** (HSBC, CIB, NBE, cards, BNPL) | Statement parser + reconciliation | 02 §12.3 |
| Dv3 | Your **accounts, liabilities, obligations** with balances, due dates, minimums, priorities | Obligation calendar + safe-to-spend (Stage 1) | 01 §5.2, 02 §6 |
| Dv4 | Family/informal obligation representation + how to verify them | Obligation model | 04 §15 Q8 |
| Dv5 | Your daily/weekly/monthly **preferred delivery times** | Brief scheduling (server tier) | 04 §15 Q1 |
| Dv6 | Primary **dashboard language** (Arabic/English) | UI localization priority | 04 §15 Q5 |

---

## D. Readiness checklist (derived — there is no authoritative source doc)

Before **any server work (Stage 6)**:
- [ ] D1 and D2 decided and recorded in the repo.
- [ ] VPS provisioned and hardened (TLS, firewall, secret store, redacted logs) — 02 §9.
- [ ] Backup **and restore drill** proven, not just backup created — 02 §10.
- [ ] K3-K7 obtained, stored outside repo/Drive, rotation plan noted.

Before **any LLM work (Stage 7)**:
- [ ] Contract 05 written or interim orchestration/tooling policy approved (D6).
- [ ] Prompt-injection test in place (documents-are-untrusted-data) — 02 §9.
- [ ] OpenRouter spend cap + data-retention verified (K4).

Before **any behavioural data (Stage 8)**:
- [ ] Separate encrypted namespace built and tested — 02 §2.5.
- [ ] Explicit, revocable consent captured (D7); default remains no-linkage.

Available **now**, no human input required: Stages 1-4 (obligations, safe-to-spend, decision
cards, forecasting, decision registry, multi-currency) can begin against the existing Drive DB.
K1 only unblocks *live* Drive round-trip of the already-built app; it does not block Stage 1-4
development against test data.

---

## E. The single most useful next input

If you want the fastest visible progress with zero new risk: provide **Dv3** (your accounts,
obligations, and balances). That alone unblocks Stage 1 — the safe-to-spend engine and
obligation calendar — which is the PFOS north-star feature and needs no server, no secret, and
no new attack surface.
