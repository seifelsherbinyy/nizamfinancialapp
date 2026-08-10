/**
 * NIZAM · ImportWizard tests — pure-engine delegation, dedup preview, idempotent commit
 * Implemented by: KIRO Contract 4 / Phase 4.7
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportWizard } from './ImportWizard.tsx';
import { bootStore } from '../../../tests/helpers/fixtures.ts';
import { useNizamStore } from '@/state/store';
import { LEDGER_COLUMNS } from '@/lib/ledger/ledger.types';

const HEADER = LEDGER_COLUMNS.join(',');

function csvRow(overrides: Record<string, string>): string {
  const defaults: Record<string, string> = {
    transaction_date: '2026-07-01',
    posting_date: '2026-07-02',
    payee: 'Supermarket',
    merchant: 'SUPERMARKET CAIRO',
    description: 'POS',
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
    source_file: 'stmt.pdf',
    source_page_or_sheet: '1',
    extraction_method: 'parser',
    confidence_score: '0.9',
    confidence_reason: 'ok',
    duplicate_key: '',
    is_duplicate: 'false',
    memo: '',
  };
  const merged = { ...defaults, ...overrides };
  return LEDGER_COLUMNS.map((c) => merged[c] ?? '').join(',');
}

const SAMPLE_CSV = [
  HEADER,
  csvRow({ duplicate_key: 'k1' }),
  csvRow({ duplicate_key: 'k2', payee: 'Taxi', category: 'Transport', transaction_date: '2026-07-03', outflow: '90.00', amount: '-90.00' }),
  csvRow({ duplicate_key: 'k3', is_duplicate: 'true' }),
].join('\n');

async function loadSample() {
  render(<ImportWizard />);
  const file = new File([SAMPLE_CSV], 'master_ledger.csv', { type: 'text/csv' });
  const input = screen.getByLabelText(/choose a local csv file/i);
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(/preview/i)).toBeInTheDocument());
}

describe('ImportWizard', () => {
  it('previews via the pure engine: fresh vs exact vs fuzzy vs flagged', async () => {
    bootStore();
    await loadSample();
    const table = screen.getByRole('table', { name: /import preview/i });
    expect(table.textContent).toContain('Rows parsed');
    // 3 rows: 2 fresh + 1 flagged duplicate
    expect(screen.getByText(/will import/i).closest('tr')?.textContent).toContain('2');
    expect(screen.getByText(/flagged/i).closest('tr')?.textContent).toContain('1');
  });

  it('commit imports the fresh rows through the store', async () => {
    bootStore();
    await loadSample();
    fireEvent.click(screen.getByRole('button', { name: /import 2 transactions/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    const db = useNizamStore.getState().db!;
    expect(db.transactions).toHaveLength(2);
    expect(db.transactions.every((t) => Number.isSafeInteger(t.amount))).toBe(true);
  });

  it('committing the same file twice imports nothing the second time', async () => {
    bootStore();
    await loadSample();
    fireEvent.click(screen.getByRole('button', { name: /import 2 transactions/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

    // Round two with the same file.
    fireEvent.click(screen.getByRole('button', { name: /import another file/i }));
    const file = new File([SAMPLE_CSV], 'master_ledger.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText(/choose a local csv file/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('table', { name: /import preview/i })).toBeInTheDocument());

    expect(screen.getByText(/will import/i).closest('tr')?.textContent).toContain('0');
    fireEvent.click(screen.getByRole('button', { name: /import 0 transactions/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(useNizamStore.getState().db!.transactions).toHaveLength(2); // unchanged
  });

  it('Drive picking requires a signed-in session (drive.file grant on pick)', () => {
    bootStore();
    render(<ImportWizard />);
    expect(screen.getByRole('button', { name: /pick from google drive/i })).toBeDisabled();
  });
});
