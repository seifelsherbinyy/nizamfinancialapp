/**
 * NIZAM · Net-worth engine — nominal / liquid / liquidation / real, currency-aware.
 * Owning contract: PFOS contract 01 (Constitution) section 6 (net-worth views) and
 *   contract 03 (Decision Engine) section 8 (net-worth equation, currency-aware assets,
 *   real value, intangible capital stays separate).
 * Build phase: PFOS Stage 4, phase 4.2 — net-worth computation + FX.
 * Depends on: netWorth.types, accounts, obligations, lib/money.
 *
 * PURE over NizamDb. Additive: reads accounts (EGP cash + credit), obligations (liabilities)
 * and the new assets/fx/macro entities. A single-currency EGP database with no assets
 * reduces to (cash − credit − obligations), identical to pre-Stage-4 behaviour. Integer
 * milliunits; every conversion goes through mulRatio (no float FX drift).
 */
import type { NizamDb } from '@/lib/db/schema';
import type { Account } from '@/features/accounts/accounts.types';
import { isCreditType } from '@/features/accounts/accounts.types';
import type { Money } from '@/lib/money/money';
import { add, sub, sum, mulRatio, cmp } from '@/lib/money/money';
import { type Conversion, convertMoney, describeUnconvertible } from '@/lib/money/fx';
import { reserveFor } from '@/features/obligations/obligation.types';
import type { Asset, FxRate, MacroContext, CurrencyCode } from './netWorth.types.ts';
import { BASE_CURRENCY, DEFAULT_MACRO } from './netWorth.types.ts';

const BPS = 10_000;

/**
 * Throwing adapter over the money core's FX policy (`@/lib/money/fx`).
 *
 * Step 3 moved rate selection, provenance and refusal into the money core, so no FX arithmetic
 * lives in this feature any more; there is one code path. These three wrappers keep the original
 * signatures and the original "never silently zero, throw instead" behaviour for existing callers.
 * A caller that wants to RENDER an unconvertible figure rather than crash should call
 * `convertMoney` directly and read the `Unconvertible` branch.
 */
function orThrow(result: Conversion, from: CurrencyCode, to: CurrencyCode): Money {
  if (result.ok) return result.amount;
  throw new Error(`NIZAM net-worth: no FX rate for ${from}->${to} — ${describeUnconvertible(result)}`);
}

/** Convert `amount` (milliunits of `from`) into EGP milliunits via the rate table. */
export function toEgp(amount: Money, from: CurrencyCode, fx: readonly FxRate[]): Money {
  return orThrow(convertMoney(amount, from, BASE_CURRENCY, fx), from, BASE_CURRENCY);
}

/** Convert EGP milliunits into `to` milliunits (inverse rate). */
export function fromEgp(egp: Money, to: CurrencyCode, fx: readonly FxRate[]): Money {
  return orThrow(convertMoney(egp, BASE_CURRENCY, to, fx), BASE_CURRENCY, to);
}

/**
 * Convert between any two currencies. Unlike the pre-Step-3 version this does NOT round through
 * EGP on the way: a cross rate composes one integer ratio and rounds once.
 */
export function convert(amount: Money, from: CurrencyCode, to: CurrencyCode, fx: readonly FxRate[]): Money {
  return orThrow(convertMoney(amount, from, to, fx), from, to);
}

/** On-budget, non-credit, non-tracking, open accounts hold reference cash (already EGP). */
function cashAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((a) => !isCreditType(a.type) && a.type !== 'TRACKING' && !a.closed);
}
function creditAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((a) => isCreditType(a.type) && !a.closed);
}

export interface NetWorthBreakdown {
  /** Reference currency the figures below are expressed in. */
  referenceCurrency: CurrencyCode;
  /** Financial assets + valued real assets − liabilities. */
  nominal: Money;
  /** Cash + rapidly-liquid assets − near-term (credit) liabilities. */
  liquid: Money;
  /** Conservative after-haircut value of assets − liabilities. */
  liquidation: Money;
  /** Components, for explainability (contract 03 section 11). */
  components: {
    cash: Money;
    financialAssets: Money;
    realAssets: Money;
    creditLiabilities: Money;
    obligationLiabilities: Money;
  };
  /** Assets that could not be valued because a rate was missing (never silently zeroed). */
  unratedCurrencies: CurrencyCode[];
}

/**
 * Compute the net-worth views in the reference currency. Cash and credit balances are EGP
 * (the app's on-budget currency); assets carry their own currency and convert via FX.
 * Obligations are EGP liabilities. Nothing intangible is included (contract 03 section 8.4).
 */
export function netWorth(db: NizamDb, reference: CurrencyCode = BASE_CURRENCY): NetWorthBreakdown {
  const fx = db.fxRates ?? [];
  const assets = db.assets ?? [];
  const unrated = new Set<CurrencyCode>();

  const toRef = (amountEgp: Money): Money => fromEgp(amountEgp, reference, fx);

  const cashEgp = sum(cashAccounts(db.accounts).map((a) => a.clearedBalance));
  // Credit balances are negative when owed; the liability magnitude is their negation.
  const creditEgp = sum(creditAccounts(db.accounts).map((a) => a.clearedBalance));
  const creditLiabilityEgp = cmp(creditEgp, 0) < 0 ? sub(0, creditEgp) : 0;

  const obligationLiabilityEgp = sum(db.obligations.map((o) => reserveFor(o)));

  const valueAsset = (a: Asset, discount: boolean): Money => {
    let egp: Money;
    try {
      egp = toEgp(a.value, a.currency, fx);
    } catch {
      unrated.add(a.currency);
      return 0;
    }
    return discount ? mulRatio(egp, BPS - a.liquidationDiscountBps, BPS) : egp;
  };

  const financialAssetsEgp = sum(assets.filter((a) => a.kind === 'financial').map((a) => valueAsset(a, false)));
  const realAssetsEgp = sum(assets.filter((a) => a.kind === 'real').map((a) => valueAsset(a, false)));
  const liquidAssetsEgp = sum(assets.filter((a) => a.liquid).map((a) => valueAsset(a, false)));
  const liquidationAssetsEgp = sum(assets.map((a) => valueAsset(a, true)));

  const nominalEgp = sub(add(add(cashEgp, financialAssetsEgp), realAssetsEgp), add(creditLiabilityEgp, obligationLiabilityEgp));
  const liquidEgp = sub(add(cashEgp, liquidAssetsEgp), creditLiabilityEgp);
  const liquidationEgp = sub(add(cashEgp, liquidationAssetsEgp), add(creditLiabilityEgp, obligationLiabilityEgp));

  return {
    referenceCurrency: reference,
    nominal: toRef(nominalEgp),
    liquid: toRef(liquidEgp),
    liquidation: toRef(liquidationEgp),
    components: {
      cash: toRef(cashEgp),
      financialAssets: toRef(financialAssetsEgp),
      realAssets: toRef(realAssetsEgp),
      creditLiabilities: toRef(creditLiabilityEgp),
      obligationLiabilities: toRef(obligationLiabilityEgp),
    },
    unratedCurrencies: [...unrated].sort(),
  };
}

/**
 * Real (inflation-adjusted) value of a nominal amount, deflated over `years` whole years at
 * the annual inflation rate — contract 01 section 6 "real net worth". Compounded via integer
 * ratios (no float drift): real = nominal * (BPS / (BPS + annualInflationBps)) per year.
 * `years = 0` (or zero inflation) returns the nominal amount unchanged.
 */
export function realValue(nominal: Money, annualInflationBps: number, years: number): Money {
  if (years <= 0 || annualInflationBps <= 0) return nominal;
  let v = nominal;
  const den = BPS + annualInflationBps;
  for (let i = 0; i < Math.floor(years); i += 1) {
    v = mulRatio(v, BPS, den);
  }
  return v;
}

/** Macro context with defaults filled. */
export function resolveMacro(db: NizamDb): MacroContext {
  return db.macro ?? DEFAULT_MACRO;
}

/**
 * The real net worth: nominal net worth expressed in today's purchasing power relative to a
 * base date `years` in the past (how much that nominal figure is "really" worth vs the base).
 * With no inflation set, real == nominal — the Stage-4 regression on single-currency data.
 */
export function realNetWorth(db: NizamDb, reference: CurrencyCode, years: number): Money {
  const macro = resolveMacro(db);
  const nominal = netWorth(db, reference).nominal;
  return realValue(nominal, macro.annualInflationBps, years);
}
