// @vitest-environment node
/**
 * NIZAM · accounts repository tests — contract 06 §9 T6, §3.4
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: accountsRepository.ts, testStore.ts
 *
 * T6 every monetary column of `accounts` round-trips as the exact integer it was given —
 *    including `Number.MAX_SAFE_INTEGER`, which is the largest value the money core will
 *    accept and therefore the one that would expose any lower-precision path in between.
 *
 * §3.4 the only account-identifier column holds a last-four fragment, and the store itself
 *      refuses a longer one. A full account number is not merely unwritten here; there is
 *      nowhere to put it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepositoryStateError } from '../errors.ts';
import { createAccountsRepository, type AccountsRepository } from './accountsRepository.ts';
import type { AccountInsert } from './rows.ts';
import { openTestStore, type TestStore } from './testStore.ts';

let store: TestStore;
let accounts: AccountsRepository;

const BASE: AccountInsert = {
  id: 'acct-current',
  name: 'Everyday account',
  type: 'BANK_OTHER',
  onBudget: true,
  balance: 1_234_567,
  clearedBalance: 1_200_000,
  creditLimit: null,
  accountIdentifierLast4: '4321',
};

beforeEach(() => {
  store = openTestStore('nizam-accounts-');
  accounts = createAccountsRepository(store.ctx);
});

afterEach(() => {
  store.close();
});

describe('accountsRepository — round-trip (§9 T6, R2)', () => {
  it('T6 preserves every monetary column as the exact integer it was given', () => {
    const written = accounts.insert({
      ...BASE,
      id: 'acct-exact',
      balance: Number.MAX_SAFE_INTEGER,
      clearedBalance: -Number.MAX_SAFE_INTEGER,
      creditLimit: 1,
    });

    expect(written.balance).toBe(Number.MAX_SAFE_INTEGER);
    expect(written.clearedBalance).toBe(-Number.MAX_SAFE_INTEGER);
    expect(written.creditLimit).toBe(1);

    // Read back through a second call, so the assertion covers storage and not just the
    // value the insert happened to be holding.
    const read = accounts.get('acct-exact');
    expect(read).toEqual(written);
  });

  it('keeps a nullable monetary column null rather than reading an absent amount as zero', () => {
    const written = accounts.insert(BASE);
    expect(written.creditLimit).toBeNull();
    expect(accounts.get(BASE.id)?.creditLimit).toBeNull();
  });

  it('round-trips a refreshed balance pair and stamps the injected clock', () => {
    accounts.insert(BASE);
    const updated = accounts.updateBalances(BASE.id, { balance: -8_765_432, clearedBalance: 0 });

    expect(updated.balance).toBe(-8_765_432);
    expect(updated.clearedBalance).toBe(0);
    expect(accounts.get(BASE.id)).toEqual(updated);
    // The row was created before it was updated, and both instants came from the injection.
    expect(updated.updatedAt > updated.createdAt).toBe(true);
    expect(store.instants).toContain(updated.updatedAt);
  });

  it('preserves the non-monetary facts and the flags across the round-trip', () => {
    const written = accounts.insert({
      ...BASE,
      id: 'acct-tracking',
      type: 'TRACKING',
      currency: 'USD',
      onBudget: false,
      closed: true,
      sortOrder: 7,
    });
    expect(written.type).toBe('TRACKING');
    expect(written.currency).toBe('USD');
    expect(written.onBudget).toBe(false);
    expect(written.closed).toBe(true);
    expect(written.sortOrder).toBe(7);
    expect(accounts.get('acct-tracking')).toEqual(written);
  });
});

describe('accountsRepository — reads', () => {
  it('returns null for an id the store does not hold', () => {
    expect(accounts.get('acct-absent')).toBeNull();
  });

  it('excludes closed accounts by default and includes them on request', () => {
    accounts.insert({ ...BASE, id: 'acct-open', sortOrder: 1 });
    accounts.insert({ ...BASE, id: 'acct-closed', sortOrder: 2, closed: true });

    expect(accounts.list().map((a) => a.id)).toEqual(['acct-open']);
    expect(accounts.list({ includeClosed: true }).map((a) => a.id)).toEqual(['acct-open', 'acct-closed']);
  });

  it('restricts to budget participants and orders by the sidebar sort order', () => {
    accounts.insert({ ...BASE, id: 'acct-second', sortOrder: 2 });
    accounts.insert({ ...BASE, id: 'acct-first', sortOrder: 1 });
    accounts.insert({ ...BASE, id: 'acct-tracked', sortOrder: 0, onBudget: false, type: 'TRACKING' });

    expect(accounts.list().map((a) => a.id)).toEqual(['acct-tracked', 'acct-first', 'acct-second']);
    expect(accounts.list({ onBudgetOnly: true }).map((a) => a.id)).toEqual(['acct-first', 'acct-second']);
  });
});

describe('accountsRepository — refusals and the audit trail', () => {
  it('refuses to refresh the balances of an account that is not there, and writes nothing', () => {
    try {
      accounts.updateBalances('acct-absent', { balance: 1, clearedBalance: 1 });
      expect.unreachable('a missing account must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryStateError);
      expect((error as RepositoryStateError).code).toBe('REPOSITORY_ROW_NOT_FOUND');
      expect((error as RepositoryStateError).table).toBe('accounts');
    }
    expect(accounts.list({ includeClosed: true })).toEqual([]);
  });

  it('§3.4 refuses an identifier longer than a last-four fragment', () => {
    // The constraint is in the DDL, so the refusal holds for any path into the store.
    const tooLong = 'longer-than-four';
    expect(() => accounts.insert({ ...BASE, id: 'acct-full', accountIdentifierLast4: tooLong })).toThrow();
    expect(accounts.get('acct-full')).toBeNull();
  });

  it('records one audit row per mutation, naming columns and never an amount', () => {
    accounts.insert(BASE);
    accounts.updateBalances(BASE.id, { balance: 5, clearedBalance: 5 });

    const rows = store.ctx.handle.db
      .prepare('SELECT action, entity_table, entity_id, detail, actor FROM audit_log ORDER BY id')
      .all() as { action: string; entity_table: string; entity_id: string; detail: string; actor: string }[];

    expect(rows.map((r) => r.action)).toEqual(['account.insert', 'account.updateBalances']);
    expect(rows.every((r) => r.entity_table === 'accounts' && r.entity_id === BASE.id)).toBe(true);
    expect(rows.every((r) => r.actor === 'test-actor')).toBe(true);
    expect(rows[1]?.detail).toBe('balance, cleared_balance');
    // The trail states which columns moved, never the figures they moved to.
    expect(rows.some((r) => /\d/.test(r.detail))).toBe(false);
  });
});
