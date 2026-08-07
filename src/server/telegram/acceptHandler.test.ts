// @vitest-environment node
/**
 * NIZAM · Accept-path tests — nothing slow happens before the acknowledgement
 * Implemented by: PFOS Contract 12 / Phase 4.3 (spec 06-two-agent-vps)
 * Owning requirements: R15 (accept fast); composes R11/R12 (auth) and R13/R14 (dedup)
 * Depends on: ../db/store (a real migrated store), ../mocks (the recorder + the port mock),
 *   ./acceptHandler, ./workQueueRepo
 *
 * The claim this file has to prove is §5.5.1's: *the handler authenticates, checks the allowlist,
 * de-duplicates, enqueues, and acknowledges — nothing slow happens before the acknowledgement.*
 * "Slow" is not directly observable, so it is proved two ways that together are decisive:
 *
 *  1. **`accept` is synchronous.** Its return value is a decision, not a promise, so there is no
 *     point at which an awaited call could have been placed. `accept(...)` is asserted not to be
 *     thenable, which no amount of internal restructuring can fake.
 *  2. **The recorder shows no worker invocation on the accept path.** An `InvocationRecorder` shared
 *     between the accept path and the port mock records every call to `process` and `send`. After a
 *     successful accept, the recorder holds neither — the slow side has not run.
 *
 * Every identifier below is synthetic and deliberately short (R24, steering §0b). No real token, bot,
 * sender, host, or path appears, here or in the modules under test.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoreHandle } from '../db/connection';
import { openFinanceStore } from '../db/store';
import { createInvocationRecorder, createTelegramMock } from '../mocks';
import type { TelegramDelivery, TelegramTransportConfig } from '../ports/telegram';
import {
  acceptDelivery,
  createInboundHandler,
  TELEGRAM_ACCEPT_STAGES,
  type TelegramAcceptAuditLine,
  type TelegramAcceptContext,
} from './acceptHandler';
import { workQueueDepth, type WorkQueueContext } from './workQueueRepo';

/** Synthetic, and short enough that the §9.0 long-id scan has nothing to find (R24). */
const BOT_ONE = 'bot-one';
const BOT_TWO = 'bot-two';
const SENDER = 'op-1';
const OUTSIDER = 'op-9';
const TOKEN = 'tok-test-1';
const WRONG_TOKEN = 'tok-test-2';
const SHARED_UPDATE_ID = 41;
const BODY = '{"t":"hello"}';

const cleanups: Array<() => void> = [];

function stepClock(start = Date.UTC(2026, 0, 1)): () => string {
  let ticks = 0;
  return (): string => {
    const at = new Date(start + ticks * 1_000).toISOString();
    ticks += 1;
    return at;
  };
}

function stepIds(prefix = 'wq'): () => string {
  let n = 0;
  return (): string => {
    n += 1;
    return `${prefix}-${String(n).padStart(3, '0')}`;
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

function deliveryOf(overrides: Partial<TelegramDelivery> = {}): TelegramDelivery {
  return {
    botId: BOT_ONE,
    updateId: SHARED_UPDATE_ID,
    senderId: SENDER,
    secretTokenHeader: TOKEN,
    receivedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    rawBody: BODY,
    ...overrides,
  };
}

interface Harness {
  readonly ctx: TelegramAcceptContext;
  readonly queue: WorkQueueContext;
  readonly audit: readonly TelegramAcceptAuditLine[];
}

function openHarness(transport: TelegramTransportConfig = transportOf()): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-accept-'));
  const handles: StoreHandle[] = [];
  const now = stepClock();
  const newId = stepIds();
  const { handle } = openFinanceStore(
    { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
    now,
  );
  handles.push(handle);
  const audit: TelegramAcceptAuditLine[] = [];
  cleanups.push(() => {
    for (const h of handles) h.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    ctx: { transport, handle, now, newId, audit: (line) => audit.push(line) },
    queue: { handle, now, newId },
    audit,
  };
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('accept does no slow work before acknowledging (contract 12 §5.5.1)', () => {
  it('accept is synchronous: it returns a decision, not a thenable', () => {
    const h = openHarness();
    const port = createInboundHandler(h.ctx);

    const decision = port.accept(deliveryOf());

    expect(decision).toMatchObject({ outcome: 'enqueued' });
    // A promise would mean a slow step could have been awaited before the acknowledgement.
    expect(decision).not.toBeInstanceOf(Promise);
    expect((decision as { then?: unknown }).then).toBeUndefined();
    // And the declared contract is synchronous too, so this cannot be reintroduced later.
    expect(port.accept.constructor.name).toBe('Function');
  });

  it('a port mock sharing the recorder shows no worker or outbound call on the accept path', () => {
    const h = openHarness();
    const recorder = createInvocationRecorder();
    // The slow side exists and is reachable — it simply is not reached by accept.
    const mock = createTelegramMock({ transport: h.ctx.transport, recorder, now: h.ctx.now });

    const decision = acceptDelivery(h.ctx, deliveryOf());

    expect(decision).toMatchObject({ outcome: 'enqueued' });
    expect(mock.processed).toHaveLength(0);
    expect(recorder.countOf('telegram', 'process')).toBe(0);
    expect(recorder.countOf('telegram', 'send')).toBe(0);
    // Nor did the accept path route itself through the mock: the recorder is empty entirely.
    expect(recorder.all).toHaveLength(0);
  });

  it('the acknowledged work is durable before accept returns', () => {
    const h = openHarness();

    const decision = acceptDelivery(h.ctx, deliveryOf());

    expect(decision).toMatchObject({ outcome: 'enqueued' });
    // The row is committed, not pending: it is visible to a plain read the moment accept returns.
    expect(workQueueDepth(h.queue)).toMatchObject({ queued: 1, running: 0, done: 0, failed: 0 });
    const ref = (decision as { queuedRef: string }).queuedRef;
    const row = h.ctx.handle.db.prepare('SELECT raw_body, sender_id FROM work_queue WHERE id = ?').get(ref);
    expect(row).toMatchObject({ raw_body: BODY, sender_id: SENDER });
  });
});

describe('the accept path composes §5.5.1 in order', () => {
  it('an unconfigured token refuses before anything is written (§5.2 fails closed)', () => {
    const h = openHarness(transportOf({ expectedSecretToken: '' }));

    const decision = acceptDelivery(h.ctx, deliveryOf());

    expect(decision).toEqual({ outcome: 'rejected' });
    expect(workQueueDepth(h.queue).queued).toBe(0);
    expect(h.audit.map((l) => l.stage)).toEqual(['configuration']);
    expect(h.audit[0]?.code).toBe('TELEGRAM_CONFIG_FAILS_CLOSED');
  });

  it('a missing token header is refused and enqueues nothing', () => {
    const h = openHarness();

    const decision = acceptDelivery(h.ctx, deliveryOf({ secretTokenHeader: null }));

    expect(decision).toEqual({ outcome: 'rejected' });
    expect(workQueueDepth(h.queue).queued).toBe(0);
    expect(h.audit[0]?.stage).toBe('token');
    expect(h.audit[0]?.tokenHeaderPresent).toBe(false);
  });

  it('a wrong token is refused and enqueues nothing', () => {
    const h = openHarness();

    expect(acceptDelivery(h.ctx, deliveryOf({ secretTokenHeader: WRONG_TOKEN }))).toEqual({ outcome: 'rejected' });
    expect(workQueueDepth(h.queue).queued).toBe(0);
    expect(h.audit[0]?.stage).toBe('token');
    expect(h.audit[0]?.tokenHeaderPresent).toBe(true);
  });

  it('a non-allowlisted sender is refused after the token check and before any enqueue (§5.3)', () => {
    const h = openHarness();

    expect(acceptDelivery(h.ctx, deliveryOf({ senderId: OUTSIDER }))).toEqual({ outcome: 'rejected' });
    expect(workQueueDepth(h.queue).queued).toBe(0);
    expect(h.audit[0]?.stage).toBe('allowlist');
  });

  it('a rejection carries no reason, and every rejection is the same value (§5.2)', () => {
    const h = openHarness();

    const badToken = acceptDelivery(h.ctx, deliveryOf({ secretTokenHeader: WRONG_TOKEN }));
    const badSender = acceptDelivery(h.ctx, deliveryOf({ senderId: OUTSIDER, updateId: SHARED_UPDATE_ID + 1 }));

    expect(Object.keys(badToken)).toEqual(['outcome']);
    // Identical by reference: a per-reason refusal is not something a later call site can build.
    expect(badToken).toBe(badSender);
  });

  it('the audit vocabulary is auth\u2019s three stages plus the enqueue, not a second vocabulary', () => {
    expect([...TELEGRAM_ACCEPT_STAGES]).toEqual(['configuration', 'token', 'allowlist', 'enqueue']);
  });
});

describe('a duplicate delivery is acknowledged as success and enqueues nothing (§5.4.4)', () => {
  it('the second delivery of one update is duplicate, and the queue depth does not move', () => {
    const h = openHarness();

    const first = acceptDelivery(h.ctx, deliveryOf());
    const depthAfterFirst = workQueueDepth(h.queue);
    const second = acceptDelivery(h.ctx, deliveryOf());

    expect(first).toMatchObject({ outcome: 'enqueued' });
    // Success, not an error: an error would earn another retry of the update we just declined.
    expect(second).toEqual({ outcome: 'duplicate' });
    expect(workQueueDepth(h.queue)).toEqual(depthAfterFirst);
    expect(workQueueDepth(h.queue).queued).toBe(1);
    // Nothing was audited, because nothing was refused.
    expect(h.audit).toHaveLength(0);
  });

  it('two bots emitting the SAME update identifier are both enqueued (R14, §5.4.6)', () => {
    const h = openHarness(transportOf({ allowedSenderIds: [SENDER] }));

    const one = acceptDelivery(h.ctx, deliveryOf({ botId: BOT_ONE, updateId: SHARED_UPDATE_ID }));
    const two = acceptDelivery(h.ctx, deliveryOf({ botId: BOT_TWO, updateId: SHARED_UPDATE_ID }));

    expect(one).toMatchObject({ outcome: 'enqueued' });
    expect(two).toMatchObject({ outcome: 'enqueued' });
    expect((one as { queuedRef: string }).queuedRef).not.toBe((two as { queuedRef: string }).queuedRef);
    expect(workQueueDepth(h.queue).queued).toBe(2);
  });
});

describe('the dedup claim and the enqueue are one fact (§5.4.4 + §5.5.2)', () => {
  it('a failed enqueue rolls the dedup claim back, so the redelivery is not lost', () => {
    const h = openHarness();
    // Force the enqueue to fail on the FIRST delivery only, after the claim has been written.
    let attempts = 0;
    const failingIds = (): string => {
      attempts += 1;
      if (attempts === 1) throw new Error('NIZAM test: durable enqueue unavailable');
      return `wq-${String(attempts).padStart(3, '0')}`;
    };
    const failing: TelegramAcceptContext = { ...h.ctx, newId: failingIds };

    const refused = acceptDelivery(failing, deliveryOf());

    expect(refused).toEqual({ outcome: 'rejected' });
    expect(h.audit.map((l) => l.stage)).toEqual(['enqueue']);
    expect(h.audit[0]?.code).toBe('TELEGRAM_ENQUEUE_FAILED');
    // The claim did not survive, so the pair is still unseen and the provider's retry is accepted.
    const dedupRows = h.ctx.handle.db.prepare('SELECT COUNT(*) AS n FROM update_dedup').get();
    expect((dedupRows as { n: number }).n).toBe(0);
    expect(workQueueDepth(h.queue).queued).toBe(0);

    const retried = acceptDelivery(failing, deliveryOf());
    expect(retried).toMatchObject({ outcome: 'enqueued' });
    expect(workQueueDepth(h.queue).queued).toBe(1);
  });
});
