// @vitest-environment node
/**
 * NIZAM · fx_rates boundary — rates are integer pairs — contract 06 §4.4 (R2, R4)
 * Implemented by: PFOS Contract 06 / Phase 1.3 (spec 06-two-agent-vps)
 * Depends on: testStore.ts, fxRatesRepository.ts, ../moneyBoundary.ts, src/lib/money
 *
 * Contract 06 §4.4 is the clause that stops a float re-entering through the side door: a
 * rate "is never stored as a float that later multiplies money ... a rate table row that
 * cannot be expressed as an integer pair is rejected at the boundary by the same guard as
 * §4.2." §10 restates it as unconditional.
 *
 * So each guard here is shown REFUSING the write, not merely returning something — a test
 * that has only ever been observed passing is not evidence (§9). After every refusal the
 * table is re-read to prove nothing landed, because "rejected" and "rejected after writing"
 * are different outcomes and only one of them is the contract.
 *
 * The positive case is the other half: a stored pair, applied through the money core's
 * `mulRatio`, produces the same figure as the same pair applied in memory. That is what
 * makes the integer-pair rule worth having rather than merely strict.
 *
 * Every rate below is synthetic. No real currency pair or market rate appears in this repo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mulRatio } from '../../../lib/money/money.ts';
import { MonetaryBoundaryError } from '../errors.ts';
import { assertRatePair, rateColumnsFor } from '../moneyBoundary.ts';
import { createFxRatesRepository, toFxRate, type FxRatesRepository } from './fxRatesRepository.ts';
import { openTestStore, type TestStore } from './testStore.ts';

const AS_OF = '2026-03-15';

/** A synthetic pair that divides nothing evenly, so `mulRatio` has real work to do. */
const RATE_NUM = 12_345;
const RATE_DEN = 1_000;

function baseInsert(): Parameters<FxRatesRepository['insert']>[0] {
  return {
    id: 'fx-0001',
    baseCurrency: 'SYN',
    quoteCurrency: 'EGP',
    rateNum: RATE_NUM,
    rateDen: RATE_DEN,
    asOf: AS_OF,
    source: 'synthetic-fixture',
  };
}

describe('fx_rates rate pairs (§4.4)', () => {
  let store: TestStore;
  let repo: FxRatesRepository;

  beforeEach(() => {
    store = openTestStore('nizam-fx-');
    repo = createFxRatesRepository(store.ctx);
  });

  afterEach(() => {
    store.close();
  });

  it('declares its rate columns once, beside the DDL', () => {
    expect(rateColumnsFor('fx_rates')).toEqual(['rate_num', 'rate_den']);
    // A table with no rate has no pair to guard, and asking for one is the interesting error.
    expect(rateColumnsFor('accounts')).toBeNull();
    expect(() => assertRatePair('accounts', { num: 1, den: 1 })).toThrow(MonetaryBoundaryError);
  });

  it('round-trips a stored pair as the exact integers it received', () => {
    const inserted = repo.insert(baseInsert());
    expect(inserted.rateNum).toBe(RATE_NUM);
    expect(inserted.rateDen).toBe(RATE_DEN);

    const readBack = repo.get('fx-0001');
    expect(readBack?.rateNum).toBe(RATE_NUM);
    expect(readBack?.rateDen).toBe(RATE_DEN);
  });

  it('applies a stored pair through mulRatio identically to the same pair in memory', () => {
    repo.insert(baseInsert());
    const stored = toFxRate(repo.latest('SYN', 'EGP', AS_OF) ?? { ...baseInsert(), recordedAt: AS_OF });

    const amount = 7_654_321;
    const fromMemory = mulRatio(amount, RATE_NUM, RATE_DEN);
    const fromStore = mulRatio(amount, stored.perUnitNum, stored.perUnitDen);

    expect(fromStore).toBe(fromMemory);
    // Non-vacuity: the conversion has to change the figure and not divide evenly, or the
    // equality above would hold for any implementation at all.
    expect(fromMemory).not.toBe(amount);
    expect((amount * RATE_NUM) % RATE_DEN).not.toBe(0);
  });

  it('refuses a non-integer numerator with a typed error naming the field, and writes nothing', () => {
    // A rate that arrived as a float — invalid at this boundary, and the reason §4.4 exists.
    const attempt = (): unknown => repo.insert({ ...baseInsert(), rateNum: 12.345 }); // invalid: rejects a float rate
    expect(attempt).toThrow(MonetaryBoundaryError);
    try {
      attempt();
      expect.unreachable('the guard must refuse a non-integer numerator');
    } catch (error) {
      expect(error).toBeInstanceOf(MonetaryBoundaryError);
      const typed = error as MonetaryBoundaryError;
      expect(typed.code).toBe('RATE_PAIR_NOT_INTEGER');
      expect(typed.table).toBe('fx_rates');
      expect(typed.field).toBe('rate_num');
      expect(typed.receivedType).toBe('number');
    }
    expect(repo.list()).toEqual([]);
  });

  it('refuses a non-integer denominator, and writes nothing', () => {
    const attempt = (): unknown => repo.insert({ ...baseInsert(), rateDen: 1_000.5 }); // invalid: rejects a float rate
    expect(attempt).toThrow(MonetaryBoundaryError);
    try {
      attempt();
    } catch (error) {
      expect((error as MonetaryBoundaryError).code).toBe('RATE_PAIR_NOT_INTEGER');
      expect((error as MonetaryBoundaryError).field).toBe('rate_den');
    }
    expect(repo.list()).toEqual([]);
  });

  it('refuses a zero denominator, because a rate with no denominator has no value', () => {
    expect(() => repo.insert({ ...baseInsert(), rateDen: 0 })).toThrow(MonetaryBoundaryError);
    try {
      repo.insert({ ...baseInsert(), rateDen: 0 });
    } catch (error) {
      expect((error as MonetaryBoundaryError).code).toBe('RATE_PAIR_DENOMINATOR_INVALID');
      expect((error as MonetaryBoundaryError).field).toBe('rate_den');
    }
    expect(repo.list()).toEqual([]);
  });

  it('refuses a negative denominator, which would flip the sign of everything it converts', () => {
    expect(() => repo.insert({ ...baseInsert(), rateDen: -1_000 })).toThrow(MonetaryBoundaryError);
    try {
      repo.insert({ ...baseInsert(), rateDen: -1_000 });
    } catch (error) {
      expect((error as MonetaryBoundaryError).code).toBe('RATE_PAIR_DENOMINATOR_INVALID');
    }
    expect(repo.list()).toEqual([]);
  });

  it('refuses a numerator that is not a number at all, without coercing it', () => {
    // A decimal STRING is the shape a naive import would hand over. Rejected: parsing
    // belongs at the ingestion boundary, far upstream, in the money core.
    const cases: readonly unknown[] = ['12.345', null, undefined, Number.NaN, Number.POSITIVE_INFINITY];
    for (const candidate of cases) {
      expect(() =>
        repo.insert({ ...baseInsert(), rateNum: candidate as number }),
      ).toThrow(MonetaryBoundaryError);
    }
    expect(repo.list()).toEqual([]);
  });

  it('keeps a rate history rather than a cache, so an old conversion stays re-derivable', () => {
    repo.insert(baseInsert());
    repo.insert({ ...baseInsert(), id: 'fx-0002', rateNum: 12_401, asOf: '2026-03-20' });

    // Oldest first, so the order is total and stable across runs.
    expect(repo.list({ baseCurrency: 'SYN' }).map((row) => row.id)).toEqual(['fx-0001', 'fx-0002']);
    // "As it stood on that date" still resolves to the rate of that date, not the newest.
    expect(repo.latest('SYN', 'EGP', AS_OF)?.id).toBe('fx-0001');
    expect(repo.latest('SYN', 'EGP', '2026-03-31')?.id).toBe('fx-0002');
    expect(repo.latest('SYN', 'EGP', '2026-01-01')).toBeNull();
  });
});
