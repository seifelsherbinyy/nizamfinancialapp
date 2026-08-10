// @vitest-environment node
/**
 * NIZAM · obligations repository tests — contract 06 §9 T6, contract 01 §5.2
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: obligationsRepository.ts, accountsRepository.ts, testStore.ts
 *
 * T6    every monetary column of `obligations` round-trips as the exact integer it was
 *       given, and a nullable minimum stays null rather than becoming a zero minimum.
 *
 * §5.2  the harm tier is stored as the ordinal of the browser tier's own priority tuple,
 *       so the default read order IS the funding sequence: tier, then soonest due, then id.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepositoryStateError } from '../errors.ts';
import { createAccountsRepository } from './accountsRepository.ts';
import { createObligationsRepository, type ObligationsRepository } from './obligationsRepository.ts';
import { priorityOrdinal, type ObligationInsert } from './rows.ts';
import { openTestStore, type TestStore } from './testStore.ts';

const ACCOUNT_ID = 'acct-liability';

let store: TestStore;
let obligations: ObligationsRepository;

const BASE: ObligationInsert = {
  id: 'obl-base',
  accountId: ACCOUNT_ID,
  name: 'Card statement',
  kind: 'card_minimum',
  amount: 2_500_000,
  minimumAmount: 250_000,
  dueDate: '2026-03-15',
  graceDate: '2026-03-20',
  recurrence: 'monthly',
  status: 'scheduled',
  priority: 'P1',
};

beforeEach(() => {
  store = openTestStore('nizam-obligations-');
  createAccountsRepository(store.ctx).insert({
    id: ACCOUNT_ID,
    name: 'Revolving line',
    type: 'CREDIT_OTHER',
    onBudget: true,
    balance: -2_500_000,
    clearedBalance: -2_500_000,
    creditLimit: 10_000_000,
    accountIdentifierLast4: '8765',
  });
  obligations = createObligationsRepository(store.ctx);
});

afterEach(() => {
  store.close();
});

describe('obligationsRepository — round-trip (§9 T6, R2)', () => {
  it('T6 preserves amount and minimum_amount as the exact integers they were given', () => {
    const written = obligations.insert({
      ...BASE,
      id: 'obl-exact',
      amount: Number.MAX_SAFE_INTEGER,
      minimumAmount: 1,
    });

    expect(written.amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(written.minimumAmount).toBe(1);
    expect(obligations.get('obl-exact')).toEqual(written);
  });

  it('keeps an absent minimum null rather than reading it as a zero minimum', () => {
    const written = obligations.insert({ ...BASE, id: 'obl-no-minimum', minimumAmount: null });
    expect(written.minimumAmount).toBeNull();
    expect(obligations.get('obl-no-minimum')?.minimumAmount).toBeNull();
  });

  it('preserves the dates, the recurrence, the kind, and the default currency', () => {
    const written = obligations.insert(BASE);
    expect(written.dueDate).toBe('2026-03-15');
    expect(written.graceDate).toBe('2026-03-20');
    expect(written.recurrence).toBe('monthly');
    expect(written.kind).toBe('card_minimum');
    expect(written.currency).toBe('EGP');
    expect(written.accountId).toBe(ACCOUNT_ID);
    expect(obligations.get(BASE.id)).toEqual(written);
  });

  it('round-trips an obligation that belongs to no account', () => {
    const written = obligations.insert({ ...BASE, id: 'obl-informal', accountId: null, kind: 'family_loan' });
    expect(written.accountId).toBeNull();
    expect(obligations.get('obl-informal')).toEqual(written);
  });
});

describe('obligationsRepository — the priority tier survives as an ordinal (§5.2)', () => {
  it('stores the tier as its integer ordinal and reads the tier back', () => {
    const written = obligations.insert({ ...BASE, id: 'obl-p0', priority: 'P0' });
    expect(written.priority).toBe('P0');

    const stored = store.ctx.handle.db.prepare('SELECT priority FROM obligations WHERE id = ?').get('obl-p0') as {
      priority: number;
    };
    expect(stored.priority).toBe(priorityOrdinal('P0'));
    expect(Number.isInteger(stored.priority)).toBe(true);
  });

  it('lists in funding sequence: tier first, then soonest due, then id', () => {
    obligations.insert({ ...BASE, id: 'obl-flexible', priority: 'P3', dueDate: '2026-03-01' });
    obligations.insert({ ...BASE, id: 'obl-critical-late', priority: 'P0', dueDate: '2026-03-28' });
    obligations.insert({ ...BASE, id: 'obl-critical-early', priority: 'P0', dueDate: '2026-03-02' });
    obligations.insert({ ...BASE, id: 'obl-rare', priority: 'P1', dueDate: '2026-03-30' });

    expect(obligations.list().map((o) => o.id)).toEqual([
      'obl-critical-early',
      'obl-critical-late',
      'obl-rare',
      'obl-flexible',
    ]);
  });

  it('filters by lifecycle state, by due window, and by account', () => {
    obligations.insert({ ...BASE, id: 'obl-soon', dueDate: '2026-03-05' });
    obligations.insert({ ...BASE, id: 'obl-later', dueDate: '2026-04-05' });
    obligations.insert({ ...BASE, id: 'obl-settled', dueDate: '2026-03-06', status: 'paid' });
    obligations.insert({ ...BASE, id: 'obl-unlinked', dueDate: '2026-03-07', accountId: null });

    expect(obligations.list({ status: 'paid' }).map((o) => o.id)).toEqual(['obl-settled']);
    expect(obligations.list({ dueOnOrBefore: '2026-03-31' }).map((o) => o.id).sort()).toEqual([
      'obl-settled',
      'obl-soon',
      'obl-unlinked',
    ]);
    expect(obligations.list({ accountId: ACCOUNT_ID }).map((o) => o.id).sort()).toEqual([
      'obl-later',
      'obl-settled',
      'obl-soon',
    ]);
  });
});

describe('obligationsRepository — lifecycle and re-statement', () => {
  it('moves the lifecycle state and stamps the injected clock', () => {
    const written = obligations.insert(BASE);
    const settled = obligations.updateStatus(BASE.id, 'paid');

    expect(settled.status).toBe('paid');
    expect(settled.updatedAt > written.createdAt).toBe(true);
    expect(obligations.get(BASE.id)).toEqual(settled);
  });

  it('round-trips a re-stated amount pair exactly', () => {
    obligations.insert(BASE);
    const revised = obligations.reviseAmounts(BASE.id, { amount: 2_512_345, minimumAmount: null });

    expect(revised.amount).toBe(2_512_345);
    expect(revised.minimumAmount).toBeNull();
    expect(obligations.get(BASE.id)).toEqual(revised);
  });

  it('refuses to touch an obligation that is not there, and writes nothing', () => {
    for (const attempt of [
      (): unknown => obligations.updateStatus('obl-absent', 'paid'),
      (): unknown => obligations.reviseAmounts('obl-absent', { amount: 1, minimumAmount: 1 }),
    ]) {
      try {
        attempt();
        expect.unreachable('a missing obligation must be refused');
      } catch (error) {
        expect(error).toBeInstanceOf(RepositoryStateError);
        expect((error as RepositoryStateError).code).toBe('REPOSITORY_ROW_NOT_FOUND');
        expect((error as RepositoryStateError).table).toBe('obligations');
      }
    }
    expect(obligations.list()).toEqual([]);
  });

  it('records one audit row per mutation, naming columns and never an amount', () => {
    obligations.insert(BASE);
    obligations.updateStatus(BASE.id, 'overdue');
    obligations.reviseAmounts(BASE.id, { amount: 3_000_000, minimumAmount: 300_000 });

    const rows = store.ctx.handle.db
      .prepare(`SELECT action, detail FROM audit_log WHERE entity_table = 'obligations' ORDER BY id`)
      .all() as { action: string; detail: string }[];

    expect(rows.map((r) => r.action)).toEqual([
      'obligation.insert',
      'obligation.updateStatus',
      'obligation.reviseAmounts',
    ]);
    expect(rows[2]?.detail).toBe('amount, minimum_amount');
    expect(rows.some((r) => /\d/.test(r.detail))).toBe(false);
  });
});
