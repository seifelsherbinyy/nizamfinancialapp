/**
 * NIZAM · The halt, in both of its forms — and the one activity it never touches
 * Implemented by: PFOS Contract 12 / Phase 10.7 (spec 06-two-agent-vps)
 * Owning requirements: R29 (the kill sentinel in both forms halts model calls, model-path writes
 *   and bus publishes), R17 (deterministic obligation alerts are produced anyway — a halt is a
 *   spend and write guard, never a blackout)
 * Depends on: ../config/environment (the entry NAME and the mount target), ../ports/errors (codes
 *   only). No filesystem module, no clock, no environment read of its own.
 *
 * Contract 12 §8 gives the halt two forms, and design key decision 7 says why there are two rather
 * than one:
 *
 *  - **The file sentinel** at `KILL_SENTINEL_PATH` is the operative one, and it is consulted **per
 *    call**. An environment variable cannot be flipped without a restart, and a halt that needs a
 *    restart is not a halt — by the time the operator has restarted the process, whatever they were
 *    trying to stop has already happened. So {@link HaltGate.engagedForm} re-reads the sentinel on
 *    every single call and caches nothing. `sentinelExists` is injected for exactly that reason:
 *    this module holds no path and opens no file, so a test flips the halt between two calls without
 *    touching a disk, which is the only way "per call" is observable rather than asserted.
 *  - **`NIZAM_KILL_ALL=1`** is the coarse form and is read **once, at boot**, because that is the
 *    only moment at which its value can have changed. Reading it repeatedly would imply it could be
 *    flipped live, which would be a false promise about the weaker of the two forms.
 *
 * **What a halt stops, and what it must not.** {@link HALTED_ACTIVITIES} is R29's list, verbatim and
 * closed: a model call, a write on the model path, a bus publish. {@link ACTIVITIES_A_HALT_NEVER_STOPS}
 * is R17's other half, and it is a named constant rather than a comment because the failure it
 * forbids is the worst one this system could have — losing a due-date warning because a halt was
 * engaged. The deterministic engines take no model port and no bus port, so they cannot be reached
 * from here at all; {@link HaltGate.deterministicAlertsPermitted} returns `true` unconditionally and
 * has no branch that could ever return otherwise, which is the structural half of the same claim.
 *
 * **An unrecognised coarse value halts.** `1` engages and `0` does not; anything else is a value
 * nobody meant, and the fail-closed answer to a halt switch whose position cannot be read is that it
 * is engaged. Opening the door on an unparseable value would be the one direction this repository
 * never takes (steering §2).
 *
 * No path, no host, no token and no figure appears here (R24), and a refusal carries an activity name
 * and a form name — both enumerated — so an error reaching a log discloses nothing (R19).
 */
import { KILL_SENTINEL_ENTRY, KILL_SENTINEL_MOUNT_TARGET, type EnvSource } from '../config/environment';
import type { PortFailureCode } from '../ports/errors';

/** The two forms §8 gives the halt. `sentinel` is live; `env` is restart-scoped. */
export const HALT_FORMS = ['sentinel', 'env'] as const;
export type HaltForm = (typeof HALT_FORMS)[number];

/** The coarse form's entry name and the one value that engages it. */
export const HALT_ENV_ENTRY = 'NIZAM_KILL_ALL';
export const HALT_ENGAGED_VALUE = '1';
export const HALT_RELEASED_VALUE = '0';

/**
 * Everything a halt stops (R29). A closed set, so "what a halt covers" is one read rather than a
 * grep for call sites.
 */
export const HALTED_ACTIVITIES = ['model_call', 'model_path_write', 'bus_publish'] as const;
export type HaltedActivity = (typeof HALTED_ACTIVITIES)[number];

/**
 * The other half of R17, written down. A deterministic obligation alert is produced under a halt,
 * unchanged, because it needs no model and no bus. This is a constant rather than a sentence in a
 * comment so a future edit that wanted to gate it would have to delete a named guarantee.
 */
export const ACTIVITIES_A_HALT_NEVER_STOPS = ['deterministic_alert'] as const;
export type ActivityAHaltNeverStops = (typeof ACTIVITIES_A_HALT_NEVER_STOPS)[number];

/** The entry name and mount the sentinel path is validated against, re-exported for one import site. */
export { KILL_SENTINEL_ENTRY, KILL_SENTINEL_MOUNT_TARGET };

/**
 * A refused activity. The code is the port's existing `MODEL_KILL_SWITCH_ENGAGED` rather than a new
 * one, because a caller already discriminating on that code must not have to learn a second spelling
 * of the same fact.
 */
export class HaltEngagedError extends Error {
  readonly code: Extract<PortFailureCode, 'MODEL_KILL_SWITCH_ENGAGED'> = 'MODEL_KILL_SWITCH_ENGAGED';
  readonly activity: HaltedActivity;
  readonly form: HaltForm;

  constructor(activity: HaltedActivity, form: HaltForm) {
    super(
      `NIZAM halt: ${activity} is refused because the halt is engaged in its ${form} form (contract 12 §8, R29). Deterministic obligation alerts are unaffected and are still produced (R17).`,
    );
    this.name = 'HaltEngagedError';
    this.activity = activity;
    this.form = form;
  }
}

/**
 * Read the coarse form ONCE, from an injected environment.
 *
 * Returns `true` for the engaged value and for any value that is neither of the two it recognises;
 * `false` only for the released value. An absent entry is `false`, because the completeness pass in
 * `requireServiceEnvironment` is what refuses an absent entry, and duplicating that refusal here
 * would make this function fail for a reason it does not own.
 */
export function killAllEngagedAtBoot(env: EnvSource): boolean {
  const raw = env[HALT_ENV_ENTRY];
  if (raw === undefined) return false;
  const value = raw.trim();
  if (value === HALT_RELEASED_VALUE) return false;
  if (value === HALT_ENGAGED_VALUE) return true;
  // A switch whose position cannot be read is treated as engaged. See the module note.
  return true;
}

/** Where a halt observation goes. Injected, so this module owns no sink and no log. */
export type HaltObservationSink = (form: HaltForm, activity: HaltedActivity | null) => void;

/** What the gate needs. Both forms injected; nothing ambient, nothing cached. */
export interface HaltGateContext {
  /**
   * Does the sentinel exist right now? Called on EVERY check, never memoised by this module. A host
   * supplies a filesystem existence test; a test supplies a mutable boolean.
   */
  readonly sentinelExists: () => boolean;
  /** The coarse form as read at boot. See {@link killAllEngagedAtBoot}. */
  readonly killAllAtBoot: boolean;
  readonly onObservation?: HaltObservationSink;
}

export interface HaltGate {
  /**
   * The form engaged right now, or `null`. The sentinel is checked first and is re-read on every
   * call, so a sentinel touched a microsecond ago is observed by the next activity.
   */
  engagedForm(): HaltForm | null;
  isHalted(): boolean;
  /**
   * Refuse one activity if the halt is engaged. Called immediately before the activity, so the
   * activity has not begun when the refusal is raised.
   *
   * @throws {HaltEngagedError} with the activity and the engaged form.
   */
  assertPermitted(activity: HaltedActivity): void;
  /** Always `true`, and there is no branch that could make it otherwise (R17). */
  deterministicAlertsPermitted(): boolean;
}

/**
 * Build the gate. A sentinel that cannot be tested — the injected probe threw — is treated as
 * PRESENT, because "we could not tell whether the operator has halted us" is not a licence to carry
 * on spending.
 */
export function createHaltGate(ctx: HaltGateContext): HaltGate {
  const sentinelPresent = (): boolean => {
    try {
      return ctx.sentinelExists() === true;
    } catch {
      return true;
    }
  };

  const engagedForm = (): HaltForm | null => {
    if (sentinelPresent()) return 'sentinel';
    if (ctx.killAllAtBoot) return 'env';
    return null;
  };

  return {
    engagedForm,
    isHalted: () => engagedForm() !== null,
    assertPermitted(activity: HaltedActivity): void {
      const form = engagedForm();
      if (form === null) return;
      ctx.onObservation?.(form, activity);
      throw new HaltEngagedError(activity, form);
    },
    deterministicAlertsPermitted: () => true,
  };
}
