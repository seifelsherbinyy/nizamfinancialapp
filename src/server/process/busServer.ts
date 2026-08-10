/**
 * NIZAM · The signal-bus server process — the `main` the signals tier never had
 * Implemented by: PFOS Contract 12 / Phase 10.19 (spec 06-two-agent-vps)
 * Owning requirements: R34 (a service this repository owns has a process, an image, and an
 *   internal-only binding), R9 (the bus listens on the internal network only and publishes no
 *   port), R27 (refuse to boot on an incomplete environment, naming every finding at once),
 *   R22 (readiness reported as an exec check against a local file, with no listener needed),
 *   R7 (the envelope schema on every write), R8 (the consent gate on every read), R10 (the
 *   excluded classification never crosses)
 * Depends on: ../config/environment (the entry names and the ONE refusal), ../signals/* (the
 *   schema, the validator, the consent gate and the append-only store — all REUSED, none
 *   reimplemented), ../ops/healthProbe (the readiness answer), ../ports/signalBus (the
 *   vocabulary and the read/publish shapes). No socket, no filesystem, no clock of its own.
 *
 * Finding **O2**, stated plainly: the envelope schema, the validation, the consent gate, the
 * append-only store and its audit mirror all exist here and are tested — and **nothing listened**
 * on the endpoint the two agents dial. `ops/docker-compose.yml` gives both agents
 * `depends_on: signalbus: condition: service_healthy`, so the absence of this file was the reason
 * a fully gated host still could not stand the phase-1 stack up. This module is that process, and
 * like `financeAgent.ts` before it, it is deliberately thin: it composes; it reimplements nothing.
 *
 * ---
 *
 * ## What this process adds, and what it only exposes
 *
 * It ADDS four things, because each is a property a module cannot have:
 *
 *  1. **It refuses to boot on an incomplete environment, and does not catch that refusal.**
 *     {@link requireServiceEnvironment} collects across every entry the `bus` service declares —
 *     `SIGNALS_DATA_DIR`, `SIGNALS_STORE_FILE`, `BUS_INTERNAL_ENDPOINT` — and raises ONE aggregate
 *     naming all of them, so an operator with three unfilled entries learns three names from one
 *     restart (R27). {@link bootBusServer} calls it FIRST and wraps it in nothing.
 *  2. **It binds the internal endpoint, and nothing else (R9).** {@link BusServerProcess.listeningPorts}
 *     holds exactly one port under every reachable path, and there is no second listener for
 *     readiness, metrics or administration — readiness is an exec check (see 3), so there is no
 *     other route to add. Design delta D6's shape is followed: the absence is asserted against the
 *     process's own listener set and the injected host's own bind record, in both directions,
 *     rather than by probing a socket. A socket probe that finds nothing is also what a crashed
 *     listener, a wrong port and a firewall look like.
 *  3. **It answers readiness against a local file.** `ops/docker-compose.yml` declares
 *     `test: [CMD, <BUS_HEALTH_PROBE>]`, an exec check, so the answer must be computable by a
 *     SECOND process that shares nothing with this one but the volume. {@link BusHeartbeat} is that
 *     shared fact: the liveness loop records that the listener is up, shutdown removes the record,
 *     and the health command reads its age. That is why readiness needs no listener and why §2.2.1
 *     can hold that this service binds nothing publicly.
 *  4. **It parses `BUS_INTERNAL_ENDPOINT` and refuses anything that is not an internal name.**
 *     See {@link parseInternalEndpoint}. This is the process's own contribution to R9 and it is
 *     small on purpose: the network layer does the isolating, and the one thing the process can do
 *     is refuse to be repointed at an address that would be reachable from the host.
 *
 * Everything else it only EXPOSES. The write path is {@link appendSignal}, which validates through
 * Phase 3.1's {@link validateForWrite} and audits the refusal; the read path is
 * {@link readSignals} — which re-validates every row before serving it — followed by Phase 3.2's
 * {@link serveToSubscriber}, which re-validates again, re-derives the de-identification claims over
 * the value about to cross, and applies the two independent consent gates. If a reader finds a
 * field rule, a note cap, an enum, an integrity digest or a scope decision written below, that is a
 * defect: it belongs to `../signals/` and is imported from there.
 *
 * ## Two absences, each with a reason rather than an omission
 *
 * **No halt gate, and no sentinel entry.** Contract 12 §8.2 names the two agents, the scheduler and
 * the backup service; `ops/docker-compose.yml` mounts the sentinel volume into exactly those four;
 * and `ops/env/bus.env.example` records the absence with its reason: *a publish is halted at the
 * publisher, before the envelope is built, so halting the store as well would add a second place
 * for the halt to be wrong without closing anything the first place leaves open*. That refusal is
 * already implemented and tested — `financeAgent.publishSignal` calls
 * `haltGate.assertPermitted('bus_publish')` before it reaches any publisher — and
 * `busServer.test.ts` shows a halted publish never reaching this store, which is the observation
 * that makes the claim mechanical rather than architectural. Adding a sentinel entry here would
 * mean reversing a documented decision in five artifacts to gain a second copy of a refusal that
 * already holds; it would also mean a halt this service could examine and the operator's mount does
 * not create, which `collectKillSentinelFindings` correctly calls a kill switch that does nothing.
 *
 * **No log line.** `redactedLogger.ts` binds a line to a {@link SpendAgent}, and the bus is not one
 * — it is the shared service where both agents' state meets and it holds no spend identity, no key
 * and no cap. Widening that type to admit it would widen the identity the per-agent cap isolation
 * depends on (R17), which is not a trade worth making for a line. It costs nothing, because the bus
 * already keeps a STRONGER record than a log: `signal_audit` is append-only and records every
 * accepted signal and every refusal with its reason, its path and its failure code (§4.3.6), and a
 * log line could carry nothing that mirror does not. A boot refusal still reaches the operator, on
 * the error stream, because it precedes the store that would otherwise hold it.
 *
 * ## No secret, no particular, no figure (R24)
 *
 * No host, address, port, path, token or figure is written here. The endpoint arrives from the
 * environment at run time, the store path from two entries, and every refusal names an entry, a
 * path or an enumerated reason and never a value. There is no money on this boundary and none can
 * be: the envelope has no numeric field, so `src/lib/money` is neither imported nor needed.
 */
import {
  requireServiceEnvironment,
  type DeploymentService,
  type EnvSource,
} from '../config/environment';
import type { StoreHandle } from '../db/connection';
import { probeReadiness, type ProbeEnvironment, type ReadinessReport } from '../ops/healthProbe';
import {
  SIGNAL_KINDS,
  SIGNAL_PRODUCERS,
  type SignalKind,
  type SignalProducer,
  type SignalQuery,
  type SignalReadOutcome,
} from '../ports/signalBus';
import {
  appendSignal,
  openSignalStore,
  readSignals,
  serveToSubscriber,
  SignalStoreError,
  SignalValidationError,
  SIGNAL_STORE_MIGRATIONS,
  storedSignalCount,
  type ConsentPolicy,
  type OpenedSignalStore,
  type SignalStoreContext,
  type SignalStoreOpenConfig,
} from '../signals';
import { LIVENESS_TOUCH_INTERVAL_MS, livenessIsFresh, type LivenessRecord } from './liveness';

// ---------------------------------------------------------------------------------------------
// Identity, and the three entries this service declares
// ---------------------------------------------------------------------------------------------

/** Which of the six services this process is. Named once, so no call site spells it. */
export const BUS_SERVICE: DeploymentService = 'bus';

/** The bus's three entries, by NAME. `SERVICE_ENTRY_NAMES.bus` is the table; these are the reads. */
export const SIGNALS_DATA_DIR_ENTRY = 'SIGNALS_DATA_DIR';
export const SIGNALS_STORE_FILE_ENTRY = 'SIGNALS_STORE_FILE';
export const BUS_INTERNAL_ENDPOINT_ENTRY = 'BUS_INTERNAL_ENDPOINT';

/**
 * The lock wait for this store, as a CONSTANT rather than an entry.
 *
 * `ops/env/bus.env.example` declares exactly three entries and states why it is short. A busy
 * timeout is a per-process capacity choice — `environment.ts` says as much about
 * `STORE_BUSY_TIMEOUT_MS`, which is why that entry belongs to the two agents and not to every
 * service — so inventing a fourth bus entry for it would add a value the fill-in sheet, the value
 * ledger and the template audit would all have to grow a row for, to configure something no
 * operator has an opinion about. Zero is deliberately not reachable: a zero lock wait turns every
 * contended write into an immediate failure.
 */
export const BUS_STORE_BUSY_TIMEOUT_MS = 5_000;

/** The schema version a current `signals.db` records: the last entry of the SIGNALS series. */
export const BUS_EXPECTED_SCHEMA_VERSION: number =
  SIGNAL_STORE_MIGRATIONS[SIGNAL_STORE_MIGRATIONS.length - 1]?.version ?? 0;

/**
 * The file the liveness loop records itself in, beside the store on the bus's own volume. No dot in
 * the name, so it cannot be mistaken for a store, a snapshot or a fixture by any tool that reads
 * extensions — and it holds no content at all: what the health command reads is its AGE.
 */
export const BUS_HEARTBEAT_FILE_NAME = 'bus-listener-heartbeat';

/** How often the liveness loop records itself. The shared interval; not a bus-specific one. */
export const BUS_HEARTBEAT_INTERVAL_MS = LIVENESS_TOUCH_INTERVAL_MS;

/**
 * How stale a record may be before readiness reports the listener down. Strictly greater than the
 * interval, so a single slow tick is not an outage, and far below the orchestrator's own retry
 * budget, so a wedged loop is observed rather than tolerated.
 */
export const BUS_HEARTBEAT_MAX_AGE_MS = 30_000;

/** Largest inbound body this listener reads before refusing. A bound, not a policy. */
export const BUS_MAX_BODY_BYTES = 65_536;

// ---------------------------------------------------------------------------------------------
// The internal endpoint (R9, the process's own half)
// ---------------------------------------------------------------------------------------------

/** Why an endpoint was refused. A refusal names the RULE, never the configured value. */
export const BUS_ENDPOINT_REFUSALS = [
  'endpoint_empty',
  'endpoint_carries_a_scheme',
  'endpoint_carries_a_path',
  'endpoint_host_absent',
  'endpoint_host_not_an_internal_name',
  'endpoint_host_reserved',
  'endpoint_port_absent',
  'endpoint_port_not_in_range',
] as const;
export type BusEndpointRefusal = (typeof BUS_ENDPOINT_REFUSALS)[number];

/** `BUS_INTERNAL_ENDPOINT`, parsed. The host is how the agents address the bus; the port is bound. */
export interface BusInternalEndpoint {
  /** A single internal name — the service name the container network resolves. Never an address. */
  readonly host: string;
  readonly port: number;
}

/** One internal name: a DNS label. An address literal has dots, so it is not one of these. */
const INTERNAL_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/**
 * Names that resolve to the container itself. Refused, because the two agents are the bus's only
 * clients and each of them dialling one of these would reach ITSELF — a bus nobody can talk to,
 * reported healthy, which is the failure this whole file exists to make impossible.
 */
export const BUS_RESERVED_ENDPOINT_HOSTS: readonly string[] = ['localhost'];

/** Highest port number. Not a deployment particular: the protocol's own bound. */
const MAX_PORT = 65_535;

/**
 * Parse `BUS_INTERNAL_ENDPOINT` into an internal name and a port, or refuse it.
 *
 * The accepted shape is `<name>:<port>` and nothing else, which is exactly the shape
 * `ops/BUS_NETWORK_BINDING.md` verifies with (`<BUS_SERVICE>:<BUS_PORT>`). Everything else is
 * refused rather than coerced, and each refusal is a way the bus could otherwise end up reachable
 * from somewhere it must not be, or unreachable from the only two places it must be:
 *
 *  - **a scheme** implies a route through something that speaks one, and the bus has no proxy route
 *    of any kind (§2.2.5, and `BUS_NETWORK_BINDING` item 2);
 *  - **a path** implies a route on a shared host, which is the same mistake with a different spelling;
 *  - **an address literal or a wildcard** (`0.0.0.0`, `::`, a dotted quad) is not a name an internal
 *    network resolves, and a wildcard in particular is the first half of the exposure R9 forbids;
 *  - **a reserved name** is a bus each client would find inside itself;
 *  - **a port outside the protocol's range** is not a port.
 *
 * There is no default and no repair: an endpoint that cannot be read refuses the boot, because the
 * only alternative would be listening somewhere nobody said.
 */
export function parseInternalEndpoint(raw: string): BusInternalEndpoint {
  const value = raw.trim();
  const refuse = (refusal: BusEndpointRefusal): never => {
    throw new BusProcessError(
      'BUS_ENDPOINT_UNUSABLE',
      `NIZAM signal bus: ${BUS_INTERNAL_ENDPOINT_ENTRY} is not an internal endpoint this process can bind [${refusal}]. The accepted shape is an internal service name and a port; a scheme, a path, an address literal, a wildcard, a reserved name and an out-of-range port are each refused rather than coerced, because each is a way the bus ends up reachable where R9 forbids it or unreachable by its only two clients.`,
      BUS_INTERNAL_ENDPOINT_ENTRY,
      refusal,
    );
  };

  if (value.length === 0) refuse('endpoint_empty');
  if (value.includes('://')) refuse('endpoint_carries_a_scheme');
  if (value.includes('/')) refuse('endpoint_carries_a_path');

  const separator = value.lastIndexOf(':');
  if (separator < 0) refuse('endpoint_port_absent');
  const host = value.slice(0, separator);
  const port = value.slice(separator + 1);

  if (host.length === 0) refuse('endpoint_host_absent');
  if (!INTERNAL_NAME.test(host)) refuse('endpoint_host_not_an_internal_name');
  if (BUS_RESERVED_ENDPOINT_HOSTS.includes(host.toLowerCase())) refuse('endpoint_host_reserved');
  if (!/^[0-9]+$/.test(port)) refuse('endpoint_port_absent');

  const parsed = Number.parseInt(port, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PORT) refuse('endpoint_port_not_in_range');
  return { host, port: parsed };
}

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

export const BUS_PROCESS_ERROR_CODES = ['BUS_ENDPOINT_UNUSABLE', 'BUS_ALREADY_SHUTTING_DOWN'] as const;
export type BusProcessErrorCode = (typeof BUS_PROCESS_ERROR_CODES)[number];

/** A typed refusal from the process itself. `subject` is an entry name, never a value. */
export class BusProcessError extends Error {
  readonly code: BusProcessErrorCode;
  readonly subject: string;
  readonly refusal: BusEndpointRefusal | null;

  constructor(code: BusProcessErrorCode, message: string, subject: string, refusal: BusEndpointRefusal | null = null) {
    super(message);
    this.name = 'BusProcessError';
    this.code = code;
    this.subject = subject;
    this.refusal = refusal;
  }
}

// ---------------------------------------------------------------------------------------------
// The injected boundaries
// ---------------------------------------------------------------------------------------------

/** One bound listener. Closed during shutdown before the store is. */
export interface BusListenerHandle {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * **The whole of the listening boundary, and it is injected.** `busMain.ts` supplies the platform's
 * own server; a test supplies a recorder that binds nothing. Nothing in this module names a socket
 * API, which is what lets the R9 assertion below be about an absence rather than about a silence.
 *
 * Note the signature: a PORT, and no host, no backlog and no publish flag. There is no argument
 * through which this process could ask for reachability beyond the network it is attached to.
 */
export interface BusListenerHost {
  listen(port: number, accept: (request: BusRequest) => BusResponse): Promise<BusListenerHandle>;
}

/**
 * The shared fact a SECOND process can read: is the bus's listener alive?
 *
 * It exists because the orchestrator's check is an exec probe (§7.3), so the answer has to survive
 * the process boundary, and the only thing the health command and the server share is the volume.
 * A file's age carries no value at all, which is why the record's content is empty and its age is
 * the whole of the signal (R24, §7.3's last bullet).
 *
 * **This is the shared {@link LivenessRecord}, under the bus's own name.** Task 10.21 needed the
 * identical fact for the finance agent, so the rule moved to `./liveness.ts` and is imported here
 * rather than restated: two copies of a liveness rule would be two places for the fail-closed
 * direction to go generous. What stays the bus's own is its file name and its window, below.
 */
export type BusHeartbeat = LivenessRecord;

/**
 * Fresh enough to mean the listener is up. Absent reads as down: silence is not health (§7.3).
 *
 * The RULE is {@link livenessIsFresh} and is shared; this is the bus's window applied to it, so a
 * bus-side call site does not have to remember which window it is under.
 */
export function heartbeatIsFresh(ageMs: number | null, maxAgeMs: number = BUS_HEARTBEAT_MAX_AGE_MS): boolean {
  return livenessIsFresh(ageMs, maxAgeMs);
}

// ---------------------------------------------------------------------------------------------
// The accept surface
// ---------------------------------------------------------------------------------------------

/** The two routes, and there are no others. A path outside this set is refused, never guessed. */
export const BUS_PUBLISH_PATH = '/publish';
export const BUS_READ_PATH = '/read';
export const BUS_METHOD = 'POST';

/** One request, as the process sees it. No headers: the bus authenticates nothing (see below). */
export interface BusRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string;
}

/** The statuses this process answers with. Enumerated, so a fresh one is a compile error. */
export const BUS_RESPONSE_STATUSES = [200, 400, 404, 405, 413, 503] as const;
export type BusResponseStatus = (typeof BUS_RESPONSE_STATUSES)[number];

export interface BusResponse {
  readonly status: BusResponseStatus;
  /** JSON. Carries an outcome, a reason, a path or a receipt — never a rejected value. */
  readonly body: string;
}

/** Why a protocol-level request was refused, before any domain rule was reached. */
export const BUS_REQUEST_REFUSALS = [
  'method_not_permitted',
  'route_unknown',
  'body_over_bound',
  'body_not_json',
  'query_not_an_object',
  'query_subscriber_not_a_member',
  'query_kind_not_a_member',
  'query_since_not_a_string',
  'query_limit_not_a_count',
  'service_shutting_down',
  'store_unavailable',
] as const;
export type BusRequestRefusal = (typeof BUS_REQUEST_REFUSALS)[number];

function jsonResponse(status: BusResponseStatus, payload: unknown): BusResponse {
  return { status, body: JSON.stringify(payload) };
}

function refuseRequest(status: BusResponseStatus, refusal: BusRequestRefusal, at: string): BusResponse {
  return jsonResponse(status, { outcome: 'refused', refusal, at });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonBody(body: string): unknown | undefined {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * A subscriber's query, in the PORT's own shape and no other (`SignalQuery`).
 *
 * There is deliberately no `producer` filter, even though the store supports one: the port declares
 * none, so admitting one here would be a second read vocabulary that the consent gate would then
 * have to be re-reasoned about. A subscriber says who it is, what kind it wants, how far back, and
 * how many; the bus decides what that answers to.
 */
export function parseReadQuery(candidate: unknown): { readonly ok: true; readonly query: SignalQuery } | { readonly ok: false; readonly refusal: BusRequestRefusal; readonly at: string } {
  if (!isRecord(candidate)) return { ok: false, refusal: 'query_not_an_object', at: 'query' };

  const subscriber = candidate.subscriber;
  if (typeof subscriber !== 'string' || !(SIGNAL_PRODUCERS as readonly string[]).includes(subscriber)) {
    return { ok: false, refusal: 'query_subscriber_not_a_member', at: 'subscriber' };
  }

  const limit = candidate.limit;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0) {
    return { ok: false, refusal: 'query_limit_not_a_count', at: 'limit' };
  }

  let kind: SignalKind | undefined;
  if (candidate.kind !== undefined) {
    if (typeof candidate.kind !== 'string' || !(SIGNAL_KINDS as readonly string[]).includes(candidate.kind)) {
      return { ok: false, refusal: 'query_kind_not_a_member', at: 'kind' };
    }
    kind = candidate.kind as SignalKind;
  }

  let since: string | undefined;
  if (candidate.since !== undefined) {
    if (typeof candidate.since !== 'string' || candidate.since.length === 0) {
      return { ok: false, refusal: 'query_since_not_a_string', at: 'since' };
    }
    since = candidate.since;
  }

  const query: SignalQuery = {
    subscriber: subscriber as SignalProducer,
    limit,
    ...(kind === undefined ? {} : { kind }),
    ...(since === undefined ? {} : { since }),
  };
  return { ok: true, query };
}

// ---------------------------------------------------------------------------------------------
// Dependencies and reports
// ---------------------------------------------------------------------------------------------

export interface BusServerDependencies {
  /** This service's environment. Handed in, because the loader owns the one ambient bridge. */
  readonly env: EnvSource;
  readonly listenerHost: BusListenerHost;
  readonly heartbeat: BusHeartbeat;
  /**
   * The consent posture in force. **Required, never defaulted**, so a call site states which
   * posture it is under rather than inheriting one silently — the same reason Phase 3.2 named
   * `NARROW_TIERS_READABLE_BY_BOTH` instead of defaulting to it.
   */
  readonly consent: ConsentPolicy;
  readonly now: () => string;
  readonly newAuditId: () => string;
  readonly sleep: (ms: number) => Promise<void>;
  /** Overridden only by a test that needs the store opened somewhere it controls. */
  readonly openStore?: (config: SignalStoreOpenConfig) => OpenedSignalStore;
  readonly probeEnvironment?: ProbeEnvironment;
  readonly heartbeatIntervalMs?: number;
}

/** What one shutdown did. Counts and verdicts; nothing about what the store holds. */
export interface BusShutdownReport {
  readonly stoppedAccepting: boolean;
  readonly listenersClosed: number;
  readonly heartbeatCleared: boolean;
  readonly storeClosed: boolean;
  /** How many signals the store held when it closed. A count of rows, not a figure (§4.3.1). */
  readonly storedSignals: number;
}

/** The host facilities that are not part of the bus's own work. */
export interface BusProcessHost {
  /** Register a termination handler. Injected so a test drives the signal without raising one. */
  onTerminationSignal(handler: () => void): void;
  /** Where a boot refusal goes. Separate from everything else: a refusal precedes the store. */
  reportBootRefusal(message: string): void;
}

export interface BusRunOutcome {
  readonly exitCode: 0 | 1;
  readonly ticks: number;
  readonly shutdown: BusShutdownReport | null;
}

// ---------------------------------------------------------------------------------------------
// The process
// ---------------------------------------------------------------------------------------------

export interface BusServerProcess {
  readonly endpoint: BusInternalEndpoint;
  readonly store: StoreHandle;
  /**
   * Every port this process has bound. **Exactly one**, and there is no branch that appends a
   * second: readiness is an exec check, so there is no second route to serve. This is the set D6
   * asks the R9 claim to be asserted against, rather than a socket nobody answered on.
   */
  readonly listeningPorts: readonly number[];
  isAccepting(): boolean;
  /** The whole accept surface. Synchronous: one local transaction, nothing slow in front of it. */
  handle(request: BusRequest): BusResponse;
  /** One liveness tick: record the heartbeat. */
  tickOnce(): void;
  /** Tick until shutdown is requested, sleeping the interval between ticks. */
  runUntilShutdown(): Promise<number>;
  /** The readiness answer, computed in process against the store and the heartbeat (R22). */
  readiness(): ReadinessReport;
  shutdown(): Promise<BusShutdownReport>;
}

/**
 * Boot the signal bus.
 *
 * The order is load-bearing. The environment is refused FIRST, because every step after it consumes
 * a value the refusal would have named. The endpoint is parsed second, before anything expensive
 * exists, so a deployment pointed somewhere it must not listen fails before it has a store open.
 * The store opens third. The listener is bound LAST, so nothing can be accepted before there is
 * somewhere append-only to put it.
 *
 * @throws {EnvConfigAggregateError} naming EVERY missing, empty or unsubstituted entry at once.
 *   Deliberately not caught: a booted-but-unconfigured bus is the failure fail-closed exists to
 *   prevent one layer up, because both agents wait on this service reporting healthy.
 * @throws {BusProcessError} when `BUS_INTERNAL_ENDPOINT` is not an internal endpoint.
 */
export async function bootBusServer(deps: BusServerDependencies): Promise<BusServerProcess> {
  // 1. Fail closed on an incomplete environment, naming every finding in one message (R27).
  requireServiceEnvironment({ service: BUS_SERVICE, env: deps.env });

  // 2. Where this process listens, and the refusal of anywhere else (R9).
  const endpoint = parseInternalEndpoint(String(deps.env[BUS_INTERNAL_ENDPOINT_ENTRY] ?? ''));

  // 3. The append-only store, its audit mirror, and its migration series. The engine invariants are
  //    the connection factory's and are neither restated nor relaxed here.
  const dataDir = String(deps.env[SIGNALS_DATA_DIR_ENTRY]).trim();
  const fileName = String(deps.env[SIGNALS_STORE_FILE_ENTRY]).trim();
  const open = deps.openStore ?? openSignalStore;
  const { handle } = open({ dataDir, fileName, busyTimeoutMs: BUS_STORE_BUSY_TIMEOUT_MS });

  const store: SignalStoreContext = { handle, now: deps.now, newAuditId: deps.newAuditId };

  let shuttingDown = false;
  const listeners: BusListenerHandle[] = [];
  const listeningPorts: number[] = [];
  const heartbeatIntervalMs = deps.heartbeatIntervalMs ?? BUS_HEARTBEAT_INTERVAL_MS;

  // --- the write path: Phase 3.1's validator, and no field rule of this module's own -----------
  const publish = (body: string): BusResponse => {
    const candidate = parseJsonBody(body);
    if (candidate === undefined) return refuseRequest(400, 'body_not_json', 'body');
    try {
      const stored = appendSignal(store, candidate);
      return jsonResponse(200, {
        outcome: 'stored',
        signalId: stored.envelope.signalId,
        hash: stored.envelope.hash,
        storedAt: stored.storedAt,
      });
    } catch (cause) {
      if (cause instanceof SignalValidationError) {
        // The refusal carries a reason, a path, a code, the producer's own identifier and the LENGTH
        // of a note. It has no field for the rejected value, and neither does this answer (§4.3.6).
        return jsonResponse(200, {
          outcome: 'refused',
          reason: cause.refusal.reason,
          at: cause.refusal.at,
          code: cause.code,
          signalIdRef: cause.refusal.signalIdRef,
          noteLength: cause.refusal.noteLength,
        });
      }
      if (cause instanceof SignalStoreError) {
        return jsonResponse(200, { outcome: 'refused', reason: 'signal_id_already_stored', at: 'signalId', code: cause.code });
      }
      // A store that will not accept a valid envelope is not a producer being told no. Readiness
      // will report it, and the orchestrator restarts what reports unhealthy (§7.3).
      return refuseRequest(503, 'store_unavailable', 'store');
    }
  };

  // --- the read path: re-validated on the way out, then BOTH consent gates (§4.5) --------------
  const read = (body: string): BusResponse => {
    const candidate = parseJsonBody(body);
    if (candidate === undefined) return refuseRequest(400, 'body_not_json', 'body');
    const parsed = parseReadQuery(candidate);
    if (!parsed.ok) return refuseRequest(400, parsed.refusal, parsed.at);
    try {
      // `readSignals` re-runs every field rule and re-checks the digest before a row is served
      // (§4.2); `serveToSubscriber` re-validates again, re-derives the de-identification claims over
      // the value about to cross, and applies the tier and scope gates independently (§4.5.5).
      const stored = readSignals(store, {
        limit: parsed.query.limit,
        ...(parsed.query.kind === undefined ? {} : { kind: parsed.query.kind }),
        ...(parsed.query.since === undefined ? {} : { since: parsed.query.since }),
      });
      const outcome: SignalReadOutcome = serveToSubscriber(stored, parsed.query, deps.consent);
      return jsonResponse(200, outcome);
    } catch {
      // A row that no longer validates, or a served value that breaches a de-identification claim,
      // is a corrupt store or a defect — never a shorter delivered list (§4.5.2, §4.2).
      return refuseRequest(503, 'store_unavailable', 'store');
    }
  };

  const handle_ = (request: BusRequest): BusResponse => {
    if (shuttingDown) return refuseRequest(503, 'service_shutting_down', 'service');
    if (request.body.length > BUS_MAX_BODY_BYTES) return refuseRequest(413, 'body_over_bound', 'body');
    if (request.method !== BUS_METHOD) return refuseRequest(405, 'method_not_permitted', 'method');
    if (request.path === BUS_PUBLISH_PATH) return publish(request.body);
    if (request.path === BUS_READ_PATH) return read(request.body);
    return refuseRequest(404, 'route_unknown', 'path');
  };

  // 4. The listener, on the internal network only. ONE bind, and no argument through which a
  //    second could be asked for (R9, BUS_NETWORK_BINDING items 1-3).
  const bound = await deps.listenerHost.listen(endpoint.port, handle_);
  listeners.push(bound);
  listeningPorts.push(bound.port);

  // The listener is up, so the shared liveness record may exist. Written here rather than in the
  // loop's first tick, so readiness is answerable during the orchestrator's start-up grace period.
  deps.heartbeat.touch();

  const process_: BusServerProcess = {
    endpoint,
    store: handle,
    listeningPorts,
    isAccepting: () => !shuttingDown,
    handle: handle_,

    tickOnce(): void {
      deps.heartbeat.touch();
    },

    async runUntilShutdown(): Promise<number> {
      let ticks = 0;
      while (!shuttingDown) {
        ticks += 1;
        deps.heartbeat.touch();
        if (shuttingDown) break;
        await deps.sleep(heartbeatIntervalMs);
      }
      return ticks;
    },

    readiness(): ReadinessReport {
      return probeReadiness(
        { mode: 'service', storePath: handle.filePath },
        {
          expectedSchemaVersion: BUS_EXPECTED_SCHEMA_VERSION,
          ...deps.probeEnvironment,
          // The bus runs no queue worker; what it has is a listener, and this is the fact about it.
          // A process that is shutting down, holds no bound port, or has stopped recording itself
          // is not ready — none of which this module's own execution could establish.
          queueWorkerAlive: () => !shuttingDown && listeningPorts.length > 0 && heartbeatIsFresh(deps.heartbeat.ageMs()),
        },
      );
    },

    async shutdown(): Promise<BusShutdownReport> {
      const alreadyDown = shuttingDown;
      // 1. Stop accepting first, so nothing new arrives while the rest settles.
      shuttingDown = true;

      // 2. Clear the liveness record, so the next exec check reports not-ready immediately rather
      //    than after the staleness window. A stopped bus that still looks alive would hold both
      //    agents at `service_healthy` against a service that has gone.
      let heartbeatCleared = false;
      try {
        deps.heartbeat.clear();
        heartbeatCleared = true;
      } catch {
        heartbeatCleared = false;
      }

      // 3. Close the listener.
      let listenersClosed = 0;
      for (const listener of listeners) {
        try {
          await listener.close();
          listenersClosed += 1;
        } catch {
          // A listener that will not close does not change what the store holds, and throwing here
          // would abandon the store still open.
        }
      }
      listeners.length = 0;

      // 4. Count what is there, then close the store last. Nothing is pruned, nothing is trimmed:
      //    the store is append-only and shutdown is not an exception to that (§4.1).
      let storedSignals = 0;
      try {
        storedSignals = storedSignalCount(store);
      } catch {
        storedSignals = 0;
      }

      let storeClosed = false;
      try {
        if (!alreadyDown) handle.close();
        storeClosed = true;
      } catch {
        storeClosed = false;
      }

      return { stoppedAccepting: true, listenersClosed, heartbeatCleared, storeClosed, storedSignals };
    },
  };

  return process_;
}

/**
 * Boot, tick until a termination signal, shut down cleanly, and answer with an exit status.
 *
 * A boot refusal is reported and becomes exit code 1. It is NOT swallowed into a degraded run: a
 * bus that came up without a store, or listening somewhere nobody named, would report healthy and
 * release both agents to depend on it.
 */
export async function runBusServerProcess(deps: BusServerDependencies, host: BusProcessHost): Promise<BusRunOutcome> {
  let bus: BusServerProcess;
  try {
    bus = await bootBusServer(deps);
  } catch (cause) {
    // The message names entries, rules and codes and never a value, so it is emitted in full: that
    // is the whole point of the aggregate — one restart answers the whole question (R24, R27).
    host.reportBootRefusal(cause instanceof Error ? cause.message : String(cause));
    return { exitCode: 1, ticks: 0, shutdown: null };
  }

  let shutdownPromise: Promise<BusShutdownReport> | null = null;
  host.onTerminationSignal(() => {
    if (shutdownPromise === null) shutdownPromise = bus.shutdown();
  });

  const ticks = await bus.runUntilShutdown();
  const shutdown = await (shutdownPromise ?? bus.shutdown());
  return { exitCode: 0, ticks, shutdown };
}
