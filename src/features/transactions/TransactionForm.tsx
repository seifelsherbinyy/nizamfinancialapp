/**
 * NIZAM · Add/edit transaction — inflow/outflow, payee autocomplete, splits, transfers
 * Implemented by: KIRO Contract 4 / Phase 4.5
 * Depends on: transaction.types.ts, state/actions.ts, components/MoneyInput
 *
 * Money enters as decimal text and is converted to integer milliunits at the
 * boundary by MoneyInput (fromDecimal). Split legs must sum EXACTLY to the total.
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
  const [toAccountId, setToAccountId] = useState<string>('');
  const [splits, setSplits] = useState<SplitDraft[]>(
    editing?.splits?.map((s) => ({ categoryId: s.categoryId, amount: s.amount, memo: s.memo })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const amount: Money = inflow - outflow;
  const splitTotal: Money = splits.reduce((t, s) => t + s.amount, 0);
  const splitsBalanced = splits.length === 0 || splitTotal === amount;

  const payeeNames = useMemo(() => (db ? db.payees.map((p) => p.name) : []), [db]);
  if (!db) return null;

  const categories = db.categories.filter((c) => !c.hidden);
  const otherAccounts = db.accounts.filter((a) => !a.closed && a.id !== props.accountId);

  function submit() {
    setError(null);
    if (kind === 'transfer') {
      if (!toAccountId) {
        setError('Pick the account to transfer to.');
        return;
      }
      if (outflow <= 0) {
        setError('Enter a positive transfer amount in Outflow.');
        return;
      }
      mutate((draft) => {
        addTransfer(draft, {
          fromAccountId: props.accountId,
          toAccountId,
          amount: outflow,
          date,
          memo,
        });
      });
      props.onClose();
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
            >
              <option value="">— pick account —</option>
              {otherAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Amount (EGP)</span>
            <MoneyInput value={outflow} onCommit={setOutflow} aria-label="Transfer amount" />
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
