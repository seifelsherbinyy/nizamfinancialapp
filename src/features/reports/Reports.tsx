/**
 * NIZAM · Reports view — spending, net worth, age of money + rescue widgets
 * Implemented by: KIRO Contract 5 / Phase 5.1 + Phase 5.2
 * Depends on: spending.ts, netWorth.ts, ageOfMoney.ts, rescue.ts
 *
 * Charts are hand-rolled inline SVG (no canvas, no chart library).
 * Rescue widgets cite their formula source from docs/research/ (see rescue.ts).
 * Personal analytics only — not regulated financial advice.
 */
import { useMemo, useState } from 'react';
import { useNizamStore } from '@/state/store';
import { spendingByCategory, activityMonths, totalSpending } from '@/features/reports/spending';
import { netWorthSeries } from '@/features/reports/netWorth';
import { ageOfMoney } from '@/features/reports/ageOfMoney';
import {
  cardUtilization,
  debtServiceRatio,
  liquidityRunway,
  controlPanel,
  bpsToPercentText,
  tenthsToText,
} from '@/features/reports/rescue';
import { MoneyCell } from '@/components/MoneyCell';
import type { MonthKey } from '@/features/budget/budget.types';

function currentMonthKey(): MonthKey {
  return new Date().toISOString().slice(0, 7);
}

/** Horizontal bar chart (inline SVG). Values are milliunits. */
function BarChart(props: { data: { label: string; value: number }[]; ariaLabel: string }) {
  const max = Math.max(1, ...props.data.map((d) => d.value));
  const rowH = 24;
  const labelW = 170;
  const chartW = 460;
  return (
    <svg
      role="img"
      aria-label={props.ariaLabel}
      width={labelW + chartW}
      height={props.data.length * rowH + 4}
    >
      {props.data.map((d, i) => {
        const w = Math.max(2, Math.round((chartW * d.value) / max));
        const y = i * rowH;
        return (
          <g key={d.label}>
            <text x={labelW - 8} y={y + 16} textAnchor="end" fontSize={12} fill="#68707f">
              {d.label}
            </text>
            <rect x={labelW} y={y + 4} width={w} height={rowH - 10} rx={3} fill="#3a5bdc" />
          </g>
        );
      })}
    </svg>
  );
}

/** Line chart for the net-worth series (inline SVG). */
function LineChart(props: { points: { month: string; net: number }[]; ariaLabel: string }) {
  const w = 630;
  const h = 180;
  const pad = 30;
  const { points } = props;
  if (points.length === 0) return null;
  const min = Math.min(0, ...points.map((p) => p.net));
  const max = Math.max(1, ...points.map((p) => p.net));
  const x = (i: number) =>
    pad + (points.length === 1 ? 0 : Math.round(((w - 2 * pad) * i) / (points.length - 1)));
  const y = (v: number) => pad + Math.round(((h - 2 * pad) * (max - v)) / Math.max(1, max - min));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.net)}`).join(' ');
  const zeroY = y(0);
  return (
    <svg role="img" aria-label={props.ariaLabel} width={w} height={h}>
      <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY} stroke="#dde1e7" />
      <path d={path} fill="none" stroke="#3a5bdc" strokeWidth={2} />
      {points.map((p, i) => (
        <circle key={p.month} cx={x(i)} cy={y(p.net)} r={3} fill="#3a5bdc">
          <title>{`${p.month}: ${p.net}`}</title>
        </circle>
      ))}
      <text x={pad} y={h - 6} fontSize={11} fill="#68707f">
        {points[0]?.month}
      </text>
      <text x={w - pad} y={h - 6} fontSize={11} fill="#68707f" textAnchor="end">
        {points[points.length - 1]?.month}
      </text>
    </svg>
  );
}

export function Reports() {
  const db = useNizamStore((s) => s.db);
  const months = useMemo(() => (db ? activityMonths(db) : []), [db]);
  const [month, setMonth] = useState<MonthKey>(() => currentMonthKey());
  const effectiveMonth = months.includes(month) ? month : (months[months.length - 1] ?? month);

  if (!db) return <p className="muted">Loading…</p>;

  const slices = spendingByCategory(db, effectiveMonth).slice(0, 12);
  const netWorth = netWorthSeries(db);
  const aom = ageOfMoney(db);
  const cards = cardUtilization(db);
  const dsr = debtServiceRatio(db, effectiveMonth);
  const runway = liquidityRunway(db, effectiveMonth);
  const panel = controlPanel(db, effectiveMonth);

  return (
    <section aria-label="Reports">
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Reports</h2>
        <div className="spacer" />
        <label className="field" style={{ margin: 0 }}>
          <span className="muted">Month</span>
          <select
            className="input"
            value={effectiveMonth}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Report month"
          >
            {(months.length > 0 ? months : [effectiveMonth]).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        <h3>Spending by category — {effectiveMonth}</h3>
        <p className="muted">
          Total <MoneyCell amount={totalSpending(db, effectiveMonth)} rag="zero" />
        </p>
        {slices.length === 0 ? (
          <p className="muted">No categorized spending this month.</p>
        ) : (
          <BarChart
            ariaLabel="Spending by category"
            data={slices.map((s) => ({ label: s.categoryName, value: s.spent }))}
          />
        )}
      </div>

      <div className="card">
        <h3>Net worth</h3>
        {netWorth.length === 0 ? (
          <p className="muted">No transactions yet.</p>
        ) : (
          <>
            <LineChart
              ariaLabel="Net worth by month"
              points={netWorth.map((p) => ({ month: p.month, net: p.net }))}
            />
            <p className="muted">
              Latest: assets <MoneyCell amount={netWorth[netWorth.length - 1]?.assets ?? 0} rag="zero" /> ·
              liabilities <MoneyCell amount={netWorth[netWorth.length - 1]?.liabilities ?? 0} rag="zero" /> ·
              net <MoneyCell amount={netWorth[netWorth.length - 1]?.net ?? 0} variant="pill" />
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h3>Age of Money</h3>
        <p>
          {aom === null ? (
            <span className="muted">Not enough funded spending yet.</span>
          ) : (
            <strong>{aom} days</strong>
          )}{' '}
          <span className="muted">— average age of the cash behind your last spends</span>
        </p>
      </div>

      <h2>Rescue analytics</h2>
      <p className="muted">
        Personal analytics from the research corpus (docs/research/) — not financial advice.
      </p>

      <div className="card">
        <h3>Card utilization</h3>
        <p className="muted">Formula: docs/research/egypt-iscore-fastest-levers.md — keep each card under 30%, ideally under 10%.</p>
        {cards.length === 0 ? (
          <p className="muted">No credit accounts.</p>
        ) : (
          <table className="table" aria-label="Card utilization">
            <thead>
              <tr>
                <th scope="col">Card</th>
                <th scope="col" className="num">Debt</th>
                <th scope="col" className="num">Limit</th>
                <th scope="col" className="num">Utilization</th>
                <th scope="col">Band</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.accountId}>
                  <td>{c.accountName}</td>
                  <td className="num"><MoneyCell amount={c.debt} rag="zero" /></td>
                  <td className="num">{c.creditLimit !== null ? <MoneyCell amount={c.creditLimit} rag="zero" /> : '—'}</td>
                  <td className="num">{c.utilizationBps !== null ? bpsToPercentText(c.utilizationBps) : '—'}</td>
                  <td>
                    <span className={`badge money-${c.band === 'ok' ? 'positive' : c.band === 'elevated' ? 'warning' : 'negative'}`}>
                      {c.band}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Debt service ratio — {effectiveMonth}</h3>
        <p className="muted">Formula: docs/research/egypt-loan-readiness-dashboard.md — lenders cap total installments near 50% of income.</p>
        <p>
          Income <MoneyCell amount={dsr.income} rag="zero" /> · debt payments{' '}
          <MoneyCell amount={dsr.debtPayments} rag="zero" /> · ratio{' '}
          <strong>{dsr.ratioBps !== null ? bpsToPercentText(dsr.ratioBps) : '—'}</strong>{' '}
          <span className={`badge money-${dsr.band === 'ok' ? 'positive' : dsr.band === 'elevated' ? 'warning' : 'negative'}`}>
            {dsr.band}
          </span>
        </p>
      </div>

      <div className="card">
        <h3>Liquidity runway</h3>
        <p className="muted">Formula: docs/research/egypt-liquidity-buffer-debt-paydown.md — liquid cash ÷ average monthly spend.</p>
        <p>
          Liquid <MoneyCell amount={runway.liquid} rag="zero" /> · average monthly spend{' '}
          <MoneyCell amount={runway.avgMonthlySpend} rag="zero" /> · runway{' '}
          <strong>
            {runway.runwayTenthsOfMonth !== null
              ? `${tenthsToText(runway.runwayTenthsOfMonth)} months`
              : '—'}
          </strong>
        </p>
      </div>

      <div className="card">
        <h3>30 / 60 / 90 control panel</h3>
        <p className="muted">Plan: docs/research/ethical-card-cashflow-strategy.md + egypt-loan-readiness-dashboard.md.</p>
        <table className="table" aria-label="Thirty sixty ninety control panel">
          <thead>
            <tr>
              <th scope="col">Horizon</th>
              <th scope="col">Goal</th>
              <th scope="col">Status</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {panel.map((item) => (
              <tr key={item.horizonDays}>
                <td>{item.horizonDays} days</td>
                <td>{item.goal}</td>
                <td>
                  <span className={`badge money-${item.achieved ? 'positive' : 'warning'}`}>
                    {item.achieved ? 'on track' : 'attention'}
                  </span>
                </td>
                <td className="muted">{item.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
