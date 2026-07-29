/**
 * NIZAM · NIZAM DB schema (nizam_db.json) + zod validation
 * Implemented by: KIRO Contract 2 / Phase 2.2
 * Depends on: features/*.types.ts, lib/money/money.ts
 *
 * The canonical database is ONE JSON document living in the user's Google Drive.
 * Every load validates against this schema; every money field is integer milliunits.
 */
import { z } from 'zod';
import type { Account, AccountType } from '@/features/accounts/accounts.types';
import type {
  Category,
  CategoryGroup,
  CategoryTarget,
  MonthBudget,
  MonthCategoryBudget,
} from '@/features/budget/budget.types';
import type {
  ClearedStatus,
  ImportInfo,
  Transaction,
  TransactionSplit,
} from '@/features/transactions/transaction.types';

export const SCHEMA_VERSION = 1 as const;

/** Integer milliunits guard — floats are schema violations. */
export const zMoney = z.number().int().finite();

export const zMonthKey = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM');
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const zAccountType: z.ZodType<AccountType> = z.enum([
  'CIB_DEBIT',
  'HSBC_CC',
  'CASH',
  'BANK_OTHER',
  'CREDIT_OTHER',
  'TRACKING',
]);

export const zAccount: z.ZodType<Account> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: zAccountType,
  onBudget: z.boolean(),
  balance: zMoney,
  clearedBalance: zMoney,
  accountIdentifier: z.string().nullable(),
  creditLimit: zMoney.nullable(),
  closed: z.boolean(),
  order: z.number().int(),
  paymentCategoryId: z.string().nullable(),
});

export const zCategoryGroup: z.ZodType<CategoryGroup> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int(),
  hidden: z.boolean(),
});

const zTarget: z.ZodType<CategoryTarget> = z.object({
  type: z.enum(['monthly', 'target_by_date']),
  amount: zMoney,
  targetMonth: zMonthKey.nullable(),
});

export const zCategory: z.ZodType<Category> = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int(),
  hidden: z.boolean(),
  target: zTarget.nullable(),
  isCreditCardPayment: z.boolean(),
  linkedAccountId: z.string().nullable(),
});

const zMonthCategoryBudget: z.ZodType<MonthCategoryBudget> = z.object({
  assigned: zMoney,
  activity: zMoney,
  available: zMoney,
});

export const zMonthBudget: z.ZodType<MonthBudget> = z.object({
  month: zMonthKey,
  categories: z.record(z.string(), zMonthCategoryBudget),
});

const zCleared: z.ZodType<ClearedStatus> = z.enum(['uncleared', 'cleared', 'reconciled']);

const zSplit: z.ZodType<TransactionSplit> = z.object({
  id: z.string().min(1),
  categoryId: z.string().nullable(),
  amount: zMoney,
  memo: z.string(),
});

const zImportInfo: z.ZodType<ImportInfo> = z.object({
  duplicateKey: z.string(),
  sourceFile: z.string(),
  sourcePageOrSheet: z.string(),
  extractionMethod: z.enum(['parser', 'ocr', 'manual']),
  confidenceScore: z.number().min(0).max(1),
  confidenceReason: z.string(),
});

export const zTransaction: z.ZodType<Transaction> = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  date: zIsoDate,
  payee: z.string(),
  categoryId: z.string().nullable(),
  memo: z.string(),
  amount: zMoney,
  cleared: zCleared,
  approved: z.boolean(),
  transferAccountId: z.string().nullable(),
  transferTransactionId: z.string().nullable(),
  splits: z.array(zSplit).nullable(),
  importInfo: zImportInfo.nullable(),
});

export interface Payee {
  id: string;
  name: string;
}
export const zPayee: z.ZodType<Payee> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

/** Audit entry for a sync conflict resolved by merge / last-write-wins. */
export interface ConflictEntry {
  id: string;
  at: string; // ISO datetime
  collection: string;
  entityId: string;
  resolution: 'local_wins' | 'remote_wins' | 'merged';
  note: string;
}
export const zConflictEntry: z.ZodType<ConflictEntry> = z.object({
  id: z.string().min(1),
  at: z.string(),
  collection: z.string(),
  entityId: z.string(),
  resolution: z.enum(['local_wins', 'remote_wins', 'merged']),
  note: z.string(),
});

export interface DbMeta {
  currency: string;
  moneyBase: 'milliunits';
  createdAt: string | null;
  updatedAt: string | null;
  /** Monotonic edit counter — bumped on every local mutation (merge tiebreak aid). */
  revision: number;
  conflicts: ConflictEntry[];
}
export const zMeta: z.ZodType<DbMeta> = z.object({
  currency: z.string().min(1),
  moneyBase: z.literal('milliunits'),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  conflicts: z.array(zConflictEntry),
});

export interface NizamDb {
  schemaVersion: typeof SCHEMA_VERSION;
  meta: DbMeta;
  accounts: Account[];
  categoryGroups: CategoryGroup[];
  categories: Category[];
  months: MonthBudget[];
  payees: Payee[];
  transactions: Transaction[];
}

export const zNizamDb: z.ZodType<NizamDb> = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  meta: zMeta,
  accounts: z.array(zAccount),
  categoryGroups: z.array(zCategoryGroup),
  categories: z.array(zCategory),
  months: z.array(zMonthBudget),
  payees: z.array(zPayee),
  transactions: z.array(zTransaction),
});

/** New empty database. */
export function createEmptyDb(nowIso: string): NizamDb {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      currency: 'EGP',
      moneyBase: 'milliunits',
      createdAt: nowIso,
      updatedAt: nowIso,
      revision: 0,
      conflicts: [],
    },
    accounts: [],
    categoryGroups: [],
    categories: [],
    months: [],
    payees: [],
    transactions: [],
  };
}

/** Validate an unknown value as a NizamDb (throws ZodError with details on failure). */
export function validateDb(value: unknown): NizamDb {
  return zNizamDb.parse(value);
}
