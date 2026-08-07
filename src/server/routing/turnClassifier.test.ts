// @vitest-environment node
/**
 * NIZAM · The rules, the vocabulary, and the shape a T0 turn cannot have
 * Implemented by: PFOS Contract 12 / Phase 5.1 (spec 06-two-agent-vps)
 * Owning requirements: R16 (a turn classified `T0` invokes no model)
 * Depends on: ./turnClassifier, ../../features/routing/modelPolicy
 *
 * Three things are asserted here, and the empirical half of R16 lives next door in
 * `t0NoModel.test.ts` because an absence needs a recorder to be observable.
 *
 *  1. **The taxonomy is contract 10's, not a second one.** The tier union, the roster, and the
 *     empty T0 roster are read out of `modelPolicy`, so a drift between the classifier and the
 *     policy is a failure here rather than a surprise at routing time.
 *  2. **Every rule fires for the reason it claims**, and the ORDER is part of the contract: a
 *     deterministic intent outranks every escalation signal, and a high-impact trigger outranks the
 *     task-shape rules, because contract 10's exit criteria say no T3 decision may bypass review.
 *  3. **A T0 classification has no capability**, which is the type-level half of §6.1. The
 *     `@ts-expect-error` cases are checked by `tsc` rather than by the runner: each fails the
 *     typecheck if the forbidden shape ever becomes expressible.
 *
 * No figure appears in any fixture below, because {@link TurnFacts} has no numeric field to put one
 * in (§6, R24). Every fact is a verdict the deterministic engines would supply.
 */
import { describe, expect, it } from 'vitest';

import { TIER_CAPABLE, type Tier } from '../../features/routing/modelPolicy';
import {
  capableModelsAt,
  CLASSIFICATION_RULES,
  classifyTurn,
  DETERMINISTIC_TIER,
  INTENT_FAMILY,
  isMintedGrant,
  isModelBearing,
  TURN_INTENTS,
  type ClassificationRule,
  type DeterministicTurnClassification,
  type ModelInvocationGrant,
  type TurnFacts,
  type TurnIntent,
} from './turnClassifier';

/** Every verdict benign: a turn with nothing remarkable about it. */
export const BENIGN_FACTS: TurnFacts = Object.freeze({
  intent: 'periodic_briefing',
  reversibility: 'reversible',
  dataFreshness: 'fresh',
  missingInformation: false,
  toolRequirement: false,
  securitySensitive: false,
  amountOverOwnerThreshold: false,
  exceedsSafeToSpendAllowance: false,
  materialShareOfLiquidNetWorth: false,
  criticalObligationImpact: false,
  newDebt: false,
  assetSale: false,
  majorIncomeChange: false,
  longHorizonDecision: false,
  forecastShortfallLikely: false,
  evidenceConflicts: false,
  lowConfidence: false,
});

/** Benign facts with a different intent and any explicitly named overrides. */
export function factsWith(intent: TurnIntent, overrides: Partial<TurnFacts> = {}): TurnFacts {
  return { ...BENIGN_FACTS, ...overrides, intent };
}

const DETERMINISTIC_INTENTS: readonly TurnIntent[] = TURN_INTENTS.filter(
  (intent) => INTENT_FAMILY[intent] === 'deterministic',
);

// =============================================================================================
// 1 — the taxonomy has one definition, and it is contract 10's
// =============================================================================================

describe('the tier taxonomy is contract 10 owned and reused, never restated', () => {
  it('reads the roster out of modelPolicy rather than keeping a second one', () => {
    const tiers: readonly Tier[] = ['T0', 'T1', 'T2', 'T3', 'T4'];
    for (const tier of tiers) expect(capableModelsAt(tier)).toBe(TIER_CAPABLE[tier]);
  });

  it('has an EMPTY capable roster at the deterministic tier (contract 10: "Route: code only")', () => {
    // The second, independent statement of R16: even a caller that somehow held a grant would find
    // no model the roster deems capable at T0. Neither this nor the missing grant is sufficient
    // alone; together they leave no route.
    expect(capableModelsAt(DETERMINISTIC_TIER)).toEqual([]);
    expect(DETERMINISTIC_TIER).toBe('T0');
  });

  it('places every intent in exactly one family, so none falls through to the default', () => {
    expect(TURN_INTENTS.length).toBe(new Set(TURN_INTENTS).size);
    for (const intent of TURN_INTENTS) expect(INTENT_FAMILY[intent]).toBeTypeOf('string');
    expect(DETERMINISTIC_INTENTS.length).toBe(6);
  });
});

// =============================================================================================
// 2 — every rule fires for its own reason, in the order the contract implies
// =============================================================================================

/** Classify and return the tier and rule, so a case reads as one line. */
function verdictOf(facts: TurnFacts): { tier: Tier; rule: ClassificationRule } {
  const classification = classifyTurn(facts, 'turn-ref-under-test');
  return { tier: classification.tier, rule: classification.rule };
}

describe('a deterministic intent is T0, and nothing can escalate it (§6.1, contract 10 T0)', () => {
  it('classifies each of contract 10\u2019s six deterministic examples as T0', () => {
    for (const intent of DETERMINISTIC_INTENTS) {
      expect(verdictOf(factsWith(intent))).toEqual({ tier: 'T0', rule: 'deterministic_intent' });
    }
  });

  it('stays T0 with every high-impact verdict set, because a model cannot supply a missing fact', () => {
    for (const intent of DETERMINISTIC_INTENTS) {
      const hostile = factsWith(intent, {
        newDebt: true,
        criticalObligationImpact: true,
        amountOverOwnerThreshold: true,
        assetSale: true,
        majorIncomeChange: true,
        longHorizonDecision: true,
        forecastShortfallLikely: true,
        evidenceConflicts: true,
        lowConfidence: true,
        missingInformation: true,
        securitySensitive: true,
        reversibility: 'irreversible',
        dataFreshness: 'unknown',
        materialShareOfLiquidNetWorth: true,
        exceedsSafeToSpendAllowance: true,
        toolRequirement: true,
      });
      expect(verdictOf(hostile)).toEqual({ tier: 'T0', rule: 'deterministic_intent' });
    }
  });
});

describe('the high-impact rules each reach T3 on their own (contract 10 high_impact_rules)', () => {
  const cases: readonly (readonly [ClassificationRule, Partial<TurnFacts>])[] = [
    ['new_debt', { newDebt: true }],
    ['critical_obligation_impact', { criticalObligationImpact: true }],
    ['amount_over_owner_threshold', { amountOverOwnerThreshold: true }],
    ['asset_sale', { assetSale: true }],
    ['major_income_change', { majorIncomeChange: true }],
    ['long_horizon_decision', { longHorizonDecision: true }],
    ['forecast_shortfall_likely', { forecastShortfallLikely: true }],
    ['conflicting_evidence_or_low_confidence', { evidenceConflicts: true }],
    ['conflicting_evidence_or_low_confidence', { lowConfidence: true }],
    ['irreversible_and_material', { reversibility: 'irreversible', materialShareOfLiquidNetWorth: true }],
    ['irreversible_and_material', { reversibility: 'irreversible', exceedsSafeToSpendAllowance: true }],
  ];

  it('fires one rule per trigger, and names the trigger that fired', () => {
    for (const [rule, overrides] of cases) {
      expect(verdictOf(factsWith('evaluate_financial_decision', overrides))).toEqual({ tier: 'T3', rule });
    }
  });

  it('does not treat irreversibility alone as high impact', () => {
    expect(verdictOf(factsWith('evaluate_financial_decision', { reversibility: 'irreversible' }))).toEqual({
      tier: 'T2',
      rule: 'routine_conversation',
    });
  });

  it('outranks the engineering rule, since no T3 decision may bypass independent review', () => {
    expect(verdictOf(factsWith('repository_engineering', { criticalObligationImpact: true }))).toEqual({
      tier: 'T3',
      rule: 'critical_obligation_impact',
    });
  });
});

describe('the task-shape rules (contract 10 T1, T2, T4)', () => {
  it('routes repository engineering to T4', () => {
    expect(verdictOf(factsWith('repository_engineering'))).toEqual({ tier: 'T4', rule: 'engineering_intent' });
  });

  it('routes clean extraction to T1', () => {
    for (const intent of TURN_INTENTS.filter((i) => INTENT_FAMILY[i] === 'extraction')) {
      expect(verdictOf(factsWith(intent))).toEqual({ tier: 'T1', rule: 'low_risk_extraction' });
    }
  });

  it('escalates extraction one step when contract 10\u2019s escalation signals are present', () => {
    for (const overrides of [
      { missingInformation: true },
      { dataFreshness: 'stale' as const },
      { dataFreshness: 'unknown' as const },
      { securitySensitive: true },
    ]) {
      expect(verdictOf(factsWith('parse_bank_message', overrides))).toEqual({
        tier: 'T2',
        rule: 'extraction_escalated',
      });
    }
  });

  it('does not escalate extraction merely because a tool is required (that is a request control)', () => {
    expect(verdictOf(factsWith('parse_bank_message', { toolRequirement: true }))).toEqual({
      tier: 'T1',
      rule: 'low_risk_extraction',
    });
  });

  it('defaults a conversational or untriggered decision turn to T2', () => {
    for (const intent of TURN_INTENTS.filter((i) => INTENT_FAMILY[i] === 'conversation')) {
      expect(verdictOf(factsWith(intent))).toEqual({ tier: 'T2', rule: 'routine_conversation' });
    }
    expect(verdictOf(factsWith('evaluate_financial_decision'))).toEqual({ tier: 'T2', rule: 'routine_conversation' });
  });

  it('is total: every intent classifies, and to a rule in the declared vocabulary', () => {
    for (const intent of TURN_INTENTS) {
      const verdict = verdictOf(factsWith(intent));
      expect(CLASSIFICATION_RULES).toContain(verdict.rule);
    }
  });

  it('is deterministic: the same facts twice give the same tier and rule, with no clock read', () => {
    const facts = factsWith('parse_bank_message', { dataFreshness: 'stale' });
    expect(verdictOf(facts)).toEqual(verdictOf(facts));
  });
});

// =============================================================================================
// 3 — the T0 shape has no capability (the type-level half of §6.1)
// =============================================================================================

describe('a T0 classification carries nothing that could reach a model port (§6.1, R16)', () => {
  it('mints no grant, and reports itself as not model bearing', () => {
    const classification = classifyTurn(factsWith('compute_safe_to_spend'), 'turn-t0');
    expect(classification.tier).toBe('T0');
    expect(isModelBearing(classification)).toBe(false);
    expect(classification.modelGrant).toBeUndefined();
  });

  it('types the grant field `never` on the T0 branch, so a call cannot be written', () => {
    const classification = classifyTurn(factsWith('recalculate_balances'), 'turn-t0');
    if (classification.tier !== DETERMINISTIC_TIER) throw new Error('expected the deterministic branch');
    const narrowed: DeterministicTurnClassification = classification;
    // @ts-expect-error §6.1: on this branch `modelGrant` is `never`, so it satisfies no grant type.
    const forbidden: ModelInvocationGrant = narrowed.modelGrant;
    expect(forbidden).toBeUndefined();
  });

  it('cannot be constructed WITH a grant, even by hand', () => {
    const bearing = classifyTurn(factsWith('parse_bank_message'), 'turn-t1');
    if (!isModelBearing(bearing)) throw new Error('expected the model-bearing branch');
    const forged: DeterministicTurnClassification = {
      tier: 'T0',
      turnRef: 'turn-t0',
      rule: 'deterministic_intent',
      // @ts-expect-error a T0 classification has no field that can hold a grant.
      modelGrant: bearing.modelGrant,
    };
    expect(forged.tier).toBe('T0');
  });
});

describe('a model-bearing classification carries a grant only this module could have minted', () => {
  it('mints one, agreeing with the tier and the turn it was minted for', () => {
    const classification = classifyTurn(factsWith('repository_engineering'), 'turn-t4');
    if (!isModelBearing(classification)) throw new Error('expected the model-bearing branch');
    expect(classification.modelGrant.tier).toBe('T4');
    expect(classification.modelGrant.turnRef).toBe('turn-t4');
    expect(isMintedGrant(classification.modelGrant)).toBe(true);
  });

  it('refuses a hand-built grant, so the type brand is not the only belt', () => {
    const forged = { tier: 'T1', turnRef: 'turn-t1', rule: 'low_risk_extraction' } as unknown as ModelInvocationGrant;
    expect(isMintedGrant(forged)).toBe(false);
  });

  it('mints a distinct grant per turn, so one cannot be reused for another turn', () => {
    const first = classifyTurn(factsWith('parse_bank_message'), 'turn-a');
    const second = classifyTurn(factsWith('parse_bank_message'), 'turn-b');
    if (!isModelBearing(first) || !isModelBearing(second)) throw new Error('expected model-bearing');
    expect(first.modelGrant).not.toBe(second.modelGrant);
    expect(first.modelGrant.turnRef).toBe('turn-a');
    expect(second.modelGrant.turnRef).toBe('turn-b');
  });
});

describe('the facts cannot carry a figure (§6 standing invariant, R24)', () => {
  it('rejects a surplus key, so an amount cannot ride along beside the verdicts', () => {
    // @ts-expect-error `Exact` forbids a key beyond the declared shape — including a figure.
    const verdict = classifyTurn({ ...BENIGN_FACTS, amountMilliunits: 1 }, 'turn-surplus');
    expect(verdict.tier).toBe('T2');
  });
});
