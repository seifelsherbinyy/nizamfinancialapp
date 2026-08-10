/**
 * NIZAM · Server store typed errors
 * Implemented by: PFOS Contract 06 / Phase 1.1 (spec 06-two-agent-vps)
 * Depends on: none
 *
 * Contract 06 §2.1.2, §2.2, §5.2 all require a *typed* failure rather than a
 * fallback, a boolean, or a silent coercion. Every guard in this directory throws
 * one of these, so a caller can discriminate on `code` instead of matching a
 * message string that is free to change.
 */

/** Discriminator for every failure this data tier raises. */
export type ServerDbErrorCode =
  | 'STORE_DATA_DIR_INVALID'
  | 'STORE_DATA_DIR_MISSING'
  | 'STORE_FILE_NAME_INVALID'
  | 'STORE_PATH_ESCAPES_DATA_DIR'
  | 'PRAGMA_VALUE_INVALID'
  | 'PRAGMA_ASSERTION_FAILED'
  | 'MIGRATION_SERIES_DISORDERED'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'MIGRATION_FAILED'
  | 'MONETARY_VALUE_NOT_INTEGER'
  | 'MONETARY_COLUMN_UNKNOWN'
  | 'MONETARY_COLUMN_MISSING'
  | 'RATE_PAIR_NOT_INTEGER'
  | 'RATE_PAIR_DENOMINATOR_INVALID'
  | 'RATE_COLUMN_UNKNOWN'
  | 'REPOSITORY_ROW_NOT_FOUND'
  | 'REPOSITORY_ROW_ALREADY_SUPERSEDED'
  | 'REPOSITORY_DERIVED_STATE_NOT_ASSIGNABLE'
  // Spec 08 wave A2/A4 — the ingestion boundary's own refusals (Phase 2.2).
  | 'INGEST_STATEMENT_EXCEPTION_WITHOUT_REASON'
  | 'INGEST_DOCUMENT_SET_POSITION_INCOMPLETE'
  | 'INGEST_DOCUMENT_SET_POSITION_TAKEN'
  | 'INGEST_ACCOUNT_UNRESOLVED';

/** Base class for every typed failure of the server data tier. */
export class ServerDbError extends Error {
  readonly code: ServerDbErrorCode;

  constructor(code: ServerDbErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * The resolved store path is not inside the configured data directory, or the
 * configuration itself is unusable. Contract 06 §2.1.2: an attempt to open a path
 * outside the agent's own data directory is a typed error, never a fallback — this
 * is the mechanical form of "no cross-agent open" (R1, R6).
 */
export class StorePathError extends ServerDbError {
  readonly dataDir: string;
  readonly requested: string;
  readonly resolved: string | null;

  constructor(
    code: ServerDbErrorCode,
    message: string,
    detail: { dataDir: string; requested: string; resolved?: string | null },
  ) {
    super(code, message);
    this.dataDir = detail.dataDir;
    this.requested = detail.requested;
    this.resolved = detail.resolved ?? null;
  }
}

/**
 * A pragma was set but did not take. Contract 06 §2.2: a pragma that was set but
 * did not take is indistinguishable from one that was never set unless it is read
 * back, so the open routine reads each one back and refuses the store on mismatch.
 */
export class PragmaAssertionError extends ServerDbError {
  readonly pragma: string;
  readonly expected: string;
  readonly actual: string;

  constructor(detail: { pragma: string; expected: unknown; actual: unknown }) {
    super(
      'PRAGMA_ASSERTION_FAILED',
      `NIZAM store: PRAGMA ${detail.pragma} must be ${String(detail.expected)} but the store reports ${String(detail.actual)}; refusing to open`,
    );
    this.pragma = detail.pragma;
    this.expected = String(detail.expected);
    this.actual = String(detail.actual);
  }
}

/** A pragma argument supplied by configuration is not a value we will interpolate. */
export class PragmaValueError extends ServerDbError {
  readonly pragma: string;
  readonly received: string;

  constructor(detail: { pragma: string; received: unknown }) {
    super(
      'PRAGMA_VALUE_INVALID',
      `NIZAM store: PRAGMA ${detail.pragma} needs a non-negative safe integer, got ${String(detail.received)}`,
    );
    this.pragma = detail.pragma;
    this.received = String(detail.received);
  }
}

/** The migration series is not append-only and monotonically increasing (§5.1). */
export class MigrationSeriesError extends ServerDbError {
  constructor(message: string) {
    super('MIGRATION_SERIES_DISORDERED', `NIZAM store: ${message}`);
  }
}

/**
 * An already-applied migration no longer hashes to its recorded checksum, which
 * means it was edited after application. Contract 06 §5.2.5: this is a hard
 * failure — the migrator refuses to proceed rather than guessing which of the two
 * states is correct.
 */
export class MigrationChecksumError extends ServerDbError {
  readonly version: number;
  readonly recordedChecksum: string;
  readonly currentChecksum: string;

  constructor(detail: { version: number; name: string; recordedChecksum: string; currentChecksum: string }) {
    super(
      'MIGRATION_CHECKSUM_MISMATCH',
      `NIZAM store: migration ${detail.version} (${detail.name}) was edited after it was applied — recorded checksum ${detail.recordedChecksum}, current ${detail.currentChecksum}. Correct a mistake with a NEW migration; never edit an applied one.`,
    );
    this.version = detail.version;
    this.recordedChecksum = detail.recordedChecksum;
    this.currentChecksum = detail.currentChecksum;
  }
}

/**
 * A migration failed part-way. Its transaction has been rolled back, so neither
 * the schema change nor its `schema_migrations` row survives (§5.2.1).
 */
export class MigrationFailedError extends ServerDbError {
  readonly version: number;
  readonly statementIndex: number;

  constructor(detail: { version: number; name: string; statementIndex: number; cause: unknown }) {
    super(
      'MIGRATION_FAILED',
      `NIZAM store: migration ${detail.version} (${detail.name}) failed at statement ${detail.statementIndex} and was rolled back; neither the schema change nor its version row was kept`,
      { cause: detail.cause },
    );
    this.version = detail.version;
    this.statementIndex = detail.statementIndex;
  }
}

/**
 * A monetary value was refused at the persistence boundary. Contract 06 §4.2: the guard
 * throws a TYPED error carrying the offending field's name and the received value — not a
 * boolean, not a silent coercion, not a rounded write. The field name is on the error
 * object rather than only inside the message, so a caller can act on it without parsing
 * prose that is free to change.
 *
 * Added by: PFOS Contract 06 / Phase 1.2.
 */
export class MonetaryBoundaryError extends ServerDbError {
  /** The table the value was headed for, when the caller named one. */
  readonly table: string | null;
  /** The offending column. Never empty. */
  readonly field: string;
  /** The received value, stringified for a log without re-admitting it as a number. */
  readonly received: string;
  /** `typeof` the received value, which is often the real diagnosis. */
  readonly receivedType: string;

  constructor(
    code: Extract<
      ServerDbErrorCode,
      | 'MONETARY_VALUE_NOT_INTEGER'
      | 'MONETARY_COLUMN_UNKNOWN'
      | 'MONETARY_COLUMN_MISSING'
      // §4.4 rates share this boundary and this error type on purpose: a rate that cannot
      // be expressed as an integer pair is refused by the same guard as a non-integer
      // amount, because it would otherwise become a float that later multiplies money.
      | 'RATE_PAIR_NOT_INTEGER'
      | 'RATE_PAIR_DENOMINATOR_INVALID'
      | 'RATE_COLUMN_UNKNOWN'
    >,
    message: string,
    detail: { table?: string | null; field: string; received?: unknown },
  ) {
    super(code, message);
    this.table = detail.table ?? null;
    this.field = detail.field;
    this.received = typeof detail.received === 'string' ? detail.received : String(detail.received);
    this.receivedType = detail.received === null ? 'null' : typeof detail.received;
  }
}

/**
 * A repository was asked to correct a row that is not there, or to fork a chain that has
 * already been superseded. Contract 06 §8.1: correction is by superseding row, so a second
 * successor for the same predecessor would make "the current row" ambiguous. Refused rather
 * than resolved by a rule nobody agreed to.
 *
 * `REPOSITORY_DERIVED_STATE_NOT_ASSIGNABLE` is the same family: a caller tried to WRITE a
 * value that this tier DERIVES, so the write would have been a claim the lineage columns do
 * not support and are free to contradict. Contract 06 §3.2 ADDENDUM A1.
 *
 * Added by: PFOS Contract 06 / Phase 1.2; extended in Phase 1.5.
 */
export class RepositoryStateError extends ServerDbError {
  readonly table: string;
  readonly rowId: string;

  constructor(
    code: Extract<
      ServerDbErrorCode,
      'REPOSITORY_ROW_NOT_FOUND' | 'REPOSITORY_ROW_ALREADY_SUPERSEDED' | 'REPOSITORY_DERIVED_STATE_NOT_ASSIGNABLE'
    >,
    message: string,
    detail: { table: string; rowId: string },
  ) {
    super(code, message);
    this.table = detail.table;
    this.rowId = detail.rowId;
  }
}

/**
 * A refusal at the INGESTION boundary — spec 08 wave A2/A4 (Phase 2.2).
 *
 * Kept separate from `RepositoryStateError` because these are not states of a row that already exists;
 * they are the boundary declining to write one. Each carries the subject it refused so the operator
 * learns which document or which period is at fault, and never a monetary value: a balance-equation
 * residual is a real amount, so it belongs in the gitignored reconciliation artifact and not in an
 * error message that a log line could carry.
 */
export class IngestionRefusalError extends ServerDbError {
  readonly subject: string;

  constructor(
    code: Extract<
      ServerDbErrorCode,
      | 'INGEST_STATEMENT_EXCEPTION_WITHOUT_REASON'
      | 'INGEST_DOCUMENT_SET_POSITION_INCOMPLETE'
      | 'INGEST_DOCUMENT_SET_POSITION_TAKEN'
      | 'INGEST_ACCOUNT_UNRESOLVED'
    >,
    message: string,
    detail: { subject: string },
  ) {
    super(code, message);
    this.subject = detail.subject;
  }
}
