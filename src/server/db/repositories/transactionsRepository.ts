/**
 * NIZAM · transactions repository — contract 06 §3.2, §4.2, §8.1 (R1, R2)
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: ../moneyBoundary.ts, ../errors.ts, rows.ts, support.ts
 *
 * Two contract rules shape this surface, and both are structural rather than advisory:
 *
 *  CORRECTION IS BY SUPERSEDING ROW (§8.1). `supersede` INSERTS the corrected row, points it
 *  at its predecessor through `supersedes_transaction_id`, bumps `audit_version`, and moves
 *  the predecessor's `status` to 'superseded' so derived balances stop counting it. The
 *  predecessor's monetary columns, dates, and payee are never altered and the row is never
 *  deleted: history stays legible, which is the whole reason those two columns exist. A
 *  second correction of an already-superseded row is REFUSED rather than allowed to fork the
 *  chain, because two successors would make "the current row" ambiguous.
 *
 *  A SUSPECTED DUPLICATE IS NEVER AUTO-DELETED (contract 02 §5.2, §3.2). There is no delete
 *  on this repository at all. A suspicion is RECORDED in `transaction_links` with a
 *  confidence in integer basis points, and settled later by an explicit resolution that
 *  likewise removes nothing.
 *
 * Every write asserts its monetary values through the boundary guard BEFORE a statement is
 * prepared (§4.2.3). `amount` is signed; `outflow` and `inflow` are non-negative magnitudes
 * (money-rules §4), which the DDL also checks.
 */
import { assertMonetaryCoverage, assertMoneyField } from '../moneyBoundary.ts';
import { RepositoryStateError } from '../errors.ts';
import {
  DEFAULT_CURRENCY,
  type LedgerTransactionType,
  type LinkResolution,
  type TransactionInsert,
  type TransactionLinkInsert,
  type TransactionLinkRow,
  type TransactionLinkType,
  type TransactionRow,
  type TransactionStatus,
  type VerificationLevel,
} from './rows.ts';
import { recordAudit, toNullableText, withTransaction, type RepositoryContext } from './support.ts';

const TABLE = 'transactions';
const LINK_TABLE = 'transaction_links';

/** The monetary columns of `transactions`, named once for the coverage assertion. */
const MONEY_FIELDS = ['amount', 'outflow', 'inflow'] as const;

export interface TransactionListFilter {
  /** Inclusive lower bound on `transaction_date` (ISO date). */
  readonly from?: string;
  /** Inclusive upper bound on `transaction_date` (ISO date). */
  readonly to?: string;
  /** Superseded rows are excluded by default; an audit read asks for them explicitly. */
  readonly includeSuperseded?: boolean;
}

/** What a correction produced: the frozen predecessor and the row that replaces it. */
export interface SupersedeResult {
  readonly superseded: TransactionRow;
  readonly replacement: TransactionRow;
  readonly link: TransactionLinkRow;
}

export interface TransactionsRepository {
  insert(input: TransactionInsert): TransactionRow;
  get(id: string): TransactionRow | null;
  listForAccount(accountId: string, filter?: TransactionListFilter): TransactionRow[];
  /** Dedup lookup. Returns every row already carrying this key, superseded ones included. */
  findByDuplicateKey(duplicateKey: string): TransactionRow[];
  /** Correct a row by appending its replacement. Nothing is edited away and nothing deleted. */
  supersede(originalId: string, replacement: TransactionInsert): SupersedeResult;
  /** Record a relationship between two rows — never a deletion. */
  recordLink(input: TransactionLinkInsert): TransactionLinkRow;
  listLinks(transactionId: string): TransactionLinkRow[];
  /** Settle a recorded suspicion. Removes nothing; only the resolution columns are set. */
  resolveLink(linkId: string, resolution: LinkResolution): TransactionLinkRow;
}

function mapRow(raw: Record<string, unknown>): TransactionRow {
  return {
    id: String(raw['id']),
    accountId: String(raw['account_id']),
    sourceEventId: toNullableText(raw['source_event_id']),
    transactionDate: String(raw['transaction_date']),
    postingDate: toNullableText(raw['posting_date']),
    payee: String(raw['payee']),
    merchant: String(raw['merchant']),
    memo: String(raw['memo']),
    categoryId: toNullableText(raw['category_id']),
    transactionType: String(raw['transaction_type']) as LedgerTransactionType,
    amount: Number(raw['amount']),
    outflow: Number(raw['outflow']),
    inflow: Number(raw['inflow']),
    currency: String(raw['currency']),
    status: String(raw['status']) as TransactionStatus,
    verificationLevel: String(raw['verification_level']) as VerificationLevel,
    supersedesTransactionId: toNullableText(raw['supersedes_transaction_id']),
    auditVersion: Number(raw['audit_version']),
    duplicateKey: toNullableText(raw['duplicate_key']),
    createdAt: String(raw['created_at']),
    updatedAt: String(raw['updated_at']),
  };
}

function mapLinkRow(raw: Record<string, unknown>): TransactionLinkRow {
  const resolution = toNullableText(raw['resolution']);
  return {
    id: String(raw['id']),
    fromTransactionId: String(raw['from_transaction_id']),
    toTransactionId: String(raw['to_transaction_id']),
    linkType: String(raw['link_type']) as TransactionLinkType,
    confidenceBps: Number(raw['confidence_bps']),
    createdAt: String(raw['created_at']),
    resolvedAt: toNullableText(raw['resolved_at']),
    resolution: resolution === null ? null : (resolution as LinkResolution),
  };
}

export function createTransactionsRepository(ctx: RepositoryContext): TransactionsRepository {
  const { db } = ctx.handle;

  const readOne = (id: string): TransactionRow | null => {
    const raw = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return raw ? mapRow(raw) : null;
  };

  const requireOne = (id: string): TransactionRow => {
    const row = readOne(id);
    if (!row) {
      throw new RepositoryStateError('REPOSITORY_ROW_NOT_FOUND', `NIZAM store: no ${TABLE} row with id ${id}`, {
        table: TABLE,
        rowId: id,
      });
    }
    return row;
  };

  const readLink = (id: string): TransactionLinkRow | null => {
    const raw = db.prepare(`SELECT * FROM ${LINK_TABLE} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return raw ? mapLinkRow(raw) : null;
  };

  const requireLink = (id: string): TransactionLinkRow => {
    const row = readLink(id);
    if (!row) {
      throw new RepositoryStateError('REPOSITORY_ROW_NOT_FOUND', `NIZAM store: no ${LINK_TABLE} row with id ${id}`, {
        table: LINK_TABLE,
        rowId: id,
      });
    }
    return row;
  };

  /**
   * The one INSERT statement. `supersedesTransactionId` and `auditVersion` are set by the
   * correction path and by nothing else, so an ordinary insert cannot claim to supersede.
   */
  const insertRow = (
    input: TransactionInsert,
    lineage: { supersedesTransactionId: string | null; auditVersion: number },
  ): TransactionRow => {
    // The guard runs first, and it accounts for every monetary column of the table.
    assertMonetaryCoverage(TABLE, MONEY_FIELDS);
    const amount = assertMoneyField(TABLE, 'amount', input.amount);
    const outflow = assertMoneyField(TABLE, 'outflow', input.outflow);
    const inflow = assertMoneyField(TABLE, 'inflow', input.inflow);
    const at = ctx.now();

    // Nothing above threw, so a statement may now be prepared.
    db.prepare(
      `INSERT INTO ${TABLE}
         (id, account_id, source_event_id, transaction_date, posting_date, payee, merchant, memo,
          category_id, transaction_type, amount, outflow, inflow, currency, status,
          verification_level, supersedes_transaction_id, audit_version, duplicate_key,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.accountId,
      input.sourceEventId ?? null,
      input.transactionDate,
      input.postingDate ?? null,
      input.payee ?? '',
      input.merchant ?? '',
      input.memo ?? '',
      input.categoryId ?? null,
      input.transactionType,
      amount,
      outflow,
      inflow,
      input.currency ?? DEFAULT_CURRENCY,
      input.status,
      input.verificationLevel,
      lineage.supersedesTransactionId,
      lineage.auditVersion,
      input.duplicateKey ?? null,
      at,
      at,
    );
    return requireOne(input.id);
  };

  const insertLink = (input: TransactionLinkInsert): TransactionLinkRow => {
    db.prepare(
      `INSERT INTO ${LINK_TABLE} (id, from_transaction_id, to_transaction_id, link_type, confidence_bps, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(input.id, input.fromTransactionId, input.toTransactionId, input.linkType, input.confidenceBps ?? 0, ctx.now());
    return requireLink(input.id);
  };

  return {
    insert(input: TransactionInsert): TransactionRow {
      return withTransaction(db, () => {
        const row = insertRow(input, { supersedesTransactionId: null, auditVersion: 1 });
        recordAudit(ctx, { action: 'transaction.insert', entityTable: TABLE, entityId: row.id });
        return row;
      });
    },

    get(id: string): TransactionRow | null {
      return readOne(id);
    },

    listForAccount(accountId: string, filter: TransactionListFilter = {}): TransactionRow[] {
      const clauses = ['account_id = ?'];
      const bindings: (string | number)[] = [accountId];
      if (filter.from !== undefined) {
        clauses.push('transaction_date >= ?');
        bindings.push(filter.from);
      }
      if (filter.to !== undefined) {
        clauses.push('transaction_date <= ?');
        bindings.push(filter.to);
      }
      if (!filter.includeSuperseded) clauses.push(`status <> 'superseded'`);
      const raws = db
        .prepare(`SELECT * FROM ${TABLE} WHERE ${clauses.join(' AND ')} ORDER BY transaction_date, id`)
        .all(...bindings) as Record<string, unknown>[];
      return raws.map(mapRow);
    },

    findByDuplicateKey(duplicateKey: string): TransactionRow[] {
      const raws = db
        .prepare(`SELECT * FROM ${TABLE} WHERE duplicate_key = ? ORDER BY transaction_date, id`)
        .all(duplicateKey) as Record<string, unknown>[];
      return raws.map(mapRow);
    },

    supersede(originalId: string, replacement: TransactionInsert): SupersedeResult {
      return withTransaction(db, () => {
        const original = requireOne(originalId);
        if (original.status === 'superseded') {
          throw new RepositoryStateError(
            'REPOSITORY_ROW_ALREADY_SUPERSEDED',
            `NIZAM store: ${TABLE} row ${originalId} has already been superseded. Correct the row that replaced it, so the chain stays single-threaded.`,
            { table: TABLE, rowId: originalId },
          );
        }

        const inserted = insertRow(replacement, {
          supersedesTransactionId: original.id,
          auditVersion: original.auditVersion + 1,
        });

        // The predecessor's facts are untouched; only its persistence status moves, so that
        // derived balances stop counting it while the row itself remains readable forever.
        db.prepare(`UPDATE ${TABLE} SET status = 'superseded', updated_at = ? WHERE id = ?`).run(ctx.now(), original.id);

        const link = insertLink({
          id: ctx.newId(),
          fromTransactionId: inserted.id,
          toTransactionId: original.id,
          linkType: 'correction',
          confidenceBps: 10_000,
        });

        recordAudit(ctx, {
          action: 'transaction.supersede',
          entityTable: TABLE,
          entityId: original.id,
          detail: `replaced by ${inserted.id}; status, updated_at`,
        });
        recordAudit(ctx, {
          action: 'transaction.insert.correction',
          entityTable: TABLE,
          entityId: inserted.id,
          detail: `supersedes ${original.id}`,
        });

        return { superseded: requireOne(original.id), replacement: inserted, link };
      });
    },

    recordLink(input: TransactionLinkInsert): TransactionLinkRow {
      return withTransaction(db, () => {
        requireOne(input.fromTransactionId);
        requireOne(input.toTransactionId);
        const link = insertLink(input);
        recordAudit(ctx, {
          action: 'transactionLink.record',
          entityTable: LINK_TABLE,
          entityId: link.id,
          detail: `${link.linkType}: ${link.fromTransactionId} -> ${link.toTransactionId}`,
        });
        return link;
      });
    },

    listLinks(transactionId: string): TransactionLinkRow[] {
      const raws = db
        .prepare(
          `SELECT * FROM ${LINK_TABLE} WHERE from_transaction_id = ? OR to_transaction_id = ? ORDER BY created_at, id`,
        )
        .all(transactionId, transactionId) as Record<string, unknown>[];
      return raws.map(mapLinkRow);
    },

    resolveLink(linkId: string, resolution: LinkResolution): TransactionLinkRow {
      return withTransaction(db, () => {
        requireLink(linkId);
        db.prepare(`UPDATE ${LINK_TABLE} SET resolution = ?, resolved_at = ? WHERE id = ?`).run(
          resolution,
          ctx.now(),
          linkId,
        );
        recordAudit(ctx, {
          action: 'transactionLink.resolve',
          entityTable: LINK_TABLE,
          entityId: linkId,
          detail: `resolution=${resolution}`,
        });
        return requireLink(linkId);
      });
    },
  };
}
