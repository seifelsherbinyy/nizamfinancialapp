/**
 * NIZAM · The seed load's four properties, on synthetic rows — spec 08 wave A2.
 * Implemented by: PFOS Contract 06 / Phase 2.2 (spec 08-knowledge-ingestion, wave A2)
 * Depends on: seedLoad.ts, ../db/repositories/testStore.ts, @/features/import/ledgerImport
 *
 * Every fixture is SYNTHETIC, so these cases run on a clean checkout with no local cache. They assert
 * the properties A2 names, and each is asked of the STORE rather than of the loader's own report:
 *
 *   A2.2 / K2  running the load twice inserts zero rows the second time, and the row count is identical.
 *              Proven by counting the table, not by the loader saying so.
 *   A2.4 / K4  provenance is on every row, and an untranslatable extractor loads as `unknown`. Counted
 *              with a query against `transactions`, so a loader that lied would still fail.
 *   A2.5       a period whose totals do not satisfy the balance equation closes as an accepted exception
 *              WITH a reason, and a period offered without a reason is refused.
 *
 * The rows go through the real strict parser rather than being hand-built, because a hand-built row
 * could satisfy the loader while the boundary it is supposed to have crossed was never exercised.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { parseLedgerCsvStrict } from '@/features/import/ledgerImport';
import { LEDGER_COLUMNS } from '@/lib/ledger/ledger.types';
import { openTestStore, type TestStore } from '../db/repositories/testStore.ts';
import { createAccountsRepository } from '../db/repositories/accountsRepository.ts';
import { createStatementsRepository } from '../db/repositories/statementsRepository.ts';
import { countRowsWithoutProvenance, loadCanonicalLedger, maskAccountToken, type SeedAccount } from './seedLoad.ts';

let store: TestStore | null = null;
afterEach(() => {
  store?.close();
  store = null;
});

const ROSTER: readonly SeedAccount[] = [
  { last4: '1111', name: 'Synthetic Current Account', type: 'BANK_OTHER' },
  { last4: '2222', name: 'Synthetic Revolving Account', type: 'CREDIT_OTHER', creditLimit: null },
];

function line(overrides: Partial<Record<(typeof LEDGER_COLUMNS)[number], string>> = {}): string {
  const base: Record<string, string> = {
    transaction_date: '2026-01-05',
    posting_date: '2026-01-06',
    payee: 'Synthetic Payee',
    merchant: 'Synthetic Merchant',
    description: 'synthetic narrative',
    category: 'Synthetic',
    transaction_type: 'Purchase',
    outflow: '10.00',
    inflow: '',
    amount: '10.00',
    direction: 'debit',
    currency: 'EGP',
    balance: '',
    account: 'Synthetic Current Account',
    account_identifier: '1111',
    statement_date: '2026-01-31',
    statement_month: '2026-01',
    source_file: 'synthetic.pdf',
    source_page_or_sheet: 'p1',
    extraction_method: 'pdftotext-layout',
    confidence_score: 'medium',
    confidence_reason: 'synthetic',
    duplicate_key: 'dk_1',
    is_duplicate: 'FALSE',
    memo: '',
  };
  const merged = { ...base, ...overrides };
  return LEDGER_COLUMNS.map((c) => merged[c] ?? '').join(',');
}

function rowsFrom(lines: string[]) {
  const parsed = parseLedgerCsvStrict([LEDGER_COLUMNS.join(','), ...lines].join('\n'), { moneyUnit: 'decimal' });
  expect(parsed.errors).toEqual([]);
  return parsed.rows;
}

const SOURCE = { artifactRef: '<TIER1_ARTIFACT_REF>', artifactHash: 'a'.repeat(64) };

function rowCount(s: TestStore): number {
  const raw = s.ctx.handle.db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number } | undefined;
  return Number(raw?.n ?? 0);
}

/** A statement references an account, and the DDL enforces it. One account, for the period cases. */
function seedOneAccount(s: TestStore): string {
  const id = 'acct_synthetic_for_periods';
  createAccountsRepository(s.ctx).insert({
    id,
    name: 'Synthetic Current Account',
    type: 'BANK_OTHER',
    onBudget: true,
    balance: 0,
    clearedBalance: 0,
    creditLimit: null,
    accountIdentifierLast4: '1111',
  });
  return id;
}

describe('A2.2 / K2 — the load is idempotent because the keys are, not because the loader checks', () => {
  it('inserts zero rows on a second run and leaves the count identical', () => {
    store = openTestStore('nizam-seed-');
    const rows = rowsFrom([
      line({ duplicate_key: 'dk_1' }),
      line({ duplicate_key: 'dk_2', transaction_date: '2026-01-07' }),
      line({ duplicate_key: 'dk_3', account_identifier: '2222', account: 'Synthetic Revolving Account' }),
    ]);

    const first = loadCanonicalLedger({ ctx: store.ctx, rows, accounts: ROSTER, source: SOURCE });
    const afterFirst = rowCount(store);
    expect(first.transactionsInserted).toBe(3);
    expect(first.sourceEventsAppended).toBe(3);
    expect(afterFirst).toBe(3);

    const second = loadCanonicalLedger({ ctx: store.ctx, rows, accounts: ROSTER, source: SOURCE });
    expect(second.transactionsInserted).toBe(0);
    expect(second.sourceEventsAppended).toBe(0);
    expect(second.sourceEventsAlreadyPresent).toBe(3);
    expect(second.accountsCreated).toBe(0);
    expect(rowCount(store)).toBe(afterFirst);
  });

  it('reports the same key arriving with different bytes rather than overwriting either version', () => {
    store = openTestStore('nizam-seed-');
    const original = rowsFrom([line({ duplicate_key: 'dk_1', payee: 'Synthetic Payee' })]);
    const changed = rowsFrom([line({ duplicate_key: 'dk_1', payee: 'A Different Synthetic Payee' })]);

    loadCanonicalLedger({ ctx: store.ctx, rows: original, accounts: ROSTER, source: SOURCE });
    const second = loadCanonicalLedger({ ctx: store.ctx, rows: changed, accounts: ROSTER, source: SOURCE });

    expect(second.sourceEventHashConflicts).toBe(1);
    expect(second.transactionsInserted).toBe(0);
    // The stored row is untouched: the boundary reports the disagreement, it does not resolve it.
    const stored = store.ctx.handle.db.prepare('SELECT payee FROM transactions').get() as { payee: string };
    expect(stored.payee).toBe('Synthetic Payee');
  });

  it('refuses a row naming an account the roster does not hold, rather than skipping it', () => {
    store = openTestStore('nizam-seed-');
    const rows = rowsFrom([line({ account_identifier: '9999', duplicate_key: 'dk_x' })]);
    expect(() => loadCanonicalLedger({ ctx: store!.ctx, rows, accounts: ROSTER, source: SOURCE })).toThrow(
      /INGEST_ACCOUNT_UNRESOLVED|roster does not hold/,
    );
    expect(rowCount(store)).toBe(0);
  });
});

describe('A2.4 / K4 — provenance on every row, and unknown means unknown', () => {
  it('carries the source reference, the extractor token and the confidence band into the store', () => {
    store = openTestStore('nizam-seed-');
    loadCanonicalLedger({ ctx: store.ctx, rows: rowsFrom([line()]), accounts: ROSTER, source: SOURCE });
    const raw = store.ctx.handle.db
      .prepare(
        'SELECT source_file, source_page_or_sheet, extraction_method, extraction_method_raw, transaction_type_raw, confidence_band, confidence_bps, confidence_reason FROM transactions',
      )
      .get() as Record<string, unknown>;
    expect(raw['source_file']).toBe('synthetic.pdf');
    expect(raw['source_page_or_sheet']).toBe('p1');
    expect(raw['extraction_method']).toBe('parser');
    expect(raw['extraction_method_raw']).toBe('pdftotext-layout');
    expect(raw['transaction_type_raw']).toBe('Purchase');
    expect(raw['confidence_band']).toBe('medium');
    expect(raw['confidence_bps']).toBeNull();
    expect(raw['confidence_reason']).toBe('synthetic');
  });

  it('stores an untranslatable extractor as unknown, and never as manual', () => {
    store = openTestStore('nizam-seed-');
    loadCanonicalLedger({
      ctx: store.ctx,
      rows: rowsFrom([line({ extraction_method: 'some-future-extractor' })]),
      accounts: ROSTER,
      source: SOURCE,
    });
    const counted = countRowsWithoutProvenance(store.ctx);
    expect(counted.total).toBe(1);
    expect(counted.unknownExtractionMethod).toBe(1);
    expect(counted.absentSourceReference).toBe(0);
    expect(counted.defaultedManual).toBe(0);
    // And it does not claim to be parser-verified either: an unknown extractor verifies nothing.
    const raw = store.ctx.handle.db.prepare('SELECT verification_level FROM transactions').get() as {
      verification_level: string;
    };
    expect(raw.verification_level).toBe('unverified');
  });

  it('never puts a whole account identifier in the report', () => {
    store = openTestStore('nizam-seed-');
    const report = loadCanonicalLedger({ ctx: store.ctx, rows: rowsFrom([line()]), accounts: ROSTER, source: SOURCE });
    expect(report.rowsPerAccount[0]?.account).toBe(maskAccountToken('1111'));
    expect(JSON.stringify(report)).not.toContain('1111');
  });
});

describe('A2.5 — a period closes on arithmetic, or as an exception with a reason', () => {
  it('records a period whose balances the source does not state as an accepted exception, with that reason', () => {
    store = openTestStore('nizam-seed-');
    const report = loadCanonicalLedger({ ctx: store.ctx, rows: rowsFrom([line()]), accounts: ROSTER, source: SOURCE });
    expect(report.statements.recorded).toBe(1);
    expect(report.statements.balanced).toBe(0);
    expect(report.statements.exceptionAccepted).toBe(1);
    expect(report.statements.exceptionReasons['opening_and_closing_balance_absent_in_source']).toBe(1);
    const raw = store.ctx.handle.db.prepare('SELECT close_state, close_exception_reason FROM statements').get() as {
      close_state: string;
      close_exception_reason: string;
    };
    expect(raw.close_state).toBe('exception_accepted');
    expect(raw.close_exception_reason).toBe('opening_and_closing_balance_absent_in_source');
  });

  it('closes a period as balanced when the equation actually holds', () => {
    store = openTestStore('nizam-seed-');
    const accountId = seedOneAccount(store);
    const statements = createStatementsRepository(store.ctx);
    const verdict = statements.record({
      id: 'stmt_synthetic_balanced',
      accountId,
      statementMonth: '2026-02',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      // 5000 + 2000 - 3000 == 4000, in milliunits. Integers throughout, so the identity is exact and
      // there is no rounding anywhere in it to justify a tolerance.
      openingBalance: 5_000,
      closingBalance: 4_000,
      totalInflow: 2_000,
      totalOutflow: 3_000,
    });
    expect(verdict.balanced).toBe(true);
    expect(verdict.row.closeState).toBe('balanced');
    expect(verdict.row.closeExceptionReason).toBeNull();
  });

  it('refuses an unbalanced period offered with no reason, rather than accepting the exception silently', () => {
    store = openTestStore('nizam-seed-');
    const accountId = seedOneAccount(store);
    const statements = createStatementsRepository(store.ctx);
    expect(() =>
      statements.record({
        id: 'stmt_synthetic_unbalanced',
        accountId,
        statementMonth: '2026-03',
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        openingBalance: 5_000,
        closingBalance: 9_999,
        totalInflow: 2_000,
        totalOutflow: 3_000,
      }),
    ).toThrow(/INGEST_STATEMENT_EXCEPTION_WITHOUT_REASON|stated reason/);
    expect(statements.countByCloseState('exception_accepted')).toBe(0);
  });

  it('keeps no monetary value in the refusal message', () => {
    store = openTestStore('nizam-seed-');
    const accountId = seedOneAccount(store);
    const statements = createStatementsRepository(store.ctx);
    let message = '';
    try {
      statements.record({
        id: 'stmt_synthetic_unbalanced_2',
        accountId,
        statementMonth: '2026-04',
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        openingBalance: 123_456,
        closingBalance: 654_321,
        totalInflow: 1,
        totalOutflow: 2,
      });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toContain('123456');
    expect(message).not.toContain('654321');
    expect(message).toContain('2026-04');
  });
});
