/**
 * NIZAM · Port failure vocabulary — typed shapes, and no thrower
 * Implemented by: PFOS Contract 12 / Phase 2.1 (spec 06-two-agent-vps)
 * Depends on: none
 *
 * `src/server/db/errors.ts` exports error CLASSES because that tier throws them. This
 * directory holds only interfaces (Phase 2.1 ships no implementation; Phase 2.2 ships the
 * mocks), so the failure surface here is the *shape* a caller may discriminate on, and the
 * class that carries it belongs to whichever adapter is doing the failing.
 *
 * The house rule is unchanged: a caller discriminates on `code`, never on a message string
 * that is free to change.
 *
 * Note what {@link PortFailure} deliberately has no field for. Contract 12 §5.2 forbids a
 * rejection that reveals which authenticity check failed; §6.4 forbids prompt or completion
 * text in any error; §4.3 forbids a figure crossing the consent boundary. So there is no
 * `prompt`, no `completion`, no `amount`, and no `failedCheck` field — not an optional one,
 * not a nullable one. A field that does not exist cannot be populated by a future call site
 * that means well.
 */

/** Discriminator for every failure the five ports raise. Grouped by owning port. */
export const PORT_FAILURE_CODES = [
  // Transport — contract 12 §5.2, §5.3, §5.4, §5.5.
  'TELEGRAM_CONFIG_FAILS_CLOSED',
  'TELEGRAM_REQUEST_REJECTED',
  'TELEGRAM_ENQUEUE_FAILED',
  'TELEGRAM_SEND_REFUSED',
  // Model routing — contract 12 §6.1, §6.2, §6.3, §6.4.
  'MODEL_PRIVACY_POLICY_UNSATISFIED',
  'MODEL_NOT_IN_ELIGIBILITY_REGISTRY',
  'MODEL_ELIGIBILITY_REGISTRY_PROVISIONAL',
  'MODEL_WEEKLY_CAP_EXHAUSTED',
  'MODEL_KILL_SWITCH_ENGAGED',
  'MODEL_PROVIDER_UNAVAILABLE',
  'MODEL_RESPONSE_SCHEMA_INVALID',
  // Backup — contract 12 §7.1.
  'BACKUP_GRANT_UNUSABLE',
  'BACKUP_UPLOAD_FAILED',
  'BACKUP_VERIFICATION_SIZE_MISMATCH',
  'BACKUP_VERIFICATION_DIGEST_MISMATCH',
  // Recovery context — the life tier's connector, seen from this side of the bus.
  'RECOVERY_SOURCE_UNAVAILABLE',
  'RECOVERY_STATE_UNINTERPRETABLE',
  // Consent bus — contract 12 §4.2, §4.3, §4.5.
  'SIGNAL_ENVELOPE_INVALID',
  'SIGNAL_PAYLOAD_FIELD_FORBIDDEN',
  'SIGNAL_NOTE_EXCEEDS_CAP',
  'SIGNAL_TIER_NOT_A_MEMBER',
  'SIGNAL_CONSENT_SCOPE_REFUSED',
  'SIGNAL_BUS_UNREACHABLE',
] as const;

export type PortFailureCode = (typeof PORT_FAILURE_CODES)[number];

/**
 * The shape every port failure presents. An adapter throws its own `Error` subclass; the
 * contract between the tiers is this shape and nothing wider.
 *
 * `correlationRef` is a reference, not content: it points at a telemetry row so an operator
 * can find the call without the failure carrying what the call said.
 */
export interface PortFailure extends Error {
  readonly code: PortFailureCode;
  readonly correlationRef: string | null;
}
