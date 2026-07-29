/**
 * NIZAM · money core tests
 * Implemented by: KIRO Contract 1 / Phase 1.5
 */
import { describe, it, expect } from 'vitest';
import {
  MILLI,
  fromDecimal,
  fromNumber,
  toDecimal,
  add,
  sub,
  mul,
  mulRatio,
  sum,
  negate,
  abs,
  cmp,
  allocate,
  format,
  formatEGP,
  isMoney,
  assertMoney,
} from './money';

describe('fromDecimal / toDecimal round-trip', () => {
  it('parses whole pounds', () => {
    expect(fromDecimal('1')).toBe(1000);
    expect(fromDecimal('250')).toBe(250 * MILLI);
  });

  it('parses piastres and milliunits', () => {
    expect(fromDecimal('0.01')).toBe(10);
    expect(fromDecimal('0.005')).toBe(5);
    expect(fromDecimal('12.34')).toBe(12340);
    expect(fromDecimal('12.345')).toBe(12345);
  });

  it('rounds the 4th fractional digit half away from zero', () => {
    expect(fromDecimal('0.0004')).toBe(0);
    expect(fromDecimal('0.0005')).toBe(1);
    expect(fromDecimal('-0.0005')).toBe(-1);
    expect(fromDecimal('1.99999')).toBe(2000);
  });

  it('handles negatives and explicit plus', () => {
    expect(fromDecimal('-12.34')).toBe(-12340);
    expect(fromDecimal('+12.34')).toBe(12340);
    expect(fromDecimal('-0.5')).toBe(-500);
  });

  it('accepts thousands separators', () => {
    expect(fromDecimal('1,234.56')).toBe(1_234_560);
    expect(fromDecimal('1 234.56')).toBe(1_234_560);
  });

  it('rejects garbage', () => {
    expect(() => fromDecimal('abc')).toThrow();
    expect(() => fromDecimal('')).toThrow();
    expect(() => fromDecimal('1.2.3')).toThrow();
  });

  it('round-trips exactly', () => {
    const cases = ['0.000', '0.001', '1.000', '12.345', '999999.999'];
    for (const c of cases) {
      expect(toDecimal(fromDecimal(c))).toBe(c);
    }
    // negative round-trip
    expect(toDecimal(fromDecimal('-12.345'))).toBe('-12.345');
    expect(toDecimal(-500)).toBe('-0.500');
  });

  it('fromNumber goes through decimal text (no float drift)', () => {
    expect(fromNumber(0.1)).toBe(100);
    expect(fromNumber(1.005)).toBe(1005);
    expect(fromNumber(-2.5)).toBe(-2500);
  });
});

describe('integer arithmetic — no float drift', () => {
  it('0.1 added ten times equals exactly 1.0', () => {
    const tenth = fromDecimal('0.1');
    let total = 0;
    for (let i = 0; i < 10; i++) total = add(total, tenth);
    expect(total).toBe(fromDecimal('1.0'));
    expect(toDecimal(total)).toBe('1.000');
  });

  it('add/sub/negate/abs/cmp behave on integers', () => {
    expect(add(1500, -2000)).toBe(-500);
    expect(sub(1500, 2000)).toBe(-500);
    expect(negate(-500)).toBe(500);
    expect(abs(-500)).toBe(500);
    expect(cmp(-1, 1)).toBe(-1);
    expect(cmp(5, 5)).toBe(0);
  });

  it('mul requires an integer factor', () => {
    expect(mul(1234, 3)).toBe(3702);
    expect(() => mul(1234, 1.5)).toThrow();
  });

  it('mulRatio applies rates with half-away rounding', () => {
    // 14% of 10.000 EGP = 1.400 EGP
    expect(mulRatio(10_000, 14, 100)).toBe(1400);
    // 1 milliunit * 1/2 -> 0.5 rounds to 1
    expect(mulRatio(1, 1, 2)).toBe(1);
    expect(mulRatio(-1, 1, 2)).toBe(-1);
    // exact division stays exact
    expect(mulRatio(9000, 1, 3)).toBe(3000);
  });

  it('sum totals a list exactly', () => {
    expect(sum([100, 200, -50])).toBe(250);
    expect(sum([])).toBe(0);
  });

  it('rejects non-integer money', () => {
    expect(() => add(1.5, 1)).toThrow();
    expect(() => assertMoney(0.1)).toThrow();
    expect(isMoney(10)).toBe(true);
    expect(isMoney(0.5)).toBe(false);
  });
});

describe('allocate — sums exactly, deterministic', () => {
  it('splits evenly when divisible', () => {
    expect(allocate(9000, [1, 1, 1])).toEqual([3000, 3000, 3000]);
  });

  it('distributes remainder deterministically (largest remainder, lowest index ties)', () => {
    // 100 milliunits over 3 equal weights: 34/33/33 with remainder to lowest index
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    // weights change the shares
    expect(allocate(100, [2, 1, 1])).toEqual([50, 25, 25]);
  });

  it('always sums exactly to total (sweep)', () => {
    const weightSets = [
      [1, 1, 1],
      [3, 2, 1],
      [7, 13, 3, 11],
      [1, 0, 2],
      [999, 1],
    ];
    for (let total = -2500; total <= 2500; total += 7) {
      for (const weights of weightSets) {
        const parts = allocate(total, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        for (const p of parts) expect(Number.isSafeInteger(p)).toBe(true);
      }
    }
  });

  it('handles negative totals', () => {
    const parts = allocate(-100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-100);
  });

  it('zero-weight slots get nothing', () => {
    expect(allocate(1000, [0, 1])).toEqual([0, 1000]);
  });

  it('rejects invalid weights', () => {
    expect(() => allocate(100, [])).toThrow();
    expect(() => allocate(100, [0, 0])).toThrow();
    expect(() => allocate(100, [-1, 2])).toThrow();
    expect(() => allocate(100, [1.5, 1])).toThrow();
  });

  it('is deterministic across calls', () => {
    const a = allocate(101, [1, 1, 1]);
    const b = allocate(101, [1, 1, 1]);
    expect(a).toEqual(b);
  });
});

describe('format — display only', () => {
  it('formats EGP with 2 decimals (en)', () => {
    const out = formatEGP(fromDecimal('1234.56'));
    expect(out).toContain('1,234.56');
  });

  it('rounds display half away from zero at the milliunit level', () => {
    // 12.345 EGP -> 12.35 on screen (integer pre-round prevents float boundary bugs)
    expect(formatEGP(12_345)).toContain('12.35');
    expect(formatEGP(12_344)).toContain('12.34');
    expect(formatEGP(-12_345)).toContain('12.35');
  });

  it('formats in ar-EG locale', () => {
    const out = format(1_000, { locale: 'ar-EG' });
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});
