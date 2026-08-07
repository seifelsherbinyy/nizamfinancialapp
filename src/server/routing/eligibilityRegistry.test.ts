// @vitest-environment node
/**
 * NIZAM · The registry gate — fail-closed in all four senses, and provisional refused twice
 * Implemented by: PFOS Contract 12 / Phase 5.2 (spec 06-two-agent-vps)
 * Owning requirements: R18 (a selected model is in the registry; a `provisional` registry does not
 *   permit live routing)
 * Depends on: ./eligibilityRegistry, ../mocks/fixtures, ../../features/routing/modelPolicy
 *
 * §6.3 lists four fail-closed conditions and calls a provisional registry "a gate item, not worked
 * around". Each condition below is exercised as its own case with its own code, because an operator
 * who cannot tell which of the four they are in cannot record the gate item.
 *
 * The provisional rule is asserted TWICE, from the two directions it holds in. Once in the type
 * checker, via `@ts-expect-error` on a document whose `provisional` is the literal `true` — the
 * refusal that happens before the program exists. Once at run time, by defeating the type with a
 * cast, which is the only way a provisional document can reach the admitting function at all and
 * therefore the only case the runtime belt is for.
 *
 * The fixture tie is exercised with a REAL `LoadedFixture` from the Phase 2.2 loader rather than a
 * hand-written object, because the claim being made is about that loader's literal type.
 *
 * No figure and no deployment particular appears in any fixture (§6, R24).
 */
import { describe, expect, it } from 'vitest';

import { MODEL_GLM, MODEL_GROK, MODEL_KIMI, MODEL_MIMO } from '../../features/routing/modelPolicy';
import { inlineFixtureSource, loadRecordedInteractions, type LoadedFixture } from '../mocks/fixtures';
import {
  admitEligibilityRegistry,
  ELIGIBILITY_BANDS,
  ELIGIBILITY_REGISTRY_VERSION,
  EligibilityRegistryError,
  isAdmittedModel,
  parseEligibilityRegistry,
  parseEligibilityRegistryText,
  provisionalRegistryFromFixture,
  satisfiesRequirement,
  TIER_REQUIRED_ELIGIBILITY,
  type EligibilityRegistryEntry,
  type EligibleModel,
  type LiveEligibilityRegistry,
} from './eligibilityRegistry';

/** A model graded for everything. Synthetic grades; no benchmark ran to produce these. */
function graded(modelId: string, over: Partial<EligibilityRegistryEntry> = {}): EligibilityRegistryEntry {
  return {
    modelId,
    bands: { L0: true, L1: true, L2: true },
    developerBuild: true,
    disqualified: false,
    ...over,
  };
}

const ENTRIES: readonly EligibilityRegistryEntry[] = Object.freeze([graded(MODEL_MIMO), graded(MODEL_GLM)]);

function live(entries: readonly EligibilityRegistryEntry[] = ENTRIES): LiveEligibilityRegistry {
  return { registryVersion: ELIGIBILITY_REGISTRY_VERSION, provisional: false, entries };
}

/** The smallest document the Phase 2.2 loader accepts, so `provisional: true` is the real thing. */
const EMPTY_FIXTURE = JSON.stringify({
  fixtureVersion: 1,
  synthetic: true,
  name: 'routing-registry',
  telegramDeliveries: [],
  modelExchanges: [],
  recoveryObservations: [],
  snapshots: [],
  signals: [],
});

function loadedFixture(): LoadedFixture {
  return loadRecordedInteractions(inlineFixtureSource({ 'routing-registry': EMPTY_FIXTURE }), 'routing-registry');
}

function codeOf(attempt: () => unknown): string {
  try {
    attempt();
  } catch (error) {
    expect(error).toBeInstanceOf(EligibilityRegistryError);
    return (error as EligibilityRegistryError).code;
  }
  throw new Error('expected the registry to refuse, but it did not');
}

describe('the four fail-closed conditions of §6.3, each with its own code (R18)', () => {
  it('refuses an absent registry, because absence means ineligible and there is no implicit default', () => {
    expect(codeOf(() => parseEligibilityRegistry(null))).toBe('ELIGIBILITY_REGISTRY_ABSENT');
    expect(codeOf(() => parseEligibilityRegistry(undefined))).toBe('ELIGIBILITY_REGISTRY_ABSENT');
    expect(codeOf(() => parseEligibilityRegistryText(null))).toBe('ELIGIBILITY_REGISTRY_ABSENT');
  });

  it('refuses an unparseable registry rather than continuing with a warning', () => {
    expect(codeOf(() => parseEligibilityRegistry('not a document'))).toBe('ELIGIBILITY_REGISTRY_UNPARSEABLE');
    expect(codeOf(() => parseEligibilityRegistryText('{ this is not json'))).toBe('ELIGIBILITY_REGISTRY_UNPARSEABLE');
  });

  it('refuses a registry with no explicit provisional flag — absence is NOT "not provisional"', () => {
    // This is the case §6.3 names in as many words, and the one an ordinary truthiness check gets
    // wrong: `!raw.provisional` is true for an absent flag, which would ADMIT the registry.
    expect(codeOf(() => parseEligibilityRegistry({ registryVersion: ELIGIBILITY_REGISTRY_VERSION, entries: [] }))).toBe(
      'ELIGIBILITY_REGISTRY_PROVISIONAL_FLAG_ABSENT',
    );
    // A non-boolean flag is the same situation wearing a different hat.
    expect(
      codeOf(() =>
        parseEligibilityRegistry({ registryVersion: ELIGIBILITY_REGISTRY_VERSION, provisional: 'no', entries: [] }),
      ),
    ).toBe('ELIGIBILITY_REGISTRY_PROVISIONAL_FLAG_ABSENT');
  });

  it('refuses a provisional registry at run time, the belt behind the type', () => {
    const document = { registryVersion: ELIGIBILITY_REGISTRY_VERSION, provisional: true, entries: [graded(MODEL_GLM)] };
    expect(codeOf(() => parseEligibilityRegistry(document))).toBe('ELIGIBILITY_REGISTRY_PROVISIONAL');
    // And again at the admitting function, reached only by defeating the type with a cast.
    expect(codeOf(() => admitEligibilityRegistry(document as unknown as LiveEligibilityRegistry))).toBe(
      'ELIGIBILITY_REGISTRY_PROVISIONAL',
    );
  });

  it('refuses a version it cannot read rather than assuming compatibility', () => {
    expect(codeOf(() => parseEligibilityRegistry({ registryVersion: 99, provisional: false, entries: [] }))).toBe(
      'ELIGIBILITY_REGISTRY_VERSION_UNSUPPORTED',
    );
  });
});

describe('a provisional registry is refused by the type checker, before any belt runs (R18)', () => {
  it('will not accept a document whose provisional flag is the literal true', () => {
    const provisional = provisionalRegistryFromFixture({ provisional: true }, ENTRIES);
    expect(() =>
      // @ts-expect-error §6.3, R18: `provisional: true` is not assignable to `provisional: false`,
      // so a provisional registry does not satisfy the admitting function's parameter at all.
      admitEligibilityRegistry(provisional),
    ).toThrow(EligibilityRegistryError);
  });

  it('ties a fixture-backed run to a registry the router cannot be handed (steering §3)', () => {
    // The claim is about `mocks/fixtures.ts`, so the value comes from that loader, not from a
    // literal written here: `LoadedFixture.provisional` is the literal `true`.
    const loaded = loadedFixture();
    expect(loaded.provisional).toBe(true);
    const fromFixtures = provisionalRegistryFromFixture(loaded, ENTRIES);
    expect(fromFixtures.provisional).toBe(true);
    expect(codeOf(() => admitEligibilityRegistry(fromFixtures as unknown as LiveEligibilityRegistry))).toBe(
      'ELIGIBILITY_REGISTRY_PROVISIONAL',
    );
  });
});

describe('an entry that cannot be read is refused, not partially trusted', () => {
  it('refuses an entry whose developer/build verdict is unstated', () => {
    const entry = { modelId: MODEL_GLM, bands: { L0: true, L1: true, L2: true }, disqualified: false };
    expect(codeOf(() => parseEligibilityRegistry({ registryVersion: 1, provisional: false, entries: [entry] }))).toBe(
      'ELIGIBILITY_REGISTRY_ENTRY_INVALID',
    );
  });

  it('refuses an entry that omits a band, because an ungraded model is not a graded one', () => {
    const entry = { modelId: MODEL_GLM, bands: { L0: true, L1: true }, developerBuild: false, disqualified: false };
    expect(codeOf(() => parseEligibilityRegistry({ registryVersion: 1, provisional: false, entries: [entry] }))).toBe(
      'ELIGIBILITY_REGISTRY_ENTRY_INVALID',
    );
  });

  it('refuses a band name contract 09 does not define', () => {
    const entry = {
      modelId: MODEL_GLM,
      bands: { L0: true, L1: true, L2: true, L3: true },
      developerBuild: false,
      disqualified: false,
    };
    expect(codeOf(() => parseEligibilityRegistry({ registryVersion: 1, provisional: false, entries: [entry] }))).toBe(
      'ELIGIBILITY_REGISTRY_ENTRY_INVALID',
    );
  });

  it('refuses two grades for one model rather than resolving the ambiguity by position', () => {
    expect(codeOf(() => admitEligibilityRegistry(live([graded(MODEL_GLM), graded(MODEL_GLM)])))).toBe(
      'ELIGIBILITY_REGISTRY_DUPLICATE_ENTRY',
    );
  });

  it('refuses a registry that lists nothing, which would look enabled but route nowhere', () => {
    expect(codeOf(() => admitEligibilityRegistry(live([])))).toBe('ELIGIBILITY_REGISTRY_EMPTY');
  });
});

describe('presence in the registry is the only source of a selectable model (R18)', () => {
  it('resolves a listed model and refuses to resolve an unlisted one', () => {
    const registry = admitEligibilityRegistry(live());
    expect(registry.resolve(MODEL_MIMO)?.modelId).toBe(MODEL_MIMO);
    // The whole of rule 1: an unlisted model yields nothing, so there is no value to return.
    expect(registry.resolve(MODEL_KIMI)).toBeNull();
    expect(registry.modelIds).toEqual([MODEL_MIMO, MODEL_GLM]);
  });

  it('refuses a model-shaped value built by a cast rather than minted from an entry', () => {
    const forged = { modelId: MODEL_KIMI, bands: { L0: true, L1: true, L2: true }, developerBuild: true } as unknown as EligibleModel;
    expect(isAdmittedModel(forged)).toBe(false);
    const registry = admitEligibilityRegistry(live());
    const genuine = registry.resolve(MODEL_GLM);
    expect(genuine).not.toBeNull();
    expect(isAdmittedModel(genuine as EligibleModel)).toBe(true);
    // A field-for-field copy of a genuine model is still not one, for the same reason Phase 5.1's
    // copied grant is not a grant: the mint is recorded per value, not per shape.
    expect(isAdmittedModel({ ...(genuine as EligibleModel) })).toBe(false);
  });

  it('grades a disqualified model for nothing, so contract 09 automatic failure survives routing', () => {
    const registry = admitEligibilityRegistry(live([graded(MODEL_GLM, { disqualified: true })]));
    const model = registry.resolve(MODEL_GLM);
    expect(model?.bands).toEqual({ L0: false, L1: false, L2: false });
    expect(model?.developerBuild).toBe(false);
    for (const tier of ['T1', 'T2', 'T3', 'T4'] as const) {
      expect(registry.eligibleAt(tier)).toEqual([]);
    }
  });
});

describe('where contract 09 L-scale meets contract 10 T-scale', () => {
  it('states one requirement per model-bearing tier and no requirement for T0', () => {
    expect(TIER_REQUIRED_ELIGIBILITY).toEqual({
      T1: { kind: 'finance_band', band: 'L0' },
      T2: { kind: 'finance_band', band: 'L1' },
      T3: { kind: 'finance_band', band: 'L2' },
      T4: { kind: 'developer_build' },
    });
    expect(Object.keys(TIER_REQUIRED_ELIGIBILITY)).not.toContain('T0');
    expect(ELIGIBILITY_BANDS).toEqual(['L0', 'L1', 'L2']);
  });

  it('does not treat the bands as a ladder — L1 alone does not admit a model to T1', () => {
    // Contract 09 grades L0 on critical-field extraction accuracy and L1 on schema validity plus
    // evidence coverage. They measure different things and `evaluateEligibility` computes them
    // independently, so a model strong on advice is NOT thereby trusted with extraction.
    const registry = admitEligibilityRegistry(
      live([graded(MODEL_MIMO, { bands: { L0: false, L1: true, L2: true } })]),
    );
    expect(registry.eligibleAt('T1')).toEqual([]);
    expect(registry.eligibleAt('T2').map((m) => m.modelId)).toEqual([MODEL_MIMO]);
  });

  it('grades T4 on the developer/build axis only, which contract 09 keeps separate from finance', () => {
    const registry = admitEligibilityRegistry(
      live([graded(MODEL_GLM, { bands: { L0: true, L1: true, L2: true }, developerBuild: false })]),
    );
    expect(registry.eligibleAt('T4')).toEqual([]);
    expect(registry.eligibleAt('T3').map((m) => m.modelId)).toEqual([MODEL_GLM]);
  });

  it('answers each requirement from the grade it names and no other', () => {
    const registry = admitEligibilityRegistry(live([graded(MODEL_GROK, { bands: { L0: false, L1: false, L2: true } })]));
    const model = registry.resolve(MODEL_GROK) as EligibleModel;
    expect(satisfiesRequirement(model, { kind: 'finance_band', band: 'L2' })).toBe(true);
    expect(satisfiesRequirement(model, { kind: 'finance_band', band: 'L0' })).toBe(false);
    expect(satisfiesRequirement(model, { kind: 'developer_build' })).toBe(true);
  });
});

describe('the happy path exists, so the refusals above are not refusing everything', () => {
  it('admits a live registry read from text and lists its models', () => {
    const registry = admitEligibilityRegistry(
      parseEligibilityRegistryText(
        JSON.stringify({ registryVersion: ELIGIBILITY_REGISTRY_VERSION, provisional: false, entries: ENTRIES }),
      ),
    );
    expect(registry.modelIds).toEqual([MODEL_MIMO, MODEL_GLM]);
    expect(registry.eligibleAt('T1').map((m) => m.modelId)).toEqual([MODEL_MIMO, MODEL_GLM]);
  });
});
