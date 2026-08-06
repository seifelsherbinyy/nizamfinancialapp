/**
 * NIZAM - Forecast: deterministic cash-flow outlook (baseline/downside/upside) over horizons.
 * Owning contract: PFOS contract 03 (Decision Engine) section 6 - deterministic scheduled cash
 *   flow + forward path; contract 04 section 14 - every displayed fact has a source + timestamp.
 * Build phase: PFOS Stage 3, phase 3.4 - forecast UI.
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function pick(f: HorizonForecast, id: ScenarioId): ScenarioForecast | undefined {
  return f.scenarios.find((s) => s.scenario === id);
}

function pctText(bps: number): string {
  return `${Math.round(bps / 100)}%`;
}

export function ForecastView() {
  const db = useNizamStore((s) => s.db);
  const asOf = today();
  const horizons = useMemo<HorizonForecast[]>(() => (db ? forecastAll(db, asOf) : []), [db, asOf]);

  if (!db) return <p className="muted">Loading...</p>;

  return (
    <section aria-label="Forecast">
      <div className="month-nav">
        <h2>Cash-flow forecast</h2>
        <div className="spacer" />
        <span className="badge" role="status" aria-label="As of date">
          As of {asOf}
        </span>
      </div>
      <div className="card">
        <p className="muted">
          A deterministic outlook from your cleared cash, expected income, and scheduled
          obligations. Downside drops uncertain income; upside keeps it. This is a projection you
          can act on - not advice.
        </p>
      </div>
      <table className="table" aria-label="Forecast by horizon">
        <thead>
          <tr>
            <th scope="col">Horizon</th>
            <th scope="col" className="num">
              Starting cash
            </th>
            <th scope="col" className="num">
              Baseline end
            </th>
            <th scope="col" className="num">
              Downside low
            </th>
            <th scope="col">Shortfall risk</th>
            <th scope="col" className="num">
              Buffer days
            </th>
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
                <td className="num">
                  <MoneyCell amount={f.startingCash} />
                </td>
                <td className="num">
                  {base ? (
                    <MoneyCell
                      amount={base.endingBalance}
                      rag={base.endingBalance < 0 ? 'negative' : undefined}
                    />
                  ) : (
                    '-'
                  )}
                </td>
                <td className="num">
                  {down ? (
                    <MoneyCell amount={down.minBalance} rag={down.shortfall ? 'negative' : undefined} />
                  ) : (
                    '-'
                  )}
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
    </section>
  );
}
