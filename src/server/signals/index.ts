/**
 * NIZAM · Signal bus tier barrel
 * Implemented by: PFOS Contract 12 / Phase 3.1 (spec 06-two-agent-vps)
 * Owning requirements: R7 (envelope validation), R8 (consent scope), R10 (exclusion)
 * Also implements: PFOS Contract 12 / Phase 3.2 — the consent gate
 * Depends on: envelopeSchema.ts, envelopeValidation.ts, consentGate.ts
 *
 * `src/server/**` is the VPS-side tier and is never imported by `App.tsx` or the browser
 * router (asserted by AC08b). This barrel exports the vendored schema's vocabulary and the
 * validator that enforces it.
 *
 * Note the absence: nothing here truncates a note, and nothing returns a refused envelope in
 * a usable form. There is no quarantine export, because §4.3.6 forbids the table it would
 * serve.
 */
export {
  DATE_SHAPED_VALUE,
  DIGIT_IN_TEXT,
  DRAFT_ENVELOPE_KEYS,
  ENVELOPE_WIRE_NAMES,
  fieldNameTokens,
  IDENTIFIER_FIELD_TOKENS,
  PERMITTED_PAYLOAD_KEYS,
  SIGNAL_ENVELOPE_SCHEMA_FILE,
  SIGNAL_ENVELOPE_SCHEMA_ID,
  SIGNAL_HASH_ALGORITHM,
  SIGNAL_HASH_PATTERN,
  SIGNAL_ID_MAX_LENGTH,
  STORED_ENVELOPE_KEYS,
  TEMPORAL_FIELD_TOKENS,
  UTC_INSTANT,
} from './envelopeSchema';
export {
  deidentificationBreaches,
  defaultConsentScopeFor,
  DEIDENTIFICATION_CLAIMS,
  effectiveConsentScope,
  evaluateConsentGates,
  gateSignals,
  NARROW_TIERS_READABLE_BY_BOTH,
  scopeGatePasses,
  serveToSubscriber,
  tierGatePasses,
  WIDENED_KINDS,
  type ConsentGateOutcome,
  type ConsentPolicy,
  type ConsentVerdict,
  type DeidentificationBreach,
  type DeidentificationClaim,
  type KindWidening,
  type ReadableTiersBySubscriber,
  type ServedSignalEnvelope,
} from './consentGate';
export {
  portFailureCodeFor,
  sealSignalEnvelope,
  signalEnvelopeHash,
  SIGNAL_VALIDATION_REASONS,
  SignalValidationError,
  unwrapSignalValidation,
  validateForRead,
  validateForWrite,
  validateSignalDraft,
  validateSignalNote,
  type EnvelopeForm,
  type SignalRefusal,
  type SignalValidation,
  type SignalValidationReason,
} from './envelopeValidation';
// Phase 3.3 — the append-only store and its audit mirror. There is no update export and no
// delete export, because there is no update path and no delete path; the refusal lives in the
// engine as a trigger (contract 12 §4.1). The internal-only network binding this store depends
// on is documented in `ops/BUS_NETWORK_BINDING.md` (R9) for Phase 7 to honour.
export {
  appendSignal,
  openSignalStore,
  readAudit,
  readSignals,
  SIGNAL_STORE_FILE_NAME,
  SIGNAL_STORE_MIGRATIONS,
  SignalStoreError,
  storedSignalCount,
  type OpenedSignalStore,
  type SignalAuditLine,
  type SignalStoreContext,
  type SignalStoreOpenConfig,
  type SignalStoreQuery,
  type StoredSignalRecord,
} from './signalStore';
export {
  AUDIT_FORBIDDEN_COLUMNS,
  SIGNAL_AUDIT_EVENTS,
  SIGNAL_SCHEMA_STATEMENTS,
  SIGNAL_STORE_NAME,
  SIGNAL_STORE_TABLES,
  type SignalAuditEvent,
  type SignalStoreTable,
} from './signalStoreSchema';
