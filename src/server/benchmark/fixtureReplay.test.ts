/**
 * NIZAM · Fixture replay — every refusal fires, and no provider is reachable
 * Implemented by: PFOS Contract 12 / Phase 6.2 (spec 06-two-agent-vps)
 * Owning requirements: R18 (a `provisional` registry does not permit live routing); steering §3
 * Depends on: ./fixtureReplay, ../mocks/fixtures, ../../features/benchmark/*
 *
 * NO NETWORK. Every case here replays a recorded exchange or refuses.
 */
import { describe, it, expect } from 'vitest';
import { buildEvalSet } from '../../features/benchmark/dataset';
import { mockCaller } from '../../features/benchmark/runner';
import type { RecordedModelExchange } from '../mocks/fixtures';
import {
  BENCHMARK_REPLAY_ERROR_CODES,
  BenchmarkReplayError,
  applyRecording,
  benchmarkCorrelationRef,
  fixtureModelCaller,
  replayCoverage,
  resolveRecordings,
} from './fixtureReplay';

const MODEL_A = 'xiaomi/mimo-v2.5';
const MODEL_B = 'z-ai/glm-5.2';
const evalSet = buildEvalSet();
const firstSms = evalSet.find((c) => c.category === 'sms_extraction')!;
const firstAdversarial = evalSet.find((c) => c.category === 'adversarial')!;
const firstTool = evalSet.find((c) => c.category === 'tool_call')!;
const firstExplanation = evalSet.find((c) => c.category === 'safe_to_spend_explanation')!;

function exchange(overrides: Partial<RecordedModelExchange> & { correlationRef: string }): RecordedModelExchange {
  return {
    modelIdServed: MODEL_A,
    text: 'synthetic recorded completion',
    parsed: null,
    schemaValid: true,
    promptTokens: 40,
    cachedTokens: 0,
    completionTokens: 20,
    reasoningTokens: 0,
    costMicroUsd: 17,
    latencyMs: 200,
    ...overrides,
  };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof BenchmarkReplayError) return error.code;
    throw error;
  }
  throw new Error('expected a BenchmarkReplayError, but the call succeeded');
}

describe('resolveRecordings', () => {
  it('resolves a well-formed benchmark reference to its model and case', () => {
    const resolved = resolveRecordings(
      [exchange({ correlationRef: benchmarkCorrelationRef(MODEL_A, firstSms.id) })],
      [MODEL_A],
      evalSet,
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.modelId).toBe(MODEL_A);
    expect(resolved[0]!.caseId).toBe(firstSms.id);
  });

  it('leaves a non-benchmark exchange alone, so one fixture may serve several boundaries', () => {
    const resolved = resolveRecordings(
      [exchange({ correlationRef: 'corr-port-level-exchange' })],
      [MODEL_A],
      evalSet,
    );
    expect(resolved).toHaveLength(0);
  });

  // NEGATIVE: a malformed reference must refuse rather than be skipped, because a skipped
  // recording grades the model from the correct baseline and calls the result a pass.
  it('refuses a reference with the wrong number of segments', () => {
    expect(codeOf(() => resolveRecordings([exchange({ correlationRef: 'bench:only-one-segment' })], [MODEL_A], evalSet))).toBe(
      'REPLAY_CORRELATION_REF_MALFORMED',
    );
  });

  it('refuses a reference with an empty segment', () => {
    expect(codeOf(() => resolveRecordings([exchange({ correlationRef: 'bench::' + firstSms.id })], [MODEL_A], evalSet))).toBe(
      'REPLAY_CORRELATION_REF_MALFORMED',
    );
  });

  it('refuses a recording naming a model this run does not grade', () => {
    expect(
      codeOf(() =>
        resolveRecordings([exchange({ correlationRef: benchmarkCorrelationRef(MODEL_B, firstSms.id) })], [MODEL_A], evalSet),
      ),
    ).toBe('REPLAY_MODEL_NOT_IN_RUN');
  });

  it('refuses a recording naming a case the eval set does not contain', () => {
    expect(
      codeOf(() =>
        resolveRecordings([exchange({ correlationRef: benchmarkCorrelationRef(MODEL_A, 'no_such_case') })], [MODEL_A], evalSet),
      ),
    ).toBe('REPLAY_CASE_NOT_IN_EVAL_SET');
  });

  it('refuses two recordings answering the same model and case', () => {
    const ref = benchmarkCorrelationRef(MODEL_A, firstSms.id);
    expect(codeOf(() => resolveRecordings([exchange({ correlationRef: ref }), exchange({ correlationRef: ref })], [MODEL_A], evalSet))).toBe(
      'REPLAY_DUPLICATE_EXCHANGE',
    );
  });

  it('declares one error code per refusal, and every one is exercised here', () => {
    expect(BENCHMARK_REPLAY_ERROR_CODES).toHaveLength(6);
  });
});

describe('applyRecording', () => {
  const base = mockCaller(MODEL_A)(firstAdversarial);

  it('overrides the recorded response-level fields and keeps the rest of the baseline', () => {
    const applied = applyRecording(base, exchange({ correlationRef: 'x', text: 'recorded text', latencyMs: 411 }));
    expect(applied.text).toBe('recorded text');
    expect(applied.latencyMs).toBe(411);
    expect(applied.refused).toBe(base.refused);
    // `usage` stays the harness's pricing-derived figure; the recording's micro-USD is never mixed in.
    expect(applied.usage).toEqual(base.usage);
  });

  it('lifts a recorded refusal onto the response rather than into the graded answer', () => {
    const applied = applyRecording(base, exchange({ correlationRef: 'x', parsed: { refused: false } }));
    expect(applied.refused).toBe(false);
    expect(applied.parsed).toBeNull();
  });

  it('lifts recorded cited evidence and tool calls', () => {
    const explanationBase = mockCaller(MODEL_A)(firstExplanation);
    const applied = applyRecording(
      explanationBase,
      exchange({ correlationRef: 'x', parsed: { citedEvidence: ['safeToSpend'] } }),
    );
    expect(applied.citedEvidence).toEqual(['safeToSpend']);

    const toolBase = mockCaller(MODEL_A)(firstTool);
    const withTool = applyRecording(
      toolBase,
      exchange({ correlationRef: 'x', parsed: { toolCalls: [{ name: 'wrong_tool', args: {} }] } }),
    );
    expect(withTool.toolCalls).toEqual([{ name: 'wrong_tool', args: {} }]);
  });

  it('merges a non-reserved recorded field over the correct structured answer', () => {
    const smsBase = mockCaller(MODEL_A)(firstSms);
    const applied = applyRecording(smsBase, exchange({ correlationRef: 'x', parsed: { amountMilli: 0 } }));
    expect(applied.parsed?.amountMilli).toBe(0);
  });

  // NEGATIVE: a reserved field of the wrong type refuses, so a fixture cannot half-state a response.
  it('refuses a reserved field of the wrong type', () => {
    expect(codeOf(() => applyRecording(base, exchange({ correlationRef: 'x', parsed: { refused: 'no' } })))).toBe(
      'REPLAY_RESERVED_FIELD_INVALID',
    );
    expect(codeOf(() => applyRecording(base, exchange({ correlationRef: 'x', parsed: { citedEvidence: [7] } })))).toBe(
      'REPLAY_RESERVED_FIELD_INVALID',
    );
    expect(codeOf(() => applyRecording(base, exchange({ correlationRef: 'x', parsed: { toolCalls: 'get_forecast' } })))).toBe(
      'REPLAY_RESERVED_FIELD_INVALID',
    );
    expect(
      codeOf(() => applyRecording(base, exchange({ correlationRef: 'x', parsed: { toolCalls: [{ args: {} }] } }))),
    ).toBe('REPLAY_RESERVED_FIELD_INVALID');
    expect(
      codeOf(() => applyRecording(base, exchange({ correlationRef: 'x', parsed: { toolCalls: [{ name: 'a', args: 1 }] } }))),
    ).toBe('REPLAY_RESERVED_FIELD_INVALID');
  });
});

describe('fixtureModelCaller', () => {
  const recordings = resolveRecordings(
    [
      exchange({ correlationRef: benchmarkCorrelationRef(MODEL_A, firstSms.id), text: 'model A recorded' }),
      exchange({ correlationRef: benchmarkCorrelationRef(MODEL_B, firstSms.id), text: 'model B recorded' }),
    ],
    [MODEL_A, MODEL_B],
    evalSet,
  );

  it('answers from the recording for the model it was built for, and only that model', () => {
    expect(fixtureModelCaller(MODEL_A, recordings)(firstSms).text).toBe('model A recorded');
    expect(fixtureModelCaller(MODEL_B, recordings)(firstSms).text).toBe('model B recorded');
  });

  it('falls back to the correct baseline for an unrecorded case, which is why the registry is provisional', () => {
    const answer = fixtureModelCaller(MODEL_A, recordings)(firstAdversarial);
    expect(answer.refused).toBe(true);
  });
});

describe('replayCoverage', () => {
  it('reports recorded case counts and sums provider cost in integer micro-USD', () => {
    const recordings = resolveRecordings(
      [
        exchange({ correlationRef: benchmarkCorrelationRef(MODEL_A, firstSms.id), costMicroUsd: 11 }),
        exchange({ correlationRef: benchmarkCorrelationRef(MODEL_A, firstTool.id), costMicroUsd: 13 }),
      ],
      [MODEL_A],
      evalSet,
    );
    const [coverage] = replayCoverage([MODEL_A], recordings, evalSet);
    expect(coverage!.recordedCases).toBe(2);
    expect(coverage!.evalSetCases).toBe(evalSet.length);
    expect(coverage!.recordedProviderCostMicroUsd).toBe(24);
    expect(Number.isInteger(coverage!.recordedProviderCostMicroUsd)).toBe(true);
  });

  // NEGATIVE: the fabricated-pass guard. A graded model with no recording would score perfectly
  // from the correct baseline, which is promotion from nothing.
  it('refuses a graded model that was replayed against no recording at all', () => {
    const recordings = resolveRecordings(
      [exchange({ correlationRef: benchmarkCorrelationRef(MODEL_A, firstSms.id) })],
      [MODEL_A, MODEL_B],
      evalSet,
    );
    expect(codeOf(() => replayCoverage([MODEL_A, MODEL_B], recordings, evalSet))).toBe(
      'REPLAY_MODEL_HAS_NO_RECORDED_EXCHANGE',
    );
  });

  it('carries no prompt, completion or figure in a refusal detail', () => {
    try {
      replayCoverage([MODEL_B], [], evalSet);
      throw new Error('expected a refusal');
    } catch (error) {
      const failure = error as BenchmarkReplayError;
      expect(Object.keys(failure.detail)).toEqual(['modelId']);
    }
  });
});
