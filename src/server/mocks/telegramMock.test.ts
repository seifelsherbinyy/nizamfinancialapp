// @vitest-environment node
/**
 * NIZAM · The Telegram mock drives every §5 gate — contract 12 §5 (R11, R12, R13, R14, R15)
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Depends on: ./telegramMock, ./invocationRecorder, ../ports/telegram
 *
 * Design's testing strategy is explicit: "a test that has only ever been observed passing is not
 * evidence. Each negative test must be shown failing the guarded operation, not merely returning a
 * value." So every refusal below is paired with the accepting case it differs from by one field,
 * and the queue is checked afterwards — a rejection that still enqueued work would pass a decision
 * assertion and fail the system.
 *
 * The deliveries come from the recorded fixture, so the shapes exercised here are the same ones a
 * fixture-backed replay would use rather than a second set invented for the test.
 */
import { describe, expect, it } from 'vitest';

import { createInvocationRecorder } from './invocationRecorder.ts';
import { createTelegramMock, type TelegramMockConfig } from './telegramMock.ts';
import { MockPortFailure } from './failure.ts';
import { inlineFixtureSource, loadRecordedInteractions, nodeFixtureSource } from './fixtures.ts';
import type { TelegramDelivery, TelegramTransportConfig } from '../ports/telegram.ts';

const FIXED_NOW = (): string => '2026-03-02T09:00:00Z';

const TRANSPORT: TelegramTransportConfig = {
  botId: 'bot-alpha',
  expectedSecretToken: 'fixture-token-alpha',
  allowedSenderIds: ['sender-one'],
  apiBaseUrlRef: 'TELEGRAM_API_BASE_REF',
  mode: 'webhook',
  maxConcurrentWorkItems: 2,
};

const GOOD: TelegramDelivery = {
  botId: 'bot-alpha',
  updateId: 4001,
  senderId: 'sender-one',
  secretTokenHeader: 'fixture-token-alpha',
  receivedAt: '2026-03-02T09:00:00Z',
  rawBody: 'a synthetic operator message',
};

function mockWith(overrides: Partial<TelegramMockConfig> = {}) {
  const recorder = createInvocationRecorder();
  return createTelegramMock({ transport: TRANSPORT, recorder, now: FIXED_NOW, ...overrides });
}

describe('accept is synchronous and enqueues durable work (§5.5, R15)', () => {
  it('acknowledges a well-formed delivery and stores it for the async side', () => {
    const mock = mockWith();
    const decision = mock.port.inbound.accept(GOOD);
    expect(decision).toEqual({ outcome: 'enqueued', queuedRef: 'queued:bot-alpha:4001' });
    expect(mock.queued).toEqual([
      {
        queuedRef: 'queued:bot-alpha:4001',
        botId: 'bot-alpha',
        updateId: 4001,
        senderId: 'sender-one',
        rawBody: 'a synthetic operator message',
        enqueuedAt: FIXED_NOW(),
        attempt: 1,
      },
    ]);
    expect(mock.rejections).toEqual([]);
  });

  it('records the call without recording the body (§6.4, R19)', () => {
    const mock = mockWith();
    mock.port.inbound.accept(GOOD);
    const call = mock.recorder.callsTo('telegram', 'accept')[0];
    expect(call?.detail).toEqual({
      botId: 'bot-alpha',
      updateId: 4001,
      senderId: 'sender-one',
      tokenHeaderPresent: true,
    });
    expect(JSON.stringify(call)).not.toContain('synthetic operator message');
  });
});

describe('the token gate (§5.2, R11)', () => {
  it('fails closed when the expected token is unconfigured, right token included', () => {
    const mock = mockWith({ transport: { ...TRANSPORT, expectedSecretToken: '' } });
    expect(mock.port.inbound.accept(GOOD)).toEqual({ outcome: 'rejected' });
    expect(mock.rejections).toEqual(['TELEGRAM_CONFIG_FAILS_CLOSED']);
    // The guarded operation did not happen: nothing was enqueued.
    expect(mock.queued).toEqual([]);
  });

  it('refuses an absent header and an empty one, which are different facts', () => {
    const absent = mockWith();
    expect(absent.port.inbound.accept({ ...GOOD, secretTokenHeader: null })).toEqual({ outcome: 'rejected' });
    const empty = mockWith();
    expect(empty.port.inbound.accept({ ...GOOD, secretTokenHeader: '' })).toEqual({ outcome: 'rejected' });
    expect(absent.queued).toEqual([]);
    expect(empty.queued).toEqual([]);
  });

  it('refuses a wrong token, including one that is a prefix of the right one', () => {
    const mock = mockWith();
    expect(mock.port.inbound.accept({ ...GOOD, secretTokenHeader: 'fixture-token-alph' })).toEqual({
      outcome: 'rejected',
    });
    expect(mock.port.inbound.accept({ ...GOOD, secretTokenHeader: 'fixture-token-alphaX' })).toEqual({
      outcome: 'rejected',
    });
    expect(mock.rejections).toEqual(['TELEGRAM_REQUEST_REJECTED', 'TELEGRAM_REQUEST_REJECTED']);
    expect(mock.queued).toEqual([]);
  });

  it('reveals nothing about which check failed, whatever the reason (§5.2)', () => {
    const badToken = mockWith().port.inbound.accept({ ...GOOD, secretTokenHeader: 'wrong' });
    const badSender = mockWith().port.inbound.accept({ ...GOOD, senderId: 'sender-unlisted' });
    expect(badToken).toEqual(badSender);
    expect(Object.keys(badToken)).toEqual(['outcome']);
  });
});

describe('the allowlist gate (§5.3, R12)', () => {
  it('refuses a sender outside the list before anything parses the body', () => {
    const mock = mockWith();
    expect(mock.port.inbound.accept({ ...GOOD, senderId: 'sender-unlisted' })).toEqual({ outcome: 'rejected' });
    expect(mock.queued).toEqual([]);
  });

  it('treats an empty allowlist as nobody, not everybody', () => {
    const mock = mockWith({ transport: { ...TRANSPORT, allowedSenderIds: [] } });
    expect(mock.port.inbound.accept(GOOD)).toEqual({ outcome: 'rejected' });
    expect(mock.rejections).toEqual(['TELEGRAM_REQUEST_REJECTED']);
  });
});

describe('de-duplication is keyed on the pair, never the identifier alone (§5.4, R13/R14)', () => {
  it('answers duplicate with no error, so the provider does not retry it again (§5.4.4)', () => {
    const mock = mockWith();
    expect(mock.port.inbound.accept(GOOD).outcome).toBe('enqueued');
    expect(mock.port.inbound.accept({ ...GOOD, receivedAt: '2026-03-02T09:00:04Z' })).toEqual({
      outcome: 'duplicate',
    });
    expect(mock.queued.length).toBe(1);
    expect(mock.rejections).toEqual([]);
  });

  it('R14 does NOT treat the same update number from a second bot as a duplicate', () => {
    const mock = mockWith({ transport: { ...TRANSPORT, allowedSenderIds: ['sender-one'] } });
    expect(mock.port.inbound.accept(GOOD).outcome).toBe('enqueued');
    const other = mock.port.inbound.accept({ ...GOOD, botId: 'bot-beta' });
    expect(other).toEqual({ outcome: 'enqueued', queuedRef: 'queued:bot-beta:4001' });
    expect(mock.queued.map((item) => item.botId)).toEqual(['bot-alpha', 'bot-beta']);
  });

  it('does not consume the dedup key when the enqueue fails (§5.5.2)', () => {
    const failing = mockWith({ enqueueFails: true });
    expect(failing.port.inbound.accept(GOOD)).toEqual({ outcome: 'rejected' });
    expect(failing.rejections).toEqual(['TELEGRAM_ENQUEUE_FAILED']);
    expect(failing.queued).toEqual([]);
    // A retry of the same update must be accepted, not swallowed as a duplicate of a
    // delivery that was never durably stored.
    const retried = failing.port.inbound.accept(GOOD);
    expect(retried).toEqual({ outcome: 'rejected' });
    expect(failing.rejections).toEqual(['TELEGRAM_ENQUEUE_FAILED', 'TELEGRAM_ENQUEUE_FAILED']);
  });
});

describe('the async side owns the slow work and its own retry (§5.5.4)', () => {
  const item = {
    queuedRef: 'queued:bot-alpha:4001',
    botId: 'bot-alpha',
    updateId: 4001,
    senderId: 'sender-one',
    rawBody: 'a synthetic operator message',
    enqueuedAt: FIXED_NOW(),
    attempt: 1,
  };

  it('reports done by default', async () => {
    const mock = mockWith();
    await expect(mock.port.worker.process(item)).resolves.toEqual({ outcome: 'done' });
    expect(mock.processed.length).toBe(1);
  });

  it('reports a queue-level retry rather than a transport failure', async () => {
    const mock = mockWith({ workOutcome: { outcome: 'retry', notBefore: '2026-03-02T09:05:00Z' } });
    await expect(mock.port.worker.process(item)).resolves.toEqual({
      outcome: 'retry',
      notBefore: '2026-03-02T09:05:00Z',
    });
  });

  it('reports abandonment with a typed code', async () => {
    const mock = mockWith({ workOutcome: { outcome: 'abandoned', code: 'MODEL_PROVIDER_UNAVAILABLE' } });
    await expect(mock.port.worker.process(item)).resolves.toEqual({
      outcome: 'abandoned',
      code: 'MODEL_PROVIDER_UNAVAILABLE',
    });
  });
});

describe('the outbound side is separate and can refuse', () => {
  it('answers with a deterministic receipt from the injected clock', async () => {
    const mock = mockWith();
    const receipt = await mock.port.outbound.send({ botId: 'bot-alpha', chatRef: 'chat-one', text: 'ok' });
    expect(receipt).toEqual({ messageRef: 'sent:bot-alpha:1', sentAt: FIXED_NOW() });
  });

  it('rejects with a typed failure when the send is refused, and records the attempt', async () => {
    const mock = mockWith({ sendRefused: true });
    await expect(
      mock.port.outbound.send({ botId: 'bot-alpha', chatRef: 'chat-one', text: 'ok' }),
    ).rejects.toBeInstanceOf(MockPortFailure);
    const call = mock.recorder.callsTo('telegram', 'send')[0];
    expect(call?.detail).toEqual({ botId: 'bot-alpha', chatRef: 'chat-one', textLength: 2 });
  });
});

describe('the recorded fixture drives the same gates (steering §3)', () => {
  it('replays the fixture delivery set to the decisions §5 requires', () => {
    const loaded = loadRecordedInteractions(nodeFixtureSource(), 'two-agent-smoke');
    const mock = mockWith();
    const outcomes = loaded.set.telegramDeliveries.map((delivery) => mock.port.inbound.accept(delivery).outcome);
    expect(outcomes).toEqual(['enqueued', 'duplicate', 'enqueued', 'rejected', 'rejected', 'rejected']);
    // Two accepted deliveries, and the second is the cross-bot collision R14 protects.
    expect(mock.queued.map((q) => q.botId)).toEqual(['bot-alpha', 'bot-beta']);
    expect(mock.rejections).toEqual([
      'TELEGRAM_REQUEST_REJECTED',
      'TELEGRAM_REQUEST_REJECTED',
      'TELEGRAM_REQUEST_REJECTED',
    ]);
  });

  it('replays identically from an in-memory source, so nothing depends on the filesystem', () => {
    const onDisk = loadRecordedInteractions(nodeFixtureSource(), 'two-agent-smoke');
    const inline = loadRecordedInteractions(
      inlineFixtureSource({ copy: JSON.stringify(onDisk.set) }),
      'copy',
    );
    expect(inline.set).toEqual(onDisk.set);
  });
});
