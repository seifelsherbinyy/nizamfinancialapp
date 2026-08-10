/**
 * NIZAM · The model DIALLER — the only module in the server tier that holds a socket to the provider
 * Implemented by: PFOS Contract 12 / Phase 2, task **B6**, seam **S3** (spec 07-bot-bringup-v1),
 *   following decision **D-DIALLER** from task B4 on the messaging side
 * Owning requirements: R11 (the credential is revealed at the one moment a request is authorised, and
 *   nowhere else), R19 (no credential, no address, no body on any line, in any message, or in any
 *   thrown value's detail), R24 (no host, no port literal, no path segment, no figure)
 * Depends on: `node:https` and `node:buffer` (the platform's own facilities — no dependency is
 *   added), ./modelProvider (the request shape, the credential holder, {@link revealModelCredential}),
 *   ../../features/benchmark/providerResponseReader (the answer shape only). It imports no logger, no
 *   store, no clock module, no environment loader and no policy.
 *
 * ## Why it exists before the gate it waits on
 *
 * Task B4's D-DIALLER recorded the defect this avoids: a build that still needs new code written
 * after the owner performs a gate is not a ready build. Steering §2 gates *making* an outbound call
 * from a server process, not *writing* the adapter that would make one, and
 * `features/benchmark/liveModelCaller.ts` is the precedent — a live caller that exists in the tree
 * and is exercised only under an authorised carve-out. So the model dialler is written now, and the
 * gate is expressed as a **selection** in `process/main.ts` rather than as an unwritten file. When
 * **G4** places the credential and **D-BENCH** authorises the pass, no code changes.
 *
 * **Nothing in the test suite invokes the function this module returns.** There is no fake responder
 * for it, no loopback listener and no recorded transcript: a dialler tested by dialling would be a
 * network call. What the suite tests is every pure part — the address composition, the transport
 * security belt, the bounded read, the deadline — and, in `process/main.ts`'s tests, that the
 * *selection* picks this function **by identity**. The socket is first exercised by the owner, on the
 * host, after G4.
 *
 * ## No policy lives here
 *
 * It dials and reports. It performs no retry, interprets no status, and reads no envelope: whether the
 * status is a success, whether the body parses, whether the usage block is present and whether the
 * cost is integral are all the SHARED reader's judgements, and they stay there. An absent status is
 * reported as `0`, which is outside the success range, so the reader refuses it — this module does not
 * decide that, it just does not invent a success.
 *
 * ## What never leaves this module
 *
 * The credential goes into an authorization header, which is why the header object is a local and
 * reaches nothing: there is no logger in this file, no `console`, and no sink. Every refusal is a
 * {@link ModelDialError} carrying an enumerated code — and **never** the platform's own error, whose
 * message names the host it failed to reach. That error is discarded rather than chained: a `cause`
 * would smuggle the address into every handler that formats an error tree.
 */
import { Buffer } from 'node:buffer';
import { request as httpsRequest } from 'node:https';

import type { ProviderHttpAnswer } from '../../features/benchmark/providerResponseReader.ts';
import {
  revealModelCredential,
  type ModelCredential,
  type ModelDialFn,
  type ModelDialRequest,
} from './modelProvider.ts';

// ---------------------------------------------------------------------------------------------
// Refusals — an enumerated code, and nothing else
// ---------------------------------------------------------------------------------------------

/** Why a dial refused. Three codes, each a single token so it is legal as an enumerated log value. */
export const MODEL_DIAL_FAILURE_CODES = [
  'MODEL_DIAL_BASE_UNSECURED',
  'MODEL_DIAL_UNREACHABLE',
  'MODEL_DIAL_TIMED_OUT',
] as const;
export type ModelDialFailureCode = (typeof MODEL_DIAL_FAILURE_CODES)[number];

/**
 * A refused dial. There is no shape here that could hold an address, a credential or a body, and the
 * platform's own error is deliberately not attached as a `cause` (R19, R24).
 */
export class ModelDialError extends Error {
  readonly code: ModelDialFailureCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: ModelDialFailureCode, correlationRef: string) {
    super(
      `NIZAM model dialler: the request was refused before an answer could be read (${code}); neither the address nor the body is reported here (R19, R24)`,
    );
    this.name = 'ModelDialError';
    this.code = code;
    this.detail = Object.freeze({ correlationRef });
  }
}

// ---------------------------------------------------------------------------------------------
// The address — composed here, and only here
// ---------------------------------------------------------------------------------------------

/**
 * The provider's published completions path, appended to the resolved base. A path is not a
 * deployment particular: it is the provider's own public API vocabulary, identical for every user of
 * that provider, and it names no host and no account (R24). `liveModelCaller.ts` takes the same view
 * of its own `completionsPath`.
 */
export const COMPLETIONS_PATH = '/chat/completions';

/** The one scheme a credential-bearing request may travel over. */
const SECURED_TRANSPORT_PREFIX = 'https://';

/**
 * Compose the address from the RESOLVED base. The credential is NOT part of it — this provider
 * authorises with a header rather than a path segment — so this function is safe to test directly and
 * its result carries no secret.
 *
 * @throws {ModelDialError} `MODEL_DIAL_BASE_UNSECURED` for a base that is not transport-secured. The
 *   belt costs one comparison and means a credential cannot reach a plaintext address even if a
 *   caller assembled a request without going through a loader.
 */
export function composeModelAddress(baseUrl: string, correlationRef: string): string {
  if (!baseUrl.startsWith(SECURED_TRANSPORT_PREFIX)) {
    throw new ModelDialError('MODEL_DIAL_BASE_UNSECURED', correlationRef);
  }
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${COMPLETIONS_PATH}`;
}

// ---------------------------------------------------------------------------------------------
// The deadline and the read bound
// ---------------------------------------------------------------------------------------------

/**
 * The request deadline in whole milliseconds. Derived from the seconds the caller supplies, and
 * refused rather than defaulted: a dialler with no deadline is a socket that can wedge the worker,
 * which is the failure this derivation exists to prevent.
 */
export function modelRequestTimeoutMs(deadlineSeconds: number): number {
  if (!Number.isSafeInteger(deadlineSeconds) || deadlineSeconds < 1) {
    throw new RangeError(
      'NIZAM model dialler: the request deadline must be a positive whole number of seconds; there is no default deadline, because a dial without one can wedge the worker',
    );
  }
  return deadlineSeconds * 1_000;
}

/** Largest provider answer this dialler will read before stopping. A bound, not a policy. */
export const MAX_MODEL_RESPONSE_BYTES = 1_048_576;

// ---------------------------------------------------------------------------------------------
// The dialler
// ---------------------------------------------------------------------------------------------

/**
 * Every capability this module minted. A `WeakSet` rather than a flag on the function, so the marker
 * cannot be forged by a cast and cannot be copied onto another function: {@link isLiveModelDial} can
 * only ever recognise a capability this module built, and can never invent one.
 *
 * This is what lets `process/main.ts`'s tests prove WHICH capability was wired **without invoking
 * it** — the property the whole gate posture rests on.
 */
const liveDiallers = new WeakSet<object>();

/** True only for a capability {@link createLiveModelDial} minted. */
export function isLiveModelDial(candidate: ModelDialFn): boolean {
  return liveDiallers.has(candidate);
}

/** What the dialler needs. Both are bounds the caller already holds; neither is new policy. */
export interface LiveModelDialOptions {
  /** The request deadline in whole seconds. */
  readonly deadlineSeconds: number;
  /** The read bound in bytes on the wire. Defaults to {@link MAX_MODEL_RESPONSE_BYTES}. */
  readonly maxResponseBytes?: number;
}

/**
 * Build the socket-owning capability.
 *
 * The returned function dials once and reports `status`, `bodyText` and `latencyMs`. It judges
 * nothing. It logs nothing. It refuses only for the three reasons no answer exists at all: an
 * unsecured base, an unreachable peer, and an expired deadline.
 *
 * Constructing this is not calling it. Nothing is dialled until the returned function is invoked, and
 * the only invocation in the repository is the one `process/main.ts` wires when the deployment
 * presents a configured model credential — see `selectModelDial` there.
 */
export function createLiveModelDial(options: LiveModelDialOptions): ModelDialFn {
  const timeoutMs = modelRequestTimeoutMs(options.deadlineSeconds);
  const bound = options.maxResponseBytes ?? MAX_MODEL_RESPONSE_BYTES;

  const dial: ModelDialFn = async (
    modelRequest: ModelDialRequest,
    credential: ModelCredential,
  ): Promise<ProviderHttpAnswer> => {
    const { correlationRef } = modelRequest;
    const address = composeModelAddress(modelRequest.baseUrl, correlationRef);
    const payload = Buffer.from(modelRequest.body, 'utf8');
    const startedAt = Date.now();

    return await new Promise<ProviderHttpAnswer>((resolve, reject) => {
      let settled = false;
      const refuse = (code: ModelDialFailureCode): void => {
        if (settled) return;
        settled = true;
        // The platform's own error is discarded rather than chained: its message names the host.
        reject(new ModelDialError(code, correlationRef));
      };

      const clientRequest = httpsRequest(
        address,
        {
          method: 'POST',
          headers: {
            // Held in a local, handed to the platform, and given to nothing else.
            authorization: `Bearer ${revealModelCredential(credential)}`,
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
              // the shared reader refuses it — this module does not invent a success.
              status: response.statusCode ?? 0,
              bodyText: Buffer.concat(kept).toString('utf8'),
              latencyMs: Date.now() - startedAt,
            });
          };

          response.on('data', (chunk: unknown) => {
            if (stopped) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            kept.push(buffer);
            bytes += buffer.byteLength;
            // Stop once the bound is EXCEEDED, so the truncated body reaches the reader as a body it
            // refuses, rather than as a short answer that looks complete.
            if (bytes > bound) {
              stopped = true;
              response.destroy();
              report();
            }
          });
          response.on('end', report);
          response.on('error', () => refuse('MODEL_DIAL_UNREACHABLE'));
        },
      );

      clientRequest.setTimeout(timeoutMs, () => {
        clientRequest.destroy();
        refuse('MODEL_DIAL_TIMED_OUT');
      });
      clientRequest.on('error', () => refuse('MODEL_DIAL_UNREACHABLE'));
      clientRequest.end(payload);
    });
  };

  liveDiallers.add(dial);
  return dial;
}
