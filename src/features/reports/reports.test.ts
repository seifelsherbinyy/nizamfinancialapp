/**
 * NIZAM · Report calculation tests — spending, net worth, age of money
 * Implemented by: KIRO Contract 5 / Phase 5.1
 */
import { describe, it, expect } from 'vitest';
import { spendingByCategory, spendingByGroup, totalSpending, activityMonths } from './spending';
import { netWorthSeries } from './netWorth';
import { ageOfMoney } from './ageOfMoney';
import { fixtureDb, makeTxn } from '../../../tests/helpers/fixtures';

function reportDb() {
  const db = fixtureDb();
  db.transactions.push(
    makeTxn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, categoryId: 'cat_income' }),
    makeTxn({ accountId: 'acc_cib', date: '2026-03-05', amount: -30_000, categoryId: 'cat_groc' }),
    makeTxn({ accountId: 'acc_cib', date: '2026-03-07', amount: 5_000, categoryId: 'cat_groc' }), // refund
    makeTxn({ accountId: 'acc_cib', date: '2026-03-10', amount: -40_000, categoryId: 'cat_rent' }),
    makeTxn({ accountId: 'acc_hsbc', date: '2026-03-12', amount: -10_000, categoryId: 'cat_groc' }),
    makeTxn({ accountId: 'acc_cib', date: '2026-04-02', amount: -7_000, categoryId: 'cat_groc' }),
  );
  return db;
}

describe('spending report', () => {
  it('nets refunds and sorts largest first', () => {
    const db = reportDb();
    const slices = spendingByCategory(db, '2026-03');
    expect(slices.map((s) => [s.categoryName, s.spent])).toEqual([
      ['Rent', 40_000],
      ['Groceries', 35_000], // 30000 + 10000 − 5000 refund
    ]);
    expect(totalSpending(db, '2026-03')).toBe(75_000);
  });

  it('excludes income categories from spending', () => {
    const slices = spendingByCategory(reportDb(), '2026-03');
    expect(slices.some((s) => s.categoryName === 'Income')).toBe(false);
  });

  it('rolls up by group and stays integral', () => {
    const groups = spendingByGroup(reportDb(), '2026-03');
    expect(groups).toEqual([{ groupId: 'grp_ess', groupName: 'Essentials', spent: 75_000 }]);
    for (const g of groups) expect(Number.isSafeInteger(g.spent)).toBe(true);
  });

  it('lists activity months in order', () => {
    expect(activityMonths(reportDb())).toEqual(['2026-03', '2026-04']);
  });
});

describe('net worth report', () => {
  it('tracks assets, liabilities and net per month-end', () => {
    const series = netWorthSeries(reportDb());
    expect(series.map((p) => p.month)).toEqual(['2026-03', '2026-04']);
    const march = series[0]!;
    // CIB: 100000 − 30000 + 5000 − 40000 = 35000 asset; HSBC −10000 liability
    expect(march.assets).toBe(35_000);
    expect(march.liabilities).toBe(10_000);
    expect(march.net).toBe(25_000);
    const april = series[1]!;
    expect(april.net).toBe(18_000); // −7000 more spending
    for (const p of series) {
      expect(Number.isSafeInteger(p.assets)).toBe(true);
      expect(Number.isSafeInteger(p.liabilities)).toBe(true);
    }
  });

  it('returns an empty series for an empty db', () => {
    expect(netWorthSeries(fixtureDb())).toEqual([]);
  });
});

describe('age of money', () => {
  it('is null before any funded cash spending', () => {
    expect(ageOfMoney(fixtureDb())).toBeNull();
  });

  it('ages spending against the oldest inflow (FIFO)', () => {
    const db = fixtureDb();
    db.transactions.push(
      makeTxn({ accountId: 'acc_cib', date: '2026-03-01', amount: 50_000, categoryId: 'cat_income' }),
      makeTxn({ accountId: 'acc_cib', date: '2026-03-11', amount: -10_000, categoryId: 'cat_groc' }), // age 10
      makeTxn({ accountId: 'acc_cib', date: '2026-03-21', amount: -10_000, categoryId: 'cat_groc' }), // age 20
    );
    expect(ageOfMoney(db)).toBe(15); // average of 10 and 20
  });

  it('excludes credit spending and transfers from the cash queue', () => {
    const db = fixtureDb();
    db.transactions.push(
      makeTxn({ accountId: 'acc_cib', date: '2026-03-01', amount: 50_000, categoryId: 'cat_income' }),
      makeTxn({ accountId: 'acc_hsbc', date: '2026-03-02', amount: -20_000, categoryId: 'cat_groc' }), // credit spend
      makeTxn({
        accountId: 'acc_cib',
        date: '2026-03-03',
        amount: -5_000,
        transferAccountId: 'acc_hsbc',
        transferTransactionId: 'x',
      }),
      makeTxn({ accountId: 'acc_cib', date: '2026-03-06', amount: -10_000, categoryId: 'cat_groc' }), // age 5
    );
    expect(ageOfMoney(db)).toBe(5);
  });
});
