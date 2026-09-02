/**
 * NIZAM Hermes profile environment boundary.
 * Implemented by: PFOS Contract 12 / Wave 2 Hermes gateway wiring.
 * Owning authority: PFOS Contracts 12 and 13, money rules, and the two-agent deployment plan.
 * Phase: Phase 2.5 refined Hermes integration; Wave 2 Hermes gateway wiring.
 * This module validates one protected profile environment without returning secret values.
 */
import { parseAllowedSenderIds, type EnvSource } from '../config/environment.ts';
import { getHermesProfilePolicy, modelForTier, type HermesProfileName } from './profilePolicy.ts';

export const HERMES_PROFILE_ENV_ENTRIES = Object.freeze({
  home: 'HERMES_HOME',
  telegramToken: 'TELEGRAM_BOT_TOKEN',
  openRouterKey: 'OPENROUTER_API_KEY',
  allowedChats: 'TELEGRAM_ALLOWED_CHATS',
  killAll: 'NIZAM_KILL_ALL',
} as const);

export type HermesKillMode = '0' | '1';

export interface HermesProfileEnvironment {
  readonly profile: HermesProfileName;
  readonly home: string;
  readonly provider: 'openrouter';
  readonly model: string;
  readonly allowedChats: readonly string[];
  readonly killAll: HermesKillMode;
  readonly telegramTokenConfigured: true;
  readonly openRouterKeyConfigured: true;
}

export type HermesEnvironmentErrorCode =
  | 'HERMES_ENV_ENTRY_ABSENT'
  | 'HERMES_ENV_ENTRY_EMPTY'
  | 'HERMES_ENV_ENTRY_UNSUBSTITUTED'
  | 'HERMES_HOME_NOT_ABSOLUTE'
  | 'HERMES_KILL_MODE_INVALID'
  | 'HERMES_SECRET_NOT_CONFIGURED';

export class HermesEnvironmentError extends Error {
  readonly code: HermesEnvironmentErrorCode;
  readonly entry: string;

  constructor(code: HermesEnvironmentErrorCode, entry: string, why: string) {
    super(`Hermes environment: ${entry} ${why}`);
    this.name = 'HermesEnvironmentError';
    this.code = code;
    this.entry = entry;
  }
}

const PLACEHOLDER = /^<[A-Z][A-Z0-9_]*>$/;

function readRequired(env: EnvSource, entry: string, allowEmpty = false): string {
  const raw = env[entry];
  if (raw === undefined) throw new HermesEnvironmentError('HERMES_ENV_ENTRY_ABSENT', entry, 'is not set; Hermes has no environment default');
  const value = raw.trim();
  if (PLACEHOLDER.test(value)) {
    throw new HermesEnvironmentError('HERMES_ENV_ENTRY_UNSUBSTITUTED', entry, 'still contains its template placeholder');
  }
  if (!allowEmpty && value.length === 0) {
    throw new HermesEnvironmentError('HERMES_ENV_ENTRY_EMPTY', entry, 'is empty; an empty value is not configured');
  }
  return value;
}

function requireSecretPresence(env: EnvSource, entry: string): void {
  const value = env[entry];
  if (value === undefined) throw new HermesEnvironmentError('HERMES_ENV_ENTRY_ABSENT', entry, 'is not set');
  if (PLACEHOLDER.test(value.trim())) {
    throw new HermesEnvironmentError('HERMES_ENV_ENTRY_UNSUBSTITUTED', entry, 'still contains its template placeholder');
  }
  if (value.trim().length === 0) {
    throw new HermesEnvironmentError('HERMES_SECRET_NOT_CONFIGURED', entry, 'is empty');
  }
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * Validate one profile's protected environment. The token and API key are checked for presence
 * only; Hermes receives them through its own protected environment file, while this result cannot
 * accidentally hand either secret to application code or a logger.
 */
export function loadHermesProfileEnvironment(profile: HermesProfileName, env: EnvSource): HermesProfileEnvironment {
  const policy = getHermesProfilePolicy(profile);
  const home = readRequired(env, HERMES_PROFILE_ENV_ENTRIES.home);
  if (!isAbsolutePath(home)) {
    throw new HermesEnvironmentError('HERMES_HOME_NOT_ABSOLUTE', HERMES_PROFILE_ENV_ENTRIES.home, 'must be an absolute profile home');
  }

  requireSecretPresence(env, HERMES_PROFILE_ENV_ENTRIES.telegramToken);
  requireSecretPresence(env, HERMES_PROFILE_ENV_ENTRIES.openRouterKey);
  const allowedChats = parseAllowedSenderIds(
    readRequired(env, HERMES_PROFILE_ENV_ENTRIES.allowedChats, true),
    HERMES_PROFILE_ENV_ENTRIES.allowedChats,
  );
  const killAll = readRequired(env, HERMES_PROFILE_ENV_ENTRIES.killAll);
  if (killAll !== '0' && killAll !== '1') {
    throw new HermesEnvironmentError('HERMES_KILL_MODE_INVALID', HERMES_PROFILE_ENV_ENTRIES.killAll, 'must be exactly 0 or 1');
  }

  return Object.freeze({
    profile,
    home,
    provider: 'openrouter',
    model: modelForTier(profile, 'T1') ?? policy.modelPolicy.T1,
    allowedChats,
    killAll,
    telegramTokenConfigured: true,
    openRouterKeyConfigured: true,
  });
}

/** Presence-only diagnostics for an operator; no configured value is rendered. */
export function describeHermesProfileEnvironment(profile: HermesProfileName, env: EnvSource): Readonly<Record<string, boolean>> {
  const policy = getHermesProfilePolicy(profile);
  const entries = [
    HERMES_PROFILE_ENV_ENTRIES.home,
    HERMES_PROFILE_ENV_ENTRIES.telegramToken,
    HERMES_PROFILE_ENV_ENTRIES.openRouterKey,
    HERMES_PROFILE_ENV_ENTRIES.allowedChats,
    HERMES_PROFILE_ENV_ENTRIES.killAll,
    policy.openRouterKeyEntry,
    policy.telegramTokenEntry,
  ];
  const result: Record<string, boolean> = {};
  for (const entry of entries) {
    const value = env[entry];
    result[entry] = value !== undefined && value.trim().length > 0 && !PLACEHOLDER.test(value.trim());
  }
  return Object.freeze(result);
}
