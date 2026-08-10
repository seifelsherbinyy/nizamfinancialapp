// @vitest-environment node
/**
 * NIZAM · The signal-bus server process — the guarantees a library cannot have
 * Implemented by: PFOS Contract 12 / Phase 10.19 (spec 06-two-agent-vps)
 * Owning requirements: R34 (the bus service has a process, an internal-only binding and a readiness
 *   answer), R9 (it binds the internal endpoint and nothing else, and refuses any endpoint that
 *   would be reachable elsewhere), R27 (every incomplete entry named in ONE message), R7 (the
 *   envelope schema on every write), R8 (the consent gate on every read), R10 (the excluded
 *   classification never crosses), R22 (readiness computed against local files, no listener),
 *   R29 (the halt stops a bus publish — at the publisher, which is where §8.2 puts it)
 * Depends on: ./busServer, ./busMain (the platform wiring's pure parts only), ./financeAgent and
 *   ./haltGate (for the halt observation), ../signals (the real append-only store and its audit
 *   mirror), ../ops/composeTemplate (the ONE compose parser). A REAL migrated store on a temporary
 *   directory; no socket, no network, no provider, and no live model.
 *
 * ## Why the binding assertions are made against the process, not against a socket
 *
 * Design delta D6, applied a second time. R9's claim is about an ABSENCE, and probing a socket and
 * finding nothing is also what a crashed listener, a wrong port and a firewall look like — so it
 * would pass for the wrong reason. The listener host is therefore injected and RECORDS what it was
 * asked to bind, the process publishes its own `listeningPorts`, and both are read below in both
 * directions: exactly the configured port was asked for, exactly it is held, and nothing else was
 * requested. The topology half is read from the real `ops/docker-compose.yml` through the existing
 * parser, so the two halves of "binds internally, publishes nothing" are asserted together.
 *
 * ## Every negative below is shown FAILING the guarded operation
 *
 * Not merely returning a refusal shape: after each refusal the store's row count and its audit
 * mirror are read, so a rule that returned the right word while writing the row anyway would fail.
 *
 * Every value here is synthetic and derived from an entry name. No real domain, identifier, token or
 * figure appears (R24).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EnvConfigAggregateError,
  KILL_SENTINEL_MOUNT_TARGET,
  SERVICE_ENTRY_NAMES,
  SHARED_ENTRIES,
  type EnvSource,
} from '../config/environment';
import { BUS_SERVICE as BUS_COMPOSE_SERVICE, parseComposeSubset, type YamlMap } from '../ops/composeTemplate';
import type { SignalDraft, StoredSignalReceipt } from '../ports/signalBus';
import { readAudit, type SignalStoreContext } from '../signals';
import { NARROW_TIERS_READABLE_BY_BOTH, WIDENED_KINDS } from '../signals';
import {
  bootFinanceAgent,
  FINANCE_CONTAINER_PORT_ENTRY,
  FINANCE_DATA_DIR_ENTRY,
  FINANCE_STORE_FILE_ENTRY,
  type FinanceAgentDependencies,
  type HttpListenerHandle,
  type HttpListenerHost,
} from './financeAgent';
import { HaltEngagedError } from './haltGate';
import { requestPathOf } from './busMain';
import {
  bootBusServer,
  BUS_ENDPOINT_REFUSALS,
  BUS_EXPECTED_SCHEMA_VERSION,
  BUS_HEARTBEAT_INTERVAL_MS,
  BUS_HEARTBEAT_MAX_AGE_MS,
  BUS_INTERNAL_ENDPOINT_ENTRY,
  BUS_MAX_BODY_BYTES,
  BUS_PUBLISH_PATH,
  BUS_READ_PATH,
  BUS_RESERVED_ENDPOINT_HOSTS,
  BusProcessError,
  heartbeatIsFresh,
  parseInternalEndpoint,
  parseReadQuery,
  runBusServerProcess,
  SIGNALS_DATA_DIR_ENTRY,
  SIGNALS_STORE_FILE_ENTRY,
  type BusHeartbeat,
  type BusListenerHandle,
  type BusListenerHost,
  type BusProcessHost,
  type BusRequest,
  type BusServerDependencies,
  type BusServerProcess,
} from './busServer';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

const STORE_FILE = 'signals.db';
const BUS_HOST = 'signalbus';
const BUS_PORT = 7431;
const INTERNAL_ENDPOINT = `${BUS_HOST}:${BUS_PORT}`;

const SENTINEL_PATH = `${KILL_SENTINEL_MOUNT_TARGET}/halt`;
const SYNTHETIC_BASE = 'https://provider.invalid';
const SYNTHETIC_SENDER = '101';
const FINANCE_STORE_FILE = 'finance.db';
const FINANCE_PORT = 9101;
const BOT_ID = 'bot-b';

const temporaryDirectories: string[] = [];

function freshDataDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// The harness: everything injected, everything inspectable
// ---------------------------------------------------------------------------------------------

/** A complete bus environment, minus or plus whatever a case overrides. */
function busEnv(dataDir: string, overrides: Readonly<Record<string, string | undefined>> = {}): EnvSource {
  const base: Record<string, string | undefined> = {
    [SIGNALS_DATA_DIR_ENTRY]: dataDir,
    [SIGNALS_STORE_FILE_ENTRY]: STORE_FILE,
    [BUS_INTERNAL_ENDPOINT_ENTRY]: INTERNAL_ENDPOINT,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return base;
}

/** A listener host that records what it was asked to bind, and binds nothing. */
interface BusListenerRecorder extends BusListenerHost {
  readonly requested: readonly number[];
  readonly closed: readonly number[];
  readonly accepts: readonly ((request: BusRequest) => unknown)[];
}

function createBusListenerRecorder(): BusListenerRecorder {
  const requested: number[] = [];
  const closed: number[] = [];
  const accepts: ((request: BusRequest) => unknown)[] = [];
  return {
    requested,
    closed,
    accepts,
    listen(port, accept): Promise<BusListenerHandle> {
      requested.push(port);
      accepts.push(accept);
      return Promise.resolve({
        port,
        close: async () => {
          closed.push(port);
        },
      });
    },
  };
}

/** An in-memory liveness record, so freshness is a value a case sets rather than a wall clock. */
interface HeartbeatRecorder extends BusHeartbeat {
  readonly touches: () => number;
  readonly cleared: () => number;
  setAgeMs(age: number | null): void;
}

function createHeartbeatRecorder(): HeartbeatRecorder {
  let touches = 0;
  let cleared = 0;
  let age: number | null = null;
  return {
    touches: () => touches,
    cleared: () => cleared,
    setAgeMs(next: number | null): void {
      age = next;
    },
    touch: () => {
      touches += 1;
      age = 0;
    },
    clear: () => {
      cleared += 1;
      age = null;
    },
    ageMs: () => age,
  };
}

interface BusHarness {
  readonly deps: BusServerDependencies;
  readonly listener: BusListenerRecorder;
  readonly heartbeat: HeartbeatRecorder;
  readonly dataDir: string;
}

function busHarness(options: { readonly env?: EnvSource; readonly dataDir?: string } = {}): BusHarness {
  const dataDir = options.dataDir ?? freshDataDir('nizam-bus-');
  const listener = createBusListenerRecorder();
  const heartbeat = createHeartbeatRecorder();
  let tick = 0;

  const deps: BusServerDependencies = {
    env: options.env ?? busEnv(dataDir),
    listenerHost: listener,
    heartbeat,
    consent: { readableTiers: NARROW_TIERS_READABLE_BY_BOTH, widenedKinds: WIDENED_KINDS },
    now: () => {
      tick += 1;
      return new Date(Date.UTC(2026, 0, 1) + tick * 1_000).toISOString();
    },
    newAuditId: () => {
      tick += 1;
      return `audit-${String(tick).padStart(4, '0')}`;
    },
    sleep: async () => undefined,
  };
  return { deps, listener, heartbeat, dataDir };
}

/** The store context an assertion reads the append-only mirror through. */
function storeContextOf(bus: BusServerProcess): SignalStoreContext {
  let tick = 0;
  return {
    handle: bus.store,
    now: () => new Date(Date.UTC(2026, 0, 2) + (tick += 1) * 1_000).toISOString(),
    newAuditId: () => `probe-${String(tick).padStart(4, '0')}`,
  };
}

function storedRowCount(bus: BusServerProcess): number {
  const row = bus.store.db.prepare('SELECT COUNT(*) AS n FROM signals').get() as { n: number };
  return Number(row.n);
}

function post(bus: BusServerProcess, path: string, body: unknown): { readonly status: number; readonly payload: Record<string, unknown> } {
  const response = bus.handle({ method: 'POST', path, body: JSON.stringify(body) });
  return { status: response.status, payload: JSON.parse(response.body) as Record<string, unknown> };
}

/** A well-formed draft, as JSON. Cases mutate one field to make one rule fire. */
function draftBody(overrides: Readonly<Record<string, unknown>> = {}, payload: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    signalId: 'sig-0001',
    ts: '2026-01-01T00:00:00Z',
    producer: 'finance',
    kind: 'money_pressure',
    tier: 'money_safe',
    consentScope: 'shared',
    payload: { level: 'amber', direction: 'downshift', ...payload },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// The positive path, so every absence below is not vacuous
// ---------------------------------------------------------------------------------------------

describe('the bus process boots, binds the internal endpoint, and serves the two routes (R34)', () => {
  it('binds exactly the configured internal port and holds exactly that one listener (R9)', async () => {
    const { deps, listener } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      expect(bus.endpoint).toEqual({ host: BUS_HOST, port: BUS_PORT });
      // The process's own listener set, and the injected host's own bind record. Both directions.
      expect(bus.listeningPorts).toEqual([BUS_PORT]);
      expect(listener.requested).toEqual([BUS_PORT]);
      expect(listener.accepts).toHaveLength(1);
      expect(bus.isAccepting()).toBe(true);
    } finally {
      await bus.shutdown();
    }
  });

  it('stores a well-formed envelope and audits the accept', async () => {
    const { deps } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      const { status, payload } = post(bus, BUS_PUBLISH_PATH, draftBody());
      expect(status).toBe(200);
      expect(payload.outcome).toBe('stored');
      expect(payload.signalId).toBe('sig-0001');
      expect(String(payload.hash)).toMatch(/^[0-9a-f]{64}$/);
      expect(storedRowCount(bus)).toBe(1);

      const audit = readAudit(storeContextOf(bus));
      expect(audit.map((line) => line.event)).toEqual(['accepted']);
      // The mirror records a measurement and never the value: this envelope carried no note.
      expect(audit[0]?.noteLength).toBeNull();
    } finally {
      await bus.shutdown();
    }
  });

  it('serves a producer its own signal, and answers with the delivered shape', async () => {
    const { deps } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      post(bus, BUS_PUBLISH_PATH, draftBody());
      const { status, payload } = post(bus, BUS_READ_PATH, { subscriber: 'finance', limit: 10 });
      expect(status).toBe(200);
      expect(payload.outcome).toBe('delivered');
      expect((payload.signals as unknown[]).length).toBe(1);
    } finally {
      await bus.shutdown();
    }
  });

  it('reports ready only when the store, the pragmas, the version and the listener all hold (R22)', async () => {
    const { deps, heartbeat } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      // Boot recorded the liveness fact, so the exec check has something to date.
      expect(heartbeat.touches()).toBeGreaterThan(0);
      const ready = bus.readiness();
      expect(ready.status).toBe('ready');
      expect(ready.schemaVersion).toBe(BUS_EXPECTED_SCHEMA_VERSION);
      expect(ready.components.every((c) => c.verdict === 'pass')).toBe(true);
    } finally {
      await bus.shutdown();
    }
  });

  it('ticks the liveness record and reports the ticks it performed', async () => {
    const { deps, heartbeat } = busHarness();
    const bus = await bootBusServer(deps);
    const before = heartbeat.touches();
    bus.tickOnce();
    expect(heartbeat.touches()).toBe(before + 1);
    await bus.shutdown();
  });

  it('runs to a clean shutdown through the process wrapper and exits zero', async () => {
    const { deps, listener, heartbeat } = busHarness();
    let requestShutdown: (() => void) | null = null;
    const host: BusProcessHost = {
      onTerminationSignal: (handler) => {
        requestShutdown = handler;
      },
      reportBootRefusal: () => {
        throw new Error('the boot must not be refused on a complete environment');
      },
    };
    const deferred: BusServerDependencies = {
      ...deps,
      sleep: async () => {
        requestShutdown?.();
      },
    };
    const outcome = await runBusServerProcess(deferred, host);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.ticks).toBeGreaterThan(0);
    expect(outcome.shutdown?.stoppedAccepting).toBe(true);
    expect(outcome.shutdown?.listenersClosed).toBe(1);
    expect(outcome.shutdown?.heartbeatCleared).toBe(true);
    expect(outcome.shutdown?.storeClosed).toBe(true);
    expect(listener.closed).toEqual([BUS_PORT]);
    expect(heartbeat.cleared()).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// R7 — the envelope schema on every write, shown REFUSING and shown not storing
// ---------------------------------------------------------------------------------------------

describe('the envelope schema is enforced on every write, and a refusal stores nothing (R7)', () => {
  const cases: readonly { readonly why: string; readonly reason: string; readonly at: string; readonly body: Record<string, unknown> }[] = [
    {
      why: 'a figure has no field to travel in, so a magnitude is refused rather than dropped',
      reason: 'field_numeric',
      at: 'payload.balanceMilli',
      body: draftBody({}, { balanceMilli: 47_000 }),
    },
    {
      why: "a due date is a second clock, and the envelope's own completion instant is its only temporal field",
      reason: 'field_temporal',
      at: 'payload.dueOn',
      body: draftBody({}, { dueOn: '2026-02-01' }),
    },
    {
      why: 'an account identifier points at a record, and the envelope has no identifier field',
      reason: 'field_identifier',
      at: 'payload.accountRef',
      body: draftBody({}, { accountRef: 'a-b-c' }),
    },
    {
      why: 'an over-length note is REFUSED, never truncated: truncation would ship the first 120 characters of something that was never allowed to leave',
      reason: 'note_exceeds_cap',
      at: 'payload.note',
      body: draftBody({}, { note: 'x'.repeat(121) }),
    },
    {
      why: 'a note is directional rather than quantitative, so a digit inside one is refused',
      reason: 'note_carries_a_figure',
      at: 'payload.note',
      body: draftBody({}, { note: 'pressure up by 3 notches' }),
    },
    {
      why: 'integrity is the bus\'s claim, not the producer\'s',
      reason: 'hash_asserted_by_producer',
      at: 'hash',
      body: draftBody({ hash: 'f'.repeat(64) }),
    },
    {
      why: 'a surplus field beside the payload leaks exactly as well as one inside it',
      reason: 'field_temporal',
      at: 'settledOn',
      body: draftBody({ settledOn: '2026-02-01' }),
    },
  ];

  for (const testCase of cases) {
    it(`refuses ${testCase.reason} at ${testCase.at}: ${testCase.why}`, async () => {
      const { deps } = busHarness();
      const bus = await bootBusServer(deps);
      try {
        const { status, payload } = post(bus, BUS_PUBLISH_PATH, testCase.body);
        expect(status).toBe(200);
        expect(payload.outcome).toBe('refused');
        expect(payload.reason).toBe(testCase.reason);
        expect(payload.at).toBe(testCase.at);

        // Shown FAILING the guarded operation: nothing was stored, and no repaired or truncated
        // copy exists anywhere.
        expect(storedRowCount(bus)).toBe(0);
        const audit = readAudit(storeContextOf(bus));
        expect(audit.map((line) => line.event)).toEqual(['refused_on_write']);
        expect(audit[0]?.reason).toBe(testCase.reason);

        // The answer carries no field the rejected value could have travelled in (§4.3.6).
        expect(Object.keys(payload).sort()).toEqual(['at', 'code', 'noteLength', 'outcome', 'reason', 'signalIdRef']);
        expect(JSON.stringify(payload)).not.toContain('47000');
      } finally {
        await bus.shutdown();
      }
    });
  }

  it('refuses the excluded classification as an unknown member, so it never crosses (R10)', async () => {
    const { deps } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      // Assembled from fragments, the way every other refusal test spells it: §4.4.3 binds "names
      // it" as tightly as "points at it", so the token never appears contiguously in this tree.
      const excluded = 'strict_' + 'local_' + 'maximum';
      const { payload } = post(bus, BUS_PUBLISH_PATH, draftBody({ tier: excluded }));
      expect(payload.outcome).toBe('refused');
      // Not "filtered later": the classification is not a member of the tier vocabulary at all.
      expect(payload.reason).toBe('tier_not_a_member');
      expect(payload.at).toBe('tier');
      expect(storedRowCount(bus)).toBe(0);
    } finally {
      await bus.shutdown();
    }
  });

  it('refuses a repeated signal identifier rather than overwriting the stored envelope', async () => {
    const { deps } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      expect(post(bus, BUS_PUBLISH_PATH, draftBody()).payload.outcome).toBe('stored');
      const repeat = post(bus, BUS_PUBLISH_PATH, draftBody({ kind: 'budget_breach' }));
      expect(repeat.payload.outcome).toBe('refused');
      expect(repeat.payload.reason).toBe('signal_id_already_stored');
      expect(storedRowCount(bus)).toBe(1);
      const stored = bus.store.db.prepare('SELECT kind FROM signals WHERE signal_id = ?').get('sig-0001') as { kind: string };
      expect(stored.kind).toBe('money_pressure');
    } finally {
      await bus.shutdown();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// R8 — the consent gate on every read
// ---------------------------------------------------------------------------------------------

describe('the consent gate is enforced on every read (R8)', () => {
  it('refuses a producer_only signal to the other agent, and a refusal is not an empty delivery', async () => {
    const { deps } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      expect(post(bus, BUS_PUBLISH_PATH, draftBody({ consentScope: 'producer_only' })).payload.outcome).toBe('stored');

      const refused = post(bus, BUS_READ_PATH, { subscriber: 'life', limit: 10 });
      expect(refused.status).toBe(200);
      expect(refused.payload.outcome).toBe('refused');
      expect(refused.payload.reason).toBe('consent_scope_producer_only');
      // §4.5.2: the refusal is a DIFFERENT shape, so it cannot be mistaken for "no such signal".
      expect(refused.payload.signals).toBeUndefined();

      // The producer's own read of its own signal is the positive control.
      const own = post(bus, BUS_READ_PATH, { subscriber: 'finance', limit: 10 });
      expect(own.payload.outcome).toBe('delivered');
      expect((own.payload.signals as unknown[]).length).toBe(1);
    } finally {
      await bus.shutdown();
    }
  });

  it('refuses a kind the owner has not widened, even when the producer marked it shared (§4.5.3)', async () => {
    const { deps } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      // The allowlist of widened kinds ships EMPTY, so the effective scope is the narrower of the
      // two and a mis-set field widens nothing.
      expect(WIDENED_KINDS).toEqual([]);
      expect(post(bus, BUS_PUBLISH_PATH, draftBody({ consentScope: 'shared' })).payload.outcome).toBe('stored');
      const refused = post(bus, BUS_READ_PATH, { subscriber: 'life', limit: 10 });
      expect(refused.payload.outcome).toBe('refused');
      expect(refused.payload.reason).toBe('consent_scope_producer_only');
    } finally {
      await bus.shutdown();
    }
  });

  it('refuses a query that is not the port\'s own shape rather than defaulting a field', async () => {
    const { deps } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      expect(post(bus, BUS_READ_PATH, { limit: 1 }).payload.refusal).toBe('query_subscriber_not_a_member');
      expect(post(bus, BUS_READ_PATH, { subscriber: 'nobody', limit: 1 }).payload.refusal).toBe('query_subscriber_not_a_member');
      expect(post(bus, BUS_READ_PATH, { subscriber: 'finance' }).payload.refusal).toBe('query_limit_not_a_count');
      expect(post(bus, BUS_READ_PATH, { subscriber: 'finance', limit: -1 }).payload.refusal).toBe('query_limit_not_a_count');
      expect(post(bus, BUS_READ_PATH, { subscriber: 'finance', limit: 1, kind: 'anything' }).payload.refusal).toBe('query_kind_not_a_member');
      expect(post(bus, BUS_READ_PATH, { subscriber: 'finance', limit: 1, since: 7 }).payload.refusal).toBe('query_since_not_a_string');
    } finally {
      await bus.shutdown();
    }
  });

  it('parses only the port\'s four query fields, and offers no producer filter', () => {
    const parsed = parseReadQuery({ subscriber: 'finance', limit: 5, kind: 'readiness', since: '2026-01-01T00:00:00Z', producer: 'life' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Object.keys(parsed.query).sort()).toEqual(['kind', 'limit', 'since', 'subscriber']);
  });
});

// ---------------------------------------------------------------------------------------------
// R27 — the boot refusal, naming every finding at once
// ---------------------------------------------------------------------------------------------

describe('an incomplete environment refuses the boot (R27)', () => {
  it('names EVERY missing entry in one message rather than refusing on the first', async () => {
    const dataDir = freshDataDir('nizam-bus-');
    const { deps } = busHarness({
      dataDir,
      env: busEnv(dataDir, { [SIGNALS_STORE_FILE_ENTRY]: undefined, [BUS_INTERNAL_ENDPOINT_ENTRY]: undefined }),
    });
    await expect(bootBusServer(deps)).rejects.toBeInstanceOf(EnvConfigAggregateError);
    const raised = await bootBusServer(deps).catch((cause: unknown) => cause);
    const aggregate = raised as EnvConfigAggregateError;
    expect([...aggregate.entries].sort()).toEqual([BUS_INTERNAL_ENDPOINT_ENTRY, SIGNALS_STORE_FILE_ENTRY].sort());
    expect(aggregate.message).toContain(SIGNALS_STORE_FILE_ENTRY);
    expect(aggregate.message).toContain(BUS_INTERNAL_ENDPOINT_ENTRY);
  });

  it('treats an unfilled angle-bracket placeholder as a failure rather than as a value', async () => {
    const dataDir = freshDataDir('nizam-bus-');
    const { deps } = busHarness({ dataDir, env: busEnv(dataDir, { [BUS_INTERNAL_ENDPOINT_ENTRY]: `<${BUS_INTERNAL_ENDPOINT_ENTRY}>` }) });
    await expect(bootBusServer(deps)).rejects.toBeInstanceOf(EnvConfigAggregateError);
  });

  it('reports the refusal and exits non-zero rather than running degraded', async () => {
    const dataDir = freshDataDir('nizam-bus-');
    const { deps } = busHarness({ dataDir, env: busEnv(dataDir, { [SIGNALS_STORE_FILE_ENTRY]: '' }) });
    const reported: string[] = [];
    const outcome = await runBusServerProcess(deps, {
      onTerminationSignal: () => undefined,
      reportBootRefusal: (message) => reported.push(message),
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.shutdown).toBeNull();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain(SIGNALS_STORE_FILE_ENTRY);
  });

  it('refuses the boot before it binds anything, so a refused bus holds no listener', async () => {
    const dataDir = freshDataDir('nizam-bus-');
    const harness = busHarness({ dataDir, env: busEnv(dataDir, { [BUS_INTERNAL_ENDPOINT_ENTRY]: undefined }) });
    await expect(bootBusServer(harness.deps)).rejects.toThrow();
    expect(harness.listener.requested).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// R9 — the internal-only binding, in both directions
// ---------------------------------------------------------------------------------------------

describe('the bus binds the internal network only, and publishes no port (R9)', () => {
  const refusedEndpoints: readonly { readonly value: string; readonly refusal: string; readonly why: string }[] = [
    { value: '', refusal: 'endpoint_empty', why: 'an unset endpoint is a startup failure, never a guess' },
    { value: 'https://signalbus:7431', refusal: 'endpoint_carries_a_scheme', why: 'a scheme implies a route through something that speaks one, and the bus has no proxy route at all' },
    { value: 'signalbus:7431/signals', refusal: 'endpoint_carries_a_path', why: 'a path implies a route on a shared host, which is the same mistake spelled differently' },
    { value: '0.0.0.0:7431', refusal: 'endpoint_host_not_an_internal_name', why: 'a wildcard is the first half of the exposure R9 forbids' },
    { value: '10.0.0.4:7431', refusal: 'endpoint_host_not_an_internal_name', why: 'an address literal is not a name an internal network resolves' },
    { value: 'localhost:7431', refusal: 'endpoint_host_reserved', why: 'each client dialling it would reach ITSELF, which is a bus nobody can talk to reported healthy' },
    { value: ':7431', refusal: 'endpoint_host_absent', why: 'an endpoint with no host names nothing' },
    { value: 'signalbus', refusal: 'endpoint_port_absent', why: 'an endpoint with no port binds nothing' },
    { value: 'signalbus:0', refusal: 'endpoint_port_not_in_range', why: 'zero is not a port' },
    { value: 'signalbus:65536', refusal: 'endpoint_port_not_in_range', why: 'a number past the protocol\'s range is not a port' },
    { value: 'signalbus:74x31', refusal: 'endpoint_port_absent', why: 'a port is a bare run of digits, refused rather than parsed leniently' },
  ];

  for (const endpoint of refusedEndpoints) {
    it(`refuses the endpoint shape ${endpoint.refusal}: ${endpoint.why}`, () => {
      let raised: unknown;
      try {
        parseInternalEndpoint(endpoint.value);
      } catch (cause) {
        raised = cause;
      }
      expect(raised).toBeInstanceOf(BusProcessError);
      const error = raised as BusProcessError;
      expect(error.code).toBe('BUS_ENDPOINT_UNUSABLE');
      expect(error.refusal).toBe(endpoint.refusal);
      // A refusal names the entry and the rule, and never the configured value (R24).
      expect(error.message).toContain(BUS_INTERNAL_ENDPOINT_ENTRY);
    });
  }

  it('refuses a boot whose endpoint would be reachable elsewhere, before it opens the store', async () => {
    const dataDir = freshDataDir('nizam-bus-');
    const harness = busHarness({ dataDir, env: busEnv(dataDir, { [BUS_INTERNAL_ENDPOINT_ENTRY]: '0.0.0.0:7431' }) });
    await expect(bootBusServer(harness.deps)).rejects.toBeInstanceOf(BusProcessError);
    expect(harness.listener.requested).toEqual([]);
  });

  it('holds one listener and only one, whatever the request traffic', async () => {
    const { deps, listener } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      post(bus, BUS_PUBLISH_PATH, draftBody());
      post(bus, BUS_READ_PATH, { subscriber: 'finance', limit: 1 });
      bus.readiness();
      bus.tickOnce();
      // Readiness is an exec check, so it adds no route: the set is closed after the single bind.
      expect(listener.requested).toEqual([BUS_PORT]);
      expect(bus.listeningPorts).toEqual([BUS_PORT]);
    } finally {
      await bus.shutdown();
    }
  });

  it('is given no ports key by the topology, so no bind it makes can reach the host', () => {
    // The other half of the same claim, read from the real template through the ONE compose parser.
    // BUS_NETWORK_BINDING item 3 permits no ports entry, not even bound to a loopback address.
    const compose = readFileSync(join(REPO, 'ops/docker-compose.yml'), 'utf8');
    const services = (parseComposeSubset(compose).services ?? {}) as YamlMap;
    const bus = services[BUS_COMPOSE_SERVICE] as YamlMap | undefined;
    expect(bus).toBeDefined();
    expect(bus?.ports).toBeUndefined();
    expect(bus?.networks).toEqual(['bus-internal']);
  });

  it('every declared endpoint refusal is exercised above, so the vocabulary carries no dead member', () => {
    const exercised = new Set(refusedEndpoints.map((e) => e.refusal));
    expect([...BUS_ENDPOINT_REFUSALS].filter((r) => !exercised.has(r))).toEqual([]);
  });

  it('names no host of its own: the reserved list is a refusal, not a default', () => {
    expect(BUS_RESERVED_ENDPOINT_HOSTS.length).toBeGreaterThan(0);
    for (const host of BUS_RESERVED_ENDPOINT_HOSTS) {
      expect(() => parseInternalEndpoint(`${host}:1`)).toThrow(BusProcessError);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// R29 / §8.2 — the halt stops a publish, at the publisher
// ---------------------------------------------------------------------------------------------

/** A synthetic value for one finance entry, derived from the entry name. */
function financeSyntheticValue(entry: string): string {
  if (entry === SHARED_ENTRIES.allowedSenderIds) return SYNTHETIC_SENDER;
  if (entry === SHARED_ENTRIES.mode) return 'longPoll';
  if (entry === SHARED_ENTRIES.maxWorkItems) return '2';
  if (entry === 'KILL_SENTINEL_PATH') return SENTINEL_PATH;
  if (entry === 'NIZAM_KILL_ALL') return '0';
  if (entry === FINANCE_STORE_FILE_ENTRY) return FINANCE_STORE_FILE;
  if (entry === FINANCE_CONTAINER_PORT_ENTRY) return String(FINANCE_PORT);
  if (entry === BUS_INTERNAL_ENDPOINT_ENTRY) return INTERNAL_ENDPOINT;
  if (entry.endsWith('_API_BASE')) return SYNTHETIC_BASE;
  if (entry.endsWith('_WEEKLY_CAP')) return '2500000';
  if (entry.endsWith('_TIMEOUT_MS')) return '3000';
  return `syn-${entry.toLowerCase()}`;
}

function financeListenerRecorder(): HttpListenerHost {
  return {
    listen(port: number): Promise<HttpListenerHandle> {
      return Promise.resolve({ port, close: async () => undefined });
    },
  };
}

/** The finance agent, wired to publish into the REAL bus process. Its own store, its own directory. */
function financeDependencies(bus: BusServerProcess, sentinelExists: () => boolean): FinanceAgentDependencies {
  const dataDir = freshDataDir('nizam-finance-');
  const env: Record<string, string | undefined> = {};
  for (const entry of SERVICE_ENTRY_NAMES.finance) env[entry] = financeSyntheticValue(entry);
  env[FINANCE_DATA_DIR_ENTRY] = dataDir;
  let tick = 0;
  const refuse = async (): Promise<never> => {
    throw Object.assign(new Error('no live provider client is wired in this test'), { code: 'TELEGRAM_SEND_REFUSED' });
  };
  return {
    env,
    botId: BOT_ID,
    transportClient: { fetchUpdates: refuse, sendMessage: refuse },
    worker: { process: async () => ({ outcome: 'done' }) },
    listenerHost: financeListenerRecorder(),
    sentinelExists,
    logSink: () => undefined,
    now: () => new Date(Date.UTC(2026, 0, 1) + (tick += 1) * 1_000).toISOString(),
    newId: () => `ref-${String((tick += 1)).padStart(4, '0')}`,
    sleep: async () => undefined,
    poll: { timeoutSeconds: 5, limit: 10 },
    send: { baseMs: 1, maxMs: 2, maxAttempts: 1 },
    retry: { baseMs: 1, maxMs: 2, maxAttempts: 1 },
    // The publisher is the bus's own accept surface, so a permitted publish really is stored.
    publish: async (draft: SignalDraft): Promise<StoredSignalReceipt> => {
      const { payload } = post(bus, BUS_PUBLISH_PATH, draft as unknown as Record<string, unknown>);
      if (payload.outcome !== 'stored') throw new Error(`the bus refused the publish: ${String(payload.reason)}`);
      return { signalId: String(payload.signalId), hash: String(payload.hash), storedAt: String(payload.storedAt) };
    },
  };
}

describe('the halt stops a bus publish, at the publisher where §8.2 puts it (R29)', () => {
  const draft = (): SignalDraft => ({
    signalId: 'sig-halt',
    ts: '2026-01-01T00:00:00Z',
    producer: 'finance',
    kind: 'money_pressure',
    tier: 'money_safe',
    consentScope: 'producer_only',
    payload: { level: 'red' },
  });

  it('refuses the publish before the envelope reaches the bus, and the store records nothing', async () => {
    const { deps } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      const agent = await bootFinanceAgent(financeDependencies(bus, () => true));
      try {
        await expect(agent.publishSignal(draft())).rejects.toBeInstanceOf(HaltEngagedError);
        // Shown FAILING the guarded operation: the append-only store has no row and its audit
        // mirror has no line, so the refusal happened before anything was written anywhere.
        expect(storedRowCount(bus)).toBe(0);
        expect(readAudit(storeContextOf(bus))).toEqual([]);
      } finally {
        await agent.shutdown();
      }
    } finally {
      await bus.shutdown();
    }
  });

  it('publishes into the bus when the halt is released, so the refusal above is not vacuous', async () => {
    const { deps } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      const agent = await bootFinanceAgent(financeDependencies(bus, () => false));
      try {
        const receipt = await agent.publishSignal(draft());
        expect(receipt.signalId).toBe('sig-halt');
        expect(storedRowCount(bus)).toBe(1);
        expect(readAudit(storeContextOf(bus)).map((line) => line.event)).toEqual(['accepted']);
      } finally {
        await agent.shutdown();
      }
    } finally {
      await bus.shutdown();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// R22 — readiness is a fact about something other than this module's own execution
// ---------------------------------------------------------------------------------------------

describe('readiness reports the listener as well as the store (R22)', () => {
  it('reports not ready when the liveness record is absent: silence is not health', async () => {
    const { deps, heartbeat } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      heartbeat.setAgeMs(null);
      const report = bus.readiness();
      expect(report.status).toBe('not_ready');
      expect(report.components.find((c) => c.check === 'queue_worker_alive')?.failure).toBe('queue_worker_not_reporting');
    } finally {
      await bus.shutdown();
    }
  });

  it('reports not ready when the liveness record is stale', async () => {
    const { deps, heartbeat } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      heartbeat.setAgeMs(BUS_HEARTBEAT_MAX_AGE_MS + 1);
      expect(bus.readiness().status).toBe('not_ready');
      heartbeat.setAgeMs(BUS_HEARTBEAT_MAX_AGE_MS);
      expect(bus.readiness().status).toBe('ready');
    } finally {
      await bus.shutdown();
    }
  });

  it('treats a record dated in the future as not fresh, which is the fail-closed direction', () => {
    expect(heartbeatIsFresh(null)).toBe(false);
    expect(heartbeatIsFresh(-1)).toBe(false);
    expect(heartbeatIsFresh(Number.NaN)).toBe(false);
    expect(heartbeatIsFresh(0)).toBe(true);
  });

  it('keeps the staleness window wider than the tick interval, so one slow tick is not an outage', () => {
    expect(BUS_HEARTBEAT_MAX_AGE_MS).toBeGreaterThan(BUS_HEARTBEAT_INTERVAL_MS);
  });

  it('expects the SIGNALS migration series rather than the finance one', () => {
    expect(BUS_EXPECTED_SCHEMA_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// The accept surface's own refusals
// ---------------------------------------------------------------------------------------------

describe('the accept surface refuses everything it does not recognise', () => {
  it('refuses a method it does not serve, an unknown route, an over-bound body and a non-JSON body', async () => {
    const { deps } = busHarness();
    const bus = await bootBusServer(deps);
    try {
      expect(bus.handle({ method: 'GET', path: BUS_READ_PATH, body: '{}' }).status).toBe(405);
      expect(bus.handle({ method: 'POST', path: '/anything-else', body: '{}' }).status).toBe(404);
      expect(bus.handle({ method: 'POST', path: BUS_PUBLISH_PATH, body: 'x'.repeat(BUS_MAX_BODY_BYTES + 1) }).status).toBe(413);
      expect(bus.handle({ method: 'POST', path: BUS_PUBLISH_PATH, body: 'not json' }).status).toBe(400);
      expect(storedRowCount(bus)).toBe(0);
    } finally {
      await bus.shutdown();
    }
  });

  it('refuses everything once shutdown has begun, so nothing arrives while the store closes', async () => {
    const { deps } = busHarness();
    const bus = await bootBusServer(deps);
    await bus.shutdown();
    const response = bus.handle({ method: 'POST', path: BUS_PUBLISH_PATH, body: JSON.stringify(draftBody()) });
    expect(response.status).toBe(503);
    expect(bus.isAccepting()).toBe(false);
  });

  it('routes on the path alone, ignoring a query string the platform may hand it', () => {
    expect(requestPathOf(`${BUS_READ_PATH}?limit=1`)).toBe(BUS_READ_PATH);
    expect(requestPathOf(BUS_PUBLISH_PATH)).toBe(BUS_PUBLISH_PATH);
    expect(requestPathOf(undefined)).toBe('');
  });
});
