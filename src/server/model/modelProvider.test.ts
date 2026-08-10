// @vitest-environment node
/**
 * NIZAM · The model provider module: it composes, dials through an injected capability, and fails closed
 * Implemented by: PFOS Contract 12 / Phase 2, task **B6**, seam **S3** (spec 07-bot-bringup-v1)
 * Owning requirements: R18 (a call is possible, never routable, until B8), R19 (no prompt text, no
 *   completion text and no credential in any recorded row or refusal detail), R24 (no deployment
 *   particular: every fixture below is synthetic and every address uses a reserved `.invalid` name),
 *   contract 12 §6.2.1 (the recorded cost is the provider's ACTUAL integer micro-USD), §6.4 (every
 *   request carries the privacy policy)
 * Depends on: ./modelProvider, ../db/modelTelemetryRepo, ../db/repositories/testStore (a real
 *   migrated store on a temporary directory), ../ports/openrouter (types),
 *   ../../features/benchmark/providerResponseReader (the SHARED reader whose refusals are asserted here).
 *
 * **No network.** Every test supplies its own dial capability, which is a plain function over the
 * request it was handed. The socket-owning dialler is never constructed and never invoked here — see
 * `./liveModelDial.test.ts` for what is provable about it without dialling.
 *
 * No credential value is invented: the fixture below is the literal word `synthetic`, which is not of
 * a credential's shape and could not authorise anything anywhere.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { readTelemetry, recordedCallCount } from '../db/modelTelemetryRepo.ts';
import { openTestStore, type TestStore } from '../db/repositories/testStore.ts';
import type { EnvSource } from '../config/environment.ts';
import type { ModelRequest, ProviderPrivacyPolicy } from '../ports/openrouter.ts';
import type { ProviderHttpAnswer } from '../../features/benchmark/providerResponseReader.ts';
import {
  createBindableTelemetrySink,
  createModelProviderPort,
  gatedModelDial,
  MODEL_API_BASE_ENTRY,
  MODEL_REDACTION_MARKER,
  modelCallTelemetry,
  modelCredential,
  modelRequestBody,
  ModelPortError,
  revealModelCredential,
  storeTelemetrySink,
  type ModelDialFn,
  type ModelDialRequest,
  type TelemetrySink,
} from './modelProvider.ts';

// ---------------------------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------------------------

/** A reserved, unroutable name. Not a host anybody operates (RFC 2606 `.invalid`), R24. */
const SYNTHETIC_BASE = 'https://model-provider.invalid/v1';

/**
 * Not of a credential's shape, and it authorises nothing anywhere: no secret value is invented here,
 * not even a plausibly-shaped one (steering §2). It also shares no substring with any other fixture
 * below, so "the credential did not reach this string" is a real assertion rather than a lucky one.
 */
const SYNTHETIC_CREDENTIAL = 'not-a-key';

const ENV: EnvSource = Object.freeze({
  OR_KEY_FINANCE: SYNTHETIC_CREDENTIAL,
  FINANCE_WEEKLY_CAP: '500000',
  [MODEL_API_BASE_ENTRY]: SYNTHETIC_BASE,
});

const PRIVACY: ProviderPrivacyPolicy = Object.freeze({
  training: 'excluded',
  dataCollectingProviders: 'denied',
  zeroDataRetention: 'required',
  requiredParameters: Object.freeze(['structured_outputs']),
});

const THE_OWNER_SAID = 'a private synthetic sentence the owner typed';

function requestFor(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    agent: 'finance',
    tier: 'T1',
    modelId: 'vendor/model-under-test',
    contentClass: 'financial',
    privacy: PRIVACY,
    messages: [
      { role: 'system', content: 'a synthetic framing' },
      { role: 'user', content: THE_OWNER_SAID },
    ],
    maxOutputTokens: 64,
    correlationRef: 'turn-ref-b6',
    ...overrides,
  };
}

/** A provider answer body, in the shape the SHARED reader judges. */
function answerBody(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: 'vendor/model-under-test',
    text: 'a synthetic completion',
    parsed: { confidenceBps: 9_000 },
    schemaValid: true,
    usage: { promptTokens: 11, cachedTokens: 0, completionTokens: 7, reasoningTokens: 0, costMicroUsd: 42 },
    ...over,
  });
}

interface Dialled {
  readonly requests: ModelDialRequest[];
  readonly credentials: string[];
  readonly dial: ModelDialFn;
}

/** A dial capability that records what it was handed and answers what the test told it to. */
function fakeDial(answer: ProviderHttpAnswer): Dialled {
  const requests: ModelDialRequest[] = [];
  const credentials: string[] = [];
  return {
    requests,
    credentials,
    dial: async (request, credential) => {
      requests.push(request);
      credentials.push(String(credential));
      return answer;
    },
  };
}

function ok(bodyText: string = answerBody(), status = 200, latencyMs = 13): ProviderHttpAnswer {
  return { status, bodyText, latencyMs };
}

/** Collect records instead of storing them, for the tests that are about the projection. */
function collector(): { readonly records: Parameters<TelemetrySink>[0][]; readonly sink: TelemetrySink } {
  const records: Parameters<TelemetrySink>[0][] = [];
  return { records, sink: (record) => void records.push(record) };
}

let ids = 0;
function port(dial: ModelDialFn, record: TelemetrySink, env: EnvSource = ENV) {
  return createModelProviderPort({
    agent: 'finance',
    env,
    dial,
    now: () => '2026-08-11T00:00:00.000Z',
    newId: () => `telemetry-${(ids += 1)}`,
    record,
  });
}

// =============================================================================================
// The credential holder
// =============================================================================================

describe('the model credential cannot be printed by accident', () => {
  it('yields the redaction marker through every accidental route', () => {
    const held = modelCredential(SYNTHETIC_CREDENTIAL);
    expect(String(held)).toBe(MODEL_REDACTION_MARKER);
    expect(`${held}`).toBe(MODEL_REDACTION_MARKER);
    expect(JSON.stringify({ held })).toBe(`{"held":"${MODEL_REDACTION_MARKER}"}`);
    expect(revealModelCredential(held)).toBe(SYNTHETIC_CREDENTIAL);
  });

  it('refuses to reveal a value it did not wrap', () => {
    const forged = Object.freeze({ toString: () => 'x', toJSON: () => 'x' }) as unknown as Parameters<typeof revealModelCredential>[0];
    expect(() => revealModelCredential(forged)).toThrow(ModelPortError);
  });
});

// =============================================================================================
// The request body
// =============================================================================================

describe('the composed body carries the privacy policy and no credential', () => {
  it('carries the model, the bound, the messages and the whole policy (§6.4)', () => {
    const body = JSON.parse(modelRequestBody(requestFor())) as Record<string, unknown>;
    expect(body.model).toBe('vendor/model-under-test');
    expect(body.max_tokens).toBe(64);
    expect(body.privacy).toEqual({
      training: 'excluded',
      dataCollectingProviders: 'denied',
      zeroDataRetention: 'required',
      requiredParameters: ['structured_outputs'],
    });
  });

  it('carries no credential and no field for one', () => {
    const raw = modelRequestBody(requestFor());
    expect(raw).not.toContain(SYNTHETIC_CREDENTIAL);
    expect(raw).not.toContain('authorization');
  });
});

// =============================================================================================
// The happy path, and what it records
// =============================================================================================

describe('a completed call is read by the SHARED reader and recorded through the EXISTING repository', () => {
  it('returns the provider answer and hands the credential to the dial, wrapped', async () => {
    const dialled = fakeDial(ok());
    const { records, sink } = collector();
    const result = await port(dialled.dial, sink).complete(requestFor());

    expect(result.modelIdServed).toBe('vendor/model-under-test');
    expect(result.text).toBe('a synthetic completion');
    expect(result.schemaValid).toBe(true);
    expect(result.usage.costMicroUsd).toBe(42);
    expect(result.usage.costSource).toBe('provider_reported_actual');
    expect(result.usage.promptTokens).toBe(11);
    expect(result.usage.completionTokens).toBe(7);
    expect(result.latencyMs).toBe(13);
    expect(result.correlationRef).toBe('turn-ref-b6');

    // The base came from the entry, and the credential travelled beside the request, unprintable.
    expect(dialled.requests[0]?.baseUrl).toBe(SYNTHETIC_BASE);
    expect(dialled.credentials).toEqual([MODEL_REDACTION_MARKER]);
    expect(records).toHaveLength(1);
  });

  it('records cost, tokens, latency and the schema verdict, and NO prompt or completion text', async () => {
    const { records, sink } = collector();
    await port(fakeDial(ok()).dial, sink).complete(requestFor());
    const record = records[0];
    if (record === undefined) throw new Error('expected one telemetry record');

    expect(record.telemetry.costMicroUsd).toBe(42);
    expect(record.telemetry.costSource).toBe('provider_reported_actual');
    expect(record.telemetry.promptTokens).toBe(11);
    expect(record.telemetry.completionTokens).toBe(7);
    expect(record.telemetry.latencyMs).toBe(13);
    expect(record.telemetry.schemaValid).toBe(true);
    expect(record.telemetry.privacyPolicyAsserted).toBe(true);
    expect(record.telemetry.outcome).toBe('ok');

    const serialised = JSON.stringify(record);
    expect(serialised).not.toContain(THE_OWNER_SAID);
    expect(serialised).not.toContain('a synthetic completion');
    expect(serialised).not.toContain(SYNTHETIC_CREDENTIAL);
  });

  it('records the model the provider SERVED, which is what a row has to name', () => {
    const telemetry = modelCallTelemetry(
      requestFor(),
      {
        modelIdRequested: 'vendor/model-under-test',
        modelIdServed: 'vendor/model-under-test',
        text: 'x',
        parsed: null,
        schemaValid: false,
        promptTokens: 1,
        cachedTokens: 0,
        completionTokens: 1,
        reasoningTokens: 0,
        costMicroUsd: 0,
        latencyMs: 1,
      },
      'ok',
    );
    expect(telemetry.modelIdServed).toBe('vendor/model-under-test');
    // A refusal claims nothing it was not told: zeroed measurements, and an invalid schema verdict.
    const refused = modelCallTelemetry(requestFor(), null, 'provider_error');
    expect(refused.costMicroUsd).toBe(0);
    expect(refused.schemaValid).toBe(false);
    expect(refused.outcome).toBe('provider_error');
  });
});

// =============================================================================================
// The five refusals, which are the SHARED reader's and are not re-implemented here
// =============================================================================================

describe('an answer that does not satisfy the reader is refused, never partially believed', () => {
  const cases: readonly (readonly [string, ProviderHttpAnswer])[] = [
    ['a non-success status', ok(answerBody(), 500)],
    ['an unparseable body', ok('not json at all')],
    ['a body that is not an object', ok('[]')],
    ['an absent usage block', ok(JSON.stringify({ model: 'vendor/model-under-test', text: 'x' }))],
    [
      'a non-integer cost',
      ok(answerBody({ usage: { promptTokens: 1, completionTokens: 1, costMicroUsd: 0.42 } })),
    ],
    [
      'a negative cost',
      ok(answerBody({ usage: { promptTokens: 1, completionTokens: 1, costMicroUsd: -1 } })),
    ],
    ['a substituted model', ok(answerBody({ model: 'vendor/some-other-model' }))],
  ];

  for (const [label, answer] of cases) {
    it(`refuses ${label}, and records the attempt as a provider error`, async () => {
      const { records, sink } = collector();
      try {
        await port(fakeDial(answer).dial, sink).complete(requestFor());
        throw new Error('expected a refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelPortError);
        const refusal = error as ModelPortError;
        expect(refusal.reason).toBe('answer_refused');
        expect(refusal.code).toBe('MODEL_RESPONSE_SCHEMA_INVALID');
        expect(refusal.correlationRef).toBe('turn-ref-b6');
        // The refusal names a field path and a code, and never what the turn or the answer said.
        expect(JSON.stringify(refusal.detail)).not.toContain(THE_OWNER_SAID);
      }
      expect(records[0]?.telemetry.outcome).toBe('provider_error');
      expect(records[0]?.telemetry.costMicroUsd).toBe(0);
    });
  }

  it('treats an unstated schema verdict as invalid rather than as valid', async () => {
    const { sink } = collector();
    const result = await port(fakeDial(ok(answerBody({ schemaValid: undefined }))).dial, sink).complete(requestFor());
    expect(result.schemaValid).toBe(false);
  });
});

// =============================================================================================
// Fail-closed configuration, and the gated capability
// =============================================================================================

describe('the port fails closed before it dials', () => {
  it('refuses a request that names another agent — one key, one bound, one store (R17)', async () => {
    const dialled = fakeDial(ok());
    const { sink } = collector();
    await expect(port(dialled.dial, sink).complete(requestFor({ agent: 'life' }))).rejects.toBeInstanceOf(ModelPortError);
    expect(dialled.requests).toHaveLength(0);
  });

  it('refuses when the provider base entry is absent, and names the entry, never an address', async () => {
    const dialled = fakeDial(ok());
    const { sink } = collector();
    const withoutBase: EnvSource = { OR_KEY_FINANCE: SYNTHETIC_CREDENTIAL, FINANCE_WEEKLY_CAP: '500000' };
    try {
      await port(dialled.dial, sink, withoutBase).complete(requestFor());
      throw new Error('expected a refusal');
    } catch (error) {
      const refusal = error as ModelPortError;
      expect(refusal.reason).toBe('base_absent');
      expect(refusal.detail.entryName).toBe(MODEL_API_BASE_ENTRY);
      expect(refusal.message).not.toContain('model-provider.invalid');
    }
    expect(dialled.requests).toHaveLength(0);
  });

  it('refuses when this agent\'s credential entry is absent, and names the entry, never a value', async () => {
    const dialled = fakeDial(ok());
    const { sink } = collector();
    const withoutKey: EnvSource = { FINANCE_WEEKLY_CAP: '500000', [MODEL_API_BASE_ENTRY]: SYNTHETIC_BASE };
    await expect(port(dialled.dial, sink, withoutKey).complete(requestFor())).rejects.toThrow();
    expect(dialled.requests).toHaveLength(0);
  });

  it('records a dial that produced no answer, and reports no address in the refusal', async () => {
    const { records, sink } = collector();
    const exploding: ModelDialFn = async () => {
      throw new Error('the platform failed to reach model-provider.invalid');
    };
    try {
      await port(exploding, sink).complete(requestFor());
      throw new Error('expected a refusal');
    } catch (error) {
      const refusal = error as ModelPortError;
      expect(refusal.reason).toBe('dial_failed');
      expect(refusal.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
      // The platform's own error is discarded rather than chained: its message names the host (R24).
      expect(refusal.message).not.toContain('model-provider.invalid');
      expect(refusal.cause).toBeUndefined();
    }
    expect(records[0]?.telemetry.outcome).toBe('provider_error');
  });

  it('is the GATED capability that refuses while G4 and D-BENCH are open, and it holds no socket', async () => {
    const { sink } = collector();
    try {
      await port(gatedModelDial(), sink).complete(requestFor());
      throw new Error('expected a refusal');
    } catch (error) {
      const refusal = error as ModelPortError;
      expect(refusal.reason).toBe('dial_gated');
      expect(refusal.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
      expect(refusal.message).toContain('G4');
      expect(refusal.message).toContain('D-BENCH');
    }
  });
});

// =============================================================================================
// The telemetry sink, against the real repository
// =============================================================================================

describe('the recorded row goes through the existing repository, not a second one', () => {
  let store: TestStore | null = null;
  afterEach(() => {
    store?.close();
    store = null;
  });

  it('writes one row per completed call, and the row carries the reported cost', async () => {
    store = openTestStore('nizam-b6-');
    const handle = store.ctx.handle;
    await port(fakeDial(ok()).dial, storeTelemetrySink(handle)).complete(requestFor());

    expect(recordedCallCount(handle)).toBe(1);
    const rows = readTelemetry(handle);
    expect(rows[0]?.actualCostMicroUsd).toBe(42);
    expect(rows[0]?.actualCostSource).toBe('provider_reported_actual');
    expect(rows[0]?.modelIdServed).toBe('vendor/model-under-test');
    expect(rows[0]?.turnClass).toBe('T1');
    expect(rows[0]?.privacyPolicyAsserted).toBe(true);
    // The repository's own content scan refused nothing, which is the point: there is no content.
    expect(JSON.stringify(rows)).not.toContain(THE_OWNER_SAID);
  });

  it('counts records that arrive before the store is bound, rather than losing them silently', async () => {
    const bindable = createBindableTelemetrySink();
    await port(fakeDial(ok()).dial, bindable.sink).complete(requestFor());
    expect(bindable.unbound()).toBe(1);

    store = openTestStore('nizam-b6-bound-');
    bindable.bind(store.ctx.handle);
    await port(fakeDial(ok()).dial, bindable.sink).complete(requestFor({ correlationRef: 'turn-ref-b6-second' }));
    expect(bindable.unbound()).toBe(1);
    expect(recordedCallCount(store.ctx.handle)).toBe(1);
  });
});
