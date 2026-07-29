/**
 * NIZAM · Integer money core — milliunits, no floats (1 EGP = 1000; 1 piastre = 10)
 * Implemented by: KIRO Contract 1 / Phase 1.4
 * Depends on: none
 *
 * INVARIANTS (see .kiro/steering/money-rules.md):
 *  - Money is an integer count of milliunits. NEVER a float.
 *  - Decimal text is parsed digit-by-digit at the boundary (no parseFloat).
 *  - allocate(total, weights) sums EXACTLY to total (largest-remainder, deterministic).
 *  - Formatting converts integer -> string for display only.
 */

/** Integer milliunits. 1 EGP = 1000 milliunits. */
export type Money = number;

/** Milliunits per major currency unit (EGP). */
export const MILLI = 1000;

export const ZERO: Money = 0;

/** True when the value is a safe integer (a valid Money). */
export function isMoney(value: unknown): value is Money {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Throws if the value is not a valid integer Money. */
export function assertMoney(value: number, label = 'money'): Money {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`NIZAM money: ${label} must be a safe integer of milliunits, got ${value}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Boundary parsing / serialization (no float arithmetic)
// ---------------------------------------------------------------------------

const DECIMAL_RE = /^([+-]?)(\d+)(?:[.](\d*))?$/;

/**
 * Parse a decimal string (e.g. "12.34", "-0.005", "1,234.5") into integer milliunits.
 * Digit-by-digit — no floating point. The 4th+ fractional digit rounds half away from zero.
 */
export function fromDecimal(text: string): Money {
  const cleaned = text.trim().replace(/[,\s\u00A0\u066C]/g, '').replace(/\u066B/g, '.');
  const m = DECIMAL_RE.exec(cleaned);
  if (!m) throw new TypeError(`NIZAM money: cannot parse decimal "${text}"`);
  const sign = m[1] === '-' ? -1 : 1;
  const intPart = m[2] ?? '0';
  const fracRaw = m[3] ?? '';
  const frac3 = (fracRaw + '000').slice(0, 3);
  // Round on the 4th fractional digit, half away from zero.
  const roundUp = fracRaw.length > 3 && (fracRaw.charCodeAt(3) - 48) >= 5 ? 1 : 0;
  const magnitude = BigInt(intPart) * BigInt(MILLI) + BigInt(frac3) + BigInt(roundUp);
  const result = sign === -1 ? -magnitude : magnitude;
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`NIZAM money: "${text}" exceeds safe integer range`);
  }
  return Number(result);
}

/**
 * Convert a (possibly fractional) JS number into Money via its string form.
 * Use only at external boundaries (e.g. JSON that was written with unit amounts).
 */
export function fromNumber(value: number): Money {
  if (!Number.isFinite(value)) throw new TypeError(`NIZAM money: non-finite number ${value}`);
  return fromDecimal(String(value));
}

/** Exact decimal string of a Money value, e.g. 12345 -> "12.345", -500 -> "-0.500". */
export function toDecimal(money: Money): string {
  assertMoney(money);
  const neg = money < 0;
  const abs = Math.abs(money);
  const units = Math.floor(abs / MILLI);
  const frac = String(abs % MILLI).padStart(3, '0');
  return `${neg ? '-' : ''}${units}.${frac}`;
}

// ---------------------------------------------------------------------------
// Arithmetic (integer-only)
// ---------------------------------------------------------------------------

export function add(a: Money, b: Money): Money {
  return assertMoney(assertMoney(a) + assertMoney(b), 'add result');
}

export function sub(a: Money, b: Money): Money {
  return assertMoney(assertMoney(a) - assertMoney(b), 'sub result');
}

export function negate(a: Money): Money {
  return -assertMoney(a);
}

export function abs(a: Money): Money {
  return Math.abs(assertMoney(a));
}

/** Multiply by an integer scalar (exact). */
export function mul(a: Money, k: number): Money {
  assertMoney(a);
  if (!Number.isSafeInteger(k)) {
    throw new TypeError(`NIZAM money: mul factor must be an integer, got ${k}`);
  }
  return assertMoney(a * k, 'mul result');
}

/**
 * Multiply by a rational num/den with half-away-from-zero rounding.
 * BigInt intermediate — no float drift. Use for rates (e.g. 14% = mulRatio(m, 14, 100)).
 */
export function mulRatio(a: Money, num: number, den: number): Money {
  assertMoney(a);
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den === 0) {
    throw new TypeError(`NIZAM money: mulRatio needs integer num/den (den != 0), got ${num}/${den}`);
  }
  const product = BigInt(a) * BigInt(num);
  const d = BigInt(den);
  const q = product / d;
  const r = product % d;
  const negRes = (product < 0n) !== (d < 0n);
  const absR2 = (r < 0n ? -r : r) * 2n;
  const absD = d < 0n ? -d : d;
  const bump = absR2 >= absD ? (negRes ? -1n : 1n) : 0n;
  return assertMoney(Number(q + bump), 'mulRatio result');
}

export function sum(values: readonly Money[]): Money {
  let total = 0;
  for (const v of values) total += assertMoney(v);
  return assertMoney(total, 'sum result');
}

export function cmp(a: Money, b: Money): -1 | 0 | 1 {
  assertMoney(a);
  assertMoney(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export const min = (a: Money, b: Money): Money => (cmp(a, b) <= 0 ? a : b);
export const max = (a: Money, b: Money): Money => (cmp(a, b) >= 0 ? a : b);

// ---------------------------------------------------------------------------
// Allocation (drift-free split)
// ---------------------------------------------------------------------------

/**
 * Split `total` across `weights` so the parts sum EXACTLY to `total`.
 * Largest-remainder method; ties broken deterministically by lowest index.
 * Weights must be non-negative integers with a positive sum.
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  assertMoney(total);
  if (weights.length === 0) throw new TypeError('NIZAM money: allocate needs at least one weight');
  let weightSum = 0n;
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new TypeError(`NIZAM money: weights must be non-negative integers, got ${w}`);
    }
    weightSum += BigInt(w);
  }
  if (weightSum === 0n) throw new TypeError('NIZAM money: weights must not all be zero');

  const totalBig = BigInt(total);
  const shares: Money[] = new Array(weights.length);
  const remainders: { index: number; remainder: bigint }[] = [];
  let assigned = 0n;

  for (let i = 0; i < weights.length; i++) {
    const numerator = totalBig * BigInt(weights[i] ?? 0);
    // Floor division toward negative infinity keeps remainders in [0, weightSum).
    let q = numerator / weightSum;
    let r = numerator % weightSum;
    if (r < 0n) {
      q -= 1n;
      r += weightSum;
    }
    shares[i] = Number(q);
    assigned += q;
    remainders.push({ index: i, remainder: r });
  }

  let leftover = totalBig - assigned; // 0 <= leftover < weights.length
  remainders.sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let i = 0; leftover > 0n && i < remainders.length; i++) {
    const slot = remainders[i];
    if (slot === undefined) break;
    shares[slot.index] = (shares[slot.index] ?? 0) + 1;
    leftover -= 1n;
  }

  for (const s of shares) assertMoney(s, 'allocate share');
  return shares;
}

// ---------------------------------------------------------------------------
// Display formatting (integer -> string only)
// ---------------------------------------------------------------------------

export type MoneyLocale = 'en' | 'ar-EG';

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(locale: MoneyLocale, currency: string): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale === 'en' ? 'en-EG' : 'ar-EG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatterCache.set(key, f);
  }
  return f;
}

/**
 * Format milliunits as a currency string (2 display decimals).
 * Milliunits are first rounded to piastre-hundredths (integer, half away from zero),
 * so the float handed to Intl is never near a rounding boundary.
 */
export function format(money: Money, opts?: { locale?: MoneyLocale; currency?: string }): string {
  assertMoney(money);
  const locale = opts?.locale ?? 'en';
  const currency = opts?.currency ?? 'EGP';
  const sign = money < 0 ? -1 : 1;
  const absVal = Math.abs(money);
  // Round milliunits -> hundredths of a unit (10 milliunits each), half away from zero.
  const hundredths = Math.floor(absVal / 10) + ((absVal % 10) >= 5 ? 1 : 0);
  const display = (sign * hundredths) / 100;
  return getFormatter(locale, currency).format(display);
}

/** Convenience: format EGP in the default 'en' locale. */
export function formatEGP(money: Money): string {
  return format(money, { locale: 'en', currency: 'EGP' });
}
