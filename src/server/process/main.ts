/**
 * NIZAM · The finance-agent entrypoint — the one file that touches the platform
 * Implemented by: PFOS Contract 12 / Phase 10.7 (spec 06-two-agent-vps)
 * Owning requirements: R29 (the process: refuse to boot incomplete, honour the sentinel in both
 *   forms, bind no public port under `longPoll` and only `FINANCE_CONTAINER_PORT` under `webhook`),
 *   R22 (the readiness command the compose healthcheck invokes), R19 (structured, redacted lines)
 * Depends on: ./financeAgent, ./turnWorker, ./liveness (the SHARED liveness record and its one
 *   freshness rule), ../config/environment (the ONE ambient bridge), ../ops/healthProbe,
 *   ../routing/turnDispatch, ../telegram/auth (the header name), `node:http`, `node:fs`.
 *   Nothing else.
 *
 * Started with `npm start`. Two modes, selected by the argument vector:
 *
 *  - **default** — boot the agent, run until a termination signal, shut down cleanly, exit 0. A boot
 *    refusal is reported and exits **non-zero**; there is no degraded run.
 *  - **`--health`** — answer readiness against the configured store AND the liveness record this
 *    process writes beside it, then exit 0 or 1. This is the shape `ops/docker-compose.yml`'s
 *    `<FINANCE_HEALTH_PROBE>` command wraps, and it is a COMMAND rather than an HTTP endpoint, which
 *    is why the healthcheck needs no port either. See {@link financeReadinessReport} for the defect
 *    task 10.21 removed here: the command could never report ready, and both `caddy` and `scheduler`
 *    wait on this service reporting healthy.
 *
 * ## No server framework was added, and here is why
 *
 * Steering §1 permits Fastify or Hono for this agent. Neither was taken. The listening surface is one
 * route whose handler is **synchronous** and performs one local transaction — `acceptHandler` is
 * typed synchronous precisely so nothing slow can precede the acknowledgement — so a framework would
 * contribute routing, validation and plugin machinery that this surface has no use for, in exchange
 * for a dependency, a lockfile entry and a supply-chain surface. `node:http` is the platform's own
 * server, is already available under the pinned runtime, and covers the whole requirement. The
 * preference for the platform is stated in the task; this is the route it points at.
 *
 * Under `longPoll` — the mode phase 1 ships on — this file binds nothing at all: the listener host
 * below is constructed but never asked to listen, because {@link bootFinanceAgent} only calls it in
 * `webhook`. That is why phase 1 needs no firewall rule, no certificate and no proxy.
 *
 * ## What this file is allowed to know
 *
 * It is the only module in this tier that names a platform facility, and it names four: the HTTP
 * server, a filesystem existence test for the halt sentinel, the standard output stream, and the
 * termination signals. Every one of them is handed to `financeAgent.ts` through an injected
 * interface, so that module — and everything under it — stays testable with no socket, no disk and no
 * signal. The ambient environment is NOT one of the four: {@link processEnvSource} in the config
 * loader remains the single bridge in the whole of `src/`, and this file calls it rather than reading
 * around it.
 *
 * No host, path, port, token, bot, sender or figure is written here (R24). Every value comes from the
 * environment at run time, and the log sink emits only what `redactedLogger` will build.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import nodeProcess from 'node:process';

import { processEnvSource, type EnvSource } from '../config/environment';
import { probeExitCode, probeReadiness, reportForRefusedInvocation, type ReadinessReport } from '../ops/healthProbe';
import { createModelChannel } from '../routing/turnDispatch';
import { TELEGRAM_SECRET_TOKEN_HEADER } from '../telegram/auth';
import type { TelegramAcceptDecision, TelegramDelivery } from '../ports/telegram';
import type { ModelRequest, ModelResult, OpenRouterPort } from '../ports/openrouter';
import {
  bootFinanceAgent,
  FINANCE_DATA_DIR_ENTRY,
  FINANCE_LIVENESS_FILE_NAME,
  FINANCE_LIVENESS_MAX_AGE_MS,
  FINANCE_STORE_FILE_ENTRY,
  runFinanceAgentProcess,
  type FinanceAgentDependencies,
  type HttpListenerHandle,
  type HttpListenerHost,
  type ProcessHost,
  type RunOutcome,
} from './financeAgent';
import { createFileLivenessRecord, livenessIsFresh } from './liveness';
import { conservativeTurnFacts, createTurnDispatchWorker } from './turnWorker';

/** The flag that selects the readiness answer instead of the agent. */
export const HEALTH_FLAG = '--health';

/** The signals a clean shutdown is asked for with. */
export const TERMINATION_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/** How long the loop waits when a read returned nothing and the queue was empty. */
export const IDLE_DELAY_MS = 1_000;

/** The long-poll read shape. A positive timeout is long polling; zero would be a busy loop. */
export const POLL_POLICY = { timeoutSeconds: 30, limit: 50 } as const;

/** The outbound retry budget, and the queue's. Bounded, so one refusal cannot become a loop. */
export const SEND_RETRY_POLICY = { baseMs: 1_000, maxMs: 60_000, maxAttempts: 4 } as const;
export const WORK_RETRY_POLICY = { baseMs: 5_000, maxMs: 300_000, maxAttempts: 5 } as const;

/** The header the provider echoes, read from the module that owns the name rather than restated. */
export const SECRET_TOKEN_HEADER = TELEGRAM_SECRET_TOKEN_HEADER.toLowerCase();

/** Largest inbound body this listener will read before refusing. A bound, not a policy. */
export const MAX_INBOUND_BODY_BYTES = 1_048_576;

// ---------------------------------------------------------------------------------------------
// The platform facilities, each behind the interface `financeAgent.ts` declares
// ---------------------------------------------------------------------------------------------

/**
 * The provider's shape, read defensively.
 *
 * Two fields are needed before the guards can run: the update identifier, which is half of the dedup
 * key, and the sender, which the allowlist reads. Everything else stays an opaque string and is read
 * for the first time by the worker, after the acknowledgement. An unparseable body yields `null`,
 * which the caller turns into the same refusal every other failure produces.
 */
export function readDeliveryIdentifiers(rawBody: string): { readonly updateId: number; readonly senderId: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const body = parsed as { update_id?: unknown; message?: { from?: { id?: unknown } } };
  const updateId = body.update_id;
  if (!Number.isSafeInteger(updateId)) return null;
  const senderId = body.message?.from?.id;
  if (typeof senderId !== 'number' && typeof senderId !== 'string') return null;
  return { updateId: updateId as number, senderId: String(senderId) };
}

/** Read a bounded request body. A body over the bound is refused rather than buffered. */
async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.byteLength;
    if (total > MAX_INBOUND_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The listener host, on the platform's own server.
 *
 * **Every answer is `200` with an empty body**, whatever the decision was. A refusal must be
 * indistinguishable from an acceptance (§5.2), and a non-2xx answer would additionally tell the
 * provider the delivery failed — earning a retry of a message this agent has already declined.
 */
export function createNodeHttpListenerHost(now: () => string, botId: string): HttpListenerHost {
  return {
    listen(port: number, accept: (delivery: TelegramDelivery) => TelegramAcceptDecision): Promise<HttpListenerHandle> {
      const server = createServer((request: IncomingMessage, response: ServerResponse) => {
        void (async (): Promise<void> => {
          const header = request.headers[SECRET_TOKEN_HEADER];
          const rawBody = await readBody(request);
          if (rawBody !== null) {
            const identifiers = readDeliveryIdentifiers(rawBody);
            if (identifiers !== null) {
              accept({
                botId,
                updateId: identifiers.updateId,
                senderId: identifiers.senderId,
                // `null` means the header was absent; `''` means present and empty. §5.2 treats
                // those as different facts, so the distinction is preserved rather than collapsed.
                secretTokenHeader: typeof header === 'string' ? header : null,
                receivedAt: now(),
                rawBody,
              });
            }
          }
          response.statusCode = 200;
          response.end();
        })();
      });

      return new Promise<HttpListenerHandle>((resolve, reject) => {
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

/**
 * The model port. **Absent under the current gate posture**, and that absence is the honest state:
 * a live provider adapter needs G4's key and an outbound call, both of which are gated (steering §2).
 * Until it exists, a model-bearing turn is refused with a code and the queue retries then abandons
 * it; a deterministic turn is served in full. The alternative — a stand-in that answered — would be a
 * fabricated financial answer, which is the one outcome this repository never produces.
 */
export function createUnavailableModelPort(): OpenRouterPort {
  return {
    async complete(request: ModelRequest): Promise<ModelResult> {
      void request;
      throw Object.assign(new Error('NIZAM finance agent: no live model adapter is wired; gate G4 supplies the key and the outbound path'), {
        code: 'MODEL_PROVIDER_UNAVAILABLE',
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

/** Wall-clock ISO instant. The one place in this tier that reads it; every module takes it injected. */
function wallClock(): string {
  return new Date().toISOString();
}

/** A unique reference per queued row. Platform-supplied, so no module below owns randomness. */
function newReference(): string {
  return randomUUID();
}

/** Assemble the dependencies from the host. `env` comes from the loader's one bridge. */
export function financeAgentDependenciesFromHost(botId: string): FinanceAgentDependencies {
  const env = processEnvSource();
  const sentinelPath = String(env.KILL_SENTINEL_PATH ?? '');
  const channel = createModelChannel(createUnavailableModelPort());
  // The record `financeReadinessReport` above reads, written by this process on its own volume. The
  // factory resolves nothing until it is used, so an incomplete environment still refuses the boot by
  // naming every unfilled entry at once rather than failing here on one path (R27).
  const liveness = createFileLivenessRecord(String(env[FINANCE_DATA_DIR_ENTRY] ?? '').trim(), FINANCE_LIVENESS_FILE_NAME);

  return {
    env,
    botId,
    liveness,
    transportClient: {
      // Both members belong to the gated live adapter (G3/G6). They are present so the shape is
      // complete and refuse so nothing pretends a provider answered.
      fetchUpdates: async () => {
        throw Object.assign(new Error('NIZAM finance agent: no live provider client is wired; gates G3 and G6 supply it'), {
          code: 'TELEGRAM_SEND_REFUSED',
        });
      },
      sendMessage: async () => {
        throw Object.assign(new Error('NIZAM finance agent: no live provider client is wired; gates G3 and G6 supply it'), {
          code: 'TELEGRAM_SEND_REFUSED',
        });
      },
    },
    worker: createTurnDispatchWorker({
      dispatch: {
        channel,
        // The deterministic route. It answers with the turn's own reference, because the Stage 1-4
        // engines are driven by the store rather than by a message, and wiring that pipeline is a
        // separate task: what matters here is that the T0 branch reaches no model.
        executeDeterministically: (_facts, turnRef) => turnRef,
        planModelRequest: (grant) => {
          throw Object.assign(new Error(`NIZAM finance agent: no request planner is wired for a ${grant.tier} turn; gate G4 unblocks live routing`), {
            code: 'MODEL_PROVIDER_UNAVAILABLE',
          });
        },
      },
      // See `turnWorker.ts`: no extraction step exists yet, so every turn classifies T0 and no model
      // is invoked. Fail-closed, and it spends nothing.
      readTurnFacts: () => conservativeTurnFacts(),
    }),
    listenerHost: createNodeHttpListenerHost(wallClock, botId),
    // Per call, and never cached: the sentinel is the form an operator can flip without a restart.
    sentinelExists: () => sentinelPath.length > 0 && existsSync(sentinelPath),
    logSink: (line: string) => {
      // `redactedLogger` has already built and audited the line; this writes it and adds nothing.
      nodeProcess.stdout.write(`${line}\n`);
    },
    now: wallClock,
    newId: newReference,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    poll: POLL_POLICY,
    send: SEND_RETRY_POLICY,
    retry: WORK_RETRY_POLICY,
    modelChannel: channel,
  };
}

/** The host facilities that are not part of the agent's own work. */
export function createNodeProcessHost(): ProcessHost {
  return {
    onTerminationSignal(handler: () => void): void {
      for (const signal of TERMINATION_SIGNALS) nodeProcess.once(signal, handler);
    },
    reportBootRefusal(message: string): void {
      // The refusal names entries, services and codes and never a value, so it is emitted in full:
      // that is the whole point of the aggregate — one restart answers the whole question.
      nodeProcess.stderr.write(`${message}\n`);
    },
  };
}

/**
 * The readiness answer, as an exec check computed in process against local files (R22).
 *
 * ## The defect this replaced, because it is worth naming
 *
 * Until task 10.21 this function called `runProbe(['--store', …])` with **no probe environment**. In
 * `service` mode `queueWorkerAlive` is then absent, `probeReadiness` correctly answers
 * `queue_worker_not_reporting` — silence is not health — and the command therefore **always exited
 * 1**, for every store, on every host. `ops/docker-compose.yml` gives both `caddy` and `scheduler` a
 * `depends_on: finance-agent: condition: service_healthy`, so that one line held the whole phase-1
 * stack at unhealthy for ever, and it carried no test, which is how it survived task 10.7 and 10.8.
 *
 * ## What replaced it, and why it is the same mechanism as the bus's
 *
 * Three of §7.3's four facts come from the store: it opens through the one connection factory, the
 * pragmas it read back are the ones the factory requires, and the version it records is this build's
 * last migration. The fourth is the loop, and it is where an exec check needs help — this command is
 * a DIFFERENT PROCESS from the agent, so it can see no worker, no queue lane and no in-memory
 * counter. What the two share is the volume, so the agent records that its loop turned and this
 * command reads how old that record is (`./liveness.ts`, shared with the signal bus rather than
 * duplicated for it). An absent record and a stale one both read as not ready, and shutdown removes
 * the record so a stopped agent answers not-ready at once rather than after the window.
 *
 * An unconfigured environment is a not-ready ANSWER rather than a crash: the entries this reads are
 * the ones `requireServiceEnvironment` refuses the boot over, and a probe that threw would hand the
 * orchestrator a non-answer at the one moment it needs a verdict.
 *
 * `env` and `nowMs` are injectable so this is testable without a wall clock or an ambient
 * environment; both default to the real ones, and the default `env` is the loader's ONE bridge.
 */
export function financeReadinessReport(
  options: { readonly env?: EnvSource; readonly nowMs?: () => number } = {},
): ReadinessReport {
  const env = options.env ?? processEnvSource();
  const nowMs = options.nowMs ?? ((): number => Date.now());
  const dataDir = String(env[FINANCE_DATA_DIR_ENTRY] ?? '').trim();
  const fileName = String(env[FINANCE_STORE_FILE_ENTRY] ?? '').trim();
  if (dataDir === '' || fileName === '') return reportForRefusedInvocation('store_value_empty');

  let ageMs: number | null;
  try {
    ageMs = createFileLivenessRecord(dataDir, FINANCE_LIVENESS_FILE_NAME, nowMs).ageMs();
  } catch {
    // The containment guard refused: the directory is not there, or not ours. That is a not-ready
    // answer about this service, not an exception for the orchestrator to interpret.
    return reportForRefusedInvocation('store_value_empty');
  }

  return probeReadiness(
    { mode: 'service', storePath: `${dataDir}/${fileName}` },
    { queueWorkerAlive: () => livenessIsFresh(ageMs, FINANCE_LIVENESS_MAX_AGE_MS) },
  );
}

/** 0 ready, 1 not ready. What the orchestrator's exec check reads. */
export function runHealthCommand(): 0 | 1 {
  return probeExitCode(financeReadinessReport());
}

/**
 * The flag carrying the bot identity.
 *
 * It is an ARGUMENT rather than an environment entry, deliberately. No entry declares the bot
 * identity — it is absent from all six templates, from `SERVICE_ENTRY_NAMES` and from the value
 * ledger — and the two ways to obtain it are reading the bot token or calling the provider's identity
 * endpoint, both of which belong to a gate (see `TransportLoadInput`). Inventing a template entry for
 * it here would put a value in the environment file set that no gate supplies and no ledger row
 * tracks; passing it as an argument keeps the six templates exactly as the ledger describes them.
 * Absent or empty, the loader refuses the boot with `ENV_BOT_IDENTITY_EMPTY` — a blank half of the
 * dedup key is refused, never defaulted (§5.4.1, R14).
 */
export const BOT_IDENTITY_FLAG = '--bot-id';

/** Read `--bot-id <value>` or `--bot-id=<value>`, or the empty string, which the loader refuses. */
export function readBotIdentity(argv: readonly string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === BOT_IDENTITY_FLAG) return (argv[index + 1] ?? '').trim();
    if (argument.startsWith(`${BOT_IDENTITY_FLAG}=`)) return argument.slice(BOT_IDENTITY_FLAG.length + 1).trim();
  }
  return '';
}

/**
 * The whole entrypoint. Returns the outcome rather than exiting, so the exit is one statement in
 * `start.ts` and nothing above it can end the process early.
 */
export async function main(argv: readonly string[]): Promise<RunOutcome> {
  if (argv.includes(HEALTH_FLAG)) {
    return { exitCode: runHealthCommand(), iterations: 0, shutdown: null };
  }
  return runFinanceAgentProcess(financeAgentDependenciesFromHost(readBotIdentity(argv)), createNodeProcessHost(), IDLE_DELAY_MS);
}

/** Re-exported so a test drives the same boot the process does, with its own injections. */
export { bootFinanceAgent };
