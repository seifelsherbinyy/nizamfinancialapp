# Phase 2 — PFOS Turn Classification and Automatic Model Routing Contract

## Mission

Route every user turn or system event to the least expensive model that can safely complete it. The router must classify the task before invoking a reasoning model and must escalate based on financial impact, ambiguity, confidence, tool requirements, and observed model performance.

## Architectural rule

The router does not calculate money. It receives deterministic outputs from the ledger, policy, risk, and forecasting services. Models parse, interpret, challenge, retrieve evidence, call approved tools, and communicate.

## Task taxonomy

### T0 — Deterministic/no-LLM

Examples:

- Recalculate balances.
- Compute safe-to-spend.
- Detect exact duplicates.
- Apply known payment schedules.
- Generate fixed-format reminders.
- Validate schema.

Route: code only.

### T1 — Low-risk extraction

Examples:

- Parse a bank SMS.
- Extract merchant, amount, currency, account, and timestamp.
- Normalize merchant.
- Suggest a category.
- Summarize a confirmed transaction.

Primary: `xiaomi/mimo-v2.5`  
Fallback: `z-ai/glm-5.2`

### T2 — Routine financial conversation

Examples:

- Explain safe-to-spend.
- Daily or weekly briefing.
- Identify leakage.
- Compare ordinary budget options.
- Ask for a correction.

Primary: `z-ai/glm-5.2`  
Fallbacks: `x-ai/grok-4.5`, then `moonshotai/kimi-k3`

### T3 — High-impact financial decision

Triggers include:

- New debt.
- Purchase exceeds configured threshold.
- P0/P1 obligations may be affected.
- Asset sale.
- Job offer or major income change.
- Long-term capital allocation.
- Low confidence or conflicting evidence.

Primary analysis: `z-ai/glm-5.2`  
Independent reviewer: `x-ai/grok-4.5`  
Tie-break/deep investigation: `moonshotai/kimi-k3`

### T4 — Repository engineering

Examples:

- Large repository analysis.
- Architecture changes.
- Complex debugging.
- Contract-to-code implementation.
- Test repair.

Primary: `moonshotai/kimi-k3`  
Fallback: `z-ai/glm-5.2`

## Turn classifier features

- User intent.
- Requested action.
- Financial amount and currency.
- Percentage of liquid net worth.
- Percentage of safe-to-spend.
- Whether a critical obligation is touched.
- Reversibility.
- Time horizon.
- Data freshness.
- Missing facts.
- Tool requirements.
- Expected output schema.
- Conversation length.
- Language.
- Security sensitivity.
- Prior failures for similar tasks.
- Current model cost, latency, uptime, and benchmark eligibility.

## Routing score

For every eligible model:

```text
Utility =
QualityFit × 0.35
+ SafetyFit × 0.30
+ ToolReliability × 0.12
+ LatencyFit × 0.08
+ ContextFit × 0.05
+ HistoricalPersonalAccuracy × 0.10
- NormalizedExpectedCost × CostSensitivity
```

Hard eligibility filters execute before scoring.

## Escalation rules

Escalate when:

- Model confidence is below task threshold.
- Structured output fails twice.
- Tool call is malformed.
- Evidence conflicts.
- Data freshness is insufficient.
- The decision threatens P0/P1 obligations.
- Estimated downside exceeds threshold.
- A user justification materially changes expected value.
- Model historically underperforms on the task cluster.
- Provider returns 408, 429, 502, or 503 after bounded retry.

Never escalate only to produce a more persuasive answer when the deterministic policy already blocks the action.

## OpenRouter request controls

Use:

- `models` for ordered model fallbacks.
- `provider.sort: "price"` for low-risk tasks.
- `provider.sort: "latency"` for interactive short turns where speed matters.
- `provider.require_parameters: true` for tools or structured outputs.
- `provider.data_collection: "deny"` and/or `zdr: true` for sensitive financial and health data where supported.
- `:exacto` or quality-first routing only for tool-critical flows after benchmark validation.
- Explicit maximum price and token budgets at the application layer.

## Machine-readable routing policy

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "contract_id": "pfos.openrouter.phase2.runtime-router.v1",
  "phase": 2,
  "default_privacy": {
    "data_collection": "deny",
    "prefer_zdr": true,
    "log_prompt_content": false,
    "log_redacted_features": true
  },
  "routes": [
    {
      "task_class": "T0_DETERMINISTIC",
      "models": [],
      "execution": "code_only"
    },
    {
      "task_class": "T1_EXTRACTION",
      "models": ["xiaomi/mimo-v2.5", "z-ai/glm-5.2"],
      "provider_sort": "price",
      "max_attempts": 2,
      "required_parameters": ["response_format"],
      "confidence_threshold": 0.90,
      "max_cost_usd_per_turn": 0.02
    },
    {
      "task_class": "T2_ROUTINE_ADVICE",
      "models": ["z-ai/glm-5.2", "x-ai/grok-4.5", "moonshotai/kimi-k3"],
      "provider_sort": "latency",
      "max_attempts": 2,
      "confidence_threshold": 0.82,
      "max_cost_usd_per_turn": 0.20
    },
    {
      "task_class": "T3_HIGH_IMPACT",
      "analysis_model": "z-ai/glm-5.2",
      "review_model": "x-ai/grok-4.5",
      "tie_break_model": "moonshotai/kimi-k3",
      "require_independent_review": true,
      "confidence_threshold": 0.90,
      "max_cost_usd_per_turn": 2.00,
      "human_approval_required": true
    },
    {
      "task_class": "T4_ENGINEERING",
      "models": ["moonshotai/kimi-k3", "z-ai/glm-5.2"],
      "provider_sort": "throughput",
      "confidence_threshold": 0.80,
      "max_cost_usd_per_session": 10.00
    }
  ],
  "classifier": {
    "implementation": "rules_first_then_lightweight_model_if_ambiguous",
    "features": [
      "intent",
      "amount",
      "safe_to_spend_ratio",
      "liquid_net_worth_ratio",
      "critical_obligation_impact",
      "reversibility",
      "data_freshness",
      "missing_information",
      "tool_requirement",
      "security_sensitivity"
    ],
    "high_impact_rules": [
      "new_debt == true",
      "critical_obligation_impact == true",
      "amount_over_user_threshold == true",
      "decision_horizon_days >= 365",
      "forecast_shortfall_probability >= 0.10"
    ]
  },
  "response_audit": {
    "record": [
      "turn_id",
      "task_class",
      "selected_model",
      "actual_model",
      "provider",
      "fallback_count",
      "prompt_tokens",
      "cached_tokens",
      "cache_write_tokens",
      "completion_tokens",
      "reasoning_tokens",
      "actual_cost",
      "latency_ms",
      "schema_valid",
      "confidence",
      "policy_version"
    ]
  }
}
```

## Reference pseudocode

```python
def route_turn(turn, financial_snapshot, registry, pricing):
    task = classify_rules_first(turn, financial_snapshot)

    if task == "T0_DETERMINISTIC":
        return deterministic_service.execute(turn)

    eligible = registry.eligible_models(task)
    eligible = enforce_privacy_tools_context_and_budget(eligible, turn, pricing)

    selected = score_models(eligible, task, financial_snapshot)

    result = call_openrouter(
        models=selected.fallback_chain,
        provider=selected.provider_policy,
        response_schema=task.schema,
    )

    if requires_escalation(result, task, financial_snapshot):
        result = escalate_and_review(result, task)

    audit(result, task)
    return result
```

## Exit criteria

- Task classification precision ≥95% on benchmark set.
- No T3 decision can bypass independent review.
- T0 calculations never invoke a model.
- Actual model and cost are captured for every turn.
- Fallbacks are tested under simulated outages.
- Privacy routing is verified.
