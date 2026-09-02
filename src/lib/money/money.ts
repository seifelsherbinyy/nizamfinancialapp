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
 * Why a strict form exists beside `fromDecimal` — spec 08 wave A2, task A2.3.
 *
 * `fromDecimal` is deliberately forgiving: it strips grouping separators and rounds the fourth
 * fractional digit half away from zero. That is right for text a person typed or pasted, where the
 * alternative is refusing a value the person clearly meant.
 *
 * It is wrong at a MACHINE boundary. There, a stray separator means the upstream export changed format,
 * and a fourth decimal place means the artifact carries more precision than a milliunit can hold — and a
 * rounded amount is indistinguishable from a measured one once it is stored. So the ingestion boundary
 * needs a form that refuses exactly what the forgiving one absorbs, and it needs it HERE rather than
 * beside its caller, because there is one implementation of money in this system and a second copy of
 * the digit-by-digit conversion is the thing that would eventually disagree with this one.
 *
 * Added by: KIRO Contract 1 / Phase 1.4, extended for PFOS Contract 06 / Phase 2.2.
 */
export type StrictMoneyRefusalCode =
  | 'GROUPING_SEPARATOR'
  | 'NOT_A_NUMBER'
  | 'PRECISION_WOULD_ROUND'
  | 'FRACTION_OF_A_MILLIUNIT'
  | 'OUT_OF_SAFE_RANGE';

/** A refusal carrying its code. Never the offending value, so a message can be logged safely. */
export class StrictMoneyError extends TypeError {
  readonly code: StrictMoneyRefusalCode;

  constructor(code: StrictMoneyRefusalCode, message: string) {
    super(message);
    this.name = 'StrictMoneyError';
    this.code = code;
  }
}

const STRICT_DECIMAL_RE = /^[+-]?\d+(?:\.\d+)?$/;
const STRICT_GROUPING_RE = /[,\s\u00A0\u066B\u066C]/;

/**
 * Parse decimal MAJOR-UNIT text into integer milliunits, refusing anything that would be absorbed.
 * At most three fractional digits, no grouping separator, nothing but digits and one optional sign.
 */
export function fromDecimalStrict(text: string): Money {
  const v = text.trim();
  if (STRICT_GROUPING_RE.test(v)) {
    throw new StrictMoneyError(
      'GROUPING_SEPARATOR',
      'NIZAM money: a grouping separator is stripped by the forgiving parser, so at a machine boundary it is refused instead — a separator that appeared means the upstream format changed.',
    );
  }
  if (!STRICT_DECIMAL_RE.test(v)) {
    throw new StrictMoneyError('NOT_A_NUMBER', 'NIZAM money: the value is not a plain decimal number.');
  }
  const dot = v.indexOf('.');
  const fractionDigits = dot < 0 ? 0 : v.length - dot - 1;
  if (fractionDigits > 3) {
    throw new StrictMoneyError(
      'PRECISION_WOULD_ROUND',
      `NIZAM money: the value carries ${fractionDigits} fractional digits and a milliunit holds three, so converting it would round. A rounded amount is indistinguishable from a measured one once stored.`,
    );
  }
  try {
    return fromDecimal(v);
  } catch {
    throw new StrictMoneyError('OUT_OF_SAFE_RANGE', 'NIZAM money: the value cannot be held as safe integer milliunits.');
  }
}

/** Parse text that is ALREADY milliunits. A fractional part is refused: there is no such quantity. */
export function fromMilliunitsStrict(text: string): Money {
  const v = text.trim();
  if (STRICT_GROUPING_RE.test(v)) {
    throw new StrictMoneyError('GROUPING_SEPARATOR', 'NIZAM money: a grouping separator is refused at a machine boundary.');
  }
  if (!STRICT_DECIMAL_RE.test(v)) {
    throw new StrictMoneyError('NOT_A_NUMBER', 'NIZAM money: the value is not a plain integer.');
  }
  if (v.includes('.')) {
    throw new StrictMoneyError(
      'FRACTION_OF_A_MILLIUNIT',
      'NIZAM money: the value is declared in milliunits and carries a fractional part. A fraction of a milliunit is not a quantity this system holds, so it is refused rather than truncated.',
    );
  }
  const n = Number(v);
  if (!Number.isSafeInteger(n)) {
    throw new StrictMoneyError('OUT_OF_SAFE_RANGE', 'NIZAM money: the value is outside the safe integer range.');
  }
  return n;
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

/**
 * Exact ceiling division of a NON-NEGATIVE money amount by a positive integer
 * divisor. BigInt intermediate, so the result never depends on float rounding.
 *
 * Why this exists: scheduling a target ("fund 90000 over 4 months") needs the
 * smallest integer per-period amount whose repetition reaches the total. The
 * obvious `Math.ceil(a / den)` is a float divide on money, which money-rules
 * rule 1 forbids, and it can round a mathematically-exact quotient up by one
 * near the safe-integer ceiling. Negative amounts are rejected rather than
 * given a sign convention nobody asked for.
 */
export function divCeil(a: Money, den: number): Money {
  assertMoney(a);
  if (a < 0) {
    throw new TypeError(`NIZAM money: divCeil needs a non-negative amount, got ${a}`);
  }
  if (!Number.isSafeInteger(den) || den <= 0) {
    throw new TypeError(`NIZAM money: divCeil needs a positive integer divisor, got ${den}`);
  }
  const n = BigInt(a);
  const d = BigInt(den);
  const q = n / d;
  return assertMoney(Number(n % d === 0n ? q : q + 1n), 'divCeil result');
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
