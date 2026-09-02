/**
 * NIZAM · Target funding engine — required funding, underfunded, progress,
 *   next contribution, expected completion, obligation reconciliation.
 * Implemented by: Contract 3 / Phase 3.5, widened by architecture Step 7
 *   (docs/architecture/FINANCIAL_DATA_MODEL_VNEXT.md section 6, rules G1-G5).
 * Depends on: budget.types.ts, month.ts, obligations/obligation.types.ts, lib/money
 *
 * PURE functions. Integer milliunits only; every money operation goes through
 * lib/money, so there is no float arithmetic on any monetary figure. `progress` is
 * a display RATIO, not money, and is the only float in this module.
 *
 * G3: every figure here is a deterministic finance-core output. No LLM authorship.
 * G1: `obligation_reserve` and `debt_reduction` READ the linked Obligation and
 *     ignore `target.amount` entirely — a second source of obligation truth is a
 *     defect, so this module refuses to hold one.
 */
import type { Money } from '@/lib/money/money';
import { add, sub, max, min, divCeil, cmp } from '@/lib/money/money';
import type {
  CategoryTarget,
  MonthKey,
  RolloverBehaviour,
  TargetFamily,
  TargetType,
  Category,
} from '@/features/budget/budget.types';
import { TARGET_FAMILY } from '@/features/budget/budget.types';
import { addMonths, monthOfDate, monthsBetween } from '@/features/budget/month';
import type { Obligation } from '@/features/obligations/obligation.types';
import { fundingAmount } from '@/features/obligations/obligations.logic';

/**
 * The two figures the funding math reads from a computed category month.
 * Declared locally (not imported from budget.logic.ts) so this module stays free of
 * an import cycle; `ComputedCategoryMonth` is structurally assignable to it.
 */
export interface CategoryFundingState {
  assigned: Money;
  available: Money;
}

export interface TargetFunding {
  target: CategoryTarget;
  type: TargetType;
  family: TargetFamily;
  /**
   * The rollover the engine ACTUALLY applied. Equals `target.rollover` only for the
   * `per_month` family; every other family is structurally cumulative and reports
   * `refill`. Surfaced so the UI can disable an inert control rather than imply a
   * choice that changes nothing.
   */
  rolloverApplied: RolloverBehaviour;
  /** Money already counted toward the target: `assigned` under set_aside, else `available`. */
  fundedAmount: Money;
  /** Total the target demands. Sourced from the Obligation for the `obligation` family. */
  requiredFunding: Money;
  /** `requiredFunding - fundedAmount`, floored at zero. Never negative. */
  underfunded: Money;
  /** 0..1 clamped display ratio. NOT money — never used in an arithmetic chain. */
  progress: number;
  /**
   * Level per-month amount that reaches the target exactly on schedule, or null when
   * the target has no deadline and therefore no derivable schedule. This is the figure
   * the legacy `GoalProgress.suggestedPerMonth` reported.
   */
  monthlyRate: Money | null;
  /** What to assign now: `min(monthlyRate, underfunded)`, or the whole shortfall when unscheduled. */
  nextContribution: Money;
  /** Month the target is met if `monthlyRate` is assigned every month from here. Null when unscheduled. */
  expectedCompletion: MonthKey | null;
  funded: boolean;
  /** Machine-readable reason a null field is null, or a scheduling caveat. Null when none. */
  note: string | null;
  /** Which Obligation supplied `requiredFunding`. Null for non-obligation families. */
  obligationId: string | null;
}

/** Clamp a ratio into 0..1. Ratios are not money, so plain float math is correct here. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Resolve the demand for a target that is scheduled against a deadline month.
 * Shared by `balance_by_date` and `obligation` so the schedule math exists once.
 */
function schedule(
  underfunded: Money,
  month: MonthKey,
  deadlineMonth: MonthKey,
): { monthlyRate: Money; note: string | null } {
  const monthsLeft = monthsBetween(month, deadlineMonth);
  if (monthsLeft <= 0) {
    return {
      monthlyRate: underfunded,
      note: `deadline ${deadlineMonth} is already past: the whole shortfall is due now`,
    };
  }
  return { monthlyRate: divCeil(underfunded, monthsLeft), note: null };
}

/**
 * Deterministic funding figures for one category target in one month.
 *
 * Fail-loud by construction: the switch is over `TargetFamily`, `TARGET_FAMILY` is a
 * total `Record<TargetType, TargetFamily>`, and the default arm is a `never` check.
 * A new target type cannot compile without funding math, and a structurally invalid
 * target THROWS rather than silently falling back — the pre-Step-7 code treated any
 * unrecognised type as a date target and substituted `monthsLeft = 1` for a missing
 * target month, both of which produce a confidently wrong number.
 *
 * @param obligation the Obligation referenced by `target.obligationId`. Required for
 *   the `obligation` family; ignored otherwise.
 */
export function targetFunding(
  target: CategoryTarget,
  month: MonthKey,
  computed: CategoryFundingState | undefined,
  obligation: Obligation | null = null,
): TargetFunding {
  const assigned = computed?.assigned ?? 0;
  const available = computed?.available ?? 0;
  const type = target.type;
  const family = TARGET_FAMILY[type];
  if (family === undefined) {
    throw new TypeError(`NIZAM target: unknown target type "${String(type)}"`);
  }

  let rolloverApplied: RolloverBehaviour;
  let fundedAmount: Money;
  let requiredFunding: Money;
  let deadlineMonth: MonthKey | null;
  let obligationId: string | null = null;
  let note: string | null = null;

  switch (family) {
    case 'per_month': {
      // The only family that consults the stored rollover intent. set_aside ignores
      // what carried in (assign `amount` again); refill tops the category back up to
      // `amount`, so leftover reduces the demand. Materially different demands (G2).
      rolloverApplied = target.rollover;
      fundedAmount = rolloverApplied === 'set_aside' ? assigned : available;
      requiredFunding = max(target.amount, 0);
      deadlineMonth = month; // a monthly target completes within its own month
      break;
    }
    case 'balance': {
      // Balance is cumulative by nature, so rollover intent cannot apply.
      rolloverApplied = 'refill';
      fundedAmount = available;
      requiredFunding = max(target.amount, 0);
      deadlineMonth = null;
      note = 'no target month: a per-month schedule is not derivable';
      break;
    }
    case 'balance_by_date': {
      if (target.targetMonth === null) {
        throw new TypeError(
          `NIZAM target: "${type}" requires targetMonth; use target_balance when there is no date`,
        );
      }
      rolloverApplied = 'refill';
      fundedAmount = available;
      requiredFunding = max(target.amount, 0);
      deadlineMonth = target.targetMonth;
      break;
    }
    case 'obligation': {
      if (target.obligationId === null) {
        throw new TypeError(`NIZAM target: "${type}" requires obligationId`);
      }
      if (obligation === null) {
        throw new TypeError(
          `NIZAM target: obligation "${target.obligationId}" was not supplied to targetFunding`,
        );
      }
      if (obligation.id !== target.obligationId) {
        throw new TypeError(
          `NIZAM target: expected obligation "${target.obligationId}", got "${obligation.id}"`,
        );
      }
      rolloverApplied = 'refill';
      fundedAmount = available;
      // G1: sourced from the Obligation, NEVER from target.amount.
      //  - debt_reduction clears the scheduled amount in full (that is what reducing means)
      //  - obligation_reserve holds only what avoids the harm, which for a non-P0 tier is
      //    the contractual minimum. This reuses obligations.logic.fundingAmount rather
      //    than restating the tier rule, so there is one definition of it.
      requiredFunding =
        type === 'debt_reduction' ? max(obligation.amountDue, 0) : max(fundingAmount(obligation), 0);
      obligationId = obligation.id;
      // The funding schedule targets the DUE date, not the grace date. graceDate is a
      // penalty-free late window, so funding to it would schedule being late on purpose.
      // obligationFundingReport deliberately uses `graceDate ?? dueDate` because it asks
      // a different question (will cash cover it before penalty), not when to save.
      deadlineMonth = monthOfDate(obligation.dueDate);
      break;
    }
    default: {
      const exhaustive: never = family;
      throw new TypeError(`NIZAM target: unhandled target family "${String(exhaustive)}"`);
    }
  }

  const underfunded = max(sub(requiredFunding, fundedAmount), 0);
  const funded = cmp(underfunded, 0) === 0;
  const progress = cmp(requiredFunding, 0) <= 0 ? 1 : clamp01(fundedAmount / requiredFunding);

  let monthlyRate: Money | null;
  if (family === 'per_month') {
    // For a recurring monthly demand the level per-month rate IS the target amount, not
    // schedule(underfunded, month, month). Using schedule here gives divCeil(X, 1) = X,
    // which conflates "what to assign NOW" with "the recurring demand". The two differ
    // the moment any prior amount has carried in (refill) or is already assigned (set_aside).
    // nextContribution = min(requiredFunding, underfunded) then gives the correct "assign now".
    monthlyRate = max(requiredFunding, 0);
  } else if (deadlineMonth === null) {
    monthlyRate = null;
  } else {
    const s = schedule(underfunded, month, deadlineMonth);
    monthlyRate = s.monthlyRate;
    if (s.note !== null) note = s.note;
  }

  const nextContribution = monthlyRate === null ? underfunded : min(monthlyRate, underfunded);

  // One projection formula for every family: months needed at the level rate. For a
  // by-date target this reproduces targetMonth exactly, which is the consistency check
  // that the rate and the projection cannot disagree.
  let expectedCompletion: MonthKey | null;
  if (funded) {
    expectedCompletion = month;
  } else if (monthlyRate === null || cmp(monthlyRate, 0) <= 0) {
    expectedCompletion = null;
    if (note === null) note = 'no positive monthly rate: a completion month is not derivable';
  } else {
    expectedCompletion = addMonths(month, divCeil(underfunded, monthlyRate) - 1);
  }

  return {
    target,
    type,
    family,
    rolloverApplied,
    fundedAmount,
    requiredFunding,
    underfunded,
    progress,
    monthlyRate,
    nextContribution,
    expectedCompletion,
    funded,
    note,
    obligationId,
  };
}

// ---------------------------------------------------------------------------
// Obligation reconciliation — the double-count guard
// ---------------------------------------------------------------------------

export interface ObligationTargetReconciliation {
  obligationId: string;
  /** Every category whose target points at this obligation. */
  categoryIds: string[];
  /** True when more than one category claims it — the double-count condition. */
  duplicated: boolean;
  /** Demand counted ONCE for this obligation, whatever the category count. */
  requiredFunding: Money;
}

export interface ObligationTargetAudit {
  lines: ObligationTargetReconciliation[];
  /** Sum of per-obligation demand, each obligation counted exactly once. */
  totalRequired: Money;
  /** Obligation ids referenced by a target that do not exist. Never silently ignored. */
  danglingObligationIds: string[];
  /** True when any obligation is claimed by more than one category. */
  hasDuplicates: boolean;
}

/**
 * Reconcile obligation-linked targets against the Obligation registry.
 *
 * Two categories may legitimately reference one obligation (a split arrangement), but
 * the MONEY must still be counted once. `totalRequired` therefore aggregates per
 * obligation, not per category, so summing category demands can never inflate the
 * figure. `duplicated` and `danglingObligationIds` surface the conditions instead of
 * absorbing them, because a target pointing at a deleted obligation is a data defect,
 * not a zero.
 *
 * This does NOT sum `reserveFor()`. Safe-to-spend's protected reserve and a budget
 * category's assigned money are separate books; adding them would be the actual
 * double count. Callers that need both must reconcile them explicitly.
 */
export function obligationTargetReconciliation(
  categories: readonly Category[],
  obligations: readonly Obligation[],
): ObligationTargetAudit {
  const byId = new Map(obligations.map((o) => [o.id, o]));
  const claims = new Map<string, string[]>();
  const dangling: string[] = [];

  for (const c of categories) {
    const t = c.target;
    if (t === null || TARGET_FAMILY[t.type] !== 'obligation') continue;
    if (t.obligationId === null) {
      throw new TypeError(`NIZAM target: category "${c.id}" has "${t.type}" without obligationId`);
    }
    if (!byId.has(t.obligationId)) {
      if (!dangling.includes(t.obligationId)) dangling.push(t.obligationId);
      continue;
    }
    const existing = claims.get(t.obligationId);
    if (existing) existing.push(c.id);
    else claims.set(t.obligationId, [c.id]);
  }

  const lines: ObligationTargetReconciliation[] = [];
  let totalRequired: Money = 0;
  for (const [obligationId, categoryIds] of [...claims.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const o = byId.get(obligationId);
    if (!o) continue; // unreachable: filtered above, kept so the type is honest
    // The demand a category-level target places on this obligation. Whichever linked
    // type is used, the per-obligation figure is taken once.
    const anyDebtReduction = categoryIds.some((id) => {
      const cat = categories.find((c) => c.id === id);
      return cat?.target?.type === 'debt_reduction';
    });
    const required = max(anyDebtReduction ? o.amountDue : fundingAmount(o), 0);
    lines.push({
      obligationId,
      categoryIds: [...categoryIds].sort((a, b) => a.localeCompare(b)),
      duplicated: categoryIds.length > 1,
      requiredFunding: required,
    });
    totalRequired = add(totalRequired, required);
  }

  return {
    lines,
    totalRequired,
    danglingObligationIds: [...dangling].sort((a, b) => a.localeCompare(b)),
    hasDuplicates: lines.some((l) => l.duplicated),
  };
}
