/**
 * NIZAM · Rescue analytics — Egypt-context loan-readiness metrics
 * Implemented by: KIRO Contract 5 / Phase 5.2
 * Depends on: lib/db/schema.ts, budget.logic.ts, ledgerStore.ts
 *
 * Formula sources (docs/research/, the design source of truth):
 *  - Card utilization:        docs/research/egypt-iscore-fastest-levers.md
 *    (keep reported utilization under ~30%, ideally under ~10%, of the limit)
 *  - Debt service ratio:      docs/research/egypt-loan-readiness-dashboard.md
 *    (lender FOIR-style cap: monthly debt payments / monthly income)
 *  - Liquidity runway:        docs/research/egypt-liquidity-buffer-debt-paydown.md
 *    (liquid balances / average essential monthly spend, in months)
 *  - 30/60/90 control panel:  docs/research/ethical-card-cashflow-strategy.md
 *    + docs/research/egypt-loan-readiness-dashboard.md
 *
 * These are personal analytics, NOT regulated financial advice.
 * Ratios are integers in basis points (1% = 100 bps) — money never floats.
 */
import type { NizamDb } from '@/lib/db/schema';
import type { MonthKey } from '@/features/budget/budget.types';
import type { Money } from '@/lib/money/money';
import { isCreditType } from '@/features/accounts/accounts.types';
import { accountBalance, getIndex, monthOf } from '@/lib/ledger/ledgerStore';
import { incomeCategoryIds, prevMonth } from '@/features/budget/budget.logic';

/** Integer basis points: round(10000 * num / den); null when den <= 0. */
export function ratioBps(num: Money, den: Money): number | null {
  if (den <= 0) return null;
  return Math.round((10000 * num) / den);
}

/** "12.5%" from 1250 bps — pure integer arithmetic (no float formatting). */
export function bpsToPercentText(bps: number, decimals: 0 | 1 = 1): string {
  if (decimals === 0) return `${Math.round(bps / 100)}%`;
  const tenths = Math.round(bps / 10);
  return `${Math.trunc(tenths / 10)}.${Math.abs(tenths % 10)}%`;
}

/** "6.0" from 60 tenths — integer-safe one-decimal formatting. */
export function tenthsToText(tenths: number): string {
  return `${Math.trunc(tenths / 10)}.${Math.abs(tenths % 10)}`;
}

// ---------------------------------------------------------------------------
// Card utilization — egypt-iscore-fastest-levers.md
// ---------------------------------------------------------------------------

export interface CardUtilization {
  accountId: string;
  accountName: string;
  /** Outstanding debt magnitude (>= 0). */
  debt: Money;
  creditLimit: Money | null;
  /** Utilization in basis points; null without a limit. */
  utilizationBps: number | null;
  /** Bands from the research doc: ok < 3000 bps, tight < 9000, critical above. */
  band: 'ok' | 'elevated' | 'critical' | 'unknown';
}

export function cardUtilization(db: NizamDb): CardUtilization[] {
  return db.accounts
    .filter((a) => isCreditType(a.type) && !a.closed)
    .map((a) => {
      const balance = accountBalance(db, a.id);
      const debt = balance < 0 ? -balance : 0;
      const utilizationBps = a.creditLimit ? ratioBps(debt, a.creditLimit) : null;
      let band: CardUtilization['band'] = 'unknown';
      if (utilizationBps !== null) {
        band = utilizationBps < 3000 ? 'ok' : utilizationBps < 9000 ? 'elevated' : 'critical';
      }
      return {
        accountId: a.id,
        accountName: a.name,
        debt,
        creditLimit: a.creditLimit,
        utilizationBps,
        band,
      };
    });
}

// ---------------------------------------------------------------------------
// Debt service ratio (FOIR-style) — egypt-loan-readiness-dashboard.md
// ---------------------------------------------------------------------------

export interface DebtServiceRatio {
  month: MonthKey;
  income: Money;
  /** Debt payments: transfers into credit accounts + debt-category outflows. */
  debtPayments: Money;
  /** bps of income; null when the month had no income. */
  ratioBps: number | null;
  /** Research band: lenders commonly cap FOIR near 50% (5000 bps). */
  band: 'ok' | 'elevated' | 'critical' | 'unknown';
}

const DEBT_CATEGORY_NAMES = new Set(['loan installment', 'credit card payment', 'debt paydown']);

export function debtServiceRatio(db: NizamDb, month: MonthKey): DebtServiceRatio {
  const incomeIds = incomeCategoryIds(db);
  const accountById = new Map(db.accounts.map((a) => [a.id, a]));
  const debtCategoryIds = new Set(
    db.categories
      .filter((c) => DEBT_CATEGORY_NAMES.has(c.name.trim().toLowerCase()))
      .map((c) => c.id),
  );

  let income = 0;
  let debtPayments = 0;
  for (const t of db.transactions) {
    if (monthOf(t.date) !== month) continue;
    const account = accountById.get(t.accountId);
    if (!account?.onBudget) continue;

    if (t.transferAccountId) {
      // A payment INTO a credit account from a cash account services debt.
      if (isCreditType(account.type) && t.amount > 0) {
        const from = accountById.get(t.transferAccountId);
        if (from?.onBudget && !isCreditType(from.type)) debtPayments += t.amount;
      }
      continue;
    }
    const legs =
      t.splits && t.splits.length > 0
        ? t.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount }))
        : [{ categoryId: t.categoryId, amount: t.amount }];
    for (const leg of legs) {
      if (!leg.categoryId) continue;
      if (incomeIds.has(leg.categoryId) && leg.amount > 0) income += leg.amount;
      else if (debtCategoryIds.has(leg.categoryId) && leg.amount < 0 && !isCreditType(account.type)) {
        debtPayments += -leg.amount;
      }
    }
  }

  const bps = ratioBps(debtPayments, income);
  const band: DebtServiceRatio['band'] =
    bps === null ? 'unknown' : bps < 3500 ? 'ok' : bps <= 5000 ? 'elevated' : 'critical';
  return { month, income, debtPayments, ratioBps: bps, band };
}

// ---------------------------------------------------------------------------
// Liquidity runway — egypt-liquidity-buffer-debt-paydown.md
// ---------------------------------------------------------------------------

export interface LiquidityRunway {
  /** Liquid cash: positive balances of on-budget non-credit accounts. */
  liquid: Money;
  /** Average monthly spending magnitude over the trailing window. */
  avgMonthlySpend: Money;
  /** Runway in tenths of a month (integer), null when no spend history. */
  runwayTenthsOfMonth: number | null;
}

export function liquidityRunway(db: NizamDb, throughMonth: MonthKey, windowMonths = 3): LiquidityRunway {
  const incomeIds = incomeCategoryIds(db);
  let liquid = 0;
  for (const a of db.accounts) {
    if (!a.onBudget || isCreditType(a.type) || a.closed) continue;
    const balance = accountBalance(db, a.id);
    if (balance > 0) liquid += balance;
  }

  const window: MonthKey[] = [];
  let m = throughMonth;
  for (let i = 0; i < windowMonths; i++) {
    window.push(m);
    m = prevMonth(m);
  }
  const windowSet = new Set(window);

  let spend = 0;
  const index = getIndex(db);
  for (const [categoryId, months] of index.byCategoryMonth) {
    if (incomeIds.has(categoryId)) continue;
    for (const [month, entries] of months) {
      if (!windowSet.has(month)) continue;
      for (const e of entries) if (e.amount < 0) spend += -e.amount;
    }
  }
  const avgMonthlySpend = Math.round(spend / windowMonths);
  const runwayTenthsOfMonth = avgMonthlySpend > 0 ? Math.round((10 * liquid) / avgMonthlySpend) : null;
  return { liquid, avgMonthlySpend, runwayTenthsOfMonth };
}

// ---------------------------------------------------------------------------
// 30 / 60 / 90 control panel — ethical-card-cashflow-strategy.md
//                              + egypt-loan-readiness-dashboard.md
// ---------------------------------------------------------------------------

export interface ControlPanelItem {
  horizonDays: 30 | 60 | 90;
  goal: string;
  achieved: boolean;
  detail: string;
}

export function controlPanel(db: NizamDb, month: MonthKey): ControlPanelItem[] {
  const cards = cardUtilization(db);
  const worstUtil = cards.reduce<number | null>(
    (worst, c) => (c.utilizationBps === null ? worst : Math.max(worst ?? 0, c.utilizationBps)),
    null,
  );
  const dsr = debtServiceRatio(db, month);
  const runway = liquidityRunway(db, month);

  return [
    {
      horizonDays: 30,
      goal: 'Every card reported under 90% utilization',
      achieved: worstUtil !== null ? worstUtil < 9000 : false,
      detail:
        worstUtil === null
          ? 'No card limit on file — set creditLimit on the card account'
          : `worst card utilization ${bpsToPercentText(worstUtil, 0)}`,
    },
    {
      horizonDays: 60,
      goal: 'Debt service under 50% of monthly income',
      achieved: dsr.ratioBps !== null && dsr.ratioBps <= 5000,
      detail:
        dsr.ratioBps === null
          ? 'No income recorded this month'
          : `debt service ${bpsToPercentText(dsr.ratioBps, 0)} of income`,
    },
    {
      horizonDays: 90,
      goal: 'Liquidity buffer of at least one month of spending',
      achieved: runway.runwayTenthsOfMonth !== null && runway.runwayTenthsOfMonth >= 10,
      detail:
        runway.runwayTenthsOfMonth === null
          ? 'No spending history yet'
          : `runway ${tenthsToText(runway.runwayTenthsOfMonth)} months`,
    },
  ];
}
