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
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import nodeProcess from 'node:process';

import {
  agentEntryNames,
  describeConfiguredPresence,
  processEnvSource,
  type EnvSource,
} from '../config/environment.ts';
import { loadKnowledgeDriveConfig } from '../config/knowledgeEnvironment.ts';
import { probeExitCode, probeReadiness, reportForRefusedInvocation, type ReadinessReport } from '../ops/healthProbe.ts';
import { createModelChannel } from '../routing/turnDispatch.ts';
import { TELEGRAM_SECRET_TOKEN_HEADER } from '../telegram/auth.ts';
import {
  createProviderTransportClient,
  gatedProviderRequest,
  readConversationRef,
  readUpdateKeyFields,
  type ProviderRequestFn,
} from '../telegram/providerRequest.ts';
import { createLiveProviderRequest } from '../telegram/liveProviderRequest.ts';
import { createLiveModelDial } from '../model/liveModelDial.ts';
import {
  createBindableTelemetrySink,
  createModelProviderPort,
  gatedModelDial,
  type ModelDialFn,
} from '../model/modelProvider.ts';
import { openFinanceStore } from '../db/store.ts';
import { createRedactedLogger } from '../ops/redactedLogger.ts';
import { createGoogleDriveKnowledgeClient } from '../ingest/googleDriveKnowledgeClient.ts';
import { createDriveKnowledgeManager } from '../ingest/driveKnowledge.ts';
import type { TelegramAcceptDecision, TelegramDelivery } from '../ports/telegram.ts';
import type { ModelRequest, ModelResult, OpenRouterPort } from '../ports/openrouter.ts';
import {
  bootFinanceAgent,
  FINANCE_AGENT,
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
} from './financeAgent.ts';
import { createFileLivenessRecord, livenessIsFresh } from './liveness.ts';
import {
  APP_LIVENESS_FILE_NAME,
  APP_LIVENESS_MAX_AGE_MS,
  appReadiness,
  bootAppServer,
  LOOPBACK_BIND_ADDRESS,
  parseAppInvocation,
  requireLoopbackBind,
  SERVE_APP_FLAG,
  type AppListenerHandle,
  type AppListenerHost,
  type AppRequest,
  type AppResponse,
  type AppServerProcess,
} from './appServer.ts';
import { createBindableReplySender, createTurnDispatchWorker, type TurnReplyTarget } from './turnWorker.ts';
import { answerDeterministically } from './deterministicAnswer.ts';
import { readInboundTurn, refuseUnplannedTurn, turnRequestPlanner } from './turnIntake.ts';

/** The flag that selects the readiness answer instead of the agent. */
export const HEALTH_FLAG = '--health';

/** The directory the app-server mode records its liveness in. Supplied by the platform (task 10.18). */
export function appRecordDirectory(): string {
  return tmpdir();
}

/** The signals a clean shutdown is asked for with. */
export const TERMINATION_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/** How long the loop waits when a read returned nothing and the queue was empty. */
export const IDLE_DELAY_MS = 1_000;

/** The long-poll read shape. A positive timeout is long polling; zero would be a busy loop. */
export const POLL_POLICY = { timeoutSeconds: 30, limit: 50 } as const;

/** The outbound retry budget, and the queue's. Bounded, so one refusal cannot become a loop. */
export const SEND_RETRY_POLICY = { baseMs: 1_000, maxMs: 60_000, maxAttempts: 4 } as const;
export const WORK_RETRY_POLICY = { baseMs: 5_000, maxMs: 300_000, maxAttempts: 5 } as const;

/**
 * The model request deadline (task B6). A BOUND rather than a policy, and it is declared here beside
 * the other three because this is where the process states its bounds: nothing below owns a deadline,
 * and the model dialler refuses to be built without one so it cannot acquire a default of its own.
 * It is deliberately not derived from {@link POLL_POLICY}, whose timeout is the hold the agent asks
 * the MESSAGING provider for and describes a different exchange entirely.
 */
export const MODEL_POLICY = { deadlineSeconds: 60 } as const;

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
  // ONE implementation of which fields are the dedup key and which the allowlist reads, shared with
  // the long-poll path (`readUpdateKeyFields`). What differs is the POLICY on an absent sender, and
  // it differs because the consequence differs: here the provider is retrying and ignoring the
  // delivery loses nothing, while on the poll path the offset is the acknowledgement and dropping an
  // update would wedge the poller on it. See that function's note.
  const keys = readUpdateKeyFields(parsed);
  if (keys === null || keys.senderId === null) return null;
  return { updateId: keys.updateId, senderId: keys.senderId };
}

/**
 * Where a reply to this update goes, or `null` when the update names no conversation (task A-G4).
 *
 * The raw body is parsed here and the conversation is read by the module that owns every other
 * defensive read of a provider shape, so there is ONE implementation of "which field is the
 * conversation" in this tree — the same arrangement `readDeliveryIdentifiers` already has with
 * `readUpdateKeyFields`. Nothing else is read: not the sender, not the text.
 */
export function readReplyDestination(rawBody: string): TurnReplyTarget | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const chatRef = readConversationRef(parsed);
  return chatRef === null ? null : { chatRef };
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
 * The model port BEFORE task B6: it threw for every request, because no module performed one.
 *
 * Kept, and no longer wired. `../model/modelProvider.ts` is the module that performs the request, and
 * {@link financeAgentDependenciesFromHost} wires it with the capability
 * {@link selectModelDial} chooses. This function remains as the most conservative port a caller can
 * ask for — a test that needs a port which cannot possibly reach anything uses it rather than
 * constructing one inline — and it is the honest answer for a deployment that wants the model tier
 * off entirely rather than gated.
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

// ---------------------------------------------------------------------------------------------
// Which provider request capability this deployment gets (task B4, decision D-DIALLER)
// ---------------------------------------------------------------------------------------------

/** The two capabilities. A closed pair, so "which one is wired" is answerable by name. */
export const PROVIDER_CAPABILITIES = ['live', 'gated'] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

/**
 * The condition that selects the live dialler, and it is ONE condition: this agent's bot-token entry
 * is configured, asked through the loader's own rule ({@link describeConfiguredPresence}, which means
 * set, non-blank, and not still its template placeholder).
 *
 * **Why not a liveness entry:** there is none to reuse. `TELEGRAM_MODE` is the only mode entry this
 * repository declares and its vocabulary is `webhook | longPoll` — which of the two ways the provider
 * and the agent reach each other, not whether the deployment is live. Both of its values describe a
 * running deployment, so neither can carry this decision. `NIZAM_KILL_ALL` is a halt rather than a
 * liveness flag, and `HALTED_ACTIVITIES` does not name an outbound messaging request. The `finance`
 * service declares no other candidate. Adding one would be a new environment entry, which this task
 * forbids and R23 would then have to gate, so the credential-configured condition stands alone —
 * stated plainly here rather than dressed up as something the environment says.
 *
 * That condition is not a weak one. The token entry is gate **G3**, so it is populated by the owner
 * placing a credential in the host's root-owned configuration directory and by nothing else. A
 * developer machine has no such entry, so a developer machine gets the gated capability; the test
 * suite passes a synthetic environment and therefore does too.
 */
export function providerCapabilityFor(env: EnvSource): ProviderCapability {
  const tokenEntry = agentEntryNames(FINANCE_AGENT).botTokenEntry;
  return describeConfiguredPresence(FINANCE_AGENT, env)[tokenEntry] === true ? 'live' : 'gated';
}

/**
 * Select the capability structurally: two branches, one function each, and no flag inside either.
 *
 * Selecting the live one CONSTRUCTS a dialler; it dials nothing. The request deadline it derives comes
 * from {@link POLL_POLICY}'s own long-poll timeout, so there is one timeout policy in the process
 * rather than two.
 */
export function selectProviderRequest(env: EnvSource): ProviderRequestFn {
  return providerCapabilityFor(env) === 'live'
    ? createLiveProviderRequest({ pollTimeoutSeconds: POLL_POLICY.timeoutSeconds })
    : gatedProviderRequest();
}

// ---------------------------------------------------------------------------------------------
// Which model dial capability this deployment gets (task B6, seam S3)
// ---------------------------------------------------------------------------------------------

/**
 * The condition that selects the live model dialler, and it is ONE condition: this agent's model-key
 * entry is configured, asked through the loader's own rule ({@link describeConfiguredPresence}, which
 * means set, non-blank, and not still its template placeholder).
 *
 * That entry is gate **G4**, so it is populated by the owner minting a credential and placing it in
 * the host's root-owned configuration directory, and by nothing else. A developer machine has no such
 * entry, so a developer machine gets the gated capability; the test suite passes a synthetic
 * environment and therefore does too. The same shape B4's `providerCapabilityFor` takes, for the same
 * reason: no liveness entry exists to reuse, and this task adds none.
 */
export function modelCapabilityFor(env: EnvSource): ProviderCapability {
  const keyEntry = agentEntryNames(FINANCE_AGENT).modelKeyEntry;
  return describeConfiguredPresence(FINANCE_AGENT, env)[keyEntry] === true ? 'live' : 'gated';
}

/**
 * Select the capability structurally: two branches, one function each, and no flag inside either.
 *
 * Selecting the live one CONSTRUCTS a dialler; it dials nothing. **D-BENCH is still ahead of any
 * call**: this selection decides which capability is wired, and `routeModel` decides whether a turn
 * may name a model at all — which it refuses while the eligibility registry is provisional (R18). So a
 * configured credential makes a call possible, and B8 is what makes one routable.
 */
export function selectModelDial(env: EnvSource): ModelDialFn {
  return modelCapabilityFor(env) === 'live'
    ? createLiveModelDial({ deadlineSeconds: MODEL_POLICY.deadlineSeconds })
    : gatedModelDial();
}

/** Assemble the dependencies from the host. `env` comes from the loader's one bridge. */
export function financeAgentDependenciesFromHost(botId: string): FinanceAgentDependencies {
  const env = processEnvSource();
  const sentinelPath = String(env.KILL_SENTINEL_PATH ?? '');
  let knowledge: FinanceAgentDependencies['knowledge'];
  let knowledgeConfigError: Error | undefined;
  try {
    const knowledgeConfig = loadKnowledgeDriveConfig(env);
    knowledge = knowledgeConfig === null
      ? undefined
      : createDriveKnowledgeManager({
          client: createGoogleDriveKnowledgeClient(knowledgeConfig),
          rootFolderId: knowledgeConfig.rootFolderId,
          now: wallClock,
        });
  } catch (cause) {
    knowledgeConfigError = cause instanceof Error ? cause : new Error(String(cause));
  }
  // Task B6 (seam S3): the real model provider module, in place of the port that threw for every
  // request. It composes the body, resolves this agent's credential through the loader that owns its
  // entry name, judges the answer with the SHARED benchmark-path reader, and records what §6.4 permits
  // through the EXISTING telemetry repository. The capability is selected structurally by
  // `selectModelDial`: the socket-owning dialler when this agent's G4 credential is configured, and
  // `gatedModelDial` — which holds no network primitive and refuses naming G4/D-BENCH — otherwise.
  //
  // The telemetry sink is bound to the store LATER, because the store opens inside the boot sequence
  // and the port must exist before it. See the `openStore` hook below: it is the one place in this
  // process that has both the handle and the sink in scope.
  const telemetry = createBindableTelemetrySink();
  // Task A-G4 (the reply): the worker is assembled before the boot builds the transport, so the sender
  // it is given resolves the outbound port per call and is bound by `bindOutboundSend` below. Unbound,
  // it refuses — an answer with nowhere to go leaves the turn on the queue rather than settling done.
  const replies = createBindableReplySender();
  const channel = createModelChannel(
    createModelProviderPort({
      agent: FINANCE_AGENT,
      env,
      dial: selectModelDial(env),
      now: wallClock,
      newId: newReference,
      record: telemetry.sink,
    }),
  );
  // The record `financeReadinessReport` above reads, written by this process on its own volume. The
  // factory resolves nothing until it is used, so an incomplete environment still refuses the boot by
  // naming every unfilled entry at once rather than failing here on one path (R27).
  const liveness = createFileLivenessRecord(String(env[FINANCE_DATA_DIR_ENTRY] ?? '').trim(), FINANCE_LIVENESS_FILE_NAME);
  // One sink for both the agent's own lines and the provider module's, so there is exactly one place
  // in this process that writes a line and `redactedLogger` is the only thing that builds one.
  const logSink = (line: string): void => {
    // `redactedLogger` has already built and audited the line; this writes it and adds nothing.
    nodeProcess.stdout.write(`${line}\n`);
  };

  return {
    env,
    botId,
    liveness,
    // Task B4 (seams S1/S2): the real provider module, in place of the two throwing stubs. It
    // resolves this agent's credential through the loader's own rules over the environment the ONE
    // ambient bridge produced, composes the request, holds the read bound, and fails closed on a
    // non-success answer. **The capability is selected structurally** by `selectProviderRequest`
    // (decision D-DIALLER): the socket-owning dialler when this agent's G3 credential is configured,
    // and `gatedProviderRequest` — which holds no network primitive and refuses naming G3/G6 —
    // otherwise. Nothing here pretends a provider answered, and no new code is needed once the owner
    // performs G3.
    transportClient: createProviderTransportClient({
      agent: FINANCE_AGENT,
      env,
      request: selectProviderRequest(env),
      now: wallClock,
      log: createRedactedLogger(FINANCE_AGENT, logSink, wallClock),
    }),
    // Task A-G4: the reply. The worker composes an answer and now sends it; the capability is bound
    // below, once `bootFinanceAgent` has built the transport that owns the socket.
    bindOutboundSend: (send) => {
      replies.bind(async (reply) => {
        // The bot identity and the address are added HERE, in the composition root that already holds
        // them, so the worker names neither (R24). The conversation is the one the message arrived on.
        await send({ botId, chatRef: reply.target.chatRef, text: reply.text });
      });
    },
    worker: createTurnDispatchWorker({
      sendReply: replies.send,
      // The destination is READ off the update, never configured: a reply belongs on the conversation
      // the message came from, and no environment entry declares one.
      readReplyTarget: (item) => readReplyDestination(item.rawBody),
      // `answerDeterministically` returns the sentence itself, so the rendering is the identity.
      renderAnswer: (answer: string) => answer,
      dispatch: {
        channel,
        // Task B7 (seam S6): the deterministic route answers in a human sentence over a small, named
        // and listed intent set — the six the classifier routes `T0`. It quotes NO figure and it is
        // not the Stage 1-4 engine wiring, which the contract's own scope line keeps out of v1.0:
        // where a number would be the natural answer, the sentence points at the owner-only web view.
        executeDeterministically: answerDeterministically,
        // Reached only if no per-turn planner was composed for the item, which is a defect in the
        // composition rather than a state a turn can be in. It refuses (task B5, seam S4).
        planModelRequest: refuseUnplannedTurn,
      },
      // Task B5 (seam S5): the real extraction step. It derives the three facts that are properties
      // of the message — the intent, whether a triggered turn is missing its subject, and whether the
      // request must enforce structured output — and takes the fourteen deterministic-engine verdicts
      // as `NO_ENGINE_VERDICTS`, because v1.0 does not wire the Stage 1-4 engines to chat and this
      // tier never sources a judgement about the owner's money (§6's standing invariant). So a turn
      // now reaches the model-bearing tiers by its INTENT, and reaches T3 by no route at all.
      readTurnFacts: (item) => readInboundTurn(item).facts,
      // Task B5 (seam S4): the planner for this turn, carrying this turn's own words. The facts type
      // holds no free text by design, so the utterance travels with the item — see `turnWorker.ts`.
      // `readInboundTurn` is pure, so reading it once per seam is the same read twice.
      planTurnRequest: (item) => {
        const turn = readInboundTurn(item);
        return turnRequestPlanner({
          agent: FINANCE_AGENT,
          turnRef: turn.turnRef,
          text: turn.text,
          knowledgeContext: knowledge?.contextFor(turn.text ?? ''),
        });
      },
    }),
    listenerHost: createNodeHttpListenerHost(wallClock, botId),
    // Task B6: bind the telemetry sink at the moment the store opens. The boot sequence opens the
    // store through this hook, so this is the only point in the process where the handle and the sink
    // are both in scope — the port was assembled before the store existed, which is why the sink is
    // bindable rather than constructed with a handle. The store itself is opened by the SAME factory
    // the boot would have used, so nothing about the containment guard or the pragmas changes.
    openStore: (config) => {
      const opened = openFinanceStore(config);
      telemetry.bind(opened.handle);
      return opened;
    },
    // Per call, and never cached: the sentinel is the form an operator can flip without a restart.
    sentinelExists: () => sentinelPath.length > 0 && existsSync(sentinelPath),
    logSink,
    now: wallClock,
    newId: newReference,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    poll: POLL_POLICY,
    send: SEND_RETRY_POLICY,
    retry: WORK_RETRY_POLICY,
    modelChannel: channel,
    knowledge,
    knowledgeConfigError,
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

// ---------------------------------------------------------------------------------------------
// The owner-only application server (task 10.18, R33)
// ---------------------------------------------------------------------------------------------

/**
 * The listener host for the app-server mode, on the platform's own server.
 *
 * **This is the only place in the repository that names a bind address, and it names the loopback
 * one through a guard that refuses everything else.** `requireLoopbackBind` is called on the constant
 * rather than the constant being passed straight to `listen`, which looks redundant and is not: it
 * makes the refusal a property of the bind path itself, so an edit that replaced the constant with a
 * configured value would be refused at the bind rather than quietly widening the server (R33, R9).
 *
 * The request body is **discarded, never read**: `incoming.resume()` drains it so a client cannot
 * wedge the socket, and no code path collects it. There is nothing here for a write to arrive in.
 */
export function createNodeHttpAppListenerHost(): AppListenerHost {
  return {
    listen(port: number, accept: (request: AppRequest) => AppResponse): Promise<AppListenerHandle> {
      const address = requireLoopbackBind(LOOPBACK_BIND_ADDRESS);
      const server = createServer((incoming: IncomingMessage, outgoing: ServerResponse) => {
        incoming.resume();
        const answer: AppResponse = accept({ method: incoming.method ?? '', path: incoming.url ?? '' });
        outgoing.statusCode = answer.status;
        outgoing.setHeader('content-type', answer.contentType);
        outgoing.end(Buffer.from(answer.body));
      });

      return new Promise<AppListenerHandle>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, address, () => {
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

/** Read one asset off disk, or `null` when there is nothing there. The path is already contained. */
export function readAssetFromDisk(absolutePath: string): Uint8Array | null {
  try {
    return readFileSync(absolutePath);
  } catch {
    return null;
  }
}

/** The readiness answer for the app-server mode: `storeless`, over the shared liveness record. */
export function appReadinessReport(nowMs: () => number = () => Date.now()): ReadinessReport {
  let ageMs: number | null;
  try {
    ageMs = createFileLivenessRecord(appRecordDirectory(), APP_LIVENESS_FILE_NAME, nowMs).ageMs();
  } catch {
    ageMs = null;
  }
  // `listening` is asserted by the record's own existence here, because this command is a DIFFERENT
  // process and can see no socket - the same reason the other three services answer this way. A
  // shutdown clears the record, so a stopped server answers not-ready at once (R22).
  return appReadiness(ageMs, ageMs !== null && livenessIsFresh(ageMs, APP_LIVENESS_MAX_AGE_MS));
}

/**
 * Serve the built application to the owner, over the tunnel they already hold.
 *
 * Boot refusals - an absent or out-of-range port, an empty root, a root the containment guard will
 * not accept - are reported and become exit code 1. There is no degraded run and no fallback
 * directory: a server that chose its own root would be serving something nobody published.
 */
export async function serveAppMain(argv: readonly string[], host = createNodeProcessHost()): Promise<RunOutcome> {
  if (argv.includes(HEALTH_FLAG)) {
    return { exitCode: probeExitCode(appReadinessReport()), iterations: 0, shutdown: null };
  }

  let server: AppServerProcess;
  try {
    server = await bootAppServer({
      invocation: parseAppInvocation(argv),
      listenerHost: createNodeHttpAppListenerHost(),
      readAsset: readAssetFromDisk,
      liveness: createFileLivenessRecord(appRecordDirectory(), APP_LIVENESS_FILE_NAME),
      sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
    });
  } catch (cause) {
    host.reportBootRefusal(cause instanceof Error ? cause.message : String(cause));
    return { exitCode: 1, iterations: 0, shutdown: null };
  }

  host.onTerminationSignal(() => {
    server.requestShutdown();
  });
  const ticks = await server.runUntilShutdown();
  await server.shutdown();
  // `shutdown` is deliberately reported as `null`: the field's type is the finance agent's own
  // shutdown report, and this mode's report is a different fact. The exit code is what `start.ts`
  // reads, and it is the whole of what a caller acts on.
  return { exitCode: 0, iterations: ticks, shutdown: null };
}

/**
 * The whole entrypoint. Returns the outcome rather than exiting, so the exit is one statement in
 * `start.ts` and nothing above it can end the process early.
 *
 * Three modes now. The app-server mode is checked FIRST, because it shares the `--health` flag and
 * must answer for itself rather than for the agent: a readiness answer about the wrong service is
 * worse than none.
 */
export async function main(argv: readonly string[]): Promise<RunOutcome> {
  if (argv.includes(SERVE_APP_FLAG)) {
    return serveAppMain(argv);
  }
  if (argv.includes(HEALTH_FLAG)) {
    return { exitCode: runHealthCommand(), iterations: 0, shutdown: null };
  }
  return runFinanceAgentProcess(financeAgentDependenciesFromHost(readBotIdentity(argv)), createNodeProcessHost(), IDLE_DELAY_MS);
}

/** Re-exported so a test drives the same boot the process does, with its own injections. */
export { bootFinanceAgent };
