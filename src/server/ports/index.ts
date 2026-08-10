/**
 * NIZAM · Server ports barrel — every external boundary, as an interface and nothing more
 * Implemented by: PFOS Contract 12 / Phase 2.1 (spec 06-two-agent-vps)
 * Depends on: drive.ts, errors.ts, openrouter.ts, shapeGuards.ts, signalBus.ts, telegram.ts, whoop.ts
 *
 * Design key decision 1: every external boundary — transport, model, backup, recovery, bus — is an
 * injected interface with a deterministic mock. That is what makes this tier fully buildable and
 * testable with no VPS and no secret, and it is already the house pattern.
 *
 * Phase 2.1 ships the interfaces. Phase 2.2 ships the mocks. No live adapter exists yet, and none
 * may be written here: every one of these five boundaries has a GATED live half (steering §2, gates
 * G3-G6). Nothing in this directory performs a network call, holds a secret, or names an endpoint.
 *
 * `src/server/**` must never be imported by `App.tsx` or the browser router, the same exclusion
 * that already applies to `src/features/benchmark/**` and `src/features/routing/**`. Phase 2.3
 * extends the harness assertion that proves it.
 */

// Type-level shape guards — how the forbidden shape is made inexpressible.
export type {
  ContentBearingKey,
  Exact,
  MagnitudeKeys,
  NoFieldBeyond,
  NoMagnitude,
  Redacted,
} from './shapeGuards.ts';

// The failure vocabulary shared by all five ports.
export { PORT_FAILURE_CODES, type PortFailure, type PortFailureCode } from './errors.ts';

// Transport — contract 12 §5.
export {
  TELEGRAM_TRANSPORT_MODES,
  type DedupKey,
  type TelegramAcceptDecision,
  type TelegramDelivery,
  type TelegramInboundPort,
  type TelegramOutboundMessage,
  type TelegramOutboundPort,
  type TelegramPort,
  type TelegramSendReceipt,
  type TelegramTransportConfig,
  type TelegramTransportMode,
  type TelegramWorkItem,
  type TelegramWorkOutcome,
  type TelegramWorkerPort,
} from './telegram.ts';

// Model routing — contract 12 §6.
export {
  MODEL_CONTENT_CLASSES,
  MODEL_ROLES,
  ZERO_DATA_RETENTION_POSTURES,
  type ModelCallTelemetry,
  type ModelContentClass,
  type ModelMessage,
  type ModelRequest,
  type ModelResult,
  type ModelRole,
  type ModelUsage,
  type OpenRouterPort,
  type OpenRouterPortConfig,
  type ProviderPrivacyPolicy,
  type ZeroDataRetentionPosture,
} from './openrouter.ts';

// Backup egress — contract 12 §7.1.
export {
  SNAPSHOT_ENCRYPTION_SCHEMES,
  type DrivePort,
  type DrivePortConfig,
  type EncryptedSnapshotArtifact,
  type SnapshotDigest,
  type SnapshotEncryption,
  type SnapshotEncryptionScheme,
  type SnapshotIntegrityExpectation,
  type SnapshotListQuery,
  type SnapshotListing,
  type SnapshotUploadReceipt,
  type SnapshotVerification,
} from './drive.ts';

// Recovery context — the life tier's connector as this side agrees to see it.
export {
  WHOOP_RECOVERY_BANDS,
  WHOOP_UNAVAILABLE_REASONS,
  type RecoveryBandToLevel,
  type WhoopPort,
  type WhoopPortConfig,
  type WhoopRecoveryBand,
  type WhoopRecoveryOutcome,
  type WhoopRecoveryQuery,
  type WhoopRecoveryState,
  type WhoopUnavailableReason,
} from './whoop.ts';

// The consent bus — contract 12 §4. Note the absence of an update or delete member.
export {
  CONSENT_SCOPES,
  SIGNAL_DIRECTIONS,
  SIGNAL_KINDS,
  SIGNAL_LEVELS,
  SIGNAL_NOTE_MAX_LENGTH,
  SIGNAL_PRODUCERS,
  SIGNAL_REFUSAL_REASONS,
  SIGNAL_TIERS,
  type ConsentScope,
  type SignalBusPort,
  type SignalBusPortConfig,
  type SignalDirection,
  type SignalDraft,
  type SignalEnvelope,
  type SignalKind,
  type SignalLevel,
  type SignalNote,
  type SignalPayload,
  type SignalProducer,
  type SignalQuery,
  type SignalReadOutcome,
  type SignalRefusalReason,
  type SignalTier,
  type StoredSignalReceipt,
} from './signalBus.ts';
