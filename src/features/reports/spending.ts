/**
 * NIZAM · Spending report — totals by category / group per month
 * Implemented by: KIRO Contract 5 / Phase 5.1
 * Depends on: lib/db/schema.ts, lib/ledger/ledgerStore.ts, lib/money
 *
 * Pure functions over the read model. Spending is the magnitude of negative
 * categorized activity (refunds net against it). Integer milliunits throughout.
 */
import type { NizamDb } from '@/lib/db/schema';
import type { MonthKey } from '@/features/budget/budget.types';
import type { Money } from '@/lib/money/money';
import { getIndex } from '@/lib/ledger/ledgerStore';
import { incomeCategoryIds } from '@/features/budget/budget.logic';

export interface SpendingSlice {
  categoryId: string;
  categoryName: string;
  groupId: string;
  groupName: string;
  /** Net spending magnitude for the month (>= 0; refunds subtract). */
  spent: Money;
}

/** Net spending by category for one month, largest first. Income categories excluded. */
export function spendingByCategory(db: NizamDb, month: MonthKey): SpendingSlice[] {
  const incomeIds = incomeCategoryIds(db);
  const index = getIndex(db);
  const categoryById = new Map(db.categories.map((c) => [c.id, c]));
  const groupById = new Map(db.categoryGroups.map((g) => [g.id, g]));
  const out: SpendingSlice[] = [];

  for (const [categoryId, months] of index.byCategoryMonth) {
    if (incomeIds.has(categoryId)) continue;
    const entries = months.get(month) ?? [];
    let net = 0;
    for (const e of entries) net += e.amount;
    if (net >= 0) continue; // no net spending this month
    const category = categoryById.get(categoryId);
    const group = category ? groupById.get(category.groupId) : undefined;
    out.push({
      categoryId,
      categoryName: category?.name ?? categoryId,
      groupId: category?.groupId ?? '',
      groupName: group?.name ?? '—',
      spent: -net,
    });
  }
  return out.sort((a, b) => b.spent - a.spent || a.categoryName.localeCompare(b.categoryName));
}

export interface GroupSpending {
  groupId: string;
  groupName: string;
  spent: Money;
}

/** Net spending rolled up by category group for one month, largest first. */
export function spendingByGroup(db: NizamDb, month: MonthKey): GroupSpending[] {
  const byGroup = new Map<string, GroupSpending>();
  for (const slice of spendingByCategory(db, month)) {
    const existing = byGroup.get(slice.groupId);
    if (existing) existing.spent += slice.spent;
    else byGroup.set(slice.groupId, { groupId: slice.groupId, groupName: slice.groupName, spent: slice.spent });
  }
  return [...byGroup.values()].sort((a, b) => b.spent - a.spent || a.groupName.localeCompare(b.groupName));
}

/** Total net spending for one month (magnitude). */
export function totalSpending(db: NizamDb, month: MonthKey): Money {
  return spendingByCategory(db, month).reduce((t, s) => t + s.spent, 0);
}

/** All months that carry any transaction, sorted ascending. */
export function activityMonths(db: NizamDb): MonthKey[] {
  return [...getIndex(db).byMonth.keys()].sort();
}
