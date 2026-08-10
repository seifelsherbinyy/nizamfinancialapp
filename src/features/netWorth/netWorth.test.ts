// @vitest-environment node
/**
 * NIZAM · Net-worth engine tests — FX conversion, the views, real value, EGP regression.
 * Owning contract: PFOS contract 01 (Constitution) section 6, contract 03 section 8.
 * Build phase: PFOS Stage 4, phase 4.2 — net-worth computation.
 */
import { describe, it, expect } from 'vitest';
import { createEmptyDb, type NizamDb } from '@/lib/db/schema';
import type { Account } from '@/features/accounts/accounts.types';
import type { Obligation } from '@/features/obligations/obligation.types';
import type { Asset, FxRate } from './netWorth.types.ts';
import { toEgp, fromEgp, convert, netWorth, realValue, realNetWorth } from './netWorth.ts';

const M = 1000;
let n = 0;
const id = (p: string) => `${p}_${++n}`;

function acct(p: Partial<Account> & Pick<Account, 'type' | 'clearedBalance'>): Account {
  return {
    id: id('acc'),
    name: 'A',
    onBudget: true,
    balance: p.clearedBalance,
    accountIdentifier: null,
    creditLimit: null,
    closed: false,
    order: 0,
    paymentCategoryId: null,
    ...p,
  };
}
function asset(p: Partial<Asset> & Pick<Asset, 'kind' | 'currency' | 'value'>): Asset {
  return {
    id: id('ast'),
    name: 'Asset',
    liquid: p.kind === 'financial',
    liquidationDiscountBps: 0,
    valuationSource: 'manual',
    valuationAsOf: '2026-01-01',
    ...p,
  };
}
// USD -> EGP at 49.25 (perUnitNum 4925 / perUnitDen 100)
const USD_EGP: FxRate = { currency: 'USD', perUnitNum: 4925, perUnitDen: 100, source: 'manual', asOf: '2026-01-01' };

describe('FX conversion (integer ratios, no float drift)', () => {
  it('converts to and from EGP', () => {
    // 100 USD = 100 * 49.25 = 4,925 EGP
    expect(toEgp(100 * M, 'USD', [USD_EGP])).toBe(4_925 * M);
    // EGP -> USD is the inverse
    expect(fromEgp(4_925 * M, 'USD', [USD_EGP])).toBe(100 * M);
    // EGP -> EGP is identity
    expect(toEgp(1_234 * M, 'EGP', [])).toBe(1_234 * M);
  });
  it('convert() routes through the EGP base', () => {
    expect(convert(100 * M, 'USD', 'EGP', [USD_EGP])).toBe(4_925 * M);
    expect(convert(100 * M, 'USD', 'USD', [USD_EGP])).toBe(100 * M);
  });
  it('throws (never silently zeroes) when a rate is missing', () => {
    expect(() => toEgp(100 * M, 'GBP', [USD_EGP])).toThrow(/no FX rate/i);
  });
});

describe('realValue (inflation deflation)', () => {
  it('deflates by whole years at the annual rate', () => {
    // 100,000 at 25%/yr for 1 year = 100,000 * 10000/12500 = 80,000
    expect(realValue(100_000 * M, 2500, 1)).toBe(80_000 * M);
    // 2 years compounded = 80,000 * 10000/12500 = 64,000
    expect(realValue(100_000 * M, 2500, 2)).toBe(64_000 * M);
  });
  it('is a no-op at zero years or zero inflation', () => {
    expect(realValue(100_000 * M, 2500, 0)).toBe(100_000 * M);
    expect(realValue(100_000 * M, 0, 5)).toBe(100_000 * M);
  });
});

describe('netWorth — EGP regression (Stage-4 additive guarantee)', () => {
  it('an all-EGP db with no assets reduces to cash − credit − obligations', () => {
    const db = createEmptyDb('2026-01-01T00:00:00.000Z');
    db.accounts.push(
      acct({ id: 'cib', type: 'CIB_DEBIT', clearedBalance: 20_000 * M }),
      acct({ id: 'hsbc', type: 'HSBC_CC', clearedBalance: -6_000 * M }),
    );
    const ob: Obligation = {
      id: 'rent', creditor: 'L', accountId: null, amountDue: 8_000 * M, minimumDue: 8_000 * M,
      dueDate: '2026-01-28', graceDate: null, frequency: 'monthly', priority: 'P0', penalty: 0,
      interestBps: 0, autopay: false, verificationSource: 'manual', confidence: 1, protectedReserve: 0,
    };
    db.obligations.push(ob);
    const nw = netWorth(db);
    // nominal = 20,000 (cash) − 6,000 (credit) − 8,000 (P0 reserve) = 6,000
    expect(nw.nominal).toBe(6_000 * M);
    // liquid = 20,000 − 6,000 = 14,000 (no liquid assets)
    expect(nw.liquid).toBe(14_000 * M);
    expect(nw.components.cash).toBe(20_000 * M);
    expect(nw.components.creditLiabilities).toBe(6_000 * M);
    expect(nw.components.obligationLiabilities).toBe(8_000 * M);
    expect(nw.unratedCurrencies).toEqual([]);
  });

  it('an empty db has zero net worth in every view', () => {
    const nw = netWorth(createEmptyDb('2026-01-01T00:00:00.000Z'));
    expect(nw.nominal).toBe(0);
    expect(nw.liquid).toBe(0);
    expect(nw.liquidation).toBe(0);
  });
});

describe('netWorth — assets, FX, liquidation, reference currency', () => {
  function assetDb(): NizamDb {
    const db = createEmptyDb('2026-01-01T00:00:00.000Z');
    db.accounts.push(acct({ id: 'cib', type: 'CIB_DEBIT', clearedBalance: 10_000 * M }));
    db.fxRates.push(USD_EGP);
    db.assets.push(
      asset({ kind: 'financial', currency: 'USD', value: 1_000 * M, liquid: true, liquidationDiscountBps: 1000 }), // 49,250 EGP
      asset({ kind: 'real', currency: 'EGP', value: 500_000 * M, liquid: false, liquidationDiscountBps: 3000 }), // property
    );
    return db;
  }

  it('values financial + real assets, converting foreign currency', () => {
    const nw = netWorth(assetDb());
    // financial USD asset = 1,000 * 49.25 = 49,250 EGP
    expect(nw.components.financialAssets).toBe(49_250 * M);
    expect(nw.components.realAssets).toBe(500_000 * M);
    // nominal = 10,000 cash + 49,250 + 500,000 = 559,250
    expect(nw.nominal).toBe(559_250 * M);
    // liquid = 10,000 cash + 49,250 liquid asset = 59,250
    expect(nw.liquid).toBe(59_250 * M);
  });

  it('applies liquidation haircuts', () => {
    const nw = netWorth(assetDb());
    // liquidation = 10,000 cash + 49,250*0.90 (44,325) + 500,000*0.70 (350,000) = 404,325
    expect(nw.liquidation).toBe((10_000 + 44_325 + 350_000) * M);
  });

  it('expresses the result in a chosen reference currency', () => {
    const nw = netWorth(assetDb(), 'USD');
    // nominal 559,250 EGP / 49.25 = 11,355.329... -> milliunits via mulRatio(559250000, 100, 4925)
    // 559,250,000 * 100 / 4925 = 11,355,329.949... -> 11,355,330 (half away from zero)
    expect(nw.referenceCurrency).toBe('USD');
    expect(nw.nominal).toBe(11_355_330);
  });

  it('flags unrated currencies instead of silently zeroing them', () => {
    const db = createEmptyDb('2026-01-01T00:00:00.000Z');
    db.assets.push(asset({ kind: 'financial', currency: 'GBP', value: 1_000 * M }));
    const nw = netWorth(db);
    expect(nw.unratedCurrencies).toEqual(['GBP']);
    expect(nw.components.financialAssets).toBe(0);
  });
});

describe('realNetWorth', () => {
  it('equals nominal when no inflation is set (regression)', () => {
    const db = createEmptyDb('2026-01-01T00:00:00.000Z');
    db.accounts.push(acct({ id: 'cib', type: 'CIB_DEBIT', clearedBalance: 100_000 * M }));
    expect(realNetWorth(db, 'EGP', 5)).toBe(100_000 * M);
  });
  it('deflates nominal by inflation over the given years', () => {
    const db = createEmptyDb('2026-01-01T00:00:00.000Z');
    db.accounts.push(acct({ id: 'cib', type: 'CIB_DEBIT', clearedBalance: 100_000 * M }));
    db.macro = { referenceCurrency: 'EGP', annualInflationBps: 2500, inflationSource: 'manual', inflationAsOf: '2026-01-01' };
    expect(realNetWorth(db, 'EGP', 1)).toBe(80_000 * M);
  });
});
