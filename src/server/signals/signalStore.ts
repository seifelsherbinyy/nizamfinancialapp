/**
 * NIZAM · signals.db — the append-only signal store and its audit mirror
 * Implemented by: PFOS Contract 12 / Phase 3.3 (spec 06-two-agent-vps)
 * Owning requirements: R7 (validated on write AND on read), R9 (internal-only, documented in ops)
 * Depends on: ../db/connection (the single connection factory), ../db/migrations (the migrator),
 *   ./signalStoreSchema (the DDL), ./envelopeValidation (validation — reused, never reimplemented)
 *
 * Contract 12 §4.1. What this module is, in one line: the store behind the bus, with no way to
 * change what it has already recorded.
 *
 * **Append-only is enforced at the ENGINE, not here.** The absence of an update export and a
 * delete export below is real and `signalStore.test.ts` scans this source to prove it — but that
 * is a property of one file, and the handle is what every future caller reaches. The refusal
 * lives in `signals.db` itself, as `BEFORE UPDATE` and `BEFORE DELETE` triggers installed by the
 * signals series' migration 1, so an edit is refused whatever the path: this module, a
 * diagnostic console, or code that has not read the contract. A correction is
 * {@link appendSignal} again, with its own `signalId`.
 *
 * **Validation is 3.1's, on both paths.** {@link validateForWrite} and {@link validateForRead}
 * come from `./envelopeValidation`; nothing here re-derives the note cap, the enums, the
 * forbidden-field rules, or the integrity digest. The read path matters as much as the write
 * path (§4.2): a stored row is served only if it validates **now**, so widening or narrowing
 * the schema cannot silently change what history means. A row that fails re-validation is
 * refused and audited, not repaired and not partially served.
 *
 * **The audit mirror records the accept and the refusal, and retains neither value.** §4.3.6
 * forbids a quarantine table, so `signal_audit` has no column for what was refused. What it
 * keeps is the reason, the path the rule fired at, the port failure code, the producer's own
 * identifier when the input carried a usable one, and the *length* of a note. 3.1's
 * {@link SignalRefusal} already has no field for the refused value; this module preserves that
 * property by construction, because there is nowhere to put one.
 *
 * **Engine invariants are inherited, not restated.** The store is opened through
 * `../db/connection`'s factory, which sets and READS BACK write-ahead logging, enforced foreign
 * keys, durable writes, and a busy timeout, and refuses the store on any mismatch. Contract 12
 * §4.1 says the engine rules are contract 06 §2.2's applied to a third store and are not
 * restated; this module honours that by having no pragma logic of its own.
 *
 * **What this module deliberately does NOT do.** It does not gate consent. Scope and tier are
 * independent gates evaluated on every read by the bus (§4.5), and that gate is Phase 3.2's
 * module. {@link readSignals} therefore takes no subscriber and answers with validated
 * envelopes; deciding who may see one is a layer above this store, not a filter inside it.
 *
 * The bus is bound to the internal network only and has no proxy route (§2.2.5, §2.2.6, R9).
 * That is a deployment property no SQL statement can assert, so it is documented in
 * `ops/BUS_NETWORK_BINDING.md`, which Phase 7 must honour. This module names no host, no port,
 * and no path: `dataDir` arrives injected.
 */
import { openStore, type StoreConnectionConfig, type StoreHandle } from '../db/connection';
import { migrate, type Migration, type MigrationSummary } from '../db/migrations';
import { SIGNAL_KINDS, SIGNAL_PRODUCERS, type SignalEnvelope, type SignalKind, type SignalProducer } from '../ports/signalBus';
import { SIGNAL_ENVELOPE_SCHEMA_ID } from './envelopeSchema';
import {
  SignalValidationError,
  validateForRead,
  validateForWrite,
  type SignalRefusal,
} from './envelopeValidation';
import {
  SIGNAL_SCHEMA_STATEMENTS,
  SIGNAL_STORE_FILE_NAME,
  SIGNAL_STORE_NAME,
  type SignalAuditEvent,
} from './signalStoreSchema';

/**
 * The signals series. Its own series, because `signals.db` is its own file with its own
 * bookkeeping — see the schema module's note. APPEND ONLY: add an entry, never edit an applied
 * one (contract 06 §5.1; the migrator refuses a checksum mismatch).
 */
export const SIGNAL_STORE_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'signal_store_append_only', statements: SIGNAL_SCHEMA_STATEMENTS[1] ?? [] },
];

/**
 * How the bus store is opened. Identical to the data tier's connection contract, because the
 * engine invariants are inherited from it rather than restated (§4.1). `fileName` is normally
 * {@link SIGNAL_STORE_FILE_NAME}; it stays injected so a test can open a temporary store.
 */
export type SignalStoreOpenConfig = StoreConnectionConfig;

export interface OpenedSignalStore {
  readonly handle: StoreHandle;
  readonly migrations: MigrationSummary;
}

/** What the store needs from its caller: a handle, a clock, and a source of audit-row ids. */
export interface SignalStoreContext {
  readonly handle: StoreHandle;
  /** Injected clock. This module reads no ambient time. */
  readonly now: () => string;
  /** Surrogate ids for audit rows. A signal's own id comes from its producer (§4.2). */
  readonly newAuditId: () => string;
}

/** Acknowledgement of one appended signal. Mirrors the port's receipt shape. */
export interface StoredSignalRecord {
  readonly envelope: SignalEnvelope;
  readonly storedAt: string;
}

/** One line of the audit mirror, as an operator reads it. No refused value, by construction. */
export interface SignalAuditLine {
  readonly id: string;
  readonly occurredAt: string;
  readonly event: SignalAuditEvent;
  readonly producer: SignalProducer | null;
  readonly kind: SignalKind | null;
  readonly signalIdRef: string | null;
  readonly reason: string | null;
  readonly atPath: string | null;
  readonly failureCode: string | null;
  readonly noteLength: number | null;
  readonly hash: string | null;
}

/** What a caller may narrow a read by. Note the absence of a subscriber — see the module note. */
export interface SignalStoreQuery {
  readonly kind?: SignalKind;
  readonly producer?: SignalProducer;
  /** Lower bound on the envelope's own `ts`, inclusive. */
  readonly since?: string;
  readonly limit: number;
}

/** A store-level refusal that is not a validation refusal. Discriminate on `code`. */
export class SignalStoreError extends Error {
  readonly code: 'SIGNAL_ID_ALREADY_STORED' | 'SIGNAL_STORE_QUERY_INVALID';
  readonly signalIdRef: string | null;

  constructor(code: SignalStoreError['code'], message: string, signalIdRef: string | null = null) {
    super(message);
    this.name = 'SignalStoreError';
    this.code = code;
    this.signalIdRef = signalIdRef;
  }
}

// ---------------------------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------------------------

const INSERT_META_SQL = `
INSERT INTO signal_store_meta
  (id, store_name, created_at, envelope_schema_id, append_only, validated_on, journal_mode, foreign_keys, synchronous)
VALUES (1, ?, ?, ?, 'true', 'write_and_read', ?, ?, ?)
ON CONFLICT(id) DO NOTHING
`.trim();

/** Record the store's identity once. A second open leaves the original row untouched. */
function recordSignalStoreIdentity(handle: StoreHandle, createdAt: string): void {
  handle.db
    .prepare(INSERT_META_SQL)
    .run(
      SIGNAL_STORE_NAME,
      createdAt,
      SIGNAL_ENVELOPE_SCHEMA_ID,
      handle.pragmas.journalMode,
      handle.pragmas.foreignKeys === 1 ? 'ON' : 'OFF',
      String(handle.pragmas.synchronous),
    );
}

/**
 * Open the bus store, migrate it, and record its identity. Throws a typed error rather than
 * degrading: an out-of-bounds path, a pragma that did not take, or an edited applied migration
 * all refuse the store.
 */
export function openSignalStore(
  config: SignalStoreOpenConfig,
  now: () => string = () => new Date().toISOString(),
): OpenedSignalStore {
  const handle = openStore(config);
  try {
    const migrations = migrate(handle, { migrations: SIGNAL_STORE_MIGRATIONS, now });
    recordSignalStoreIdentity(handle, now());
    return { handle, migrations };
  } catch (cause) {
    handle.close();
    throw cause;
  }
}

export { SIGNAL_STORE_FILE_NAME };

// ---------------------------------------------------------------------------------------------
// The audit mirror
// ---------------------------------------------------------------------------------------------

const INSERT_AUDIT_SQL = `
INSERT INTO signal_audit
  (id, occurred_at, event, producer, kind, signal_id_ref, reason, at_path, failure_code, note_length, hash)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`.trim();

const SELECT_AUDIT_SQL = `
SELECT id, occurred_at, event, producer, kind, signal_id_ref, reason, at_path, failure_code, note_length, hash
FROM signal_audit
ORDER BY occurred_at, id
`.trim();

/**
 * A value only when it is a member of the schema, and NULL otherwise. A refused envelope may
 * have carried anything at all in these fields, and the columns carry a CHECK constraint — so
 * quoting a non-member would abort the audit write, which is the one write that must always
 * succeed. Refusing to record a refusal would be the worst available failure.
 */
function memberOrNull<T extends string>(candidate: unknown, members: readonly T[]): T | null {
  return typeof candidate === 'string' && (members as readonly string[]).includes(candidate) ? (candidate as T) : null;
}

function producerOf(candidate: unknown): SignalProducer | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  return memberOrNull((candidate as Record<string, unknown>).producer, SIGNAL_PRODUCERS);
}

function kindOf(candidate: unknown): SignalKind | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  return memberOrNull((candidate as Record<string, unknown>).kind, SIGNAL_KINDS);
}

interface AuditWrite {
  readonly event: SignalAuditEvent;
  readonly producer: SignalProducer | null;
  readonly kind: SignalKind | null;
  readonly signalIdRef: string | null;
  readonly reason: string | null;
  readonly atPath: string | null;
  readonly failureCode: string | null;
  readonly noteLength: number | null;
  readonly hash: string | null;
}

function writeAudit(ctx: SignalStoreContext, line: AuditWrite): string {
  const id = ctx.newAuditId();
  ctx.handle.db
    .prepare(INSERT_AUDIT_SQL)
    .run(
      id,
      ctx.now(),
      line.event,
      line.producer,
      line.kind,
      line.signalIdRef,
      line.reason,
      line.atPath,
      line.failureCode,
      line.noteLength,
      line.hash,
    );
  return id;
}

/**
 * Audit a refusal. Everything recorded here is a reason, a path, a code, an identifier, or a
 * measurement — {@link SignalRefusal} has no field for the refused value, and neither does the
 * table, so there is nothing to leave out by accident (§4.3.6).
 */
function auditRefusal(
  ctx: SignalStoreContext,
  event: Extract<SignalAuditEvent, 'refused_on_write' | 'refused_on_read'>,
  refusal: SignalRefusal,
  candidate: unknown,
): void {
  writeAudit(ctx, {
    event,
    producer: producerOf(candidate),
    kind: kindOf(candidate),
    signalIdRef: refusal.signalIdRef,
    reason: refusal.reason,
    atPath: refusal.at,
    failureCode: refusal.code,
    noteLength: refusal.noteLength,
    hash: null,
  });
}

/** Every audit line, oldest first. The mirror is readable; it is not editable. */
export function readAudit(ctx: SignalStoreContext): readonly SignalAuditLine[] {
  return ctx.handle.db
    .prepare(SELECT_AUDIT_SQL)
    .all()
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        occurredAt: String(r.occurred_at),
        event: r.event as SignalAuditEvent,
        producer: memberOrNull(r.producer, SIGNAL_PRODUCERS),
        kind: memberOrNull(r.kind, SIGNAL_KINDS),
        signalIdRef: r.signal_id_ref === null ? null : String(r.signal_id_ref),
        reason: r.reason === null ? null : String(r.reason),
        atPath: r.at_path === null ? null : String(r.at_path),
        failureCode: r.failure_code === null ? null : String(r.failure_code),
        noteLength: r.note_length === null ? null : Number(r.note_length),
        hash: r.hash === null ? null : String(r.hash),
      } satisfies SignalAuditLine;
    });
}

// ---------------------------------------------------------------------------------------------
// The write path
// ---------------------------------------------------------------------------------------------

const INSERT_SIGNAL_SQL = `
INSERT INTO signals
  (signal_id, ts, producer, kind, tier, consent_scope, level, direction, note, hash, stored_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`.trim();

const EXISTS_SIGNAL_SQL = 'SELECT 1 AS present FROM signals WHERE signal_id = ?';

/**
 * Validate an untrusted candidate and append it. The only write path in this module.
 *
 * On refusal: an audit line is written, and a {@link SignalValidationError} is thrown. Nothing
 * is stored in `signals` — not a repaired envelope, not a truncated note, not a quarantined
 * copy (§4.3.4, §4.3.6). The refused value is not retained anywhere.
 *
 * On acceptance: the envelope and its `accepted` audit line are written in ONE transaction, so
 * the mirror cannot drift from the log — a stored signal with no audit line, or an audit line
 * with no signal, is not a reachable state.
 */
export function appendSignal(ctx: SignalStoreContext, candidate: unknown): StoredSignalRecord {
  const validated = validateForWrite(candidate);
  if (!validated.ok) {
    auditRefusal(ctx, 'refused_on_write', validated.refusal, candidate);
    throw new SignalValidationError(validated.refusal);
  }
  const envelope = validated.value;

  // §4.2: a signal identifier is unique. A repeat is a refusal, never an overwrite — and it is
  // audited, because a producer re-using an identifier is exactly the kind of thing an operator
  // needs to be able to see afterwards.
  const clash = ctx.handle.db.prepare(EXISTS_SIGNAL_SQL).get(envelope.signalId);
  if (clash !== undefined) {
    writeAudit(ctx, {
      event: 'refused_on_write',
      producer: envelope.producer,
      kind: envelope.kind,
      signalIdRef: envelope.signalId,
      reason: 'signal_id_already_stored',
      atPath: 'signalId',
      failureCode: 'SIGNAL_ENVELOPE_INVALID',
      noteLength: envelope.payload.note === undefined ? null : envelope.payload.note.length,
      hash: null,
    });
    throw new SignalStoreError(
      'SIGNAL_ID_ALREADY_STORED',
      `NIZAM signal store: signal identifier "${envelope.signalId}" is already stored. A correction is a NEW signal with its own identifier, never a rewrite of this one (contract 12 §4.1).`,
      envelope.signalId,
    );
  }

  const storedAt = ctx.now();
  const { db } = ctx.handle;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(INSERT_SIGNAL_SQL).run(
      envelope.signalId,
      envelope.ts,
      envelope.producer,
      envelope.kind,
      envelope.tier,
      envelope.consentScope,
      envelope.payload.level,
      envelope.payload.direction ?? null,
      envelope.payload.note ?? null,
      envelope.hash,
      storedAt,
    );
    writeAudit(ctx, {
      event: 'accepted',
      producer: envelope.producer,
      kind: envelope.kind,
      signalIdRef: envelope.signalId,
      reason: null,
      atPath: null,
      failureCode: null,
      // Measured, never copied: the note is the one payload field that holds text.
      noteLength: envelope.payload.note === undefined ? null : envelope.payload.note.length,
      hash: envelope.hash,
    });
    db.exec('COMMIT');
  } catch (cause) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // A failure that already aborted the transaction leaves nothing to roll back.
    }
    throw cause;
  }

  return { envelope, storedAt };
}

// ---------------------------------------------------------------------------------------------
// The read path
// ---------------------------------------------------------------------------------------------

const SELECT_SIGNALS_SQL = `
SELECT signal_id, ts, producer, kind, tier, consent_scope, level, direction, note, hash
FROM signals
WHERE (? IS NULL OR kind = ?)
  AND (? IS NULL OR producer = ?)
  AND (? IS NULL OR ts >= ?)
ORDER BY ts, signal_id
`.trim();

/**
 * Rebuild the stored envelope's exact eight-key shape from a row, so re-validation sees the
 * envelope and nothing else. `stored_at` is the bus's own bookkeeping and is deliberately not
 * part of the envelope — including it would make every row fail as a surplus field, which is
 * the schema working correctly.
 */
function candidateFromRow(row: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = { level: row.level };
  if (row.direction !== null && row.direction !== undefined) payload.direction = row.direction;
  if (row.note !== null && row.note !== undefined) payload.note = row.note;
  return {
    signalId: row.signal_id,
    ts: row.ts,
    producer: row.producer,
    kind: row.kind,
    tier: row.tier,
    consentScope: row.consent_scope,
    payload,
    hash: row.hash,
  };
}

/**
 * Read stored signals, **re-validating every row before it is served** (§4.2, R7).
 *
 * A row that no longer validates is audited as `refused_on_read` and the whole read is refused
 * with a {@link SignalValidationError}. There is no partial delivery, for the same reason there
 * is no partial publish: serving the rows that happen to still pass would leave the caller
 * unable to tell a filtered answer from a complete one.
 *
 * Consent scope and tier are NOT evaluated here — that gate is the bus's, and it is Phase 3.2's
 * module (§4.5.1).
 */
export function readSignals(ctx: SignalStoreContext, query: SignalStoreQuery): readonly SignalEnvelope[] {
  if (!Number.isSafeInteger(query.limit) || query.limit < 0) {
    throw new SignalStoreError(
      'SIGNAL_STORE_QUERY_INVALID',
      `NIZAM signal store: a read limit must be a non-negative integer, got "${String(query.limit)}"`,
    );
  }
  const kind = query.kind ?? null;
  const producer = query.producer ?? null;
  const since = query.since ?? null;

  const rows = ctx.handle.db.prepare(SELECT_SIGNALS_SQL).all(kind, kind, producer, producer, since, since);

  const served: SignalEnvelope[] = [];
  for (const row of rows) {
    // The limit is applied BEFORE validation, so the store never validates — and therefore never
    // refuses a read over — a row it was not going to serve anyway.
    if (served.length >= query.limit) break;
    const candidate = candidateFromRow(row as Record<string, unknown>);
    const validated = validateForRead(candidate);
    if (!validated.ok) {
      auditRefusal(ctx, 'refused_on_read', validated.refusal, candidate);
      throw new SignalValidationError(validated.refusal);
    }
    served.push(validated.value);
  }
  return served;
}

/** How many signals the store holds. A count of rows, not a figure about anything (§4.3.1). */
export function storedSignalCount(ctx: SignalStoreContext): number {
  const row = ctx.handle.db.prepare('SELECT COUNT(*) AS n FROM signals').get();
  return Number((row as { n: number }).n);
}
