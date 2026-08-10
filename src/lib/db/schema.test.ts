// @vitest-environment node
/**
 * NIZAM · schema tests
 * Implemented by: KIRO Contract 2 / Phase 2.2
 */
import { describe, it, expect } from 'vitest';
import { createEmptyDb, validateDb } from './schema.ts';

describe('nizam_db schema', () => {
  it('empty db validates', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    expect(() => validateDb(db)).not.toThrow();
    expect(db.meta.currency).toBe('EGP');
    expect(db.meta.moneyBase).toBe('milliunits');
  });

  it('round-trips through JSON', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    db.accounts.push({
      id: 'acc_1',
      name: 'CIB Current',
      type: 'CIB_DEBIT',
      onBudget: true,
      balance: 123_456,
      clearedBalance: 123_456,
      accountIdentifier: '1234',
      creditLimit: null,
      closed: false,
      order: 0,
      paymentCategoryId: null,
    });
    const parsed = validateDb(JSON.parse(JSON.stringify(db)));
    expect(parsed).toEqual(db);
  });

  it('rejects float money (milliunits must be integers)', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    const bad = JSON.parse(JSON.stringify(db)) as Record<string, unknown>;
    (bad.accounts as unknown[]).push({
      id: 'acc_bad',
      name: 'Bad',
      type: 'CASH',
      onBudget: true,
      balance: 10.5, // float — must fail
      clearedBalance: 0,
      accountIdentifier: null,
      creditLimit: null,
      closed: false,
      order: 1,
      paymentCategoryId: null,
    });
    expect(() => validateDb(bad)).toThrow();
  });

  it('rejects unknown schema version', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    const bad = { ...db, schemaVersion: 99 };
    expect(() => validateDb(bad)).toThrow();
  });
});
