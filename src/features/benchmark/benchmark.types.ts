/**
 * NIZAM - PFOS benchmark harness (M2): shared types + the eval-set contract constants.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration): the >=210-case
 *   eval set, per-task scoring, and the L0/L1/L2 eligibility gates.
 * Build phase: PFOS Stage 7, phase 7.1 - benchmark harness (offline, no network, no key).
 * Depends on: nothing (pure types + constants).
 *
 * OFFLINE ONLY. This module never calls a model or the network. The live OpenRouter caller is an
 * injected port (see runner.ts `ModelCaller`); only a deterministic mock is provided here. The live
 * adapter is module M6 and is server/key-gated. Monetary amounts are INTEGER milliunits (money core
 * convention); USD prices use `*UsdPerMillion` fields (never a money-named field) per AC07.
 */

/** The nine benchmark categories from contract 09, with their minimum case counts. */
export const CATEGORY_MINIMUMS = {
  sms_extraction: 50,
  classification: 30,
  dedup: 25,
  safe_to_spend_explanation: 25,
  purchase_decision: 25,
  forecast: 20,
  tool_call: 15,
  multilingual: 10,
  adversarial: 10,
} as const;

export type BenchmarkCategory = keyof typeof CATEGORY_MINIMUMS;
export const BENCHMARK_CATEGORIES = Object.keys(CATEGORY_MINIMUMS) as BenchmarkCategory[];

/** Total minimum the assembled set must reach (contract 09: benchmark_minimum_cases = 210). */
export const BENCHMARK_MINIMUM_CASES = 210;

/** Routing tier a category exercises (contract 10 taxonomy). */
export type TaskTier = 'T1' | 'T2' | 'T3' | 'T4';

/** Severity of a hard-safety breach on the case. P0 is an automatic failure (contract 09). */
export const SEVERITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Which category maps to which routing tier (for eligibility roll-up). */
export const CATEGORY_TIER: Record<BenchmarkCategory, TaskTier> = {
  sms_extraction: 'T1',
  classification: 'T1',
  dedup: 'T1',
  safe_to_spend_explanation: 'T2',
  purchase_decision: 'T3',
  forecast: 'T2',
  tool_call: 'T2',
  multilingual: 'T2',
  adversarial: 'T3',
};

/** A single benchmark case. `expected` is discriminated by `category`. */
export interface BenchmarkCase {
  id: string;
  category: BenchmarkCategory;
  tier: TaskTier;
  /** The prompt/event the model receives (free text; may embed a sanitized SMS or a task). */
  input: string;
  /** The correct structured answer for the case (category-specific shape). */
  expected: ExpectedAnswer;
  /** Invariants that must never be violated; a violation of any is a hard-rule breach. */
  safetyConstraints: string[];
  /** What may legitimately vary between correct answers (guidance for graders). */
  allowableVariation: string;
  severity: Severity;
}

/** Structured extraction target (amounts are INTEGER milliunits). */
export interface ExtractionExpected {
  kind: 'extraction';
  merchant: string;
  amountMilli: number;
  currency: string;
  account: string;
  tsIso: string;
  /** The subset that is critical - a wrong value here fails critical-field accuracy. */
  criticalFields: ('amountMilli' | 'tsIso' | 'account')[];
}
export interface LabelExpected {
  kind: 'label';
  label: string;
}
export interface BooleanExpected {
  kind: 'boolean';
  value: boolean;
}
/** Explanation / advice: must cite evidence and must not invent numbers or override policy. */
export interface ExplanationExpected {
  kind: 'explanation';
  requiredEvidenceKeys: string[];
  forbiddenClaims: string[];
  /** For a purchase-decision case, the deterministic recommendation the model must not override. */
  bindingRecommendation?: string;
}
export interface ToolCallExpected {
  kind: 'tool_call';
  toolName: string;
  requiredArgs: string[];
}
/** Adversarial: the model must refuse / not comply and must take no tool action. */
export interface RefusalExpected {
  kind: 'refusal';
}
export type ExpectedAnswer =
  | ExtractionExpected
  | LabelExpected
  | BooleanExpected
  | ExplanationExpected
  | ToolCallExpected
  | RefusalExpected;

/** Token accounting from a (real) OpenRouter response; the mock fills plausible values. */
export interface TokenUsage {
  promptTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** Actual charged USD cost (contract 09: prefer usage.cost over estimates). */
  costUsd: number;
}

/** A model's answer to one case, as the runner/scorer consumes it. */
export interface ModelResponse {
  /** Structured output for extraction/label/boolean/tool tasks (null if none). */
  parsed: Record<string, unknown> | null;
  /** Free-text answer for explanation tasks. */
  text: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  /** True if the model refused / declined to comply (relevant to adversarial cases). */
  refused: boolean;
  /** Evidence keys the model cited (for explanation coverage). */
  citedEvidence: string[];
  /** True if the model asserted a number that did not come from the deterministic input. */
  fabricatedNumber: boolean;
  schemaValid: boolean;
  confidenceBps: number;
  usage: TokenUsage;
  latencyMs: number;
  error: string | null;
}

/** Score for one case after grading. */
export interface CaseScore {
  caseId: string;
  category: BenchmarkCategory;
  tier: TaskTier;
  severity: Severity;
  /** Task-specific metric in [0,1]. */
  metric: number;
  /** True when the case is fully correct (metric == 1 and no hard-rule breach). */
  passed: boolean;
  /** Count of hard-safety constraint breaches (a P0 breach is disqualifying). */
  hardRuleViolations: number;
  /** True if the model produced schema-valid structured output where required. */
  schemaValid: boolean;
  /** For extraction: fraction of critical fields correct (1 when no critical fields). */
  criticalFieldAccuracy: number;
  /** For explanation: fraction of required evidence keys cited (1 when none required). */
  evidenceCoverage: number;
  latencyMs: number;
  costUsd: number;
}
