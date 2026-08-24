/**
 * NIZAM - Forecast: deterministic cash-flow outlook (baseline/downside/upside) over horizons.
 * Owning contract: PFOS contract 03 (Decision Engine) section 6 - deterministic scheduled cash
 *   flow + forward path; contract 04 section 14 - every displayed fact has a source + timestamp.
 * Build phase: PFOS Stage 3, phase 3.4 - forecast UI; Visual Upgrade Wave 2 presentation.
 * Depends on: forecast engine, state/store, components/MoneyCell.
 *
 * Presentation only - the forecast is a pure function over cleared cash, expected income, and
 * scheduled obligations. No money math here.
 */
import { useMemo } from 'react';
import { useNizamStore } from '@/state/store';
import {
  forecastAll,
  type HorizonForecast,
  type ScenarioForecast,
  type ScenarioId,
} from '@/features/forecast/forecast';
import { MoneyCell } from '@/components/MoneyCell';
import { SectionHeader } from '@/components/product/SectionHeader.tsx';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function pick(f: HorizonForecast, id: ScenarioId): ScenarioForecast | undefined {
  return f.scenarios.find((s) => s.scenario === id);
}

function pctText(bps: number): string {
  return `${Math.round(bps / 100)}%`;
}

function ForecastCard({ forecast }: { forecast: HorizonForecast }) {
  const baseline = pick(forecast, 'baseline');
  const downside = pick(forecast, 'downside');
  const upside = pick(forecast, 'upside');
  const risky = forecast.probabilityOfShortfallBps > 0;

  return (
    <article className={`forecast-card ${risky ? 'forecast-card-risk' : ''}`}>
      <div className="forecast-card-head">
        <div>
          <span className="forecast-card-kicker">Planning horizon</span>
          <h3>{forecast.horizon.label}</h3>
        </div>
        <span className={`badge money-${risky ? 'negative' : 'positive'}`}>
          {risky ? 'Shortfall risk' : 'No modeled shortfall'}
        </span>
      </div>

      <div className="forecast-card-row">
        <span className="forecast-card-label">Baseline ending cash</span>
        <span className="forecast-card-value">
          {baseline ? (
            <MoneyCell
              amount={baseline.endingBalance}
              rag={baseline.endingBalance < 0 ? 'negative' : undefined}
            />
          ) : (
            '—'
          )}
        </span>
      </div>

      <div className="forecast-card-scenarios" aria-label={`${forecast.horizon.label} scenario comparison`}>
        <div className="forecast-scenario">
          <span className="forecast-card-label">Downside low</span>
          <strong>
            {downside ? (
              <MoneyCell amount={downside.minBalance} rag={downside.shortfall ? 'negative' : undefined} />
            ) : (
              '—'
            )}
          </strong>
        </div>
        <div className="forecast-scenario">
          <span className="forecast-card-label">Upside end</span>
          <strong>{upside ? <MoneyCell amount={upside.endingBalance} /> : '—'}</strong>
        </div>
      </div>

      <div>
        <div className="forecast-risk-row">
          <span className="forecast-card-label">Shortfall probability</span>
          <strong>{pctText(forecast.probabilityOfShortfallBps)}</strong>
        </div>
        <div
          className="forecast-risk-track"
          role="progressbar"
          aria-label={`${forecast.horizon.label} shortfall probability`}
          aria-valuemin={0}
          aria-valuemax={10000}
          aria-valuenow={forecast.probabilityOfShortfallBps}
        >
          <span
            style={{
              width: `${Math.min(100, Math.max(0, forecast.probabilityOfShortfallBps / 100))}%`,
            }}
          />
        </div>
      </div>

      <div className="forecast-card-row">
        <span className="forecast-card-label">Buffer</span>
        <strong>{forecast.bufferDays === null ? 'Set essentials to calculate' : `${forecast.bufferDays} days`}</strong>
      </div>
    </article>
  );
}

export function ForecastView() {
  const db = useNizamStore((s) => s.db);
  const asOf = today();
  const horizons = useMemo<HorizonForecast[]>(() => (db ? forecastAll(db, asOf) : []), [db, asOf]);

  if (!db) return <p className="muted">Loading...</p>;

  return (
    <section className="forecast-page" aria-label="Forecast">
      <SectionHeader
        eyebrow="Forward position"
        title="Cash-flow forecast"
        description="Compare baseline, downside and upside paths across planning horizons. Every value comes from the deterministic forecast engine."
        action={
          <span className="badge" role="status" aria-label="As of date">
            As of {asOf}
          </span>
        }
      />

      {horizons.length === 0 ? (
        <div className="card">
          <p className="muted">No forecast horizon could be calculated from the current data.</p>
        </div>
      ) : (
        <div className="forecast-grid">
          {horizons.map((f) => (
            <ForecastCard key={f.horizon.id} forecast={f} />
          ))}
        </div>
      )}

      <div>
        <SectionHeader
          eyebrow="Dense comparison"
          title="Scenario table"
          description="Use the cards to identify risk quickly; use this table when exact cross-horizon comparison matters."
          level={3}
        />
        <div className="table-wrap">
          <table className="table" aria-label="Forecast by horizon">
            <thead>
              <tr>
                <th scope="col">Horizon</th>
                <th scope="col" className="num">Starting cash</th>
                <th scope="col" className="num">Baseline end</th>
                <th scope="col" className="num">Downside low</th>
                <th scope="col">Shortfall risk</th>
                <th scope="col" className="num">Buffer days</th>
              </tr>
            </thead>
            <tbody>
              {horizons.map((f) => {
                const base = pick(f, 'baseline');
                const down = pick(f, 'downside');
                const risky = f.probabilityOfShortfallBps > 0;
                return (
                  <tr key={f.horizon.id}>
                    <td>{f.horizon.label}</td>
                    <td className="num"><MoneyCell amount={f.startingCash} /></td>
                    <td className="num">
                      {base ? <MoneyCell amount={base.endingBalance} rag={base.endingBalance < 0 ? 'negative' : undefined} /> : '—'}
                    </td>
                    <td className="num">
                      {down ? <MoneyCell amount={down.minBalance} rag={down.shortfall ? 'negative' : undefined} /> : '—'}
                    </td>
                    <td>
                      <span className={`badge money-${risky ? 'negative' : 'positive'}`}>
                        {pctText(f.probabilityOfShortfallBps)}
                      </span>
                    </td>
                    <td className="num">{f.bufferDays === null ? 'set essentials' : `${f.bufferDays}d`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
