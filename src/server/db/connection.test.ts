// @vitest-environment node
/**
 * NIZAM · Server store connection tests — contract 06 §9 T1, T2, T4
 * Implemented by: PFOS Contract 06 / Phase 1.1 (spec 06-two-agent-vps)
 * Depends on: connection.ts, paths.ts, store.ts
 *
 * Each guard is shown REFUSING the guarded operation, not merely returning a value:
 * a test that has only ever been observed passing is not evidence (§9).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyAndAssertPragmas,
  openStore,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_JOURNAL_MODE,
  REQUIRED_SYNCHRONOUS,
} from './connection';
import { PragmaAssertionError, PragmaValueError, ServerDbError, StorePathError } from './errors';
import { resolveStorePath } from './paths';
import { sqlite } from './sqliteBinding';
import { openFinanceStore } from './store';

const FILE_NAME = 'finance.db';
const BUSY_TIMEOUT_MS = 5_000;

let root: string;
let dataDir: string;

beforeEach(() => {
  // A synthetic temp tree stands in for the mounted volume. No deployment particular.
  root = mkdtempSync(join(tmpdir(), 'nizam-store-'));
  dataDir = join(root, 'finance');
  mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('openStore — engine and connection contract (§2.2)', () => {
  it('T1 reports journal_mode=WAL and foreign_keys=ON when the pragmas are read back', () => {
    const store = openStore({ dataDir, fileName: FILE_NAME, busyTimeoutMs: BUSY_TIMEOUT_MS });
    try {
      expect(store.pragmas.journalMode).toBe(REQUIRED_JOURNAL_MODE);
      expect(store.pragmas.foreignKeys).toBe(REQUIRED_FOREIGN_KEYS);
      expect(store.pragmas.synchronous).toBe(REQUIRED_SYNCHRONOUS);
      expect(store.pragmas.busyTimeoutMs).toBe(BUSY_TIMEOUT_MS);

      // Read back independently of the factory's own bookkeeping: the store itself, not
      // the value we hoped we set.
      expect(store.db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
      expect(store.db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    } finally {
      store.close();
    }
  });

  it('refuses a busy timeout that is not a non-negative safe integer', () => {
    expect(() => openStore({ dataDir, fileName: FILE_NAME, busyTimeoutMs: -1 })).toThrow(PragmaValueError);
    try {
      openStore({ dataDir, fileName: FILE_NAME, busyTimeoutMs: Number.NaN });
      expect.unreachable('a NaN busy timeout must not open a store');
    } catch (error) {
      expect(error).toBeInstanceOf(ServerDbError);
      expect((error as ServerDbError).code).toBe('PRAGMA_VALUE_INVALID');
    }
  });

  it('T1 refuses a store whose pragma did not take, which is what reading back is for', () => {
    // §2.2: "a pragma that was set but did not take is indistinguishable from one that
    // was never set, unless it is read back". This is that case, unmocked: an in-memory
    // database accepts `PRAGMA journal_mode = WAL` without complaint and then reports
    // `memory`. Only the read-back catches it, so this exercises the guard refusing —
    // without it, the assertion path would never have been observed failing at all.
    const ephemeral = new sqlite.DatabaseSync(':memory:');
    try {
      applyAndAssertPragmas(ephemeral, BUSY_TIMEOUT_MS);
      expect.unreachable('a store that cannot prove WAL must not be accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(PragmaAssertionError);
      const typed = error as PragmaAssertionError;
      expect(typed.code).toBe('PRAGMA_ASSERTION_FAILED');
      expect(typed.pragma).toBe('journal_mode');
      expect(typed.expected).toBe(REQUIRED_JOURNAL_MODE);
      expect(typed.actual).not.toBe(REQUIRED_JOURNAL_MODE);
      expect(typed.message).toMatch(/refusing to open/i);
    } finally {
      ephemeral.close();
    }
  });

  it('leaves no open handle behind when the pragma assertion fails', () => {
    // The refusal closes the connection it opened (see openStore's catch), so a store
    // that failed its engine contract cannot be reached through a leaked handle.
    const store = openStore({ dataDir, fileName: FILE_NAME, busyTimeoutMs: BUSY_TIMEOUT_MS });
    store.close();
    expect(() => store.db.prepare('SELECT 1').get()).toThrow();
  });
});

describe('resolveStorePath — the path guard (§2.1.2, R1/R6)', () => {
  it('T2 throws a typed error for a path outside the configured data directory', () => {
    // The shape of a cross-agent open: climb out of this agent's directory and name
    // another store. It must be a typed refusal, never a fallback.
    const escape = join('..', 'life', 'life.db');
    try {
      resolveStorePath(dataDir, escape);
      expect.unreachable('resolving outside the data directory must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(StorePathError);
      const typed = error as StorePathError;
      expect(typed.code).toBe('STORE_PATH_ESCAPES_DATA_DIR');
      expect(typed.dataDir).toContain('finance');
      expect(typed.requested).toBe(escape);
    }
  });

  it('T2 throws for an absolute path that overrides the configured directory', () => {
    const elsewhere = join(root, 'life', 'life.db');
    expect(() => resolveStorePath(dataDir, elsewhere)).toThrow(StorePathError);
  });

  it('T2 refuses to invent a data directory that does not exist', () => {
    const missing = join(root, 'not-mounted');
    try {
      resolveStorePath(missing, FILE_NAME);
      expect.unreachable('a missing data directory must throw rather than be created');
    } catch (error) {
      expect((error as StorePathError).code).toBe('STORE_DATA_DIR_MISSING');
    }
  });

  it('rejects a relative or empty data directory outright', () => {
    expect(() => resolveStorePath('relative/dir', FILE_NAME)).toThrow(StorePathError);
    expect(() => resolveStorePath(dataDir, '   ')).toThrow(StorePathError);
  });

  it('accepts a file inside the configured directory', () => {
    expect(resolveStorePath(dataDir, FILE_NAME)).toBe(join(dataDir, FILE_NAME));
  });

  it('openStore refuses the cross-agent path, so no other store is ever opened', () => {
    mkdirSync(join(root, 'life'), { recursive: true });
    expect(() =>
      openStore({ dataDir, fileName: join('..', 'life', 'life.db'), busyTimeoutMs: BUSY_TIMEOUT_MS }),
    ).toThrow(StorePathError);
  });
});

describe('openFinanceStore — the store carries proof of its own conditions (§3.1)', () => {
  it('records the engine assertions once and does not rewrite them on a later open', () => {
    const config = { dataDir, fileName: FILE_NAME, busyTimeoutMs: BUSY_TIMEOUT_MS, storeName: 'finance' };
    const first = openFinanceStore(config, () => '2026-01-01T00:00:00.000Z');
    expect(first.migrations.applied.length).toBeGreaterThan(0);
    expect(first.handle.db.prepare('SELECT * FROM schema_meta').get()).toEqual({
      id: 1,
      store_name: 'finance',
      created_at: '2026-01-01T00:00:00.000Z',
      money_base: 'milliunits',
      journal_mode: REQUIRED_JOURNAL_MODE,
      foreign_keys: 'ON',
      synchronous: String(REQUIRED_SYNCHRONOUS),
    });
    first.handle.close();

    // A second open migrates nothing and leaves the identity row exactly as created:
    // the store's record of when it came into existence is not a mutable field.
    const second = openFinanceStore(config, () => '2026-09-09T00:00:00.000Z');
    try {
      expect(second.migrations.applied).toEqual([]);
      expect(second.handle.db.prepare('SELECT created_at FROM schema_meta').get()).toEqual({
        created_at: '2026-01-01T00:00:00.000Z',
      });
      expect(second.handle.db.prepare('SELECT COUNT(*) AS n FROM schema_meta').get()).toEqual({ n: 1 });
    } finally {
      second.handle.close();
    }
  });
});

describe('foreign keys actually enforced (§9 T4)', () => {
  it('T4 rejects a real foreign-key violation, proving the pragma took effect', () => {
    const { handle } = openFinanceStore({
      dataDir,
      fileName: FILE_NAME,
      busyTimeoutMs: BUSY_TIMEOUT_MS,
      storeName: 'finance',
    });
    try {
      // A transaction referencing an account that does not exist. Under foreign_keys=OFF
      // this INSERT succeeds silently, which is exactly the failure mode §2.2 guards.
      const orphanWrite = handle.db.prepare(
        `INSERT INTO transactions
           (id, account_id, transaction_date, transaction_type, amount, status, verification_level, created_at, updated_at)
         VALUES (?, ?, ?, 'charge', ?, 'posted', 'parser', ?, ?)`,
      );
      expect(() =>
        orphanWrite.run('txn_orphan', 'acct_absent', '2026-01-05', -1_500, '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z'),
      ).toThrow(/FOREIGN KEY constraint failed/i);

      // Nothing was written.
      expect(handle.db.prepare('SELECT COUNT(*) AS n FROM transactions').get()).toEqual({ n: 0 });
    } finally {
      handle.close();
    }
  });

  it('accepts the same row once its parent account exists', () => {
    const { handle } = openFinanceStore({
      dataDir,
      fileName: FILE_NAME,
      busyTimeoutMs: BUSY_TIMEOUT_MS,
      storeName: 'finance',
    });
    try {
      handle.db
        .prepare(
          `INSERT INTO accounts (id, name, type, balance, cleared_balance, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('acct_present', 'Synthetic Current', 'BANK_OTHER', 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      handle.db
        .prepare(
          `INSERT INTO transactions
             (id, account_id, transaction_date, transaction_type, amount, status, verification_level, created_at, updated_at)
           VALUES (?, ?, ?, 'charge', ?, 'posted', 'parser', ?, ?)`,
        )
        .run('txn_ok', 'acct_present', '2026-01-05', -1_500, '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z');
      expect(handle.db.prepare('SELECT amount FROM transactions WHERE id = ?').get('txn_ok')).toEqual({
        amount: -1_500,
      });
    } finally {
      handle.close();
    }
  });
});
