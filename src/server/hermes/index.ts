/**
 * Hermes integration barrel.
 * Owning authority: PFOS Contract 14 (v2); Contracts 12 and 13.
 * Phase: Phase 2.5 refined Hermes integration.
 * Depends on: the governed Hermes profile, evidence, and response boundaries.
 */
export {
  HERMES_PROFILE_NAMES,
  HERMES_PROFILE_POLICIES,
  assertProfileIsolation,
  getHermesProfilePolicy,
  modelForTier,
  type HermesProfileName,
  type HermesProfilePolicy,
} from './profilePolicy.ts';
export {
  EVIDENCE_CONFIDENCE,
  KNOWLEDGE_DOMAINS,
  KNOWLEDGE_PRIVACY_CLASSES,
  buildGroundedContext,
  validateEvidenceItem,
  type EvidenceCitation,
  type EvidenceConfidence,
  type EvidenceItem,
  type GroundedContext,
  type KnowledgeDomain,
  type KnowledgePrivacyClass,
} from './knowledgeBoundary.ts';
export {
  RESPONSE_CONFIDENCE,
  renderFocusedResponse,
  validateFocusedResponse,
  type FocusedResponseDraft,
  type ResponseConfidence,
  type ResponseVerdict,
} from './responsePolicy.ts';
export {
  classifyDriveSource,
  prepareDriveEvidence,
  DRIVE_FOLDER_ROLES,
  type DriveEvidencePacket,
  type DriveFolderRole,
  type DriveSourcePacket,
} from '../ingest/driveEvidencePacket.ts';
export {
  HERMES_TOOL_NAMES,
  HERMES_TOOLS_BY_PROFILE,
  assertDeterministicFinancialResult,
  assertHermesToolAllowed,
  isHermesToolAllowed,
  type DeterministicFinancialFact,
  type FinancialAnalysisRequest,
  type FinancialAnalysisResult,
  type HermesToolName,
  type JournalContextRequest,
  type JournalContextResult,
  type JournalEntryDraft,
  type NizamcoreToolPort,
  type PfosToolPort,
} from './toolBoundary.ts';
export {
  HERMES_PROFILE_ENV_ENTRIES,
  HermesEnvironmentError,
  loadHermesProfileEnvironment,
  describeHermesProfileEnvironment,
  type HermesKillMode,
  type HermesProfileEnvironment,
  type HermesEnvironmentErrorCode,
} from './profileEnvironment.ts';
export {
  DEPRECATED_PENDING_REVOKE,
  INGRESS_ALIAS_MAP,
  INGRESS_POLICY,
  INGRESS_PROFILE_NAME,
  REVOKED_TELEGRAM_ALIASES,
  SLACK_BOT_TOKEN_ALIAS,
  SLACK_APP_TOKEN_ALIAS,
  SLACK_ALLOWED_USERS_ALIAS,
  assertIngressKeepsInternalIsolation,
  assertRevokedTelegramAliasesNotPresent,
  isRevokedTelegramAlias,
  mapIngressAlias,
  profileForIngressTool,
  toolsReachableFromIngress,
  type HermesIngressProfileName,
  type IngressPolicy,
  type RevokedTelegramAlias,
} from './ingressPolicy.ts';
export {
  INGRESS_MODULES,
  INGRESS_ROUTE_CODES,
  assertRoutedFinancialResult,
  routeIngressText,
  type IngressModule,
  type IngressRoute,
  type IngressRouteCode,
} from './ingressRouter.ts';
export {
  SECRET_BROKER_OPERATIONS,
  SECRET_BROKER_OUTCOMES,
  SecretBrokerError,
  assertNoSecretInAudit,
  inspectSecretAlias,
  mapApprovedAliasToHermesEntry,
  type SecretBrokerAudit,
  type SecretBrokerOperation,
  type SecretBrokerOutcome,
  type SecretBrokerResult,
} from './secretBroker.ts';
export {
  HERMES_GATEWAY_ARGUMENTS,
  auditHermesGatewayWiring,
  type HermesGatewayProfileName,
  type HermesGatewayWiringFinding,
  type HermesGatewayWiringInput,
} from './gatewayWiring.ts';
export {
  HERMES_RUNTIME_ERROR_CODES,
  HERMES_RUNTIME_STATES,
  HermesRuntimeError,
  createHermesRuntimeAdapter,
  executionCapabilities,
  type HermesBoundedInput,
  type HermesBoundedScalar,
  type HermesCapability,
  type HermesGrantVerificationContext,
  type HermesGrantVerifier,
  type HermesRuntimeAdapter,
  type HermesRuntimeAdapterOptions,
  type HermesRuntimeErrorCode,
  type HermesRuntimeReadiness,
  type HermesRuntimeState,
  type HermesToolExecutor,
  type HermesToolExecutors,
  type HermesToolGrant,
} from './runtimeAdapter.ts';
