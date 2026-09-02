/**
 * Single-window Hermes ingress policy.
 * Owning authority: PFOS Contract 14 (v2); Contracts 06, 12, and 13; money rules; Drive scope.
 * Phase 14 — single-window Slack ingress surface.
 * Depends on: profilePolicy.ts and toolBoundary.ts.
 * This module names aliases and tool families only. It never reads, returns, or logs a secret.
 * v2: Telegram revoked at all levels; Slack Socket Mode replaces it as the sole transport.
 */
import { HERMES_PROFILE_POLICIES, type HermesProfileName } from './profilePolicy.ts';
import { HERMES_TOOLS_BY_PROFILE, type HermesToolName } from './toolBoundary.ts';

export const INGRESS_PROFILE_NAME = 'nizam-ingress' as const;
export type HermesIngressProfileName = typeof INGRESS_PROFILE_NAME;

/** Slack credentials — these ARE the Hermes env-var names for Slack Socket Mode. */
export const SLACK_BOT_TOKEN_ALIAS = 'SLACK_BOT_TOKEN' as const;
export const SLACK_APP_TOKEN_ALIAS = 'SLACK_APP_TOKEN' as const;
export const SLACK_ALLOWED_USERS_ALIAS = 'SLACK_ALLOWED_USERS' as const;

/**
 * All Telegram aliases are revoked. No live process may reference them.
 * Owner revokes via BotFather before the Slack gateway starts.
 */
export const REVOKED_TELEGRAM_ALIASES = [
  'BOT_NIZAM_TOKEN',
  'BOT_A_TOKEN',
  'BOT_B_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ALLOWED_CHATS',
] as const;
export type RevokedTelegramAlias = (typeof REVOKED_TELEGRAM_ALIASES)[number];

/** Kept for audit records that still carry it; signals complete revocation. */
export const DEPRECATED_PENDING_REVOKE = 'DEPRECATED_PENDING_REVOKE' as const;

export const INGRESS_ALIAS_MAP = Object.freeze({
  slackBotToken: SLACK_BOT_TOKEN_ALIAS,
  slackAppToken: SLACK_APP_TOKEN_ALIAS,
  hermesSlackBotToken: SLACK_BOT_TOKEN_ALIAS,
  hermesSlackAppToken: SLACK_APP_TOKEN_ALIAS,
  allowlist: 'ALLOWED_USER_IDS',
  hermesAllowedUsers: SLACK_ALLOWED_USERS_ALIAS,
  openRouterKey: 'OR_KEY_LIFE',
  hermesOpenRouterKey: 'OPENROUTER_API_KEY',
  killAll: 'NIZAM_KILL_ALL',
} as const);

export interface IngressPolicy {
  readonly profile: HermesIngressProfileName;
  readonly executionOnly: true;
  readonly slackBotTokenEntry: typeof SLACK_BOT_TOKEN_ALIAS;
  readonly slackAppTokenEntry: typeof SLACK_APP_TOKEN_ALIAS;
  readonly slackAllowedUsersEntry: typeof SLACK_ALLOWED_USERS_ALIAS;
  readonly openRouterKeyEntry: 'OR_KEY_LIFE';
  readonly weeklyCapEntry: 'LIFE_WEEKLY_CAP';
  readonly storeEntry: 'LIFE_DATA_DIR';
  readonly financeOpenRouterKeyEntry: 'OR_KEY_FINANCE';
  readonly financeWeeklyCapEntry: 'FINANCE_WEEKLY_CAP';
  readonly financeStoreEntry: 'FINANCE_DATA_DIR';
}

export const INGRESS_POLICY: IngressPolicy = Object.freeze({
  profile: INGRESS_PROFILE_NAME,
  executionOnly: true,
  slackBotTokenEntry: SLACK_BOT_TOKEN_ALIAS,
  slackAppTokenEntry: SLACK_APP_TOKEN_ALIAS,
  slackAllowedUsersEntry: SLACK_ALLOWED_USERS_ALIAS,
  openRouterKeyEntry: 'OR_KEY_LIFE',
  weeklyCapEntry: 'LIFE_WEEKLY_CAP',
  storeEntry: 'LIFE_DATA_DIR',
  financeOpenRouterKeyEntry: 'OR_KEY_FINANCE',
  financeWeeklyCapEntry: 'FINANCE_WEEKLY_CAP',
  financeStoreEntry: 'FINANCE_DATA_DIR',
});

export function isRevokedTelegramAlias(entry: string): entry is RevokedTelegramAlias {
  return (REVOKED_TELEGRAM_ALIASES as readonly string[]).includes(entry);
}

/** Any process presenting a revoked Telegram alias is refused immediately. */
export function assertRevokedTelegramAliasesNotPresent(liveAliases: readonly string[]): void {
  const liveRevoked = liveAliases.filter(isRevokedTelegramAlias);
  if (liveRevoked.length > 0) {
    throw new Error('HERMES_REVOKED_TELEGRAM_ALIAS_STILL_LIVE');
  }
}

export function assertIngressKeepsInternalIsolation(): void {
  const nizam = HERMES_PROFILE_POLICIES.nizam;
  const pfos = HERMES_PROFILE_POLICIES.pfos;
  if (nizam.openRouterKeyEntry === pfos.openRouterKeyEntry) throw new Error('HERMES_PROFILE_ISOLATION_FAILED');
  if (nizam.weeklyCapEntry === pfos.weeklyCapEntry) throw new Error('HERMES_PROFILE_ISOLATION_FAILED');
  if (nizam.storeEntry === pfos.storeEntry) throw new Error('HERMES_PROFILE_ISOLATION_FAILED');
  const ingressSlack: string[] = [INGRESS_POLICY.slackBotTokenEntry, INGRESS_POLICY.slackAppTokenEntry];
  const internal: string[] = [nizam.openRouterKeyEntry, pfos.openRouterKeyEntry];
  for (const alias of ingressSlack) {
    if (internal.includes(alias)) throw new Error('HERMES_INGRESS_ALIAS_COLLISION');
  }
}

export function toolsReachableFromIngress(): readonly HermesToolName[] {
  const names = new Set<HermesToolName>();
  for (const profile of Object.keys(HERMES_TOOLS_BY_PROFILE) as HermesProfileName[]) {
    for (const tool of HERMES_TOOLS_BY_PROFILE[profile]) names.add(tool);
  }
  return Object.freeze([...names]);
}

export function profileForIngressTool(tool: HermesToolName): HermesProfileName {
  const onNizam = (HERMES_TOOLS_BY_PROFILE.nizam as readonly string[]).includes(tool);
  const onPfos = (HERMES_TOOLS_BY_PROFILE.pfos as readonly string[]).includes(tool);
  if (onPfos && !onNizam) return 'pfos';
  if (onNizam) return 'nizam';
  throw new Error('HERMES_TOOL_NOT_ALLOWED');
}

export function mapIngressAlias(nizamName: keyof typeof INGRESS_ALIAS_MAP): string {
  return INGRESS_ALIAS_MAP[nizamName];
}
