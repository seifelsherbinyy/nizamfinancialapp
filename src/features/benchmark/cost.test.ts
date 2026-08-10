// @vitest-environment node
/**
 * NIZAM - PFOS benchmark harness (M2): cost model + pricing snapshot tests.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration).
 * Build phase: PFOS Stage 7, phase 7.1 - benchmark harness (offline).
 * Depends on: cost, pricing, benchmark.types.
 */
import { describe, it, expect } from 'vitest';
import {
  costOfUsage,
  fullWindowCost,
  projectMonthlyCost,
  WEEKLY_HOURS_FULL,
} from './cost.ts';
import {
  FROZEN_PRICING,
  frozenSnapshot,
  isStale,
  loadPricing,
  priceFor,
} from './pricing.ts';
import { type TokenUsage } from './benchmark.types.ts';

const GLM = FROZEN_PRICING['z-ai/glm-5.2']!;
const MIMO = FROZEN_PRICING['xiaomi/mimo-v2.5']!;
const GROK = FROZEN_PRICING['x-ai/grok-4.5']!;
const KIMI = FROZEN_PRICING['moonshotai/kimi-k3']!;

describe('projectMonthlyCost - verified reproductions at 7 h/week', () => {
  it('reproduces GLM = USD 29.83', () => {
    expect(projectMonthlyCost(GLM, 7)).toBeCloseTo(29.83, 2);
  });
  it('reproduces MiMo = USD 4.71', () => {
    expect(projectMonthlyCost(MIMO, 7)).toBeCloseTo(4.71, 2);
  });
  it('reproduces Grok = USD 185.73', () => {
    expect(projectMonthlyCost(GROK, 7)).toBeCloseTo(185.73, 2);
  });
  it('reproduces Kimi = USD 233.94', () => {
    expect(projectMonthlyCost(KIMI, 7)).toBeCloseTo(233.94, 2);
  });
  it('scales linearly with weekly hours', () => {
    expect(projectMonthlyCost(GLM, 14)).toBeCloseTo(projectMonthlyCost(GLM, 7) * 2, 6);
    expect(projectMonthlyCost(GLM, WEEKLY_HOURS_FULL)).toBeCloseTo(fullWindowCost(GLM), 6);
  });
});

describe('costOfUsage', () => {
  const u = (over: Partial<TokenUsage>): TokenUsage => ({
    promptTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    ...over,
  });

  it('costs prompt tokens at the prompt price', () => {
    expect(costOfUsage(u({ promptTokens: 1_000_000 }), GLM)).toBeCloseTo(0.28, 6);
  });
  it('costs completion and reasoning tokens at the completion price', () => {
    expect(costOfUsage(u({ completionTokens: 1_000_000 }), GLM)).toBeCloseTo(0.88, 6);
    expect(costOfUsage(u({ reasoningTokens: 1_000_000 }), GLM)).toBeCloseTo(0.88, 6);
  });
  it('costs cache-read tokens at the cache-read price', () => {
    expect(costOfUsage(u({ cachedTokens: 1_000_000 }), GLM)).toBeCloseTo(0.052, 6);
  });
  it('falls back to the prompt price for cache-write when none is quoted', () => {
    expect(costOfUsage(u({ cacheWriteTokens: 1_000_000 }), GLM)).toBeCloseTo(0.28, 6);
  });
  it('is zero on empty usage', () => {
    expect(costOfUsage(u({}), GLM)).toBe(0);
  });
});

describe('pricing snapshot', () => {
  it('loads the frozen snapshot as not stale at capture time', () => {
    const { snapshot, stale } = loadPricing();
    expect(snapshot.source).toBe('frozen');
    expect(stale).toBe(false);
  });
  it('marks the snapshot stale past the TTL', () => {
    expect(isStale(frozenSnapshot(), '2026-08-20')).toBe(true);
    expect(isStale(frozenSnapshot(), '2026-08-10')).toBe(false);
  });
  it('throws for an unknown model rather than guessing', () => {
    expect(() => priceFor(frozenSnapshot(), 'unknown/model')).toThrow();
  });
});
