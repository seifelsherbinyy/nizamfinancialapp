<!--
NIZAM ADR-0003 — post-YNAB-teardown architecture decisions.
phase: OWNER_DECISIONS_RATIFIED_2026-09-02 · implementation authorized within each section's own terms
supersedes: nothing. AD-1 previously PROPOSED superseding ADR-0001; owner decision D7-C ruled a HYBRID
            instead, so ADR-0001 stands and is explicitly NOT superseded.
evidence: docs/research/2026-09-02-ynab-live-product-teardown.md,
          docs/architecture/CURRENT_FINANCIAL_ARCHITECTURE_GAP_ANALYSIS.md
-->

# ADR-0003 — Post-YNAB Architecture Decisions

Filed as `ADR-0003` to follow the existing convention (`ADR-0001-drive-as-database.md`,
`ADR-0002-gis-token-client-and-drive-v3.md`). The mandate named this file
`ARCHITECTURE_DECISION_RECORD.md`; numbered ADRs are referenced by number elsewhere, so the convention
was kept deliberately and is noted here rather than silently changed.

Status legend: **ACCEPTED** (ratified by owner) · **PROPOSED** (needs owner ratification) ·
**CONFLICTING** (contradicts current steering; must not be implemented until resolved).

**All sections of this ADR are now ACCEPTED.** The owner ratified the eight outstanding decisions on
2026-09-02 (D1-D8); the disposition table is in `docs/architecture/IMPLEMENTATION_PLAN.md`. AD-1 was the
last CONFLICTING section and is resolved below as a hybrid. No section of this ADR now awaits a decision.

---

## AD-1 — Cloudflare platform: **ACCEPTED as a HYBRID** (owner decision D7-C, 2026-09-02)

**Context.** The continuation mandate targets `React + TS + Vite -> Workers Static Assets -> typed Worker
API -> D1 -> optional R2/Queues/Cron`, with Cloudflare Access for auth. This section previously read
**CONFLICTING — NOT ADOPTED** and asked the owner for a platform decision. The owner ruled on
2026-09-02: **option C, hybrid.** The ruling is recorded below in the terms it must be implemented in.

**Evidence (unchanged — this is why the ruling is a hybrid and not an adoption).**
- FACT No `wrangler.toml`, `.dev.vars`, D1/R2/Queues binding or Workers entrypoint exists. Entirely greenfield.
- FACT `.kiro/steering/tech.md`: "**D1 (2026-08-06): the SERVER tier will use VPS + SQLite** — this Drive-JSON store is the Profile-A build, NOT the final database." Here "D1" is a **decision number, not Cloudflare D1**; the two must not be conflated.
- FACT `.kiro/steering/drive-db.md`: canonical store is one `nizam_db.json` in the owner's Drive, `drive.file` scope only.
- FACT `ADR-0001-drive-as-database.md` records Drive-as-database as an accepted decision.
- FACT `.kiro/steering/cloudflare-dns.md`: Cloudflare's present role is **DNS and gate G2 only**, via a scoped API token at `.secrets/cloudflare.env`. It also records that a token was **disclosed 2026-08-09**, that **rotation is DEFERRED (owner decision D-ROTATE)**, and that **no session may rotate unilaterally**.

**Decision (D7-C).** Cloudflare Workers are **permitted as a stateless edge and ingestion layer only.**
The canonical store does not move. Precisely:

| Cloudflare surface | Ruling |
|---|---|
| Workers as static-asset host for the built SPA | **PERMITTED.** It serves bytes; it holds no state. |
| Workers as a stateless ingress terminator (webhook receipt, signature check, enqueue-and-forget) | **PERMITTED.** Must be verbatim-relay only — see the four constraints below. |
| Workers Cron as a *trigger* that wakes an existing deterministic job | **PERMITTED.** The trigger carries no figure and makes no decision. |
| Cloudflare D1 as a store of ledger data | **NOT ADOPTED.** |
| R2 / KV / Durable Objects as a store of ledger data | **NOT ADOPTED.** |
| Cloudflare Access as the owner's auth surface | **DEFERRED.** Not ruled on by D7; needs its own decision. |
| Any Worker performing monetary arithmetic, FX, or normalization-with-judgement | **FORBIDDEN.** Contract-level, not preference. |

**ADR-0001 is NOT superseded.** Drive (`drive.file`, one encrypted store) remains the Profile-A canonical
ledger. `tech.md`'s D1 (2026-08-06) VPS + SQLite server-tier decision stands unchanged as the server-tier
target. Nothing in this ruling retires, mirrors or demotes either.

**The four constraints any Worker introduced under this ruling must satisfy.**
1. **Stateless.** No Worker holds ledger state between requests. A Worker that needs to remember a figure
   is out of scope by construction, not by review.
2. **Verbatim relay.** An ingestion Worker forwards the received bytes and a content hash. It does not
   parse an amount, pick a currency, infer a direction, resolve an account, or round anything. The
   deterministic parser downstream does that, and refuses rather than guesses (Contract 15 §5).
3. **Out of the application bundle.** A Worker entrypoint is a separate build target. No engine module,
   no `src/lib/money/*`, no `src/features/*` engine import may be reachable from it, and no Cloudflare
   type may appear in an engine signature — the portability rule below is unchanged.
4. **Credential surface stays frozen.** Cloudflare's live credential posture is unchanged: DNS and G2 only,
   `D-ROTATE` still deferred, **no session mints or rotates a Cloudflare credential**, and standing up a
   Worker in production is a human gate action, not an implementation step.

**Consequences.** This ruling unblocks the ingestion half of AD-6 and Contract 15 without a data migration:
there is nothing to migrate, because the store did not move. It leaves exactly one open question, recorded
rather than assumed — **Cloudflare Access as the auth surface**, which D7 did not rule on.

**Non-negotiable regardless of outcome (unchanged).** Finance-core and domain logic stay portable — no
Cloudflare, Drive, D1 or Dexie type may appear in engine signatures. Persistence reaches the engine
through injected ports only.

---

## AD-2 — Local / recovery mirror: **PROPOSED**

**Context.** The model must serve web, offline clients, Hermes readers, recovery mirrors and a possible
mobile client.

**Decision (proposed).** Exactly **one canonical ledger** at any time. All other copies are **read-only
mirrors** and are explicitly labelled as such. Dexie remains the working mirror per `drive-db.md`. A
recovery mirror is a point-in-time export, never a write target.

**Rationale.** Drive, Telegram and email must not become competing ledgers (FN-YNAB-02). The failure mode
is silent divergence, which is unrecoverable in a finance app.

**Consequence.** Mirrors need deletion visibility, which is impossible without tombstones — so AD-5 is a
prerequisite, not an optional companion.

---

## AD-3 — Multi-currency is foundational: **ACCEPTED** (owner decision FN-YNAB-01, 2026-09-02)

**Decision.** Native currency on `Account` and `Transaction`; EGP remains base and default presentation;
reporting amounts are derived leaves with full FX provenance; native amounts are never destroyed.

**Evidence that this is cheaper than assumed.** FACT `mulRatio()` (`src/lib/money/money.ts:203`) already
performs exact rational conversion with a BigInt intermediate and half-away-from-zero rounding.
FACT `FxRate` already stores an integer rational plus `source` and `asOf`. FACT `Asset.currency` already
exists. The work is extending carriers and observation semantics, **not** building FX arithmetic.

**Consequences.** `FxRate.asOf` must widen from date to datetime — the only mutation of an existing field
and the highest-risk migration item. `money-rules.md` rule 5 (EGP-only display) must widen. Mixed-currency
summation must throw rather than coerce.

**Field mutation LANDED 2026-09-02 (owner decision D1-A).** `FxRate.asOf` (date) is now
`FxRate.observedAt` (datetime) at `SCHEMA_VERSION 8`. `migrateV7toV8` appends `T00:00:00Z` to every
existing value, so ordering is preserved exactly for migrated rows and no monetary field is touched;
`downgradeV8toV7` **refuses** rather than truncating when any `observedAt` carries a non-midnight time,
because a silent truncation would make two distinct observations indistinguishable. The caller-facing
`asOf` QUERY parameter is a different concept ("as it stood on this day") and was deliberately NOT
renamed. Per-currency **display formatting** was not among the eight decisions the owner ratified and
remains open — see `FINANCIAL_DATA_MODEL_VNEXT.md` §8 item 6.

---

## AD-4 — Deterministic finance-core is the sole source of monetary truth: **ACCEPTED**

**Decision.** Canonical money stays integer milliunits. All monetary computation happens in deterministic
engines. Formatted/decimal values are leaf outputs and may never feed ledger arithmetic, budgets, debt,
forecasts, obligations, net worth, scenarios, reconciliation or FX. No LLM, benchmark or routing module may
originate, source or interpolate a monetary value or an FX rate; they may explain, annotate or propose only.

**Evidence.** FACT already satisfied in substance — `zMoney` integer guard at the schema boundary, no
persisted `_formatted`/decimal field anywhere in `NizamDb`, one-way `toDecimal`/`format`. This is stronger
than the upstream API, which exposes `balance_currency` as a double.

**Consequence.** Enforcement is currently by convention. A branded `Money` type would make violation
unrepresentable; proposed in `FINANCIAL_DATA_MODEL_VNEXT.md` §M2 as opt-in.

---

## AD-5 — Deletion requires tombstones and a versioned cursor: **ACCEPTED, with a correction**

**Decision.** Per-entity `deleted` tombstone and per-entity monotonic `version`; a cursor exposing
new / changed / superseding / deleted since version X; stale clients must never resurrect deleted data.

**Correction to earlier reporting.** I previously told the owner that "absence is not deletion" was a
blanket live bug. **That was too strong.** FACT `mergeCollection` (`src/lib/drive/sync.ts:40-93`) is a
genuine base-aware 3-way merge and, given a true base, already drops locally deleted rows (line 66) and
audits edit/delete divergence into `meta.conflicts`.

**The actual defect (FACT).** `src/state/store.ts:63,137` supply the merge base as
`getBase: () => baseDb ?? db`, and `baseDb` is initialised `null` (line 96). When it is null, base
collapses to local, `localChanged` is always false, remote wins unconditionally, and a locally deleted row
that still exists remotely is **resurrected**. Reachable on any fresh session or cache loss before a first
sync point.

**Consequence — ordering matters.** Repairing the base fallback is smaller, independently valuable, and
must land **before** tombstones. Tombstones then extend correctness to clients that never held a base
(Hermes, mirrors, mobile), which no base-aware merge can serve.

---

## AD-6 — Egyptian ingestion is manual/file first: **ACCEPTED** (owner decision FN-YNAB-02)

**Decision.** Priority order: manual entry, opening balance/snapshot, CSV/XLSX, statement files, then
SMS/email candidates, then Telegram candidates/review, then authorized APIs later. Telegram is
capture/review and never ledger authority. All intake flows
`capture -> parser -> normalized candidate -> deterministic validation -> dedupe -> review -> canonical
ledger -> reconciliation`.

**Evidence supporting the priority.** FACT the teardown established that upstream direct import covers only
US/CA/UK/EU banks (Plaid + MX per their CSP allowlist), so Egyptian accounts are structurally file-import
only upstream. NIZAM's ordering is therefore not a limitation but the correct primary path.

**Gap — CLOSED 2026-09-02.** That gap read "no staging collection exists; the only isolation today is
`approved: false`, which the mandate forbids as a substitute." `transactionCandidates` now exists as a
separate collection at `SCHEMA_VERSION 6` (`src/lib/db/schema.ts`), excluded from every engine by
construction rather than by a flag, with a standing test asserting the exclusion.

**Extension — daily conversational capture (owner requirement, D7, 2026-09-02).** The owner added
"ensure the agentic Hermes asks and captures the latest daily transactional information". That is a new
first entry in this priority order and it was ungoverned: it appears in no tier of
`ops/HERMES_CAPABILITY_EXPANSION_REGISTER.md`. It is now governed by
`contracts/pfos/15_NIZAM_Daily_Transaction_Capture_and_Candidate_Staging.md`, which places it **inside**
this section's pipeline rather than beside it — the daily prompt is the `capture` stage, and every later
stage is unchanged. It is deliberately **not** an LLM tool: `runtimeAdapter.ts`'s `AUTHORITY_KEY` guard
already makes a monetary payload key unrepresentable across the Hermes tool boundary, so a capture tool
would have had to weaken an existing guard to exist. It does not.

---

## AD-7 — Security and visual identity are NIZAM's own: **ACCEPTED**

**Decision.** Upstream response headers are **comparative evidence only**. NIZAM defines its own CSP,
header set, allowlist, secrets policy, auth, upload policy, analytics posture and dependency policy. No
upstream branding, palette, token names, CSS or JS is copied. NIZAM's own visual identity is calm, dense,
responsive, accessible and bilingual/RTL-ready.

**Evidence handling.** Upstream client keys and CSP nonces observed during research are redacted in
`docs/research/2026-09-02-ynab-live-product-teardown.md`.

**Deliberate divergence.** The teardown recorded twelve third parties in the upstream critical path
(aggregation, realtime, billing, analytics, observability, support, consent, fraud). NIZAM's zero-vendor,
offline-first posture is a privacy advantage and is retained.

---

## Open ratifications — ALL RESOLVED 2026-09-02

Every row below was answered by the owner on 2026-09-02. The disposition table with commit references is
in `docs/architecture/IMPLEMENTATION_PLAN.md`; this table records only which ADR section each answer closes.

| Item | Was needed from owner | Ruling |
|---|---|---|
| AD-1 | Platform decision; superseding ADR for ADR-0001; reconciliation with `tech.md` VPS+SQLite | **D7-C hybrid.** Workers = stateless edge/ingestion only. ADR-0001 **not** superseded; `tech.md` VPS+SQLite stands. Cloudflare Access left explicitly deferred. |
| AD-2 | Confirm one-canonical-ledger + read-only mirrors | **Confirmed** by D7-C's "the canonical store does not move" and by Contract 15 §4, which makes the capture tier a staging collection and never a second ledger. |
| AD-3 | Sign-off on `FxRate.asOf` date -> datetime field mutation | **D1-A.** Landed at `SCHEMA_VERSION 8`; see the AD-3 note above. |
| AD-5 | Confirm base-fallback repair lands before tombstones | **Confirmed** — ordering unchanged; the repair remains a prerequisite of tombstones, not a companion. |
| vNext §8 | Uncleared derive-vs-store; reporting derive-vs-cache; reconciled correction workflow; branded `Money`; per-currency formatting | **D2-A** derive uncleared · **D3-A** derive reporting amounts on read · **D4-A** reversal + replacement · **D5-B** branded `Money` deferred · **per-currency formatting NOT ruled on and still open** (vNext §8 item 6). |
| Working tree | 52 tracked deletions incl. all `.kiro/specs` and `.kiro/steering` — restore or confirm intentional | **D6-B.** Confirmed intentional; deletions committed. Steering authority now lives in the contracts and this ADR. |

**One item is deliberately still open** and must not be treated as decided: per-currency display
formatting (vNext §8 item 6). It was not among the eight the owner ratified, so no code may change
non-EGP display formatting until it has its own decision.
