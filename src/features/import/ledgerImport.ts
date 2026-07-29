/**
 * NIZAM · Import + dedup engine (25-column master_ledger CSV)
 * Implemented by: KIRO Contract 2 / Phase 2.5
 * Depends on: lib/ledger/ledger.types.ts, lib/db/schema.ts, lib/money/money.ts
 *
 * Parses per data/ledgers/LEDGER_SCHEMA.md; dedups via duplicate_key (exact)
 * plus a fuzzy pass (account + amount + ±3 days + normalized payee).
 * Pure over NizamDb: importLedger(db, csv) -> { db: newDb, stats }. Idempotent.
 */
import {
  LEDGER_COLUMNS,
  EXTRACTION_METHODS,
  TRANSACTION_TYPES,
  type ExtractionMethod,
  type LedgerRow,
  type LedgerTransactionType,
} from '@/lib/ledger/ledger.types';
import type { NizamDb } from '@/lib/db/schema';
import type { Transaction } from '@/features/transactions/transaction.types';
import type { Account, AccountType } from '@/features/accounts/accounts.types';
import { fromDecimal, type Money } from '@/lib/money/money';
import { knownDuplicateKeys } from '@/lib/ledger/ledgerStore';

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180: quoted fields, embedded commas/newlines, "" escapes)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const src = text.replace(/^\uFEFF/, ''); // strip BOM

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i += 1;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r') {
      i += 1; // handled with the following \n (or alone)
      if (src[i] !== '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty trailing rows.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---------------------------------------------------------------------------
// Ledger row parsing
// ---------------------------------------------------------------------------

export interface ParseError {
  rowNumber: number; // 1-based data row number (excluding header)
  message: string;
}

export interface ParsedLedger {
  rows: LedgerRow[];
  errors: ParseError[];
  /** Detected money format of the file. */
  moneyFormat: 'milliunits' | 'decimal';
}

/**
 * Money cell interpretation (LEDGER_SCHEMA stores integer milliunits, but real
 * exports may carry decimal EGP): if ANY money cell in the file contains a '.',
 * the whole file is treated as decimal units; otherwise as integer milliunits.
 */
function detectMoneyFormat(records: string[][], moneyCols: number[]): 'milliunits' | 'decimal' {
  for (const rec of records) {
    for (const c of moneyCols) {
      const v = (rec[c] ?? '').trim();
      if (v.includes('.')) return 'decimal';
    }
  }
  return 'milliunits';
}

function parseMoneyCell(value: string, format: 'milliunits' | 'decimal'): Money {
  const v = value.trim();
  if (v === '') return 0;
  if (format === 'decimal') return fromDecimal(v);
  const n = Number(v.replace(/[,\s]/g, ''));
  if (!Number.isSafeInteger(n)) throw new Error(`not an integer milliunit value: "${value}"`);
  return n;
}

function normalizeDate(value: string): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  // tolerate DD/MM/YYYY and MM/DD/YYYY-ambiguous — schema says ISO, so only slash-Y-last handled as D/M/Y (Egypt convention)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  throw new Error(`unparseable date "${value}"`);
}

/** Deterministic djb2 hash for the dedup-key fallback. */
export function fallbackDuplicateKey(row: {
  transaction_date: string;
  amount: Money;
  account: string;
  payee: string;
}): string {
  const s = `${row.transaction_date}|${row.amount}|${row.account.toLowerCase()}|${row.payee.toLowerCase()}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return `dk_${(h >>> 0).toString(36)}_${row.transaction_date}`;
}

/** Parse the full CSV text into validated LedgerRows. */
export function parseLedgerCsv(text: string): ParsedLedger {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [], moneyFormat: 'milliunits' };

  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const colIndex = new Map<string, number>();
  header.forEach((h, i) => colIndex.set(h, i));

  const missing = LEDGER_COLUMNS.filter((c) => !colIndex.has(c));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ rowNumber: 0, message: `missing required columns: ${missing.join(', ')}` }],
      moneyFormat: 'milliunits',
    };
  }

  const records = table.slice(1);
  const idx = (name: (typeof LEDGER_COLUMNS)[number]) => colIndex.get(name) as number;
  const moneyCols = [idx('outflow'), idx('inflow'), idx('amount'), idx('balance')];
  const moneyFormat = detectMoneyFormat(records, moneyCols);

  const rows: LedgerRow[] = [];
  const errors: ParseError[] = [];

  records.forEach((rec, i) => {
    const rowNumber = i + 1;
    const cell = (name: (typeof LEDGER_COLUMNS)[number]) => (rec[idx(name)] ?? '').trim();
    try {
      const txnTypeRaw = cell('transaction_type').toLowerCase();
      const txnType: LedgerTransactionType = (TRANSACTION_TYPES as readonly string[]).includes(txnTypeRaw)
        ? (txnTypeRaw as LedgerTransactionType)
        : 'charge';

      const extractionRaw = cell('extraction_method').toLowerCase();
      const extraction: ExtractionMethod = (EXTRACTION_METHODS as readonly string[]).includes(extractionRaw)
        ? (extractionRaw as ExtractionMethod)
        : 'manual';

      const outflow = parseMoneyCell(cell('outflow'), moneyFormat);
      const inflow = parseMoneyCell(cell('inflow'), moneyFormat);
      const amountCell = cell('amount');
      const amount = amountCell === '' ? inflow - outflow : parseMoneyCell(amountCell, moneyFormat);
      const balanceCell = cell('balance');

      const directionRaw = cell('direction').toLowerCase();
      const direction = directionRaw === 'in' || directionRaw === 'out' ? directionRaw : amount >= 0 ? 'in' : 'out';

      const confidenceRaw = cell('confidence_score');
      // confidence is metadata (0..1), not money — Number() is fine here.
      const confidence = confidenceRaw === '' ? 1 : Math.min(1, Math.max(0, Number(confidenceRaw) || 0));

      const base = {
        transaction_date: normalizeDate(cell('transaction_date')),
        posting_date: cell('posting_date') ? normalizeDate(cell('posting_date')) : normalizeDate(cell('transaction_date')),
        payee: cell('payee'),
        merchant: cell('merchant'),
        description: cell('description'),
        category: cell('category'),
        transaction_type: txnType,
        outflow,
        inflow,
        amount,
        direction,
        currency: cell('currency') || 'EGP',
        balance: balanceCell === '' ? null : parseMoneyCell(balanceCell, moneyFormat),
        account: cell('account'),
        account_identifier: cell('account_identifier'),
        statement_date: cell('statement_date'),
        statement_month: cell('statement_month'),
        source_file: cell('source_file'),
        source_page_or_sheet: cell('source_page_or_sheet'),
        extraction_method: extraction,
        confidence_score: confidence,
        confidence_reason: cell('confidence_reason'),
        duplicate_key: cell('duplicate_key'),
        is_duplicate: /^(true|1|yes)$/i.test(cell('is_duplicate')),
        memo: cell('memo'),
      } satisfies LedgerRow;

      if (!base.duplicate_key) {
        base.duplicate_key = fallbackDuplicateKey(base);
      }
      rows.push(base);
    } catch (e) {
      errors.push({ rowNumber, message: e instanceof Error ? e.message : String(e) });
    }
  });

  return { rows, errors, moneyFormat };
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

function normalizePayee(p: string): string {
  return p.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim();
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) -
    Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86_400_000;
}

export interface DedupResult {
  fresh: LedgerRow[];
  skippedExact: LedgerRow[];
  skippedFlagged: LedgerRow[];
  skippedFuzzy: LedgerRow[];
}

/**
 * Split rows into fresh vs duplicates.
 *  - flagged: row's own is_duplicate=true
 *  - exact:   duplicate_key already imported (db) or seen earlier in this batch
 *  - fuzzy:   same account + amount, |date diff| <= 3 days, same normalized payee
 *             vs an existing transaction or an earlier batch row
 */
export function dedupeRows(
  rows: LedgerRow[],
  db: NizamDb,
): DedupResult {
  const existingKeys = new Set(knownDuplicateKeys(db));
  const existingFuzzy = db.transactions.map((t) => ({
    date: t.date,
    amount: t.amount,
    account: t.accountId, // account fuzzy match happens at name level below
    accountName: '', // filled from account lookup
    payee: normalizePayee(t.payee),
  }));
  const accountNameById = new Map(db.accounts.map((a) => [a.id, a.name.toLowerCase()]));
  for (const f of existingFuzzy) f.accountName = accountNameById.get(f.account) ?? '';

  const fresh: LedgerRow[] = [];
  const skippedExact: LedgerRow[] = [];
  const skippedFlagged: LedgerRow[] = [];
  const skippedFuzzy: LedgerRow[] = [];
  const batchKeys = new Set<string>();
  const batchFuzzy: { date: string; amount: Money; accountName: string; payee: string }[] = [];

  for (const row of rows) {
    if (row.is_duplicate) {
      skippedFlagged.push(row);
      continue;
    }
    if (existingKeys.has(row.duplicate_key) || batchKeys.has(row.duplicate_key)) {
      skippedExact.push(row);
      continue;
    }
    const rowPayee = normalizePayee(row.payee);
    const rowAccount = row.account.toLowerCase();
    const isFuzzyDup = [...existingFuzzy, ...batchFuzzy].some(
      (f) =>
        f.amount === row.amount &&
        f.accountName === rowAccount &&
        f.payee === rowPayee &&
        daysBetween(f.date, row.transaction_date) <= 3,
    );
    if (isFuzzyDup) {
      skippedFuzzy.push(row);
      continue;
    }
    fresh.push(row);
    batchKeys.add(row.duplicate_key);
    batchFuzzy.push({
      date: row.transaction_date,
      amount: row.amount,
      accountName: rowAccount,
      payee: rowPayee,
    });
  }

  return { fresh, skippedExact, skippedFlagged, skippedFuzzy };
}

// ---------------------------------------------------------------------------
// Mapping into the db (pure)
// ---------------------------------------------------------------------------

function inferAccountType(name: string, identifier: string): AccountType {
  const s = `${name} ${identifier}`.toLowerCase();
  if (s.includes('hsbc')) return 'HSBC_CC';
  if (s.includes('cib')) return 'CIB_DEBIT';
  if (s.includes('cash')) return 'CASH';
  if (s.includes('credit') || s.includes('card')) return 'CREDIT_OTHER';
  return 'BANK_OTHER';
}

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export interface ImportStats {
  imported: number;
  skippedExact: number;
  skippedFlagged: number;
  skippedFuzzy: number;
  parseErrors: ParseError[];
  accountsCreated: string[];
  categoriesCreated: string[];
}

export interface ImportOutcome {
  db: NizamDb;
  stats: ImportStats;
}

const IMPORTED_GROUP_NAME = 'Imported';

/**
 * Import a master_ledger CSV into the database. PURE: returns a new NizamDb.
 * Re-running with the same CSV is a no-op (dedup by duplicate_key).
 */
export function importLedger(db: NizamDb, csvText: string): ImportOutcome {
  const parsed = parseLedgerCsv(csvText);
  const { fresh, skippedExact, skippedFlagged, skippedFuzzy } = dedupeRows(parsed.rows, db);

  const draft: NizamDb = structuredClone(db);
  const accountsCreated: string[] = [];
  const categoriesCreated: string[] = [];

  const accountByName = new Map(draft.accounts.map((a) => [a.name.toLowerCase(), a]));
  const payeeByName = new Map(draft.payees.map((p) => [p.name.toLowerCase(), p]));
  const categoryByName = new Map(draft.categories.map((c) => [c.name.toLowerCase(), c]));

  function ensureAccount(name: string, identifier: string): Account {
    const key = name.toLowerCase();
    const found = accountByName.get(key);
    if (found) return found;
    const account: Account = {
      id: newId('acc'),
      name: name || 'Imported Account',
      type: inferAccountType(name, identifier),
      onBudget: true,
      balance: 0,
      clearedBalance: 0,
      accountIdentifier: identifier || null,
      creditLimit: null,
      closed: false,
      order: draft.accounts.length,
      paymentCategoryId: null,
    };
    draft.accounts.push(account);
    accountByName.set(key, account);
    accountsCreated.push(account.name);
    return account;
  }

  function ensureImportedGroup(): string {
    let group = draft.categoryGroups.find((g) => g.name === IMPORTED_GROUP_NAME);
    if (!group) {
      group = { id: newId('grp'), name: IMPORTED_GROUP_NAME, order: draft.categoryGroups.length, hidden: false };
      draft.categoryGroups.push(group);
    }
    return group.id;
  }

  function ensureCategory(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const key = trimmed.toLowerCase();
    const found = categoryByName.get(key);
    if (found) return found.id;
    const category = {
      id: newId('cat'),
      groupId: ensureImportedGroup(),
      name: trimmed,
      order: draft.categories.length,
      hidden: false,
      target: null,
      isCreditCardPayment: false,
      linkedAccountId: null,
    };
    draft.categories.push(category);
    categoryByName.set(key, category);
    categoriesCreated.push(category.name);
    return category.id;
  }

  function ensurePayee(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!payeeByName.has(key)) {
      const p = { id: newId('pay'), name: trimmed };
      draft.payees.push(p);
      payeeByName.set(key, p);
    }
  }

  for (const row of fresh) {
    const account = ensureAccount(row.account, row.account_identifier);
    const categoryId = row.transaction_type === 'transfer' ? null : ensureCategory(row.category);
    ensurePayee(row.payee);

    const txn: Transaction = {
      id: newId('txn'),
      accountId: account.id,
      date: row.transaction_date,
      payee: row.payee,
      categoryId,
      memo: row.memo || row.description,
      amount: row.amount,
      cleared: 'cleared',
      approved: false,
      transferAccountId: null,
      transferTransactionId: null,
      splits: null,
      importInfo: {
        duplicateKey: row.duplicate_key,
        sourceFile: row.source_file,
        sourcePageOrSheet: row.source_page_or_sheet,
        extractionMethod: row.extraction_method,
        confidenceScore: row.confidence_score,
        confidenceReason: row.confidence_reason,
      },
    };
    draft.transactions.push(txn);
  }

  // Refresh cached account balances.
  for (const account of draft.accounts) {
    let balance = 0;
    let cleared = 0;
    for (const t of draft.transactions) {
      if (t.accountId === account.id) {
        balance += t.amount;
        if (t.cleared !== 'uncleared') cleared += t.amount;
      }
    }
    account.balance = balance;
    account.clearedBalance = cleared;
  }

  return {
    db: draft,
    stats: {
      imported: fresh.length,
      skippedExact: skippedExact.length,
      skippedFlagged: skippedFlagged.length,
      skippedFuzzy: skippedFuzzy.length,
      parseErrors: parsed.errors,
      accountsCreated,
      categoriesCreated,
    },
  };
}
