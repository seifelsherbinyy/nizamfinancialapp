# PFOS Repository Gap Analysis

**Date:** 2026-08-05
**Compares:** the four ingested PFOS contracts (authoritative product direction) against the
current NIZAM repository (validated, released code at commit `41cfb21`, tag `v0.1.0`).
**Method:** every PFOS capability is scored against what the code, `.kiro/specs`, steering,
tests, and the Drive data model actually implement. Nothing is called "done" without a code
path behind it.

> **One-line reading:** NIZAM is a complete, tested, offline, single-user zero-based
> budgeting app whose database is the user's own Google Drive. PFOS is a far larger
> "Personal CFO" — a server-hosted, chat-driven, multi-source ingestion, forecasting,
> decision, and learning system. **NIZAM is a faithful, high-quality implementation of
> roughly the Phase-1/Release-1 core of PFOS, and a deliberate architectural fork on
> the two biggest questions: where the database lives, and whether there is a server.**

---

## 0. The two decisions that gate everything else

Before any capability table, two conflicts must be named because they change what "the gap"
even means. Neither can be resolved by code; both need an owner ruling (see
`docs/PFOS_HUMAN_DELIVERABLES.md`, decisions D1 and D2).

### Conflict A — Where does the database live?

| | PFOS contract 02 | NIZAM repository |
|---|---|---|
| Authoritative store | **SQLite/PostgreSQL on a VPS.** "The live database must remain on the VPS local filesystem, not inside a synchronizing Google Drive folder." | **A single `nizam_db.json` in the user's Google Drive**, with Dexie as the offline mirror. ADR-0001. |
| Rationale given | SQLite gives atomic serializable transactions; Drive is file storage with API quotas | The user's financial data belongs to the user; no third-party server; zero recurring cost |

These are directly opposed. PFOS 02 explicitly names the exact thing NIZAM does (ledger
inside Drive) as the thing to avoid. **This is not a bug in either — it is a genuine fork.**
NIZAM optimized for zero-cost, zero-server, owner-owned data. PFOS optimizes for
transactional integrity, multi-source ingestion, and an always-on bot that a browser-only
app cannot provide.

### Conflict B — Is there a server, and is there a chat bot?

PFOS is architected around an always-on backend (FastAPI on a VPS), a Telegram bot as the
primary interface, a Gmail relay, iOS Shortcuts ingestion, and OpenRouter-routed LLM calls.
NIZAM is a **static single-page application with no backend at all** — deployable to any
static host, works fully offline, no bot, no email, no LLM, no scheduled jobs.

Every "missing" integration in the tables below (Telegram, Gmail, SMS, OpenRouter, forecasting
jobs, the learning loop) is downstream of this one architectural fact: **NIZAM has no server
to run them on.** They are not half-built; they are out of the current architecture entirely.

---

## 1. Capability scorecard

Legend: **Done** = implemented and tested in the repo · **Partial** = a real but narrower
version exists · **Absent** = no code path · **Fork** = the repo deliberately does it a
different way.

### Foundation (PFOS 01 §7, 02 §11 A-D; contract areas covered by NIZAM C1-C3)

| PFOS capability | Repo status | Evidence / note |
|---|---|---|
| Integer money core, no floats | **Done** | `src/lib/money`, 24 tests, AC07 invariant scan. Exceeds contract — contracts do not even specify this and it is the single most important correctness property for money. |
| Account & liability registry | **Partial** | `accounts.types.ts` has 6 types (CIB_DEBIT, HSBC_CC, CASH, BANK_OTHER, CREDIT_OTHER, TRACKING). PFOS 02 lists 12 (adds savings, personal loan, BNPL, family loan, investment, foreign-currency, asset, receivable). |
| Transaction ledger | **Partial** | Full YNAB-grade transaction model with splits, transfers, cleared/reconciled, import provenance. But PFOS 02 §4 mandates a richer state model — see §2 below. |
| Categorization & merchant normalization | **Partial** | Manual categorization + payee autocomplete. No automated merchant normalization, no category inference. |
| Deduplication | **Done (import)** | `ledgerImport.ts` exact + fuzzy + flagged dedup, 15 tests incl. idempotent re-import. Matches PFOS 02 §5.1 idempotency; §5.2 probabilistic scoring is narrower (import-time only, not a live cross-source matcher). |
| Reconciliation | **Partial** | `Reconcile.tsx` does statement-vs-cleared difference and lock. PFOS 02 §5.3 wants FX/tip/fee/settlement-date handling, pending→posted linking, installment decomposition — not present. |
| Obligation calendar | **Absent** | No due-date calendar, no obligation entity. PFOS 01 §5.2 P0-P3 matrix and 02 §6 obligation fields are core and unbuilt. |
| Budget engine (zero-based, YNAB rules) | **Done** | `budget.logic.ts`: available = carryIn+assigned+activity, RTA, rollover, cash vs credit overspend, credit-card payment categories, goals. 19+24 tests. This is the strongest part of the repo. |

### Daily control & intelligence (PFOS 03; PFOS 01 §7 intelligence)

| PFOS capability | Repo status | Evidence / note |
|---|---|---|
| Safe-to-spend engine | **Absent** | PFOS 03 §2 defines an 8-term reserve formula (protected obligations, liquidity floor, uncertainty reserve, planned allocations). The repo has budget "Ready to Assign" — a **different concept**. RTA is money not yet assigned this month; safe-to-spend is money spendable across a horizon without breaching protected obligations. Closest primitive: `liquidityRunway` in `rescue.ts`. |
| Obligation protection engine | **Absent** | Green/amber/red/critical statuses, funding-sequence recommendation, 6 forecast windows — none present (no obligation entity to protect). |
| Purchase Decision Engine / Decision Cards | **Absent** | PFOS 03 §4 + 04 §4.4 specify an 11-line decision card with 4 time-horizon impacts. No code. This is the product's headline feature ("decide before you spend"). |
| Risk engine (12 categories) | **Absent** | Partial adjacency: `rescue.ts` computes card utilization, debt-service ratio, liquidity runway, a 30/60/90 control panel — a static-snapshot risk read, not the probabilistic engine of PFOS 03 §5. |
| Forecast engine (6 horizons, scenarios, Monte Carlo) | **Absent** | `netWorthSeries` is a **historical** series, not a forward forecast. No scenario builder, no confidence intervals, no forecast-error tracking. |
| Debt strategies (avalanche/snowball/hybrid) | **Absent** | `debtServiceRatio` measures burden; it does not compare payoff strategies. |
| Capital allocation engine | **Absent** | No code. |
| Net-worth: nominal / liquid / real / liquidation / projected / decision | **Partial** | `netWorth.ts` computes one nominal series. PFOS 01 §6 + 03 §8 require six views incl. inflation-adjusted, FX-aware, liquidation, and projected. Five of six absent. |
| Leak & behavioural intelligence | **Partial** | `spending.ts` gives category/merchant spend (leak *inputs*). No subscription detection, no lifestyle-creep detection, no behavioural (WHOOP/journal) layer. |
| Macro / FX / inflation engine | **Absent** | No macro ingestion; money is EGP-only, single currency, no FX table despite the schema comment anticipating one. |
| Evidence package + explainability | **Absent** | No structured evidence assembly. (The UI does cite formula sources in `rescue.ts`, a primitive form of explainability.) |
| Decision Outcome Registry + learning loop | **Absent** | PFOS 03 §12 — no decision records, no forecast-vs-actual, no confidence calibration, no rule-weight proposals. Entire learning tier unbuilt. |

### Interfaces (PFOS 04)

| PFOS capability | Repo status | Evidence / note |
|---|---|---|
| Web dashboard (YNAB-style) | **Partial** | Budget grid, register, accounts sidebar, reconcile, reports, import — all real and tested. But the PFOS "Command Center" home (safe-to-spend, status, protected obligations, today's action) does not exist; the app opens on the budget grid. |
| 7-section PFOS information architecture | **Fork** | Repo IA is 5 routes (budget/accounts/reports/import/reconcile). PFOS 04 §3 specifies Home/Plan/Activity/Decide/Grow/Insights/System. Decide, Grow, Insights and the Command-Center Home are absent. |
| Telegram experience | **Absent** | No bot. Downstream of Conflict B. |
| Daily / weekly / monthly briefs | **Absent** | No brief generation, no scheduler. `Reports.tsx` is an on-demand analytics view, not a scheduled brief. |
| Accessibility (WCAG, RTL, ar/en) | **Partial** | Semantic tables, focus-trapped modal, RAG-plus-label money cells, EGP `ar-EG`/`en` formatting exist. Full RTL and Arabic UI not built (formatting is bilingual; layout is not). |

### Security & data architecture (PFOS 02 §9)

| PFOS control | Repo status | Evidence / note |
|---|---|---|
| Minimal OAuth scopes | **Done / exceeds** | App uses `drive.file` only, asserted by AC08. Stricter than the contract's "read-only where possible". |
| Secrets outside repo | **Done** | `.env.local` gitignored, `.secrets/` gitignored, AC09 secret scan, `.env.example` placeholders only. |
| Prompt-injection defence ("documents are untrusted data") | **N/A yet** | No LLM and no document-derived instructions in the app, so the threat is not present. Becomes mandatory the moment any PFOS ingestion/LLM path is built. |
| Encryption at rest, offsite backups, key rotation, audit of tool calls | **Partial / Fork** | Drive holds the data (Google's encryption at rest); dated snapshots act as versioned backup; `meta.conflicts` audits sync merges. VPS-specific controls are N/A without a VPS. |
| Telegram allowlist, signed ingestion, rate limits | **Absent** | No ingestion endpoint exists. |

---

## 2. Concrete data-model gaps (PFOS 02 §4 vs `src/lib/db/schema.ts`)

The repo transaction is YNAB-shaped. PFOS 02 §4 wants a richer, ingestion-and-reconciliation
shape. Fields PFOS requires that the repo lacks:

- `source_event_id`, `source_type` — provenance of the raw event (the repo has `importInfo`
  for CSV import only, not a general source-event link).
- `posted_at` distinct from `occurred_at` — the repo has one `date`.
- `verification_level` (observed → provisional → matched → posted → reconciled) — the repo
  has `cleared` (uncleared/cleared/reconciled), a coarser 3-state.
- `duplicate_probability`, `category_confidence` — the repo carries confidence only inside
  `importInfo`, not on the live transaction.
- `supersedes_transaction_id`, `audit_version` — no correction-chain or per-row versioning.
- `currency` on the transaction — the repo is single-currency EGP.
- The **immutable event inbox** (PFOS 02 architecture) — raw events retained before parsing.
  Absent; the repo parses CSV straight into transactions.

**Assessment:** the repo model is not wrong for a budgeting app; it is a subset of the PFOS
model. Migrating forward is additive (new nullable fields + a new source-event table), so it
does not threaten existing data. This is a low-risk expansion, not a rewrite.

---

## 3. Conflicts (must be decided, not coded around)

| ID | Conflict | Repo position | PFOS position | Impact |
|---|---|---|---|---|
| C-1 | Database location | Google Drive JSON | VPS SQLite | Architectural. Blocks server-side ingestion, scheduled jobs, and the bot if unresolved in NIZAM's favour. |
| C-2 | Server vs static | No backend | Always-on FastAPI | Gates Telegram, Gmail, SMS, OpenRouter, forecasting jobs, learning loop. |
| C-3 | Single vs multi-currency | EGP only | Multi-currency + FX + real net worth | Net-worth "real" view and macro engine cannot exist without this. Additive to the schema. |
| C-4 | Ready-to-Assign vs Safe-to-Spend | RTA (assignment) | Safe-to-spend (horizon spendability) | Different concepts. Building safe-to-spend must not overwrite or rename RTA; both should coexist. |
| C-5 | 5-route IA vs 7-section IA | budget/accounts/reports/import/reconcile | Home/Plan/Activity/Decide/Grow/Insights/System | UI reorganization; low risk if additive. |

---

## 4. Security risks introduced or implied by adopting PFOS direction

1. **New credential surface.** PFOS needs a Telegram bot token, an OpenRouter key, a Gmail
   OAuth grant, and possibly SMS-provider keys. Each is a new secret and a new attack
   surface. NIZAM today ships **zero** server secrets. See `docs/PFOS_HUMAN_DELIVERABLES.md`.
2. **Prompt injection becomes live.** The moment statements/receipts/emails are fed to an
   LLM, PFOS 02 §9's "documents are untrusted data" rule stops being theoretical. Any LLM
   path must gate tool use behind system policy, never document content.
3. **Behavioural/health data (WHOOP, journal).** PFOS mandates a hard privacy boundary
   (separate encrypted namespace, explicit consent, correlation-not-causation). Introducing
   this data without that boundary would be the single worst privacy regression available.
4. **A server widens everything.** A VPS is a standing, internet-exposed asset with
   credentials, versus today's static files. This is the largest single risk increase in the
   whole PFOS direction and is why the roadmap sequences hardening alongside — not after —
   any server work.
5. **Scope creep on Drive.** Server-side Drive access would likely need a broader scope than
   the app's `drive.file`. That must be a separate service credential, never the browser
   client, and never the desktop credential currently used only by the local ingestion tool.

---

## 5. Integration-specific gaps (the surfaces the request names)

| Surface | PFOS role | Repo state | Gate |
|---|---|---|---|
| **Telegram / Hermes** | Primary interface + orchestrator (PFOS 02 §8) | Absent | Needs server (C-2) + bot token + allowlist |
| **OpenRouter** | Task-routed LLM calls (PFOS 02 §8.2) | Absent | Needs server + key + spend controls + prompt-injection gate |
| **Gmail** | Transaction relay fallback (PFOS 02 §3.2) | Absent | Needs server + restricted-label OAuth grant |
| **SMS** | Primary transaction signal via iOS Shortcuts (PFOS 02 §3.1) | Absent | Needs server ingestion endpoint + signed requests + iOS validation |
| **Forecasting** | 6-horizon scenarios + Monte Carlo (PFOS 03 §6) | Absent (only historical net-worth series) | Deterministic scheduled cash flow can be built **client-side first**, no server needed |
| **Learning loop** | Decision registry + calibration (PFOS 03 §12) | Absent | Needs decision records first; can be client-side |

**Important nuance:** forecasting and the learning loop are the two "advanced" surfaces that
do **not** strictly require the server. A deterministic cash-flow forecast and a decision
outcome registry can be built entirely inside the current static app against the Drive DB.
The roadmap exploits this: it front-loads the server-free intelligence and defers the
server/bot decision.

---

## 6. What NIZAM has that PFOS does not specify (do not regress)

These are validated repository strengths that the PFOS contracts are silent on. Preserve them.

- **Integer-milliunit money with an enforced no-float invariant** (AC07). PFOS never
  specifies money representation; NIZAM's choice is stricter and correct. Keep it as the
  money core for any PFOS engine.
- **Offline-first PWA** with a 10-entry local-only precache and no remote asset references
  (AC06). PFOS assumes an always-online server; NIZAM works with no connectivity.
- **The verification harness itself** — 19 mechanical acceptance checks and an
  independently-verified certificate ledger. This is a governance asset. Any PFOS work should
  extend it, not sidestep it.
- **Owner-owned data with no third-party server.** A real privacy property that the PFOS
  VPS model gives up. The owner should decide this trade-off consciously (D1).

---

## 7. Bottom line

- **Completed scope:** the zero-based budgeting core, the money engine, the Drive data layer
  with 3-way merge, CSV import with dedup, the YNAB-style UI, reconciliation, historical
  reports, rescue analytics, and an offline PWA — all tested (135 tests) and released.
  This maps to roughly **PFOS Release 1 minus safe-to-spend and the obligation calendar**.
- **Largest missing capabilities, in product-value order:** safe-to-spend engine · obligation
  protection + calendar · purchase Decision Cards · forecasting · decision/learning loop ·
  multi-currency + real net worth · the chat/ingestion/LLM tier.
- **Nothing built is wasted.** Every PFOS engine can sit on top of the existing money core,
  Drive DB, and budget logic. The gap is additive, not corrective.
- **Two owner decisions gate the rest:** database location (D1) and server/bot (D2). Until
  those are made, the safe work is the server-free intelligence that deepens what NIZAM
  already is. That is exactly what the roadmap orders next.
