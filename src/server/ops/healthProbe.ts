/**
 * NIZAM · Readiness probe — the store opens, the pragmas are in force, the version is the expected one
 * Implemented by: PFOS Contract 12 / Phase 7.5 (spec 06-two-agent-vps), owning requirement R22
 * Depends on: ../db/connection (the ONE factory, and the pragma constants it asserts),
 *   ../db/migrations (the ONE migration series, for the expected version),
 *   ../db/errors is NOT imported: a typed store error is caught by shape, never by class, because a
 *   probe that can only recognize the errors it was told about reports "ready" for the rest.
 *
 * Contract 12 §7.3 (owning requirement R22) makes one distinction and this module exists to honour it:
 *
 *   "Every long-running service exposes a health endpoint that reports ACTUAL readiness: the store
 *    opens, the required pragmas are in force, the migration version is the expected one, and the
 *    queue worker is alive. It must not return success merely because the process is running."
 *
 * ## Readiness, not liveness, and why the difference is not cosmetic
 *
 * A liveness answer is produced by the code that answers it. Its evidence is its own execution, so it
 * is true exactly when the answering path is reachable — which is nearly always, including while the
 * store below it is unopenable, mis-pragma'd, or a schema the running build cannot describe. Under
 * §7.3 the orchestrator RESTARTS what reports unhealthy, so a liveness probe on a broken store does
 * not merely fail to help: it actively suppresses the one automatic remedy the deployment has, and it
 * does so most confidently at the moment the store is worst. That is why §7.3's last clause is a
 * prohibition rather than a preference, and why every check below is a fact about something OTHER
 * than this module's own execution.
 *
 * ## Nothing sensitive leaves here (§7.3, last bullet)
 *
 * "The health endpoint reveals nothing sensitive: no configuration values, no counts of financial
 * records, no identifiers. A liveness signal, a version, and a coarse component status."
 *
 * So {@link ReadinessReport} carries a status, a mode, a schema version, and one coarse verdict per
 * check — and every string on it is a member of a declared vocabulary. Not "we are careful not to
 * include the path": there is no field of the report a path could occupy, and the test asserts that
 * every string value in a serialized report is a member of one of the exported enums. A refusal
 * likewise reports a CODE and never the value that offended, the same rule
 * `modelTelemetryRepo.ts` applies to a telemetry field.
 *
 * ## It dials nothing (steering §2)
 *
 * There is no HTTP surface here, and adding one would be wrong twice over. §2.2.1 says no agent
 * process binds a public port; a listener bound for a health check is still a listener, and steering
 * §2 gates every outbound call from a server process. The orchestrator's own check is an exec probe —
 * `ops/docker-compose.yml` declares `test: [CMD, <SERVICE_HEALTH_PROBE>]` for every service — so the
 * answer is computed in-process against a local file and returned as an exit status. No socket is
 * opened, no address is resolved, nothing is dialled, in either direction.
 *
 * ## It does not mutate what it measures
 *
 * `migrations.currentSchemaVersion` creates the bookkeeping table if it is absent, which is correct
 * for a migrator and wrong for a probe: it would write to a store it was asked to inspect, and on a
 * restored artifact under `ops/restore/restore.sh` that is altering the evidence. So the version is
 * read through {@link readRecordedSchemaVersion}, which creates nothing and answers 0 for a store
 * with no bookkeeping table at all. `healthProbe.test.ts` asserts the two agree on every migrated
 * store, so this is a read-only path to the same number rather than a second opinion about it.
 *
 * ## The invocation grammar is the restore drill's contract
 *
 * `ops/restore/restore.sh` §7.2.4 boots a throwaway instance with
 * `nizam-health-probe --store <path> --throwaway`. {@link parseProbeInvocation} is the parser for
 * exactly that grammar, and `healthProbe.test.ts` feeds it the invocation line lifted out of the
 * script text — so the two cannot drift without a test failing. The executable NAME is supplied by
 * the image entry point at deploy time (gate G1); this module exports it as
 * {@link PROBE_COMMAND_NAME} so the script and the parser agree on one spelling.
 *
 * ## Money
 *
 * There is none. A readiness report carries no figure of any kind — not a balance, not a cost, not a
 * record count (§7.3 forbids the last explicitly). This module imports no arithmetic, and the only
 * numbers it can emit are a schema version and a check count.
 */
import {
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_JOURNAL_MODE,
  REQUIRED_SYNCHRONOUS,
  openStore,
  type StoreConnectionConfig,
  type StoreHandle,
} from '../db/connection';
import { MIGRATIONS } from '../db/migrations';

// ---------------------------------------------------------------------------------------------
// The invocation grammar (the restore drill's contract)
// ---------------------------------------------------------------------------------------------

/** The name the image entry point provides. Quoted by `ops/restore/restore.sh` as `PROBE`. */
export const PROBE_COMMAND_NAME = 'nizam-health-probe';

/** The store to inspect. One value, required, in both modes. */
export const PROBE_STORE_FLAG = '--store';

/**
 * Throwaway mode: inspect a restored copy rather than this service's own live store. It narrows the
 * probe to the three store facts and reports the queue-worker check `not_applicable`, because a
 * throwaway boot has no worker and a check that cannot be evaluated must not be reported as passing.
 */
export const PROBE_THROWAWAY_FLAG = '--throwaway';

export const PROBE_FLAGS: readonly string[] = [PROBE_STORE_FLAG, PROBE_THROWAWAY_FLAG];

export const PROBE_MODES = ['service', 'throwaway'] as const;
export type ProbeMode = (typeof PROBE_MODES)[number];

/** Why an invocation was refused. A refusal names the FLAG, never the value behind it. */
export const PROBE_INVOCATION_REFUSALS = [
  'store_flag_absent',
  'store_value_absent',
  'store_value_empty',
  'flag_repeated',
  'flag_unrecognized',
  'operand_unexpected',
] as const;
export type ProbeInvocationRefusal = (typeof PROBE_INVOCATION_REFUSALS)[number];

export interface ProbeInvocation {
  readonly mode: ProbeMode;
  /** The store path exactly as given. Held here and never placed on a report. */
  readonly storePath: string;
}

export type ProbeInvocationOutcome =
  | { readonly parsed: true; readonly invocation: ProbeInvocation }
  | { readonly parsed: false; readonly refusal: ProbeInvocationRefusal; readonly at: string };

/**
 * Parse the argument vector, or refuse it.
 *
 * Fails closed on every ambiguity: an unrecognized flag, a repeated flag, a bare operand, a missing
 * `--store`, and a `--store` whose value is absent or blank are all refusals. None of them is
 * absorbed into a default, because the only default available would be "some other store", and
 * inspecting the wrong store is the failure mode this whole module exists to prevent.
 */
export function parseProbeInvocation(argv: readonly string[]): ProbeInvocationOutcome {
  let storePath: string | null = null;
  let throwaway = false;
  const seen = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? '';
    if (!token.startsWith('-')) {
      return { parsed: false, refusal: 'operand_unexpected', at: token };
    }
    if (!PROBE_FLAGS.includes(token)) {
      return { parsed: false, refusal: 'flag_unrecognized', at: token };
    }
    if (seen.has(token)) {
      return { parsed: false, refusal: 'flag_repeated', at: token };
    }
    seen.add(token);
    if (token === PROBE_THROWAWAY_FLAG) {
      throwaway = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) {
      return { parsed: false, refusal: 'store_value_absent', at: token };
    }
    if (value.trim() === '' || value.startsWith('-')) {
      // A blank value, or the next flag swallowed as one. Both mean nobody said which store.
      return { parsed: false, refusal: 'store_value_empty', at: token };
    }
    storePath = value;
    i += 1;
  }

  if (storePath === null) return { parsed: false, refusal: 'store_flag_absent', at: PROBE_STORE_FLAG };
  return { parsed: true, invocation: { mode: throwaway ? 'throwaway' : 'service', storePath } };
}

// ---------------------------------------------------------------------------------------------
// What readiness means
// ---------------------------------------------------------------------------------------------

/** §7.3's four facts, in the order they are established. Each depends on the one before it. */
export const READINESS_CHECKS = [
  'store_opens',
  'pragmas_in_force',
  'schema_version_expected',
  'queue_worker_alive',
] as const;
export type ReadinessCheck = (typeof READINESS_CHECKS)[number];

export const READINESS_VERDICTS = ['pass', 'fail', 'not_applicable'] as const;
export type ReadinessVerdict = (typeof READINESS_VERDICTS)[number];

/**
 * Why a check failed. Coarse on purpose (§7.3): each is a component-level cause, never a
 * configuration value, a path, an identifier, or a count of anything stored.
 */
export const READINESS_FAILURES = [
  'store_would_not_open',
  'pragma_not_in_force',
  'schema_version_mismatch',
  'queue_worker_not_reporting',
  'probe_invocation_invalid',
  'probe_raised_unexpectedly',
  /** The check could not be established because an earlier one did not hold. Never "pass". */
  'not_established',
] as const;
export type ReadinessFailure = (typeof READINESS_FAILURES)[number];

export interface ReadinessComponent {
  readonly check: ReadinessCheck;
  readonly verdict: ReadinessVerdict;
  readonly failure: ReadinessFailure | null;
}

export const READINESS_STATUSES = ['ready', 'not_ready'] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

/**
 * What the probe answers. A status, a mode, a version, and a coarse component status — exactly the
 * three things §7.3's last bullet permits, and no field a particular could travel in.
 */
export interface ReadinessReport {
  readonly status: ReadinessStatus;
  readonly mode: ProbeMode;
  /** The version the store RECORDS, or `null` when it could not be read. A version is permitted. */
  readonly schemaVersion: number | null;
  readonly components: readonly ReadinessComponent[];
}

/**
 * The version a current store records: the last entry of the ONE migration series, never a literal
 * repeated here. Appending a migration therefore moves the expectation with it, and a build whose
 * series has grown past the store it is pointed at reports not-ready rather than serving against a
 * schema it cannot describe.
 */
export const EXPECTED_SCHEMA_VERSION: number = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

/**
 * The only check that is legitimately inapplicable, and only in the mode that has no worker. Stated
 * as data so `not_applicable` cannot spread into a way of passing a check by declining to run it.
 */
const INAPPLICABLE_BY_MODE: Readonly<Record<ProbeMode, readonly ReadinessCheck[]>> = {
  service: [],
  throwaway: ['queue_worker_alive'],
};

// ---------------------------------------------------------------------------------------------
// The read-only version read
// ---------------------------------------------------------------------------------------------

/**
 * The version the store records, WITHOUT creating anything. Answers 0 for a store that has no
 * bookkeeping table, which is a real state (a fresh file, or an artifact restored from something
 * that was never migrated) and must read as a mismatch rather than as an error to be repaired here.
 */
export function readRecordedSchemaVersion(handle: StoreHandle): number {
  const table = handle.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (table === undefined || table === null) return 0;
  const row = handle.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  const value = (row as { version: number | null } | undefined)?.version;
  return typeof value === 'number' ? value : 0;
}

/**
 * Do the pragmas the factory read back match what the factory requires?
 *
 * This compares against `connection.ts`'s own constants rather than re-deriving the requirement, and
 * it inspects the values the factory READ BACK rather than issuing a second set of pragma queries.
 * Both halves matter: a second requirement list would eventually disagree with the factory's, and a
 * second read would be a different read at a different instant.
 */
export function pragmasInForce(handle: StoreHandle): boolean {
  const { pragmas } = handle;
  return (
    pragmas.journalMode.toLowerCase() === REQUIRED_JOURNAL_MODE &&
    pragmas.foreignKeys === REQUIRED_FOREIGN_KEYS &&
    pragmas.synchronous === REQUIRED_SYNCHRONOUS &&
    Number.isSafeInteger(pragmas.busyTimeoutMs) &&
    pragmas.busyTimeoutMs > 0
  );
}

// ---------------------------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------------------------

/**
 * Everything the probe reaches for, injected. The defaults are the real factory and the real series;
 * a test supplies an opener that refuses, a version reader that lies, or a worker that is silent, so
 * every branch below is reachable without a broken store on disk.
 */
export interface ProbeEnvironment {
  /** The ONE connection factory. There is no second door into a store in this tier. */
  readonly openStoreWith?: (config: StoreConnectionConfig) => StoreHandle;
  readonly readSchemaVersion?: (handle: StoreHandle) => number;
  readonly expectedSchemaVersion?: number;
  readonly busyTimeoutMs?: number;
  /**
   * Service mode: does the queue worker report itself alive? ABSENT means nothing reported, which is
   * "not reporting" and therefore a failure — a probe that treats silence as health is the liveness
   * probe §7.3 forbids, wearing a readiness label.
   */
  readonly queueWorkerAlive?: () => boolean;
}

/** Default busy timeout for the probe's own short-lived connection. Not a deployment particular. */
export const PROBE_BUSY_TIMEOUT_MS = 2_000;

function componentsWith(overrides: ReadonlyMap<ReadinessCheck, ReadinessComponent>, mode: ProbeMode): readonly ReadinessComponent[] {
  const inapplicable = INAPPLICABLE_BY_MODE[mode];
  return READINESS_CHECKS.map((check) => {
    const given = overrides.get(check);
    if (given !== undefined) return given;
    if (inapplicable.includes(check)) return { check, verdict: 'not_applicable', failure: null };
    return { check, verdict: 'fail', failure: 'not_established' };
  });
}

/**
 * A report is ready only when every check passed, allowing `not_applicable` for exactly the checks
 * this mode declares inapplicable. An unexpected `not_applicable` is treated as NOT ready, so the
 * verdict cannot be reached by declining to evaluate a check.
 */
export function isReady(report: ReadinessReport): boolean {
  const inapplicable = INAPPLICABLE_BY_MODE[report.mode];
  if (report.components.length !== READINESS_CHECKS.length) return false;
  for (const check of READINESS_CHECKS) {
    const component = report.components.find((c) => c.check === check);
    if (component === undefined) return false;
    if (component.verdict === 'pass') continue;
    if (component.verdict === 'not_applicable' && inapplicable.includes(check)) continue;
    return false;
  }
  return true;
}

/**
 * Probe one store and report ACTUAL readiness (§7.3, R22).
 *
 * In order, because each fact rests on the one before it:
 *  1. `store_opens` — the store opens through the one connection factory. A typed store error, a
 *     missing directory, a path outside the data directory, an unreadable file, and a pragma that
 *     did not take all surface here, because the factory refuses rather than degrading.
 *  2. `pragmas_in_force` — the values the factory READ BACK are the ones it requires. A pragma that
 *     was set but did not take is indistinguishable from one never set unless it is read back
 *     (contract 06 §2.2), which is why this reads the factory's readings.
 *  3. `schema_version_expected` — the version the store records equals this build's last migration.
 *     A store behind is un-migrated; a store ahead was written by a newer build. Both are not-ready.
 *  4. `queue_worker_alive` — service mode only. Silence is a failure, not an absence of news.
 *
 * Every ambiguity fails closed. A check that could not be established reports `fail` with
 * `not_established`, never `pass` and never a tidy `not_applicable`. An exception from anywhere
 * — including from the injected environment — becomes `probe_raised_unexpectedly` rather than
 * escaping, because a probe that throws is a probe whose orchestrator sees a non-answer.
 */
export function probeReadiness(invocation: ProbeInvocation, environment: ProbeEnvironment = {}): ReadinessReport {
  const open = environment.openStoreWith ?? openStore;
  const readVersion = environment.readSchemaVersion ?? readRecordedSchemaVersion;
  const expected = environment.expectedSchemaVersion ?? EXPECTED_SCHEMA_VERSION;
  const busyTimeoutMs = environment.busyTimeoutMs ?? PROBE_BUSY_TIMEOUT_MS;

  const found = new Map<ReadinessCheck, ReadinessComponent>();
  const record = (check: ReadinessCheck, verdict: ReadinessVerdict, failure: ReadinessFailure | null): void => {
    found.set(check, { check, verdict, failure });
  };

  let schemaVersion: number | null = null;
  let handle: StoreHandle | null = null;

  try {
    // The path is split rather than resolved here: `resolveStorePath` inside the factory is the one
    // containment guard, and a second one in this module would be a second opinion about which
    // directory an agent owns.
    const separator = Math.max(invocation.storePath.lastIndexOf('/'), invocation.storePath.lastIndexOf('\\'));
    const dataDir = separator > 0 ? invocation.storePath.slice(0, separator) : invocation.storePath;
    const fileName = separator >= 0 ? invocation.storePath.slice(separator + 1) : invocation.storePath;

    try {
      handle = open({ dataDir, fileName, busyTimeoutMs });
      record('store_opens', 'pass', null);
    } catch {
      // The cause is deliberately not carried onto the report: a store error's detail names the
      // path, which §7.3's last bullet keeps out of a health answer.
      record('store_opens', 'fail', 'store_would_not_open');
      return finish(found, invocation.mode, schemaVersion);
    }

    if (pragmasInForce(handle)) record('pragmas_in_force', 'pass', null);
    else record('pragmas_in_force', 'fail', 'pragma_not_in_force');

    try {
      schemaVersion = readVersion(handle);
      if (schemaVersion === expected) record('schema_version_expected', 'pass', null);
      else record('schema_version_expected', 'fail', 'schema_version_mismatch');
    } catch {
      record('schema_version_expected', 'fail', 'schema_version_mismatch');
    }

    if (invocation.mode === 'service') {
      let alive = false;
      try {
        alive = environment.queueWorkerAlive?.() === true;
      } catch {
        alive = false;
      }
      if (alive) record('queue_worker_alive', 'pass', null);
      else record('queue_worker_alive', 'fail', 'queue_worker_not_reporting');
    }

    return finish(found, invocation.mode, schemaVersion);
  } catch {
    record('store_opens', 'fail', 'probe_raised_unexpectedly');
    return finish(found, invocation.mode, schemaVersion);
  } finally {
    try {
      handle?.close();
    } catch {
      // A connection that cannot be closed does not change the verdict already reached, and a throw
      // from here would replace a real answer with an exception.
    }
  }
}

function finish(
  found: ReadonlyMap<ReadinessCheck, ReadinessComponent>,
  mode: ProbeMode,
  schemaVersion: number | null,
): ReadinessReport {
  const components = componentsWith(found, mode);
  const draft: ReadinessReport = { status: 'not_ready', mode, schemaVersion, components };
  return isReady(draft) ? { ...draft, status: 'ready' } : draft;
}

/** A refused invocation is a not-ready answer, not a crash and not a usage message. */
export function reportForRefusedInvocation(refusal: ProbeInvocationRefusal): ReadinessReport {
  void refusal;
  return {
    status: 'not_ready',
    // `service` is the stricter of the two modes, so an unparseable invocation cannot buy the
    // leniency throwaway mode grants.
    mode: 'service',
    schemaVersion: null,
    components: READINESS_CHECKS.map((check) => ({
      check,
      verdict: 'fail' as ReadinessVerdict,
      failure: check === 'store_opens' ? ('probe_invocation_invalid' as ReadinessFailure) : ('not_established' as ReadinessFailure),
    })),
  };
}

/** 0 ready, 1 not ready. What `if ! "${PROBE}" --store … --throwaway; then` in the restore drill reads. */
export function probeExitCode(report: ReadinessReport): 0 | 1 {
  return report.status === 'ready' ? 0 : 1;
}

/**
 * The whole probe, from an argument vector to an exit status and a report. This is the shape an image
 * entry point wraps; it performs no output of its own, so a caller decides where the report goes and
 * `redactedLogger.ts` is the only thing in this tier that writes one down.
 */
export function runProbe(
  argv: readonly string[],
  environment: ProbeEnvironment = {},
): { readonly report: ReadinessReport; readonly exitCode: 0 | 1 } {
  const parsed = parseProbeInvocation(argv);
  const report = parsed.parsed ? probeReadiness(parsed.invocation, environment) : reportForRefusedInvocation(parsed.refusal);
  return { report, exitCode: probeExitCode(report) };
}
