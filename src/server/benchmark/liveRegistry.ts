/**
 * NIZAM · The live eligibility registry — `provisional: false` exists only downstream of a witness
 * Implemented by: PFOS Contract 12 / Phase 6.3 (spec 06-two-agent-vps)
 * Owning requirements: R18 (a model is selected only if the registry lists it; a `provisional`
 *   registry does not permit live routing); R24 (no deployment particular in a tracked file);
 *   steering §3 (the dev-key carve-out: a live run from the developer machine, for this one artifact)
 * Depends on: ../routing/eligibilityRegistry (the document shape), ../../features/benchmark/*
 *   (contract 09's harness and 6.1's two gates). Its edges to the live adapter are TYPE-ONLY, and
 *   both of the capabilities it needs from that module are INJECTED - see "Reachability" below.
 *
 * NO NETWORK. NO KEY. NO PROVIDER. This module grades exchanges that already happened; it cannot cause
 * one to happen. It is the counterpart of 6.2's `provisionalRegistry.ts` and reuses that phase's
 * decisions verbatim wherever they still apply.
 *
 * ## Reachability: why a server process cannot drive this into existence
 *
 * `emitLiveRegistry` is reachable from the server tier - it lives in it. What a server process cannot
 * do is CALL it, because two of its parameters are required and neither can be produced without
 * importing `features/benchmark/liveModelCaller`, which no server module does (asserted by
 * `liveModelCaller.isolation.test.ts`, with a negative test that breaks the assertion and watches it
 * fire):
 *
 *  - `buildCaller` turns live exchanges into contract 09's `ModelCaller`. There is no default, and this
 *    module has no expression that could construct one.
 *  - `verifyWitness` decides whether the {@link LiveMeasurementWitness} is genuine. There is no default
 *    and no fallback to `true`; the real implementation is `isLiveMeasurementWitness`, whose backing
 *    `WeakSet` lives in the benchmark tier.
 *
 * Every edge this file has to that module is `import type`, which TypeScript erases, so the compiled
 * output contains no reference to it at all. The injection is therefore not a style choice - it is what
 * keeps the erased edge honest.
 *
 * ## Where this differs from 6.2, and why each difference is load-bearing
 *
 *  1. **`provisional` is the literal `false`, and it is earned.** 6.2 could not write a non-provisional
 *     document at all: its only construction path was `provisionalRegistryFromFixture`, whose flag is
 *     the loader's own `true`. Here the flag is `false`, so the guard has to be somewhere else - it is
 *     {@link assertWitnessedRuns}, which refuses unless every run carries a witness that `verifyWitness`
 *     accepts, every witness names the run's own model, and every witness accounts for every case in the
 *     eval set. A registry that claims measurement it does not have has no path through this function.
 *  2. **There is no correct-answer baseline.** The injected caller is expected to refuse a case it has
 *     no answer for, which is what `liveModelCaller` does. 6.2's fixture caller deliberately falls back
 *     to the correct answer, and marking its registry provisional is the price of that fallback.
 *  3. **`developerBuild` is STILL `false`, and still `unmeasured`.** This is the difference readers are
 *     most likely to expect and it does not exist. Contract 09 grades developer/build work "based on
 *     code benchmark and repository tests, **separate from live finance eligibility**". A live run over
 *     the FINANCE eval set measures finance work; it runs no code benchmark and records no per-candidate
 *     repository-test result. So the verdict is `unmeasured` with reason `code_benchmark_not_run`, and
 *     `developerBuildPasses` answers `false` for it. Consequence, stated plainly: even a fully measured
 *     live registry leaves contract 10's **T4** tier unroutable, because `TIER_REQUIRED_ELIGIBILITY.T4`
 *     asks for the developer verdict and no finance run can supply one.
 *  4. **The actual reported cost is recorded.** Contract 09's source precedence puts actual `usage.cost`
 *     ahead of any estimate, and its exit criteria require that "actual cost and latency [are]
 *     captured". The witness carries the provider's summed integer micro-USD and it is reported as such.
 *
 * ## Fail-closed before anything is emitted
 *
 * 6.1's two gates run first, exactly as in 6.2 and for the same reason: `validateEvalSet` for contract
 * 09's case minimums, and `auditEvalSet` for steering §0b sanitization plus money integrity. Sending an
 * unsanitized case to a third party is the one failure a live run can commit that a fixture run cannot,
 * so the sanitization gate matters MORE here - but it runs after the calls, which is too late to prevent
 * the send. It is therefore the caller's obligation to run both gates BEFORE dialling, and this module
 * re-runs them so a registry can never be emitted from a set that fails them either way.
 *
 * Money: provider accounting only. `actualCostMicroUsd` is integer micro-USD, taken as the provider
 * reported it and never converted or re-derived. Owner money (integer milliunits, `src/lib/money`) does
 * not appear. No `parseFloat`, no `.toFixed(`.
 */
import { auditEvalSet, type IntegrityProblem } from '../../features/benchmark/datasetIntegrity';
import { buildEvalSet, validateEvalSet } from '../../features/benchmark/dataset';
import {
  developerBuildPasses,
  unmeasuredDeveloperBuild,
  type UnmeasuredDeveloperBuild,
} from '../../features/benchmark/developerBuild';
import type { BenchmarkCase } from '../../features/benchmark/benchmark.types';
import type { ModelEligibility } from '../../features/benchmark/eligibility';
import { runBenchmark, serializeOutputs, type BenchmarkRun, type ModelCaller } from '../../features/benchmark/runner';
// TYPE-ONLY, and deliberately so: these edges are erased at compile time, so this module holds no
// runtime reference to the live adapter. The two capabilities it needs are injected instead.
import type {
  LiveMeasurementWitness,
  LiveModelExchange,
  LiveModelRun,
} from '../../features/benchmark/liveModelCaller';
import type {
  EligibilityRegistryEntry,
  LiveEligibilityRegistry,
} from '../routing/eligibilityRegistry';
import { ELIGIBILITY_REGISTRY_VERSION } from '../routing/eligibilityRegistry';
import {
  PER_MODEL_ARTIFACT_NAMES,
  PROVISIONAL_REGISTRY_FILE_NAME,
  artifactPrefixForModel,
} from './provisionalRegistry';

/**
 * Contract 09 fixes this artifact name, and a MEASURED registry uses the same one: it is the file
 * `OpenRouterPortConfig.eligibilityRegistryPathRef` points at, and the router reads whichever document
 * is there and refuses it if it is provisional. Two names would let both sit side by side, which is how
 * a stale provisional document ends up being the one that was read.
 */
export const LIVE_REGISTRY_FILE_NAME = PROVISIONAL_REGISTRY_FILE_NAME;

/** Why an emission was refused. A caller discriminates on `code`, never on a message. */
export const LIVE_REGISTRY_ERROR_CODES = [
  'LIVE_REGISTRY_NO_RUNS',
  'LIVE_REGISTRY_DUPLICATE_MODEL',
  'LIVE_REGISTRY_MODEL_NOT_DEFAULT_ALLOWED',
  'LIVE_REGISTRY_WITNESS_NOT_ACCEPTED',
  'LIVE_REGISTRY_WITNESS_MODEL_MISMATCH',
  'LIVE_REGISTRY_RUN_INCOMPLETE',
  'LIVE_REGISTRY_EVAL_SET_INCOMPLETE',
  'LIVE_REGISTRY_EVAL_SET_UNSANITIZED',
  'LIVE_REGISTRY_ARTIFACT_MISSING',
] as const;
export type LiveRegistryErrorCode = (typeof LIVE_REGISTRY_ERROR_CODES)[number];

/** A refused emission. `detail` holds counts, gate names, model ids and micro-USD figures only. */
export class LiveRegistryError extends Error {
  readonly code: LiveRegistryErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: LiveRegistryErrorCode, message: string, detail: Record<string, string> = {}) {
    super(`NIZAM live registry: ${message}`);
    this.name = 'LiveRegistryError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/** One model's measured run: its finance verdict, its (still unmeasured) developer verdict, its cost. */
export interface LiveModelResult {
  readonly modelId: string;
  readonly eligibility: ModelEligibility;
  /** Always `unmeasured`. A finance run measures no developer/build work (contract 09). */
  readonly developerBuild: UnmeasuredDeveloperBuild;
  readonly casesGraded: number;
  /** The provider's ACTUAL reported cost for this model, integer micro-USD. */
  readonly actualCostMicroUsd: number;
  readonly run: BenchmarkRun;
}

/** The emitted artifact: the document, its text, the per-model results, and the total actual spend. */
export interface EmittedLiveRegistry {
  readonly fileName: typeof LIVE_REGISTRY_FILE_NAME;
  readonly document: LiveEligibilityRegistry;
  readonly json: string;
  readonly results: readonly LiveModelResult[];
  /** Summed provider cost across every model in the run, integer micro-USD. */
  readonly actualCostMicroUsd: number;
  readonly artifacts: Readonly<Record<string, string>>;
}

function summarizeProblems(problems: readonly IntegrityProblem[]): string {
  return [...new Set(problems.map((problem) => problem.gate))].sort().join(', ');
}

/**
 * Refuse unless every run is backed by an accepted witness that accounts for the whole eval set.
 *
 * Exported because it is the guard that replaces 6.2's type-level impossibility, and a guard that
 * carries the weight of a type should be directly testable rather than only reachable through the
 * function it protects.
 */
export function assertWitnessedRuns(
  runs: readonly LiveModelRun[],
  verifyWitness: (witness: LiveMeasurementWitness) => boolean,
  expectedCaseCount: number,
): void {
  if (runs.length === 0) {
    throw new LiveRegistryError(
      'LIVE_REGISTRY_NO_RUNS',
      'no run was supplied, and a registry listing nothing is refused rather than emitted as an enabled-but-empty one',
      { at: 'runs' },
    );
  }
  const seen = new Set<string>();
  for (const run of runs) {
    if (seen.has(run.modelId)) {
      throw new LiveRegistryError(
        'LIVE_REGISTRY_DUPLICATE_MODEL',
        'a model appears twice, and two grades for one model is an ambiguous registry',
        { modelId: run.modelId },
      );
    }
    seen.add(run.modelId);

    if (!verifyWitness(run.witness)) {
      throw new LiveRegistryError(
        'LIVE_REGISTRY_WITNESS_NOT_ACCEPTED',
        'the run carries no witness the verifier accepts, so it is not evidence of a live measurement and cannot produce a non-provisional registry',
        { modelId: run.modelId },
      );
    }
    if (run.witness.modelId !== run.modelId) {
      throw new LiveRegistryError(
        'LIVE_REGISTRY_WITNESS_MODEL_MISMATCH',
        "the witness names a different model than the run it is attached to, so it does not attest this run's measurement",
        { modelId: run.modelId, witnessModelId: run.witness.modelId },
      );
    }
    if (run.witness.casesAnswered !== expectedCaseCount || run.exchanges.length !== expectedCaseCount) {
      throw new LiveRegistryError(
        'LIVE_REGISTRY_RUN_INCOMPLETE',
        'the run did not answer every case in the eval set, and a partial live run is not a measurement (contract 09 exit criteria: no model promoted from benchmark reputation alone)',
        {
          modelId: run.modelId,
          answered: String(run.witness.casesAnswered),
          exchanges: String(run.exchanges.length),
          expected: String(expectedCaseCount),
        },
      );
    }
  }
}

/**
 * Grade a set of witnessed live runs and emit the NON-provisional registry.
 *
 * @param input.runs Completed live runs, each carrying its witness.
 * @param input.buildCaller Turns a model's exchanges into contract 09's `ModelCaller`. REQUIRED and
 *   injected; see "Reachability" above. It is expected to REFUSE a case with no live answer.
 * @param input.verifyWitness Decides whether a witness is genuine. REQUIRED and injected; there is no
 *   default, and no fallback to `true`.
 * @param input.evalSet Contract 09's eval set. Defaults to the assembled set from 6.1.
 */
export function emitLiveRegistry(input: {
  runs: readonly LiveModelRun[];
  buildCaller: (modelId: string, exchanges: readonly LiveModelExchange[]) => ModelCaller;
  verifyWitness: (witness: LiveMeasurementWitness) => boolean;
  evalSet?: readonly BenchmarkCase[];
  nowIso?: string;
}): EmittedLiveRegistry {
  const { runs, buildCaller, verifyWitness } = input;
  const cases = [...(input.evalSet ?? buildEvalSet())];

  // 6.1's gates, before anything is graded. They are the caller's obligation BEFORE dialling too;
  // re-running them here means no registry can be emitted from a set that fails either.
  const completeness = validateEvalSet(cases);
  if (!completeness.ok) {
    throw new LiveRegistryError(
      'LIVE_REGISTRY_EVAL_SET_INCOMPLETE',
      'the eval set does not meet contract 09 case minimums, so no registry is emitted from it',
      { problems: String(completeness.problems.length) },
    );
  }
  const sanitization = auditEvalSet(cases);
  if (!sanitization.ok) {
    throw new LiveRegistryError(
      'LIVE_REGISTRY_EVAL_SET_UNSANITIZED',
      'the eval set fails its sanitization audit, and a live run sends case text to a third party, so no registry is emitted from it (steering §0b, §3)',
      { gates: summarizeProblems(sanitization.problems) },
    );
  }

  assertWitnessedRuns(runs, verifyWitness, cases.length);

  const results: LiveModelResult[] = runs.map((liveRun) => {
    const run = runBenchmark(cases, buildCaller(liveRun.modelId, liveRun.exchanges), {
      model: liveRun.modelId,
      nowIso: input.nowIso,
    });
    return {
      modelId: liveRun.modelId,
      eligibility: run.eligibility,
      // Still unmeasured, and this is not an oversight - see point 3 in the header.
      developerBuild: unmeasuredDeveloperBuild(liveRun.modelId, 'code_benchmark_not_run'),
      casesGraded: cases.length,
      actualCostMicroUsd: liveRun.witness.actualCostMicroUsd,
      run,
    };
  });

  const entries: EligibilityRegistryEntry[] = results.map((result) => ({
    modelId: result.modelId,
    bands: result.eligibility.levels,
    developerBuild: developerBuildPasses(result.developerBuild),
    disqualified: result.eligibility.disqualified,
  }));

  // The literal `false` is what makes this a `LiveEligibilityRegistry`. It is reached only after
  // `assertWitnessedRuns` above, which is the whole of its justification.
  const document: LiveEligibilityRegistry = {
    registryVersion: ELIGIBILITY_REGISTRY_VERSION,
    provisional: false,
    entries,
  };
  const json = `${JSON.stringify(document, null, 2)}\n`;

  const artifacts: Record<string, string> = { [LIVE_REGISTRY_FILE_NAME]: json };
  let actualCostMicroUsd = 0;
  for (const result of results) {
    actualCostMicroUsd += result.actualCostMicroUsd;
    const serialized = serializeOutputs(result.run);
    const prefix = artifactPrefixForModel(result.modelId);
    for (const name of PER_MODEL_ARTIFACT_NAMES) {
      const text = serialized[name];
      if (text === undefined) {
        throw new LiveRegistryError(
          'LIVE_REGISTRY_ARTIFACT_MISSING',
          `the harness produced no "${name}", so contract 09's output list is incomplete`,
          { at: name, modelId: result.modelId },
        );
      }
      artifacts[`${prefix}/${name}`] = text;
    }
  }

  return {
    fileName: LIVE_REGISTRY_FILE_NAME,
    document,
    json,
    results: Object.freeze(results),
    actualCostMicroUsd,
    artifacts: Object.freeze(artifacts),
  };
}
