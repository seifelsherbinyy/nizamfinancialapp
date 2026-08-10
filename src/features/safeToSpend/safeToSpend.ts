/**
 * NIZAM · Safe-to-spend engine — the eight-term reserve waterfall + confidence.
 * Owning contract: PFOS contract 03 (Decision Engine) section 2.2 (the eight terms)
 *   and section 2.4/2.5 (reserve hierarchy, uncertainty). Confidence bands: contract
 *   01 section 5.5. Staleness discipline: contract 02 section 10.
 * Build phase: PFOS Stage 1, phase 1.3 — safe-to-spend computation.
 * Depends on: obligations engine (liquidity primitives + horizons), budget engine
 *   (credit-card payment commitments), policy.types.ts, lib/money.
 *
 * PURE over NizamDb. The caller passes `asOf`; no `new Date()` in the math. Integer
 * milliunits only — every term is Money and every rate goes through mulRatio.
 */
import type { NizamDb } from '@/lib/db/schema';
import { inflowOf, outflowOf } from '@/features/transactions/transaction.types';
import { computeMonth } from '@/features/budget/budget.logic';
import { monthOf } from '@/lib/ledger/ledgerStore';
import type { Money } from '@/lib/money/money';
import { add, sub, sum, mulRatio, cmp, max } from '@/lib/money/money';
import type { FinancialPolicy } from './policy.types.ts';
import { DEFAULT_POLICY } from './policy.types.ts';
import type { Obligation } from '@/features/obligations/obligation.types';
import { reserveFor } from '@/features/obligations/obligation.types';
import type { Horizon, HorizonId } from '@/features/obligations/obligations.logic';
import {
  addDays,
  daysBetween,
  liquidNow,
  inflowOccurrences,
  buildHorizons,
  HIGH_CONFIDENCE,
} from '@/features/obligations/obligations.logic';

const BPS = 10_000;

/** The eight reserve-waterfall terms, contract 03 section 2.2. All Money, all signed +. */
export interface SafeToSpendTerms {
  liquidAvailableNow: Money;
  highConfidenceInflows: Money;
  pendingOutflows: Money;
  protectedObligations: Money;
  essentialLivingReserve: Money;
  minimumLiquidityBuffer: Money;
  uncertaintyReserve: Money;
  plannedCommittedAllocations: Money;
}

export interface Freshness {
  /** Latest transaction date seen, or null when there are no transactions. */
  lastActivityDate: string | null;
  /** Whole days from lastActivityDate to asOf (0 when unknown). */
  ageDays: number;
  stale: boolean;
}

export interface Sensitivity {
  /** Safe-to-spend if expected income does NOT arrive (inflows zeroed). */
  delayedIncome: Money;
  /** Headroom before an unexpected expense pushes safe-to-spend to zero. */
  unexpectedExpenseHeadroom: Money;
}

export type ConfidenceBand = 'strong' | 'evidenced' | 'provisional' | 'insufficient';

export interface SafeToSpendResult {
  horizon: Horizon;
  terms: SafeToSpendTerms;
  /** Terms summed as a signed waterfall (may be negative before flooring). */
  raw: Money;
  /** max(0, raw). */
  safeToSpend: Money;
  /** True when raw < 0 — a real deficit the UI must surface, not hide. */
  deficit: boolean;
  /** Total held back from spending (everything that is not safeToSpend or inflow). */
  protectedAmount: Money;
  /** Even daily pace across the window. */
  dailyAllowance: Money;
  confidenceBps: number;
  confidenceBand: ConfidenceBand;
  freshness: Freshness;
  primaryRisk: string;
  whatWouldImprove: string[];
  sensitivity: Sensitivity;
}

function resolvePolicy(db: NizamDb): FinancialPolicy {
  return db.policy ?? DEFAULT_POLICY;
}

function computeFreshness(db: NizamDb, asOf: string, staleAfterDays: number): Freshness {
  let last: string | null = null;
  for (const t of db.transactions) {
    if (last === null || t.date.localeCompare(last) > 0) last = t.date;
  }
  if (last === null) return { lastActivityDate: null, ageDays: 0, stale: true };
  const ageDays = Math.max(0, daysBetween(last, asOf));
  return { lastActivityDate: last, ageDays, stale: ageDays > staleAfterDays };
}

/** Positive committed allocations sitting in credit-card payment categories this month. */
function plannedCommittedAllocations(db: NizamDb, asOf: string): Money {
  const month = monthOf(asOf);
  const computed = computeMonth(db, month);
  const payCatIds = db.categories.filter((c) => c.isCreditCardPayment).map((c) => c.id);
  const positives: Money[] = [];
  for (const id of payCatIds) {
    const avail = computed.categories[id]?.available ?? 0;
    if (cmp(avail, 0) > 0) positives.push(avail);
  }
  return sum(positives);
}

/** High-confidence inflows landing on or before `horizonEnd`, bounded below by asOf. */
function highConfidenceInflows(
  db: NizamDb,
  policy: FinancialPolicy,
  asOf: string,
  horizonEnd: string,
): Money {
  const uncleared = db.transactions
    .filter((t) => t.cleared === 'uncleared' && t.amount > 0 && t.date.localeCompare(horizonEnd) <= 0)
    .map(inflowOf);
  let total = sum(uncleared);
  if (policy.expectedInflow && policy.expectedInflow.confidence >= HIGH_CONFIDENCE) {
    const occ = inflowOccurrences(policy.expectedInflow, addDays(asOf, 1), horizonEnd);
    total = add(total, sum(occ.map((o) => o.amount)));
  }
  return total;
}

/** |Uncleared negatives| dated on or before `horizonEnd`. */
function pendingOutflowsInWindow(db: NizamDb, horizonEnd: string): Money {
  return sum(
    db.transactions
      .filter((t) => t.cleared === 'uncleared' && t.amount < 0 && t.date.localeCompare(horizonEnd) <= 0)
      .map(outflowOf),
  );
}

/** Reserve for obligations whose deadline (grace ?? due) falls within the window. */
function protectedObligations(obligations: readonly Obligation[], horizonEnd: string): Money {
  return sum(
    obligations
      .filter((o) => (o.graceDate ?? o.dueDate).localeCompare(horizonEnd) <= 0)
      .map(reserveFor),
  );
}

function bandFor(bps: number): ConfidenceBand {
  if (bps >= 9500) return 'strong';
  if (bps >= 8000) return 'evidenced';
  if (bps >= 6000) return 'provisional';
  return 'insufficient';
}

/**
 * Compute safe-to-spend for one resolved horizon. `horizonEnd` is the horizon's
 * inclusive end; `days` is its span (>= 1 so the daily allowance never divides by 0).
 */
function computeForWindow(
  db: NizamDb,
  policy: FinancialPolicy,
  horizon: Horizon,
  asOf: string,
): SafeToSpendResult {
  const horizonEnd = horizon.endDate ?? asOf;
  const days = Math.max(1, horizon.days);
  const freshness = computeFreshness(db, asOf, policy.staleAfterDays);

  const liquidAvailableNow = liquidNow(db.accounts);
  const inflows = highConfidenceInflows(db, policy, asOf, horizonEnd);
  const pending = pendingOutflowsInWindow(db, horizonEnd);
  const protectedOb = protectedObligations(db.obligations, horizonEnd);
  const essentialLivingReserve = mulRatio(policy.essentialLivingMonthly, days, 30);
  const minimumLiquidityBuffer = policy.minimumLiquidityBuffer;
  const uncertaintyBps = policy.uncertaintyBps + (freshness.stale ? policy.stalenessBps : 0);
  const uncertaintyReserve = mulRatio(add(protectedOb, essentialLivingReserve), uncertaintyBps, BPS);
  const planned = plannedCommittedAllocations(db, asOf);

  const terms: SafeToSpendTerms = {
    liquidAvailableNow,
    highConfidenceInflows: inflows,
    pendingOutflows: pending,
    protectedObligations: protectedOb,
    essentialLivingReserve,
    minimumLiquidityBuffer,
    uncertaintyReserve,
    plannedCommittedAllocations: planned,
  };

  const reserves = sum([
    pending,
    protectedOb,
    essentialLivingReserve,
    minimumLiquidityBuffer,
    uncertaintyReserve,
    planned,
  ]);
  const raw = sub(add(liquidAvailableNow, inflows), reserves);
  const safeToSpend = max(0, raw);
  const deficit = cmp(raw, 0) < 0;
  const protectedAmount = sub(add(liquidAvailableNow, inflows), safeToSpend);
  const dailyAllowance = mulRatio(safeToSpend, 1, days);

  // Confidence: start certain, deduct for every reason the number could be wrong.
  let bps = BPS;
  const whatWouldImprove: string[] = [];
  if (freshness.stale) {
    bps -= 1500;
    whatWouldImprove.push(
      freshness.lastActivityDate
        ? `Import activity since ${freshness.lastActivityDate} (${freshness.ageDays} days stale).`
        : 'Import any transactions — there is no activity to reason from yet.',
    );
  }
  const lowConfObligations = db.obligations.filter((o) => o.confidence < HIGH_CONFIDENCE);
  if (lowConfObligations.length > 0) {
    bps -= Math.min(1500, lowConfObligations.length * 500);
    whatWouldImprove.push(
      `Confirm ${lowConfObligations.length} obligation(s) with a statement so the reserve is exact.`,
    );
  }
  // Uncleared share of the money in play erodes confidence.
  const clearedMagnitude = liquidAvailableNow;
  const unclearedMagnitude = add(inflows, pending);
  const denom = add(clearedMagnitude, unclearedMagnitude);
  if (cmp(denom, 0) > 0) {
    const unclearedBps = Math.min(1000, Math.round((Number(unclearedMagnitude) / Number(denom)) * BPS * 0.2));
    bps -= unclearedBps;
    if (unclearedBps >= 300) {
      whatWouldImprove.push('Clear or reconcile pending transactions to firm up the balance.');
    }
  }
  if (db.policy === undefined || db.policy === null) {
    bps -= 500;
    whatWouldImprove.push('Set your buffers and essential-living policy so reserves reflect your life.');
  }
  if (horizon.id === 'until_inflow' && !policy.expectedInflow) {
    bps -= 1000;
    whatWouldImprove.push('Set your expected income date and amount to unlock the "until next income" view.');
  }
  bps = Math.max(0, Math.min(BPS, bps));
  const confidenceBand = bandFor(bps);

  // Sensitivity: what happens if income slips, and how much cushion before zero.
  const rawNoInflow = sub(liquidAvailableNow, reserves);
  const delayedIncome = max(0, rawNoInflow);
  const unexpectedExpenseHeadroom = safeToSpend;

  // Primary risk: the single largest reason the owner should not treat this as free money.
  let primaryRisk: string;
  if (deficit) {
    primaryRisk = 'You are over-committed for this window — protected costs exceed available funds.';
  } else if (cmp(inflows, safeToSpend) > 0 && cmp(inflows, 0) > 0) {
    primaryRisk = 'Most of this depends on expected income arriving — it is not all in hand yet.';
  } else if (freshness.stale) {
    primaryRisk = 'The data is stale, so this figure may not reflect recent spending.';
  } else if (cmp(protectedOb, 0) > 0) {
    primaryRisk = 'Upcoming obligations are already reserved — spending more borrows from them.';
  } else {
    primaryRisk = 'Low — this is cash on hand after reserves.';
  }

  return {
    horizon,
    terms,
    raw,
    safeToSpend,
    deficit,
    protectedAmount,
    dailyAllowance,
    confidenceBps: bps,
    confidenceBand,
    freshness,
    primaryRisk,
    whatWouldImprove,
    sensitivity: { delayedIncome, unexpectedExpenseHeadroom },
  };
}

/** Safe-to-spend for a single horizon id. */
export function safeToSpendForHorizon(
  db: NizamDb,
  asOf: string,
  horizonId: HorizonId,
): SafeToSpendResult {
  const policy = resolvePolicy(db);
  const horizons = buildHorizons(asOf, policy, db.obligations, db.accounts);
  const horizon = horizons.find((h) => h.id === horizonId);
  if (!horizon) throw new Error(`NIZAM safe-to-spend: unknown horizon "${horizonId}"`);
  return computeForWindow(db, policy, horizon, asOf);
}

/** Safe-to-spend across every horizon; unavailable horizons are skipped. */
export function safeToSpendAllHorizons(db: NizamDb, asOf: string): SafeToSpendResult[] {
  const policy = resolvePolicy(db);
  return buildHorizons(asOf, policy, db.obligations, db.accounts)
    .filter((h) => h.available)
    .map((h) => computeForWindow(db, policy, h, asOf));
}
