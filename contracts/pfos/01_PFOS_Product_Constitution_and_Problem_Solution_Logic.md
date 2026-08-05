# PFOS Product Constitution and Problem–Solution Logic

## Document purpose

This document is the governing product contract for a private, single-user **Personal Financial Operating System (PFOS)**. It consolidates the full discovery discussion into an authoritative definition of the problem, intended outcomes, operating principles, product boundaries, users, jobs-to-be-done, risks, and phased product scope.

The system is not merely an expense tracker. It is a **Personal CFO and financial decision coach** that helps the user act before financial mistakes occur, protects non-negotiable obligations, evaluates calculated risk, forecasts consequences, and continuously learns from actual outcomes.

---

## 1. Problem definition

### 1.1 Core problem

The user has financial information fragmented across:

- Bank SMS messages received on an iPhone.
- HSBC, CIB, and NBE accounts.
- HSBC and other credit cards.
- BNPL and third-party financing providers.
- Family loans and informal obligations.
- Cash balances.
- Bank and credit-card statements.
- Receipts, notes, prior conversations, and Google Drive files.
- Future behavioral context from journaling and WHOOP data.

This fragmentation makes it difficult to know, at any point in time:

1. How much can safely be spent.
2. Whether all critical obligations will be paid on time.
3. Where money is leaking.
4. Whether a contemplated purchase is financially acceptable.
5. How today's choice affects tomorrow, next week, next month, and next year.
6. Which recovery or wealth-growth pathway is most effective.
7. Whether prior recommendations were actually correct.

### 1.2 Triggering situation

The user wants to prevent cash leakage, missed obligations, credit damage, and short-term decisions that weaken long-term financial stability. Existing budgeting tools largely explain what already happened. The desired system must influence the decision **before money is spent**.

### 1.3 Root causes

- No consolidated, auditable ledger.
- Transaction signals arrive through multiple channels and at different verification levels.
- Current cash is confused with genuinely available cash.
- Financial obligations are not ranked by severity.
- Forecasts are not continuously reconciled against actual outcomes.
- Generic budgeting advice is not adapted to personal history, behavior, local economic conditions, or currency risk.
- Traditional dashboards prioritize charts rather than immediate decisions.
- Financial facts, conversational memory, research, and behavioral context are often mixed together.

---

## 2. Product vision

> Build a continuously learning Personal CFO that protects the user's financial survival, maximizes long-term real net worth, improves recommendation accuracy through closed-loop outcome learning, and gives the user leverage to maneuver life and the economy through fast, calculated-risk decisions.

### 2.1 North-star outcome

**Year-over-year growth in real net worth**, subject to:

- No avoidable missed critical obligations.
- No unacceptable liquidity exposure.
- No hidden reliance on new debt.
- No unapproved use of health or journaling data.
- No high-confidence financial recommendation without explainable evidence.
- No autonomous movement of real money without explicit approval.

### 2.2 Primary value proposition

> Help me make the best financial decision before I spend, not merely explain my mistakes afterward.

---

## 3. User and stakeholder model

### 3.1 Primary user

A single private owner who:

- Uses Telegram as the fastest interaction layer.
- Uses a web dashboard for deeper review and planning.
- Wants strong guardrails and restrictive recommendations.
- Accepts calculated risk when justified by evidence.
- Wants financial advice grounded in personal history and local economic conditions.
- Wants minimal recurring infrastructure cost.

### 3.2 Stakeholders represented in the financial model

- The user.
- Banks and card issuers.
- BNPL and third-party lenders.
- Landlord or housing obligations.
- Family lenders and commitments.
- Essential service providers.
- Future dependents, children, and long-term ambitions.

---

## 4. Jobs to be done

### Critical jobs

1. **Safe-to-spend:** “Tell me how much I can safely spend now and until the next meaningful cash event.”
2. **Obligation protection:** “Ensure I do not miss debts, rent, food, transport, medicine, or other survival obligations.”
3. **Pre-transaction decision:** “Tell me whether I should make a purchase, why, and what it changes.”
4. **Leak detection:** “Show where money repeatedly disappears and what behavior or merchant patterns explain it.”
5. **Recovery planning:** “Give me realistic scenarios for escaping tight liquidity and reducing debt.”
6. **Wealth growth:** “Allocate cash and calculated risk toward faster real net-worth growth.”
7. **Forecasting:** “Show expected impact over tomorrow, one week, one month, one year, and longer horizons.”
8. **Learning:** “Measure whether recommendations worked and improve future confidence.”
9. **Awareness:** “Provide concise daily, weekly, monthly, and event-triggered updates.”
10. **Financial memory:** “Remember important decisions, rationale, outcomes, and life events.”

---

## 5. Financial constitution

### 5.1 Principle hierarchy

1. **Protect survival and legal/contractual obligations.**
2. **Protect minimum liquidity and emergency buffers.**
3. **Prevent credit and financing damage.**
4. **Increase year-over-year real net worth.**
5. **Preserve optionality and maneuverability.**
6. **Accept calculated risk when expected value is positive and downside remains survivable.**
7. **Explain every material recommendation.**
8. **Learn from outcomes without silently weakening hard safeguards.**

### 5.2 Critical obligation matrix

| Tier | Examples | Default policy |
|---|---|---|
| P0 — Survival/Critical | Debt minimums, rent, food, transport, essential medicine | Fully reserved; no discretionary override |
| P1 — High | Utilities, insurance, taxes, planned family obligations, minimum emergency buffer | Rare override; requires explicit evidence |
| P2 — Growth | Accelerated debt payment, savings, investment contributions, education tied to measurable ROI | Reallocatable through scenario analysis |
| P3 — Flexible | Dining, entertainment, luxury, discretionary subscriptions, impulse purchases | Allowed only within safe-to-spend |

### 5.3 Override philosophy

The system may classify a decision as:

- **Approved**
- **Approved with conditions**
- **Delay and reassess**
- **Not recommended**
- **Financially blocked**

“Financially blocked” means the system refuses to include the purchase in the safe plan. It cannot physically stop a card transaction unless future banking integrations permit that. Every override must preserve an audit record including justification, violated rule, expected impact, confidence, and observed result.

### 5.4 Evidence hierarchy

A recommendation should assemble as many relevant layers as possible:

1. Verified ledger facts.
2. Protected obligations and liquidity impact.
3. Mathematical projections and probability.
4. Historical financial outcomes.
5. Behavioral patterns.
6. Opportunity cost.
7. Current macroeconomic and currency context.
8. External financial research.
9. User justification and expected ROI.

### 5.5 Confidence behavior

| Confidence | Required behavior |
|---|---|
| 95–100% | Strong recommendation; concise explanation and action |
| 80–94% | Recommendation plus evidence, risks, and alternative |
| 60–79% | Provisional recommendation; ask one high-value question |
| Below 60% | Do not pretend certainty; request missing information or offer bounded scenarios |

Confidence must be calibrated against actual historical accuracy, not generated as decorative text.

---

## 6. Net-worth model

The system must avoid presenting one inflated or misleading number.

### 6.1 Required views

- **Nominal financial net worth:** financial assets minus liabilities.
- **Liquid net worth:** cash and rapidly liquid assets minus near-term liabilities.
- **Real net worth:** nominal value adjusted for inflation and currency purchasing power.
- **Liquidation net worth:** conservative after-tax/fee/fire-sale value.
- **Projected net worth:** scenario-based future value with confidence bands.
- **Decision net worth:** projected financial freedom created or destroyed by a decision.

### 6.2 Asset valuation

Assets may include:

- Cash by currency.
- Bank accounts.
- Investments.
- Gold or other stores of value.
- Vehicles.
- Property.
- Valuable equipment or other declared assets.

A car or other asset must not be valued only by its local nominal price. The system should track:

- Local market value.
- Acquisition cost.
- Depreciation/appreciation.
- Maintenance and ownership costs.
- Currency devaluation.
- Value in a chosen reference currency.
- Conservative liquidation discount.

### 6.3 Intangible capital

Education, certifications, career progression, health, productivity systems, automation, and time saved should not materially inflate current accounting net worth.

They should influence **future income and growth scenarios**, with a combined contribution cap or low-confidence weight (initial guideline: no more than 10–15% of a broader capital index). They must remain separate from book net worth.

---

## 7. Product capability map

### Foundation capabilities

- Account and liability registry.
- Transaction ledger.
- SMS/manual/email/statement ingestion.
- Categorization and merchant normalization.
- Deduplication and reconciliation.
- Obligation calendar.
- Safe-to-spend engine.
- Daily, weekly, and monthly briefs.
- Telegram question-answering.
- YNAB-inspired web dashboard.

### Intelligence capabilities

- Purchase Decision Cards.
- Scenario comparison.
- Debt payoff strategies.
- Emergency-buffer planning.
- Currency-aware asset valuation.
- Financial health and resilience scoring.
- Leakage and anomaly detection.
- Macroeconomic context.
- Historical evidence retrieval.

### Learning capabilities

- Decision Outcome Registry.
- Forecast-versus-actual evaluation.
- Confidence calibration.
- Rule-weight revision proposals.
- Behavioral correlation with journaling and WHOOP.
- Economic regime-change detection.

---

## 8. Communication operating rhythm

### Event loop

Immediate communication only for material events:

- Critical transaction.
- Unexpected large charge.
- Due-date risk.
- Safe-to-spend material change.
- Duplicate or suspicious entry.
- Statement reconciliation failure.
- Material macroeconomic event affecting the plan.
- Purchase decision request.

### Daily loop

Concise status:

- Safe-to-spend.
- Today’s obligations.
- Important change.
- One risk or one positive signal.
- One recommended action.

### Weekly loop

Learning and behavior:

- Forecast vs actual.
- Spending/category movement.
- Debt and buffer movement.
- Overrides and outcomes.
- Behavioral hypotheses.
- Model errors and proposed adjustment.

### Monthly loop

Personal financial board meeting:

- Net-worth movement.
- Real purchasing-power movement.
- Cash-flow and debt trend.
- Goal progress.
- Macro impact.
- Revised scenarios and capital allocation.

---

## 9. Scope boundaries and safety

### Allowed high autonomy

- Categorize and reconcile transactions.
- Construct budgets.
- Reserve obligations.
- Calculate safe-to-spend.
- Generate scenarios.
- Issue warnings and positive reinforcement.
- Create reminders and reports.
- Recommend capital allocation.
- Propose policy changes.

### Explicit approval required

- Initiating or scheduling real payments.
- Moving funds.
- Taking debt.
- Investing or selling assets.
- Closing accounts.
- Sharing financial or health data.
- Changing hard critical-obligation safeguards.

### Privacy boundary

Financial and mental-health/WHOOP data remain separate by default. A consented analytics layer may join minimized signals such as recovery score, sleep duration, journal sentiment label, or stress flag. Correlation must never be presented as causation.

---

## 10. Phased product plan

### Phase 0 — Constitution and inventory

- Finalize hard rules and objective hierarchy.
- Inventory accounts, cards, lenders, obligations, currencies, assets, and source documents.
- Define reference currency and inflation treatment.
- Define allowed autonomy and approval boundaries.

### Phase 1 — Trusted financial truth

- Build ledger and account registry.
- Import known balances, debts, and schedules.
- Add manual and SMS transaction ingestion.
- Implement deterministic deduplication and reconciliation.
- Create immutable audit trail.

### Phase 2 — Daily control

- Implement safe-to-spend.
- Implement obligation calendar.
- Deliver Telegram daily brief and event alerts.
- Build minimal dashboard command center.
- Add purchase Decision Cards.

### Phase 3 — Forecast and recovery

- Add cash-flow forecasts.
- Add debt recovery and emergency-buffer scenarios.
- Add leak analysis.
- Add monthly strategic report.
- Track forecast error.

### Phase 4 — Wealth and macro intelligence

- Add assets, currencies, real net worth, and macro context.
- Add capital allocation.
- Add investment-readiness rules.
- Add multi-year net-worth scenarios.

### Phase 5 — Behavioral and adaptive intelligence

- Connect journaling and WHOOP through privacy boundaries.
- Add behavioral hypotheses.
- Add Decision Outcome Registry.
- Calibrate confidence and rule weights.
- Require human approval for hard-policy changes.

---

## 11. Success metrics

### Reliability

- Reconciled transaction coverage.
- Duplicate rate.
- Categorization accuracy.
- Balance variance from statements.
- Due-date accuracy.
- Data freshness.

### Financial outcomes

- Critical obligations paid on time.
- Credit utilization.
- Emergency-buffer days.
- Debt principal reduction.
- Real net-worth YoY growth.
- New borrowing avoided.
- Discretionary leakage reduction.
- Savings/investment rate.

### Intelligence outcomes

- Forecast error by horizon.
- Confidence calibration.
- Recommendation adherence.
- Override success/failure.
- Recommendation net benefit.
- Percentage of decisions with sufficient evidence.

### Experience outcomes

- Time to answer “Can I afford this?”
- Daily brief usefulness.
- Number of manual corrections.
- Notification fatigue.
- Trust and explanation rating.

---

## 12. Open research areas

- Exact iOS transaction-message automation reliability and privacy constraints.
- Egyptian bank SMS formats and statement templates.
- Egypt-specific credit-score behavior and lender reporting.
- BNPL provider due-date, penalty, and settlement rules.
- Appropriate inflation and FX sources for Egypt.
- Safe and defensible asset-valuation sources.
- Behavioral-finance intervention design without shame or overreach.
- Confidence calibration for personalized forecasts.
- Best personal-finance dashboard patterns beyond YNAB.
- Low-cost VPS, backup, and encryption design.
- Hermes multi-agent orchestration and tool isolation.
- Appropriate investment advice boundaries and legal disclaimers.

---

## Machine-executable contract

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "pfos://contracts/product-constitution.schema.json",
  "title": "PFOS Product Constitution",
  "type": "object",
  "required": ["project", "objective", "principles", "critical_obligations", "phases", "success_metrics"],
  "properties": {
    "project": {"const": "PFOS"},
    "objective": {
      "type": "object",
      "required": ["north_star", "constraints"],
      "properties": {
        "north_star": {"const": "maximize_year_over_year_real_net_worth"},
        "constraints": {
          "type": "array",
          "items": {"enum": [
            "protect_critical_obligations",
            "maintain_liquidity",
            "preserve_emergency_buffer",
            "acceptable_calculated_risk",
            "explainability",
            "auditability"
          ]}
        }
      }
    },
    "principles": {
      "type": "array",
      "minItems": 6,
      "items": {"type": "string"}
    },
    "critical_obligations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "priority", "override_policy"],
        "properties": {
          "name": {"type": "string"},
          "priority": {"enum": ["P0", "P1", "P2", "P3"]},
          "override_policy": {"enum": ["never", "exceptional", "conditional", "flexible"]}
        }
      }
    },
    "phases": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["phase_id", "objective", "tasks", "exit_criteria"],
        "properties": {
          "phase_id": {"pattern": "^P[0-5]$"},
          "objective": {"type": "string"},
          "tasks": {"type": "array", "items": {"type": "string"}},
          "exit_criteria": {"type": "array", "items": {"type": "string"}}
        }
      }
    },
    "success_metrics": {
      "type": "object",
      "required": ["reliability", "financial", "intelligence", "experience"],
      "additionalProperties": {
        "type": "array",
        "items": {"type": "string"}
      }
    }
  }
}
```
