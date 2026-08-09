// @vitest-environment node
/**
 * NIZAM · The readiness probe reports facts about the store, and every gate fires
 * Implemented by: PFOS Contract 12 / Phase 7.5 (spec 06-two-agent-vps), owning requirement R22
 * Depends on: ./healthProbe, ../db/store, ../db/migrations, and ops/restore/restore.sh read as TEXT
 *
 * Three halves, and the second and third are the ones that matter.
 *
 * POSITIVE. A real migrated store on a temporary directory answers ready; the report carries nothing
 * but declared vocabulary and a version; the read-only version read agrees with the migrator's.
 *
 * NEGATIVE. Every check has a case that breaks exactly the fact it asserts and observes the probe
 * report not-ready with that check's own failure code. A probe only ever observed passing is
 * indistinguishable from a probe that returns "ready" unconditionally — which is precisely the
 * liveness probe §7.3 forbids, so the negative half is what makes this a readiness probe at all.
 *
 * CONTRACT. `ops/restore/restore.sh` §7.2.4 invokes `nizam-health-probe --store <path> --throwaway`.
 * That invocation is lifted out of the script TEXT and fed to this module's own parser, so the drill
 * and the probe cannot drift without a test failing.
 *
 * NOTHING HERE EXECUTES AN OPS ARTIFACT. `restore.sh` is read as text and never invoked; no shell, no
 * container tooling, no network call, and no file under `.secrets/` is touched (steering §2).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_SCHEMA_VERSION,
  PROBE_BUSY_TIMEOUT_MS,
  PROBE_COMMAND_NAME,
  PROBE_INVOCATION_REFUSALS,
  PROBE_MODES,
  PROBE_STORE_FLAG,
  PROBE_THROWAWAY_FLAG,
  READINESS_CHECKS,
  READINESS_FAILURES,
  READINESS_STATUSES,
  READINESS_VERDICTS,
  isReady,
  parseProbeInvocation,
  pragmasInForce,
  probeExitCode,
  probeReadiness,
  readRecordedSchemaVersion,
  reportForRefusedInvocation,
  runProbe,
  type ProbeEnvironment,
  type ProbeInvocation,
  type ReadinessCheck,
  type ReadinessFailure,
  type ReadinessReport,
} from './healthProbe';
import { MIGRATIONS, currentSchemaVersion, migrate } from '../db/migrations';
import { openStore, type StoreHandle } from '../db/connection';
import { openFinanceStore } from '../db/store';

const RESTORE_PATH = fileURLToPath(new URL('../../../ops/restore/restore.sh', import.meta.url));
const RESTORE = readFileSync(RESTORE_PATH, 'utf8').split('\r\n').join('\n');

const STORE_FILE = 'finance.db';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'nizam-probe-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** A store brought fully current through the one entry point application code uses. */
function migratedStore(): void {
  const opened = openFinanceStore({ dataDir, fileName: STORE_FILE, busyTimeoutMs: 500, storeName: 'finance' });
  opened.handle.close();
}

function invocationFor(mode: 'service' | 'throwaway'): ProbeInvocation {
  return { mode, storePath: join(dataDir, STORE_FILE) };
}

const ALIVE: ProbeEnvironment = { queueWorkerAlive: () => true };

function verdictOf(report: ReadinessReport, check: ReadinessCheck): { verdict: string; failure: ReadinessFailure | null } {
  const component = report.components.find((c) => c.check === check);
  if (component === undefined) throw new Error(`the report carries no component for ${check}`);
  return { verdict: component.verdict, failure: component.failure };
}

/** Every string in a serialized report must be a member of a declared vocabulary (§7.3). */
const DECLARED_VOCABULARY: readonly string[] = [
  ...READINESS_STATUSES,
  ...READINESS_VERDICTS,
  ...READINESS_CHECKS,
  ...READINESS_FAILURES,
  ...PROBE_MODES,
];

function stringsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => stringsIn(entry, found));
  else if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      found.push(key);
      stringsIn(nested, found);
    }
  }
  return found;
}

describe('the probe reports ACTUAL readiness (§7.3, R22)', () => {
  it('answers ready for a migrated store with a live worker, and exits 0', () => {
    migratedStore();
    const report = probeReadiness(invocationFor('service'), ALIVE);
    expect(report.status).toBe('ready');
    expect(report.schemaVersion).toBe(EXPECTED_SCHEMA_VERSION);
    expect(report.components.map((c) => c.verdict)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(probeExitCode(report)).toBe(0);
  });

  it('establishes the four facts in §7.3\u2019s order, each resting on the one before it', () => {
    expect([...READINESS_CHECKS]).toEqual(['store_opens', 'pragmas_in_force', 'schema_version_expected', 'queue_worker_alive']);
  });

  it('expects the version the ONE migration series ends on, never a literal repeated here', () => {
    expect(EXPECTED_SCHEMA_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1]?.version);
    expect(EXPECTED_SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it('reads the pragmas the FACTORY read back, and requires all four (contract 06 §2.2)', () => {
    migratedStore();
    const handle = openStore({ dataDir, fileName: STORE_FILE, busyTimeoutMs: 500 });
    try {
      expect(pragmasInForce(handle)).toBe(true);
      // Each pragma is load-bearing: a handle whose readings disagree on any one of them is not ready.
      const wal = { ...handle, pragmas: { ...handle.pragmas, journalMode: 'delete' } } as StoreHandle;
      const keys = { ...handle, pragmas: { ...handle.pragmas, foreignKeys: 0 } } as StoreHandle;
      const sync = { ...handle, pragmas: { ...handle.pragmas, synchronous: 1 } } as StoreHandle;
      const busy = { ...handle, pragmas: { ...handle.pragmas, busyTimeoutMs: 0 } } as StoreHandle;
      for (const [label, degraded] of [
        ['journal mode', wal],
        ['foreign keys', keys],
        ['synchronous', sync],
        ['busy timeout', busy],
      ] as const) {
        expect(pragmasInForce(degraded), `${label} is required`).toBe(false);
      }
    } finally {
      handle.close();
    }
  });

  it('reads the recorded version WITHOUT creating anything, and agrees with the migrator', () => {
    // A fresh file has no bookkeeping table. The read-only path answers 0 and leaves the store alone;
    // the migrator's own reader would have created the table to find that out.
    const handle = openStore({ dataDir, fileName: STORE_FILE, busyTimeoutMs: 500 });
    try {
      expect(readRecordedSchemaVersion(handle)).toBe(0);
      const tables = handle.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
      expect(tables, 'the probe created no table').toEqual([]);
      // And on a migrated store the two agree, so this is a read-only path to the same number rather
      // than a second opinion about it.
      migrate(handle);
      expect(readRecordedSchemaVersion(handle)).toBe(currentSchemaVersion(handle));
      expect(readRecordedSchemaVersion(handle)).toBe(EXPECTED_SCHEMA_VERSION);
    } finally {
      handle.close();
    }
  });

  it('reveals nothing sensitive: every string on the report is declared vocabulary (§7.3)', () => {
    migratedStore();
    const report = probeReadiness(invocationFor('service'), ALIVE);
    for (const value of stringsIn(report)) {
      const known = DECLARED_VOCABULARY.includes(value) || ['status', 'mode', 'schemaVersion', 'components', 'check', 'verdict', 'failure'].includes(value);
      expect(known, `"${value}" is not a member of any declared vocabulary`).toBe(true);
    }
    // In particular the path it was pointed at is nowhere on the answer.
    expect(JSON.stringify(report)).not.toContain(dataDir);
    expect(JSON.stringify(report)).not.toContain(STORE_FILE);
  });

  it('is not a liveness probe: the module offers no way to answer without opening the store', () => {
    // The one entry point takes an argument vector and reaches a store. There is no exported function
    // that returns a ready report from nothing, and `reportForRefusedInvocation` — the only report
    // produced without touching a store — is not-ready by construction.
    for (const refusal of PROBE_INVOCATION_REFUSALS) {
      expect(reportForRefusedInvocation(refusal).status).toBe('not_ready');
    }
    const source = readFileSync(fileURLToPath(new URL('./healthProbe.ts', import.meta.url)), 'utf8');
    // No socket, no listener, no request: the answer is an exit status from an exec probe (§2.2.1).
    for (const banned of ['createServer', 'listen(', 'fetch(', 'http' + 's.request', 'net.connect']) {
      expect(source.includes(banned), `the probe must not ${banned}`).toBe(false);
    }
  });
});

describe('the restore drill contract is satisfied (§7.2.4)', () => {
  it('the drill binds its probe name to the name this module exports', () => {
    // The script holds the name once, in a readonly binding, and invokes it through the binding. Both
    // halves are asserted: the name it binds, and that the invocation goes through the binding.
    expect(RESTORE).toContain(`readonly PROBE='${PROBE_COMMAND_NAME}'`);
    expect(RESTORE).toContain('"${PROBE}"');
    expect(RESTORE).toContain(`${PROBE_STORE_FLAG} `);
    expect(RESTORE).toContain(PROBE_THROWAWAY_FLAG);
  });

  it('the drill\u2019s own invocation line parses under this module\u2019s parser, in throwaway mode', () => {
    // Lifted out of the script text rather than restated, so a rewrite of either side fails here.
    const line = RESTORE.split('\n').find((l) => l.includes('"${PROBE}"') && l.includes(PROBE_STORE_FLAG));
    expect(line, 'the drill still invokes the probe with a store').toBeDefined();
    const tail = (line ?? '').slice((line ?? '').indexOf(PROBE_STORE_FLAG)).split(';')[0] ?? '';
    const argv = tail
      .trim()
      .split(/\s+/)
      // The script passes the path as a shell expansion resolved on the operator's machine. The parser
      // only needs a non-flag token there, so the expansion stands in for whatever it resolves to.
      .map((token) => (token.startsWith('"$') ? '/tmp/restored/finance.db' : token))
      .filter((token) => token !== '');
    const outcome = parseProbeInvocation(argv);
    expect(outcome.parsed, `argv was ${JSON.stringify(argv)}`).toBe(true);
    if (outcome.parsed) {
      expect(outcome.invocation.mode).toBe('throwaway');
      expect(outcome.invocation.storePath).not.toBe('');
    }
  });

  it('throwaway mode needs no worker, and service mode does', () => {
    migratedStore();
    const throwaway = probeReadiness(invocationFor('throwaway'));
    expect(throwaway.status).toBe('ready');
    expect(verdictOf(throwaway, 'queue_worker_alive')).toEqual({ verdict: 'not_applicable', failure: null });

    const service = probeReadiness(invocationFor('service'));
    expect(service.status).toBe('not_ready');
    expect(verdictOf(service, 'queue_worker_alive')).toEqual({ verdict: 'fail', failure: 'queue_worker_not_reporting' });
  });

  it('an inapplicable verdict is not a way to pass a check that IS applicable', () => {
    const forged: ReadinessReport = {
      status: 'ready',
      mode: 'service',
      schemaVersion: EXPECTED_SCHEMA_VERSION,
      components: READINESS_CHECKS.map((check) => ({ check, verdict: 'not_applicable' as const, failure: null })),
    };
    expect(isReady(forged)).toBe(false);
  });

  it('exposes a busy timeout of its own rather than borrowing a service configuration value', () => {
    expect(PROBE_BUSY_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isSafeInteger(PROBE_BUSY_TIMEOUT_MS)).toBe(true);
  });
});

describe('every check fires - the negative half', () => {
  it('store_opens fails when the store will not open, and the rest are not established', () => {
    // No store, no data directory entry: the factory refuses rather than choosing another location.
    const report = probeReadiness({ mode: 'service', storePath: join(dataDir, 'nowhere', 'finance.db') }, ALIVE);
    expect(report.status).toBe('not_ready');
    expect(verdictOf(report, 'store_opens')).toEqual({ verdict: 'fail', failure: 'store_would_not_open' });
    for (const check of ['pragmas_in_force', 'schema_version_expected', 'queue_worker_alive'] as const) {
      expect(verdictOf(report, check), `${check} must not report pass`).toEqual({ verdict: 'fail', failure: 'not_established' });
    }
    expect(report.schemaVersion).toBeNull();
    expect(probeExitCode(report)).toBe(1);
  });

  it('pragmas_in_force fails when a pragma the factory read back is not the required one', () => {
    migratedStore();
    const report = probeReadiness(invocationFor('service'), {
      ...ALIVE,
      openStoreWith: (config) => {
        const handle = openStore(config);
        return { ...handle, pragmas: { ...handle.pragmas, foreignKeys: 0 } };
      },
    });
    expect(report.status).toBe('not_ready');
    expect(verdictOf(report, 'pragmas_in_force')).toEqual({ verdict: 'fail', failure: 'pragma_not_in_force' });
  });

  it('schema_version_expected fails for a store BEHIND this build', () => {
    // Opened but never migrated: version 0 against a build whose series has grown past it.
    openStore({ dataDir, fileName: STORE_FILE, busyTimeoutMs: 500 }).close();
    const report = probeReadiness(invocationFor('service'), ALIVE);
    expect(verdictOf(report, 'schema_version_expected')).toEqual({ verdict: 'fail', failure: 'schema_version_mismatch' });
    expect(report.schemaVersion).toBe(0);
    expect(report.status).toBe('not_ready');
  });

  it('schema_version_expected fails for a store AHEAD of this build', () => {
    migratedStore();
    const report = probeReadiness(invocationFor('service'), {
      ...ALIVE,
      readSchemaVersion: () => EXPECTED_SCHEMA_VERSION + 1,
    });
    expect(verdictOf(report, 'schema_version_expected')).toEqual({ verdict: 'fail', failure: 'schema_version_mismatch' });
    expect(report.status).toBe('not_ready');
  });

  it('schema_version_expected fails, rather than throwing, when the version cannot be read', () => {
    migratedStore();
    const report = probeReadiness(invocationFor('service'), {
      ...ALIVE,
      readSchemaVersion: () => {
        throw new Error('the bookkeeping table is unreadable');
      },
    });
    expect(verdictOf(report, 'schema_version_expected')).toEqual({ verdict: 'fail', failure: 'schema_version_mismatch' });
  });

  it('queue_worker_alive fails on silence, and on a worker that throws', () => {
    migratedStore();
    for (const environment of [
      {},
      { queueWorkerAlive: () => false },
      {
        queueWorkerAlive: (): boolean => {
          throw new Error('the worker could not be asked');
        },
      },
    ] as readonly ProbeEnvironment[]) {
      const report = probeReadiness(invocationFor('service'), environment);
      expect(verdictOf(report, 'queue_worker_alive')).toEqual({ verdict: 'fail', failure: 'queue_worker_not_reporting' });
      expect(report.status).toBe('not_ready');
    }
  });

  it('an unexpected throw from anywhere becomes a not-ready answer, never an escaping exception', () => {
    const report = probeReadiness(invocationFor('service'), {
      openStoreWith: () => {
        // Not an Error at all, so a handler that inspected `e.message` would itself throw.
        throw 'the opener misbehaved';
      },
    });
    expect(report.status).toBe('not_ready');
    expect(verdictOf(report, 'store_opens')).toEqual({ verdict: 'fail', failure: 'store_would_not_open' });
  });

  it('probe_raised_unexpectedly fires when a handle is returned that cannot be interrogated', () => {
    // An opener that hands back something handle-shaped but empty: reading its pragmas throws, and a
    // probe that let that escape would leave the orchestrator with a non-answer rather than unhealthy.
    const report = probeReadiness(invocationFor('service'), {
      ...ALIVE,
      openStoreWith: () => ({}) as unknown as StoreHandle,
    });
    expect(report.status).toBe('not_ready');
    expect(verdictOf(report, 'store_opens')).toEqual({ verdict: 'fail', failure: 'probe_raised_unexpectedly' });
  });

  it('every invocation refusal fires, and each is a not-ready answer with exit 1', () => {
    const cases: readonly { readonly argv: readonly string[]; readonly refusal: string }[] = [
      { argv: [], refusal: 'store_flag_absent' },
      { argv: [PROBE_THROWAWAY_FLAG], refusal: 'store_flag_absent' },
      { argv: [PROBE_STORE_FLAG], refusal: 'store_value_absent' },
      { argv: [PROBE_STORE_FLAG, '   '], refusal: 'store_value_empty' },
      { argv: [PROBE_STORE_FLAG, PROBE_THROWAWAY_FLAG], refusal: 'store_value_empty' },
      { argv: [PROBE_STORE_FLAG, '/tmp/a.db', PROBE_STORE_FLAG, '/tmp/b.db'], refusal: 'flag_repeated' },
      { argv: ['--verbose', PROBE_STORE_FLAG, '/tmp/a.db'], refusal: 'flag_unrecognized' },
      { argv: ['/tmp/a.db'], refusal: 'operand_unexpected' },
    ];
    for (const testCase of cases) {
      const outcome = parseProbeInvocation(testCase.argv);
      expect(outcome.parsed, `${JSON.stringify(testCase.argv)} must be refused`).toBe(false);
      if (!outcome.parsed) expect(outcome.refusal).toBe(testCase.refusal);
      const { report, exitCode } = runProbe(testCase.argv);
      expect(report.status).toBe('not_ready');
      expect(exitCode).toBe(1);
    }
    // Coverage: the refusal vocabulary cannot grow without a case above.
    const covered = new Set(cases.map((c) => c.refusal));
    expect(PROBE_INVOCATION_REFUSALS.filter((r) => !covered.has(r))).toEqual([]);
  });

  it('a refused invocation is judged in the STRICTER mode, so it cannot buy throwaway leniency', () => {
    expect(reportForRefusedInvocation('flag_unrecognized').mode).toBe('service');
    expect(verdictOf(reportForRefusedInvocation('flag_unrecognized'), 'store_opens').failure).toBe('probe_invocation_invalid');
  });

  it('runProbe answers ready end to end for a good store, so the negative cases above are not vacuous', () => {
    migratedStore();
    const { report, exitCode } = runProbe([PROBE_STORE_FLAG, join(dataDir, STORE_FILE), PROBE_THROWAWAY_FLAG]);
    expect(report.status).toBe('ready');
    expect(exitCode).toBe(0);
  });

  it('every readiness failure code is reachable, so none is decoration', () => {
    const reached = new Set<string>();
    const collect = (report: ReadinessReport): void => {
      for (const component of report.components) if (component.failure !== null) reached.add(component.failure);
    };
    collect(probeReadiness({ mode: 'service', storePath: join(dataDir, 'nowhere', 'finance.db') }, ALIVE));
    openStore({ dataDir, fileName: STORE_FILE, busyTimeoutMs: 500 }).close();
    collect(probeReadiness(invocationFor('service'), {}));
    collect(
      probeReadiness(invocationFor('service'), {
        ...ALIVE,
        openStoreWith: (config) => {
          const handle = openStore(config);
          return { ...handle, pragmas: { ...handle.pragmas, synchronous: 0 } };
        },
      }),
    );
    collect(reportForRefusedInvocation('store_flag_absent'));
    collect(probeReadiness(invocationFor('service'), { ...ALIVE, openStoreWith: () => ({}) as unknown as StoreHandle }));
    expect(READINESS_FAILURES.filter((f) => !reached.has(f))).toEqual([]);
  });
});
