// scripts/benchmark/earn-registry.mjs
// NIZAM · Registry runner — the entrypoint that earns a non-provisional eligibility registry
// Owning contract: PFOS 09 (OpenRouter Phase 1 — benchmark calibration) + PFOS 12 / phase 6.3
// Owning spec: .kiro/specs/ship-run-live-bringup — R10, R11, R14
// Steering: two-agent-vps.md §3 (the dev-key carve-out: developer machine only, dev key only,
//   sanitized eval set only, and only for producing the eligibility registry)
// NO DEPLOYMENT PARTICULAR. The provider base and the credential arrive as ENTRY NAMES, resolved
//   through an injected environment; no address and no credential is a literal in this file.
//
// ## Why this module lives in `scripts/` and not in `src/server/`
//
// `liveModelCaller.isolation.test.ts` asserts mechanically that NO file under `src/server/**`
// imports `src/features/benchmark/liveModelCaller.ts`, with a negative test that breaks the
// assertion and watches it fire. This runner is the module that legitimately imports BOTH tiers —
// it is the caller `emitLiveRegistry`'s injection was designed for. Under `src/server/` it would
// break that assertion; under `scripts/` it satisfies it by construction.
//
// ## One process invocation, and why there is no resume
//
// A `LiveMeasurementWitness` is an in-process object identity: the gate is membership in a
// module-private `WeakSet` inside `liveModelCaller.ts`. A `WeakSet` does not survive serialization,
// so a witness cannot cross a process boundary. A checkpoint file would therefore be a new trust
// mechanism — a replay path into the gate — which is exactly the shortcut R11 forbids. So this
// runner dials, mints, grades and emits in ONE invocation, and a crash mid-run forfeits the spend
// already incurred and restarts from zero. That cost is accepted (R10.12); no mechanism avoids it.
//
// ## Money
//
// Provider accounting only, in integer micro-USD. Owner money is integer milliunits behind
// `src/lib/money/` and does not appear here; the two units are never joined. No `parseFloat`, no
// `.toFixed(` — every figure below is integer arithmetic, rounded UP so an estimate never shrinks.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { registerHooks } from 'node:module';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The `@/` path alias, taught to Node's resolver.
 *
 * `dataset.ts` and `datasetIntegrity.ts` import `@/lib/money/money` — the alias `tsconfig.json` and
 * `vite.config.ts` both declare, and which Node's ESM resolver knows nothing about. The alternative
 * would be editing those two tracked source files, and the design's one stated exception is that NO
 * existing file is modified to make this runner reachable. So the runner teaches the resolver
 * instead, in-process and synchronously: no build step, no bundler, no loader flag, and no CLI
 * argument on the npm script. Under Vitest this hook is inert — Vite resolves the alias first.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
    const rest = specifier.slice('@/'.length);
    // Node performs no extension search, so a bare specifier is given the extension it names.
    const named = /\.[cm]?[jt]sx?$/.test(rest) ? rest : `${rest}.ts`;
    return { url: new URL(named, new URL('../../src/', import.meta.url)).href, shortCircuit: true };
  },
});

// Imported dynamically because the hook above must be registered BEFORE these specifiers resolve,
// and a static import is hoisted above every statement in the module.
const { buildEvalSet, validateEvalSet } = await import('../../src/features/benchmark/dataset.ts');
const { auditEvalSet } = await import('../../src/features/benchmark/datasetIntegrity.ts');
const {
  DEVELOPER_MACHINE_INVOCATION,
  grantDeveloperMachineRun,
  isLiveMeasurementWitness,
  liveModelCaller,
  resolveLiveRun,
  revealSecret,
  runLiveModelCalls,
} = await import('../../src/features/benchmark/liveModelCaller.ts');
const {
  CHARS_PER_PROMPT_TOKEN,
  ESTIMATE_SAFETY_MULTIPLIER,
  PreflightError,
  REQUEST_OVERHEAD_TOKENS,
  assertScopedToDefaultAllowed,
  usdToMicroUsd,
} = await import('../../src/features/benchmark/preflight.ts');
const { frozenSnapshot, priceFor } = await import('../../src/features/benchmark/pricing.ts');
const { LiveRegistryError, emitLiveRegistry } = await import(
  '../../src/server/benchmark/liveRegistry.ts'
);

// ---- constants ---------------------------------------------------------------------------------

/**
 * The K4 default-allowed set, and the whole of it. Both models run, not one: the policy selects the
 * CHEAPEST CAPABLE model, and a registry with one entry cannot express a cheapest-capable choice —
 * it expresses "the only one we measured". The premium models are OFF without an explicit owner
 * opt-in, and `assertScopedToDefaultAllowed` refuses one at the moment of the call regardless.
 */
export const DEFAULT_ALLOWED_MODEL_IDS = ['xiaomi/mimo-v2.5', 'z-ai/glm-5.2'];

/** Dev-tier weekly ceiling, integer micro-USD. ~USD 1/week per docs/PFOS_SECRETS_PLAN.md §4. */
export const DEV_WEEKLY_CEILING_MICRO_USD = 1_000_000;

/** Tokens per million. The denominator of every `*UsdPerMillion` rate in the pricing snapshot. */
const TOKENS_PER_MILLION = 1_000_000;

/**
 * Entry NAMES, not values. These are the names the benchmark tier's own tests already use, so there
 * is one vocabulary for a benchmark run's environment rather than two.
 */
export const MODEL_API_BASE_ENTRY = 'NIZAM_BENCH_MODEL_API_BASE';
export const DEV_KEY_ENTRY = 'NIZAM_BENCH_DEV_KEY';
/** An entry naming a FILE that holds the dev credential, for an operator who prefers not to export it. */
export const DEV_KEY_FILE_ENTRY = 'NIZAM_BENCH_DEV_KEY_FILE';
/**
 * The entry whose presence means "this is a server runtime". Read by the RUNNER and passed in,
 * because `liveModelCaller.ts` reads no environment by design — its behaviour is a function of its
 * arguments. `grantDeveloperMachineRun` refuses outright when this resolves to anything, so the
 * runner cannot execute on the host at all.
 */
export const SERVER_RUNTIME_MARKER_ENTRY = 'NIZAM_SERVER_RUNTIME';

/** The path appended to the resolved base. A path is not a deployment particular. */
export const COMPLETIONS_PATH = '/chat/completions';

/** The output allowance requested per case, and the allowance the estimate charges in full. */
export const MAX_OUTPUT_TOKENS = 512;

/** Per-request wall clock bound, whole milliseconds. */
export const REQUEST_TIMEOUT_MS = 60_000;

/**
 * The response read bound, whole bytes. Same value and same reason as the messaging side's
 * `MAX_PROVIDER_RESPONSE_BYTES`: an unbounded read is a memory hazard on a hostile answer. Declared
 * locally rather than imported, so the model side of the runner holds no edge to the messaging tier.
 */
export const MAX_RESPONSE_BYTES = 1_048_576;

/** Where the emitted artifacts land. `artifacts/` is gitignored, so nothing here is ever committed. */
export const ARTIFACT_ROOT = 'artifacts/benchmark';

// ---- the explicit environment ------------------------------------------------------------------

/**
 * An environment that is a Map, never `process.env`.
 *
 * Two reasons this is not a convenience. First, an ambient environment makes a run's inputs
 * invisible: a reader cannot tell which entries were consulted. Second, `process.env` has no
 * distinction between "absent" and "empty", and this resolver must answer `null` for an absent name
 * so `resolveLiveRun` fails closed rather than substituting a default. There is no default here for
 * anything.
 *
 * @param {Iterable<readonly [string, string]> | Map<string, string>} entries
 * @returns {{ resolve(name: string): string | null }}
 */
export function explicitEnvironment(entries) {
  const table = new Map(entries);
  return Object.freeze({
    resolve(name) {
      const value = table.get(name);
      return value === undefined ? null : value;
    },
  });
}

// ---- the transport: the ONE revealSecret call site on the model side ---------------------------

/**
 * Build the network capability the benchmark tier declares and never implements.
 *
 * This is the ONE place on the model side that calls `revealSecret`. The revealed characters are
 * used to build one header and reach no other expression: no log line, no return value, no error
 * message, no thrown object. The request object itself has no field for an authorization value, so
 * it may be quoted whole without disclosing anything.
 *
 * @param {{ requestTimeoutMs: number }} options
 * @returns {(request: { url: string, method: 'POST', body: string }, credential: object) => Promise<{ status: number, bodyText: string, latencyMs: number }>}
 */
export function httpsTransport({ requestTimeoutMs }) {
  return (liveRequest, credential) =>
    new Promise((settle, refuse) => {
      const target = new URL(liveRequest.url);
      const body = Buffer.from(liveRequest.body, 'utf8');
      const startedAt = Date.now();

      const outbound = httpsRequest(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port === '' ? undefined : target.port,
          path: `${target.pathname}${target.search}`,
          method: liveRequest.method,
          headers: {
            'content-type': 'application/json',
            'content-length': String(body.byteLength),
            // The single `revealSecret` call site. The value is consumed here and nowhere else.
            authorization: `Bearer ${revealSecret(credential)}`,
          },
        },
        (incoming) => {
          const chunks = [];
          let read = 0;
          incoming.on('data', (chunk) => {
            read += chunk.byteLength;
            if (read > MAX_RESPONSE_BYTES) {
              incoming.destroy();
              return;
            }
            chunks.push(chunk);
          });
          incoming.on('end', () => {
            settle(
              Object.freeze({
                status: incoming.statusCode ?? 0,
                bodyText: Buffer.concat(chunks).toString('utf8'),
                latencyMs: Date.now() - startedAt,
              }),
            );
          });
          incoming.on('error', refuse);
        },
      );

      outbound.setTimeout(requestTimeoutMs, () => {
        outbound.destroy(new Error('the provider did not answer within the request timeout'));
      });
      outbound.on('error', refuse);
      outbound.end(body);
    });
}

// ---- the pre-flight estimate: integer micro-USD, rounded up ------------------------------------

/**
 * What the run would cost, in integer micro-USD, from the tracked frozen pricing snapshot.
 *
 * Integer arithmetic throughout. Each `*UsdPerMillion` rate is converted ONCE to integer micro-USD
 * per million tokens by `usdToMicroUsd`, which rounds UP, and every division rounds up too — so the
 * figure is an upper bound and may be trusted as a gate rather than as a hint. The same four
 * pessimisms `preflight.ts` documents are stacked here: every prompt token is priced as fresh, the
 * whole output allowance is charged for every case, a flat per-request overhead is added, and the
 * total is multiplied by the safety multiplier.
 *
 * @param {{ cases: readonly { input: string }[], modelIds: readonly string[], maxOutputTokens: number }} input
 * @returns {number} integer micro-USD
 */
export function preflightEstimateMicroUsd({ cases, modelIds, maxOutputTokens }) {
  assertScopedToDefaultAllowed(modelIds);
  if (cases.length === 0) {
    throw new PreflightError(
      'PREFLIGHT_NO_CASES',
      'NIZAM pre-flight: the eval set is empty, so an estimate of zero would be a statement about nothing',
      { at: 'cases' },
    );
  }

  const snapshot = frozenSnapshot();
  let promptTokens = 0;
  for (const benchmarkCase of cases) {
    promptTokens += REQUEST_OVERHEAD_TOKENS + Math.ceil(benchmarkCase.input.length / CHARS_PER_PROMPT_TOKEN);
  }
  const completionTokens = cases.length * maxOutputTokens;

  let totalMicroUsd = 0;
  for (const modelId of modelIds) {
    const price = priceFor(snapshot, modelId);
    const promptMicroUsd = Math.ceil(
      (promptTokens * usdToMicroUsd(price.promptUsdPerMillion)) / TOKENS_PER_MILLION,
    );
    const completionMicroUsd = Math.ceil(
      (completionTokens * usdToMicroUsd(price.completionUsdPerMillion)) / TOKENS_PER_MILLION,
    );
    totalMicroUsd += (promptMicroUsd + completionMicroUsd) * ESTIMATE_SAFETY_MULTIPLIER;
  }
  return totalMicroUsd;
}

// ---- phases 1-8: the run --------------------------------------------------------------------

/**
 * Dial, mint, grade and emit. Phases 1-8, in an order that is not cosmetic.
 *
 * The two gates run BEFORE dialling, and that is the caller's obligation. `emitLiveRegistry` re-runs
 * `validateEvalSet` and `auditEvalSet`, but that happens AFTER the calls — too late to prevent the
 * send. An unsanitized case sent to a third party is the one failure a live run can commit that a
 * fixture run cannot, and no later refusal undoes it.
 *
 * Failures halt. There is no retry loop, no per-case fallback and no continue-on-error: a run with a
 * hole in it is not a measurement, and a loop that keeps trying after a refusal is how a narrow
 * exception becomes an open channel.
 *
 * @param {{
 *   grant?: object,
 *   serverRuntimeMarker?: string | null,
 *   transport: Function,
 *   environment: { resolve(name: string): string | null },
 *   config: { apiBaseUrlRef: string, apiKeyRef: string, completionsPath: string, maxOutputTokens: number },
 *   modelIds: readonly string[],
 *   evalSet?: readonly object[],
 *   report?: (line: string) => void,
 * }} input
 */
export async function earnRegistry(input) {
  const { transport, environment, config, modelIds } = input;
  const report = input.report ?? (() => {});

  // Phase 1 — the developer-machine grant. The marker is read from the process environment by the
  // runner and passed IN, because `liveModelCaller.ts` reads no environment by design. A caller that
  // can see a server-runtime marker IS a server process, and the mint refuses one outright.
  const grant =
    input.grant ??
    grantDeveloperMachineRun({
      invocation: DEVELOPER_MACHINE_INVOCATION,
      serverRuntimeMarker: input.serverRuntimeMarker ?? null,
    });

  // Phase 2 — the eval set.
  const cases = [...(input.evalSet ?? buildEvalSet())];

  // Phase 3 — contract 09's case minimums, before anything is sent.
  const completeness = validateEvalSet(cases);
  if (!completeness.ok) {
    throw new LiveRegistryError(
      'LIVE_REGISTRY_EVAL_SET_INCOMPLETE',
      'the eval set does not meet contract 09 case minimums, so no live call is made from it',
      { problems: String(completeness.problems.length) },
    );
  }

  // Phase 4 — the sanitization audit, before anything is sent. This is the gate that must never be
  // reached late: the send it prevents cannot be undone.
  const sanitization = auditEvalSet(cases);
  if (!sanitization.ok) {
    const gates = [...new Set(sanitization.problems.map((problem) => problem.gate))].sort().join(', ');
    throw new LiveRegistryError(
      'LIVE_REGISTRY_EVAL_SET_UNSANITIZED',
      'the eval set fails its sanitization audit, and a live run sends case text to a third party, so nothing is dialled (steering §0b, §3)',
      { gates },
    );
  }

  // Phase 5 — the estimate, REPORTED before any spend. An estimate that does not fit is a decision
  // not to start, rather than a reason to attempt the run and stop when the cap trips.
  const estimateMicroUsd = preflightEstimateMicroUsd({
    cases,
    modelIds,
    maxOutputTokens: config.maxOutputTokens,
  });
  report(
    `pre-flight estimate: ${estimateMicroUsd} micro-USD over ${cases.length} cases and ${modelIds.length} models; ceiling ${DEV_WEEKLY_CEILING_MICRO_USD} micro-USD`,
  );
  if (estimateMicroUsd >= DEV_WEEKLY_CEILING_MICRO_USD) {
    throw new PreflightError(
      'PREFLIGHT_ESTIMATE_NOT_BELOW_CAP',
      'NIZAM pre-flight: the estimated cost of the run is not strictly below the dev key ceiling, so nothing is spent and the fixture-backed path stands (steering §3)',
      { estimatedMicroUsd: String(estimateMicroUsd), capMicroUsd: String(DEV_WEEKLY_CEILING_MICRO_USD) },
    );
  }

  // Phase 6 — resolve the endpoint and the credential by ENTRY NAME, or refuse. No default endpoint.
  const resolved = resolveLiveRun(grant, environment, config);

  // Phase 7 — the calls, one model at a time, in eval-set order. The first failure aborts.
  const runs = [];
  for (const modelId of modelIds) {
    const run = await runLiveModelCalls({
      grant,
      transport,
      resolved,
      modelId,
      cases,
      maxOutputTokens: config.maxOutputTokens,
    });
    runs.push(run);
    report(`${modelId}: ${run.witness.casesAnswered} cases answered, ${run.witness.actualCostMicroUsd} micro-USD reported`);
  }

  // Phase 8 — grade and emit. Both capabilities are injected and neither is defaulted:
  // `liveModelCaller` already has the exact `ModelCaller` shape `buildCaller` asks for, and
  // `isLiveMeasurementWitness` is passed BY REFERENCE, unchanged. It checks `WeakSet` membership —
  // identity, not structure — which is precisely why it must not be wrapped, re-implemented, or
  // defaulted to a constant acceptance.
  const emitted = emitLiveRegistry({
    runs,
    buildCaller: liveModelCaller,
    verifyWitness: isLiveMeasurementWitness,
    evalSet: cases,
  });

  return { emitted, runs, estimateMicroUsd };
}

// ---- phase 9: writing the artifacts ----------------------------------------------------------

/**
 * Write every entry of `emitted.artifacts` VERBATIM through the injected sink.
 *
 * The map is already keyed by final relative path, including the top-level registry, so there is
 * nothing to rename and nothing to compose. `LIVE_REGISTRY_FILE_NAME === PROVISIONAL_REGISTRY_FILE_NAME`
 * and this runner leaves that alone: one name means a stale provisional document and a measured one
 * cannot sit side by side, and two names is exactly how the stale one ends up being the one read.
 *
 * @param {(relativePath: string, text: string) => void} sink
 * @param {{ artifacts: Readonly<Record<string, string>> }} emitted
 * @returns {string[]} the relative paths written, in the order written
 */
export function writeEmitted(sink, emitted) {
  const written = [];
  for (const [relativePath, text] of Object.entries(emitted.artifacts)) {
    sink(relativePath, text);
    written.push(relativePath);
  }
  return written;
}

/** A sink that writes under a root on the local filesystem, creating parent directories. */
export function fileSystemSink(root) {
  return (relativePath, text) => {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, 'utf8');
  };
}

// ---- phase 10: the entrypoint ----------------------------------------------------------------

/**
 * Resolve the dev credential by entry name, or from a file named by entry name. Never a literal,
 * never a guess: an absent entry leaves the environment without the name, and `resolveLiveRun`
 * refuses with `LIVE_API_KEY_UNRESOLVED` rather than proceeding.
 */
function devCredentialFrom(processEnv) {
  const direct = processEnv[DEV_KEY_ENTRY];
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();
  const path = processEnv[DEV_KEY_FILE_ENTRY];
  if (typeof path === 'string' && path.trim().length > 0) {
    return readFileSync(path.trim(), 'utf8').trim();
  }
  return null;
}

/**
 * The default invocation takes no arguments: the model list, the entry names and the pricing inputs
 * are module constants, so the default invocation is the audited one.
 */
export async function main(processEnv = process.env, log = console.log) {
  const entries = new Map();
  const base = processEnv[MODEL_API_BASE_ENTRY];
  if (typeof base === 'string' && base.trim().length > 0) entries.set(MODEL_API_BASE_ENTRY, base.trim());
  const credential = devCredentialFrom(processEnv);
  if (credential !== null) entries.set(DEV_KEY_ENTRY, credential);

  const serverRuntimeMarker = processEnv[SERVER_RUNTIME_MARKER_ENTRY] ?? null;

  try {
    const { emitted, estimateMicroUsd } = await earnRegistry({
      serverRuntimeMarker,
      transport: httpsTransport({ requestTimeoutMs: REQUEST_TIMEOUT_MS }),
      environment: explicitEnvironment(entries),
      config: {
        apiBaseUrlRef: MODEL_API_BASE_ENTRY,
        apiKeyRef: DEV_KEY_ENTRY,
        completionsPath: COMPLETIONS_PATH,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
      modelIds: DEFAULT_ALLOWED_MODEL_IDS,
      report: log,
    });

    const written = writeEmitted(fileSystemSink(ARTIFACT_ROOT), emitted);
    const casesAnswered = emitted.results.reduce((sum, result) => sum + result.casesGraded, 0);

    // The four numbers, plus the emitted path. Provider accounting exactly as the provider reported
    // it: never converted, never re-derived from a price table, never estimated.
    log(`cases in the eval set: ${emitted.results[0]?.casesGraded ?? 0}`);
    log(`cases answered: ${casesAnswered}`);
    log(`models graded: ${emitted.results.length}`);
    log(`actual cost: ${emitted.actualCostMicroUsd} micro-USD (estimate was ${estimateMicroUsd})`);
    log(`emitted: ${join(ARTIFACT_ROOT, emitted.fileName)} (${written.length} artifacts)`);
    return 0;
  } catch (error) {
    // Discriminated on `code`, never on a message: a message is prose that can be reworded, a code
    // is the contract. The default arm re-raises rather than absorbing an error it does not know.
    const code = error instanceof Error && 'code' in error ? String(error.code) : null;
    switch (code) {
      case 'LIVE_GRANT_REFUSED_SERVER_RUNTIME':
      case 'LIVE_GRANT_INVOCATION_UNRECOGNISED':
      case 'LIVE_GRANT_NOT_MINTED':
      case 'LIVE_API_BASE_URL_UNRESOLVED':
      case 'LIVE_API_KEY_UNRESOLVED':
      case 'LIVE_SECRET_NOT_WRAPPED':
      case 'LIVE_PROVIDER_STATUS_NOT_OK':
      case 'LIVE_PROVIDER_BODY_UNPARSEABLE':
      case 'LIVE_PROVIDER_USAGE_ABSENT':
      case 'LIVE_PROVIDER_SERVED_ANOTHER_MODEL':
      case 'LIVE_CASE_HAS_NO_EXCHANGE':
      case 'LIVE_REGISTRY_NO_RUNS':
      case 'LIVE_REGISTRY_DUPLICATE_MODEL':
      case 'LIVE_REGISTRY_MODEL_NOT_DEFAULT_ALLOWED':
      case 'LIVE_REGISTRY_WITNESS_NOT_ACCEPTED':
      case 'LIVE_REGISTRY_WITNESS_MODEL_MISMATCH':
      case 'LIVE_REGISTRY_RUN_INCOMPLETE':
      case 'LIVE_REGISTRY_EVAL_SET_INCOMPLETE':
      case 'LIVE_REGISTRY_EVAL_SET_UNSANITIZED':
      case 'LIVE_REGISTRY_ARTIFACT_MISSING':
      case 'PREFLIGHT_NO_MODELS':
      case 'PREFLIGHT_NO_CASES':
      case 'PREFLIGHT_MODEL_NOT_DEFAULT_ALLOWED':
      case 'PREFLIGHT_ESTIMATE_NOT_BELOW_CAP': {
        // `detail` carries counts, gate names, model ids, entry names and micro-USD figures only.
        // Nothing is added to it here.
        const detail = /** @type {{ detail?: Record<string, string> }} */ (error).detail ?? {};
        log(`REFUSED ${code} ${JSON.stringify(detail)}`);
        return 1;
      }
      default:
        throw error;
    }
  }
}

// Guarded so that IMPORTING this module dials nothing: the RUNG 3 smoke test drives the exported
// phases without executing a run.
const invokedDirectly =
  process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await main();
}
