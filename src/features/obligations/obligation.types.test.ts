// @vitest-environment node
/**
 * NIZAM · Obligation type helpers — reserve, tier, funding order.
 * Owning contract: PFOS contract 01 (Constitution) section 5.2 tiers.
 * Build phase: PFOS Stage 1, phase 1.1 — obligation schema helpers.
 */
import { describe, it, expect } from 'vitest';
import type { Obligation } from './obligation.types.ts';
import {
  reserveFor,
  isProtectedTier,
  fundingSequence,
  OBLIGATION_PRIORITIES,
} from './obligation.types.ts';
import { fundingAmount } from './obligations.logic.ts';

const M = 1000;

function oblig(p: Partial<Obligation> & Pick<Obligation, 'priority' | 'amountDue'>): Obligation {
  return {
    id: 'ob',
    creditor: 'C',
    accountId: null,
    minimumDue: 500 * M,
    dueDate: '2026-01-15',
    graceDate: null,
    frequency: 'monthly',
    penalty: 0,
    interestBps: 0,
    autopay: false,
    verificationSource: 'manual',
    confidence: 1,
    protectedReserve: 0,
    ...p,
  };
}

describe('reserveFor (safe-to-spend PROTECTION floor)', () => {
  it('P0 reserves the full amount due', () => {
    expect(reserveFor(oblig({ priority: 'P0', amountDue: 3_000 * M }))).toBe(3_000 * M);
  });
  it('P1 reserves the contractual minimum', () => {
    expect(reserveFor(oblig({ priority: 'P1', amountDue: 3_000 * M, minimumDue: 500 * M }))).toBe(500 * M);
  });
  it('P2 and P3 reserve nothing from the tier', () => {
    expect(reserveFor(oblig({ priority: 'P2', amountDue: 3_000 * M }))).toBe(0);
    expect(reserveFor(oblig({ priority: 'P3', amountDue: 3_000 * M }))).toBe(0);
  });
  it('an explicit protectedReserve wins when larger', () => {
    expect(reserveFor(oblig({ priority: 'P3', amountDue: 3_000 * M, protectedReserve: 1_000 * M }))).toBe(1_000 * M);
    // ...but never under-reserves a P0
    expect(reserveFor(oblig({ priority: 'P0', amountDue: 3_000 * M, protectedReserve: 100 * M }))).toBe(3_000 * M);
  });
  it('never negative', () => {
    expect(reserveFor(oblig({ priority: 'P2', amountDue: 0, protectedReserve: 0 }))).toBe(0);
  });
});

describe('fundingAmount (feasibility payment)', () => {
  it('P0 must be paid in full; other tiers avoid harm at the minimum', () => {
    expect(fundingAmount(oblig({ priority: 'P0', amountDue: 3_000 * M, minimumDue: 500 * M }))).toBe(3_000 * M);
    expect(fundingAmount(oblig({ priority: 'P1', amountDue: 3_000 * M, minimumDue: 500 * M }))).toBe(500 * M);
    expect(fundingAmount(oblig({ priority: 'P2', amountDue: 3_000 * M, minimumDue: 500 * M }))).toBe(500 * M);
    expect(fundingAmount(oblig({ priority: 'P3', amountDue: 3_000 * M, minimumDue: 500 * M }))).toBe(500 * M);
  });
});

describe('isProtectedTier', () => {
  it('protects only P0 and P1', () => {
    expect(isProtectedTier('P0')).toBe(true);
    expect(isProtectedTier('P1')).toBe(true);
    expect(isProtectedTier('P2')).toBe(false);
    expect(isProtectedTier('P3')).toBe(false);
  });
});

describe('fundingSequence', () => {
  it('orders by tier, then due date, then larger penalty, then id', () => {
    const obs: Obligation[] = [
      oblig({ id: 'z', priority: 'P1', amountDue: M, dueDate: '2026-02-01' }),
      oblig({ id: 'a', priority: 'P0', amountDue: M, dueDate: '2026-03-01' }),
      oblig({ id: 'b', priority: 'P0', amountDue: M, dueDate: '2026-01-10', penalty: 50 * M }),
      oblig({ id: 'c', priority: 'P0', amountDue: M, dueDate: '2026-01-10', penalty: 90 * M }),
    ];
    expect(fundingSequence(obs).map((o) => o.id)).toEqual(['c', 'b', 'a', 'z']);
  });
  it('does not mutate its input', () => {
    const obs = [oblig({ id: 'x', priority: 'P3', amountDue: M }), oblig({ id: 'y', priority: 'P0', amountDue: M })];
    const snapshot = obs.map((o) => o.id);
    fundingSequence(obs);
    expect(obs.map((o) => o.id)).toEqual(snapshot);
  });
  it('priority order constant is most-to-least severe', () => {
    expect(OBLIGATION_PRIORITIES).toEqual(['P0', 'P1', 'P2', 'P3']);
  });
});
