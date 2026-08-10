/**
 * NIZAM · update_dedup repository — the insert IS the dedup decision
 * Implemented by: PFOS Contract 12 / Phase 4.2 (spec 06-two-agent-vps)
 * Owning requirements: R13 (a retried delivery has no second side effect),
 *   R14 (dedup state is namespaced per bot, because update identifiers collide)
 * Depends on: ../db/connection (StoreHandle — the single connection factory),
 *   ../ports/telegram (DedupKey — the pair, which is a type-level requirement)
 *
 * Contract 12 §5.4, made mechanical rather than remembered.
 *
 * **The key is the PAIR (§5.4.1, R14).** Namespacing is a CORRECTNESS FIX, not a refinement.
 * Update identifiers are per-bot sequences, so two bots on one host will emit the same
 * identifier for two entirely different updates. A store keyed on the identifier alone would
 * treat the second bot's legitimate update as a duplicate of the first bot's and silently
 * discard it — data loss whose observable symptom is one bot going quiet for no visible
 * reason, which reads as a network problem and is not one. The pair is enforced in three
 * places that cannot disagree: `DedupKey` has two required fields, `update_dedup` declares
 * `PRIMARY KEY (bot_id, update_id)`, and `updateDedupRepo.test.ts` reads the live index back
 * from the engine rather than trusting the DDL text.
 *
 * **The insert is the decision (§5.4.2, §5.4.3).** {@link claimDelivery} performs ONE
 * conflict-ignoring insert and reads the engine's own row count: one row written means this
 * delivery is new, zero means the pair was already there. Nothing is checked first. That is
 * what closes the race a read-then-write scheme leaves open — two concurrent deliveries of
 * the same update can both read "not seen" and both proceed, and a unique index cannot be
 * raced, so exactly one of them writes the row and the other is told it lost.
 *
 * For the same reason this module exports **no "have I seen this" predicate**. A predicate
 * would be the read half of the pattern the contract removed, and the first caller in a hurry
 * would pair it with a conditional insert and re-open the window. There is one door, and
 * walking through it is the decision.
 *
 * **A duplicate is a no-op with a success acknowledgement, not an error (§5.4.4).**
 * {@link claimDelivery} returns `duplicate` and throws nothing. An error would travel back to
 * the provider as a failed delivery and earn another retry of the very update we just
 * declined — a guard that manufactures the load it exists to shed.
 *
 * **The window is never pruned shorter than the redelivery window (§5.4.5, contract 06 §8.2).**
 * {@link pruneDedupBefore} demands both numbers from its caller and refuses when the retention
 * is the shorter of the two, because pruning early re-opens exactly the replay window R13
 * closes. Neither number is a literal here: contract 06 §8.2 keeps retention as
 * `<DEDUP_RETENTION_DAYS>`, and the provider's window is an injected operational fact. Nothing
 * prunes implicitly — not on open, not on claim, not as a side effect of a read (§8.3.2).
 *
 * No bot identifier, sender, token, or update identifier appears here as a literal (R24).
 */
import type { StoreHandle } from '../db/connection.ts';
import type { DedupKey } from '../ports/telegram.ts';

/** Discriminator for every refusal this module raises. A caller matches `code`, never prose. */
export type UpdateDedupErrorCode =
  | 'DEDUP_BOT_ID_EMPTY'
  | 'DEDUP_UPDATE_ID_NOT_INTEGER'
  | 'DEDUP_TIMESTAMP_NOT_UTC_INSTANT'
  | 'DEDUP_RETENTION_INVALID'
  | 'DEDUP_RETENTION_SHORTER_THAN_REDELIVERY_WINDOW';

/**
 * A refusal of a malformed key or an unsafe prune. Deliberately NOT what a duplicate raises:
 * a duplicate is a success (§5.4.4), so it never reaches this class.
 */
export class UpdateDedupError extends Error {
  readonly code: UpdateDedupErrorCode;
  /** The offending field, so a caller can act without parsing the message. */
  readonly field: string;

  constructor(code: UpdateDedupErrorCode, message: string, field: string) {
    super(message);
    this.name = 'UpdateDedupError';
    this.code = code;
    this.field = field;
  }
}

/** What the store needs from its caller: a handle and an injected clock. Nothing ambient. */
export interface UpdateDedupContext {
  readonly handle: StoreHandle;
  /** Injected clock returning an ISO-8601 UTC instant. This module reads no wall clock. */
  readonly now: () => string;
}

/**
 * The outcome of one claim.
 *
 * `firstSeenAt` is always the instant the *winning* claim recorded — for a duplicate that is
 * the earlier delivery's timestamp, read back AFTER the insert had already decided. It is
 * reporting, not input: no branch above depends on it.
 */
export interface DedupClaim {
  readonly outcome: 'new' | 'duplicate';
  readonly key: DedupKey;
  readonly firstSeenAt: string;
}

/** What one prune did, and the boundary it used, so an operator can audit the decision. */
export interface DedupPruneResult {
  readonly prunedRows: number;
  /** Rows first seen strictly before this instant were removed. */
  readonly cutoff: string;
}

/**
 * The retention decision, both halves required. Contract 12 §5.4.5: the dedup window is never
 * pruned shorter than the provider's maximum redelivery window, and the only way to know that
 * is to be told both numbers.
 */
export interface DedupRetentionWindow {
  /** `<DEDUP_RETENTION_DAYS>` (contract 06 §8.2), injected. Whole days. */
  readonly retentionDays: number;
  /** The provider's documented maximum redelivery window, in whole days, injected. */
  readonly providerMaxRedeliveryDays: number;
  /** The instant to measure back from. Injected, never the wall clock. */
  readonly asOf: string;
}

/**
 * ONE statement, and it is the whole decision. `OR IGNORE` turns the unique-index conflict
 * into a row count instead of an exception, so a duplicate never becomes an error (§5.4.4).
 */
const CLAIM_SQL = `
INSERT OR IGNORE INTO update_dedup (bot_id, update_id, first_seen_at)
VALUES (?, ?, ?)
`.trim();

const READ_FIRST_SEEN_SQL = `
SELECT first_seen_at FROM update_dedup WHERE bot_id = ? AND update_id = ?
`.trim();

const PRUNE_SQL = `
DELETE FROM update_dedup WHERE first_seen_at < ?
`.trim();

const MS_PER_DAY = 86_400_000;

/** An unambiguous UTC instant, or a typed refusal. A local-time string would misplace a cutoff. */
function assertUtcInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value))) {
    throw new UpdateDedupError(
      'DEDUP_TIMESTAMP_NOT_UTC_INSTANT',
      `NIZAM update dedup: ${field} must be an unambiguous ISO-8601 UTC instant, got "${String(value)}". A local-time string would place the retention cutoff at the wrong moment.`,
      field,
    );
  }
  return value;
}

/** Both halves of the key, validated before the engine is reached. */
function assertKey(key: DedupKey): void {
  if (typeof key.botId !== 'string' || key.botId.trim() === '') {
    throw new UpdateDedupError(
      'DEDUP_BOT_ID_EMPTY',
      'NIZAM update dedup: a bot identifier is required. Without it the key degrades to the update identifier alone, which two bots share (contract 12 §5.4.1, R14).',
      'botId',
    );
  }
  if (!Number.isSafeInteger(key.updateId)) {
    throw new UpdateDedupError(
      'DEDUP_UPDATE_ID_NOT_INTEGER',
      `NIZAM update dedup: an update identifier must be a safe integer, got "${String(key.updateId)}"`,
      'updateId',
    );
  }
}

/**
 * Claim one delivery. The single write path, and the single dedup decision.
 *
 * @returns `new` when this pair was recorded by this call — the caller may proceed to enqueue.
 *          `duplicate` when the pair was already present — the caller does nothing and
 *          acknowledges success, because an error would earn another retry (§5.4.4).
 * @throws {UpdateDedupError} only for a malformed key. Never for a duplicate.
 */
export function claimDelivery(ctx: UpdateDedupContext, key: DedupKey): DedupClaim {
  assertKey(key);
  const firstSeenAt = assertUtcInstant(ctx.now(), 'firstSeenAt');

  // The decision. No prior read, so there is no window between deciding and recording.
  const written = ctx.handle.db.prepare(CLAIM_SQL).run(key.botId, key.updateId, firstSeenAt);
  const outcome = Number(written.changes) === 1 ? 'new' : 'duplicate';
  if (outcome === 'new') {
    return { outcome, key: { botId: key.botId, updateId: key.updateId }, firstSeenAt };
  }

  // Reporting only, and only on the losing path: the row exists, so the earlier instant is
  // the honest answer to "when was this first seen". Read after the fact, never before it.
  const row = ctx.handle.db.prepare(READ_FIRST_SEEN_SQL).get(key.botId, key.updateId);
  const recorded = (row as { first_seen_at?: unknown } | undefined)?.first_seen_at;
  return {
    outcome,
    key: { botId: key.botId, updateId: key.updateId },
    firstSeenAt: typeof recorded === 'string' ? recorded : firstSeenAt,
  };
}

/**
 * Prune the dedup window. Never runs implicitly — an operator or a scheduled job calls it
 * (contract 06 §8.3.2).
 *
 * @throws {UpdateDedupError} when the retention is shorter than the provider's maximum
 *   redelivery window, because that silently re-opens the replay window R13 closes. The
 *   refusal is the point: a caller cannot ask for the unsafe prune and be quietly obliged.
 */
export function pruneDedupBefore(ctx: UpdateDedupContext, window: DedupRetentionWindow): DedupPruneResult {
  const { retentionDays, providerMaxRedeliveryDays } = window;
  for (const [field, value] of [
    ['retentionDays', retentionDays],
    ['providerMaxRedeliveryDays', providerMaxRedeliveryDays],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new UpdateDedupError(
        'DEDUP_RETENTION_INVALID',
        `NIZAM update dedup: ${field} must be a non-negative whole number of days, got "${String(value)}"`,
        field,
      );
    }
  }
  if (retentionDays < providerMaxRedeliveryDays) {
    throw new UpdateDedupError(
      'DEDUP_RETENTION_SHORTER_THAN_REDELIVERY_WINDOW',
      `NIZAM update dedup: refusing to prune with a ${retentionDays}-day window when the transport may redeliver for up to ${providerMaxRedeliveryDays} days. Pruning early re-opens the replay window R13 closes (contract 12 §5.4.5, contract 06 §8.2).`,
      'retentionDays',
    );
  }

  const asOf = assertUtcInstant(window.asOf, 'asOf');
  const cutoff = new Date(Date.parse(asOf) - retentionDays * MS_PER_DAY).toISOString();
  const removed = ctx.handle.db.prepare(PRUNE_SQL).run(cutoff);
  return { prunedRows: Number(removed.changes), cutoff };
}
