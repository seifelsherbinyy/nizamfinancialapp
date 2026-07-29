/**
 * NIZAM · Ledger read model — indexed queries for budget/reports
 * Implemented by: KIRO Contract 2 / Phase 2.3 (extended by Contract 3 / Phase 3.2)
 * Depends on: lib/db/schema.ts, lib/money/money.ts
 *
 * Pure selectors over the in-memory NizamDb. Memoized by object identity —
 * the store replaces `db` immutably on every mutation, invalidating caches.
 */
import type { NizamDb } from '@/lib/db/schema';
import type { Transaction } from '@/features/transactions/transaction.types';
import type { Money } from '@/lib/money/money';
import { sum } from '@/lib/money/money';

/** YYYY-MM of an ISO date string. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

// Simple WeakMap memoization keyed on the immutable db object.
const indexCache = new WeakMap<NizamDb, LedgerIndex>();

export interface LedgerIndex {
  byAccount: Map<string, Transaction[]>;
  byMonth: Map<string, Transaction[]>;
  /** categoryId -> month -> transactions (split legs expanded). */
  byCategoryMonth: Map<string, Map<string, { txn: Transaction; amount: Money }[]>>;
  duplicateKeys: Set<string>;
}

/** Build (or reuse) the transaction indexes for a db snapshot. */
export function getIndex(db: NizamDb): LedgerIndex {
  const cached = indexCache.get(db);
  if (cached) return cached;

  const byAccount = new Map<string, Transaction[]>();
  const byMonth = new Map<string, Transaction[]>();
  const byCategoryMonth = new Map<string, Map<string, { txn: Transaction; amount: Money }[]>>();
  const duplicateKeys = new Set<string>();

  const pushCategoryAmount = (categoryId: string, month: string, txn: Transaction, amount: Money) => {
    let months = byCategoryMonth.get(categoryId);
    if (!months) byCategoryMonth.set(categoryId, (months = new Map()));
    let list = months.get(month);
    if (!list) months.set(month, (list = []));
    list.push({ txn, amount });
  };

  for (const txn of db.transactions) {
    const accountList = byAccount.get(txn.accountId);
    if (accountList) accountList.push(txn);
    else byAccount.set(txn.accountId, [txn]);

    const month = monthOf(txn.date);
    const monthList = byMonth.get(month);
    if (monthList) monthList.push(txn);
    else byMonth.set(month, [txn]);

    if (txn.splits && txn.splits.length > 0) {
      for (const split of txn.splits) {
        if (split.categoryId) pushCategoryAmount(split.categoryId, month, txn, split.amount);
      }
    } else if (txn.categoryId) {
      pushCategoryAmount(txn.categoryId, month, txn, txn.amount);
    }

    if (txn.importInfo?.duplicateKey) duplicateKeys.add(txn.importInfo.duplicateKey);
  }

  const sortTxns = (list: Transaction[]) =>
    list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const list of byAccount.values()) sortTxns(list);
  for (const list of byMonth.values()) sortTxns(list);

  const index: LedgerIndex = { byAccount, byMonth, byCategoryMonth, duplicateKeys };
  indexCache.set(db, index);
  return index;
}

/** Transactions of one account, date-sorted. */
export function transactionsForAccount(db: NizamDb, accountId: string): Transaction[] {
  return getIndex(db).byAccount.get(accountId) ?? [];
}

/** Transactions in one month (YYYY-MM). */
export function transactionsForMonth(db: NizamDb, month: string): Transaction[] {
  return getIndex(db).byMonth.get(month) ?? [];
}

/** Net categorized activity for a category in a month (spending negative). */
export function activityFor(db: NizamDb, categoryId: string, month: string): Money {
  const entries = getIndex(db).byCategoryMonth.get(categoryId)?.get(month) ?? [];
  return sum(entries.map((e) => e.amount));
}

/** All months that have any categorized activity for a category. */
export function activeMonthsFor(db: NizamDb, categoryId: string): string[] {
  return [...(getIndex(db).byCategoryMonth.get(categoryId)?.keys() ?? [])].sort();
}

/** Working balance of an account = sum of all its transaction amounts. */
export function accountBalance(db: NizamDb, accountId: string): Money {
  return sum(transactionsForAccount(db, accountId).map((t) => t.amount));
}

/** Cleared balance (cleared + reconciled transactions only). */
export function accountClearedBalance(db: NizamDb, accountId: string): Money {
  return sum(
    transactionsForAccount(db, accountId)
      .filter((t) => t.cleared !== 'uncleared')
      .map((t) => t.amount),
  );
}

/** Running balances aligned with transactionsForAccount order. */
export function runningBalances(db: NizamDb, accountId: string): Money[] {
  const out: Money[] = [];
  let acc = 0;
  for (const t of transactionsForAccount(db, accountId)) {
    acc += t.amount;
    out.push(acc);
  }
  return out;
}

/** Set of already-imported duplicate keys (for import dedup). */
export function knownDuplicateKeys(db: NizamDb): Set<string> {
  return getIndex(db).duplicateKeys;
}
