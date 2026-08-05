/**
 * NIZAM · Obligation registry types (creditor, due date, priority, protected reserve)
 * Owning contract: PFOS contract 02 (Data Architecture) section 6 — the obligation fields.
 * Build phase: PFOS Stage 1, phase 1.1 — obligation registry schema.
 * Depends on: lib/money/money.ts
 *
 * Source contracts (ingested, authoritative):
 *  - contracts/pfos/01_..._Product_Constitution... section 5.2 — the P0..P3 obligation matrix
 *    and its default override policy.
 *  - contracts/pfos/02_..._Data_Architecture... section 6 — the thirteen obligation fields.
 *
 * An Obligation is a FUTURE commitment with a due date. It is deliberately NOT a
 * transaction (which records something that already happened) and NOT a budget
 * category target (which is a savings intent). Safe-to-spend reserves against it.
 */
import type { Money } from '@/lib/money/money';

/**
 * Harm tiers, contract 01 section 5.2. Ordered most to least severe; the numeric
 * index is the funding sequence, so never reorder without changing that contract.
 */
export const OBLIGATION_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type ObligationPriority = (typeof OBLIGATION_PRIORITIES)[number];

/** Default override policy per tier, quoted from contract 01 section 5.2. */
export const PRIORITY_OVERRIDE_POLICY: Record<ObligationPriority, string> = {
  P0: 'never',
  P1: 'exceptional',
  P2: 'conditional',
  P3: 'flexible',
};

export const OBLIGATION_FREQUENCIES = ['once', 'weekly', 'monthly', 'quarterly', 'annual'] as const;
export type ObligationFrequency = (typeof OBLIGATION_FREQUENCIES)[number];

/** Where the amount and date came from — drives the confidence term in safe-to-spend. */
export const VERIFICATION_SOURCES = ['statement', 'provider', 'manual', 'inferred'] as const;
export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

export interface Obligation {
  id: string;
  /** Who is owed. Free text so family and informal lenders are representable. */
  creditor: string;
  /** Optional link to the liability account this obligation pays down. */
  accountId: string | null;
  /** Full amount due on the due date (signed positive; it is an outflow by nature). */
  amountDue: Money;
  /** Contractual minimum that avoids penalty. Equals amountDue when there is no minimum. */
  minimumDue: Money;
  /** ISO date YYYY-MM-DD. */
  dueDate: string;
  /** Last date before penalty applies. Null when there is no grace period. */
  graceDate: string | null;
  frequency: ObligationFrequency;
  priority: ObligationPriority;
  /** Cost incurred if missed (late fee). */
  penalty: Money;
  /** Interest charged on the balance, in basis points per annum (integer, no floats). */
  interestBps: number;
  autopay: boolean;
  verificationSource: VerificationSource;
  /** 0..1 confidence that amount and date are correct (matches importInfo convention). */
  confidence: number;
  /**
   * Explicit reserve override. When zero, the engine derives the reserve from the
   * priority tier. Never negative.
   */
  protectedReserve: Money;
}

/**
 * The amount safe-to-spend must hold back for one obligation.
 *
 * Contract 01 section 5.2: P0 is "fully reserved; no discretionary override", so the
 * whole amount is held. P1 is "rare override", so the contractual minimum is held.
 * P2 is reallocatable through scenario analysis and P3 is discretionary, so neither
 * is protected — they compete for what is left, which is the point of the tiers.
 *
 * An explicit protectedReserve always wins when it is larger, so the owner can
 * over-reserve deliberately but can never silently under-reserve a P0.
 */
export function reserveFor(o: Obligation): Money {
  const byTier: Money =
    o.priority === 'P0' ? o.amountDue : o.priority === 'P1' ? o.minimumDue : 0;
  return Math.max(byTier, o.protectedReserve, 0);
}

/** True when the tier is protected inside safe-to-spend (P0 and P1 only). */
export function isProtectedTier(priority: ObligationPriority): boolean {
  return priority === 'P0' || priority === 'P1';
}

/**
 * Funding sequence, contract 03 section 3 ("recommend funding sequence").
 * Most harmful first: tier, then soonest due, then largest penalty, then id so the
 * order is total and stable across runs.
 */
export function fundingSequence(obligations: readonly Obligation[]): Obligation[] {
  return [...obligations].sort((a, b) => {
    const tier = OBLIGATION_PRIORITIES.indexOf(a.priority) - OBLIGATION_PRIORITIES.indexOf(b.priority);
    if (tier !== 0) return tier;
    const due = a.dueDate.localeCompare(b.dueDate);
    if (due !== 0) return due;
    if (a.penalty !== b.penalty) return b.penalty - a.penalty;
    return a.id.localeCompare(b.id);
  });
}
