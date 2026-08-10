/**
 * NIZAM · Spec 08 wave A1, task A1.1 — the shape gate, and the proof it fires.
 *
 * These cases need no financial data, so they run everywhere and forever: the contract they check is
 * two tracked files, and the tampers are synthetic. The task exists because a width check passes both
 * of the failures that actually happen, so the central case here asserts exactly that — the tampered
 * headers are the RIGHT WIDTH and are still refused.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEDGER_COLUMNS } from './ledger.types.ts';
import { verifyCanonicalHeader, normaliseHeaderCell } from './ledgerHeader.ts';

const CANONICAL = [...LEDGER_COLUMNS] as string[];

/** The tracked markdown contract, read as an independent statement of the same truth. */
function columnsDeclaredInSchemaDoc(): string[] {
  const text = readFileSync('data/ledgers/LEDGER_SCHEMA.md', 'utf8');
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    // Table rows look like: | 8 | outflow | int(milliunits) | >=0 |
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const ordinal = Number(cells[1]);
    if (!Number.isInteger(ordinal) || ordinal < 1) continue;
    out.push(cells[2].toLowerCase());
  }
  return out;
}

describe('the canonical ledger contract', () => {
  it('declares exactly 25 columns', () => {
    expect(CANONICAL).toHaveLength(25);
  });

  /**
   * The drift check. The code constant and the tracked schema document are two independent artifacts
   * that must say the same thing; if one is edited without the other, this fails rather than letting
   * the two definitions of "canonical" quietly diverge.
   */
  it('agrees, in order, with the tracked schema document', () => {
    expect(columnsDeclaredInSchemaDoc()).toEqual(CANONICAL);
  });
});

describe('verifyCanonicalHeader releases the canonical header', () => {
  it('accepts the exact declared order', () => {
    const verdict = verifyCanonicalHeader(CANONICAL);
    expect(verdict.ok).toBe(true);
  });

  it('accepts a byte-order mark, casing and surrounding whitespace', () => {
    // The real export carries a leading BOM, so this is the shape of the actual file, not a hypothetical.
    const messy = CANONICAL.map((c, i) => (i === 0 ? `\uFEFF  ${c.toUpperCase()}  ` : ` ${c} `));
    expect(verifyCanonicalHeader(messy).ok).toBe(true);
    expect(normaliseHeaderCell('\uFEFF  Transaction_Date  ')).toBe('transaction_date');
  });
});

describe('verifyCanonicalHeader refuses the failures a width check cannot see', () => {
  /** Swap the two money-direction columns: the most consequential possible swap. */
  const swapped = (() => {
    const h = [...CANONICAL];
    const a = h.indexOf('outflow');
    const b = h.indexOf('inflow');
    [h[a], h[b]] = [h[b], h[a]];
    return h;
  })();

  /** Rename the signed money column, keeping the width identical. */
  const renamed = CANONICAL.map((c) => (c === 'amount' ? 'amount_egp' : c));

  it('refuses two swapped columns as ORDER', () => {
    const verdict = verifyCanonicalHeader(swapped);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('ORDER');
    expect(verdict.firstOrderDivergence).toBe(CANONICAL.indexOf('outflow'));
    expect(verdict.message).toContain('inflow');
  });

  it('refuses a renamed column as RENAMED, naming both sides', () => {
    const verdict = verifyCanonicalHeader(renamed);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('RENAMED');
    expect(verdict.missing).toEqual(['amount']);
    expect(verdict.extra).toEqual(['amount_egp']);
  });

  /**
   * THE POINT OF THE TASK. Both tampers are the right width, so the obvious guard reports success on
   * both. Asserting the width equality here is what turns "we also check names" into evidence that the
   * name check is load-bearing rather than redundant.
   */
  it('is the only guard that catches them: both tampers are exactly 25 columns wide', () => {
    expect(swapped).toHaveLength(CANONICAL.length);
    expect(renamed).toHaveLength(CANONICAL.length);

    const widthOnlyGuard = (h: readonly string[]) => h.length === 25;
    expect(widthOnlyGuard(swapped)).toBe(true);
    expect(widthOnlyGuard(renamed)).toBe(true);

    expect(verifyCanonicalHeader(swapped).ok).toBe(false);
    expect(verifyCanonicalHeader(renamed).ok).toBe(false);
  });

  it('refuses a repeated column name, which a name-to-index map would silently resolve last-wins', () => {
    const dup = CANONICAL.map((c) => (c === 'memo' ? 'payee' : c));
    const verdict = verifyCanonicalHeader(dup);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('DUPLICATE');
    expect(verdict.duplicated).toEqual(['payee']);
  });

  it('refuses an undeclared extra column rather than ignoring it', () => {
    const verdict = verifyCanonicalHeader([...CANONICAL, 'fx_rate']);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('EXTRA');
    expect(verdict.extra).toEqual(['fx_rate']);
  });

  it('refuses an omitted column', () => {
    const verdict = verifyCanonicalHeader(CANONICAL.filter((c) => c !== 'currency'));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('MISSING');
    expect(verdict.missing).toEqual(['currency']);
  });
});
