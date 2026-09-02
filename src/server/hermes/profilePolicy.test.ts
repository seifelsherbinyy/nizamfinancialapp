/**
 * Hermes profile policy tests.
 * Owning authority: PFOS Contract 12 and Contract 13.
 * Phase: Phase 2.5 refined Hermes integration.
 * Depends on: profilePolicy.ts and modelPolicy.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  HERMES_PROFILE_POLICIES,
  assertProfileIsolation,
  getHermesProfilePolicy,
  modelForTier,
} from './profilePolicy.ts';

describe('Hermes profile isolation', () => {
  it('uses separate bot, key, cap, and store entries', () => {
    expect(() => assertProfileIsolation(HERMES_PROFILE_POLICIES.nizam, HERMES_PROFILE_POLICIES.pfos)).not.toThrow();
    expect(HERMES_PROFILE_POLICIES.nizam.telegramTokenEntry).not.toBe(HERMES_PROFILE_POLICIES.pfos.telegramTokenEntry);
    expect(HERMES_PROFILE_POLICIES.nizam.openRouterKeyEntry).not.toBe(HERMES_PROFILE_POLICIES.pfos.openRouterKeyEntry);
    expect(HERMES_PROFILE_POLICIES.nizam.weeklyCapEntry).not.toBe(HERMES_PROFILE_POLICIES.pfos.weeklyCapEntry);
    expect(HERMES_PROFILE_POLICIES.nizam.storeEntry).not.toBe(HERMES_PROFILE_POLICIES.pfos.storeEntry);
  });

  it('refuses a shared credential entry', () => {
    const nizam = getHermesProfilePolicy('nizam');
    const shared = { ...getHermesProfilePolicy('pfos'), openRouterKeyEntry: nizam.openRouterKeyEntry };
    expect(() => assertProfileIsolation(nizam, shared)).toThrow('HERMES_PROFILE_ISOLATION_FAILED');
  });

  it('never selects a model for T0 and uses the planned default pair otherwise', () => {
    expect(modelForTier('nizam', 'T0')).toBeNull();
    expect(modelForTier('pfos', 'T0')).toBeNull();
    expect(modelForTier('nizam', 'T1')).toBe('xiaomi/mimo-v2.5');
    expect(modelForTier('pfos', 'T1')).toBe('z-ai/glm-5.2');
    expect(modelForTier('pfos', 'T2')).toBe('z-ai/glm-5.2');
  });
});
