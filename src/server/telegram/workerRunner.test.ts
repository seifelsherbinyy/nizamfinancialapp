// @vitest-environment node
/**
 * NIZAM · Worker runner tests — a downstream failure stays in the queue
 * Implemented by: PFOS Contract 12 / Phase 4.3 (spec 06-two-agent-vps)
 * Owning requirements: R15 (accept fast, process asynchronously)
 * Depends on: ../db/store (a real migrated store), ../mocks, ./acceptHandler, ./workQueueRepo,
 *   ./workerRunner
 *
 * The claim this file has to prove is §5.5.4's: *a downstream failure — model, network, provider — is
 * a QUEUE failure with its own retry and backoff; it never becomes a transport-level failure that
 * triggers redelivery.* Two properties together are what "never becomes a transport failure" means
 * operationally, and both are asserted:
 *
 *  1. **The drain resolves.** A worker that throws does not make {@link drainWorkQueue} reject. Were
 *     it to reject, a caller draining inside a request handler would answer the provider with a
 *     failure and earn a redelivery, which is exactly the path §5.5 removes.
 *  2. **The transport decision is untouched.** The accept path already returned `enqueued` before the
 *     worker ran, and the dedup row still holds the pair afterwards — so the failure changed nothing
 *     about what the provider was told, and a redelivery of the same update is still a duplicate.
 *
 * Concurrency (§5.5.5) is proved by observation rather than by inspection:
 * {@link WorkerDrainReport.peakInFlight} is the largest number of items actually in flight at once,
 * measured with a worker that holds every item open until all lanes are occupied. A batch-shaped
 * implementation would satisfy a claim about its batch size while still running an unbounded number
 * of items per pass, so the peak is the honest measure.
 *
 * Every identifier below is synthetic and deliberately short (R24, steering §0b).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoreHandle } from '../db/connection';
import { openFinanceStore } from '../db/store';
import type {
  TelegramDelivery,
  TelegramTransportConfig,
  TelegramWorkItem,
  TelegramWorkOutcome,
  TelegramWorkerPort,
} from '../ports/telegram';
import { acceptDelivery, type TelegramAcceptContext } from './acceptHandler';
import {
  claimNextWork,
  reclaimStalledWork,
  workQueueDepth,
  type WorkQueueContext,
  type WorkRetryPolicy,
} from './workQueueRepo';
import { createWorkerRunner, drainWorkQueue, type WorkerFailureLine } from './workerRunner';

const BOT_ONE = 'bot-one';
const SENDER = 'op-1';
const TOKEN = 'tok-test-1';
const FIRST_UPDATE_ID = 41;
const BODY = '{"t":"hello"}';

/**
 * The injected retry policy. `baseMs` is deliberately far larger than the stepping clock's tick, so a
 * retried item is genuinely not claimable again inside the same drain: a backoff shorter than the
 * clock's resolution would elapse instantly and the pass would loop, which measures the clock rather
 * than the scheduling.
 */
const RETRY: WorkRetryPolicy = { baseMs: 60_000, maxMs: 3_600_000, maxAttempts: 3 };

const cleanups: Array<() => void> = [];

function stepClock(start = Date.UTC(2026, 0, 1)): () => string {
  let ticks = 0;
  return (): string => {
    const at = new Date(start + ticks * 1_000).toISOString();
    ticks += 1;
    return at;
  };
}

function stepIds(): () => string {
  let n = 0;
  return (): string => {
    n += 1;
    return `wq-${String(n).padStart(3, '0')}`;
  };
}

function transportOf(overrides: Partial<TelegramTransportConfig> = {}): TelegramTransportConfig {
  return {
    botId: BOT_ONE,
    expectedSecretToken: TOKEN,
    allowedSenderIds: [SENDER],
    apiBaseUrlRef: '<TELEGRAM_API_BASE>',
    mode: 'webhook',
    maxConcurrentWorkItems: 2,
    ...overrides,
  };
}

function deliveryOf(updateId: number): TelegramDelivery {
  return {
    botId: BOT_ONE,
    updateId,
    senderId: SENDER,
    secretTokenHeader: TOKEN,
    receivedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    rawBody: BODY,
  };
}

interface Harness {
  readonly accept: TelegramAcceptContext;
  readonly queue: WorkQueueContext;
  readonly handle: StoreHandle;
}

function openHarness(transport: TelegramTransportConfig = transportOf()): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-worker-'));
  const now = stepClock();
  const newId = stepIds();
  const { handle } = openFinanceStore(
    { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
    now,
  );
  cleanups.push(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { accept: { transport, handle, now, newId }, queue: { handle, now, newId }, handle };
}

/** A worker that records what it saw and answers however the test says. */
function scriptedWorker(answer: (item: TelegramWorkItem) => Promise<TelegramWorkOutcome>): {
  readonly port: TelegramWorkerPort;
  readonly seen: readonly TelegramWorkItem[];
} {
  const seen: TelegramWorkItem[] = [];
  return {
    port: {
      async process(item) {
        seen.push(item);
        return answer(item);
      },
    },
    get seen() {
      return [...seen];
    },
  };
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('the worker runs after the acknowledgement (contract 12 §5.5)', () => {
  it('drains what the accept path enqueued and settles it done', async () => {
    const h = openHarness();
    acceptDelivery(h.accept, deliveryOf(FIRST_UPDATE_ID));
    const worker = scriptedWorker(async () => ({ outcome: 'done' }));

    const report = await drainWorkQueue({
      queue: h.queue,
      worker: worker.port,
      maxConcurrentWorkItems: h.accept.transport.maxConcurrentWorkItems,
      retry: RETRY,
    });

    expect(report).toMatchObject({ claimed: 1, done: 1, retried: 0, abandoned: 0 });
    expect(worker.seen).toHaveLength(1);
    expect(worker.seen[0]?.rawBody).toBe(BODY);
    expect(workQueueDepth(h.queue)).toMatchObject({ done: 1, queued: 0, running: 0 });
  });

  it('processing the same item twice has one effect: a second drain finds nothing', async () => {
    const h = openHarness();
    acceptDelivery(h.accept, deliveryOf(FIRST_UPDATE_ID));
    let effects = 0;
    const worker = scriptedWorker(async () => {
      effects += 1;
      return { outcome: 'done' };
    });
    const runner = createWorkerRunner({
      queue: h.queue,
      worker: worker.port,
      maxConcurrentWorkItems: 2,
      retry: RETRY,
    });

    const first = await runner.runOnce();
    const second = await runner.runOnce();

    expect(first.done).toBe(1);
    expect(second).toMatchObject({ claimed: 0, done: 0 });
    expect(effects).toBe(1);
  });

  it('a reclaimed item is settled once even though it was handed out twice', async () => {
    const h = openHarness();
    acceptDelivery(h.accept, deliveryOf(FIRST_UPDATE_ID));
    // Hand the item out and abandon it the way a crashed worker would: no settlement at all.
    const stranded = claimNextWork(h.queue, 1)[0];
    expect(stranded).toBeDefined();

    // The item is re-handed by a drain only after a reclaim; before that it is unreachable.
    const worker = scriptedWorker(async () => ({ outcome: 'done' }));
    const before = await drainWorkQueue({ queue: h.queue, worker: worker.port, maxConcurrentWorkItems: 2, retry: RETRY });
    expect(before.claimed).toBe(0);

    expect(reclaimStalledWork(h.queue, 1)).toBe(1);
    const after = await drainWorkQueue({ queue: h.queue, worker: worker.port, maxConcurrentWorkItems: 2, retry: RETRY });

    expect(after).toMatchObject({ claimed: 1, done: 1 });
    // One row, one terminal state. The double hand-out did not become a double settlement.
    expect(workQueueDepth(h.queue)).toMatchObject({ done: 1, queued: 0, running: 0, failed: 0 });
  });
});

describe('a downstream failure is a queue failure, never a transport failure (§5.5.4)', () => {
  it('a worker that throws does not make the drain reject, and the item is retried in the queue', async () => {
    const h = openHarness();
    const accepted = acceptDelivery(h.accept, deliveryOf(FIRST_UPDATE_ID));
    expect(accepted).toMatchObject({ outcome: 'enqueued' });

    const failures: WorkerFailureLine[] = [];
    const worker = scriptedWorker(async () => {
      // A provider outage, seen from this side. Any thrown value would do.
      throw Object.assign(new Error('NIZAM test: provider unavailable'), { code: 'MODEL_PROVIDER_UNAVAILABLE' });
    });

    // Resolves. It does not reject, which is the whole of "never a transport failure".
    const report = await drainWorkQueue({
      queue: h.queue,
      worker: worker.port,
      maxConcurrentWorkItems: 2,
      retry: RETRY,
      onFailure: (line) => failures.push(line),
    });

    expect(report).toMatchObject({ claimed: 1, done: 0, retried: 1, abandoned: 0 });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ disposition: 'retry', code: 'MODEL_PROVIDER_UNAVAILABLE', attempt: 1 });
    // Back in the queue with a backoff, not lost and not reported outward.
    expect(workQueueDepth(h.queue)).toMatchObject({ queued: 1, running: 0, failed: 0 });
    const row = h.handle.db.prepare('SELECT not_before FROM work_queue').get();
    expect(typeof (row as { not_before?: unknown }).not_before).toBe('string');
  });

  it('the transport decision is unchanged by the failure: the redelivery is still a duplicate', async () => {
    const h = openHarness();
    acceptDelivery(h.accept, deliveryOf(FIRST_UPDATE_ID));
    const worker = scriptedWorker(async () => {
      throw new Error('NIZAM test: downstream unavailable');
    });

    await drainWorkQueue({ queue: h.queue, worker: worker.port, maxConcurrentWorkItems: 1, retry: RETRY });

    // The dedup row survived the failure, so the provider is told the same thing it was told before:
    // this update is handled. A failure that reached the transport would have inverted that.
    const redelivered = acceptDelivery(h.accept, deliveryOf(FIRST_UPDATE_ID));
    expect(redelivered).toEqual({ outcome: 'duplicate' });
    expect(workQueueDepth(h.queue).queued).toBe(1);
  });

  it('a thrown value with no recognisable code is still retried, with a null code rather than a guess', async () => {
    const h = openHarness();
    acceptDelivery(h.accept, deliveryOf(FIRST_UPDATE_ID));
    const worker = scriptedWorker(async () => {
      throw 'NIZAM test: a bare string';
    });

    const report = await drainWorkQueue({ queue: h.queue, worker: worker.port, maxConcurrentWorkItems: 1, retry: RETRY });

    expect(report.retried).toBe(1);
    expect(report.failures[0]).toMatchObject({ disposition: 'retry', code: null });
  });

  it('a repeatedly failing item is abandoned at the attempt ceiling, still without a transport failure', async () => {
    const h = openHarness();
    acceptDelivery(h.accept, deliveryOf(FIRST_UPDATE_ID));
    const worker = scriptedWorker(async () => {
      throw new Error('NIZAM test: permanently unavailable');
    });
    const ctx = { queue: h.queue, worker: worker.port, maxConcurrentWorkItems: 1, retry: RETRY };

    // Each pass: one attempt, then a backoff. Clear the backoff so the next pass can claim it.
    const clearBackoff = (): void => {
      h.handle.db.exec("UPDATE work_queue SET not_before = NULL WHERE state = 'queued'");
    };

    const passes = [] as Array<{ retried: number; abandoned: number }>;
    for (let i = 0; i < RETRY.maxAttempts; i += 1) {
      const report = await drainWorkQueue(ctx);
      passes.push({ retried: report.retried, abandoned: report.abandoned });
      clearBackoff();
    }

    // Retried while attempts remained, abandoned on the last one. Never a rejection.
    expect(passes.map((p) => p.retried)).toEqual([1, 1, 0]);
    expect(passes.map((p) => p.abandoned)).toEqual([0, 0, 1]);
    expect(workQueueDepth(h.queue)).toMatchObject({ failed: 1, queued: 0, running: 0 });
  });

  it('a worker that REPORTS retry or abandoned is honoured without an error either', async () => {
    const h = openHarness();
    acceptDelivery(h.accept, deliveryOf(FIRST_UPDATE_ID));
    const notBefore = new Date(Date.UTC(2026, 0, 2)).toISOString();
    const retrying = scriptedWorker(async () => ({ outcome: 'retry', notBefore }));

    const first = await drainWorkQueue({ queue: h.queue, worker: retrying.port, maxConcurrentWorkItems: 1, retry: RETRY });
    expect(first).toMatchObject({ retried: 1, abandoned: 0, done: 0 });
    expect(workQueueDepth(h.queue)).toMatchObject({ queued: 1, running: 0 });

    h.handle.db.exec("UPDATE work_queue SET not_before = NULL WHERE state = 'queued'");
    const abandoning = scriptedWorker(async () => ({ outcome: 'abandoned', code: 'MODEL_RESPONSE_SCHEMA_INVALID' }));
    const second = await drainWorkQueue({ queue: h.queue, worker: abandoning.port, maxConcurrentWorkItems: 1, retry: RETRY });

    expect(second).toMatchObject({ abandoned: 1, retried: 0, done: 0 });
    expect(second.failures[0]).toMatchObject({ disposition: 'abandoned', code: 'MODEL_RESPONSE_SCHEMA_INVALID' });
  });
});

describe('concurrency is bounded (§5.5.5)', () => {
  it('never runs more items at once than the configured ceiling', async () => {
    const ceiling = 2;
    const total = 6;
    const h = openHarness(transportOf({ maxConcurrentWorkItems: ceiling }));
    for (let i = 0; i < total; i += 1) acceptDelivery(h.accept, deliveryOf(FIRST_UPDATE_ID + i));
    expect(workQueueDepth(h.queue).queued).toBe(total);

    // Hold every item open until the lanes are saturated, so the peak is actually reached.
    let live = 0;
    let observedPeak = 0;
    const gate: Array<() => void> = [];
    const worker = scriptedWorker(async () => {
      live += 1;
      if (live > observedPeak) observedPeak = live;
      await new Promise<void>((resolve) => {
        gate.push(resolve);
        // Release once the lanes are full, so the measurement is of saturation, not of luck.
        if (gate.length >= ceiling) while (gate.length > 0) gate.pop()?.();
      });
      live -= 1;
      return { outcome: 'done' };
    });

    const report = await drainWorkQueue({
      queue: h.queue,
      worker: worker.port,
      maxConcurrentWorkItems: ceiling,
      retry: RETRY,
    });

    expect(report).toMatchObject({ claimed: total, done: total });
    // The ceiling held even though there was more work than lanes.
    expect(report.peakInFlight).toBeLessThanOrEqual(ceiling);
    expect(observedPeak).toBeLessThanOrEqual(ceiling);
    expect(report.peakInFlight).toBe(ceiling);
  });

  it('refuses an unbounded ceiling rather than defaulting to one', async () => {
    const h = openHarness();
    const worker = scriptedWorker(async () => ({ outcome: 'done' }));
    await expect(
      drainWorkQueue({ queue: h.queue, worker: worker.port, maxConcurrentWorkItems: 0, retry: RETRY }),
    ).rejects.toThrow(/bounded/);
  });
});
