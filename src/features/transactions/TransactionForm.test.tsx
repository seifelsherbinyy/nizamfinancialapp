/**
 * NIZAM · TransactionForm tests — splits sum exactly, transfers, decimal boundary, refusal
 * Implemented by: KIRO Contract 4 / Phase 4.5
 * The transfer-edit suite is governed by Contract 6 (multicurrency ledger integrity)
 *   / Phase 6.4 invariant I4.6
 *   (a transfer's two legs move as one unit).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransactionForm } from './TransactionForm.tsx';
import { bootStore } from '../../../tests/helpers/fixtures.ts';
import { useNizamStore } from '@/state/store';
import { addTransfer } from '@/state/actions';
import type { Transaction } from '@/features/transactions/transaction.types';

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

/**
 * Editing a transfer used to call `addTransfer`, which appended a whole second pair and left the
 * original in place — the same movement counted twice in both account balances. Every check below
 * fails against that older form, which is what makes them regression tests rather than decoration.
 */
describe('TransactionForm — editing a transfer patches the pair (C6 Phase 6.4, I4.6)', () => {
  /** Re-read both legs from the live store: a `mutate` replaces the db object wholesale. */
  function legs() {
    const txns = useNizamStore.getState().db!.transactions;
    const out = txns.find((t) => t.accountId === 'acc_cib' && t.transferAccountId === 'acc_hsbc')!;
    const into = txns.find((t) => t.accountId === 'acc_hsbc' && t.transferAccountId === 'acc_cib')!;
    return { out, into, count: txns.length };
  }

  function seedTransfer() {
    bootStore();
    useNizamStore.getState().mutate((draft) => {
      addTransfer(draft, {
        fromAccountId: 'acc_cib',
        toAccountId: 'acc_hsbc',
        amount: 250_000,
        date: '2026-09-01',
        memo: 'seed',
      });
    });
    return legs();
  }

  function openEdit(txn: Transaction, accountId: string) {
    const onClose = vi.fn();
    render(<TransactionForm accountId={accountId} transaction={txn} onClose={onClose} />);
    return onClose;
  }

  function save() {
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  }

  it('appends no second pair and moves both legs together', () => {
    const before = seedTransfer();
    const onClose = openEdit(before.out, 'acc_cib');
    commitMoney(/transfer amount/i, '300');
    save();

    const after = legs();
    expect(after.count).toBe(before.count); // the old form grew this by two
    expect(after.out.id).toBe(before.out.id); // and left these two rows untouched
    expect(after.into.id).toBe(before.into.id);
    expect(after.out.amount).toBe(-300_000);
    expect(after.into.amount).toBe(300_000);
    expect(after.out.transferTransactionId).toBe(after.into.id);
    expect(after.into.transferTransactionId).toBe(after.out.id);
    expect(onClose).toHaveBeenCalled();
  });

  it('mirrors the shared date and memo to the peer, and the peer keeps its own payee', () => {
    const before = seedTransfer();
    openEdit(before.out, 'acc_cib');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-09' } });
    fireEvent.change(screen.getByRole('textbox', { name: /memo/i }), {
      target: { value: 'rent float' },
    });
    save();

    const after = legs();
    expect(after.out.date).toBe('2026-09-09');
    expect(after.into.date).toBe('2026-09-09');
    expect(after.out.memo).toBe('rent float');
    expect(after.into.memo).toBe('rent float');
    // A transfer leg's payee names the peer ACCOUNT, so it is never overwritten with this side's.
    expect(after.into.payee).toBe(before.into.payee);
    expect(after.out.payee).toBe(before.out.payee);
  });

  it('the receiving leg arrives pre-filled with its magnitude and can be saved untouched', () => {
    const before = seedTransfer();
    const onClose = openEdit(before.into, 'acc_hsbc');
    // The old form seeded only `outflow`, which is 0 for a positive row, so its `outflow <= 0`
    // guard rejected this leg before it could be saved at all.
    const box = screen.getByRole('textbox', { name: /transfer amount/i }) as HTMLInputElement;
    expect(box.value).toBe('250');
    save();

    const after = legs();
    expect(after.count).toBe(before.count);
    expect(after.into.amount).toBe(250_000);
    expect(after.out.amount).toBe(-250_000);
    expect(onClose).toHaveBeenCalled();
  });

  it('pins the peer account, because a patch cannot re-point a transfer', () => {
    const before = seedTransfer();
    openEdit(before.out, 'acc_cib');
    const select = screen.getByRole('combobox', {
      name: /transfer to account/i,
    }) as HTMLSelectElement;
    expect(select.value).toBe('acc_hsbc');
    expect(select.disabled).toBe(true);
  });

  it('surfaces a reconciled leg refusal and writes nothing', () => {
    const before = seedTransfer();
    const locked = structuredClone(useNizamStore.getState().db!);
    const lockedOut = locked.transactions.find((t) => t.id === before.out.id)!;
    lockedOut.cleared = 'reconciled';
    useNizamStore.setState({ db: locked });

    const onClose = openEdit(lockedOut, 'acc_cib');
    commitMoney(/transfer amount/i, '900');
    save();

    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((a) => /locked/i.test(a.textContent ?? ''))).toBe(true);
    const after = legs();
    expect(after.count).toBe(before.count);
    expect(after.out.amount).toBe(-250_000);
    expect(after.into.amount).toBe(250_000);
    expect(onClose).not.toHaveBeenCalled();
  });
});
