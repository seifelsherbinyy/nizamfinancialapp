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
import type {
  Category,
  CategoryGroup,
  CategoryTarget,
  MonthBudget,
  MonthCategoryBudget,
} from '@/features/budget/budget.types';
import type {
  ClearedStatus,
  ImportInfo,
  Transaction,
  TransactionSplit,
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

export const SCHEMA_VERSION = 4 as const;

/** Integer milliunits guard — floats are schema violations. */
export const zMoney = z.number().int().finite();

export const zMonthKey = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM');
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

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

const zTarget: z.ZodType<CategoryTarget> = z.object({
  type: z.enum(['monthly', 'target_by_date']),
  amount: zMoney,
  targetMonth: zMonthKey.nullable(),
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

const zImportInfo: z.ZodType<ImportInfo> = z.object({
  duplicateKey: z.string(),
  sourceFile: z.string(),
  sourcePageOrSheet: z.string(),
  extractionMethod: z.enum(['parser', 'ocr', 'manual']),
  confidenceScore: z.number().min(0).max(1),
  confidenceReason: z.string(),
});

export const zTransaction: z.ZodType<Transaction> = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  date: zIsoDate,
  payee: z.string(),
  categoryId: z.string().nullable(),
  memo: z.string(),
  amount: zMoney,
  cleared: zCleared,
  approved: z.boolean(),
  transferAccountId: z.string().nullable(),
  transferTransactionId: z.string().nullable(),
  splits: z.array(zSplit).nullable(),
  importInfo: zImportInfo.nullable(),
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
  currency: z.string().min(1),
  perUnitNum: z.number().int(),
  perUnitDen: z.number().int().positive(),
  source: z.string(),
  asOf: zIsoDate,
});
export const zMacro: z.ZodType<MacroContext> = z.object({
  referenceCurrency: z.string().min(1),
  annualInflationBps: z.number().int().nonnegative(),
  inflationSource: z.string(),
  inflationAsOf: zIsoDate,
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
  };
}

/** Validate an unknown value as a NizamDb (throws ZodError with details on failure). */
export function validateDb(value: unknown): NizamDb {
  return zNizamDb.parse(value);
}
