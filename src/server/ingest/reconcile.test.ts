/**
 * NIZAM · Reconciliation behaviour, on synthetic renderings — spec 08 wave A3.
 * Implemented by: PFOS Contract 06 / Phase 2.3 (spec 08-knowledge-ingestion, wave A3)
 * Depends on: reconcile.ts, seedLoad.ts, ../db/repositories/testStore.ts
 *
 * Every fixture is SYNTHETIC, so these run on a clean checkout. They assert the four things wave A3 is
 * actually for, and each is asserted through a case where a weaker implementation would pass:
 *
 *   A3.1  a clean pair of renderings reconciles, and the verdict says so without qualification.
 *   A3.2  a pre-computed verdict that disagrees with the load is REPORTED as a finding, and the report
 *         does not adopt either count.
 *   A3.3  a sign-only disagreement is distinguished from a value disagreement, and each is enumerated
 *         rather than absorbed. A duplicate present in both renderings explains none of the difference.
 *   A3.4  the tolerance is zero and carries its derivation, so nothing can be widened to pass.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { parseLedgerCsvStrict } from '@/features/import/ledgerImport';
import { LEDGER_COLUMNS } from '@/lib/ledger/ledger.types';
import { openTestStore, type TestStore } from '../db/repositories/testStore.ts';
import { accountIdFor, loadCanonicalLedger, type SeedAccount } from './seedLoad.ts';
import {
  CREDIT_CARD_PRODUCT,
  PER_ACCOUNT_COLUMNS,
  readPerAccountTable,
  reconcile,
  resolveAccountMappings,
  storeRowCount,
  type PerAccountRow,
  type ThirdOpinion,
} from './reconcile.ts';
import { fromDecimalStrict } from '@/lib/money/money';

let store: TestStore | null = null;
afterEach(() => {
  store?.close();
  store = null;
});

const ACCOUNT: SeedAccount = { last4: '1111', name: 'Synthetic Current Account', type: 'BANK_OTHER' };
const ROSTER = [ACCOUNT];
const WINDOW = '2026-01-01';
const SOURCE = { artifactRef: '<TIER1_ARTIFACT_REF>', artifactHash: 'b'.repeat(64) };

function line(overrides: Partial<Record<(typeof LEDGER_COLUMNS)[number], string>>): string {
  const base: Record<string, string> = {
    transaction_date: '2026-01-05',
    posting_date: '2026-01-05',
    payee: 'Synthetic Payee',
    merchant: 'Synthetic Merchant',
    description: 'synthetic',
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

/** Load a synthetic canonical rendering into a fresh store and return it. */
function loadCanonical(lines: string[]): TestStore {
  const s = openTestStore('nizam-recon-');
  const parsed = parseLedgerCsvStrict([LEDGER_COLUMNS.join(','), ...lines].join('\n'), { moneyUnit: 'decimal' });
  expect(parsed.errors).toEqual([]);
  loadCanonicalLedger({ ctx: s.ctx, rows: parsed.rows, accounts: ROSTER, source: SOURCE });
  return s;
}

function perAccountRow(signedAmount: number, overrides: Partial<PerAccountRow> = {}): PerAccountRow {
  return {
    accountToken: 'SYNTH_1111',
    productType: 'debit_account',
    postedDate: '2026-01-05',
    signedAmount,
    ...overrides,
  };
}

const CLEAN_THIRD_OPINION: ThirdOpinion = {
  schemaGatePassed: true,
  schemaGateRowCount: 2,
  duplicateGroups: [],
  quarantinedDocuments: [],
  balanceEquationEntries: 0,
  transferPairEntries: 0,
};

function mappingsFor(s: TestStore) {
  const { mappings, unresolved } = resolveAccountMappings(
    ['SYNTH_1111'],
    [{ storeAccountId: accountIdFor(ACCOUNT), last4: ACCOUNT.last4, name: ACCOUNT.name }],
  );
  expect(unresolved).toEqual([]);
  expect(storeRowCount(s.ctx)).toBeGreaterThan(0);
  return mappings;
}

describe('A3.1 / A3.4 — two renderings that agree, and a tolerance that is zero by derivation', () => {
  it('reconciles cleanly and says so without qualification', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' }), line({ duplicate_key: 'dk_2', outflow: '25.50', amount: '25.50' })]);
    const report = reconcile({
      ctx: store.ctx,
      // The per-account rendering states the same two rows, signed its own way but agreeing here.
      perAccount: [perAccountRow(-10_000), perAccountRow(-25_500)],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      thirdOpinion: CLEAN_THIRD_OPINION,
    });
    expect(report.verdict).toBe('RECONCILED');
    expect(report.findings).toEqual([]);
    expect(report.rowCounts.inWindowEqualsStore).toBe(true);
    expect(report.rowCounts.unexplainedRowResidual).toBe(0);
    expect(report.accounts[0]?.signedTotalsEqual).toBe(true);
  });

  it('states a tolerance of exactly zero and carries the derivation that justifies it', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' })]);
    const report = reconcile({
      ctx: store.ctx,
      perAccount: [perAccountRow(-10_000)],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      thirdOpinion: { ...CLEAN_THIRD_OPINION, schemaGateRowCount: 1 },
    });
    expect(report.tolerance.milliunits).toBe(0);
    expect(report.tolerance.derivation).toContain('third decimal place');
    expect(report.tolerance.derivation).toContain('refused');
  });

  it('counts rows outside the declared window separately instead of calling them a residual', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' })]);
    const report = reconcile({
      ctx: store.ctx,
      perAccount: [perAccountRow(-10_000), perAccountRow(-99_000, { postedDate: '2025-05-08' })],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      thirdOpinion: { ...CLEAN_THIRD_OPINION, schemaGateRowCount: 1 },
    });
    expect(report.rowCounts.perAccountRows).toBe(2);
    expect(report.rowCounts.perAccountBeforeWindow).toBe(1);
    expect(report.rowCounts.inWindowEqualsStore).toBe(true);
    expect(report.rowCounts.unexplainedRowResidual).toBe(0);
    expect(report.verdict).toBe('RECONCILED');
  });
});

describe('A3.3 — a sign disagreement is not a value disagreement, and each is enumerated', () => {
  it('recognises a sign-only disagreement, proves it with the doubling identity, and reports it', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' }), line({ duplicate_key: 'dk_2', outflow: '25.50', amount: '25.50' })]);
    const report = reconcile({
      ctx: store.ctx,
      // The second row is signed the OTHER way in the per-account rendering: same magnitude, other sign.
      perAccount: [perAccountRow(-10_000), perAccountRow(25_500)],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      thirdOpinion: CLEAN_THIRD_OPINION,
    });
    const account = report.accounts[0];
    expect(account?.rowsEqual).toBe(true);
    expect(account?.signedTotalsEqual).toBe(false);
    expect(account?.absoluteTotalsEqual).toBe(true);
    expect(account?.rowsOnlyInStore).toBe(1);
    expect(account?.disagreementIsSignOnly).toBe(true);
    expect(account?.signResidualIdentityHolds).toBe(true);
    // The residual is exactly twice the disagreeing magnitude, which is what makes "it is a sign, not a
    // value" a measured statement rather than a plausible one.
    expect(account?.signedResidual).toBe(-2 * 25_500);
    expect(report.verdict).toBe('RECONCILED_WITH_REPORTED_DISAGREEMENT');
    expect(report.findings.join(' ')).toContain('OPPOSITE SIGN');
  });

  it('distinguishes a value disagreement and does not call it reconciled', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' }), line({ duplicate_key: 'dk_2', outflow: '25.50', amount: '25.50' })]);
    const report = reconcile({
      ctx: store.ctx,
      perAccount: [perAccountRow(-10_000), perAccountRow(-25_499)],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      thirdOpinion: CLEAN_THIRD_OPINION,
    });
    expect(report.accounts[0]?.absoluteTotalsEqual).toBe(false);
    expect(report.accounts[0]?.disagreementIsSignOnly).toBe(false);
    expect(report.verdict).toBe('UNEXPLAINED_RESIDUAL');
    expect(report.findings.join(' ')).toContain('a VALUE and not a sign');
  });

  it('applies the credit-card sign normalisation as a declared step and reports that it was applied', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' })]);
    const report = reconcile({
      ctx: store.ctx,
      // A card purchase: positive in the per-account rendering, an outflow in the canonical one.
      perAccount: [perAccountRow(10_000, { productType: CREDIT_CARD_PRODUCT })],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      thirdOpinion: { ...CLEAN_THIRD_OPINION, schemaGateRowCount: 1 },
    });
    expect(report.creditCardSignNormalisationApplied).toBe(true);
    expect(report.accounts[0]?.signedTotalsEqual).toBe(true);
  });

  it('accounts for a duplicate that both renderings carry as explaining none of the difference', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' }), line({ duplicate_key: 'dk_2' })]);
    const report = reconcile({
      ctx: store.ctx,
      perAccount: [perAccountRow(-10_000), perAccountRow(-10_000)],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      thirdOpinion: {
        ...CLEAN_THIRD_OPINION,
        duplicateGroups: [{ count: 2, postedDate: '2026-01-05' }],
      },
    });
    expect(report.duplicates.groups).toBe(1);
    expect(report.duplicates.excessRows).toBe(1);
    expect(report.duplicates.groupsInWindow).toBe(1);
    expect(report.duplicates.rowsContributedToResidual).toBe(0);
    expect(report.duplicates.note).toContain('cancel out');
    expect(report.verdict).toBe('RECONCILED');
  });

  it('accounts for the quarantine as a gap in the history, not as a difference between renderings', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' })]);
    const report = reconcile({
      ctx: store.ctx,
      perAccount: [perAccountRow(-10_000)],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      thirdOpinion: {
        ...CLEAN_THIRD_OPINION,
        schemaGateRowCount: 1,
        quarantinedDocuments: [{ pages: 10 }, { pages: 33 }],
      },
    });
    expect(report.quarantine.documents).toBe(2);
    expect(report.quarantine.pages).toBe(43);
    expect(report.quarantine.rowsContributedToResidual).toBe(0);
    expect(report.quarantine.note).toContain('gap in the history');
  });
});

describe('A3.2 — the third opinion is reported, never adopted', () => {
  it('reports a pre-computed row count that disagrees with the load, and names which population it counted', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' })]);
    const report = reconcile({
      ctx: store.ctx,
      perAccount: [perAccountRow(-10_000), perAccountRow(-99_000, { postedDate: '2025-05-08' })],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      // The gate counted the per-account population: 2 rows, where the store holds 1.
      thirdOpinion: { ...CLEAN_THIRD_OPINION, schemaGateRowCount: 2 },
    });
    expect(report.thirdOpinion.agreesWithStoreRowCount).toBe(false);
    expect(report.thirdOpinion.agreesWithPerAccountRowCount).toBe(true);
    expect(report.findings.join(' ')).toContain('answering different questions');
    // Reported, not adopted: the store's own count is unchanged by the disagreement.
    expect(report.rowCounts.storeRows).toBe(1);
  });

  it('reports a pre-computed gate that agrees with neither rendering', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' })]);
    const report = reconcile({
      ctx: store.ctx,
      perAccount: [perAccountRow(-10_000)],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      thirdOpinion: { ...CLEAN_THIRD_OPINION, schemaGateRowCount: 77 },
    });
    expect(report.findings.join(' ')).toContain('agrees with neither');
  });

  it('reports a pre-computed gate failure this load did not reproduce', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' })]);
    const report = reconcile({
      ctx: store.ctx,
      perAccount: [perAccountRow(-10_000)],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      thirdOpinion: { ...CLEAN_THIRD_OPINION, schemaGateRowCount: 1, schemaGatePassed: false },
    });
    expect(report.findings.join(' ')).toContain('records a failure');
  });
});

describe('the per-account shape gate, and the two-stage account resolution', () => {
  it('refuses a per-account table whose columns are reordered at the same width', () => {
    const swapped: string[] = PER_ACCOUNT_COLUMNS.map((c) => String(c));
    const a = swapped[7] as string;
    const b = swapped[8] as string;
    swapped[7] = b;
    swapped[8] = a;
    const read = readPerAccountTable([swapped, swapped.map(() => '0')], fromDecimalStrict);
    expect(read.rows).toHaveLength(0);
    expect(read.errors[0]).toContain('declared ordered name set');
  });

  it('admits the declared shape, so the gate is shown releasing as well as refusing', () => {
    const header: string[] = PER_ACCOUNT_COLUMNS.map((c) => String(c));
    const rec = header.map((c) => (c === 'signed_amount' ? '-0.50' : c === 'product_type' ? 'debit_account' : 'x'));
    const read = readPerAccountTable([header, rec], fromDecimalStrict);
    expect(read.errors).toEqual([]);
    expect(read.rows[0]?.signedAmount).toBe(-500);
  });

  it('resolves two cards of one institution to different accounts, which a one-stage rule cannot', () => {
    const { mappings, unresolved } = resolveAccountMappings(
      ['INST_CARD_5411', 'INST_CARD_8071', 'PLAINBANK_DEBIT'],
      [
        { storeAccountId: 'acct_a', last4: '5411', name: 'Institution Card A' },
        { storeAccountId: 'acct_b', last4: '8071', name: 'Institution Card B' },
        { storeAccountId: 'acct_c', last4: '2222', name: 'Plainbank Current Account' },
      ],
    );
    expect(unresolved).toEqual([]);
    expect(mappings).toHaveLength(3);
    expect(new Set(mappings.map((m) => m.storeAccountId)).size).toBe(3);
    expect(mappings.find((m) => m.accountToken === 'PLAINBANK_DEBIT')?.storeAccountId).toBe('acct_c');
    // And nothing whole reaches the label.
    expect(mappings.every((m) => m.label.includes('*'))).toBe(true);
  });

  it('reports a token it cannot resolve rather than guessing one', () => {
    const { mappings, unresolved } = resolveAccountMappings(
      ['SOMETHING_ELSE_9999'],
      [{ storeAccountId: 'acct_a', last4: '5411', name: 'Institution Card A' }],
    );
    expect(mappings).toEqual([]);
    expect(unresolved).toEqual(['SOMETHING_ELSE_9999']);
  });

  it('reports an unmapped per-account token as a finding instead of dropping its rows', () => {
    store = loadCanonical([line({ duplicate_key: 'dk_1' })]);
    const report = reconcile({
      ctx: store.ctx,
      perAccount: [perAccountRow(-10_000), perAccountRow(-1_000, { accountToken: 'UNKNOWN_TOKEN' })],
      mappings: mappingsFor(store),
      windowStartInclusive: WINDOW,
      thirdOpinion: { ...CLEAN_THIRD_OPINION, schemaGateRowCount: 1 },
    });
    expect(report.findings.join(' ')).toContain('do not resolve to a store account');
    expect(report.verdict).toBe('UNEXPLAINED_RESIDUAL');
  });
});
