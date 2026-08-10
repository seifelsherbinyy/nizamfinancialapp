// @vitest-environment node
/**
 * NIZAM · Rescue analytics tests — utilization, debt service, runway, control panel
 * Implemented by: KIRO Contract 5 / Phase 5.2
 * Formula sources cited in rescue.ts (docs/research/*).
 */
import { describe, it, expect } from 'vitest';
import { cardUtilization, debtServiceRatio, liquidityRunway, controlPanel, ratioBps } from './rescue.ts';
import { fixtureDb, makeTxn } from '../../../tests/helpers/fixtures.ts';

describe('ratioBps', () => {
  it('returns integer basis points and null on empty denominators', () => {
    expect(ratioBps(2_500_000, 50_000_000)).toBe(500); // 5%
    expect(ratioBps(1, 3)).toBe(3333);
    expect(ratioBps(10, 0)).toBeNull();
  });
});

describe('card utilization (egypt-iscore-fastest-levers.md)', () => {
  it('computes utilization per credit account with bands', () => {
    const db = fixtureDb();
    // HSBC limit is 50_000_000 milliunits (EGP 50,000). Debt of EGP 10,000 = 20%.
    db.transactions.push(
      makeTxn({ accountId: 'acc_hsbc', date: '2026-03-05', amount: -10_000_000, categoryId: 'cat_groc' }),
    );
    const [card] = cardUtilization(db);
    expect(card?.debt).toBe(10_000_000);
    expect(card?.utilizationBps).toBe(2000);
    expect(card?.band).toBe('ok');
  });

  it('flags critical utilization above 90%', () => {
    const db = fixtureDb();
    db.transactions.push(
      makeTxn({ accountId: 'acc_hsbc', date: '2026-03-05', amount: -46_000_000, categoryId: 'cat_groc' }),
    );
    expect(cardUtilization(db)[0]?.band).toBe('critical');
  });

  it('reports unknown without a credit limit', () => {
    const db = fixtureDb();
    db.accounts[1]!.creditLimit = null;
    expect(cardUtilization(db)[0]?.band).toBe('unknown');
  });
});

describe('debt service ratio (egypt-loan-readiness-dashboard.md)', () => {
  it('counts card payments and loan installments against income', () => {
    const db = fixtureDb();
    db.transactions.push(
      makeTxn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, categoryId: 'cat_income' }),
      // card payment: transfer CIB -> HSBC
      makeTxn({ accountId: 'acc_cib', date: '2026-03-10', amount: -20_000, transferAccountId: 'acc_hsbc', transferTransactionId: 'p1' }),
      makeTxn({ accountId: 'acc_hsbc', date: '2026-03-10', amount: 20_000, transferAccountId: 'acc_cib', transferTransactionId: 'p2' }),
      // loan installment category outflow
      makeTxn({ accountId: 'acc_cib', date: '2026-03-15', amount: -15_000, categoryId: 'cat_debt' }),
    );
    const dsr = debtServiceRatio(db, '2026-03');
    expect(dsr.income).toBe(100_000);
    expect(dsr.debtPayments).toBe(35_000);
    expect(dsr.ratioBps).toBe(3500);
    expect(dsr.band).toBe('elevated'); // 35% is at the ok/elevated boundary
  });

  it('is unknown without income', () => {
    const dsr = debtServiceRatio(fixtureDb(), '2026-03');
    expect(dsr.ratioBps).toBeNull();
    expect(dsr.band).toBe('unknown');
  });
});

describe('liquidity runway (egypt-liquidity-buffer-debt-paydown.md)', () => {
  it('divides liquid cash by trailing average monthly spend', () => {
    const db = fixtureDb();
    db.transactions.push(
      makeTxn({ accountId: 'acc_cib', date: '2026-01-15', amount: 90_000, categoryId: 'cat_income' }),
      makeTxn({ accountId: 'acc_cib', date: '2026-01-20', amount: -10_000, categoryId: 'cat_groc' }),
      makeTxn({ accountId: 'acc_cib', date: '2026-02-20', amount: -10_000, categoryId: 'cat_groc' }),
      makeTxn({ accountId: 'acc_cib', date: '2026-03-20', amount: -10_000, categoryId: 'cat_groc' }),
    );
    const r = liquidityRunway(db, '2026-03');
    expect(r.liquid).toBe(60_000); // 90000 − 30000
    expect(r.avgMonthlySpend).toBe(10_000);
    expect(r.runwayTenthsOfMonth).toBe(60); // 6.0 months
  });

  it('is null without spending history', () => {
    expect(liquidityRunway(fixtureDb(), '2026-03').runwayTenthsOfMonth).toBeNull();
  });
});

describe('30/60/90 control panel (ethical-card-cashflow-strategy.md)', () => {
  it('derives each goal from live data, not constants', () => {
    const db = fixtureDb();
    db.transactions.push(
      // EGP 10,000 salary, EGP 20 cash spend, EGP 5,000 on the card (10% of the 50,000 limit)
      makeTxn({ accountId: 'acc_cib', date: '2026-03-01', amount: 10_000_000, categoryId: 'cat_income' }),
      makeTxn({ accountId: 'acc_cib', date: '2026-03-05', amount: -20_000, categoryId: 'cat_groc' }),
      makeTxn({ accountId: 'acc_hsbc', date: '2026-03-06', amount: -5_000_000, categoryId: 'cat_groc' }),
    );
    const panel = controlPanel(db, '2026-03');
    expect(panel.map((p) => p.horizonDays)).toEqual([30, 60, 90]);
    const util = panel[0]!;
    expect(util.achieved).toBe(true); // 10% utilization < 90%
    expect(util.detail).toMatch(/10%/);
    const dsr = panel[1]!;
    expect(dsr.achieved).toBe(true); // no debt payments yet
    const runway = panel[2]!;
    expect(runway.achieved).toBe(true); // ~6 months of runway
  });

  it('flags attention when data is missing', () => {
    const db = fixtureDb();
    db.accounts[1]!.creditLimit = null; // no limit on file -> utilization unknown
    const panel = controlPanel(db, '2026-03');
    // no limit, no income, no spend history -> every goal needs attention
    expect(panel.every((p) => p.achieved === false)).toBe(true);
    expect(panel[0]!.detail).toMatch(/no card limit/i);
    expect(panel[1]!.detail).toMatch(/no income/i);
    expect(panel[2]!.detail).toMatch(/no spending history/i);
  });
});
