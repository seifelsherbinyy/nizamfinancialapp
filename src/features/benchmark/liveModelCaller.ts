/**
 * NIZAM - PFOS benchmark harness (M2): the LIVE model adapter, which holds no network primitive.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration): source precedence
 *   puts actual `usage.cost` and token detail ahead of any estimate, and its exit criteria forbid
 *   promoting a model "from benchmark reputation alone".
 * Build phase: PFOS Stage 6 (two-agent VPS tier), phase 6.3 - the dev-key carve-out (steering §3).
 * Depends on: ./benchmark.types, ./preflight (the K4 scope gate), ./runner (the `ModelCaller` port).
 *   Nothing from `src/server/**`, in either direction of the graph - see "Reachability" below.
 *
 * This is the ONE module in the repository that describes a live provider exchange. Steering §3 grants
 * exactly one network exception: "The Phase-1 benchmark (M2) MAY make live OpenRouter calls **from the
 * developer machine only**, using the **dev** key, on the **sanitized** eval set, never against real
 * financial or journal data ... and only for producing `model_eligibility_registry.json`."
 *
 * ## Reachability: five reasons a server process cannot reach the provider through this file
 *
 * Steering §2 walls the production runtime: "Any outbound network call from a **server** process" is
 * gated. That wall is enforced here structurally rather than by convention.
 *
 *  1. **There is no network primitive in this module.** No `fetch`, no `node:http`, no `node:https`, no
 *     socket, no client library. The capability is a parameter: {@link LiveTransport}. Importing this
 *     file grants no ability to reach anything, because the ability was never in it.
 *  2. **There is no endpoint.** Not a literal, not a default, not a fallback. The base URL arrives as
 *     the NAME of an environment entry ({@link LiveRunConfig.apiBaseUrlRef}), resolved through an
 *     injected {@link LiveRunEnvironment}, and an unresolved name is a fail-closed refusal
 *     ({@link LIVE_ERROR_CODES} `LIVE_API_BASE_URL_UNRESOLVED`). This is the same posture
 *     `OpenRouterPortConfig` already takes, whose own comment is "there is no default endpoint".
 *  3. **There is no credential.** The key arrives the same way, by entry NAME, and what comes back is
 *     an {@link OpaqueSecret} whose `toString` and `toJSON` are the literal redaction marker, so it
 *     cannot be interpolated into a message, serialized into a log, or printed by accident. The one
 *     way to the underlying characters is {@link revealSecret}, which THIS MODULE NEVER CALLS - the
 *     transport does, at the single call site a human wrote.
 *  4. **A run needs a grant that a server cannot mint.** {@link DeveloperMachineGrant} is branded and
 *     {@link grantDeveloperMachineRun} is its only mint; the mint REFUSES when a server-runtime marker
 *     is present, and refuses an invocation that does not name itself the developer-machine harness.
 *     The brand is also recorded in a module-private `WeakSet`, so a cast does not survive
 *     {@link isDeveloperMachineGrant}. As with every capability in this repository, the set can only
 *     refuse a grant it did not mint; it can never invent one.
 *  5. **No file under `src/server/**` imports this module.** Asserted mechanically, with a negative
 *     test that breaks the assertion and observes it fire (`liveModelCaller.isolation.test.ts`).
 *
 * The consequence worth stating plainly: this file can be read, imported, type-checked and unit-tested
 * with no key, no endpoint and no network, which is exactly how its tests run.
 *
 * ## Why the live path is two phases, and why that is not an inconvenience
 *
 * Contract 09's injected port is `ModelCaller = (c: BenchmarkCase) => ModelResponse` - SYNCHRONOUS. A
 * live call is not. Rather than make the harness async (which would ripple through every offline test
 * for the sake of the one gated path), the live path splits:
 *
 *   Phase A  {@link runLiveModelCalls}  async, needs the transport, produces {@link LiveModelExchange}[]
 *   Phase B  {@link liveModelCaller}    sync, pure, replays those exchanges into the existing runner
 *
 * The seam is a recorded exchange, which is the same seam phase 6.2 uses for fixtures - so the live and
 * fixture paths converge on one grading pipeline, and the difference between them is the PROVENANCE of
 * the exchanges rather than a second scorer.
 *
 * ## The one place the live path must NOT copy the fixture path
 *
 * `fixtureReplay.applyRecording` folds a recording onto a CORRECT baseline derived from the case's own
 * expected answer, so a fixture states only what differed. That is a deliberate scaffold, and it is why
 * the registry it feeds is `provisional: true`.
 *
 * A live run must do the opposite. {@link liveModelCaller} builds each response from the provider's
 * answer ALONE, with no correct-answer baseline anywhere on the path, and {@link liveModelCaller}
 * REFUSES a run in which any graded case has no exchange. A missing live answer therefore halts the
 * grading instead of silently scoring as correct. Without that refusal a partial live run would produce
 * a registry that looks measured and is not - precisely the "promoted from benchmark reputation alone"
 * outcome contract 09's exit criteria forbid.
 *
 * ## Money
 *
 * Provider accounting only: `costMicroUsd` is the provider's ACTUAL reported figure in integer
 * micro-USD, taken as reported and never recomputed from a price table. The owner's ledger is integer
 * milliunits behind `src/lib/money` and does not appear here (contract 06 §6.1). No `parseFloat`, no
 * `.toFixed(`.
 */
import type { BenchmarkCase, ModelResponse, TokenUsage } from './benchmark.types.ts';
import { assertScopedToDefaultAllowed } from './preflight.ts';
import {
  ProviderReadError,
  readProviderResponse,
  type ValidatedProviderResponse,
} from './providerResponseReader.ts';
import type { ModelCaller } from './runner.ts';

// ---- the opaque credential holder -------------------------------------------------------------

/** What every accidental stringification of a resolved credential yields. */
export const REDACTION_MARKER = '[redacted]';

declare const OPAQUE_SECRET_BRAND: unique symbol;

/**
 * A resolved credential that cannot be printed. `toString` and `toJSON` both yield
 * {@link REDACTION_MARKER}, so template interpolation, `String()`, `console.log`, `JSON.stringify` and
 * every structured logger reach the marker rather than the value. {@link revealSecret} is the single
 * named chokepoint to the characters, and this module never calls it.
 */
export interface OpaqueSecret {
  readonly [OPAQUE_SECRET_BRAND]: 'a resolved credential; its characters are reachable only through revealSecret';
  toString(): string;
  toJSON(): string;
}

const secretValues = new WeakMap<OpaqueSecret, string>();

/** Wrap resolved credential characters so they cannot be printed by accident. */
export function opaqueSecret(value: string): OpaqueSecret {
  const holder = Object.freeze({
    toString(): string {
      return REDACTION_MARKER;
    },
    toJSON(): string {
      return REDACTION_MARKER;
    },
  }) as unknown as OpaqueSecret;
  secretValues.set(holder, value);
  return holder;
}

/**
 * The one way to the underlying characters. Called by a {@link LiveTransport} at the moment it builds
 * an authorization header, and by nothing else - notably not by any function in this module.
 */
export function revealSecret(secret: OpaqueSecret): string {
  const value = secretValues.get(secret);
  if (value === undefined) {
    throw new LiveRunError(
      'LIVE_SECRET_NOT_WRAPPED',
      'a value offered as a credential was not produced by opaqueSecret, so it carries no characters to reveal',
      { at: 'secret' },
    );
  }
  return value;
}

// ---- the developer-machine capability ---------------------------------------------------------

declare const DEVELOPER_MACHINE_GRANT_BRAND: unique symbol;

/**
 * Evidence that a live run was invoked from the developer machine harness. Branded, with
 * {@link grantDeveloperMachineRun} as the only mint.
 */
export interface DeveloperMachineGrant {
  readonly [DEVELOPER_MACHINE_GRANT_BRAND]: 'minted for an explicit developer-machine benchmark invocation';
}

const developerMachineGrants = new WeakSet<DeveloperMachineGrant>();

/** True only for a grant this module minted. A cast does not survive this check. */
export function isDeveloperMachineGrant(candidate: DeveloperMachineGrant): boolean {
  return developerMachineGrants.has(candidate);
}

/** The one invocation kind that may hold a grant. A single-member literal: there is no other. */
export const DEVELOPER_MACHINE_INVOCATION = 'developer_machine_benchmark_harness';

/**
 * Mint the developer-machine capability.
 *
 * Both fields are required and neither has a default, so a grant is never obtained by omission.
 * `serverRuntimeMarker` must be `null`: a caller that can see a server-runtime marker is a server
 * process, and a server process may not hold this capability (steering §2). The marker is passed IN
 * rather than read from the ambient environment on purpose - this module reads no environment, so its
 * behaviour is a function of its arguments and a test can drive both branches without mutating a
 * process.
 */
export function grantDeveloperMachineRun(evidence: {
  invocation: typeof DEVELOPER_MACHINE_INVOCATION;
  serverRuntimeMarker: string | null;
}): DeveloperMachineGrant {
  if (evidence.invocation !== DEVELOPER_MACHINE_INVOCATION) {
    throw new LiveRunError(
      'LIVE_GRANT_INVOCATION_UNRECOGNISED',
      'a live run may be invoked only by the developer-machine benchmark harness (steering §3)',
      { at: 'invocation' },
    );
  }
  if (evidence.serverRuntimeMarker !== null) {
    throw new LiveRunError(
      'LIVE_GRANT_REFUSED_SERVER_RUNTIME',
      'a server-runtime marker is present, and a server process may not make an outbound model call (steering §2)',
      { at: 'serverRuntimeMarker' },
    );
  }
  const grant = Object.freeze({}) as unknown as DeveloperMachineGrant;
  developerMachineGrants.add(grant);
  return grant;
}

// ---- errors -----------------------------------------------------------------------------------

/** Why a live run refused. A caller discriminates on `code`, never on a message. */
export const LIVE_ERROR_CODES = [
  'LIVE_GRANT_NOT_MINTED',
  'LIVE_GRANT_INVOCATION_UNRECOGNISED',
  'LIVE_GRANT_REFUSED_SERVER_RUNTIME',
  'LIVE_API_BASE_URL_UNRESOLVED',
  'LIVE_API_KEY_UNRESOLVED',
  'LIVE_SECRET_NOT_WRAPPED',
  'LIVE_PROVIDER_STATUS_NOT_OK',
  'LIVE_PROVIDER_BODY_UNPARSEABLE',
  // Re-raised verbatim from `./providerResponseReader.ts`, which owns the vocabulary. A provider error
  // inside a 2xx body and a truncated answer are separate codes from a missing cost on purpose: three
  // different facts, three different places to look.
  'LIVE_PROVIDER_ERROR_IN_BODY',
  'LIVE_PROVIDER_ANSWER_TRUNCATED',
  'LIVE_PROVIDER_USAGE_ABSENT',
  'LIVE_PROVIDER_SERVED_ANOTHER_MODEL',
  'LIVE_CASE_HAS_NO_EXCHANGE',
] as const;
export type LiveErrorCode = (typeof LIVE_ERROR_CODES)[number];

/**
 * A refused live run.
 *
 * `detail` holds field paths, status codes, model ids and case ids. It has no field for a prompt, a
 * completion, or a credential, and nothing on this path ever puts one there (§6.4, R19).
 */
export class LiveRunError extends Error {
  readonly code: LiveErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: LiveErrorCode, message: string, detail: Record<string, string> = {}) {
    super(`NIZAM live benchmark run: ${message}`);
    this.name = 'LiveRunError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

// ---- the injected transport --------------------------------------------------------------------

/**
 * A described HTTP exchange. Note what is absent: there is no `headers` field carrying an
 * authorization value. The credential travels beside the request as an {@link OpaqueSecret}, so a
 * request object may be logged whole without leaking it.
 */
export interface LiveHttpRequest {
  /** Built from the RESOLVED base URL plus a path. No part of it is a literal in this file. */
  readonly url: string;
  readonly method: 'POST';
  /** The JSON request body. Carries the sanitized case text; never a credential. */
  readonly body: string;
}

export interface LiveHttpResponse {
  readonly status: number;
  readonly bodyText: string;
  /** Wall-clock duration the transport observed, in whole milliseconds. */
  readonly latencyMs: number;
}

/**
 * The network capability, injected. This module declares the shape and never supplies an
 * implementation - the developer-machine script that performs a run supplies one, and it is the only
 * place `revealSecret` is called.
 */
export type LiveTransport = (
  request: LiveHttpRequest,
  credential: OpaqueSecret,
) => Promise<LiveHttpResponse>;

// ---- configuration --------------------------------------------------------------------------

/** Resolve an environment entry by NAME. `null` for an absent entry - never a guess, never a default. */
export interface LiveRunEnvironment {
  resolve(entryName: string): string | null;
}

/**
 * A live run's configuration. Both `*Ref` fields are NAMES of environment entries, matching
 * `OpenRouterPortConfig`; no value of either appears in any tracked file (R24).
 */
export interface LiveRunConfig {
  readonly apiBaseUrlRef: string;
  readonly apiKeyRef: string;
  /** The path appended to the resolved base URL. A path is not a deployment particular. */
  readonly completionsPath: string;
  readonly maxOutputTokens: number;
}

/** The resolved endpoint and credential. Produced only inside {@link resolveLiveRun}. */
export interface ResolvedLiveRun {
  readonly url: string;
  readonly credential: OpaqueSecret;
}

/**
 * Resolve the endpoint and the credential from the injected environment, or REFUSE.
 *
 * This is where the live branch actually opens or closes. An absent base-URL entry is not substituted
 * with a provider default, because "there is no default endpoint" - so a machine on which the operator
 * has not supplied the entry cannot make a live call, and the fixture-backed path stands (steering §3).
 */
export function resolveLiveRun(
  grant: DeveloperMachineGrant,
  environment: LiveRunEnvironment,
  config: LiveRunConfig,
): ResolvedLiveRun {
  if (!isDeveloperMachineGrant(grant)) {
    throw new LiveRunError(
      'LIVE_GRANT_NOT_MINTED',
      'the grant was not minted by grantDeveloperMachineRun, so the caller has not established that this is a developer-machine invocation',
      { at: 'grant' },
    );
  }
  const baseUrl = environment.resolve(config.apiBaseUrlRef);
  if (baseUrl === null || baseUrl.length === 0) {
    throw new LiveRunError(
      'LIVE_API_BASE_URL_UNRESOLVED',
      'the environment entry naming the provider base URL is absent, and there is no default endpoint, so no live call can be addressed',
      { at: 'apiBaseUrlRef', entryName: config.apiBaseUrlRef },
    );
  }
  const key = environment.resolve(config.apiKeyRef);
  if (key === null || key.length === 0) {
    throw new LiveRunError(
      'LIVE_API_KEY_UNRESOLVED',
      'the environment entry naming the dev credential is absent or empty, so the fixture-backed path stands (steering §3)',
      { at: 'apiKeyRef', entryName: config.apiKeyRef },
    );
  }
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const path = config.completionsPath.startsWith('/')
    ? config.completionsPath
    : `/${config.completionsPath}`;
  return Object.freeze({ url: `${trimmed}${path}`, credential: opaqueSecret(key) });
}

// ---- the recorded exchange -------------------------------------------------------------------

/**
 * One live exchange. Structurally the same shape phase 2.2 records for a fixture, declared here
 * independently because the benchmark tier must not import from `src/server/**` (the isolation check
 * asserts that direction, and a type-only import would still be a textual edge). The server-tier
 * emission consumes this type in the allowed direction, features -> server.
 */
export interface LiveModelExchange {
  readonly caseId: string;
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
  readonly confidenceBps: number;
}

// ---- the live measurement witness ------------------------------------------------------------

declare const LIVE_MEASUREMENT_WITNESS_BRAND: unique symbol;

/**
 * Evidence that a COMPLETE live run happened: every graded case of every graded model was answered by
 * the provider. Branded, minted only by {@link runLiveModelCalls}, and required by the emission that
 * produces a NON-provisional registry.
 *
 * This is the mechanical counterpart of `provisionalRegistryFromFixture`, which accepts anything
 * carrying `provisional: true` and returns a document the router cannot be handed. Here the direction
 * is reversed: a `provisional: false` document exists only downstream of this witness, and the witness
 * exists only downstream of a complete live run. So "a registry that claims to be measured and is not"
 * has no construction path, rather than being a mistake the tests have to look for.
 */
export interface LiveMeasurementWitness {
  readonly [LIVE_MEASUREMENT_WITNESS_BRAND]: 'minted from a complete live provider run on the sanitized eval set';
  readonly modelId: string;
  readonly casesAnswered: number;
  /** The provider's summed ACTUAL reported cost for this model, integer micro-USD. */
  readonly actualCostMicroUsd: number;
}

const liveWitnesses = new WeakSet<LiveMeasurementWitness>();

/** True only for a witness this module minted. A cast does not survive this check. */
export function isLiveMeasurementWitness(candidate: LiveMeasurementWitness): boolean {
  return liveWitnesses.has(candidate);
}

/** One model's completed live run: its exchanges, and the witness that they are complete. */
export interface LiveModelRun {
  readonly modelId: string;
  readonly exchanges: readonly LiveModelExchange[];
  readonly witness: LiveMeasurementWitness;
}

// ---- request and response mapping -------------------------------------------------------------

/**
 * The provider privacy posture asserted on every live request (§6.4, R19). Declared here rather than
 * imported from `src/server/ports/openrouter` because the benchmark tier must not reference the server
 * tier; the two boundaries are deliberately separate (steering §2) and the fields agree by name.
 *
 * The first two are single-member literal types, so there is no value meaning "training allowed".
 */
export interface LivePrivacyPosture {
  readonly training: 'excluded';
  readonly dataCollectingProviders: 'denied';
  readonly zeroDataRetention: 'required';
}

/** The one posture this module will send. Frozen, and there is no parameter that could weaken it. */
export const LIVE_PRIVACY_POSTURE: LivePrivacyPosture = Object.freeze({
  training: 'excluded',
  dataCollectingProviders: 'denied',
  zeroDataRetention: 'required',
});

/**
 * Build the JSON body for one case. The body carries the SANITIZED case text and the privacy posture,
 * and never a credential - the credential travels beside the request as an {@link OpaqueSecret}.
 */
export function liveRequestBody(
  benchmarkCase: BenchmarkCase,
  modelId: string,
  maxOutputTokens: number,
): string {
  return JSON.stringify({
    model: modelId,
    max_tokens: maxOutputTokens,
    // Untrusted on the way back, sanitized on the way out: 6.1's audit is what makes sending it safe.
    messages: [{ role: 'user', content: benchmarkCase.input }],
    privacy: LIVE_PRIVACY_POSTURE,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function digitRuns(text: string): string[] {
  return text.match(/\d[\d,]*/g)?.map((run) => run.replace(/,/g, '')) ?? [];
}

/**
 * Structured keys that are RESPONSE METADATA rather than part of the graded answer, and are therefore
 * excluded from the fabrication scan.
 *
 * This exclusion is load-bearing and was found by a failing test rather than by reasoning, so it is
 * worth stating why each key is here:
 *
 *  - `confidenceBps` is a self-report on a FIXED 0-10000 scale. Its digits come from the scale, not
 *    from the case, so scanning it flags every calibrated response as a fabricator - which is exactly
 *    what happened before this list existed, and it turned a perfect run into a total failure across
 *    every P0 category.
 *  - `refused` is a boolean and carries no figure.
 *  - `citedEvidence` holds evidence KEY NAMES, not values. Whether the right keys were cited is
 *    `evidenceCoverage`'s judgement in `scoring.ts`; a digit inside an identifier is not an asserted
 *    number and must not be graded as one.
 *
 * `toolCalls` is deliberately ABSENT from this list. A tool argument can carry a figure the model was
 * supposed to take from the input and must not invent, so tool arguments stay in scope.
 */
export const FABRICATION_SCAN_EXEMPT_KEYS: readonly string[] = Object.freeze([
  'confidenceBps',
  'refused',
  'citedEvidence',
]);

/**
 * Contract 09's own definition, applied deterministically: `fabricatedNumber` is "true if the model
 * asserted a number that did not come from the deterministic input". So every digit run the response
 * asserts is checked against the digit runs the case supplied, with grouping separators stripped so
 * `1,234` and `1234` are the same number. A run the input never contained is a fabrication.
 *
 * Conservative in the direction that matters: it flags rather than excuses, because a false negative
 * would let a hallucinated figure through a P0 category. The one place it deliberately does NOT flag is
 * {@link FABRICATION_SCAN_EXEMPT_KEYS}, which are response metadata rather than asserted answers.
 */
export function assertsFabricatedNumber(
  benchmarkCase: BenchmarkCase,
  text: string,
  parsed: Record<string, unknown> | null,
): boolean {
  const supplied = new Set(digitRuns(benchmarkCase.input));
  // The expected answer's own figures are deterministic input too: they are what the case is asking
  // the model to reproduce, so echoing one is not a fabrication.
  for (const run of digitRuns(JSON.stringify(benchmarkCase.expected))) supplied.add(run);

  const graded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed ?? {})) {
    if (FABRICATION_SCAN_EXEMPT_KEYS.includes(key)) continue;
    graded[key] = value;
  }
  const asserted = [...digitRuns(text), ...digitRuns(JSON.stringify(graded))];
  return asserted.some((run) => !supplied.has(run));
}

function readConfidenceBps(parsed: Record<string, unknown> | null): number {
  const raw = parsed?.confidenceBps;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0 || raw > 10_000) return 0;
  return raw;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function readToolCalls(value: unknown): { name: string; args: Record<string, unknown> }[] {
  if (!Array.isArray(value)) return [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const name = entry.name;
    if (typeof name !== 'string' || name.length === 0) continue;
    calls.push({ name, args: isRecord(entry.args) ? { ...entry.args } : {} });
  }
  return calls;
}

/**
 * Turn one provider response into a {@link LiveModelExchange}, or REFUSE.
 *
 * Every refusal here halts the whole run rather than degrading one case, because a run with a hole in
 * it is not a measurement. A non-2xx status, an unparseable body, an absent usage block, and a
 * substituted model all refuse - the last one because a registry entry names the model it graded, and
 * grading a substitute under the requested name would be a false statement about which model was
 * measured.
 */
export function readLiveResponse(input: {
  benchmarkCase: BenchmarkCase;
  modelIdRequested: string;
  response: LiveHttpResponse;
}): LiveModelExchange {
  const { benchmarkCase, modelIdRequested, response } = input;
  // The refusals live in `./providerResponseReader.ts` and are SHARED with the agent's model
  // port (task B6): one implementation of what a provider answer has to satisfy, not two. What this
  // function adds is the benchmark-shaped mapping — the case id and the self-reported confidence —
  // which is the only part that is about grading rather than about the provider.
  let validated: ValidatedProviderResponse;
  try {
    validated = readProviderResponse({
      subject: { ref: benchmarkCase.id, modelIdRequested },
      response: { status: response.status, bodyText: response.bodyText, latencyMs: response.latencyMs },
    });
  } catch (cause) {
    if (!(cause instanceof ProviderReadError)) throw cause;
    // Re-raised as this path's own error type, with the SAME code and the same detail under the key
    // this path already names it by. The judgement is shared; the error vocabulary a caller
    // discriminates on is not silently changed underneath it.
    const { ref, ...rest } = cause.detail;
    throw new LiveRunError(cause.code, cause.message.replace('NIZAM provider response: ', ''), {
      ...rest,
      caseId: ref ?? benchmarkCase.id,
    });
  }

  return Object.freeze({
    caseId: benchmarkCase.id,
    modelIdRequested: validated.modelIdRequested,
    modelIdServed: validated.modelIdServed,
    text: validated.text,
    parsed: validated.parsed,
    schemaValid: validated.schemaValid,
    promptTokens: validated.promptTokens,
    cachedTokens: validated.cachedTokens,
    completionTokens: validated.completionTokens,
    reasoningTokens: validated.reasoningTokens,
    costMicroUsd: validated.costMicroUsd,
    latencyMs: validated.latencyMs,
    confidenceBps: readConfidenceBps(validated.parsed),
  });
}

// ---- phase A: the live calls ------------------------------------------------------------------

/**
 * Call the provider once per case, for one model, and mint the witness if every case was answered.
 *
 * The only asynchronous function on the live path, and the only one that needs the transport. Calls
 * are made in eval-set order and the FIRST failure aborts: there is no retry loop, no per-case
 * fallback, and no continue-on-error. Steering §3 permits one narrow exception for one artifact; a
 * loop that keeps trying after a refusal is how a narrow exception becomes an open channel, and a run
 * that stops halfway falls back to the fixture path rather than emitting a half-measured registry.
 */
export async function runLiveModelCalls(input: {
  grant: DeveloperMachineGrant;
  transport: LiveTransport;
  resolved: ResolvedLiveRun;
  modelId: string;
  cases: readonly BenchmarkCase[];
  maxOutputTokens: number;
  /**
   * Observed after each answered case, so an abort can be REPORTED rather than being silent.
   *
   * Purely observational, and deliberately nothing more. It is not a retry, not a continue-on-error and
   * not a checkpoint: it hands out no exchange, it cannot mint or carry a witness, and nothing it emits
   * can be fed back in to resume a run. The abort still forfeits the spend (R10.12) — this only makes
   * the loss legible instead of leaving the operator to infer it from a refusal code.
   */
  onCaseAnswered?: (progress: {
    readonly modelId: string;
    readonly casesAnswered: number;
    readonly costMicroUsdSoFar: number;
  }) => void;
}): Promise<LiveModelRun> {
  const { grant, transport, resolved, modelId, cases, maxOutputTokens } = input;
  if (!isDeveloperMachineGrant(grant)) {
    throw new LiveRunError(
      'LIVE_GRANT_NOT_MINTED',
      'the grant was not minted by grantDeveloperMachineRun, so no live call is made',
      { at: 'grant' },
    );
  }
  // K4 again, at the moment of the call. The pre-flight gate ran earlier; this is the belt that holds
  // even if a caller skipped it, because the premium models are OFF without an owner opt-in.
  assertScopedToDefaultAllowed([modelId]);

  const exchanges: LiveModelExchange[] = [];
  let actualCostMicroUsd = 0;
  for (const benchmarkCase of cases) {
    const response = await transport(
      Object.freeze({
        url: resolved.url,
        method: 'POST',
        body: liveRequestBody(benchmarkCase, modelId, maxOutputTokens),
      }),
      resolved.credential,
    );
    const exchange = readLiveResponse({ benchmarkCase, modelIdRequested: modelId, response });
    exchanges.push(exchange);
    actualCostMicroUsd += exchange.costMicroUsd;
    input.onCaseAnswered?.({
      modelId,
      casesAnswered: exchanges.length,
      costMicroUsdSoFar: actualCostMicroUsd,
    });
  }

  const witness = Object.freeze({
    modelId,
    casesAnswered: exchanges.length,
    actualCostMicroUsd,
  }) as unknown as LiveMeasurementWitness;
  liveWitnesses.add(witness);
  return Object.freeze({ modelId, exchanges: Object.freeze(exchanges), witness });
}

// ---- phase B: grading, with no correct-answer baseline ----------------------------------------

function usageOf(exchange: LiveModelExchange): TokenUsage {
  return {
    promptTokens: exchange.promptTokens,
    cachedTokens: exchange.cachedTokens,
    cacheWriteTokens: 0,
    completionTokens: exchange.completionTokens,
    reasoningTokens: exchange.reasoningTokens,
    // Contract 09's `costUsd` is a USD figure; the provider's actual is integer micro-USD. They are
    // different units, so the actual is carried on the exchange and this field stays 0 rather than
    // being converted. The registry reports the actual in its own unit.
    costUsd: 0,
  };
}

/**
 * A {@link ModelCaller} over live exchanges, with NO correct-answer baseline anywhere on the path.
 *
 * A case with no exchange REFUSES. That refusal is the whole difference between this and the fixture
 * replay: `fixtureReplay` falls back to a correct baseline and marks the registry provisional for
 * exactly that reason, whereas a live grading that silently scored an unanswered case as correct would
 * produce a document claiming to be measured while containing an invented pass.
 */
export function liveModelCaller(
  modelId: string,
  exchanges: readonly LiveModelExchange[],
): ModelCaller {
  const byCaseId = new Map<string, LiveModelExchange>();
  for (const exchange of exchanges) {
    if (exchange.modelIdRequested === modelId) byCaseId.set(exchange.caseId, exchange);
  }
  return (benchmarkCase: BenchmarkCase): ModelResponse => {
    const exchange = byCaseId.get(benchmarkCase.id);
    if (exchange === undefined) {
      throw new LiveRunError(
        'LIVE_CASE_HAS_NO_EXCHANGE',
        'the case has no live provider answer, and grading it from the expected answer would fabricate a pass in a registry that claims to be measured',
        { caseId: benchmarkCase.id, modelId },
      );
    }
    const parsed = exchange.parsed;
    return {
      // Untrusted data. A completion is an observation, never an instruction.
      text: exchange.text,
      parsed,
      toolCalls: readToolCalls(parsed?.toolCalls),
      refused: parsed?.refused === true,
      citedEvidence: readStringArray(parsed?.citedEvidence),
      fabricatedNumber: assertsFabricatedNumber(benchmarkCase, exchange.text, parsed),
      schemaValid: exchange.schemaValid,
      confidenceBps: exchange.confidenceBps,
      usage: usageOf(exchange),
      latencyMs: exchange.latencyMs,
      error: null,
    };
  };
}
