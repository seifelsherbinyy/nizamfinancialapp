// @vitest-environment node
/**
 * NIZAM · B6 made a call POSSIBLE; routing still refuses one, and B8 is what changes that
 * Implemented by: PFOS Contract 12 / Phase 2, task **B6**, seam **S3** (spec 07-bot-bringup-v1)
 * Owning requirements: R18 (a registry marked `provisional` SHALL NOT permit live routing), R16 (the
 *   door needs a grant `classifyTurn` minted), steering §3 (a fixture-backed run is provisional and
 *   may never promote a model for live routing)
 * Depends on: ./modelProvider (the REAL port built in this task), ../routing/turnDispatch,
 *   ../routing/turnClassifier, ../routing/eligibilityRegistry, ../routing/modelRouter,
 *   ../mocks/fixtures (the real Phase 2.2 loader, so `provisional` is the loader's own literal),
 *   ../../features/routing/spendLedger. No network: the dial capability below records and answers.
 *
 * `provisionalCannotPromote.test.ts` walks the whole promotion journey and cuts it at the registry.
 * This file asserts the one thing that changed when B6 landed, and the one thing that did not:
 *
 *  - **Changed:** a module now exists that can perform a request. Given a grant and a request, the
 *    real port dials its injected capability and returns a result. That is what "possible" means.
 *  - **Did NOT change:** nothing can NAME a model for a turn while the registry is provisional. So the
 *    port is never reached on a routed path, and the dial capability records zero invocations — which
 *    is the assertion, because a capability that was never called cannot have spent anything.
 *
 * The distinction matters because a reader could otherwise conclude that wiring a live-capable port is
 * what makes bot B talk to a provider. It is not. **B8** is: one authorised benchmark pass emits a
 * measured registry, and until then the router refuses.
 */
import { describe, expect, it } from 'vitest';

import { MODEL_MIMO } from '../../features/routing/modelPolicy.ts';
import { agentWeeklyBudget, weekKeyOf, type AgentWeeklyBudget } from '../../features/routing/spendLedger.ts';
import type { EnvSource } from '../config/environment.ts';
import { inlineFixtureSource, loadRecordedInteractions } from '../mocks/fixtures.ts';
import type { ModelRequest, ProviderPrivacyPolicy } from '../ports/openrouter.ts';
import {
  admitEligibilityRegistry,
  ELIGIBILITY_REGISTRY_VERSION,
  EligibilityRegistryError,
  provisionalRegistryFromFixture,
  type EligibilityRegistryEntry,
  type LiveEligibilityRegistry,
} from '../routing/eligibilityRegistry.ts';
import { routeModel } from '../routing/modelRouter.ts';
import { classifyTurn, isModelBearing, type TurnFacts } from '../routing/turnClassifier.ts';
import { createModelChannel } from '../routing/turnDispatch.ts';
import {
  createModelProviderPort,
  MODEL_API_BASE_ENTRY,
  type ModelDialRequest,
  type TelemetrySink,
} from './modelProvider.ts';

/**
 * A model from contract 10's own roster inside owner decision K4's allowed set, because the router
 * refuses anything outside both — and a refusal for that reason would make this file assert nothing
 * about the provisional flag.
 */
const MODEL_UNDER_TEST = MODEL_MIMO;
const WEEK_KEY = weekKeyOf('2026-08-06');
/** Synthetic provider cap, ample, so a refusal below can only ever be about the registry. */
const CAP_MICRO_USD = 500_000;

const ENV: EnvSource = Object.freeze({
  OR_KEY_FINANCE: 'fixture-not-a-credential',
  FINANCE_WEEKLY_CAP: String(CAP_MICRO_USD),
  // A reserved, unroutable name (RFC 2606 `.invalid`). No address anybody operates (R24).
  [MODEL_API_BASE_ENTRY]: 'https://model-provider.invalid/v1',
});

const PRIVACY: ProviderPrivacyPolicy = Object.freeze({
  training: 'excluded',
  dataCollectingProviders: 'denied',
  zeroDataRetention: 'required',
  requiredParameters: Object.freeze([]),
});

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

/** The smallest document the Phase 2.2 loader accepts, so `provisional: true` is the loader's own. */
const EMPTY_FIXTURE = JSON.stringify({
  fixtureVersion: 1,
  synthetic: true,
  name: 'b6-possible-not-routable',
  telegramDeliveries: [],
  modelExchanges: [],
  recoveryObservations: [],
  snapshots: [],
  signals: [],
});

const ENTRY: EligibilityRegistryEntry = Object.freeze({
  modelId: MODEL_UNDER_TEST,
  bands: { L0: true, L1: true, L2: true },
  developerBuild: true,
  disqualified: false,
});

function budget(): AgentWeeklyBudget {
  return agentWeeklyBudget([], { agent: 'finance', weekKey: WEEK_KEY, capMicroUsd: CAP_MICRO_USD });
}

function grantFor(turnRef: string) {
  const classification = classifyTurn(CALM, turnRef);
  if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
  return classification.modelGrant;
}

const noTelemetry: TelemetrySink = () => undefined;

/** The real port, over a dial capability that COUNTS invocations. Nothing here reaches a network. */
function portWithCounter() {
  const dialled: ModelDialRequest[] = [];
  const port = createModelProviderPort({
    agent: 'finance',
    env: ENV,
    dial: async (request) => {
      dialled.push(request);
      return {
        status: 200,
        bodyText: JSON.stringify({
          model: MODEL_UNDER_TEST,
          text: 'a synthetic completion',
          schemaValid: true,
          usage: { promptTokens: 1, cachedTokens: 0, completionTokens: 1, reasoningTokens: 0, costMicroUsd: 1 },
        }),
        latencyMs: 1,
      };
    },
    now: () => '2026-08-11T00:00:00.000Z',
    newId: () => 'telemetry-row',
    record: noTelemetry,
  });
  return { dialled, port };
}

function requestFor(turnRef: string, modelId: string): ModelRequest {
  return {
    agent: 'finance',
    tier: 'T1',
    modelId,
    contentClass: 'financial',
    privacy: PRIVACY,
    messages: [{ role: 'user', content: 'a synthetic turn, never recorded' }],
    maxOutputTokens: 32,
    correlationRef: turnRef,
  };
}

describe('B6 makes a call possible', () => {
  it('performs the request when a grant and a request are handed to the door directly', async () => {
    const { dialled, port } = portWithCounter();
    const grant = grantFor('possible');
    const result = await createModelChannel(port).invoke(grant, requestFor('possible', MODEL_UNDER_TEST));

    expect(result.text).toBe('a synthetic completion');
    expect(result.usage.costMicroUsd).toBe(1);
    // Possible: the capability really was reached, once, with the resolved base.
    expect(dialled).toHaveLength(1);
    expect(dialled[0]?.correlationRef).toBe('possible');
  });
});

describe('B6 does NOT make a call routable — routing still refuses until B8 (R18)', () => {
  it('admits nothing from a fixture-backed run, so there is no registry to route with', () => {
    const loaded = loadRecordedInteractions(inlineFixtureSource({ 'b6.json': EMPTY_FIXTURE }), 'b6.json');
    expect(loaded.provisional).toBe(true);
    const registry = provisionalRegistryFromFixture(loaded, [ENTRY]);
    let code: string | null = null;
    try {
      admitEligibilityRegistry(registry as unknown as LiveEligibilityRegistry);
    } catch (error) {
      expect(error).toBeInstanceOf(EligibilityRegistryError);
      code = (error as EligibilityRegistryError).code;
    }
    expect(code).toBe('ELIGIBILITY_REGISTRY_PROVISIONAL');
  });

  it('cannot name a model for a turn, so the wired capability is never invoked and spends nothing', () => {
    const { dialled } = portWithCounter();
    const registry = provisionalRegistryFromFixture(
      loadRecordedInteractions(inlineFixtureSource({ 'b6.json': EMPTY_FIXTURE }), 'b6.json'),
      [ENTRY],
    );

    expect(() =>
      routeModel({
        // @ts-expect-error R18: a provisional registry is not an AdmittedRegistry, and there is no
        // conversion — `admitEligibilityRegistry` is the only mint and it refuses this document. B6
        // changed the port; it did not change what the router will accept.
        registry,
        grant: grantFor('not-routable'),
        budget: budget(),
      }),
    ).toThrow();

    // The whole assertion: routing produced no model id, so nothing composed a request, so the
    // socket-bearing seam was never reached. A capability never called cannot have spent anything.
    expect(dialled).toHaveLength(0);
  });

  it('and the SAME entry routes to this port once the registry is measured, so the cut is the flag', async () => {
    const { dialled, port } = portWithCounter();
    const live: LiveEligibilityRegistry = {
      registryVersion: ELIGIBILITY_REGISTRY_VERSION,
      provisional: false,
      entries: [ENTRY],
    };
    const grant = grantFor('measured');
    const routed = routeModel({ registry: admitEligibilityRegistry(live), grant, budget: budget() });
    expect(routed.model.modelId).toBe(MODEL_UNDER_TEST);

    const result = await createModelChannel(port).invoke(grant, requestFor('measured', routed.model.modelId));
    expect(result.modelIdServed).toBe(MODEL_UNDER_TEST);
    expect(dialled).toHaveLength(1);
  });
});
