/**
 * NIZAM · document_index repository — the knowledge tier's pointer table
 * Implemented by: PFOS Contract 06 / Phase 2.2 (spec 08-knowledge-ingestion, wave A4)
 * Depends on: ../errors.ts, support.ts
 *
 * A4.1 (K5): one row per accepted document, content hash unique across the table, class assigned,
 * processing state set — and a re-index of the same bytes is a NO-OP rather than a second row.
 *
 * The no-op is structural: `content_hash` is `UNIQUE` in the DDL and `index` is a conflict-ignoring
 * insert against it. So two indexers cannot both win, and a document that moved to a different
 * reference but kept its bytes is recognised as the same document, which is the whole reason the key is
 * the hash and not the reference.
 *
 * A4.2 — ORDERING IS MEANING. The owner's recovery plan is one ordered set across five horizons, from
 * immediate triage to a year of monitoring. An agent that applied the year-long horizon as though it
 * were the immediate one would be giving advice the owner never agreed to, so a set member carries an
 * explicit position, a position is unique within its set (a unique index, so it cannot be raced), and a
 * half-declared membership — a set with no position, or a position with no set — is REFUSED. A set whose
 * order is optional is not an ordered set.
 *
 * Nothing here deletes a row. A document the owner supersedes moves processing state, and a tombstone is
 * a state rather than an absence: a deleted pointer would make the same document look new and be
 * indexed again.
 */
import { IngestionRefusalError, RepositoryStateError } from '../errors.ts';
import { recordAudit, toNullableText, withTransaction, type RepositoryContext } from './support.ts';

const TABLE = 'document_index';

/** The DDL's `processing_state` CHECK. */
export const DOCUMENT_PROCESSING_STATES = ['indexed', 'processed', 'rejected', 'tombstoned'] as const;
export type DocumentProcessingState = (typeof DOCUMENT_PROCESSING_STATES)[number];

export interface DocumentIndexRow {
  readonly id: string;
  readonly documentRef: string;
  readonly contentHash: string;
  readonly byteCount: number;
  readonly documentClass: string;
  readonly processingState: DocumentProcessingState;
  readonly sourceEventId: string | null;
  readonly indexedAt: string;
  readonly tombstonedAt: string | null;
  readonly setName: string | null;
  readonly setOrdinal: number | null;
}

export interface DocumentIndexEntry {
  readonly id: string;
  /** Resolved from the runtime environment by the caller. Never a literal in tracked source. */
  readonly documentRef: string;
  readonly contentHash: string;
  readonly byteCount: number;
  readonly documentClass: string;
  readonly processingState?: DocumentProcessingState;
  readonly sourceEventId?: string | null;
  /** Both or neither. A set membership without a position is refused. */
  readonly setName?: string | null;
  readonly setOrdinal?: number | null;
}

export interface DocumentIndexResult {
  readonly row: DocumentIndexRow;
  /** True when this call created the row. False means these exact bytes were already indexed. */
  readonly indexed: boolean;
}

export interface DocumentIndexRepository {
  indexDocument(entry: DocumentIndexEntry): DocumentIndexResult;
  get(id: string): DocumentIndexRow | null;
  findByContentHash(contentHash: string): DocumentIndexRow | null;
  /** The members of one ordered set, in position order. The ordering is the answer, not a nicety. */
  listSet(setName: string): DocumentIndexRow[];
  listClass(documentClass: string): DocumentIndexRow[];
  count(): number;
  /** Move processing state. A tombstone is a state, so this is also how a document is retired. */
  setProcessingState(id: string, state: DocumentProcessingState): DocumentIndexRow;
}

function mapRow(raw: Record<string, unknown>): DocumentIndexRow {
  const ordinal = raw['set_ordinal'];
  return {
    id: String(raw['id']),
    documentRef: String(raw['document_ref']),
    contentHash: String(raw['content_hash']),
    byteCount: Number(raw['byte_count']),
    documentClass: String(raw['document_class']),
    processingState: String(raw['processing_state']) as DocumentProcessingState,
    sourceEventId: toNullableText(raw['source_event_id']),
    indexedAt: String(raw['indexed_at']),
    tombstonedAt: toNullableText(raw['tombstoned_at']),
    setName: toNullableText(raw['set_name']),
    setOrdinal: ordinal === null || ordinal === undefined ? null : Number(ordinal),
  };
}

export function createDocumentIndexRepository(ctx: RepositoryContext): DocumentIndexRepository {
  const { db } = ctx.handle;

  const readByHash = (hash: string): DocumentIndexRow | null => {
    const raw = db.prepare(`SELECT * FROM ${TABLE} WHERE content_hash = ?`).get(hash) as
      | Record<string, unknown>
      | undefined;
    return raw ? mapRow(raw) : null;
  };

  const readOne = (id: string): DocumentIndexRow | null => {
    const raw = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return raw ? mapRow(raw) : null;
  };

  const requireOne = (id: string): DocumentIndexRow => {
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
    indexDocument(entry: DocumentIndexEntry): DocumentIndexResult {
      const setName = entry.setName ?? null;
      const setOrdinal = entry.setOrdinal ?? null;
      if ((setName === null) !== (setOrdinal === null)) {
        throw new IngestionRefusalError(
          'INGEST_DOCUMENT_SET_POSITION_INCOMPLETE',
          `NIZAM store: a document either belongs to an ordered set at a stated position or belongs to no set. A membership with no position, or a position with no set, is refused — an ordered set whose order is optional is not one. Document ${entry.id}.`,
          { subject: entry.id },
        );
      }
      if (setName !== null && setOrdinal !== null) {
        const taken = db
          .prepare(`SELECT id FROM ${TABLE} WHERE set_name = ? AND set_ordinal = ? AND content_hash <> ?`)
          .get(setName, setOrdinal, entry.contentHash) as { id: string } | undefined;
        if (taken) {
          throw new IngestionRefusalError(
            'INGEST_DOCUMENT_SET_POSITION_TAKEN',
            `NIZAM store: position ${setOrdinal} of the ordered set "${setName}" is already held by another document. Two documents at one position would make the set's order ambiguous, and the order is the meaning here.`,
            { subject: entry.id },
          );
        }
      }

      return withTransaction(db, () => {
        const outcome = db
          .prepare(
            `INSERT INTO ${TABLE}
               (id, document_ref, content_hash, byte_count, document_class, processing_state,
                source_event_id, indexed_at, set_name, set_ordinal)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (content_hash) DO NOTHING`,
          )
          .run(
            entry.id,
            entry.documentRef,
            entry.contentHash,
            entry.byteCount,
            entry.documentClass,
            entry.processingState ?? 'indexed',
            entry.sourceEventId ?? null,
            ctx.now(),
            setName,
            setOrdinal,
          );
        const indexed = Number(outcome.changes) === 1;
        const row = readByHash(entry.contentHash);
        if (!row) {
          throw new RepositoryStateError(
            'REPOSITORY_ROW_NOT_FOUND',
            `NIZAM store: ${TABLE} neither indexed the document nor found the row it conflicted with`,
            { table: TABLE, rowId: entry.id },
          );
        }
        if (indexed) {
          recordAudit(ctx, {
            action: 'document.index',
            entityTable: TABLE,
            entityId: row.id,
            detail: `document_class=${row.documentClass}${row.setName === null ? '' : `, set=${row.setName}#${String(row.setOrdinal)}`}`,
          });
        }
        return { row, indexed };
      });
    },

    get(id: string): DocumentIndexRow | null {
      return readOne(id);
    },

    findByContentHash(contentHash: string): DocumentIndexRow | null {
      return readByHash(contentHash);
    },

    listSet(setName: string): DocumentIndexRow[] {
      const raws = db
        .prepare(`SELECT * FROM ${TABLE} WHERE set_name = ? ORDER BY set_ordinal`)
        .all(setName) as Record<string, unknown>[];
      return raws.map(mapRow);
    },

    listClass(documentClass: string): DocumentIndexRow[] {
      const raws = db
        .prepare(`SELECT * FROM ${TABLE} WHERE document_class = ? ORDER BY document_ref`)
        .all(documentClass) as Record<string, unknown>[];
      return raws.map(mapRow);
    },

    count(): number {
      const raw = db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).get() as { n: number } | undefined;
      return Number(raw?.n ?? 0);
    },

    setProcessingState(id: string, state: DocumentProcessingState): DocumentIndexRow {
      return withTransaction(db, () => {
        requireOne(id);
        const at = ctx.now();
        db.prepare(`UPDATE ${TABLE} SET processing_state = ?, tombstoned_at = ? WHERE id = ?`).run(
          state,
          state === 'tombstoned' ? at : null,
          id,
        );
        recordAudit(ctx, {
          action: 'document.setProcessingState',
          entityTable: TABLE,
          entityId: id,
          detail: `processing_state=${state}`,
        });
        return requireOne(id);
      });
    },
  };
}
