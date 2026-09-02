/**
 * NIZAM · Currency codes — the currency half of the money core.
 * Implemented by: KIRO Contract 1 / Phase 1.4 (the money core this extends)
 * Delta authority: Contract 6 (DRAFT, awaiting owner approval) invariants I1.1-I1.3,
 *   contracts/CONTRACT_6_multicurrency_ledger_integrity.md. Step 2a, phase 2a:
 *   additive currency carriers (FN-YNAB-01).
 * Preserves .kiro/steering/money-rules.md unchanged.
 * Depends on: nothing. Deliberately dependency-free so finance-core stays portable.
 *
 * WHY THIS FILE EXISTS: `CurrencyCode` was previously declared in
 * features/netWorth/netWorth.types.ts. Accounts and transactions must now carry a
 * currency, and the ledger core must not depend on a net-worth feature module, so
 * the type is promoted here (the money core, which they already depend on).
 * netWorth.types.ts re-exports it, so every existing import keeps working.
 *
 * A monetary amount is an integer count of milliunits OF ITS OWN STATED CURRENCY.
 * The 1/1000 scale is fixed and currency-independent (money-rules 1-2).
 */

/** ISO 4217-style alphabetic currency code, e.g. 'EGP', 'USD'. */
export type CurrencyCode = string;

/** Reporting/base currency of the Profile-A store. */
export const BASE_CURRENCY: CurrencyCode = 'EGP';

/** ISO 4217 alphabetic codes are exactly three uppercase letters. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** Runtime guard used at the persistence boundary. */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CURRENCY_CODE_PATTERN.test(value);
}

/**
 * Normalize an untrusted currency value at an ingestion/migration boundary.
 * Returns `fallback` when the input is not a valid code. It never guesses a
 * DIFFERENT currency: the fallback is supplied by the caller and is explicit,
 * because silently defaulting a foreign amount to the base currency would
 * misstate money (C6 I1.2).
 */
export function toCurrencyCode(value: unknown, fallback: CurrencyCode): CurrencyCode {
  if (isCurrencyCode(value)) return value;
  const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return isCurrencyCode(upper) ? upper : fallback;
}
