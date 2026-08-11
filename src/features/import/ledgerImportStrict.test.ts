/**
 * NIZAM · The ingestion boundary refuses rather than coerces — spec 08 wave A2 (A2.3, A2.4).
 * Implemented by: PFOS Contract 06 / Phase 2.2 (spec 08-knowledge-ingestion, wave A2)
 * Depends on: ledgerImport.ts, @/lib/ledger/ledger.types
 *
 * Every fixture here is SYNTHETIC. No value in this file came from the owner's ledger, which is what
 * lets these cases run on a clean checkout with no local cache present.
 *
 * The cases are organised around the four findings wave A1 left open, because a test that only asserts
 * the happy path would pass equally well against the coercing implementation these findings describe:
 *
 *   F22  the money unit is DECLARED, and an undeclared unit is refused rather than guessed.
 *   F23  three coercions — transaction type, extraction method, direction — refuse or resolve to
 *        `unknown`, and in particular an unknown extraction method never claims a human entered it.
 *   F24  a duplicated or an undeclared column is refused by the header gate the strict path runs.
 *   A2.3 a grouping separator, a fraction of a milliunit, and a value that would round are each
 *        refused, and each with its own code so the operator learns which of the three happened.
 */
import { describe, it, expect } from 'vitest';
import {
  parseLedgerCsv,
  parseLedgerCsvStrict,
  EXTRACTION_VOCABULARY,
  TRANSACTION_TYPE_VOCABULARY,
} from './ledgerImport.ts';
import { LEDGER_COLUMNS } from '@/lib/ledger/ledger.types';

/** A synthetic row, in canonical column order. Overrides are applied by column name. */
function row(overrides: Partial<Record<(typeof LEDGER_COLUMNS)[number], string>> = {}): string {
  const base: Record<string, string> = {
    transaction_date: '2026-01-05',
    posting_date: '2026-01-06',
    payee: 'Synthetic Payee',
    merchant: 'Synthetic Merchant',
    description: 'synthetic narrative, with a comma',
    category: 'Synthetic',
    transaction_type: 'Purchase',
    outflow: '10.00',
    inflow: '',
    amount: '10.00',
    direction: 'debit',
    currency: 'EGP',
    balance: '',
    account: 'Synthetic Account',
    account_identifier: '0000',
    statement_date: '2026-01-31',
    statement_month: '2026-01',
    source_file: 'synthetic.pdf',
    source_page_or_sheet: 'p1',
    extraction_method: 'pdftotext-layout',
    confidence_score: 'medium',
    confidence_reason: 'synthetic',
    duplicate_key: 'dk_synthetic_1',
    is_duplicate: 'FALSE',
    memo: '',
  };
  const merged = { ...base, ...overrides };
  return LEDGER_COLUMNS.map((c) => {
    const v = merged[c] ?? '';
    return v.includes(',') ? `"${v}"` : v;
  }).join(',');
}

function csv(rows: string[], header: readonly string[] = LEDGER_COLUMNS): string {
  return [header.join(','), ...rows].join('\n');
}

describe('A2.3 — money is an integer milliunit at the boundary or it is refused', () => {
  it('refuses a file whose money unit was not declared, rather than guessing it', () => {
    const parsed = parseLedgerCsvStrict(csv([row()]));
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors[0]?.code).toBe('MONEY_UNIT_NOT_DECLARED');
  });

  it('refuses a thousands separator, which the money core would otherwise strip', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ outflow: '1,234.50', amount: '1,234.50' })]), {
      moneyUnit: 'decimal',
    });
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors[0]?.code).toBe('MONEY_GROUPING_SEPARATOR');
    expect(parsed.errors[0]?.column).toBe('outflow');
  });

  it('refuses a fractional value under a milliunit declaration', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ outflow: '12500.5', amount: '12500.5' })]), {
      moneyUnit: 'milliunits',
    });
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors[0]?.code).toBe('MONEY_FRACTION_OF_A_MILLIUNIT');
  });

  it('refuses a value that would round, rather than rounding it', () => {
    // Four fractional digits: a milliunit holds three, so the fourth would round half away from zero.
    const parsed = parseLedgerCsvStrict(csv([row({ outflow: '10.0005', amount: '10.0005' })]), {
      moneyUnit: 'decimal',
    });
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors[0]?.code).toBe('MONEY_PRECISION_WOULD_ROUND');
  });

  it('shows the lenient path coercing all three, which is why the strict path exists', () => {
    // The same three inputs, read by the browser import: none is refused, and the rounded one is
    // silently rounded. This is the comparison that makes the refusals above load-bearing.
    const lenient = parseLedgerCsv(csv([row({ outflow: '1,234.50', amount: '1,234.50' })]));
    expect(lenient.errors).toEqual([]);
    expect(lenient.rows[0]?.outflow).toBe(1_234_500);
    const rounded = parseLedgerCsv(csv([row({ outflow: '10.0005', amount: '10.0005' })]));
    expect(rounded.errors).toEqual([]);
    expect(rounded.rows[0]?.outflow).toBe(10_001);
  });

  it('accepts a well-formed decimal exactly, with no float in the result', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ outflow: '10.125', amount: '10.125' })]), { moneyUnit: 'decimal' });
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.outflow).toBe(10_125);
    expect(Number.isSafeInteger(parsed.rows[0]?.amount ?? NaN)).toBe(true);
  });

  it('records what the detector would have guessed without letting it decide', () => {
    // Whole-amount decimals: the detector finds no decimal point and would call the file milliunits.
    const parsed = parseLedgerCsvStrict(csv([row({ outflow: '10', amount: '10' })]), { moneyUnit: 'decimal' });
    expect(parsed.detectedMoneyUnit).toBe('milliunits');
    expect(parsed.declaredMoneyUnit).toBe('decimal');
    expect(parsed.detectorAgreesWithDeclaration).toBe(false);
    // The declaration won, so the value is 10 EGP and not 10 milliunits.
    expect(parsed.rows[0]?.outflow).toBe(10_000);
  });
});

describe('A2.4 — provenance is carried, and unknown provenance loads as unknown (K4, F23)', () => {
  it('resolves an undeclared extraction method to unknown, never to manual', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ extraction_method: 'some-future-extractor' })]), {
      moneyUnit: 'decimal',
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.extraction_method).toBe('unknown');
    expect(parsed.rows[0]?.extraction_method_raw).toBe('some-future-extractor');
  });

  it('shows the lenient path calling that same row manual, which is the K4 violation', () => {
    const lenient = parseLedgerCsv(csv([row({ extraction_method: 'some-future-extractor' })]));
    expect(lenient.rows[0]?.extraction_method).toBe('manual');
  });

  it('translates a declared upstream extractor token and keeps the token verbatim', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ extraction_method: 'pdftotext-layout' })]), {
      moneyUnit: 'decimal',
    });
    expect(parsed.rows[0]?.extraction_method).toBe(EXTRACTION_VOCABULARY['pdftotext-layout']);
    expect(parsed.rows[0]?.extraction_method).toBe('parser');
    expect(parsed.rows[0]?.extraction_method_raw).toBe('pdftotext-layout');
  });

  it('refuses a row with no source reference rather than storing it as though it had one', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ source_file: '', source_page_or_sheet: '' })]), {
      moneyUnit: 'decimal',
    });
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors[0]?.code).toBe('PROVENANCE_SOURCE_ABSENT');
  });

  it('carries an ordinal confidence band as a band, not as a score of zero', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ confidence_score: 'medium' })]), { moneyUnit: 'decimal' });
    expect(parsed.rows[0]?.confidence_band).toBe('medium');
    expect(parsed.rows[0]?.confidence_bps).toBeNull();
    // The lenient path reads the same cell as zero confidence, silently.
    expect(parseLedgerCsv(csv([row({ confidence_score: 'medium' })])).rows[0]?.confidence_score).toBe(0);
  });

  it('carries a numeric confidence as basis points', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ confidence_score: '0.87' })]), { moneyUnit: 'decimal' });
    expect(parsed.rows[0]?.confidence_bps).toBe(8_700);
    expect(parsed.rows[0]?.confidence_band).toBeNull();
  });

  it('refuses a confidence token that is neither a band nor a score', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ confidence_score: 'probably fine' })]), { moneyUnit: 'decimal' });
    expect(parsed.errors[0]?.code).toBe('CONFIDENCE_UNRECOGNISED');
  });
});

describe('A2.4 — the type and direction coercions (F23)', () => {
  it('translates a declared upstream type token and keeps the token verbatim', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ transaction_type: 'Transfer Out' })]), { moneyUnit: 'decimal' });
    expect(parsed.rows[0]?.transaction_type).toBe(TRANSACTION_TYPE_VOCABULARY['transfer out']);
    expect(parsed.rows[0]?.transaction_type).toBe('transfer');
    expect(parsed.rows[0]?.transaction_type_raw).toBe('Transfer Out');
  });

  it('refuses an untranslatable type rather than calling it a charge', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ transaction_type: 'Cryptocurrency Staking Reward' })]), {
      moneyUnit: 'decimal',
    });
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors[0]?.code).toBe('TRANSACTION_TYPE_UNRECOGNISED');
    // The lenient path calls it a charge.
    expect(parseLedgerCsv(csv([row({ transaction_type: 'Cryptocurrency Staking Reward' })])).rows[0]?.transaction_type).toBe('charge');
  });

  it('refuses an absent direction rather than inferring it from an unsigned magnitude', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ direction: '' })]), { moneyUnit: 'decimal' });
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors[0]?.code).toBe('DIRECTION_ABSENT');
  });

  it('derives a signed amount from direction, so an unsigned export cannot post an outflow as an inflow', () => {
    const out = parseLedgerCsvStrict(csv([row({ direction: 'debit', outflow: '10.00', inflow: '', amount: '10.00' })]), {
      moneyUnit: 'decimal',
    });
    const inn = parseLedgerCsvStrict(csv([row({ direction: 'credit', outflow: '', inflow: '10.00', amount: '10.00' })]), {
      moneyUnit: 'decimal',
    });
    expect(out.rows[0]?.amount).toBe(-10_000);
    expect(inn.rows[0]?.amount).toBe(10_000);
    // The declared magnitude is unsigned in both cases, and is kept so the derivation is checkable.
    expect(out.rows[0]?.declared_amount_magnitude).toBe(10_000);
    // The lenient path copies the unsigned magnitude, so the outflow posts positive.
    expect(parseLedgerCsv(csv([row({ direction: 'debit', outflow: '10.00', amount: '10.00' })])).rows[0]?.amount).toBe(10_000);
  });

  it('refuses a direction that disagrees with which magnitude column is populated', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ direction: 'credit', outflow: '10.00', inflow: '', amount: '10.00' })]), {
      moneyUnit: 'decimal',
    });
    expect(parsed.errors[0]?.code).toBe('DIRECTION_DISAGREES_WITH_COLUMNS');
  });

  it('refuses a declared amount whose magnitude disagrees with the two columns', () => {
    const parsed = parseLedgerCsvStrict(csv([row({ outflow: '10.00', amount: '99.00' })]), { moneyUnit: 'decimal' });
    expect(parsed.errors[0]?.code).toBe('AMOUNT_MAGNITUDE_DISAGREES');
  });
});

describe('F24 — the strict path runs the header gate, and the lenient one does not', () => {
  it('refuses a duplicated column, which a name-to-index map would resolve last-wins', () => {
    const header = [...LEDGER_COLUMNS.slice(0, 24), 'memo', 'memo'];
    const parsed = parseLedgerCsvStrict(csv([`${row()},extra`], header), { moneyUnit: 'decimal' });
    expect(parsed.errors[0]?.code).toBe('HEADER_REFUSED');
    expect(parsed.errors[0]?.message).toContain('repeats');
  });

  it('refuses an undeclared column rather than ignoring it', () => {
    const header = [...LEDGER_COLUMNS, 'settlement_reference'];
    const parsed = parseLedgerCsvStrict(csv([`${row()},x`], header), { moneyUnit: 'decimal' });
    expect(parsed.errors[0]?.code).toBe('HEADER_REFUSED');
    expect(parsed.errors[0]?.message).toContain('does not declare');
  });

  it('refuses a reordered header of exactly the right width', () => {
    const swapped: string[] = LEDGER_COLUMNS.map((c) => String(c));
    const a = swapped[7] as string;
    const b = swapped[8] as string;
    swapped[7] = b;
    swapped[8] = a;
    const parsed = parseLedgerCsvStrict(csv([row()], swapped), { moneyUnit: 'decimal' });
    expect(parsed.errors[0]?.code).toBe('HEADER_REFUSED');
    expect(parsed.rows).toHaveLength(0);
  });

  it('admits the canonical header, so the gate is shown releasing as well as refusing', () => {
    const parsed = parseLedgerCsvStrict(csv([row(), row({ duplicate_key: 'dk_synthetic_2' })]), {
      moneyUnit: 'decimal',
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
  });
});
