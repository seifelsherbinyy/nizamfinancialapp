/**
 * NIZAM · Deterministic TelegramPort mock — every §5 gate, drivable from a test
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Owning requirements: R11 (token), R12 (allowlist), R13/R14 (dedup), R15 (accept fast)
 * Depends on: ../ports/telegram, ../ports/errors, ./invocationRecorder, ./failure
 *
 * The BUILD half of the transport boundary (steering §2). The live half is gated behind G3 and
 * G6, so nothing here resolves a network module, names an endpoint, or holds a token literal:
 * every one of those is an injected value on {@link TelegramTransportConfig}.
 *
 * Deterministic means all four of these, and the tests assert each one:
 *   - no clock of its own — `now` is injected, so `enqueuedAt` and `sentAt` are the caller's;
 *   - no randomness — `queuedRef` is `botId` and `updateId`, and `messageRef` is `botId` and a
 *     per-mock send counter, so two identical scripts produce identical references;
 *   - no network and no filesystem;
 *   - the same delivery twice yields the same decision, which is the whole point of §5.4.
 *
 * The failure paths a caller can drive, which Phases 3/4/5 need for their negative tests:
 *   - **a configuration that fails closed** (§5.2): an absent or empty `expectedSecretToken`
 *     refuses EVERY delivery, including one carrying the right token, because an unconfigured
 *     guard must not be an open door;
 *   - **a missing token** (`secretTokenHeader === null`) and **an empty one** (`''`), which
 *     §5.2 treats as different facts and rejects separately;
 *   - **a wrong token**, compared without a length-dependent early exit;
 *   - **a sender outside the allowlist**, including the empty allowlist, which means nobody
 *     rather than everybody (§5.3);
 *   - **a duplicate update**, answered `duplicate` with no error so the provider does not
 *     retry (§5.4.4) — and a **collision across two bots**, which is NOT a duplicate (R14);
 *   - **an enqueue failure**, which rejects rather than acknowledging work that was never
 *     durably stored (§5.5.2);
 *   - **a worker retry and a worker abandon** (§5.5.4), neither of which becomes a transport
 *     failure that would trigger redelivery;
 *   - **a refused outbound send**.
 *
 * Where the reason lives. `TelegramAcceptDecision`'s `rejected` variant carries no reason field,
 * because §5.2 forbids the response revealing which check failed. The mock therefore keeps its
 * own audit — {@link TelegramMock.rejections} — which is the "separate path with its own record"
 * the port note describes. It holds failure CODES and never message content, and it does not
 * distinguish a bad token from a disallowed sender, because the failure vocabulary does not
 * either.
 */
import type { PortFailureCode } from '../ports/errors.ts';
import type {
  TelegramAcceptDecision,
  TelegramDelivery,
  TelegramOutboundMessage,
  TelegramPort,
  TelegramSendReceipt,
  TelegramTransportConfig,
  TelegramWorkItem,
  TelegramWorkOutcome,
} from '../ports/telegram.ts';
import { MockPortFailure } from './failure.ts';
import type { InvocationRecorder } from './invocationRecorder.ts';

export interface TelegramMockConfig {
  readonly transport: TelegramTransportConfig;
  readonly recorder: InvocationRecorder;
  /** Injected clock. This mock reads no ambient time (design key decision 1). */
  readonly now: () => string;
  /** What `process` answers. Default `done`. Set `retry` or `abandoned` to drive §5.5.4. */
  readonly workOutcome?: TelegramWorkOutcome;
  /** When true, the durable enqueue fails, so `accept` rejects instead of acknowledging. */
  readonly enqueueFails?: boolean;
  /** When true, `send` rejects with `TELEGRAM_SEND_REFUSED`. */
  readonly sendRefused?: boolean;
}

/** The mock and its observability. `port` is the injectable surface; the rest is for tests. */
export interface TelegramMock {
  readonly port: TelegramPort;
  /** Work durably enqueued, oldest first. */
  readonly queued: readonly TelegramWorkItem[];
  /** Items the worker has answered for, oldest first. */
  readonly processed: readonly TelegramWorkItem[];
  /** The audit path (§5.2): codes only, never content, and never a per-check distinction. */
  readonly rejections: readonly PortFailureCode[];
  readonly recorder: InvocationRecorder;
}

/**
 * Compare without a length-dependent early exit, which is the property
 * `nizamcore/NIZAM__system/relay/auth.py` already has and design key decision 2 says to port
 * rather than reinvent. Both operands are folded to a fixed number of comparisons, so the time
 * taken does not depend on how many leading characters happened to agree.
 */
function constantTimeEquals(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const span = Math.max(left.length, right.length);
  for (let i = 0; i < span; i += 1) {
    difference |= (left.charCodeAt(i) | 0) ^ (right.charCodeAt(i) | 0);
  }
  return difference === 0;
}

/** The dedup key as one string: the PAIR, never the identifier alone (§5.4.1, R14). */
function dedupKeyOf(botId: string, updateId: number): string {
  return `${botId}\u0000${updateId}`;
}

export function createTelegramMock(config: TelegramMockConfig): TelegramMock {
  const { transport, recorder, now } = config;
  const seen = new Set<string>();
  const queued: TelegramWorkItem[] = [];
  const processed: TelegramWorkItem[] = [];
  const rejections: PortFailureCode[] = [];
  let sendSeq = 0;

  function refuse(code: PortFailureCode): TelegramAcceptDecision {
    rejections.push(code);
    return { outcome: 'rejected' };
  }

  const port: TelegramPort = {
    inbound: {
      accept(delivery: TelegramDelivery): TelegramAcceptDecision {
        // Redacted projection only: the raw body is never recorded (§6.4, R19).
        recorder.record('telegram', 'accept', {
          botId: delivery.botId,
          updateId: delivery.updateId,
          senderId: delivery.senderId,
          tokenHeaderPresent: delivery.secretTokenHeader !== null,
        });

        // §5.2: an unconfigured guard refuses everything, right token included.
        if (transport.expectedSecretToken.length === 0) {
          return refuse('TELEGRAM_CONFIG_FAILS_CLOSED');
        }
        // A null header and an empty one are different facts; both are refused.
        if (delivery.secretTokenHeader === null) return refuse('TELEGRAM_REQUEST_REJECTED');
        if (!constantTimeEquals(delivery.secretTokenHeader, transport.expectedSecretToken)) {
          return refuse('TELEGRAM_REQUEST_REJECTED');
        }
        // §5.3: the allowlist is checked BEFORE any parsing of content. An empty list is nobody.
        if (!transport.allowedSenderIds.includes(delivery.senderId)) {
          return refuse('TELEGRAM_REQUEST_REJECTED');
        }

        // §5.4: the insert IS the dedup decision, so there is no read-then-write window.
        const key = dedupKeyOf(delivery.botId, delivery.updateId);
        if (seen.has(key)) return { outcome: 'duplicate' };

        if (config.enqueueFails === true) return refuse('TELEGRAM_ENQUEUE_FAILED');

        seen.add(key);
        const queuedRef = `queued:${delivery.botId}:${delivery.updateId}`;
        queued.push({
          queuedRef,
          botId: delivery.botId,
          updateId: delivery.updateId,
          senderId: delivery.senderId,
          rawBody: delivery.rawBody,
          enqueuedAt: now(),
          attempt: 1,
        });
        return { outcome: 'enqueued', queuedRef };
      },
    },

    worker: {
      async process(item: TelegramWorkItem): Promise<TelegramWorkOutcome> {
        recorder.record('telegram', 'process', {
          queuedRef: item.queuedRef,
          botId: item.botId,
          updateId: item.updateId,
          attempt: item.attempt,
        });
        processed.push(item);
        return config.workOutcome ?? { outcome: 'done' };
      },
    },

    outbound: {
      async send(message: TelegramOutboundMessage): Promise<TelegramSendReceipt> {
        // The reply text is content: recorded as a length, never as a value (§6.4).
        recorder.record('telegram', 'send', {
          botId: message.botId,
          chatRef: message.chatRef,
          textLength: message.text.length,
        });
        if (config.sendRefused === true) {
          throw new MockPortFailure('TELEGRAM_SEND_REFUSED', 'NIZAM telegram mock: outbound send refused', null);
        }
        sendSeq += 1;
        return { messageRef: `sent:${message.botId}:${sendSeq}`, sentAt: now() };
      },
    },
  };

  return {
    port,
    get queued() {
      return [...queued];
    },
    get processed() {
      return [...processed];
    },
    get rejections() {
      return [...rejections];
    },
    recorder,
  };
}
