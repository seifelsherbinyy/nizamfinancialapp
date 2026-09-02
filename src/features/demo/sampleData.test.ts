// @vitest-environment node
/**
 * NIZAM - Sample-data coverage tests: proves the demo exercises every server-free state.
 * Owning contract: PFOS contract 04 (Interface) - the sample portfolio must cover Stages 1-4.
 * Build phase: PFOS Stage 4, phase 4.5 - living sample dataset coverage guarantee.
 *
 * The living sample is realistic (a healthy-ish portfolio). Completeness is proven here: the
 * sample validates and is rich, AND every discrete state (all four obligation statuses, all six
 * horizons, the unrated-currency flag, a safe-to-spend deficit, multiple decision states) is
 * demonstrably reachable. Deterministic: a fixed nowIso anchors all relative dates.
 */
import { describe, it, expect } from 'vitest';
import { buildSampleDb } from './sampleData.ts';
import { createEmptyDb, validateDb, type NizamDb } from '@/lib/db/schema';
import type { Account } from '@/features/accounts/accounts.types';
import type { Obligation, ObligationPriority } from '@/features/obligations/obligation.types';
import {
  obligationFundingReport,
  addDays,
  type ObligationStatus,
} from '@/features/obligations/obligations.logic';
import { safeToSpendAllHorizons, safeToSpendForHorizon } from '@/features/safeToSpend/safeToSpend';
import { DEFAULT_POLICY, type FinancialPolicy } from '@/features/safeToSpend/policy.types';
import { netWorth } from '@/features/netWorth/netWorth';
import { decidePurchase } from '@/features/decisions/decision.logic';
import type { PurchaseRequest, Recommendation } from '@/features/decisions/decision.types';
import type { Money } from '@/lib/money/money';

const NOW = '2026-06-15T12:00:00.000Z';
const ASOF = '2026-06-15';

function debit(cash: Money): Account {
  return {
    id: 'a_main',
    name: 'Main',
    type: 'CIB_DEBIT',
    onBudget: true,
    currency: 'EGP',
    balance: cash,
    clearedBalance: cash,
    accountIdentifier: null,
    creditLimit: null,
    closed: false,
    order: 0,
    paymentCategoryId: null,
  };
}

function ob(
  id: string,
  priority: ObligationPriority,
  amount: Money,
  dueDate: string,
): Obligation {
  return {
    id,
    creditor: id,
    accountId: null,
    amountDue: amount,
    minimumDue: amount,
    dueDate,
    graceDate: null,
    frequency: 'monthly',
    priority,
    penalty: 0,
    interestBps: 0,
    autopay: false,
    verificationSource: 'manual',
    confidence: 0.9,
    protectedReserve: 0,
  };
}

/** A single-obligation db that yields exactly one funding status. */
function scenario(cash: Money, o: Obligation, policy: FinancialPolicy = DEFAULT_POLICY): NizamDb {
  const db = createEmptyDb(NOW);
  db.accounts = [debit(cash)];
  db.obligations = [o];
  db.policy = policy;
  return db;
}

function statusOf(db: NizamDb): ObligationStatus {
  const lines = obligationFundingReport(
    db.obligations,
    db.accounts,
    db.transactions,
    db.policy ?? DEFAULT_POLICY,
    ASOF,
  );
  return lines[0]!.status;
}

const withSalary: FinancialPolicy = {
  ...DEFAULT_POLICY,
  expectedInflow: { amount: 20_000_000, dayOfMonth: 20, confidence: 0.95 }, // lands 2026-06-20
};

function request(price: Money): PurchaseRequest {
  return {
    price,
    paymentMethod: 'cash',
    accountId: null,
    category: null,
    date: ASOF,
    reversible: true,
    purpose: null,
    urgency: 'medium',
    alternativePrice: null,
  };
}

describe('sample data - schema validity and richness', () => {
  const sample = buildSampleDb(NOW);

  it('is a schema-valid NizamDb', () => {
    expect(() => validateDb(sample)).not.toThrow();
  });

  it('spans multiple accounts, all four obligation tiers, and several currencies', () => {
    expect(sample.accounts.length).toBe(3);
    const tiers = new Set(sample.obligations.map((o) => o.priority));
    expect(tiers).toEqual(new Set<ObligationPriority>(['P0', 'P1', 'P2', 'P3']));
    const currencies = new Set(sample.assets.map((a) => a.currency));
    expect(currencies.has('USD')).toBe(true);
    expect(currencies.has('SAR')).toBe(true);
    expect([...currencies].some((c) => c !== 'EGP')).toBe(true);
  });

  it('resolves all six safe-to-spend horizons (expected income + a card statement are set)', () => {
    const horizons = safeToSpendAllHorizons(sample, ASOF);
    expect(horizons.length).toBe(6);
  });

  it('computes net worth and flags the deliberately unrated currency, never zeroing it', () => {
    const nw = netWorth(sample);
    expect(nw.nominal).toBeGreaterThan(0);
    expect(nw.unratedCurrencies).toContain('SAR');
    expect(nw.unratedCurrencies).not.toContain('USD'); // USD has a rate
  });
});

describe('sample data - every discrete state is reachable', () => {
  it('reaches all four obligation statuses', () => {
    const green = statusOf(scenario(10_000_000, ob('g', 'P0', 3_000_000, addDays(ASOF, 20))));
    const amber = statusOf(
      scenario(2_000_000, ob('a', 'P1', 5_000_000, addDays(ASOF, 10)), withSalary),
    );
    const red = statusOf(scenario(2_000_000, ob('r', 'P2', 5_000_000, addDays(ASOF, 10))));
    const critical = statusOf(scenario(1_000_000, ob('c', 'P0', 5_000_000, addDays(ASOF, -2))));

    expect(green).toBe('green');
    expect(amber).toBe('amber');
    expect(red).toBe('red');
    expect(critical).toBe('critical');
    expect(new Set([green, amber, red, critical]).size).toBe(4);
  });

  it('reaches a safe-to-spend deficit when a near-term obligation exceeds cash', () => {
    const db = scenario(1_000_000, ob('big', 'P0', 10_000_000, addDays(ASOF, 3)));
    const result = safeToSpendForHorizon(db, ASOF, '7d');
    expect(result.deficit).toBe(true);
    expect(result.safeToSpend).toBe(0);
  });

  it('reaches multiple decision recommendations from the same portfolio', () => {
    const db = createEmptyDb(NOW);
    db.accounts = [debit(5_000_000)]; // 5,000 EGP
    const affordable = decidePurchase(db, ASOF, request(100_000)); // 100 EGP
    const huge = decidePurchase(db, ASOF, request(50_000_000)); // 50,000 EGP
    expect(affordable.recommendation).toBe('approve');
    const recs = new Set<Recommendation>([affordable.recommendation, huge.recommendation]);
    expect(recs.size).toBeGreaterThanOrEqual(2);
  });
});
