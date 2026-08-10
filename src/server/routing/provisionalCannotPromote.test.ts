// @vitest-environment node
/**
 * NIZAM · A benchmark verdict is not a promotion — a provisional registry promotes nothing
 * Implemented by: PFOS Contract 12 / Phase 5.4 (spec 06-two-agent-vps)
 * Owning requirements: R18 (a registry marked `provisional` SHALL NOT permit live routing)
 * Depends on: ./eligibilityRegistry, ./modelRouter, ./turnClassifier, ../mocks/fixtures,
 *   ../mocks/openrouterMock, ../mocks/invocationRecorder,
 *   ../../features/benchmark/eligibility (contract 09's REAL aggregator),
 *   ../../features/routing/modelPolicy, ../../features/routing/spendLedger
 *
 * Phase 5.2's `eligibilityRegistry.test.ts` proves the ADMISSION claim thoroughly: a provisional
 * document is refused by the type checker, refused again at run time behind a cast, refused at both
 * `parseEligibilityRegistry` and `admitEligibilityRegistry`, and the fixture loader's
 * `provisional: true` literal is shown to be the real thing. None of that is repeated here.
 *
 * "Cannot **promote**" is a narrower claim than "cannot be admitted", and it is the one contract 09
 * words:
 *
 *   "Eligibility registry approved. **No model promoted from benchmark reputation alone.**"
 *
 * Promotion is a JOURNEY, and admission is one gate on it. The journey is: a benchmark run grades a
 * model → the grades are written into a registry → the registry admits → the router selects → a
 * request carries the model id → the provider serves it. Contract 12 §6.3 cuts the journey at the
 * registry, and steering §3 says which runs land on the provisional side of the cut: "If the dev key
 * is absent or exhausted, the harness must run against recorded fixtures and mark the registry
 * `provisional: true`. A provisional registry may **never** promote a model for live routing."
 *
 * So this file walks the whole journey with a model that contract 09's own aggregator PROMOTED to
 * L0, L1 and L2 — a genuinely well-graded model, not a failing one — and shows that every remaining
 * step is unavailable because the run was fixture-backed. The distinction matters: a test that only
 * showed a provisional document being refused would leave open whether a model graded by the
 * benchmark could reach live routing by some other route. There is no other route, and this is where
 * that is written down.
 *
 * `evaluateEligibility` is contract 09's real aggregator, imported verbatim. The case scores below
 * are synthetic and deliberately clean, because a disqualified model would make the test pass for
 * the wrong reason. No figure, no key, no endpoint, no deployment particular appears (R24), and no
 * prompt text reaches any record (§6.4, R19).
 */
import { describe, expect, it } from 'vitest';

import { evaluateEligibility, type ModelEligibility } from '../../features/benchmark/eligibility.ts';
import type { BenchmarkCategory, CaseScore, Severity } from '../../features/benchmark/benchmark.types.ts';
import { MODEL_GLM, MODEL_MIMO } from '../../features/routing/modelPolicy.ts';
import {
  agentWeeklyBudget,
  weekKeyOf,
  type AgentWeeklyBudget,
} from '../../features/routing/spendLedger.ts';
import { inlineFixtureSource, loadRecordedInteractions, type LoadedFixture } from '../mocks/fixtures.ts';
import { createInvocationRecorder } from '../mocks/invocationRecorder.ts';
import { createOpenRouterMock } from '../mocks/openrouterMock.ts';
import { isMockPortFailure } from '../mocks/failure.ts';
import type { ModelRequest, OpenRouterPortConfig, ProviderPrivacyPolicy } from '../ports/openrouter.ts';
import {
  admitEligibilityRegistry,
  ELIGIBILITY_REGISTRY_VERSION,
  EligibilityRegistryError,
  parseEligibilityRegistry,
  provisionalRegistryFromFixture,
  type EligibilityRegistryEntry,
  type LiveEligibilityRegistry,
  type ProvisionalEligibilityRegistry,
} from './eligibilityRegistry.ts';
import { routeModel, routedModelId } from './modelRouter.ts';
import { classifyTurn, isModelBearing, type ModelInvocationGrant, type TurnFacts } from './turnClassifier.ts';

const WEEK_KEY = weekKeyOf('2026-08-06');
/** Synthetic provider cap, ample, so a refusal below can only be about the registry. */
const CAP_MICRO_USD = 500_000;

// ---------------------------------------------------------------------------------------------
// Contract 09's own aggregator, over a clean synthetic corpus
// ---------------------------------------------------------------------------------------------

function score(over: Partial<CaseScore> & { category: BenchmarkCategory; severity: Severity }): CaseScore {
  return {
    caseId: over.category,
    tier: 'T1',
    metric: 1,
    passed: true,
    hardRuleViolations: 0,
    schemaValid: true,
    criticalFieldAccuracy: 1,
    evidenceCoverage: 1,
    latencyMs: 1,
    costUsd: 0,
    ...over,
  };
}

/** A corpus that contract 09 grades at every band. Synthetic, and clean on purpose. */
function cleanRun(): CaseScore[] {
  return [
    score({ caseId: 'sms-a', category: 'sms_extraction', severity: 'P0' }),
    score({ caseId: 'sms-b', category: 'sms_extraction', severity: 'P0' }),
    score({ category: 'classification', severity: 'P2' }),
    score({ category: 'dedup', severity: 'P1' }),
    score({ category: 'multilingual', severity: 'P0' }),
    score({ category: 'tool_call', severity: 'P1' }),
    score({ category: 'safe_to_spend_explanation', severity: 'P1' }),
    score({ category: 'purchase_decision', severity: 'P0' }),
    score({ category: 'forecast', severity: 'P1' }),
    score({ category: 'adversarial', severity: 'P0' }),
  ];
}

/** Turn a contract 09 verdict into the registry entry a Phase 6 emitter would write. */
function entryFrom(verdict: ModelEligibility): EligibilityRegistryEntry {
  return {
    modelId: verdict.model,
    bands: verdict.levels,
    // Contract 09 keeps the developer/build judgement on its own axis; a fixture run states it too.
    developerBuild: !verdict.disqualified,
    disqualified: verdict.disqualified,
  };
}

/** The smallest document the Phase 2.2 loader accepts, so `provisional: true` is the loader's own. */
const EMPTY_FIXTURE = JSON.stringify({
  fixtureVersion: 1,
  // The loader refuses a fixture that is not declared synthetic, because the repository is public
  // (steering §0b) and a fixture is constructed for a test, never derived from real data.
  synthetic: true,
  name: 'promotion-journey',
  telegramDeliveries: [],
  modelExchanges: [],
  recoveryObservations: [],
  snapshots: [],
  signals: [],
});

/**
 * Load through the REAL Phase 2.2 loader, so `provisional` is the loader's own literal rather than a
 * value written down here. That is the whole point of step 2 below.
 */
function fixtureBackedRun(): LoadedFixture {
  return loadRecordedInteractions(inlineFixtureSource({ 'promotion.json': EMPTY_FIXTURE }), 'promotion.json');
}

// ---------------------------------------------------------------------------------------------
// The routing side
// ---------------------------------------------------------------------------------------------

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

function grant(turnRef: string): ModelInvocationGrant {
  const classification = classifyTurn(CALM, turnRef);
  if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
  return classification.modelGrant;
}

function amplebudget(): AgentWeeklyBudget {
  return agentWeeklyBudget([], { agent: 'finance', weekKey: WEEK_KEY, capMicroUsd: CAP_MICRO_USD });
}

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

// =============================================================================================
// R18 — the promotion journey, cut at the registry
// =============================================================================================

describe('a model contract 09 graded at every band is still not promoted by a fixture-backed run (R18)', () => {
  const verdict = evaluateEligibility(MODEL_MIMO, cleanRun());

  it('step 1: contract 09 own aggregator DOES grade the model — so the cut below is the registry', () => {
    // If the model were disqualified, everything after this would refuse for the wrong reason and
    // the test would be asserting nothing about the provisional rule.
    expect(verdict.disqualified).toBe(false);
    expect(verdict.levels).toEqual({ L0: true, L1: true, L2: true });
    expect(verdict.disqualifiers).toEqual([]);
  });

  it('step 2: a fixture-backed run marks the registry provisional, and the mark comes from the loader', () => {
    // Steering §3: a run against recorded fixtures is provisional. The flag is not written by hand
    // here — it is `LoadedFixture.provisional`, which the loader types as the literal `true`.
    const loaded = fixtureBackedRun();
    expect(loaded.provisional).toBe(true);
    const registry: ProvisionalEligibilityRegistry = provisionalRegistryFromFixture(loaded, [entryFrom(verdict)]);
    expect(registry.provisional).toBe(true);
    expect(registry.entries.map((entry) => entry.modelId)).toEqual([MODEL_MIMO]);
    // The grades really did survive into the document, so the document is a genuine candidate.
    expect(registry.entries[0]?.bands).toEqual({ L0: true, L1: true, L2: true });
  });

  it('step 3: the registry admits nothing, so there is no admitted registry to route with', () => {
    const registry = provisionalRegistryFromFixture(fixtureBackedRun(), [entryFrom(verdict)]);
    // The type checker refuses first; the runtime belt is what a cast reaches.
    let code: string | null = null;
    try {
      admitEligibilityRegistry(registry as unknown as LiveEligibilityRegistry);
    } catch (error) {
      expect(error).toBeInstanceOf(EligibilityRegistryError);
      code = (error as EligibilityRegistryError).code;
    }
    expect(code).toBe('ELIGIBILITY_REGISTRY_PROVISIONAL');
    // And the same document read back as untyped data refuses identically, which is the shape it
    // has when a Phase 6 emitter has written it to disk and a runtime reads it again.
    expect(() => parseEligibilityRegistry(JSON.parse(JSON.stringify(registry)))).toThrow(EligibilityRegistryError);
  });

  it('step 4: `routeModel` cannot be reached, because its registry argument was never produced', () => {
    // This is the sharpest statement of "cannot promote": not a refusal inside the router, but the
    // absence of a value the router's parameter requires. There is no expression this test can write
    // that hands `routeModel` a registry built from a fixture-backed run.
    const registry = provisionalRegistryFromFixture(fixtureBackedRun(), [entryFrom(verdict)]);
    expect(() =>
      routeModel({
        // @ts-expect-error R18: a provisional registry is not an AdmittedRegistry, and there is no
        // conversion — the only mint is `admitEligibilityRegistry`, which refuses this document.
        registry,
        grant: grant('promote-attempt'),
        budget: amplebudget(),
      }),
    ).toThrow();
  });

  it('step 5: no model id can be carried into a request, because no routing decision exists', () => {
    // `routedModelId` is the only function that turns a routing decision back into the string a
    // request wants. Without an admitted registry there is no decision to hand it, and a forged one
    // is refused — so a fixture-graded model cannot reach `ModelRequest.modelId` by this path.
    const forged = { model: { modelId: MODEL_MIMO }, tier: 'T1', turnRef: 'promote-attempt' };
    expect(() => routedModelId(forged as unknown as Parameters<typeof routedModelId>[0])).toThrow();
  });

  it('step 6: the provider refuses a provisional registry too, so the last step is closed as well', async () => {
    // §6.3 is a routing rule, and the port carries its own belt for the case where a request was
    // somehow assembled anyway. Two belts, and this is the second.
    const mock = createOpenRouterMock({
      config: PORT_CONFIG,
      recorder: createInvocationRecorder(),
      eligibleModelIds: [MODEL_MIMO, MODEL_GLM],
      registryProvisional: true,
    });
    const request: ModelRequest = {
      agent: 'finance',
      tier: 'T1',
      modelId: MODEL_MIMO,
      contentClass: 'financial',
      privacy: PRIVACY,
      messages: [{ role: 'user', content: 'synthetic turn text, never recorded' }],
      maxOutputTokens: 64,
      correlationRef: 'promote-attempt-port',
    };
    await expect(mock.port.complete(request)).rejects.toSatisfy(
      (error: unknown) => isMockPortFailure(error) && error.code === 'MODEL_ELIGIBILITY_REGISTRY_PROVISIONAL',
    );
    // Refused, and it cost nothing — a blocked promotion is not a paid call.
    expect(mock.spentMicroUsd).toBe(0);
  });

  it('and the SAME grades promote the model once the registry is live-measured, so the cut is the flag', () => {
    // Without this, every refusal above would be equally consistent with grades the router rejects
    // for some other reason. The only thing that changes here is `provisional`.
    const live: LiveEligibilityRegistry = {
      registryVersion: ELIGIBILITY_REGISTRY_VERSION,
      provisional: false,
      entries: [entryFrom(verdict), entryFrom(evaluateEligibility(MODEL_GLM, cleanRun()))],
    };
    const admitted = admitEligibilityRegistry(live);
    const routed = routeModel({ registry: admitted, grant: grant('promoted'), budget: amplebudget() });
    expect(routed.model.modelId).toBe(MODEL_MIMO);
    expect(routedModelId(routed)).toBe(MODEL_MIMO);
  });
});
