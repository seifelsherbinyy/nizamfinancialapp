// @vitest-environment node
/**
 * NIZAM · The finance-agent readiness command — the test task 10.7 omitted
 * Implemented by: PFOS Contract 12 / Phase 10.21 (spec 06-two-agent-vps)
 * Owning requirements: R22 (readiness reports ACTUAL readiness as an exec check computed in process
 *   against local files, never a liveness answer and never a socket), R29 (under `longPoll` this
 *   agent binds NO public port, and the readiness answer does not add one), R24 (the liveness record
 *   holds no content — its age is the whole of the signal)
 * Depends on: ./main (the command), ./financeAgent (the process that writes the record),
 *   ./liveness (the shared record), ../db/store (a REAL migrated store on a temporary directory).
 *   No socket, no network, no provider, no live model: every boundary is injected.
 *
 * ## Why this file exists
 *
 * `runHealthCommand` called `runProbe(['--store', …])` with no probe environment, so in `service`
 * mode `queueWorkerAlive` was absent, `probeReadiness` correctly answered
 * `queue_worker_not_reporting`, and the command **always exited 1** — for every store, on every host.
 * `ops/docker-compose.yml` gives both `caddy` and `scheduler` a
 * `depends_on: finance-agent: condition: service_healthy`, so that single defect held the whole
 * phase-1 stack at unhealthy for ever. It had no test. This is the test, in both directions: a
 * running healthy agent answers ready and exits 0; a stopped one, a wedged one, one that never wrote
 * a record and one whose record is dated in the future all answer not ready and exit 1.
 *
 * ## Why the clock is injected rather than waited for
 *
 * Staleness and a backwards clock are the two interesting states, and neither can be observed by
 * waiting: one would take minutes and the other cannot be arranged at all. `nowMs` is therefore a
 * parameter of the report, so both are states a case SETS.
 *
 * Every value below is synthetic and derived from the entry NAME. No real domain, identifier, token
 * or figure appears (R24).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { KILL_SENTINEL_MOUNT_TARGET, SERVICE_ENTRY_NAMES, SHARED_ENTRIES, type EnvSource } from '../config/environment';
import { openFinanceStore } from '../db/store';
import { probeExitCode } from '../ops/healthProbe';
import type { TelegramTransportMode, TelegramWorkOutcome } from '../ports/telegram';
import type { TelegramFetchRequest, TelegramUpdateBatch } from '../telegram/liveTransport';
import {
  bootFinanceAgent,
  FINANCE_CONTAINER_PORT_ENTRY,
  FINANCE_DATA_DIR_ENTRY,
  FINANCE_LIVENESS_FILE_NAME,
  FINANCE_LIVENESS_MAX_AGE_MS,
  FINANCE_STORE_FILE_ENTRY,
  FINANCE_STORE_NAME,
  type FinanceAgentDependencies,
  type HttpListenerHandle,
  type HttpListenerHost,
} from './financeAgent';
import { createFileLivenessRecord } from './liveness';
import { financeReadinessReport, POLL_POLICY, runHealthCommand } from './main';

const SENTINEL_PATH = `${KILL_SENTINEL_MOUNT_TARGET}/halt`;
const SYNTHETIC_BASE = 'https://provider.invalid';
const SYNTHETIC_SENDER = '101';
const STORE_FILE = 'finance.db';
const CONFIGURED_PORT = 9101;
const BOT_ID = 'bot-b';
const BUSY_TIMEOUT_MS = 3_000;

function syntheticValue(entry: string): string {
  if (entry === SHARED_ENTRIES.allowedSenderIds) return SYNTHETIC_SENDER;
  if (entry === SHARED_ENTRIES.mode) return 'longPoll';
  if (entry === SHARED_ENTRIES.maxWorkItems) return '2';
  if (entry === 'KILL_SENTINEL_PATH') return SENTINEL_PATH;
  if (entry === 'NIZAM_KILL_ALL') return '0';
  if (entry === FINANCE_STORE_FILE_ENTRY) return STORE_FILE;
  if (entry === FINANCE_CONTAINER_PORT_ENTRY) return String(CONFIGURED_PORT);
  if (entry.endsWith('_API_BASE')) return SYNTHETIC_BASE;
  if (entry.endsWith('_WEEKLY_CAP')) return '2500000';
  if (entry.endsWith('_TIMEOUT_MS')) return String(BUSY_TIMEOUT_MS);
  return `syn-${entry.toLowerCase()}`;
}

const temporaryDirectories: string[] = [];

function freshDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nizam-readiness-'));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function financeEnv(dataDir: string, overrides: Readonly<Record<string, string | undefined>> = {}): EnvSource {
  const base: Record<string, string | undefined> = {};
  for (const entry of SERVICE_ENTRY_NAMES.finance) base[entry] = syntheticValue(entry);
  base[FINANCE_DATA_DIR_ENTRY] = dataDir;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return base;
}

/** A listener host that RECORDS what it was asked to bind and binds nothing. */
interface ListenerRecorder extends HttpListenerHost {
  readonly requested: readonly number[];
}

function createListenerRecorder(): ListenerRecorder {
  const requested: number[] = [];
  return {
    requested,
    listen(port: number): Promise<HttpListenerHandle> {
      requested.push(port);
      return Promise.resolve({ port, close: async () => undefined });
    },
  };
}

/** The real file-backed record, because the point is that a SECOND process can read it. */
function dependencies(dataDir: string, mode: TelegramTransportMode = 'longPoll'): {
  readonly deps: FinanceAgentDependencies;
  readonly listener: ListenerRecorder;
} {
  const listener = createListenerRecorder();
  let tick = 0;
  const deps: FinanceAgentDependencies = {
    env: financeEnv(dataDir, { [SHARED_ENTRIES.mode]: mode }),
    botId: BOT_ID,
    transportClient: {
      fetchUpdates: async (request: TelegramFetchRequest): Promise<TelegramUpdateBatch> => {
        void request;
        return { updates: [] };
      },
      sendMessage: async () => ({ messageRef: 'msg-1', sentAt: '2026-01-01T00:00:00.000Z' }),
    },
    worker: { process: async (): Promise<TelegramWorkOutcome> => ({ outcome: 'done' }) },
    listenerHost: listener,
    sentinelExists: () => false,
    logSink: () => undefined,
    now: () => {
      tick += 1;
      return new Date(Date.UTC(2026, 0, 1) + tick * 1_000).toISOString();
    },
    newId: () => {
      tick += 1;
      return `ref-${String(tick).padStart(4, '0')}`;
    },
    sleep: async () => undefined,
    poll: { timeoutSeconds: 5, limit: 10 },
    send: { baseMs: 1, maxMs: 2, maxAttempts: 1 },
    retry: { baseMs: 1, maxMs: 2, maxAttempts: 2 },
    liveness: createFileLivenessRecord(dataDir, FINANCE_LIVENESS_FILE_NAME),
  };
  return { deps, listener };
}

function recordPath(dataDir: string): string {
  return join(dataDir, FINANCE_LIVENESS_FILE_NAME);
}

/** A clock reading `offsetMs` after the record was written. Negative dates the record in the future. */
function clockOffsetFrom(dataDir: string, offsetMs: number): () => number {
  return () => statSync(recordPath(dataDir)).mtimeMs + offsetMs;
}

function workerCheck(report: ReturnType<typeof financeReadinessReport>): string | null {
  return report.components.find((component) => component.check === 'queue_worker_alive')?.failure ?? null;
}

describe('the finance-agent readiness command answers ready for a running agent (R22)', () => {
  it('reports ready and exits ZERO once the loop has turned', async () => {
    const dataDir = freshDataDir();
    const { deps } = dependencies(dataDir);
    const agent = await bootFinanceAgent(deps);
    try {
      await agent.runWorkerOnce();

      const report = financeReadinessReport({ env: deps.env });
      expect(report.status).toBe('ready');
      expect(report.components.every((component) => component.verdict === 'pass')).toBe(true);
      expect(probeExitCode(report)).toBe(0);
    } finally {
      await agent.shutdown();
    }
  });

  it('exits ZERO through the command the image installs, reading its ambient environment', async () => {
    const dataDir = freshDataDir();
    const { deps } = dependencies(dataDir);
    const agent = await bootFinanceAgent(deps);
    const previousDir = process.env[FINANCE_DATA_DIR_ENTRY];
    const previousFile = process.env[FINANCE_STORE_FILE_ENTRY];
    try {
      await agent.runWorkerOnce();
      process.env[FINANCE_DATA_DIR_ENTRY] = dataDir;
      process.env[FINANCE_STORE_FILE_ENTRY] = STORE_FILE;

      // This is the whole of what `nizam-finance-health` does, and until task 10.21 it was 1 here.
      expect(runHealthCommand()).toBe(0);
    } finally {
      if (previousDir === undefined) delete process.env[FINANCE_DATA_DIR_ENTRY];
      else process.env[FINANCE_DATA_DIR_ENTRY] = previousDir;
      if (previousFile === undefined) delete process.env[FINANCE_STORE_FILE_ENTRY];
      else process.env[FINANCE_STORE_FILE_ENTRY] = previousFile;
      await agent.shutdown();
    }
  });
});

describe('a stopped or wedged agent reports NOT ready (R22)', () => {
  it('answers not ready and exits ONE the moment the agent has shut down', async () => {
    const dataDir = freshDataDir();
    const { deps } = dependencies(dataDir);
    const agent = await bootFinanceAgent(deps);
    await agent.runWorkerOnce();
    expect(existsSync(recordPath(dataDir))).toBe(true);

    const shutdown = await agent.shutdown();
    expect(shutdown.livenessCleared).toBe(true);
    // Cleared rather than left to age out: a stopped agent that still looked alive would hold both
    // `caddy` and `scheduler` at `service_healthy` against a service that has gone.
    expect(existsSync(recordPath(dataDir))).toBe(false);

    const report = financeReadinessReport({ env: deps.env });
    expect(report.status).toBe('not_ready');
    expect(workerCheck(report)).toBe('queue_worker_not_reporting');
    expect(probeExitCode(report)).toBe(1);
  });

  it('answers not ready when no record was ever written: silence is not health', () => {
    const dataDir = freshDataDir();
    // A real migrated store, so the three store facts all hold and the ONLY missing fact is the loop.
    const { handle } = openFinanceStore({ dataDir, fileName: STORE_FILE, busyTimeoutMs: BUSY_TIMEOUT_MS, storeName: FINANCE_STORE_NAME });
    handle.close();
    expect(existsSync(recordPath(dataDir))).toBe(false);

    const report = financeReadinessReport({ env: financeEnv(dataDir) });
    expect(report.status).toBe('not_ready');
    expect(report.components.find((component) => component.check === 'store_opens')?.verdict).toBe('pass');
    expect(workerCheck(report)).toBe('queue_worker_not_reporting');
    expect(probeExitCode(report)).toBe(1);
  });

  it('answers not ready once the record is stale, and ready at the boundary', async () => {
    const dataDir = freshDataDir();
    const { deps } = dependencies(dataDir);
    const agent = await bootFinanceAgent(deps);
    try {
      await agent.runWorkerOnce();

      const stale = financeReadinessReport({ env: deps.env, nowMs: clockOffsetFrom(dataDir, FINANCE_LIVENESS_MAX_AGE_MS + 1) });
      expect(stale.status).toBe('not_ready');
      expect(workerCheck(stale)).toBe('queue_worker_not_reporting');

      const atBoundary = financeReadinessReport({ env: deps.env, nowMs: clockOffsetFrom(dataDir, FINANCE_LIVENESS_MAX_AGE_MS) });
      expect(atBoundary.status).toBe('ready');
    } finally {
      await agent.shutdown();
    }
  });

  it('answers not ready for a record dated in the future: fail-closed on a backwards clock', async () => {
    const dataDir = freshDataDir();
    const { deps } = dependencies(dataDir);
    const agent = await bootFinanceAgent(deps);
    try {
      await agent.runWorkerOnce();

      // THE MAGNITUDE IS THE POINT, and it used to be one millisecond. A record dated a millisecond
      // ahead is not a backwards clock — it is the wall clock and the filesystem disagreeing about the
      // same instant, which happens whenever a record is written and read inside the same quantum.
      // Asserting that it read not-ready therefore asserted the ARTEFACT, and the same artefact made
      // this suite fail at random in the run of the case below (task 10.20's unidentified flake, found
      // and traced by task 10.18). `liveness.ts` now reports a sub-quantum disagreement as zero, and
      // `liveness.test.ts` pins both directions. What this case is about is a clock that actually
      // moved, so it names an offset a clock could actually have moved by.
      const backwards = financeReadinessReport({ env: deps.env, nowMs: clockOffsetFrom(dataDir, -60_000) });
      expect(backwards.status).toBe('not_ready');
      expect(workerCheck(backwards)).toBe('queue_worker_not_reporting');
    } finally {
      await agent.shutdown();
    }
  });

  it('answers not ready rather than throwing when the store entries are unconfigured', () => {
    for (const overrides of [{ [FINANCE_DATA_DIR_ENTRY]: undefined }, { [FINANCE_STORE_FILE_ENTRY]: '  ' }]) {
      const report = financeReadinessReport({ env: financeEnv(freshDataDir(), overrides) });
      expect(report.status).toBe('not_ready');
      expect(report.components.find((component) => component.check === 'store_opens')?.failure).toBe('probe_invocation_invalid');
      expect(probeExitCode(report)).toBe(1);
    }
  });

  it('keeps the in-process answer no more generous than the exec check', async () => {
    const dataDir = freshDataDir();
    const { deps } = dependencies(dataDir);
    const agent = await bootFinanceAgent(deps);
    try {
      await agent.runWorkerOnce();
      expect(agent.readiness().status).toBe('ready');

      // The same wedged state the exec check refuses, refused in process too: a stale record means the
      // loop stopped turning, whichever process is asking.
      const wedged = await bootFinanceAgent({
        ...dependencies(freshDataDir()).deps,
        liveness: { touch: () => undefined, clear: () => undefined, ageMs: () => FINANCE_LIVENESS_MAX_AGE_MS + 1 },
      });
      try {
        await wedged.runWorkerOnce();
        expect(wedged.readiness().status).toBe('not_ready');
      } finally {
        await wedged.shutdown();
      }
    } finally {
      await agent.shutdown();
    }
  });
});

describe('the readiness answer needs no listener, and adds none (R9, R29)', () => {
  it('answers ready under longPoll while binding NOTHING, asserted in both directions', async () => {
    const dataDir = freshDataDir();
    const { deps, listener } = dependencies(dataDir, 'longPoll');
    const agent = await bootFinanceAgent(deps);
    try {
      await agent.runWorkerOnce();
      expect(financeReadinessReport({ env: deps.env }).status).toBe('ready');

      // The process's own listener set, and the injected host's own bind record. A socket probe would
      // pass for the wrong reason: nothing answering is also what a crashed listener looks like (D6).
      expect(agent.listeningPorts).toEqual([]);
      expect(listener.requested).toEqual([]);
    } finally {
      await agent.shutdown();
    }
  });

  it('binds exactly the configured port under webhook, and readiness still opens no second one', async () => {
    const dataDir = freshDataDir();
    const { deps, listener } = dependencies(dataDir, 'webhook');
    const agent = await bootFinanceAgent(deps);
    try {
      await agent.runWorkerOnce();
      expect(financeReadinessReport({ env: deps.env }).status).toBe('ready');

      expect(agent.listeningPorts).toEqual([CONFIGURED_PORT]);
      expect(listener.requested).toEqual([CONFIGURED_PORT]);
      expect(agent.listeningPorts).toHaveLength(1);
    } finally {
      await agent.shutdown();
    }
  });
});

describe('the record carries no value, and its window fits this agent\u2019s loop (R24)', () => {
  it('holds no content at all: the age is the whole of the signal', async () => {
    const dataDir = freshDataDir();
    const { deps } = dependencies(dataDir);
    const agent = await bootFinanceAgent(deps);
    try {
      await agent.runWorkerOnce();
      expect(readFileSync(recordPath(dataDir), 'utf8')).toBe('');
      expect(statSync(recordPath(dataDir)).size).toBe(0);
    } finally {
      await agent.shutdown();
    }
  });

  it('clears the longest healthy long-poll read, so a quiet minute is not an outage', () => {
    expect(FINANCE_LIVENESS_MAX_AGE_MS).toBeGreaterThan(POLL_POLICY.timeoutSeconds * 1_000);
  });
});
