/**
 * NIZAM · work_queue repository — durable work, claimed by a write, completed by a write
 * Implemented by: PFOS Contract 12 / Phase 4.3 (spec 06-two-agent-vps)
 * Owning requirements: R15 (accept fast, process asynchronously)
 * Depends on: ../db/connection (StoreHandle — the single connection factory),
 *   ../ports/telegram (TelegramWorkItem, TelegramWorkOutcome, DedupKey — types only),
 *   ../ports/errors (PortFailureCode — the abandonment vocabulary, type only)
 *
 * Contract 12 §5.5.2 and §5.5.3, made mechanical rather than remembered.
 *
 * **Durability is the reason this module exists at all (§5.5.2).** §5.5.1 acknowledges the
 * delivery before anything slow reads it, which means the moment of the acknowledgement is the
 * moment the update stops being the provider's problem and becomes ours. An in-memory queue would
 * make a restart between the acknowledgement and the processing a silent data loss — the provider
 * believes it delivered, this side has nothing, and no retry is coming because a duplicate is
 * refused by §5.4. So the queue is a table in this agent's own store (contract 06 §3.3), the row
 * lands inside the same transaction as the dedup claim, and `synchronous=FULL` is already asserted
 * on the connection. `reopenSurvival` in the test proves it against a closed and re-opened store
 * rather than trusting the pragma.
 *
 * **Idempotence per item is enforced by three conditional writes, not by a convention (§5.5.3).**
 * A worker can crash mid-item, so every state transition here is a write whose WHERE clause names
 * the state it is leaving, and the engine's row count is the answer:
 *
 *  - {@link enqueueWork} is `INSERT OR IGNORE` against `UNIQUE (bot_id, update_id)`. Entering the
 *    accept path twice for one delivery produces one unit of work, and the second caller is told
 *    it did not write. Same device as §5.4.2, same reason: a unique index cannot be raced, and a
 *    "have I queued this" read can.
 *  - {@link claimNextWork} moves `queued -> running` with `AND state = 'queued'`. Two workers
 *    racing for one row cannot both win, so an item is never in flight twice.
 *  - {@link settleWork} moves `running -> done | queued | failed` with `AND state = 'running'`.
 *    Settling an already-settled item writes nothing and reports `false`, so a worker that crashed
 *    *after* its side effect and *before* its completion write cannot be made to double-count by
 *    the retry that follows.
 *
 * There is deliberately **no "is this item queued" predicate and no unconditional state setter**.
 * Either one would be the read half of the race the conditional writes remove, and the first
 * caller in a hurry would pair them.
 *
 * **A downstream failure never leaves this module as a transport failure (§5.5.4).** The only
 * rescheduling primitive is a `retry` settlement, which writes `not_before` and returns the row to
 * `queued`. There is no code path here that reports a failure to the provider, because
 * {@link TelegramWorkOutcome} has no variant meaning that and this module invents none.
 *
 * No bot identifier, sender, token, endpoint, or update identifier appears here as a literal, and
 * no backoff or retention number is hard-coded: every one is injected (R24, steering §0b).
 */
import type { StoreHandle } from '../db/connection.ts';
import type { PortFailureCode } from '../ports/errors.ts';
import type { DedupKey, TelegramWorkItem, TelegramWorkOutcome } from '../ports/telegram.ts';

/** Discriminator for every refusal this module raises. A caller matches `code`, never prose. */
export type WorkQueueErrorCode =
  | 'WORK_QUEUE_BOT_ID_EMPTY'
  | 'WORK_QUEUE_UPDATE_ID_NOT_INTEGER'
  | 'WORK_QUEUE_SENDER_ID_EMPTY'
  | 'WORK_QUEUE_TIMESTAMP_NOT_UTC_INSTANT'
  | 'WORK_QUEUE_LIMIT_INVALID'
  | 'WORK_QUEUE_BACKOFF_INVALID'
  | 'WORK_QUEUE_RETENTION_INVALID';

/** A refusal of malformed work or an unsafe parameter. Never what a lost race raises. */
export class WorkQueueError extends Error {
  readonly code: WorkQueueErrorCode;
  /** The offending field, so a caller can act without parsing the message. */
  readonly field: string;

  constructor(code: WorkQueueErrorCode, message: string, field: string) {
    super(message);
    this.name = 'WorkQueueError';
    this.code = code;
    this.field = field;
  }
}

/** What the queue needs from its caller: a handle, an injected clock, an injected id source. */
export interface WorkQueueContext {
  readonly handle: StoreHandle;
  /** Injected clock returning an ISO-8601 UTC instant. This module reads no wall clock. */
  readonly now: () => string;
  /** Injected id source for the queue reference. No randomness of this module's own. */
  readonly newId: () => string;
}

/** The durable states `work_queue.state` may hold, exactly as migration 003 constrains them. */
export const WORK_QUEUE_STATES = ['queued', 'running', 'done', 'failed'] as const;
export type WorkQueueState = (typeof WORK_QUEUE_STATES)[number];

/** The payload that has to survive the acknowledgement, because nothing has read it yet. */
export interface WorkQueueSubmission extends DedupKey {
  readonly senderId: string;
  readonly rawBody: string;
}

/**
 * The outcome of one enqueue.
 *
 * `inserted` is `false` when `UNIQUE (bot_id, update_id)` already held a row — the same delivery,
 * already durable. The reference returned is then the existing row's, so a caller acknowledges the
 * work that exists rather than minting a second unit of it (§5.5.3).
 */
export interface WorkQueueEnqueueResult {
  readonly queuedRef: string;
  readonly inserted: boolean;
}

/**
 * Why an item was abandoned, for the `last_error` column.
 *
 * A {@link PortFailureCode} when the worker itself decided to abandon; the constant below when the
 * attempt ceiling was reached. It is a code, never a message and never content (§6.4).
 */
export const WORK_ATTEMPTS_EXHAUSTED = 'WORK_ATTEMPTS_EXHAUSTED';
export type WorkAbandonReason = PortFailureCode | typeof WORK_ATTEMPTS_EXHAUSTED;

/** The injected retry policy. Nothing here is a literal: §5.5.4 leaves the numbers to operations. */
export interface WorkRetryPolicy {
  /** First backoff, in whole milliseconds. */
  readonly baseMs: number;
  /** The ceiling the doubling is clamped to, in whole milliseconds. */
  readonly maxMs: number;
  /** Attempts after which a repeatedly failing item is abandoned rather than retried forever. */
  readonly maxAttempts: number;
}

const ENQUEUE_SQL = `
INSERT OR IGNORE INTO work_queue (id, bot_id, update_id, sender_id, raw_body, enqueued_at, state, attempts)
VALUES (?, ?, ?, ?, ?, ?, 'queued', 0)
`.trim();

const READ_REF_SQL = `
SELECT id FROM work_queue WHERE bot_id = ? AND update_id = ?
`.trim();

/**
 * The claimable set: queued, and either unscheduled or past its backoff instant. Oldest first, so a
 * retried item does not starve a fresh one indefinitely.
 */
const NEXT_CLAIMABLE_SQL = `
SELECT id FROM work_queue
WHERE state = 'queued' AND (not_before IS NULL OR not_before <= ?)
ORDER BY enqueued_at, id
LIMIT ?
`.trim();

/** The claim. `AND state = 'queued'` is what makes the row count the answer to who won. */
const CLAIM_SQL = `
UPDATE work_queue
SET state = 'running', started_at = ?, attempts = attempts + 1, not_before = NULL
WHERE id = ? AND state = 'queued'
`.trim();

const READ_ITEM_SQL = `
SELECT id, bot_id, update_id, sender_id, raw_body, enqueued_at, attempts
FROM work_queue WHERE id = ?
`.trim();

const SETTLE_DONE_SQL = `
UPDATE work_queue SET state = 'done', completed_at = ?, last_error = NULL
WHERE id = ? AND state = 'running'
`.trim();

const SETTLE_RETRY_SQL = `
UPDATE work_queue SET state = 'queued', not_before = ?, started_at = NULL
WHERE id = ? AND state = 'running'
`.trim();

const SETTLE_FAILED_SQL = `
UPDATE work_queue SET state = 'failed', completed_at = ?, last_error = ?
WHERE id = ? AND state = 'running'
`.trim();

/** A crash leaves a row `running` forever. This is the only way out, and it is explicit. */
const RECLAIM_STALLED_SQL = `
UPDATE work_queue SET state = 'queued', started_at = NULL, not_before = NULL
WHERE state = 'running' AND started_at IS NOT NULL AND started_at < ?
`.trim();

const PRUNE_SETTLED_SQL = `
DELETE FROM work_queue
WHERE state IN ('done', 'failed') AND completed_at IS NOT NULL AND completed_at < ?
`.trim();

const COUNT_BY_STATE_SQL = `
SELECT state, COUNT(*) AS n FROM work_queue GROUP BY state
`.trim();

const MS_PER_HOUR = 3_600_000;

/** An unambiguous UTC instant, or a typed refusal. A local-time string would misplace a cutoff. */
function assertUtcInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value))) {
    throw new WorkQueueError(
      'WORK_QUEUE_TIMESTAMP_NOT_UTC_INSTANT',
      `NIZAM work queue: ${field} must be an unambiguous ISO-8601 UTC instant, got "${String(value)}". A local-time string would schedule a retry at the wrong moment.`,
      field,
    );
  }
  return value;
}

/** Validate the submission before the engine is reached. The body is checked for nothing: it is untrusted data, not an instruction (§6.4). */
function assertSubmission(submission: WorkQueueSubmission): void {
  if (typeof submission.botId !== 'string' || submission.botId.trim() === '') {
    throw new WorkQueueError(
      'WORK_QUEUE_BOT_ID_EMPTY',
      'NIZAM work queue: a bot identifier is required. Without it the delivery index degrades to the update identifier alone, which two bots share (contract 12 §5.4.1, R14).',
      'botId',
    );
  }
  if (!Number.isSafeInteger(submission.updateId)) {
    throw new WorkQueueError(
      'WORK_QUEUE_UPDATE_ID_NOT_INTEGER',
      `NIZAM work queue: an update identifier must be a safe integer, got "${String(submission.updateId)}"`,
      'updateId',
    );
  }
  if (typeof submission.senderId !== 'string' || submission.senderId.trim() === '') {
    throw new WorkQueueError(
      'WORK_QUEUE_SENDER_ID_EMPTY',
      'NIZAM work queue: a sender identifier is required. The allowlist decision (§5.3) is only meaningful if the sender it granted is the sender the worker later acts for.',
      'senderId',
    );
  }
}

function assertPositiveInteger(value: unknown, field: string, code: WorkQueueErrorCode): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new WorkQueueError(code, `NIZAM work queue: ${field} must be a positive whole number, got "${String(value)}"`, field);
  }
  return value as number;
}

/**
 * Durably record one unit of work.
 *
 * Called from inside the accept path's transaction, so the dedup claim and this row commit or roll
 * back together: a pair marked seen with no work behind it would be an update that is refused as a
 * duplicate on redelivery and never processed (§5.4.4 + §5.5.2 together).
 *
 * @throws {WorkQueueError} only for a malformed submission. Never for an already-queued delivery.
 */
export function enqueueWork(ctx: WorkQueueContext, submission: WorkQueueSubmission): WorkQueueEnqueueResult {
  assertSubmission(submission);
  const enqueuedAt = assertUtcInstant(ctx.now(), 'enqueuedAt');
  const candidateRef = ctx.newId();

  const written = ctx.handle.db
    .prepare(ENQUEUE_SQL)
    .run(candidateRef, submission.botId, submission.updateId, submission.senderId, submission.rawBody, enqueuedAt);
  if (Number(written.changes) === 1) {
    return { queuedRef: candidateRef, inserted: true };
  }

  // The unique delivery index already held a row, so the existing reference is the honest answer:
  // acknowledge the work that exists rather than mint a second unit of it.
  const row = ctx.handle.db.prepare(READ_REF_SQL).get(submission.botId, submission.updateId);
  const existing = (row as { id?: unknown } | undefined)?.id;
  return { queuedRef: typeof existing === 'string' ? existing : candidateRef, inserted: false };
}

function rowToItem(row: unknown): TelegramWorkItem | null {
  const r = row as
    | { id?: unknown; bot_id?: unknown; update_id?: unknown; sender_id?: unknown; raw_body?: unknown; enqueued_at?: unknown; attempts?: unknown }
    | undefined;
  if (!r || typeof r.id !== 'string') return null;
  return {
    queuedRef: r.id,
    botId: String(r.bot_id),
    updateId: Number(r.update_id),
    senderId: String(r.sender_id),
    rawBody: String(r.raw_body),
    enqueuedAt: String(r.enqueued_at),
    attempt: Number(r.attempts),
  };
}

/**
 * Claim up to `limit` claimable items, moving each `queued -> running`.
 *
 * Bounded by construction: the caller cannot ask for more than it is willing to run at once, which
 * is how §5.5.5's bounded concurrency is expressed at the store rather than trusted in a loop. A
 * candidate whose conditional update writes zero rows was taken by another worker and is silently
 * skipped rather than retried, because losing that race is the correct outcome, not a failure.
 *
 * `attempt` on the returned item is the number of THIS attempt, read back after the increment, so a
 * worker computing a backoff is reasoning about the attempt it is actually performing.
 */
export function claimNextWork(ctx: WorkQueueContext, limit: number): readonly TelegramWorkItem[] {
  const bound = assertPositiveInteger(limit, 'limit', 'WORK_QUEUE_LIMIT_INVALID');
  const asOf = assertUtcInstant(ctx.now(), 'asOf');

  const candidates = ctx.handle.db.prepare(NEXT_CLAIMABLE_SQL).all(asOf, bound);
  const claimed: TelegramWorkItem[] = [];
  for (const candidate of candidates) {
    const id = (candidate as { id?: unknown }).id;
    if (typeof id !== 'string') continue;
    const won = ctx.handle.db.prepare(CLAIM_SQL).run(asOf, id);
    if (Number(won.changes) !== 1) continue;
    const item = rowToItem(ctx.handle.db.prepare(READ_ITEM_SQL).get(id));
    if (item) claimed.push(item);
  }
  return claimed;
}

/** Deterministic exponential backoff, clamped. Pure, so a test asserts the schedule without a clock. */
export function retryNotBefore(policy: WorkRetryPolicy, attempt: number, asOf: string): string {
  assertPositiveInteger(policy.baseMs, 'baseMs', 'WORK_QUEUE_BACKOFF_INVALID');
  assertPositiveInteger(policy.maxMs, 'maxMs', 'WORK_QUEUE_BACKOFF_INVALID');
  assertPositiveInteger(policy.maxAttempts, 'maxAttempts', 'WORK_QUEUE_BACKOFF_INVALID');
  const at = assertUtcInstant(asOf, 'asOf');
  const exponent = Math.max(0, Math.min(attempt, 30) - 1);
  const delay = Math.min(policy.baseMs * 2 ** exponent, policy.maxMs);
  return new Date(Date.parse(at) + delay).toISOString();
}

/** What one settlement did. `false` means the row was not `running`, so nothing was written. */
export interface WorkSettlement {
  readonly settled: boolean;
  readonly state: WorkQueueState;
}

/**
 * Settle one claimed item against the worker's outcome.
 *
 * Every branch is conditional on `state = 'running'`, which is what makes a repeated settlement a
 * no-op (§5.5.3): a worker that crashed after its side effect and before this write is reclaimed,
 * re-runs, and settles once — and a duplicated settlement call cannot advance the row twice.
 *
 * `retry` returns the row to `queued` with a backoff instant. That is the whole of §5.5.4: the
 * failure is rescheduled inside the queue, and there is no branch here that reports it outward.
 */
export function settleWork(
  ctx: WorkQueueContext,
  queuedRef: string,
  outcome: TelegramWorkOutcome,
): WorkSettlement {
  const at = assertUtcInstant(ctx.now(), 'settledAt');
  if (outcome.outcome === 'done') {
    const written = ctx.handle.db.prepare(SETTLE_DONE_SQL).run(at, queuedRef);
    return { settled: Number(written.changes) === 1, state: 'done' };
  }
  if (outcome.outcome === 'retry') {
    const notBefore = assertUtcInstant(outcome.notBefore, 'notBefore');
    const written = ctx.handle.db.prepare(SETTLE_RETRY_SQL).run(notBefore, queuedRef);
    return { settled: Number(written.changes) === 1, state: 'queued' };
  }
  const written = ctx.handle.db.prepare(SETTLE_FAILED_SQL).run(at, outcome.code, queuedRef);
  return { settled: Number(written.changes) === 1, state: 'failed' };
}

/** Abandon a claimed item with a reason code that is not a port failure — the attempt ceiling. */
export function abandonExhaustedWork(ctx: WorkQueueContext, queuedRef: string, reason: WorkAbandonReason): WorkSettlement {
  const at = assertUtcInstant(ctx.now(), 'settledAt');
  const written = ctx.handle.db.prepare(SETTLE_FAILED_SQL).run(at, reason, queuedRef);
  return { settled: Number(written.changes) === 1, state: 'failed' };
}

/**
 * Return items stuck in `running` to the claimable set.
 *
 * §5.5.3's premise is that a worker can crash mid-item. A crashed worker leaves its row `running`
 * with nobody holding it, and without this the item is durable and permanently unreachable — the
 * worst of both. `stallAfterMs` is injected because how long a legitimate item may run is an
 * operational fact, not something this module may assume.
 */
export function reclaimStalledWork(ctx: WorkQueueContext, stallAfterMs: number): number {
  const stall = assertPositiveInteger(stallAfterMs, 'stallAfterMs', 'WORK_QUEUE_BACKOFF_INVALID');
  const asOf = assertUtcInstant(ctx.now(), 'asOf');
  const cutoff = new Date(Date.parse(asOf) - stall).toISOString();
  const written = ctx.handle.db.prepare(RECLAIM_STALLED_SQL).run(cutoff);
  return Number(written.changes);
}

/** What one prune did, and the boundary it used, so an operator can audit the decision. */
export interface WorkQueuePruneResult {
  readonly prunedRows: number;
  readonly cutoff: string;
}

/**
 * Prune settled items. Contract 06 §8.2 keeps the window as `<WORK_QUEUE_RETENTION_HOURS>`, so the
 * number is injected and never a literal here. Only `done` and `failed` rows are eligible: pruning a
 * `queued` or `running` row would be discarding work, which is the loss §5.5.2 exists to prevent.
 *
 * Never runs implicitly — not on open, not on claim, not as a side effect of a read (§8.3.2).
 */
export function pruneSettledWork(ctx: WorkQueueContext, retentionHours: number, asOf: string): WorkQueuePruneResult {
  if (!Number.isSafeInteger(retentionHours) || retentionHours < 0) {
    throw new WorkQueueError(
      'WORK_QUEUE_RETENTION_INVALID',
      `NIZAM work queue: retentionHours must be a non-negative whole number, got "${String(retentionHours)}"`,
      'retentionHours',
    );
  }
  const at = assertUtcInstant(asOf, 'asOf');
  const cutoff = new Date(Date.parse(at) - retentionHours * MS_PER_HOUR).toISOString();
  const removed = ctx.handle.db.prepare(PRUNE_SETTLED_SQL).run(cutoff);
  return { prunedRows: Number(removed.changes), cutoff };
}

/** Row counts per state, for a health probe and for tests. Reads nothing and prunes nothing. */
export function workQueueDepth(ctx: WorkQueueContext): Readonly<Record<WorkQueueState, number>> {
  const depth: Record<WorkQueueState, number> = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const row of ctx.handle.db.prepare(COUNT_BY_STATE_SQL).all()) {
    const r = row as { state?: unknown; n?: unknown };
    const state = String(r.state) as WorkQueueState;
    if (state in depth) depth[state] = Number(r.n);
  }
  return depth;
}
