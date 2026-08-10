// @vitest-environment node
/**
 * NIZAM · The model dialler's pure parts — and the fact that nothing here dials
 * Implemented by: PFOS Contract 12 / Phase 2, task **B6**, seam **S3** (spec 07-bot-bringup-v1)
 * Owning requirements: steering §2 (no outbound call from a server process: **the capability this
 *   module builds is never invoked in this suite**), R19 and R24 (no address, no credential and no
 *   body in any refusal)
 * Depends on: ./liveModelDial, ./modelProvider (the credential holder). No network, no store, no clock.
 *
 * **What is deliberately not tested, and why it is stated rather than hidden:** the socket. There is
 * no fake responder here, no loopback listener and no recorded transcript — a dialler tested by
 * dialling would be an outbound call from a server process, which is exactly what steering §2 gates.
 * So the parts that can be proved without a socket are proved here (the address composition, the
 * transport-security belt, the deadline derivation, the identity marker), the *selection* is proved by
 * identity in `../process/modelSelection.test.ts`, and the socket itself is first exercised by the
 * owner on the host after **G4**. Every address below uses a reserved `.invalid` name (R24).
 */
import { describe, expect, it } from 'vitest';

import { modelCredential } from './modelProvider.ts';
import {
  COMPLETIONS_PATH,
  MAX_MODEL_RESPONSE_BYTES,
  MODEL_DIAL_FAILURE_CODES,
  ModelDialError,
  composeModelAddress,
  createLiveModelDial,
  isLiveModelDial,
  modelRequestTimeoutMs,
} from './liveModelDial.ts';

const SECURED_BASE = 'https://model-provider.invalid/v1';
const UNSECURED_BASE = 'http://model-provider.invalid/v1';

describe('the address is composed from the resolved base, and only over a secured transport', () => {
  it('appends the provider\'s published path, with or without a trailing separator on the base', () => {
    expect(composeModelAddress(SECURED_BASE, 'ref')).toBe(`${SECURED_BASE}${COMPLETIONS_PATH}`);
    expect(composeModelAddress(`${SECURED_BASE}/`, 'ref')).toBe(`${SECURED_BASE}${COMPLETIONS_PATH}`);
  });

  it('refuses a base that is not transport-secured, because a credential would travel over it', () => {
    try {
      composeModelAddress(UNSECURED_BASE, 'turn-ref');
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelDialError);
      const refusal = error as ModelDialError;
      expect(refusal.code).toBe('MODEL_DIAL_BASE_UNSECURED');
      // The refusal names the correlation reference and nothing else — no address, no body (R24).
      expect(Object.keys(refusal.detail)).toEqual(['correlationRef']);
      expect(refusal.message).not.toContain('model-provider.invalid');
    }
  });

  it('carries no credential in the address: this provider authorises with a header', () => {
    const address = composeModelAddress(SECURED_BASE, 'ref');
    expect(address).not.toContain('not-a-key');
    expect(address.endsWith(COMPLETIONS_PATH)).toBe(true);
  });
});

describe('the deadline is derived and never defaulted', () => {
  it('converts whole seconds to whole milliseconds', () => {
    expect(modelRequestTimeoutMs(60)).toBe(60_000);
    expect(modelRequestTimeoutMs(1)).toBe(1_000);
  });

  it('refuses a non-positive or non-integer deadline rather than choosing one', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => modelRequestTimeoutMs(bad)).toThrow(RangeError);
    }
  });

  it('refuses to be BUILT without a usable deadline, so it cannot acquire a default of its own', () => {
    expect(() => createLiveModelDial({ deadlineSeconds: 0 })).toThrow(RangeError);
  });
});

describe('the capability is recognisable by identity, which is how the selection is proved', () => {
  it('recognises only a capability this module minted, and never invents one', () => {
    const dial = createLiveModelDial({ deadlineSeconds: 5 });
    expect(isLiveModelDial(dial)).toBe(true);
    // A cast does not survive the check: the marker is a WeakSet membership, not a property.
    expect(isLiveModelDial(async () => ({ status: 200, bodyText: '{}', latencyMs: 0 }))).toBe(false);
  });

  it('constructs without dialling: building the capability reaches nothing', () => {
    // The assertion is the absence of an invocation. Nothing below calls `dial`, here or anywhere in
    // this suite, and that is the property steering §2 requires of a server process.
    const dial = createLiveModelDial({ deadlineSeconds: 5 });
    expect(typeof dial).toBe('function');
    expect(dial.length).toBe(2);
    // The credential holder can be built beside it, and still nothing is dialled.
    expect(String(modelCredential('not-a-key'))).toBe('[redacted]');
  });
});

describe('the bounds and the failure vocabulary are closed', () => {
  it('holds a byte bound on the wire', () => {
    expect(MAX_MODEL_RESPONSE_BYTES).toBe(1_048_576);
  });

  it('names exactly the three reasons no answer exists at all', () => {
    expect([...MODEL_DIAL_FAILURE_CODES]).toEqual([
      'MODEL_DIAL_BASE_UNSECURED',
      'MODEL_DIAL_UNREACHABLE',
      'MODEL_DIAL_TIMED_OUT',
    ]);
  });
});
