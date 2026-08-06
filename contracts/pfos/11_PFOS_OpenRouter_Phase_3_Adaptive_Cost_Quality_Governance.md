# Phase 3 — PFOS Adaptive Cost, Quality, and Model-Governance Contract

## Mission

Continuously optimize model selection from real PFOS outcomes without allowing autonomous weakening of financial safety policies. This phase measures actual cost, accuracy, latency, reliability, and decision outcomes, then proposes controlled routing changes.

## Closed-loop data

For every model turn, store:

- Task class and subtask.
- Model requested and model actually used.
- Provider.
- Token components.
- Actual charged cost.
- Latency and error status.
- Cache ratio.
- Tool-call validity.
- Structured-output validity.
- User correction.
- Reviewer disagreement.
- Recommendation confidence.
- Later observed decision outcome.
- Policy and prompt versions.

OpenRouter responses provide prompt, completion, reasoning, cached, cache-write, and charged-cost fields. Prefer those actual values over local estimates.

## Evaluation windows

- Real-time: budget and error guards.
- Daily: cost anomalies and failed routes.
- Weekly: task-level quality and routing review.
- Monthly: benchmark replay, model refresh, and budget reset.
- Quarterly: strategic model-pool review.

## Adaptive rules

### Promotion

A cheaper model may replace a primary model for a task only when, over the configured sample:

- No safety violation.
- Quality is within the non-inferiority margin.
- Schema/tool reliability meets threshold.
- Confidence is calibrated.
- Cost reduction is material.
- Latency is acceptable.

### Demotion

Demote or quarantine when:

- Any P0 violation occurs.
- Critical-field extraction error exceeds threshold.
- Tool-call error rate rises.
- Provider reliability deteriorates.
- Model pricing changes beyond threshold.
- Forecast or decision accuracy drifts.
- Unsupported claims increase.

### Canary policy

- Route 5% of eligible low-risk traffic to candidate.
- Increase to 15%, 30%, 50%, then 100% only after gates pass.
- High-impact decisions never use unvalidated candidates as sole decision-maker.
- Maintain instant rollback.

## Budget controls

Recommended initial monthly model budget:

- Target: $20–$40.
- Warning: 70% consumed.
- Restrictive routing: 85% consumed.
- Premium models disabled for noncritical work at 95%.
- Critical work remains available with explicit user approval.
- Hard stop must never prevent deterministic obligation alerts.

Cost forecast should use:

- Current month actual spend.
- Seven-day run rate.
- Task mix.
- Model/provider prices refreshed daily.
- Expected cache rates.
- Planned premium decisions.

## Optimization objective

```text
Minimize Cost
subject to:
  P0SafetyViolations = 0
  CriticalFieldAccuracy >= threshold
  SchemaValidity >= threshold
  ToolSuccess >= threshold
  ForecastCalibration >= threshold
  Latency <= task SLA
```

Cost savings are subordinate to financial safety and data integrity.

## Machine-readable governance contract

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "contract_id": "pfos.openrouter.phase3.adaptive-governance.v1",
  "phase": 3,
  "telemetry": {
    "source_of_truth": "openrouter_response_usage",
    "required_usage_fields": [
      "prompt_tokens",
      "completion_tokens",
      "completion_tokens_details.reasoning_tokens",
      "prompt_tokens_details.cached_tokens",
      "prompt_tokens_details.cache_write_tokens",
      "cost"
    ],
    "retention_days_raw": 90,
    "retain_aggregates_indefinitely": true,
    "store_sensitive_prompt_text": false
  },
  "budget": {
    "monthly_target_usd": 30,
    "monthly_soft_range_usd": [20, 40],
    "warning_fraction": 0.70,
    "restrict_fraction": 0.85,
    "premium_noncritical_disable_fraction": 0.95,
    "critical_override_requires_user": true
  },
  "service_levels": {
    "T1_EXTRACTION": {
      "critical_field_accuracy_min": 0.99,
      "schema_validity_min": 0.995,
      "p90_latency_ms_max": 8000
    },
    "T2_ROUTINE_ADVICE": {
      "hard_rule_violations_max": 0,
      "evidence_coverage_min": 0.90,
      "p90_latency_ms_max": 20000
    },
    "T3_HIGH_IMPACT": {
      "hard_rule_violations_max": 0,
      "independent_review_required": true,
      "confidence_calibration_required": true
    }
  },
  "canary": {
    "stages": [0.05, 0.15, 0.30, 0.50, 1.00],
    "minimum_cases_per_stage": 100,
    "rollback_on": [
      "any_P0_violation",
      "quality_drop_over_noninferiority_margin",
      "schema_failure_rate_above_threshold",
      "cost_increase_without_quality_gain"
    ]
  },
  "pricing_monitor": {
    "refresh_hours": 24,
    "change_alert_fraction": 0.15,
    "model_removed_action": "immediate_fallback_and_registry_quarantine",
    "stale_after_hours": 48
  },
  "weekly_optimizer": {
    "allowed_changes": [
      "model_order",
      "provider_sort",
      "task_cost_caps",
      "canary_allocation"
    ],
    "proposal_only_changes": [
      "confidence_threshold",
      "high_impact_classification_rules",
      "privacy_policy"
    ],
    "human_approval_required_changes": [
      "P0_or_P1_policy",
      "autonomous_financial_action",
      "new_sensitive_data_use"
    ]
  },
  "outputs": [
    "daily_model_health.json",
    "weekly_routing_recommendation.json",
    "monthly_cost_quality_report.md",
    "model_registry.json",
    "rollback_log.json"
  ]
}
```

## Weekly report requirements

- Cost by task, model, provider, and token component.
- Cost per successful task.
- Model quality by task.
- Corrections and overrides.
- Fallback and error rates.
- Cache effectiveness.
- Estimated next-month spend.
- Proposed routing changes.
- Expected saving and quality impact.
- Explicit risks.
- Approval status.

## Exit criteria

- Actual cost reconciles to OpenRouter activity.
- Monthly spend forecast error ≤15% after calibration period.
- Canary and rollback are operational.
- Every model change is versioned and explainable.
- No autonomous modification of hard financial safeguards.
