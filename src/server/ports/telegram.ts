/**
 * NIZAM · TelegramPort — accept fast, process async, and make the reverse awkward
 * Implemented by: PFOS Contract 12 / Phase 2.1 (spec 06-two-agent-vps)
 * Owning requirements: R11 (token), R12 (allowlist), R13/R14 (dedup), R15 (accept fast)
 * Depends on: errors.ts (type level only)
 *
 * Contract 12 §5 in interface form. Everything here is a guard on input an attacker fully
 * controls except for two secrets, so the shape matters more than usual.
 *
 * The split is the point (§5.5, design key decision 4). The provider treats a slow response as
 * a failed delivery and retries, so a handler that performs a model call inline will exceed the
 * tolerance, be retried, and on the second delivery be protected only by dedup — a correct
 * guard papering over an incorrect design. Three separate interfaces make that hard to write
 * by accident:
 *
 *  - {@link TelegramInboundPort.accept} is **synchronous**. It returns a decision, not a
 *    promise. There is nothing to await, so a model call, a network call, or any other slow
 *    step cannot be placed before the acknowledgement without blocking the process outright.
 *    Authenticate, check the allowlist, de-duplicate, enqueue, acknowledge — all of which are
 *    local statements against this agent's own store.
 *  - {@link TelegramWorkerPort.process} is the asynchronous one. Everything slow lives here,
 *    after the acknowledgement, with its own retry and backoff (§5.5.4).
 *  - {@link TelegramOutboundPort.send} is asynchronous and separate again, because a reply is
 *    not part of accepting a delivery.
 *
 * §5.4's correctness fix is structural too: {@link DedupKey} has two required fields. Update
 * identifiers are per-bot sequences, so a store keyed on the identifier alone would treat the
 * second bot's legitimate update as a duplicate of the first bot's and silently drop it — data
 * loss that presents as one bot going quiet. A dedup implementation cannot satisfy this type
 * with the identifier alone.
 *
 * No literal appears here for a bot, a sender, a token, or an endpoint (R24). Every one is an
 * injected value on {@link TelegramTransportConfig}, and this module supplies no default for any
 * of them.
 */
import type { PortFailureCode } from './errors';

/**
 * One inbound delivery, exactly as untrusted as it arrives. Nothing is parsed yet: §5.3 puts
 * the allowlist check before any parsing of content, so a non-allowlisted sender never reaches
 * a parser.
 */
export interface TelegramDelivery {
  /** Which bot received it. Opaque here; the pair with `updateId` is the dedup key (§5.4.1). */
  readonly botId: string;
  /** The provider's update sequence number, which is per bot and therefore collides (R14). */
  readonly updateId: number;
  /** The sender, compared against the injected allowlist. Opaque; never a literal (R24). */
  readonly senderId: string;
  /**
   * The provider's echoed secret token. `null` means the header was **absent**; `''` means it
   * was present and empty. §5.2 treats those as different facts and rejects both, which is why
   * the type keeps them distinguishable rather than collapsing them.
   */
  readonly secretTokenHeader: string | null;
  readonly receivedAt: string;
  /** The raw, unparsed body. Untrusted data; never an instruction (§6.4). */
  readonly rawBody: string;
}

/**
 * The de-duplication key: the pair, never the identifier alone (§5.4.1). Enforced downstream by
 * a UNIQUE index and a conditional insert, so the insert *is* the dedup decision and cannot be
 * raced by two concurrent deliveries (§5.4.2, §5.4.3).
 */
export interface DedupKey {
  readonly botId: string;
  readonly updateId: number;
}

/**
 * What `accept` decided.
 *
 * `rejected` carries **no reason field**. §5.2 requires that the rejection response reveal
 * nothing about which check failed, and the cheapest way to honour that is for the decision
 * type to have nowhere to put it. Auditing is a separate path with its own record, which logs
 * the fact of the rejection and never the message content (§5.3).
 *
 * `duplicate` is a no-op with a success acknowledgement, not an error: returning an error would
 * make the provider retry the duplicate again (§5.4.4).
 */
export type TelegramAcceptDecision =
  | { readonly outcome: 'enqueued'; readonly queuedRef: string }
  | { readonly outcome: 'duplicate' }
  | { readonly outcome: 'rejected' };

/**
 * The webhook side. Synchronous by design — see the module note. A configuration whose expected
 * token is absent or empty fails closed: every request is refused rather than accepted (§5.2).
 */
export interface TelegramInboundPort {
  accept(delivery: TelegramDelivery): TelegramAcceptDecision;
}

/**
 * A durable unit of work. It lives in a table in this agent's own store, so a restart between
 * the acknowledgement and the processing does not lose the update (§5.5.2).
 */
export interface TelegramWorkItem {
  readonly queuedRef: string;
  readonly botId: string;
  readonly updateId: number;
  readonly senderId: string;
  readonly rawBody: string;
  readonly enqueuedAt: string;
  /** Processing is idempotent per item, because a worker can crash mid-item (§5.5.3). */
  readonly attempt: number;
}

/**
 * §5.5.4: a downstream failure is a QUEUE failure with its own retry and backoff. It never
 * becomes a transport-level failure that triggers redelivery, which is why this union has no
 * variant meaning "tell the provider it failed".
 */
export type TelegramWorkOutcome =
  | { readonly outcome: 'done' }
  | { readonly outcome: 'retry'; readonly notBefore: string }
  | { readonly outcome: 'abandoned'; readonly code: PortFailureCode };

/** The asynchronous side. Everything slow happens here, after the acknowledgement. */
export interface TelegramWorkerPort {
  process(item: TelegramWorkItem): Promise<TelegramWorkOutcome>;
}

/** An outbound reply. The provider's per-chat and broadcast rate limits are respected with backoff (§5.5.5). */
export interface TelegramOutboundMessage {
  readonly botId: string;
  readonly chatRef: string;
  readonly text: string;
  readonly replyToRef?: string;
}

export interface TelegramSendReceipt {
  readonly messageRef: string;
  readonly sentAt: string;
}

export interface TelegramOutboundPort {
  send(message: TelegramOutboundMessage): Promise<TelegramSendReceipt>;
}

/**
 * The transport boundary, assembled from the three roles. Keeping them as separate members
 * rather than flattening them means a caller holding the inbound role cannot reach the slow
 * ones at all.
 */
export interface TelegramPort {
  readonly inbound: TelegramInboundPort;
  readonly worker: TelegramWorkerPort;
  readonly outbound: TelegramOutboundPort;
}

/** How the transport is reached. `webhook` is the norm; `longPoll` is §2.3's documented degraded mode. */
export const TELEGRAM_TRANSPORT_MODES = ['webhook', 'longPoll'] as const;
export type TelegramTransportMode = (typeof TELEGRAM_TRANSPORT_MODES)[number];

/**
 * Injected configuration. No default for anything, and no literal for anything: the secret path
 * segment, the token, the allowlist, and the base address are all resolved from the host
 * environment at run time (steering §0b, R24).
 */
export interface TelegramTransportConfig {
  readonly botId: string;
  /**
   * The value the provider is expected to echo. Absent or empty **fails closed** (§5.2): the
   * handler refuses every request. An unconfigured guard must not be an open door.
   */
  readonly expectedSecretToken: string;
  /**
   * Who may interact. An **empty** list means nobody, not everybody (§5.3). No real identifier
   * appears in any tracked file.
   */
  readonly allowedSenderIds: readonly string[];
  /** The provider's API base address, injected. This module names none. */
  readonly apiBaseUrlRef: string;
  readonly mode: TelegramTransportMode;
  /** Bounded concurrency for the worker, because a single-operator system needs very little (§5.5.5). */
  readonly maxConcurrentWorkItems: number;
}
