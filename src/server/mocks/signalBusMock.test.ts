// @vitest-environment node
/**
 * NIZAM · The bus mock is the second belt behind the schema — contract 12 §4 (R7, R8, R10)
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Depends on: ./signalBusMock, ./invocationRecorder, ./fixtures, ../ports/signalBus
 *
 * `publish` already refuses a forbidden payload at compile time — `interfaceOnly.test.ts` proves
 * that with its `@ts-expect-error` cases. This file proves the RUNTIME half: a payload that reaches
 * the bus from a fixture, a wire, or a cast is refused rather than stored. Both belts are needed.
 * The first stops the mistake being written; the second stops it being accepted from somewhere the
 * compiler never saw, which is the only way a figure could actually cross (§4.3).
 *
 * The casts below are deliberate and are the point of the test: they stand in for a value arriving
 * from outside the type system. Each is one defect, and each is paired with the accepted case it
 * differs from by one field.
 */
import { describe, expect, it } from 'vitest';

import { MockPortFailure } from './failure.ts';
import { loadRecordedInteractions, nodeFixtureSource, signalDraftFrom } from './fixtures.ts';
import { createInvocationRecorder } from './invocationRecorder.ts';
import { createSignalBusMock, type SignalBusMockConfig } from './signalBusMock.ts';
import {
  SIGNAL_NOTE_MAX_LENGTH,
  type SignalBusPortConfig,
  type SignalDraft,
  type SignalNote,
} from '../ports/signalBus.ts';

const FIXED_NOW = (): string => '2026-03-02T09:05:01Z';

const CONFIG: SignalBusPortConfig = {
  producer: 'finance',
  internalEndpointRef: 'SIGNAL_BUS_INTERNAL_ENDPOINT_REF',
  defaultConsentScope: 'producer_only',
};

const DRAFT: SignalDraft = {
  signalId: 'sig-finance-one',
  ts: '2026-03-02T09:05:00Z',
  producer: 'finance',
  kind: 'money_pressure',
  tier: 'money_safe',
  consentScope: 'producer_only',
  payload: { level: 'amber', direction: 'downshift' },
};

function mockWith(overrides: Partial<SignalBusMockConfig> = {}) {
  const recorder = createInvocationRecorder();
  return createSignalBusMock({ config: CONFIG, recorder, now: FIXED_NOW, ...overrides });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MockPortFailure) return error.code;
    throw error;
  }
  throw new Error('the bus accepted a signal it was supposed to refuse');
}

describe('a valid envelope is appended and hashed deterministically (§4.1, §4.2)', () => {
  it('answers with a receipt whose hash covers the payload and whose clock is injected', async () => {
    const mock = mockWith();
    const receipt = await mock.port.publish(DRAFT);
    expect(receipt.signalId).toBe(DRAFT.signalId);
    expect(receipt.storedAt).toBe(FIXED_NOW());
    expect(receipt.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(mock.stored.length).toBe(1);
  });

  it('gives the same hash for the same envelope and a different one when the payload changes', async () => {
    const first = await mockWith().port.publish(DRAFT);
    const same = await mockWith().port.publish(DRAFT);
    const changed = await mockWith().port.publish({ ...DRAFT, payload: { level: 'red', direction: 'downshift' } });
    expect(same.hash).toBe(first.hash);
    expect(changed.hash).not.toBe(first.hash);
  });

  it('records the call with the note measured rather than copied', async () => {
    const mock = mockWith();
    await mock.port.publish(DRAFT);
    expect(mock.recorder.callsTo('signalBus', 'publish')[0]?.detail).toEqual({
      signalId: 'sig-finance-one',
      producer: 'finance',
      kind: 'money_pressure',
      tier: 'money_safe',
      consentScope: 'producer_only',
      level: 'amber',
      direction: 'downshift',
      noteLength: 0,
    });
  });

  it('has no member that could update or delete a stored signal (§4.1)', () => {
    const mock = mockWith();
    expect(Object.keys(mock.port).sort()).toEqual(['publish', 'read']);
  });
});

describe('the runtime half of consent by absence (§4.3)', () => {
  it('refuses a surplus payload field, and stores nothing', async () => {
    const mock = mockWith();
    const leaky = {
      ...DRAFT,
      payload: { level: 'amber', dueOn: '2026-04-01' },
    } as unknown as SignalDraft;
    expect(await codeOf(mock.port.publish(leaky))).toBe('SIGNAL_PAYLOAD_FIELD_FORBIDDEN');
    expect(mock.stored).toEqual([]);
  });

  it('refuses a magnitude even under a permitted key name (§4.3.1)', async () => {
    const mock = mockWith();
    const numeric = { ...DRAFT, payload: { level: 3 } } as unknown as SignalDraft;
    expect(await codeOf(mock.port.publish(numeric))).toBe('SIGNAL_PAYLOAD_FIELD_FORBIDDEN');
  });

  it('refuses a tier that is not a member of the schema (R10, §4.4.1)', async () => {
    const mock = mockWith();
    const excluded = 'strict_' + 'local_' + 'maximum';
    const wrongTier = { ...DRAFT, tier: excluded } as unknown as SignalDraft;
    expect(await codeOf(mock.port.publish(wrongTier))).toBe('SIGNAL_TIER_NOT_A_MEMBER');
    expect(mock.stored).toEqual([]);
  });

  it('refuses an over-cap note rather than truncating it (§4.3.4)', async () => {
    const mock = mockWith();
    const overCap = 'n'.repeat(SIGNAL_NOTE_MAX_LENGTH + 1) as SignalNote;
    const tooLong = { ...DRAFT, payload: { ...DRAFT.payload, note: overCap } } as SignalDraft;
    expect(await codeOf(mock.port.publish(tooLong))).toBe('SIGNAL_NOTE_EXCEEDS_CAP');
    // Nothing was stored, so no prefix of the note survived.
    expect(mock.stored).toEqual([]);
  });

  it('accepts a note exactly at the cap, so the boundary is inclusive and the rule is not blanket', async () => {
    const mock = mockWith();
    const atCap = 'n'.repeat(SIGNAL_NOTE_MAX_LENGTH) as SignalNote;
    await expect(
      mock.port.publish({ ...DRAFT, payload: { ...DRAFT.payload, note: atCap } } as SignalDraft),
    ).resolves.toBeDefined();
    expect(mock.stored.length).toBe(1);
  });
});

describe('envelope validation refuses a malformed draft (§4.2, R7)', () => {
  const cases: readonly [label: string, patch: Partial<SignalDraft>][] = [
    ['an empty identifier', { signalId: '' }],
    ['a non-UTC instant', { ts: '2026-03-02T09:05:00+02:00' }],
    ['a kind outside the schema', { kind: 'an-unknown-kind' as SignalDraft['kind'] }],
    ['a producer that is not this client', { producer: 'life' }],
    ['a consent scope outside the schema', { consentScope: 'everyone' as SignalDraft['consentScope'] }],
    ['a level outside the schema', { payload: { level: 'chartreuse' as never } }],
    ['a direction outside the schema', { payload: { level: 'amber', direction: 'sideways' as never } }],
  ];

  for (const [label, patch] of cases) {
    it(`refuses ${label}`, async () => {
      const mock = mockWith();
      expect(await codeOf(mock.port.publish({ ...DRAFT, ...patch } as SignalDraft))).toBe(
        'SIGNAL_ENVELOPE_INVALID',
      );
      expect(mock.stored).toEqual([]);
    });
  }

  it('accepts the unpatched draft, so every refusal above is one field away from success', async () => {
    await expect(mockWith().port.publish(DRAFT)).resolves.toBeDefined();
  });
});

describe('consent scope and reachability (§4.5.3, R8, R9)', () => {
  it('refuses a wider scope for a kind the owner has not widened', async () => {
    const mock = mockWith();
    expect(await codeOf(mock.port.publish({ ...DRAFT, consentScope: 'shared' }))).toBe(
      'SIGNAL_CONSENT_SCOPE_REFUSED',
    );
  });

  it('accepts the wider scope once the kind is widened', async () => {
    const mock = mockWith({ widenedKinds: ['money_pressure'] });
    await expect(mock.port.publish({ ...DRAFT, consentScope: 'shared' })).resolves.toBeDefined();
  });

  it('refuses both members when the internal bus does not answer', async () => {
    const mock = mockWith({ unreachable: true });
    expect(await codeOf(mock.port.publish(DRAFT))).toBe('SIGNAL_BUS_UNREACHABLE');
    expect(await codeOf(mock.port.read({ subscriber: 'finance', limit: 5 }))).toBe('SIGNAL_BUS_UNREACHABLE');
  });
});

describe('a refusal on read is not an empty result (§4.5.2, §4.5.4, §4.5.5)', () => {
  const financeOwn = DRAFT;
  const lifeShared: SignalDraft = {
    signalId: 'sig-life-one',
    ts: '2026-03-02T07:30:00Z',
    producer: 'life',
    kind: 'recovery_state',
    tier: 'life_safe',
    consentScope: 'shared',
    payload: { level: 'green' },
  };

  it('delivers to the producer of its own producer_only signal', async () => {
    const mock = mockWith({ seeded: [financeOwn] });
    await expect(mock.port.read({ subscriber: 'finance', limit: 5 })).resolves.toEqual({
      outcome: 'delivered',
      signals: mock.stored,
    });
  });

  it('REFUSES the other agent, rather than answering with an empty list', async () => {
    const mock = mockWith({ seeded: [financeOwn] });
    const outcome = await mock.port.read({ subscriber: 'life', limit: 5 });
    expect(outcome).toEqual({ outcome: 'refused', reason: 'consent_scope_producer_only' });
    // The two shapes are different values, which is the distinction §4.5.2 insists on.
    expect(outcome).not.toEqual({ outcome: 'delivered', signals: [] });
  });

  it('refuses when the subscriber may not read the signal tier, evaluated per read', async () => {
    const mock = mockWith({
      seeded: [lifeShared],
      readableTiers: { finance: ['money_safe'], life: ['money_safe', 'life_safe'] },
    });
    await expect(mock.port.read({ subscriber: 'finance', limit: 5 })).resolves.toEqual({
      outcome: 'refused',
      reason: 'tier_not_readable_by_subscriber',
    });
    // The same stored envelope is delivered to a subscriber whose tier set admits it.
    await expect(mock.port.read({ subscriber: 'life', limit: 5 })).resolves.toEqual({
      outcome: 'delivered',
      signals: mock.stored,
    });
  });

  it('delivers an empty list when the filter genuinely matches nothing', async () => {
    const mock = mockWith({ seeded: [financeOwn] });
    await expect(
      mock.port.read({ subscriber: 'finance', kind: 'budget_breach', limit: 5 }),
    ).resolves.toEqual({ outcome: 'delivered', signals: [] });
  });

  it('filters by kind, by lower bound on the envelope instant, and by limit', async () => {
    const mock = mockWith({ seeded: [financeOwn, { ...lifeShared, consentScope: 'shared' }] });
    const byKind = await mock.port.read({ subscriber: 'finance', kind: 'money_pressure', limit: 5 });
    expect(byKind.outcome === 'delivered' && byKind.signals.length).toBe(1);
    const bySince = await mock.port.read({ subscriber: 'finance', since: '2026-03-02T09:00:00Z', limit: 5 });
    expect(bySince.outcome === 'delivered' && bySince.signals.length).toBe(1);
    const capped = await mock.port.read({ subscriber: 'finance', limit: 1 });
    expect(capped.outcome === 'delivered' && capped.signals.length).toBe(1);
  });

  it('records the read against the injected endpoint reference, never an address', async () => {
    const mock = mockWith({ seeded: [financeOwn] });
    await mock.port.read({ subscriber: 'finance', limit: 3 });
    expect(mock.recorder.callsTo('signalBus', 'read')[0]?.detail).toEqual({
      subscriber: 'finance',
      kind: null,
      since: null,
      limit: 3,
      endpointRef: CONFIG.internalEndpointRef,
    });
  });
});

describe('the recorded fixture publishes and seeds through the same gates (steering §3)', () => {
  it('publishes the finance draft and seeds the life one, then reads both back', async () => {
    const loaded = loadRecordedInteractions(nodeFixtureSource(), 'two-agent-smoke');
    const drafts = loaded.set.signals.map(signalDraftFrom);
    const own = drafts.filter((draft) => draft.producer === 'finance');
    const seeded = drafts.filter((draft) => draft.producer === 'life');
    const mock = mockWith({ seeded });

    for (const draft of own) await expect(mock.port.publish(draft)).resolves.toBeDefined();
    expect(mock.stored.length).toBe(drafts.length);

    // The life signal is `shared`, the finance one is `producer_only`, so life is refused.
    await expect(mock.port.read({ subscriber: 'life', limit: 10 })).resolves.toEqual({
      outcome: 'refused',
      reason: 'consent_scope_producer_only',
    });
    const asFinance = await mock.port.read({ subscriber: 'finance', limit: 10 });
    expect(asFinance.outcome).toBe('delivered');
  });
});
