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
} from './connection.ts';
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
} from './errors.ts';
export {
  currentSchemaVersion,
  migrate,
  migrationChecksum,
  MIGRATIONS,
  type Migration,
  type MigrateOptions,
  type MigrationSummary,
} from './migrations.ts';
export {
  assertMonetaryCoverage,
  assertMoneyField,
  assertOptionalMoneyField,
  isMonetaryColumn,
  monetaryColumnsFor,
} from './moneyBoundary.ts';
export { isWithinDataDir, resolveStorePath } from './paths.ts';
// Phase 1.2 — the fact repositories and the vocabulary they share.
export * from './repositories/index.ts';
export {
  BOOTSTRAP_DDL,
  MONETARY_COLUMNS,
  SCHEMA_STATEMENTS,
  TABLES,
  TELEMETRY_FORBIDDEN_COLUMNS,
  type TableName,
} from './schema.ts';
// Phase 5.3 — the append-only telemetry store. No update or delete export, because there is no
// update or delete path: telemetry is the evidence contract 11 governs from (contract 12 §6.4).
export {
  contentBreaches,
  ESTIMATE_SOURCE_PREFLIGHT,
  MODEL_TELEMETRY_COLUMNS,
  MODEL_TELEMETRY_ERROR_CODES,
  ModelTelemetryError,
  readTelemetry,
  recordedCallCount,
  recordTelemetry,
  TELEMETRY_CONTENT_CLAIMS,
  TELEMETRY_FIELD_MAX_LENGTH,
  TELEMETRY_OUTCOMES,
  type CostSourcePreflightEstimate,
  type ModelTelemetryColumn,
  type ModelTelemetryErrorCode,
  type ModelTelemetryRow,
  type PreflightCostEstimate,
  type TelemetryContentBreach,
  type TelemetryContentClaim,
  type TelemetryOutcome,
  type TelemetryQuery,
  type TelemetryRecord,
} from './modelTelemetryRepo.ts';
// Phase 1.4 — the append-only token-spend ledger. There is no update or delete export, because
// there is no update or delete path (contract 06 §6.2.2).
export {
  agentBudgetFromStore,
  appendSpend,
  readAgentWeekRows,
  readWeekRows,
  weeklySpendMicroUsd,
  type ProviderReportedSpend,
} from './spendLedgerRepo.ts';
export { openFinanceStore, type OpenedStore, type StoreOpenConfig } from './store.ts';
