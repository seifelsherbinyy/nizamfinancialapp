/**
 * NIZAM · Obligation protection engine — funding status, horizons, shortfall.
 * Owning contract: PFOS contract 03 (Decision Engine) section 3 — funding sequence
 *   and "what is protected vs what is spendable". Contract 01 section 5.2 tiers.
 * Build phase: PFOS Stage 1, phase 1.2 — obligation protection status ladder.
 * Depends on: obligation.types.ts, safeToSpend/policy.types.ts, accounts.types.ts,
 *   transactions/transaction.types.ts, lib/money/money.ts.
 *
 * PURE functions over NizamDb slices. No I/O, no `new Date()` inside the math —
 * the caller passes `asOf` so every result is deterministic and testable. Integer
 * milliunits only; every unit of arithmetic goes through lib/money.
 */
import type { Account } from '@/features/accounts/accounts.types';
import { isCreditType } from '@/features/accounts/accounts.types';
import type { Transaction } from '@/features/transactions/transaction.types';
import { inflowOf, outflowOf } from '@/features/transactions/transaction.types';
import type { FinancialPolicy, ExpectedInflow } from '@/features/safeToSpend/policy.types';
import type { Money } from '@/lib/money/money';
import { add, sub, sum, cmp } from '@/lib/money/money';
import type { Obligation } from './obligation.types.ts';
import { fundingSequence } from './obligation.types.ts';

/**
 * The cash an obligation consumes to avoid ITS harm — the feasibility question the
 * funding report answers. Distinct from reserveFor (the safe-to-spend PROTECTION
 * floor, which holds nothing for P2/P3): P0 harm is avoided only by paying in full;
 * every other tier avoids penalty at the contractual minimum. So a P3 you cannot
 * afford still shows a real (red) status here, while safe-to-spend still refuses to
 * reserve discretionary funds for it.
 */
export function fundingAmount(o: Obligation): Money {
  return o.priority === 'P0' ? o.amountDue : o.minimumDue;
}

// ---------------------------------------------------------------------------
// Date helpers — UTC-anchored so there is no timezone drift (dates are civil).
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function parseUtc(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new TypeError(`NIZAM date: expected YYYY-MM-DD, got "${iso}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** ISO date `days` after `iso` (negative = before). Pure, UTC, no drift. */
export function addDays(iso: string, days: number): string {
  const dt = new Date(parseUtc(iso) + days * DAY_MS);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseUtc(to) - parseUtc(from)) / DAY_MS);
}

/** True when `a <= b` as civil dates. */
function onOrBefore(a: string, b: string): boolean {
  return a.localeCompare(b) <= 0;
}

// ---------------------------------------------------------------------------
// Liquidity primitives — shared with the safe-to-spend engine (which reserves
// against obligations, so the dependency points this way).
// ---------------------------------------------------------------------------

/** An account holds spendable cash: on-budget, not credit, not tracking, not closed. */
export function isLiquidAccount(a: Account): boolean {
  return a.onBudget && !isCreditType(a.type) && a.type !== 'TRACKING' && !a.closed;
}

/** Cleared cash on hand across all liquid accounts. */
export function liquidNow(accounts: readonly Account[]): Money {
  return sum(accounts.filter(isLiquidAccount).map((a) => a.clearedBalance));
}

/**
 * Expected-inflow occurrences (salary) landing in [`from`, `to`] inclusive, honoring
 * the day-of-month, clamped to each month's length. Returns dated amounts so callers
 * can gate on confidence and window.
 */
export function inflowOccurrences(
  inflow: ExpectedInflow | null,
  from: string,
  to: string,
): { date: string; amount: Money }[] {
  if (!inflow || cmp(inflow.amount, 0) <= 0) return [];
  if (from.localeCompare(to) > 0) return [];
  const out: { date: string; amount: Money }[] = [];
  // Walk month by month from `from`'s month through `to`'s month.
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  // Guard against an unbounded loop on malformed input.
  for (let guard = 0; guard < 1200; guard += 1) {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const day = Math.min(inflow.dayOfMonth, lastDay);
    const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (onOrBefore(from, iso) && onOrBefore(iso, to)) {
      out.push({ date: iso, amount: inflow.amount });
    }
    if (y === endY && m === endM) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Positive money reliably arriving on or before `by`:
 *   uncleared positive transactions dated <= `by`, plus expected-inflow occurrences
 *   in (`asOf`, `by`] whose confidence clears the high-confidence bar (>= 0.8).
 * `asOf` bounds the salary window so an inflow already in the cleared balance is
 * not counted twice.
 */
export const HIGH_CONFIDENCE = 0.8;

export function confidentInflowsBy(
  transactions: readonly Transaction[],
  policy: FinancialPolicy,
  asOf: string,
  by: string,
): Money {
  const uncleared = transactions
    .filter((t) => t.cleared === 'uncleared' && t.amount > 0 && onOrBefore(t.date, by))
    .map(inflowOf);
  let total = sum(uncleared);
  if (policy.expectedInflow && policy.expectedInflow.confidence >= HIGH_CONFIDENCE) {
    // Occurrences strictly after asOf (asOf's cash is already in the balance).
    const occ = inflowOccurrences(policy.expectedInflow, addDays(asOf, 1), by);
    total = add(total, sum(occ.map((o) => o.amount)));
  }
  return total;
}

/** Pending outflow magnitude: |uncleared negatives| dated on or before `by`. */
export function pendingOutflowsBy(transactions: readonly Transaction[], by: string): Money {
  return sum(
    transactions
      .filter((t) => t.cleared === 'uncleared' && t.amount < 0 && onOrBefore(t.date, by))
      .map(outflowOf),
  );
}

// ---------------------------------------------------------------------------
// Per-obligation funding status
// ---------------------------------------------------------------------------

export type ObligationStatus = 'green' | 'amber' | 'red' | 'critical';

export interface ObligationFundingLine {
  obligation: Obligation;
  status: ObligationStatus;
  reason: string;
  /** Cash this obligation consumes to avoid its harm (from fundingAmount). */
  required: Money;
  /** Running cumulative reserve through this obligation in funding order. */
  cumulativeRequired: Money;
  /** Cash on hand minus pending outflows before the deadline. */
  fundsInHand: Money;
  /** fundsInHand plus confident inflows on or before the deadline. */
  projectedFunds: Money;
  /** How short the projection is against the cumulative reserve (0 when covered). */
  shortfall: Money;
  /** Signed days from asOf to due date (negative = overdue). */
  daysUntilDue: number;
  overdue: boolean;
  /** Late fee exposed if this obligation is not funded by its grace/due date. */
  penaltyExposure: Money;
}

/**
 * Classify every obligation by funding certainty, walking the funding sequence with a
 * running cumulative reserve. Earlier (more harmful) obligations claim funds first, so a
 * P0 is never starved by a P3 that happens to be due sooner.
 */
export function obligationFundingReport(
  obligations: readonly Obligation[],
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  policy: FinancialPolicy,
  asOf: string,
): ObligationFundingLine[] {
  const cash = liquidNow(accounts);
  const ordered = fundingSequence(obligations);
  const lines: ObligationFundingLine[] = [];
  let cumulative: Money = 0;
  for (const o of ordered) {
    const required = fundingAmount(o);
    cumulative = add(cumulative, required);
    const deadline = o.graceDate ?? o.dueDate;
    const pending = pendingOutflowsBy(transactions, deadline);
    const fundsInHand = sub(cash, pending);
    const inflows = confidentInflowsBy(transactions, policy, asOf, deadline);
    const projectedFunds = add(fundsInHand, inflows);
    const daysUntilDue = daysBetween(asOf, o.dueDate);
    const overdue = o.dueDate.localeCompare(asOf) < 0;
    const coveredInHand = cmp(cumulative, fundsInHand) <= 0;
    const coveredProjected = cmp(cumulative, projectedFunds) <= 0;
    const shortfall = coveredProjected ? 0 : sub(cumulative, projectedFunds);

    let status: ObligationStatus;
    let reason: string;
    if (overdue) {
      if (coveredInHand) {
        status = 'amber';
        reason = 'Past due but fully covered by cash on hand — pay it now to stop the penalty.';
      } else {
        status = 'critical';
        reason = 'Past due and not covered — a penalty is accruing.';
      }
    } else if (coveredInHand) {
      status = 'green';
      reason = 'Fully reserved from cash on hand.';
    } else if (coveredProjected) {
      status = 'amber';
      reason = 'Covered only after expected income arrives before the due date.';
    } else {
      status = 'red';
      reason = 'Not covered even after expected income — funds fall short before the due date.';
    }
    // A due-TODAY obligation not fully in hand is critical. (Overdue is already
    // resolved above: overdue+covered stays amber, overdue+uncovered is critical.)
    if (!overdue && o.dueDate === asOf && status !== 'green') {
      status = 'critical';
      reason = 'Due today and not fully covered by cash on hand — act now.';
    }

    lines.push({
      obligation: o,
      status,
      reason,
      required,
      cumulativeRequired: cumulative,
      fundsInHand,
      projectedFunds,
      shortfall,
      daysUntilDue,
      overdue,
      penaltyExposure: status === 'green' ? 0 : o.penalty,
    });
  }
  return lines;
}

/** Worst status present, by severity. */
const STATUS_SEVERITY: Record<ObligationStatus, number> = {
  green: 0,
  amber: 1,
  red: 2,
  critical: 3,
};

export function worstStatus(lines: readonly ObligationFundingLine[]): ObligationStatus {
  let worst: ObligationStatus = 'green';
  for (const l of lines) {
    if (STATUS_SEVERITY[l.status] > STATUS_SEVERITY[worst]) worst = l.status;
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Horizons — spend windows the safe-to-spend view is computed over.
// ---------------------------------------------------------------------------

export type HorizonId = '1d' | '7d' | 'until_inflow' | '30d' | 'statement' | '90d';

export interface Horizon {
  id: HorizonId;
  label: string;
  /** Inclusive end date of the window, or null when the horizon is unavailable. */
  endDate: string | null;
  /** Day count of the window (asOf .. endDate). */
  days: number;
  /** False when the horizon cannot be resolved (e.g. no salary date, no statement). */
  available: boolean;
}

/**
 * The soonest credit-card statement due date: the nearest future dueDate among
 * obligations linked to a credit-type account. Never silently aliases to 30d —
 * returns null when the portfolio has no credit obligation.
 */
export function nextStatementDate(
  obligations: readonly Obligation[],
  accounts: readonly Account[],
  asOf: string,
): string | null {
  const creditAccountIds = new Set(
    accounts.filter((a) => isCreditType(a.type)).map((a) => a.id),
  );
  const dates = obligations
    .filter((o) => o.accountId !== null && creditAccountIds.has(o.accountId))
    .map((o) => o.dueDate)
    .filter((d) => d.localeCompare(asOf) >= 0)
    .sort((a, b) => a.localeCompare(b));
  return dates[0] ?? null;
}

/** The next expected-inflow date strictly after asOf, or null when none is set. */
export function nextInflowDate(policy: FinancialPolicy, asOf: string): string | null {
  if (!policy.expectedInflow) return null;
  const occ = inflowOccurrences(policy.expectedInflow, addDays(asOf, 1), addDays(asOf, 400));
  return occ[0]?.date ?? null;
}

/** Build the six standard horizons anchored at `asOf`. */
export function buildHorizons(
  asOf: string,
  policy: FinancialPolicy,
  obligations: readonly Obligation[],
  accounts: readonly Account[],
): Horizon[] {
  const fixed = (id: HorizonId, label: string, spanDays: number): Horizon => ({
    id,
    label,
    endDate: addDays(asOf, spanDays),
    days: spanDays,
    available: true,
  });
  const inflowDate = nextInflowDate(policy, asOf);
  const statementDate = nextStatementDate(obligations, accounts, asOf);
  return [
    fixed('1d', 'Today', 1),
    fixed('7d', 'Next 7 days', 7),
    {
      id: 'until_inflow',
      label: 'Until next income',
      endDate: inflowDate,
      days: inflowDate ? daysBetween(asOf, inflowDate) : 0,
      available: inflowDate !== null,
    },
    fixed('30d', 'Next 30 days', 30),
    {
      id: 'statement',
      label: 'Until statement due',
      endDate: statementDate,
      days: statementDate ? daysBetween(asOf, statementDate) : 0,
      available: statementDate !== null,
    },
    fixed('90d', 'Next 90 days', 90),
  ];
}
