/**
 * NIZAM - PFOS benchmark harness (M2): the developer/build axis stays separate and fails closed.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration): "Developer/build
 *   tasks based on code benchmark and repository tests, separate from live finance eligibility."
 * Build phase: PFOS Stage 6 (two-agent VPS tier), phase 6.2 - fixture-backed registry emission.
 * Depends on: developerBuild.
 *
 * The negative half is the point: an unmeasured axis must never read as a passing one, and a
 * developer verdict must not be derivable from the finance eval set.
 */
import { describe, it, expect } from 'vitest';
import {
  DEVELOPER_BUILD_UNMEASURED_FIXTURE_BACKED,
  DEVELOPER_BUILD_UNMEASURED_REASONS,
  developerBuildPasses,
  measuredDeveloperBuild,
  unmeasuredDeveloperBuild,
} from './developerBuild';

const MODEL = 'xiaomi/mimo-v2.5';

describe('developer/build verdicts', () => {
  it('names a fixture-backed run as its own unmeasured reason', () => {
    expect(DEVELOPER_BUILD_UNMEASURED_FIXTURE_BACKED).toBe('fixture_backed_run');
    expect(DEVELOPER_BUILD_UNMEASURED_REASONS).toContain('fixture_backed_run');
  });

  it('records a measured verdict with both run references', () => {
    const verdict = measuredDeveloperBuild({
      modelId: MODEL,
      codeBenchmarkRef: 'code-bench-ref-a',
      repositoryTestRunRef: 'repo-test-ref-a',
      passed: true,
    });
    expect(verdict.kind).toBe('measured');
    expect(developerBuildPasses(verdict)).toBe(true);
  });

  it('reports a measured failure as a failure', () => {
    const verdict = measuredDeveloperBuild({
      modelId: MODEL,
      codeBenchmarkRef: 'code-bench-ref-b',
      repositoryTestRunRef: 'repo-test-ref-b',
      passed: false,
    });
    expect(developerBuildPasses(verdict)).toBe(false);
  });

  // NEGATIVE: the fail-closed rule. An axis nobody measured is not a passing axis.
  it('refuses every unmeasured reason, so an unmeasured axis is never a pass', () => {
    for (const reason of DEVELOPER_BUILD_UNMEASURED_REASONS) {
      const verdict = unmeasuredDeveloperBuild(MODEL, reason);
      expect(verdict.kind).toBe('unmeasured');
      expect(developerBuildPasses(verdict)).toBe(false);
    }
  });

  // NEGATIVE: contract 09 keeps the two axes apart. This module must expose no way to derive a
  // developer verdict from finance case scores, so nothing it exports may accept them.
  it('exposes no constructor that takes finance case scores', () => {
    const takesScores = (measuredDeveloperBuild as (arg: unknown) => unknown).length;
    expect(takesScores).toBe(1);
    const built = measuredDeveloperBuild({
      modelId: MODEL,
      codeBenchmarkRef: 'code-bench-ref-c',
      repositoryTestRunRef: 'repo-test-ref-c',
      passed: true,
    });
    // The verdict carries references to the runs that produced it and nothing derived from the
    // finance corpus: no band, no metric, no case count.
    expect(Object.keys(built).sort()).toEqual(
      ['codeBenchmarkRef', 'kind', 'modelId', 'passed', 'repositoryTestRunRef'].sort(),
    );
  });
});
