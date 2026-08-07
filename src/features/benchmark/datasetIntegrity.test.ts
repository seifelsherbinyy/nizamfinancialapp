/**
 * NIZAM - PFOS benchmark harness (M2): eval-set integrity + sanitization tests.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration).
 * Build phase: PFOS Stage 6 (two-agent VPS tier), phase 6.1 - complete + verify the eval set.
 * Depends on: datasetIntegrity, dataset, benchmark.types.
 *
 * Every gate below has a NEGATIVE test that proves it fires. Forbidden tokens are assembled from
 * fragments in the test too, so this file does not itself contain a deployment particular.
 */
import { describe, it, expect } from 'vitest';
import { buildEvalSet, egpAmountText } from './dataset';
import {
  auditCase,
  auditEvalSet,
  countBySeverity,
  countByTier,
  MAX_CASE_INPUT_CHARS,
  MAX_CASE_INPUT_LINES,
  MAX_DIGIT_RUN,
  MIN_OPAQUE_ID_RUN,
  P0_CATEGORIES,
} from './datasetIntegrity';
import { type BenchmarkCase, CATEGORY_TIER, SEVERITIES } from './benchmark.types';

const CASES = buildEvalSet();

/** A known-good case to mutate: the first extraction case exercises every gate group. */
function baseCase(): BenchmarkCase {
  const c = CASES.find((x) => x.category === 'sms_extraction' && x.expected.kind === 'extraction');
  if (!c) throw new Error('no extraction case in the eval set');
  return structuredClone(c);
}

function gates(problems: { gate: string }[]): string[] {
  return problems.map((p) => p.gate);
}

describe('eval-set integrity (contract 09 sanitization)', () => {
  it('the whole assembled eval set audits clean', () => {
    const a = auditEvalSet(CASES);
    expect(a.problems).toEqual([]);
    expect(a.ok).toBe(true);
  });

  it('the base case used for the negative tests is itself clean', () => {
    expect(auditCase(baseCase())).toEqual([]);
  });

  it('pins the sanitization limits to their literals', () => {
    expect(MAX_CASE_INPUT_CHARS).toBe(400);
    expect(MAX_CASE_INPUT_LINES).toBe(3);
    expect(MIN_OPAQUE_ID_RUN).toBe(28);
    expect(MAX_DIGIT_RUN).toBe(6);
  });

  it('pins the fabrication-critical P0 categories', () => {
    expect(P0_CATEGORIES).toEqual([
      'sms_extraction',
      'multilingual',
      'purchase_decision',
      'adversarial',
    ]);
  });

  it('every case severity is a declared severity and every tier matches its category', () => {
    for (const c of CASES) {
      expect(SEVERITIES).toContain(c.severity);
      expect(c.tier).toBe(CATEGORY_TIER[c.category]);
    }
  });

  it('reports a severity and tier distribution that covers the whole set', () => {
    const sev = countBySeverity(CASES);
    const tier = countByTier(CASES);
    const sevSum = Object.values(sev).reduce((a, b) => a + b, 0);
    const tierSum = Object.values(tier).reduce((a, b) => a + b, 0);
    expect(sevSum).toBe(CASES.length);
    expect(tierSum).toBe(CASES.length);
  });
});

describe('eval-set integrity negative tests (each gate must fire)', () => {
  it('rejects a request scheme', () => {
    const c = baseCase();
    c.input += ' fetch from ' + 'ht' + 'tps://' + 'host/path';
    expect(gates(auditCase(c))).toContain('no_url_scheme');
  });

  it('rejects a bare domain', () => {
    const c = baseCase();
    c.input += ' contact bank' + '.' + 'co' + 'm';
    expect(gates(auditCase(c))).toContain('no_domain');
  });

  it('rejects a dotted-quad address', () => {
    const c = baseCase();
    c.input += ' host at 203.0.113.7';
    expect(gates(auditCase(c))).toContain('no_ip_address');
  });

  it('rejects an address or bot handle', () => {
    const c = baseCase();
    c.input += ' notify ops' + '@' + 'host-x';
    expect(gates(auditCase(c))).toContain('no_address_handle');
  });

  it('rejects a long opaque identifier', () => {
    const c = baseCase();
    c.input += ' ref ' + 'A'.repeat(MIN_OPAQUE_ID_RUN);
    expect(gates(auditCase(c))).toContain('no_opaque_identifier');
  });

  it('rejects a long numeric identifier', () => {
    const c = baseCase();
    c.input += ' user ' + '1'.repeat(MAX_DIGIT_RUN + 1);
    expect(gates(auditCase(c))).toContain('no_long_numeric_identifier');
  });

  it('rejects a recipient public key', () => {
    const c = baseCase();
    c.input += ' key ' + 'ag' + 'e' + '1' + 'q'.repeat(18);
    expect(gates(auditCase(c))).toContain('no_public_key');
  });

  it('rejects a journal-length input', () => {
    const c = baseCase();
    c.input = 'a '.repeat(MAX_CASE_INPUT_CHARS);
    expect(gates(auditCase(c))).toContain('input_within_length_limit');
  });

  it('rejects an over-line-limit input', () => {
    const c = baseCase();
    c.input = 'one\ntwo\nthree\nfour';
    expect(gates(auditCase(c))).toContain('input_within_line_limit');
  });

  it('rejects a case with no hard safety constraint', () => {
    const c = baseCase();
    c.safetyConstraints = [];
    expect(gates(auditCase(c))).toContain('has_safety_constraints');
  });

  it('rejects a case with no allowable variation', () => {
    const c = baseCase();
    c.allowableVariation = '   ';
    expect(gates(auditCase(c))).toContain('has_allowable_variation');
  });

  it('rejects an unknown severity', () => {
    const c = baseCase();
    c.severity = 'P9' as unknown as BenchmarkCase['severity'];
    expect(gates(auditCase(c))).toContain('valid_severity');
  });

  it('rejects a tier that does not match the category', () => {
    const c = baseCase();
    c.tier = 'T4';
    expect(gates(auditCase(c))).toContain('tier_matches_category');
  });

  it('rejects an expected kind the category may not carry', () => {
    const c = baseCase();
    c.expected = { kind: 'refusal' };
    expect(gates(auditCase(c))).toContain('expected_kind_matches_category');
  });

  it('rejects a fabrication-critical category that is not P0', () => {
    const c = baseCase();
    c.severity = 'P1';
    expect(gates(auditCase(c))).toContain('p0_category_severity');
  });

  it('rejects a non-integer numeric field', () => {
    const c = baseCase();
    if (c.expected.kind !== 'extraction') throw new Error('base case must be an extraction case');
    c.expected.amountMilli = 12.5;
    expect(gates(auditCase(c))).toContain('numeric_fields_are_integers');
  });

  it('rejects a non-piastre-clean amount', () => {
    const c = baseCase();
    if (c.expected.kind !== 'extraction') throw new Error('base case must be an extraction case');
    c.expected.amountMilli = 12_505; // third fractional digit set: cannot render without drift
    expect(gates(auditCase(c))).toContain('amount_is_integer_milliunits');
  });

  it('rejects an amount that disagrees with the case text', () => {
    const c = baseCase();
    if (c.expected.kind !== 'extraction') throw new Error('base case must be an extraction case');
    c.expected.amountMilli = 999_990;
    expect(c.input).not.toContain(egpAmountText(999_990));
    expect(gates(auditCase(c))).toContain('amount_text_matches_expected');
  });

  it('rejects an unmasked account identifier', () => {
    const c = baseCase();
    if (c.expected.kind !== 'extraction') throw new Error('base case must be an extraction case');
    c.expected.account = 'ACCT1234';
    expect(gates(auditCase(c))).toContain('account_is_masked');
  });
});

describe('egpAmountText (integer-only rendering)', () => {
  it('renders milliunits to two decimals with grouping', () => {
    expect(egpAmountText(1_500_000)).toBe('1,500.00');
    expect(egpAmountText(49_990)).toBe('49.99');
    expect(egpAmountText(12_500)).toBe('12.50');
  });

  it('refuses an amount that is not piastre-clean rather than silently truncating', () => {
    expect(() => egpAmountText(12_505)).toThrow(/piastre-clean/);
  });

  it('refuses a non-integer amount at the money boundary', () => {
    expect(() => egpAmountText(12.5)).toThrow(/safe integer/);
  });
});
