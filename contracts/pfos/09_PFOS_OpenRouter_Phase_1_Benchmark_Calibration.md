# Phase 1 — PFOS OpenRouter Benchmark Calibration Contract

## Mission

Create a reproducible benchmark that converts the user’s observed AKI workload into a PFOS-specific model-selection baseline. This phase must run before runtime routing is enabled.

The supplied AKI benchmark represents approximately **56 active hours per week**. PFOS planning scenarios are:

- Expected: **7 hours/week** = 12.5% of the reference intensity.
- Upper planning case: **14 hours/week** = 25% of the reference intensity.

The reference 30-day workload contains 15,672,203 fresh-input tokens, 202,682,335 cache-write tokens, 2,950,573,825 cache-read tokens, and 27,331,793 output tokens. Cache reads represent 93.1% of input volume, so cached-input pricing is the largest cost driver.

## Source precedence

1. Live OpenRouter `/api/v1/models` and model endpoint metadata.
2. Actual `usage.cost` and token details returned by OpenRouter.
3. The uploaded OpenRouter comparison PDF as a frozen benchmark snapshot.
4. The uploaded AKI workbook/dashboard as the usage-intensity reference.
5. Conservative assumptions when a provider omits cache-write pricing.

Prices must never remain hard-coded beyond their refresh TTL.

## Frozen comparison snapshot

| Model | Intelligence | Coding | Agentic | Input/M | Output/M | Cache read/M |
|---|---:|---:|---:|---:|---:|---:|
| Kimi K3 | 57 | 76 | 50 | $2.90 | $14.00 | $0.29 |
| Grok 4.5 | 54 | 72 | 46 | $2.00 | $6.00 | $0.30 |
| GLM 5.2 | 51 | 69 | 43 | $0.28 | $0.88 | $0.052 |
| MiMo-V2.5 | 37 | 57 | 24 | $0.112 | $0.224 | $0.0024 |

## Proportional PFOS ceiling model

The following estimates preserve AKI’s unusually cache-heavy token mix. They should be treated as **upper-bound reference costs**, because a production PFOS should retrieve compact financial state rather than resend repository-scale context.

| Model | 7h/week monthly | 14h/week monthly | 7h/week annual | 14h/week annual |
|---|---:|---:|---:|---:|
| Kimi K3 | $233.94 | $467.88 | $2807.31 | $5614.62 |
| Grok 4.5 | $185.73 | $371.47 | $2228.81 | $4457.62 |
| GLM 5.2 | $29.83 | $59.66 | $357.93 | $715.86 |
| MiMo-V2.5 | $4.71 | $9.41 | $56.49 | $112.98 |

## Benchmark dataset required

Build a sanitized PFOS evaluation set with at least:

- 50 bank-SMS extraction cases.
- 30 merchant/category classification cases.
- 25 duplicate/reconciliation cases.
- 25 safe-to-spend explanation cases.
- 25 purchase-decision cases.
- 20 forecast/scenario cases.
- 15 tool-call workflows.
- 10 Arabic or mixed Arabic/English cases.
- 10 adversarial or prompt-injection cases.

Every case must define expected structured output, hard safety constraints, allowable variation, and severity.

## Scoring

Use task-specific metrics:

- Extraction: exact field accuracy and amount/date/account critical-field accuracy.
- Classification: macro F1 and confidence calibration.
- Structured output: schema-valid rate.
- Tool use: valid call rate, argument accuracy, successful completion rate.
- Financial safety: hard-rule violation count; any P0 violation is an automatic failure.
- Forecasting: MAE/MAPE where meaningful and interval coverage.
- Explanation: evidence coverage, unsupported-claim rate, concision.
- Cost: actual OpenRouter `usage.cost`, not estimated tokens alone.
- Latency: p50, p90, p99.
- Reliability: timeout/error/fallback rates.

## Qualification gates

A model may be eligible for:

- **Tier L0 extraction** only if critical-field accuracy ≥99.0%.
- **Tier L1 routine advice** only if schema validity ≥99%, hard-rule violations = 0, and evidence coverage ≥90%.
- **Tier L2 high-impact decisions** only if hard-rule violations = 0, calibrated confidence passes, and reviewer disagreement is below threshold.
- **Developer/build tasks** based on code benchmark and repository tests, separate from live finance eligibility.

## Machine-readable execution contract

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "contract_id": "pfos.openrouter.phase1.benchmark-calibration.v1",
  "phase": 1,
  "inputs": {
    "aki_reference": {
      "hours_per_week": 56,
      "thirty_day_tokens": {
        "fresh_input": 15672203,
        "cache_write": 202682335,
        "cache_read": 2950573825,
        "output": 27331793
      },
      "cache_hit_ratio": 0.931
    },
    "pfos_scenarios_hours_per_week": [7, 14],
    "model_candidates": [
      "xiaomi/mimo-v2.5",
      "z-ai/glm-5.2",
      "x-ai/grok-4.5",
      "moonshotai/kimi-k3"
    ]
  },
  "pricing_refresh": {
    "endpoint": "https://openrouter.ai/api/v1/models",
    "authenticated_endpoint": "https://openrouter.ai/api/v1/models/user",
    "endpoint_details_template": "https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints",
    "ttl_hours": 24,
    "required_fields": [
      "id",
      "context_length",
      "pricing.prompt",
      "pricing.completion",
      "pricing.input_cache_read",
      "pricing.input_cache_write",
      "supported_parameters",
      "benchmarks"
    ],
    "fallback_rule": "use_last_verified_snapshot_and_mark_pricing_stale"
  },
  "cost_formula": {
    "expression": "(fresh_input*prompt_price)+(cache_write*cache_write_price)+(cache_read*cache_read_price)+(output*completion_price)+(reasoning*reasoning_price)+request_fees",
    "missing_cache_write_price": "use_prompt_price_conservatively",
    "currency": "USD"
  },
  "benchmark_minimum_cases": 210,
  "automatic_failure_conditions": [
    "any_P0_financial_rule_violation",
    "fabricated_balance_or_due_date",
    "unauthorized_tool_action",
    "schema_validity_below_0.99_for_machine_tasks"
  ],
  "outputs": [
    "benchmark_results.json",
    "model_eligibility_registry.json",
    "pricing_snapshot.json",
    "cost_projection.json",
    "benchmark_report.md"
  ]
}
```

## Exit criteria

- Pricing snapshot refreshed and timestamped.
- Each model tested on the same benchmark cases.
- Actual cost and latency captured.
- Eligibility registry approved.
- No model promoted from benchmark reputation alone.
