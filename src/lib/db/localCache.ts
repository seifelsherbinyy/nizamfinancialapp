/**
 * NIZAM · IndexedDB (Dexie) offline cache — working mirror of the Drive DB
 * Implemented by: KIRO Contract 2 / Phase 2.3
 * Depends on: schema.ts
 *
 * Dexie tables mirror the canonical collections; a `kv` table carries sync
 * bookkeeping (db file handle, last-synced version, 3-way-merge base, dirty flag).
 */
import Dexie, { type EntityTable } from 'dexie';
import type { Account } from '@/features/accounts/accounts.types';
import type { Category, CategoryGroup, MonthBudget } from '@/features/budget/budget.types';
import type { Transaction } from '@/features/transactions/transaction.types';
import { SCHEMA_VERSION, validateDb, type NizamDb, type Payee, type DbMeta } from '@/lib/db/schema';
import type { Obligation } from '@/features/obligations/obligation.types';
import { DEFAULT_POLICY, type FinancialPolicy } from '@/features/safeToSpend/policy.types';
import type { DecisionRecord } from '@/features/decisions/decisionRecord.types';
import { DEFAULT_MACRO, type Asset, type FxRate, type MacroContext } from '@/features/netWorth/netWorth.types';

interface KvRow {
  key: string;
  value: unknown;
}

export class NizamCache extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  categoryGroups!: EntityTable<CategoryGroup, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  months!: EntityTable<MonthBudget, 'month'>;
  payees!: EntityTable<Payee, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  kv!: EntityTable<KvRow, 'key'>;

  constructor(name = 'nizam_cache') {
    super(name);
    this.version(1).stores({
      accounts: 'id, order',
      categoryGroups: 'id, order',
      categories: 'id, groupId, order',
      months: 'month',
      payees: 'id, name',
      transactions: 'id, accountId, date, categoryId, importInfo.duplicateKey',
      kv: 'key',
    });
  }
}

let cacheInstance: NizamCache | null = null;

/** Singleton cache (tests construct their own instances). */
export function getCache(): NizamCache {
  if (!cacheInstance) cacheInstance = new NizamCache();
  return cacheInstance;
}

// --- KV keys -----------------------------------------------------------------
export const KV = {
  dbFileId: 'dbFileId',
  folderId: 'folderId',
  lastSyncedVersion: 'lastSyncedVersion',
  /** JSON string of the last-synced db — the BASE for 3-way merges. */
  baseDb: 'baseDb',
  /** '1' when local edits have not been pushed to Drive yet. */
  dirty: 'dirty',
  meta: 'meta',
  /** PFOS Stage 1: obligation registry, mirrored so the engine works offline. */
  obligations: 'obligations',
  /** PFOS Stage 1: version-controlled financial policy. */
  policy: 'policy',
  /** PFOS Stage 3: append-only decision outcome registry. */
  decisions: 'decisions',
  /** PFOS Stage 4: net-worth entities. */
  assets: 'assets',
  fxRates: 'fxRates',
  macro: 'macro',
} as const;

export async function getKv<T>(cache: NizamCache, key: string): Promise<T | undefined> {
  const row = await cache.kv.get(key);
  return row?.value as T | undefined;
}

export async function setKv(cache: NizamCache, key: string, value: unknown): Promise<void> {
  await cache.kv.put({ key, value });
}

// --- Whole-DB mirror ----------------------------------------------------------

/** Replace the cache contents with a full NizamDb (used on pull / hydrate). */
export async function writeDbToCache(cache: NizamCache, db: NizamDb): Promise<void> {
  await cache.transaction(
    'rw',
    [cache.accounts, cache.categoryGroups, cache.categories, cache.months, cache.payees, cache.transactions, cache.kv],
    async () => {
      await Promise.all([
        cache.accounts.clear(),
        cache.categoryGroups.clear(),
        cache.categories.clear(),
        cache.months.clear(),
        cache.payees.clear(),
        cache.transactions.clear(),
      ]);
      await Promise.all([
        cache.accounts.bulkAdd(db.accounts),
        cache.categoryGroups.bulkAdd(db.categoryGroups),
        cache.categories.bulkAdd(db.categories),
        cache.months.bulkAdd(db.months),
        cache.payees.bulkAdd(db.payees),
        cache.transactions.bulkAdd(db.transactions),
      ]);
      await cache.kv.put({ key: KV.meta, value: db.meta });
      await cache.kv.put({ key: KV.obligations, value: db.obligations });
      await cache.kv.put({ key: KV.policy, value: db.policy });
      await cache.kv.put({ key: KV.decisions, value: db.decisions });
      await cache.kv.put({ key: KV.assets, value: db.assets });
      await cache.kv.put({ key: KV.fxRates, value: db.fxRates });
      await cache.kv.put({ key: KV.macro, value: db.macro });
    },
  );
}

/** Rebuild a full NizamDb from the cache; null when the cache is empty/unhydrated. */
export async function readDbFromCache(cache: NizamCache): Promise<NizamDb | null> {
  const meta = await getKv<DbMeta>(cache, KV.meta);
  if (!meta) return null;
  const [accounts, categoryGroups, categories, months, payees, transactions] = await Promise.all([
    cache.accounts.toArray(),
    cache.categoryGroups.toArray(),
    cache.categories.toArray(),
    cache.months.toArray(),
    cache.payees.toArray(),
    cache.transactions.toArray(),
  ]);
  const obligations = (await getKv<Obligation[]>(cache, KV.obligations)) ?? [];
  const policy = (await getKv<FinancialPolicy>(cache, KV.policy)) ?? { ...DEFAULT_POLICY };
  const decisions = (await getKv<DecisionRecord[]>(cache, KV.decisions)) ?? [];
  const assets = (await getKv<Asset[]>(cache, KV.assets)) ?? [];
  const fxRates = (await getKv<FxRate[]>(cache, KV.fxRates)) ?? [];
  const macro = (await getKv<MacroContext>(cache, KV.macro)) ?? { ...DEFAULT_MACRO };
  const db: NizamDb = {
    schemaVersion: SCHEMA_VERSION,
    meta,
    accounts: accounts.sort((a, b) => a.order - b.order),
    categoryGroups: categoryGroups.sort((a, b) => a.order - b.order),
    categories: categories.sort((a, b) => a.order - b.order),
    months: months.sort((a, b) => a.month.localeCompare(b.month)),
    payees,
    transactions: transactions.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    obligations: obligations.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id)),
    policy,
    decisions: decisions.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    assets: assets.sort((a, b) => a.id.localeCompare(b.id)),
    fxRates: fxRates.sort((a, b) => a.currency.localeCompare(b.currency)),
    macro,
  };
  return validateDb(db);
}

// --- Sync bookkeeping ----------------------------------------------------------

export async function markDirty(cache: NizamCache, dirty: boolean): Promise<void> {
  await setKv(cache, KV.dirty, dirty ? '1' : '');
}

export async function isDirty(cache: NizamCache): Promise<boolean> {
  return (await getKv<string>(cache, KV.dirty)) === '1';
}

export async function saveSyncPoint(
  cache: NizamCache,
  args: { fileId: string; folderId: string; version: number; db: NizamDb },
): Promise<void> {
  await Promise.all([
    setKv(cache, KV.dbFileId, args.fileId),
    setKv(cache, KV.folderId, args.folderId),
    setKv(cache, KV.lastSyncedVersion, args.version),
    setKv(cache, KV.baseDb, JSON.stringify(args.db)),
    markDirty(cache, false),
  ]);
}

export interface SyncPoint {
  fileId: string;
  folderId: string;
  version: number;
  baseDb: NizamDb;
}

export async function readSyncPoint(cache: NizamCache): Promise<SyncPoint | null> {
  const [fileId, folderId, version, baseJson] = await Promise.all([
    getKv<string>(cache, KV.dbFileId),
    getKv<string>(cache, KV.folderId),
    getKv<number>(cache, KV.lastSyncedVersion),
    getKv<string>(cache, KV.baseDb),
  ]);
  if (!fileId || !folderId || version === undefined || !baseJson) return null;
  return { fileId, folderId, version, baseDb: validateDb(JSON.parse(baseJson)) };
}
