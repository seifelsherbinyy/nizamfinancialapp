/**
 * NIZAM · The canonical ledger header FINGERPRINT — spec 08 wave A1, task A1.1.
 *
 * ## Why a width check is not a shape check
 *
 * The obvious guard counts the columns. It cannot see the two failures that actually happen:
 *
 *   - two columns **swapped**, and
 *   - one column **renamed**.
 *
 * Both keep the width identical, so a width guard reports success on a file whose meaning has moved.
 * The failure this protects against is not hypothetical: an upstream export can keep its column count
 * while changing a money column's label and narrowing its row scope, and only a header NAME-SET
 * comparison catches it. So this module compares the header against the canonical contract as an
 * **exact, ordered name set**, and names the specific difference rather than answering yes or no.
 *
 * ## Why duplicates are refused rather than tolerated
 *
 * A parser that builds a name-to-index map assigns each name in turn, so a repeated column name means
 * the LAST occurrence silently wins and an entire column is read from the wrong place. Nothing about
 * that is visible in the output. It is refused here.
 *
 * ## Why there are two strictness levels, deliberately
 *
 * `parseLedgerCsv` addresses cells by NAME and is therefore order-independent, which is correct for a
 * human-supplied import: a spreadsheet a person exported may legitimately order its columns
 * differently and still mean exactly the same thing. Ingestion is the opposite case. There the file is
 * a known artifact produced by a known pipeline, and a change in its shape is evidence that the
 * upstream export changed — something the operator must be told about, not something to absorb. So the
 * lenient path keeps its behaviour and the strict path is used at the ingestion boundary. Two callers,
 * two risk profiles, one implementation of the contract.
 */
import { LEDGER_COLUMNS } from './ledger.types.ts';

/** Why a header was refused. Every code names a distinct, actionable failure. */
export type HeaderRefusalCode = 'DUPLICATE' | 'RENAMED' | 'MISSING' | 'EXTRA' | 'ORDER';

export interface HeaderOk {
  readonly ok: true;
  /** The normalised header, which by definition equals the canonical column order. */
  readonly columns: readonly string[];
}

export interface HeaderRefused {
  readonly ok: false;
  readonly code: HeaderRefusalCode;
  /** Operator-facing sentence. Names the columns at fault, never just a count. */
  readonly message: string;
  /** Canonical columns absent from the file. */
  readonly missing: readonly string[];
  /** Columns present in the file that the contract does not declare. */
  readonly extra: readonly string[];
  /** Column names appearing more than once, with their positions. */
  readonly duplicated: readonly string[];
  /** First position at which order diverges, when the name sets agree. Null otherwise. */
  readonly firstOrderDivergence: number | null;
}

export type HeaderVerdict = HeaderOk | HeaderRefused;

/**
 * Mirrors the normalisation `parseLedgerCsv` performs, so the strict gate and the lenient parser can
 * never disagree about what a cell is called.
 *
 * The leading byte-order mark is stripped explicitly. `String.prototype.trim` already removes U+FEFF
 * because the specification counts it as whitespace, and the canonical export does carry one — but a
 * reader should not have to know that to see that a BOM is handled.
 */
export function normaliseHeaderCell(raw: string): string {
  return raw.replace(/^\uFEFF/, '').trim().toLowerCase();
}

/**
 * Compare a file's header against the canonical contract as an exact ordered name set.
 *
 * Checks run most-specific first, so the message describes the real defect: a duplicate is reported as
 * a duplicate rather than as an absent column, and a rename is reported as a rename rather than as an
 * unrelated absence and addition.
 */
export function verifyCanonicalHeader(rawHeader: readonly string[]): HeaderVerdict {
  const columns = rawHeader.map(normaliseHeaderCell);
  const canonical = LEDGER_COLUMNS as readonly string[];

  const seen = new Map<string, number>();
  const duplicated: string[] = [];
  for (const c of columns) {
    const n = (seen.get(c) ?? 0) + 1;
    seen.set(c, n);
    if (n === 2) duplicated.push(c);
  }
  if (duplicated.length > 0) {
    return {
      ok: false,
      code: 'DUPLICATE',
      message:
        `the header repeats ${duplicated.length} column name(s): ${duplicated.join(', ')}. A name-to-index ` +
        'map keeps the last occurrence, so a repeated name silently reads a whole column from the wrong place.',
      missing: [],
      extra: [],
      duplicated,
      firstOrderDivergence: null,
    };
  }

  const present = new Set(columns);
  const declared = new Set(canonical);
  const missing = canonical.filter((c) => !present.has(c));
  const extra = columns.filter((c) => !declared.has(c));

  if (missing.length > 0 && extra.length > 0) {
    return {
      ok: false,
      code: 'RENAMED',
      message:
        `the header is the right shape but the wrong contract: ${missing.length} declared column(s) are ` +
        `absent (${missing.join(', ')}) while ${extra.length} undeclared one(s) are present ` +
        `(${extra.join(', ')}). A column was renamed, and a width check cannot see it.`,
      missing,
      extra,
      duplicated: [],
      firstOrderDivergence: null,
    };
  }
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'MISSING',
      message: `the header omits ${missing.length} declared column(s): ${missing.join(', ')}.`,
      missing,
      extra: [],
      duplicated: [],
      firstOrderDivergence: null,
    };
  }
  if (extra.length > 0) {
    return {
      ok: false,
      code: 'EXTRA',
      message:
        `the header carries ${extra.length} column(s) the contract does not declare: ${extra.join(', ')}. ` +
        'An unexpected column is an upstream change, so it is reported rather than ignored.',
      missing: [],
      extra,
      duplicated: [],
      firstOrderDivergence: null,
    };
  }

  const at = columns.findIndex((c, i) => c !== canonical[i]);
  if (at >= 0) {
    return {
      ok: false,
      code: 'ORDER',
      message:
        `the header holds exactly the declared columns but in a different order: position ${at + 1} is ` +
        `"${columns[at]}" where the contract declares "${canonical[at]}". The width is identical, which ` +
        'is precisely why width is not a shape check.',
      missing: [],
      extra: [],
      duplicated: [],
      firstOrderDivergence: at,
    };
  }

  return { ok: true, columns };
}
