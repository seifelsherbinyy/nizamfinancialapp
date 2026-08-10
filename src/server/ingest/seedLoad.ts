/**
 * NIZAM · The tier-1 seed load — spec 08 wave A2 (tasks A2.1, A2.2, A2.4, A2.5)
 * Implemented by: PFOS Contract 06 / Phase 2.2 (spec 08-knowledge-ingestion, wave A2)
 * Depends on: ../db/repositories/*, ../../lib/money/money.ts, ../../lib/ledger/ledger.types.ts (types only)
 *
 * ## What this module is, and what it deliberately is not
 *
 * It is the write path from already-parsed canonical rows into the server store. It is NOT a parser:
 * A2.1 says do not write a second one, so the 25-column contract is read by the ONE implementation in
 * `src/features/import/ledgerImport.ts` — extended there with a strict policy — and this module takes
 * its output. The type import below is erased at runtime, so this tier still resolves without a bundler.
 *
 * ## The four properties this write path has, each mechanical rather than remembered
 *
 *  1. EVERY ROW PASSES THROUGH `source_events` FIRST (A2.2), keyed on channel plus an idempotency key
 *     that is unique in the DDL. That, and not a check in this file, is what makes a second run a no-op.
 *  2. IDS ARE DERIVED FROM CONTENT, never minted. A row's identity is a hash of the channel and its
 *     duplicate key, so the second run computes the same id, collides, and inserts nothing. An id from a
 *     counter or a clock would make every re-run look like new data.
 *  3. PROVENANCE IS CARRIED, AND UNKNOWN LOADS AS UNKNOWN (A2.4, K4). The extraction method, the source
 *     reference, the confidence and its reason travel with the row. A row whose extractor this
 *     repository cannot translate is stored as `unknown` and never as `manual`.
 *  4. A PERIOD CLOSES ON ARITHMETIC OR ON A STATED EXCEPTION (A2.5). The statements repository derives
 *     the close state from the balance equation and refuses an exception with no reason.
 *
 * ## What it reports, and what it refuses to report
 *
 * The report is COUNTS and IDENTITIES. It carries no monetary total, because the report is what a caller
 * writes into an artifact, and the invariant this spec is the first to actually test is that no real
 * financial value reaches a file. Totals are computed by wave A3, which keeps them in a gitignored
 * artifact and never in a tracked one. Account identities appear masked, never whole.
 */
import { createHash } from 'node:crypto';
import type { IngestExtractionMethod, IngestLedgerRow } from '../../lib/ledger/ledger.types.ts';
import type { AccountType } from '../../features/accounts/accounts.types.ts';
import { IngestionRefusalError } from '../db/errors.ts';
import { createAccountsRepository } from '../db/repositories/accountsRepository.ts';
import { createDocumentIndexRepository } from '../db/repositories/documentIndexRepository.ts';
import { createSourceEventsRepository } from '../db/repositories/sourceEventsRepository.ts';
import { createStatementsRepository } from '../db/repositories/statementsRepository.ts';
import { createTransactionsRepository } from '../db/repositories/transactionsRepository.ts';
import type { RepositoryContext } from '../db/repositories/support.ts';
import type { Money } from '../../lib/money/money.ts';

/** The channel every canonical-ledger row is keyed under. Part of the idempotency key. */
export const CANONICAL_LEDGER_CHANNEL = 'ledger:canonical';
/** The channel the artifact's own arrival is recorded under, once per artifact. */
export const ARTIFACT_CHANNEL = 'ingest:artifact';

/** One roster entry, resolved by the caller from the sources that actually declare each field. */
export interface SeedAccount {
  /** The redacted fragment the canonical export carries. At most four characters, per the DDL. */
  readonly last4: string;
  readonly name: string;
  readonly type: AccountType;
  /** Absent where the source does not state one — finding F21, not a zero. */
  readonly creditLimit?: Money | null;
}

export interface SeedLoadSource {
  /**
   * A reference to the artifact, resolved from the operator environment by the caller. This module
   * never constructs one and never carries a default: an unresolved reference fails closed upstream.
   */
  readonly artifactRef: string;
  /** The artifact's own content hash, as recorded at fetch time. */
  readonly artifactHash: string;
}

/** Everything worth knowing about a run, and nothing that is a monetary value. */
export interface SeedLoadReport {
  readonly rowsOffered: number;
  readonly sourceEventsAppended: number;
  readonly sourceEventsAlreadyPresent: number;
  /** The same key arriving with different bytes. A finding, never an overwrite. */
  readonly sourceEventHashConflicts: number;
  readonly transactionsInserted: number;
  readonly transactionsAlreadyPresent: number;
  readonly rowsFlaggedDuplicateBySource: number;
  readonly rowsWithUnresolvedAccount: number;
  readonly accountsCreated: number;
  readonly accountsAlreadyPresent: number;
  /** Per account, masked. The count is the fact; the identity is not. */
  readonly rowsPerAccount: readonly { readonly account: string; readonly rows: number }[];
  readonly provenance: {
    readonly unknownExtractionMethod: number;
    readonly absentSourceReference: number;
    readonly withConfidenceBand: number;
    readonly withConfidenceScore: number;
    readonly withNeitherConfidence: number;
    readonly byExtractionMethod: Readonly<Record<string, number>>;
  };
  readonly statements: {
    readonly recorded: number;
    readonly balanced: number;
    readonly exceptionAccepted: number;
    readonly exceptionReasons: Readonly<Record<string, number>>;
  };
}

export interface SeedLoadOptions {
  readonly ctx: RepositoryContext;
  readonly rows: readonly IngestLedgerRow[];
  readonly accounts: readonly SeedAccount[];
  readonly source: SeedLoadSource;
}

/** Mask any token that could identify an account before it reaches a report. */
export function maskAccountToken(value: string): string {
  if (value.length <= 2) return '*'.repeat(value.length);
  return `${value[0]}${'*'.repeat(Math.max(1, value.length - 2))}${value[value.length - 1]}`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A stable account id, so a second run resolves to the same row rather than creating a second. */
export function accountIdFor(account: SeedAccount): string {
  return `acct_${sha256(`${account.name}\u0000${account.last4}`).slice(0, 24)}`;
}

/** A stable row identity. Content-derived, so re-running collides instead of appending. */
function transactionIdFor(duplicateKey: string): string {
  return `txn_${sha256(`${CANONICAL_LEDGER_CHANNEL}\u0000${duplicateKey}`).slice(0, 32)}`;
}

function sourceEventIdFor(duplicateKey: string): string {
  return `sev_${sha256(`${CANONICAL_LEDGER_CHANNEL}\u0000${duplicateKey}`).slice(0, 32)}`;
}

/**
 * The bytes a row's content hash is taken over. Every field of the row contract, in a fixed order, so a
 * row that changed anywhere upstream produces a different hash under the same idempotency key — which is
 * precisely the disagreement the repository reports rather than absorbs.
 */
function rowContentHash(row: IngestLedgerRow): string {
  const parts = [
    row.transaction_date,
    row.posting_date,
    row.payee,
    row.merchant,
    row.description,
    row.category,
    row.transaction_type_raw,
    String(row.outflow),
    String(row.inflow),
    String(row.amount),
    row.direction,
    row.currency,
    String(row.balance ?? ''),
    row.account,
    row.account_identifier,
    row.statement_date,
    row.statement_month,
    row.source_file,
    row.source_page_or_sheet,
    row.extraction_method_raw,
    String(row.confidence_bps ?? ''),
    row.confidence_band ?? '',
    row.confidence_reason,
    row.duplicate_key,
    String(row.is_duplicate),
    row.memo,
  ];
  return sha256(parts.join('\u0001'));
}

/** A period key. The grain the statements table is unique on. */
function periodKeyOf(accountId: string, statementMonth: string): string {
  return `stmt_${sha256(`${accountId}\u0000${statementMonth}`).slice(0, 24)}`;
}

/**
 * Load the canonical rows into the store.
 *
 * Refuses, rather than skipping, when a row names an account the roster does not hold: an unresolvable
 * reference is a finding (the rule wave A1 established for the limit table), and skipping the row would
 * make the store's count disagree with the source's while every individual check still passed.
 */
export function loadCanonicalLedger(options: SeedLoadOptions): SeedLoadReport {
  const { ctx, rows, accounts, source } = options;
  const accountsRepo = createAccountsRepository(ctx);
  const eventsRepo = createSourceEventsRepository(ctx);
  const txnRepo = createTransactionsRepository(ctx);
  const statementsRepo = createStatementsRepository(ctx);

  // ---- the roster -------------------------------------------------------------------------------
  let accountsCreated = 0;
  let accountsAlreadyPresent = 0;
  const accountIdByLast4 = new Map<string, string>();
  for (const account of accounts) {
    const id = accountIdFor(account);
    accountIdByLast4.set(account.last4.trim().toLowerCase(), id);
    if (accountsRepo.get(id) !== null) {
      accountsAlreadyPresent += 1;
      continue;
    }
    accountsRepo.insert({
      id,
      name: account.name,
      type: account.type,
      onBudget: true,
      balance: 0,
      clearedBalance: 0,
      // Absent means absent. F21: the limit table states no limit for any account, and a zero would
      // read downstream as a limit of nothing rather than as a limit nobody stated.
      creditLimit: account.creditLimit ?? null,
      accountIdentifierLast4: account.last4.slice(0, 4),
      sortOrder: accountsCreated,
    });
    accountsCreated += 1;
  }

  // ---- the artifact's own arrival ---------------------------------------------------------------
  eventsRepo.append({
    id: `sev_${sha256(`${ARTIFACT_CHANNEL}\u0000${source.artifactHash}`).slice(0, 32)}`,
    channel: ARTIFACT_CHANNEL,
    idempotencyKey: source.artifactHash,
    contentHash: source.artifactHash,
    documentRef: source.artifactRef,
  });

  // ---- the rows ---------------------------------------------------------------------------------
  let sourceEventsAppended = 0;
  let sourceEventsAlreadyPresent = 0;
  let sourceEventHashConflicts = 0;
  let transactionsInserted = 0;
  let transactionsAlreadyPresent = 0;
  let rowsFlaggedDuplicateBySource = 0;
  let rowsWithUnresolvedAccount = 0;
  const rowsPerAccount = new Map<string, number>();
  const byExtractionMethod = new Map<string, number>();
  let unknownExtractionMethod = 0;
  let absentSourceReference = 0;
  let withConfidenceBand = 0;
  let withConfidenceScore = 0;
  let withNeitherConfidence = 0;

  interface PeriodAccumulator {
    accountId: string;
    statementMonth: string;
    periodStart: string;
    periodEnd: string;
    totalOutflow: Money;
    totalInflow: Money;
    firstBalance: Money | null;
    firstBalanceEffect: Money;
    lastBalance: Money | null;
  }
  const periods = new Map<string, PeriodAccumulator>();

  for (const row of rows) {
    const last4 = row.account_identifier.trim().toLowerCase();
    const accountId = accountIdByLast4.get(last4);
    if (accountId === undefined) {
      rowsWithUnresolvedAccount += 1;
      throw new IngestionRefusalError(
        'INGEST_ACCOUNT_UNRESOLVED',
        `NIZAM ingest: a canonical row names an account the roster does not hold (${maskAccountToken(row.account_identifier)}). An unresolvable reference is a finding, not a skipped row — skipping it would leave the store's count disagreeing with the source's while every other check still passed.`,
        { subject: maskAccountToken(row.account_identifier) },
      );
    }

    if (row.is_duplicate) rowsFlaggedDuplicateBySource += 1;

    const key = row.duplicate_key;
    const event = eventsRepo.append({
      id: sourceEventIdFor(key),
      channel: CANONICAL_LEDGER_CHANNEL,
      idempotencyKey: key,
      contentHash: rowContentHash(row),
      documentRef: source.artifactRef,
    });
    if (event.appended) sourceEventsAppended += 1;
    else sourceEventsAlreadyPresent += 1;
    if (!event.contentHashMatches) sourceEventHashConflicts += 1;

    const method: IngestExtractionMethod = row.extraction_method;
    byExtractionMethod.set(method, (byExtractionMethod.get(method) ?? 0) + 1);
    if (method === 'unknown') unknownExtractionMethod += 1;
    if (row.source_file === '' || row.source_page_or_sheet === '') absentSourceReference += 1;
    if (row.confidence_band !== null) withConfidenceBand += 1;
    else if (row.confidence_bps !== null) withConfidenceScore += 1;
    else withNeitherConfidence += 1;

    const txnId = transactionIdFor(key);
    if (txnRepo.get(txnId) !== null) {
      transactionsAlreadyPresent += 1;
    } else {
      txnRepo.insert({
        id: txnId,
        accountId,
        sourceEventId: event.row.id,
        transactionDate: row.transaction_date,
        postingDate: row.posting_date,
        payee: row.payee,
        merchant: row.merchant,
        memo: row.memo === '' ? row.description : row.memo,
        transactionType: row.transaction_type,
        amount: row.amount,
        outflow: Math.abs(row.outflow),
        inflow: Math.abs(row.inflow),
        currency: row.currency,
        status: 'posted',
        // A row is 'parser'-verified only when a parser is what actually extracted it. An unknown
        // extractor cannot make a verification claim, so it stays unverified.
        verificationLevel: method === 'parser' || method === 'ocr' ? 'parser' : 'unverified',
        duplicateKey: key,
        provenance: {
          sourceFile: row.source_file,
          sourcePageOrSheet: row.source_page_or_sheet,
          extractionMethod: method,
          extractionMethodRaw: row.extraction_method_raw,
          transactionTypeRaw: row.transaction_type_raw,
          confidenceBps: row.confidence_bps,
          confidenceBand: row.confidence_band,
          confidenceReason: row.confidence_reason,
        },
      });
      transactionsInserted += 1;
      eventsRepo.setParseState(event.row.id, 'parsed');
    }

    const masked = maskAccountToken(row.account_identifier);
    rowsPerAccount.set(masked, (rowsPerAccount.get(masked) ?? 0) + 1);

    // ---- the period this row belongs to --------------------------------------------------------
    const periodId = periodKeyOf(accountId, row.statement_month);
    const existing = periods.get(periodId);
    const effect = row.amount;
    if (existing === undefined) {
      periods.set(periodId, {
        accountId,
        statementMonth: row.statement_month,
        periodStart: row.transaction_date,
        periodEnd: row.transaction_date,
        totalOutflow: Math.abs(row.outflow),
        totalInflow: Math.abs(row.inflow),
        firstBalance: row.balance,
        firstBalanceEffect: row.balance === null ? 0 : effect,
        lastBalance: row.balance,
      });
    } else {
      if (row.transaction_date < existing.periodStart) existing.periodStart = row.transaction_date;
      if (row.transaction_date > existing.periodEnd) existing.periodEnd = row.transaction_date;
      existing.totalOutflow += Math.abs(row.outflow);
      existing.totalInflow += Math.abs(row.inflow);
      if (existing.firstBalance === null && row.balance !== null) {
        existing.firstBalance = row.balance;
        existing.firstBalanceEffect = effect;
      }
      if (row.balance !== null) existing.lastBalance = row.balance;
    }
  }

  // ---- the periods ------------------------------------------------------------------------------
  let recorded = 0;
  let balanced = 0;
  let exceptionAccepted = 0;
  const exceptionReasons = new Map<string, number>();
  for (const [periodId, period] of periods) {
    if (statementsRepo.get(periodId) !== null) continue;
    // The canonical export carries a running balance on only some of its rows, so an opening and a
    // closing balance are derivable for some periods and for others they are simply not in the source.
    // Where they are absent the period is recorded as an accepted exception WITH THAT AS THE REASON,
    // rather than as balanced against two zeros that would read downstream as measured.
    const derivable = period.firstBalance !== null && period.lastBalance !== null;
    const openingBalance = derivable ? (period.firstBalance ?? 0) - period.firstBalanceEffect : 0;
    const closingBalance = derivable ? (period.lastBalance ?? 0) : 0;
    const reason = derivable ? 'balance_equation_residual_nonzero' : 'opening_and_closing_balance_absent_in_source';
    const verdict = statementsRepo.record({
      id: periodId,
      accountId: period.accountId,
      statementMonth: period.statementMonth,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      openingBalance,
      closingBalance,
      totalOutflow: period.totalOutflow,
      totalInflow: period.totalInflow,
      exceptionReason: reason,
    });
    recorded += 1;
    if (verdict.balanced) balanced += 1;
    else {
      exceptionAccepted += 1;
      exceptionReasons.set(reason, (exceptionReasons.get(reason) ?? 0) + 1);
    }
  }

  return {
    rowsOffered: rows.length,
    sourceEventsAppended,
    sourceEventsAlreadyPresent,
    sourceEventHashConflicts,
    transactionsInserted,
    transactionsAlreadyPresent,
    rowsFlaggedDuplicateBySource,
    rowsWithUnresolvedAccount,
    accountsCreated,
    accountsAlreadyPresent,
    rowsPerAccount: [...rowsPerAccount.entries()]
      .map(([account, n]) => ({ account, rows: n }))
      .sort((a, b) => b.rows - a.rows),
    provenance: {
      unknownExtractionMethod,
      absentSourceReference,
      withConfidenceBand,
      withConfidenceScore,
      withNeitherConfidence,
      byExtractionMethod: Object.fromEntries(byExtractionMethod),
    },
    statements: {
      recorded,
      balanced,
      exceptionAccepted,
      exceptionReasons: Object.fromEntries(exceptionReasons),
    },
  };
}

/**
 * K4, asked of the STORE rather than of the loader. A count taken from the table itself, so it cannot be
 * satisfied by a report that merely claims the rows were fine.
 */
export function countRowsWithoutProvenance(ctx: RepositoryContext): {
  readonly total: number;
  readonly unknownExtractionMethod: number;
  readonly absentSourceReference: number;
  readonly defaultedManual: number;
} {
  const { db } = ctx.handle;
  const one = (sql: string): number => Number((db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0);
  return {
    total: one('SELECT COUNT(*) AS n FROM transactions'),
    unknownExtractionMethod: one(`SELECT COUNT(*) AS n FROM transactions WHERE extraction_method = 'unknown'`),
    absentSourceReference: one(
      `SELECT COUNT(*) AS n FROM transactions WHERE source_file = '' OR source_page_or_sheet = ''`,
    ),
    // A row claiming a human entered it must have been entered by a human. Anything the canonical
    // load produced with this value would be finding F23 having survived the fix.
    defaultedManual: one(
      `SELECT COUNT(*) AS n FROM transactions WHERE extraction_method = 'manual' AND extraction_method_raw <> 'manual'`,
    ),
  };
}

/** The document-index repository, re-exported so a caller wires one store handle rather than two. */
export { createDocumentIndexRepository };
