/**
 * NIZAM · Repository barrel for the financial-fact tables — contract 06 §3.2
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: rows.ts, support.ts, accountsRepository.ts, transactionsRepository.ts,
 *             obligationsRepository.ts, decisionsRepository.ts
 *
 * One import site for the four fact repositories and the vocabulary they share, so a
 * consumer has no reason to reach for a second declaration of the same idea.
 *
 * `src/server/**` is the VPS-side tier and must NEVER be imported by `App.tsx` or the
 * browser router. The type vocabulary flows the other way: these rows reuse the browser
 * tier's own `Money`, `LedgerTransactionType`, `AccountType`, and obligation-priority
 * tuples rather than restating them (§3.2, §4.3).
 */
export { createAccountsRepository, type AccountBalanceUpdate, type AccountListFilter, type AccountsRepository } from './accountsRepository.ts';
export {
  createDecisionsRepository,
  type DecisionListFilter,
  type DecisionsRepository,
  type DecisionSupersedeResult,
} from './decisionsRepository.ts';
export {
  createFxRatesRepository,
  toFxRate,
  type FxRateListFilter,
  type FxRatesRepository,
} from './fxRatesRepository.ts';
export {
  createObligationsRepository,
  type ObligationAmountRevision,
  type ObligationListFilter,
  type ObligationsRepository,
} from './obligationsRepository.ts';
export {
  createTransactionsRepository,
  type SupersedeResult,
  type TransactionListFilter,
  type TransactionsRepository,
} from './transactionsRepository.ts';
export {
  ASSIGNABLE_DECISION_OUTCOME_STATES,
  DECISION_OUTCOME_STATES,
  DEFAULT_CURRENCY,
  LINK_RESOLUTIONS,
  OBLIGATION_STATUSES,
  priorityFromOrdinal,
  priorityOrdinal,
  TRANSACTION_LINK_TYPES,
  TRANSACTION_STATUSES,
  VERIFICATION_LEVELS,
  type AccountInsert,
  type AccountRow,
  type AccountType,
  type AssignableDecisionOutcomeState,
  type AuditLogRow,
  type DecisionInsert,
  type DecisionOutcomeState,
  type DecisionRow,
  type FxRateInsert,
  type FxRateRow,
  type LedgerTransactionType,
  type LinkResolution,
  type Money,
  type ObligationFrequency,
  type ObligationInsert,
  type ObligationPriority,
  type ObligationRow,
  type ObligationStatus,
  type TransactionInsert,
  type TransactionLinkInsert,
  type TransactionLinkRow,
  type TransactionLinkType,
  type TransactionRow,
  type TransactionStatus,
  type VerificationLevel,
} from './rows.ts';
export {
  createRepositoryContext,
  recordAudit,
  withTransaction,
  type AuditEntry,
  type RepositoryContext,
  type RepositoryContextConfig,
} from './support.ts';
