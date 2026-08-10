/**
 * NIZAM · Decision Outcome Registry types — the append-only learning record.
 * Owning contract: PFOS contract 03 (Decision Engine) section 12 — decision record
 *   fields, weekly learning cycle, and the PROHIBITED self-modifications.
 * Build phase: PFOS Stage 3, phase 3.1 — decision registry schema.
 * Depends on: decision.types.ts, lib/money.
 *
 * A DecisionRecord is written once at decision time and never rewritten (03 section 12
 * prohibits rewriting historical records). Reviews APPEND outcome entries; the core is
 * frozen. This mirrors the ledger's append-only discipline.
 */
import type { Money } from '@/lib/money/money';
import type { ConfidenceBand } from '@/features/safeToSpend/safeToSpend';
import type { Recommendation } from './decision.types.ts';

/** What the owner did with the recommendation. */
export const DECISION_ACTIONS = ['pending', 'followed', 'overrode', 'ignored'] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

/** A frozen snapshot of the forecast the decision was made on (for later error scoring). */
export interface DecisionForecastSnapshot {
  /** Safe-to-spend over the decision window at record time. */
  safeToSpendAtDecision: Money;
  /** The four card horizon-impact sentences, frozen. */
  horizonImpacts: { next_day: string; next_week: string; next_month: string; next_year: string };
}

/** An outcome observed at review time — APPENDED, never edited in place. */
export interface DecisionOutcome {
  /** ISO date the review happened. */
  reviewedAt: string;
  /** Observed net financial effect (signed milliunits), owner- or data-supplied. */
  actualNetEffect: Money;
  /** What was expected at decision time (frozen copy, for the error term). */
  expectedNetEffect: Money;
  /** actualNetEffect − expectedNetEffect (signed). */
  predictionError: Money;
  /** Attribution — contract 03 section 12 step 3. */
  attribution: OutcomeAttribution;
  note: string;
}

/** Decision record — contract 03 section 12. Core fields are immutable after creation. */
export interface DecisionRecord {
  id: string;
  /** ISO date/time the decision was recorded. */
  createdAt: string;
  question: string;
  recommendation: Recommendation;
  alternatives: string[];
  /** Schema/policy version in force when decided (03 section 12: "policy version"). */
  policyVersion: number;
  /** Opaque id of the data state the decision saw (03 section 12: "data snapshot id"). */
  dataSnapshotId: string;
  forecast: DecisionForecastSnapshot;
  confidenceBps: number;
  confidenceBand: ConfidenceBand;
  userAction: DecisionAction;
  /** Override reasoning when the owner went against the recommendation. */
  override: string | null;
  /** Scheduled review dates. */
  reviewDates: string[];
  /** Appended outcome observations (append-only). */
  outcomes: DecisionOutcome[];
  /** Expected net benefit at decision time (signed milliunits), if estimable. */
  netBenefitEstimate: Money | null;
  /** A proposed learning change, gated by the prohibition guard before it can apply. */
  learningProposal: LearningProposal | null;
}

/**
 * The SIX prohibited self-modifications (contract 03 section 12) plus the two safe,
 * approval-gated kinds. The guard rejects the prohibited kinds outright and marks hard
 * changes as requiring explicit owner approval before they may be applied.
 */
export const PROHIBITED_PROPOSAL_KINDS = [
  'reduce_p0_p1_protection',
  'increase_risk_beyond_policy',
  'grant_payment_authority',
  'use_new_sensitive_data',
  'rewrite_historical_record',
  'treat_explanation_as_fact',
] as const;
export type ProhibitedProposalKind = (typeof PROHIBITED_PROPOSAL_KINDS)[number];

export const ALLOWED_PROPOSAL_KINDS = ['recalibrate_confidence', 'adjust_statistical_parameter'] as const;
export type AllowedProposalKind = (typeof ALLOWED_PROPOSAL_KINDS)[number];

/** All proposal kinds as one literal tuple (for schema validation). */
export const PROPOSAL_KINDS = [
  'reduce_p0_p1_protection',
  'increase_risk_beyond_policy',
  'grant_payment_authority',
  'use_new_sensitive_data',
  'rewrite_historical_record',
  'treat_explanation_as_fact',
  'recalibrate_confidence',
  'adjust_statistical_parameter',
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** Attribution values for a reviewed outcome (contract 03 section 12 step 3). */
export const OUTCOME_ATTRIBUTIONS = ['data', 'model', 'behavior', 'macro', 'execution', 'unknown'] as const;
export type OutcomeAttribution = (typeof OUTCOME_ATTRIBUTIONS)[number];

export interface LearningProposal {
  kind: ProposalKind;
  description: string;
  /** Hard-policy changes require explicit approval and backtesting (03 section 12 steps 7-9). */
  isHardPolicyChange: boolean;
}
