/**
 * NIZAM · Purchase decision engine tests — one scenario per recommendation state.
 * Owning contract: PFOS contract 03 (Decision Engine) section 4.3 / 4.4.
 * Build phase: PFOS Stage 2, phase 2.2 — decision policy gate.
 */
import { describe, it, expect } from 'vitest';
import { createEmptyDb, type NizamDb } from '@/lib/db/schema';
import type { Money } from '@/lib/money/money';
import type { Transaction } from '@/features/transactions/transaction.types';
import type { Obligation } from '@/features/obligations/obligation.types';
import type { FinancialPolicy } from '@/features/safeToSpend/policy.types';
import type { PurchaseRequest } from './decision.types';
import { toEvidenceRecommendation, RECOMMENDATIONS } from './decision.types';
import { decidePurchase } from './decision.logic';

const M = 1000;
let n = 0;
const id = (p: string) => `${p}_${++n}`;

/** Zero out every reserve so safe-to-spend = liquid + salary; then vary inputs cleanly. */
function zeroPolicy(over: Partial<FinancialPolicy> = {}): FinancialPolicy {
  return {
    minimumLiquidityBuffer: 0,
    essentialLivingMonthly: 0,
    uncertaintyBps: 0,
    stalenessBps: 0,
    staleAfterDays: 3650,
    expectedInflow: null,
    ...over,
  };
}

interface DbOpts {
  liquid: Money;
  salary?: Money; // expected inflow amount, day 25, confidence 0.9
  buffer?: Money;
  obligations?: Obligation[];
}
function makeDb(opts: DbOpts): NizamDb {
  const db = createEmptyDb('2026-01-01T00:00:00.000Z');
  db.accounts.push({
    id: 'acc_cib',
    name: 'CIB',
    type: 'CIB_DEBIT',
    onBudget: true,
    balance: opts.liquid,
    clearedBalance: opts.liquid,
    accountIdentifier: null,
    creditLimit: null,
    closed: false,
    order: 0,
    paymentCategoryId: null,
  });
  // A cleared transaction near asOf keeps freshness fresh without touching the math.
  const t: Transaction = {
    id: id('txn'),
    accountId: 'acc_cib',
    date: '2026-01-09',
    payee: 'seed',
    categoryId: null,
    memo: '',
    amount: -100 * M,
    cleared: 'cleared',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
  };
  db.transactions.push(t);
  db.obligations.push(...(opts.obligations ?? []));
  db.policy = zeroPolicy({
    minimumLiquidityBuffer: opts.buffer ?? 0,
    expectedInflow: opts.salary ? { amount: opts.salary, dayOfMonth: 25, confidence: 0.9 } : null,
  });
  return db;
}

function request(over: Partial<PurchaseRequest> & Pick<PurchaseRequest, 'price'>): PurchaseRequest {
  return {
    paymentMethod: 'cash',
    accountId: 'acc_cib',
    category: 'cat_x',
    date: '2026-01-10',
    reversible: true,
    purpose: 'a considered purchase',
    urgency: 'medium',
    alternativePrice: null,
    ...over,
  };
}

const ASOF = '2026-01-10';

describe('decidePurchase — recommendation states', () => {
  it('approve: fits inside cash on hand', () => {
    const card = decidePurchase(makeDb({ liquid: 10_000 * M }), ASOF, request({ price: 3_000 * M }));
    expect(card.recommendation).toBe('approve');
    expect(card.affordability.safeToSpendInHand).toBe(10_000 * M);
    expect(card.affordability.remainingInHand).toBe(7_000 * M);
    expect(card.affordability.reliesOnExpectedIncome).toBe(false);
  });

  it('approve_with_condition: affordable only once expected income arrives', () => {
    const card = decidePurchase(makeDb({ liquid: 10_000 * M, salary: 20_000 * M }), ASOF, request({ price: 15_000 * M }));
    expect(card.recommendation).toBe('approve_with_condition');
    expect(card.affordability.reliesOnExpectedIncome).toBe(true);
    expect(card.affordability.safeToSpendWithIncome).toBe(30_000 * M);
    expect(card.requiredAction).toMatch(/2026-01-25|income/i);
  });

  it('alternative: full price too big, the cheaper option fits', () => {
    const card = decidePurchase(
      makeDb({ liquid: 10_000 * M, salary: 20_000 * M }),
      ASOF,
      request({ price: 40_000 * M, alternativePrice: 25_000 * M }),
    );
    expect(card.recommendation).toBe('alternative');
    expect(card.alternative).toMatch(/instead/i);
  });

  it('delay: not affordable this month but affordable over 90 days', () => {
    // liquid 10k, salary 20k -> withIncome(30d)=30k, safe90 = 10k + 3*20k = 70k
    const card = decidePurchase(makeDb({ liquid: 10_000 * M, salary: 20_000 * M }), ASOF, request({ price: 50_000 * M }));
    expect(card.recommendation).toBe('delay');
    expect(card.requiredAction).toMatch(/delay/i);
  });

  it('approve_with_cap: only part fits, even over 90 days', () => {
    const card = decidePurchase(makeDb({ liquid: 10_000 * M, salary: 20_000 * M }), ASOF, request({ price: 100_000 * M }));
    expect(card.recommendation).toBe('approve_with_cap');
    expect(card.affordability.affordableCap).toBe(30_000 * M);
    expect(card.requiredAction).toMatch(/cap/i);
  });

  it('reject: no safe room at any horizon', () => {
    const card = decidePurchase(makeDb({ liquid: 5_000 * M, buffer: 10_000 * M }), ASOF, request({ price: 1_000 * M }));
    expect(card.recommendation).toBe('reject');
    expect(card.affordability.safeToSpendWithIncome).toBe(0);
    expect(card.affordability.affordableCap).toBe(0);
  });

  it('financially_blocked: would worsen a P0 obligation', () => {
    const p0: Obligation = {
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
    const card = decidePurchase(makeDb({ liquid: 10_000 * M, obligations: [p0] }), ASOF, request({ price: 5_000 * M }));
    expect(card.recommendation).toBe('financially_blocked');
    expect(card.evidence.join(' ')).toMatch(/protected|P0/i);
    expect(card.requiredAction).toMatch(/do not buy|obligation/i);
  });
});

describe('decidePurchase — card shape and contract conformance', () => {
  const card = decidePurchase(makeDb({ liquid: 10_000 * M, salary: 20_000 * M }), ASOF, request({ price: 3_000 * M }));

  it('emits all eleven card fields in a usable form', () => {
    expect(card.reason.length).toBeGreaterThan(0);
    expect(card.immediateEffect).toMatch(/removes|defers/i);
    expect(card.nextDayEffect).toMatch(/safe-to-spend|deficit/i);
    expect(card.oneWeekEffect).toMatch(/safe-to-spend|deficit/i);
    expect(card.oneMonthEffect).toMatch(/safe-to-spend|deficit/i);
    expect(card.oneYearEffect).toMatch(/trajectory/i);
    expect(card.evidence.length).toBeGreaterThanOrEqual(2);
    expect(card.requiredAction.length).toBeGreaterThan(0);
  });

  it('produces the four schema horizon_impacts', () => {
    expect(Object.keys(card.horizonImpacts)).toEqual(['next_day', 'next_week', 'next_month', 'next_year']);
    for (const v of Object.values(card.horizonImpacts)) expect(v.length).toBeGreaterThan(0);
  });

  it('inherits safe-to-spend confidence and surfaces missing information', () => {
    expect(card.confidence.bps).toBeGreaterThan(0);
    expect(['strong', 'evidenced', 'provisional', 'insufficient']).toContain(card.confidence.band);
    const noMeta = decidePurchase(
      makeDb({ liquid: 10_000 * M }),
      ASOF,
      request({ price: 3_000 * M, category: null, purpose: null }),
    );
    expect(noMeta.confidence.missingInformation.join(' ')).toMatch(/category/i);
    expect(noMeta.confidence.missingInformation.join(' ')).toMatch(/purpose/i);
  });

  it('credit purchases defer the cash to the next statement', () => {
    const creditCard = decidePurchase(
      makeDb({ liquid: 10_000 * M }),
      ASOF,
      request({ price: 3_000 * M, paymentMethod: 'credit' }),
    );
    expect(creditCard.immediateEffect).toMatch(/defers|statement/i);
  });
});

describe('toEvidenceRecommendation', () => {
  it('folds both conditional approvals into approve_with_conditions', () => {
    expect(toEvidenceRecommendation('approve_with_cap')).toBe('approve_with_conditions');
    expect(toEvidenceRecommendation('approve_with_condition')).toBe('approve_with_conditions');
  });
  it('passes the other five states through unchanged', () => {
    for (const r of RECOMMENDATIONS) {
      const e = toEvidenceRecommendation(r);
      if (r === 'approve_with_cap' || r === 'approve_with_condition') continue;
      expect(e).toBe(r);
    }
  });
});
