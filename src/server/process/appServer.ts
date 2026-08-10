/**
 * NIZAM · The owner-only application server — loopback by construction, no port published
 * Implemented by: PFOS Contract 12 / Phase 10.18 (spec 06-two-agent-vps)
 * Owning requirements: R33 (the built application is reachable by the owner alone, over an
 *   already-authenticated channel, and no default makes it publicly reachable), R9 (nothing here
 *   binds anywhere the host can reach from outside), R22 (readiness is an exec check computed in
 *   process against a local file), R24 (no deployment particular: no domain, no port, no path)
 * Depends on: ../db/paths (the ONE containment guard, reused rather than copied), ./liveness (the
 *   SHARED liveness record), ../ops/healthProbe (the `storeless` readiness answer). No socket, no
 *   filesystem and no clock of its own — every one of the three is injected.
 *
 * ## What this is, and what it deliberately is not
 *
 * The static single-page application already builds (AC05/AC05b/AC06). This module serves that built
 * output to **one** reader: the owner, through the administrative tunnel they already hold. It is a
 * static file server and **not an API** — the application is local-first over the owner's own storage
 * (steering `drive-db.md`), so there is no server-side data for a route to return.
 *
 * Three absences, each structural rather than careful:
 *
 *  1. **No route reads a store.** This module imports no connection factory, no repository and no
 *     migration series, so there is no code path from a request to a database. It could not grow one
 *     without a new import, which is a visible edit.
 *  2. **No write route of any kind.** {@link APP_METHODS} holds two methods and the response builder
 *     answers `405` for everything else. There is no body reader: a request's body is never read, so
 *     there is nothing for a write to arrive in.
 *  3. **No authentication, and that is the STRONGER posture here.** Reachability is the control, which
 *     is the argument `busMain.ts` makes for the bus and contract 12 §2.2.6 makes for the network: a
 *     password on a publicly bound port is a secret that can leak, be reused, or be brute-forced,
 *     and it leaves the port reachable while it is being attacked. A loopback bind is refusal at the
 *     network layer for everyone who is not already inside an authenticated session on the host. The
 *     owner has already proven who they are — to the host, with a key — before a request exists.
 *
 * ## Loopback is not a setting (R33)
 *
 * The bind address is **not** configurable. There is no environment entry for it (the six templates
 * and `SERVICE_ENTRY_NAMES` are unchanged by this task), and no flag in the invocation grammar; the
 * process passes {@link LOOPBACK_BIND_ADDRESS}, a constant. That alone would still leave one way to
 * widen it by accident — a caller inside this tree handing the listener something else — so the
 * listener host applies {@link requireLoopbackBind} to whatever it is given and **refuses** anything
 * that is not the loopback interface. The refusals mirror `internalEndpoint.ts`, for the same reason
 * and in the same spirit: a wildcard is the first half of the exposure R9 forbids, and a NAME is
 * refused even when it usually resolves to loopback, because name resolution is configurable and a
 * bind address must be a fact rather than a lookup.
 *
 * A loopback literal is not a deployment particular. It identifies no deployment — it is the same on
 * every machine that has ever existed, reveals nothing about the host, and reaches nothing from
 * outside it. It is the mechanism of the control, so it is written plainly rather than hidden behind
 * a placeholder that a reader would have to resolve to check the property (R24, contract 12 §10.1).
 *
 * ## Traversal
 *
 * A request path is resolved through `resolveStorePath`, the ONE containment guard in this
 * repository. It is reused rather than copied for the reason `liveness.ts` gives about itself: a
 * second containment implementation is a second place for the fail-closed direction to go generous,
 * and this is the direction where generous means handing out a file the operator never published.
 * Every escape — `..`, an absolute path, a symlink pointing out of the root — fails the same single
 * containment test rather than a denylist of shapes.
 *
 * ## No halt gate, and no sentinel entry
 *
 * Contract 12 §8.2 names the two agents, the scheduler and the backup service; `ops/docker-compose.yml`
 * mounts the sentinel volume into exactly those four. This is none of them — it is not a service in
 * the topology at all (see `ops/APP_ACCESS.md` for why it is a mode rather than a seventh service).
 * §8.1 lists what a halt stops: a model call, a store write on the model path, a bus publish. This
 * module performs none of the three and cannot: it holds no model port, no store and no bus client.
 *
 * The stronger reason is the direction a halt is supposed to work in. §8's own rule is that halting
 * **never** disables a deterministic view — the worst failure this system could have is losing sight
 * of an obligation because a halt was engaged. A halted deployment is exactly when the owner most
 * needs to read their own figures. So refusing to serve a read-only static view under a halt would
 * make the halt harmful, and adding a sentinel entry here would mean widening a documented decision
 * in five artifacts to gain a refusal §8 does not ask for. Task 10.19 set that precedent for the bus
 * and task 10.20 declined to widen `HALTED_ACTIVITIES`; this follows both.
 */
import { resolve as resolvePath } from 'node:path';

import { probeReadiness, type ReadinessReport } from '../ops/healthProbe';
import { resolveStorePath } from '../db/paths';
import { LIVENESS_TOUCH_INTERVAL_MS, livenessIsFresh, type LivenessRecord } from './liveness';

// ---------------------------------------------------------------------------------------------
// The bind address, and the refusal of anywhere else
// ---------------------------------------------------------------------------------------------

/**
 * The interface this process binds, and the only one it can be made to bind.
 *
 * Written as the literal rather than a placeholder: see the module note. A reader checking that this
 * server is unreachable from off the host needs to see the address, not resolve one.
 */
export const LOOPBACK_BIND_ADDRESS = '127.0.0.1';

/** The IPv6 loopback, accepted because it is the same interface under the other protocol. */
export const LOOPBACK_BIND_ADDRESS_V6 = '::1';

/** Every spelling of "the loopback interface" this process will bind. Enumerated, never matched. */
export const LOOPBACK_BIND_ADDRESSES: readonly string[] = [LOOPBACK_BIND_ADDRESS, LOOPBACK_BIND_ADDRESS_V6];

/**
 * Why a bind address was refused. A refusal names the RULE, never anything about the host (R24).
 *
 * Each is a way the application ends up reachable by somebody who is not the owner:
 *
 *  - **empty** — the platform reads an absent host as "every interface", so the ambiguity that looks
 *    like "unset" is in fact the widest possible bind. It is refused rather than defaulted.
 *  - **a wildcard** (`0.0.0.0`, `::`, `*`) — the exposure R33 forbids, stated explicitly.
 *  - **a scheme or a path** — not an address at all, and both imply a route through something else.
 *  - **not loopback** — any other address, including a name. A name that resolves to loopback today
 *    resolves through configuration this process does not own, so it is a lookup rather than a fact.
 */
export const APP_BIND_REFUSALS = [
  'bind_empty',
  'bind_is_a_wildcard',
  'bind_carries_a_scheme',
  'bind_carries_a_path',
  'bind_is_not_loopback',
] as const;
export type AppBindRefusal = (typeof APP_BIND_REFUSALS)[number];

/** The wildcard spellings, named so the refusal below can say which rule was broken. */
const WILDCARD_BINDS: readonly string[] = ['0.0.0.0', '::', '*', '[::]'];

export type AppBindOutcome =
  | { readonly ok: true; readonly address: string }
  | { readonly ok: false; readonly refusal: AppBindRefusal };

/** Classify `candidate` as the loopback interface, or say which rule it broke. */
export function classifyLoopbackBind(candidate: string): AppBindOutcome {
  const value = candidate.trim();
  const no = (refusal: AppBindRefusal): AppBindOutcome => ({ ok: false, refusal });
  if (value.length === 0) return no('bind_empty');
  if (WILDCARD_BINDS.includes(value)) return no('bind_is_a_wildcard');
  if (value.includes('://')) return no('bind_carries_a_scheme');
  if (value.includes('/')) return no('bind_carries_a_path');
  if (!LOOPBACK_BIND_ADDRESSES.includes(value)) return no('bind_is_not_loopback');
  return { ok: true, address: value };
}

/**
 * The loopback address, or a typed refusal. This is what the listener host calls, so widening the
 * bind is not something a caller in this tree can do by passing a different argument.
 */
export function requireLoopbackBind(candidate: string): string {
  const outcome = classifyLoopbackBind(candidate);
  if (!outcome.ok) {
    throw new AppServerError(
      'APP_BIND_NOT_LOOPBACK',
      `NIZAM app server: this process binds the loopback interface and nothing else [${outcome.refusal}]. It is reached over the operator's existing administrative tunnel, publishes no host port, and has no authentication — reachability is the control (R33), so a wildcard, an address of the host, or a name that merely resolves to loopback are each refused rather than accepted.`,
      outcome.refusal,
    );
  }
  return outcome.address;
}

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

export const APP_SERVER_ERROR_CODES = ['APP_BIND_NOT_LOOPBACK', 'APP_PORT_NOT_IN_RANGE', 'APP_ROOT_UNUSABLE'] as const;
export type AppServerErrorCode = (typeof APP_SERVER_ERROR_CODES)[number];

/** A typed refusal from the process itself. It names a rule or a flag, never a value. */
export class AppServerError extends Error {
  readonly code: AppServerErrorCode;
  readonly refusal: AppBindRefusal | null;

  constructor(code: AppServerErrorCode, message: string, refusal: AppBindRefusal | null = null) {
    super(message);
    this.name = 'AppServerError';
    this.code = code;
    this.refusal = refusal;
  }
}

// ---------------------------------------------------------------------------------------------
// The served root and the invocation grammar
// ---------------------------------------------------------------------------------------------

/**
 * The build output directory, as the build tooling names it. Not a deployment particular: it is this
 * repository's own output path, already named by `scripts/verify/dist.mjs` and the bundler config.
 */
export const APP_BUILD_OUTPUT_DIR = 'dist';

/** The document a request for the root, or for a route the application owns, resolves to. */
export const APP_INDEX_FILE = 'index.html';

/** The flag that selects this mode. */
export const SERVE_APP_FLAG = '--serve-app';
/** The port to bind on the loopback interface. REQUIRED: there is no default (see below). */
export const APP_PORT_FLAG = '--app-port';
/** The directory to serve. Defaults to the build output; never to anything wider. */
export const APP_ROOT_FLAG = '--app-root';

/** Highest port number. The protocol's own bound, not a deployment choice. */
export const MAX_APP_PORT = 65_535;

/**
 * The port is REQUIRED and has no default.
 *
 * Not for safety of the bind — the bind is loopback whatever the port is — but because a default port
 * literal in a tracked file is a deployment particular the operator did not choose (R24), and because
 * a port that was chosen for the operator is a port they will not know is open in their own tunnel.
 * There is deliberately no flag for the bind address at all, so this grammar cannot express a bind.
 */
export interface AppInvocation {
  readonly port: number;
  readonly root: string;
}

export function parseAppInvocation(argv: readonly string[]): AppInvocation {
  let rawPort = '';
  let root = APP_BUILD_OUTPUT_DIR;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === APP_PORT_FLAG) rawPort = (argv[index + 1] ?? '').trim();
    else if (argument.startsWith(`${APP_PORT_FLAG}=`)) rawPort = argument.slice(APP_PORT_FLAG.length + 1).trim();
    else if (argument === APP_ROOT_FLAG) root = (argv[index + 1] ?? '').trim();
    else if (argument.startsWith(`${APP_ROOT_FLAG}=`)) root = argument.slice(APP_ROOT_FLAG.length + 1).trim();
  }
  if (!/^[0-9]+$/.test(rawPort)) {
    throw new AppServerError(
      'APP_PORT_NOT_IN_RANGE',
      `NIZAM app server: ${APP_PORT_FLAG} is required and takes a port number. There is no default, because a default would be a port the operator did not choose and did not open in their own tunnel.`,
    );
  }
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > MAX_APP_PORT) {
    throw new AppServerError('APP_PORT_NOT_IN_RANGE', `NIZAM app server: ${APP_PORT_FLAG} is outside the protocol's range of ports.`);
  }
  if (root === '') {
    throw new AppServerError('APP_ROOT_UNUSABLE', `NIZAM app server: ${APP_ROOT_FLAG} was given an empty value; this process will not choose a directory to serve.`);
  }
  // Absolute, because the ONE containment guard requires an absolute root and requires it to exist -
  // which is the right refusal for a served root too: a relative root would resolve against whatever
  // directory the operator happened to be in, and a root that is not there would serve nothing while
  // looking configured. Resolution is a pure path operation; nothing is read here.
  return { port, root: resolvePath(root) };
}

// ---------------------------------------------------------------------------------------------
// The accept surface
// ---------------------------------------------------------------------------------------------

/** The two methods that read. There is no third, so there is no route that changes anything. */
export const APP_METHODS: readonly string[] = ['GET', 'HEAD'];

export const APP_RESPONSE_STATUSES = [200, 400, 404, 405] as const;
export type AppResponseStatus = (typeof APP_RESPONSE_STATUSES)[number];

/** Why a request was refused. Coarse, and about the request rather than about the filesystem. */
export const APP_REQUEST_REFUSALS = [
  'method_not_permitted',
  'path_not_absolute',
  'path_escapes_root',
  'asset_absent',
] as const;
export type AppRequestRefusal = (typeof APP_REQUEST_REFUSALS)[number];

/** One request, as this process sees it. No headers and NO BODY: nothing here reads one. */
export interface AppRequest {
  readonly method: string;
  readonly path: string;
}

export interface AppResponse {
  readonly status: AppResponseStatus;
  readonly contentType: string;
  /** The asset, or an empty buffer for a refusal and for a `HEAD`. */
  readonly body: Uint8Array;
  /** Present on a refusal. A rule, never a resolved path. */
  readonly refusal: AppRequestRefusal | null;
}

/**
 * Content types for what the build actually emits, plus the fonts and images a bundle may carry.
 * An extension outside this table is served as a byte stream rather than guessed at: a wrong type is
 * how a static server ends up executing something in a reader's browser that it should not.
 */
export const APP_CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  map: 'application/json; charset=utf-8',
};

export const APP_DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export function contentTypeFor(name: string): string {
  const cut = name.lastIndexOf('.');
  if (cut < 0) return APP_DEFAULT_CONTENT_TYPE;
  return APP_CONTENT_TYPES[name.slice(cut + 1).toLowerCase()] ?? APP_DEFAULT_CONTENT_TYPE;
}

/** True when the path names a file rather than an application route. */
function looksLikeAFile(path: string): boolean {
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.includes('.');
}

/** The request path without its query string or fragment. Neither selects a file. */
export function assetNameOf(path: string): string {
  const withoutFragment = path.split('#')[0] ?? '';
  const withoutQuery = withoutFragment.split('?')[0] ?? '';
  return withoutQuery;
}

/** Read one asset, or answer `null` when there is nothing at that resolved path. Injected. */
export type AssetReader = (absolutePath: string) => Uint8Array | null;

const EMPTY_BODY: Uint8Array = new Uint8Array(0);

function refuse(status: AppResponseStatus, refusal: AppRequestRefusal): AppResponse {
  return { status, contentType: APP_DEFAULT_CONTENT_TYPE, body: EMPTY_BODY, refusal };
}

/**
 * Answer one request against `root`.
 *
 * The order is load-bearing. The method is checked first, so a write attempt never reaches path
 * resolution. Containment is checked before existence, so an escaping path is refused whether or not
 * anything is there — the alternative would answer differently for a file that exists outside the
 * root, which is itself a disclosure. The index fallback comes LAST and only for a path that names no
 * file, so the application's own routes deep-link while an absent asset stays a `404`; the fallback
 * resolves the constant {@link APP_INDEX_FILE} through the same guard, so it cannot be a way out.
 *
 * A refusal answers `404` for both a missing asset and an escape, deliberately: the two are reported
 * with different refusal codes to the caller and with the same status to the reader, so the response
 * does not confirm what exists outside the root.
 */
export function serveAsset(root: string, request: AppRequest, readAsset: AssetReader): AppResponse {
  if (!APP_METHODS.includes(request.method.toUpperCase())) return refuse(405, 'method_not_permitted');

  const name = assetNameOf(request.path);
  if (!name.startsWith('/')) return refuse(400, 'path_not_absolute');

  const requested = name === '/' ? APP_INDEX_FILE : name.slice(1);
  const candidates = looksLikeAFile(requested) ? [requested] : [requested, APP_INDEX_FILE];

  for (const candidate of candidates) {
    let absolute: string;
    try {
      absolute = resolveStorePath(root, candidate);
    } catch {
      // The ONE containment guard refused: a traversal segment, an absolute override, a symlink out
      // of the root, or a root that is not there. Every one of them means the same thing here.
      return refuse(404, 'path_escapes_root');
    }
    const body = readAsset(absolute);
    if (body === null) continue;
    return {
      status: 200,
      contentType: contentTypeFor(candidate),
      body: request.method.toUpperCase() === 'HEAD' ? EMPTY_BODY : body,
      refusal: null,
    };
  }
  return refuse(404, 'asset_absent');
}

// ---------------------------------------------------------------------------------------------
// The process
// ---------------------------------------------------------------------------------------------

/** The file the liveness loop records itself in. No dot, so no tool reads it as an asset. */
export const APP_LIVENESS_FILE_NAME = 'app-server-liveness';

/** How often the loop records itself. The shared interval, not a mode-specific one. */
export const APP_LIVENESS_INTERVAL_MS = LIVENESS_TOUCH_INTERVAL_MS;

/**
 * How stale a record may be before readiness reports the server down. Strictly greater than the
 * interval, so one slow tick is not an outage.
 */
export const APP_LIVENESS_MAX_AGE_MS = 30_000;

/** One bound listener. The only thing a caller can learn from it is the port it took. */
export interface AppListenerHandle {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * **The whole of the listening boundary, and it is injected.** Note the signature: a port and a
 * request handler, and NO host — there is no argument through which a caller could ask for a wider
 * bind. The address is the constant, applied by the real host through {@link requireLoopbackBind}.
 */
export interface AppListenerHost {
  listen(port: number, accept: (request: AppRequest) => AppResponse): Promise<AppListenerHandle>;
}

export interface AppServerDependencies {
  readonly invocation: AppInvocation;
  readonly listenerHost: AppListenerHost;
  readonly readAsset: AssetReader;
  readonly liveness: LivenessRecord;
  readonly sleep: (ms: number) => Promise<void>;
  readonly livenessIntervalMs?: number;
}

export interface AppShutdownReport {
  readonly stoppedAccepting: boolean;
  readonly listenersClosed: number;
  readonly livenessCleared: boolean;
}

export interface AppServerProcess {
  /**
   * Every port this process has bound. **Exactly one**, and there is no branch that appends a second:
   * readiness is an exec check, so there is no second route to serve. This is the set R9's claim is
   * asserted against, in both directions, rather than a socket nobody answered on.
   */
  readonly listeningPorts: readonly number[];
  /** The address it bound. Held so a test asserts the loopback claim rather than trusting it. */
  readonly boundAddress: string;
  isAccepting(): boolean;
  handle(request: AppRequest): AppResponse;
  tickOnce(): void;
  /** Ask the loop to stop. Separate from {@link shutdown} so a signal handler holds no async work. */
  requestShutdown(): void;
  /** Record liveness until a shutdown is requested, sleeping the interval between records. */
  runUntilShutdown(): Promise<number>;
  readiness(): ReadinessReport;
  shutdown(): Promise<AppShutdownReport>;
}

/**
 * Boot the application server.
 *
 * There is no environment load and no boot refusal over one, because this mode reads **no**
 * environment entry at all: it is invoked by the operator inside their own tunnel session, its two
 * values arrive as arguments, and adding an entry would mean a seventh row in the fill-in sheet, the
 * value ledger and `SERVICE_ENTRY_NAMES` to configure something no operator has an opinion about.
 * `ops/APP_ACCESS.md` records that decision with the alternatives it rejects.
 */
export async function bootAppServer(deps: AppServerDependencies): Promise<AppServerProcess> {
  const { invocation } = deps;
  let shuttingDown = false;
  let stopRequested = false;
  const listeners: AppListenerHandle[] = [];
  const listeningPorts: number[] = [];
  const intervalMs = deps.livenessIntervalMs ?? APP_LIVENESS_INTERVAL_MS;

  const handle = (request: AppRequest): AppResponse => {
    if (shuttingDown) return refuse(404, 'asset_absent');
    return serveAsset(invocation.root, request, deps.readAsset);
  };

  const listener = await deps.listenerHost.listen(invocation.port, handle);
  listeners.push(listener);
  listeningPorts.push(listener.port);
  deps.liveness.touch();

  return {
    listeningPorts,
    boundAddress: LOOPBACK_BIND_ADDRESS,
    isAccepting: () => !shuttingDown,
    handle,
    tickOnce: () => {
      deps.liveness.touch();
    },
    requestShutdown: () => {
      stopRequested = true;
    },
    runUntilShutdown: async (): Promise<number> => {
      let ticks = 0;
      while (!stopRequested && !shuttingDown) {
        deps.liveness.touch();
        ticks += 1;
        await deps.sleep(intervalMs);
      }
      return ticks;
    },
    readiness: (): ReadinessReport =>
      appReadiness(deps.liveness.ageMs(), listeningPorts.length > 0 && !shuttingDown),
    shutdown: async (): Promise<AppShutdownReport> => {
      shuttingDown = true;
      let closed = 0;
      for (const bound of listeners) {
        await bound.close();
        closed += 1;
      }
      listeningPorts.length = 0;
      let cleared = false;
      try {
        deps.liveness.clear();
        cleared = true;
      } catch {
        // A record that will not clear does not change what shutdown already did. The window expires.
      }
      return { stoppedAccepting: true, listenersClosed: closed, livenessCleared: cleared };
    },
  };
}

/**
 * The readiness answer for a server that has no store (`storeless`).
 *
 * The three store facts are meaningless here rather than merely unavailable — this mode opens no
 * store — so the answer rests on the one fact it does have: the liveness record its own loop writes.
 * Absent reads as down, stale reads as down, and a record dated in the future reads as down, all
 * through the shared rule. `listening` is required as well, so a process whose loop is turning while
 * nothing is bound cannot report ready.
 */
export function appReadiness(ageMs: number | null, listening: boolean): ReadinessReport {
  return probeReadiness(
    { mode: 'storeless' },
    { queueWorkerAlive: () => listening && livenessIsFresh(ageMs, APP_LIVENESS_MAX_AGE_MS) },
  );
}
