/**
 * NIZAM · ledger import tests — parse, dedup, idempotent re-import
 * Implemented by: KIRO Contract 2 / Phase 2.5
 */
import { describe, it, expect } from 'vitest';
import { parseCsv, parseLedgerCsv, importLedger, fallbackDuplicateKey } from './ledgerImport';
import { createEmptyDb } from '@/lib/db/schema';
import { LEDGER_COLUMNS } from '@/lib/ledger/ledger.types';

const HEADER = LEDGER_COLUMNS.join(',');

interface RowOverrides {
  [k: string]: string;
}

/** Build a 25-column CSV row with sensible defaults (decimal money format). */
function row(overrides: RowOverrides): string {
  const defaults: Record<string, string> = {
    transaction_date: '2026-07-01',
    posting_date: '2026-07-02',
    payee: 'Carrefour',
    merchant: 'CARREFOUR MAADI',
    description: 'POS PURCHASE',
    category: 'Groceries',
    transaction_type: 'charge',
    outflow: '250.50',
    inflow: '0',
    amount: '-250.50',
    direction: 'out',
    currency: 'EGP',
    balance: '',
    account: 'CIB Current',
    account_identifier: '9876',
    statement_date: '2026-07-31',
    statement_month: '2026-07',
    source_file: 'stmt_jul.pdf',
    source_page_or_sheet: '1',
    extraction_method: 'parser',
    confidence_score: '0.98',
    confidence_reason: 'clean parse',
    duplicate_key: '',
    is_duplicate: 'false',
    memo: '',
  };
  const merged = { ...defaults, ...overrides };
  return LEDGER_COLUMNS.map((c) => {
    const v = merged[c] ?? '';
    return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',');
}

describe('parseCsv (RFC 4180)', () => {
  it('parses quoted fields with embedded commas and escaped quotes', () => {
    const out = parseCsv('a,"b,c","d""e"\n1,2,3');
    expect(out).toEqual([
      ['a', 'b,c', 'd"e'],
      ['1', '2', '3'],
    ]);
  });

  it('handles CRLF and skips blank lines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a BOM', () => {
    expect(parseCsv('\uFEFFa,b\n1,2')[0]).toEqual(['a', 'b']);
  });
});

describe('parseLedgerCsv', () => {
  it('parses decimal money into integer milliunits', () => {
    const csv = [HEADER, row({})].join('\n');
    const parsed = parseLedgerCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.moneyFormat).toBe('decimal');
    expect(parsed.rows[0]?.outflow).toBe(250_500);
    expect(parsed.rows[0]?.amount).toBe(-250_500);
  });

  it('parses integer milliunit files as-is', () => {
    const csv = [
      HEADER,
      row({ outflow: '250500', inflow: '0', amount: '-250500' }),
    ].join('\n');
    const parsed = parseLedgerCsv(csv);
    expect(parsed.moneyFormat).toBe('milliunits');
    expect(parsed.rows[0]?.amount).toBe(-250_500);
  });

  it('fills a fallback duplicate_key when the column is blank', () => {
    const csv = [HEADER, row({ duplicate_key: '' })].join('\n');
    const parsed = parseLedgerCsv(csv);
    expect(parsed.rows[0]?.duplicate_key).toBeTruthy();
    expect(parsed.rows[0]?.duplicate_key).toBe(
      fallbackDuplicateKey({
        transaction_date: '2026-07-01',
        amount: -250_500,
        account: 'CIB Current',
        payee: 'Carrefour',
      }),
    );
  });

  it('reports missing columns', () => {
    const parsed = parseLedgerCsv('a,b,c\n1,2,3');
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0]?.message).toMatch(/missing required columns/);
  });

  it('collects row-level errors without dropping good rows', () => {
    const csv = [HEADER, row({}), row({ transaction_date: 'not-a-date', duplicate_key: 'k2' })].join('\n');
    const parsed = parseLedgerCsv(csv);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]?.rowNumber).toBe(2);
  });
});

describe('importLedger', () => {
  it('imports fresh rows, creating accounts/categories/payees', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    const csv = [
      HEADER,
      row({ duplicate_key: 'k1' }),
      row({
        duplicate_key: 'k2',
        payee: 'Salary',
        category: 'Income',
        transaction_type: 'salary',
        outflow: '0',
        inflow: '30000.00',
        amount: '30000.00',
        direction: 'in',
        account: 'HSBC Card',
        account_identifier: 'HSBC-4321',
      }),
    ].join('\n');

    const { db: next, stats } = importLedger(db, csv);
    expect(stats.imported).toBe(2);
    expect(stats.parseErrors).toEqual([]);
    expect(next.transactions).toHaveLength(2);
    expect(next.accounts.map((a) => a.type).sort()).toEqual(['CIB_DEBIT', 'HSBC_CC']);
    expect(next.categories.map((c) => c.name).sort()).toEqual(['Groceries', 'Income']);
    expect(next.payees.map((p) => p.name).sort()).toEqual(['Carrefour', 'Salary']);
    // Balances recomputed.
    const cib = next.accounts.find((a) => a.type === 'CIB_DEBIT');
    expect(cib?.balance).toBe(-250_500);
    // Import provenance carried.
    expect(next.transactions[0]?.importInfo?.confidenceScore).toBeCloseTo(0.98);
    // Original db untouched (pure).
    expect(db.transactions).toHaveLength(0);
  });

  it('re-import is a no-op (idempotent dedup by duplicate_key)', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    const csv = [HEADER, row({ duplicate_key: 'k1' }), row({ duplicate_key: 'k2', payee: 'Uber', category: 'Transport', transaction_date: '2026-07-05', amount: '-90.00', outflow: '90.00' })].join('\n');

    const first = importLedger(db, csv);
    expect(first.stats.imported).toBe(2);

    const second = importLedger(first.db, csv);
    expect(second.stats.imported).toBe(0);
    expect(second.stats.skippedExact).toBe(2);
    expect(second.db.transactions).toHaveLength(2);
  });

  it('skips rows flagged is_duplicate=true', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    const csv = [HEADER, row({ duplicate_key: 'k1', is_duplicate: 'true' })].join('\n');
    const { stats } = importLedger(db, csv);
    expect(stats.imported).toBe(0);
    expect(stats.skippedFlagged).toBe(1);
  });

  it('fuzzy-dedups same account+amount+payee within 3 days (different key)', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    const csv1 = [HEADER, row({ duplicate_key: 'k1', transaction_date: '2026-07-01' })].join('\n');
    const first = importLedger(db, csv1);

    const csv2 = [HEADER, row({ duplicate_key: 'DIFFERENT', transaction_date: '2026-07-03' })].join('\n');
    const second = importLedger(first.db, csv2);
    expect(second.stats.imported).toBe(0);
    expect(second.stats.skippedFuzzy).toBe(1);
  });

  it('does NOT fuzzy-dedup beyond the 3-day window', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    const first = importLedger(db, [HEADER, row({ duplicate_key: 'k1', transaction_date: '2026-07-01' })].join('\n'));
    const second = importLedger(
      first.db,
      [HEADER, row({ duplicate_key: 'k9', transaction_date: '2026-07-10' })].join('\n'),
    );
    expect(second.stats.imported).toBe(1);
  });

  it('dedups within a single batch too', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    const csv = [HEADER, row({ duplicate_key: 'k1' }), row({ duplicate_key: 'k1' })].join('\n');
    const { stats } = importLedger(db, csv);
    expect(stats.imported).toBe(1);
    expect(stats.skippedExact).toBe(1);
  });

  it('transfer rows import uncategorized', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    const csv = [
      HEADER,
      row({ duplicate_key: 'k1', transaction_type: 'transfer', category: 'Transfer' }),
    ].join('\n');
    const { db: next } = importLedger(db, csv);
    expect(next.transactions[0]?.categoryId).toBeNull();
  });
});
