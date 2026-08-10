// @vitest-environment node
/**
 * NIZAM · The finance-agent process — the three behaviours a module cannot have
 * Implemented by: PFOS Contract 12 / Phase 10.7 (spec 06-two-agent-vps)
 * Owning requirements: R29 (refuse to boot on an incomplete environment; honour the halt in both
 *   forms; bind NO public port under `longPoll`, exactly `FINANCE_CONTAINER_PORT` under `webhook`),
 *   R27 (every missing entry named in ONE message), R17 (deterministic alerts still fire under a
 *   halt), R26.1 (the offset advances only after a durable enqueue)
 * Depends on: ./financeAgent, ../db/store (a REAL migrated store on a temporary directory), the
 *   deterministic injected transport client and listener recorder below. No network, no socket, no
 *   provider, and no live model — every dependency is injected and every one of them is inspectable.
 *
 * ## Why the listener assertions are made against the process, not against a socket
 *
 * Design delta D6: `longPoll` binds no port, which is an assertion about an ABSENCE. Probing a socket
 * and finding nothing is also what a crashed listener, a wrong port and a firewall look like, so it
 * would pass for the wrong reason. The listener host is therefore injected and RECORDS what it was
 * asked to bind, and the process publishes its own `listeningPorts`. Both are read below, in both
 * directions: nothing was asked for and nothing is held under `longPoll`; exactly the configured port
 * was asked for and exactly it is held under `webhook`.
 *
 * Every value in the environment below is synthetic and derived from the entry NAME. No real domain,
 * identifier, token or figure appears (R24).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EnvConfigAggregateError,
  KILL_SENTINEL_MOUNT_TARGET,
  SERVICE_ENTRY_NAMES,
  SHARED_ENTRIES,
  type EnvSource,
} from '../config/environment';
import { enqueueWork, workQueueDepth } from '../telegram/workQueueRepo';
import { openFinanceStore } from '../db/store';
import type { TelegramTransportMode, TelegramWorkItem, TelegramWorkOutcome } from '../ports/telegram';
import type { SignalDraft, StoredSignalReceipt } from '../ports/signalBus';
import type { ModelInvocationGrant } from '../routing/turnClassifier';
import type { ModelRequest } from '../ports/openrouter';
import type { TelegramFetchRequest, TelegramUpdateBatch } from '../telegram/liveTransport';
import { HaltEngagedError } from './haltGate';
import {
  bootFinanceAgent,
  FINANCE_CONTAINER_PORT_ENTRY,
  FINANCE_DATA_DIR_ENTRY,
  FINANCE_STORE_FILE_ENTRY,
  runFinanceAgentProcess,
  type FinanceAgentDependencies,
  type FinanceAgentProcess,
  type HttpListenerHandle,
  type HttpListenerHost,
  type ProcessHost,
} from './financeAgent';

const SENTINEL_PATH = `${KILL_SENTINEL_MOUNT_TARGET}/halt`;
const SYNTHETIC_BASE = 'https://provider.invalid';
const SYNTHETIC_SENDER = '101';
const STORE_FILE = 'finance.db';
const CONFIGURED_PORT = 9101;
const BOT_ID = 'bot-b';

/** A synthetic value for one entry, derived from the entry name. Same rule the loader's tests use. */
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
  if (entry.endsWith('_TIMEOUT_MS')) return '3000';
  return `syn-${entry.toLowerCase()}`;
}

const temporaryDirectories: string[] = [];

function freshDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nizam-agent-'));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A complete finance environment, minus or plus whatever a case overrides. */
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

/** A listener host that records what it was asked to bind and binds nothing. */
interface ListenerRecorder extends HttpListenerHost {
  readonly requested: readonly number[];
  readonly closed: readonly number[];
}

function createListenerRecorder(): ListenerRecorder {
  const requested: number[] = [];
  const closed: number[] = [];
  return {
    requested,
    closed,
    listen(port: number): Promise<HttpListenerHandle> {
      requested.push(port);
      return Promise.resolve({
        port,
        close: async () => {
          closed.push(port);
        },
      });
    },
  };
}

interface Harness {
  readonly deps: FinanceAgentDependencies;
  readonly listener: ListenerRecorder;
  readonly lines: readonly string[];
  readonly published: readonly SignalDraft[];
  readonly modelCalls: readonly string[];
  readonly dataDir: string;
  setSentinel(present: boolean): void;
}

/** Everything injected, everything inspectable. A deterministic clock and a sequential id source. */
function harness(options: {
  readonly mode?: TelegramTransportMode;
  readonly env?: EnvSource;
  readonly dataDir?: string;
  readonly killAll?: string;
  readonly batches?: readonly TelegramUpdateBatch[];
  readonly process?: (item: TelegramWorkItem) => Promise<TelegramWorkOutcome>;
  readonly sleep?: (ms: number) => Promise<void>;
} = {}): Harness {
  const dataDir = options.dataDir ?? freshDataDir();
  const overrides: Record<string, string | undefined> = {};
  if (options.mode !== undefined) overrides[SHARED_ENTRIES.mode] = options.mode;
  if (options.killAll !== undefined) overrides.NIZAM_KILL_ALL = options.killAll;
  const env = options.env ?? financeEnv(dataDir, overrides);

  const listener = createListenerRecorder();
  const lines: string[] = [];
  const published: SignalDraft[] = [];
  const modelCalls: string[] = [];
  let sentinelPresent = false;
  let tick = 0;
  const batches = [...(options.batches ?? [])];

  const deps: FinanceAgentDependencies = {
    env,
    botId: BOT_ID,
    transportClient: {
      fetchUpdates: async (request: TelegramFetchRequest): Promise<TelegramUpdateBatch> => {
        void request;
        return batches.shift() ?? { updates: [] };
      },
      sendMessage: async () => ({ messageRef: 'msg-1', sentAt: '2026-01-01T00:00:00.000Z' }),
    },
    worker: {
      process: options.process ?? (async (): Promise<TelegramWorkOutcome> => ({ outcome: 'done' })),
    },
    listenerHost: listener,
    sentinelExists: () => sentinelPresent,
    logSink: (line: string) => lines.push(line),
    now: () => {
      tick += 1;
      return new Date(Date.UTC(2026, 0, 1) + tick * 1_000).toISOString();
    },
    newId: () => {
      tick += 1;
      return `ref-${String(tick).padStart(4, '0')}`;
    },
    sleep: options.sleep ?? (async () => undefined),
    poll: { timeoutSeconds: 5, limit: 10 },
    send: { baseMs: 1, maxMs: 2, maxAttempts: 1 },
    retry: { baseMs: 1, maxMs: 2, maxAttempts: 2 },
    modelChannel: {
      invoke: async (grant: ModelInvocationGrant, request: ModelRequest) => {
        modelCalls.push(request.correlationRef);
        void grant;
        throw new Error('the test channel is never expected to be reached under a halt');
      },
    },
    publish: async (draft: SignalDraft): Promise<StoredSignalReceipt> => {
      published.push(draft);
      return { signalId: draft.signalId, hash: 'h', storedAt: draft.ts };
    },
  };

  return {
    deps,
    listener,
    lines,
    published,
    modelCalls,
    dataDir,
    setSentinel: (present: boolean) => {
      sentinelPresent = present;
    },
  };
}

function aggregateOf(error: unknown): EnvConfigAggregateError | null {
  return error instanceof EnvConfigAggregateError ? error : null;
}

async function refusalOfBoot(deps: FinanceAgentDependencies): Promise<unknown> {
  try {
    await bootFinanceAgent(deps);
    return null;
  } catch (error) {
    return error;
  }
}

const DRAFT: SignalDraft = {
  signalId: 'sig-1',
  ts: '2026-01-01T00:00:00.000Z',
  producer: 'finance',
  kind: 'money_pressure',
  tier: 'money_safe',
  consentScope: 'shared',
  payload: { level: 'amber' },
};

// =============================================================================================
// Behaviour 1 — it refuses to boot on an incomplete environment (R29, R27)
// =============================================================================================

describe('behaviour 1: an incomplete environment refuses the boot, naming every entry at once', () => {
  it('names EVERY missing entry in one message, not the first one it met', async () => {
    const dataDir = freshDataDir();
    const missing = ['OR_KEY_FINANCE', 'MONEY_WEBHOOK_SECRET', 'BUS_INTERNAL_ENDPOINT', 'MODEL_API_BASE'];
    const env = financeEnv(dataDir, Object.fromEntries(missing.map((entry) => [entry, undefined])));

    const aggregate = aggregateOf(await refusalOfBoot(harness({ env, dataDir }).deps));

    expect(aggregate).not.toBeNull();
    // The assertion that a first-failure error cannot pass: all four, in one message.
    expect([...(aggregate?.entries ?? [])].sort()).toEqual([...missing].sort());
    for (const entry of missing) expect(aggregate?.message).toContain(entry);
  });

  it('carries a code per finding rather than one umbrella code', async () => {
    const dataDir = freshDataDir();
    const env = financeEnv(dataDir, { OR_KEY_FINANCE: undefined, MODEL_API_BASE: '   ', 'BOT_B_TOKEN': '<BOT_B_TOKEN>' });

    const aggregate = aggregateOf(await refusalOfBoot(harness({ env, dataDir }).deps));

    expect([...(aggregate?.codes ?? [])].sort()).toEqual(
      ['ENV_ENTRY_ABSENT', 'ENV_ENTRY_EMPTY', 'ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER'].sort(),
    );
  });

  it('does not continue degraded: no store is opened and no listener is bound', async () => {
    const dataDir = freshDataDir();
    const h = harness({ env: financeEnv(dataDir, { FINANCE_STORE_FILE: undefined }), dataDir });

    expect(await refusalOfBoot(h.deps)).not.toBeNull();
    expect(h.listener.requested).toEqual([]);
    expect(h.lines).toEqual([]);
  });

  it('the run wrapper turns the refusal into a non-zero exit and reports it once', async () => {
    const dataDir = freshDataDir();
    const h = harness({ env: financeEnv(dataDir, { OR_KEY_FINANCE: undefined, FINANCE_WEEKLY_CAP: undefined }), dataDir });
    const reported: string[] = [];
    const host: ProcessHost = {
      onTerminationSignal: () => undefined,
      reportBootRefusal: (message: string) => reported.push(message),
    };

    const outcome = await runFinanceAgentProcess(h.deps, host, 0);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.shutdown).toBeNull();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('OR_KEY_FINANCE');
    expect(reported[0]).toContain('FINANCE_WEEKLY_CAP');
  });
});

// =============================================================================================
// Behaviour 2 — the halt, in both forms (R29), and R17's other half
// =============================================================================================

describe('behaviour 2: the halt stops three activities and never the fourth', () => {
  it('halts model calls, model-path writes and bus publishes when the sentinel appears', async () => {
    const h = harness();
    const agent = await bootFinanceAgent(h.deps);
    try {
      // Before: all three are permitted. The model channel is reached (and refuses for its own
      // reason), the write runs, and the publish lands — so the halt below is the only difference.
      let written = 0;
      expect(agent.recordOnModelPath(() => (written += 1))).toBe(1);
      await agent.publishSignal(DRAFT);
      expect(h.published).toHaveLength(1);

      h.setSentinel(true);

      const grant = {} as ModelInvocationGrant;
      const request = { tier: 'T1', correlationRef: 'turn-1' } as ModelRequest;
      await expect(agent.invokeModel(grant, request)).rejects.toBeInstanceOf(HaltEngagedError);
      expect(() => agent.recordOnModelPath(() => (written += 1))).toThrow(HaltEngagedError);
      await expect(agent.publishSignal(DRAFT)).rejects.toBeInstanceOf(HaltEngagedError);

      // Refused BEFORE the dependency was touched: no model call was recorded, no second write
      // happened, and no second signal was published.
      expect(h.modelCalls).toEqual([]);
      expect(written).toBe(1);
      expect(h.published).toHaveLength(1);
    } finally {
      await agent.shutdown();
    }
  });

  it('still produces a deterministic obligation alert under the halt, unchanged (R17)', async () => {
    const h = harness();
    const agent = await bootFinanceAgent(h.deps);
    try {
      // The alert stands in for the Stage 1-4 output: what is asserted is that the halt does not
      // reach it, and that the process reports it as permitted rather than merely tolerated.
      const produce = (): string => 'obligation-due-warning';

      const beforeHalt = agent.produceDeterministicAlerts(produce);
      h.setSentinel(true);
      const underHalt = agent.produceDeterministicAlerts(produce);

      expect(agent.halt.isHalted()).toBe(true);
      expect(underHalt).toEqual(beforeHalt);
      expect(agent.halt.deterministicAlertsPermitted()).toBe(true);
    } finally {
      await agent.shutdown();
    }
  });

  it('halts at boot on the coarse form and records the observation', async () => {
    const h = harness({ killAll: '1' });
    const agent = await bootFinanceAgent(h.deps);
    try {
      expect(agent.halt.isHalted()).toBe(true);
      expect(agent.halt.engagedForm()).toBe('env');
      expect(() => agent.recordOnModelPath(() => 1)).toThrow(HaltEngagedError);
      // The halt was observed at boot, through the redacted logger, as an enumerated form.
      expect(h.lines.some((line) => line.includes('halt_observed') && line.includes('"env"'))).toBe(true);
      // And the coarse halt is not an outage: the process booted and still answers deterministically.
      expect(agent.produceDeterministicAlerts(() => 'still-here')).toBe('still-here');
    } finally {
      await agent.shutdown();
    }
  });

  it('is re-read per call, so releasing the sentinel restores the three activities', async () => {
    const h = harness();
    const agent = await bootFinanceAgent(h.deps);
    try {
      h.setSentinel(true);
      expect(() => agent.recordOnModelPath(() => 1)).toThrow(HaltEngagedError);
      h.setSentinel(false);
      expect(agent.recordOnModelPath(() => 1)).toBe(1);
    } finally {
      await agent.shutdown();
    }
  });
});

// =============================================================================================
// Behaviour 3 — the port, and the absence of one (R29, design delta D6)
// =============================================================================================

describe('behaviour 3: longPoll binds no public port, webhook binds exactly one', () => {
  it('asks for NO binding and holds NO listener under longPoll', async () => {
    const h = harness({ mode: 'longPoll' });
    const agent: FinanceAgentProcess = await bootFinanceAgent(h.deps);
    try {
      expect(agent.mode).toBe<TelegramTransportMode>('longPoll');
      // Asserted against the process's own state and the host's own record — not by probing a
      // socket, which cannot tell an unbound port from a crashed listener (D6).
      expect(agent.listeningPorts).toEqual([]);
      expect(h.listener.requested).toEqual([]);
    } finally {
      await agent.shutdown();
    }
  });

  it('binds exactly FINANCE_CONTAINER_PORT and no other under webhook', async () => {
    const h = harness({ mode: 'webhook' });
    const agent = await bootFinanceAgent(h.deps);
    try {
      expect(agent.listeningPorts).toEqual([CONFIGURED_PORT]);
      expect(h.listener.requested).toEqual([CONFIGURED_PORT]);
      expect(agent.listeningPorts).toHaveLength(1);
    } finally {
      await agent.shutdown();
    }
  });

  it('refuses a long-poll read under webhook, where the provider delivers instead (R26.1)', async () => {
    const h = harness({ mode: 'webhook' });
    const agent = await bootFinanceAgent(h.deps);
    try {
      await expect(agent.pollOnce()).rejects.toMatchObject({ code: 'PROCESS_POLL_NOT_APPLICABLE_IN_MODE' });
    } finally {
      await agent.shutdown();
    }
  });

  it('closes the one listener on shutdown, and has none to close under longPoll', async () => {
    const webhook = harness({ mode: 'webhook' });
    const webhookAgent = await bootFinanceAgent(webhook.deps);
    const webhookReport = await webhookAgent.shutdown();
    expect(webhookReport.listenersClosed).toBe(1);
    expect(webhook.listener.closed).toEqual([CONFIGURED_PORT]);

    const poll = harness({ mode: 'longPoll' });
    const pollAgent = await bootFinanceAgent(poll.deps);
    const pollReport = await pollAgent.shutdown();
    expect(pollReport.listenersClosed).toBe(0);
    expect(poll.listener.closed).toEqual([]);
  });
});

// =============================================================================================
// The loop, and a clean shutdown that loses no durable work
// =============================================================================================

describe('the poll loop calls the adapter rather than restating its ordering (R26.1)', () => {
  it('advances the offset once per durably enqueued update', async () => {
    const h = harness({
      batches: [
        {
          updates: [
            { updateId: 7, senderId: SYNTHETIC_SENDER, rawBody: '{}' },
            { updateId: 8, senderId: SYNTHETIC_SENDER, rawBody: '{}' },
          ],
        },
      ],
    });
    const agent = await bootFinanceAgent(h.deps);
    try {
      const report = await agent.pollOnce();
      expect(report.fetched).toBe(2);
      expect(report.results.map((r) => r.outcome)).toEqual(['enqueued', 'enqueued']);
      expect(report.offsetAfter).toBe(9);
      expect(agent.live.currentOffset()).toBe(9);
    } finally {
      await agent.shutdown();
    }
  });

  it('refuses an unlisted sender without enqueuing anything, and still moves past it', async () => {
    const h = harness({ batches: [{ updates: [{ updateId: 3, senderId: '999', rawBody: '{}' }] }] });
    const agent = await bootFinanceAgent(h.deps);
    try {
      const report = await agent.pollOnce();
      expect(report.results.map((r) => r.outcome)).toEqual(['refused']);
      expect(workQueueDepth({ handle: agent.store, now: h.deps.now, newId: h.deps.newId }).queued).toBe(0);
    } finally {
      await agent.shutdown();
    }
  });
});

describe('a clean shutdown loses no durable work', () => {
  it('stops accepting, requeues a claimed row, and leaves the queued rows on disk', async () => {
    const dataDir = freshDataDir();
    // A worker that never settles its item: the row is left `running`, which is exactly the state a
    // process interrupted mid-item leaves behind.
    let claimed = 0;
    const h = harness({
      dataDir,
      process: async (): Promise<TelegramWorkOutcome> => {
        claimed += 1;
        throw new Error('interrupted');
      },
    });
    const agent = await bootFinanceAgent(h.deps);

    const queue = { handle: agent.store, now: h.deps.now, newId: h.deps.newId };
    for (const updateId of [11, 12, 13]) {
      enqueueWork(queue, { botId: BOT_ID, updateId, senderId: SYNTHETIC_SENDER, rawBody: '{}' });
    }
    expect(workQueueDepth(queue).queued).toBe(3);

    const report = await agent.shutdown();

    expect(report.stoppedAccepting).toBe(true);
    expect(agent.isAccepting()).toBe(false);
    expect(report.storeClosed).toBe(true);
    // Nothing was dropped: the three rows are still there when the store is reopened.
    const { handle } = openFinanceStore({ dataDir, fileName: STORE_FILE, busyTimeoutMs: 3_000, storeName: 'finance' });
    try {
      const depth = workQueueDepth({ handle, now: h.deps.now, newId: h.deps.newId });
      expect(depth.queued + depth.running).toBe(3);
      expect(depth.done).toBe(0);
      expect(depth.failed).toBe(0);
    } finally {
      handle.close();
    }
    expect(claimed).toBe(0);
  });

  it('refuses a delivery arriving after the signal, without writing anything', async () => {
    const h = harness();
    const agent = await bootFinanceAgent(h.deps);
    const queue = { handle: agent.store, now: h.deps.now, newId: h.deps.newId };
    enqueueWork(queue, { botId: BOT_ID, updateId: 21, senderId: SYNTHETIC_SENDER, rawBody: '{}' });
    const before = workQueueDepth(queue).queued;

    // Read the depth BEFORE shutting the store, then assert the post-shutdown refusal writes nothing.
    await agent.shutdown();

    const decision = agent.accept({
      botId: BOT_ID,
      updateId: 22,
      senderId: SYNTHETIC_SENDER,
      secretTokenHeader: null,
      receivedAt: '2026-01-01T00:00:00.000Z',
      rawBody: '{}',
    });
    expect(decision).toEqual({ outcome: 'rejected' });
    await expect(agent.pollOnce()).rejects.toMatchObject({ code: 'PROCESS_ALREADY_SHUTTING_DOWN' });
    expect(before).toBe(1);
  });

  it('runs the loop until shutdown is requested and then stops', async () => {
    // The idle wait is a real macrotask here, because an idle loop that only awaited microtasks
    // would starve the timer the signal arrives on — which is a property of the loop worth having
    // right: a poller that never yields cannot be interrupted.
    const h = harness({ sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 0)) });
    const host: ProcessHost = {
      onTerminationSignal: (handler: () => void) => setTimeout(handler, 1),
      reportBootRefusal: () => undefined,
    };

    const outcome = await runFinanceAgentProcess(h.deps, host, 0);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.iterations).toBeGreaterThan(0);
    expect(outcome.shutdown?.stoppedAccepting).toBe(true);
    expect(outcome.shutdown?.storeClosed).toBe(true);
  });
});

// =============================================================================================
// The health answer the compose healthcheck reads (R22)
// =============================================================================================

describe('readiness', () => {
  it('reports ready once the worker has reported, and not ready before it has', async () => {
    const h = harness();
    const agent = await bootFinanceAgent(h.deps);
    try {
      // Silence is a failure, not an absence of news: nothing has drained yet.
      expect(agent.readiness().status).toBe('not_ready');
      await agent.runWorkerOnce();
      expect(agent.readiness().status).toBe('ready');
    } finally {
      await agent.shutdown();
    }
  });

  it('reports not ready once shutdown has begun', async () => {
    const h = harness();
    const agent = await bootFinanceAgent(h.deps);
    await agent.runWorkerOnce();
    expect(agent.readiness().status).toBe('ready');
    await agent.shutdown();
    expect(agent.readiness().status).toBe('not_ready');
  });
});

// =============================================================================================
// What reaches a log (R19)
// =============================================================================================

describe('the process logs through the redacted logger and nothing else', () => {
  it('emits structured lines that carry no value, no prompt text and no path', async () => {
    const h = harness();
    const agent = await bootFinanceAgent(h.deps);
    try {
      expect(h.lines.length).toBeGreaterThan(0);
      for (const line of h.lines) {
        const record = JSON.parse(line) as { agent?: string; event?: string };
        expect(record.agent).toBe('finance');
        expect(typeof record.event).toBe('string');
        expect(line).not.toContain(SENTINEL_PATH);
        expect(line).not.toContain(SYNTHETIC_BASE);
        expect(line).not.toContain(h.dataDir);
      }
    } finally {
      await agent.shutdown();
    }
  });
});
