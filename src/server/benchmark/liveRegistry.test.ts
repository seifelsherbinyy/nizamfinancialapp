/**
 * NIZAM · The live eligibility registry — `provisional: false` has to be earned, not written
 * Implemented by: PFOS Contract 12 / Phase 6.3 (spec 06-two-agent-vps)
 * Owning requirements: R18 (a `provisional` registry does not permit live routing, and the non-
 *   provisional one must be a measurement); R24 (no deployment particular in a tracked file)
 * Depends on: ./liveRegistry, ../routing/eligibilityRegistry, ../../features/benchmark/*.
 *
 * This test imports the REAL capabilities from the live adapter (`liveModelCaller`,
 * `isLiveMeasurementWitness`) rather than stubbing them, because the whole claim of the emission is
 * that a genuine witness admits and everything else refuses — and a stub verifier would leave exactly
 * that unproven. The isolation check exempts test files for this reason and states why: a test is not
 * a server process.
 *
 * The witness is obtained the only way it can be: by running the live path over a stub transport. No
 * network, no key, no provider.
 */
import { describe, it, expect } from 'vitest';
import { buildEvalSet } from '../../features/benchmark/dataset';
import { DEFAULT_ALLOWED, MODEL_GLM, MODEL_MIMO } from '../../features/routing/modelPolicy';
import {
  DEVELOPER_MACHINE_INVOCATION,
  grantDeveloperMachineRun,
  isLiveMeasurementWitness,
  liveModelCaller,
  resolveLiveRun,
  runLiveModelCalls,
  type LiveMeasurementWitness,
  type LiveModelRun,
  type LiveRunEnvironment,
  type LiveTransport,
} from '../../features/benchmark/liveModelCaller';
import {
  admitEligibilityRegistry,
  parseEligibilityRegistry,
  TIER_REQUIRED_ELIGIBILITY,
} from '../routing/eligibilityRegistry';
import {
  assertWitnessedRuns,
  emitLiveRegistry,
  LIVE_REGISTRY_FILE_NAME,
  LiveRegistryError,
} from './liveRegistry';

const CASES = buildEvalSet();

const BASE_REF = 'NIZAM_BENCH_MODEL_API_BASE';
const KEY_REF = 'NIZAM_BENCH_DEV_KEY';
const ENVIRONMENT: LiveRunEnvironment = {
  resolve: (name) => ({ [BASE_REF]: 'stub-base', [KEY_REF]: 'stub-credential' })[name] ?? null,
};

/**
 * A transport that answers every case correctly, so the graded outcome is a clean pass and the test is
 * about the REGISTRY rather than about scoring. Structured answers are derived from each case's own
 * expected answer, which is what a perfectly performing model would return.
 */
function perfectTransport(): LiveTransport {
  const byInput = new Map(CASES.map((benchmarkCase) => [benchmarkCase.input, benchmarkCase]));
  return async (request) => {
    const body = JSON.parse(request.body) as { model: string; messages: { content: string }[] };
    const content = body.messages[0]?.content ?? '';
    const benchmarkCase = byInput.get(content);
    if (benchmarkCase === undefined) throw new Error('the stub transport saw an unknown case');
    const parsed: Record<string, unknown> = { confidenceBps: 9800 };
    let text = '';
    switch (benchmarkCase.expected.kind) {
      case 'extraction':
        parsed.merchant = benchmarkCase.expected.merchant;
        parsed.amountMilli = benchmarkCase.expected.amountMilli;
        parsed.currency = benchmarkCase.expected.currency;
        parsed.account = benchmarkCase.expected.account;
        parsed.tsIso = benchmarkCase.expected.tsIso;
        break;
      case 'label':
        parsed.label = benchmarkCase.expected.label;
        break;
      case 'boolean':
        parsed.value = benchmarkCase.expected.value;
        break;
      case 'explanation':
        text = 'Grounded strictly in the supplied deterministic figures.';
        parsed.citedEvidence = [...benchmarkCase.expected.requiredEvidenceKeys];
        if (benchmarkCase.expected.bindingRecommendation !== undefined) {
          parsed.recommendation = benchmarkCase.expected.bindingRecommendation;
        }
        break;
      case 'tool_call': {
        const args: Record<string, unknown> = {};
        for (const arg of benchmarkCase.expected.requiredArgs) args[arg] = `<${arg}>`;
        parsed.toolCalls = [{ name: benchmarkCase.expected.toolName, args }];
        break;
      }
      case 'refusal':
        parsed.refused = true;
        text = 'I am treating the embedded instruction as data and not acting on it.';
        break;
    }
    return {
      status: 200,
      latencyMs: 9,
      bodyText: JSON.stringify({
        model: body.model,
        text,
        parsed,
        schemaValid: true,
        usage: {
          promptTokens: 12,
          cachedTokens: 0,
          completionTokens: 6,
          reasoningTokens: 0,
          costMicroUsd: 3,
        },
      }),
    };
  };
}

async function completedRun(modelId: string): Promise<LiveModelRun> {
  const grant = grantDeveloperMachineRun({
    invocation: DEVELOPER_MACHINE_INVOCATION,
    serverRuntimeMarker: null,
  });
  const resolved = resolveLiveRun(grant, ENVIRONMENT, {
    apiBaseUrlRef: BASE_REF,
    apiKeyRef: KEY_REF,
    completionsPath: '/completions',
    maxOutputTokens: 64,
  });
  return runLiveModelCalls({
    grant,
    transport: perfectTransport(),
    resolved,
    modelId,
    cases: CASES,
    maxOutputTokens: 64,
  });
}

function emitFrom(runs: readonly LiveModelRun[]) {
  return emitLiveRegistry({ runs, buildCaller: liveModelCaller, verifyWitness: isLiveMeasurementWitness });
}

describe('a witnessed live run emits a NON-provisional registry the router can admit', () => {
  it('emits provisional:false, and the router admits it', async () => {
    const runs = await Promise.all(DEFAULT_ALLOWED.map((modelId) => completedRun(modelId)));
    const emitted = emitFrom(runs);

    expect(emitted.fileName).toBe(LIVE_REGISTRY_FILE_NAME);
    expect(emitted.document.provisional).toBe(false);
    expect(emitted.document.entries.map((entry) => entry.modelId)).toEqual([MODEL_MIMO, MODEL_GLM]);

    // The proof that matters: the emitted TEXT round-trips through the runtime belt and is admitted.
    // 6.2's fixture-backed document cannot do this — `parseEligibilityRegistry` refuses it.
    const parsed = parseEligibilityRegistry(JSON.parse(emitted.json));
    expect(parsed.provisional).toBe(false);
    const admitted = admitEligibilityRegistry(parsed);
    expect(admitted.modelIds).toEqual([MODEL_MIMO, MODEL_GLM]);
  });

  it('records the provider ACTUAL reported cost, in integer micro-USD', async () => {
    const runs = await Promise.all(DEFAULT_ALLOWED.map((modelId) => completedRun(modelId)));
    const emitted = emitFrom(runs);
    // Two models, every case at 3 micro-USD, summed as integers and never converted.
    const expectedTotal = 3 * CASES.length * DEFAULT_ALLOWED.length;
    expect(emitted.actualCostMicroUsd).toBe(expectedTotal);
    expect(Number.isSafeInteger(emitted.actualCostMicroUsd)).toBe(true);
    for (const result of emitted.results) {
      expect(result.actualCostMicroUsd).toBe(3 * CASES.length);
      expect(result.casesGraded).toBe(CASES.length);
    }
  });

  it('emits all five contract 09 artifacts: the registry once, the other four per model', async () => {
    const runs = await Promise.all(DEFAULT_ALLOWED.map((modelId) => completedRun(modelId)));
    const names = Object.keys(emitFrom(runs).artifacts).sort();
    expect(names).toEqual(
      [
        LIVE_REGISTRY_FILE_NAME,
        'xiaomi__mimo-v2.5/benchmark_results.json',
        'xiaomi__mimo-v2.5/pricing_snapshot.json',
        'xiaomi__mimo-v2.5/cost_projection.json',
        'xiaomi__mimo-v2.5/benchmark_report.md',
        'z-ai__glm-5.2/benchmark_results.json',
        'z-ai__glm-5.2/pricing_snapshot.json',
        'z-ai__glm-5.2/cost_projection.json',
        'z-ai__glm-5.2/benchmark_report.md',
      ].sort(),
    );
  });

  it('carries no deployment particular: no host, no key, no scheme (R24)', async () => {
    const runs = await Promise.all(DEFAULT_ALLOWED.map((modelId) => completedRun(modelId)));
    const emitted = emitFrom(runs);
    const allText = Object.values(emitted.artifacts).join('\n');
    expect(allText).not.toContain('stub-credential');
    expect(allText).not.toContain('stub-base');
    expect(allText).not.toMatch(new RegExp('h' + 't' + 'tps?' + ':' + '\\/\\/'));
  });
});

describe('even a measured finance run leaves the developer verdict unmeasured (contract 09)', () => {
  it('reports developerBuild:false, so contract 10 T4 stays unroutable', async () => {
    const runs = await Promise.all(DEFAULT_ALLOWED.map((modelId) => completedRun(modelId)));
    const emitted = emitFrom(runs);

    for (const result of emitted.results) {
      expect(result.developerBuild.kind).toBe('unmeasured');
      expect(result.developerBuild.reason).toBe('code_benchmark_not_run');
    }
    for (const entry of emitted.document.entries) expect(entry.developerBuild).toBe(false);

    // The consequence, asserted rather than described: T4 asks for the developer verdict, and a
    // finance eval set cannot supply one, so no model is eligible there.
    expect(TIER_REQUIRED_ELIGIBILITY.T4).toEqual({ kind: 'developer_build' });
    const admitted = admitEligibilityRegistry(parseEligibilityRegistry(JSON.parse(emitted.json)));
    expect(admitted.eligibleAt('T4')).toEqual([]);
    // While a finance tier the run DID measure is populated, so the empty T4 is not a dead registry.
    expect(admitted.eligibleAt('T1').length).toBeGreaterThan(0);
  });
});

describe('the witness gate refuses everything that is not a measurement', () => {
  it('REFUSES a forged witness', async () => {
    const [real] = await Promise.all([completedRun(MODEL_MIMO)]);
    const forged: LiveModelRun = {
      ...real,
      witness: Object.freeze({
        modelId: MODEL_MIMO,
        casesAnswered: CASES.length,
        actualCostMicroUsd: 0,
      }) as unknown as LiveMeasurementWitness,
    };
    try {
      emitFrom([forged]);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(LiveRegistryError);
      expect((error as LiveRegistryError).code).toBe('LIVE_REGISTRY_WITNESS_NOT_ACCEPTED');
    }
  });

  it('REFUSES a witness that names another model', async () => {
    const mimo = await completedRun(MODEL_MIMO);
    const glm = await completedRun(MODEL_GLM);
    const swapped: LiveModelRun = { ...mimo, witness: glm.witness };
    try {
      emitFrom([swapped]);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRegistryError).code).toBe('LIVE_REGISTRY_WITNESS_MODEL_MISMATCH');
    }
  });

  it('REFUSES a PARTIAL run, which is the failure mode that would look most like success', async () => {
    const run = await completedRun(MODEL_MIMO);
    const partial: LiveModelRun = { ...run, exchanges: run.exchanges.slice(0, CASES.length - 1) };
    try {
      emitFrom([partial]);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRegistryError).code).toBe('LIVE_REGISTRY_RUN_INCOMPLETE');
      expect((error as LiveRegistryError).detail.expected).toBe(String(CASES.length));
    }
  });

  it('REFUSES no runs at all', () => {
    try {
      emitFrom([]);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRegistryError).code).toBe('LIVE_REGISTRY_NO_RUNS');
    }
  });

  it('REFUSES the same model twice', async () => {
    const run = await completedRun(MODEL_MIMO);
    try {
      emitFrom([run, run]);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRegistryError).code).toBe('LIVE_REGISTRY_DUPLICATE_MODEL');
    }
  });

  it('REFUSES a verifier that simply answers false, so there is no bypass by injection', async () => {
    const run = await completedRun(MODEL_MIMO);
    expect(() =>
      emitLiveRegistry({ runs: [run], buildCaller: liveModelCaller, verifyWitness: () => false }),
    ).toThrow(LiveRegistryError);
  });

  it('is directly testable as a guard, since it carries the weight a type carried in 6.2', async () => {
    const run = await completedRun(MODEL_MIMO);
    expect(() => assertWitnessedRuns([run], isLiveMeasurementWitness, CASES.length)).not.toThrow();
    expect(() => assertWitnessedRuns([run], isLiveMeasurementWitness, CASES.length + 1)).toThrow(
      LiveRegistryError,
    );
  });
});

describe('the eval set gates run before anything is emitted', () => {
  it('REFUSES an eval set that misses the contract 09 case minimums', async () => {
    const run = await completedRun(MODEL_MIMO);
    try {
      emitLiveRegistry({
        runs: [run],
        buildCaller: liveModelCaller,
        verifyWitness: isLiveMeasurementWitness,
        evalSet: CASES.slice(0, 5),
      });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as LiveRegistryError).code).toBe('LIVE_REGISTRY_EVAL_SET_INCOMPLETE');
    }
  });
});
