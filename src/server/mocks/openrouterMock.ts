/**
 * NIZAM · Deterministic OpenRouterPort mock — every §6 refusal, and no provider
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Owning requirements: R16 (no model on the deterministic tier), R18 (eligibility), R19 (privacy)
 * Depends on: ../ports/openrouter, ../ports/errors, ./invocationRecorder, ./failure
 *
 * The BUILD half of the model boundary (steering §2). The live half is gated behind G4, and the
 * single permitted network exception is the dev-key benchmark run from the developer machine
 * (steering §3) — not this. Nothing here resolves a network module, names an endpoint, or holds
 * a key: `apiKeyRef` on {@link OpenRouterPortConfig} is the NAME of an environment entry.
 *
 * Determinism. There is no clock and no randomness. `latencyMs` is injected or fixed, token
 * counts and the synthetic cost are integer functions of the request, and replay is keyed by
 * `correlationRef` rather than by call order, so the same script twice yields identical results
 * and a test may compare a whole {@link ModelResult}.
 *
 * The refusals a caller can drive, which the Phase 4 negative tests need:
 *   - **cap exhausted** (§6.2): the PRE-FLIGHT estimate gates the call, and exhaustion refuses
 *     the MODEL call only. Nothing in this mock is on the path that produces an obligation alert
 *     or a safe-to-spend figure, so an exhausted cap cannot suppress a deterministic alert;
 *   - **kill switch engaged** (design key decision 7), checked per call;
 *   - **a provisional eligibility registry** (§6.3, R18), which may never promote a model;
 *   - **a model absent from the registry**;
 *   - **an unsatisfied privacy policy** (§6.4, R19) — financial content requires zero-data
 *     retention, and `preferred` is not good enough for it;
 *   - **a provider error**;
 *   - **a response that fails schema validation**, which is a refusal rather than a value the
 *     caller has to remember to check.
 *
 * Money and cost. `costMicroUsd` is provider accounting in integer micro-USD and is deliberately
 * a different unit from the owner's ledger, which is integer milliunits behind `src/lib/money`
 * (contract 06 §6.1). There is no float here and no second money implementation; the synthetic
 * rate below is a test fixture, not a price.
 *
 * What is recorded. The invocation detail is a redacted projection — tier, model, content class,
 * message count, correlation reference. Prompt and completion text are never recorded, and
 * {@link ModelCallTelemetry} cannot hold them because `Redacted` types those keys `never` (§6.4).
 */
import type { PortFailureCode } from '../ports/errors.ts';
import type {
  ModelCallTelemetry,
  ModelRequest,
  ModelResult,
  OpenRouterPort,
  OpenRouterPortConfig,
} from '../ports/openrouter.ts';
import { COST_SOURCE_ACTUAL } from '../../features/routing/spendLedger.ts';
import { MockPortFailure } from './failure.ts';
import type { InvocationRecorder } from './invocationRecorder.ts';

/**
 * One recorded model exchange — the replay unit. Declared here because it is the mock's input;
 * `fixtures.ts` re-exports the type so a fixture document and a replay share one definition.
 */
export interface RecordedModelExchange {
  readonly correlationRef: string;
  readonly modelIdServed: string;
  readonly text: string;
  readonly parsed: Record<string, unknown> | null;
  readonly schemaValid: boolean;
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
  /** Provider accounting, integer micro-USD (contract 06 §6.1). Not owner money. */
  readonly costMicroUsd: number;
  readonly latencyMs: number;
}

/** Synthetic per-token rates, integer micro-USD. A test fixture, not a price. */
const SYNTHETIC_PROMPT_RATE_MICRO_USD = 1;
const SYNTHETIC_COMPLETION_RATE_MICRO_USD = 3;
/** Fixed latency, so a result is comparable field for field without a clock. */
const SYNTHETIC_LATENCY_MS = 12;

export interface OpenRouterMockConfig {
  readonly config: OpenRouterPortConfig;
  readonly recorder: InvocationRecorder;
  /** The registry, as this mock sees it. A model absent from it is ineligible (§6.3). */
  readonly eligibleModelIds: readonly string[];
  /** §6.3, R18: a provisional registry refuses routing outright. */
  readonly registryProvisional?: boolean;
  /** Design key decision 7: a sentinel that halts every writer, checked per call. */
  readonly killSwitchEngaged?: boolean;
  readonly providerUnavailable?: boolean;
  /** Micro-USD this agent has already spent this week, so a test can start near the cap. */
  readonly alreadySpentMicroUsd?: number;
  /** Recorded exchanges to replay, keyed by correlation reference. */
  readonly exchanges?: readonly RecordedModelExchange[];
  readonly latencyMs?: number;
}

export interface OpenRouterMock {
  readonly port: OpenRouterPort;
  /** The loggable projection of every call this mock answered (§6.4). */
  readonly telemetry: readonly ModelCallTelemetry[];
  /** Running provider spend for this agent, integer micro-USD. */
  readonly spentMicroUsd: number;
  readonly recorder: InvocationRecorder;
}

/** Prompt tokens as an integer function of the request. Deterministic, and no clock. */
function promptTokensOf(request: ModelRequest): number {
  let characters = 0;
  for (const message of request.messages) characters += message.content.length;
  return characters;
}

/** Completion tokens, bounded by what the caller allowed. Integer, deterministic. */
function completionTokensOf(request: ModelRequest, promptTokens: number): number {
  return Math.min(request.maxOutputTokens, 8 + (promptTokens % 8));
}

/**
 * §6.4: financial content requires zero-data-retention inference. `preferred` is a weaker
 * posture that operational content may choose and financial content may not.
 */
function privacySatisfied(request: ModelRequest): boolean {
  if (request.contentClass !== 'financial') return true;
  return request.privacy.zeroDataRetention === 'required';
}

export function createOpenRouterMock(mockConfig: OpenRouterMockConfig): OpenRouterMock {
  const { config, recorder } = mockConfig;
  const replay = new Map<string, RecordedModelExchange>();
  for (const exchange of mockConfig.exchanges ?? []) replay.set(exchange.correlationRef, exchange);

  const telemetry: ModelCallTelemetry[] = [];
  let spentMicroUsd = mockConfig.alreadySpentMicroUsd ?? 0;

  function noteTelemetry(
    request: ModelRequest,
    outcome: ModelCallTelemetry['outcome'],
    detail: {
      modelIdServed: string;
      promptTokens: number;
      completionTokens: number;
      costMicroUsd: number;
      latencyMs: number;
      schemaValid: boolean;
    },
  ): void {
    telemetry.push({
      correlationRef: request.correlationRef,
      agent: request.agent,
      tier: request.tier,
      modelIdRequested: request.modelId,
      modelIdServed: detail.modelIdServed,
      promptTokens: detail.promptTokens,
      completionTokens: detail.completionTokens,
      costMicroUsd: detail.costMicroUsd,
      costSource: COST_SOURCE_ACTUAL,
      latencyMs: detail.latencyMs,
      schemaValid: detail.schemaValid,
      privacyPolicyAsserted: true,
      outcome,
    });
  }

  function refuse(request: ModelRequest, code: PortFailureCode, why: string): never {
    noteTelemetry(request, code === 'MODEL_PROVIDER_UNAVAILABLE' ? 'provider_error' : 'refused', {
      modelIdServed: request.modelId,
      promptTokens: 0,
      completionTokens: 0,
      costMicroUsd: 0,
      latencyMs: 0,
      schemaValid: false,
    });
    throw new MockPortFailure(code, `NIZAM openrouter mock: ${why}`, request.correlationRef);
  }

  const port: OpenRouterPort = {
    async complete(request: ModelRequest): Promise<ModelResult> {
      // Redacted projection only. Message CONTENT is never recorded (§6.4, R19).
      recorder.record('openrouter', 'complete', {
        correlationRef: request.correlationRef,
        agent: request.agent,
        tier: request.tier,
        modelId: request.modelId,
        contentClass: request.contentClass,
        messageCount: request.messages.length,
        zeroDataRetention: request.privacy.zeroDataRetention,
      });

      if (mockConfig.killSwitchEngaged === true) {
        refuse(request, 'MODEL_KILL_SWITCH_ENGAGED', 'the kill switch sentinel is present');
      }
      if (!privacySatisfied(request)) {
        refuse(
          request,
          'MODEL_PRIVACY_POLICY_UNSATISFIED',
          'financial content requires zero-data-retention inference',
        );
      }
      if (mockConfig.registryProvisional === true) {
        refuse(
          request,
          'MODEL_ELIGIBILITY_REGISTRY_PROVISIONAL',
          'the eligibility registry is provisional, so no model may be promoted for live routing',
        );
      }
      if (!mockConfig.eligibleModelIds.includes(request.modelId)) {
        refuse(request, 'MODEL_NOT_IN_ELIGIBILITY_REGISTRY', 'the requested model is not in the registry');
      }

      const recorded = replay.get(request.correlationRef);
      const promptTokens = recorded?.promptTokens ?? promptTokensOf(request);
      const completionTokens = recorded?.completionTokens ?? completionTokensOf(request, promptTokens);
      const costMicroUsd =
        recorded?.costMicroUsd ??
        promptTokens * SYNTHETIC_PROMPT_RATE_MICRO_USD + completionTokens * SYNTHETIC_COMPLETION_RATE_MICRO_USD;

      // §6.2: a pre-flight estimate may GATE the call. What gets RECORDED below is the
      // provider-reported actual, which is why `costSource` has only one member.
      if (spentMicroUsd + costMicroUsd > config.weeklyCapMicroUsd) {
        refuse(request, 'MODEL_WEEKLY_CAP_EXHAUSTED', 'this agent has exhausted its weekly cap');
      }
      if (mockConfig.providerUnavailable === true) {
        refuse(request, 'MODEL_PROVIDER_UNAVAILABLE', 'the provider is unavailable');
      }

      const schemaValid = recorded?.schemaValid ?? true;
      if (request.responseSchemaRef !== undefined && !schemaValid) {
        refuse(request, 'MODEL_RESPONSE_SCHEMA_INVALID', 'the response did not satisfy the declared schema');
      }

      const latencyMs = recorded?.latencyMs ?? mockConfig.latencyMs ?? SYNTHETIC_LATENCY_MS;
      const modelIdServed = recorded?.modelIdServed ?? request.modelId;
      spentMicroUsd += costMicroUsd;

      noteTelemetry(request, 'ok', {
        modelIdServed,
        promptTokens,
        completionTokens,
        costMicroUsd,
        latencyMs,
        schemaValid,
      });

      return {
        modelIdServed,
        // Untrusted data: a completion is never an instruction (§6.4).
        text: recorded?.text ?? `mock-completion:${request.modelId}:${request.correlationRef}`,
        parsed: recorded?.parsed ?? null,
        schemaValid,
        usage: {
          promptTokens,
          cachedTokens: recorded?.cachedTokens ?? 0,
          completionTokens,
          reasoningTokens: recorded?.reasoningTokens ?? 0,
          costMicroUsd,
          costSource: COST_SOURCE_ACTUAL,
        },
        latencyMs,
        correlationRef: request.correlationRef,
      };
    },
  };

  return {
    port,
    get telemetry() {
      return [...telemetry];
    },
    get spentMicroUsd() {
      return spentMicroUsd;
    },
    recorder,
  };
}
