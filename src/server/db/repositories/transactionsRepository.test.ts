// @vitest-environment node
/**
 * NIZAM · transactions repository tests — contract 06 §9 T6, §8.1
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: transactionsRepository.ts, accountsRepository.ts, testStore.ts
 *
 * T6   every monetary column of `transactions` round-trips as the exact integer it was
 *      given, signed `amount` and non-negative magnitudes alike (money-rules §4).
 *
 * §8.1 correction is by SUPERSEDING ROW: the replacement is appended, the predecessor's
 *      facts are left alone, and nothing is deleted — including a suspected duplicate,
 *      which contract 02 §5.2 forbids removing automatically.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepositoryStateError } from '../errors.ts';
import { createAccountsRepository } from './accountsRepository.ts';
import { createTransactionsRepository, type TransactionsRepository } from './transactionsRepository.ts';
import type { TransactionInsert } from './rows.ts';
import { openTestStore, type TestStore } from './testStore.ts';

const ACCOUNT_ID = 'acct-under-test';

let store: TestStore;
let transactions: TransactionsRepository;

const BASE: TransactionInsert = {
  id: 'txn-base',
  accountId: ACCOUNT_ID,
  transactionDate: '2026-02-10',
  payee: 'Utility provider',
  merchant: 'Utility provider',
  memo: 'monthly service',
  transactionType: 'charge',
  amount: -450_000,
  outflow: 450_000,
  inflow: 0,
  status: 'posted',
  verificationLevel: 'parser',
};

beforeEach(() => {
  store = openTestStore('nizam-txns-');
  createAccountsRepository(store.ctx).insert({
    id: ACCOUNT_ID,
    name: 'Everyday account',
    type: 'BANK_OTHER',
    onBudget: true,
    balance: 0,
    clearedBalance: 0,
    creditLimit: null,
    accountIdentifierLast4: '4321',
  });
  transactions = createTransactionsRepository(store.ctx);
});

afterEach(() => {
  store.close();
});

describe('transactionsRepository — round-trip (§9 T6, R2)', () => {
  it('T6 preserves amount, outflow, and inflow as the exact integers they were given', () => {
    const written = transactions.insert({
      ...BASE,
      id: 'txn-exact',
      transactionType: 'salary',
      amount: Number.MAX_SAFE_INTEGER,
      outflow: 0,
      inflow: Number.MAX_SAFE_INTEGER,
    });

    expect(written.amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(written.outflow).toBe(0);
    expect(written.inflow).toBe(Number.MAX_SAFE_INTEGER);
    expect(transactions.get('txn-exact')).toEqual(written);
  });

  it('keeps the signed convention: an outflow is negative in amount and positive in outflow', () => {
    const written = transactions.insert(BASE);
    expect(written.amount).toBe(-450_000);
    expect(written.outflow).toBe(450_000);
    expect(written.inflow).toBe(0);
    expect(transactions.get(BASE.id)).toEqual(written);
  });

  it('preserves the non-monetary facts, the defaults, and the lineage of a first row', () => {
    const written = transactions.insert({ ...BASE, id: 'txn-defaults', payee: undefined, memo: undefined });
    expect(written.payee).toBe('');
    expect(written.memo).toBe('');
    expect(written.currency).toBe('EGP');
    expect(written.categoryId).toBeNull();
    expect(written.duplicateKey).toBeNull();
    // An ordinary insert can never claim to supersede anything.
    expect(written.supersedesTransactionId).toBeNull();
    expect(written.auditVersion).toBe(1);
  });
});

describe('transactionsRepository — reads', () => {
  it('filters a register by date and hides superseded rows unless asked', () => {
    transactions.insert({ ...BASE, id: 'txn-jan', transactionDate: '2026-01-05' });
    transactions.insert({ ...BASE, id: 'txn-feb', transactionDate: '2026-02-05' });
    transactions.insert({ ...BASE, id: 'txn-mar', transactionDate: '2026-03-05' });

    expect(transactions.listForAccount(ACCOUNT_ID).map((t) => t.id)).toEqual(['txn-jan', 'txn-feb', 'txn-mar']);
    expect(
      transactions.listForAccount(ACCOUNT_ID, { from: '2026-02-01', to: '2026-02-28' }).map((t) => t.id),
    ).toEqual(['txn-feb']);
    expect(transactions.listForAccount('acct-other')).toEqual([]);
  });

  it('finds every row carrying a duplicate key, superseded ones included', () => {
    transactions.insert({ ...BASE, id: 'txn-first', duplicateKey: 'key-alpha' });
    transactions.insert({ ...BASE, id: 'txn-second', duplicateKey: 'key-alpha' });
    transactions.insert({ ...BASE, id: 'txn-unrelated', duplicateKey: 'key-beta' });

    expect(transactions.findByDuplicateKey('key-alpha').map((t) => t.id)).toEqual(['txn-first', 'txn-second']);
    expect(transactions.findByDuplicateKey('key-absent')).toEqual([]);
  });
});

describe('transactionsRepository — correction by superseding row (§8.1)', () => {
  it('appends the replacement and leaves the predecessor its own facts', () => {
    const original = transactions.insert(BASE);
    const result = transactions.supersede(original.id, {
      ...BASE,
      id: 'txn-corrected',
      amount: -455_000,
      outflow: 455_000,
      memo: 'corrected against the statement',
      verificationLevel: 'statement',
    });

    // The replacement points back, and its audit version is one higher.
    expect(result.replacement.supersedesTransactionId).toBe(original.id);
    expect(result.replacement.auditVersion).toBe(original.auditVersion + 1);
    expect(result.replacement.amount).toBe(-455_000);

    // The predecessor's monetary columns, date, and payee are untouched. Only its
    // persistence status moved, so derived balances stop counting it while the row stays
    // readable forever.
    expect(result.superseded.amount).toBe(original.amount);
    expect(result.superseded.outflow).toBe(original.outflow);
    expect(result.superseded.transactionDate).toBe(original.transactionDate);
    expect(result.superseded.payee).toBe(original.payee);
    expect(result.superseded.status).toBe('superseded');

    // Nothing was deleted: the register hides the predecessor, an audit read still sees it.
    expect(transactions.listForAccount(ACCOUNT_ID).map((t) => t.id)).toEqual(['txn-corrected']);
    expect(transactions.listForAccount(ACCOUNT_ID, { includeSuperseded: true }).map((t) => t.id).sort()).toEqual([
      'txn-base',
      'txn-corrected',
    ]);
    expect(transactions.get(original.id)).not.toBeNull();

    // The correction is recorded as a link at full confidence, in integer basis points.
    expect(result.link.linkType).toBe('correction');
    expect(result.link.confidenceBps).toBe(10_000);
    expect(transactions.listLinks(original.id).map((l) => l.id)).toEqual([result.link.id]);
  });

  it('refuses a second correction of the same row rather than forking the chain', () => {
    const original = transactions.insert(BASE);
    transactions.supersede(original.id, { ...BASE, id: 'txn-first-fix' });

    try {
      transactions.supersede(original.id, { ...BASE, id: 'txn-second-fix' });
      expect.unreachable('a second correction of the same predecessor must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryStateError);
      expect((error as RepositoryStateError).code).toBe('REPOSITORY_ROW_ALREADY_SUPERSEDED');
    }
    // The refusal rolled the whole attempt back: no second replacement, no second link.
    expect(transactions.get('txn-second-fix')).toBeNull();
    expect(transactions.listLinks(original.id)).toHaveLength(1);
  });

  it('refuses to correct a row that is not there', () => {
    expect(() => transactions.supersede('txn-absent', BASE)).toThrow(RepositoryStateError);
    expect(transactions.get(BASE.id)).toBeNull();
  });
});

describe('transactionsRepository — a suspicion is recorded, never resolved by deletion', () => {
  it('records a suspected duplicate and settles it without removing either row', () => {
    const first = transactions.insert({ ...BASE, id: 'txn-original', duplicateKey: 'key-alpha' });
    const second = transactions.insert({ ...BASE, id: 'txn-suspect', duplicateKey: 'key-alpha' });

    const link = transactions.recordLink({
      id: 'link-suspicion',
      fromTransactionId: second.id,
      toTransactionId: first.id,
      linkType: 'suspected_duplicate',
      confidenceBps: 9_200,
    });
    expect(link.confidenceBps).toBe(9_200);
    expect(link.resolution).toBeNull();
    expect(link.resolvedAt).toBeNull();

    const resolved = transactions.resolveLink(link.id, 'confirmed');
    expect(resolved.resolution).toBe('confirmed');
    expect(resolved.resolvedAt).not.toBeNull();

    // Both transactions are still there. Confirming a duplicate records a judgement; it
    // does not destroy a financial record.
    expect(transactions.get(first.id)).not.toBeNull();
    expect(transactions.get(second.id)).not.toBeNull();
  });

  it('refuses a link that names a transaction the store does not hold', () => {
    transactions.insert(BASE);
    expect(() =>
      transactions.recordLink({
        id: 'link-dangling',
        fromTransactionId: BASE.id,
        toTransactionId: 'txn-absent',
        linkType: 'suspected_duplicate',
      }),
    ).toThrow(RepositoryStateError);
    expect(transactions.listLinks(BASE.id)).toEqual([]);
  });
});
