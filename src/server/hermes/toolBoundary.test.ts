/**
 * Governed Hermes tool boundary tests.
 * Owning authority: PFOS Contract 06, Contract 12, and Contract 13.
 * Phase: Phase 2.5 refined Hermes integration.
 * Depends on: toolBoundary.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  HERMES_TOOLS_BY_PROFILE,
  assertDeterministicFinancialResult,
  assertHermesToolAllowed,
  isHermesToolAllowed,
  type FinancialAnalysisResult,
} from './toolBoundary.ts';

describe('Hermes tool boundary', () => {
  it('keeps NIZAMCORE and PFOS capabilities separated', () => {
    expect(isHermesToolAllowed('nizam', 'nizamcore.read_journal_context')).toBe(true);
    expect(isHermesToolAllowed('nizam', 'pfos.run_deterministic_analysis')).toBe(false);
    expect(isHermesToolAllowed('pfos', 'pfos.run_deterministic_analysis')).toBe(true);
    expect(isHermesToolAllowed('pfos', 'nizamcore.read_journal_context')).toBe(false);
    expect(HERMES_TOOLS_BY_PROFILE.nizam).not.toContain('pfos.read_financial_snapshot');
  });

  it('refuses an unallowed tool call', () => {
    expect(() => assertHermesToolAllowed('pfos', 'nizamcore.read_recovery_state')).toThrow('HERMES_TOOL_NOT_ALLOWED');
  });

  it('requires financial facts to be deterministic integer milliunits', () => {
    const result: FinancialAnalysisResult = {
      resultRef: 'result-ref',
      facts: [
        {
          factRef: 'fact-ref',
          label: 'Synthetic total',
          amountMilliunits: 1250,
          currency: 'EGP',
          computedAt: '2026-08-16T10:00:00Z',
          deterministicEngine: true,
        },
      ],
      explanation: 'Synthetic deterministic result.',
      deterministicEngine: true,
    };
    expect(() => assertDeterministicFinancialResult(result)).not.toThrow();
    expect(() =>
      assertDeterministicFinancialResult({ ...result, deterministicEngine: false } as unknown as FinancialAnalysisResult),
    ).toThrow('PFOS_RESULT_NOT_DETERMINISTIC');
    expect(() =>
      assertDeterministicFinancialResult({
        ...result,
        facts: [{ ...result.facts[0]!, amountMilliunits: 1.5 }],
      }),
    ).toThrow('PFOS_FACT_MILLIUNITS_INVALID');
  });
});
