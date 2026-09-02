/**
 * NIZAM · Domain actions — pure NizamDb mutation helpers used with store.mutate
 * Implemented by: KIRO Contract 4 / Phase 4.2
 * Extended by: Contract 6 (multicurrency ledger integrity) / Phase 6.4 — atomic allocation
 *   supersession, transfer legs mutated as a unit, and the reconciled-lock correction
 *   workflow (I4.3, I4.4, I4.5, I4.6). Owner decision D4-A (reversal + replacement),
 *   ratified 2026-09-02.
 * Depends on: lib/db/schema.ts, feature type modules, lib/money
 *
 * Every helper mutates a DRAFT NizamDb (structuredClone inside store.mutate).
 * All money values are integer milliunits (asserted).
 */
import type { NizamDb } from '@/lib/db/schema';
import type { Account, AccountType } from '@/features/accounts/accounts.types';
import {
  allocationVersionOf,
  type ClearedStatus,
  type Transaction,
  type TransactionSplit,
} from '@/features/transactions/transaction.types';
import { assertAllocationLegsSumExactly } from '@/features/transactions/corrections';
import { assertMoney, type Money } from '@/lib/money/money';
import type { CurrencyCode } from '@/lib/money/currency';

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** Recompute cached account balances from transactions (single source of truth). */
export function recomputeAccountBalances(draft: NizamDb): void {
  const balance = new Map<string, Money>();
  const cleared = new Map<string, Money>();
  for (const t of draft.transactions) {
    balance.set(t.accountId, (balance.get(t.accountId) ?? 0) + t.amount);
    if (t.cleared !== 'uncleared') {
      cleared.set(t.accountId, (cleared.get(t.accountId) ?? 0) + t.amount);
    }
  }
  for (const a of draft.accounts) {
    a.balance = balance.get(a.id) ?? 0;
    a.clearedBalance = cleared.get(a.id) ?? 0;
  }
}

export interface AddAccountInput {
  name: string;
  type: AccountType;
  onBudget: boolean;
  /** Native currency. Defaults to the store's own `meta.currency`, never a constant. */
  currency?: CurrencyCode;
  accountIdentifier?: string | null;
  creditLimit?: Money | null;
  startingBalance?: Money;
  startingDate?: string;
}

/**
 * A transaction is denominated in ITS ACCOUNT's currency (C6 I1.2). Resolved from
 * the account rather than defaulted to a constant: silently stamping 'EGP' onto a
 * foreign-currency account would misstate money.
 */
function accountCurrency(draft: NizamDb, accountId: string): CurrencyCode {
  const account = draft.accounts.find((a) => a.id === accountId);
  if (!account) {
    throw new Error(`NIZAM: cannot resolve a currency — no account ${accountId}`);
  }
  return account.currency;
}

/** Create an account (plus an optional starting-balance transaction). */
export function addAccount(draft: NizamDb, input: AddAccountInput): Account {
  const account: Account = {
    id: newId('acc'),
    name: input.name.trim() || 'New Account',
    type: input.type,
    onBudget: input.onBudget,
    currency: input.currency ?? draft.meta.currency,
    balance: 0,
    clearedBalance: 0,
    accountIdentifier: input.accountIdentifier ?? null,
    creditLimit: input.creditLimit != null ? assertMoney(input.creditLimit) : null,
    closed: false,
    order: draft.accounts.length,
    paymentCategoryId: null,
  };
  draft.accounts.push(account);
  const starting = input.startingBalance ?? 0;
  if (starting !== 0) {
    draft.transactions.push({
      id: newId('txn'),
      accountId: account.id,
      date: input.startingDate ?? new Date().toISOString().slice(0, 10),
      payee: 'Starting Balance',
      categoryId: null,
      memo: '',
      amount: assertMoney(starting),
      currency: account.currency,
      cleared: 'cleared',
      approved: true,
      transferAccountId: null,
      transferTransactionId: null,
      splits: null,
      importInfo: null,
    });
  }
  recomputeAccountBalances(draft);
  return account;
}

export function ensurePayee(draft: NizamDb, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (!draft.payees.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
    draft.payees.push({ id: newId('pay'), name: trimmed });
  }
}

export interface AddTransactionInput {
  accountId: string;
  date: string;
  payee: string;
  categoryId: string | null;
  amount: Money;
  memo?: string;
  cleared?: ClearedStatus;
  splits?: Omit<TransactionSplit, 'id'>[] | null;
}

/** Add a regular (or split) transaction. Split legs must sum exactly to amount. */
export function addTransaction(draft: NizamDb, input: AddTransactionInput): Transaction {
  assertMoney(input.amount);
  let splits: TransactionSplit[] | null = null;
  if (input.splits && input.splits.length > 0) {
    // Routed through the shared assertion rather than an inline copy of the same rule. Two
    // implementations of "legs sum exactly" is one too many: a tolerance introduced into one
    // of them would be caught on the edit path and silently accepted on the create path.
    assertAllocationLegsSumExactly(input.amount, input.splits);
    splits = input.splits.map((s) => ({ ...s, id: newId('spl') }));
  }
  const txn: Transaction = {
    id: newId('txn'),
    accountId: input.accountId,
    date: input.date,
    payee: input.payee,
    categoryId: splits ? null : input.categoryId,
    memo: input.memo ?? '',
    amount: input.amount,
    currency: accountCurrency(draft, input.accountId),
    cleared: input.cleared ?? 'uncleared',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits,
    importInfo: null,
  };
  draft.transactions.push(txn);
  ensurePayee(draft, input.payee);
  recomputeAccountBalances(draft);
  return txn;
}

export interface AddTransferInput {
  fromAccountId: string;
  toAccountId: string;
  /** Positive magnitude leaving `from` into `to`. */
  amount: Money;
  date: string;
  memo?: string;
  cleared?: ClearedStatus;
}

/** Create the two mirrored legs of a transfer (no category on either). */
export function addTransfer(draft: NizamDb, input: AddTransferInput): [Transaction, Transaction] {
  assertMoney(input.amount);
  if (input.amount <= 0) throw new Error('NIZAM: transfer amount must be positive');
  if (input.fromAccountId === input.toAccountId) {
    throw new Error('NIZAM: transfer needs two different accounts');
  }
  const accountName = (id: string) => draft.accounts.find((a) => a.id === id)?.name ?? id;
  const outId = newId('txn');
  const inId = newId('txn');
  const base = {
    date: input.date,
    categoryId: null,
    memo: input.memo ?? '',
    cleared: input.cleared ?? 'uncleared',
    approved: true,
    splits: null,
    importInfo: null,
  } as const;
  const fromCurrency = accountCurrency(draft, input.fromAccountId);
  const toCurrency = accountCurrency(draft, input.toAccountId);
  if (fromCurrency !== toCurrency) {
    // vNext T3 requires each leg to record its own native amount. Until that
    // lands (Step 4) a single `input.amount` cannot honestly describe both legs,
    // so refuse instead of stamping one currency's magnitude onto the other.
    throw new Error(
      `NIZAM: cross-currency transfer ${fromCurrency}->${toCurrency} is not supported yet; ` +
        'record it as two transactions until per-leg amounts land.',
    );
  }
  const out: Transaction = {
    ...base,
    id: outId,
    accountId: input.fromAccountId,
    currency: fromCurrency,
    payee: `Transfer : ${accountName(input.toAccountId)}`,
    amount: -input.amount,
    transferAccountId: input.toAccountId,
    transferTransactionId: inId,
  };
  const into: Transaction = {
    ...base,
    id: inId,
    accountId: input.toAccountId,
    currency: toCurrency,
    payee: `Transfer : ${accountName(input.fromAccountId)}`,
    amount: input.amount,
    transferAccountId: input.fromAccountId,
    transferTransactionId: outId,
  };
  draft.transactions.push(out, into);
  recomputeAccountBalances(draft);
  return [out, into];
}

function mustFind(draft: NizamDb, id: string): Transaction {
  const txn = draft.transactions.find((t) => t.id === id);
  if (!txn) throw new Error(`NIZAM: no transaction ${id}`);
  return txn;
}

/** Reconciled transactions are locked (Contract 4 / Phase 4.6). */
function assertNotLocked(txn: Transaction): void {
  if (txn.cleared === 'reconciled') {
    throw new Error('NIZAM: reconciled transactions are locked');
  }
}

/**
 * Audit timestamp. Injectable through the `at` parameter of every helper that stamps one, so
 * a test pins the value instead of asserting on wall-clock output.
 */
function nowIso(): string {
  return new Date().toISOString();
}

/** The other leg of a transfer, or null for an ordinary transaction. */
function transferPeerOf(draft: NizamDb, txn: Transaction): Transaction | null {
  if (!txn.transferTransactionId) return null;
  return draft.transactions.find((t) => t.id === txn.transferTransactionId) ?? null;
}

/** Deep leg comparison — id, category, amount and memo must all match. */
function allocationLegsEqual(
  a: readonly TransactionSplit[] | null,
  b: readonly TransactionSplit[] | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((leg, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      leg.id === other.id &&
      leg.categoryId === other.categoryId &&
      leg.amount === other.amount &&
      leg.memo === other.memo
    );
  });
}

/**
 * Retire the live allocation set into history and bump the version (C6 I4.3, I4.4).
 *
 * Called only when the legs actually changed. An edit that touches only the memo re-sends an
 * identical set, and manufacturing a version whose sole difference is a timestamp would turn
 * the audit history into noise that hides the edits that did move money.
 *
 * The push and the version bump happen together in one synchronous step, which is what vNext
 * A3 means by atomic supersession: there is no point at which the old set is retired but the
 * new version is not yet recorded.
 */
function supersedeLiveAllocationSet(txn: Transaction, at: string): void {
  if (!txn.splits) return;
  const version = allocationVersionOf(txn);
  const history = txn.supersededAllocations ?? [];
  history.push({
    version,
    legs: txn.splits.map((leg) => ({ ...leg })),
    supersededAt: at,
  });
  txn.supersededAllocations = history;
  txn.allocationSetVersion = version + 1;
}

/**
 * Refuse a patch field that a transfer leg has no honest place for (vNext T1).
 *
 * A transfer is neither spending nor income, so it carries no category and therefore no
 * category allocation set, and its payee names the peer ACCOUNT rather than a merchant.
 * Checked against the current value so a no-op patch (the edit form always sends
 * `splits: null`) is not refused for changing nothing.
 */
function assertPatchableOnTransferLeg(
  txn: Transaction,
  // Structurally typed rather than `Pick<TransactionPatch, ...>` so it also accepts the
  // id-less draft legs of a correction input. It only needs to know whether legs exist.
  patch: { payee?: string; categoryId?: string | null; splits?: readonly unknown[] | null },
): void {
  const refuse = (field: string, why: string): never => {
    throw new Error(`NIZAM: cannot set \`${field}\` on a transfer leg — ${why}`);
  };
  if (patch.payee !== undefined && patch.payee !== txn.payee) {
    refuse('payee', "a transfer leg's payee names the peer account, not a merchant");
  }
  if (patch.categoryId !== undefined && patch.categoryId !== null) {
    refuse('categoryId', 'a transfer is neither spending nor income (vNext T1)');
  }
  if (patch.splits != null && patch.splits.length > 0) {
    refuse('splits', 'a transfer has no category to allocate to');
  }
}

export type TransactionPatch = Partial<
  Pick<Transaction, 'date' | 'payee' | 'categoryId' | 'memo' | 'amount' | 'splits'>
>;

/**
 * Edit an UNLOCKED transaction in place.
 *
 * Three Step 4 guarantees are added here (C6 Phase 6.4):
 *  - changing the allocation set supersedes the previous one atomically (I4.3, I4.4);
 *  - a transfer's two legs move as one unit, never one edited and its peer stale (I4.6);
 *  - a `reconciled` row is still refused outright (I4.5) — use
 *    `correctReconciledTransaction`, which appends a reversal and a replacement instead.
 *
 * `at` is the audit timestamp for any set this edit supersedes; it is injectable so tests
 * pin it rather than assert on wall-clock output.
 */
export function updateTransaction(
  draft: NizamDb,
  id: string,
  patch: TransactionPatch,
  at: string = nowIso(),
): void {
  const txn = mustFind(draft, id);
  assertNotLocked(txn);
  if (patch.amount !== undefined) assertMoney(patch.amount);

  // Resolve the peer BEFORE mutating anything: a throw after a partial write is exactly the
  // "partial application is a defect" case vNext A3 forbids.
  const peer = transferPeerOf(draft, txn);
  if (peer) {
    assertNotLocked(peer);
    assertPatchableOnTransferLeg(txn, patch);
  }
  if (patch.splits) {
    assertAllocationLegsSumExactly(patch.amount ?? txn.amount, patch.splits);
  }

  if ('splits' in patch && !allocationLegsEqual(txn.splits, patch.splits ?? null)) {
    supersedeLiveAllocationSet(txn, at);
  }
  Object.assign(txn, patch);
  if (patch.payee) ensurePayee(draft, patch.payee);
  if (peer) {
    // Only the genuinely shared facts mirror. The peer's own `payee` and `accountId` describe
    // the opposite side of the same movement and must not be overwritten with this side's.
    if (patch.date !== undefined) peer.date = patch.date;
    if (patch.memo !== undefined) peer.memo = patch.memo;
    if (patch.amount !== undefined) peer.amount = -patch.amount;
  }
  recomputeAccountBalances(draft);
}

export function deleteTransaction(draft: NizamDb, id: string): void {
  const txn = mustFind(draft, id);
  assertNotLocked(txn);
  const ids = new Set([id]);
  if (txn.transferTransactionId) {
    const peer = draft.transactions.find((t) => t.id === txn.transferTransactionId);
    if (peer) {
      assertNotLocked(peer);
      ids.add(peer.id);
    }
  }
  draft.transactions = draft.transactions.filter((t) => !ids.has(t.id));
  recomputeAccountBalances(draft);
}

/** Toggle / set cleared status. Reconciled is terminal (lock). */
export function setCleared(draft: NizamDb, id: string, status: ClearedStatus): void {
  const txn = mustFind(draft, id);
  if (txn.cleared === 'reconciled') {
    throw new Error('NIZAM: reconciled transactions are locked');
  }
  txn.cleared = status;
  recomputeAccountBalances(draft);
}

/** Lock every cleared transaction of an account as reconciled (Phase 4.6). */
export function lockReconciled(draft: NizamDb, accountId: string): number {
  let count = 0;
  for (const t of draft.transactions) {
    if (t.accountId === accountId && t.cleared === 'cleared') {
      t.cleared = 'reconciled';
      count += 1;
    }
  }
  return count;
}

/** Create the balance adjustment that closes a reconciliation difference. */
export function addReconcileAdjustment(
  draft: NizamDb,
  accountId: string,
  difference: Money,
  date: string,
): Transaction {
  assertMoney(difference);
  const txn: Transaction = {
    id: newId('txn'),
    accountId,
    date,
    payee: 'Reconciliation Balance Adjustment',
    categoryId: null,
    memo: 'Created to match the statement balance',
    amount: difference,
    currency: accountCurrency(draft, accountId),
    cleared: 'cleared',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
  };
  draft.transactions.push(txn);
  recomputeAccountBalances(draft);
  return txn;
}

/**
 * Corrected facts for a reconciled transaction. Every field is optional and omission means
 * "unchanged from the original"; `reason` is required because a correction to locked history
 * that does not say why it happened is not auditable.
 */
export interface CorrectReconciledInput {
  /** Owner-supplied reason, stored verbatim on every row of the group. Never generated. */
  reason: string;
  date?: string;
  payee?: string;
  categoryId?: string | null;
  memo?: string;
  /** Corrected signed amount ON THE TARGETED ROW. A transfer peer mirrors it negated. */
  amount?: Money;
  splits?: Omit<TransactionSplit, 'id'>[] | null;
}

export interface CorrectReconciledResult {
  correctionGroupId: string;
  reversals: Transaction[];
  replacements: Transaction[];
}

/**
 * Correct a `reconciled` transaction by REVERSAL + REPLACEMENT (owner decision D4-A,
 * 2026-09-02; C6 I4.5, vNext S2).
 *
 * The original row is never touched. Two rows are appended per corrected original: a reversal
 * carrying the exact negation of the recorded amount, and a replacement carrying the corrected
 * facts. Both carry the same `correctionGroupId`, so a reader can only ever see them together.
 *
 * Why this needs no engine change: because the appended rows are ordinary members of
 * `transactions[]`, every existing engine that sums amounts already reports
 * `original + (-original) + replacement`, which is the replacement. Nothing had to learn what
 * a correction is. That is the property that made reversal + replacement cheaper than
 * unreconcile + amend, and the reason the vNext S2 alternative is deliberately NOT implemented.
 *
 * Split legs are negated leg by leg rather than collapsed into one reversal line, so category
 * activity nets to exactly zero per category instead of only in total.
 *
 * The appended rows are `cleared`, NOT `reconciled`. Only the reconciliation flow may set
 * `reconciled`, because that status asserts a statement match — and no statement has been
 * matched against these rows yet. Stamping them `reconciled` here would make the code claim a
 * verification that never happened. `lockReconciled()` locks them at the next reconciliation,
 * which follows the same path `addReconcileAdjustment` already uses.
 *
 * Both the reversal and the replacement are dated on the ORIGINAL's date, not today. The
 * reconciled period was matched against a bank statement, and the statement is the truth being
 * corrected toward: moving the correction to today would leave that period permanently unable
 * to reconcile while making a later period wrong by the same amount.
 */
export function correctReconciledTransaction(
  draft: NizamDb,
  id: string,
  input: CorrectReconciledInput,
  at: string = nowIso(),
): CorrectReconciledResult {
  const target = mustFind(draft, id);
  if (target.cleared !== 'reconciled') {
    throw new Error(
      `NIZAM: ${id} is \`${target.cleared}\`, not \`reconciled\`, so nothing is locked — edit it ` +
        'in place with updateTransaction. Appending a reversal and a replacement to an unlocked ' +
        'row would add two audit rows recording a lock that never existed.',
    );
  }
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error('NIZAM: a correction to reconciled history requires a stated reason');
  }
  if (input.amount !== undefined) assertMoney(input.amount);

  const peer = transferPeerOf(draft, target);
  if (peer) {
    assertPatchableOnTransferLeg(target, input);
    if (peer.cleared !== 'reconciled') {
      throw new Error(
        `NIZAM: transfer leg ${target.id} is reconciled but its peer ${peer.id} is ` +
          `\`${peer.cleared}\`. The two legs of a transfer are corrected as one unit ` +
          '(C6 I4.6), so a half-locked pair is a defect that must be repaired before ' +
          'correcting it, not worked around here.',
      );
    }
  }

  // A correction that changes nothing would append two rows that net to zero and record no
  // fact. Refuse rather than pollute the audit history.
  const changesSomething =
    (input.amount !== undefined && input.amount !== target.amount) ||
    (input.date !== undefined && input.date !== target.date) ||
    (input.payee !== undefined && input.payee !== target.payee) ||
    (input.categoryId !== undefined && input.categoryId !== target.categoryId) ||
    (input.memo !== undefined && input.memo !== target.memo) ||
    (input.splits !== undefined && !allocationLegsEqual(target.splits, null));
  if (!changesSomething && input.splits === undefined) {
    throw new Error(
      'NIZAM: a correction must change at least one fact — none of the supplied fields differ ' +
        `from ${id}`,
    );
  }

  const originals: Transaction[] = peer ? [target, peer] : [target];
  const correctionGroupId = newId('cor');

  /** The corrected amount for one original. A transfer peer mirrors the target, negated. */
  const correctedAmount = (o: Transaction): Money =>
    input.amount === undefined ? o.amount : o.id === target.id ? input.amount : -input.amount;

  /** Corrected legs for one original. Only the target can carry an allocation set. */
  const correctedSplits = (o: Transaction): TransactionSplit[] | null => {
    if (o.id !== target.id) return null;
    if (input.splits === undefined) {
      return o.splits ? o.splits.map((leg) => ({ ...leg, id: newId('spl') })) : null;
    }
    if (input.splits === null) return null;
    return input.splits.map((leg) => ({ ...leg, id: newId('spl') }));
  };

  const reversals: Transaction[] = originals.map((o) => ({
    id: newId('txn'),
    accountId: o.accountId,
    date: o.date,
    payee: o.payee,
    categoryId: o.categoryId,
    memo: o.memo,
    amount: -o.amount,
    currency: o.currency,
    cleared: 'cleared' as ClearedStatus,
    approved: true,
    // Transfer linkage is PRESERVED on the correction rows. budget.logic, rescue and
    // ageOfMoney all exclude spending and income by testing `transferAccountId`, so a
    // reversal that dropped it would be counted as real spending and misstate the budget.
    transferAccountId: o.transferAccountId,
    transferTransactionId: null,
    splits: o.splits ? o.splits.map((leg) => ({ ...leg, id: newId('spl'), amount: -leg.amount })) : null,
    // Provenance is NOT copied. The reversal was not imported from the original's source
    // file, and duplicating its `duplicateKey` would make two rows claim one source row. The
    // original keeps its provenance untouched and stays reachable through
    // `correction.correctsTransactionId`.
    importInfo: null,
    correction: {
      correctsTransactionId: o.id,
      role: 'reversal' as const,
      correctionGroupId,
      reason,
      correctedAt: at,
    },
  }));

  const replacements: Transaction[] = originals.map((o) => {
    const splits = correctedSplits(o);
    const amount = correctedAmount(o);
    if (splits) assertAllocationLegsSumExactly(amount, splits);
    return {
      id: newId('txn'),
      accountId: o.accountId,
      date: input.date ?? o.date,
      payee: o.id === target.id ? (input.payee ?? o.payee) : o.payee,
      categoryId: splits
        ? null
        : o.id === target.id && input.categoryId !== undefined
          ? input.categoryId
          : o.categoryId,
      memo: input.memo ?? o.memo,
      amount,
      currency: o.currency,
      cleared: 'cleared' as ClearedStatus,
      approved: true,
      transferAccountId: o.transferAccountId,
      transferTransactionId: null,
      splits,
      importInfo: null,
      correction: {
        correctsTransactionId: o.id,
        role: 'replacement' as const,
        correctionGroupId,
        reason,
        correctedAt: at,
      },
    };
  });

  // Re-pair the correction rows with each other so each set is a complete two-leg transfer
  // group. vNext T4 calls one live leg a defect; linking a reversal to the ORIGINAL peer
  // instead would produce exactly that, a group with three legs.
  const relink = (rows: Transaction[]): void => {
    const [a, b] = rows;
    if (a && b) {
      a.transferTransactionId = b.id;
      b.transferTransactionId = a.id;
    }
  };
  if (peer) {
    relink(reversals);
    relink(replacements);
  }

  draft.transactions.push(...reversals, ...replacements);
  for (const r of replacements) ensurePayee(draft, r.payee);
  recomputeAccountBalances(draft);
  return { correctionGroupId, reversals, replacements };
}
