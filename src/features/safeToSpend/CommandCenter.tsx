/**
 * NIZAM - Command Center: safe-to-spend, obligation protection, and net worth.
 * Owning contract: PFOS contract 04 (Interface) section 2 - the Command Center / Home.
 * Build phase: PFOS Stage 1, phase 1.4; visual composition enhanced in Visual Upgrade Wave 1.
 * Depends on: safeToSpend engine, obligations engine, netWorth engine, state/store, product components.
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
import { applySampleData } from '@/features/demo/sampleData';
import { MoneyCell } from '@/components/MoneyCell';
import { FinancialMetric } from '@/components/product/FinancialMetric';
import { SafeToSpendHero } from '@/components/product/SafeToSpendHero';
import { SectionHeader } from '@/components/product/SectionHeader';
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
  const mutate = useNizamStore((s) => s.mutate);
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

  if (db.accounts.length === 0) {
    return (
      <section className="page-stack" aria-label="Command Center">
        <SectionHeader
          eyebrow="Overview"
          title="Your financial position"
          description="A decision-first view of liquidity, obligations, confidence and net worth."
          level={1}
        />
        <div className="surface">
          <span className="section-eyebrow">Start safely</span>
          <h2>No accounts yet</h2>
          <p className="muted">
            Load a fully-worked sample portfolio to explore safe-to-spend, obligation protection,
            the decision engine and multi-currency net worth with demonstration data.
          </p>
          <button
            className="btn"
            onClick={() => mutate((draft) => applySampleData(draft, new Date().toISOString()))}
          >
            Load sample data
          </button>
          <p className="muted">Sample data only — adding your own accounts replaces this state.</p>
        </div>
      </section>
    );
  }

  const hero = horizons.find((r) => r.horizon.id === '7d') ?? horizons[0];
  const others = horizons.filter((r) => r !== hero);
  const worst = obligations.length > 0 ? worstStatus(obligations) : null;

  return (
    <section className="page-stack" aria-label="Command Center">
      <SectionHeader
        eyebrow="Overview"
        title="Your financial position"
        description="What is safe now, what is due next, and where the plan is under pressure."
        level={1}
        action={
          <span className="badge" role="status" aria-label="As of date">
            As of {asOf}
          </span>
        }
      />

      {hero ? (
        <SafeToSpendHero
          horizonLabel={hero.horizon.label}
          amount={hero.safeToSpend}
          dailyAllowance={hero.dailyAllowance}
          confidenceLabel={BAND_LABEL[hero.confidenceBand]}
          confidencePercent={pctText(hero.confidenceBps)}
          confidenceBps={hero.confidenceBps}
          primaryRisk={hero.primaryRisk}
          deficit={hero.deficit}
        />
      ) : (
        <div className="surface" role="status">
          <p className="muted">No spending window could be computed.</p>
        </div>
      )}

      {hero?.deficit ? (
        <div className="surface" role="alert">
          <span className="section-eyebrow">Action required</span>
          <strong>Protected costs exceed available funds for this window.</strong>
          <p className="error-text">Review the highest-priority obligations before discretionary spending.</p>
        </div>
      ) : null}

      <div className="dashboard-grid">
        <div>
          <SectionHeader
            eyebrow="Runway"
            title="Safe-to-spend horizons"
            description="Compare near-term flexibility without hiding the confidence behind each window."
            level={2}
          />
          {others.length > 0 ? (
            <div className="horizon-grid" aria-label="Safe to spend by horizon">
              {others.map((r) => (
                <article className="horizon-card" key={r.horizon.id}>
                  <div className="horizon-card-top">
                    <strong>{r.horizon.label}</strong>
                    <span>{BAND_LABEL[r.confidenceBand]}</span>
                  </div>
                  <div className="horizon-card-amount">
                    <MoneyCell amount={r.safeToSpend} rag={r.deficit ? 'negative' : undefined} />
                  </div>
                  <div className="horizon-card-meta">
                    <MoneyCell amount={r.dailyAllowance} /> / day · {pctText(r.confidenceBps)} confidence
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="surface surface-subtle">
              <p className="muted">No additional horizons available.</p>
            </div>
          )}
        </div>

        <div>
          <SectionHeader eyebrow="Position" title="Balance-sheet view" level={2} />
          {nw ? (
            <div className="position-panel" aria-label="Net worth position">
              <FinancialMetric label="Net worth" value={nw.nominal} emphasis="hero" />
              <div className="position-metrics">
                <FinancialMetric label="Liquid" value={nw.liquid} supporting={nw.referenceCurrency} />
                <FinancialMetric
                  label="Liquidation"
                  value={nw.liquidation}
                  supporting="After haircuts"
                />
              </div>
              {nw.unratedCurrencies.length > 0 ? (
                <p className="error-text" role="alert">
                  {nw.unratedCurrencies.length} currency value(s) omitted for missing FX rates:{' '}
                  {nw.unratedCurrencies.join(', ')}.
                </p>
              ) : (
                <p className="muted">All tracked currency values are represented.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <SectionHeader
          eyebrow="Protection"
          title="Upcoming obligations"
          description="Highest consequence liabilities remain visible before lower-priority spending."
          level={2}
          action={
            worst ? (
              <span
                className={`badge money-${STATUS_RAG[worst]}`}
                role="status"
                aria-label="Worst obligation status"
              >
                {STATUS_LABEL[worst]}
              </span>
            ) : undefined
          }
        />
        {obligations.length === 0 ? (
          <div className="surface surface-subtle">
            <p className="muted">
              No obligations tracked yet. Add bills, loans and cards so safe-to-spend can protect them.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Obligation protection">
              <thead>
                <tr>
                  <th scope="col">Creditor</th>
                  <th scope="col">Priority</th>
                  <th scope="col" className="num">Due</th>
                  <th scope="col" className="num">Reserved</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((line) => (
                  <tr key={line.obligation.id}>
                    <td>{line.obligation.creditor}</td>
                    <td>{line.obligation.priority}</td>
                    <td className="num">
                      {line.obligation.dueDate}{line.overdue ? ' (overdue)' : ''}
                    </td>
                    <td className="num"><MoneyCell amount={line.required} /></td>
                    <td>
                      <span className={`badge money-${STATUS_RAG[line.status]}`} title={line.reason}>
                        {STATUS_LABEL[line.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {hero && hero.whatWouldImprove.length > 0 ? (
        <div>
          <SectionHeader
            eyebrow="Data quality"
            title="What would improve confidence"
            description="These are evidence gaps from the existing deterministic safe-to-spend result."
            level={2}
          />
          <div className="surface surface-subtle">
            <ul aria-label="What would improve confidence">
              {hero.whatWouldImprove.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
