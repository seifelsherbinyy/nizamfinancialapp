// @vitest-environment node
/**
 * NIZAM · UPOI task 5.4 bounded property tests for operator and signal boundaries
 * Owning contract: PFOS Contract 12 — Two-Agent VPS Deployment & Operations
 * Phase: Phase 5.4 — UPOI task 5.4 (unified-personal-operating-intelligence)
 * Owning requirements: 1.2, 1.3, 1.4, 2.2; design §§6.4, 8.1, 9.1, 20
 *
 * Synthetic-only, offline tests against the real local SQLite queue and signal store. The small
 * deterministic generators below replace an uninstalled property library: each property runs
 * bounded varied cases, without adding a dependency or using a mock provider/network/secret.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFinanceStore } from '../db/store.ts';
import type { StoreHandle } from '../db/connection.ts';
import { createRedactedLogger } from '../ops/redactedLogger.ts';
import type { TelegramDelivery, TelegramTransportConfig } from '../ports/telegram.ts';
import {
  createOperatorMessagePort,
  type OperatorMessagePort,
  type OperatorMessagePortContext,
} from '../telegram/operatorMessagePort.ts';
import { createOfflineReadOnlyFlow, type OfflineReadOnlyTurn } from './offlineReadOnlyFlow.ts';
import { appendSignalWithReceipt } from '../signals/signalAdapter.ts';
import { SignalValidationError, type SignalValidationReason } from '../signals/envelopeValidation.ts';
import {
  openSignalStore,
  readAudit,
  readSignals,
  storedSignalCount,
  type SignalStoreContext,
} from '../signals/signalStore.ts';
import { SIGNAL_STORE_FILE_NAME } from '../signals/signalStoreSchema.ts';

const TOKEN = 'synthetic-token';
const SENDER = 'synthetic-operator';
const cleanup: Array<() => void> = [];

/** A deterministic bounded generator: reproducible cases are easier to diagnose than randomness. */
function* generatedSequences(seed: number, count: number): Generator<readonly number[]> {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state;
  };
  for (let caseNumber = 0; caseNumber < count; caseNumber += 1) {
    const length = 1 + (next() % 12);
    const values: number[] = [];
    for (let index = 0; index < length; index += 1) values.push(1 + (next() % 7));
    yield values;
  }
}

function stepClock(): () => string {
  let tick = 0;
  return (): string => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
}

function ids(prefix: string): () => string {
  let number = 0;
  return (): string => `${prefix}-${String(++number).padStart(4, '0')}`;
}

function transport(botId: string): TelegramTransportConfig {
  return {
    botId,
    expectedSecretToken: TOKEN,
    allowedSenderIds: [SENDER],
    apiBaseUrlRef: '<SYNTHETIC_PROVIDER_REF>',
    mode: 'webhook',
    maxConcurrentWorkItems: 1,
  };
}

interface QueueHarness {
  readonly handle: StoreHandle;
  readonly now: () => string;
  readonly port: OperatorMessagePort;
}

function openQueueHarness(botId = 'profile-synthetic-a'): QueueHarness {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-upoi-property-queue-'));
  const now = stepClock();
  const { handle } = openFinanceStore(
    { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
    now,
  );
  const logger = createRedactedLogger('finance', () => undefined, now);
  const context: OperatorMessagePortContext = {
    transport: transport(botId),
    handle,
    now,
    newId: ids(botId),
    logger,
  };
  const port = createOperatorMessagePort(context);
  cleanup.push(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { handle, now, port };
}

function delivery(botId: string, updateId: number): TelegramDelivery {
  return {
    botId,
    updateId,
    senderId: SENDER,
    secretTokenHeader: TOKEN,
    receivedAt: '2026-01-01T00:00:00.000Z',
    rawBody: `{"synthetic":"turn-${botId}-${updateId}"}`,
  };
}

function offlineFlow(port: OperatorMessagePort, replies: string[]) {
  const turn: OfflineReadOnlyTurn = {
    intent: 'read_financial_snapshot',
    requestedAction: 'read',
    targetAuthority: 'deterministic_domain',
    scope: ['finance/read/synthetic'],
    idempotencyKey: 'idempotency-synthetic',
    queryRef: 'query-synthetic',
    queryFilters: { scope: 'synthetic' },
    replyTarget: { chatRef: 'chat-synthetic' },
  };
  return createOfflineReadOnlyFlow({
    operator: port,
    decodeTurn: () => turn,
    governance: {
      plan: () => ({
        status: 'planned' as const,
        plan: {
          planRef: 'plan-synthetic',
          targetAuthority: 'deterministic_domain' as const,
          risk: 'READ_ONLY' as const,
          governanceTrace: { contractRefs: ['contract:synthetic'], requirementRefs: ['requirement:1.3'] },
        },
      }),
      authorize: (plan) => ({ status: 'accepted' as const, plan }),
    },
    pfos: {
      readFinancialSnapshot: () => ({
        versionRef: 'pfos-version-synthetic',
        sourceVersion: 'pfos-source-synthetic',
        observedAt: '2026-01-01T00:00:00.000Z',
        values: { synthetic: 1_000 },
      }),
    },
    sendReply: async (reply) => {
      replies.push(reply.text);
    },
    retryNotBefore: () => '2026-01-02T00:00:00.000Z',
  });
}

async function drainUntilIdle(flow: ReturnType<typeof createOfflineReadOnlyFlow>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await flow.runOnce();
    if (result.status === 'idle') return;
  }
  throw new Error('synthetic property schedule did not become idle');
}

interface SignalHarness {
  readonly ctx: SignalStoreContext;
  readonly handle: StoreHandle;
  readonly dataDir: string;
}

function openSignalHarness(): SignalHarness {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-upoi-property-signal-'));
  const now = stepClock();
  let auditNumber = 0;
  const { handle } = openSignalStore({ dataDir, fileName: SIGNAL_STORE_FILE_NAME, busyTimeoutMs: 5_000 }, now);
  const ctx: SignalStoreContext = {
    handle,
    now,
    newAuditId: () => `audit-synthetic-${String(++auditNumber).padStart(4, '0')}`,
  };
  cleanup.push(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { ctx, handle, dataDir };
}

const VALID_SIGNAL = {
  signalId: 'signal-synthetic',
  ts: '2026-01-01T00:00:00Z',
  producer: 'finance',
  kind: 'money_pressure',
  tier: 'money_safe',
  consentScope: 'shared',
  payload: { level: 'amber', direction: 'hold' },
} as const;

function signalCandidate(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...VALID_SIGNAL, payload: { ...VALID_SIGNAL.payload }, ...patch };
}

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

describe('UPOI task 5.4 properties: duplicate delivery sequences', () => {
  it('keeps one durable canonical effect per key and acknowledges only durable rows', async () => {
    for (const sequence of generatedSequences(0x5_4_01, 24)) {
      const h = openQueueHarness();
      const replies: string[] = [];
      const flow = offlineFlow(h.port, replies);
      const unique = new Set<number>();

      for (const updateId of sequence) {
        const decision = h.port.accept(delivery('profile-synthetic-a', updateId));
        const first = unique.has(updateId) === false;
        if (first) {
          unique.add(updateId);
          expect(decision.outcome).toBe('enqueued');
          const queuedRef = (decision as { queuedRef: string }).queuedRef;
          // The acknowledgement returned only after this row is present and readable.
          expect(h.handle.db.prepare('SELECT state, raw_body FROM work_queue WHERE id = ?').get(queuedRef)).toEqual({
            state: 'queued',
            raw_body: `{"synthetic":"turn-profile-synthetic-a-${updateId}"}`,
          });
        } else {
          expect(decision).toEqual({ outcome: 'duplicate' });
        }
      }

      await drainUntilIdle(flow);
      expect(replies).toHaveLength(unique.size);
      expect(h.handle.db.prepare('SELECT COUNT(*) AS n FROM work_queue').get()).toEqual({ n: unique.size });
      expect(h.handle.db.prepare("SELECT COUNT(*) AS n FROM work_queue WHERE state = 'done'").get()).toEqual({ n: unique.size });

      // Replaying after canonical completion remains a successful no-op.
      for (const updateId of sequence) expect(h.port.accept(delivery('profile-synthetic-a', updateId))).toEqual({ outcome: 'duplicate' });
      expect(h.handle.db.prepare('SELECT COUNT(*) AS n FROM work_queue').get()).toEqual({ n: unique.size });
    }
  });
});

describe('UPOI task 5.4 properties: interruption and reclaim schedules', () => {
  it('reclaims interrupted work without creating another canonical queue row', () => {
    for (const schedule of generatedSequences(0x5_4_02, 24)) {
      const h = openQueueHarness();
      const botId = 'profile-synthetic-a';
      expect(h.port.accept(delivery(botId, 1)).outcome).toBe('enqueued');
      let running = h.port.queue.claim(1)[0];
      expect(running).toBeDefined();

      for (const action of schedule) {
        if (running === undefined) running = h.port.queue.claim(1)[0];
        if (running === undefined) break;
        if (action % 3 === 0) {
          // Simulate an interrupted worker: it leaves the durable row running.
          h.now();
          h.now();
          expect(h.port.queue.reclaimExpired(1)).toBe(1);
          running = h.port.queue.claim(1)[0];
        } else if (action % 3 === 1) {
          const due = new Date(Date.parse(h.now()) - 1).toISOString();
          expect(h.port.queue.settle(running.queuedRef, { outcome: 'retry', notBefore: due })).toMatchObject({
            settled: true,
            state: 'queued',
          });
          running = h.port.queue.claim(1)[0];
        } else {
          expect(h.port.queue.settle(running.queuedRef, { outcome: 'done' })).toMatchObject({ settled: true, state: 'done' });
          running = undefined;
          break;
        }
      }

      if (running !== undefined) h.port.queue.settle(running.queuedRef, { outcome: 'done' });
      const row = h.handle.db.prepare('SELECT state, COUNT(*) AS n FROM work_queue GROUP BY state').all();
      expect(row).toEqual([{ state: 'done', n: 1 }]);
      expect(h.port.accept(delivery(botId, 1))).toEqual({ outcome: 'duplicate' });
      expect(h.handle.db.prepare('SELECT COUNT(*) AS n FROM work_queue').get()).toEqual({ n: 1 });
    }
  });
});

describe('UPOI task 5.4 properties: profile isolation and same-key replay', () => {
  it('keeps identical update sequences independent for two profile namespaces', () => {
    for (const sequence of generatedSequences(0x5_4_03, 24)) {
      const h = openQueueHarness('profile-synthetic-a');
      const profileB = 'profile-synthetic-b';
      const portB = createOperatorMessagePort({
        transport: transport(profileB),
        handle: h.handle,
        now: h.now,
        newId: ids(profileB),
        logger: createRedactedLogger('finance', () => undefined, h.now),
      });
      const unique = new Set(sequence);

      for (const updateId of sequence) {
        const firstA = h.port.accept(delivery('profile-synthetic-a', updateId));
        const firstB = portB.accept(delivery(profileB, updateId));
        expect(firstA.outcome).toBe(unique.has(updateId) ? 'enqueued' : 'duplicate');
        expect(firstB.outcome).toBe(unique.has(updateId) ? 'enqueued' : 'duplicate');
        // Both profiles have now seen this key; subsequent iterations are duplicates in both.
        unique.delete(updateId);
      }

      const rows = h.handle.db.prepare('SELECT bot_id, update_id FROM work_queue ORDER BY bot_id, update_id').all() as Array<{
        bot_id: string;
        update_id: number;
      }>;
      expect(rows).toHaveLength(new Set(sequence).size * 2);
      expect(rows.filter((row) => row.bot_id === 'profile-synthetic-a')).toHaveLength(new Set(sequence).size);
      expect(rows.filter((row) => row.bot_id === profileB)).toHaveLength(new Set(sequence).size);
      expect(new Set(rows.map((row) => `${row.bot_id}:${row.update_id}`)).size).toBe(rows.length);

      const claimed = h.port.queue.claim(rows.length);
      expect(claimed).toHaveLength(rows.length);
      for (const item of claimed) {
        expect(['profile-synthetic-a', profileB]).toContain(item.botId);
        h.port.queue.settle(item.queuedRef, { outcome: 'done' });
      }
      expect(h.handle.db.prepare("SELECT COUNT(*) AS n FROM work_queue WHERE state = 'done'").get()).toEqual({ n: rows.length });
    }
  });

  it('replays one signal key without producing a second append-only canonical row', () => {
    for (const sequence of generatedSequences(0x5_4_04, 24)) {
      const h = openSignalHarness();
      appendSignalWithReceipt(h.ctx, signalCandidate());
      for (const [index] of sequence.entries()) {
        expect(() => appendSignalWithReceipt(h.ctx, signalCandidate({
          payload: { level: index % 2 === 0 ? 'red' : 'green', direction: 'hold' },
        }))).toThrowError(
          expect.objectContaining({ code: 'SIGNAL_ID_ALREADY_STORED' }),
        );
      }
      expect(storedSignalCount(h.ctx)).toBe(1);
      expect(readSignals(h.ctx, { limit: 10 })).toHaveLength(1);
      expect(readAudit(h.ctx).filter((line) => line.event === 'accepted')).toHaveLength(1);
      expect(readAudit(h.ctx).filter((line) => line.reason === 'signal_id_already_stored')).toHaveLength(sequence.length);
    }
  });
});

type ForbiddenCase = {
  readonly patch: Record<string, unknown>;
  readonly reason: SignalValidationReason;
  readonly marker: string;
};

function forbiddenCases(): readonly ForbiddenCase[] {
  const cases: ForbiddenCase[] = [];
  for (const [index, field] of ['balanceMilli', 'amountMilli', 'cents', 'numericValue'].entries()) {
    cases.push({
      patch: { payload: { level: 'amber', [field]: index + 1 } },
      reason: 'field_numeric',
      marker: `numeric-marker-${index}`,
    });
  }
  const namedCases: ReadonlyArray<readonly [string, string, SignalValidationReason]> = [
    ['dueOn', '2026-04-01', 'field_temporal'],
    ['accountRef', 'account-reference-synthetic', 'field_identifier'],
    ['journalExcerpt', 'journal-marker-synthetic', 'field_unrecognized'],
  ];
  for (const [index, [field, value, reason]] of namedCases.entries()) {
    cases.push({ patch: { [field]: value }, reason, marker: `${value}-${index}` });
  }
  return cases;
}

describe('UPOI task 5.4 properties: forbidden signal fields', () => {
  it('refuses generated numeric and sensitive state fields before signal persistence', () => {
    for (const [index, testCase] of forbiddenCases().entries()) {
      const h = openSignalHarness();
      const candidate = signalCandidate({ signalId: `signal-forbidden-${index}`, ...testCase.patch });
      expect(() => appendSignalWithReceipt(h.ctx, candidate)).toThrowError(SignalValidationError);
      expect(storedSignalCount(h.ctx)).toBe(0);
      expect(readSignals(h.ctx, { limit: 10 })).toEqual([]);
      const audit = readAudit(h.ctx);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.reason).toBe(testCase.reason);
      expect(JSON.stringify(audit)).not.toContain(testCase.marker);
      expect(Object.keys(audit[0] ?? {})).not.toContain('payload');
    }
  });
});
