// @vitest-environment node
/**
 * NIZAM · The three belts at the model door, each shown refusing
 * Implemented by: PFOS Contract 12 / Phase 5.1 (spec 06-two-agent-vps)
 * Owning requirements: R16 (a turn classified `T0` invokes no model)
 * Depends on: ./turnDispatch, ./turnClassifier, ../mocks/openrouterMock, ../mocks/invocationRecorder
 *
 * The design's testing strategy is explicit that "a test that has only ever been observed passing is
 * not evidence. Each negative test must be shown failing the guarded operation, not merely returning
 * a value." So every case below asserts two things: the typed refusal, AND that the invocation
 * recorder is still empty afterwards. The second is what distinguishes a guard that refused BEFORE
 * the provider from a guard that refused after paying for the call.
 *
 * The three belts exist because the type-level brand alone is defeatable by a cast, and because a
 * request planner can disagree with the classification without anybody intending harm:
 *
 *  1. `TURN_MODEL_GRANT_NOT_MINTED` — a grant this module did not issue. This is the belt that
 *     stands between a `as unknown as` cast and a paid call.
 *  2. `TURN_MODEL_GRANT_TIER_MISMATCH` — a request labelled with a different tier than the turn was
 *     classified for. `ModelRequest.tier` already excludes `T0` at compile time; this closes the
 *     remaining gap, where a cheap turn's grant is spent on an expensive tier.
 *  3. `TURN_MODEL_GRANT_TURN_MISMATCH` — one grant, one turn. A grant cannot be carried forward.
 *
 * No figure and no deployment particular appears in any fixture (§6, R24).
 */
import { describe, expect, it } from 'vitest';

import { MODEL_GLM } from '../../features/routing/modelPolicy';
import { createInvocationRecorder, type InvocationRecorder } from '../mocks/invocationRecorder';
import { createOpenRouterMock, type OpenRouterMock } from '../mocks/openrouterMock';
import type { ModelRequest, OpenRouterPortConfig, ProviderPrivacyPolicy } from '../ports/openrouter';
import { createModelChannel, TurnRoutingError, type ModelChannel } from './turnDispatch';
import {
  classifyTurn,
  isModelBearing,
  type ModelBearingTier,
  type ModelInvocationGrant,
  type TurnFacts,
} from './turnClassifier';

const PORT_CONFIG: OpenRouterPortConfig = Object.freeze({
  agent: 'finance',
  apiBaseUrlRef: 'OPENROUTER_API_BASE_REF',
  apiKeyRef: 'OPENROUTER_FINANCE_KEY_REF',
  weeklyCapMicroUsd: 10_000,
  killSwitchSentinelPathRef: 'NIZAM_KILL_SWITCH_SENTINEL_REF',
  eligibilityRegistryPathRef: 'MODEL_ELIGIBILITY_REGISTRY_REF',
});

const PRIVACY: ProviderPrivacyPolicy = Object.freeze({
  training: 'excluded',
  dataCollectingProviders: 'denied',
  zeroDataRetention: 'required',
  requiredParameters: Object.freeze([]),
});

const FACTS: TurnFacts = Object.freeze({
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

function wiring(): { recorder: InvocationRecorder; mock: OpenRouterMock; channel: ModelChannel } {
  const recorder = createInvocationRecorder();
  const mock = createOpenRouterMock({ config: PORT_CONFIG, recorder, eligibleModelIds: [MODEL_GLM] });
  return { recorder, mock, channel: createModelChannel(mock.port) };
}

function requestFor(tier: ModelBearingTier, correlationRef: string): ModelRequest {
  return {
    agent: PORT_CONFIG.agent,
    tier,
    modelId: MODEL_GLM,
    contentClass: 'financial',
    privacy: PRIVACY,
    messages: [{ role: 'user', content: 'synthetic turn text' }],
    maxOutputTokens: 64,
    correlationRef,
  };
}

/** A genuine grant for a T1 turn, minted the only way one can be. */
function mintedT1Grant(turnRef: string): ModelInvocationGrant {
  const classification = classifyTurn(FACTS, turnRef);
  if (!isModelBearing(classification)) throw new Error('expected a model-bearing classification');
  expect(classification.tier).toBe('T1');
  return classification.modelGrant;
}

/** Assert the refusal carries the expected code, and that nothing reached the provider. */
async function expectRefusal(
  code: string,
  attempt: () => Promise<unknown>,
  recorder: InvocationRecorder,
  mock: OpenRouterMock,
): Promise<void> {
  await expect(attempt()).rejects.toBeInstanceOf(TurnRoutingError);
  await attempt().catch((error: unknown) => {
    expect(error).toBeInstanceOf(TurnRoutingError);
    expect((error as TurnRoutingError).code).toBe(code);
  });
  // The belt fired BEFORE the port, which is why the record is still empty.
  expect(recorder.isEmpty()).toBe(true);
  expect(mock.telemetry).toEqual([]);
  expect(mock.spentMicroUsd).toBe(0);
}

describe('belt 1 — a grant this module did not mint is refused (§6.1, R16)', () => {
  it('refuses a hand-built grant that satisfies the type by a cast', async () => {
    const { recorder, mock, channel } = wiring();
    const forged = { tier: 'T1', turnRef: 'turn-forged', rule: 'low_risk_extraction' } as unknown as ModelInvocationGrant;
    await expectRefusal(
      'TURN_MODEL_GRANT_NOT_MINTED',
      () => channel.invoke(forged, requestFor('T1', 'turn-forged')),
      recorder,
      mock,
    );
  });

  it('refuses a grant-shaped value copied field for field out of a real one', async () => {
    const { recorder, mock, channel } = wiring();
    const genuine = mintedT1Grant('turn-copied');
    const copy = { ...genuine } as ModelInvocationGrant;
    await expectRefusal(
      'TURN_MODEL_GRANT_NOT_MINTED',
      () => channel.invoke(copy, requestFor('T1', 'turn-copied')),
      recorder,
      mock,
    );
  });
});

describe('belt 2 — a request must be labelled with the tier the turn was classified for', () => {
  it('refuses a T4 request issued under a T1 grant', async () => {
    const { recorder, mock, channel } = wiring();
    const grant = mintedT1Grant('turn-tier-mismatch');
    await expectRefusal(
      'TURN_MODEL_GRANT_TIER_MISMATCH',
      () => channel.invoke(grant, requestFor('T4', 'turn-tier-mismatch')),
      recorder,
      mock,
    );
  });

  it('cannot be asked to issue a T0 request at all, because the type has no such member', () => {
    // @ts-expect-error §6.1: `ModelRequest.tier` is `Exclude<Tier, 'T0'>`, so this does not compile.
    const impossible: ModelRequest = requestFor('T0', 'turn-t0');
    expect(impossible.tier).toBe('T0');
  });
});

describe('belt 3 — one classification authorizes one turn', () => {
  it('refuses a request whose correlation reference belongs to a different turn', async () => {
    const { recorder, mock, channel } = wiring();
    const grant = mintedT1Grant('turn-first');
    await expectRefusal(
      'TURN_MODEL_GRANT_TURN_MISMATCH',
      () => channel.invoke(grant, requestFor('T1', 'turn-second')),
      recorder,
      mock,
    );
  });
});

describe('the door does open for a well-formed pair, so the belts are not refusing everything', () => {
  it('completes when the grant is minted and the request agrees with it', async () => {
    const { recorder, mock, channel } = wiring();
    const grant = mintedT1Grant('turn-ok');
    const result = await channel.invoke(grant, requestFor('T1', 'turn-ok'));
    expect(result.correlationRef).toBe('turn-ok');
    expect(recorder.countOf('openrouter', 'complete')).toBe(1);
    expect(mock.spentMicroUsd).toBeGreaterThan(0);
  });

  it('does not expose the port it wrapped, so the belts cannot be stepped around', () => {
    const { channel } = wiring();
    expect(Object.keys(channel)).toEqual(['invoke']);
    expect(JSON.stringify(channel)).toBe('{}');
  });
});
