/**
 * NIZAM · Domain action tests — allocation supersession, transfer unit mutation, corrections
 * Implemented by: Contract 6 (multicurrency ledger integrity) / Phase 6.4
 * Depends on: state/actions.ts, features/transactions/corrections.ts, lib/db/schema.ts
 *
 * Covers the Step 4 gate of Contract 6 Phase 6.4: legs sum exactly to the parent, superseded
 * sets stay retrievable, a reconciled row is never mutated in place, and a transfer's peer is
 * never left stale. Owner decision D4-A (reversal + replacement) ratified 2026-09-02.
 */
import { describe, it, expect } from 'vitest';
import { createEmptyDb, validateDb, type NizamDb } from '@/lib/db/schema';
import {
  addAccount,
  addTransaction,
  addTransfer,
  correctReconciledTransaction,
  deleteTransaction,
  lockReconciled,
  setCleared,
  updateTransaction,
} from './actions.ts';
import {
  allocationHistoryOf,
  assertAllocationLegsSumExactly,
  correctionGroup,
  correctionRowsFor,
  isReversed,
  netAmountOf,
} from '@/features/transactions/corrections';
import { allocationVersionOf, supersededAllocationsOf } from '@/features/transactions/transaction.types';
import { activityFor, accountBalance, accountClearedBalance } from '@/lib/ledger/ledgerStore';
import type { Transaction } from '@/features/transactions/transaction.types';

const AT = '2026-09-02T10:15:00.000Z';
const AT2 = '2026-09-02T11:30:00.000Z';

/** A two-account, two-category store with no transactions. */
function freshDb(): NizamDb {
  const db = createEmptyDb('2026-09-01T00:00:00.000Z');
  db.categoryGroups.push({ id: 'grp_1', name: 'Living', order: 0, hidden: false });
  const category = (id: string, name: string, order: number) => ({
    id,
    groupId: 'grp_1',
    name,
    order,
    hidden: false,
    target: null,
    isCreditCardPayment: false,
    linkedAccountId: null,
  });
  db.categories.push(category('cat_food', 'Food', 0), category('cat_fuel', 'Fuel', 1));
  addAccount(db, { name: 'Current', type: 'BANK_OTHER', onBudget: true, startingBalance: 0 });
  addAccount(db, { name: 'Cash', type: 'CASH', onBudget: true, startingBalance: 0 });
  return db;
}

function accountIds(db: NizamDb): [string, string] {
  const [a, b] = db.accounts;
  if (!a || !b) throw new Error('fixture needs two accounts');
  return [a.id, b.id];
}

/**
 * A fresh object identity for the same data.
 *
 * `ledgerStore.getIndex` memoizes on the db object, on the documented assumption that the
 * store replaces `db` immutably on every mutation. These tests mutate a draft in place, so a
 * selector called BEFORE a mutation would otherwise keep serving its cached index afterwards.
 * Reading through a clone reproduces what the store actually does in production.
 */
function reindexed(db: NizamDb): NizamDb {
  return JSON.parse(JSON.stringify(db)) as NizamDb;
}

function byId(db: NizamDb, id: string): Transaction {
  const t = db.transactions.find((x) => x.id === id);
  if (!t) throw new Error(`no transaction ${id}`);
  return t;
}

// ---------------------------------------------------------------------------
// C6 I4.2 / vNext A1 — legs sum EXACTLY to the parent
// ---------------------------------------------------------------------------

describe('allocation legs sum exactly to the parent (C6 I4.2)', () => {
  it('accepts legs that sum exactly', () => {
    expect(() =>
      assertAllocationLegsSumExactly(-10_000, [{ amount: -6_000 }, { amount: -4_000 }]),
    ).not.toThrow();
  });

  it('rejects legs off by a SINGLE milliunit in either direction', () => {
    // One milliunit is 1/1000 EGP. A tolerance here is how a rounding residue becomes money
    // that exists in no category, so an off-by-one must throw as loudly as an off-by-a-lot.
    expect(() =>
      assertAllocationLegsSumExactly(-10_000, [{ amount: -6_000 }, { amount: -3_999 }]),
    ).toThrow(/exactly/);
    expect(() =>
      assertAllocationLegsSumExactly(-10_000, [{ amount: -6_000 }, { amount: -4_001 }]),
    ).toThrow(/exactly/);
  });

  it('reports how far off it was, so the message is actionable', () => {
    expect(() =>
      assertAllocationLegsSumExactly(-10_000, [{ amount: -6_000 }, { amount: -3_999 }]),
    ).toThrow(/off by 1 milliunits/);
  });

  it('rejects a fractional leg — money is integer milliunits', () => {
    expect(() => assertAllocationLegsSumExactly(-10_000, [{ amount: -10_000.5 }])).toThrow();
  });

  it('holds for randomised exact partitions and fails for every perturbation of them', () => {
    // Property test over 200 random partitions rather than one hand-picked case.
    let seed = 20260902;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 200; i += 1) {
      const total = -(rand(9_000_000) + 1);
      const legCount = 2 + rand(4);
      const legs: { amount: number }[] = [];
      let remaining = total;
      for (let l = 0; l < legCount - 1; l += 1) {
        const take = -rand(Math.max(1, Math.abs(remaining) - (legCount - l - 1)));
        legs.push({ amount: take });
        remaining -= take;
      }
      legs.push({ amount: remaining });
      expect(() => assertAllocationLegsSumExactly(total, legs)).not.toThrow();
      const perturbed = legs.map((leg, idx) => (idx === 0 ? { amount: leg.amount - 1 } : leg));
      expect(() => assertAllocationLegsSumExactly(total, perturbed)).toThrow(/exactly/);
    }
  });

  it('addTransaction and updateTransaction both refuse legs that do not sum exactly', () => {
    const db = freshDb();
    const [acc] = accountIds(db);
    expect(() =>
      addTransaction(db, {
        accountId: acc,
        date: '2026-09-01',
        payee: 'Shop',
        categoryId: null,
        amount: -10_000,
        splits: [{ categoryId: 'cat_food', amount: -6_000, memo: '' }],
      }),
    ).toThrow(/sum exactly/);
    const t = addTransaction(db, {
      accountId: acc,
      date: '2026-09-01',
      payee: 'Shop',
      categoryId: 'cat_food',
      amount: -10_000,
    });
    expect(() =>
      updateTransaction(db, t.id, {
        splits: [{ id: 'spl_x', categoryId: 'cat_food', amount: -9_999, memo: '' }],
      }),
    ).toThrow(/exactly/);
  });
});

// ---------------------------------------------------------------------------
// C6 I4.3 / I4.4 — atomic supersession, retained history
// ---------------------------------------------------------------------------

describe('allocation-set supersession (C6 I4.3, I4.4)', () => {
  function dbWithSplitTxn(): { db: NizamDb; id: string } {
    const db = freshDb();
    const [acc] = accountIds(db);
    const t = addTransaction(db, {
      accountId: acc,
      date: '2026-09-01',
      payee: 'Market',
      categoryId: null,
      amount: -10_000,
      splits: [
        { categoryId: 'cat_food', amount: -6_000, memo: 'groceries' },
        { categoryId: 'cat_fuel', amount: -4_000, memo: 'petrol' },
      ],
    });
    return { db, id: t.id };
  }

  it('an unedited split transaction is version 0 with no history', () => {
    const { db, id } = dbWithSplitTxn();
    const t = byId(db, id);
    expect(allocationVersionOf(t)).toBe(0);
    expect(supersededAllocationsOf(t)).toEqual([]);
  });

  it('editing the legs retires the previous set and bumps the version', () => {
    const { db, id } = dbWithSplitTxn();
    const before = byId(db, id).splits?.map((l) => ({ ...l }));
    updateTransaction(
      db,
      id,
      { splits: [{ id: 'spl_new', categoryId: 'cat_food', amount: -10_000, memo: 'all food' }] },
      AT,
    );
    const t = byId(db, id);
    expect(allocationVersionOf(t)).toBe(1);
    const history = supersededAllocationsOf(t);
    expect(history.length).toBe(1);
    expect(history[0]?.version).toBe(0);
    expect(history[0]?.supersededAt).toBe(AT);
    expect(history[0]?.legs).toEqual(before);
    expect(t.splits?.map((l) => l.amount)).toEqual([-10_000]);
  });

  it('the retained history is a COPY — later edits to the live set do not rewrite it', () => {
    const { db, id } = dbWithSplitTxn();
    updateTransaction(
      db,
      id,
      { splits: [{ id: 'spl_v1', categoryId: 'cat_food', amount: -10_000, memo: 'v1' }] },
      AT,
    );
    updateTransaction(
      db,
      id,
      { splits: [{ id: 'spl_v2', categoryId: 'cat_fuel', amount: -10_000, memo: 'v2' }] },
      AT2,
    );
    const t = byId(db, id);
    expect(allocationVersionOf(t)).toBe(2);
    const history = supersededAllocationsOf(t);
    expect(history.map((h) => h.version)).toEqual([0, 1]);
    expect(history[0]?.legs.map((l) => l.amount)).toEqual([-6_000, -4_000]);
    expect(history[1]?.legs.map((l) => l.memo)).toEqual(['v1']);
  });

  it('an edit that re-sends IDENTICAL legs creates no new version', () => {
    // The edit form re-sends the whole split array even when only the memo changed. A version
    // whose only difference is a timestamp is audit noise that hides the edits that moved money.
    const { db, id } = dbWithSplitTxn();
    const same = byId(db, id).splits?.map((l) => ({ ...l }));
    updateTransaction(db, id, { memo: 'changed memo', splits: same ?? null }, AT);
    const t = byId(db, id);
    expect(allocationVersionOf(t)).toBe(0);
    expect(supersededAllocationsOf(t)).toEqual([]);
    expect(t.memo).toBe('changed memo');
  });

  it('removing the splits entirely still retains the set that was live', () => {
    const { db, id } = dbWithSplitTxn();
    updateTransaction(db, id, { splits: null, categoryId: 'cat_food' }, AT);
    const t = byId(db, id);
    expect(t.splits).toBeNull();
    expect(supersededAllocationsOf(t).length).toBe(1);
    expect(supersededAllocationsOf(t)[0]?.legs.length).toBe(2);
  });

  it('a REFUSED edit leaves neither the old set superseded nor a partial new one', () => {
    // vNext A3: partial application is a defect. The sum check must run before anything moves.
    const { db, id } = dbWithSplitTxn();
    expect(() =>
      updateTransaction(
        db,
        id,
        { splits: [{ id: 'spl_bad', categoryId: 'cat_food', amount: -9_999, memo: 'off by one' }] },
        AT,
      ),
    ).toThrow();
    const t = byId(db, id);
    expect(allocationVersionOf(t)).toBe(0);
    expect(supersededAllocationsOf(t)).toEqual([]);
    expect(t.splits?.map((l) => l.amount)).toEqual([-6_000, -4_000]);
  });

  it('allocationHistoryOf returns superseded sets oldest first with the live set last', () => {
    const { db, id } = dbWithSplitTxn();
    updateTransaction(
      db,
      id,
      { splits: [{ id: 'spl_v1', categoryId: 'cat_food', amount: -10_000, memo: 'v1' }] },
      AT,
    );
    const history = allocationHistoryOf(byId(db, id));
    expect(history.map((h) => [h.version, h.live])).toEqual([
      [0, false],
      [1, true],
    ]);
    expect(history[1]?.supersededAt).toBeNull();
  });

  it('history survives schema validation — it is storable, not just in-memory', () => {
    const { db, id } = dbWithSplitTxn();
    updateTransaction(
      db,
      id,
      { splits: [{ id: 'spl_v1', categoryId: 'cat_food', amount: -10_000, memo: 'v1' }] },
      AT,
    );
    const round = validateDb(JSON.parse(JSON.stringify(db)));
    expect(supersededAllocationsOf(byId(round, id)).length).toBe(1);
  });

  it('supersession moves no money — the parent amount and account balance are unchanged', () => {
    const { db, id } = dbWithSplitTxn();
    const [acc] = accountIds(db);
    const balanceBefore = accountBalance(db, acc);
    updateTransaction(
      db,
      id,
      { splits: [{ id: 'spl_v1', categoryId: 'cat_food', amount: -10_000, memo: 'v1' }] },
      AT,
    );
    expect(byId(db, id).amount).toBe(-10_000);
    expect(accountBalance(db, acc)).toBe(balanceBefore);
  });
});

// ---------------------------------------------------------------------------
// C6 I4.6 / vNext T4, T5 — transfer legs move as one unit
// ---------------------------------------------------------------------------

describe('transfer legs mutate as one unit (C6 I4.6)', () => {
  function dbWithTransfer(): { db: NizamDb; outId: string; inId: string } {
    const db = freshDb();
    const [from, to] = accountIds(db);
    const [out, into] = addTransfer(db, {
      fromAccountId: from,
      toAccountId: to,
      amount: 25_000,
      date: '2026-09-01',
      memo: 'move',
    });
    return { db, outId: out.id, inId: into.id };
  }

  it('editing the amount on one leg mirrors it NEGATED onto the peer', () => {
    const { db, outId, inId } = dbWithTransfer();
    updateTransaction(db, outId, { amount: -30_000 }, AT);
    expect(byId(db, outId).amount).toBe(-30_000);
    expect(byId(db, inId).amount).toBe(30_000);
  });

  it('the pair still sums to zero after an edit — a transfer creates no money', () => {
    const { db, outId, inId } = dbWithTransfer();
    updateTransaction(db, outId, { amount: -30_000 }, AT);
    expect(byId(db, outId).amount + byId(db, inId).amount).toBe(0);
  });

  it('editing the date and memo mirrors onto the peer', () => {
    const { db, outId, inId } = dbWithTransfer();
    updateTransaction(db, outId, { date: '2026-09-05', memo: 'rent float' }, AT);
    expect(byId(db, inId).date).toBe('2026-09-05');
    expect(byId(db, inId).memo).toBe('rent float');
  });

  it('does NOT overwrite the peer payee — each leg names the OTHER account', () => {
    const { db, outId, inId } = dbWithTransfer();
    const peerPayeeBefore = byId(db, inId).payee;
    updateTransaction(db, outId, { date: '2026-09-05' }, AT);
    expect(byId(db, inId).payee).toBe(peerPayeeBefore);
    expect(byId(db, inId).payee).not.toBe(byId(db, outId).payee);
  });

  it('refuses a category on a transfer leg — a transfer is neither spending nor income', () => {
    const { db, outId } = dbWithTransfer();
    expect(() => updateTransaction(db, outId, { categoryId: 'cat_food' }, AT)).toThrow(
      /neither spending nor income/,
    );
  });

  it('refuses splits on a transfer leg', () => {
    const { db, outId } = dbWithTransfer();
    expect(() =>
      updateTransaction(
        db,
        outId,
        { splits: [{ id: 'spl_x', categoryId: 'cat_food', amount: -25_000, memo: '' }] },
        AT,
      ),
    ).toThrow(/no category to allocate to/);
  });

  it('tolerates the no-op patch the edit form always sends (splits: null, unchanged payee)', () => {
    const { db, outId } = dbWithTransfer();
    const payee = byId(db, outId).payee;
    expect(() =>
      updateTransaction(db, outId, { splits: null, categoryId: null, payee }, AT),
    ).not.toThrow();
  });

  it('refuses to edit a leg whose PEER is locked, leaving both untouched', () => {
    const { db, outId, inId } = dbWithTransfer();
    setCleared(db, inId, 'cleared');
    lockReconciled(db, byId(db, inId).accountId);
    expect(byId(db, inId).cleared).toBe('reconciled');
    expect(() => updateTransaction(db, outId, { amount: -30_000 }, AT)).toThrow(/locked/);
    expect(byId(db, outId).amount).toBe(-25_000);
    expect(byId(db, inId).amount).toBe(25_000);
  });
});

// ---------------------------------------------------------------------------
// C6 I4.5 / vNext S2 — the reconciled lock and reversal + replacement (D4-A)
// ---------------------------------------------------------------------------

describe('reconciled lock (C6 I4.5)', () => {
  function dbWithReconciled(): { db: NizamDb; id: string; acc: string } {
    const db = freshDb();
    const [acc] = accountIds(db);
    const t = addTransaction(db, {
      accountId: acc,
      date: '2026-09-01',
      payee: 'Grocer',
      categoryId: 'cat_food',
      amount: -20_500,
      cleared: 'cleared',
    });
    lockReconciled(db, acc);
    return { db, id: t.id, acc };
  }

  it('refuses an in-place edit of a reconciled transaction', () => {
    const { db, id } = dbWithReconciled();
    expect(() => updateTransaction(db, id, { amount: -25_000 }, AT)).toThrow(/locked/);
    expect(byId(db, id).amount).toBe(-20_500);
  });

  it('refuses deletion of a reconciled transaction', () => {
    const { db, id } = dbWithReconciled();
    expect(() => deleteTransaction(db, id)).toThrow(/locked/);
    expect(db.transactions.some((t) => t.id === id)).toBe(true);
  });

  it('refuses a cleared-status change on a reconciled transaction', () => {
    const { db, id } = dbWithReconciled();
    expect(() => setCleared(db, id, 'uncleared')).toThrow(/locked/);
  });
});

describe('correctReconciledTransaction — reversal + replacement (owner decision D4-A)', () => {
  function dbWithReconciled(amount = -20_500): { db: NizamDb; id: string; acc: string } {
    const db = freshDb();
    const [acc] = accountIds(db);
    const t = addTransaction(db, {
      accountId: acc,
      date: '2026-09-01',
      payee: 'Grocer',
      categoryId: 'cat_food',
      amount,
      cleared: 'cleared',
    });
    lockReconciled(db, acc);
    return { db, id: t.id, acc };
  }

  it('NEVER mutates the original — it stays reconciled with its original amount', () => {
    const { db, id } = dbWithReconciled();
    const snapshot = JSON.stringify(byId(db, id));
    correctReconciledTransaction(db, id, { amount: -25_000, reason: 'statement said 25.000' }, AT);
    expect(JSON.stringify(byId(db, id))).toBe(snapshot);
    expect(byId(db, id).cleared).toBe('reconciled');
  });

  it('appends exactly two rows: a reversal and a replacement sharing one group id', () => {
    const { db, id } = dbWithReconciled();
    const before = db.transactions.length;
    const result = correctReconciledTransaction(
      db,
      id,
      { amount: -25_000, reason: 'statement said 25.000' },
      AT,
    );
    expect(db.transactions.length).toBe(before + 2);
    expect(result.reversals.length).toBe(1);
    expect(result.replacements.length).toBe(1);
    const group = correctionGroup(db.transactions, result.correctionGroupId);
    expect(group.length).toBe(2);
    expect(group.map((t) => t.correction?.role).sort()).toEqual(['replacement', 'reversal']);
  });

  it('the reversal is the EXACT negation of the original', () => {
    const { db, id } = dbWithReconciled();
    const { reversals } = correctReconciledTransaction(
      db,
      id,
      { amount: -25_000, reason: 'r' },
      AT,
    );
    expect(reversals[0]?.amount).toBe(20_500);
    expect(reversals[0]?.date).toBe('2026-09-01');
    expect(reversals[0]?.currency).toBe(byId(db, id).currency);
  });

  it('nets to the corrected amount, matching what an in-place edit would have produced', () => {
    const { db, id, acc } = dbWithReconciled();
    correctReconciledTransaction(db, id, { amount: -25_000, reason: 'r' }, AT);
    expect(netAmountOf(db.transactions, id)).toBe(-25_000);
    expect(accountBalance(db, acc)).toBe(-25_000);
  });

  it('needs NO engine change — cleared balance and category activity both report the correction', () => {
    const { db, id, acc } = dbWithReconciled();
    expect(activityFor(reindexed(db), 'cat_food', '2026-09')).toBe(-20_500);
    correctReconciledTransaction(db, id, { amount: -25_000, reason: 'r' }, AT);
    const after = reindexed(db);
    // Neither engine was told what a correction is. They sum amounts, and the appended rows
    // are ordinary rows, so the corrected figure falls out of arithmetic already in place.
    expect(activityFor(after, 'cat_food', '2026-09')).toBe(-25_000);
    expect(accountClearedBalance(after, acc)).toBe(-25_000);
  });

  it('books both rows on the ORIGINAL date so the reconciled period still reconciles', () => {
    const { db, id } = dbWithReconciled();
    const { reversals, replacements } = correctReconciledTransaction(
      db,
      id,
      { amount: -25_000, reason: 'r' },
      AT,
    );
    expect(reversals[0]?.date).toBe('2026-09-01');
    expect(replacements[0]?.date).toBe('2026-09-01');
  });

  it('records WHEN the correction happened in correctedAt, which the booked date cannot show', () => {
    const { db, id } = dbWithReconciled();
    const { reversals, replacements } = correctReconciledTransaction(
      db,
      id,
      { amount: -25_000, reason: 'bank statement 2026-09-02' },
      AT,
    );
    expect(reversals[0]?.correction?.correctedAt).toBe(AT);
    expect(replacements[0]?.correction?.correctedAt).toBe(AT);
    expect(reversals[0]?.correction?.reason).toBe('bank statement 2026-09-02');
  });

  it('marks the original as reversed by DERIVATION, not by a stored flag', () => {
    const { db, id } = dbWithReconciled();
    expect(isReversed(db.transactions, id)).toBe(false);
    correctReconciledTransaction(db, id, { amount: -25_000, reason: 'r' }, AT);
    expect(isReversed(db.transactions, id)).toBe(true);
    expect('lifecycle' in (byId(db, id) as unknown as Record<string, unknown>)).toBe(false);
  });

  it('appends the rows as `cleared`, never `reconciled` — no statement has matched them', () => {
    const { db, id } = dbWithReconciled();
    const { reversals, replacements } = correctReconciledTransaction(
      db,
      id,
      { amount: -25_000, reason: 'r' },
      AT,
    );
    expect(reversals[0]?.cleared).toBe('cleared');
    expect(replacements[0]?.cleared).toBe('cleared');
  });

  it('does NOT copy import provenance onto the correction rows', () => {
    const { db, id } = dbWithReconciled();
    byId(db, id).importInfo = {
      duplicateKey: 'dk_1',
      sourceFile: 'statement.csv',
      sourcePageOrSheet: '1',
      extractionMethod: 'parser',
      confidenceScore: 1,
      confidenceReason: 'exact',
    };
    const { reversals, replacements } = correctReconciledTransaction(
      db,
      id,
      { amount: -25_000, reason: 'r' },
      AT,
    );
    expect(reversals[0]?.importInfo).toBeNull();
    expect(replacements[0]?.importInfo).toBeNull();
    // The original keeps it, and stays reachable through correctsTransactionId.
    expect(byId(db, id).importInfo?.duplicateKey).toBe('dk_1');
    expect(reversals[0]?.correction?.correctsTransactionId).toBe(id);
  });

  it('negates split legs LEG BY LEG so each category nets to exactly zero', () => {
    const db = freshDb();
    const [acc] = accountIds(db);
    const t = addTransaction(db, {
      accountId: acc,
      date: '2026-09-01',
      payee: 'Market',
      categoryId: null,
      amount: -10_000,
      cleared: 'cleared',
      splits: [
        { categoryId: 'cat_food', amount: -6_000, memo: '' },
        { categoryId: 'cat_fuel', amount: -4_000, memo: '' },
      ],
    });
    lockReconciled(db, acc);
    correctReconciledTransaction(
      db,
      t.id,
      {
        amount: -12_000,
        splits: [
          { categoryId: 'cat_food', amount: -7_000, memo: '' },
          { categoryId: 'cat_fuel', amount: -5_000, memo: '' },
        ],
        reason: 'both legs understated',
      },
      AT,
    );
    // -6000 (original) + 6000 (reversal) - 7000 (replacement) = -7000, per category.
    expect(activityFor(db, 'cat_food', '2026-09')).toBe(-7_000);
    expect(activityFor(db, 'cat_fuel', '2026-09')).toBe(-5_000);
    expect(accountBalance(db, acc)).toBe(-12_000);
  });

  it('refuses a replacement whose legs do not sum exactly, appending nothing', () => {
    const db = freshDb();
    const [acc] = accountIds(db);
    const t = addTransaction(db, {
      accountId: acc,
      date: '2026-09-01',
      payee: 'Market',
      categoryId: null,
      amount: -10_000,
      cleared: 'cleared',
      splits: [{ categoryId: 'cat_food', amount: -10_000, memo: '' }],
    });
    lockReconciled(db, acc);
    const before = db.transactions.length;
    expect(() =>
      correctReconciledTransaction(
        db,
        t.id,
        {
          amount: -12_000,
          splits: [{ categoryId: 'cat_food', amount: -11_999, memo: '' }],
          reason: 'off by one',
        },
        AT,
      ),
    ).toThrow(/exactly/);
    expect(db.transactions.length).toBe(before);
  });

  it('refuses to correct a transaction that is not reconciled', () => {
    const db = freshDb();
    const [acc] = accountIds(db);
    const t = addTransaction(db, {
      accountId: acc,
      date: '2026-09-01',
      payee: 'Grocer',
      categoryId: 'cat_food',
      amount: -20_500,
    });
    expect(() =>
      correctReconciledTransaction(db, t.id, { amount: -25_000, reason: 'r' }, AT),
    ).toThrow(/not `reconciled`/);
  });

  it('refuses a correction with no stated reason', () => {
    const { db, id } = dbWithReconciled();
    expect(() =>
      correctReconciledTransaction(db, id, { amount: -25_000, reason: '   ' }, AT),
    ).toThrow(/requires a stated reason/);
  });

  it('refuses a correction that changes nothing', () => {
    const { db, id } = dbWithReconciled();
    expect(() =>
      correctReconciledTransaction(db, id, { amount: -20_500, reason: 'no change' }, AT),
    ).toThrow(/must change at least one fact/);
  });

  it('refuses a fractional corrected amount', () => {
    const { db, id } = dbWithReconciled();
    expect(() =>
      correctReconciledTransaction(db, id, { amount: -25_000.5, reason: 'r' }, AT),
    ).toThrow();
  });

  it('the appended rows survive schema validation', () => {
    const { db, id } = dbWithReconciled();
    correctReconciledTransaction(db, id, { amount: -25_000, reason: 'r' }, AT);
    const round = validateDb(JSON.parse(JSON.stringify(db)));
    expect(correctionRowsFor(round.transactions, id).length).toBe(2);
  });

  it('a later reconciliation locks the correction rows through the normal path', () => {
    const { db, id, acc } = dbWithReconciled();
    correctReconciledTransaction(db, id, { amount: -25_000, reason: 'r' }, AT);
    expect(lockReconciled(db, acc)).toBe(2);
    for (const row of correctionRowsFor(db.transactions, id)) {
      expect(row.cleared).toBe('reconciled');
    }
  });
});

describe('correcting a reconciled TRANSFER (C6 I4.6, vNext T4/T5)', () => {
  function dbWithReconciledTransfer(): { db: NizamDb; outId: string; inId: string } {
    const db = freshDb();
    const [from, to] = accountIds(db);
    const [out, into] = addTransfer(db, {
      fromAccountId: from,
      toAccountId: to,
      amount: 25_000,
      date: '2026-09-01',
      memo: 'move',
      cleared: 'cleared',
    });
    lockReconciled(db, from);
    lockReconciled(db, to);
    return { db, outId: out.id, inId: into.id };
  }

  it('corrects BOTH legs as one group of four rows', () => {
    const { db, outId } = dbWithReconciledTransfer();
    const result = correctReconciledTransaction(db, outId, { amount: -30_000, reason: 'r' }, AT);
    expect(result.reversals.length).toBe(2);
    expect(result.replacements.length).toBe(2);
    expect(correctionGroup(db.transactions, result.correctionGroupId).length).toBe(4);
  });

  it('mirrors the corrected amount NEGATED onto the peer replacement', () => {
    const { db, outId, inId } = dbWithReconciledTransfer();
    const { replacements } = correctReconciledTransaction(
      db,
      outId,
      { amount: -30_000, reason: 'r' },
      AT,
    );
    const outRep = replacements.find((r) => r.correction?.correctsTransactionId === outId);
    const inRep = replacements.find((r) => r.correction?.correctsTransactionId === inId);
    expect(outRep?.amount).toBe(-30_000);
    expect(inRep?.amount).toBe(30_000);
  });

  it('creates NO spending and NO income — transfer linkage is preserved on every row', () => {
    // budget.logic, rescue and ageOfMoney all exclude transfers by testing transferAccountId.
    // A correction row that dropped it would be counted as real spending.
    const { db, outId } = dbWithReconciledTransfer();
    const result = correctReconciledTransaction(db, outId, { amount: -30_000, reason: 'r' }, AT);
    for (const row of correctionGroup(db.transactions, result.correctionGroupId)) {
      expect(row.transferAccountId).not.toBeNull();
      expect(row.categoryId).toBeNull();
    }
  });

  it('re-pairs the correction rows with EACH OTHER, not with the originals', () => {
    const { db, outId, inId } = dbWithReconciledTransfer();
    const result = correctReconciledTransaction(db, outId, { amount: -30_000, reason: 'r' }, AT);
    const group = correctionGroup(db.transactions, result.correctionGroupId);
    const groupIds = new Set(group.map((t) => t.id));
    for (const row of group) {
      expect(row.transferTransactionId).not.toBeNull();
      // Pointing at an ORIGINAL would make a three-leg transfer group, which vNext T4 forbids.
      expect(row.transferTransactionId).not.toBe(outId);
      expect(row.transferTransactionId).not.toBe(inId);
      expect(groupIds.has(row.transferTransactionId ?? '')).toBe(true);
    }
    // Exactly two live legs per set, and each pairing is symmetric.
    for (const row of group) {
      const peer = group.find((t) => t.id === row.transferTransactionId);
      expect(peer?.transferTransactionId).toBe(row.id);
      expect(peer?.correction?.role).toBe(row.correction?.role);
    }
  });

  it('every corrected transfer still sums to zero across the two accounts', () => {
    const { db, outId } = dbWithReconciledTransfer();
    const result = correctReconciledTransaction(db, outId, { amount: -30_000, reason: 'r' }, AT);
    const group = correctionGroup(db.transactions, result.correctionGroupId);
    expect(group.reduce((s, t) => s + t.amount, 0)).toBe(0);
    expect(db.transactions.reduce((s, t) => s + t.amount, 0)).toBe(0);
  });

  it('refuses a category or splits on a transfer correction', () => {
    const { db, outId } = dbWithReconciledTransfer();
    expect(() =>
      correctReconciledTransaction(db, outId, { categoryId: 'cat_food', reason: 'r' }, AT),
    ).toThrow(/neither spending nor income/);
  });

  it('refuses a half-locked pair rather than silently correcting one side', () => {
    const db = freshDb();
    const [from, to] = accountIds(db);
    const [out] = addTransfer(db, {
      fromAccountId: from,
      toAccountId: to,
      amount: 25_000,
      date: '2026-09-01',
      cleared: 'cleared',
    });
    lockReconciled(db, from);
    const before = db.transactions.length;
    expect(() =>
      correctReconciledTransaction(db, out.id, { amount: -30_000, reason: 'r' }, AT),
    ).toThrow(/corrected as one unit/);
    expect(db.transactions.length).toBe(before);
  });
});
