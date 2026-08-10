/**
 * NIZAM · Server row shapes for the financial-fact tables — contract 06 §3.2
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: schema.ts (the DDL these mirror), src/lib/money, src/lib/ledger,
 *             src/features/accounts, src/features/obligations (vocabulary only)
 *
 * Contract 06 §3.2 says these tables "reuse contract 02 §4 and §6 field names deliberately,
 * so the server ledger and the browser ledger describe the same facts with the same
 * vocabulary". So the vocabulary is imported, not restated:
 *
 *  - `Money` and every monetary field come from `src/lib/money` (§4.3 INVARIANT).
 *  - `LedgerTransactionType` comes from `src/lib/ledger`, and is exactly the DDL's
 *    `transaction_type` CHECK list. One tuple, two tiers.
 *  - `AccountType` comes from the accounts feature, and `ObligationPriority` /
 *    `ObligationFrequency` from the obligations feature. These imports are vocabulary and
 *    types only; no browser logic is pulled in, and nothing here runs in the browser.
 *
 * Where a value exists only server-side — a transaction's persistence `status`, its
 * `verification_level`, an obligation's lifecycle `status`, a link's `link_type`, a decision's
 * `outcome` — the tuple is declared here, once, and it matches its DDL CHECK constraint. The
 * SQL in `schema.ts` stays literal on purpose (an applied migration is frozen, and text
 * generated from a mutable array would silently change its own checksum), so these tuples are
 * the TypeScript-side statement of the same closed set rather than its source.
 *
 * Row types describe what the store holds. Input types describe what a caller supplies:
 * ids, timestamps, and monetary values are always explicit, because a repository that
 * invented an id or read the wall clock would make its own writes untestable.
 */
import type { Money } from '../../../lib/money/money.ts';
import type {
  ConfidenceBand,
  IngestExtractionMethod,
  LedgerTransactionType,
} from '../../../lib/ledger/ledger.types.ts';
import type { AccountType } from '../../../features/accounts/accounts.types.ts';
import {
  OBLIGATION_PRIORITIES,
  type ObligationFrequency,
  type ObligationPriority,
} from '../../../features/obligations/obligation.types.ts';

/**
 * The canonical vocabulary, re-exported so a consumer of this tier has one import site and
 * no reason to reach for a second declaration of the same idea.
 */
export type { Money } from '../../../lib/money/money.ts';
export type { LedgerTransactionType } from '../../../lib/ledger/ledger.types.ts';
export type { AccountType } from '../../../features/accounts/accounts.types.ts';
export type { ObligationFrequency, ObligationPriority } from '../../../features/obligations/obligation.types.ts';

/** Default currency of the store. The DDL carries the same default. */
export const DEFAULT_CURRENCY = 'EGP';

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

/** One `accounts` row. Monetary columns are integer milliunits (§4.1). */
export interface AccountRow {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  /** On-budget accounts participate in the zero-based budget; tracking accounts do not. */
  readonly onBudget: boolean;
  readonly balance: Money;
  readonly clearedBalance: Money;
  readonly creditLimit: Money | null;
  /**
   * The ONLY account-identifier fragment that is ever persisted (§3.2, contract 02 §9). A
   * full account number has no column in this store and never will.
   */
  readonly accountIdentifierLast4: string | null;
  readonly closed: boolean;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AccountInsert {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency?: string;
  readonly onBudget: boolean;
  readonly balance: Money;
  readonly clearedBalance: Money;
  readonly creditLimit: Money | null;
  readonly accountIdentifierLast4: string | null;
  readonly closed?: boolean;
  readonly sortOrder?: number;
}

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------

/** Persistence state of a transaction. Matches the DDL `status` CHECK. */
export const TRANSACTION_STATUSES = ['pending', 'posted', 'reconciled', 'superseded', 'void'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/** How well the row is corroborated. Matches the DDL `verification_level` CHECK. */
export const VERIFICATION_LEVELS = ['unverified', 'parser', 'reconciled', 'statement'] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

/**
 * One `transactions` row.
 *
 * `amount` is signed (outflow negative, inflow positive) while `outflow` and `inflow` are
 * non-negative magnitudes — the convention of `money-rules.md` §4, which the DDL enforces
 * with `CHECK (outflow >= 0)` and `CHECK (inflow >= 0)`.
 */
export interface TransactionRow {
  readonly id: string;
  readonly accountId: string;
  readonly sourceEventId: string | null;
  readonly transactionDate: string;
  readonly postingDate: string | null;
  readonly payee: string;
  readonly merchant: string;
  readonly memo: string;
  readonly categoryId: string | null;
  readonly transactionType: LedgerTransactionType;
  readonly amount: Money;
  readonly outflow: Money;
  readonly inflow: Money;
  readonly currency: string;
  readonly status: TransactionStatus;
  readonly verificationLevel: VerificationLevel;
  /** Set on the CORRECTING row; points at the row it replaces (§8.1). */
  readonly supersedesTransactionId: string | null;
  readonly auditVersion: number;
  readonly duplicateKey: string | null;
  /** Provenance, added by migration 008 for spec 08 wave A2 task A2.4 (K4). Never defaulted. */
  readonly provenance: TransactionProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Where a row came from and how much the extraction is trusted — spec 08 task A2.4 (K4).
 *
 * `extractionMethod` may be `unknown`, and that is the point: a row whose extractor this repository
 * has no translation for loads as unknown rather than claiming a human entered it (finding F23).
 * `confidenceBps` and `confidenceBand` are alternatives, never both derived from one another: a source
 * that stated an ordinal word gets a band, a source that stated a score gets basis points.
 */
export interface TransactionProvenance {
  readonly sourceFile: string;
  readonly sourcePageOrSheet: string;
  readonly extractionMethod: IngestExtractionMethod;
  /** The upstream extractor token, verbatim, so the translation above can be audited. */
  readonly extractionMethodRaw: string;
  /** The upstream transaction-type token, verbatim, for the same reason. */
  readonly transactionTypeRaw: string;
  readonly confidenceBps: number | null;
  readonly confidenceBand: ConfidenceBand | null;
  readonly confidenceReason: string;
}

export interface TransactionInsert {
  readonly id: string;
  readonly accountId: string;
  readonly sourceEventId?: string | null;
  readonly transactionDate: string;
  readonly postingDate?: string | null;
  readonly payee?: string;
  readonly merchant?: string;
  readonly memo?: string;
  readonly categoryId?: string | null;
  readonly transactionType: LedgerTransactionType;
  readonly amount: Money;
  readonly outflow: Money;
  readonly inflow: Money;
  readonly currency?: string;
  readonly status: TransactionStatus;
  readonly verificationLevel: VerificationLevel;
  readonly duplicateKey?: string | null;
  /**
   * Optional so every write path that predates spec 08 keeps compiling, and absent means UNKNOWN
   * rather than absent: the repository stores `unknown` for the method and empty strings for the
   * references, which is exactly what a row with no provenance is. K4 is then a property a query can
   * check — count the rows whose method is `unknown` or whose source reference is empty — rather than
   * something a loader claims about itself.
   */
  readonly provenance?: TransactionProvenance;
}

/** Kinds of relationship between two transactions. Matches the DDL `link_type` CHECK. */
export const TRANSACTION_LINK_TYPES = [
  'suspected_duplicate',
  'pending_to_posted',
  'transfer_pair',
  'correction',
] as const;
export type TransactionLinkType = (typeof TRANSACTION_LINK_TYPES)[number];

/** How a human or a later fact settled a link. Matches the DDL `resolution` CHECK. */
export const LINK_RESOLUTIONS = ['confirmed', 'rejected', 'deferred'] as const;
export type LinkResolution = (typeof LINK_RESOLUTIONS)[number];

/**
 * One `transaction_links` row. Contract 02 §5.2 forbids automatically deleting a suspected
 * duplicate, so the suspicion is RECORDED here and resolved deliberately. Neither the link
 * nor either transaction is ever removed by this tier.
 */
export interface TransactionLinkRow {
  readonly id: string;
  readonly fromTransactionId: string;
  readonly toTransactionId: string;
  readonly linkType: TransactionLinkType;
  /** Basis points, integer, 0..10000. A confidence is not money and never becomes money. */
  readonly confidenceBps: number;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly resolution: LinkResolution | null;
}

export interface TransactionLinkInsert {
  readonly id: string;
  readonly fromTransactionId: string;
  readonly toTransactionId: string;
  readonly linkType: TransactionLinkType;
  readonly confidenceBps?: number;
}

// ---------------------------------------------------------------------------
// obligations
// ---------------------------------------------------------------------------

/** Lifecycle of an obligation. Matches the DDL `status` CHECK. */
export const OBLIGATION_STATUSES = ['scheduled', 'paid', 'skipped', 'overdue'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

/**
 * One `obligations` row.
 *
 * `priority` is stored as the INTEGER ordinal of `OBLIGATION_PRIORITIES` — that tuple's index
 * IS the funding sequence (contract 01 §5.2), so an integer column sorts in harm order without
 * a lookup table. Convert with the two helpers below rather than by hand.
 */
export interface ObligationRow {
  readonly id: string;
  readonly accountId: string | null;
  readonly name: string;
  readonly kind: string;
  readonly amount: Money;
  readonly minimumAmount: Money | null;
  readonly currency: string;
  readonly dueDate: string;
  readonly graceDate: string | null;
  readonly recurrence: ObligationFrequency;
  readonly status: ObligationStatus;
  readonly priority: ObligationPriority;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ObligationInsert {
  readonly id: string;
  readonly accountId?: string | null;
  readonly name: string;
  readonly kind: string;
  readonly amount: Money;
  readonly minimumAmount: Money | null;
  readonly currency?: string;
  readonly dueDate: string;
  readonly graceDate?: string | null;
  readonly recurrence: ObligationFrequency;
  readonly status: ObligationStatus;
  readonly priority: ObligationPriority;
}

/** Harm tier to its stored ordinal. Lower sorts first, which is the funding sequence. */
export function priorityOrdinal(priority: ObligationPriority): number {
  return OBLIGATION_PRIORITIES.indexOf(priority);
}

/** Stored ordinal back to its harm tier. An unknown ordinal is the least severe tier. */
export function priorityFromOrdinal(ordinal: number): ObligationPriority {
  return OBLIGATION_PRIORITIES[ordinal] ?? OBLIGATION_PRIORITIES[OBLIGATION_PRIORITIES.length - 1] ?? 'P3';
}

// ---------------------------------------------------------------------------
// decisions
// ---------------------------------------------------------------------------

/**
 * Where a decision ended up. Matches the DDL `outcome` CHECK.
 *
 * NAMED `...State`, DELIBERATELY. The browser tier already exports a `DecisionOutcome`
 * (`src/features/decisions/decisionRecord.types.ts`) and it means something entirely
 * different: an OBSERVED-OUTCOME RECORD carrying `reviewedAt`, `actualNetEffect`,
 * `predictionError`, and an attribution. This one is the store's small enumerated STATE
 * column. No file imports both today, so the collision was never a bug — but one identifier
 * standing for two unrelated things is a trap for the first module that needs both, and the
 * server side is the one that can be renamed without touching the shipped browser tier.
 * See contract 06 §3.2 ADDENDUM A2.
 *
 * `'superseded'` is retained here because it is in the applied DDL's CHECK and an applied
 * migration is never edited (§5.1). It is NOT assignable by a caller: currentness is DERIVED
 * (`NOT EXISTS (successor)`), and the write path refuses it. See ADDENDUM A1.
 */
export const DECISION_OUTCOME_STATES = ['pending', 'confirmed', 'reverted', 'superseded'] as const;
export type DecisionOutcomeState = (typeof DECISION_OUTCOME_STATES)[number];

/**
 * The subset a caller may assign at insert time. `'superseded'` is excluded because the
 * predecessor of a supersede is never edited, so no row can legitimately describe itself
 * that way — the guard in `decisionsRepository` refuses it (§3.2 ADDENDUM A1).
 */
export const ASSIGNABLE_DECISION_OUTCOME_STATES = ['pending', 'confirmed', 'reverted'] as const;
export type AssignableDecisionOutcomeState = (typeof ASSIGNABLE_DECISION_OUTCOME_STATES)[number];

/**
 * One `decisions` row. The registry is APPEND-ONLY (§3.2, §8.1): a decision is superseded by
 * a NEW row and never edited, which is why there is no update input for this table at all.
 */
export interface DecisionRow {
  readonly id: string;
  readonly decidedAt: string;
  readonly kind: string;
  readonly rationale: string;
  readonly expectedEffectMilliunits: Money | null;
  readonly observedEffectMilliunits: Money | null;
  /**
   * The stored state. Read as the full enum, because a store repaired by hand may hold
   * `'superseded'` even though this tier's write path will not assign it.
   */
  readonly outcome: DecisionOutcomeState;
  /** Set on the SUCCESSOR row; points at the decision it replaces. */
  readonly supersedesDecisionId: string | null;
  readonly auditVersion: number;
}

export interface DecisionInsert {
  readonly id: string;
  readonly decidedAt: string;
  readonly kind: string;
  readonly rationale?: string;
  readonly expectedEffectMilliunits: Money | null;
  readonly observedEffectMilliunits: Money | null;
  /**
   * Narrowed to the ASSIGNABLE subset: a caller cannot type `'superseded'` here, and the
   * repository refuses it at run time too for a caller that reaches this through `unknown`.
   */
  readonly outcome?: AssignableDecisionOutcomeState;
}

// ---------------------------------------------------------------------------
// fx_rates — contract 06 §4.4. Added by: PFOS Contract 06 / Phase 1.3.
// ---------------------------------------------------------------------------

/**
 * One `fx_rates` row: one unit of `baseCurrency` equals `rateNum / rateDen` units of
 * `quoteCurrency`. An INTEGER PAIR, never a float — §4.4, and exactly the shape the browser
 * tier's own `FxRate` already carries (`perUnitNum` / `perUnitDen`), because the two tiers
 * convert through the same `mulRatio` and therefore need the same representation.
 *
 * `source` and `asOf` are not decoration: contract 03 §8.3 requires every rate to carry
 * where it came from and when, so a conversion can be re-derived and audited rather than
 * trusted.
 */
export interface FxRateRow {
  readonly id: string;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rateNum: number;
  readonly rateDen: number;
  readonly asOf: string;
  readonly source: string;
  readonly recordedAt: string;
}

export interface FxRateInsert {
  readonly id: string;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  /** Integer numerator. Guarded before the statement is prepared (§4.4). */
  readonly rateNum: number;
  /** Integer denominator, strictly positive. Guarded, and also a DDL CHECK. */
  readonly rateDen: number;
  readonly asOf: string;
  readonly source: string;
}

// ---------------------------------------------------------------------------
// audit_log
// ---------------------------------------------------------------------------

/**
 * One `audit_log` row. Contract 02 §9 requires an entry for every mutation of a financial
 * record, so every write path in `repositories/` appends one inside the same transaction as
 * the mutation it describes.
 *
 * `detail` deliberately carries column names and identifiers, never amounts: an audit trail
 * that restates the figure would put money outside the guarded columns.
 */
export interface AuditLogRow {
  readonly id: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly action: string;
  readonly entityTable: string;
  readonly entityId: string | null;
  readonly detail: string;
  readonly auditVersion: number;
}
