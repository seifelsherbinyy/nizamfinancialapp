/**
 * NIZAM · Deterministic forecast engine — cash-balance paths + baseline/downside/upside.
 * Owning contract: PFOS contract 03 (Decision Engine) section 6 — forecast horizons (6.1),
 *   deterministic + scenario types (6.2), inputs (6.3), outputs (6.4).
 * Build phase: PFOS Stage 3, phase 3.2 — deterministic scheduled cash flow.
 * Depends on: obligations engine (liquidity + date helpers), safeToSpend, policy, lib/money.
 *
 * PURE over NizamDb. The three scenarios are produced by toggling ONLY the uncertain
 * inputs (expected income, pending inflows, feared outflows) — no invented magnitudes.
 * Monte Carlo / probabilistic ranges (6.2) defer to the server tier. Integer milliunits.
 */
import type { NizamDb } from '@/lib/db/schema';
import { inflowOf, outflowOf } from '@/features/transactions/transaction.types';
import type { Money } from '@/lib/money/money';
import { add, cmp, min as mmin, mulRatio } from '@/lib/money/money';
import { DEFAULT_POLICY } from '@/features/safeToSpend/policy.types';
import { addDays, liquidNow, inflowOccurrences } from '@/features/obligations/obligations.logic';

/** Forecast horizons — contract 03 section 6.1. */
export const FORECAST_HORIZONS = [
  { id: 'next_day', label: 'Next day', days: 1 },
  { id: 'next_week', label: 'Next week', days: 7 },
  { id: 'next_month', label: 'Next month', days: 30 },
  { id: 'quarter', label: 'Quarter', days: 90 },
  { id: 'year', label: 'Year', days: 365 },
  { id: 'multi_year', label: 'Multi-year', days: 1095 },
] as const;
export type ForecastHorizonId = (typeof FORECAST_HORIZONS)[number]['id'];

export type ScenarioId = 'baseline' | 'downside' | 'upside';

export interface ForecastEvent {
  date: string;
  amount: Money; // signed: inflow +, outflow −
  label: string;
}

export interface BalancePoint {
  date: string;
  balance: Money;
}

export interface ScenarioForecast {
  scenario: ScenarioId;
  path: BalancePoint[];
  endingBalance: Money;
  minBalance: Money;
  minBalanceDate: string;
  /** True when the balance dips below zero at any point in the window. */
  shortfall: boolean;
}

export interface HorizonForecast {
  horizon: { id: ForecastHorizonId; label: string; days: number; endDate: string };
  asOf: string;
  startingCash: Money;
  scenarios: ScenarioForecast[];
  /** Fraction of the three scenarios that hit a shortfall, in basis points (deterministic proxy). */
  probabilityOfShortfallBps: number;
  /** Emergency-buffer days = current cash / daily essential living; null when unset. */
  bufferDays: number | null;
  /** Largest absolute movements in the baseline (contract 03 section 6.4 "main drivers"). */
  drivers: ForecastEvent[];
}

const SCENARIO_TOGGLES: Record<ScenarioId, { salary: boolean; pendingIn: boolean; fearedOut: boolean }> = {
  // salary = expected income arrives; pendingIn = uncleared positive txns land;
  // fearedOut = uncleared negative txns actually hit.
  baseline: { salary: true, pendingIn: true, fearedOut: true },
  downside: { salary: false, pendingIn: true, fearedOut: true }, // income delayed
  upside: { salary: true, pendingIn: true, fearedOut: false }, // feared costs do not hit
};

function eventsFor(db: NizamDb, asOf: string, endDate: string, scenario: ScenarioId): ForecastEvent[] {
  const policy = db.policy ?? DEFAULT_POLICY;
  const toggles = SCENARIO_TOGGLES[scenario];
  const events: ForecastEvent[] = [];

  // Expected income (salary), strictly after asOf so today's cash is not double-counted.
  if (toggles.salary && policy.expectedInflow) {
    for (const o of inflowOccurrences(policy.expectedInflow, addDays(asOf, 1), endDate)) {
      events.push({ date: o.date, amount: o.amount, label: 'Expected income' });
    }
  }

  // Pending (uncleared) transactions dated in (asOf, endDate].
  for (const t of db.transactions) {
    if (t.cleared !== 'uncleared') continue;
    if (t.date.localeCompare(asOf) <= 0 || t.date.localeCompare(endDate) > 0) continue;
    if (t.amount > 0 && toggles.pendingIn) {
      events.push({ date: t.date, amount: inflowOf(t), label: `Pending inflow: ${t.payee}` });
    } else if (t.amount < 0 && toggles.fearedOut) {
      events.push({ date: t.date, amount: -outflowOf(t), label: `Pending outflow: ${t.payee}` });
    }
  }

  // Obligations are certain outflows in every scenario — full amount on the due date.
  for (const ob of db.obligations) {
    if (ob.dueDate.localeCompare(asOf) <= 0 || ob.dueDate.localeCompare(endDate) > 0) continue;
    events.push({ date: ob.dueDate, amount: -Math.abs(ob.amountDue), label: `Obligation: ${ob.creditor}` });
  }

  // Stable order: by date, then outflows before inflows (worst-case intra-day), then label.
  events.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    if (a.amount !== b.amount) return a.amount - b.amount;
    return a.label.localeCompare(b.label);
  });
  return events;
}

function simulate(startingCash: Money, events: readonly ForecastEvent[], scenario: ScenarioId): ScenarioForecast {
  const path: BalancePoint[] = [];
  let balance = startingCash;
  let minBalance = startingCash;
  let minBalanceDate = ''; // '' = the starting point
  for (const e of events) {
    balance = add(balance, e.amount);
    path.push({ date: e.date, balance });
    if (cmp(balance, minBalance) < 0) {
      minBalance = balance;
      minBalanceDate = e.date;
    }
  }
  return {
    scenario,
    path,
    endingBalance: balance,
    minBalance,
    minBalanceDate,
    shortfall: cmp(minBalance, 0) < 0,
  };
}

/** Forecast one horizon across all three scenarios. */
export function forecastHorizon(db: NizamDb, asOf: string, horizonId: ForecastHorizonId): HorizonForecast {
  const spec = FORECAST_HORIZONS.find((h) => h.id === horizonId);
  if (!spec) throw new Error(`NIZAM forecast: unknown horizon "${horizonId}"`);
  const endDate = addDays(asOf, spec.days);
  const startingCash = liquidNow(db.accounts);

  const scenarios: ScenarioForecast[] = (['baseline', 'downside', 'upside'] as ScenarioId[]).map((s) =>
    simulate(startingCash, eventsFor(db, asOf, endDate, s), s),
  );

  const dips = scenarios.filter((s) => s.shortfall).length;
  const probabilityOfShortfallBps = Math.round((dips / scenarios.length) * 10_000);

  const policy = db.policy ?? DEFAULT_POLICY;
  const dailyEssential = mulRatio(policy.essentialLivingMonthly, 1, 30);
  const bufferDays =
    cmp(dailyEssential, 0) > 0 ? Math.max(0, Math.floor(Number(startingCash) / Number(dailyEssential))) : null;

  const baseEvents = eventsFor(db, asOf, endDate, 'baseline');
  const drivers = [...baseEvents]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 3);

  return {
    horizon: { id: spec.id, label: spec.label, days: spec.days, endDate },
    asOf,
    startingCash,
    scenarios,
    probabilityOfShortfallBps,
    bufferDays,
    drivers,
  };
}

/** Forecast every horizon. */
export function forecastAll(db: NizamDb, asOf: string): HorizonForecast[] {
  return FORECAST_HORIZONS.map((h) => forecastHorizon(db, asOf, h.id));
}

/**
 * The forecast's starting cash MUST equal safe-to-spend's liquid-available-now, so the two
 * engines reconcile at H=today. Callers/tests use this to assert 03 section 14's
 * "every displayed financial fact has a source" — the paths share one starting point.
 */
export function forecastStartReconciles(db: NizamDb, safeToSpendLiquidNow: Money): boolean {
  return cmp(liquidNow(db.accounts), safeToSpendLiquidNow) === 0;
}

/** The worst ending balance across scenarios (planning floor). */
export function worstEndingBalance(f: HorizonForecast): Money {
  return f.scenarios.reduce<Money>((acc, s) => mmin(acc, s.endingBalance), f.scenarios[0]?.endingBalance ?? 0);
}

/** Convenience re-export of a signed sum for callers building driver summaries. */
export function netScheduled(events: readonly ForecastEvent[]): Money {
  let total: Money = 0;
  for (const e of events) total = add(total, e.amount);
  return total;
}
