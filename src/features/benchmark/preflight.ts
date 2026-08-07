/**
 * NIZAM - PFOS benchmark harness (M2): the PRE-FLIGHT cost estimate for a live Phase-1 run.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration): its cost formula
 *   and its FROZEN pricing snapshot, reused verbatim. The dev-key ceiling this measures against is
 *   `docs/PFOS_SECRETS_PLAN.md` §4 ("its own tiny hard cap"), quoted by steering §3.
 * Build phase: PFOS Stage 6 (two-agent VPS tier), phase 6.3 - deciding whether a live run may happen.
 * Depends on: ./pricing (the frozen table), ./cost (`costOfUsage`), ./benchmark.types,
 *   ../routing/modelPolicy (the K4 default-allowed set). Nothing else, by design - see below.
 *
 * NO NETWORK. NO KEY. NO CLOCK. NO FILESYSTEM. This module exists so the question "may a live run
 * happen?" can be answered WITHOUT spending anything, which is the only order in which that question
 * can honestly be asked: an estimate produced after the fact is an invoice.
 *
 * ## Why the estimate is deliberately pessimistic
 *
 * An estimate that gates a spend must never understate, so every modelled quantity is rounded the
 * expensive way and four separate pessimisms are stacked:
 *
 *  1. **Every prompt token is priced as FRESH.** A live run walks distinct cases, so there is no
 *     cache to read; `cacheReadUsdPerMillion` is between one and two orders of magnitude cheaper than
 *     the prompt rate in the frozen table, so assuming no cache hit is the conservative direction.
 *  2. **The whole output allowance is assumed to be used.** {@link MAX_OUTPUT_TOKENS_PER_CASE} is
 *     charged for every case, not the ~40 tokens a short structured answer actually needs.
 *  3. **A fixed per-request overhead is added** ({@link REQUEST_OVERHEAD_TOKENS}) for the system
 *     prompt and the response-schema instructions, which a live request carries and a case's `input`
 *     does not.
 *  4. **The total is multiplied by {@link ESTIMATE_SAFETY_MULTIPLIER}** and rounded UP to whole
 *     micro-USD, so a retry, a reasoning-token surprise, or a per-model tokenizer that is denser than
 *     four characters per token is already inside the number.
 *
 * The result is that {@link estimateLiveRunCost} is an upper bound the run should come in well under,
 * and {@link assertLiveRunAffordable} may therefore be trusted as a gate rather than as a hint.
 *
 * ## Two gates, and why both are refusals rather than warnings
 *
 * {@link assertLiveRunAffordable} refuses when the estimate is not STRICTLY below the cap. Equality
 * refuses too: a run that exactly consumes a periodic cap leaves nothing for the rest of the period,
 * and the cap is stated approximately ("about" one currency unit per period) so treating it as an
 * exact ceiling to be filled would be reading precision into a figure that has none.
 *
 * {@link assertScopedToDefaultAllowed} refuses any model outside the K4 default-allowed set. Steering
 * `pfos-current.md` K4 puts the two premium models OFF "unless the owner explicitly opts in for an
 * ultra-complex task", and a benchmark run is not an ultra-complex task - it is a measurement. There
 * is no parameter on either function that could admit a premium model, because an opt-in that an
 * agent can express is not an opt-in by the owner.
 *
 * ## Money
 *
 * Provider cost only, in the two units contract 09 and contract 06 already use: contract 09's USD
 * figures on `*Usd` fields, and integer micro-USD on `*MicroUsd` fields. `usdToMicroUsd` is the one
 * conversion and it rounds UP. No `parseFloat`, no `.toFixed(`, and no owner money - the owner's
 * ledger is integer milliunits behind `src/lib/money` and does not appear here (contract 06 §6.1).
 */
import { DEFAULT_ALLOWED } from '../routing/modelPolicy';
import type { BenchmarkCase, TokenUsage } from './benchmark.types';
import { costOfUsage } from './cost';
import { frozenSnapshot, priceFor, type ModelPrice, type PricingSnapshot } from './pricing';

/**
 * The dev key's stated periodic ceiling, in whole USD, from `docs/PFOS_SECRETS_PLAN.md` §4 and §7
 * ("about USD 1/week") as quoted by steering §3. Stated as a whole number in the same shape
 * `modelPolicy.WEEKLY_BUDGET_USD` states the owner's account cap, so there is one convention for a
 * provider spend ceiling in this repository rather than two.
 */
export const DEV_KEY_WEEKLY_CAP_USD = 1;

/** Micro-USD per USD. The only scale factor between contract 09's unit and contract 06's. */
export const MICRO_USD_PER_USD = 1_000_000;

/** The same ceiling in the integer unit the estimate is compared in. */
export const DEV_KEY_WEEKLY_CAP_MICRO_USD = DEV_KEY_WEEKLY_CAP_USD * MICRO_USD_PER_USD;

/**
 * Characters per prompt token. Matches the harness's own nominal accounting (`runner.nominalUsage`)
 * so the estimate and the run speak the same approximation. Denser tokenizers are absorbed by
 * {@link ESTIMATE_SAFETY_MULTIPLIER}.
 */
export const CHARS_PER_PROMPT_TOKEN = 4;

/**
 * Fixed prompt tokens a live request carries that a case's `input` does not: the system prompt, the
 * hard-rule preamble, and the response-schema instructions. A generous flat allowance rather than a
 * measured one, because the request template is phase 6.3's to write and this is its upper bound.
 */
export const REQUEST_OVERHEAD_TOKENS = 400;

/** The output allowance charged for every case, in full. A short structured answer uses far less. */
export const MAX_OUTPUT_TOKENS_PER_CASE = 512;

/** Stacked on top of the four pessimisms above. Integer, so the estimate stays exact arithmetic. */
export const ESTIMATE_SAFETY_MULTIPLIER = 2;

/** Convert a contract 09 USD figure to integer micro-USD, rounding UP so an estimate never shrinks. */
export function usdToMicroUsd(usd: number): number {
  return Math.ceil(usd * MICRO_USD_PER_USD);
}

/** Why a pre-flight gate refused. A caller discriminates on `code`, never on a message. */
export const PREFLIGHT_ERROR_CODES = [
  'PREFLIGHT_NO_MODELS',
  'PREFLIGHT_NO_CASES',
  'PREFLIGHT_MODEL_NOT_DEFAULT_ALLOWED',
  'PREFLIGHT_ESTIMATE_NOT_BELOW_CAP',
] as const;
export type PreflightErrorCode = (typeof PREFLIGHT_ERROR_CODES)[number];

/**
 * A refused pre-flight. `detail` carries counts, model ids and micro-USD figures - provider
 * accounting only, never owner money, never a case, never a credential.
 */
export class PreflightError extends Error {
  readonly code: PreflightErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: PreflightErrorCode, message: string, detail: Record<string, string> = {}) {
    super(message);
    this.name = 'PreflightError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * The pessimistic token usage of ONE case on a live run. `cachedTokens` and `cacheWriteTokens` are
 * zero on purpose: distinct cases share no prefix worth caching, and the cache rates are the cheap
 * ones, so pricing everything at the fresh-prompt rate is the direction that cannot understate.
 */
export function estimateCaseUsage(benchmarkCase: BenchmarkCase, price: ModelPrice): TokenUsage {
  const promptTokens =
    REQUEST_OVERHEAD_TOKENS + Math.ceil(benchmarkCase.input.length / CHARS_PER_PROMPT_TOKEN);
  const usage: TokenUsage = {
    promptTokens,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: MAX_OUTPUT_TOKENS_PER_CASE,
    reasoningTokens: 0,
    costUsd: 0,
  };
  usage.costUsd = costOfUsage(usage, price);
  return usage;
}

/** One model's share of the estimate. Token counts are integers; the USD figure is contract 09's. */
export interface ModelRunEstimate {
  readonly modelId: string;
  readonly cases: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Contract 09's own cost figure for this model's share, before the safety multiplier. */
  readonly rawUsd: number;
  /** The share as it counts against the cap: safety-multiplied and rounded up to micro-USD. */
  readonly estimatedMicroUsd: number;
}

/** The whole pre-flight answer: what the run would cost, and how that sits against the ceiling. */
export interface LiveRunCostEstimate {
  readonly perModel: readonly ModelRunEstimate[];
  readonly cases: number;
  readonly safetyMultiplier: number;
  /** Integer micro-USD, the sum of the per-model shares. */
  readonly totalMicroUsd: number;
  readonly capMicroUsd: number;
  /** True only when the total is STRICTLY below the cap. Equality is not within. */
  readonly withinCap: boolean;
  /** Cap minus total, floored at zero. Integer micro-USD. */
  readonly headroomMicroUsd: number;
  /** The snapshot the figures came from, so a report can state which table priced the run. */
  readonly pricingCapturedIso: string;
  readonly pricingSource: PricingSnapshot['source'];
}

/**
 * Refuse any model outside the K4 default-allowed set.
 *
 * There is no `allowPremium` parameter. `modelPolicy.selectModel` has one because the OWNER may opt
 * in per turn; nothing on this path may, because the owner has not opted in for this run and a
 * benchmark is not the ultra-complex task the opt-in exists for.
 */
export function assertScopedToDefaultAllowed(modelIds: readonly string[]): void {
  if (modelIds.length === 0) {
    throw new PreflightError(
      'PREFLIGHT_NO_MODELS',
      'NIZAM pre-flight: no model was named, and an empty run is refused rather than estimated at zero',
      { at: 'modelIds' },
    );
  }
  for (const modelId of modelIds) {
    if (!DEFAULT_ALLOWED.includes(modelId)) {
      throw new PreflightError(
        'PREFLIGHT_MODEL_NOT_DEFAULT_ALLOWED',
        'NIZAM pre-flight: the model is outside the K4 default-allowed set, and the owner has not opted in for an ultra-complex task, so it is out of scope for this run',
        { modelId },
      );
    }
  }
}

/**
 * Estimate what a live Phase-1 run over `cases` would cost for each of `modelIds`.
 *
 * Pure: the frozen snapshot is the default and any snapshot may be injected, exactly as
 * `pricing.loadPricing` allows. Nothing here fetches a price, and contract 09's source precedence
 * (live model metadata first) is a step for whoever performs the run, not for this estimate.
 */
export function estimateLiveRunCost(input: {
  cases: readonly BenchmarkCase[];
  modelIds: readonly string[];
  pricing?: PricingSnapshot;
}): LiveRunCostEstimate {
  const { cases, modelIds } = input;
  assertScopedToDefaultAllowed(modelIds);
  if (cases.length === 0) {
    throw new PreflightError(
      'PREFLIGHT_NO_CASES',
      'NIZAM pre-flight: the eval set is empty, so an estimate of zero would be a statement about nothing',
      { at: 'cases' },
    );
  }

  const snapshot = input.pricing ?? frozenSnapshot();
  const perModel: ModelRunEstimate[] = modelIds.map((modelId) => {
    const price = priceFor(snapshot, modelId);
    let promptTokens = 0;
    let completionTokens = 0;
    let rawUsd = 0;
    for (const benchmarkCase of cases) {
      const usage = estimateCaseUsage(benchmarkCase, price);
      promptTokens += usage.promptTokens;
      completionTokens += usage.completionTokens;
      rawUsd += usage.costUsd;
    }
    return Object.freeze({
      modelId,
      cases: cases.length,
      promptTokens,
      completionTokens,
      rawUsd,
      estimatedMicroUsd: usdToMicroUsd(rawUsd) * ESTIMATE_SAFETY_MULTIPLIER,
    });
  });

  let totalMicroUsd = 0;
  for (const model of perModel) totalMicroUsd += model.estimatedMicroUsd;
  const capMicroUsd = DEV_KEY_WEEKLY_CAP_MICRO_USD;

  return Object.freeze({
    perModel: Object.freeze(perModel),
    cases: cases.length,
    safetyMultiplier: ESTIMATE_SAFETY_MULTIPLIER,
    totalMicroUsd,
    capMicroUsd,
    withinCap: totalMicroUsd < capMicroUsd,
    headroomMicroUsd: Math.max(0, capMicroUsd - totalMicroUsd),
    pricingCapturedIso: snapshot.capturedIso,
    pricingSource: snapshot.source,
  });
}

/**
 * Refuse a run whose estimate is not STRICTLY below the cap.
 *
 * Equality refuses as well as excess. The cap is stated approximately, so filling it exactly would
 * read a precision into the figure that the figure does not have, and would leave the rest of the
 * period with nothing.
 */
export function assertLiveRunAffordable(estimate: LiveRunCostEstimate): void {
  if (!estimate.withinCap) {
    throw new PreflightError(
      'PREFLIGHT_ESTIMATE_NOT_BELOW_CAP',
      'NIZAM pre-flight: the estimated cost of the run is not strictly below the dev key ceiling, so the run is refused and the fixture-backed path stands (steering §3)',
      {
        estimatedMicroUsd: String(estimate.totalMicroUsd),
        capMicroUsd: String(estimate.capMicroUsd),
      },
    );
  }
}
