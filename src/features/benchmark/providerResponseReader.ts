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

  return Object.freeze({
    modelIdRequested,
    modelIdServed,
    text: typeof body.text === 'string' ? body.text : '',
    parsed: isRecord(body.parsed) ? { ...body.parsed } : null,
    // Fail-closed: a response that does not state schema validity is not treated as valid.
    schemaValid: body.schemaValid === true,
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
