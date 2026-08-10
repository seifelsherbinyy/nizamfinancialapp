/**
 * NIZAM · The money persistence boundary guard — contract 06 §4.2, §4.4 (R2, R4)
 * Implemented by: PFOS Contract 06 / Phase 1.2, extended in Phase 1.3 (spec 06-two-agent-vps)
 * Depends on: errors.ts, schema.ts, src/lib/money/money.ts
 *
 * A monetary value crosses into `finance.db` through exactly one guard, and this module is
 * it. Contract 06 §4.2 states the guard's three obligations; each is a line of code here
 * rather than a convention to remember:
 *
 *  1. It rejects any value that is not a safe integer.
 *  2. It throws a TYPED error carrying the offending field's NAME and the received value —
 *     never a boolean, never a silent coercion, never a rounded write.
 *  3. It is applied in the repository layer BEFORE the statement is prepared, so a rejected
 *     value never reaches SQLite. Every write in `repositories/` guards first and prepares
 *     second; that ordering is what makes "writes nothing" true rather than hopeful.
 *
 * Rounding, truncation, and helpful coercion are all forbidden here. A non-integer arriving
 * at the persistence layer means an upstream parse was wrong, and the correct outcome is a
 * loud failure at the point of the error rather than a plausible-looking number in the
 * ledger. Decimal text is parsed to integer milliunits far upstream by the money core; this
 * guard is the second belt, not the first.
 *
 * Contract 06 §4.3 (INVARIANT): the predicate is the money core's own `isMoney`. This module
 * defines no arithmetic, no parsing, and no formatting of its own — there is one
 * implementation of money in this system and it lives in `src/lib/money/`. The import is
 * relative rather than aliased because this tier is resolved by the runtime, not a bundler.
 *
 * The guarded column set is derived from `MONETARY_COLUMNS`, which the DDL module declares
 * alongside the tables themselves. Maintaining the set twice is how a new monetary column
 * silently escapes a guard, so it is maintained once and read from here.
 */
import { isMoney, type Money } from '../../lib/money/money.ts';
import { MonetaryBoundaryError } from './errors.ts';
import { MONETARY_COLUMNS, RATE_COLUMNS } from './schema.ts';

/** The monetary columns of one table, per the DDL. Empty for a table that holds no money. */
export function monetaryColumnsFor(table: string): readonly string[] {
  return MONETARY_COLUMNS[table] ?? [];
}

/** True when `column` is declared monetary for `table` by the DDL. */
export function isMonetaryColumn(table: string, column: string): boolean {
  return monetaryColumnsFor(table).includes(column);
}

/**
 * Refuse a field that the DDL does not declare monetary for this table. Guarding a column
 * that is not money means the caller and the schema disagree about what the column holds,
 * and the disagreement is more interesting than the value.
 */
function assertGuardedColumn(table: string, field: string, received: unknown): void {
  if (!isMonetaryColumn(table, field)) {
    throw new MonetaryBoundaryError(
      'MONETARY_COLUMN_UNKNOWN',
      `NIZAM store: ${table}.${field} is not a monetary column of ${table}. The guarded set is declared once, beside the DDL, and is ${formatColumnList(table)}.`,
      { table, field, received },
    );
  }
}

/**
 * Assert one REQUIRED monetary value and return it narrowed to `Money`, so the caller binds
 * the guarded value rather than the candidate it started with.
 *
 * `null` and `undefined` fail here on purpose: a required monetary column with no value is a
 * missing amount, not a zero. Use `assertOptionalMoneyField` where the DDL allows NULL.
 */
export function assertMoneyField(table: string, field: string, value: unknown): Money {
  assertGuardedColumn(table, field, value);
  if (!isMoney(value)) {
    throw new MonetaryBoundaryError(
      'MONETARY_VALUE_NOT_INTEGER',
      `NIZAM store: ${table}.${field} must be an integer number of milliunits; refusing to persist ${String(value)} (${value === null ? 'null' : typeof value}). Nothing is rounded, truncated, or coerced at this boundary.`,
      { table, field, received: value },
    );
  }
  return value;
}

/**
 * Assert one NULLABLE monetary value. `null` and `undefined` both mean "no value" and pass
 * through as `null`; anything else must be a safe integer. A non-integer is still refused —
 * nullability is not permission to be approximate.
 */
export function assertOptionalMoneyField(table: string, field: string, value: unknown): Money | null {
  assertGuardedColumn(table, field, value);
  if (value === null || value === undefined) return null;
  return assertMoneyField(table, field, value);
}

/**
 * The drift guard, in both directions. `fields` is the set of monetary columns a write path
 * accounts for; this asserts it is exactly the set the DDL declares for the table.
 *
 * Forwards: a column the DDL does not call monetary is refused. Backwards — the half that
 * matters more — a monetary column the DDL DOES declare and the write path does not mention
 * is refused, so adding a monetary column in a migration cannot leave an existing insert
 * quietly unaccounted for.
 */
export function assertMonetaryCoverage(table: string, fields: readonly string[]): void {
  for (const field of fields) assertGuardedColumn(table, field, undefined);
  for (const column of monetaryColumnsFor(table)) {
    if (!fields.includes(column)) {
      throw new MonetaryBoundaryError(
        'MONETARY_COLUMN_MISSING',
        `NIZAM store: ${table}.${column} is a monetary column of ${table} and this write path does not account for it. Pass an explicit null where the column is nullable; an omitted amount is never read as zero.`,
        { table, field: column, received: undefined },
      );
    }
  }
}

function formatColumnList(table: string): string {
  const columns = monetaryColumnsFor(table);
  return columns.length > 0 ? columns.join(', ') : '(none)';
}

// ---------------------------------------------------------------------------
// §4.4 — rates and ratios cross the SAME boundary
// Added by: PFOS Contract 06 / Phase 1.3.
// ---------------------------------------------------------------------------

/**
 * A rate as the store holds it: an integer numerator over a positive integer denominator,
 * applied to money only through the money core's `mulRatio`, which keeps an exact
 * intermediate. There is no float form of a rate anywhere in this tier.
 */
export interface RatePair {
  readonly num: number;
  readonly den: number;
}

/** The `[numerator, denominator]` pair of a rate-bearing table, or null when it has none. */
export function rateColumnsFor(table: string): readonly [string, string] | null {
  return RATE_COLUMNS[table] ?? null;
}

/**
 * Assert one rate as an integer pair and return it, so the caller binds the guarded pair
 * rather than the candidate it started with.
 *
 * Contract 06 §4.4: "a rate, a percentage, or an exchange rate is never stored as a float
 * that later multiplies money ... a rate table row that cannot be expressed as an integer
 * pair is rejected at the boundary by the same guard as §4.2." So this is deliberately the
 * same guard: the same integer predicate from the money core, the same typed error carrying
 * the offending field's name, the same refusal to round or coerce, and the same position on
 * the write path — before the statement is prepared.
 *
 * A rate is not money, so it is not narrowed to `Money`; it is the pair `mulRatio` takes.
 * The denominator must additionally be positive, which is also the DDL's own CHECK: a zero
 * denominator is undefined and a negative one would silently flip every converted sign.
 */
export function assertRatePair(table: string, value: { num: unknown; den: unknown }): RatePair {
  const columns = rateColumnsFor(table);
  if (columns === null) {
    throw new MonetaryBoundaryError(
      'RATE_COLUMN_UNKNOWN',
      `NIZAM store: ${table} declares no rate columns, so there is no integer pair to guard. The rate-bearing tables are declared once, beside the DDL.`,
      { table, field: '(none)', received: undefined },
    );
  }
  const [numField, denField] = columns;
  const num = assertRateComponent(table, numField, value.num);
  const den = assertRateComponent(table, denField, value.den);
  if (den <= 0) {
    throw new MonetaryBoundaryError(
      'RATE_PAIR_DENOMINATOR_INVALID',
      `NIZAM store: ${table}.${denField} must be a positive integer; refusing to persist ${String(value.den)}. A zero denominator has no value and a negative one would flip the sign of every amount it converts.`,
      { table, field: denField, received: value.den },
    );
  }
  return { num, den };
}

/**
 * One half of a rate pair. The predicate is the money core's own integer predicate — this
 * module owns no predicate, no arithmetic, and no parsing of its own (§4.3 INVARIANT).
 */
function assertRateComponent(table: string, field: string, value: unknown): number {
  if (!isMoney(value)) {
    throw new MonetaryBoundaryError(
      'RATE_PAIR_NOT_INTEGER',
      `NIZAM store: ${table}.${field} must be a safe integer, because a rate is an integer numerator over an integer denominator applied through mulRatio; refusing to persist ${String(value)} (${value === null ? 'null' : typeof value}). A rate is never a float that later multiplies money.`,
      { table, field, received: value },
    );
  }
  return value;
}
