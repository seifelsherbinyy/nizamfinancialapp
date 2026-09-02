/**
 * NIZAM · The backup entrypoint — the one file in the backup tier that touches the platform
 * Implemented by: PFOS Contract 12 / Phase 10.9 (spec 06-two-agent-vps)
 * Owning requirements: R20 (consistent snapshot, public-key encryption, shred, verified upload,
 *   bounded retention), R22 (the readiness command the compose healthcheck resolves to), R27 (a
 *   boot refusal naming every incomplete entry at once), R29 (the halt, in both forms)
 * Depends on: ../config/environment (the ONE ambient bridge), ./liveness (the SHARED liveness
 *   record), `node:child_process`, `node:fs`, `node:os`, `node:process`. Nothing else.
 *
 * Started by the image's entry point. Two modes, selected by the argument vector:
 *
 *  - **default** — boot the scheduler loop that runs `ops/backup/backup.sh` on the configured
 *    cadence, tick until a termination signal, exit 0. A boot refusal is reported and exits
 *    **non-zero**; there is no degraded run.
 *  - **`--health`** — answer readiness and exit 0 or 1. This is what `<BACKUP_HEALTH_PROBE>` in
 *    `ops/docker-compose.yml` resolves to, and it is a COMMAND rather than an endpoint, which is
 *    why the healthcheck needs no port.
 *
 * ## The schedule
 *
 * `BACKUP_SCHEDULE` is a cron expression (5-field). The loop sleeps until the next matching minute,
 * runs `backup.sh`, records liveness on success, and sleeps again. A failure does NOT record
 * liveness, so a failing backup eventually looks not-ready to the orchestrator.
 *
 * ## The uploader command (`nizam-backup`)
 *
 * `backup.sh` calls `nizam-backup upload ...` and `nizam-backup prune ...`. That command is
 * installed in the image as a shim that invokes `src/server/process/backupUploader.ts`, which
 * implements the egress boundary declared in `src/server/ports/drive.ts` against the narrow
 * per-file storage grant from gate G5.
 *
 * ## Where the liveness record lands
 *
 * Same answer as the scheduler: the platform's temporary directory, because this service mounts
 * no volume for its own state (the scratch volume is for the snapshot-encrypt-shred sequence, not
 * for service metadata). An exec healthcheck runs inside the service's own container, which is
 * why the record works across the process boundary.
 *
 * No host, path, port, token or figure is written here (R24). Every value comes from the
 * environment at run time.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodeProcess from 'node:process';

import { processEnvSource } from '../config/environment.ts';
import { probeExitCode, probeReadiness, type ReadinessReport } from '../ops/healthProbe.ts';
import { createFileLivenessRecord, livenessIsFresh } from './liveness.ts';

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** The flag that selects the readiness answer instead of the schedule loop. */
export const BACKUP_HEALTH_FLAG = '--health';

/** The signals a clean stop is asked for with. */
export const BACKUP_TERMINATION_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/** The liveness file name. Shared with the health command via this constant. */
export const BACKUP_LIVENESS_FILE_NAME = '.nizam-backup-alive';

/**
 * The staleness window. A backup runs at most once per minute (cron granularity). Since the
 * schedule can be as slow as daily, we use a fixed 2-hour window: if the service has not recorded
 * itself in 2 hours it is considered not ready.
 */
export const BACKUP_STALENESS_WINDOW_MS = 2 * 60 * 60 * 1000;

/** The path to backup.sh inside the container. Fixed topology, not configuration. */
export const BACKUP_SCRIPT_CONTAINER_PATH = '/app/ops/backup/backup.sh';

// ---------------------------------------------------------------------------------------------
// Cron parsing (5-field subset)
// ---------------------------------------------------------------------------------------------

export interface CronSchedule {
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  readonly daysOfWeek: readonly number[];
}

/** Parse a single cron field into the set of matching values. */
export function parseCronField(field: string, min: number, max: number): readonly number[] {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const stepMatch = /^(.+)\/([0-9]+)$/.exec(part);
    let range: string;
    let step = 1;
    if (stepMatch !== null) {
      range = stepMatch[1] ?? '*';
      step = Number.parseInt(stepMatch[2] ?? '1', 10);
    } else {
      range = part;
    }
    let start: number;
    let end: number;
    if (range === '*') {
      start = min;
      end = max;
    } else if (range.includes('-')) {
      const [lo, hi] = range.split('-');
      start = Number.parseInt(lo ?? '', 10);
      end = Number.parseInt(hi ?? '', 10);
    } else {
      const val = Number.parseInt(range, 10);
      if (Number.isNaN(val) || val < min || val > max) continue;
      values.add(val);
      continue;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start < min || end > max || step < 1) continue;
    for (let i = start; i <= end; i += step) values.add(i);
  }
  return [...values].sort((a, b) => a - b);
}

/** Parse a 5-field cron expression. Returns null if invalid. */
export function parseCronExpression(expr: string): CronSchedule | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minutes = parseCronField(fields[0] ?? '*', 0, 59);
  const hours = parseCronField(fields[1] ?? '*', 0, 23);
  const daysOfMonth = parseCronField(fields[2] ?? '*', 1, 31);
  const months = parseCronField(fields[3] ?? '*', 1, 12);
  const daysOfWeek = parseCronField(fields[4] ?? '*', 0, 6);
  if (minutes.length === 0 || hours.length === 0 || daysOfMonth.length === 0 || months.length === 0 || daysOfWeek.length === 0) return null;
  return { minutes, hours, daysOfMonth, months, daysOfWeek };
}

/** Check whether a Date matches a cron schedule. */
export function cronMatches(schedule: CronSchedule, date: Date): boolean {
  return (
    schedule.minutes.includes(date.getUTCMinutes()) &&
    schedule.hours.includes(date.getUTCHours()) &&
    schedule.daysOfMonth.includes(date.getUTCDate()) &&
    schedule.months.includes(date.getUTCMonth() + 1) &&
    schedule.daysOfWeek.includes(date.getUTCDay())
  );
}

/** Milliseconds until the start of the next minute. */
export function msUntilNextMinute(now: Date): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

// ---------------------------------------------------------------------------------------------
// The readiness command
// ---------------------------------------------------------------------------------------------

/**
 * The readiness answer, as an exec check computed in process against a local file.
 *
 * Same shape as the scheduler: liveness record age. A backup service is ready when its loop has
 * turned within the staleness window.
 */
export function backupReadinessReport(
  options: { readonly nowMs?: () => number } = {},
): ReadinessReport {
  const nowMs = options.nowMs ?? ((): number => Date.now());
  let ageMs: number | null;
  try {
    ageMs = createFileLivenessRecord(tmpdir(), BACKUP_LIVENESS_FILE_NAME, nowMs).ageMs();
  } catch {
    ageMs = null;
  }
  return probeReadiness({ mode: 'storeless' }, { queueWorkerAlive: () => livenessIsFresh(ageMs, BACKUP_STALENESS_WINDOW_MS) });
}

/** 0 ready, 1 not ready. What the orchestrator's exec check reads. */
export function runBackupHealthCommand(): 0 | 1 {
  return probeExitCode(backupReadinessReport());
}

// ---------------------------------------------------------------------------------------------
// The schedule loop
// ---------------------------------------------------------------------------------------------

export interface BackupRunOutcome {
  readonly exitCode: number;
  readonly runs: number;
  readonly stopped: 'signal' | null;
}

export interface BackupProcessHost {
  onTerminationSignal(handler: () => void): void;
  reportBootRefusal(message: string): void;
}

export interface BackupDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly sentinelExists: () => boolean;
  readonly liveness: ReturnType<typeof createFileLivenessRecord>;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly runBackupScript: () => { readonly exitCode: number };
}

/** Required environment entries for the backup service to boot. */
export const BACKUP_REQUIRED_ENTRIES: readonly string[] = [
  'BACKUP_WORK_DIR',
  'BACKUP_SCHEDULE',
  'AGE_PUBLIC_KEY',
  'BACKUP_ENCRYPTION_SCHEME',
  'BACKUP_RETAIN_COUNT',
  'BACKUP_FOLDER_REF',
  'DRIVE_REFRESH_TOKEN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'STORAGE_TOKEN_URL',
  'KILL_SENTINEL_PATH',
  'NIZAM_KILL_ALL',
];

/**
 * Boot check: every required entry present, non-empty, and not an unfilled placeholder.
 * Returns null if all OK, or a message naming every problem at once (R27).
 */
export function checkBackupEnvironment(env: NodeJS.ProcessEnv): string | null {
  const problems: string[] = [];
  for (const name of BACKUP_REQUIRED_ENTRIES) {
    const value = env[name];
    if (value === undefined || value === '') {
      problems.push(`${name}: missing or empty`);
    } else if (/^<[A-Z_]+>$/.test(value)) {
      problems.push(`${name}: still holds its own placeholder`);
    }
  }
  if (problems.length === 0) return null;
  return `backup service refused to boot: ${problems.length} incomplete entries:\n  ${problems.join('\n  ')}`;
}

/**
 * Run the backup schedule loop until a termination signal arrives.
 */
export async function runBackupProcess(
  deps: BackupDependencies,
  host: BackupProcessHost,
): Promise<BackupRunOutcome> {
  const envCheck = checkBackupEnvironment(deps.env);
  if (envCheck !== null) {
    host.reportBootRefusal(envCheck);
    return { exitCode: 1, runs: 0, stopped: null };
  }

  const scheduleExpr = String(deps.env.BACKUP_SCHEDULE ?? '');
  const schedule = parseCronExpression(scheduleExpr);
  if (schedule === null) {
    host.reportBootRefusal(`backup service refused to boot: BACKUP_SCHEDULE is not a valid 5-field cron expression: ${scheduleExpr}`);
    return { exitCode: 1, runs: 0, stopped: null };
  }

  let running = true;
  let stoppedReason: 'signal' | null = null;
  host.onTerminationSignal(() => {
    running = false;
    stoppedReason = 'signal';
  });

  // Record liveness on boot so the health check passes before the first scheduled run.
  deps.liveness.touch();

  let runs = 0;
  while (running) {
    const now = deps.now();
    if (cronMatches(schedule, now)) {
      // Check halt before each run (section 8).
      if (deps.sentinelExists()) {
        // Halted — skip this tick but stay alive so the orchestrator can see us.
        deps.liveness.touch();
      } else {
        const result = deps.runBackupScript();
        if (result.exitCode === 0) {
          runs += 1;
          deps.liveness.touch();
        }
        // On failure, do NOT touch liveness — the health check will eventually report not-ready.
      }
    } else {
      // Not a matching minute — just record liveness to show the loop is turning.
      deps.liveness.touch();
    }
    // Sleep until the next minute boundary.
    const sleepMs = msUntilNextMinute(deps.now());
    await deps.sleep(sleepMs);
  }

  return { exitCode: 0, runs, stopped: stoppedReason };
}

// ---------------------------------------------------------------------------------------------
// Assembly from the host
// ---------------------------------------------------------------------------------------------

function createHostDependencies(): BackupDependencies {
  const env = processEnvSource();
  const sentinelPath = String(env.KILL_SENTINEL_PATH ?? '');
  return {
    env,
    sentinelExists: () => sentinelPath.length > 0 && existsSync(sentinelPath),
    liveness: createFileLivenessRecord(tmpdir(), BACKUP_LIVENESS_FILE_NAME),
    now: () => new Date(),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    runBackupScript: () => {
      try {
        execFileSync('/bin/bash', [BACKUP_SCRIPT_CONTAINER_PATH], {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10 * 60 * 1000,
        });
        return { exitCode: 0 };
      } catch (err: unknown) {
        const code = (err as { status?: number }).status ?? 1;
        return { exitCode: code };
      }
    },
  };
}

function createHostProcessHost(): BackupProcessHost {
  return {
    onTerminationSignal(handler: () => void): void {
      for (const signal of BACKUP_TERMINATION_SIGNALS) nodeProcess.once(signal, handler);
    },
    reportBootRefusal(message: string): void {
      nodeProcess.stderr.write(`${message}\n`);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The entrypoint
// ---------------------------------------------------------------------------------------------

/**
 * The whole entrypoint. Returns the outcome rather than exiting, so the exit is one statement in
 * `backupStart.ts` and nothing above it can end the process early.
 */
export async function backupMain(argv: readonly string[]): Promise<BackupRunOutcome> {
  if (argv.includes(BACKUP_HEALTH_FLAG)) {
    return { exitCode: runBackupHealthCommand(), runs: 0, stopped: null };
  }
  return runBackupProcess(createHostDependencies(), createHostProcessHost());
}
