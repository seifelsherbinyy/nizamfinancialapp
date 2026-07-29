/**
 * NIZAM · Left sidebar accounts section — balances, on/off-budget groups, redaction
 * Implemented by: KIRO Contract 4 / Phase 4.2
 * Depends on: accounts.types.ts, state/store.ts, components/MoneyCell
 */
import { useState } from 'react';
import { useNizamStore } from '@/state/store';
import { useHashRoute } from '@/app/router';
import { redactIdentifier, type Account, type AccountType } from '@/features/accounts/accounts.types';
import { accountBalance } from '@/lib/ledger/ledgerStore';
import { MoneyCell } from '@/components/MoneyCell';
import { MoneyInput } from '@/components/MoneyInput';
import { Modal } from '@/components/Modal';
import { addAccount } from '@/state/actions';
import { sum, type Money } from '@/lib/money/money';

function AccountRow(props: { account: Account; balance: Money; active: boolean }) {
  const { account, balance, active } = props;
  return (
    <a
      className={`sidebar-account ${active ? 'active' : ''}`}
      href={`#/accounts/${account.id}`}
      title={account.accountIdentifier ? redactIdentifier(account.accountIdentifier) : account.name}
    >
      <span>
        {account.name}
        {account.accountIdentifier ? (
          <span className="muted"> {redactIdentifier(account.accountIdentifier)}</span>
        ) : null}
      </span>
      <span className={`money ${balance < 0 ? 'neg' : ''}`}>
        <MoneyCell amount={balance} rag={balance < 0 ? 'negative' : 'zero'} />
      </span>
    </a>
  );
}

function AddAccountModal(props: { onClose: () => void }) {
  const mutate = useNizamStore((s) => s.mutate);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('BANK_OTHER');
  const [identifier, setIdentifier] = useState('');
  const [starting, setStarting] = useState<Money>(0);

  function submit() {
    if (!name.trim()) return;
    mutate((draft) => {
      addAccount(draft, {
        name,
        type,
        onBudget: type !== 'TRACKING',
        accountIdentifier: identifier.trim() || null,
        startingBalance: starting,
      });
    });
    props.onClose();
  }

  return (
    <Modal title="Add Account" onClose={props.onClose}>
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Type</span>
        <select className="input" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
          <option value="CIB_DEBIT">CIB Debit</option>
          <option value="HSBC_CC">HSBC Credit Card</option>
          <option value="CASH">Cash</option>
          <option value="BANK_OTHER">Other Bank</option>
          <option value="CREDIT_OTHER">Other Credit</option>
          <option value="TRACKING">Tracking (off-budget)</option>
        </select>
      </label>
      <label className="field">
        <span>Account identifier (shown as last-4 only)</span>
        <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
      </label>
      <label className="field">
        <span>Starting balance (EGP)</span>
        <MoneyInput value={starting} onCommit={setStarting} aria-label="Starting balance" />
      </label>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn" onClick={submit} disabled={!name.trim()}>
          Add Account
        </button>
      </div>
    </Modal>
  );
}

export function AccountsSidebar() {
  const db = useNizamStore((s) => s.db);
  const route = useHashRoute();
  const [adding, setAdding] = useState(false);

  if (!db) return <div className="sidebar-section">No data yet</div>;

  const open = db.accounts.filter((a) => !a.closed);
  const onBudget = open.filter((a) => a.onBudget);
  const offBudget = open.filter((a) => !a.onBudget);
  const balances = new Map(open.map((a) => [a.id, accountBalance(db, a.id)]));

  const group = (title: string, accounts: Account[]) =>
    accounts.length > 0 && (
      <>
        <div className="sidebar-section">
          {title} · <MoneyCell amount={sum(accounts.map((a) => balances.get(a.id) ?? 0))} rag="zero" />
        </div>
        {accounts
          .sort((a, b) => a.order - b.order)
          .map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              balance={balances.get(a.id) ?? 0}
              active={route.path === '/accounts' && route.param === a.id}
            />
          ))}
      </>
    );

  return (
    <div>
      {group('On Budget', onBudget)}
      {group('Tracking', offBudget)}
      <div style={{ padding: '10px 16px' }}>
        <button className="btn btn-sm" onClick={() => setAdding(true)}>
          + Add Account
        </button>
      </div>
      {adding ? <AddAccountModal onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
