/**
 * NIZAM · Transaction model — mirrors NIZAM ledger schema
 * Implemented by: KIRO Contract 1 / Phase 1.5
 * Depends on: lib/money/money.ts
 *
 * Signed convention (money-rules.md): outflow negative, inflow positive in `amount`.
 */
import type { Money } from '@/lib/money/money';

export const CLEARED_STATUSES = ['uncleared', 'cleared', 'reconciled'] as const;
export type ClearedStatus = (typeof CLEARED_STATUSES)[number];

/** One leg of a split transaction. Split amounts sum exactly to the parent amount. */
export interface TransactionSplit {
  id: string;
  categoryId: string | null;
  amount: Money;
  memo: string;
}

/** Provenance carried over from the imported master ledger (LEDGER_SCHEMA.md). */
export interface ImportInfo {
  duplicateKey: string;
  sourceFile: string;
  sourcePageOrSheet: string;
  extractionMethod: 'parser' | 'ocr' | 'manual';
  confidenceScore: number;
  confidenceReason: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  /** Transaction date, ISO YYYY-MM-DD. */
  date: string;
  payee: string;
  /** Budget category id; null = uncategorized or a transfer. */
  categoryId: string | null;
  memo: string;
  /** Signed milliunits: outflow negative, inflow positive. */
  amount: Money;
  cleared: ClearedStatus;
  /** False until the user approves an imported transaction. */
  approved: boolean;
  /** Transfer linkage: the peer account and mirrored transaction. */
  transferAccountId: string | null;
  transferTransactionId: string | null;
  /** Split legs; null for simple transactions. */
  splits: TransactionSplit[] | null;
  /** Import provenance; null for manually entered transactions. */
  importInfo: ImportInfo | null;
}

/** Non-negative outflow magnitude (0 for inflows). */
export function outflowOf(t: Pick<Transaction, 'amount'>): Money {
  return t.amount < 0 ? -t.amount : 0;
}

/** Non-negative inflow magnitude (0 for outflows). */
export function inflowOf(t: Pick<Transaction, 'amount'>): Money {
  return t.amount > 0 ? t.amount : 0;
}
