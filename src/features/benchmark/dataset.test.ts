/**
 * NIZAM - PFOS benchmark harness (M2): eval-set contract tests.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration).
 * Build phase: PFOS Stage 7, phase 7.1 - benchmark harness (offline).
 * Depends on: dataset, benchmark.types.
 */
import { describe, it, expect } from 'vitest';
import { buildEvalSet, countByCategory, validateEvalSet } from './dataset';
import { BENCHMARK_MINIMUM_CASES, CATEGORY_MINIMUMS } from './benchmark.types';

describe('benchmark eval set', () => {
  const cases = buildEvalSet();

  it('validates clean (meets contract 09)', () => {
    const v = validateEvalSet(cases);
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('reaches the >=210 case minimum', () => {
    expect(cases.length).toBeGreaterThanOrEqual(BENCHMARK_MINIMUM_CASES);
  });

  it('meets every per-category minimum', () => {
    const counts = countByCategory(cases);
    for (const [cat, min] of Object.entries(CATEGORY_MINIMUMS)) {
      expect(counts[cat as keyof typeof CATEGORY_MINIMUMS]).toBeGreaterThanOrEqual(min);
    }
  });

  it('has unique case ids', () => {
    const ids = new Set(cases.map((c) => c.id));
    expect(ids.size).toBe(cases.length);
  });

  it('category counts sum to the total', () => {
    const counts = countByCategory(cases);
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(cases.length);
  });

  it('flags an under-count as invalid', () => {
    const short = cases.filter((c) => c.category !== 'adversarial');
    const v = validateEvalSet(short);
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes('adversarial'))).toBe(true);
  });
});
