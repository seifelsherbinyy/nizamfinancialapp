/**
 * NIZAM · Router/scorer — hard eligibility first, then `modelPolicy` decides, and nothing else does
 * Implemented by: PFOS Contract 12 / Phase 5.2 (spec 06-two-agent-vps)
 * Owning requirements: R18 (a selected model is in the eligibility registry; a `provisional`
 *   registry does not permit live routing), with R17 support (per-agent cap refusal is explicit)
 * Depends on: ./eligibilityRegistry, ./turnClassifier, ../../features/routing/modelPolicy,
 *   ../../features/routing/spendLedger. No port, no store, no clock, no I/O.
 *
 * The router sits between Phase 5.1's grant and Phase 5.1's channel. The grant says a model MAY be
 * called for this turn; the channel opens if a grant is presented. This module answers the only
 * question left: WHICH model — and it is built so that two answers are unavailable to it.
 *
 * ## What this module does not own, and does not fork
 *
 * `src/features/routing/modelPolicy.ts` already holds the selection decision: contract 10's
 * roster ({@link TIER_CAPABLE}), owner decision K4's allowed set ({@link DEFAULT_ALLOWED}), the
 * premium picks, the weekly cap phases, and the cheapest-capable rule. It is consumed here and
 * nothing about it is restated. There is no second roster, no second tier map, no second cap
 * ladder, and no reimplementation of "cheapest capable" — {@link selectModel} is called and its
 * verdict is carried in {@link RoutedModel.policy} verbatim.
 *
 * What this module adds is the stage contract 10 puts in FRONT of that decision: "Hard eligibility
 * filters execute before scoring." Contract 09 owns what eligibility means; `modelPolicy` owns
 * what is affordable and cheapest. Neither knew about the other, and joining them is this file.
 *
 * ## The two properties, and why each is shaped the way it is
 *
 * **1. A model that is not in the registry cannot be selected — because it cannot be named.**
 * {@link RoutedModel.model} is an {@link EligibleModel}, whose only mint is
 * {@link admitEligibilityRegistry}. {@link selectModel} answers with a `string`, and the only way
 * this module can turn that string into a value it is allowed to return is
 * {@link AdmittedRegistry.resolve}. A failed resolution therefore leaves nothing to return, so the
 * unlisted-model case is not a branch that had to be remembered — it is an expression that cannot
 * be written. The alternative, `if (!registry.has(id)) refuse()` after selection, was rejected for
 * the reason §4.3 gives about runtime filters: re-orderable, skippable at a new call site, and its
 * failure mode is a paid call to an unvetted model that looks like success.
 *
 * When the roster and the registry disagree — `modelPolicy` picks a model the registry does not
 * grade at this tier — the refusal is EXPLICIT ({@link MODEL_ROUTING_ERROR_CODES}) and the router
 * does not substitute a second-choice model. §6.3 requires exactly that: "The refusal is explicit
 * and legible to the operator, not a silent degradation." Quietly falling back would also invert
 * the cost direction the owner asked for, since a silent downgrade is what K4's cheapest-capable
 * rule already produces on purpose and a silent upgrade spends money nobody approved.
 *
 * **2. A provisional registry cannot route — because it cannot be admitted.** That guard lives in
 * {@link admitEligibilityRegistry}, one module over, where it is a compile error rather than a
 * runtime refusal: {@link AdmittedRegistry} is only obtainable from a document typed
 * `provisional: false`. This module consumes the admitted registry, so by the time control reaches
 * {@link routeModel} the question has already been settled by the type checker. That is the reason
 * {@link RoutingInputs} takes an {@link AdmittedRegistry} rather than a document: a router that
 * accepted a document would have to check, and a router that takes an admitted registry cannot be
 * handed a provisional one at all.
 *
 * ## K4, and where the opt-in enters
 *
 * Owner decision K4: the default allowed set is the cheapest two, and the two premium models are
 * OFF unless the owner explicitly opts in for an ultra-complex task. Three things hold them off,
 * and the first is the load-bearing one:
 *
 *  - {@link selectModel} is called with `allowPremium` derived from a {@link PremiumOptIn}, and
 *    the ABSENCE of an opt-in yields `false`. There is no default, no environment lookup, and no
 *    field that could be set once and forgotten: the opt-in is an argument, and an argument that
 *    is not supplied is not supplied.
 *  - {@link PremiumOptIn} is bound to ONE turn. `authorizedBy` is a single-member literal, so an
 *    opt-in cannot be introduced as "it was already like that", and `forTurnRef` must equal the
 *    grant's own reference, so an opt-in cannot be carried forward onto a later turn the owner
 *    never saw. This is the same one-grant-one-turn discipline Phase 5.1 applied at the door.
 *  - {@link premiumRefusal} is the belt behind both: any model in {@link PREMIUM_MODELS} reaching
 *    the end of routing without a valid opt-in is refused, and the fallback chain is filtered the
 *    same way, because the chain is what a provider request would actually carry as `models`.
 *
 * ## On the utility formula, and what is deliberately not implemented
 *
 * Contract 10 gives a weighted utility over QualityFit, SafetyFit, ToolReliability, LatencyFit,
 * ContextFit, HistoricalPersonalAccuracy and normalized expected cost. Only the last term has a
 * data source today: cost comes from the frozen pricing snapshot through `modelPolicy`. The other
 * six come from a Phase-1 benchmark run that has not happened — Phase 6 owns it, and contract 09's
 * exit criteria end with "No model promoted from benchmark reputation alone."
 *
 * So the two terms that DO have evidence are expressed as contract 10's own hard filters rather
 * than as weighted numbers: SafetyFit is the disqualification gate (a disqualified model is graded
 * for nothing), and QualityFit is the band gate ({@link TIER_REQUIRED_ELIGIBILITY}). Cost remains
 * `modelPolicy`'s cheapest-capable rule. Fabricating the remaining six with plausible constants
 * would manufacture exactly the reputation contract 09 forbids, and it would be indistinguishable
 * from measurement once written down. When Phase 6 produces a measured registry the terms have a
 * source and the score can be added; until then the ordering used is contract 10's OWN stated
 * primary/fallback order, read from {@link TIER_CAPABLE}, which is evidence somebody already wrote.
 *
 * ## Money
 *
 * No owner money is present and none can be. The only figures here are PROVIDER accounting: the
 * weekly total in integer micro-USD from `spendLedger`, converted once through the sanctioned
 * {@link microUsdToUsd} at the single boundary that speaks USD — contract 10/11's cap fractions —
 * and handed to `modelPolicy` unchanged. This module performs no arithmetic on any of it, holds no
 * cap literal, and does not import `src/lib/money`, because there is no money here to implement a
 * second time. Nothing below names a host, a path, a key, or any other deployment particular (R24).
 */
import {
  DEFAULT_ALLOWED,
  PREMIUM_MODELS,
  selectModel,
  TIER_CAPABLE,
  type SelectionResult,
} from '../../features/routing/modelPolicy';
import { microUsdToUsd, type AgentWeeklyBudget } from '../../features/routing/spendLedger';
import type { TokenUsage } from '../../features/benchmark/benchmark.types';
import {
  isAdmittedModel,
  TIER_REQUIRED_ELIGIBILITY,
  type AdmittedRegistry,
  type EligibilityRequirement,
  type EligibleModel,
} from './eligibilityRegistry';
import { isMintedGrant, type ModelBearingTier, type ModelInvocationGrant } from './turnClassifier';

/** Discriminator for every refusal this router raises. A caller matches `code`, never a message. */
export const MODEL_ROUTING_ERROR_CODES = [
  'MODEL_ROUTING_GRANT_NOT_MINTED',
  'MODEL_ROUTING_MODEL_NOT_ADMITTED',
  'MODEL_ROUTING_NO_ELIGIBLE_MODEL',
  'MODEL_ROUTING_NO_MODEL_SELECTED',
  'MODEL_ROUTING_POLICY_PICK_NOT_ELIGIBLE',
  'MODEL_ROUTING_PREMIUM_NOT_OPTED_IN',
  'MODEL_ROUTING_PREMIUM_OPT_IN_FOREIGN_TURN',
  'MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED',
] as const;
export type ModelRoutingErrorCode = (typeof MODEL_ROUTING_ERROR_CODES)[number];

/**
 * A typed refusal from the router.
 *
 * `detail` holds references and enum values only — a tier, a model identity, a correlation
 * reference, a requirement name. There is no field for turn content, for a prompt, or for a
 * figure, so a refusal travelling through a log carries neither what the turn said nor how much
 * anything cost (§6.4, R19).
 */
export class ModelRoutingError extends Error {
  readonly code: ModelRoutingErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: ModelRoutingErrorCode, message: string, detail: Record<string, string> = {}) {
    super(message);
    this.name = 'ModelRoutingError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * One owner decision to allow a premium model for ONE ultra-complex turn (K4).
 *
 * A record rather than a boolean, for the same reason Phase 3.2's `KindWidening` is a record:
 * `authorizedBy` has exactly one legal value, so the opt-in cannot arrive as a default, and
 * `forTurnRef` binds it to a single classified turn, so it cannot be reused on a later one.
 */
export interface PremiumOptIn {
  /** The only authority that can turn a premium model on. Not a configuration flag (K4). */
  readonly authorizedBy: 'owner';
  /** The one turn this opt-in is for. Must equal the grant's own reference. */
  readonly forTurnRef: string;
  /** The only situation K4 admits a premium model for. */
  readonly reason: 'ultra_complex_task';
}

/** What the router needs. Every one of these is injected; the router reads nothing ambient. */
export interface RoutingInputs {
  /**
   * The admitted registry. Its type is what carries R18's provisional rule: an
   * {@link AdmittedRegistry} is only obtainable from a document statically typed
   * `provisional: false`, so a provisional registry cannot reach this function.
   */
  readonly registry: AdmittedRegistry;
  /** Phase 5.1's authority for this turn. Its tier excludes `T0`, so R16 needs nothing here. */
  readonly grant: ModelInvocationGrant;
  /**
   * This agent's own weekly budget, in integer micro-USD. Scoped to one agent by construction, so
   * one agent's spend cannot exhaust the other's (§6.2.3, R17).
   */
  readonly budget: AgentWeeklyBudget;
  /** Absent means premium is off. There is no default that could make it present (K4). */
  readonly premiumOptIn?: PremiumOptIn;
  /** Optional measured token profile for this turn, passed to `modelPolicy` untouched. */
  readonly estTurnUsage?: TokenUsage;
}

declare const ROUTED_MODEL_BRAND: unique symbol;

/**
 * The routing decision for one turn. {@link routeModel} is the only mint, so a routed model is
 * always the product of the hard eligibility stage followed by `modelPolicy`'s verdict.
 */
export interface RoutedModel {
  readonly [ROUTED_MODEL_BRAND]: 'selected by routeModel from an admitted, non-provisional registry';
  readonly model: EligibleModel;
  readonly tier: ModelBearingTier;
  /** The grant's own reference, so a request built from this belongs to the classified turn. */
  readonly turnRef: string;
  /** What contract 09 required of the model at this tier, carried so an operator reads WHY. */
  readonly requirement: EligibilityRequirement;
  /** `modelPolicy`'s verdict, verbatim. The router adds nothing to it and recomputes none of it. */
  readonly policy: SelectionResult;
  /** Contract 10's ordered `models` fallbacks: eligible, capable, K4-permitted, chosen removed. */
  readonly fallbackChain: readonly EligibleModel[];
  readonly premiumUsed: boolean;
}

const routedModels = new WeakSet<RoutedModel>();

/** True only for a decision this module produced. Refuses a forgery; never invents one. */
export function isRoutedModel(candidate: RoutedModel): boolean {
  return routedModels.has(candidate);
}

/**
 * The model id a request may carry, taken from a routed decision.
 *
 * This is the only function in the tier that turns a routing decision back into the `string` that
 * `ModelRequest.modelId` wants, and it will not accept a decision this module did not mint. So a
 * model id reaching a request through the routing path came from a registry entry.
 */
export function routedModelId(routed: RoutedModel): string {
  if (!isRoutedModel(routed)) {
    throw new ModelRoutingError(
      'MODEL_ROUTING_MODEL_NOT_ADMITTED',
      'NIZAM model router: this routing decision was not produced by routeModel, so no admitted registry vouched for the model it names (§6.3, R18)',
    );
  }
  return routed.model.modelId;
}

/**
 * Is an opt-in valid for this grant? An absent opt-in is not an error — it is K4's default, which
 * is off. A PRESENT opt-in that does not belong to this turn IS an error, because silently
 * ignoring it would leave the owner believing they had authorized something they had not.
 */
function assertOptInBelongsToTurn(grant: ModelInvocationGrant, optIn: PremiumOptIn | undefined): boolean {
  if (optIn === undefined) return false;
  if (optIn.authorizedBy !== 'owner' || optIn.reason !== 'ultra_complex_task' || optIn.forTurnRef !== grant.turnRef) {
    throw new ModelRoutingError(
      'MODEL_ROUTING_PREMIUM_OPT_IN_FOREIGN_TURN',
      'NIZAM model router: this premium opt-in does not belong to the turn being routed. Under K4 an opt-in authorizes one ultra-complex turn, so it is refused rather than ignored — ignoring it would leave the owner believing a premium model had been authorized.',
      { grantTurnRef: grant.turnRef, optInTurnRef: optIn.forTurnRef },
    );
  }
  return true;
}

/**
 * K4's belt: a premium model may not be routed without a valid opt-in. Returns the refusal rather
 * than throwing, so the caller decides where it fires and so it can be exercised directly.
 *
 * It should be unreachable through {@link routeModel}, because `modelPolicy` is asked with
 * `allowPremium: false` when there is no opt-in and never answers with a premium model in that
 * case. A guard that has only ever been observed passing is not evidence, which is why it is
 * exported and tested on its own.
 */
export function premiumRefusal(modelId: string, premiumPermitted: boolean): ModelRoutingError | null {
  if (premiumPermitted || !PREMIUM_MODELS.includes(modelId)) return null;
  return new ModelRoutingError(
    'MODEL_ROUTING_PREMIUM_NOT_OPTED_IN',
    'NIZAM model router: this model is off by default under owner decision K4 and no explicit owner opt-in for an ultra-complex task was supplied for this turn',
    { modelId },
  );
}

/**
 * The hard eligibility stage (contract 10: "Hard eligibility filters execute before scoring").
 *
 * Two filters, both from evidence that exists: contract 09's grade for the band this tier requires
 * — which already carries the disqualification outcome, since an admitted registry grades a
 * disqualified model for nothing — and contract 10's own roster of models capable at the tier. The
 * result is ordered by {@link TIER_CAPABLE}, which is contract 10's stated primary-then-fallback
 * order, so the fallback chain is contract 10's ordering rather than one invented here.
 */
export function eligibleCandidatesAt(registry: AdmittedRegistry, tier: ModelBearingTier): readonly EligibleModel[] {
  const eligible = new Map(registry.eligibleAt(tier).map((model) => [model.modelId, model]));
  const candidates: EligibleModel[] = [];
  for (const modelId of TIER_CAPABLE[tier]) {
    const model = eligible.get(modelId);
    if (model === undefined) continue;
    // The runtime half of the brand. Reached only when an AdmittedRegistry was forged by a cast,
    // which is precisely the case a purely type-level guarantee cannot cover.
    if (!isAdmittedModel(model)) {
      throw new ModelRoutingError(
        'MODEL_ROUTING_MODEL_NOT_ADMITTED',
        'NIZAM model router: this registry offered a model that was not minted from a registry entry, so nothing vouches for its eligibility (§6.3, R18)',
        { modelId, tier },
      );
    }
    candidates.push(model);
  }
  return candidates;
}

/**
 * Route one turn to one model.
 *
 * The order of the stages is contract 10's own: hard eligibility filters, then the budget and
 * policy decision, then the resolution back onto the eligible set. Every refusal is typed and
 * explicit, and none of them degrades to another model (§6.3).
 */
export function routeModel(inputs: RoutingInputs): RoutedModel {
  const { registry, grant, budget, premiumOptIn, estTurnUsage } = inputs;

  // Belt from Phase 5.1: an authority this tier did not issue authorizes nothing. Without it a
  // forged grant could reach the router, and a routed model is what a request is built from.
  if (!isMintedGrant(grant)) {
    throw new ModelRoutingError(
      'MODEL_ROUTING_GRANT_NOT_MINTED',
      'NIZAM model router: this grant was not minted by classifyTurn, so no classified turn authorized a model for it (§6.1, R16)',
    );
  }

  const premiumPermitted = assertOptInBelongsToTurn(grant, premiumOptIn);
  const tier = grant.tier;
  const requirement = TIER_REQUIRED_ELIGIBILITY[tier];

  // Stage 1 — hard eligibility, before anything is scored or costed.
  const candidates = eligibleCandidatesAt(registry, tier);
  const permitted = candidates.filter((model) => premiumRefusal(model.modelId, premiumPermitted) === null);
  if (permitted.length === 0) {
    throw new ModelRoutingError(
      'MODEL_ROUTING_NO_ELIGIBLE_MODEL',
      `NIZAM model router: no model in the registry is graded for what ${tier} requires and permitted by owner decision K4, so there is nothing to route to. Absence from the registry means ineligible; there is no implicit default (§6.3, R18).`,
      { tier, requirement: requirement.kind === 'developer_build' ? 'developer_build' : requirement.band },
    );
  }

  // Stage 2 — the cap, from two independent readings. The ledger's own verdict for this agent, and
  // the policy's verdict about the same figures. §6.2 keeps the belts independent, and a cap is
  // never raised or lifted to let an operation through.
  if (budget.exhausted) {
    throw new ModelRoutingError(
      'MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED',
      `NIZAM model router: agent "${budget.agent}" has reached its own weekly cap for week ${budget.weekKey}, so model calls for this agent are refused. The other agent is unaffected, and the deterministic engines continue to produce obligation alerts and safe-to-spend figures (§6.2, R17).`,
      { agent: budget.agent, weekKey: budget.weekKey, tier },
    );
  }

  // Stage 3 — `modelPolicy` makes the decision. Cheapest capable within K4's allowed set, the
  // premium pick only on an owner opt-in, and the affordability judgement. Not reimplemented here.
  const policy = selectModel({
    tier,
    allowPremium: premiumPermitted,
    spentThisWeekUsd: microUsdToUsd(budget.spentMicroUsd),
    capUsd: microUsdToUsd(budget.capMicroUsd),
    ...(estTurnUsage === undefined ? {} : { estTurnUsage }),
  });

  if (policy.blockedByBudget) {
    throw new ModelRoutingError(
      'MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED',
      `NIZAM model router: the weekly budget blocks this call for agent "${budget.agent}" — ${policy.reason}. The refusal is explicit rather than a downgrade to a cheaper model, and deterministic alerts are unaffected (§6.2, R17).`,
      { agent: budget.agent, weekKey: budget.weekKey, tier, budgetPhase: policy.budgetPhase },
    );
  }
  // Reachable only if a tier's capable set and K4's allowed set stopped intersecting, since the
  // budget cases that also yield a null pick were caught above. The test asserts that intersection
  // rather than contriving a path here, so the day contract 10's roster changes it fails loudly.
  if (policy.model === null) {
    throw new ModelRoutingError(
      'MODEL_ROUTING_NO_MODEL_SELECTED',
      `NIZAM model router: the selection policy returned no model for ${tier} — ${policy.reason}`,
      { tier, reason: policy.reason },
    );
  }

  // Stage 4 — resolution, not verification. `selectModel` answers with a string; the only value
  // this function may return carries the registry's brand, and the sole route from one to the other
  // is a lookup in the eligible set. A miss leaves nothing to return.
  const chosen = permitted.find((model) => model.modelId === policy.model);
  if (chosen === undefined) {
    throw new ModelRoutingError(
      'MODEL_ROUTING_POLICY_PICK_NOT_ELIGIBLE',
      `NIZAM model router: contract 10's roster selected "${policy.model}" for ${tier}, but the eligibility registry does not grade it for what ${tier} requires. The roster and the registry disagree, and the router refuses rather than substituting a different model — a silent substitution is the degradation §6.3 forbids (R18).`,
      {
        tier,
        modelId: policy.model,
        requirement: requirement.kind === 'developer_build' ? 'developer_build' : requirement.band,
      },
    );
  }

  // Belt behind stage 4. Unreachable while `modelPolicy` honours K4, and asserted anyway.
  const refusal = premiumRefusal(chosen.modelId, premiumPermitted);
  if (refusal !== null) throw refusal;

  const routed = Object.freeze({
    model: chosen,
    tier,
    turnRef: grant.turnRef,
    requirement,
    policy,
    // Contract 10's `models` control: the rest of the permitted set, in the roster's own order.
    fallbackChain: Object.freeze(permitted.filter((model) => model.modelId !== chosen.modelId)),
    premiumUsed: policy.premiumUsed,
  }) as unknown as RoutedModel;
  routedModels.add(routed);
  return routed;
}

/**
 * K4's default allowed set, re-exported so a caller can state the posture it is under without
 * importing `modelPolicy` alongside this module. Re-exported, not restated — one definition.
 */
export { DEFAULT_ALLOWED, PREMIUM_MODELS };
