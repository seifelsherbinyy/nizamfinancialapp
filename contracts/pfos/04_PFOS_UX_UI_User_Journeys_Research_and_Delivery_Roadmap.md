# PFOS UX/UI, User Journeys, Research, and Delivery Roadmap

## Document purpose

Translate the Personal Financial Operating System into a coherent Telegram and web experience. Define dashboard information architecture, key workflows, states, microcopy principles, research questions, experiments, phased tasks, and acceptance criteria.

---

## 1. Experience strategy

The experience must make the user's financial position understandable in less than ten seconds while supporting deep analysis on demand.

### Core questions answered on entry

1. Am I financially safe right now?
2. How much can I spend?
3. What must I pay next?
4. What changed?
5. Am I improving?
6. What should I do today?
7. What happens if I make a contemplated decision?

### UX principles

- Decision-first, not chart-first.
- Direct answer before explanation.
- Progressive disclosure.
- One primary action per state.
- Explain material changes.
- Show uncertainty and data freshness.
- Positive reinforcement without false celebration.
- Strong warnings without shame.
- Consistent red/amber/green semantics with text labels.
- Never rely on color alone.
- User can inspect every calculation and source.
- Mobile-first responsive dashboard.
- Telegram and web use the same financial facts and policy engine.

---

## 2. Main dashboard recommendation

The initial dashboard should be inspired by YNAB's clarity around assigned money but adapted to the user’s Personal CFO model.

### Above the fold

#### A. Safe-to-spend

- Amount.
- Horizon (“today,” “until salary,” or selected date).
- Change since yesterday.
- Confidence.
- Last updated.

#### B. Financial status

- Green / amber / red / critical.
- One-line explanation.
- One highest-priority action.

#### C. Protected obligations

- Amount reserved.
- Next due obligation.
- Days remaining.
- Any projected shortfall.

#### D. Recovery/growth trajectory

- Real net-worth YoY direction.
- Emergency-buffer days.
- Debt movement.
- Current plan status.

#### E. Alerts and positive signals

- Maximum three items.
- Material only.
- Expandable.

### Secondary dashboard sections

- Cash-flow timeline.
- Accounts and cards.
- Budget/category plan.
- Upcoming obligations.
- Debt recovery.
- Leak analysis.
- Scenarios.
- Net worth and assets.
- Decisions and outcomes.
- Reports.
- Documents/reconciliation.
- Settings and financial constitution.

---

## 3. Information architecture

```text
Home / Command Center
├── Safe to Spend
├── Today’s Action
├── Protected Obligations
├── Financial Status
└── Alerts and Wins

Plan
├── Budget
├── Obligations Calendar
├── Goals
└── Capital Allocation

Activity
├── Transactions
├── Review Queue
├── Statements
└── Reconciliation

Decide
├── Purchase Check
├── Scenario Builder
├── Debt Strategy
└── Decision History

Grow
├── Net Worth
├── Assets and Currencies
├── Forecasts
├── Macro Context
└── Opportunities

Insights
├── Leaks
├── Merchants and Categories
├── Behavioral Patterns
└── Forecast Accuracy

System
├── Accounts and Providers
├── Policies
├── Data Sources
├── Privacy and Permissions
└── Audit
```

---

## 4. Telegram experience

### 4.1 Natural-language examples

- “Can I buy this for 4,800 EGP?”
- “How much can I spend until salary?”
- “What do I need to pay this week?”
- “Record 450 EGP at X from CIB.”
- “That was a transfer, not spending.”
- “What if my income becomes 70k?”
- “Why did my safe-to-spend fall?”
- “Show my biggest leak this month.”
- “What happens if I pay HSBC 10k today?”
- “Upload and reconcile this statement.”

### 4.2 Core commands/buttons

- Status.
- Add transaction.
- Check purchase.
- Obligations.
- Review exceptions.
- Scenario.
- Daily brief.
- Explain.
- Correct.
- Override.
- Privacy.

Natural language remains primary; buttons reduce ambiguity for high-risk actions.

### 4.3 Telegram response hierarchy

1. Direct conclusion.
2. Current amount/status.
3. Why.
4. Impact.
5. Next action.
6. Expand/details button.

### 4.4 Purchase Decision Card example

```text
RECOMMENDATION: DELAY

Buying this for EGP 4,800 would reduce your protected cash margin below the safe threshold in 11 days.

Today: Safe-to-spend falls from EGP 5,200 to EGP 400.
Next week: Shortfall probability rises from 7% to 29%.
Next month: Emergency-buffer goal is delayed 22 days.
Next year: Repeating this pattern would materially slow real net-worth growth.

Best path: Wait until 28 August and reassess after confirmed income.

Confidence: 91%
[Why?] [Run alternative] [Explain justification]
```

### 4.5 Low-confidence flow

- State uncertainty.
- Explain missing fact.
- Ask one high-value question.
- Recalculate.
- Preserve prior draft decision.

---

## 5. Daily, weekly, monthly report UX

### Daily brief

Target: 80–180 words unless critical complexity requires more.

- Status.
- Safe-to-spend.
- One obligation.
- One material change.
- One positive or negative flag.
- One action.

### Weekly review

- Forecast vs actual.
- Category and merchant movement.
- Debt/buffer movement.
- Decision outcomes.
- Override review.
- Behavioral hypothesis.
- One learning or policy proposal.

### Monthly board report

- Executive summary.
- Nominal, liquid, and real net worth.
- Cash-flow and debt.
- Obligations performance.
- Leakage.
- Macro/currency effects.
- Goal performance.
- Scenario reset.
- Capital allocation recommendation.
- Model accuracy and limitations.

---

## 6. Core user journeys

### Journey 1 — First financial inventory

1. Create secure profile.
2. Add accounts and liabilities.
3. Upload existing summary files and statements.
4. Confirm balances and due dates.
5. Rank obligations.
6. Set buffer rules.
7. Produce opening balance sheet.
8. Show data-confidence gaps.
9. Activate daily brief only after minimum integrity threshold.

### Journey 2 — Transaction received

1. Raw SMS/email/manual event arrives.
2. System parses.
3. Exact duplicate check.
4. Merchant/account/category inference.
5. Ledger candidate created.
6. Safe-to-spend recalculated.
7. If material, send event notice.
8. If ambiguous, ask for one correction.
9. Later match against statement.

### Journey 3 — Purchase check

1. User enters amount and purpose.
2. System gathers current snapshot.
3. Applies hard constraints.
4. Runs forecast and evidence retrieval.
5. Gives direct answer.
6. User expands explanation or offers justification.
7. System approves/conditions/delays/blocks.
8. Decision stored.
9. Outcome revisited.

### Journey 4 — Monthly statement reconciliation

1. Reminder sent.
2. User uploads statement.
3. File validated and parsed.
4. Existing provisional transactions matched.
5. New statement-only items added.
6. Duplicates/reversals/refunds resolved.
7. Balance equation checked.
8. Exceptions reviewed.
9. Period closed.
10. Forecast model receives verified actuals.

### Journey 5 — Recovery scenario

1. System detects tight position or user asks.
2. Present baseline and shortfall.
3. Generate 3–5 realistic pathways.
4. Compare liquidity, debt, net worth, stress, and risk.
5. Recommend one.
6. Convert into weekly actions.
7. Track adherence and revise.

### Journey 6 — Behavioral correlation

1. User enables data sharing.
2. System imports minimized WHOOP/journal features.
3. Wait for sufficient observations.
4. Display hypothesis with sample size and uncertainty.
5. Offer low-risk intervention.
6. Measure whether intervention helped.
7. User can disable or delete linkage.

---

## 7. Screen specification

### Home

- Safe-to-spend card.
- Status card.
- Next obligations.
- Today’s recommendation.
- Net-worth trajectory.
- Alerts/wins.
- Quick purchase check.

### Budget

- Available-to-assign.
- Protected categories.
- Essential categories.
- Flexible categories.
- Actual vs plan.
- Rollovers and exceptions.

### Accounts

- Cash/bank/card/loan/BNPL/family.
- Available versus ledger balance.
- Reconciliation status.
- Statement date.
- Utilization and due amount.

### Forecast

- Timeline selector.
- Baseline/downside/upside.
- Cash, debt, buffer, net worth.
- Assumptions.
- Sensitivity controls.

### Decisions

- Pending decision.
- Recommendation.
- Evidence.
- Overrides.
- Review date.
- Expected vs actual.

### Review queue

- Unknown merchant.
- Uncertain account.
- Possible duplicate.
- Transfer classification.
- Missing statement match.
- Amount discrepancy.

### Net worth

- Nominal.
- Liquid.
- Real.
- Liquidation.
- Currency exposure.
- Asset valuation confidence.
- YoY target.

---

## 8. States and error handling

Required states:

- Loading.
- Fresh and reconciled.
- Partially fresh.
- Stale.
- Missing account.
- Statement overdue.
- Forecast unavailable.
- Model unavailable.
- Drive unavailable.
- Telegram unavailable.
- Possible duplicate.
- Security lock.
- Critical obligation risk.
- No safe-to-spend.
- Positive recovery milestone.

Error messages must state:

1. What happened.
2. What data remains reliable.
3. What the user should do.
4. Whether recommendations are limited.

---

## 9. Trust and transparency

The user must be able to inspect:

- Calculation breakdown.
- Included/excluded accounts.
- Protected amounts.
- Data timestamps.
- Rules applied.
- Forecast assumptions.
- Evidence used.
- Model and policy version.
- Confidence meaning.
- Correction and appeal paths.
- Audit history.

The dashboard should show “Why did this change?” for any material movement.

---

## 10. Accessibility and interaction quality

- Keyboard accessible.
- Clear focus states.
- Semantic HTML.
- Screen-reader labels.
- Text alternatives for charts.
- High contrast.
- Color plus label/icon.
- Large touch targets.
- Reduced-motion support.
- Plain language.
- EGP and currency formatting.
- Arabic/English readiness.
- RTL-compatible component system.
- Date and number localization.
- No guilt-inducing dark patterns.

Research should validate against current WCAG guidance before production.

---

## 11. Research program

### Competitive UX review

Study current versions of:

- YNAB.
- Monarch Money.
- Copilot Money.
- Rocket Money.
- Quicken Simplifi.
- Lunch Money.
- Tiller.
- Empower.
- Actual Budget and other credible open-source finance tools.

Evaluate:

- Home-screen hierarchy.
- Safe-to-spend/budget model.
- Account reconciliation.
- Debt views.
- Forecasting.
- Mobile interaction.
- Notification design.
- Trust and explainability.
- User complaints and retention drivers.

### Community research

Research recurring issues from:

- YNAB and personal-finance communities.
- Self-hosted and privacy communities.
- Telegram bot and iOS Shortcuts communities.
- Open-source budgeting projects.
- Egyptian banking/consumer-finance communities where reliable.

### Behavioral research

Investigate:

- Precommitment and cooling-off periods.
- Goal framing.
- Positive reinforcement.
- Loss aversion without manipulation.
- Implementation intentions.
- Notification fatigue.
- Financial shame.
- Confidence and explanation design.

### Technical research

- Hermes architecture and extensibility.
- OpenRouter routing/privacy/cost controls.
- iOS Shortcut trigger reliability.
- Statement parsing.
- OCR fallback.
- VPS comparison.
- Google Drive indexing and OAuth.
- SQLite backup/recovery.
- Egypt macro APIs and sources.

---

## 12. Experiments

### Experiment A — Dashboard hierarchy

Compare:

- Safe-to-spend-first.
- Obligation-first.
- Financial-health-first.

Measure comprehension and time to answer key questions.

### Experiment B — Purchase response

Compare:

- Simple recommendation.
- Recommendation plus four time horizons.
- Recommendation plus historical evidence.
- Full evidence package.

Measure trust, adherence, and cognitive load.

### Experiment C — Notification intensity

Compare thresholds and report lengths to minimize fatigue without missing risk.

### Experiment D — Positive reinforcement

Test progress messages tied to real outcomes, not generic encouragement.

### Experiment E — Override workflow

Test whether justification questions improve decisions without creating resentment or abandonment.

---

## 13. Delivery roadmap

### Release 0 — Clickable prototype

- Command center.
- Accounts.
- Obligations.
- Purchase Decision Card.
- Daily brief.
- Statement review flow.
- Test with realistic synthetic data.

### Release 1 — Trusted personal MVP

- Live ledger.
- Manual/Telegram ingestion.
- Core providers.
- Safe-to-spend.
- Obligations.
- Reconciliation.
- Daily/weekly/monthly reports.
- Minimal dashboard.

### Release 2 — Decision and recovery

- Purchase engine.
- Justification.
- Scenario builder.
- Debt recovery.
- Leak analysis.
- Decision history.

### Release 3 — Wealth and macro

- Net worth.
- Asset and currency valuation.
- Real purchasing-power view.
- Macro context.
- Capital allocation.

### Release 4 — Adaptive system

- Outcome registry.
- Forecast calibration.
- Behavioral link.
- Policy improvement proposals.
- Advanced confidence.

---

## 14. Acceptance criteria

The MVP is not ready until:

- The user can answer “How much can I safely spend?” in under ten seconds.
- Every displayed financial fact has a source and timestamp.
- P0 obligations are always reserved.
- Duplicate SMS/manual/statement entries do not double-count.
- The user can correct any inference.
- The dashboard and Telegram show the same value.
- A purchase recommendation includes direct answer and time-horizon impact.
- Stale data visibly lowers confidence.
- A failed LLM does not make the ledger unavailable.
- A backup can be restored.
- No health/journal data is used without explicit permission.
- Reports do not create notification fatigue in a controlled trial period.

---

## 15. Prioritized open questions

1. What exact daily/weekly/monthly delivery times best fit the user's routine?
2. What is the initial protected-buffer rule?
3. What is the reference currency for real net worth?
4. Which provider is imported first?
5. Which dashboard language is primary?
6. What level of dashboard authentication is acceptable?
7. What transaction amount triggers an immediate event alert?
8. How are family obligations represented and verified?
9. Which macro indicators can materially alter a decision?
10. What minimum sample size is required before behavioral insight appears?

---

## Machine-executable contract

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "pfos://contracts/ux-research-roadmap.schema.json",
  "title": "PFOS UX and Delivery Contract",
  "type": "object",
  "required": ["experience_principles", "navigation", "journeys", "reports", "research", "releases", "acceptance_criteria"],
  "properties": {
    "experience_principles": {
      "type": "array",
      "minItems": 8,
      "items": {"type": "string"}
    },
    "navigation": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["section", "screens"],
        "properties": {
          "section": {"type": "string"},
          "screens": {"type": "array", "items": {"type": "string"}}
        }
      }
    },
    "journeys": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "trigger", "steps", "success"],
        "properties": {
          "id": {"type": "string"},
          "trigger": {"type": "string"},
          "steps": {"type": "array", "items": {"type": "string"}},
          "success": {"type": "array", "items": {"type": "string"}}
        }
      }
    },
    "reports": {
      "type": "object",
      "required": ["daily", "weekly", "monthly", "event"],
      "additionalProperties": {
        "type": "object",
        "required": ["purpose", "max_default_length", "required_sections"],
        "properties": {
          "purpose": {"type": "string"},
          "max_default_length": {"type": ["integer", "string"]},
          "required_sections": {"type": "array", "items": {"type": "string"}}
        }
      }
    },
    "research": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["question", "method", "evidence_threshold", "output"],
        "properties": {
          "question": {"type": "string"},
          "method": {"type": "string"},
          "evidence_threshold": {"type": "string"},
          "output": {"type": "string"}
        }
      }
    },
    "releases": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["release", "scope", "exit_criteria"],
        "properties": {
          "release": {"pattern": "^R[0-4]$"},
          "scope": {"type": "array", "items": {"type": "string"}},
          "exit_criteria": {"type": "array", "items": {"type": "string"}}
        }
      }
    },
    "acceptance_criteria": {
      "type": "array",
      "minItems": 10,
      "items": {"type": "string"}
    }
  }
}
```
