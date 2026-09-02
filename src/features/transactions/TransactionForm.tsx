/**
 * NIZAM · Add/edit transaction — inflow/outflow, payee autocomplete, splits, transfers
 * Implemented by: KIRO Contract 4 / Phase 4.5
 * Transfer editing is additionally governed by Contract 6 (multicurrency ledger integrity)
 *   / Phase 6.4 invariant I4.6:
 *   a transfer's two legs move as one unit, never one edited and its peer left stale.
 * Depends on: transaction.types.ts, state/actions.ts, components/MoneyInput
 *
 * Money enters as decimal text and is converted to integer milliunits at the
 * boundary by MoneyInput (fromDecimal). Split legs must sum EXACTLY to the total.
 *
 * ## Editing a transfer is a PATCH, never a second create
 *
 * `addTransfer` is now reachable only when there is no `editing` row. Routing an edit to it
 * appended a whole second pair and left the original untouched, double-counting the movement in
 * both account balances. The edit path sends `date`, `memo` and `amount` to `updateTransaction`,
 * which resolves the peer before mutating anything and mirrors the amount negated, so the pair
 * cannot be left half-changed (C6 I4.6). The three fields it does not send are the three a
 * transfer leg has no honest place for: `payee` names the peer account, and a transfer carries
 * neither a category nor an allocation set (vNext T1).
 *
 * The two accounts are fixed once a transfer exists: `TransactionPatch` carries no
 * `transferAccountId`, so re-pointing one is a delete plus a re-add. The select is disabled in
 * edit mode rather than accepting a change it would silently discard.
 */
import { useMemo, useState } from 'react';
import { useNizamStore } from '@/state/store';
import { Modal } from '@/components/Modal';
import { MoneyInput } from '@/components/MoneyInput';
import { MoneyCell } from '@/components/MoneyCell';
import {
  addTransaction,
  addTransfer,
  updateTransaction,
} from '@/state/actions';
import type { Transaction } from '@/features/transactions/transaction.types';
import type { Money } from '@/lib/money/money';

export interface TransactionFormProps {
  accountId: string;
  /** Existing transaction -> edit mode. */
  transaction?: Transaction | null;
  onClose: () => void;
}

interface SplitDraft {
  categoryId: string | null;
  amount: Money;
  memo: string;
}

export function TransactionForm(props: TransactionFormProps) {
  const db = useNizamStore((s) => s.db);
  const mutate = useNizamStore((s) => s.mutate);
  const editing = props.transaction ?? null;

  const [kind, setKind] = useState<'standard' | 'transfer'>(
    editing?.transferAccountId ? 'transfer' : 'standard',
  );
  const [date, setDate] = useState(editing?.date ?? new Date().toISOString().slice(0, 10));
  const [payee, setPayee] = useState(editing?.payee ?? '');
  const [categoryId, setCategoryId] = useState<string>(editing?.categoryId ?? '');
  const [memo, setMemo] = useState(editing?.memo ?? '');
  const [outflow, setOutflow] = useState<Money>(editing && editing.amount < 0 ? -editing.amount : 0);
  const [inflow, setInflow] = useState<Money>(editing && editing.amount > 0 ? editing.amount : 0);
  const [toAccountId, setToAccountId] = useState<string>(editing?.transferAccountId ?? '');
  /**
   * A transfer carries one magnitude, not an outflow/inflow pair, so it is held apart from
   * `outflow`. That separation is what makes the RECEIVING leg editable: its amount is positive,
   * so seeding only `outflow` left it at 0 and the `outflow <= 0` guard rejected the leg before
   * it could be saved at all. The sign is restored from the leg being edited, never from which
   * box was typed into.
   */
  const [transferAmount, setTransferAmount] = useState<Money>(editing ? Math.abs(editing.amount) : 0);
  const [splits, setSplits] = useState<SplitDraft[]>(
    editing?.splits?.map((s) => ({ categoryId: s.categoryId, amount: s.amount, memo: s.memo })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const amount: Money = inflow - outflow;
  /** +1 when the row being edited is the receiving leg, -1 when it is the sending leg. */
  const transferLegSign = editing && editing.amount > 0 ? 1 : -1;
  const splitTotal: Money = splits.reduce((t, s) => t + s.amount, 0);
  const splitsBalanced = splits.length === 0 || splitTotal === amount;

  const payeeNames = useMemo(() => (db ? db.payees.map((p) => p.name) : []), [db]);
  if (!db) return null;

  const categories = db.categories.filter((c) => !c.hidden);
  const otherAccounts = db.accounts.filter((a) => !a.closed && a.id !== props.accountId);
  // `otherAccounts` hides closed accounts, but a transfer's peer may have been closed since the
  // pair was created. Without re-admitting it the disabled select would render blank and hide
  // which account the pair actually points at.
  const peerAccountId = editing?.transferAccountId ?? null;
  const peerAccount = peerAccountId ? (db.accounts.find((a) => a.id === peerAccountId) ?? null) : null;
  const transferTargets =
    peerAccount && !otherAccounts.some((a) => a.id === peerAccount.id)
      ? [...otherAccounts, peerAccount]
      : otherAccounts;

  function submit() {
    setError(null);
    if (kind === 'transfer') {
      if (!toAccountId) {
        setError('Pick the account to transfer to.');
        return;
      }
      if (transferAmount <= 0) {
        setError('Enter a positive transfer amount.');
        return;
      }
      try {
        mutate((draft) => {
          if (editing) {
            // A patch of the pair that already exists — NOT a second addTransfer.
            // `updateTransaction` mirrors date and memo to the peer and mirrors the amount
            // negated, so both legs move together or neither does (C6 I4.6).
            updateTransaction(draft, editing.id, {
              date,
              memo,
              amount: transferLegSign * transferAmount,
            });
          } else {
            addTransfer(draft, {
              fromAccountId: props.accountId,
              toAccountId,
              amount: transferAmount,
              date,
              memo,
            });
          }
        });
        props.onClose();
      } catch (e) {
        // A refusal — a reconciled leg, a cross-currency pair — has to reach the owner. `mutate`
        // applies the change to a clone and commits only on success, so nothing is half-written.
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    if (amount === 0) {
      setError('Enter an outflow or an inflow.');
      return;
    }
    if (splits.length > 0 && !splitsBalanced) {
      setError('Split legs must sum exactly to the transaction amount.');
      return;
    }
    try {
      mutate((draft) => {
        if (editing) {
          updateTransaction(draft, editing.id, {
            date,
            payee,
            categoryId: splits.length > 0 ? null : categoryId || null,
            memo,
            amount,
            splits:
              splits.length > 0
                ? splits.map((s, i) => ({ ...s, id: editing.splits?.[i]?.id ?? `spl_${i}` }))
                : null,
          });
        } else {
          addTransaction(draft, {
            accountId: props.accountId,
            date,
            payee,
            categoryId: categoryId || null,
            amount,
            memo,
            splits: splits.length > 0 ? splits : null,
          });
        }
      });
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal title={editing ? 'Edit Transaction' : 'Add Transaction'} onClose={props.onClose}>
      {!editing ? (
        <label className="field">
          <span>Type</span>
          <select
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'standard' | 'transfer')}
            aria-label="Transaction type"
          >
            <option value="standard">Standard</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>
      ) : null}

      <label className="field">
        <span>Date</span>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      {kind === 'transfer' ? (
        <>
          <label className="field">
            <span>To account</span>
            <select
              className="input"
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              aria-label="Transfer to account"
              disabled={editing !== null}
            >
              <option value="">— pick account —</option>
              {transferTargets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {editing ? (
              <span className="muted">
                A transfer's two accounts are fixed. To move it elsewhere, delete this transfer and
                add a new one.
              </span>
            ) : null}
          </label>
          <label className="field">
            <span>Amount (EGP)</span>
            <MoneyInput value={transferAmount} onCommit={setTransferAmount} aria-label="Transfer amount" />
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span>Payee</span>
            <input
              className="input"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              list="nizam-payees"
              aria-label="Payee"
            />
            <datalist id="nizam-payees">
              {payeeNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          {splits.length === 0 ? (
            <label className="field">
              <span>Category</span>
              <select
                className="input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                aria-label="Category"
              >
                <option value="">— uncategorized —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div style={{ display: 'flex', gap: 10 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Outflow (EGP)</span>
              <MoneyInput
                value={outflow}
                onCommit={(v) => {
                  setOutflow(v);
                  if (v !== 0) setInflow(0);
                }}
                aria-label="Outflow"
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Inflow (EGP)</span>
              <MoneyInput
                value={inflow}
                onCommit={(v) => {
                  setInflow(v);
                  if (v !== 0) setOutflow(0);
                }}
                aria-label="Inflow"
              />
            </label>
          </div>

          <div className="field">
            <span className="muted">Splits</span>
            {splits.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <select
                  className="input"
                  value={s.categoryId ?? ''}
                  aria-label={`Split ${i + 1} category`}
                  onChange={(e) =>
                    setSplits(splits.map((x, j) => (j === i ? { ...x, categoryId: e.target.value || null } : x)))
                  }
                >
                  <option value="">— uncategorized —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <MoneyInput
                  value={s.amount}
                  aria-label={`Split ${i + 1} amount`}
                  onCommit={(v) => setSplits(splits.map((x, j) => (j === i ? { ...x, amount: v } : x)))}
                />
                <button
                  className="btn btn-sm btn-secondary"
                  aria-label={`Remove split ${i + 1}`}
                  onClick={() => setSplits(splits.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => setSplits([...splits, { categoryId: null, amount: 0, memo: '' }])}
            >
              + Add split
            </button>
            {splits.length > 0 ? (
              <p className={splitsBalanced ? 'muted' : 'error-text'} role={splitsBalanced ? undefined : 'alert'}>
                Split total <MoneyCell amount={splitTotal} rag="zero" /> of{' '}
                <MoneyCell amount={amount} rag="zero" />
                {splitsBalanced ? ' — balanced' : ' — must sum exactly to the amount'}
              </p>
            ) : null}
          </div>
        </>
      )}

      <label className="field">
        <span>Memo</span>
        <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} aria-label="Memo" />
      </label>

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn" onClick={submit}>
          {editing ? 'Save' : 'Add'}
        </button>
      </div>
    </Modal>
  );
}
