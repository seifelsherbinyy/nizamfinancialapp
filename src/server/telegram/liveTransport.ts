/**
 * NIZAM · Live Telegram transport adapter — both modes, behind the existing TelegramPort
 * Implemented by: PFOS Contract 12 / Phase 10.5 (spec 06-two-agent-vps)
 * Owning requirements: R26 (the mode selects which gates apply), R26.1 (the offset advances only
 *   after the update is durably enqueued), R15 (accept fast, process asynchronously);
 *   composes R11/R12 (auth.ts) and R13/R14 (updateDedupRepo.ts)
 * Depends on: ./acceptHandler, ../ports/telegram (TelegramPort and its three roles),
 *   ../ports/errors (codes only). No network module, no clock, no randomness of its own.
 *
 * The live half of the transport boundary, assembled from the modules that already exist rather
 * than beside them: the accept path, the dedup claim and the durable queue are unchanged and are
 * called, not reimplemented. What this module adds is the part that only a *live* transport has —
 * how an update arrives, and when the provider is told we have it.
 *
 * **Nothing here reaches a network.** {@link TelegramTransportClient} is the whole of the outside
 * world, it is injected, and this module resolves no HTTP module, names no endpoint, and holds no
 * token literal (R24, steering §2). A test drives it with a deterministic client; the socket-owning
 * implementation is a later, gated concern, and its absence is why this file can be built now.
 *
 * ---
 *
 * **The mode is the axis, not a branch (R26, design delta D1).** Both modes are here, and they
 * differ in exactly two places, both of which are consequences of one fact:
 *
 *  - **Who delivers.** Under `webhook` the provider makes an inbound request and
 *    {@link TelegramPort.inbound} is called by whatever terminates it. Under `longPoll` there is no
 *    inbound request at all: {@link TelegramLiveTransport.pollOnce} calls the provider, reads
 *    updates back, and feeds each one through *the same* accept path.
 *  - **Who holds the retry.** Under `webhook` the provider retries until acknowledged. Under
 *    `longPoll` the agent holds its own read offset, so the offset *is* the acknowledgement.
 *
 * The guard difference falls out of the first: with no inbound request there is no
 * `X-Telegram-Bot-Api-Secret-Token` header and no expected token guarding a door, so the token gate
 * is not applicable and the allowlist is the whole guard. That decision lives in `auth.ts`'s
 * applicable-gate table and reaches this module only through the transport configuration's `mode`.
 * There is deliberately **no relaxed path here**: this module does not synthesise a header, does not
 * pass an expected token it invented, and cannot skip a gate — both of those shapes are recorded as
 * rejected in D1, and neither is reachable from this file because the guard is not called from it.
 *
 * ---
 *
 * **The offset is the durability boundary (R26.1, design delta D2).** Enqueue commits first, the
 * offset advances second, and never the other way round. A crash between them re-reads the update
 * and dedup absorbs it; a crash in the other order loses the update and nothing absorbs that. So
 * {@link pollOnce}:
 *
 *  1. reads the offset from the injected {@link TelegramOffsetStore};
 *  2. fetches a batch and processes it in ascending update order;
 *  3. for each update calls the accept path, which commits the dedup claim and the queue row in one
 *     transaction (`acceptHandler`'s note explains why those two are one fact);
 *  4. advances the offset **after** that transaction has returned, one update at a time, so a crash
 *     mid-batch loses nothing;
 *  5. and **stops the batch** at the first update whose durability did not hold, because the offset
 *     is monotonic: advancing past a failed update to reach a later one would discard the failure.
 *
 * **How a refusal is told from a durability failure, given the decision type has no reason field.**
 * `TelegramAcceptDecision`'s `rejected` variant deliberately carries no reason (§5.2), and that is
 * kept — so this module cannot ask the decision *why*. It does not need to: the audit sink is the
 * separate path §5.3 already requires, and it carries the stage. This module interposes on the sink
 * the caller supplied, forwards every line unchanged, and reads the stage only to answer one
 * question: did this refusal happen at the `enqueue` stage? An authorization refusal has no work to
 * lose, and re-reading it forever would wedge the poller on a stranger's message — a livelock, and
 * a denial of service any sender could cause. A durability failure has work that was NOT stored, so
 * the offset must not move. The audit path answers that without the response revealing anything.
 *
 * ---
 *
 * **The documented provider limits are respected with backoff (§5.5.5,
 * `ops/runbook/RATE_LIMIT_POSTURE.md`).** Two of that document's seven limits reach this module:
 *
 *  - **Limit 4, the too-many-requests refusal with a `retry_after` interval.** The advertised
 *    interval is *honoured, not estimated*: the outbound path waits at least that long, and at least
 *    its own bounded exponential backoff, before retrying. Retries are bounded; an exhausted budget
 *    surfaces as a refusal rather than a loop. It never becomes a transport failure — this module
 *    has no path that reports one, because {@link TelegramWorkOutcome} has no such variant.
 *  - **Limit 6, the long-poll request duration.** A positive timeout is long polling; zero is short
 *    polling, which the provider documents as being for testing only and which is a busy loop
 *    against a rate-limited endpoint. {@link createLiveTelegramTransport} refuses a non-positive
 *    timeout at construction, so the fallback cannot become the incident.
 *
 * `sleep` is injected for the same reason the clock is: a test asserts the schedule it would have
 * waited, and waits for nothing.
 */
import type { PortFailureCode } from '../ports/errors';
import type {
  TelegramAcceptDecision,
  TelegramDelivery,
  TelegramInboundPort,
  TelegramOutboundMessage,
  TelegramOutboundPort,
  TelegramPort,
  TelegramSendReceipt,
  TelegramTransportMode,
  TelegramWorkerPort,
} from '../ports/telegram';
import {
  acceptDelivery,
  createInboundHandler,
  type TelegramAcceptAuditLine,
  type TelegramAcceptContext,
  type TelegramAcceptStage,
} from './acceptHandler';

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

/** Discriminator for every refusal this module raises. A caller matches `code`, never prose. */
export type LiveTransportErrorCode =
  | 'LIVE_POLL_TIMEOUT_NOT_POSITIVE'
  | 'LIVE_POLL_LIMIT_NOT_POSITIVE'
  | 'LIVE_SEND_RETRY_POLICY_INVALID'
  | 'LIVE_POLL_NOT_APPLICABLE_IN_MODE'
  | 'LIVE_SEND_RETRY_BUDGET_EXHAUSTED';

/** A refusal of an unusable poll or retry parameter, or of a call the mode does not admit. */
export class LiveTransportError extends Error {
  readonly code: LiveTransportErrorCode;
  /** The offending field or the mode in question, so a caller acts without parsing the message. */
  readonly subject: string;

  constructor(code: LiveTransportErrorCode, message: string, subject: string) {
    super(message);
    this.name = 'LiveTransportError';
    this.code = code;
    this.subject = subject;
  }
}

/**
 * The provider's too-many-requests answer (rate-limit posture, Limit 4), as a typed refusal the
 * injected client raises and this module honours.
 *
 * `retryAfterSeconds` is the interval the provider advertised. It is optional because a client may
 * be refused without one, and in that case the bounded backoff is the whole of the wait — a missing
 * interval must never be read as "retry immediately".
 */
export class TelegramRateLimitRefusal extends Error {
  readonly code: Extract<PortFailureCode, 'TELEGRAM_SEND_REFUSED'> = 'TELEGRAM_SEND_REFUSED';
  readonly retryAfterSeconds: number | null;

  constructor(retryAfterSeconds: number | null, message = 'NIZAM telegram: the provider refused with a rate limit') {
    super(message);
    this.name = 'TelegramRateLimitRefusal';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Is this refusal the provider's rate limit? Shape-checked, so a client need not import the class. */
export function isRateLimitRefusal(error: unknown): error is TelegramRateLimitRefusal {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; retryAfterSeconds?: unknown };
  if (candidate.name !== 'TelegramRateLimitRefusal') return false;
  return candidate.retryAfterSeconds === null || typeof candidate.retryAfterSeconds === 'number';
}

// ---------------------------------------------------------------------------------------------
// The injected outside world
// ---------------------------------------------------------------------------------------------

/**
 * One update as the provider hands it back on the long-poll path, before anything has parsed it.
 *
 * No `secretTokenHeader` field, and its absence is the point (R26): an outbound read has no header
 * to carry, so there is nowhere for this module to put a synthesised one even if a later edit wanted
 * to. The accept path is handed `null`, which is what "the header was absent" already means.
 */
export interface TelegramPolledUpdate {
  readonly updateId: number;
  readonly senderId: string;
  /** The raw, unparsed body. Untrusted data; never an instruction (§6.4). */
  readonly rawBody: string;
}

/** What one fetch returned. A batch, in the order the provider gave it. */
export interface TelegramUpdateBatch {
  readonly updates: readonly TelegramPolledUpdate[];
}

/** What a fetch asks for. `timeoutSeconds` is positive by construction (rate limit posture, Limit 6). */
export interface TelegramFetchRequest {
  readonly botId: string;
  /** The provider's offset convention: hand back updates from this identifier onward. */
  readonly offset: number;
  readonly timeoutSeconds: number;
  readonly limit: number;
}

/**
 * **The only door to the outside world, and it is injected.** A deterministic implementation
 * satisfies this in a test; the socket-owning one is gated (steering §2 G3/G6). Nothing in this
 * repository implements it against a network yet, which is deliberate.
 */
export interface TelegramTransportClient {
  fetchUpdates(request: TelegramFetchRequest): Promise<TelegramUpdateBatch>;
  sendMessage(message: TelegramOutboundMessage): Promise<TelegramSendReceipt>;
}

/**
 * Where the read offset lives (R26.1).
 *
 * Two operations, and the split is the requirement: `read` is what the next fetch asks from, and
 * `commit` is the acknowledgement. A store whose `commit` fails leaves `read` answering the older
 * offset, which is exactly the behaviour a crash between the enqueue and the acknowledgement has —
 * so the failure this requirement is about is representable rather than hypothetical.
 */
export interface TelegramOffsetStore {
  read(): number;
  commit(nextOffset: number): void;
}

/**
 * The default offset store: in memory, starting at the provider's own beginning.
 *
 * In-memory is correct rather than a shortcut, and the reason is worth writing down. The provider
 * retains an unacknowledged update and re-serves it until a *higher* offset is requested, so a
 * process that restarts without a remembered offset re-reads what it never acknowledged — the
 * provider is the durable half of this pair, and dedup absorbs the redelivery (R13, R14). A
 * deployment that would rather remember it across restarts supplies its own store; this module
 * takes it as an injected dependency precisely so that choice is not made here.
 */
export function createInMemoryOffsetStore(initialOffset = 0): TelegramOffsetStore {
  let offset = initialOffset;
  return {
    read: () => offset,
    commit: (nextOffset: number) => {
      // Monotonic: an offset never goes backwards, because that would re-open a window dedup has
      // already closed and would re-run work that is already durable.
      if (nextOffset > offset) offset = nextOffset;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Injected policy
// ---------------------------------------------------------------------------------------------

/** How the long-poll read is shaped. Both numbers are injected; neither is a literal here. */
export interface TelegramPollPolicy {
  /** Positive seconds. Zero is short polling, which the provider documents as testing-only. */
  readonly timeoutSeconds: number;
  /** How many updates one fetch may return. Bounded, so a backlog drains in bounded batches. */
  readonly limit: number;
}

/** The outbound retry budget (rate limit posture, Limit 4). Bounded, so a refusal cannot loop. */
export interface TelegramSendRetryPolicy {
  readonly baseMs: number;
  readonly maxMs: number;
  /** Total attempts, including the first. One means no retry at all. */
  readonly maxAttempts: number;
}

// ---------------------------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------------------------

/** Why one polled update did not advance the offset, for the poll report. Codes, never content. */
export type PolledUpdateOutcome = 'enqueued' | 'duplicate' | 'refused' | 'not-durable';

/** What one polled update did. `offsetAdvanced` is the acknowledgement, per update (R26.1). */
export interface PolledUpdateResult {
  readonly updateId: number;
  readonly outcome: PolledUpdateOutcome;
  readonly offsetAdvanced: boolean;
}

/**
 * What one poll did. `offsetAfter` is read back from the store rather than computed, so a store that
 * refused a commit reports the offset it actually holds.
 */
export interface TelegramPollReport {
  readonly offsetBefore: number;
  readonly offsetAfter: number;
  readonly fetched: number;
  readonly results: readonly PolledUpdateResult[];
  /** True when the batch stopped early because an update's work was not durably stored. */
  readonly haltedOnDurability: boolean;
}

/** What the adapter needs. Every dependency injected; no default that opens a door. */
export interface TelegramLiveTransportContext {
  /** The accept path's own context: transport configuration, store handle, clock, id source, audit. */
  readonly accept: TelegramAcceptContext;
  readonly client: TelegramTransportClient;
  /** The slow side. Injected whole, because nothing about it is transport-specific (§5.5.4). */
  readonly worker: TelegramWorkerPort;
  readonly poll: TelegramPollPolicy;
  readonly send: TelegramSendRetryPolicy;
  /** Injected wait. A test asserts the schedule and waits for nothing. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Where the read offset lives. Defaults to an in-memory store — see its note for why. */
  readonly offsets?: TelegramOffsetStore;
}

/** The adapter: the port, plus the two things only a live transport has. */
export interface TelegramLiveTransport {
  /** The injectable surface. Satisfies {@link TelegramPort} unchanged, in both modes. */
  readonly port: TelegramPort;
  readonly mode: TelegramTransportMode;
  /** The offset the next fetch would ask from. Reporting; the store owns the value. */
  currentOffset(): number;
  /**
   * Read one batch and feed each update through the accept path.
   *
   * @throws {LiveTransportError} `LIVE_POLL_NOT_APPLICABLE_IN_MODE` under `webhook`, where the
   *   provider delivers and there is nothing to poll. Refusing is the honest answer: a webhook
   *   deployment that polls would read updates the provider is also delivering, and the only thing
   *   standing between that and double processing would be dedup — a guard papering over a
   *   configuration mistake.
   */
  pollOnce(): Promise<TelegramPollReport>;
}

function assertPositiveInteger(value: unknown, subject: string, code: LiveTransportErrorCode, why: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new LiveTransportError(code, `NIZAM live transport: ${subject} must be a positive whole number, got "${String(value)}" — ${why}`, subject);
  }
  return value as number;
}

const MS_PER_SECOND = 1_000;

/** Deterministic exponential backoff, clamped. Pure, so a test asserts the schedule without a clock. */
export function sendBackoffMs(policy: TelegramSendRetryPolicy, attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt, 30) - 1);
  return Math.min(policy.baseMs * 2 ** exponent, policy.maxMs);
}

/**
 * How long to wait before retrying a refused send.
 *
 * The provider's advertised interval is honoured, not estimated, and the bounded backoff is the
 * floor — so the wait is the LONGER of the two. Waiting less than the provider asked earns a second
 * refusal; waiting less than our own backoff would let a refusal without an advertised interval
 * become a tight loop.
 */
export function sendRetryDelayMs(policy: TelegramSendRetryPolicy, attempt: number, retryAfterSeconds: number | null): number {
  const advertised = typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds * MS_PER_SECOND) : 0;
  return Math.max(sendBackoffMs(policy, attempt), advertised);
}

/**
 * Build the adapter for whichever mode the transport configuration declares.
 *
 * @throws {LiveTransportError} for a non-positive poll timeout or limit, or an unusable retry
 *   budget. Both refusals are at construction, because a process that booted with them would only
 *   discover the problem under load.
 */
export function createLiveTelegramTransport(ctx: TelegramLiveTransportContext): TelegramLiveTransport {
  const mode = ctx.accept.transport.mode;
  assertPositiveInteger(
    ctx.poll.timeoutSeconds,
    'poll.timeoutSeconds',
    'LIVE_POLL_TIMEOUT_NOT_POSITIVE',
    'zero is short polling, which the provider documents as testing-only and which is a busy loop against a rate-limited endpoint (rate limit posture, Limit 6)',
  );
  assertPositiveInteger(ctx.poll.limit, 'poll.limit', 'LIVE_POLL_LIMIT_NOT_POSITIVE', 'a batch of zero updates would drain no backlog at all');
  for (const [subject, value] of [
    ['send.baseMs', ctx.send.baseMs],
    ['send.maxMs', ctx.send.maxMs],
    ['send.maxAttempts', ctx.send.maxAttempts],
  ] as const) {
    assertPositiveInteger(value, subject, 'LIVE_SEND_RETRY_POLICY_INVALID', 'an unbounded or absent retry budget is how one refused send becomes an incident');
  }

  const offsets = ctx.offsets ?? createInMemoryOffsetStore();

  // The stage of the most recent refusal, per (bot, update). Read for exactly one question —
  // whether a refusal was the enqueue stage — and never returned to a caller, because the response
  // must not reveal which check refused (§5.2). Forwarding is unconditional and comes first, so
  // interposing cannot swallow a line the caller was owed.
  const lastRefusalStage = new Map<string, TelegramAcceptStage>();
  const interposedAudit = (line: TelegramAcceptAuditLine): void => {
    ctx.accept.audit?.(line);
    lastRefusalStage.set(`${line.botId}\u0000${line.updateId}`, line.stage);
  };
  const acceptCtx: TelegramAcceptContext = { ...ctx.accept, audit: interposedAudit };

  const inbound: TelegramInboundPort = createInboundHandler(acceptCtx);

  const outbound: TelegramOutboundPort = {
    async send(message: TelegramOutboundMessage): Promise<TelegramSendReceipt> {
      for (let attempt = 1; attempt <= ctx.send.maxAttempts; attempt += 1) {
        try {
          return await ctx.client.sendMessage(message);
        } catch (error) {
          // Only the provider's rate limit is retried here. Any other failure is re-raised
          // unchanged, because retrying a refusal we do not understand is how a bug becomes load.
          if (!isRateLimitRefusal(error)) throw error;
          if (attempt === ctx.send.maxAttempts) break;
          await ctx.sleep(sendRetryDelayMs(ctx.send, attempt, error.retryAfterSeconds));
        }
      }
      // Bounded, and the exhaustion surfaces to the operator instead of looping. It stays a QUEUE
      // failure: the worker that called this settles with a retry or an abandon (§5.5.4), and there
      // is no path from here that tells the provider a DELIVERY failed.
      throw new LiveTransportError(
        'LIVE_SEND_RETRY_BUDGET_EXHAUSTED',
        `NIZAM live transport: the outbound send was refused on all ${ctx.send.maxAttempts} attempt(s); the refusal stays a queue failure and never becomes a transport failure (§5.5.4)`,
        'send.maxAttempts',
      );
    },
  };

  const port: TelegramPort = { inbound, worker: ctx.worker, outbound };

  const deliveryOf = (update: TelegramPolledUpdate): TelegramDelivery => ({
    botId: acceptCtx.transport.botId,
    updateId: update.updateId,
    senderId: update.senderId,
    // Absent, because on an outbound read there is no header. NOT the expected token, and not the
    // empty string standing in for one: synthesising either is the shape D1 rejected.
    secretTokenHeader: null,
    receivedAt: acceptCtx.now(),
    rawBody: update.rawBody,
  });

  const outcomeOf = (update: TelegramPolledUpdate, decision: TelegramAcceptDecision): PolledUpdateOutcome => {
    if (decision.outcome === 'enqueued') return 'enqueued';
    if (decision.outcome === 'duplicate') return 'duplicate';
    // The decision cannot say which check refused, and it is not asked. The audit path can, and
    // one bit of it is needed: work that was never stored must not be acknowledged.
    const stage = lastRefusalStage.get(`${acceptCtx.transport.botId}\u0000${update.updateId}`);
    return stage === 'enqueue' ? 'not-durable' : 'refused';
  };

  return {
    port,
    mode,
    currentOffset: () => offsets.read(),

    async pollOnce(): Promise<TelegramPollReport> {
      if (mode !== 'longPoll') {
        throw new LiveTransportError(
          'LIVE_POLL_NOT_APPLICABLE_IN_MODE',
          `NIZAM live transport: polling is not applicable in "${mode}" mode, where the provider delivers inbound and the offset is not the acknowledgement (R26.1, §2.3)`,
          mode,
        );
      }

      const offsetBefore = offsets.read();
      const batch = await ctx.client.fetchUpdates({
        botId: acceptCtx.transport.botId,
        offset: offsetBefore,
        timeoutSeconds: ctx.poll.timeoutSeconds,
        limit: ctx.poll.limit,
      });

      // Ascending, so the offset only ever moves forward and a provider that returned a batch out
      // of order cannot make it skip.
      const ordered = [...batch.updates].sort((left, right) => left.updateId - right.updateId);
      const results: PolledUpdateResult[] = [];
      let haltedOnDurability = false;

      for (const update of ordered) {
        // 1. The enqueue commits, or it does not. `acceptDelivery` is synchronous and wraps the
        //    dedup claim and the queue row in one transaction, so its return is the durable fact.
        const decision = acceptDelivery(acceptCtx, deliveryOf(update));
        const outcome = outcomeOf(update, decision);

        if (outcome === 'not-durable') {
          // 2a. Nothing was stored, so nothing may be acknowledged. Stop the batch: the offset is
          //     monotonic, so advancing past this update to reach a later one would discard it for
          //     good — the provider would never re-serve it, and dedup has nothing to absorb.
          results.push({ updateId: update.updateId, outcome, offsetAdvanced: false });
          haltedOnDurability = true;
          break;
        }

        // 2b. Durability holds — the work exists (`enqueued`), already existed (`duplicate`), or
        //     never existed and never will (`refused`, which has no work to lose). Only now.
        offsets.commit(update.updateId + 1);
        results.push({ updateId: update.updateId, outcome, offsetAdvanced: true });
      }

      return { offsetBefore, offsetAfter: offsets.read(), fetched: ordered.length, results, haltedOnDurability };
    },
  };
}
