// @vitest-environment node
/**
 * NIZAM · Safe-to-spend engine tests — fully hand-computed eight-term waterfall.
 * Owning contract: PFOS contract 03 (Decision Engine) section 2.2 / 2.4 / 2.5.
 * Build phase: PFOS Stage 1, phase 1.3 — safe-to-spend computation.
 */
import { describe, it, expect } from 'vitest';
import { createEmptyDb, type NizamDb } from '@/lib/db/schema';
import type { Account } from '@/features/accounts/accounts.types';
import type { Transaction } from '@/features/transactions/transaction.types';
import type { Obligation } from '@/features/obligations/obligation.types';
import type { FinancialPolicy } from './policy.types.ts';
import { safeToSpendForHorizon, safeToSpendAllHorizons } from './safeToSpend.ts';

const M = 1000;
let n = 0;
const id = (p: string) => `${p}_${++n}`;

function acct(p: Partial<Account> & Pick<Account, 'type' | 'clearedBalance'>): Account {
  return {
    id: id('acc'),
    name: 'A',
    onBudget: true,
    currency: 'EGP',
    balance: p.clearedBalance,
    accountIdentifier: null,
    creditLimit: null,
    closed: false,
    order: 0,
    paymentCategoryId: null,
    ...p,
  };
}
function txn(p: Partial<Transaction> & Pick<Transaction, 'date' | 'amount'>): Transaction {
  return {
    id: id('txn'),
    accountId: 'acc_cib',
    payee: 'P',
    categoryId: null,
    memo: '',
    cleared: 'uncleared',
    currency: 'EGP',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
    ...p,
  };
}
function oblig(p: Partial<Obligation> & Pick<Obligation, 'priority' | 'amountDue' | 'dueDate'>): Obligation {
  return {
    id: id('ob'),
    creditor: 'C',
    accountId: null,
    minimumDue: p.amountDue,
    graceDate: null,
    frequency: 'monthly',
    penalty: 0,
    interestBps: 0,
    autopay: false,
    verificationSource: 'manual',
    confidence: 1,
    protectedReserve: 0,
    ...p,
  };
}

/**
 * Reference fixture — every number chosen so the eight terms are exactly hand-computable
 * for the 30-day horizon anchored at asOf 2026-01-10 (window end 2026-02-09):
 *   liquid = 21,000 · inflows = 5,000 (uncleared) + 30,000 (salary 01-25 @ conf 0.9) = 35,000
 *   pending = 2,000 · protected = 8,000 (P0) + 1,500 (P1 min) + 0 (P3) = 9,500
 *   essential = 6,000 (full month) · buffer = 3,000 · uncertainty = 5% of (9,500+6,000) = 775
 */
function referenceDb(): NizamDb {
  const db = createEmptyDb('2026-01-01T00:00:00.000Z');
  db.accounts.push(
    acct({ id: 'acc_cib', type: 'CIB_DEBIT', clearedBalance: 20_000 * M }),
    acct({ id: 'acc_cash', type: 'CASH', clearedBalance: 1_000 * M }),
    acct({ id: 'acc_hsbc', type: 'HSBC_CC', clearedBalance: -4_000 * M }),
  );
  db.transactions.push(
    txn({ date: '2026-01-15', amount: 5_000 * M }), // uncleared inflow in window
    txn({ date: '2026-01-12', amount: -2_000 * M }), // uncleared outflow in window
    txn({ date: '2026-03-01', amount: 9_999 * M }), // inflow AFTER the 30d window
  );
  db.obligations.push(
    oblig({ id: 'rent', creditor: 'Landlord', priority: 'P0', amountDue: 8_000 * M, dueDate: '2026-01-28' }),
    oblig({ id: 'card', creditor: 'HSBC', priority: 'P1', amountDue: 5_000 * M, minimumDue: 1_500 * M, dueDate: '2026-02-05', accountId: 'acc_hsbc' }),
    oblig({ id: 'sub', creditor: 'Stream', priority: 'P3', amountDue: 300 * M, dueDate: '2026-01-20' }),
  );
  const policy: FinancialPolicy = {
    minimumLiquidityBuffer: 3_000 * M,
    essentialLivingMonthly: 6_000 * M,
    uncertaintyBps: 500,
    stalenessBps: 500,
    staleAfterDays: 3,
    expectedInflow: { amount: 30_000 * M, dayOfMonth: 25, confidence: 0.9 },
  };
  db.policy = policy;
  return db;
}

describe('safeToSpendForHorizon — 30d reference (hand-computed)', () => {
  const r = safeToSpendForHorizon(referenceDb(), '2026-01-10', '30d');

  it('resolves the horizon window', () => {
    expect(r.horizon.id).toBe('30d');
    expect(r.horizon.endDate).toBe('2026-02-09');
    expect(r.horizon.days).toBe(30);
  });

  it('computes each of the eight terms exactly', () => {
    expect(r.terms.liquidAvailableNow).toBe(21_000 * M);
    expect(r.terms.highConfidenceInflows).toBe(35_000 * M);
    expect(r.terms.pendingOutflows).toBe(2_000 * M);
    expect(r.terms.protectedObligations).toBe(9_500 * M);
    expect(r.terms.essentialLivingReserve).toBe(6_000 * M);
    expect(r.terms.minimumLiquidityBuffer).toBe(3_000 * M);
    expect(r.terms.uncertaintyReserve).toBe(775 * M);
    expect(r.terms.plannedCommittedAllocations).toBe(0);
  });

  it('derives raw, safe-to-spend, protected amount and daily allowance', () => {
    // raw = 21,000 + 35,000 − (2,000+9,500+6,000+3,000+775+0) = 34,725
    expect(r.raw).toBe(34_725 * M);
    expect(r.safeToSpend).toBe(34_725 * M);
    expect(r.deficit).toBe(false);
    expect(r.protectedAmount).toBe(21_275 * M);
    expect(r.dailyAllowance).toBe(1_157_500); // 34,725,000 / 30
  });

  it('is not stale, so no staleness uncertainty is added', () => {
    expect(r.freshness.stale).toBe(false);
    expect(r.freshness.lastActivityDate).toBe('2026-03-01');
  });

  it('scores confidence as evidenced (only the uncleared-share deduction fires)', () => {
    expect(r.confidenceBps).toBe(9000);
    expect(r.confidenceBand).toBe('evidenced');
  });

  it('flags income-dependence as the primary risk (income exceeds cash headroom)', () => {
    expect(r.primaryRisk).toMatch(/expected income/i);
  });

  it('sensitivity: without the salary the window is underwater, so delayed income floors at zero', () => {
    // rawNoInflow = 21,000 − 21,275 = −275 -> floored to 0
    expect(r.sensitivity.delayedIncome).toBe(0);
    expect(r.sensitivity.unexpectedExpenseHeadroom).toBe(34_725 * M);
  });
});

describe('safeToSpendForHorizon — proration and edge cases', () => {
  it('prorates the essential-living reserve by day count (7d = 7/30 of a month)', () => {
    const r = safeToSpendForHorizon(referenceDb(), '2026-01-10', '7d');
    // mulRatio(6,000,000, 7, 30) = 1,400,000
    expect(r.terms.essentialLivingReserve).toBe(1_400 * M);
    expect(r.horizon.days).toBe(7);
  });

  it('shows a real deficit when reserves exceed available funds (never hidden)', () => {
    const db = referenceDb();
    // Drain cash and remove the salary so protected costs dominate.
    db.accounts = [acct({ id: 'acc_cib', type: 'CIB_DEBIT', clearedBalance: 1_000 * M })];
    db.transactions = [];
    db.policy = { ...db.policy!, expectedInflow: null };
    const r = safeToSpendForHorizon(db, '2026-01-10', '30d');
    expect(r.deficit).toBe(true);
    expect(r.raw).toBeLessThan(0);
    expect(r.safeToSpend).toBe(0); // floored, but deficit flag tells the truth
    expect(r.primaryRisk).toMatch(/over-committed/i);
  });

  it('adds staleness uncertainty and lowers confidence when data is old', () => {
    const db = referenceDb();
    db.transactions = [txn({ date: '2025-12-01', amount: -100 * M })]; // 40 days before asOf
    const r = safeToSpendForHorizon(db, '2026-01-10', '30d');
    expect(r.freshness.stale).toBe(true);
    expect(r.freshness.ageDays).toBe(40);
    // uncertaintyBps now 500+500=1000 -> 10% of (protected 9,500 + essential 6,000) = 1,550
    expect(r.terms.uncertaintyReserve).toBe(1_550 * M);
    expect(r.confidenceBps).toBeLessThan(9000);
    expect(r.whatWouldImprove.join(' ')).toMatch(/stale/i);
  });

  it('counts positive credit-card payment allocations as planned commitments', () => {
    const db = referenceDb();
    db.categoryGroups.push({ id: 'grp_cc', name: 'Credit Card Payments', order: 0, hidden: false });
    db.categories.push({
      id: 'cat_hsbc_pay',
      groupId: 'grp_cc',
      name: 'HSBC Payment',
      order: 0,
      hidden: false,
      target: null,
      isCreditCardPayment: true,
      linkedAccountId: 'acc_hsbc',
    });
    db.months.push({
      month: '2026-01',
      categories: { cat_hsbc_pay: { assigned: 2_000 * M, activity: 0, available: 0 } },
    });
    const r = safeToSpendForHorizon(db, '2026-01-10', '30d');
    expect(r.terms.plannedCommittedAllocations).toBe(2_000 * M);
    // raw drops by exactly the planned commitment
    expect(r.raw).toBe((34_725 - 2_000) * M);
  });

  it('deducts confidence and flags improvement when until_inflow has no expected income', () => {
    const db = referenceDb();
    db.policy = { ...db.policy!, expectedInflow: null };
    const r = safeToSpendForHorizon(db, '2026-01-10', 'until_inflow');
    expect(r.whatWouldImprove.join(' ')).toMatch(/expected income/i);
  });

  it('throws on an unknown horizon id', () => {
    // @ts-expect-error deliberately invalid horizon id
    expect(() => safeToSpendForHorizon(referenceDb(), '2026-01-10', 'bogus')).toThrow();
  });
});

describe('safeToSpendAllHorizons', () => {
  it('returns available horizons only and keeps daily pace consistent', () => {
    const results = safeToSpendAllHorizons(referenceDb(), '2026-01-10');
    const ids = results.map((h) => h.horizon.id);
    // statement is available (P1 card linked to HSBC), until_inflow available (salary set)
    expect(ids).toContain('statement');
    expect(ids).toContain('until_inflow');
    for (const r of results) {
      // dailyAllowance * days is within one milliunit-rounding of safeToSpend per day
      expect(r.dailyAllowance).toBe(Math.trunc((r.safeToSpend / Math.max(1, r.horizon.days)) + (r.safeToSpend % Math.max(1, r.horizon.days) >= Math.max(1, r.horizon.days) / 2 ? 1 : 0)));
    }
  });

  it('drops unavailable horizons (no salary, no credit obligation)', () => {
    const db = referenceDb();
    db.policy = { ...db.policy!, expectedInflow: null };
    db.obligations = db.obligations.filter((o) => o.accountId === null); // drop the credit-linked card
    const ids = safeToSpendAllHorizons(db, '2026-01-10').map((h) => h.horizon.id);
    expect(ids).not.toContain('until_inflow');
    expect(ids).not.toContain('statement');
    expect(ids).toContain('30d');
  });
});
