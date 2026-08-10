/**
 * NIZAM · Server store connection factory — node:sqlite, WAL, pragmas read back
 * Implemented by: PFOS Contract 06 / Phase 1.1 (spec 06-two-agent-vps)
 * Depends on: errors.ts, paths.ts, sqliteBinding.ts
 *
 * Contract 06 §2.2 (owning requirement R1):
 *  - Engine is the runtime's BUILT-IN SQLite binding. No third-party driver, no ORM,
 *    no native build step: the store holds financial facts and must add zero
 *    supply-chain surface.
 *  - Every connection sets journal_mode=WAL, foreign_keys=ON, synchronous=FULL and a
 *    busy timeout, then READS EACH ONE BACK and refuses the store on mismatch. A
 *    pragma that was set but did not take is indistinguishable from one that was
 *    never set unless it is read back.
 *  - Connections are created through this single factory. No other module opens one.
 *
 * Contract 06 §2.1.3 / §10: no code path in `src/server/**` issues the cross-database
 * open statement that section forbids — not for reporting, not for migration, not for
 * diagnostics. Cross-store joins do not exist; the signal bus is the only cross-agent
 * channel. `isolation.test.ts` asserts the keyword's absence from this whole tree, so
 * the word itself is deliberately never written here.
 *
 * Contract 06 §2.1.5: the data directory must be local storage — never a network
 * filesystem and never a synchronizing cloud folder, because a WAL database on such a
 * path can be corrupted. That is a deployment property (contract 12), not something
 * this process can verify, so it is stated here and enforced in ops.
 */
import { PragmaAssertionError, PragmaValueError } from './errors.ts';
import { resolveStorePath } from './paths.ts';
import { sqlite, type SqliteDatabase } from './sqliteBinding.ts';

/** Injected configuration. Nothing here has a default that points at a real host. */
export interface StoreConnectionConfig {
  /** The agent's own data directory: absolute, existing, local. */
  readonly dataDir: string;
  /** The store file within `dataDir`. */
  readonly fileName: string;
  /** Lock wait before a busy failure surfaces to a caller. */
  readonly busyTimeoutMs: number;
}

/** The pragma values the store actually reported after they were set. */
export interface EffectivePragmas {
  readonly journalMode: string;
  readonly foreignKeys: number;
  readonly synchronous: number;
  readonly busyTimeoutMs: number;
}

/** An open connection plus the proof that it is configured as the contract requires. */
export interface StoreHandle {
  readonly db: SqliteDatabase;
  readonly filePath: string;
  readonly pragmas: EffectivePragmas;
  close(): void;
}

/** Write-ahead logging: reader/writer concurrency for a live single-writer store. */
export const REQUIRED_JOURNAL_MODE = 'wal';
/** Referential integrity. Per connection, and off by default — silently so. */
export const REQUIRED_FOREIGN_KEYS = 1;
/** `synchronous=FULL`. Durability over throughput: this store holds money. */
export const REQUIRED_SYNCHRONOUS = 2;

/**
 * Read a pragma back. SQLite names the result column inconsistently across pragmas
 * (`busy_timeout` answers in a column called `timeout`), so the first column of the
 * single result row is taken rather than a hard-coded key.
 */
function readPragma(db: SqliteDatabase, pragma: string): unknown {
  const row = db.prepare(`PRAGMA ${pragma}`).get();
  if (typeof row !== 'object' || row === null) return undefined;
  const values = Object.values(row as Record<string, unknown>);
  return values.length > 0 ? values[0] : undefined;
}

function assertPragma(pragma: string, expected: string | number, actual: unknown): void {
  const same = typeof expected === 'number' ? Number(actual) === expected : String(actual).toLowerCase() === expected;
  if (!same) throw new PragmaAssertionError({ pragma, expected, actual });
}

/**
 * Apply the connection contract to an already-open database and prove it took.
 * Exported so a caller holding a connection from this factory can re-assert after any
 * operation it suspects of changing the store's mode.
 */
export function applyAndAssertPragmas(db: SqliteDatabase, busyTimeoutMs: number): EffectivePragmas {
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new PragmaValueError({ pragma: 'busy_timeout', received: busyTimeoutMs });
  }

  // journal_mode returns the resulting mode as a row; the rest are silent.
  db.prepare('PRAGMA journal_mode = WAL').get();
  db.prepare('PRAGMA foreign_keys = ON').run();
  db.prepare('PRAGMA synchronous = FULL').run();
  // The only interpolated pragma argument, validated as a safe integer above.
  db.prepare(`PRAGMA busy_timeout = ${busyTimeoutMs}`).get();

  const journalMode = String(readPragma(db, 'journal_mode')).toLowerCase();
  const foreignKeys = Number(readPragma(db, 'foreign_keys'));
  const synchronous = Number(readPragma(db, 'synchronous'));
  const effectiveBusyTimeoutMs = Number(readPragma(db, 'busy_timeout'));

  assertPragma('journal_mode', REQUIRED_JOURNAL_MODE, journalMode);
  assertPragma('foreign_keys', REQUIRED_FOREIGN_KEYS, foreignKeys);
  assertPragma('synchronous', REQUIRED_SYNCHRONOUS, synchronous);
  assertPragma('busy_timeout', busyTimeoutMs, effectiveBusyTimeoutMs);

  return { journalMode, foreignKeys, synchronous, busyTimeoutMs: effectiveBusyTimeoutMs };
}

/**
 * Open the agent's store. Throws a typed error — never a fallback location, never a
 * store that cannot prove WAL and enforced foreign keys.
 */
export function openStore(config: StoreConnectionConfig): StoreHandle {
  const filePath = resolveStorePath(config.dataDir, config.fileName);
  const db = new sqlite.DatabaseSync(filePath);
  let pragmas: EffectivePragmas;
  try {
    pragmas = applyAndAssertPragmas(db, config.busyTimeoutMs);
  } catch (cause) {
    // A store that cannot prove its engine contract is not left open.
    db.close();
    throw cause;
  }
  return {
    db,
    filePath,
    pragmas,
    close(): void {
      db.close();
    },
  };
}
