/**
 * NIZAM · Spec 08 wave A1 — the live shape, grain and roster gates (tasks A1.1, A1.2, A1.3).
 *
 * ## What these gates run against, and why they may skip
 *
 * They run against the local tier-1 cache the wave A0 fetch materialises under `data/ledgers/`, which
 * is gitignored because it holds real account rows. So on a clean checkout the cache is absent and the
 * live gates cannot be observed. That is reported rather than hidden: absence SKIPS by default and
 * FAILS when `NIZAM_REQUIRE_LIVE_LEDGER=1`, so an operator can demand observation and a continuous
 * build does not lie about having performed it.
 *
 * ## Why nothing here is discovered by hardcoded name
 *
 * The per-account tables are named after the institution and the last four digits of the account. This
 * file is tracked in a public repository, so it locates its inputs by pattern and reports every finding
 * as a count or a masked token. A file name is never written into this source, and no value from the
 * data reaches an assertion message.
 *
 * ## Why the real parser is used rather than a comma split
 *
 * The canonical export quotes fields that contain commas. A naive `split(',')` mis-aligns those rows
 * and invents columns: measured directly, it reported five distinct accounts where there are three, the
 * two extra being fragments of a quoted narrative. The parser is part of the data's identity, so these
 * gates use `parseCsv` and `parseLedgerCsv` — the same implementations the application imports with —
 * and never a second reader.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, parseLedgerCsv } from '@/features/import/ledgerImport';
import { verifyCanonicalHeader } from './ledgerHeader.ts';
import { LEDGER_COLUMNS } from './ledger.types.ts';
import { sum as sumMoney } from '@/lib/money/money';

const LEDGER_DIR = 'data/ledgers';
const ARTIFACT_DIR = 'outputs/ingest';
const REQUIRE_LIVE = process.env.NIZAM_REQUIRE_LIVE_LEDGER === '1';

/** Mask any value that could identify an account before it reaches a log or an artifact. */
function mask(value: string): string {
  if (value.length <= 2) return '*'.repeat(value.length);
  return `${value[0]}${'*'.repeat(Math.max(1, value.length - 2))}${value[value.length - 1]}`;
}

function findByPattern(pattern: RegExp): string[] {
  if (!existsSync(LEDGER_DIR)) return [];
  return readdirSync(LEDGER_DIR)
    .filter((name) => pattern.test(name))
    .map((name) => join(LEDGER_DIR, name))
    .sort();
}

const masterCandidates = findByPattern(/master_ledger.*\.csv$/i);
const limitsCandidates = findByPattern(/credit_limits\.csv$/i);
const perAccountTables = findByPattern(/transactions__.*\.csv$/i);
const cachePresent = masterCandidates.length === 1 && limitsCandidates.length === 1;

/** The row count the tracked contract declares, so the live count is checked against a contract. */
function declaredRowCount(): number {
  const doc = readFileSync(join(LEDGER_DIR, 'LEDGER_SCHEMA.md'), 'utf8');
  const m = doc.match(/([\d,]+)\s+rows/i);
  if (!m) throw new Error('the schema document no longer declares a row count');
  return Number(m[1].replace(/,/g, ''));
}

/** Deterministic shuffle, so "the order changed" is reproducible rather than a one-off. */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = (Math.imul(t ^ (t >>> 15), t | 1) ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Totals {
  rows: number;
  outflow: number;
  inflow: number;
  amount: number;
  distinctAccounts: number;
  distinctMonths: number;
  distinctDuplicateKeys: number;
}

function totalsOf(csvText: string): Totals {
  const parsed = parseLedgerCsv(csvText);
  return {
    rows: parsed.rows.length,
    outflow: sumMoney(parsed.rows.map((r) => r.outflow)),
    inflow: sumMoney(parsed.rows.map((r) => r.inflow)),
    amount: sumMoney(parsed.rows.map((r) => r.amount)),
    distinctAccounts: new Set(parsed.rows.map((r) => r.account_identifier)).size,
    distinctMonths: new Set(parsed.rows.map((r) => r.statement_month)).size,
    distinctDuplicateKeys: new Set(parsed.rows.map((r) => r.duplicate_key)).size,
  };
}

/** Everything worth keeping from a run, written to a gitignored artifact as the gate evidence. */
const evidence: Record<string, unknown> = {
  spec: '08-knowledge-ingestion',
  wave: 'A1',
  observed: cachePresent,
  require_live: REQUIRE_LIVE,
  generated_at: new Date().toISOString(),
};

afterAll(() => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(join(ARTIFACT_DIR, 'A1_SHAPE_GATES.json'), `${JSON.stringify(evidence, null, 2)}\n`);
});

describe('wave A1 observability', () => {
  /**
   * Fail-closed switch. Skipping is honest on a clean checkout, but an operator running the wave must
   * be able to demand that the gates actually ran, and get a failure when they could not.
   */
  it('has the tier-1 cache when observation is required', () => {
    evidence.master_candidates = masterCandidates.length;
    evidence.limits_candidates = limitsCandidates.length;
    evidence.per_account_tables = perAccountTables.length;
    if (REQUIRE_LIVE) {
      expect(cachePresent, 'NIZAM_REQUIRE_LIVE_LEDGER=1 but the tier-1 cache is absent or ambiguous').toBe(true);
    } else {
      expect(typeof cachePresent).toBe('boolean');
    }
  });
});

describe.skipIf(!cachePresent)('A1.1 — the canonical file matches the contract exactly', () => {
  const masterText = cachePresent ? readFileSync(masterCandidates[0], 'utf8') : '';

  it('has a header identical to the canonical ordered name set', () => {
    const table = parseCsv(masterText);
    const verdict = verifyCanonicalHeader(table[0] ?? []);
    evidence.header_verdict = verdict.ok ? 'ok' : verdict.code;
    if (!verdict.ok) evidence.header_message = verdict.message;
    expect(verdict.ok, verdict.ok ? '' : verdict.message).toBe(true);
    expect((table[0] ?? []).length).toBe(LEDGER_COLUMNS.length);
  });

  it('parses with no row errors', () => {
    const parsed = parseLedgerCsv(masterText);
    evidence.parse_errors = parsed.errors.length;
    evidence.money_format = parsed.moneyFormat;
    evidence.parsed_rows = parsed.rows.length;
    expect(parsed.errors).toEqual([]);
  });

  it('holds the number of rows the contract declares', () => {
    const parsed = parseLedgerCsv(masterText);
    evidence.declared_rows = declaredRowCount();
    expect(parsed.rows.length).toBe(declaredRowCount());
  });

  /**
   * Establishes that no field contains a newline, which is what makes the shuffle below sound: if a
   * quoted field spanned two lines, shuffling lines would corrupt rows instead of reordering them.
   */
  it('has no field spanning a line, so a line shuffle is a row shuffle', () => {
    const dataLines = masterText.split(/\r?\n/).filter((l) => l.length > 0).slice(1);
    const parsed = parseLedgerCsv(masterText);
    evidence.data_lines = dataLines.length;
    expect(dataLines.length).toBe(parsed.rows.length);
  });
});

describe.skipIf(!cachePresent)('A1.2 — the grain, proved before anything is keyed', () => {
  const masterText = cachePresent ? readFileSync(masterCandidates[0], 'utf8') : '';

  it('names a candidate key that is unique, and reports the duplicate excess of each', () => {
    const parsed = parseLedgerCsv(masterText);
    const rows = parsed.rows;
    const candidates: Array<{ name: string; key: (r: (typeof rows)[number]) => string; scope: number }> = [
      { name: 'duplicate_key', key: (r) => r.duplicate_key, scope: rows.length },
      {
        name: 'duplicate_key over rows not flagged duplicate',
        key: (r) => r.duplicate_key,
        scope: rows.filter((r) => !r.is_duplicate).length,
      },
      {
        name: 'transaction_date + amount + account_identifier + description',
        key: (r) => [r.transaction_date, r.amount, r.account_identifier, r.description].join('\u0000'),
        scope: rows.length,
      },
      {
        name: 'the whole row',
        key: (r) => LEDGER_COLUMNS.map((c) => String(r[c])).join('\u0000'),
        scope: rows.length,
      },
    ];

    const report = candidates.map((c) => {
      const subject = c.name.includes('not flagged') ? rows.filter((r) => !r.is_duplicate) : rows;
      const distinct = new Set(subject.map(c.key)).size;
      return { key: c.name, rows: subject.length, distinct, duplicate_excess: subject.length - distinct };
    });
    evidence.grain_candidates = report;
    evidence.rows_flagged_duplicate = rows.filter((r) => r.is_duplicate).length;

    // The hard gate: at least one declared candidate must actually identify a row. If none does, the
    // load cannot key on the data and must carry a surrogate, which is a decision, not a default.
    const unique = report.filter((r) => r.duplicate_excess === 0);
    evidence.grain_chosen = unique.length > 0 ? unique[0].key : null;
    expect(
      unique.length,
      `no candidate key is unique. Duplicate excess by key: ${report.map((r) => `${r.key}=${r.duplicate_excess}`).join('; ')}`,
    ).toBeGreaterThan(0);
  });

  /**
   * Row order must not be data. Any total that moves under a shuffle was reading position as meaning,
   * and that is a defect rather than a variance.
   */
  it('produces identical totals when the source rows are shuffled', () => {
    const lines = masterText.split(/\r?\n/).filter((l) => l.length > 0);
    const header = lines[0];
    const shuffled = [`${header}`, ...seededShuffle(lines.slice(1), 20260810)].join('\n');

    const before = totalsOf(masterText);
    const after = totalsOf(shuffled);
    evidence.totals_original = before;
    evidence.totals_shuffled = after;

    // Prove the shuffle actually changed the order, or this test asserts nothing at all.
    const originalOrder = lines.slice(1);
    const shuffledOrder = shuffled.split('\n').slice(1);
    const movedRows = originalOrder.reduce((n, l, i) => (l === shuffledOrder[i] ? n : n + 1), 0);
    evidence.shuffle_rows_moved = movedRows;
    expect(movedRows, 'the shuffle moved no rows, so this test proves nothing').toBeGreaterThan(0);

    expect(after).toEqual(before);
  });
});

describe.skipIf(!cachePresent)('A1.3 — the credit-limit table and the account roster', () => {
  const limitsText = cachePresent ? readFileSync(limitsCandidates[0], 'utf8') : '';
  const masterText = cachePresent ? readFileSync(masterCandidates[0], 'utf8') : '';

  it('declares exactly its three contracted columns, in order', () => {
    const table = parseCsv(limitsText);
    const header = (table[0] ?? []).map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase());
    evidence.credit_limits_header = header;
    expect(header).toEqual(['account_id', 'credit_limit_egp', 'statement_close_day']);
  });

  /**
   * The dangerous state for this table is not emptiness, it is PARTIAL population: one revolving
   * account with a limit and another without silently breaks every utilisation figure for the second
   * while looking populated. So the invariant enforced here is all-or-nothing, and the all-absent case
   * is recorded as a named open finding rather than passed over.
   *
   * Measured on the live artifact, this table carries its account references and neither a limit nor a
   * statement close day — recorded as **F21**. Populating even one row makes this gate fire, which is
   * what forces the finding to be re-assessed instead of quietly aging.
   */
  it('refuses a partially populated limit table, and records the all-absent case as F21', () => {
    const table = parseCsv(limitsText);
    const rows = table.slice(1).filter((r) => r.some((c) => c.trim().length > 0));
    expect(rows.length).toBeGreaterThan(0);

    const wellFormedLimit = (c: string) => {
      const n = Number((c ?? '').trim());
      return (c ?? '').trim().length > 0 && Number.isFinite(n) && n > 0;
    };
    const wellFormedDay = (c: string) => {
      const n = Number((c ?? '').trim());
      return (c ?? '').trim().length > 0 && Number.isInteger(n) && n >= 1 && n <= 31;
    };

    const limits = rows.filter((r) => wellFormedLimit(r[1] ?? '')).length;
    const days = rows.filter((r) => wellFormedDay(r[2] ?? '')).length;
    evidence.credit_limits_rows = rows.length;
    evidence.credit_limits_with_limit = limits;
    evidence.credit_limits_with_close_day = days;

    if (limits === 0 && days === 0) {
      evidence.finding_F21 =
        'OPEN — the credit-limit table holds an account reference on every row and no limit and no ' +
        'close day on any row. Every credit-utilisation and statement-cycle figure downstream has no input.';
      return;
    }

    evidence.finding_F21 = limits === rows.length && days === rows.length ? 'RESOLVED' : 'PARTIAL';
    expect(
      limits,
      'the limit table is partially populated: an account without a limit silently breaks its own ' +
        'utilisation figure while the table looks populated. F21 must be re-assessed.',
    ).toBe(rows.length);
    expect(days, 'the limit table is partially populated on statement close day.').toBe(rows.length);
  });

  /**
   * A1.3's real question. The limit table names accounts in its own vocabulary, and the ledger names
   * them in another; an identifier that resolves to nothing is a finding, not a row to skip. The
   * resolution rule is stated explicitly: the ledger's redacted identifier must appear inside the
   * limit table's account reference.
   */
  it('resolves every account reference to exactly one ledger account', () => {
    const parsed = parseLedgerCsv(masterText);
    const roster = [...new Set(parsed.rows.map((r) => r.account_identifier.trim()))].filter((v) => v.length > 0);
    const table = parseCsv(limitsText);
    const refs = table
      .slice(1)
      .map((r) => (r[0] ?? '').trim())
      .filter((v) => v.length > 0);

    const resolution = refs.map((ref) => {
      const hits = roster.filter((id) => ref.toLowerCase().includes(id.toLowerCase()));
      return { reference: mask(ref), matches: hits.length };
    });
    evidence.roster_size = roster.length;
    evidence.roster_masked = roster.map(mask);
    evidence.credit_limit_resolution = resolution;

    const unresolved = resolution.filter((r) => r.matches !== 1);
    expect(
      unresolved.length,
      `${unresolved.length} of ${refs.length} account reference(s) do not resolve to exactly one ledger account: ` +
        `${JSON.stringify(resolution)}. An unresolvable reference is a finding, not a skipped row.`,
    ).toBe(0);
  });
});
