/**
 * NIZAM · tests for the FX policy module.
 * Implemented by: KIRO Contract 1 / Phase 1.4 (money core).
 * Delta authority: Contract 6 (DRAFT) section I2; IMPLEMENTATION_PLAN Step 3, phase 3.
 *
 * Every fixture here is synthetic. The rates look plausible for EGP but are invented, and no
 * real ledger, account or identifier appears.
 *
 * What these tests are for: rate selection must be a decision, not an accident. A conversion may
 * be right, or it may refuse, but it may never quietly substitute 1:1, zero, a future rate, or a
 * float.
 */
import { describe, expect, it } from 'vitest';
import {
  type RateObservation,
  convertMoney,
  describeUnconvertible,
  selectObservation,
  sumSameCurrency,
} from './fx.ts';
import { mulRatio } from './money.ts';

const M = 1000; // one EGP in milliunits

function rate(p: Partial<RateObservation> & { currency: string }): RateObservation {
  return {
    perUnitNum: 4925,
    perUnitDen: 100,
    source: 'owner-entered',
    observedAt: '2026-01-01T00:00:00Z',
    conversionVersion: 0,
    ...p,
  };
}

// 1 USD = 49.25 EGP, 1 SAR = 13.13 EGP. Invented, but the right order of magnitude.
const USD = rate({ currency: 'USD', perUnitNum: 4925, perUnitDen: 100 });
const SAR = rate({ currency: 'SAR', perUnitNum: 1313, perUnitDen: 100 });

function ok(r: ReturnType<typeof convertMoney>) {
  if (!r.ok) throw new Error(`expected a conversion, got refusal: ${describeUnconvertible(r)}`);
  return r;
}
function refused(r: ReturnType<typeof convertMoney>) {
  if (r.ok) throw new Error(`expected a refusal, got ${r.amount}`);
  return r;
}

describe('convertMoney — the four rate paths', () => {
  it('identity needs no rate at all and applies the ratio 1/1', () => {
    const r = ok(convertMoney(1_234 * M, 'EGP', 'EGP', []));
    expect(r.amount).toBe(1_234 * M);
    expect(r.provenance.rule).toBe('identity');
    expect(r.provenance.observations).toEqual([]);
    const s = ok(convertMoney(7 * M, 'USD', 'USD', []));
    expect(s.amount).toBe(7 * M);
    expect(s.provenance.rule).toBe('identity');
  });

  it('direct (X -> base) multiplies by the stored ratio', () => {
    const r = ok(convertMoney(100 * M, 'USD', 'EGP', [USD]));
    expect(r.amount).toBe(4_925 * M);
    expect(r.provenance.rule).toBe('direct');
    expect([r.provenance.num, r.provenance.den]).toEqual([4925, 100]);
  });

  it('inverse (base -> X) multiplies by the inverted ratio', () => {
    const r = ok(convertMoney(4_925 * M, 'EGP', 'USD', [USD]));
    expect(r.amount).toBe(100 * M);
    expect(r.provenance.rule).toBe('inverse');
    expect([r.provenance.num, r.provenance.den]).toEqual([100, 4925]);
  });

  it('round-trips exactly on an exact ratio', () => {
    const there = ok(convertMoney(100 * M, 'USD', 'EGP', [USD])).amount;
    const back = ok(convertMoney(there, 'EGP', 'USD', [USD])).amount;
    expect(back).toBe(100 * M);
  });
});

describe('convertMoney — cross rates round ONCE (the Step 3 repair)', () => {
  /**
   * The pre-Step-3 `convert()` was `fromEgp(toEgp(x))`, so it rounded to whole EGP milliunits in
   * the middle and then rounded again. These two cases are the evidence that the middle rounding
   * was not free.
   */
  it('two currencies on the SAME rate convert 1:1, which the old base-routed path did not', () => {
    const a = rate({ currency: 'AAA', perUnitNum: 2, perUnitDen: 3 });
    const b = rate({ currency: 'BBB', perUnitNum: 2, perUnitDen: 3 });
    // Old behaviour, reproduced here from primitives so the comparison is not hypothetical.
    const viaBase = mulRatio(mulRatio(1 * M, a.perUnitNum, a.perUnitDen), b.perUnitDen, b.perUnitNum);
    expect(viaBase).toBe(1_001); // fabricated a milliunit out of nothing

    const r = ok(convertMoney(1 * M, 'AAA', 'BBB', [a, b]));
    expect(r.amount).toBe(1 * M); // identical rates must be an identity
    expect(r.provenance.rule).toBe('cross');
    expect([r.provenance.num, r.provenance.den]).toEqual([1, 1]); // reduced, so one rounding
  });

  it('drifts from the base-routed answer on realistic rates too', () => {
    const amount = 243; // milliunits of USD
    const viaBase = mulRatio(mulRatio(amount, USD.perUnitNum, USD.perUnitDen), SAR.perUnitDen, SAR.perUnitNum);
    const direct = ok(convertMoney(amount, 'USD', 'SAR', [USD, SAR])).amount;
    expect(viaBase).toBe(912);
    expect(direct).toBe(911);
    // 4925/100 over 1313/100 reduces to 4925/1313 (13*101 shares no factor with 25*197).
    expect(ok(convertMoney(amount, 'USD', 'SAR', [USD, SAR])).provenance).toMatchObject({
      rule: 'cross',
      num: 4925,
      den: 1313,
    });
  });

  it('refuses a composed ratio it cannot hold exactly instead of approximating it', () => {
    const huge = rate({ currency: 'HUG', perUnitNum: 3_037_000_500, perUnitDen: 1 });
    const tiny = rate({ currency: 'TIN', perUnitNum: 1, perUnitDen: 3_037_000_500 });
    const r = refused(convertMoney(1 * M, 'HUG', 'TIN', [huge, tiny]));
    expect(r.reason).toBe('ratio_not_representable');
    expect(r.detail).toMatch(/invent precision/i);
  });
});

describe('convertMoney — refusals never become a number', () => {
  it('a missing rate refuses, and does not fall back to 1:1 or to zero', () => {
    const r = refused(convertMoney(100 * M, 'GBP', 'EGP', [USD]));
    expect(r.reason).toBe('no_observation');
    expect(r.currency).toBe('GBP');
    expect(r).not.toHaveProperty('amount');
    expect(describeUnconvertible(r)).toMatch(/GBP->EGP unconvertible/);
  });

  it('names the failing leg when it is the destination, not the source', () => {
    const r = refused(convertMoney(100 * M, 'EGP', 'GBP', [USD]));
    expect(r.currency).toBe('GBP');
    expect(r.from).toBe('EGP');
    expect(r.to).toBe('GBP');
  });

  it('refuses a zero or negative rate rather than inverting it', () => {
    const zero = rate({ currency: 'ZZZ', perUnitNum: 0, perUnitDen: 100 });
    expect(refused(convertMoney(1 * M, 'ZZZ', 'EGP', [zero])).reason).toBe('non_positive_rate');
    expect(refused(convertMoney(1 * M, 'EGP', 'ZZZ', [zero])).reason).toBe('non_positive_rate');
    const neg = rate({ currency: 'NEG', perUnitNum: -4925, perUnitDen: 100 });
    expect(refused(convertMoney(1 * M, 'NEG', 'EGP', [neg])).reason).toBe('non_positive_rate');
  });
});

describe('selectObservation — the date is read, and never read forward', () => {
  const jan = rate({ currency: 'USD', perUnitNum: 4900, perUnitDen: 100, observedAt: '2026-01-01T00:00:00Z' });
  const jun = rate({ currency: 'USD', perUnitNum: 5000, perUnitDen: 100, observedAt: '2026-06-01T00:00:00Z' });
  const table = [jun, jan]; // deliberately not in date order

  it('with no date requested it takes the newest, matching pre-Step-3 behaviour', () => {
    const sel = selectObservation(table, 'USD', null);
    expect(sel.ok && sel.observation.observedAt).toBe('2026-06-01T00:00:00Z');
    expect(ok(convertMoney(100 * M, 'USD', 'EGP', table)).amount).toBe(5_000 * M);
  });

  it('valuing an earlier date uses the rate of that time, not the newest one', () => {
    const sel = selectObservation(table, 'USD', '2026-03-01');
    expect(sel.ok && sel.observation.observedAt).toBe('2026-01-01T00:00:00Z');
    expect(ok(convertMoney(100 * M, 'USD', 'EGP', table, { asOf: '2026-03-01' })).amount).toBe(4_900 * M);
  });

  it('an as-of boundary date is inclusive', () => {
    expect(ok(convertMoney(100 * M, 'USD', 'EGP', table, { asOf: '2026-06-01' })).amount).toBe(5_000 * M);
    expect(ok(convertMoney(100 * M, 'USD', 'EGP', table, { asOf: '2026-05-31' })).amount).toBe(4_900 * M);
  });

  it('refuses when every observation is later than the date asked about', () => {
    const r = refused(convertMoney(100 * M, 'USD', 'EGP', table, { asOf: '2025-12-31' }));
    expect(r.reason).toBe('no_observation_at_or_before');
    expect(r.detail).toMatch(/restate history/i);
  });

  it('refuses two disagreeing observations that share the newest instant', () => {
    const a = rate({ currency: 'USD', perUnitNum: 4900, perUnitDen: 100, observedAt: '2026-06-01T00:00:00Z', source: 'bank' });
    const b = rate({ currency: 'USD', perUnitNum: 5100, perUnitDen: 100, observedAt: '2026-06-01T00:00:00Z', source: 'market' });
    const sel = selectObservation([a, b], 'USD', null);
    expect(sel.ok).toBe(false);
    expect(!sel.ok && sel.reason).toBe('ambiguous_observation');
    expect(refused(convertMoney(1 * M, 'USD', 'EGP', [a, b])).reason).toBe('ambiguous_observation');
  });

  it('accepts same-day duplicates that agree, because a duplicate is not a conflict', () => {
    const a = rate({ currency: 'USD', observedAt: '2026-06-01T00:00:00Z', source: 'bank' });
    const b = rate({ currency: 'USD', observedAt: '2026-06-01T00:00:00Z', source: 'market' });
    expect(selectObservation([a, b], 'USD', null).ok).toBe(true);
    expect(ok(convertMoney(100 * M, 'USD', 'EGP', [a, b])).amount).toBe(4_925 * M);
  });

  it('an older row is ignored even when it is listed first', () => {
    expect(selectObservation([jan, jun], 'USD', null)).toEqual(selectObservation([jun, jan], 'USD', null));
  });

  it('two observations on the same day at different times are now ordered, not ambiguous (owner decision D1, 2026-09-02)', () => {
    const morning = rate({ currency: 'USD', perUnitNum: 4900, perUnitDen: 100, observedAt: '2026-06-01T08:00:00Z', source: 'bank' });
    const evening = rate({ currency: 'USD', perUnitNum: 5100, perUnitDen: 100, observedAt: '2026-06-01T20:00:00Z', source: 'market' });
    const sel = selectObservation([morning, evening], 'USD', null);
    expect(sel.ok).toBe(true);
    expect(sel.ok && sel.observation.observedAt).toBe('2026-06-01T20:00:00Z');
    expect(ok(convertMoney(100 * M, 'USD', 'EGP', [morning, evening])).amount).toBe(5_100 * M);
  });

  it('an asOf query is date-granular regardless of the stored observation time of day', () => {
    const morning = rate({ currency: 'USD', perUnitNum: 4900, perUnitDen: 100, observedAt: '2026-06-01T08:00:00Z' });
    expect(ok(convertMoney(100 * M, 'USD', 'EGP', [morning], { asOf: '2026-06-01' })).amount).toBe(4_900 * M);
    expect(refused(convertMoney(100 * M, 'USD', 'EGP', [morning], { asOf: '2026-05-31' })).reason).toBe(
      'no_observation_at_or_before',
    );
  });
});

describe('determinism and integrality', () => {
  it('produces integers only, with no float in the path', () => {
    const third = rate({ currency: 'TRD', perUnitNum: 1, perUnitDen: 3 });
    const r = ok(convertMoney(1 * M, 'TRD', 'EGP', [third]));
    expect(r.amount).toBe(333); // 1000/3 = 333.33 -> half-away-from-zero
    expect(Number.isInteger(r.amount)).toBe(true);
  });

  it('returns the same integer on every call for the same inputs', () => {
    const results = Array.from({ length: 25 }, () => ok(convertMoney(243, 'USD', 'SAR', [USD, SAR])).amount);
    expect(new Set(results).size).toBe(1);
  });

  it('rounds symmetrically about zero', () => {
    const pos = ok(convertMoney(243, 'USD', 'SAR', [USD, SAR])).amount;
    const neg = ok(convertMoney(-243, 'USD', 'SAR', [USD, SAR])).amount;
    expect(neg).toBe(-pos);
  });

  it('rejects a non-integer input amount instead of truncating it', () => {
    expect(() => convertMoney(1.5, 'USD', 'EGP', [USD])).toThrow(/NIZAM money/);
  });
});

describe('provenance is complete enough to explain a figure', () => {
  it('carries the source, date and conversion version of every row relied on', () => {
    const r = ok(convertMoney(1 * M, 'USD', 'SAR', [USD, SAR], { asOf: '2026-02-02' }));
    expect(r.provenance.asOfRequested).toBe('2026-02-02');
    expect(r.provenance.observations.map((o) => o.currency)).toEqual(['USD', 'SAR']);
    expect(r.provenance.observations[0]).toMatchObject({
      source: 'owner-entered',
      observedAt: '2026-01-01T00:00:00Z',
      conversionVersion: 0,
    });
  });

  it('the recorded ratio is the one actually applied', () => {
    const r = ok(convertMoney(37 * M, 'USD', 'SAR', [USD, SAR]));
    expect(mulRatio(37 * M, r.provenance.num, r.provenance.den)).toBe(r.amount);
  });
});

describe('sumSameCurrency — a mixed total is not a quantity', () => {
  it('adds same-currency amounts exactly', () => {
    const t = sumSameCurrency([
      { amount: 1_500, currency: 'USD' },
      { amount: 2_500, currency: 'USD' },
      { amount: -1_000, currency: 'USD' },
    ]);
    expect(t).toEqual({ amount: 3_000, currency: 'USD' });
  });

  it('throws rather than adding two currencies together', () => {
    expect(() =>
      sumSameCurrency([
        { amount: 1_000, currency: 'EGP' },
        { amount: 1_000, currency: 'USD' },
      ]),
    ).toThrow(/refusing to add EGP \+ USD/);
  });

  it('throws when the entries are not the currency the caller expected', () => {
    expect(() => sumSameCurrency([{ amount: 1_000, currency: 'USD' }], 'EGP')).toThrow(/refusing to add/);
  });

  it('refuses to invent a currency for an empty total', () => {
    expect(() => sumSameCurrency([])).toThrow(/empty sum has no currency/);
    expect(sumSameCurrency([], 'EGP')).toEqual({ amount: 0, currency: 'EGP' });
  });
});
