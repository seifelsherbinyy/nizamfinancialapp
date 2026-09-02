// @vitest-environment node
/**
 * NIZAM · Target funding engine tests — hand-computed fixtures.
 * Implemented by: Contract 3 / Phase 3.5 (architecture Step 7).
 * Depends on: targets.ts, month.ts, obligation.types.ts, lib/money
 *
 * Coverage requirements from IMPLEMENTATION_PLAN.md Step 7:
 *  - target funding across all supported types
 *  - rollover behaviours produce different demands
 *  - obligation_reserve reconciles with Obligation without double-counting
 */
import { describe, it, expect } from 'vitest';
import type { CategoryTarget } from '@/features/budget/budget.types';
import type { Obligation } from '@/features/obligations/obligation.types';
import type { Category } from '@/features/budget/budget.types';
import { targetFunding, obligationTargetReconciliation } from './targets.ts';

const EGP = (n: number) => n * 1000; // convenience: EGP to milliunits

let seq = 0;
const id = (p: string) => `${p}_${++seq}`;

function target(overrides: Partial<CategoryTarget> & Pick<CategoryTarget, 'type'>): CategoryTarget {
  return {
    amount: EGP(100),
    targetMonth: null,
    rollover: 'set_aside',
    obligationId: null,
    ...overrides,
  };
}

function oblig(
  overrides: Partial<Obligation> & Pick<Obligation, 'dueDate' | 'priority' | 'amountDue'>,
): Obligation {
  return {
    id: id('ob'),
    creditor: 'Creditor',
    accountId: null,
    minimumDue: overrides.amountDue,
    graceDate: null,
    frequency: 'monthly',
    penalty: 0,
    interestBps: 0,
    autopay: false,
    verificationSource: 'manual',
    confidence: 1,
    protectedReserve: 0,
    ...overrides,
  };
}

function cat(overrides: Partial<Category> & Pick<Category, 'id'>): Category {
  return {
    groupId: 'grp_1',
    name: 'Test',
    order: 0,
    hidden: false,
    target: null,
    isCreditCardPayment: false,
    linkedAccountId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// monthly_funding — the per_month family
// ---------------------------------------------------------------------------

describe('monthly_funding', () => {
  it('set_aside: funded amount is assigned (not available); demand restated each month', () => {
    const t = target({ type: 'monthly_funding', amount: EGP(100), rollover: 'set_aside' });
    // 60 EGP assigned this month, 90 available (40 carried in from before).
    const f = targetFunding(t, '2026-03', { assigned: EGP(60), available: EGP(90) });
    expect(f.fundedAmount).toBe(EGP(60));
    expect(f.requiredFunding).toBe(EGP(100));
    expect(f.underfunded).toBe(EGP(40));
    expect(f.rolloverApplied).toBe('set_aside');
    expect(f.family).toBe('per_month');
    expect(f.monthlyRate).toBe(EGP(100)); // the monthly target amount is the recurring demand
  });

  it('refill: funded amount is available; leftover reduces demand', () => {
    const t = target({ type: 'monthly_funding', amount: EGP(100), rollover: 'refill' });
    // Same 90 available — only 10 still needed because we already have 90 of 100.
    const f = targetFunding(t, '2026-03', { assigned: EGP(60), available: EGP(90) });
    expect(f.fundedAmount).toBe(EGP(90));
    expect(f.underfunded).toBe(EGP(10));
    expect(f.rolloverApplied).toBe('refill');
  });

  it('set_aside and refill give different demands — rollover is not cosmetic', () => {
    const base = { assigned: EGP(60), available: EGP(90) };
    const fSetAside = targetFunding(
      target({ type: 'monthly_funding', amount: EGP(100), rollover: 'set_aside' }),
      '2026-03',
      base,
    );
    const fRefill = targetFunding(
      target({ type: 'monthly_funding', amount: EGP(100), rollover: 'refill' }),
      '2026-03',
      base,
    );
    // set_aside ignores the 40 that carried in; refill counts it.
    expect(fSetAside.underfunded).toBeGreaterThan(fRefill.underfunded);
  });

  it('fully funded: progress=1, underfunded=0, funded=true', () => {
    const t = target({ type: 'monthly_funding', amount: EGP(100), rollover: 'set_aside' });
    const f = targetFunding(t, '2026-03', { assigned: EGP(100), available: EGP(100) });
    expect(f.funded).toBe(true);
    expect(f.underfunded).toBe(0);
    expect(f.progress).toBe(1);
    expect(f.expectedCompletion).toBe('2026-03');
  });

  it('no assignment: all underfunded, nextContribution = full amount', () => {
    const t = target({ type: 'monthly_funding', amount: EGP(100), rollover: 'set_aside' });
    const f = targetFunding(t, '2026-03', undefined);
    expect(f.underfunded).toBe(EGP(100));
    expect(f.nextContribution).toBe(EGP(100));
  });
});

// ---------------------------------------------------------------------------
// target_balance — balance family, no deadline
// ---------------------------------------------------------------------------

describe('target_balance', () => {
  it('uses available; no schedule is derivable', () => {
    const t = target({ type: 'target_balance', amount: EGP(500) });
    const f = targetFunding(t, '2026-03', { assigned: EGP(200), available: EGP(350) });
    expect(f.fundedAmount).toBe(EGP(350));
    expect(f.requiredFunding).toBe(EGP(500));
    expect(f.underfunded).toBe(EGP(150));
    expect(f.monthlyRate).toBeNull(); // no deadline → no per-month rate
    expect(f.expectedCompletion).toBeNull();
    expect(f.rolloverApplied).toBe('refill'); // balance is structurally cumulative
    expect(f.family).toBe('balance');
  });

  it('nextContribution equals the full shortfall when unscheduled', () => {
    const t = target({ type: 'target_balance', amount: EGP(500) });
    const f = targetFunding(t, '2026-03', { assigned: EGP(200), available: EGP(350) });
    expect(f.nextContribution).toBe(f.underfunded);
  });

  it('emergency_reserve has the same balance family', () => {
    const t = target({ type: 'emergency_reserve', amount: EGP(500) });
    const f = targetFunding(t, '2026-03', { assigned: EGP(200), available: EGP(350) });
    expect(f.family).toBe('balance');
    expect(f.underfunded).toBe(EGP(150));
  });
});

// ---------------------------------------------------------------------------
// target_balance_by_date / sinking_fund / acquisition — balance_by_date family
// ---------------------------------------------------------------------------

describe('balance_by_date family', () => {
  it('target_balance_by_date: uses exact BigInt divCeil, no float', () => {
    // 90 000 milliunits remaining over 4 months (this month..targetMonth inclusive)
    // 90000 / 4 = 22500 exactly — no rounding needed here
    const t = target({ type: 'target_balance_by_date', amount: EGP(100), targetMonth: '2026-06' });
    const f = targetFunding(t, '2026-03', { assigned: EGP(10), available: EGP(10) });
    expect(f.underfunded).toBe(EGP(90));
    expect(f.monthlyRate).toBe(22_500); // 90000 / 4 = 22500 exactly
    expect(f.family).toBe('balance_by_date');
    expect(f.expectedCompletion).toBe('2026-06');
  });

  it('divCeil: non-divisible remainder rounds UP, never down — BigInt not float', () => {
    // 100 000 milliunits over 3 months: 100000/3 = 33333.33… → ceil = 33334
    const t = target({ type: 'target_balance_by_date', amount: EGP(100), targetMonth: '2026-05' });
    const f = targetFunding(t, '2026-03', { assigned: 0, available: 0 });
    expect(f.underfunded).toBe(EGP(100));
    expect(f.monthlyRate).toBe(33_334); // NOT 33333 (floor) — the one-milliunit difference matters
  });

  it('sinking_fund is the same balance_by_date family', () => {
    const t = target({
      type: 'sinking_fund',
      amount: EGP(100),
      targetMonth: '2026-06',
      rollover: 'refill',
    });
    const f = targetFunding(t, '2026-03', { assigned: EGP(40), available: EGP(40) });
    expect(f.family).toBe('balance_by_date');
    expect(f.underfunded).toBe(EGP(60));
  });

  it('acquisition is the same balance_by_date family', () => {
    const t = target({ type: 'acquisition', amount: EGP(200), targetMonth: '2026-12' });
    const f = targetFunding(t, '2026-06', { assigned: EGP(50), available: EGP(50) });
    expect(f.family).toBe('balance_by_date');
    expect(f.underfunded).toBe(EGP(150));
  });

  it('deadline already passed: the whole shortfall is the rate', () => {
    const t = target({ type: 'target_balance_by_date', amount: EGP(100), targetMonth: '2026-01' });
    const f = targetFunding(t, '2026-03', { assigned: 0, available: 0 });
    expect(f.monthlyRate).toBe(EGP(100));
    expect(f.note).toMatch(/past/);
  });

  it('throws when targetMonth is null', () => {
    const t = target({ type: 'target_balance_by_date', amount: EGP(100), targetMonth: null });
    expect(() => targetFunding(t, '2026-03', undefined)).toThrow(/requires targetMonth/);
  });
});

// ---------------------------------------------------------------------------
// obligation_reserve + debt_reduction — obligation family
// ---------------------------------------------------------------------------

describe('obligation family', () => {
  const o = oblig({ dueDate: '2026-06-15', priority: 'P1', amountDue: EGP(5000), minimumDue: EGP(500) });

  it('obligation_reserve: demand = fundingAmount (P1 → minimumDue)', () => {
    const t = target({ type: 'obligation_reserve', amount: EGP(999), obligationId: o.id });
    // amount=999 is IGNORED — G1 says the Obligation is the only source of truth
    const f = targetFunding(t, '2026-03', { assigned: 0, available: EGP(200) }, o);
    expect(f.requiredFunding).toBe(EGP(500)); // minimumDue for P1
    expect(f.fundedAmount).toBe(EGP(200));
    expect(f.underfunded).toBe(EGP(300));
    expect(f.obligationId).toBe(o.id);
    expect(f.family).toBe('obligation');
    expect(f.rolloverApplied).toBe('refill');
    // deadline month of 2026-06-15 is '2026-06'; monthsBetween 2026-03..2026-06 = 4
    expect(f.monthlyRate).toBe(75_000); // 300000 / 4 = 75000 exactly
  });

  it('debt_reduction: demand = full amountDue, not just minimum', () => {
    const t = target({ type: 'debt_reduction', amount: EGP(999), obligationId: o.id });
    const f = targetFunding(t, '2026-03', { assigned: 0, available: EGP(200) }, o);
    expect(f.requiredFunding).toBe(EGP(5000)); // amountDue, not minimumDue
    expect(f.underfunded).toBe(EGP(4800));
  });

  it('debt_reduction demand > obligation_reserve demand — the two differ materially', () => {
    const reserve = targetFunding(
      target({ type: 'obligation_reserve', obligationId: o.id }),
      '2026-03',
      { assigned: 0, available: 0 },
      o,
    );
    const reduction = targetFunding(
      target({ type: 'debt_reduction', obligationId: o.id }),
      '2026-03',
      { assigned: 0, available: 0 },
      o,
    );
    expect(reduction.requiredFunding).toBeGreaterThan(reserve.requiredFunding);
  });

  it('P0 obligation_reserve: demand = amountDue (same as debt_reduction for P0)', () => {
    const p0 = oblig({ dueDate: '2026-06-15', priority: 'P0', amountDue: EGP(5000) });
    p0.minimumDue = EGP(5000); // P0: no minimum distinction
    const t = target({ type: 'obligation_reserve', obligationId: p0.id });
    const f = targetFunding(t, '2026-03', undefined, p0);
    expect(f.requiredFunding).toBe(EGP(5000));
  });

  it('throws when obligationId is null', () => {
    const t = target({ type: 'obligation_reserve', obligationId: null });
    expect(() => targetFunding(t, '2026-03', undefined)).toThrow(/requires obligationId/);
  });

  it('throws when the supplied obligation id does not match the target', () => {
    const other = oblig({ dueDate: '2026-06-15', priority: 'P2', amountDue: EGP(100) });
    const t = target({ type: 'obligation_reserve', obligationId: o.id });
    expect(() => targetFunding(t, '2026-03', undefined, other)).toThrow(/expected obligation/);
  });

  it('throws when obligation is not supplied', () => {
    const t = target({ type: 'obligation_reserve', obligationId: o.id });
    expect(() => targetFunding(t, '2026-03', undefined, null)).toThrow(/was not supplied/);
  });
});

// ---------------------------------------------------------------------------
// Progress / completion formulas
// ---------------------------------------------------------------------------

describe('progress and expectedCompletion', () => {
  it('progress is 0 when nothing is funded', () => {
    const t = target({ type: 'target_balance', amount: EGP(100) });
    const f = targetFunding(t, '2026-03', { assigned: 0, available: 0 });
    expect(f.progress).toBe(0);
  });

  it('progress is clamped to 1 even when overfunded', () => {
    const t = target({ type: 'target_balance', amount: EGP(100) });
    const f = targetFunding(t, '2026-03', { assigned: EGP(120), available: EGP(120) });
    expect(f.progress).toBe(1);
    expect(f.funded).toBe(true);
  });

  it('expectedCompletion matches targetMonth exactly for a by-date target', () => {
    const t = target({ type: 'target_balance_by_date', amount: EGP(100), targetMonth: '2026-06' });
    const f = targetFunding(t, '2026-03', { assigned: 0, available: 0 });
    // rate = ceil(100000 / 4) = 25000; underfunded 100000 / 25000 = 4 → addMonths(Mar, 3) = Jun
    expect(f.expectedCompletion).toBe('2026-06');
  });

  it('expectedCompletion is null for a balance target (no rate)', () => {
    const t = target({ type: 'target_balance', amount: EGP(100) });
    const f = targetFunding(t, '2026-03', { assigned: 0, available: 0 });
    expect(f.expectedCompletion).toBeNull();
  });

  it('funded target: expectedCompletion is the current month', () => {
    const t = target({ type: 'target_balance', amount: EGP(100) });
    const f = targetFunding(t, '2026-03', { assigned: EGP(100), available: EGP(100) });
    expect(f.expectedCompletion).toBe('2026-03');
  });
});

// ---------------------------------------------------------------------------
// Obligation target reconciliation — double-count guard (G1)
// ---------------------------------------------------------------------------

describe('obligationTargetReconciliation', () => {
  const obA = oblig({ dueDate: '2026-06-01', priority: 'P1', amountDue: EGP(500) });
  const obB = oblig({ dueDate: '2026-07-01', priority: 'P2', amountDue: EGP(200) });

  it('each obligation counted once even if two categories reference it', () => {
    const cats: Category[] = [
      cat({ id: 'c1', target: target({ type: 'obligation_reserve', obligationId: obA.id }) }),
      cat({ id: 'c2', target: target({ type: 'obligation_reserve', obligationId: obA.id }) }),
      cat({ id: 'c3', target: target({ type: 'obligation_reserve', obligationId: obB.id }) }),
    ];
    const result = obligationTargetReconciliation(cats, [obA, obB]);
    // obA claimed by two categories — this is the duplicate condition
    const lineA = result.lines.find((l) => l.obligationId === obA.id)!;
    expect(lineA.duplicated).toBe(true);
    expect(lineA.categoryIds).toHaveLength(2);
    // totalRequired counts each obligation ONCE (G1: no double counting)
    expect(result.totalRequired).toBe(obA.minimumDue + obB.minimumDue); // P1+P2 → min for both? No: P2→0 via fundingAmount. Let's verify:
    // fundingAmount(P1) = minimumDue = 500_000; fundingAmount(P2) = minimumDue = 200_000 (P2 not P0)
    // actually fundingAmount = P0->amountDue else minimumDue; obB is P2 so minimumDue=200_000
    expect(result.hasDuplicates).toBe(true);
  });

  it('a dangling obligationId is reported, not silently zeroed', () => {
    const cats: Category[] = [
      cat({ id: 'c1', target: target({ type: 'obligation_reserve', obligationId: 'ob_gone' }) }),
    ];
    const result = obligationTargetReconciliation(cats, [obA]);
    expect(result.danglingObligationIds).toContain('ob_gone');
    expect(result.lines).toHaveLength(0); // nothing counted for a dangling reference
    expect(result.totalRequired).toBe(0);
  });

  it('non-obligation categories are ignored', () => {
    const cats: Category[] = [
      cat({ id: 'c1', target: target({ type: 'monthly_funding', amount: EGP(100) }) }),
      cat({ id: 'c2', target: null }),
    ];
    const result = obligationTargetReconciliation(cats, [obA]);
    expect(result.lines).toHaveLength(0);
    expect(result.totalRequired).toBe(0);
  });

  it('empty inputs produce a clean audit', () => {
    const result = obligationTargetReconciliation([], []);
    expect(result.lines).toHaveLength(0);
    expect(result.totalRequired).toBe(0);
    expect(result.hasDuplicates).toBe(false);
    expect(result.danglingObligationIds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Candidate does not affect engine output (regression guard)
// Mirrors the Step 6 guard: obligation_reserve and budget engine are separate.
// ---------------------------------------------------------------------------

describe('engine isolation', () => {
  it('targetFunding ignores any context outside its arguments (pure function)', () => {
    const t = target({ type: 'monthly_funding', amount: EGP(100), rollover: 'set_aside' });
    const result1 = targetFunding(t, '2026-03', { assigned: EGP(60), available: EGP(60) });
    const result2 = targetFunding(t, '2026-03', { assigned: EGP(60), available: EGP(60) });
    // Two identical calls must return identical figures — no hidden state.
    expect(result1.underfunded).toBe(result2.underfunded);
    expect(result1.monthlyRate).toBe(result2.monthlyRate);
  });
});
