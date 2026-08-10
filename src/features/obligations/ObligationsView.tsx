/**
 * NIZAM - Obligations manager: add / edit / delete the obligations safe-to-spend protects.
 * Owning contract: PFOS contract 02 (Data Architecture) section 6 - the obligation registry;
 *   contract 01 section 5.2 - the P0-P3 priority tiers and their override policy.
 * Build phase: PFOS Stage 1, phase 1.5 - obligation editor UI (data entry for real Dv3).
 * Depends on: obligation.types, state/store (mutate), state/actions (newId), components.
 *
 * Pure client work on the Drive DB - no server. This is the primary path for the owner to
 * enter their real obligations, which the safe-to-spend engine then protects.
 */
import { useState } from 'react';
import { useNizamStore } from '@/state/store';
import { newId } from '@/state/actions';
import {
  fundingSequence,
  PRIORITY_OVERRIDE_POLICY,
  OBLIGATION_PRIORITIES,
  OBLIGATION_FREQUENCIES,
  VERIFICATION_SOURCES,
  type Obligation,
  type ObligationPriority,
  type ObligationFrequency,
  type VerificationSource,
} from './obligation.types.ts';
import { MoneyInput } from '@/components/MoneyInput';
import { MoneyCell } from '@/components/MoneyCell';
import { Modal } from '@/components/Modal';
import type { Money } from '@/lib/money/money';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Verification source implies a default confidence (owner never types a raw probability). */
const CONFIDENCE_BY_SOURCE: Record<VerificationSource, number> = {
  statement: 0.97,
  provider: 0.92,
  manual: 0.85,
  inferred: 0.6,
};

const SOURCE_LABEL: Record<VerificationSource, string> = {
  statement: 'From a statement',
  provider: 'From the provider',
  manual: 'Entered manually',
  inferred: 'Inferred / estimated',
};

const FREQ_LABEL: Record<ObligationFrequency, string> = {
  once: 'One-off',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

function ObligationModal(props: { existing: Obligation | null; onClose: () => void }) {
  const mutate = useNizamStore((s) => s.mutate);
  const accounts = useNizamStore((s) => s.db?.accounts ?? []);
  const e = props.existing;
  const [creditor, setCreditor] = useState(e?.creditor ?? '');
  const [priority, setPriority] = useState<ObligationPriority>(e?.priority ?? 'P1');
  const [amountDue, setAmountDue] = useState<Money>(e?.amountDue ?? 0);
  const [minimumDue, setMinimumDue] = useState<Money>(e?.minimumDue ?? 0);
  const [dueDate, setDueDate] = useState(e?.dueDate ?? '');
  const [graceDate, setGraceDate] = useState(e?.graceDate ?? '');
  const [frequency, setFrequency] = useState<ObligationFrequency>(e?.frequency ?? 'monthly');
  const [penalty, setPenalty] = useState<Money>(e?.penalty ?? 0);
  const [autopay, setAutopay] = useState(e?.autopay ?? false);
  const [source, setSource] = useState<VerificationSource>(e?.verificationSource ?? 'manual');
  const [accountId, setAccountId] = useState(e?.accountId ?? '');
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    if (!creditor.trim()) return setError('Enter who is owed.');
    if (amountDue <= 0) return setError('Enter a positive amount due.');
    if (!ISO_DATE.test(dueDate)) return setError('Choose a due date.');
    if (graceDate && !ISO_DATE.test(graceDate)) return setError('The grace date is not a valid date.');
    const minimum = minimumDue > 0 ? minimumDue : amountDue;
    if (minimum > amountDue) return setError('The minimum cannot exceed the amount due.');

    const o: Obligation = {
      id: e?.id ?? newId('ob'),
      creditor: creditor.trim(),
      accountId: accountId || null,
      amountDue,
      minimumDue: minimum,
      dueDate,
      graceDate: graceDate || null,
      frequency,
      priority,
      penalty,
      interestBps: e?.interestBps ?? 0,
      autopay,
      verificationSource: source,
      confidence: CONFIDENCE_BY_SOURCE[source],
      protectedReserve: e?.protectedReserve ?? 0,
    };
    mutate((draft) => {
      const idx = draft.obligations.findIndex((x) => x.id === o.id);
      if (idx >= 0) draft.obligations[idx] = o;
      else draft.obligations.push(o);
    });
    props.onClose();
  }

  return (
    <Modal title={e ? `Edit ${e.creditor}` : 'Add obligation'} onClose={props.onClose}>
      <label className="field">
        <span>Who is owed</span>
        <input
          className="input"
          type="text"
          value={creditor}
          onChange={(ev) => setCreditor(ev.target.value)}
          aria-label="Creditor"
          placeholder="e.g. Landlord, Auto Finance"
        />
      </label>
      <label className="field">
        <span>Priority</span>
        <select
          className="input"
          value={priority}
          onChange={(ev) => setPriority(ev.target.value as ObligationPriority)}
          aria-label="Priority"
        >
          {OBLIGATION_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p} - override {PRIORITY_OVERRIDE_POLICY[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Amount due (EGP)</span>
        <MoneyInput value={amountDue} onCommit={setAmountDue} aria-label="Amount due" />
      </label>
      <label className="field">
        <span>Minimum to avoid penalty (EGP, blank = full amount)</span>
        <MoneyInput value={minimumDue} onCommit={setMinimumDue} aria-label="Minimum due" />
      </label>
      <label className="field">
        <span>Due date</span>
        <input
          className="input"
          type="date"
          value={dueDate}
          onChange={(ev) => setDueDate(ev.target.value)}
          aria-label="Due date"
        />
      </label>
      <label className="field">
        <span>Grace date (optional)</span>
        <input
          className="input"
          type="date"
          value={graceDate}
          onChange={(ev) => setGraceDate(ev.target.value)}
          aria-label="Grace date"
        />
      </label>
      <label className="field">
        <span>Frequency</span>
        <select
          className="input"
          value={frequency}
          onChange={(ev) => setFrequency(ev.target.value as ObligationFrequency)}
          aria-label="Frequency"
        >
          {OBLIGATION_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {FREQ_LABEL[f]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Late penalty (EGP, optional)</span>
        <MoneyInput value={penalty} onCommit={setPenalty} aria-label="Penalty" />
      </label>
      <label className="field">
        <span>How do you know this?</span>
        <select
          className="input"
          value={source}
          onChange={(ev) => setSource(ev.target.value as VerificationSource)}
          aria-label="Verification source"
        >
          {VERIFICATION_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Linked account (optional - enables the statement horizon)</span>
        <select
          className="input"
          value={accountId}
          onChange={(ev) => setAccountId(ev.target.value)}
          aria-label="Linked account"
        >
          <option value="">Not linked</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field field-inline">
        <input
          type="checkbox"
          checked={autopay}
          onChange={(ev) => setAutopay(ev.target.checked)}
          aria-label="Autopay"
        />
        <span>On autopay</span>
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
        <button className="btn" onClick={save}>
          Save obligation
        </button>
      </div>
    </Modal>
  );
}

export function ObligationsView() {
  const db = useNizamStore((s) => s.db);
  const mutate = useNizamStore((s) => s.mutate);
  const [editing, setEditing] = useState<Obligation | null>(null);
  const [adding, setAdding] = useState(false);

  if (!db) return <p className="muted">Loading...</p>;

  const ordered = fundingSequence(db.obligations);

  return (
    <section aria-label="Obligations">
      <div className="month-nav">
        <h2>Obligations</h2>
        <div className="spacer" />
        <button className="btn" onClick={() => setAdding(true)}>
          Add obligation
        </button>
      </div>

      {ordered.length === 0 ? (
        <div className="card">
          <p className="muted">
            No obligations yet. Add your bills, loans, cards, and commitments so safe-to-spend can
            protect them and rank them by harm (P0 first).
          </p>
        </div>
      ) : (
        <table className="table" aria-label="Obligations list">
          <thead>
            <tr>
              <th scope="col">Creditor</th>
              <th scope="col">Priority</th>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col" className="num">
                Minimum
              </th>
              <th scope="col" className="num">
                Due
              </th>
              <th scope="col">Frequency</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((o) => (
              <tr key={o.id}>
                <td>
                  {o.creditor}
                  {o.autopay ? ' (autopay)' : ''}
                </td>
                <td>{o.priority}</td>
                <td className="num">
                  <MoneyCell amount={o.amountDue} />
                </td>
                <td className="num">
                  <MoneyCell amount={o.minimumDue} />
                </td>
                <td className="num">{o.dueDate}</td>
                <td>{FREQ_LABEL[o.frequency]}</td>
                <td>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setEditing(o)}
                    aria-label={`Edit ${o.creditor}`}
                  >
                    Edit
                  </button>{' '}
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() =>
                      mutate((draft) => {
                        draft.obligations = draft.obligations.filter((x) => x.id !== o.id);
                      })
                    }
                    aria-label={`Delete ${o.creditor}`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding ? <ObligationModal existing={null} onClose={() => setAdding(false)} /> : null}
      {editing ? <ObligationModal existing={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}
