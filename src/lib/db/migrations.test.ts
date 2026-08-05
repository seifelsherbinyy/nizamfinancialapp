/**
 * NIZAM · migrations tests — v0 example shape -> current schema, idempotent
 * Implemented by: KIRO Contract 2 / Phase 2.3
 */
import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION } from '@/lib/db/schema';
import { migrate } from './migrations';
import { createEmptyDb } from './schema';

/** The v0 example shape from data/ledgers/nizam_db.example.json. */
const v0Example = {
  schemaVersion: undefined, // pre-versioned files may lack the field entirely
  meta: { currency: 'EGP', moneyBase: 'milliunits', createdAt: null },
  accounts: [
    { id: 'acc_cib_debit', name: 'CIB Current', type: 'CIB_DEBIT', onBudget: true, balance: 0 },
  ],
  categoryGroups: [{ id: 'grp_essentials', name: 'Essentials', order: 0 }],
  categories: [{ id: 'cat_rent', groupId: 'grp_essentials', name: 'Rent', target: null }],
  months: [{ month: '2026-07', budgeted: { cat_rent: 5000 }, activity: { cat_rent: -3000 }, available: { cat_rent: 2000 } }],
  payees: [],
  transactions: [],
};

describe('migrate', () => {
  it('migrates the v0 example shape to the current schema', () => {
    const db = migrate(v0Example);
    expect(db.schemaVersion).toBe(SCHEMA_VERSION);
    expect(db.accounts[0]?.type).toBe('CIB_DEBIT');
    expect(db.accounts[0]?.clearedBalance).toBe(0);
    expect(db.categoryGroups[0]?.hidden).toBe(false);
    expect(db.categories[0]?.isCreditCardPayment).toBe(false);
    expect(db.months[0]?.categories['cat_rent']).toEqual({
      assigned: 5000,
      activity: -3000,
      available: 2000,
    });
    expect(db.meta.revision).toBe(0);
    expect(db.meta.conflicts).toEqual([]);
  });

  it('is idempotent — migrating v1 output again yields the same db', () => {
    const once = migrate(v0Example);
    const twice = migrate(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it('passes a fresh current db through unchanged', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    expect(migrate(JSON.parse(JSON.stringify(db)))).toEqual(db);
  });

  it('rejects a FUTURE schema version', () => {
    expect(() => migrate({ schemaVersion: 999 })).toThrow(/newer/);
  });
});
