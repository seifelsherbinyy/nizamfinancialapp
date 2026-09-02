/**
 * NIZAM · Budget domain types — CategoryGroup, Category, MonthBudget, targets
 * Implemented by: KIRO Contract 1 / Phase 1.5 (refined by Contract 3)
 * Depends on: lib/money/money.ts
 */
import type { Money } from '@/lib/money/money';

/** Budget month key, ISO YYYY-MM. */
export type MonthKey = string;

export interface CategoryGroup {
  id: string;
  name: string;
  order: number;
  hidden: boolean;
}

/**
 * Target vocabulary, widened from the original two (`monthly`, `target_by_date`)
 * per docs/architecture/FINANCIAL_DATA_MODEL_VNEXT.md section 6. The two legacy
 * names are RENAMED, not aliased: schema v7 migrates `monthly` -> `monthly_funding`
 * and `target_by_date` -> `target_balance_by_date`. Keeping synonyms would mean two
 * code paths for one meaning, which is the "second source of truth" defect G1 warns
 * against.
 */
export const TARGET_TYPES = [
  'monthly_funding',
  'target_balance',
  'target_balance_by_date',
  'sinking_fund',
  'acquisition',
  'emergency_reserve',
  'obligation_reserve',
  'debt_reduction',
] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/**
 * How last month's leftover affects this month's demand (vNext G2).
 *  - `set_aside`: assign `amount` again this month regardless of what carried in.
 *  - `refill`: top the category back up TO `amount`, so leftover reduces the demand.
 * The two produce materially different funding demands, which is why it is stored
 * explicitly rather than inferred.
 */
export const ROLLOVER_BEHAVIOURS = ['set_aside', 'refill'] as const;
export type RolloverBehaviour = (typeof ROLLOVER_BEHAVIOURS)[number];

/**
 * The four funding-math families the eight target types reduce to.
 *
 * This is deliberately honest: several types share identical arithmetic and differ
 * only in owner intent and reporting treatment. Inventing arithmetic differences to
 * justify separate types would be fabrication. What the types DO buy is that policy,
 * reports and the UI can distinguish an emergency reserve from an ordinary balance
 * goal without guessing.
 *
 *  - `per_month`     recurring monthly demand; the only family that reads `rollover`.
 *  - `balance`       hold `amount` available, no deadline, so no schedule is derivable.
 *  - `balance_by_date` hold `amount` available by `targetMonth`; requires `targetMonth`.
 *  - `obligation`    demand is sourced from the linked `Obligation`, never from `amount`.
 */
export type TargetFamily = 'per_month' | 'balance' | 'balance_by_date' | 'obligation';

/**
 * Total map from target type to funding family.
 *
 * `Record<TargetType, TargetFamily>` is the fail-loud mechanism: adding a ninth
 * target type without giving it funding math is a COMPILE ERROR here, and the engine
 * switches on the family with a `never` exhaustiveness guard. The pre-widening code
 * branched `if (type === 'monthly')` and treated everything else as a date target,
 * which would have given six new types silently wrong math.
 */
export const TARGET_FAMILY: Record<TargetType, TargetFamily> = {
  monthly_funding: 'per_month',
  target_balance: 'balance',
  emergency_reserve: 'balance',
  target_balance_by_date: 'balance_by_date',
  sinking_fund: 'balance_by_date',
  acquisition: 'balance_by_date',
  obligation_reserve: 'obligation',
  debt_reduction: 'obligation',
};

/** True for families whose demand is scheduled against a `targetMonth`. */
export function requiresTargetMonth(type: TargetType): boolean {
  return TARGET_FAMILY[type] === 'balance_by_date';
}

/** True for families whose demand is sourced from an `Obligation`. */
export function requiresObligation(type: TargetType): boolean {
  return TARGET_FAMILY[type] === 'obligation';
}

/** Category target / goal (Contract 3 Phase 3.5, widened by Step 7). */
export interface CategoryTarget {
  type: TargetType;
  /**
   * Milliunits to fund (per month for `per_month`, else the balance to reach).
   * IGNORED by the `obligation` family, where the linked Obligation is the only
   * source of truth for the amount.
   */
  amount: Money;
  /** Required when `requiresTargetMonth(type)`: the YYYY-MM by which the balance is wanted. */
  targetMonth: MonthKey | null;
  /**
   * Rollover intent. Only the `per_month` family consults it; balance and obligation
   * families are structurally cumulative and always behave as `refill`. The engine
   * reports the behaviour it actually applied so the UI can disable the inert control
   * instead of implying a choice that does nothing.
   */
  rollover: RolloverBehaviour;
  /** Required when `requiresObligation(type)`: the Obligation this target funds. */
  obligationId: string | null;
}

export interface Category {
  id: string;
  groupId: string;
  name: string;
  order: number;
  hidden: boolean;
  target: CategoryTarget | null;
  /** True for auto-managed credit-card payment categories. */
  isCreditCardPayment: boolean;
  /** For CC payment categories: the credit account they pay. */
  linkedAccountId: string | null;
}

/** Per-category numbers for one month. All in signed milliunits. */
export interface MonthCategoryBudget {
  /** Amount assigned (budgeted) this month. */
  assigned: Money;
  /** Net categorized activity this month (spending negative, refunds positive). */
  activity: Money;
  /** Rolling available = prev available (if positive) + assigned + activity. */
  available: Money;
}

/** One budget month: category id -> numbers. */
export interface MonthBudget {
  month: MonthKey;
  categories: Record<string, MonthCategoryBudget>;
}

/** Computed header numbers for a month (Contract 3 Phase 3.3). */
export interface ReadyToAssign {
  month: MonthKey;
  /** Income minus total assigned through this month (and other RTA adjustments). */
  amount: Money;
}
