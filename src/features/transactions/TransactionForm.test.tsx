/**
 * NIZAM · TransactionForm tests — splits sum exactly, transfers, decimal boundary, refusal
 * Implemented by: KIRO Contract 4 / Phase 4.5
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransactionForm } from './TransactionForm.tsx';
import { bootStore } from '../../../tests/helpers/fixtures.ts';
import { useNizamStore } from '@/state/store';

function openForm() {
  const onClose = vi.fn();
  render(<TransactionForm accountId="acc_cib" onClose={onClose} />);
  return onClose;
}

function commitMoney(label: RegExp, text: string) {
  const input = screen.getByRole('textbox', { name: label });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

describe('TransactionForm', () => {
  it('converts decimal entry to integer milliunits at the boundary', () => {
    bootStore();
    const onClose = openForm();
    // an input with a datalist carries the combobox role
    fireEvent.change(screen.getByRole('combobox', { name: /payee/i }), { target: { value: 'Cafe' } });
    commitMoney(/outflow/i, '12.34');
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onClose).toHaveBeenCalled();
    const txn = useNizamStore.getState().db!.transactions.at(-1);
    expect(txn?.amount).toBe(-12_340);
    expect(Number.isSafeInteger(txn?.amount)).toBe(true);
  });

  it('a split entry creates legs whose sum equals the parent amount exactly', () => {
    bootStore();
    openForm();
    commitMoney(/outflow/i, '100');
    fireEvent.click(screen.getByRole('button', { name: /add split/i }));
    fireEvent.click(screen.getByRole('button', { name: /add split/i }));
    commitMoney(/split 1 amount/i, '-60');
    commitMoney(/split 2 amount/i, '-40');
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    const txn = useNizamStore.getState().db!.transactions.at(-1);
    expect(txn?.splits).toHaveLength(2);
    const total = (txn?.splits ?? []).reduce((s, leg) => s + leg.amount, 0);
    expect(total).toBe(txn?.amount);
    expect(txn?.amount).toBe(-100_000);
    expect(txn?.categoryId).toBeNull(); // parent of a split carries no category
  });

  it('refuses an unbalanced split with a visible message', () => {
    const db = bootStore();
    const before = db.transactions.length;
    openForm();
    commitMoney(/outflow/i, '100');
    fireEvent.click(screen.getByRole('button', { name: /add split/i }));
    commitMoney(/split 1 amount/i, '-60'); // 60 != 100
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((a) => /sum exactly/i.test(a.textContent ?? ''))).toBe(true);
    expect(useNizamStore.getState().db!.transactions.length).toBe(before);
  });

  it('a transfer creates two linked rows, opposite signs, no category', () => {
    bootStore();
    openForm();
    fireEvent.change(screen.getByRole('combobox', { name: /transaction type/i }), {
      target: { value: 'transfer' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /transfer to account/i }), {
      target: { value: 'acc_hsbc' },
    });
    commitMoney(/transfer amount/i, '250');
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    const txns = useNizamStore.getState().db!.transactions;
    const out = txns.find((t) => t.accountId === 'acc_cib' && t.transferAccountId === 'acc_hsbc');
    const into = txns.find((t) => t.accountId === 'acc_hsbc' && t.transferAccountId === 'acc_cib');
    expect(out && into).toBeTruthy();
    expect(out!.amount).toBe(-250_000);
    expect(into!.amount).toBe(250_000);
    expect(out!.transferTransactionId).toBe(into!.id);
    expect(into!.transferTransactionId).toBe(out!.id);
    expect(out!.categoryId).toBeNull();
    expect(into!.categoryId).toBeNull();
  });

  it('offers payee autocomplete options from the store', () => {
    const db = bootStore();
    db.payees.push({ id: 'pay_1', name: 'Carrefour' });
    useNizamStore.setState({ db: { ...db } });
    openForm();
    const list = document.getElementById('nizam-payees');
    expect(list?.querySelector('option[value="Carrefour"]')).toBeTruthy();
  });
});
