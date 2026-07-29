/**
 * NIZAM · Register tests — ledger parity, cleared toggle, running balance, view-only sort/filter
 * Implemented by: KIRO Contract 4 / Phase 4.4
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Register } from './Register';
import { bootStore, fixtureDb, makeTxn } from '../../../tests/helpers/fixtures';
import { useNizamStore } from '@/state/store';
import { transactionsForAccount, runningBalances } from '@/lib/ledger/ledgerStore';

function registerDb() {
  const db = fixtureDb();
  db.transactions.push(
    makeTxn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, payee: 'Salary Co', categoryId: 'cat_income' }),
    makeTxn({ accountId: 'acc_cib', date: '2026-03-05', amount: -30_000, payee: 'Market', categoryId: 'cat_groc', cleared: 'uncleared' }),
    makeTxn({ accountId: 'acc_cib', date: '2026-03-10', amount: -20_000, payee: 'Landlord', categoryId: 'cat_rent' }),
    makeTxn({ accountId: 'acc_hsbc', date: '2026-03-06', amount: -5_000, payee: 'Cafe', categoryId: 'cat_groc' }),
  );
  return db;
}

beforeEach(() => {
  window.location.hash = '#/accounts/acc_cib';
});

describe('Register', () => {
  it('rows equal the ledger read model for the selected account', () => {
    const db = bootStore(registerDb());
    render(<Register />);
    const expected = transactionsForAccount(db, 'acc_cib');
    const table = screen.getByRole('table', { name: /register for cib current/i });
    const rows = within(table).getAllByRole('row').slice(1); // minus header
    expect(rows).toHaveLength(expected.length);
    expect(screen.queryByText('Cafe')).toBeNull(); // other account's txn absent
  });

  it('running balance column matches the canonical ledger order', () => {
    const db = bootStore(registerDb());
    render(<Register />);
    const balances = runningBalances(db, 'acc_cib');
    const table = screen.getByRole('table', { name: /register/i });
    const rows = within(table).getAllByRole('row').slice(1);
    // default sort is date ascending — last cell of each row is the running balance
    rows.forEach((row, i) => {
      const cells = within(row).getAllByRole('cell');
      const last = cells[cells.length - 1];
      const expected = balances[i] ?? 0;
      // integer milliunits -> "NN.NN" display text without float formatting
      const absVal = Math.abs(expected);
      const expectedText = `${Math.trunc(absVal / 1000)}.${String(Math.trunc((absVal % 1000) / 10)).padStart(2, '0')}`;
      expect(last?.textContent ?? '').toContain(expectedText);
    });
  });

  it('the cleared toggle persists through the store', () => {
    bootStore(registerDb());
    render(<Register />);
    const toggle = screen.getByRole('button', { name: /cleared status uncleared for market/i });
    fireEvent.click(toggle);
    const db = useNizamStore.getState().db!;
    const txn = db.transactions.find((t) => t.payee === 'Market');
    expect(txn?.cleared).toBe('cleared');
  });

  it('filtering and sorting are view-only — the store is not mutated', () => {
    const db = bootStore(registerDb());
    const revisionBefore = db.meta.revision;
    const orderBefore = db.transactions.map((t) => t.id);
    render(<Register />);
    fireEvent.change(screen.getByRole('textbox', { name: /filter transactions/i }), {
      target: { value: 'Landlord' },
    });
    fireEvent.click(screen.getByRole('button', { name: /payee/i }));
    const after = useNizamStore.getState().db!;
    expect(after.meta.revision).toBe(revisionBefore);
    expect(after.transactions.map((t) => t.id)).toEqual(orderBefore);
    // filter narrowed the view
    expect(screen.queryByText('Market')).toBeNull();
  });

  it('reconciled rows are locked in the UI', () => {
    const db = registerDb();
    db.transactions.push(
      makeTxn({ accountId: 'acc_cib', date: '2026-03-11', amount: -1_000, payee: 'LockedShop', cleared: 'reconciled' }),
    );
    bootStore(db);
    render(<Register />);
    expect(screen.getByRole('button', { name: /cleared status reconciled for lockedshop/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /edit lockedshop/i })).toBeDisabled();
  });
});
