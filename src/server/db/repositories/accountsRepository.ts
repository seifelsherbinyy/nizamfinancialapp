/**
 * NIZAM · accounts repository — contract 06 §3.2, §4.2 (R1, R2)
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: ../moneyBoundary.ts, ../errors.ts, rows.ts, support.ts
 *
 * The reads and writes the Stage 1-4 engines and the server tier actually need: create an
 * account, read one, list the set the budget and net-worth engines work over, and refresh the
 * two derived balance caches. Nothing more — a wider surface would be untested guesswork.
 *
 * Every write asserts its monetary values through the boundary guard BEFORE a statement is
 * prepared (§4.2.3), so a non-integer never reaches SQLite. The guarded values are what get
 * bound; the candidates the caller passed are not used again.
 *
 * A full account number is never persisted. The only identifier column is a last-four
 * fragment, and the DDL constrains its length (§3.2, contract 02 §9).
 */
import { assertMonetaryCoverage, assertMoneyField, assertOptionalMoneyField } from '../moneyBoundary';
import { RepositoryStateError } from '../errors';
import { DEFAULT_CURRENCY, type AccountInsert, type AccountRow, type AccountType, type Money } from './rows';
import {
  fromStoredBoolean,
  recordAudit,
  toNullableText,
  toStoredBoolean,
  withTransaction,
  type RepositoryContext,
} from './support';

const TABLE = 'accounts';

export interface AccountListFilter {
  /** Closed accounts are excluded by default; net-worth history asks for them explicitly. */
  readonly includeClosed?: boolean;
  /** Restrict to accounts that participate in the zero-based budget. */
  readonly onBudgetOnly?: boolean;
}

/** The derived caches a balance refresh writes. Both are guarded before the update runs. */
export interface AccountBalanceUpdate {
  readonly balance: Money;
  readonly clearedBalance: Money;
}

export interface AccountsRepository {
  insert(input: AccountInsert): AccountRow;
  get(id: string): AccountRow | null;
  list(filter?: AccountListFilter): AccountRow[];
  /** Refresh the derived balance caches. Throws a typed error if the account is not there. */
  updateBalances(id: string, update: AccountBalanceUpdate): AccountRow;
}

function mapRow(raw: Record<string, unknown>): AccountRow {
  return {
    id: String(raw['id']),
    name: String(raw['name']),
    type: String(raw['type']) as AccountType,
    currency: String(raw['currency']),
    onBudget: fromStoredBoolean(raw['on_budget']),
    balance: Number(raw['balance']),
    clearedBalance: Number(raw['cleared_balance']),
    creditLimit: raw['credit_limit'] === null || raw['credit_limit'] === undefined ? null : Number(raw['credit_limit']),
    accountIdentifierLast4: toNullableText(raw['account_identifier_last4']),
    closed: fromStoredBoolean(raw['closed']),
    sortOrder: Number(raw['sort_order']),
    createdAt: String(raw['created_at']),
    updatedAt: String(raw['updated_at']),
  };
}

export function createAccountsRepository(ctx: RepositoryContext): AccountsRepository {
  const { db } = ctx.handle;

  const readOne = (id: string): AccountRow | null => {
    const raw = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return raw ? mapRow(raw) : null;
  };

  const requireOne = (id: string): AccountRow => {
    const row = readOne(id);
    if (!row) {
      throw new RepositoryStateError('REPOSITORY_ROW_NOT_FOUND', `NIZAM store: no ${TABLE} row with id ${id}`, {
        table: TABLE,
        rowId: id,
      });
    }
    return row;
  };

  return {
    insert(input: AccountInsert): AccountRow {
      // The guard runs first, and it accounts for every monetary column of the table.
      assertMonetaryCoverage(TABLE, ['balance', 'cleared_balance', 'credit_limit']);
      const balance = assertMoneyField(TABLE, 'balance', input.balance);
      const clearedBalance = assertMoneyField(TABLE, 'cleared_balance', input.clearedBalance);
      const creditLimit = assertOptionalMoneyField(TABLE, 'credit_limit', input.creditLimit);
      const at = ctx.now();

      // Nothing above threw, so a statement may now be prepared.
      return withTransaction(db, () => {
        db.prepare(
          `INSERT INTO ${TABLE}
             (id, name, type, currency, on_budget, balance, cleared_balance, credit_limit,
              account_identifier_last4, closed, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.id,
          input.name,
          input.type,
          input.currency ?? DEFAULT_CURRENCY,
          toStoredBoolean(input.onBudget),
          balance,
          clearedBalance,
          creditLimit,
          input.accountIdentifierLast4,
          toStoredBoolean(input.closed ?? false),
          input.sortOrder ?? 0,
          at,
          at,
        );
        recordAudit(ctx, { action: 'account.insert', entityTable: TABLE, entityId: input.id });
        return requireOne(input.id);
      });
    },

    get(id: string): AccountRow | null {
      return readOne(id);
    },

    list(filter: AccountListFilter = {}): AccountRow[] {
      const clauses: string[] = [];
      if (!filter.includeClosed) clauses.push('closed = 0');
      if (filter.onBudgetOnly) clauses.push('on_budget = 1');
      const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      const raws = db.prepare(`SELECT * FROM ${TABLE}${where} ORDER BY sort_order, id`).all() as Record<
        string,
        unknown
      >[];
      return raws.map(mapRow);
    },

    updateBalances(id: string, update: AccountBalanceUpdate): AccountRow {
      // A partial write guards only the columns it writes, each proven integer first.
      const balance = assertMoneyField(TABLE, 'balance', update.balance);
      const clearedBalance = assertMoneyField(TABLE, 'cleared_balance', update.clearedBalance);
      const at = ctx.now();

      return withTransaction(db, () => {
        requireOne(id);
        db.prepare(`UPDATE ${TABLE} SET balance = ?, cleared_balance = ?, updated_at = ? WHERE id = ?`).run(
          balance,
          clearedBalance,
          at,
          id,
        );
        recordAudit(ctx, {
          action: 'account.updateBalances',
          entityTable: TABLE,
          entityId: id,
          detail: 'balance, cleared_balance',
        });
        return requireOne(id);
      });
    },
  };
}
