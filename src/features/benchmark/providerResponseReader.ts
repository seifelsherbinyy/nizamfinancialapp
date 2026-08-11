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
 * ## The refusals, and why each halts rather than degrades
 *
 *  1. **A non-2xx status.** Reported as the provider gave it; anything outside the success range is a
 *     refusal, never a warning, and never retried in a loop from here.
 *  2. **An unparseable body**, or a body that is not an object.
 *  2a. **A provider error carried inside a 2xx body.** The provider's own error-handling reference is
 *     explicit that the HTTP status equals `error.code` only when the request itself was invalid or the
 *     account is out of credits; "otherwise the returned HTTP response status will be `200` and any
 *     error occurred while the LLM is producing the output will be emitted in the response body". The
 *     shape is `{ error: { code, message, metadata? } }`. This is checked BEFORE usage, because such a
 *     body carries no `usage` at all — so reading it in usage order would report a missing cost when
 *     the fact is a provider error, and the two must stay distinguishable in a report.
 *  2b. **An answer the provider says did not finish.** `finish_reason` is normalized by the provider to
 *     one of `tool_calls`, `stop`, `length`, `content_filter`, `error`. `length` means the answer was
 *     cut off at the output allowance and `content_filter` means it was suppressed part-way; in both
 *     cases the text is not the answer the model would have given, so grading it would score a
 *     fragment as if it were a whole answer.
 *  3. **An absent usage block, or a cost that is not a usable non-negative figure.** Contract 09's
 *     precedence requires the actual reported cost, so a missing one cannot be substituted with an
 *     estimate, and it is never defaulted to zero — a zero would silently claim a free measurement.
 *     Two spellings of the figure are accepted, and both end as integer micro-USD: `usage.costMicroUsd`
 *     (already an integer, refused if present and not a non-negative safe integer) and `usage.cost`
 *     (the provider's own DECIMAL USD, converted once here by {@link decimalUsdToMicroUsd}).
 *  4. **A substituted model.** A registry entry, and a telemetry row, must name the model that was
 *     actually served; grading or billing a substitute under the requested name is a false statement.
 *  5. **An unstated schema verdict is not a valid one.** `schemaValid` is `true` only when the body
 *     says exactly `true`, so silence reads as invalid.
 *
 * Money note: `costMicroUsd` is PROVIDER accounting in integer micro-USD, taken from what the provider
 * REPORTED and never recomputed from a price table. Where the provider reports a decimal USD figure it
 * is parsed to an integer ONCE, here, at the read boundary — which is `money-rules.md` rule 2 applied
 * rather than excepted — using `BigInt` integer arithmetic over the figure's decimal digits, rounding
 * UP so a cost is never understated. No `parseFloat`, no `Number.parseFloat`, no `.toFixed(`, and no
 * float intermediate. The owner's ledger is integer MILLIUNITS behind `src/lib/money` and does not
 * appear here; the two units are never joined (contract 06 §6.1).
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
  /**
   * A 2xx body that reports a provider error instead of an answer. A DISTINCT code rather than an
   * overload of `LIVE_PROVIDER_USAGE_ABSENT`: a provider error and a missing cost are different facts,
   * and a report that cannot tell them apart sends the reader looking in the wrong place. The
   * provider's own `error.code` travels in `detail`; its `error.message` never does, because the
   * provider's moderation metadata can carry an excerpt of the flagged input.
   */
  'LIVE_PROVIDER_ERROR_IN_BODY',
  /** `finish_reason` says the answer was cut off (`length`) or suppressed (`content_filter`). */
  'LIVE_PROVIDER_ANSWER_TRUNCATED',
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

// ---------------------------------------------------------------------------------------------
// The decimal-USD boundary parse
// ---------------------------------------------------------------------------------------------

/** Micro-USD is USD scaled by ten to the sixth: six fractional decimal digits, exactly. */
export const MICRO_USD_FRACTIONAL_DIGITS = 6;

/**
 * A guard on the exponent, so a hostile `1e100000000` cannot ask for a bignum with that many digits.
 * Any real cost figure is far inside this, in either direction.
 */
const MAX_ABSOLUTE_EXPONENT = 1_000;

/**
 * Decimal syntax as JSON and `String(number)` produce it: an optional sign, digits either side of a
 * point, and an optional exponent (`String(1.2e-7)` is `'1.2e-7'`, so the exponent branch is reached
 * by real small figures rather than being defensive).
 */
const DECIMAL_PATTERN = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Map a provider's DECIMAL USD cost to integer micro-USD, or `null` if it is not a usable figure.
 *
 * This is the boundary conversion `money-rules.md` rule 2 requires: "Parse decimals -> integer
 * milliunits at the boundary". The unit here is micro-USD rather than milliunits because this is
 * PROVIDER accounting, which never joins the owner's ledger (contract 06 §6.1) — but the discipline is
 * the same one, applied once, at the read.
 *
 * **How it avoids floating point.** No `parseFloat`, no `Number.parseFloat`, no `.toFixed(` — those
 * are banned outside `src/lib/money/` and are not needed. The figure is taken in its DECIMAL STRING
 * form (`String(n)` yields the shortest representation that round-trips, which is the text the
 * provider put on the wire), split into a digit run and a decimal exponent, and rescaled with
 * `BigInt` integer arithmetic. No intermediate is ever a float.
 *
 * **It rounds UP.** A cost below one micro-USD becomes one micro-USD rather than zero, so a figure is
 * never understated and a spend total is never smaller than what was actually charged.
 *
 * Returns `null` — never a zero — for a negative, non-finite, absent or unparseable figure. Zero
 * would silently claim a free measurement; the caller refuses instead.
 */
export function decimalUsdToMicroUsd(raw: unknown): number | null {
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    text = String(raw);
  } else if (typeof raw === 'string') {
    text = raw.trim();
  } else {
    return null;
  }
  if (text.length === 0) return null;

  const match = DECIMAL_PATTERN.exec(text);
  if (match === null) return null;
  const [, sign, wholeDigits = '', fractionDigits = '', exponentText] = match;
  // A lone '.', a lone sign, or a bare exponent carries no figure.
  if (wholeDigits.length === 0 && fractionDigits.length === 0) return null;
  // A negative cost is refused rather than clamped: it is not a cost.
  if (sign === '-') return null;

  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_ABSOLUTE_EXPONENT) return null;

  // The digit run read as an integer, plus the power of ten that turns it into micro-USD.
  const digits = BigInt(`${wholeDigits}${fractionDigits}`);
  const shift = exponent - fractionDigits.length + MICRO_USD_FRACTIONAL_DIGITS;

  let microUsd: bigint;
  if (shift >= 0) {
    // Exact: the figure has no digit finer than a micro-USD.
    microUsd = digits * 10n ** BigInt(shift);
  } else {
    // Finer than a micro-USD, so it must be rounded — upward, per the note above.
    const divisor = 10n ** BigInt(-shift);
    microUsd = (digits + divisor - 1n) / divisor;
  }
  if (microUsd > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(microUsd);
}

/**
 * The cost, in integer micro-USD, from whichever spelling the provider used — or `null` to refuse.
 *
 * Two accepted spellings, and the order between them is deliberate:
 *
 *  1. `usage.costMicroUsd` — an integer micro-USD figure, which is what this repository's own mocks,
 *     fixtures and recorded exchanges carry. Kept first and unchanged: if it is PRESENT it must be a
 *     non-negative safe integer, and a present-but-invalid one refuses rather than falling through to
 *     the decimal branch, because a caller that named the integer field and got it wrong is a defect
 *     rather than a provider using a different dialect.
 *  2. `usage.cost` — a DECIMAL USD number, which is what OpenRouter actually emits
 *     (`docs/…/usage-accounting`: `"cost": 0.95` beside `prompt_tokens` / `completion_tokens`).
 *     Converted ONCE, here, by {@link decimalUsdToMicroUsd}.
 *
 * `null` means refuse. There is no default and no zero: a zero cost would claim a free measurement.
 */
function readCostMicroUsd(usage: Record<string, unknown>): { microUsd: number } | { at: string } {
  const integerSpelling = usage.costMicroUsd;
  if (integerSpelling !== undefined) {
    if (
      typeof integerSpelling !== 'number' ||
      !Number.isSafeInteger(integerSpelling) ||
      integerSpelling < 0
    ) {
      return { at: 'usage.costMicroUsd' };
    }
    return { microUsd: integerSpelling };
  }
  const mapped = decimalUsdToMicroUsd(usage.cost);
  if (mapped === null) return { at: 'usage.cost' };
  return { microUsd: mapped };
}

/**
 * Read one token count under any of the accepted spellings, in order, or `0`.
 *
 * The camelCase spellings this reader already accepted come first and are unchanged; the provider's
 * own snake_case names are ADDITIVE. An unreported count reads as zero because an unreported count is
 * not a count — unlike cost, a token count is never the thing a refusal protects.
 */
function readTokenCount(usage: Record<string, unknown>, paths: readonly (readonly string[])[]): number {
  for (const path of paths) {
    let cursor: unknown = usage;
    for (const segment of path) {
      if (!isRecord(cursor)) {
        cursor = undefined;
        break;
      }
      cursor = cursor[segment];
    }
    if (typeof cursor === 'number' && Number.isSafeInteger(cursor) && cursor >= 0) return cursor;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// The provider's ACTUAL completion shape
// ---------------------------------------------------------------------------------------------

/**
 * The `finish_reason` values that mean the text is NOT the answer the model would have given.
 *
 * From the provider's own response reference: `finish_reason` is normalized to `tool_calls`, `stop`,
 * `length`, `content_filter` or `error`, with the provider's raw string kept beside it in
 * `native_finish_reason`. `length` is truncation at the output allowance and `content_filter` is
 * suppression part-way through; `stop` and `tool_calls` are complete answers and pass. `error` is
 * handled as a provider error rather than as a truncation, because the same reference documents it as
 * what a provider failure looks like once generation has begun.
 */
const UNFINISHED_FINISH_REASONS: readonly string[] = Object.freeze(['length', 'content_filter']);

/** The first choice of the `choices` array, or `null` when the body carries no usable choice. */
function firstChoice(body: Record<string, unknown>): Record<string, unknown> | null {
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const [first] = choices;
  return isRecord(first) ? first : null;
}

/**
 * The completion text, in the provider's own place for it: `choices[0].message.content`.
 *
 * The documented type is `string | null`, and a `null` reads as the empty string — the provider's
 * reference has a section for a completion that generated no content, so an empty answer is a real
 * outcome that grades as empty rather than a refusal. Streaming's `delta.content` is deliberately not
 * read: this path never sets `stream: true`, so a `delta` here would mean the request was not the one
 * this module composed.
 */
function completionTextFrom(choice: Record<string, unknown> | null): string {
  if (choice === null) return '';
  const message = choice.message;
  if (isRecord(message) && typeof message.content === 'string') return message.content;
  return '';
}

/**
 * The completion text read as a JSON object, or `null`.
 *
 * A completion that is not JSON is a LEGITIMATE answer shape, not a refusal — a model asked a question
 * in prose answers in prose, and that answer grades on its text. So this returns `null` rather than
 * throwing, and only an OBJECT counts: an array, a number or a bare string is not the structured answer
 * the schema verdict is about, which is why the leading-brace check is a correctness rule here and not
 * merely an optimisation.
 */
function parseCompletionJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const candidate: unknown = JSON.parse(trimmed);
    return isRecord(candidate) ? { ...candidate } : null;
  } catch {
    return null;
  }
}

/**
 * The provider's own error code and typed category from an error object, as a `detail` fragment.
 *
 * `error.code` is a number and `error.metadata.error_type` is a value from the provider's documented,
 * stable category vocabulary — both are codes. `error.message` is EXCLUDED and no branch here reads it:
 * the provider's moderation metadata is documented to carry `flagged_input`, an excerpt of the very
 * text this path must never put in a `detail` (§6.4, R19).
 */
function providerErrorDetail(error: Record<string, unknown>): Record<string, string> {
  const detail: Record<string, string> = {};
  const code = error.code;
  if (typeof code === 'number' && Number.isFinite(code)) detail.providerErrorCode = String(code);
  else if (typeof code === 'string' && code.length > 0) detail.providerErrorCode = code;
  const metadata = error.metadata;
  if (isRecord(metadata) && typeof metadata.error_type === 'string' && metadata.error_type.length > 0) {
    detail.providerErrorType = metadata.error_type;
  }
  return detail;
}

/**
 * Read one provider answer, or REFUSE. The single implementation of the rules above.
 *
 * @throws {ProviderReadError} for every one of the refusals. A refusal halts the caller rather
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

  const choice = firstChoice(body);

  // The error-shaped 2xx, checked BEFORE usage. Such a body carries no `usage`, so in usage order it
  // would be reported as a missing cost — the wrong fact, and one that sends a reader to the accounting
  // when the answer is that the provider errored.
  //
  // Any top-level `error` object refuses, not only one that arrives without `choices`. The provider's
  // reference states that for a non-streaming request "the error is embedded in the final response
  // alongside any partial content", so a body carrying both is a body whose text is a fragment; reading
  // that fragment as an answer is exactly the cut-off grading the truncation rule below exists to stop.
  const topLevelError = body.error;
  if (isRecord(topLevelError)) {
    throw new ProviderReadError(
      'LIVE_PROVIDER_ERROR_IN_BODY',
      'the provider returned a success status with an error object in the body rather than an answer, so there is no completion to grade',
      { at: 'error', ...providerErrorDetail(topLevelError), ref },
    );
  }
  const choiceError = choice === null ? undefined : choice.error;
  if (isRecord(choiceError)) {
    throw new ProviderReadError(
      'LIVE_PROVIDER_ERROR_IN_BODY',
      'the provider attached an error to the choice it returned, so its text is a fragment rather than an answer',
      { at: 'choices[0].error', ...providerErrorDetail(choiceError), ref },
    );
  }

  const finishReason = choice === null ? undefined : choice.finish_reason;
  if (finishReason === 'error') {
    // The same fact as the two branches above, reported under the same code: the provider failed while
    // generating. It reaches here rather than there when the failure carried no error object.
    throw new ProviderReadError(
      'LIVE_PROVIDER_ERROR_IN_BODY',
      'the provider finished the choice with an error reason, so what it returned is not a completed answer',
      { at: 'choices[0].finish_reason', finishReason: 'error', ref },
    );
  }
  if (typeof finishReason === 'string' && UNFINISHED_FINISH_REASONS.includes(finishReason)) {
    throw new ProviderReadError(
      'LIVE_PROVIDER_ANSWER_TRUNCATED',
      'the provider reported that the answer did not finish, so grading it would score a fragment as a whole answer',
      { at: 'choices[0].finish_reason', finishReason, ref },
    );
  }

  const usage = body.usage;
  if (!isRecord(usage)) {
    throw new ProviderReadError(
      'LIVE_PROVIDER_USAGE_ABSENT',
      "the provider reported no usage block, and contract 09's source precedence requires the ACTUAL reported cost rather than an estimate",
      { at: 'usage', ref },
    );
  }
  const cost = readCostMicroUsd(usage);
  if (!('microUsd' in cost)) {
    throw new ProviderReadError(
      'LIVE_PROVIDER_USAGE_ABSENT',
      'the provider reported no usable non-negative cost, so no actual cost can be recorded for this exchange; a zero is not substituted, because a zero would claim a free measurement',
      { at: cost.at, ref },
    );
  }
  const costMicroUsd = cost.microUsd;

  const modelIdServed = typeof body.model === 'string' ? body.model : modelIdRequested;
  if (modelIdServed !== modelIdRequested) {
    throw new ProviderReadError(
      'LIVE_PROVIDER_SERVED_ANOTHER_MODEL',
      'the provider served a different model than the one requested, and a record must name the model it actually got',
      { at: 'model', modelId: modelIdRequested, ref },
    );
  }

  // The answer, in whichever place it actually is. Top-level `text` / `parsed` / `schemaValid` stay
  // FIRST and unchanged, so every mock, fixture and recorded exchange in this repository reads exactly
  // as it did; the provider's own `choices[0].message.content` is the ADDITIVE branch, and it is the one
  // a real answer takes, because a real answer has no top-level `text` at all.
  const statedText = typeof body.text === 'string' ? body.text : null;
  const text = statedText ?? completionTextFrom(choice);
  const parsedFromText = parseCompletionJson(text);
  const parsed = isRecord(body.parsed) ? { ...body.parsed } : parsedFromText;

  return Object.freeze({
    modelIdRequested,
    modelIdServed,
    text,
    parsed,
    // Fail-closed in both branches. A body that STATES a verdict is believed, in either direction — an
    // explicit `false` is a stated verdict, and deriving over it would overturn what the body said. A
    // body that is SILENT derives, and the derivation is `true` only when the completion text itself
    // parsed to an object, so silence never reads as valid.
    schemaValid: typeof body.schemaValid === 'boolean' ? body.schemaValid : parsedFromText !== null,
    // camelCase first (unchanged), then the provider's own snake_case names and its two nested
    // detail objects. Additive: no spelling this reader already accepted was removed.
    promptTokens: readTokenCount(usage, [['promptTokens'], ['prompt_tokens']]),
    cachedTokens: readTokenCount(usage, [
      ['cachedTokens'],
      ['cached_tokens'],
      ['prompt_tokens_details', 'cached_tokens'],
    ]),
    completionTokens: readTokenCount(usage, [['completionTokens'], ['completion_tokens']]),
    reasoningTokens: readTokenCount(usage, [
      ['reasoningTokens'],
      ['reasoning_tokens'],
      ['completion_tokens_details', 'reasoning_tokens'],
    ]),
    costMicroUsd,
    latencyMs: response.latencyMs,
  });
}
