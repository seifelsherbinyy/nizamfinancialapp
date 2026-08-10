/**
 * NIZAM · Deterministic WhoopPort mock — unavailable is an answer, never a substituted band
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Owning requirements: R7 (no figure crosses), R10 (exclusion), R6 (isolation)
 * Depends on: ../ports/whoop, ../ports/errors, ./invocationRecorder, ./failure
 *
 * The recovery connector itself belongs to the life agent in the other repository (steering §1,
 * §6). What this mock stands in for is the AGREEMENT: recovery context reaches this deployment as
 * a band, never as data. So the mock holds bands and nothing else — no score, no variability
 * reading, no sleep duration — which is not restraint on its part but a consequence of
 * `WhoopRecoveryState` being wrapped in `NoMagnitude` (§4.3.1).
 *
 * Determinism. No clock: staleness is decided against `query.notOlderThan`, the caller's own
 * bound, so the same observation set and the same query always give the same answer. Selection is
 * the newest qualifying observation, with the later entry winning a tie, so the result does not
 * depend on iteration luck.
 *
 * The failure paths a caller can drive:
 *   - **`source_unreachable`** — the connector could not be reached;
 *   - **`no_observation_within_window`** — reached, but nothing recent enough. This is the one
 *     that matters most: a stale `high` observation outside the window is reported as
 *     UNAVAILABLE, never as `high`, because a missing recovery signal that presents as good news
 *     is worse than no signal at all;
 *   - **`state_uninterpretable`** — an answer that cannot be read as a band;
 *   - and, for the two codes the failure vocabulary declares on this boundary, a rejection with
 *     `RECOVERY_SOURCE_UNAVAILABLE` or `RECOVERY_STATE_UNINTERPRETABLE`, so a caller that treats
 *     a throw and an outcome differently can be tested both ways.
 *
 * Timestamps are compared as strings, which is exact for the UTC `YYYY-MM-DDTHH:MM:SSZ` form this
 * tier uses everywhere. An offset-bearing timestamp would not compare correctly and is refused as
 * uninterpretable rather than silently mis-ordered.
 */
import type { PortFailureCode } from '../ports/errors.ts';
import type {
  WhoopPort,
  WhoopPortConfig,
  WhoopRecoveryOutcome,
  WhoopRecoveryQuery,
  WhoopRecoveryState,
  WhoopUnavailableReason,
} from '../ports/whoop.ts';
import { MockPortFailure } from './failure.ts';
import type { InvocationRecorder } from './invocationRecorder.ts';

/** The UTC instant form this tier uses. Anything else cannot be ordered by comparison. */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export interface WhoopMockConfig {
  readonly config: WhoopPortConfig;
  readonly recorder: InvocationRecorder;
  /** Bands the connector has observed. Order is irrelevant; the newest qualifying one wins. */
  readonly observations?: readonly WhoopRecoveryState[];
  /** Force the unavailable outcome, whatever the observations say. */
  readonly unavailable?: WhoopUnavailableReason;
  /** Force a rejection instead of an outcome, for the two codes this boundary declares. */
  readonly rejectWith?: Extract<PortFailureCode, 'RECOVERY_SOURCE_UNAVAILABLE' | 'RECOVERY_STATE_UNINTERPRETABLE'>;
}

export interface WhoopMock {
  readonly port: WhoopPort;
  readonly recorder: InvocationRecorder;
}

export function createWhoopMock(mockConfig: WhoopMockConfig): WhoopMock {
  const { config, recorder } = mockConfig;
  const observations = mockConfig.observations ?? [];

  const port: WhoopPort = {
    async readRecoveryState(query: WhoopRecoveryQuery): Promise<WhoopRecoveryOutcome> {
      recorder.record('whoop', 'readRecoveryState', {
        notOlderThan: query.notOlderThan,
        // A reference to an environment entry, never a credential value.
        accessTokenRef: config.accessTokenRef,
      });

      if (mockConfig.rejectWith !== undefined) {
        throw new MockPortFailure(mockConfig.rejectWith, 'NIZAM whoop mock: recovery context unavailable', null);
      }
      if (mockConfig.unavailable !== undefined) {
        return { outcome: 'unavailable', reason: mockConfig.unavailable };
      }
      if (!UTC_INSTANT.test(query.notOlderThan)) {
        return { outcome: 'unavailable', reason: 'state_uninterpretable' };
      }

      let newest: WhoopRecoveryState | null = null;
      for (const observation of observations) {
        if (!UTC_INSTANT.test(observation.observedAt)) {
          return { outcome: 'unavailable', reason: 'state_uninterpretable' };
        }
        if (observation.observedAt < query.notOlderThan) continue;
        // `>=` so a later entry wins a tie, which keeps selection independent of order.
        if (newest === null || observation.observedAt >= newest.observedAt) newest = observation;
      }

      // Nothing recent enough is UNAVAILABLE. It is never reported as a band (see the module note).
      if (newest === null) return { outcome: 'unavailable', reason: 'no_observation_within_window' };
      return { outcome: 'available', state: newest };
    },
  };

  return { port, recorder };
}
