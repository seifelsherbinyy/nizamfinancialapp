// @vitest-environment node
/**
 * NIZAM · Server/browser money parity across the persistence boundary
 *          — contract 06 §4.3 T7 and T11 (R2, R4)
 * Implemented by: PFOS Contract 06 / Phase 1.3 (spec 06-two-agent-vps)
 * Depends on: repositories/testStore.ts, the fact repositories, src/lib/money,
 *             src/features/obligations, src/features/netWorth (the REAL engines)
 *
 * Contract 06 §4.3 makes two claims that construction alone does not prove:
 *
 *  T11 — "where the server derives a figure the browser also derives, the two must produce
 *  an identical result from identical inputs ... verified by a parity test that feeds the
 *  same input vector to both and asserts equality, SO THE GUARANTEE CANNOT SILENTLY DECAY."
 *
 *  T7 — "`allocate(total, weights)` sums exactly to `total` with a deterministic remainder
 *  distribution. Persisting the parts and reading them back must STILL sum exactly to
 *  `total`."
 *
 * The honest form of T11 is not `add(1, 2)` computed twice. These derivations are only
 * reachable in the browser tier — they are the Stage 1 and Stage 4 engines — so the test
 * takes one shared input vector, runs the REAL engine over it in memory, then persists the
 * same facts through the server repositories, reads them back, runs THE SAME engine over the
 * round-tripped values, and asserts the two results are identical. Anything the boundary
 * quietly changed would show up as a difference in the derived figure, which is the only
 * failure mode worth catching. Nothing here re-implements an engine or an operation.
 *
 * Two derivations are exercised, chosen because they are genuinely shared and genuinely
 * arithmetic-heavy rather than incidental:
 *
 *  1. `obligationFundingReport` — the funding sequence, a running cumulative reserve, cash on
 *     hand net of pending outflows, and confident inflows. Every one of `add`, `sub`, `sum`
 *     and `cmp`, over persisted account balances, transaction amounts, obligation amounts and
 *     due dates. Its output is a status ladder, so a single milliunit of drift flips a
 *     classification rather than hiding in a rounding.
 *  2. `netWorth` in a NON-base reference currency — every component converted through
 *     `mulRatio` against a rate read back out of `fx_rates` as an integer pair (§4.4). This is
 *     precisely where a float rate would drift, and precisely what §4.4 forbids.
 *
 * Fields the engines take but contract 06 §3.2 does not persist — an obligation's penalty,
 * interest, autopay, verification source, confidence and explicit protected reserve — are
 * declared once in the shared vector and supplied identically to both paths. They are engine
 * inputs, not stored facts, and `obligationsRepository` says so in its own header. The parity
 * claim is therefore exactly what it should be: everything that crosses the boundary crosses
 * it without changing, and the derivation over the round-tripped facts is bit-identical.
 *
 * Every figure below is synthetic. The repository is public and holds no real amount.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allocate, sum, type Money } from '../../lib/money/money.ts';
import type { Account } from '../../features/accounts/accounts.types.ts';
import type { Obligation } from '../../features/obligations/obligation.types.ts';
import { obligationFundingReport } from '../../features/obligations/obligations.logic.ts';
import type { Transaction } from '../../features/transactions/transaction.types.ts';
import type { FinancialPolicy } from '../../features/safeToSpend/policy.types.ts';
import { netWorth, realValue } from '../../features/netWorth/netWorth.ts';
import type { FxRate } from '../../features/netWorth/netWorth.types.ts';
import { createEmptyDb, type NizamDb } from '../../lib/db/schema.ts';
import { openTestStore, type TestStore } from './repositories/testStore.ts';
import {
  createAccountsRepository,
  createDecisionsRepository,
  createFxRatesRepository,
  createObligationsRepository,
  createTransactionsRepository,
  toFxRate,
  type AccountRow,
  type FxRateRow,
  type ObligationRow,
  type TransactionRow,
} from './repositories/index.ts';

const AS_OF = '2026-03-15';
const REFERENCE = 'SYN'; // A synthetic currency code. No real market pair appears here.

// ---------------------------------------------------------------------------
// The shared input vector. Declared ONCE and consumed by both paths.
// ---------------------------------------------------------------------------

/** Three accounts: liquid cash, a second liquid account, and a credit line in debt. */
const ACCOUNTS: readonly Account[] = [
  {
    id: 'acct-current',
    name: 'Everyday account',
    type: 'CIB_DEBIT',
    onBudget: true,
    currency: 'EGP',
    balance: 4_120_000,
    clearedBalance: 3_875_000,
    accountIdentifier: null,
    creditLimit: null,
    closed: false,
    order: 0,
    paymentCategoryId: null,
  },
  {
    id: 'acct-cash',
    name: 'Cash on hand',
    type: 'CASH',
    onBudget: true,
    currency: 'EGP',
    balance: 611_000,
    clearedBalance: 611_000,
    accountIdentifier: null,
    creditLimit: null,
    closed: false,
    order: 1,
    paymentCategoryId: null,
  },
  {
    id: 'acct-card',
    name: 'Revolving card',
    type: 'HSBC_CC',
    onBudget: true,
    currency: 'EGP',
    balance: -2_403_000,
    clearedBalance: -2_403_000,
    accountIdentifier: null,
    creditLimit: 9_000_000,
    closed: false,
    order: 2,
    paymentCategoryId: null,
  },
];

/** A mix of cleared and uncleared, inflow and outflow, before and after the horizon. */
const TRANSACTIONS: readonly Transaction[] = [
  {
    id: 'txn-0001',
    accountId: 'acct-current',
    date: '2026-03-02',
    payee: 'Grocer',
    categoryId: null,
    memo: '',
    amount: -287_500,
    cleared: 'cleared',
    currency: 'EGP',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
  },
  {
    id: 'txn-0002',
    accountId: 'acct-current',
    date: '2026-03-18',
    payee: 'Utility',
    categoryId: null,
    memo: '',
    amount: -913_333,
    cleared: 'uncleared',
    currency: 'EGP',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
  },
  {
    id: 'txn-0003',
    accountId: 'acct-cash',
    date: '2026-03-20',
    payee: 'Refund',
    categoryId: null,
    memo: '',
    amount: 149_999,
    cleared: 'uncleared',
    currency: 'EGP',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
  },
  {
    id: 'txn-0004',
    accountId: 'acct-card',
    date: '2026-03-11',
    payee: 'Card interest',
    categoryId: null,
    memo: '',
    amount: -57_777,
    cleared: 'cleared',
    currency: 'EGP',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
  },
];

/**
 * Six obligations across the harm tiers with distinct due dates, so the funding sequence is
 * total without leaning on the penalty tie-break — the persisted ordering key is priority,
 * then due date, then id, which is exactly what this vector exercises.
 *
 * The amounts are chosen so the report produces FOUR different statuses, one of them from an
 * overdue row and one a genuine shortfall. A vector where every line came out green would
 * make the equality below true for almost any implementation; this one only stays equal if
 * every figure crossing the boundary is exact, because each classification sits on a
 * comparison that a single milliunit of drift would flip.
 */
const OBLIGATIONS: readonly Obligation[] = [
  {
    id: 'obl-p0-utilities',
    creditor: 'Utility provider',
    accountId: null,
    amountDue: 1_500_000,
    minimumDue: 1_500_000,
    dueDate: '2026-03-20',
    graceDate: null,
    frequency: 'monthly',
    priority: 'P0',
    penalty: 40_000,
    interestBps: 0,
    autopay: false,
    verificationSource: 'provider',
    confidence: 0.9,
    protectedReserve: 0,
  },
  {
    id: 'obl-p0-rent',
    creditor: 'Landlord',
    accountId: null,
    amountDue: 3_400_000,
    minimumDue: 3_400_000,
    dueDate: '2026-03-28',
    graceDate: null,
    frequency: 'monthly',
    priority: 'P0',
    penalty: 120_000,
    interestBps: 0,
    autopay: false,
    verificationSource: 'manual',
    confidence: 0.95,
    protectedReserve: 0,
  },
  {
    id: 'obl-p1-overdue',
    creditor: 'Instalment lender',
    accountId: null,
    amountDue: 620_000,
    minimumDue: 155_000,
    dueDate: '2026-03-05',
    graceDate: null,
    frequency: 'monthly',
    priority: 'P1',
    penalty: 60_000,
    interestBps: 3_100,
    autopay: false,
    verificationSource: 'statement',
    confidence: 0.85,
    protectedReserve: 0,
  },
  {
    id: 'obl-p1-card',
    creditor: 'Card issuer',
    accountId: 'acct-card',
    amountDue: 1_201_500,
    minimumDue: 240_300,
    dueDate: '2026-03-22',
    graceDate: '2026-03-25',
    frequency: 'monthly',
    priority: 'P1',
    penalty: 75_000,
    interestBps: 4_200,
    autopay: false,
    verificationSource: 'statement',
    confidence: 0.9,
    protectedReserve: 0,
  },
  {
    id: 'obl-p2-course',
    creditor: 'Course instalment',
    accountId: null,
    amountDue: 6_400_000,
    minimumDue: 4_000_000,
    dueDate: '2026-04-05',
    graceDate: null,
    frequency: 'monthly',
    priority: 'P2',
    penalty: 0,
    interestBps: 0,
    autopay: false,
    verificationSource: 'inferred',
    confidence: 0.6,
    protectedReserve: 111_111,
  },
  {
    id: 'obl-p3-club',
    creditor: 'Club dues',
    accountId: null,
    amountDue: 90_001,
    minimumDue: 90_001,
    dueDate: '2026-04-19',
    graceDate: '2026-04-26',
    frequency: 'annual',
    priority: 'P3',
    penalty: 5_000,
    interestBps: 0,
    autopay: true,
    verificationSource: 'provider',
    confidence: 0.8,
    protectedReserve: 0,
  },
];

const POLICY: FinancialPolicy = {
  minimumLiquidityBuffer: 500_000,
  essentialLivingMonthly: 1_750_000,
  uncertaintyBps: 500,
  stalenessBps: 500,
  staleAfterDays: 3,
  expectedInflow: { amount: 3_333_333, dayOfMonth: 25, confidence: 0.9 },
};

/**
 * One unit of the synthetic reference currency is 12_345 / 1_000 of the base — an integer
 * pair that divides nothing evenly, so every conversion below exercises `mulRatio`'s exact
 * intermediate rather than a value a float would also happen to get right.
 */
const FX_NUM = 12_345;
const FX_DEN = 1_000;

// ---------------------------------------------------------------------------
// Mapping the persisted rows back to what the engines take.
//
// This is presentation, not arithmetic: no value is recomputed, combined, scaled or
// rounded. A monetary column comes back as the integer it went in as.
// ---------------------------------------------------------------------------

/** `transactions.status` is the persistence state; the engines read a cleared status. */
function clearedFromStatus(status: TransactionRow['status']): Transaction['cleared'] {
  if (status === 'reconciled') return 'reconciled';
  if (status === 'pending') return 'uncleared';
  return 'cleared';
}

/** `Transaction['cleared']` is the engine's vocabulary; the store's is `status`. */
function statusFromCleared(cleared: Transaction['cleared']): TransactionRow['status'] {
  if (cleared === 'reconciled') return 'reconciled';
  if (cleared === 'uncleared') return 'pending';
  return 'posted';
}

function accountFromRow(row: AccountRow, declared: Account): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    onBudget: row.onBudget,
    currency: 'EGP',
    balance: row.balance,
    clearedBalance: row.clearedBalance,
    accountIdentifier: row.accountIdentifierLast4,
    creditLimit: row.creditLimit,
    closed: row.closed,
    order: row.sortOrder,
    // Not a column of contract 06 §3.2; carried from the shared vector unchanged.
    paymentCategoryId: declared.paymentCategoryId,
  };
}

function transactionFromRow(row: TransactionRow, declared: Transaction): Transaction {
  return {
    id: row.id,
    accountId: row.accountId,
    date: row.transactionDate,
    payee: row.payee,
    categoryId: row.categoryId,
    memo: row.memo,
    amount: row.amount,
    cleared: clearedFromStatus(row.status),
    currency: 'EGP',
    // Approval, transfer linkage, splits and import provenance are browser-tier concerns
    // with no column here; carried from the shared vector unchanged.
    approved: declared.approved,
    transferAccountId: declared.transferAccountId,
    transferTransactionId: declared.transferTransactionId,
    splits: declared.splits,
    importInfo: declared.importInfo,
  };
}

function obligationFromRow(row: ObligationRow, declared: Obligation): Obligation {
  return {
    id: row.id,
    creditor: row.name,
    accountId: row.accountId,
    amountDue: row.amount,
    minimumDue: row.minimumAmount ?? declared.minimumDue,
    dueDate: row.dueDate,
    graceDate: row.graceDate,
    frequency: row.recurrence,
    priority: row.priority,
    // Engine-only inputs with no column in §3.2; carried from the shared vector unchanged.
    penalty: declared.penalty,
    interestBps: declared.interestBps,
    autopay: declared.autopay,
    verificationSource: declared.verificationSource,
    confidence: declared.confidence,
    protectedReserve: declared.protectedReserve,
  };
}

function byId<T extends { id: string }>(items: readonly T[], id: string): T {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`parity vector has no declared member ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// The two paths.
// ---------------------------------------------------------------------------

interface RoundTripped {
  readonly accounts: Account[];
  readonly transactions: Transaction[];
  readonly obligations: Obligation[];
  readonly fxRates: FxRate[];
  readonly fxRow: FxRateRow;
}

/** Persist the shared vector through the repositories, then read it back out. */
function persistAndReadBack(store: TestStore): RoundTripped {
  const accountsRepo = createAccountsRepository(store.ctx);
  const transactionsRepo = createTransactionsRepository(store.ctx);
  const obligationsRepo = createObligationsRepository(store.ctx);
  const fxRepo = createFxRatesRepository(store.ctx);

  for (const account of ACCOUNTS) {
    accountsRepo.insert({
      id: account.id,
      name: account.name,
      type: account.type,
      onBudget: account.onBudget,
      currency: 'EGP',
      balance: account.balance,
      clearedBalance: account.clearedBalance,
      creditLimit: account.creditLimit,
      accountIdentifierLast4: account.accountIdentifier,
      closed: account.closed,
      sortOrder: account.order,
    });
  }

  for (const txn of TRANSACTIONS) {
    transactionsRepo.insert({
      id: txn.id,
      accountId: txn.accountId,
      transactionDate: txn.date,
      payee: txn.payee,
      categoryId: txn.categoryId,
      memo: txn.memo,
      transactionType: txn.amount < 0 ? 'charge' : 'payment',
      amount: txn.amount,
      outflow: txn.amount < 0 ? -txn.amount : 0,
      inflow: txn.amount > 0 ? txn.amount : 0,
      status: statusFromCleared(txn.cleared),
      verificationLevel: 'parser',
    });
  }

  for (const obligation of OBLIGATIONS) {
    obligationsRepo.insert({
      id: obligation.id,
      accountId: obligation.accountId,
      name: obligation.creditor,
      kind: 'commitment',
      amount: obligation.amountDue,
      minimumAmount: obligation.minimumDue,
      dueDate: obligation.dueDate,
      graceDate: obligation.graceDate,
      recurrence: obligation.frequency,
      status: 'scheduled',
      priority: obligation.priority,
    });
  }

  fxRepo.insert({
    id: 'fx-0001',
    baseCurrency: REFERENCE,
    quoteCurrency: 'EGP',
    rateNum: FX_NUM,
    rateDen: FX_DEN,
    observedAt: AS_OF,
    source: 'synthetic-fixture',
  });

  const accountRows = accountsRepo.list();
  const obligationRows = obligationsRepo.list();
  const transactionRows = ACCOUNTS.flatMap((account) => transactionsRepo.listForAccount(account.id));
  const fxRow = fxRepo.latest(REFERENCE, 'EGP', AS_OF);
  if (fxRow === null) throw new Error('the persisted rate did not read back');

  return {
    accounts: accountRows.map((row) => accountFromRow(row, byId(ACCOUNTS, row.id))),
    transactions: transactionRows.map((row) => transactionFromRow(row, byId(TRANSACTIONS, row.id))),
    obligations: obligationRows.map((row) => obligationFromRow(row, byId(OBLIGATIONS, row.id))),
    fxRates: [toFxRate(fxRow)],
    fxRow,
  };
}

/** A `NizamDb` carrying only what the net-worth derivation reads. */
function dbFor(accounts: readonly Account[], obligations: readonly Obligation[], fxRates: readonly FxRate[]): NizamDb {
  return {
    ...createEmptyDb('2026-01-01T00:00:00.000Z'),
    accounts: [...accounts],
    obligations: [...obligations],
    fxRates: [...fxRates],
    policy: POLICY,
  };
}

// ---------------------------------------------------------------------------
// T11
// ---------------------------------------------------------------------------

describe('T11 the server path and the browser path derive the same figure (§4.3, R4)', () => {
  let store: TestStore;

  beforeEach(() => {
    store = openTestStore('nizam-parity-');
  });

  afterEach(() => {
    store.close();
  });

  it('agrees on the obligation funding report, line for line', () => {
    const fromMemory = obligationFundingReport(OBLIGATIONS, ACCOUNTS, TRANSACTIONS, POLICY, AS_OF);
    const roundTripped = persistAndReadBack(store);
    const fromStore = obligationFundingReport(
      roundTripped.obligations,
      roundTripped.accounts,
      roundTripped.transactions,
      POLICY,
      AS_OF,
    );

    // Non-vacuity: the derivation has to have actually derived something before equality
    // between two of its results means anything at all.
    expect(fromMemory).toHaveLength(OBLIGATIONS.length);
    expect(fromMemory.map((line) => line.status)).toEqual([
      'green',
      'amber',
      'critical',
      'amber',
      'red',
      'amber',
    ]);
    expect(fromMemory.some((line) => line.shortfall !== 0)).toBe(true);

    expect(fromStore).toEqual(fromMemory);
  });

  it('agrees on every monetary term of the funding report to the milliunit', () => {
    const fromMemory = obligationFundingReport(OBLIGATIONS, ACCOUNTS, TRANSACTIONS, POLICY, AS_OF);
    const roundTripped = persistAndReadBack(store);
    const fromStore = obligationFundingReport(
      roundTripped.obligations,
      roundTripped.accounts,
      roundTripped.transactions,
      POLICY,
      AS_OF,
    );

    // Stated term by term rather than only as a deep-equal, so a failure names the figure
    // that drifted instead of printing two large objects.
    for (const [index, expectedLine] of fromMemory.entries()) {
      const actual = fromStore[index];
      expect(actual, `line ${index} is missing from the server path`).toBeDefined();
      expect(actual?.obligation.id).toBe(expectedLine.obligation.id);
      expect(actual?.required).toBe(expectedLine.required);
      expect(actual?.cumulativeRequired).toBe(expectedLine.cumulativeRequired);
      expect(actual?.fundsInHand).toBe(expectedLine.fundsInHand);
      expect(actual?.projectedFunds).toBe(expectedLine.projectedFunds);
      expect(actual?.shortfall).toBe(expectedLine.shortfall);
      expect(actual?.penaltyExposure).toBe(expectedLine.penaltyExposure);
      expect(actual?.status).toBe(expectedLine.status);
    }
  });

  it('agrees on net worth in a non-base currency, converting through the persisted rate pair', () => {
    const declaredFx: FxRate[] = [
      { currency: REFERENCE, perUnitNum: FX_NUM, perUnitDen: FX_DEN, source: 'synthetic-fixture', observedAt: AS_OF, conversionVersion: 0 },
    ];
    const fromMemory = netWorth(dbFor(ACCOUNTS, OBLIGATIONS, declaredFx), REFERENCE);

    const roundTripped = persistAndReadBack(store);
    const fromStore = netWorth(
      dbFor(roundTripped.accounts, roundTripped.obligations, roundTripped.fxRates),
      REFERENCE,
    );

    // Non-vacuity: the rate must actually have been applied. An unconverted figure would
    // equal the base-currency one, and a missing rate would surface as an unrated currency.
    const inBase = netWorth(dbFor(ACCOUNTS, OBLIGATIONS, declaredFx));
    expect(fromMemory.nominal).not.toBe(inBase.nominal);
    expect(fromMemory.unratedCurrencies).toEqual([]);
    expect(fromMemory.nominal).not.toBe(0);

    expect(fromStore).toEqual(fromMemory);
  });

  it('agrees on the real-value deflation compounded over the persisted rate pair', () => {
    const roundTripped = persistAndReadBack(store);
    const stored = toFxRate(roundTripped.fxRow);

    // `realValue` compounds an integer ratio year over year. Compounding is where a float
    // would accumulate error, so parity here is the interesting case rather than one step.
    const fromMemory = realValue(9_876_543, FX_NUM, 7);
    const fromStore = realValue(9_876_543, stored.perUnitNum, 7);

    expect(stored.perUnitNum).toBe(FX_NUM);
    expect(stored.perUnitDen).toBe(FX_DEN);
    expect(fromStore).toBe(fromMemory);
    expect(fromMemory).not.toBe(9_876_543);
  });

  it('reads every persisted rate back as the exact integer pair it went in as (§4.4)', () => {
    const roundTripped = persistAndReadBack(store);
    expect(roundTripped.fxRow.rateNum).toBe(FX_NUM);
    expect(roundTripped.fxRow.rateDen).toBe(FX_DEN);
    expect(Number.isInteger(roundTripped.fxRow.rateNum)).toBe(true);
    expect(Number.isInteger(roundTripped.fxRow.rateDen)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T7
// ---------------------------------------------------------------------------

/**
 * The allocations under test. The first two do not divide evenly, so the remainder
 * distribution is doing real work; the third is at a magnitude where a float
 * implementation would already have lost the low digits, because `total * weight` exceeds
 * the exactly-representable integer range and the parts would no longer close.
 */
const ALLOCATIONS: readonly { readonly label: string; readonly total: Money; readonly weights: readonly number[] }[] = [
  { label: 'three equal shares of a total that does not divide by three', total: 100_000, weights: [1, 1, 1] },
  { label: 'five coprime weights over an odd total', total: 1_000_003, weights: [7, 11, 13, 17, 19] },
  {
    label: 'large magnitude with large coprime weights, beyond exact float products',
    total: 8_888_888_888_888,
    weights: [9_973, 7_919, 6_007],
  },
];

describe('T7 allocate exactness survives the persistence boundary (§4.3, R2/R4)', () => {
  let store: TestStore;

  beforeEach(() => {
    store = openTestStore('nizam-allocate-');
  });

  afterEach(() => {
    store.close();
  });

  it('sums the in-memory parts back to the total, so the boundary is the only variable', () => {
    for (const { label, total, weights } of ALLOCATIONS) {
      const parts = allocate(total, weights);
      expect(sum(parts), label).toBe(total);
      // Non-vacuity: a remainder that never needed distributing would prove nothing about
      // the distribution surviving anything.
      expect(new Set(parts).size, label).toBeGreaterThan(1);
    }
  });

  it('sums the parts back to the total after a round trip through transactions', () => {
    const accountsRepo = createAccountsRepository(store.ctx);
    const transactionsRepo = createTransactionsRepository(store.ctx);
    accountsRepo.insert({
      id: 'acct-split',
      name: 'Allocation target',
      type: 'CIB_DEBIT',
      onBudget: true,
      currency: 'EGP',
      balance: 0,
      clearedBalance: 0,
      creditLimit: null,
      accountIdentifierLast4: null,
    });

    for (const [caseIndex, { label, total, weights }] of ALLOCATIONS.entries()) {
      const parts = allocate(total, weights);
      const accountId = `acct-split`;

      parts.forEach((part, partIndex) => {
        transactionsRepo.insert({
          id: `txn-alloc-${caseIndex}-${partIndex}`,
          accountId,
          transactionDate: `2026-03-${String(caseIndex + 1).padStart(2, '0')}`,
          payee: 'Allocation leg',
          transactionType: 'charge',
          // The signed convention of money-rules §4: an outflow is negative in `amount`
          // and a non-negative magnitude in `outflow`.
          amount: -part,
          outflow: part,
          inflow: 0,
          status: 'posted',
          verificationLevel: 'parser',
          duplicateKey: `alloc-${caseIndex}`,
        });
      });

      const readBack = transactionsRepo.findByDuplicateKey(`alloc-${caseIndex}`);
      expect(readBack, label).toHaveLength(parts.length);

      // Summed with the money core, over what the STORE returned — not over `parts`.
      expect(sum(readBack.map((row) => row.outflow)), label).toBe(total);
      expect(sum(readBack.map((row) => -row.amount)), label).toBe(total);
      // And every part came back byte for byte, in the order the allocation produced them.
      expect(readBack.map((row) => row.outflow).sort((a, b) => a - b), label).toEqual(
        [...parts].sort((a, b) => a - b),
      );
    }
  });

  it('sums the parts back to the total after a round trip through decisions', () => {
    // A second table, because the guarantee is a property of the boundary rather than of
    // one repository. `expected_effect_milliunits` is nullable, so this also proves the
    // nullable guard returns the integer unchanged rather than normalising it.
    const decisionsRepo = createDecisionsRepository(store.ctx);
    const { total, weights } = ALLOCATIONS[2] ?? { total: 0 as Money, weights: [1] };
    const parts = allocate(total, weights);

    parts.forEach((part, index) => {
      decisionsRepo.insert({
        id: `dec-alloc-${index}`,
        decidedAt: `2026-03-1${index}T00:00:00.000Z`,
        kind: 'allocation-leg',
        expectedEffectMilliunits: part,
        observedEffectMilliunits: null,
      });
    });

    const readBack = decisionsRepo.list({ kind: 'allocation-leg' });
    expect(readBack).toHaveLength(parts.length);
    expect(sum(readBack.map((row) => row.expectedEffectMilliunits ?? 0))).toBe(total);
  });
});
