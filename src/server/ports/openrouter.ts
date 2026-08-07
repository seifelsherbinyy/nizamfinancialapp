/**
 * NIZAM · OpenRouterPort — the privacy policy is part of the request, not an option
 * Implemented by: PFOS Contract 12 / Phase 2.1 (spec 06-two-agent-vps)
 * Owning requirements: R16 (no model on T0), R18 (eligibility), R19 (privacy + no prompt in logs)
 * Depends on: shapeGuards.ts, ../../features/routing/modelPolicy, ../../features/routing/spendLedger
 *   (all type-only imports, so nothing is pulled into any bundle)
 *
 * Contract 12 §6.3 and §6.4 in interface form. This port agrees with the offline shapes that
 * already exist in `src/features/benchmark/` rather than inventing a parallel vocabulary: the
 * routing tier is `modelPolicy`'s `Tier`, and cost accounting reuses `spendLedger`'s
 * micro-USD/actual-cost vocabulary. There is no second definition of either.
 *
 * Three things this file makes impossible to express:
 *
 *  1. **A request that forgets the provider privacy policy (§6.4, R19).** `privacy` is a
 *     REQUIRED field of {@link ModelRequest}. Omitting it is a compile error, so "every request
 *     carries the policy" is a property of the type rather than a habit. And within the policy,
 *     `training: 'excluded'` and `dataCollectingProviders: 'denied'` are **single-member**
 *     literal types — the same technique `spendLedgerRepo` uses for `costSource` — so there is
 *     no value meaning "training allowed". An account-level default is a second belt; a
 *     per-request assertion is what a test can observe.
 *  2. **A model call on the no-model tier (§6.1, R16).** `tier` is `Exclude<Tier, 'T0'>`. A T0
 *     request does not type check, which is a stronger statement than a runtime branch that
 *     happens not to be taken.
 *  3. **Prompt or completion text in a log line (§6.4, R19).** {@link ModelCallTelemetry} — the
 *     only record on this boundary that is meant to be written down — is wrapped in `Redacted`,
 *     so a field named for content cannot hold a string. What may be logged is exactly what
 *     §6.4 permits: a tier, a model identity, token counts, latency, a schema verdict, an actual
 *     reported cost, a correlation reference. {@link PortFailure} has no content field either.
 *
 * Money note: `costMicroUsd` is PROVIDER accounting in integer micro-USD and is deliberately
 * separate from the owner's financial ledger, which is integer milliunits behind `src/lib/money`
 * (contract 06 §6.1). This module introduces no arithmetic and no second money implementation.
 * No secret and no endpoint literal appears here — see {@link OpenRouterPortConfig}.
 */
import type { Tier } from '../../features/routing/modelPolicy';
import type { CostSourceActual, SpendAgent } from '../../features/routing/spendLedger';
import type { Redacted } from './shapeGuards';

/**
 * Zero-data-retention inference, required where the content class demands it (§6.4). There is no
 * `off` member: the weaker posture a caller may choose is `preferred`, never disabled.
 */
export const ZERO_DATA_RETENTION_POSTURES = ['required', 'preferred'] as const;
export type ZeroDataRetentionPosture = (typeof ZERO_DATA_RETENTION_POSTURES)[number];

/**
 * The provider privacy policy carried on every request (§6.4). The first two fields are
 * single-member literals on purpose: the permissive value is not part of the type.
 */
export interface ProviderPrivacyPolicy {
  readonly training: 'excluded';
  readonly dataCollectingProviders: 'denied';
  readonly zeroDataRetention: ZeroDataRetentionPosture;
  /** Provider parameters the request requires the router to enforce rather than suggest. */
  readonly requiredParameters: readonly string[];
}

/** What class of content the request carries, which is what decides the retention posture. */
export const MODEL_CONTENT_CLASSES = ['financial', 'operational'] as const;
export type ModelContentClass = (typeof MODEL_CONTENT_CLASSES)[number];

export const MODEL_ROLES = ['system', 'user', 'assistant'] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** One turn of the exchange. Content lives here and travels nowhere else (§6.4). */
export interface ModelMessage {
  readonly role: ModelRole;
  readonly content: string;
}

/**
 * A request to the model tier. Note what is required and what is absent: the privacy policy is
 * required; there is no `apiKey` field, because a key is never passed through a call site; and
 * there is no field asking the model for a monetary figure, because the model tier never sources
 * one — the deterministic engines do (§6, standing invariant).
 */
export interface ModelRequest {
  readonly agent: SpendAgent;
  /** R16: the no-model tier is not a member of this type, so a T0 request cannot be written. */
  readonly tier: Exclude<Tier, 'T0'>;
  /** Must be present in the eligibility registry; absent means ineligible (§6.3, R18). */
  readonly modelId: string;
  readonly contentClass: ModelContentClass;
  /** REQUIRED (§6.4). No default, no optional marker, no account-level fallback on this path. */
  readonly privacy: ProviderPrivacyPolicy;
  readonly messages: readonly ModelMessage[];
  readonly maxOutputTokens: number;
  /** A reference to the response schema the router will validate against, if the task has one. */
  readonly responseSchemaRef?: string;
  /** Correlation only. A reference, never content. */
  readonly correlationRef: string;
}

/** Provider-reported usage. Cost is the ACTUAL reported figure, in integer micro-USD (§6.2). */
export interface ModelUsage {
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
  readonly costMicroUsd: number;
  /** Single-member literal: a pre-flight estimate may gate a call and is never what is reported. */
  readonly costSource: CostSourceActual;
}

/**
 * What the provider returned. `text` and `parsed` are **untrusted data**: a response cannot issue
 * an instruction, and a deterministic policy gate runs before and after any synthesis (§6.4).
 * This is the one type on the boundary that carries content, and it is not loggable.
 */
export interface ModelResult {
  /** The model the provider actually served, which may differ from the one requested. */
  readonly modelIdServed: string;
  readonly text: string;
  readonly parsed: Record<string, unknown> | null;
  readonly schemaValid: boolean;
  readonly usage: ModelUsage;
  readonly latencyMs: number;
  readonly correlationRef: string;
}

/**
 * The loggable projection of a call — redacted features only (§6.4, R19). `Redacted` types every
 * content-bearing key as `never`, so adding `prompt` or `completion` here later would not compile.
 * Logs are structured for exactly this reason: redaction becomes a property of the schema instead
 * of a formatting string somebody edits.
 */
export type ModelCallTelemetry = Redacted<{
  readonly correlationRef: string;
  readonly agent: SpendAgent;
  readonly tier: Exclude<Tier, 'T0'>;
  readonly modelIdRequested: string;
  readonly modelIdServed: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costMicroUsd: number;
  readonly costSource: CostSourceActual;
  readonly latencyMs: number;
  readonly schemaValid: boolean;
  /** Single-member literal: a row that exists is a row whose request carried the policy. */
  readonly privacyPolicyAsserted: true;
  readonly outcome: 'ok' | 'refused' | 'provider_error';
}>;

/**
 * The model boundary.
 *
 * Rejects with a {@link import('./errors').PortFailure} when the weekly cap for this agent is
 * exhausted, when the model is absent from the eligibility registry, when the registry is marked
 * provisional, or when the kill switch is engaged. §6.2: exhaustion refuses MODEL calls and never
 * suppresses a deterministic alert — which is why nothing in this interface is on the path that
 * produces an obligation alert or a safe-to-spend figure.
 */
export interface OpenRouterPort {
  complete(request: ModelRequest): Promise<ModelResult>;
}

/**
 * Injected configuration. `apiKeyRef` is the NAME of the environment entry that holds the key,
 * never the key: no secret value is expressible on this boundary, and there is no default
 * endpoint (steering §2, §0b).
 */
export interface OpenRouterPortConfig {
  /** One key per agent, so exhaustion is scoped to one agent at the provider too (§6.2). */
  readonly agent: SpendAgent;
  readonly apiBaseUrlRef: string;
  readonly apiKeyRef: string;
  /** This agent's weekly cap, in integer micro-USD. Injected; no cap literal lives in code (§6.2). */
  readonly weeklyCapMicroUsd: number;
  /** Where the sentinel file lives. Checked per call, so one touch halts every writer (design 7). */
  readonly killSwitchSentinelPathRef: string;
  /** Where the eligibility registry is read from. A provisional one refuses routing (§6.3, R18). */
  readonly eligibilityRegistryPathRef: string;
}
