/**
 * NIZAM · Correction and allocation-history read model
 * Implemented by: Contract 6 (multicurrency ledger integrity) / Phase 6.4
 * Depends on: features/transactions/transaction.types.ts, lib/money/money.ts
 *
 * Pure functions over a transaction list. No store, no clock, no I/O.
 *
 * Owner decision D4-A (2026-09-02) chose **reversal + replacement** as the single workflow
 * for changing reconciled history (C6 I4.5, vNext S2). The consequence this module exists to
 * serve is that a corrected transaction is NOT edited: the ledger ends up holding the
 * untouched original plus two appended rows. Every question a reader might ask about that
 * shape ("is this row still current?", "what actually happened here?") is therefore a
 * DERIVED question, answered here, rather than a stored flag that could drift out of step
 * with the rows it describes. That follows owner decisions D2 and D3, which chose derivation
 * over caching for the same reason.
 */
import type {
  SupersededAllocationSet,
  Transaction,
  TransactionSplit,
} from '@/features/transactions/transaction.types';
import { allocationVersionOf, supersededAllocationsOf } from '@/features/transactions/transaction.types';
import { assertMoney, type Money } from '@/lib/money/money';

/** Every appended row that corrects `transactionId`, in ledger order. */
export function correctionRowsFor(
  txns: readonly Transaction[],
  transactionId: string,
): Transaction[] {
  return txns.filter((t) => t.correction?.correctsTransactionId === transactionId);
}

/**
 * True when a reversal has been appended for this transaction (C6 I4.5).
 *
 * Derived, not stored. A stored `lifecycle: 'reversed'` flag would be a second source of
 * truth that a partial write could leave disagreeing with the reversal row itself, and vNext
 * A3 calls partial application a defect — so the flag is not stored at all.
 */
export function isReversed(txns: readonly Transaction[], transactionId: string): boolean {
  return correctionRowsFor(txns, transactionId).some((t) => t.correction?.role === 'reversal');
}

/**
 * Every row emitted by one correction, in ledger order.
 *
 * A transfer correction covers both legs (C6 I4.6, vNext T5), so this can return four rows.
 * Callers that reverse, report or display a correction MUST operate on this whole group;
 * handling one row alone is the defect T4/T5 exist to forbid.
 */
export function correctionGroup(
  txns: readonly Transaction[],
  correctionGroupId: string,
): Transaction[] {
  return txns.filter((t) => t.correction?.correctionGroupId === correctionGroupId);
}

/**
 * Net amount actually in effect for a transaction: the original plus every row appended to
 * correct it.
 *
 * For an uncorrected row this is just `amount`. For a corrected row it is
 * `original + (-original) + replacement`, which reduces to the replacement's amount. This is
 * the arithmetic reason reversal + replacement needs no engine change: because the reversal
 * and the replacement are ordinary rows in `transactions[]`, every existing engine that sums
 * amounts already reports the corrected figure. Nothing had to learn about corrections.
 */
export function netAmountOf(txns: readonly Transaction[], transactionId: string): Money {
  const original = txns.find((t) => t.id === transactionId);
  if (!original) throw new Error(`NIZAM: no transaction ${transactionId}`);
  let net = assertMoney(original.amount);
  for (const row of correctionRowsFor(txns, transactionId)) {
    net += assertMoney(row.amount);
  }
  return net;
}

/** One entry in a transaction's allocation history, live or superseded. */
export interface AllocationHistoryEntry {
  version: number;
  legs: readonly TransactionSplit[];
  /** `null` for the live set; an ISO datetime for a superseded one. */
  supersededAt: string | null;
  live: boolean;
}

/**
 * Full allocation history of one transaction, oldest version first, live set last
 * (C6 I4.4 — superseded sets are retrievable, never destroyed).
 *
 * Returns an empty array for a transaction that has no splits and never had any: an
 * unsplit transaction has no allocation set, which is different from having an empty one.
 */
export function allocationHistoryOf(txn: Transaction): AllocationHistoryEntry[] {
  const superseded: readonly SupersededAllocationSet[] = supersededAllocationsOf(txn);
  const entries: AllocationHistoryEntry[] = superseded
    .map((set) => ({
      version: set.version,
      legs: set.legs,
      supersededAt: set.supersededAt,
      live: false,
    }))
    .sort((a, b) => a.version - b.version);
  if (txn.splits) {
    entries.push({
      version: allocationVersionOf(txn),
      legs: txn.splits,
      supersededAt: null,
      live: true,
    });
  }
  return entries;
}

/**
 * Enforce vNext A1 / C6 I4.2: allocation legs sum EXACTLY to the parent amount.
 *
 * Exact, not "within a milliunit". A tolerance here is how a rounding residue becomes real
 * money that exists in no category, so an off-by-one must throw as loudly as an off-by-a-
 * thousand. `allocate()` in lib/money remains the constructor for DERIVED legs; this is the
 * validator for legs the owner supplied.
 */
export function assertAllocationLegsSumExactly(
  parentAmount: Money,
  legs: readonly Pick<TransactionSplit, 'amount'>[],
): void {
  assertMoney(parentAmount);
  let total = 0;
  for (const leg of legs) total += assertMoney(leg.amount);
  if (total !== parentAmount) {
    throw new Error(
      `NIZAM: allocation legs must sum exactly to the transaction amount (legs=${total}, parent=${parentAmount}, off by ${total - parentAmount} milliunits)`,
    );
  }
}
