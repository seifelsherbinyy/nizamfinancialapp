/**
 * NIZAM · The scheduler process — a clock, and the smallest of the six services
 * Implemented by: PFOS Contract 12 / Phase 10.20 (spec 06-two-agent-vps)
 * Owning requirements: R34 (a service this repository owns has a process, an image and an
 *   internal-only binding), R29 (the kill sentinel honoured in BOTH forms), R9 (dials the internal
 *   network only and binds NO public port), R27 (refuse to boot on an incomplete environment, naming
 *   every finding in one message), R22 (readiness as an exec check), R24 (no secret and no
 *   deployment particular)
 * Depends on: ../config/environment (the five entry names and the ONE refusal), ./haltGate (the halt,
 *   in both forms, REUSED rather than re-read), ./internalEndpoint (the endpoint rule, shared with
 *   the bus), ./liveness (the liveness record, shared with the bus and the finance agent),
 *   ../ops/healthProbe (the readiness answer). No socket, no filesystem, no clock of its own.
 *
 * ---
 *
 * ## Finding O2's other half
 *
 * `ops/docker-compose.yml` names six services. Tick delivery is owned HERE — the topology gives this
 * service the two tick endpoints, the internal tick network and its own healthcheck — and **no
 * process performed it**, which is why `ops/IMAGE_BUILD.md` carried `<SCHEDULER_IMAGE_REF>` as
 * `OWNED_BUILD_PENDING`. This module is that process. It follows the shape task 10.19 established
 * for the bus and task 10.7 established for the finance agent, and it is the smallest of the three
 * because it holds the least: no store, no credential, no model key, no bus endpoint, no cap.
 *
 * ## THE ONE PLACE THE BUS'S SHAPE DOES NOT TRANSFER: readiness without a store
 *
 * The bus's readiness answer rests on three store facts plus a liveness record beside the store. This
 * service **mounts no store at all** — contract 12 §3.2.2 permits it a read-only cross-store view and
 * it takes none, because a tick is a signal to the agent that owns a store rather than a query
 * against one — so `ops/docker-compose.yml` gives it no store volume, and the three store facts are
 * not merely unavailable to it, they are **meaningless** for it.
 *
 * Two things were needed, and neither is a weakening:
 *
 *  1. **A third probe mode.** `healthProbe.ts` now declares `storeless`, in which the three store
 *     checks are `not_applicable` and `queue_worker_alive` stays APPLICABLE — so this service is ready
 *     only when its own loop reports itself, which is the one check it cannot decline. It is a third
 *     mode rather than a second probe module because a hand-built report claiming `store_opens: pass`
 *     for a service with no store would be a lie in the artifact the orchestrator acts on, and a
 *     parallel vocabulary would give the deployment two readiness rules to keep in agreement. There
 *     is deliberately **no command-line flag** for the mode, so a service that HAS a store cannot ask
 *     for the leniency from an invocation.
 *  2. **Somewhere to put the liveness record.** The bus writes beside its store; this service has no
 *     volume. What it does have is the same **container** as its health command — an exec healthcheck
 *     runs inside the service's own container, which is the whole reason the bus's record works across
 *     a process boundary in the first place — so the record goes in the platform's temporary
 *     directory, supplied by `node:os` in `schedulerMain.ts` rather than written as a path here. Two
 *     consequences, both correct: the record does not survive a container restart, and a restarted
 *     container therefore reports not-ready until its new loop has recorded itself; and nothing about
 *     the record is a deployment particular, because no path was chosen by this repository (R24).
 *
 * ## The halt, and why this service uses the gate differently from an agent
 *
 * This service IS one of the four §8.2 names, unlike the bus: `SERVICE_ENTRY_NAMES.scheduler`
 * carries `KILL_SENTINEL_PATH` and `NIZAM_KILL_ALL`, and the topology mounts the sentinel volume into
 * it read-only. So the gate is REUSED whole, both forms: the file sentinel is re-read **per tick**,
 * because a halt that needs a restart is not a halt, and the coarse form is read once at boot,
 * because that is the only moment its value can have changed. An unreadable switch is treated as
 * **engaged**, and an unrecognised coarse value likewise — both already true of `haltGate.ts` and
 * neither restated here.
 *
 * What differs is the CALL: an agent calls `assertPermitted`, which raises, because an agent has a
 * caller to refuse. This service has none. A halted tick is not a refused request; it is a tick that
 * does not happen. So it consults {@link HaltGate.engagedForm} and delivers nothing, and
 * {@link HALTED_ACTIVITIES} is left exactly as R29 wrote it rather than widened to admit a fourth
 * activity that has no caller to inform.
 *
 * ## A failed tick is not a crash (and never a crash loop)
 *
 * The two targets are delivered **independently**, each with a bounded exponential backoff, and a
 * target that cannot be reached at all is recorded and abandoned for this tick. Nothing propagates out
 * of {@link SchedulerProcess.tickOnce}: `restart: unless-stopped` in the topology means a process that
 * exited on a failed dial would be restarted into the same failure, which is a crash loop that also
 * loses the OTHER agent's ticks. The next tick tries again from a clean slate, which is what a clock
 * is supposed to do.
 *
 * ## No secret, no particular, no figure (R24)
 *
 * No host, address, port, path, token or figure is written here. Both endpoints arrive from the
 * environment at run time and are refused unless they name an internal service and a port; the
 * cadence arrives from a third entry; the sentinel path is examined through an injected probe and is
 * never held. There is no money on this boundary and none can be: a tick carries no payload.
 */
import {
  parsePositiveIntegerEntry,
  requireServiceEnvironment,
  type DeploymentService,
  type EnvSource,
} from '../config/environment';
import { probeReadiness, type ProbeEnvironment, type ReadinessReport } from '../ops/healthProbe';
import { createHaltGate, killAllEngagedAtBoot, type HaltForm, type HaltGate } from './haltGate';
import { classifyInternalEndpoint, type InternalEndpoint, type InternalEndpointRefusal } from './internalEndpoint';
import { livenessIsFresh, type LivenessRecord } from './liveness';

// ---------------------------------------------------------------------------------------------
// Identity, and the five entries this service declares
// ---------------------------------------------------------------------------------------------

/** Which of the six services this process is. Named once, so no call site spells it. */
export const SCHEDULER_SERVICE: DeploymentService = 'scheduler';

/** The scheduler's entries, by NAME. `SERVICE_ENTRY_NAMES.scheduler` is the table; these are the reads. */
export const LIFE_TICK_ENDPOINT_ENTRY = 'LIFE_TICK_ENDPOINT';
export const FINANCE_TICK_ENDPOINT_ENTRY = 'FINANCE_TICK_ENDPOINT';
export const SCHEDULER_TICK_INTERVAL_ENTRY = 'SCHEDULER_TICK_INTERVAL';

/**
 * The two agents a tick is delivered to. A closed set, in delivery order, so "who gets a tick" is one
 * read rather than a grep — and so a third target would be a compile error rather than a config value.
 */
export const SCHEDULER_TARGETS = ['life', 'finance'] as const;
export type SchedulerTarget = (typeof SCHEDULER_TARGETS)[number];

/** Which entry names each target's endpoint. Stated as data so no branch spells an entry name. */
export const TARGET_ENDPOINT_ENTRIES: Readonly<Record<SchedulerTarget, string>> = Object.freeze({
  life: LIFE_TICK_ENDPOINT_ENTRY,
  finance: FINANCE_TICK_ENDPOINT_ENTRY,
});

/**
 * The cadence entry is read in **whole seconds**, and that is a decision worth recording.
 *
 * No artifact declares its unit: the fill-in sheet says "your choice of tick cadence" and the value
 * ledger says "operator choice of cadence". The convention this repository already follows is that an
 * entry whose name ends `_MS` is milliseconds — `STORE_BUSY_TIMEOUT_MS`, and every `*_TIMEOUT_MS` — so
 * an entry that does not say so is not milliseconds. Seconds is the unit an operator would write a
 * cadence in, and reading it as milliseconds would silently turn a sensible-looking value into a tick
 * storm against both agents. `ops/env/scheduler.env.example` now states the unit on the entry's own
 * `what:` line, so the operator is told rather than left to match this comment.
 */
export const TICK_INTERVAL_UNIT_MS = 1_000;

/**
 * The retry budget for ONE tick, per target. Bounded, so a target that is down cannot turn a clock
 * into a busy loop, and modest, so the retries finish well inside a normal cadence.
 */
export const SCHEDULER_TICK_RETRY_POLICY = { baseMs: 1_000, maxMs: 15_000, maxAttempts: 3 } as const;

/**
 * The file this process records its own liveness in. See the module note on where it lands: the
 * directory is supplied by the host, because this service mounts no volume and this repository
 * therefore chooses no path (R24).
 */
export const SCHEDULER_LIVENESS_FILE_NAME = 'scheduler-liveness';

/**
 * How stale this service's liveness record may be before readiness reports the loop stopped turning.
 *
 * Unlike the bus and the finance agent, this one cannot be a constant: the loop's period is the
 * operator's `SCHEDULER_TICK_INTERVAL`, so a fixed window would either fail a correctly configured
 * slow cadence or tolerate a wedged fast one. {@link schedulerStalenessWindowMs} derives it from the
 * configured cadence — several periods, so one slow tick is not an outage — with a floor so a very
 * short cadence still gets a usable window.
 */
export const SCHEDULER_STALENESS_PERIODS = 3;
export const SCHEDULER_STALENESS_FLOOR_MS = 30_000;

/** The staleness window for a given cadence. Never below the floor, and never below the cadence. */
export function schedulerStalenessWindowMs(tickIntervalMs: number): number {
  return Math.max(SCHEDULER_STALENESS_FLOOR_MS, tickIntervalMs * SCHEDULER_STALENESS_PERIODS);
}

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

export const SCHEDULER_PROCESS_ERROR_CODES = ['SCHEDULER_ENDPOINT_UNUSABLE', 'SCHEDULER_ALREADY_SHUTTING_DOWN'] as const;
export type SchedulerProcessErrorCode = (typeof SCHEDULER_PROCESS_ERROR_CODES)[number];

/** A typed refusal from the process itself. `subject` is an entry name, never a value. */
export class SchedulerProcessError extends Error {
  readonly code: SchedulerProcessErrorCode;
  readonly subject: string;
  readonly refusal: InternalEndpointRefusal | null;

  constructor(
    code: SchedulerProcessErrorCode,
    message: string,
    subject: string,
    refusal: InternalEndpointRefusal | null = null,
  ) {
    super(message);
    this.name = 'SchedulerProcessError';
    this.code = code;
    this.subject = subject;
    this.refusal = refusal;
  }
}

/**
 * Read one tick endpoint, or refuse the boot.
 *
 * The rule is the shared one (`./internalEndpoint.ts`), so the bus's eight refused shapes are this
 * service's eight refused shapes, and each of them is a way this clock ends up dialling somewhere
 * outside the internal network — which is the only way a service that holds no credential could
 * become dangerous.
 */
export function parseTickEndpoint(entry: string, raw: string): InternalEndpoint {
  const outcome = classifyInternalEndpoint(raw);
  if (!outcome.ok) {
    throw new SchedulerProcessError(
      'SCHEDULER_ENDPOINT_UNUSABLE',
      `NIZAM scheduler: ${entry} is not an internal endpoint this process may dial [${outcome.refusal}]. The accepted shape is an internal service name and a port; a scheme, a path, an address literal, a wildcard, a reserved name and an out-of-range port are each refused rather than coerced, because each is a way a tick leaves the internal network R9 confines it to.`,
      entry,
      outcome.refusal,
    );
  }
  return outcome.endpoint;
}

// ---------------------------------------------------------------------------------------------
// The injected boundaries
// ---------------------------------------------------------------------------------------------

/** What one delivery attempt answered. A verdict, never a body: a tick carries no payload. */
export type TickDeliveryOutcome = { readonly delivered: true } | { readonly delivered: false; readonly reason: string };

/**
 * **The whole of the dialling boundary, and it is injected.** `schedulerMain.ts` supplies the
 * platform's own client; a test supplies a recorder that reaches nothing. Nothing in this module
 * names a socket API.
 *
 * Note the signature: a target and an ENDPOINT THIS MODULE PARSED. There is no argument through which
 * a caller could hand it a scheme, a path or an address, because there is no such value in the type.
 *
 * `listen` is on this interface **so that its non-use is an observed fact rather than a silence.**
 * Design delta D6's rule is that an absence is asserted against the process's own state and the
 * injected host's own record, in both directions, rather than by probing a socket — and a record can
 * only be shown empty if the thing that would fill it exists. The real implementation **refuses**, so
 * a future edit that called it fails loudly instead of publishing a port.
 */
export interface SchedulerHost {
  deliverTick(target: SchedulerTarget, endpoint: InternalEndpoint): Promise<TickDeliveryOutcome>;
  /** Never called by this process. See above; the real one refuses. */
  listen(port: number): Promise<never>;
}

// ---------------------------------------------------------------------------------------------
// Dependencies and reports
// ---------------------------------------------------------------------------------------------

export interface SchedulerDependencies {
  /** This service's environment. Handed in, because the loader owns the one ambient bridge. */
  readonly env: EnvSource;
  readonly host: SchedulerHost;
  /** Does the halt sentinel exist right now? Consulted per tick, never cached. */
  readonly sentinelExists: () => boolean;
  /** Where this process records that its loop is turning, for the exec healthcheck (R22). */
  readonly liveness?: LivenessRecord;
  readonly now: () => string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly probeEnvironment?: ProbeEnvironment;
}

/** One delivery attempt's record. A target, a verdict, a count — nothing about a payload. */
export interface TickAttemptReport {
  readonly target: SchedulerTarget;
  readonly outcome: 'delivered' | 'abandoned';
  readonly attempts: number;
}

/** What one tick did. `halted` names the FORM when the halt was engaged, and no target was dialled. */
export interface TickReport {
  readonly at: string;
  readonly halted: HaltForm | null;
  readonly attempts: readonly TickAttemptReport[];
}

/** What one shutdown did. Counts and verdicts; this service holds nothing to report about. */
export interface SchedulerShutdownReport {
  readonly stoppedTicking: boolean;
  readonly livenessCleared: boolean;
  readonly ticksDelivered: number;
}

/** The host facilities that are not part of the scheduler's own work. */
export interface SchedulerProcessHost {
  onTerminationSignal(handler: () => void): void;
  /** Where a boot refusal goes. Separate from everything else: a refusal precedes the loop. */
  reportBootRefusal(message: string): void;
}

export interface SchedulerRunOutcome {
  readonly exitCode: 0 | 1;
  readonly ticks: number;
  readonly shutdown: SchedulerShutdownReport | null;
}

// ---------------------------------------------------------------------------------------------
// The process
// ---------------------------------------------------------------------------------------------

export interface SchedulerProcess {
  /** The two endpoints, parsed. Held so a test can read what the process will dial, and only that. */
  readonly endpoints: Readonly<Record<SchedulerTarget, InternalEndpoint>>;
  readonly tickIntervalMs: number;
  readonly stalenessWindowMs: number;
  readonly halt: HaltGate;
  /**
   * Every port this process has bound. **Always empty, and there is no branch that appends to it**:
   * this service is a client, it has no accept surface, and readiness is an exec check. This is the
   * set D6 asks the R9 claim to be asserted against.
   */
  readonly listeningPorts: readonly number[];
  isTicking(): boolean;
  /** One tick. Never throws: see the module note on why a failed tick is not a crash. */
  tickOnce(): Promise<TickReport>;
  /** Tick until shutdown is requested, sleeping the configured cadence between ticks. */
  runUntilShutdown(): Promise<number>;
  /** The readiness answer, computed in process against the liveness record alone (R22). */
  readiness(): ReadinessReport;
  shutdown(): Promise<SchedulerShutdownReport>;
}

/**
 * Boot the scheduler.
 *
 * The order is load-bearing. The environment is refused FIRST, because every step after it consumes a
 * value the refusal would have named. The halt is built second, so an already-halted deployment is
 * observed before anything else exists. The endpoints are parsed third, so a clock pointed somewhere
 * it must not dial fails before it has delivered anything. Nothing is bound at any point.
 *
 * @throws {EnvConfigAggregateError} naming EVERY missing, empty or unsubstituted entry at once (R27).
 *   Deliberately not caught: a booted-but-unconfigured clock is the failure fail-closed exists to
 *   prevent, and it would deliver ticks nowhere while reporting itself healthy.
 * @throws {SchedulerProcessError} when either tick endpoint is not an internal endpoint.
 */
export function bootScheduler(deps: SchedulerDependencies): SchedulerProcess {
  // 1. Fail closed on an incomplete environment, naming every finding in one message (R27).
  requireServiceEnvironment({ service: SCHEDULER_SERVICE, env: deps.env });

  // 2. The halt, both forms. The coarse form is read exactly once, here; the sentinel per tick.
  const halt = createHaltGate({ sentinelExists: deps.sentinelExists, killAllAtBoot: killAllEngagedAtBoot(deps.env) });

  // 3. Where a tick may go, and the refusal of anywhere else (R9).
  const endpoints: Record<SchedulerTarget, InternalEndpoint> = {
    life: parseTickEndpoint(LIFE_TICK_ENDPOINT_ENTRY, String(deps.env[LIFE_TICK_ENDPOINT_ENTRY] ?? '')),
    finance: parseTickEndpoint(FINANCE_TICK_ENDPOINT_ENTRY, String(deps.env[FINANCE_TICK_ENDPOINT_ENTRY] ?? '')),
  };

  // 4. The cadence. A positive integer of whole seconds; zero is not reachable, because a zero
  //    cadence is a tick storm rather than a fast clock.
  const tickIntervalMs =
    parsePositiveIntegerEntry(
      deps.env,
      SCHEDULER_TICK_INTERVAL_ENTRY,
      'must be a positive integer of whole seconds written as a bare run of digits; a zero cadence is a tick storm against both agents rather than a fast clock',
    ) * TICK_INTERVAL_UNIT_MS;
  const stalenessWindowMs = schedulerStalenessWindowMs(tickIntervalMs);

  let shuttingDown = false;
  let ticksDelivered = 0;
  // Empty, and nothing below pushes to it. A `const` with no writer is the structural half of R9.
  const listeningPorts: readonly number[] = [];

  const recordLiveness = (): void => {
    try {
      deps.liveness?.touch();
    } catch {
      // Already reported: an absent record is not fresh, so readiness answers not-ready. Raising here
      // would turn an unwritable directory into a crash on a service whose whole job is to keep going.
    }
  };

  /** One target, with a bounded backoff. Answers a record; never throws. */
  const deliverTo = async (target: SchedulerTarget): Promise<TickAttemptReport> => {
    let delay: number = SCHEDULER_TICK_RETRY_POLICY.baseMs;
    for (let attempt = 1; attempt <= SCHEDULER_TICK_RETRY_POLICY.maxAttempts; attempt += 1) {
      let outcome: TickDeliveryOutcome;
      try {
        outcome = await deps.host.deliverTick(target, endpoints[target]);
      } catch {
        // A client that raises is a failed delivery and nothing more. The reason is deliberately not
        // carried: it could hold an address, and a tick report is not a place for one (R24).
        outcome = { delivered: false, reason: 'delivery_raised' };
      }
      if (outcome.delivered) return { target, outcome: 'delivered', attempts: attempt };
      if (attempt < SCHEDULER_TICK_RETRY_POLICY.maxAttempts) {
        await deps.sleep(delay);
        delay = Math.min(delay * 2, SCHEDULER_TICK_RETRY_POLICY.maxMs);
      }
    }
    // Abandoned for THIS tick only. The next one starts from a clean slate, which is what a clock does.
    return { target, outcome: 'abandoned', attempts: SCHEDULER_TICK_RETRY_POLICY.maxAttempts };
  };

  const tickOnce = async (): Promise<TickReport> => {
    // The liveness record is written whatever the halt says: a halted scheduler is RUNNING and
    // correctly delivering nothing, so reporting it unhealthy would have the orchestrator restart a
    // service that is doing exactly what the operator asked.
    recordLiveness();
    const at = deps.now();

    // Re-read per tick, never cached. A halt that needs a restart is not a halt (§8, key decision 7).
    const halted = halt.engagedForm();
    if (halted !== null) return { at, halted, attempts: [] };

    // Independently, so one unreachable agent does not cost the other its tick.
    const attempts: TickAttemptReport[] = [];
    for (const target of SCHEDULER_TARGETS) {
      const report = await deliverTo(target);
      if (report.outcome === 'delivered') ticksDelivered += 1;
      attempts.push(report);
    }
    return { at, halted: null, attempts };
  };

  return {
    endpoints,
    tickIntervalMs,
    stalenessWindowMs,
    halt,
    listeningPorts,
    isTicking: () => !shuttingDown,
    tickOnce,

    async runUntilShutdown(): Promise<number> {
      let ticks = 0;
      while (!shuttingDown) {
        ticks += 1;
        await tickOnce();
        if (shuttingDown) break;
        await deps.sleep(tickIntervalMs);
      }
      return ticks;
    },

    readiness(): ReadinessReport {
      return probeReadiness(
        { mode: 'storeless' },
        {
          ...deps.probeEnvironment,
          // The one applicable fact, and it is about something other than this method's own
          // execution: shutdown has not begun, and the record this process writes per tick is fresh.
          // A service with no liveness record injected can never answer ready, which is the
          // fail-closed direction — there would be nothing for the exec check to read either.
          queueWorkerAlive: () =>
            !shuttingDown &&
            deps.liveness !== undefined &&
            livenessIsFresh(deps.liveness.ageMs(), stalenessWindowMs),
        },
      );
    },

    async shutdown(): Promise<SchedulerShutdownReport> {
      // 1. Stop ticking first, so nothing new is dialled while the rest settles.
      shuttingDown = true;

      // 2. Clear the liveness record, so the next exec check reports not-ready at once rather than
      //    after the window. Nothing else has to be torn down: no store, no listener, no credential.
      let livenessCleared = false;
      try {
        deps.liveness?.clear();
        livenessCleared = true;
      } catch {
        livenessCleared = false;
      }

      return { stoppedTicking: true, livenessCleared, ticksDelivered };
    },
  };
}

/**
 * Boot, tick until a termination signal, shut down cleanly, and answer with an exit status.
 *
 * A boot refusal is reported and becomes exit code 1. It is NOT swallowed into a degraded run: a
 * scheduler that came up without endpoints would deliver ticks nowhere while reporting itself healthy,
 * and both agents would go un-ticked with nothing anywhere saying so.
 */
export async function runSchedulerProcess(
  deps: SchedulerDependencies,
  host: SchedulerProcessHost,
): Promise<SchedulerRunOutcome> {
  let scheduler: SchedulerProcess;
  try {
    scheduler = bootScheduler(deps);
  } catch (cause) {
    // The message names entries, rules and codes and never a value, so it is emitted in full: that is
    // the whole point of the aggregate — one restart answers the whole question (R24, R27).
    host.reportBootRefusal(cause instanceof Error ? cause.message : String(cause));
    return { exitCode: 1, ticks: 0, shutdown: null };
  }

  let shutdownPromise: Promise<SchedulerShutdownReport> | null = null;
  host.onTerminationSignal(() => {
    if (shutdownPromise === null) shutdownPromise = scheduler.shutdown();
  });

  const ticks = await scheduler.runUntilShutdown();
  const shutdown = await (shutdownPromise ?? scheduler.shutdown());
  return { exitCode: 0, ticks, shutdown };
}
