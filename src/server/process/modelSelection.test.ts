// @vitest-environment node
/**
 * NIZAM · Which model dial capability the process wires, proved without dialling
 * Implemented by: PFOS Contract 12 / Phase 2, task **B6**, seam **S3** (spec 07-bot-bringup-v1)
 * Owning requirements: R18 (a configured credential makes a call possible, never routable — B8 does
 *   that), R19 (a refusal names a gate, never a value), R24 (no deployment particular in a fixture),
 *   steering §2 (an outbound call from a server process stays behind G4 and D-BENCH)
 * Depends on: ./main (`selectModelDial`, `modelCapabilityFor`, `MODEL_POLICY`), ../model/liveModelDial
 *   (the identity marker), ../model/modelProvider (the gated capability's own refusal). No environment
 *   is read: every case passes a synthetic record.
 *
 * **The live branch is proved by IDENTITY, never by invocation** — the same device B4's
 * `providerSelection.test.ts` uses on the messaging side. `isLiveModelDial` recognises only a
 * capability the dialler module minted, so asserting it answers "which function was wired" without the
 * function being called, and calling it is the one thing steering §2 gates. The gated branch IS
 * invoked, because it holds no socket: refusing is the whole of what it does.
 *
 * Both directions are asserted. A selection observed only refusing is not evidence that the live path
 * is reachable once G4 is done, and a selection observed only selecting live is not evidence that a
 * developer machine stays gated.
 */
import { describe, expect, it } from 'vitest';

import type { EnvSource } from '../config/environment.ts';
import { isLiveModelDial } from '../model/liveModelDial.ts';
import { gatedModelDial, ModelPortError } from '../model/modelProvider.ts';
import { modelCapabilityFor, MODEL_POLICY, PROVIDER_CAPABILITIES, selectModelDial } from './main.ts';

/** This agent's own G4 entry. Spelled here only to build the fixture. */
const KEY_ENTRY = 'OR_KEY_FINANCE';
/** The other agent's entry, which a finance port must never read (R17). */
const OTHER_AGENT_KEY_ENTRY = 'OR_KEY_LIFE';
/** Deliberately unlike a credential: a label, not a plausible secret (R24, steering §2). */
const FIXTURE_KEY = 'fixture-not-a-credential';

function envOf(overrides: Record<string, string | undefined> = {}): EnvSource {
  return { [KEY_ENTRY]: FIXTURE_KEY, ...overrides };
}

describe('the process states one model deadline, and it is a bound rather than a policy', () => {
  it('holds a positive whole number of seconds, so the dialler can be built from it', () => {
    expect(Number.isSafeInteger(MODEL_POLICY.deadlineSeconds)).toBe(true);
    expect(MODEL_POLICY.deadlineSeconds).toBeGreaterThan(0);
  });
});

describe('with this agent\'s model credential configured, the LIVE capability is wired', () => {
  it('selects the dialler, and the assertion is its identity rather than a call', () => {
    expect(modelCapabilityFor(envOf())).toBe('live');
    const wired = selectModelDial(envOf());
    // Identity only. `wired` is never invoked anywhere in this suite: invoking it would dial.
    expect(isLiveModelDial(wired)).toBe(true);
  });

  it('is the same closed capability pair the messaging side uses, so "which one" is answerable', () => {
    expect([...PROVIDER_CAPABILITIES].sort()).toEqual(['gated', 'live']);
  });
});

describe('with the model credential unconfigured, the GATED capability is wired and it refuses', () => {
  /** Every way the loader's own rule calls an entry unconfigured. None of them is a live deployment. */
  const unconfigured: readonly (readonly [string, string | undefined])[] = [
    ['absent', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['still its template placeholder', `<${KEY_ENTRY}>`],
  ];

  it.each(unconfigured)('is gated when the credential is %s', (_label, value) => {
    const env = envOf({ [KEY_ENTRY]: value });
    expect(modelCapabilityFor(env)).toBe('gated');
    expect(isLiveModelDial(selectModelDial(env))).toBe(false);
  });

  it('refuses when called, and names the gate and the authorisation that supply a socket', async () => {
    const wired = selectModelDial(envOf({ [KEY_ENTRY]: undefined }));
    try {
      await wired({ baseUrl: 'https://model-provider.invalid', body: '{}', correlationRef: 'turn-ref' }, {
        toString: () => '[redacted]',
        toJSON: () => '[redacted]',
      } as unknown as Parameters<typeof wired>[1]);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelPortError);
      const refusal = error as ModelPortError;
      expect(refusal.reason).toBe('dial_gated');
      expect(refusal.message).toContain('G4');
      expect(refusal.message).toContain('D-BENCH');
      // It named the gates and no value: not the base it was handed, and no credential.
      expect(refusal.message).not.toContain('model-provider.invalid');
      expect(refusal.message).not.toContain(FIXTURE_KEY);
    }
  });

  it('is the gated capability by construction, not by a flag inside the live one', () => {
    // Two branches, one function each. The gated capability is a different function object, and it is
    // the one a developer machine gets — which is why this suite never holds a socket.
    expect(isLiveModelDial(gatedModelDial())).toBe(false);
  });
});

describe('the selection reads THIS agent\'s entry and not the other agent\'s (R17)', () => {
  it('stays gated when only the other agent\'s credential is configured', () => {
    const env: EnvSource = { [OTHER_AGENT_KEY_ENTRY]: FIXTURE_KEY };
    expect(modelCapabilityFor(env)).toBe('gated');
    expect(isLiveModelDial(selectModelDial(env))).toBe(false);
  });
});
