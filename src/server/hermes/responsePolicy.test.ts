/**
 * Focused response policy tests.
 * Owning authority: PFOS Contract 06, Contract 10, Contract 12, and Contract 13.
 * Phase: Phase 2.5 refined Hermes integration.
 * Depends on: responsePolicy.ts and knowledgeBoundary.ts.
 */
import { describe, expect, it } from 'vitest';
import { buildGroundedContext, type EvidenceItem } from './knowledgeBoundary.ts';
import { renderFocusedResponse, validateFocusedResponse, type FocusedResponseDraft } from './responsePolicy.ts';

const evidence: EvidenceItem = {
  sourceRef: 'source-ref',
  sourceLabel: 'Synthetic financial source',
  contentHash: 'a'.repeat(64),
  versionRef: 'version-1',
  observedAt: '2026-08-16T10:00:00Z',
  domain: 'financial',
  privacyClass: 'cloud_allowed',
  confidence: 'high',
  content: 'Synthetic validated financial evidence.',
};

function draft(overrides: Partial<FocusedResponseDraft> = {}): FocusedResponseDraft {
  return {
    profile: 'pfos',
    answer: 'The deterministic engine reports the requested result.',
    citations: [{ sourceRef: 'source-ref', sourceLabel: 'Synthetic financial source', versionRef: 'version-1', observedAt: '2026-08-16T10:00:00Z' }],
    confidence: 'high',
    unknowns: [],
    deterministicBasis: true,
    requiresOwnerConfirmation: false,
    ...overrides,
  };
}

describe('focused grounded responses', () => {
  it('accepts a cited response with a deterministic financial basis', () => {
    const context = buildGroundedContext('pfos', [evidence]);
    const verdict = validateFocusedResponse(draft(), context);
    expect(verdict.accepted).toBe(true);
    if (verdict.accepted) expect(renderFocusedResponse(verdict.response)).toContain('Basis:');
  });

  it('refuses financial numbers that do not come from a deterministic basis', () => {
    const context = buildGroundedContext('pfos', [evidence]);
    const verdict = validateFocusedResponse(draft({ answer: 'The answer is 42.', deterministicBasis: false }), context);
    expect(verdict).toEqual({ accepted: false, reason: 'RESPONSE_FINANCIAL_NUMBER_NOT_DETERMINISTIC' });
  });

  it('refuses citations that were not in the retrieved context', () => {
    const context = buildGroundedContext('pfos', [evidence]);
    const verdict = validateFocusedResponse(
      draft({ citations: [{ sourceRef: 'other', sourceLabel: 'Other', versionRef: 'version-1', observedAt: '2026-08-16T10:00:00Z' }] }),
      context,
    );
    expect(verdict).toEqual({ accepted: false, reason: 'RESPONSE_SOURCE_NOT_IN_CONTEXT' });
  });
});
