/**
 * Hermes execution-only runtime adapter tests.
 * Owning contract: UPOI task 4.2; PFOS Contract 05, 06, 12, and 13.
 * Phase: Phase 4.2 execution-only Hermes boundary.
 * Depends on: runtimeAdapter.ts and the existing profile/tool policy.
 */
import { describe, expect, it } from 'vitest';
import {
  createHermesRuntimeAdapter,
  HermesRuntimeError,
  type HermesBoundedScalar,
  type HermesGrantVerifier,
  type HermesToolGrant,
} from './runtimeAdapter.ts';

const NOW = '2026-08-16T10:00:00Z';
const LATER = '2026-08-16T11:00:00Z';

function grant(overrides: Partial<HermesToolGrant> = {}): HermesToolGrant {
  return {
    profile: 'nizam',
    tool: 'nizamcore.read_recovery_state',
    grantRef: 'synthetic-grant-1',
    scope: { requestRef: 'turn-1' },
    expiresAt: LATER,
    issuedBy: 'governance',
    ...overrides,
  };
}

function harness(options: { readonly verify?: boolean; readonly result?: unknown } = {}) {
  const calls: HermesToolGrant[] = [];
  const verifier: HermesGrantVerifier = {
    verify(candidate) {
      return options.verify ?? candidate.grantRef === 'synthetic-grant-1';
    },
  };
  const adapter = createHermesRuntimeAdapter({
    grantVerifier: verifier,
    now: () => NOW,
    readiness: { nizam: 'VERIFIED', pfos: 'BUILT' },
    executors: {
      nizam: {
        'nizamcore.read_recovery_state': async (_input, candidate) => {
          calls.push(candidate);
          return options.result ?? { status: 'synthetic-ready' };
        },
      },
    },
  });
  return { adapter, calls };
}

async function errorCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(HermesRuntimeError);
    return (error as HermesRuntimeError).code;
  }
  throw new Error('expected HermesRuntimeError');
}

describe('Hermes execution-only runtime adapter', () => {
  it('exposes only profile-local executable capabilities and independent readiness', () => {
    const { adapter } = harness();
    const nizamCapabilities = adapter.listCapabilities('nizam');
    expect(nizamCapabilities.map((entry) => entry.tool)).not.toContain('nizamcore.request_pfos_analysis');
    expect(nizamCapabilities.every((entry) => entry.requiresGrant && entry.executionOnly && !entry.authoritative)).toBe(true);
    expect(adapter.readiness('nizam')).toMatchObject({ profile: 'nizam', state: 'VERIFIED', executionOnly: true });
    expect(adapter.readiness('pfos')).toMatchObject({ profile: 'pfos', state: 'BUILT', executionOnly: true });
  });

  it('executes one explicitly verified bounded grant without making a policy decision', async () => {
    const { adapter, calls } = harness();
    await expect(adapter.invoke('nizam', grant(), { requestRef: 'turn-1', payload: { limit: 1 } })).resolves.toEqual({
      status: 'synthetic-ready',
    });
    expect(calls).toHaveLength(1);
  });

  it('refuses a request outside the grant scope before the executor is touched', async () => {
    const { adapter, calls } = harness();
    await expect(errorCode(() => adapter.invoke('nizam', grant(), { requestRef: 'turn-2', payload: {} }))).resolves.toBe(
      'HERMES_GRANT_SCOPE_MISMATCH',
    );
    expect(calls).toEqual([]);
  });

  it('refuses a forged or stale grant before the executor is touched', async () => {
    const { adapter, calls } = harness({ verify: false });
    await expect(errorCode(() => adapter.invoke('nizam', grant({ grantRef: 'forged' }), { requestRef: 'turn-1', payload: {} }))).resolves.toBe(
      'HERMES_GRANT_NOT_VERIFIED',
    );
    expect(calls).toEqual([]);
    await expect(errorCode(() => adapter.invoke('nizam', grant({ expiresAt: NOW }), { requestRef: 'turn-1', payload: {} }))).resolves.toBe(
      'HERMES_GRANT_NOT_VERIFIED',
    );
    expect(calls).toEqual([]);
  });

  it('refuses cross-profile grants and authority-bearing tools', async () => {
    const { adapter, calls } = harness();
    await expect(errorCode(() => adapter.invoke('pfos', grant(), { requestRef: 'turn-1', payload: {} }))).resolves.toBe(
      'HERMES_GRANT_PROFILE_MISMATCH',
    );
    await expect(
      errorCode(() =>
        adapter.invoke(
          'pfos',
          grant({ profile: 'pfos', tool: 'pfos.read_financial_snapshot' }),
          { requestRef: 'turn-1', payload: {} },
        ),
      ),
    ).resolves.toBe('HERMES_TOOL_AUTHORITY_FORBIDDEN');
    expect(calls).toEqual([]);
  });

  it('rejects policy, gate, financial, secret-like, and cross-profile input fields', async () => {
    const { adapter, calls } = harness();
    const payloads: readonly Readonly<Record<string, HermesBoundedScalar>>[] = [
      { policy: 'approve' },
      { humanGate: 'complete' },
      { amountMilliunits: 1000 },
      { targetProfile: 'pfos' },
      { token: 'synthetic-secret' },
    ];
    for (const payload of payloads) {
      await expect(errorCode(() => adapter.invoke('nizam', grant(), { requestRef: 'turn-1', payload }))).resolves.toBe(
        'HERMES_INPUT_INVALID',
      );
    }
    expect(calls).toEqual([]);
  });

  it('rejects authority-bearing executor output so model/runtime text cannot become truth', async () => {
    const { adapter } = harness({ result: { amountMilliunits: 1000 } });
    await expect(errorCode(() => adapter.invoke('nizam', grant(), { requestRef: 'turn-1', payload: {} }))).resolves.toBe(
      'HERMES_RESULT_INVALID',
    );
  });
});
