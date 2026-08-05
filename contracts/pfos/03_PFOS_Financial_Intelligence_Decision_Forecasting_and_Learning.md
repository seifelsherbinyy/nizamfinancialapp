# PFOS Financial Intelligence, Decision, Forecasting, and Learning Contract

## Document purpose

Define the deterministic and AI-assisted mechanisms that turn financial records into safe-to-spend limits, obligation protection, purchase recommendations, forecasts, net-worth views, leak detection, and continuously calibrated learning.

---

## 1. Design rule: calculations before language

The LLM must not be the source of balances, totals, due dates, or risk constraints.

Required sequence:

1. Collect authoritative data.
2. Validate freshness and completeness.
3. Run deterministic calculations.
4. Run simulations and statistical models.
5. Assemble evidence.
6. Apply hard policy gates.
7. Use the LLM to interpret, challenge, explain, and ask for missing context.
8. Record recommendation and expected outcome.
9. Revisit outcome later.

---

## 2. Safe-to-spend engine

### 2.1 Definition

Safe-to-spend is not current cash. It is the amount the user can spend within a defined horizon without violating protected obligations, liquidity floors, or risk thresholds.

### 2.2 Baseline formula

```text
SafeToSpend(H) =
LiquidAvailableNow
+ HighConfidenceInflowsBefore(H)
- PendingAndUnpostedOutflows
- ProtectedObligationsBefore(H)
- EssentialLivingReserve(H)
- MinimumLiquidityBuffer
- UncertaintyReserve
- PlannedCommittedAllocations
```

Floor at zero unless the interface explicitly displays a deficit.

### 2.3 Required outputs

- Safe-to-spend today.
- Safe-to-spend until next salary/inflow.
- Daily allowance.
- Protected amount.
- Data freshness.
- Confidence.
- Primary risk.
- What would improve the number.
- Sensitivity to delayed income or unexpected expense.

### 2.4 Reserve hierarchy

1. P0 obligations.
2. P1 obligations.
3. Minimum cash buffer.
4. Expected variable essentials.
5. Known pending transactions.
6. Uncertainty allowance.
7. Growth allocations.
8. Flexible spending.

### 2.5 Uncertainty reserve

Should reflect:

- Unverified SMS.
- Missing statement periods.
- Volatile variable expenses.
- Income timing variance.
- FX exposure.
- Forecast error history.
- Known upcoming but unpriced commitments.

---

## 3. Obligation protection engine

### Core functions

- Maintain due-date calendar.
- Reserve minimum payments.
- Detect insufficient funds early.
- Rank obligations by harm.
- Calculate late-payment, penalty, and credit-impact risk.
- Recommend funding sequence.
- Escalate through event, daily, and weekly loops.

### Obligation health statuses

- Green: fully protected.
- Amber: protected only if plan is followed.
- Red: projected shortfall.
- Critical: due or overdue without protected funds.

### Required forecast windows

- 1 day.
- 7 days.
- Until salary.
- 30 days.
- Statement cycle.
- 90 days.

---

## 4. Purchase Decision Engine

### 4.1 Input

- Price.
- Currency.
- Payment method.
- Category.
- Date.
- Financing terms if any.
- User purpose.
- Urgency.
- Alternatives.
- Expected financial or life benefit.

### 4.2 Evaluation dimensions

- Critical-obligation impact.
- Liquidity impact.
- Safe-to-spend impact.
- New borrowing probability.
- Credit utilization.
- Interest/fee cost.
- Emergency-buffer impact.
- Debt-free date.
- Net-worth trajectory.
- Opportunity cost.
- Historical outcomes for similar purchases.
- Behavioral context.
- Macro/currency timing.
- Expected ROI or avoided loss.
- Reversibility.
- User justification quality.

### 4.3 Recommendation states

- Approve.
- Approve with cap.
- Approve with funding condition.
- Delay to a named date/event.
- Select lower-cost alternative.
- Reject.
- Financially block inside the plan.

### 4.4 Decision Card output order

1. Direct recommendation.
2. One-sentence reason.
3. Immediate effect.
4. Tomorrow/next-day effect.
5. One-week effect.
6. One-month effect.
7. One-year/trajectory effect.
8. Historical/behavioral evidence.
9. Alternative pathway.
10. Confidence and missing information.
11. Required user action.

### 4.5 Justification Engine

When confidence is insufficient or a user requests override:

- Extract claimed benefit.
- Determine whether benefit is measurable.
- Estimate probability and time to benefit.
- Estimate downside and survivability.
- Compare lower-cost alternatives.
- Calculate break-even or payback.
- Check whether delay destroys value.
- Check historical reliability of similar justifications.
- Approve only if constraints remain protected and expected value is acceptable.

---

## 5. Risk engine

### 5.1 Risk categories

- Liquidity risk.
- Default/late-payment risk.
- Credit-utilization risk.
- Income interruption risk.
- Currency risk.
- Inflation risk.
- Interest-rate risk.
- Concentration risk.
- Behavioral/impulse risk.
- Data-quality risk.
- Model uncertainty.
- Operational/security risk.

### 5.2 Risk output

Each risk must include:

- Probability.
- Impact.
- Time horizon.
- Exposure.
- Mitigation.
- Confidence.
- Evidence.
- Trend.

### 5.3 Calculated-risk acceptance

A risky action may be acceptable when:

- P0/P1 obligations remain protected.
- Downside remains survivable.
- Expected value is positive.
- Cash-flow recovery is defined.
- Failure does not create cascading debt.
- Alternatives are inferior.
- Confidence is sufficient.
- Decision is reversible or risk-limited where possible.

---

## 6. Forecast engine

### 6.1 Forecast horizons

- Next day.
- Next week.
- Next month.
- Quarter.
- Year.
- Multi-year.

### 6.2 Forecast types

- Deterministic scheduled cash flow.
- Baseline expected scenario.
- Conservative/downside scenario.
- Aggressive/upside scenario.
- User-defined “what if.”
- Monte Carlo or probabilistic range where data supports it.

### 6.3 Model inputs

- Income schedule and variance.
- Fixed obligations.
- Historical variable spending.
- Seasonality.
- Debt rates and schedules.
- Inflation.
- FX rates and exposure.
- Asset valuation.
- User behavior.
- Goal contributions.
- Economic regime indicators.
- Forecast error history.

### 6.4 Forecast outputs

- Cash balance path.
- Safe-to-spend path.
- Debt balances.
- Emergency-buffer days.
- Credit utilization.
- Nominal and real net worth.
- Probability of shortfall.
- Goal completion dates.
- Main drivers and sensitivities.
- Confidence interval.

### 6.5 Scenario examples

- Income increases to X/Y/Z.
- Income delay.
- Reduced discretionary spending.
- Debt snowball versus avalanche.
- Refinancing.
- One-time purchase.
- Currency devaluation.
- Inflation shock.
- Car sale/purchase.
- Investment contribution.
- Emergency expense.
- Job offer comparison.

---

## 7. Debt and capital allocation

### 7.1 Debt strategies

The engine must compare:

- Minimum-only.
- Avalanche.
- Snowball.
- Liquidity-first hybrid.
- Credit-utilization-first.
- Provider-risk-first.
- Negotiated settlement/refinance where appropriate.

The recommendation must consider behavioral adherence and liquidity, not interest rate alone.

### 7.2 Capital Allocation Engine

For each available incremental amount, compare allocation to:

- Critical shortfall.
- Emergency reserve.
- High-cost debt.
- Credit utilization reduction.
- Scheduled future obligation.
- Investment.
- Income-generating asset.
- Education/certification with measurable ROI.
- Quality-of-life or health investment.
- Discretionary consumption.

The engine should output expected impact, risk, liquidity loss, and time to benefit.

---

## 8. Net-worth engine

### 8.1 Financial net-worth equation

```text
NominalNetWorth = Sum(FinancialAssets + ValuedRealAssets) - Sum(Liabilities)
```

### 8.2 Real net worth

Track in:

- Local nominal EGP.
- Inflation-adjusted EGP.
- User-selected reference currency.
- Conservative liquidation value.

### 8.3 Currency-aware assets

For every currency or locally priced asset:

- Store local value.
- Store FX conversion source/time.
- Store reference-currency value.
- Store inflation-adjusted value.
- Separate nominal asset appreciation from currency/purchasing-power change.

### 8.4 Intangible capital

Do not add speculative career or productivity value to book net worth. Model it as a probability-weighted future income impact and display separately.

---

## 9. Leak and behavioral intelligence

### 9.1 Leak detection

- Category overspend.
- Merchant concentration.
- Recurring unused subscriptions.
- Financing fees.
- Interest and late fees.
- Cash withdrawals without downstream explanation.
- Repeated small purchases.
- Price inflation at same merchants.
- Lifestyle creep after income events.
- Duplicate charges.
- Unplanned installments.

### 9.2 Behavioral features

Potential user-approved inputs:

- Sleep duration.
- WHOOP recovery.
- Strain.
- Journal sentiment.
- Stress flag.
- Payday proximity.
- Time of day.
- Day of week.
- Location/category context.
- Prior override behavior.

### 9.3 Scientific caution

The system should say:

> “Discretionary spending was higher on low-recovery days in the observed sample.”

It must not say that poor recovery caused spending unless robust evidence exists.

### 9.4 Intervention strategy

- Pre-transaction pause.
- Lower temporary discretionary cap.
- Alternative suggestion.
- Cooling-off period.
- Positive reinforcement.
- Ask for purpose.
- Remind user of personally meaningful goal.
- Avoid shame, punishment, or manipulative fear.

---

## 10. Macroeconomic engine

### Egypt/regional signals

- Headline and core inflation.
- Central-bank policy rates.
- Official and relevant market FX rates.
- Fuel and transport prices.
- Banking and credit regulation.
- Deposit and lending rates.
- Employment and sector conditions.
- Major tax changes.
- BNPL/consumer-finance rules.
- Asset-specific market data.

### Integration rules

- Macro data modifies assumptions; it does not automatically override personal facts.
- Every external data point stores source, retrieval time, frequency, and confidence.
- Material macro changes generate a policy-impact summary.
- The system must distinguish observed data from forecast and opinion.

---

## 11. Evidence and explainability engine

Each material recommendation creates an Evidence Package:

- Financial facts used.
- Rules triggered.
- Forecasts and assumptions.
- Historical comparisons.
- Behavioral evidence.
- Macro evidence.
- Alternatives.
- Missing data.
- Model and prompt versions.
- Confidence.
- Human-readable explanation.

The explanation should be concise by default and expandable.

---

## 12. Decision Outcome Registry and learning loop

### Decision record

- Decision ID.
- Question/action.
- Recommendation.
- Alternatives.
- Policy version.
- Data snapshot ID.
- Forecasts.
- Confidence.
- User action.
- Override and justification.
- Review dates.
- Actual outcomes.
- Prediction error.
- Net benefit estimate.
- Learning proposal.

### Weekly learning cycle

1. Select mature decisions.
2. Compare expected and actual outcomes.
3. Attribute error to data, model, behavior, macro shock, or execution.
4. Recalibrate confidence.
5. Update statistical parameters where safe.
6. Propose rule changes.
7. Require approval for hard-policy changes.
8. Version all changes.
9. Backtest before activation.

### Prohibited self-modification

The system must never silently:

- Reduce P0/P1 protection.
- Increase allowed risk beyond user policy.
- Grant itself payment authority.
- Use new sensitive data.
- Rewrite historical records.
- Treat model-generated explanations as facts.

---

## 13. Financial health and freedom index

A score may summarize:

- Liquidity.
- Obligation coverage.
- Debt burden.
- Credit utilization.
- Emergency buffer.
- Cash-flow stability.
- Real net-worth trajectory.
- Diversification.
- Spending control.
- Forecast confidence.

The score must never replace underlying metrics. Weight changes require versioning and backtesting.

---

## 14. Phased tasks

### Phase 1 — Deterministic controls

- Safe-to-spend v1.
- Obligation reserve.
- Purchase impact arithmetic.
- Fixed-horizon cash flow.
- Basic debt schedule.
- Data freshness/confidence.

### Phase 2 — Evidence and scenarios

- Decision Cards.
- Historical comparison.
- Opportunity-cost calculation.
- Income/spending what-if scenarios.
- Conservative/base/upside forecasts.
- Justification workflow.

### Phase 3 — Net worth and macro

- Multi-currency balance sheet.
- Asset valuation.
- Inflation-adjusted and liquidation views.
- Egypt macro ingestion.
- Currency sensitivity.
- Capital allocation.

### Phase 4 — Adaptive learning

- Outcome registry.
- Forecast accuracy dashboards.
- Confidence calibration.
- Behavioral feature store.
- Rule-change proposals.
- Backtesting.

### Phase 5 — Advanced intelligence

- Probabilistic simulations.
- Job-offer and education ROI models.
- Investment-readiness and risk-capacity models.
- Long-range family and wealth planning.
- Adversarial review/debate for high-impact decisions.

---

## 15. Research required

- Safe-to-spend formulas used by YNAB, cash-flow planners, and financial advisors.
- Consumer debt optimization under unstable income.
- Credit utilization and reporting behavior in Egypt.
- Confidence calibration methods for probabilistic forecasts.
- Asset valuation in inflationary/devaluing economies.
- Reliable EGP inflation and FX reference methodology.
- Behavioral-finance interventions that improve adherence.
- Forecast evaluation metrics for sparse personal data.
- Monte Carlo usefulness at low sample sizes.
- Legal boundaries between personal software and regulated financial advice.
- Investment-risk profiling and suitability.
- Explainable multi-agent or multi-perspective decision synthesis.

---

## Machine-executable contract

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "pfos://contracts/financial-intelligence.schema.json",
  "title": "PFOS Financial Intelligence Contract",
  "type": "object",
  "required": ["safe_to_spend", "purchase_decision", "risk", "forecast", "learning"],
  "properties": {
    "safe_to_spend": {
      "type": "object",
      "required": ["horizon", "protected_inputs", "uncertainty_reserve", "confidence"],
      "properties": {
        "horizon": {"type": "string"},
        "protected_inputs": {"type": "array", "items": {"type": "string"}},
        "uncertainty_reserve": {"type": "number", "minimum": 0},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1}
      }
    },
    "purchase_decision": {
      "type": "object",
      "required": ["recommendation", "evidence", "horizon_impacts", "confidence"],
      "properties": {
        "recommendation": {"enum": ["approve", "approve_with_conditions", "delay", "alternative", "reject", "financially_blocked"]},
        "evidence": {"type": "array", "items": {"type": "string"}},
        "horizon_impacts": {
          "type": "object",
          "required": ["next_day", "next_week", "next_month", "next_year"],
          "additionalProperties": {"type": "string"}
        },
        "confidence": {"type": "number", "minimum": 0, "maximum": 1}
      }
    },
    "risk": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type", "probability", "impact", "horizon", "mitigation"],
        "properties": {
          "type": {"type": "string"},
          "probability": {"type": "number", "minimum": 0, "maximum": 1},
          "impact": {"enum": ["low", "medium", "high", "critical"]},
          "horizon": {"type": "string"},
          "mitigation": {"type": "string"}
        }
      }
    },
    "forecast": {
      "type": "object",
      "required": ["scenarios", "outputs", "evaluation"],
      "properties": {
        "scenarios": {"type": "array", "items": {"type": "string"}},
        "outputs": {"type": "array", "items": {"type": "string"}},
        "evaluation": {"enum": ["mae", "mape", "brier_score", "interval_coverage", "custom_by_metric"]}
      }
    },
    "learning": {
      "type": "object",
      "required": ["decision_registry", "weekly_review", "hard_rule_change_requires_approval"],
      "properties": {
        "decision_registry": {"const": true},
        "weekly_review": {"const": true},
        "hard_rule_change_requires_approval": {"const": true}
      }
    }
  }
}
```
