// @vitest-environment node
/**
 * Single-window offline operator flow tests.
 * Owning authority: PFOS Contract 14; Contracts 06, 12, and 13; money rules.
 * Phase 14 — offline single-window composition; Stage 5
 * Synthetic-only: one bot namespace, one allowlisted operator, injected PFOS and journal ports.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFinanceStore } from '../db/store.ts';
import { createRedactedLogger } from '../ops/redactedLogger.ts';
import type { StoreHandle } from '../db/connection.ts';
import type { TelegramDelivery } from '../ports/telegram.ts';
import { createOperatorMessagePort, type OperatorMessagePortContext } from '../telegram/operatorMessagePort.ts';
import { createSingleWindowFlow, SingleWindowFlowError, type SingleWindowJournalRecord } from './singleWindowFlow.ts';
import type { FinancialAnalysisResult } from '../hermes/toolBoundary.ts';

const BOT = 'synthetic-nizam-ingress';
const OWNER = 'synthetic-owner';
const OUTSIDER = 'synthetic-outsider';
const TOKEN = 'synthetic-token';
const cleanup: Array<() => void> = [];

const PFOS_RESULT: FinancialAnalysisResult = {
  resultRef: 'pfos-result-synthetic',
  facts: [
    {
      factRef: 'pfos-fact-synthetic',
      label: 'safe-to-spend',
      amountMilliunits: 1000,
      currency: 'EGP',
      computedAt: '2026-08-24T12:00:00Z',
      deterministicEngine: true,
    },
  ],
  explanation: 'Synthetic deterministic snapshot.',
  deterministicEngine: true,
};

function openHarness(): {
  handle: StoreHandle;
  flow: ReturnType<typeof createSingleWindowFlow>;
  replies: string[];
  journal: SingleWindowJournalRecord[];
  pfosQueries: string[];
} {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-single-window-'));
  let tick = 0;
  const now = (): string => new Date(Date.UTC(2026, 7, 24, 0, tick++, 0)).toISOString();
  const { handle } = openFinanceStore(
    { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
    now,
  );
  const logger = createRedactedLogger('finance', () => undefined, now);
  const operatorContext: OperatorMessagePortContext = {
    transport: {
      botId: BOT,
      expectedSecretToken: TOKEN,
      allowedSenderIds: [OWNER],
      apiBaseUrlRef: '<SYNTHETIC_PROVIDER_REF>',
      mode: 'webhook',
      maxConcurrentWorkItems: 1,
    },
    handle,
    now,
    newId: (() => {
      let id = 0;
      return (): string => `queued-${++id}`;
    })(),
    logger,
  };
  const replies: string[] = [];
  const journal: SingleWindowJournalRecord[] = [];
  const pfosQueries: string[] = [];
  const flow = createSingleWindowFlow({
    operator: createOperatorMessagePort(operatorContext),
    ownerSenderId: OWNER,
    journal: {
      append(text, sourceRef, recordedAt) {
        const record = { entryRef: `journal-${journal.length + 1}`, sourceRef, recordedAt };
        expect(text.length).toBeGreaterThan(0);
        journal.push(record);
        return record;
      },
    },
    pfos: {
      readFinancialSnapshot(queryRef) {
        pfosQueries.push(`read:${queryRef}`);
        return PFOS_RESULT;
      },
      runDeterministicAnalysis(queryRef) {
        pfosQueries.push(`analyze:${queryRef}`);
        return PFOS_RESULT;
      },
    },
    sendReply: async (_queuedRef, text) => {
      replies.push(text);
    },
    now,
    retryNotBefore: () => '2026-08-24T00:30:00.000Z',
  });
  cleanup.push(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { handle, flow, replies, journal, pfosQueries };
}

function delivery(overrides: Partial<TelegramDelivery> = {}): TelegramDelivery {
  return {
    botId: BOT,
    updateId: 11,
    senderId: OWNER,
    secretTokenHeader: TOKEN,
    receivedAt: '2026-08-24T00:00:00.000Z',
    rawBody: JSON.stringify({ text: 'what is my balance' }),
    ...overrides,
  };
}

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

describe('single-window owner-only flow', () => {
  it('refuses an empty owner allowlist before any delivery is accepted', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nizam-single-window-empty-'));
    const now = (): string => '2026-08-24T00:00:00.000Z';
    const { handle } = openFinanceStore(
      { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
      now,
    );
    cleanup.push(() => {
      handle.close();
      rmSync(dataDir, { recursive: true, force: true });
    });
    const operator = createOperatorMessagePort({
      transport: {
        botId: BOT,
        expectedSecretToken: TOKEN,
        allowedSenderIds: [],
        apiBaseUrlRef: '<SYNTHETIC_PROVIDER_REF>',
        mode: 'webhook',
        maxConcurrentWorkItems: 1,
      },
      handle,
      now,
      newId: () => 'queued-empty',
      logger: createRedactedLogger('finance', () => undefined, now),
    });
    expect(() =>
      createSingleWindowFlow({
        operator,
        ownerSenderId: '',
        journal: { append: () => ({ entryRef: 'x', sourceRef: 'x', recordedAt: now() }) },
        pfos: {
          readFinancialSnapshot: () => PFOS_RESULT,
          runDeterministicAnalysis: () => PFOS_RESULT,
        },
        sendReply: async () => undefined,
        now,
        retryNotBefore: () => '2026-08-24T00:30:00.000Z',
      }),
    ).toThrow(SingleWindowFlowError);
  });

  it('routes an owner finance question to PFOS milliunits and never echoes identities', async () => {
    const h = openHarness();
    expect(h.flow.accept(delivery())).toEqual({ outcome: 'enqueued', queuedRef: 'queued-1' });
    const result = await h.flow.runOnce();
    expect(result.status).toBe('replied');
    expect(result.route?.module).toBe('mal');
    expect(h.pfosQueries).toEqual(['read:queued-1']);
    expect(h.replies[0]).toContain('safe-to-spend=1000 milliunits');
    expect(h.replies[0]).toContain('pfos-result-synthetic');
    expect(h.replies.join('\n')).not.toContain(TOKEN);
    expect(h.replies.join('\n')).not.toContain(OWNER);
    expect(h.replies.join('\n')).not.toContain(BOT);
  });

  it('creates a local journal record for owner capture text', async () => {
    const h = openHarness();
    h.flow.accept(delivery({ rawBody: 'capture this journal dump', updateId: 12 }));
    const result = await h.flow.runOnce();
    expect(result.status).toBe('replied');
    expect(result.route?.tool).toBe('nizamcore.append_journal_entry');
    expect(h.journal).toHaveLength(1);
    expect(h.pfosQueries).toEqual([]);
    expect(h.replies[0]).toContain('Captured locally as journal-1');
  });

  it('refuses a secret-seeking owner message with zero PFOS or journal effect', async () => {
    const h = openHarness();
    h.flow.accept(delivery({ rawBody: 'what is the OpenRouter api key', updateId: 13 }));
    const result = await h.flow.runOnce();
    expect(result.status).toBe('blocked');
    expect(result.route?.code).toBe('REFUSED_SECRET');
    expect(h.journal).toHaveLength(0);
    expect(h.pfosQueries).toHaveLength(0);
    expect(h.replies[0]).toMatch(/refused/i);
  });

  it('rejects a second-bot or outsider delivery before the router runs', async () => {
    const h = openHarness();
    expect(h.flow.accept(delivery({ botId: 'other-bot', updateId: 14 })).outcome).toBe('rejected');
    expect(h.flow.accept(delivery({ senderId: OUTSIDER, updateId: 15 })).outcome).toBe('rejected');
    expect(await h.flow.runOnce()).toEqual({ status: 'idle', route: null });
    expect(h.replies).toHaveLength(0);
    expect(h.journal).toHaveLength(0);
    expect(h.pfosQueries).toHaveLength(0);
  });

  it('asks for clarification instead of guessing a money figure', async () => {
    const h = openHarness();
    h.flow.accept(delivery({ rawBody: 'help', updateId: 16 }));
    const result = await h.flow.runOnce();
    expect(result.status).toBe('clarified');
    expect(result.route?.effect).toBe('none');
    expect(h.pfosQueries).toHaveLength(0);
  });
});
