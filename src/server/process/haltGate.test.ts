// @vitest-environment node
/**
 * NIZAM · The halt, both forms — and the activity it must never reach
 * Implemented by: PFOS Contract 12 / Phase 10.7 (spec 06-two-agent-vps)
 * Owning requirements: R29 (the sentinel file is checked PER CALL; `NIZAM_KILL_ALL=1` is the coarse
 *   form honoured at boot), R17 (a halt never suppresses a deterministic obligation alert)
 * Depends on: ./haltGate. No filesystem, no clock — the sentinel probe is injected, which is what
 *   makes "per call" observable rather than asserted.
 *
 * The load-bearing case is the second one. "Checked per call" cannot be proved by a single check: a
 * gate that read the sentinel once at construction and cached it would pass any test that only ever
 * asks after engaging it. So the assertion below flips the probe BETWEEN two calls on the SAME gate,
 * in both directions, and asserts the answer changed. That is the only shape a cached read fails.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTIVITIES_A_HALT_NEVER_STOPS,
  createHaltGate,
  HALTED_ACTIVITIES,
  HALT_ENGAGED_VALUE,
  HALT_ENV_ENTRY,
  HALT_RELEASED_VALUE,
  HaltEngagedError,
  killAllEngagedAtBoot,
  type HaltForm,
  type HaltedActivity,
} from './haltGate';

function refusalOf(run: () => void): HaltEngagedError | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HaltEngagedError ? error : null;
  }
}

describe('the coarse form, read once at boot (R29)', () => {
  it('engages on the engaged value and stands down on the released one', () => {
    expect(killAllEngagedAtBoot({ [HALT_ENV_ENTRY]: HALT_ENGAGED_VALUE })).toBe(true);
    expect(killAllEngagedAtBoot({ [HALT_ENV_ENTRY]: HALT_RELEASED_VALUE })).toBe(false);
    expect(killAllEngagedAtBoot({ [HALT_ENV_ENTRY]: ` ${HALT_ENGAGED_VALUE} ` })).toBe(true);
  });

  it('engages on a value nobody meant, because a switch that cannot be read is treated as on', () => {
    for (const unreadable of ['yes', 'true', '2', '01', '']) {
      expect(killAllEngagedAtBoot({ [HALT_ENV_ENTRY]: unreadable }), unreadable).toBe(true);
    }
  });

  it('leaves an absent entry to the completeness pass rather than refusing for a reason it does not own', () => {
    expect(killAllEngagedAtBoot({})).toBe(false);
  });
});

describe('the sentinel form is re-read on every call (R29, design key decision 7)', () => {
  it('changes its answer when the sentinel is flipped between two calls on the same gate', () => {
    let present = false;
    const gate = createHaltGate({ sentinelExists: () => present, killAllAtBoot: false });

    expect(gate.isHalted()).toBe(false);
    present = true;
    // A gate that had cached the construction-time read would still answer false here.
    expect(gate.isHalted()).toBe(true);
    present = false;
    // And a gate that cached the FIRST engaged read would still answer true here.
    expect(gate.isHalted()).toBe(false);
  });

  it('reports the sentinel form in preference to the coarse one when both are engaged', () => {
    const gate = createHaltGate({ sentinelExists: () => true, killAllAtBoot: true });
    expect(gate.engagedForm()).toBe<HaltForm>('sentinel');
  });

  it('treats a sentinel probe that threw as present, because "we could not tell" is not a licence', () => {
    const gate = createHaltGate({
      sentinelExists: () => {
        throw new Error('the mount is unreadable');
      },
      killAllAtBoot: false,
    });
    expect(gate.engagedForm()).toBe<HaltForm>('sentinel');
  });
});

describe('what a halt stops, and what it does not (R29, R17)', () => {
  it('refuses every one of the three activities under the sentinel, naming the activity and the form', () => {
    const observed: string[] = [];
    const gate = createHaltGate({
      sentinelExists: () => true,
      killAllAtBoot: false,
      onObservation: (form, activity) => observed.push(`${form}:${String(activity)}`),
    });

    for (const activity of HALTED_ACTIVITIES) {
      const refusal = refusalOf(() => gate.assertPermitted(activity));
      expect(refusal, activity).not.toBeNull();
      expect(refusal?.code).toBe('MODEL_KILL_SWITCH_ENGAGED');
      expect(refusal?.activity).toBe<HaltedActivity>(activity);
      expect(refusal?.form).toBe<HaltForm>('sentinel');
    }
    expect(observed).toEqual(HALTED_ACTIVITIES.map((a) => `sentinel:${a}`));
  });

  it('refuses the same three under the coarse form alone', () => {
    const gate = createHaltGate({ sentinelExists: () => false, killAllAtBoot: true });
    for (const activity of HALTED_ACTIVITIES) {
      expect(refusalOf(() => gate.assertPermitted(activity))?.form, activity).toBe<HaltForm>('env');
    }
  });

  it('permits all three when neither form is engaged', () => {
    const gate = createHaltGate({ sentinelExists: () => false, killAllAtBoot: false });
    for (const activity of HALTED_ACTIVITIES) {
      expect(refusalOf(() => gate.assertPermitted(activity)), activity).toBeNull();
    }
  });

  it('permits a deterministic alert under both forms at once — a halt is not a blackout', () => {
    const gate = createHaltGate({ sentinelExists: () => true, killAllAtBoot: true });
    expect(gate.isHalted()).toBe(true);
    expect(gate.deterministicAlertsPermitted()).toBe(true);
    expect([...ACTIVITIES_A_HALT_NEVER_STOPS]).toEqual(['deterministic_alert']);
  });

  it('covers exactly R29\'s three activities, so a fourth cannot be added without noticing', () => {
    expect([...HALTED_ACTIVITIES]).toEqual(['model_call', 'model_path_write', 'bus_publish']);
  });
});
