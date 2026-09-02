/**
 * NIZAM · Canonical UPOI objective registry and fail-closed validator.
 * Owning contract: PFOS Contract 12; UPOI requirements 1.1, 1.3 and design Section 10.1.
 * Phase: Phase 1.2 — UPOI Task 1.2, ordered twenty-objective registry.
 *
 * The frozen registry below is the only objective list. Consumers must validate an
 * untrusted representation with validateObjectiveRegistry before rendering or evaluating it;
 * no consumer may maintain a parallel dashboard list.
 */

export interface UpoiObjective {
  readonly id: number;
  readonly slug: string;
  readonly question: string;
}

export type ValidatedObjectiveRegistry = readonly UpoiObjective[];

/** The exact failure reasons exposed by the fail-closed validator. */
export const OBJECTIVE_REGISTRY_VALIDATION_CODES = [
  'registry_not_an_array',
  'registry_wrong_length',
  'objective_not_an_object',
  'objective_keys_invalid',
  'objective_id_invalid',
  'objective_id_out_of_order',
  'objective_id_duplicate',
  'objective_slug_invalid',
  'objective_slug_duplicate',
  'objective_question_invalid',
  'objective_question_mismatch',
] as const;

export type ObjectiveRegistryValidationCode = (typeof OBJECTIVE_REGISTRY_VALIDATION_CODES)[number];

export class ObjectiveRegistryValidationError extends Error {
  readonly code: ObjectiveRegistryValidationCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: ObjectiveRegistryValidationCode, message: string, detail: Record<string, string> = {}) {
    super(message);
    this.name = 'ObjectiveRegistryValidationError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

const OBJECTIVE_KEYS = ['id', 'slug', 'question'] as const;
const OBJECTIVE_COUNT = 20;

/**
 * The canonical ordered source of truth. Slugs and questions are copied verbatim from design
 * Section 10.1. Each object and the containing array are frozen so runtime callers cannot turn
 * a validated registry into a reordered or reworded dashboard universe.
 */
export const UPOI_OBJECTIVES: ValidatedObjectiveRegistry = Object.freeze([
  Object.freeze({ id: 1, slug: 'build-persistent-personal-operating-intelligence', question: 'Does NIZAM operate continuously autonomously?' }),
  Object.freeze({ id: 2, slug: 'maintain-continuous-agent-memory', question: 'Does NIZAM remember relevant history?' }),
  Object.freeze({ id: 3, slug: 'transform-thoughts-into-intelligence', question: 'Are thoughts becoming useful intelligence?' }),
  Object.freeze({ id: 4, slug: 'turn-goals-into-execution', question: 'Are goals becoming completed actions?' }),
  Object.freeze({ id: 5, slug: 'prioritize-recovery-under-constraints', question: 'Does NIZAM protect depleted capacity?' }),
  Object.freeze({ id: 6, slug: 'improve-decision-quality', question: 'Are my decisions becoming better?' }),
  Object.freeze({ id: 7, slug: 'challenge-assumptions-before-action', question: 'Are weak assumptions challenged early?' }),
  Object.freeze({ id: 8, slug: 'convert-problems-into-plans', question: 'Do problems produce executable plans?' }),
  Object.freeze({ id: 9, slug: 'track-decisions-and-learning', question: 'Does NIZAM learn from outcomes?' }),
  Object.freeze({ id: 10, slug: 'operate-mal-pfos-financial-intelligence', question: 'Is MAL improving financial outcomes?' }),
  Object.freeze({ id: 11, slug: 'optimize-health-and-energy', question: 'Is NIZAM improving daily capacity?' }),
  Object.freeze({ id: 12, slug: 'detect-behavioral-and-psyche-patterns', question: 'Does NIZAM understand my patterns?' }),
  Object.freeze({ id: 13, slug: 'reduce-impulsive-decisions', question: 'Are harmful impulses increasingly interrupted?' }),
  Object.freeze({ id: 14, slug: 'maintain-faith-and-values-alignment', question: 'Are actions aligned with values?' }),
  Object.freeze({ id: 15, slug: 'increase-professional-leverage', question: 'Is professional leverage measurably increasing?' }),
  Object.freeze({ id: 16, slug: 'automate-life-administration', question: 'Is manual administration consistently decreasing?' }),
  Object.freeze({ id: 17, slug: 'coordinate-specialized-agent-personas', question: 'Do agents collaborate without confusion?' }),
  Object.freeze({ id: 18, slug: 'anticipate-risks-and-opportunities', question: 'Does NIZAM act before problems?' }),
  Object.freeze({ id: 19, slug: 'continuously-improve-agent-intelligence', question: 'Is NIZAM improving through usage?' }),
  Object.freeze({ id: 20, slug: 'compound-personal-autonomy', question: 'Am I becoming more autonomous?' }),
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuse(
  code: ObjectiveRegistryValidationCode,
  message: string,
  detail: Record<string, string> = {},
): never {
  throw new ObjectiveRegistryValidationError(code, `NIZAM objective registry refused: ${message}`, detail);
}

function normalizedQuestionWords(question: string): readonly string[] {
  return question.replace(/\p{P}/gu, '').trim().split(/\s+/u).filter((word) => word.length > 0);
}

function assertExactKeys(candidate: Record<string, unknown>, at: string): void {
  const actual = Object.keys(candidate).sort();
  const expected = [...OBJECTIVE_KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    refuse('objective_keys_invalid', `${at} must contain exactly id, slug, and question`, { at });
  }
}

function assertObjective(candidate: unknown, index: number, seenSlugs: Set<string>): UpoiObjective {
  const at = `objectives[${index}]`;
  if (!isRecord(candidate)) refuse('objective_not_an_object', `${at} must be an object`, { at });
  assertExactKeys(candidate, at);

  const expected = UPOI_OBJECTIVES[index];
  if (expected === undefined) refuse('objective_id_out_of_order', `${at} has no canonical position`, { at });

  if (typeof candidate.id !== 'number' || !Number.isInteger(candidate.id)) {
    refuse('objective_id_invalid', `${at}.id must be an integer`, { at: `${at}.id` });
  }
  if (candidate.id !== index + 1) {
    const code = candidate.id >= 1 && candidate.id <= OBJECTIVE_COUNT ? 'objective_id_out_of_order' : 'objective_id_invalid';
    refuse(code, `${at}.id must be ${index + 1}`, { at: `${at}.id` });
  }
  if (candidate.id !== expected.id) {
    refuse('objective_id_duplicate', `${at}.id does not match the canonical ordered registry`, { at: `${at}.id` });
  }

  if (typeof candidate.slug !== 'string' || candidate.slug.length === 0) {
    refuse('objective_slug_invalid', `${at}.slug must be a non-empty string`, { at: `${at}.slug` });
  }
  if (seenSlugs.has(candidate.slug)) {
    refuse('objective_slug_duplicate', `${at}.slug is duplicated`, { at: `${at}.slug` });
  }
  seenSlugs.add(candidate.slug);
  if (candidate.slug !== expected.slug) {
    refuse('objective_slug_invalid', `${at}.slug does not match the canonical supplied slug`, { at: `${at}.slug` });
  }

  if (typeof candidate.question !== 'string') {
    refuse('objective_question_invalid', `${at}.question must be a string`, { at: `${at}.question` });
  }
  if (normalizedQuestionWords(candidate.question).length !== 5) {
    refuse('objective_question_invalid', `${at}.question must normalize to exactly five words`, { at: `${at}.question` });
  }
  if (candidate.question !== expected.question) {
    refuse('objective_question_mismatch', `${at}.question does not match the canonical supplied question`, { at: `${at}.question` });
  }

  return Object.freeze({ id: candidate.id, slug: candidate.slug, question: candidate.question });
}
/**
 * Validate and freeze a registry supplied by a parser, dashboard, or fixture.
 *
 * Validation is deliberately exact rather than permissive: a missing, extra, reordered,
 * duplicated, or reworded entry is refused and no partial registry is returned. The returned
 * objects are rebuilt field-by-field, so surplus prototype state or caller mutation cannot enter
 * the read model.
 */
export function validateObjectiveRegistry(candidate: unknown): ValidatedObjectiveRegistry {
  if (!Array.isArray(candidate)) {
    refuse('registry_not_an_array', 'the registry must be an array');
  }
  if (candidate.length !== OBJECTIVE_COUNT) {
    refuse('registry_wrong_length', `the registry must contain exactly ${OBJECTIVE_COUNT} entries`, {
      expected: String(OBJECTIVE_COUNT),
      actual: String(candidate.length),
    });
  }

  const seenIds = new Set<number>();
  const seenSlugs = new Set<string>();
  const validated = candidate.map((entry: unknown, index: number) => {
    if (isRecord(entry) && typeof entry.id === 'number' && seenIds.has(entry.id)) {
      refuse('objective_id_duplicate', `objectives[${index}].id is duplicated`, { at: `objectives[${index}].id` });
    }
    if (isRecord(entry) && typeof entry.id === 'number') seenIds.add(entry.id);
    return assertObjective(entry, index, seenSlugs);
  });

  return Object.freeze(validated);
}

/** Normalize one canonical question for consumers that need the mechanical word count. */
export function countNormalizedQuestionWords(question: string): number {
  return normalizedQuestionWords(question).length;
}
