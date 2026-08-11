// @vitest-environment node
/**
 * NIZAM · RUNG 3 smoke test — the witness gate, proven in BOTH directions
 * Owning contract: PFOS Contract 12 — Two-Agent VPS Deployment & Operations
 * Phase: phase 6.3 (the dev-key carve-out), driven as bringup ladder RUNG 3 of spec
 *   `ship-run-live-bringup`, task 11.5
 * Owning requirements: R10.2/R10.3 (the runner's phase order and its injected capabilities),
 *   R10.7 (an estimate over the ceiling spends nothing), R10.9 (provider cost is the provider's own
 *   integer figure), R11.1/R11.3 (`verifyWitness` passed by reference, never wrapped or defaulted),
 *   R11.4/R11.5 (a `provisional: false` document exists only downstream of a minted witness),
 *   R11.9/R18.1 (this is the ONLY new test for this rung)
 * Depends on: src/features/benchmark/liveModelCaller.ts (the mint, the grant, the transport seam),
 *   src/server/benchmark/liveRegistry.ts (`emitLiveRegistry`), src/features/benchmark/dataset.ts,
 *   src/server/routing/eligibilityRegistry.ts, scripts/benchmark/earn-registry.mjs (the runner)
 *
 * **No network, no endpoint, no credential.** The fake is at exactly ONE seam: the injected
 * `LiveTransport`. `liveModelCaller.ts` holds no network primitive — the capability is a parameter —
 * so there is no socket, no port and no DNS below. The base address is the literal `stub-base` and
 * the credential is the label `stub-credential`; `.secrets/` is never read (R24, steering §0b).
 *
 * ## What `verifyWitness` checks, stated in writing
 *
 * `isLiveMeasurementWitness` answers membership in a module-private `WeakSet` inside
 * `liveModelCaller.ts`, to which only `runLiveModelCalls` adds. It is therefore an **identity**
 * check, not a structural one: no arrangement of fields makes an object a member. That is why the
 * negative half below builds a forgery whose three field values are **identical** to the genuine
 * witness's — identical values are what make the refusal evidence of identity rather than of shape.
 * The real function is passed by reference throughout; nothing here wraps it, re-implements it, or
 * substitutes a verifier that returns a constant acceptance.
 */
import { describe, expect, it } from 'vitest';

import { buildEvalSet } from '../../src/features/benchmark/dataset.ts';
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
} from '../../src/features/benchmark/liveModelCaller.ts';
import { DEFAULT_ALLOWED } from '../../src/features/routing/modelPolicy.ts';
import { emitLiveRegistry } from '../../src/server/benchmark/liveRegistry.ts';
import {
  TIER_REQUIRED_ELIGIBILITY,
  admitEligibilityRegistry,
  parseEligibilityRegistry,
  satisfiesRequirement,
} from '../../src/server/routing/eligibilityRegistry.ts';
// The runner is `.mjs` BUILD TOOLING under `scripts/`, which `tsconfig.json`'s `include` does not
// cover, so it ships no declaration file. The directive suppresses exactly that one resolution
// diagnostic and nothing else; the alternative would be importing a copy of the runner's phase order
// into this test, which would prove the test's ordering rather than the runner's.
// @ts-expect-error the runner is untyped build tooling outside tsconfig's include
import { DEV_WEEKLY_CEILING_MICRO_USD, earnRegistry, explicitEnvironment, preflightEstimateMicroUsd } from '../../scripts/benchmark/earn-registry.mjs';

const CASES = buildEvalSet();

const BASE_REF = 'NIZAM_BENCH_MODEL_API_BASE';
const KEY_REF = 'NIZAM_BENCH_DEV_KEY';
const MAX_OUTPUT_TOKENS = 64;
/** Per-exchange provider cost, integer micro-USD. A distinct figure so a sum cannot be a coincidence. */
const COST_PER_EXCHANGE_MICRO_USD = 7;

const ENVIRONMENT: LiveRunEnvironment = {
  resolve: (name) => ({ [BASE_REF]: 'stub-base', [KEY_REF]: 'stub-credential' })[name] ?? null,
};

function developerMachineGrant() {
  return grantDeveloperMachineRun({
    invocation: DEVELOPER_MACHINE_INVOCATION,
    serverRuntimeMarker: null,
  });
}

/** The code a refusal carries. A caller discriminates on `code`; a message is prose. */
function refusalCode(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : null;
  }
}

async function asyncRefusalCode(action: () => Promise<unknown>): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (error) {
    return error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : null;
  }
}

/**
 * A transport that answers every case correctly, so the graded outcome is a clean pass and this test
 * is about the WITNESS rather than about scoring. Answers are derived from each case's own expected
 * answer, which is what a perfectly performing model would return.
 */
function perfectTransport(counter?: { calls: number }): LiveTransport {
  const byInput = new Map(CASES.map((benchmarkCase) => [benchmarkCase.input, benchmarkCase]));
  return async (request) => {
    if (counter !== undefined) counter.calls += 1;
    const body = JSON.parse(request.body) as { model: string; messages: { content: string }[] };
    const content = body.messages[0]?.content ?? '';
    const benchmarkCase = byInput.get(content);
    if (benchmarkCase === undefined) throw new Error('the fake transport saw an unknown case');
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
          costMicroUsd: COST_PER_EXCHANGE_MICRO_USD,
        },
      }),
    };
  };
}

/** One completed run per model, each carrying the witness `runLiveModelCalls` minted for it. */
async function completedRuns(): Promise<LiveModelRun[]> {
  const grant = developerMachineGrant();
  const resolved = resolveLiveRun(grant, ENVIRONMENT, {
    apiBaseUrlRef: BASE_REF,
    apiKeyRef: KEY_REF,
    completionsPath: '/chat/completions',
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  const runs: LiveModelRun[] = [];
  for (const modelId of DEFAULT_ALLOWED) {
    runs.push(
      await runLiveModelCalls({
        grant,
        transport: perfectTransport(),
        resolved,
        modelId,
        cases: CASES,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      }),
    );
  }
  return runs;
}

function emitFrom(runs: readonly LiveModelRun[]) {
  return emitLiveRegistry({
    runs,
    buildCaller: liveModelCaller,
    // BY REFERENCE, unchanged. No wrapper, no `?? (() => true)`, no local re-implementation.
    verifyWitness: isLiveMeasurementWitness,
    evalSet: CASES,
  });
}

describe('RUNG 3 — a minted witness is accepted and an identical forgery is refused', () => {
  it('positive half: a witness minted by runLiveModelCalls emits provisional:false', async () => {
    const runs = await completedRuns();
    for (const run of runs) expect(isLiveMeasurementWitness(run.witness)).toBe(true);

    const emitted = emitFrom(runs);

    expect(emitted.document.provisional).toBe(false);
    expect(emitted.document.entries.map((entry) => entry.modelId)).toEqual([...DEFAULT_ALLOWED]);
    // The emitted TEXT round-trips through the runtime belt, which refuses a provisional document.
    expect(parseEligibilityRegistry(JSON.parse(emitted.json)).provisional).toBe(false);
  });

  it('negative half: a forgery with IDENTICAL field values throws LIVE_REGISTRY_WITNESS_NOT_ACCEPTED', async () => {
    const runs = await completedRuns();
    const genuineRun = runs[0];
    expect(genuineRun).toBeDefined();
    if (genuineRun === undefined) return;
    const genuine = genuineRun.witness;

    // A hand-built object literal, cast. Its three fields are copied from the genuine witness, so
    // nothing structural distinguishes it — which is the whole point of the assertion below.
    const forged = {
      modelId: genuine.modelId,
      casesAnswered: genuine.casesAnswered,
      actualCostMicroUsd: genuine.actualCostMicroUsd,
    } as unknown as LiveMeasurementWitness;

    expect(forged.modelId).toBe(genuine.modelId);
    expect(forged.casesAnswered).toBe(genuine.casesAnswered);
    expect(forged.actualCostMicroUsd).toBe(genuine.actualCostMicroUsd);
    // Identical values, opposite verdicts: the check is `WeakSet` membership, not shape.
    expect(isLiveMeasurementWitness(genuine)).toBe(true);
    expect(isLiveMeasurementWitness(forged)).toBe(false);

    const tampered: LiveModelRun[] = [{ ...genuineRun, witness: forged }];
    expect(refusalCode(() => emitFrom(tampered))).toBe('LIVE_REGISTRY_WITNESS_NOT_ACCEPTED');
  });

  it('provider cost is the exact integer sum of the per-exchange costMicroUsd figures', async () => {
    const runs = await completedRuns();
    const emitted = emitFrom(runs);

    let summed = 0;
    for (const run of runs) for (const exchange of run.exchanges) summed += exchange.costMicroUsd;

    expect(emitted.actualCostMicroUsd).toBe(summed);
    expect(emitted.actualCostMicroUsd).toBe(
      COST_PER_EXCHANGE_MICRO_USD * CASES.length * DEFAULT_ALLOWED.length,
    );
    expect(Number.isSafeInteger(emitted.actualCostMicroUsd)).toBe(true);
    for (const result of emitted.results) {
      expect(result.actualCostMicroUsd).toBe(COST_PER_EXCHANGE_MICRO_USD * CASES.length);
    }
  });

  it('an estimate over the ceiling invokes the transport ZERO times', async () => {
    const counter = { calls: 0 };
    // An output allowance large enough to put the estimate over the dev-tier ceiling. The estimate is
    // checked here so the assertion below is about the gate rather than about the arithmetic.
    const overCeilingMaxOutputTokens = 8_192;
    const estimate: number = preflightEstimateMicroUsd({
      cases: CASES,
      modelIds: DEFAULT_ALLOWED,
      maxOutputTokens: overCeilingMaxOutputTokens,
    });
    expect(estimate).toBeGreaterThanOrEqual(DEV_WEEKLY_CEILING_MICRO_USD);

    const code = await asyncRefusalCode(() =>
      earnRegistry({
        grant: developerMachineGrant(),
        transport: perfectTransport(counter),
        environment: explicitEnvironment([
          [BASE_REF, 'stub-base'],
          [KEY_REF, 'stub-credential'],
        ]),
        config: {
          apiBaseUrlRef: BASE_REF,
          apiKeyRef: KEY_REF,
          completionsPath: '/chat/completions',
          maxOutputTokens: overCeilingMaxOutputTokens,
        },
        modelIds: DEFAULT_ALLOWED,
        evalSet: CASES,
      }),
    );

    expect(code).toBe('PREFLIGHT_ESTIMATE_NOT_BELOW_CAP');
    expect(counter.calls).toBe(0);
  });

  it('every graded model carries an unmeasured developer verdict, so T4 is unroutable', async () => {
    const emitted = emitFrom(await completedRuns());

    for (const result of emitted.results) {
      expect(result.developerBuild.kind).toBe('unmeasured');
      expect(result.developerBuild.reason).toBe('code_benchmark_not_run');
    }
    for (const entry of emitted.document.entries) expect(entry.developerBuild).toBe(false);

    // The consequence, asserted rather than reasoned about: no model this path grades satisfies what
    // T4 requires, so the tier has nothing to route to even from a fully measured registry.
    const admitted = admitEligibilityRegistry(parseEligibilityRegistry(JSON.parse(emitted.json)));
    expect(admitted.eligibleAt('T4')).toEqual([]);
    for (const modelId of admitted.modelIds) {
      const model = admitted.resolve(modelId);
      expect(model).not.toBeNull();
      if (model === null) continue;
      expect(satisfiesRequirement(model, TIER_REQUIRED_ELIGIBILITY.T4)).toBe(false);
    }
  });

  it('a developer-machine grant is refused wherever a server-runtime marker is present', () => {
    expect(
      refusalCode(() =>
        grantDeveloperMachineRun({
          invocation: DEVELOPER_MACHINE_INVOCATION,
          serverRuntimeMarker: 'present',
        }),
      ),
    ).toBe('LIVE_GRANT_REFUSED_SERVER_RUNTIME');
    // The positive control: the same mint succeeds when no marker is visible.
    expect(isLiveMeasurementWitness).toBeTypeOf('function');
    expect(() => developerMachineGrant()).not.toThrow();
  });
});
