/**
 * NIZAM · source_events repository — the immutable inbox that makes re-ingestion a no-op
 * Implemented by: PFOS Contract 06 / Phase 2.2 (spec 08-knowledge-ingestion, wave A2, task A2.2)
 * Depends on: ../errors.ts, support.ts
 *
 * Spec 08 §2: "One row per inbound item, with an idempotency key and a content hash, unique on channel
 * plus key. THIS is what makes re-ingestion safe. Running the load twice is a no-op."
 *
 * The idempotence is STRUCTURAL, not procedural. `append` is a conflict-ignoring insert against the
 * DDL's `UNIQUE (channel, idempotency_key)`, so two concurrent loads cannot both win a read-then-write
 * race — a unique index cannot be raced and a check-then-insert can. The caller learns which happened
 * from `appended`, and a second run reports zero appends rather than reporting success twice.
 *
 * The one case that is neither a no-op nor an append is worth naming: the SAME key arriving with
 * DIFFERENT bytes. That is not a duplicate and it is not new — it means the upstream artifact changed
 * under a key that claimed to identify it. The row is left exactly as it was and the disagreement is
 * REPORTED through `contentHashMatches`, because silently keeping either version would be a decision
 * about the owner's data that this layer has no standing to make.
 *
 * Nothing here updates or deletes a row. The table is the append-only record of what arrived; the
 * parse state moves forward, and that is the only mutation this surface offers.
 */
import { RepositoryStateError } from '../errors.ts';
import { recordAudit, toNullableText, withTransaction, type RepositoryContext } from './support.ts';

const TABLE = 'source_events';

/** The DDL's `parse_state` CHECK, restated as a value this tier can hold. */
export const PARSE_STATES = ['pending', 'parsed', 'rejected', 'replayed'] as const;
export type ParseState = (typeof PARSE_STATES)[number];

export interface SourceEventRow {
  readonly id: string;
  readonly receivedAt: string;
  readonly channel: string;
  readonly idempotencyKey: string;
  readonly contentHash: string;
  readonly rawPayload: string | null;
  readonly rawPayloadPrunedAt: string | null;
  readonly parseState: ParseState;
  readonly documentRef: string | null;
}

export interface SourceEventAppend {
  readonly id: string;
  readonly channel: string;
  readonly idempotencyKey: string;
  readonly contentHash: string;
  /**
   * Retained so a parser change can be replayed (§8.2). Optional, and for the tier-1 seed load it is
   * deliberately NOT supplied: the raw payload would be the owner's ledger rows, the store already
   * holds them parsed, and a second copy in a text column is a second place they can leak from.
   */
  readonly rawPayload?: string | null;
  readonly documentRef?: string | null;
}

export interface SourceEventAppendResult {
  readonly row: SourceEventRow;
  /** True when this call created the row. False means the key was already present. */
  readonly appended: boolean;
  /**
   * True when the stored content hash equals the one offered. False can only happen on a non-append,
   * and it means the same key now names different bytes — a finding, never a reason to overwrite.
   */
  readonly contentHashMatches: boolean;
}

export interface SourceEventsRepository {
  append(entry: SourceEventAppend): SourceEventAppendResult;
  get(id: string): SourceEventRow | null;
  findByKey(channel: string, idempotencyKey: string): SourceEventRow | null;
  /** Move the parse state forward. The row's identity, keys and payload are untouched. */
  setParseState(id: string, state: ParseState): SourceEventRow;
  countForChannel(channel: string): number;
}

function mapRow(raw: Record<string, unknown>): SourceEventRow {
  return {
    id: String(raw['id']),
    receivedAt: String(raw['received_at']),
    channel: String(raw['channel']),
    idempotencyKey: String(raw['idempotency_key']),
    contentHash: String(raw['content_hash']),
    rawPayload: toNullableText(raw['raw_payload']),
    rawPayloadPrunedAt: toNullableText(raw['raw_payload_pruned_at']),
    parseState: String(raw['parse_state']) as ParseState,
    documentRef: toNullableText(raw['document_ref']),
  };
}

export function createSourceEventsRepository(ctx: RepositoryContext): SourceEventsRepository {
  const { db } = ctx.handle;

  const readByKey = (channel: string, key: string): SourceEventRow | null => {
    const raw = db.prepare(`SELECT * FROM ${TABLE} WHERE channel = ? AND idempotency_key = ?`).get(channel, key) as
      | Record<string, unknown>
      | undefined;
    return raw ? mapRow(raw) : null;
  };

  const readOne = (id: string): SourceEventRow | null => {
    const raw = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return raw ? mapRow(raw) : null;
  };

  const requireOne = (id: string): SourceEventRow => {
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
    append(entry: SourceEventAppend): SourceEventAppendResult {
      return withTransaction(db, () => {
        const outcome = db
          .prepare(
            `INSERT INTO ${TABLE} (id, received_at, channel, idempotency_key, content_hash, raw_payload, document_ref)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (channel, idempotency_key) DO NOTHING`,
          )
          .run(
            entry.id,
            ctx.now(),
            entry.channel,
            entry.idempotencyKey,
            entry.contentHash,
            entry.rawPayload ?? null,
            entry.documentRef ?? null,
          );
        const appended = Number(outcome.changes) === 1;
        const row = readByKey(entry.channel, entry.idempotencyKey);
        if (!row) {
          // Unreachable: either the insert landed or the conflicting row is there to be read.
          throw new RepositoryStateError(
            'REPOSITORY_ROW_NOT_FOUND',
            `NIZAM store: ${TABLE} neither appended nor found the key it conflicted with`,
            { table: TABLE, rowId: entry.id },
          );
        }
        if (appended) {
          recordAudit(ctx, { action: 'sourceEvent.append', entityTable: TABLE, entityId: row.id });
        }
        return { row, appended, contentHashMatches: row.contentHash === entry.contentHash };
      });
    },

    get(id: string): SourceEventRow | null {
      return readOne(id);
    },

    findByKey(channel: string, idempotencyKey: string): SourceEventRow | null {
      return readByKey(channel, idempotencyKey);
    },

    setParseState(id: string, state: ParseState): SourceEventRow {
      return withTransaction(db, () => {
        requireOne(id);
        db.prepare(`UPDATE ${TABLE} SET parse_state = ? WHERE id = ?`).run(state, id);
        recordAudit(ctx, {
          action: 'sourceEvent.setParseState',
          entityTable: TABLE,
          entityId: id,
          detail: `parse_state=${state}`,
        });
        return requireOne(id);
      });
    },

    countForChannel(channel: string): number {
      const raw = db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE channel = ?`).get(channel) as
        | { n: number }
        | undefined;
      return Number(raw?.n ?? 0);
    },
  };
}
