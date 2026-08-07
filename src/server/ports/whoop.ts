/**
 * NIZAM · WhoopPort — a recovery band crosses; a physiological figure never does
 * Implemented by: PFOS Contract 12 / Phase 2.1 (spec 06-two-agent-vps)
 * Owning requirements: R7 (no figure crosses), R10 (exclusion), R6 (isolation)
 * Depends on: signalBus.ts, shapeGuards.ts (type level only)
 *
 * The recovery connector belongs to the life agent, which lives in the other repository
 * (steering §1, §6). This port exists on the finance side for one reason: the boundary shape has
 * to be agreed in one place, and the agreement is that recovery context reaches this deployment
 * as a **state**, never as data (steering §4.3).
 *
 * So the port is deliberately poorer than the upstream provider's API:
 *
 *  - {@link WhoopRecoveryState} is wrapped in `NoMagnitude`, so a recovery score, a variability
 *    reading, a resting rate, or a sleep duration cannot be added to it later without failing to
 *    compile. There is a band, and the band is an enum (§4.3.1).
 *  - There is no member that returns a raw sample, a series, or a document. A `readRecoveryState`
 *    that answers with a band is the whole surface.
 *  - The band maps one-to-one onto a bus payload, which is why `trend` reuses the bus's own
 *    {@link SignalDirection} rather than defining a second vocabulary that could drift into
 *    carrying a delta.
 *
 * `observedAt` is the read model's own timestamp, used to decide whether a band is stale. It is
 * envelope-level, exactly like the bus envelope's `ts`, and it does **not** cross into a payload —
 * §4.3.2 leaves the payload with no date field at all.
 *
 * Nothing here references content classified with an empty egress set (§4.4.3). The correct
 * posture for that category is exclusion, not filtering, so there is no code path for it and no
 * field that could point at one.
 */
import type { SignalDirection, SignalLevel } from './signalBus';
import type { NoMagnitude } from './shapeGuards';

/** A band. Not a score (§4.3.1). Three members, mirroring the bus levels one-to-one. */
export const WHOOP_RECOVERY_BANDS = ['low', 'moderate', 'high'] as const;
export type WhoopRecoveryBand = (typeof WHOOP_RECOVERY_BANDS)[number];

/**
 * The whole of what this tier may know about recovery. `NoMagnitude` is the trip-wire: any numeric
 * field added here becomes uninhabitable, so the addition is a compile error rather than a new
 * channel for a physiological figure.
 */
export type WhoopRecoveryState = NoMagnitude<{
  /** When the band was observed. Envelope-level, and never copied into a bus payload (§4.3.2). */
  readonly observedAt: string;
  readonly band: WhoopRecoveryBand;
  readonly trend?: SignalDirection;
}>;

/**
 * How a band becomes a bus level. Declared as a type rather than a table, because the mapping is
 * Phase 3's to implement and 2.1's only job is to fix the shape of the agreement.
 */
export type RecoveryBandToLevel = Readonly<Record<WhoopRecoveryBand, SignalLevel>>;

export interface WhoopRecoveryQuery {
  /** Oldest observation the caller will accept, so staleness is the caller's decision, not a default. */
  readonly notOlderThan: string;
}

/**
 * Unavailable is a first-class outcome, not an exception and not a silently substituted band. A
 * missing recovery signal must never be reported as `high` because the source was down.
 */
export type WhoopRecoveryOutcome =
  | { readonly outcome: 'available'; readonly state: WhoopRecoveryState }
  | { readonly outcome: 'unavailable'; readonly reason: WhoopUnavailableReason };

export const WHOOP_UNAVAILABLE_REASONS = ['source_unreachable', 'no_observation_within_window', 'state_uninterpretable'] as const;
export type WhoopUnavailableReason = (typeof WHOOP_UNAVAILABLE_REASONS)[number];

/** The recovery-context boundary. One member, and it answers with a band. */
export interface WhoopPort {
  readRecoveryState(query: WhoopRecoveryQuery): Promise<WhoopRecoveryOutcome>;
}

/**
 * Injected configuration. `accessTokenRef` names the environment entry that holds the credential;
 * no credential value and no provider address is expressible here (steering §2, §0b).
 */
export interface WhoopPortConfig {
  readonly apiBaseUrlRef: string;
  readonly accessTokenRef: string;
  readonly bandToLevel: RecoveryBandToLevel;
}
