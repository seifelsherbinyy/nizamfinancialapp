/**
 * NIZAM · The finance-agent process — the `main` the barrel never was
 * Implemented by: PFOS Contract 12 / Phase 10.7 (spec 06-two-agent-vps)
 * Owning requirements: R29 (refuse to boot on an incomplete environment; honour the kill sentinel in
 *   both forms; bind NO public port under `longPoll` and only `FINANCE_CONTAINER_PORT` under
 *   `webhook`), R26.1 (the offset advances only after a durable enqueue), R17 (an exhausted cap or an
 *   engaged halt never suppresses a deterministic alert), R19 (nothing logged but codes, refs and
 *   counts), R22 (the readiness answer the compose healthcheck reads)
 * Depends on: ../config/environment, ../db/store, ../telegram/{acceptHandler,liveTransport,workerRunner,
 *   workQueueRepo}, ../routing/turnDispatch, ../ops/{healthProbe,redactedLogger}, ./haltGate.
 *   Every external boundary arrives injected; this module opens no socket and reads no ambient state.
 *
 * Design delta **D4**: `src/server/telegram/index.ts` is a barrel re-export, not a `main`. The
 * application logic it re-exports is complete and tested behind mocks — authenticity, dedup, the work
 * queue, the worker runner, the accept handler, and now the live transport — which is exactly what
 * made the absence easy to miss: **the code existed, the process did not.** This module is the
 * process, and it is deliberately thin. It composes; it reimplements nothing.
 *
 * ---
 *
 * ## The three behaviours that belong to a process rather than to a module
 *
 * **1. It refuses to boot on an incomplete environment, and it does not catch that refusal.**
 * {@link requireServiceEnvironment} collects across every entry the finance service declares and
 * raises one {@link EnvConfigAggregateError} naming all of them, so an operator with four unfilled
 * entries learns four names from one restart. {@link bootFinanceAgent} calls it FIRST and wraps it in
 * nothing: there is no `catch` on that path and no degraded mode to fall back to. A
 * booted-but-unconfigured agent is the failure fail-closed exists to prevent, one layer up — the
 * per-request guards would each refuse correctly while the process as a whole sat there pretending to
 * be a deployment. {@link runFinanceAgentProcess} turns the refusal into a non-zero exit.
 *
 * **2. It honours the halt in both forms**, delegated whole to {@link createHaltGate}. The file
 * sentinel is re-read per call and the coarse `NIZAM_KILL_ALL` is read once at boot; the reasons are
 * in that module's note. What belongs HERE is which call sites consult it, and there are exactly
 * three, one per activity R29 names: {@link FinanceAgentProcess.invokeModel},
 * {@link FinanceAgentProcess.recordOnModelPath} and {@link FinanceAgentProcess.publishSignal}. Each
 * asserts BEFORE touching its dependency, so a refusal leaves no partial effect.
 * {@link FinanceAgentProcess.produceDeterministicAlerts} is the fourth, and it is deliberately NOT
 * gated: R17's second half is that a halt is a spend and write guard, never a blackout, and the way
 * to keep that true is for the deterministic path to have no gate to fail.
 *
 * **3. It binds a port only in `webhook`.** Under `longPoll` there is nothing to listen for, so
 * {@link FinanceAgentProcess.listeningPorts} is EMPTY — which is why phase 1 needs no firewall rule,
 * no certificate and no proxy. Under `webhook` it holds exactly `FINANCE_CONTAINER_PORT` and nothing
 * else. Design delta **D6** asks for that absence to be asserted against the process's own listener
 * set rather than by probing a socket, which is why the set is a member of the returned object: a
 * socket probe can only observe that nothing answered, and nothing answering is also what a crashed
 * listener looks like.
 *
 * ## What this module does NOT do
 *
 * It resolves no HTTP module. {@link HttpListenerHost} is the whole of the listening boundary and it
 * is injected, exactly as {@link TelegramTransportClient} is the whole of the calling boundary — so a
 * test drives both deterministically and neither reaches a network (steering §2). `main.ts` is where
 * the platform's own server is supplied, and it is the only file in this tier that names one. No
 * server framework was added: the accept path is synchronous and does one local transaction, so
 * `node:http` covers it and a dependency would buy nothing.
 *
 * It reads no ambient environment either. {@link processEnvSource} in the config loader remains the
 * one bridge in the whole of `src/`, and this module takes an {@link EnvSource} as an argument.
 *
 * No literal here names a host, a path, a port, a token, a bot, a sender or a figure (R24). Every one
 * arrives from the environment at run time.
 */
import {
  loadAgentModelBinding,
  loadTelegramTransportConfig,
  parsePositiveIntegerEntry,
  requireServiceEnvironment,
  type AgentModelBinding,
  type DeploymentService,
  type EnvSource,
} from '../config/environment.ts';
import type { StoreHandle } from '../db/connection.ts';
import { openFinanceStore, type StoreOpenConfig } from '../db/store.ts';
import type { SpendAgent } from '../../features/routing/spendLedger.ts';
import type {
  TelegramAcceptDecision,
  TelegramDelivery,
  TelegramOutboundMessage,
  TelegramSendReceipt,
  TelegramTransportConfig,
  TelegramTransportMode,
  TelegramWorkerPort,
} from '../ports/telegram.ts';
import type { ModelRequest, ModelResult } from '../ports/openrouter.ts';
import type { SignalDraft, StoredSignalReceipt } from '../ports/signalBus.ts';
import type { ModelInvocationGrant } from '../routing/turnClassifier.ts';
import type { ModelChannel } from '../routing/turnDispatch.ts';
import type { DriveKnowledgeManager } from '../ingest/driveKnowledge.ts';
import {
  acceptDelivery,
  TELEGRAM_ACCEPT_REJECTED,
  type TelegramAcceptAuditLine,
  type TelegramAcceptContext,
} from '../telegram/acceptHandler.ts';
import {
  createLiveTelegramTransport,
  type TelegramLiveTransport,
  type TelegramOffsetStore,
  type TelegramPollPolicy,
  type TelegramPollReport,
  type TelegramSendRetryPolicy,
  type TelegramTransportClient,
} from '../telegram/liveTransport.ts';
import { drainWorkQueue, type WorkerDrainReport } from '../telegram/workerRunner.ts';
import { reclaimStalledWork, workQueueDepth, type WorkQueueContext, type WorkRetryPolicy } from '../telegram/workQueueRepo.ts';
import { probeReadiness, type ProbeEnvironment, type ReadinessReport } from '../ops/healthProbe.ts';
import { createRedactedLogger, type LogSink, type RedactedLogger } from '../ops/redactedLogger.ts';
import { createHaltGate, killAllEngagedAtBoot, type HaltGate, type HaltedActivity } from './haltGate.ts';
import { livenessIsFresh, type LivenessRecord } from './liveness.ts';

// ---------------------------------------------------------------------------------------------
// Identity, and the entries this process reads that no typed loader above owns
// ---------------------------------------------------------------------------------------------

/** Which of the six services this process is. Named once, so no call site spells it. */
export const FINANCE_SERVICE: DeploymentService = 'finance';
/** Which spend identity it carries. Its own key, its own cap, its own store (R17). */
export const FINANCE_AGENT: SpendAgent = 'finance';

/** Entries consumed by the PROCESS rather than by a typed per-agent loader. Names, never values. */
export const FINANCE_DATA_DIR_ENTRY = 'FINANCE_DATA_DIR';
export const FINANCE_STORE_FILE_ENTRY = 'FINANCE_STORE_FILE';
export const FINANCE_CONTAINER_PORT_ENTRY = 'FINANCE_CONTAINER_PORT';
export const STORE_BUSY_TIMEOUT_ENTRY = 'STORE_BUSY_TIMEOUT_MS';

/** The store's logical name, recorded in `schema_meta`. Not a deployment particular. */
export const FINANCE_STORE_NAME = 'finance';

/**
 * The file this process records its own liveness in, beside the store on its own volume (task 10.21).
 *
 * No dot in the name, so no tool that reads extensions can mistake it for a store, a snapshot or a
 * fixture — and it holds **no content**: what the health command reads is its AGE (R24).
 */
export const FINANCE_LIVENESS_FILE_NAME = 'finance-agent-liveness';

/**
 * How stale this agent's liveness record may be before readiness reports the loop stopped turning.
 *
 * **Wider than the bus's window, and the reason is this agent's loop rather than a preference.** One
 * iteration performs a LONG-POLL read before it drains the queue, so under `longPoll` a perfectly
 * healthy iteration can legitimately take as long as the provider is allowed to hold the read open
 * (`main.ts`'s `POLL_POLICY.timeoutSeconds`). A window at the bus's few seconds would therefore
 * report a working agent wedged on every quiet minute, and an operator who saw that would learn to
 * ignore the check — which is worse than not having it. This window clears the longest healthy gap
 * several times over and still sits far below the orchestrator's own budget for the service
 * (`ops/docker-compose.yml` gives this healthcheck a 30s interval and three retries), so a genuinely
 * wedged loop is observed rather than tolerated.
 */
export const FINANCE_LIVENESS_MAX_AGE_MS = 120_000;

/** How long a claimed-but-unsettled row may sit before shutdown returns it to the queue. */
export const SHUTDOWN_RECLAIM_AFTER_MS = 1;

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

export const FINANCE_PROCESS_ERROR_CODES = [
  'PROCESS_POLL_NOT_APPLICABLE_IN_MODE',
  'PROCESS_ALREADY_SHUTTING_DOWN',
  'PROCESS_MODEL_CHANNEL_ABSENT',
  'PROCESS_SIGNAL_BUS_ABSENT',
] as const;
export type FinanceProcessErrorCode = (typeof FINANCE_PROCESS_ERROR_CODES)[number];

/** A typed refusal from the process itself. `subject` is a mode or a dependency name, never a value. */
export class FinanceProcessError extends Error {
  readonly code: FinanceProcessErrorCode;
  readonly subject: string;

  constructor(code: FinanceProcessErrorCode, message: string, subject: string) {
    super(message);
    this.name = 'FinanceProcessError';
    this.code = code;
    this.subject = subject;
  }
}

// ---------------------------------------------------------------------------------------------
// The injected listening boundary
// ---------------------------------------------------------------------------------------------

/** One bound listener. `close` is awaited during shutdown before anything else is torn down. */
export interface HttpListenerHandle {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * **The whole of the listening boundary, and it is injected.** `main.ts` supplies the platform's own
 * server; a test supplies a recorder that binds nothing. Nothing in this module names a socket API,
 * which is what lets the `longPoll` case assert an absence rather than a silence (D6).
 */
export interface HttpListenerHost {
  listen(port: number, accept: (delivery: TelegramDelivery) => TelegramAcceptDecision): Promise<HttpListenerHandle>;
}

// ---------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------

/** Everything the process needs. Nothing is defaulted that could open a door. */
export interface FinanceAgentDependencies {
  /** This service's environment. Handed in, because the loader owns the one ambient bridge. */
  readonly env: EnvSource;
  /**
   * The bot identity. Not read from an entry because no entry declares it: obtaining it is a secret
   * read or an outbound call, both of which belong to a gate. See `TransportLoadInput`.
   */
  readonly botId: string;
  readonly transportClient: TelegramTransportClient;
  /** The slow side. Injected whole: a mock now, a live adapter after G3/G6. */
  readonly worker: TelegramWorkerPort;
  /**
   * Hand the outbound send to whoever composed the worker, once the transport exists (task A-G4).
   *
   * Optional, and its absence opens no door: a worker whose sender is never bound refuses to deliver
   * and the turn is retried rather than marked done — see `turnWorker.ts`'s bindable sender. It is
   * a hand-off rather than a construction, so this module still opens nothing and the worker still
   * holds no socket, no bot identity and no address.
   */
  readonly bindOutboundSend?: (send: (message: TelegramOutboundMessage) => Promise<TelegramSendReceipt>) => void;
  readonly listenerHost: HttpListenerHost;
  /** Does the halt sentinel exist right now? Consulted per activity, never cached. */
  readonly sentinelExists: () => boolean;
  /** Where a structured, redacted line goes. */
  readonly logSink: LogSink;
  readonly now: () => string;
  readonly newId: () => string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly poll: TelegramPollPolicy;
  readonly send: TelegramSendRetryPolicy;
  readonly retry: WorkRetryPolicy;
  /** The one door to the model port. Absent means this process cannot call a model at all. */
  readonly modelChannel?: ModelChannel;
  /** Optional owner-approved Drive knowledge capability; absent means offline knowledge only. */
  readonly knowledge?: DriveKnowledgeManager;
  /** Configuration parsing is deferred to boot so the normal refusal path reports it safely. */
  readonly knowledgeConfigError?: Error;
  /** The consent bus. Absent means this process cannot publish at all. */
  readonly publish?: (draft: SignalDraft) => Promise<StoredSignalReceipt>;
  readonly offsets?: TelegramOffsetStore;
  /**
   * How the store is opened. Absent means {@link openFinanceStore}, which is what the boot uses.
   *
   * Overridden by a test that needs the probe to read a store it controls, and — since task B6 — by
   * `process/main.ts`, which wraps the SAME factory in order to bind the model telemetry sink at the
   * moment the handle exists. The port is assembled from the host before the boot opens the store, so
   * that is the only point where the handle and the sink are both in scope. The wrapper adds nothing
   * to the open itself: the containment guard and the pragmas are still the factory's.
   */
  readonly openStore?: (config: StoreOpenConfig) => { readonly handle: StoreHandle };
  readonly probeEnvironment?: ProbeEnvironment;
  /**
   * Where this process records that its loop is turning, for the SEPARATE process that answers the
   * orchestrator's exec healthcheck (task 10.21, R22).
   *
   * Optional, and its absence opens no door in either direction. The health command reads the record
   * unconditionally, so a deployment whose server never wrote one answers **not ready** — which is
   * the fail-closed direction and is exactly what the defect this dependency fixes looked like. A
   * test that omits it gets a process whose in-process {@link FinanceAgentProcess.readiness} answers
   * on the facts it does have; it does not get a readier answer than a real deployment would.
   */
  readonly liveness?: LivenessRecord;
}

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------

/** What one shutdown did. Counts and verdicts, so the line it produces carries no content. */
export interface ShutdownReport {
  readonly stoppedAccepting: boolean;
  /** Rows returned from `running` to `queued`, so a claim interrupted by the signal is not lost. */
  readonly requeued: number;
  /** Queue depth at the moment the store closed, per state. Nothing durable is discarded. */
  readonly depthAtClose: Readonly<Record<string, number>>;
  readonly listenersClosed: number;
  readonly storeClosed: boolean;
  /**
   * Was the liveness record removed? A stopped agent that still looked alive would hold `caddy` and
   * `scheduler` at `service_healthy` against a service that has gone (task 10.21).
   */
  readonly livenessCleared: boolean;
}

/** What one loop iteration did, so a caller drives the loop without owning its ordering. */
export interface LoopIterationReport {
  readonly poll: TelegramPollReport | null;
  readonly drain: WorkerDrainReport;
}

// ---------------------------------------------------------------------------------------------
// The process
// ---------------------------------------------------------------------------------------------

export interface FinanceAgentProcess {
  readonly mode: TelegramTransportMode;
  readonly transport: TelegramTransportConfig;
  readonly modelBinding: AgentModelBinding;
  readonly halt: HaltGate;
  readonly live: TelegramLiveTransport;
  readonly logger: RedactedLogger;
  readonly store: StoreHandle;
  /**
   * Every port this process has bound, in bind order. **Empty under `longPoll`** — the absence D6
   * asks to be asserted against the process's own state. Exactly one entry under `webhook`.
   */
  readonly listeningPorts: readonly number[];
  /** False once shutdown has begun. A delivery arriving after that is refused, not queued. */
  isAccepting(): boolean;
  /** The accept path, with the shutdown guard in front of it. */
  accept(delivery: TelegramDelivery): TelegramAcceptDecision;
  /** One long-poll read. Refuses under `webhook`, where the provider delivers (R26.1). */
  pollOnce(): Promise<TelegramPollReport>;
  /** One bounded worker drain. */
  runWorkerOnce(): Promise<WorkerDrainReport>;
  /** One iteration of the mode-appropriate loop: read if applicable, then drain. */
  runOnce(): Promise<LoopIterationReport>;
  /** Loop until shutdown is requested, sleeping the injected interval between iterations. */
  runUntilShutdown(idleDelayMs: number): Promise<number>;
  /** A model call, refused first if the halt is engaged (R29). */
  invokeModel(grant: ModelInvocationGrant, request: ModelRequest): Promise<ModelResult>;
  /** A write on the model path — spend, telemetry — refused first if the halt is engaged (R29). */
  recordOnModelPath<T>(write: () => T): T;
  /** A bus publish, refused first if the halt is engaged (R29). */
  publishSignal(draft: SignalDraft): Promise<StoredSignalReceipt>;
  /**
   * A deterministic obligation alert. **Not gated, and there is no gate to add** (R17): a halt is a
   * spend and write guard, and losing a due-date warning to one is forbidden.
   */
  produceDeterministicAlerts<T>(produce: () => T): T;
  /** The readiness answer the compose healthcheck reads (R22). */
  readiness(): ReadinessReport;
  shutdown(): Promise<ShutdownReport>;
}

function queueContextOf(handle: StoreHandle, now: () => string, newId: () => string): WorkQueueContext {
  return { handle, now, newId };
}

/**
 * Boot the finance agent.
 *
 * The order is load-bearing: the environment is refused first, because every step after it consumes
 * a value the refusal would have named; the halt is built next, so an already-halted deployment is
 * observed before anything expensive exists; the store opens third; and the listener — if the mode
 * has one at all — is bound last, so nothing can be accepted before there is somewhere durable to
 * put it.
 *
 * @throws {EnvConfigAggregateError} naming EVERY missing, empty or unsubstituted entry at once. It is
 *   deliberately not caught: see the module note.
 */
export async function bootFinanceAgent(deps: FinanceAgentDependencies): Promise<FinanceAgentProcess> {
  // 1. Fail closed on an incomplete environment, naming every finding in one message (R29, R27).
  //    No try, no catch, no degraded mode.
  requireServiceEnvironment({ service: FINANCE_SERVICE, env: deps.env });
  if (deps.knowledgeConfigError !== undefined) throw deps.knowledgeConfigError;

  const logger = createRedactedLogger(FINANCE_AGENT, deps.logSink, deps.now);

  // 2. The halt, both forms. The coarse form is read exactly once, here.
  const killAllAtBoot = killAllEngagedAtBoot(deps.env);
  const halt = createHaltGate({
    sentinelExists: deps.sentinelExists,
    killAllAtBoot,
    onObservation: (form, activity) => {
      logger.log('warn', 'halt_observed', {
        haltForm: { kind: 'enum', value: form },
        ...(activity === null ? {} : { outcome: { kind: 'enum', value: activity } }),
      });
    },
  });
  if (killAllAtBoot) {
    // Observed at boot, and the process still starts: the deterministic engines are unaffected and a
    // process that refused to start could not produce the alerts R17 requires under a halt.
    logger.log('warn', 'halt_observed', { haltForm: { kind: 'enum', value: 'env' } });
  }

  // 3. The typed configurations, each from this agent's own entry names.
  const transport = loadTelegramTransportConfig({ agent: FINANCE_AGENT, env: deps.env, botId: deps.botId });
  const modelBinding = loadAgentModelBinding({ agent: FINANCE_AGENT, env: deps.env });

  // 4. The store. Its path comes from two entries; the containment guard inside the factory is the
  //    one opinion about which directory this agent owns.
  const dataDir = String(deps.env[FINANCE_DATA_DIR_ENTRY]).trim();
  const fileName = String(deps.env[FINANCE_STORE_FILE_ENTRY]).trim();
  const busyTimeoutMs = parsePositiveIntegerEntry(
    deps.env,
    STORE_BUSY_TIMEOUT_ENTRY,
    'must be a positive integer of milliseconds written as a bare run of digits; a zero lock wait turns every contended write into an immediate failure',
  );
  const open = deps.openStore ?? openFinanceStore;
  const { handle } = open({ dataDir, fileName, busyTimeoutMs, storeName: FINANCE_STORE_NAME });
  logger.log('info', 'store_opened', { storeLabel: { kind: 'enum', value: FINANCE_STORE_NAME } });

  if (deps.knowledge !== undefined) {
    try {
      await deps.knowledge.refresh({
        handle,
        now: deps.now,
        actor: 'finance-knowledge',
        newId: deps.newId,
      });
    } catch {
      logger.log('warn', 'knowledge_refresh_refused', {
        component: { kind: 'enum', value: 'knowledge' },
        failure: { kind: 'enum', value: 'unavailable' },
      });
    }
  }

  const auditSink = (line: TelegramAcceptAuditLine): void => {
    logger.log('warn', 'update_accepted', {
      dedupOutcome: { kind: 'enum', value: 'rejected' },
      outcome: { kind: 'enum', value: line.stage },
      updateRef: { kind: 'ref', value: String(line.updateId) },
    });
  };

  const acceptCtx: TelegramAcceptContext = {
    transport,
    handle,
    now: deps.now,
    newId: deps.newId,
    audit: auditSink,
  };

  const live = createLiveTelegramTransport({
    accept: acceptCtx,
    client: deps.transportClient,
    worker: deps.worker,
    poll: deps.poll,
    send: deps.send,
    sleep: deps.sleep,
    ...(deps.offsets === undefined ? {} : { offsets: deps.offsets }),
  });

  // The outbound port exists now, and this is the earliest point at which it does: the worker is an
  // ARGUMENT to this boot, so at the moment it was assembled there was no transport to hand it. This
  // hand-off is what lets the slow side reply at all (task A-G4) and it adds nothing to the send —
  // the bounded rate-limit retry, the credential resolution and the redacted telemetry all stay where
  // they already were. The port is not stored anywhere else and nothing else is handed over with it.
  deps.bindOutboundSend?.((message: TelegramOutboundMessage) => live.port.outbound.send(message));

  const queue = queueContextOf(handle, deps.now, deps.newId);
  let shuttingDown = false;
  let workerHeartbeats = 0;
  const listeners: HttpListenerHandle[] = [];
  const listeningPorts: number[] = [];

  /**
   * Record that this process's loop is turning, for the separate process that answers the exec
   * healthcheck (task 10.21).
   *
   * A failure to write is swallowed **because it is already reported**: an absent or stale record is
   * not fresh, so the readiness answer turns a record this process could not write into not-ready,
   * which is the fail-closed direction. Raising here instead would turn an unwritable volume into a
   * crash in the middle of a queue drain — a strictly worse answer to the same fact, and one that
   * loses the drain as well.
   */
  const recordLiveness = (): void => {
    try {
      deps.liveness?.touch();
    } catch {
      // See above: readiness reports it. There is nothing this call site can do about it.
    }
  };

  const guardShutdown = (subject: string): void => {
    if (shuttingDown) {
      throw new FinanceProcessError(
        'PROCESS_ALREADY_SHUTTING_DOWN',
        `NIZAM finance agent: ${subject} is refused because shutdown has begun; accepting new work after the signal is how in-flight work gets lost`,
        subject,
      );
    }
  };

  const accept = (delivery: TelegramDelivery): TelegramAcceptDecision => {
    // Refusing rather than throwing: a caller of the accept path receives a decision, and the
    // decision type has no reason field, so this refusal is indistinguishable from any other (§5.2).
    if (shuttingDown) return TELEGRAM_ACCEPT_REJECTED;
    return acceptDelivery(acceptCtx, delivery);
  };

  // 5. The listener, and ONLY in webhook (R29). Under longPoll this block does not run at all, so
  //    `listeningPorts` stays empty by construction rather than by an unbind afterwards.
  if (transport.mode === 'webhook') {
    const port = parsePositiveIntegerEntry(
      deps.env,
      FINANCE_CONTAINER_PORT_ENTRY,
      'must be a positive integer port written as a bare run of digits; the process listens on this port and on no other',
    );
    const handleBound = await deps.listenerHost.listen(port, accept);
    listeners.push(handleBound);
    listeningPorts.push(handleBound.port);
  }

  // 6. The store is open and the mode's listener, if it has one, is bound — so the liveness record
  //    may exist. Written HERE rather than in the loop's first iteration, so the exec healthcheck is
  //    answerable during the orchestrator's start-up grace period rather than only after a poll.
  recordLiveness();

  const assertPermitted = (activity: HaltedActivity): void => halt.assertPermitted(activity);

  const runWorkerOnce = async (): Promise<WorkerDrainReport> => {
    workerHeartbeats += 1;
    recordLiveness();
    return drainWorkQueue({
      queue,
      worker: deps.worker,
      maxConcurrentWorkItems: transport.maxConcurrentWorkItems,
      retry: deps.retry,
    });
  };

  const pollOnce = async (): Promise<TelegramPollReport> => {
    guardShutdown('a long-poll read');
    if (transport.mode !== 'longPoll') {
      throw new FinanceProcessError(
        'PROCESS_POLL_NOT_APPLICABLE_IN_MODE',
        `NIZAM finance agent: polling is not applicable in "${transport.mode}" mode, where the provider delivers inbound (R26.1)`,
        transport.mode,
      );
    }
    return live.pollOnce();
  };

  // The iteration currently in flight, so shutdown can let it SETTLE rather than close the store
  // underneath it. A drain that was mid-transaction when the signal arrived is exactly the case
  // "loses no durable work" is about.
  let inFlight: Promise<LoopIterationReport> | null = null;

  const runOnceLocal = async (): Promise<LoopIterationReport> => {
    const iteration = (async (): Promise<LoopIterationReport> => {
      // Recorded at the TOP of the iteration as well as inside the drain, so a long-poll read that
      // holds for its full timeout is bracketed by two touches rather than followed by one.
      recordLiveness();
      const poll = transport.mode === 'longPoll' ? await pollOnce() : null;
      const drain = await runWorkerOnce();
      return { poll, drain };
    })();
    inFlight = iteration;
    try {
      return await iteration;
    } finally {
      if (inFlight === iteration) inFlight = null;
    }
  };

  const process_: FinanceAgentProcess = {
    mode: transport.mode,
    transport,
    modelBinding,
    halt,
    live,
    logger,
    store: handle,
    listeningPorts,
    isAccepting: () => !shuttingDown,
    accept,
    pollOnce,
    runWorkerOnce,

    runOnce: runOnceLocal,

    async runUntilShutdown(idleDelayMs: number): Promise<number> {
      let iterations = 0;
      while (!shuttingDown) {
        iterations += 1;
        // The poll loop advances the offset only after a durable enqueue. That ordering is the live
        // adapter's, is already implemented, and is called rather than restated here (R26.1).
        const report = await runOnceLocal();
        if (shuttingDown) break;
        const idle = report.poll !== null && report.poll.fetched === 0 && report.drain.claimed === 0;
        if (idle) await deps.sleep(idleDelayMs);
      }
      return iterations;
    },

    async invokeModel(grant: ModelInvocationGrant, request: ModelRequest): Promise<ModelResult> {
      assertPermitted('model_call');
      const channel = deps.modelChannel;
      if (channel === undefined) {
        throw new FinanceProcessError(
          'PROCESS_MODEL_CHANNEL_ABSENT',
          'NIZAM finance agent: no model channel was injected, so this process cannot call a model at all',
          'modelChannel',
        );
      }
      return channel.invoke(grant, request);
    },

    recordOnModelPath<T>(write: () => T): T {
      assertPermitted('model_path_write');
      return write();
    },

    async publishSignal(draft: SignalDraft): Promise<StoredSignalReceipt> {
      assertPermitted('bus_publish');
      const publish = deps.publish;
      if (publish === undefined) {
        throw new FinanceProcessError(
          'PROCESS_SIGNAL_BUS_ABSENT',
          'NIZAM finance agent: no bus publisher was injected, so this process cannot publish at all',
          'publish',
        );
      }
      return publish(draft);
    },

    produceDeterministicAlerts<T>(produce: () => T): T {
      // No gate. See R17 and the module note: this is the one activity a halt must never reach.
      return produce();
    },

    readiness(): ReadinessReport {
      return probeReadiness(
        { mode: 'service', storePath: handle.filePath },
        {
          ...deps.probeEnvironment,
          // Three facts, and all three are about something other than this method's own execution:
          // shutdown has not begun, the worker has reported at least once, and — when this process
          // was given a record to write — that record is fresh. The third is what the SEPARATE
          // health-command process reads, so including it here keeps the in-process answer from
          // being more generous than the exec check that actually gates the stack.
          queueWorkerAlive: () =>
            !shuttingDown &&
            workerHeartbeats > 0 &&
            (deps.liveness === undefined || livenessIsFresh(deps.liveness.ageMs(), FINANCE_LIVENESS_MAX_AGE_MS)),
        },
      );
    },

    async shutdown(): Promise<ShutdownReport> {
      const alreadyDown = shuttingDown;
      // 1. Stop accepting first, so nothing new arrives while the rest settles.
      shuttingDown = true;

      // 2. Clear the liveness record, so the next exec check reports not-ready IMMEDIATELY rather
      //    than after the staleness window. A stopped agent that still looked alive would hold both
      //    `caddy` and `scheduler` at `service_healthy` against a service that has gone.
      let livenessCleared = false;
      try {
        deps.liveness?.clear();
        livenessCleared = true;
      } catch {
        livenessCleared = false;
      }

      // 3. Close the listeners, if this mode had any.
      let listenersClosed = 0;
      for (const bound of listeners) {
        try {
          await bound.close();
          listenersClosed += 1;
        } catch {
          // A listener that will not close does not change what the queue holds, and throwing here
          // would abandon the store still open.
        }
      }
      listeners.length = 0;

      // 4. Let the in-flight iteration settle. Closing the store under a running drain would abort a
      //    transaction that was about to commit, which is the one way a clean shutdown could lose
      //    durable work. A failed iteration is not re-raised here: its own settlement already turned
      //    it into a queue state (§5.5.4).
      try {
        await inFlight;
      } catch {
        // See above: the drain records its own outcome, and shutdown is not the place to re-report it.
      }

      // 5. Return anything still claimed to the queue. A lane interrupted by the signal leaves a
      //    `running` row; reclaiming it is what makes "no durable work is lost" true rather than
      //    hoped for. Settled rows are untouched — the reclaim is conditional on the state.
      let requeued = 0;
      let depthAtClose: Readonly<Record<string, number>> = {};
      try {
        requeued = reclaimStalledWork(queue, SHUTDOWN_RECLAIM_AFTER_MS);
        depthAtClose = workQueueDepth(queue);
      } catch {
        // A store that cannot be read still has to be closed.
      }

      // 6. Close the store last.
      let storeClosed = false;
      try {
        if (!alreadyDown) handle.close();
        storeClosed = true;
      } catch {
        storeClosed = false;
      }

      logger.log('info', 'service_restart_observed', {
        queueDepth: { kind: 'count', value: Number(depthAtClose.queued ?? 0) },
        retainedCount: { kind: 'count', value: requeued },
      });

      return { stoppedAccepting: true, requeued, depthAtClose, listenersClosed, storeClosed, livenessCleared };
    },
  };

  return process_;
}

// ---------------------------------------------------------------------------------------------
// The run wrapper: an exit status, not a stack trace
// ---------------------------------------------------------------------------------------------

/** The host facilities a process needs that are not part of the agent's own work. */
export interface ProcessHost {
  /** Register a termination handler. Injected so a test drives the signal without raising one. */
  onTerminationSignal(handler: () => void): void;
  /** Where a boot refusal goes. Separate from the log sink: a refusal precedes the logger. */
  reportBootRefusal(message: string): void;
}

/** What a completed run reports. `exitCode` is what the wrapper's caller exits with. */
export interface RunOutcome {
  readonly exitCode: 0 | 1;
  readonly iterations: number;
  readonly shutdown: ShutdownReport | null;
}

/**
 * Boot, run until a termination signal, shut down cleanly, and answer with an exit status.
 *
 * A boot refusal is reported and becomes exit code 1. It is NOT swallowed into a degraded run: the
 * whole of behaviour 1 is that this process either has a complete environment or does not start.
 */
export async function runFinanceAgentProcess(
  deps: FinanceAgentDependencies,
  host: ProcessHost,
  idleDelayMs: number,
): Promise<RunOutcome> {
  let agent: FinanceAgentProcess;
  try {
    agent = await bootFinanceAgent(deps);
  } catch (cause) {
    // The message names entries, services and codes and never a value, so reporting it in full is
    // safe (R24) and is the only way the operator learns all of them at once.
    host.reportBootRefusal(cause instanceof Error ? cause.message : String(cause));
    return { exitCode: 1, iterations: 0, shutdown: null };
  }

  let shutdownPromise: Promise<ShutdownReport> | null = null;
  host.onTerminationSignal(() => {
    if (shutdownPromise === null) shutdownPromise = agent.shutdown();
  });

  const iterations = await agent.runUntilShutdown(idleDelayMs);
  const shutdown = await (shutdownPromise ?? agent.shutdown());
  return { exitCode: 0, iterations, shutdown };
}
