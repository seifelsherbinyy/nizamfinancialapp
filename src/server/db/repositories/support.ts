/**
 * NIZAM · Shared repository plumbing — context, atomicity, audit trail
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: ../connection.ts, ../sqliteBinding.ts, rows.ts
 *
 * Three things every repository in this directory needs, kept here so none of them is
 * re-implemented four times:
 *
 *  1. A CONTEXT. A repository holds the store handle, an injected clock, an injected id
 *     source for its own audit rows, and the actor to attribute writes to. Nothing is
 *     ambient: a repository that read the wall clock or minted its own ids would make its
 *     writes untestable, which is the same reason the migrator takes an injected `now`.
 *  2. ATOMICITY. A write that touches more than one row — a correction, which inserts the
 *     replacement, marks the original, links the two, and records the audit entry — either
 *     lands whole or not at all.
 *  3. THE AUDIT TRAIL. Contract 02 §9 requires an entry for every mutation of a financial
 *     record, written inside the same transaction as the mutation it describes, so an audit
 *     gap is not a reachable state.
 *
 * `detail` on an audit row carries column names and identifiers only. An audit trail that
 * restated the figure would put a monetary value in an unguarded text column, which is
 * exactly what contract 06 §4 exists to prevent.
 */
import { randomUUID } from 'node:crypto';
import type { StoreHandle } from '../connection';
import type { SqliteDatabase } from '../sqliteBinding';

/** Everything a repository is given. Nothing it needs is read from the environment. */
export interface RepositoryContext {
  readonly handle: StoreHandle;
  /** Injected clock, returning an ISO-8601 instant. */
  readonly now: () => string;
  /** Who or what is making the write, recorded on every audit row. */
  readonly actor: string;
  /** Id source for the repository's OWN rows (audit entries); fact ids come from callers. */
  readonly newId: () => string;
}

export interface RepositoryContextConfig {
  readonly handle: StoreHandle;
  readonly now?: () => string;
  readonly actor?: string;
  readonly newId?: () => string;
}

/** Build a context, filling only the parts a caller left to the defaults. */
export function createRepositoryContext(config: RepositoryContextConfig): RepositoryContext {
  return {
    handle: config.handle,
    now: config.now ?? ((): string => new Date().toISOString()),
    actor: config.actor ?? 'finance-server',
    newId: config.newId ?? ((): string => randomUUID()),
  };
}

/**
 * Databases currently inside a transaction opened by `withTransaction`. SQLite has no nested
 * transactions, so a repository method invoked from inside another one joins the open
 * transaction instead of starting a second and failing.
 */
const inTransaction = new WeakSet<SqliteDatabase>();

/** Run `fn` inside a single write transaction, joining one that is already open. */
export function withTransaction<T>(db: SqliteDatabase, fn: () => T): T {
  if (inTransaction.has(db)) return fn();
  db.exec('BEGIN IMMEDIATE');
  inTransaction.add(db);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (cause) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // A failure that already aborted the transaction leaves nothing to roll back.
    }
    throw cause;
  } finally {
    inTransaction.delete(db);
  }
}

export interface AuditEntry {
  readonly action: string;
  readonly entityTable: string;
  readonly entityId: string | null;
  /** Column names and identifiers only. Never an amount. */
  readonly detail?: string;
}

/** Append one `audit_log` row. Called from inside the mutation's own transaction. */
export function recordAudit(ctx: RepositoryContext, entry: AuditEntry): string {
  const id = ctx.newId();
  ctx.handle.db
    .prepare(
      `INSERT INTO audit_log (id, occurred_at, actor, action, entity_table, entity_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ctx.now(), ctx.actor, entry.action, entry.entityTable, entry.entityId, entry.detail ?? '');
  return id;
}

/** SQLite STRICT tables hold booleans as 0 or 1; there is no BOOLEAN storage class. */
export function toStoredBoolean(value: boolean): number {
  return value ? 1 : 0;
}

/** Read a stored 0/1 back as a boolean. */
export function fromStoredBoolean(value: unknown): boolean {
  return Number(value) === 1;
}

/** Read a nullable stored text column back as `string | null` without inventing an empty. */
export function toNullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
