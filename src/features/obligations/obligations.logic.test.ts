// @vitest-environment node
/**
 * NIZAM · Obligation protection engine tests — hand-computed fixtures.
 * Owning contract: PFOS contract 03 (Decision Engine) section 3.
 * Build phase: PFOS Stage 1, phase 1.2 — protection status + horizons.
 */
import { describe, it, expect } from 'vitest';
import type { Account } from '@/features/accounts/accounts.types';
import type { Transaction } from '@/features/transactions/transaction.types';
import type { FinancialPolicy } from '@/features/safeToSpend/policy.types';
import { DEFAULT_POLICY } from '@/features/safeToSpend/policy.types';
import type { Obligation } from './obligation.types.ts';
import {
  addDays,
  daysBetween,
  isLiquidAccount,
  liquidNow,
  inflowOccurrences,
  confidentInflowsBy,
  pendingOutflowsBy,
  obligationFundingReport,
  worstStatus,
  nextStatementDate,
  nextInflowDate,
  buildHorizons,
} from './obligations.logic.ts';

const M = 1000; // one EGP in milliunits

let n = 0;
const id = (p: string) => `${p}_${++n}`;

function acct(partial: Partial<Account> & Pick<Account, 'type' | 'clearedBalance'>): Account {
  return {
    id: id('acc'),
    name: 'Acct',
    onBudget: true,
    currency: 'EGP',
    balance: partial.clearedBalance,
    accountIdentifier: null,
    creditLimit: null,
    closed: false,
    order: 0,
    paymentCategoryId: null,
    ...partial,
  };
}

function txn(partial: Partial<Transaction> & Pick<Transaction, 'date' | 'amount'>): Transaction {
  return {
    id: id('txn'),
    accountId: 'acc_x',
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
    ...partial,
  };
}

function oblig(partial: Partial<Obligation> & Pick<Obligation, 'dueDate' | 'priority' | 'amountDue'>): Obligation {
  return {
    id: id('ob'),
    creditor: 'Creditor',
    accountId: null,
    minimumDue: partial.amountDue,
    graceDate: null,
    frequency: 'monthly',
    penalty: 0,
    interestBps: 0,
    autopay: false,
    verificationSource: 'manual',
    confidence: 1,
    protectedReserve: 0,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

describe('addDays / daysBetween', () => {
  it('adds within a month', () => {
    expect(addDays('2026-01-10', 5)).toBe('2026-01-15');
  });
  it('rolls over a month boundary', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
  });
  it('rolls over a year boundary', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
  it('handles leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });
  it('subtracts with negative days', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('daysBetween is signed and symmetric', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });
  it('daysBetween counts a leap year February', () => {
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29);
  });
  it('rejects malformed dates', () => {
    expect(() => addDays('2026/01/01', 1)).toThrow();
    expect(() => daysBetween('bad', '2026-01-01')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Liquidity primitives
// ---------------------------------------------------------------------------

describe('isLiquidAccount / liquidNow', () => {
  it('counts on-budget debit and cash, excludes credit / tracking / closed / off-budget', () => {
    const accounts: Account[] = [
      acct({ type: 'CIB_DEBIT', clearedBalance: 10_000 * M }),
      acct({ type: 'CASH', clearedBalance: 500 * M }),
      acct({ type: 'HSBC_CC', clearedBalance: -3_000 * M }),
      acct({ type: 'CREDIT_OTHER', clearedBalance: -1_000 * M }),
      acct({ type: 'TRACKING', clearedBalance: 99_000 * M }),
      acct({ type: 'BANK_OTHER', clearedBalance: 2_000 * M, closed: true }),
      acct({ type: 'BANK_OTHER', clearedBalance: 7_000 * M, onBudget: false }),
    ];
    expect(accounts.filter(isLiquidAccount).length).toBe(2);
    expect(liquidNow(accounts)).toBe(10_500 * M);
  });
  it('is zero for an empty portfolio', () => {
    expect(liquidNow([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// inflowOccurrences
// ---------------------------------------------------------------------------

describe('inflowOccurrences', () => {
  it('returns one occurrence per month on the day-of-month', () => {
    const occ = inflowOccurrences({ amount: 20_000 * M, dayOfMonth: 25, confidence: 1 }, '2026-01-01', '2026-03-31');
    expect(occ.map((o) => o.date)).toEqual(['2026-01-25', '2026-02-25', '2026-03-25']);
  });
  it('clamps day 31 to the length of February', () => {
    const occ = inflowOccurrences({ amount: 1 * M, dayOfMonth: 31, confidence: 1 }, '2026-02-01', '2026-02-28');
    expect(occ.map((o) => o.date)).toEqual(['2026-02-28']);
  });
  it('respects inclusive window bounds', () => {
    const occ = inflowOccurrences({ amount: 1 * M, dayOfMonth: 15, confidence: 1 }, '2026-01-16', '2026-02-15');
    expect(occ.map((o) => o.date)).toEqual(['2026-02-15']);
  });
  it('returns nothing for null, non-positive amount, or inverted window', () => {
    expect(inflowOccurrences(null, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(inflowOccurrences({ amount: 0, dayOfMonth: 1, confidence: 1 }, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(inflowOccurrences({ amount: -5, dayOfMonth: 1, confidence: 1 }, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(inflowOccurrences({ amount: 1 * M, dayOfMonth: 1, confidence: 1 }, '2026-03-01', '2026-01-01')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// confident inflows / pending outflows
// ---------------------------------------------------------------------------

describe('confidentInflowsBy', () => {
  const policy: FinancialPolicy = { ...DEFAULT_POLICY, expectedInflow: { amount: 20_000 * M, dayOfMonth: 25, confidence: 0.9 } };
  it('sums uncleared positive txns on or before `by` and adds high-confidence salary', () => {
    const txns: Transaction[] = [
      txn({ date: '2026-01-10', amount: 5_000 * M }), // in window
      txn({ date: '2026-02-10', amount: 1_000 * M }), // after by
      txn({ date: '2026-01-05', amount: -900 * M }), // outflow ignored
      txn({ date: '2026-01-08', amount: 400 * M, cleared: 'cleared' }), // cleared ignored
    ];
    // window asOf 2026-01-01 .. by 2026-01-31 -> salary 2026-01-25 counted once
    expect(confidentInflowsBy(txns, policy, '2026-01-01', '2026-01-31')).toBe((5_000 + 20_000) * M);
  });
  it('excludes salary when confidence is below the bar', () => {
    const low: FinancialPolicy = { ...policy, expectedInflow: { amount: 20_000 * M, dayOfMonth: 25, confidence: 0.5 } };
    expect(confidentInflowsBy([], low, '2026-01-01', '2026-01-31')).toBe(0);
  });
  it('does not count a salary dated on asOf (already in the balance)', () => {
    expect(confidentInflowsBy([], policy, '2026-01-25', '2026-01-31')).toBe(0);
  });
});

describe('pendingOutflowsBy', () => {
  it('sums the magnitude of uncleared negatives on or before `by`', () => {
    const txns: Transaction[] = [
      txn({ date: '2026-01-10', amount: -2_000 * M }),
      txn({ date: '2026-01-20', amount: -500 * M }),
      txn({ date: '2026-02-01', amount: -9_000 * M }), // after by
      txn({ date: '2026-01-15', amount: -1_000 * M, cleared: 'cleared' }), // cleared ignored
      txn({ date: '2026-01-15', amount: 800 * M }), // inflow ignored
    ];
    expect(pendingOutflowsBy(txns, '2026-01-31')).toBe(2_500 * M);
  });
});

// ---------------------------------------------------------------------------
// obligationFundingReport
// ---------------------------------------------------------------------------

describe('obligationFundingReport', () => {
  const asOf = '2026-01-01';
  const accounts: Account[] = [acct({ id: 'acc_cib', type: 'CIB_DEBIT', clearedBalance: 10_000 * M })];

  it('marks a fully covered future P0 green with no penalty exposure', () => {
    const obs = [oblig({ dueDate: '2026-01-20', priority: 'P0', amountDue: 3_000 * M, penalty: 250 * M })];
    const line = obligationFundingReport(obs, accounts, [], DEFAULT_POLICY, asOf)[0]!;
    expect(line.status).toBe('green');
    expect(line.required).toBe(3_000 * M);
    expect(line.shortfall).toBe(0);
    expect(line.penaltyExposure).toBe(0);
    expect(line.daysUntilDue).toBe(19);
  });

  it('needs expected income -> amber', () => {
    const policy: FinancialPolicy = { ...DEFAULT_POLICY, expectedInflow: { amount: 20_000 * M, dayOfMonth: 5, confidence: 1 } };
    const obs = [oblig({ dueDate: '2026-01-20', priority: 'P0', amountDue: 25_000 * M })];
    const line = obligationFundingReport(obs, accounts, [], policy, asOf)[0]!;
    expect(line.status).toBe('amber');
    expect(line.penaltyExposure).toBe(0); // penalty is 0 here
  });

  it('short even after income -> red', () => {
    const obs = [oblig({ dueDate: '2026-01-20', priority: 'P0', amountDue: 25_000 * M, penalty: 400 * M })];
    const line = obligationFundingReport(obs, accounts, [], DEFAULT_POLICY, asOf)[0]!;
    expect(line.status).toBe('red');
    expect(line.shortfall).toBe(15_000 * M);
    expect(line.penaltyExposure).toBe(400 * M);
  });

  it('overdue but covered -> amber (pay now)', () => {
    const obs = [oblig({ dueDate: '2025-12-20', priority: 'P1', amountDue: 3_000 * M })];
    const line = obligationFundingReport(obs, accounts, [], DEFAULT_POLICY, asOf)[0]!;
    expect(line.status).toBe('amber');
    expect(line.overdue).toBe(true);
    expect(line.daysUntilDue).toBeLessThan(0);
  });

  it('overdue and unfunded -> critical', () => {
    const obs = [oblig({ dueDate: '2025-12-20', priority: 'P0', amountDue: 50_000 * M })];
    const line = obligationFundingReport(obs, accounts, [], DEFAULT_POLICY, asOf)[0]!;
    expect(line.status).toBe('critical');
  });

  it('due today and not fully in hand -> critical', () => {
    const obs = [oblig({ dueDate: asOf, priority: 'P0', amountDue: 50_000 * M })];
    const line = obligationFundingReport(obs, accounts, [], DEFAULT_POLICY, asOf)[0]!;
    expect(line.status).toBe('critical');
  });

  it('funds the P0 before the sooner-due P3 (cumulative reserve ordering)', () => {
    // 10k cash. P3 due sooner (5k) but P0 due later (8k) is funded first.
    const obs = [
      oblig({ id: 'p3', dueDate: '2026-01-05', priority: 'P3', amountDue: 5_000 * M }),
      oblig({ id: 'p0', dueDate: '2026-01-25', priority: 'P0', amountDue: 8_000 * M }),
    ];
    const lines = obligationFundingReport(obs, accounts, [], DEFAULT_POLICY, asOf);
    const p0 = lines.find((l) => l.obligation.id === 'p0')!;
    const p3 = lines.find((l) => l.obligation.id === 'p3')!;
    // P0 claims first 8k of the 10k -> green. P3 needs cumulative 13k -> short by 3k.
    expect(p0.status).toBe('green');
    expect(p0.cumulativeRequired).toBe(8_000 * M);
    expect(p3.cumulativeRequired).toBe(13_000 * M);
    expect(p3.status).toBe('red');
    expect(p3.shortfall).toBe(3_000 * M);
    // Feasibility uses the payment amount (minimumDue here == amountDue), NOT the
    // safe-to-spend reserve — so a P3 still gets a real status.
    expect(p3.required).toBe(5_000 * M);
  });

  it('pending outflows reduce funds in hand', () => {
    const obs = [oblig({ dueDate: '2026-01-20', priority: 'P0', amountDue: 8_000 * M })];
    const pend = [txn({ date: '2026-01-10', amount: -5_000 * M })];
    const line = obligationFundingReport(obs, accounts, pend, DEFAULT_POLICY, asOf)[0]!;
    expect(line.fundsInHand).toBe(5_000 * M); // 10k - 5k pending
    expect(line.status).toBe('red'); // needs 8k, only 5k in hand, no inflow
  });
});

describe('worstStatus', () => {
  it('returns the most severe status present', () => {
    const asOf = '2026-01-01';
    const accounts: Account[] = [acct({ type: 'CIB_DEBIT', clearedBalance: 3_000 * M })];
    const obs = [
      oblig({ dueDate: '2026-01-20', priority: 'P0', amountDue: 1_000 * M }), // green
      oblig({ dueDate: '2025-12-01', priority: 'P0', amountDue: 99_000 * M }), // critical
    ];
    expect(worstStatus(obligationFundingReport(obs, accounts, [], DEFAULT_POLICY, asOf))).toBe('critical');
    expect(worstStatus([])).toBe('green');
  });
});

// ---------------------------------------------------------------------------
// Horizons
// ---------------------------------------------------------------------------

describe('nextStatementDate', () => {
  const asOf = '2026-01-01';
  it('returns the soonest future dueDate on a credit-linked obligation', () => {
    const accounts: Account[] = [
      acct({ id: 'cc', type: 'HSBC_CC', clearedBalance: -1_000 * M }),
      acct({ id: 'cib', type: 'CIB_DEBIT', clearedBalance: 5_000 * M }),
    ];
    const obs = [
      oblig({ dueDate: '2026-02-15', priority: 'P1', amountDue: 1_000 * M, accountId: 'cc' }),
      oblig({ dueDate: '2026-01-18', priority: 'P1', amountDue: 500 * M, accountId: 'cc' }),
      oblig({ dueDate: '2026-01-05', priority: 'P0', amountDue: 500 * M, accountId: 'cib' }), // not credit
    ];
    expect(nextStatementDate(obs, accounts, asOf)).toBe('2026-01-18');
  });
  it('returns null when there is no credit obligation (never aliases to 30d)', () => {
    const accounts: Account[] = [acct({ id: 'cib', type: 'CIB_DEBIT', clearedBalance: 5_000 * M })];
    const obs = [oblig({ dueDate: '2026-01-18', priority: 'P0', amountDue: 500 * M, accountId: 'cib' })];
    expect(nextStatementDate(obs, accounts, asOf)).toBeNull();
  });
});

describe('nextInflowDate', () => {
  it('returns the next salary date strictly after asOf', () => {
    const policy: FinancialPolicy = { ...DEFAULT_POLICY, expectedInflow: { amount: 1 * M, dayOfMonth: 25, confidence: 1 } };
    expect(nextInflowDate(policy, '2026-01-01')).toBe('2026-01-25');
    expect(nextInflowDate(policy, '2026-01-25')).toBe('2026-02-25');
  });
  it('returns null with no expected inflow', () => {
    expect(nextInflowDate(DEFAULT_POLICY, '2026-01-01')).toBeNull();
  });
});

describe('buildHorizons', () => {
  const asOf = '2026-01-01';
  it('builds fixed windows and flags dynamic ones', () => {
    const policy: FinancialPolicy = { ...DEFAULT_POLICY, expectedInflow: { amount: 1 * M, dayOfMonth: 25, confidence: 1 } };
    const accounts: Account[] = [acct({ id: 'cc', type: 'HSBC_CC', clearedBalance: -1_000 * M })];
    const obs = [oblig({ dueDate: '2026-01-18', priority: 'P1', amountDue: 500 * M, accountId: 'cc' })];
    const hs = buildHorizons(asOf, policy, obs, accounts);
    const byId = new Map(hs.map((h) => [h.id, h]));
    const get = (k: string) => byId.get(k as (typeof hs)[number]['id'])!;
    expect(get('1d').endDate).toBe('2026-01-02');
    expect(get('7d').days).toBe(7);
    expect(get('30d').endDate).toBe('2026-01-31');
    expect(get('90d').endDate).toBe('2026-04-01');
    expect(get('until_inflow').available).toBe(true);
    expect(get('until_inflow').endDate).toBe('2026-01-25');
    expect(get('statement').available).toBe(true);
    expect(get('statement').endDate).toBe('2026-01-18');
  });
  it('marks until_inflow and statement unavailable when their inputs are missing', () => {
    const hs = buildHorizons(asOf, DEFAULT_POLICY, [], []);
    const byId = new Map(hs.map((h) => [h.id, h]));
    const get = (k: string) => byId.get(k as (typeof hs)[number]['id'])!;
    expect(get('until_inflow').available).toBe(false);
    expect(get('until_inflow').endDate).toBeNull();
    expect(get('statement').available).toBe(false);
    expect(get('statement').endDate).toBeNull();
  });
});
