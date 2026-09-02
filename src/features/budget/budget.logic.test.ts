// @vitest-environment node
/**
 * NIZAM · Budget engine tests — YNAB-parity fixtures (hand-computed)
 * Implemented by: KIRO Contract 3 / Phase 3.8
 */
import { describe, it, expect } from 'vitest';
import {
  computeBudget,
  computeMonth,
  setAssigned,
  applySeed,
  ensureCreditCardPaymentCategories,
  goalProgress,
  nextMonth,
  prevMonth,
  monthsBetween,
} from './budget.logic.ts';
import { createEmptyDb, type NizamDb } from '@/lib/db/schema';
import type { Transaction } from '@/features/transactions/transaction.types';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

let n = 0;
const id = (p: string) => `${p}_${++n}`;

function txn(partial: Partial<Transaction> & Pick<Transaction, 'accountId' | 'date' | 'amount'>): Transaction {
  return {
    id: id('txn'),
    payee: 'Test',
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

/** db with checking (CIB), credit card (HSBC + payment category), Income + Groceries. */
function fixtureDb(): NizamDb {
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
      accountIdentifier: '1111',
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
      accountIdentifier: '2222',
      creditLimit: 50_000_000,
      closed: false,
      order: 1,
      paymentCategoryId: 'cat_hsbc_pay',
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
      id: 'cat_hsbc_pay',
      groupId: 'grp_cc',
      name: 'HSBC Card Payment',
      order: 2,
      hidden: false,
      target: null,
      isCreditCardPayment: true,
      linkedAccountId: 'acc_hsbc',
    },
    {
      id: 'cat_income',
      groupId: 'grp_inc',
      name: 'Income',
      order: 3,
      hidden: false,
      target: null,
      isCreditCardPayment: false,
      linkedAccountId: null,
    },
  );
  return db;
}

// All amounts in milliunits: 10 EGP = 10_000.

describe('phase 3.2 — activity equals sum of categorized transactions', () => {
  it('sums categorized activity per category per month', () => {
    const db = fixtureDb();
    db.transactions.push(
      txn({ accountId: 'acc_cib', date: '2026-03-05', amount: -2_500, categoryId: 'cat_groc' }),
      txn({ accountId: 'acc_cib', date: '2026-03-20', amount: -1_500, categoryId: 'cat_groc' }),
      txn({ accountId: 'acc_cib', date: '2026-03-21', amount: 500, categoryId: 'cat_groc' }), // refund
      txn({ accountId: 'acc_cib', date: '2026-04-01', amount: -9_999, categoryId: 'cat_groc' }), // other month
      txn({ accountId: 'acc_cib', date: '2026-03-10', amount: -7_000, categoryId: 'cat_rent' }),
    );
    const m = computeMonth(db, '2026-03');
    expect(m.categories['cat_groc']?.activity).toBe(-3_500);
    expect(m.categories['cat_rent']?.activity).toBe(-7_000);
  });

  it('splits contribute per-leg; transfers and uncategorized carry no activity', () => {
    const db = fixtureDb();
    db.transactions.push(
      txn({
        accountId: 'acc_cib',
        date: '2026-03-05',
        amount: -10_000,
        splits: [
          { id: 's1', categoryId: 'cat_groc', amount: -6_000, memo: '' },
          { id: 's2', categoryId: 'cat_rent', amount: -4_000, memo: '' },
        ],
      }),
      txn({ accountId: 'acc_cib', date: '2026-03-06', amount: -1_000 }), // uncategorized
    );
    const m = computeMonth(db, '2026-03');
    expect(m.categories['cat_groc']?.activity).toBe(-6_000);
    expect(m.categories['cat_rent']?.activity).toBe(-4_000);
  });
});

describe('phase 3.3 — available + Ready-To-Assign', () => {
  it('available = assigned + activity; RTA = income − assigned', () => {
    const db = fixtureDb();
    db.transactions.push(
      txn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, categoryId: 'cat_income' }),
      txn({ accountId: 'acc_cib', date: '2026-03-10', amount: -25_000, categoryId: 'cat_groc' }),
    );
    setAssigned(db, '2026-03', 'cat_groc', 60_000);

    const m = computeMonth(db, '2026-03');
    expect(m.income).toBe(100_000);
    expect(m.totalAssigned).toBe(60_000);
    expect(m.categories['cat_groc']?.available).toBe(35_000); // 60000 − 25000
    expect(m.readyToAssign).toBe(40_000); // 100000 − 60000
  });

  it('RTA accumulates across months (income − assigned, cumulative)', () => {
    const db = fixtureDb();
    db.transactions.push(
      txn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, categoryId: 'cat_income' }),
      txn({ accountId: 'acc_cib', date: '2026-04-01', amount: 50_000, categoryId: 'cat_income' }),
    );
    setAssigned(db, '2026-03', 'cat_groc', 80_000);
    setAssigned(db, '2026-04', 'cat_groc', 30_000);

    const { months } = computeBudget(db, '2026-04');
    expect(months.get('2026-03')?.readyToAssign).toBe(20_000);
    expect(months.get('2026-04')?.readyToAssign).toBe(40_000); // 150000 − 110000
  });

  it('uncategorized inflow does not count as income', () => {
    const db = fixtureDb();
    db.transactions.push(txn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000 }));
    const m = computeMonth(db, '2026-03');
    expect(m.income).toBe(0);
  });
});

describe('phase 3.4 — rollover + overspend rules', () => {
  it('positive available rolls forward as carryIn', () => {
    const db = fixtureDb();
    db.transactions.push(
      txn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, categoryId: 'cat_income' }),
      txn({ accountId: 'acc_cib', date: '2026-03-10', amount: -20_000, categoryId: 'cat_groc' }),
    );
    setAssigned(db, '2026-03', 'cat_groc', 50_000);

    const { months } = computeBudget(db, '2026-04');
    expect(months.get('2026-03')?.categories['cat_groc']?.available).toBe(30_000);
    const april = months.get('2026-04')?.categories['cat_groc'];
    expect(april?.carryIn).toBe(30_000);
    expect(april?.available).toBe(30_000); // nothing assigned/spent in April
  });

  it('CASH overspend resets the category and reduces NEXT month RTA', () => {
    const db = fixtureDb();
    db.transactions.push(
      txn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, categoryId: 'cat_income' }),
      txn({ accountId: 'acc_cib', date: '2026-03-10', amount: -80_000, categoryId: 'cat_groc' }),
    );
    setAssigned(db, '2026-03', 'cat_groc', 60_000);

    const { months } = computeBudget(db, '2026-04');
    const march = months.get('2026-03');
    expect(march?.categories['cat_groc']?.available).toBe(-20_000);
    expect(march?.categories['cat_groc']?.cashOverspend).toBe(20_000);
    expect(march?.readyToAssign).toBe(40_000); // current month RTA unaffected

    const april = months.get('2026-04');
    expect(april?.categories['cat_groc']?.carryIn).toBe(0); // reset
    expect(april?.readyToAssign).toBe(20_000); // 40000 − 20000 cash overspend
  });

  it('CREDIT overspend does NOT reduce RTA (becomes card debt)', () => {
    const db = fixtureDb();
    db.transactions.push(
      txn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, categoryId: 'cat_income' }),
      txn({ accountId: 'acc_hsbc', date: '2026-03-10', amount: -80_000, categoryId: 'cat_groc' }),
    );
    setAssigned(db, '2026-03', 'cat_groc', 60_000);

    const { months } = computeBudget(db, '2026-04');
    const march = months.get('2026-03');
    expect(march?.categories['cat_groc']?.available).toBe(-20_000);
    expect(march?.categories['cat_groc']?.creditOverspend).toBe(20_000);
    expect(march?.categories['cat_groc']?.cashOverspend).toBe(0);
    expect(march?.categories['cat_groc']?.fundedCreditSpend).toBe(60_000);

    const april = months.get('2026-04');
    expect(april?.readyToAssign).toBe(40_000); // NOT reduced
    expect(april?.categories['cat_groc']?.carryIn).toBe(0);
  });

  it('mixed cash+credit overspend attributes credit first, cash remainder', () => {
    const db = fixtureDb();
    db.transactions.push(
      txn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, categoryId: 'cat_income' }),
      txn({ accountId: 'acc_cib', date: '2026-03-09', amount: -50_000, categoryId: 'cat_groc' }), // cash
      txn({ accountId: 'acc_hsbc', date: '2026-03-10', amount: -30_000, categoryId: 'cat_groc' }), // credit
    );
    setAssigned(db, '2026-03', 'cat_groc', 60_000);
    // available = 60000 − 80000 = −20000; creditSpend=30000 ⇒ creditOverspend=20000, cash=0
    const { months } = computeBudget(db, '2026-04');
    const groc = months.get('2026-03')?.categories['cat_groc'];
    expect(groc?.creditOverspend).toBe(20_000);
    expect(groc?.cashOverspend).toBe(0);
    expect(groc?.fundedCreditSpend).toBe(10_000);
    expect(months.get('2026-04')?.readyToAssign).toBe(40_000);
  });
});

describe('phase 3.5 — credit-card payment automation', () => {
  it('funded credit spending moves into the payment category', () => {
    const db = fixtureDb();
    db.transactions.push(
      txn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, categoryId: 'cat_income' }),
      txn({ accountId: 'acc_hsbc', date: '2026-03-10', amount: -25_000, categoryId: 'cat_groc' }),
    );
    setAssigned(db, '2026-03', 'cat_groc', 60_000);

    const m = computeMonth(db, '2026-03');
    expect(m.categories['cat_groc']?.available).toBe(35_000);
    expect(m.categories['cat_groc']?.fundedCreditSpend).toBe(25_000);
    expect(m.categories['cat_hsbc_pay']?.available).toBe(25_000); // auto-moved
  });

  it('a card payment (transfer) reduces the payment category', () => {
    const db = fixtureDb();
    db.transactions.push(
      txn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, categoryId: 'cat_income' }),
      txn({ accountId: 'acc_hsbc', date: '2026-03-10', amount: -25_000, categoryId: 'cat_groc' }),
      // transfer CIB -> HSBC of 20: two mirrored rows
      txn({
        accountId: 'acc_cib',
        date: '2026-03-15',
        amount: -20_000,
        transferAccountId: 'acc_hsbc',
        transferTransactionId: 'tp',
      }),
      txn({
        accountId: 'acc_hsbc',
        date: '2026-03-15',
        amount: 20_000,
        transferAccountId: 'acc_cib',
        transferTransactionId: 'tp',
      }),
    );
    setAssigned(db, '2026-03', 'cat_groc', 60_000);

    const m = computeMonth(db, '2026-03');
    expect(m.categories['cat_hsbc_pay']?.available).toBe(5_000); // 25000 funded − 20000 paid
  });

  it('payment category rolls its available forward', () => {
    const db = fixtureDb();
    db.transactions.push(
      txn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, categoryId: 'cat_income' }),
      txn({ accountId: 'acc_hsbc', date: '2026-03-10', amount: -25_000, categoryId: 'cat_groc' }),
    );
    setAssigned(db, '2026-03', 'cat_groc', 60_000);
    const { months } = computeBudget(db, '2026-04');
    expect(months.get('2026-04')?.categories['cat_hsbc_pay']?.carryIn).toBe(25_000);
  });

  it('ensureCreditCardPaymentCategories creates + links payment categories (idempotent)', () => {
    const db = fixtureDb();
    // strip the pre-made link
    db.accounts[1]!.paymentCategoryId = null;
    db.categories = db.categories.filter((c) => c.id !== 'cat_hsbc_pay');

    ensureCreditCardPaymentCategories(db);
    const created = db.categories.find((c) => c.isCreditCardPayment);
    expect(created?.linkedAccountId).toBe('acc_hsbc');
    expect(db.accounts[1]!.paymentCategoryId).toBe(created?.id);

    const count = db.categories.length;
    ensureCreditCardPaymentCategories(db);
    expect(db.categories.length).toBe(count); // idempotent
  });
});

describe('phase 3.5 — goals / targets', () => {
  it('monthly target progress + remaining', () => {
    const db = fixtureDb();
    db.categories[0]!.target = {
      type: 'monthly_funding',
      amount: 50_000,
      targetMonth: null,
      rollover: 'set_aside',
      obligationId: null,
    };
    setAssigned(db, '2026-03', 'cat_groc', 30_000);
    const m = computeMonth(db, '2026-03');
    const g = goalProgress(db.categories[0]!, '2026-03', m.categories['cat_groc']);
    expect(g?.progress).toBeCloseTo(0.6);
    expect(g?.remaining).toBe(20_000);
    expect(g?.suggestedPerMonth).toBe(50_000);
  });

  it('target_balance_by_date suggests integer per-month funding (ceil)', () => {
    const db = fixtureDb();
    db.categories[0]!.target = {
      type: 'target_balance_by_date',
      amount: 100_000,
      targetMonth: '2026-06',
      rollover: 'refill',
      obligationId: null,
    };
    setAssigned(db, '2026-03', 'cat_groc', 10_000);
    const m = computeMonth(db, '2026-03');
    const g = goalProgress(db.categories[0]!, '2026-03', m.categories['cat_groc']);
    // available 10000, remaining 90000 over Mar..Jun = 4 months ⇒ 22500
    expect(g?.remaining).toBe(90_000);
    expect(g?.suggestedPerMonth).toBe(22_500);
    expect(g?.progress).toBeCloseTo(0.1);
  });

  it('goalProgress is null without a target', () => {
    const db = fixtureDb();
    const m = computeMonth(db, '2026-03');
    expect(goalProgress(db.categories[0]!, '2026-03', m.categories['cat_groc'])).toBeNull();
  });
});

describe('phase 3.1 — seed + month utilities', () => {
  it('applySeed loads groups/categories idempotently', () => {
    const db = createEmptyDb('2026-01-01T00:00:00.000Z');
    const seed = {
      groups: [
        { name: 'Essentials', categories: ['Rent', 'Groceries'] },
        { name: 'Life', categories: ['Dining'] },
      ],
    };
    applySeed(db, seed);
    expect(db.categoryGroups).toHaveLength(2);
    expect(db.categories).toHaveLength(3);
    applySeed(db, seed);
    expect(db.categories).toHaveLength(3); // no dupes
  });

  it('month helpers', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(monthsBetween('2026-03', '2026-06')).toBe(4);
    expect(monthsBetween('2026-06', '2026-03')).toBe(0);
  });

  it('setAssigned creates and updates month records', () => {
    const db = fixtureDb();
    setAssigned(db, '2026-03', 'cat_groc', 10_000);
    setAssigned(db, '2026-03', 'cat_groc', 20_000);
    expect(db.months).toHaveLength(1);
    expect(db.months[0]?.categories['cat_groc']?.assigned).toBe(20_000);
    expect(() => setAssigned(db, '2026-03', 'cat_groc', 10.5)).toThrow();
  });
});
