// @vitest-environment node
/**
 * NIZAM · Migrator tests — contract 06 §9 T8, T9, T10
 * Implemented by: PFOS Contract 06 / Phase 1.1 (spec 06-two-agent-vps)
 * Depends on: connection.ts, migrations.ts, schema.ts
 *
 * T8  a second run applies ZERO migrations and changes no schema (the test of R3)
 * T9  a migration failing mid-way leaves neither the schema change nor its version row
 * T10 an edited already-applied migration is refused on checksum mismatch
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type StoreHandle } from './connection';
import { MigrationChecksumError, MigrationFailedError, MigrationSeriesError } from './errors';
import { currentSchemaVersion, migrate, migrationChecksum, MIGRATIONS, type Migration } from './migrations';
import { TABLES } from './schema';

const FILE_NAME = 'finance.db';
const FIXED_NOW = (): string => '2026-01-01T00:00:00.000Z';

let dataDir: string;
let handle: StoreHandle;

/** Full schema fingerprint: every object the engine knows about, and its exact DDL. */
function schemaSnapshot(store: StoreHandle): unknown[] {
  return store.db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all();
}

function recordedVersions(store: StoreHandle): number[] {
  return store.db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => Number((row as { version: number }).version));
}

function tableExists(store: StoreHandle, name: string): boolean {
  return store.db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'nizam-migrate-'));
  handle = openStore({ dataDir, fileName: FILE_NAME, busyTimeoutMs: 5_000 });
});

afterEach(() => {
  handle.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('migrate — the idempotence guarantee (§5.2, R3)', () => {
  it('applies the whole series to a fresh store and creates every contracted table', () => {
    const summary = migrate(handle, { now: FIXED_NOW });
    expect(summary.applied).toEqual(MIGRATIONS.map((m) => m.version));
    expect(summary.skipped).toEqual([]);
    for (const table of TABLES) {
      expect(tableExists(handle, table), `${table} must exist`).toBe(true);
    }
    expect(currentSchemaVersion(handle)).toBe(MIGRATIONS[MIGRATIONS.length - 1]?.version);
  });

  it('T8 applies ZERO migrations on a second run and changes no schema', () => {
    migrate(handle, { now: FIXED_NOW });
    const before = schemaSnapshot(handle);
    const versionsBefore = recordedVersions(handle);

    const second = migrate(handle, { now: () => '2026-06-06T00:00:00.000Z' });

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(MIGRATIONS.map((m) => m.version));
    expect(schemaSnapshot(handle)).toEqual(before);
    expect(recordedVersions(handle)).toEqual(versionsBefore);
    // Skipping is decided by the recorded version, so the recorded timestamps are the
    // originals — a re-run did not rewrite history with the second clock.
    const appliedAt = handle.db.prepare('SELECT DISTINCT applied_at FROM schema_migrations').all();
    expect(appliedAt).toEqual([{ applied_at: FIXED_NOW() }]);
  });

  it('applies only the missing tail when the store is partly migrated', () => {
    const head = MIGRATIONS.slice(0, 1);
    expect(migrate(handle, { migrations: head, now: FIXED_NOW }).applied).toEqual([1]);
    const rest = migrate(handle, { now: FIXED_NOW });
    expect(rest.applied).toEqual(MIGRATIONS.slice(1).map((m) => m.version));
    expect(rest.skipped).toEqual([1]);
  });

  it('refuses a series whose versions do not strictly increase', () => {
    const disordered: Migration[] = [
      { version: 2, name: 'second', statements: ['CREATE TABLE IF NOT EXISTS t_two (id TEXT PRIMARY KEY) STRICT'] },
      { version: 1, name: 'first', statements: ['CREATE TABLE IF NOT EXISTS t_one (id TEXT PRIMARY KEY) STRICT'] },
    ];
    expect(() => migrate(handle, { migrations: disordered, now: FIXED_NOW })).toThrow(MigrationSeriesError);
    expect(tableExists(handle, 't_two')).toBe(false);
  });

  it('refuses a store written by a newer build rather than migrating downward', () => {
    migrate(handle, { now: FIXED_NOW });
    handle.db
      .prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)')
      .run(999, 'from_the_future', FIXED_NOW(), 'unknown');
    expect(() => migrate(handle, { now: FIXED_NOW })).toThrow(MigrationSeriesError);
  });
});

describe('migrate — atomicity (§5.2.1, §9 T9)', () => {
  it('T9 leaves neither the schema change nor the version row when a migration fails mid-way', () => {
    const series: Migration[] = [
      { version: 1, name: 'good', statements: ['CREATE TABLE IF NOT EXISTS t_good (id TEXT PRIMARY KEY) STRICT'] },
      {
        version: 2,
        name: 'breaks_after_first_statement',
        statements: [
          'CREATE TABLE IF NOT EXISTS t_half (id TEXT PRIMARY KEY) STRICT',
          'CREATE TABLE t_half_broken (id TEXT PRIMARY KEY, REFERENCES nowhere)',
        ],
      },
    ];

    try {
      migrate(handle, { migrations: series, now: FIXED_NOW });
      expect.unreachable('a migration with an invalid statement must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationFailedError);
      const typed = error as MigrationFailedError;
      expect(typed.version).toBe(2);
      expect(typed.statementIndex).toBe(1);
    }

    // The first migration landed; the failing one left nothing at all behind.
    expect(tableExists(handle, 't_good')).toBe(true);
    expect(tableExists(handle, 't_half')).toBe(false);
    expect(tableExists(handle, 't_half_broken')).toBe(false);
    expect(recordedVersions(handle)).toEqual([1]);

    // And the store is still usable: fixing the migration lets it apply cleanly.
    const fixed: Migration[] = [
      series[0] as Migration,
      { version: 2, name: 'fixed', statements: ['CREATE TABLE IF NOT EXISTS t_half (id TEXT PRIMARY KEY) STRICT'] },
    ];
    expect(migrate(handle, { migrations: fixed, now: FIXED_NOW }).applied).toEqual([2]);
    expect(tableExists(handle, 't_half')).toBe(true);
  });
});

describe('migrate — an applied migration is frozen (§5.2.5, §9 T10)', () => {
  it('T10 refuses an already-applied migration whose statements were edited', () => {
    migrate(handle, { now: FIXED_NOW });
    const original = MIGRATIONS[1] as Migration;

    const edited: Migration[] = MIGRATIONS.map((m) =>
      m.version === original.version
        ? { ...m, statements: [...m.statements, 'CREATE TABLE IF NOT EXISTS t_sneaked_in (id TEXT PRIMARY KEY) STRICT'] }
        : m,
    );

    try {
      migrate(handle, { migrations: edited, now: FIXED_NOW });
      expect.unreachable('an edited applied migration must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationChecksumError);
      const typed = error as MigrationChecksumError;
      expect(typed.version).toBe(original.version);
      expect(typed.recordedChecksum).toBe(migrationChecksum(original));
      expect(typed.recordedChecksum).not.toBe(typed.currentChecksum);
      expect(typed.message).toMatch(/never edit an applied one/i);
    }

    // The refusal is total: the edit did not partly land, and no later migration ran on
    // top of a history that can no longer be trusted.
    expect(tableExists(handle, 't_sneaked_in')).toBe(false);
    expect(recordedVersions(handle)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it('the checksum covers the version, the name, and every statement', () => {
    const base: Migration = { version: 7, name: 'base', statements: ['SELECT 1', 'SELECT 2'] };
    expect(migrationChecksum(base)).toBe(migrationChecksum({ ...base }));
    expect(migrationChecksum(base)).not.toBe(migrationChecksum({ ...base, name: 'renamed' }));
    expect(migrationChecksum(base)).not.toBe(migrationChecksum({ ...base, version: 8 }));
    expect(migrationChecksum(base)).not.toBe(migrationChecksum({ ...base, statements: ['SELECT 2', 'SELECT 1'] }));
  });
});
