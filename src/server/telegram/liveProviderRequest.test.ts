// @vitest-environment node
/**
 * NIZAM · The messaging provider dialler — every pure part, and not one dial
 * Implemented by: PFOS Contract 12 / Phase 2, task B4 decision **D-DIALLER**, seams S1 and S2
 *   (spec 07-bot-bringup-v1)
 * Owning requirements: R11 (the credential is revealed once, where the address is composed),
 *   R19 (no credential, no address, no body in any message or any thrown value's detail),
 *   R24 (no deployment particular in a fixture), contract 12 §5.5.5 (the bounded budgets are the
 *   ones that already exist, so the dialler holds none)
 * Depends on: ./liveProviderRequest, ./providerRequest (the credential holder, the read bound, and
 *   the existing fail-closed reader this file composes the bounded read against)
 *
 * **NO NETWORK CALL IS MADE BY THIS FILE.** The capability {@link createLiveProviderRequest} returns
 * is CONSTRUCTED below and never invoked — not against a provider, not against loopback, not against
 * a fake listener. Constructing it opens nothing; only calling it would dial. So what is tested here
 * is every part that can be tested honestly without a socket:
 *
 *   the address composition · the derived deadline · the bounded read, composed against the
 *   EXISTING reader so the refusal it produces is observed · the advertised-interval header read ·
 *   the refusal shape · and the module's own source, for the properties a runtime probe cannot show.
 *
 * **What is therefore NOT tested, stated rather than hidden:** the socket itself. Whether the platform
 * returns the bytes we expect, whether a real peer times out inside the derived deadline, and whether
 * a real oversized answer is truncated at the bound are all observable only by dialling. They are left
 * untested on purpose, and the first exercise of that path is the owner's on the host after gate G3.
 *
 * Every value here is synthetic (R24): the base is IANA's permanently unresolvable reserved name, so
 * even a composed address could not reach anything, and the token is a label rather than a plausible
 * credential.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  composeDialledAddress,
  createLiveProviderRequest,
  isLiveProviderRequest,
  PROVIDER_DIAL_FAILURE_CODES,
  PROVIDER_METHOD_NAMES,
  PROVIDER_TIMEOUT_FACTOR,
  providerRequestTimeoutMs,
  ProviderDialError,
  readChunksBounded,
  RETRY_AFTER_HEADER,
  retryAfterSecondsFromHeaders,
} from './liveProviderRequest.ts';
import {
  gatedProviderRequest,
  MAX_PROVIDER_RESPONSE_BYTES,
  performProviderRequest,
  providerCredential,
  PROVIDER_OPERATIONS,
  ProviderRequestError,
  utf8ByteLength,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type ProviderRequestContext,
  type ProviderRequestFn,
} from './providerRequest.ts';

// ---------------------------------------------------------------------------------------------
// Fixtures — synthetic, and unable to reach anything even if something tried
// ---------------------------------------------------------------------------------------------

/** IANA's reserved unresolvable name. A shape, and permanently not a destination. */
const FIXTURE_BASE = 'https://provider.invalid';
/** Deliberately unlike a credential: a label, not a plausible secret. */
const FIXTURE_TOKEN = 'fixture-not-a-credential';

const TOKEN_ENTRY = 'BOT_B_TOKEN';
const API_BASE_ENTRY = 'MSG_API_BASE';

/** The long-poll timeout `process/main.ts` already declares. Not a new policy — the same one. */
const POLL_TIMEOUT_SECONDS = 30;

const SOURCE = readFileSync(fileURLToPath(new URL('./liveProviderRequest.ts', import.meta.url)), 'utf8');

/** The module with its prose removed, so a scan reads what the module DOES, not what it says. */
const EXECUTABLE = SOURCE.split('\n')
  .filter((line) => !/^\s*(?:\/\*|\*|\/\/)/.test(line))
  .join('\n');

function credentialOf(value = FIXTURE_TOKEN): ReturnType<typeof providerCredential> {
  return providerCredential(value);
}

// ---------------------------------------------------------------------------------------------
// The address — composed in one place, from the base and the revealed credential
// ---------------------------------------------------------------------------------------------

describe('the dialled address is composed here and nowhere else (R11)', () => {
  it('joins the resolved base, the credential segment and the provider method', () => {
    for (const operation of PROVIDER_OPERATIONS) {
      const address = composeDialledAddress(FIXTURE_BASE, credentialOf(), operation);
      expect(address.startsWith(`${FIXTURE_BASE}/`)).toBe(true);
      expect(address).toContain(FIXTURE_TOKEN);
      expect(address.endsWith(`/${PROVIDER_METHOD_NAMES[operation]}`)).toBe(true);
    }
  });

  it('names one method per declared operation, and no method for anything else', () => {
    expect(Object.keys(PROVIDER_METHOD_NAMES).sort()).toEqual([...PROVIDER_OPERATIONS].sort());
  });

  it('does not double the separator when the resolved base carries a trailing one', () => {
    const address = composeDialledAddress(`${FIXTURE_BASE}/`, credentialOf(), 'send_message');
    expect(address).not.toContain('//bot');
    expect(address.startsWith(`${FIXTURE_BASE}/`)).toBe(true);
  });

  it('refuses to put a credential on an unsecured address, whatever the loader did', () => {
    for (const base of ['http://provider.invalid', 'provider.invalid', '']) {
      let code = 'none';
      try {
        composeDialledAddress(base, credentialOf(), 'read_updates');
      } catch (error) {
        code = error instanceof ProviderDialError ? error.code : 'not-a-dial-error';
      }
      expect(code, base).toBe('PROVIDER_DIAL_BASE_UNSECURED');
    }
  });

  it('is the only caller of the one reveal, and calls it once', () => {
    const calls = EXECUTABLE.match(/revealProviderCredential\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// The deadline — derived, never invented
// ---------------------------------------------------------------------------------------------

describe('the request deadline is derived from the long-poll timeout the caller supplies', () => {
  it('exceeds the hold it was derived from, so a successful long poll is never self-aborted', () => {
    const derived = providerRequestTimeoutMs(POLL_TIMEOUT_SECONDS);
    expect(derived).toBe(POLL_TIMEOUT_SECONDS * 1_000 * PROVIDER_TIMEOUT_FACTOR);
    expect(derived).toBeGreaterThan(POLL_TIMEOUT_SECONDS * 1_000);
  });

  it('refuses an unusable hold rather than defaulting to a deadline of its own', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => providerRequestTimeoutMs(bad), String(bad)).toThrow(RangeError);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The bounded read — and the refusal it produces in the EXISTING reader
// ---------------------------------------------------------------------------------------------

/** A responder that reports exactly what it is given. Reaches nothing; it is a function over strings. */
function reportingResponder(response: ProviderHttpResponse): ProviderRequestFn {
  return async (_request: ProviderHttpRequest): Promise<ProviderHttpResponse> => response;
}

function contextOf(request: ProviderRequestFn, maxResponseBytes?: number): ProviderRequestContext {
  return {
    agent: 'finance',
    env: { [TOKEN_ENTRY]: FIXTURE_TOKEN, [API_BASE_ENTRY]: FIXTURE_BASE },
    request,
    now: () => new Date(Date.UTC(2026, 0, 1)).toISOString(),
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
  };
}

describe('the read is bounded in bytes on the wire', () => {
  it('returns the whole answer when it is within the bound', () => {
    const body = '{"ok":true,"result":[]}';
    const read = readChunksBounded([new TextEncoder().encode(body)], 64);
    expect(read.truncated).toBe(false);
    expect(read.text).toBe(body);
    expect(read.bytes).toBe(utf8ByteLength(body));
  });

  it('counts bytes rather than code units, so a wide character is not measured cheaply', () => {
    // Two code units, four bytes. A bound in code units would be the weaker bound.
    const wide = '\u{1F600}';
    expect(wide.length).toBe(2);
    expect(readChunksBounded([new TextEncoder().encode(wide)], 8).bytes).toBe(4);
    expect(readChunksBounded([new TextEncoder().encode(wide)], 3).truncated).toBe(true);
  });

  it('reads up to the bound without truncating, because the bound itself is allowed', () => {
    const read = readChunksBounded([new Uint8Array(8)], 8);
    expect(read.bytes).toBe(8);
    expect(read.truncated).toBe(false);
  });

  it('stops once the bound is EXCEEDED, and reports enough for the existing reader to refuse it', async () => {
    const read = readChunksBounded([new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)], 6);
    expect(read.truncated).toBe(true);
    // Stopped after the chunk that crossed the bound, not after all three: the rest was never read.
    expect(read.bytes).toBe(8);
    expect(read.bytes).toBeGreaterThan(6);

    // The composition that matters: a report like this reaches the EXISTING fail-closed reader and
    // is refused as over the bound, rather than being parsed as a truncated body.
    let reason = 'none';
    try {
      await performProviderRequest(
        contextOf(reportingResponder({ status: 200, bodyText: read.text, latencyMs: 1 }), 6),
        'read_updates',
        '{}',
      );
    } catch (error) {
      reason = error instanceof ProviderRequestError ? error.reason : 'not-a-provider-error';
    }
    expect(reason).toBe('body_over_read_bound');
  });

  it('defaults to the bound the existing module already declares, not to one of its own', () => {
    expect(EXECUTABLE).toContain('MAX_PROVIDER_RESPONSE_BYTES');
    expect(MAX_PROVIDER_RESPONSE_BYTES).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The advertised interval — read off the headers, and obeyed by nobody here
// ---------------------------------------------------------------------------------------------

describe('the advertised retry interval is read off the response headers', () => {
  it('reports a positive whole number of seconds, however the header name is cased', () => {
    expect(retryAfterSecondsFromHeaders({ [RETRY_AFTER_HEADER]: '17' })).toBe(17);
    expect(retryAfterSecondsFromHeaders({ 'Retry-After': ' 5 ' })).toBe(5);
    expect(retryAfterSecondsFromHeaders({ [RETRY_AFTER_HEADER]: ['9', '3'] })).toBe(9);
  });

  it('reports null for anything it cannot read, and null never means "retry immediately"', () => {
    expect(retryAfterSecondsFromHeaders({})).toBeNull();
    expect(retryAfterSecondsFromHeaders({ [RETRY_AFTER_HEADER]: '0' })).toBeNull();
    expect(retryAfterSecondsFromHeaders({ [RETRY_AFTER_HEADER]: '-4' })).toBeNull();
    expect(retryAfterSecondsFromHeaders({ [RETRY_AFTER_HEADER]: '2.5' })).toBeNull();
    expect(retryAfterSecondsFromHeaders({ [RETRY_AFTER_HEADER]: 'Wed, 21 Oct' })).toBeNull();
    expect(retryAfterSecondsFromHeaders({ [RETRY_AFTER_HEADER]: undefined })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The refusal shape — a code, an operation, and nothing else
// ---------------------------------------------------------------------------------------------

describe('a refused dial discloses a code and an operation, and nothing else (R19, R24)', () => {
  it('carries no address, no credential and no body, and chains no platform error', () => {
    const error = new ProviderDialError('PROVIDER_DIAL_UNREACHABLE', 'send_message');
    expect(Object.keys(error.detail)).toEqual(['operation']);
    expect(error.detail.operation).toBe('send_message');
    const rendered = `${error.message} ${JSON.stringify(error.detail)}`;
    expect(rendered).not.toContain(FIXTURE_TOKEN);
    expect(rendered).not.toContain('provider.invalid');
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });

  it('names three reasons no answer exists, each a single token fit for an enumerated field', () => {
    expect(PROVIDER_DIAL_FAILURE_CODES).toHaveLength(3);
    for (const code of PROVIDER_DIAL_FAILURE_CODES) expect(code).toMatch(/^[A-Z_]+$/);
  });
});

// ---------------------------------------------------------------------------------------------
// The marker — how the process proves WHICH capability it wired, without invoking it
// ---------------------------------------------------------------------------------------------

describe('the live capability is recognisable by identity rather than by being called', () => {
  it('recognises a capability it minted, and constructing one dials nothing', () => {
    const dial = createLiveProviderRequest({ pollTimeoutSeconds: POLL_TIMEOUT_SECONDS });
    // Asserted, and then deliberately NOT invoked. See this file's header.
    expect(isLiveProviderRequest(dial)).toBe(true);
    expect(typeof dial).toBe('function');
  });

  it('refuses to recognise the gated capability, or any other function', () => {
    expect(isLiveProviderRequest(gatedProviderRequest())).toBe(false);
    const impostor: ProviderRequestFn = async () => ({ status: 200, bodyText: '' });
    expect(isLiveProviderRequest(impostor)).toBe(false);
  });

  it('refuses an unusable hold at CONSTRUCTION, so a bad deadline never reaches a socket', () => {
    expect(() => createLiveProviderRequest({ pollTimeoutSeconds: 0 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------
// The source — the properties a runtime probe cannot show
// ---------------------------------------------------------------------------------------------

describe('the dialler holds a socket and no policy', () => {
  it('names exactly one network facility, and it is the platform\'s own', () => {
    expect(EXECUTABLE).toContain("from 'node:https'");
    for (const other of ['fetch(', 'XMLHttpRequest', 'net.connect', 'axios', 'node-fetch']) {
      expect(EXECUTABLE, other).not.toContain(other);
    }
  });

  it('writes nothing anywhere: no logger, no sink, no console', () => {
    for (const writer of ['console.', 'redactedLogger', 'logSink', 'process.stdout']) {
      expect(EXECUTABLE, writer).not.toContain(writer);
    }
  });

  it('holds no retry budget, no backoff, and no success range', () => {
    for (const policy of ['maxAttempts', 'backoff', 'Backoff', 'SUCCESS_STATUS', 'setWebhook']) {
      expect(EXECUTABLE, policy).not.toContain(policy);
    }
  });

  it('reads no envelope: it reports body text and judges none of it', () => {
    for (const judgement of ['JSON.parse', "['ok']", '.ok ===']) {
      expect(EXECUTABLE, judgement).not.toContain(judgement);
    }
  });
});
