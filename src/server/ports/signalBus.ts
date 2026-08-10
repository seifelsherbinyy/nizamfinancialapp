/**
 * NIZAM · SignalBusPort — the only channel between the two agents, shaped by absence
 * Implemented by: PFOS Contract 12 / Phase 2.1 (spec 06-two-agent-vps)
 * Owning requirements: R7 (envelope validation), R8 (consent scope), R10 (exclusion)
 * Depends on: shapeGuards.ts (type level only)
 *
 * Contract 12 §4 in interface form. The bus carries the STATE. It never carries the DATA
 * (steering §4.3). Phase 3 implements validation; the job of this file is narrower and
 * comes first: make the forbidden shape impossible to *write down*, so validation is a
 * second belt rather than the only one.
 *
 * Four mechanisms, each answering one clause of §4.3:
 *
 *  1. **No numeric field (§4.3.1).** {@link SignalPayload} is wrapped in `NoMagnitude`, so a
 *     numeric field added to it later becomes uninhabitable and fails to compile. A level is
 *     an enum. A direction is an enum. Neither is a magnitude.
 *  2. **No date field and no identifier field (§4.3.2, §4.3.3).** The payload's key set is
 *     exactly `level`, `direction`, `note`. A due date or an account reference is not a
 *     forbidden value of an existing field — it is a key that is not in the type.
 *  3. **`additionalProperties: false` at the type level (§4.3.5).** {@link SignalBusPort.publish}
 *     constrains its payload with `Exact`, so a surplus key is typed `never`. Without this the
 *     first two rules would be decorative: a producer could add `balance` and pass, because
 *     TypeScript's own excess-property check only fires on a fresh literal.
 *  4. **No raw free text (§4.3.4).** `note` is {@link SignalNote}, a branded string. A plain
 *     `string` is not assignable to it, so arbitrary narrative cannot reach the field at all,
 *     let alone 121 characters of it. Phase 3's validator is the sole mint, and it rejects an
 *     over-cap note rather than truncating it — truncation would silently ship the first
 *     {@link SIGNAL_NOTE_MAX_LENGTH} characters of something that was never allowed to leave.
 *
 * Two absences are as deliberate as the four presences. There is no `update` and no `delete`
 * member, because the store is append-only and a correction is another publish (§4.1). And
 * there is no method that returns a quarantined invalid signal, because that would be exactly
 * the leak the schema prevents (§4.3.6).
 */
import type { Exact, NoMagnitude } from './shapeGuards.ts';

/** Who produced a signal. Enumerated; never free text (§4.2). */
export const SIGNAL_PRODUCERS = ['life', 'finance'] as const;
export type SignalProducer = (typeof SIGNAL_PRODUCERS)[number];

/**
 * The closed set of signal kinds. Extending it is a schema change with its own review, not a
 * runtime string (§4.2).
 */
export const SIGNAL_KINDS = ['money_pressure', 'recovery_state', 'readiness', 'budget_breach'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/**
 * Two narrow tiers only (§4.4.1, owning requirement R10). The classification whose egress set
 * is empty in the other repository is **not a member of this union**, so there is no value a
 * producer could set to mark a signal as carrying it; such a signal fails validation as an
 * unknown member rather than being filtered later.
 */
export const SIGNAL_TIERS = ['money_safe', 'life_safe'] as const;
export type SignalTier = (typeof SIGNAL_TIERS)[number];

/** §4.5. `producer_only` is the default for any new kind until the owner widens it. */
export const CONSENT_SCOPES = ['shared', 'producer_only'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

/** A level. Not a magnitude (§4.2, §4.3.1). */
export const SIGNAL_LEVELS = ['green', 'amber', 'red'] as const;
export type SignalLevel = (typeof SIGNAL_LEVELS)[number];

/** A direction. Not a delta (§4.2). */
export const SIGNAL_DIRECTIONS = ['downshift', 'hold', 'upshift'] as const;
export type SignalDirection = (typeof SIGNAL_DIRECTIONS)[number];

/** The schema-level cap on a directional note (§4.3.4). One source of truth for Phase 3. */
export const SIGNAL_NOTE_MAX_LENGTH = 120;

declare const SIGNAL_NOTE_BRAND: unique symbol;

/**
 * A directional note that has been through envelope validation and is therefore known to be
 * within {@link SIGNAL_NOTE_MAX_LENGTH}. The brand is not decoration: it is what stops a
 * caller handing the field an unmeasured string. Phase 3 supplies the only mint.
 */
export type SignalNote = string & { readonly [SIGNAL_NOTE_BRAND]: 'directional note within the schema cap' };

/**
 * Everything a payload may carry, and nothing else. A balance, a due date, an account
 * reference, a transaction reference, a document reference, and a journal excerpt are absent
 * by construction rather than removed by a filter.
 */
export type SignalPayload = NoMagnitude<{
  readonly level: SignalLevel;
  readonly direction?: SignalDirection;
  readonly note?: SignalNote;
}>;

/**
 * What a producer submits. `hash` is absent here on purpose: integrity is computed by the bus
 * over the stored envelope, so a producer cannot assert an integrity claim about its own
 * payload (§4.2).
 */
export interface SignalDraft<P extends SignalPayload = SignalPayload> {
  /** Unique, generated by the producer (§4.2). */
  readonly signalId: string;
  /** The producer's completion time, an unambiguous UTC instant. */
  readonly ts: string;
  readonly producer: SignalProducer;
  readonly kind: SignalKind;
  readonly tier: SignalTier;
  readonly consentScope: ConsentScope;
  readonly payload: P;
}

/** A stored envelope as a subscriber sees it. `hash` covers ts, producer, kind and payload. */
export interface SignalEnvelope extends SignalDraft {
  readonly hash: string;
}

/** Acknowledgement of one appended signal. */
export interface StoredSignalReceipt {
  readonly signalId: string;
  readonly hash: string;
  readonly storedAt: string;
}

/** What a subscriber asks for. Scope and tier are evaluated by the bus, not by the caller. */
export interface SignalQuery {
  /** The agent doing the asking. The bus decides what that agent may see (§4.5.1). */
  readonly subscriber: SignalProducer;
  readonly kind?: SignalKind;
  /** Lower bound on the envelope's own `ts`. */
  readonly since?: string;
  readonly limit: number;
}

/** Why a read was refused. Distinct values, so an operator learns which gate fired. */
export const SIGNAL_REFUSAL_REASONS = ['consent_scope_producer_only', 'tier_not_readable_by_subscriber'] as const;
export type SignalRefusalReason = (typeof SIGNAL_REFUSAL_REASONS)[number];

/**
 * §4.5.2: a refusal is a refusal, not an empty result that is indistinguishable from "no such
 * signal". The union makes the two outcomes different shapes, so a caller cannot conflate them
 * even carelessly — `delivered` with an empty array and `refused` are not the same value.
 */
export type SignalReadOutcome =
  | { readonly outcome: 'delivered'; readonly signals: readonly SignalEnvelope[] }
  | { readonly outcome: 'refused'; readonly reason: SignalRefusalReason };

/**
 * The consent bus boundary. Bound to the internal network only (§2.2.5, R9); this interface
 * therefore names no address and carries no endpoint default — see {@link SignalBusPortConfig}.
 */
export interface SignalBusPort {
  /**
   * Append one signal. The payload constraint is the consent boundary: `P` must be exactly
   * {@link SignalPayload}, so a field carrying a figure, a date, an identifier, or unvalidated
   * text is a compile error at the producer.
   *
   * Rejects with a {@link import('./errors').PortFailure} when the envelope fails validation.
   * There is no partial success and no quarantine (§4.3.6).
   */
  publish<P extends Exact<SignalPayload, P>>(draft: SignalDraft<P>): Promise<StoredSignalReceipt>;

  /**
   * Read signals the subscriber is permitted to see. Tier and scope are independent gates,
   * both evaluated on every read from the stored envelope — never cached, never decided once
   * at write time and trusted afterwards (§4.5.4, §4.5.5).
   */
  read(query: SignalQuery): Promise<SignalReadOutcome>;
}

/**
 * Injected configuration for a bus client. No default: this module names no host, no port, and
 * no socket path, because the repository may hold the design and never a deployment particular
 * (steering §0b, R24). An unset value is a startup failure, not a guess.
 */
export interface SignalBusPortConfig {
  /** The agent this client publishes as. Its own signals are the only ones it may produce. */
  readonly producer: SignalProducer;
  /** Where the bus listens on the internal network. Injected; resolved from the host at run time. */
  readonly internalEndpointRef: string;
  /** Default scope applied to a kind the owner has not explicitly widened (§4.5.3). */
  readonly defaultConsentScope: Extract<ConsentScope, 'producer_only'>;
}
