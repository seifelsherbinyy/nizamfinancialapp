// @vitest-environment node
/**
 * NIZAM · Every router gate, shown refusing — and the one that is unreachable, shown to be so
 * Implemented by: PFOS Contract 12 / Phase 5.2 (spec 06-two-agent-vps)
 * Owning requirements: R18 (registry presence and the provisional rule), R17 support (an explicit,
 *   legible cap refusal rather than a silent downgrade)
 * Depends on: ./modelRouter, ./eligibilityRegistry, ./turnClassifier,
 *   ../../features/routing/modelPolicy, ../../features/routing/spendLedger
 *
 * The design's testing strategy: "a test that has only ever been observed passing is not evidence.
 * Each negative test must be shown failing the guarded operation, not merely returning a value."
 * So every case asserts the typed refusal, and the positive cases at the end exist so a reader can
 * see that the gates are not simply refusing everything.
 *
 * Two cases are shaped differently on purpose, and both are honest about why:
 *
 *  - `MODEL_ROUTING_PREMIUM_NOT_OPTED_IN` is a BELT behind `modelPolicy`. Asked without an opt-in,
 *    `selectModel` never answers with a premium model, so the belt cannot be reached through
 *    `routeModel` while K4 holds. It is therefore exercised directly — the same treatment Phase 3.2
 *    gives its de-identification audit, and for the same stated reason.
 *  - `MODEL_ROUTING_NO_MODEL_SELECTED` is unreachable by construction: at every model-bearing tier
 *    the roster's capable set intersects K4's allowed set non-trivially. Rather than contriving a
 *    path to it, the test asserts the precondition that makes it unreachable, so the day contract
 *    10's roster changes the assertion fails and the branch becomes reachable knowingly.
 *
 * The budget figures below are PROVIDER accounting in integer micro-USD, synthetic, and chosen only
 * to sit either side of a nominal turn cost. No owner money appears, no arithmetic is performed on
 * any of them here, and no deployment particular appears anywhere (§6, R24).
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALLOWED,
  MODEL_GLM,
  MODEL_GROK,
  MODEL_KIMI,
  MODEL_MIMO,
  PREMIUM_MODELS,
  TIER_CAPABLE,
} from '../../features/routing/modelPolicy';
import { agentWeeklyBudget, weekKeyOf, type AgentWeeklyBudget } from '../../features/routing/spendLedger';
import {
  admitEligibilityRegistry,
  ELIGIBILITY_REGISTRY_VERSION,
  type AdmittedRegistry,
  type EligibilityRegistryEntry,
  type EligibleModel,
  type LiveEligibilityRegistry,
} from './eligibilityRegistry';
import {
  eligibleCandidatesAt,
  isRoutedModel,
  ModelRoutingError,
  premiumRefusal,
  routedModelId,
  routeModel,
  type PremiumOptIn,
  type RoutedModel,
} from './modelRouter';
import {
  classifyTurn,
  isModelBearing,
  type ModelBearingTier,
  type ModelInvocationGrant,
  type TurnFacts,
} from './turnClassifier';

const WEEK_KEY = weekKeyOf('2026-08-06');
/** Synthetic cap, comfortably above one nominal turn at any tier. */
const AMPLE_CAP_MICRO_USD = 500_000;

const CALM: TurnFacts = Object.freeze({
  intent: 'parse_bank_message',
  reversibility: 'reversible',
  dataFreshness: 'fresh',
  missingInformation: false,
  toolRequirement: false,
  securitySensitive: false,
  amountOverOwnerThreshold: false,
  exceedsSafeToSpendAllowance: false,
  materialShareOfLiquidNetWorth: false,
  criticalObligationImpact: false,
  newDebt: false,
  assetSale: false,
  majorIncomeChange: false,
  longHorizonDecision: false,
  forecastShortfallLikely: false,
  evidenceConflicts: false,
  lowConfidence: false,
});

/** Facts that classify to each model-bearing tier, using Phase 5.1 own rules. */
const FACTS_FOR: Readonly<Record<ModelBearingTier, TurnFacts>> = {
  T1: CALM,
  T2: { ...CALM, intent: 'explain_safe_to_spend' },
  T3: { ...CALM, intent: 'evaluate_financial_decision', newDebt: true },
  T4: { ...CALM, intent: 'repository_engineering' },
};

function grantFor(tier: ModelBearingTier, turnRef: string): ModelInvocationGrant {
  const classification = classifyTurn(FACTS_FOR[tier], turnRef);
  if (!isModelBearing(classification)) throw new Error(`expected ${tier} to be model-bearing`);
  expect(classification.tier).toBe(tier);
  return classification.modelGrant;
}

function graded(modelId: string, over: Partial<EligibilityRegistryEntry> = {}): EligibilityRegistryEntry {
  return { modelId, bands: { L0: true, L1: true, L2: true }, developerBuild: true, disqualified: false, ...over };
}

function registryOf(entries: readonly EligibilityRegistryEntry[]): AdmittedRegistry {
  const document: LiveEligibilityRegistry = {
    registryVersion: ELIGIBILITY_REGISTRY_VERSION,
    provisional: false,
    entries,
  };
  return admitEligibilityRegistry(document);
}

const FULLY_GRADED = (): AdmittedRegistry =>
  registryOf([graded(MODEL_MIMO), graded(MODEL_GLM), graded(MODEL_GROK), graded(MODEL_KIMI)]);

function budget(capMicroUsd = AMPLE_CAP_MICRO_USD): AgentWeeklyBudget {
  return agentWeeklyBudget([], { agent: 'finance', weekKey: WEEK_KEY, capMicroUsd });
}

function codeOf(attempt: () => unknown): string {
  try {
    attempt();
  } catch (error) {
    expect(error).toBeInstanceOf(ModelRoutingError);
    return (error as ModelRoutingError).code;
  }
  throw new Error('expected the router to refuse, but it did not');
}

describe('a model absent from the registry cannot be routed to (§6.3, R18)', () => {
  it('refuses when the roster picks a model the registry does not grade at this tier', () => {
    // Contract 10 roster picks the cheapest capable model at T1, which is MiMo. The registry
    // grades only GLM for L0. The two disagree, so the router refuses — it does NOT quietly route
    // to GLM, which is the silent substitution §6.3 forbids.
    const registry = registryOf([graded(MODEL_GLM)]);
    expect(codeOf(() => routeModel({ registry, grant: grantFor('T1', 'turn-a'), budget: budget() }))).toBe(
      'MODEL_ROUTING_POLICY_PICK_NOT_ELIGIBLE',
    );
  });

  it('refuses when nothing in the registry is graded for what the tier requires', () => {
    // T2 requires contract 09 L1. Every listed model fails it, so there is no candidate at all.
    const registry = registryOf([
      graded(MODEL_GLM, { bands: { L0: true, L1: false, L2: true } }),
      graded(MODEL_GROK, { bands: { L0: true, L1: false, L2: true } }),
      graded(MODEL_KIMI, { bands: { L0: true, L1: false, L2: true } }),
    ]);
    expect(codeOf(() => routeModel({ registry, grant: grantFor('T2', 'turn-b'), budget: budget() }))).toBe(
      'MODEL_ROUTING_NO_ELIGIBLE_MODEL',
    );
  });

  it('refuses a T4 turn when no model carries contract 09 separate developer/build verdict', () => {
    const registry = registryOf([graded(MODEL_GLM, { developerBuild: false }), graded(MODEL_KIMI, { developerBuild: false })]);
    expect(codeOf(() => routeModel({ registry, grant: grantFor('T4', 'turn-c'), budget: budget() }))).toBe(
      'MODEL_ROUTING_NO_ELIGIBLE_MODEL',
    );
  });

  it('refuses a registry that offers a model it did not mint from an entry', () => {
    // The only way to reach this belt: a hand-built AdmittedRegistry, which is what a cast buys.
    const forgedModel = { modelId: MODEL_MIMO, bands: { L0: true, L1: true, L2: true }, developerBuild: true } as unknown as EligibleModel;
    const forgedRegistry: AdmittedRegistry = {
      resolve: () => forgedModel,
      modelIds: [MODEL_MIMO],
      eligibleAt: () => [forgedModel],
    };
    expect(codeOf(() => eligibleCandidatesAt(forgedRegistry, 'T1'))).toBe('MODEL_ROUTING_MODEL_NOT_ADMITTED');
    expect(codeOf(() => routeModel({ registry: forgedRegistry, grant: grantFor('T1', 'turn-d'), budget: budget() }))).toBe(
      'MODEL_ROUTING_MODEL_NOT_ADMITTED',
    );
  });

  it('refuses to yield a model id from a routing decision it did not produce', () => {
    const forged = { model: { modelId: MODEL_KIMI }, tier: 'T1', turnRef: 'turn-e' } as unknown as RoutedModel;
    expect(isRoutedModel(forged)).toBe(false);
    expect(codeOf(() => routedModelId(forged))).toBe('MODEL_ROUTING_MODEL_NOT_ADMITTED');
  });
});

describe('Phase 5.1 grant is still required, so a routed model always belongs to a classified turn', () => {
  it('refuses a grant that classifyTurn did not mint', () => {
    const forged = { tier: 'T1', turnRef: 'turn-f', rule: 'low_risk_extraction' } as unknown as ModelInvocationGrant;
    expect(codeOf(() => routeModel({ registry: FULLY_GRADED(), grant: forged, budget: budget() }))).toBe(
      'MODEL_ROUTING_GRANT_NOT_MINTED',
    );
  });
});

describe('owner decision K4 holds the two premium models off (steering pfos-current)', () => {
  it('refuses a premium model when no opt-in was supplied for the turn', () => {
    // The belt behind `modelPolicy`. Exercised directly because `selectModel` asked without an
    // opt-in never answers with a premium model, so this cannot be reached through routeModel.
    for (const premium of PREMIUM_MODELS) {
      const refusal = premiumRefusal(premium, false);
      expect(refusal).toBeInstanceOf(ModelRoutingError);
      expect(refusal?.code).toBe('MODEL_ROUTING_PREMIUM_NOT_OPTED_IN');
    }
    // And it permits the same model once the owner has opted in for this turn.
    for (const premium of PREMIUM_MODELS) expect(premiumRefusal(premium, true)).toBeNull();
    // A default-allowed model is never touched by it, opt-in or not.
    for (const allowed of DEFAULT_ALLOWED) expect(premiumRefusal(allowed, false)).toBeNull();
  });

  it('refuses an opt-in that belongs to a different turn rather than ignoring it', () => {
    const optIn: PremiumOptIn = { authorizedBy: 'owner', forTurnRef: 'turn-other', reason: 'ultra_complex_task' };
    expect(
      codeOf(() => routeModel({ registry: FULLY_GRADED(), grant: grantFor('T3', 'turn-g'), budget: budget(), premiumOptIn: optIn })),
    ).toBe('MODEL_ROUTING_PREMIUM_OPT_IN_FOREIGN_TURN');
  });

  it('keeps premium models out of the fallback chain absent an opt-in, because the chain is sent', () => {
    // Contract 10 uses `models` as an ordered fallback list, so a premium model surviving into the
    // chain would be offered to the provider even though it was never chosen.
    const routed = routeModel({ registry: FULLY_GRADED(), grant: grantFor('T2', 'turn-h'), budget: budget() });
    expect(routed.model.modelId).toBe(MODEL_GLM);
    expect(routed.premiumUsed).toBe(false);
    const chainIds = routed.fallbackChain.map((model) => model.modelId);
    for (const premium of PREMIUM_MODELS) expect(chainIds).not.toContain(premium);
  });

  it('admits the designated premium pick only with an opt-in bound to this very turn', () => {
    const grant = grantFor('T3', 'turn-i');
    const optIn: PremiumOptIn = { authorizedBy: 'owner', forTurnRef: 'turn-i', reason: 'ultra_complex_task' };
    const withoutOptIn = routeModel({ registry: FULLY_GRADED(), grant, budget: budget() });
    expect(withoutOptIn.model.modelId).toBe(MODEL_GLM);
    expect(withoutOptIn.premiumUsed).toBe(false);

    const withOptIn = routeModel({ registry: FULLY_GRADED(), grant, budget: budget(), premiumOptIn: optIn });
    expect(withOptIn.model.modelId).toBe(MODEL_GROK);
    expect(withOptIn.premiumUsed).toBe(true);
  });
});

describe('the weekly cap refuses explicitly, and never by downgrading (§6.2, R17)', () => {
  it('refuses when this agent own ledger says the cap is reached', () => {
    expect(codeOf(() => routeModel({ registry: FULLY_GRADED(), grant: grantFor('T1', 'turn-j'), budget: budget(0) }))).toBe(
      'MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED',
    );
  });

  it('refuses when the policy finds even the cheapest capable model unaffordable', () => {
    // Not exhausted by the ledger reading — one micro-USD of headroom remains — and still refused,
    // because the cheapest capable turn costs more than that. Two independent readings, and the
    // second is not made redundant by the first.
    const nearlyEmpty = budget(1);
    expect(nearlyEmpty.exhausted).toBe(false);
    expect(codeOf(() => routeModel({ registry: FULLY_GRADED(), grant: grantFor('T1', 'turn-k'), budget: nearlyEmpty }))).toBe(
      'MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED',
    );
  });

  it('names the agent and the week in the refusal, and carries no figure with it', () => {
    try {
      routeModel({ registry: FULLY_GRADED(), grant: grantFor('T1', 'turn-l'), budget: budget(0) });
      throw new Error('expected a refusal');
    } catch (error) {
      const refusal = error as ModelRoutingError;
      expect(refusal.detail.agent).toBe('finance');
      expect(refusal.detail.weekKey).toBe(WEEK_KEY);
      // Legible to an operator, and carrying no amount, prompt, or completion (§6.4, R19).
      expect(Object.values(refusal.detail).join(' ')).not.toMatch(/\d+\.\d/);
    }
  });
});

describe('the branch that cannot fire is shown to be unreachable rather than contrived into firing', () => {
  it('every model-bearing tier has at least one K4-allowed capable model, so a null pick is impossible', () => {
    for (const tier of ['T1', 'T2', 'T3', 'T4'] as const) {
      const allowedCapable = TIER_CAPABLE[tier].filter((model) => DEFAULT_ALLOWED.includes(model));
      expect(allowedCapable.length).toBeGreaterThan(0);
    }
  });
});

describe('the router does route, so the gates above are not refusing everything', () => {
  it('routes each tier to the cheapest capable model the registry grades for it', () => {
    const registry = FULLY_GRADED();
    const expected: Readonly<Record<ModelBearingTier, string>> = {
      T1: MODEL_MIMO,
      T2: MODEL_GLM,
      T3: MODEL_GLM,
      T4: MODEL_GLM,
    };
    for (const tier of ['T1', 'T2', 'T3', 'T4'] as const) {
      const routed = routeModel({ registry, grant: grantFor(tier, `turn-ok-${tier}`), budget: budget() });
      expect(routed.model.modelId).toBe(expected[tier]);
      expect(routed.tier).toBe(tier);
      expect(routed.turnRef).toBe(`turn-ok-${tier}`);
      expect(isRoutedModel(routed)).toBe(true);
      expect(routedModelId(routed)).toBe(expected[tier]);
      // The policy verdict is carried verbatim rather than recomputed.
      expect(routed.policy.tier).toBe(tier);
      expect(routed.policy.model).toBe(expected[tier]);
    }
  });

  it('carries the requirement the tier imposed, so an operator reads why this model was allowed', () => {
    const registry = FULLY_GRADED();
    expect(routeModel({ registry, grant: grantFor('T1', 'turn-w1'), budget: budget() }).requirement).toEqual({
      kind: 'finance_band',
      band: 'L0',
    });
    expect(routeModel({ registry, grant: grantFor('T4', 'turn-w4'), budget: budget() }).requirement).toEqual({
      kind: 'developer_build',
    });
  });

  it('orders the fallback chain by contract 10 own roster rather than by anything invented here', () => {
    const grant = grantFor('T3', 'turn-chain');
    const optIn: PremiumOptIn = { authorizedBy: 'owner', forTurnRef: 'turn-chain', reason: 'ultra_complex_task' };
    const routed = routeModel({ registry: FULLY_GRADED(), grant, budget: budget(), premiumOptIn: optIn });
    expect(routed.model.modelId).toBe(MODEL_GROK);
    // TIER_CAPABLE.T3 is [GLM, GROK, KIMI]; the chosen model is removed and the order is preserved.
    expect(routed.fallbackChain.map((model) => model.modelId)).toEqual([MODEL_GLM, MODEL_KIMI]);
  });
});
