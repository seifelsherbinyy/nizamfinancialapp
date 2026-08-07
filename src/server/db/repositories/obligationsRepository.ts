/**
 * NIZAM · obligations repository — contract 06 §3.2, §4.2 (R1, R2)
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: ../moneyBoundary.ts, ../errors.ts, rows.ts, support.ts
 *
 * An obligation is a FUTURE commitment with a due date, which is why it is neither a
 * transaction nor a budget target (contract 02 §6, and the same distinction the browser
 * tier draws in `src/features/obligations/`). Safe-to-spend reserves against it, so the
 * only ordering this repository offers is the FUNDING SEQUENCE of contract 01 §5.2:
 * priority tier first, then soonest due, then id so the order is total and stable.
 *
 * `priority` is stored as the INTEGER ordinal of `OBLIGATION_PRIORITIES` — the browser
 * tier's own tuple, whose index IS the harm order — so an integer column sorts in funding
 * order without a lookup table. `rows.ts` owns the two conversions; nothing here converts
 * by hand.
 *
 * Every write asserts its monetary values through the boundary guard BEFORE a statement is
 * prepared (§4.2.3). `amount` is the full amount due and `minimum_amount` the contractual
 * minimum that avoids penalty; the second is nullable because an obligation with no
 * minimum has none, and an absent minimum is never read as zero.
 *
 * The browser `Obligation` carries engine-only fields this table has no column for —
 * penalty, interest in basis points, autopay, verification source, confidence, and the
 * explicit protected reserve. They are inputs to safe-to-spend, not persisted facts of
 * contract 06 §3.2, so they are absent here rather than invented. A later migration may
 * add columns (§5.3 permits additive change); until one does, this row type is the
 * persisted subset and says so.
 */
import { assertMonetaryCoverage, assertMoneyField, assertOptionalMoneyField } from '../moneyBoundary';
import { RepositoryStateError } from '../errors';
import {
  DEFAULT_CURRENCY,
  priorityFromOrdinal,
  priorityOrdinal,
  type Money,
  type ObligationFrequency,
  type ObligationInsert,
  type ObligationRow,
  type ObligationStatus,
} from './rows';
import { recordAudit, toNullableText, withTransaction, type RepositoryContext } from './support';

const TABLE = 'obligations';

/** The monetary columns of `obligations`, named once for the coverage assertion. */
const MONEY_FIELDS = ['amount', 'minimum_amount'] as const;

export interface ObligationListFilter {
  /** Restrict to one lifecycle state. Omitted means every state. */
  readonly status?: ObligationStatus;
  /** Inclusive upper bound on `due_date` (ISO date) — what a reserve window asks for. */
  readonly dueOnOrBefore?: string;
  /** Restrict to the obligations of one liability account. */
  readonly accountId?: string;
}

/** A re-stated amount, e.g. once a statement supplies the real figure. Both guarded. */
export interface ObligationAmountRevision {
  readonly amount: Money;
  readonly minimumAmount: Money | null;
}

export interface ObligationsRepository {
  insert(input: ObligationInsert): ObligationRow;
  get(id: string): ObligationRow | null;
  /** In funding sequence: priority tier, then soonest due, then id (contract 01 §5.2). */
  list(filter?: ObligationListFilter): ObligationRow[];
  /** Move the lifecycle state. Throws a typed error if the obligation is not there. */
  updateStatus(id: string, status: ObligationStatus): ObligationRow;
  /** Re-state the amounts. Guarded first, so a non-integer never reaches the statement. */
  reviseAmounts(id: string, revision: ObligationAmountRevision): ObligationRow;
}

function mapRow(raw: Record<string, unknown>): ObligationRow {
  return {
    id: String(raw['id']),
    accountId: toNullableText(raw['account_id']),
    name: String(raw['name']),
    kind: String(raw['kind']),
    amount: Number(raw['amount']),
    minimumAmount:
      raw['minimum_amount'] === null || raw['minimum_amount'] === undefined ? null : Number(raw['minimum_amount']),
    currency: String(raw['currency']),
    dueDate: String(raw['due_date']),
    graceDate: toNullableText(raw['grace_date']),
    recurrence: String(raw['recurrence']) as ObligationFrequency,
    status: String(raw['status']) as ObligationStatus,
    priority: priorityFromOrdinal(Number(raw['priority'])),
    createdAt: String(raw['created_at']),
    updatedAt: String(raw['updated_at']),
  };
}

export function createObligationsRepository(ctx: RepositoryContext): ObligationsRepository {
  const { db } = ctx.handle;

  const readOne = (id: string): ObligationRow | null => {
    const raw = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return raw ? mapRow(raw) : null;
  };

  const requireOne = (id: string): ObligationRow => {
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
    insert(input: ObligationInsert): ObligationRow {
      // The guard runs first, and it accounts for every monetary column of the table.
      assertMonetaryCoverage(TABLE, MONEY_FIELDS);
      const amount = assertMoneyField(TABLE, 'amount', input.amount);
      const minimumAmount = assertOptionalMoneyField(TABLE, 'minimum_amount', input.minimumAmount);
      const at = ctx.now();

      // Nothing above threw, so a statement may now be prepared.
      return withTransaction(db, () => {
        db.prepare(
          `INSERT INTO ${TABLE}
             (id, account_id, name, kind, amount, minimum_amount, currency, due_date, grace_date,
              recurrence, status, priority, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.id,
          input.accountId ?? null,
          input.name,
          input.kind,
          amount,
          minimumAmount,
          input.currency ?? DEFAULT_CURRENCY,
          input.dueDate,
          input.graceDate ?? null,
          input.recurrence,
          input.status,
          priorityOrdinal(input.priority),
          at,
          at,
        );
        recordAudit(ctx, { action: 'obligation.insert', entityTable: TABLE, entityId: input.id });
        return requireOne(input.id);
      });
    },

    get(id: string): ObligationRow | null {
      return readOne(id);
    },

    list(filter: ObligationListFilter = {}): ObligationRow[] {
      const clauses: string[] = [];
      const bindings: (string | number)[] = [];
      if (filter.status !== undefined) {
        clauses.push('status = ?');
        bindings.push(filter.status);
      }
      if (filter.dueOnOrBefore !== undefined) {
        clauses.push('due_date <= ?');
        bindings.push(filter.dueOnOrBefore);
      }
      if (filter.accountId !== undefined) {
        clauses.push('account_id = ?');
        bindings.push(filter.accountId);
      }
      const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      // The stored ordinal ascends with harm, so this ORDER BY *is* the funding sequence.
      const raws = db
        .prepare(`SELECT * FROM ${TABLE}${where} ORDER BY priority, due_date, id`)
        .all(...bindings) as Record<string, unknown>[];
      return raws.map(mapRow);
    },

    updateStatus(id: string, status: ObligationStatus): ObligationRow {
      const at = ctx.now();
      return withTransaction(db, () => {
        requireOne(id);
        db.prepare(`UPDATE ${TABLE} SET status = ?, updated_at = ? WHERE id = ?`).run(status, at, id);
        recordAudit(ctx, {
          action: 'obligation.updateStatus',
          entityTable: TABLE,
          entityId: id,
          detail: `status=${status}`,
        });
        return requireOne(id);
      });
    },

    reviseAmounts(id: string, revision: ObligationAmountRevision): ObligationRow {
      // A partial write guards only the columns it writes, each proven integer first.
      const amount = assertMoneyField(TABLE, 'amount', revision.amount);
      const minimumAmount = assertOptionalMoneyField(TABLE, 'minimum_amount', revision.minimumAmount);
      const at = ctx.now();

      return withTransaction(db, () => {
        requireOne(id);
        db.prepare(`UPDATE ${TABLE} SET amount = ?, minimum_amount = ?, updated_at = ? WHERE id = ?`).run(
          amount,
          minimumAmount,
          at,
          id,
        );
        recordAudit(ctx, {
          action: 'obligation.reviseAmounts',
          entityTable: TABLE,
          entityId: id,
          detail: 'amount, minimum_amount',
        });
        return requireOne(id);
      });
    },
  };
}
