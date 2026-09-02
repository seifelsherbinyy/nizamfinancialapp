// @vitest-environment node
/**
 * NIZAM · Canonical UPOI objective registry tests.
 * Owning contract: PFOS Contract 12; UPOI requirements 1.1, 1.3 and design Section 10.1.
 * Phase: Phase 1.2 — UPOI Task 1.2, ordered twenty-objective registry.
 */
import { describe, expect, it } from 'vitest';

import {
  countNormalizedQuestionWords,
  ObjectiveRegistryValidationError,
  UPOI_OBJECTIVES,
  validateObjectiveRegistry,
} from './objectiveRegistry.ts';

function copyRegistry(): Array<{ id: number; slug: string; question: string }> {
  return UPOI_OBJECTIVES.map((objective) => ({ ...objective }));
}

function codeOf(candidate: unknown): string {
  try {
    validateObjectiveRegistry(candidate);
  } catch (error) {
    expect(error).toBeInstanceOf(ObjectiveRegistryValidationError);
    return (error as ObjectiveRegistryValidationError).code;
  }
  throw new Error('expected the objective registry to refuse, but it did not');
}

describe('the canonical registry', () => {
  it('contains exactly twenty ordered immutable entries copied from the design', () => {
    expect(UPOI_OBJECTIVES).toHaveLength(20);
    expect(UPOI_OBJECTIVES.map(({ id }) => id)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(UPOI_OBJECTIVES[0]).toEqual({
      id: 1,
      slug: 'build-persistent-personal-operating-intelligence',
      question: 'Does NIZAM operate continuously autonomously?',
    });
    expect(UPOI_OBJECTIVES[19]).toEqual({
      id: 20,
      slug: 'compound-personal-autonomy',
      question: 'Am I becoming more autonomous?',
    });
    expect(Object.isFrozen(UPOI_OBJECTIVES)).toBe(true);
    expect(Object.isFrozen(UPOI_OBJECTIVES[0])).toBe(true);
  });

  it('has exactly five normalized words in every supplied question', () => {
    for (const objective of UPOI_OBJECTIVES) {
      expect(countNormalizedQuestionWords(objective.question)).toBe(5);
    }
  });

  it('returns one rebuilt frozen registry for a valid supplied representation', () => {
    const validated = validateObjectiveRegistry(copyRegistry());
    expect(validated).toEqual(UPOI_OBJECTIVES);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated[0])).toBe(true);
    expect(validated).not.toBe(UPOI_OBJECTIVES);
  });
});

describe('the validator fails closed on registry shape and ordering', () => {
  it('refuses non-arrays and any count other than twenty', () => {
    expect(codeOf(null)).toBe('registry_not_an_array');
    expect(codeOf([])).toBe('registry_wrong_length');
    expect(codeOf(copyRegistry().slice(0, 19))).toBe('registry_wrong_length');
    expect(codeOf([...copyRegistry(), { id: 21, slug: 'extra', question: 'Extra entry is not accepted' }])).toBe(
      'registry_wrong_length',
    );
  });

  it('refuses missing or extra fields instead of partially trusting an entry', () => {
    const missing = copyRegistry();
    const { question: _question, ...withoutQuestion } = missing[0]!;
    missing[0] = withoutQuestion as (typeof missing)[number];
    expect(codeOf(missing)).toBe('objective_keys_invalid');

    const extra = copyRegistry() as Array<Record<string, unknown>>;
    extra[0]!.displayName = 'not part of the canonical registry';
    expect(codeOf(extra)).toBe('objective_keys_invalid');
  });

  it('refuses reordered, duplicate, and out-of-range identifiers', () => {
    const reordered = copyRegistry();
    [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
    expect(codeOf(reordered)).toBe('objective_id_out_of_order');

    const duplicate = copyRegistry();
    duplicate[1] = { ...duplicate[1]!, id: 1 };
    expect(codeOf(duplicate)).toBe('objective_id_duplicate');

    const outOfRange = copyRegistry();
    outOfRange[19] = { ...outOfRange[19]!, id: 21 };
    expect(codeOf(outOfRange)).toBe('objective_id_invalid');
  });

  it('refuses duplicate or changed slugs and any reworded question', () => {
    const duplicateSlug = copyRegistry();
    duplicateSlug[1] = { ...duplicateSlug[1]!, slug: duplicateSlug[0]!.slug };
    expect(codeOf(duplicateSlug)).toBe('objective_slug_duplicate');

    const changedSlug = copyRegistry();
    changedSlug[0] = { ...changedSlug[0]!, slug: 'changed-slug' };
    expect(codeOf(changedSlug)).toBe('objective_slug_invalid');

    const reworded = copyRegistry();
    reworded[0] = { ...reworded[0]!, question: 'Does NIZAM operate forever autonomously?' };
    expect(codeOf(reworded)).toBe('objective_question_mismatch');
  });

  it('refuses malformed entries and questions that normalize to a non-five-word count', () => {
    const malformedId = copyRegistry();
    malformedId[0] = { ...malformedId[0]!, id: '1' as unknown as number };
    expect(codeOf(malformedId)).toBe('objective_id_invalid');

    const malformedQuestion = copyRegistry();
    malformedQuestion[0] = { ...malformedQuestion[0]!, question: null as unknown as string };
    expect(codeOf(malformedQuestion)).toBe('objective_question_invalid');

    const fourWords = copyRegistry();
    fourWords[0] = { ...fourWords[0]!, question: 'Does NIZAM operate autonomously?' };
    expect(codeOf(fourWords)).toBe('objective_question_invalid');

    const sixWords = copyRegistry();
    sixWords[0] = { ...sixWords[0]!, question: 'Does NIZAM operate continuously and autonomously?' };
    expect(codeOf(sixWords)).toBe('objective_question_invalid');
  });

  it('does not return a partial registry after any refusal', () => {
    const malformed = copyRegistry();
    malformed[7] = { ...malformed[7]!, question: 'not a valid objective question' };
    expect(() => validateObjectiveRegistry(malformed)).toThrow(ObjectiveRegistryValidationError);
    expect(UPOI_OBJECTIVES).toHaveLength(20);
    expect(UPOI_OBJECTIVES[7]!.question).toBe('Do problems produce executable plans?');
  });
});
