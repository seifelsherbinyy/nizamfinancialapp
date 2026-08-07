/**
 * NIZAM - PFOS benchmark harness (M2): the developer/build judgement, on its own axis.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration): "Developer/build
 *   tasks based on code benchmark and repository tests, **separate from live finance eligibility**."
 * Build phase: PFOS Stage 6 (two-agent VPS tier), phase 6.2 - fixture-backed registry emission.
 * Depends on: nothing. Deliberately nothing - see below.
 *
 * OFFLINE ONLY. No network, no model, no key, no clock, no filesystem.
 *
 * ## Why this is a separate module rather than a field on `ModelEligibility`
 *
 * Contract 09 lists four qualification gates. Three of them (L0, L1, L2) are graded from the finance
 * eval set and `eligibility.ts` computes them from `CaseScore[]`. The fourth is not: it rests on "code
 * benchmark and repository tests", and contract 09 says in the same clause that it is *separate from
 * live finance eligibility*. Phase 5.2 encodes the same separation in `TIER_REQUIRED_ELIGIBILITY`,
 * where `T4` takes `{ kind: 'developer_build' }` and no L band at all.
 *
 * Adding a `developerBuild` field to `ModelEligibility` would have put the two axes in one object
 * computed by one function over one input - the finance eval set - which is exactly the conflation
 * contract 09 forbids, and it would have made "derived it from the wrong corpus" a one-line mistake.
 * So the judgement lives here, its only inputs are a code-benchmark reference and a repository-test
 * reference, and **there is no function in this module that accepts a `CaseScore`**. A developer
 * verdict cannot be produced from finance grades because nothing here will take them.
 *
 * ## Unmeasured is not a pass
 *
 * {@link DeveloperBuildVerdict} is a discriminated union with an `unmeasured` member, and
 * {@link developerBuildPasses} answers `false` for it unconditionally. There is no third state and no
 * optional boolean that could read as "probably fine". This matches the fail-closed posture contract
 * 12 §6.3 states for the registry as a whole, and it is the reason Phase 5.2 made `developerBuild` a
 * REQUIRED field of a registry entry: an unstated verdict is refused rather than assumed passing.
 *
 * A fixture-backed run (steering §3) has run no code benchmark against any candidate and holds no
 * per-model repository-test result, so its verdict is `unmeasured` with reason
 * {@link DEVELOPER_BUILD_UNMEASURED_FIXTURE_BACKED}. Stating `true` there would be the promotion
 * "from benchmark reputation alone" that contract 09's exit criteria forbid.
 *
 * Money: nothing here holds, parses, or computes a figure of any kind.
 */

/** Why no developer/build measurement exists for a model. Each is a refusal, never a pass. */
export const DEVELOPER_BUILD_UNMEASURED_REASONS = [
  /** The run replayed recorded fixtures, so no candidate executed a code benchmark (steering §3). */
  'fixture_backed_run',
  /** A live run happened, but the code benchmark was not part of it. */
  'code_benchmark_not_run',
  /** A code benchmark ran, but no repository-test outcome was recorded for the candidate. */
  'repository_tests_not_recorded',
] as const;
export type DeveloperBuildUnmeasuredReason = (typeof DEVELOPER_BUILD_UNMEASURED_REASONS)[number];

/** The reason a fixture-backed run always carries. Named so a caller cannot mistype it. */
export const DEVELOPER_BUILD_UNMEASURED_FIXTURE_BACKED: DeveloperBuildUnmeasuredReason =
  'fixture_backed_run';

/**
 * A measured developer/build judgement. It carries the VERDICT rather than raw metrics, because
 * contract 09 states the inputs ("code benchmark and repository tests") and states no threshold.
 * Inventing a cut-off here would be inventing policy a contract governs, so the measurement supplies
 * its own verdict and this module only encodes what an absent one means.
 *
 * Both references are REFERENCES - the name of a run, not its output and not a path (R24).
 */
export interface MeasuredDeveloperBuild {
  readonly kind: 'measured';
  readonly modelId: string;
  /** Reference to the code-benchmark run that produced the verdict. Never a path or a URL. */
  readonly codeBenchmarkRef: string;
  /** Reference to the repository-test run that produced the verdict. Never a path or a URL. */
  readonly repositoryTestRunRef: string;
  /** The verdict the measurement reached. */
  readonly passed: boolean;
}

/** No developer/build judgement exists for this model. Never a pass. */
export interface UnmeasuredDeveloperBuild {
  readonly kind: 'unmeasured';
  readonly modelId: string;
  readonly reason: DeveloperBuildUnmeasuredReason;
}

export type DeveloperBuildVerdict = MeasuredDeveloperBuild | UnmeasuredDeveloperBuild;

/** State that no developer/build measurement exists for a model, and why. */
export function unmeasuredDeveloperBuild(
  modelId: string,
  reason: DeveloperBuildUnmeasuredReason,
): UnmeasuredDeveloperBuild {
  return { kind: 'unmeasured', modelId, reason };
}

/**
 * Record a developer/build measurement. Takes the two run references and the verdict; it takes no
 * finance case scores, which is what keeps contract 09's two axes apart by construction.
 */
export function measuredDeveloperBuild(detail: {
  modelId: string;
  codeBenchmarkRef: string;
  repositoryTestRunRef: string;
  passed: boolean;
}): MeasuredDeveloperBuild {
  return {
    kind: 'measured',
    modelId: detail.modelId,
    codeBenchmarkRef: detail.codeBenchmarkRef,
    repositoryTestRunRef: detail.repositoryTestRunRef,
    passed: detail.passed,
  };
}

/**
 * Does the model hold a passing developer/build judgement? Fail-closed: an unmeasured verdict is
 * `false`, so the only way to reach `true` is a measurement that says so.
 */
export function developerBuildPasses(verdict: DeveloperBuildVerdict): boolean {
  return verdict.kind === 'measured' && verdict.passed;
}
