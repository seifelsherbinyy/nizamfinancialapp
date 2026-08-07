/**
 * NIZAM · Envelope validation — the only mint for a note, and the same rules on write and read
 * Implemented by: PFOS Contract 12 / Phase 3.1 (spec 06-two-agent-vps)
 * Owning requirements: R7 (envelope validation), R10 (exclusion)
 * Depends on: ./envelopeSchema, ../ports/signalBus (types), ../ports/errors (failure codes),
 *   node:crypto for the integrity digest
 *
 * Phase 2.1 made the forbidden shape impossible to *write down*: `SignalPayload` has exactly
 * three keys, a level is an enum, and `note` is a branded type nobody could construct. Phase
 * 2.1's build log recorded the consequence honestly — the branded note had no mint, so the
 * field was unreachable by anyone. **This module is that mint**, and it is the only one. A note
 * exists because validation measured it, or it does not exist.
 *
 * This lives in `src/server/signals/` rather than `src/server/ports/` because
 * `ports/interfaceOnly.test.ts` asserts that directory declares no implementation, and this is
 * one. Phase 2.2 set the precedent with `mocks/`; a validator is a sibling, not a port.
 *
 * Five properties worth stating, because each is a rule that would otherwise be a convention:
 *
 *  1. **Validation runs on WRITE and again on READ (§4.2).** {@link validateForWrite} and
 *     {@link validateForRead} apply the *same* field rules; they differ only in what they say
 *     about `hash`. Write-path validation alone is insufficient: a schema change must not
 *     silently make a historical row readable in a shape the current consent rules forbid, so
 *     a stored envelope is re-validated from scratch every time it is served, never trusted
 *     because it passed once.
 *  2. **An over-cap note is REFUSED, not truncated (§4.3.4).** Truncation would ship the first
 *     {@link SIGNAL_NOTE_MAX_LENGTH} characters of something that was never allowed to leave.
 *     There is no code path here that shortens a note, and no export that returns one.
 *  3. **Every rule has its own reason code.** `additionalProperties` false makes a balance
 *     field and a due-date field both "not in the schema", but an operator reading an audit
 *     line learns far more from `field_temporal` than from `field_unrecognized`, so the
 *     classifier keeps the four §4.3 rules discriminable (§4.3.1-§4.3.3, §4.3.5).
 *  4. **A producer cannot assert its own integrity claim (§4.2).** On the write path `hash` is
 *     a forbidden field with its own reason; the digest is computed here, over
 *     `ts + producer + kind + payload`, and on the read path it is recomputed and compared.
 *  5. **It FAILS CLOSED.** `null`, `undefined`, a string, an array, a number, a class instance
 *     with the right-looking keys — every unrecognized input is a refusal. Nothing is passed
 *     through, coerced, defaulted, or repaired.
 *
 * {@link SignalRefusal} *is* the audit record §4.3.6 asks for: a refused signal is refused and
 * audited, never parked in a quarantine table, because that table would be exactly the leak the
 * schema prevents. So the refusal has no field for the rejected value — no `value`, no
 * `payload`, no `received`. It carries the reason, the path, the producer's own identifier, and
 * the *length* of a note. A field that does not exist cannot be populated later by a call site
 * that means well.
 *
 * No money appears on this boundary, and none can: the payload has no numeric field, so
 * `src/lib/money` is neither imported nor needed here.
 */
import { createHash } from 'node:crypto';

import type { PortFailureCode } from '../ports/errors';
import type {
  ConsentScope,
  SignalDirection,
  SignalDraft,
  SignalEnvelope,
  SignalKind,
  SignalLevel,
  SignalNote,
  SignalPayload,
  SignalProducer,
  SignalTier,
} from '../ports/signalBus';
import {
  CONSENT_SCOPES,
  DATE_SHAPED_VALUE,
  DIGIT_IN_TEXT,
  DRAFT_ENVELOPE_KEYS,
  fieldNameTokens,
  IDENTIFIER_FIELD_TOKENS,
  PERMITTED_PAYLOAD_KEYS,
  SIGNAL_DIRECTIONS,
  SIGNAL_HASH_ALGORITHM,
  SIGNAL_HASH_PATTERN,
  SIGNAL_ID_MAX_LENGTH,
  SIGNAL_KINDS,
  SIGNAL_LEVELS,
  SIGNAL_NOTE_MAX_LENGTH,
  SIGNAL_PRODUCERS,
  SIGNAL_TIERS,
  STORED_ENVELOPE_KEYS,
  TEMPORAL_FIELD_TOKENS,
  UTC_INSTANT,
} from './envelopeSchema';

/**
 * Why an envelope was refused. One member per binding rule, so a caller — and an operator
 * reading the audit mirror — learns WHICH gate fired rather than only that something did.
 */
export const SIGNAL_VALIDATION_REASONS = [
  // Shape.
  'envelope_not_an_object',
  'envelope_field_missing',
  'payload_not_an_object',
  // §4.3.1-§4.3.3, §4.3.5 — the four consent-by-absence rules, kept distinct.
  'field_numeric',
  'field_temporal',
  'field_identifier',
  'field_unrecognized',
  // Enumerated members.
  'signal_id_invalid',
  'ts_not_utc_instant',
  'producer_not_a_member',
  'kind_not_a_member',
  'tier_not_a_member',
  'consent_scope_not_a_member',
  'level_not_a_member',
  'direction_not_a_member',
  // §4.3.4 — the note, capped by the schema and refused rather than truncated.
  'note_not_a_string',
  'note_exceeds_cap',
  'note_carries_a_figure',
  // §4.2 — integrity is the bus's claim, not the producer's.
  'hash_asserted_by_producer',
  'hash_missing',
  'hash_malformed',
  'hash_mismatch',
] as const;

export type SignalValidationReason = (typeof SIGNAL_VALIDATION_REASONS)[number];

/**
 * A refusal, and the audit line for it. Note what it has no field for: the offending value.
 * See the module note — §4.3.6 forbids a quarantine, so nothing here retains what was refused.
 */
export interface SignalRefusal {
  readonly reason: SignalValidationReason;
  /** Where the rule fired, e.g. `payload.balanceMilli`. A path, never a value. */
  readonly at: string;
  /** The port-level code a bus adapter surfaces to its caller. */
  readonly code: PortFailureCode;
  /** The producer's own identifier, when the input carried a usable one. */
  readonly signalIdRef: string | null;
  /** How long a note was, when one was present as a string. A measurement, not the text. */
  readonly noteLength: number | null;
  /** Operator-facing prose. A caller discriminates on `reason`, never on this. */
  readonly message: string;
}

/** Either a validated value or a refusal. There is no third outcome and no partial pass. */
export type SignalValidation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: SignalRefusal };

/** Which port failure each reason presents as. Grouped by the rule that fired. */
export function portFailureCodeFor(reason: SignalValidationReason): PortFailureCode {
  switch (reason) {
    case 'field_numeric':
    case 'field_temporal':
    case 'field_identifier':
    case 'field_unrecognized':
    case 'note_not_a_string':
    case 'note_carries_a_figure':
      return 'SIGNAL_PAYLOAD_FIELD_FORBIDDEN';
    case 'note_exceeds_cap':
      return 'SIGNAL_NOTE_EXCEEDS_CAP';
    case 'tier_not_a_member':
      return 'SIGNAL_TIER_NOT_A_MEMBER';
    default:
      return 'SIGNAL_ENVELOPE_INVALID';
  }
}

/** A refused envelope, for a caller that would rather throw than branch. */
export class SignalValidationError extends Error {
  readonly refusal: SignalRefusal;
  readonly reason: SignalValidationReason;
  readonly code: PortFailureCode;

  constructor(refusal: SignalRefusal) {
    super(refusal.message);
    this.name = 'SignalValidationError';
    this.refusal = refusal;
    this.reason = refusal.reason;
    this.code = refusal.code;
  }
}

/** Take the value or throw the refusal. Never returns a repaired or partial envelope. */
export function unwrapSignalValidation<T>(result: SignalValidation<T>): T {
  if (result.ok) return result.value;
  throw new SignalValidationError(result.refusal);
}

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

const REASON_PROSE: Readonly<Record<SignalValidationReason, string>> = {
  envelope_not_an_object: 'the envelope is not an object',
  envelope_field_missing: 'a required envelope field is absent',
  payload_not_an_object: 'the payload is not an object',
  field_numeric: 'the field carries a magnitude, and the envelope has no numeric field',
  field_temporal: "the field carries a date, and the envelope's own completion instant is its only temporal field",
  field_identifier: 'the field points at a record, an account, or a document, and the envelope has no identifier field',
  field_unrecognized: 'the field is not part of the envelope, and an unrecognized field is refused rather than ignored',
  signal_id_invalid: 'the signal identifier is absent, empty, or over length',
  ts_not_utc_instant: 'the completion instant is not an unambiguous UTC instant',
  producer_not_a_member: 'the producer is not a member of the schema',
  kind_not_a_member: 'the signal kind is not a member of the schema',
  tier_not_a_member: 'the tier is not a member of the schema',
  consent_scope_not_a_member: 'the consent scope is not a member of the schema',
  level_not_a_member: 'the level is not a member of the schema',
  direction_not_a_member: 'the direction is not a member of the schema',
  note_not_a_string: 'the directional note is not a string',
  note_exceeds_cap: `the directional note exceeds ${SIGNAL_NOTE_MAX_LENGTH} characters and is refused, never truncated`,
  note_carries_a_figure: 'the directional note carries a digit, and a note is directional rather than quantitative',
  hash_asserted_by_producer: 'the producer asserted an integrity digest, which only the bus may compute',
  hash_missing: 'the stored envelope carries no integrity digest',
  hash_malformed: 'the stored integrity digest is not a lowercase sha256 digest',
  hash_mismatch: 'the stored integrity digest does not cover the stored envelope',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The producer's identifier, if the input carried one we can safely quote in an audit line. */
function signalIdRefOf(candidate: unknown): string | null {
  if (!isRecord(candidate)) return null;
  const id = candidate.signalId;
  if (typeof id !== 'string' || id.length === 0) return null;
  return id.slice(0, SIGNAL_ID_MAX_LENGTH);
}

/** How long a note was, when one was present as a string. Measured, never retained. */
function noteLengthOf(candidate: unknown): number | null {
  if (!isRecord(candidate)) return null;
  const payload = candidate.payload;
  if (!isRecord(payload)) return null;
  const note = payload.note;
  return typeof note === 'string' ? note.length : null;
}

function refuse<T>(reason: SignalValidationReason, at: string, candidate: unknown): SignalValidation<T> {
  return {
    ok: false,
    refusal: {
      reason,
      at,
      code: portFailureCodeFor(reason),
      signalIdRef: signalIdRefOf(candidate),
      noteLength: noteLengthOf(candidate),
      message: `NIZAM signal envelope refused at ${at}: ${REASON_PROSE[reason]}`,
    },
  };
}

/**
 * Which of the four §4.3 rules a field that is not in the schema breaks. The tokens are a
 * DIAGNOSIS, never a permission: a field that matches nothing still lands on
 * `field_unrecognized` and is still refused.
 */
function classifyForeignField(name: string, value: unknown): SignalValidationReason {
  if (typeof value === 'number' || typeof value === 'bigint') return 'field_numeric';
  const tokens = fieldNameTokens(name);
  if (tokens.some((token) => TEMPORAL_FIELD_TOKENS.has(token))) return 'field_temporal';
  if (typeof value === 'string' && DATE_SHAPED_VALUE.test(value)) return 'field_temporal';
  if (tokens.some((token) => IDENTIFIER_FIELD_TOKENS.has(token))) return 'field_identifier';
  return 'field_unrecognized';
}

function isMember<T extends string>(value: unknown, members: readonly T[]): value is T {
  return typeof value === 'string' && (members as readonly string[]).includes(value);
}

/**
 * The canonical bytes the digest covers: `ts`, `producer`, `kind`, and the payload (§4.2).
 * Each component is length-prefixed and an absent optional is marked, so no two distinct
 * envelopes can produce the same input — a note ending in a separator, or an empty note versus
 * no note, would otherwise collide.
 */
function canonicalHashInput(draft: SignalDraft): string {
  const components: readonly (string | undefined)[] = [
    draft.ts,
    draft.producer,
    draft.kind,
    draft.payload.level,
    draft.payload.direction,
    draft.payload.note,
  ];
  return components.map((part) => (part === undefined ? '~' : `${part.length}:${part}`)).join('|');
}

// ---------------------------------------------------------------------------------------------
// The mint
// ---------------------------------------------------------------------------------------------

/**
 * **The only mint for {@link SignalNote}.** A note exists because this measured it.
 *
 * An over-cap note is refused. It is not shortened, not summarized, and not returned in any
 * form — see §4.3.4 and the module note. `at` lets the envelope validator report the path.
 */
export function validateSignalNote(candidate: unknown, at = 'payload.note'): SignalValidation<SignalNote> {
  const measured = (reason: SignalValidationReason): SignalValidation<SignalNote> => ({
    ok: false,
    refusal: {
      reason,
      at,
      code: portFailureCodeFor(reason),
      signalIdRef: null,
      // The length, because that is the diagnosis. Never the text, which is what we refused.
      noteLength: typeof candidate === 'string' ? candidate.length : null,
      message: `NIZAM signal envelope refused at ${at}: ${REASON_PROSE[reason]}`,
    },
  });
  if (typeof candidate !== 'string') return measured('note_not_a_string');
  if (candidate.length > SIGNAL_NOTE_MAX_LENGTH) return measured('note_exceeds_cap');
  if (DIGIT_IN_TEXT.test(candidate)) return measured('note_carries_a_figure');
  return { ok: true, value: candidate as SignalNote };
}

// ---------------------------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------------------------

/** Which form is being validated: the seven fields a producer submits, or the stored eight. */
export type EnvelopeForm = 'draft' | 'stored';

/**
 * Validate the fields common to both forms and rebuild the draft field by field. Nothing is
 * spread: a key that somehow survived the surplus sweep still cannot reach the result.
 *
 * The order of checks is deliberate, and follows the fixture loader's precedent: the most
 * serious refusal is raised first, so a reader sees the leak rather than a missing field that
 * would have failed anyway.
 */
function validateEnvelopeFields(candidate: unknown, form: EnvelopeForm): SignalValidation<SignalDraft> {
  if (!isRecord(candidate)) return refuse('envelope_not_an_object', 'envelope', candidate);

  const permittedEnvelopeKeys: readonly string[] = form === 'stored' ? STORED_ENVELOPE_KEYS : DRAFT_ENVELOPE_KEYS;

  // §4.2: on the write path an integrity claim is not the producer's to make.
  if (form === 'draft' && Object.prototype.hasOwnProperty.call(candidate, 'hash')) {
    return refuse('hash_asserted_by_producer', 'hash', candidate);
  }

  // §4.3.5 at the envelope level. Checked before anything else, because a surplus field is the
  // leak the schema exists to prevent — and a `dueOn` beside the payload leaks just as well as
  // one inside it.
  for (const key of Object.keys(candidate)) {
    if (!permittedEnvelopeKeys.includes(key)) {
      return refuse(classifyForeignField(key, candidate[key]), key, candidate);
    }
  }

  const payload = candidate.payload;
  if (payload === undefined) return refuse('envelope_field_missing', 'payload', candidate);
  if (!isRecord(payload)) return refuse('payload_not_an_object', 'payload', candidate);

  // §4.3.1: no numeric field of any kind, including a permitted key handed a magnitude.
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'number' || typeof value === 'bigint') {
      return refuse('field_numeric', `payload.${key}`, candidate);
    }
  }

  // §4.3.5 inside the payload.
  for (const key of Object.keys(payload)) {
    if (!(PERMITTED_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      return refuse(classifyForeignField(key, payload[key]), `payload.${key}`, candidate);
    }
  }

  // R10, §4.4.1. The classification whose egress set is empty upstream is not a member of
  // SIGNAL_TIERS, so a signal claiming it fails HERE, as an unknown member — not later, as a
  // filtered value.
  if (!isMember<SignalTier>(candidate.tier, SIGNAL_TIERS)) {
    return refuse('tier_not_a_member', 'tier', candidate);
  }

  // §4.3.4. Refused, never truncated.
  let note: SignalNote | undefined;
  if (Object.prototype.hasOwnProperty.call(payload, 'note') && payload.note !== undefined) {
    const minted = validateSignalNote(payload.note);
    if (!minted.ok) {
      return {
        ok: false,
        refusal: { ...minted.refusal, signalIdRef: signalIdRefOf(candidate), noteLength: noteLengthOf(candidate) },
      };
    }
    note = minted.value;
  }

  for (const key of DRAFT_ENVELOPE_KEYS) {
    if (candidate[key] === undefined) return refuse('envelope_field_missing', key, candidate);
  }

  const signalId = candidate.signalId;
  if (typeof signalId !== 'string' || signalId.length === 0 || signalId.length > SIGNAL_ID_MAX_LENGTH) {
    return refuse('signal_id_invalid', 'signalId', candidate);
  }

  const ts = candidate.ts;
  if (typeof ts !== 'string' || !UTC_INSTANT.test(ts)) return refuse('ts_not_utc_instant', 'ts', candidate);

  if (!isMember<SignalProducer>(candidate.producer, SIGNAL_PRODUCERS)) {
    return refuse('producer_not_a_member', 'producer', candidate);
  }
  if (!isMember<SignalKind>(candidate.kind, SIGNAL_KINDS)) return refuse('kind_not_a_member', 'kind', candidate);
  if (!isMember<ConsentScope>(candidate.consentScope, CONSENT_SCOPES)) {
    return refuse('consent_scope_not_a_member', 'consentScope', candidate);
  }
  if (!isMember<SignalLevel>(payload.level, SIGNAL_LEVELS)) return refuse('level_not_a_member', 'payload.level', candidate);

  let direction: SignalDirection | undefined;
  if (Object.prototype.hasOwnProperty.call(payload, 'direction') && payload.direction !== undefined) {
    if (!isMember<SignalDirection>(payload.direction, SIGNAL_DIRECTIONS)) {
      return refuse('direction_not_a_member', 'payload.direction', candidate);
    }
    direction = payload.direction;
  }

  const level: SignalLevel = payload.level;
  const rebuiltPayload: SignalPayload =
    direction === undefined
      ? note === undefined
        ? { level }
        : { level, note }
      : note === undefined
        ? { level, direction }
        : { level, direction, note };

  return {
    ok: true,
    value: {
      signalId,
      ts,
      producer: candidate.producer,
      kind: candidate.kind,
      tier: candidate.tier,
      consentScope: candidate.consentScope,
      payload: rebuiltPayload,
    },
  };
}

/** Validate an untrusted draft. The write path's field rules, without the digest. */
export function validateSignalDraft(candidate: unknown): SignalValidation<SignalDraft> {
  return validateEnvelopeFields(candidate, 'draft');
}

/**
 * The digest the bus stores over `ts + producer + kind + payload` (§4.2). Computed here and
 * nowhere else, which is what makes {@link SignalValidationReason} `hash_asserted_by_producer`
 * meaningful rather than decorative.
 */
export function signalEnvelopeHash(draft: SignalDraft): string {
  return createHash(SIGNAL_HASH_ALGORITHM).update(canonicalHashInput(draft), 'utf8').digest('hex');
}

/** Seal a validated draft into the stored envelope by computing its digest. */
export function sealSignalEnvelope(draft: SignalDraft): SignalEnvelope {
  return { ...draft, hash: signalEnvelopeHash(draft) };
}

/**
 * **The WRITE path.** Validate an untrusted draft and seal it. A producer-asserted `hash` is
 * refused rather than trusted or overwritten, because overwriting it would let a producer
 * believe it had made an integrity claim that was silently discarded.
 */
export function validateForWrite(candidate: unknown): SignalValidation<SignalEnvelope> {
  const validated = validateEnvelopeFields(candidate, 'draft');
  if (!validated.ok) return validated;
  return { ok: true, value: sealSignalEnvelope(validated.value) };
}

/**
 * **The READ path.** Re-run every field rule against the STORED envelope, then require a
 * digest that is present, well formed, and covers what is actually stored.
 *
 * Re-running the field rules is the point of §4.2's "and again before it is served". A row that
 * passed an older schema is not readable because it once passed; it is readable only if it
 * passes now. That is what stops a widened schema, or a narrowed one, from changing what
 * history means.
 */
export function validateForRead(candidate: unknown): SignalValidation<SignalEnvelope> {
  const validated = validateEnvelopeFields(candidate, 'stored');
  if (!validated.ok) return validated;

  const stored = candidate as Record<string, unknown>;
  const hash = stored.hash;
  if (hash === undefined) return refuse('hash_missing', 'hash', candidate);
  if (typeof hash !== 'string' || !SIGNAL_HASH_PATTERN.test(hash)) return refuse('hash_malformed', 'hash', candidate);
  if (hash !== signalEnvelopeHash(validated.value)) return refuse('hash_mismatch', 'hash', candidate);

  return { ok: true, value: { ...validated.value, hash } };
}
