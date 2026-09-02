/**
 * NIZAM · FX policy — deterministic rate selection, provenance, and explicit refusal.
 *
 * Implemented by: KIRO Contract 1 / Phase 1.4 (money core: integer milliunits, no float).
 * Delta authority: Contract 6 (DRAFT) section I2 (multicurrency ledger integrity);
 *   docs/architecture/IMPLEMENTATION_PLAN.md Step 3, phase 3.
 * Depends on: lib/money/money (mulRatio, assertMoney), lib/money/currency.
 *
 * WHY THIS FILE EXISTS (audit, 2026-09-02). `src/features/netWorth/netWorth.ts` already held
 * `toEgp` / `fromEgp` / `convert` built on `mulRatio`, so that ARITHMETIC is preserved and is
 * deliberately NOT rewritten here. What was absent is the policy around it:
 *   1. `FxRate.asOf` was stored but never read: every conversion used whichever row matched the
 *      currency, whatever its date.
 *   2. A missing rate could only throw, so no caller could render "unconvertible" honestly.
 *   3. `convert()` routed non-EGP -> non-EGP through EGP and therefore rounded TWICE.
 *   4. Nothing stopped a caller adding two different currencies together.
 * This module owns 1-4 and is the only FX code path; `netWorth.ts` now delegates to it.
 *
 * RESOLUTION: `RateObservation.observedAt` is an ISO 8601 UTC datetime (widened from a
 * date-only `asOf` — owner decision D1, 2026-09-02, plan Step 2b), so two observations
 * recorded at different times on the same day are ordered correctly. Two observations that
 * disagree and share the identical instant still REFUSE rather than guess. The caller-facing
 * `asOf` QUERY parameter (below) stays date-only on purpose: it asks "as it stood on this
 * day", not "at this instant", and is a separate concept from the stored field's precision.
 *
 * DETERMINISM: no clock, no network, no LLM, no float. Given the same rows and the same
 * requested date this returns the same integer every time.
 */
import type { Money } from './money';
import { assertMoney, mulRatio } from './money';
import { BASE_CURRENCY, type CurrencyCode } from './currency';

/**
 * Structural view of one stored rate row: one unit of `currency` costs
 * `perUnitNum / perUnitDen` of {@link BASE_CURRENCY}. `FxRate` in
 * `features/netWorth/netWorth.types` satisfies this shape; the money core does not import
 * from a feature, so the shape is restated rather than imported.
 */
export interface RateObservation {
  readonly currency: CurrencyCode;
  readonly perUnitNum: number;
  readonly perUnitDen: number;
  readonly source: string;
  /** ISO 8601 UTC datetime (widened from date-only `asOf` — owner decision D1, 2026-09-02). */
  readonly observedAt: string;
  readonly conversionVersion: number;
}

/** Why a conversion could not be performed. Never collapse any of these to 1:1 or to zero. */
export type UnconvertibleReason =
  /** No row at all for that currency. */
  | 'no_observation'
  /** Rows exist but every one of them is dated after the requested date. */
  | 'no_observation_at_or_before'
  /** Two rows share the newest date and disagree, so the newest rate is not defined. */
  | 'ambiguous_observation'
  /** A stored rate is zero, negative or non-integer. Such a rate cannot be inverted. */
  | 'non_positive_rate'
  /** The composed cross-rate cannot be held exactly in a safe integer ratio. */
  | 'ratio_not_representable';

/** Which of the four rate paths produced the figure. */
export type FxRule = 'identity' | 'direct' | 'inverse' | 'cross';

/** Everything a disclosure surface needs to explain a converted figure (UI delta section 4.1). */
export interface RateProvenance {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  readonly rule: FxRule;
  /** The exact integer ratio actually applied, after reduction. Rounding happened once. */
  readonly num: number;
  readonly den: number;
  /** The date the caller asked for, or null when it asked for the newest rate. */
  readonly asOfRequested: string | null;
  /** The rows relied on, in application order. Empty for `identity`. */
  readonly observations: readonly RateObservation[];
}

export interface Converted {
  readonly ok: true;
  readonly amount: Money;
  readonly provenance: RateProvenance;
}

export interface Unconvertible {
  readonly ok: false;
  readonly reason: UnconvertibleReason;
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  /** The leg that failed, which is not always `from`. */
  readonly currency: CurrencyCode;
  readonly asOfRequested: string | null;
  readonly detail: string;
}

export type Conversion = Converted | Unconvertible;

export type SelectionFailure = Extract<
  UnconvertibleReason,
  'no_observation' | 'no_observation_at_or_before' | 'ambiguous_observation'
>;

export type Selection =
  | { readonly ok: true; readonly observation: RateObservation }
  | { readonly ok: false; readonly reason: SelectionFailure; readonly detail: string };

/**
 * Identity used to decide whether two same-day rows actually disagree. `source` is excluded on
 * purpose: two providers reporting the identical ratio under the identical conversion version is
 * a duplicate, not a conflict.
 */
function rateIdentity(o: RateObservation): string {
  return `${o.perUnitNum}/${o.perUnitDen}@v${o.conversionVersion}`;
}

/**
 * Pick the newest observation for `currency` dated at or before `asOf`.
 *
 * `asOf === null` means "newest available", which is exactly what the pre-Step-3 code did, so a
 * caller that does not ask for a date gets the previous answer unchanged. Dates are `YYYY-MM-DD`,
 * so lexicographic comparison is chronological.
 */
export function selectObservation(
  rates: readonly RateObservation[],
  currency: CurrencyCode,
  asOf: string | null = null,
): Selection {
  const forCurrency = rates.filter((r) => r.currency === currency);
  if (forCurrency.length === 0) {
    return { ok: false, reason: 'no_observation', detail: `no FX observation for ${currency}` };
  }

  // `asOf` is a date-only query ("give me the rate as it stood on this day"); comparing it
  // against the full `observedAt` datetime would exclude every same-day observation whose
  // time component sorts after the bare date string. Comparing only the date portion keeps
  // the query's day-granularity while `observedAt` itself keeps full precision below.
  const eligible = asOf === null ? forCurrency : forCurrency.filter((r) => r.observedAt.slice(0, 10) <= asOf);
  if (eligible.length === 0) {
    const earliest = forCurrency.map((r) => r.observedAt).sort()[0];
    return {
      ok: false,
      reason: 'no_observation_at_or_before',
      detail: `the earliest ${currency} observation is ${earliest}, which is after ${asOf}; reaching forward to a later rate would restate history`,
    };
  }

  let newest = eligible[0]!;
  for (const r of eligible) if (r.observedAt > newest.observedAt) newest = r;

  const sameDay = eligible.filter((r) => r.observedAt === newest.observedAt);
  const distinct = new Set(sameDay.map(rateIdentity));
  if (distinct.size > 1) {
    return {
      ok: false,
      reason: 'ambiguous_observation',
      detail: `${distinct.size} disagreeing ${currency} observations share ${newest.observedAt} (${[...distinct].sort().join(', ')}); two rates recorded at the identical instant cannot be ordered`,
    };
  }

  return { ok: true, observation: newest };
}

interface Ratio {
  readonly num: number;
  readonly den: number;
}

/** A rate must be a strictly positive integer ratio, otherwise it cannot be inverted. */
function ratioOf(o: RateObservation): Ratio | null {
  const { perUnitNum: num, perUnitDen: den } = o;
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) return null;
  if (num <= 0 || den <= 0) return null;
  return { num, den };
}

/** Reduce a bigint ratio and refuse it if either side leaves safe-integer range. */
function reduceRatio(num: bigint, den: bigint): Ratio | null {
  let a = num < 0n ? -num : num;
  let b = den < 0n ? -den : den;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  const g = a === 0n ? 1n : a;
  const n = num / g;
  const d = den / g;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (n > max || n < -max || d > max || d < -max) return null;
  return { num: Number(n), den: Number(d) };
}

function fromSelection(
  sel: Extract<Selection, { ok: false }>,
  from: CurrencyCode,
  to: CurrencyCode,
  currency: CurrencyCode,
  asOfRequested: string | null,
): Unconvertible {
  return { ok: false, reason: sel.reason, from, to, currency, asOfRequested, detail: sel.detail };
}

function badRate(
  o: RateObservation,
  from: CurrencyCode,
  to: CurrencyCode,
  asOfRequested: string | null,
): Unconvertible {
  return {
    ok: false,
    reason: 'non_positive_rate',
    from,
    to,
    currency: o.currency,
    asOfRequested,
    detail: `the ${o.currency} rate ${o.perUnitNum}/${o.perUnitDen} observed ${o.observedAt} is not a positive integer ratio`,
  };
}

export interface ConvertOptions {
  /** Value the figure as of this `YYYY-MM-DD`. Omit or pass null for the newest rate. */
  readonly asOf?: string | null;
}

/**
 * Convert `amount` from one currency to another using the rate table, returning either the
 * integer result with its provenance or an explicit refusal. Never throws for missing data and
 * never falls back to 1:1.
 *
 * Cross rates (neither side is the base currency) compose ONE integer ratio and round ONCE.
 * Routing through the base currency, as the pre-Step-3 `convert()` did, rounded twice.
 */
export function convertMoney(
  amount: Money,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: readonly RateObservation[],
  opts: ConvertOptions = {},
): Conversion {
  assertMoney(amount, 'fx input');
  const asOf = opts.asOf ?? null;

  if (from === to) {
    return {
      ok: true,
      amount,
      provenance: { from, to, rule: 'identity', num: 1, den: 1, asOfRequested: asOf, observations: [] },
    };
  }

  if (to === BASE_CURRENCY) {
    const sel = selectObservation(rates, from, asOf);
    if (!sel.ok) return fromSelection(sel, from, to, from, asOf);
    const r = ratioOf(sel.observation);
    if (!r) return badRate(sel.observation, from, to, asOf);
    return {
      ok: true,
      amount: mulRatio(amount, r.num, r.den),
      provenance: {
        from,
        to,
        rule: 'direct',
        num: r.num,
        den: r.den,
        asOfRequested: asOf,
        observations: [sel.observation],
      },
    };
  }

  if (from === BASE_CURRENCY) {
    const sel = selectObservation(rates, to, asOf);
    if (!sel.ok) return fromSelection(sel, from, to, to, asOf);
    const r = ratioOf(sel.observation);
    if (!r) return badRate(sel.observation, from, to, asOf);
    return {
      ok: true,
      amount: mulRatio(amount, r.den, r.num),
      provenance: {
        from,
        to,
        rule: 'inverse',
        num: r.den,
        den: r.num,
        asOfRequested: asOf,
        observations: [sel.observation],
      },
    };
  }

  const selFrom = selectObservation(rates, from, asOf);
  if (!selFrom.ok) return fromSelection(selFrom, from, to, from, asOf);
  const selTo = selectObservation(rates, to, asOf);
  if (!selTo.ok) return fromSelection(selTo, from, to, to, asOf);

  const rf = ratioOf(selFrom.observation);
  if (!rf) return badRate(selFrom.observation, from, to, asOf);
  const rt = ratioOf(selTo.observation);
  if (!rt) return badRate(selTo.observation, from, to, asOf);

  const composed = reduceRatio(BigInt(rf.num) * BigInt(rt.den), BigInt(rf.den) * BigInt(rt.num));
  if (!composed) {
    return {
      ok: false,
      reason: 'ratio_not_representable',
      from,
      to,
      currency: from,
      asOfRequested: asOf,
      detail: `the composed ${from}->${to} rate (${rf.num}/${rf.den} over ${rt.num}/${rt.den}) does not reduce to a safe integer ratio; approximating it would invent precision`,
    };
  }

  return {
    ok: true,
    amount: mulRatio(amount, composed.num, composed.den),
    provenance: {
      from,
      to,
      rule: 'cross',
      num: composed.num,
      den: composed.den,
      asOfRequested: asOf,
      observations: [selFrom.observation, selTo.observation],
    },
  };
}

/** One-line explanation of a refusal, for logs and disclosure surfaces. */
export function describeUnconvertible(u: Unconvertible): string {
  const when = u.asOfRequested === null ? 'newest rate' : `as of ${u.asOfRequested}`;
  return `${u.from}->${u.to} unconvertible (${when}): ${u.detail}`;
}

/** A money amount that knows what currency it is in. */
export interface CurrencyAmount {
  readonly amount: Money;
  readonly currency: CurrencyCode;
}

/**
 * Add amounts that are all in the same currency, refusing anything else.
 *
 * `sum()` in the money core adds integers and cannot see currency, so adding two currencies
 * through it silently produces a number that means nothing. This is the guarded entry point.
 * An empty list has no currency of its own, so `expected` must be supplied for that case: a
 * currency-less zero becomes wrong the moment something adds it to a real figure.
 */
export function sumSameCurrency(
  entries: readonly CurrencyAmount[],
  expected?: CurrencyCode,
): CurrencyAmount {
  if (entries.length === 0) {
    if (expected === undefined) {
      throw new TypeError(
        'NIZAM fx: an empty sum has no currency, so pass the expected currency explicitly.',
      );
    }
    return { amount: 0, currency: expected };
  }

  const currency = expected ?? entries[0]!.currency;
  const seen = new Set(entries.map((e) => e.currency));
  if (seen.size > 1 || !seen.has(currency)) {
    throw new TypeError(
      `NIZAM fx: refusing to add ${[...seen].sort().join(' + ')} as ${currency}. Convert every entry first; a mixed-currency total is not a quantity.`,
    );
  }

  let total = 0;
  for (const e of entries) total += assertMoney(e.amount, 'fx sum entry');
  return { amount: assertMoney(total, 'fx sum result'), currency };
}
