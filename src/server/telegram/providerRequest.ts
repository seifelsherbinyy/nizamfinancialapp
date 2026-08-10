/**
 * NIZAM · The messaging provider request module — the ONE outbound messaging request in this tree
 * Implemented by: PFOS Contract 12 / Phase 2, task B4, seams S1 and S2 (spec 07-bot-bringup-v1)
 * Owning requirements: R11 (the credential is configured, never defaulted, and never printed),
 *   R19 (structured redacted lines only — never a credential, a body, or a sender),
 *   R24 (no deployment particular: no host, no path, no bot, no sender, no figure),
 *   R26.1 (the long-poll offset semantics the transport above ALREADY expects),
 *   contract 12 §5.5.5 (the provider's documented limits are honoured with the EXISTING bounded
 *   budgets rather than with new ones)
 * Depends on: ../ports/telegram (the outbound message and receipt shapes), ./liveTransport
 *   (`TelegramTransportClient` and `TelegramRateLimitRefusal` — the shapes the transport above
 *   already consumes), ../config/environment (the ONE ambient bridge, reached through an injected
 *   `EnvSource`), ../ops/redactedLogger (the ONE way a line is written), ../ports/errors (codes).
 *   No network module, no clock, no randomness, and no bridge of its own to the ambient environment.
 *
 * `liveTransport.ts` built the live half of the transport — the offset durability ordering, the
 * bounded send retry, the accept path — and declared its whole outside world as one injected
 * interface it deliberately did not implement. This module is that implementation, and it is the
 * artifact spec 06 withheld: the request itself.
 *
 * ## No network call is made here, and that is structural rather than a promise
 *
 * Steering §2 gates "any outbound network call from a **server** process" behind G3 and G6. So the
 * socket is NOT in this file. It is a parameter — {@link ProviderRequestFn} — exactly as
 * `liveModelCaller.ts` makes the model transport a parameter on the other side of the tier:
 *
 *  1. **No network primitive.** No `fetch`, no `node:http`, no `node:https`, no socket, no client
 *     library. Importing this module grants no ability to reach anything, because the ability was
 *     never in it. {@link gatedProviderRequest} is what the process wires today, and it refuses.
 *  2. **No endpoint.** Not a literal, not a default, not a fallback. The base address is resolved
 *     from `MSG_API_BASE` through the loader's own {@link parseApiBase}, which asserts the one
 *     property a plaintext base would give away and names no host itself.
 *  3. **No credential in anything that can be printed.** The token is resolved into a
 *     {@link ProviderCredential} whose `toString` and `toJSON` are the redaction marker, so
 *     interpolation, `String()`, `JSON.stringify` and every structured logger reach the marker.
 *     {@link revealProviderCredential} is the single named way to the characters, and **this module
 *     never calls it** — the injected capability does, at the one call site a human writes when G3
 *     and G6 are done.
 *  4. **The credential never travels inside the request object.** {@link ProviderHttpRequest} has
 *     no header field and no credential field, so a request may be recorded whole without leaking
 *     one. The credential is the second argument, beside it.
 *
 * ## One chokepoint, not two
 *
 * `processEnvSource` in `../config/environment.ts` is the only expression in `src/` that reads the
 * ambient environment, and `environment.test.ts` scans the tree to keep it that way. This module
 * therefore reads **no** ambient environment: it takes an {@link EnvSource} the process already
 * obtained from that bridge, and asks the loader's own exported rules which entries are configured
 * ({@link describeConfiguredPresence}) and what the base address is ({@link parseApiBase}). Nothing
 * about "is this entry usable" is restated here, so nothing here can soften it.
 *
 * The token value is passed through **untrimmed**, for the reason the loader gives about the other
 * secret: padding a credential is a value the provider can never accept, and quietly removing the
 * padding would turn a broken credential into an apparently valid one.
 *
 * ## Fail closed, and in this order
 *
 * {@link performProviderRequest} refuses before it trusts anything:
 *
 *  1. the credential is absent, blank, or still its template placeholder — refused, no request made;
 *  2. the base address is absent or not transport-secured — the loader's own refusal, re-raised;
 *  3. the response body is over the read bound — refused **before** it is parsed, because parsing an
 *     unbounded body is the work the bound exists to prevent;
 *  4. the provider advertised its rate limit — raised as {@link TelegramRateLimitRefusal}, which is
 *     the typed refusal the EXISTING outbound budget in `liveTransport.ts` already honours;
 *  5. the status is not a success — refused; there is no "probably fine" branch;
 *  6. the body is not parseable, or its envelope does not report success — refused.
 *
 * **No retry loop lives here.** The bounded budgets are `SEND_RETRY_POLICY` and `POLL_POLICY` in
 * `process/main.ts`, already threaded into `createLiveTelegramTransport`, and the rate-limit refusal
 * above is precisely the shape that budget waits on. A second retry loop in this module would be a
 * second policy over the same limit, which is how two halves of one budget come to disagree.
 *
 * ## What reaches a log line
 *
 * One line per request, built through `redactedLogger` and through nothing else: which operation,
 * whether it was answered, how long it took, and the refusal reason as an enumerated code. There is
 * no path from a credential, a message body, a sender, or a provider payload to a log line, because
 * the fields this module passes are `enum`, `duration_ms` and nothing else — and that logger's own
 * field types cannot hold prose at all.
 */
import {
  describeConfiguredPresence,
  parseApiBase,
  agentEntryNames,
  type EnvSource,
} from '../config/environment.ts';
import type { PortFailureCode } from '../ports/errors.ts';
import type {
  TelegramOutboundMessage,
  TelegramSendReceipt,
} from '../ports/telegram.ts';
import type { RedactedLogger } from '../ops/redactedLogger.ts';
import type { SpendAgent } from '../../features/routing/spendLedger.ts';
import {
  TelegramRateLimitRefusal,
  type TelegramFetchRequest,
  type TelegramPolledUpdate,
  type TelegramTransportClient,
  type TelegramUpdateBatch,
} from './liveTransport.ts';

// ---------------------------------------------------------------------------------------------
// The credential holder — resolved, and unprintable
// ---------------------------------------------------------------------------------------------

/** What every accidental stringification of a resolved credential yields. */
export const PROVIDER_REDACTION_MARKER = '[redacted]';

declare const PROVIDER_CREDENTIAL_BRAND: unique symbol;

/**
 * A resolved messaging credential that cannot be printed. Both `toString` and `toJSON` yield
 * {@link PROVIDER_REDACTION_MARKER}, so template interpolation, `String()`, `console.log`,
 * `JSON.stringify` and every structured logger reach the marker rather than the characters.
 */
export interface ProviderCredential {
  readonly [PROVIDER_CREDENTIAL_BRAND]: 'a resolved messaging credential; its characters are reachable only through revealProviderCredential';
  toString(): string;
  toJSON(): string;
}

const credentialValues = new WeakMap<ProviderCredential, string>();

/** Wrap resolved credential characters so they cannot be printed by accident. */
export function providerCredential(value: string): ProviderCredential {
  const holder = Object.freeze({
    toString(): string {
      return PROVIDER_REDACTION_MARKER;
    },
    toJSON(): string {
      return PROVIDER_REDACTION_MARKER;
    },
  }) as unknown as ProviderCredential;
  credentialValues.set(holder, value);
  return holder;
}

/**
 * The one way to the characters. Called by a {@link ProviderRequestFn} at the moment it composes the
 * address it will dial, and by nothing else — notably by no function in this module.
 */
export function revealProviderCredential(credential: ProviderCredential): string {
  const value = credentialValues.get(credential);
  if (value === undefined) {
    throw new ProviderRequestError(
      'credential_not_wrapped',
      'a value offered as a messaging credential was not produced by providerCredential, so it carries no characters to reveal',
      { at: 'credential' },
    );
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

/**
 * Why a provider request refused. A caller discriminates on this, never on a message. Each member
 * is a single token, so it is legal as an enumerated log field value (§6.4).
 */
export const PROVIDER_REFUSAL_REASONS = [
  'credential_absent',
  'credential_not_wrapped',
  'transport_gated',
  'body_over_read_bound',
  'status_not_success',
  'body_unparseable',
  'envelope_not_ok',
  'result_shape_unexpected',
  'update_key_unreadable',
  'send_receipt_unreadable',
] as const;

export type ProviderRefusalReason = (typeof PROVIDER_REFUSAL_REASONS)[number];

/**
 * Which cross-tier failure code each reason presents as.
 *
 * The reason is this adapter's own, finer-grained fact; the code is the vocabulary
 * `../ports/errors.ts` defines for the boundary, and it is what `workerRunner.ts` records when a
 * downstream failure becomes a queue retry. A configuration that fails closed is
 * `TELEGRAM_CONFIG_FAILS_CLOSED`; everything else is the refusal the transport above already knows.
 */
const REASON_TO_PORT_CODE: Readonly<Record<ProviderRefusalReason, PortFailureCode>> = Object.freeze({
  credential_absent: 'TELEGRAM_CONFIG_FAILS_CLOSED',
  credential_not_wrapped: 'TELEGRAM_CONFIG_FAILS_CLOSED',
  transport_gated: 'TELEGRAM_SEND_REFUSED',
  body_over_read_bound: 'TELEGRAM_SEND_REFUSED',
  status_not_success: 'TELEGRAM_SEND_REFUSED',
  body_unparseable: 'TELEGRAM_SEND_REFUSED',
  envelope_not_ok: 'TELEGRAM_SEND_REFUSED',
  result_shape_unexpected: 'TELEGRAM_SEND_REFUSED',
  update_key_unreadable: 'TELEGRAM_SEND_REFUSED',
  send_receipt_unreadable: 'TELEGRAM_SEND_REFUSED',
});

/**
 * A refused provider request.
 *
 * `detail` holds field paths, an operation name, a status number, and byte counts. It has no field
 * for a credential, a body, a sender, or a figure, and nothing on this path ever puts one there
 * (§6.4, R19, R24). `correlationRef` is present because {@link PortFailure} declares it; it is a
 * pointer, never content.
 */
export class ProviderRequestError extends Error {
  readonly code: PortFailureCode;
  readonly reason: ProviderRefusalReason;
  readonly correlationRef: string | null = null;
  readonly detail: Readonly<Record<string, string>>;

  constructor(reason: ProviderRefusalReason, why: string, detail: Record<string, unknown> = {}) {
    super(`NIZAM messaging provider: ${why}`);
    this.name = 'ProviderRequestError';
    this.reason = reason;
    this.code = REASON_TO_PORT_CODE[reason];
    const flat: Record<string, string> = {};
    for (const [key, value] of Object.entries(detail)) flat[key] = String(value);
    this.detail = Object.freeze(flat);
  }
}

// ---------------------------------------------------------------------------------------------
// The injected capability
// ---------------------------------------------------------------------------------------------

/**
 * The two operations this tier performs. A closed pair, so the provider's own method vocabulary is
 * resolved by the capability that dials rather than spelled here — one fewer particular in a public
 * repository, and one fewer thing this module can get wrong about an address.
 */
export const PROVIDER_OPERATIONS = ['read_updates', 'send_message'] as const;
export type ProviderOperation = (typeof PROVIDER_OPERATIONS)[number];

/**
 * A described provider exchange. Note what is absent: no header field and no credential field. The
 * credential travels beside the request, so this object may be recorded whole.
 */
export interface ProviderHttpRequest {
  /** The RESOLVED base address, from `MSG_API_BASE`. No part of it is a literal in this file. */
  readonly baseUrl: string;
  readonly operation: ProviderOperation;
  /** The JSON request body. Carries the long-poll parameters, or the reply this agent composed. */
  readonly body: string;
}

export interface ProviderHttpResponse {
  readonly status: number;
  readonly bodyText: string;
  /** Wall-clock duration the capability observed, in whole milliseconds. */
  readonly latencyMs?: number;
  /**
   * The interval the provider advertised alongside a rate-limit refusal, if the capability read one
   * off the response. `null` or absent means none was advertised, which must never be read as
   * "retry immediately" — the existing bounded budget is then the whole of the wait.
   */
  readonly retryAfterSeconds?: number | null;
}

/**
 * The network capability, injected. This module declares the shape and supplies no implementation
 * that can reach a socket — see {@link gatedProviderRequest}, which is what the process wires until
 * G3 and G6 are done.
 */
export type ProviderRequestFn = (
  request: ProviderHttpRequest,
  credential: ProviderCredential,
) => Promise<ProviderHttpResponse>;

/**
 * The capability under the current gate posture: it refuses, and it holds no socket.
 *
 * This is what `process/main.ts` wires, so the two seams now run the real module — the credential
 * resolution, the request composition, the read bound, the fail-closed reader — and stop at the one
 * step that is genuinely gated. Nothing pretends a provider answered.
 */
export function gatedProviderRequest(): ProviderRequestFn {
  return async (request: ProviderHttpRequest, credential: ProviderCredential): Promise<ProviderHttpResponse> => {
    void credential;
    throw new ProviderRequestError(
      'transport_gated',
      'no socket-owning request capability is wired; gates G3 and G6 supply it, and steering §2 keeps an outbound call from a server process behind them',
      { operation: request.operation },
    );
  };
}

// ---------------------------------------------------------------------------------------------
// Bounds and status vocabulary
// ---------------------------------------------------------------------------------------------

/**
 * Largest provider response this module will read before refusing. A bound, not a policy: it is the
 * same shape `MAX_INBOUND_BODY_BYTES` gives the inbound listener, held over the other direction.
 */
export const MAX_PROVIDER_RESPONSE_BYTES = 1_048_576;

/** The success range. A status outside it is a refusal, never a warning. */
const SUCCESS_STATUS_MIN = 200;
const SUCCESS_STATUS_MAX = 299;

/** The status the provider answers a too-many-requests refusal with (rate limit posture, Limit 4). */
const RATE_LIMIT_STATUS = 429;

const UTF8 = new TextEncoder();

/** Bytes on the wire, not code units: a bound measured in the smaller unit is a weaker bound. */
export function utf8ByteLength(text: string): number {
  return UTF8.encode(text).length;
}

// ---------------------------------------------------------------------------------------------
// Reading the provider's shapes, defensively
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The two key fields of one update, read off an already-parsed value.
 *
 * **This is the one implementation of that rule.** `process/main.ts`'s `readDeliveryIdentifiers`
 * parses a raw webhook body and then calls this, so the webhook path and the long-poll path agree
 * about which fields are the dedup key and which field the allowlist reads.
 *
 * Two absences are told apart, because they have different consequences:
 *
 *  - `null` means the **update identifier** was unreadable. It is half of the dedup key and it is
 *    the whole of the acknowledgement, so there is nothing to key on and nothing to advance past.
 *  - `senderId: null` means the update carried no readable sender. That is an ordinary provider
 *    fact — an edited message, a channel post, a callback — not a malformation. The caller decides:
 *    the webhook path ignores the delivery, and the long-poll path lets the allowlist refuse it, so
 *    the offset still advances and the poller cannot wedge on it.
 */
export function readUpdateKeyFields(parsed: unknown): { readonly updateId: number; readonly senderId: string | null } | null {
  if (!isRecord(parsed)) return null;
  const updateId = parsed['update_id'];
  if (!Number.isSafeInteger(updateId)) return null;
  const message = parsed['message'];
  const from = isRecord(message) ? message['from'] : undefined;
  const senderId = isRecord(from) ? from['id'] : undefined;
  const readable = typeof senderId === 'number' || typeof senderId === 'string';
  return { updateId: updateId as number, senderId: readable ? String(senderId) : null };
}

/** The provider's envelope: a success flag and a result. Anything else is refused. */
function readEnvelopeResult(bodyText: string, operation: ProviderOperation): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new ProviderRequestError(
      'body_unparseable',
      'the provider answered with a body that is not parseable, so nothing about it can be trusted; the body is refused and is not quoted here (R19)',
      { operation, bytes: utf8ByteLength(bodyText) },
    );
  }
  if (!isRecord(parsed)) {
    throw new ProviderRequestError(
      'envelope_not_ok',
      'the provider answered with a body that is not an envelope, so it reports neither success nor a result',
      { operation },
    );
  }
  if (parsed['ok'] !== true) {
    throw new ProviderRequestError(
      'envelope_not_ok',
      'the provider answered without reporting success, and an unsuccessful answer is refused rather than read for a usable part',
      { operation },
    );
  }
  return parsed['result'];
}

/** The interval the provider advertised, from the response field first and the envelope second. */
function advertisedRetryAfter(response: ProviderHttpResponse): number | null {
  const fromResponse = response.retryAfterSeconds;
  if (typeof fromResponse === 'number' && Number.isFinite(fromResponse) && fromResponse > 0) return fromResponse;
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.bodyText);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const parameters = parsed['parameters'];
  const hint = isRecord(parameters) ? parameters['retry_after'] : undefined;
  if (typeof hint === 'number' && Number.isFinite(hint) && hint > 0) return hint;
  return null;
}

// ---------------------------------------------------------------------------------------------
// The one request
// ---------------------------------------------------------------------------------------------

/** What the module needs. Every dependency injected; nothing defaulted that would open a door. */
export interface ProviderRequestContext {
  /** Whose credential is read. The entry names come from the loader, keyed by this (R17). */
  readonly agent: SpendAgent;
  /** The environment, already obtained from the ONE ambient bridge by the process. */
  readonly env: EnvSource;
  /** The socket-owning capability. `gatedProviderRequest()` today; a real one after G3 and G6. */
  readonly request: ProviderRequestFn;
  /** Injected clock, so a receipt instant is a fact supplied rather than discovered here. */
  readonly now: () => string;
  /** Where a redacted line goes. Optional: a module that cannot log is still correct. */
  readonly log?: RedactedLogger;
  /** The read bound. Defaults to {@link MAX_PROVIDER_RESPONSE_BYTES}. */
  readonly maxResponseBytes?: number;
}

/** Resolve this agent's credential, or refuse. The value is wrapped and never returned bare. */
function resolveCredential(ctx: ProviderRequestContext): ProviderCredential {
  const entry = agentEntryNames(ctx.agent).botTokenEntry;
  // The loader's OWN rule for "configured": set, non-blank, and not still its template
  // placeholder. Asked through the boolean-only surface, so no value is rendered to ask it.
  const configured = describeConfiguredPresence(ctx.agent, ctx.env)[entry];
  if (configured !== true) {
    throw new ProviderRequestError(
      'credential_absent',
      `${entry} is not configured, and there is no default; an outbound request without a credential is refused rather than attempted (R11, gate G3)`,
      { entry },
    );
  }
  // Untrimmed, deliberately: see the module note on padding.
  return providerCredential(String(ctx.env[entry] ?? ''));
}

/**
 * Perform one provider request and return its `result`, or refuse.
 *
 * The whole of the fail-closed ordering is here, and the order is the point — see the module note.
 */
export async function performProviderRequest(
  ctx: ProviderRequestContext,
  operation: ProviderOperation,
  body: string,
): Promise<unknown> {
  const bound = ctx.maxResponseBytes ?? MAX_PROVIDER_RESPONSE_BYTES;
  try {
    // 1 and 2. Configuration fails closed before anything is dialled. `parseApiBase` is the
    //          loader's own rule and its own refusal; it is re-raised rather than restated.
    const credential = resolveCredential(ctx);
    const baseUrl = parseApiBase(ctx.env);

    const response = await ctx.request({ baseUrl, operation, body }, credential);

    // 3. The bound, BEFORE the parse. Parsing an unbounded body is the work the bound prevents.
    const bytes = utf8ByteLength(response.bodyText);
    if (bytes > bound) {
      throw new ProviderRequestError(
        'body_over_read_bound',
        'the provider answered with a body over the read bound, so it is refused rather than buffered and parsed',
        { operation, bytes, bound },
      );
    }

    // 4. The provider's documented rate limit, raised as the typed refusal the EXISTING outbound
    //    budget in liveTransport.ts already waits on. No retry loop is added here.
    if (response.status === RATE_LIMIT_STATUS) {
      throw new TelegramRateLimitRefusal(advertisedRetryAfter(response));
    }

    // 5. Any other non-success status. There is no "probably fine" branch.
    if (response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
      throw new ProviderRequestError(
        'status_not_success',
        'the provider answered with a status outside the success range, so the answer is refused and nothing is read from it',
        { operation, status: response.status },
      );
    }

    // 6. The envelope.
    const result = readEnvelopeResult(response.bodyText, operation);

    const latencyMs = response.latencyMs;
    ctx.log?.log('info', 'provider_request_completed', {
      component: { kind: 'enum', value: operation },
      outcome: { kind: 'enum', value: 'answered' },
      // Omitted rather than coerced when the capability reported no usable measurement: the logger
      // refuses a non-integer duration, and a refused log line must not fail a request that worked.
      ...(typeof latencyMs === 'number' && Number.isSafeInteger(latencyMs) && latencyMs >= 0
        ? { latencyMs: { kind: 'duration_ms' as const, value: latencyMs } }
        : {}),
    });
    return result;
  } catch (cause) {
    ctx.log?.log('warn', 'provider_request_refused', {
      component: { kind: 'enum', value: operation },
      // An enumerated code, and only ever a code. Never the message, which is prose by design.
      failure: { kind: 'enum', value: refusalTokenOf(cause) },
    });
    throw cause;
  }
}

/** One enumerated token for whatever refused. Never a message, never a value carried inside one. */
function refusalTokenOf(cause: unknown): string {
  if (cause instanceof ProviderRequestError) return cause.reason;
  if (cause instanceof TelegramRateLimitRefusal) return 'rate_limited';
  const code = (cause as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && code.length > 0 && !/\s/.test(code) ? code : 'refused';
}

// ---------------------------------------------------------------------------------------------
// The client the transport above consumes
// ---------------------------------------------------------------------------------------------

/**
 * Build the provider client: the two members `liveTransport.ts` declared and did not implement.
 *
 * **The offset semantics are the transport's, unchanged.** `liveTransport.ts` reads the offset from
 * its store, asks for updates "from this identifier onward", and commits `updateId + 1` only after
 * the enqueue has committed (R26.1). This module invents nothing about that: the offset, the
 * long-poll timeout and the batch bound are passed through exactly as they arrive on
 * {@link TelegramFetchRequest}, which is where `POLL_POLICY` already put them.
 */
export function createProviderTransportClient(ctx: ProviderRequestContext): TelegramTransportClient {
  return {
    async fetchUpdates(request: TelegramFetchRequest): Promise<TelegramUpdateBatch> {
      // The provider's long-poll parameters, straight from the request the transport built. No
      // margin is added to the timeout and no cap is applied to the limit: adding either would be
      // this module inventing a policy that POLL_POLICY already owns.
      const body = JSON.stringify({
        offset: request.offset,
        timeout: request.timeoutSeconds,
        limit: request.limit,
      });
      const result = await performProviderRequest(ctx, 'read_updates', body);
      if (!Array.isArray(result)) {
        throw new ProviderRequestError(
          'result_shape_unexpected',
          'the provider reported success and did not return a list of updates, so there is nothing to read and nothing is guessed',
          { operation: 'read_updates' },
        );
      }

      const updates: TelegramPolledUpdate[] = [];
      for (const element of result) {
        const keys = readUpdateKeyFields(element);
        if (keys === null) {
          // The update identifier is half the dedup key and the whole of the acknowledgement. With
          // it unreadable there is nothing to advance past, so the batch is refused rather than
          // partially read — a partially read batch would move the offset past work nobody stored.
          throw new ProviderRequestError(
            'update_key_unreadable',
            'the provider returned an update with no readable update identifier; it is half of the de-duplication key and the whole of the acknowledgement, so the batch is refused (§5.4.1, R14, R26.1)',
            { operation: 'read_updates' },
          );
        }
        updates.push({
          updateId: keys.updateId,
          // An update with no readable sender is represented rather than dropped, and is
          // represented as the empty sender rather than as an invented one. An empty allowlist
          // means nobody and no allowlist holds the empty sender, so the guard above refuses it,
          // the offset still advances, and the poller cannot wedge on an update it silently
          // discarded (R12, R26.1).
          senderId: keys.senderId ?? '',
          rawBody: JSON.stringify(element),
        });
      }
      return { updates };
    },

    async sendMessage(message: TelegramOutboundMessage): Promise<TelegramSendReceipt> {
      const body = JSON.stringify({
        chat_id: message.chatRef,
        text: message.text,
        ...(message.replyToRef === undefined ? {} : { reply_to_message_id: message.replyToRef }),
      });
      const result = await performProviderRequest(ctx, 'send_message', body);
      const messageId = isRecord(result) ? result['message_id'] : undefined;
      if (typeof messageId !== 'number' && typeof messageId !== 'string') {
        throw new ProviderRequestError(
          'send_receipt_unreadable',
          'the provider reported success without a readable message reference, so there is no receipt; a receipt is not invented for a send nobody can point at',
          { operation: 'send_message' },
        );
      }
      // The instant is the injected clock's, not the provider's: this tier takes its clock as a
      // dependency everywhere, and a receipt derived from a provider epoch field would be
      // arithmetic over an untrusted number for no gain.
      return { messageRef: String(messageId), sentAt: ctx.now() };
    },
  };
}
