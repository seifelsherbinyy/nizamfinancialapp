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
 * Determinism. No clock: `storedAt` comes from the injected `now`. No randomness and no crypto:
 * `hash` is a 32-bit FNV-1a over the canonical `ts | producer | kind | payload` string, rendered
 * as eight hex digits. That is a MOCK integrity claim — Phase 3 owns the real one — and its only
 * requirements here are that it is stable across runs and that it changes when the payload does.
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
  CONSENT_SCOPES,
  SIGNAL_DIRECTIONS,
  SIGNAL_KINDS,
  SIGNAL_LEVELS,
  SIGNAL_NOTE_MAX_LENGTH,
  SIGNAL_PRODUCERS,
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
import { MockPortFailure } from './failure';
import type { InvocationRecorder } from './invocationRecorder';

/** The UTC instant form the envelope's `ts` takes. An offset-bearing value is refused. */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** The only keys a payload may carry (§4.3.2, §4.3.3, §4.3.5). */
const PERMITTED_PAYLOAD_KEYS: readonly string[] = ['level', 'direction', 'note'];

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

  /** The runtime half of §4.3. Order is deliberate: the most serious refusal is raised first. */
  function validate(draft: SignalDraft): void {
    const id = draft.signalId.length > 0 ? draft.signalId : null;

    // A surplus payload field is the leak the schema exists to prevent, so it is checked first.
    const payload = draft.payload as Readonly<Record<string, unknown>>;
    for (const key of Object.keys(payload)) {
      if (!PERMITTED_PAYLOAD_KEYS.includes(key)) {
        reject('SIGNAL_PAYLOAD_FIELD_FORBIDDEN', `payload field "${key}" is not part of the envelope`, id);
      }
    }
    // §4.3.1: a level is an enum, never a magnitude. Belt two for a value that bypassed the type.
    for (const key of PERMITTED_PAYLOAD_KEYS) {
      if (typeof payload[key] === 'number') {
        reject('SIGNAL_PAYLOAD_FIELD_FORBIDDEN', `payload field "${key}" carries a magnitude`, id);
      }
    }

    if (!(SIGNAL_TIERS as readonly string[]).includes(draft.tier)) {
      reject('SIGNAL_TIER_NOT_A_MEMBER', `tier "${String(draft.tier)}" is not a member of the schema`, id);
    }

    const note = draft.payload.note;
    if (note !== undefined && note.length > SIGNAL_NOTE_MAX_LENGTH) {
      // Refused, not truncated (§4.3.4).
      reject('SIGNAL_NOTE_EXCEEDS_CAP', `the directional note exceeds ${SIGNAL_NOTE_MAX_LENGTH} characters`, id);
    }

    if (id === null) reject('SIGNAL_ENVELOPE_INVALID', 'the signal identifier is empty', null);
    if (!UTC_INSTANT.test(draft.ts)) reject('SIGNAL_ENVELOPE_INVALID', 'the completion instant is not a UTC instant', id);
    if (!(SIGNAL_PRODUCERS as readonly string[]).includes(draft.producer)) {
      reject('SIGNAL_ENVELOPE_INVALID', 'the producer is not a member of the schema', id);
    }
    if (draft.producer !== config.producer) {
      // A client publishes as itself and nothing else (§4.2).
      reject('SIGNAL_ENVELOPE_INVALID', 'this client may only produce its own signals', id);
    }
    if (!(SIGNAL_KINDS as readonly string[]).includes(draft.kind)) {
      reject('SIGNAL_ENVELOPE_INVALID', 'the signal kind is not a member of the schema', id);
    }
    if (!(CONSENT_SCOPES as readonly string[]).includes(draft.consentScope)) {
      reject('SIGNAL_ENVELOPE_INVALID', 'the consent scope is not a member of the schema', id);
    }
    if (!(SIGNAL_LEVELS as readonly string[]).includes(draft.payload.level)) {
      reject('SIGNAL_ENVELOPE_INVALID', 'the level is not a member of the schema', id);
    }
    const direction = draft.payload.direction;
    if (direction !== undefined && !(SIGNAL_DIRECTIONS as readonly string[]).includes(direction)) {
      reject('SIGNAL_ENVELOPE_INVALID', 'the direction is not a member of the schema', id);
    }

    // §4.5.3: a kind the owner has not widened stays at the default scope.
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
