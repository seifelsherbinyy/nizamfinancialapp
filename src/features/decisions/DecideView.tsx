/**
 * NIZAM - Decide route: a purchase request form + the 11-line Decision Card.
 * Owning contract: PFOS contract 04 (Interface) section 4.4 - the Decision Card, in order;
 *   contract 03 section 4 - recommendation states.
 * Build phase: PFOS Stage 2, phase 2.3 - Decide route + card render.
 * Depends on: decision engine (decidePurchase), decision.types, state/store, components.
 *
 * Presentation only. The recommendation and every number come from the deterministic
 * decision engine (contract 03 section 1 - the interface never sources numbers). The
 * card is re-rendered live as the request changes; nothing is written to the ledger here.
 */
import { useMemo, useState } from 'react';
import { useNizamStore } from '@/state/store';
import { decidePurchase } from '@/features/decisions/decision.logic';
import type {
  PurchaseRequest,
  Recommendation,
  PaymentMethod,
  Urgency,
} from '@/features/decisions/decision.types';
import { MoneyInput } from '@/components/MoneyInput';
import { MoneyCell } from '@/components/MoneyCell';
import type { RagState } from '@/styles/theme';
import type { Money } from '@/lib/money/money';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const REC_LABEL: Record<Recommendation, string> = {
  approve: 'Approve',
  approve_with_cap: 'Approve with a cap',
  approve_with_condition: 'Approve with a condition',
  delay: 'Delay',
  alternative: 'Consider an alternative',
  reject: 'Reject',
  financially_blocked: 'Financially blocked',
};

const REC_RAG: Record<Recommendation, RagState> = {
  approve: 'positive',
  approve_with_cap: 'warning',
  approve_with_condition: 'warning',
  delay: 'warning',
  alternative: 'warning',
  reject: 'negative',
  financially_blocked: 'negative',
};

export function DecideView() {
  const db = useNizamStore((s) => s.db);
  const asOf = today();

  const [price, setPrice] = useState<Money>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [urgency, setUrgency] = useState<Urgency>('medium');
  const [reversible, setReversible] = useState<boolean>(true);
  const [purpose, setPurpose] = useState<string>('');
  const [altPrice, setAltPrice] = useState<Money>(0);
  const [accountId, setAccountId] = useState<string>('');

  const request = useMemo<PurchaseRequest>(
    () => ({
      price,
      paymentMethod,
      accountId: accountId || null,
      category: null,
      date: asOf,
      reversible,
      purpose: purpose.trim() ? purpose.trim() : null,
      urgency,
      alternativePrice: altPrice > 0 ? altPrice : null,
    }),
    [price, paymentMethod, accountId, asOf, reversible, purpose, urgency, altPrice],
  );

  const card = useMemo(
    () => (db && price > 0 ? decidePurchase(db, asOf, request) : null),
    [db, asOf, request, price],
  );

  if (!db) return <p className="muted">Loading...</p>;

  return (
    <section aria-label="Decide">
      <div className="month-nav">
        <h2>Decide a purchase</h2>
      </div>

      <div className="card" aria-label="Purchase request">
        <label className="field">
          <span>Price (EGP)</span>
          <MoneyInput value={price} onCommit={setPrice} aria-label="Purchase price" autoFocus />
        </label>
        <label className="field">
          <span>Pay with</span>
          <select
            className="input"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            aria-label="Payment method"
          >
            <option value="cash">Cash / debit</option>
            <option value="credit">Credit card</option>
          </select>
        </label>
        {paymentMethod === 'credit' ? (
          <label className="field">
            <span>Card account (optional)</span>
            <select
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              aria-label="Card account"
            >
              <option value="">Not specified</option>
              {db.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>Urgency</span>
          <select
            className="input"
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as Urgency)}
            aria-label="Urgency"
          >
            <option value="low">Low - can wait</option>
            <option value="medium">Medium</option>
            <option value="high">High - needed now</option>
          </select>
        </label>
        <label className="field">
          <span>A cheaper alternative price, if any (EGP)</span>
          <MoneyInput value={altPrice} onCommit={setAltPrice} aria-label="Alternative price" />
        </label>
        <label className="field field-inline">
          <input
            type="checkbox"
            checked={reversible}
            onChange={(e) => setReversible(e.target.checked)}
            aria-label="Reversible"
          />
          <span>Reversible (can be returned)</span>
        </label>
        <label className="field">
          <span>What is it for? (optional)</span>
          <input
            className="input"
            type="text"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            aria-label="Purpose"
            placeholder="e.g. replacement laptop"
          />
        </label>
      </div>

      {card ? (
        <div className="card" aria-label="Decision card">
          <div
            className={`rta-banner rta-${REC_RAG[card.recommendation]}`}
            role="status"
            aria-label="Recommendation"
          >
            <span>{REC_LABEL[card.recommendation]}</span>
            <span className="rta-amount">
              <MoneyCell amount={request.price} />
            </span>
          </div>

          <p>
            <strong>{card.reason}</strong>
          </p>

          <table className="table" aria-label="Time-horizon impact">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Effect</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Now</td>
                <td>{card.immediateEffect}</td>
              </tr>
              <tr>
                <td>Tomorrow</td>
                <td>{card.nextDayEffect}</td>
              </tr>
              <tr>
                <td>In a week</td>
                <td>{card.oneWeekEffect}</td>
              </tr>
              <tr>
                <td>In a month</td>
                <td>{card.oneMonthEffect}</td>
              </tr>
              <tr>
                <td>In a year</td>
                <td>{card.oneYearEffect}</td>
              </tr>
            </tbody>
          </table>

          <p className="muted" aria-label="Affordability">
            Safe to spend now (cash in hand){' '}
            <MoneyCell amount={card.affordability.safeToSpendInHand} /> - after this purchase{' '}
            <MoneyCell
              amount={card.affordability.remainingInHand}
              rag={card.affordability.remainingInHand < 0 ? 'negative' : undefined}
            />
            {card.affordability.reliesOnExpectedIncome
              ? ' - this relies on expected income arriving.'
              : '.'}
          </p>

          {card.evidence.length > 0 ? (
            <ul aria-label="Evidence">
              {card.evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}

          {card.alternative ? (
            <p>
              <strong>Alternative:</strong> {card.alternative}
            </p>
          ) : null}

          <p className="muted">
            Confidence: {card.confidence.band} ({Math.round(card.confidence.bps / 100)}%)
          </p>
          {card.confidence.missingInformation.length > 0 ? (
            <ul aria-label="Missing information">
              {card.confidence.missingInformation.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}

          <p>
            <strong>Next step:</strong> {card.requiredAction}
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="muted">Enter a price above to see the recommendation.</p>
        </div>
      )}
    </section>
  );
}
