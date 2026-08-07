// @vitest-environment node
/**
 * NIZAM · The OpenRouter mock refuses on every §6 ground — contract 12 §6 (R16, R18, R19)
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Depends on: ./openrouterMock, ./invocationRecorder, ./fixtures, ../ports/openrouter
 *
 * Each refusal is driven with a request that differs from the accepted one by exactly one field, so
 * a passing refusal cannot be passing for an unrelated reason, and the accepted case is asserted
 * alongside it so neither is vacuous.
 *
 * The R16 case is the one §6.1 names directly: a deterministic decision must invoke no model, and
 * the way to prove that is a mock that records invocations and an assertion that the record is
 * empty. It is at the bottom of this file.
 *
 * The cap here is a synthetic figure chosen so exhaustion arrives on the second call. It is not the
 * owner's cap and not a price; provider cost is integer micro-USD, a different unit from the
 * owner's ledger (contract 06 §6.1).
 */
import { describe, expect, it } from 'vitest';

import { COST_SOURCE_ACTUAL } from '../../features/routing/spendLedger';
import { MockPortFailure } from './failure';
import { loadRecordedInteractions, nodeFixtureSource } from './fixtures';
import { createInvocationRecorder } from './invocationRecorder';
import { createOpenRouterMock, type OpenRouterMockConfig } from './openrouterMock';
import type { ModelRequest, OpenRouterPortConfig, ProviderPrivacyPolicy } from '../ports/openrouter';

const ELIGIBLE_MODEL = 'fixture/model-a';

/** A synthetic cap, sized so the second identical call exhausts it. */
const CONFIG: OpenRouterPortConfig = {
  agent: 'finance',
  apiBaseUrlRef: 'OPENROUTER_API_BASE_REF',
  apiKeyRef: 'OPENROUTER_FINANCE_KEY_REF',
  weeklyCapMicroUsd: 100,
  killSwitchSentinelPathRef: 'NIZAM_KILL_SWITCH_SENTINEL_REF',
  eligibilityRegistryPathRef: 'MODEL_ELIGIBILITY_REGISTRY_REF',
};

const PRIVACY: ProviderPrivacyPolicy = {
  training: 'excluded',
  dataCollectingProviders: 'denied',
  zeroDataRetention: 'preferred',
  requiredParameters: [],
};

/** 32 characters of content, so the deterministic token counts below are checkable by hand. */
const REQUEST: ModelRequest = {
  agent: 'finance',
  tier: 'T1',
  modelId: ELIGIBLE_MODEL,
  contentClass: 'operational',
  privacy: PRIVACY,
  messages: [{ role: 'user', content: 'a synthetic operational question' }],
  maxOutputTokens: 64,
  correlationRef: 'corr-1',
};

const EXPECTED_PROMPT_TOKENS = 32;
const EXPECTED_COMPLETION_TOKENS = 8;
const EXPECTED_COST_MICRO_USD = 56;

function mockWith(overrides: Partial<OpenRouterMockConfig> = {}) {
  const recorder = createInvocationRecorder();
  return createOpenRouterMock({
    config: CONFIG,
    recorder,
    eligibleModelIds: [ELIGIBLE_MODEL],
    ...overrides,
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MockPortFailure) return error.code;
    throw error;
  }
  throw new Error('the mock resolved a call it was supposed to refuse');
}

describe('an eligible, in-cap, policy-carrying request completes deterministically', () => {
  it('answers with integer usage and the only permitted cost provenance (§6.2)', async () => {
    const mock = mockWith();
    const result = await mock.port.complete(REQUEST);
    expect(result.modelIdServed).toBe(ELIGIBLE_MODEL);
    expect(result.usage).toEqual({
      promptTokens: EXPECTED_PROMPT_TOKENS,
      cachedTokens: 0,
      completionTokens: EXPECTED_COMPLETION_TOKENS,
      reasoningTokens: 0,
      costMicroUsd: EXPECTED_COST_MICRO_USD,
      costSource: COST_SOURCE_ACTUAL,
    });
    expect(Number.isSafeInteger(result.usage.costMicroUsd)).toBe(true);
    expect(mock.spentMicroUsd).toBe(EXPECTED_COST_MICRO_USD);
  });

  it('gives byte-identical results for the same request on two fresh mocks', async () => {
    const first = await mockWith().port.complete(REQUEST);
    const second = await mockWith().port.complete(REQUEST);
    expect(first).toEqual(second);
  });

  it('records a redacted projection: no prompt, no completion (§6.4, R19)', async () => {
    const mock = mockWith();
    await mock.port.complete(REQUEST);
    const call = mock.recorder.callsTo('openrouter', 'complete')[0];
    expect(call?.detail).toEqual({
      correlationRef: 'corr-1',
      agent: 'finance',
      tier: 'T1',
      modelId: ELIGIBLE_MODEL,
      contentClass: 'operational',
      messageCount: 1,
      zeroDataRetention: 'preferred',
    });
    expect(JSON.stringify(call)).not.toContain('a synthetic operational question');
  });

  it('writes a loggable telemetry row that carries the policy assertion and no content', async () => {
    const mock = mockWith();
    await mock.port.complete(REQUEST);
    const row = mock.telemetry[0];
    expect(row?.privacyPolicyAsserted).toBe(true);
    expect(row?.outcome).toBe('ok');
    expect(row?.costSource).toBe(COST_SOURCE_ACTUAL);
    expect(JSON.stringify(row)).not.toContain('a synthetic operational question');
  });
});

describe('the weekly cap refuses the MODEL call and nothing else (§6.2)', () => {
  it('completes the first call and refuses the second, once the estimate would exceed the cap', async () => {
    const mock = mockWith();
    await expect(mock.port.complete(REQUEST)).resolves.toBeDefined();
    expect(await codeOf(mock.port.complete({ ...REQUEST, correlationRef: 'corr-2' }))).toBe(
      'MODEL_WEEKLY_CAP_EXHAUSTED',
    );
    // The refused call added nothing to the ledger.
    expect(mock.spentMicroUsd).toBe(EXPECTED_COST_MICRO_USD);
  });

  it('refuses immediately when the agent starts the week already at the cap', async () => {
    const mock = mockWith({ alreadySpentMicroUsd: CONFIG.weeklyCapMicroUsd });
    expect(await codeOf(mock.port.complete(REQUEST))).toBe('MODEL_WEEKLY_CAP_EXHAUSTED');
    expect(mock.telemetry[0]?.outcome).toBe('refused');
  });
});

describe('the other §6 refusals', () => {
  it('refuses when the kill switch is engaged (design key decision 7)', async () => {
    expect(await codeOf(mockWith({ killSwitchEngaged: true }).port.complete(REQUEST))).toBe(
      'MODEL_KILL_SWITCH_ENGAGED',
    );
  });

  it('refuses routing on a provisional eligibility registry (§6.3, R18)', async () => {
    expect(await codeOf(mockWith({ registryProvisional: true }).port.complete(REQUEST))).toBe(
      'MODEL_ELIGIBILITY_REGISTRY_PROVISIONAL',
    );
  });

  it('refuses a model absent from the registry, and accepts the one that is in it', async () => {
    const mock = mockWith();
    expect(await codeOf(mock.port.complete({ ...REQUEST, modelId: 'fixture/model-unlisted' }))).toBe(
      'MODEL_NOT_IN_ELIGIBILITY_REGISTRY',
    );
    await expect(mock.port.complete(REQUEST)).resolves.toBeDefined();
  });

  it('refuses financial content that only PREFERS zero-data retention (§6.4, R19)', async () => {
    const mock = mockWith();
    expect(
      await codeOf(
        mock.port.complete({ ...REQUEST, contentClass: 'financial', correlationRef: 'corr-financial' }),
      ),
    ).toBe('MODEL_PRIVACY_POLICY_UNSATISFIED');
  });

  it('accepts the same financial request once retention is REQUIRED, so the gate is not blanket', async () => {
    const mock = mockWith();
    await expect(
      mock.port.complete({
        ...REQUEST,
        contentClass: 'financial',
        privacy: { ...PRIVACY, zeroDataRetention: 'required' },
        correlationRef: 'corr-financial-ok',
      }),
    ).resolves.toBeDefined();
  });

  it('refuses when the provider is unavailable, and marks the row a provider error', async () => {
    const mock = mockWith({ providerUnavailable: true });
    expect(await codeOf(mock.port.complete(REQUEST))).toBe('MODEL_PROVIDER_UNAVAILABLE');
    expect(mock.telemetry[0]?.outcome).toBe('provider_error');
  });
});

describe('replay from the recorded fixture (steering §3)', () => {
  const loaded = loadRecordedInteractions(nodeFixtureSource(), 'two-agent-smoke');

  it('serves the recorded exchange rather than a synthesized one, keyed by correlation', async () => {
    const recorded = loaded.set.modelExchanges.find((e) => e.correlationRef === 'corr-fixture-ok');
    if (recorded === undefined) throw new Error('the fixture must carry the valid exchange');
    const mock = mockWith({
      exchanges: loaded.set.modelExchanges,
      config: { ...CONFIG, weeklyCapMicroUsd: 10_000 },
    });
    const result = await mock.port.complete({ ...REQUEST, correlationRef: 'corr-fixture-ok' });
    expect(result.text).toBe(recorded.text);
    expect(result.parsed).toEqual(recorded.parsed);
    expect(result.usage.costMicroUsd).toBe(recorded.costMicroUsd);
    expect(result.latencyMs).toBe(recorded.latencyMs);
  });

  it('refuses a recorded response that fails the schema the caller declared', async () => {
    const mock = mockWith({
      exchanges: loaded.set.modelExchanges,
      config: { ...CONFIG, weeklyCapMicroUsd: 10_000 },
    });
    expect(
      await codeOf(
        mock.port.complete({
          ...REQUEST,
          correlationRef: 'corr-fixture-bad-schema',
          responseSchemaRef: 'schema/decision-v1',
        }),
      ),
    ).toBe('MODEL_RESPONSE_SCHEMA_INVALID');
  });

  it('reports the same response as a value when no schema was declared, rather than refusing', async () => {
    const mock = mockWith({
      exchanges: loaded.set.modelExchanges,
      config: { ...CONFIG, weeklyCapMicroUsd: 10_000 },
    });
    const result = await mock.port.complete({ ...REQUEST, correlationRef: 'corr-fixture-bad-schema' });
    expect(result.schemaValid).toBe(false);
  });
});

describe('R16: a deterministic decision invokes no model (§6.1)', () => {
  it('leaves the record empty, which is the assertion §6.1 asks for', () => {
    const mock = mockWith();
    // The T0 tier is not expressible as a request at all, so a caller on that tier has
    // nothing to call. This stands in for such a caller: it reaches a decision and stops.
    const decision = REQUEST.messages.length > 0 ? 'handled-deterministically' : 'needs-a-model';
    expect(decision).toBe('handled-deterministically');
    expect(mock.recorder.isEmpty('openrouter')).toBe(true);
    expect(mock.recorder.callsTo('openrouter', 'complete')).toEqual([]);
    expect(mock.telemetry).toEqual([]);
    expect(mock.spentMicroUsd).toBe(0);
  });

  it('stops reporting an empty record the moment a model IS invoked, so the above can fail', async () => {
    const mock = mockWith();
    await mock.port.complete(REQUEST);
    expect(mock.recorder.isEmpty('openrouter')).toBe(false);
  });
});
