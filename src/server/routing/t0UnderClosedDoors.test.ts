// @vitest-environment node
/**
 * NIZAM · A T0 turn is answered when EVERY model path is shut — cap gone, registry gone
 * Implemented by: PFOS Contract 12 / Phase 5.4 (spec 06-two-agent-vps)
 * Owning requirements: R16 (a turn classified `T0` invokes no model), composed with R17 (an
 *   exhausted cap refuses model calls but suppresses no deterministic answer) and R18 (an absent
 *   registry refuses routing)
 * Depends on: ./turnDispatch, ./turnClassifier, ./eligibilityRegistry, ./modelRouter,
 *   ../mocks/openrouterMock, ../mocks/invocationRecorder, ../../features/routing/spendLedger
 *
 * Phase 5.1's `t0NoModel.test.ts` already proves R16 on its own terms: a 36-turn corpus of every
 * deterministic intent under every pressure profile, dispatched through the real path, leaving the
 * invocation recorder empty, with a positive control so the silence means something. None of that is
 * repeated here.
 *
 * What is NOT there is the COMPOSITION. That corpus runs with a healthy budget and a fully graded
 * registry. R16 and R17 together promise something stronger: a T0 turn is answered deterministically
 * when there is no model available to call at all. Three ways of having no model, and each one is a
 * different mechanism:
 *
 *  1. **The cap is exhausted.** The in-app belt refuses, and so does the provider key.
 *  2. **There is no registry.** `parseEligibilityRegistry(null)` refuses, so no `AdmittedRegistry`
 *     exists — `routeModel` cannot even be CALLED, because the value its parameter needs was never
 *     produced. This is the sharpest form of the composition: not a refusal at run time, an absence
 *     of the argument.
 *  3. **The registry is there but provisional.** Admission refuses, so again nothing to route with.
 *
 * In every one of the three, a T0 turn must still be answered. §6.2: "A cap is a spend guard, not a
 * service outage." An absent registry is a routing gate, not an outage either.
 *
 * The corpus here is deliberately small — the breadth argument was made in 5.1, and repeating 36
 * turns three times would be volume rather than evidence. What this file adds is the axis 5.1 held
 * fixed. The recorder is asserted empty in each case, for the reason §6.1 gives: a test that only
 * inspected the answer would pass if a model had been called and its output discarded.
 *
 * Provider figures are integer micro-USD, synthetic. No owner money, no `src/lib/money` import, no
 * deployment particular (R24), and no prompt text in any record (§6.4, R19).
 */
import { describe, expect, it } from 'vitest';

import { MODEL_GLM } from '../../features/routing/modelPolicy';
import {
  agentWeeklyBudget,
  COST_SOURCE_ACTUAL,
  weekKeyOf,
  type AgentWeeklyBudget,
} from '../../features/routing/spendLedger';
import { createInvocationRecorder, type InvocationRecorder } from '../mocks/invocationRecorder';
import { createOpenRouterMock } from '../mocks/openrouterMock';
import type { ModelRequest, OpenRouterPortConfig, ProviderPrivacyPolicy } from '../ports/openrouter';
import {
  admitEligibilityRegistry,
  ELIGIBILITY_REGISTRY_VERSION,
  EligibilityRegistryError,
  parseEligibilityRegistry,
  provisionalRegistryFromFixture,
  type AdmittedRegistry,
  type LiveEligibilityRegistry,
} from './eligibilityRegistry';
import { ModelRoutingError, routeModel } from './modelRouter';
import { createModelChannel, dispatchTurn, type TurnDispatchDependencies } from './turnDispatch';
import {
  INTENT_FAMILY,
  TURN_INTENTS,
  classifyTurn,
  isModelBearing,
  type ModelInvocationGrant,
  type TurnFacts,
  type TurnIntent,
} from './turnClassifier';

const WEEK_KEY = weekKeyOf('2026-08-06');
/** Synthetic provider cap. Exhausted means spent >= this, and nothing here is the owner's cap. */
const CAP_MICRO_USD = 200_000;

const PRIVACY: ProviderPrivacyPolicy = Object.freeze({
  training: 'excluded',
  dataCollectingProviders: 'denied',
  zeroDataRetention: 'required',
  requiredParameters: Object.freeze(['structured_outputs']),
});

const PORT_CONFIG: OpenRouterPortConfig = Object.freeze({
  agent: 'finance',
  apiBaseUrlRef: 'OPENROUTER_API_BASE_REF',
  apiKeyRef: 'OPENROUTER_FINANCE_KEY_REF',
  weeklyCapMicroUsd: CAP_MICRO_USD,
  killSwitchSentinelPathRef: 'NIZAM_KILL_SWITCH_SENTINEL_REF',
  eligibilityRegistryPathRef: 'MODEL_ELIGIBILITY_REGISTRY_REF',
});

const BASE: TurnFacts = Object.freeze({
  intent: 'recalculate_balances',
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

/** Contract 10's deterministic intents, read from the family map rather than retyped. */
const DETERMINISTIC_INTENTS: readonly TurnIntent[] = TURN_INTENTS.filter(
  (intent) => INTENT_FAMILY[intent] === 'deterministic',
);

interface Harness {
  readonly recorder: InvocationRecorder;
  readonly deps: TurnDispatchDependencies<string>;
  readonly deterministicRuns: () => number;
}

/**
 * The same wiring the runtime uses, with the provider key already spent to its cap so any call that
 * did reach the port would be refused there too.
 */
function shutHarness(): Harness {
  const recorder = createInvocationRecorder();
  const mock = createOpenRouterMock({
    config: PORT_CONFIG,
    recorder,
    eligibleModelIds: [MODEL_GLM],
    alreadySpentMicroUsd: CAP_MICRO_USD,
  });
  let deterministicRuns = 0;
  const deps: TurnDispatchDependencies<string> = {
    channel: createModelChannel(mock.port),
    executeDeterministically: (_facts: TurnFacts, turnRef: string): string => {
      deterministicRuns += 1;
      return `code-only:${turnRef}`;
    },
    planModelRequest: (grant: ModelInvocationGrant): ModelRequest => ({
      agent: 'finance',
      tier: grant.tier,
      modelId: MODEL_GLM,
      contentClass: 'financial',
      privacy: PRIVACY,
      messages: [{ role: 'user', content: 'synthetic turn text, never recorded' }],
      maxOutputTokens: 64,
      correlationRef: grant.turnRef,
    }),
  };
  return { recorder, deps, deterministicRuns: () => deterministicRuns };
}

function exhaustedBudget(): AgentWeeklyBudget {
  return agentWeeklyBudget(
    [
      {
        id: 'row-spent',
        agent: 'finance',
        occurredAt: '2026-08-06T08:00:00Z',
        weekKey: WEEK_KEY,
        modelId: MODEL_GLM,
        costMicroUsd: CAP_MICRO_USD,
        promptTokens: 4,
        completionTokens: 1,
        requestRef: 'req-spent',
        costSource: COST_SOURCE_ACTUAL,
      },
    ],
    { agent: 'finance', weekKey: WEEK_KEY, capMicroUsd: CAP_MICRO_USD },
  );
}

function gradedRegistry(): AdmittedRegistry {
  const document: LiveEligibilityRegistry = {
    registryVersion: ELIGIBILITY_REGISTRY_VERSION,
    provisional: false,
    entries: [{ modelId: MODEL_GLM, bands: { L0: true, L1: true, L2: true }, developerBuild: true, disqualified: false }],
  };
  return admitEligibilityRegistry(document);
}

function modelBearingGrant(turnRef: string): ModelInvocationGrant {
  const classification = classifyTurn({ ...BASE, intent: 'explain_safe_to_spend' }, turnRef);
  if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
  return classification.modelGrant;
}

// =============================================================================================
// The composition: every deterministic intent, with every model path closed
// =============================================================================================

describe('a T0 turn is answered with the cap exhausted (R16 composed with R17)', () => {
  it('answers every deterministic intent by code only, and the recorder stays empty', async () => {
    const { recorder, deps, deterministicRuns } = shutHarness();
    // The precondition: the model path really is shut for this agent, at the in-app belt.
    const budget = exhaustedBudget();
    expect(budget.exhausted).toBe(true);
    expect(() => routeModel({ registry: gradedRegistry(), grant: modelBearingGrant('probe-cap'), budget })).toThrow(
      ModelRoutingError,
    );

    for (const intent of DETERMINISTIC_INTENTS) {
      const outcome = await dispatchTurn(deps, { ...BASE, intent }, `shut-cap-${intent}`);
      expect(outcome.route, intent).toBe('code_only');
      expect(outcome.tier, intent).toBe('T0');
    }
    expect(deterministicRuns()).toBe(DETERMINISTIC_INTENTS.length);
    // §6.1's assertion: not that the answer looked right, but that nothing was invoked.
    expect(recorder.all).toEqual([]);
    expect(recorder.isEmpty('openrouter', 'complete')).toBe(true);
  });

  it('refuses the model-bearing turn on the SAME wiring, so the door is genuinely shut', async () => {
    // Without this, "the recorder is empty" would be consistent with a channel that was open and
    // simply never asked, which proves nothing about the composition.
    const { recorder, deps } = shutHarness();
    await expect(
      dispatchTurn(deps, { ...BASE, intent: 'explain_safe_to_spend' }, 'shut-cap-model'),
    ).rejects.toThrow();
    // The port WAS reached for the model-bearing turn — the refusal came from the provider belt.
    expect(recorder.isEmpty()).toBe(false);
  });
});

describe('a T0 turn is answered with NO registry at all (R16 composed with R18)', () => {
  it('has no registry to route with, because admission never produced one', () => {
    // §6.3's absent case. This is not a refusal inside `routeModel`; it is the absence of the value
    // `routeModel` needs, so the model path does not exist to be taken.
    expect(() => parseEligibilityRegistry(null)).toThrow(EligibilityRegistryError);
    expect(() => parseEligibilityRegistry(undefined)).toThrow(EligibilityRegistryError);
  });

  it('still answers every deterministic intent, and still records nothing', async () => {
    const { recorder, deps, deterministicRuns } = shutHarness();
    for (const intent of DETERMINISTIC_INTENTS) {
      const outcome = await dispatchTurn(deps, { ...BASE, intent }, `no-registry-${intent}`);
      if (outcome.route !== 'code_only') throw new Error(`expected the deterministic route for ${intent}`);
      expect(outcome.tier, intent).toBe('T0');
      expect(outcome.answer, intent).toBe(`code-only:no-registry-${intent}`);
    }
    expect(deterministicRuns()).toBe(DETERMINISTIC_INTENTS.length);
    expect(recorder.isEmpty()).toBe(true);
  });

  it('still answers when the registry exists but is provisional, which admits nothing either', async () => {
    const provisional = provisionalRegistryFromFixture({ provisional: true }, [
      { modelId: MODEL_GLM, bands: { L0: true, L1: true, L2: true }, developerBuild: true, disqualified: false },
    ]);
    // Reached only by defeating the type, which is the only way a provisional document gets here.
    expect(() => admitEligibilityRegistry(provisional as unknown as LiveEligibilityRegistry)).toThrow(
      EligibilityRegistryError,
    );

    const { recorder, deps } = shutHarness();
    const outcome = await dispatchTurn(deps, { ...BASE, intent: 'recalculate_balances' }, 'provisional-t0');
    expect(outcome.route).toBe('code_only');
    expect(recorder.isEmpty()).toBe(true);
  });

  it('answers a T0 turn with the cap exhausted AND no registry AND the kill switch engaged', async () => {
    // Everything closed at once. A T0 turn is still answered, because it never needed any of them.
    const recorder = createInvocationRecorder();
    const mock = createOpenRouterMock({
      config: PORT_CONFIG,
      recorder,
      // No eligible model, a provisional registry, the kill switch on, and the cap spent.
      eligibleModelIds: [],
      registryProvisional: true,
      killSwitchEngaged: true,
      alreadySpentMicroUsd: CAP_MICRO_USD,
    });
    const deps: TurnDispatchDependencies<string> = {
      channel: createModelChannel(mock.port),
      executeDeterministically: (_facts: TurnFacts, turnRef: string): string => `code-only:${turnRef}`,
      planModelRequest: (grant: ModelInvocationGrant): ModelRequest => ({
        agent: 'finance',
        tier: grant.tier,
        modelId: MODEL_GLM,
        contentClass: 'financial',
        privacy: PRIVACY,
        messages: [{ role: 'user', content: 'synthetic turn text, never recorded' }],
        maxOutputTokens: 64,
        correlationRef: grant.turnRef,
      }),
    };

    for (const intent of DETERMINISTIC_INTENTS) {
      const outcome = await dispatchTurn(deps, { ...BASE, intent }, `all-closed-${intent}`);
      expect(outcome.route, intent).toBe('code_only');
    }
    expect(recorder.isEmpty()).toBe(true);
    expect(mock.telemetry).toEqual([]);
    expect(mock.spentMicroUsd).toBe(CAP_MICRO_USD);

    // The same wiring refuses a model-bearing turn, so all four gates were live.
    await expect(dispatchTurn(deps, { ...BASE, intent: 'explain_safe_to_spend' }, 'all-closed-model')).rejects.toThrow();
  });
});
