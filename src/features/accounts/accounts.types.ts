/**
 * NIZAM · Account types — bank/credit/cash + tracking
 * Implemented by: KIRO Contract 1 / Phase 1.5
 * Depends on: lib/money/money.ts
 */
import type { Money } from '@/lib/money/money';

/** Account types. The first three mirror the user's real accounts (steering tech.md). */
export const ACCOUNT_TYPES = [
  'CIB_DEBIT',
  'HSBC_CC',
  'CASH',
  'BANK_OTHER',
  'CREDIT_OTHER',
  'TRACKING',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Credit accounts get YNAB credit-overspend + payment-category behavior. */
export function isCreditType(type: AccountType): boolean {
  return type === 'HSBC_CC' || type === 'CREDIT_OTHER';
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** On-budget accounts participate in the zero-based budget; tracking accounts do not. */
  onBudget: boolean;
  /** Cached working balance (signed milliunits) — derived from transactions. */
  balance: Money;
  /** Cached cleared balance (signed milliunits). */
  clearedBalance: Money;
  /** Bank identifier / card number fragment — REDACTED in UI (last-4 only). */
  accountIdentifier: string | null;
  /** Credit limit for utilization analytics (credit accounts only). */
  creditLimit: Money | null;
  closed: boolean;
  /** Sidebar sort order. */
  order: number;
  /** Categories linked to this account (credit accounts: the CC payment category id). */
  paymentCategoryId: string | null;
}

/** Redact an account identifier to its last 4 characters for display. */
export function redactIdentifier(identifier: string | null): string {
  if (!identifier) return '';
  const tail = identifier.slice(-4);
  return `••••${tail}`;
}
