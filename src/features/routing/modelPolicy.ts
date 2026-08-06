/**
 * NIZAM - PFOS offline model-selection + weekly-budget policy (server-free core of the router).
 * Owning contract: PFOS contract 10 (OpenRouter Phase 2 - Automatic Task/Turn Routing) + contract 11
 *   (Phase 3 - Adaptive Cost/Quality Governance): the deterministic "which model, is it affordable"
 *   decision. The live router that CALLS this (classifies the turn, executes, records spend) is
 *   module M4/M6 and is server/key-gated - NOT built here.
 * Build phase: PFOS Stage 7, phase 7.2 - offline model-selection policy.
 * Depends on: benchmark/pricing (frozen prices), benchmark/cost (costOfUsage), benchmark.types.
 *
 * OFFLINE ONLY. Pure functions; no network, no key, no live spend I/O (the caller passes the running
 * weekly spend in). OWNER K4 DECISION (2026-08-06): a hard USD 5.00/week cap; default to the cheapest
 * CAPABLE model within {mimo, glm}; Grok and Kimi are OFF unless the owner explicitly opts in for an
 * ultra-complex task. Money uses `*Usd` field names and reuses the money-core cost model (no toFixed).
 */
import { frozenSnapshot, priceFor } from '../benchmark/pricing';
import { costOfUsage } from '../benchmark/cost';
import { type TokenUsage } from '../benchmark/benchmark.types';

/** Routing tier (contract 10 taxonomy). T0 is deterministic/code-only (no model). */
export type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';

export const MODEL_MIMO = 'xiaomi/mimo-v2.5';
export const MODEL_GLM = 'z-ai/glm-5.2';
export const MODEL_GROK = 'x-ai/grok-4.5';
export const MODEL_KIMI = 'moonshotai/kimi-k3';

/** Models the roster deems CAPABLE at each tier (contract 10). GLM covers T1-T4 as workhorse/fallback. */
export const TIER_CAPABLE: Record<Tier, string[]> = {
  T0: [],
  T1: [MODEL_MIMO, MODEL_GLM],
  T2: [MODEL_GLM, MODEL_GROK, MODEL_KIMI],
  T3: [MODEL_GLM, MODEL_GROK, MODEL_KIMI],
  T4: [MODEL_KIMI, MODEL_GLM],
};

/** OWNER K4 default allowed set: the cheapest two only. */
export const DEFAULT_ALLOWED = [MODEL_MIMO, MODEL_GLM];
/** Premium models, available ONLY on an explicit ultra-complex opt-in. */
export const PREMIUM_MODELS = [MODEL_GROK, MODEL_KIMI];
/** When premium is opted-in, the tier's designated premium pick (contract 10 roles); null = no benefit. */
export const TIER_PREMIUM_PICK: Record<Tier, string | null> = {
  T0: null,
  T1: null,
  T2: null,
  T3: MODEL_GROK, // independent reviewer for high-impact decisions
  T4: MODEL_KIMI, // engineering primary
};

/** OWNER K4 hard weekly spend cap (USD). Blocks further LLM calls when exhausted; deterministic
 * engines (Stage 1-4) use no model and are never blocked by this cap. */
export const WEEKLY_BUDGET_USD = 5;
export const BUDGET_WARN_FRACTION = 0.7;
export const BUDGET_RESTRICT_FRACTION = 0.85;
export const BUDGET_DISABLE_PREMIUM_FRACTION = 0.95;

export type BudgetPhase = 'ok' | 'warn' | 'restrict' | 'critical' | 'exhausted';

/** Governance phase for the running weekly spend against the cap (contract 11 thresholds). */
export function budgetPhase(spentThisWeekUsd: number, capUsd = WEEKLY_BUDGET_USD): BudgetPhase {
  if (spentThisWeekUsd >= capUsd) return 'exhausted';
  const f = spentThisWeekUsd / capUsd;
  if (f >= BUDGET_DISABLE_PREMIUM_FRACTION) return 'critical';
  if (f >= BUDGET_RESTRICT_FRACTION) return 'restrict';
  if (f >= BUDGET_WARN_FRACTION) return 'warn';
  return 'ok';
}

/** Nominal per-turn token profile per tier (for cost RANKING and display only; live cost is metered). */
export const NOMINAL_TURN_USAGE: Record<Tier, TokenUsage> = {
  T0: { promptTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0 },
  T1: { promptTokens: 500, cachedTokens: 1500, cacheWriteTokens: 0, completionTokens: 120, reasoningTokens: 0, costUsd: 0 },
  T2: { promptTokens: 1500, cachedTokens: 4000, cacheWriteTokens: 0, completionTokens: 400, reasoningTokens: 0, costUsd: 0 },
  T3: { promptTokens: 3000, cachedTokens: 8000, cacheWriteTokens: 0, completionTokens: 900, reasoningTokens: 0, costUsd: 0 },
  T4: { promptTokens: 6000, cachedTokens: 20000, cacheWriteTokens: 0, completionTokens: 2000, reasoningTokens: 0, costUsd: 0 },
};

/** Estimated USD cost of one turn on a model at a tier (frozen pricing; nominal or supplied usage). */
export function estTurnCostUsd(model: string, tier: Tier, usage?: TokenUsage): number {
  const u = usage ?? NOMINAL_TURN_USAGE[tier];
  return costOfUsage(u, priceFor(frozenSnapshot(), model));
}

function cheapestOf(models: string[], tier: Tier, usage?: TokenUsage): { model: string; costUsd: number } | null {
  let best: { model: string; costUsd: number } | null = null;
  for (const m of models) {
    const cost = estTurnCostUsd(m, tier, usage);
    if (best === null || cost < best.costUsd) best = { model: m, costUsd: cost };
  }
  return best;
}

export interface SelectionInput {
  tier: Tier;
  /** True only when the owner explicitly requested a premium model for an ultra-complex task. */
  allowPremium?: boolean;
  /** Running weekly LLM spend (USD), supplied by the caller/telemetry. */
  spentThisWeekUsd: number;
  /** Optional real token profile for this turn (overrides the nominal per-tier profile). */
  estTurnUsage?: TokenUsage;
}

export interface SelectionResult {
  tier: Tier;
  /** Chosen model, or null when the tier needs no model (T0) or the budget blocks all LLM calls. */
  model: string | null;
  reason: string;
  estTurnCostUsd: number;
  budgetPhase: BudgetPhase;
  budgetRemainingUsd: number;
  blockedByBudget: boolean;
  premiumRequested: boolean;
  premiumUsed: boolean;
  notes: string[];
}

/** Pick the model for a turn under the owner's K4 policy and weekly budget. Deterministic. */
export function selectModel(input: SelectionInput): SelectionResult {
  const { tier, allowPremium = false, spentThisWeekUsd, estTurnUsage } = input;
  const phase = budgetPhase(spentThisWeekUsd);
  const budgetRemainingUsd = Math.max(0, WEEKLY_BUDGET_USD - spentThisWeekUsd);
  const notes: string[] = [];

  const result = (over: Partial<SelectionResult>): SelectionResult => ({
    tier,
    model: null,
    reason: '',
    estTurnCostUsd: 0,
    budgetPhase: phase,
    budgetRemainingUsd,
    blockedByBudget: false,
    premiumRequested: allowPremium,
    premiumUsed: false,
    notes,
    ...over,
  });

  if (tier === 'T0') {
    return result({ reason: 'T0 is deterministic/code-only; no model is called.' });
  }

  // Hard weekly cap: once exhausted, no further LLM call (deterministic engines are unaffected).
  if (phase === 'exhausted') {
    notes.push('Weekly USD 5.00 cap reached; LLM routing paused until the week resets. Deterministic engines continue.');
    return result({ blockedByBudget: true, reason: 'weekly budget exhausted' });
  }

  // Premium is disabled at >=95% of the cap even if requested (contract 11 restrictive routing).
  let effectiveAllowPremium = allowPremium;
  if (allowPremium && phase === 'critical') {
    effectiveAllowPremium = false;
    notes.push('Premium opt-in overridden: spend is >=95% of the weekly cap, so premium is held back.');
  }

  if (tier === 'T3' && !effectiveAllowPremium) {
    notes.push('T3 default runs single-model GLM with human approval; the independent reviewer (Grok) is off unless you opt into premium for this ultra-complex decision.');
  }

  // Choose the candidate model.
  let chosen: { model: string; costUsd: number } | null = null;
  let premiumUsed = false;
  const defaultCandidates = TIER_CAPABLE[tier].filter((m) => DEFAULT_ALLOWED.includes(m));

  if (effectiveAllowPremium) {
    const pick = TIER_PREMIUM_PICK[tier];
    if (pick) {
      const cost = estTurnCostUsd(pick, tier, estTurnUsage);
      chosen = { model: pick, costUsd: cost };
      premiumUsed = true;
    } else {
      notes.push('Premium requested but this tier has no premium benefit; using the default cheapest model.');
      chosen = cheapestOf(defaultCandidates, tier, estTurnUsage);
    }
  } else {
    chosen = cheapestOf(defaultCandidates, tier, estTurnUsage);
  }

  if (chosen === null) {
    // Only reachable if a tier had no default-allowed capable model (not the case for T1-T4 today).
    return result({ blockedByBudget: false, reason: `no allowed model is capable at ${tier}` });
  }

  // Affordability: even the chosen turn must fit within what is left this week.
  if (chosen.costUsd > budgetRemainingUsd) {
    // If a premium pick is unaffordable, fall back to the cheapest default before blocking.
    if (premiumUsed) {
      const fallback = cheapestOf(defaultCandidates, tier, estTurnUsage);
      if (fallback && fallback.costUsd <= budgetRemainingUsd) {
        notes.push('Premium pick would exceed the remaining weekly budget; fell back to the default cheapest model.');
        return result({
          model: fallback.model,
          reason: `premium unaffordable; ${fallback.model} fits the remaining budget`,
          estTurnCostUsd: fallback.costUsd,
          premiumUsed: false,
        });
      }
    }
    notes.push('Even the cheapest capable model would exceed the remaining weekly budget; LLM routing paused.');
    return result({
      blockedByBudget: true,
      reason: 'remaining weekly budget too low for the cheapest capable model',
      estTurnCostUsd: chosen.costUsd,
      premiumUsed,
    });
  }

  return result({
    model: chosen.model,
    reason: premiumUsed
      ? `premium opt-in: ${chosen.model} for an ultra-complex ${tier} task`
      : `cheapest capable model within {mimo, glm} for ${tier}`,
    estTurnCostUsd: chosen.costUsd,
    premiumUsed,
  });
}
