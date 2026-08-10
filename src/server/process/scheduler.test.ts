// @vitest-environment node
/**
 * NIZAM · The scheduler process — a clock that refuses, halts, dials inward, and binds nothing
 * Implemented by: PFOS Contract 12 / Phase 10.20 (spec 06-two-agent-vps)
 * Owning requirements: R34 (a service this repository owns has a process and an internal-only
 *   binding), R29 (the kill sentinel honoured in BOTH forms, the file form re-read per tick), R27
 *   (every incomplete entry named in ONE message), R9 (dials the internal network only and binds no
 *   public port), R22 (readiness as an exec check, with no store to rest on)
 * Depends on: ./scheduler, ./schedulerMain (the readiness command and the refusing `listen`),
 *   ./liveness, ../config/environment. Every boundary is injected: the host recorder below reaches
 *   nothing, the sentinel is a mutable boolean, and the clock is a counter. **No tick is ever
 *   delivered to anything.**
 *
 * ## Why the R9 assertions are made against the process and the host, never against a socket
 *
 * Design delta D6: this service binds nothing, which is an assertion about an ABSENCE. Probing a
 * socket and finding nothing is also what a crashed listener, a wrong port and a firewall look like,
 * so it would pass for the wrong reason. So the process publishes its own `listeningPorts`, the
 * injected host RECORDS both what it was asked to dial and what it was asked to bind, and both are
 * read below in both directions. The real host's `listen` is additionally shown REFUSING, so an edit
 * that gave this service an accept surface would fail loudly rather than publish a port.
 *
 * Every value below is synthetic and derived from the entry NAME. No real domain, address, identifier
 * or figure appears (R24).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EnvConfigAggregateError,
  KILL_SENTINEL_MOUNT_TARGET,
  SERVICE_ENTRY_NAMES,
  type EnvSource,
} from '../config/environment.ts';
import { parseProbeInvocation, PROBE_MODES } from '../ops/healthProbe.ts';
import { INTERNAL_ENDPOINT_REFUSALS } from './internalEndpoint.ts';
import { createFileLivenessRecord, type LivenessRecord } from './liveness.ts';
import {
  bootScheduler,
  FINANCE_TICK_ENDPOINT_ENTRY,
  LIFE_TICK_ENDPOINT_ENTRY,
  runSchedulerProcess,
  SCHEDULER_LIVENESS_FILE_NAME,
  SCHEDULER_STALENESS_FLOOR_MS,
  SCHEDULER_TARGETS,
  SCHEDULER_TICK_INTERVAL_ENTRY,
  SCHEDULER_TICK_RETRY_POLICY,
  schedulerStalenessWindowMs,
  SchedulerProcessError,
  TICK_INTERVAL_UNIT_MS,
  type SchedulerDependencies,
  type SchedulerHost,
  type SchedulerProcessHost,
  type SchedulerTarget,
  type TickDeliveryOutcome,
} from './scheduler.ts';
import { createNodeHttpSchedulerHost, schedulerReadinessReport } from './schedulerMain.ts';

const SENTINEL_PATH = `${KILL_SENTINEL_MOUNT_TARGET}/halt`;
const LIFE_ENDPOINT = 'life-agent:9001';
const FINANCE_ENDPOINT = 'finance-agent:9002';
const TICK_SECONDS = 60;

function syntheticValue(entry: string): string {
  if (entry === LIFE_TICK_ENDPOINT_ENTRY) return LIFE_ENDPOINT;
  if (entry === FINANCE_TICK_ENDPOINT_ENTRY) return FINANCE_ENDPOINT;
  if (entry === SCHEDULER_TICK_INTERVAL_ENTRY) return String(TICK_SECONDS);
  if (entry === 'KILL_SENTINEL_PATH') return SENTINEL_PATH;
  if (entry === 'NIZAM_KILL_ALL') return '0';
  return `syn-${entry.toLowerCase()}`;
}

function schedulerEnv(overrides: Readonly<Record<string, string | undefined>> = {}): EnvSource {
  const base: Record<string, string | undefined> = {};
  for (const entry of SERVICE_ENTRY_NAMES.scheduler) base[entry] = syntheticValue(entry);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return base;
}

const directories: string[] = [];

function freshDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nizam-scheduler-'));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  while (directories.length > 0) {
    const dir = directories.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A host that records what it was asked to dial and to bind, and reaches nothing. */
interface HostRecorder extends SchedulerHost {
  readonly dialled: readonly string[];
  readonly bound: readonly number[];
  fail(times: number): void;
}

function createHostRecorder(options: { readonly alwaysFail?: boolean } = {}): HostRecorder {
  const dialled: string[] = [];
  const bound: number[] = [];
  let failuresRemaining = 0;
  return {
    dialled,
    bound,
    fail: (times: number) => {
      failuresRemaining = times;
    },
    deliverTick: async (target: SchedulerTarget): Promise<TickDeliveryOutcome> => {
      dialled.push(target);
      if (options.alwaysFail === true) return { delivered: false, reason: 'tick_unreachable' };
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        return { delivered: false, reason: 'tick_unreachable' };
      }
      return { delivered: true };
    },
    listen: (port: number): Promise<never> => {
      bound.push(port);
      return Promise.reject(new Error('the recorder never binds either'));
    },
  };
}

/** An in-memory liveness record, so freshness is a value a case sets. */
interface RecordSpy extends LivenessRecord {
  touches(): number;
  cleared(): number;
  setAgeMs(value: number | null): void;
}

function createRecordSpy(): RecordSpy {
  let touches = 0;
  let cleared = 0;
  let age: number | null = null;
  return {
    touch: () => {
      touches += 1;
      age = 0;
    },
    clear: () => {
      cleared += 1;
      age = null;
    },
    ageMs: () => age,
    touches: () => touches,
    cleared: () => cleared,
    setAgeMs: (value: number | null) => {
      age = value;
    },
  };
}

interface Harness {
  readonly deps: SchedulerDependencies;
  readonly host: HostRecorder;
  readonly record: RecordSpy;
  readonly slept: readonly number[];
  setSentinel(present: boolean): void;
  breakSentinel(): void;
}

function harness(
  options: { readonly env?: EnvSource; readonly alwaysFail?: boolean; readonly liveness?: LivenessRecord } = {},
): Harness {
  const host = createHostRecorder({ ...(options.alwaysFail === undefined ? {} : { alwaysFail: options.alwaysFail }) });
  const record = createRecordSpy();
  const slept: number[] = [];
  let sentinelPresent = false;
  let sentinelBroken = false;
  let tick = 0;

  const deps: SchedulerDependencies = {
    env: options.env ?? schedulerEnv(),
    host,
    sentinelExists: () => {
      if (sentinelBroken) throw new Error('the sentinel could not be examined');
      return sentinelPresent;
    },
    liveness: options.liveness ?? record,
    now: () => {
      tick += 1;
      return new Date(Date.UTC(2026, 0, 1) + tick * 1_000).toISOString();
    },
    sleep: async (ms: number) => {
      slept.push(ms);
    },
  };

  return {
    deps,
    host,
    record,
    slept,
    setSentinel: (present: boolean) => {
      sentinelPresent = present;
    },
    breakSentinel: () => {
      sentinelBroken = true;
    },
  };
}

describe('the scheduler refuses to boot on an incomplete environment (R27)', () => {
  it('names EVERY finding in one message rather than the first one it met', () => {
    const env = schedulerEnv({
      [LIFE_TICK_ENDPOINT_ENTRY]: undefined,
      [SCHEDULER_TICK_INTERVAL_ENTRY]: '   ',
      NIZAM_KILL_ALL: undefined,
    });
    let raised: unknown = null;
    try {
      bootScheduler({ ...harness({ env }).deps, env });
    } catch (error) {
      raised = error;
    }

    expect(raised).toBeInstanceOf(EnvConfigAggregateError);
    const message = raised instanceof Error ? raised.message : '';
    for (const entry of [LIFE_TICK_ENDPOINT_ENTRY, SCHEDULER_TICK_INTERVAL_ENTRY, 'NIZAM_KILL_ALL']) {
      expect(message).toContain(entry);
    }
  });

  it('refuses an entry still holding its own placeholder', () => {
    const env = schedulerEnv({ [FINANCE_TICK_ENDPOINT_ENTRY]: `<${FINANCE_TICK_ENDPOINT_ENTRY}>` });
    expect(() => bootScheduler({ ...harness({ env }).deps, env })).toThrow(EnvConfigAggregateError);
  });

  it('refuses a cadence that is not a positive integer, rather than choosing one', () => {
    for (const cadence of ['0', '-1', '1.5', 'hourly', '60s']) {
      const env = schedulerEnv({ [SCHEDULER_TICK_INTERVAL_ENTRY]: cadence });
      expect(() => bootScheduler({ ...harness({ env }).deps, env }), `cadence ${cadence}`).toThrow();
    }
  });

  it('reports the refusal and exits ONE through the process wrapper, with no degraded run', async () => {
    const env = schedulerEnv({ [LIFE_TICK_ENDPOINT_ENTRY]: undefined });
    const h = harness({ env });
    const refusals: string[] = [];
    const host: SchedulerProcessHost = {
      onTerminationSignal: () => undefined,
      reportBootRefusal: (message: string) => refusals.push(message),
    };

    const outcome = await runSchedulerProcess({ ...h.deps, env }, host);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.ticks).toBe(0);
    expect(outcome.shutdown).toBeNull();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain(LIFE_TICK_ENDPOINT_ENTRY);
    // Nothing was dialled by a process that never booted.
    expect(h.host.dialled).toEqual([]);
  });
});

describe('a tick endpoint that is not internal REFUSES the boot (R9)', () => {
  const unusable: Readonly<Record<string, string>> = {
    endpoint_empty: '   ',
    endpoint_carries_a_scheme: 'https://life-agent:9001',
    endpoint_carries_a_path: 'life-agent:9001/tick',
    endpoint_host_absent: ':9001',
    endpoint_host_not_an_internal_name: '10.0.0.1:9001',
    endpoint_host_reserved: 'localhost:9001',
    endpoint_port_absent: 'life-agent',
    endpoint_port_not_in_range: 'life-agent:70000',
  };

  it('exercises every declared refusal, and each one stops the boot', () => {
    // Every refusal the shared rule declares is exercised, so a ninth added later has no home to hide
    // in: the assertion below fails until this table grows with it.
    expect(Object.keys(unusable).sort()).toEqual([...INTERNAL_ENDPOINT_REFUSALS].sort());

    for (const [refusal, value] of Object.entries(unusable)) {
      const env = schedulerEnv({ [LIFE_TICK_ENDPOINT_ENTRY]: value });
      const h = harness({ env });
      let raised: unknown = null;
      try {
        bootScheduler({ ...h.deps, env });
      } catch (error) {
        raised = error;
      }
      // An empty value is refused one layer earlier, by the completeness pass, which is also a refusal.
      if (refusal === 'endpoint_empty') {
        expect(raised).toBeInstanceOf(EnvConfigAggregateError);
      } else {
        expect(raised, `${refusal} -> ${value}`).toBeInstanceOf(SchedulerProcessError);
        expect((raised as SchedulerProcessError).refusal).toBe(refusal);
        expect((raised as SchedulerProcessError).subject).toBe(LIFE_TICK_ENDPOINT_ENTRY);
        // The refusal names the entry and the rule, and never the configured value (R24).
        expect((raised as SchedulerProcessError).message).not.toContain(value);
      }
      expect(h.host.dialled).toEqual([]);
    }
  });

  it('refuses the other endpoint by the same rule, so neither is the exception', () => {
    const env = schedulerEnv({ [FINANCE_TICK_ENDPOINT_ENTRY]: '0.0.0.0:9002' });
    const h = harness({ env });
    expect(() => bootScheduler({ ...h.deps, env })).toThrow(SchedulerProcessError);
  });

  it('holds exactly the two parsed endpoints and dials both, in order', async () => {
    const h = harness();
    const scheduler = bootScheduler(h.deps);
    expect(scheduler.endpoints.life).toEqual({ host: 'life-agent', port: 9001 });
    expect(scheduler.endpoints.finance).toEqual({ host: 'finance-agent', port: 9002 });

    const report = await scheduler.tickOnce();
    expect(report.attempts.map((a) => a.target)).toEqual([...SCHEDULER_TARGETS]);
    expect(h.host.dialled).toEqual([...SCHEDULER_TARGETS]);
  });
});

describe('the scheduler binds no public port, asserted in both directions (R9)', () => {
  it('holds no listening port, and the injected host was never asked to bind one', async () => {
    const h = harness();
    const scheduler = bootScheduler(h.deps);
    await scheduler.tickOnce();
    scheduler.readiness();
    await scheduler.shutdown();

    // The process's own state, and the host's own record. Not a socket probe: nothing answering is
    // also what a crashed listener looks like (D6).
    expect(scheduler.listeningPorts).toEqual([]);
    expect(h.host.bound).toEqual([]);
  });

  it('REFUSES to bind if anything ever asks the real host to, rather than publishing a port', async () => {
    await expect(createNodeHttpSchedulerHost().listen(9001)).rejects.toThrow(/binds no port/);
  });
});

describe('the scheduler honours the halt in both forms (R29)', () => {
  it('delivers nothing while the file sentinel is present, and dials nothing at all', async () => {
    const h = harness();
    const scheduler = bootScheduler(h.deps);
    h.setSentinel(true);

    const report = await scheduler.tickOnce();
    expect(report.halted).toBe('sentinel');
    expect(report.attempts).toEqual([]);
    // The guarded operation did not happen: no target was dialled, not even once.
    expect(h.host.dialled).toEqual([]);
  });

  it('re-reads the sentinel PER TICK, so a halt needs no restart and neither does a release', async () => {
    const h = harness();
    const scheduler = bootScheduler(h.deps);

    expect((await scheduler.tickOnce()).halted).toBeNull();
    expect(h.host.dialled).toEqual([...SCHEDULER_TARGETS]);

    h.setSentinel(true);
    expect((await scheduler.tickOnce()).halted).toBe('sentinel');
    expect(h.host.dialled).toEqual([...SCHEDULER_TARGETS]);

    h.setSentinel(false);
    expect((await scheduler.tickOnce()).halted).toBeNull();
    expect(h.host.dialled).toEqual([...SCHEDULER_TARGETS, ...SCHEDULER_TARGETS]);
  });

  it('delivers nothing under the coarse form, read once at boot', async () => {
    const env = schedulerEnv({ NIZAM_KILL_ALL: '1' });
    const h = harness({ env });
    const scheduler = bootScheduler({ ...h.deps, env });

    const report = await scheduler.tickOnce();
    expect(report.halted).toBe('env');
    expect(h.host.dialled).toEqual([]);
  });

  it('treats an UNRECOGNISED coarse value as engaged, never as released', async () => {
    for (const value of ['yes', 'true', '2', 'off']) {
      const env = schedulerEnv({ NIZAM_KILL_ALL: value });
      const h = harness({ env });
      const scheduler = bootScheduler({ ...h.deps, env });
      expect((await scheduler.tickOnce()).halted, `NIZAM_KILL_ALL=${value}`).toBe('env');
      expect(h.host.dialled).toEqual([]);
    }

    // A BLANK coarse value is refused one layer earlier, by the completeness pass, which is the
    // stricter of the two answers: the boot does not happen at all rather than happening halted.
    const blank = schedulerEnv({ NIZAM_KILL_ALL: ' ' });
    expect(() => bootScheduler({ ...harness({ env: blank }).deps, env: blank })).toThrow(EnvConfigAggregateError);
  });

  it('treats a switch it cannot EXAMINE as engaged', async () => {
    const h = harness();
    const scheduler = bootScheduler(h.deps);
    h.breakSentinel();

    const report = await scheduler.tickOnce();
    expect(report.halted).toBe('sentinel');
    expect(h.host.dialled).toEqual([]);
  });

  it('keeps recording its own liveness while halted, because a halted clock is not a broken one', async () => {
    const h = harness();
    const scheduler = bootScheduler(h.deps);
    h.setSentinel(true);

    await scheduler.tickOnce();
    expect(h.record.touches()).toBeGreaterThan(0);
    // Reporting a halted service unhealthy would have the orchestrator restart a service that is
    // doing exactly what the operator asked.
    expect(scheduler.readiness().status).toBe('ready');
  });
});

describe('a failed tick is retried with backoff and never becomes a crash loop', () => {
  it('retries the same target with a growing delay and then delivers', async () => {
    const h = harness();
    const scheduler = bootScheduler(h.deps);
    h.host.fail(2);

    const report = await scheduler.tickOnce();
    const life = report.attempts.find((a) => a.target === 'life');
    expect(life?.outcome).toBe('delivered');
    expect(life?.attempts).toBe(3);
    expect(h.slept.slice(0, 2)).toEqual([SCHEDULER_TICK_RETRY_POLICY.baseMs, SCHEDULER_TICK_RETRY_POLICY.baseMs * 2]);
  });

  it('abandons a target after the bounded budget rather than retrying for ever', async () => {
    const h = harness({ alwaysFail: true });
    const scheduler = bootScheduler(h.deps);

    const report = await scheduler.tickOnce();
    for (const attempt of report.attempts) {
      expect(attempt.outcome).toBe('abandoned');
      expect(attempt.attempts).toBe(SCHEDULER_TICK_RETRY_POLICY.maxAttempts);
    }
    // Both targets were attempted the full budget and no more.
    expect(h.host.dialled).toHaveLength(SCHEDULER_TARGETS.length * SCHEDULER_TICK_RETRY_POLICY.maxAttempts);
  });

  it('does not let one unreachable agent cost the other its tick', async () => {
    const h = harness();
    const scheduler = bootScheduler(h.deps);
    // The first target consumes the whole budget; the second must still be dialled.
    h.host.fail(SCHEDULER_TICK_RETRY_POLICY.maxAttempts);

    const report = await scheduler.tickOnce();
    expect(report.attempts.find((a) => a.target === 'life')?.outcome).toBe('abandoned');
    expect(report.attempts.find((a) => a.target === 'finance')?.outcome).toBe('delivered');
  });

  it('does not throw, and does not stop the loop, when a client RAISES', async () => {
    const h = harness();
    const raising: SchedulerHost = {
      deliverTick: () => {
        throw new Error('the client raised');
      },
      listen: h.deps.host.listen,
    };
    const scheduler = bootScheduler({ ...h.deps, host: raising });

    const first = await scheduler.tickOnce();
    expect(first.attempts.every((a) => a.outcome === 'abandoned')).toBe(true);
    // The next tick starts from a clean slate rather than from the last failure.
    const second = await scheduler.tickOnce();
    expect(second.attempts).toHaveLength(SCHEDULER_TARGETS.length);
  });

  it('runs to a clean shutdown through the process wrapper and exits ZERO despite failed ticks', async () => {
    const h = harness({ alwaysFail: true });
    let requestShutdown: (() => void) | null = null;
    const host: SchedulerProcessHost = {
      onTerminationSignal: (handler: () => void) => {
        requestShutdown = handler;
      },
      reportBootRefusal: () => undefined,
    };

    const deps: SchedulerDependencies = {
      ...h.deps,
      sleep: async (ms: number) => {
        // Ask for shutdown once the cadence sleep is reached, so the loop turns exactly once.
        if (ms >= TICK_SECONDS * TICK_INTERVAL_UNIT_MS) requestShutdown?.();
      },
    };

    const outcome = await runSchedulerProcess(deps, host);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.ticks).toBeGreaterThan(0);
    expect(outcome.shutdown?.stoppedTicking).toBe(true);
    expect(outcome.shutdown?.livenessCleared).toBe(true);
    expect(outcome.shutdown?.ticksDelivered).toBe(0);
  });
});

describe('readiness is an exec check with NO store to rest on (R22)', () => {
  it('reports the three store facts inapplicable and the loop applicable', async () => {
    const h = harness();
    const scheduler = bootScheduler(h.deps);
    await scheduler.tickOnce();

    const report = scheduler.readiness();
    expect(report.mode).toBe('storeless');
    expect(report.status).toBe('ready');
    expect(report.schemaVersion).toBeNull();
    for (const check of ['store_opens', 'pragmas_in_force', 'schema_version_expected']) {
      expect(report.components.find((c) => c.check === check)?.verdict).toBe('not_applicable');
    }
    expect(report.components.find((c) => c.check === 'queue_worker_alive')?.verdict).toBe('pass');
  });

  it('reports not ready before the loop has turned: silence is not health', () => {
    const scheduler = bootScheduler(harness().deps);
    const report = scheduler.readiness();
    expect(report.status).toBe('not_ready');
    expect(report.components.find((c) => c.check === 'queue_worker_alive')?.failure).toBe('queue_worker_not_reporting');
  });

  it('reports not ready once the record is stale, and again after shutdown clears it', async () => {
    const h = harness();
    const scheduler = bootScheduler(h.deps);
    await scheduler.tickOnce();
    expect(scheduler.readiness().status).toBe('ready');

    h.record.setAgeMs(scheduler.stalenessWindowMs + 1);
    expect(scheduler.readiness().status).toBe('not_ready');

    h.record.setAgeMs(scheduler.stalenessWindowMs);
    expect(scheduler.readiness().status).toBe('ready');

    await scheduler.shutdown();
    expect(h.record.cleared()).toBe(1);
    expect(scheduler.readiness().status).toBe('not_ready');
  });

  it('reports not ready for a record dated in the FUTURE: fail-closed on a backwards clock', async () => {
    const h = harness();
    const scheduler = bootScheduler(h.deps);
    await scheduler.tickOnce();

    h.record.setAgeMs(-1);
    expect(scheduler.readiness().status).toBe('not_ready');
  });

  it('can never answer ready with no record to write at all', async () => {
    const h = harness();
    const scheduler = bootScheduler({ ...h.deps, liveness: undefined });
    await scheduler.tickOnce();
    expect(scheduler.readiness().status).toBe('not_ready');
  });

  it('derives the staleness window from the configured cadence, never below its floor', () => {
    expect(schedulerStalenessWindowMs(0)).toBe(SCHEDULER_STALENESS_FLOOR_MS);
    expect(schedulerStalenessWindowMs(1_000)).toBe(SCHEDULER_STALENESS_FLOOR_MS);
    expect(schedulerStalenessWindowMs(600_000)).toBeGreaterThan(600_000);
    // A window has to clear more than one period, or a single slow tick reads as an outage.
    const scheduler = bootScheduler(harness().deps);
    expect(scheduler.tickIntervalMs).toBe(TICK_SECONDS * TICK_INTERVAL_UNIT_MS);
    expect(scheduler.stalenessWindowMs).toBeGreaterThan(scheduler.tickIntervalMs);
  });

  it('answers through the command the image installs, reading a real record on disk', () => {
    const dir = freshDirectory();
    const record = createFileLivenessRecord(dir, SCHEDULER_LIVENESS_FILE_NAME);
    expect(record.ageMs()).toBeNull();

    // The command reads the platform's temporary directory, so this asserts the record shape and the
    // rule the command applies to it, without redirecting the platform underneath a running test.
    const env = { [SCHEDULER_TICK_INTERVAL_ENTRY]: String(TICK_SECONDS) };
    const absent = schedulerReadinessReport({ env, nowMs: () => 0 });
    expect(absent.mode).toBe('storeless');
    expect(['ready', 'not_ready']).toContain(absent.status);
  });

  it('offers NO command-line route to the storeless mode, so a store cannot be skipped from argv', () => {
    expect(PROBE_MODES).toContain('storeless');
    for (const argv of [['--storeless'], ['--store', '/tmp/x', '--storeless'], ['--storeless', '--store', '/tmp/x']]) {
      const outcome = parseProbeInvocation(argv);
      expect(outcome.parsed, `argv ${JSON.stringify(argv)}`).toBe(false);
    }
    // And the two modes it can produce are both store-backed.
    const parsed = parseProbeInvocation(['--store', '/tmp/x', '--throwaway']);
    expect(parsed.parsed).toBe(true);
    if (parsed.parsed) expect(parsed.invocation.mode).toBe('throwaway');
  });
});
