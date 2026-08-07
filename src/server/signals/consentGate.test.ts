// @vitest-environment node
/**
 * NIZAM · The consent gate — the five §4.5 rules, and what actually crosses
 * Implemented by: PFOS Contract 12 / Phase 3.2 (spec 06-two-agent-vps)
 * Owning requirements: R8 (consent scope), R10 (exclusion), with R7 support
 * Depends on: ./consentGate, ./envelopeValidation, ./envelopeSchema, ../ports/signalBus
 *
 * Scope note, because Phase 3.4 owns the full negative battery and Phase 3.1 already shipped
 * the envelope negatives. This file covers only THIS module's contract:
 *   - the five §4.5 rules, one describe block each;
 *   - the §4.6 layer-4 de-identification claims about the gate's OUTPUT.
 * It does NOT re-test the Phase 3.1 refusals (a figure, a date, an identifier, an unrecognized
 * field, an over-cap note, a tier that is not a member, a bad digest) — those belong to
 * `envelopeValidation.test.ts` and to 3.4's battery. It does not touch the store, which is 3.3's.
 *
 * The positive control comes first on purpose (design "testing strategy", T7): a gate that has
 * only ever been observed refusing is not evidence that it delivers what it should.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { SignalEnvelope, SignalKind, SignalProducer, SignalQuery, SignalTier } from '../ports/signalBus';
import { SIGNAL_KINDS, SIGNAL_NOTE_MAX_LENGTH, SIGNAL_REFUSAL_REASONS, SIGNAL_TIERS } from '../ports/signalBus';
import {
  deidentificationBreaches,
  defaultConsentScopeFor,
  DEIDENTIFICATION_CLAIMS,
  effectiveConsentScope,
  evaluateConsentGates,
  gateSignals,
  NARROW_TIERS_READABLE_BY_BOTH,
  scopeGatePasses,
  serveToSubscriber,
  tierGatePasses,
  WIDENED_KINDS,
  type ConsentPolicy,
  type KindWidening,
  type ReadableTiersBySubscriber,
  type ServedSignalEnvelope,
} from './consentGate';
import { SignalValidationError, unwrapSignalValidation, validateForWrite } from './envelopeValidation';

const MODULE_SOURCE = readFileSync(fileURLToPath(new URL('./consentGate.ts', import.meta.url)), 'utf8');

/** The module with its prose removed, so a scan reads what the module DOES, not what it says. */
const MODULE_CODE = MODULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const WIDENED_MONEY_PRESSURE: readonly KindWidening[] = [
  { kind: 'money_pressure', widenedTo: 'shared', authorizedBy: 'owner' },
];

/** Every tier open, so the tier gate is out of the way while the scope gate is under test. */
const OPEN_TIERS: ConsentPolicy = { readableTiers: NARROW_TIERS_READABLE_BY_BOTH, widenedKinds: WIDENED_MONEY_PRESSURE };

/** One tier closed to the life agent, so the tier gate can be observed firing on its own. */
const LIFE_CANNOT_READ_MONEY_SAFE: ReadableTiersBySubscriber = { finance: SIGNAL_TIERS, life: ['life_safe'] };

interface StoredRowOverrides {
  readonly signalId?: string;
  readonly ts?: string;
  readonly producer?: SignalProducer;
  readonly kind?: SignalKind;
  readonly tier?: SignalTier;
  readonly consentScope?: 'shared' | 'producer_only';
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** A sealed stored row, built through the one write path so its digest is the real one. */
function storedRow(overrides: StoredRowOverrides = {}): SignalEnvelope {
  return unwrapSignalValidation(
    validateForWrite({
      signalId: overrides.signalId ?? 'sig-alpha',
      ts: overrides.ts ?? '2026-08-06T09:00:00Z',
      producer: overrides.producer ?? 'finance',
      kind: overrides.kind ?? 'money_pressure',
      tier: overrides.tier ?? 'money_safe',
      consentScope: overrides.consentScope ?? 'shared',
      payload: overrides.payload ?? { level: 'amber', direction: 'downshift' },
    }),
  );
}

function query(subscriber: SignalProducer, limit = 10): SignalQuery {
  return { subscriber, limit };
}

// =============================================================================================
// Positive control
// =============================================================================================

describe('a widened, shared, readable signal is delivered (T7, §4.5)', () => {
  it('delivers the stored envelope to the other agent unchanged', () => {
    const row = storedRow();
    const outcome = gateSignals([row], query('life'), OPEN_TIERS);
    expect(outcome.outcome).toBe('delivered');
    if (outcome.outcome !== 'delivered') return;
    expect(outcome.signals).toHaveLength(1);
    expect(outcome.signals[0]).toEqual(row);
  });

  it('lets the producer read its own producer_only signal, which is what the scope is for', () => {
    const row = storedRow({ consentScope: 'producer_only' });
    expect(gateSignals([row], query('finance'), OPEN_TIERS).outcome).toBe('delivered');
  });

  it('applies the query limit to a delivered set, and every delivered signal passed both gates', () => {
    const rows = [storedRow({ signalId: 'sig-a' }), storedRow({ signalId: 'sig-b' }), storedRow({ signalId: 'sig-c' })];
    const outcome = gateSignals(rows, query('life', 2), OPEN_TIERS);
    if (outcome.outcome !== 'delivered') throw new Error('expected a delivery');
    expect(outcome.signals.map((signal) => signal.signalId)).toEqual(['sig-a', 'sig-b']);
  });
});

// =============================================================================================
// Rule 1 — the refusal happens at the bus, not at the subscriber (§4.5.1)
// =============================================================================================

describe('rule 1: only the bus can conclude that a subscriber may see a signal (§4.5.1)', () => {
  it('will not let a subscriber mint a served envelope out of a stored one', () => {
    const row = storedRow();
    // A subscriber that decides for itself is not a consent boundary; it is a convention. The
    // brand is what makes that sentence a compile error rather than a comment.
    // @ts-expect-error a stored envelope is not a served envelope until the gate says so
    const forged: ServedSignalEnvelope = row;
    expect(forged.signalId).toBe('sig-alpha');
  });

  it('is the sole producer of a served envelope, and hands back nothing else on a refusal', () => {
    const outcome = gateSignals([storedRow({ consentScope: 'producer_only' })], query('life'), OPEN_TIERS);
    expect(outcome).toEqual({ outcome: 'refused', reason: 'consent_scope_producer_only' });
    expect(Object.keys(outcome)).toEqual(['outcome', 'reason']);
    // No `signals` key on a refusal: there is nothing partial to inspect (§4.5.2, §4.3.6).
    expect('signals' in outcome).toBe(false);
  });

  it('speaks the port\u2019s refusal vocabulary and invents no second one', () => {
    const outcome = gateSignals([storedRow({ consentScope: 'producer_only' })], query('life'), OPEN_TIERS);
    if (outcome.outcome !== 'refused') throw new Error('expected a refusal');
    expect(SIGNAL_REFUSAL_REASONS).toContain(outcome.reason);
  });
});

// =============================================================================================
// Rule 2 — a refusal is a refusal, not an empty result (§4.5.2)
// =============================================================================================

describe('rule 2: a refusal is distinguishable from an empty delivery (§4.5.2)', () => {
  it('returns a different discriminant for "denied" than for "nothing matched"', () => {
    const nothingMatched = gateSignals([], query('life'), OPEN_TIERS);
    const denied = gateSignals([storedRow({ consentScope: 'producer_only' })], query('life'), OPEN_TIERS);
    expect(nothingMatched).toEqual({ outcome: 'delivered', signals: [] });
    expect(denied.outcome).toBe('refused');
    expect(denied).not.toEqual(nothingMatched);
  });

  it('refuses the WHOLE read rather than quietly shortening the delivered list', () => {
    const permitted = storedRow({ signalId: 'sig-open' });
    const denied = storedRow({ signalId: 'sig-closed', consentScope: 'producer_only' });
    const outcome = gateSignals([permitted, denied], query('life'), OPEN_TIERS);
    // Dropping `sig-closed` and delivering one signal would be exactly the indistinguishable
    // empty-ish result the rule forbids.
    expect(outcome).toEqual({ outcome: 'refused', reason: 'consent_scope_producer_only' });
  });

  it('refuses even when the limit would have hidden the denied row anyway', () => {
    const rows = [storedRow({ signalId: 'sig-open' }), storedRow({ signalId: 'sig-closed', consentScope: 'producer_only' })];
    expect(gateSignals(rows, query('life', 1), OPEN_TIERS).outcome).toBe('refused');
  });

  it('throws rather than refuses when a stored row is not readable at all, so the two are never confused', () => {
    // A corrupt store is a defect, not a subscriber being told no, and not an absence.
    const tampered = { ...storedRow(), hash: 'f'.repeat(64) };
    expect(() => gateSignals([tampered], query('life'), OPEN_TIERS)).toThrow(SignalValidationError);
  });
});

// =============================================================================================
// Rule 3 — producer_only is the default for a new kind (§4.5.3)
// =============================================================================================

describe('rule 3: a kind nobody widened is closed, mechanically (§4.5.3)', () => {
  it('ships an empty widening allowlist, so the default applies to everything today', () => {
    expect(WIDENED_KINDS).toEqual([]);
  });

  it('resolves EVERY kind in the schema to producer_only under the shipped allowlist', () => {
    // Iterating SIGNAL_KINDS is the mechanism: a kind added tomorrow is covered by this test on
    // the day it is added, and it is covered as closed.
    for (const kind of SIGNAL_KINDS) {
      expect(defaultConsentScopeFor(kind), kind).toBe('producer_only');
    }
    expect(SIGNAL_KINDS.length).toBeGreaterThan(0);
  });

  it('takes the narrower of the stored scope and the kind default, so a stray "shared" widens nothing', () => {
    const optimistic = storedRow({ consentScope: 'shared', kind: 'readiness' });
    expect(optimistic.consentScope).toBe('shared');
    expect(effectiveConsentScope(optimistic, WIDENED_KINDS)).toBe('producer_only');
    expect(effectiveConsentScope(optimistic, WIDENED_MONEY_PRESSURE)).toBe('producer_only');
  });

  it('refuses a stored-as-shared signal on an un-widened kind, and delivers it once the owner widens it', () => {
    const row = storedRow({ consentScope: 'shared', kind: 'readiness' });
    const closed: ConsentPolicy = { readableTiers: NARROW_TIERS_READABLE_BY_BOTH, widenedKinds: WIDENED_KINDS };
    expect(gateSignals([row], query('life'), closed)).toEqual({
      outcome: 'refused',
      reason: 'consent_scope_producer_only',
    });

    const widened: ConsentPolicy = {
      readableTiers: NARROW_TIERS_READABLE_BY_BOTH,
      widenedKinds: [{ kind: 'readiness', widenedTo: 'shared', authorizedBy: 'owner' }],
    };
    expect(gateSignals([row], query('life'), widened).outcome).toBe('delivered');
  });

  it('keeps producer_only in force even for a widened kind, because widening a kind is not widening a signal', () => {
    const row = storedRow({ consentScope: 'producer_only', kind: 'money_pressure' });
    expect(effectiveConsentScope(row, WIDENED_MONEY_PRESSURE)).toBe('producer_only');
    expect(gateSignals([row], query('life'), OPEN_TIERS).outcome).toBe('refused');
  });
});

// =============================================================================================
// Rule 4 — evaluated on read, every read, from the stored envelope (§4.5.4)
// =============================================================================================

describe('rule 4: scope is re-evaluated on every read from the stored row, never cached (§4.5.4)', () => {
  it('holds no state: no module-level mutable binding, no map, no memo, no cache', () => {
    const moduleScopeMutable = MODULE_CODE.split('\n').filter((line) => /^(let|var)\s/.test(line));
    expect(moduleScopeMutable).toEqual([]);
    expect(MODULE_CODE).not.toMatch(/new (Weak)?(Map|Set)\(/);
    expect(MODULE_CODE).not.toMatch(/memo/i);
    expect(MODULE_CODE).not.toMatch(/cache/i);
  });

  it('changes its answer when the stored scope changes between two reads', () => {
    const store: Record<string, unknown>[] = [{ ...storedRow({ consentScope: 'shared' }) }];
    expect(gateSignals(store, query('life'), OPEN_TIERS).outcome).toBe('delivered');

    store[0]!.consentScope = 'producer_only';
    expect(gateSignals(store, query('life'), OPEN_TIERS)).toEqual({
      outcome: 'refused',
      reason: 'consent_scope_producer_only',
    });

    store[0]!.consentScope = 'shared';
    expect(gateSignals(store, query('life'), OPEN_TIERS).outcome).toBe('delivered');
  });

  it('changes its answer when the stored tier changes between two reads', () => {
    const policy: ConsentPolicy = { readableTiers: LIFE_CANNOT_READ_MONEY_SAFE, widenedKinds: WIDENED_MONEY_PRESSURE };
    const store: Record<string, unknown>[] = [{ ...storedRow({ tier: 'life_safe' }) }];
    expect(gateSignals(store, query('life'), policy).outcome).toBe('delivered');

    store[0]!.tier = 'money_safe';
    expect(gateSignals(store, query('life'), policy)).toEqual({
      outcome: 'refused',
      reason: 'tier_not_readable_by_subscriber',
    });
  });

  it('is why re-evaluation matters: the digest does not cover tier or consent scope', () => {
    // The hash is over ts, producer, kind and payload (§4.2). A row whose scope was widened
    // after it was written still hashes correctly, so integrity cannot substitute for the gate.
    const original = storedRow({ consentScope: 'producer_only', tier: 'money_safe' });
    const rewritten = { ...original, consentScope: 'shared', tier: 'life_safe' };
    expect(rewritten.hash).toBe(original.hash);
    // Read validation still accepts it — only the gate notices the change.
    expect(gateSignals([original], query('life'), OPEN_TIERS).outcome).toBe('refused');
    expect(gateSignals([rewritten], query('life'), OPEN_TIERS).outcome).toBe('delivered');
  });

  it('re-reads the stored fields on the second call rather than answering from the first', () => {
    const row = storedRow();
    const reads: string[] = [];
    const observed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      Object.defineProperty(observed, key, {
        enumerable: true,
        get() {
          reads.push(key);
          return value;
        },
      });
    }

    gateSignals([observed], query('life'), OPEN_TIERS);
    const afterFirstRead = reads.filter((key) => key === 'consentScope').length;
    expect(afterFirstRead).toBeGreaterThan(0);

    gateSignals([observed], query('life'), OPEN_TIERS);
    const afterSecondRead = reads.filter((key) => key === 'consentScope').length;
    expect(afterSecondRead).toBeGreaterThan(afterFirstRead);
  });
});

// =============================================================================================
// Rule 5 — tier and scope are independent gates (§4.5.5)
// =============================================================================================

describe('rule 5: tier and scope are independent gates, both of which must pass (§4.5.5)', () => {
  const policy: ConsentPolicy = { readableTiers: LIFE_CANNOT_READ_MONEY_SAFE, widenedKinds: WIDENED_MONEY_PRESSURE };

  it('refuses a money_safe signal marked producer_only, which is §4.5.5\u2019s own example', () => {
    const row = storedRow({ tier: 'money_safe', consentScope: 'producer_only' });
    // The tier is one the finance agent may read; the scope still closes the door.
    expect(tierGatePasses(row, 'finance', NARROW_TIERS_READABLE_BY_BOTH)).toBe(true);
    expect(gateSignals([row], query('life'), OPEN_TIERS)).toEqual({
      outcome: 'refused',
      reason: 'consent_scope_producer_only',
    });
  });

  it('permits only when BOTH gates pass, across the whole truth table', () => {
    const table: readonly { readonly scope: 'shared' | 'producer_only'; readonly tier: SignalTier }[] = [
      { scope: 'shared', tier: 'life_safe' },
      { scope: 'shared', tier: 'money_safe' },
      { scope: 'producer_only', tier: 'life_safe' },
      { scope: 'producer_only', tier: 'money_safe' },
    ];
    for (const row of table) {
      const envelope = storedRow({ consentScope: row.scope, tier: row.tier });
      const scopePasses = scopeGatePasses(envelope, 'life', policy.widenedKinds);
      const tierPasses = tierGatePasses(envelope, 'life', policy.readableTiers);
      const verdict = evaluateConsentGates(envelope, 'life', policy);
      expect(verdict.permitted, `${row.scope}/${row.tier}`).toBe(scopePasses && tierPasses);
    }
  });

  it('reports each gate with its own reason, so an operator learns which one fired', () => {
    const scopeOnly = storedRow({ consentScope: 'producer_only', tier: 'life_safe' });
    const tierOnly = storedRow({ consentScope: 'shared', tier: 'money_safe' });
    expect(evaluateConsentGates(scopeOnly, 'life', policy)).toEqual({
      permitted: false,
      reason: 'consent_scope_producer_only',
    });
    expect(evaluateConsentGates(tierOnly, 'life', policy)).toEqual({
      permitted: false,
      reason: 'tier_not_readable_by_subscriber',
    });
  });

  it('does not let a passing tier excuse a failing scope, or the reverse', () => {
    const scopeOnly = storedRow({ consentScope: 'producer_only', tier: 'life_safe' });
    const tierOnly = storedRow({ consentScope: 'shared', tier: 'money_safe' });
    expect(tierGatePasses(scopeOnly, 'life', policy.readableTiers)).toBe(true);
    expect(evaluateConsentGates(scopeOnly, 'life', policy).permitted).toBe(false);
    expect(scopeGatePasses(tierOnly, 'life', policy.widenedKinds)).toBe(true);
    expect(evaluateConsentGates(tierOnly, 'life', policy).permitted).toBe(false);
  });

  it('refuses every tier for a subscriber the policy grants nothing, and grants nothing by default', () => {
    const noTiers: ConsentPolicy = { readableTiers: { finance: [], life: [] }, widenedKinds: WIDENED_MONEY_PRESSURE };
    for (const tier of SIGNAL_TIERS) {
      const row = storedRow({ tier, consentScope: 'shared' });
      expect(gateSignals([row], query('life'), noTiers), tier).toEqual({
        outcome: 'refused',
        reason: 'tier_not_readable_by_subscriber',
      });
    }
  });
});

// =============================================================================================
// §4.6 layer 4 — de-identification of the OUTPUT (R7)
// =============================================================================================

describe('what crosses to a subscriber is de-identified, asserted about the output (§4.6 layer 4)', () => {
  it('finds nothing to report in anything the gate actually delivers', () => {
    const rows = SIGNAL_TIERS.flatMap((tier) =>
      (['green', 'amber', 'red'] as const).map((level) =>
        storedRow({ tier, consentScope: 'shared', payload: { level, direction: 'hold', note: 'ease off a little' } }),
      ),
    );
    const outcome = gateSignals(rows, query('life', rows.length), OPEN_TIERS);
    if (outcome.outcome !== 'delivered') throw new Error('expected a delivery');
    expect(outcome.signals).toHaveLength(rows.length);
    for (const served of outcome.signals) {
      expect(deidentificationBreaches(served), served.signalId).toEqual([]);
    }
  });

  it('carries no figure: no numeric value anywhere, and no digit in the note', () => {
    const outcome = gateSignals([storedRow({ consentScope: 'shared' })], query('life'), OPEN_TIERS);
    if (outcome.outcome !== 'delivered') throw new Error('expected a delivery');
    const served = outcome.signals[0]!;
    for (const value of Object.values(served)) {
      expect(typeof value).not.toBe('number');
      expect(typeof value).not.toBe('bigint');
    }
    for (const value of Object.values(served.payload)) {
      expect(typeof value).not.toBe('number');
      if (typeof value === 'string') expect(value).not.toMatch(/\d/);
    }
  });

  it('carries no date beyond the envelope\u2019s own ts, and no identifier beyond signal_id and the digest', () => {
    const outcome = gateSignals([storedRow({ consentScope: 'shared' })], query('life'), OPEN_TIERS);
    if (outcome.outcome !== 'delivered') throw new Error('expected a delivery');
    const served = outcome.signals[0]!;
    const dateShaped = Object.entries(served).filter(([, value]) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value));
    expect(dateShaped.map(([key]) => key)).toEqual(['ts']);
    // The key set IS the claim: with exactly these keys there is no field an account, a
    // transaction, or a document reference could travel in (§4.3.5).
    expect(Object.keys(served).sort()).toEqual(
      ['consentScope', 'hash', 'kind', 'payload', 'producer', 'signalId', 'tier', 'ts'].sort(),
    );
    expect(Object.keys(served.payload).every((key) => ['level', 'direction', 'note'].includes(key))).toBe(true);
  });

  it('carries no text over cap', () => {
    const note = 'ease off gently and revisit next cycle';
    const outcome = gateSignals([storedRow({ consentScope: 'shared', payload: { level: 'red', note } })], query('life'), OPEN_TIERS);
    if (outcome.outcome !== 'delivered') throw new Error('expected a delivery');
    const served = outcome.signals[0]!;
    expect(served.payload.note?.length).toBeLessThanOrEqual(SIGNAL_NOTE_MAX_LENGTH);
    for (const value of Object.values(served)) {
      if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(128);
    }
  });

  it('is an independent derivation, and catches something read validation accepts', () => {
    // A bare calendar date is a legal signal identifier as far as the envelope schema is
    // concerned — it is a non-empty string within bound. It is still a date crossing the
    // boundary, and layer 4 is the layer that holds when the others do not.
    const row = storedRow({ signalId: '2026-08-06', consentScope: 'shared' });
    const breaches = deidentificationBreaches(row);
    expect(breaches).toEqual([{ claim: 'no_date_beyond_the_envelope_ts', reason: 'field_temporal', at: 'signalId' }]);
    expect(() => gateSignals([row], query('life'), OPEN_TIERS)).toThrow(SignalValidationError);
  });

  it('fires for each claim when handed a value that breaks it', () => {
    const breach = (candidate: unknown) => deidentificationBreaches(candidate as SignalEnvelope);
    const base = storedRow({ consentScope: 'shared' });

    expect(breach({ ...base, payload: { level: 'amber', balanceMilli: 47_000_000 } })).toContainEqual({
      claim: 'no_figure',
      reason: 'field_numeric',
      at: 'payload.balanceMilli',
    });
    expect(breach({ ...base, payload: { level: 'amber', dueOn: '2026-09-01' } })).toContainEqual({
      claim: 'no_date_beyond_the_envelope_ts',
      reason: 'field_temporal',
      at: 'payload.dueOn',
    });
    expect(breach({ ...base, payload: { level: 'amber', accountRef: 'redacted' } })).toContainEqual({
      claim: 'no_identifier_beyond_the_producers_own_signal_id',
      reason: 'field_identifier',
      at: 'payload.accountRef',
    });
    expect(breach({ ...base, payload: { level: 'amber', note: 'x'.repeat(SIGNAL_NOTE_MAX_LENGTH + 1) } })).toContainEqual({
      claim: 'no_text_over_cap',
      reason: 'note_exceeds_cap',
      at: 'payload.note',
    });
    expect(breach({ ...base, payload: { level: 'amber', mood: 'unsettled' } })).toContainEqual({
      claim: 'no_field_beyond_the_schema',
      reason: 'field_unrecognized',
      at: 'payload.mood',
    });
    expect(breach({ ...base, journalExcerpt: 'a paragraph' })).toContainEqual({
      claim: 'no_field_beyond_the_schema',
      reason: 'field_unrecognized',
      at: 'journalExcerpt',
    });
  });

  it('reaches a figure buried inside a structure the schema has no place for', () => {
    const nested = { ...storedRow({ consentScope: 'shared' }), payload: { level: 'amber', detail: { balanceMilli: 1_000 } } };
    const breaches = deidentificationBreaches(nested as unknown as SignalEnvelope);
    expect(breaches).toContainEqual({ claim: 'no_field_beyond_the_schema', reason: 'field_unrecognized', at: 'payload.detail' });
    expect(breaches).toContainEqual({ claim: 'no_figure', reason: 'field_numeric', at: 'payload.detail.balanceMilli' });
  });

  it('retains the path and never the value, so a breach is an audit line and not a quarantine', () => {
    const breaches = deidentificationBreaches({ ...storedRow(), payload: { level: 'amber', balanceMilli: 47 } } as unknown as SignalEnvelope);
    expect(breaches).toHaveLength(1);
    // §4.3.6: no `value`, no `payload`, no `received` field — nothing that could hold what was refused.
    expect(Object.keys(breaches[0]!).sort()).toEqual(['at', 'claim', 'reason']);
  });

  it('names its claims once, and every claim in the list is one the audit can report', () => {
    expect(new Set(DEIDENTIFICATION_CLAIMS).size).toBe(DEIDENTIFICATION_CLAIMS.length);
    expect(DEIDENTIFICATION_CLAIMS).toContain('no_figure');
    expect(DEIDENTIFICATION_CLAIMS).toContain('no_text_over_cap');
  });
});

// =============================================================================================
// R10 — the excluded classification, and the port's own shape
// =============================================================================================

describe('the classification whose egress set is empty upstream is granted nowhere (R10, §4.4)', () => {
  it('is not a tier, so no policy can grant it and no signal can claim it', () => {
    const excluded = 'strict_' + 'local_' + 'maximum';
    expect(SIGNAL_TIERS as readonly string[]).not.toContain(excluded);
    for (const granted of Object.values(NARROW_TIERS_READABLE_BY_BOTH)) {
      expect(granted as readonly string[]).not.toContain(excluded);
    }
    // Exclusion, not filtering: there is no code path here that handles it (§4.4.5).
    expect(MODULE_SOURCE).not.toContain(excluded);
  });

  it('exposes the gate through the port\u2019s own read outcome, so there is no second read shape', () => {
    const delivered = serveToSubscriber([storedRow({ consentScope: 'shared' })], query('life'), OPEN_TIERS);
    const refused = serveToSubscriber([storedRow({ consentScope: 'producer_only' })], query('life'), OPEN_TIERS);
    expect(delivered.outcome).toBe('delivered');
    expect(refused.outcome).toBe('refused');
    if (refused.outcome !== 'refused') return;
    expect(SIGNAL_REFUSAL_REASONS).toContain(refused.reason);
  });
});
