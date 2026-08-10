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

/**
 * The extraction vocabulary the INGESTION boundary uses — spec 08 wave A2, task A2.4 (K4).
 *
 * `EXTRACTION_METHODS` above has no value for "we do not know", so the lenient importer had to pick
 * one, and it picked `manual` (finding F23). That makes a machine-extracted row claim a human entered
 * it, which is the opposite of what K4 requires. `unknown` is the missing value, and it is added as a
 * SEPARATE vocabulary rather than by widening the one above: the browser tier's stored shape validates
 * against the narrow three, and a row that reached the browser store claiming `unknown` would fail a
 * schema it has no way to satisfy. The server store's own column accepts all four.
 */
export const UNKNOWN_EXTRACTION_METHOD = 'unknown' as const;
export const INGEST_EXTRACTION_METHODS = [...EXTRACTION_METHODS, UNKNOWN_EXTRACTION_METHOD] as const;
export type IngestExtractionMethod = (typeof INGEST_EXTRACTION_METHODS)[number];

/**
 * Confidence as an ORDINAL BAND, which is what the real upstream export actually carries.
 *
 * `LedgerRow.confidence_score` is typed as a 0..1 number, and the lenient parser reads the cell with
 * `Number(...) || 0`. Measured on the live canonical export, every one of its cells holds an ordinal
 * word instead, so that expression yields 0 on every row and the ledger silently reads as
 * zero-confidence throughout. A band is not a score and converting one into the other invents
 * precision that was never measured, so the two are carried in separate fields and neither is derived
 * from the other.
 */
export const CONFIDENCE_BANDS = ['high', 'medium', 'low'] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

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

/**
 * One row as the INGESTION boundary reads it — spec 08 wave A2 (tasks A2.3, A2.4).
 *
 * The same 25 facts, plus the four things the narrow shape above cannot express without losing
 * information the owner is entitled to keep:
 *
 *  - `amount` is DERIVED here, signed by direction, rather than copied. The live canonical export's
 *    own `amount` column is an unsigned magnitude on all of its rows, so copying it verbatim posts
 *    every outflow as an inflow.
 *  - the upstream vocabulary tokens for type and extraction method are preserved verbatim, so a
 *    mapping into this repository's vocabulary can be audited against what the source actually said.
 *  - confidence is a band or a score, never a band silently rendered as a score.
 */
export interface IngestLedgerRow extends Omit<LedgerRow, 'amount' | 'extraction_method' | 'confidence_score'> {
  /** Signed milliunits, derived as `inflow - outflow`. Outflow negative (money-rules §4). */
  amount: Money;
  /** The magnitude the source declared, kept so the derivation can be cross-checked. */
  declared_amount_magnitude: Money;
  /** The source's own transaction-type token, before this repository's vocabulary is applied. */
  transaction_type_raw: string;
  extraction_method: IngestExtractionMethod;
  /** The source's own extraction token, before this repository's vocabulary is applied. */
  extraction_method_raw: string;
  /** Basis points, 0..10000, present only when the source stated a numeric score. */
  confidence_bps: number | null;
  /** Present only when the source stated an ordinal band. */
  confidence_band: ConfidenceBand | null;
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
