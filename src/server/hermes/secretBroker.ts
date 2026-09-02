/**
 * Presence-only secret alias broker.
 * Owning authority: PFOS Contract 14 (v2); Contracts 12 and 13; secrets plan; money rules.
 * Phase 14 — single-window Slack ingress surface.
 * Depends on: ingressPolicy.ts.
 * Resolves approved aliases into Hermes environment names. It records presence and refuses
 * unauthorized or revoked aliases. It never returns, logs, or interpolates a credential value.
 */
import {
  INGRESS_ALIAS_MAP,
  REVOKED_TELEGRAM_ALIASES,
  SLACK_BOT_TOKEN_ALIAS,
  SLACK_APP_TOKEN_ALIAS,
  SLACK_ALLOWED_USERS_ALIAS,
  isRevokedTelegramAlias,
} from './ingressPolicy.ts';

export const SECRET_BROKER_OPERATIONS = ['presence-check', 'resolve-name', 'refuse'] as const;
export type SecretBrokerOperation = (typeof SECRET_BROKER_OPERATIONS)[number];

export const SECRET_BROKER_OUTCOMES = ['present', 'absent', 'mapped', 'refused'] as const;
export type SecretBrokerOutcome = (typeof SECRET_BROKER_OUTCOMES)[number];

export interface SecretBrokerAudit {
  readonly alias: string;
  readonly caller: string;
  readonly operation: SecretBrokerOperation;
  readonly outcome: SecretBrokerOutcome;
  readonly at: string;
}

export interface SecretBrokerResult {
  readonly hermesEntry: string | null;
  readonly configured: boolean;
  readonly audit: SecretBrokerAudit;
}

/** Approved live aliases — Slack credentials plus OpenRouter keys and kill switch. */
const APPROVED_LIVE_ALIASES = new Set<string>([
  SLACK_BOT_TOKEN_ALIAS,
  SLACK_APP_TOKEN_ALIAS,
  SLACK_ALLOWED_USERS_ALIAS,
  INGRESS_ALIAS_MAP.allowlist,
  INGRESS_ALIAS_MAP.openRouterKey,
  INGRESS_ALIAS_MAP.killAll,
  'OR_KEY_FINANCE',
]);

/**
 * Slack env-var names are identity-mapped (NIZAM alias = Hermes env-var name).
 * OpenRouter and allowlist aliases map to their Hermes equivalents.
 */
const ALIAS_TO_HERMES: Readonly<Record<string, string>> = Object.freeze({
  [SLACK_BOT_TOKEN_ALIAS]: INGRESS_ALIAS_MAP.hermesSlackBotToken,
  [SLACK_APP_TOKEN_ALIAS]: INGRESS_ALIAS_MAP.hermesSlackAppToken,
  [SLACK_ALLOWED_USERS_ALIAS]: INGRESS_ALIAS_MAP.hermesAllowedUsers,
  [INGRESS_ALIAS_MAP.allowlist]: INGRESS_ALIAS_MAP.hermesAllowedUsers,
  [INGRESS_ALIAS_MAP.openRouterKey]: INGRESS_ALIAS_MAP.hermesOpenRouterKey,
  OR_KEY_FINANCE: INGRESS_ALIAS_MAP.hermesOpenRouterKey,
  [INGRESS_ALIAS_MAP.killAll]: INGRESS_ALIAS_MAP.killAll,
});

const PLACEHOLDER = /^<[A-Z][A-Z0-9_]*>$/;

export class SecretBrokerError extends Error {
  readonly code: 'SECRET_ALIAS_UNAUTHORIZED' | 'SECRET_ALIAS_REVOKED' | 'SECRET_VALUE_REFUSED';

  constructor(code: SecretBrokerError['code'], alias: string) {
    super(`Secret broker refused ${alias}`);
    this.name = 'SecretBrokerError';
    this.code = code;
  }
}

function present(env: Readonly<Record<string, string | undefined>>, alias: string): boolean {
  const raw = env[alias];
  return raw !== undefined && raw.trim().length > 0 && !PLACEHOLDER.test(raw.trim());
}

function audit(
  alias: string,
  caller: string,
  operation: SecretBrokerOperation,
  outcome: SecretBrokerOutcome,
  now: () => string,
): SecretBrokerAudit {
  return Object.freeze({ alias, caller, operation, outcome, at: now() });
}

export function inspectSecretAlias(
  alias: string,
  env: Readonly<Record<string, string | undefined>>,
  caller: string,
  now: () => string = () => '1970-01-01T00:00:00Z',
): SecretBrokerResult {
  if (isRevokedTelegramAlias(alias) || (REVOKED_TELEGRAM_ALIASES as readonly string[]).includes(alias)) {
    throw new SecretBrokerError('SECRET_ALIAS_REVOKED', alias);
  }
  if (!APPROVED_LIVE_ALIASES.has(alias)) {
    throw new SecretBrokerError('SECRET_ALIAS_UNAUTHORIZED', alias);
  }
  const configured = present(env, alias);
  return Object.freeze({
    hermesEntry: ALIAS_TO_HERMES[alias] ?? null,
    configured,
    audit: audit(alias, caller, 'presence-check', configured ? 'present' : 'absent', now),
  });
}

export function mapApprovedAliasToHermesEntry(alias: string, caller: string, now: () => string = () => '1970-01-01T00:00:00Z'): SecretBrokerResult {
  if (isRevokedTelegramAlias(alias)) throw new SecretBrokerError('SECRET_ALIAS_REVOKED', alias);
  const hermesEntry = ALIAS_TO_HERMES[alias];
  if (hermesEntry === undefined) throw new SecretBrokerError('SECRET_ALIAS_UNAUTHORIZED', alias);
  return Object.freeze({
    hermesEntry,
    configured: false,
    audit: audit(alias, caller, 'resolve-name', 'mapped', now),
  });
}

export function assertNoSecretInAudit(entry: SecretBrokerAudit): void {
  const rendered = JSON.stringify(entry);
  if (/(?:xoxb-[A-Za-z0-9_-]{10,}|xapp-[A-Za-z0-9_-]{10,}|sk-or-|BEGIN [A-Z ]+PRIVATE KEY)/u.test(rendered)) {
    throw new SecretBrokerError('SECRET_VALUE_REFUSED', entry.alias);
  }
}
