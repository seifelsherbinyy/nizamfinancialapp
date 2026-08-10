/**
 * NIZAM · statements repository — a period closes on arithmetic, or on a stated exception
 * Implemented by: PFOS Contract 06 / Phase 2.2 (spec 08-knowledge-ingestion, wave A2, task A2.5)
 * Depends on: ../moneyBoundary.ts, ../errors.ts, rows.ts, support.ts
 *
 * A2.5: "A statement whose totals do not satisfy the balance equation is recorded with its close state
 * as an accepted exception AND a reason, never silently balanced."
 *
 * So the close state is DERIVED here and is not a field a caller may set. The equation is
 *
 *     opening_balance + total_inflow - total_outflow == closing_balance
 *
 * in integer milliunits, which means it is exact: there is no tolerance, because there is no rounding
 * anywhere in it to justify one. A period that satisfies it closes `balanced`. A period that does not
 * closes `exception_accepted` and MUST carry a reason code — a caller that offers no reason gets a
 * refusal rather than a silently accepted exception, which is the only version of this rule that is
 * worth anything.
 *
 * The reason is a CODE and never the residual. A residual is a real monetary amount, and
 * `close_exception_reason` is a text column outside the §4.2 guard; the magnitude belongs in the
 * gitignored reconciliation artifact where wave A3 puts it.
 */
import { assertMonetaryCoverage, assertMoneyField, assertOptionalMoneyField } from '../moneyBoundary.ts';
import { IngestionRefusalError, RepositoryStateError } from '../errors.ts';
import type { Money } from './rows.ts';
import { recordAudit, toNullableText, withTransaction, type RepositoryContext } from './support.ts';

const TABLE = 'statements';

/** Every monetary column of `statements`, named once for the coverage assertion. */
const MONEY_FIELDS = ['opening_balance', 'closing_balance', 'total_outflow', 'total_inflow', 'minimum_due'] as const;

export const STATEMENT_CLOSE_STATES = ['open', 'balanced', 'exception_accepted'] as const;
export type StatementCloseState = (typeof STATEMENT_CLOSE_STATES)[number];

export interface StatementRow {
  readonly id: string;
  readonly accountId: string;
  readonly statementMonth: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalance: Money;
  readonly closingBalance: Money;
  readonly totalOutflow: Money;
  readonly totalInflow: Money;
  readonly minimumDue: Money | null;
  readonly closeState: StatementCloseState;
  readonly closedAt: string | null;
  readonly closeExceptionReason: string | null;
}

export interface StatementRecord {
  readonly id: string;
  readonly accountId: string;
  readonly statementMonth: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalance: Money;
  readonly closingBalance: Money;
  readonly totalOutflow: Money;
  readonly totalInflow: Money;
  readonly minimumDue?: Money | null;
  /**
   * Required when the balance equation does not hold, and ignored when it does. A code, not a number:
   * `balance_equation_residual_nonzero` is a reason; the residual itself is a monetary value.
   */
  readonly exceptionReason?: string | null;
}

/** What the period's arithmetic decided, so a caller can report it without recomputing it. */
export interface StatementCloseVerdict {
  readonly row: StatementRow;
  readonly balanced: boolean;
}

export interface StatementsRepository {
  /** Record a period. The close state is derived from the equation and cannot be passed in. */
  record(entry: StatementRecord): StatementCloseVerdict;
  get(id: string): StatementRow | null;
  listForAccount(accountId: string): StatementRow[];
  countByCloseState(state: StatementCloseState): number;
}

function mapRow(raw: Record<string, unknown>): StatementRow {
  const minimum = raw['minimum_due'];
  return {
    id: String(raw['id']),
    accountId: String(raw['account_id']),
    statementMonth: String(raw['statement_month']),
    periodStart: String(raw['period_start']),
    periodEnd: String(raw['period_end']),
    openingBalance: Number(raw['opening_balance']),
    closingBalance: Number(raw['closing_balance']),
    totalOutflow: Number(raw['total_outflow']),
    totalInflow: Number(raw['total_inflow']),
    minimumDue: minimum === null || minimum === undefined ? null : Number(minimum),
    closeState: String(raw['close_state']) as StatementCloseState,
    closedAt: toNullableText(raw['closed_at']),
    closeExceptionReason: toNullableText(raw['close_exception_reason']),
  };
}

/**
 * The balance equation, in integer milliunits. Exported because wave A3 checks the same identity from
 * outside the store, and two implementations of one equation is how the two answers diverge.
 */
export function balanceEquationResidual(entry: {
  openingBalance: Money;
  closingBalance: Money;
  totalInflow: Money;
  totalOutflow: Money;
}): Money {
  return entry.openingBalance + entry.totalInflow - entry.totalOutflow - entry.closingBalance;
}

export function createStatementsRepository(ctx: RepositoryContext): StatementsRepository {
  const { db } = ctx.handle;

  const readOne = (id: string): StatementRow | null => {
    const raw = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return raw ? mapRow(raw) : null;
  };

  const requireOne = (id: string): StatementRow => {
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
    record(entry: StatementRecord): StatementCloseVerdict {
      // The guard runs first, and it accounts for every monetary column of the table.
      assertMonetaryCoverage(TABLE, MONEY_FIELDS);
      const openingBalance = assertMoneyField(TABLE, 'opening_balance', entry.openingBalance);
      const closingBalance = assertMoneyField(TABLE, 'closing_balance', entry.closingBalance);
      const totalOutflow = assertMoneyField(TABLE, 'total_outflow', entry.totalOutflow);
      const totalInflow = assertMoneyField(TABLE, 'total_inflow', entry.totalInflow);
      const minimumDue = assertOptionalMoneyField(TABLE, 'minimum_due', entry.minimumDue);

      const residual = balanceEquationResidual({ openingBalance, closingBalance, totalInflow, totalOutflow });
      const balanced = residual === 0;
      const reason = (entry.exceptionReason ?? '').trim();
      if (!balanced && reason === '') {
        throw new IngestionRefusalError(
          'INGEST_STATEMENT_EXCEPTION_WITHOUT_REASON',
          `NIZAM store: a statement period whose totals do not satisfy the balance equation may be closed as an accepted exception, but only with a stated reason. Nothing is silently balanced, and no residual is absorbed. Period ${entry.statementMonth}.`,
          { subject: entry.statementMonth },
        );
      }
      const closeState: StatementCloseState = balanced ? 'balanced' : 'exception_accepted';
      const at = ctx.now();

      return withTransaction(db, () => {
        db.prepare(
          `INSERT INTO ${TABLE}
             (id, account_id, statement_month, period_start, period_end, opening_balance, closing_balance,
              total_outflow, total_inflow, minimum_due, close_state, closed_at, close_exception_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          entry.id,
          entry.accountId,
          entry.statementMonth,
          entry.periodStart,
          entry.periodEnd,
          openingBalance,
          closingBalance,
          totalOutflow,
          totalInflow,
          minimumDue,
          closeState,
          at,
          balanced ? null : reason,
        );
        recordAudit(ctx, {
          action: balanced ? 'statement.close.balanced' : 'statement.close.exceptionAccepted',
          entityTable: TABLE,
          entityId: entry.id,
          detail: balanced ? 'close_state' : `close_state, close_exception_reason=${reason}`,
        });
        return { row: requireOne(entry.id), balanced };
      });
    },

    get(id: string): StatementRow | null {
      return readOne(id);
    },

    listForAccount(accountId: string): StatementRow[] {
      const raws = db
        .prepare(`SELECT * FROM ${TABLE} WHERE account_id = ? ORDER BY statement_month, id`)
        .all(accountId) as Record<string, unknown>[];
      return raws.map(mapRow);
    },

    countByCloseState(state: StatementCloseState): number {
      const raw = db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE close_state = ?`).get(state) as
        | { n: number }
        | undefined;
      return Number(raw?.n ?? 0);
    },
  };
}
