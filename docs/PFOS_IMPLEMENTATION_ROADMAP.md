# PFOS Implementation Roadmap

**Date:** 2026-08-05
**Basis:** the four ingested PFOS contracts + the validated NIZAM repository.
**Principle:** preserve every validated repository capability; add PFOS capability in the
order that maximizes value while minimizing risk; never introduce a server, a secret, or a
new data class before the decision that authorizes it.

> This roadmap is **execution order**, not a schedule. Each stage lists its entry gate, the
> work, the acceptance bar (extending the existing harness), and what it must not break.

---

## The ordering rule

Three forces set the order:

1. **Two decisions gate the server tier** (D1 database location, D2 server/bot — see
   `docs/PFOS_HUMAN_DELIVERABLES.md`). Nothing that needs a backend is scheduled before them.
2. **Server-free intelligence is available now.** Safe-to-spend, obligations, decision cards,
   deterministic forecasting, and the decision registry can all be built inside the current
   static app on the Drive DB. This is the highest value-per-risk work, so it goes first.
3. **Risk rises sharply when a server, an LLM, or health data enters.** Those stages are last
   and each carries its own hardening.

So the order is: **deepen the server-free product → make the two decisions → (only if chosen)
build the server/ingestion/LLM tier → add behavioural intelligence last.**

---

## Stage 0 — Ingestion & governance (this change) · DONE

- Ingested contracts 01-04 with checksums; proved 05-08 absent.
- Added `AC08b` isolation check (negative-tested) so the ingestion tool's broader scope can
  never leak into the app.
- Produced this roadmap, the gap analysis, the human-deliverables list, and the ingestion
  report.
- **Did not touch `src/`.** Baseline preserved: 135 tests, 19/19 checks.
- **Follow-up:** run `node scripts/ingest/pfos-drive-pull.mjs --revoke` once the contracts are
  stable, to withdraw the read grant.

---

## Stage 1 — Obligations & Safe-to-Spend (server-free) · HIGHEST VALUE

**Entry gate:** none (pure client work on the existing Drive DB).
**Why first:** safe-to-spend is the product's north-star answer ("how much can I spend?") and
the obligation calendar is its prerequisite. Both are the PFOS Release-1 items NIZAM is
missing, and neither needs a server.

**Work**
- Add an `Obligation` entity to the schema (creditor, amount due, minimum, due date, grace,
  frequency, **priority P0-P3**, penalty, interest, protected reserve). Additive + nullable so
  existing `nizam_db.json` files load unchanged; bump `SCHEMA_VERSION` with an idempotent
  migration (the repo already has a tested migration framework).
- Build the safe-to-spend engine per PFOS 03 §2 as a **pure function over the money core**:
  `SafeToSpend(H) = liquid + inflows(H) − pendingOut − protectedObligations(H) − essentialReserve(H) − buffer − uncertaintyReserve − plannedAllocations`.
  Reuse `liquidityRunway` primitives from `rescue.ts`.
- Build the obligation-protection statuses (green/amber/red/critical) and the 6 forecast
  windows (1d/7d/until-salary/30d/statement/90d).
- Surface both on a new **Command Center / Home** route (PFOS 04 §2) — without removing the
  budget grid.

**Acceptance (extend the harness)**
- New unit tests: safe-to-spend reserve hierarchy, P0 always fully reserved, floor-at-zero,
  uncertainty reserve responds to stale data. Push the test floor above 135.
- Money-invariant scan (AC07) stays green — safe-to-spend is integer milliunits.
- MVP acceptance from PFOS 04 §14: "P0 obligations are always reserved" becomes a test.

**Must not break:** RTA (Conflict C-4) — safe-to-spend is a **new** number beside
Ready-to-Assign, never a rename. Both display, clearly labelled.

---

## Stage 2 — Purchase Decision Cards (server-free)

**Entry gate:** Stage 1 (a decision card's horizon impacts are safe-to-spend deltas).
**Why here:** the second headline feature ("decide before you spend"), and it composes
entirely from Stage-1 outputs plus the budget engine.

**Work**
- Purchase Decision Engine (PFOS 03 §4): recommendation states
  (approve / approve-with-cap / approve-with-condition / delay / alternative / reject /
  financially-blocked) as a **deterministic policy gate** over safe-to-spend + obligations.
  No LLM — the contract (03 §1) forbids the LLM from being the source of numbers.
- The 11-line Decision Card (04 §4.4) with 4 time-horizon impacts, rendered in the web app.
- A `Decide` route (part of Conflict C-5's IA expansion).

**Acceptance:** tests for each recommendation state at its boundary; "a purchase
recommendation includes a direct answer and time-horizon impact" (04 §14) as a test.

**Must not break:** all money still integer; decision cards are pure functions (easy to test,
no side effects).

---

## Stage 3 — Deterministic forecasting & Decision Outcome Registry (server-free)

**Entry gate:** Stages 1-2.
**Why here:** this is the highest-value work that still needs no server, and it unlocks the
learning loop cheaply. PFOS 03 §6 deterministic scheduled cash flow and §12 decision registry
both run client-side against the Drive DB.

**Work**
- Deterministic + baseline/downside/upside cash-flow forecast over the 6 horizons; forward
  net-worth path (the repo has only a historical series today).
- `DecisionRecord` entity (03 §12): question, recommendation, forecasts, confidence, user
  action, review date, and later the actual outcome + prediction error.
- Forecast-error tracking so confidence can eventually be calibrated against reality.

**Defer to the server tier:** Monte Carlo and probabilistic ranges (heavier compute, better
on a backend) and any LLM-assisted interpretation.

**Acceptance:** forecast reconciles to safe-to-spend at H=today; decision records are
immutable once written (mirrors the ledger's append-only discipline); "every displayed
financial fact has a source and timestamp" (04 §14) enforced.

---

## Stage 4 — Multi-currency & real net worth (server-free, additive)

**Entry gate:** Stages 1-3.
**Resolves:** Conflict C-3.

**Work**
- Add `currency` to transactions and an exchange-rate table (the schema comment already
  anticipates one). Default everything to EGP so existing data is unaffected.
- Net-worth views beyond nominal: liquid, real (inflation-adjusted), liquidation, projected
  (PFOS 01 §6, 03 §8). FX source/time stored per valuation.
- Macro **inputs** as manual/imported values first (no live macro API yet — that is a server
  concern).

**Acceptance:** round-trip FX never uses floats; single-currency EGP databases produce
identical numbers to today (regression test).

---

## Stage 5 — DECISION POINT: database & server (D1, D2)

**This is where the fork is resolved.** Everything above deepened the static, owner-owned,
zero-cost product. Everything below requires a standing server and new secrets.

The owner chooses one of:

- **Path A — stay static (NIZAM-native).** Keep Drive-as-database, no server. Accept that
  Telegram, Gmail, SMS ingestion, live macro APIs, and OpenRouter are out of scope. The
  product remains an excellent offline personal-CFO **dashboard**. Lowest risk, lowest cost.
- **Path B — adopt the PFOS server tier.** Provision a VPS, move the authoritative ledger to
  SQLite (Drive becomes the document archive PFOS 02 §2.3 always intended it to be), and
  build the ingestion/bot/LLM tier. Highest capability, highest risk and cost.
- **Path C — hybrid.** Static app stays the interface and owns the budget; a minimal server
  does **only** ingestion (SMS/Gmail → normalized events → the Drive DB) with no LLM. Captures
  most of the ingestion value at a fraction of Path B's attack surface.

**No code in Stages 6+ starts until this is chosen.** The decision needs the human inputs in
`docs/PFOS_HUMAN_DELIVERABLES.md`.

---

## Stage 6 — Ingestion tier (only if Path B or C) · HARDENING-FIRST

**Entry gate:** Stage 5 = B or C, plus the credentials in the deliverables doc.

**Work, in this internal order (security before features):**
1. Harden the server first (TLS, secret store outside repo/Drive, redacted logs, rate
   limits, replay protection, audit log) — PFOS 02 §9 before any endpoint accepts data.
2. Immutable event inbox + idempotency keys (Telegram update id, Gmail message id, file hash)
   — PFOS 02 §5.1.
3. One ingestion source at a time: manual/Telegram → Gmail relay → PDF statement → iOS
   Shortcuts. Each with signed requests and the allowlist.
4. Probabilistic cross-source matching (PFOS 02 §5.2) feeding the review queue.

**Acceptance:** "duplicate SMS/manual/statement entries do not double-count" (04 §14) as an
adversarial test; a **prompt-injection test** (02 §9) even before any LLM, because documents
now enter the system; "a backup can be restored" (04 §14) as a drill.

---

## Stage 7 — LLM tier & orchestration (only if Path B) · CONTRACT 05 GAP

**Entry gate:** Stage 6, **and the missing contract 05 written or an interim policy approved.**

This stage builds exactly the surface that PFOS **contract 05 was supposed to govern and which
does not exist** (agent orchestration, tooling, model routing, credential handling). Building
money-adjacent LLM behaviour without its contract is the roadmap's biggest governance risk, so:

- **Do not start until contract 05 exists** or the owner signs off an interim orchestration +
  tooling policy recorded in this repo.
- Enforce PFOS 03 §1: LLM never sources balances, totals, due dates, or constraints; it only
  interprets, challenges, explains, and asks. Deterministic policy gate before and after any
  LLM synthesis.
- OpenRouter with spend controls, prompt/model/token/confidence logging, and the
  documents-are-untrusted-data rule wired into every tool call.

**Acceptance:** a test proving the ledger and safe-to-spend remain fully available when the
LLM/OpenRouter path is down (04 §14: "a failed LLM does not make the ledger unavailable").

---

## Stage 8 — Behavioural & adaptive intelligence (last) · HIGHEST PRIVACY RISK

**Entry gate:** Stage 3 (decision registry) + Stage 7 or explicit owner approval, **and** the
privacy boundary built first.

- Build the separate encrypted namespace for WHOOP/journal data **before** importing any of
  it (PFOS 02 §2.5, 01 §9 privacy boundary).
- Weekly learning cycle + confidence calibration + rule-weight **proposals** (PFOS 03 §12).
- Enforce the prohibited-self-modification list (never silently weaken P0/P1, never grant
  payment authority, never use new sensitive data, never rewrite history). Hard-policy changes
  require human approval — wire this as a gate, not a convention.

**Acceptance:** "no health/journal data is used without explicit permission" (04 §14) as a
test; correlation-never-causation enforced in output templates.

---

## Cross-cutting rules for every stage

- **Extend the harness, never bypass it.** Each stage raises the test floor and adds
  acceptance checks drawn from the PFOS machine-executable schemas and 04 §14. The 19 existing
  checks stay green throughout.
- **Schema changes are additive + migrated.** New fields nullable; `SCHEMA_VERSION` bumped
  with an idempotent, tested migration; existing `nizam_db.json` always loads.
- **Money stays integer milliunits** through every new engine (AC07).
- **Every source file keeps its contract/phase header** (AC10) — new files cite the PFOS
  contract and stage they implement.
- **Secrets only ever in `.env.local` / a server secret store**, never in the repo or Drive
  (AC09). New integrations add placeholder keys to `.env.example` only.
- **One certificate per phase** in the verification ledger (AC13), independently verified.

---

## Sequencing summary

| Stage | Needs server? | Needs new secret? | Risk | Gated by |
|---|---|---|---|---|
| 0 Ingestion & governance | no | no (uses existing local cred) | low | — done |
| 1 Obligations + Safe-to-Spend | no | no | low | — |
| 2 Decision Cards | no | no | low | S1 |
| 3 Forecasting + Decision Registry | no | no | low-med | S1-2 |
| 4 Multi-currency + real net worth | no | no | low | S1-3 |
| 5 **DECISION: DB & server** | — | — | — | D1, D2 |
| 6 Ingestion tier | yes | yes | high | S5=B/C |
| 7 LLM / orchestration | yes | yes | high | S6 + contract 05 |
| 8 Behavioural / adaptive | yes* | maybe | highest | S3/S7 + privacy boundary |

Stages 1-4 are safe to begin immediately and deliver most of the PFOS Release-1/2 value with
no server, no new secret, and no new attack surface.
