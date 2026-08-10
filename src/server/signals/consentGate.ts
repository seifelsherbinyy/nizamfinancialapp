/**
 * NIZAM · The consent gate — refusal at the bus, two independent gates, closed by default
 * Implemented by: PFOS Contract 12 / Phase 3.2 (spec 06-two-agent-vps)
 * Owning requirements: R8 (consent scope), R10 (exclusion), with R7 support (de-identification)
 * Depends on: ./envelopeValidation, ./envelopeSchema, ../ports/signalBus (types and vocabulary)
 *
 * Contract 12 §4.5 in code. Phase 3.1 answered "is this envelope well formed?"; this module
 * answers the narrower and later question "may THIS subscriber see THIS stored envelope?", and
 * it answers it at the bus, every time it is asked.
 *
 * The five §4.5 rules, each made mechanical rather than documented:
 *
 *  1. **The refusal happens at the bus, not at the subscriber (§4.5.1).** "A subscriber that
 *     decides for itself whether to honour a scope is not a consent boundary; it is a
 *     convention." So {@link ServedSignalEnvelope} is a branded type and {@link gateSignals} is
 *     its only mint — the same device Phase 3.1 used for a note. A subscriber cannot construct
 *     a served envelope, therefore cannot construct the *conclusion* that it is allowed one.
 *     Any code path that hands a subscriber a served envelope went through this gate.
 *  2. **A refusal is a refusal, not an empty result (§4.5.2).** The outcome is the port's own
 *     {@link SignalReadOutcome} union, so `delivered` with no signals and `refused` are
 *     different shapes carrying different discriminants. Nothing here converts the second into
 *     the first: a refused envelope is never quietly dropped from a shorter delivered list. If
 *     any matching envelope is refused, the whole read is refused — the same posture Phase
 *     2.2's mock takes, and for the same reason there is no partial publish.
 *  3. **`producer_only` is the DEFAULT for a new kind (§4.5.3).** Not a comment and not a
 *     convention: {@link WIDENED_KINDS} is an allowlist that ships EMPTY, and
 *     {@link effectiveConsentScope} takes the NARROWER of the stored scope and the kind's
 *     default. A kind the owner has not widened therefore reads as `producer_only` even if a
 *     producer stored it as `shared`. Adding a member to `SIGNAL_KINDS` adds nothing to the
 *     allowlist, so a new signal type is closed on the day it is invented and stays closed
 *     until a widening record is written for it. "Someone forgot to restrict it" cannot happen,
 *     because forgetting is the closed direction.
 *  4. **Scope is evaluated on READ, every read, from the stored envelope (§4.5.4).** This
 *     module holds no state at all: no module-level mutable binding, no map, no memo, nothing
 *     keyed by signal id. Every call re-reads `consentScope`, `kind`, `tier` and `producer`
 *     from the row it was handed, and re-runs {@link validateForRead} over it first. Note WHY
 *     this is load-bearing rather than fussy: the integrity digest covers `ts`, `producer`,
 *     `kind` and `payload` (§4.2) — it does NOT cover `tier` or `consent_scope`. A row whose
 *     scope was widened after it was written still hashes correctly. Only re-evaluation on
 *     every read notices.
 *  5. **Tier and scope are INDEPENDENT gates, both of which must pass (§4.5.5).** Both verdicts
 *     are computed before either is consulted, so neither short-circuits the other, and a
 *     `money_safe` signal marked `producer_only` is refused to a subscriber exactly as §4.5.5
 *     requires. Precedence between the two *reasons* is fixed so an operator reads a stable
 *     audit line, but precedence is not sufficiency: passing one gate never excuses the other.
 *
 * And the reading half of §4.6 layer 4 (R7). Layer 4 "is the one that holds when the other
 * three do not, which is why it is expressed as a missing field rather than as a check". Phase
 * 3.1 proved the INPUT could not carry a figure. {@link deidentificationBreaches} makes the
 * complementary claim about the OUTPUT: it re-derives, from the value about to cross, that the
 * served envelope's key set is exactly the schema's, that it carries no magnitude, no date
 * beyond the envelope's own `ts`, no identifier beyond the producer's own `signal_id` and the
 * bus's digest, and no text over cap. It is deliberately a second derivation rather than a
 * second copy of the validator's reasoning, so a defect in one is not a defect in both. It
 * should be unreachable; a gate that is only ever observed passing is not evidence, so it is
 * also tested directly.
 *
 * Two vocabularies are REUSED, never restated: {@link SignalRefusalReason} from the port is the
 * only refusal vocabulary a subscriber sees, and {@link SignalValidationReason} from Phase 3.1
 * is the only diagnosis vocabulary an audit line carries. This module introduces neither a
 * third enum set, nor a second note cap, nor a second envelope shape.
 *
 * No money appears here and none can: the payload has no numeric field, so `src/lib/money` is
 * neither imported nor needed. Nothing in this module names a host, a path, or any other
 * deployment particular — the policy is injected.
 */
import type {
  ConsentScope,
  SignalEnvelope,
  SignalKind,
  SignalProducer,
  SignalQuery,
  SignalReadOutcome,
  SignalRefusalReason,
  SignalTier,
} from '../ports/signalBus.ts';
import { SIGNAL_TIERS } from '../ports/signalBus.ts';
import {
  DATE_SHAPED_VALUE,
  DIGIT_IN_TEXT,
  fieldNameTokens,
  IDENTIFIER_FIELD_TOKENS,
  PERMITTED_PAYLOAD_KEYS,
  SIGNAL_ID_MAX_LENGTH,
  SIGNAL_NOTE_MAX_LENGTH,
  STORED_ENVELOPE_KEYS,
  TEMPORAL_FIELD_TOKENS,
} from './envelopeSchema.ts';
import { SignalValidationError, unwrapSignalValidation, validateForRead, type SignalValidationReason } from './envelopeValidation.ts';

declare const SERVED_BRAND: unique symbol;

/**
 * A stored envelope that has passed this gate, and is therefore known to be readable by the
 * subscriber it was gated for. {@link gateSignals} is the only mint (§4.5.1). A plain
 * {@link SignalEnvelope} is not assignable to it, so a subscriber cannot decide for itself that
 * it holds one.
 */
export type ServedSignalEnvelope = SignalEnvelope & {
  readonly [SERVED_BRAND]: 'passed the bus consent gate for one named subscriber';
};

/** Which tiers each subscriber may read. Injected, so a deployment can close one (§4.5.5). */
export type ReadableTiersBySubscriber = Readonly<Record<SignalProducer, readonly SignalTier[]>>;

/**
 * The shipped tier posture: both narrow tiers are readable by both agents, and scope does the
 * per-signal work. Named rather than defaulted, so a call site states which posture it is under
 * instead of inheriting one silently. The excluded classification is absent from
 * {@link SIGNAL_TIERS} itself (§4.4.1), so it cannot be granted here by any spelling.
 */
export const NARROW_TIERS_READABLE_BY_BOTH: ReadableTiersBySubscriber = {
  finance: SIGNAL_TIERS,
  life: SIGNAL_TIERS,
};

/**
 * One owner decision to widen one kind past the default (§4.5.3). A record rather than a bare
 * string, because widening is an act with an author: `authorizedBy` has exactly one legal
 * value, so a widening cannot be introduced as "it was already like that".
 */
export interface KindWidening {
  readonly kind: SignalKind;
  /** The only direction a widening can go. `producer_only` is not a widening; it is the floor. */
  readonly widenedTo: Extract<ConsentScope, 'shared'>;
  readonly authorizedBy: 'owner';
}

/**
 * The kinds the owner has explicitly widened. **It ships empty**, which is the whole of rule 3:
 * every kind in {@link SIGNAL_KINDS} — including one added tomorrow — resolves to
 * `producer_only` until a record appears here.
 */
export const WIDENED_KINDS: readonly KindWidening[] = [];

/** The injected consent policy. Both fields are required: an unset gate is not a gate. */
export interface ConsentPolicy {
  readonly readableTiers: ReadableTiersBySubscriber;
  readonly widenedKinds: readonly KindWidening[];
}

/** One envelope's verdict for one subscriber. Not a read outcome; a per-row decision. */
export type ConsentVerdict =
  | { readonly permitted: true }
  | { readonly permitted: false; readonly reason: SignalRefusalReason };

/**
 * The gate's own outcome. Structurally a {@link SignalReadOutcome} whose delivered signals carry
 * the brand — {@link serveToSubscriber} is the widening, and the fact that it compiles is the
 * proof that this module invents no second read shape.
 */
export type ConsentGateOutcome =
  | { readonly outcome: 'delivered'; readonly signals: readonly ServedSignalEnvelope[] }
  | { readonly outcome: 'refused'; readonly reason: SignalRefusalReason };

// ---------------------------------------------------------------------------------------------
// Rule 3 — the default is closed, mechanically
// ---------------------------------------------------------------------------------------------

/**
 * The scope a kind resolves to when nothing has widened it. Returns `producer_only` for every
 * kind absent from `widenedKinds`, which is every kind until an owner writes a record.
 */
export function defaultConsentScopeFor(kind: SignalKind, widenedKinds: readonly KindWidening[] = WIDENED_KINDS): ConsentScope {
  return widenedKinds.some((widening) => widening.kind === kind) ? 'shared' : 'producer_only';
}

/**
 * The scope actually in force for a stored envelope: the NARROWER of what the producer stored
 * and what the kind's default allows. A producer that marks a not-yet-widened kind `shared`
 * gains nothing, so a mis-set field cannot widen a kind by accident (§4.5.3).
 */
export function effectiveConsentScope(envelope: SignalEnvelope, widenedKinds: readonly KindWidening[] = WIDENED_KINDS): ConsentScope {
  const storedScope = envelope.consentScope;
  const kindDefault = defaultConsentScopeFor(envelope.kind, widenedKinds);
  return storedScope === 'producer_only' || kindDefault === 'producer_only' ? 'producer_only' : 'shared';
}

// ---------------------------------------------------------------------------------------------
// Rules 1, 4 and 5 — the two gates
// ---------------------------------------------------------------------------------------------

/**
 * Does the scope gate pass? `producer_only` means the signal exists for the producer's own
 * later use, so the producer may read its own; anybody else is refused (§4.5).
 */
export function scopeGatePasses(envelope: SignalEnvelope, subscriber: SignalProducer, widenedKinds: readonly KindWidening[]): boolean {
  return effectiveConsentScope(envelope, widenedKinds) === 'shared' || envelope.producer === subscriber;
}

/**
 * Does the tier gate pass? Applied to every read including the producer's own, because §4.5.5
 * makes the two gates independent rather than nested.
 */
export function tierGatePasses(envelope: SignalEnvelope, subscriber: SignalProducer, readableTiers: ReadableTiersBySubscriber): boolean {
  return (readableTiers[subscriber] ?? []).includes(envelope.tier);
}

/**
 * Both gates, on one stored envelope, for one subscriber (§4.5.5).
 *
 * Both verdicts are computed BEFORE either is consulted. That is the mechanical form of
 * "independent": there is no arrangement of this function in which passing one gate stops the
 * other from being evaluated. The order the two reasons are reported in is fixed so an audit
 * line is stable, and that order is not a hierarchy.
 */
export function evaluateConsentGates(envelope: SignalEnvelope, subscriber: SignalProducer, policy: ConsentPolicy): ConsentVerdict {
  const scopePasses = scopeGatePasses(envelope, subscriber, policy.widenedKinds);
  const tierPasses = tierGatePasses(envelope, subscriber, policy.readableTiers);
  if (!scopePasses) return { permitted: false, reason: 'consent_scope_producer_only' };
  if (!tierPasses) return { permitted: false, reason: 'tier_not_readable_by_subscriber' };
  return { permitted: true };
}

// ---------------------------------------------------------------------------------------------
// §4.6 layer 4, from the reading side — what actually crosses
// ---------------------------------------------------------------------------------------------

/**
 * The claims this module makes about the value that crosses to a subscriber. The first is the
 * structural precondition the other four rest on (§4.3.5): if the key set is exactly the
 * schema's, there is no field left for a figure, a date, or an identifier to travel in.
 */
export const DEIDENTIFICATION_CLAIMS = [
  'no_field_beyond_the_schema',
  'no_figure',
  'no_date_beyond_the_envelope_ts',
  'no_identifier_beyond_the_producers_own_signal_id',
  'no_text_over_cap',
] as const;

export type DeidentificationClaim = (typeof DEIDENTIFICATION_CLAIMS)[number];

/**
 * One breach of one claim. It carries the claim, the Phase 3.1 diagnosis, and the PATH — never
 * the offending value, for the same reason {@link import('./envelopeValidation').SignalRefusal}
 * carries none: §4.3.6 forbids the quarantine such a field would become.
 */
export interface DeidentificationBreach {
  readonly claim: DeidentificationClaim;
  readonly reason: SignalValidationReason;
  readonly at: string;
}

/** The envelope's own completion instant, and the only path a date-shaped value may take. */
const THE_ONLY_TEMPORAL_PATH = 'ts';

/** Longest string any served field may be. `signal_id`'s bound is the widest in the schema. */
const WIDEST_STRING_BOUND = SIGNAL_ID_MAX_LENGTH;

/** The two top-level identifier fields the schema grants on purpose (§4.2). */
const OWN_IDENTIFIER_PATHS: readonly string[] = ['signalId', 'hash'];

/**
 * Which claim a key that is not in the schema breaks. The tokens are reused from Phase 3.1's
 * schema module, so there is one token set rather than two. As there, they are a DIAGNOSIS and
 * never a permission: a key that matches no token still breaches
 * `no_field_beyond_the_schema` and is still a breach.
 */
function classifyForeignKey(path: string, key: string, value: unknown): DeidentificationBreach {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return { claim: 'no_figure', reason: 'field_numeric', at: path };
  }
  const tokens = fieldNameTokens(key);
  if (tokens.some((token) => TEMPORAL_FIELD_TOKENS.has(token))) {
    return { claim: 'no_date_beyond_the_envelope_ts', reason: 'field_temporal', at: path };
  }
  if (typeof value === 'string' && DATE_SHAPED_VALUE.test(value)) {
    return { claim: 'no_date_beyond_the_envelope_ts', reason: 'field_temporal', at: path };
  }
  if (tokens.some((token) => IDENTIFIER_FIELD_TOKENS.has(token))) {
    return { claim: 'no_identifier_beyond_the_producers_own_signal_id', reason: 'field_identifier', at: path };
  }
  return { claim: 'no_field_beyond_the_schema', reason: 'field_unrecognized', at: path };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Everything the four value-level claims say about one leaf, whatever key it arrived under. */
function inspectLeaf(path: string, key: string, value: unknown, breaches: DeidentificationBreach[]): void {
  if (typeof value === 'number' || typeof value === 'bigint') {
    breaches.push({ claim: 'no_figure', reason: 'field_numeric', at: path });
    return;
  }
  if (typeof value !== 'string') {
    // An object or an array where the schema has a string: not a value, a structure.
    if (isRecord(value) || Array.isArray(value)) {
      breaches.push({ claim: 'no_field_beyond_the_schema', reason: 'field_unrecognized', at: path });
      inspectNested(path, value, breaches);
    }
    return;
  }
  if (path !== THE_ONLY_TEMPORAL_PATH && DATE_SHAPED_VALUE.test(value)) {
    breaches.push({ claim: 'no_date_beyond_the_envelope_ts', reason: 'field_temporal', at: path });
  }
  if (path === 'payload.note') {
    if (value.length > SIGNAL_NOTE_MAX_LENGTH) {
      breaches.push({ claim: 'no_text_over_cap', reason: 'note_exceeds_cap', at: path });
    }
    if (DIGIT_IN_TEXT.test(value)) {
      breaches.push({ claim: 'no_figure', reason: 'note_carries_a_figure', at: path });
    }
  } else if (path === 'signalId') {
    if (value.length > SIGNAL_ID_MAX_LENGTH) {
      breaches.push({ claim: 'no_text_over_cap', reason: 'signal_id_invalid', at: path });
    }
  } else if (value.length > WIDEST_STRING_BOUND) {
    // No other field in the schema is free text; at this length it is not a schema value at all.
    breaches.push({ claim: 'no_text_over_cap', reason: 'field_unrecognized', at: path });
  }
  if (!OWN_IDENTIFIER_PATHS.includes(path)) {
    const tokens = fieldNameTokens(key);
    if (tokens.some((token) => IDENTIFIER_FIELD_TOKENS.has(token))) {
      breaches.push({ claim: 'no_identifier_beyond_the_producers_own_signal_id', reason: 'field_identifier', at: path });
    }
  }
}

/** Walk a structure the schema has no place for, so a buried figure is still reported. */
function inspectNested(path: string, value: unknown, breaches: DeidentificationBreach[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectLeaf(`${path}[${index}]`, String(index), entry, breaches));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    inspectLeaf(`${path}.${key}`, key, nested, breaches);
  }
}

/**
 * **The de-identification audit, made about the OUTPUT.** Given the value that is about to
 * cross to a subscriber, list every claim it breaks. An empty list is the assertion that what
 * crosses carries no figure, no date beyond the envelope's own `ts`, no identifier beyond the
 * producer's own `signal_id` and the bus's digest, no text over cap, and no field the schema
 * does not have.
 *
 * This is §4.6 layer 4 stated from the reading side. Layer 4 is a missing field rather than a
 * check, so this function should have nothing to find — and that is exactly why it is a second,
 * independent derivation rather than a call back into the validator: the two would then fail
 * together. It is wired into {@link gateSignals} and also exercised directly, because a guard
 * only ever observed passing is not evidence.
 */
export function deidentificationBreaches(served: SignalEnvelope): readonly DeidentificationBreach[] {
  const breaches: DeidentificationBreach[] = [];
  const envelope = served as unknown;
  if (!isRecord(envelope)) {
    return [{ claim: 'no_field_beyond_the_schema', reason: 'envelope_not_an_object', at: 'envelope' }];
  }

  const permittedEnvelopeKeys: readonly string[] = STORED_ENVELOPE_KEYS;
  for (const [key, value] of Object.entries(envelope)) {
    if (!permittedEnvelopeKeys.includes(key)) {
      breaches.push(classifyForeignKey(key, key, value));
      inspectNested(key, value, breaches);
      continue;
    }
    if (key === 'payload') continue;
    inspectLeaf(key, key, value, breaches);
  }

  const payload = envelope.payload;
  if (!isRecord(payload)) {
    breaches.push({ claim: 'no_field_beyond_the_schema', reason: 'payload_not_an_object', at: 'payload' });
    return breaches;
  }
  for (const [key, value] of Object.entries(payload)) {
    const path = `payload.${key}`;
    if (!(PERMITTED_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      breaches.push(classifyForeignKey(path, key, value));
      inspectNested(path, value, breaches);
      continue;
    }
    inspectLeaf(path, key, value, breaches);
  }
  return breaches;
}

/** A breached served envelope, raised in Phase 3.1's vocabulary so a bus adapter needs no new code. */
function raiseBreach(breach: DeidentificationBreach, signalIdRef: string | null): never {
  throw new SignalValidationError({
    reason: breach.reason,
    at: breach.at,
    code: 'SIGNAL_PAYLOAD_FIELD_FORBIDDEN',
    signalIdRef,
    noteLength: null,
    message: `NIZAM consent gate refused to serve ${breach.at}: the claim "${breach.claim}" does not hold for the value about to cross`,
  });
}

// ---------------------------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------------------------

/**
 * **The bus-side gate.** Given the stored rows a query already matched, decide what — if
 * anything — this subscriber may see.
 *
 * Per row, in order, on EVERY call:
 *  1. {@link validateForRead}, which re-runs every §4.3 field rule and re-checks the digest.
 *     A row that once passed is not readable because it once passed (§4.2).
 *  2. {@link deidentificationBreaches} over the value about to cross (§4.6 layer 4).
 *  3. Both consent gates, from the stored envelope (§4.5.4, §4.5.5).
 *
 * A row that fails 1 or 2 THROWS: that is a corrupt store or a defect, not a subscriber being
 * told no, and it must not be mistaken for either a refusal or an absence. Every candidate is
 * validated even after a refusal has been found, so store corruption is loud wherever in the
 * batch it sits rather than being masked by a refusal that happened to come first.
 *
 * A row that fails 3 refuses the WHOLE read (§4.5.2). Dropping it from a shorter delivered list
 * is precisely the "empty result indistinguishable from no such signal" the rule forbids.
 *
 * `candidates` is `unknown[]` on purpose: the gate does not trust its own store.
 */
export function gateSignals(candidates: readonly unknown[], query: SignalQuery, policy: ConsentPolicy): ConsentGateOutcome {
  const permitted: ServedSignalEnvelope[] = [];
  let firstRefusal: SignalRefusalReason | null = null;

  for (const candidate of candidates) {
    // Read-path validation, from scratch, every read. Throws rather than refuses.
    const envelope = unwrapSignalValidation(validateForRead(candidate));

    for (const breach of deidentificationBreaches(envelope)) {
      raiseBreach(breach, envelope.signalId);
    }

    const verdict = evaluateConsentGates(envelope, query.subscriber, policy);
    if (!verdict.permitted) {
      if (firstRefusal === null) firstRefusal = verdict.reason;
      continue;
    }
    // The only mint for a served envelope (§4.5.1).
    permitted.push(envelope as ServedSignalEnvelope);
  }

  if (firstRefusal !== null) return { outcome: 'refused', reason: firstRefusal };
  return { outcome: 'delivered', signals: permitted.slice(0, query.limit) };
}

/**
 * The same gate, in the port's own vocabulary. This function body is the compile-time proof
 * that {@link ConsentGateOutcome} is a {@link SignalReadOutcome} and that this module therefore
 * introduces no second read shape.
 */
export function serveToSubscriber(candidates: readonly unknown[], query: SignalQuery, policy: ConsentPolicy): SignalReadOutcome {
  return gateSignals(candidates, query, policy);
}
