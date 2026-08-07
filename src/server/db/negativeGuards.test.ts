// @vitest-environment node
/**
 * NIZAM · Phase 1 negative guards — contract 06 §9 T2, T5, T8, T18
 * Implemented by: PFOS Contract 06 / Phase 1.5 (spec 06-two-agent-vps)
 * Depends on: paths.ts, migrations.ts, connection.ts, repositories/*, ../errors.ts
 *
 * Contract 06 §9: "a test that has only ever been observed passing is not evidence; each
 * guard must be shown REFUSING the guarded operation." Phase 1.5 closes the places where
 * Phases 1.1-1.3 asserted a guard's existence without ever exercising its refusal. It
 * deliberately does NOT restate what those phases already assert — every case below covers
 * something no other test in this tier covers:
 *
 *  T5  The money boundary is shown refusing at EVERY repository write path, not only at the
 *      two (`decisions`, `fx_rates`) that had negative cases. §4.2.3 puts the guard before
 *      the statement is prepared, and that ordering is a per-call-site property: a new write
 *      path can forget it without breaking any existing test, so each path needs its own
 *      refusal on record.
 *  T8  A re-run applies zero migrations AND executes zero statements. The existing T8 proves
 *      the schema is unchanged, but every real migration statement is written defensively
 *      (`IF NOT EXISTS`, §5.2.3), so a re-executed statement would be invisible to a schema
 *      comparison. §5.2.2 makes the stronger claim — "skipped WITHOUT EXECUTING A SINGLE
 *      STATEMENT" — and only a non-idempotent statement can prove it.
 *  T2  A symlink out of the data directory is refused. `paths.ts` documents containment
 *      rather than pattern matching, and names the symlink case explicitly; nothing had
 *      exercised it, so the strongest sentence in that module was the untested one.
 *  T18 A caller cannot assign the DERIVED `superseded` outcome (§3.2 ADDENDUM A1).
 *
 * The container/namespace belt for cross-agent isolation — the peer's volume is not in this
 * process's mount namespace at all — is contract 12 §3.2.1 and is an OPS control. It is not
 * testable in process by construction, and is deliberately not simulated here.
 *
 * Every figure below is synthetic. No real amount, account, or deployment particular appears.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type StoreHandle } from './connection';
import { MonetaryBoundaryError, RepositoryStateError, StorePathError } from './errors';
import { migrate, MIGRATIONS, type Migration } from './migrations';
import { resolveStorePath } from './paths';
import {
  createAccountsRepository,
  createDecisionsRepository,
  createObligationsRepository,
  createTransactionsRepository,
  type AccountInsert,
  type DecisionInsert,
  type ObligationInsert,
  type TransactionInsert,
} from './repositories';
import { openTestStore, type TestStore } from './repositories/testStore';

/**
 * The shapes an upstream parse mistake actually arrives in. Each is a value the guard must
 * refuse outright: nothing here is rounded, truncated, or coerced (§4.2).
 */
const NON_INTEGERS: readonly { readonly label: string; readonly value: unknown }[] = [
  { label: 'a fractional milliunit', value: 0.5 }, // invalid: must be rejected, never rounded
  { label: 'a decimal string', value: '1000' },
  { label: 'null where a value is required', value: null },
  { label: 'NaN', value: Number.NaN },
  { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  { label: 'beyond safe-integer precision', value: Number.MAX_SAFE_INTEGER + 2 },
];

const ACCOUNT_ID = 'acct-under-test';

const ACCOUNT: AccountInsert = {
  id: ACCOUNT_ID,
  name: 'Everyday account',
  type: 'BANK_OTHER',
  onBudget: true,
  balance: 1_000_000,
  clearedBalance: 1_000_000,
  creditLimit: null,
  accountIdentifierLast4: '4321',
};

const TRANSACTION: TransactionInsert = {
  id: 'txn-guarded',
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

const OBLIGATION: ObligationInsert = {
  id: 'obl-guarded',
  accountId: null,
  name: 'Card statement',
  kind: 'card_minimum',
  amount: 2_500_000,
  minimumAmount: 250_000,
  dueDate: '2026-03-15',
  graceDate: null,
  recurrence: 'monthly',
  status: 'scheduled',
  priority: 'P1',
};

const DECISION: DecisionInsert = {
  id: 'dec-guarded',
  decidedAt: '2026-02-01T00:00:00.000Z',
  kind: 'purchase',
  rationale: 'synthetic fixture',
  expectedEffectMilliunits: -750_000,
  observedEffectMilliunits: null,
};

/** Rows in one table, so a refusal can be shown to have written nothing at all. */
function rowCount(store: TestStore, table: string): number {
  return Number((store.ctx.handle.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
}

// ---------------------------------------------------------------------------
// T5 — the money boundary refuses at EVERY write path (§4.2, §9 T5, R2)
// ---------------------------------------------------------------------------

describe('T5 the money guard refuses at every repository write path (§4.2.3)', () => {
  let store: TestStore;

  beforeEach(() => {
    store = openTestStore('nizam-neg-money-');
  });

  afterEach(() => {
    store.close();
  });

  /**
   * One refusal, fully checked: the error is typed, it names the table and the offending
   * column on the object rather than only in prose, and NOTHING landed — not the row, and
   * not an audit entry either, because the guard ran before any statement was prepared.
   */
  function expectRefusal(
    attempt: () => unknown,
    expected: { readonly table: string; readonly field: string },
  ): void {
    const auditBefore = rowCount(store, 'audit_log');
    const rowsBefore = rowCount(store, expected.table);
    try {
      attempt();
      expect.unreachable(`${expected.table}.${expected.field} must be refused at the boundary`);
    } catch (error) {
      expect(error).toBeInstanceOf(MonetaryBoundaryError);
      const typed = error as MonetaryBoundaryError;
      expect(typed.code).toBe('MONETARY_VALUE_NOT_INTEGER');
      expect(typed.table).toBe(expected.table);
      expect(typed.field).toBe(expected.field);
    }
    expect(rowCount(store, expected.table)).toBe(rowsBefore);
    expect(rowCount(store, 'audit_log')).toBe(auditBefore);
  }

  describe('accounts', () => {
    for (const { label, value } of NON_INTEGERS) {
      it(`refuses ${label} in balance on insert, and writes nothing`, () => {
        const accounts = createAccountsRepository(store.ctx);
        expectRefusal(() => accounts.insert({ ...ACCOUNT, balance: value as never }), {
          table: 'accounts',
          field: 'balance',
        });
      });
    }

    it('refuses a non-integer cleared balance, naming that column and not the first one', () => {
      const accounts = createAccountsRepository(store.ctx);
      expectRefusal(() => accounts.insert({ ...ACCOUNT, clearedBalance: 0.25 as never }), {
        table: 'accounts',
        field: 'cleared_balance',
      });
    });

    it('refuses a non-integer in the NULLABLE credit limit: nullable is not approximate', () => {
      const accounts = createAccountsRepository(store.ctx);
      expectRefusal(() => accounts.insert({ ...ACCOUNT, creditLimit: 5_000_000.5 as never }), {
        table: 'accounts',
        field: 'credit_limit',
      });
    });

    it('refuses a non-integer on the UPDATE path, leaving the stored balances untouched', () => {
      const accounts = createAccountsRepository(store.ctx);
      accounts.insert(ACCOUNT);
      expectRefusal(
        () => accounts.updateBalances(ACCOUNT_ID, { balance: 1.5 as never, clearedBalance: 0 }), // invalid: rejects a float
        { table: 'accounts', field: 'balance' },
      );
      // The row is still exactly as inserted: a refused update is not a partial update.
      expect(accounts.get(ACCOUNT_ID)?.balance).toBe(ACCOUNT.balance);
      expect(accounts.get(ACCOUNT_ID)?.clearedBalance).toBe(ACCOUNT.clearedBalance);
    });
  });

  describe('transactions', () => {
    beforeEach(() => {
      createAccountsRepository(store.ctx).insert(ACCOUNT);
    });

    for (const column of ['amount', 'outflow', 'inflow'] as const) {
      it(`refuses a non-integer ${column} on insert, and writes nothing`, () => {
        const transactions = createTransactionsRepository(store.ctx);
        const bad: Record<string, unknown> = { amount: -1.5, outflow: 1.5, inflow: 0.5 }; // invalid: rejects a float
        expectRefusal(() => transactions.insert({ ...TRANSACTION, [column]: bad[column] } as never), {
          table: 'transactions',
          field: column,
        });
      });
    }

    it('refuses a non-integer on the CORRECTION path and leaves the predecessor current', () => {
      const transactions = createTransactionsRepository(store.ctx);
      transactions.insert(TRANSACTION);

      expectRefusal(
        () =>
          transactions.supersede(TRANSACTION.id, {
            ...TRANSACTION,
            id: 'txn-bad-successor',
            amount: -450_000.25 as never,
          }),
        { table: 'transactions', field: 'amount' },
      );

      // The predecessor was not moved to 'superseded' and the successor does not exist, so a
      // refused correction cannot leave the register with no current row for the fact.
      expect(transactions.get('txn-bad-successor')).toBeNull();
      expect(transactions.get(TRANSACTION.id)?.status).toBe('posted');
      expect(rowCount(store, 'transaction_links')).toBe(0);
    });
  });

  describe('obligations', () => {
    it('refuses a non-integer amount on insert, and writes nothing', () => {
      const obligations = createObligationsRepository(store.ctx);
      expectRefusal(() => obligations.insert({ ...OBLIGATION, amount: 2_500_000.5 as never }), {
        table: 'obligations',
        field: 'amount',
      });
    });

    it('refuses a non-integer minimum, which is the figure a reserve is computed from', () => {
      const obligations = createObligationsRepository(store.ctx);
      expectRefusal(() => obligations.insert({ ...OBLIGATION, minimumAmount: 250_000.5 as never }), {
        table: 'obligations',
        field: 'minimum_amount',
      });
    });

    it('refuses a non-integer re-statement, leaving the previously stated amounts', () => {
      const obligations = createObligationsRepository(store.ctx);
      obligations.insert(OBLIGATION);
      expectRefusal(
        () => obligations.reviseAmounts(OBLIGATION.id, { amount: 0.75 as never, minimumAmount: null }), // invalid: rejects a float
        { table: 'obligations', field: 'amount' },
      );
      expect(obligations.get(OBLIGATION.id)?.amount).toBe(OBLIGATION.amount);
      expect(obligations.get(OBLIGATION.id)?.minimumAmount).toBe(OBLIGATION.minimumAmount);
    });
  });
});

// ---------------------------------------------------------------------------
// T18 — a derived state is not assignable (§3.2 ADDENDUM A1)
// ---------------------------------------------------------------------------

describe('T18 decisions.outcome cannot be assigned the derived state (§3.2 ADDENDUM A1)', () => {
  let store: TestStore;

  beforeEach(() => {
    store = openTestStore('nizam-neg-derived-');
  });

  afterEach(() => {
    store.close();
  });

  it('refuses a caller that self-declares the outcome the lineage derives, and writes nothing', () => {
    const decisions = createDecisionsRepository(store.ctx);
    try {
      // Reachable only through `unknown`, because the insert type excludes it — which is the
      // point: the compile-time narrowing and the run-time guard say the same thing.
      decisions.insert({ ...DECISION, outcome: 'superseded' } as unknown as DecisionInsert);
      expect.unreachable('a caller must not be able to assign a derived state');
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryStateError);
      const typed = error as RepositoryStateError;
      expect(typed.code).toBe('REPOSITORY_DERIVED_STATE_NOT_ASSIGNABLE');
      expect(typed.table).toBe('decisions');
      expect(typed.rowId).toBe(DECISION.id);
      expect(typed.message).toMatch(/derived/i);
    }
    expect(decisions.get(DECISION.id)).toBeNull();
    expect(rowCount(store, 'audit_log')).toBe(0);
  });

  it('refuses it on the supersede path too, so the successor cannot claim it either', () => {
    const decisions = createDecisionsRepository(store.ctx);
    decisions.insert(DECISION);
    expect(() =>
      decisions.supersede(DECISION.id, {
        ...DECISION,
        id: 'dec-successor',
        outcome: 'superseded',
      } as unknown as DecisionInsert),
    ).toThrow(RepositoryStateError);

    expect(decisions.get('dec-successor')).toBeNull();
    expect(decisions.successorOf(DECISION.id)).toBeNull();
  });

  it('accepts every assignable state, so the guard is a narrowing and not a blanket refusal', () => {
    const decisions = createDecisionsRepository(store.ctx);
    for (const outcome of ['pending', 'confirmed', 'reverted'] as const) {
      const row = decisions.insert({ ...DECISION, id: `dec-${outcome}`, outcome });
      expect(row.outcome).toBe(outcome);
    }
  });

  it('reads the derived state back when a store already holds it, because history is not refused', () => {
    // §3.2 ADDENDUM A1: the DDL's CHECK still admits the value and an applied migration is
    // never edited (§5.1), so a store repaired by hand may carry it. Writing is refused;
    // READING is not, and a mapper that threw on it would make such a store unreadable.
    const decisions = createDecisionsRepository(store.ctx);
    store.ctx.handle.db
      .prepare(
        `INSERT INTO decisions (id, decided_at, kind, rationale, expected_effect_milliunits,
                                observed_effect_milliunits, outcome, supersedes_decision_id, audit_version)
         VALUES ('dec-legacy', '2026-01-01T00:00:00.000Z', 'purchase', '', NULL, NULL, 'superseded', NULL, 1)`,
      )
      .run();
    expect(decisions.get('dec-legacy')?.outcome).toBe('superseded');
  });
});

// ---------------------------------------------------------------------------
// T8 — a re-run executes ZERO statements, not merely zero visible changes (§5.2.2)
// ---------------------------------------------------------------------------

describe('T8 a migration re-run executes zero statements (§5.2.2, R3)', () => {
  let dataDir: string;
  let handle: StoreHandle;
  const now = (): string => '2026-01-01T00:00:00.000Z';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'nizam-neg-migrate-'));
    handle = openStore({ dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000 });
  });

  afterEach(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('skips by recorded version, proven by a statement that could not survive re-execution', () => {
    // Every statement in the real series is written defensively (§5.2.3), so re-executing it
    // would change nothing observable and a schema comparison could not tell the difference.
    // This series is deliberately NOT defensive: the CREATE has no IF NOT EXISTS and the
    // INSERT would violate the primary key. If the migrator executed a single statement of an
    // already-applied migration, this second call would throw.
    const series: readonly Migration[] = [
      {
        version: 1,
        name: 'not_idempotent_on_purpose',
        statements: [
          'CREATE TABLE t_once (id TEXT PRIMARY KEY) STRICT',
          `INSERT INTO t_once (id) VALUES ('only-once')`,
        ],
      },
    ];

    expect(migrate(handle, { migrations: series, now }).applied).toEqual([1]);

    const second = migrate(handle, { migrations: series, now });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual([1]);
    // The one row is still one row: the INSERT did not run a second time either.
    expect(handle.db.prepare('SELECT COUNT(*) AS n FROM t_once').get()).toEqual({ n: 1 });
  });

  it('preserves stored data across a re-run, so "no-op" covers rows and not only schema', () => {
    migrate(handle, { now });
    handle.db
      .prepare(
        `INSERT INTO accounts (id, name, type, balance, cleared_balance, created_at, updated_at)
         VALUES ('acct-kept', 'Everyday account', 'BANK_OTHER', 1000, 1000, ?, ?)`,
      )
      .run(now(), now());

    expect(migrate(handle, { now }).applied).toEqual([]);

    expect(handle.db.prepare('SELECT balance FROM accounts WHERE id = ?').get('acct-kept')).toEqual({
      balance: 1000,
    });
    expect(handle.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({
      n: MIGRATIONS.length,
    });
  });
});

// ---------------------------------------------------------------------------
// T2 — containment, not pattern matching: a symlink escape is refused (§2.1.2)
// ---------------------------------------------------------------------------

describe('T2 a symlink out of the data directory is refused (§2.1.2, R1/R6)', () => {
  let root: string;
  let dataDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nizam-neg-path-'));
    dataDir = join(root, 'finance');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(root, 'peer'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses a store path that reaches the peer directory through a link inside its own', () => {
    // The nastiest shape of a cross-agent open, and the one a string check misses: every
    // segment of the requested path looks local. `paths.ts` canonicalizes the parent before
    // testing containment, which is the line this exercises — it was the module's strongest
    // documented claim and the only one with no test behind it.
    const link = join(dataDir, 'linked');
    try {
      symlinkSync(join(root, 'peer'), link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      // A sandbox that forbids link creation cannot host this assertion. Fail loudly rather
      // than passing silently: a skipped guard test is the thing §9 warns about.
      throw new Error(
        `this assertion needs to create a directory link and could not: ${String(error)}`,
      );
    }

    try {
      resolveStorePath(dataDir, join('linked', 'peer.db'));
      expect.unreachable('a path that resolves outside the data directory must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(StorePathError);
      const typed = error as StorePathError;
      expect(typed.code).toBe('STORE_PATH_ESCAPES_DATA_DIR');
      expect(typed.resolved).not.toBeNull();
      // The refusal names where it actually landed, which is the only useful diagnostic here.
      expect(typed.resolved).toContain('peer');
    }
  });

  it('still accepts a real file beside the link, so containment is not a denylist', () => {
    expect(resolveStorePath(dataDir, 'finance.db')).toBe(join(dataDir, 'finance.db'));
  });
});
