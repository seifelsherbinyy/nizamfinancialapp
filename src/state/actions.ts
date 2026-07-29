/**
 * NIZAM · Domain actions — pure NizamDb mutation helpers used with store.mutate
 * Implemented by: KIRO Contract 4 / Phase 4.2
 * Depends on: lib/db/schema.ts, feature type modules, lib/money
 *
 * Every helper mutates a DRAFT NizamDb (structuredClone inside store.mutate).
 * All money values are integer milliunits (asserted).
 */
import type { NizamDb } from '@/lib/db/schema';
import type { Account, AccountType } from '@/features/accounts/accounts.types';
import type {
  ClearedStatus,
  Transaction,
  TransactionSplit,
} from '@/features/transactions/transaction.types';
import { assertMoney, type Money } from '@/lib/money/money';

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
  accountIdentifier?: string | null;
  creditLimit?: Money | null;
  startingBalance?: Money;
  startingDate?: string;
}

/** Create an account (plus an optional starting-balance transaction). */
export function addAccount(draft: NizamDb, input: AddAccountInput): Account {
  const account: Account = {
    id: newId('acc'),
    name: input.name.trim() || 'New Account',
    type: input.type,
    onBudget: input.onBudget,
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
    let total = 0;
    splits = input.splits.map((s) => {
      assertMoney(s.amount);
      total += s.amount;
      return { ...s, id: newId('spl') };
    });
    if (total !== input.amount) {
      throw new Error('NIZAM: split legs must sum exactly to the transaction amount');
    }
  }
  const txn: Transaction = {
    id: newId('txn'),
    accountId: input.accountId,
    date: input.date,
    payee: input.payee,
    categoryId: splits ? null : input.categoryId,
    memo: input.memo ?? '',
    amount: input.amount,
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
  const out: Transaction = {
    ...base,
    id: outId,
    accountId: input.fromAccountId,
    payee: `Transfer : ${accountName(input.toAccountId)}`,
    amount: -input.amount,
    transferAccountId: input.toAccountId,
    transferTransactionId: inId,
  };
  const into: Transaction = {
    ...base,
    id: inId,
    accountId: input.toAccountId,
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

export type TransactionPatch = Partial<
  Pick<Transaction, 'date' | 'payee' | 'categoryId' | 'memo' | 'amount' | 'splits'>
>;

export function updateTransaction(draft: NizamDb, id: string, patch: TransactionPatch): void {
  const txn = mustFind(draft, id);
  assertNotLocked(txn);
  if (patch.amount !== undefined) assertMoney(patch.amount);
  if (patch.splits) {
    const total = patch.splits.reduce((s, leg) => s + assertMoney(leg.amount), 0);
    const amount = patch.amount ?? txn.amount;
    if (total !== amount) {
      throw new Error('NIZAM: split legs must sum exactly to the transaction amount');
    }
  }
  Object.assign(txn, patch);
  if (patch.payee) ensurePayee(draft, patch.payee);
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
