/**
 * NIZAM · The provisional eligibility registry — a scaffold that says so, and cannot route
 * Implemented by: PFOS Contract 12 / Phase 6.2 (spec 06-two-agent-vps)
 * Owning requirements: R18 (a model is selected only if the registry lists it; a `provisional`
 *   registry does not permit live routing); R24 (no deployment particular in a tracked file);
 *   steering §3 (fixture-backed run when the dev key is absent or exhausted)
 * Depends on: ./fixtureReplay, ../mocks/fixtures, ../routing/eligibilityRegistry,
 *   ../../features/benchmark/{runner,eligibility,dataset,datasetIntegrity,developerBuild}, and
 *   node:fs + node:path in ONE factory ({@link nodeRegistrySink}), which nothing calls by default
 *
 * NO NETWORK. NO KEY. NO PROVIDER. This is steering §3's fixture path in full: "If the dev key is
 * absent or exhausted, the harness must run against recorded fixtures and mark the registry
 * `provisional: true`. A provisional registry may **never** promote a model for live routing."
 *
 * ## The three properties this module has, and why each is a type rather than a habit
 *
 * 1. **The document is provisional, and the mark is not written here.** The only construction path is
 *    `provisionalRegistryFromFixture`, whose first argument is anything carrying `provisional: true` —
 *    which is exactly what the Phase 2.2 loader gives a `LoadedFixture`, as a literal type. So the
 *    flag on the emitted document is the LOADER's, and its return type is
 *    `ProvisionalEligibilityRegistry`, which `admitEligibilityRegistry` will not accept. There is no
 *    expression in this module that produces a non-provisional registry, and no cast anywhere on the
 *    path. Emitting a live-looking registry from fixtures is not a mistake this file can make.
 *
 * 2. **`developerBuild` is always `false`, and there is no parameter that could make it `true`.**
 *    Contract 09 grades developer/build work "based on code benchmark and repository tests, separate
 *    from live finance eligibility". No candidate model has been asked to do developer/build work
 *    here: this repository's own tests grade NIZAM's code, not a model's, and no code benchmark has
 *    been run against any candidate on any machine. So the honest verdict is `unmeasured` with reason
 *    `fixture_backed_run`, and `developerBuildPasses` answers `false` for it. Accepting an injected
 *    verdict would have made this function a fabrication vector for the one axis the finance eval set
 *    cannot speak to, so it does not accept one. Phase 5.2's registry entry makes `developerBuild`
 *    REQUIRED precisely so an unstated verdict refuses instead of reading as a pass.
 *
 * 3. **The finance bands come from contract 09's real aggregator, over a replayed run.** `runBenchmark`
 *    and `evaluateEligibility` are imported verbatim; nothing here recomputes, adjusts, or rounds a
 *    band. If the aggregator disqualifies a model, the entry says so and Phase 5.2 grades it for
 *    nothing.
 *
 * ## Fail-closed before anything is emitted
 *
 * A registry built from an eval set that does not meet contract 09's minimums, or that carries an
 * unsanitized case, would be worse than no registry: it would look like a graded artifact. So both of
 * 6.1's checks run first — `validateEvalSet` (the ≥210-case bar and the per-category minimums) and
 * `auditEvalSet` (steering §0b sanitization plus money integrity) — and either failing refuses the
 * emission with its own code. `replayCoverage` refuses separately if a graded model was replayed
 * against no recording at all.
 *
 * ## All five contract-09 artifacts, and one correction to the fifth
 *
 * Contract 09's output list names five files, and `runner.serializeOutputs` already produces all
 * five. Four of them are per-model and are taken from it verbatim. The fifth,
 * `model_eligibility_registry.json`, is REPLACED, because `serializeOutputs` writes it as
 * `{ [modelId]: ModelEligibility }` — a shape `parseEligibilityRegistry` cannot read at all: it has
 * no `registryVersion`, no `provisional`, no `entries`, and no `developerBuild`. That gap is the
 * substance of this phase, so the corrected document is emitted ONCE for the whole run (a registry
 * grades many models) while the other four stay per-model under a model-named prefix. Nothing here
 * forks `serializeOutputs`; it is imported and its registry entry is dropped by name.
 *
 * ## Where the file lands
 *
 * Nowhere, by default. {@link emitProvisionalRegistry} performs NO I/O and resolves NO path, for the
 * same reason `OpenRouterPortConfig.eligibilityRegistryPathRef` is a REFERENCE to an environment
 * entry rather than a path: the artifact's location belongs to whoever runs the harness, not to
 * source. {@link nodeRegistrySink} is the one filesystem-touching factory in this directory, it takes
 * its directory explicitly with no default, and nothing calls it by default — the same shape
 * `mocks/fixtures.ts` uses for `nodeFixtureSource`.
 *
 * The emitted artifact is **not tracked**: {@link PROVISIONAL_ARTIFACT_DIRECTORY} is git-ignored, and
 * it is a fresh directory name rather than `dist/`, `outputs/` or `.loop/tmp/`, none of which mean
 * "regenerable benchmark output". It is derived entirely from tracked inputs — this module, the eval
 * set, and the recorded fixture — so it is reproducible without being committed. Tracking it would
 * put a file that reads as graded evidence into a public repository, would go stale the moment phase
 * 6.3 measures for real, and would dirty the working tree on every regeneration, which AC14 checks.
 *
 * Money: no owner figure appears. Provider cost stays integer micro-USD in the coverage summary and is
 * never converted, divided, or formatted here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

import { auditEvalSet, type IntegrityProblem } from '../../features/benchmark/datasetIntegrity.ts';
import { buildEvalSet, validateEvalSet } from '../../features/benchmark/dataset.ts';
import {
  DEVELOPER_BUILD_UNMEASURED_FIXTURE_BACKED,
  developerBuildPasses,
  unmeasuredDeveloperBuild,
  type UnmeasuredDeveloperBuild,
} from '../../features/benchmark/developerBuild.ts';
import type { BenchmarkCase } from '../../features/benchmark/benchmark.types.ts';
import type { ModelEligibility } from '../../features/benchmark/eligibility.ts';
import { runBenchmark, serializeOutputs, type BenchmarkRun } from '../../features/benchmark/runner.ts';
import type { LoadedFixture } from '../mocks/fixtures.ts';
import {
  provisionalRegistryFromFixture,
  type EligibilityRegistryEntry,
  type ProvisionalEligibilityRegistry,
} from '../routing/eligibilityRegistry.ts';
import {
  fixtureModelCaller,
  replayCoverage,
  resolveRecordings,
  type ModelReplayCoverage,
} from './fixtureReplay.ts';

/** Contract 09 names this artifact. The name is fixed here so no caller invents a variant. */
export const PROVISIONAL_REGISTRY_FILE_NAME = 'model_eligibility_registry.json';

/**
 * Contract 09's per-model artifacts, by the names contract 09 gives them. The registry is absent
 * from this list because it is a single document across the whole run, not a per-model one.
 */
export const PER_MODEL_ARTIFACT_NAMES = [
  'benchmark_results.json',
  'pricing_snapshot.json',
  'cost_projection.json',
  'benchmark_report.md',
] as const;
export type PerModelArtifactName = (typeof PER_MODEL_ARTIFACT_NAMES)[number];

/**
 * The repository-relative directory a fixture-backed run writes into. Git-ignored: the artifact is a
 * regenerable output of a PROVISIONAL run, not evidence, and a public repository should not carry a
 * file that reads as a grading. Deliberately not `dist/`, `outputs/` or `.loop/tmp/`, each of which
 * already means something else. This is a name, not a resolved path, and it holds no host, key or
 * other deployment particular (R24).
 */
export const PROVISIONAL_ARTIFACT_DIRECTORY = 'artifacts/benchmark';

/**
 * A model id as a single path segment. Provider ids carry a `/`, which would otherwise silently
 * create a nested directory; replacing it keeps one artifact set per model in one place.
 */
export function artifactPrefixForModel(modelId: string): string {
  return modelId.replace(/\//g, '__');
}

/** Why an emission was refused. A caller discriminates on `code`, never on a message. */
export const PROVISIONAL_REGISTRY_ERROR_CODES = [
  'REGISTRY_NO_MODELS',
  'REGISTRY_DUPLICATE_MODEL',
  'REGISTRY_EVAL_SET_INCOMPLETE',
  'REGISTRY_EVAL_SET_UNSANITIZED',
  'REGISTRY_ARTIFACT_MISSING',
  'REGISTRY_ARTIFACT_NAME_ESCAPES_DIRECTORY',
] as const;
export type ProvisionalRegistryErrorCode = (typeof PROVISIONAL_REGISTRY_ERROR_CODES)[number];

/** A refused emission. `detail` holds counts, gate names and model ids — never a case or a figure. */
export class ProvisionalRegistryError extends Error {
  readonly code: ProvisionalRegistryErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(
    code: ProvisionalRegistryErrorCode,
    message: string,
    detail: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ProvisionalRegistryError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/** One model's fixture-backed run: its finance verdict, its developer verdict, and its coverage. */
export interface ProvisionalModelRun {
  readonly modelId: string;
  /** Contract 09's real aggregation over the replayed responses. */
  readonly eligibility: ModelEligibility;
  /** Always `unmeasured`. A fixture-backed run measures no developer/build work. */
  readonly developerBuild: UnmeasuredDeveloperBuild;
  readonly coverage: ModelReplayCoverage;
  /** The whole contract 09 run, kept so phase 6.3 and the report have the scores without a re-run. */
  readonly run: BenchmarkRun;
}

/** The emitted artifact: the document, its text, and the runs that produced it. */
export interface EmittedProvisionalRegistry {
  readonly fileName: typeof PROVISIONAL_REGISTRY_FILE_NAME;
  readonly document: ProvisionalEligibilityRegistry;
  /** The exact text a sink writes for the registry. Pretty-printed, newline-terminated. */
  readonly json: string;
  readonly runs: readonly ProvisionalModelRun[];
  /**
   * Every contract-09 artifact this run produces, keyed by the relative name a sink writes it under.
   * The registry sits at the top level; the other four sit under a model-named prefix.
   */
  readonly artifacts: Readonly<Record<string, string>>;
}

function summarizeProblems(problems: readonly IntegrityProblem[]): string {
  const gates = [...new Set(problems.map((problem) => problem.gate))].sort();
  return gates.join(', ');
}

/**
 * Run the eval set against recorded fixtures and build the provisional registry document.
 *
 * @param fixture A fixture loaded by the Phase 2.2 loader. Its `provisional: true` is what marks the
 *   document, so a run that did not come through the loader cannot produce one.
 * @param modelIds The models to grade. Every one of them must have at least one recorded exchange.
 * @param evalSet Contract 09's eval set. Defaults to the assembled set from 6.1.
 */
export function emitProvisionalRegistry(input: {
  fixture: LoadedFixture;
  modelIds: readonly string[];
  evalSet?: readonly BenchmarkCase[];
}): EmittedProvisionalRegistry {
  const { fixture, modelIds } = input;
  const evalSet = input.evalSet ?? buildEvalSet();

  if (modelIds.length === 0) {
    throw new ProvisionalRegistryError(
      'REGISTRY_NO_MODELS',
      'NIZAM provisional registry: no model was named, and a registry listing nothing is refused rather than emitted as an enabled-but-empty one',
      { at: 'modelIds' },
    );
  }
  if (new Set(modelIds).size !== modelIds.length) {
    throw new ProvisionalRegistryError(
      'REGISTRY_DUPLICATE_MODEL',
      'NIZAM provisional registry: a model is named twice, and two grades for one model is an ambiguous registry',
      { at: 'modelIds' },
    );
  }

  // 6.1's two checks, before anything is graded. A registry built on an incomplete or unsanitized
  // eval set would look like evidence and would not be.
  const cases = [...evalSet];
  const completeness = validateEvalSet(cases);
  if (!completeness.ok) {
    throw new ProvisionalRegistryError(
      'REGISTRY_EVAL_SET_INCOMPLETE',
      'NIZAM provisional registry: the eval set does not meet contract 09 case minimums, so no registry is emitted from it',
      { problems: String(completeness.problems.length) },
    );
  }
  const sanitization = auditEvalSet(cases);
  if (!sanitization.ok) {
    throw new ProvisionalRegistryError(
      'REGISTRY_EVAL_SET_UNSANITIZED',
      'NIZAM provisional registry: the eval set fails its sanitization audit, and the repository is public (steering §0b), so no registry is emitted from it',
      { gates: summarizeProblems(sanitization.problems) },
    );
  }

  const recordings = resolveRecordings(fixture.set.modelExchanges, modelIds, cases);
  const coverages = replayCoverage(modelIds, recordings, cases);

  const runs: ProvisionalModelRun[] = modelIds.map((modelId, index) => {
    const run = runBenchmark(cases, fixtureModelCaller(modelId, recordings), { model: modelId });
    const coverage = coverages[index];
    if (coverage === undefined) {
      // Unreachable: `replayCoverage` maps over the same list. Kept because the alternative is a
      // non-null assertion on a value that decides what an operator reads.
      throw new ProvisionalRegistryError(
        'REGISTRY_NO_MODELS',
        'NIZAM provisional registry: replay coverage is missing for a graded model',
        { modelId },
      );
    }
    return {
      modelId,
      eligibility: run.eligibility,
      // The one honest verdict a fixture-backed run can state on contract 09's separate axis.
      developerBuild: unmeasuredDeveloperBuild(modelId, DEVELOPER_BUILD_UNMEASURED_FIXTURE_BACKED),
      coverage,
      run,
    };
  });

  const entries: EligibilityRegistryEntry[] = runs.map((modelRun) => ({
    modelId: modelRun.modelId,
    bands: modelRun.eligibility.levels,
    // `false` for every fixture-backed entry, and derived rather than written: the only input is the
    // unmeasured verdict above, which this predicate refuses.
    developerBuild: developerBuildPasses(modelRun.developerBuild),
    disqualified: modelRun.eligibility.disqualified,
  }));

  // The `provisional: true` on the document is `fixture.provisional`, the loader's own literal.
  const document = provisionalRegistryFromFixture(fixture, entries);
  const json = `${JSON.stringify(document, null, 2)}\n`;

  // Contract 09's five outputs. Four come from the harness verbatim; the registry is the corrected
  // one built above, which is the only artifact `parseEligibilityRegistry` can read.
  const artifacts: Record<string, string> = { [PROVISIONAL_REGISTRY_FILE_NAME]: json };
  for (const modelRun of runs) {
    const serialized = serializeOutputs(modelRun.run);
    const prefix = artifactPrefixForModel(modelRun.modelId);
    for (const name of PER_MODEL_ARTIFACT_NAMES) {
      const text = serialized[name];
      if (text === undefined) {
        // Unreachable while `serializeOutputs` honours contract 09's output list. Kept because a
        // silently missing artifact is exactly the kind of gap this phase exists to close.
        throw new ProvisionalRegistryError(
          'REGISTRY_ARTIFACT_MISSING',
          `NIZAM provisional registry: the harness produced no "${name}", so contract 09's output list is incomplete`,
          { at: name, modelId: modelRun.modelId },
        );
      }
      artifacts[`${prefix}/${name}`] = text;
    }
  }

  return {
    fileName: PROVISIONAL_REGISTRY_FILE_NAME,
    document,
    json,
    runs,
    artifacts: Object.freeze(artifacts),
  };
}

/**
 * Where an emitted artifact goes. Injected, so {@link emitProvisionalRegistry} stays pure and the
 * decision about a location stays with whoever holds the environment entry.
 */
export interface RegistrySink {
  write(fileName: string, text: string): void;
}

/**
 * Write every contract-09 artifact under the relative name the emission assigned it. The registry
 * lands at the top level; the per-model four land under their model prefix.
 */
export function writeProvisionalRegistry(
  sink: RegistrySink,
  emitted: EmittedProvisionalRegistry,
): void {
  for (const [name, text] of Object.entries(emitted.artifacts)) sink.write(name, text);
}

/** An in-memory sink. The default for a test: no path, no disk, nothing to clean up. */
export function inlineRegistrySink(): RegistrySink & { readonly written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    write(fileName, text) {
      written.set(fileName, text);
    },
  };
}

/**
 * The one filesystem-touching sink in this directory. `directory` has NO default, so a caller has to
 * choose a location on purpose — the same shape `nodeFixtureSource` uses, and the reason
 * {@link emitProvisionalRegistry} stays pure. {@link PROVISIONAL_ARTIFACT_DIRECTORY} is the
 * git-ignored name a harness script would pass.
 *
 * A relative name containing a separator creates its parent, because the per-model artifacts sit
 * under a model prefix. A name that escapes the given directory is REFUSED rather than written: an
 * artifact name is derived from a model id, and a model id is provider-supplied text.
 */
export function nodeRegistrySink(directory: string): RegistrySink {
  return {
    write(fileName, text) {
      const root = resolve(directory);
      const target = resolve(root, fileName);
      if (target !== root && !target.startsWith(root + sep)) {
        throw new ProvisionalRegistryError(
          'REGISTRY_ARTIFACT_NAME_ESCAPES_DIRECTORY',
          'NIZAM provisional registry: an artifact name resolved outside the directory it was given, so nothing is written',
          { at: 'fileName' },
        );
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text, 'utf8');
    },
  };
}
