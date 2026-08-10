// @vitest-environment node
/**
 * NIZAM - PFOS benchmark harness (M2): end-to-end runner tests.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration).
 * Build phase: PFOS Stage 7, phase 7.1 - benchmark harness (offline).
 * Depends on: runner, dataset.
 */
import { describe, it, expect } from 'vitest';
import { buildEvalSet } from './dataset.ts';
import { runBenchmark, mockCaller, configurableCaller, serializeOutputs } from './runner.ts';

const MODEL = 'z-ai/glm-5.2';
const evalSet = buildEvalSet();

describe('runBenchmark - happy path (mock caller)', () => {
  const run = runBenchmark(evalSet, mockCaller(MODEL), { model: MODEL });

  it('scores every case', () => {
    expect(run.results.length).toBe(evalSet.length);
  });
  it('promotes the perfect mock to L0, L1, and L2', () => {
    expect(run.eligibility.disqualified).toBe(false);
    expect(run.eligibility.levels).toEqual({ L0: true, L1: true, L2: true });
  });
  it('projects a positive monthly cost and observes a positive run cost', () => {
    expect(run.costProjection.projectedMonthlyUsd).toBeGreaterThan(0);
    expect(run.costProjection.observedUsd).toBeGreaterThan(0);
  });
  it('emits the five Phase-1 artifacts', () => {
    const out = serializeOutputs(run);
    expect(Object.keys(out).sort()).toEqual(
      [
        'benchmark_report.md',
        'benchmark_results.json',
        'cost_projection.json',
        'model_eligibility_registry.json',
        'pricing_snapshot.json',
      ].sort(),
    );
    expect(out['benchmark_report.md']).toContain('Benchmark report');
    const registry = JSON.parse(out['model_eligibility_registry.json']!);
    expect(registry[MODEL].levels.L0).toBe(true);
  });
});

describe('runBenchmark - safety and gates', () => {
  it('disqualifies a model that fabricates numbers on every case', () => {
    const run = runBenchmark(
      evalSet,
      configurableCaller(MODEL, (_c, b) => ({ ...b, fabricatedNumber: true })),
      { model: MODEL },
    );
    expect(run.eligibility.disqualified).toBe(true);
    expect(run.eligibility.levels).toEqual({ L0: false, L1: false, L2: false });
  });

  it('denies L2 (but keeps L1) when reviewer disagreement is high', () => {
    const run = runBenchmark(evalSet, mockCaller(MODEL), {
      model: MODEL,
      reviewerDisagreementBps: 2000,
    });
    expect(run.eligibility.levels.L2).toBe(false);
    expect(run.eligibility.levels.L1).toBe(true);
  });

  it('flags a stale pricing snapshot far past the TTL', () => {
    const run = runBenchmark(evalSet, mockCaller(MODEL), { model: MODEL, nowIso: '2026-12-01' });
    expect(run.pricingStale).toBe(true);
  });
});
