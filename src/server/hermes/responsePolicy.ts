/**
 * Focused, source-grounded response policy for Hermes.
 * Owning authority: PFOS Contract 06, Contract 10, Contract 12, and Contract 13, money rules, and validated evidence policy.
 * Phase: Phase 2.5 refined Hermes integration.
 * Depends on: ./knowledgeBoundary.
 * Model output is untrusted text and never becomes financial truth through this module.
 */
import type { HermesProfileName } from './profilePolicy.ts';
import type { EvidenceCitation, GroundedContext } from './knowledgeBoundary.ts';

export const RESPONSE_CONFIDENCE = ['high', 'medium', 'low', 'unknown'] as const;
export type ResponseConfidence = (typeof RESPONSE_CONFIDENCE)[number];

export interface FocusedResponseDraft {
  readonly profile: HermesProfileName;
  readonly answer: string;
  readonly citations: readonly EvidenceCitation[];
  readonly confidence: ResponseConfidence;
  readonly unknowns: readonly string[];
  readonly deterministicBasis: boolean;
  readonly requiresOwnerConfirmation: boolean;
}

export type ResponseVerdict =
  | { readonly accepted: true; readonly response: FocusedResponseDraft }
  | { readonly accepted: false; readonly reason: string };

function hasDigits(value: string): boolean {
  return /\d/.test(value);
}

function citationKey(citation: EvidenceCitation): string {
  return `${citation.sourceRef}\u0000${citation.versionRef}`;
}

export function validateFocusedResponse(draft: FocusedResponseDraft, context: GroundedContext): ResponseVerdict {
  if (draft.profile !== context.profile) return { accepted: false, reason: 'RESPONSE_PROFILE_MISMATCH' };
  if (draft.answer.trim() === '') return { accepted: false, reason: 'RESPONSE_ANSWER_EMPTY' };
  if (draft.answer.length > 4_000) return { accepted: false, reason: 'RESPONSE_TOO_LONG' };
  if (!RESPONSE_CONFIDENCE.includes(draft.confidence)) return { accepted: false, reason: 'RESPONSE_CONFIDENCE_INVALID' };
  if (draft.unknowns.some((item) => item.trim() === '')) return { accepted: false, reason: 'RESPONSE_UNKNOWN_EMPTY' };

  const available = new Set(context.citations.map(citationKey));
  if (draft.citations.length === 0 && context.evidence.length > 0) {
    return { accepted: false, reason: 'RESPONSE_SOURCE_BASIS_MISSING' };
  }
  if (draft.citations.some((citation) => !available.has(citationKey(citation)))) {
    return { accepted: false, reason: 'RESPONSE_SOURCE_NOT_IN_CONTEXT' };
  }
  if (draft.profile === 'pfos' && hasDigits(draft.answer) && !draft.deterministicBasis) {
    return { accepted: false, reason: 'RESPONSE_FINANCIAL_NUMBER_NOT_DETERMINISTIC' };
  }
  if (context.localOnlyCount > 0 && draft.profile === 'pfos') {
    return { accepted: false, reason: 'RESPONSE_PRIVATE_CONTEXT_NOT_ALLOWED_FOR_PFOS' };
  }
  return { accepted: true, response: draft };
}

export function renderFocusedResponse(draft: FocusedResponseDraft): string {
  const unknowns = draft.unknowns.length === 0 ? 'None stated.' : draft.unknowns.join('; ');
  const sources = draft.citations.length === 0
    ? 'No validated source was available.'
    : draft.citations.map((citation) => `${citation.sourceLabel} (${citation.observedAt})`).join('; ');
  const action = draft.requiresOwnerConfirmation ? 'Owner confirmation required.' : 'No owner confirmation required.';
  return [
    draft.answer.trim(),
    `Basis: ${sources}`,
    `Confidence: ${draft.confidence}`,
    `Unknowns: ${unknowns}`,
    `Action: ${action}`,
  ].join('\n');
}
