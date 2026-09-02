/**
 * NIZAM · NIZAM DB schema (nizam_db.json) + zod validation
 * Implemented by: KIRO Contract 2 / Phase 2.2
 * Depends on: features/*.types.ts, lib/money/money.ts
 *
 * The canonical database is ONE JSON document living in the user's Google Drive.
 * Every load validates against this schema; every money field is integer milliunits.
 */
import { z } from 'zod';
import type { Account, AccountType } from '@/features/accounts/accounts.types';
import {
  ROLLOVER_BEHAVIOURS,
  TARGET_TYPES,
  requiresObligation,
  requiresTargetMonth,
  type Category,
  type CategoryGroup,
  type CategoryTarget,
  type MonthBudget,
  type MonthCategoryBudget,
} from '@/features/budget/budget.types';
import {
  CORRECTION_ROLES,
  type ClearedStatus,
  type CorrectionLink,
  type ImportInfo,
  type SupersededAllocationSet,
  type Transaction,
  type TransactionSplit,
} from '@/features/transactions/transaction.types';
import {
  OBLIGATION_FREQUENCIES,
  OBLIGATION_PRIORITIES,
  VERIFICATION_SOURCES,
  type Obligation,
} from '@/features/obligations/obligation.types';
import { DEFAULT_POLICY, type ExpectedInflow, type FinancialPolicy } from '@/features/safeToSpend/policy.types';
import { RECOMMENDATIONS } from '@/features/decisions/decision.types';
import {
  DECISION_ACTIONS,
  OUTCOME_ATTRIBUTIONS,
  PROPOSAL_KINDS,
  type DecisionRecord,
} from '@/features/decisions/decisionRecord.types';
import { ASSET_KINDS, DEFAULT_MACRO, type Asset, type FxRate, type MacroContext } from '@/features/netWorth/netWorth.types';
import { DUPLICATE_STATUSES, type DuplicateStatus } from '@/lib/ledger/ledger.types';
import { CURRENCY_CODE_PATTERN } from '@/lib/money/currency';

/**
 * Bumped 8 -> 9 in Step 4 (Contract 6 Phase 6.4) for the versioned-allocation and
 * correction fields. Those fields are OPTIONAL, so a v9 document would parse cleanly under
 * the v8 validator — and that is exactly why the version must move: `z.object` STRIPS
 * unknown keys, so a v8 reader would silently drop `supersededAllocations` and `correction`
 * and destroy audit history on the next write. `migrate()` refusing a document newer than
 * this constant is the only thing standing between an older client and that data loss.
 */
export const SCHEMA_VERSION = 9 as const;

/** Integer milliunits guard — floats are schema violations. */
export const zMoney = z.number().int().finite();

export const zMonthKey = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM');
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
/**
 * ISO 8601 UTC datetime (vNext P2 / owner decision D1, 2026-09-02). Introduced for
 * `FxRate.observedAt`, widened from date-only `asOf` in SCHEMA_VERSION 8 so two
 * observations on the same day can be ordered. Seconds are required; milliseconds are
 * optional so `${date}T00:00:00Z` (the v7->v8 migration's widened value) validates.
 */
export const zIsoDateTime = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
  'expected an ISO 8601 UTC datetime',
);
/**
 * ISO 4217 alphabetic currency code (C6 I1.2). Validated at the persistence
 * boundary so a malformed or absent code can never enter the ledger.
 */
export const zCurrencyCode = z.string().regex(CURRENCY_CODE_PATTERN, 'expected a 3-letter ISO 4217 code');

const zAccountType: z.ZodType<AccountType> = z.enum([
  'CIB_DEBIT',
  'HSBC_CC',
  'CASH',
  'BANK_OTHER',
  'CREDIT_OTHER',
  'TRACKING',
]);

export const zAccount: z.ZodType<Account> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: zAccountType,
  onBudget: z.boolean(),
  currency: zCurrencyCode,
  balance: zMoney,
  clearedBalance: zMoney,
  accountIdentifier: z.string().nullable(),
  creditLimit: zMoney.nullable(),
  closed: z.boolean(),
  order: z.number().int(),
  paymentCategoryId: z.string().nullable(),
});

export const zCategoryGroup: z.ZodType<CategoryGroup> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int(),
  hidden: z.boolean(),
});

/**
 * Category target validator. Widened in schema v7 from the two legacy names to the
 * eight-type vocabulary (docs/architecture/FINANCIAL_DATA_MODEL_VNEXT.md section 6).
 *
 * The refinements are what make the engine's fail-loud dispatch safe: a `balance_by_date`
 * family target without `targetMonth`, or an obligation-linked target without
 * `obligationId`, can never LOAD, so the engine's TypeError for those shapes is a
 * genuine invariant rather than a crash the UI has to survive.
 */
const zTarget: z.ZodType<CategoryTarget> = z
  .object({
    type: z.enum(TARGET_TYPES),
    amount: zMoney,
    targetMonth: zMonthKey.nullable(),
    rollover: z.enum(ROLLOVER_BEHAVIOURS),
    obligationId: z.string().min(1).nullable(),
  })
  .superRefine((value, ctx) => {
    if (requiresTargetMonth(value.type) && value.targetMonth === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetMonth'],
        message: `target type "${value.type}" requires targetMonth`,
      });
    }
    if (requiresObligation(value.type) && value.obligationId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['obligationId'],
        message: `target type "${value.type}" requires obligationId`,
      });
    }
    if (!requiresObligation(value.type) && value.obligationId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['obligationId'],
        message: `target type "${value.type}" must not carry obligationId`,
      });
    }
  });

export const zCategory: z.ZodType<Category> = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int(),
  hidden: z.boolean(),
  target: zTarget.nullable(),
  isCreditCardPayment: z.boolean(),
  linkedAccountId: z.string().nullable(),
});

const zMonthCategoryBudget: z.ZodType<MonthCategoryBudget> = z.object({
  assigned: zMoney,
  activity: zMoney,
  available: zMoney,
});

export const zMonthBudget: z.ZodType<MonthBudget> = z.object({
  month: zMonthKey,
  categories: z.record(z.string(), zMonthCategoryBudget),
});

const zCleared: z.ZodType<ClearedStatus> = z.enum(['uncleared', 'cleared', 'reconciled']);

const zSplit: z.ZodType<TransactionSplit> = z.object({
  id: z.string().min(1),
  categoryId: z.string().nullable(),
  amount: zMoney,
  memo: z.string(),
});

/**
 * Superseded allocation set (C6 I4.4). Legs are validated with the same `zSplit`, so the
 * integrality guarantee on every leg amount is identical to the live set's — history cannot
 * hold a money value the live set would have refused.
 */
const zSupersededAllocationSet: z.ZodType<SupersededAllocationSet> = z.object({
  version: z.number().int().nonnegative(),
  legs: z.array(zSplit),
  supersededAt: zIsoDateTime,
});

/** Correction provenance (C6 I4.5, owner decision D4-A). */
const zCorrectionLink: z.ZodType<CorrectionLink> = z.object({
  correctsTransactionId: z.string().min(1),
  role: z.enum(CORRECTION_ROLES),
  correctionGroupId: z.string().min(1),
  reason: z.string(),
  correctedAt: zIsoDateTime,
});

const zImportInfo: z.ZodType<ImportInfo> = z.object({
  duplicateKey: z.string(),
  sourceFile: z.string(),
  sourcePageOrSheet: z.string(),
  extractionMethod: z.enum(['parser', 'ocr', 'manual']),
  confidenceScore: z.number().min(0).max(1),
  confidenceReason: z.string(),
  // Step 6 optional fields — absent on pre-Step-6 rows; that is fine.
  batchId: z.string().optional(),
  contentHash: z.string().optional(),
  parserVersion: z.number().int().nonnegative().optional(),
  sourceType: z.enum(['csv', 'telegram', 'sms', 'email', 'manual']).optional(),
  sourceTransactionId: z.string().optional(),
  sourceAccountId: z.string().optional(),
  statementReference: z.string().optional(),
  normalizedPayee: z.string().optional(),
});

export const zTransaction: z.ZodType<Transaction> = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  date: zIsoDate,
  payee: z.string(),
  categoryId: z.string().nullable(),
  memo: z.string(),
  amount: zMoney,
  currency: zCurrencyCode,
  cleared: zCleared,
  approved: z.boolean(),
  transferAccountId: z.string().nullable(),
  transferTransactionId: z.string().nullable(),
  splits: z.array(zSplit).nullable(),
  importInfo: zImportInfo.nullable(),
  // Step 4 optional fields — absent on pre-Step-4 rows, which is the documented default.
  allocationSetVersion: z.number().int().nonnegative().optional(),
  supersededAllocations: z.array(zSupersededAllocationSet).optional(),
  correction: zCorrectionLink.nullable().optional(),
});

export interface Payee {
  id: string;
  name: string;
}
export const zPayee: z.ZodType<Payee> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

/**
 * Obligation validator — PFOS Stage 1 / Phase S1.1.
 * Money stays integral; confidence is a 0..1 ratio; interest is integer basis points.
 */
export const zObligation: z.ZodType<Obligation> = z.object({
  id: z.string().min(1),
  creditor: z.string().min(1),
  accountId: z.string().nullable(),
  amountDue: zMoney.nonnegative(),
  minimumDue: zMoney.nonnegative(),
  dueDate: zIsoDate,
  graceDate: zIsoDate.nullable(),
  frequency: z.enum(OBLIGATION_FREQUENCIES),
  priority: z.enum(OBLIGATION_PRIORITIES),
  penalty: zMoney.nonnegative(),
  interestBps: z.number().int().nonnegative(),
  autopay: z.boolean(),
  verificationSource: z.enum(VERIFICATION_SOURCES),
  confidence: z.number().min(0).max(1),
  protectedReserve: zMoney.nonnegative(),
});

const zExpectedInflow: z.ZodType<ExpectedInflow> = z.object({
  amount: zMoney.nonnegative(),
  dayOfMonth: z.number().int().min(1).max(31),
  confidence: z.number().min(0).max(1),
});

/** Version-controlled financial policy — contract 02 section 2.2. */
export const zPolicy: z.ZodType<FinancialPolicy> = z.object({
  minimumLiquidityBuffer: zMoney.nonnegative(),
  essentialLivingMonthly: zMoney.nonnegative(),
  uncertaintyBps: z.number().int().nonnegative(),
  stalenessBps: z.number().int().nonnegative(),
  staleAfterDays: z.number().int().nonnegative(),
  expectedInflow: zExpectedInflow.nullable(),
});

/** PFOS Stage 3: the append-only decision record — contract 03 section 12. */
const zConfidenceBand = z.enum(['strong', 'evidenced', 'provisional', 'insufficient']);
const zDecisionOutcome = z.object({
  reviewedAt: zIsoDate,
  actualNetEffect: zMoney,
  expectedNetEffect: zMoney,
  predictionError: zMoney,
  attribution: z.enum(OUTCOME_ATTRIBUTIONS),
  note: z.string(),
});
export const zDecisionRecord: z.ZodType<DecisionRecord> = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  question: z.string(),
  recommendation: z.enum(RECOMMENDATIONS),
  alternatives: z.array(z.string()),
  policyVersion: z.number().int().nonnegative(),
  dataSnapshotId: z.string(),
  forecast: z.object({
    safeToSpendAtDecision: zMoney,
    horizonImpacts: z.object({
      next_day: z.string(),
      next_week: z.string(),
      next_month: z.string(),
      next_year: z.string(),
    }),
  }),
  confidenceBps: z.number().int().min(0).max(10000),
  confidenceBand: zConfidenceBand,
  userAction: z.enum(DECISION_ACTIONS),
  override: z.string().nullable(),
  reviewDates: z.array(zIsoDate),
  outcomes: z.array(zDecisionOutcome),
  netBenefitEstimate: zMoney.nullable(),
  learningProposal: z
    .object({ kind: z.enum(PROPOSAL_KINDS), description: z.string(), isHardPolicyChange: z.boolean() })
    .nullable(),
});

/** PFOS Stage 4: net-worth entities — contract 01 section 6, contract 03 section 8. */
export const zAsset: z.ZodType<Asset> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(ASSET_KINDS),
  currency: z.string().min(1),
  value: zMoney.nonnegative(),
  liquid: z.boolean(),
  liquidationDiscountBps: z.number().int().min(0).max(10000),
  valuationSource: z.string(),
  valuationAsOf: zIsoDate,
});
export const zFxRate: z.ZodType<FxRate> = z.object({
  currency: zCurrencyCode,
  perUnitNum: z.number().int(),
  perUnitDen: z.number().int().positive(),
  source: z.string(),
  // Widened from date-only `asOf` to a datetime `observedAt` in SCHEMA_VERSION 8
  // (vNext P2 / owner decision D1, 2026-09-02). The migration appends `T00:00:00Z`
  // to every existing value, so ordering is preserved exactly for migrated rows.
  observedAt: zIsoDateTime,
  conversionVersion: z.number().int().nonnegative(),
});
export const zMacro: z.ZodType<MacroContext> = z.object({
  referenceCurrency: z.string().min(1),
  annualInflationBps: z.number().int().nonnegative(),
  inflationSource: z.string(),
  inflationAsOf: zIsoDate,
});

/**
 * A transaction row that arrived through the ingestion boundary but has not yet been
 * reviewed and promoted to the canonical `transactions[]` store.
 *
 * Candidates are EXCLUDED from every financial engine (balances, budgets, net worth,
 * forecasts, obligations, reports). The separation is structural: the schema stores them
 * in a separate collection and no engine function reads `transactionCandidates`.
 *
 * Step 6 (2026-09-02): schema type + empty collection. Import routing change (sending
 * new rows here instead of `transactions[]`) requires UI support and is deferred.
 */
export interface TransactionCandidate extends Transaction {
  /**
   * Whether dedup analysis found this row unique, a confirmed duplicate, or ambiguous
   * (fuzzy match requiring owner review before promotion to `transactions[]`).
   */
  duplicateStatus: DuplicateStatus;
}

export const zTransactionCandidate: z.ZodType<TransactionCandidate> = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  date: zIsoDate,
  payee: z.string(),
  categoryId: z.string().nullable(),
  memo: z.string(),
  amount: zMoney,
  currency: zCurrencyCode,
  cleared: zCleared,
  approved: z.boolean(),
  transferAccountId: z.string().nullable(),
  transferTransactionId: z.string().nullable(),
  splits: z.array(zSplit).nullable(),
  importInfo: zImportInfo.nullable(),
  // Step 4 optional fields — a candidate extends Transaction, so the shape must match.
  allocationSetVersion: z.number().int().nonnegative().optional(),
  supersededAllocations: z.array(zSupersededAllocationSet).optional(),
  correction: zCorrectionLink.nullable().optional(),
  duplicateStatus: z.enum(DUPLICATE_STATUSES),
});

/** Audit entry for a sync conflict resolved by merge / last-write-wins. */
export interface ConflictEntry {
  id: string;
  at: string; // ISO datetime
  collection: string;
  entityId: string;
  resolution: 'local_wins' | 'remote_wins' | 'merged';
  note: string;
}
export const zConflictEntry: z.ZodType<ConflictEntry> = z.object({
  id: z.string().min(1),
  at: z.string(),
  collection: z.string(),
  entityId: z.string(),
  resolution: z.enum(['local_wins', 'remote_wins', 'merged']),
  note: z.string(),
});

export interface DbMeta {
  currency: string;
  moneyBase: 'milliunits';
  createdAt: string | null;
  updatedAt: string | null;
  /** Monotonic edit counter — bumped on every local mutation (merge tiebreak aid). */
  revision: number;
  conflicts: ConflictEntry[];
}
export const zMeta: z.ZodType<DbMeta> = z.object({
  currency: z.string().min(1),
  moneyBase: z.literal('milliunits'),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  conflicts: z.array(zConflictEntry),
});

export interface NizamDb {
  schemaVersion: typeof SCHEMA_VERSION;
  meta: DbMeta;
  accounts: Account[];
  categoryGroups: CategoryGroup[];
  categories: Category[];
  months: MonthBudget[];
  payees: Payee[];
  transactions: Transaction[];
  /** PFOS Stage 1: future commitments safe-to-spend reserves against. */
  obligations: Obligation[];
  /** PFOS Stage 1: version-controlled buffers and reserve rates. */
  policy: FinancialPolicy;
  /** PFOS Stage 3: append-only decision outcome registry — contract 03 section 12. */
  decisions: DecisionRecord[];
  /** PFOS Stage 4: valued assets (financial + real) for the net-worth engine. */
  assets: Asset[];
  /** PFOS Stage 4: currency conversion table (integer ratios to EGP). */
  fxRates: FxRate[];
  /** PFOS Stage 4: macro context (reference currency, inflation) for real net worth. */
  macro: MacroContext;
  /**
   * Step 6: Transaction rows in the staging tier — arrived but not yet canonical.
   * Excluded from every financial engine by structural separation.
   */
  transactionCandidates: TransactionCandidate[];
}

export const zNizamDb: z.ZodType<NizamDb> = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  meta: zMeta,
  accounts: z.array(zAccount),
  categoryGroups: z.array(zCategoryGroup),
  categories: z.array(zCategory),
  months: z.array(zMonthBudget),
  payees: z.array(zPayee),
  transactions: z.array(zTransaction),
  obligations: z.array(zObligation),
  policy: zPolicy,
  decisions: z.array(zDecisionRecord),
  assets: z.array(zAsset),
  fxRates: z.array(zFxRate),
  macro: zMacro,
  transactionCandidates: z.array(zTransactionCandidate),
});

/** New empty database. */
export function createEmptyDb(nowIso: string): NizamDb {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      currency: 'EGP',
      moneyBase: 'milliunits',
      createdAt: nowIso,
      updatedAt: nowIso,
      revision: 0,
      conflicts: [],
    },
    accounts: [],
    categoryGroups: [],
    categories: [],
    months: [],
    payees: [],
    transactions: [],
    obligations: [],
    policy: { ...DEFAULT_POLICY },
    decisions: [],
    assets: [],
    fxRates: [],
    macro: { ...DEFAULT_MACRO },
    transactionCandidates: [],
  };
}

/** Validate an unknown value as a NizamDb (throws ZodError with details on failure). */
export function validateDb(value: unknown): NizamDb {
  return zNizamDb.parse(value);
}
