// @vitest-environment node
/**
 * NIZAM · Which provider request capability the process wires, proved without dialling
 * Implemented by: PFOS Contract 12 / Phase 2, task B4 decision **D-DIALLER**, seam S1
 *   (spec 07-bot-bringup-v1)
 * Owning requirements: R11 (the credential is configured, never defaulted — and here it is also the
 *   condition that selects the capability), R19 (a refusal names a gate, never a value),
 *   R24 (no deployment particular in a fixture), steering §2 (an outbound call from a server process
 *   stays behind G3 and G6)
 * Depends on: ./main (`selectProviderRequest`, `providerCapabilityFor`), ../telegram/
 *   liveProviderRequest (the identity marker), ../telegram/providerRequest (the gated capability's
 *   own refusal). No environment is read: every case passes a synthetic record.
 *
 * **The live branch is proved by IDENTITY, never by invocation.** `isLiveProviderRequest` recognises
 * only a capability the dialler module minted, so asserting it answers "which function was wired"
 * without the function being called — and calling it is the one thing steering §2 gates. The gated
 * branch IS invoked, because it holds no socket: refusing is the whole of what it does.
 *
 * Both directions are asserted, which is the point. A selection observed only refusing is not evidence
 * that the live path is reachable, and a selection observed only selecting live is not evidence that a
 * developer machine stays gated.
 */
import { describe, expect, it } from 'vitest';

import type { EnvSource } from '../config/environment.ts';
import { isLiveProviderRequest } from '../telegram/liveProviderRequest.ts';
import { ProviderRequestError } from '../telegram/providerRequest.ts';
import { PROVIDER_CAPABILITIES, providerCapabilityFor, selectProviderRequest } from './main.ts';

/** This agent's own G3 entry. Spelled here only to build the fixture. */
const TOKEN_ENTRY = 'BOT_B_TOKEN';
/** Deliberately unlike a credential: a label, not a plausible secret (R24). */
const FIXTURE_TOKEN = 'fixture-not-a-credential';

function envOf(overrides: Record<string, string | undefined> = {}): EnvSource {
  return { [TOKEN_ENTRY]: FIXTURE_TOKEN, ...overrides };
}

describe('the capability set is closed', () => {
  it('offers exactly two capabilities, so "which one" is answerable by name', () => {
    expect([...PROVIDER_CAPABILITIES].sort()).toEqual(['gated', 'live']);
  });
});

describe('with this agent\'s credential configured, the LIVE capability is wired', () => {
  it('selects the dialler, and the assertion is its identity rather than a call', () => {
    expect(providerCapabilityFor(envOf())).toBe('live');
    const wired = selectProviderRequest(envOf());
    // Identity only. `wired` is never invoked anywhere in this suite: invoking it would dial.
    expect(isLiveProviderRequest(wired)).toBe(true);
  });
});

describe('with the credential unconfigured, the GATED capability is wired and it refuses', () => {
  /** Every way the loader's own rule calls an entry unconfigured. None of them is a live deployment. */
  const unconfigured: readonly (readonly [string, string | undefined])[] = [
    ['absent', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['still its template placeholder', `<${TOKEN_ENTRY}>`],
  ];

  it.each(unconfigured)('is gated when the credential is %s', (_label, value) => {
    const env = envOf({ [TOKEN_ENTRY]: value });
    expect(providerCapabilityFor(env)).toBe('gated');
    expect(isLiveProviderRequest(selectProviderRequest(env))).toBe(false);
  });

  it('refuses when called, and names the two gates that supply a socket', async () => {
    const wired = selectProviderRequest(envOf({ [TOKEN_ENTRY]: undefined }));
    let refusal: unknown = null;
    try {
      // Safe to invoke: the gated capability holds no network primitive. That is why it exists.
      await wired({ baseUrl: 'https://provider.invalid', operation: 'send_message', body: '{}' }, {
        toString: () => '[redacted]',
        toJSON: () => '[redacted]',
      } as never);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ProviderRequestError);
    const error = refusal as ProviderRequestError;
    expect(error.reason).toBe('transport_gated');
    expect(error.message).toContain('G3');
    expect(error.message).toContain('G6');
    // The refusal names gates and an operation, and no value (R19, R24).
    expect(Object.keys(error.detail)).toEqual(['operation']);
    expect(error.message).not.toContain(FIXTURE_TOKEN);
  });
});
