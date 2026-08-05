/**
 * NIZAM · Purchase decision types — request, recommendation, the 11-line card.
 * Owning contract: PFOS contract 03 (Decision Engine) section 4 — inputs (4.1),
 *   evaluation dimensions (4.2), recommendation states (4.3), card order (4.4),
 *   and the evidence-package JSON schema (purchase_decision).
 * Build phase: PFOS Stage 2, phase 2.1 — decision card schema.
 * Depends on: obligations engine (ConfidenceBand lives with safe-to-spend), lib/money.
 *
 * These are pure data. The decision is a DETERMINISTIC policy gate (03 section 1:
 * the LLM never sources numbers), so the card is fully computable and testable.
 */
import type { Money } from '@/lib/money/money';
import type { ConfidenceBand } from '@/features/safeToSpend/safeToSpend';

/** How the purchase is paid — determines WHEN the cash leaves. */
export const PAYMENT_METHODS = ['cash', 'credit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const URGENCY_LEVELS = ['low', 'medium', 'high'] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

/** Purchase request — contract 03 section 4.1 (the deterministically usable inputs). */
export interface PurchaseRequest {
  /** Price to evaluate (positive milliunits). */
  price: Money;
  paymentMethod: PaymentMethod;
  /** Funding/liability account, if the owner named one. */
  accountId: string | null;
  /** Budget category, if any (free text id). */
  category: string | null;
  /** ISO date the purchase would happen. */
  date: string;
  /** True when the purchase can be undone/returned — contract 03 section 4.2 reversibility. */
  reversible: boolean;
  /** Free-text purpose/justification. Never parsed for numbers — display + missing-info only. */
  purpose: string | null;
  urgency: Urgency;
  /** A cheaper alternative price, if the owner offered one (enables the 'alternative' state). */
  alternativePrice: Money | null;
}

/**
 * Recommendation states — contract 03 section 4.3 (seven states). The evidence-package
 * JSON schema collapses the two conditional approvals into `approve_with_conditions`;
 * `toEvidenceRecommendation` performs that fold for schema conformance.
 */
export const RECOMMENDATIONS = [
  'approve',
  'approve_with_cap',
  'approve_with_condition',
  'delay',
  'alternative',
  'reject',
  'financially_blocked',
] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/** The evidence-package enum (contract 03 JSON schema — six values). */
export const EVIDENCE_RECOMMENDATIONS = [
  'approve',
  'approve_with_conditions',
  'delay',
  'alternative',
  'reject',
  'financially_blocked',
] as const;
export type EvidenceRecommendation = (typeof EVIDENCE_RECOMMENDATIONS)[number];

/** Fold the seven card states into the six-value evidence-package enum. */
export function toEvidenceRecommendation(r: Recommendation): EvidenceRecommendation {
  if (r === 'approve_with_cap' || r === 'approve_with_condition') return 'approve_with_conditions';
  return r;
}

/** The four forward impacts required by the evidence-package JSON schema. */
export interface HorizonImpacts {
  next_day: string;
  next_week: string;
  next_month: string;
  next_year: string;
}

/** The numbers behind the decision — surfaced so nothing is a black box. */
export interface Affordability {
  price: Money;
  /** Safe-to-spend over the decision window counting expected income. */
  safeToSpendWithIncome: Money;
  /** Safe-to-spend if expected income does NOT arrive (cash in hand after reserves). */
  safeToSpendInHand: Money;
  /** safeToSpendInHand − price (may be negative). */
  remainingInHand: Money;
  /** safeToSpendWithIncome − price (may be negative). */
  remainingWithIncome: Money;
  /** True when the purchase relies on expected income to stay safe. */
  reliesOnExpectedIncome: boolean;
  /** The largest amount that could be approved now without harm (for approve_with_cap). */
  affordableCap: Money;
}

/**
 * The Decision Card — contract 03 section 4.4, in exact output order (fields 1..11),
 * plus the schema-shaped `horizonImpacts` and the `affordability` numbers.
 */
export interface DecisionCard {
  recommendation: Recommendation; // 1. Direct recommendation
  reason: string; // 2. One-sentence reason
  immediateEffect: string; // 3. Immediate effect
  nextDayEffect: string; // 4. Tomorrow / next-day effect
  oneWeekEffect: string; // 5. One-week effect
  oneMonthEffect: string; // 6. One-month effect
  oneYearEffect: string; // 7. One-year / trajectory effect
  evidence: string[]; // 8. Historical / behavioural evidence (deterministic subset)
  alternative: string | null; // 9. Alternative pathway
  confidence: { bps: number; band: ConfidenceBand; missingInformation: string[] }; // 10
  requiredAction: string; // 11. Required user action
  horizonImpacts: HorizonImpacts;
  affordability: Affordability;
}
