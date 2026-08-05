/**
 * NIZAM - Command Center: safe-to-spend, obligation protection, and net worth.
 * Owning contract: PFOS contract 04 (Interface) section 2 - the Command Center / Home.
 * Build phase: PFOS Stage 1, phase 1.4 - Command Center UI (net worth composed from Stage 4).
 * Depends on: safeToSpend engine, obligations engine, netWorth engine, state/store, components/MoneyCell.
 *
 * Presentation only. Every number comes from an already-tested pure engine; no money
 * math happens here (contract 03 section 1 - the interface never sources numbers). The
 * budget grid is untouched: safe-to-spend is a NEW figure beside RTA, never a rename (C-4).
 */
import { useMemo } from 'react';
import { useNizamStore } from '@/state/store';
import {
  safeToSpendAllHorizons,
  type SafeToSpendResult,
  type ConfidenceBand,
} from '@/features/safeToSpend/safeToSpend';
import { DEFAULT_POLICY } from '@/features/safeToSpend/policy.types';
import {
  obligationFundingReport,
  worstStatus,
  type ObligationStatus,
} from '@/features/obligations/obligations.logic';
import { netWorth } from '@/features/netWorth/netWorth';
import { MoneyCell } from '@/components/MoneyCell';
import type { RagState } from '@/styles/theme';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const BAND_LABEL: Record<ConfidenceBand, string> = {
  strong: 'Strong',
  evidenced: 'Evidenced',
  provisional: 'Provisional',
  insufficient: 'Insufficient',
};

const STATUS_RAG: Record<ObligationStatus, RagState> = {
  green: 'positive',
  amber: 'warning',
  red: 'negative',
  critical: 'negative',
};

const STATUS_LABEL: Record<ObligationStatus, string> = {
  green: 'Funded',
  amber: 'At risk',
  red: 'Short',
  critical: 'Critical',
};

function pctText(bps: number): string {
  return `${Math.round(bps / 100)}%`;
}

export function CommandCenter() {
  const db = useNizamStore((s) => s.db);
  const asOf = today();

  const horizons = useMemo<SafeToSpendResult[]>(
    () => (db ? safeToSpendAllHorizons(db, asOf) : []),
    [db, asOf],
  );
  const obligations = useMemo(
    () =>
      db
        ? obligationFundingReport(
            db.obligations,
            db.accounts,
            db.transactions,
            db.policy ?? DEFAULT_POLICY,
            asOf,
          )
        : [],
    [db, asOf],
  );
  const nw = useMemo(() => (db ? netWorth(db) : null), [db]);

  if (!db) return <p className="muted">Loading...</p>;

  // Hero window: prefer the next-7-days view, else the first available window.
  const hero = horizons.find((r) => r.horizon.id === '7d') ?? horizons[0];
  const others = horizons.filter((r) => r !== hero);
  const worst = obligations.length > 0 ? worstStatus(obligations) : null;

  return (
    <section aria-label="Command Center">
      <div className="month-nav">
        <h2>Command Center</h2>
        <div className="spacer" />
        <span className="badge" role="status" aria-label="As of date">
          As of {asOf}
        </span>
      </div>

      {/* Safe to spend - the headline answer. */}
      <div className="card" aria-label="Safe to spend">
        {hero ? (
          <>
            <div
              className={`rta-banner rta-${hero.deficit ? 'negative' : 'positive'}`}
              role="status"
              aria-label="Safe to spend"
            >
              <span>Safe to spend / {hero.horizon.label}</span>
              <span className="rta-amount">
                <MoneyCell amount={hero.safeToSpend} rag={hero.deficit ? 'negative' : 'positive'} />
              </span>
            </div>
            <p className="muted">
              About <MoneyCell amount={hero.dailyAllowance} />/day - Confidence:{' '}
              {BAND_LABEL[hero.confidenceBand]} ({pctText(hero.confidenceBps)})
            </p>
            {hero.deficit ? (
              <p className="error-text" role="alert">
                Over-committed: protected costs exceed available funds for this window.
              </p>
            ) : null}
            <p>
              <strong>Main risk:</strong> {hero.primaryRisk}
            </p>
            {hero.whatWouldImprove.length > 0 ? (
              <ul aria-label="What would improve confidence">
                {hero.whatWouldImprove.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="muted">No spending window could be computed.</p>
        )}
      </div>

      {/* The remaining horizons at a glance. */}
      {others.length > 0 ? (
        <table className="table" aria-label="Safe to spend by horizon">
          <thead>
            <tr>
              <th scope="col">Window</th>
              <th scope="col" className="num">
                Safe to spend
              </th>
              <th scope="col" className="num">
                Per day
              </th>
              <th scope="col">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {others.map((r) => (
              <tr key={r.horizon.id}>
                <td>{r.horizon.label}</td>
                <td className="num">
                  <MoneyCell
                    amount={r.safeToSpend}
                    rag={r.deficit ? 'negative' : undefined}
                    variant="pill"
                  />
                </td>
                <td className="num">
                  <MoneyCell amount={r.dailyAllowance} />
                </td>
                <td>
                  {BAND_LABEL[r.confidenceBand]} ({pctText(r.confidenceBps)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {/* Obligation protection. */}
      <div className="month-nav">
        <h3>Upcoming obligations</h3>
        {worst ? (
          <span
            className={`badge money-${STATUS_RAG[worst]}`}
            role="status"
            aria-label="Worst obligation status"
          >
            {STATUS_LABEL[worst]}
          </span>
        ) : null}
      </div>
      {obligations.length === 0 ? (
        <div className="card">
          <p className="muted">
            No obligations tracked yet. Add bills, loans, and cards so safe-to-spend can protect
            them.
          </p>
        </div>
      ) : (
        <table className="table" aria-label="Obligation protection">
          <thead>
            <tr>
              <th scope="col">Creditor</th>
              <th scope="col">Priority</th>
              <th scope="col" className="num">
                Due
              </th>
              <th scope="col" className="num">
                Reserved
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {obligations.map((l) => (
              <tr key={l.obligation.id}>
                <td>{l.obligation.creditor}</td>
                <td>{l.obligation.priority}</td>
                <td className="num">
                  {l.obligation.dueDate}
                  {l.overdue ? ' (overdue)' : ''}
                </td>
                <td className="num">
                  <MoneyCell amount={l.required} />
                </td>
                <td>
                  <span className={`badge money-${STATUS_RAG[l.status]}`} title={l.reason}>
                    {STATUS_LABEL[l.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Net worth (Stage 4). */}
      <h3>Net worth</h3>
      {nw ? (
        <div className="card" aria-label="Net worth">
          {nw.unratedCurrencies.length > 0 ? (
            <p className="error-text" role="alert">
              {nw.unratedCurrencies.length} currency value(s) omitted for a missing FX rate:{' '}
              {nw.unratedCurrencies.join(', ')}. Add rates to include them.
            </p>
          ) : null}
          <table className="table" aria-label="Net worth views">
            <tbody>
              <tr>
                <td>Nominal</td>
                <td className="num">
                  <MoneyCell amount={nw.nominal} variant="pill" />
                </td>
              </tr>
              <tr>
                <td>Liquid</td>
                <td className="num">
                  <MoneyCell amount={nw.liquid} />
                </td>
              </tr>
              <tr>
                <td>Liquidation (after haircuts)</td>
                <td className="num">
                  <MoneyCell amount={nw.liquidation} />
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted">Figures in {nw.referenceCurrency}.</p>
        </div>
      ) : null}
    </section>
  );
}
