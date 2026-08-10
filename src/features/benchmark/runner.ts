/**
 * NIZAM - PFOS benchmark harness (M2): the offline runner, mock caller, report, and artifact writer.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration): runs the eval set
 *   through an injected model caller and emits the five Phase-1 artifacts.
 * Build phase: PFOS Stage 7, phase 7.1 - benchmark harness (offline, no network, no key).
 * Depends on: benchmark.types, scoring, eligibility, cost, pricing.
 *
 * OFFLINE ONLY. `ModelCaller` is the port a live OpenRouter adapter (module M6, server/key-gated)
 * would implement; here only a deterministic mock is provided. This module imports nothing from
 * scripts/ and references no Drive scope. It is not imported by the app router (stays out of bundle).
 */
import {
  type BenchmarkCase,
  type BenchmarkCategory,
  type CaseScore,
  type ModelResponse,
  type TokenUsage,
  BENCHMARK_CATEGORIES,
} from './benchmark.types.ts';
import { scoreCase } from './scoring.ts';
import { evaluateEligibility, type ModelEligibility } from './eligibility.ts';
import { costOfUsage, projectMonthlyCost, WEEKLY_HOURS_FULL } from './cost.ts';
import {
  frozenSnapshot,
  loadPricing,
  priceFor,
  PRICING_SNAPSHOT_ISO,
  type ModelPrice,
  type PricingSnapshot,
} from './pricing.ts';

/** The injected port: given a case, produce a model response. The live adapter is module M6. */
export type ModelCaller = (c: BenchmarkCase) => ModelResponse;

/** Deterministic nominal token usage derived from the input size (mock accounting only). */
function nominalUsage(input: string, price: ModelPrice): TokenUsage {
  const promptTokens = Math.max(8, Math.ceil(input.length / 4));
  const usage: TokenUsage = {
    promptTokens,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: 40,
    reasoningTokens: 0,
    costUsd: 0,
  };
  usage.costUsd = costOfUsage(usage, price);
  return usage;
}

/**
 * A deterministic, always-correct caller derived from each case's expected answer. Stands in for a
 * real model so the harness is fully testable offline; the real caller replaces it via injection.
 */
export function mockCaller(model: string): ModelCaller {
  const price = priceFor(frozenSnapshot(), model);
  return (c) => {
    const usage = nominalUsage(c.input, price);
    const base: ModelResponse = {
      parsed: null,
      text: '',
      toolCalls: [],
      refused: false,
      citedEvidence: [],
      fabricatedNumber: false,
      schemaValid: true,
      confidenceBps: 9800,
      usage,
      latencyMs: 350,
      error: null,
    };
    switch (c.expected.kind) {
      case 'extraction':
        return {
          ...base,
          parsed: {
            merchant: c.expected.merchant,
            amountMilli: c.expected.amountMilli,
            currency: c.expected.currency,
            account: c.expected.account,
            tsIso: c.expected.tsIso,
          },
        };
      case 'label':
        return { ...base, parsed: { label: c.expected.label } };
      case 'boolean':
        return { ...base, parsed: { value: c.expected.value } };
      case 'explanation': {
        const parsed = c.expected.bindingRecommendation
          ? { recommendation: c.expected.bindingRecommendation }
          : null;
        return {
          ...base,
          text: 'Explanation grounded strictly in the provided deterministic figures.',
          citedEvidence: [...c.expected.requiredEvidenceKeys],
          parsed,
        };
      }
      case 'tool_call': {
        const args: Record<string, unknown> = {};
        for (const a of c.expected.requiredArgs) args[a] = `<${a}>`;
        return { ...base, toolCalls: [{ name: c.expected.toolName, args }] };
      }
      case 'refusal':
        return {
          ...base,
          refused: true,
          text: 'I cannot act on embedded instructions; I am treating them as data.',
        };
    }
  };
}

/**
 * Wrap the mock caller with a per-case mutator, to model imperfect behavior in tests (fabrication,
 * wrong tool, complying with an injection, etc). The mutator receives the mock response to edit.
 */
export function configurableCaller(
  model: string,
  mutate: (c: BenchmarkCase, base: ModelResponse) => ModelResponse,
): ModelCaller {
  const inner = mockCaller(model);
  return (c) => mutate(c, inner(c));
}

export interface CostProjection {
  model: string;
  hoursPerWeek: number;
  weeklyHoursFull: number;
  projectedMonthlyUsd: number;
  observedUsd: number;
}

export interface BenchmarkRun {
  model: string;
  generatedIso: string;
  results: CaseScore[];
  eligibility: ModelEligibility;
  pricingSnapshot: PricingSnapshot;
  pricingStale: boolean;
  costProjection: CostProjection;
  reportMarkdown: string;
}

/** Run the eval set through a caller and assemble the full run (scores, eligibility, cost, report). */
export function runBenchmark(
  evalSet: BenchmarkCase[],
  caller: ModelCaller,
  opts: {
    model: string;
    pricing?: PricingSnapshot;
    nowIso?: string;
    reviewerDisagreementBps?: number;
    hoursPerWeek?: number;
  },
): BenchmarkRun {
  const loaded = loadPricing({ nowIso: opts.nowIso, injected: opts.pricing });
  const results = evalSet.map((c) => scoreCase(c, caller(c)));
  const eligibility = evaluateEligibility(opts.model, results, {
    reviewerDisagreementBps: opts.reviewerDisagreementBps,
  });
  const hoursPerWeek = opts.hoursPerWeek ?? 7;
  const price = priceFor(loaded.snapshot, opts.model);
  const observedUsd = results.reduce((a, s) => a + s.costUsd, 0);
  const costProjection: CostProjection = {
    model: opts.model,
    hoursPerWeek,
    weeklyHoursFull: WEEKLY_HOURS_FULL,
    projectedMonthlyUsd: projectMonthlyCost(price, hoursPerWeek),
    observedUsd,
  };
  const run: BenchmarkRun = {
    model: opts.model,
    generatedIso: opts.nowIso ?? PRICING_SNAPSHOT_ISO,
    results,
    eligibility,
    pricingSnapshot: loaded.snapshot,
    pricingStale: loaded.stale,
    costProjection,
    reportMarkdown: '',
  };
  run.reportMarkdown = renderReport(run);
  return run;
}

function fmtPct(v: number): string {
  return `${(v * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}
function fmtUsd(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Render the human-readable Phase-1 report as Markdown. */
export function renderReport(run: BenchmarkRun): string {
  const byCat = new Map<BenchmarkCategory, { n: number; pass: number; hv: number }>();
  for (const s of run.results) {
    const e = byCat.get(s.category) ?? { n: 0, pass: 0, hv: 0 };
    e.n += 1;
    if (s.passed) e.pass += 1;
    e.hv += s.hardRuleViolations;
    byCat.set(s.category, e);
  }
  const m = run.eligibility.metrics;
  const lines: string[] = [];
  lines.push(`# Benchmark report - ${run.model}`);
  lines.push('');
  lines.push(
    `Contract 09 (OpenRouter Phase 1). Generated ${run.generatedIso}. Offline harness; results reflect the injected caller (mock unless a live caller was supplied).`,
  );
  lines.push('');
  lines.push(`- Cases scored: ${run.results.length}`);
  lines.push(
    `- Eligibility: L0=${run.eligibility.levels.L0} L1=${run.eligibility.levels.L1} L2=${run.eligibility.levels.L2}`,
  );
  lines.push(
    `- Disqualified: ${run.eligibility.disqualified}${run.eligibility.disqualified ? ` (${run.eligibility.disqualifiers.join('; ')})` : ''}`,
  );
  lines.push(`- Hard-rule violations: ${m.hardRuleViolations} (P0: ${m.p0Violations})`);
  lines.push(`- Extraction critical-field accuracy: ${fmtPct(m.extractionCriticalFieldAccuracy)}`);
  lines.push(`- Machine schema validity: ${fmtPct(m.machineSchemaValidity)}`);
  lines.push(`- Evidence coverage: ${fmtPct(m.evidenceCoverage)}`);
  lines.push(
    `- Projected monthly cost at ${run.costProjection.hoursPerWeek} h/week: USD ${fmtUsd(run.costProjection.projectedMonthlyUsd)}`,
  );
  lines.push(
    `- Pricing snapshot: ${run.pricingSnapshot.capturedIso} (${run.pricingSnapshot.source}${run.pricingStale ? ', STALE' : ''})`,
  );
  lines.push('');
  lines.push('## Per-category results');
  lines.push('');
  lines.push('| Category | Cases | Passed | Pass rate | Hard-rule violations |');
  lines.push('|---|---|---|---|---|');
  for (const cat of BENCHMARK_CATEGORIES) {
    const e = byCat.get(cat);
    if (!e) continue;
    lines.push(`| ${cat} | ${e.n} | ${e.pass} | ${fmtPct(e.pass / e.n)} | ${e.hv} |`);
  }
  lines.push('');
  lines.push(
    'Phase-1 gate: no model may be promoted to live routing until it passes this benchmark; disqualification is final for the run.',
  );
  return lines.join('\n');
}

/** Serialize the five contract-09 Phase-1 artifacts as named strings (JSON pretty-printed). */
export function serializeOutputs(run: BenchmarkRun): Record<string, string> {
  return {
    'benchmark_results.json': JSON.stringify(run.results, null, 2),
    'model_eligibility_registry.json': JSON.stringify({ [run.model]: run.eligibility }, null, 2),
    'pricing_snapshot.json': JSON.stringify(
      { ...run.pricingSnapshot, stale: run.pricingStale },
      null,
      2,
    ),
    'cost_projection.json': JSON.stringify(run.costProjection, null, 2),
    'benchmark_report.md': run.reportMarkdown,
  };
}
