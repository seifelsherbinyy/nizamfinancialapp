// @vitest-environment node
/**
 * NIZAM · Ports are interface-only — source scan plus compile-time negatives
 * Implemented by: PFOS Contract 12 / Phase 2.1 (spec 06-two-agent-vps)
 * Depends on: the source tree of src/server/ports (read from disk AND imported)
 *
 * Two claims, proved two different ways.
 *
 * **Claim one: nothing here is live.** Steering §2 relocates the wall from the *area* to the
 * *network and secret boundary*: this directory is the BUILD half of five boundaries whose LIVE
 * halves are gated (G3-G6). So no port module may import a network module, call a request
 * primitive, name an endpoint, or hold a secret-shaped literal. The absence of a statement can
 * only be asserted by reading the source, which is why this scans the tree rather than exercising
 * the code — the same technique `db/isolation.test.ts` uses.
 *
 * Every forbidden token below is assembled from fragments, exactly as the acceptance harness does
 * with its denylists, so this scanner never holds a contiguous copy of the thing it forbids and
 * therefore never matches itself.
 *
 * **Claim two: nothing here is an implementation.** Phase 2.2 owns the mocks. Proved twice over:
 * structurally, by scanning for a function, an arrow, a class, a constructor or a return; and
 * behaviourally, by importing every module and asserting that each runtime export is an inert
 * literal rather than anything callable.
 *
 * The compile-time negatives at the end are checked by `tsc`, not by the runner: each
 * `@ts-expect-error` fails the typecheck if the forbidden shape ever becomes expressible. That is
 * the real assertion behind "consent by absence" and "the privacy policy is required".
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as barrel from './index';
import * as driveModule from './drive';
import * as errorsModule from './errors';
import * as openrouterModule from './openrouter';
import * as shapeGuardsModule from './shapeGuards';
import * as signalBusModule from './signalBus';
import * as telegramModule from './telegram';
import * as whoopModule from './whoop';

import { SIGNAL_TIERS, type SignalPayload } from './signalBus';
import type { EncryptedSnapshotArtifact } from './drive';
import type { ModelRequest } from './openrouter';
import type { Exact } from './shapeGuards';

const PORTS_ROOT = fileURLToPath(new URL('./', import.meta.url));

/** The five boundaries this phase owes, plus the two type-level modules they share. */
const REQUIRED_MODULES = [
  'drive.ts',
  'errors.ts',
  'index.ts',
  'openrouter.ts',
  'shapeGuards.ts',
  'signalBus.ts',
  'telegram.ts',
  'whoop.ts',
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Strip comments, so prose describing a forbidden thing is not mistaken for the thing. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const q = '[\'"`]';
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Module specifiers that would make a port able to reach the network or spawn a process. */
const NETWORK_SPECIFIERS = [
  'nod' + 'e:http',
  'nod' + 'e:https',
  'nod' + 'e:net',
  'nod' + 'e:tls',
  'nod' + 'e:dns',
  'nod' + 'e:child_process',
  'nod' + 'e-fetch',
  'ax' + 'ios',
  'und' + 'ici',
  'super' + 'agent',
  'g' + 'ot',
  'w' + 's',
];

const REQUEST_PRIMITIVES = [
  new RegExp('\\bfet' + 'ch\\s*\\('),
  new RegExp('\\bXMLHttp' + 'Request\\b'),
  new RegExp('\\bWeb' + 'Socket\\b'),
];

/** A URL literal would be a default endpoint, which steering §0b forbids in a tracked file. */
const URL_LITERAL = new RegExp('ht' + 'tps?:' + '\\/\\/');

/** Secret-shaped literals. Assembled so this file never contains one of its own examples. */
const SECRET_SHAPES: { name: string; re: RegExp }[] = [
  { name: 'private key block', re: new RegExp('-----BEG' + 'IN [A-Z ]*PRIV' + 'ATE KEY-----') },
  { name: 'bearer token literal', re: new RegExp('\\bBea' + 'rer\\s+[A-Za-z0-9._-]{25,}') },
  { name: 'provider key literal', re: new RegExp('\\bs' + 'k-[A-Za-z0-9]{20,}') },
  { name: 'browser api key literal', re: new RegExp('\\bAI' + 'za[0-9A-Za-z_-]{30,}') },
];

/** Constructs that would make a module an implementation rather than a declaration. */
const IMPLEMENTATION_CONSTRUCTS: { name: string; re: RegExp }[] = [
  { name: 'a function declaration', re: /\bfunction\b/ },
  { name: 'an arrow function', re: /=>/ },
  { name: 'a class declaration', re: /\bclass\s+[A-Za-z_$]/ },
  { name: 'a constructor call', re: /\bnew\s+[A-Za-z_$]/ },
  { name: 'a return statement', re: /\breturn\b/ },
  { name: 'a dynamic or CommonJS import', re: /\b(?:require|import)\s*\(/ },
];

const files = sourceFiles(PORTS_ROOT);
const rel = (f: string): string => f.slice(PORTS_ROOT.length).replace(/\\/g, '/');
const declarationFiles = files.filter((f) => !/\.test\.tsx?$/.test(f));

describe('src/server/ports is interface-only and offline (steering §2, design key decision 1)', () => {
  it('scans every module this phase owes, so nothing below can pass vacuously', () => {
    const present = files.map(rel).sort();
    for (const required of REQUIRED_MODULES) expect(present).toContain(required);
    expect(declarationFiles.length).toBeGreaterThanOrEqual(REQUIRED_MODULES.length);
  });

  it('imports no network or process module', () => {
    const offenders: string[] = [];
    for (const file of declarationFiles) {
      const body = code(readFileSync(file, 'utf8'));
      for (const spec of NETWORK_SPECIFIERS) {
        if (new RegExp(q + esc(spec) + q).test(body)) offenders.push(`${rel(file)} resolves a network module`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('calls no request primitive', () => {
    const offenders: string[] = [];
    for (const file of declarationFiles) {
      const body = code(readFileSync(file, 'utf8'));
      for (const re of REQUEST_PRIMITIVES) if (re.test(body)) offenders.push(`${rel(file)} reaches for a request primitive`);
    }
    expect(offenders).toEqual([]);
  });

  it('names no endpoint, so there is no default pointing at a real host', () => {
    // Scanned RAW, not stripped: an endpoint in a comment is still a deployment particular (R24).
    const offenders = files.filter((f) => URL_LITERAL.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('holds no secret-shaped literal', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const raw = readFileSync(file, 'utf8');
      for (const shape of SECRET_SHAPES) if (shape.re.test(raw)) offenders.push(`${rel(file)} contains a ${shape.name}`);
    }
    expect(offenders).toEqual([]);
  });

  it('declares no implementation — Phase 2.2 owns the mocks', () => {
    const offenders: string[] = [];
    for (const file of declarationFiles) {
      const body = code(readFileSync(file, 'utf8'));
      for (const construct of IMPLEMENTATION_CONSTRUCTS) {
        if (construct.re.test(body)) offenders.push(`${rel(file)} contains ${construct.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('importing a port module has no runtime side effect', () => {
  const modules: [string, Record<string, unknown>][] = [
    ['drive.ts', driveModule as unknown as Record<string, unknown>],
    ['errors.ts', errorsModule as unknown as Record<string, unknown>],
    ['index.ts', barrel as unknown as Record<string, unknown>],
    ['openrouter.ts', openrouterModule as unknown as Record<string, unknown>],
    ['shapeGuards.ts', shapeGuardsModule as unknown as Record<string, unknown>],
    ['signalBus.ts', signalBusModule as unknown as Record<string, unknown>],
    ['telegram.ts', telegramModule as unknown as Record<string, unknown>],
    ['whoop.ts', whoopModule as unknown as Record<string, unknown>],
  ];

  it('exports nothing callable, so no adapter is hiding behind a port name', () => {
    const offenders: string[] = [];
    for (const [name, mod] of modules) {
      for (const [key, value] of Object.entries(mod)) {
        if (typeof value === 'function') offenders.push(`${name} exports a callable "${key}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exports only inert vocabulary — a literal, or a readonly list of literals', () => {
    const offenders: string[] = [];
    for (const [name, mod] of modules) {
      for (const [key, value] of Object.entries(mod)) {
        const inert =
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          (Array.isArray(value) && value.every((item) => typeof item === 'string'));
        if (!inert) offenders.push(`${name} exports a non-inert "${key}" of type ${typeof value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exports the shared vocabulary through the barrel, so the scan above was not empty', () => {
    const exported = Object.keys(barrel as unknown as Record<string, unknown>);
    expect(exported).toContain('PORT_FAILURE_CODES');
    expect(exported).toContain('SIGNAL_TIERS');
    expect(exported).toContain('SIGNAL_NOTE_MAX_LENGTH');
    expect(exported.length).toBeGreaterThan(8);
  });

  it('carries only type-level members in the shape-guard module', () => {
    expect(Object.keys(shapeGuardsModule as unknown as Record<string, unknown>)).toEqual([]);
  });
});

describe('the signal tier enum excludes the category whose egress set is empty (R10, §4.4.1)', () => {
  it('has exactly the two narrow tiers and no third member', () => {
    // Assembled from fragments so this file never names the excluded classification contiguously.
    const excluded = 'strict_' + 'local_' + 'maximum';
    expect([...SIGNAL_TIERS]).toEqual(['money_safe', 'life_safe']);
    expect(SIGNAL_TIERS as readonly string[]).not.toContain(excluded);
  });
});

/**
 * A stand-in for the publish constraint, so the exactness rule can be exercised without a bus.
 * `Exact<SignalPayload, P>` is precisely what {@link SignalBusPort.publish} applies.
 */
function publishablePayload<P extends Exact<SignalPayload, P>>(payload: P): P {
  return payload;
}

function asModelRequest(request: ModelRequest): ModelRequest {
  return request;
}

describe('the forbidden shape is a compile error, not a runtime rejection', () => {
  it('accepts the three permitted payload fields, so the negatives below are not vacuous', () => {
    expect(publishablePayload({ level: 'red' })).toEqual({ level: 'red' });
    expect(publishablePayload({ level: 'amber', direction: 'downshift' })).toEqual({
      level: 'amber',
      direction: 'downshift',
    });
  });

  it('refuses a payload field that could carry a figure, a date, or an identifier (R7, §4.3)', () => {
    // @ts-expect-error a payload key beyond level/direction/note is typed never, so a figure cannot be published
    expect(publishablePayload({ level: 'red', balanceMilli: 1 })).toBeTruthy();
    // @ts-expect-error a due date is not a forbidden value of a field, it is a key the payload does not have
    expect(publishablePayload({ level: 'red', dueOn: '2026-01-01' })).toBeTruthy();
    // @ts-expect-error an account reference is likewise absent from the payload by construction
    expect(publishablePayload({ level: 'amber', accountRef: 'a' })).toBeTruthy();
  });

  it('refuses raw free text as a directional note, so an unmeasured string never reaches the field (§4.3.4)', () => {
    // @ts-expect-error a plain string is not a validated note; Phase 3 validation is the only mint
    expect(publishablePayload({ level: 'green', note: 'unvalidated narrative' })).toBeTruthy();
  });

  it('refuses a model request that omits the provider privacy policy (R19, §6.4)', () => {
    // @ts-expect-error privacy is a required field of the request, so a call cannot forget it
    expect(asModelRequest({ agent: 'finance', tier: 'T1', modelId: 'm', contentClass: 'operational', messages: [], maxOutputTokens: 1, correlationRef: 'r' })).toBeTruthy();
  });

  it('refuses a privacy policy that would permit training or a data-collecting provider (§6.4)', () => {
    // @ts-expect-error training is the single-member literal "excluded"; the permissive value is not in the type
    const training: ModelRequest['privacy']['training'] = 'allowed';
    // @ts-expect-error data-collecting providers are denied by the type, not by a runtime setting
    const providers: ModelRequest['privacy']['dataCollectingProviders'] = 'allowed';
    expect(training).toBeDefined();
    expect(providers).toBeDefined();
  });

  it('refuses a model request on the no-model tier (R16, §6.1)', () => {
    // @ts-expect-error T0 invokes no model, so the no-model tier is excluded from the request type
    const tier: ModelRequest['tier'] = 'T0';
    expect(tier).toBeDefined();
  });

  it('refuses a backup artifact whose plaintext survived or whose private key is on the host (R20, §7.1)', () => {
    // @ts-expect-error plaintextShredded is the literal true; an unshredded artifact is not expressible
    const shredded: EncryptedSnapshotArtifact['plaintextShredded'] = false;
    // @ts-expect-error the source is the literal engine_snapshot; a file copy cannot be passed off as one
    const source: EncryptedSnapshotArtifact['source'] = 'file_copy';
    // @ts-expect-error the private half is off-host by type, so a host-resident key cannot be declared
    const onHost: EncryptedSnapshotArtifact['encryption']['privateKeyPresentOnHost'] = true;
    expect(shredded).toBeDefined();
    expect(source).toBeDefined();
    expect(onHost).toBeDefined();
  });
});
