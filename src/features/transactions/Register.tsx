/**
 * NIZAM · Account register — sortable/filterable transaction table, running balance
 * Implemented by: KIRO Contract 4 / Phase 4.4
 * Depends on: transaction.types.ts, lib/ledger/ledgerStore.ts, TransactionForm
 *
 * Sorting/filtering are VIEW state only — the store is never mutated by them.
 * The running balance is computed in canonical ledger order (date, then id).
 */
import { useMemo, useState } from 'react';
import { useNizamStore } from '@/state/store';
import { useHashRoute } from '@/app/router';
import { transactionsForAccount, runningBalances } from '@/lib/ledger/ledgerStore';
import { setCleared } from '@/state/actions';
import { MoneyCell } from '@/components/MoneyCell';
import { TransactionForm } from '@/features/transactions/TransactionForm';
import type { Transaction } from '@/features/transactions/transaction.types';
import { outflowOf, inflowOf } from '@/features/transactions/transaction.types';

type SortKey = 'date' | 'amount' | 'payee';
type SortDir = 'asc' | 'desc';

const CLEARED_ICON: Record<Transaction['cleared'], string> = {
  uncleared: '○',
  cleared: '●',
  reconciled: '🔒',
};

export function Register() {
  const db = useNizamStore((s) => s.db);
  const mutate = useNizamStore((s) => s.mutate);
  const route = useHashRoute();
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const accountId = route.param ?? db?.accounts.find((a) => !a.closed)?.id ?? null;

  const rows = useMemo(() => {
    if (!db || !accountId) return [];
    const txns = transactionsForAccount(db, accountId);
    const balances = runningBalances(db, accountId);
    const withBalance = txns.map((t, i) => ({ txn: t, balance: balances[i] ?? 0 }));

    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? withBalance.filter(
          ({ txn }) =>
            txn.payee.toLowerCase().includes(needle) ||
            txn.memo.toLowerCase().includes(needle) ||
            txn.date.includes(needle),
        )
      : withBalance;

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'date')
        return (a.txn.date.localeCompare(b.txn.date) || a.txn.id.localeCompare(b.txn.id)) * dir;
      if (sortKey === 'amount') return (a.txn.amount - b.txn.amount) * dir;
      return a.txn.payee.localeCompare(b.txn.payee) * dir;
    });
  }, [db, accountId, filter, sortKey, sortDir]);

  if (!db) return <p className="muted">Loading…</p>;
  const account = db.accounts.find((a) => a.id === accountId);
  if (!account) {
    return (
      <section aria-label="Register">
        <h2>Accounts</h2>
        <p className="muted">Add an account from the sidebar to start a register.</p>
      </section>
    );
  }

  const categoryName = (t: Transaction): string => {
    if (t.transferAccountId) return 'Transfer';
    if (t.splits && t.splits.length > 0) return 'Split';
    if (!t.categoryId) return '—';
    return db.categories.find((c) => c.id === t.categoryId)?.name ?? '—';
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const cycleCleared = (t: Transaction) => {
    if (t.cleared === 'reconciled') return; // locked
    mutate((draft) => {
      setCleared(draft, t.id, t.cleared === 'uncleared' ? 'cleared' : 'uncleared');
    });
  };

  return (
    <section aria-label="Register">
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>{account.name}</h2>
        <span className="badge">
          Balance <MoneyCell amount={account.balance} rag="zero" />
        </span>
        <div className="spacer" />
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="Filter payee / memo / date"
          aria-label="Filter transactions"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="btn" onClick={() => setAdding(true)}>
          + Add Transaction
        </button>
      </div>

      <table className="table" aria-label={`Register for ${account.name}`}>
        <thead>
          <tr>
            <th scope="col">
              <button className="btn btn-sm btn-secondary" onClick={() => toggleSort('date')}>
                Date {sortKey === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </button>
            </th>
            <th scope="col">
              <button className="btn btn-sm btn-secondary" onClick={() => toggleSort('payee')}>
                Payee {sortKey === 'payee' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </button>
            </th>
            <th scope="col">Category</th>
            <th scope="col">Memo</th>
            <th scope="col" className="num">
              <button className="btn btn-sm btn-secondary" onClick={() => toggleSort('amount')}>
                Outflow {sortKey === 'amount' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </button>
            </th>
            <th scope="col" className="num">Inflow</th>
            <th scope="col">Cleared</th>
            <th scope="col" className="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="muted">
                No transactions yet.
              </td>
            </tr>
          ) : (
            rows.map(({ txn, balance }) => (
              <tr key={txn.id}>
                <td>{txn.date}</td>
                <td>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setEditing(txn)}
                    aria-label={`Edit ${txn.payee} on ${txn.date}`}
                    disabled={txn.cleared === 'reconciled'}
                  >
                    {txn.payee || '—'}
                  </button>
                </td>
                <td>{categoryName(txn)}</td>
                <td className="muted">{txn.memo}</td>
                <td className="num">{outflowOf(txn) > 0 ? <MoneyCell amount={outflowOf(txn)} rag="zero" /> : null}</td>
                <td className="num">{inflowOf(txn) > 0 ? <MoneyCell amount={inflowOf(txn)} rag="zero" /> : null}</td>
                <td>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => cycleCleared(txn)}
                    aria-label={`Cleared status ${txn.cleared} for ${txn.payee} on ${txn.date}`}
                    disabled={txn.cleared === 'reconciled'}
                    title={txn.cleared}
                  >
                    {CLEARED_ICON[txn.cleared]}
                  </button>
                </td>
                <td className="num">
                  <MoneyCell amount={balance} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {adding ? <TransactionForm accountId={account.id} onClose={() => setAdding(false)} /> : null}
      {editing ? (
        <TransactionForm accountId={account.id} transaction={editing} onClose={() => setEditing(null)} />
      ) : null}
    </section>
  );
}
