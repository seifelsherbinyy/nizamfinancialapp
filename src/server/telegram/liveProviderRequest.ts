/**
 * NIZAM · The messaging provider DIALLER — the one module in this tree that holds a socket
 * Implemented by: PFOS Contract 12 / Phase 2, task B4 decision **D-DIALLER**, seams S1 and S2
 *   (spec 07-bot-bringup-v1)
 * Owning requirements: R11 (the credential is revealed at the one moment an address is composed,
 *   and nowhere else), R19 (no credential, no address, no body on any line, in any message, or in
 *   any thrown value's detail), R24 (no deployment particular: no host, no port, no secret path
 *   segment, no bot, no sender, no figure), contract 12 §5.5.5 (the provider's documented limits
 *   are honoured by the EXISTING bounded budgets, so this module holds none of them)
 * Depends on: `node:https` and `node:buffer` (the platform's own facilities, and nothing else —
 *   no dependency is added), ./providerRequest (the request and response shapes, the credential
 *   holder, the read bound, and {@link revealProviderCredential}). It imports no logger, no store,
 *   no clock module, no environment loader, and no policy.
 *
 * ## What this module is, and what it deliberately is not
 *
 * `providerRequest.ts` composes the request, resolves the credential, holds the read bound and
 * judges the answer, and declares its whole outside world as one injected parameter —
 * {@link ProviderRequestFn} — which it does not implement. `gatedProviderRequest()` is the
 * implementation that holds no socket and refuses. **This module is the implementation that dials.**
 *
 * Steering §2's BUILD NOW column lists the messaging transport as build-now behind an injected port,
 * and `pfos-current.md` says "the live adapter is a separate, later, gated module". What §2 gates is
 * *making* an outbound call from a server process, not *writing* the adapter that would make one.
 * `src/features/benchmark/liveModelCaller.ts` is the precedent on the model side of the tier: a live
 * caller that exists in the tree and is only exercised under an authorised carve-out. This is the
 * same shape on the messaging side, and the gate is now expressed as a **selection** in
 * `process/main.ts` rather than as an unwritten file.
 *
 * **Nothing in the test suite invokes the function this module returns.** There is no fake responder
 * for it, no loopback listener, and no recorded transcript: a dialler tested by dialling would be a
 * network call, and the whole point of the split is that the suite makes none. What the suite tests
 * is every pure part — the address composition, the bounded read, the header read, the timeout
 * derivation — and, in `process/main.ts`'s tests, that the *selection* picks this function by
 * identity. The socket itself is exercised for the first time by the owner, on the host, after G3.
 *
 * ## No policy lives here
 *
 * This module dials and reports. It performs no retry, reads no envelope, and interprets no status:
 *
 *  - **No retry.** The bounded budgets are `SEND_RETRY_POLICY` and `POLL_POLICY` in `process/main.ts`,
 *    already threaded into `createLiveTelegramTransport`. A second budget over the same limit is how
 *    two halves of one policy come to disagree.
 *  - **No status interpretation.** The status is reported as the provider gave it. An absent status is
 *    reported as `0`, which is outside the success range, so the existing reader refuses it — this
 *    module does not decide that, it just does not invent a success.
 *  - **No envelope reading.** The body is reported as text. Whether it parses, whether it reports
 *    success, and whether its `result` has the expected shape are all
 *    {@link performProviderRequest}'s judgements, and they stay there.
 *  - **The advertised retry interval is READ, not obeyed.** {@link retryAfterSecondsFromHeaders}
 *    reports what the provider advertised; the existing rate-limit refusal is what waits on it.
 *
 * ## What never leaves this module
 *
 * The composed address contains the credential, because that is the shape of the provider's
 * addressing. So the address is a local `const` and it reaches nothing: there is no logger in this
 * file, no `console`, and no sink. Every refusal is a {@link ProviderDialError} carrying an
 * enumerated code and the operation name — and **never** the platform's own error, because a socket
 * failure's message carries the host it failed to reach. That error is discarded rather than chained:
 * a `cause` would smuggle the address into every handler that formats an error tree.
 *
 * ## Two bounds, and both are derived rather than invented
 *
 *  - **The read bound** is `MAX_PROVIDER_RESPONSE_BYTES` from `providerRequest.ts`, measured in bytes
 *    on the wire. Reading stops at the bound rather than buffering to the end, and the truncated read
 *    is reported so the existing reader refuses it with `body_over_read_bound`.
 *  - **The request timeout** is derived from the long-poll timeout the caller already supplies —
 *    see {@link providerRequestTimeoutMs}. It is not a second policy; it is the one policy, doubled,
 *    because a socket deadline shorter than the long poll would abort every successful long poll.
 */
import { Buffer } from 'node:buffer';
import { request as httpsRequest } from 'node:https';

import {
  MAX_PROVIDER_RESPONSE_BYTES,
  revealProviderCredential,
  type ProviderCredential,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type ProviderOperation,
  type ProviderRequestFn,
} from './providerRequest.ts';

// ---------------------------------------------------------------------------------------------
// Refusals — an enumerated code, an operation name, and nothing else
// ---------------------------------------------------------------------------------------------

/**
 * Why a dial refused. Three codes, each a single token so it is legal as an enumerated log field
 * value where the existing reader records one (§6.4, R19).
 */
export const PROVIDER_DIAL_FAILURE_CODES = [
  'PROVIDER_DIAL_BASE_UNSECURED',
  'PROVIDER_DIAL_UNREACHABLE',
  'PROVIDER_DIAL_TIMED_OUT',
] as const;

export type ProviderDialFailureCode = (typeof PROVIDER_DIAL_FAILURE_CODES)[number];

/**
 * A refused dial.
 *
 * `detail` has one field, the operation name, and there is no shape here that could hold an address,
 * a credential, or a body. The platform's own error is deliberately NOT attached as a `cause`: its
 * message names the host it could not reach, and this repository never discloses one (R24).
 */
export class ProviderDialError extends Error {
  readonly code: ProviderDialFailureCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: ProviderDialFailureCode, operation: ProviderOperation) {
    super(
      `NIZAM messaging dialler: the request was refused before an answer could be read (${code}); neither the address nor the body is reported here (R19, R24)`,
    );
    this.name = 'ProviderDialError';
    this.code = code;
    this.detail = Object.freeze({ operation });
  }
}

// ---------------------------------------------------------------------------------------------
// The address — composed here, and only here
// ---------------------------------------------------------------------------------------------

/**
 * The provider's published method name per operation.
 *
 * `providerRequest.ts` deliberately does not spell these: it declares the closed operation pair and
 * leaves the provider's method vocabulary to "the capability that dials". This is that capability, so
 * this is where the two names live. They are the provider's own public API vocabulary — not a host,
 * not a port, not a secret path segment, and not a deployment particular (R24).
 */
export const PROVIDER_METHOD_NAMES: Readonly<Record<ProviderOperation, string>> = Object.freeze({
  read_updates: 'getUpdates',
  send_message: 'sendMessage',
});

/** The prefix the provider's addressing puts in front of the credential segment. */
const CREDENTIAL_SEGMENT_PREFIX = 'bot';

/** The one scheme a credential-bearing address may travel over. */
const SECURED_TRANSPORT_PREFIX = 'https://';

/**
 * Compose the address this dial will use, from the RESOLVED base and the REVEALED credential.
 *
 * This is the only function in the repository that calls {@link revealProviderCredential}, and the
 * only place the two are put together. Its return value is held in a local and handed straight to the
 * platform; it is never logged, never returned upward, and never placed in an error.
 *
 * The transport-security check is a belt at the one point a credential goes on a wire. `parseApiBase`
 * already asserted it when the base was resolved; asserting it again here costs one comparison and
 * means the credential cannot reach an unsecured address even if a caller assembled a request without
 * going through the loader.
 *
 * @throws {ProviderDialError} `PROVIDER_DIAL_BASE_UNSECURED` for a base that is not transport-secured.
 */
export function composeDialledAddress(
  baseUrl: string,
  credential: ProviderCredential,
  operation: ProviderOperation,
): string {
  if (!baseUrl.startsWith(SECURED_TRANSPORT_PREFIX)) {
    throw new ProviderDialError('PROVIDER_DIAL_BASE_UNSECURED', operation);
  }
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const method = PROVIDER_METHOD_NAMES[operation];
  return `${base}/${CREDENTIAL_SEGMENT_PREFIX}${revealProviderCredential(credential)}/${method}`;
}

// ---------------------------------------------------------------------------------------------
// The timeout, derived from the policy that already exists
// ---------------------------------------------------------------------------------------------

/**
 * How much longer than the long poll the socket is allowed to take. One factor, not a second policy:
 * the deadline must strictly exceed the hold the caller asked the provider for, or every successful
 * long poll would be aborted by its own timeout.
 */
export const PROVIDER_TIMEOUT_FACTOR = 2;

/**
 * The request deadline in whole milliseconds, derived from the long-poll timeout `POLL_POLICY` already
 * supplies. A non-positive or non-integer input is refused rather than defaulted: a dialler with no
 * deadline is a socket that can wedge the loop, which is the failure this derivation exists to
 * prevent.
 */
export function providerRequestTimeoutMs(pollTimeoutSeconds: number): number {
  if (!Number.isSafeInteger(pollTimeoutSeconds) || pollTimeoutSeconds < 1) {
    throw new RangeError(
      'NIZAM messaging dialler: the request deadline is derived from the long-poll timeout, so that timeout must be a positive whole number of seconds; there is no default deadline, because a dial without one can wedge the loop',
    );
  }
  return pollTimeoutSeconds * 1_000 * PROVIDER_TIMEOUT_FACTOR;
}

// ---------------------------------------------------------------------------------------------
// The bounded read, and the header read
// ---------------------------------------------------------------------------------------------

/** What a bounded read produced. `bytes` is what was accumulated, which exceeds the bound when truncated. */
export interface BoundedRead {
  readonly text: string;
  readonly bytes: number;
  /** True when reading stopped at the bound rather than at the end of the answer. */
  readonly truncated: boolean;
}

/**
 * Accumulate chunks until the bound is EXCEEDED, then stop.
 *
 * Exceeded rather than reached, deliberately. The existing reader refuses a body whose byte count is
 * strictly greater than its bound; stopping exactly AT the bound would hand it a truncated body that
 * counts as within bounds, and it would then refuse it as unparseable — the right outcome for the
 * wrong reason, and a reason that hides the fact that the provider sent too much.
 *
 * Extracted as a pure function over chunks so the bound is tested without a socket. The dialler below
 * applies exactly this rule to the platform's data events.
 */
export function readChunksBounded(chunks: Iterable<Uint8Array>, bound: number): BoundedRead {
  const kept: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  for (const chunk of chunks) {
    const buffer = Buffer.from(chunk);
    kept.push(buffer);
    bytes += buffer.byteLength;
    if (bytes > bound) {
      truncated = true;
      break;
    }
  }
  return Object.freeze({ text: Buffer.concat(kept).toString('utf8'), bytes, truncated });
}

/** The response header the provider advertises a wait on. Lower-cased, as the platform delivers it. */
export const RETRY_AFTER_HEADER = 'retry-after';

/**
 * The interval the provider advertised, read off the response headers and reported unchanged.
 *
 * Reported, never obeyed: the wait belongs to the existing outbound budget, which is already the
 * consumer of the typed rate-limit refusal. An absent, non-numeric, or non-positive value is `null`,
 * which the existing reader must never treat as "retry immediately" — its own note says so.
 */
export function retryAfterSecondsFromHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): number | null {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== RETRY_AFTER_HEADER) continue;
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!/^[0-9]+$/.test(trimmed)) return null;
    const seconds = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The dialler
// ---------------------------------------------------------------------------------------------

/**
 * Every capability this module minted. A `WeakSet` rather than a flag on the function, so the marker
 * cannot be forged by a cast and cannot be copied onto another function: `isLiveProviderRequest` can
 * only ever recognise a capability this module built, and can never invent one.
 *
 * This is what lets `process/main.ts`'s tests prove WHICH capability was wired **without invoking
 * it** — the property the whole gate posture rests on.
 */
const liveDiallers = new WeakSet<object>();

/** True only for a capability {@link createLiveProviderRequest} minted. */
export function isLiveProviderRequest(candidate: ProviderRequestFn): boolean {
  return liveDiallers.has(candidate);
}

/** What the dialler needs. Both derived from values the process already holds; neither is new policy. */
export interface LiveProviderRequestOptions {
  /** `POLL_POLICY.timeoutSeconds`. The request deadline is derived from it, not invented beside it. */
  readonly pollTimeoutSeconds: number;
  /** The read bound in bytes on the wire. Defaults to {@link MAX_PROVIDER_RESPONSE_BYTES}. */
  readonly maxResponseBytes?: number;
}

/**
 * Build the socket-owning capability.
 *
 * The returned function dials once and reports `status`, `bodyText`, `latencyMs` and the advertised
 * retry interval. It judges nothing. It logs nothing. It refuses only for the three reasons no answer
 * exists at all: an unsecured base, an unreachable peer, and an expired deadline.
 *
 * Constructing this is not calling it. Nothing is dialled until the returned function is invoked, and
 * the only invocation in the repository is the one `process/main.ts` wires when the deployment
 * presents a configured credential — see `selectProviderRequest` there.
 */
export function createLiveProviderRequest(options: LiveProviderRequestOptions): ProviderRequestFn {
  const timeoutMs = providerRequestTimeoutMs(options.pollTimeoutSeconds);
  const bound = options.maxResponseBytes ?? MAX_PROVIDER_RESPONSE_BYTES;

  const dial: ProviderRequestFn = async (
    providerRequest: ProviderHttpRequest,
    credential: ProviderCredential,
  ): Promise<ProviderHttpResponse> => {
    const { operation } = providerRequest;
    // Composed, held in a local, handed to the platform, and never given to anything else.
    const address = composeDialledAddress(providerRequest.baseUrl, credential, operation);
    const payload = Buffer.from(providerRequest.body, 'utf8');
    const startedAt = Date.now();

    return await new Promise<ProviderHttpResponse>((resolve, reject) => {
      let settled = false;
      const refuse = (code: ProviderDialFailureCode): void => {
        if (settled) return;
        settled = true;
        // The platform's own error is discarded rather than chained: its message names the host.
        reject(new ProviderDialError(code, operation));
      };

      const clientRequest = httpsRequest(
        address,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': String(payload.byteLength),
          },
        },
        (response) => {
          const kept: Buffer[] = [];
          let bytes = 0;
          let stopped = false;
          const report = (): void => {
            if (settled) return;
            settled = true;
            resolve({
              // Reported as given. An absent status becomes 0, which is outside the success range, so
              // the existing reader refuses it — this module does not invent a success.
              status: response.statusCode ?? 0,
              bodyText: Buffer.concat(kept).toString('utf8'),
              latencyMs: Date.now() - startedAt,
              retryAfterSeconds: retryAfterSecondsFromHeaders(response.headers),
            });
          };

          response.on('data', (chunk: unknown) => {
            if (stopped) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            kept.push(buffer);
            bytes += buffer.byteLength;
            // The same rule `readChunksBounded` states, applied to the platform's events: stop once
            // the bound is EXCEEDED, so the existing reader refuses it as over the bound.
            if (bytes > bound) {
              stopped = true;
              response.destroy();
              report();
            }
          });
          response.on('end', report);
          response.on('error', () => refuse('PROVIDER_DIAL_UNREACHABLE'));
        },
      );

      clientRequest.setTimeout(timeoutMs, () => {
        clientRequest.destroy();
        refuse('PROVIDER_DIAL_TIMED_OUT');
      });
      clientRequest.on('error', () => refuse('PROVIDER_DIAL_UNREACHABLE'));
      clientRequest.end(payload);
    });
  };

  liveDiallers.add(dial);
  return dial;
}
