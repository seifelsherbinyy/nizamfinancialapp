/**
 * NIZAM · The scheduler entrypoint — the one file in the scheduler tier that touches the platform
 * Implemented by: PFOS Contract 12 / Phase 10.20 (spec 06-two-agent-vps)
 * Owning requirements: R34 (the process, its image and its internal-only dialling), R9 (dials the
 *   internal network only, binds NO public port), R22 (the readiness command the compose healthcheck
 *   resolves to), R27 (a boot refusal naming every incomplete entry at once), R29 (the halt, in both
 *   forms, with the sentinel re-read per tick)
 * Depends on: ./scheduler, ../config/environment (the ONE ambient bridge), ./liveness (the SHARED
 *   liveness record), `node:http`, `node:fs`, `node:os`, `node:process`. Nothing else.
 *
 * Started by the image's entry point. Two modes, selected by the argument vector, exactly as
 * `main.ts` and `busMain.ts` do:
 *
 *  - **default** — boot the scheduler, tick until a termination signal, shut down cleanly, exit 0. A
 *    boot refusal is reported and exits **non-zero**; there is no degraded run.
 *  - **`--health`** — answer readiness and exit 0 or 1. This is what `<SCHEDULER_HEALTH_PROBE>` in
 *    `ops/docker-compose.yml` resolves to, and it is a COMMAND rather than an endpoint, which is why
 *    the healthcheck needs no port and why this service can bind nothing at all.
 *
 * ## Where the liveness record lands, and why that is the honest answer for this service
 *
 * The bus and the finance agent write their record beside their store, on their own volume. This
 * service **mounts no volume** — no store, and §3.2.2's read-only cross-store view deliberately
 * declined — so there is no such place. What it does have is the same **container** as its health
 * command: an exec healthcheck runs inside the service's own container, which is the reason the
 * record works across a process boundary in the first place. So the record goes in the platform's
 * temporary directory, read from `node:os` rather than written down here.
 *
 * Two consequences, both correct rather than tolerated. The record does not survive a container
 * restart, so a restarted container reports not-ready until its new loop has recorded itself — which
 * is exactly what should happen, because the old loop's evidence says nothing about the new one. And
 * no path in this repository names it, so nothing here is a deployment particular (R24).
 *
 * ## The dialling client is written, and nothing here runs it
 *
 * Steering §2 permits building a boundary and gates exercising one. {@link createNodeHttpSchedulerHost}
 * is the adapter this service would use on the host; every test drives an injected recorder instead,
 * and no test, script or check in this repository dials anything. The client takes a target and an
 * endpoint **this repository already parsed** — there is no argument through which a scheme, a path or
 * an address could reach it — and its `listen` half refuses, so a future edit that tried to give this
 * service an accept surface fails loudly rather than publishing a port.
 *
 * No host, path, port, token or figure is written here (R24). Every value comes from the environment
 * at run time.
 */
import { existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import nodeProcess from 'node:process';

import { processEnvSource } from '../config/environment';
import { probeExitCode, probeReadiness, type ReadinessReport } from '../ops/healthProbe';
import { createFileLivenessRecord, livenessIsFresh } from './liveness';
import {
  bootScheduler,
  runSchedulerProcess,
  SCHEDULER_LIVENESS_FILE_NAME,
  SCHEDULER_TICK_INTERVAL_ENTRY,
  schedulerStalenessWindowMs,
  TICK_INTERVAL_UNIT_MS,
  type SchedulerDependencies,
  type SchedulerHost,
  type SchedulerProcessHost,
  type SchedulerRunOutcome,
  type SchedulerTarget,
  type TickDeliveryOutcome,
} from './scheduler';
import type { InternalEndpoint } from './internalEndpoint';

/** The flag that selects the readiness answer instead of the clock. */
export const SCHEDULER_HEALTH_FLAG = '--health';

/** The signals a clean shutdown is asked for with. */
export const SCHEDULER_TERMINATION_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/** The path a tick is delivered to on an agent, and the method. One route, and there is no other. */
export const TICK_PATH = '/tick';
export const TICK_METHOD = 'POST';

/** How long one delivery attempt may take before it is a failure. A bound, not a policy. */
export const TICK_REQUEST_TIMEOUT_MS = 5_000;

/** The directory the liveness record lives in. Supplied by the platform, chosen by nobody here. */
export function schedulerRecordDirectory(): string {
  return tmpdir();
}

// ---------------------------------------------------------------------------------------------
// The dialling boundary, on the platform's own client
// ---------------------------------------------------------------------------------------------

/**
 * The scheduler's host boundary: it dials, and it refuses to listen.
 *
 * A tick carries **no body**. It is a signal that a moment has arrived, and the agent decides what a
 * moment means; sending a payload would make this service a source of instructions rather than a
 * clock, and it holds no credential with which to be trusted as one.
 */
export function createNodeHttpSchedulerHost(): SchedulerHost {
  return {
    deliverTick(target: SchedulerTarget, endpoint: InternalEndpoint): Promise<TickDeliveryOutcome> {
      void target;
      return new Promise<TickDeliveryOutcome>((resolve) => {
        const attempt = httpRequest(
          {
            host: endpoint.host,
            port: endpoint.port,
            path: TICK_PATH,
            method: TICK_METHOD,
            timeout: TICK_REQUEST_TIMEOUT_MS,
          },
          (response) => {
            const status = response.statusCode ?? 0;
            response.resume();
            resolve(status >= 200 && status < 300 ? { delivered: true } : { delivered: false, reason: 'tick_not_accepted' });
          },
        );
        // A refusal carries a REASON from a closed vocabulary and never an address, a host or a port,
        // because a tick report is not a place for a deployment particular (R24).
        attempt.on('timeout', () => {
          attempt.destroy();
          resolve({ delivered: false, reason: 'tick_timed_out' });
        });
        attempt.on('error', () => resolve({ delivered: false, reason: 'tick_unreachable' }));
        attempt.end();
      });
    },

    listen(port: number): Promise<never> {
      // Never called. It exists so its non-use is an observed fact rather than a silence (D6), and it
      // refuses so an edit that called it fails loudly instead of publishing a port (R9).
      return Promise.reject(
        new Error(
          `NIZAM scheduler: this service binds no port, and ${String(port)} is no exception. It is a client of two internal endpoints and its readiness is an exec command, so it has no accept surface to add one to (contract 12 §2.2.1, R9).`,
        ),
      );
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

/** Wall-clock ISO instant. The one place in this tier that reads it; every module takes it injected. */
function wallClock(): string {
  return new Date().toISOString();
}

/** Assemble the dependencies from the host. `env` comes from the loader's one bridge. */
export function schedulerDependenciesFromHost(): SchedulerDependencies {
  const env = processEnvSource();
  const sentinelPath = String(env.KILL_SENTINEL_PATH ?? '');
  return {
    env,
    host: createNodeHttpSchedulerHost(),
    // Per tick, and never cached: the sentinel is the form an operator can flip without a restart. A
    // probe that raises is treated as the switch being ENGAGED, in `haltGate.ts` rather than here.
    sentinelExists: () => sentinelPath.length > 0 && existsSync(sentinelPath),
    liveness: createFileLivenessRecord(schedulerRecordDirectory(), SCHEDULER_LIVENESS_FILE_NAME),
    now: wallClock,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}

/** The host facilities that are not part of the scheduler's own work. */
export function createNodeSchedulerProcessHost(): SchedulerProcessHost {
  return {
    onTerminationSignal(handler: () => void): void {
      for (const signal of SCHEDULER_TERMINATION_SIGNALS) nodeProcess.once(signal, handler);
    },
    reportBootRefusal(message: string): void {
      nodeProcess.stderr.write(`${message}\n`);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The readiness command
// ---------------------------------------------------------------------------------------------

/**
 * The readiness answer, as an exec check computed in process against a local file.
 *
 * This service has no store, so the answer rests on ONE fact: the liveness record its own loop writes
 * per tick. That is the `storeless` probe mode, in which the three store checks are `not_applicable`
 * and `queue_worker_alive` stays applicable — so a scheduler is ready only when its loop is turning,
 * and an absent or stale record is not ready. Silence is not health (§7.3).
 *
 * The window is derived from the configured cadence rather than fixed, because the loop's period is
 * the operator's choice: a fixed window would fail a correctly configured slow cadence or tolerate a
 * wedged fast one. An unreadable or absent cadence entry yields the floor, which is the strict
 * direction — the smallest window this service ever uses.
 */
export function schedulerReadinessReport(
  options: { readonly env?: NodeJS.ProcessEnv; readonly nowMs?: () => number } = {},
): ReadinessReport {
  const env = options.env ?? processEnvSource();
  const nowMs = options.nowMs ?? ((): number => Date.now());

  const configured = Number.parseInt(String(env[SCHEDULER_TICK_INTERVAL_ENTRY] ?? '').trim(), 10);
  const tickIntervalMs = Number.isSafeInteger(configured) && configured > 0 ? configured * TICK_INTERVAL_UNIT_MS : 0;
  const windowMs = schedulerStalenessWindowMs(tickIntervalMs);

  let ageMs: number | null;
  try {
    ageMs = createFileLivenessRecord(schedulerRecordDirectory(), SCHEDULER_LIVENESS_FILE_NAME, nowMs).ageMs();
  } catch {
    // No record could be dated. That is a not-ready answer about this service, not an exception for
    // the orchestrator to interpret.
    ageMs = null;
  }

  return probeReadiness({ mode: 'storeless' }, { queueWorkerAlive: () => livenessIsFresh(ageMs, windowMs) });
}

/** 0 ready, 1 not ready. What the orchestrator's exec check reads. */
export function runSchedulerHealthCommand(): 0 | 1 {
  return probeExitCode(schedulerReadinessReport());
}

/**
 * The whole entrypoint. Returns the outcome rather than exiting, so the exit is one statement in
 * `schedulerStart.ts` and nothing above it can end the process early.
 */
export async function schedulerMain(argv: readonly string[]): Promise<SchedulerRunOutcome> {
  if (argv.includes(SCHEDULER_HEALTH_FLAG)) {
    return { exitCode: runSchedulerHealthCommand(), ticks: 0, shutdown: null };
  }
  return runSchedulerProcess(schedulerDependenciesFromHost(), createNodeSchedulerProcessHost());
}

/** Re-exported so a test drives the same boot the process does, with its own injections. */
export { bootScheduler };
