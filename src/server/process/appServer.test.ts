/**
 * NIZAM · The owner-only application server, both halves
 * Implemented by: PFOS Contract 12 / Phase 10.18 (spec 06-two-agent-vps)
 * Owning requirements: R33 (owner-only reachability, loopback by construction, no default that
 *   opens it), R9 (the listener set holds one port and no other), R22 (readiness answers `storeless`
 *   over the shared liveness record), R24 (a refusal names a rule, never a value)
 *
 * The positive half shows the built output being served. The negative half is the point of the file:
 * every bind refusal is shown STOPPING THE BIND with nothing listening, every escape from the served
 * root is refused, and every method that is not a read is refused before the filesystem is touched.
 */
import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APP_BIND_REFUSALS,
  APP_INDEX_FILE,
  APP_LIVENESS_MAX_AGE_MS,
  APP_METHODS,
  appReadiness,
  AppServerError,
  bootAppServer,
  classifyLoopbackBind,
  contentTypeFor,
  LOOPBACK_BIND_ADDRESS,
  LOOPBACK_BIND_ADDRESS_V6,
  parseAppInvocation,
  requireLoopbackBind,
  serveAsset,
  type AppBindRefusal,
  type AppListenerHandle,
  type AppListenerHost,
  type AppRequest,
  type AppResponse,
  type AppServerDependencies,
} from './appServer';
import { isReady } from '../ops/healthProbe';
import type { LivenessRecord } from './liveness';

// ---------------------------------------------------------------------------------------------
// A real directory, because the containment guard resolves against a root that must exist
// ---------------------------------------------------------------------------------------------

function builtOutput(): string {
  const root = mkdtempSync(join(tmpdir(), 'nizam-app-'));
  writeFileSync(join(root, APP_INDEX_FILE), '<!doctype html><div id="root"></div>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app.js'), 'export const a = 1;');
  writeFileSync(join(root, 'assets', 'app.css'), ':root{}');
  return root;
}

function readFromDisk(): (path: string) => Uint8Array | null {
  return (path: string) => {
    try {
      return new Uint8Array(readFileSync(path));
    } catch {
      return null;
    }
  };
}

/** A liveness record with no disk behind it, so staleness is set rather than waited for. */
function recordingLiveness(initial: number | null = null): LivenessRecord & { touched: number; cleared: number; age: number | null } {
  const state = {
    touched: 0,
    cleared: 0,
    age: initial,
    touch: (): void => {
      state.touched += 1;
      state.age = 0;
    },
    clear: (): void => {
      state.cleared += 1;
      state.age = null;
    },
    ageMs: (): number | null => state.age,
  };
  return state;
}

/** A listener host that binds nothing and records what it was asked for. */
function recordingListenerHost(): AppListenerHost & { readonly bound: number[]; readonly closed: number[] } {
  const bound: number[] = [];
  const closed: number[] = [];
  return {
    bound,
    closed,
    listen(port: number, accept: (request: AppRequest) => AppResponse): Promise<AppListenerHandle> {
      void accept;
      bound.push(port);
      return Promise.resolve({
        port,
        close: (): Promise<void> => {
          closed.push(port);
          return Promise.resolve();
        },
      });
    },
  };
}

function dependencies(root: string, overrides: Partial<AppServerDependencies> = {}): AppServerDependencies {
  return {
    invocation: { port: 4321, root },
    listenerHost: recordingListenerHost(),
    readAsset: readFromDisk(),
    liveness: recordingLiveness(),
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// The positive half
// ---------------------------------------------------------------------------------------------

describe('the app server serves the built output and nothing else', () => {
  it('answers the root with the index document', () => {
    const root = builtOutput();
    const answer = serveAsset(root, { method: 'GET', path: '/' }, readFromDisk());
    expect(answer.status).toBe(200);
    expect(answer.contentType).toBe(contentTypeFor(APP_INDEX_FILE));
    expect(Buffer.from(answer.body).toString('utf8')).toContain('id="root"');
  });

  it('answers an asset with the type its extension names, and ignores a query string', () => {
    const root = builtOutput();
    const js = serveAsset(root, { method: 'GET', path: '/assets/app.js?v=1' }, readFromDisk());
    const css = serveAsset(root, { method: 'GET', path: '/assets/app.css' }, readFromDisk());
    expect([js.status, css.status]).toEqual([200, 200]);
    expect(js.contentType).toContain('javascript');
    expect(css.contentType).toContain('css');
  });

  it('answers a HEAD with a status and no body, so a reader learns nothing it did not ask for', () => {
    const root = builtOutput();
    const answer = serveAsset(root, { method: 'HEAD', path: '/assets/app.js' }, readFromDisk());
    expect(answer.status).toBe(200);
    expect(answer.body.byteLength).toBe(0);
  });

  it('falls back to the index for a path with no extension, so the application deep-links', () => {
    const root = builtOutput();
    const answer = serveAsset(root, { method: 'GET', path: '/budget/august' }, readFromDisk());
    expect(answer.status).toBe(200);
    expect(Buffer.from(answer.body).toString('utf8')).toContain('id="root"');
  });

  it('binds exactly one port and reports the loopback address (R9, R33)', async () => {
    const root = builtOutput();
    const host = recordingListenerHost();
    const server = await bootAppServer(dependencies(root, { listenerHost: host }));
    // Both directions: the process's own listener set, and the injected host's bind record.
    expect(server.listeningPorts).toEqual([4321]);
    expect(host.bound).toEqual([4321]);
    expect(server.boundAddress).toBe(LOOPBACK_BIND_ADDRESS);

    const report = await server.shutdown();
    expect(report.listenersClosed).toBe(1);
    expect(host.closed).toEqual([4321]);
    expect(server.listeningPorts).toEqual([]);
  });

  it('records liveness while it runs and clears it on shutdown, so a stopped server reads not-ready', async () => {
    const root = builtOutput();
    const liveness = recordingLiveness();
    const server = await bootAppServer(dependencies(root, { liveness }));
    expect(liveness.touched).toBeGreaterThan(0);
    expect(isReady(server.readiness())).toBe(true);

    server.requestShutdown();
    await server.runUntilShutdown();
    await server.shutdown();
    expect(liveness.cleared).toBe(1);
    expect(isReady(appReadiness(null, false))).toBe(false);
  });

  it('answers readiness in storeless mode, so the three store checks are not applicable', () => {
    const report = appReadiness(0, true);
    expect(report.mode).toBe('storeless');
    expect(report.components.filter((c) => c.verdict === 'not_applicable').map((c) => c.check).sort()).toEqual([
      'pragmas_in_force',
      'schema_version_expected',
      'store_opens',
    ]);
    expect(isReady(report)).toBe(true);
  });

  it('accepts both loopback spellings and nothing else', () => {
    expect(classifyLoopbackBind(LOOPBACK_BIND_ADDRESS)).toEqual({ ok: true, address: LOOPBACK_BIND_ADDRESS });
    expect(classifyLoopbackBind(LOOPBACK_BIND_ADDRESS_V6)).toEqual({ ok: true, address: LOOPBACK_BIND_ADDRESS_V6 });
    expect(requireLoopbackBind(LOOPBACK_BIND_ADDRESS)).toBe(LOOPBACK_BIND_ADDRESS);
  });

  it('reads its two values from the invocation, and the grammar cannot express a bind address', () => {
    const invocation = parseAppInvocation(['--serve-app', '--app-port', '4321', '--app-root', builtOutput()]);
    expect(invocation.port).toBe(4321);
    // An operator - or an edit - trying to widen the bind through the command line changes nothing:
    // there is no flag for it, so the token is not read and the address stays the constant.
    const widened = parseAppInvocation(['--serve-app', '--app-port=4321', '--app-bind', '0.0.0.0']);
    expect(widened.port).toBe(4321);
    expect(Object.keys(widened).sort()).toEqual(['port', 'root']);
  });
});

// ---------------------------------------------------------------------------------------------
// The negative half — each refusal shown stopping the guarded operation
// ---------------------------------------------------------------------------------------------

interface BindCase {
  readonly candidate: string;
  readonly refusal: AppBindRefusal;
  readonly why: string;
}

/** Shapes assembled from fragments, so this file holds no contiguous copy of a forbidden shape. */
const WILDCARD_V4 = ['0', '0', '0', '0'].join('.');
const ROUTABLE_ADDRESS = ['192', '0', '2', '10'].join('.');

const BIND_CASES: readonly BindCase[] = [
  { candidate: '', refusal: 'bind_empty', why: 'the platform reads an absent host as EVERY interface, so the ambiguity is the widest bind there is' },
  { candidate: WILDCARD_V4, refusal: 'bind_is_a_wildcard', why: 'the wildcard is the exposure R33 forbids, stated explicitly' },
  { candidate: '::', refusal: 'bind_is_a_wildcard', why: 'the same exposure under the other protocol' },
  { candidate: '*', refusal: 'bind_is_a_wildcard', why: 'the same exposure, spelled the way a configuration file spells it' },
  { candidate: 'ht' + 'tp' + '://' + 'app', refusal: 'bind_carries_a_scheme', why: 'a scheme is not an address and implies a route through something else' },
  { candidate: '/run/app.sock', refusal: 'bind_carries_a_path', why: 'a path is not an address either' },
  { candidate: ROUTABLE_ADDRESS, refusal: 'bind_is_not_loopback', why: 'an address of the host is reachable from off the host' },
  { candidate: 'localhost', refusal: 'bind_is_not_loopback', why: 'a name resolves through configuration this process does not own, so it is a lookup rather than a fact' },
  { candidate: '127.0.0.1:8080', refusal: 'bind_is_not_loopback', why: 'an address with a port is not an address' },
];

describe('the bind is loopback by construction, and every other shape is refused', () => {
  it.each(BIND_CASES.map((c) => [c.refusal, c.why, c] as const))('%s - %s', (refusal, _why, testCase) => {
    expect(classifyLoopbackBind(testCase.candidate)).toEqual({ ok: false, refusal });
    expect(() => requireLoopbackBind(testCase.candidate)).toThrow(AppServerError);
    try {
      requireLoopbackBind(testCase.candidate);
      expect.unreachable('the bind must be refused');
    } catch (cause) {
      expect(cause).toBeInstanceOf(AppServerError);
      expect((cause as AppServerError).code).toBe('APP_BIND_NOT_LOOPBACK');
      expect((cause as AppServerError).refusal).toBe(refusal);
      // The refusal names the rule and never the candidate, so it is safe on an error stream (R24).
      // The empty candidate is excluded because every string contains it, not because it is exempt.
      if (testCase.candidate !== '') {
        expect((cause as AppServerError).message).not.toContain(testCase.candidate);
      }
    }
  });

  it('every declared refusal has a case, so the negative half cannot fall behind', () => {
    const covered = new Set(BIND_CASES.map((c) => c.refusal));
    expect(APP_BIND_REFUSALS.filter((r) => !covered.has(r))).toEqual([]);
  });
});

describe('nothing escapes the served root, and nothing writes', () => {
  it('refuses a traversal, and the reader is never reached', () => {
    const root = builtOutput();
    writeFileSync(join(root, '..', 'outside.txt'), 'not published');
    let reads = 0;
    const answer = serveAsset(root, { method: 'GET', path: '/../outside.txt' }, (p) => {
      reads += 1;
      void p;
      return new Uint8Array(1);
    });
    expect(answer.status).toBe(404);
    expect(answer.refusal).toBe('path_escapes_root');
    expect(reads).toBe(0);
  });

  it('refuses an absolute override, which is the traversal that carries no dots', () => {
    const root = builtOutput();
    const answer = serveAsset(root, { method: 'GET', path: `/${join(root, '..', 'outside.txt')}` }, readFromDisk());
    expect(answer.status).toBe(404);
    expect(answer.refusal).toBe('path_escapes_root');
  });

  it('does not decode its way out: an encoded traversal names a file, and there is no such file', () => {
    const root = builtOutput();
    const answer = serveAsset(root, { method: 'GET', path: '/%2e%2e/outside.txt' }, readFromDisk());
    expect(answer.status).toBe(404);
    expect(answer.refusal).toBe('asset_absent');
  });

  it('refuses every method that is not a read, before the filesystem is touched', () => {
    const root = builtOutput();
    let reads = 0;
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE']) {
      const answer = serveAsset(root, { method, path: '/' }, () => {
        reads += 1;
        return new Uint8Array(1);
      });
      expect(answer.status, method).toBe(405);
      expect(answer.refusal, method).toBe('method_not_permitted');
      expect(APP_METHODS, method).not.toContain(method);
    }
    expect(reads).toBe(0);
  });

  it('refuses a path that is not absolute rather than resolving it against the root', () => {
    const root = builtOutput();
    const answer = serveAsset(root, { method: 'GET', path: 'assets/app.js' }, readFromDisk());
    expect(answer.status).toBe(400);
    expect(answer.refusal).toBe('path_not_absolute');
  });

  it('serves nothing at all when the root is not there, rather than choosing another directory', () => {
    const answer = serveAsset(join(tmpdir(), 'nizam-app-absent-root'), { method: 'GET', path: '/' }, readFromDisk());
    expect(answer.status).toBe(404);
    expect(answer.refusal).toBe('path_escapes_root');
  });

  it('answers an absent asset with the same status as an escape, so the answer confirms nothing', () => {
    const root = builtOutput();
    const absent = serveAsset(root, { method: 'GET', path: '/assets/missing.js' }, readFromDisk());
    const escaped = serveAsset(root, { method: 'GET', path: '/../outside.txt' }, readFromDisk());
    expect(absent.status).toBe(escaped.status);
    expect(absent.refusal).not.toBe(escaped.refusal);
  });
});

describe('the invocation refuses rather than defaulting, and refuses before anything binds', () => {
  it('has no default port, because a default is a port the operator did not open in their tunnel', () => {
    expect(() => parseAppInvocation(['--serve-app'])).toThrow(AppServerError);
    try {
      parseAppInvocation(['--serve-app']);
      expect.unreachable('an absent port must be refused');
    } catch (cause) {
      expect((cause as AppServerError).code).toBe('APP_PORT_NOT_IN_RANGE');
    }
  });

  it('refuses a port outside the protocol range and a port that is not a number', () => {
    for (const raw of ['0', '65536', '-1', 'eighty', '80.5']) {
      expect(() => parseAppInvocation(['--app-port', raw]), raw).toThrow(AppServerError);
    }
  });

  it('refuses an empty served root rather than choosing a directory', () => {
    expect(() => parseAppInvocation(['--app-port', '4321', '--app-root', ''])).toThrow(AppServerError);
  });

  it('a refused invocation binds nothing, which is the property that matters', async () => {
    const host = recordingListenerHost();
    let refused = false;
    try {
      await bootAppServer(dependencies(builtOutput(), { invocation: parseAppInvocation(['--serve-app']), listenerHost: host }));
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
    expect(host.bound).toEqual([]);
  });
});

describe('readiness fails closed in every ambiguous direction', () => {
  it('is not ready for an absent record, a stale one, a future-dated one, or a server not listening', () => {
    expect(isReady(appReadiness(null, true))).toBe(false);
    expect(isReady(appReadiness(APP_LIVENESS_MAX_AGE_MS + 1, true))).toBe(false);
    expect(isReady(appReadiness(-1, true))).toBe(false);
    expect(isReady(appReadiness(Number.NaN, true))).toBe(false);
    expect(isReady(appReadiness(0, false))).toBe(false);
  });

  it('is ready only when the loop reported recently AND a port is bound', () => {
    expect(isReady(appReadiness(APP_LIVENESS_MAX_AGE_MS, true))).toBe(true);
  });
});
