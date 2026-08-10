// @vitest-environment node
/**
 * NIZAM · The recorded-fixture loader refuses more than it accepts — steering §0b, §3 (R24)
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Depends on: ./fixtures, and the fixture document on disk
 *
 * Two claims.
 *
 * **The happy path replays a real-shaped exchange with no network.** The document on disk is
 * loaded through the injected Node source, and every boundary it covers arrives typed.
 *
 * **The refusals are the substance.** The repository is public (steering §0b), so a fixture is
 * precisely the file where anonymized real data would look harmless and would not be. Each
 * refusal below is driven with a document that carries exactly one defect, so a passing case
 * cannot be passing for the wrong reason. The forbidden particulars are assembled from fragments,
 * the technique the acceptance harness and the neighbouring source scans both use, so this file
 * never holds a contiguous copy of what it is proving gets refused.
 */
import { describe, expect, it } from 'vitest';

import {
  FIXTURE_VERSION,
  FixtureError,
  bytesFromHex,
  inlineFixtureSource,
  loadRecordedInteractions,
  nodeFixtureSource,
  signalDraftFrom,
  snapshotArtifactFrom,
  type RecordedInteractionSet,
} from './fixtures.ts';

const FIXTURE_NAME = 'two-agent-smoke';

/** A minimal well-formed document, so a defect can be introduced one field at a time. */
function baseDocument(): Record<string, unknown> {
  return {
    fixtureVersion: FIXTURE_VERSION,
    synthetic: true,
    name: 'unit',
    telegramDeliveries: [],
    modelExchanges: [],
    recoveryObservations: [],
    snapshots: [],
    signals: [],
  };
}

function loadText(text: string): RecordedInteractionSet {
  return loadRecordedInteractions(inlineFixtureSource({ unit: text }), 'unit').set;
}

function refusalOf(text: string): FixtureError {
  try {
    loadText(text);
  } catch (error) {
    if (error instanceof FixtureError) return error;
    throw error;
  }
  throw new Error('the loader accepted a document it was supposed to refuse');
}

describe('the fixture on disk loads through the injected source (steering §3)', () => {
  const loaded = loadRecordedInteractions(nodeFixtureSource(), FIXTURE_NAME);

  it('is marked synthetic and provisional, which is the whole point of a fixture-backed run', () => {
    expect(loaded.set.synthetic).toBe(true);
    expect(loaded.set.name).toBe(FIXTURE_NAME);
    // §3: a fixture-backed registry may never promote a model for live routing.
    expect(loaded.provisional).toBe(true);
  });

  it('covers all five boundaries, so a replay has something to say on each', () => {
    expect(loaded.set.telegramDeliveries.length).toBeGreaterThanOrEqual(5);
    expect(loaded.set.modelExchanges.length).toBeGreaterThanOrEqual(2);
    expect(loaded.set.recoveryObservations.length).toBeGreaterThanOrEqual(2);
    expect(loaded.set.snapshots.length).toBeGreaterThanOrEqual(1);
    expect(loaded.set.signals.length).toBeGreaterThanOrEqual(2);
  });

  it('carries the two model exchanges a replay needs: one valid, one failing its schema', () => {
    const valid = loaded.set.modelExchanges.find((e) => e.schemaValid);
    const invalid = loaded.set.modelExchanges.find((e) => !e.schemaValid);
    expect(valid?.costMicroUsd).toBeTypeOf('number');
    expect(Number.isSafeInteger(valid?.costMicroUsd)).toBe(true);
    expect(invalid).toBeDefined();
  });

  it('keeps the delivery set that drives §5.2 and §5.4: absent token, empty token, bot collision', () => {
    const deliveries = loaded.set.telegramDeliveries;
    expect(deliveries.some((d) => d.secretTokenHeader === null)).toBe(true);
    expect(deliveries.some((d) => d.secretTokenHeader === '')).toBe(true);
    const collidingIds = deliveries.filter((d) => d.updateId === deliveries[0]?.updateId);
    expect(new Set(collidingIds.map((d) => d.botId)).size).toBeGreaterThan(1);
  });

  it('loads deterministically: the same document twice gives an equal set', () => {
    const again = loadRecordedInteractions(nodeFixtureSource(), FIXTURE_NAME);
    expect(again.set).toEqual(loaded.set);
  });

  it('answers not-found rather than guessing when the fixture is absent', () => {
    expect(() => loadRecordedInteractions(nodeFixtureSource(), 'no-such-fixture')).toThrow(FixtureError);
    try {
      loadRecordedInteractions(inlineFixtureSource({}), 'absent');
    } catch (error) {
      expect((error as FixtureError).code).toBe('FIXTURE_NOT_FOUND');
    }
  });
});

describe('a fixture carrying a deployment particular is refused, fail-closed (steering §0b, R24)', () => {
  /** Each entry is one defect, injected into an otherwise valid document. */
  const particulars: readonly [label: string, value: string][] = [
    ['an endpoint', 'ht' + 'tps://' + 'a-host/path'],
    ['a host address', '203' + '.0' + '.113' + '.7'],
    ['a bare domain', 'life' + '.exam' + 'ple' + '.c' + 'om'],
    ['a long numeric identifier', '1234567890'],
    ['a two-decimal monetary figure', '4500' + '.75'],
    ['a recipient key literal', 'a' + 'ge1' + 'qwertyuiopasdfghjklzxcvbnm'],
    ['a provider key literal', 's' + 'k-' + 'abcdefghijklmnopqrstuvwxyz012345'],
  ];

  for (const [label, value] of particulars) {
    it(`refuses ${label}`, () => {
      const document = baseDocument();
      document.name = value;
      const error = refusalOf(JSON.stringify(document));
      expect(error.code).toBe('FIXTURE_DEPLOYMENT_PARTICULAR');
      expect(error.at).toBe(label);
    });
  }

  it('refuses a storage identifier field even when its value looks innocent', () => {
    const key = 'fol' + 'derId';
    const error = refusalOf(JSON.stringify({ ...baseDocument(), [key]: 'x' }));
    expect(error.code).toBe('FIXTURE_DEPLOYMENT_PARTICULAR');
    expect(error.at).toBe('a storage identifier field');
  });

  it('scans before parsing, so a document that is both malformed and leaky reports the leak', () => {
    const leaky = '{ "name": "' + 'ht' + 'tps://' + 'a-host" ';
    expect(refusalOf(leaky).code).toBe('FIXTURE_DEPLOYMENT_PARTICULAR');
  });

  it('accepts the same document once the particular is removed, so the scan is not blanket', () => {
    const document = baseDocument();
    document.name = 'a-synthetic-name';
    expect(loadText(JSON.stringify(document)).name).toBe('a-synthetic-name');
  });
});

describe('a fixture that is not synthetic, or not this version, will not load', () => {
  it('refuses a document that does not declare itself synthetic', () => {
    const document = baseDocument();
    document.synthetic = false;
    expect(refusalOf(JSON.stringify(document)).code).toBe('FIXTURE_NOT_MARKED_SYNTHETIC');
  });

  it('refuses a document with the marker absent, not merely false', () => {
    const document = baseDocument();
    delete document.synthetic;
    expect(refusalOf(JSON.stringify(document)).code).toBe('FIXTURE_NOT_MARKED_SYNTHETIC');
  });

  it('refuses an unsupported version rather than reading it hopefully', () => {
    const document = baseDocument();
    document.fixtureVersion = FIXTURE_VERSION + 1;
    expect(refusalOf(JSON.stringify(document)).code).toBe('FIXTURE_VERSION_UNSUPPORTED');
  });

  it('refuses text that is not JSON', () => {
    expect(refusalOf('not a document at all').code).toBe('FIXTURE_NOT_JSON');
  });
});

describe('the shape checks name the offending field (§4.3 at the fixture boundary)', () => {
  it('refuses a missing collection rather than defaulting it to empty', () => {
    const document = baseDocument();
    delete document.signals;
    const error = refusalOf(JSON.stringify(document));
    expect(error.code).toBe('FIXTURE_SHAPE_INVALID');
    expect(error.at).toBe('signals');
  });

  it('refuses a surplus payload key, because dropping it would load a different fixture', () => {
    const document = baseDocument();
    document.signals = [
      {
        signalId: 'sig-1',
        ts: '2026-03-02T09:00:00Z',
        producer: 'finance',
        kind: 'money_pressure',
        tier: 'money_safe',
        consentScope: 'producer_only',
        payload: { level: 'red', dueOn: '2026-04-01' },
      },
    ];
    const error = refusalOf(JSON.stringify(document));
    expect(error.code).toBe('FIXTURE_SHAPE_INVALID');
    expect(error.at).toBe('signals[0].payload.dueOn');
  });

  it('refuses a tier that is not a member of the schema (R10, §4.4.1)', () => {
    const document = baseDocument();
    document.signals = [
      {
        signalId: 'sig-1',
        ts: '2026-03-02T09:00:00Z',
        producer: 'finance',
        kind: 'money_pressure',
        tier: 'a-tier-the-schema-does-not-have',
        consentScope: 'producer_only',
        payload: { level: 'red' },
      },
    ];
    expect(refusalOf(JSON.stringify(document)).at).toBe('signals[0].tier');
  });

  it('refuses a snapshot whose declared size disagrees with its recorded ciphertext', () => {
    const document = baseDocument();
    document.snapshots = [
      {
        storeName: 'finance',
        capturedAt: '2026-03-02T03:00:00Z',
        scheme: 'age',
        recipientPublicKeyRef: 'FIXTURE_REF',
        ciphertextHex: '0a1b',
        sizeBytes: 9,
        digestHex: 'ab',
      },
    ];
    expect(refusalOf(JSON.stringify(document)).at).toBe('snapshots[0].sizeBytes');
  });

  it('refuses a non-integer token count, so a float never enters the cost path', () => {
    const document = baseDocument();
    document.modelExchanges = [
      {
        correlationRef: 'c',
        modelIdServed: 'fixture/model-a',
        text: '',
        parsed: null,
        schemaValid: true,
        // A fractional token count is invalid and must be rejected, never rounded.
        promptTokens: 3.5,
        cachedTokens: 0,
        completionTokens: 1,
        reasoningTokens: 0,
        costMicroUsd: 1,
        latencyMs: 1,
      },
    ];
    expect(refusalOf(JSON.stringify(document)).at).toBe('modelExchanges[0].promptTokens');
  });
});

describe('the converters keep the artifact literals the port insists on (§7.1)', () => {
  const loaded = loadRecordedInteractions(nodeFixtureSource(), FIXTURE_NAME);

  it('turns hex into bytes with integer arithmetic only', () => {
    expect([...bytesFromHex('0a1b2c')]).toEqual([10, 27, 44]);
    expect(bytesFromHex('').length).toBe(0);
  });

  it('builds an artifact whose plaintext is gone and whose private key is off the host', () => {
    const recorded = loaded.set.snapshots[0];
    if (recorded === undefined) throw new Error('the fixture must carry at least one snapshot');
    const artifact = snapshotArtifactFrom(recorded);
    expect(artifact.source).toBe('engine_snapshot');
    expect(artifact.plaintextShredded).toBe(true);
    expect(artifact.containsSecrets).toBe(false);
    expect(artifact.encryption.privateKeyPresentOnHost).toBe(false);
    expect(artifact.ciphertext.length).toBe(artifact.sizeBytes);
    expect(artifact.digest.algorithm).toBe('sha256');
  });

  it('builds a signal draft carrying no note, because Phase 3 owns the only mint', () => {
    const recorded = loaded.set.signals[0];
    if (recorded === undefined) throw new Error('the fixture must carry at least one signal');
    const draft = signalDraftFrom(recorded);
    expect(Object.keys(draft.payload).sort()).toEqual(['direction', 'level']);
    expect(draft.payload.note).toBeUndefined();
  });
});
