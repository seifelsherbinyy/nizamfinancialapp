/**
 * NIZAM · Zero-based budget engine — assigned/activity/available + rollover + RTA
 * Implemented by: KIRO Contract 3 / Phases 3.1–3.5
 * Depends on: budget.types.ts, lib/db/schema.ts, lib/ledger/ledgerStore.ts, lib/money
 *
 * PURE functions over NizamDb (no I/O, integer milliunits only).
 * YNAB parity rules (see .kiro/specs/03-budget-engine/design.md):
 *  - available = carryIn + assigned + activity;  carryIn = max(0, prev available)
 *  - RTA(m) = income(≤m) − assigned(≤m) − cash overspend(<m)
 *  - cash overspend resets the category and reduces next RTA; credit overspend
 *    becomes card debt (RTA untouched)
 *  - funded credit spending auto-moves into the card's payment category
 */
import type { Money } from '@/lib/money/money';
import type { MonthKey, Category, CategoryTarget } from '@/features/budget/budget.types';
import type { NizamDb } from '@/lib/db/schema';
import { isCreditType } from '@/features/accounts/accounts.types';
import { monthOf } from '@/lib/ledger/ledgerStore';

// ---------------------------------------------------------------------------
// Month utilities
// ---------------------------------------------------------------------------

export function nextMonth(month: MonthKey): MonthKey {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function prevMonth(month: MonthKey): MonthKey {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Inclusive count of months from `from` to `to`; 0 when to < from. */
export function monthsBetween(from: MonthKey, to: MonthKey): number {
  const fy = Number(from.slice(0, 4)),
    fm = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4)),
    tm = Number(to.slice(5, 7));
  const diff = (ty - fy) * 12 + (tm - fm) + 1;
  return Math.max(0, diff);
}

export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  let m = from;
  while (m <= to) {
    out.push(m);
    m = nextMonth(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Income detection
// ---------------------------------------------------------------------------

const INCOME_NAMES = new Set(['income', 'inflow: ready to assign', 'ready to assign', 'salary']);

/** Category ids treated as income (routed to Ready-To-Assign, not category activity). */
export function incomeCategoryIds(db: NizamDb): Set<string> {
  const ids = new Set<string>();
  for (const c of db.categories) {
    if (INCOME_NAMES.has(c.name.trim().toLowerCase())) ids.add(c.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

export interface ComputedCategoryMonth {
  assigned: Money;
  /** Net categorized activity (spending negative), income categories excluded. */
  activity: Money;
  carryIn: Money;
  available: Money;
  /** Negative-available breakdown. */
  cashOverspend: Money; // >= 0
  creditOverspend: Money; // >= 0
  /** Credit spending covered by this category's budget (moved to payment category). */
  fundedCreditSpend: Money; // >= 0
}

export interface ComputedMonth {
  month: MonthKey;
  categories: Record<string, ComputedCategoryMonth>;
  income: Money;
  totalAssigned: Money;
  readyToAssign: Money;
}

export interface BudgetComputation {
  months: Map<MonthKey, ComputedMonth>;
  /** Earliest month considered (from data), or null when db has no activity. */
  firstMonth: MonthKey | null;
}

interface MonthFacts {
  /** categoryId -> net activity (cash + credit) */
  activity: Map<string, Money>;
  /** categoryId -> credit-account spending magnitude (>= 0) */
  creditSpend: Map<string, Money>;
  /** creditAccountId -> payments received (transfers in from on-budget, >= 0) */
  payments: Map<string, Money>;
  income: Money;
}

function emptyFacts(): MonthFacts {
  return { activity: new Map(), creditSpend: new Map(), payments: new Map(), income: 0 };
}

/** Gather per-month transaction facts in one pass. */
function collectFacts(db: NizamDb, incomeIds: Set<string>): Map<MonthKey, MonthFacts> {
  const facts = new Map<MonthKey, MonthFacts>();
  const accountById = new Map(db.accounts.map((a) => [a.id, a]));
  const factsFor = (month: MonthKey): MonthFacts => {
    let f = facts.get(month);
    if (!f) facts.set(month, (f = emptyFacts()));
    return f;
  };
  const bump = (map: Map<string, Money>, key: string, delta: Money) => {
    map.set(key, (map.get(key) ?? 0) + delta);
  };

  for (const txn of db.transactions) {
    const month = monthOf(txn.date);
    const account = accountById.get(txn.accountId);
    if (!account || !account.onBudget) continue;
    const f = factsFor(month);
    const isCredit = isCreditType(account.type);

    // Transfers: an inflow into a credit account from another on-budget account
    // is a card payment (reduces the payment category).
    if (txn.transferAccountId) {
      if (isCredit && txn.amount > 0) {
        const from = accountById.get(txn.transferAccountId);
        if (from?.onBudget && !isCreditType(from.type)) {
          bump(f.payments, account.id, txn.amount);
        }
      }
      continue; // transfers carry no category activity
    }

    const legs =
      txn.splits && txn.splits.length > 0
        ? txn.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount }))
        : [{ categoryId: txn.categoryId, amount: txn.amount }];

    for (const leg of legs) {
      if (!leg.categoryId) continue;
      if (incomeIds.has(leg.categoryId)) {
        f.income += leg.amount;
        continue;
      }
      bump(f.activity, leg.categoryId, leg.amount);
      if (isCredit && leg.amount < 0) {
        bump(f.creditSpend, leg.categoryId, -leg.amount);
      }
    }
  }
  return facts;
}

/** Payment category id -> credit account id (both directions supported). */
function paymentCategoryByAccount(db: NizamDb): Map<string, string> {
  const map = new Map<string, string>(); // accountId -> categoryId
  for (const a of db.accounts) {
    if (a.paymentCategoryId) map.set(a.id, a.paymentCategoryId);
  }
  for (const c of db.categories) {
    if (c.isCreditCardPayment && c.linkedAccountId && !map.has(c.linkedAccountId)) {
      map.set(c.linkedAccountId, c.id);
    }
  }
  return map;
}

/**
 * Compute the budget for every month from the first data month through `throughMonth`.
 */
export function computeBudget(db: NizamDb, throughMonth: MonthKey): BudgetComputation {
  const incomeIds = incomeCategoryIds(db);
  const facts = collectFacts(db, incomeIds);
  const payCatByAccount = paymentCategoryByAccount(db);
  const paymentCategoryIds = new Set(payCatByAccount.values());

  const monthsWithData = [
    ...new Set([...facts.keys(), ...db.months.map((m) => m.month)]),
  ].sort();
  const firstMonth = monthsWithData[0] ?? null;
  const months = new Map<MonthKey, ComputedMonth>();
  if (!firstMonth || firstMonth > throughMonth) {
    return { months, firstMonth: null };
  }

  const assignedByMonth = new Map<MonthKey, Map<string, Money>>();
  for (const m of db.months) {
    const map = new Map<string, Money>();
    for (const [catId, mc] of Object.entries(m.categories)) map.set(catId, mc.assigned);
    assignedByMonth.set(m.month, map);
  }

  const categoryIds = new Set<string>(db.categories.filter((c) => !incomeIds.has(c.id)).map((c) => c.id));
  // Categories can be referenced by months/transactions even if the entity is gone; include them.
  for (const map of assignedByMonth.values()) for (const id of map.keys()) categoryIds.add(id);
  for (const f of facts.values()) for (const id of f.activity.keys()) categoryIds.add(id);

  let prevAvailable = new Map<string, Money>();
  let cumIncome = 0;
  let cumAssigned = 0;
  let cumCashOverspend = 0; // months strictly before the current one

  for (const month of monthRange(firstMonth, throughMonth)) {
    const f = facts.get(month) ?? emptyFacts();
    const assigned = assignedByMonth.get(month) ?? new Map<string, Money>();
    const computed: Record<string, ComputedCategoryMonth> = {};

    // Pass 1: regular categories (skip payment categories — they need funded totals).
    const fundedByAccount = new Map<string, Money>();
    let monthCashOverspend = 0;
    let monthAssignedTotal = 0;

    const finalize = (
      catId: string,
      extraInflow: Money, // funded credit moves (payment categories only)
      extraOutflow: Money, // payments made (payment categories only)
    ): void => {
      const a = assigned.get(catId) ?? 0;
      const activity = (f.activity.get(catId) ?? 0) + extraInflow - extraOutflow;
      const carryIn = Math.max(0, prevAvailable.get(catId) ?? 0);
      const available = carryIn + a + activity;
      const creditSpend = f.creditSpend.get(catId) ?? 0;
      const overspend = Math.max(0, -available);
      const creditOverspend = Math.min(overspend, creditSpend);
      const cashOverspend = overspend - creditOverspend;
      const fundedCreditSpend = creditSpend - creditOverspend;
      computed[catId] = {
        assigned: a,
        activity,
        carryIn,
        available,
        cashOverspend,
        creditOverspend,
        fundedCreditSpend,
      };
      monthAssignedTotal += a;
      monthCashOverspend += cashOverspend;
    };

    for (const catId of categoryIds) {
      if (paymentCategoryIds.has(catId)) continue;
      finalize(catId, 0, 0);
      const cm = computed[catId];
      if (cm && cm.fundedCreditSpend > 0) {
        // Which card(s)? Aggregate per category is account-agnostic; attribute
        // funded spend to cards proportionally is overkill for a single-card user —
        // attribute by walking transactions per account below instead.
      }
    }

    // Attribute funded credit spend per credit account (needed when multiple cards).
    // Re-walk: per category, distribute its fundedCreditSpend across accounts in
    // proportion to that category's credit spend per account this month.
    if (payCatByAccount.size > 0) {
      const spendByCatAccount = new Map<string, Map<string, Money>>(); // catId -> accountId -> spend
      const accountById = new Map(db.accounts.map((a) => [a.id, a]));
      for (const txn of db.transactions) {
        if (monthOf(txn.date) !== month || txn.transferAccountId) continue;
        const account = accountById.get(txn.accountId);
        if (!account?.onBudget || !isCreditType(account.type)) continue;
        const legs =
          txn.splits && txn.splits.length > 0
            ? txn.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount }))
            : [{ categoryId: txn.categoryId, amount: txn.amount }];
        for (const leg of legs) {
          if (!leg.categoryId || leg.amount >= 0 || incomeIds.has(leg.categoryId)) continue;
          let byAcc = spendByCatAccount.get(leg.categoryId);
          if (!byAcc) spendByCatAccount.set(leg.categoryId, (byAcc = new Map()));
          byAcc.set(txn.accountId, (byAcc.get(txn.accountId) ?? 0) - leg.amount);
        }
      }
      for (const [catId, cm] of Object.entries(computed)) {
        if (cm.fundedCreditSpend <= 0) continue;
        const byAcc = spendByCatAccount.get(catId);
        if (!byAcc) continue;
        const totalSpend = [...byAcc.values()].reduce((x, y) => x + y, 0);
        if (totalSpend <= 0) continue;
        // Deterministic largest-first attribution of the funded amount.
        let remaining = cm.fundedCreditSpend;
        const entries = [...byAcc.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        for (const [accountId, spend] of entries) {
          const share = Math.min(spend, remaining);
          if (share <= 0) break;
          fundedByAccount.set(accountId, (fundedByAccount.get(accountId) ?? 0) + share);
          remaining -= share;
        }
      }
    }

    // Pass 2: payment categories (carry funded moves + payments).
    for (const [accountId, payCatId] of payCatByAccount) {
      if (!categoryIds.has(payCatId)) categoryIds.add(payCatId);
      const funded = fundedByAccount.get(accountId) ?? 0;
      const paid = f.payments.get(accountId) ?? 0;
      finalize(payCatId, funded, paid);
    }

    cumIncome += f.income;
    cumAssigned += monthAssignedTotal;

    months.set(month, {
      month,
      categories: computed,
      income: f.income,
      totalAssigned: monthAssignedTotal,
      readyToAssign: cumIncome - cumAssigned - cumCashOverspend,
    });

    // Prepare next month.
    cumCashOverspend += monthCashOverspend;
    prevAvailable = new Map(Object.entries(computed).map(([id, c]) => [id, c.available]));
  }

  return { months, firstMonth };
}

/** Convenience: computed numbers for one month (computing the chain up to it). */
export function computeMonth(db: NizamDb, month: MonthKey): ComputedMonth {
  const { months } = computeBudget(db, month);
  return (
    months.get(month) ?? {
      month,
      categories: {},
      income: 0,
      totalAssigned: 0,
      readyToAssign: 0,
    }
  );
}

// ---------------------------------------------------------------------------
// Goals / targets (Phase 3.5)
// ---------------------------------------------------------------------------

export interface GoalProgress {
  target: CategoryTarget;
  /** 0..1 clamped funding ratio. */
  progress: number;
  /** Milliunits still needed (this month for monthly; overall for target_by_date). */
  remaining: Money;
  /** For target_by_date: suggested assignment per remaining month (ceil). */
  suggestedPerMonth: Money | null;
}

export function goalProgress(
  category: Category,
  month: MonthKey,
  computed: ComputedCategoryMonth | undefined,
): GoalProgress | null {
  const target = category.target;
  if (!target) return null;
  const assigned = computed?.assigned ?? 0;
  const available = computed?.available ?? 0;

  if (target.type === 'monthly') {
    const remaining = Math.max(0, target.amount - assigned);
    const progress = target.amount <= 0 ? 1 : Math.min(1, Math.max(0, assigned / target.amount));
    return { target, progress, remaining, suggestedPerMonth: target.amount };
  }

  // target_by_date
  const remaining = Math.max(0, target.amount - available);
  const monthsLeft = target.targetMonth ? monthsBetween(month, target.targetMonth) : 1;
  const suggested =
    monthsLeft <= 0 ? remaining : Math.ceil(remaining / monthsLeft);
  const progress = target.amount <= 0 ? 1 : Math.min(1, Math.max(0, available / target.amount));
  return { target, progress, remaining, suggestedPerMonth: suggested };
}

// ---------------------------------------------------------------------------
// Mutation helpers (call inside store.mutate)
// ---------------------------------------------------------------------------

/** Set the assigned amount for a category in a month (creates the month record). */
export function setAssigned(db: NizamDb, month: MonthKey, categoryId: string, amount: Money): void {
  if (!Number.isSafeInteger(amount)) throw new TypeError('NIZAM: assigned must be integer milliunits');
  let record = db.months.find((m) => m.month === month);
  if (!record) {
    record = { month, categories: {} };
    db.months.push(record);
    db.months.sort((a, b) => a.month.localeCompare(b.month));
  }
  const existing = record.categories[categoryId];
  record.categories[categoryId] = {
    assigned: amount,
    activity: existing?.activity ?? 0,
    available: existing?.available ?? 0,
  };
}

export interface SeedShape {
  groups: { name: string; categories: string[] }[];
}

let seedCounter = 0;
function seedId(prefix: string, name: string): string {
  seedCounter += 1;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${prefix}_${slug}_${seedCounter.toString(36)}`;
}

/** Load the category seed (data/seed/categories.seed.json). Idempotent by name. */
export function applySeed(db: NizamDb, seed: SeedShape): void {
  for (const group of seed.groups) {
    let g = db.categoryGroups.find((x) => x.name.toLowerCase() === group.name.toLowerCase());
    if (!g) {
      g = { id: seedId('grp', group.name), name: group.name, order: db.categoryGroups.length, hidden: false };
      db.categoryGroups.push(g);
    }
    for (const catName of group.categories) {
      const exists = db.categories.some((c) => c.name.toLowerCase() === catName.toLowerCase());
      if (!exists) {
        db.categories.push({
          id: seedId('cat', catName),
          groupId: g.id,
          name: catName,
          order: db.categories.length,
          hidden: false,
          target: null,
          isCreditCardPayment: false,
          linkedAccountId: null,
        });
      }
    }
  }
}

const CC_GROUP_NAME = 'Credit Card Payments';

/** Ensure every on-budget credit account has a linked payment category. Idempotent. */
export function ensureCreditCardPaymentCategories(db: NizamDb): void {
  const creditAccounts = db.accounts.filter((a) => a.onBudget && isCreditType(a.type) && !a.closed);
  if (creditAccounts.length === 0) return;

  let group = db.categoryGroups.find((g) => g.name === CC_GROUP_NAME);
  for (const account of creditAccounts) {
    const linked =
      (account.paymentCategoryId && db.categories.find((c) => c.id === account.paymentCategoryId)) ||
      db.categories.find((c) => c.isCreditCardPayment && c.linkedAccountId === account.id);
    if (linked) {
      account.paymentCategoryId = linked.id;
      continue;
    }
    if (!group) {
      group = { id: seedId('grp', CC_GROUP_NAME), name: CC_GROUP_NAME, order: db.categoryGroups.length, hidden: false };
      db.categoryGroups.push(group);
    }
    const category = {
      id: seedId('cat', `${account.name} payment`),
      groupId: group.id,
      name: `${account.name} Payment`,
      order: db.categories.length,
      hidden: false,
      target: null,
      isCreditCardPayment: true,
      linkedAccountId: account.id,
    };
    db.categories.push(category);
    account.paymentCategoryId = category.id;
  }
}
