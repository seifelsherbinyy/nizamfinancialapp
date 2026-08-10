/**
 * NIZAM · Reconcile tests — difference, adjustment closes to zero, lock
 * Implemented by: KIRO Contract 4 / Phase 4.6
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Reconcile } from './Reconcile.tsx';
import { bootStore, fixtureDb, makeTxn } from '../../../tests/helpers/fixtures.ts';
import { useNizamStore } from '@/state/store';
import { accountClearedBalance } from '@/lib/ledger/ledgerStore';
import { setCleared, updateTransaction } from '@/state/actions';

function reconcileDb() {
  const db = fixtureDb();
  db.transactions.push(
    makeTxn({ accountId: 'acc_cib', date: '2026-03-01', amount: 100_000, payee: 'Salary Co', cleared: 'cleared' }),
    makeTxn({ accountId: 'acc_cib', date: '2026-03-05', amount: -30_000, payee: 'Market', cleared: 'cleared' }),
  );
  return db;
}

function setup() {
  bootStore(reconcileDb());
  render(<Reconcile />);
  fireEvent.change(screen.getByRole('combobox', { name: /account to reconcile/i }), {
    target: { value: 'acc_cib' },
  });
}

function enterStatement(text: string) {
  const input = screen.getByRole('textbox', { name: /statement balance/i });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

describe('Reconcile', () => {
  it('entering a statement balance shows the difference vs cleared', () => {
    setup();
    enterStatement('60'); // cleared is 70.000 EGP -> difference −10
    const status = screen.getByRole('status', { name: /reconciliation difference/i });
    expect(status.textContent).toContain('70.00'); // cleared balance
    expect(status.textContent).toContain('10.00'); // difference magnitude
  });

  it('an adjustment transaction closes the difference to zero and locks', () => {
    setup();
    enterStatement('60');
    fireEvent.click(screen.getByRole('button', { name: /create adjustment/i }));

    const db = useNizamStore.getState().db!;
    // Cleared+reconciled balance now equals the statement.
    expect(accountClearedBalance(db, 'acc_cib')).toBe(60_000);
    const adj = db.transactions.find((t) => t.payee === 'Reconciliation Balance Adjustment');
    expect(adj?.amount).toBe(-10_000);
    // Prior cleared rows are locked.
    const locked = db.transactions.filter((t) => t.cleared === 'reconciled');
    expect(locked.length).toBeGreaterThanOrEqual(2);
  });

  it('a zero difference finishes without an adjustment', () => {
    setup();
    enterStatement('70');
    fireEvent.click(screen.getByRole('button', { name: /finish reconciliation/i }));
    const db = useNizamStore.getState().db!;
    expect(db.transactions.some((t) => t.payee === 'Reconciliation Balance Adjustment')).toBe(false);
    expect(db.transactions.filter((t) => t.cleared === 'reconciled')).toHaveLength(2);
  });

  it('locked transactions refuse edits afterwards', () => {
    setup();
    enterStatement('70');
    fireEvent.click(screen.getByRole('button', { name: /finish reconciliation/i }));
    const db = useNizamStore.getState().db!;
    const locked = db.transactions.find((t) => t.cleared === 'reconciled');
    const draft = structuredClone(db);
    expect(() => updateTransaction(draft, locked!.id, { memo: 'nope' })).toThrow(/locked/);
    expect(() => setCleared(draft, locked!.id, 'uncleared')).toThrow(/locked/);
  });
});
