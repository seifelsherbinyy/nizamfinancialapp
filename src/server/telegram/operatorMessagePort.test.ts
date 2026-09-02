// @vitest-environment node
/**
 * NIZAM · Operator message port and durable queue adapter tests
 * Owning contract: PFOS Contract 12 — Two-Agent VPS Deployment & Operations; UPOI task 5.1
 * Phase: Phase 5.1 authenticated operator intake and durable queue tests
 * Owning requirements: 1.1, 1.2, 1.3; Design Sections 6.4, 9.1, 20
 * Depends on: ../db/store, ../ops/redactedLogger, ./operatorMessagePort
 *
 * Synthetic-only tests against the real local SQLite store. No provider, secret, webhook, host,
 * user, or deployment identifier is used. The assertions cover the accept acknowledgement boundary,
 * bot-scoped keys, durable queue transitions, bounded lease reclaim, retries, and redacted output.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFinanceStore } from '../db/store.ts';
import { createRedactedLogger, logLineBreaches } from '../ops/redactedLogger.ts';
import type { StoreHandle } from '../db/connection.ts';
import type { TelegramDelivery, TelegramTransportConfig } from '../ports/telegram.ts';
import {
  createOperatorMessagePort,
  OPERATOR_DELIVERY_REFUSED,
  type OperatorMessagePortContext,
} from './operatorMessagePort.ts';

const BOT_ONE = 'bot-one';
const BOT_TWO = 'bot-two';
const SENDER = 'operator-one';
const OUTSIDER = 'operator-two';
const TOKEN = 'tok-synthetic-1';
const BODY = '{"synthetic":"turn"}';
const UPDATE_ID = 41;
const RETRY_POLICY = { baseMs: 1_000, maxMs: 60_000, maxAttempts: 3 } as const;

const cleanups: Array<() => void> = [];

function stepClock(start = Date.UTC(2026, 0, 1)): () => string {
  let ticks = 0;
  return (): string => new Date(start + ticks++ * 1_000).toISOString();
}

function ids(prefix = 'queue'): () => string {
  let n = 0;
  return (): string => `${prefix}-${String(++n).padStart(3, '0')}`;
}

function transportOf(botId = BOT_ONE): TelegramTransportConfig {
  return {
    botId,
    expectedSecretToken: TOKEN,
    allowedSenderIds: [SENDER],
    apiBaseUrlRef: '<SYNTHETIC_PROVIDER_REF>',
    mode: 'webhook',
    maxConcurrentWorkItems: 1,
  };
}

function deliveryOf(overrides: Partial<TelegramDelivery> = {}): TelegramDelivery {
  return {
    botId: BOT_ONE,
    updateId: UPDATE_ID,
    senderId: SENDER,
    secretTokenHeader: TOKEN,
    receivedAt: '2026-01-01T00:00:00.000Z',
    rawBody: BODY,
    ...overrides,
  };
}

interface Harness {
  readonly port: ReturnType<typeof createOperatorMessagePort>;
  readonly handle: StoreHandle;
  readonly lines: string[];
  readonly now: () => string;
}

function openHarness(botId = BOT_ONE): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-operator-port-'));
  const now = stepClock();
  const { handle } = openFinanceStore(
    { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
    now,
  );
  const lines: string[] = [];
  const logger = createRedactedLogger('finance', (line) => lines.push(line), now);
  const context: OperatorMessagePortContext = {
    transport: transportOf(botId),
    handle,
    now,
    newId: ids(botId),
    logger,
  };
  cleanups.push(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { port: createOperatorMessagePort(context), handle, lines, now };
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('authenticated operator accept and bot-scoped delivery keys', () => {
  it('durably enqueues before returning, and repeats are successful no-ops', () => {
    const h = openHarness();

    const first = h.port.accept(deliveryOf());
    expect(first.outcome).toBe('enqueued');
    const queuedRef = (first as { queuedRef: string }).queuedRef;
    expect(h.handle.db.prepare('SELECT state, raw_body FROM work_queue WHERE id = ?').get(queuedRef)).toEqual({
      state: 'queued',
      raw_body: BODY,
    });

    const duplicate = h.port.accept(deliveryOf());
    expect(duplicate).toEqual({ outcome: 'duplicate' });
    expect(h.handle.db.prepare('SELECT COUNT(*) AS n FROM work_queue').get()).toEqual({ n: 1 });
    expect(h.lines).toHaveLength(2);
    expect(JSON.parse(h.lines[1] ?? '').event).toBe('update_duplicate_ignored');
  });

  it('keeps the same update identifier independent across separate bot ports', () => {
    const h = openHarness(BOT_ONE);
    const second = openHarness(BOT_TWO);
    // Use the same store for this second port, while retaining its separate bot configuration.
    const logger = createRedactedLogger('finance', () => undefined, second.now);
    const other = createOperatorMessagePort({
      transport: transportOf(BOT_TWO),
      handle: h.handle,
      now: h.now,
      newId: ids(BOT_TWO),
      logger,
    });

    expect(h.port.accept(deliveryOf({ botId: BOT_ONE }))).toMatchObject({ outcome: 'enqueued' });
    expect(other.accept(deliveryOf({ botId: BOT_TWO }))).toMatchObject({ outcome: 'enqueued' });
    expect(h.handle.db.prepare('SELECT COUNT(*) AS n FROM work_queue').get()).toEqual({ n: 2 });
  });

  it('refuses an unexpected bot namespace and an unallowlisted sender with one generic code', () => {
    const h = openHarness();

    const wrongBot = h.port.accept(deliveryOf({ botId: BOT_TWO }));
    const wrongSender = h.port.accept(deliveryOf({ senderId: OUTSIDER, updateId: UPDATE_ID + 1 }));

    expect(wrongBot).toEqual({ outcome: 'rejected', code: OPERATOR_DELIVERY_REFUSED });
    expect(wrongSender).toEqual({ outcome: 'rejected', code: OPERATOR_DELIVERY_REFUSED });
    expect(h.handle.db.prepare('SELECT COUNT(*) AS n FROM work_queue').get()).toEqual({ n: 0 });
  });
});

describe('durable queue claims, leases, and retries', () => {
  it('claims atomically, does not double-claim, and reclaims an expired lease', () => {
    const h = openHarness();
    expect(h.port.accept(deliveryOf())).toMatchObject({ outcome: 'enqueued' });

    const first = h.port.queue.claim(1);
    expect(first).toHaveLength(1);
    expect(h.port.queue.claim(1)).toHaveLength(0);
    expect(h.port.queue.reclaimExpired(500)).toBe(1);
    expect(h.port.queue.claim(1)).toHaveLength(1);
  });

  it('keeps retry inside the queue with deterministic bounded backoff', () => {
    const h = openHarness();
    expect(h.port.accept(deliveryOf())).toMatchObject({ outcome: 'enqueued' });
    const item = h.port.queue.claim(1)[0];
    expect(item).toBeDefined();

    const notBefore = h.port.queue.retryAt(RETRY_POLICY, item!.attempt);
    const nextNotBefore = h.port.queue.retryAt(RETRY_POLICY, item!.attempt);
    expect(Date.parse(nextNotBefore) - Date.parse(notBefore)).toBe(1_000);
    expect(Date.parse(notBefore)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'));
    const retryInstant = new Date(Date.parse(h.now()) + 60_000).toISOString();
    expect(h.port.queue.settle(item!.queuedRef, { outcome: 'retry', notBefore: retryInstant })).toMatchObject({ settled: true, state: 'queued' });
    expect(h.port.queue.claim(1)).toHaveLength(0);
  });
});

describe('redacted transport logging', () => {
  it('logs only closed outcomes and never body, sender, bot, token, or provider reference', () => {
    const h = openHarness();
    h.port.accept(deliveryOf({ secretTokenHeader: 'tok-wrong-2' }));
    h.port.accept(deliveryOf({ senderId: OUTSIDER }));
    h.port.accept(deliveryOf());

    const serialized = h.lines.join('\n');
    expect(serialized).not.toContain(BODY);
    expect(serialized).not.toContain(SENDER);
    expect(serialized).not.toContain(OUTSIDER);
    expect(serialized).not.toContain(BOT_ONE);
    expect(serialized).not.toContain(TOKEN);
    for (const line of h.lines) expect(logLineBreaches(line)).toEqual([]);
    expect(h.lines.map((line) => JSON.parse(line).fields.outcome.value)).toEqual([
      'operator_refused',
      'operator_refused',
      'accepted',
    ]);
  });
});
