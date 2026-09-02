/**
 * UPOI task 4.4 Hermes/provenance contract tests.
 * Owning contract: PFOS Contract 12; UPOI task 4.4; PFOS Contracts 05, 06, and 13.
 * Phase: Phase 4.4 offline capability, locality, readiness, and explanation boundaries.
 * Depends on: runtimeAdapter.ts, knowledgeBoundary.ts, and responsePolicy.ts.
 * All fixtures are synthetic; this file never contacts a provider or network.
 */
import { describe, expect, it } from 'vitest';
import {
  createHermesRuntimeAdapter,
  HermesRuntimeError,
  type HermesGrantVerifier,
  type HermesToolGrant,
} from './runtimeAdapter.ts';
import { buildGroundedContext, type EvidenceItem } from './knowledgeBoundary.ts';
import { renderFocusedResponse, validateFocusedResponse, type FocusedResponseDraft } from './responsePolicy.ts';

const NOW = '2026-08-16T10:00:00Z';
const LATER = '2026-08-16T11:00:00Z';
const HASH = 'a'.repeat(64);

function grant(overrides: Partial<HermesToolGrant> = {}): HermesToolGrant {
  return {
    profile: 'pfos',
    tool: 'nizamcore.read_recovery_state',
    grantRef: 'synthetic-grant-44',
    scope: { requestRef: 'synthetic-turn-44' },
    expiresAt: LATER,
    issuedBy: 'governance',
    ...overrides,
  };
}

function verifier(): HermesGrantVerifier {
  return { verify: () => true };
}

function evidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    sourceRef: 'synthetic/pfos-result.json',
    sourceLabel: 'Synthetic PFOS result',
    contentHash: HASH,
    versionRef: 'deterministic-result-v1',
    observedAt: NOW,
    domain: 'financial',
    privacyClass: 'cloud_allowed',
    confidence: 'high',
    content: 'Synthetic deterministic result reference.',
    ...overrides,
  };
}

function response(overrides: Partial<FocusedResponseDraft> = {}): FocusedResponseDraft {
  return {
    profile: 'pfos',
    answer: 'This is a non-authoritative explanation of the deterministic result.',
    citations: [{ sourceRef: 'synthetic/pfos-result.json', sourceLabel: 'Synthetic PFOS result', versionRef: 'deterministic-result-v1', observedAt: NOW }],
    confidence: 'high',
    unknowns: [],
    deterministicBasis: false,
    requiresOwnerConfirmation: false,
    ...overrides,
  };
}

async function errorCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(HermesRuntimeError);
    return (error as HermesRuntimeError).code;
  }
  throw new Error('expected HermesRuntimeError');
}

describe('UPOI task 4.4 Hermes and provenance contracts', () => {
  it('denies a profile capability even when governance supplies a valid cross-profile grant', async () => {
    const adapter = createHermesRuntimeAdapter({
      grantVerifier: verifier(),
      executors: {},
      now: () => NOW,
    });

    await expect(
      errorCode(() => adapter.invoke('pfos', grant(), { requestRef: 'synthetic-turn-44', payload: {} })),
    ).resolves.toBe('HERMES_TOOL_NOT_ALLOWED');
  });

  it('keeps restricted context provider-ineligible and refuses PFOS egress', () => {
    const restrictedContext = buildGroundedContext('nizam', [evidence({ privacyClass: 'local_only' })]);
    expect(restrictedContext.localOnlyCount).toBe(1);
    expect(restrictedContext.modelEligible).toBe(false);

    const pfosContext = buildGroundedContext('pfos', [evidence({ privacyClass: 'local_only' })]);
    expect(validateFocusedResponse(response(), pfosContext)).toEqual({
      accepted: false,
      reason: 'RESPONSE_PRIVATE_CONTEXT_NOT_ALLOWED_FOR_PFOS',
    });
  });

  it.each(['BUILT', 'INSTALLED', 'RUNNING', 'VERIFIED', 'SYNCED'] as const)(
    'reports %s distinctly instead of inferring another readiness state',
    (state) => {
      const adapter = createHermesRuntimeAdapter({
        grantVerifier: verifier(),
        executors: {},
        now: () => NOW,
        readiness: { nizam: state },
      });
      expect(adapter.readiness('nizam')).toMatchObject({
        profile: 'nizam',
        state,
        executionOnly: true,
        configuredExecutorCount: 0,
      });
    },
  );

  it('accepts only a cited, nonnumeric model explanation and keeps the deterministic result authoritative', () => {
    const context = buildGroundedContext('pfos', [evidence()]);
    const verdict = validateFocusedResponse(response(), context);

    expect(verdict).toMatchObject({ accepted: true });
    if (verdict.accepted) {
      expect(verdict.response.deterministicBasis).toBe(false);
      expect(verdict.response.citations[0]?.versionRef).toBe('deterministic-result-v1');
      expect(renderFocusedResponse(verdict.response)).toContain('Basis: Synthetic PFOS result');
    }
    expect(validateFocusedResponse(response({ answer: 'The result is 1000 milliunits.', deterministicBasis: false }), context)).toEqual({
      accepted: false,
      reason: 'RESPONSE_FINANCIAL_NUMBER_NOT_DETERMINISTIC',
    });
  });
});
