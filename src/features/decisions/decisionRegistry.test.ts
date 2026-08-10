// @vitest-environment node
/**
 * NIZAM · Decision Outcome Registry tests — immutability + the prohibition guard.
 * Owning contract: PFOS contract 03 (Decision Engine) section 12.
 * Build phase: PFOS Stage 3, phase 3.1 — registry create/review/guard.
 */
import { describe, it, expect } from 'vitest';
import type { DecisionCard } from './decision.types.ts';
import type { LearningProposal, DecisionRecord } from './decisionRecord.types.ts';
import { PROHIBITED_PROPOSAL_KINDS, ALLOWED_PROPOSAL_KINDS } from './decisionRecord.types.ts';
import {
  recordDecision,
  reviewDecision,
  guardLearningProposal,
  proposeLearning,
  matureDecisions,
} from './decisionRegistry.ts';

const M = 1000;

function card(): DecisionCard {
  return {
    recommendation: 'approve',
    reason: 'fits',
    immediateEffect: 'removes cash',
    nextDayEffect: 'ok',
    oneWeekEffect: 'ok',
    oneMonthEffect: 'ok',
    oneYearEffect: 'trajectory unchanged',
    evidence: ['e1'],
    alternative: null,
    confidence: { bps: 8500, band: 'evidenced', missingInformation: [] },
    requiredAction: 'buy',
    horizonImpacts: { next_day: 'a', next_week: 'b', next_month: 'c', next_year: 'd' },
    affordability: {
      price: 3_000 * M,
      safeToSpendWithIncome: 10_000 * M,
      safeToSpendInHand: 10_000 * M,
      remainingInHand: 7_000 * M,
      remainingWithIncome: 7_000 * M,
      reliesOnExpectedIncome: false,
      affordableCap: 10_000 * M,
    },
  };
}

function baseRecord(): DecisionRecord {
  return recordDecision({
    id: 'dec_1',
    createdAt: '2026-01-10T00:00:00.000Z',
    question: 'Buy the thing?',
    card: card(),
    policyVersion: 3,
    dataSnapshotId: 'snap_abc',
    reviewDates: ['2026-02-10'],
    netBenefitEstimate: 500 * M,
  });
}

describe('recordDecision', () => {
  it('freezes the recommendation, forecast and confidence from the card', () => {
    const r = baseRecord();
    expect(r.recommendation).toBe('approve');
    expect(r.forecast.safeToSpendAtDecision).toBe(10_000 * M);
    expect(r.forecast.horizonImpacts.next_month).toBe('c');
    expect(r.confidenceBps).toBe(8500);
    expect(r.confidenceBand).toBe('evidenced');
    expect(r.userAction).toBe('pending');
    expect(r.outcomes).toEqual([]);
  });
});

describe('reviewDecision', () => {
  it('appends an outcome and computes prediction error = actual − expected', () => {
    const r = baseRecord();
    const reviewed = reviewDecision(r, {
      reviewedAt: '2026-02-10',
      actualNetEffect: 300 * M,
      expectedNetEffect: 500 * M,
      attribution: 'behavior',
      note: 'spent more than planned',
    });
    expect(reviewed.outcomes).toHaveLength(1);
    expect(reviewed.outcomes[0]!.predictionError).toBe(-200 * M);
    expect(reviewed.userAction).toBe('pending');
    // original record is untouched (append-only)
    expect(r.outcomes).toHaveLength(0);
  });

  it('never rewrites the immutable core', () => {
    const r = baseRecord();
    const reviewed = reviewDecision(r, {
      reviewedAt: '2026-02-10',
      actualNetEffect: 0,
      expectedNetEffect: 0,
      attribution: 'data',
    });
    expect(reviewed.id).toBe(r.id);
    expect(reviewed.recommendation).toBe(r.recommendation);
    expect(reviewed.forecast).toEqual(r.forecast);
    expect(reviewed.confidenceBps).toBe(r.confidenceBps);
  });

  it('does not duplicate an already-scheduled review date', () => {
    const r = baseRecord();
    const reviewed = reviewDecision(r, {
      reviewedAt: '2026-02-10', // already in reviewDates
      actualNetEffect: 0,
      expectedNetEffect: 0,
      attribution: 'data',
    });
    expect(reviewed.reviewDates).toEqual(['2026-02-10']);
  });
});

describe('guardLearningProposal (prohibited self-modification)', () => {
  it('rejects every one of the six prohibited kinds', () => {
    for (const kind of PROHIBITED_PROPOSAL_KINDS) {
      const p: LearningProposal = { kind, description: 'x', isHardPolicyChange: false };
      const v = guardLearningProposal(p);
      expect(v.allowed).toBe(false);
      expect(v.reason).toMatch(/prohibited/i);
    }
  });

  it('allows a soft recalibration without approval', () => {
    const p: LearningProposal = { kind: 'recalibrate_confidence', description: 'x', isHardPolicyChange: false };
    const v = guardLearningProposal(p);
    expect(v.allowed).toBe(true);
    expect(v.requiresApproval).toBe(false);
  });

  it('allows an adjust but requires approval when it is a hard-policy change', () => {
    for (const kind of ALLOWED_PROPOSAL_KINDS) {
      const p: LearningProposal = { kind, description: 'x', isHardPolicyChange: true };
      const v = guardLearningProposal(p);
      expect(v.allowed).toBe(true);
      expect(v.requiresApproval).toBe(true);
    }
  });
});

describe('proposeLearning', () => {
  it('attaches an allowed proposal', () => {
    const r = proposeLearning(baseRecord(), { kind: 'recalibrate_confidence', description: 'tighten', isHardPolicyChange: false });
    expect(r.learningProposal?.kind).toBe('recalibrate_confidence');
  });
  it('throws on a prohibited proposal — it can never even be recorded', () => {
    expect(() =>
      proposeLearning(baseRecord(), { kind: 'reduce_p0_p1_protection', description: 'nope', isHardPolicyChange: true }),
    ).toThrow(/prohibited/i);
  });
});

describe('matureDecisions', () => {
  it('selects unreviewed decisions whose review date has arrived', () => {
    const r = baseRecord();
    expect(matureDecisions([r], '2026-02-11').map((d) => d.id)).toEqual(['dec_1']);
    expect(matureDecisions([r], '2026-01-15')).toEqual([]); // review date not yet reached
    const reviewed = reviewDecision(r, { reviewedAt: '2026-02-10', actualNetEffect: 0, expectedNetEffect: 0, attribution: 'data' });
    expect(matureDecisions([reviewed], '2026-02-11')).toEqual([]); // already reviewed
  });
});
