/**
 * NIZAM · Decision Outcome Registry — append-only records + the prohibition guard.
 * Owning contract: PFOS contract 03 (Decision Engine) section 12 — decision record,
 *   weekly learning cycle, prohibited self-modification.
 * Build phase: PFOS Stage 3, phase 3.1 — registry create/review/guard.
 * Depends on: decisionRecord.types.ts, decision.types.ts, lib/money.
 *
 * PURE functions. Records are created once and never rewritten; reviews return a NEW
 * record with an outcome APPENDED. The prohibition guard encodes the six forbidden
 * self-modifications as code so a learning proposal can never silently weaken protection.
 */
import type { Money } from '@/lib/money/money';
import { sub } from '@/lib/money/money';
import type { DecisionCard } from './decision.types.ts';
import type {
  DecisionRecord,
  DecisionOutcome,
  DecisionAction,
  LearningProposal,
} from './decisionRecord.types.ts';
import { PROHIBITED_PROPOSAL_KINDS } from './decisionRecord.types.ts';

export interface RecordDecisionInput {
  id: string;
  createdAt: string;
  question: string;
  card: DecisionCard;
  alternatives?: string[];
  policyVersion: number;
  dataSnapshotId: string;
  userAction?: DecisionAction;
  override?: string | null;
  reviewDates?: string[];
  netBenefitEstimate?: Money | null;
}

/**
 * Create a decision record from a decision card. The forecast and confidence are frozen
 * copies — later reviews score against these, never against a recomputed number.
 */
export function recordDecision(input: RecordDecisionInput): DecisionRecord {
  return {
    id: input.id,
    createdAt: input.createdAt,
    question: input.question,
    recommendation: input.card.recommendation,
    alternatives: input.alternatives ?? (input.card.alternative ? [input.card.alternative] : []),
    policyVersion: input.policyVersion,
    dataSnapshotId: input.dataSnapshotId,
    forecast: {
      safeToSpendAtDecision: input.card.affordability.safeToSpendWithIncome,
      horizonImpacts: { ...input.card.horizonImpacts },
    },
    confidenceBps: input.card.confidence.bps,
    confidenceBand: input.card.confidence.band,
    userAction: input.userAction ?? 'pending',
    override: input.override ?? null,
    reviewDates: input.reviewDates ?? [],
    outcomes: [],
    netBenefitEstimate: input.netBenefitEstimate ?? null,
    learningProposal: null,
  };
}

/** Frozen core fields — a review must leave these byte-identical. */
const CORE_KEYS: (keyof DecisionRecord)[] = [
  'id',
  'createdAt',
  'question',
  'recommendation',
  'policyVersion',
  'dataSnapshotId',
  'forecast',
  'confidenceBps',
  'confidenceBand',
];

/**
 * Append an outcome at review time. Returns a NEW record; the original is untouched and
 * every core field is preserved (03 section 12: never rewrite a historical record). The
 * prediction error is computed here as actual − expected, both signed milliunits.
 */
export function reviewDecision(
  record: DecisionRecord,
  review: {
    reviewedAt: string;
    actualNetEffect: Money;
    expectedNetEffect: Money;
    attribution: DecisionOutcome['attribution'];
    note?: string;
    userAction?: DecisionAction;
  },
): DecisionRecord {
  const outcome: DecisionOutcome = {
    reviewedAt: review.reviewedAt,
    actualNetEffect: review.actualNetEffect,
    expectedNetEffect: review.expectedNetEffect,
    predictionError: sub(review.actualNetEffect, review.expectedNetEffect),
    attribution: review.attribution,
    note: review.note ?? '',
  };
  const next: DecisionRecord = {
    ...record,
    outcomes: [...record.outcomes, outcome],
    reviewDates: record.reviewDates.includes(review.reviewedAt)
      ? record.reviewDates
      : [...record.reviewDates, review.reviewedAt],
    userAction: review.userAction ?? record.userAction,
  };
  // Enforce immutability of the core (defence in depth — the spread above already keeps them).
  for (const k of CORE_KEYS) {
    if (JSON.stringify(next[k]) !== JSON.stringify(record[k])) {
      throw new Error(`NIZAM registry: review must not alter the immutable core field "${String(k)}"`);
    }
  }
  return next;
}

export interface ProposalVerdict {
  allowed: boolean;
  /** True when allowed but only after explicit owner approval + backtest. */
  requiresApproval: boolean;
  reason: string;
}

/**
 * The prohibition guard — contract 03 section 12 "Prohibited self-modification".
 * A proposal to reduce P0/P1 protection, raise risk beyond policy, grant payment
 * authority, use new sensitive data, rewrite records, or treat an explanation as fact is
 * REJECTED. The two allowed kinds (recalibrate confidence, adjust a statistical parameter)
 * pass, but a hard-policy change still requires approval before it may apply.
 */
export function guardLearningProposal(proposal: LearningProposal): ProposalVerdict {
  if ((PROHIBITED_PROPOSAL_KINDS as readonly string[]).includes(proposal.kind)) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Prohibited self-modification (${proposal.kind}) — the system may never do this silently.`,
    };
  }
  if (proposal.isHardPolicyChange) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: 'Allowed, but a hard-policy change requires explicit owner approval and a backtest before it applies.',
    };
  }
  return { allowed: true, requiresApproval: false, reason: 'Allowed — a soft recalibration inside existing policy.' };
}

/**
 * Attach a learning proposal to a record ONLY if the guard permits it. Returns the updated
 * record (proposal set) or throws when the proposal is prohibited — a prohibited change can
 * never be recorded as pending, let alone applied.
 */
export function proposeLearning(record: DecisionRecord, proposal: LearningProposal): DecisionRecord {
  const verdict = guardLearningProposal(proposal);
  if (!verdict.allowed) throw new Error(verdict.reason);
  return { ...record, learningProposal: proposal };
}

/** Decisions whose earliest review date has arrived (03 section 12 step 1: "select mature decisions"). */
export function matureDecisions(records: readonly DecisionRecord[], asOf: string): DecisionRecord[] {
  return records.filter(
    (r) => r.reviewDates.some((d) => d.localeCompare(asOf) <= 0) && r.outcomes.length === 0,
  );
}
