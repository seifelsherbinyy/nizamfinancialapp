/**
 * NIZAM - Decisions registry: every recorded purchase decision and its follow-through.
 * Owning contract: PFOS contract 03 (Decision Engine) section 12 - the decision outcome
 *   registry (a record is immutable once written; the user's action + later outcome attach).
 * Build phase: PFOS Stage 3, phase 3.4 - decision registry UI.
 * Depends on: decisionRegistry (matureDecisions - review-due flag only), decisionRecord.types,
 *   state/store.
 *
 * Pure client work on the Drive DB. The table shows ALL recorded decisions (append-only,
 * newest first). Marking a follow-through updates only userAction - the frozen
 * forecast/recommendation are never rewritten (03 section 12 prohibits rewriting history).
 */
import { useNizamStore } from '@/state/store';
import { matureDecisions } from '@/features/decisions/decisionRegistry';
import type { DecisionAction } from '@/features/decisions/decisionRecord.types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const ACTION_LABEL: Record<DecisionAction, string> = {
  pending: 'Pending',
  followed: 'Followed',
  overrode: 'Overrode',
  ignored: 'Ignored',
};

export function DecisionsView() {
  const db = useNizamStore((s) => s.db);
  const mutate = useNizamStore((s) => s.mutate);

  if (!db) return <p className="muted">Loading...</p>;

  // The registry shows every recorded decision, newest first (append-only history).
  const records = [...db.decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // matureDecisions marks which records are DUE for outcome review (contract 03 section 12).
  const reviewDueIds = new Set(matureDecisions(db.decisions, today()).map((r) => r.id));

  function setAction(id: string, action: DecisionAction) {
    mutate((draft) => {
      const r = draft.decisions.find((x) => x.id === id);
      if (r) r.userAction = action;
    });
  }

  return (
    <section aria-label="Decisions">
      <div className="month-nav">
        <h2>Decisions</h2>
        <div className="spacer" />
        {records.length > 0 ? (
          <span className="badge" role="status" aria-label="Recorded count">
            {records.length} recorded
          </span>
        ) : null}
      </div>
      {records.length === 0 ? (
        <div className="card">
          <p className="muted">
            No decisions recorded yet. Evaluate a purchase on the Decide screen, then record it
            here to build an honest track record of what you decided and whether you followed it.
          </p>
        </div>
      ) : (
        <table className="table" aria-label="Decision registry">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Question</th>
              <th scope="col">Recommendation</th>
              <th scope="col">Confidence</th>
              <th scope="col">Your action</th>
              <th scope="col">Record follow-through</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td className="num">
                  {r.createdAt.slice(0, 10)}
                  {reviewDueIds.has(r.id) ? (
                    <>
                      {' '}
                      <span className="badge money-warning" title="Due for outcome review">
                        review due
                      </span>
                    </>
                  ) : null}
                </td>
                <td>{r.question}</td>
                <td>{r.recommendation}</td>
                <td>
                  {r.confidenceBand} ({Math.round(r.confidenceBps / 100)}%)
                </td>
                <td>{ACTION_LABEL[r.userAction]}</td>
                <td>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setAction(r.id, 'followed')}
                    aria-label={`Mark followed: ${r.question}`}
                  >
                    Followed
                  </button>{' '}
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setAction(r.id, 'overrode')}
                    aria-label={`Mark overrode: ${r.question}`}
                  >
                    Overrode
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
