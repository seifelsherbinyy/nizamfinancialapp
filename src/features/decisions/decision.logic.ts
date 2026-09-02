/**
 * NIZAM · Purchase decision engine — deterministic policy gate over Stage-1 outputs.
 * Owning contract: PFOS contract 03 (Decision Engine) section 4 (recommendation states,
 *   card order) and section 1 ("the model never sources numbers" — this is pure math).
 * Build phase: PFOS Stage 2, phase 2.2 — decision policy gate + card builder.
 * Depends on: safeToSpend engine, obligations engine, lib/db/schema, lib/money.
 *
 * PURE over NizamDb. The purchase is simulated as a single uncleared outflow, then the
 * already-tested Stage-1 engines are re-run — so the decision is exactly as trustworthy
 * as safe-to-spend, and every branch is a comparison between the price and a computed
 * figure (no invented thresholds). Integer milliunits throughout.
 */
import type { NizamDb } from '@/lib/db/schema';
import type { Transaction } from '@/features/transactions/transaction.types';
import type { Money } from '@/lib/money/money';
import { sub, cmp, max, format } from '@/lib/money/money';
import {
  obligationFundingReport,
  nextStatementDate,
  nextInflowDate,
  type ObligationStatus,
} from '@/features/obligations/obligations.logic';
import {
  safeToSpendForHorizon,
  type SafeToSpendResult,
} from '@/features/safeToSpend/safeToSpend';
import { DEFAULT_POLICY } from '@/features/safeToSpend/policy.types';
import type {
  PurchaseRequest,
  DecisionCard,
  Recommendation,
  Affordability,
} from './decision.types.ts';

const STATUS_SEVERITY: Record<ObligationStatus, number> = {
  green: 0,
  amber: 1,
  red: 2,
  critical: 3,
};

/** When the cash actually leaves: on the purchase date for cash/debit; for credit, at
 *  the card's next statement due date (falling back to the purchase date). */
function outflowDate(db: NizamDb, request: PurchaseRequest): string {
  if (request.paymentMethod === 'credit') {
    return nextStatementDate(db.obligations, db.accounts, request.date) ?? request.date;
  }
  return request.date;
}

/** A copy of the db with the purchase added as one uncleared outflow. */
export function applyPurchase(db: NizamDb, request: PurchaseRequest, price: Money): NizamDb {
  const synthetic: Transaction = {
    id: `__sim_purchase__`,
    accountId: request.accountId ?? db.accounts[0]?.id ?? '__none__',
    date: outflowDate(db, request),
    payee: 'Simulated purchase',
    categoryId: request.category,
    memo: 'decision-engine simulation',
    amount: -Math.abs(price),
    // A simulation must be denominated exactly like the account it debits.
    currency:
      db.accounts.find((a) => a.id === (request.accountId ?? db.accounts[0]?.id))?.currency ??
      db.meta.currency,
    cleared: 'uncleared',
    approved: false,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
  };
  return { ...db, transactions: [...db.transactions, synthetic] };
}

/** True when the purchase worsens any protected (P0/P1) obligation's funding status. */
function harmsProtectedObligation(db: NizamDb, dbAfter: NizamDb, asOf: string): boolean {
  const policy = db.policy ?? DEFAULT_POLICY;
  const before = obligationFundingReport(db.obligations, db.accounts, db.transactions, policy, asOf);
  const after = obligationFundingReport(dbAfter.obligations, dbAfter.accounts, dbAfter.transactions, policy, asOf);
  const beforeById = new Map(before.map((l) => [l.obligation.id, l]));
  for (const a of after) {
    if (a.obligation.priority !== 'P0' && a.obligation.priority !== 'P1') continue;
    const b = beforeById.get(a.obligation.id);
    if (!b) continue;
    if (STATUS_SEVERITY[a.status] > STATUS_SEVERITY[b.status]) return true;
  }
  return false;
}

function fmt(m: Money): string {
  return format(m);
}

function horizonSentence(window: string, post: SafeToSpendResult): string {
  if (post.deficit) {
    return `Over ${window}, you would be over-committed by ${fmt(sub(0, post.raw))} — a deficit.`;
  }
  return `Over ${window}, your safe-to-spend would be ${fmt(post.safeToSpend)}.`;
}

/**
 * Decide a purchase. Returns the full eleven-line decision card. `asOf` is passed in so
 * the result is deterministic. The decision window is 30 days (a budgeting month);
 * longer-horizon affordability is checked against 90 days for the delay path.
 */
export function decidePurchase(db: NizamDb, asOf: string, request: PurchaseRequest): DecisionCard {
  const price = Math.abs(request.price);
  const dbAfter = applyPurchase(db, request, price);

  // Pre-purchase safe-to-spend over the decision window (30d) and the long window (90d).
  const pre30 = safeToSpendForHorizon(db, asOf, '30d');
  const pre90 = safeToSpendForHorizon(db, asOf, '90d');

  // Post-purchase safe-to-spend at every card horizon.
  const post1 = safeToSpendForHorizon(dbAfter, asOf, '1d');
  const post7 = safeToSpendForHorizon(dbAfter, asOf, '7d');
  const post30 = safeToSpendForHorizon(dbAfter, asOf, '30d');
  const post90 = safeToSpendForHorizon(dbAfter, asOf, '90d');

  const safeWithIncome = pre30.safeToSpend;
  const safeInHand = pre30.sensitivity.delayedIncome;
  const safe90 = pre90.safeToSpend;
  const affordableCap = max(0, safeWithIncome);

  const affordability: Affordability = {
    price,
    safeToSpendWithIncome: safeWithIncome,
    safeToSpendInHand: safeInHand,
    remainingInHand: sub(safeInHand, price),
    remainingWithIncome: sub(safeWithIncome, price),
    reliesOnExpectedIncome: cmp(price, safeInHand) > 0 && cmp(price, safeWithIncome) <= 0,
    affordableCap,
  };

  const harmed = harmsProtectedObligation(db, dbAfter, asOf);
  const inHandCovers = cmp(price, safeInHand) <= 0;
  const incomeCovers = cmp(price, safeWithIncome) <= 0;
  const ninetyCovers = cmp(price, safe90) <= 0;
  const altGiven = request.alternativePrice !== null;
  const altAffordable = altGiven && cmp(Math.abs(request.alternativePrice as number), safeWithIncome) <= 0;

  const inflowDate = nextInflowDate(db.policy ?? DEFAULT_POLICY, asOf);

  // ---- The deterministic ladder (most-protective first) ----
  let recommendation: Recommendation;
  let reason: string;
  let requiredAction: string;
  let alternative: string | null = null;

  if (harmed) {
    recommendation = 'financially_blocked';
    reason = 'This purchase would put a protected obligation at risk, so the plan blocks it.';
    requiredAction = 'Do not buy this now — it competes with a P0/P1 obligation. Revisit after that obligation is funded.';
  } else if (inHandCovers) {
    recommendation = 'approve';
    reason = 'You can cover this from cash on hand without touching any reserve.';
    requiredAction = 'Go ahead — it fits inside your safe-to-spend.';
  } else if (incomeCovers) {
    recommendation = 'approve_with_condition';
    reason = 'You can afford this, but only once your expected income arrives.';
    requiredAction = inflowDate
      ? `Wait for your income on ${inflowDate}, then buy — or buy now only if that income is certain.`
      : 'Confirm your expected income is certain before buying, since it depends on funds not yet in hand.';
  } else if (altGiven && altAffordable) {
    recommendation = 'alternative';
    reason = 'The full price does not fit safely, but the cheaper option does.';
    alternative = `Choose the ${fmt(Math.abs(request.alternativePrice as number))} option instead — it stays inside your safe-to-spend.`;
    requiredAction = 'Buy the lower-cost alternative rather than the full-price item.';
  } else if (ninetyCovers) {
    recommendation = 'delay';
    const when = inflowDate ?? post90.horizon.endDate ?? asOf;
    reason = 'You cannot absorb this within the month, but you can over a longer window.';
    requiredAction = `Delay until about ${when}, when your safe-to-spend can cover it without harm.`;
    if (altGiven) alternative = `Or take the ${fmt(Math.abs(request.alternativePrice as number))} option now.`;
  } else if (cmp(affordableCap, 0) > 0) {
    recommendation = 'approve_with_cap';
    reason = 'Only part of this fits safely right now.';
    requiredAction = `Cap the spend at ${fmt(affordableCap)} to stay inside your safe-to-spend.`;
    if (altGiven) alternative = `A cheaper option at ${fmt(Math.abs(request.alternativePrice as number))} was offered but still exceeds what is safe.`;
  } else {
    recommendation = 'reject';
    reason = 'There is no safe room for this — every horizon leaves you short.';
    requiredAction = 'Hold off. Build safe-to-spend first (clear pending costs or add income) before reconsidering.';
    if (altGiven) alternative = `Even the ${fmt(Math.abs(request.alternativePrice as number))} option exceeds what is safe today.`;
  }

  // ---- Evidence (deterministic dimensions only) — contract 03 section 4.2 subset ----
  const evidence: string[] = [];
  evidence.push(
    `This is ${fmt(price)} against ${fmt(safeWithIncome)} safe to spend over the next 30 days.`,
  );
  evidence.push(
    harmed
      ? 'It would worsen a protected P0/P1 obligation.'
      : 'Your P0/P1 obligations stay fully reserved after it.',
  );
  if (affordability.reliesOnExpectedIncome) {
    evidence.push('Affordability depends on expected income that has not arrived yet.');
  }
  evidence.push(request.reversible ? 'It is reversible if circumstances change.' : 'It is not reversible once made.');
  if (pre30.freshness.stale) {
    evidence.push(`The underlying data is ${pre30.freshness.ageDays} days stale, so treat this cautiously.`);
  }

  // ---- One-year / trajectory (honest: full net-worth forecast lands in Stage 3) ----
  const oneYearEffect = request.reversible
    ? 'A one-time, reversible cost — no lasting change to your yearly trajectory (full forecast in a later stage).'
    : cmp(price, safeWithIncome) > 0
      ? 'A one-time cost that draws on reserves; repeated, it would erode your yearly trajectory (full forecast in a later stage).'
      : 'A one-time cost within your means — negligible effect on your yearly trajectory (full forecast in a later stage).';

  // ---- Confidence (inherits safe-to-spend confidence) + missing information ----
  const missingInformation: string[] = [...pre30.whatWouldImprove];
  if (!request.category) missingInformation.push('Assign a budget category so the impact lands in the right place.');
  if (!request.purpose) missingInformation.push('Note the purpose so future reviews can judge whether it paid off.');

  return {
    recommendation,
    reason,
    immediateEffect: `Buying this ${request.paymentMethod === 'credit' ? 'on credit defers' : 'removes'} ${fmt(price)} ${request.paymentMethod === 'credit' ? 'to your next statement' : 'from your available cash now'}.`,
    nextDayEffect: horizonSentence('the next day', post1),
    oneWeekEffect: horizonSentence('one week', post7),
    oneMonthEffect: horizonSentence('one month', post30),
    oneYearEffect,
    evidence,
    alternative,
    confidence: { bps: pre30.confidenceBps, band: pre30.confidenceBand, missingInformation },
    requiredAction,
    horizonImpacts: {
      next_day: horizonSentence('the next day', post1),
      next_week: horizonSentence('one week', post7),
      next_month: horizonSentence('one month', post30),
      next_year: oneYearEffect,
    },
    affordability,
  };
}
