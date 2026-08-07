/**
 * NIZAM · The vendored envelope schema, in the finance agent's own vocabulary
 * Implemented by: PFOS Contract 12 / Phase 3.1 (spec 06-two-agent-vps)
 * Owning requirements: R7 (envelope validation), R10 (exclusion)
 * Depends on: ../ports/signalBus (type level and vocabulary only)
 *
 * `nizam-signalbus.envelope.schema.json` beside this file is the artifact both agents
 * VENDOR (steering §1: the two agents share no code, only that schema, the host, and the
 * provider account). It is language-neutral on purpose, so the Python agent can validate the
 * same envelope without importing anything from here.
 *
 * This module is that document's TypeScript mirror: the small set of decidable facts a
 * validator needs, expressed once. Two rules keep it honest.
 *
 *  1. **No second vocabulary.** Every enum, and the note cap, are RE-EXPORTED from
 *     `../ports/signalBus`. Nothing is redeclared here, so there is no way for a validator
 *     to accept a member the port's types reject, or to cap a note at a different length.
 *  2. **No second envelope shape.** The wire form uses the snake_case names of contract 12
 *     §4.2 and architecture §1.5; the TypeScript form uses the camelCase keys of
 *     {@link SignalDraft}. {@link ENVELOPE_WIRE_NAMES} is the whole of the difference between
 *     them, and `schemaParity.test.ts` fails if this module and the JSON document drift on a
 *     name, an enum member, the note cap, or the closed-object rule.
 *
 * The token sets at the bottom exist so a refusal can say WHICH rule fired. Because
 * `additionalProperties` is false, a key named like a due date and a key named like a balance
 * are both simply "not in the schema" — but an operator reading an audit line learns much more
 * from `field_temporal` than from `field_unrecognized`, so the classifier keeps them distinct
 * (§4.3.2, §4.3.3). The tokens are a diagnosis, never a permission: nothing is admitted by
 * failing to match them.
 */
import {
  CONSENT_SCOPES,
  SIGNAL_DIRECTIONS,
  SIGNAL_KINDS,
  SIGNAL_LEVELS,
  SIGNAL_NOTE_MAX_LENGTH,
  SIGNAL_PRODUCERS,
  SIGNAL_TIERS,
} from '../ports/signalBus';

// One vocabulary, re-exported rather than restated. See rule 1 above.
export { CONSENT_SCOPES, SIGNAL_DIRECTIONS, SIGNAL_KINDS, SIGNAL_LEVELS, SIGNAL_NOTE_MAX_LENGTH, SIGNAL_PRODUCERS, SIGNAL_TIERS };

/** The vendored document's identifier. A URN, because the repository holds no absolute URI. */
export const SIGNAL_ENVELOPE_SCHEMA_ID = 'urn:nizam:signalbus:envelope:1';

/** The vendored document's file name, beside this module. Both agents read this same file. */
export const SIGNAL_ENVELOPE_SCHEMA_FILE = 'nizam-signalbus.envelope.schema.json';

/** The digest `hash` is computed with (§4.2). Integrity, not authentication. */
export const SIGNAL_HASH_ALGORITHM = 'sha256';

/** What a computed `hash` looks like: lowercase hex, sha256-wide. */
export const SIGNAL_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The envelope's own `ts`, and the only temporal value in the schema (§4.3.2). */
export const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Upper bound on a producer-generated identifier, matching the vendored document. */
export const SIGNAL_ID_MAX_LENGTH = 128;

/** The only keys a payload may carry (§4.3.5). Nothing else is ignored; it is refused. */
export const PERMITTED_PAYLOAD_KEYS = ['level', 'direction', 'note'] as const;

/** The seven fields a producer submits. `hash` is deliberately not among them (§4.2). */
export const DRAFT_ENVELOPE_KEYS = ['signalId', 'ts', 'producer', 'kind', 'tier', 'consentScope', 'payload'] as const;

/** The stored form: the draft's seven fields plus the bus-computed integrity digest. */
export const STORED_ENVELOPE_KEYS = [...DRAFT_ENVELOPE_KEYS, 'hash'] as const;

/**
 * The whole of the difference between this agent's keys and the vendored wire names. Kept as
 * data so the parity test can assert the mapping is total in both directions, rather than
 * trusting that somebody remembered to add an entry.
 */
export const ENVELOPE_WIRE_NAMES: Readonly<Record<(typeof STORED_ENVELOPE_KEYS)[number], string>> = {
  signalId: 'signal_id',
  ts: 'ts',
  producer: 'producer',
  kind: 'kind',
  tier: 'tier',
  consentScope: 'consent_scope',
  payload: 'payload',
  hash: 'hash',
};

/**
 * Split a field name into lowercase word tokens, so classification reads whole words. Without
 * this, a substring match on `at` would classify `rate` as temporal and teach an operator the
 * wrong thing about why their signal was refused.
 */
export function fieldNameTokens(name: string): readonly string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** Word tokens that mean "this field is a second clock" (§4.3.2). */
export const TEMPORAL_FIELD_TOKENS: ReadonlySet<string> = new Set([
  'date',
  'dates',
  'time',
  'times',
  'timestamp',
  'ts',
  'due',
  'deadline',
  'expiry',
  'expires',
  'expired',
  'when',
  'at',
  'on',
  'day',
  'days',
  'week',
  'month',
  'year',
  'period',
  'epoch',
  'instant',
  'since',
  'until',
  'asof',
  'schedule',
  'scheduled',
]);

/** Word tokens that mean "this field points at a record, an account, or a document" (§4.3.3). */
export const IDENTIFIER_FIELD_TOKENS: ReadonlySet<string> = new Set([
  'id',
  'ids',
  'uuid',
  'guid',
  'ref',
  'refs',
  'reference',
  'account',
  'accounts',
  'iban',
  'card',
  'transaction',
  'transactions',
  'txn',
  'document',
  'documents',
  'doc',
  'file',
  'folder',
  'drive',
  'key',
  'slug',
  'handle',
  'number',
  'no',
  'code',
  'payee',
  'merchant',
]);

/** A value that reads as a calendar date, whatever its field is called (§4.3.2). */
export const DATE_SHAPED_VALUE = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;

/**
 * A digit inside a directional note. Architecture §1.5 states the rule in prose: finance
 * publishes `money_pressure: amber`, never "you owe 47,000". A note is the one field in the
 * envelope that holds text, so it is the one place a figure could still travel, and a note
 * that needs a digit is not directional. Refusing every digit is the cheapest rule that is
 * decidable and cannot be argued with at a call site.
 */
export const DIGIT_IN_TEXT = /\d/;
