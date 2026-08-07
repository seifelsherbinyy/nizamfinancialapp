/**
 * NIZAM · Fixture replay — a recorded exchange answers a benchmark case, and no provider does
 * Implemented by: PFOS Contract 12 / Phase 6.2 (spec 06-two-agent-vps)
 * Owning requirements: R18 (a `provisional` registry does not permit live routing); R24 (no
 *   deployment particular in a tracked file); steering §3 (fixture-backed run when the dev key is
 *   absent or exhausted)
 * Depends on: ../mocks/fixtures (the ONE recorded-fixture loader), ../mocks/openrouterMock (the
 *   `RecordedModelExchange` shape), ../../features/benchmark/* (contract 09's harness)
 *
 * NO NETWORK. NO KEY. This module is the fixture half of steering §3 — the half that runs when the
 * development key is absent or exhausted. It resolves no path, opens no socket, reads no environment
 * entry, and never touches `.secrets/`. The single permitted live call belongs to phase 6.3.
 *
 * ## What a recorded exchange is, and what it is not
 *
 * Phase 2.2 already defines the recorded-exchange vocabulary (`RecordedModelExchange`) and the one
 * loader that validates it (`loadRecordedInteractions`). This module adds no second loader and no
 * second document format. It adds one thing: how a `RecordedModelExchange` becomes the
 * `ModelResponse` that contract 09's scorer grades.
 *
 * The mapping is a DIFFERENCE from the correct answer, and that is a deliberate, load-bearing choice:
 *
 *  - The baseline is `mockCaller`, which derives a fully correct response from the case's own
 *    `expected` answer. A recorded exchange then overrides the fields it states.
 *  - So a recording says "here is where this model's answer differed", which keeps the fixture short,
 *    readable and reviewable, and — the reason that matters for a PUBLIC repository — keeps owner
 *    figures out of it. A fixture that restated every field of every extraction case would carry
 *    hundreds of amounts, and the loader's deployment-particular scan would (correctly) refuse it.
 *  - The cost of that choice is stated plainly: **a case with no recorded exchange is graded
 *    correct.** That is a scaffold, not a measurement, which is precisely why the registry this feeds
 *    is marked `provisional: true` and may never promote a model (contract 12 §6.3, steering §3).
 *
 * To stop that cost from becoming a silent fabricated pass, every reference a fixture states is
 * checked and every failure is FAIL-CLOSED with its own code: a malformed reference, a model the run
 * did not ask for, a case the eval set does not contain, a repeated exchange, and a reserved field of
 * the wrong type all refuse the whole run. {@link replayCoverage} additionally refuses a run in which
 * a graded model was replayed against **no** recording at all, because such a model would score
 * perfectly without a single recorded response behind it.
 *
 * ## The structured-response convention
 *
 * `RecordedModelExchange.parsed` is the model's structured output. Three of its keys are reserved,
 * because they are response-level facts rather than parts of the graded answer, and each is something
 * a structured response can legitimately state: `refused`, `citedEvidence`, `toolCalls`. Everything
 * else is merged over the correct structured answer.
 *
 * `fabricatedNumber` is deliberately NOT recordable. It is a grader's judgement about a response, not
 * a field a response reports, and a fixture that could assert it would be asserting the grade rather
 * than the answer. So a fixture-backed run cannot exercise the fabrication branch; that branch is
 * covered by the scorer's own tests.
 *
 * Money: nothing here converts a unit. Provider cost stays the integer micro-USD the recording holds
 * and is summed with integer arithmetic in {@link replayCoverage}; contract 09's own pricing-derived
 * `TokenUsage.costUsd` is left exactly as the harness computed it, so no figure is divided, rounded,
 * or re-expressed anywhere in this file. Owner money (integer milliunits, `src/lib/money`) does not
 * appear at all.
 */
import type { BenchmarkCase, ModelResponse } from '../../features/benchmark/benchmark.types';
import { configurableCaller, type ModelCaller } from '../../features/benchmark/runner';
import type { RecordedModelExchange } from '../mocks/fixtures';

/** The reference form a benchmark recording uses: `bench:<modelId>:<caseId>`. */
export const BENCHMARK_CORRELATION_PREFIX = 'bench:';

/**
 * Response-level keys a recorded `parsed` object may carry. They are lifted onto the
 * {@link ModelResponse} instead of being merged into the graded structured answer.
 */
export const RESERVED_RESPONSE_KEYS = ['refused', 'citedEvidence', 'toolCalls'] as const;
export type ReservedResponseKey = (typeof RESERVED_RESPONSE_KEYS)[number];

/** Why a replay was refused. A caller discriminates on `code`, never on a message. */
export const BENCHMARK_REPLAY_ERROR_CODES = [
  'REPLAY_CORRELATION_REF_MALFORMED',
  'REPLAY_MODEL_NOT_IN_RUN',
  'REPLAY_CASE_NOT_IN_EVAL_SET',
  'REPLAY_DUPLICATE_EXCHANGE',
  'REPLAY_RESERVED_FIELD_INVALID',
  'REPLAY_MODEL_HAS_NO_RECORDED_EXCHANGE',
] as const;
export type BenchmarkReplayErrorCode = (typeof BENCHMARK_REPLAY_ERROR_CODES)[number];

/**
 * A refused replay. `detail` holds references and enum values only — never a recorded completion,
 * never a prompt, never a figure (contract 12 §6.4, R19).
 */
export class BenchmarkReplayError extends Error {
  readonly code: BenchmarkReplayErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(
    code: BenchmarkReplayErrorCode,
    message: string,
    detail: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'BenchmarkReplayError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/** Build the correlation reference for one model answering one case. */
export function benchmarkCorrelationRef(modelId: string, caseId: string): string {
  return `${BENCHMARK_CORRELATION_PREFIX}${modelId}:${caseId}`;
}

/** A recorded exchange resolved to the model and case it answers. */
export interface ResolvedRecording {
  readonly modelId: string;
  readonly caseId: string;
  readonly exchange: RecordedModelExchange;
}

function refuse(code: BenchmarkReplayErrorCode, why: string, detail: Record<string, string>): never {
  throw new BenchmarkReplayError(code, `NIZAM benchmark replay: ${why}`, detail);
}

/**
 * Split the benchmark-prefixed exchanges out of a fixture and resolve each to its model and case.
 *
 * An exchange WITHOUT the prefix is left alone: one fixture document may serve several boundaries at
 * once (the Phase 2.2 smoke fixture already does), so a port-level exchange is not this module's
 * business. An exchange WITH the prefix is fully checked, because a typo inside a benchmark reference
 * is the failure that would otherwise grade a model against nothing and call the result a pass.
 */
export function resolveRecordings(
  exchanges: readonly RecordedModelExchange[],
  runModelIds: readonly string[],
  evalSet: readonly BenchmarkCase[],
): readonly ResolvedRecording[] {
  const knownCaseIds = new Set(evalSet.map((c) => c.id));
  const knownModelIds = new Set(runModelIds);
  const seen = new Set<string>();
  const resolved: ResolvedRecording[] = [];

  for (const exchange of exchanges) {
    const ref = exchange.correlationRef;
    if (!ref.startsWith(BENCHMARK_CORRELATION_PREFIX)) continue;

    const rest = ref.slice(BENCHMARK_CORRELATION_PREFIX.length);
    const parts = rest.split(':');
    if (parts.length !== 2) {
      refuse(
        'REPLAY_CORRELATION_REF_MALFORMED',
        `a benchmark correlation reference must read "${BENCHMARK_CORRELATION_PREFIX}<modelId>:<caseId>"`,
        { at: 'correlationRef', segments: String(parts.length) },
      );
    }
    const modelId = parts[0] ?? '';
    const caseId = parts[1] ?? '';
    if (modelId.length === 0 || caseId.length === 0) {
      refuse('REPLAY_CORRELATION_REF_MALFORMED', 'both the model and the case segment must be present', {
        at: 'correlationRef',
      });
    }
    if (!knownModelIds.has(modelId)) {
      // Fail closed rather than ignore: an unrecognised model segment means the recording this
      // fixture intended to apply was applied to nothing, and the model it was meant for would then
      // be graded from the correct baseline alone.
      refuse('REPLAY_MODEL_NOT_IN_RUN', 'the recording names a model this run does not grade', {
        at: 'correlationRef.modelId',
        modelId,
      });
    }
    if (!knownCaseIds.has(caseId)) {
      refuse('REPLAY_CASE_NOT_IN_EVAL_SET', 'the recording names a case the eval set does not contain', {
        at: 'correlationRef.caseId',
        caseId,
      });
    }
    if (seen.has(ref)) {
      refuse('REPLAY_DUPLICATE_EXCHANGE', 'two recordings answer the same model and case', {
        at: 'correlationRef',
        caseId,
        modelId,
      });
    }
    seen.add(ref);
    resolved.push({ modelId, caseId, exchange });
  }

  return Object.freeze(resolved);
}

function requireBooleanField(value: unknown, key: ReservedResponseKey): boolean {
  if (typeof value !== 'boolean') {
    refuse('REPLAY_RESERVED_FIELD_INVALID', `"${key}" must be a boolean`, { at: `parsed.${key}` });
  }
  return value;
}

function requireStringArrayField(value: unknown, key: ReservedResponseKey): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    refuse('REPLAY_RESERVED_FIELD_INVALID', `"${key}" must be an array of strings`, {
      at: `parsed.${key}`,
    });
  }
  return [...(value as string[])];
}

function requireToolCallsField(value: unknown): { name: string; args: Record<string, unknown> }[] {
  if (!Array.isArray(value)) {
    refuse('REPLAY_RESERVED_FIELD_INVALID', '"toolCalls" must be an array', { at: 'parsed.toolCalls' });
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      refuse('REPLAY_RESERVED_FIELD_INVALID', 'each tool call must be an object', {
        at: `parsed.toolCalls[${index}]`,
      });
    }
    const record = entry as Record<string, unknown>;
    const name = record.name;
    if (typeof name !== 'string' || name.length === 0) {
      refuse('REPLAY_RESERVED_FIELD_INVALID', 'a tool call must name a tool', {
        at: `parsed.toolCalls[${index}].name`,
      });
    }
    const args = record.args;
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      refuse('REPLAY_RESERVED_FIELD_INVALID', 'a tool call must carry an argument object', {
        at: `parsed.toolCalls[${index}].args`,
      });
    }
    return { name, args: { ...(args as Record<string, unknown>) } };
  });
}

/**
 * Fold one recorded exchange onto the correct baseline response. Fields the recording does not state
 * are the baseline's, which is what makes a recording a readable statement of what differed.
 *
 * `usage` is intentionally the baseline's, not the recording's: contract 09's `TokenUsage.costUsd` is
 * a pricing-derived USD figure and the recording's `costMicroUsd` is provider accounting in integer
 * micro-USD. Converting between them would be a unit change on a cost figure, so instead the recorded
 * provider cost is reported in its own unit by {@link replayCoverage} and never mixed in here.
 */
export function applyRecording(base: ModelResponse, exchange: RecordedModelExchange): ModelResponse {
  const graded: Record<string, unknown> = { ...(base.parsed ?? {}) };
  let refused = base.refused;
  let citedEvidence = base.citedEvidence;
  let toolCalls = base.toolCalls;

  for (const [key, value] of Object.entries(exchange.parsed ?? {})) {
    if (key === 'refused') {
      refused = requireBooleanField(value, 'refused');
      continue;
    }
    if (key === 'citedEvidence') {
      citedEvidence = requireStringArrayField(value, 'citedEvidence');
      continue;
    }
    if (key === 'toolCalls') {
      toolCalls = requireToolCallsField(value);
      continue;
    }
    graded[key] = value;
  }

  return {
    ...base,
    // Untrusted data. A recorded completion is a value that was observed, never an instruction.
    text: exchange.text,
    parsed: Object.keys(graded).length === 0 ? null : graded,
    refused,
    citedEvidence,
    toolCalls,
    schemaValid: exchange.schemaValid,
    latencyMs: exchange.latencyMs,
  };
}

/**
 * A {@link ModelCaller} that answers from recorded exchanges, falling back to the correct baseline
 * for a case the fixture did not record. This is the injected port contract 09's runner already
 * expects; no live adapter is involved, and none is reachable from here.
 */
export function fixtureModelCaller(
  modelId: string,
  recordings: readonly ResolvedRecording[],
): ModelCaller {
  const byCaseId = new Map<string, RecordedModelExchange>();
  for (const recording of recordings) {
    if (recording.modelId === modelId) byCaseId.set(recording.caseId, recording.exchange);
  }
  return configurableCaller(modelId, (benchmarkCase, base) => {
    const exchange = byCaseId.get(benchmarkCase.id);
    return exchange === undefined ? base : applyRecording(base, exchange);
  });
}

/** How much of one model's run came from a recording, in the units each figure is kept in. */
export interface ModelReplayCoverage {
  readonly modelId: string;
  readonly evalSetCases: number;
  readonly recordedCases: number;
  /** Provider accounting, integer micro-USD. Never owner money and never converted. */
  readonly recordedProviderCostMicroUsd: number;
}

/**
 * Summarize coverage per model, and REFUSE a run in which a graded model has no recording at all.
 *
 * That refusal is the point of this function. Without it, adding a model to the run and forgetting to
 * record anything for it would produce a flawless verdict from the correct baseline — a fabricated
 * pass, and exactly the "promoted from benchmark reputation alone" outcome contract 09's exit
 * criteria forbid. The refusal does not make a constructed recording into a measurement; it only
 * guarantees that every graded model was actually replayed against something.
 */
export function replayCoverage(
  runModelIds: readonly string[],
  recordings: readonly ResolvedRecording[],
  evalSet: readonly BenchmarkCase[],
): readonly ModelReplayCoverage[] {
  return Object.freeze(
    runModelIds.map((modelId) => {
      const mine = recordings.filter((recording) => recording.modelId === modelId);
      if (mine.length === 0) {
        refuse(
          'REPLAY_MODEL_HAS_NO_RECORDED_EXCHANGE',
          'the model would be graded entirely from the correct baseline, which is a fabricated pass rather than a replay',
          { modelId },
        );
      }
      let recordedProviderCostMicroUsd = 0;
      for (const recording of mine) recordedProviderCostMicroUsd += recording.exchange.costMicroUsd;
      return Object.freeze({
        modelId,
        evalSetCases: evalSet.length,
        recordedCases: mine.length,
        recordedProviderCostMicroUsd,
      });
    }),
  );
}
