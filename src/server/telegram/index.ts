/**
 * NIZAM · Telegram transport barrel — contract 12 §5
 * Implemented by: PFOS Contract 12 / Phase 4.1-4.3 (spec 06-two-agent-vps)
 * Depends on: auth.ts, updateDedupRepo.ts, workQueueRepo.ts, acceptHandler.ts, workerRunner.ts
 *
 * One import site for the transport modules. ADDITIVE ONLY: a later phase appends its
 * exports here and never rewrites an existing line, because the modules in this directory
 * land in separate increments (4.1 auth, 4.2 dedup, 4.3 the accept/process handler).
 *
 * `src/server/**` is the VPS-side tier and is NEVER imported by `App.tsx` or the browser
 * router. The interfaces these modules implement live in `../ports/telegram.ts`.
 */
// Phase 4.2 — dedup keyed on the PAIR, where the conflict-ignoring insert IS the decision.
// There is deliberately no "have I seen this" export: a predicate would be the read half of
// the read-then-write race the unique index removes (contract 12 §5.4.2, §5.4.3).
export {
  claimDelivery,
  pruneDedupBefore,
  UpdateDedupError,
  type DedupClaim,
  type DedupPruneResult,
  type DedupRetentionWindow,
  type UpdateDedupContext,
  type UpdateDedupErrorCode,
} from './updateDedupRepo';
// Phase 4.1 — the two authenticity checks, in §5.3's order. There is deliberately no export
// that reports WHICH check refused: the decision type has no reason field (§5.2), and the stage
// vocabulary belongs to the separate audit path a caller injects.
export {
  authorizeDelivery,
  authPolicyFromTransport,
  constantTimeTokenEquals,
  equalizedTokenDigest,
  secretTokenIsConfigured,
  senderIsAllowlisted,
  TELEGRAM_AUTH_GRANTED,
  TELEGRAM_AUTH_REFUSED,
  TELEGRAM_AUTH_STAGES,
  TELEGRAM_AUTH_SUBJECT_KEYS,
  TELEGRAM_SECRET_TOKEN_HEADER,
  TELEGRAM_SECRET_TOKEN_MAX_LENGTH,
  TELEGRAM_SECRET_TOKEN_PATTERN,
  TOKEN_DIGEST_ALGORITHM,
  TOKEN_DIGEST_BYTES,
  TOKEN_DIGEST_KEY_BYTES,
  type TelegramAuthAuditLine,
  type TelegramAuthAuditSink,
  type TelegramAuthDecision,
  type TelegramAuthPolicy,
  type TelegramAuthStage,
  type TelegramAuthSubject,
} from './auth';
// Phase 4.3 — the durable queue the accept path writes into and the worker drains (§5.5.2).
// There is deliberately no "is this queued" predicate and no unconditional state setter: either
// would be the read half of the race the conditional writes remove (§5.5.3).
export {
  abandonExhaustedWork,
  claimNextWork,
  enqueueWork,
  pruneSettledWork,
  reclaimStalledWork,
  retryNotBefore,
  settleWork,
  WORK_ATTEMPTS_EXHAUSTED,
  WORK_QUEUE_STATES,
  workQueueDepth,
  WorkQueueError,
  type WorkAbandonReason,
  type WorkQueueContext,
  type WorkQueueEnqueueResult,
  type WorkQueueErrorCode,
  type WorkQueuePruneResult,
  type WorkQueueState,
  type WorkQueueSubmission,
  type WorkRetryPolicy,
  type WorkSettlement,
} from './workQueueRepo';
// Phase 4.3 — the SYNCHRONOUS accept path (§5.5.1). It returns a decision rather than a promise,
// so nothing slow can be written before the acknowledgement.
export {
  acceptDelivery,
  createInboundHandler,
  TELEGRAM_ACCEPT_DUPLICATE,
  TELEGRAM_ACCEPT_REJECTED,
  TELEGRAM_ACCEPT_STAGES,
  type TelegramAcceptAuditLine,
  type TelegramAcceptAuditSink,
  type TelegramAcceptContext,
  type TelegramAcceptFailureCode,
  type TelegramAcceptStage,
} from './acceptHandler';
// Phase 4.3 — the ASYNCHRONOUS side, where every slow step lives and where a downstream failure
// stays: it becomes a queue retry with backoff, never a transport failure (§5.5.4).
export {
  createWorkerRunner,
  drainWorkQueue,
  type WorkerDrainReport,
  type WorkerFailureLine,
  type WorkerFailureSink,
  type WorkerRunContext,
  type WorkerRunner,
} from './workerRunner';
