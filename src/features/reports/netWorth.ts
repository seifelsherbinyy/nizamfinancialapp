/**
 * NIZAM · Net worth report — assets vs liabilities per month
 * Implemented by: KIRO Contract 5 / Phase 5.1
 * Depends on: lib/db/schema.ts, lib/ledger/ledgerStore.ts, lib/money
 *
 * Pure: for each month-end, sum account balances from all transactions dated
 * on or before that month. Positive balances are assets, negative liabilities.
 */
import type { NizamDb } from '@/lib/db/schema';
import type { MonthKey } from '@/features/budget/budget.types';
import type { Money } from '@/lib/money/money';
import { monthOf } from '@/lib/ledger/ledgerStore';

export interface NetWorthPoint {
  month: MonthKey;
  assets: Money; // >= 0
  liabilities: Money; // >= 0 (magnitude of negative balances)
  net: Money; // assets − liabilities
}

/** Month-end net worth series across all (open + closed) accounts. */
export function netWorthSeries(db: NizamDb): NetWorthPoint[] {
  if (db.transactions.length === 0) return [];
  const months = [...new Set(db.transactions.map((t) => monthOf(t.date)))].sort();
  const txnsSorted = [...db.transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );

  const points: NetWorthPoint[] = [];
  const balances = new Map<string, Money>();
  let cursor = 0;
  for (const month of months) {
    while (cursor < txnsSorted.length) {
      const t = txnsSorted[cursor];
      if (!t || monthOf(t.date) > month) break;
      balances.set(t.accountId, (balances.get(t.accountId) ?? 0) + t.amount);
      cursor += 1;
    }
    let assets = 0;
    let liabilities = 0;
    for (const balance of balances.values()) {
      if (balance >= 0) assets += balance;
      else liabilities += -balance;
    }
    points.push({ month, assets, liabilities, net: assets - liabilities });
  }
  return points;
}
