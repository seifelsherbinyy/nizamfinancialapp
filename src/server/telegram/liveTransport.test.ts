// @vitest-environment node
/**
 * NIZAM · The live transport adapter, driven by a deterministic client — contract 12 §5, §2.3
 * Implemented by: PFOS Contract 12 / Phase 10.5 (spec 06-two-agent-vps)
 * Owning requirements: R26 (both modes behind one port), R26.1 (the offset advances only after the
 *   enqueue commits), R15 (accept fast, process asynchronously)
 * Depends on: ./liveTransport, ./acceptHandler, ../db/store, ../ports/telegram
 *
 * There is **no network in this file and none in the module it tests**: the adapter's whole outside
 * world is the injected `TelegramTransportClient`, and the implementation below is a script over an
 * array. That is the house pattern (`mocks/telegramMock.ts`), and it is why this adapter is
 * buildable before G3 and G6 (steering §2).
 *
 * The durability ordering is asserted **against the offset**, never against a sleep: `sleep` is
 * injected and records the intervals it was asked for, so the retry schedule is read rather than
 * waited for.
 *
 * Every identifier here is synthetic and deliberately short (R24, steering §0b): no real token,
 * bot, sender, host, path, or figure appears.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openFinanceStore } from '../db/store.ts';
import type {
  TelegramOutboundMessage,
  TelegramSendReceipt,
  TelegramTransportConfig,
  TelegramWorkItem,
  TelegramWorkerPort,
  TelegramWorkOutcome,
} from '../ports/telegram.ts';
import type { TelegramAcceptAuditLine, TelegramAcceptContext } from './acceptHandler.ts';
import {
  createInMemoryOffsetStore,
  createLiveTelegramTransport,
  isRateLimitRefusal,
  LiveTransportError,
  sendBackoffMs,
  sendRetryDelayMs,
  TelegramRateLimitRefusal,
  type TelegramFetchRequest,
  type TelegramLiveTransportContext,
  type TelegramPolledUpdate,
  type TelegramTransportClient,
  type TelegramUpdateBatch,
} from './liveTransport.ts';
import { workQueueDepth } from './workQueueRepo.ts';

const BOT = 'bot-one';
const OWNER = 'op-1';
const OUTSIDER = 'op-9';
const TOKEN = 'tok-test-1';
const BODY = '{"t":"hello"}';

const POLL = { timeoutSeconds: 25, limit: 10 } as const;
const SEND = { baseMs: 500, maxMs: 8_000, maxAttempts: 3 } as const;

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function stepClock(start = Date.UTC(2026, 0, 1)): () => string {
  let ticks = 0;
  return (): string => {
    const at = new Date(start + ticks * 1_000).toISOString();
    ticks += 1;
    return at;
  };
}

function transportOf(overrides: Partial<TelegramTransportConfig> = {}): TelegramTransportConfig {
  return {
    botId: BOT,
    expectedSecretToken: TOKEN,
    allowedSenderIds: [OWNER],
    apiBaseUrlRef: '<MSG_API_BASE>',
    mode: 'longPoll',
    maxConcurrentWorkItems: 2,
    ...overrides,
  };
}

function updateOf(updateId: number, senderId: string = OWNER): TelegramPolledUpdate {
  return { updateId, senderId, rawBody: BODY };
}

/** A deterministic client: one scripted batch per fetch, and a scripted send outcome per call. */
interface ScriptedClient extends TelegramTransportClient {
  readonly fetches: readonly TelegramFetchRequest[];
  readonly sends: readonly TelegramOutboundMessage[];
}

function scriptedClient(
  batches: readonly (readonly TelegramPolledUpdate[])[],
  sendScript: readonly ('ok' | TelegramRateLimitRefusal | Error)[] = ['ok'],
): ScriptedClient {
  const fetches: TelegramFetchRequest[] = [];
  const sends: TelegramOutboundMessage[] = [];
  let fetchSeq = 0;
  let sendSeq = 0;
  return {
    fetches,
    sends,
    async fetchUpdates(request: TelegramFetchRequest): Promise<TelegramUpdateBatch> {
      fetches.push(request);
      const batch = batches[fetchSeq] ?? [];
      fetchSeq += 1;
      // The provider re-serves what was never acknowledged: anything below the requested offset is
      // already acknowledged and is not handed back again.
      return { updates: batch.filter((u) => u.updateId >= request.offset) };
    },
    async sendMessage(message: TelegramOutboundMessage): Promise<TelegramSendReceipt> {
      sends.push(message);
      const step = sendScript[Math.min(sendSeq, sendScript.length - 1)] ?? 'ok';
      sendSeq += 1;
      if (step !== 'ok') throw step;
      return { messageRef: `sent:${sendSeq}`, sentAt: new Date(Date.UTC(2026, 0, 1)).toISOString() };
    },
  };
}

const doneWorker: TelegramWorkerPort = {
  async process(_item: TelegramWorkItem): Promise<TelegramWorkOutcome> {
    return { outcome: 'done' };
  },
};

interface Harness {
  readonly ctx: TelegramLiveTransportContext;
  readonly accept: TelegramAcceptContext;
  readonly audit: readonly TelegramAcceptAuditLine[];
  readonly waits: readonly number[];
}

interface HarnessOptions {
  readonly transport?: TelegramTransportConfig;
  readonly client?: TelegramTransportClient;
  readonly newId?: () => string;
  readonly offsets?: ReturnType<typeof createInMemoryOffsetStore>;
}

function openHarness(options: HarnessOptions = {}): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-live-'));
  const now = stepClock();
  const { handle } = openFinanceStore({ dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' }, now);
  cleanups.push(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const audit: TelegramAcceptAuditLine[] = [];
  const waits: number[] = [];
  let n = 0;
  const accept: TelegramAcceptContext = {
    transport: options.transport ?? transportOf(),
    handle,
    now,
    newId:
      options.newId ??
      ((): string => {
        n += 1;
        return `wq-${String(n).padStart(3, '0')}`;
      }),
    audit: (line) => audit.push(line),
  };

  return {
    accept,
    audit,
    waits,
    ctx: {
      accept,
      client: options.client ?? scriptedClient([[updateOf(1)]]),
      worker: doneWorker,
      poll: POLL,
      send: SEND,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      ...(options.offsets === undefined ? {} : { offsets: options.offsets }),
    },
  };
}

describe('the adapter is built behind the EXISTING port, in both modes (R26)', () => {
  it('exposes the three port roles under longPoll and under webhook alike', () => {
    for (const mode of ['longPoll', 'webhook'] as const) {
      const harness = openHarness({ transport: transportOf({ mode }) });
      const live = createLiveTelegramTransport(harness.ctx);
      expect(live.mode).toBe(mode);
      // The port's own shape, unchanged: the inbound role is SYNCHRONOUS in both modes, so nothing
      // slow can be written before the acknowledgement (§5.5, R15).
      expect(typeof live.port.inbound.accept).toBe('function');
      expect(typeof live.port.worker.process).toBe('function');
      expect(typeof live.port.outbound.send).toBe('function');
      const decision = live.port.inbound.accept({
        botId: BOT,
        updateId: 7,
        senderId: OWNER,
        secretTokenHeader: mode === 'webhook' ? TOKEN : null,
        receivedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
        rawBody: BODY,
      });
      // Not a promise: a `then` would mean a caller could await something before acknowledging.
      expect(decision).not.toHaveProperty('then');
      expect(decision.outcome).toBe('enqueued');
    }
  });

  it('refuses to poll under webhook, where the provider delivers and the offset is not the ack', async () => {
    const harness = openHarness({ transport: transportOf({ mode: 'webhook' }) });
    const live = createLiveTelegramTransport(harness.ctx);
    await expect(live.pollOnce()).rejects.toMatchObject({ code: 'LIVE_POLL_NOT_APPLICABLE_IN_MODE' });
    // And the accepting case it differs from by one field: the same call under longPoll polls.
    const polling = createLiveTelegramTransport(openHarness().ctx);
    await expect(polling.pollOnce()).resolves.toMatchObject({ fetched: 1 });
  });

  it('refuses a non-positive poll timeout at construction — short polling is a busy loop', () => {
    for (const timeoutSeconds of [0, -1]) {
      expect(() =>
        createLiveTelegramTransport({ ...openHarness().ctx, poll: { ...POLL, timeoutSeconds } }),
      ).toThrow(LiveTransportError);
    }
    // The accepting case, one field different.
    expect(() => createLiveTelegramTransport({ ...openHarness().ctx, poll: { ...POLL, timeoutSeconds: 1 } })).not.toThrow();
  });

  it('refuses an unusable batch limit or retry budget at construction', () => {
    expect(() => createLiveTelegramTransport({ ...openHarness().ctx, poll: { ...POLL, limit: 0 } })).toThrow(
      LiveTransportError,
    );
    for (const send of [{ ...SEND, baseMs: 0 }, { ...SEND, maxMs: 0 }, { ...SEND, maxAttempts: 0 }]) {
      expect(() => createLiveTelegramTransport({ ...openHarness().ctx, send })).toThrow(LiveTransportError);
    }
  });
});

describe('the long-poll read: durable first, acknowledge second (R26.1, D2)', () => {
  it('enqueues each update and advances the offset past it, one at a time', async () => {
    const client = scriptedClient([[updateOf(11), updateOf(12)]]);
    const harness = openHarness({ client });
    const live = createLiveTelegramTransport(harness.ctx);

    expect(live.currentOffset()).toBe(0);
    const report = await live.pollOnce();

    expect(report.results.map((r) => [r.updateId, r.outcome, r.offsetAdvanced])).toEqual([
      [11, 'enqueued', true],
      [12, 'enqueued', true],
    ]);
    // The provider's convention: the next read asks from one past the last acknowledged update.
    expect(report.offsetAfter).toBe(13);
    expect(live.currentOffset()).toBe(13);
    expect(workQueueDepth({ handle: harness.accept.handle, now: harness.accept.now, newId: harness.accept.newId }).queued).toBe(2);
    // The offset the FETCH asked from is the stored one, not a number this module remembered.
    expect(client.fetches.map((f) => f.offset)).toEqual([0]);
    expect(client.fetches[0]?.timeoutSeconds).toBe(POLL.timeoutSeconds);
  });

  it('processes a batch in ascending update order however the provider ordered it', async () => {
    const client = scriptedClient([[updateOf(22), updateOf(20), updateOf(21)]]);
    const live = createLiveTelegramTransport(openHarness({ client }).ctx);
    const report = await live.pollOnce();
    expect(report.results.map((r) => r.updateId)).toEqual([20, 21, 22]);
    expect(report.offsetAfter).toBe(23);
  });

  it('advances past a REFUSED update, because a refusal has no work to lose', async () => {
    // An unlisted sender wedging the poller forever would be a denial of service any stranger
    // could cause: the same update would be re-read on every poll and nothing would ever progress.
    const client = scriptedClient([[updateOf(31, OUTSIDER), updateOf(32)]]);
    const harness = openHarness({ client });
    const live = createLiveTelegramTransport(harness.ctx);
    const report = await live.pollOnce();

    expect(report.results.map((r) => [r.updateId, r.outcome, r.offsetAdvanced])).toEqual([
      [31, 'refused', true],
      [32, 'enqueued', true],
    ]);
    expect(report.haltedOnDurability).toBe(false);
    // Refused means nothing was stored: one queued row, for the allowlisted sender only.
    const depth = workQueueDepth({ handle: harness.accept.handle, now: harness.accept.now, newId: harness.accept.newId });
    expect(depth.queued).toBe(1);
    // And the refusal was audited on the separate path, at the allowlist stage (§5.3).
    expect(harness.audit.map((line) => [line.updateId, line.stage])).toEqual([[31, 'allowlist']]);
  });

  it('halts the batch and leaves the offset where it was when the enqueue does NOT commit', async () => {
    // The durability failure, driven the way `negativeGuards.test.ts` drives it: the id source the
    // queue write needs is unavailable, so the transaction rolls back and nothing is stored.
    const client = scriptedClient([[updateOf(41), updateOf(42)]]);
    const harness = openHarness({
      client,
      newId: () => {
        throw new Error('NIZAM test: durable enqueue unavailable');
      },
    });
    const live = createLiveTelegramTransport(harness.ctx);
    const report = await live.pollOnce();

    expect(report.results.map((r) => [r.updateId, r.outcome, r.offsetAdvanced])).toEqual([[41, 'not-durable', false]]);
    expect(report.haltedOnDurability).toBe(true);
    // The whole of R26.1, asserted against the offset: it did not move, so the provider will serve
    // this update again. The second update was NOT reached, because advancing past 41 to reach 42
    // would have discarded 41 for good.
    expect(report.offsetAfter).toBe(report.offsetBefore);
    expect(live.currentOffset()).toBe(0);
    expect(harness.audit.map((line) => [line.updateId, line.stage])).toEqual([[41, 'enqueue']]);
  });

  it('does not advance the offset when the offset store itself refuses the commit', async () => {
    // A crash in the other half of the same window. The enqueue committed, the acknowledgement did
    // not, so the update is re-served and dedup absorbs it — one effect, not two.
    const client = scriptedClient([[updateOf(51)], [updateOf(51)]]);
    const harness = openHarness({ client, offsets: { read: () => 0, commit: () => undefined } });
    const live = createLiveTelegramTransport(harness.ctx);

    const first = await live.pollOnce();
    expect(first.results.map((r) => r.outcome)).toEqual(['enqueued']);
    expect(live.currentOffset()).toBe(0);

    const second = await live.pollOnce();
    expect(second.results.map((r) => r.outcome)).toEqual(['duplicate']);
    const depth = workQueueDepth({ handle: harness.accept.handle, now: harness.accept.now, newId: harness.accept.newId });
    expect(depth.queued).toBe(1);
  });
});

describe('the in-memory offset store is monotonic', () => {
  it('never moves backwards, because that would re-open a window dedup has closed', () => {
    const offsets = createInMemoryOffsetStore(5);
    expect(offsets.read()).toBe(5);
    offsets.commit(4);
    expect(offsets.read()).toBe(5);
    offsets.commit(6);
    expect(offsets.read()).toBe(6);
  });
});

describe('the outbound path honours the provider limits with bounded backoff (§5.5.5, Limit 4)', () => {
  it('waits the ADVERTISED interval when it exceeds the backoff, then succeeds', async () => {
    const client = scriptedClient([[]], [new TelegramRateLimitRefusal(30), 'ok']);
    const harness = openHarness({ client });
    const live = createLiveTelegramTransport(harness.ctx);

    const receipt = await live.port.outbound.send({ botId: BOT, chatRef: 'chat-1', text: 'x' });
    expect(receipt.messageRef).toBe('sent:2');
    // 30 advertised seconds beat the 500ms first backoff: honoured, not estimated.
    expect(harness.waits).toEqual([30_000]);
  });

  it('falls back to its own bounded backoff when no interval is advertised', async () => {
    const client = scriptedClient([[]], [new TelegramRateLimitRefusal(null), new TelegramRateLimitRefusal(null), 'ok']);
    const harness = openHarness({ client });
    const live = createLiveTelegramTransport(harness.ctx);

    await live.port.outbound.send({ botId: BOT, chatRef: 'chat-1', text: 'x' });
    // A missing interval is never read as "retry immediately": the doubling schedule is the floor.
    expect(harness.waits).toEqual([SEND.baseMs, SEND.baseMs * 2]);
    expect(harness.waits.every((ms) => ms > 0)).toBe(true);
  });

  it('exhausts a BOUNDED budget rather than looping, and never as a transport failure', async () => {
    const refusals = [new TelegramRateLimitRefusal(1), new TelegramRateLimitRefusal(1), new TelegramRateLimitRefusal(1)];
    const client = scriptedClient([[]], refusals);
    const harness = openHarness({ client });
    const live = createLiveTelegramTransport(harness.ctx);

    await expect(live.port.outbound.send({ botId: BOT, chatRef: 'chat-1', text: 'x' })).rejects.toMatchObject({
      code: 'LIVE_SEND_RETRY_BUDGET_EXHAUSTED',
    });
    // Exactly maxAttempts calls, and one fewer wait than attempts: no wait after the last refusal.
    expect(client.sends).toHaveLength(SEND.maxAttempts);
    expect(harness.waits).toHaveLength(SEND.maxAttempts - 1);
  });

  it('re-raises a refusal that is NOT the rate limit, rather than retrying something it cannot read', async () => {
    const client = scriptedClient([[]], [new Error('NIZAM test: provider refused for another reason')]);
    const harness = openHarness({ client });
    const live = createLiveTelegramTransport(harness.ctx);
    await expect(live.port.outbound.send({ botId: BOT, chatRef: 'chat-1', text: 'x' })).rejects.toThrow(
      /another reason/,
    );
    expect(client.sends).toHaveLength(1);
    expect(harness.waits).toEqual([]);
  });

  it('computes the schedule as a pure function, so it is read rather than waited for', () => {
    expect(sendBackoffMs(SEND, 1)).toBe(500);
    expect(sendBackoffMs(SEND, 2)).toBe(1_000);
    expect(sendBackoffMs(SEND, 5)).toBe(8_000);
    expect(sendBackoffMs(SEND, 50)).toBe(SEND.maxMs);
    // The wait is the longer of the two, in both directions.
    expect(sendRetryDelayMs(SEND, 1, 30)).toBe(30_000);
    expect(sendRetryDelayMs(SEND, 4, 1)).toBe(4_000);
    expect(sendRetryDelayMs(SEND, 1, null)).toBe(500);
    expect(sendRetryDelayMs(SEND, 1, 0)).toBe(500);
  });

  it('recognises the rate-limit refusal by shape, so a client need not import the class', () => {
    expect(isRateLimitRefusal(new TelegramRateLimitRefusal(5))).toBe(true);
    expect(isRateLimitRefusal({ name: 'TelegramRateLimitRefusal', retryAfterSeconds: null })).toBe(true);
    expect(isRateLimitRefusal(new Error('other'))).toBe(false);
    expect(isRateLimitRefusal(null)).toBe(false);
    expect(isRateLimitRefusal({ name: 'TelegramRateLimitRefusal', retryAfterSeconds: 'soon' })).toBe(false);
  });
});

describe('the adapter reaches no network and holds no particular (R24, steering §2)', () => {
  it('names no endpoint and resolves no network module', () => {
    // The whole outside world is one injected interface, so this assertion is about the source of
    // the module rather than about a runtime probe.
    const source = readFileSync('src/server/telegram/liveTransport.ts', 'utf8');
    for (const forbidden of ['node:http', 'node:https', 'fetch(', 'XMLHttpRequest', 'setWebhook']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('forwards every audit line the caller was owed, and adds none of its own', async () => {
    const client = scriptedClient([[updateOf(61, OUTSIDER)]]);
    const harness = openHarness({ client });
    const live = createLiveTelegramTransport(harness.ctx);
    await live.pollOnce();
    // Interposing on the sink must not swallow a line: exactly the one refusal, carrying no token
    // value and no body (§5.2, §5.3).
    expect(harness.audit).toHaveLength(1);
    expect(harness.audit[0]?.tokenHeaderPresent).toBe(false);
    expect(JSON.stringify(harness.audit)).not.toContain(TOKEN);
    expect(JSON.stringify(harness.audit)).not.toContain(BODY);
  });
});
