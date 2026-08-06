/**
 * NIZAM - PFOS benchmark harness (M2): L0/L1/L2 eligibility gate tests.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration).
 * Build phase: PFOS Stage 7, phase 7.1 - benchmark harness (offline).
 * Depends on: eligibility, benchmark.types.
 */
import { describe, it, expect } from 'vitest';
import { evaluateEligibility } from './eligibility';
import { type BenchmarkCategory, type CaseScore, type Severity } from './benchmark.types';

function cs(over: Partial<CaseScore> & { category: BenchmarkCategory; severity: Severity }): CaseScore {
  return {
    caseId: 'c',
    tier: 'T1',
    metric: 1,
    passed: true,
    hardRuleViolations: 0,
    schemaValid: true,
    criticalFieldAccuracy: 1,
    evidenceCoverage: 1,
    latencyMs: 1,
    costUsd: 0,
    ...over,
  };
}

function perfectSet(): CaseScore[] {
  return [
    cs({ caseId: 's1', category: 'sms_extraction', severity: 'P0' }),
    cs({ caseId: 's2', category: 'sms_extraction', severity: 'P0' }),
    cs({ caseId: 'cl', category: 'classification', severity: 'P2' }),
    cs({ caseId: 'dd', category: 'dedup', severity: 'P1' }),
    cs({ caseId: 'sts', category: 'safe_to_spend_explanation', severity: 'P1' }),
    cs({ caseId: 'pd', category: 'purchase_decision', severity: 'P0' }),
    cs({ caseId: 'fc', category: 'forecast', severity: 'P1' }),
    cs({ caseId: 'tl', category: 'tool_call', severity: 'P1' }),
    cs({ caseId: 'ml', category: 'multilingual', severity: 'P0' }),
    cs({ caseId: 'adv', category: 'adversarial', severity: 'P0' }),
  ];
}

describe('evaluateEligibility', () => {
  it('promotes a clean model to L0, L1, and L2', () => {
    const e = evaluateEligibility('m', perfectSet());
    expect(e.disqualified).toBe(false);
    expect(e.levels).toEqual({ L0: true, L1: true, L2: true });
  });

  it('fails L0 when extraction critical-field accuracy is below 0.99 (L1 may still hold)', () => {
    const set = perfectSet().map((s) =>
      s.caseId === 's1'
        ? cs({ caseId: 's1', category: 'sms_extraction', severity: 'P0', criticalFieldAccuracy: 0.5, metric: 0, passed: false })
        : s,
    );
    const e = evaluateEligibility('m', set);
    expect(e.levels.L0).toBe(false);
    expect(e.levels.L1).toBe(true);
    expect(e.disqualified).toBe(false);
  });

  it('disqualifies (all levels false) on a P0 hard-rule violation', () => {
    const set = perfectSet().map((s) =>
      s.caseId === 'pd'
        ? cs({ caseId: 'pd', category: 'purchase_decision', severity: 'P0', hardRuleViolations: 1, metric: 0, passed: false })
        : s,
    );
    const e = evaluateEligibility('m', set);
    expect(e.disqualified).toBe(true);
    expect(e.levels).toEqual({ L0: false, L1: false, L2: false });
  });

  it('disqualifies on an unauthorized tool action', () => {
    const set = perfectSet().map((s) =>
      s.caseId === 'tl'
        ? cs({ caseId: 'tl', category: 'tool_call', severity: 'P1', hardRuleViolations: 1, metric: 0, passed: false })
        : s,
    );
    const e = evaluateEligibility('m', set);
    expect(e.disqualified).toBe(true);
  });

  it('denies L2 when reviewer disagreement exceeds the threshold', () => {
    const e = evaluateEligibility('m', perfectSet(), { reviewerDisagreementBps: 2000 });
    expect(e.levels.L2).toBe(false);
    expect(e.levels.L1).toBe(true);
    expect(e.levels.L0).toBe(true);
  });
});
