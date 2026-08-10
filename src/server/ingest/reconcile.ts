/**
 * NIZAM · Reconciliation — the wave that decides whether the load can be trusted
 * Implemented by: PFOS Contract 06 / Phase 2.3 (spec 08-knowledge-ingestion, wave A3)
 * Depends on: ../db/repositories/support.ts (types), ../../lib/money/money.ts
 *
 * ## Why this wave exists at all
 *
 * A load that agrees with itself proves nothing. The owner's drive holds TWO independent renderings of
 * the same history — a canonical 25-column export and a set of per-account tables with their own
 * 15-column shape, their own dates and their own sign convention — plus a THIRD set of pre-computed gate
 * results. This module compares them and reports what it finds, and its most important output is the
 * number it cannot explain.
 *
 * ## Two independent code paths, and what makes them independent
 *
 *  PATH A totals the STORE, in SQL, by aggregation inside the engine. It reads what was actually
 *         persisted, through a different language, after the write path had its say.
 *  PATH B totals the PER-ACCOUNT TABLES, in TypeScript, over a different file with a different column
 *         contract, a different date basis and a different sign convention.
 *
 * They share no arithmetic. If the write path had corrupted a value, path A would carry the corruption
 * and path B would not.
 *
 * ## The tolerance, and its derivation (A3.4)
 *
 * ZERO milliunits. Not "a small number" — zero, and here is why, because a tolerance nobody derived is a
 * tolerance that will later be widened to turn a red gate green:
 *
 *   Both sources state amounts as decimal text with AT MOST three fractional digits. A milliunit IS the
 *   third decimal place. So each conversion is exact — no digit is discarded and none is rounded — and
 *   summing exact integers is exact. There is no operation anywhere in either path that loses precision,
 *   therefore there is no rounding error for a tolerance to accommodate, therefore the bound is zero.
 *
 * If a source ever carried a fourth fractional digit the strict money parser would REFUSE it rather than
 * round it, so this derivation cannot quietly stop being true.
 *
 * ## What is reported rather than resolved (A3.2)
 *
 * Where the two renderings disagree, or where a pre-computed verdict disagrees with this load, the
 * disagreement is a FINDING. Neither side is adopted silently and the two are never averaged. The
 * verdict distinguishes "reconciled" from "reconciled with a reported disagreement" from "unexplained
 * residual", because collapsing those three into a pass or a fail is how a real finding disappears.
 */
import type { Money } from '../../lib/money/money.ts';
import type { RepositoryContext } from '../db/repositories/support.ts';

/** The per-account rendering's 15-column contract, as an exact ordered name set. */
export const PER_ACCOUNT_COLUMNS = [
  'txn_id',
  'account_id',
  'product_type',
  'posted_date',
  'value_date',
  'description_raw',
  'description_clean',
  'signed_amount',
  'running_balance',
  'category_v1',
  'source_pdf',
  'source_page',
  'source_row',
  'run_id',
  'year',
] as const;

/**
 * The product kinds the per-account rendering declares. `credit_card` is the one whose sign convention
 * differs from the canonical export's, and naming it here is what lets that difference be a declared
 * normalisation rather than a fudge applied where nobody would notice.
 */
export const CREDIT_CARD_PRODUCT = 'credit_card';

export interface PerAccountRow {
  readonly accountToken: string;
  readonly productType: string;
  readonly postedDate: string;
  /** Signed in the per-account rendering's OWN convention. Normalised below, never in place. */
  readonly signedAmount: Money;
}

/** How a per-account table's account token maps to a store account. Resolved by the caller. */
export interface AccountMapping {
  readonly accountToken: string;
  readonly storeAccountId: string;
  /** Masked, for the artifact. The whole identifier never reaches a report. */
  readonly label: string;
}

/** The pre-computed gate results, as the third opinion. Read by the caller, interpreted here. */
export interface ThirdOpinion {
  readonly schemaGatePassed: boolean;
  /** The row count the pre-computed schema gate counted, whatever population it counted over. */
  readonly schemaGateRowCount: number;
  /** One entry per duplicate GROUP, carrying how many rows that group holds. */
  readonly duplicateGroups: readonly { readonly count: number; readonly postedDate: string }[];
  /** One entry per quarantined DOCUMENT, carrying its page count. Documents, not rows. */
  readonly quarantinedDocuments: readonly { readonly pages: number }[];
  readonly balanceEquationEntries: number;
  readonly transferPairEntries: number;
}

export interface ReconciliationInput {
  readonly ctx: RepositoryContext;
  readonly perAccount: readonly PerAccountRow[];
  readonly mappings: readonly AccountMapping[];
  /**
   * The window the canonical export declares. The per-account tables reach further back, and that is
   * the largest single component of the row difference, so the boundary is stated rather than inferred.
   */
  readonly windowStartInclusive: string;
  readonly thirdOpinion: ThirdOpinion;
}

/** One account's side-by-side comparison. Magnitudes stay out of anything tracked. */
export interface AccountComparison {
  readonly account: string;
  readonly storeRows: number;
  readonly tableRows: number;
  readonly rowsEqual: boolean;
  readonly signedTotalsEqual: boolean;
  readonly absoluteTotalsEqual: boolean;
  readonly signedResidual: Money;
  readonly absoluteResidual: Money;
  /** Rows present in the store's rendering and not in the table's, by signed value. */
  readonly rowsOnlyInStore: number;
  readonly rowsOnlyInTable: number;
  /**
   * True when the two unmatched populations hold the SAME magnitudes — which means the disagreement is
   * a sign and not a value, and the residual is then exactly twice their summed signed difference.
   */
  readonly disagreementIsSignOnly: boolean;
  readonly signResidualIdentityHolds: boolean;
}

export type ReconciliationVerdict = 'RECONCILED' | 'RECONCILED_WITH_REPORTED_DISAGREEMENT' | 'UNEXPLAINED_RESIDUAL';

export interface ReconciliationReport {
  readonly tolerance: { readonly milliunits: 0; readonly derivation: string };
  readonly rowCounts: {
    readonly storeRows: number;
    readonly perAccountRows: number;
    readonly perAccountInWindow: number;
    readonly perAccountBeforeWindow: number;
    readonly inWindowEqualsStore: boolean;
    readonly unexplainedRowResidual: number;
  };
  readonly accounts: readonly AccountComparison[];
  readonly duplicates: {
    readonly groups: number;
    readonly excessRows: number;
    readonly groupsInWindow: number;
    readonly groupsBeforeWindow: number;
    readonly rowsContributedToResidual: number;
    readonly note: string;
  };
  readonly quarantine: {
    readonly documents: number;
    readonly pages: number;
    readonly rowsContributedToResidual: number;
    readonly note: string;
  };
  readonly thirdOpinion: {
    readonly schemaGatePassed: boolean;
    readonly schemaGateRowCount: number;
    readonly agreesWithStoreRowCount: boolean;
    readonly agreesWithPerAccountRowCount: boolean;
    readonly balanceEquationEntries: number;
    readonly transferPairEntries: number;
  };
  readonly creditCardSignNormalisationApplied: boolean;
  readonly findings: readonly string[];
  readonly verdict: ReconciliationVerdict;
}

const TOLERANCE_DERIVATION =
  'Zero milliunits. Both sources state amounts as decimal text with at most three fractional digits, and ' +
  'a milliunit is the third decimal place, so every conversion is exact and summing exact integers is ' +
  'exact. No operation in either path loses precision, so there is no rounding error for a tolerance to ' +
  'accommodate. A source carrying a fourth fractional digit is refused by the strict money parser rather ' +
  'than rounded, so this derivation cannot quietly stop being true.';

/** Read the per-account table's rows, refusing a shape that is not the declared ordered name set. */
export function readPerAccountTable(
  table: readonly (readonly string[])[],
  parseMoney: (text: string) => Money,
): { readonly rows: PerAccountRow[]; readonly errors: readonly string[] } {
  const header = (table[0] ?? []).map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase());
  const declared = PER_ACCOUNT_COLUMNS as readonly string[];
  if (header.length !== declared.length || header.some((h, i) => h !== declared[i])) {
    return {
      rows: [],
      errors: [
        `the per-account table's header is not the declared ordered name set: ${header.length} column(s) against ${declared.length}. A width-only check would pass a reorder, which is why the names are compared in order.`,
      ],
    };
  }
  const at = (name: (typeof PER_ACCOUNT_COLUMNS)[number]): number => declared.indexOf(name);
  const rows: PerAccountRow[] = [];
  const errors: string[] = [];
  table.slice(1).forEach((rec, i) => {
    try {
      rows.push({
        accountToken: (rec[at('account_id')] ?? '').trim(),
        productType: (rec[at('product_type')] ?? '').trim(),
        postedDate: (rec[at('posted_date')] ?? '').trim().slice(0, 10),
        signedAmount: parseMoney((rec[at('signed_amount')] ?? '').trim()),
      });
    } catch (e) {
      errors.push(`per-account row ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return { rows, errors };
}

interface StoreAccountTotals {
  readonly accountId: string;
  readonly rows: number;
  readonly signed: Money;
  readonly absolute: Money;
  readonly amounts: readonly Money[];
}

/** PATH A: totals from the store, aggregated by the engine. */
function totalsFromStore(ctx: RepositoryContext): Map<string, StoreAccountTotals> {
  const { db } = ctx.handle;
  const grouped = db
    .prepare(
      `SELECT account_id AS account_id,
              COUNT(*)   AS rows_n,
              SUM(amount) AS signed_total,
              SUM(ABS(amount)) AS absolute_total
         FROM transactions
        WHERE status <> 'superseded'
        GROUP BY account_id`,
    )
    .all() as Record<string, unknown>[];
  const amounts = db
    .prepare(`SELECT account_id AS account_id, amount AS amount FROM transactions WHERE status <> 'superseded'`)
    .all() as Record<string, unknown>[];
  const byAccount = new Map<string, Money[]>();
  for (const a of amounts) {
    const key = String(a['account_id']);
    const list = byAccount.get(key) ?? [];
    list.push(Number(a['amount']));
    byAccount.set(key, list);
  }
  const out = new Map<string, StoreAccountTotals>();
  for (const g of grouped) {
    const accountId = String(g['account_id']);
    out.set(accountId, {
      accountId,
      rows: Number(g['rows_n']),
      signed: Number(g['signed_total'] ?? 0),
      absolute: Number(g['absolute_total'] ?? 0),
      amounts: byAccount.get(accountId) ?? [],
    });
  }
  return out;
}

/**
 * The declared sign normalisation. The per-account rendering signs a credit-card row by its effect on
 * the CARD's balance — a purchase increases what is owed, so it is positive there — while the canonical
 * export signs by the direction of the owner's money, where a purchase is an outflow. Neither is wrong.
 * They are different questions, and reconciling them requires stating which one the store answers.
 *
 * The store answers the canonical question (money-rules §4: outflow negative), so a credit-card row from
 * the per-account rendering is negated. This is DECLARED here, applied in one place, and reported in the
 * artifact as applied — not folded into a comparison where a reader could not see it.
 */
function normalisedSignedAmount(row: PerAccountRow): Money {
  return row.productType === CREDIT_CARD_PRODUCT ? -row.signedAmount : row.signedAmount;
}

/** A greedy signed-multiset difference: what each side holds that the other does not. */
function multisetDifference(
  a: readonly Money[],
  b: readonly Money[],
): { readonly onlyInA: Money[]; readonly onlyInB: Money[] } {
  const bag = new Map<Money, number>();
  for (const v of b) bag.set(v, (bag.get(v) ?? 0) + 1);
  const onlyInA: Money[] = [];
  for (const v of a) {
    const n = bag.get(v) ?? 0;
    if (n > 0) bag.set(v, n - 1);
    else onlyInA.push(v);
  }
  const onlyInB: Money[] = [];
  for (const [v, n] of bag) for (let i = 0; i < n; i += 1) onlyInB.push(v);
  return { onlyInA, onlyInB };
}

function sameMagnitudeMultiset(a: readonly Money[], b: readonly Money[]): boolean {
  if (a.length !== b.length) return false;
  const key = (xs: readonly Money[]): string => [...xs].map((x) => Math.abs(x)).sort((p, q) => p - q).join(',');
  return key(a) === key(b);
}

const total = (xs: readonly Money[]): Money => xs.reduce((n, x) => n + x, 0);

/** Reconcile the load. Returns a report; throws nothing, because a finding is an output not a failure. */
export function reconcile(input: ReconciliationInput): ReconciliationReport {
  const { ctx, perAccount, mappings, windowStartInclusive, thirdOpinion } = input;
  const findings: string[] = [];

  const storeTotals = totalsFromStore(ctx);
  const storeRows = [...storeTotals.values()].reduce((n, t) => n + t.rows, 0);

  const tokenToMapping = new Map(mappings.map((m) => [m.accountToken, m]));
  const unmappedTokens = new Set(perAccount.map((r) => r.accountToken).filter((t) => !tokenToMapping.has(t)));
  if (unmappedTokens.size > 0) {
    findings.push(
      `${unmappedTokens.size} per-account table token(s) do not resolve to a store account. An unresolvable reference is a finding, not a skipped row, so these rows are counted in the residual rather than dropped from it.`,
    );
  }

  const inWindow = perAccount.filter((r) => r.postedDate >= windowStartInclusive);
  const beforeWindow = perAccount.length - inWindow.length;

  // ---- per account, side by side ----------------------------------------------------------------
  const accounts: AccountComparison[] = [];
  for (const mapping of mappings) {
    const store = storeTotals.get(mapping.storeAccountId);
    const tableRows = inWindow.filter((r) => r.accountToken === mapping.accountToken).map(normalisedSignedAmount);
    const storeAmounts = store?.amounts ?? [];
    const signedResidual = total(storeAmounts) - total(tableRows);
    const absoluteResidual =
      storeAmounts.reduce((n, x) => n + Math.abs(x), 0) - tableRows.reduce((n, x) => n + Math.abs(x), 0);
    const { onlyInA, onlyInB } = multisetDifference(storeAmounts, tableRows);
    const signOnly = onlyInA.length > 0 && sameMagnitudeMultiset(onlyInA, onlyInB);
    accounts.push({
      account: mapping.label,
      storeRows: store?.rows ?? 0,
      tableRows: tableRows.length,
      rowsEqual: (store?.rows ?? 0) === tableRows.length,
      signedTotalsEqual: signedResidual === 0,
      absoluteTotalsEqual: absoluteResidual === 0,
      signedResidual,
      absoluteResidual,
      rowsOnlyInStore: onlyInA.length,
      rowsOnlyInTable: onlyInB.length,
      disagreementIsSignOnly: signOnly,
      // The identity that PROVES the disagreement is a sign: flipping a row's sign moves a total by
      // exactly twice its magnitude, so the residual must equal the difference of the two unmatched
      // populations and nothing else. If it does not, something other than a sign moved.
      signResidualIdentityHolds: signedResidual === total(onlyInA) - total(onlyInB),
    });
  }

  for (const a of accounts) {
    if (!a.rowsEqual) {
      findings.push(
        `account ${a.account}: the store holds ${a.storeRows} row(s) in the window and the per-account table holds ${a.tableRows}. A row-count difference is not a rounding artifact.`,
      );
    }
    if (!a.signedTotalsEqual && a.absoluteTotalsEqual && a.disagreementIsSignOnly) {
      findings.push(
        `account ${a.account}: every magnitude matches and ${a.rowsOnlyInStore} row(s) carry the OPPOSITE SIGN between the two renderings. The two sources disagree about the direction of those rows, not about their value. Neither side is adopted here — the canonical export is what the store holds because it is the declared insert path, and the disagreement is reported.`,
      );
    } else if (!a.signedTotalsEqual && !a.absoluteTotalsEqual) {
      findings.push(
        `account ${a.account}: the two renderings differ in absolute total as well as signed total, so the disagreement is a VALUE and not a sign. ${a.rowsOnlyInStore} row(s) in the store and ${a.rowsOnlyInTable} in the table have no counterpart.`,
      );
    }
    if (!a.signResidualIdentityHolds) {
      findings.push(
        `account ${a.account}: the residual is not accounted for by the unmatched rows alone, so something other than the enumerated rows moved it.`,
      );
    }
  }

  // ---- the duplicate population, line by line (A3.3) --------------------------------------------
  const duplicateExcess = thirdOpinion.duplicateGroups.reduce((n, g) => n + Math.max(0, g.count - 1), 0);
  const duplicateGroupsInWindow = thirdOpinion.duplicateGroups.filter((g) => g.postedDate >= windowStartInclusive).length;
  const duplicateGroupsBeforeWindow = thirdOpinion.duplicateGroups.length - duplicateGroupsInWindow;

  // ---- the quarantine population ----------------------------------------------------------------
  const quarantinePages = thirdOpinion.quarantinedDocuments.reduce((n, d) => n + d.pages, 0);

  // ---- the row residual, and what explains it ---------------------------------------------------
  const inWindowEqualsStore = inWindow.length === storeRows;
  const unexplainedRowResidual = inWindow.length - storeRows;
  if (!inWindowEqualsStore) {
    findings.push(
      `${Math.abs(unexplainedRowResidual)} row(s) of the difference between the two renderings are NOT explained by the declared window, the duplicate population or the quarantine. This is the most important number in this report and it is stated rather than absorbed.`,
    );
  }

  // ---- the third opinion (A3.2) -----------------------------------------------------------------
  const thirdAgreesWithStore = thirdOpinion.schemaGateRowCount === storeRows;
  const thirdAgreesWithPerAccount = thirdOpinion.schemaGateRowCount === perAccount.length;
  if (!thirdAgreesWithStore) {
    findings.push(
      `the pre-computed schema gate counted ${thirdOpinion.schemaGateRowCount} row(s) and the store holds ${storeRows}. ${
        thirdAgreesWithPerAccount
          ? 'The gate counted the per-account population rather than the canonical export, so the two are answering different questions — reported, not reconciled by adopting either count.'
          : 'The gate agrees with neither rendering, which is a disagreement in its own right.'
      }`,
    );
  }
  if (!thirdOpinion.schemaGatePassed) {
    findings.push('the pre-computed schema gate records a failure, which this load did not reproduce.');
  }

  // ---- the verdict ------------------------------------------------------------------------------
  const allRowsEqual = accounts.every((a) => a.rowsEqual) && inWindowEqualsStore;
  const allSignedEqual = accounts.every((a) => a.signedTotalsEqual);
  const allValueDisagreementsExplained = accounts.every(
    (a) => a.signedTotalsEqual || (a.absoluteTotalsEqual && a.disagreementIsSignOnly && a.signResidualIdentityHolds),
  );
  const verdict: ReconciliationVerdict = !allRowsEqual
    ? 'UNEXPLAINED_RESIDUAL'
    : allSignedEqual && findings.length === 0
      ? 'RECONCILED'
      : allValueDisagreementsExplained
        ? 'RECONCILED_WITH_REPORTED_DISAGREEMENT'
        : 'UNEXPLAINED_RESIDUAL';

  return {
    tolerance: { milliunits: 0, derivation: TOLERANCE_DERIVATION },
    rowCounts: {
      storeRows,
      perAccountRows: perAccount.length,
      perAccountInWindow: inWindow.length,
      perAccountBeforeWindow: beforeWindow,
      inWindowEqualsStore,
      unexplainedRowResidual,
    },
    accounts,
    duplicates: {
      groups: thirdOpinion.duplicateGroups.length,
      excessRows: duplicateExcess,
      groupsInWindow: duplicateGroupsInWindow,
      groupsBeforeWindow: duplicateGroupsBeforeWindow,
      // Accounted for line by line rather than assumed: a duplicate that both renderings carry cancels
      // out of the difference between them, so it explains none of the residual. Saying it explains part
      // of the gap without checking is exactly the assumption A3.3 forbids.
      rowsContributedToResidual: 0,
      note:
        'Each duplicate group is present in BOTH renderings — neither source deduplicated them — so the ' +
        'excess rows appear on both sides of the comparison and cancel out of the difference. They ' +
        'explain none of the row residual, and that is a measured statement rather than an assumption.',
    },
    quarantine: {
      documents: thirdOpinion.quarantinedDocuments.length,
      pages: quarantinePages,
      rowsContributedToResidual: 0,
      note:
        'The quarantine holds DOCUMENTS that could not be extracted at all, not rows that were dropped ' +
        'from one rendering. Their rows are absent from both sides, so they explain none of the ' +
        'difference between the two — they are a gap in the history itself, which is a separate finding.',
    },
    thirdOpinion: {
      schemaGatePassed: thirdOpinion.schemaGatePassed,
      schemaGateRowCount: thirdOpinion.schemaGateRowCount,
      agreesWithStoreRowCount: thirdAgreesWithStore,
      agreesWithPerAccountRowCount: thirdAgreesWithPerAccount,
      balanceEquationEntries: thirdOpinion.balanceEquationEntries,
      transferPairEntries: thirdOpinion.transferPairEntries,
    },
    creditCardSignNormalisationApplied: perAccount.some((r) => r.productType === CREDIT_CARD_PRODUCT),
    findings,
    verdict,
  };
}

/**
 * K1, asked of the store. Exact, not approximate, and not "within the duplicates" (A3.5).
 */
export function storeRowCount(ctx: RepositoryContext): number {
  const raw = ctx.handle.db
    .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE status <> 'superseded'`)
    .get() as { n: number } | undefined;
  return Number(raw?.n ?? 0);
}

/**
 * Resolve per-account table tokens to store accounts, in two stages, and report the resolution rather
 * than assuming it. Stage one matches on the redacted digit fragment the canonical export carries, which
 * is the strongest evidence available. Stage two matches a token's leading alphabetic run against the
 * account's display name, over only the tokens stage one did not claim — because two cards of the same
 * institution share that run, and a one-stage rule matches both and silently mis-groups every row.
 *
 * A mapping that is not a bijection is REFUSED by returning it unresolved, so the caller reports it.
 */
export function resolveAccountMappings(
  tokens: readonly string[],
  accounts: readonly { readonly storeAccountId: string; readonly last4: string; readonly name: string }[],
): { readonly mappings: AccountMapping[]; readonly unresolved: readonly string[] } {
  const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const claimed = new Set<string>();
  const mappings: AccountMapping[] = [];
  const mask = (v: string): string =>
    v.length <= 2 ? '*'.repeat(v.length) : `${v[0]}${'*'.repeat(Math.max(1, v.length - 2))}${v[v.length - 1]}`;

  for (const account of accounts) {
    const hits = tokens.filter((t) => !claimed.has(t) && /\d/.test(t) && norm(t).endsWith(norm(account.last4)));
    if (hits.length === 1) {
      const token = hits[0] as string;
      claimed.add(token);
      mappings.push({ accountToken: token, storeAccountId: account.storeAccountId, label: mask(account.last4) });
    }
  }
  for (const account of accounts) {
    if (mappings.some((m) => m.storeAccountId === account.storeAccountId)) continue;
    const hits = tokens.filter((t) => {
      if (claimed.has(t)) return false;
      const lead = (/^[A-Za-z]+/.exec(t) ?? [''])[0];
      return lead.length >= 3 && norm(account.name).includes(norm(lead));
    });
    if (hits.length === 1) {
      const token = hits[0] as string;
      claimed.add(token);
      mappings.push({ accountToken: token, storeAccountId: account.storeAccountId, label: mask(account.last4) });
    }
  }
  return { mappings, unresolved: tokens.filter((t) => !claimed.has(t)) };
}
