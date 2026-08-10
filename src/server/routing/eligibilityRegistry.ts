/**
 * NIZAM · The eligibility registry — a model that is not in it cannot be spoken of
 * Implemented by: PFOS Contract 12 / Phase 5.2 (spec 06-two-agent-vps)
 * Owning requirements: R18 (a selected model is in the registry; a `provisional` registry does
 *   not permit live routing)
 * Depends on: ../../features/benchmark/eligibility (contract 09's L-scale, type level only),
 *   ./turnClassifier (contract 10's model-bearing tiers, type level only). No I/O, no clock.
 *
 * §6.3 states two rules and one posture. The rules: "A model may be selected only if it is
 * present in `model_eligibility_registry.json`. Absent means ineligible; there is no implicit
 * default", and "A registry marked `provisional: true` must not permit live routing." The
 * posture: "The check is **fail-closed** … The absence of a 'provisional' flag is not treated as
 * 'not provisional'." This module is those two rules and that posture, in that order.
 *
 * ## Rule 1 — presence is a PRECONDITION of selection, not a check after it
 *
 * The obvious shape is `if (!registry.includes(modelId)) refuse(...)` somewhere in the router.
 * It was rejected for the reason §4.3 gives about runtime filters in general: it is code that can
 * be re-ordered, short-circuited, or forgotten at a new call site, and its failure mode is a paid
 * call to an unvetted model that looks like success.
 *
 * So {@link EligibleModel} is branded and {@link admitEligibilityRegistry} is its only mint — the
 * same device Phase 3.2 uses for `ServedSignalEnvelope` and Phase 5.1 uses for
 * `ModelInvocationGrant`. One {@link EligibleModel} is minted per registry entry and there is no
 * other constructor, no `from(modelId)`, and no widening export. A router whose result type is
 * {@link EligibleModel} therefore has no expression it could evaluate to name an unlisted model:
 * turning a `string` into an {@link EligibleModel} is a RESOLUTION against the admitted registry
 * ({@link AdmittedRegistry.resolve}), and a failed resolution yields nothing to return rather
 * than a value that needs checking. "Selected a model that was not in the registry" is not a case
 * the tests have to cover, because it is not a sentence this tier can write.
 *
 * A cast defeats any purely type-level brand, so the mint is also recorded in a module-private
 * {@link WeakSet} and {@link isAdmittedModel} answers from it. Note the direction state moves in:
 * the set can only ever REFUSE a model it did not mint. Nothing outside {@link mintEligibleModel}
 * adds to it, so its failure mode is a false negative that halts a call, never a false positive
 * that permits one.
 *
 * ## Rule 2 — a provisional registry cannot route, and the strongest form is a compile error
 *
 * {@link LiveEligibilityRegistry} intersects the document with `provisional: false` as a LITERAL,
 * so a document holding `provisional: true` is not assignable to the admitting function's
 * parameter at all. The refusal happens in the type checker, before the program exists.
 *
 * That matters because of what already lives one directory away. `mocks/fixtures.ts` types
 * `LoadedFixture.provisional` as the literal `true`, precisely because steering §3 ties a
 * fixture-backed run to a provisional registry. {@link provisionalRegistryFromFixture} makes the
 * tie mechanical in this direction too: it accepts anything carrying `provisional: true` — which
 * a `LoadedFixture` does, structurally — and its return type is
 * {@link ProvisionalEligibilityRegistry}, which {@link admitEligibilityRegistry} will not accept.
 * The only route from recorded fixtures to a registry therefore produces a document that cannot
 * reach the router. There is no `as` in that path and nothing to remember.
 *
 * A literal is only known statically. A registry read from disk at run time arrives as `unknown`,
 * so {@link parseEligibilityRegistry} is the runtime belt behind the type, and it is fail-closed
 * in all four of §6.3's senses: an absent registry, an unparseable one, one with no explicit
 * `provisional` field, and one marked provisional each refuse. Each refusal is its own code, so
 * an operator reads WHICH of the four happened — §6.3 calls a provisional registry "a gate item,
 * not worked around", and a gate item has to be legible to be recorded. Nothing here degrades to
 * a cheaper model, returns an empty registry, or continues with a warning.
 *
 * ## Where contract 09's L-scale meets contract 10's T-scale
 *
 * They are different axes and Phase 5.1 was careful not to mix them. Contract 09 grades a MODEL:
 * `L0` extraction, `L1` routine advice, `L2` high-impact decisions, and — its own words —
 * "Developer/build tasks based on code benchmark and repository tests, **separate from live
 * finance eligibility**." Contract 10 grades a TURN: `T1` low-risk extraction, `T2` routine
 * financial conversation, `T3` high-impact financial decision, `T4` repository engineering.
 *
 * {@link TIER_REQUIRED_ELIGIBILITY} is the whole of the join, and it is a total `Record` over
 * {@link ModelBearingTier} so a tier added to contract 10's taxonomy without a stated eligibility
 * requirement fails to compile rather than routing to an ungraded model. Two properties of it are
 * deliberate and neither is obvious:
 *
 *  - **The bands are NOT a ladder.** `L1` does not imply `L0`: `L0` is critical-field extraction
 *    accuracy, `L1` is schema validity plus evidence coverage, and `evaluateEligibility` computes
 *    them independently. So each tier names exactly ONE requirement rather than a minimum band.
 *    Treating them as nested would silently admit a model to extraction on the strength of an
 *    evidence-coverage score, which measures something else.
 *  - **`T4` does not take an L band at all**, because contract 09 says the developer/build
 *    judgement is separate from live finance eligibility. It takes `developerBuild`, which comes
 *    from the code benchmark and the repository tests rather than from the finance eval set.
 *    `developerBuild` is a REQUIRED field of an entry, so a registry that omits it is unparseable
 *    and refuses — an unstated developer verdict is not read as a passing one.
 *
 * Money: nothing here holds, parses, or computes a figure. Cost is contract 10's affair and
 * reaches this tier only through `modelPolicy`. `src/lib/money` is neither imported nor needed.
 * No host, path, key, or other deployment particular appears (R24) — the registry's location is
 * `OpenRouterPortConfig.eligibilityRegistryPathRef`, a reference to an environment entry, and the
 * text it resolves to is handed in by the caller.
 */
import type { ModelEligibility } from '../../features/benchmark/eligibility.ts';
import type { ModelBearingTier } from './turnClassifier.ts';

/**
 * Contract 09's finance eligibility bands. Derived from {@link ModelEligibility} rather than
 * restated, so the L-scale keeps one definition in this repository: renaming a level in contract
 * 09's aggregator breaks this line loudly instead of leaving two vocabularies to drift.
 */
export type EligibilityBands = ModelEligibility['levels'];

/** The band names, checked against the aggregator's own key set by the `satisfies` clause. */
export const ELIGIBILITY_BANDS = ['L0', 'L1', 'L2'] as const satisfies readonly (keyof EligibilityBands)[];
export type EligibilityBand = (typeof ELIGIBILITY_BANDS)[number];

/**
 * What a tier requires of a model. A discriminated union rather than an optional band, because
 * contract 09's developer/build judgement is a different axis from its finance bands and must not
 * be expressible as "band undefined".
 */
export type EligibilityRequirement =
  | { readonly kind: 'finance_band'; readonly band: EligibilityBand }
  | { readonly kind: 'developer_build' };

/**
 * The join between the two scales. Total over {@link ModelBearingTier}: a new tier without a
 * stated requirement does not compile. `T0` is absent because `T0` has no model to grade (R16).
 */
export const TIER_REQUIRED_ELIGIBILITY: Readonly<Record<ModelBearingTier, EligibilityRequirement>> = {
  // Contract 10 T1 "low-risk extraction" ↔ contract 09 "Tier L0 extraction".
  T1: { kind: 'finance_band', band: 'L0' },
  // Contract 10 T2 "routine financial conversation" ↔ contract 09 "Tier L1 routine advice".
  T2: { kind: 'finance_band', band: 'L1' },
  // Contract 10 T3 "high-impact financial decision" ↔ contract 09 "Tier L2 high-impact decisions".
  T3: { kind: 'finance_band', band: 'L2' },
  // Contract 10 T4 "repository engineering" ↔ contract 09's developer/build judgement, which it
  // states is separate from live finance eligibility. So no L band applies here, by contract.
  T4: { kind: 'developer_build' },
};

/** The document version this phase reads. A different version is refused, never coerced. */
export const ELIGIBILITY_REGISTRY_VERSION = 1;

/** One graded model, as the registry document records it. */
export interface EligibilityRegistryEntry {
  readonly modelId: string;
  /** Contract 09's finance bands for this model. */
  readonly bands: EligibilityBands;
  /** Contract 09's separate developer/build judgement. Required: an omission is not a pass. */
  readonly developerBuild: boolean;
  /** Contract 09's automatic-failure outcome. A disqualified model is eligible for nothing. */
  readonly disqualified: boolean;
}

/**
 * The registry document. `provisional` is a required `boolean` here rather than an optional one,
 * so the *document* type cannot describe a registry that simply omits the flag — §6.3's "the
 * absence of a 'provisional' flag is not treated as 'not provisional'" already holds for anything
 * typed, and {@link parseEligibilityRegistry} carries it for anything that is not.
 */
export interface EligibilityRegistryDocument {
  readonly registryVersion: typeof ELIGIBILITY_REGISTRY_VERSION;
  readonly provisional: boolean;
  readonly entries: readonly EligibilityRegistryEntry[];
}

/**
 * A registry that statically declares itself live-measured. The `false` is a LITERAL, so a
 * document holding `provisional: true` — or one whose flag is merely `boolean` and therefore not
 * known to be `false` — is not assignable here. This is R18's stronger half: a compile error
 * rather than a runtime refusal.
 */
export type LiveEligibilityRegistry = EligibilityRegistryDocument & { readonly provisional: false };

/**
 * A registry produced without live measurement (steering §3). `provisional` is the literal
 * `true`, so this type is precisely what {@link LiveEligibilityRegistry} excludes.
 */
export type ProvisionalEligibilityRegistry = EligibilityRegistryDocument & { readonly provisional: true };

/** Why a registry was refused. A caller discriminates on `code`, never on a message. */
export const ELIGIBILITY_REGISTRY_ERROR_CODES = [
  'ELIGIBILITY_REGISTRY_ABSENT',
  'ELIGIBILITY_REGISTRY_UNPARSEABLE',
  'ELIGIBILITY_REGISTRY_VERSION_UNSUPPORTED',
  'ELIGIBILITY_REGISTRY_PROVISIONAL_FLAG_ABSENT',
  'ELIGIBILITY_REGISTRY_PROVISIONAL',
  'ELIGIBILITY_REGISTRY_ENTRY_INVALID',
  'ELIGIBILITY_REGISTRY_DUPLICATE_ENTRY',
  'ELIGIBILITY_REGISTRY_EMPTY',
] as const;
export type EligibilityRegistryErrorCode = (typeof ELIGIBILITY_REGISTRY_ERROR_CODES)[number];

/**
 * A refused registry.
 *
 * `detail` holds field paths and enum values only. There is no field for the registry text, for a
 * model's metrics, or for a figure — an error travelling through a log carries where the fault is
 * and never what the document said (§6.4).
 */
export class EligibilityRegistryError extends Error {
  readonly code: EligibilityRegistryErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: EligibilityRegistryErrorCode, message: string, detail: Record<string, string> = {}) {
    super(message);
    this.name = 'EligibilityRegistryError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

declare const ELIGIBLE_MODEL_BRAND: unique symbol;

/**
 * A model that is present in an admitted, non-provisional registry, carrying the grades that
 * registry gave it. {@link admitEligibilityRegistry} is the only mint. There is no constructor
 * taking a bare model id, so this type cannot be produced from a name somebody wrote down.
 */
export interface EligibleModel {
  readonly [ELIGIBLE_MODEL_BRAND]: 'minted from an entry in an admitted, non-provisional eligibility registry';
  readonly modelId: string;
  readonly bands: EligibilityBands;
  readonly developerBuild: boolean;
}

/**
 * Models this module actually minted. A `WeakSet`, so an eligible model is collectable with the
 * admitted registry it came from. It can only ever refuse: nothing outside
 * {@link mintEligibleModel} adds to it, so a forged model is rejected while a genuine one is
 * never invented.
 */
const admittedModels = new WeakSet<EligibleModel>();

/** True only for a model this module minted. The runtime half of the capability (§6.3, R18). */
export function isAdmittedModel(candidate: EligibleModel): boolean {
  return admittedModels.has(candidate);
}

function mintEligibleModel(entry: EligibilityRegistryEntry): EligibleModel {
  const model = Object.freeze({
    modelId: entry.modelId,
    bands: Object.freeze({ ...entry.bands }),
    developerBuild: entry.developerBuild,
  }) as unknown as EligibleModel;
  admittedModels.add(model);
  return model;
}

/** Does one model's grades satisfy one requirement? The only place the two scales are compared. */
export function satisfiesRequirement(model: EligibleModel, requirement: EligibilityRequirement): boolean {
  return requirement.kind === 'developer_build' ? model.developerBuild : model.bands[requirement.band];
}

/**
 * An admitted registry. The entries are captured in the closure and are not reachable from the
 * returned object as plain data, so a caller cannot retrieve an entry and build its own
 * {@link EligibleModel} from it.
 */
export interface AdmittedRegistry {
  /**
   * Turn a model id into an {@link EligibleModel}, or `null` when the registry does not list it.
   * This is the ONLY way to obtain an eligible model, which is what makes presence a precondition
   * of selection rather than a check performed after one (§6.3, R18).
   */
  resolve(modelId: string): EligibleModel | null;
  /** Every model the registry lists, graded or not. Order follows the document. */
  readonly modelIds: readonly string[];
  /** The models whose grades satisfy what a tier requires (contract 09 × contract 10). */
  eligibleAt(tier: ModelBearingTier): readonly EligibleModel[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidEntry(at: string, what: string): never {
  throw new EligibilityRegistryError(
    'ELIGIBILITY_REGISTRY_ENTRY_INVALID',
    `NIZAM eligibility registry: ${at} ${what}. A registry that cannot be read is refused, never partially trusted (§6.3).`,
    { at },
  );
}

function readBands(at: string, raw: unknown): EligibilityBands {
  if (!isRecord(raw)) invalidEntry(at, 'must be an object holding one boolean per band');
  const bands: Record<string, boolean> = {};
  for (const band of ELIGIBILITY_BANDS) {
    const value = raw[band];
    // Fail closed per band, for the same reason §6.3 fails closed on the registry as a whole: an
    // absent grade is an ungraded model, and an ungraded model is not a passing one.
    if (typeof value !== 'boolean') invalidEntry(`${at}.${band}`, 'must be an explicit boolean');
    bands[band] = value;
  }
  for (const key of Object.keys(raw)) {
    if (!(ELIGIBILITY_BANDS as readonly string[]).includes(key)) {
      invalidEntry(`${at}.${key}`, 'is not one of contract 09 band names');
    }
  }
  return bands as unknown as EligibilityBands;
}

function readEntry(index: number, raw: unknown): EligibilityRegistryEntry {
  const at = `entries[${index}]`;
  if (!isRecord(raw)) invalidEntry(at, 'must be an object');
  const modelId = raw.modelId;
  if (typeof modelId !== 'string' || modelId.length === 0) invalidEntry(`${at}.modelId`, 'must be a non-empty string');
  if (typeof raw.developerBuild !== 'boolean') {
    invalidEntry(
      `${at}.developerBuild`,
      "must be an explicit boolean, because contract 09 keeps the developer/build judgement separate from live finance eligibility and an unstated verdict is not a passing one",
    );
  }
  if (typeof raw.disqualified !== 'boolean') invalidEntry(`${at}.disqualified`, 'must be an explicit boolean');
  return {
    modelId,
    bands: readBands(`${at}.bands`, raw.bands),
    developerBuild: raw.developerBuild,
    disqualified: raw.disqualified,
  };
}

/**
 * **The runtime belt behind the type.** Parse a registry that arrived as `unknown` — the shape a
 * registry read from disk at run time has, where the `provisional` literal is not known
 * statically — and return it as a {@link LiveEligibilityRegistry} only if every fail-closed
 * condition of §6.3 holds.
 *
 * All four of §6.3's refusals are distinct codes on purpose: a provisional registry "is recorded
 * in the gate register as a blocked item, not worked around", and an operator has to be able to
 * tell which of the four situations they are in before they can record it. Nothing here returns a
 * partially trusted registry, and nothing degrades to a cheaper model.
 *
 * @param raw The already-parsed document. This module performs no I/O and resolves no path; the
 *   caller reads the file named by `OpenRouterPortConfig.eligibilityRegistryPathRef`.
 */
export function parseEligibilityRegistry(raw: unknown): LiveEligibilityRegistry {
  if (raw === null || raw === undefined) {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_ABSENT',
      'NIZAM eligibility registry: no registry was supplied, and absence means ineligible — there is no implicit default (§6.3, R18)',
    );
  }
  if (!isRecord(raw)) {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_UNPARSEABLE',
      'NIZAM eligibility registry: the registry is not an object, so it cannot be read and routing is refused (§6.3, R18)',
    );
  }
  if (raw.registryVersion !== ELIGIBILITY_REGISTRY_VERSION) {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_VERSION_UNSUPPORTED',
      `NIZAM eligibility registry: the document declares version ${String(raw.registryVersion)}; this phase reads ${ELIGIBILITY_REGISTRY_VERSION}, and a version it cannot read is refused rather than assumed compatible`,
      { at: 'registryVersion' },
    );
  }
  if (!Object.prototype.hasOwnProperty.call(raw, 'provisional') || typeof raw.provisional !== 'boolean') {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_PROVISIONAL_FLAG_ABSENT',
      'NIZAM eligibility registry: the document carries no explicit boolean "provisional" field. §6.3 is explicit that the absence of the flag is NOT treated as "not provisional", so routing is refused.',
      { at: 'provisional' },
    );
  }
  if (raw.provisional !== false) {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_PROVISIONAL',
      'NIZAM eligibility registry: the registry is marked provisional, so it is a scaffold rather than evidence and may not promote any model for live routing. Record it in the gate register; it is not worked around (§6.3, R18).',
      { at: 'provisional' },
    );
  }
  const rawEntries = raw.entries;
  if (!Array.isArray(rawEntries)) invalidEntry('entries', 'must be an array');
  const entries = rawEntries.map((entry: unknown, index: number) => readEntry(index, entry));
  return { registryVersion: ELIGIBILITY_REGISTRY_VERSION, provisional: false, entries };
}

/**
 * The same parse, from the registry's on-disk text. `null` means the file was not found, which is
 * §6.3's "missing registry" and refuses. Unparseable JSON refuses as itself rather than as a
 * shape error, so the failure text names the real fault.
 *
 * There is no filesystem access here either: the caller reads the text.
 */
export function parseEligibilityRegistryText(text: string | null): LiveEligibilityRegistry {
  if (text === null) {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_ABSENT',
      'NIZAM eligibility registry: the registry named by the injected reference was not found, and a missing registry refuses routing (§6.3, R18)',
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_UNPARSEABLE',
      'NIZAM eligibility registry: the registry text is not parseable, and an unparseable registry refuses routing (§6.3, R18)',
    );
  }
  return parseEligibilityRegistry(document);
}

/**
 * **The one mint.** Admit a registry that is statically known to be live-measured, and produce the
 * lookup that is the only source of an {@link EligibleModel}.
 *
 * The parameter type is {@link LiveEligibilityRegistry}, so a provisional document does not
 * compile here. The runtime belt repeats the check anyway, because a cast defeats the type and
 * because a registry that came through {@link parseEligibilityRegistry} at run time was `unknown`
 * a moment ago.
 *
 * An empty registry is REFUSED rather than admitted. A registry listing nothing is
 * indistinguishable from an absent one as far as routing goes, and admitting it would let an
 * operator believe routing is enabled when no model can be selected — which is exactly the silent
 * outcome §6.3 wants replaced by an explicit refusal.
 */
export function admitEligibilityRegistry(registry: LiveEligibilityRegistry): AdmittedRegistry {
  // Validated as `unknown`, because the interesting case is the one where the type was defeated by
  // a cast. Re-deriving from the untyped value is what makes the belt independent of the type.
  const raw: unknown = registry;
  if (!isRecord(raw)) {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_UNPARSEABLE',
      'NIZAM eligibility registry: the value offered for admission is not a registry document',
    );
  }
  if (raw.registryVersion !== ELIGIBILITY_REGISTRY_VERSION) {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_VERSION_UNSUPPORTED',
      `NIZAM eligibility registry: cannot admit version ${String(raw.registryVersion)}; this phase reads ${ELIGIBILITY_REGISTRY_VERSION}`,
      { at: 'registryVersion' },
    );
  }
  if (!Object.prototype.hasOwnProperty.call(raw, 'provisional') || typeof raw.provisional !== 'boolean') {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_PROVISIONAL_FLAG_ABSENT',
      'NIZAM eligibility registry: the document offered for admission carries no explicit boolean "provisional" field, and its absence is not read as "not provisional" (§6.3, R18)',
      { at: 'provisional' },
    );
  }
  // The runtime half of rule 2. Reached only by a cast, which is precisely why it is here.
  if (raw.provisional !== false) {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_PROVISIONAL',
      'NIZAM eligibility registry: a provisional registry may not be admitted for live routing. It is a scaffold produced without live measurement (steering §3), and §6.3 records it as a gate item rather than working around it.',
      { at: 'provisional' },
    );
  }
  const rawEntries = raw.entries;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new EligibilityRegistryError(
      'ELIGIBILITY_REGISTRY_EMPTY',
      'NIZAM eligibility registry: the registry lists no model. That is indistinguishable from an absent registry for routing, so it is refused rather than admitted as an enabled-but-empty one (§6.3, R18).',
      { at: 'entries' },
    );
  }

  const byModelId = new Map<string, EligibleModel>();
  const minted: EligibleModel[] = [];
  const modelIds: string[] = [];
  for (let index = 0; index < rawEntries.length; index += 1) {
    const checked = readEntry(index, rawEntries[index]);
    if (byModelId.has(checked.modelId)) {
      throw new EligibilityRegistryError(
        'ELIGIBILITY_REGISTRY_DUPLICATE_ENTRY',
        `NIZAM eligibility registry: entries[${index}] repeats a model already graded in this registry. Two grades for one model is an ambiguous registry, and an ambiguous grade is refused rather than resolved by position.`,
        { at: `entries[${index}].modelId` },
      );
    }
    // A disqualified model is listed but graded for nothing, so contract 09's automatic-failure
    // outcome survives into routing without a second place to record it.
    const graded: EligibilityRegistryEntry = checked.disqualified
      ? { ...checked, bands: { L0: false, L1: false, L2: false }, developerBuild: false }
      : checked;
    const model = mintEligibleModel(graded);
    byModelId.set(checked.modelId, model);
    minted.push(model);
    modelIds.push(checked.modelId);
  }

  const frozenIds: readonly string[] = Object.freeze([...modelIds]);
  const frozenModels: readonly EligibleModel[] = Object.freeze([...minted]);
  return Object.freeze({
    resolve(modelId: string): EligibleModel | null {
      return byModelId.get(modelId) ?? null;
    },
    modelIds: frozenIds,
    eligibleAt(tier: ModelBearingTier): readonly EligibleModel[] {
      const requirement = TIER_REQUIRED_ELIGIBILITY[tier];
      return Object.freeze(frozenModels.filter((model) => satisfiesRequirement(model, requirement)));
    },
  });
}

/**
 * Build a registry from a fixture-backed run.
 *
 * This is the mechanical form of steering §3's rule. The parameter accepts anything carrying
 * `provisional: true` — which `mocks/fixtures.ts` gives `LoadedFixture` as a literal type, for
 * exactly this reason — and the return type is {@link ProvisionalEligibilityRegistry}, which
 * {@link admitEligibilityRegistry} does not accept. So the only path from recorded fixtures to a
 * registry ends in a document the router cannot be handed, with no cast anywhere along it and
 * nothing for an author to remember.
 *
 * Phase 6.2 emits this document; Phase 6.3 replaces it with a live-measured one if the dev key is
 * present and within its cap. Until then the gate register carries it (§6.3, §9).
 */
export function provisionalRegistryFromFixture(
  fixtureBacked: { readonly provisional: true },
  entries: readonly EligibilityRegistryEntry[],
): ProvisionalEligibilityRegistry {
  return {
    registryVersion: ELIGIBILITY_REGISTRY_VERSION,
    provisional: fixtureBacked.provisional,
    entries,
  };
}
