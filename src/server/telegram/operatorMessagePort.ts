/**
 * NIZAM · Authenticated operator message port and durable queue adapter
 * Owning contract: PFOS Contract 12 — Two-Agent VPS Deployment & Operations; UPOI task 5.1
 * Phase: Phase 5.1 authenticated operator intake and durable queue composition
 * Owning requirements: 1.1, 1.2, 1.3; Design Sections 6.4, 9.1, 20
 * Depends on: existing Telegram accept path, work queue repository, and redacted logger
 *
 * This is a composition boundary, not a second transport or queue implementation. The accept
 * operation delegates to acceptDelivery, which performs authentication, the bot-scoped atomic
 * dedup claim, and durable enqueue in one transaction before returning its acknowledgement.
 * Queue operations delegate to workQueueRepo, whose conditional writes provide atomic claims,
 * bounded leases/reclaim, retry backoff, and idempotent settlement.
 *
 * The public refusal deliberately carries one generic code. Audit output is emitted only through
 * the injected structured logger and contains outcome vocabulary, never body, sender, bot, token,
 * chat, endpoint, or webhook details. All values in this module are synthetic-safe references or
 * closed enums; no live provider is resolved here.
 */
import type { StoreHandle } from '../db/connection.ts';
import type { RedactedLogger } from '../ops/redactedLogger.ts';
import type {
  TelegramDelivery,
  TelegramTransportConfig,
  TelegramWorkItem,
  TelegramWorkOutcome,
} from '../ports/telegram.ts';
import {
  acceptDelivery,
  type TelegramAcceptContext,
} from './acceptHandler.ts';
import {
  claimNextWork,
  enqueueWork,
  reclaimStalledWork,
  retryNotBefore,
  settleWork,
  type WorkQueueContext,
  type WorkQueueEnqueueResult,
  type WorkQueueSubmission,
  type WorkRetryPolicy,
  type WorkSettlement,
} from './workQueueRepo.ts';

/** One public refusal shape for authentication, allowlist, and queue failures. */
export const OPERATOR_DELIVERY_REFUSED = 'OPERATOR_DELIVERY_REFUSED' as const;
export type OperatorRefusalCode = typeof OPERATOR_DELIVERY_REFUSED;

/** A duplicate is a successful no-op and therefore has no refusal code. */
export type OperatorAcceptDecision =
  | { readonly outcome: 'enqueued'; readonly queuedRef: string }
  | { readonly outcome: 'duplicate' }
  | { readonly outcome: 'rejected'; readonly code: OperatorRefusalCode };

/** The bounded queue surface available to the asynchronous worker. */
export interface DurableOperatorQueueAdapter {
  enqueue(submission: WorkQueueSubmission): WorkQueueEnqueueResult;
  claim(limit: number): readonly TelegramWorkItem[];
  settle(queuedRef: string, outcome: TelegramWorkOutcome): WorkSettlement;
  /** Return running items older than the supplied lease to the claimable set. */
  reclaimExpired(leaseMs: number): number;
  /** Compute a retry instant using the injected policy and queue clock. */
  retryAt(policy: WorkRetryPolicy, attempt: number): string;
}

/** The authenticated operator port and its durable asynchronous queue. */
export interface OperatorMessagePort {
  accept(delivery: TelegramDelivery): OperatorAcceptDecision;
  readonly queue: DurableOperatorQueueAdapter;
}

export interface OperatorMessagePortContext {
  readonly transport: TelegramTransportConfig;
  readonly handle: StoreHandle;
  readonly now: () => string;
  readonly newId: () => string;
  /** Structured logger is injected so this module cannot acquire an ambient sink. */
  readonly logger: RedactedLogger;
}

function queueContextOf(ctx: OperatorMessagePortContext): WorkQueueContext {
  return { handle: ctx.handle, now: ctx.now, newId: ctx.newId };
}

/**
 * Create the durable queue adapter over the existing queue repository.
 *
 * `claim` is a conditional store write, not an in-memory reservation. `reclaimExpired` is explicit
 * and requires a positive lease, so a caller cannot accidentally create an unbounded lease or
 * reclaim fresh work. Retry timing remains the repository's injected, deterministic policy.
 */
export function createDurableOperatorQueueAdapter(ctx: OperatorMessagePortContext): DurableOperatorQueueAdapter {
  const queue = queueContextOf(ctx);
  return {
    enqueue(submission): WorkQueueEnqueueResult {
      return enqueueWork(queue, submission);
    },
    claim(limit): readonly TelegramWorkItem[] {
      return claimNextWork(queue, limit);
    },
    settle(queuedRef, outcome): WorkSettlement {
      return settleWork(queue, queuedRef, outcome);
    },
    reclaimExpired(leaseMs): number {
      return reclaimStalledWork(queue, leaseMs);
    },
    retryAt(policy, attempt): string {
      return retryNotBefore(policy, attempt, ctx.now());
    },
  };
}

function logAccepted(logger: RedactedLogger, outcome: 'accepted' | 'duplicate'): void {
  logger.log('info', outcome === 'duplicate' ? 'update_duplicate_ignored' : 'update_accepted', {
    dedupOutcome: { kind: 'enum', value: outcome === 'duplicate' ? 'duplicate' : 'new' },
    outcome: { kind: 'enum', value: outcome },
  });
}

function logRefused(logger: RedactedLogger): void {
  logger.log('warn', 'update_accepted', {
    dedupOutcome: { kind: 'enum', value: 'refused' },
    outcome: { kind: 'enum', value: 'operator_refused' },
  });
}

/**
 * Compose the authenticated synchronous accept path with the durable queue adapter.
 *
 * No body is parsed here. The existing handler passes only an authentication projection to the
 * authorizer, then claims and enqueues inside one transaction. Returning from this method is the
 * acknowledgement boundary; the worker must use `port.queue` afterwards.
 */
export function createOperatorMessagePort(ctx: OperatorMessagePortContext): OperatorMessagePort {
  const queue = createDurableOperatorQueueAdapter(ctx);
  const acceptContext: TelegramAcceptContext = {
    transport: ctx.transport,
    handle: ctx.handle,
    now: ctx.now,
    newId: ctx.newId,
  };

  return {
    queue,
    accept(delivery): OperatorAcceptDecision {
      // The port owns one bot namespace. A delivery routed to another namespace is refused before
      // deduplication, so a caller cannot turn an untrusted bot field into a cross-bot claim.
      if (delivery.botId !== ctx.transport.botId) {
        logRefused(ctx.logger);
        return { outcome: 'rejected', code: OPERATOR_DELIVERY_REFUSED };
      }
      const decision = acceptDelivery(acceptContext, delivery);
      if (decision.outcome === 'enqueued') {
        logAccepted(ctx.logger, 'accepted');
        return decision;
      }
      if (decision.outcome === 'duplicate') {
        logAccepted(ctx.logger, 'duplicate');
        return decision;
      }
      logRefused(ctx.logger);
      return { outcome: 'rejected', code: OPERATOR_DELIVERY_REFUSED };
    },
  };
}
