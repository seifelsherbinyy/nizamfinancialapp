// @vitest-environment node
/**
 * NIZAM · RUNG 1 smoke test — the messaging transport proves itself OFFLINE
 * Owning contract: PFOS Contract 12 — Two-Agent VPS Deployment & Operations
 * Phase: bringup ladder RUNG 1 (spec `ship-run-live-bringup`, task 6), the first of four rungs
 * Owning requirements: R8.1 (runs before any credential is supplied and before any network call),
 *   R8.2 (one fake seam), R8.3/R8.4 (request composition; auth applied with the credential absent
 *   from the request), R8.5 (five response shapes), R8.6 (one structured line per request, and four
 *   absences), R8.7 (the store write lands, read back through the repository), R8.9/R18.1 (this is
 *   the ONLY new test for this rung)
 * Depends on: src/server/telegram/providerRequest.ts (the module whose whole outside world is one
 *   injected parameter), src/server/telegram/liveProviderRequest.ts (`composeDialledAddress`,
 *   `readChunksBounded`, `retryAfterSecondsFromHeaders` — pure functions, no socket),
 *   src/server/telegram/liveTransport.ts, src/server/telegram/workQueueRepo.ts,
 *   src/server/db/store.ts, src/server/ops/redactedLogger.ts
 *
 * **No network, no credential, no deployment particular.** The fake is at exactly ONE seam: the
 * injected `ProviderRequestFn`. `providerRequest.ts` declares its whole outside world as that one
 * parameter and implements no socket, so the socket is a parameter rather than a global — there is
 * no loopback listener, no port and no DNS anywhere below. Every value is a synthetic test literal
 * (R24, steering §0b): the credential is a label, the base address is IANA's permanently
 * unresolvable reserved name, and `.secrets/` is never read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { agentEntryNames, type EnvSource } from '../../src/server/config/environment.ts';
import { openFinanceStore } from '../../src/server/db/store.ts';
import { createRedactedLogger } from '../../src/server/ops/redactedLogger.ts';
import type { TelegramTransportConfig } from '../../src/server/ports/telegram.ts';
import type { TelegramAcceptContext } from '../../src/server/telegram/acceptHandler.ts';
import {
  composeDialledAddress,
  readChunksBounded,
  retryAfterSecondsFromHeaders,
} from '../../src/server/telegram/liveProviderRequest.ts';
import {
  createInMemoryOffsetStore,
  createLiveTelegramTransport,
  sendRetryDelayMs,
  TelegramRateLimitRefusal,
  type TelegramSendRetryPolicy,
} from '../../src/server/telegram/liveTransport.ts';
import {
  createProviderTransportClient,
  MAX_PROVIDER_RESPONSE_BYTES,
  performProviderRequest,
  PROVIDER_REDACTION_MARKER,
  ProviderRequestError,
  type ProviderCredential,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type ProviderRequestContext,
  type ProviderRequestFn,
} from '../../src/server/telegram/providerRequest.ts';
import { claimNextWork, workQueueDepth } from '../../src/server/telegram/workQueueRepo.ts';

// ---------------------------------------------------------------------------------------------
// Synthetic fixtures. Nothing here resolves to anything, and nothing is read from disk.
// ---------------------------------------------------------------------------------------------

const AGENT = 'finance' as const;
const TOKEN_ENTRY = agentEntryNames(AGENT).botTokenEntry;
const API_BASE_ENTRY = 'MSG_API_BASE';

/** A test literal invented here, deliberately unlike a credential: a label, not a plausible secret. */
const FIXTURE_CREDENTIAL = 'rung1-synthetic-not-a-credential';
/** IANA's reserved unresolvable name. A shape that can never reach anything. */
const FIXTURE_BASE = 'https://provider.invalid';

const BOT = 'bot-under-test';
const SENDER = 'op-1';
const CHAT = 'chat-1';
const REPLY_TEXT = 'your groceries category is on track this week';
const INBOUND_TEXT = 'what is left this month';

const POLL = { timeoutSeconds: 25, limit: 10 } as const;
const SEND: TelegramSendRetryPolicy = { baseMs: 500, maxMs: 8_000, maxAttempts: 1 };

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function envOf(overrides: Record<string, string | undefined> = {}): EnvSource {
  return { [TOKEN_ENTRY]: FIXTURE_CREDENTIAL, [API_BASE_ENTRY]: FIXTURE_BASE, ...overrides };
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
  /** Every request object the module built. Recorded whole — only safe if it holds no secret. */
  readonly seen: ProviderHttpRequest[];
  /** Every credential the module passed BESIDE the request. */
  readonly credentials: ProviderCredential[];
}

/** The one fake seam. A function over in-memory strings; it opens nothing and resolves nothing. */
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

function answered(result: unknown, latencyMs = 12): ProviderHttpResponse {
  return { status: 200, bodyText: JSON.stringify({ ok: true, result }), latencyMs };
}

function updateOf(updateId: number): unknown {
  return { update_id: updateId, message: { from: { id: SENDER }, text: INBOUND_TEXT } };
}

interface Harness {
  readonly provider: ProviderRequestContext;
  readonly accept: TelegramAcceptContext;
  readonly fake: FakeResponder;
  /** Every line the transport emitted, as text, exactly as it would reach a log. */
  readonly lines: string[];
}

function openHarness(script: readonly ScriptedAnswer[], overrides: Partial<ProviderRequestContext> = {}): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-rung1-'));
  const now = stepClock();
  const { handle } = openFinanceStore(
    { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
    now,
  );
  cleanups.push(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const fake = responder(script);
  const lines: string[] = [];
  const transport: TelegramTransportConfig = {
    botId: BOT,
    expectedSecretToken: 'expected-echo-token',
    allowedSenderIds: [SENDER],
    apiBaseUrlRef: `<${API_BASE_ENTRY}>`,
    mode: 'longPoll',
    maxConcurrentWorkItems: 2,
  };
  let seq = 0;
  const accept: TelegramAcceptContext = {
    transport,
    handle,
    now,
    newId: (): string => {
      seq += 1;
      return `wq-${String(seq).padStart(3, '0')}`;
    },
  };
  const provider: ProviderRequestContext = {
    agent: AGENT,
    env: envOf(),
    request: fake.request,
    now,
    log: createRedactedLogger(AGENT, (line: string) => lines.push(line), now),
    ...overrides,
  };
  return { provider, accept, fake, lines };
}

function liveOf(harness: Harness): ReturnType<typeof createLiveTelegramTransport> {
  return createLiveTelegramTransport({
    accept: harness.accept,
    client: createProviderTransportClient(harness.provider),
    worker: { process: async () => ({ outcome: 'done' as const }) },
    poll: POLL,
    send: SEND,
    sleep: async () => undefined,
    offsets: createInMemoryOffsetStore(),
  });
}

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return null;
}

/** The fine-grained refusal reason, which is a discriminator and never a message. */
function reasonOf(error: unknown): string {
  return error instanceof ProviderRequestError ? error.reason : error instanceof Error ? error.name : String(error);
}

// ---------------------------------------------------------------------------------------------
// Proof (a) — request composition
// ---------------------------------------------------------------------------------------------

describe('RUNG 1 proof (a): the request the fake responder receives is composed correctly', () => {
  it('carries the resolved base, the operation, and the transport\u2019s own long-poll parameters', async () => {
    const harness = openHarness([answered([updateOf(7)])]);
    await liveOf(harness).pollOnce();

    expect(harness.fake.seen).toHaveLength(1);
    const request = harness.fake.seen[0];
    expect(request?.baseUrl).toBe(FIXTURE_BASE);
    expect(request?.operation).toBe('read_updates');
    // The offset, the timeout and the batch bound are the ones the transport handed in: no margin
    // added, no cap applied, no offset arithmetic (R26.1).
    expect(JSON.parse(request?.body ?? '{}')).toEqual({ offset: 0, timeout: POLL.timeoutSeconds, limit: POLL.limit });
  });

  it('composes the outbound send from the reply it was given, and nothing else', async () => {
    const harness = openHarness([answered({ message_id: 'm-2' })]);
    const receipt = await liveOf(harness).port.outbound.send({ botId: BOT, chatRef: CHAT, text: REPLY_TEXT });

    expect(receipt.messageRef).toBe('m-2');
    expect(harness.fake.seen[0]?.operation).toBe('send_message');
    expect(JSON.parse(harness.fake.seen[0]?.body ?? '{}')).toEqual({ chat_id: CHAT, text: REPLY_TEXT });
  });
});

// ---------------------------------------------------------------------------------------------
// Proof (b) — authentication IS applied, and the credential is absent from the request
// ---------------------------------------------------------------------------------------------

describe('RUNG 1 proof (b): authentication is applied while the credential stays out of the request', () => {
  it('reaches the ONE reveal site with a credential, so authentication is genuinely applied', async () => {
    const harness = openHarness([answered([])]);
    await liveOf(harness).pollOnce();

    const request = harness.fake.seen[0];
    const credential = harness.fake.credentials[0];
    expect(request).toBeDefined();
    expect(credential).toBeDefined();

    // `composeDialledAddress` is the single `revealSecret` site. Driving it here proves the pair the
    // dialler is handed is sufficient to authenticate — the OUTCOME, not the structure.
    const dialled = composeDialledAddress(
      request?.baseUrl ?? '',
      credential as ProviderCredential,
      request?.operation ?? 'read_updates',
    );
    expect(dialled).toContain(FIXTURE_CREDENTIAL);
    expect(dialled.startsWith(`${FIXTURE_BASE}/`)).toBe(true);
  });

  it('keeps the credential value out of the request object entirely, so it may be recorded whole', async () => {
    const harness = openHarness([answered([])]);
    await liveOf(harness).pollOnce();

    const request = harness.fake.seen[0];
    // The whole request object, serialised. This is the Evidence_Of_Record proof (a) quotes.
    expect(JSON.stringify(request)).not.toContain(FIXTURE_CREDENTIAL);
    // There is no field for an authorization value at all — not a header field, not a credential
    // field. The credential travels BESIDE the request.
    expect(Object.keys(request ?? {}).sort()).toEqual(['baseUrl', 'body', 'operation']);

    // And the holder beside it cannot be printed: every stringification path yields the marker.
    const credential = harness.fake.credentials[0];
    expect(String(credential)).toBe(PROVIDER_REDACTION_MARKER);
    expect(JSON.stringify(credential)).toBe(`"${PROVIDER_REDACTION_MARKER}"`);
    expect(JSON.stringify({ request, credential })).not.toContain(FIXTURE_CREDENTIAL);
  });
});

// ---------------------------------------------------------------------------------------------
// Proof (c) — the reader is total across five response shapes, discriminated on the code
// ---------------------------------------------------------------------------------------------

describe('RUNG 1 proof (c): five response shapes, each answered or refused by code', () => {
  it('shape 1 — a success body yields the validated result', async () => {
    const harness = openHarness([answered([updateOf(1)])]);
    await expect(performProviderRequest(harness.provider, 'read_updates', '{}')).resolves.toEqual([updateOf(1)]);
  });

  it('shape 2 — a non-success status is refused, and nothing is read from the answer', async () => {
    // The body would have parsed to a usable result. Nothing is read from it regardless.
    const harness = openHarness([{ status: 500, bodyText: JSON.stringify({ ok: true, result: [] }) }]);
    const error = await refusalOf(() => performProviderRequest(harness.provider, 'read_updates', '{}'));
    expect(reasonOf(error)).toBe('status_not_success');
    expect((error as ProviderRequestError).code).toBe('TELEGRAM_SEND_REFUSED');
  });

  it('shape 3 — a rate limit carrying a retry hint becomes the typed refusal the existing budget waits on', async () => {
    // The hint is READ off the headers by the dialler's own reader, and obeyed by nobody here.
    const advertised = retryAfterSecondsFromHeaders({ 'Retry-After': '3' });
    expect(advertised).toBe(3);

    const harness = openHarness([
      { status: 429, bodyText: JSON.stringify({ ok: false }), retryAfterSeconds: advertised },
    ]);
    const error = await refusalOf(() => performProviderRequest(harness.provider, 'send_message', '{}'));

    expect(error).toBeInstanceOf(TelegramRateLimitRefusal);
    expect((error as TelegramRateLimitRefusal).code).toBe('TELEGRAM_SEND_REFUSED');
    expect((error as TelegramRateLimitRefusal).retryAfterSeconds).toBe(3);
    // The EXISTING outbound budget is what waits on it, and it honours the advertised interval.
    expect(sendRetryDelayMs(SEND, 1, (error as TelegramRateLimitRefusal).retryAfterSeconds)).toBeGreaterThanOrEqual(3_000);
  });

  it('shape 4 — a malformed body is refused rather than partially trusted', async () => {
    const harness = openHarness([{ status: 200, bodyText: '{not json' }]);
    const error = await refusalOf(() => performProviderRequest(harness.provider, 'read_updates', '{}'));
    expect(reasonOf(error)).toBe('body_unparseable');
  });

  it('shape 5 — a body over MAX_PROVIDER_RESPONSE_BYTES is refused with body_over_read_bound', async () => {
    // The dialler's bounded read stops once the bound is EXCEEDED and reports that it truncated.
    const chunk = new Uint8Array(262_144).fill(0x78);
    const read = readChunksBounded([chunk, chunk, chunk, chunk, chunk], MAX_PROVIDER_RESPONSE_BYTES);
    expect(read.truncated).toBe(true);
    expect(read.bytes).toBeGreaterThan(MAX_PROVIDER_RESPONSE_BYTES);

    const harness = openHarness([{ status: 200, bodyText: read.text }]);
    const error = await refusalOf(() => performProviderRequest(harness.provider, 'read_updates', '{}'));
    expect(reasonOf(error)).toBe('body_over_read_bound');
    expect((error as ProviderRequestError).detail['bound']).toBe(String(MAX_PROVIDER_RESPONSE_BYTES));
  });

  it('an absent status reports 0, which is outside the success range, so the reader refuses', async () => {
    const harness = openHarness([{ status: 0, bodyText: JSON.stringify({ ok: true, result: [] }) }]);
    const error = await refusalOf(() => performProviderRequest(harness.provider, 'read_updates', '{}'));
    expect(reasonOf(error)).toBe('status_not_success');
  });
});

// ---------------------------------------------------------------------------------------------
// Proof (d) — exactly one structured line per request, and four absences
// ---------------------------------------------------------------------------------------------

describe('RUNG 1 proof (d): one structured telemetry line per request, carrying none of the four', () => {
  it('emits exactly one line per request and excludes credential, body, sender and base address', async () => {
    const harness = openHarness([
      answered([updateOf(3)]),
      answered({ message_id: 'm-4' }),
      { status: 503, bodyText: 'unavailable' },
    ]);
    const live = liveOf(harness);

    await live.pollOnce();
    await live.port.outbound.send({ botId: BOT, chatRef: CHAT, text: REPLY_TEXT });
    await refusalOf(() => live.port.outbound.send({ botId: BOT, chatRef: CHAT, text: REPLY_TEXT }));

    // Three requests reached the seam, and three lines were written. Exactly one each.
    expect(harness.fake.seen).toHaveLength(3);
    expect(harness.lines).toHaveLength(3);

    const all = harness.lines.join('\n');
    for (const absent of [FIXTURE_CREDENTIAL, REPLY_TEXT, INBOUND_TEXT, SENDER, CHAT, FIXTURE_BASE]) {
      expect(all, `no line may carry "${absent}"`).not.toContain(absent);
    }
    // The request bodies themselves, verbatim, are absent too.
    for (const request of harness.fake.seen) expect(all).not.toContain(request.body);

    const parsed = harness.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed.map((line) => line['event'])).toEqual([
      'provider_request_completed',
      'provider_request_completed',
      'provider_request_refused',
    ]);
    for (const line of parsed) {
      const fields = line['fields'] as Record<string, { kind: string }>;
      for (const [name, field] of Object.entries(fields)) {
        expect(['component', 'outcome', 'failure', 'latencyMs'], `${name} is a declared feature`).toContain(name);
        expect(['enum', 'duration_ms']).toContain(field.kind);
      }
    }
    // The refusal names an enumerated code, which is a pointer rather than a message.
    const refused = parsed[2]?.['fields'] as Record<string, { value: unknown }> | undefined;
    expect(refused?.['failure']?.value).toBe('status_not_success');
  });
});

// ---------------------------------------------------------------------------------------------
// Proof (e) — the store write LANDS, read back through the repository
// ---------------------------------------------------------------------------------------------

describe('RUNG 1 proof (e): the store write lands, read back through the repository', () => {
  it('reads the enqueued row back out of the store rather than trusting the write\u2019s return value', async () => {
    const harness = openHarness([answered([updateOf(11)])]);
    const live = liveOf(harness);

    const report = await live.pollOnce();
    expect(report.results[0]?.outcome).toBe('enqueued');

    // The write's own return value is deliberately NOT the evidence. A write returning is not a
    // write landing (same logic as R22.2), so the row is read back through the repository.
    const queue = { handle: harness.accept.handle, now: harness.accept.now, newId: harness.accept.newId };
    expect(workQueueDepth(queue).queued).toBe(1);

    const readBack = claimNextWork(queue, 1);
    expect(readBack).toHaveLength(1);
    expect(readBack[0]?.botId).toBe(BOT);
    expect(readBack[0]?.updateId).toBe(11);
    expect(readBack[0]?.senderId).toBe(SENDER);
    // The raw body survived the acknowledgement intact, which is the whole point of the durable row.
    expect(JSON.parse(readBack[0]?.rawBody ?? 'null')).toEqual(updateOf(11));

    // And the offset advanced only after that row was durable (R26.1).
    expect(report.offsetAfter).toBe(12);
    expect(live.currentOffset()).toBe(12);
  });
});
