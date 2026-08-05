/**
 * NIZAM · Deterministic forecast tests — hand-computed cash-flow paths + scenarios.
 * Owning contract: PFOS contract 03 (Decision Engine) section 6.
 * Build phase: PFOS Stage 3, phase 3.2 — deterministic scheduled cash flow.
 */
import { describe, it, expect } from 'vitest';
import { createEmptyDb, type NizamDb } from '@/lib/db/schema';
import type { Transaction } from '@/features/transactions/transaction.types';
import type { Obligation } from '@/features/obligations/obligation.types';
import { liquidNow } from '@/features/obligations/obligations.logic';
import {
  forecastHorizon,
  forecastAll,
  forecastStartReconciles,
  worstEndingBalance,
  FORECAST_HORIZONS,
} from './forecast';

const M = 1000;
let n = 0;
const id = (p: string) => `${p}_${++n}`;

function txn(p: Partial<Transaction> & Pick<Transaction, 'date' | 'amount'>): Transaction {
  return {
    id: id('txn'),
    accountId: 'acc_cib',
    payee: 'P',
    categoryId: null,
    memo: '',
    cleared: 'uncleared',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
    ...p,
  };
}

/** liquid = 10,000; salary 20,000 on the 25th (conf 0.9); one pending inflow +2,000 (01-20);
 *  one pending outflow −5,000 (01-15); one P0 obligation −8,000 due 01-28. asOf 2026-01-10. */
function fixture(): NizamDb {
  const db = createEmptyDb('2026-01-01T00:00:00.000Z');
  db.accounts.push({
    id: 'acc_cib',
    name: 'CIB',
    type: 'CIB_DEBIT',
    onBudget: true,
    balance: 10_000 * M,
    clearedBalance: 10_000 * M,
    accountIdentifier: null,
    creditLimit: null,
    closed: false,
    order: 0,
    paymentCategoryId: null,
  });
  db.transactions.push(
    txn({ date: '2026-01-20', amount: 2_000 * M }), // pending inflow
    txn({ date: '2026-01-15', amount: -5_000 * M }), // pending outflow (feared)
  );
  const ob: Obligation = {
    id: 'rent',
    creditor: 'Landlord',
    accountId: null,
    amountDue: 8_000 * M,
    minimumDue: 8_000 * M,
    dueDate: '2026-01-28',
    graceDate: null,
    frequency: 'monthly',
    priority: 'P0',
    penalty: 0,
    interestBps: 0,
    autopay: false,
    verificationSource: 'manual',
    confidence: 1,
    protectedReserve: 0,
  };
  db.obligations.push(ob);
  db.policy = {
    minimumLiquidityBuffer: 0,
    essentialLivingMonthly: 3_000 * M,
    uncertaintyBps: 0,
    stalenessBps: 0,
    staleAfterDays: 3650,
    expectedInflow: { amount: 20_000 * M, dayOfMonth: 25, confidence: 0.9 },
  };
  return db;
}

const ASOF = '2026-01-10';

describe('forecastHorizon — 30-day scenarios (hand-computed)', () => {
  const f = forecastHorizon(fixture(), ASOF, 'next_month');

  it('starts at cleared cash on hand', () => {
    expect(f.startingCash).toBe(10_000 * M);
    expect(f.horizon.endDate).toBe('2026-02-09');
  });

  it('baseline path applies pending out, pending in, obligation, salary — in date order', () => {
    const base = f.scenarios.find((s) => s.scenario === 'baseline')!;
    // 10,000 −5,000(01-15) +2,000(01-20) −8,000(01-28) +20,000(01-25)... ordered by date:
    // 01-15 -5k ->5k ; 01-20 +2k ->7k ; 01-25 +20k ->27k ; 01-28 -8k ->19k
    expect(base.path.map((p) => p.balance)).toEqual([5_000 * M, 7_000 * M, 27_000 * M, 19_000 * M]);
    expect(base.endingBalance).toBe(19_000 * M);
    expect(base.minBalance).toBe(5_000 * M);
    expect(base.shortfall).toBe(false);
  });

  it('downside drops the salary (income delay) and dips below zero', () => {
    const down = f.scenarios.find((s) => s.scenario === 'downside')!;
    // 10,000 −5,000 ->5,000 ; +2,000 ->7,000 ; −8,000 ->−1,000  (no salary)
    expect(down.endingBalance).toBe(-1_000 * M);
    expect(down.minBalance).toBe(-1_000 * M);
    expect(down.shortfall).toBe(true);
  });

  it('upside removes the feared outflow', () => {
    const up = f.scenarios.find((s) => s.scenario === 'upside')!;
    // 10,000 +2,000 ->12,000 ; +20,000 ->32,000 ; −8,000 ->24,000  (no −5,000)
    expect(up.endingBalance).toBe(24_000 * M);
    expect(up.shortfall).toBe(false);
  });

  it('shortfall probability = 1 of 3 scenarios dipping', () => {
    expect(f.probabilityOfShortfallBps).toBe(Math.round((1 / 3) * 10_000));
  });

  it('emergency-buffer days = cash / daily essential (10,000 / (3,000/30) = 100)', () => {
    expect(f.bufferDays).toBe(100);
  });

  it('drivers are the three largest absolute movements', () => {
    const labels = f.drivers.map((d) => d.label);
    expect(labels.some((l) => /Expected income/i.test(l))).toBe(true); // 20,000 is largest
    expect(f.drivers).toHaveLength(3);
  });
});

describe('forecast reconciliation and helpers', () => {
  it('starting cash reconciles to safe-to-spend liquid-now', () => {
    const db = fixture();
    expect(forecastStartReconciles(db, liquidNow(db.accounts))).toBe(true);
    expect(forecastStartReconciles(db, 999 * M)).toBe(false);
  });

  it('forecastAll covers every declared horizon', () => {
    const all = forecastAll(fixture(), ASOF);
    expect(all.map((f) => f.horizon.id)).toEqual(FORECAST_HORIZONS.map((h) => h.id));
  });

  it('worstEndingBalance is the downside ending balance here', () => {
    const f = forecastHorizon(fixture(), ASOF, 'next_month');
    expect(worstEndingBalance(f)).toBe(-1_000 * M);
  });

  it('bufferDays is null when no essential-living policy is set', () => {
    const db = fixture();
    db.policy = { ...db.policy!, essentialLivingMonthly: 0 };
    expect(forecastHorizon(db, ASOF, 'next_month').bufferDays).toBeNull();
  });

  it('throws on an unknown horizon', () => {
    // @ts-expect-error invalid horizon id
    expect(() => forecastHorizon(fixture(), ASOF, 'decade')).toThrow();
  });
});
