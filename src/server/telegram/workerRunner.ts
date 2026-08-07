/**
 * NIZAM · Telegram worker runner — where the slow work lives, and where its failures stay
 * Implemented by: PFOS Contract 12 / Phase 4.3 (spec 06-two-agent-vps)
 * Owning requirements: R15 (accept fast, process asynchronously)
 * Depends on: ./workQueueRepo, ../ports/telegram (TelegramWorkerPort — the async contract),
 *   ../ports/errors (PortFailureCode — type only)
 *
 * The other half of §5.5. {@link acceptDelivery} acknowledged the delivery and wrote a durable row;
 * this module drains those rows, and every expensive thing the agent does — the model call, the
 * network call, the reply — happens on this side of the acknowledgement.
 *
 * **A downstream failure never becomes a transport failure (§5.5.4).** This is the invariant the
 * module is built around, and it is enforced two ways at once:
 *
 *  - {@link drainWorkQueue} **does not reject and does not throw** for a downstream failure. If the
 *    injected {@link TelegramWorkerPort.process} throws — a provider outage, a socket reset, a
 *    malformed response — the throw is caught here and turned into a `retry` settlement with a
 *    backoff instant. It is rescheduled inside the queue. There is no path by which it reaches the
 *    caller of the webhook handler, because by the time this runs the webhook call has already
 *    returned.
 *  - {@link TelegramWorkOutcome} has no variant meaning "tell the provider it failed", and this
 *    module invents none. The three outcomes map to three queue states and nothing else.
 *
 * **Concurrency is bounded, and the bound is proved rather than asserted (§5.5.5).** A single-operator
 * system needs very little, so `maxConcurrentWorkItems` from {@link TelegramTransportConfig} is a
 * ceiling on lanes, not a batch size: exactly that many lanes run, each claiming ONE item at a time
 * until nothing is claimable. {@link WorkerDrainReport.peakInFlight} is the observed maximum, which
 * a test compares against the configured ceiling — a batch-shaped implementation would satisfy an
 * assertion about the batch size while still running an unbounded number of items per pass.
 *
 * **Processing is idempotent per item (§5.5.3).** Nothing here re-runs an item it has settled: the
 * claim is a conditional write that only one lane can win, and the settlement is a conditional write
 * that only fires against a `running` row. A worker that crashes mid-item leaves the row `running`
 * until {@link reclaimStalledWork} returns it, so the item is neither lost nor silently duplicated.
 *
 * **The attempt ceiling exists so a permanent failure is not a permanent retry.** §5.5.4 asks for
 * retry with backoff, which alone would loop forever against a downstream that is never coming back.
 * `maxAttempts` is injected; on reaching it the item is abandoned with a reason code, which is a
 * queue outcome and still not a transport one.
 *
 * No prompt text, no completion text, and no message content is recorded by this module (§6.4, R19):
 * a failure line carries a code and a queue reference, both of which are pointers.
 */
import type { PortFailureCode } from '../ports/errors';
import type { TelegramWorkerPort, TelegramWorkItem, TelegramWorkOutcome } from '../ports/telegram';
import {
  abandonExhaustedWork,
  claimNextWork,
  retryNotBefore,
  settleWork,
  WORK_ATTEMPTS_EXHAUSTED,
  WorkQueueError,
  type WorkAbandonReason,
  type WorkQueueContext,
  type WorkRetryPolicy,
} from './workQueueRepo';

/**
 * One recorded downstream failure. A code and a reference, never content (§6.4).
 *
 * `code` is `null` when the thrown value carried no recognisable port failure code, because
 * inventing one would be a claim about a cause this module cannot see.
 */
export interface WorkerFailureLine {
  readonly queuedRef: string;
  readonly attempt: number;
  readonly code: PortFailureCode | null;
  /** `retry` when it will be attempted again; `abandoned` when the ceiling was reached. */
  readonly disposition: 'retry' | 'abandoned';
}

/** Where a recorded failure goes. Injected, so this module owns no sink and no log. */
export type WorkerFailureSink = (line: WorkerFailureLine) => void;

/** What the runner needs. Every number injected; nothing is defaulted and nothing is a literal. */
export interface WorkerRunContext {
  readonly queue: WorkQueueContext;
  /** The async side of the port. Supplied by the caller: a mock now, a live adapter after G3/G6. */
  readonly worker: TelegramWorkerPort;
  /** §5.5.5's ceiling, from `TelegramTransportConfig.maxConcurrentWorkItems`. Lanes, not a batch. */
  readonly maxConcurrentWorkItems: number;
  readonly retry: WorkRetryPolicy;
  readonly onFailure?: WorkerFailureSink;
}

/** What one drain did. Every count is an observation, so a test asserts behaviour, not intent. */
export interface WorkerDrainReport {
  readonly claimed: number;
  readonly done: number;
  readonly retried: number;
  readonly abandoned: number;
  /** The largest number of items in flight at once. Compared against the configured ceiling. */
  readonly peakInFlight: number;
  /** Downstream failures observed, in the order they occurred. Codes and references only. */
  readonly failures: readonly WorkerFailureLine[];
}

/** Read a port failure code off an unknown thrown value without trusting its shape. */
function thrownFailureCode(cause: unknown): PortFailureCode | null {
  const code = (cause as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? (code as PortFailureCode) : null;
}

/**
 * Drain the queue with a bounded pool of lanes.
 *
 * Resolves with a report. It rejects only if the STORE itself refuses — a malformed injected policy
 * or an unusable handle — because that is this side's own defect and not a downstream failure. A
 * downstream failure is never a rejection: see the module note.
 */
export async function drainWorkQueue(ctx: WorkerRunContext): Promise<WorkerDrainReport> {
  const lanes = ctx.maxConcurrentWorkItems;
  if (!Number.isSafeInteger(lanes) || lanes < 1) {
    throw new WorkQueueError(
      'WORK_QUEUE_LIMIT_INVALID',
      `NIZAM telegram worker: maxConcurrentWorkItems must be a positive whole number, got "${String(lanes)}". §5.5.5 requires the concurrency to be bounded, and an unbounded default would be the opposite.`,
      'maxConcurrentWorkItems',
    );
  }

  let claimed = 0;
  let done = 0;
  let retried = 0;
  let abandoned = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  const failures: WorkerFailureLine[] = [];

  const recordFailure = (line: WorkerFailureLine): void => {
    failures.push(line);
    ctx.onFailure?.(line);
  };

  /** Turn one downstream throw into a queue outcome. Never into a transport failure (§5.5.4). */
  const settleThrown = (item: TelegramWorkItem, cause: unknown): void => {
    const code = thrownFailureCode(cause);
    if (item.attempt >= ctx.retry.maxAttempts) {
      const reason: WorkAbandonReason = code ?? WORK_ATTEMPTS_EXHAUSTED;
      abandonExhaustedWork(ctx.queue, item.queuedRef, reason);
      abandoned += 1;
      recordFailure({ queuedRef: item.queuedRef, attempt: item.attempt, code, disposition: 'abandoned' });
      return;
    }
    const notBefore = retryNotBefore(ctx.retry, item.attempt, ctx.queue.now());
    settleWork(ctx.queue, item.queuedRef, { outcome: 'retry', notBefore });
    retried += 1;
    recordFailure({ queuedRef: item.queuedRef, attempt: item.attempt, code, disposition: 'retry' });
  };

  /** Apply the worker's own answer. `retry` and `abandoned` are queue states, nothing more. */
  const settleReported = (item: TelegramWorkItem, outcome: TelegramWorkOutcome): void => {
    if (outcome.outcome === 'done') {
      settleWork(ctx.queue, item.queuedRef, outcome);
      done += 1;
      return;
    }
    if (outcome.outcome === 'retry') {
      settleWork(ctx.queue, item.queuedRef, outcome);
      retried += 1;
      recordFailure({ queuedRef: item.queuedRef, attempt: item.attempt, code: null, disposition: 'retry' });
      return;
    }
    settleWork(ctx.queue, item.queuedRef, outcome);
    abandoned += 1;
    recordFailure({ queuedRef: item.queuedRef, attempt: item.attempt, code: outcome.code, disposition: 'abandoned' });
  };

  /** One lane: claim one item, process it, settle it, repeat until nothing is claimable. */
  const lane = async (): Promise<void> => {
    for (;;) {
      // ONE item. The claim is a conditional write, so two lanes cannot hold the same row.
      const batch = claimNextWork(ctx.queue, 1);
      const item = batch[0];
      if (!item) return;
      claimed += 1;
      inFlight += 1;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      try {
        const outcome = await ctx.worker.process(item);
        settleReported(item, outcome);
      } catch (cause) {
        settleThrown(item, cause);
      } finally {
        inFlight -= 1;
      }
    }
  };

  await Promise.all(Array.from({ length: lanes }, () => lane()));

  return { claimed, done, retried, abandoned, peakInFlight, failures };
}

/**
 * Bind the runner to a context.
 *
 * A scheduled caller invokes `runOnce` on a timer. There is deliberately no built-in interval and no
 * long-lived loop here: an ops artifact decides the cadence (contract 12 §7.3), and a module that
 * started its own timer would be running before any operator asked it to.
 */
export interface WorkerRunner {
  runOnce(): Promise<WorkerDrainReport>;
}

export function createWorkerRunner(ctx: WorkerRunContext): WorkerRunner {
  return {
    runOnce(): Promise<WorkerDrainReport> {
      return drainWorkQueue(ctx);
    },
  };
}
