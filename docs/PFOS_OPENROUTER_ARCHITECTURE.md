# PFOS OpenRouter LLM Tier - Architecture Synthesis

**Date:** 2026-08-06 · **Sources (ingested byte-faithful, see `contracts/pfos/_INGESTION_MANIFEST_OPENROUTER.json`):**
`contracts/pfos/09_PFOS_OpenRouter_Phase_1_Benchmark_Calibration.md`,
`.../10_..._Phase_2_Automatic_Task_and_Turn_Routing.md`,
`.../11_..._Phase_3_Adaptive_Cost_Quality_Governance.md`.

These three phase contracts are the **authoritative LLM-tier specification** and substantially fill
the previously-ABSENT contract 05 (agent orchestration/tooling) and contract 07 (benchmark bar).
This doc synthesizes them into: the **model roster**, the **routing stack**, the **three-phase
lifecycle**, the **cost/safety envelope**, and the **module map onto the NIZAM build**.

---

## 1. The one architectural rule (everything else serves it)

> **The router does not calculate money.** Deterministic services (ledger, policy, risk, forecast)
> produce every number. Models only **parse, interpret, challenge, retrieve evidence, call approved
> tools, and communicate.** (Phase 2, "Architectural rule".)

**This is already true in NIZAM today.** The shipped Stage 1-4 engines - safe-to-spend, obligation
protection, the decision engine, forecasting, net worth - ARE the deterministic services. They run
server-free on the Drive DB and emit structured, evidence-carrying outputs (the Decision Card, the
forecast, the registry). **The LLM tier sits strictly on top of them and never touches the math.**
So this whole tier is additive: it explains, classifies, extracts, and challenges - it never becomes
the source of a balance, a due date, or a safe-to-spend figure.

---

## 2. Model roster (which models, and their job)

Frozen Phase-1 benchmark snapshot (prices per 1M tokens; refreshed live at runtime, 24h TTL):

| Model | OpenRouter slug | Intelligence | Coding | Agentic | Input/M | Output/M | Cache-read/M | Primary role in PFOS |
|---|---|---:|---:|---:|---:|---:|---:|---|
| **MiMo-V2.5** | `xiaomi/mimo-v2.5` | 37 | 57 | 24 | $0.112 | $0.224 | $0.0024 | **T1 extraction primary** - cheapest, high-volume SMS/receipt parsing |
| **GLM 5.2** | `z-ai/glm-5.2` | 51 | 69 | 43 | $0.28 | $0.88 | $0.052 | **The workhorse** - T2/T3 primary analysis, T1 fallback, T4 fallback |
| **Grok 4.5** | `x-ai/grok-4.5` | 54 | 72 | 46 | $2.00 | $6.00 | $0.30 | **T3 independent reviewer**, T2 fallback |
| **Kimi K3** | `moonshotai/kimi-k3` | 57 | 76 | 50 | $2.90 | $14.00 | $0.29 | **T4 engineering primary**, T3 tie-break / deep investigation |

Design logic: cost climbs ~26x from MiMo to Kimi, so the cheapest capable model does the high-volume
low-risk work (extraction), a mid-priced strong generalist (GLM) carries routine advice and first-pass
high-impact analysis, and the two premium models are spent **only** where a wrong answer is expensive -
independent review of money-moving decisions (Grok) and hard reasoning / repo engineering (Kimi).

---

## 3. Task taxonomy -> model routing (the core of the stack)

| Tier | What it is | Model chain | Provider sort | Confidence gate | Cost cap | Special |
|---|---|---|---|---:|---:|---|
| **T0** Deterministic | balances, safe-to-spend, exact-dup detect, payment schedules, fixed reminders, schema validation | **none - code only** | - | - | $0 | never invokes a model |
| **T1** Extraction | parse bank SMS; extract merchant/amount/currency/account/timestamp; normalize; suggest category | `mimo-v2.5` -> `glm-5.2` | **price** | 0.90 | $0.02/turn | `response_format` required |
| **T2** Routine advice | explain safe-to-spend; daily/weekly brief; leakage; compare budget options | `glm-5.2` -> `grok-4.5` -> `kimi-k3` | **latency** | 0.82 | $0.20/turn | - |
| **T3** High-impact decision | new debt; purchase over threshold; P0/P1 touched; asset sale; income change; long-horizon capital | analysis `glm-5.2` + review `grok-4.5` + tie-break `kimi-k3` | quality | 0.90 | $2.00/turn | **independent review + human approval REQUIRED** |
| **T4** Engineering | large-repo analysis; architecture; complex debugging; contract-to-code; test repair | `kimi-k3` -> `glm-5.2` | **throughput** | 0.80 | $10.00/session | separate from live-finance eligibility |

**T3 triggers** (any one → high-impact): new debt · amount over the user threshold · a critical
(P0/P1) obligation is touched · asset sale · job/income change · horizon ≥ 365 days ·
forecast shortfall probability ≥ 10% · low confidence or conflicting evidence.

---

## 4. The turn-processing stack (end to end)

```
turn / event
   │
   ▼
[1] Deterministic snapshot  ← ledger · policy · risk · forecast  (all money already computed)
   │
   ▼
[2] Classifier (rules-first; lightweight model only if ambiguous)  → T0..T4
   │        features: intent · amount · %safe-to-spend · %liquid-net-worth · critical-obligation
   │        impact · reversibility · horizon · freshness · missing facts · tool needs · schema ·
   │        language · security sensitivity · prior failures · live model cost/latency/uptime
   │
   ├── T0 ──► deterministic_service.execute()   (return; no model)
   │
   ▼
[3] Hard eligibility filters (BEFORE scoring): benchmark tier (L0/L1/L2) · privacy · tool support ·
   │        context length · budget headroom
   ▼
[4] Utility score per eligible model:
   │     U = 0.35·QualityFit + 0.30·SafetyFit + 0.12·ToolReliability + 0.08·LatencyFit
   │         + 0.05·ContextFit + 0.10·HistoricalPersonalAccuracy − CostSensitivity·NormalizedExpectedCost
   ▼
[5] OpenRouter call: models=fallback_chain · provider policy (sort / require_parameters /
   │     data_collection:deny / zdr) · response_format=task.schema · max price + token budget
   ▼
[6] Escalation / review?  (see triggers)  → escalate_and_review()   (T3 = dual model + human)
   ▼
[7] Audit the turn  → telemetry store (actual model, actual cost, tokens, latency, schema_valid, …)
```

**Escalate when:** confidence below task threshold · structured output fails twice · malformed tool
call · conflicting evidence · insufficient freshness · P0/P1 threatened · downside over threshold ·
a user justification materially changes expected value · model historically underperforms on the
cluster · provider returns 408/429/502/503 after bounded retry.
**Never** escalate merely to produce a more persuasive answer when deterministic policy already
blocks the action.

---

## 5. Three-phase lifecycle

### Phase 1 - Benchmark Calibration (runs BEFORE any routing is enabled)
- Build a sanitized PFOS eval set, **≥ 210 cases** (50 SMS-extraction · 30 classification · 25 dedup ·
  25 safe-to-spend explanation · 25 purchase-decision · 20 forecast · 15 tool-call · 10 Arabic/mixed ·
  10 adversarial/prompt-injection). Every case defines expected output, hard safety constraints,
  allowable variation, and severity.
- Refresh pricing live (`/api/v1/models`, `/models/user`, `/{author}/{slug}/endpoints`), 24h TTL,
  fall back to the last verified snapshot marked stale.
- Score per task metric; cost = **actual OpenRouter `usage.cost`**, never estimated tokens alone.
- **Eligibility gates:** L0 extraction only if critical-field accuracy ≥ 99.0%; L1 routine advice only
  if schema validity ≥ 99%, hard-rule violations = 0, evidence coverage ≥ 90%; L2 high-impact only if
  hard-rule violations = 0, calibrated confidence passes, reviewer disagreement below threshold.
- **No model is promoted on benchmark reputation alone.** Outputs: `benchmark_results.json`,
  `model_eligibility_registry.json`, `pricing_snapshot.json`, `cost_projection.json`, `benchmark_report.md`.

### Phase 2 - Runtime Routing (this doc's stack, sections 3-4)
Exit bar: task-classification precision ≥ 95% · no T3 bypasses independent review · T0 never invokes
a model · actual model + cost captured per turn · fallbacks tested under simulated outage · privacy
routing verified.

### Phase 3 - Adaptive Cost/Quality Governance (closed loop, never weakens safety)
- Telemetry source of truth = OpenRouter response usage (prompt/completion/reasoning/cached/cache-write
  tokens + charged cost). Raw retained **90 days**, aggregates **indefinitely**, **no prompt text stored**.
- Windows: real-time (budget+error guards) · daily (anomalies) · weekly (quality+routing review) ·
  monthly (benchmark replay + model refresh + budget reset) · quarterly (strategic pool review).
- **Promotion** (cheaper model replaces primary) only if, over the sample: 0 safety violations · quality
  within non-inferiority margin · schema/tool reliability met · calibrated confidence · material cost cut ·
  acceptable latency. **Demotion/quarantine** on any P0 · critical-field error over threshold · rising
  tool-call errors · provider reliability drop · pricing change beyond threshold · accuracy drift · rising
  unsupported claims.
- **Canary:** 5% → 15% → 30% → 50% → 100%, ≥100 cases/stage, instant rollback; high-impact decisions
  never use an unvalidated candidate as sole decision-maker.
- **Weekly optimizer authority ladder:** *auto-allowed* = model order, provider sort, task cost caps,
  canary allocation. *Proposal-only* = confidence thresholds, high-impact classification rules, privacy
  policy. *Human-approval-required* = P0/P1 policy, autonomous financial action, new sensitive-data use.

---

## 6. Cost & safety envelope

**Cost driver:** in the AKI reference workload, cache reads are **93.1%** of input volume - so
**cached-input pricing dominates**. Production PFOS must retrieve **compact financial state**, not
resend repository-scale context, so real spend should land well under the proportional ceilings below.

Proportional monthly ceiling (upper bound; PFOS = 7-14h/week vs the 56h/week reference):

| Model | 7h/week | 14h/week |
|---|---:|---:|
| MiMo-V2.5 | ~$4.71 | ~$9.41 |
| GLM 5.2 | ~$29.83 | ~$59.66 |
| Grok 4.5 | ~$185.73 | ~$371.47 |
| Kimi K3 | ~$233.94 | ~$467.88 |

**Budget guardrail (Phase 3):** target **$20-40/month**. 70% → warning · 85% → restrictive routing ·
95% → premium models disabled for non-critical work · critical work stays available **only** with
explicit user approval. **A hard budget stop must NEVER block deterministic obligation alerts.**
The economics work because the workhorse is GLM + MiMo (a few dollars to low-tens per month); Grok/Kimi
are reserved for T3 review and T4 engineering, i.e. rare, high-value turns.

**Non-negotiable safety invariants (all three phases):**
1. Deterministic services compute money; models never do.
2. Any **P0** financial-rule violation = automatic failure (benchmark) / immediate demotion+quarantine (runtime).
3. Fabricated balance/due-date, unauthorized tool action, or schema validity < 0.99 on machine tasks = auto-fail.
4. **T3 always** = independent second-model review **+** human approval; no unvalidated candidate decides alone.
5. **No autonomous weakening** of hard safeguards; P0/P1 policy, autonomous financial action, and new
   sensitive-data use require human approval.
6. Privacy: `data_collection: deny`, prefer `zdr`, never log prompt content (log redacted features only).
7. Optimization objective: **Minimize cost subject to** P0 violations = 0, critical-field accuracy ≥
   threshold, schema validity ≥ threshold, tool success ≥ threshold, forecast calibration ≥ threshold,
   latency ≤ task SLA. *Cost savings are subordinate to safety and data integrity.*

---

## 7. Module map onto the NIZAM build

What the LLM tier adds, what it reuses, and where each piece sits relative to the current server-free build.

| # | Component | Purpose | Reuses / new | Stage · gate |
|---|---|---|---|---|
| M0 | **Deterministic engines** | the numbers the router depends on | **already built** (Stages 1-4, server-free) | done |
| M1 | Pricing snapshot service | live `/models` + endpoint pricing, 24h TTL, stale-fallback | new | 7 · needs K4 |
| M2 | Benchmark harness + eval set (≥210) | Phase-1 calibration → eligibility registry | new; **buildable as an offline dev tool** (calls OpenRouter, so needs K4) | 7 (Phase 1) · needs K4 |
| M3 | Model registry | tier eligibility (L0/L1/L2), per task, versioned, quarantine | new; **schema can be defined now** | 7 · schema now |
| M4 | Turn classifier | rules-first + lightweight-model fallback; consumes the deterministic snapshot | new | 7 · server |
| M5 | Router + scorer | utility formula, hard filters, fallback-chain builder | new | 7 · server |
| M6 | OpenRouter client | `models` fallback, provider policy, `response_format`, privacy flags, max price/token, bounded retry | new; **holds the key** | 7 · server + K4 |
| M7 | Escalation/review orchestrator | T3 dual-model + human-approval gate | new; reuses the Decision Card + registry | 7 · server |
| M8 | Telemetry/audit store | per-turn record; source of truth = OpenRouter usage; 90d raw / aggregates forever / no prompt text | new | 7 · server |
| M9 | Governance/optimizer | daily/weekly/monthly jobs, canary controller, budget guard, rollback log | new | 7 · server |

**Sequencing insight:** M0 is done. **M2 (the benchmark harness) is the natural first build** - it is a
self-contained dev tool that produces the eligibility registry, and *nothing else in the tier may go live
until it passes* (Phase 1 gates Phase 2). M3's schema can be drafted now. M4-M9 are the always-on server
tier and are gated on the **D1/D2 architecture decision** plus the OpenRouter key (**K4**) and a budget cap.

---

## 8. What this changes in the roadmap (reconciliation)

- **Contract-05/07 gap substantially closed.** The LLM-tier surface that `PFOS_HUMAN_DELIVERABLES.md`
  flagged as blocked-by-missing-contract is now specified by these three phase contracts. **Decision D6**
  ("write contract 05 or approve an interim policy") can be **closed by adopting these three as the
  authoritative LLM-tier contract** (or by folding them into a formal contract 05). Recommendation: adopt
  as-is and reference them from `_PFOS_CONTRACT_INDEX.md` (done in this ingest).
- **Readiness K4 (OpenRouter) now has a full spec**, not just "get a key": named model roster, a hard
  monthly budget with thresholds, privacy flags, and a **launch gate** = *Phase-1 benchmark passed +
  eligibility registry approved before any runtime routing.* (Reflected in `PFOS_BUILD_READINESS.*`.)
- **Still gated:** everything M4-M9 is the always-on server tier (D1 = B/C, D2 = yes) and needs K4 + a
  spend cap. The benchmark harness (M2) is the one piece that can be built ahead of that decision.
- **Unchanged safety posture:** money math stays deterministic and server-free; the LLM tier is purely
  additive and cannot weaken a hard safeguard without human approval.
