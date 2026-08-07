/**
 * NIZAM - PFOS benchmark harness (M2): the pre-flight cost estimate, and the two gates it feeds.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration) + steering §3
 *   (the dev-key carve-out) and steering `pfos-current.md` K4 (the default-allowed model set).
 * Build phase: PFOS Stage 6 (two-agent VPS tier), phase 6.3 - deciding whether a live run may happen.
 * Depends on: ./preflight, ./dataset, ./pricing, ../routing/modelPolicy.
 *
 * These are the figures phase 6.3's branch decision rests on, so the estimate is asserted against the
 * ceiling as a NUMBER rather than as a boolean: a test that only checked `withinCap` would still pass
 * if the estimate silently became 100x cheaper because a pessimism was dropped.
 *
 * NO NETWORK. NO KEY. Everything here is pure arithmetic over the frozen pricing table.
 */
import { describe, it, expect } from 'vitest';
import { buildEvalSet } from './dataset';
import { frozenSnapshot, priceFor } from './pricing';
import { DEFAULT_ALLOWED, MODEL_GLM, MODEL_GROK, MODEL_KIMI, MODEL_MIMO } from '../routing/modelPolicy';
import {
  assertLiveRunAffordable,
  assertScopedToDefaultAllowed,
  DEV_KEY_WEEKLY_CAP_MICRO_USD,
  DEV_KEY_WEEKLY_CAP_USD,
  ESTIMATE_SAFETY_MULTIPLIER,
  estimateCaseUsage,
  estimateLiveRunCost,
  MAX_OUTPUT_TOKENS_PER_CASE,
  MICRO_USD_PER_USD,
  PreflightError,
  REQUEST_OVERHEAD_TOKENS,
  usdToMicroUsd,
} from './preflight';

const CASES = buildEvalSet();

describe('the dev-key ceiling is pinned to what the secrets plan states', () => {
  it('states the cap in whole USD and in integer micro-USD, and they agree', () => {
    // docs/PFOS_SECRETS_PLAN.md §4 and §7, quoted by steering §3.
    expect(DEV_KEY_WEEKLY_CAP_USD).toBe(1);
    expect(MICRO_USD_PER_USD).toBe(1_000_000);
    expect(DEV_KEY_WEEKLY_CAP_MICRO_USD).toBe(1_000_000);
    expect(Number.isSafeInteger(DEV_KEY_WEEKLY_CAP_MICRO_USD)).toBe(true);
  });
});

describe('usdToMicroUsd rounds up, so an estimate never shrinks in conversion', () => {
  it('rounds a fractional micro-USD up to the next whole unit', () => {
    // Not a money-bearing field: a provider USD figure at the contract 09 boundary.
    expect(usdToMicroUsd(0.0000004)).toBe(1);
    expect(usdToMicroUsd(1)).toBe(1_000_000);
    expect(usdToMicroUsd(0)).toBe(0);
  });
});

describe('the per-case estimate is pessimistic in every direction that matters', () => {
  const price = priceFor(frozenSnapshot(), MODEL_MIMO);

  it('charges the full output allowance and the request overhead for every case', () => {
    const [first] = CASES;
    if (first === undefined) throw new Error('the eval set is empty');
    const usage = estimateCaseUsage(first, price);
    expect(usage.completionTokens).toBe(MAX_OUTPUT_TOKENS_PER_CASE);
    expect(usage.promptTokens).toBeGreaterThan(REQUEST_OVERHEAD_TOKENS);
  });

  it('prices every prompt token as FRESH, never as a cache read', () => {
    const [first] = CASES;
    if (first === undefined) throw new Error('the eval set is empty');
    const usage = estimateCaseUsage(first, price);
    // A cached token is priced at cacheRead, which is the cheap rate. Assuming none is conservative.
    expect(usage.cachedTokens).toBe(0);
    expect(usage.cacheWriteTokens).toBe(0);
    expect(usage.reasoningTokens).toBe(0);
    expect(usage.costUsd).toBeGreaterThan(0);
  });
});

describe('the estimate for the intended run, against the stated ceiling', () => {
  const estimate = estimateLiveRunCost({ cases: CASES, modelIds: DEFAULT_ALLOWED });

  it('scopes to exactly the two K4 default-allowed models', () => {
    expect(estimate.perModel.map((model) => model.modelId)).toEqual([MODEL_MIMO, MODEL_GLM]);
    expect(estimate.cases).toBe(CASES.length);
  });

  it('reports the frozen snapshot as the source that priced the run', () => {
    expect(estimate.pricingSource).toBe('frozen');
    expect(estimate.pricingCapturedIso).toBe(frozenSnapshot().capturedIso);
  });

  it('is an integer number of micro-USD and carries the safety multiplier', () => {
    expect(estimate.safetyMultiplier).toBe(ESTIMATE_SAFETY_MULTIPLIER);
    expect(Number.isSafeInteger(estimate.totalMicroUsd)).toBe(true);
    for (const model of estimate.perModel) {
      expect(Number.isSafeInteger(model.estimatedMicroUsd)).toBe(true);
      expect(model.estimatedMicroUsd).toBeGreaterThan(0);
    }
    const summed = estimate.perModel.reduce((total, model) => total + model.estimatedMicroUsd, 0);
    expect(estimate.totalMicroUsd).toBe(summed);
  });

  it('prices the pricier of the two models higher, which is the whole point of "cheapest capable"', () => {
    const [mimo, glm] = estimate.perModel;
    if (mimo === undefined || glm === undefined) throw new Error('expected two per-model estimates');
    expect(glm.estimatedMicroUsd).toBeGreaterThan(mimo.estimatedMicroUsd);
  });

  it('lands strictly below the ceiling, with the headroom stated as a number', () => {
    expect(estimate.withinCap).toBe(true);
    expect(estimate.totalMicroUsd).toBeLessThan(estimate.capMicroUsd);
    expect(estimate.headroomMicroUsd).toBe(estimate.capMicroUsd - estimate.totalMicroUsd);
    // A TWO-SIDED drift guard, because both directions are failures worth catching. Observed at the
    // time of writing: 320_812 micro-USD, about 32% of the ceiling - so one live run over both models
    // consumes roughly a third of the dev key's whole periodic allowance, which is the figure the
    // branch decision was actually made on and is worth being unable to lose.
    //   Too HIGH  -> a pessimism grew, the eval set grew, or the pricing table moved; re-decide.
    //   Too LOW   -> a pessimism was dropped, and an estimate that gates a spend has gone soft.
    expect(estimate.totalMicroUsd).toBeLessThan(estimate.capMicroUsd / 2);
    expect(estimate.totalMicroUsd).toBeGreaterThan(estimate.capMicroUsd / 10);
    expect(() => assertLiveRunAffordable(estimate)).not.toThrow();
  });
});

describe('the affordability gate refuses, and equality is not "within"', () => {
  it('refuses an estimate exactly equal to the ceiling', () => {
    const atCap = {
      ...estimateLiveRunCost({ cases: CASES, modelIds: [MODEL_MIMO] }),
      totalMicroUsd: DEV_KEY_WEEKLY_CAP_MICRO_USD,
      withinCap: false,
    };
    try {
      assertLiveRunAffordable(atCap);
      throw new Error('expected the affordability gate to refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(PreflightError);
      expect((error as PreflightError).code).toBe('PREFLIGHT_ESTIMATE_NOT_BELOW_CAP');
      // The refusal carries provider figures and nothing else.
      expect(Object.keys((error as PreflightError).detail).sort()).toEqual([
        'capMicroUsd',
        'estimatedMicroUsd',
      ]);
    }
  });

  it('refuses an estimate over the ceiling', () => {
    const overCap = {
      ...estimateLiveRunCost({ cases: CASES, modelIds: [MODEL_MIMO] }),
      totalMicroUsd: DEV_KEY_WEEKLY_CAP_MICRO_USD + 1,
      withinCap: false,
    };
    expect(() => assertLiveRunAffordable(overCap)).toThrow(PreflightError);
  });
});

describe('K4: the premium models are out of scope and no parameter can admit them', () => {
  it.each([MODEL_GROK, MODEL_KIMI])('refuses %s, because the owner has not opted in', (premium) => {
    try {
      assertScopedToDefaultAllowed([premium]);
      throw new Error('expected the K4 scope gate to refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(PreflightError);
      expect((error as PreflightError).code).toBe('PREFLIGHT_MODEL_NOT_DEFAULT_ALLOWED');
      expect((error as PreflightError).detail.modelId).toBe(premium);
    }
  });

  it('refuses a run that mixes an allowed model with a premium one', () => {
    expect(() => estimateLiveRunCost({ cases: CASES, modelIds: [MODEL_MIMO, MODEL_GROK] })).toThrow(
      PreflightError,
    );
  });

  it('admits the two default-allowed models', () => {
    expect(() => assertScopedToDefaultAllowed(DEFAULT_ALLOWED)).not.toThrow();
  });
});

describe('an empty run is refused rather than estimated at zero', () => {
  it('refuses no models', () => {
    try {
      estimateLiveRunCost({ cases: CASES, modelIds: [] });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as PreflightError).code).toBe('PREFLIGHT_NO_MODELS');
    }
  });

  it('refuses no cases', () => {
    try {
      estimateLiveRunCost({ cases: [], modelIds: [MODEL_MIMO] });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as PreflightError).code).toBe('PREFLIGHT_NO_CASES');
    }
  });
});
