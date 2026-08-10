/**
 * NIZAM · finance.db migrator — ordered, append-only, idempotent, version-recorded
 * Implemented by: PFOS Contract 06 / Phase 1.1 (spec 06-two-agent-vps)
 * Depends on: connection.ts, errors.ts, schema.ts
 *
 * Contract 06 §5 (owning requirement R3). The four guarantees, and how each is made
 * mechanical rather than remembered:
 *
 *  1. ONE TRANSACTION. Each migration's statements and the INSERT of its own
 *     `schema_migrations` row run inside a single transaction. Either both land or
 *     neither does, so a partially applied migration is not a reachable state (§5.2.1).
 *  2. SKIP WITHOUT EXECUTING. A migration whose version is already recorded is skipped
 *     without executing a single statement, and the decision is made from the recorded
 *     version — never by probing the schema (§5.2.2).
 *  3. DEFENSIVE DDL. Statements use IF NOT EXISTS so a hand-repaired store converges
 *     rather than aborting (§5.2.3).
 *  4. A SUMMARY. `migrate` returns the versions applied and skipped, so a caller can
 *     assert that a second consecutive run applied ZERO. That assertion is the test of
 *     R3 (§5.2.4).
 *
 * And the refusal: a recorded version whose checksum no longer matches its migration is
 * a HARD failure (§5.2.5). It means an applied migration was edited, which §5.1 forbids,
 * and the migrator will not guess which of the two states is correct. Correct a mistake
 * with a NEW migration.
 */
import { createHash } from 'node:crypto';
import type { StoreHandle } from './connection.ts';
import { MigrationChecksumError, MigrationFailedError, MigrationSeriesError } from './errors.ts';
import { BOOTSTRAP_DDL, SCHEMA_STATEMENTS } from './schema.ts';

/** One numbered, named, frozen step of the series. */
export interface Migration {
  /** Monotonically increasing integer. Never reused, never reordered. */
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

/** What a run did. `applied.length === 0` is the definition of a no-op re-run. */
export interface MigrationSummary {
  readonly applied: readonly number[];
  readonly skipped: readonly number[];
}

export interface MigrateOptions {
  /** Override the series. Tests inject a failing step; production never passes this. */
  readonly migrations?: readonly Migration[];
  /** Injected clock. The migrator reads no ambient time of its own. */
  readonly now?: () => string;
}

/**
 * The series. APPEND ONLY: to change the schema, add an entry — never edit one that has
 * been applied anywhere, because its checksum is recorded and the migrator refuses a
 * mismatch.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'store_identity', statements: SCHEMA_STATEMENTS[1] ?? [] },
  { version: 2, name: 'financial_facts', statements: SCHEMA_STATEMENTS[2] ?? [] },
  { version: 3, name: 'server_operations', statements: SCHEMA_STATEMENTS[3] ?? [] },
  // Phase 1.2 — the decision registry's append-only rule, enforced by the engine.
  { version: 4, name: 'decisions_append_only', statements: SCHEMA_STATEMENTS[4] ?? [] },
  // Phase 1.4 — the same for the token-spend ledger (§6.2.2).
  { version: 5, name: 'spend_ledger_append_only', statements: SCHEMA_STATEMENTS[5] ?? [] },
  // Phase 4.3 — the durable columns and the unique delivery index the accept-fast path needs
  // (contract 12 §5.5). A new version, because 003 declared the table and is frozen (§5.1).
  { version: 6, name: 'work_queue_durable_payload', statements: SCHEMA_STATEMENTS[6] ?? [] },
  // Phase 5.3 — the actual reported cost, the pre-flight estimate in its own column, the served
  // model identity, the per-request privacy assertion, and append-only triggers on the telemetry
  // table (contract 06 §3.3/§6.2, contract 12 §6.4, R19). 003 declared the table and is frozen.
  { version: 7, name: 'model_telemetry_cost_and_append_only', statements: SCHEMA_STATEMENTS[7] ?? [] },
  // Spec 08 wave A2/A4 — the provenance columns K4 needs, the statement exception reason A2.5 needs,
  // and the ordered-set position A4.2 needs. 002 and 003 declared those tables and are frozen (§5.1).
  { version: 8, name: 'ingestion_provenance_and_document_sets', statements: SCHEMA_STATEMENTS[8] ?? [] },
];

/** Stable hash of a migration's identity and its statements. */
export function migrationChecksum(migration: Migration): string {
  const canonical = [`${migration.version}:${migration.name}`, ...migration.statements].join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

interface RecordedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

function readRecorded(handle: StoreHandle): Map<number, RecordedMigration> {
  const rows = handle.db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
  const recorded = new Map<number, RecordedMigration>();
  for (const row of rows) {
    const r = row as { version: number; name: string; checksum: string };
    recorded.set(Number(r.version), { version: Number(r.version), name: String(r.name), checksum: String(r.checksum) });
  }
  return recorded;
}

/** §5.1 — the series must be append-only and monotonically increasing. */
function assertSeriesOrder(migrations: readonly Migration[]): void {
  let previous = 0;
  for (const m of migrations) {
    if (!Number.isSafeInteger(m.version) || m.version < 1) {
      throw new MigrationSeriesError(`migration version must be a positive integer, got ${String(m.version)}`);
    }
    if (m.version <= previous) {
      throw new MigrationSeriesError(
        `migration versions must strictly increase; ${m.version} follows ${previous}. The series is append-only.`,
      );
    }
    if (m.statements.length === 0) {
      throw new MigrationSeriesError(`migration ${m.version} (${m.name}) has no statements`);
    }
    previous = m.version;
  }
}

/**
 * §5.2.5 — verify every already-recorded migration still hashes to what was recorded,
 * BEFORE applying anything. A mismatch anywhere stops the whole run, so a later
 * migration cannot land on top of a store whose history is no longer trustworthy.
 */
function assertRecordedChecksums(migrations: readonly Migration[], recorded: Map<number, RecordedMigration>): void {
  for (const m of migrations) {
    const row = recorded.get(m.version);
    if (!row) continue;
    const current = migrationChecksum(m);
    if (row.checksum !== current) {
      throw new MigrationChecksumError({
        version: m.version,
        name: m.name,
        recordedChecksum: row.checksum,
        currentChecksum: current,
      });
    }
  }
}

/**
 * A store recording a version this build does not carry is a downgrade, not a no-op.
 * Applying anything to it risks writing against a schema this code cannot describe.
 */
function assertNoUnknownRecordedVersions(
  migrations: readonly Migration[],
  recorded: Map<number, RecordedMigration>,
): void {
  const known = new Set(migrations.map((m) => m.version));
  const unknown = [...recorded.keys()].filter((v) => !known.has(v)).sort((a, b) => a - b);
  if (unknown.length > 0) {
    throw new MigrationSeriesError(
      `the store records migration version(s) ${unknown.join(', ')} that this build does not carry, so it was written by a newer build. Update the application rather than migrating downward.`,
    );
  }
}

/** Apply one migration and record it, atomically. */
function applyOne(handle: StoreHandle, migration: Migration, appliedAt: string): void {
  const { db } = handle;
  const checksum = migrationChecksum(migration);
  let statementIndex = -1;
  db.exec('BEGIN IMMEDIATE');
  try {
    migration.statements.forEach((statement, index) => {
      statementIndex = index;
      db.exec(statement);
    });
    statementIndex = migration.statements.length;
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(
      migration.version,
      migration.name,
      appliedAt,
      checksum,
    );
    db.exec('COMMIT');
  } catch (cause) {
    // The rollback is what makes §5.2.1 true: no schema change, no version row.
    try {
      db.exec('ROLLBACK');
    } catch {
      // A failure that already aborted the transaction leaves nothing to roll back.
    }
    throw new MigrationFailedError({ version: migration.version, name: migration.name, statementIndex, cause });
  }
}

/**
 * Bring the store to the current schema. Idempotent: running it against an
 * already-current store applies zero migrations and changes no schema.
 */
export function migrate(handle: StoreHandle, options: MigrateOptions = {}): MigrationSummary {
  const migrations = options.migrations ?? MIGRATIONS;
  const now = options.now ?? ((): string => new Date().toISOString());

  assertSeriesOrder(migrations);

  // The bookkeeping table must exist before a migration can record itself. This is the
  // migrator's own bootstrap, not a migration, and it is written defensively so running
  // it against an existing store is a no-op.
  handle.db.exec(BOOTSTRAP_DDL);

  const recorded = readRecorded(handle);
  assertNoUnknownRecordedVersions(migrations, recorded);
  assertRecordedChecksums(migrations, recorded);

  const applied: number[] = [];
  const skipped: number[] = [];
  for (const migration of migrations) {
    if (recorded.has(migration.version)) {
      // Skipped on the recorded version alone — not one statement is executed.
      skipped.push(migration.version);
      continue;
    }
    applyOne(handle, migration, now());
    applied.push(migration.version);
  }
  return { applied, skipped };
}

/** The highest version the store records, or 0 when nothing has been applied. */
export function currentSchemaVersion(handle: StoreHandle): number {
  handle.db.exec(BOOTSTRAP_DDL);
  const row = handle.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  const value = (row as { version: number | null } | undefined)?.version;
  return typeof value === 'number' ? value : 0;
}
