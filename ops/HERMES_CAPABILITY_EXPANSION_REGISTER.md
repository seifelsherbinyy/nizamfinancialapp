# NIZAM Hermes — Agent Capability Expansion Register

> **Authority:** PFOS Contracts 05, 06, 12, 15, and the DEPLOYMENT_CONTROL gate register.
> **Contract numbering, corrected 2026-09-02:** this register once recommended authoring
> "Contract 14 (Calendar)" and "Contract 15 (External Data)". Both numbers were already taken —
> 14 by the single-window ingress contract, 15 by daily transaction capture — so those
> recommendations now read 16 and 17. Contracts outrank this register; the register moved.
> **Purpose:** Map every tool that CAN be added to `toolBoundary.ts` vs. every operation
> that must remain human-only. Governs the path from the current 10-tool baseline to
> full-autonomy operation within the NIZAM architecture.
> **Money rule:** No tool in any tier may produce, modify, or be the source of truth for a
> monetary value. Integer milliunits flow only from the deterministic engine (Contract 03).
> **No deployment particulars.** No hostnames, tokens, folder IDs, or secrets appear here.

---

## Baseline — the 10 tools that exist today

| # | Tool name | Profile | Domain | Direction |
|---|-----------|---------|--------|-----------|
| 1 | `nizamcore.read_journal_context` | nizam | journal | read |
| 2 | `nizamcore.append_journal_entry` | nizam | journal | write |
| 3 | `nizamcore.read_recovery_state` | nizam | health | read |
| 4 | `nizamcore.request_pfos_analysis` | nizam | financial | request |
| 5 | `pfos.read_financial_snapshot` | pfos | financial | read |
| 6 | `pfos.run_deterministic_analysis` | pfos | financial | compute |
| 7 | `signalbus.publish_bounded_signal` | both | operational | write |
| 8 | `signalbus.read_bounded_signals` | both | operational | read |
| 9 | `knowledge.read_github_content` | both | operational | read |
| 10 | `knowledge.load_profile_memory` | both | all allowed | read |

Capabilities the agent **cannot do today**: access goals, query historical transactions,
read its own knowledge index, schedule future actions, query signals over time, read
calendar, write to GitHub, compute budget variance, or fetch live data beyond recovery.

---

## Tier 1 — Add today. Port exists. Existing contract covers it. Wire only.

These require changes to `toolBoundary.ts` and a corresponding port call. No new
contract section needed. Each is read-only or is a bounded local write.

---

### T1-A · `nizamcore.read_goal_state`
- **Profile:** nizam only
- **Domain:** `goal` (in nizam's `allowedDomains` per `profilePolicy.ts`)
- **What it does:** Reads the current goal documents from the knowledge index.
  Returns a `GroundedContext` scoped to `goal` domain — the same evidence packet shape
  that `load_profile_memory` already produces, but filtered to goals only.
- **Why it's safe today:** Contract 05 §3.1 already defines `goal` as a recognized
  class with folder role `goals`. `knowledgeBoundary.ts` already validates and serves
  `goal`-domain items. Privacy class is `cloud_allowed`.
- **Implementation:** Add to `toolBoundary.ts` + call `buildGroundedContext(profile,
  goalItems)` in the tool port. ~20 lines.
- **Acceptance test:** `buildGroundedContext('nizam', [{domain:'goal',...}])` returns
  the item; `buildGroundedContext('pfos', [{domain:'goal',...}])` excludes it.

---

### T1-B · `signalbus.query_signal_history`
- **Profile:** both
- **Domain:** `operational`
- **What it does:** Returns all signals within a caller-specified ISO time range.
  The current `read_bounded_signals` returns the N most recent; this adds the ability
  to ask "what happened between T1 and T2?"
- **Why it's safe today:** Read-only extension of an existing tool. No new data class.
  The signal bus port (`src/server/ports/signalBus.ts`) already holds the signal records.
- **Implementation:** Add `querySignalHistory(from: string, to: string)` to `SignalBusPort`
  interface. `toolBoundary.ts` gets `signalbus.query_signal_history`. ~30 lines.
- **Acceptance test:** Tamper the time range to a window with no signals → empty result.
  Tamper to a window straddling a known signal → signal appears.

---

### T1-C · `pfos.query_transaction_range`
- **Profile:** pfos (and nizam via request_pfos_analysis)
- **Domain:** `transaction`
- **What it does:** Returns transaction records within a date range, optionally filtered
  by category. Deterministic engine only — the result carries `deterministicEngine: true`
  and milliunits, never floats.
- **Why it's safe today:** Contract 03 §3 and Contract 05 §3.1 already define
  `transaction_history` as a governed knowledge class. Contract 06 governs the DB schema
  for transactions. The tool is a read query — no external effect.
- **Contracts already governing it:** 02 (data arch), 03 (financial intelligence), 05
  (knowledge classes), 06 (database schema).
- **Implementation:** New `queryTransactionRange(from, to, category?)` on `PfosToolPort`.
  Returns `readonly DeterministicFinancialFact[]`. ~40 lines + engine method.
- **Acceptance test:** Amount fields are integer milliunits. Float input rejected.
  Empty range returns `[]`, not an error.

---

### T1-D · `pfos.read_period_summary`
- **Profile:** pfos (and nizam via pfos bridge)
- **Domain:** `financial`
- **What it does:** Returns a single-period summary: total income, total expenses, net
  savings, top 3 spend categories — all in milliunits, all from the deterministic engine.
- **Why it's safe today:** Same governance chain as T1-C. Additive read on top of
  existing transaction data. No new external dependency.
- **Implementation:** New `readPeriodSummary(period: string)` on `PfosToolPort`. Period
  is `YYYY-MM` format. Returns a `PeriodSummaryResult` with milliunits fields. ~50 lines.
- **Acceptance test:** `deterministicEngine: true` required on result. All amount fields
  are `Number.isSafeInteger`. Cross-check: income − expenses === netSavings to the unit.

---

### T1-E · `knowledge.list_knowledge_index`
- **Profile:** both (filtered to profile's allowed domains)
- **Domain:** all (read-only index metadata, no content)
- **What it does:** Returns a count of indexed documents per domain/class for the
  calling profile. Lets the agent know what it actually has indexed before issuing
  a memory load — prevents hollow queries.
- **Why it's safe today:** Purely metadata. Uses the existing `GroundedContext` pipeline.
  Contract 05 §6 (readiness metric) already defines this computation.
- **Implementation:** Surface the readiness score computation (`§6.2`) as a tool call.
  Returns `{domain: string, class: string, count: number}[]` with no content. ~25 lines.
- **Acceptance test:** Count for `journal` domain returns 0 for pfos profile. Count for
  all nizam domains is non-negative. Result contains no `content` field.

---

## Tier 2 — Add with a contract addendum. Architecture is ready; 1–2 page spec needed.

These are safe to implement but require a short governing section in an existing contract
before any code is written. The addendum must be accepted (owner-confirmed) first.

---

### T2-A · `nizamcore.update_goal_state`
- **Profile:** nizam only
- **Domain:** `goal` — write path
- **What it does:** Writes a structured goal progress record to the local knowledge
  store. Different from `append_journal_entry` — it's structured (goal ID, milestone,
  status, updated date), not free text, and queryable by T1-A.
- **Contract work needed:** A §6 addendum to Contract 05: "goal write boundary" — defines
  the schema of a goal update record, the idempotency key (goal ID + date), and the rule
  that a goal update never overwrites prior history (append-only within a goal ID).
- **Risk controls:** Append-only within a goal. No deletion. Local store only.
- **New contract section:** ~1 page in Contract 05 §6.

---

### T2-B · `nizamcore.schedule_deferred_action`
- **Profile:** nizam only
- **Domain:** `operational`
- **What it does:** Registers a future Telegram message to be sent at a specified time.
  The Telegram port already exists (`src/server/ports/telegram.ts`). This adds a
  scheduling queue: "send me X at T".
- **Contract work needed:** New §7 in Contract 05 — "deferred action boundary": the
  maximum look-ahead window (e.g. 7 days), the permitted action types (message only —
  not tool calls), the queue schema, and the cancel/inspect tools that accompany it.
- **Risk controls:** Message-only — no tool calls scheduled. Owner-only delivery.
  Queue size bounded. Cancel tool required alongside.
- **New contract section:** ~1.5 pages in Contract 05 §7.

---

### T2-C · `nizamcore.read_pending_actions`
- **Profile:** nizam only
- **Domain:** `operational`
- **What it does:** Lists all deferred actions scheduled via T2-B, with their scheduled
  time and message preview. The companion read/cancel surface to T2-B.
- **Contract work needed:** Same §7 as T2-B. These two tools are a pair; they must be
  specified together. An agent that can schedule but not inspect or cancel has no safe
  correction path.
- **New contract section:** Included in T2-B's §7.

---

### T2-D · `pfos.compute_budget_variance`
- **Profile:** pfos
- **Domain:** `financial`
- **What it does:** Returns the budget-vs-actual comparison for the current or named
  period: each budgeted category, the actual spend, the variance in milliunits, and
  the variance as a bounded signal direction (`over` / `on_track` / `under`).
- **Contract work needed:** §4 addendum to Contract 03 — "budget model": defines how
  a budget document is structured (periodic allocation per category in milliunits),
  how it's stored (knowledge class `budget_plan`), and the variance computation rule.
  The engine, not the LLM, produces all numbers.
- **New contract section:** ~2 pages in Contract 03 §4. Also adds `budget_plan` to
  the knowledge class registry in Contract 05.

---

### T2-E · `pfos.request_forward_projection`
- **Profile:** pfos
- **Domain:** `financial`
- **What it does:** Asks the deterministic engine for a multi-period (N months) cash
  flow projection: income, expenses, savings trajectory, and a "months to target"
  calculation. All in milliunits, all deterministic.
- **Contract work needed:** Contract 03 already governs "Decision Forecasting" in its
  title but the projection tool interface is not yet specified. Needs §5 in Contract 03:
  "forward projection tool binding" — the projection horizon (max 12 months), the
  data inputs required (transaction history depth, budget plan), and the confidence
  labelling rule (projection older than 30 days of data = `low`).
- **New contract section:** ~1.5 pages in Contract 03 §5.

---

### T2-F · `knowledge.search_knowledge_base`
- **Profile:** both (filtered to profile's allowed domains)
- **Domain:** all allowed
- **What it does:** Semantic search over indexed documents — returns the top N evidence
  items matching a query string, ordered by relevance, within the caller's allowed domains.
  Respects `canSendToCloud` rules: `local_only` items are summarized locally, never
  forwarded to the model provider as retrieved context.
- **Contract work needed:** §8 addendum to Contract 05 — "search boundary": defines
  the embedding strategy (local vector index vs keyword), the maximum result count,
  the privacy filter (same as `buildGroundedContext`), and the prohibition on returning
  raw health or journal content to the model layer.
- **New contract section:** ~1.5 pages in Contract 05 §8.

---

## Tier 3 — Add with a new governing contract. Full contract authoring required first.

These capabilities require a completely new contract before any port or tool code is
written. The contract must be authored, reviewed, and accepted by the owner.

---

### T3-A · Calendar read: `calendar.read_upcoming_events`
- **Profile:** nizam only
- **What it does:** Reads the owner's Google Calendar — upcoming events, deadlines,
  scheduled blocks — and surfaces them as knowledge evidence for the agent.
- **New contract needed:** PFOS Contract 16 — Calendar Integration. Must specify:
  the OAuth scope (`calendar.readonly` only for read), how events are represented
  as knowledge items (class `calendar_event`, domain `life_context`), the event
  horizon limit (max 30 days forward), the privacy boundary (event titles and times
  are `cloud_allowed`; attendee lists are `local_only`), and the G5-dependency
  (OAuth consent is a human gate — the contract must call this out explicitly).
- **Human gate dependency:** G5 (OAuth consent) must be completed by the owner before
  this tool can be activated in production.
- **Contract size:** ~4 pages.

---

### T3-B · Calendar write: `calendar.create_event`
- **Profile:** nizam only
- **What it does:** Creates a calendar event on behalf of the owner — meeting blocks,
  payment reminders, goal check-ins.
- **New contract needed:** Same PFOS Contract 16 as T3-A, with an additional §write
  section covering: owner-confirmation requirement for creates (agent proposes, owner
  approves before write), the prohibition on creating recurring events autonomously,
  and the audit log requirement (every create is logged locally with a timestamp and
  the context that prompted it).
- **Human gate dependency:** G5 same as T3-A. Write capability comes after read is
  stable.

---

### T3-C · GitHub write: `knowledge.propose_github_change`
- **Profile:** both
- **What it does:** Creates a GitHub branch and opens a draft pull request with a
  proposed change. Agent proposes; owner merges. Agent never force-pushes or merges.
- **New contract needed:** Contract 05 §5.1 currently says "read-only" and this is an
  explicit prohibition. A contract revision (Contract 05 v2 or Contract 15) must lift
  the read-only restriction and define: the allowed operations (branch + PR only),
  the prohibition on direct commits to default branch, the max file size, and the
  required PR description format (what the agent was trying to accomplish, what changed,
  confidence level).
- **Risk note:** This is the highest-risk Tier 3 addition. Read stability and owner
  trust in Tier 1/2 tools must be established before this is activated.
- **Contract size:** ~3 pages as a Contract 05 revision §5.

---

### T3-D · Live data: `integrations.fetch_exchange_rate`
- **Profile:** pfos
- **What it does:** Fetches a live exchange rate for the operator-configured
  currency pair from a configured provider. The pair is an environment setting, not a
  tracked value. Read-only. Rate is published as a signal (`signalbus.publish`) with
  the source and timestamp — the agent never uses it as an authoritative fact, only as
  a bounded signal.
- **New contract needed:** PFOS Contract 17 — External Data Integrations. Must specify:
  the allowed providers (allowlist, not open-ended), the rate-as-signal rule (a live rate
  is a `bounded_signal`, never directly used in financial computations — the deterministic
  engine takes the signal as an input, never as a money fact), the staleness rule
  (signal older than 4 hours must be re-fetched before use), and the fail-open behaviour
  (if the provider is unreachable, the engine uses the last confirmed rate with a
  `confidence: low` label).
- **Contract size:** ~3 pages.

---

## Tier 4 — Permanently human-only. Never add to any agent commands list.

These are not limited by contract maturity. They are bounded by the architecture itself.
No contract revision, addendum, or owner instruction can move them to agent-executable.

| Operation | Gate | Reason it can never be automated |
|-----------|------|-----------------------------------|
| Host provisioning and hardening | G1 | Trust root of the entire system. A compromised provisioner compromises every gate downstream. |
| DNS and TLS configuration | G2 | Certificate and routing integrity; a wrong record silently redirects traffic. |
| Bot token minting and allowlist | G3 | A minted token is a live production credential. Agent cannot mint what it runs on. |
| OpenRouter key minting | G4 | Production spend key. An agent that can mint its own key can spend without a cap. |
| OAuth consent completion | G5 | Consent must be given by the owner personally in their own browser session, per provider terms. |
| Webhook registration | G6 | Registers the live inbound endpoint; a wrong registration breaks the entire message path. |
| Backup encryption key | G8 | The private key lives off-host deliberately. An agent that can rotate it can make previous backups unrestorable. |
| `git commit` / `git push` | — | Immutable public record. Requires owner accountability. |
| `git reset` / file deletion | — | Irreversible. No agent should have a destruction path. |
| Credential creation or rotation | — | Key lifecycle is a human decision by definition. |
| Production spend / transfer | — | Financial irreversibility. Agents propose; humans authorize. |
| Database schema migration | — | Schema changes affect all existing data. Requires explicit owner sign-off per Contract 06. |
| Server process restart or kill | — | Live service operation. Agent may signal intent; human executes. |

---

## Tier 5 — Governed capability that is deliberately NOT a tool

A capability can be authorized, contract-backed, tested and live without ever appearing in
`HERMES_TOOL_NAMES`. This tier exists because the first such capability arrived and the four
tiers above had no honest place to put it: it is not forbidden (so not Tier 4), and making it
a tool would have required weakening a guard that already exists (so not Tier 1, 2 or 3).

---

### T5-A · Daily transaction capture — **CONTRACT AUTHORED, NOT A TOOL**
- **Owner requirement:** D7, 2026-09-02 — "ensure the agentic Hermes asks and captures the
  latest daily transactional information".
- **Governing contract:** `contracts/pfos/15_NIZAM_Daily_Transaction_Capture_and_Candidate_Staging.md`
  (NIZAM-derived, authored 2026-09-02, IN FORCE for the capture surface only).
- **What it does:** Asks the owner once per owner-local day, in the existing conversational
  window, what moved. Stores the reply verbatim in `source_events`. Parses it with a fixed
  deterministic grammar into rows of the **engine-excluded** `transactionCandidates` collection.
  The owner promotes; nothing else can.
- **Why it is not a tool.** `src/server/hermes/runtimeAdapter.ts` refuses any bounded tool payload
  key matching `amount|balance|currency|milliunit|money|price|cost|financial`. A monetary field is
  therefore already unrepresentable across the Hermes tool boundary. Adding a capture tool would
  have meant weakening that guard, so the capability was built as **deterministic ingestion** on the
  path Contract 14 §5 already defines (deterministic-first routing; an LLM may explain a routed
  result but may not choose a monetary figure). `HERMES_TOOL_NAMES` is unchanged.
- **Why it was not already covered.** It was absent from all four tiers above. Tier 4 forbids
  "production spend / transfer" and "database schema migration"; recording that a movement happened
  is neither. That absence is what required a new contract rather than an addendum.
- **Money boundary:** the owner states the amount; `fromDecimalStrict` converts it or refuses.
  No default currency, no inferred direction, no capture-time FX, no rounding, no auto-promotion.
- **Acceptance test:** Contract 15 §9.1 — twelve offline checks including a tamper control: adding
  a default currency, a keyword-inferred sign, an auto-promotion, or a lenient amount parse must
  each make a test fail.
- **Effect on the tool count table below: none.** This capability adds zero tools.

---

## Priority roadmap — suggested implementation order

The ordering is: highest owner value × lowest risk × fewest prerequisites.

```
Phase A — Wire now (zero contract work)
  Week 1 · T1-E  knowledge.list_knowledge_index
  Week 1 · T1-A  nizamcore.read_goal_state
  Week 2 · T1-B  signalbus.query_signal_history
  Week 2 · T1-C  pfos.query_transaction_range
  Week 3 · T1-D  pfos.read_period_summary

Phase B — Contract addenda (1-2 pages each, then implement)
  Sprint 1 · Contract 05 §6 → T2-A nizamcore.update_goal_state
  Sprint 1 · Contract 05 §7 → T2-B/C schedule + read pending actions  [pair]
  Sprint 2 · Contract 03 §4 → T2-D pfos.compute_budget_variance
  Sprint 2 · Contract 03 §5 → T2-E pfos.request_forward_projection
  Sprint 3 · Contract 05 §8 → T2-F knowledge.search_knowledge_base

Phase C — New contracts (full authoring + owner acceptance required)
  Step 1 · Author Contract 16 (Calendar)
  Step 2 · Complete human gate G5 (OAuth consent)
  Step 3 · T3-A calendar.read_upcoming_events
  Step 4 · T3-B calendar.create_event  (after T3-A is stable)
  Step 5 · Author Contract 17 (External Data)
  Step 6 · T3-D integrations.fetch_exchange_rate
  Step 7 · Author Contract 05 v2 (GitHub write amendment)
  Step 8 · T3-C knowledge.propose_github_change  [last — highest risk]

Tier 4 items: never scheduled. Not a backlog item. Not a future sprint. Never.
```

---

## Implementation guide — how to wire a new tool

Every tool addition follows this exact sequence. No shortcuts.

1. **Contract first.** If the tool is Tier 1, cite the existing contract section.
   If Tier 2, the addendum must be accepted before touching code.
   If Tier 3, the full contract must be accepted.

2. **Port interface.** Add the method signature to the relevant port interface in
   `src/server/ports/`. The method returns a typed result; no `any`, no floats for money.

3. **Tool boundary.** Add the tool name string to `HERMES_TOOL_NAMES` and to the
   correct profile array in `HERMES_TOOLS_BY_PROFILE`. A tool in the wrong profile
   array is a contract violation.

4. **Declare the owning contract in the file header.** Every changed file under `src/`
   must declare its owning contract and phase in the first 20 lines.

5. **Mock first.** Write a deterministic mock for the new port method before writing
   the live adapter. The mock uses synthetic data with redacted identifiers.

6. **Tests.** The tool boundary must have a test that (a) confirms the tool is allowed
   for the right profile and (b) confirms it is refused for the wrong profile.
   Financial tools must have a test asserting all returned amounts are integer milliunits.

7. **Verify.** `npm run verify:all -- --all` must pass before claiming the addition done.

---

## Resulting tool count by phase

| Phase | New tools added | Running total |
|-------|----------------|---------------|
| Baseline (today) | — | 10 |
| Phase A complete | +5 | 15 |
| Phase B complete | +6 | 21 |
| Phase C complete | +4 | 25 |
| Tier 5 (T5-A daily capture) | **+0** | 25 |

25 governed, tested, and contract-backed tools = full-autonomy operation within
NIZAM's architecture. Every tool above the baseline has a contract, a mock, a test,
and a profile restriction. None of the 25 crosses a Tier 4 boundary.

