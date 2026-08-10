/**
 * NIZAM · localCache tests — Dexie mirror round-trip + sync bookkeeping
 * Implemented by: KIRO Contract 2 / Phase 2.3
 * Uses fake-indexeddb (no real browser IndexedDB in vitest).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  NizamCache,
  writeDbToCache,
  readDbFromCache,
  markDirty,
  isDirty,
  saveSyncPoint,
  readSyncPoint,
} from './localCache.ts';
import { createEmptyDb, type NizamDb } from './schema.ts';

let cache: NizamCache;
let counter = 0;

beforeEach(() => {
  counter += 1;
  cache = new NizamCache(`nizam_cache_test_${counter}`);
});

function sampleDb(): NizamDb {
  const db = createEmptyDb('2026-07-29T00:00:00.000Z');
  db.accounts.push({
    id: 'acc_1',
    name: 'CIB Current',
    type: 'CIB_DEBIT',
    onBudget: true,
    balance: -5000,
    clearedBalance: -5000,
    accountIdentifier: '9876',
    creditLimit: null,
    closed: false,
    order: 0,
    paymentCategoryId: null,
  });
  db.categoryGroups.push({ id: 'grp_1', name: 'Essentials', order: 0, hidden: false });
  db.categories.push({
    id: 'cat_1',
    groupId: 'grp_1',
    name: 'Groceries',
    order: 0,
    hidden: false,
    target: null,
    isCreditCardPayment: false,
    linkedAccountId: null,
  });
  db.months.push({ month: '2026-07', categories: { cat_1: { assigned: 10_000, activity: -5000, available: 5000 } } });
  db.payees.push({ id: 'pay_1', name: 'Carrefour' });
  db.transactions.push({
    id: 'txn_1',
    accountId: 'acc_1',
    date: '2026-07-10',
    payee: 'Carrefour',
    categoryId: 'cat_1',
    memo: '',
    amount: -5000,
    cleared: 'cleared',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: {
      duplicateKey: 'dk_1',
      sourceFile: 'stmt.pdf',
      sourcePageOrSheet: '1',
      extractionMethod: 'parser',
      confidenceScore: 1,
      confidenceReason: '',
    },
  });
  return db;
}

describe('localCache mirror', () => {
  it('returns null before hydration', async () => {
    expect(await readDbFromCache(cache)).toBeNull();
  });

  it('write -> read round-trips the full db (offline read path)', async () => {
    const db = sampleDb();
    await writeDbToCache(cache, db);
    const back = await readDbFromCache(cache);
    expect(back).toEqual(db);
  });

  it('overwrites cleanly on re-hydrate (no stale rows)', async () => {
    const db = sampleDb();
    await writeDbToCache(cache, db);
    const smaller = createEmptyDb('2026-07-29T01:00:00.000Z');
    await writeDbToCache(cache, smaller);
    const back = await readDbFromCache(cache);
    expect(back?.transactions).toEqual([]);
    expect(back?.accounts).toEqual([]);
  });

  it('tracks the dirty flag', async () => {
    expect(await isDirty(cache)).toBe(false);
    await markDirty(cache, true);
    expect(await isDirty(cache)).toBe(true);
    await markDirty(cache, false);
    expect(await isDirty(cache)).toBe(false);
  });

  it('stores + restores the sync point (handle, version, merge base)', async () => {
    const db = sampleDb();
    await saveSyncPoint(cache, { fileId: 'f1', folderId: 'd1', version: 7, db });
    const sp = await readSyncPoint(cache);
    expect(sp?.fileId).toBe('f1');
    expect(sp?.folderId).toBe('d1');
    expect(sp?.version).toBe(7);
    expect(sp?.baseDb).toEqual(db);
    expect(await isDirty(cache)).toBe(false); // saveSyncPoint clears dirty
  });
});
