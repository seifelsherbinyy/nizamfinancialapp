/**
 * NIZAM · finance.db entry point — open, migrate, record the store's identity
 * Implemented by: PFOS Contract 06 / Phase 1.1 (spec 06-two-agent-vps)
 * Depends on: connection.ts, migrations.ts
 *
 * Contract 06 §2.2: connections are created through a single factory and no module
 * opens its own. This is the one function application code calls to obtain a usable
 * store: it opens with the asserted pragmas, brings the schema current, and records the
 * engine assertions into `schema_meta` (§3.1) so the store carries proof of the
 * conditions it was created under.
 *
 * Contract 06 §8.3.2: pruning never runs implicitly on open, on migration, or as a side
 * effect of a read. Nothing in this path prunes anything.
 */
import { openStore, type StoreConnectionConfig, type StoreHandle } from './connection';
import { migrate, type MigrationSummary } from './migrations';

export interface StoreOpenConfig extends StoreConnectionConfig {
  /** The store's logical name, e.g. the finance agent's own store. Injected, never guessed. */
  readonly storeName: string;
}

export interface OpenedStore {
  readonly handle: StoreHandle;
  readonly migrations: MigrationSummary;
}

/** §3.1 — write the identity row once. A second open leaves the original untouched. */
function recordStoreIdentity(handle: StoreHandle, storeName: string, createdAt: string): void {
  handle.db
    .prepare(
      `INSERT INTO schema_meta (id, store_name, created_at, money_base, journal_mode, foreign_keys, synchronous)
       VALUES (1, ?, ?, 'milliunits', ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(
      storeName,
      createdAt,
      handle.pragmas.journalMode,
      handle.pragmas.foreignKeys === 1 ? 'ON' : 'OFF',
      String(handle.pragmas.synchronous),
    );
}

/**
 * Open the finance agent's store, migrate it, and record its identity.
 * Throws a typed error rather than degrading: an unreachable or out-of-bounds path, a
 * pragma that did not take, or an edited applied migration all refuse the store.
 */
export function openFinanceStore(config: StoreOpenConfig, now: () => string = () => new Date().toISOString()): OpenedStore {
  const handle = openStore(config);
  try {
    const migrations = migrate(handle, { now });
    recordStoreIdentity(handle, config.storeName, now());
    return { handle, migrations };
  } catch (cause) {
    handle.close();
    throw cause;
  }
}
