/**
 * NIZAM · Deterministic SignalBusPort mock — append-only, and refusal is not emptiness
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Owning requirements: R7 (envelope validation), R8 (consent scope), R10 (exclusion)
 * Depends on: ../ports/signalBus, ../ports/errors, ./invocationRecorder, ./failure
 *
 * The BUILD half of the consent bus (steering §2, §4.2). The bus is internal-network-only and is
 * never exposed through the reverse proxy (R9), which is why this module names no host, no port
 * and no socket path: `internalEndpointRef` on {@link SignalBusPortConfig} is injected.
 *
 * The type already makes the forbidden shape unwritable — `publish` constrains its payload with
 * `Exact`, so a field carrying a figure, a date or an identifier is a compile error at the
 * producer. This mock adds the SECOND belt §4.3 asks for: the same rules checked at run time, so
 * a payload that arrives from a fixture, a wire, or a cast is refused rather than stored. Both
 * belts matter. The first stops the mistake being written; the second stops it being accepted from
 * somewhere the compiler never saw.
 *
 * **Validation is not duplicated here (Phase 3.3).** Phase 2.2 shipped its own copy of the
 * permitted payload keys, its own instant pattern and its own inline field checks, because the
 * real validator did not exist yet; its docstring recorded that Phase 3 owned the real one. It
 * does now, so this mock delegates every envelope-field rule to
 * {@link validateSignalDraft} in `../signals/envelopeValidation`. There is one vocabulary, one
 * note cap, one set of enums, and one field classifier, so the mock and the bus cannot drift.
 *
 * Two checks stay here, because neither is a property of the ENVELOPE:
 *   - a client publishes as itself and nothing else (§4.2) — that is a property of this client's
 *     configuration, and the same envelope is perfectly valid published by its own producer;
 *   - a kind the owner has not widened stays at the default consent scope (§4.5.3) — that is a
 *     property of the deployment's consent policy, not of the envelope's shape.
 *
 * Determinism. No clock: `storedAt` comes from the injected `now`. No randomness and no crypto:
 * `hash` is a 32-bit FNV-1a over the canonical `ts | producer | kind | payload` string, rendered
 * as eight hex digits. **This deliberately remains the mock's own digest.** The real one
 * (`signalEnvelopeHash`) is a sha256 and 64 hex characters wide, and Phase 2.2's determinism and
 * receipt tests pin the eight-character form; swapping it would break tests that are asserting
 * something true, to no benefit — a MOCK integrity claim only has to be stable across runs and
 * sensitive to the payload, which this is. The real digest belongs to the real store
 * (`../signals/signalStore`), which computes it through 3.1 and nowhere else.
 *
 * The failure paths a caller can drive:
 *   - **an invalid envelope** — a producer that is not this client, an empty identifier, a
 *     malformed instant, an unknown kind;
 *   - **a tier that is not a member** — the classification whose egress set is empty upstream is
 *     absent from `SIGNAL_TIERS`, so a signal claiming it fails as an unknown member rather than
 *     being filtered afterwards (§4.4.1, R10);
 *   - **a forbidden payload field** — a surplus key is refused, never dropped;
 *   - **a note over the schema cap** — refused, never truncated, because truncation would ship the
 *     first {@link SIGNAL_NOTE_MAX_LENGTH} characters of something that was not allowed to leave;
 *   - **a consent scope the owner has not widened** (§4.5.3) — `producer_only` is the default for
 *     a new kind, so publishing it as `shared` is refused until the kind is widened;
 *   - **an unreachable bus**.
 *
 * And on the read side, the distinction §4.5.2 insists on: a refusal is a refusal, not an empty
 * result. Scope and tier are independent gates, both evaluated on every read from the STORED
 * envelope — never cached and never decided once at write time (§4.5.4, §4.5.5). If any matching
 * signal is refused, the whole read is refused: there is no partial delivery, for the same reason
 * there is no partial publish.
 *
 * Two absences are inherited from the port: no update, no delete. A correction is another publish.
 */
import type { PortFailureCode } from '../ports/errors';
import {
  SIGNAL_TIERS,
  type SignalBusPort,
  type SignalBusPortConfig,
  type SignalDraft,
  type SignalEnvelope,
  type SignalKind,
  type SignalPayload,
  type SignalProducer,
  type SignalQuery,
  type SignalReadOutcome,
  type SignalTier,
  type StoredSignalReceipt,
} from '../ports/signalBus';
import type { Exact } from '../ports/shapeGuards';
import { validateSignalDraft } from '../signals/envelopeValidation';
import { MockPortFailure } from './failure';
import type { InvocationRecorder } from './invocationRecorder';

/** Which tiers a subscriber may read. Injectable, so a test can close one. */
export type ReadableTiers = Readonly<Record<SignalProducer, readonly SignalTier[]>>;

const EVERY_TIER_READABLE: ReadableTiers = {
  finance: SIGNAL_TIERS,
  life: SIGNAL_TIERS,
};

export interface SignalBusMockConfig {
  readonly config: SignalBusPortConfig;
  readonly recorder: InvocationRecorder;
  /** Injected clock. This mock reads no ambient time. */
  readonly now: () => string;
  /** Kinds the owner has explicitly widened past `producer_only` (§4.5.3). */
  readonly widenedKinds?: readonly SignalKind[];
  readonly readableTiers?: ReadableTiers;
  readonly unreachable?: boolean;
  /** Envelopes already on the bus, e.g. published by the other agent. */
  readonly seeded?: readonly SignalDraft[];
}

export interface SignalBusMock {
  readonly port: SignalBusPort;
  /** The append-only log, oldest first. */
  readonly stored: readonly SignalEnvelope[];
  readonly recorder: InvocationRecorder;
}

/**
 * A 32-bit FNV-1a, rendered as eight hex digits. Integer arithmetic throughout; no float, and
 * nothing here is a cryptographic claim — see the module note.
 */
function fnv1aHex(text: string): string {
  let state = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    state ^= text.charCodeAt(i);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return state.toString(16).padStart(8, '0');
}

/** The canonical bytes the hash covers: ts, producer, kind and payload (§4.2). */
function canonicalForm(draft: SignalDraft): string {
  const payload = draft.payload;
  return [
    draft.ts,
    draft.producer,
    draft.kind,
    payload.level,
    payload.direction ?? '',
    payload.note ?? '',
  ].join('\u0000');
}

export function createSignalBusMock(mockConfig: SignalBusMockConfig): SignalBusMock {
  const { config, recorder, now } = mockConfig;
  const readableTiers = mockConfig.readableTiers ?? EVERY_TIER_READABLE;
  const widened = new Set<SignalKind>(mockConfig.widenedKinds ?? []);
  const stored: SignalEnvelope[] = [];

  function reject(code: PortFailureCode, why: string, signalId: string | null): never {
    throw new MockPortFailure(code, `NIZAM signal bus mock: ${why}`, signalId);
  }

  /**
   * The runtime half of §4.3, delegated. Every envelope-field rule — the permitted payload keys,
   * the no-numeric rule, the tier membership, the note cap, the enums, the instant form — comes
   * from Phase 3.1's validator, which is the single place they are expressed. The refusal it
   * returns already carries the port failure code, so a caller sees the same `code` it always
   * did without this file deciding which one that is.
   */
  function validate(draft: SignalDraft): void {
    const id = draft.signalId.length > 0 ? draft.signalId : null;

    const validated = validateSignalDraft(draft);
    if (!validated.ok) {
      const { refusal } = validated;
      // `signalIdRef` is the producer's own identifier as the validator measured it; the message
      // is the validator's prose, so the mock cannot describe a rule differently from the bus.
      reject(refusal.code, refusal.message, refusal.signalIdRef);
    }

    // A client publishes as itself and nothing else (§4.2). Not an envelope rule: the same
    // envelope is valid when its own producer publishes it, so it belongs to this client.
    if (draft.producer !== config.producer) {
      reject('SIGNAL_ENVELOPE_INVALID', 'this client may only produce its own signals', id);
    }

    // §4.5.3: a kind the owner has not widened stays at the default scope. A consent policy of
    // the deployment, not a property of the envelope's shape.
    if (draft.consentScope !== config.defaultConsentScope && !widened.has(draft.kind)) {
      reject('SIGNAL_CONSENT_SCOPE_REFUSED', `the kind "${draft.kind}" has not been widened past the default scope`, id);
    }
  }

  function append(draft: SignalDraft): SignalEnvelope {
    const envelope: SignalEnvelope = { ...draft, hash: fnv1aHex(canonicalForm(draft)) };
    stored.push(envelope);
    return envelope;
  }

  for (const seed of mockConfig.seeded ?? []) append(seed);

  const port: SignalBusPort = {
    async publish<P extends Exact<SignalPayload, P>>(draft: SignalDraft<P>): Promise<StoredSignalReceipt> {
      const payload: SignalPayload = draft.payload;
      recorder.record('signalBus', 'publish', {
        signalId: draft.signalId,
        producer: draft.producer,
        kind: draft.kind,
        tier: draft.tier,
        consentScope: draft.consentScope,
        level: payload.level,
        direction: payload.direction ?? null,
        // The note is measured, never recorded: it is the one payload field that holds text.
        noteLength: payload.note === undefined ? 0 : payload.note.length,
      });

      if (mockConfig.unreachable === true) {
        reject('SIGNAL_BUS_UNREACHABLE', 'the internal bus did not answer', draft.signalId);
      }

      const widerDraft: SignalDraft = { ...draft, payload };
      validate(widerDraft);
      const envelope = append(widerDraft);
      return { signalId: envelope.signalId, hash: envelope.hash, storedAt: now() };
    },

    async read(query: SignalQuery): Promise<SignalReadOutcome> {
      recorder.record('signalBus', 'read', {
        subscriber: query.subscriber,
        kind: query.kind ?? null,
        since: query.since ?? null,
        limit: query.limit,
        endpointRef: config.internalEndpointRef,
      });

      if (mockConfig.unreachable === true) {
        reject('SIGNAL_BUS_UNREACHABLE', 'the internal bus did not answer', null);
      }

      const matching = stored.filter((envelope) => {
        if (query.kind !== undefined && envelope.kind !== query.kind) return false;
        if (query.since !== undefined && envelope.ts < query.since) return false;
        return true;
      });

      // Both gates, on every read, from the stored envelope (§4.5.4, §4.5.5).
      for (const envelope of matching) {
        if (envelope.consentScope === 'producer_only' && envelope.producer !== query.subscriber) {
          return { outcome: 'refused', reason: 'consent_scope_producer_only' };
        }
        if (!(readableTiers[query.subscriber] ?? []).includes(envelope.tier)) {
          return { outcome: 'refused', reason: 'tier_not_readable_by_subscriber' };
        }
      }

      return { outcome: 'delivered', signals: matching.slice(0, query.limit) };
    },
  };

  return {
    port,
    get stored() {
      return [...stored];
    },
    recorder,
  };
}
