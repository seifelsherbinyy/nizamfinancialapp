// @vitest-environment node
/**
 * NIZAM · Envelope validation — the mint, the four absence rules, and both paths
 * Implemented by: PFOS Contract 12 / Phase 3.1 (spec 06-two-agent-vps)
 * Owning requirements: R7 (envelope validation), R10 (exclusion)
 * Depends on: ./envelopeValidation, ./envelopeSchema, ../ports/signalBus (types)
 *
 * Scope note for Phase 3.4, which owns the full negative battery: this file covers only this
 * MODULE's own contract — the mint, the four §4.3 refusals with their distinct reason codes,
 * the digest, and the difference between the write path and the read path. It does not exercise
 * consent scope or tier readability, which are Phase 3.2's, nor the bus store, which is 3.3's.
 *
 * The positive control comes first on purpose (T7): a guard that has only ever been observed
 * refusing is not evidence that it accepts the thing it should.
 */
import { describe, expect, it } from 'vitest';

import type { SignalPayload } from '../ports/signalBus.ts';
import { SIGNAL_NOTE_MAX_LENGTH } from '../ports/signalBus.ts';
import {
  portFailureCodeFor,
  sealSignalEnvelope,
  SIGNAL_VALIDATION_REASONS,
  SignalValidationError,
  unwrapSignalValidation,
  validateForRead,
  validateForWrite,
  validateSignalDraft,
  validateSignalNote,
  type SignalRefusal,
} from './envelopeValidation.ts';

/** A directional signal that breaks no rule. Every negative below is a mutation of this. */
const VALID_DRAFT: Readonly<Record<string, unknown>> = {
  signalId: 'sig-alpha',
  ts: '2026-08-06T09:00:00Z',
  producer: 'finance',
  kind: 'money_pressure',
  tier: 'money_safe',
  consentScope: 'producer_only',
  payload: { level: 'amber', direction: 'downshift' },
};

function draftWith(overrides: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { ...VALID_DRAFT, ...overrides };
}

function payloadWith(extra: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return draftWith({ payload: { level: 'amber', ...extra } });
}

function refusalOf(result: ReturnType<typeof validateForWrite> | ReturnType<typeof validateForRead>): SignalRefusal {
  if (result.ok) throw new Error('expected a refusal, and the guard accepted the input');
  return result.refusal;
}

describe('a valid directional signal is accepted and served as a level (T7, §4.2)', () => {
  it('accepts the draft and returns it rebuilt field by field', () => {
    const result = validateForWrite(VALID_DRAFT);
    expect(result.ok).toBe(true);
    const envelope = unwrapSignalValidation(result);
    expect(envelope.payload).toEqual({ level: 'amber', direction: 'downshift' });
    expect(envelope.producer).toBe('finance');
    expect(envelope.tier).toBe('money_safe');
  });

  it('accepts a level on its own, since direction and note are optional', () => {
    const result = validateForWrite(draftWith({ payload: { level: 'green' } }));
    expect(unwrapSignalValidation(result).payload).toEqual({ level: 'green' });
  });

  it('round-trips through the read path once sealed', () => {
    const written = unwrapSignalValidation(validateForWrite(VALID_DRAFT));
    expect(unwrapSignalValidation(validateForRead(written))).toEqual(written);
  });

  it('gives every reason a distinct port failure code family', () => {
    expect(new Set(SIGNAL_VALIDATION_REASONS).size).toBe(SIGNAL_VALIDATION_REASONS.length);
    expect(portFailureCodeFor('note_exceeds_cap')).toBe('SIGNAL_NOTE_EXCEEDS_CAP');
    expect(portFailureCodeFor('tier_not_a_member')).toBe('SIGNAL_TIER_NOT_A_MEMBER');
    expect(portFailureCodeFor('field_numeric')).toBe('SIGNAL_PAYLOAD_FIELD_FORBIDDEN');
    expect(portFailureCodeFor('ts_not_utc_instant')).toBe('SIGNAL_ENVELOPE_INVALID');
  });
});

describe('this module is the only mint for a note, and it refuses rather than truncates (§4.3.4, T10)', () => {
  it('mints a note at exactly the cap, so the boundary is inclusive', () => {
    const atCap = 'a'.repeat(SIGNAL_NOTE_MAX_LENGTH);
    const minted = validateSignalNote(atCap);
    expect(minted.ok).toBe(true);
    // The mint's output is what the branded field accepts. This assignment is the proof.
    const note: SignalPayload['note'] = unwrapSignalValidation(minted);
    expect(note).toHaveLength(SIGNAL_NOTE_MAX_LENGTH);
  });

  it('caps the note at the 120 characters R7 names, so the constant cannot drift off the requirement', () => {
    // Added by Phase 3.4. Every other assertion about the cap — here, in `schemaParity.test.ts`, in
    // the store's DDL check, and in the gate's output claims — is expressed RELATIVE to
    // SIGNAL_NOTE_MAX_LENGTH. So raising the constant would keep all of them green while violating
    // R7 and steering §4.3.3 ("any free text over 120 characters") outright. This is the one place
    // the requirement's own number is written down, which is what makes the others load-bearing.
    expect(SIGNAL_NOTE_MAX_LENGTH).toBe(120);
    expect(validateSignalNote('e'.repeat(120)).ok).toBe(true);
    expect(validateSignalNote('e'.repeat(121)).ok).toBe(false);
  });

  it('refuses one character over the cap, and returns no shortened form of it', () => {
    const overCap = 'b'.repeat(SIGNAL_NOTE_MAX_LENGTH + 1);
    const result = validateSignalNote(overCap);
    expect(result.ok).toBe(false);
    const refusal = result.ok ? null : result.refusal;
    expect(refusal?.reason).toBe('note_exceeds_cap');
    expect(refusal?.noteLength).toBe(SIGNAL_NOTE_MAX_LENGTH + 1);
    // Nothing on the refusal holds the text, in any length. §4.3.6: no quarantine.
    expect(JSON.stringify(refusal)).not.toContain('bbb');
  });

  it('refuses an over-cap note inside an envelope, and stores nothing shortened', () => {
    const refusal = refusalOf(validateForWrite(payloadWith({ note: 'c'.repeat(SIGNAL_NOTE_MAX_LENGTH + 40) })));
    expect(refusal.reason).toBe('note_exceeds_cap');
    expect(refusal.at).toBe('payload.note');
    expect(refusal.signalIdRef).toBe('sig-alpha');
    expect(refusal.noteLength).toBe(SIGNAL_NOTE_MAX_LENGTH + 40);
  });

  it('refuses a note that is not a string, and one that carries a digit', () => {
    expect(refusalOf(validateForWrite(payloadWith({ note: { text: 'soften' } }))).reason).toBe('note_not_a_string');
    // Architecture §1.5: finance publishes a pressure level, never "you owe 47,000".
    expect(refusalOf(validateForWrite(payloadWith({ note: 'owed 47000 across two cards' }))).reason).toBe(
      'note_carries_a_figure',
    );
  });

  it('cannot be bypassed: an unvalidated string is not assignable to the branded field', () => {
    // @ts-expect-error a plain string is not a SignalNote; this module's mint is the only source
    const note: SignalPayload['note'] = 'unvalidated narrative';
    expect(note).toBeDefined();
  });
});

describe('the four consent-by-absence rules refuse with distinct reasons (§4.3.1-§4.3.3, §4.3.5)', () => {
  it('refuses a payload field carrying a figure (T8)', () => {
    expect(refusalOf(validateForWrite(payloadWith({ balanceMilli: 47_000_000 }))).reason).toBe('field_numeric');
    // A permitted key handed a magnitude is the same rule, not a member-mismatch.
    const refusal = refusalOf(validateForWrite(draftWith({ payload: { level: 2 } })));
    expect(refusal.reason).toBe('field_numeric');
    expect(refusal.at).toBe('payload.level');
  });

  it('refuses a payload field carrying a date, whether by name or by value (T9)', () => {
    expect(refusalOf(validateForWrite(payloadWith({ dueDate: 'soon' }))).reason).toBe('field_temporal');
    expect(refusalOf(validateForWrite(payloadWith({ observed: '2026-09-01' }))).reason).toBe('field_temporal');
  });

  it('refuses a payload field carrying an identifier (T9)', () => {
    expect(refusalOf(validateForWrite(payloadWith({ accountRef: 'acct-one' }))).reason).toBe('field_identifier');
    expect(refusalOf(validateForWrite(payloadWith({ transactionUuid: 'x-y-z' }))).reason).toBe('field_identifier');
  });

  it('refuses an unrecognized payload field with no telling name (T11)', () => {
    const refusal = refusalOf(validateForWrite(payloadWith({ colour: 'teal' })));
    expect(refusal.reason).toBe('field_unrecognized');
    expect(refusal.at).toBe('payload.colour');
  });

  it('applies the same rules beside the payload, because a date there leaks just as well', () => {
    expect(refusalOf(validateForWrite(draftWith({ dueOn: '2026-09-01' }))).reason).toBe('field_temporal');
    expect(refusalOf(validateForWrite(draftWith({ outstandingMilli: 1 }))).reason).toBe('field_numeric');
    expect(refusalOf(validateForWrite(draftWith({ ledgerId: 'l' }))).reason).toBe('field_identifier');
  });

  it('carries no field for the refused value, so there is nothing to quarantine (§4.3.6)', () => {
    const refusal = refusalOf(validateForWrite(payloadWith({ balanceMilli: 47_000_000 })));
    expect(Object.keys(refusal).sort()).toEqual(['at', 'code', 'message', 'noteLength', 'reason', 'signalIdRef']);
    expect(JSON.stringify(refusal)).not.toContain('47000000');
  });
});

describe('the excluded classification is not a member, so a claim to it fails as unknown (R10, T15)', () => {
  it('refuses a tier outside the schema with its own reason', () => {
    // Assembled from fragments so this file never names the excluded classification contiguously.
    const excluded = 'strict_' + 'local_' + 'maximum';
    const refusal = refusalOf(validateForWrite(draftWith({ tier: excluded })));
    expect(refusal.reason).toBe('tier_not_a_member');
    expect(refusal.code).toBe('SIGNAL_TIER_NOT_A_MEMBER');
  });

  it('refuses an absent tier and a non-string tier the same way', () => {
    const { tier: _tier, ...withoutTier } = VALID_DRAFT;
    expect(refusalOf(validateForWrite(withoutTier)).reason).toBe('tier_not_a_member');
    expect(refusalOf(validateForWrite(draftWith({ tier: 1 }))).reason).toBe('tier_not_a_member');
  });
});

describe('every other enumerated field is checked against one vocabulary', () => {
  it('refuses a non-member producer, kind, scope, level and direction', () => {
    expect(refusalOf(validateForWrite(draftWith({ producer: 'router' }))).reason).toBe('producer_not_a_member');
    expect(refusalOf(validateForWrite(draftWith({ kind: 'mood' }))).reason).toBe('kind_not_a_member');
    expect(refusalOf(validateForWrite(draftWith({ consentScope: 'public' }))).reason).toBe('consent_scope_not_a_member');
    expect(refusalOf(validateForWrite(draftWith({ payload: { level: 'teal' } }))).reason).toBe('level_not_a_member');
    expect(refusalOf(validateForWrite(payloadWith({ direction: 'sideways' }))).reason).toBe('direction_not_a_member');
  });

  it('refuses an identifier that is empty or over length, and an ambiguous instant', () => {
    expect(refusalOf(validateForWrite(draftWith({ signalId: '' }))).reason).toBe('signal_id_invalid');
    expect(refusalOf(validateForWrite(draftWith({ signalId: 's'.repeat(129) }))).reason).toBe('signal_id_invalid');
    // An offset-bearing or millisecond-bearing instant is ambiguous, so it is refused.
    expect(refusalOf(validateForWrite(draftWith({ ts: '2026-08-06T09:00:00+02:00' }))).reason).toBe('ts_not_utc_instant');
    expect(refusalOf(validateForWrite(draftWith({ ts: '2026-08-06' }))).reason).toBe('ts_not_utc_instant');
  });

  it('refuses a missing required field and a payload that is not an object', () => {
    const { producer: _producer, ...withoutProducer } = VALID_DRAFT;
    const missing = refusalOf(validateForWrite(withoutProducer));
    expect(missing.reason).toBe('envelope_field_missing');
    expect(missing.at).toBe('producer');
    expect(refusalOf(validateForWrite(draftWith({ payload: 'amber' }))).reason).toBe('payload_not_an_object');
    expect(refusalOf(validateForWrite(draftWith({ payload: ['amber'] }))).reason).toBe('payload_not_an_object');
  });
});

describe('integrity is the bus\u2019s claim, not the producer\u2019s (§4.2)', () => {
  it('refuses a producer that asserts its own digest', () => {
    const refusal = refusalOf(validateForWrite(draftWith({ hash: 'f'.repeat(64) })));
    expect(refusal.reason).toBe('hash_asserted_by_producer');
    expect(refusal.at).toBe('hash');
  });

  it('computes a lowercase sha256 digest that changes when the payload does', () => {
    const first = unwrapSignalValidation(validateForWrite(VALID_DRAFT));
    const second = unwrapSignalValidation(validateForWrite(draftWith({ payload: { level: 'red', direction: 'downshift' } })));
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.hash).not.toBe(first.hash);
    // Deterministic: the same envelope always seals to the same digest.
    expect(unwrapSignalValidation(validateForWrite(VALID_DRAFT)).hash).toBe(first.hash);
  });

  it('distinguishes an absent optional from an empty one, so two envelopes cannot collide', () => {
    const noNote = unwrapSignalValidation(validateForWrite(draftWith({ payload: { level: 'amber' } })));
    const emptyNote = unwrapSignalValidation(validateForWrite(draftWith({ payload: { level: 'amber', note: '' } })));
    expect(emptyNote.hash).not.toBe(noNote.hash);
  });
});

describe('the read path re-validates from scratch, it does not trust the write (§4.2)', () => {
  const sealed = unwrapSignalValidation(validateForWrite(VALID_DRAFT));

  it('refuses a stored row with no digest, rather than reading absence as unverified-but-fine', () => {
    const { hash: _hash, ...withoutHash } = sealed;
    expect(refusalOf(validateForRead(withoutHash)).reason).toBe('hash_missing');
  });

  it('refuses a malformed digest and one that does not cover the row', () => {
    expect(refusalOf(validateForRead({ ...sealed, hash: 'NOTAHASH' })).reason).toBe('hash_malformed');
    expect(refusalOf(validateForRead({ ...sealed, payload: { level: 'green', direction: 'downshift' } })).reason).toBe(
      'hash_mismatch',
    );
  });

  it('re-runs the field rules, so a row a widened schema once accepted is still refused now', () => {
    // Sealed over the clean payload, then a forbidden field added beside it. The digest still
    // covers what it covered, which is exactly why write-path validation alone is insufficient.
    const tampered = { ...sealed, payload: { ...sealed.payload, balanceMilli: 47_000_000 } };
    const refusal = refusalOf(validateForRead(tampered));
    expect(refusal.reason).toBe('field_numeric');
    expect(refusal.at).toBe('payload.balanceMilli');
  });

  it('refuses a stored over-cap note on read, not only on write', () => {
    const overCap = { ...sealed, payload: { level: 'amber', note: 'd'.repeat(SIGNAL_NOTE_MAX_LENGTH + 1) } };
    expect(refusalOf(validateForRead(overCap)).reason).toBe('note_exceeds_cap');
  });

  it('refuses a draft on the read path, because a draft has no digest to check', () => {
    expect(refusalOf(validateForRead(VALID_DRAFT)).reason).toBe('hash_missing');
  });

  it('refuses a sealed envelope on the write path, because the producer would be asserting it', () => {
    expect(refusalOf(validateForWrite(sealed)).reason).toBe('hash_asserted_by_producer');
  });
});

describe('an unparseable or unrecognized input is a refusal, never a pass-through', () => {
  it('refuses every non-object input on both paths', () => {
    const inputs: readonly unknown[] = [null, undefined, 'money_pressure', 42, true, [], ['level'], () => 'amber'];
    for (const input of inputs) {
      expect(refusalOf(validateForWrite(input)).reason).toBe('envelope_not_an_object');
      expect(refusalOf(validateForRead(input)).reason).toBe('envelope_not_an_object');
      expect(validateSignalDraft(input).ok).toBe(false);
    }
  });

  it('throws a discriminable error when a caller would rather not branch', () => {
    try {
      unwrapSignalValidation(validateForWrite(null));
      throw new Error('the guard accepted a null envelope');
    } catch (error) {
      expect(error).toBeInstanceOf(SignalValidationError);
      const failure = error as SignalValidationError;
      expect(failure.reason).toBe('envelope_not_an_object');
      expect(failure.code).toBe('SIGNAL_ENVELOPE_INVALID');
    }
  });

  it('seals only what was validated, so a sealed envelope never carries a surplus field', () => {
    const envelope = sealSignalEnvelope(unwrapSignalValidation(validateSignalDraft(VALID_DRAFT)));
    expect(Object.keys(envelope).sort()).toEqual([
      'consentScope',
      'hash',
      'kind',
      'payload',
      'producer',
      'signalId',
      'tier',
      'ts',
    ]);
  });
});
