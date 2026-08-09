/**
 * NIZAM · Telegram accept path — authenticate, allowlist, de-duplicate, enqueue, acknowledge
 * Implemented by: PFOS Contract 12 / Phase 4.3 (spec 06-two-agent-vps)
 * Owning requirements: R15 (accept fast, process asynchronously);
 *   composes R11/R12/R26 (auth.ts) and R13/R14 (updateDedupRepo.ts)
 * Depends on: ./auth, ./updateDedupRepo, ./workQueueRepo,
 *   ../ports/telegram (TelegramInboundPort — the synchronous contract), ../ports/errors (codes only)
 *
 * Contract 12 §5.5.1: *the handler authenticates, checks the allowlist, de-duplicates, enqueues, and
 * acknowledges. Nothing slow happens before the acknowledgement.*
 *
 * **This module is synchronous, and that is the whole design (§5.5, design key decision 4).** The
 * provider treats a slow response as a FAILED delivery and retries it. A handler that performs a
 * model call inline will exceed the tolerance, be retried, and on the second delivery be protected
 * only by §5.4 — a correct guard being used to paper over an incorrect design. {@link acceptDelivery}
 * returns a {@link TelegramAcceptDecision}, not a promise, so there is nothing to `await` and a slow
 * step cannot be inserted before the acknowledgement without blocking the process outright. Every
 * statement below is a local write against this agent's own store.
 *
 * **The order is §5.5.1's order, and each step is a precondition of the next.**
 *
 *  1. **Authenticity and the allowlist**, delegated whole to {@link authorizeDelivery} — the token
 *     compare is constant-time and the allowlist is checked after it and before any parsing of
 *     content (§5.2, §5.3), and which gates apply comes from the transport configuration's own
 *     mode (R26), so this path is the same path in both modes and neither mode has a branch of its
 *     own here. This module does not re-implement either check and does not soften one.
 *     It passes a three-field subject that omits `rawBody`, so nothing here can parse the body: the
 *     content is carried to the queue as an opaque string and read for the first time by the worker,
 *     after the acknowledgement.
 *  2. **De-duplication**, delegated whole to {@link claimDelivery} — one conflict-ignoring insert
 *     against `PRIMARY KEY (bot_id, update_id)`, where the insert IS the decision (§5.4.2).
 *  3. **The durable enqueue**, delegated to {@link enqueueWork} (§5.5.2).
 *  4. **The acknowledgement**, which is the return value.
 *
 * **Steps 2 and 3 share one transaction, and that is a correctness requirement rather than a
 * tidiness one.** Taken separately, a failure between them marks the pair as seen with no work
 * behind it. The provider's redelivery would then be refused as a duplicate — correctly, per
 * §5.4.4 — and the update would be silently lost forever. Wrapping both in `BEGIN IMMEDIATE`
 * makes "the pair is claimed" and "the work exists" the same fact. A duplicate rolls the
 * transaction back, so a refused delivery writes nothing at all.
 *
 * **A rejection reveals nothing about which check refused (§5.2).** The port's `rejected` variant has
 * no reason field, and this module returns the same frozen value for every refusal. The stage and
 * the code go to the injected audit sink, which §5.3 requires and which is a separate path from the
 * response — and it carries the fact of the rejection, never the message content.
 *
 * **A duplicate is `duplicate`, not an error (§5.4.4).** An error would travel back as a failed
 * delivery and earn another retry of the update we just declined.
 *
 * No literal here names a bot, a sender, a token, a host, or a path (R24).
 */
import type { PortFailureCode } from '../ports/errors';
import type { StoreHandle } from '../db/connection';
import type {
  TelegramAcceptDecision,
  TelegramDelivery,
  TelegramInboundPort,
  TelegramTransportConfig,
} from '../ports/telegram';
import {
  authorizeDelivery,
  authPolicyFromTransport,
  TELEGRAM_AUTH_STAGES,
  type TelegramAuthAuditLine,
  type TelegramAuthStage,
} from './auth';
import { claimDelivery, type UpdateDedupContext } from './updateDedupRepo';
import { enqueueWork, type WorkQueueContext } from './workQueueRepo';

/**
 * The stages a refusal can be audited at: auth's three, plus the durable enqueue.
 *
 * Built from {@link TELEGRAM_AUTH_STAGES} rather than restated, so the vocabulary cannot drift from
 * the module that owns three quarters of it.
 */
export const TELEGRAM_ACCEPT_STAGES = [...TELEGRAM_AUTH_STAGES, 'enqueue'] as const;
export type TelegramAcceptStage = TelegramAuthStage | 'enqueue';

/** The codes the accept path can refuse with. There is no code for "which check failed" (§5.2). */
export type TelegramAcceptFailureCode = Extract<
  PortFailureCode,
  'TELEGRAM_CONFIG_FAILS_CLOSED' | 'TELEGRAM_REQUEST_REJECTED' | 'TELEGRAM_ENQUEUE_FAILED'
>;

/**
 * One audited refusal. The fact of the rejection and nothing else: no token (§5.2), no message
 * content (§5.3), no reason prose. `tokenHeaderPresent` is a boolean, which distinguishes an absent
 * header from an empty one without recording either.
 */
export interface TelegramAcceptAuditLine {
  readonly stage: TelegramAcceptStage;
  readonly code: TelegramAcceptFailureCode;
  readonly botId: string;
  readonly updateId: number;
  readonly senderId: string;
  readonly tokenHeaderPresent: boolean;
}

/** Where an audited refusal goes. Injected, so this module owns no sink and no log. */
export type TelegramAcceptAuditSink = (line: TelegramAcceptAuditLine) => void;

/**
 * The single refused value, shared by every refusal, so two refusals are identical by reference and
 * a per-reason shape is not something a later call site can build by accident (§5.2).
 */
export const TELEGRAM_ACCEPT_REJECTED: TelegramAcceptDecision = Object.freeze({ outcome: 'rejected' as const });

/** The single duplicate value. A no-op with a success acknowledgement (§5.4.4). */
export const TELEGRAM_ACCEPT_DUPLICATE: TelegramAcceptDecision = Object.freeze({ outcome: 'duplicate' as const });

/**
 * What the accept path needs. All of it injected: the transport configuration supplies the token,
 * the allowlist, and the bot identity; the handle, the clock, and the id source come from the store
 * factory. Nothing is defaulted, because a default token would be the open door §5.2 forbids.
 */
export interface TelegramAcceptContext {
  readonly transport: TelegramTransportConfig;
  readonly handle: StoreHandle;
  /** Injected clock returning an ISO-8601 UTC instant. This module reads no wall clock. */
  readonly now: () => string;
  /** Injected id source for the queue reference. No randomness of this module's own. */
  readonly newId: () => string;
  readonly audit?: TelegramAcceptAuditSink;
}

function dedupContextOf(ctx: TelegramAcceptContext): UpdateDedupContext {
  return { handle: ctx.handle, now: ctx.now };
}

function queueContextOf(ctx: TelegramAcceptContext): WorkQueueContext {
  return { handle: ctx.handle, now: ctx.now, newId: ctx.newId };
}

/**
 * **The accept path (§5.5.1).** Synchronous. Five steps, in order, none of them slow.
 *
 * @returns `enqueued` with the durable reference; `duplicate` for a redelivery, having written
 *   nothing; `rejected` for any refusal, with no indication of which one.
 */
export function acceptDelivery(ctx: TelegramAcceptContext, delivery: TelegramDelivery): TelegramAcceptDecision {
  const tokenHeaderPresent = typeof delivery.secretTokenHeader === 'string';
  const auditRefusal = (stage: TelegramAcceptStage, code: TelegramAcceptFailureCode): TelegramAcceptDecision => {
    ctx.audit?.({
      stage,
      code,
      botId: delivery.botId,
      updateId: delivery.updateId,
      senderId: delivery.senderId,
      tokenHeaderPresent,
    });
    return TELEGRAM_ACCEPT_REJECTED;
  };

  // 1. §5.2 then §5.3, delegated whole. The subject omits `rawBody`, so nothing here can parse the
  //    content — the guarantee is structural, not a convention this module has to keep.
  const authRefusals: TelegramAcceptAuditLine[] = [];
  const forwardAuthRefusal = (line: TelegramAuthAuditLine): void => {
    authRefusals.push({
      stage: line.stage,
      code: line.code,
      botId: line.botId,
      updateId: delivery.updateId,
      senderId: line.senderId,
      tokenHeaderPresent: line.tokenHeaderPresent,
    });
  };
  // The mode comes from the transport configuration, never from this module and never from the
  // delivery: which gates apply is a property of how the deployment is reached (R26, D1), and a
  // caller cannot choose a weaker set for a delivery it happens to be holding.
  const authorized = authorizeDelivery(
    { botId: delivery.botId, senderId: delivery.senderId, secretTokenHeader: delivery.secretTokenHeader },
    authPolicyFromTransport(ctx.transport),
    ctx.transport.mode,
    forwardAuthRefusal,
  );
  if (!authorized.authorized) {
    // The stage came from auth's own audit line when it supplied one; a refusal without a line
    // still has to be audited, so it falls back to the token stage rather than going unrecorded.
    const line = authRefusals[0];
    return auditRefusal(line?.stage ?? 'token', line?.code ?? 'TELEGRAM_REQUEST_REJECTED');
  }

  // 2 + 3. One transaction, because "the pair is claimed" and "the work exists" have to be the same
  //        fact. See the module note: separated, a failure between them loses the update for good.
  const { db } = ctx.handle;
  db.exec('BEGIN IMMEDIATE');
  try {
    const claim = claimDelivery(dedupContextOf(ctx), { botId: delivery.botId, updateId: delivery.updateId });
    if (claim.outcome === 'duplicate') {
      // Nothing written, and nothing to write. Success, so the provider stops retrying (§5.4.4).
      db.exec('ROLLBACK');
      return TELEGRAM_ACCEPT_DUPLICATE;
    }

    const enqueued = enqueueWork(queueContextOf(ctx), {
      botId: delivery.botId,
      updateId: delivery.updateId,
      senderId: delivery.senderId,
      rawBody: delivery.rawBody,
    });
    db.exec('COMMIT');

    // 4. The acknowledgement. Everything slow is now the worker's problem (§5.5.4).
    return { outcome: 'enqueued', queuedRef: enqueued.queuedRef };
  } catch {
    try {
      db.exec('ROLLBACK');
    } catch {
      // A failure that already aborted the transaction leaves nothing to roll back.
    }
    // Refusing is the honest answer: acknowledging work that was never durably stored would tell
    // the provider to stop retrying an update this side does not have (§5.5.2).
    return auditRefusal('enqueue', 'TELEGRAM_ENQUEUE_FAILED');
  }
}

/**
 * Bind the accept path to a context, producing the port.
 *
 * The returned object satisfies {@link TelegramInboundPort}, whose `accept` is declared synchronous.
 * A future implementation that wanted to `await` a model call before acknowledging could not satisfy
 * this type, which is the point of the interface being shaped that way (§5.5).
 */
export function createInboundHandler(ctx: TelegramAcceptContext): TelegramInboundPort {
  return {
    accept(delivery: TelegramDelivery): TelegramAcceptDecision {
      return acceptDelivery(ctx, delivery);
    },
  };
}
