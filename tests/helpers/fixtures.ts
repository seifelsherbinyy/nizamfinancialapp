/**
 * NIZAM · Shared UI-test fixtures — sample db + store bootstrap
 * Implemented by: KIRO Contract 4 / Phase 4.2 (test harness)
 * Depends on: src/lib/db/schema.ts, src/state/store.ts
 */
import { createEmptyDb, type NizamDb } from '@/lib/db/schema';
import type { Transaction } from '@/features/transactions/transaction.types';
import { useNizamStore } from '@/state/store';

let n = 0;
export const nextId = (p: string) => `${p}_${++n}`;

export function makeTxn(
  partial: Partial<Transaction> & Pick<Transaction, 'accountId' | 'date' | 'amount'>,
): Transaction {
  return {
    id: nextId('txn'),
    payee: 'Test Payee',
    categoryId: null,
    memo: '',
    cleared: 'cleared',
    currency: 'EGP',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
    ...partial,
  };
}

/** Fixture: CIB checking + HSBC card (+payment category), Income/Groceries/Rent. */
export function fixtureDb(): NizamDb {
  const db = createEmptyDb('2026-01-01T00:00:00.000Z');
  db.accounts.push(
    {
      id: 'acc_cib',
      name: 'CIB Current',
      type: 'CIB_DEBIT',
      onBudget: true,
      currency: 'EGP',
      balance: 0,
      clearedBalance: 0,
      accountIdentifier: '12349876',
      creditLimit: null,
      closed: false,
      order: 0,
      paymentCategoryId: null,
    },
    {
      id: 'acc_hsbc',
      name: 'HSBC Card',
      type: 'HSBC_CC',
      onBudget: true,
      currency: 'EGP',
      balance: 0,
      clearedBalance: 0,
      accountIdentifier: '55554321',
      creditLimit: 50_000_000,
      closed: false,
      order: 1,
      paymentCategoryId: 'cat_hsbc_pay',
    },
    {
      id: 'acc_track',
      name: 'Pension',
      type: 'TRACKING',
      onBudget: false,
      currency: 'EGP',
      balance: 0,
      clearedBalance: 0,
      accountIdentifier: null,
      creditLimit: null,
      closed: false,
      order: 2,
      paymentCategoryId: null,
    },
  );
  db.categoryGroups.push(
    { id: 'grp_ess', name: 'Essentials', order: 0, hidden: false },
    { id: 'grp_cc', name: 'Credit Card Payments', order: 1, hidden: false },
    { id: 'grp_inc', name: 'Inflow', order: 2, hidden: false },
  );
  db.categories.push(
    {
      id: 'cat_groc',
      groupId: 'grp_ess',
      name: 'Groceries',
      order: 0,
      hidden: false,
      target: null,
      isCreditCardPayment: false,
      linkedAccountId: null,
    },
    {
      id: 'cat_rent',
      groupId: 'grp_ess',
      name: 'Rent',
      order: 1,
      hidden: false,
      target: null,
      isCreditCardPayment: false,
      linkedAccountId: null,
    },
    {
      id: 'cat_debt',
      groupId: 'grp_ess',
      name: 'Loan Installment',
      order: 2,
      hidden: false,
      target: null,
      isCreditCardPayment: false,
      linkedAccountId: null,
    },
    {
      id: 'cat_hsbc_pay',
      groupId: 'grp_cc',
      name: 'HSBC Card Payment',
      order: 3,
      hidden: false,
      target: null,
      isCreditCardPayment: true,
      linkedAccountId: 'acc_hsbc',
    },
    {
      id: 'cat_income',
      groupId: 'grp_inc',
      name: 'Income',
      order: 4,
      hidden: false,
      target: null,
      isCreditCardPayment: false,
      linkedAccountId: null,
    },
  );
  return db;
}

/** Reset the zustand store to a fresh fixture (component tests). */
export function bootStore(db: NizamDb = fixtureDb()): NizamDb {
  useNizamStore.setState({
    db,
    baseDb: db,
    handle: null,
    sessionStatus: 'signedOut',
    sessionError: null,
    syncStatus: 'idle',
    syncError: null,
  });
  return db;
}
