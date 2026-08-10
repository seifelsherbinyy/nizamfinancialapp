/**
 * NIZAM · The LIVE seed load and reconciliation — spec 08 waves A2 and A3, observed.
 * Implemented by: PFOS Contract 06 / Phase 2.3 (spec 08-knowledge-ingestion, waves A2 and A3)
 * Depends on: seedLoad.ts, reconcile.ts, @/features/import/ledgerImport, ../db/store.ts
 *
 * ## What this runs against, and why it may skip
 *
 * The tier-1 cache wave A0 materialised under `data/ledgers/`, which is gitignored because it holds real
 * account rows. On a clean checkout it is absent and these gates cannot be observed, so absence SKIPS by
 * default and FAILS when `NIZAM_REQUIRE_LIVE_LEDGER=1`. An operator can therefore demand observation, and
 * a build cannot claim to have performed one it skipped.
 *
 * ## Three disciplines this file follows, all of them because the repository is public
 *
 *  - INPUTS ARE FOUND BY PATTERN. The per-account tables are named after an institution and the last four
 *    digits of an account. No file name is written into this source.
 *  - EVERY DESTINATION IS PROVED IGNORED BEFORE A BYTE IS WRITTEN. `git check-ignore` is asked about the
 *    store path and the artifact path, and a path git does not ignore fails the gate. Trusting a
 *    `.gitignore` entry to still be there is how a real ledger reaches a public repository.
 *  - NO VALUE REACHES AN ASSERTION MESSAGE. Every expectation is a count, a boolean or a masked token.
 *    Money magnitudes exist only inside the gitignored artifact, where the residual has to be legible.
 *
 * ## And the gate is shown FAILING before it is trusted
 *
 * The tamper case swaps two column names in the canonical export and prints the row count that changed:
 * 1,216 parsed becomes 0 parsed. Zero rows changed would have meant the tamper never applied.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCsv, parseLedgerCsvStrict } from '@/features/import/ledgerImport';
import { LEDGER_COLUMNS } from '@/lib/ledger/ledger.types';
import { fromDecimalStrict } from '@/lib/money/money';
import { openFinanceStore } from '../db/store.ts';
import { createRepositoryContext, type RepositoryContext } from '../db/repositories/support.ts';
import {
  accountIdFor,
  countRowsWithoutProvenance,
  loadCanonicalLedger,
  maskAccountToken,
  type SeedAccount,
  type SeedLoadReport,
} from './seedLoad.ts';
import {
  CREDIT_CARD_PRODUCT,
  readPerAccountTable,
  reconcile,
  resolveAccountMappings,
  storeRowCount,
  type PerAccountRow,
  type ReconciliationReport,
  type ThirdOpinion,
} from './reconcile.ts';
import { createDocumentIndexRepository } from '../db/repositories/documentIndexRepository.ts';
import {
  RECOVERY_HORIZONS,
  RECOVERY_PLAN_SET,
  indexKnowledgeDocuments,
  orderedSetStatus,
  readOrderedSetForUse,
} from './knowledgeIndex.ts';

const LEDGER_DIR = 'data/ledgers';
const ARTIFACT_DIR = 'outputs/ingest';
const STORE_DIR = 'data/store';
const REQUIRE_LIVE = process.env.NIZAM_REQUIRE_LIVE_LEDGER === '1';

function findByPattern(pattern: RegExp): string[] {
  if (!existsSync(LEDGER_DIR)) return [];
  return readdirSync(LEDGER_DIR)
    .filter((name) => pattern.test(name))
    .map((name) => join(LEDGER_DIR, name))
    .sort();
}

/** True when git ignores the path. A path git does not ignore is never written to. */
function gitIgnores(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

const masterCandidates = findByPattern(/master_ledger.*\.csv$/i);
const perAccountFiles = findByPattern(/transactions__.*\.csv$/i);
const masterPath = masterCandidates.length === 1 ? masterCandidates[0] : undefined;
const cachePresent = masterPath !== undefined && perAccountFiles.length > 0;

function readJson(pattern: RegExp): unknown {
  const [path] = findByPattern(pattern);
  if (path === undefined) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** The row count the tracked contract declares, so the live count is checked against a contract. */
function declaredRowCount(): number {
  const doc = readFileSync(join(LEDGER_DIR, 'LEDGER_SCHEMA.md'), 'utf8');
  const m = doc.match(/([\d,]+)\s+rows/i);
  const declared = m?.[1];
  if (declared === undefined) throw new Error('the schema document no longer declares a row count');
  return Number(declared.replace(/,/g, ''));
}

const evidence: Record<string, unknown> = {
  spec: '08-knowledge-ingestion',
  waves: ['A2', 'A3'],
  observed: cachePresent,
  require_live: REQUIRE_LIVE,
  generated_at: new Date().toISOString(),
};

afterAll(() => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(join(ARTIFACT_DIR, 'A2_A3_SEED_LOAD.json'), `${JSON.stringify(evidence, null, 2)}\n`);
});

// ---------------------------------------------------------------------------------------------------
// The load, performed once and asserted from many angles. A second store open would be a second load.
// ---------------------------------------------------------------------------------------------------

interface LiveRun {
  readonly ctx: RepositoryContext;
  readonly first: SeedLoadReport;
  readonly second: SeedLoadReport;
  readonly report: ReconciliationReport;
  readonly parsedRows: number;
  readonly parseErrors: number;
  readonly roster: readonly SeedAccount[];
  readonly windowStart: string;
  readonly close: () => void;
}

let run: LiveRun | null = null;

function performRun(): LiveRun {
  if (run !== null) return run;
  const storeDirAbsolute = resolve(STORE_DIR);
  // Proved, not assumed, and proved BEFORE the store file is created.
  if (!gitIgnores(join(STORE_DIR, 'finance.db'))) {
    throw new Error('the store path is not git-ignored; refusing to write the owner\u2019s ledger into a tracked tree');
  }
  // The gate starts from an EMPTY store, so "the first load inserted every row and the second inserted
  // none" is a statement about this run rather than about whatever a previous run left behind. Without
  // this the second observation of K1 would read zero inserts and call the load broken — the idempotence
  // working correctly would look like a failure, which is the wrong way round.
  rmSync(storeDirAbsolute, { recursive: true, force: true });
  mkdirSync(storeDirAbsolute, { recursive: true });

  const masterText = readFileSync(masterPath as string, 'utf8');
  const parsed = parseLedgerCsvStrict(masterText, { moneyUnit: 'decimal' });

  // The roster, built from the canonical export's own distinct accounts. The account KIND comes from the
  // per-account rendering, which is the source that actually declares it — nothing here guesses a type
  // from a name, because a name is not a statement about what an account is.
  const distinct = new Map<string, { last4: string; name: string }>();
  for (const row of parsed.rows) {
    const last4 = row.account_identifier.trim();
    if (!distinct.has(last4)) distinct.set(last4, { last4, name: row.account.trim() });
  }
  const provisional: SeedAccount[] = [...distinct.values()].map((a) => ({ ...a, type: 'BANK_OTHER' as const }));

  // The per-account tables, read through their own shape gate.
  const perAccount: PerAccountRow[] = [];
  const perAccountErrors: string[] = [];
  for (const path of perAccountFiles) {
    const read = readPerAccountTable(parseCsv(readFileSync(path, 'utf8')), fromDecimalStrict);
    perAccount.push(...read.rows);
    perAccountErrors.push(...read.errors);
  }

  const { mappings, unresolved } = resolveAccountMappings(
    [...new Set(perAccount.map((r) => r.accountToken))],
    provisional.map((a) => ({ storeAccountId: accountIdFor(a), last4: a.last4, name: a.name })),
  );

  // Now the kind, from the rendering that declares it.
  const productByStoreId = new Map<string, string>();
  for (const mapping of mappings) {
    const sample = perAccount.find((r) => r.accountToken === mapping.accountToken);
    if (sample) productByStoreId.set(mapping.storeAccountId, sample.productType);
  }
  const roster: SeedAccount[] = provisional.map((a) => ({
    ...a,
    type: productByStoreId.get(accountIdFor(a)) === CREDIT_CARD_PRODUCT ? 'CREDIT_OTHER' : 'BANK_OTHER',
    // F21 carried forward: the limit table states no limit for any account, so none is stored. A zero
    // would read downstream as a limit of nothing rather than as a limit nobody stated.
    creditLimit: null,
  }));

  const { handle } = openFinanceStore({
    dataDir: storeDirAbsolute,
    fileName: 'finance.db',
    busyTimeoutMs: 10_000,
    storeName: 'finance',
  });
  const ctx = createRepositoryContext({ handle, actor: 'spec-08-seed-load' });

  const source = {
    // Resolved from the operator environment, with the local cache as the fallback description. Never a
    // storage folder or file identifier — those arrive from the environment and are not written here.
    artifactRef: process.env.NIZAM_TIER1_ARTIFACT_REF ?? '<TIER1_CANONICAL_LEDGER>',
    artifactHash: (readJson(/TIER1_MANIFEST\.json$/) as { files?: { sha256?: string }[] } | null)?.files?.[0]?.sha256 ??
      'unrecorded',
  };

  const first = loadCanonicalLedger({ ctx, rows: parsed.rows, accounts: roster, source });
  const second = loadCanonicalLedger({ ctx, rows: parsed.rows, accounts: roster, source });

  // The window the canonical export declares, DERIVED from the export itself rather than hardcoded.
  const windowStart = parsed.rows.map((r) => r.transaction_date).sort()[0] ?? '0000-01-01';

  const l1 = readJson(/L1_schema\.json$/) as { pass?: boolean; n_total_rows?: number } | null;
  const duplicates = (readJson(/L5_duplicates\.json$/) as { count?: number; posted_date?: string }[] | null) ?? [];
  const quarantine = (readJson(/stage2_quarantine\.json$/) as { n_pages?: number }[] | null) ?? [];
  const balanceEquation = (readJson(/L2_balance_equation\.json$/) as unknown[] | null) ?? [];
  const transferPairs = (readJson(/L4_transfer_pairs\.json$/) as unknown[] | null) ?? [];

  const thirdOpinion: ThirdOpinion = {
    schemaGatePassed: l1?.pass === true,
    schemaGateRowCount: Number(l1?.n_total_rows ?? 0),
    duplicateGroups: duplicates.map((d) => ({ count: Number(d.count ?? 1), postedDate: String(d.posted_date ?? '') })),
    quarantinedDocuments: quarantine.map((q) => ({ pages: Number(q.n_pages ?? 0) })),
    balanceEquationEntries: balanceEquation.length,
    transferPairEntries: transferPairs.length,
  };

  const report = reconcile({ ctx, perAccount, mappings, windowStartInclusive: windowStart, thirdOpinion });

  evidence.parse_errors = parsed.errors.length;
  evidence.parse_error_codes = [...new Set(parsed.errors.map((e) => e.code ?? 'UNCODED'))];
  evidence.declared_money_unit = parsed.declaredMoneyUnit;
  evidence.detected_money_unit = parsed.detectedMoneyUnit;
  evidence.detector_agreed = parsed.detectorAgreesWithDeclaration;
  evidence.declared_row_count = declaredRowCount();
  evidence.per_account_shape_errors = perAccountErrors;
  evidence.per_account_tables = perAccountFiles.length;
  evidence.unresolved_account_tokens = unresolved.length;
  evidence.window_start = windowStart;
  evidence.roster = roster.map((a) => ({ account: maskAccountToken(a.last4), type: a.type, credit_limit: a.creditLimit }));
  evidence.load_first = first;
  evidence.load_second = second;
  evidence.reconciliation = report;
  evidence.store_row_count = storeRowCount(ctx);
  evidence.provenance_counts = countRowsWithoutProvenance(ctx);

  run = {
    ctx,
    first,
    second,
    report,
    parsedRows: parsed.rows.length,
    parseErrors: parsed.errors.length,
    roster,
    windowStart,
    close: () => handle.close(),
  };
  return run;
}

afterAll(() => {
  run?.close();
});

describe('wave A2/A3 observability', () => {
  it('has the tier-1 cache when observation is required', () => {
    evidence.master_candidates = masterCandidates.length;
    evidence.per_account_candidates = perAccountFiles.length;
    if (REQUIRE_LIVE) {
      expect(cachePresent, 'NIZAM_REQUIRE_LIVE_LEDGER=1 but the tier-1 cache is absent or ambiguous').toBe(true);
    } else {
      expect(typeof cachePresent).toBe('boolean');
    }
  });

  it('writes its artifact and its store only where git ignores them', () => {
    const artifactIgnored = gitIgnores(join(ARTIFACT_DIR, 'A2_A3_SEED_LOAD.json'));
    const storeIgnored = gitIgnores(join(STORE_DIR, 'finance.db'));
    evidence.artifact_path_ignored = artifactIgnored;
    evidence.store_path_ignored = storeIgnored;
    expect(artifactIgnored, 'the artifact destination is not git-ignored').toBe(true);
    expect(storeIgnored, 'the store destination is not git-ignored').toBe(true);
  });
});

describe.skipIf(!cachePresent)('A2 — the live load, and K1, K2, K4', () => {
  it('parses every declared row with no refusal, under a DECLARED money unit', () => {
    const live = performRun();
    expect(live.parseErrors, 'the strict boundary refused at least one row; see the artifact for the codes').toBe(0);
    expect(live.parsedRows).toBe(declaredRowCount());
    // F22 in the open: the detector would have called this file decimal too, but the declaration is what
    // decided, and the two are recorded separately so a future disagreement is visible.
    expect(evidence.declared_money_unit).toBe('decimal');
  });

  it('K1 — the store holds exactly the verified source row count, not approximately', () => {
    const live = performRun();
    expect(storeRowCount(live.ctx)).toBe(declaredRowCount());
    expect(live.first.transactionsInserted).toBe(declaredRowCount());
    expect(live.first.rowsWithUnresolvedAccount).toBe(0);
  });

  it('K2 — a second run inserts zero rows and leaves the count identical', () => {
    const live = performRun();
    expect(live.second.transactionsInserted).toBe(0);
    expect(live.second.sourceEventsAppended).toBe(0);
    expect(live.second.accountsCreated).toBe(0);
    expect(live.second.sourceEventsAlreadyPresent).toBe(declaredRowCount());
    expect(live.second.sourceEventHashConflicts).toBe(0);
    expect(storeRowCount(live.ctx)).toBe(declaredRowCount());
  });

  it('K4 — every row carries a source reference, and no row claims a human entered it', () => {
    const live = performRun();
    const counted = countRowsWithoutProvenance(live.ctx);
    expect(counted.total).toBe(declaredRowCount());
    expect(counted.absentSourceReference, 'a row reached the store with no source reference').toBe(0);
    expect(counted.defaultedManual, 'a row claims it was entered by hand and its source token says otherwise').toBe(0);
  });

  it('A2.5 — every period carries a close state, and any exception carries a reason', () => {
    const live = performRun();
    expect(live.first.statements.recorded).toBeGreaterThan(0);
    expect(live.first.statements.balanced + live.first.statements.exceptionAccepted).toBe(live.first.statements.recorded);
    // Every accepted exception is accounted for by a named reason, so none was silently balanced.
    const reasoned = Object.values(live.first.statements.exceptionReasons).reduce((n, v) => n + v, 0);
    expect(reasoned).toBe(live.first.statements.exceptionAccepted);
  });

  it('the roster resolves whole, and no whole account identifier reaches the report', () => {
    const live = performRun();
    expect(live.roster.length).toBeGreaterThan(0);
    expect(live.first.accountsCreated).toBe(live.roster.length);
    const serialised = JSON.stringify(live.first);
    for (const account of live.roster) {
      expect(serialised).not.toContain(account.last4);
    }
  });
});

describe.skipIf(!cachePresent)('A3 — the reconciliation, and K3', () => {
  it('reads both renderings through their own shape gates with no error', () => {
    const live = performRun();
    expect(evidence.per_account_shape_errors).toEqual([]);
    expect(live.report.rowCounts.perAccountRows).toBeGreaterThan(0);
    expect(evidence.unresolved_account_tokens).toBe(0);
  });

  it('K3 — the row residual is zero once the declared window is accounted for', () => {
    const live = performRun();
    // The per-account rendering reaches further back than the canonical export's declared window. Those
    // rows are counted separately, and what remains must match the store EXACTLY.
    expect(live.report.rowCounts.perAccountBeforeWindow).toBeGreaterThan(0);
    expect(live.report.rowCounts.inWindowEqualsStore).toBe(true);
    expect(live.report.rowCounts.unexplainedRowResidual).toBe(0);
    for (const account of live.report.accounts) {
      expect(account.rowsEqual, `account ${account.account} disagrees on row count`).toBe(true);
    }
  });

  it('states a tolerance of zero with its derivation, and does not widen it to pass', () => {
    const live = performRun();
    expect(live.report.tolerance.milliunits).toBe(0);
    expect(live.report.tolerance.derivation.length).toBeGreaterThan(80);
  });

  it('accounts for every money disagreement as a sign rather than absorbing it', () => {
    const live = performRun();
    for (const account of live.report.accounts) {
      if (account.signedTotalsEqual) continue;
      // A disagreement that survives must be a SIGN: the magnitudes match as multisets and the residual
      // is exactly the difference of the two unmatched populations. Anything else is a value difference.
      expect(account.absoluteTotalsEqual, `account ${account.account} differs in absolute total`).toBe(true);
      expect(account.disagreementIsSignOnly, `account ${account.account} has an unexplained population`).toBe(true);
      expect(account.signResidualIdentityHolds, `account ${account.account} residual is not the unmatched rows`).toBe(true);
    }
  });

  it('does not report a verdict of RECONCILED while a finding is open', () => {
    const live = performRun();
    expect(['RECONCILED', 'RECONCILED_WITH_REPORTED_DISAGREEMENT']).toContain(live.report.verdict);
    if (live.report.verdict === 'RECONCILED') expect(live.report.findings).toEqual([]);
    else expect(live.report.findings.length).toBeGreaterThan(0);
  });

  it('accounts for the duplicate and quarantine populations explicitly rather than assuming them', () => {
    const live = performRun();
    expect(live.report.duplicates.groups).toBeGreaterThan(0);
    expect(live.report.duplicates.rowsContributedToResidual).toBe(0);
    expect(live.report.quarantine.documents).toBeGreaterThan(0);
    expect(live.report.quarantine.rowsContributedToResidual).toBe(0);
  });

  it('reports the pre-computed gate as a third opinion, agreeing or not, and adopts neither', () => {
    const live = performRun();
    expect(live.report.thirdOpinion.schemaGateRowCount).toBeGreaterThan(0);
    // Whether it agrees is a measurement, not a requirement. What is required is that the store's own
    // count is unchanged by it.
    expect(live.report.rowCounts.storeRows).toBe(declaredRowCount());
  });
});

describe.skipIf(!cachePresent)('the gate, shown failing before it is trusted', () => {
  it('refuses a tampered header, and the row count that changed is printed', () => {
    const masterText = readFileSync(masterPath as string, 'utf8');
    const clean = parseLedgerCsvStrict(masterText, { moneyUnit: 'decimal' });

    const lines = masterText.split(/\r?\n/);
    const header = (lines[0] ?? '').replace(/^\uFEFF/, '').split(',');
    const a = header[7] as string;
    const b = header[8] as string;
    header[7] = b;
    header[8] = a;
    const tampered = parseLedgerCsvStrict([header.join(','), ...lines.slice(1)].join('\n'), { moneyUnit: 'decimal' });

    evidence.tamper_rows_before = clean.rows.length;
    evidence.tamper_rows_after = tampered.rows.length;
    evidence.tamper_rows_changed = clean.rows.length - tampered.rows.length;
    evidence.tamper_code = tampered.errors[0]?.code;

    expect(clean.rows.length).toBe(declaredRowCount());
    expect(tampered.rows.length).toBe(0);
    expect(tampered.errors[0]?.code).toBe('HEADER_REFUSED');
    // Zero rows changed would mean the tamper never applied and the pass above was false.
    expect(clean.rows.length - tampered.rows.length).toBeGreaterThan(0);
  });

  it('refuses the same file when the money unit is not declared', () => {
    const masterText = readFileSync(masterPath as string, 'utf8');
    const undeclared = parseLedgerCsvStrict(masterText);
    evidence.undeclared_unit_rows = undeclared.rows.length;
    expect(undeclared.rows).toHaveLength(0);
    expect(undeclared.errors[0]?.code).toBe('MONEY_UNIT_NOT_DECLARED');
  });

  it('refuses a row whose money cell would round, on the real file', () => {
    const masterText = readFileSync(masterPath as string, 'utf8');
    const lines = masterText.split(/\r?\n/).filter((l) => l.length > 0);
    const header = (lines[0] ?? '').replace(/^\uFEFF/, '').split(',');
    const amountAt = header.findIndex((h) => h.trim().toLowerCase() === 'amount');
    const outflowAt = header.findIndex((h) => h.trim().toLowerCase() === 'outflow');
    expect(amountAt).toBeGreaterThanOrEqual(0);

    // A fourth fractional digit appended to one row's two money cells. Nothing else changes.
    const fields = parseCsv([lines[0] as string, lines[1] as string].join('\n'))[1] as string[];
    const magnitude = String(fields[amountAt] === '' ? fields[outflowAt] : fields[amountAt]);
    // A FOURTH fractional digit, which is the one the money core would round. Both money cells carry the
    // same value so the magnitude cross-check cannot fire first and mask the refusal under test.
    const integerPart = magnitude.split('.')[0] ?? '0';
    const wouldRound = `${integerPart}.0005`;
    const tamperedRow = fields.map((v, i) => (i === amountAt || i === outflowAt ? wouldRound : v));
    const one = parseLedgerCsvStrict(
      [lines[0] as string, tamperedRow.map((v) => (v.includes(',') ? `"${v}"` : v)).join(',')].join('\n'),
      { moneyUnit: 'decimal' },
    );
    evidence.rounding_tamper_code = one.errors[0]?.code;
    expect(one.rows).toHaveLength(0);
    expect(['MONEY_PRECISION_WOULD_ROUND', 'AMOUNT_MAGNITUDE_DISAGREES']).toContain(one.errors[0]?.code);
  });

  it('has exactly the canonical 25 columns, so the tamper above was a reorder and not a resize', () => {
    const masterText = readFileSync(masterPath as string, 'utf8');
    const header = parseCsv(masterText)[0] ?? [];
    expect(header).toHaveLength(LEDGER_COLUMNS.length);
  });
});

// ---------------------------------------------------------------------------------------------------
// Wave A4 — the knowledge tier, indexed into the SAME store the ledger went into.
//
// It lives in this file rather than its own because there is ONE store, and two test files opening one
// SQLite file in parallel workers is a lock contention bug waiting for a slow machine. Within a file the
// blocks run in sequence and share the handle `performRun()` already opened, so the store this indexes
// into is the store that holds the ledger — which is also what makes the K7 scan below meaningful.
// ---------------------------------------------------------------------------------------------------

const KNOWLEDGE_ARTIFACT = join(ARTIFACT_DIR, 'A4_KNOWLEDGE_INDEX.json');

const knowledgeEvidence: Record<string, unknown> = {
  spec: '08-knowledge-ingestion',
  wave: 'A4',
  generated_at: new Date().toISOString(),
};

afterAll(() => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(KNOWLEDGE_ARTIFACT, `${JSON.stringify(knowledgeEvidence, null, 2)}\n`);
});

/**
 * The tier-2 documents that are actually ON DISK, found by walking the repository's own tracked
 * knowledge directories.
 *
 * What is NOT here matters as much as what is. Wave A0's fetch materialised TIER 1 by rule, so the
 * owner's five-horizon recovery plan and the two debt-loop analyses — which live only in the drive tree —
 * are absent from this machine. They are reported as BLOCKED rather than substituted, invented, or
 * represented by a placeholder row that would later read as though the document had been indexed.
 */
function collectKnowledgeDocuments(): { reference: string; contentHash: string; byteCount: number }[] {
  const roots: { dir: string; pattern: RegExp; recurse: boolean }[] = [
    { dir: 'contracts/pfos', pattern: /\.md$/i, recurse: false },
    { dir: 'docs/architecture', pattern: /\.md$/i, recurse: false },
    { dir: 'docs/adr', pattern: /\.md$/i, recurse: false },
    { dir: 'docs/research', pattern: /\.md$/i, recurse: false },
    { dir: 'docs', pattern: /^[A-Z0-9_]+\.md$/, recurse: false },
  ];
  const out: { reference: string; contentHash: string; byteCount: number }[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!existsSync(root.dir)) continue;
    for (const name of readdirSync(root.dir)) {
      if (!root.pattern.test(name)) continue;
      const path = `${root.dir}/${name}`;
      if (seen.has(path)) continue;
      let bytes: Buffer;
      try {
        bytes = readFileSync(path);
      } catch {
        continue;
      }
      seen.add(path);
      out.push({
        reference: path,
        contentHash: createHash('sha256').update(bytes).digest('hex'),
        byteCount: bytes.byteLength,
      });
    }
  }
  return out;
}

describe.skipIf(!cachePresent)('A4 — the knowledge tier, indexed', () => {
  it('A4.1 / K5 — indexes each accepted document once, and a re-index is a no-op', () => {
    const live = performRun();
    const documents = collectKnowledgeDocuments();
    knowledgeEvidence.documents_found = documents.length;

    const first = indexKnowledgeDocuments(live.ctx, documents);
    const second = indexKnowledgeDocuments(live.ctx, documents);
    knowledgeEvidence.index_first = first;
    knowledgeEvidence.index_second = second;

    expect(first.indexed).toBeGreaterThan(0);
    expect(second.indexed, 'a re-index of the same bytes created a second row').toBe(0);
    expect(second.alreadyIndexed).toBe(first.indexed + first.alreadyIndexed);

    const repo = createDocumentIndexRepository(live.ctx);
    knowledgeEvidence.rows_in_index = repo.count();
    expect(repo.count()).toBe(first.indexed);
    // Every row carries a distinct content hash, which the DDL enforces and this counts.
    const distinct = live.ctx.handle.db
      .prepare('SELECT COUNT(DISTINCT content_hash) AS n FROM document_index')
      .get() as { n: number };
    expect(Number(distinct.n)).toBe(repo.count());
  });

  it('A4.3 — the contract set and the architecture documents are in the index, by class', () => {
    const live = performRun();
    const repo = createDocumentIndexRepository(live.ctx);
    const byClass = {
      agent_contract: repo.listClass('agent_contract').length,
      architecture: repo.listClass('architecture').length,
      financial_research: repo.listClass('financial_research').length,
      recovery_plan: repo.listClass('recovery_plan').length,
    };
    knowledgeEvidence.by_class = byClass;
    expect(byClass.agent_contract, 'the agent contract set is not in the index').toBeGreaterThan(0);
    expect(byClass.architecture, 'no architecture document is in the index').toBeGreaterThan(0);
    expect(byClass.financial_research, 'the financial research corpus is not in the index').toBeGreaterThan(0);
    // Every indexed document has a processing state, and none is left without one.
    const stateless = live.ctx.handle.db
      .prepare(`SELECT COUNT(*) AS n FROM document_index WHERE processing_state IS NULL OR processing_state = ''`)
      .get() as { n: number };
    expect(Number(stateless.n)).toBe(0);
  });

  it('A4.2 — the recovery plan set is reported BLOCKED rather than partially served', () => {
    const live = performRun();
    const status = orderedSetStatus(live.ctx, RECOVERY_PLAN_SET, RECOVERY_HORIZONS.length);
    knowledgeEvidence.recovery_plan_set = status;
    knowledgeEvidence.recovery_plan_blocked_reason =
      'The five recovery-plan horizons live only in the owner\u2019s drive tree. Wave A0 materialised tier 1 by ' +
      'rule, so tier-2 knowledge documents that have no repository-local rendering are not on this machine. ' +
      'They are BLOCKED on the same drive access task B13 needs, and nothing stands in for them: an invented ' +
      'or placeholder row would later read as though the document had been indexed.';

    // Absent, not partial, and the mechanism refuses to serve it either way.
    expect(status.presentSize).toBe(0);
    expect(status.complete).toBe(false);
    expect(status.ordinalsMissing).toEqual([1, 2, 3, 4, 5]);
    expect(() => readOrderedSetForUse(live.ctx, RECOVERY_PLAN_SET, RECOVERY_HORIZONS.length)).toThrow(
      /refuses to be read for use/,
    );
  });

  it('reports every document no rule claimed, so nothing was filed under a default class', () => {
    const live = performRun();
    const report = indexKnowledgeDocuments(live.ctx, collectKnowledgeDocuments());
    knowledgeEvidence.unclassified = report.unclassified;
    knowledgeEvidence.refused = report.refused;
    // The collection is drawn from directories the rules claim, so nothing should be unclassified. If a
    // later directory is added to the walk without a rule, this fails rather than filing it silently.
    expect(report.unclassified, 'a collected document matched no classification rule').toEqual([]);
    expect(report.refused).toEqual([]);
  });

  it('keeps no document body in the index — it is a pointer table', () => {
    const live = performRun();
    const columns = live.ctx.handle.db.prepare('SELECT name FROM pragma_table_info(?)').all('document_index') as {
      name: string;
    }[];
    const names = columns.map((c) => c.name);
    knowledgeEvidence.index_columns = names;
    for (const forbidden of ['body', 'content', 'text', 'extract', 'narrative']) {
      expect(names, `document_index carries a "${forbidden}" column`).not.toContain(forbidden);
    }
  });
});
