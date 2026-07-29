/**
 * NIZAM · Canonical ledger types — mirrors data/ledgers/LEDGER_SCHEMA.md (25 fields)
 * Implemented by: KIRO Contract 1 / Phase 1.5 (consumed by Contract 2 import)
 * Depends on: lib/money/money.ts
 */
import type { Money } from '@/lib/money/money';

export const TRANSACTION_TYPES = [
  'charge',
  'payment',
  'fee',
  'interest',
  'transfer',
  'salary',
] as const;
export type LedgerTransactionType = (typeof TRANSACTION_TYPES)[number];

export const EXTRACTION_METHODS = ['parser', 'ocr', 'manual'] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export type LedgerDirection = 'in' | 'out';

/**
 * One row of the authoritative 25-column master ledger.
 * Money fields are integer milliunits (parsed at the import boundary).
 */
export interface LedgerRow {
  /** 1 */ transaction_date: string; // ISO date
  /** 2 */ posting_date: string; // ISO date
  /** 3 */ payee: string;
  /** 4 */ merchant: string;
  /** 5 */ description: string;
  /** 6 */ category: string;
  /** 7 */ transaction_type: LedgerTransactionType;
  /** 8 */ outflow: Money; // >= 0
  /** 9 */ inflow: Money; // >= 0
  /** 10 */ amount: Money; // signed
  /** 11 */ direction: LedgerDirection;
  /** 12 */ currency: string; // 'EGP'
  /** 13 */ balance: Money | null; // running balance when present
  /** 14 */ account: string; // display account name
  /** 15 */ account_identifier: string; // REDACT in UI (last-4)
  /** 16 */ statement_date: string; // ISO date
  /** 17 */ statement_month: string; // YYYY-MM
  /** 18 */ source_file: string;
  /** 19 */ source_page_or_sheet: string;
  /** 20 */ extraction_method: ExtractionMethod;
  /** 21 */ confidence_score: number; // 0..1 (metadata, not money)
  /** 22 */ confidence_reason: string;
  /** 23 */ duplicate_key: string;
  /** 24 */ is_duplicate: boolean;
  /** 25 */ memo: string;
}

/** Column order as they appear in the master ledger CSV. */
export const LEDGER_COLUMNS: readonly (keyof LedgerRow)[] = [
  'transaction_date',
  'posting_date',
  'payee',
  'merchant',
  'description',
  'category',
  'transaction_type',
  'outflow',
  'inflow',
  'amount',
  'direction',
  'currency',
  'balance',
  'account',
  'account_identifier',
  'statement_date',
  'statement_month',
  'source_file',
  'source_page_or_sheet',
  'extraction_method',
  'confidence_score',
  'confidence_reason',
  'duplicate_key',
  'is_duplicate',
  'memo',
] as const;
