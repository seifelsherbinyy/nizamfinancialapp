/**
 * NIZAM · Reconciliation flow — statement balance vs cleared, adjustment, lock
 * Implemented by: KIRO Contract 4 / Phase 4.6
 * Depends on: accounts.types.ts, state/actions.ts, lib/ledger/ledgerStore.ts
 *
 * Flow: pick account -> enter statement balance -> compare against the CLEARED
 * balance -> optionally create a balance adjustment -> lock (cleared -> reconciled).
 * Locked (reconciled) transactions can no longer be edited (enforced in actions.ts).
 */
import { useState } from 'react';
import { useNizamStore } from '@/state/store';
import { accountClearedBalance, transactionsForAccount } from '@/lib/ledger/ledgerStore';
import { addReconcileAdjustment, lockReconciled, setCleared } from '@/state/actions';
import { MoneyCell } from '@/components/MoneyCell';
import { MoneyInput } from '@/components/MoneyInput';
import type { Money } from '@/lib/money/money';

export function Reconcile() {
  const db = useNizamStore((s) => s.db);
  const mutate = useNizamStore((s) => s.mutate);
  const [accountId, setAccountId] = useState<string>('');
  const [statementBalance, setStatementBalance] = useState<Money>(0);
  const [entered, setEntered] = useState(false);
  const [finished, setFinished] = useState<string | null>(null);

  if (!db) return <p className="muted">Loading…</p>;
  const accounts = db.accounts.filter((a) => !a.closed);
  const account = accounts.find((a) => a.id === accountId) ?? null;

  const clearedBalance = account ? accountClearedBalance(db, account.id) : 0;
  const difference = statementBalance - clearedBalance;

  const clearedTxns = account
    ? transactionsForAccount(db, account.id).filter((t) => t.cleared !== 'uncleared')
    : [];
  const unclearedTxns = account
    ? transactionsForAccount(db, account.id).filter((t) => t.cleared === 'uncleared')
    : [];

  function finish(createAdjustment: boolean) {
    if (!account) return;
    const accId = account.id;
    const today = new Date().toISOString().slice(0, 10);
    mutate((draft) => {
      if (createAdjustment && difference !== 0) {
        addReconcileAdjustment(draft, accId, difference, today);
      }
      const locked = lockReconciled(draft, accId);
      void locked;
    });
    setFinished(
      createAdjustment && difference !== 0
        ? 'Reconciled with a balance adjustment. Cleared transactions are now locked.'
        : 'Reconciled. Cleared transactions are now locked.',
    );
    setEntered(false);
  }

  return (
    <section aria-label="Reconcile">
      <h2>Reconcile</h2>

      <div className="card">
        <label className="field">
          <span>Account</span>
          <select
            className="input"
            value={accountId}
            aria-label="Account to reconcile"
            onChange={(e) => {
              setAccountId(e.target.value);
              setEntered(false);
              setFinished(null);
            }}
          >
            <option value="">— pick account —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        {account ? (
          <>
            <label className="field">
              <span>Statement ending balance (EGP)</span>
              <MoneyInput
                value={statementBalance}
                onCommit={(v) => {
                  setStatementBalance(v);
                  setEntered(true);
                  setFinished(null);
                }}
                aria-label="Statement balance"
              />
            </label>

            {entered ? (
              <div role="status" aria-label="Reconciliation difference">
                <p>
                  Cleared balance: <MoneyCell amount={clearedBalance} rag="zero" />
                  {' · '}Statement: <MoneyCell amount={statementBalance} rag="zero" />
                  {' · '}Difference: <MoneyCell amount={difference} variant="pill" />
                </p>
                {difference === 0 ? (
                  <button className="btn" onClick={() => finish(false)}>
                    Finish reconciliation (lock cleared)
                  </button>
                ) : (
                  <button className="btn" onClick={() => finish(true)}>
                    Create adjustment &amp; finish
                  </button>
                )}
              </div>
            ) : null}

            {finished ? (
              <p className="muted" role="status">
                {finished}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {account && unclearedTxns.length > 0 ? (
        <div className="card">
          <h3>Uncleared transactions — mark cleared if they appear on the statement</h3>
          <table className="table" aria-label="Uncleared transactions">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Payee</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {unclearedTxns.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.payee}</td>
                  <td className="num">
                    <MoneyCell amount={t.amount} />
                  </td>
                  <td>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() =>
                        mutate((draft) => {
                          setCleared(draft, t.id, 'cleared');
                        })
                      }
                      aria-label={`Mark cleared ${t.payee} ${t.date}`}
                    >
                      Mark cleared
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {account && clearedTxns.length > 0 ? (
        <div className="card">
          <h3>Cleared / reconciled</h3>
          <table className="table" aria-label="Cleared transactions">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Payee</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {clearedTxns.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.payee}</td>
                  <td className="num">
                    <MoneyCell amount={t.amount} />
                  </td>
                  <td>{t.cleared === 'reconciled' ? '🔒 locked' : 'cleared'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
