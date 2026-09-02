/**
 * NIZAM · Month-key arithmetic (ISO YYYY-MM) — pure, no Date, no timezone.
 * Implemented by: Contract 3 / Phase 3.1 (extracted from budget.logic.ts by Step 7
 *   so the target funding engine can share it without an import cycle).
 * Depends on: budget.types.ts
 *
 * EXTRACTED, NOT REWRITTEN. `nextMonth`, `prevMonth`, `monthsBetween` and
 * `monthRange` are byte-identical in behaviour to their previous home and are
 * re-exported from budget.logic.ts so every existing import keeps resolving.
 */
import type { MonthKey } from '@/features/budget/budget.types';

export function nextMonth(month: MonthKey): MonthKey {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function prevMonth(month: MonthKey): MonthKey {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Inclusive count of months from `from` to `to`; 0 when to < from. */
export function monthsBetween(from: MonthKey, to: MonthKey): number {
  const fy = Number(from.slice(0, 4)),
    fm = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4)),
    tm = Number(to.slice(5, 7));
  const diff = (ty - fy) * 12 + (tm - fm) + 1;
  return Math.max(0, diff);
}

export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  let m = from;
  while (m <= to) {
    out.push(m);
    m = nextMonth(m);
  }
  return out;
}

/**
 * `month` shifted by `count` whole months (negative shifts back). New in Step 7:
 * the target engine needs to project a completion month `n` months out, which
 * repeated `nextMonth` calls could do but only in O(n) with no bound.
 */
export function addMonths(month: MonthKey, count: number): MonthKey {
  if (!Number.isSafeInteger(count)) {
    throw new TypeError(`NIZAM month: addMonths count must be an integer, got ${count}`);
  }
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const zero = y * 12 + (m - 1) + count;
  const ny = Math.floor(zero / 12);
  const nm = zero - ny * 12 + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
}

/** The YYYY-MM containing an ISO YYYY-MM-DD date. */
export function monthOfDate(isoDate: string): MonthKey {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new TypeError(`NIZAM month: expected YYYY-MM-DD, got "${isoDate}"`);
  }
  return isoDate.slice(0, 7);
}
