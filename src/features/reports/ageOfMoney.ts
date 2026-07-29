/**
 * NIZAM · Age of Money — average age of the cash spent (FIFO queue)
 * Implemented by: KIRO Contract 5 / Phase 5.1
 * Depends on: lib/db/schema.ts, features/accounts/accounts.types.ts
 *
 * YNAB-style metric: every cash inflow joins a FIFO queue; every cash outflow
 * consumes from the oldest inflow first. The age of an outflow is the day gap
 * to the inflow that funded it. Age of Money = average age of the last 10
 * outflow events. Credit spending is excluded (it spends borrowed money);
 * transfers between on-budget accounts are internal and excluded.
 */
import type { NizamDb } from '@/lib/db/schema';
import { isCreditType } from '@/features/accounts/accounts.types';

function dayNumber(isoDate: string): number {
  return Math.floor(
    Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10)) / 86_400_000,
  );
}

const SAMPLE = 10;

/**
 * Average age in whole days of the last 10 cash outflows, or null when there
 * is not yet any funded spending.
 */
export function ageOfMoney(db: NizamDb): number | null {
  const cashAccounts = new Set(
    db.accounts.filter((a) => a.onBudget && !isCreditType(a.type)).map((a) => a.id),
  );
  const txns = [...db.transactions]
    .filter((t) => cashAccounts.has(t.accountId) && !t.transferAccountId && t.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  interface Bucket {
    day: number;
    remaining: number; // milliunits still unspent from this inflow
  }
  const queue: Bucket[] = [];
  const outflowAges: number[] = [];

  for (const t of txns) {
    if (t.amount > 0) {
      queue.push({ day: dayNumber(t.date), remaining: t.amount });
      continue;
    }
    let toSpend = -t.amount;
    const spendDay = dayNumber(t.date);
    let weightedAge = 0;
    let funded = 0;
    while (toSpend > 0 && queue.length > 0) {
      const oldest = queue[0];
      if (!oldest) break;
      const used = Math.min(oldest.remaining, toSpend);
      weightedAge += (spendDay - oldest.day) * used;
      funded += used;
      oldest.remaining -= used;
      toSpend -= used;
      if (oldest.remaining === 0) queue.shift();
    }
    if (funded > 0) {
      outflowAges.push(Math.round(weightedAge / funded));
    }
  }

  if (outflowAges.length === 0) return null;
  const sample = outflowAges.slice(-SAMPLE);
  return Math.round(sample.reduce((a, b) => a + b, 0) / sample.length);
}
