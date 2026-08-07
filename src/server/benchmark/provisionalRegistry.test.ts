// @vitest-environment node
/**
 * NIZAM · The provisional registry is genuinely unusable for live routing, not merely labelled
 * Implemented by: PFOS Contract 12 / Phase 6.2 (spec 06-two-agent-vps)
 * Owning requirements: R18 (a model is selected only if the registry lists it; a `provisional`
 *   registry does not permit live routing); R24 (no deployment particular in a tracked file)
 * Depends on: ./provisionalRegistry, ../mocks/fixtures, ../routing/eligibilityRegistry
 *
 * NO NETWORK, NO KEY. The strongest assertion available here is the ROUND TRIP: the emitted
 * artifact, re-read exactly as the router would re-read it, must be REFUSED with
 * `ELIGIBILITY_REGISTRY_PROVISIONAL`. A label anyone could edit is not the claim; unusability is.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEvalSet } from '../../features/benchmark/dataset';
import { loadRecordedInteractions, nodeFixtureSource, type LoadedFixture } from '../mocks/fixtures';
import {
  EligibilityRegistryError,
  admitEligibilityRegistry,
  parseEligibilityRegistry,
  parseEligibilityRegistryText,
  type LiveEligibilityRegistry,
} from '../routing/eligibilityRegistry';
import {
  PER_MODEL_ARTIFACT_NAMES,
  PROVISIONAL_ARTIFACT_DIRECTORY,
  PROVISIONAL_REGISTRY_FILE_NAME,
  ProvisionalRegistryError,
  artifactPrefixForModel,
  emitProvisionalRegistry,
  inlineRegistrySink,
  nodeRegistrySink,
  writeProvisionalRegistry,
} from './provisionalRegistry';

const MODEL_A = 'xiaomi/mimo-v2.5';
const MODEL_B = 'z-ai/glm-5.2';
const FIXTURE_NAME = 'benchmark-phase1-replay';

const evalSet = buildEvalSet();
// The real Phase 2.2 loader, reading the recorded fixture document from disk. Nothing here
// constructs a fixture by hand, which is what ties `provisional: true` to the loader.
const fixture = loadRecordedInteractions(nodeFixtureSource(), FIXTURE_NAME);
const emitted = emitProvisionalRegistry({ fixture, modelIds: [MODEL_A, MODEL_B], evalSet });

function registryCodeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof EligibilityRegistryError) return error.code;
    throw error;
  }
  throw new Error('expected an EligibilityRegistryError, but the call succeeded');
}

function emitCodeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ProvisionalRegistryError) return error.code;
    throw error;
  }
  throw new Error('expected a ProvisionalRegistryError, but the call succeeded');
}

describe('the emitted document has the shape the router parses', () => {
  it('carries registryVersion, provisional and entries, and nothing else', () => {
    const parsedBack: unknown = JSON.parse(emitted.json);
    expect(Object.keys(parsedBack as object).sort()).toEqual(['entries', 'provisional', 'registryVersion']);
    expect((parsedBack as { registryVersion: number }).registryVersion).toBe(1);
  });

  it('gives every entry a modelId, three bands, developerBuild and disqualified', () => {
    for (const entry of emitted.document.entries) {
      expect(Object.keys(entry).sort()).toEqual(['bands', 'developerBuild', 'disqualified', 'modelId']);
      expect(Object.keys(entry.bands).sort()).toEqual(['L0', 'L1', 'L2']);
      for (const band of ['L0', 'L1', 'L2'] as const) expect(typeof entry.bands[band]).toBe('boolean');
      expect(typeof entry.developerBuild).toBe('boolean');
      expect(typeof entry.disqualified).toBe('boolean');
    }
  });

  it('grades each named model exactly once, in the order the run named them', () => {
    expect(emitted.document.entries.map((entry) => entry.modelId)).toEqual([MODEL_A, MODEL_B]);
  });

  it('reports contract 09 bands from the real aggregator, including a disqualification', () => {
    const [a, b] = emitted.document.entries;
    // Model A's recording gets one extraction critical field wrong, which is below the L0 bar but
    // is not a safety breach, so L1 and L2 survive.
    expect(a!.bands).toEqual({ L0: false, L1: true, L2: true });
    expect(a!.disqualified).toBe(false);
    // Model B's recording complies with a P0 adversarial case, which disqualifies it outright.
    expect(b!.disqualified).toBe(true);
    expect(b!.bands).toEqual({ L0: false, L1: false, L2: false });
  });
});

describe('the round trip: the artifact is unusable for live routing', () => {
  // THE assertion of this phase. The emitted text, re-read exactly as the router re-reads it.
  it('is refused with ELIGIBILITY_REGISTRY_PROVISIONAL when parsed from the emitted object', () => {
    expect(registryCodeOf(() => parseEligibilityRegistry(JSON.parse(emitted.json)))).toBe(
      'ELIGIBILITY_REGISTRY_PROVISIONAL',
    );
  });

  it('is refused the same way when parsed from the emitted text', () => {
    expect(registryCodeOf(() => parseEligibilityRegistryText(emitted.json))).toBe(
      'ELIGIBILITY_REGISTRY_PROVISIONAL',
    );
  });

  it('is refused for admission even when the type is defeated by a cast', () => {
    const defeated = emitted.document as unknown as LiveEligibilityRegistry;
    expect(registryCodeOf(() => admitEligibilityRegistry(defeated))).toBe(
      'ELIGIBILITY_REGISTRY_PROVISIONAL',
    );
  });

  it('mints no eligible model, so no model can be selected from it', () => {
    let minted = false;
    try {
      admitEligibilityRegistry(emitted.document as unknown as LiveEligibilityRegistry);
      minted = true;
    } catch {
      minted = false;
    }
    expect(minted).toBe(false);
  });
});

describe('the provisional mark comes from the fixture loader', () => {
  it('is the loader-supplied literal, not a value this module wrote', () => {
    expect(fixture.provisional).toBe(true);
    expect(emitted.document.provisional).toBe(fixture.provisional);
  });

  // NEGATIVE: the tie is structural. A "fixture" whose flag is not `true` is not assignable to the
  // only construction path, so the sole way to reach it at run time is a cast — and the document
  // that comes back still refuses, because the flag is copied from the argument.
  it('propagates whatever the loader said rather than hard-coding true', () => {
    const notProvisional = { ...fixture, provisional: false } as unknown as LoadedFixture;
    const forged = emitProvisionalRegistry({
      fixture: notProvisional,
      modelIds: [MODEL_A, MODEL_B],
      evalSet,
    });
    // The flag tracks the argument. There is no `provisional: true` literal in the emission path,
    // so a forged fixture produces a document that is honest about where it came from.
    expect(forged.document.provisional).toBe(false);
  });
});

describe('developerBuild is false on every fixture-backed entry', () => {
  it('states false, because a fixture-backed run measured no developer or build work', () => {
    for (const entry of emitted.document.entries) expect(entry.developerBuild).toBe(false);
  });

  it('records the reason as a fixture-backed run rather than leaving it unstated', () => {
    for (const run of emitted.runs) {
      expect(run.developerBuild.kind).toBe('unmeasured');
      expect(run.developerBuild.reason).toBe('fixture_backed_run');
    }
  });
});

describe('contract 09 output artifacts', () => {
  it('emits the registry once and the other four per model', () => {
    const names = Object.keys(emitted.artifacts).sort();
    const expected = [
      PROVISIONAL_REGISTRY_FILE_NAME,
      ...[MODEL_A, MODEL_B].flatMap((modelId) =>
        PER_MODEL_ARTIFACT_NAMES.map((name) => `${artifactPrefixForModel(modelId)}/${name}`),
      ),
    ].sort();
    expect(names).toEqual(expected);
  });

  it('turns a provider model id into a single path segment', () => {
    expect(artifactPrefixForModel(MODEL_A)).toBe('xiaomi__mimo-v2.5');
    expect(artifactPrefixForModel(MODEL_A)).not.toContain('/');
  });

  it('writes every artifact through an injected sink', () => {
    const sink = inlineRegistrySink();
    writeProvisionalRegistry(sink, emitted);
    expect([...sink.written.keys()].sort()).toEqual(Object.keys(emitted.artifacts).sort());
    expect(sink.written.get(PROVISIONAL_REGISTRY_FILE_NAME)).toBe(emitted.json);
  });

  it('names a git-ignored directory that is not dist, outputs or the loop scratch', () => {
    expect(PROVISIONAL_ARTIFACT_DIRECTORY).toBe('artifacts/benchmark');
    for (const taken of ['dist', 'outputs', '.loop/tmp']) {
      expect(PROVISIONAL_ARTIFACT_DIRECTORY.startsWith(taken)).toBe(false);
    }
  });
});

describe('the filesystem sink', () => {
  it('writes the artifact tree under the directory it was given, creating parents', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nizam-registry-'));
    try {
      writeProvisionalRegistry(nodeRegistrySink(directory), emitted);
      const written = readFileSync(join(directory, PROVISIONAL_REGISTRY_FILE_NAME), 'utf8');
      expect(written).toBe(emitted.json);
      // And the round trip holds for the text that actually reached disk.
      expect(registryCodeOf(() => parseEligibilityRegistryText(written))).toBe(
        'ELIGIBILITY_REGISTRY_PROVISIONAL',
      );
      const report = readFileSync(
        join(directory, artifactPrefixForModel(MODEL_A), 'benchmark_report.md'),
        'utf8',
      );
      expect(report).toContain('Benchmark report');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // NEGATIVE: an artifact name is derived from a model id, which is provider-supplied text.
  it('refuses a name that resolves outside the directory it was given', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nizam-registry-'));
    try {
      const sink = nodeRegistrySink(directory);
      expect(emitCodeOf(() => sink.write('../escaped.json', 'x'))).toBe(
        'REGISTRY_ARTIFACT_NAME_ESCAPES_DIRECTORY',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('emission refuses before it produces a misleading artifact', () => {
  // NEGATIVE: an empty registry is indistinguishable from an absent one for routing.
  it('refuses a run that names no model', () => {
    expect(emitCodeOf(() => emitProvisionalRegistry({ fixture, modelIds: [], evalSet }))).toBe(
      'REGISTRY_NO_MODELS',
    );
  });

  // NEGATIVE: two grades for one model is an ambiguous registry.
  it('refuses a run that names a model twice', () => {
    expect(
      emitCodeOf(() => emitProvisionalRegistry({ fixture, modelIds: [MODEL_A, MODEL_A], evalSet })),
    ).toBe('REGISTRY_DUPLICATE_MODEL');
  });

  // NEGATIVE: 6.1's completeness bar. A registry built on a short eval set would read as evidence.
  it('refuses an eval set below contract 09 case minimums', () => {
    expect(
      emitCodeOf(() =>
        emitProvisionalRegistry({ fixture, modelIds: [MODEL_A], evalSet: evalSet.slice(0, 12) }),
      ),
    ).toBe('REGISTRY_EVAL_SET_INCOMPLETE');
  });

  // NEGATIVE: 6.1's sanitization audit. The repository is public (steering §0b).
  it('refuses an eval set carrying an unsanitized case', () => {
    const smuggled = evalSet.map((c, index) =>
      index === 0 ? { ...c, allowableVariation: `${c.allowableVariation} see 203.0.113.7` } : c,
    );
    expect(emitCodeOf(() => emitProvisionalRegistry({ fixture, modelIds: [MODEL_A], evalSet: smuggled }))).toBe(
      'REGISTRY_EVAL_SET_UNSANITIZED',
    );
  });

  // NEGATIVE: inherited from the replay layer — a graded model with no recording at all would be
  // graded flawlessly from the correct baseline, which is promotion from nothing.
  it('refuses a model the fixture recorded nothing for', () => {
    expect(() =>
      emitProvisionalRegistry({ fixture, modelIds: [MODEL_A, MODEL_B, 'x-ai/grok-4.5'], evalSet }),
    ).toThrow(/fabricated pass/i);
  });

  // NEGATIVE: and the sibling refusal — a recording naming a model the run does not grade is not
  // quietly ignored, because ignoring it would grade its intended model from the baseline alone.
  it('refuses when a recording names a model outside the run', () => {
    expect(() => emitProvisionalRegistry({ fixture, modelIds: [MODEL_A], evalSet })).toThrow(
      /does not grade/i,
    );
  });

  it('carries no case text or figure in a refusal detail', () => {
    try {
      emitProvisionalRegistry({ fixture, modelIds: [], evalSet });
      throw new Error('expected a refusal');
    } catch (error) {
      const failure = error as ProvisionalRegistryError;
      expect(Object.keys(failure.detail)).toEqual(['at']);
    }
  });
});
