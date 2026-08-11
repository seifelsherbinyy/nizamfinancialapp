// @vitest-environment node
/**
 * NIZAM - PFOS benchmark harness (M2): the live adapter, exercised with NO network and NO key.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration) + steering §3 (the
 *   dev-key carve-out) and steering §2 (no outbound call from a server process).
 * Build phase: PFOS Stage 6 (two-agent VPS tier), phase 6.3 - the live path.
 * Depends on: ./liveModelCaller, ./dataset, ./runner, ./benchmark.types.
 *
 * Every test here supplies its own deterministic {@link LiveTransport}, which is a plain function over
 * in-memory strings. Nothing opens a socket, resolves a host, or reads `.secrets/`. That is not a
 * concession for testing - it is the module's actual shape, since the network capability is a parameter
 * rather than an import.
 *
 * The negative cases are the substance: a grant a server process cannot mint, a base URL that does not
 * resolve, a credential that cannot be printed, a provider failure that stops the run instead of
 * retrying, and a case with no answer that refuses instead of scoring as correct.
 */
import { describe, it, expect } from 'vitest';
import { buildEvalSet } from './dataset.ts';
import { MODEL_GLM, MODEL_GROK, MODEL_MIMO } from '../routing/modelPolicy.ts';
import type { BenchmarkCase } from './benchmark.types.ts';
import { decimalUsdToMicroUsd } from './providerResponseReader.ts';
import {
  assertsFabricatedNumber,
  DEVELOPER_MACHINE_INVOCATION,
  FABRICATION_SCAN_EXEMPT_KEYS,
  grantDeveloperMachineRun,
  isDeveloperMachineGrant,
  isLiveMeasurementWitness,
  liveModelCaller,
  liveRequestBody,
  LIVE_PRIVACY_POSTURE,
  LiveRunError,
  opaqueSecret,
  readLiveResponse,
  REDACTION_MARKER,
  resolveLiveRun,
  revealSecret,
  runLiveModelCalls,
  type DeveloperMachineGrant,
  type LiveHttpRequest,
  type LiveHttpResponse,
  type LiveModelExchange,
  type LiveRunConfig,
  type LiveRunEnvironment,
  type LiveTransport,
  type OpaqueSecret,
} from './liveModelCaller.ts';

// ---- fixtures: an environment, a config, and a transport, none of them real -------------------

const BASE_URL_REF = 'NIZAM_BENCH_MODEL_API_BASE';
const KEY_REF = 'NIZAM_BENCH_DEV_KEY';

/** A synthetic base URL. Not a provider endpoint: it is never dialled, only string-concatenated. */
const SYNTHETIC_BASE = 'stub-base';
/** Synthetic credential characters. Not a key, and never a plausible-looking one. */
const SYNTHETIC_CREDENTIAL = 'stub-credential';

const CONFIG: LiveRunConfig = Object.freeze({
  apiBaseUrlRef: BASE_URL_REF,
  apiKeyRef: KEY_REF,
  completionsPath: '/completions',
  maxOutputTokens: 64,
});

function environmentWith(entries: Record<string, string>): LiveRunEnvironment {
  return { resolve: (name) => entries[name] ?? null };
}

const FULL_ENVIRONMENT = environmentWith({
  [BASE_URL_REF]: SYNTHETIC_BASE,
  [KEY_REF]: SYNTHETIC_CREDENTIAL,
});

function grant(): DeveloperMachineGrant {
  return grantDeveloperMachineRun({
    invocation: DEVELOPER_MACHINE_INVOCATION,
    serverRuntimeMarker: null,
  });
}

/** A tiny eval set: three cases, one per shape the mapper has to handle. */
const CASES: BenchmarkCase[] = buildEvalSet().slice(0, 3);

interface StubOptions {
  readonly status?: number;
  readonly omitUsage?: boolean;
  readonly servedModelId?: string;
  readonly schemaValid?: boolean;
  readonly failOnCaseIndex?: number;
}

/**
 * A deterministic transport. It answers from the request body alone, records what it saw, and never
 * touches the network. `seenCredentials` exists so a test can prove the credential arrived beside the
 * request rather than inside it.
 */
function stubTransport(options: StubOptions = {}): {
  transport: LiveTransport;
  requests: LiveHttpRequest[];
  seenCredentials: OpaqueSecret[];
} {
  const requests: LiveHttpRequest[] = [];
  const seenCredentials: OpaqueSecret[] = [];
  let call = 0;
  const transport: LiveTransport = async (request, credential) => {
    requests.push(request);
    seenCredentials.push(credential);
    const index = call;
    call += 1;
    const failing = options.failOnCaseIndex === index;
    const parsedBody = JSON.parse(request.body) as { model: string };
    const response: LiveHttpResponse = {
      status: failing ? 429 : (options.status ?? 200),
      latencyMs: 11,
      bodyText: JSON.stringify({
        model: options.servedModelId ?? parsedBody.model,
        text: 'a stub completion',
        parsed: { confidenceBps: 9000 },
        schemaValid: options.schemaValid ?? true,
        ...(options.omitUsage === true
          ? {}
          : {
              usage: {
                promptTokens: 10,
                cachedTokens: 0,
                completionTokens: 5,
                reasoningTokens: 0,
                costMicroUsd: 7,
              },
            }),
      }),
    };
    return response;
  };
  return { transport, requests, seenCredentials };
}

// ---- the credential cannot be printed ---------------------------------------------------------

describe('a resolved credential cannot be printed by accident', () => {
  const secret = opaqueSecret(SYNTHETIC_CREDENTIAL);

  it('redacts under every route a log line takes', () => {
    expect(String(secret)).toBe(REDACTION_MARKER);
    expect(`${secret}`).toBe(REDACTION_MARKER);
    expect(JSON.stringify(secret)).toBe(JSON.stringify(REDACTION_MARKER));
    expect(JSON.stringify({ authorization: secret })).not.toContain(SYNTHETIC_CREDENTIAL);
    expect(secret.toString()).toBe(REDACTION_MARKER);
  });

  it('yields its characters only through the one named chokepoint', () => {
    expect(revealSecret(secret)).toBe(SYNTHETIC_CREDENTIAL);
  });

  it('refuses to reveal a value it did not wrap', () => {
    const forged = Object.freeze({
      toString: () => REDACTION_MARKER,
      toJSON: () => REDACTION_MARKER,
    }) as unknown as OpaqueSecret;
    try {
      revealSecret(forged);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(LiveRunError);
      expect((error as LiveRunError).code).toBe('LIVE_SECRET_NOT_WRAPPED');
    }
  });
});

// ---- the grant a server process cannot mint ---------------------------------------------------

describe('the developer-machine grant', () => {
  it('is minted for an explicit developer-machine invocation with no server marker', () => {
    const minted = grant();
    expect(isDeveloperMachineGrant(minted)).toBe(true);
  });

  it('REFUSES when a server-runtime marker is present (steering §2)', () => {
    try {
      grantDeveloperMachineRun({
        invocation: DEVELOPER_MACHINE_INVOCATION,
        serverRuntimeMarker: 'a-server-process',
      });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRunError).code).toBe('LIVE_GRANT_REFUSED_SERVER_RUNTIME');
    }
  });

  it('REFUSES an invocation it does not recognise', () => {
    try {
      grantDeveloperMachineRun({
        // A cast is the only way to express this, which is the point: it does not type check honestly.
        invocation: 'some_other_caller' as typeof DEVELOPER_MACHINE_INVOCATION,
        serverRuntimeMarker: null,
      });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRunError).code).toBe('LIVE_GRANT_INVOCATION_UNRECOGNISED');
    }
  });

  it('does not accept a forged grant, even though a cast produces one', () => {
    const forged = Object.freeze({}) as unknown as DeveloperMachineGrant;
    expect(isDeveloperMachineGrant(forged)).toBe(false);
    expect(() => resolveLiveRun(forged, FULL_ENVIRONMENT, CONFIG)).toThrow(LiveRunError);
  });
});

// ---- resolution is where the branch opens or closes -------------------------------------------

describe('resolving the endpoint and the credential', () => {
  it('joins the resolved base URL to the path, with no literal from source', () => {
    const resolved = resolveLiveRun(grant(), FULL_ENVIRONMENT, CONFIG);
    expect(resolved.url).toBe(`${SYNTHETIC_BASE}/completions`);
    expect(String(resolved.credential)).toBe(REDACTION_MARKER);
  });

  it('tolerates a trailing separator on the base URL and a path without a leading one', () => {
    const resolved = resolveLiveRun(
      grant(),
      environmentWith({ [BASE_URL_REF]: `${SYNTHETIC_BASE}/`, [KEY_REF]: SYNTHETIC_CREDENTIAL }),
      { ...CONFIG, completionsPath: 'completions' },
    );
    expect(resolved.url).toBe(`${SYNTHETIC_BASE}/completions`);
  });

  it('REFUSES when the base-URL entry is absent, because there is no default endpoint', () => {
    try {
      resolveLiveRun(grant(), environmentWith({ [KEY_REF]: SYNTHETIC_CREDENTIAL }), CONFIG);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRunError).code).toBe('LIVE_API_BASE_URL_UNRESOLVED');
      // The refusal names the ENTRY, never a value.
      expect((error as LiveRunError).detail.entryName).toBe(BASE_URL_REF);
    }
  });

  it('REFUSES when the credential entry is absent, so the fixture path stands (steering §3)', () => {
    try {
      resolveLiveRun(grant(), environmentWith({ [BASE_URL_REF]: SYNTHETIC_BASE }), CONFIG);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRunError).code).toBe('LIVE_API_KEY_UNRESOLVED');
      expect((error as LiveRunError).detail.entryName).toBe(KEY_REF);
    }
  });

  it('REFUSES an empty credential entry as firmly as an absent one', () => {
    expect(() =>
      resolveLiveRun(
        grant(),
        environmentWith({ [BASE_URL_REF]: SYNTHETIC_BASE, [KEY_REF]: '' }),
        CONFIG,
      ),
    ).toThrow(LiveRunError);
  });
});

// ---- the request body -------------------------------------------------------------------------

describe('the request body carries the privacy posture and never the credential', () => {
  it('asserts training excluded, collectors denied, and zero retention required', () => {
    const [first] = CASES;
    if (first === undefined) throw new Error('the eval set slice is empty');
    const body = JSON.parse(liveRequestBody(first, MODEL_MIMO, 64)) as Record<string, unknown>;
    expect(body.privacy).toEqual(LIVE_PRIVACY_POSTURE);
    expect(body.model).toBe(MODEL_MIMO);
    expect(body.max_tokens).toBe(64);
  });

  it('never contains the credential, because the credential is not one of its inputs', () => {
    const [first] = CASES;
    if (first === undefined) throw new Error('the eval set slice is empty');
    expect(liveRequestBody(first, MODEL_MIMO, 64)).not.toContain(SYNTHETIC_CREDENTIAL);
  });
});

// ---- reading a provider response --------------------------------------------------------------

describe('reading a provider response fails closed', () => {
  const [first] = CASES;
  if (first === undefined) throw new Error('the eval set slice is empty');

  function respond(overrides: Partial<LiveHttpResponse>): LiveHttpResponse {
    return {
      status: 200,
      latencyMs: 11,
      bodyText: JSON.stringify({
        model: MODEL_MIMO,
        text: '',
        parsed: {},
        schemaValid: true,
        usage: { promptTokens: 1, completionTokens: 1, costMicroUsd: 2 },
      }),
      ...overrides,
    };
  }

  it('accepts a well-formed response and takes the ACTUAL reported cost', () => {
    const exchange = readLiveResponse({
      benchmarkCase: first,
      modelIdRequested: MODEL_MIMO,
      response: respond({}),
    });
    expect(exchange.costMicroUsd).toBe(2);
    expect(exchange.latencyMs).toBe(11);
    expect(exchange.caseId).toBe(first.id);
  });

  it.each([400, 401, 402, 429, 500])('REFUSES status %i without retrying', (status) => {
    try {
      readLiveResponse({
        benchmarkCase: first,
        modelIdRequested: MODEL_MIMO,
        response: respond({ status }),
      });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRunError).code).toBe('LIVE_PROVIDER_STATUS_NOT_OK');
    }
  });

  it('REFUSES an unparseable body', () => {
    try {
      readLiveResponse({
        benchmarkCase: first,
        modelIdRequested: MODEL_MIMO,
        response: respond({ bodyText: 'not json' }),
      });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRunError).code).toBe('LIVE_PROVIDER_BODY_UNPARSEABLE');
    }
  });

  it('REFUSES an absent usage block, because an estimate is not an actual cost', () => {
    try {
      readLiveResponse({
        benchmarkCase: first,
        modelIdRequested: MODEL_MIMO,
        response: respond({ bodyText: JSON.stringify({ model: MODEL_MIMO, text: '' }) }),
      });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRunError).code).toBe('LIVE_PROVIDER_USAGE_ABSENT');
    }
  });

  it('REFUSES a non-integer reported cost', () => {
    try {
      readLiveResponse({
        benchmarkCase: first,
        modelIdRequested: MODEL_MIMO,
        response: respond({
          // A float provider cost is invalid: micro-USD is an integer unit. Must be rejected.
          bodyText: JSON.stringify({
            model: MODEL_MIMO,
            text: '',
            usage: { costMicroUsd: 1.5 },
          }),
        }),
      });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRunError).code).toBe('LIVE_PROVIDER_USAGE_ABSENT');
    }
  });

  it('REFUSES a substituted model, so an entry never names a model it did not grade', () => {
    try {
      readLiveResponse({
        benchmarkCase: first,
        modelIdRequested: MODEL_MIMO,
        response: respond({
          bodyText: JSON.stringify({
            model: MODEL_GLM,
            text: '',
            usage: { costMicroUsd: 2 },
          }),
        }),
      });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRunError).code).toBe('LIVE_PROVIDER_SERVED_ANOTHER_MODEL');
      expect((error as LiveRunError).detail.modelId).toBe(MODEL_MIMO);
    }
  });

  it('treats an unstated schema verdict as INVALID, not as valid', () => {
    const exchange = readLiveResponse({
      benchmarkCase: first,
      modelIdRequested: MODEL_MIMO,
      response: respond({
        bodyText: JSON.stringify({ model: MODEL_MIMO, text: '', usage: { costMicroUsd: 2 } }),
      }),
    });
    expect(exchange.schemaValid).toBe(false);
  });

  it('treats an out-of-range confidence as zero rather than trusting it', () => {
    const exchange = readLiveResponse({
      benchmarkCase: first,
      modelIdRequested: MODEL_MIMO,
      response: respond({
        bodyText: JSON.stringify({
          model: MODEL_MIMO,
          text: '',
          parsed: { confidenceBps: 99_999 },
          usage: { costMicroUsd: 2 },
        }),
      }),
    });
    expect(exchange.confidenceBps).toBe(0);
  });
});

// ---- the provider's ACTUAL usage shape ---------------------------------------------------------

/**
 * The provider reports `usage.cost` as a DECIMAL USD number beside snake_case token counts, and emits
 * no `usage.costMicroUsd` at all — measured against its own documentation (Usage Accounting: `"cost":
 * 0.95`, `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`,
 * `completion_tokens_details.reasoning_tokens`). Before this mapping existed the reader refused every
 * real answer at `usage.costMicroUsd`, so nothing downstream could run.
 *
 * The conversion is the money rule applied at the boundary, not excepted from: decimal in, integer
 * micro-USD out, once, with integer arithmetic and no float intermediate.
 */
describe('the provider reports decimal USD, and it becomes integer micro-USD at the boundary', () => {
  const [first] = CASES;
  if (first === undefined) throw new Error('the eval set slice is empty');
  const subject: BenchmarkCase = first;

  /** A response in the provider's OWN shape: decimal cost, snake_case counts, nested detail objects. */
  function providerShaped(usage: Record<string, unknown>): LiveHttpResponse {
    return {
      status: 200,
      latencyMs: 7,
      bodyText: JSON.stringify({ model: MODEL_MIMO, text: '', parsed: {}, schemaValid: true, usage }),
    };
  }

  function read(usage: Record<string, unknown>): LiveModelExchange {
    return readLiveResponse({
      benchmarkCase: subject,
      modelIdRequested: MODEL_MIMO,
      response: providerShaped(usage),
    });
  }

  function refusalCode(usage: Record<string, unknown>): string {
    try {
      read(usage);
      throw new Error('expected a refusal');
    } catch (error) {
      return (error as LiveRunError).code;
    }
  }

  it('maps a decimal cost to the right integer micro-USD', () => {
    // 0.95 USD is 950000 micro-USD, exactly.
    expect(read({ cost: 0.95 }).costMicroUsd).toBe(950_000);
    expect(read({ cost: 0.000321 }).costMicroUsd).toBe(321);
  });

  it('maps a whole-number cost', () => {
    expect(read({ cost: 2 }).costMicroUsd).toBe(2_000_000);
    expect(read({ cost: 0 }).costMicroUsd).toBe(0);
  });

  it('rounds UP a cost finer than one micro-USD, so a figure is never understated', () => {
    // Seven fractional digits: the seventh cannot be represented, so the figure rounds up.
    expect(read({ cost: 0.0000001 }).costMicroUsd).toBe(1);
    expect(read({ cost: 0.00000191 }).costMicroUsd).toBe(2);
    // Exponential notation is what `String(number)` yields below 1e-6, so this branch is real.
    expect(decimalUsdToMicroUsd(1.2e-7)).toBe(1);
    expect(decimalUsdToMicroUsd('1.9e-6')).toBe(2);
  });

  it('reads the snake_case token fields the provider actually sends', () => {
    const exchange = read({
      cost: 0.000042,
      prompt_tokens: 194,
      completion_tokens: 2,
      total_tokens: 196,
      prompt_tokens_details: { cached_tokens: 17, cache_write_tokens: 100 },
      completion_tokens_details: { reasoning_tokens: 5 },
    });
    expect(exchange.promptTokens).toBe(194);
    expect(exchange.completionTokens).toBe(2);
    expect(exchange.cachedTokens).toBe(17);
    expect(exchange.reasoningTokens).toBe(5);
    expect(exchange.costMicroUsd).toBe(42);
  });

  it('still accepts the integer spelling this reader already accepted', () => {
    const exchange = read({ costMicroUsd: 42, promptTokens: 11, completionTokens: 7 });
    expect(exchange.costMicroUsd).toBe(42);
    expect(exchange.promptTokens).toBe(11);
    expect(exchange.completionTokens).toBe(7);
  });

  it('REFUSES an absent cost rather than defaulting it to zero', () => {
    // A usage block with counts but no cost of any spelling. A zero here would silently claim a free
    // measurement, which is exactly the false statement contract 09's precedence forbids.
    expect(refusalCode({ prompt_tokens: 194, completion_tokens: 2 })).toBe('LIVE_PROVIDER_USAGE_ABSENT');
    expect(refusalCode({ cost: null })).toBe('LIVE_PROVIDER_USAGE_ABSENT');
  });

  it('REFUSES a negative, non-finite or unparseable cost', () => {
    for (const cost of [-0.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 'free', '', {}, []]) {
      expect(refusalCode({ cost })).toBe('LIVE_PROVIDER_USAGE_ABSENT');
    }
  });

  it('names the field it refused on, and nothing else', () => {
    try {
      read({ prompt_tokens: 1 });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRunError).detail.at).toBe('usage.cost');
      expect((error as LiveRunError).detail.caseId).toBe(first.id);
    }
  });

  it('converts with integer arithmetic: the result is always a safe integer', () => {
    for (const cost of [0, 1, 0.95, 0.000001, 0.0000004, 123.456789, '0.1', '1e-7']) {
      const microUsd = decimalUsdToMicroUsd(cost);
      expect(microUsd).not.toBeNull();
      expect(Number.isSafeInteger(microUsd)).toBe(true);
    }
    // A figure too large to be a safe integer of micro-USD refuses rather than losing precision.
    expect(decimalUsdToMicroUsd('1e30')).toBeNull();
  });
});

// ---- fabrication detection --------------------------------------------------------------------

describe('a number the input never supplied is a fabrication (contract 09 definition)', () => {
  const [first] = CASES;
  if (first === undefined) throw new Error('the eval set slice is empty');

  it('does not flag a response that asserts no number at all', () => {
    expect(assertsFabricatedNumber(first, 'no figures here', null)).toBe(false);
  });

  it('flags a digit run the case never contained', () => {
    expect(assertsFabricatedNumber(first, 'the total is 987654321', null)).toBe(true);
  });

  it('ignores grouping separators, so 1,234 and 1234 are the same number', () => {
    const supplied = { id: 'x', category: 'dedup', tier: 'T1', input: 'value 1234 seen' } as unknown as BenchmarkCase;
    const withExpected: BenchmarkCase = { ...supplied, expected: { kind: 'boolean', value: true } };
    expect(assertsFabricatedNumber(withExpected, 'value 1,234 seen', null)).toBe(false);
  });

  it('checks the structured answer too, not only the free text', () => {
    expect(assertsFabricatedNumber(first, '', { total: 987654321 })).toBe(true);
  });

  // The regression this list exists for. Before the exemption, a calibrated response was flagged as a
  // fabricator on every case, which turned a perfect run into a total failure in every P0 category.
  it('does not flag confidenceBps, whose digits come from a fixed scale and not from the case', () => {
    expect(FABRICATION_SCAN_EXEMPT_KEYS).toContain('confidenceBps');
    expect(assertsFabricatedNumber(first, '', { confidenceBps: 9800 })).toBe(false);
  });

  it('does not flag a digit inside a cited evidence key, which is an identifier and not a figure', () => {
    expect(assertsFabricatedNumber(first, '', { citedEvidence: ['safe_to_spend_v2'] })).toBe(false);
  });

  it('DOES still flag a tool argument, because a tool argument can carry an invented figure', () => {
    expect(
      assertsFabricatedNumber(first, '', {
        toolCalls: [{ name: 'record', args: { amountMilli: 987654321 } }],
      }),
    ).toBe(true);
  });
});

// ---- the whole run, end to end, with no network -----------------------------------------------

describe('a complete live run over a stub transport', () => {
  it('calls once per case, in eval-set order, and mints a witness', async () => {
    const { transport, requests, seenCredentials } = stubTransport();
    const resolved = resolveLiveRun(grant(), FULL_ENVIRONMENT, CONFIG);
    const run = await runLiveModelCalls({
      grant: grant(),
      transport,
      resolved,
      modelId: MODEL_MIMO,
      cases: CASES,
      maxOutputTokens: 64,
    });

    expect(requests).toHaveLength(CASES.length);
    expect(run.exchanges.map((exchange) => exchange.caseId)).toEqual(CASES.map((c) => c.id));
    expect(isLiveMeasurementWitness(run.witness)).toBe(true);
    expect(run.witness.modelId).toBe(MODEL_MIMO);
    expect(run.witness.casesAnswered).toBe(CASES.length);
    // Provider accounting: three cases at 7 micro-USD each, summed as integers.
    expect(run.witness.actualCostMicroUsd).toBe(7 * CASES.length);

    // The credential travelled BESIDE the request, and no request body or URL holds it.
    expect(seenCredentials).toHaveLength(CASES.length);
    for (const request of requests) {
      expect(request.body).not.toContain(SYNTHETIC_CREDENTIAL);
      expect(request.url).not.toContain(SYNTHETIC_CREDENTIAL);
      expect(JSON.stringify(request)).not.toContain(SYNTHETIC_CREDENTIAL);
    }
  });

  it('STOPS at the first provider failure rather than retrying in a loop', async () => {
    const { transport, requests } = stubTransport({ failOnCaseIndex: 1 });
    const resolved = resolveLiveRun(grant(), FULL_ENVIRONMENT, CONFIG);
    await expect(
      runLiveModelCalls({
        grant: grant(),
        transport,
        resolved,
        modelId: MODEL_MIMO,
        cases: CASES,
        maxOutputTokens: 64,
      }),
    ).rejects.toBeInstanceOf(LiveRunError);
    // Two calls attempted, then a stop. The third case was never dialled.
    expect(requests).toHaveLength(2);
  });

  it('REFUSES to dial at all without a minted grant', async () => {
    const { transport, requests } = stubTransport();
    const resolved = resolveLiveRun(grant(), FULL_ENVIRONMENT, CONFIG);
    const forged = Object.freeze({}) as unknown as DeveloperMachineGrant;
    await expect(
      runLiveModelCalls({
        grant: forged,
        transport,
        resolved,
        modelId: MODEL_MIMO,
        cases: CASES,
        maxOutputTokens: 64,
      }),
    ).rejects.toBeInstanceOf(LiveRunError);
    expect(requests).toHaveLength(0);
  });

  it('REFUSES to dial a premium model, even with a valid grant (K4)', async () => {
    const { transport, requests } = stubTransport();
    const resolved = resolveLiveRun(grant(), FULL_ENVIRONMENT, CONFIG);
    await expect(
      runLiveModelCalls({
        grant: grant(),
        transport,
        resolved,
        modelId: MODEL_GROK,
        cases: CASES,
        maxOutputTokens: 64,
      }),
    ).rejects.toThrow(/default-allowed/);
    expect(requests).toHaveLength(0);
  });

  it('does not mint a witness for a run that failed', async () => {
    const { transport } = stubTransport({ failOnCaseIndex: 0 });
    const resolved = resolveLiveRun(grant(), FULL_ENVIRONMENT, CONFIG);
    const outcome = await runLiveModelCalls({
      grant: grant(),
      transport,
      resolved,
      modelId: MODEL_MIMO,
      cases: CASES,
      maxOutputTokens: 64,
    }).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(LiveRunError);
  });
});

// ---- grading: no correct-answer baseline anywhere -------------------------------------------

describe('grading a live run never falls back to the correct answer', () => {
  const exchange = (caseId: string): LiveModelExchange =>
    Object.freeze({
      caseId,
      modelIdRequested: MODEL_MIMO,
      modelIdServed: MODEL_MIMO,
      text: 'a stub completion',
      parsed: { confidenceBps: 9000 },
      schemaValid: true,
      promptTokens: 10,
      cachedTokens: 0,
      completionTokens: 5,
      reasoningTokens: 0,
      costMicroUsd: 7,
      latencyMs: 11,
      confidenceBps: 9000,
    });

  it('answers a case it has an exchange for', () => {
    const [first] = CASES;
    if (first === undefined) throw new Error('the eval set slice is empty');
    const caller = liveModelCaller(MODEL_MIMO, [exchange(first.id)]);
    const response = caller(first);
    expect(response.text).toBe('a stub completion');
    expect(response.schemaValid).toBe(true);
    expect(response.confidenceBps).toBe(9000);
    // Contract 09's USD field stays zero: the actual cost is integer micro-USD on the exchange and is
    // never converted into the USD unit.
    expect(response.usage.costUsd).toBe(0);
  });

  it('REFUSES a case with no live answer, instead of scoring it as correct', () => {
    const [first, second] = CASES;
    if (first === undefined || second === undefined) throw new Error('need two cases');
    const caller = liveModelCaller(MODEL_MIMO, [exchange(first.id)]);
    try {
      caller(second);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRunError).code).toBe('LIVE_CASE_HAS_NO_EXCHANGE');
      expect((error as LiveRunError).detail.caseId).toBe(second.id);
    }
  });

  it('ignores an exchange recorded against another model', () => {
    const [first] = CASES;
    if (first === undefined) throw new Error('the eval set slice is empty');
    const foreign: LiveModelExchange = { ...exchange(first.id), modelIdRequested: MODEL_GLM };
    const caller = liveModelCaller(MODEL_MIMO, [foreign]);
    expect(() => caller(first)).toThrow(LiveRunError);
  });
});
