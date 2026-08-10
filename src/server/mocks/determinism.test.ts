// @vitest-environment node
/**
 * NIZAM · The mocks are deterministic and offline, proved by behaviour and by source scan
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Depends on: the source tree of src/server/mocks (read from disk AND imported)
 *
 * Design key decision 1 says the mocks are what make this tier buildable with no VPS and no secret.
 * That claim rests on two properties, and they need different kinds of proof.
 *
 * **Behaviourally deterministic.** The same inputs give the same outputs. Each of the five
 * boundaries below is driven twice, by the same script, through two independently constructed mocks,
 * and the whole result is compared — not a field of it. A mock that read a clock, drew a random
 * value, or carried state between constructions would fail here.
 *
 * **Structurally offline.** An absence of a statement cannot be tested by exercising code, so the
 * second half of this file reads the source, exactly as `db/isolation.test.ts` and
 * `ports/interfaceOnly.test.ts` read theirs. No mock resolves a network module, calls a request
 * primitive, names an endpoint, reads an ambient clock, or draws a random number. The one
 * filesystem-touching module is `fixtures.ts`, which is the explicitly injected fixture source the
 * phase permits; every other module is denied it.
 *
 * Forbidden tokens are assembled from fragments, the technique the neighbouring scans use, so this
 * file never holds a contiguous copy of what it forbids.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDriveMock } from './driveMock.ts';
import { createInvocationRecorder, type InvocationRecorder } from './invocationRecorder.ts';
import { createOpenRouterMock } from './openrouterMock.ts';
import { createSignalBusMock } from './signalBusMock.ts';
import { createTelegramMock } from './telegramMock.ts';
import { createWhoopMock } from './whoopMock.ts';
import { loadRecordedInteractions, nodeFixtureSource, signalDraftFrom, snapshotArtifactFrom } from './fixtures.ts';
import type { ModelRequest } from '../ports/openrouter.ts';
import type { SnapshotUploadReceipt, SnapshotVerification } from '../ports/drive.ts';
import type { StoredSignalReceipt } from '../ports/signalBus.ts';

const MOCKS_ROOT = fileURLToPath(new URL('./', import.meta.url));
const FIXED_NOW = (): string => '2026-03-02T09:00:00Z';
const loaded = loadRecordedInteractions(nodeFixtureSource(), 'two-agent-smoke');

/** Run one script twice, through two fresh mocks, and compare everything both produced. */
async function twice<T>(script: (recorder: InvocationRecorder) => Promise<T>): Promise<[T, T]> {
  const first = await script(createInvocationRecorder());
  const second = await script(createInvocationRecorder());
  return [first, second];
}

describe('the same inputs give the same outputs, on every boundary', () => {
  it('telegram: decisions, queue and audit are identical across two runs', async () => {
    const [a, b] = await twice(async (recorder) => {
      const mock = createTelegramMock({
        transport: {
          botId: 'bot-alpha',
          expectedSecretToken: 'fixture-token-alpha',
          allowedSenderIds: ['sender-one'],
          apiBaseUrlRef: 'TELEGRAM_API_BASE_REF',
          mode: 'webhook',
          maxConcurrentWorkItems: 2,
        },
        recorder,
        now: FIXED_NOW,
      });
      const decisions = loaded.set.telegramDeliveries.map((d) => mock.port.inbound.accept(d));
      const receipt = await mock.port.outbound.send({ botId: 'bot-alpha', chatRef: 'chat-one', text: 'ok' });
      return { decisions, receipt, queued: mock.queued, rejections: mock.rejections, log: recorder.all };
    });
    expect(a).toEqual(b);
  });

  it('openrouter: result, telemetry and running cost are identical across two runs', async () => {
    const request: ModelRequest = {
      agent: 'finance',
      tier: 'T2',
      modelId: 'fixture/model-a',
      contentClass: 'operational',
      privacy: {
        training: 'excluded',
        dataCollectingProviders: 'denied',
        zeroDataRetention: 'required',
        requiredParameters: [],
      },
      messages: [{ role: 'user', content: 'a synthetic operational question' }],
      maxOutputTokens: 64,
      correlationRef: 'corr-fixture-ok',
    };
    const [a, b] = await twice(async (recorder) => {
      const mock = createOpenRouterMock({
        config: {
          agent: 'finance',
          apiBaseUrlRef: 'OPENROUTER_API_BASE_REF',
          apiKeyRef: 'OPENROUTER_FINANCE_KEY_REF',
          weeklyCapMicroUsd: 10_000,
          killSwitchSentinelPathRef: 'NIZAM_KILL_SWITCH_SENTINEL_REF',
          eligibilityRegistryPathRef: 'MODEL_ELIGIBILITY_REGISTRY_REF',
        },
        recorder,
        eligibleModelIds: ['fixture/model-a'],
        exchanges: loaded.set.modelExchanges,
      });
      const result = await mock.port.complete(request);
      return { result, telemetry: mock.telemetry, spent: mock.spentMicroUsd, log: recorder.all };
    });
    expect(a).toEqual(b);
  });

  it('drive: references, receipts and verdicts are identical across two runs', async () => {
    const [a, b] = await twice(async (recorder) => {
      const mock = createDriveMock({
        config: { folderRef: 'NIZAM_BACKUP_FOLDER_REF', grantModel: 'owner_user_grant', retainCount: 7 },
        recorder,
        now: FIXED_NOW,
      });
      const receipts: { receipt: SnapshotUploadReceipt; verdict: SnapshotVerification }[] = [];
      for (const recorded of loaded.set.snapshots) {
        const artifact = snapshotArtifactFrom(recorded);
        const receipt = await mock.port.uploadEncryptedSnapshot(artifact);
        const verdict = await mock.port.verifyUploadedSnapshot(receipt, {
          sizeBytes: artifact.sizeBytes,
          digest: artifact.digest,
        });
        receipts.push({ receipt, verdict });
      }
      const listing = await mock.port.listSnapshots({ storeName: 'finance', limit: 5 });
      return { receipts, listing, remote: mock.remote, log: recorder.all };
    });
    expect(a).toEqual(b);
  });

  it('whoop: the selected band is identical across two runs', async () => {
    const [a, b] = await twice(async (recorder) => {
      const mock = createWhoopMock({
        config: {
          apiBaseUrlRef: 'RECOVERY_API_BASE_REF',
          accessTokenRef: 'RECOVERY_ACCESS_TOKEN_REF',
          bandToLevel: { low: 'red', moderate: 'amber', high: 'green' },
        },
        recorder,
        observations: loaded.set.recoveryObservations,
      });
      const inWindow = await mock.port.readRecoveryState({ notOlderThan: '2026-03-01T00:00:00Z' });
      const stale = await mock.port.readRecoveryState({ notOlderThan: '2026-04-01T00:00:00Z' });
      return { inWindow, stale, log: recorder.all };
    });
    expect(a).toEqual(b);
  });

  it('signal bus: hashes, receipts and read outcomes are identical across two runs', async () => {
    const [a, b] = await twice(async (recorder) => {
      const drafts = loaded.set.signals.map(signalDraftFrom);
      const mock = createSignalBusMock({
        config: {
          producer: 'finance',
          internalEndpointRef: 'SIGNAL_BUS_INTERNAL_ENDPOINT_REF',
          defaultConsentScope: 'producer_only',
        },
        recorder,
        now: FIXED_NOW,
        seeded: drafts.filter((draft) => draft.producer === 'life'),
      });
      const receipts: StoredSignalReceipt[] = [];
      for (const draft of drafts.filter((d) => d.producer === 'finance')) {
        receipts.push(await mock.port.publish(draft));
      }
      const asFinance = await mock.port.read({ subscriber: 'finance', limit: 10 });
      const asLife = await mock.port.read({ subscriber: 'life', limit: 10 });
      return { receipts, asFinance, asLife, stored: mock.stored, log: recorder.all };
    });
    expect(a).toEqual(b);
  });
});

/** The source scan. Everything below reads the tree rather than exercising it. */
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
  'g' + 'ot',
  'w' + 's',
];

const FILESYSTEM_SPECIFIERS = ['nod' + 'e:fs', 'nod' + 'e:path', 'nod' + 'e:url', 'nod' + 'e:os'];

const REQUEST_PRIMITIVES = [
  new RegExp('\\bfet' + 'ch\\s*\\('),
  new RegExp('\\bXMLHttp' + 'Request\\b'),
  new RegExp('\\bWeb' + 'Socket\\b'),
];

const AMBIENT_STATE = [
  { name: 'an ambient clock read', re: new RegExp('\\bDa' + 'te\\s*[.(]') },
  { name: 'a construction of the clock', re: new RegExp('\\bnew\\s+Da' + 'te\\b') },
  { name: 'a random draw', re: new RegExp('\\bMath\\.ran' + 'dom\\b') },
  { name: 'a process environment read', re: new RegExp('\\bproc' + 'ess\\.en' + 'v\\b') },
  { name: 'a high-resolution timer read', re: new RegExp('perf' + 'ormance\\.n' + 'ow\\s*\\(') },
];

const URL_LITERAL = new RegExp('ht' + 'tps?:' + '\\/\\/');

const SECRET_SHAPES: { name: string; re: RegExp }[] = [
  { name: 'private key block', re: new RegExp('-----BEG' + 'IN [A-Z ]*PRIV' + 'ATE KEY-----') },
  { name: 'bearer token literal', re: new RegExp('\\bBea' + 'rer\\s+[A-Za-z0-9._-]{25,}') },
  { name: 'provider key literal', re: new RegExp('\\bs' + 'k-[A-Za-z0-9]{20,}') },
  { name: 'recipient key literal', re: new RegExp('\\ba' + 'ge1[0-9a-z]{20,}') },
];

/** The only module permitted to touch a filesystem: the explicitly injected fixture source. */
const FIXTURE_SOURCE_MODULE = 'fixtures.ts';

const files = sourceFiles(MOCKS_ROOT);
const rel = (f: string): string => f.slice(MOCKS_ROOT.length).replace(/\\/g, '/');
const productionFiles = files.filter((f) => !/\.test\.tsx?$/.test(f));

describe('src/server/mocks is offline and reads no ambient state (steering §2)', () => {
  it('scans every module this phase owes, so nothing below passes vacuously', () => {
    const present = productionFiles.map(rel).sort();
    for (const required of [
      'driveMock.ts',
      'failure.ts',
      'fixtures.ts',
      'index.ts',
      'invocationRecorder.ts',
      'openrouterMock.ts',
      'signalBusMock.ts',
      'telegramMock.ts',
      'whoopMock.ts',
    ]) {
      expect(present).toContain(required);
    }
  });

  it('resolves no network or process module', () => {
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const body = code(readFileSync(file, 'utf8'));
      for (const spec of NETWORK_SPECIFIERS) {
        if (new RegExp(q + esc(spec) + q).test(body)) offenders.push(`${rel(file)} resolves ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('calls no request primitive', () => {
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const body = code(readFileSync(file, 'utf8'));
      for (const re of REQUEST_PRIMITIVES) if (re.test(body)) offenders.push(`${rel(file)} reaches for a request primitive`);
    }
    expect(offenders).toEqual([]);
  });

  it('touches a filesystem in exactly one module, which a caller must inject on purpose', () => {
    const offenders: string[] = [];
    for (const file of productionFiles) {
      if (rel(file) === FIXTURE_SOURCE_MODULE) continue;
      const body = code(readFileSync(file, 'utf8'));
      for (const spec of FILESYSTEM_SPECIFIERS) {
        if (new RegExp(q + esc(spec) + q).test(body)) offenders.push(`${rel(file)} resolves ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
    // And the permitted module really does resolve one, so the exemption is not decorative.
    const fixtureBody = code(readFileSync(join(MOCKS_ROOT, FIXTURE_SOURCE_MODULE), 'utf8'));
    expect(new RegExp(q + esc(FILESYSTEM_SPECIFIERS[0] as string) + q).test(fixtureBody)).toBe(true);
  });

  it('reads no clock, draws no random value, and consults no ambient environment', () => {
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const body = code(readFileSync(file, 'utf8'));
      for (const banned of AMBIENT_STATE) {
        if (banned.re.test(body)) offenders.push(`${rel(file)} contains ${banned.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names no endpoint and holds no secret-shaped literal (steering §0b, R24)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const raw = readFileSync(file, 'utf8');
      if (URL_LITERAL.test(raw) && !/\.test\.tsx?$/.test(file)) offenders.push(`${rel(file)} names an endpoint`);
      if (/\.test\.tsx?$/.test(file)) continue;
      for (const shape of SECRET_SHAPES) if (shape.re.test(raw)) offenders.push(`${rel(file)} contains a ${shape.name}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('the fixture document itself holds no deployment particular (steering §0b, R24)', () => {
  it('is caught by the loader, which is the same check task 9.0 will run at the gate', () => {
    // Loading is the assertion: the loader refuses a fixture carrying a particular, fail-closed.
    expect(loaded.set.synthetic).toBe(true);
    const raw = readFileSync(join(MOCKS_ROOT, 'fixtures', 'two-agent-smoke.json'), 'utf8');
    expect(URL_LITERAL.test(raw)).toBe(false);
    expect(/\b\d{7,}\b/.test(raw)).toBe(false);
    expect(/\b\d+\.\d{2}\b/.test(raw)).toBe(false);
    expect(/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(raw)).toBe(false);
  });
});
