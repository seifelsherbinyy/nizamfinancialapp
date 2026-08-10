/**
 * NIZAM · The signal-bus entrypoint — the one file in the bus tier that touches the platform
 * Implemented by: PFOS Contract 12 / Phase 10.19 (spec 06-two-agent-vps)
 * Owning requirements: R34 (the process, its image and its internal-only binding), R9 (bound on the
 *   internal network only, never a published port), R22 (the readiness command the compose
 *   healthcheck resolves to), R27 (a boot refusal naming every incomplete entry at once)
 * Depends on: ./busServer, ./liveness (the SHARED liveness record and its one freshness rule),
 *   ../config/environment (the ONE ambient bridge), `node:http`, `node:crypto`, `node:process`.
 *   Nothing else.
 *
 * Started by the image's entry point. Two modes, selected by the argument vector, exactly as
 * `main.ts` does for the finance agent:
 *
 *  - **default** — boot the bus, serve until a termination signal, shut down cleanly, exit 0. A boot
 *    refusal is reported and exits **non-zero**; there is no degraded run.
 *  - **`--health`** — answer readiness and exit 0 or 1. This is what `<BUS_HEALTH_PROBE>` in
 *    `ops/docker-compose.yml` resolves to, and it is a COMMAND rather than an endpoint, which is why
 *    the healthcheck needs no port and why §2.2.1 can hold that this service binds nothing publicly.
 *
 * ## No server framework was added, and the reason is the same one 10.7 gave
 *
 * Steering §1 permits Fastify or Hono. Neither was taken. The accept surface is two routes whose
 * handler is **synchronous** and performs one local transaction — `appendSignal` and
 * `readSignals` + `serveToSubscriber` are all synchronous, deliberately, so nothing slow can precede
 * an answer — so a framework would contribute routing, validation and plugin machinery this surface
 * has no use for, in exchange for a dependency, a lockfile entry and a supply-chain surface on the
 * one service where both agents' state meets. `node:http` is the platform's own server, is available
 * under the pinned runtime, and covers the whole requirement.
 *
 * ## Why there is no authentication here, and why that is the stronger posture
 *
 * Contract 12 §2.2.6 is explicit: reaching the bus from outside the internal network must fail as a
 * **connection refusal at the network layer**, not as an authentication check that denies a
 * reachable port, because "an authenticated-but-reachable bus is a weaker guarantee and does not
 * satisfy R9 on its own". `ops/env/bus.env.example` carries the matching absence — this service
 * holds **no credential of any kind**, and it is the one place in the deployment where holding
 * either agent's secret would be worst. So the subscriber a read declares, and the producer a
 * publish declares, are **asserted by the client**, and the compensating control is that exactly
 * two containers can address the port at all (`BUS_NETWORK_BINDING` items 1-4, asserted by
 * `src/server/ops/composeTemplate.ts` on every test run). That is consistent with the envelope
 * schema, where `producer` has always been a field rather than a proof (§4.2); it is recorded here
 * so a later reader does not mistake the absence for an oversight.
 *
 * ## What this file is allowed to know
 *
 * It is the only module in the bus tier that names a platform facility, and it names five: the HTTP
 * server, the filesystem the liveness record lives on, the error stream, a source of surrogate
 * identifiers, and the termination signals. Every one is handed to `busServer.ts` behind an injected
 * interface, so that module — and the whole signals tier under it — stays testable with no socket,
 * no disk and no signal. The ambient environment is not one of the five: {@link processEnvSource}
 * remains the single bridge in the whole of `src/`, and this file calls it rather than reading
 * around it.
 *
 * No host, path, port, token or figure is written here (R24). Every value comes from the environment
 * at run time.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import nodeProcess from 'node:process';

import { processEnvSource } from '../config/environment';
import { probeExitCode, probeReadiness, reportForRefusedInvocation, type ReadinessReport } from '../ops/healthProbe';
import { createFileLivenessRecord } from './liveness';
import { NARROW_TIERS_READABLE_BY_BOTH, WIDENED_KINDS } from '../signals';
import {
  bootBusServer,
  BUS_EXPECTED_SCHEMA_VERSION,
  BUS_HEARTBEAT_FILE_NAME,
  BUS_MAX_BODY_BYTES,
  heartbeatIsFresh,
  runBusServerProcess,
  SIGNALS_DATA_DIR_ENTRY,
  SIGNALS_STORE_FILE_ENTRY,
  type BusHeartbeat,
  type BusListenerHandle,
  type BusListenerHost,
  type BusProcessHost,
  type BusRequest,
  type BusResponse,
  type BusRunOutcome,
  type BusServerDependencies,
} from './busServer';

/** The flag that selects the readiness answer instead of the server. */
export const BUS_HEALTH_FLAG = '--health';

/** The signals a clean shutdown is asked for with. */
export const BUS_TERMINATION_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

// ---------------------------------------------------------------------------------------------
// The listening boundary, on the platform's own server
// ---------------------------------------------------------------------------------------------

/** Read a bounded request body. A body over the bound is refused rather than buffered. */
async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.byteLength;
    if (total > BUS_MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The path a request names, without its query string. The bus routes on the path alone. */
export function requestPathOf(url: string | undefined): string {
  const raw = url ?? '';
  const cut = raw.indexOf('?');
  return cut < 0 ? raw : raw.slice(0, cut);
}

/**
 * The listener host, on the platform's own server.
 *
 * Note the whole of what it can be asked for: a PORT. There is no host argument, so this process
 * cannot be told to bind an address; inside a container attached only to the internal network, the
 * container's own interfaces ARE that network, which is why R9's isolation is the network's job and
 * the process's job is only to refuse an endpoint that names anywhere else
 * (`busServer.parseInternalEndpoint`).
 */
export function createNodeHttpBusListenerHost(): BusListenerHost {
  return {
    listen(port: number, accept: (request: BusRequest) => BusResponse): Promise<BusListenerHandle> {
      const server = createServer((incoming: IncomingMessage, outgoing: ServerResponse) => {
        void (async (): Promise<void> => {
          const body = await readBody(incoming);
          const answer: BusResponse =
            body === null
              ? { status: 413, body: JSON.stringify({ outcome: 'refused', refusal: 'body_over_bound', at: 'body' }) }
              : accept({ method: incoming.method ?? '', path: requestPathOf(incoming.url), body });
          outgoing.statusCode = answer.status;
          outgoing.setHeader('content-type', 'application/json');
          outgoing.end(answer.body);
        })();
      });

      return new Promise<BusListenerHandle>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          resolve({
            port,
            close: () =>
              new Promise<void>((done) => {
                server.close(() => done());
              }),
          });
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The shared liveness record
// ---------------------------------------------------------------------------------------------

/**
 * The liveness record, as a file beside the store on the bus's own volume.
 *
 * It holds **no content**: what the health command reads is its AGE, and an age carries no value at
 * all, which is what keeps §7.3's last bullet true for a readiness answer computed across a process
 * boundary. The path is resolved through the ONE containment guard, so the record cannot land
 * outside the directory the service was given and a missing mount refuses rather than inventing a
 * location.
 *
 * A negative age — the record dated in the future — reads as NOT fresh. That is the fail-closed
 * direction: a clock that moved backwards is a fact nobody can interpret, and interpreting it
 * generously would be a bus reported ready on the strength of a record it cannot date.
 *
 * The mechanism is {@link createFileLivenessRecord}, shared with the finance agent as of task 10.21;
 * what this function supplies is the bus's own file NAME. It is a named function rather than a bare
 * call so the bus tier has one spelling of "the bus's record", and so `busDependenciesFromHost` and
 * `busReadinessReport` — two processes — cannot end up naming two different files.
 */
export function createFileHeartbeat(dataDir: string, nowMs: () => number = () => Date.now()): BusHeartbeat {
  return createFileLivenessRecord(dataDir, BUS_HEARTBEAT_FILE_NAME, nowMs);
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

/** Wall-clock ISO instant. The one place in this tier that reads it; every module takes it injected. */
function wallClock(): string {
  return new Date().toISOString();
}

/**
 * Assemble the dependencies from the host.
 *
 * The consent posture is stated rather than defaulted: both narrow tiers are readable by both
 * agents, and {@link WIDENED_KINDS} — which ships EMPTY — is what decides per signal. So every kind
 * resolves to `producer_only` until an owner writes a widening record, and a subscriber asking for
 * the other agent's signals is refused rather than handed an empty list (§4.5.2, §4.5.3, R8).
 */
export function busDependenciesFromHost(): BusServerDependencies {
  const env = processEnvSource();
  const dataDir = String(env[SIGNALS_DATA_DIR_ENTRY] ?? '').trim();
  return {
    env,
    listenerHost: createNodeHttpBusListenerHost(),
    heartbeat: createFileHeartbeat(dataDir),
    consent: { readableTiers: NARROW_TIERS_READABLE_BY_BOTH, widenedKinds: WIDENED_KINDS },
    now: wallClock,
    newAuditId: () => randomUUID(),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}

/** The host facilities that are not part of the bus's own work. */
export function createNodeBusProcessHost(): BusProcessHost {
  return {
    onTerminationSignal(handler: () => void): void {
      for (const signal of BUS_TERMINATION_SIGNALS) nodeProcess.once(signal, handler);
    },
    reportBootRefusal(message: string): void {
      // The refusal names entries, rules and codes and never a value, so it is emitted in full: that
      // is the whole point of the aggregate — one restart answers the whole question.
      nodeProcess.stderr.write(`${message}\n`);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The readiness command
// ---------------------------------------------------------------------------------------------

/**
 * The readiness answer, as an exec check computed in process against local files.
 *
 * Three of §7.3's four facts come from the store — it opens through the one connection factory, the
 * pragmas it read back are the ones the factory requires, and the version it records is the last of
 * the SIGNALS migration series rather than the finance one. The fourth is the listener, and it is
 * where an exec check needs help: this command is a DIFFERENT process from the server, so it cannot
 * see a bound socket. What the two share is the volume, so the server records itself there and this
 * command reads how old that record is. A missing record, and a stale one, both read as not ready —
 * silence is not health (§7.3), and the alternative would be a bus reported ready on the strength of
 * its store while nothing was listening, which is exactly the liveness answer R22 forbids.
 *
 * An unconfigured environment is a not-ready answer rather than a crash: the entries this reads are
 * the ones `requireServiceEnvironment` refuses the boot over, and a probe that threw would give the
 * orchestrator a non-answer at the one moment it needs a verdict.
 */
export function busReadinessReport(nowMs: () => number = () => Date.now()): ReadinessReport {
  const env = processEnvSource();
  const dataDir = String(env[SIGNALS_DATA_DIR_ENTRY] ?? '').trim();
  const fileName = String(env[SIGNALS_STORE_FILE_ENTRY] ?? '').trim();
  if (dataDir === '' || fileName === '') return reportForRefusedInvocation('store_value_empty');

  let ageMs: number | null;
  try {
    ageMs = createFileHeartbeat(dataDir, nowMs).ageMs();
  } catch {
    // The containment guard refused, which means the directory is not there or not ours. That is a
    // not-ready answer about this service, not an exception for the orchestrator to interpret.
    return reportForRefusedInvocation('store_value_empty');
  }

  return probeReadiness(
    { mode: 'service', storePath: `${dataDir}/${fileName}` },
    { expectedSchemaVersion: BUS_EXPECTED_SCHEMA_VERSION, queueWorkerAlive: () => heartbeatIsFresh(ageMs) },
  );
}

/** 0 ready, 1 not ready. What the orchestrator's exec check reads. */
export function runBusHealthCommand(): 0 | 1 {
  return probeExitCode(busReadinessReport());
}

/**
 * The whole entrypoint. Returns the outcome rather than exiting, so the exit is one statement in
 * `busStart.ts` and nothing above it can end the process early.
 */
export async function busMain(argv: readonly string[]): Promise<BusRunOutcome> {
  if (argv.includes(BUS_HEALTH_FLAG)) {
    return { exitCode: runBusHealthCommand(), ticks: 0, shutdown: null };
  }
  return runBusServerProcess(busDependenciesFromHost(), createNodeBusProcessHost());
}

/** Re-exported so a test drives the same boot the process does, with its own injections. */
export { bootBusServer };
