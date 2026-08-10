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
  CONFIDENCE_BANDS,
  EXTRACTION_METHODS,
  TRANSACTION_TYPES,
  UNKNOWN_EXTRACTION_METHOD,
  type ConfidenceBand,
  type ExtractionMethod,
  type IngestExtractionMethod,
  type IngestLedgerRow,
  type LedgerDirection,
  type LedgerRow,
  type LedgerTransactionType,
} from '@/lib/ledger/ledger.types';
import { verifyCanonicalHeader } from '@/lib/ledger/ledgerHeader';
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
  /** Present on the strict path, which names its refusals rather than only describing them. */
  code?: StrictRefusalCode;
  /** The column at fault, when one column is at fault. Never the cell's value. */
  column?: string;
}

/** The unit a money cell is expressed in. Detected on the lenient path, DECLARED on the strict one. */
export type MoneyUnit = 'milliunits' | 'decimal';

export interface ParsedLedger {
  rows: LedgerRow[];
  errors: ParseError[];
  /** Detected money format of the file. */
  moneyFormat: MoneyUnit;
}

/**
 * Money cell interpretation on the LENIENT path (finding F22): if ANY money cell in the file
 * contains a '.', the whole file is treated as decimal units; otherwise as integer milliunits.
 *
 * This is a GUESS, and it is wrong in one direction that matters: a file of whole-amount decimals
 * carries no '.' at all, so it reads as milliunits and every value understates by a factor of a
 * thousand, silently. The lenient path keeps it because a person picking a spreadsheet out of their
 * own drive has no unit to declare and a guess is better than a refusal there. The STRICT path below
 * refuses to guess: it takes the unit as an argument, and this function is demoted to an observation
 * recorded beside the declaration so a disagreement can be reported.
 */
function detectMoneyFormat(records: string[][], moneyCols: number[]): MoneyUnit {
  for (const rec of records) {
    for (const c of moneyCols) {
      const v = (rec[c] ?? '').trim();
      if (v.includes('.')) return 'decimal';
    }
  }
  return 'milliunits';
}

function parseMoneyCell(value: string, format: MoneyUnit): Money {
  const v = value.trim();
  if (v === '') return 0;
  if (format === 'decimal') return fromDecimal(v);
  const n = Number(v.replace(/[,\s]/g, ''));
  if (!Number.isSafeInteger(n)) throw new Error(`not an integer milliunit value: "${value}"`);
  return n;
}

// ---------------------------------------------------------------------------
// The STRICT ingestion policy — spec 08 wave A2 (tasks A2.1, A2.3, A2.4)
//
// One parser, two policies. The row builder below is shared: the lenient path keeps every documented
// coercion, and the strict path refuses instead. That is the whole reason this lives here rather than
// in a second module — a rule can only be widened in one place if there is only one place.
// ---------------------------------------------------------------------------

/** Every way the strict path refuses. Each code names one distinct, actionable defect. */
export type StrictRefusalCode =
  | 'HEADER_REFUSED'
  | 'MONEY_UNIT_NOT_DECLARED'
  | 'MONEY_GROUPING_SEPARATOR'
  | 'MONEY_NOT_A_NUMBER'
  | 'MONEY_FRACTION_OF_A_MILLIUNIT'
  | 'MONEY_PRECISION_WOULD_ROUND'
  | 'MONEY_OUT_OF_SAFE_RANGE'
  | 'TRANSACTION_TYPE_UNRECOGNISED'
  | 'DIRECTION_ABSENT'
  | 'DIRECTION_UNRECOGNISED'
  | 'DIRECTION_DISAGREES_WITH_COLUMNS'
  | 'AMOUNT_MAGNITUDE_DISAGREES'
  | 'CONFIDENCE_UNRECOGNISED'
  | 'PROVENANCE_SOURCE_ABSENT';

/** A refusal, carrying its code and the column at fault. Never the offending value. */
export class LedgerIngestRefusal extends Error {
  constructor(
    readonly code: StrictRefusalCode,
    readonly column: string,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerIngestRefusal';
  }
}

/**
 * The upstream transaction-type vocabulary, mapped into this repository's six.
 *
 * A DECLARED MAP, not a coercion, and the difference is the whole point of finding F23. The lenient
 * path turns any unrecognised token into `charge`, which on the live canonical export means all of its
 * rows — not one of its nine tokens is in the canonical six. A declared map states each translation so
 * it can be argued with; an unlisted token is REFUSED rather than absorbed, so a vocabulary change
 * upstream surfaces as a failure instead of as a silent reclassification. The upstream token is also
 * kept verbatim on the row, so nothing this map decides is irreversible.
 *
 * These keys are a type vocabulary — no value, no balance, no account, no payee — so naming them here
 * carries no ledger content, which is what makes a declared map possible at all in a public repository.
 */
export const TRANSACTION_TYPE_VOCABULARY: Readonly<Record<string, LedgerTransactionType>> = {
  charge: 'charge',
  payment: 'payment',
  fee: 'fee',
  interest: 'interest',
  transfer: 'transfer',
  salary: 'salary',
  purchase: 'charge',
  subscription: 'charge',
  'atm withdrawal': 'charge',
  'installment/bnpl': 'charge',
  'card payment/credit': 'payment',
  'refund/credit': 'payment',
  'fee/interest': 'fee',
  'transfer in': 'transfer',
  'transfer out': 'transfer',
};

/** The upstream direction vocabulary. An accounting `debit` is an outflow of the owner's money. */
export const DIRECTION_VOCABULARY: Readonly<Record<string, LedgerDirection>> = {
  in: 'in',
  out: 'out',
  credit: 'in',
  debit: 'out',
};

/**
 * The upstream extraction-method vocabulary. An unlisted token becomes `unknown` — never `manual`,
 * which is the coercion K4 forbids and F23 names, because a row extracted by an unknown means must
 * not claim a human entered it.
 */
export const EXTRACTION_VOCABULARY: Readonly<Record<string, IngestExtractionMethod>> = {
  parser: 'parser',
  ocr: 'ocr',
  manual: 'manual',
  unknown: 'unknown',
  'pdftotext-layout': 'parser',
};

const MONEY_TEXT = /^[+-]?\d+(?:\.\d+)?$/;
const GROUPING_CHARS = /[,\s\u00A0\u066B\u066C]/;

/**
 * Money at the ingestion boundary: an integer number of milliunits, or a refusal. Three refusals
 * matter, and each corresponds to something the money core would otherwise absorb helpfully:
 *
 *  - a GROUPING SEPARATOR. `fromDecimal` strips them, which is right for text a person typed and
 *    wrong for a machine artifact, where a stray separator means the upstream export changed format.
 *  - a FRACTION OF A MILLIUNIT under a milliunit declaration. There is no such quantity.
 *  - a value that WOULD ROUND. `fromDecimal` rounds the fourth decimal place half away from zero. A
 *    rounded amount is indistinguishable from a measured one once stored, so it is refused here.
 *
 * The conversion itself is delegated to the money core. There is one implementation of money.
 */
function parseMoneyStrict(value: string, column: string, unit: MoneyUnit): Money {
  const v = value.trim();
  if (v === '') return 0;
  if (GROUPING_CHARS.test(v)) {
    throw new LedgerIngestRefusal(
      'MONEY_GROUPING_SEPARATOR',
      column,
      `${column} carries a grouping separator. The money core strips separators, so accepting one here would let an upstream format change pass unnoticed; at the ingestion boundary it is refused.`,
    );
  }
  if (!MONEY_TEXT.test(v)) {
    throw new LedgerIngestRefusal('MONEY_NOT_A_NUMBER', column, `${column} is not a plain decimal number.`);
  }
  const dot = v.indexOf('.');
  if (unit === 'milliunits') {
    if (dot >= 0) {
      throw new LedgerIngestRefusal(
        'MONEY_FRACTION_OF_A_MILLIUNIT',
        column,
        `${column} is declared in milliunits and carries a fractional part. A fraction of a milliunit is not a quantity this system can hold, so it is refused rather than truncated.`,
      );
    }
    const n = Number(v);
    if (!Number.isSafeInteger(n)) {
      throw new LedgerIngestRefusal('MONEY_OUT_OF_SAFE_RANGE', column, `${column} is outside the safe integer range.`);
    }
    return n;
  }
  const fractionDigits = dot < 0 ? 0 : v.length - dot - 1;
  if (fractionDigits > 3) {
    throw new LedgerIngestRefusal(
      'MONEY_PRECISION_WOULD_ROUND',
      column,
      `${column} carries ${fractionDigits} fractional digits, and a milliunit holds three. The money core would round the fourth; a rounded amount is indistinguishable from a measured one once stored, so it is refused.`,
    );
  }
  try {
    return fromDecimal(v);
  } catch {
    throw new LedgerIngestRefusal('MONEY_OUT_OF_SAFE_RANGE', column, `${column} could not be expressed in milliunits.`);
  }
}

function resolveConfidence(raw: string): { bps: number | null; band: ConfidenceBand | null } {
  const v = raw.trim().toLowerCase();
  if (v === '') return { bps: null, band: null };
  if ((CONFIDENCE_BANDS as readonly string[]).includes(v)) return { bps: null, band: v as ConfidenceBand };
  if (/^\d+(?:\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (n >= 0 && n <= 1) return { bps: Math.round(n * 10_000), band: null };
    if (n > 1 && n <= 100) return { bps: Math.round(n * 100), band: null };
  }
  throw new LedgerIngestRefusal(
    'CONFIDENCE_UNRECOGNISED',
    'confidence_score',
    'confidence_score is neither an ordinal band nor a score this boundary recognises. It is refused rather than read as zero, which is what the lenient path does to a non-numeric cell.',
  );
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

/** How one row is read. The only difference between the two callers of the builder below. */
interface RowPolicy {
  readonly mode: 'lenient' | 'strict';
  readonly moneyUnit: MoneyUnit;
}

type CellReader = (name: (typeof LEDGER_COLUMNS)[number]) => string;

/**
 * THE row builder. One implementation, two policies.
 *
 * Where the two diverge, the lenient branch is the behaviour the browser import has always had and
 * the strict branch is what the ingestion boundary requires; each divergence is commented with the
 * finding it answers. Throws on refusal, which the callers turn into a row error.
 */
function buildIngestRow(cell: CellReader, policy: RowPolicy): IngestLedgerRow {
  const strict = policy.mode === 'strict';
  const money = (name: (typeof LEDGER_COLUMNS)[number]): Money =>
    strict ? parseMoneyStrict(cell(name), name, policy.moneyUnit) : parseMoneyCell(cell(name), policy.moneyUnit);

  const typeRaw = cell('transaction_type');
  const typeKey = typeRaw.toLowerCase();
  // F23, first coercion: lenient calls anything it does not recognise a charge.
  const transactionType: LedgerTransactionType = strict
    ? (TRANSACTION_TYPE_VOCABULARY[typeKey] ??
      ((): never => {
        throw new LedgerIngestRefusal(
          'TRANSACTION_TYPE_UNRECOGNISED',
          'transaction_type',
          'transaction_type carries a token this repository has no declared translation for. It is refused rather than called a charge, so a vocabulary change upstream surfaces instead of silently reclassifying rows.',
        );
      })())
    : (TRANSACTION_TYPES as readonly string[]).includes(typeKey)
      ? (typeKey as LedgerTransactionType)
      : 'charge';

  const extractionRaw = cell('extraction_method');
  const extractionKey = extractionRaw.toLowerCase();
  // F23, second coercion — the one that contradicts K4: lenient calls an unknown method `manual`.
  const extractionMethod: IngestExtractionMethod = strict
    ? (EXTRACTION_VOCABULARY[extractionKey] ?? UNKNOWN_EXTRACTION_METHOD)
    : (EXTRACTION_METHODS as readonly string[]).includes(extractionKey)
      ? (extractionKey as ExtractionMethod)
      : 'manual';

  const outflow = money('outflow');
  const inflow = money('inflow');
  const declaredCell = cell('amount');
  const declaredMagnitude = declaredCell === '' ? Math.abs(inflow - outflow) : money('amount');

  const directionRaw = cell('direction');
  const directionKey = directionRaw.toLowerCase();
  let direction: LedgerDirection;
  if (strict) {
    if (directionKey === '') {
      throw new LedgerIngestRefusal(
        'DIRECTION_ABSENT',
        'direction',
        // F23, third coercion: lenient infers direction from the sign of an amount which — measured on
        // the live export — is an unsigned magnitude, so the inference reads every row as an inflow.
        'direction is absent. The lenient path infers it from the sign of the amount, and an export whose amount column is an unsigned magnitude then reads as an inflow on every row, so an absent direction is refused here.',
      );
    }
    const resolved = DIRECTION_VOCABULARY[directionKey];
    if (resolved === undefined) {
      throw new LedgerIngestRefusal('DIRECTION_UNRECOGNISED', 'direction', 'direction carries an untranslatable token.');
    }
    direction = resolved;
  } else {
    direction = directionKey === 'in' || directionKey === 'out' ? directionKey : declaredMagnitude >= 0 ? 'in' : 'out';
  }

  // The signed amount is DERIVED from direction and the two magnitudes, never copied from a column
  // whose sign convention the boundary has not verified.
  const amount = strict ? (direction === 'out' ? -Math.abs(outflow) : Math.abs(inflow)) : declaredMagnitude;

  if (strict) {
    // Most specific first, so the message names the real defect. A direction that contradicts the
    // populated column also produces a magnitude mismatch, and reporting that instead would send the
    // operator to look at the wrong column.
    const populatedOut = outflow !== 0;
    const populatedIn = inflow !== 0;
    if ((direction === 'out' && (!populatedOut || populatedIn)) || (direction === 'in' && (!populatedIn || populatedOut))) {
      throw new LedgerIngestRefusal(
        'DIRECTION_DISAGREES_WITH_COLUMNS',
        'direction',
        'direction disagrees with which of the outflow and inflow columns is populated.',
      );
    }
    if (Math.abs(amount) !== Math.abs(declaredMagnitude)) {
      throw new LedgerIngestRefusal(
        'AMOUNT_MAGNITUDE_DISAGREES',
        'amount',
        'the amount derived from direction and the outflow/inflow columns does not agree in magnitude with the declared amount, so one of the three is wrong and the row is refused rather than guessed.',
      );
    }
    if (cell('source_file') === '' || cell('source_page_or_sheet') === '') {
      throw new LedgerIngestRefusal(
        'PROVENANCE_SOURCE_ABSENT',
        'source_file',
        'the row carries no source reference, so its provenance could not be recorded and it is refused rather than stored as though it had one.',
      );
    }
  }

  const confidence = strict
    ? resolveConfidence(cell('confidence_score'))
    : // Lenient keeps its own reading: an absent score means full confidence, and a non-numeric one
      // reads as zero. Measured on the live export, every cell is an ordinal word, so this is zero
      // throughout — which is why the strict path carries a band instead.
      { bps: Math.round(Math.min(1, Math.max(0, cell('confidence_score') === '' ? 1 : Number(cell('confidence_score')) || 0)) * 10_000), band: null };

  const balanceCell = cell('balance');
  const row: IngestLedgerRow = {
    transaction_date: normalizeDate(cell('transaction_date')),
    posting_date: cell('posting_date') ? normalizeDate(cell('posting_date')) : normalizeDate(cell('transaction_date')),
    payee: cell('payee'),
    merchant: cell('merchant'),
    description: cell('description'),
    category: cell('category'),
    transaction_type: transactionType,
    transaction_type_raw: typeRaw,
    outflow,
    inflow,
    amount,
    declared_amount_magnitude: declaredMagnitude,
    direction,
    currency: cell('currency') || 'EGP',
    balance: balanceCell === '' ? null : money('balance'),
    account: cell('account'),
    account_identifier: cell('account_identifier'),
    statement_date: cell('statement_date'),
    statement_month: cell('statement_month'),
    source_file: cell('source_file'),
    source_page_or_sheet: cell('source_page_or_sheet'),
    extraction_method: extractionMethod,
    extraction_method_raw: extractionRaw,
    confidence_bps: confidence.bps,
    confidence_band: confidence.band,
    confidence_reason: cell('confidence_reason'),
    duplicate_key: cell('duplicate_key'),
    is_duplicate: /^(true|1|yes)$/i.test(cell('is_duplicate')),
    memo: cell('memo'),
  };
  if (!row.duplicate_key) {
    row.duplicate_key = fallbackDuplicateKey({
      transaction_date: row.transaction_date,
      amount: row.amount,
      account: row.account,
      payee: row.payee,
    });
  }
  return row;
}

/** Resolve the header to a cell reader, or report the columns the contract requires and lacks. */
function cellReaderFor(table: string[][]): { reader: (rec: string[]) => CellReader; missing: string[] } {
  const header = (table[0] ?? []).map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase());
  const colIndex = new Map<string, number>();
  header.forEach((h, i) => colIndex.set(h, i));
  const missing = LEDGER_COLUMNS.filter((c) => !colIndex.has(c));
  const reader = (rec: string[]): CellReader => (name) => (rec[colIndex.get(name) ?? -1] ?? '').trim();
  return { reader, missing: missing as string[] };
}

/** Parse the full CSV text into validated LedgerRows. The LENIENT path — the browser import. */
export function parseLedgerCsv(text: string): ParsedLedger {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [], moneyFormat: 'milliunits' };

  const { reader, missing } = cellReaderFor(table);
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ rowNumber: 0, message: `missing required columns: ${missing.join(', ')}` }],
      moneyFormat: 'milliunits',
    };
  }

  const records = table.slice(1);
  const header = (table[0] ?? []).map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase());
  const moneyCols = ['outflow', 'inflow', 'amount', 'balance'].map((c) => header.indexOf(c));
  const moneyFormat = detectMoneyFormat(records, moneyCols);
  const policy: RowPolicy = { mode: 'lenient', moneyUnit: moneyFormat };

  const rows: LedgerRow[] = [];
  const errors: ParseError[] = [];
  records.forEach((rec, i) => {
    try {
      const built = buildIngestRow(reader(rec), policy);
      // Under the lenient policy the extraction method is provably one of the narrow three, and the
      // confidence is a score rather than a band, so the browser shape is recovered without a cast
      // that hides anything: the two fields the strict shape widened are narrowed back explicitly.
      const method: ExtractionMethod =
        built.extraction_method === UNKNOWN_EXTRACTION_METHOD ? 'manual' : built.extraction_method;
      rows.push({
        ...built,
        extraction_method: method,
        confidence_score: (built.confidence_bps ?? 10_000) / 10_000,
      });
    } catch (e) {
      errors.push({ rowNumber: i + 1, message: e instanceof Error ? e.message : String(e) });
    }
  });

  return { rows, errors, moneyFormat };
}

export interface StrictParseOptions {
  /**
   * The unit every money cell is expressed in. REQUIRED — this is the F22 fix. The boundary refuses
   * to guess, because the guess is silently wrong on a file of whole-amount decimals.
   */
  readonly moneyUnit?: MoneyUnit;
}

export interface StrictParsedLedger {
  rows: IngestLedgerRow[];
  errors: ParseError[];
  /** The unit the caller declared. */
  declaredMoneyUnit: MoneyUnit | null;
  /** What the lenient detector would have guessed, kept only so a disagreement can be reported. */
  detectedMoneyUnit: MoneyUnit | null;
  detectorAgreesWithDeclaration: boolean;
}

/**
 * Parse the canonical export at the INGESTION boundary — spec 08 tasks A2.1, A2.3, A2.4.
 *
 * Fails closed on the header as an exact ordered name set (wave A1), on an undeclared money unit, and
 * on every coercion the lenient path performs. A row that cannot be read is reported with a code and
 * is NOT in `rows`, so a caller cannot mistake a refused row for a loaded one.
 */
export function parseLedgerCsvStrict(text: string, options: StrictParseOptions = {}): StrictParsedLedger {
  const table = parseCsv(text);
  const empty: StrictParsedLedger = {
    rows: [],
    errors: [],
    declaredMoneyUnit: options.moneyUnit ?? null,
    detectedMoneyUnit: null,
    detectorAgreesWithDeclaration: false,
  };
  if (table.length === 0) {
    return { ...empty, errors: [{ rowNumber: 0, message: 'the file holds no rows', code: 'HEADER_REFUSED' }] };
  }

  const verdict = verifyCanonicalHeader(table[0] ?? []);
  if (!verdict.ok) {
    return { ...empty, errors: [{ rowNumber: 0, message: verdict.message, code: 'HEADER_REFUSED' }] };
  }
  if (options.moneyUnit === undefined) {
    return {
      ...empty,
      errors: [
        {
          rowNumber: 0,
          code: 'MONEY_UNIT_NOT_DECLARED',
          message:
            'the money unit was not declared. The lenient path guesses it by looking for a decimal point, and a file of whole-amount decimals carries none and would read as milliunits, understating every value by a factor of a thousand. The ingestion boundary refuses to guess.',
        },
      ],
    };
  }

  const records = table.slice(1);
  const header = (table[0] ?? []).map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase());
  const moneyCols = ['outflow', 'inflow', 'amount', 'balance'].map((c) => header.indexOf(c));
  const detected = detectMoneyFormat(records, moneyCols);
  const { reader } = cellReaderFor(table);
  const policy: RowPolicy = { mode: 'strict', moneyUnit: options.moneyUnit };

  const rows: IngestLedgerRow[] = [];
  const errors: ParseError[] = [];
  records.forEach((rec, i) => {
    try {
      rows.push(buildIngestRow(reader(rec), policy));
    } catch (e) {
      if (e instanceof LedgerIngestRefusal) {
        errors.push({ rowNumber: i + 1, message: e.message, code: e.code, column: e.column });
      } else {
        errors.push({ rowNumber: i + 1, message: e instanceof Error ? e.message : String(e) });
      }
    }
  });

  return {
    rows,
    errors,
    declaredMoneyUnit: options.moneyUnit,
    detectedMoneyUnit: detected,
    detectorAgreesWithDeclaration: detected === options.moneyUnit,
  };
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
