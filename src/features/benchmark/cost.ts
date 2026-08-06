/**
 * NIZAM - PFOS benchmark harness (M2): the token-cost model and monthly projection.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration): the cost formula,
 *   the 30-day reference usage mix (cache-read dominant), and the per-model monthly projection.
 * Build phase: PFOS Stage 7, phase 7.1 - benchmark harness (offline, no network, no key).
 * Depends on: pricing (ModelPrice), benchmark.types (TokenUsage).
 *
 * OFFLINE ONLY. Prices use `*UsdPerMillion` fields; totals use `costUsd`; no money-named fields, no
 * parseFloat/toFixed (per the money-core invariant). When a model omits a cache-write price we fall
 * back to the (higher) prompt price so the projection is conservative, never under-stated.
 */
import { type ModelPrice } from './pricing';
import { type TokenUsage } from './benchmark.types';

/**
 * The 30-day reference token totals were captured from a representative full-time usage window
 * (~56 h/week). Monthly projections scale linearly by hoursPerWeek / WEEKLY_HOURS_FULL.
 */
export const WEEKLY_HOURS_FULL = 56;

/** Aggregate token mix over a 30-day window (four buckets: fresh, cache-write, cache-read, output). */
export interface ReferenceUsage {
  freshPromptTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

/** Contract 09 reference usage: cache-read is ~93% of the spend driver. */
export const REFERENCE_USAGE_30D: ReferenceUsage = {
  freshPromptTokens: 15_672_203,
  cacheWriteTokens: 202_682_335,
  cacheReadTokens: 2_950_573_825,
  outputTokens: 27_331_793,
};

/** Cost (USD) of a 30-day reference window at a model's price. */
export function costFormula(usage: ReferenceUsage, price: ModelPrice): number {
  const cacheWritePrice = price.cacheWriteUsdPerMillion ?? price.promptUsdPerMillion;
  return (
    (usage.freshPromptTokens * price.promptUsdPerMillion +
      usage.cacheWriteTokens * cacheWritePrice +
      usage.cacheReadTokens * price.cacheReadUsdPerMillion +
      usage.outputTokens * price.completionUsdPerMillion) /
    1_000_000
  );
}

/** Cost (USD) of a single response's token usage at a model's price. */
export function costOfUsage(usage: TokenUsage, price: ModelPrice): number {
  const cacheWritePrice = price.cacheWriteUsdPerMillion ?? price.promptUsdPerMillion;
  return (
    (usage.promptTokens * price.promptUsdPerMillion +
      usage.cacheWriteTokens * cacheWritePrice +
      usage.cachedTokens * price.cacheReadUsdPerMillion +
      (usage.completionTokens + usage.reasoningTokens) * price.completionUsdPerMillion) /
    1_000_000
  );
}

/** Cost (USD) of the full 30-day reference window at a model's price. */
export function fullWindowCost(price: ModelPrice): number {
  return costFormula(REFERENCE_USAGE_30D, price);
}

/** Projected monthly cost (USD) at a chosen weekly usage intensity. */
export function projectMonthlyCost(price: ModelPrice, hoursPerWeek: number): number {
  return fullWindowCost(price) * (hoursPerWeek / WEEKLY_HOURS_FULL);
}
