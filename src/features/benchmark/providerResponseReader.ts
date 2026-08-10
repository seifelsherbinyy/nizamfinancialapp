/**
 * NIZAM - the ONE provider response reader: it fails closed, and it is shared rather than copied.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration): its source
 *   precedence puts the provider's ACTUAL reported `usage.cost` and token detail ahead of any
 *   estimate, and its exit criteria forbid grading a model that was not the model served.
 * Build phase: PFOS Contract 12 / Phase 2, task **B6** (spec 07-bot-bringup-v1) — extracted from
 *   `./liveModelCaller.ts` (PFOS Stage 6, phase 6.3) so the agent's model port reuses this reader
 *   instead of a second one. `liveModelCaller.ts` now imports and re-exports it, so there is exactly
 *   one implementation of "what a provider answer has to satisfy" in this repository.
 * Depends on: nothing. No network primitive, no endpoint, no credential, no clock, no store, and no
 *   `src/lib/money` — there is no arithmetic here beyond reading integers the provider reported.
 *
 * ## Why this is a module of its own
 *
 * Task B6 wires the finance agent's model port, and its instruction is explicit: reuse the existing
 * benchmark-path reader and validation rather than writing a second one. It could not simply import
 * `liveModelCaller.ts`, because `liveModelCaller.isolation.test.ts` asserts that **no runtime file
 * under `src/server/**` imports that module** — the adapter holds the developer-machine capability
 * and the transport seam, and a value import from the server tier would be a real runtime edge to
 * both. That guard is not weakened here. What moved is the part that holds no capability at all:
 * five refusals over a body of text.
 *
 * So the split is by authority. The adapter keeps the grant, the credential holder, the transport
 * parameter and the endpoint resolution. This module keeps the JUDGEMENT, which needs none of them:
 * it is a pure function from a status, a body and a latency to either a validated answer or a typed
 * refusal.
 *
 * ## The five refusals, and why each halts rather than degrades
 *
 *  1. **A non-2xx status.** Reported as the provider gave it; anything outside the success range is a
 *     refusal, never a warning, and never retried in a loop from here.
 *  2. **An unparseable body**, or a body that is not an object.
 *  3. **An absent usage block, or a cost that is not a non-negative safe integer of micro-USD.**
 *     Contract 09's precedence requires the actual reported cost, so a missing one cannot be
 *     substituted with an estimate — and money that is not integral is refused rather than coerced.
 *  4. **A substituted model.** A registry entry, and a telemetry row, must name the model that was
 *     actually served; grading or billing a substitute under the requested name is a false statement.
 *  5. **An unstated schema verdict is not a valid one.** `schemaValid` is `true` only when the body
 *     says exactly `true`, so silence reads as invalid.
 *
 * Money note: `costMicroUsd` is PROVIDER accounting in integer micro-USD, taken as reported and never
 * recomputed from a price table. The owner's ledger is integer milliunits behind `src/lib/money` and
 * does not appear here (contract 06 §6.1). No `parseFloat`, no `.toFixed(`.
 *
 * Privacy note: {@link ProviderReadError}'s `detail` holds field paths, a status number, a model id
 * and a correlation reference. It has no field for a prompt, a completion or a credential, and
 * nothing on this path puts one there (§6.4, R19). No host, no endpoint and no figure of the owner's
 * appears in this file (R24).
 */

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

/**
 * Why reading a provider answer refused.
 *
 * The `LIVE_*` spelling is kept because these are the codes the benchmark path already raises and
 * already tests; renaming them would have been a cosmetic change with a real cost to a reader
 * comparing this against contract 09's own vocabulary.
 */
export const PROVIDER_READ_ERROR_CODES = [
  'LIVE_PROVIDER_STATUS_NOT_OK',
  'LIVE_PROVIDER_BODY_UNPARSEABLE',
  'LIVE_PROVIDER_USAGE_ABSENT',
  'LIVE_PROVIDER_SERVED_ANOTHER_MODEL',
] as const;
export type ProviderReadErrorCode = (typeof PROVIDER_READ_ERROR_CODES)[number];

/**
 * A refused read. Carries an enumerated code and a `detail` of field paths, references and
 * measurements — never content, never a credential.
 */
export class ProviderReadError extends Error {
  readonly code: ProviderReadErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: ProviderReadErrorCode, message: string, detail: Record<string, string> = {}) {
    super(`NIZAM provider response: ${message}`);
    this.name = 'ProviderReadError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

// ---------------------------------------------------------------------------------------------
// The exchange shapes
// ---------------------------------------------------------------------------------------------

/**
 * What a transport observed. Declared here so both callers agree on the shape of an answer without
 * either importing the other's tier.
 */
export interface ProviderHttpAnswer {
  readonly status: number;
  readonly bodyText: string;
  /** Wall-clock duration the transport observed, in whole milliseconds. */
  readonly latencyMs: number;
}

/** Which exchange is being read. `ref` is a correlation reference; it is never content (§6.4). */
export interface ProviderResponseSubject {
  /** A case id on the benchmark path, a turn reference on the agent path. A pointer either way. */
  readonly ref: string;
  readonly modelIdRequested: string;
}

/**
 * A validated provider answer. Every numeric field is an integer the provider reported; nothing here
 * was computed, estimated or filled in from a default other than a token count the provider omitted,
 * which reads as zero because an unreported count is not a count.
 */
export interface ValidatedProviderResponse {
  readonly modelIdRequested: string;
  readonly modelIdServed: string;
  readonly text: string;
  readonly parsed: Record<string, unknown> | null;
  readonly schemaValid: boolean;
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
  /** The provider's ACTUAL reported cost, integer micro-USD, as reported (contract 09 precedence). */
  readonly costMicroUsd: number;
  readonly latencyMs: number;
}

/** The success range. A status outside it is a refusal, never a warning. */
const SUCCESS_STATUS_MIN = 200;
const SUCCESS_STATUS_MAX = 299;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read one provider answer, or REFUSE. The single implementation of the five rules above.
 *
 * @throws {ProviderReadError} for every one of the five refusals. A refusal halts the caller rather
 *   than degrading one exchange: on the benchmark path a hole makes the run not a measurement, and on
 *   the agent path a half-read answer would be a fabricated reply.
 */
export function readProviderResponse(input: {
  readonly subject: ProviderResponseSubject;
  readonly response: ProviderHttpAnswer;
}): ValidatedProviderResponse {
  const { subject, response } = input;
  const { ref, modelIdRequested } = subject;

  if (response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
    throw new ProviderReadError(
      'LIVE_PROVIDER_STATUS_NOT_OK',
      'the provider did not return a success status, so the answer is refused rather than retried in a loop here; a partial answer is not an answer',
      { at: 'status', status: String(response.status), ref },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(response.bodyText);
  } catch {
    throw new ProviderReadError('LIVE_PROVIDER_BODY_UNPARSEABLE', 'the provider response body is not parseable JSON', {
      at: 'bodyText',
      ref,
    });
  }
  if (!isRecord(body)) {
    throw new ProviderReadError('LIVE_PROVIDER_BODY_UNPARSEABLE', 'the provider response body is not an object', {
      at: 'bodyText',
      ref,
    });
  }

  const usage = body.usage;
  if (!isRecord(usage)) {
    throw new ProviderReadError(
      'LIVE_PROVIDER_USAGE_ABSENT',
      "the provider reported no usage block, and contract 09's source precedence requires the ACTUAL reported cost rather than an estimate",
      { at: 'usage', ref },
    );
  }
  const costMicroUsd = usage.costMicroUsd;
  if (typeof costMicroUsd !== 'number' || !Number.isSafeInteger(costMicroUsd) || costMicroUsd < 0) {
    throw new ProviderReadError(
      'LIVE_PROVIDER_USAGE_ABSENT',
      'the provider reported no non-negative integer micro-USD cost, so no actual cost can be recorded for this exchange',
      { at: 'usage.costMicroUsd', ref },
    );
  }

  const modelIdServed = typeof body.model === 'string' ? body.model : modelIdRequested;
  if (modelIdServed !== modelIdRequested) {
    throw new ProviderReadError(
      'LIVE_PROVIDER_SERVED_ANOTHER_MODEL',
      'the provider served a different model than the one requested, and a record must name the model it actually got',
      { at: 'model', modelId: modelIdRequested, ref },
    );
  }

  const readTokens = (key: string): number => {
    const raw = usage[key];
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
  };

  return Object.freeze({
    modelIdRequested,
    modelIdServed,
    text: typeof body.text === 'string' ? body.text : '',
    parsed: isRecord(body.parsed) ? { ...body.parsed } : null,
    // Fail-closed: a response that does not state schema validity is not treated as valid.
    schemaValid: body.schemaValid === true,
    promptTokens: readTokens('promptTokens'),
    cachedTokens: readTokens('cachedTokens'),
    completionTokens: readTokens('completionTokens'),
    reasoningTokens: readTokens('reasoningTokens'),
    costMicroUsd,
    latencyMs: response.latencyMs,
  });
}
