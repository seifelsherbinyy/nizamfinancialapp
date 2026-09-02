/**
 * NIZAM · Net-worth & currency types — assets, FX rates, macro context.
 * Owning contract: PFOS contract 01 (Constitution) section 6 (the five net-worth views)
 *   and contract 03 (Decision Engine) section 8 (net-worth engine, currency-aware assets,
 *   real value). Intangible capital stays OUT of book net worth (03 section 8.4).
 * Build phase: PFOS Stage 4, phase 4.1 — net-worth schema.
 * Depends on: lib/money.
 *
 * Deliberately ADDITIVE: this stage adds new entities only. Accounts, transactions and the
 * budget engine are untouched, so a single-currency EGP database produces byte-identical
 * numbers to before (the Stage-4 regression bar). Foreign cash is modelled as a liquid asset.
 */
import type { Money } from '@/lib/money/money';

/**
 * ISO 4217-style currency code. EGP is the base of the money core.
 * MOVED to lib/money/currency.ts in C6 Step 2a so the ledger core (accounts,
 * transactions) can carry a currency without depending on a net-worth feature
 * module. Re-exported here so every existing import keeps working unchanged.
 */
import type { CurrencyCode } from '@/lib/money/currency';
import { BASE_CURRENCY } from '@/lib/money/currency';
export type { CurrencyCode };
export { BASE_CURRENCY };

/** Financial assets are liquid/near-liquid; real assets are property, vehicles, etc. */
export const ASSET_KINDS = ['financial', 'real'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  /** Currency the value is denominated in (milliunits of THIS currency). */
  currency: CurrencyCode;
  /** Nominal value in its own currency's milliunits (non-negative — assets are owned). */
  value: Money;
  /** True for a financial asset that can be spent within days (counts toward liquid net worth). */
  liquid: boolean;
  /** Fire-sale / after-fee haircut in basis points for the liquidation view (0..10000). */
  liquidationDiscountBps: number;
  /** Provenance of the valuation. */
  valuationSource: string;
  /** ISO date the value was assessed. */
  valuationAsOf: string;
}

/**
 * One unit of `currency` equals perUnitNum / perUnitDen of EGP. Stored as an integer ratio
 * so conversion uses the money core's mulRatio — no float FX drift. Every rate carries its
 * source and time (contract 03 section 8.3: "store FX conversion source/time").
 */
export interface FxRate {
  currency: CurrencyCode;
  perUnitNum: number; // integer
  perUnitDen: number; // integer, > 0
  source: string;
  /**
   * ISO 8601 UTC datetime the rate was observed. Widened from a date-only `asOf` in
   * SCHEMA_VERSION 8 (owner decision D1, 2026-09-02): the only mutation of an
   * existing tracked field in the vNext model. Every migrated row carries
   * `${originalDate}T00:00:00Z`; a newly recorded rate may carry a real time.
   */
  observedAt: string;
  /**
   * Bumped when the SEMANTICS of a rate change (not when a rate value changes),
   * so a derived figure can state which conversion rule produced it (C6 I2.4).
   * Additive in Step 2a; defaults to 0 for every migrated row.
   */
  conversionVersion: number;
}

/** Macro context — manual/imported values first; no live API (that is a server concern). */
export interface MacroContext {
  referenceCurrency: CurrencyCode;
  /** Annual inflation in basis points (e.g. 3000 = 30%/yr), used for the real-value view. */
  annualInflationBps: number;
  inflationSource: string;
  inflationAsOf: string;
}

export const DEFAULT_MACRO: MacroContext = {
  referenceCurrency: BASE_CURRENCY,
  annualInflationBps: 0,
  inflationSource: 'unset',
  inflationAsOf: '1970-01-01',
};
