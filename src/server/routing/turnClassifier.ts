/**
 * NIZAM · Turn classifier — rules first, and a T0 turn holds no way to reach a model
 * Implemented by: PFOS Contract 12 / Phase 5.1 (spec 06-two-agent-vps)
 * Owning requirements: R16 (a turn classified `T0` invokes no model)
 * Depends on: ../../features/routing/modelPolicy (contract 10's `Tier` and `TIER_CAPABLE`),
 *   ../ports/shapeGuards (type level only). Nothing else — no store, no clock, no port.
 *
 * Contract 10 owns the taxonomy and this module reuses it rather than restating it: `Tier` is
 * imported from `src/features/routing/modelPolicy.ts`, so `T0`-`T4` have exactly one definition
 * in this repository and a rename would break here loudly. Contract 09's `L0`/`L1`/`L2` are a
 * different axis — model ELIGIBILITY bands, not turn classes — and are deliberately not mixed in.
 *
 * ## Why the T0 guarantee is a capability, not a branch (§6.1, R16)
 *
 * §6.1: "A turn classified `T0` invokes **no model**. Not a cheap model. Not a cached model.
 * None." And it names the false negative to avoid: a test that only checks the answer looks
 * deterministic "would pass if a model were called and its output discarded, which still spends
 * money and still sends content to a provider."
 *
 * Three mechanisms were available. The one chosen is the third, and the other two are kept as
 * outer belts rather than discarded:
 *
 *  1. **A runtime branch** (`if (tier === 'T0') return deterministic(...)`). Rejected as the
 *     primary mechanism for the reason §4.3 gives about runtime filters generally: it is code
 *     that can be re-ordered, short-circuited, or duplicated at a new call site, and its failure
 *     mode is a paid call that looks like success.
 *  2. **`Exclude<Tier, 'T0'>` on the request type.** Already in force one layer out:
 *     `ModelRequest.tier` is `Exclude<Tier, 'T0'>`, so a request labelled T0 does not compile.
 *     But a caller holding a T0 classification could still relabel the turn `T1` and call the
 *     port, and nothing would object. The type constrains the LABEL, not the AUTHORITY.
 *  3. **A capability the T0 branch does not have** — what this module does. A classification is a
 *     discriminated union. The model-bearing branch carries a {@link ModelInvocationGrant}; the
 *     `T0` branch types that same field `never`, so it cannot hold one under any spelling.
 *     {@link classifyTurn} is the grant's only mint, the same device the consent gate uses for a
 *     served envelope, and `dispatchTurn` will not reach the port without one. So the T0 path does
 *     not "decline to call the model" — it has nothing to call it with.
 *
 * A cast (`as unknown as ModelInvocationGrant`) defeats any purely type-level brand, so the mint
 * is also recorded in a module-private {@link WeakSet} and {@link isMintedGrant} answers from it.
 * Note the direction that state can move in: the registry can only ever REFUSE a grant it did not
 * issue. There is no code path by which it admits one, so its failure mode is a false negative
 * that halts a call, never a false positive that permits one. It holds no decision and no cache —
 * a classification is re-derived on every call, exactly as §4.5.4 requires of a consent scope.
 *
 * ## Why the facts carry no figure
 *
 * The standing invariant of §6: "the model tier never computes or sources a monetary number. The
 * deterministic engines do." Contract 10 lists an amount and two ratios among the classifier
 * features; this module consumes the deterministic engines' **verdicts** about them
 * (`amountOverOwnerThreshold`, `exceedsSafeToSpendAllowance`, `materialShareOfLiquidNetWorth`)
 * rather than the figures themselves. So the threshold lives where the contract puts it, and
 * {@link TurnFacts} has no numeric field at all. That is enforced, not intended:
 * {@link NoMagnitude} types every numeric key `never`, so adding `amountMilliunits: number` here
 * later makes the field uninhabitable and the addition fails to compile. `src/lib/money` is
 * neither imported nor needed, there is no arithmetic below, and there is no second money
 * implementation because there is no money.
 *
 * ## Rules first
 *
 * Contract 10's classifier is `rules_first_then_lightweight_model_if_ambiguous`. Every rule below
 * is deterministic and total: the same facts always produce the same tier and the same rule name,
 * with no clock, no randomness and no I/O. The lightweight-model tie-break belongs to the router
 * (Phase 5.2) and can only ever apply on a model-bearing path, because a T0 outcome is decided by
 * intent alone and is therefore never ambiguous. No literal here names a host, a bot, a sender, an
 * amount, or any other deployment particular (R24).
 */
import { TIER_CAPABLE, type Tier } from '../../features/routing/modelPolicy';
import type { Exact, NoMagnitude } from '../ports/shapeGuards';

/**
 * The tiers that route to a model. `T0` is excluded by construction, which is the same statement
 * `ModelRequest.tier` makes on the port — one definition, used twice.
 */
export type ModelBearingTier = Exclude<Tier, 'T0'>;

/** The deterministic tier, named once so no call site spells it as a bare string. */
export const DETERMINISTIC_TIER = 'T0' as const satisfies Tier;
export type DeterministicTier = typeof DETERMINISTIC_TIER;

/**
 * Turn intents, taken from contract 10's own examples under each task class. Enumerated so a
 * typo is a compile error and an unclassifiable free-text intent cannot arrive.
 */
export const TURN_INTENTS = [
  // T0 — deterministic/no-LLM: "Recalculate balances. Compute safe-to-spend. Detect exact
  // duplicates. Apply known payment schedules. Generate fixed-format reminders. Validate schema."
  'recalculate_balances',
  'compute_safe_to_spend',
  'detect_exact_duplicate',
  'apply_known_payment_schedule',
  'emit_fixed_format_reminder',
  'validate_schema',
  // T1 — low-risk extraction.
  'parse_bank_message',
  'normalize_merchant',
  'suggest_category',
  'summarize_confirmed_transaction',
  // T2 — routine financial conversation.
  'explain_safe_to_spend',
  'periodic_briefing',
  'identify_leakage',
  'compare_ordinary_budget_options',
  'request_correction',
  // T3 — high-impact financial decision (the triggers decide; the intent only says it is one).
  'evaluate_financial_decision',
  // T4 — repository engineering.
  'repository_engineering',
] as const;
export type TurnIntent = (typeof TURN_INTENTS)[number];

/** Which family an intent belongs to. The family is what the rules read, never the raw string. */
export const INTENT_FAMILIES = ['deterministic', 'extraction', 'conversation', 'decision', 'engineering'] as const;
export type IntentFamily = (typeof INTENT_FAMILIES)[number];

/**
 * Every intent's family. A `Record` over the union rather than five arrays, so adding a member to
 * {@link TURN_INTENTS} without placing it in a family fails to compile — an unfamiliared intent
 * cannot silently fall through to the conversational default.
 */
export const INTENT_FAMILY: Readonly<Record<TurnIntent, IntentFamily>> = {
  recalculate_balances: 'deterministic',
  compute_safe_to_spend: 'deterministic',
  detect_exact_duplicate: 'deterministic',
  apply_known_payment_schedule: 'deterministic',
  emit_fixed_format_reminder: 'deterministic',
  validate_schema: 'deterministic',
  parse_bank_message: 'extraction',
  normalize_merchant: 'extraction',
  suggest_category: 'extraction',
  summarize_confirmed_transaction: 'extraction',
  explain_safe_to_spend: 'conversation',
  periodic_briefing: 'conversation',
  identify_leakage: 'conversation',
  compare_ordinary_budget_options: 'conversation',
  request_correction: 'conversation',
  evaluate_financial_decision: 'decision',
  repository_engineering: 'engineering',
};

/** How hard the turn's action would be to undo (contract 10 feature: "Reversibility"). */
export const REVERSIBILITY_CLASSES = ['reversible', 'costly_to_reverse', 'irreversible'] as const;
export type Reversibility = (typeof REVERSIBILITY_CLASSES)[number];

/** How current the evidence is (contract 10 feature: "Data freshness"). */
export const DATA_FRESHNESS_CLASSES = ['fresh', 'stale', 'unknown'] as const;
export type DataFreshness = (typeof DATA_FRESHNESS_CLASSES)[number];

/**
 * The classifier's inputs, before {@link NoMagnitude} is applied. Every field is an enum or a
 * boolean; the boolean ones are the deterministic engines' verdicts, so no threshold is chosen
 * here and no figure crosses this boundary.
 */
interface TurnFactsShape {
  readonly intent: TurnIntent;
  readonly reversibility: Reversibility;
  readonly dataFreshness: DataFreshness;
  /** Contract 10 feature: "Missing facts". */
  readonly missingInformation: boolean;
  /**
   * Contract 10 feature: "Tool requirements". Carried because the router's request controls need
   * it (`provider.require_parameters: true` for tools or structured outputs) — it is deliberately
   * NOT a tier input, because contract 10 makes it a request control rather than a task class.
   */
  readonly toolRequirement: boolean;
  /** Contract 10 feature: "Security sensitivity". */
  readonly securitySensitive: boolean;
  /** Verdict, not a figure: contract 10 high-impact rule `amount_over_user_threshold`. */
  readonly amountOverOwnerThreshold: boolean;
  /** Verdict, not a ratio: contract 10 feature `safe_to_spend_ratio`. */
  readonly exceedsSafeToSpendAllowance: boolean;
  /** Verdict, not a ratio: contract 10 feature `liquid_net_worth_ratio`. */
  readonly materialShareOfLiquidNetWorth: boolean;
  /** Contract 10 high-impact rule `critical_obligation_impact` — a P0/P1 obligation is touched. */
  readonly criticalObligationImpact: boolean;
  /** Contract 10 high-impact rule `new_debt`. */
  readonly newDebt: boolean;
  /** Contract 10 T3 trigger: "Asset sale". */
  readonly assetSale: boolean;
  /** Contract 10 T3 trigger: "Job offer or major income change". */
  readonly majorIncomeChange: boolean;
  /** Contract 10 high-impact rule `decision_horizon_days >= 365`, as the engine's verdict. */
  readonly longHorizonDecision: boolean;
  /** Contract 10 high-impact rule `forecast_shortfall_probability >= 0.10`, as a verdict. */
  readonly forecastShortfallLikely: boolean;
  /** Contract 10 T3 trigger and escalation rule: "Evidence conflicts". */
  readonly evidenceConflicts: boolean;
  /** Contract 10 T3 trigger and escalation rule: "Low confidence". */
  readonly lowConfidence: boolean;
}

/**
 * The classifier's inputs. Today this resolves to {@link TurnFactsShape} unchanged, because no
 * numeric field exists; its purpose is tomorrow — a numeric field added here becomes `never`, so
 * a figure cannot be routed through the classifier even by an editor who means well (§6, R24).
 */
export type TurnFacts = NoMagnitude<TurnFactsShape>;

/**
 * The rule that decided the tier, so an operator reads WHY rather than only WHAT. Ordered as the
 * classifier evaluates them; the order is part of the contract and is asserted by the tests.
 */
export const CLASSIFICATION_RULES = [
  'deterministic_intent',
  'new_debt',
  'critical_obligation_impact',
  'amount_over_owner_threshold',
  'asset_sale',
  'major_income_change',
  'long_horizon_decision',
  'forecast_shortfall_likely',
  'conflicting_evidence_or_low_confidence',
  'irreversible_and_material',
  'engineering_intent',
  'extraction_escalated',
  'low_risk_extraction',
  'routine_conversation',
] as const;
export type ClassificationRule = (typeof CLASSIFICATION_RULES)[number];

declare const MODEL_INVOCATION_GRANT_BRAND: unique symbol;

/**
 * The authority to make one model call for one turn. {@link classifyTurn} is the only mint
 * (§6.1), and `dispatchTurn` refuses to reach the port without one, so a model call is reachable
 * only from a classification that was not `T0`.
 *
 * It carries `tier` and `turnRef` because the request must agree with the grant: a planner cannot
 * take a `T1` grant and issue a `T4` request under it, and cannot reuse one turn's grant for
 * another turn. `tier` is {@link ModelBearingTier}, which is precisely `ModelRequest.tier`, so the
 * grant feeds the request without a cast and without a second tier vocabulary.
 */
export interface ModelInvocationGrant {
  readonly [MODEL_INVOCATION_GRANT_BRAND]: 'minted by classifyTurn for a turn that is not T0';
  readonly tier: ModelBearingTier;
  /** A correlation reference. A pointer to a telemetry row, never turn content (§6.4). */
  readonly turnRef: string;
  readonly rule: ClassificationRule;
}

/**
 * Grants this module actually issued. A `WeakSet`, so a grant is collectable with the turn it
 * belongs to. It can only ever refuse: nothing outside {@link mintGrant} adds to it, so a forged
 * grant is rejected while a genuine one is never invented.
 */
const mintedGrants = new WeakSet<ModelInvocationGrant>();

/** True only for a grant this module minted. The runtime half of the capability (§6.1). */
export function isMintedGrant(candidate: ModelInvocationGrant): boolean {
  return mintedGrants.has(candidate);
}

function mintGrant(tier: ModelBearingTier, turnRef: string, rule: ClassificationRule): ModelInvocationGrant {
  const grant = Object.freeze({ tier, turnRef, rule }) as unknown as ModelInvocationGrant;
  mintedGrants.add(grant);
  return grant;
}

/**
 * A turn that code answers. `modelGrant` is typed `never` and optional: optional so the shape is
 * ordinary to construct, `never` so it can never hold a grant. This is the whole of R16 at the
 * type level — the T0 branch has no capability to hand to a port.
 */
export interface DeterministicTurnClassification {
  readonly tier: DeterministicTier;
  readonly turnRef: string;
  readonly rule: ClassificationRule;
  readonly modelGrant?: never;
}

/** A turn that routes to a model. The grant is required, and only this module can produce one. */
export interface ModelBearingTurnClassification {
  readonly tier: ModelBearingTier;
  readonly turnRef: string;
  readonly rule: ClassificationRule;
  readonly modelGrant: ModelInvocationGrant;
}

/** The classifier's verdict. Discriminated on `tier`, so narrowing is the compiler's job. */
export type TurnClassification = DeterministicTurnClassification | ModelBearingTurnClassification;

/** Every high-impact rule, in evaluation order, paired with the fact that fires it. */
const HIGH_IMPACT_RULES: readonly (readonly [ClassificationRule, (facts: TurnFacts) => boolean])[] = [
  ['new_debt', (f) => f.newDebt],
  ['critical_obligation_impact', (f) => f.criticalObligationImpact],
  ['amount_over_owner_threshold', (f) => f.amountOverOwnerThreshold],
  ['asset_sale', (f) => f.assetSale],
  ['major_income_change', (f) => f.majorIncomeChange],
  ['long_horizon_decision', (f) => f.longHorizonDecision],
  ['forecast_shortfall_likely', (f) => f.forecastShortfallLikely],
  ['conflicting_evidence_or_low_confidence', (f) => f.evidenceConflicts || f.lowConfidence],
  [
    'irreversible_and_material',
    (f) => f.reversibility === 'irreversible' && (f.materialShareOfLiquidNetWorth || f.exceedsSafeToSpendAllowance),
  ],
];

/**
 * An extraction turn escalates one step when the cheapest model cannot be trusted with it:
 * contract 10's escalation list names insufficient data freshness and missing facts, and its
 * feature list names security sensitivity. Escalation is to the next tier, never to a premium
 * model — that decision belongs to the policy, not to the classifier.
 */
function extractionMustEscalate(facts: TurnFacts): boolean {
  return facts.missingInformation || facts.dataFreshness !== 'fresh' || facts.securitySensitive;
}

/** The tier and rule, with no grant minted yet. Pure, total, and free of side effects. */
function decide(facts: TurnFacts): { tier: Tier; rule: ClassificationRule } {
  const family = INTENT_FAMILY[facts.intent];

  // 1. A deterministic intent is answered by code. Contract 10: "Route: code only." This rule is
  //    FIRST and unconditional, and that is deliberate rather than convenient. A deterministic
  //    operation that lacks a fact cannot be completed by a model either — a model would guess,
  //    and §6.1 would have been spent to obtain the guess. The correct answer to a balance
  //    recalculation with missing data is a deterministic refusal, not a paid one.
  if (family === 'deterministic') return { tier: DETERMINISTIC_TIER, rule: 'deterministic_intent' };

  // 2. High-impact triggers, before the engineering rule. Contract 10's exit criteria say "No T3
  //    decision can bypass independent review", so a financial trigger wins over a task-shape
  //    rule: the tier that carries the review must not be reachable-around.
  for (const [rule, fires] of HIGH_IMPACT_RULES) {
    if (fires(facts)) return { tier: 'T3', rule };
  }

  // 3. Repository engineering (contract 10 T4).
  if (family === 'engineering') return { tier: 'T4', rule: 'engineering_intent' };

  // 4/5. Extraction, escalated one step where contract 10's escalation rules say it must be.
  if (family === 'extraction') {
    return extractionMustEscalate(facts)
      ? { tier: 'T2', rule: 'extraction_escalated' }
      : { tier: 'T1', rule: 'low_risk_extraction' };
  }

  // 6. Routine financial conversation — the default for a conversational turn, and for a decision
  //    turn that fired no high-impact trigger (contract 10 T2: "Compare ordinary budget options").
  return { tier: 'T2', rule: 'routine_conversation' };
}

/**
 * Classify one turn.
 *
 * `Exact` is the argument constraint, so a caller cannot add a surplus key — TypeScript's own
 * excess-property check fires only on a fresh literal, and a figure smuggled in on an extra key
 * would otherwise pass. Combined with {@link NoMagnitude} over the declared fields, no numeric
 * value can enter this function by any route.
 *
 * @param facts The deterministic engines' verdicts about the turn. No figure, no free text.
 * @param turnRef Correlation reference for telemetry. A pointer, never content (§6.4).
 */
export function classifyTurn<F extends Exact<TurnFacts, F>>(facts: F, turnRef: string): TurnClassification {
  const { tier, rule } = decide(facts);
  if (tier === DETERMINISTIC_TIER) {
    // No grant is minted on this branch, and the returned shape has nowhere to put one.
    return Object.freeze({ tier: DETERMINISTIC_TIER, turnRef, rule });
  }
  return Object.freeze({ tier, turnRef, rule, modelGrant: mintGrant(tier, turnRef, rule) });
}

/**
 * True when the classification routes to a model. A type predicate rather than a comparison at
 * each call site, so the narrowing that protects the port happens in one place.
 */
export function isModelBearing(classification: TurnClassification): classification is ModelBearingTurnClassification {
  return classification.tier !== DETERMINISTIC_TIER;
}

/**
 * The models contract 10's roster deems capable at a tier, read straight from `modelPolicy` so
 * there is no second roster. Exported because the T0 statement is worth being able to make from
 * two independent directions: this returns an empty list for `T0`, and the classifier gives a T0
 * turn no grant. Either alone would be an argument; both together are a guarantee.
 */
export function capableModelsAt(tier: Tier): readonly string[] {
  return TIER_CAPABLE[tier];
}
