/**
 * Hermes profile environment tests.
 * Implemented by: PFOS Contract 12 / Wave 2 Hermes gateway wiring.
 * Owning authority: PFOS Contracts 12 and 13.
 * Phase: Phase 2.5 refined Hermes integration; Wave 2 Hermes gateway wiring.
 */
import { describe, expect, it } from 'vitest';
import {
  HERMES_PROFILE_ENV_ENTRIES,
  HermesEnvironmentError,
  describeHermesProfileEnvironment,
  loadHermesProfileEnvironment,
} from './profileEnvironment.ts';

const BASE = {
  HERMES_HOME: '/srv/hermes/nizam',
  TELEGRAM_BOT_TOKEN: 'bot-token-test',
  OPENROUTER_API_KEY: 'router-key-test',
  TELEGRAM_ALLOWED_CHATS: '12345',
  NIZAM_KILL_ALL: '0',
} as const;

function withOverrides(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = { ...BASE };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof HermesEnvironmentError) return error.code;
    throw error;
  }
}

describe('Hermes profile environment', () => {
  it('loads a profile without returning either protected secret', () => {
    const loaded = loadHermesProfileEnvironment('nizam', BASE);
    expect(loaded).toMatchObject({
      profile: 'nizam',
      home: '/srv/hermes/nizam',
      provider: 'openrouter',
      model: 'xiaomi/mimo-v2.5',
      allowedChats: ['12345'],
      killAll: '0',
    });
    expect(JSON.stringify(loaded)).not.toContain(BASE.TELEGRAM_BOT_TOKEN);
    expect(JSON.stringify(loaded)).not.toContain(BASE.OPENROUTER_API_KEY);
  });

  it('keeps the two profile identities disjoint through their governed entry names', () => {
    const nizam = loadHermesProfileEnvironment('nizam', BASE);
    const pfos = loadHermesProfileEnvironment('pfos', withOverrides({ HERMES_HOME: '/srv/hermes/pfos' }));
    expect(nizam.profile).not.toBe(pfos.profile);
    expect(describeHermesProfileEnvironment('nizam', BASE)[HERMES_PROFILE_ENV_ENTRIES.openRouterKey]).toBe(true);
    expect(describeHermesProfileEnvironment('pfos', withOverrides({ OPENROUTER_API_KEY: undefined }))['OPENROUTER_API_KEY']).toBe(false);
  });

  it.each([
    ['HERMES_HOME', 'HERMES_ENV_ENTRY_ABSENT', { HERMES_HOME: undefined }],
    ['TELEGRAM_BOT_TOKEN', 'HERMES_ENV_ENTRY_ABSENT', { TELEGRAM_BOT_TOKEN: undefined }],
    ['OPENROUTER_API_KEY', 'HERMES_ENV_ENTRY_ABSENT', { OPENROUTER_API_KEY: undefined }],
    ['NIZAM_KILL_ALL', 'HERMES_KILL_MODE_INVALID', { NIZAM_KILL_ALL: 'yes' }],
  ] as const)('refuses an incomplete or invalid %s entry', (_entry, expected, overrides) => {
    expect(codeOf(() => loadHermesProfileEnvironment('nizam', withOverrides(overrides)))).toBe(expected);
  });

  it('refuses copied placeholders and a relative profile home', () => {
    expect(codeOf(() => loadHermesProfileEnvironment('nizam', withOverrides({ HERMES_HOME: '<HERMES_HOME>' })))).toBe(
      'HERMES_ENV_ENTRY_UNSUBSTITUTED',
    );
    expect(codeOf(() => loadHermesProfileEnvironment('nizam', withOverrides({ HERMES_HOME: 'relative/home' })))).toBe(
      'HERMES_HOME_NOT_ABSOLUTE',
    );
  });

  it('allows an intentionally empty chat allowlist, which means nobody', () => {
    expect(loadHermesProfileEnvironment('nizam', withOverrides({ TELEGRAM_ALLOWED_CHATS: '' })).allowedChats).toEqual([]);
  });
});
