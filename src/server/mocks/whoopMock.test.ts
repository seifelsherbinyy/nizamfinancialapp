// @vitest-environment node
/**
 * NIZAM · The recovery mock never substitutes a band — contract 12 §4.3 (R7, R10)
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Depends on: ./whoopMock, ./invocationRecorder, ./fixtures, ../ports/whoop
 *
 * The assertion that matters most is the third describe block: a stale `high` observation outside the
 * caller's window is reported UNAVAILABLE, not `high`. A missing recovery signal that presents as
 * good news is worse than no signal at all, which is why `WhoopRecoveryOutcome` makes unavailability
 * a first-class shape rather than an absent field a caller might default.
 *
 * Everything here is a band. There is no score, no variability reading and no sleep duration to
 * assert on, because `NoMagnitude` makes a numeric field on the state uninhabitable (§4.3.1).
 */
import { describe, expect, it } from 'vitest';

import { MockPortFailure } from './failure.ts';
import { loadRecordedInteractions, nodeFixtureSource } from './fixtures.ts';
import { createInvocationRecorder } from './invocationRecorder.ts';
import { createWhoopMock, type WhoopMockConfig } from './whoopMock.ts';
import type { WhoopPortConfig, WhoopRecoveryState } from '../ports/whoop.ts';

const CONFIG: WhoopPortConfig = {
  apiBaseUrlRef: 'RECOVERY_API_BASE_REF',
  accessTokenRef: 'RECOVERY_ACCESS_TOKEN_REF',
  bandToLevel: { low: 'red', moderate: 'amber', high: 'green' },
};

const FRESH: WhoopRecoveryState = { observedAt: '2026-03-02T06:00:00Z', band: 'moderate', trend: 'hold' };
const STALE_HIGH: WhoopRecoveryState = { observedAt: '2026-02-18T06:00:00Z', band: 'high' };
const WINDOW = { notOlderThan: '2026-03-01T00:00:00Z' };

function mockWith(overrides: Partial<WhoopMockConfig> = {}) {
  const recorder = createInvocationRecorder();
  return createWhoopMock({ config: CONFIG, recorder, ...overrides });
}

describe('a band inside the window is available', () => {
  it('answers with the observation and its trend, and records only references', async () => {
    const mock = mockWith({ observations: [FRESH] });
    await expect(mock.port.readRecoveryState(WINDOW)).resolves.toEqual({ outcome: 'available', state: FRESH });
    expect(mock.recorder.callsTo('whoop', 'readRecoveryState')[0]?.detail).toEqual({
      notOlderThan: WINDOW.notOlderThan,
      accessTokenRef: CONFIG.accessTokenRef,
    });
  });

  it('picks the newest qualifying observation regardless of the order it was given', async () => {
    const older: WhoopRecoveryState = { observedAt: '2026-03-01T06:00:00Z', band: 'low' };
    const forward = mockWith({ observations: [older, FRESH] });
    const backward = mockWith({ observations: [FRESH, older] });
    await expect(forward.port.readRecoveryState(WINDOW)).resolves.toEqual({
      outcome: 'available',
      state: FRESH,
    });
    await expect(backward.port.readRecoveryState(WINDOW)).resolves.toEqual(
      await forward.port.readRecoveryState(WINDOW),
    );
  });

  it('reads no clock: the same observations and window always give the same answer', async () => {
    const first = await mockWith({ observations: [FRESH, STALE_HIGH] }).port.readRecoveryState(WINDOW);
    const second = await mockWith({ observations: [FRESH, STALE_HIGH] }).port.readRecoveryState(WINDOW);
    expect(first).toEqual(second);
  });

  it('carries a band and no magnitude (§4.3.1)', async () => {
    const outcome = await mockWith({ observations: [FRESH] }).port.readRecoveryState(WINDOW);
    if (outcome.outcome !== 'available') throw new Error('the fresh observation must be available');
    for (const value of Object.values(outcome.state)) expect(typeof value).not.toBe('number');
  });
});

describe('a stale observation is UNAVAILABLE, never a substituted band', () => {
  it('does not report a stale high as high', async () => {
    const mock = mockWith({ observations: [STALE_HIGH] });
    const outcome = await mock.port.readRecoveryState(WINDOW);
    expect(outcome).toEqual({ outcome: 'unavailable', reason: 'no_observation_within_window' });
    expect(JSON.stringify(outcome)).not.toContain('high');
  });

  it('reports the same high as available once the window admits it, so the gate is not blanket', async () => {
    const mock = mockWith({ observations: [STALE_HIGH] });
    await expect(mock.port.readRecoveryState({ notOlderThan: '2026-02-01T00:00:00Z' })).resolves.toEqual({
      outcome: 'available',
      state: STALE_HIGH,
    });
  });

  it('reports unavailable when there is no observation at all', async () => {
    await expect(mockWith().port.readRecoveryState(WINDOW)).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'no_observation_within_window',
    });
  });
});

describe('the other unavailable reasons, and the two declared rejections', () => {
  it('reports an unreachable source', async () => {
    const mock = mockWith({ observations: [FRESH], unavailable: 'source_unreachable' });
    await expect(mock.port.readRecoveryState(WINDOW)).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'source_unreachable',
    });
  });

  it('reports an uninterpretable state, and treats an offset-bearing instant as one', async () => {
    await expect(
      mockWith({ observations: [FRESH], unavailable: 'state_uninterpretable' }).port.readRecoveryState(WINDOW),
    ).resolves.toEqual({ outcome: 'unavailable', reason: 'state_uninterpretable' });

    // An offset-bearing timestamp cannot be ordered by comparison, so it is refused rather
    // than silently mis-ordered against the UTC instants this tier uses.
    await expect(
      mockWith({ observations: [FRESH] }).port.readRecoveryState({ notOlderThan: '2026-03-01T00:00:00+02:00' }),
    ).resolves.toEqual({ outcome: 'unavailable', reason: 'state_uninterpretable' });

    await expect(
      mockWith({ observations: [{ observedAt: '2026-03-02', band: 'high' }] }).port.readRecoveryState(WINDOW),
    ).resolves.toEqual({ outcome: 'unavailable', reason: 'state_uninterpretable' });
  });

  it('rejects with the two codes the failure vocabulary declares on this boundary', async () => {
    await expect(
      mockWith({ rejectWith: 'RECOVERY_SOURCE_UNAVAILABLE' }).port.readRecoveryState(WINDOW),
    ).rejects.toBeInstanceOf(MockPortFailure);
    await expect(
      mockWith({ rejectWith: 'RECOVERY_STATE_UNINTERPRETABLE' }).port.readRecoveryState(WINDOW),
    ).rejects.toMatchObject({ code: 'RECOVERY_STATE_UNINTERPRETABLE' });
  });
});

describe('the recorded fixture supplies the same two observations (steering §3)', () => {
  it('replays a fresh band and a stale one, which is what the window test needs', async () => {
    const loaded = loadRecordedInteractions(nodeFixtureSource(), 'two-agent-smoke');
    const mock = mockWith({ observations: loaded.set.recoveryObservations });
    const inWindow = await mock.port.readRecoveryState(WINDOW);
    expect(inWindow).toEqual({ outcome: 'available', state: FRESH });
    const wideOpen = await mock.port.readRecoveryState({ notOlderThan: '2026-01-01T00:00:00Z' });
    // The newest still wins when the window admits both, so staleness never outranks recency.
    expect(wideOpen).toEqual({ outcome: 'available', state: FRESH });
  });
});
