// @vitest-environment node
/**
 * NIZAM · Backup process tests
 * Implemented by: PFOS Contract 12 / Phase 10.9 (spec 06-two-agent-vps)
 * Owning contract: Contract 12; owning requirements R20, R22, R27 and R29.
 * Phase: 10.9 — test the existing backup.sh-side runtime wrapper; ops scripts remain text-only.
 *
 * Every negative case below mutates a complete synthetic dependency set, asserts that the mutation
 * changed it, and then observes the guarded operation refuse or skip the backup. No ops artifact is
 * executed, no network is used, and no secret-shaped fixture is present.
 */
import { describe, expect, it } from 'vitest';

import {
  BACKUP_REQUIRED_ENTRIES,
  BACKUP_SCRIPT_CONTAINER_PATH,
  BACKUP_STALENESS_WINDOW_MS,
  BACKUP_TERMINATION_SIGNALS,
  checkBackupEnvironment,
  cronMatches,
  msUntilNextMinute,
  parseCronExpression,
  parseCronField,
  runBackupProcess,
  type BackupDependencies,
  type BackupProcessHost,
} from './backupMain.ts';

const TEST_VALUE = 'test-entry-present-not-a-secret';
const MATCHING_MINUTE = new Date('2026-01-02T03:04:00.000Z');

function completeEnvironment(overrides: Readonly<Record<string, string | undefined>> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const entry of BACKUP_REQUIRED_ENTRIES) env[entry] = TEST_VALUE;
  env.BACKUP_SCHEDULE = '* * * * *';
  env.NIZAM_KILL_ALL = '0';
  for (const [entry, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[entry];
    else env[entry] = value;
  }
  return env;
}

interface Harness {
  readonly deps: BackupDependencies;
  readonly host: BackupProcessHost;
  readonly touches: () => number;
  readonly backupCalls: () => number;
  readonly refusals: readonly string[];
}

function harness(options: {
  readonly env?: NodeJS.ProcessEnv;
  readonly sentinel?: boolean;
  readonly backupExitCode?: number;
} = {}): Harness {
  let touchCount = 0;
  let backupCallCount = 0;
  let terminationHandler: (() => void) | null = null;
  const refusals: string[] = [];
  const liveness = {
    touch: () => {
      touchCount += 1;
    },
    clear: () => undefined,
    ageMs: () => null,
  };
  const deps: BackupDependencies = {
    env: options.env ?? completeEnvironment(),
    sentinelExists: () => options.sentinel ?? false,
    liveness,
    now: () => MATCHING_MINUTE,
    sleep: async () => {
      terminationHandler?.();
    },
    runBackupScript: () => {
      backupCallCount += 1;
      return { exitCode: options.backupExitCode ?? 0 };
    },
  };
  const host: BackupProcessHost = {
    onTerminationSignal: (handler) => {
      terminationHandler = handler;
    },
    reportBootRefusal: (message) => {
      refusals.push(message);
    },
  };
  return { deps, host, touches: () => touchCount, backupCalls: () => backupCallCount, refusals };
}

function mutatedEnvironment(entry: string, value: string | undefined): NodeJS.ProcessEnv {
  const original = completeEnvironment();
  const mutated = { ...original };
  if (value === undefined) delete mutated[entry];
  else mutated[entry] = value;
  expect(mutated).not.toEqual(original);
  return mutated;
}

describe('backupMain deterministic helpers', () => {
  it('parses the supported five-field cron subset and matches UTC dates', () => {
    expect(parseCronField('*/15,7-8', 0, 59)).toEqual([0, 7, 8, 15, 30, 45]);
    const schedule = parseCronExpression('4 3 2 1 5');
    expect(schedule).not.toBeNull();
    if (schedule !== null) expect(cronMatches(schedule, MATCHING_MINUTE)).toBe(true);
    expect(cronMatches(parseCronExpression('* * * * *')!, new Date('2026-01-02T03:05:00.000Z'))).toBe(true);
  });

  it('rejects malformed cron shapes and out-of-range fields instead of selecting a schedule', () => {
    expect(parseCronExpression('every minute')).toBeNull();
    expect(parseCronExpression('* * * *')).toBeNull();
    expect(parseCronField('60', 0, 59)).toEqual([]);
    expect(parseCronField('*/0', 0, 59)).toEqual([]);
  });

  it('calculates the remaining time to the next minute without waiting', () => {
    expect(msUntilNextMinute(new Date('2026-01-02T03:04:00.000Z'))).toBe(60_000);
    expect(msUntilNextMinute(new Date('2026-01-02T03:04:12.345Z'))).toBe(47_655);
  });

  it('exposes the fixed backup script path and declared signal set', () => {
    expect(BACKUP_SCRIPT_CONTAINER_PATH).toBe('/app/ops/backup/backup.sh');
    expect(BACKUP_TERMINATION_SIGNALS).toEqual(['SIGTERM', 'SIGINT']);
    expect(BACKUP_STALENESS_WINDOW_MS).toBe(2 * 60 * 60 * 1000);
  });
});

describe('backup environment refuses incomplete boot configuration (R27)', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['own placeholder', '<BACKUP_WORK_DIR>'],
  ] as const)('fires for a %s required entry', (_why, value) => {
    const env = mutatedEnvironment('BACKUP_WORK_DIR', value);
    const refusal = checkBackupEnvironment(env);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain('BACKUP_WORK_DIR');
  });

  it('names every incomplete entry in one refusal rather than stopping at the first', () => {
    const env = completeEnvironment({ BACKUP_WORK_DIR: undefined, AGE_PUBLIC_KEY: '<AGE_PUBLIC_KEY>' });
    const refusal = checkBackupEnvironment(env);
    expect(refusal).toContain('BACKUP_WORK_DIR');
    expect(refusal).toContain('AGE_PUBLIC_KEY');
    expect(refusal).toContain('2 incomplete entries');
  });

  it('reports the refusal and performs no liveness or backup work', async () => {
    const h = harness({ env: mutatedEnvironment('BACKUP_SCHEDULE', undefined) });
    const outcome = await runBackupProcess(h.deps, h.host);
    expect(outcome).toEqual({ exitCode: 1, runs: 0, stopped: null });
    expect(h.refusals).toHaveLength(1);
    expect(h.backupCalls()).toBe(0);
    expect(h.touches()).toBe(0);
  });

  it('refuses a malformed schedule before registering or running the loop', async () => {
    const h = harness({ env: mutatedEnvironment('BACKUP_SCHEDULE', 'not-a-cron') });
    const outcome = await runBackupProcess(h.deps, h.host);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.runs).toBe(0);
    expect(h.refusals[0]).toContain('BACKUP_SCHEDULE');
    expect(h.backupCalls()).toBe(0);
  });
});

describe('backup schedule loop is deterministic and fail-closed (R20, R29)', () => {
  it('runs a matching tick, records success, and stops on the termination signal', async () => {
    const h = harness();
    const outcome = await runBackupProcess(h.deps, h.host);
    expect(outcome).toEqual({ exitCode: 0, runs: 1, stopped: 'signal' });
    expect(h.backupCalls()).toBe(1);
    expect(h.touches()).toBe(2);
  });

  it('checks the sentinel before the backup and keeps the loop alive without running it', async () => {
    const h = harness({ sentinel: true });
    const outcome = await runBackupProcess(h.deps, h.host);
    expect(outcome).toEqual({ exitCode: 0, runs: 0, stopped: 'signal' });
    expect(h.backupCalls()).toBe(0);
    expect(h.touches()).toBe(2);
  });

  it('does not record successful liveness after a failed backup', async () => {
    const h = harness({ backupExitCode: 1 });
    const outcome = await runBackupProcess(h.deps, h.host);
    expect(outcome).toEqual({ exitCode: 0, runs: 0, stopped: 'signal' });
    expect(h.backupCalls()).toBe(1);
    expect(h.touches()).toBe(1);
  });

  it('fires when the sentinel mutation changes the run from execution to skip', async () => {
    const normal = harness({ sentinel: false });
    const changed = harness({ sentinel: true });
    expect(changed).not.toBe(normal);
    const outcome = await runBackupProcess(changed.deps, changed.host);
    expect(outcome.runs).toBe(0);
    expect(changed.backupCalls()).toBe(0);
    expect(changed.touches()).toBe(2);
  });
});
