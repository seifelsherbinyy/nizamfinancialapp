/**
 * NIZAM · Routing tier barrel — classification and the guarded door to the model port
 * Implemented by: PFOS Contract 12 / Phase 5.1 (spec 06-two-agent-vps)
 * Owning requirements: R16 (a turn classified `T0` invokes no model)
 * Depends on: turnClassifier.ts, turnDispatch.ts
 *
 * `src/server/**` is the VPS-side tier and is never imported by `App.tsx` or the browser router
 * (asserted by AC08b). The tier taxonomy is contract 10's and is re-exported from
 * `src/features/routing/modelPolicy.ts` rather than redefined, so `T0`-`T4` and the model roster
 * keep exactly one definition in this repository.
 *
 * Note the absence: there is no export that hands a caller the {@link OpenRouterPort} it wrapped,
 * and no export that produces a {@link ModelInvocationGrant} other than the classifier. A T0 turn
 * has nothing to call a model with, which is R16 (§6.1).
 *
 * Phase 5.2 adds two more absences of the same kind. There is no export that builds an
 * `EligibleModel` from a model id — {@link admitEligibilityRegistry} mints them from registry
 * entries and nothing else does — and there is no export that admits a registry document whose
 * `provisional` flag is anything other than the literal `false`. So "a model that is not in the
 * registry" and "a registry that is provisional" are both unsayable here rather than merely
 * checked, which is R18 (§6.3).
 */
export {
  capableModelsAt,
  classifyTurn,
  CLASSIFICATION_RULES,
  DATA_FRESHNESS_CLASSES,
  DETERMINISTIC_TIER,
  INTENT_FAMILIES,
  INTENT_FAMILY,
  isMintedGrant,
  isModelBearing,
  REVERSIBILITY_CLASSES,
  TURN_INTENTS,
  type ClassificationRule,
  type DataFreshness,
  type DeterministicTier,
  type DeterministicTurnClassification,
  type IntentFamily,
  type ModelBearingTier,
  type ModelBearingTurnClassification,
  type ModelInvocationGrant,
  type Reversibility,
  type TurnClassification,
  type TurnFacts,
  type TurnIntent,
} from './turnClassifier.ts';

export {
  createModelChannel,
  dispatchTurn,
  TURN_ROUTING_ERROR_CODES,
  TurnRoutingError,
  type ModelChannel,
  type TurnDispatchDependencies,
  type TurnOutcome,
  type TurnRoutingErrorCode,
} from './turnDispatch.ts';

export {
  admitEligibilityRegistry,
  ELIGIBILITY_BANDS,
  ELIGIBILITY_REGISTRY_ERROR_CODES,
  ELIGIBILITY_REGISTRY_VERSION,
  EligibilityRegistryError,
  isAdmittedModel,
  parseEligibilityRegistry,
  parseEligibilityRegistryText,
  provisionalRegistryFromFixture,
  satisfiesRequirement,
  TIER_REQUIRED_ELIGIBILITY,
  type AdmittedRegistry,
  type EligibilityBand,
  type EligibilityBands,
  type EligibilityRegistryDocument,
  type EligibilityRegistryEntry,
  type EligibilityRegistryErrorCode,
  type EligibilityRequirement,
  type EligibleModel,
  type LiveEligibilityRegistry,
  type ProvisionalEligibilityRegistry,
} from './eligibilityRegistry.ts';

export {
  eligibleCandidatesAt,
  isRoutedModel,
  MODEL_ROUTING_ERROR_CODES,
  ModelRoutingError,
  premiumRefusal,
  routedModelId,
  routeModel,
  type ModelRoutingErrorCode,
  type PremiumOptIn,
  type RoutedModel,
  type RoutingInputs,
} from './modelRouter.ts';
