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

export const TARGET_TYPES = ['monthly', 'target_by_date'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/** Category target / goal (Contract 3 Phase 3.5). */
export interface CategoryTarget {
  type: TargetType;
  /** Milliunits to fund (per month, or total by targetMonth). */
  amount: Money;
  /** Required for 'target_by_date': the YYYY-MM by which `amount` should be available. */
  targetMonth: MonthKey | null;
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
