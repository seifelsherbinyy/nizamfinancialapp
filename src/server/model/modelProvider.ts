/**
 * NIZAM · The model provider module — the one place a model request is composed and judged
 * Implemented by: PFOS Contract 12 / Phase 2, task **B6**, seam **S3** (spec 07-bot-bringup-v1)
 * Owning requirements: R16 (unreachable from a `T0` turn — the channel above needs a grant), R18
 *   (a provisional registry promotes nothing: this module makes a call POSSIBLE, never routable),
 *   R19 (no prompt text, no completion text and no credential in any recorded row, log line or
 *   refusal detail), R24 (no host, no endpoint literal, no bot, no sender, no figure), contract 12
 *   §6.2.1 (the recorded cost is the provider's ACTUAL reported integer micro-USD, never an estimate),
 *   §6.4 (every request carries the privacy policy)
 * Depends on: ../ports/openrouter (the request, result and telemetry shapes), ../ports/errors (the
 *   cross-tier failure vocabulary), ../config/environment (the per-agent model binding — the one
 *   loader that knows which entry holds which agent's key), ../db/modelTelemetryRepo (the EXISTING
 *   telemetry repository), ../../features/benchmark/providerResponseReader (the EXISTING response
 *   reader and its five refusals). It holds no network primitive — see below.
 *
 * ## What replaced `createUnavailableModelPort`, and what did not
 *
 * `main.ts` wired a port that threw `MODEL_PROVIDER_UNAVAILABLE` for every request, because no module
 * performed one. This is that module. It composes the request body from a {@link ModelRequest},
 * resolves this agent's credential through the one loader that knows its entry name, hands the pair
 * to an injected capability, judges the answer with the SHARED reader, and records what §6.4 permits
 * through the telemetry repository that already exists.
 *
 * **The socket is not here.** Steering §2 gates *making* an outbound call from a server process, so
 * the capability is a parameter — {@link ModelDialFn} — exactly as `providerRequest.ts` does on the
 * messaging side. {@link gatedModelDial} is the implementation that holds no socket and refuses,
 * naming **G4** and **D-BENCH**; `./liveModelDial.ts` is the implementation that dials, and
 * `process/main.ts` selects between them structurally on whether this agent's model credential is
 * configured. Constructing this port therefore reaches nothing, which is how the whole test suite
 * exercises it with no network.
 *
 * **There is no second reader.** The five refusals — a non-success status, an unparseable body, an
 * absent usage block or a non-integer cost, and a substituted model — are
 * `features/benchmark/providerResponseReader.ts`, shared verbatim with the benchmark path. That
 * module was extracted for this task precisely so that a value import from the server tier does not
 * touch `features/benchmark/liveModelCaller.ts`, which `liveModelCaller.isolation.test.ts` keeps
 * unreachable from here. The guard is intact; the judgement is reused.
 *
 * ## What this module does NOT decide
 *
 * It picks no model, reads no eligibility registry, scores no candidate and checks no weekly cap.
 * `modelRouter.routeModel` owns all four, and it still refuses everything while the registry on disk
 * is provisional (R18, steering §3) — which is why B6 makes a call possible and **B8** is what makes
 * one routable. A test states that in those terms: the dial capability is never invoked, because
 * routing never gets as far as naming a model.
 *
 * ## Money, and the one number this module handles
 *
 * `costMicroUsd` is PROVIDER accounting in integer micro-USD, taken exactly as reported and recorded
 * with `costSource: 'provider_reported_actual'`. It is refused rather than coerced if it is not a
 * non-negative safe integer — the shared reader's rule, not a second one. The owner's money is
 * integer milliunits behind `src/lib/money`, which is neither imported nor needed here: this tier
 * sources no monetary number about the owner (§6's standing invariant).
 *
 * ## The credential brand is deliberately its own
 *
 * {@link ModelCredential} is not interchangeable with the messaging tier's `ProviderCredential`. A
 * bot token and a model key are different secrets with different gates (G3 and G4), and a holder that
 * admitted both would let one be composed into the other's address. Two brands make that a compile
 * error rather than a review question. Both hold the same discipline: `toString` and `toJSON` yield
 * the redaction marker, and one named function is the only way to the characters.
 */
import {
  loadAgentModelBinding,
  type EnvSource,
} from '../config/environment.ts';
import {
  ESTIMATE_SOURCE_PREFLIGHT,
  recordTelemetry,
  type PreflightCostEstimate,
  type TelemetryOutcome,
  type TelemetryRecord,
} from '../db/modelTelemetryRepo.ts';
import type { StoreHandle } from '../db/connection.ts';
import type { PortFailure, PortFailureCode } from '../ports/errors.ts';
import type {
  ModelCallTelemetry,
  ModelRequest,
  ModelResult,
  OpenRouterPort,
} from '../ports/openrouter.ts';
import type { SpendAgent } from '../../features/routing/spendLedger.ts';
import {
  ProviderReadError,
  readProviderResponse,
  type ProviderHttpAnswer,
  type ValidatedProviderResponse,
} from '../../features/benchmark/providerResponseReader.ts';

// ---------------------------------------------------------------------------------------------
// The credential holder — resolved, and unprintable
// ---------------------------------------------------------------------------------------------

/** What every accidental stringification of a resolved model credential yields. */
export const MODEL_REDACTION_MARKER = '[redacted]';

declare const MODEL_CREDENTIAL_BRAND: unique symbol;

/**
 * A resolved model credential that cannot be printed. Both `toString` and `toJSON` yield
 * {@link MODEL_REDACTION_MARKER}, so template interpolation, `String()`, `console.log`,
 * `JSON.stringify` and every structured logger reach the marker rather than the characters.
 */
export interface ModelCredential {
  readonly [MODEL_CREDENTIAL_BRAND]: 'a resolved model credential; its characters are reachable only through revealModelCredential';
  toString(): string;
  toJSON(): string;
}

const credentialValues = new WeakMap<ModelCredential, string>();

/** Wrap resolved credential characters so they cannot be printed by accident. */
export function modelCredential(value: string): ModelCredential {
  const holder = Object.freeze({
    toString(): string {
      return MODEL_REDACTION_MARKER;
    },
    toJSON(): string {
      return MODEL_REDACTION_MARKER;
    },
  }) as unknown as ModelCredential;
  credentialValues.set(holder, value);
  return holder;
}

/**
 * The one way to the characters. Called by a {@link ModelDialFn} at the moment it builds the
 * authorization header, and by nothing else — notably by no function in this module.
 */
export function revealModelCredential(credential: ModelCredential): string {
  const value = credentialValues.get(credential);
  if (value === undefined) {
    throw new ModelPortError(
      'credential_not_wrapped',
      'a value offered as a model credential was not produced by modelCredential, so it carries no characters to reveal',
      null,
      { at: 'credential' },
    );
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

/**
 * Why a model request refused. A caller discriminates on this or on {@link PortFailure.code}, never
 * on a message. Each member is a single token, so it is legal as an enumerated log field value.
 */
export const MODEL_PORT_REFUSAL_REASONS = [
  'agent_mismatch',
  'base_absent',
  'credential_absent',
  'credential_not_wrapped',
  'dial_gated',
  'dial_failed',
  'answer_refused',
] as const;
export type ModelPortRefusalReason = (typeof MODEL_PORT_REFUSAL_REASONS)[number];

/**
 * Which cross-tier failure code each reason presents as. Every one of them is
 * `MODEL_PROVIDER_UNAVAILABLE` except the answer that arrived and failed validation, which is a
 * statement about the RESPONSE and therefore `MODEL_RESPONSE_SCHEMA_INVALID` — the code the
 * boundary's own vocabulary already has for it.
 */
const REASON_TO_PORT_CODE: Readonly<Record<ModelPortRefusalReason, PortFailureCode>> = Object.freeze({
  agent_mismatch: 'MODEL_PROVIDER_UNAVAILABLE',
  base_absent: 'MODEL_PROVIDER_UNAVAILABLE',
  credential_absent: 'MODEL_PROVIDER_UNAVAILABLE',
  credential_not_wrapped: 'MODEL_PROVIDER_UNAVAILABLE',
  dial_gated: 'MODEL_PROVIDER_UNAVAILABLE',
  dial_failed: 'MODEL_PROVIDER_UNAVAILABLE',
  answer_refused: 'MODEL_RESPONSE_SCHEMA_INVALID',
});

/**
 * A refused model request, presenting {@link PortFailure}.
 *
 * `detail` holds field paths, entry NAMES, enumerated reasons and a status number. It has no field
 * for a credential, a prompt, a completion or an address, and nothing on this path puts one there
 * (§6.4, R19, R24).
 */
export class ModelPortError extends Error implements PortFailure {
  readonly code: PortFailureCode;
  readonly reason: ModelPortRefusalReason;
  readonly correlationRef: string | null;
  readonly detail: Readonly<Record<string, string>>;

  constructor(
    reason: ModelPortRefusalReason,
    why: string,
    correlationRef: string | null = null,
    detail: Record<string, unknown> = {},
  ) {
    super(`NIZAM model provider: ${why}`);
    this.name = 'ModelPortError';
    this.reason = reason;
    this.code = REASON_TO_PORT_CODE[reason];
    this.correlationRef = correlationRef;
    const flat: Record<string, string> = {};
    for (const [key, value] of Object.entries(detail)) flat[key] = String(value);
    this.detail = Object.freeze(flat);
  }
}

// ---------------------------------------------------------------------------------------------
// The injected capability
// ---------------------------------------------------------------------------------------------

/**
 * A described model exchange. Note what is absent: no header field and no credential field. The
 * credential travels beside the request, so this object may be recorded whole.
 */
export interface ModelDialRequest {
  /** The RESOLVED base address, from the existing `MODEL_API_BASE` entry. No literal lives here. */
  readonly baseUrl: string;
  /** The JSON request body: the model id, the bound, the privacy posture, and the messages. */
  readonly body: string;
  /** Correlation only. A pointer to a telemetry row, never content. */
  readonly correlationRef: string;
}

/**
 * The network capability, injected. This module declares the shape and supplies no implementation
 * that can reach a socket — see {@link gatedModelDial}.
 */
export type ModelDialFn = (
  request: ModelDialRequest,
  credential: ModelCredential,
) => Promise<ProviderHttpAnswer>;

/**
 * The capability under the current gate posture: it refuses, and it holds no socket.
 *
 * This is what a deployment with no model credential wires, so every step of the module runs for
 * real — the agent check, the base resolution, the credential resolution, the body composition — and
 * stops at the one step that is genuinely gated. Nothing pretends a provider answered.
 */
export function gatedModelDial(): ModelDialFn {
  return async (request: ModelDialRequest, credential: ModelCredential): Promise<ProviderHttpAnswer> => {
    void credential;
    throw new ModelPortError(
      'dial_gated',
      'no socket-owning model capability is wired; gate G4 mints the credential and D-BENCH authorises the pass, and steering §2 keeps an outbound call from a server process behind them',
      request.correlationRef,
    );
  };
}

// ---------------------------------------------------------------------------------------------
// The environment entries this module reads
// ---------------------------------------------------------------------------------------------

/**
 * The provider's published base address. **Not a new entry** — it is the existing shared entry in the
 * value ledger, listed for both agents in the deployment templates, and it is referenced here by NAME
 * so no address appears in a tracked file (R24). There is no default: an absent base is a refusal,
 * because a port that chose its own endpoint would be dialling somewhere nobody configured.
 */
export const MODEL_API_BASE_ENTRY = 'MODEL_API_BASE';

// ---------------------------------------------------------------------------------------------
// The request body
// ---------------------------------------------------------------------------------------------

/**
 * Compose the JSON body for one request.
 *
 * The body carries the model id the router named, the output bound, the owner's messages, and the
 * privacy policy the request type makes REQUIRED (§6.4) — including the parameters the router must
 * enforce rather than suggest. It carries no credential: the credential travels beside the request.
 */
export function modelRequestBody(request: ModelRequest): string {
  return JSON.stringify({
    model: request.modelId,
    max_tokens: request.maxOutputTokens,
    messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
    privacy: {
      training: request.privacy.training,
      dataCollectingProviders: request.privacy.dataCollectingProviders,
      zeroDataRetention: request.privacy.zeroDataRetention,
      requiredParameters: [...request.privacy.requiredParameters],
    },
    ...(request.responseSchemaRef === undefined ? {} : { responseSchemaRef: request.responseSchemaRef }),
  });
}

// ---------------------------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------------------------

/** Where a completed or refused call is recorded. Injected, so this module opens no store. */
export type TelemetrySink = (record: TelemetryRecord) => void;

/**
 * Build the loggable projection §6.4 permits: a tier, a model identity, token counts, a latency, a
 * schema verdict, the ACTUAL reported cost, and a correlation reference. There is no field for a
 * prompt or a completion, and `Redacted` over the type means adding one would not compile.
 *
 * A refusal is recorded with zeroed measurements rather than invented ones: nothing was reported, so
 * nothing is claimed. The row's value is that the attempt happened and what it cost, which is zero.
 */
export function modelCallTelemetry(
  request: ModelRequest,
  answer: ValidatedProviderResponse | null,
  outcome: TelemetryOutcome,
): ModelCallTelemetry {
  return {
    correlationRef: request.correlationRef,
    agent: request.agent,
    tier: request.tier,
    modelIdRequested: request.modelId,
    modelIdServed: answer?.modelIdServed ?? request.modelId,
    promptTokens: answer?.promptTokens ?? 0,
    completionTokens: answer?.completionTokens ?? 0,
    costMicroUsd: answer?.costMicroUsd ?? 0,
    costSource: 'provider_reported_actual',
    latencyMs: answer?.latencyMs ?? 0,
    schemaValid: answer?.schemaValid ?? false,
    privacyPolicyAsserted: true,
    outcome,
  };
}

/**
 * Bind a telemetry sink to an open store, through the EXISTING repository.
 *
 * One line of adapter and no second validation: `recordTelemetry` already refuses a malformed row, a
 * cost source that is not the actual, an unasserted privacy policy, and a stored row that breached
 * the content rules. This hands it the record and nothing else.
 */
export function storeTelemetrySink(handle: StoreHandle): TelemetrySink {
  return (record: TelemetryRecord): void => {
    recordTelemetry(handle, record);
  };
}

/** A sink whose destination is bound after construction, and what binds it. */
export interface BindableTelemetrySink {
  readonly sink: TelemetrySink;
  /** Bind the store. Called once, when the process has opened it. */
  bind(handle: StoreHandle): void;
  /** How many records arrived before a store was bound. Reported, never silently zero. */
  unbound(): number;
}

/**
 * A sink the process can wire BEFORE its store is open.
 *
 * The model port is assembled from the host while the store opens later inside the boot sequence, so
 * the sink has to exist before its destination does. Records that arrive while it is unbound are
 * COUNTED rather than thrown away silently and rather than raised — a telemetry row is an
 * observation about a call, and losing the call because the observation could not be filed would put
 * the record ahead of the work.
 */
export function createBindableTelemetrySink(): BindableTelemetrySink {
  let bound: TelemetrySink | null = null;
  let missed = 0;
  return {
    sink: (record: TelemetryRecord): void => {
      if (bound === null) {
        missed += 1;
        return;
      }
      bound(record);
    },
    bind(handle: StoreHandle): void {
      bound = storeTelemetrySink(handle);
    },
    unbound(): number {
      return missed;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------------------------

/** What the port needs. Every boundary is injected; nothing is read ambiently. */
export interface ModelProviderContext {
  /** Whose key, whose bound, whose row. One agent per port (R17). */
  readonly agent: SpendAgent;
  /** The environment the ONE ambient bridge produced. Read for two entry names, never for a host. */
  readonly env: EnvSource;
  /** The capability. {@link gatedModelDial} until G4 and D-BENCH are done. */
  readonly dial: ModelDialFn;
  /** UTC instant, injected. */
  readonly now: () => string;
  /** A unique row reference, injected, so this module owns no randomness. */
  readonly newId: () => string;
  /** Where a completed or refused call is recorded. */
  readonly record: TelemetrySink;
  /** Present only where a pre-flight estimate actually gated the call (§6.2.1). */
  readonly preflightEstimateMicroUsd?: number;
}

/**
 * Resolve this agent's credential, or refuse.
 *
 * The entry NAME comes from `loadAgentModelBinding`, which is the one loader that knows which entry
 * holds which agent's key — so a `finance` port can never read the life agent's entry, and the name
 * is not spelled here. The value is read once, wrapped immediately, and never returned upward.
 */
function resolveCredential(ctx: ModelProviderContext, correlationRef: string): ModelCredential {
  // Presence-checked by the loader, which refuses an absent or placeholder entry by name.
  const binding = loadAgentModelBinding({ agent: ctx.agent, env: ctx.env });
  const raw = String(ctx.env[binding.apiKeyRef] ?? '').trim();
  if (raw.length === 0) {
    throw new ModelPortError(
      'credential_absent',
      'this agent\'s model credential entry is empty, so no request can be authorised; gate G4 places it in the host configuration directory',
      correlationRef,
      { at: 'apiKeyRef', entryName: binding.apiKeyRef },
    );
  }
  return modelCredential(raw);
}

/** Resolve the provider base, or refuse. No default, and no address in this file. */
function resolveBase(ctx: ModelProviderContext, correlationRef: string): string {
  const base = String(ctx.env[MODEL_API_BASE_ENTRY] ?? '').trim();
  if (base.length === 0) {
    throw new ModelPortError(
      'base_absent',
      'the entry naming the provider base is absent, and there is no default endpoint, so no request can be addressed',
      correlationRef,
      { at: 'base', entryName: MODEL_API_BASE_ENTRY },
    );
  }
  return base;
}

/**
 * The model port (**seam S3**): compose, dial, judge, record.
 *
 * Reachable only through `createModelChannel`, which demands a grant `classifyTurn` minted — so a
 * turn classified `T0` cannot arrive here at all (R16). Nothing in this function widens that: it
 * neither classifies nor mints.
 */
export function createModelProviderPort(ctx: ModelProviderContext): OpenRouterPort {
  const estimate: PreflightCostEstimate | undefined =
    ctx.preflightEstimateMicroUsd === undefined
      ? undefined
      : { estimateSource: ESTIMATE_SOURCE_PREFLIGHT, microUsd: ctx.preflightEstimateMicroUsd };

  const write = (request: ModelRequest, answer: ValidatedProviderResponse | null, outcome: TelemetryOutcome): void => {
    ctx.record({
      id: ctx.newId(),
      occurredAt: ctx.now(),
      telemetry: modelCallTelemetry(request, answer, outcome),
      ...(estimate === undefined ? {} : { preflightEstimate: estimate }),
    });
  };

  return {
    async complete(request: ModelRequest): Promise<ModelResult> {
      if (request.agent !== ctx.agent) {
        throw new ModelPortError(
          'agent_mismatch',
          'this port belongs to one agent and the request names another; one key, one bound and one store per agent (R17)',
          request.correlationRef,
          { portAgent: ctx.agent, requestAgent: request.agent },
        );
      }

      const baseUrl = resolveBase(ctx, request.correlationRef);
      const credential = resolveCredential(ctx, request.correlationRef);

      let answer: ProviderHttpAnswer;
      try {
        answer = await ctx.dial(
          Object.freeze({ baseUrl, body: modelRequestBody(request), correlationRef: request.correlationRef }),
          credential,
        );
      } catch (cause) {
        // A dial that produced no answer is recorded as a provider error and re-raised. The platform's
        // own error is never chained: its message names the host it failed to reach (R24).
        write(request, null, 'provider_error');
        if (cause instanceof ModelPortError) throw cause;
        throw new ModelPortError(
          'dial_failed',
          'the request was refused before an answer could be read; neither the address nor the body is reported here',
          request.correlationRef,
        );
      }

      let validated: ValidatedProviderResponse;
      try {
        // The SHARED reader. Five refusals, one implementation, no second reader in this tier.
        validated = readProviderResponse({
          subject: { ref: request.correlationRef, modelIdRequested: request.modelId },
          response: answer,
        });
      } catch (cause) {
        write(request, null, 'provider_error');
        if (!(cause instanceof ProviderReadError)) throw cause;
        throw new ModelPortError('answer_refused', cause.message, request.correlationRef, {
          ...cause.detail,
          readCode: cause.code,
        });
      }

      write(request, validated, 'ok');
      return Object.freeze({
        modelIdServed: validated.modelIdServed,
        text: validated.text,
        parsed: validated.parsed,
        schemaValid: validated.schemaValid,
        usage: Object.freeze({
          promptTokens: validated.promptTokens,
          cachedTokens: validated.cachedTokens,
          completionTokens: validated.completionTokens,
          reasoningTokens: validated.reasoningTokens,
          costMicroUsd: validated.costMicroUsd,
          costSource: 'provider_reported_actual',
        }),
        latencyMs: validated.latencyMs,
        correlationRef: request.correlationRef,
      });
    },
  };
}
