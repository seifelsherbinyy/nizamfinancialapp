// @vitest-environment node
/**
 * NIZAM · The messaging provider request module, driven by a local fake responder
 * Implemented by: PFOS Contract 12 / Phase 2, task B4, seams S1 and S2 (spec 07-bot-bringup-v1)
 * Owning requirements: R11 (the credential is configured, never defaulted, never printed),
 *   R19 (no credential, no body, no sender on any log line), R24 (no deployment particular),
 *   R26.1 (the offset semantics belong to the transport above and are passed through),
 *   contract 12 §5.5.5 (the provider's rate limit is honoured by the EXISTING bounded budget)
 * Depends on: ./providerRequest, ./liveTransport (the rate-limit shape and the existing send
 *   budget's own delay function), ../ops/redactedLogger, ../config/environment (types only)
 *
 * **There is no network in this file and none in the module it tests.** The module's whole outside
 * world is the injected {@link ProviderRequestFn}, and every implementation below is a function over
 * in-memory strings: nothing opens a socket, resolves a host, or reads `.secrets/`. That is not a
 * concession for testing — it is the module's actual shape, because the capability is a parameter.
 *
 * Every value here is synthetic and deliberately unlike a credential (R24, steering §0b): no real
 * token, bot, sender, host, path or figure appears, and the base address is IANA's permanently
 * unresolvable reserved name so it can never point at anything.
 */
import { describe, expect, it } from 'vitest';

import type { EnvSource } from '../config/environment.ts';
import { createRedactedLogger } from '../ops/redactedLogger.ts';
import {
  isRateLimitRefusal,
  sendBackoffMs,
  sendRetryDelayMs,
  TelegramRateLimitRefusal,
  type TelegramSendRetryPolicy,
} from './liveTransport.ts';
import {
  createProviderTransportClient,
  gatedProviderRequest,
  performProviderRequest,
  providerCredential,
  PROVIDER_REDACTION_MARKER,
  PROVIDER_REFUSAL_REASONS,
  ProviderRequestError,
  readUpdateKeyFields,
  revealProviderCredential,
  utf8ByteLength,
  type ProviderCredential,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type ProviderRequestContext,
  type ProviderRequestFn,
} from './providerRequest.ts';

// ---------------------------------------------------------------------------------------------
// Fixtures: an environment, a clock, a log capture, and a local fake responder
// ---------------------------------------------------------------------------------------------

/** The entry names the loader reads for this agent. Spelled here only to build the fixture. */
const TOKEN_ENTRY = 'BOT_B_TOKEN';
const API_BASE_ENTRY = 'MSG_API_BASE';

/** Deliberately unlike any credential shape: a label, not a plausible secret. */
const FIXTURE_TOKEN = 'fixture-not-a-credential';
/** IANA's reserved unresolvable name. It is a shape, and it can never reach anything. */
const FIXTURE_BASE = 'https://provider.invalid';

const SENDER = 'op-1';
const REPLY_TEXT = 'your groceries category is on track this week';
const CHAT = 'chat-1';

/** The EXISTING outbound budget's shape, as `process/main.ts` declares it. Not a new policy. */
const SEND: TelegramSendRetryPolicy = { baseMs: 1_000, maxMs: 60_000, maxAttempts: 4 };

function envOf(overrides: Record<string, string | undefined> = {}): EnvSource {
  return { [TOKEN_ENTRY]: FIXTURE_TOKEN, [API_BASE_ENTRY]: FIXTURE_BASE, ...overrides };
}

function stepClock(start = Date.UTC(2026, 0, 1)): () => string {
  let ticks = 0;
  return (): string => {
    const at = new Date(start + ticks * 1_000).toISOString();
    ticks += 1;
    return at;
  };
}

/** One scripted answer: a response to hand back, or a value to throw. */
type ScriptedAnswer = ProviderHttpResponse | Error;

interface FakeResponder {
  readonly request: ProviderRequestFn;
  /** Every request object the module built. Recorded whole, which is only safe if it holds no secret. */
  readonly seen: ProviderHttpRequest[];
  /** Every credential the module passed BESIDE the request. */
  readonly credentials: ProviderCredential[];
}

/**
 * The local fake responder. It answers from a script, records what it was handed, and reaches
 * nothing. It deliberately does NOT call `revealProviderCredential`: the point of recording the
 * credential is to prove it arrived beside the request rather than inside it.
 */
function responder(script: readonly ScriptedAnswer[]): FakeResponder {
  const seen: ProviderHttpRequest[] = [];
  const credentials: ProviderCredential[] = [];
  let step = 0;
  return {
    seen,
    credentials,
    request: async (request: ProviderHttpRequest, credential: ProviderCredential): Promise<ProviderHttpResponse> => {
      seen.push(request);
      credentials.push(credential);
      const answer = script[Math.min(step, script.length - 1)];
      step += 1;
      if (answer === undefined) throw new Error('the fake responder was asked for an answer it has no script for');
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

/** A successful envelope carrying `result`. */
function answered(result: unknown, latencyMs = 12): ProviderHttpResponse {
  return { status: 200, bodyText: JSON.stringify({ ok: true, result }), latencyMs };
}

interface Harness {
  readonly ctx: ProviderRequestContext;
  readonly fake: FakeResponder;
  /** Every line the module emitted, as text, exactly as it would reach a log. */
  readonly lines: string[];
}

function harnessOf(script: readonly ScriptedAnswer[], overrides: Partial<ProviderRequestContext> = {}): Harness {
  const fake = responder(script);
  const lines: string[] = [];
  const now = stepClock();
  const ctx: ProviderRequestContext = {
    agent: 'finance',
    env: envOf(),
    request: fake.request,
    now,
    log: createRedactedLogger('finance', (line: string) => lines.push(line), now),
    ...overrides,
  };
  return { ctx, fake, lines };
}

/** The refusal reason, or the thrown value's own name when it is not this module's error. */
function reasonOf(error: unknown): string {
  if (error instanceof ProviderRequestError) return error.reason;
  return error instanceof Error ? error.name : String(error);
}

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return null;
}

/** Reasons observed across this file, so the closed set is proved reachable rather than asserted. */
const reasonsReached = new Set<string>();
function record(error: unknown): unknown {
  reasonsReached.add(reasonOf(error));
  return error;
}

// ---------------------------------------------------------------------------------------------
// The long-poll read
// ---------------------------------------------------------------------------------------------

describe('the long-poll read, over a local fake responder', () => {
  it('reads a normal update and passes the transport offset semantics through unchanged', async () => {
    const update = { update_id: 7, message: { from: { id: SENDER }, text: 'hello' } };
    const h = harnessOf([answered([update])]);
    const client = createProviderTransportClient(h.ctx);

    const batch = await client.fetchUpdates({ botId: 'bot-b', offset: 5, timeoutSeconds: 30, limit: 50 });

    expect(batch.updates).toHaveLength(1);
    expect(batch.updates[0]?.updateId).toBe(7);
    expect(batch.updates[0]?.senderId).toBe(SENDER);
    // The raw body is the update as the provider gave it, unparsed by anything downstream.
    expect(JSON.parse(batch.updates[0]?.rawBody ?? 'null')).toEqual(update);

    // The offset, the long-poll timeout and the batch bound are the ones the transport handed in.
    // Nothing is added: no margin on the timeout, no cap on the limit, no offset arithmetic (R26.1).
    const body = JSON.parse(h.fake.seen[0]?.body ?? '{}');
    expect(body).toEqual({ offset: 5, timeout: 30, limit: 50 });
    expect(h.fake.seen[0]?.operation).toBe('read_updates');
    expect(h.fake.seen[0]?.baseUrl).toBe(FIXTURE_BASE);
  });

  it('reads an empty update set as an empty batch, not as a failure', async () => {
    const h = harnessOf([answered([])]);
    const batch = await createProviderTransportClient(h.ctx).fetchUpdates({
      botId: 'bot-b',
      offset: 0,
      timeoutSeconds: 30,
      limit: 50,
    });
    expect(batch.updates).toEqual([]);
    expect(h.fake.seen).toHaveLength(1);
  });

  it('represents an update with no readable sender rather than dropping it, so the offset can advance', async () => {
    // A channel post or an edited message carries no `message.from`. Dropping it would leave the
    // offset parked on it for ever, and the poller would re-read it every cycle (R26.1).
    const h = harnessOf([answered([{ update_id: 9, channel_post: { text: 'notice' } }])]);
    const batch = await createProviderTransportClient(h.ctx).fetchUpdates({
      botId: 'bot-b',
      offset: 9,
      timeoutSeconds: 30,
      limit: 50,
    });
    expect(batch.updates[0]?.updateId).toBe(9);
    // The EMPTY sender, never an invented one. No allowlist holds it, so the guard above refuses it.
    expect(batch.updates[0]?.senderId).toBe('');
  });

  it('REFUSES the whole batch when an update carries no readable update identifier', async () => {
    const h = harnessOf([answered([{ message: { from: { id: SENDER } } }])]);
    const error = record(
      await refusalOf(() =>
        createProviderTransportClient(h.ctx).fetchUpdates({ botId: 'bot-b', offset: 0, timeoutSeconds: 30, limit: 50 }),
      ),
    );
    expect(reasonOf(error)).toBe('update_key_unreadable');
  });

  it('REFUSES a success that did not return a list of updates', async () => {
    const h = harnessOf([answered({ update_id: 1 })]);
    const error = record(
      await refusalOf(() =>
        createProviderTransportClient(h.ctx).fetchUpdates({ botId: 'bot-b', offset: 0, timeoutSeconds: 30, limit: 50 }),
      ),
    );
    expect(reasonOf(error)).toBe('result_shape_unexpected');
  });
});

// ---------------------------------------------------------------------------------------------
// Failing closed
// ---------------------------------------------------------------------------------------------

describe('failing closed', () => {
  it('REFUSES a non-success status and reads nothing from the answer', async () => {
    const h = harnessOf([{ status: 500, bodyText: JSON.stringify({ ok: true, result: [] }) }]);
    const error = record(await refusalOf(() => performProviderRequest(h.ctx, 'read_updates', '{}')));
    expect(reasonOf(error)).toBe('status_not_success');
    // Even though this body would have parsed to a usable result, nothing was read from it.
    expect((error as ProviderRequestError).detail['status']).toBe('500');
    expect((error as ProviderRequestError).code).toBe('TELEGRAM_SEND_REFUSED');
  });

  it('REFUSES a malformed body', async () => {
    const h = harnessOf([{ status: 200, bodyText: '{not json' }]);
    const error = record(await refusalOf(() => performProviderRequest(h.ctx, 'read_updates', '{}')));
    expect(reasonOf(error)).toBe('body_unparseable');
  });

  it('REFUSES an envelope that does not report success, even on a success status', async () => {
    const h = harnessOf([{ status: 200, bodyText: JSON.stringify({ ok: false, description: 'no' }) }]);
    const error = record(await refusalOf(() => performProviderRequest(h.ctx, 'read_updates', '{}')));
    expect(reasonOf(error)).toBe('envelope_not_ok');
  });

  it('REFUSES a body over the read bound BEFORE parsing it', async () => {
    // Well-formed and oversized. If the bound came after the parse, this would succeed.
    const wide = { ok: true, result: [{ update_id: 1, message: { from: { id: SENDER }, text: 'x'.repeat(400) } }] };
    const bodyText = JSON.stringify(wide);
    const h = harnessOf([{ status: 200, bodyText }], { maxResponseBytes: 64 });
    const error = record(await refusalOf(() => performProviderRequest(h.ctx, 'read_updates', '{}')));
    expect(reasonOf(error)).toBe('body_over_read_bound');
    expect((error as ProviderRequestError).detail['bound']).toBe('64');
    expect((error as ProviderRequestError).detail['bytes']).toBe(String(utf8ByteLength(bodyText)));
  });

  it('measures the read bound in bytes on the wire, not in code units', () => {
    // A multi-byte character is one code unit and more than one byte. Bounding the smaller measure
    // would let a body several times the bound through.
    expect('\u00e9'.length).toBe(1);
    expect(utf8ByteLength('\u00e9')).toBe(2);
  });

  it('REFUSES before dialling when the credential is not configured', async () => {
    const h = harnessOf([answered([])], { env: envOf({ [TOKEN_ENTRY]: undefined }) });
    const error = record(await refusalOf(() => performProviderRequest(h.ctx, 'read_updates', '{}')));
    expect(reasonOf(error)).toBe('credential_absent');
    // A configuration that fails closed is not a send refusal; it is the configuration code.
    expect((error as ProviderRequestError).code).toBe('TELEGRAM_CONFIG_FAILS_CLOSED');
    // Nothing was asked of the capability at all.
    expect(h.fake.seen).toEqual([]);
  });

  it('treats a template placeholder as unconfigured, by the loader\u2019s own rule', async () => {
    const h = harnessOf([answered([])], { env: envOf({ [TOKEN_ENTRY]: `<${TOKEN_ENTRY}>` }) });
    const error = record(await refusalOf(() => performProviderRequest(h.ctx, 'read_updates', '{}')));
    expect(reasonOf(error)).toBe('credential_absent');
    expect(h.fake.seen).toEqual([]);
  });

  it('REFUSES before dialling when the base address is not transport-secured', async () => {
    const h = harnessOf([answered([])], { env: envOf({ [API_BASE_ENTRY]: 'http://provider.invalid' }) });
    const error = record(await refusalOf(() => performProviderRequest(h.ctx, 'read_updates', '{}')));
    // The loader's own refusal, re-raised rather than restated here.
    expect((error as { code?: string }).code).toBe('ENV_API_BASE_NOT_TRANSPORT_SECURED');
    expect(h.fake.seen).toEqual([]);
  });

  it('holds no socket today: the wired capability refuses, and names the gates that supply one', async () => {
    const h = harnessOf([answered([])], { request: gatedProviderRequest() });
    const error = record(await refusalOf(() => performProviderRequest(h.ctx, 'send_message', '{}')));
    expect(reasonOf(error)).toBe('transport_gated');
    expect((error as Error).message).toContain('G3');
    expect((error as Error).message).toContain('G6');
  });
});

// ---------------------------------------------------------------------------------------------
// The provider's rate limit, honoured by the EXISTING budget
// ---------------------------------------------------------------------------------------------

describe('the provider\u2019s rate limit', () => {
  it('raises the typed refusal the existing outbound budget already waits on, carrying the hint', async () => {
    const h = harnessOf([{ status: 429, bodyText: JSON.stringify({ ok: false, parameters: { retry_after: 3 } }) }]);
    const error = record(await refusalOf(() => performProviderRequest(h.ctx, 'send_message', '{}')));

    expect(error).toBeInstanceOf(TelegramRateLimitRefusal);
    expect(isRateLimitRefusal(error)).toBe(true);
    expect((error as TelegramRateLimitRefusal).retryAfterSeconds).toBe(3);
    // The existing policy honours the advertised interval rather than estimating it, and this module
    // adds no retry loop of its own — it raises the shape that policy reads.
    expect(sendRetryDelayMs(SEND, 1, (error as TelegramRateLimitRefusal).retryAfterSeconds)).toBeGreaterThanOrEqual(3_000);
  });

  it('prefers the interval the capability read off the response over the one in the body', async () => {
    const h = harnessOf([
      {
        status: 429,
        bodyText: JSON.stringify({ ok: false, parameters: { retry_after: 3 } }),
        retryAfterSeconds: 5,
      },
    ]);
    const error = await refusalOf(() => performProviderRequest(h.ctx, 'send_message', '{}'));
    expect((error as TelegramRateLimitRefusal).retryAfterSeconds).toBe(5);
  });

  it('never reads a missing interval as \u201cretry immediately\u201d', async () => {
    const h = harnessOf([{ status: 429, bodyText: JSON.stringify({ ok: false }) }]);
    const error = await refusalOf(() => performProviderRequest(h.ctx, 'send_message', '{}'));
    expect((error as TelegramRateLimitRefusal).retryAfterSeconds).toBeNull();
    // With no advertised interval the bounded backoff is the whole of the wait, and it is not zero.
    expect(sendRetryDelayMs(SEND, 1, null)).toBe(sendBackoffMs(SEND, 1));
    expect(sendRetryDelayMs(SEND, 1, null)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The send
// ---------------------------------------------------------------------------------------------

describe('the send', () => {
  it('composes the reply, returns a receipt, and omits the reply reference when there is none', async () => {
    const h = harnessOf([answered({ message_id: 91 })]);
    const receipt = await createProviderTransportClient(h.ctx).sendMessage({
      botId: 'bot-b',
      chatRef: CHAT,
      text: REPLY_TEXT,
    });
    expect(receipt.messageRef).toBe('91');
    expect(receipt.sentAt).toMatch(/^2026-01-01T/);

    const body = JSON.parse(h.fake.seen[0]?.body ?? '{}');
    expect(body).toEqual({ chat_id: CHAT, text: REPLY_TEXT });
    expect(h.fake.seen[0]?.operation).toBe('send_message');
  });

  it('carries the reply reference when one is given', async () => {
    const h = harnessOf([answered({ message_id: 'm-2' })]);
    await createProviderTransportClient(h.ctx).sendMessage({
      botId: 'bot-b',
      chatRef: CHAT,
      text: REPLY_TEXT,
      replyToRef: 'm-1',
    });
    expect(JSON.parse(h.fake.seen[0]?.body ?? '{}')['reply_to_message_id']).toBe('m-1');
  });

  it('REFUSES to invent a receipt for a send nobody can point at', async () => {
    const h = harnessOf([answered({ date: 0 })]);
    const error = record(
      await refusalOf(() =>
        createProviderTransportClient(h.ctx).sendMessage({ botId: 'bot-b', chatRef: CHAT, text: REPLY_TEXT }),
      ),
    );
    expect(reasonOf(error)).toBe('send_receipt_unreadable');
  });
});

// ---------------------------------------------------------------------------------------------
// The credential, and what reaches a log line
// ---------------------------------------------------------------------------------------------

describe('the credential cannot be printed, and nothing sensitive reaches a log line', () => {
  it('travels BESIDE the request, so a request object may be recorded whole', async () => {
    const h = harnessOf([answered([])]);
    await performProviderRequest(h.ctx, 'read_updates', '{}');

    const recorded = JSON.stringify(h.fake.seen[0]);
    expect(recorded).not.toContain(FIXTURE_TOKEN);
    // No header field and no credential field exists on the request shape at all.
    expect(Object.keys(h.fake.seen[0] ?? {}).sort()).toEqual(['baseUrl', 'body', 'operation']);

    const credential = h.fake.credentials[0];
    expect(credential).toBeDefined();
    expect(String(credential)).toBe(PROVIDER_REDACTION_MARKER);
    expect(JSON.stringify(credential)).toBe(`"${PROVIDER_REDACTION_MARKER}"`);
    expect(`${String(credential)}`).not.toContain(FIXTURE_TOKEN);
    // And the characters are reachable exactly once, by name, for whoever composes the address.
    expect(revealProviderCredential(credential as ProviderCredential)).toBe(FIXTURE_TOKEN);
  });

  it('REFUSES to reveal a value it did not wrap', () => {
    const forged = Object.freeze({}) as unknown as ProviderCredential;
    let reason = 'none';
    try {
      revealProviderCredential(forged);
    } catch (error) {
      reason = reasonOf(record(error));
    }
    expect(reason).toBe('credential_not_wrapped');
  });

  it('writes no credential, no message text, no sender and no base address to any line', async () => {
    const h = harnessOf([
      answered([{ update_id: 3, message: { from: { id: SENDER }, text: 'what is left this month' } }]),
      answered({ message_id: 4 }),
      { status: 503, bodyText: 'unavailable' },
    ]);
    const client = createProviderTransportClient(h.ctx);
    await client.fetchUpdates({ botId: 'bot-b', offset: 0, timeoutSeconds: 30, limit: 50 });
    await client.sendMessage({ botId: 'bot-b', chatRef: CHAT, text: REPLY_TEXT });
    await refusalOf(() => client.sendMessage({ botId: 'bot-b', chatRef: CHAT, text: REPLY_TEXT }));

    // Three requests, three lines: two completed and one refused.
    expect(h.lines).toHaveLength(3);
    const all = h.lines.join('\n');
    for (const forbidden of [FIXTURE_TOKEN, REPLY_TEXT, SENDER, CHAT, FIXTURE_BASE, 'what is left this month']) {
      expect(all, `no line may carry "${forbidden}"`).not.toContain(forbidden);
    }

    // And every line is the structured record, carrying only enumerated features.
    const parsed = h.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed.map((line) => line['event'])).toEqual([
      'provider_request_completed',
      'provider_request_completed',
      'provider_request_refused',
    ]);
    for (const line of parsed) {
      expect(Object.keys(line).sort()).toEqual(['agent', 'at', 'correlationRef', 'event', 'fields', 'level']);
      const fields = line['fields'] as Record<string, { kind: string; value: unknown }>;
      for (const [name, field] of Object.entries(fields)) {
        expect(['component', 'outcome', 'failure', 'latencyMs'], `${name} is a declared feature`).toContain(name);
        expect(['enum', 'duration_ms']).toContain(field.kind);
      }
    }
    // The refusal names its reason as an enumerated code, which is a pointer and not a message.
    const refused = parsed[2]?.['fields'] as Record<string, { value: unknown }> | undefined;
    expect(refused?.['failure']?.value).toBe('status_not_success');
  });

  it('does not fail a request that worked because the capability reported no usable latency', async () => {
    const h = harnessOf([{ status: 200, bodyText: JSON.stringify({ ok: true, result: [] }), latencyMs: 1.5 }]);
    await expect(performProviderRequest(h.ctx, 'read_updates', '{}')).resolves.toEqual([]);
    const fields = (JSON.parse(h.lines[0] ?? '{}') as { fields?: Record<string, unknown> }).fields ?? {};
    // Omitted rather than rounded: this tier records integers or nothing.
    expect(Object.keys(fields).sort()).toEqual(['component', 'outcome']);
  });

  it('is still correct with no logger wired at all', async () => {
    const h = harnessOf([answered([])], { log: undefined });
    await expect(performProviderRequest(h.ctx, 'read_updates', '{}')).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The one implementation of the update key rule
// ---------------------------------------------------------------------------------------------

describe('readUpdateKeyFields', () => {
  it('tells an unreadable update identifier from an absent sender, because the consequences differ', () => {
    expect(readUpdateKeyFields(null)).toBeNull();
    expect(readUpdateKeyFields([])).toBeNull();
    expect(readUpdateKeyFields({ message: { from: { id: SENDER } } })).toBeNull();
    expect(readUpdateKeyFields({ update_id: 1.5 })).toBeNull();
    expect(readUpdateKeyFields({ update_id: 4 })).toEqual({ updateId: 4, senderId: null });
    expect(readUpdateKeyFields({ update_id: 4, message: { from: { id: 12 } } })).toEqual({
      updateId: 4,
      senderId: '12',
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The closed refusal set is reachable, not merely declared
// ---------------------------------------------------------------------------------------------

describe('the refusal set', () => {
  it('is fully reached by the cases above, so no declared reason is unreachable', () => {
    expect(PROVIDER_REFUSAL_REASONS.filter((reason) => !reasonsReached.has(reason))).toEqual([]);
  });

  it('wraps a credential holder that reports the marker for every printing path', () => {
    const held = providerCredential('x');
    expect(`${String(held)} ${JSON.stringify(held)}`).toBe(`${PROVIDER_REDACTION_MARKER} "${PROVIDER_REDACTION_MARKER}"`);
  });
});
