/**
 * NIZAM · Server data tier barrel
 * Implemented by: PFOS Contract 06 / Phase 1.1 (spec 06-two-agent-vps)
 * Depends on: connection.ts, errors.ts, migrations.ts, paths.ts, schema.ts, store.ts
 *
 * `src/server/**` is the VPS-side tier. It must NEVER be imported by `App.tsx` or the
 * browser router — the same exclusion that already applies to `src/features/benchmark/**`
 * and `src/features/routing/**`. Phase 2.3 adds the harness assertion for it.
 */
export {
  applyAndAssertPragmas,
  openStore,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_JOURNAL_MODE,
  REQUIRED_SYNCHRONOUS,
  type EffectivePragmas,
  type StoreConnectionConfig,
  type StoreHandle,
} from './connection';
export {
  MigrationChecksumError,
  MigrationFailedError,
  MigrationSeriesError,
  MonetaryBoundaryError,
  PragmaAssertionError,
  PragmaValueError,
  RepositoryStateError,
  ServerDbError,
  StorePathError,
  type ServerDbErrorCode,
} from './errors';
export {
  currentSchemaVersion,
  migrate,
  migrationChecksum,
  MIGRATIONS,
  type Migration,
  type MigrateOptions,
  type MigrationSummary,
} from './migrations';
export {
  assertMonetaryCoverage,
  assertMoneyField,
  assertOptionalMoneyField,
  isMonetaryColumn,
  monetaryColumnsFor,
} from './moneyBoundary';
export { isWithinDataDir, resolveStorePath } from './paths';
// Phase 1.2 — the fact repositories and the vocabulary they share.
export * from './repositories';
export { BOOTSTRAP_DDL, MONETARY_COLUMNS, SCHEMA_STATEMENTS, TABLES, type TableName } from './schema';
// Phase 1.4 — the append-only token-spend ledger. There is no update or delete export, because
// there is no update or delete path (contract 06 §6.2.2).
export {
  agentBudgetFromStore,
  appendSpend,
  readAgentWeekRows,
  readWeekRows,
  weeklySpendMicroUsd,
  type ProviderReportedSpend,
} from './spendLedgerRepo';
export { openFinanceStore, type OpenedStore, type StoreOpenConfig } from './store';
