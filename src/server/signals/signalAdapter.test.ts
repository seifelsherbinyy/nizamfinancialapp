// @vitest-environment node
/**
 * NIZAM · Closed signal adapter receipts and boundary tests
 * Owning contract: PFOS Contract 12 — Two-Agent VPS Deployment & Operations; UPOI task 5.2
 * Phase: Phase 5.2 closed signal adapter tests
 * Owning requirements: 1.2, 1.4, 2.2
 * Depends on: ./signalAdapter, ./signalStore, ./signalStoreSchema, ./consentGate
 *
 * Synthetic-only tests for the task-5.2 composition seam. The adapter must return a
 * schema-versioned receipt without replaying validation, consent, hashing, or persistence logic.
 *
 * Every negative case exercises the real validator/store and verifies that no forbidden candidate
 * becomes a stored signal. Store-boundary tests use temporary local directories only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SignalDraft } from '../ports/signalBus.ts';
import {
  appendSignalDraftWithReceipt,
  appendSignalWithReceipt,
  SIGNAL_RECEIPT_SCHEMA_ID,
  SIGNAL_RECEIPT_SCHEMA_VERSION,
  SIGNAL_STORE_SCHEMA_VERSION,
} from './signalAdapter.ts';
import { gateSignals, NARROW_TIERS_READABLE_BY_BOTH, type ConsentPolicy } from './consentGate.ts';
import { SignalValidationError } from './envelopeValidation.ts';
import {
  openSignalStore,
  readAudit,
  readSignals,
  storedSignalCount,
  SignalStoreError,
  type SignalStoreContext,
} from './signalStore.ts';
import {
  SIGNAL_ENVELOPE_SCHEMA_ID,
  SIGNAL_ENVELOPE_SCHEMA_VERSION,
} from './envelopeSchema.ts';
import { SIGNAL_STORE_FILE_NAME, SIGNAL_STORE_NAME } from './signalStoreSchema.ts';

interface Fixture {
  readonly ctx: SignalStoreContext;
  readonly dataDir: string;
  close(): void;
}

function openFixture(): Fixture {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-signal-adapter-'));
  let tick = 0;
  let auditNumber = 0;
  const now = (): string => {
    tick += 1;
    return `2026-03-02T09:0${tick} :00Z`.replace(' ', '');
  };
  const newAuditId = (): string => {
    auditNumber += 1;
    return `adapter-aud-${auditNumber}`;
  };
  const { handle } = openSignalStore(
    { dataDir, fileName: SIGNAL_STORE_FILE_NAME, busyTimeoutMs: 5_000 },
    now,
  );
  return {
    ctx: { handle, now, newAuditId },
    dataDir,
    close(): void {
      handle.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const VALID_DRAFT: SignalDraft = {
  signalId: 'sig-adapter-one',
  ts: '2026-03-02T09:05:00Z',
  producer: 'finance',
  kind: 'money_pressure',
  tier: 'money_safe',
  consentScope: 'shared',
  payload: { level: 'amber', direction: 'hold' },
};

function candidate(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...VALID_DRAFT, payload: { ...VALID_DRAFT.payload }, ...patch };
}

let fixture: Fixture;
beforeEach(() => {
  fixture = openFixture();
});

afterEach(() => {
  fixture.close();
});

describe('the adapter returns a closed schema-versioned append receipt', () => {
  it('returns references and stored state without returning payload content', () => {
    const receipt = appendSignalDraftWithReceipt(fixture.ctx, VALID_DRAFT);

    expect(receipt).toEqual({
      receiptSchemaId: SIGNAL_RECEIPT_SCHEMA_ID,
      receiptSchemaVersion: SIGNAL_RECEIPT_SCHEMA_VERSION,
      envelopeSchemaId: SIGNAL_ENVELOPE_SCHEMA_ID,
      envelopeSchemaVersion: SIGNAL_ENVELOPE_SCHEMA_VERSION,
      storeSchemaVersion: SIGNAL_STORE_SCHEMA_VERSION,
      storeName: SIGNAL_STORE_NAME,
      storeFileName: SIGNAL_STORE_FILE_NAME,
      outcome: 'stored',
      signalId: VALID_DRAFT.signalId,
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      storedAt: expect.stringMatching(/^2026-03-02T09:\d{2}:00Z$/),
    });
    expect(Object.keys(receipt).sort()).toEqual([
      'envelopeSchemaId',
      'envelopeSchemaVersion',
      'hash',
      'outcome',
      'receiptSchemaId',
      'receiptSchemaVersion',
      'signalId',
      'storeFileName',
      'storeName',
      'storeSchemaVersion',
      'storedAt',
    ].sort());
    const serialized = JSON.stringify(receipt);
    for (const forbidden of ['payload', 'balance', 'due', 'account', 'journal', 'text']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
    expect(storedSignalCount(fixture.ctx)).toBe(1);
  });

  it('evaluates consent at read time for the stored envelope rather than in the receipt adapter', () => {
    appendSignalWithReceipt(fixture.ctx, candidate());
    const row = readSignals(fixture.ctx, { limit: 1 });
    const policy: ConsentPolicy = {
      readableTiers: NARROW_TIERS_READABLE_BY_BOTH,
      widenedKinds: [{ kind: 'money_pressure', widenedTo: 'shared', authorizedBy: 'owner' }],
    };
    const outcome = gateSignals(row, { subscriber: 'life', limit: 1 }, policy);
    expect(outcome.outcome).toBe('delivered');
  });
});

describe('the adapter keeps the closed validator and deduplication as the single write path', () => {
  it.each([
    ['balance-like numeric state', { payload: { level: 'amber', balanceMilli: 1_000 } }],
    ['due-date field', { payload: { level: 'amber', dueOn: '2026-04-01' } }],
    ['account identifier', { payload: { level: 'amber', accountRef: 'acct-synthetic' } }],
    ['journal text', { journalExcerpt: 'synthetic journal paragraph' }],
    ['unrestricted text field', { payload: { level: 'amber', mood: 'unsettled' } }],
    ['over-cap note', { payload: { level: 'amber', note: 'x'.repeat(121) } }],
    ['digit-bearing note', { payload: { level: 'amber', note: 'steady after 2 steps' } }],
  ] as const)('refuses %s without storing a row', (_label, patch) => {
    expect(() => appendSignalWithReceipt(fixture.ctx, candidate(patch))).toThrow(SignalValidationError);
    expect(storedSignalCount(fixture.ctx)).toBe(0);
    expect(readAudit(fixture.ctx)).toHaveLength(1);
  });

  it('refuses a repeated signal id and does not create a second row', () => {
    const first = appendSignalWithReceipt(fixture.ctx, VALID_DRAFT);
    expect(() => appendSignalWithReceipt(fixture.ctx, { ...VALID_DRAFT, payload: { level: 'red' } })).toThrow(
      SignalStoreError,
    );
    expect(storedSignalCount(fixture.ctx)).toBe(1);
    expect(readAudit(fixture.ctx).map((line) => line.event)).toEqual(['accepted', 'refused_on_write']);
    expect(first.signalId).toBe('sig-adapter-one');
  });
});

describe('the signal adapter preserves engine append-only and store isolation boundaries', () => {
  it('keeps UPDATE and DELETE refused by the database triggers', () => {
    appendSignalWithReceipt(fixture.ctx, VALID_DRAFT);
    expect(() => fixture.ctx.handle.db.prepare("UPDATE signals SET level = 'red'").run()).toThrow(/append-only/);
    expect(() => fixture.ctx.handle.db.prepare('DELETE FROM signals').run()).toThrow(/append-only/);
    expect(storedSignalCount(fixture.ctx)).toBe(1);
  });

  it.each(['life.db', 'finance.db'] as const)('refuses to open another store boundary: %s', (fileName) => {
    expect(() =>
      openSignalStore({ dataDir: fixture.dataDir, fileName, busyTimeoutMs: 5_000 }),
    ).toThrowError(
      expect.objectContaining({
        name: 'SignalStoreError',
        code: 'SIGNAL_STORE_FILE_NOT_ALLOWED',
      }),
    );
  });

  it('opens only one main database and has no attached cross-database store', () => {
    const databases = fixture.ctx.handle.db
      .prepare('PRAGMA database_list')
      .all()
      .map((row) => (row as Record<string, unknown>).name);
    expect(databases).toEqual(['main']);
  });
});
